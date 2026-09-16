<template>
  <div class="lending-panel active">
    <div class="claim-bar">
      <div class="bar-title">{{ liquidityOnly ? 'Your liquidity' : 'Your supplies' }}</div>
      <div class="bar-menu">
        <div class="value">
          <div class="bar-line"></div>
          {{ panelTotal }}
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
            <tr v-for="r in sortedData" :key="(r.poolId || r.protocolId) + r.asset" @click="isMobile && openWithdraw(r)">
              <td>
                <div class="asset">
                  <img :src="getIcon(r.protocol)" class="icon" />
                  <span>{{ r.protocol }}</span>
                </div>
              </td>
              <td>
                <!-- Liquid assets (e.g. ETH for compound-eth): single bank -->
                <div v-if="liquidityKeys.has(`${r.poolId}:${r.asset}`)" class="asset">
                  <img :src="getIcon(r.asset)" class="icon" />
                  <span>{{ r.asset }}</span>
                </div>
                <!-- Collateral + Borrowing Assets Dual Bank -->
                <div v-else class="asset-pair">
                  <div class="asset-row">
                    <img :src="getIcon(r.asset)" class="icon-sm" />
                    <span>{{ r.asset }}</span>
                  </div>
                  <!-- Across Asset Pools (Aave/SparkLend): Overlapping icons, excluding upper-row assets -->
                  <div v-if="crossAssetBorrowMap.has(r.poolId || '')" class="asset-row">
                    <span class="overlap-icons">
                      <img
                        v-for="(ba, i) in (crossAssetBorrowMap.get(r.poolId || '') || []).filter(ba => ba.symbol !== r.asset)"
                        :key="ba.symbol"
                        :src="getIcon(ba.symbol)"
                        class="icon-sm overlap-icon"
                        :style="{ zIndex: 10 - i, marginLeft: i > 0 ? '-8px' : '0' }"
                      />
                    </span>
                  </div>
                  <!-- CD Borrowing Pool (Compound/Morpho/Fluid): Single Lending Assets -->
                  <div v-else class="asset-row">
                    <img :src="getIcon(poolBorrowMap.get(r.poolId || '')?.symbol)" class="icon-sm" />
                    <span>{{ poolBorrowMap.get(r.poolId || '')?.symbol || '-' }}</span>
                  </div>
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
              <td>{{ r.apyFormatted }}</td>
              <td>
                <div class="op-btn-wrapper">
                  <div class="list-op-btn" @click.stop="openWithdraw(r)">Withdraw</div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="loading" class="loading">Loading balances...</div>
        <div v-else-if="sortedData.length === 0" class="empty">No supplies</div>
      </div>
    </Transition>
  </div>
  <LendingModal v-model="lendingModalVisible" :balance="userEthBalance" :selectedItem="selectedItem" :availableTabs="['Supply', 'Withdraw']" :initialTab="lendingInitialTab" @stake="handleStake" />
</template>

<script setup lang="ts">
import { ref, computed, inject, onMounted, onBeforeUnmount, type Ref } from 'vue'
import LendingModal from '@/components/lendingOp/index.vue'
import { useUserEthBalance } from '@/composables/useBalance'
import { lendingPools } from '@/constants/protocols'
import { type SupplyBalance } from '@/composables/usePortfolio'
import { enrichLendingItem } from '@/composables/useLendingItem'
import { getLendingRates, computeLendingUtilization, type LendingRateInfo } from '@/composables/useLendingApy'
import { useLendingPrices } from '@/composables/useLendingPrices'

const props = withDefaults(defineProps<{ liquidityOnly?: boolean }>(), { liquidityOnly: false })

// Determination of mobile side (consistent with CSS breakpoint 768px): The entire line click popup operation is only effective on mobile side
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth <= 768)
function updateIsMobile() {
  isMobile.value = window.innerWidth <= 768
}
onMounted(() => window.addEventListener('resize', updateIsMobile))
onBeforeUnmount(() => window.removeEventListener('resize', updateIsMobile))

const ETH_PLACEHOLDER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const WETH_ADDR = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const normAssetKey = (addr: string) => {
  const a = (addr || '').toLowerCase()
  return a === ETH_PLACEHOLDER ? WETH_ADDR : a
}

// Protocol ID to display name mapping (overrides the abbreviated names in the composable)
const PROTOCOL_NAMES: Record<string, string> = {
  aave: 'AAVE',
  compound: 'Compound',
  morpho: 'Morpho',
  sparklend: 'SparkLend',
  curve: 'Curve',
  fluid: 'Fluid',
}

// Inject the shared lending position state from the parent
const { suppliedBalances, loadingBalances, refetchBalances, refetchInfo } = inject('lendingPosition')!

// Get the selected protocol list from the parent component
const selectedProtocols = inject<Ref<string[]>>('lendingSelectedProtocols', ref([]))
const portfolioKeyword = inject<Ref<string>>('portfolioKeyword', ref(''))

// Real-time on-chain rates (key: protocolId:assetAddress → rate) for the liquidityOnly panel's fToken liquidity rates
const marketRates = ref<Record<string, LendingRateInfo>>({})
async function fetchMarketRates() {
  const merged: Record<string, LendingRateInfo> = {}
  await Promise.all(lendingPools.map(async pool => {
    const rates = await getLendingRates(pool.protocolId, pool.poolId)
    if (!rates) return
    for (const [addr, info] of rates) merged[`${pool.protocolId}:${addr}`] = info
  }))
  marketRates.value = merged
}
onMounted(fetchMarketRates)

// Price oracle (for the utilization column / popup on cross-asset pools)
const { prices } = useLendingPrices()

// liquidityOnly (Your liquidity panel): liquidity assets have no collateral concept; do not show the Collateral column
const columns = computed(() => {
  const cols = [
    { key: 'protocol', label: 'Protocol' },
    { key: 'asset', label: 'Asset' },
    { key: 'balance', label: 'Balance' },
    { key: 'apyFormatted', label: 'APY' },
  ]
  return cols
})

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

// Rows actually shown in this panel: keyword/protocol filter + zero-balance hidden + collateral/liquidity split.
// The header total is derived from exactly these rows so it always matches the sum of the table below.
const panelRows = computed(() => {
  let data = suppliedBalances.value

  // Search by keyword
  const kw = portfolioKeyword.value?.toLowerCase().trim()
  if (kw) {
    data = data.filter(item =>
      item.protocol.toLowerCase().includes(kw) ||
      item.asset.toLowerCase().includes(kw)
    )
  }

  // Filter by the selected protocol (match by protocolId; e.g. selecting compound shows all three pools)
  if (selectedProtocols.value.length > 0) {
    data = data.filter(item =>
      selectedProtocols.value.includes(item.protocolId.toLowerCase())
    )
  }

  // Filter out zero-balance rows (previously supplied but fully withdrawn are hidden)
  data = data.filter(item => item.balanceWei > 0n)

  // Non-liquidityOnly (Your supplies): single-collateral/single-borrow pools show only collateral positions;
  // liquidity positions (Morpho USDC/USDT vaults, Fluid fToken etc.) belong to the Your liquidity panel to avoid duplication.
  // Cross-asset pools (Aave/SparkLend) treat collateral = liquidity; keep all rows.
  if (!props.liquidityOnly) {
    data = data.filter(item => {
      const pool = lendingPools.find(p => p.poolId === item.poolId)
      if (!pool || pool.isCrossAsset) return true
      if (item.collateral) return true
      const liqAddrs = new Set((pool.liquidityAssets || []).map(a => a.address.toLowerCase()))
      if (pool.liquidityAddress) liqAddrs.add(pool.liquidityAddress.toLowerCase())
      return !liqAddrs.has((item.assetAddress || '').toLowerCase())
    })
  }

  // liquidityOnly: show only liquidity-asset positions (liquidityAsset of Compound/Morpho/Fluid)
  if (props.liquidityOnly) {
    data = data.filter(item => {
      // Exclude cross-asset pools (Aave/SparkLend: collateral = liquidity, not part of the standalone liquidity module)
      const pool = lendingPools.find(p => p.poolId === item.poolId)
      if (!pool || pool.isCrossAsset) return false
      // Match by "the pool's liquidity asset" (prevents fluid-usdc/usdt ETH collateral positions from being misclassified as liquidity)
      const liqAddrs = new Set((pool.liquidityAssets || []).map(a => a.address.toLowerCase()))
      if (pool.liquidityAddress) liqAddrs.add(pool.liquidityAddress.toLowerCase())
      return liqAddrs.has((item.assetAddress || '').toLowerCase())
    })
    // Fluid liquidity positions use the fToken rate for APY (liquidityAPY, e.g. fUSDC 4.75%), not the vault collateral rate
    data = data.map(item => {
      // Match by original address first (fluid collateral ETH placeholder/wstETH), then fallback ETH→ WETH normalization
      const addr = (item.assetAddress || '').toLowerCase()
      const rate = marketRates.value[`${item.protocolId}:${addr}`]
        ?? marketRates.value[`${item.protocolId}:${normAssetKey(addr)}`]
      if (rate?.liquidityAPY !== undefined) {
        return {
          ...item,
          apy: rate.liquidityAPY,
          apyFormatted: rate.liquidityAPY > 0 ? rate.liquidityAPY.toFixed(2) + '%' : '-',
        }
      }
      return item
    })
  }

  // Attach utilization — same on-chain algorithm as the Lending market page / Asset to supply panel, so the popup
  // shows the same value from any entry (previously the modal fell back to '0.00'). rate missing while loading → '-'.
  data = data.map(item => {
    if (item.utilization) return item
    const addr = (item.assetAddress || '').toLowerCase()
    const pool = lendingPools.find(p => p.poolId === item.poolId)
    // Cross-asset pools (Fluid vault): the collateral entry carries 0 supply (totalSupply=0n), so utilization
    // computed from it is always 0. Look up the pool's loan-asset rate (real totalSupply/totalBorrow) instead —
    // the same source the Lending market page uses. Aave/SparkLend/Compound have no borrowAddress → fall back to
    // the collateral asset as before.
    const loanAsset = (pool?.borrowAddress || '').toLowerCase()
    const rateKey = loanAsset && loanAsset !== addr
      ? `${item.protocolId}:${loanAsset}`
      : `${item.protocolId}:${addr}`
    const rate = marketRates.value[rateKey]
      ?? marketRates.value[`${item.protocolId}:${normAssetKey(loanAsset || addr)}`]
    if (!rate) return { ...item, utilization: '-' }
    const utilNum = computeLendingUtilization(rate, {
      prices: prices.value,
      assetAddress: addr,
      // Aave/SparkLend (cross-asset) have no pool.borrowAddress → helper falls back to the asset's own address
      loanAssetAddress: loanAsset,
      decimals: item.decimals,
    })
    return { ...item, utilization: utilNum >= 0.01 ? utilNum.toFixed(2) + '%' : '<0.01%' }
  })

  return data
})

// Panel header total = sum of the rows displayed below (not the global all-position total)
const panelTotal = computed(() => {
  const total = panelRows.value.reduce((sum, s) => {
    const val = parseFloat(s.balanceUsd.replace('$', '').replace(',', '')) || 0
    return sum + val
  }, 0)
  return `$${total.toFixed(2)}`
})

// Protocol filter + sort + search
const sortedData = computed(() => {
  // Map abbreviations to full display names
  const data = panelRows.value.map(item => ({
    ...item,
    protocol: PROTOCOL_NAMES[item.protocolId] || item.protocol,
  }))

  if (!sortKey.value) return data
  const copied = [...data]
  copied.sort((a, b) => {
    const v1 = a[sortKey.value as keyof SupplyBalance] || ''
    const v2 = b[sortKey.value as keyof SupplyBalance] || ''
    if (typeof v1 === 'number' && typeof v2 === 'number') {
      return sortOrder.value === 'asc' ? v1 - v2 : v2 - v1
    }
    return sortOrder.value === 'asc'
      ? String(v1).localeCompare(String(v2))
      : String(v2).localeCompare(String(v1))
  })
  return copied
})

const loading = computed(() => loadingBalances.value)

const icons = import.meta.glob('@/assets/logos/*.svg', { eager: true, import: 'default' })

// poolId → borrow info lookup table
const poolBorrowMap = new Map<string, { symbol: string; address: string }>()
const crossAssetBorrowMap = new Map<string, Array<{ symbol: string; address: string }>>()
const liquidityKeys = new Set<string>()
// Liquidity asset addresses of single-collateral/single-borrow protocols (for liquidityOnly filtering)
const liquidityAssetAddrs = new Set<string>()
for (const p of lendingPools) {
  if (p.isCrossAsset) {
    crossAssetBorrowMap.set(p.poolId, p.borrowAssets || [])
  } else {
    poolBorrowMap.set(p.poolId, { symbol: p.borrowAsset, address: p.borrowAddress })
    if (p.liquidityAsset) {
      liquidityKeys.add(`${p.poolId}:${p.liquidityAsset}`)
      if (p.liquidityAddress) liquidityAssetAddrs.add(p.liquidityAddress.toLowerCase())
    }
  }
}

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

function openWithdraw(item: any) {
  selectedItem.value = enrichLendingItem(item, 'supply')
  lendingInitialTab.value = 'Withdraw'
  lendingModalVisible.value = true
}

function handleStake(ev: { amount: string }) {
  // Refresh on-chain data and protocol information after successful transaction
  refetchBalances()
  refetchInfo()
}
</script>

<style scoped>
.empty {
  text-align: center;
  color: #ACB5BB;
  padding: 20px;
}
.loading {
  text-align: center;
  color: var(--Secondary-300, #ACB5BB);
  padding: 20px;
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
}
.icon-sm {
  width: 18px;
  height: 18px;
  border-radius: 50%;
}
.overlap-icons {
  display: flex;
  align-items: center;
}
.overlap-icon {
  border: 1px solid #1a1a2e;
}
@media (max-width: 768px) {
  .sort {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 5px;
    margin-left: 2px;
  }

  /* Last visible column (APY): rounded right corner + reserved space for the arrow */
  .lending-table tbody tr td:nth-child(4) {
    border-radius: 0 10px 10px 0;
    position: relative;
    padding-right: 24px;
  }

  /* Right arrow: hints the row opens the next screen */
  .lending-table tbody tr td:nth-child(4)::after {
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
