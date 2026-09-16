<template>
  <div class="lending-panel active">
    <div class="claim-bar">
      <div class="bar-title">{{ liquidityOnly ? 'Liquidity' : 'Asset to supply' }}</div>
      <div class="bar-menu">
        <div></div>
        <button class="toggle" @click="expanded = !expanded">
          <img v-if="expanded" src="@/assets/icons/lendingclose.svg" />
          <img v-else src="@/assets/icons/lendingopen.svg" />
        </button>
      </div>
    </div>
    <div class="show-no-zero" :class="{ off: !showZeroBalance }" @click="showZeroBalance = !showZeroBalance">
      <img src="@/assets/icons/yes.png" />
      <span>Show assets with 0 balance</span>
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
            <tr v-for="r in displayedData" :key="(r.poolId || r.protocolId) + r.asset" @click="isMobile && openSupply(r)">
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
                  <span v-else>{{ r.balance || '0' }}</span>
                  <span v-if="!r.loading && !r.error">{{ r.balanceUsd || '$0.00' }}</span>
                </div>
              </td>
              <td>{{ r.apyFormatted || '-' }}</td>
              <td>
                <div class="op-btn-wrapper">
                  <div class="list-op-btn" @click.stop="openSupply(r)">Supply</div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="loadingMarkets" class="loading">Loading market balances...</div>
        <div v-if="!loadingMarkets && displayedData.length < allAssets.length" class="more" @click="showAll = true">
          Show More <img src="@/assets/icons/arrow_down.svg"/>
        </div>
      </div>
    </Transition>
  </div>
  <LendingModal v-model="lendingModalVisible" :balance="userEthBalance" :selectedItem="selectedItem" :availableTabs="['Supply', 'Withdraw']" @stake="handleStake" />
</template>

<script setup lang="ts">
import { ref, computed, inject, watch, onMounted, onBeforeUnmount, type Ref } from 'vue'
import LendingModal from '@/components/lendingOp/index.vue'
import { useUserEthBalance } from '@/composables/useBalance'
import { type SupplyBalance } from '@/composables/usePortfolio'
import { lendingProtocols, lendingPools, LENDING_POOL_NAMES } from '@/constants/protocols'
import { enrichLendingItem } from '@/composables/useLendingItem'
import { publicClient } from '@/chain/core/provider'
import { ERC20_ABI } from '@/chain/evm/abis'
import { multicall } from 'viem/actions'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { useLendingPrices, getPriceByAddress } from '@/composables/useLendingPrices'
import { getLendingRates, computeLendingUtilization, type LendingRateInfo } from '@/composables/useLendingApy'

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

const walletStore = useWalletStore()
const { address } = storeToRefs(walletStore)

const { suppliedBalances, loadingBalances, refetchBalances, refetchInfo } = inject('lendingPosition')!

// Protocol ID to display name mapping
const PROTOCOL_NAMES: Record<string, string> = {
  aave: 'AAVE',
  compound: 'Compound',
  morpho: 'Morpho',
  sparklend: 'SparkLend',
  curve: 'Curve',
  fluid: 'Fluid',
}

// Get the selected protocol list from the parent component
const selectedProtocols = inject<Ref<string[]>>('lendingSelectedProtocols', ref([]))
const portfolioKeyword = inject<Ref<string>>('portfolioKeyword', ref(''))

interface DisplayRow extends SupplyBalance {
  loading?: boolean
  receiptToken?: string
  receiptTokenSymbol?: string
  decimals?: number
  utilization?: string
}

// liquidityOnly (Liquidity panel): liquidity assets have no collateral concept; do not show the Collateral column
const columns = computed(() => {
  const cols = [
    { key: 'protocol', label: 'Protocol' },
    { key: 'asset', label: 'Asset' },
    { key: 'balance', label: 'Balance' },
    { key: 'apyFormatted', label: 'APY' },
  ]
  return cols
})

// On-chain market balance cache (protocolId:assetAddress -> balanceWei)
const marketBalances = ref<Record<string, bigint>>({})
// Real-time on-chain rates (key: protocolId:assetAddress → {supplyAPY, borrowAPY}); same source as the Your Supplies / Lending market pages
const marketRates = ref<Record<string, LendingRateInfo>>({})
const loadingMarkets = ref(false)
let balancesFetched = false

// Fetch rates for all involved protocols on-chain (shared cache, once per protocol)
async function fetchMarketRates() {
  const merged: Record<string, LendingRateInfo> = {}
  await Promise.all(lendingPools.map(async pool => {
    const rates = await getLendingRates(pool.protocolId, pool.poolId)
    if (!rates) return
    for (const [addr, info] of rates) {
      merged[`${pool.protocolId}:${addr}`] = info
    }
  }))
  marketRates.value = merged
}

// Query wallet balances on-chain (all ERC20 calls merged into one multicall)
async function fetchAllMarketBalances() {
  if (!address.value || balancesFetched) return

  loadingMarkets.value = true
  const result: Record<string, bigint> = {}

  // 1. Collect all deduped asset addresses (ERC20 and ETH)
  const erc20Addresses: string[] = []
  let hasETH = false

  for (const pool of lendingPools) {
    const liq = pool.liquidityAssets || []
    const coll = pool.collateralAssets || (pool.collateralAsset ? [{ symbol: pool.collateralAsset, address: pool.collateralAddress }] : [])
    const assets = [...liq, ...coll]
    for (const ca of assets) {
      const addr = ca.address?.toLowerCase()
      if (!addr || result[addr] !== undefined) continue
      result[addr] = BigInt(0) // placeholder
      if (addr === ETH_PLACEHOLDER) hasETH = true
      else erc20Addresses.push(addr)
    }
  }

  // 2. Query the ETH balance separately (not supported by multicall)
  if (hasETH) {
    try {
      result[ETH_PLACEHOLDER] = await publicClient.getBalance({ address: address.value })
    } catch (e) {
      console.warn('[Assets] 查询 ETH 余额失败:', e)
    }
  }

  // 3. All ERC20 balanceOf calls in one multicall
  if (erc20Addresses.length > 0) {
    const contracts = erc20Addresses.map(addr => ({
      address: addr as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf' as const,
      args: [address.value as `0x${string}`],
    }))

    try {
      const results = await multicall(publicClient, { contracts, allowFailure: true })
      for (let i = 0; i < erc20Addresses.length; i++) {
        const r = results[i]
        result[erc20Addresses[i]] = r.status === 'success' ? (r.result as bigint) : BigInt(0)
      }
    } catch (e) {
      console.warn('[Assets] multicall 查询余额失败:', e)
      // Fallback: query one by one
      for (const addr of erc20Addresses) {
        try {
          result[addr] = await publicClient.readContract({
            address: addr as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [address.value as `0x${string}`]
          }) as bigint
        } catch {
          result[addr] = BigInt(0)
        }
      }
    }
  }

  marketBalances.value = result
  loadingMarkets.value = false
  balancesFetched = true
}

// Re-query when the watched address changes (immediate: also fires on the first frame when a wallet is connected, otherwise balances stay 0 and the zero-balance toggle breaks)
watch(address, () => {
  balancesFetched = false
  if (address.value) {
    fetchAllMarketBalances()
    fetchMarketRates()
  }
}, { immediate: true })

// Use the price oracle
const { prices } = useLendingPrices()

// Merge all assets (supplied + supplyable) using on-chain balances
const allAssets = computed<DisplayRow[]>(() => {
  const list: DisplayRow[] = []

  // 1. Build the asset list from on-chain balance data
  const seen = new Set<string>()

  // Iterate over lendingPools' liquidity assets + collateral assets
  for (const pool of lendingPools) {
    const liq = pool.liquidityAssets || []
    const coll = pool.collateralAssets || (pool.collateralAsset ? [{ symbol: pool.collateralAsset, address: pool.collateralAddress }] : [])
    // liquidityOnly: the liquidity panel shows only liquidity assets; Asset to supply shows only collateral
    // (liquidity assets are already shown by the dedicated Liquidity panel to avoid duplication)
    const assets = props.liquidityOnly ? liq : coll
    for (const ca of assets) {
      const addr = ca.address?.toLowerCase()
      if (!addr) continue
      const seenKey = pool.poolId + ':' + addr
      if (seen.has(seenKey)) continue
      seen.add(seenKey)

      const balanceWei = marketBalances.value[addr]
      const suppliedItem = suppliedBalances.value.find(
        s => s.assetAddress?.toLowerCase() === addr &&
             (s.poolId === pool.poolId || s.protocolId === pool.protocolId)
      )

      // Look up metadata from lendingProtocols (decimals, receiptToken, APY)
      const marketMeta = lendingProtocols.find(m => m.assetAddress?.toLowerCase() === addr)
      const decimals = marketMeta?.decimals || 18
      const rawBalance = balanceWei !== undefined ? balanceWei : BigInt(0)
      const formattedBalance = rawBalance > BigInt(0)
        ? Math.floor(Number(rawBalance) / Math.pow(10, decimals) * 1e6) / 1e6 + ''
        : '0'

      const balanceNum = parseFloat(formattedBalance)
      // prices is a ref from useLendingPrices(); unwrap with .value (script logic does not auto-unwrap like templates)
      const usdPrice = addr ? getPriceByAddress(prices.value, addr) : 0
      const balanceUsd = balanceNum > 0 && usdPrice > 0
        ? `$${(balanceNum * usdPrice).toFixed(2)}`
        : '$0.00'

      // APY uniformly uses real-time on-chain data (keyed by protocol:asset to avoid same-asset overwrites across protocols); no hardcoded defaults
      // Match by original address first (fluid collateral ETH placeholder/wstETH), then fallback ETH→ WETH normalization
      const rate = marketRates.value[`${pool.protocolId}:${addr}`]
        ?? marketRates.value[`${pool.protocolId}:${normAssetKey(addr)}`]
      const baseId = (pool.poolId || pool.protocolId).split('-')[0]
      // Compound/Morpho collateral has no rates (only base/liquidity assets have supplyAPY).
      // The Asset to supply panel shows only collateral; APY is always '-', consistent with the Lending market page;
      // also prevents ETH→WETH normalization from mis-matching Compound's collateral ETH to another pool's base-asset rate
      const collateralNoApy = !props.liquidityOnly && (baseId === 'compound' || baseId === 'morpho')
      // liquidityOnly: Fluid liquidity assets show the fToken rate (liquidityAPY, e.g. fUSDC 4.75%),
      // not the vault collateral supply rate (1.72%); Compound/Morpho's supplyAPY is their liquidity rate
      const apyNum = collateralNoApy
        ? 0
        : (props.liquidityOnly && rate?.liquidityAPY !== undefined
            ? rate.liquidityAPY
            : (rate?.supplyAPY ?? (suppliedItem?.apy ?? 0)))
      const NAME_MAP: Record<string, string> = { aave: 'AAVE', compound: 'Compound', morpho: 'Morpho', fluid: 'Fluid', sparklend: 'SparkLend' }
      const poolName = NAME_MAP[baseId] || baseId

      // Utilization — same on-chain source & algorithm as the Lending market page, so the popup shows the same value
      // from either entry point (without it the modal falls back to '0.00'). rate may be undefined while loading → '-'.
      // Cross-asset pools (Fluid vault): the collateral entry carries 0 supply (totalSupply=0n) → utilization would be
      // 0. Look up the pool's loan-asset rate (real totalSupply/totalBorrow) instead; APY still uses the collateral rate.
      const loanAsset = (pool.borrowAddress || '').toLowerCase()
      const utilRate = loanAsset && loanAsset !== addr
        ? (marketRates.value[`${pool.protocolId}:${loanAsset}`]
          ?? marketRates.value[`${pool.protocolId}:${normAssetKey(loanAsset)}`])
        : rate
      const utilNum = utilRate ? computeLendingUtilization(utilRate, {
        prices: prices.value,
        assetAddress: addr,
        loanAssetAddress: pool.borrowAddress || '',
        decimals,
      }) : 0

      list.push({
        poolId: pool.poolId,
        protocolId: pool.protocolId,
        protocol: poolName,
        asset: ca.symbol === 'WETH' ? 'ETH' : ca.symbol,
        assetAddress: addr,
        receiptToken: marketMeta?.receiptToken,
        receiptTokenSymbol: marketMeta?.receiptTokenSymbol,
        decimals,
        balanceWei: rawBalance,
        balance: formattedBalance,
        balanceUsd,
        collateral: suppliedItem?.collateral ?? false,
        apy: apyNum,
        apyFormatted: apyNum > 0 ? apyNum.toFixed(2) + '%' : '-',
        utilization: utilRate ? (utilNum >= 0.01 ? utilNum.toFixed(2) + '%' : '<0.01%') : '-',
        loading: loadingMarkets.value,
        error: null
      })
    }
  }

  // 2. Search by keyword
  const kw = portfolioKeyword.value?.toLowerCase().trim()
  if (kw) {
    return list.filter(item =>
      item.protocol.toLowerCase().includes(kw) ||
      item.asset.toLowerCase().includes(kw)
    )
  }

  // 3. Filter by the selected protocol
  if (selectedProtocols.value.length > 0) {
    return list.filter(item =>
      selectedProtocols.value.includes(item.protocolId.toLowerCase())
    )
  }

  return list
})

const sortKey = ref('')
const sortOrder = ref('')

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

const sortedData = computed(() => {
  if (!sortKey.value) return allAssets.value
  const copied = [...allAssets.value]
  copied.sort((a, b) => {
    const v1 = a[sortKey.value as keyof DisplayRow] || ''
    const v2 = b[sortKey.value as keyof DisplayRow] || ''
    if (typeof v1 === 'number' && typeof v2 === 'number') {
      return sortOrder.value === 'asc' ? v1 - v2 : v2 - v1
    }
    return sortOrder.value === 'asc'
      ? String(v1).localeCompare(String(v2))
      : String(v2).localeCompare(String(v1))
  })
  return copied
})

const displayedData = computed(() => {
  // Show assets with 0 balance toggle: hides zero-balance rows when off (rows still loading are kept)
  const list = showZeroBalance.value
    ? sortedData.value
    : sortedData.value.filter(r =>
        r.loading ||
        (typeof r.balanceWei === 'bigint' ? r.balanceWei > 0n : parseFloat(r.balance) > 0)
      )
  return showAll.value ? list : list.slice(0, 4)
})

const showAll = ref(false)
const expanded = ref(true)
const showZeroBalance = ref(true)

const icons = import.meta.glob('@/assets/logos/*.svg', { eager: true, import: 'default' })

// poolId → borrow info lookup table
const poolBorrowMap = new Map<string, { symbol: string; address: string }>()
const crossAssetBorrowMap = new Map<string, Array<{ symbol: string; address: string }>>()
const liquidityKeys = new Set<string>()
for (const p of lendingPools) {
  if (p.isCrossAsset) {
    crossAssetBorrowMap.set(p.poolId, p.borrowAssets || [])
  } else {
    poolBorrowMap.set(p.poolId, { symbol: p.borrowAsset, address: p.borrowAddress })
    if (p.liquidityAsset) liquidityKeys.add(`${p.poolId}:${p.liquidityAsset}`)
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

function openSupply(item: any) {
  selectedItem.value = enrichLendingItem(item, 'supply')
  lendingModalVisible.value = true
}

function handleStake(ev: { amount: string }) {
  // Refresh the wallet balance cache and on-chain data after a successful transaction
  balancesFetched = false
  fetchAllMarketBalances()
  fetchMarketRates()
  refetchBalances()
  refetchInfo()
}

// Query on-chain balances initially
fetchAllMarketBalances()
fetchMarketRates()
</script>

<style scoped>
.show-no-zero {
  display: flex;
  padding: 20px 0 15px;
  gap: 6px;
  align-items: center;
  color: var(--Tab-Color, #9E9E9E);
  font-size: 11px;
  cursor: pointer;
  user-select: none;
}
.show-no-zero img {
  width: 50px;
  transform: translateY(3px);
}
.show-no-zero.off {
  opacity: 0.45;
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
