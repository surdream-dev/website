<!-- Portfolio tx.vue - shows transaction history -->
<template>
  <div class="crypto-table">
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
        </tr>
      </thead>

      <tbody>
        <tr v-for="(row, idx) in sortedData" :key="idx">
          <td>{{ row.date }}</td>
          <td>
            <div class="protocol">
              <img :src="getProtocolIcon(row.protocolId, row.icon)"/>
              {{ row.protocol }}
            </div>
          </td>
          <td>
            <div class="asset">
              <img :src="getAssetIcon(row.asset)"/>
              {{ row.asset }}
            </div>
          </td>
          <td>
            <span class="action-tag" :class="row.action">{{ formatAction(row.action) }}</span>
          </td>
          <td>{{ row.amount }}</td>
          <td>{{ row.amountUsd }}</td>
          <td>
            <span class="status-tag" :class="row.status">{{ formatStatus(row.status) }}</span>
          </td>
          <td class="tx-hash">
            <a :href="getTxUrl(row.txHash)" target="_blank">{{ truncateHash(row.txHash) }}</a>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="loading" class="loading">Loading...</div>
    <div v-if="!loading && sortedData.length === 0" class="empty">No transactions</div>
  </div>
  <PaginationDot v-if="!isMobile" v-model="page" :total="totalPages" />
</template>

<script setup lang="ts">
import PaginationDot from '@/components/pagination.vue'
import { usePortfolioTransactions } from '@/composables/usePortfolio'
import { getProtocolIcon, getAssetIcon } from '@/utils/icons'
import type { PortfolioTransaction } from '@/types/portfolio'

import { computed, ref, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  keyword?: string
  protocols?: string[]
}>()

// Use the Portfolio Transactions composable (keyword + protocol are global server-side filters)
const { transactions, loading, page, pageSize, total, loadMore } = usePortfolioTransactions({
  keyword: () => props.keyword,
  protocols: () => props.protocols,
})

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

/** Capitalize the first letter (backend action/status are lowercase; the display layer capitalizes uniformly) */
function capitalizeFirst(value?: string): string {
  if (!value) return ''
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Display labels for new enum actions (backend already shipped via backend-lending-reporttx) */
const ACTION_LABELS: Record<string, string> = {
  'add-liquidity': 'Add Liquidity',
  'remove-liquidity': 'Remove Liquidity',
}

/** Action display: stake → Stake, withdraw → Withdraw, add-liquidity → Add Liquidity … */
function formatAction(value?: string): string {
  if (!value) return ''
  return ACTION_LABELS[value] || capitalizeFirst(value)
}

/** Status display: success → Success, pending → Pending, failed → Failed */
function formatStatus(value?: string): string {
  return capitalizeFirst(value)
}

// Search keyword + protocol filtering now happens server-side (global across all pages).
// The backend returns filtered rows + filtered total, so the client just renders transactions.
const columns = [
  { key: 'date', label: 'Date' },
  { key: 'protocol', label: 'Protocol' },
  { key: 'asset', label: 'Asset' },
  { key: 'action', label: 'Action' },
  { key: 'amount', label: 'Amount' },
  { key: 'amountUsd', label: 'Value' },
  { key: 'status', label: 'Status' },
  { key: 'txHash', label: 'Tx Hash' }
]

const sortKey = ref('')
const sortOrder = ref('')

function sort(key: string) {
  if (sortKey.value !== key) {
    sortKey.value = key
    sortOrder.value = 'asc'
  } else {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : sortOrder.value === 'desc' ? '' : 'asc'
    if (!sortOrder.value) sortKey.value = ''
  }
}

function parseSortValue(row: PortfolioTransaction, key: string) {
  const val = row[key as keyof PortfolioTransaction]
  if (key === 'timestamp') return val
  if (typeof val === 'string') {
    if (val.includes('$')) return parseFloat(val.replace(/[$,]/g, ''))
  }
  if (typeof val === 'number') return val
  return val || ''
}

const sortedData = computed(() => {
  // Whether to enable server-side paging (total > 0 indicates that the back-end is paged and the front-end is no longer slice)
  const serverPaginated = total.value > 0

  // Mobile: No pagination, show all (appended by loadMore scrolling when paginated on the server)
  if (isMobile.value) return transactions.value

  if (!sortKey.value) {
    if (serverPaginated) return transactions.value
    return transactions.value.slice(
      (page.value - 1) * pageSize.value,
      page.value * pageSize.value
    )
  }

  const copied = [...transactions.value]
  copied.sort((a, b) => {
    const v1 = parseSortValue(a, sortKey.value)
    const v2 = parseSortValue(b, sortKey.value)
    if (v1 === '') return 1
    if (v2 === '') return -1
    if (typeof v1 === 'number' && typeof v2 === 'number') {
      return sortOrder.value === 'asc' ? v1 - v2 : v2 - v1
    }
    return sortOrder.value === 'asc'
      ? String(v1).localeCompare(String(v2))
      : String(v2).localeCompare(String(v1))
  })

  // No slicing with server-side pagination
  if (serverPaginated) return copied

  // Frontend local pagination
  const start = (page.value - 1) * pageSize.value
  return copied.slice(start, start + pageSize.value)
})

const totalPages = computed(() => {
  // Prefer the total number returned by the back-end, fallback to the length after the front-end filtering
  const count = total.value > 0 ? total.value : transactions.value.length
  return Math.ceil(count / pageSize.value) || 1
})

function sortCls(key: string) {
  if (sortKey.value !== key) return ''
  return sortOrder.value === 'asc' ? 'asc' : 'desc'
}

function truncateHash(hash: string): string {
  if (!hash) return ''
  return hash.slice(0, 10) + '...' + hash.slice(-6)
}

function getTxUrl(hash: string): string {
  // Ethereum mainnet explorer
  const cleanHash = hash.replace('...', '').replace('0x', '')
  return `https://etherscan.io/tx/0x${cleanHash}`
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

/* Fix tx desktop column widths to prevent layout jumps across pages */
.crypto-table thead th:nth-child(1),
.crypto-table tbody td:nth-child(1) { width: 16%; }
.crypto-table thead th:nth-child(2),
.crypto-table tbody td:nth-child(2) { width: 13%; }
.crypto-table thead th:nth-child(3),
.crypto-table tbody td:nth-child(3) { width: 12%; }
.crypto-table thead th:nth-child(4),
.crypto-table tbody td:nth-child(4) { width: 11%; }
.crypto-table thead th:nth-child(5),
.crypto-table tbody td:nth-child(5) { width: 12%; }
.crypto-table thead th:nth-child(6),
.crypto-table tbody td:nth-child(6) { width: 12%; }
.crypto-table thead th:nth-child(7),
.crypto-table tbody td:nth-child(7) { width: 9%; }
.crypto-table thead th:nth-child(8),
.crypto-table tbody td:nth-child(8) { width: 15%; }

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
  width: 24px;
  height: 24px;
}

.action-tag {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}
.action-tag.stake, .action-tag.deposit, .action-tag.supply, .action-tag.add-liquidity {
  background: rgba(16, 185, 129, 0.2);
  color: #10b981;
}
.action-tag.unstake, .action-tag.withdraw, .action-tag.claim, .action-tag.repay, .action-tag.remove-liquidity {
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
}
.action-tag.borrow {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.status-tag {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}
.status-tag.success {
  background: rgba(16, 185, 129, 0.2);
  color: #10b981;
}
.status-tag.pending {
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
}
.status-tag.failed {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.tx-hash a {
  color: #FFDD94;
  text-decoration: none;
}

.tx-hash a:hover {
  text-decoration: underline;
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
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
  }

  /* Other fields (except Protocol/Asset/button): add 3px vertical padding; Action/Status labels get the offset on ::before so values stay put */
  .crypto-table tbody tr td:first-child,
  .crypto-table tbody tr td:nth-child(5),
  .crypto-table tbody tr td:nth-child(6),
  .crypto-table tbody tr td:nth-child(8) {
    padding: 3px 0;
  }

  /* Line 1: Protocol + Asset */
  .crypto-table tbody tr td:nth-child(2) {
    grid-column: 1;
    grid-row: 1;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }

  .crypto-table tbody tr td:nth-child(3) {
    grid-column: 2;
    grid-row: 1;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    text-align: left;
  }

  /* Second row: Date + Amount */
  .crypto-table tbody tr td:first-child {
    grid-column: 1;
    grid-row: 2;
  }

  .crypto-table tbody tr td:first-child::before {
    content: 'Date:';
    color: #ACB5BB;
    font-size: 11px;
  }

  .crypto-table tbody tr td:nth-child(5) {
    grid-column: 2;
    grid-row: 2;
    text-align: left;
  }

  .crypto-table tbody tr td:nth-child(5)::before {
    content: 'Amount:';
    color: #ACB5BB;
    font-size: 11px;
  }

  /* Third row: Action + Value */
  .crypto-table tbody tr td:nth-child(4) {
    grid-column: 1;
    grid-row: 3;
  }

  .crypto-table tbody tr td:nth-child(4)::before {
    content: 'Action:';
    color: #ACB5BB;
    font-size: 11px;
    padding: 3px 0;
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

  /* Fourth row: Status + Tx */
  .crypto-table tbody tr td:nth-child(7) {
    grid-column: 1;
    grid-row: 4;
  }

  .crypto-table tbody tr td:nth-child(7)::before {
    content: 'Status:';
    color: #ACB5BB;
    font-size: 11px;
    padding: 3px 0;
  }

  .crypto-table tbody tr td:nth-child(8) {
    grid-column: 2;
    grid-row: 4;
    text-align: left;
    font-size: 12px;
  }

  .crypto-table tbody tr td:nth-child(8)::before {
    content: 'Tx:';
    color: #ACB5BB;
    font-size: 11px;
  }

  .protocol {
    gap: 6px;
  }

  .protocol img {
    width: 32px;
    height: 32px;
  }

  .asset img {
    width: 20px;
    height: 20px;
  }

  .loading, .empty {
    padding: 40px 20px;
    font-size: 14px;
  }
}
</style>
