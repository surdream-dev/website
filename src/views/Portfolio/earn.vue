<!-- Portfolio earn.vue - shows earnings stats -->
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
          <th></th>
        </tr>
      </thead>

      <tbody v-if="sortedData.length > 0">
        <template v-for="(row, idx) in sortedData" :key="row.id || idx">
          <tr v-if="row.protocol && row.asset">
            <td>{{ row.lastUpdate }}</td>
            <td>
              <div class="protocol">
                <img :src="getProtocolIcon(row.protocolId, row.icon)"/>
                {{ row.protocol }}
              </div>
            </td>
            <td>
              <!-- Collateral supplies from single-collateral lending pools (compound/morpho/fluid)
                   show the pool pair like the All tab (e.g. WBTC / USDC). Cross-asset pools
                   (aave/sparklend) and liquidity rows have no loanAsset, so they stay single-row. -->
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
                <span
                  v-for="cat in categoryTags(row)"
                  :key="cat"
                  class="category-tag"
                  :class="cat"
                >{{ formatCategory(cat) }}</span>
              </div>
            </td>
            <td>{{ row.apyFormatted }}</td>
            <td>{{ row.balance }}</td>
            <td>{{ row.balanceUsd }}</td>
            <td class="earnings">{{ row.earningsUsd }}</td>
            <td>
              <div class="list-op-btn" @click="openOperation(row)">{{ getOperationLabel(row) }}</div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <div v-if="loading" class="loading">Loading...</div>
    <div v-if="!loading && sortedData.length === 0" class="empty">No earnings data</div>
  </div>
  <PaginationDot v-if="!isMobile" v-model="page" :total="totalPages" />
</template>

<script setup lang="ts">
import PaginationDot from '@/components/pagination.vue'
import { usePortfolioPositions } from '@/composables/usePortfolio'
import { usePortfolioAll } from '@/composables/usePortfolioChainData'
import { normalizePortfolioAssetAddress } from '@/utils/portfolioPositionSort'
import { getLendingPool } from '@/constants/protocols'
import { getProtocolIcon, getAssetIcon } from '@/utils/icons'
import type { PortfolioPosition } from '@/types/portfolio'

import { computed, ref, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  keyword?: string
  protocols?: string[]
}>()

const emit = defineEmits<{
  openOperation: [row: PortfolioPosition]
}>()

// Use the Portfolio Positions composable (keyword + protocol are global server-side filters;
// excludeBorrow drops liability/borrow rows — Earnings only shows supplied/earned positions)
const { positions, loading, total, page, pageSize, loadMore } = usePortfolioPositions(
  undefined,
  { keyword: () => props.keyword, protocols: () => props.protocols, excludeBorrow: true },
)

// Chain-sourced ALL positions (singleton shared with the All tab). The Earnings
// Balance/Value must stay consistent with the All tab, so when a position matches
// an on-chain All row we override the API's balance/value with the chain values.
const all = usePortfolioAll()

// Lending supply and liquidity rows are the same underlying position on both
// sides; treat them as one group so a backend supply/liquidity category mismatch
// does not break the match. Borrow stays a separate (liability) group.
// Staking's "withdraw" row (pending + claimable unstake) must stay a separate
// group too: it shares the same protocol/asset/address as the staked supply row,
// so without this split the withdraw row overwrites the staked (Unstake) balance
// in the map and Earnings shows Withdraw Balance instead of Unstake Balance.
function positionGroup(row: PortfolioPosition): string {
  if (row.type === 'withdraw') return 'withdraw'
  if (row.category === 'lending-borrow') return 'borrow'
  if (row.category === 'lending-supply' || row.category === 'lending-liquidity') return 'supplied'
  return row.category // staking | stablecoin
}

function buildAllBalanceMap(rows: PortfolioPosition[]): Map<string, { balance: string; balanceUsd: string }> {
  const map = new Map<string, { balance: string; balanceUsd: string }>()
  for (const row of rows) {
    const pid = (row.protocolId || '').split('-')[0].toLowerCase()
    const group = positionGroup(row)
    const addr = normalizePortfolioAssetAddress(row.assetAddress)
    const value = { balance: row.balance, balanceUsd: row.balanceUsd }
    // Prefer the asset-address key; also index by asset symbol for rows whose
    // API row lacks an asset address.
    if (addr) map.set(`${pid}|${addr}|${group}`, value)
    map.set(`${pid}|${(row.asset || '').toLowerCase()}|${group}`, value)
  }
  return map
}

function lookupAllBalance(row: PortfolioPosition, map: Map<string, { balance: string; balanceUsd: string }>) {
  const pid = (row.protocolId || '').split('-')[0].toLowerCase()
  const group = positionGroup(row)
  const addr = normalizePortfolioAssetAddress(row.assetAddress)
  const addrKey = addr ? `${pid}|${addr}|${group}` : ''
  const symKey = `${pid}|${(row.asset || '').toLowerCase()}|${group}`
  if (addrKey && map.has(addrKey)) return map.get(addrKey)
  return map.get(symKey)
}

const allBalanceMap = computed(() => buildAllBalanceMap(all.positions.value))

// Keep the API's earnings/date/apy fields, but source Balance/Value from the
// on-chain All positions when the row has a match.
const mergedPositions = computed(() =>
  positions.value.map(row => {
    const match = lookupAllBalance(row, allBalanceMap.value)
    const enriched = match ? { ...row, balance: match.balance, balanceUsd: match.balanceUsd } : row
    // Backend rows carry no loanAsset; derive it from the pool config so collateral
    // supplies in single-collateral pools (compound/morpho/fluid) can show the pool
    // pair (e.g. WBTC / USDC) exactly like the All tab.
    if (!enriched.loanAsset && enriched.category === 'lending-supply') {
      enriched.loanAsset = getLendingPool(enriched.poolId || '')?.borrowAsset || ''
    }
    return enriched
  })
)

// Collateral supplies from single-collateral lending pools render as a two-row
// asset-pair (collateral + loan asset). Cross-asset pools (aave/sparklend) and
// liquidity rows have no loanAsset, so they stay single-row — same as the All tab.
function isAssetPair(row: PortfolioPosition): boolean {
  return row.category === 'lending-supply' && !!row.loanAsset
}

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

// Search keyword + protocol filtering now happens server-side (global across all pages).
// The backend returns filtered rows + filtered total, so the client just renders mergedPositions.
const columns = [
  { key: 'lastUpdate', label: 'Date' },
  { key: 'protocol', label: 'Protocol' },
  { key: 'asset', label: 'Asset' },
  { key: 'category', label: 'Category' },
  { key: 'apyFormatted', label: 'APY' },
  { key: 'balance', label: 'Balance' },
  { key: 'balanceUsd', label: 'Value' },
  { key: 'earningsUsd', label: 'Earnings' }
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

function parseSortValue(row: PortfolioPosition, key: string) {
  const val = row[key as keyof PortfolioPosition]
  if (typeof val === 'string') {
    if (val.includes('%')) return parseFloat(val.replace('%', ''))
    if (val.includes('$')) return parseFloat(val.replace(/[$,]/g, ''))
  }
  if (typeof val === 'number') return val
  return val || ''
}

const sortedData = computed(() => {
  const copied = [...mergedPositions.value]
  if (!sortKey.value) {
    // Default sort by earnings
    copied.sort((a, b) => {
      const v1 = parseSortValue(a, 'earningsUsd')
      const v2 = parseSortValue(b, 'earningsUsd')
      if (typeof v1 === 'number' && typeof v2 === 'number') {
        return v2 - v1 // Descending by default, higher earnings first
      }
      return 0
    })
  } else {
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
  }

  // positions already holds exactly one server page on desktop (each page switch
  // reloads positions via fetchPositions) and every loaded page on mobile (loadMore
  // appends), so the frontend must NOT slice by page again — slicing by (page-1)*size
  // overflows the single loaded page and empties page >= 2.
  return copied
})

const totalPages = computed(() => {
  // Prefer the total number returned by the back-end, fallback to the length after the front-end filtering
  const count = total.value > 0 ? total.value : mergedPositions.value.length
  return Math.ceil(count / pageSize.value) || 1
})

function sortCls(key: string) {
  if (sortKey.value !== key) return ''
  return sortOrder.value === 'asc' ? 'asc' : 'desc'
}

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

// The backend reports USDC/USDT held in lending pools as category "stablecoin". To make the
// column reflect the actual lending side (as the All tab does), append a secondary tag:
// Aave/SparkLend rows are Supply, Compound/Fluid/Morpho rows are Liquidity.
const STABLE_LENDING_EXTRA: Record<string, 'lending-supply' | 'lending-liquidity'> = {
  aave: 'lending-supply',
  sparklend: 'lending-supply',
  compound: 'lending-liquidity',
  fluid: 'lending-liquidity',
  morpho: 'lending-liquidity',
}

/** Category tags shown for a row: the primary category + an optional lending-side tag. */
function categoryTags(row: PortfolioPosition): string[] {
  const tags = [row.category]
  const asset = (row.asset || '').toUpperCase()
  const pid = (row.protocolId || '').split('-')[0].toLowerCase()
  const isUsdStablecoin = row.category === 'stablecoin' && (asset === 'USDC' || asset === 'USDT')
  if (isUsdStablecoin) {
    const extra = STABLE_LENDING_EXTRA[pid]
    if (extra) tags.push(extra)
  }
  return tags
}

function getOperationLabel(row: PortfolioPosition): string {
  if (row.category === 'lending-borrow') return 'Repay'
  if (row.category === 'stablecoin' && row.type === 'withdraw') return 'Claim'
  if (row.type === 'stake' || row.type === 'restake') return 'Unstake'
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

/* Fix earn desktop column widths to prevent layout jumps across pages */
.crypto-table thead th:nth-child(1),
.crypto-table tbody td:nth-child(1) { width: 10%; }
.crypto-table thead th:nth-child(2),
.crypto-table tbody td:nth-child(2) { width: 13%; }
.crypto-table thead th:nth-child(3),
.crypto-table tbody td:nth-child(3) { width: 10%; }
.crypto-table thead th:nth-child(4),
.crypto-table tbody td:nth-child(4) { width: 14%; }
.crypto-table thead th:nth-child(5),
.crypto-table tbody td:nth-child(5) { width: 9%; }
.crypto-table thead th:nth-child(6),
.crypto-table tbody td:nth-child(6) { width: 11%; }
.crypto-table thead th:nth-child(7),
.crypto-table tbody td:nth-child(7) { width: 11%; }
.crypto-table thead th:nth-child(8),
.crypto-table tbody td:nth-child(8) { width: 12%; }
.crypto-table thead th:nth-child(9),
.crypto-table tbody td:nth-child(9) { width: 10%; }

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

.category-list {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.category-tag {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
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

.earnings {
  color: #16c784;
  font-weight: 600;
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

  /* Other fields (except Protocol/Asset/button): add 3px vertical padding; Category label gets the offset on ::before so the value stays put */
  .crypto-table tbody tr td:first-child,
  .crypto-table tbody tr td:nth-child(5),
  .crypto-table tbody tr td:nth-child(6),
  .crypto-table tbody tr td:nth-child(7),
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

  /* Line 2: Date + Balance */
  .crypto-table tbody tr td:first-child {
    grid-column: 1;
    grid-row: 2;
  }

  .crypto-table tbody tr td:first-child::before {
    content: 'Date:';
    color: #ACB5BB;
    font-size: 11px;
  }

  .crypto-table tbody tr td:nth-child(6) {
    grid-column: 2;
    grid-row: 2;
    text-align: left;
  }

  .crypto-table tbody tr td:nth-child(6)::before {
    content: 'Balance:';
    color: #ACB5BB;
    font-size: 11px;
  }

  /* Line 3: Category + APY */
  .crypto-table tbody tr td:nth-child(4) {
    grid-column: 1;
    grid-row: 3;
  }

  .crypto-table tbody tr td:nth-child(4)::before {
    content: 'Category:';
    color: #ACB5BB;
    font-size: 11px;
    padding: 3px 0;
  }

  .crypto-table tbody tr td:nth-child(5) {
    grid-column: 2;
    grid-row: 3;
    text-align: left;
  }

  .crypto-table tbody tr td:nth-child(5)::before {
    content: 'APY:';
    color: #ACB5BB;
    font-size: 11px;
  }

  /* Line 4: Value + Earnings */
  .crypto-table tbody tr td:nth-child(7) {
    grid-column: 1;
    grid-row: 4;
  }

  .crypto-table tbody tr td:nth-child(7)::before {
    content: 'Value:';
    color: #ACB5BB;
    font-size: 11px;
  }

  .crypto-table tbody tr td:nth-child(8) {
    grid-column: 2;
    grid-row: 4;
    text-align: left;
  }

  .crypto-table tbody tr td:nth-child(8)::before {
    content: 'Earnings:';
    color: #ACB5BB;
    font-size: 11px;
  }

  /* Line 5: Action button fills up the line */
  .crypto-table tbody tr td:nth-child(9) {
    grid-column: 1 / -1;
    grid-row: 5;
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
