<!-- Portfolio all.vue - shows all positions -->
<template>
  <div class="crypto-table">
    <table>
      <thead>
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            @click="col.sortable !== false && sort(col.key)"
          >
            <div class="sortable">
              <span>{{ col.label }}</span>
              <span v-if="col.sortable !== false" class="sort" :class="sortCls(col.key)">
                <span class="sort-icon up"></span>
                <span class="sort-icon down"></span>
              </span>
            </div>
          </th>
          <th></th>
        </tr>
      </thead>

      <tbody v-if="sortedData.length > 0">
        <template v-for="(row, idx) in sortedData" :key="row.id || idx">
          <tr>
            <td>
              <div class="protocol">
                <img :src="getProtocolIcon(row.protocolId, row.icon)"/>
                {{ row.protocol }}
              </div>
            </td>
            <td>
              <!-- Mobile collateral supplies from single-collateral lending pools: two-row asset-pair
                   (collateral on top + pool borrowable below) so supplies sharing the same collateral across pools
                   (e.g. Compound ETH in USDC vs USDT) are distinguishable -->
              <div v-if="isAssetPair(row)" class="asset-pair">
                <div class="asset-row">
                  <img :src="getAssetIcon(row.asset, row.assetIcon)"/>
                  <span>{{ row.asset }}</span>
                </div>
                <div class="asset-row">
                  <img :src="getAssetIcon(row.loanAsset)"/>
                  <span>{{ row.loanAsset }}</span>
                </div>
              </div>
              <div v-else class="asset">
                <img :src="getAssetIcon(row.asset, row.assetIcon)"/>
                {{ row.asset }}
              </div>
            </td>
            <td>
              <div class="category-list">
                <span class="category-tag" :class="row.category">{{ formatCategory(row.category) }}</span>
                <template v-for="lendingCategory in row.overlappedLendingCategories || []" :key="lendingCategory">
                  <span class="category-tag" :class="lendingCategory">{{ formatCategory(lendingCategory) }}</span>
                </template>
              </div>
            </td>
            <td>{{ row.apyFormatted }}</td>
            <td>{{ row.balance }}</td>
            <td>{{ row.balanceUsd }}</td>
            <td>
              <div class="list-op-btn" @click="openOperation(row)">{{ getOperationLabel(row) }}</div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <div v-if="loading" class="loading">Loading...</div>
    <div v-if="!loading && !isLoggedIn" class="empty">Please connect wallet and sign in to view your positions</div>
    <div v-if="!loading && isLoggedIn && sortedData.length === 0" class="empty">No positions found</div>
  </div>
  <PaginationDot v-if="!isMobile" v-model="page" :total="totalPages" />
</template>

<script setup lang="ts">
import PaginationDot from '@/components/pagination.vue'
import { usePortfolioAll, isStakeDustPosition } from '@/composables/usePortfolioChainData'
import { getProtocolIcon, getAssetIcon } from '@/utils/icons'
import { sortPortfolioPositions } from '@/utils/portfolioPositionSort'
import type { PortfolioPosition } from '@/types/portfolio'

import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  keyword?: string
  protocols?: string[]
}>()

const emit = defineEmits<{
  openOperation: [row: PortfolioPosition]
}>()

// Use the chain-sourced ALL positions composable
const { positions, loading, total, page, pageSize, isLoggedIn, loadMore } = usePortfolioAll()

// Mobile side decision (consistent with CSS breakpoint 768px)
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth <= 768)
function updateIsMobile() {
  isMobile.value = window.innerWidth <= 768
}

// Infinite scroll on mobile: load next page when scrolling to near bottom
function handleScroll() {
  if (!isMobile.value) return
  const doc = document.documentElement
  const nearBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 200
  if (nearBottom) loadMore()
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll, { passive: true })
  window.addEventListener('resize', updateIsMobile)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', handleScroll)
  window.removeEventListener('resize', updateIsMobile)
})

// Filter data
const filteredData = computed(() => {
  let arr = positions.value

  // Hide staking/Ethena dust (< $0.001)
  arr = arr.filter(r => !isStakeDustPosition(r))

  // Search keyword filtering
  if (props.keyword?.trim()) {
    const k = props.keyword.toLowerCase()
    arr = arr.filter(r =>
      r.protocol.toLowerCase().includes(k) ||
      r.asset.toLowerCase().includes(k) ||
      r.category.toLowerCase().includes(k)
    )
  }

  // Protocol filter
  if (props.protocols?.length) {
    arr = arr.filter(r =>
      props.protocols.some(p => r.protocolId.toLowerCase() === p.toLowerCase())
    )
  }

  return arr
})

const columns = [
  { key: 'protocol', label: 'Protocol' },
  { key: 'asset', label: 'Asset' },
  { key: 'category', label: 'Category' },
  { key: 'apyFormatted', label: 'APY' },
  { key: 'balance', label: 'Balance', sortable: false },
  { key: 'balanceUsd', label: 'Value' }
]

// Sort Status
const sortKey = ref('')
const sortOrder = ref('') // 'asc' | 'desc'

function sort(key: string) {
  const isValue = key === 'balanceUsd'
  if (sortKey.value !== key) {
    sortKey.value = key
    // Value: first click descending (largest first, matching the default rule's intuition)
    sortOrder.value = isValue ? 'desc' : 'asc'
    return
  }
  if (sortOrder.value === 'asc') {
    sortOrder.value = isValue ? '' : 'desc'
    if (!sortOrder.value) sortKey.value = ''
  } else if (sortOrder.value === 'desc') {
    sortOrder.value = isValue ? 'asc' : ''
    if (!sortOrder.value) sortKey.value = ''
  } else {
    sortOrder.value = 'asc'
  }
}

// Parse into sortable values
function parseSortValue(row: PortfolioPosition, key: string) {
  const val = row[key as keyof PortfolioPosition]
  if (typeof val === 'string') {
    // Strip non-numeric chars (e.g. "<$0.01" → 0.01, "<0.01%" → 0.01) so small-value
    // rows don't parse to NaN and break the sort
    if (val.includes('%')) return parseFloat(val.replace(/[^0-9.\-]/g, '')) || 0
    if (val.includes('$')) return parseFloat(val.replace(/[^0-9.\-]/g, '')) || 0
  }
  if (typeof val === 'number') return val
  return val || ''
}

const sortedFull = computed(() => {
  // Filter out invalid data first
  const validData = filteredData.value.filter(row => row?.protocol && row?.asset)

  if (!sortKey.value) return sortPortfolioPositions(validData)

  const copied = [...validData]
  copied.sort((a, b) => {
    const v1 = parseSortValue(a, sortKey.value)
    const v2 = parseSortValue(b, sortKey.value)
    if (v1 === '') return 1
    if (v2 === '') return -1
    if (typeof v1 === 'number' && typeof v2 === 'number') {
      // Value column: borrow rows count as negative (liability), consistent with the default rule
      if (sortKey.value === 'balanceUsd') {
        const n1 = a.category === 'lending-borrow' ? -v1 : v1
        const n2 = b.category === 'lending-borrow' ? -v2 : v2
        return sortOrder.value === 'asc' ? n1 - n2 : n2 - n1
      }
      return sortOrder.value === 'asc' ? v1 - v2 : v2 - v1
    }
    return sortOrder.value === 'asc'
      ? String(v1).localeCompare(String(v2))
      : String(v2).localeCompare(String(v1))
  })
  return copied
})

const sortedData = computed(() => {
  // Mobile: No pagination, show all (appended by loadMore scrolling when paginated on the server)
  if (isMobile.value) return sortedFull.value

  // All data is now local; always slice by the current page.
  const start = (page.value - 1) * pageSize.value
  return sortedFull.value.slice(start, start + pageSize.value)
})

// Compute total pages from the frontend-filtered length
const totalPages = computed(() => {
  const count = filteredData.value.length
  return Math.ceil(count / pageSize.value) || 1
})

// Reset pagination to page 1 whenever the search keyword or protocol filter
// changes, otherwise the page stays on a stale offset past the shrunken list
// and renders an empty "No positions found" on pages 2/3.
watch([() => props.keyword, () => props.protocols], () => {
  page.value = 1
})

function sortCls(key: string) {
  if (sortKey.value !== key) return ''
  return sortOrder.value === 'asc' ? 'asc' : 'desc'
}

// Format category labels
function formatCategory(category: string): string {
  const map: Record<string, string> = {
    'staking': 'Staking',
    'stablecoin': 'Stablecoin',
    'lending-supply': 'Supply',
    'lending-borrow': 'Borrow',
    'lending-liquidity': 'Liquidity'
  }
  return map[category] || category
}

// Get the action button label
function getOperationLabel(row: PortfolioPosition): string {
  if (row.category === 'lending-borrow') return 'Repay'
  if (row.category === 'stablecoin' && row.type === 'withdraw') return 'Claim'
  if (row.type === 'stake' || row.type === 'restake') return 'Unstake'
  return 'Withdraw'
}

// Show a two-row asset-pair for collateral supplies from single-collateral lending pools.
// Cross-asset pools (aave/sparklend) and liquidity supplies have no loanAsset, so they stay single-row.
function isAssetPair(row: PortfolioPosition): boolean {
  return row.category === 'lending-supply' && !!row.loanAsset
}

// Open the operation modal
function openOperation(row: PortfolioPosition) {
  emit('openOperation', row)
}
</script>

<style scoped>
:root {
  --bg: #f7f8fc;
  --card: #ffffff;
  --title: #f5c16c;
  --primary: #635bff;
  --profit: #16c784;
  --text1: #1a1d29;
  --text2: #6b7280;
  --border: #e5e7eb;
  --shadow: 0 4px 12px rgba(0,0,0,.05);
  --radius: 16px;
  --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.crypto-table {
  margin: 0 0 23px;
  max-width: 1300px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: var(--High-Fidelity-Color-Card-Background, rgba(255, 255, 255, 0.02));
  /* Fix the table area height to avoid page flip buttons/footer jumping up and down when the number of rows at the end of the page is small */
  height: 552px;
}

table {
  width: 100%;
  border-collapse: collapse;
  /* Fixed table layout: column width is determined by th width, flipping/sorting no longer recalculates column width with content */
  table-layout: fixed;
}

/* Fix Portfolio All desktop column widths */
.crypto-table thead th:nth-child(1),
.crypto-table tbody td:nth-child(1) { width: 15%; }
.crypto-table thead th:nth-child(2),
.crypto-table tbody td:nth-child(2) { width: 15%; }
.crypto-table thead th:nth-child(3),
.crypto-table tbody td:nth-child(3) { width: 14%; }
.crypto-table thead th:nth-child(4),
.crypto-table tbody td:nth-child(4) { width: 13%; }
.crypto-table thead th:nth-child(5),
.crypto-table tbody td:nth-child(5) { width: 16%; }
.crypto-table thead th:nth-child(6),
.crypto-table tbody td:nth-child(6) { width: 16%; }
.crypto-table thead th:nth-child(7),
.crypto-table tbody td:nth-child(7) { width: 11%; }

.crypto-table tbody td {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 统一行高 68px：asset 列即使渲染成两行的 asset-pair，也不会把行高撑高 */
.crypto-table tbody tr {
  height: 68px;
}
.crypto-table tbody tr td {
  vertical-align: middle;
}

tbody tr:last-child td {
  border-bottom: none;
}

.protocol {
  display: flex;
  align-items: center;
  gap: 7px;
  /* protocol is a div in td, does not inherit the nowrap/overflow of .crypto-table tbody td; overwrites the nowrap + flex-wrap inherited by td, and wraps the line when the name cannot be placed within the column width, and is no longer truncated */
  white-space: normal;
  flex-wrap: wrap;
}

.protocol img {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}

.asset {
  display: flex;
  align-items: center;
  gap: 10px;
}

.asset img {
  /* 正常单行 asset 不缩小，按原始尺寸显示（与 Portfolio lending 模块一致），但限制在 40px 内 */
  max-width: 40px;
  max-height: 40px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
}

/* Two-row asset-pair for collateral supplies from single-collateral lending pools
   (collateral on top + pool borrowable below, matches Lending page's Asset column) */
.asset-pair {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.asset-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.asset-row img {
  width: 18px;
  height: 18px;
}

.category-tag {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}
.category-list {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.category-tag.staking {
  background: rgba(102, 126, 234, 0.2);
  color: #667eea;
}
.category-tag.stablecoin {
  background: rgba(16, 185, 129, 0.2);
  color: #10b981;
}
.category-tag.lending-supply {
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
}
.category-tag.lending-borrow {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}
.category-tag.lending-liquidity {
  background: rgba(139, 92, 246, 0.2);
  color: #8b5cf6;
}

.sort {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 5px;
  margin-left: 10px;
}
.sort-icon {
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  transition: border-color 0.2s;
}
.up {
  border-bottom-color: rgba(255,255,255,0.2);
  border-bottom: 6px solid #ccc;
  transform: translateY(-1px);
}
.down {
  border-top-color: rgba(255,255,255,0.2);
  border-top: 6px solid #ccc;
  transform: translateY(1px);
}
.asc .up {
  border-bottom-color: rgba(255,255,255,1);
}
.desc .down {
  border-top-color: rgba(255,255,255,1);
}

.list-op-btn {
  color: var(--Primary-Default, #FFDD94);
  text-align: center;
  font-family: Inter;
  font-size: 12px;
  font-style: normal;
  font-weight: 600;
  line-height: 150%;
  letter-spacing: -0.24px;
  min-width: 80px;
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid var(--Primary-Default, #FFDD94);
  cursor: pointer;
}

.loading, .empty {
  text-align: center;
  color: var(--Secondary-300, #ACB5BB);
  padding: 20px;
}

/* = = = = = = = = = = Mobile Adaptation (< 768px) = = = = = = = = = = = */
@media (max-width: 768px) {
  .crypto-table {
    margin: 16px 0;
    border: none;
    background: transparent;
    /* Reset desktop fixed height (552px), mobile card height is determined by content */
    height: auto;
  }

  .crypto-table table {
    display: block;
  }

  .crypto-table thead {
    display: none;
  }

  .crypto-table tbody {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* Continue with the card: Protocol + Asset in one row and the remaining fields in two or two rows */
  .crypto-table tbody tr {
    display: grid;
    grid-template-columns: 1fr 1fr;
    /* 移动端卡片高度由内容决定，不套用桌面端 68px 行高 */
    height: auto;
    padding: 16px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.02);
    gap: 10px 12px;
  }

  .crypto-table tbody tr td {
    padding: 0;
    border: none;
    /* Reset desktop fixed column widths (th/td percentages) so they do not affect the mobile card grid layout */
    width: auto !important;
    display: flex;
    flex-direction: row;
    align-items: stretch;
    gap: 4px;
    font-size: 13px;
    line-height: 18px;
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
  }

  /* Other fields (except Protocol/Asset/button): add 3px vertical padding; Category label gets the offset on ::before so the value stays put */
  .crypto-table tbody tr td:nth-child(3),
  .crypto-table tbody tr td:nth-child(4),
  .crypto-table tbody tr td:nth-child(5),
  .crypto-table tbody tr td:nth-child(6) {
    padding: 3px 0;
  }

  /* Line 1: Protocol + Asset */
  .crypto-table tbody tr td:nth-child(1) {
    grid-column: 1;
    grid-row: 1;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }

  .crypto-table tbody tr td:nth-child(2) {
    grid-column: 2;
    grid-row: 1;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    text-align: left;
  }

  /* Line 2: Category + APY */
  .crypto-table tbody tr td:nth-child(3) {
    grid-column: 1;
    grid-row: 2;
  }

  .crypto-table tbody tr td:nth-child(3)::before {
    content: 'Category:';
    color: #ACB5BB;
    font-size: 11px;
    padding: 3px 0;
  }

  .crypto-table tbody tr td:nth-child(4) {
    grid-column: 2;
    grid-row: 2;
    text-align: left;
  }

  .crypto-table tbody tr td:nth-child(4)::before {
    content: 'APY:';
    color: #ACB5BB;
    font-size: 11px;
  }

  /* Line 3: Balance + Value */
  .crypto-table tbody tr td:nth-child(5) {
    grid-column: 1;
    grid-row: 3;
  }

  .crypto-table tbody tr td:nth-child(5)::before {
    content: 'Balance:';
    color: #ACB5BB;
    font-size: 11px;
  }

  .crypto-table tbody tr td:nth-child(6) {
    grid-column: 2;
    grid-row: 3;
    text-align: left;
  }

  .crypto-table tbody tr td:nth-child(6)::before {
    content: 'Value:';
    color: #ACB5BB;
    font-size: 11px;
  }

  /* Action button on its own final row, spanning full width */
  .crypto-table tbody tr td:last-child {
    grid-column: 1 / -1;
    grid-row: 4;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    width: 100% !important;
  }

  .protocol {
    gap: 6px;
  }

  .protocol img {
    width: 28px;
    height: 28px;
  }

  .asset {
    gap: 6px;
  }

  .asset img {
    width: 28px;
    height: 28px;
    border-radius: 50%;
  }

  .list-op-btn {
    width: 100%;
    min-width: 80px;
    padding: 8px 14px;
    text-align: center;
  }

  .loading, .empty {
    padding: 40px 20px;
    font-size: 14px;
  }
}
</style>
