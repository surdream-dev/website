import { encodeFunctionData, getAddress } from "viem"
import { ADDRESSES } from "../evm/addresses"
import { ETHERFI_POOL_ABI, ETHERFI_WEETH_POOL_ABI, ETHERFI_WEETH_WITHDRAWAL_ABI, WEETH_ABI } from "../evm/abis"
import { sendTx } from "../core/tx"
import { publicClient } from "../core/provider"
import type { StakeAdapter } from "./base"

// WeETH.getRate () view function (returns the number of eETH corresponding to 1 weETH, 1e18 precision)
// ether.fi official exchange rate: 1 weETH → ETH = getRate ()/1e18; 1 ETH → weETH = 1e18/getRate ()
const WEETH_RATE_ABI = [
  { name: "getRate", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const

// WithdrawalRequestNFT.isFinalized (tokenId): true = past the cooling period to claim, false = still waiting
const IS_FINALIZED_ABI = [
  { name: "isFinalized", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] },
] as const

export const etherfi: StakeAdapter = {
  // Stake: ETH → weETH (official depositETHForWeETH, receiver = user address)
  async deposit(amount, account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    const data = encodeFunctionData({
      abi: ETHERFI_WEETH_POOL_ABI,
      functionName: "depositETHForWeETH",
      args: [getAddress(account)]
    })

    return sendTx({
      to: ADDRESSES.etherfi.liquidityPoolWeETH,
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
      abi: WEETH_ABI,
      functionName: "wrap",
      args: [amount]
    })

    return sendTx({
      to: ADDRESSES.etherfi.weETH,
      data,
      account
    })
  },

  // Unstake: weETH → ETH (official requestWithdraw (weETH quantity, recipient), single, no need to unwrap first)
  async unstake(amount, account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    const data = encodeFunctionData({
      abi: ETHERFI_WEETH_WITHDRAWAL_ABI,
      functionName: "requestWithdraw",
      args: [amount, getAddress(account)]  // _weETHAmount, _receiver
    })

    return sendTx({
      to: ADDRESSES.etherfi.liquidityPoolWeETHWithdrawal,
      data,
      account
    })
  },

  // ether.fi withdraw = claimWithdraw (tokenId) Claim one by one on the NFT contract by tokenId
  async withdraw(requestIds: bigint[], account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    if (requestIds.length === 0) {
      throw new Error("No withdrawal token IDs provided")
    }

    // ether.fi only claims one tokenId at a time, operating on the WithdrawalRequestNFT contract
    const tokenId = requestIds[0]

    const data = encodeFunctionData({
      abi: ETHERFI_POOL_ABI,
      functionName: "claimWithdraw",
      args: [tokenId]
    })

    return sendTx({
      to: ADDRESSES.etherfi.withdrawalNFT as `0x${string}`,
      data,
      account
    })
  },

  async claim(account?: `0x${string}`) {
    if (!account) {
      throw new Error("Wallet not connected")
    }

    throw new Error("EtherFi claim requires a tokenId, use withdraw(tokenId[]) instead")
  },

  // ether.fi: unclaimed total via withdrawal NFT indexer API query
  async getClaimableAmount(account: `0x${string}`) {
    try {
      const url = `https://withdraw-request-nft-indexer.fly.dev/withdraw-request-nft/unclaimed/${account}`
      const res = await fetch(url)

      if (!res.ok) {
        return BigInt(0)
      }

      const data = await res.json() as Array<{
        amountOfEEth: string
        isClaimed: boolean
        tokenId: string
      }>

      if (!Array.isArray(data) || data.length === 0) return BigInt(0)

      // On-chain isFinalized one by one, only requests that have passed the cooldown period (can be claimed) are counted
      let total = BigInt(0)
      let availableCount = 0
      for (const item of data) {
        if (item.isClaimed || !item.amountOfEEth) continue

        let finalized = false
        try {
          finalized = await publicClient.readContract({
            address: ADDRESSES.etherfi.withdrawalNFT as `0x${string}`,
            abi: IS_FINALIZED_ABI,
            functionName: 'isFinalized',
            args: [BigInt(item.tokenId)],
          }) as boolean
        } catch (err) {
          console.warn(`[EtherFi] isFinalized failed for token ${item.tokenId}:`, err)
        }

        if (finalized) {
          availableCount++
          total += BigInt(item.amountOfEEth)
        }
      }

      // Withdrawal queue is accounted for in eETH (amountOfEEth), converted to weETH uniformly Show: 1 weETH = getRate ()/1e18 eETH
      const weEthRate = await publicClient.readContract({
        address: ADDRESSES.etherfi.weETH as `0x${string}`,
        abi: WEETH_RATE_ABI,
        functionName: 'getRate',
        args: [],
      }) as bigint

      const totalWeEth = weEthRate > 0n
        ? (total * 10n ** 18n) / weEthRate
        : total


      return totalWeEth
    } catch (err) {
      console.warn('[EtherFi] Failed to query indexer API:', err)
      return BigInt(0)
    }
  },

  // 1 weETH → ETH: weETH is the packaging of eETH, calculate eETH/ETH first, and then convert according to weETH.getRate ()
  // 1 weETH → ETH: ether.fi official exchange rate weETH.getRate ()/1e18 (on-chain real-time)
  async getUnstakeRate() {
    try {
      const weEthRate = await publicClient.readContract({
        address: ADDRESSES.etherfi.weETH as `0x${string}`,
        abi: WEETH_RATE_ABI,
        functionName: 'getRate',
        args: [],
      }) as bigint
      const n = Number(weEthRate)
      if (n <= 0) return 1
      return n / 1e18
    } catch (e) {
      console.warn('[EtherFi] getUnstakeRate failed:', e)
      return 1
    }
  },

  // 1 ETH → weETH = 1e18/weETH.getRate () (reverse)
  async getStakeRate() {
    const rate = await etherfi.getUnstakeRate!()
    return rate > 0 ? 1 / rate : 1
  }
}
