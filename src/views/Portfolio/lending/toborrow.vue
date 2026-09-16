<template>
  <div class="lending-panel active">
    <div class="claim-bar">
      <div class="bar-title">Asset to borrow</div>
      <div class="bar-menu">
        <div></div>
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
            <tr v-for="r in sortedData" :key="(r.poolId || r.protocolId) + r.asset" @click="isMobile && openBorrow(r)">
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
                  <span>{{ loadingAvailable ? '...' : availableQty(r) }}</span>
                  <span v-if="!loadingAvailable">{{ availableUsd(r) }}</span>
                </div>
              </td>
              <td>{{ r.borrowAPY ? formatPercent(r.borrowAPY) : '-' }}</td>
              <td>
                <div class="op-btn-wrapper">
                  <div class="list-op-btn" @click.stop="openBorrow(r)">Borrow</div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="sortedData.length === 0" class="empty">No assets available to borrow</div>
      </div>
    </Transition>
  </div>
  <LendingModal v-model="lendingModalVisible" :balance="userEthBalance" :selectedItem="selectedItem" :availableTabs="['Borrow', 'Repay']" @stake="handleStake" />
</template>

<script setup lang="ts">
import { ref, computed, inject, watch, onMounted, onBeforeUnmount, type Ref } from 'vue'
import LendingModal from '@/components/lendingOp/index.vue'
import { useUserEthBalance } from '@/composables/useBalance'
import { lendingPools, LENDING_POOL_NAMES } from '@/constants/protocols'
import { enrichLendingItem, fetchLendingBorrowedBalance } from '@/composables/useLendingItem'

function formatPercent(val: number | undefined): string {
  if (!val || val <= 0) return '-'
  return val.toFixed(2) + '%'
}

const NAME_MAP: Record<string, string> = { aave: 'AAVE', compound: 'Compound', morpho: 'Morpho', fluid: 'Fluid', sparklend: 'SparkLend' }
function getBaseProtocolName(id: string): string {
  const base = id.split('-')[0]
  return NAME_MAP[base] || base
}
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { getAddress } from 'viem'
import { computeCometAvailableBorrow } from '@/chain/lending/compound'
import { lending } from '@/chain/lending'
import { setFluidPool } from '@/chain/lending/fluid'
import { getLendingRates } from '@/composables/useLendingApy'
import { useLendingPrices, getPriceByAddress } from '@/composables/useLendingPrices'

// Determination of mobile side (consistent with CSS breakpoint 768px): The entire line click popup operation is only effective on mobile side
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth <= 768)
function updateIsMobile() {
  isMobile.value = window.innerWidth <= 768
}
onMounted(() => window.addEventListener('resize', updateIsMobile))
onBeforeUnmount(() => window.removeEventListener('resize', updateIsMobile))

// Get the selected protocol list from the parent component
const walletStore = useWalletStore()
const { address } = storeToRefs(walletStore)

// Per-pool borrowable amount cache (USD dollars, 0 = none)
const availableAmounts = ref<Record<string, number>>({})
const loadingAvailable = ref(false)
// Real-time on-chain borrow rates (key: protocolId:assetAddress → borrowAPY); same source as the Lending market page
const borrowRates = ref<Record<string, number>>({})

// Live asset prices (for converting the pool-level USD borrowable into per-asset quantity)
const { prices } = useLendingPrices()

// Available column helpers: quantity (of this asset) on top, USD below — mirrors the Asset to supply balance column.
// The borrowable is a pool-level USD capacity, so each row shows: qty = usd / assetPrice, and the shared $ value.
function availableUsd(r: any): string {
  const usd = availableAmounts.value[r.poolId] ?? 0
  // 0 or a non-finite value (missing price / no collateral) → show '-'
  return Number.isFinite(usd) && usd > 0 ? '$' + usd.toFixed(2) : '-'
}
function availableQty(r: any): string {
  const usd = availableAmounts.value[r.poolId] ?? 0
  if (!Number.isFinite(usd) || usd <= 0 || !r.assetAddress) return '-'
  const price = getPriceByAddress(prices.value, r.assetAddress)
  if (!Number.isFinite(price) || price <= 0) return '-'
  const qty = usd / price
  // Guard the division: 0/0 or a missing USD value must not surface as NaN
  if (!Number.isFinite(qty)) return '-'
  return (Math.floor(qty * 1e6) / 1e6) + ''
}

async function fetchBorrowRates() {
  const merged: Record<string, number> = {}
  // Dedupe by protocol and fetch independently: a slow/failed protocol does not block other protocols' rate display
  // (previously Promise.all only assigned after all protocols finished; one hanging protocol hid all APYs)
  const protocolIds = [...new Set(lendingPools.map(p => p.protocolId).filter(Boolean))]
  for (const pid of protocolIds) {
    try {
      const rates = await getLendingRates(pid)
      if (!rates) continue
      for (const [addr, info] of rates) {
        merged[`${pid}:${addr}`] = info.borrowAPY
      }
    } catch (e) {
      console.warn(`[Borrow] ${pid} 利率获取失败:`, e)
    }
    // Update as each protocol completes instead of waiting for all
    borrowRates.value = { ...merged }
  }
  borrowRates.value = merged
}

async function fetchAvailableBorrows() {
  if (!address.value) return
  loadingAvailable.value = true
  const result: Record<string, number> = {}

  // Query only selected pools (all when none selected)
  const sel = selectedProtocols.value
  const isPoolSelected = (pool: any) =>
    sel.length === 0 ||
    sel.includes(pool.poolId?.toLowerCase()) ||
    sel.includes(pool.protocolId)

  for (const pool of lendingPools) {
    if (!isPoolSelected(pool)) continue
    if (pool.protocolId === 'compound' && pool.borrowAddress) {
      const poolToComet: Record<string, string> = {
        'compound-eth': '0xA17581A9E3356d9A858b789D68B4d866e593aE94',
        'compound-usdc': '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
        'compound-usdt': '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840',
      }
      const cometAddr = poolToComet[pool.poolId]
      if (cometAddr) {
        try {
          const cents = await computeCometAvailableBorrow(cometAddr, address.value as `0x${string}`)
          result[pool.poolId] = cents > 0n ? Number(cents) / 100 : 0
        } catch (e) {
          console.warn('[Borrow] Failed to fetch available for', pool.poolId, e)
          result[pool.poolId] = 0
        }
      }
    }
  }

  // Aave / SparkLend: query the user's total borrowable amount on-chain
  for (const pid of ['aave', 'sparklend']) {
    if (!isPoolSelected({ protocolId: pid, poolId: pid })) continue
    try {
      const adapter = lending.get(pid)
      if (adapter?.getAvailableBorrows) {
        const cents = await adapter.getAvailableBorrows(address.value as `0x${string}`)
        // Aave/SparkLend have a single pool shared by all asset rows
        result[pid] = cents > 0n ? Number(cents) / 100 : 0
      }
    } catch (e) {
      console.warn('[Borrow] Failed to fetch available for', pid, e)
      result[pid] = 0
    }
  }

  // Fluid: query the user's borrowable amount per pool
  for (const pool of lendingPools) {
    if (pool.protocolId !== 'fluid' || !pool.borrowAddress) continue
    if (!isPoolSelected(pool)) continue
    try {
      const fluidAdapter = lending.getByPool(pool.poolId)
      if (fluidAdapter?.getAvailableBorrows) {
        // setFluidPool sets the current pool context; getAvailableBorrows only computes that pool.
        // Store a plain USD number (same as compound/aave) so availableQty/availableUsd stay numeric —
        // a '$...' string made the qty division NaN and availableUsd always '-' (masking real borrowable).
        setFluidPool(pool.poolId)
        const cents = await fluidAdapter.getAvailableBorrows(address.value as `0x${string}`)
        result[pool.poolId] = cents > 0n ? Number(cents) / 100 : 0
      }
    } catch (e) {
      console.warn('[Borrow] Failed to fetch fluid available for', pool.poolId, e)
      result[pool.poolId] = 0
    }
  }

  // Morpho Blue: fetch borrowable amounts per pool (loanToken) in one shot
  try {
    const morphoAdapter = lending.get('morpho')
    if (morphoAdapter?.getAvailableBorrowsByPool) {
      const byLoan = await morphoAdapter.getAvailableBorrowsByPool(address.value as `0x${string}`)
      for (const pool of lendingPools) {
        if (pool.protocolId !== 'morpho' || !pool.borrowAddress) continue
        if (!isPoolSelected(pool)) continue
        const cents = byLoan.get(getAddress(pool.borrowAddress)) ?? 0n
        result[pool.poolId] = cents > 0n ? Number(cents) / 100 : 0
      }
    } else {
      for (const pool of lendingPools) {
        if (pool.protocolId === 'morpho' && isPoolSelected(pool)) result[pool.poolId] = 0
      }
    }
  } catch (e) {
    console.warn('[Borrow] Failed to fetch morpho available', e)
    for (const pool of lendingPools) {
      if (pool.protocolId === 'morpho' && isPoolSelected(pool)) result[pool.poolId] = 0
    }
  }

  availableAmounts.value = result
  loadingAvailable.value = false
}

watch(address, () => {
  fetchAvailableBorrows()
  fetchBorrowRates()
})
onMounted(() => {
  fetchAvailableBorrows()
  fetchBorrowRates()
})

const selectedProtocols = inject<Ref<string[]>>('lendingSelectedProtocols', ref([]))
watch(selectedProtocols, () => {
  fetchAvailableBorrows()
  fetchBorrowRates()
})
const portfolioKeyword = inject<Ref<string>>('portfolioKeyword', ref(''))

// ETH/WETH bidirectional lookup: Aave's borrowAPY key is the 0xEeee placeholder, Fluid vault 13 is WETH
function lookupBorrowApy(borrowRates: Record<string, number>, poolId: string, addr: string): number | undefined {
  const ETH = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
  const a = (addr || '').toLowerCase()
  const candidates = [a]
  if (a === ETH) candidates.push(WETH)
  if (a === WETH) candidates.push(ETH)
  for (const c of candidates) {
    const v = borrowRates[`${poolId}:${c}`]
    // Skip 0: fluid's ETH collateral entries have borrowAPY=0; keep looking for the WETH borrow entry
    if (v !== undefined && v > 0) return v
  }
  return undefined
}

const columns = [
  { key: 'protocol', label: 'Protocol' },
  { key: 'asset', label: 'Asset' },
  { key: 'available', label: 'Available' },
  { key: 'apy', label: 'APY' }
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

// All borrowable assets: iterate each pool's borrowable assets
const allBorrowable = computed(() => {
  const list: Array<{
    poolId: string
    protocolId: string
    protocol: string
    asset: string
    assetAddress: string
    borrowAPY: number | undefined
  }> = []

  for (const pool of lendingPools) {
    // Cross-asset pools: iterate the borrowAssets array
    if (pool.isCrossAsset && pool.borrowAssets) {
      for (const ba of pool.borrowAssets) {
        list.push({
          poolId: pool.poolId,
          protocolId: pool.protocolId,
          protocol: getBaseProtocolName(pool.poolId || pool.protocolId),
          asset: ba.symbol === 'WETH' ? 'ETH' : ba.symbol,
          assetAddress: ba.address,
          // Borrow APY uniformly uses real-time on-chain data (keyed by protocol:asset); no more hardcoded defaults
          borrowAPY: lookupBorrowApy(borrowRates.value, pool.protocolId, ba.address),
        })
      }
    } else if (pool.borrowAsset) {
      // Single-collateral/single-borrow pools: use borrowAsset/borrowAddress directly
      list.push({
        poolId: pool.poolId,
        protocolId: pool.protocolId,
        protocol: getBaseProtocolName(pool.poolId || pool.protocolId),
        asset: pool.borrowAsset === 'WETH' ? 'ETH' : pool.borrowAsset,
        assetAddress: pool.borrowAddress,
        borrowAPY: pool.borrowAddress ? lookupBorrowApy(borrowRates.value, pool.protocolId, pool.borrowAddress) : undefined,
      })
    }
  }
  // Aave/SparkLend do not support borrowing wstETH: exclude it from the borrowable list
  return list.filter(item => item.asset.toLowerCase() !== 'wsteth')
})

// Sort by agreement after filtering
const sortedData = computed(() => {
  let data = allBorrowable.value

  // Search by keyword
  const kw = portfolioKeyword.value?.toLowerCase().trim()
  if (kw) {
    data = data.filter(item =>
      item.protocol.toLowerCase().includes(kw) ||
      item.asset.toLowerCase().includes(kw)
    )
  }

  // Filter by the selected protocol (match by protocolId)
  if (selectedProtocols.value.length > 0) {
    data = data.filter(item =>
      selectedProtocols.value.includes(item.protocolId.toLowerCase())
    )
  }

  if (!sortKey.value) return data
  const copied = [...data]
  copied.sort((a, b) => {
    const v1 = a[sortKey.value as keyof typeof a] || ''
    const v2 = b[sortKey.value as keyof typeof b] || ''
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

function openBorrow(item: any) {
  const enriched = enrichLendingItem(item, 'borrow')
  const usd = availableAmounts.value[item.poolId] ?? 0
  enriched.available = usd > 0 ? '$' + usd.toFixed(2) : undefined
  fetchBorrowedBalanceForRepay(enriched)
  selectedItem.value = enriched
  lendingModalVisible.value = true
}

// Query the asset's outstanding borrow on-chain so the Repay tab has real data (independent of whether row data carries a balance)
async function fetchBorrowedBalanceForRepay(enriched: any) {
  if (!address.value || !enriched.assetAddress) return
  try {
    const wei = await fetchLendingBorrowedBalance({
      account: address.value,
      poolId: enriched.poolId,
      protocolId: enriched.protocolId,
      assetAddress: enriched.assetAddress
    })
    if (wei > 0n) {
      const decimals = enriched.decimals || 18
      enriched.balance = Math.floor(Number(wei) / 10 ** decimals * 1e6) / 1e6 + ''
    } else {
      enriched.balance = '0'
    }
  } catch (e) {
    console.warn('[Toborrow] fetchBorrowedBalance failed:', e)
  }
}

function handleStake(ev: { amount: string }) {
}
</script>

<style scoped>
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
