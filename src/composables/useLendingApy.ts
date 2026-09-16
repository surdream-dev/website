/**
 * Unified on-chain Lending rate (APY) resolution
 * * All pages (Lending market / Portfolio ALL / Your Supplies / Assets to Supply / Asset to Borrow) share one cache; APY always comes from the protocol adapter's getMarketData()
 * (live on-chain data), avoiding page inconsistencies from mock/hardcoded metadata.
 */
import { lending } from '@/chain/lending'
import { createPublicDataCache, type PublicDataCache } from '@/utils/publicDataCache'
import { getPriceByAddress, type LendingPrices } from './useLendingPrices'

export interface LendingRateInfo {
  supplyAPY: number
  borrowAPY: number
  /** Pool total supply (wei, used by the TVL/Utilization columns on the Lending market page) */
  totalSupply?: bigint
  /** Pool total borrow (wei) */
  totalBorrow?: bigint
  /** Cross-asset pools (e.g. Fluid): total supply decimals (collateral decimals) */
  supplyDecimals?: number
  /** Across asset pools (e.g. Fluid): decimals of total borrowings */
  borrowDecimals?: number
  /** Cross-asset pools (e.g. Fluid): liquidity supply rate of the borrowed asset (fToken supplyRate) */
  liquidityAPY?: number
  /** Max LTV (%, live on-chain, from adapter getMarketData; callers fall back to config when missing) */
  maxLtv?: number
  /** Liquidation threshold (%, live on-chain) */
  liquidationThreshold?: number
  /** Liquidation penalty (%, live on-chain) */
  liquidationPenalty?: number
}

const CACHE_TTL = 5 * 60_000
const STORAGE_MAX_AGE = 7 * 24 * 60 * 60_000
const rateCaches = new Map<string, PublicDataCache<Map<string, LendingRateInfo> | undefined>>()

function getRateCache(protocolId: string) {
  const key = protocolId.toLowerCase()
  let cache = rateCaches.get(key)
  if (!cache) {
    cache = createPublicDataCache<Map<string, LendingRateInfo> | undefined>({
      key: `lending-rates:${key}`,
      ttlMs: CACHE_TTL,
      maxAgeMs: STORAGE_MAX_AGE,
      isUsable: (value) => value instanceof Map && value.size > 0,
    })
    rateCaches.set(key, cache)
  }
  return cache
}

async function fetchRates(
  protocolId: string,
  poolId?: string
): Promise<Map<string, LendingRateInfo> | undefined> {
  const adapter = lending.getByPool(poolId || protocolId || '')
  if (!adapter?.getMarketData) return undefined
  // Light retry: avoid degrading immediately on occasional on-chain read failures
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await adapter.getMarketData()
      const map = new Map<string, LendingRateInfo>()
      for (const info of data) {
        map.set(info.assetAddress.toLowerCase(), {
          supplyAPY: info.supplyAPY,
          borrowAPY: info.borrowAPY,
          totalSupply: info.totalSupply,
          totalBorrow: info.totalBorrow,
          supplyDecimals: info.supplyDecimals,
          borrowDecimals: info.borrowDecimals,
          liquidityAPY: info.liquidityAPY,
          maxLtv: info.maxLtv,
          liquidationThreshold: info.liquidationThreshold,
          liquidationPenalty: info.liquidationPenalty,
        })
      }
      // Treat empty results as failure (return undefined) so an empty Map is not cached and starves later pages
      return map.size > 0 ? map : undefined
    } catch (e) {
      if (attempt < 2) {
        const wait = 500 * 2 ** attempt
        console.warn(`[LendingApy] ${protocolId} getMarketData 失败，${wait}ms 后重试 (${attempt + 1}/3):`, e)
        await new Promise(r => setTimeout(r, wait))
      } else {
        console.warn(`[LendingApy] ${protocolId} getMarketData failed:`, e)
      }
    }
  }
  return undefined
}

/**
 * Get a protocol's rate table (assetAddress → {supplyAPY, borrowAPY}).
 * With caching + concurrent dedup; getMarketData is protocol-level, shared by all pools of the same protocol.
 */
export async function getLendingRates(
  protocolId: string,
  poolId?: string
): Promise<Map<string, LendingRateInfo> | undefined> {
  const cache = getRateCache(protocolId)
  return cache.get(() => fetchRates(protocolId, poolId))
}

/** Get the supply APY of an asset under a protocol */
export async function getLendingSupplyApy(
  protocolId: string,
  assetAddress?: string,
  poolId?: string
): Promise<number | undefined> {
  if (!assetAddress) return undefined
  const rates = await getLendingRates(protocolId, poolId)
  return rates?.get(assetAddress.toLowerCase())?.supplyAPY
}

/** Get the borrow APY of an asset under a protocol */
export async function getLendingBorrowApy(
  protocolId: string,
  assetAddress?: string,
  poolId?: string
): Promise<number | undefined> {
  if (!assetAddress) return undefined
  const rates = await getLendingRates(protocolId, poolId)
  return rates?.get(assetAddress.toLowerCase())?.borrowAPY
}

/** Clear the rate cache (call before re-fetching) */
export function clearLendingRatesCache() {
  for (const cache of rateCaches.values()) cache.clear()
  rateCaches.clear()
}

/**
 * Compute a pool's utilization (%, 0..100) — the same algorithm as the Lending market page
 * (views/Lending/index.vue), so every entry point opens the modal with identical values.
 * - Single-asset pools: totalBorrow × 100 / totalSupply (borrow/supply share decimals)
 * - Cross-asset pools (e.g. Fluid vault): collateral/borrow assets differ, convert both sides to USD then divide
 */
export function computeLendingUtilization(
  rate: LendingRateInfo | undefined,
  opts: { prices: LendingPrices; assetAddress: string; loanAssetAddress?: string; decimals?: number }
): number {
  if (!rate || !rate.totalSupply || rate.totalSupply <= 0n) return 0
  const { prices, assetAddress, loanAssetAddress, decimals = 18 } = opts
  // Empty string must fall back too (assets.vue passes pool.borrowAddress || '' which is '' for Aave/SparkLend);
  // default-param = assetAddress only triggers on undefined, not ''. Aave uses the asset's own address as loanAsset
  // (same as views/Lending/index.vue cross-asset rows) so USD conversion still resolves a price.
  const effectiveLoan = loanAssetAddress || assetAddress
  const supplyDec = rate.supplyDecimals ?? decimals
  const borrowDec = rate.borrowDecimals ?? decimals
  const isCrossAsset = rate.supplyDecimals !== undefined && rate.borrowDecimals !== undefined
  if (!isCrossAsset) {
    return Number(rate.totalBorrow * 100n / rate.totalSupply)
  }
  const supplyPrice = getPriceByAddress(prices, assetAddress)
  const borrowPrice = getPriceByAddress(prices, effectiveLoan)
  if (supplyPrice <= 0 || borrowPrice <= 0) return 0
  const supplyUsd = Number(rate.totalSupply) / 10 ** supplyDec * supplyPrice
  const borrowUsd = Number(rate.totalBorrow) / 10 ** borrowDec * borrowPrice
  return borrowUsd > 0 && supplyUsd > 0 ? borrowUsd / supplyUsd * 100 : 0
}
