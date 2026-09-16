import { encodeFunctionData, getAddress, formatUnits } from "viem"
import { ADDRESSES } from "../evm/addresses"
import { ETHENA_ABI, ERC20_ABI, SUSDE_ABI } from "../evm/abis"
import { sendTx } from "../core/tx"
import { publicClient } from "../core/provider"
import type { StablecoinAdapter } from "./base"

const sUSDe = getAddress(ADDRESSES.stablecoin.ethena.sUSDe)
const USDe = getAddress(ADDRESSES.stablecoin.ethena.USDe)

// Ethena Exchange Rate Query (ERC4626 previewRedeem)
export const ethenaRate = {
  /**
 * Query redeem exchange rate: shares → assets
 * Use previewRedeem to get the real exchange rate
 * @param shares - sUSDe number of shares
 * @returns assets - USDe number
 */
  async previewRedeem(shares: bigint): Promise<bigint> {
    const assets = await publicClient.readContract({
      address: sUSDe,
      abi: SUSDE_ABI,
      functionName: "previewRedeem",
      args: [shares]
    }) as bigint


    return assets
  },

  /**
 * Query exchange rate ratio
 * @returns assets per share (e.g. 1.0 means 1: 1)
 */
  async getExchangeRate(): Promise<number> {
    // Query how much USDe can be exchanged for 1 sUSDe
    const oneShare = BigInt(1e18)  // 1 token in 18 decimals
    const assets = await this.previewRedeem(oneShare)
    // Use formatUnits to avoid large precision loss
    return parseFloat(formatUnits(assets, 18))
  }
}

// sUSDe cooldown related queries
export const ethenaCooldown = {
  /** Query cooldown duration (sec) */
  async getCooldownDuration(): Promise<number> {
    const duration = await publicClient.readContract({
      address: sUSDe,
      abi: SUSDE_ABI,
      functionName: "cooldownDuration"
    }) as bigint
    return Number(duration)
  },

  /**
 * Query the user's cooldown slot on the deployed StakedUSDeV2.
 * Data source: cooldowns(user) → (cooldownEnd, underlyingAmount), the amount is USDe (assets) wei.
 * @param user - account address
 * @returns pendingAssets (USDe wei), cooldownEnd (sec), duration (sec), isReady, remainingSeconds
 */
  async getCooldownStatus(user: `0x${string}`): Promise<{
    pendingAssets: bigint
    cooldownEnd: bigint
    duration: number
    isReady: boolean
    remainingSeconds: number
  }> {
    const [result, duration] = await Promise.all([
      publicClient.readContract({
        address: sUSDe,
        abi: SUSDE_ABI,
        functionName: "cooldowns",
        args: [getAddress(user)]
      }) as Promise<[bigint, bigint]>,
      publicClient.readContract({
        address: sUSDe,
        abi: SUSDE_ABI,
        functionName: "cooldownDuration"
      }) as Promise<bigint>
    ])

    const cooldownEnd = result[0]
    const pendingAssets = result[1]

    const now = Math.floor(Date.now() / 1000)
    const isReady = pendingAssets > 0n && cooldownEnd > 0n && now >= Number(cooldownEnd)
    const remainingSeconds = pendingAssets > 0n && cooldownEnd > 0n
      ? Math.max(0, Number(cooldownEnd) - now)
      : 0

    return {
      pendingAssets,
      cooldownEnd,
      duration: Number(duration),
      isReady,
      remainingSeconds
    }
  }
}

export const ethena: StablecoinAdapter = {
  async mint(amount, extra) {
    const data = encodeFunctionData({
      abi: ETHENA_ABI,
      functionName: "mint",
      args: [extra?.order ?? "0x", extra?.signature ?? "0x"]
    })

    return sendTx({
      to: ADDRESSES.stablecoin.ethena.mintRedeem,
      data
    })
  },

  async redeem(amount, extra) {
    const data = encodeFunctionData({
      abi: ETHENA_ABI,
      functionName: "redeem",
      args: [extra?.order ?? "0x", extra?.signature ?? "0x"]
    })

    return sendTx({
      to: ADDRESSES.stablecoin.ethena.mintRedeem,
      data
    })
  },

  async transfer(to, amount) {
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [to, amount]
    })

    return sendTx({
      to: ADDRESSES.stablecoin.ethena.USDe,
      data
    })
  },

  async approve(amount, assetAddress?: string) {
    const tokenAddress = assetAddress ? getAddress(assetAddress) : USDe
    const stakingContract = sUSDe

    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [stakingContract, amount]
    })

    return sendTx({
      to: tokenAddress,
      data
    })
  },

  /** stake: deposit USDe into sUSDe */
  async stake(amount: bigint, account: `0x${string}`, assetAddress?: string) {
    const data = encodeFunctionData({
      abi: SUSDE_ABI,
      functionName: "deposit",
      args: [amount, account]
    })

    return sendTx({
      to: sUSDe,
      data,
      account
    })
  },

  /**
 * unstake Step 1: Initiate cooldown
 * Call cooldownShares to lock the shares to be withdrawn
 * Wait 1 day after that to perform step 2 unstake ()
 * * @param shares - Number of sUSDe shares to unstake
 * @param account - User address
 */
  async cooldownShares(shares: bigint, account: `0x${string}`): Promise<string> {

    const data = encodeFunctionData({
      abi: SUSDE_ABI,
      functionName: "cooldownShares",
      args: [shares]
    })

    return sendTx({
      to: sUSDe,
      data,
      account
    })
  },

  /**
 * unstake Step 2: Extract USDe
 * Call this method to extract USDe after cooldown expires (1 day)
 * * @param account - user address (as receiver)
 */
  async unstakeFinalize(account: `0x${string}`): Promise<string> {
    // Check cooldown status
    const cooldownStatus = await ethenaCooldown.getCooldownStatus(account)

    if (cooldownStatus.pendingAssets <= 0n) {
      throw new Error("Nothing to claim. Start a cooldown in Withdraw first.")
    }
    if (!cooldownStatus.isReady) {
      throw new Error(`Cooldown not expired. Wait ${cooldownStatus.remainingSeconds} more seconds.`)
    }

    const data = encodeFunctionData({
      abi: SUSDE_ABI,
      functionName: "unstake",
      args: [account]  // receiver = User address
    })

    return sendTx({
      to: sUSDe,
      data,
      account
    })
  },

  /**
 * unstake Step 2 (alias): Claim the pending USDe after the cooldown expires.
 * unstake(receiver) withdraws the FULL pending amount in one transaction.
 */
  async claim(account: `0x${string}`): Promise<string> {
    return this.unstakeFinalize(account)
  },

  /** Query the cooldown slot as pending / claimable USDe (wei). */
  async getUnstakeStatus(account: `0x${string}`): Promise<{
    pending: bigint
    claimable: bigint
  }> {
    const status = await ethenaCooldown.getCooldownStatus(account)
    return {
      pending: status.pendingAssets,
      claimable: status.isReady ? status.pendingAssets : 0n
    }
  },

  /**
 * unstake: Compatible with legacy interfaces
 * Note: This method only performs the first step cooldownShares
 * The second step requires waiting 1 day before manually calling unstakeFinalize
 */
  async unstake(amount: bigint, account: `0x${string}`): Promise<string> {
    // Note: amount is the number of shares, not the number of assets
    // sUSDe is a 1: 1 exchange rate, so shares ≈ assets
    return this.cooldownShares(amount, account)
  },

  /**
 * withdraw: Keep the old method but mark it as deprecated
 * @deprecated Use cooldownShares + unstakeFinalize two-step process
 */
  async withdraw(amount: bigint, account: `0x${string}`) {
    const data = encodeFunctionData({
      abi: SUSDE_ABI,
      functionName: "withdraw",
      args: [amount, account, account]
    })

    return sendTx({
      to: sUSDe,
      data,
      account
    })
  },

  async getMarketData() {
    try {
      const sUSDe = ADDRESSES.stablecoin.ethena.sUSDe
      const [totalSupply] = await multicall(publicClient, {
        contracts: [
          { address: sUSDe as `0x${string}`, abi: [{ name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }], functionName: 'totalSupply', args: [] },
        ],
        allowFailure: false,
      })
      const tvl = totalSupply as bigint
      return { apy: 0, tvl }
    } catch (e) {
      console.warn('[Ethena] getMarketData failed:', e)
      return { apy: 0, tvl: 0n }
    }
  }
}
