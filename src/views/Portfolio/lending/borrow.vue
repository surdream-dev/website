<template>
  <div class="lending-panel active">
    <div class="claim-bar">
      <div class="bar-title">Your borrows</div>
      <div class="bar-menu">
        <div class="value">
          <div class="bar-line"></div>
          {{ totalBorrowed }}
        </div>
        <button class="toggle" @click="expanded = !expanded">
          <img v-if="expanded" src="@/assets/icons/lendingclose.svg" />
          <img v-else src="@/assets/icons/lendingopen.svg" />
        </button>
      </div>
    </div>
    <Transition name="fold">
      <div v-if="expanded" class="lending-table">
        <table>
          <thead>
            <tr>
              <th v-for="c in columns" :key="c.key" @click="sort(c.key)">
                <div class="sortable">
                  <span>{{ c.label }}</span>
                  <span class="sort" :class="sortCls(c.key)">
                    <span class="sort-icon up"></span>
                    <span class="sort-icon down"></span>
                  </span>
                </div>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in sortedData" :key="(r.poolId || r.protocolId) + r.asset">
              <tr v-if="r.balance && r.balance !== '0'" @click="isMobile && openRepay(r)">
              <td>
                <div class="asset">
                  <img :src="getIcon(r.protocol)" class="icon" />
                  <span>{{ r.protocol }}</span>
                </div>
              </td>
              <td>
                <div class="asset">
                  <img :src="getIcon(r.asset)" class="icon" />
                  <span>{{ r.asset }}</span>
                </div>
              </td>
              <td>
                <div class="balance">
                  <span v-if="r.loading">Loading...</span>
                  <span v-else-if="r.error">Error</span>
                  <span v-else>{{ r.balance }}</span>
                  <span v-if="!r.loading && !r.error">{{ r.balanceUsd }}</span>
                </div>
              </td>
              <td>
                <div class="health">
                  <span class="health-value" :class="healthOf(r)?.level || 'safe'">{{ healthOf(r)?.text ?? '-' }}</span>
                </div>
              </td>
              <td>{{ r.apyFormatted }}</td>
              <td>
                <div class="op-btn-wrapper">
                  <div class="list-op-btn" @click.stop="openRepay(r)">Repay</div>
                </div>
              </td>
            </tr>
            </template>
          </tbody>
        </table>
        <div v-if="sortedData.filter(r => r.balance !== '0').length === 0" class="empty">
          <span v-if="loadingBalances">Loading...</span>
          <span v-else>No borrows</span>
        </div>
      </div>
    </Transition>
  </div>
  <LendingModal v-model="lendingModalVisible" :balance="userEthBalance" :selectedItem="selectedItem" :availableTabs="['Borrow', 'Repay']" :initialTab="lendingInitialTab" @stake="handleStake" />
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch, inject, onMounted, onBeforeUnmount } from 'vue'
import LendingModal from '@/components/lendingOp/index.vue'
import { useUserEthBalance } from '@/composables/useBalance'
import { type BorrowBalance } from '@/composables/usePortfolio'
import { enrichLendingItem } from '@/composables/useLendingItem'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { lending } from '@/chain/lending'
import { classifyHealthFactor, type RiskLevel } from '@/composables/useLendingHealth'

const { borrowedBalances, totalBorrowed, loadingBalances, refetchBalances, refetchInfo } = inject('lendingPosition')!

const walletStore = useWalletStore()
const { address } = storeToRefs(walletStore)

// Per-pool health factor for the "Your borrows" list. Each row shows the health of the pool
// that the borrowed asset belongs to (account-level protocols show the account-level HF).
const healthCache = reactive<Record<string, { text: string; level: RiskLevel }>>({})

function healthKey(r: BorrowBalance): string {
  return (r.poolId || r.protocolId || '').toLowerCase()
}

function healthOf(r: BorrowBalance) {
  return healthCache[healthKey(r)]
}

// Parse the displayed health text into a sortable numeric value.
// Health is not a field on the row — it lives in the async healthCache — so
// sorting must resolve it here (and reading healthCache keeps sortedData
// reactive when async health arrives). '-'/missing sinks to the bottom,
// '∞' is treated as the largest health.
function healthSortValue(r: BorrowBalance): number {
  const text = healthOf(r)?.text
  if (text == null || text === '-' || text === '') return Number.MIN_SAFE_INTEGER
  if (text === '∞') return Number.MAX_SAFE_INTEGER
  const n = parseFloat(text)
  return Number.isFinite(n) ? n : Number.MIN_SAFE_INTEGER
}

async function refreshHealth() {
  const acct = address.value
  const rows = borrowedBalances.value

  const active = new Set(rows.map(healthKey))
  for (const k of Object.keys(healthCache)) {
    if (!active.has(k)) delete healthCache[k]
  }

  if (!acct) return

  const toFetch = new Map<string, { protocolId: string; poolId?: string }>()
  for (const r of rows) {
    const k = healthKey(r)
    if (healthCache[k] || toFetch.has(k)) continue
    toFetch.set(k, { protocolId: r.protocolId, poolId: r.poolId })
  }

  for (const [k, { protocolId, poolId }] of toFetch) {
    const adapter = lending.get(protocolId?.toLowerCase())
    if (!adapter?.getHealthSnapshot) {
      healthCache[k] = { text: '-', level: 'safe' }
      continue
    }
    try {
      const snap = await adapter.getHealthSnapshot(acct as `0x${string}`, poolId)
      if (snap) {
        const hf = snap.borrowUSD > 0 ? snap.riskAdjustedCollateralUSD / snap.borrowUSD : null
        healthCache[k] = {
          text: hf === null ? '∞' : hf.toFixed(2),
          level: classifyHealthFactor(hf),
        }
      } else {
        healthCache[k] = { text: '-', level: 'safe' }
      }
    } catch {
      healthCache[k] = { text: '-', level: 'safe' }
    }
  }
}

watch([borrowedBalances, address], refreshHealth, { immediate: true })

// Determination of mobile side (consistent with CSS breakpoint 768px): The entire line click popup operation is only effective on mobile side
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth <= 768)
function updateIsMobile() {
  isMobile.value = window.innerWidth <= 768
}
onMounted(() => window.addEventListener('resize', updateIsMobile))
onBeforeUnmount(() => window.removeEventListener('resize', updateIsMobile))

// Get the selected protocol list from the parent component
const selectedProtocols = inject<Ref<string[]>>('lendingSelectedProtocols', ref([]))
const portfolioKeyword = inject<Ref<string>>('portfolioKeyword', ref(''))

const columns = [
  { key: 'protocol', label: 'Protocol' },
  { key: 'asset', label: 'Asset' },
  { key: 'balance', label: 'Balance' },
  { key: 'health', label: 'Health' },
  { key: 'apyFormatted', label: 'APY' }
]

const sortKey = ref('')
const sortOrder = ref('')
const expanded = ref(true)

function sort(key: string) {
  if (sortKey.value !== key) {
    sortKey.value = key
    sortOrder.value = 'asc'
  } else {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : ''
    if (!sortOrder.value) sortKey.value = ''
  }
}

function sortCls(key: string) {
  if (sortKey.value !== key) return ''
  return sortOrder.value === 'asc' ? 'asc' : 'desc'
}

// Sort by agreement after filtering
const sortedData = computed(() => {
  let data = borrowedBalances.value

  // Search by keyword
  const kw = portfolioKeyword.value?.toLowerCase().trim()
  if (kw) {
    data = data.filter(item =>
      item.protocol.toLowerCase().includes(kw) ||
      item.asset.toLowerCase().includes(kw)
    )
  }

  // Filter by selected protocols (an empty array means show all)
  if (selectedProtocols.value.length > 0) {
    data = data.filter(item =>
      selectedProtocols.value.includes(item.protocolId.toLowerCase())
    )
  }

  if (!sortKey.value) return data
  const copied = [...data]
  copied.sort((a, b) => {
    if (sortKey.value === 'health') {
      const v1 = healthSortValue(a)
      const v2 = healthSortValue(b)
      return sortOrder.value === 'asc' ? v1 - v2 : v2 - v1
    }
    const v1 = a[sortKey.value as keyof BorrowBalance] || ''
    const v2 = b[sortKey.value as keyof BorrowBalance] || ''
    if (typeof v1 === 'number' && typeof v2 === 'number') {
      return sortOrder.value === 'asc' ? v1 - v2 : v2 - v1
    }
    return sortOrder.value === 'asc'
      ? String(v1).localeCompare(String(v2))
      : String(v2).localeCompare(String(v1))
  })
  return copied
})

const icons = import.meta.glob('@/assets/logos/*.svg', { eager: true, import: 'default' })

// Pool ID (e.g. compound-eth) Extraction protocol name (compound) matches logo
const getIcon = (symbol: string) => {
  const lookup = (symbol?.toLowerCase() || '').split('-')[0]
  for (const [path, icon] of Object.entries(icons)) {
    if (path.includes(lookup)) return icon as string
  }
  return ''
}

const userEthBalance = useUserEthBalance()
const lendingModalVisible = ref(false)
const selectedItem = ref<any>(null)
const lendingInitialTab = ref('')

function openRepay(item: any) {
  selectedItem.value = enrichLendingItem(item, 'borrow')
  lendingInitialTab.value = 'Repay'
  lendingModalVisible.value = true
}

function handleStake(ev: { amount: string }) {
  // Refresh on-chain data and protocol information after successful transaction
  refetchBalances()
  refetchInfo()
}
</script>

<style scoped>
.health {
  display: flex;
  align-items: center;
}
.health-value {
  font-weight: 600;
  color: #16c784;
}
.health-value.safe { color: #16c784; }
.health-value.warning { color: #FBBF24; }
.health-value.danger { color: #F87171; }
.health-value.blocked { color: #EF4444; }
.empty {
  text-align: center;
  color: #ACB5BB;
  padding: 20px;
}
@media (max-width: 768px) {
  .sort {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 5px;
    margin-left: 2px;
  }
  /* Column widths: give APY more room, keep Health compact */
  .lending-table thead th:nth-child(1),
  .lending-table tbody td:nth-child(1) {
    width: 19%;
    padding: 0 2px 8px;
  }
  .lending-table thead th:nth-child(2),
  .lending-table tbody td:nth-child(2) {
    padding: 0 2px 8px;
  }
  .lending-table thead th:nth-child(3),
  .lending-table tbody td:nth-child(3) {
    width: 18%;
    padding: 0 2px 8px;
  }
  .lending-table thead th:nth-child(4),
  .lending-table tbody td:nth-child(4) {
    width: 17%;
    padding: 0 2px 8px;
  }
  .lending-table thead th:nth-child(5),
  .lending-table tbody td:nth-child(5) {
    width: 20%;
    padding: 0 2px 8px;
  }
  /* Last visible column (APY): rounded right corner + reserved space for the arrow */
  .lending-table tbody tr td:nth-child(5) {
    border-radius: 0 10px 10px 0;
    position: relative;
    padding-right: 24px;
  }

  /* Right arrow: hints the row opens the next screen */
  .lending-table tbody tr td:nth-child(5)::after {
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
</style>
