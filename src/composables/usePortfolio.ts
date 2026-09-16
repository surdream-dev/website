/**
 * Portfolio Composable
 * Wraps Portfolio mock data calls
 */

import { ref, computed, onMounted, watch, onScopeDispose } from 'vue'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { lending } from '@/chain/lending'
import { publicClient } from '@/chain/core/provider'
import { ADDRESSES } from '@/chain/evm/addresses'
import { getPriceByAddress, getLendingPrices, type LendingPrices } from './useLendingPrices'
import { getLendingRates } from './useLendingApy'
import { getProtocolApy, getStakeApy } from '@/api/apy'
import { getDefiLlamaPool, getEthPriceUsd } from '@/api/defillama'
import { stake } from '@/chain/stake'
import { formatUnits } from 'viem'
import {
  type PortfolioSummary,
  type PortfolioPosition,
  type PortfolioTransaction,
  type LendingPositionInfo
} from '@/types/portfolio'
import { getPortfolioSummary, getPortfolioPositions, getPortfolioTransactions } from '@/api/portfolio'
import { lendingProtocols, lendingPools, getUniqueLendingProtocols, getStablecoinPoolId, PROTOCOL_DISPLAY_NAMES } from '@/constants/protocols'
import { toast } from '@/utils/toast'

// Reactive access token state
const accessToken = ref<string | null>(localStorage.getItem('surdream_access_token'))

// Staking row TVL source convention (same as Stake page fetchData):
// On-chain adapter getMarketData first; ether.fi/Stader use DefiLlama (USD → ETH conversion).
const DEFI_LLAMA_TVL_PROTOCOLS = ['etherfi', 'stader']
const ETH_ONE = 10n ** 18n
/** Format an ETH bigint as "X,XXX.XXX ETH" (same as Stake page formatEthTvl) for modals/lists */
function formatEthTvl(tvlEth: bigint): string {
  const whole = tvlEth / ETH_ONE
  const frac = (tvlEth % ETH_ONE).toString().padStart(18, '0').slice(0, 3)
  return whole.toLocaleString('en-US') + '.' + frac + ' ETH'
}

/**
 * Protocol ID → canonical brand display name (case-insensitive, covers lending/staking/stablecoin).
 * Backend protocol names may be inconsistent (aave/AAVE/compound…); map them all to our canonical names.
 */
function protocolDisplayName(protocolId: string): string {
  const pid = (protocolId || '').toLowerCase().split('-')[0]
  return PROTOCOL_DISPLAY_NAMES[pid] || protocolId
}

/**
 * Minimum balance of 0 fallback: the backend may return negatives (e.g. balance=-x after mETH unstake);
 * clamp to 0 in the UI to avoid negative balances.
 */
function clampNonNegativeBalance(value: string | number | undefined, isUsd = false): string {
  if (value === undefined || value === null || value === '') return isUsd ? '$0.00' : '0'
  const str = String(value)
  const isNegative = /^-\$/.test(str) || /^-[\d.,]/.test(str)
  if (!isNegative) return str
  return isUsd ? '$0.00' : '0'
}

// Decimals of common mainnet assets (avoid one decimals query per position to reduce RPC)
const KNOWN_DECIMALS: Record<string, number> = {
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': 18,
  [ADDRESSES.tokens.WETH.toLowerCase()]: 18,
  [ADDRESSES.tokens.wstETH.toLowerCase()]: 18,
  [ADDRESSES.tokens.WBTC.toLowerCase()]: 8,
  [ADDRESSES.tokens.USDC.toLowerCase()]: 6,
  [ADDRESSES.tokens.USDT.toLowerCase()]: 6,
  [ADDRESSES.tokens.DAI.toLowerCase()]: 18,
}

/**
 * Rate tables match by asset address, supporting ETH placeholder ↔ WETH:
 * Aave/fluid collateral uses the 0xEeee placeholder; Fluid loan assets use the WETH address as the key.
 */
function lookupRateMap(
  rates: Map<string, { supplyAPY: number; borrowAPY: number }> | undefined,
  addr?: string
) {
  if (!rates || !addr) return undefined
  const ETH = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  const WETH = ADDRESSES.tokens.WETH.toLowerCase()
  const a = addr.toLowerCase()
  const candidates = [a]
  if (a === ETH) candidates.push(WETH)
  if (a === WETH) candidates.push(ETH)
  for (const c of candidates) {
    const v = rates.get(c)
    if (v) return v
  }
  return undefined
}

/**
 * Determine whether a row is a lending protocol position (independent of the backend category field):
 * treat it as a lending row whenever the lending registry has the protocol adapter and it implements getMarketData.
 */
function isLendingProtocolRow(row: any): boolean {
  const pid = (row.protocolId || row.poolId || '').split('-')[0].toLowerCase()
  if (!pid) return false
  const adapter = lending.get(pid) || lending.getByPool(row.poolId || pid || '')
  return !!adapter?.getMarketData
}

/**
 * Resolve the canonical lending asset address from config (fallback when backend rows lack assetAddress).
 * Prefer lendingProtocols metadata, then the lendingPools collateral/borrow/liquidity asset lists.
 */
function resolveLendingAssetAddress(protocolId: string, asset: string): string {
  const pid = (protocolId || '').toLowerCase()
  const sym = (asset || '').toLowerCase()
  const proto = lendingProtocols.find(p =>
    p.protocolId.toLowerCase() === pid && (p.asset || '').toLowerCase() === sym
  )
  if (proto?.assetAddress) return proto.assetAddress.toLowerCase()
  const pool = lendingPools.find(p => p.protocolId.toLowerCase() === pid)
  const all = [
    ...(pool?.collateralAssets || []),
    ...(pool?.borrowAssets || []),
    ...(pool?.liquidityAssets || []),
  ]
  const hit = all.find(a => (a.symbol || '').toLowerCase() === sym)
  return hit?.address?.toLowerCase() || ''
}

// Watch storage events (cross-tab sync)
window.addEventListener('storage', (e) => {
  if (e.key === 'surdream_access_token') {
    accessToken.value = e.newValue
  }
})

// Manually update the token (for external callers)
export function updateAccessToken() {
  accessToken.value = localStorage.getItem('surdream_access_token')
}

/**
 * Fetch Portfolio summary
 * Loads only after the user connects a wallet and signs in
 */
export function usePortfolioSummary() {
  const walletStore = useWalletStore()
  const { isConnected } = storeToRefs(walletStore)

  const summary = ref<PortfolioSummary | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Check whether logged in (reactive)
  const isLoggedIn = computed(() => {
    return isConnected.value && !!accessToken.value
  })

  async function fetchSummary(background = false) {
    // Do not load data when not logged in
    if (!isLoggedIn.value) {
      summary.value = null
      return
    }

    if (!background) {
      loading.value = true
      error.value = null
    }

    try {
      const data = await getPortfolioSummary()
      summary.value = data
    } catch (e: any) {
      console.warn('[Portfolio] fetchSummary: load failed', e)
      // 后台轮询失败：保留现有数据、不弹 toast，避免每分钟弹一次
      if (!background) {
        summary.value = null
        error.value = e.message || 'Failed to fetch portfolio summary'
        toast.show('API connection error, please try again later', 'error')
      }
    } finally {
      if (!background) loading.value = false
    }
  }

  // 60s 后台轮询：登录后定时刷新后端汇总数据，登出/卸载时停止
  const POLL_INTERVAL_MS = 60 * 1000
  let pollTimer: ReturnType<typeof setInterval> | null = null
  function startPolling() {
    stopPolling()
    pollTimer = setInterval(() => {
      if (isLoggedIn.value) fetchSummary(true)
    }, POLL_INTERVAL_MS)
  }
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
  onScopeDispose(stopPolling)

  // Watch login state changes
  watch(isLoggedIn, (loggedIn) => {
    if (loggedIn) {
      fetchSummary()
      startPolling()
    } else {
      stopPolling()
      summary.value = null
    }
  }, { immediate: true })

  return {
    summary,
    loading,
    error,
    isLoggedIn,
    refetch: fetchSummary
  }
}

/**
 * Fetch Portfolio positions
 * Loads only after the user connects a wallet and signs in
 */
export function usePortfolioPositions(
  initialCategory?: string,
  filters?: {
    keyword?: () => string
    protocols?: () => string[]
    /** Exclude borrow/liability rows from the result (Earnings page only shows supplied/earned positions) */
    excludeBorrow?: boolean
  },
) {
  const walletStore = useWalletStore()
  const { isConnected } = storeToRefs(walletStore)

  const positions = ref<PortfolioPosition[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const category = ref<string>(initialCategory || '')
  const protocol = ref<string>('')
  const page = ref(1)
  const pageSize = ref(7)
  const total = ref(0)

  // Server-side filters (reactive getters from the view props)
  const keyword = computed(() => filters?.keyword?.() ?? '')
  const protocols = computed(() => filters?.protocols?.() ?? [])

  // Check whether logged in (using reactive accessToken)
  const isLoggedIn = computed(() => {
    return isConnected.value && !!accessToken.value
  })

  // Stable key for matching a backend row to an already-loaded (enriched) row during a background poll,
  // so we can update balance/earnings without losing the on-chain APY/TVL already fetched on the foreground load.
  function positionKey(row: any): string {
    const pid = (row.protocolId || row.poolId || '').split('-')[0].toLowerCase()
    const cat = String(row.category || row.type || '')
    const asset = String(row.asset || '').toLowerCase()
    const poolId = String(row.poolId || '')
    const type = String(row.type || '')
    return `${pid}|${poolId}|${asset}|${cat}|${type}`
  }

  async function fetchPositions(append = false, background = false) {
    // Do not load data when not logged in
    if (!isLoggedIn.value) {
      positions.value = []
      total.value = 0
      return
    }

    if (!background) {
      loading.value = true
      error.value = null
    }

    try {
      const params: Record<string, any> = {
        page: page.value,
        pageSize: pageSize.value
      }
      if (category.value) params.category = category.value
      if (protocol.value) params.protocol = protocol.value
      if (keyword.value?.trim()) params.keyword = keyword.value.trim()
      // Backend accepts protocol as comma-joined or repeated params (URLSearchParams joins arrays with commas)
      if (protocols.value?.length) params.protocol = protocols.value
      // Earnings page does not show liabilities: ask the backend to omit borrow rows
      if (filters?.excludeBorrow) params.excludeBorrow = true

      const res = await getPortfolioPositions(params)
      total.value = res.pagination?.total || 0
      const list = res.list || []
      // Hide Curve (almost no revenue, no product display)
      const visibleList = list.filter(
        (row: any) => (row.protocolId || row.poolId || '').split('-')[0].toLowerCase() !== 'curve'
      ).map((row: any) => {
        // For pooled protocols (morpho/fluid/compound), force the correct poolId by asset on USDC/USDT rows:
        // Backend rows may lack a poolId or return the protocol-level 'morpho' — both cases make withdraw's
        // getSupplyBalance misread vault liquidity as Morpho Blue collateral and return 0 (the real balance sits in the
        // Gauntlet/Sky vaults). Here we uniformly override to morpho-usdc/morpho-usdt/fluid-*/compound-*.
        const basePid = (row.protocolId || row.poolId || '').split('-')[0].toLowerCase()
        const isStablePool = ['morpho', 'fluid', 'compound'].includes(basePid)
        // Only override supply/liquidity rows; keep the backend poolId on borrow rows to avoid affecting Borrow/Repay market selection
        const isBorrowRow =
          row.category === 'lending-borrow' || row.type === 'borrow' || row.side === 'borrow'
        // Pooled protocol supply/liquidity rows: prefer mapping the backend poolId (e.g. 'usdc') to the frontend format
        // (compound-usdc/morpho-usdc/fluid-eth). Do not pick the pool by asset symbol alone: the same asset can
        // appear in multiple pools (e.g. ETH is collateral in the compound-usdc pool but liquidity in the compound-eth pool),
        // ignoring the backend poolId misroutes the pool and makes Withdraw show a 0 balance (Plane #56).
        // Only fall back to the asset symbol when the backend poolId is missing or protocol-level (morpho/compound/fluid).
        const KNOWN_POOL_ASSETS = ['usdc', 'usdt', 'eth']
        let poolId: string
        if (isStablePool && !isBorrowRow) {
          const backendPoolId = String(row.poolId || '').toLowerCase()
          const mapped = backendPoolId.includes('-')
            ? backendPoolId
            : KNOWN_POOL_ASSETS.includes(backendPoolId) ? `${basePid}-${backendPoolId}` : ''
          poolId = mapped || getStablecoinPoolId(row.protocolId || '', row.asset || '')
        } else {
          poolId = String(row.poolId || '') || getStablecoinPoolId(row.protocolId || '', row.asset || '')
        }
        return {
          ...row,
          poolId,
          // Minimum balance of 0 fallback (prevent negative display after unstake)
          balance: clampNonNegativeBalance(row.balance),
          balanceUsd: clampNonNegativeBalance(row.balanceUsd, true),
          earnings: clampNonNegativeBalance(row.earnings),
          earningsUsd: clampNonNegativeBalance(row.earningsUsd, true),
        }
      })

      // 后台轻量刷新：只调 /portfolio/positions 后端接口，更新 balance/earnings 等易变字段，
      // 不重新拉取链上 APY/TVL（保留已加载行的 apy/tvl 值）
      if (background) {
        const enrichedByKey = new Map<string, any>()
        for (const row of positions.value) enrichedByKey.set(positionKey(row), row)
        positions.value = visibleList.map((row: any) => {
          const existing = enrichedByKey.get(positionKey(row))
          return existing
            ? { ...existing, ...row, apy: existing.apy, apyFormatted: existing.apyFormatted, tvl: existing.tvl }
            : row
        })
        return
      }

      // Position APY unified overrides:
      // - lending rows → live on-chain rates (same source as other pages)
      // - staking / stablecoin rows → official protocol APY (no official API → '-')
      const mappedList = await Promise.all(visibleList.map(async (rawRow: any) => {
        // Backend protocol name fallback: map every row to canonical casing by protocolId (AAVE/Compound/Morpho/…),
        // avoiding inconsistent backend names like aave/AAVE/compound
        const row = { ...rawRow, protocol: protocolDisplayName(rawRow.protocolId || rawRow.poolId || '') }
        // lending rows: do not rely on exact backend category matching; determine by the protocol adapter;
        // APY always comes from live on-chain/GraphQL data; a missing backend apy field does not matter.
        if (isLendingProtocolRow(row)) {
          const pid = (row.protocolId || row.poolId || '').split('-')[0].toLowerCase()
          const isBorrow =
            row.category === 'lending-borrow' || row.type === 'borrow' || row.side === 'borrow'
          // Asset address: prefer the row value; resolve from config by (protocol, asset symbol) when missing
          const assetAddr =
            (row.assetAddress || '').toLowerCase() || resolveLendingAssetAddress(pid, row.asset)
          const rates = await getLendingRates(pid, row.poolId)
          // ETH/WETH compatibility: Aave/SparkLend ETH reserves live under the WETH address,
          // adapter output keys keep the 0xEeee placeholder; backend rows may use either, so try both directions.
          const ETH_PLACEHOLDER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
          const WETH_ADDR = ADDRESSES.tokens.WETH.toLowerCase()
          const candidates = assetAddr
            ? [assetAddr, assetAddr === WETH_ADDR ? ETH_PLACEHOLDER : assetAddr === ETH_PLACEHOLDER ? WETH_ADDR : '']
            : []
          let rate: any
          for (const c of candidates) {
            rate = rates?.get(c)
            if (rate) break
          }
          // Missing on-chain → explicit '-' (do not keep the backend static value)
          if (!rate) return { ...row, apy: undefined, apyFormatted: '-' }
          // Compound V3: only pool base assets (USDC/USDT/WETH) earn supply interest,
          // collateral (ETH/WBTC/wstETH etc.) has no APY → show '-'.
          // Cannot rely on ETH→WETH normalization: an ETH collateral row in the USDC pool would be misrouted to the
          // cometWETH base asset rate (same root cause as Plane #56).
          if (pid === 'compound' && !isBorrow) {
            const poolMeta = lendingPools.find(p => p.poolId === (row.poolId || ''))
            const isBaseAsset = !!poolMeta?.liquidityAssets?.some(a =>
              (a.symbol || '').toLowerCase() === String(row.asset || '').toLowerCase() ||
              (a.address || '').toLowerCase() === assetAddr
            )
            if (!isBaseAsset) return { ...row, apy: undefined, apyFormatted: '-' }
          }
          // Liquidity rows (Fluid/Morpho stablecoin vault positions) prefer liquidityAPY
          // (fToken rate / vault netApy) over the vault collateral supply rate (supplyAPY)
          const isLiquidityRow =
            row.type === 'vault' ||
            row.category === 'lending-liquidity' ||
            row.category === 'stablecoin'
          const apy = isBorrow
            ? rate.borrowAPY
            : (isLiquidityRow ? (rate.liquidityAPY ?? rate.supplyAPY) : rate.supplyAPY)
          return {
            ...row,
            apy,
            apyFormatted: apy > 0 ? apy.toFixed(2) + '%' : '-',
          }
        }
        if (row.category === 'staking') {
          const apy = await getStakeApy(row.protocolId)
          const staked: any = apy === null
            ? { ...row, apy: undefined, apyFormatted: '-' }
            : { ...row, apy, apyFormatted: apy.toFixed(2) + '%' }
          // TVL: on-chain adapter first; ether.fi/Stader use DefiLlama (USD → ETH conversion);
          // keep '-' on failure without affecting other fields (Plane #69: Portfolio modal TVL not showing)
          try {
            let tvlEth: bigint | null = null
            const adapter = stake.get(row.protocolId)
            if (DEFI_LLAMA_TVL_PROTOCOLS.includes(row.protocolId)) {
              const pool = await getDefiLlamaPool(row.protocolId)
              const ethPrice = await getEthPriceUsd()
              if (pool?.tvlUsd && ethPrice && ethPrice > 0) {
                tvlEth = BigInt(Math.round((pool.tvlUsd / ethPrice) * 1e18))
              }
            }
            if (tvlEth === null && adapter?.getMarketData) {
              const cd = await adapter.getMarketData()
              if (cd && cd.tvl > 0n) tvlEth = cd.tvl
            }
            if (tvlEth !== null) staked.tvl = formatEthTvl(tvlEth)
          } catch (e) {
            console.warn(`[Portfolio] ${row.protocolId} TVL 获取失败:`, e)
          }
          return staked
        }
        if (row.category === 'stablecoin') {
          const apy = await getProtocolApy(row.protocolId)
          if (apy === null) return { ...row, apy: undefined, apyFormatted: '-' }
          return { ...row, apy, apyFormatted: apy.toFixed(2) + '%' }
        }
        return row
      }))
      // Append mode: keep loaded pages when mobile scrolls indefinitely, do not replace
      positions.value = append ? [...positions.value, ...mappedList] : mappedList
    } catch (e: any) {
      console.warn('[Portfolio] fetchPositions: load failed', e)
      // 后台轮询失败：保留现有数据、不弹 toast
      if (!background) {
        positions.value = []
        total.value = 0
        error.value = e.message || 'Failed to fetch positions'
        toast.show('API connection error, please try again later', 'error')
      }
    } finally {
      if (!background) loading.value = false
    }
  }

  function setFilter(newCategory?: string, newProtocol?: string) {
    if (newCategory) category.value = newCategory
    if (newProtocol) protocol.value = newProtocol
    fetchPositions()
  }

  // 60s 后台轮询：登录后定时轻量刷新持仓（只更新后端 balance/earnings，不拉链上 APY/TVL），
  // 登出/卸载时停止；仅在第一页刷新，避免打断移动端已加载的多页数据
  const POLL_INTERVAL_MS = 60 * 1000
  let pollTimer: ReturnType<typeof setInterval> | null = null
  function startPolling() {
    stopPolling()
    pollTimer = setInterval(() => {
      if (isLoggedIn.value && page.value === 1 && !loadMoreLock.value && !loading.value) {
        fetchPositions(false, true)
      }
    }, POLL_INTERVAL_MS)
  }
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
  onScopeDispose(stopPolling)

  // Watch login state changes; load data automatically after login
  watch(isLoggedIn, (loggedIn) => {
    if (loggedIn) {
      fetchPositions()
      startPolling()
    } else {
      // Clear data on logout
      stopPolling()
      positions.value = []
      total.value = 0
    }
  }, { immediate: true })

  // Infinite scrolling on mobile: load next page and append to existing data
  const loadMoreLock = ref(false)
  async function loadMore() {
    if (loadMoreLock.value || loading.value || !isLoggedIn.value) return
    // There are more pages to load when the server is paginated; the full amount of local data is displayed by the view itself
    if (total.value <= 0 || page.value >= Math.ceil(total.value / pageSize.value)) return
    loadMoreLock.value = true
    try {
      page.value += 1
      await fetchPositions(true)
    } finally {
      loadMoreLock.value = false
    }
  }

  // Request again when the page number changes (loadMore has been appended internally, skip here to avoid duplicate requests)
  watch(page, (newPage, oldPage) => {
    if (newPage !== oldPage && isLoggedIn.value && !loadMoreLock.value) {
      fetchPositions()
    }
  })

  // When search keyword / protocol filter changes, refetch from page 1 (server-side global filter)
  watch([keyword, protocols], () => {
    if (!isLoggedIn.value) return
    if (page.value === 1) {
      fetchPositions()
    } else {
      page.value = 1 // watch(page) triggers a single refetch
    }
  })

  return {
    positions,
    loading,
    error,
    total,
    page,
    pageSize,
    category,
    protocol,
    keyword,
    protocols,
    isLoggedIn,
    loadMore,
    setFilter,
    refetch: fetchPositions
  }
}

/** Fetch Portfolio transaction records. Filters are passed to the backend so search/protocol filter across ALL pages. */
export function usePortfolioTransactions(args?: {
  keyword?: () => string
  protocols?: () => string[]
}) {
  const transactions = ref<PortfolioTransaction[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const page = ref(1)
  const pageSize = ref(7)
  const total = ref(0)

  // Server-side filters (reactive getters from the view props)
  const keyword = computed(() => args?.keyword?.() ?? '')
  const protocols = computed(() => args?.protocols?.() ?? [])

  async function fetchTransactions(append = false, background = false) {
    if (!background) {
      loading.value = true
      error.value = null
    }

    try {
      const params: Record<string, any> = {
        page: page.value,
        pageSize: pageSize.value
      }
      if (keyword.value?.trim()) params.keyword = keyword.value.trim()
      // Backend accepts protocol as comma-joined or repeated params (URLSearchParams joins arrays with commas)
      if (protocols.value?.length) params.protocol = protocols.value
      const res = await getPortfolioTransactions(params)
      const mapped = (res.list || []).map((tx: any) => ({
        ...tx,
        // Backend protocol name fallback: map to canonical casing
        protocol: protocolDisplayName(tx.protocolId || tx.protocol || ''),
        date: tx.date || (tx.timestamp ? new Date(tx.timestamp * 1000).toLocaleString() : '')
      }))
      // Append mode: keep loaded pages when mobile scrolls indefinitely, do not replace
      transactions.value = append ? [...transactions.value, ...mapped] : mapped
      total.value = res.pagination?.total || 0
    } catch (e: any) {
      console.warn('[Portfolio] fetchTransactions: load failed', e)
      // 后台轮询失败：保留现有数据、不弹 toast
      if (!background) {
        transactions.value = []
        total.value = 0
        error.value = e.message || 'Failed to fetch transactions'
        toast.show('API connection error, please try again later', 'error')
      }
    } finally {
      if (!background) loading.value = false
    }
  }

  // Infinite scrolling on mobile: load next page and append to existing data
  const loadMoreLock = ref(false)
  async function loadMore() {
    if (loadMoreLock.value || loading.value) return
    // There are more pages to load when the server is paginated; the full amount of local data is displayed by the view itself
    if (total.value <= 0 || page.value >= Math.ceil(total.value / pageSize.value)) return
    loadMoreLock.value = true
    try {
      page.value += 1
      await fetchTransactions(true)
    } finally {
      loadMoreLock.value = false
    }
  }

  // Request again when the page number changes (loadMore has been appended internally, skip here to avoid duplicate requests)
  watch(page, (newPage, oldPage) => {
    if (newPage !== oldPage && !loadMoreLock.value) {
      fetchTransactions()
    }
  })

  // When search keyword / protocol filter changes, refetch from page 1 (server-side global filter)
  watch([keyword, protocols], () => {
    if (page.value === 1) {
      fetchTransactions()
    } else {
      page.value = 1 // watch(page) triggers a single refetch
    }
  })

  // 60s 后台轮询：挂载后定时刷新交易记录，卸载时停止；
  // 仅在第一页刷新，避免打断移动端已加载的多页数据
  const POLL_INTERVAL_MS = 60 * 1000
  let pollTimer: ReturnType<typeof setInterval> | null = null
  function startPolling() {
    stopPolling()
    pollTimer = setInterval(() => {
      if (page.value === 1 && !loadMoreLock.value && !loading.value) {
        fetchTransactions(false, true)
      }
    }, POLL_INTERVAL_MS)
  }
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
  onScopeDispose(stopPolling)

  onMounted(() => {
    fetchTransactions()
    startPolling()
  })

  return {
    transactions,
    loading,
    error,
    page,
    pageSize,
    total,
    loadMore,
    refetch: fetchTransactions
  }
}

/** On-chain supply balances (with live data) */
export interface SupplyBalance {
  poolId?: string
  protocolId: string
  protocol: string
  asset: string
  assetAddress: string
  receiptToken?: string        // Receipt token address (e.g. aUSDC), used for the approve check on withdraw
  receiptTokenSymbol?: string  // Voucher token symbol
  balanceWei: bigint
  balance: string           // Formatted balance
  balanceUsd: string        // USD value
  decimals?: number         // Asset decimals (for utilization/on-chain conversion)
  collateral: boolean
  apy: number               // APY (fetched from chain or API)
  apyFormatted: string
  utilization?: string      // Pool utilization %, same on-chain algorithm as the Lending market page (for the op popup)
  loading: boolean
  error: string | null
}

/** On-chain borrow balances */
export interface BorrowBalance {
  poolId?: string
  protocolId: string
  protocol: string
  asset: string
  assetAddress: string
  balanceWei: bigint
  balance: string
  balanceUsd: string
  apy: number
  apyFormatted: string
  loading: boolean
  error: string | null
}

/**
 * Get Lending position details (protocol info from mock, balances from chain)
 * @param selectedProtocolIds optional list of selected protocolIds; empty means no query
 */
function createLendingPositionState(selectedProtocolIds?: Ref<string[]>) {
  const walletStore = useWalletStore()
  const { address, isConnected } = storeToRefs(walletStore)

  // Mock data: protocol and asset info
  const positionInfo = ref<LendingPositionInfo | null>(null)

  // On-chain data: actual balances
  const suppliedBalances = ref<SupplyBalance[]>([])
  const borrowedBalances = ref<BorrowBalance[]>([])

  const loadingInfo = ref(false)
  const loadingBalances = ref(false)
  const error = ref<string | null>(null)
  let loadedAddress: string | null = null
  let supplyRequestSeq = 0
  let borrowRequestSeq = 0

  // ERC20 ABI (for balances and decimals)
  const ERC20_ABI = [
    {
      name: "balanceOf",
      type: "function",
      stateMutability: "view",
      inputs: [{ type: "address" }],
      outputs: [{ type: "uint256" }]
    },
    {
      name: "decimals",
      type: "function",
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "uint8" }]
    }
  ] as const

  /** Discover Lending positions on-chain for all protocols (no longer relying on the backend API) */
  async function fetchPositionInfo() {
    loadingInfo.value = true
    error.value = null

    try {
      if (!address.value) {
        positionInfo.value = null
        loadedAddress = null
        return
      }

      const currentAddress = address.value.toLowerCase()
      if (loadedAddress && loadedAddress !== currentAddress) {
        // Account changed: drop the previous account's discovered positions before loading the new one.
        positionInfo.value = null
      }

      const supplied: Array<{
        poolId: string; protocolId: string; protocol: string
        asset: string; assetAddress: string; collateral: boolean
      }> = []
      const borrowed: Array<{
        poolId: string; protocolId: string; protocol: string
        asset: string; assetAddress: string
      }> = []

      const account = address.value as `0x${string}`

      // Call discoverPositions only for selected protocols (load all when none selected)
      const protocols = getSelectedProtocolIdsToLoad()
      for (const protocolId of protocols) {
        const adapter = lending.get(protocolId)
        if (!adapter?.discoverPositions) {
          continue
        }
        try {
          const positions = await adapter.discoverPositions(account)
          // Deduplicate (same poolId + assetAddress)
          const seenSupplied = new Set<string>()
          for (const s of positions.supplied) {
            const key = `${s.poolId}:${s.assetAddress.toLowerCase()}`
            if (seenSupplied.has(key)) continue
            seenSupplied.add(key)
            supplied.push({ ...s, protocol: protocolDisplayName(s.protocolId) })
          }
          const seenBorrowed = new Set<string>()
          for (const b of positions.borrowed) {
            const key = `${b.poolId}:${b.assetAddress.toLowerCase()}`
            if (seenBorrowed.has(key)) continue
            seenBorrowed.add(key)
            borrowed.push({ ...b, protocol: protocolDisplayName(b.protocolId) })
          }
        } catch (e) {
          console.warn(`[Portfolio] ${protocolId} 链上仓位发现失败:`, e)
        }
      }

      // Build availableToSupply / availableToBorrow from lendingPools metadata
      const availableToSupply: Array<{ poolId: string; protocolId: string; protocol: string; asset: string; assetAddress: string }> = []
      const availableToBorrow: Array<{ poolId: string; protocolId: string; protocol: string; asset: string; assetAddress: string }> = []

      for (const pool of lendingPools) {
        if (pool.isCrossAsset) {
          // Cross-asset pools: list all supplyable/borrowable assets
          if (pool.collateralAssets) {
            for (const ca of pool.collateralAssets) {
              availableToSupply.push({
                poolId: pool.poolId,
                protocolId: pool.protocolId,
                protocol: protocolDisplayName(pool.protocolId),
                asset: ca.symbol,
                assetAddress: ca.address,
              })
            }
          }
          if (pool.borrowAssets) {
            for (const ba of pool.borrowAssets) {
              availableToBorrow.push({
                poolId: pool.poolId,
                protocolId: pool.protocolId,
                protocol: protocolDisplayName(pool.protocolId),
                asset: ba.symbol,
                assetAddress: ba.address,
              })
            }
          }
        } else {
          // Single-supply/single-borrow pools: liquidity + collateral → supplyable, loan asset → borrowable
          if (pool.collateralAssets) {
            for (const ca of pool.collateralAssets) {
              availableToSupply.push({
                poolId: pool.poolId,
                protocolId: pool.protocolId,
                protocol: protocolDisplayName(pool.protocolId),
                asset: ca.symbol,
                assetAddress: ca.address,
              })
            }
          }
          if (pool.liquidityAsset) {
            availableToSupply.push({
              poolId: pool.poolId,
              protocolId: pool.protocolId,
              protocol: protocolDisplayName(pool.protocolId),
              asset: pool.liquidityAsset,
              assetAddress: pool.liquidityAddress,
            })
          }
          availableToBorrow.push({
            poolId: pool.poolId,
            protocolId: pool.protocolId,
            protocol: protocolDisplayName(pool.protocolId),
            asset: pool.borrowAsset,
            assetAddress: pool.borrowAddress,
          })
        }
      }

      positionInfo.value = { supplied, borrowed, availableToSupply, availableToBorrow }
      loadedAddress = currentAddress
    } catch (e: any) {
      console.warn('[Portfolio] fetchPositionInfo: load failed', e)
      positionInfo.value = null
      error.value = e.message || 'Failed to fetch lending position info'
      toast.show('API connection error, please try again later', 'error')
    } finally {
      loadingInfo.value = false
    }
  }

  /** Get supply balances from chain */
  // Filter by selected pools: match poolId or protocolId
  function matchesSelection(item: { poolId?: string; protocolId: string }) {
    if (!selectedProtocolIds || selectedProtocolIds.value.length === 0) return true
    const itemPool = (item.poolId || item.protocolId).toLowerCase()
    const itemProto = item.protocolId.toLowerCase()
    return selectedProtocolIds.value.some(id => id === itemPool || id === itemProto)
  }

  // ProtocolIds to load: selected protocols only when chosen (pooled ids use the prefix), otherwise all
  function getSelectedProtocolIdsToLoad(): string[] {
    const ALL = ['aave', 'compound', 'sparklend', 'morpho', 'fluid']
    if (!selectedProtocolIds || selectedProtocolIds.value.length === 0) return ALL
    const ids = new Set<string>()
    for (const id of selectedProtocolIds.value) {
      ids.add(id.toLowerCase().split('-')[0])
    }
    return [...ids]
  }

  function getFilteredSupplies() {
    const supplies = positionInfo.value?.supplied || []
    if (!selectedProtocolIds || selectedProtocolIds.value.length === 0) return supplies
    return supplies.filter(s => matchesSelection(s))
  }

  function getFilteredBorrows() {
    const borrows = positionInfo.value?.borrowed || []
    if (!selectedProtocolIds || selectedProtocolIds.value.length === 0) return borrows
    return borrows.filter(b => matchesSelection(b))
  }

  async function fetchSupplyBalances() {
    const seq = ++supplyRequestSeq
    if (!isConnected.value || !address.value || !positionInfo.value) {
      suppliedBalances.value = []
      return
    }

    const filtered = getFilteredSupplies()
    if (filtered.length === 0) {
      suppliedBalances.value = []
      return
    }

    loadingBalances.value = true
    try {

    // Get real-time prices from Chainlink for USD valuation
    let prices: LendingPrices | null = null
    try {
      prices = await getLendingPrices()
    } catch (err) {
      console.warn('[Portfolio] 获取 Chainlink 价格失败，使用备用值', err)
    }

    // Fetch live rates per protocol from chain (supply APY, cached to avoid duplicate requests)
    const protocolRateMap = new Map<string, Map<string, { supplyAPY: number; borrowAPY: number }>>()
    const supplyProtocolIds = [...new Set(positionInfo.value.supplied.map(s => s.protocolId))]
    for (const protocolId of supplyProtocolIds) {
      const item = positionInfo.value.supplied.find(s => s.protocolId === protocolId)
      const assetMap = await getLendingRates(protocolId, item?.poolId)
      if (assetMap) protocolRateMap.set(protocolId, assetMap)
    }

    const balances: SupplyBalance[] = []

    for (const supply of filtered) {
      const poolId = supply.poolId || ''
      // Fill in receiptToken info (needed for the withdraw approve check)
      const marketMeta = lendingProtocols.find(
        m => m.protocolId.toLowerCase() === (supply.protocolId || '').toLowerCase() &&
             m.assetAddress?.toLowerCase() === (supply.assetAddress || '').toLowerCase()
      )
      if (!supply.receiptToken && marketMeta?.receiptToken) {
        supply.receiptToken = marketMeta.receiptToken
        supply.receiptTokenSymbol = marketMeta.receiptTokenSymbol || ''
      }

      try {
        // Prefer looking up adapters by poolId (supports pooled ids like compound-usdc)
        let adapter = poolId ? lending.getByPool(poolId) : null
        if (!adapter) adapter = lending.get(supply.protocolId)

        // WETH displayed as ETH
        if (supply.assetAddress?.toLowerCase() === ADDRESSES.tokens.WETH.toLowerCase() && supply.asset === 'WETH') {
          supply.asset = 'ETH'
        }
        if (!adapter) {
          balances.push({
            ...supply,
            protocol: protocolDisplayName(supply.protocolId),
            balanceWei: BigInt(0),
            balance: '0',
            balanceUsd: '$0.00',
            apy: 0,
            apyFormatted: '0%',
            loading: false,
            error: null
          })
          continue
        }

        // Skip items without an asset address
        if (!supply.assetAddress) {
          balances.push({
            ...supply,
            protocol: protocolDisplayName(supply.protocolId),
            balanceWei: BigInt(0),
            balance: '0',
            balanceUsd: '$0.00',
            apy: 0,
            apyFormatted: '0%',
            loading: false,
            error: null
          })
          continue
        }

        // Get balances from chain (passing the asset address for adapters that need it)
        const balanceWei = await adapter.getSupplyBalance(address.value as `0x${string}`, supply.assetAddress, supply.poolId)

        // Get token decimals: use the local table for known assets, query chain only for unknown ones
        let decimals = 18
        const isETH = supply.assetAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
        const knownDecimals = KNOWN_DECIMALS[supply.assetAddress.toLowerCase()]
        if (!isETH && knownDecimals !== undefined) {
          decimals = knownDecimals
        } else if (!isETH) {
          try {
            decimals = await publicClient.readContract({
              address: supply.assetAddress as `0x${string}`,
              abi: ERC20_ABI,
              functionName: 'decimals'
            }) as number
          } catch {
            decimals = 18
          }
        }

        // Compute the USD price for decimals adjustment and USD valuation
        const balanceFull = formatUnits(balanceWei, decimals)
        const balanceNum = parseFloat(balanceFull)
        let usdPrice = 0
        if (prices) {
          usdPrice = getPriceByAddress(prices, supply.assetAddress)
        } else {
          usdPrice = (isETH || supply.asset === 'ETH') ? 2000 : 1
        }

        // Format balances: auto-adjust decimals so the smallest displayed unit ≈ $0.01 USD
        const significantDecimals = Math.min(8, Math.max(2, Math.ceil(Math.log10(Math.max(usdPrice, 0.01) / 0.01))))
        const truncated = Math.floor(balanceNum * 10 ** significantDecimals) / 10 ** significantDecimals
        // Format as a plain decimal string — NOT via parseFloat(...).toString(), which round-trips a small
        // non-zero value (e.g. WBTC 9e-7) back into a JS number and re-renders it as scientific notation "9e-7".
        // toFixed + strip trailing zeros stays in string space so tiny balances render as 0.0000009.
        let balance = truncated.toFixed(significantDecimals).replace(/\.?0+$/, '')
        // Dust balance: actually > 0 but formats to 0, display < minimum precision
        if (balanceNum > 0 && parseFloat(balance) === 0) {
          balance = '<' + (1 / 10 ** significantDecimals).toFixed(significantDecimals)
        }

        // Compute USD valuation
        const rawUsd = balanceNum * usdPrice
        const balanceUsd = rawUsd > 0 && rawUsd < 0.01 ? '<$0.01' : `$${rawUsd.toFixed(2)}`

        // Display WETH as ETH (user mental model)
        if (supply.assetAddress?.toLowerCase() === ADDRESSES.tokens.WETH.toLowerCase() && supply.asset === 'WETH') {
          supply.asset = 'ETH'
        }
        // Compound/Morpho collateral (WBTC/wstETH/ETH etc.) earns no yield → show '-'
        // Aave/SparkLend collateral = liquidity has supplyAPY; Fluid collateral has vault supplyRate
        const baseProtocol = (supply.protocolId || '').split('-')[0]
        const isCollateralNoApy =
          (baseProtocol === 'compound' || baseProtocol === 'morpho') && !!supply.collateral
        const _supplyRate = isCollateralNoApy
          ? undefined
          : lookupRateMap(protocolRateMap.get(supply.protocolId), supply.assetAddress)
        // Liquidity positions (non-collateral) prefer vault/liquidity rates (liquidityAPY):
        // Morpho USDC/USDT → vault official netApy (Gauntlet/Sky); Fluid → fToken supplyRate
        // Fall back to protocol supplyAPY when undefined (Aave/SparkLend/Compound etc.)
        const liquidityApy = !supply.collateral ? _supplyRate?.liquidityAPY : undefined
        const supplyApy = liquidityApy ?? _supplyRate?.supplyAPY
        balances.push({
          ...supply,
          protocol: protocolDisplayName(supply.protocolId),
          balanceWei,
          balance,
          balanceUsd,
          apy: supplyApy ?? 0,
          apyFormatted: supplyApy !== undefined ? supplyApy.toFixed(2) + '%' : '-',
          loading: false,
          error: null
        })
        // WETH displayed as ETH
        if (supply.assetAddress?.toLowerCase() === ADDRESSES.tokens.WETH.toLowerCase() && supply.asset === 'WETH') {
          supply.asset = 'ETH'
        }
      } catch (e: any) {
        console.error(`[Portfolio] fetchSupplyBalances: 查询 ${supply.protocolId}/${supply.asset} 失败`, e.message, e)
        balances.push({
          ...supply,
          protocol: protocolDisplayName(supply.protocolId),
          balanceWei: BigInt(0),
          balance: '0',
          balanceUsd: '$0.00',
          apy: 0,
          apyFormatted: '0%',
          loading: false,
          error: null
        })
      }
    }

      if (seq === supplyRequestSeq) suppliedBalances.value = balances
    } finally {
      if (seq === supplyRequestSeq) loadingBalances.value = false
    }
  }

  /** Fetch borrow balances on-chain (prefer getBorrowBalances for per-asset data) */
  async function fetchBorrowBalances() {
    const seq = ++borrowRequestSeq
    if (!isConnected.value || !address.value || !positionInfo.value) {
      borrowedBalances.value = []
      return
    }

    const filteredBorrows = getFilteredBorrows()
    if (filteredBorrows.length === 0) {
      borrowedBalances.value = []
      return
    }


    // Get real-time prices from Chainlink for USD valuation
    let prices: LendingPrices | null = null
    try {
      prices = await getLendingPrices()
    } catch (err) {
      console.warn('[Portfolio] 获取 Chainlink 价格失败，使用备用值', err)
    }

    // Fetch real-time rates for each protocol on-chain (borrow APY, selected protocols only)
    const protocolRateMap = new Map<string, Map<string, { supplyAPY: number; borrowAPY: number }>>()
    const borrowProtocolIds = [...new Set(filteredBorrows.map(b => b.protocolId))]
    for (const protocolId of borrowProtocolIds) {
      const assetMap = await getLendingRates(protocolId)
      if (assetMap) protocolRateMap.set(protocolId, assetMap)
    }

    const balances: BorrowBalance[] = []

    // ===== Phase 1: if the API returned a borrow list, use getBorrowBalances for per-asset data =====
    if (filteredBorrows.length > 0) {
      // Group by protocol, prefer getBorrowBalances for per-asset data
      const protocolGroups: Record<string, any[]> = {}
      for (const borrow of filteredBorrows) {
        if (!borrow.assetAddress) {
          balances.push({
            ...borrow,
            balanceWei: BigInt(0),
            balance: '0',
            balanceUsd: '$0.00',
            apy: 0,
            apyFormatted: '0%',
            loading: false,
            error: null
          })
          continue
        }
        if (!protocolGroups[borrow.protocolId]) protocolGroups[borrow.protocolId] = []
        protocolGroups[borrow.protocolId].push(borrow)
      }

      for (const [protocolId, borrows] of Object.entries(protocolGroups)) {
        try {
          // Prefer the first borrow's poolId to look up the adapter
          const firstBorrow = borrows[0]
          const poolId = firstBorrow.poolId || ''
          let adapter = poolId ? lending.getByPool(poolId) : null
          if (!adapter) adapter = lending.get(protocolId)
          if (!adapter) continue

          // Prefer getBorrowBalances for per-asset on-chain data
          if (adapter.getBorrowBalances) {
            const borrowMap = await adapter.getBorrowBalances(address.value as `0x${string}`)
            if (borrowMap.size > 0) {
              for (const [assetAddr, debtWei] of borrowMap) {
                const borrowItem = borrows.find(
                  (b: any) => b.assetAddress?.toLowerCase() === assetAddr.toLowerCase()
                )
                if (!borrowItem) continue

                // Fetch decimals on-chain: use the local table for known assets to avoid one RPC per borrow position
                let decimals = 18
                const isETH = assetAddr.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
                const knownDecimals = KNOWN_DECIMALS[assetAddr.toLowerCase()]
                if (!isETH && knownDecimals !== undefined) {
                  decimals = knownDecimals
                } else if (!isETH) {
                  try {
                    decimals = await publicClient.readContract({
                      address: assetAddr as `0x${string}`,
                      abi: ERC20_ABI,
                      functionName: 'decimals'
                    }) as number
                  } catch { /* fallback to 18 */ }
                }

                const balanceFull = formatUnits(debtWei, decimals)
                const balanceNum = parseFloat(balanceFull)

                // USD price
                let usdPrice = 0
                if (prices) {
                  usdPrice = getPriceByAddress(prices, assetAddr)
                } else {
                  usdPrice = (isETH || borrowItem.asset === 'ETH') ? 2000 : 1
                }

                // Precision formatting
                const sd = Math.min(8, Math.max(2, Math.ceil(Math.log10(Math.max(usdPrice, 0.01) / 0.01))))
                const truncated = Math.floor(balanceNum * 10 ** sd) / 10 ** sd
                // Keep balance as a plain decimal string (strip trailing zeros) instead of
                // parseFloat(...).toString(), which turns small non-zero values (e.g. WBTC 9e-7) into "9e-7".
                let balance = truncated.toFixed(sd).replace(/\.?0+$/, '')
                if (balanceNum > 0 && parseFloat(balance) === 0) balance = '<' + (1 / 10 ** sd).toFixed(sd)
                const rawUsd = balanceNum * usdPrice
                const balanceUsd = rawUsd > 0 && rawUsd < 0.01 ? '<$0.01' : `$${rawUsd.toFixed(2)}`

                const _borrowRate = lookupRateMap(protocolRateMap.get(protocolId), assetAddr)
                balances.push({
                  ...borrowItem,
                  protocolId,
                  balanceWei: debtWei,
                  balance,
                  balanceUsd,
                  apy: _borrowRate?.borrowAPY ?? 0,
                  apyFormatted: _borrowRate ? _borrowRate.borrowAPY.toFixed(2) + '%' : '-',
                  loading: false,
                  error: null
                })
              }
            }
          } else if (adapter.getBorrowBalance) {
            // Fallback: use protocol-level total borrow (for protocol-level interfaces like Compound)
            const totalDebt = await adapter.getBorrowBalance(address.value as `0x${string}`)
            if (totalDebt <= BigInt(0)) continue

            for (const borrowItem of borrows) {
              const totalDebtUSD = Number(totalDebt) / 100
              const balance = totalDebtUSD.toFixed(2)
              const balanceUsd = totalDebtUSD >= 1e6
                ? `$${(totalDebtUSD / 1e6).toFixed(2)}M`
                : `$${totalDebtUSD.toFixed(2)}`

              const _fallbackRate = protocolRateMap.get(protocolId)?.get(borrowItem.assetAddress?.toLowerCase() ?? '')
              balances.push({
                ...borrowItem,
                balanceWei: totalDebt,
                balance,
                balanceUsd,
                apy: _fallbackRate?.borrowAPY ?? 0,
                apyFormatted: _fallbackRate ? _fallbackRate.borrowAPY.toFixed(2) + '%' : '-',
                loading: false,
                error: null
              })
            }
          }
        } catch (e: any) {
          for (const borrowItem of borrows) {
            balances.push({
              ...borrowItem,
              balanceWei: BigInt(0),
              balance: '0',
              balanceUsd: '$0.00',
              apy: 0,
              apyFormatted: '0%',
              loading: false,
              error: e.message || 'Failed to fetch balance'
            })
          }
        }
      }

      if (seq === borrowRequestSeq) borrowedBalances.value = balances
      return
    }

    // ===== Phase 2: API did not return a borrow list, auto-discover on-chain (selected protocols only) =====

    const selectedIds = new Set(getSelectedProtocolIdsToLoad())
    const protocols = getUniqueLendingProtocols().filter(p => selectedIds.has(p.protocolId))

    for (const protocol of protocols) {
      try {
        const adapter = lending.get(protocol.protocolId)
        if (!adapter) continue

        // Prefer per-asset queries (returns assetAddress → debtWei)
        if (adapter.getBorrowBalances) {
          const borrowMap = await adapter.getBorrowBalances(address.value as `0x${string}`)
          if (borrowMap.size === 0) continue

          for (const [assetAddr, debtWei] of borrowMap) {
            // Match market info
            const market = lendingProtocols.find(
              m => m.protocolId === protocol.protocolId &&
                   m.assetAddress?.toLowerCase() === assetAddr.toLowerCase()
            )
            if (!market) continue

            // Look up the matching poolId (pooled refactor support)
            const poolMeta = lendingPools.find(p =>
              p.protocolId === protocol.protocolId &&
              (p.borrowAddress?.toLowerCase() === assetAddr.toLowerCase() ||
               p.collateralAddress?.toLowerCase() === assetAddr.toLowerCase())
            )
            const poolId = poolMeta?.poolId || protocol.protocolId

            // Prefer fetching decimals on-chain to ensure correct precision
            let decimals = market.decimals || 18
            const isETH = assetAddr.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
            if (!isETH && market.assetAddress) {
              try {
                const chainDecimals = await publicClient.readContract({
                  address: market.assetAddress as `0x${string}`,
                  abi: ERC20_ABI,
                  functionName: 'decimals'
                }) as number
                if (chainDecimals > 0) decimals = chainDecimals
              } catch {
                // fallback to mock decimals
              }
            }

            const balanceFull = formatUnits(debtWei, decimals)
            const balanceNum = parseFloat(balanceFull)

            let usdPrice = 0
            if (prices) {
              usdPrice = getPriceByAddress(prices, market.assetAddress || assetAddr)
            } else {
              usdPrice = (isETH || market.asset === 'ETH') ? 2000 : 1
            }

            // Precision formatting: minimum display unit ≈ $0.01 USD
            const sd = Math.min(8, Math.max(2, Math.ceil(Math.log10(Math.max(usdPrice, 0.01) / 0.01))))
            const truncated = Math.floor(balanceNum * 10 ** sd) / 10 ** sd
            // Keep balance as a plain decimal string (strip trailing zeros) instead of
            // parseFloat(...).toString(), which turns small non-zero values (e.g. WBTC 9e-7) into "9e-7".
            let balance = truncated.toFixed(sd).replace(/\.?0+$/, '')
            if (balanceNum > 0 && parseFloat(balance) === 0) balance = '<' + (1 / 10 ** sd).toFixed(sd)
            const rawUsd = balanceNum * usdPrice
            const balanceUsd = rawUsd > 0 && rawUsd < 0.01 ? '<$0.01' : `$${rawUsd.toFixed(2)}`

            const _phase2Rate = protocolRateMap.get(protocol.protocolId)?.get(assetAddr?.toLowerCase() ?? '')
          balances.push({
            poolId,
            protocolId: protocol.protocolId,
            protocol: protocolDisplayName(protocol.protocolId),
            asset: market.asset === 'WETH' ? 'ETH' : market.asset,
            assetAddress: assetAddr,
              balanceWei: debtWei,
              balance,
              balanceUsd,
              apy: _phase2Rate?.borrowAPY ?? 0,
              apyFormatted: _phase2Rate ? _phase2Rate.borrowAPY.toFixed(2) + '%' : '-',
              loading: false,
              error: null
            })

          }

        // Fallback: use protocol-level total borrow
        } else if (adapter.getBorrowBalance) {
          const totalDebt = await adapter.getBorrowBalance(address.value as `0x${string}`)
          if (totalDebt <= BigInt(0)) continue

          // totalDebtBase is USD value × 100, convert directly to USD
          const debtUSD = Number(totalDebt) / 100
          const balanceStr = debtUSD >= 1e6
            ? `$${(debtUSD / 1e6).toFixed(2)}M`
            : `$${debtUSD.toFixed(2)}`

          const _protocolRate = protocolRateMap.get(protocol.protocolId)?.get(protocol.assetAddress?.toLowerCase() ?? '')
          balances.push({
            poolId: protocol.protocolId,
            protocolId: protocol.protocolId,
            protocol: protocolDisplayName(protocol.protocolId),
            asset: protocol.asset,
            assetAddress: protocol.assetAddress || '',
            balanceWei: totalDebt,
            balance: debtUSD.toFixed(2),
            balanceUsd: balanceStr,
            apy: _protocolRate?.borrowAPY ?? 0,
            apyFormatted: _protocolRate ? _protocolRate.borrowAPY.toFixed(2) + '%' : '-',
            loading: false,
            error: null
          })

        }
      } catch (e: any) {
        console.warn(`[Portfolio] 发现借款失败 ${protocol.protocolId}:`, e.message)
      }
    }

    if (seq === borrowRequestSeq) borrowedBalances.value = balances
  }

  /** Initialize and re-discover when the wallet account changes. */
  watch([isConnected, address], () => {
    if (isConnected.value && address.value) {
      fetchPositionInfo()
    } else {
      positionInfo.value = null
      loadedAddress = null
    }
  }, { immediate: true })

  /** Fetch on-chain balances when the user connects a wallet */
  watch([isConnected, address, positionInfo], () => {
    if (isConnected.value && address.value && positionInfo.value) {
      fetchSupplyBalances()
      fetchBorrowBalances()
    }
  }, { immediate: true })

  // Watch protocol filter changes → re-discover positions in selected pools (positionInfo changes cascade into balance queries)
  if (selectedProtocolIds) {
    watch(selectedProtocolIds, () => {
      if (isConnected.value && address.value) {
        fetchPositionInfo()
      }
    })
  }

  /** Compute total supply value */
  const totalSupplied = computed(() => {
    const total = suppliedBalances.value.reduce((sum, s) => {
      const val = parseFloat(s.balanceUsd.replace('$', '').replace(',', '')) || 0
      return sum + val
    }, 0)
    return `$${total.toFixed(2)}`
  })

  /** Compute total borrow value */
  const totalBorrowed = computed(() => {
    const total = borrowedBalances.value.reduce((sum, b) => {
      const val = parseFloat(b.balanceUsd.replace('$', '').replace(',', '')) || 0
      return sum + val
    }, 0)
    return `$${total.toFixed(2)}`
  })

  /** Health factor (returns ∞ when there is no borrow) */
  const healthFactor = computed(() => {
    if (borrowedBalances.value.length === 0 || totalBorrowed.value === '$0.00') {
      return '∞'
    }
    // Simplified: total supply / total borrow
    const supplied = parseFloat(totalSupplied.value.replace('$', '').replace(',', '')) || 0
    const borrowed = parseFloat(totalBorrowed.value.replace('$', '').replace(',', '')) || 0
    if (borrowed === 0) return '∞'
    return (supplied / borrowed).toFixed(2)
  })

  return {
    positionInfo,
    suppliedBalances,
    borrowedBalances,
    loading: computed(() => loadingInfo.value || loadingBalances.value),
    loadingBalances,
    error,
    totalSupplied,
    totalBorrowed,
    healthFactor,
    refetchInfo: fetchPositionInfo,
    refetchBalances: () => {
      fetchSupplyBalances()
      fetchBorrowBalances()
    }
  }
}

let sharedLendingPositionState: ReturnType<typeof createLendingPositionState> | null = null

/**
 * Get the Lending position state.
 * Callers without a protocol filter share one module-level singleton, so Portfolio ALL /
 * available-asset components do not duplicate discovery or balance requests.
 */
export function useLendingPosition(selectedProtocolIds?: Ref<string[]>) {
  if (!selectedProtocolIds) {
    if (!sharedLendingPositionState) {
      sharedLendingPositionState = createLendingPositionState()
    }
    return sharedLendingPositionState
  }
  return createLendingPositionState(selectedProtocolIds)
}

/** Fetch the list of supplyable assets (Mock data) */
export function useAvailableToSupply() {
  const { positionInfo, loading, refetchInfo } = useLendingPosition()

  const availableToSupply = computed(() => {
    return positionInfo.value?.availableToSupply || []
  })

  return {
    availableToSupply,
    loading,
    refetch: refetchInfo
  }
}

/** Fetch the list of borrowable assets (Mock data) */
export function useAvailableToBorrow() {
  const { positionInfo, loading, refetchInfo } = useLendingPosition()

  const availableToBorrow = computed(() => {
    return positionInfo.value?.availableToBorrow || []
  })

  return {
    availableToBorrow,
    loading,
    refetch: refetchInfo
  }
}
