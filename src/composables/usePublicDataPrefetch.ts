/**
 * App-level public-data prefetch.
 *
 * The page code remains the reliable source of truth and always calls the data
 * functions it needs. This module only warms the shared caches in the background,
 * with low concurrency and a visibility-aware refresh cadence:
 * - prices: every ~60s
 * - APY / TVL / lending rates: every ~5min
 */
import { getLendingPrices } from './useLendingPrices'
import { getLendingRates } from './useLendingApy'
import { getStakeApy } from '@/api/apy'
import { getDefiLlamaPool, getEthPriceUsd } from '@/api/defillama'
import { getStablecoinApy, getStablecoinTvlUsd } from './useStablecoinData'
import { stake } from '@/chain/stake'
import { stakeProtocols, stablecoinProtocols, lendingProtocols } from '@/constants/protocols'

const PRICE_INTERVAL = 60_000
const PUBLIC_INTERVAL = 5 * 60_000
const CONCURRENCY = 2

let started = false
let priceTimer: ReturnType<typeof setTimeout> | null = null
let publicTimer: ReturnType<typeof setTimeout> | null = null
let lastPriceRun = 0
let lastPublicRun = 0
let publicRunInProgress = false

function jitter(base: number, spread: number): number {
  return base + Math.random() * spread
}

async function runTasks(tasks: Array<() => Promise<unknown>>): Promise<void> {
  let next = 0
  async function worker() {
    while (next < tasks.length) {
      const task = tasks[next++]
      try {
        await task()
      } catch (err) {
        console.warn('[PublicDataPrefetch] task failed:', err)
      }
    }
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => worker())
  await Promise.all(workers)
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(v => v.toLowerCase()))]
}

async function prefetchPrices(): Promise<void> {
  lastPriceRun = Date.now()
  await getLendingPrices().catch((err) => {
    console.warn('[PublicDataPrefetch] price prefetch failed:', err)
  })
}

async function prefetchPublicData(): Promise<void> {
  if (publicRunInProgress || typeof document !== 'undefined' && document.hidden) return
  publicRunInProgress = true
  lastPublicRun = Date.now()

  try {
    const tasks: Array<() => Promise<unknown>> = []

    // Lending pool rates are used by Home / Lending / Portfolio.
    const lendingIds = unique(lendingProtocols.map(p => p.protocolId))
    for (const pid of lendingIds) {
      tasks.push(() => getLendingRates(pid))
    }

    // Stake APY and TVL. getStakeApy already includes official + on-chain fallback.
    for (const meta of stakeProtocols) {
      const pid = meta.protocolId.toLowerCase()
      tasks.push(() => getStakeApy(pid))
      if (pid === 'etherfi' || pid === 'stader') {
        tasks.push(() => getDefiLlamaPool(pid))
      } else {
        tasks.push(async () => {
          const adapter = stake.get(pid)
          if (adapter?.getMarketData) await adapter.getMarketData()
        })
      }
    }

    // DefiLlama ETH price is used to convert ether.fi / Stader USD TVL back to ETH.
    tasks.push(() => getEthPriceUsd())

    // Stablecoin cards use the same routing as the Stablecoin page.
    for (const meta of stablecoinProtocols) {
      const pid = meta.protocolId.toLowerCase()
      if (pid === 'curve') continue
      tasks.push(() => getStablecoinApy(meta))
      tasks.push(() => getStablecoinTvlUsd(meta))
    }

    await runTasks(tasks)
  } finally {
    publicRunInProgress = false
  }
}

function schedulePrice(): void {
  if (!started) return
  if (priceTimer) clearTimeout(priceTimer)
  const due = lastPriceRun + PRICE_INTERVAL - Date.now()
  priceTimer = setTimeout(() => {
    if (typeof document !== 'undefined' && document.hidden) return
    void prefetchPrices().finally(schedulePrice)
  }, Math.max(1_000, jitter(due, 5_000)))
}

function schedulePublic(): void {
  if (!started) return
  if (publicTimer) clearTimeout(publicTimer)
  const due = lastPublicRun + PUBLIC_INTERVAL - Date.now()
  publicTimer = setTimeout(() => {
    if (typeof document !== 'undefined' && document.hidden) return
    void prefetchPublicData().finally(schedulePublic)
  }, Math.max(5_000, jitter(due, 30_000)))
}

function handleVisibility(): void {
  if (typeof document === 'undefined') return
  if (document.hidden) return
  // When the tab becomes visible again, immediately warm caches and reset timers.
  void prefetchPrices().finally(schedulePrice)
  void prefetchPublicData().finally(schedulePublic)
}

/** Call once at app startup. */
export function startPublicDataPrefetch(): void {
  if (started || typeof window === 'undefined') return
  started = true
  document.addEventListener('visibilitychange', handleVisibility)

  void prefetchPrices().finally(schedulePrice)
  void prefetchPublicData().finally(schedulePublic)
}
