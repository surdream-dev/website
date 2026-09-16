import { encodeFunctionData, getAddress } from "viem"
import { multicall } from "viem/actions"
import { ADDRESSES } from "../evm/addresses"
import { ROCKETPOOL_DEPOSIT_ABI, ROCKETPOOL_RETH_ABI } from "../evm/abis"
import type { UnstakeLiquidity } from "./base"
import { sendTx } from "../core/tx"
import { publicClient } from "../core/provider"
import type { StakeAdapter } from "./base"

// Rocket Pool Minimum Stake: 0.01 ETH
const MIN_DEPOSIT = BigInt("10000000000000000") // 0.01 * 10^18

export const rocketpool: StakeAdapter = {
  async deposit(amount, account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    // Check Minimum Stake Amount
    if (amount < MIN_DEPOSIT) {
      throw new Error(`Rocket Pool requires minimum deposit of 0.01 ETH. You tried to deposit ${Number(amount) / 1e18} ETH.`)
    }

    const data = encodeFunctionData({
      abi: ROCKETPOOL_DEPOSIT_ABI,
      functionName: "deposit"
    })

    return sendTx({
      to: getAddress(ADDRESSES.rocketpool.depositPool),
      data,
      value: amount,
      account
    })
  },

  async unstake(amount, account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    // Rocket Pool unstake: Direct call to burn method of rETH token
    // burn (uint256_rethAmount) - burn rETH to get ETH
    // No need to approve, burn directly manipulates the token held by the user
    // Contract address: rETH token (0xae78736Cd615f374D3085123A210448E74Fc6393)

    const rETH = ADDRESSES.rocketpool.rETH


    const data = encodeFunctionData({
      abi: ROCKETPOOL_RETH_ABI,
      functionName: "burn",
      args: [amount]  // _rethAmount
    })

    return sendTx({
      to: rETH as `0x${string}`,
      data,
      account
    })
  },

  // Rocket Pool unstake is instant (burn rETH → ETH), no extra withdraw
  async getClaimableAmount(_account: `0x${string}`) {
    return BigInt(0)
  },

  // Check whether the rETH burn (unstake) can be covered by the pool's available ETH liquidity.
  // Mirrors the on-chain burn check: getTotalCollateral() >= getEthValue(rethAmount).
  // Returns undefined when the check can't be read (caller should not block on it).
  async getUnstakeLiquidity(rethAmount: bigint): Promise<UnstakeLiquidity | undefined> {
    try {
      const rETH = getAddress(ADDRESSES.rocketpool.rETH)
      const depositPool = getAddress(ADDRESSES.rocketpool.depositPool)
      const [requiredEthWei, totalCollateral] = await multicall(publicClient, {
        contracts: [
          { address: rETH, abi: ROCKETPOOL_RETH_ABI, functionName: "getEthValue", args: [rethAmount] },
          { address: rETH, abi: ROCKETPOOL_RETH_ABI, functionName: "getTotalCollateral", args: [] },
        ],
        allowFailure: false,
      })
      return {
        requiredEthWei: requiredEthWei as bigint,
        availableEthWei: totalCollateral as bigint,
        insufficient: (totalCollateral as bigint) < (requiredEthWei as bigint),
      }
    } catch (e) {
      console.warn(`[RocketPool] getUnstakeLiquidity failed:`, e)
      return undefined
    }
  },

  // 1 rETH → ETH (getExchangeRate returns 1 rETH = rate/1e18 ETH)
  async getUnstakeRate() {
    try {
      const rate = await publicClient.readContract({
        address: getAddress(ADDRESSES.rocketpool.rETH),
        abi: ROCKETPOOL_RETH_ABI,
        functionName: "getExchangeRate",
        args: [],
      }) as bigint
      return Number(rate) / 1e18
    } catch (e) {
      console.warn('[RocketPool] getUnstakeRate failed:', e)
      return 1
    }
  },

  // 1 ETH → rETH (reciprocal)
  async getStakeRate() {
    const rate = await rocketpool.getUnstakeRate!()
    return rate > 0 ? 1 / rate : 1
  },

  async getMarketData() {
    try {
      const rETH = getAddress(ADDRESSES.rocketpool.rETH)
      const [exchangeRate, totalSupply] = await multicall(publicClient, {
        contracts: [
          { address: rETH, abi: ROCKETPOOL_RETH_ABI, functionName: "getExchangeRate", args: [] },
          { address: rETH, abi: [{ name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }], functionName: "totalSupply", args: [] },
        ],
        allowFailure: false,
      })
      const rate = exchangeRate as bigint  // 1e18 = 1 ETH
      // TVL = rETH total circulation × exchange rate/1e18 (rETH and rate are 18 decimal places, the result is the wei of ETH)
      // Official port: ETH staked (e.g. 615,328 ETH = 19,229 validators x 32 ETH)
      const tvl = (totalSupply as bigint) * rate / BigInt(1e18)
      // APY is subject to the official API (api.rocketpool.net/api/apr) and is not inferred here (the instantaneous value of the exchange rate cannot be annualized)
      const apy = 0
      return { apy: Math.max(apy, 0), tvl }
    } catch (e) {
      console.warn('[RocketPool] getMarketData failed:', e)
      return { apy: 0, tvl: 0n }
    }
  }
}
