import { stake } from '@/chain/stake'
import { getDefiLlamaPool } from './defillama'
import { createPublicDataCache, type PublicDataCache } from '@/utils/publicDataCache'

/**
 * Protocol official APY data source registry
 * * Principle: APY always takes the protocol official interface (historical/official caliber data);
 * The protocol that does not confirm the available official interface returns null, and the page displays' - '.
 * Do not use mock/config/on-chain exchange rate estimates as APY presentation sources.
 * * Confirmed available (interface measured)→:
 * - Lido: https://eth-api.lido.fi/v1/protocol/steth/apr/sma data.smaApr (7-day SMA, Apr, daily compounding APY)
 * - → RocketPool: https://api.rocketpool.net/api/apr yearlyAPR (Apr, daily compounding APY)
 * - StakeWise: https://api.stakewise.io/api/oseth-apy → plain digital text (official is APY, no conversion)
 * - mETH: https://app.methprotocol.xyz/api/stats/apy → data [0] .WeekAPY (7-day APY)
 * - Curve: → https://api.curve.finance/api/getSubgraphData/ethereum latestWeeklyApy for 3pool
 * * Protocol without public official interface (stader/etherfi/ethena) Go to DefiLlama yields (third-party aggregator, consistent with DefiLlama page diameter)
 */

interface ApySource {
  protocolId: string
  url?: string
  /** Cache time (ms) - APY changes slowly, 5 minutes is sufficient */
  ttl: number
  /** Extract APY % from response (e.g. 2.23), parse failure returns null */
  parser: (data: any) => number | null
  /** True if the response is plain text (not JSON) */
  rawText?: boolean
  /** Custom pull functions (e.g. DefiLlama pool data) with priority over url + parser */
  fetcher?: () => Promise<number | null>
  /**
 * The official interface returns Apr (%), which is displayed after converting to APY (%) according to the compounding frequency (times/year).
 * Leave blank to indicate that the interface itself is APY, not converted.
 */
  compoundingPerYear?: number
}

const SOURCES: Record<string, ApySource> = {
  lido: {
    protocolId: 'lido',
    url: 'https://eth-api.lido.fi/v1/protocol/steth/apr/sma',
    ttl: 5 * 60_000,
    // stETH daily rebase, official smaApr is APR → daily compound interest conversion APY
    compoundingPerYear: 365,
    parser: (data) => {
      const v = data?.data?.smaApr
      return typeof v === 'number' && v > 0 ? v : null
    },
  },
  rocketpool: {
    protocolId: 'rocketpool',
    url: 'https://api.rocketpool.net/api/apr',
    ttl: 5 * 60_000,
    // rETH exchange rate updated daily, official yearlyAPR is → Apr daily compound interest conversion APY
    compoundingPerYear: 365,
    parser: (data) => {
      const v = parseFloat(data?.yearlyAPR)
      return Number.isFinite(v) && v > 0 ? v : null
    },
  },
  stakewise: {
    protocolId: 'stakewise',
    url: 'https://api.stakewise.io/api/oseth-apy',
    ttl: 5 * 60_000,
    rawText: true,
    parser: (text: string) => {
      const v = parseFloat(text)
      return Number.isFinite(v) && v >= 0 ? v : null
    },
  },
  // The following three protocols have no public official APY interface, and DefiLlama yields are unified (consistent with DefiLlama page caliber)
  etherfi: {
    protocolId: 'etherfi',
    ttl: 5 * 60_000,
    fetcher: async () => (await getDefiLlamaPool('etherfi'))?.apy ?? null,
  },
  stader: {
    protocolId: 'stader',
    ttl: 5 * 60_000,
    // Stader official caliber is 30-day average APY (same as DefiLlama apyMean30d)
    fetcher: async () => (await getDefiLlamaPool('stader'))?.apyMean30d ?? null,
  },
  ethena: {
    protocolId: 'ethena',
    ttl: 5 * 60_000,
    fetcher: async () => (await getDefiLlamaPool('ethena'))?.apy ?? null,
  },
  meth: {
    protocolId: 'meth',
    url: 'https://app.methprotocol.xyz/api/stats/apy',
    ttl: 5 * 60_000,
    parser: (data) => {
      // data [0] is the latest record; WeekAPY is a decimal (0.01713 = 1.71%), × 100 rpm
      const v = parseFloat(data?.data?.[0]?.WeekAPY)
      return Number.isFinite(v) && v > 0 ? v * 100 : null
    },
  },
  curve: {
    protocolId: 'curve',
    url: 'https://api.curve.finance/api/getSubgraphData/ethereum',
    ttl: 5 * 60_000,
    parser: (data) => {
      const pool = (data?.data?.poolList || []).find(
        (p: any) => (p.address || '').toLowerCase() === '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7'
      )
      const v = pool?.latestWeeklyApy
      return typeof v === 'number' && v >= 0 ? v : null
    },
  },
}

const STORAGE_MAX_AGE = 7 * 24 * 60 * 60_000
const apyCaches = new Map<string, PublicDataCache<number | null>>()

function getApyCache(protocolId: string, ttlMs: number) {
  let cache = apyCaches.get(protocolId)
  if (!cache) {
    cache = createPublicDataCache<number | null>({
      key: `protocol-apy:${protocolId}`,
      ttlMs,
      maxAgeMs: STORAGE_MAX_AGE,
      isUsable: (value) => typeof value === 'number' && Number.isFinite(value),
    })
    apyCaches.set(protocolId, cache)
  }
  return cache
}

/**
 * Get Agreement Official APY (Percentage Number).
 * - no registration source/interface failure/parse failure → null (page display '-')
 * - with TTL cache + concurrent deduplication
 */
export async function getProtocolApy(protocolId: string): Promise<number | null> {
  const source = SOURCES[protocolId]
  if (!source) return null

  const cache = getApyCache(protocolId, source.ttl)
  return cache.get(async () => {
    try {
      let value: number | null = null
      if (source.fetcher) {
        value = await source.fetcher()
      } else {
        const res = await fetch(source.url!, { headers: { accept: 'application/json' } })
        if (!res.ok) {
          return null
        }
        const text = await res.text()
        value = source.rawText
          ? source.parser(text)
          : source.parser(JSON.parse(text))
      }
      // Official returns to Apr are converted to APY at compounding frequency (e.g. 2.20% Apr → (1+0.022/365) ^ 365-1 ≈ 2.22% APY)
      if (value !== null && source.compoundingPerYear) {
        const n = source.compoundingPerYear
        value = (Math.pow(1 + value / 100 / n, n) - 1) * 100
      }
      if (value === null) {
        return null
      }
      return value
    } catch (e) {
      console.warn(`[Apy] ${protocolId} 官方接口请求失败:`, e)
      return null
    }
  })
}

/**
 * Stake Protocol APY: Preferred official interface; falls back to on-chain derivation when there is no official interface (or the official app/document itself is on-chain caliber).
 * For example, mETH/Stader officially does not have an APY interface, but its exchange rate can be inferred, which is consistent with the official app display caliber.
 */
export async function getStakeApy(protocolId: string): Promise<number | null> {
  const official = await getProtocolApy(protocolId)
  if (official !== null) return official
  const adapter = stake.get(protocolId)
  if (!adapter?.getMarketData) return null
  try {
    const data = await adapter.getMarketData()
    return data && data.apy > 0 ? data.apy : null
  } catch {
    return null
  }
}

/** Clear APY cache (for debug/refresh) */
export function clearProtocolApyCache() {
  for (const cache of apyCaches.values()) cache.clear()
  apyCaches.clear()
}
