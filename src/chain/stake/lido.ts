import { encodeFunctionData, getAddress } from "viem"
import { multicall } from "viem/actions"
import { ADDRESSES } from "../evm/addresses"
import { LIDO_ABI, WSTETH_ABI, LIDO_WITHDRAWAL_QUEUE_ABI, ERC20_PERMIT_TYPES } from "../evm/abis"
import { sendTx } from "../core/tx"
import { publicClient } from "../core/provider"
import { signTypedData } from "../core/signer"
import type { StakeAdapter } from "./base"

const stETH = getAddress(ADDRESSES.lido.stETH)
const withdrawalQueue = getAddress(ADDRESSES.lido.withdrawalQueue)

// Lido On-Chain Data ABI
const LIDO_VIEW_ABI = [
  { name: "getTotalPooledEther", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "getTotalShares", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const

const ERC20_SUPPLY_ABI = [{ name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const

// Signature ERC20 Permit (EIP-2612)
async function signPermit(
  owner: `0x${string}`,
  spender: `0x${string}`,
  value: bigint,
  deadline: bigint
): Promise<{ v: number; r: `0x${string}`; s: `0x${string}` }> {
  const chainId = await publicClient.getChainId()

  // Get stETH nonce
  const nonce = await publicClient.readContract({
    address: stETH,
    abi: [
      {
        name: "nonces",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "owner", type: "address" }],
        outputs: [{ name: "", type: "uint256" }]
      }
    ],
    functionName: "nonces",
    args: [owner]
  }) as bigint

  // Permit message
  const permitMessage = {
    owner: owner,
    spender: spender,
    value: value,
    nonce: nonce,
    deadline: deadline
  }


  // EIP-712 Signature
  // the domain of stETH needs to contain version: '2'
  const signature = await signTypedData({
    account: owner,
    domain: {
      name: 'Liquid staked Ether 2.0',
      version: '2',
      chainId: Number(chainId),
      verifyingContract: stETH
    },
    types: ERC20_PERMIT_TYPES,
    primaryType: 'Permit',
    message: permitMessage
  })

  // Resolve signature to get v, r, s
  // signature format: r (32 bytes) + s (32 bytes) + v (1 byte)
  const r = signature.slice(0, 66) as `0x${string}`
  const s = `0x${signature.slice(66, 130)}` as `0x${string}`
  const v = parseInt(signature.slice(130, 132), 16)


  return { v, r, s }
}

/** Calculate hints required for claimWithdrawals/getClaimableEther */
async function getCheckpointHints(requestIds: bigint[]): Promise<bigint[]> {
  if (requestIds.length === 0) return []
  try {
    // Get the latest checkpoint index as the search upper bound first
    const lastIndex = await publicClient.readContract({
      address: withdrawalQueue,
      abi: LIDO_WITHDRAWAL_QUEUE_ABI,
      functionName: 'getLastCheckpointIndex',
      args: []
    }) as bigint

    // checkpoint list starts from 1,_firstIndex must be > 0 (passing 0 will revert "firstIndex zero")
    const hints = await publicClient.readContract({
      address: withdrawalQueue,
      abi: LIDO_WITHDRAWAL_QUEUE_ABI,
      functionName: 'findCheckpointHints',
      args: [requestIds, BigInt(1), lastIndex]
    }) as bigint[]

    return hints
  } catch (err) {
    console.warn('[Lido] getCheckpointHints failed:', err)
    // Demote: returns 0 array, claimWithdrawals is still executable but gas is high
    return requestIds.map(() => BigInt(0))
  }
}

export const lido: StakeAdapter = {
  async deposit(amount, account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    const data = encodeFunctionData({
      abi: LIDO_ABI,
      functionName: "submit",
      args: ["0x0000000000000000000000000000000000000000"]
    })

    return sendTx({
      to: stETH,
      data,
      value: amount,
      account
    })
  },

  async wrap(amount, account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    const data = encodeFunctionData({
      abi: WSTETH_ABI,
      functionName: "wrap",
      args: [amount]
    })

    return sendTx({
      to: ADDRESSES.lido.wstETH,
      data,
      account
    })
  },

  async unstake(amount, account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    const owner = getAddress(account)


    // Lido unstake Permit process:
    // 1. Sign Permit (do not send transactions, just sign authorization information)
    // 2. Call requestWithdrawalsWithPermit (send with signature + fetch request)
    // Pros: Save gas with just one transaction

    // Set deadline (current time + 24 hours)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400)


    // Signature Permit
    const { v, r, s } = await signPermit(owner, withdrawalQueue, amount, deadline)


    // Call requestWithdrawalsWithPermit
    const data = encodeFunctionData({
      abi: LIDO_WITHDRAWAL_QUEUE_ABI,
      functionName: "requestWithdrawalsWithPermit",
      args: [
        [amount],      // _amounts: Array of withdrawal amounts
        owner,         // _owner: User address
        {
          value: amount,
          deadline: deadline,
          v: v,
          r: r,
          s: s
        }              // _permit: Signature data
      ]
    })

    return sendTx({
      to: withdrawalQueue,
      data,
      account
    })
  },

  async claim(account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    // 1) Get all withdrawal request IDs of the user
    let requestIds: bigint[] = []
    try {
      requestIds = await publicClient.readContract({
        address: withdrawalQueue,
        abi: LIDO_WITHDRAWAL_QUEUE_ABI,
        functionName: 'getWithdrawalRequests',
        args: [account]
      }) as bigint[]
    } catch (err) {
      console.warn('[Lido] claim: getWithdrawalRequests failed:', err)
      throw new Error('Failed to fetch withdrawal requests')
    }

    if (requestIds.length === 0) {
      throw new Error('No withdrawal requests to claim')
    }

    // 2) Distinguish between finalized and pending
    const statuses = await publicClient.readContract({
      address: withdrawalQueue,
      abi: LIDO_WITHDRAWAL_QUEUE_ABI,
      functionName: 'getWithdrawalStatus',
      args: [requestIds]
    }) as Array<{ amountOfStETH: bigint; isFinalized: boolean; isClaimed: boolean }>

    const finalizedIds: bigint[] = []
    const pendingIds: bigint[] = []
    for (let i = 0; i < statuses.length; i++) {
      const s = statuses[i]
      if (s.isClaimed) continue
      if (s.isFinalized) finalizedIds.push(requestIds[i])
      else pendingIds.push(requestIds[i])
    }

    if (finalizedIds.length === 0) {
      throw new Error(`No finalized requests to claim (${pendingIds.length} still pending)`)
    }

    // 3) Consistent with the official front end: unified claimWithdrawals + findCheckpointHints real hints (single pen also passes hint, save gas)
    const hints = await getCheckpointHints(finalizedIds)
    const data = encodeFunctionData({
      abi: LIDO_WITHDRAWAL_QUEUE_ABI,
      functionName: "claimWithdrawals",
      args: [finalizedIds, hints]
    })


    return sendTx({
      to: withdrawalQueue,
      data,
      account
    })
  },

  // Lido withdraw: Claim completed withdrawal request
  // You need to submit the request through unstake first, wait 1-5 days before calling withdraw
  async withdraw(requestIds: bigint[], account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    if (requestIds.length === 0) {
      throw new Error("No withdrawal request IDs provided")
    }

    const owner = getAddress(account)


    // Consistent with the official front end: unified claimWithdrawals + findCheckpointHints real hints (single pen also passes hint, save gas)
    const hints = await getCheckpointHints(requestIds)
    const data = encodeFunctionData({
      abi: LIDO_WITHDRAWAL_QUEUE_ABI,
      functionName: "claimWithdrawals",
      args: [requestIds, hints]
    })

    return sendTx({
      to: withdrawalQueue,
      data,
      account
    })
  },

  async getClaimableAmount(account: `0x${string}`) {
    const owner = getAddress(account)

    // 1) Get all withdrawal request IDs of the user
    let requestIds: bigint[] = []
    try {
      requestIds = await publicClient.readContract({
        address: withdrawalQueue,
        abi: LIDO_WITHDRAWAL_QUEUE_ABI,
        functionName: 'getWithdrawalRequests',
        args: [owner]
      }) as bigint[]
    } catch (err) {
      console.warn('[Lido] getWithdrawalRequests failed:', err)
      return BigInt(0)
    }

    if (requestIds.length === 0) {
      return BigInt(0)
    }

    // 2) Query the request status by getWithdrawalStatus and summarize the unclaimed amount with amountOfStETH
    // stETH anchored to ETH 1: 1, no need to use getClaimableEther (hints required, increase complexity)
    let total = BigInt(0)
    try {
      const statuses = await publicClient.readContract({
        address: withdrawalQueue,
        abi: LIDO_WITHDRAWAL_QUEUE_ABI,
        functionName: 'getWithdrawalStatus',
        args: [requestIds]
      }) as Array<{ amountOfStETH: bigint; amountOfShares: bigint; owner: string; timestamp: bigint; isFinalized: boolean; isClaimed: boolean }>


      for (let i = 0; i < statuses.length; i++) {
        const s = statuses[i]
        if (!s.isClaimed) {
          total += s.amountOfStETH
        }
      }
    } catch (err) {
      console.warn('[Lido] getWithdrawalStatus failed:', err)
      return BigInt(0)
    }


    return total
  },

  async getUnstakeStatus(account: `0x${string}`) {
    const owner = getAddress(account)

    let requestIds: bigint[] = []
    try {
      requestIds = await publicClient.readContract({
        address: withdrawalQueue,
        abi: LIDO_WITHDRAWAL_QUEUE_ABI,
        functionName: 'getWithdrawalRequests',
        args: [owner]
      }) as bigint[]
    } catch (err) {
      console.warn('[Lido] getUnstakeStatus: getWithdrawalRequests failed:', err)
      return { pending: 0n, claimable: 0n }
    }

    if (requestIds.length === 0) {
      return { pending: 0n, claimable: 0n }
    }

    try {
      const statuses = await publicClient.readContract({
        address: withdrawalQueue,
        abi: LIDO_WITHDRAWAL_QUEUE_ABI,
        functionName: 'getWithdrawalStatus',
        args: [requestIds]
      }) as Array<{ amountOfStETH: bigint; amountOfShares: bigint; owner: string; timestamp: bigint; isFinalized: boolean; isClaimed: boolean }>

      let pending = 0n
      let claimable = 0n
      for (const s of statuses) {
        if (s.isClaimed) continue
        if (s.isFinalized) claimable += s.amountOfStETH
        else pending += s.amountOfStETH
      }
      return { pending, claimable }
    } catch (err) {
      console.warn('[Lido] getUnstakeStatus: getWithdrawalStatus failed:', err)
      return { pending: 0n, claimable: 0n }
    }
  },

  // stETH is the rebase token: 1 ETH minted 1 stETH (submit i.e. 1: 1),
  // The getSharesByPooledEth (protocol internal share, ≈ 0.8x) cannot be displayed as a stETH quantity.
  async getStakeRate() {
    return 1
  },

  // 1 stETH → ETH: Lido official caliber 1: 1 (rebase revenue is reflected in balance growth, not exchange rate)
  async getUnstakeRate() {
    return 1
  },

  async getMarketData() {
    try {
      const [totalPooledEther, totalStETH] = await multicall(publicClient, {
        contracts: [
          { address: stETH, abi: LIDO_VIEW_ABI, functionName: "getTotalPooledEther", args: [] },
          { address: stETH, abi: ERC20_SUPPLY_ABI, functionName: "totalSupply", args: [] },
        ],
        allowFailure: false,
      })
      const tvl = totalPooledEther as bigint
      const totalShares = totalStETH as bigint
      // Simple APY estimation: 1 stETH ≈ pooledEther/shares ETH
      // the annualization of stETH is about 2.5-3.5%, which is approximated by on-chain data
      const exchangeRate = Number(totalPooledEther) / Number(totalShares)
      const apy = (exchangeRate - 1) * 7300 // Approximate annualization (~ 2 years cumulative)
      return { apy: Math.max(apy, 0), tvl }
    } catch (e) {
      console.warn('[Lido] getMarketData failed:', e)
      return { apy: 0, tvl: 0n }
    }
  }
}
