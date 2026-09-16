<template>
  <section class="lending-page  page bg-black text-gray-100 font-sans items-center justify-items-center">
    <div class="container">
      <!-- Title -->
      <header class="header">
        <h1>Lending</h1>
        <p>
          Compare the best lending opportunities across top DeFi protocols.
        </p>
      </header>
      <section class="filter-bar">
        <div class="tabs">
          <button
            v-for="t in tabs"
            :key="t"
            :class="{ active: activeTab === t }"
            @click="activeTab = t"
          >
            {{ t }}
          </button>
        </div>
        <div class="search-box">
          <img class="search" src="@/assets/icons/search.svg" />
          <input v-model="keyword" placeholder="Search" />
          <img class="close" src="@/assets/icons/close-circle.png" @click="keyword = ''" />
        </div>
      </section>
      <div v-if="!loading && sortedData.length > 0" class="crypto-table">
        <table>
          <thead>
            <tr>
              <th
                v-for="col in columns"
                :key="col.key"
                @click="sort(col.key)"
              >
                <div class="sortable">
                  <span>{{ col.label }}</span>
                  <span class="sort" :class="sortCls(col.key)">
                    <span class="sort-icon up"></span>
                    <span class="sort-icon down"></span>
                  </span>
                </div>
              </th>
              <th></th>
            </tr>
          </thead>

          <tbody>
              <tr v-for="(row, idx) in sortedData" :key="idx" class="table-row" @click="onRowClick(row)">
              <td>
                <div class="asset">
                  <img v-if="row.icon" :src="row.icon"/>
                  {{ row.protocol }}
                </div>
              </td>
              <td>
                <!-- Mobile single-asset pools: two-row asset-pair like Portfolio's Asset to supply; cross-asset pools stay single-row -->
                <div v-if="isMobile && !isCrossPool(row.poolId)" class="asset-pair">
                  <div class="asset-row">
                    <img :src="getIcon(row.asset)" class="icon-sm" />
                    <span>{{ row.asset }}</span>
                  </div>
                  <div class="asset-row">
                    <template v-if="row.borrowable !== false">
                      <img :src="getIcon(row.loanAsset)" class="icon-sm" />
                      <span>{{ row.loanAsset }}</span>
                    </template>
                    <span v-else>-</span>
                  </div>
                </div>
                <div v-else class="asset">
                  <img v-if="row.asset" :src="getIcon(row.asset)"/>
                  {{ row.asset }}
                </div>
              </td>
              <td>{{ row.totalSupplied }}</td>
              <td>{{ row.supplyAPY }}</td>
              <td>
                <div class="asset">
                  <template v-if="row.borrowable !== false && row.loanAsset">
                    <img :src="getIcon(row.loanAsset)"/>
                    {{ row.loanAsset }}
                  </template>
                  <template v-else>-</template>
                </div>
              </td>
              <td>{{ row.totalBorrowed }}</td>
              <td>{{ row.borrowAPY }}</td>
              <td>{{ row.utilization }}</td>
              <td>{{ row.launchYear }}</td>
              <td>
                <div class="op-btn-wrapper">
                  <div class="list-op-btn" @click="openStable(row)">Detail</div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="loading" class="loading-state">
        <p>Loading...</p>
      </div>
      <div v-else class="empty-state">
        <p>No data available</p>
      </div>
      <PaginationDot v-if="!isMobile" v-model="page" :total="totalPages" />
      <FOOT></FOOT>
    </div>
  </section>
  <LendingModal v-model="lendingModalVisible" :balance="userEthBalance" :selectedItem="selectedItem" :availableTabs="lendingModalTabs" @stake="handleStake" />
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { lendingPools, lendingProtocols, getLendingLaunchYear, type LendingPoolMeta } from '@/constants/protocols'
import { getLendingRates } from '@/composables/useLendingApy'
import { enrichLendingItem } from '@/composables/useLendingItem'
import { getLendingPrices, getPriceByAddress } from '@/composables/useLendingPrices'

/** Extract the pure protocol name from poolId (strip the asset suffix) */
const PROTOCOL_DISPLAY_NAMES: Record<string, string> = {
  aave: 'AAVE',
  compound: 'Compound',
  morpho: 'Morpho',
  fluid: 'Fluid',
  sparklend: 'SparkLend',
}
function getProtocolDisplayName(poolId: string): string {
  const base = poolId.split('-')[0]
  return PROTOCOL_DISPLAY_NAMES[base] || base
}
import LendingModal from '@/components/lendingOp/index.vue'
import PaginationDot from '@/components/pagination.vue'
import { useUserEthBalance } from '@/composables/useBalance'
import FOOT from '../../components/Foot.vue'
import { toast } from '@/utils/toast'
import { sortRows } from '@/utils/sort'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { lending } from '@/chain/lending'
import { setFluidPool } from '@/chain/lending/fluid'
import { setMorphoPool } from '@/chain/lending/morpho'

// Popup tabs configuration: Borrow only exists for borrowable assets (e.g. SparkLend
// wstETH/WBTC are collateral/liquidity-only → Supply-only modal). Computed so the tab
// set follows the selected row.
const lendingModalTabs = computed(() => {
  const tabs = ['Supply']
  if (selectedItem.value?.borrowable !== false) tabs.push('Borrow')
  return tabs
})

// API Data Status
const loading = ref(false)
const error = ref('')
const apiData = ref<any[]>([])
const keyword = ref('')
interface StableItem {
  protocol: string
  icon: string
  tvl: string
  apy: string
  curator: string
  collateral: string
  category: string
  year: number
  // Cross-asset pools (e.g. SparkLend): false for collateral/liquidity-only assets (wstETH/WBTC) → no Borrow tab
  borrowable?: boolean
  // Pre-computed borrowable (USD string like "$123.45") passed to the modal Borrow tab as a reliable fallback
  available?: string
}
const activeTab = ref<'ALL'|'ETH Based'|'BTC Based'|'Stablecoins'>('ALL')
const tabs: Array<typeof activeTab.value> = ['ALL', 'ETH Based', 'BTC Based', 'Stablecoins']
// Bulk import using Vite's import.meta.glob
const icons = import.meta.glob('@/assets/logos/*.svg', { 
  eager: true,
  import: 'default' 
})
// Fallback protocol icon (use the bundled asset URL to avoid raw paths 404ing online or being SPA-fallbacked into HTML)
const DEFAULT_ICON = (icons['/src/assets/logos/stablecoin.svg'] as string) || ''
// Extract symbol from path
const getIcon = (symbol?: string | null) => {
  if (!symbol) return DEFAULT_ICON // Default icons
  
  const symbolLower = symbol.toLowerCase()
  for (const [path, icon] of Object.entries(icons)) {
    if (path.includes(symbolLower)) {
      return icon as string
    }
  }
  return DEFAULT_ICON // Return to default icon when not found
}
// Cross-asset pools (Aave/SparkLend) do not show the two-row structure on mobile; stay single-row
const crossAssetPoolIds = new Set(
  lendingPools.filter(p => p.isCrossAsset).map(p => p.poolId)
)
const isCrossPool = (poolId?: string) => crossAssetPoolIds.has(poolId || '')
const columns = [
  { key: 'protocol', label: 'Protocol' },
  { key: 'asset', label: 'Collateral' },
  { key: 'totalSupplied', label: 'Total Supplied' },
  { key: 'supplyAPY', label: 'Supply APY' },
  { key: 'loanAsset', label: 'Loan' },
  { key: 'totalBorrowed', label: 'Total Borrowed' },
  { key: 'borrowAPY', label: 'Borrow APY' },
  { key: 'utilization', label: 'Utilization' },
  { key: 'launchYear', label: 'Launch Year' }
]
function formatPercent(val: number | string | undefined): string {
  const num = typeof val === 'string' ? parseFloat(val) : (val ?? 0)
  if (num < 0.01) return '<0.01%'
  return num.toFixed(2) + '%'
}

function formatTokenAmount(raw: bigint | number, decimals: number): string {
  const wei = BigInt(raw)
  if (wei <= 0n) return '-'
  const div = 10n ** BigInt(decimals)
  const whole = wei / div
  if (whole >= 1_000_000_000n) return (Number(whole) / 1e9).toFixed(2) + 'B'
  if (whole >= 1_000_000n) return (Number(whole) / 1e6).toFixed(2) + 'M'
  if (whole >= 1_000n) return (Number(whole) / 1e3).toFixed(2) + 'K'
  const frac = Number(wei % div) / (10 ** decimals)
  return (Number(whole) + frac).toFixed(2)
}

// Mainnet common asset decimals fallback (avoids hardcoded 18 causing wrong decimals for WBTC etc. when a single-pool collateral is not registered in lendingProtocols)
const KNOWN_DECIMALS: Record<string, number> = {
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': 18, // ETH
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18, // WETH
  '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': 18, // wstETH
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8,  // WBTC
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,  // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,  // USDT
  '0x6b175474e89094c44da98b954eedeac495271d0f': 18, // DAI
}

/** Look up decimals by asset address: lendingProtocols first, then KNOWN_DECIMALS, then 18 */
function getDecimalsByAsset(assetAddress: string | undefined): number {
  if (!assetAddress) return 18
  const addr = assetAddress.toLowerCase()
  const found = lendingProtocols.find(p => p.assetAddress.toLowerCase() === addr)
  if (found?.decimals) return found.decimals
  return KNOWN_DECIMALS[addr] ?? 18
}

// Access Data
async function fetchData() {
  loading.value = true
  error.value = ''

  try {
    // Build the supply asset list for each pool (TVL/APY fetched in real time on-chain; /lending/pools is no longer requested)
    const items: any[] = []
    for (const pool of lendingPools) {
      const stats: any = undefined // /lending/pools endpoint removed; everything uses defaults/real-time on-chain data
      const displayName = getProtocolDisplayName(pool.poolId)

      if (pool.isCrossAsset) {
        // Cross-asset pools: get supported assets from lendingProtocols
        const poolAssets = lendingProtocols.filter(p => p.protocolId === pool.poolId)
        const borrowableAddrs = (pool.borrowAssets || []).map(ba => ba.address.toLowerCase())
        for (const asset of poolAssets) {
          // Cross-asset pools: an asset is borrowable only if it is among the pool's borrowAssets
          // (e.g. SparkLend wstETH/WBTC are collateral/liquidity-only → no Loan/Borrow info, Supply-only modal).
          const borrowable = borrowableAddrs.includes(asset.assetAddress.toLowerCase())
          items.push({
            protocol: displayName,
            name: asset.name || displayName,
            icon: getIcon(asset.protocolId),
            protocolId: pool.poolId,
            poolId: pool.poolId,
            asset: asset.asset,
            assetAddress: asset.assetAddress,
            decimals: asset.decimals,
            loanAsset: asset.asset,
            loanAssetAddress: asset.assetAddress,
            loanDecimals: asset.decimals,
            borrowable,
            receiptToken: asset.receiptToken || asset.contracts?.aToken || '',
            receiptTokenSymbol: asset.receiptTokenSymbol || '',
            totalSupplied: stats ? `$${(stats.tvl / 1e9).toFixed(2)}B` : '-',
            supplyAPY: '-',
            totalBorrowed: stats ? `$${(stats.totalBorrows / 1e9).toFixed(2)}B` : '-',
            borrowAPY: '-',
            utilization: stats ? formatPercent(stats.utilizationRate) : '-',
            launchYear: asset.launchYear || getLendingLaunchYear(pool.poolId),
            risk: asset.risk,
            poolMeta: pool,
          })
        }
      } else {
        // Single-collateral/single-borrow pools: list each collateral by collateralAssets
        const rawCollateralAssets = pool.collateralAssets && pool.collateralAssets.length > 0
          ? pool.collateralAssets
          : [{ symbol: pool.collateralAsset, address: pool.collateralAddress }]
        const supplyAssets = rawCollateralAssets.map(ca => {
          // First check whether lendingProtocols has metadata for this collateral
          const meta = lendingProtocols.find(
            p => p.protocolId === pool.protocolId &&
                 p.assetAddress.toLowerCase() === ca.address.toLowerCase()
          )
          return meta || {
            protocolId: pool.protocolId,
            asset: ca.symbol,
            assetAddress: ca.address,
            decimals: getDecimalsByAsset(ca.address),
            defaultSupplyApy: 3.0,
            defaultBorrowApy: 5.0,
            launchYear: getLendingLaunchYear(pool.protocolId),
            risk: { maxLtv: 80, liquidationThreshold: 83, liquidationPenalty: 5 },
          }
        })
        // Look up the borrowAsset metadata (decimals)
        const borrowMeta = lendingProtocols.find(
          p => p.assetAddress.toLowerCase() === pool.borrowAddress.toLowerCase()
        )

        for (const sa of supplyAssets) {
          items.push({
            protocol: displayName,
            name: displayName,
            icon: getIcon(pool.protocolId),
            protocolId: pool.protocolId,
            poolId: pool.poolId,
            asset: sa.asset,
            assetAddress: sa.assetAddress,
            decimals: sa.decimals || 18,
            loanAsset: pool.borrowAsset,
            loanAssetAddress: pool.borrowAddress,
            loanDecimals: borrowMeta?.decimals || 18,
            receiptToken: sa.receiptToken || '',
            receiptTokenSymbol: sa.receiptTokenSymbol || '',
            totalSupplied: stats ? `$${(stats.tvl / 1e6).toFixed(2)}M` : '-',
            supplyAPY: '-',
            totalBorrowed: stats ? `$${(stats.totalBorrows / 1e6).toFixed(2)}M` : '-',
            borrowAPY: '-',
            utilization: stats ? formatPercent(stats.utilizationRate) : '-',
            launchYear: getLendingLaunchYear(pool.protocolId) || sa.launchYear || 2024,
            risk: pool.risk || sa.risk || { maxLtv: 80, liquidationThreshold: 83, liquidationPenalty: 5 },
            poolMeta: pool,
          })
        }
      }
    }

    apiData.value = items
    loading.value = false

    // Fetch and fill real-time on-chain data (APY + totalSupply/totalBorrow) per protocol,
    // protocols that return first display first without blocking other rows (static rows render first; dynamic fields are '-')
    const WETH_LC = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
    const ETH_LC = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    const normKey = (addr: string) => {
      const a = addr.toLowerCase()
      return a === ETH_LC ? WETH_LC : a
    }

    interface ChainPoolData {
      supplyAPY: number; borrowAPY: number
      totalSupply: bigint; totalBorrow: bigint
      supplyDecimals?: number; borrowDecimals?: number
    }

    const applyPoolData = (protoId: string, rates: Map<string, any> | null | undefined, prices: any | null) => {
      if (!rates || rates.size === 0) return
      const map: Record<string, ChainPoolData> = {}
      for (const [addr, info] of rates) {
        const key = normKey(addr)
        // Avoid overwrites: fluid has both ETH collateral (0xEeee) and WETH borrow (0xC02a) entries,
        // normKey normalizes both to WETH — keep the first-arriving borrow asset entry so collateral entries cannot overwrite borrow data
        if (map[key] !== undefined) continue
        map[key] = {
          supplyAPY: info.supplyAPY, borrowAPY: info.borrowAPY,
          totalSupply: info.totalSupply ?? 0n, totalBorrow: info.totalBorrow ?? 0n,
          supplyDecimals: info.supplyDecimals, borrowDecimals: info.borrowDecimals,
        }
      }

      // Fill all rows of this protocol with this pool's on-chain data
      apiData.value = apiData.value.map(item => {
        const base = (item.protocolId || item.poolId || '').split('-')[0]
        if (base !== protoId) return item
        try {
          // Match by borrow asset (loanAssetAddress) first: getMarketData's key is the borrow asset
          // (Fluid vault collateral is ETH/wstETH; matching by assetAddress first would misassign to other vaults)
          const chainData =
            map[normKey(item.loanAssetAddress || '')] ||
            map[normKey(item.assetAddress || '')]
          if (!chainData) {
            return {
              ...item,
              supplyAPY: '-', borrowAPY: '-',
              totalSupplied: '-', totalBorrowed: '-', utilization: '-',
            }
          }
          const dec = item.loanDecimals || item.decimals || 18
          const supplyDec = chainData.supplyDecimals ?? dec
          const borrowDec = chainData.borrowDecimals ?? dec
          const isCrossAsset = chainData.supplyDecimals !== undefined && chainData.borrowDecimals !== undefined
          // Morpho/Compound collateral (WBTC/wstETH etc.) has no yield: show '-'
          const collateralNoApy = base === 'morpho' || base === 'compound'
          // Utilization：
          // - Single-asset pools (Morpho/Compound/Aave/SparkLend): borrow/supply share decimals, compute directly
          // - Cross-asset pools (Fluid vault): collateral/borrow assets differ, convert borrowValue/supplyValue via USD
          let utilization = 0
          if (chainData.totalSupply > 0n) {
            if (!isCrossAsset) {
              utilization = Number(chainData.totalBorrow * 100n / chainData.totalSupply)
            } else if (prices) {
              const supplyPrice = getPriceByAddress(prices, item.assetAddress || '')
              const borrowPrice = getPriceByAddress(prices, item.loanAssetAddress || '')
              if (supplyPrice > 0 && borrowPrice > 0) {
                const supplyUsd = Number(chainData.totalSupply) / 10 ** supplyDec * supplyPrice
                const borrowUsd = Number(chainData.totalBorrow) / 10 ** borrowDec * borrowPrice
                utilization = borrowUsd > 0 && supplyUsd > 0 ? borrowUsd / supplyUsd * 100 : 0
              }
            }
          }
          // Non-borrowable assets (e.g. SparkLend wstETH/WBTC): still fill Supply fields,
          // but keep Loan/Borrow columns (borrowAPY/totalBorrowed/utilization) as '-'
          const noBorrow = item.borrowable === false
          return {
            ...item,
            supplyAPY: collateralNoApy ? '-' : formatPercent(chainData.supplyAPY),
            borrowAPY: noBorrow ? '-' : formatPercent(chainData.borrowAPY),
            totalSupplied: formatTokenAmount(chainData.totalSupply, supplyDec),
            totalBorrowed: noBorrow ? '-' : formatTokenAmount(chainData.totalBorrow, borrowDec),
            utilization: noBorrow ? '-' : formatPercent(utilization),
          }
        } catch (e) {
          console.warn(`[Lending] ${item.poolId}/${item.asset} 数据填充失败:`, e)
          return {
            ...item,
            supplyAPY: '-', borrowAPY: '-',
            totalSupplied: '-', totalBorrowed: '-', utilization: '-',
          }
        }
      })
    }

    // Dedupe by base protocol (compound-eth/usdc/usdt share the same protocol data) to reduce RPC requests
    const protocolIds = [...new Set(items.map(i => (i.protocolId || i.poolId || '').split('-')[0]))]
    protocolIds.forEach(protoId => {
      getLendingRates(protoId)
        .then(async rates => {
          const prices = await getLendingPrices().catch(() => null)
          applyPoolData(protoId, rates, prices)
        })
        .catch(e => console.warn(`[Lending] ${protoId} 链上利率获取失败:`, e))
    })

  } catch (err: any) {
    console.error('[Lending] load failed:', err)
    error.value = err.message
    apiData.value = []
    toast.show('API connection error, please try again later', 'error')
  } finally {
    loading.value = false
  }
}

// When Tab or search criteria change, computed automatically recalculates the full list

const rawData = computed(() => {
    let data = apiData.value

    // 1. Filter asset categories by Tab
    if (activeTab.value !== 'ALL') {
      const ethBased = ['ETH', 'stETH', 'wstETH']
      const btcBased = ['WBTC', 'tBTC']
      const stablecoins = ['USDT', 'USDC', 'DAI']

      if (activeTab.value === 'ETH Based') {
        data = data.filter(item => ethBased.includes(item.asset))
      } else if (activeTab.value === 'BTC Based') {
        data = data.filter(item => btcBased.includes(item.asset))
      } else if (activeTab.value === 'Stablecoins') {
        data = data.filter(item => stablecoins.includes(item.asset))
      } else if (activeTab.value === 'Others') {
        // Others: assets that do not belong to any category above
        data = data.filter(item =>
          !ethBased.includes(item.asset) &&
          !btcBased.includes(item.asset) &&
          !stablecoins.includes(item.asset)
        )
      }
    }

    // 2. Search keyword filtering
    if (keyword.value?.trim()) {
      const k = keyword.value.toLowerCase()
      data = data.filter(item =>
        item.protocol.toLowerCase().includes(k) ||
        item.asset.toLowerCase().includes(k) ||
        item.loanAsset?.toLowerCase().includes(k)
      )
    }

    return data
  })
// Sort Status
const sortKey = ref('')
const sortOrder = ref('') // 'asc' | 'desc'

function sort (key) {
  if (sortKey.value !== key) {
    sortKey.value = key
    sortOrder.value = 'asc'
  } else {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : sortOrder.value === 'desc' ? '' : 'asc'
    if (!sortOrder.value) sortKey.value = ''
  }
}

// Pagination status: 7 rows per page (consistent with Portfolio modules), fixed 552px height fits exactly 7 rows
const page = ref(1)
const pageSize = ref(7)

// No pagination on mobile: show all rows directly; 7 rows per page on desktop
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth <= 768)
function syncIsMobile() {
  isMobile.value = window.innerWidth <= 768
}
onMounted(() => window.addEventListener('resize', syncIsMobile))
onUnmounted(() => window.removeEventListener('resize', syncIsMobile))

// Toggle Tab to go back to the first page
watch(activeTab, () => {
  page.value = 1
})

// Typing a search keyword goes back to page 1, so the full-page (cross-page)
// filter results always render from the top instead of a stale page slice.
watch(keyword, () => {
  page.value = 1
})

const sortedData = computed(() => {
  const all = sortRows(rawData.value, sortKey.value, sortOrder.value)
  // Mobile does not paginate, returns directly to all rows
  if (isMobile.value) return all
  const start = (page.value - 1) * pageSize.value
  return all.slice(start, start + pageSize.value)
})

const totalPages = computed(() => Math.ceil(rawData.value.length / pageSize.value) || 1)

function sortCls (key) {
  if (sortKey.value !== key) return ''
  return sortOrder.value === 'asc' ? 'asc' : 'desc'
}

/* Balance first mock, followed by real data */
const userEthBalance = useUserEthBalance()

/* Popup switch + currently selected row data */
const lendingModalVisible = ref(false)
const selectedItem = ref<StableItem | null>(null)

const walletStore = useWalletStore()
const { address } = storeToRefs(walletStore)

/**
 * Compute a pooled protocol's borrowable (USD) the same way the Portfolio Borrow
 * entry does. Fluid/Morpho use a sticky global pool context (setFluidPool/
 * setMorphoPool) that the modal's own query may inherit in a stale state, leaving
 * the borrowable at 0; pre-computing here and passing it as `available` gives the
 * modal Borrow tab a reliable fallback.
 */
async function computePoolBorrowableUsd(item: any): Promise<number> {
  const poolId = item.poolId || item.protocolId || ''
  const base = poolId.split('-')[0]
  // Only pooled protocols with a sticky pool context (Fluid/Morpho) need
  // pre-computation; the modal's own query already works for account-level
  // protocols (aave/sparklend), so skip them to avoid extra RPC calls.
  if (base !== 'fluid' && base !== 'morpho') return 0
  const adapter = lending.getByPool(poolId)
  if (!adapter?.getAvailableBorrows || !address.value) return 0
  try {
    if (base === 'fluid') setFluidPool(poolId)
    if (base === 'morpho') setMorphoPool(poolId)
    const cents = await adapter.getAvailableBorrows(address.value as `0x${string}`)
    return cents > 0n ? Number(cents) / 100 : 0
  } catch (e) {
    console.warn('[Lending] computePoolBorrowableUsd failed:', poolId, e)
    return 0
  }
}

/* After hiding the action column on the mobile side, click on the row to open the corresponding action pop-up window */
function onRowClick(item: StableItem) {
  if (window.innerWidth <= 768) {
    openStable(item)
  }
}

/* Open popup */
function openStable(item: StableItem) {
  // Consistent with other entry points (Portfolio/Home): uniformly fill poolId/decimals/risk/loanAsset fields,
  // so modal content (wallet balance, APY, borrowable/withdrawable amounts) matches the Portfolio Lending entry.
  // Open the modal immediately — do NOT await the borrowable query (it would delay the popup). Instead
  // pre-compute it in the background and set `available`; the Borrow tab picks it up via a watch on
  // props.balance (lendingOp/borrow.vue) so it still shows a real balance when the internal Fluid/Morpho
  // pool-context query returns 0.
  selectedItem.value = enrichLendingItem(item, 'supply')
  lendingModalVisible.value = true
  if (item.borrowable !== false) {
    computePoolBorrowableUsd(item).then((usd) => {
      if (usd > 0 && selectedItem.value) selectedItem.value.available = '$' + usd.toFixed(2)
    })
  }
}

/* Callback after the transaction is completed in the pop-up window */
function handleStake() {
  // Lending operations do not change the protocol list data; no refresh needed
}

/* Lifecycle - Get data when component is mounted */
onMounted(() => {
  fetchData()
})

</script>

<style scoped>
/* Overall Page */
.lending-page {
  background-image:url("@/assets/img/stakebg.png") ;
  color: #fff;
  padding: 110px 0 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}
.container {
  max-width: 1300px;
  margin: 0 auto;
}
/* Title */
.header h1 {
  font-feature-settings: 'salt' on, 'liga' off;
  font-family: Raleway;
  font-size: 36px;
  font-style: normal;
  font-weight: 700;
  line-height: 44px; /* 122.222% */
  background: linear-gradient(90deg, #EECF75 0%, #887643 14.98%);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.header p {
  margin-top: 10px;
  color: var(--Secondary-300, #ACB5BB);

  /* Regular/Type@20 */
  font-family: Inter;
  font-size: 20px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 30px */
  letter-spacing: -0.4px;
  }

.loading-state, .empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #ACB5BB;
  font-size: 18px;
  min-height: 480px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.crypto-table {
  margin: 0 0 23px;
  max-width: 1300px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: var(--High-Fidelity-Color-Card-Background, rgba(255, 255, 255, 0.02));
  /* Fix the table area height to avoid page flip buttons/footer jumping up and down when the number of rows at the end of the page is small */
  height: 552px;
}


.filter-bar { 
  display: flex; 
  align-items: center; 
  justify-content: space-between; 
  flex-wrap: wrap; 
  gap: 12px; 
  background:rgba(255,255,255,0);
  padding: 13px 0 10px;
}
.tabs { display: flex; gap: 8px; }
.tabs button {
  display: flex;
  height: 23px;
  padding: 0 15px;
  justify-content: center;
  align-items: center;
  gap: 15px;
  border-radius: 15px;
  border: 1px solid #343437;
  color: var(--Tab-Color, #9E9E9E);
  text-align: center;
  font-family: Poppins;
  font-size: 12px;
  font-style: normal;
  font-weight: 500;
  line-height: 22px; /* 183.333% */
}
.tabs button.active,
.tabs button:hover {
  border-radius: 15px;
  border: 1px solid var(--Primary-Default, #FFDD94);
  color: var(--Primary-Default, #FFDD94);
  text-align: center;
  font-family: Poppins;
  font-size: 12px;
  font-style: normal;
  font-weight: 500;
  line-height: 22px; /* 183.333% */
}
.search-box{
  display: flex;
  align-items: center;
  gap:16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 14px;
  width: 200px;
  background-color: rgba(255,255,255,0);
  border-radius: 8px;
  border: 1px solid var(--Secondary-600, #2C2C30);
  background: var(--Secondary-700, #161618);
  outline: none;
}
.search-box input {
  width: 100px;
  background: rgba(255,255,255,0);
  outline: none;
}
.search-box .search,img {
  width:16px;
  height:16px;
}
.search-box .close,img {
  width:24px;
  height:24px;
}
table {
  width: 100%;
  border-collapse: collapse;
  /* Fixed table layout: column width is determined by th width, flipping/sorting no longer recalculates column width with content */
  table-layout: fixed;
}

/* Fix Lending desktop column widths to prevent layout jumps when column widths differ across pages */
.crypto-table thead th:nth-child(1),
.crypto-table tbody td:nth-child(1) { width: 12%; }
.crypto-table thead th:nth-child(2),
.crypto-table tbody td:nth-child(2) { width: 10%; }
.crypto-table thead th:nth-child(3),
.crypto-table tbody td:nth-child(3) { width: 12%; }
.crypto-table thead th:nth-child(4),
.crypto-table tbody td:nth-child(4) { width: 10%; }
.crypto-table thead th:nth-child(5),
.crypto-table tbody td:nth-child(5) { width: 10%; }
.crypto-table thead th:nth-child(6),
.crypto-table tbody td:nth-child(6) { width: 12%; }
.crypto-table thead th:nth-child(7),
.crypto-table tbody td:nth-child(7) { width: 10%; }
.crypto-table thead th:nth-child(8),
.crypto-table tbody td:nth-child(8) { width: 9%; }
.crypto-table thead th:nth-child(9),
.crypto-table tbody td:nth-child(9) { width: 7%; }
.crypto-table thead th:nth-child(10),
.crypto-table tbody td:nth-child(10) { width: 8%; }

.protocol {
  display: flex;
  align-items: center;
  gap: 7px;
}

.tag {
  background: #f0f0f0;
  color: #555;
  font-size: 11px;
  padding: 3px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.total {
  font-weight: 600;
  color: #16a34a;
}
.sort {
  display: flex;
  flex-direction: column;
  align-items:center;
  width:5px;
  margin-left:9px;
}
.sort-icon {
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  transition: border-color 0.2s;
}
.up {
  border-bottom-color:rgba(255,255,255,0.2);
  border-bottom: 6px solid #ccc;
  transform:translateY(-1px);
}
.down { 
  border-top-color:rgba(255,255,255,0.2);
  border-top: 6px solid #ccc;
  transform:translateY(1px);
}
.asc .up {
  border-bottom-color:rgba(255,255,255,1);
}
.desc .down { 
  border-top-color:rgba(255,255,255,1);
}

.protocol img {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}
.collateral {
  display: flex;
}
.collateral img {
  width:30px;
  height:30px;
  margin-left:-15px;
  transform:translateX(15px);
}

/* asset */
.asset {
  display: flex;
  align-items: center;
  gap: 10px;
}

.asset img {
  width: 40px;
  height: 40px;
}

/* total apy */
.total {
  font-weight: 600;
}

.op-btn-wrapper {
  display: flex;
  gap: 10px;
}
/* stake button */
.op-btn {
  display: flex;
  width: 60px;
  padding: 4px 24px;
  justify-content: center;
  align-items: flex-start;
  gap: 10px;
  border-radius: 10px;
  background: var(--gold, linear-gradient(90deg, #C49A4C 30.29%, #F6D77B 69.23%, #B1822A 100%));
  color: var(--Font-Color-Pure-White, #FFF);
  text-align: center;

  /* Semibold/Type@16 */
  font-family: Inter;
  font-size: 16px;
  font-style: normal;
  font-weight: 600;
  line-height: 150%; /* 24px */
  letter-spacing: -0.32px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.stake-btn:hover {
  opacity: 0.85;
}

/* Action Button */
.list-op-btn {
  display: flex;
  padding: 4px 24px;
  justify-content: center;
  align-items: center;
  border-radius: 10px;
  background: var(--gold, linear-gradient(90deg, #C49A4C 30.29%, #F6D77B 69.23%, #B1822A 100%));
  color: #FFF;
  font-family: Inter;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.list-op-btn:hover {
  opacity: 0.85;
}

/* = = = = = = = = = = Mobile Adaptation (< 768px) = = = = = = = = = = = */
@media (max-width: 768px) {
  .lending-page {
    padding: 80px 0 0;
    background-image: none;
    min-height: auto;
    height: auto;
  }

  .container {
    max-width: 100%;
    padding: 0 16px;
  }

  .header h1 {
    font-size: 24px;
    line-height: 32px;
  }

  .header p {
    font-size: 14px;
    line-height: 20px;
  }

  /* Filter bar */
  .filter-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .tabs {
    flex-wrap: wrap;
    gap: 6px;
  }

  .tabs button {
    height: 28px;
    font-size: 12px;
    padding: 0 10px;
  }

  .search-box {
    width: 100%;
  }

  .search-box input {
    width: 100%;
  }

  .loading-state, .empty-state {
    min-height: auto;
    padding: 40px 20px;
  }

  .crypto-table {
    margin: 16px 0 12px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    background: rgba(255, 255, 255, 0.02);
    min-height: auto;
    height: auto;
  }

  /* Mobile keeps the table list: only the Protocol / Asset / Supply APY / Borrow APY columns */
  .crypto-table table {
    display: table;
    width: 100%;
    table-layout: fixed;
    font-size: 12px;
  }

  .crypto-table thead {
    display: table-header-group;
  }

  .crypto-table tbody {
    display: table-row-group;
  }

  .crypto-table tbody tr {
    display: table-row;
    padding: 0;
    border: none;
    background: transparent;
    gap: 0;
  }

  .crypto-table tbody tr.table-row {
    cursor: pointer;
  }

  .crypto-table tbody tr.table-row:active {
    background: rgba(255, 255, 255, 0.04);
  }

  .crypto-table thead th,
  .crypto-table tbody tr td {
    display: table-cell;
    height: auto;
    padding: 10px 6px;
    border: 0px solid rgba(255, 255, 255, 0.05) !important;
    font-size: 12px;
    line-height: 18px;
    word-break: break-word;
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
  }

  /* Column widths: Protocol / Asset / Supply APY / Borrow APY */
  .crypto-table thead th:first-child,
  .crypto-table tbody tr td:first-child {
    width: 32%;
  }

  .crypto-table thead th:nth-child(2),
  .crypto-table tbody tr td:nth-child(2) {
    width: 28%;
  }

  .crypto-table thead th:nth-child(4),
  .crypto-table tbody tr td:nth-child(4) {
    width: 20%;
  }

  .crypto-table thead th:nth-child(7),
  .crypto-table tbody tr td:nth-child(7) {
    width: 20%;
  }

  /* Hide Total Supplied / Loan / Total Borrowed / Utilization / Launch Year / action columns on mobile */
  .crypto-table thead th:nth-child(3),
  .crypto-table thead th:nth-child(5),
  .crypto-table thead th:nth-child(6),
  .crypto-table thead th:nth-child(8),
  .crypto-table thead th:nth-child(9),
  .crypto-table thead th:nth-child(10),
  .crypto-table tbody tr td:nth-child(3),
  .crypto-table tbody tr td:nth-child(5),
  .crypto-table tbody tr td:nth-child(6),
  .crypto-table tbody tr td:nth-child(8),
  .crypto-table tbody tr td:nth-child(9),
  .crypto-table tbody tr td:nth-child(10) {
    display: none;
  }

  .crypto-table .sortable {
    padding-right: 0;
  }

  .crypto-table .sort {
    width: 4px;
    margin-left: 3px;
  }

  .crypto-table .sort-icon {
    border-left-width: 3px;
    border-right-width: 3px;
  }

  .crypto-table .up {
    border-bottom-width: 4px;
  }

  .crypto-table .down {
    border-top-width: 4px;
  }

  .protocol img,
  .asset img {
    width: 26px;
    height: 26px;
  }

  .protocol {
    gap: 4px;
  }

  .asset {
    gap: 4px;
  }

  /* Mobile Collateral two-row structure (following Portfolio Asset to supply) */
  .crypto-table .asset-pair {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .crypto-table .asset-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .crypto-table .icon-sm {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* ===== Mobile rows stay one horizontal table line, styled as rounded cards ===== */
  .crypto-table {
    border: none;
    background: transparent;
  }

  .crypto-table table {
    border-collapse: separate;
    border-spacing: 0 8px;
  }

  .crypto-table thead th {
    padding: 0 6px 8px;
    border: none;
    background: transparent;
    color: #7A8A94;
    font-size: 11px;
    line-height: 16px;
    font-weight: 500;
  }

  .crypto-table tbody tr td {
    background: #1a1a1a;
  }

  .crypto-table tbody tr td:first-child {
    border-radius: 10px 0 0 10px;
  }

  .crypto-table tbody tr.table-row:active td {
    background: #2a2a2a;
  }

  /* Last visible column (Borrow APY): rounded right corner + reserved space for the arrow */
  .crypto-table tbody tr.table-row td:nth-child(7) {
    border-radius: 0 10px 10px 0;
    position: relative;
    padding-right: 24px;
  }

  /* Right arrow: hints the row opens the next screen */
  .crypto-table tbody tr.table-row td:nth-child(7)::after {
    content: '›';
    position: absolute;
    right: 7px;
    top: 50%;
    transform: translateY(-50%);
    color: rgba(255, 255, 255, 0.3);
    font-size: 20px;
    line-height: 1;
  }
}

/* = = = = = = = = = = Medium screen (768px-1024px) = = = = = = = = = = = */
@media (min-width: 768px) and (max-width: 1024px) {
  .container {
    max-width: 100%;
    padding: 0 24px;
  }

  .crypto-table {
    margin: 24px 0 16px;
  }

  .crypto-table table {
    font-size: 14px;
  }

  .protocol img,
  .asset img {
    width: 32px;
    height: 32px;
  }
}
@media (min-width: 768px) and (max-width: 1200px) {
  .list-op-btn {
    min-width:64px;
    display: flex;
    padding: 4px 15px;
    justify-content: center;
    align-items: center;
    border-radius: 10px;
    background: var(--gold, linear-gradient(90deg, #C49A4C 30.29%, #F6D77B 69.23%, #B1822A 100%));
    color: #FFF;
    font-family: Inter;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
    box-sizing:border-box;
  }
}
</style>
