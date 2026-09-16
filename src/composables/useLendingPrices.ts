/**
 * Lending live prices Composable
 * * Fetches real-time collateral prices purely from on-chain Chainlink Price Feeds,
 * used for health factor, borrow limit, and liquidation price.
 * * Sources: Chainlink (ETH/BTC/stETH/USDC/USDT/DAI in USD) + on-chain wstETH rate
 * Cache: 30s TTL, consistent with useBalance / gas.ts
 */

import { ref } from 'vue'
import { publicClient } from '@/chain/core/provider'
import { multicall } from 'viem/actions'
import { ADDRESSES } from '@/chain/evm/addresses'
import { createPublicDataCache } from '@/utils/publicDataCache'

// ============ Chainlink feed addresses (all prices are read on-chain) ============

const FEEDS = {
  ETH:   '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' as const,
  BTC:   '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c' as const,
  stETH: '0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8' as const,
  USDC:  '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6' as const,
  USDT:  '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D' as const,
  DAI:   '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9' as const,
}

const WSTETH_CONTRACT = ADDRESSES.tokens.wstETH as const

const CHAINLINK_AGGREGATOR_ABI = [
  {
    inputs: [],
    name: 'latestRoundData',
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

const WSTETH_ABI = [
  {
    inputs: [],
    name: 'stEthPerToken',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// ============ Cache (60s TTL + localStorage stale-while-revalidate) ============

const CACHE_TTL = 60_000
const STORAGE_MAX_AGE = 24 * 60 * 60_000
const priceCache = createPublicDataCache<LendingPrices>({
  key: 'prices',
  ttlMs: CACHE_TTL,
  maxAgeMs: STORAGE_MAX_AGE,
  isUsable: (p) => p.eth > 0 || p.btc > 0,
})

// ============ Types ============

export interface LendingPrices {
  /** ETH/USD price (e.g. 3500.25) */
  eth: number
  /** BTC/USD price */
  btc: number
  /** stETH/USD price (= ETH × stETH/ETH rate) */
  stEth: number
  /** wstETH/USD price (= stETH × stEthPerToken rate) */
  wstEth: number
  /** Stablecoin USD price (Chainlink feed, ≈1) */
  usdc: number
  usdt: number
  dai: number
  /** Timestamp of the last successful update (ms) */
  updatedAt: number
  /** Whether the data is stale */
  isStale: boolean
}

// ============ Utils ============

/** Read all prices from Chainlink on-chain */
async function fetchFromChainlink(): Promise<LendingPrices> {
  const now = Date.now()

  // Combine the 6 Chainlink feeds + wstETH rate into one multicall to reduce RPC requests
  const results = await multicall(publicClient, {
    contracts: [
      { address: FEEDS.ETH, abi: CHAINLINK_AGGREGATOR_ABI, functionName: 'latestRoundData' },
      { address: FEEDS.BTC, abi: CHAINLINK_AGGREGATOR_ABI, functionName: 'latestRoundData' },
      { address: FEEDS.stETH, abi: CHAINLINK_AGGREGATOR_ABI, functionName: 'latestRoundData' },
      { address: FEEDS.USDC, abi: CHAINLINK_AGGREGATOR_ABI, functionName: 'latestRoundData' },
      { address: FEEDS.USDT, abi: CHAINLINK_AGGREGATOR_ABI, functionName: 'latestRoundData' },
      { address: FEEDS.DAI, abi: CHAINLINK_AGGREGATOR_ABI, functionName: 'latestRoundData' },
      { address: WSTETH_CONTRACT, abi: WSTETH_ABI, functionName: 'stEthPerToken' },
    ],
    allowFailure: true,
  })

  const ethFeed = results[0]?.status === 'success'
    ? results[0].result as [bigint, bigint, bigint, bigint, bigint]
    : null
  const btcFeed = results[1]?.status === 'success'
    ? results[1].result as [bigint, bigint, bigint, bigint, bigint]
    : null
  const stEthFeed = results[2]?.status === 'success'
    ? results[2].result as [bigint, bigint, bigint, bigint, bigint]
    : null
  const usdcFeed = results[3]?.status === 'success'
    ? results[3].result as [bigint, bigint, bigint, bigint, bigint]
    : null
  const usdtFeed = results[4]?.status === 'success'
    ? results[4].result as [bigint, bigint, bigint, bigint, bigint]
    : null
  const daiFeed = results[5]?.status === 'success'
    ? results[5].result as [bigint, bigint, bigint, bigint, bigint]
    : null
  const wstEthRateRaw = results[6]?.status === 'success'
    ? results[6].result as bigint
    : null

  const eth = ethFeed ? Number(ethFeed[1]) / 1e8 : 0
  const btc = btcFeed ? Number(btcFeed[1]) / 1e8 : 0
  const usdc = usdcFeed ? Number(usdcFeed[1]) / 1e8 : 0
  const usdt = usdtFeed ? Number(usdtFeed[1]) / 1e8 : 0
  const dai = daiFeed ? Number(daiFeed[1]) / 1e8 : 0
  const wstEthRate = wstEthRateRaw ? Number(wstEthRateRaw) / 1e18 : 1
  // FEEDS.stETH is the stETH/USD price feed (8 decimals, e.g. 2343.46), so its USD
  // price is the feed value directly — NOT eth × feed (that would double-count the
  // price). wstETH = stETH/USD × stEthPerToken rate. If the stETH feed fails, fall
  // back to the ETH price as a close approximation.
  const stEthUsd = stEthFeed ? Number(stEthFeed[1]) / 1e8 : eth
  const wstEthUsd = (stEthUsd > 0 ? stEthUsd : eth) * wstEthRate

  const twoHoursAgo = Math.floor(now / 1000) - 7200
  const isStale =
    (ethFeed ? Number(ethFeed[3]) < twoHoursAgo : true) ||
    (btcFeed ? Number(btcFeed[3]) < twoHoursAgo : true) ||
    (stEthFeed ? Number(stEthFeed[3]) < twoHoursAgo : true)

  return {
    eth,
    btc,
    stEth: stEthUsd,
    wstEth: wstEthUsd,
    usdc,
    usdt,
    dai,
    updatedAt: now,
    isStale,
  }
}

// = = = = = = = = = = = = Core functions = = = = = = = = = = = = =

/**
 * Get all live prices needed by Lending — purely on-chain.
 * Reads Chainlink feeds (+ wstETH rate) in a single multicall. On failure it returns
 * empty prices instead of throwing, so the caller's whole data flow keeps working.
 */
async function fetchLendingPrices(): Promise<LendingPrices> {
  try {
    return await fetchFromChainlink()
  } catch (e) {
    console.warn('[LendingPrices] Chainlink 读取失败，返回空价格:', e)
    return {
      eth: 0, btc: 0, stEth: 0, wstEth: 0,
      usdc: 0, usdt: 0, dai: 0,
      updatedAt: Date.now(), isStale: true,
    }
  }
}

/** Get all live prices needed by Lending with shared in-memory and persisted SWR caching. */
export async function getLendingPrices(): Promise<LendingPrices> {
  return priceCache.get(fetchLendingPrices)
}

// ============ Vue Composable ============

/**
 * Vue Composable: get live Lending prices
 * * @example
 * ```ts
 * const { prices, loading, error, refresh } = useLendingPrices()
 * // reactive usage
 * watch(prices, () => { ... })
 * // manual refresh
 * await refresh()
 * ```
 */
export function useLendingPrices() {
  const prices = ref<LendingPrices>({
    eth: 0,
    btc: 0,
    stEth: 0,
    wstEth: 0,
    usdc: 1,
    usdt: 1,
    dai: 1,
    updatedAt: 0,
    isStale: false,
  })
  const loading = ref(true)
  const error = ref<string | null>(null)

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const result = await getLendingPrices()
      prices.value = result
    } catch (err: any) {
      console.error('[useLendingPrices] Failed to fetch prices:', err)
      error.value = err.message || 'Failed to fetch lending prices'
      // Keep the previous prices instead of overwriting, to avoid UI flicker
    } finally {
      loading.value = false
    }
  }

  // Refresh immediately
  refresh()

  return {
    /** Current prices (reactive) */
    prices,
    /** Whether it is loading */
    loading,
    /** Error message */
    error,
    /** Manual refresh */
    refresh,
  }
}

// ============ Convenience utils ============

/**
 * Get the USD price by asset address (for total collateral value)
 * * @param prices current LendingPrices
 * @param assetAddress asset contract address
 * @returns USD price
 */
export function getPriceByAddress(
  prices: LendingPrices,
  assetAddress: string
): number {
  const addr = assetAddress.toLowerCase()

  // ETH / WETH
  if (
    addr === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ||
    addr === ADDRESSES.tokens.WETH.toLowerCase()
  ) {
    return prices.eth
  }

  // stETH
  if (addr === ADDRESSES.tokens.stETH.toLowerCase()) {
    return prices.stEth
  }

  // wstETH
  if (addr === ADDRESSES.tokens.wstETH.toLowerCase()) {
    return prices.wstEth
  }

  // WBTC / tBTC / sBTC
  if (
    addr === ADDRESSES.tokens.WBTC.toLowerCase() ||  // WBTC
    addr === '0x18084fba666a33d37592fa2633fd49a74dd93a88'     // tBTC
  ) {
    return prices.btc
  }

  // Stablecoins (Chainlink feed value, ≈1)
  if (addr === ADDRESSES.tokens.USDC.toLowerCase()) return prices.usdc
  if (addr === ADDRESSES.tokens.USDT.toLowerCase()) return prices.usdt
  if (addr === ADDRESSES.tokens.DAI.toLowerCase()) return prices.dai

  return 0
}
