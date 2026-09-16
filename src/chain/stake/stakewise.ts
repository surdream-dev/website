import { encodeFunctionData, getAddress } from "viem"
import { multicall } from "viem/actions"
import { ADDRESSES } from "../evm/addresses"
import { STAKEWISE_STAKE_ABI, STAKEWISE_VAULT_ABI, OS_TOKEN_CONTROLLER_ABI } from "../evm/abis"
import { publicClient } from "../core/provider"
import { sendTx } from "../core/tx"
import type { StakeAdapter } from "./base"

// StakeWise official subgraph (protocol-level TVL data source, same source as the official website)
// totalAssets = Total Staked for network (0) (official website display aperture, such as 376.39k ETH)
const STAKEWISE_SUBGRAPH_URL = "https://graphs.stakewise.io/mainnet/subgraphs/name/stakewise/prod"

async function fetchStakewiseNetworkTvl(): Promise<bigint | null> {
  try {
    const res = await fetch(STAKEWISE_SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ networks { totalAssets } }" }),
    })
    if (!res.ok) return null
    const json: any = await res.json()
    const v = json?.data?.networks?.[0]?.totalAssets
    return typeof v === "string" && v ? BigInt(v) : null
  } catch (e) {
    console.warn("[StakeWise] 官方子图 TVL 获取失败:", e)
    return null
  }
}

export const stakewise: StakeAdapter = {
  async deposit(amount, receiver?: `0x${string}`) {
    if (!receiver) {
      throw new Error("Wallet not connected")
    }

    // StakeWise: Call the depositAndMintOsToken function to receive ETH and cast osETH
    // osTokenShares set to type (uint256) .max means minting the maximum amount of osETH by the amount of ETH
    const data = encodeFunctionData({
      abi: STAKEWISE_STAKE_ABI,
      functionName: "depositAndMintOsToken",
      args: [
        receiver, // receiver
        115792089237316195423570985008687907853269984665640564039457584007913129639935n, // type (uint256) .max - maximum number of castings
        "0x0000000000000000000000000000000000000000" // referral (no referrer)
      ]
    })

    return sendTx({
      to: ADDRESSES.stakewise.vault,
      data,
      value: amount,
      account: receiver
    })
  },

  async unstake(shares, account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    // StakeWise unstake: Batch call burnOsToken + enterExitQueue with multicall
    // 1. Convert osETH share to ETH value (osTokenController.convertToAssets)
    // 2. Convert ETH value to vault shares (vault.convertToShares)
    // 3. Perform via multicall atom: destroy osETH before entering exit queue

    // Calculate the ETH value for osETH
    const ethAssets = await publicClient.readContract({
      address: ADDRESSES.stakewise.osTokenVaultController,
      abi: OS_TOKEN_CONTROLLER_ABI,
      functionName: "convertToAssets",
      args: [shares]
    }) as bigint

    // Calculate corresponding vault shares
    const vaultShares = await publicClient.readContract({
      address: ADDRESSES.stakewise.vault,
      abi: STAKEWISE_VAULT_ABI,
      functionName: "convertToShares",
      args: [ethAssets]
    }) as bigint

    // burnOsToken uses uint128, strong conversion
    const burnData = encodeFunctionData({
      abi: STAKEWISE_STAKE_ABI,
      functionName: "burnOsToken",
      args: [shares]
    })

    // enterExitQueue Enter Exit Queue
    const exitData = encodeFunctionData({
      abi: STAKEWISE_STAKE_ABI,
      functionName: "enterExitQueue",
      args: [vaultShares, account]
    })

    // Execute with vault.multicall atom
    const multicallData = encodeFunctionData({
      abi: STAKEWISE_STAKE_ABI,
      functionName: "multicall",
      args: [[burnData, exitData]]
    })


    return sendTx({
      to: ADDRESSES.stakewise.vault,
      data: multicallData,
      account
    })
  },

  // Claim staking rewards
  async claim(account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    const data = encodeFunctionData({
      abi: STAKEWISE_STAKE_ABI,
      functionName: "claimRewards",
      args: [account]
    })

    return sendTx({
      to: ADDRESSES.stakewise.vault,
      data,
      account
    })
  },

  // Claim ETH processed in exit queue
  // Each positionTicket calls claimExitedAssets once
  async withdraw(positionTickets: bigint[], account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    if (positionTickets.length === 0) {
      throw new Error("No position tickets provided")
    }

    // Get withdrawalTimestamp for each ticket from the subgraph
    // The official app uses the chain-recorded withdrawalTimestamp, not the dynamic deadline
    const user = getAddress(account).toLowerCase()
    const resp = await fetch(
      'https://graphs.stakewise.io/mainnet/subgraphs/name/stakewise/prod',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{
            exitRequests(where: { receiver: "${user}" }, first: 1000) {
              positionTicket
              timestamp
              exitQueueIndex
            }
          }`
        })
      }
    )
    const json = await resp.json() as {
      data?: { exitRequests?: Array<{ positionTicket: string; timestamp: string; exitQueueIndex: string }> }
    }
    const ticketMeta = new Map<string, { timestamp: bigint; exitQueueIndex: bigint }>()
    for (const r of json.data?.exitRequests || []) {
      ticketMeta.set(r.positionTicket, {
        timestamp: BigInt(r.timestamp || '0'),
        exitQueueIndex: BigInt(r.exitQueueIndex || '0')
      })
    }

    // Single ticket: Direct call to claimExitedAssets
    if (positionTickets.length === 1) {
      const meta = ticketMeta.get(positionTickets[0].toString())
      const ts = meta?.timestamp || 0n
      const idx = meta?.exitQueueIndex || 0n
      const data = encodeFunctionData({
        abi: STAKEWISE_STAKE_ABI,
        functionName: "claimExitedAssets",
        args: [positionTickets[0], ts, idx]
      })

      return sendTx({
        to: ADDRESSES.stakewise.vault,
        data,
        account
      })
    }

    // Multiple tickets: bulk claim via multicall
    const calls = positionTickets.map(ticket => {
      const meta = ticketMeta.get(ticket.toString())
      const ts = meta?.timestamp || 0n
      const idx = meta?.exitQueueIndex || 0n
      return encodeFunctionData({
        abi: STAKEWISE_STAKE_ABI,
        functionName: "claimExitedAssets",
        args: [ticket, ts, idx]
      })
    })

    const multicallData = encodeFunctionData({
      abi: STAKEWISE_STAKE_ABI,
      functionName: "multicall",
      args: [calls]
    })


    return sendTx({
      to: ADDRESSES.stakewise.vault,
      data: multicallData,
      account
    })
  },

  async getClaimableAmount(account: `0x${string}`) {
    const status = await stakewise.getUnstakeStatus!(account)
    return status.claimable
  },

  async getUnstakeStatus(account: `0x${string}`) {
    try {
      const user = getAddress(account).toLowerCase()
      const vault = ADDRESSES.stakewise.vault.toLowerCase()

      // Query exit queue via StakeWise official subgraph
      const response = await fetch(
        'https://graphs.stakewise.io/mainnet/subgraphs/name/stakewise/prod',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `{
              exitRequests(where: { receiver: "${user}", vault: "${vault}" }, first: 1000) {
                positionTicket
                totalAssets
                exitedAssets
                isClaimable
                isClaimed
                timestamp
                exitQueueIndex
              }
            }`
          })
        }
      )

      const json = await response.json() as {
        data?: { exitRequests?: Array<{
          positionTicket: string
          totalAssets: string
          exitedAssets: string
          isClaimable: boolean
          isClaimed: boolean
          timestamp: string
          exitQueueIndex: string
        }> }
      }

      const positions = json.data?.exitRequests || []
      let pending = 0n
      let claimable = 0n
      const tickets: Array<{ positionTicket: bigint; shares: bigint; exitedAssets: bigint; timestamp: bigint; exitQueueIndex: bigint }> = []

      for (const pos of positions) {
        if (pos.isClaimed) continue
        const ticket = BigInt(pos.positionTicket)
        const shares = BigInt(pos.totalAssets || '0')
        const exited = BigInt(pos.exitedAssets || '0')
        const ts = BigInt(pos.timestamp || '0')
        const idx = BigInt(pos.exitQueueIndex || '0')
        tickets.push({ positionTicket: ticket, shares, exitedAssets: exited, timestamp: ts, exitQueueIndex: idx })
        if (pos.isClaimable) {
          claimable += exited  // Exited ETH → can claim
        } else {
          pending += shares  // Still queuing
        }
      }


      return { pending, claimable, tickets }
    } catch (e) {
      console.warn('[StakeWise] getUnstakeStatus failed:', e)
      return { pending: 0n, claimable: 0n }
    }
  },

  // 1 osETH → ETH (osTokenVaultController.convertToAssets, same origin as unstake conversion)
  async getUnstakeRate() {
    try {
      const assets = await publicClient.readContract({
        address: ADDRESSES.stakewise.osTokenVaultController as `0x${string}`,
        abi: OS_TOKEN_CONTROLLER_ABI,
        functionName: "convertToAssets",
        args: [BigInt(1e18)],
      }) as bigint
      return Number(assets) / 1e18
    } catch (e) {
      console.warn('[StakeWise] getUnstakeRate failed:', e)
      return 1
    }
  },

  // 1 ETH → osETH (countdown)
  async getStakeRate() {
    const rate = await stakewise.getUnstakeRate!()
    return rate > 0 ? 1 / rate : 1
  },

  async getMarketData() {
    try {
      const vault = ADDRESSES.stakewise.vault
      // On-chain vault totalAssets/totalSupply is only used for APY pocket exchange rate calculation
      const [vaultAssets, totalSupply] = await multicall(publicClient, {
        contracts: [
          { address: vault as `0x${string}`, abi: [{ name: "totalAssets", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }], functionName: "totalAssets", args: [] },
          { address: vault as `0x${string}`, abi: [{ name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }], functionName: "totalSupply", args: [] },
        ],
        allowFailure: true,
      })
      // TVL = official subgraph network.totalAssets (protocol level Total Staked, consistent with the official website display);
      // Returns 0n when the subgraph is not available, and the page does not display the error value
      const tvl = (await fetchStakewiseNetworkTvl()) ?? 0n
      const vaultAssetsNum = vaultAssets.status === 'success' ? (vaultAssets.result as bigint) : 0n
      const shares = totalSupply.status === 'success' ? (totalSupply.result as bigint) : 0n
      const rate = shares > 0n ? Number(vaultAssetsNum) / Number(shares) : 1
      const apy = (rate - 1) * 7300
      return { apy: Math.max(apy, 0), tvl }
    } catch (e) {
      console.warn('[StakeWise] getMarketData failed:', e)
      return { apy: 0, tvl: 0n }
    }
  }
}
