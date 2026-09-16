import { encodeFunctionData, getAddress } from "viem"
import { multicall } from "viem/actions"
import { ADDRESSES } from "../evm/addresses"
import { STADER_ABI, STADER_ETHX_ABI, STADER_ETHX_RATE_ABI, STADER_UNSTAKE_ABI } from "../evm/abis"
import { sendTx } from "../core/tx"
import { publicClient } from "../core/provider"
import type { StakeAdapter } from "./base"

// Stader official Universe exchange rate interface: {"value": 1.0948…} = 1 ETHx number of ETH convertible
// On-chain ETHx.getExchangeRate measured multiple RPCs are revert (oracle data exception), use the official interface instead.
const STADER_EXCHANGE_RATE_URL = 'https://universe.staderlabs.com/eth/exchangeRate'

// Stader unstake contract address (different from stakeManager)
const unstakeManager = ADDRESSES.stader.unstakeManager as `0x${string}`

export const stader: StakeAdapter = {
  async deposit(amount, account?: `0x${string}`) {
    // Stader: Staking ETH to get ETHx
    // deposit(address _receiver, bytes _referralId)
    // User address must be passed in
    if (!account) {
      throw new Error("Wallet not connected")
    }

    const data = encodeFunctionData({
      abi: STADER_ABI,
      functionName: "deposit",
      args: [
        getAddress(account),     // _receiver = User address
        ""                       // _referralId = Empty String
      ]
    })


    return sendTx({
      to: ADDRESSES.stader.stakeManager,
      data,
      value: amount,
      account
    })
  },

  async unstake(amount, account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    // Stader requestWithdraw: Request ETH extraction
    // requestWithdraw(_ethXAmount, _owner, _referralId)
    // Note: Call the unstakeManager contract (not stakeManager)
    // referralId uses official referral code (65 chars)
    // Official transaction data decoding: e16cb0e1c351301d338efa434ee1daf3f19358ccccc6faad1c8bd273f76c131a5
    const referralId = "e16cb0e1c351301d338efa434ee1daf3f19358ccccc6faad1c8bd273f76c131a5"


    const data = encodeFunctionData({
      abi: STADER_ABI,
      functionName: "requestWithdraw",
      args: [
        amount,                 // _ethXAmount = ETHx quantity
        getAddress(account),    // _owner = User address
        referralId              // _referralId = referral code
      ]
    })

    return sendTx({
      to: unstakeManager,
      data,
      account
    })
  },

  async wrap(amount, account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    // ETHx -> wETHx
    const data = encodeFunctionData({
      abi: STADER_ETHX_ABI,
      functionName: "wrap",
      args: [amount]
    })

    return sendTx({
      to: ADDRESSES.stader.ethx,
      data,
      account
    })
  },

  async claim(account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    // Claim Reward
    const data = encodeFunctionData({
      abi: STADER_ABI,
      functionName: "claimRewards"
    })

    return sendTx({
      to: ADDRESSES.stader.stakeManager,
      data,
      account
    })
  },

  // Stader withdraw: Claim Completed Withdrawal Requests
  // requestWithdraw initiates a withdrawal request; after the waiting period, claim ETH
  // through claim(requestId) on the unstakeManager — matching the official Stader frontend
  // (e.g. claim(8408) → 0x379607f5…20d8).
  //
  // claim(uint256) enforces msg.sender == request.owner, so requests CANNOT be batched via
  // Multicall3 (aggregate3 executes each call with msg.sender = the Multicall3 contract, which
  // is not the owner → revert). Each available request must be claimed individually.
  async withdraw(requestIds: bigint[], account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    if (requestIds.length === 0) {
      throw new Error("No withdrawal request IDs provided")
    }

    // Claim each request in its own tx (single request → one claim; multiple → one claim per id).
    // Returns the last tx hash for confirmation tracking; the preceding claims are also sent and
    // each succeeds independently.
    let hash = ''
    for (const id of requestIds) {
      const data = encodeFunctionData({
        abi: STADER_UNSTAKE_ABI,
        functionName: "claim",
        args: [id]
      })

      hash = await sendTx({
        to: unstakeManager,
        data,
        account
      })
    }

    return hash
  },

  async getClaimableAmount(account: `0x${string}`) {
    const status = await stader.getUnstakeStatus!(account)
    return status.claimable
  },

  async getUnstakeStatus(account: `0x${string}`) {
    try {
      // 1. Get all request IDs of the user
      const requestIds = await publicClient.readContract({
        address: unstakeManager,
        abi: STADER_UNSTAKE_ABI,
        functionName: "getRequestIdsByUser",
        args: [account]
      }) as bigint[]

      if (requestIds.length === 0) return { pending: 0n, claimable: 0n }

      // 2. Get the details of each request in batches (using multicall)
      const results = await multicall(publicClient, {
        contracts: requestIds.map(id => ({
          address: unstakeManager,
          abi: STADER_UNSTAKE_ABI,
          functionName: "userWithdrawRequests",
          args: [id]
        })),
        allowFailure: false,
      })

      // 3. Distinguish between pending and claimable
      // userWithdrawRequests returns (owner, amountOfETHX, ethExpected, ethFinalized, blockNumber).
      // amountOfETH (ethExpected) is the ETH frozen at request time and is ALWAYS > 0 for a live request, so it is
      // NOT a claimability flag. A request is claimable iff ethFinalized > 0; otherwise it is pending.
      let pending = 0n
      let claimable = 0n
      for (const result of results) {
        const [, amountOfETHX, , ethFinalized] = result as [string, bigint, bigint, bigint]
        if (ethFinalized > 0n) {
          claimable += ethFinalized
        } else if (amountOfETHX > 0n) {
          pending += amountOfETHX
        }
      }


      return { pending, claimable }
    } catch (e) {
      console.warn('[Stader] getUnstakeStatus failed:', e)
      return { pending: 0n, claimable: 0n }
    }
  },

  // 1 ETHx → ETH (official Universe interface; ETHx.getExchangeRate on the failure fallback chain, then fallback 1)
  async getUnstakeRate() {
    // Solution A: Stader official Universe interface (browser CORS available, measured return {"value": 1.0948…})
    try {
      const res = await fetch(STADER_EXCHANGE_RATE_URL, { signal: AbortSignal.timeout(10000) })
      if (res.ok) {
        const json: any = await res.json()
        const value = Number(json?.value)
        if (Number.isFinite(value) && value > 0) return value
      }
    } catch (e) {
      console.warn('[Stader] Universe exchangeRate 获取失败，回退链上:', e)
    }

    // Scheme B: On-chain ETHx.getExchangeRate (StaderOracle)
    try {
      const rate = await publicClient.readContract({
        address: ADDRESSES.stader.ethx as `0x${string}`,
        abi: STADER_ETHX_RATE_ABI,
        functionName: "getExchangeRate",
        args: [],
      }) as bigint
      return Number(rate) / 1e18
    } catch (e) {
      console.warn('[Stader] getUnstakeRate failed:', e)
      return 1
    }
  },

  // 1 ETH → ETHx (countdown)
  async getStakeRate() {
    const rate = await stader.getUnstakeRate!()
    return rate > 0 ? 1 / rate : 1
  },

  async getMarketData() {
    try {
      const ethx = getAddress(ADDRESSES.stader.ethx)
      const [totalSupply] = await multicall(publicClient, {
        contracts: [
          { address: ethx, abi: [{ name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }], functionName: "totalSupply", args: [] },
        ],
        allowFailure: false,
      })
      // Stader ETHx ≈ 1:1 with ETH, TVL ≈ totalSupply
      const tvl = totalSupply as bigint
      return { apy: 0, tvl }
    } catch (e) {
      console.warn('[Stader] getMarketData failed:', e)
      return { apy: 0, tvl: 0n }
    }
  }
}
