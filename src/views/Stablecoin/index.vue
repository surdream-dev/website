<template>
  <section class="stablecoins-page page bg-black text-gray-100 font-sans items-center justify-items-center">
    <div class="container">
      <!-- Title -->
      <header class="header">
        <h1>Stablecoins</h1>
        <p>
          Compare the best stablecoin yield opportunities and maximize your boosted APY across top DeFi protocols.
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
                  <img v-if="row.protocol" :src="getIcon(row.protocol)"/>
                  {{ row.protocol }}
                </div>
              </td>
              <td>
                <div class="asset">
                  <img v-if="row.asset" :src="getIcon(row.asset)"/>
                  {{ row.asset }}
                </div>
              </td>
              <td>
                {{ row.tvl }}
                <Tooltips
                  v-if="row.protocolId === 'ethena'"
                  head="Ethena"
                  content="TVL from DefiLlama"
                  contentmore="Only includes sUSDe (staked USDe)"
                >
                  <span class="tip-icon">!</span>
                </Tooltips>
              </td>
              <td>
                {{ row.apy }}
                <Tooltips
                  v-if="row.protocolId === 'ethena'"
                  head="Ethena"
                  content="APY from DefiLlama"
                >
                  <span class="tip-icon">!</span>
                </Tooltips>
              </td>
              <td>
                <div v-if="row.curator && row.curator !=='false'" class="asset">
                  {{ row.curator }}
                </div>
                <div v-else>---------</div>
              </td>
              <td>
                <div v-if="row.collateral && row.collateral !== 'false' && Array.isArray(row.collateral) && row.collateral.length > 0" class="collateral">
                  <img v-for="(col, i) in row.collateral" :key="i" :src="getIcon(typeof col === 'string' ? col : col.symbol)"/>
                </div>
                <div v-else>---------</div>
              </td>
              <td>{{ row.category }}</td>
              <td>{{ row.launchYear }}</td>
              <td>
                <div class="list-op-btn" @click="openStable(row)">Earn</div>
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
  <StablecoinsModal v-model="stableModalVisible" :balance="userEthBalance" :selectedItem="selectedItem" :availableTabs="stablecoinModalTabs" @stake="handleStake" />
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { getStablecoinTvlUsd, getStablecoinApy, formatUsd, buildStablecoinOpItem } from '@/composables/useStablecoinData'
import { stablecoinProtocols, lendingPools } from '@/constants/protocols'
import StablecoinsModal from '@/components/stablecoinsOp/index.vue'
import PaginationDot from '@/components/pagination.vue'
import { useUserEthBalance } from '@/composables/useBalance'

/**
 * Fluid stablecoin rows = fUSDT/fUSDC pure supply pools (different from the Lending page's cross-asset vault pools).
 * The official REST tokens endpoint returns supplyRate (percent×100) and totalAssets (underlying wei).
 */
import FOOT from '../../components/Foot.vue'
import Tooltips from '@/components/tooltips.vue'
import { toast } from '@/utils/toast'
import { sortRows } from '@/utils/sort'

// Popup tabs configuration
const stablecoinModalTabs = ['Deposit', 'Withdraw']

// API Data Status
const loading = ref(false)
const error = ref('')
const apiData = ref<any[]>([])
const keyword = ref('')
interface StableItem {
  protocol: string
  icon: string
  asset: string
  tvl: string
  apy: string
  curator: string
  collateral: string
  category: string
  year: number
}
// const activeTab = ref<'ALL'|'USDT'| 'USDC'| 'DAI'| 'USDS'| 'USDe'| 'PYUSD'| 'GHO'| 'USDtb'| 'EURC'| 'RLUSD'| 'SyrupUSDC'>('ALL')
// const tabs: Array<typeof activeTab.value> = ['ALL', 'USDT', 'USDC', 'DAI', 'USDS', 'USDe', 'PYUSD', 'GHO', 'USDtb', 'EURC', 'RLUSD', 'SyrupUSDC']
const activeTab = ref<'ALL'|'USDT'| 'USDC'| 'USDe'>('ALL')
const tabs: Array<typeof activeTab.value> = ['ALL', 'USDT', 'USDC', 'USDe']
// Bulk import using Vite's import.meta.glob
const icons = import.meta.glob('@/assets/logos/*.svg', { 
  eager: true,
  import: 'default' 
})
// Extract symbol from path
const getIcon = (symbol?: string | null) => {
  if (!symbol) return '/src/assets/logos/stablecoin.svg' // Default icons
  
  const symbolLower = symbol.toLowerCase()
  for (const [path, icon] of Object.entries(icons)) {
    if (path.includes(symbolLower)) {
      return icon as string
    }
  }
  return '/src/assets/logos/stablecoin.svg' // Return to default icon when not found
}
const columns = [
  { key: 'protocol', label: 'Protocol' },
  { key: 'asset', label: 'Asset' },
  { key: 'tvl', label: 'TVL' },
  { key: 'apy', label: 'APY' },
  { key: 'curator', label: 'Curator' },
  { key: 'collateral', label: 'Collateral' },
  { key: 'category', label: 'Category' },
  { key: 'launchYear', label: 'Launch Year' }
]

// API data conversion
function formatPercent(val: number | string | undefined): string {
  const num = typeof val === 'string' ? parseFloat(val) : (val ?? 0)
  if (num < 0.01) return '<0.01%'
  return num.toFixed(2) + '%'
}

// Row → operation modal data: base fields go through the shared buildStablecoinOpItem (same source as Home Top APY); icon/tvl/apy/metrics are filled here
function formatStablecoinItem(item: any) {
  return {
    ...buildStablecoinOpItem(item),
    icon: getIcon(item.asset),
    tvl: item.metrics?.tvlFmt || '-',
    apy: '-',
    metrics: {
      apy: item.metrics?.apy || 0,
      tvl: item.metrics?.tvl || 0,
      tvlFmt: item.metrics?.tvlFmt || '$0'
    }
  }
}

// Access Data
async function fetchData() {
  loading.value = true
  error.value = ''

  try {
    // No longer depends on the backend API: the protocol list comes from local config (consistent with the backend response),
    // collateral is mapped from lendingPools' collateral assets (lending protocol rows)
    // Hide Curve (almost no revenue, no product display)
    let items = stablecoinProtocols.filter(p => p.protocolId !== 'curve').map(p => {
      const pool = lendingPools.find(x => x.protocolId === p.protocolId)
      return {
        protocolId: p.protocolId,
        name: p.name,
        asset: p.asset,
        assetAddress: p.assetAddress,
        decimals: p.decimals,
        contracts: p.contracts,
        receiptTokenSymbol: p.receiptTokenSymbol || '',
        category: p.category || 'lending',
        curator: p.curator,
        launchYear: p.launchYear || 0,
        collateral: (pool?.collateralAssets || []).map(a => a.symbol),
    metrics: { apy: undefined, tvl: 0, tvlFmt: '-' },
      }
    }).map(formatStablecoinItem)

    // Static rows (Protocol/Asset/Curator/Collateral/Launch Year) render first; TVL/APY dynamic fields are '-'
    apiData.value = items
    loading.value = false

    // TVL/APY line-by-line asynchronous padding: first to return, first to show, not to block other lines
    items.forEach((item: any) => {
      const pid = (item.protocolId || '').toLowerCase()
      const row = () => apiData.value.find((r: any) =>
        (r.protocolId || '').toLowerCase() === pid &&
        (r.asset || '').toLowerCase() === (item.asset || '').toLowerCase()
      )

      // TVL: uniformly via useStablecoinData (ethena=DefiLlama; lending=on-chain pool total × price; others=adapter)
      ;(async () => {
        try {
          const tvlUsd = await getStablecoinTvlUsd(item)
          const r = row()
          if (r && tvlUsd !== null && tvlUsd > 0) {
            r.tvl = formatUsd(tvlUsd)
            if (r.metrics) r.metrics.tvl = tvlUsd
          }
        } catch (e) {
          console.warn(`[Stablecoin] ${pid}/${item.asset} TVL 获取失败:`, e)
        }
      })()

      // APY: shares getStablecoinApy with Home Top APY (Fluid→fToken supplyRate, Morpho→vault netApy, lending→on-chain rates, others→official APIs)
      ;(async () => {
        try {
          const apy = await getStablecoinApy(item)
          const r = row()
          if (!r) return
          r.apy = apy !== null ? apy.toFixed(2) + '%' : '-'
          if (r.metrics) r.metrics.apy = apy ?? undefined
        } catch (e) {
          console.warn(`[Stablecoin] ${pid}/${item.asset} APY 获取失败:`, e)
        }
      })()
    })
  } catch (err: any) {
    console.error('[Stablecoin] API load failed:', err)
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

    // 1. Filter asset types by Tab
    if (activeTab.value !== 'ALL') {
      data = data.filter(item => item.asset.toUpperCase() === activeTab.value.toUpperCase())
    }

    // 2. Search keyword filtering
    if (keyword.value?.trim()) {
      const k = keyword.value.toLowerCase()
      data = data.filter(item =>
        item.protocol.toLowerCase().includes(k) ||
        item.asset.toLowerCase().includes(k)
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
const stableModalVisible = ref(false)
const selectedItem = ref<StableItem | null>(null)

/* After hiding the action column on the mobile side, click on the row to open the corresponding action pop-up window */
function onRowClick(item: StableItem) {
  if (window.innerWidth <= 768) {
    openStable(item)
  }
}

/* Open popup */
function openStable(item: StableItem) {
  selectedItem.value = item
  stableModalVisible.value = true
}

/* Callback after the transaction is completed in the pop-up window */
function handleStake() {
  // Operations do not change the protocol list data; no refresh needed
}

/* Lifecycle - Get data when component is mounted */
onMounted(() => {
  fetchData()
})

</script>

<style scoped>
/* Overall Page */
.stablecoins-page {
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
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: var(--High-Fidelity-Color-Card-Background, rgba(255, 255, 255, 0.02));
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

/* Fix Stablecoin desktop column widths */
.crypto-table thead th:nth-child(1),
.crypto-table tbody td:nth-child(1) { width: 13%; }
.crypto-table thead th:nth-child(2),
.crypto-table tbody td:nth-child(2) { width: 12%; }
.crypto-table thead th:nth-child(3),
.crypto-table tbody td:nth-child(3) { width: 12%; }
.crypto-table thead th:nth-child(4),
.crypto-table tbody td:nth-child(4) { width: 10%; }
.crypto-table thead th:nth-child(5),
.crypto-table tbody td:nth-child(5) { width: 13%; }
.crypto-table thead th:nth-child(6),
.crypto-table tbody td:nth-child(6) { width: 14%; }
.crypto-table thead th:nth-child(7),
.crypto-table tbody td:nth-child(7) { width: 10%; }
.crypto-table thead th:nth-child(8),
.crypto-table tbody td:nth-child(8) { width: 8%; }
.crypto-table thead th:nth-child(9),
.crypto-table tbody td:nth-child(9) { width: 8%; }

tbody tr:last-child td {
  border-bottom: none;
}

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
  margin-left:10px;
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
  margin-left:-13px;
  transform:translateX(13px);
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

/* tooltip exclamation point icon: 14px, 0.6 transparency */
.tip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-left: 0px;
  border: 1px solid #ACB5BB;
  border-radius: 50%;
  color: #ACB5BB;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  opacity: 0.6;
  vertical-align: middle;
  cursor: pointer;
}

/* total apy */
.total {
  font-weight: 600;
}

/* stake button */
.stake-btn {
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
  .stablecoins-page {
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

  /* Mobile Preservation Table List: Protocol/Asset/TVL/APY Four Columns Only */
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
  }

  /* Column Width: Protocol/Asset/TVL/APY */
  .crypto-table thead th:first-child,
  .crypto-table tbody tr td:first-child {
    width: 32%;
  }

  .crypto-table thead th:nth-child(2),
  .crypto-table tbody tr td:nth-child(2) {
    width: 23%;
  }

  .crypto-table thead th:nth-child(3),
  .crypto-table tbody tr td:nth-child(3) {
    width: 25%;
  }

  .crypto-table thead th:nth-child(4),
  .crypto-table tbody tr td:nth-child(4) {
    width: 20%;
  }

  /* Hide Curator / Collateral / Category / Launch Year / action columns on mobile */
  .crypto-table thead th:nth-child(5),
  .crypto-table thead th:nth-child(6),
  .crypto-table thead th:nth-child(7),
  .crypto-table thead th:nth-child(8),
  .crypto-table thead th:nth-child(9),
  .crypto-table tbody tr td:nth-child(5),
  .crypto-table tbody tr td:nth-child(6),
  .crypto-table tbody tr td:nth-child(7),
  .crypto-table tbody tr td:nth-child(8),
  .crypto-table tbody tr td:nth-child(9) {
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
    transition: background-color 0.15s ease;
  }

  .crypto-table tbody tr td:first-child {
    border-radius: 10px 0 0 10px;
  }

  .crypto-table tbody tr.table-row:active td {
    background: #2a2a2a;
  }

  /* Last visible column (APY): rounded right corner + reserved space for the arrow */
  .crypto-table tbody tr.table-row td:nth-child(4) {
    border-radius: 0 10px 10px 0;
    position: relative;
    padding-right: 24px;
  }

  /* Right arrow: hints the row opens the next screen */
  .crypto-table tbody tr.table-row td:nth-child(4)::after {
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
