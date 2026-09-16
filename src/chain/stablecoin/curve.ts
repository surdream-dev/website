import { encodeFunctionData, getAddress } from "viem"
import { multicall } from "viem/actions"
import { ADDRESSES } from "../evm/addresses"
import { CURVE_POOL_ABI } from "../evm/abis"
import { sendTx } from "../core/tx"
import type { StakeAdapter } from "./base"

// Curve 3pool token index (for remove_liquidity_one_coin)
// DAI=0, USDC=1, USDT=2
const COIN_INDEX: Record<string, number> = {
  [ADDRESSES.tokens.DAI]: 0, // DAI
  [ADDRESSES.tokens.USDC]: 1, // USDC
  [ADDRESSES.tokens.USDT]: 2  // USDT
}

export const curve: StakeAdapter = {
  async deposit(amount, address, assetAddress?) {
    // Curve: Deposit stablecoins to 3pool
    // Determine the position in the amounts array based on the asset address
    const amounts: [bigint, bigint, bigint] = [0n, 0n, 0n]

    if (assetAddress) {
      const index = COIN_INDEX[getAddress(assetAddress)]
      if (index !== undefined) {
        amounts[index] = amount
      } else {
        // Unknown asset, first position by default
        amounts[0] = amount
      }
    } else {
      // No assetAddress, default Dai
      amounts[0] = amount
    }

    const data = encodeFunctionData({
      abi: CURVE_POOL_ABI,
      functionName: "add_liquidity",
      args: [amounts, 0]  // min_mint_amount = 0
    })

    return sendTx({
      to: ADDRESSES.curve.threePool,
      data,
      account: address
    })
  },

  // Alias: Compatible with stake calls
  async stake(amount, address, assetAddress?) {
    return this.deposit(amount, address, assetAddress)
  },

  async unstake(amount, address?, assetAddress?) {
    // Curve withdraw: use remove_liquidity_one_coin
    // Approve LP token not required
    if (!address) throw new Error("Account address is required")

    // Determine coin index based on asset address
    let coinIndex = 0  // Default Dai
    if (assetAddress) {
      const index = COIN_INDEX[getAddress(assetAddress)]
      if (index !== undefined) {
        coinIndex = index
      }
    }

    // min_amount = 0 (slippage allowed)
    const minAmount = 0n

    const data = encodeFunctionData({
      abi: CURVE_POOL_ABI,
      functionName: "remove_liquidity_one_coin",
      args: [amount, coinIndex, minAmount]
    })


    return sendTx({
      to: ADDRESSES.curve.threePool,
      data,
      account: address
    })
  },

  async claim(address?) {
    // Claim CRV rewards
    const data = encodeFunctionData({
      abi: CURVE_POOL_ABI,
      functionName: "claim_rewards"
    })

    return sendTx({
      to: ADDRESSES.curve.threePool,
      data,
      account: address
    })
  },

  async getMarketData() {
    // Curve Official rest: TVL (getPools usdTotal) + APY (getSubgraphData latestWeeklyApy)
    // Do not fallback on-chain (official API and on-chain are two sets of data sources with different calibers)
    try {
      const THREE_POOL = '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7'
      const [poolsRes, subgraphRes] = await Promise.all([
        fetch('https://api.curve.finance/v1/getPools/ethereum/main'),
        fetch('https://api.curve.finance/api/getSubgraphData/ethereum'),
      ])
      if (!poolsRes.ok || !subgraphRes.ok) {
        return { apy: 0, tvl: 0n }
      }
      const poolsJson = await poolsRes.json()
      const subgraphJson = await subgraphRes.json()

      const pools = poolsJson?.data?.poolData || []
      const pool = pools.find((p: any) => (p?.address || '').toLowerCase() === THREE_POOL)
      // TVL: Official usdTotal (e.g. 3pool ≈ $160m); go to 18 decimals bigint for unified page formatting
      const usdTotal = Number(pool?.usdTotal || 0)
      const tvl = usdTotal > 0 ? BigInt(Math.round(usdTotal * 1e18)) : 0n

      // APY: Official latestWeeklyApy (3pool without CRV incentive, official caliber is 0)
      const subgraphPool = (subgraphJson?.data?.poolList || []).find(
        (p: any) => (p?.address || '').toLowerCase() === THREE_POOL
      )
      const apy = typeof subgraphPool?.latestWeeklyApy === 'number' ? Math.max(subgraphPool.latestWeeklyApy, 0) : 0

      return { apy, tvl }
    } catch (e) {
      console.warn('[Curve] getMarketData failed:', e)
      return { apy: 0, tvl: 0n }
    }
  }
}
