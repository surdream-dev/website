import { encodeFunctionData, getAddress, encodeAbiParameters, decodeAbiParameters } from "viem"
import { multicall } from "viem/actions"
import { ADDRESSES } from "../evm/addresses"
import { METH_ABI, METH_PERMIT_TYPES, METH_TOKEN_ABI } from "../evm/abis"
import { sendTx } from "../core/tx"
import { publicClient } from "../core/provider"
import { signTypedData } from "../core/signer"
import type { StakeAdapter } from "./base"

// Staking contract read-only function: totalControlled () = all ETH controlled by the protocol
// (Principal + Cumulative Earnings + Unclaimed unstake request)
const METH_STAKING_VIEW_ABI = [
  {
    name: "totalControlled",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const

// Multicall3 Address
const MULTICALL3_ADDRESS = "0xca11bde05977b3631167028862be2a173976ca11"

// Preview method selector (0x4461ff05)
const PREVIEW_SELECTOR = "0x4461ff05"

/** mETH official stats interface (same origin as APY): data [0] .METHtoETH = 1 mETH redeemable ETH quantity */
const METH_STATS_URL = "https://app.methprotocol.xyz/api/stats/apy"

async function fetchMethToEth(): Promise<number | null> {
  try {
    const res = await fetch(METH_STATS_URL)
    if (!res.ok) return null
    const data = await res.json()
    const v = parseFloat(data?.data?.[0]?.METHtoETH)
    return Number.isFinite(v) && v > 0 ? v : null
  } catch (e) {
    console.warn("[mETH] official stats fetch failed:", e)
    return null
  }
}

// Number of ETH to mETH previews from stake contract
async function previewStake(ethAmount: bigint): Promise<bigint | null> {
  try {
    const stakeContract = getAddress(ADDRESSES.meth.stakingContract)

    // Encode preview call data: selector + ethAmount (uint256)
    const previewCallData = PREVIEW_SELECTOR +
      ethAmount.toString(16).padStart(64, '0')

    // Encoding aggregate3 calls - Call3 [] structure
    // struct Call3 { address target; bool allowFailure; bytes callData; }
    // Use tuple format [address, bool, bytes]
    const callTuple = [
      [stakeContract, true, previewCallData as `0x${string}`]
    ] as const

    // aggregate3 selector: 0x82ad56cb
    const multicallData = encodeAbiParameters(
      [{
        type: 'tuple[]',
        components: [
          { type: 'address' },
          { type: 'bool' },
          { type: 'bytes' }
        ]
      }],
      [callTuple as any]
    )

    const data = '0x82ad56cb' + multicallData.slice(2)

    // Call multicall3
    const result = await publicClient.call({
      to: MULTICALL3_ADDRESS,
      data: data as `0x${string}`
    })

    if (!result || !result.data) {
      return null
    }

    // Decoding Result: Result [] Structure
    // struct Result { bool success; bytes returnData; }
    const decoded = decodeAbiParameters(
      [{
        type: 'tuple[]',
        components: [
          { type: 'bool' },
          { type: 'bytes' }
        ]
      }],
      result.data
    )

    // decoded [0] is an array containing [success, returnData] tuples
    const results = decoded[0] as unknown as Array<[boolean, `0x${string}`]>
    const [success, returnData] = results[0]

    if (!success) {
      return null
    }

    // Decode returnData: uint256 mETHAmount
    const mETHAmount = decodeAbiParameters(
      [{ type: 'uint256' }],
      returnData
    )[0] as bigint


    return mETHAmount
  } catch (error) {
    console.warn('[mETH] Failed to preview via multicall3:', error)
    return null
  }
}

// Preview unstake: Convert from mETH to ETH
async function previewUnstake(methAmount: bigint): Promise<bigint | null> {
  try {
    const ethAmount = await publicClient.readContract({
      address: getAddress(ADDRESSES.meth.mETH),
      abi: METH_TOKEN_ABI,
      functionName: 'convertToAssets',
      args: [methAmount]
    }) as bigint


    return ethAmount
  } catch (error) {
    console.warn('[mETH] Failed to preview unstake:', error)
    return null
  }
}

// unstakeRequestInfo(uint256) → (bool finalized, uint256 ethAmount)
const UNSTAKE_REQUEST_INFO_ABI = [{
  name: 'unstakeRequestInfo',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'requestId', type: 'uint256' }],
  outputs: [
    { name: 'finalized', type: 'bool' },
    { name: 'ethAmount', type: 'uint256' },
  ],
}] as const

// Unstake request status on the mETH staking contract: unstakeRequestInfo(uint256) → (bool finalized, uint256 claimable)
const METH_STAKING = getAddress(ADDRESSES.meth.stakingContract)
const SEL_UNSTAKE_INFO = '0xf1ec1e97'

/** Query the Mantle LSD indexer for a user's unclaimed unstake requests (id + requested ETH). */
async function queryUnstakeRequests(account: string): Promise<{ id: bigint; ethAmountWei: bigint }[]> {
  const resp = await fetch('https://lsd-indexer2.mantle.xyz/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `\n  query unclaimedRequests($address: String!) {\n    unstakeRequests(where: { requester: $address, isClaimed: false }) {\n      items {\n        id\n        ethAmountWei\n      }\n      totalCount\n    }\n  }\n`,
      variables: { address: account.toLowerCase() },
    }),
  })
  const json = await resp.json()
  return (json?.data?.unstakeRequests?.items || []).map((it: any) => ({
    id: BigInt(it.id),
    ethAmountWei: BigInt(it.ethAmountWei || '0'),
  }))
}

/** On-chain finalization status via staking.unstakeRequestInfo(id) → (finalized, claimable). null on failure. */
async function unstakeInfoOnChain(reqId: bigint): Promise<[boolean, bigint] | null> {
  try {
    const r = await publicClient.call({
      to: METH_STAKING,
      data: (SEL_UNSTAKE_INFO + reqId.toString(16).padStart(64, '0')) as `0x${string}`,
    })
    if (r.data && r.data !== '0x') {
      return decodeAbiParameters([{ type: 'bool' }, { type: 'uint256' }], r.data) as [boolean, bigint]
    }
  } catch (e) {
    console.warn('[mETH] unstakeRequestInfo(' + reqId + ') failed:', String(e).slice(0, 80))
  }
  return null
}

// localStorage: List of requestId with → unclaimed user address
const METH_REQUEST_IDS_KEY = 'meth_unstake_request_ids'
function getStoredRequestIds(account: string): bigint[] {
  try {
    const raw = localStorage.getItem(METH_REQUEST_IDS_KEY)
    if (!raw) return []
    const all: Record<string, string[]> = JSON.parse(raw)
    return (all[account.toLowerCase()] || []).map(id => BigInt(id))
  } catch { return [] }
}
function storeRequestId(account: string, requestId: bigint) {
  try {
    const raw = localStorage.getItem(METH_REQUEST_IDS_KEY)
    const all: Record<string, string[]> = raw ? JSON.parse(raw) : {}
    const key = account.toLowerCase()
    if (!all[key]) all[key] = []
    all[key].push(requestId.toString())
    localStorage.setItem(METH_REQUEST_IDS_KEY, JSON.stringify(all))
  } catch { /* ok */ }
}
function removeClaimedRequestIds(account: string, claimedIds: bigint[]) {
  try {
    const raw = localStorage.getItem(METH_REQUEST_IDS_KEY)
    if (!raw) return
    const all: Record<string, string[]> = JSON.parse(raw)
    const key = account.toLowerCase()
    if (!all[key]) return
    const claimed = new Set(claimedIds.map(id => id.toString()))
    all[key] = all[key].filter(id => !claimed.has(id))
    if (all[key].length === 0) delete all[key]
    localStorage.setItem(METH_REQUEST_IDS_KEY, JSON.stringify(all))
  } catch { /* ok */ }
}

export const meth: StakeAdapter = {
  async deposit(amount, account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    // Get expected number of mETH from contract
    const expectedMethAmount = await previewStake(amount)

    // Calculate minMETHAmount
    let minMETHAmount: bigint
    if (expectedMethAmount) {
      // Allow 0.5% slippage
      minMETHAmount = expectedMethAmount * BigInt(995) / BigInt(1000)
    } else {
      // Fallback: Use exchange rate ~0.915 mETH per ETH, allow 2% slippage
      minMETHAmount = amount * BigInt(89) / BigInt(100)
    }


    const data = encodeFunctionData({
      abi: METH_ABI,
      functionName: "stake",
      args: [minMETHAmount]
    })

    return sendTx({
      to: getAddress(ADDRESSES.meth.stakingContract),
      data,
      value: amount,
      account
    })
  },

  async unstake(amount, account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    // Get wallet client for signature
    const chainId = await publicClient.getChainId()
    const mETHAddress = getAddress(ADDRESSES.meth.mETH)
    const stakingContract = getAddress(ADDRESSES.meth.stakingContract)

    // 1. Get nonce
    const nonce = await publicClient.readContract({
      address: mETHAddress,
      abi: METH_ABI,
      functionName: 'nonces',
      args: [account]
    }) as bigint


    // 2. Set deadline (after 1 hour)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

    // 3. Preview the number of ETH and calculate minEthAmount (0.5% slippage allowed)
    const expectedEthAmount = await previewUnstake(amount)
    let minEthAmount: bigint
    if (expectedEthAmount) {
      minEthAmount = expectedEthAmount * BigInt(995) / BigInt(1000)
    } else {
      // Fallback: Use exchange rate ~ 1.09 ETH per mETH
      minEthAmount = amount * BigInt(107) / BigInt(100)
    }


    // 4. Construct Permit signature data
    const permitMessage = {
      owner: account,
      spender: stakingContract,
      value: amount,
      nonce,
      deadline
    }


    // 5. Signature EIP-712 Permit
    const signature = await signTypedData({
      account,
      domain: {
        name: 'mETH',
        version: '1',
        chainId: BigInt(chainId),
        verifyingContract: mETHAddress
      },
      types: METH_PERMIT_TYPES,
      primaryType: 'Permit',
      message: permitMessage
    })


    // 6. Resolve the signature to get v, r, s
    // signature format: 0x + r (32 bytes) + s (32 bytes) + v (1 byte)
    const sigBytes = signature.slice(2)
    const r = `0x${sigBytes.slice(0, 64)}` as `0x${string}`
    const s = `0x${sigBytes.slice(64, 128)}` as `0x${string}`
    const v = parseInt(sigBytes.slice(128, 130), 16)


    // 7. Call unstakeRequestWithPermit
    const data = encodeFunctionData({
      abi: METH_ABI,
      functionName: "unstakeRequestWithPermit",
      args: [amount, minEthAmount, deadline, v, r, s]
    })

    // 8. → Get request ID with eth_call preview return value
    try {
      const previewResult = await publicClient.call({
        to: stakingContract,
        data,
        account,
      })
      if (previewResult.data && previewResult.data !== '0x') {
        const requestId = decodeAbiParameters(
          [{ type: 'uint256' }],
          previewResult.data
        )[0] as bigint
        // Store request ID to localStorage
        storeRequestId(account, requestId)
      }
    } catch (previewErr) {
      console.warn('[mETH] Failed to preview request ID:', String(previewErr).slice(0, 100))
    }

    return sendTx({
      to: stakingContract,
      data,
      account
    })
  },

  // mETH unstake in one step with unstakeRequestWithPermit, no extra withdraw
  // Here the withdraw method is provided as a unified interface
  async claim(account?: `0x${string}`, requestId?: bigint) {
    if (!account) throw new Error("Wallet not connected")

    let id: bigint
    if (requestId !== undefined) {
      id = requestId
    } else {
      // Get the user's finalized request IDs from indexer
      const resp = await fetch('https://lsd-indexer2.mantle.xyz/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query($address: String!) { unstakeRequests(where: { requester: $address, isClaimed: false }) { items { id } } }`,
          variables: { address: account.toLowerCase() },
        }),
      })
      const json = await resp.json()
      const items = json?.data?.unstakeRequests?.items || []
      if (items.length === 0) throw new Error("No claimable unstake requests found")
      id = BigInt(items[0].id)
    }


    // claimUnstakeRequest(uint256) — selector 0x2bf67650
    const data = ('0x2bf67650' + id.toString(16).padStart(64, '0')) as `0x${string}`
    return sendTx({
      to: getAddress(ADDRESSES.meth.stakingContract),
      data,
      account: getAddress(account),
    })
  },

  async withdraw(_requestIds: bigint[], account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    // the withdraw of mETH calls requestWithdraw (version without permit)
    const amount = _requestIds[0] || BigInt(0)
    if (amount <= BigInt(0)) {
      throw new Error("No withdrawal amount specified")
    }

    const stakingContract = getAddress(ADDRESSES.meth.stakingContract)
    const data = encodeFunctionData({
      abi: METH_ABI,
      functionName: "requestWithdraw",
      args: [amount]
    })

    // Preview return value → Get request ID
    try {
      const previewResult = await publicClient.call({
        to: stakingContract,
        data,
        account: getAddress(account),
      })
      if (previewResult.data && previewResult.data !== '0x') {
        const requestId = decodeAbiParameters(
          [{ type: 'uint256' }],
          previewResult.data
        )[0] as bigint
        storeRequestId(account, requestId)
      }
    } catch (previewErr) {
      console.warn('[mETH] Failed to preview withdraw request ID:', String(previewErr).slice(0, 100))
    }

    return sendTx({
      to: stakingContract,
      data,
      account
    })
  },

  async getClaimableAmount(_account: `0x${string}`) {
    if (!_account) return BigInt(0)
    try {
      const account = getAddress(_account)

      // 1. Get the user's unclaimed unstake requests from the Mantle LSD Indexer
      const requests = await queryUnstakeRequests(account)
      if (requests.length === 0) return BigInt(0)

      // 2. Sum only finalized (claimable) amounts (unstakeRequestInfo → claimable)
      let totalClaimable = 0n
      for (const req of requests) {
        const info = await unstakeInfoOnChain(req.id)
        if (info && info[0] && info[1] > 0n) totalClaimable += info[1]
      }

      return totalClaimable
    } catch (e) {
      console.warn('[mETH] getClaimableAmount failed:', e)
      return BigInt(0)
    }
  },

  async getUnstakeStatus(_account: `0x${string}`) {
    if (!_account) return { pending: 0n, claimable: 0n }
    try {
      const account = getAddress(_account)

      // 1. Unclaimed unstake requests via the Mantle LSD indexer. The indexer's ethAmountWei is the
      // requested ETH; unstakeRequestInfo reports claimable=0 while a request is still pending, so the
      // pending amount comes from the indexer amount and only the finalization status comes on-chain.
      const requests = await queryUnstakeRequests(account)
      if (requests.length === 0) {
        return { pending: 0n, claimable: 0n }
      }

      // 2. finalized → claimable (on-chain claimable); not finalized → pending (indexer ethAmountWei)
      let pending = 0n
      let claimable = 0n
      for (const req of requests) {
        const info = await unstakeInfoOnChain(req.id)
        if (info) {
          const [finalized, claimableAmt] = info
          if (finalized && claimableAmt > 0n) claimable += claimableAmt
          else pending += req.ethAmountWei
        } else {
          // Chain lookup failed → show the indexer amount as pending
          pending += req.ethAmountWei
        }
      }

      return { pending, claimable }
    } catch (e) {
      console.warn('[mETH] getUnstakeStatus failed:', e)
      return { pending: 0n, claimable: 0n }
    }
  },

  // 1 ETH → mETH (the official interface METHtoETH takes the countdown; the interface is not available on the fallback chain previewDeposit)
  async getStakeRate() {
    const methToEth = await fetchMethToEth()
    if (methToEth !== null && methToEth > 0) return 1 / methToEth
    try {
      const shares = await publicClient.readContract({
        address: getAddress(ADDRESSES.meth.mETH),
        abi: METH_TOKEN_ABI,
        functionName: "previewDeposit",
        args: [BigInt(1e18)],
      }) as bigint
      return Number(shares) / 1e18
    } catch (e) {
      console.warn('[mETH] getStakeRate failed:', e)
      return 1
    }
  },

  // 1 mETH → ETH (official interface METHtoETH; interface not available on fallback chain convertToAssets)
  async getUnstakeRate() {
    const methToEth = await fetchMethToEth()
    if (methToEth !== null && methToEth > 0) return methToEth
    try {
      const assets = await publicClient.readContract({
        address: getAddress(ADDRESSES.meth.mETH),
        abi: METH_TOKEN_ABI,
        functionName: "convertToAssets",
        args: [BigInt(1e18)],
      }) as bigint
      return Number(assets) / 1e18
    } catch (e) {
      console.warn('[mETH] getUnstakeRate failed:', e)
      return 1
    }
  },

  async getMarketData() {
    try {
      const mETH = getAddress(ADDRESSES.meth.mETH)
      const staking = getAddress(ADDRESSES.meth.stakingContract)
      const [totalControlled, convertToAssets] = await multicall(publicClient, {
        contracts: [
          { address: staking, abi: METH_STAKING_VIEW_ABI, functionName: "totalControlled", args: [] },
          { address: mETH, abi: METH_TOKEN_ABI, functionName: "convertToAssets", args: [1n] },
        ],
        allowFailure: true,
      })
      // TVL = Total Controlled ETH (official caliber: all ETH controlled by the agreement, including proceeds and unstake)
      const tvl = totalControlled.status === 'success' ? (totalControlled.result as bigint) : 0n
      const rate = convertToAssets.status === 'success' ? Number(convertToAssets.result as bigint) : 1e18
      const apy = (rate / 1e18 - 1) * 7300
      return { apy: Math.max(apy, 0), tvl }
    } catch (e) {
      console.warn('[mETH] getMarketData failed:', e)
      return { apy: 0, tvl: 0n }
    }
  }
}
