/**
 * DefiLlama yields data source
 * * Usage: ether.fi/Stader/Ethena does not have a public official APY/TVL interface,
 * unified pull pool data (apy + tvlUsd) from DefiLlama yields, the caliber is the same as the DefiLlama page.
 * * Data interface:
 * - Pool data: get https://yields.llama.fi/chart/ {poolId}
 * Returns {status, data: [{timestamp, tvlUsd, apy, apyBase, apyReward,...}]}, take the latest one
 * - ETH price: get https://coins.llama.fi/prices/current/ethereum: 0x0000...
 * Returns {coins: {"ethereum: 0x0000...": {price}}} to convert USD TVL to ETH
 */

import { createPublicDataCache, type PublicDataCache } from '@/utils/publicDataCache'

export interface DefiLlamaPoolInfo {
  pool: string
  apy: number | null
  apyBase: number | null
  apyReward: number | null
  tvlUsd: number | null
  apyBase7d: number | null
  /** Arithmetic average of APY for the last 30 days (calculated from chart daily data, equivalent to apyMean30d of DefiLlama) */
  apyMean30d: number | null
}

/** Protocol → DefiLlama pool ID (Ethereum mainnet) */
const POOL_IDS: Record<string, string> = {
  etherfi: '46bd2bdf-6d92-4066-b482-e885ee172264', // ether.fi-stake / WEETH
  stader: '90bfb3c2-5d35-4959-a275-ba5085b08aa3', // stader / ETHX
  ethena: '66985a81-9c51-46ca-9977-42b4fe7bc6df', // ethena-usde / SUSDE
}

const ETH_PLACEHOLDER = '0x0000000000000000000000000000000000000000'
const CHART_TTL = 5 * 60_000
const PRICE_TTL = 5 * 60_000
const STORAGE_MAX_AGE = 7 * 24 * 60 * 60_000
const poolCaches = new Map<string, PublicDataCache<DefiLlamaPoolInfo | null>>()
const ethPriceCache = createPublicDataCache<number | null>({
  key: 'defillama-eth-price',
  ttlMs: PRICE_TTL,
  maxAgeMs: 24 * 60 * 60_000,
  isUsable: (value) => typeof value === 'number' && value > 0,
})

function getPoolCache(poolId: string) {
  let cache = poolCaches.get(poolId)
  if (!cache) {
    cache = createPublicDataCache<DefiLlamaPoolInfo | null>({
      key: `defillama-pool:${poolId}`,
      ttlMs: CHART_TTL,
      maxAgeMs: STORAGE_MAX_AGE,
      isUsable: (value) => value !== null,
    })
    poolCaches.set(poolId, cache)
  }
  return cache
}

/** Is the protocol configured with a DefiLlama pool */
export function hasDefiLlamaPool(protocolId: string): boolean {
  return protocolId in POOL_IDS
}

/** Get the latest pool data for the protocol at DefiLlama yields (with TTL cache + concurrent deduplication) */
export async function getDefiLlamaPool(protocolId: string): Promise<DefiLlamaPoolInfo | null> {
  const poolId = POOL_IDS[protocolId]
  if (!poolId) return null

  const cache = getPoolCache(poolId)
  return cache.get(async () => {
    try {
      const res = await fetch(`https://yields.llama.fi/chart/${poolId}`)
      if (!res.ok) {
        return null
      }
      const json = await res.json()
      const rows = json?.data
      const last = Array.isArray(rows) && rows.length > 0 ? rows[rows.length - 1] : null
      if (!last) {
        return null
      }
      const info: DefiLlamaPoolInfo = {
        pool: poolId,
        apy: typeof last.apy === 'number' ? last.apy : null,
        apyBase: typeof last.apyBase === 'number' ? last.apyBase : null,
        apyReward: typeof last.apyReward === 'number' ? last.apyReward : null,
        tvlUsd: typeof last.tvlUsd === 'number' ? last.tvlUsd : null,
        apyBase7d: typeof last.apyBase7d === 'number' ? last.apyBase7d : null,
        apyMean30d: null,
      }
      // APY average for the last 30 days (chart is one record per day, take the last 30 records as the arithmetic average)
      const last30 = rows.slice(-30).map((r: any) => r?.apy).filter((v: any) => typeof v === 'number')
      if (last30.length > 0) {
        info.apyMean30d = last30.reduce((a: number, b: number) => a + b, 0) / last30.length
      }
      return info
    } catch (e) {
      console.warn('[DefiLlama] 池数据请求失败:', e)
      return null
    }
  })
}

/** ETH current USD price (DefiLlama coins interface with TTL cache) */
export async function getEthPriceUsd(): Promise<number | null> {
  return ethPriceCache.get(async () => {
    try {
      const res = await fetch(`https://coins.llama.fi/prices/current/ethereum:${ETH_PLACEHOLDER}`)
      if (!res.ok) {
        return null
      }
      const json = await res.json()
      const price = json?.coins?.[`ethereum:${ETH_PLACEHOLDER}`]?.price
      return typeof price === 'number' && price > 0 ? price : null
    } catch (e) {
      console.warn('[DefiLlama] ETH 价格请求失败:', e)
      return null
    }
  })
}
