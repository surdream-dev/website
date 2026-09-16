<!-- Portfolio stablecoins.vue - shows Stablecoin positions -->
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
          <tr v-if="row.protocol && row.asset">
            <td>
              <div class="protocol">
                <img :src="getProtocolIcon(row.protocolId, row.icon)"/>
                {{ row.protocol }}
              </div>
            </td>
            <td>
              <div class="asset">
                <img :src="getAssetIcon(row.asset, row.assetIcon)"/>
                {{ row.asset }}
                <span v-if="row.receiptTokenSymbol" class="receipt-badge">{{ row.receiptTokenSymbol }}</span>
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
    <div v-if="!loading && sortedData.length === 0" class="empty">No stablecoin positions</div>
  </div>
  <PaginationDot v-if="!isMobile" v-model="page" :total="totalPages" />
</template>

<script setup lang="ts">
import PaginationDot from '@/components/pagination.vue'
import { usePortfolioStablecoin, isStakeDustPosition } from '@/composables/usePortfolioChainData'
import { getProtocolIcon, getAssetIcon } from '@/utils/icons'
import { sortPortfolioPositions } from '@/utils/portfolioPositionSort'
import type { PortfolioPosition } from '@/types/portfolio'

import { computed, ref, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  keyword?: string
  protocols?: string[]
}>()

const emit = defineEmits<{
  openOperation: [row: PortfolioPosition]
}>()

// Use the chain-sourced Stablecoin positions composable
const { positions, loading, total, page, pageSize, loadMore } = usePortfolioStablecoin()

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

// Filter stablecoin-type data
const stablecoinPositions = computed(() => {
  return positions.value.filter(p => p.category === 'stablecoin')
})

// Search keyword filtering
const filteredData = computed(() => {
  let arr = stablecoinPositions.value

  // Hide staking/Ethena dust (< $0.001)
  arr = arr.filter(r => !isStakeDustPosition(r))

  if (props.keyword?.trim()) {
    const k = props.keyword.toLowerCase()
    arr = arr.filter(r =>
      r.protocol.toLowerCase().includes(k) ||
      r.asset.toLowerCase().includes(k)
    )
  }

  // Protocol filtering (same as all pages)
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
  { key: 'apyFormatted', label: 'APY' },
  { key: 'balance', label: 'Balance', sortable: false },
  { key: 'balanceUsd', label: 'Value' }
]

const sortKey = ref('')
const sortOrder = ref('')

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
  if (!sortKey.value) return sortPortfolioPositions(filteredData.value)

  const copied = [...filteredData.value]
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
  // Mobile: No pagination, show all.
  if (isMobile.value) return sortedFull.value

  const start = (page.value - 1) * pageSize.value
  return sortedFull.value.slice(start, start + pageSize.value)
})

const totalPages = computed(() => {
  // Prefer the total number returned by the back-end, fallback to the length after the front-end filtering
  const count = total.value > 0 ? total.value : filteredData.value.length
  return Math.ceil(count / pageSize.value) || 1
})

function sortCls(key: string) {
  if (sortKey.value !== key) return ''
  return sortOrder.value === 'asc' ? 'asc' : 'desc'
}

function getOperationLabel(row: PortfolioPosition): string {
  if (row.type === 'withdraw') return 'Claim'
  return 'Withdraw'
}

function openOperation(row: PortfolioPosition) {
  emit('openOperation', row)
}
</script>

<style scoped>
.crypto-table {
  margin: 0 0 23px;
  max-width: 1300px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.02);
  /* Fixed table area height to avoid page flip buttons/footer jumping up and down when the number of rows at the end of the page is small (align Portfolio all.vue) */
  height: 552px;
}

table {
  width: 100%;
  border-collapse: collapse;
  /* Fixed table layout: column width is determined by th width, flipping/sorting no longer recalculates column width with content */
  table-layout: fixed;
}

/* Fix stablecoins desktop column widths to prevent layout jumps across pages */
.crypto-table thead th:nth-child(1),
.crypto-table tbody td:nth-child(1) { width: 17%; }
.crypto-table thead th:nth-child(2),
.crypto-table tbody td:nth-child(2) { width: 19%; }
.crypto-table thead th:nth-child(3),
.crypto-table tbody td:nth-child(3) { width: 13%; }
.crypto-table thead th:nth-child(4),
.crypto-table tbody td:nth-child(4) { width: 16%; }
.crypto-table thead th:nth-child(5),
.crypto-table tbody td:nth-child(5) { width: 16%; }
.crypto-table thead th:nth-child(6),
.crypto-table tbody td:nth-child(6) { width: 10%; }

.crypto-table tbody td {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  width: 40px;
  height: 40px;
}

.receipt-badge {
  font-size: 10px;
  padding: 2px 6px;
  background: rgba(16, 185, 129, 0.2);
  color: #10b981;
  border-radius: 4px;
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
}
.up {
  border-bottom: 6px solid #ccc;
  transform: translateY(-1px);
}
.down {
  border-top: 6px solid #ccc;
  transform: translateY(1px);
}
.asc .up {
  border-bottom-color: #fff;
}
.desc .down {
  border-top-color: #fff;
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
  color: #ACB5BB;
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
    padding: 16px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.02);
    gap: 10px 12px;
  }

  .crypto-table tbody tr td {
    padding: 0;
    border: none;
    /* Reset desktop fixed column width (td %) to avoid affecting mobile card layout */
    width: auto !important;
    display: flex;
    flex-direction: row;
    align-items: stretch;
    gap: 4px;
    font-size: 13px;
    line-height: 18px;
  }

  /* Other fields (except Protocol/Asset/button): add 3px vertical padding */
  .crypto-table tbody tr td:nth-child(3),
  .crypto-table tbody tr td:nth-child(4),
  .crypto-table tbody tr td:nth-child(5) {
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

  /* Line 2: APY + Balance */
  .crypto-table tbody tr td:nth-child(3) {
    grid-column: 1;
    grid-row: 2;
  }

  .crypto-table tbody tr td:nth-child(3)::before {
    content: 'APY:';
    color: #ACB5BB;
    font-size: 11px;
  }

  .crypto-table tbody tr td:nth-child(4) {
    grid-column: 2;
    grid-row: 2;
    text-align: left;
  }

  .crypto-table tbody tr td:nth-child(4)::before {
    content: 'Balance:';
    color: #ACB5BB;
    font-size: 11px;
  }

  /* Line 3: Value spans the full row */
  .crypto-table tbody tr td:nth-child(5) {
    grid-column: 1 / -1;
    grid-row: 3;
    text-align: left;
  }

  .crypto-table tbody tr td:nth-child(5)::before {
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
  }

  .receipt-badge {
    font-size: 10px;
    padding: 2px 4px;
  }

  .list-op-btn {
    width: 100%;
    min-width: 0;
    padding: 8px 6px;
    text-align: center;
  }

  .loading, .empty {
    padding: 40px 20px;
    font-size: 14px;
  }
}
</style>
