<template>
  <!-- Mask -->
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modelValue" class="mask" @click.self="close">
        <!-- pop-up window -->
        <div class="modal-overlay">
          <div class="modal">
                      <!-- Heading -->
            <header class="header">
              <div class="title-row">
                <img v-if="selectedItem?.protocol" :src="getIcon(selectedItem.protocol)" alt="Lido" class="logo" />
                <span class="title">{{selectedItem?.protocol}}</span>
              </div>
              <button class="close" @click="close"><img src="@/assets/icons/close-circle.png" /></button>
            </header>
            <div v-if="selectedItem" class="op-body">
              <div class="desc">
                <div class="desc-head">
                  <img :src="getIcon(selectedItem.asset)" />
                  <div class="desc-title">
                    <div class="name">{{selectedItem.asset}}</div>
                    <div class="apy">APY:{{ tab === 'Supply' ? supplyApy : borrowApy }}%</div>
                  </div>
                </div>
                <div class="chart-wrapper">
                  <div class="chart-title">Interest Rate Model</div>
                  <div class="chart-body">
                    <div class="chart">
                      <img v-if="tab==='Supply'" src="@/assets/img/lendingopline.png" />
                      <img v-if="tab==='Borrow'" src="@/assets/img/lendingoplineb.png" />
                    </div>
                    <div class="chart-y">
                      <div v-if="tab === 'Supply'" class="chart-y-title">Supply APY</div>
                      <div v-if="tab === 'Borrow'" class="chart-y-title">Borrow APY</div>
                      <div class="chart-y-item">20%</div>
                      <div class="chart-y-item">15%</div>
                      <div class="chart-y-item">10%</div>
                      <div class="chart-y-item">5%</div>
                      <div class="chart-y-item">0</div>
                    </div>
                    <div class="chart-x">
                      <div class="chart-x-title">Utilization</div>
                      <div class="chart-x-item">25%</div>
                      <div class="chart-x-item">50%</div>
                      <div class="chart-x-item">75%</div>
                      <div class="chart-x-item">100%</div>
                    </div>
                  </div>
                </div>
                <div class="desc-table">
                  <div v-if="tab === 'Supply'" class="desc-table-title">Supply Info</div>
                  <div v-if="tab === 'Borrow'" class="desc-table-title">Borrow Info</div>
                </div>
                <div class="desc-table">
                  <div class="item">
                    <div class="title">Protocol</div>
                    <div class="content">
                      <img :src="getIcon(selectedItem.protocol)"/>
                      <span>{{selectedItem.protocol}}</span>
                    </div>
                  </div>
                  <div class="item">
                    <div v-if="tab === 'Supply'" class="title">Supply APY</div>
                    <div v-if="tab === 'Borrow'" class="title">Borrow APY</div>
                    <div class="content">{{ tab === 'Supply' ? supplyApy : borrowApy }}%</div>
                  </div>
                  <div class="item">
                    <div class="title">Utilization</div>
                    <div class="content">{{ utilization }}</div>
                  </div>
                  <div class="item">
                    <div class="title">Max LTV</div>
                    <div class="content">{{ maxLtv }}%</div>
                  </div>
                </div>
                <div class="desc-table">
                  <div class="item">
                    <div class="title">Liquidation Threshold</div>
                    <div class="content">{{ liquidationThreshold }}%</div>
                  </div>
                  <div class="item">
                    <div class="title"></div>
                    <div class="content"></div>
                  </div>
                  <div class="item">
                    <div class="title">Liquidation Penalty</div>
                    <div class="content">{{ liquidationPenalty }}%</div>
                  </div>
                  <div class="item">
                    <div class="title"></div>
                    <div class="content"></div>
                  </div>
                </div>
              </div>
              <div class="op">

                <!-- Tab button -->
                <div class="tabs">
                  <button
                    v-for="t in tabs"
                    :key="t"
                    :class="['tab', { active: tab === t }]"
                    @click="tab = t"
                  >
                    {{ t }}
                  </button>
                </div>
                <Deposit
                  v-if="tab==='Supply'"
                  :asset="selectedItem.asset"
                  :asseticon="getIcon(selectedItem.asset)"
                  :assetAddress="selectedItem.assetAddress"
                  :protocol="selectedItem.protocolId || selectedItem.protocol"
                  :poolId="selectedItem.poolId"
                  :decimals="selectedItem.decimals"
                  @openProcess="handleUpdate"
                  :supplyApy="supplyApy"
                  :utilization="utilization"
                  :collateralization="maxLtv > 0 ? 'Enabled' : 'Disabled'"
                  :maxLtv="supplyMaxLtv"
                  :liquidationThreshold="supplyLiquidationThreshold"
                  :liquidationPenalty="supplyLiquidationPenalty"
                ></Deposit>
                <Withdraw
                  v-if="tab==='Withdraw'"
                  :asset="selectedItem.asset"
                  :asseticon="getIcon(selectedItem.asset)"
                  :assetAddress="selectedItem.assetAddress"
                  :receiptToken="selectedItem.receiptToken"
                  :receiptTokenSymbol="selectedItem.receiptTokenSymbol"
                  :protocol="selectedItem.protocolId || selectedItem.protocol"
                  :poolId="selectedItem.poolId"
                  :decimals="selectedItem.decimals"
                  :supplyApy="supplyApy"
                  :collateralization="maxLtv > 0 ? 'Enabled' : 'Disabled'"
                  @openProcess="handleUpdate"
                ></Withdraw>
                <Borrow
                  v-if="tab==='Borrow'"
                  :asset="borrowAssetName"
                  :asseticon="getIcon(borrowAssetName)"
                  :assetAddress="borrowAssetAddr"
                  :protocol="selectedItem.protocolId || selectedItem.protocol"
                  :poolId="selectedItem.poolId"
                  :decimals="borrowAssetDecimals"
                  :borrowApy="borrowApy"
                  :balance="selectedItem.available"
                  @openProcess="handleUpdate"
                ></Borrow>
                <Repay v-if="tab==='Repay'" :asset="borrowAssetName" :asseticon="getIcon(borrowAssetName)" :assetAddress="borrowAssetAddr" :protocol="selectedItem.protocolId || selectedItem.protocol" :poolId="selectedItem.poolId" :decimals="borrowAssetDecimals" :borrowApy="borrowApy" :borrowedBalance="selectedItem.balance" @openProcess="handleUpdate"></Repay>
                <div class="banner">
                  <div class="banner-title">One place. Best yields. Full control.</div>
                  <div class="banner-desc">Compare and earn across top DeFi protocols.</div>
                  <img class="banner-bg-1" src="@/assets/img/stableopbg.png" />
                  <img class="banner-bg-2" src="@/assets/img/stableopbg1.png" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Deposit from './deposit.vue'
import Withdraw from './withdraw.vue'
import Borrow from './borrow.vue'
import Repay from './repay.vue'
import Process from '../process.vue'
import { getLendingRates } from '@/composables/useLendingApy'
import { lendingProtocols } from '@/constants/protocols'
import { lending } from '@/chain/lending'

const isProcess = ref(false)
const activeTab = ref<'1 Week'|'1 Month'|'3 Month'|'1 Year'>('1 Week')
const timeTabs: Array<typeof activeTab.value> = ['1 Week', '1 Month', '3 Month', '1 Year']

function handleUpdate(msg: boolean) {
  isProcess.value = msg
  // Refresh data on the notification list page when the transaction is completed
  if (msg) {
    emit('stake', { amount: '' })
  }
}
// Bulk import using Vite's import.meta.glob
const icons = import.meta.glob('@/assets/logos/*.svg', { 
  eager: true,
  import: 'default' 
})
// Extract symbol from path
const getIcon = (symbol: string) => {
  if (!symbol || typeof symbol !== 'string') return ''
  const s = symbol.toLowerCase()
  for (const [path, icon] of Object.entries(icons)) {
    if (path.includes(s)) {
      return icon as string
    }
  }
  return ''
}
/* Interface */
const props = withDefaults(defineProps<{
  modelValue: boolean          // v-model show/hide
  balance?: string             // Account ETH Balance
  selectedItem?: any
  availableTabs?: string[]     // Available tabs
  initialTab?: string          // Initially active tab
}>(), {
  availableTabs: () => ['Supply'],
  initialTab: ''
})

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  stake: [{ amount: string }] // Click on Stake to throw
}>()

/* Status */
// Aave/SparkLend do not support borrowing wstETH: hide the Borrow module when the borrow asset is wstETH
const isWstEthBorrow = computed(() => {
  const asset = (props.selectedItem?.loanAsset || props.selectedItem?.asset || '').toLowerCase()
  return asset === 'wsteth'
})
// Use externally provided tabs, defaulting to only Supply; drop 'Borrow' for wstETH
const tabs = computed(() => {
  const list = props.availableTabs
  if (!isWstEthBorrow.value) return list
  return list.filter(t => t.toLowerCase() !== 'borrow')
})
const tab = ref('')
const amount = ref('')

// Init/switch tab: prefer initialTab, otherwise use the first available tab
function initTab() {
  const available = tabs.value
  if (props.initialTab && available.includes(props.initialTab)) {
    tab.value = props.initialTab
  } else {
    tab.value = available[0] || 'Supply'
  }
}

// Recompute the tab when the modal opens
watch(() => props.modelValue, (val) => {
  if (val) initTab()
})

// Also sync when availableTabs or the borrow asset changes (but no longer force-reset to the first)
watch(() => [props.availableTabs, isWstEthBorrow.value], () => {
  // Only switch when the current tab is invalid
  if (tab.value && !tabs.value.includes(tab.value)) {
    initTab()
  }
})

initTab()

/* COMPUTING: */
const receive = computed(() => amount.value || '0') // 1: 1 Simplification

// Read data directly from selectedItem (no more API calls)
// Handle field naming differences across entry points: metrics.supplyApy / metrics.supplyAPY / supplyApy / supplyAPY / apy
// The string may already include '%' (e.g. formatPercent results on the Lending page); normalize it to a numeric string
function extractApy(...candidates: any[]): string {
  // Prefer parsing formatted strings ('3.28%' / '-') so missing values are not treated as 0.00%
  for (const val of candidates) {
    if (typeof val === 'string' && val.trim() !== '') {
      const s = val.trim()
      if (s === '-') return '-'
      const n = Number(s.replace(/[%\s]/g, ''))
      if (Number.isFinite(n)) return n.toFixed(2)
    }
  }
  // Numeric fallback: treat 0 as missing (a real 0.00% comes from upstream as the string '0.00%')
  for (const val of candidates) {
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val.toFixed(2)
  }
  return '-'
}
const supplyApy = computed(() => {
  const s = props.selectedItem
  return extractApy(s?.metrics?.supplyApy, s?.metrics?.supplyAPY, s?.supplyApy, s?.supplyAPY, s?.apyFormatted, s?.apy)
})
const borrowApy = computed(() => {
  const s = props.selectedItem
  return extractApy(s?.metrics?.borrowApy, s?.metrics?.borrowAPY, s?.borrowApy, s?.borrowAPY, s?.apyFormatted, s?.apy)
})
const utilization = computed(() => {
  const val = props.selectedItem?.metrics?.utilization ?? props.selectedItem?.utilization
  return typeof val === 'number' ? val.toFixed(2) : (val || '0.00')
})
const maxLtv = computed(() => {
  const val = props.selectedItem?.risk?.maxLtv ?? props.selectedItem?.maxLtv
  return typeof val === 'number' ? val.toFixed(2) : (val || '0.00')
})
const liquidationThreshold = computed(() => {
  const val = props.selectedItem?.risk?.liquidationThreshold ?? props.selectedItem?.liquidationThreshold
  return typeof val === 'number' ? val.toFixed(2) : (val || '0.00')
})
const liquidationPenalty = computed(() => {
  const val = props.selectedItem?.risk?.liquidationPenalty ?? props.selectedItem?.liquidationPenalty
  return typeof val === 'number' ? val.toFixed(2) : (val || '0.00')
})

// The Borrow tab uses loanAsset (different from collateral in single-supply/single-borrow pools)
const borrowAssetName = computed(() => props.selectedItem?.loanAsset || props.selectedItem?.asset)
const borrowAssetAddr = computed(() => props.selectedItem?.loanAssetAddress || props.selectedItem?.assetAddress)
const borrowAssetDecimals = computed(() => props.selectedItem?.loanDecimals || props.selectedItem?.decimals)

/* ---------- Supply tab risk params: resolved by supply/collateral asset, on-chain first, config fallback ---------- */
// Max LTV / Liquidation Threshold / Liquidation Penalty belong to the collateral (supply) side:
// Displayed in the Supply module; prefer live on-chain values, fall back to config when missing (retry as WETH when the ETH placeholder misses).
const supplyRisk = ref<{ maxLtv?: number; liquidationThreshold?: number; liquidationPenalty?: number }>({})
watch(
  () => [props.selectedItem?.assetAddress, props.selectedItem?.protocolId || props.selectedItem?.protocol, props.selectedItem?.poolId, props.selectedItem],
  async () => {
    const addr = (props.selectedItem?.assetAddress || '').toLowerCase()
    const protoId = props.selectedItem?.protocolId || props.selectedItem?.protocol || ''
    const poolId = props.selectedItem?.poolId

    if (addr && protoId) {
      try {
        // Compound: factors are independent per pool and per collateral asset (WBTC/ETH/wstETH differ across pools),
        // Cannot use a protocol-level rates map; query the official on-chain factors directly by (poolId, asset)
        if (protoId === 'compound' && poolId) {
          const adapter = lending.getByPool(poolId)
          const cr = await adapter?.getCollateralRisk?.(poolId, addr)
          if (cr && (cr.maxLtv !== undefined || cr.liquidationThreshold !== undefined || cr.liquidationPenalty !== undefined)) {
            supplyRisk.value = cr
            return
          }
        }
        const rates = await getLendingRates(protoId, poolId)
        const ETH_PLACEHOLDER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
        const WETH_ADDR = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
        let r = rates?.get(addr)
        if (addr === ETH_PLACEHOLDER && !(r && (r.maxLtv !== undefined || r.liquidationThreshold !== undefined || r.liquidationPenalty !== undefined))) {
          r = rates?.get(WETH_ADDR)
        }
        // Morpho (pooled, single-borrow): the GraphQL/official risk (lltv) is keyed by the LOAN asset, not the
        // collateral. A collateral that is never a loan (e.g. WBTC) has no own entry — its market LTV lives under
        // the loan key (USDT/USDC). Fall back to the loan asset so the Supply modal shows the real on-chain LTV
        // instead of the config value (mirrors the Borrow tab, which resolves Morpho by loan asset).
        if (protoId === 'morpho' && !(r && (r.maxLtv !== undefined || r.liquidationThreshold !== undefined || r.liquidationPenalty !== undefined))) {
          const loanAddr = props.selectedItem?.loanAssetAddress?.toLowerCase()
          if (loanAddr) r = rates?.get(loanAddr)
        }
        // SparkLend USDC/USDT cannot be used as collateral (on-chain LTV/threshold/penalty = 0) → no risk params, show '-'
        if (r && protoId === 'sparklend' &&
            r.maxLtv === undefined && r.liquidationThreshold === undefined && r.liquidationPenalty === undefined) {
          supplyRisk.value = {}
          return
        }
        if (r && (r.maxLtv !== undefined || r.liquidationThreshold !== undefined || r.liquidationPenalty !== undefined)) {
          supplyRisk.value = {
            maxLtv: r.maxLtv,
            liquidationThreshold: r.liquidationThreshold,
            liquidationPenalty: r.liquidationPenalty,
          }
          return
        }
      } catch (e) {
        // On-chain failure → fall back to config
      }
    }
    const cfg = addr && protoId
      ? lendingProtocols.find(p => (p.protocolId === protoId || p.protocol === protoId) && p.assetAddress?.toLowerCase() === addr)?.risk
      : undefined
    // Lending page rows carry the resolved risk under `.risk`; the Portfolio path goes through enrichLendingItem,
    // which puts the resolved risk at the TOP level (maxLtv/liquidationThreshold/liquidationPenalty) without a `.risk`
    // key. Read both so Portfolio doesn't fall through to the default 80/83/5 when the on-chain lookup is unavailable.
    const selTopRisk = props.selectedItem?.maxLtv !== undefined ? {
      maxLtv: props.selectedItem?.maxLtv,
      liquidationThreshold: props.selectedItem?.liquidationThreshold,
      liquidationPenalty: props.selectedItem?.liquidationPenalty,
    } : undefined
    const fallback = cfg || props.selectedItem?.risk || selTopRisk || { maxLtv: 80, liquidationThreshold: 83, liquidationPenalty: 5 }
    supplyRisk.value = {
      maxLtv: fallback.maxLtv,
      liquidationThreshold: fallback.liquidationThreshold,
      liquidationPenalty: fallback.liquidationPenalty,
    }
  },
  { immediate: true }
)
const supplyMaxLtv = computed(() => (typeof supplyRisk.value.maxLtv === 'number' ? supplyRisk.value.maxLtv.toFixed(2) : '-'))
const supplyLiquidationThreshold = computed(() => (typeof supplyRisk.value.liquidationThreshold === 'number' ? supplyRisk.value.liquidationThreshold.toFixed(2) : '-'))
const supplyLiquidationPenalty = computed(() => (typeof supplyRisk.value.liquidationPenalty === 'number' ? supplyRisk.value.liquidationPenalty.toFixed(2) : '-'))

const amountErr = computed(() => Number(amount.value) <= 0)
const disabled = computed(() => {
  const val = Number(amount.value)
  return !val || val > Number(props.balance)
})

/* METHOD */
function close() {
  isProcess.value = false
  emit('update:modelValue', false)
}
function handleStake() {
  if (disabled.value) return
  emit('stake', { amount: amount.value })
  close()
}
</script>

<style scoped>
/* Variabile */
:root {
  --bg: #0F0E13;
  --card: #17161E;
  --line: #24232C;
  --primary: #00A3FF;
  --text1: #fff;
  --text2: #fff;
  --error: #F87171;
  --radius: 16px;
  --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

/* Mask */
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 99999;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* pop-up window */
.modal {
  display: flex;
  /* Temporary removal of historical data */
  /* width: 875px; */
  width: 415px;
  min-height: 660px;
  padding: 25px 30px 24px;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  border-radius: 30px;
  border: 0.771px solid var(--Secondary-500, #44444A);
  background: var(--Other-BG, #1E1E20);
  box-shadow: 21.118px 38.012px 63.354px -6.335px rgba(0, 0, 0, 0.75);
}
.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 400px;
  color: #ACB5BB;
  font-size: 18px;
}

.op-body {
  width:100%;
  display: flex;
  flex-direction: row;
  gap:27px;
}
.desc {
  /* Temporary removal of historical data */
  display:none;
  width: 50%;
  transform: translateY(-40px);
}
.desc-head {
  display: flex;
  justify-content:flex-start;
  align-items: center;
  gap:16px;
}
.desc-head img {
  width: 40px;
  height: 40px;
}
.desc-title {
  display: flex;
  flex-direction: column;
  gap:4px;  
}
.desc-title .name {
  color: var(--Neutral-White, #FFF);
  font-family: Inter;
  font-size: 24px;
  font-style: normal;
  font-weight: 700;
  line-height: normal;
}
.desc-title .apy {
  color: #F2F2F2;
  font-family: Inter;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: normal;
  letter-spacing: 0.14px;
}
.timeTabs { display: flex; gap: 8px; padding:23px 0 32px;}
.timeTabs button {
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
.timeTabs button.active,
.timeTabs button:hover {
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
.chart-wrapper {
  display: flex;
  width: 451px;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 4px;
  margin-top:22px;
}
.chart-title {
  width:100%;
  color: var(--Secondary-100, #EDF1F3);
  text-align: center;
  font-family: Inter;
  font-size: 15px;
  font-style: normal;
  font-weight: 600;
  line-height: 16px; /* 106.667% */
}
.chart-body {
  position: relative;
  width: 100%;
  height: 270px;
}
.chart {
  width: 414.275px;
  height: 250.347px;
  position: absolute;
  right:0;
  top: 0;
}
.chart-y {
  display: flex;
  width: 30px;
  height:262px;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 40px;
  position: relative;
}
.chart-y-title {
  color: var(--Tab-Color, #9E9E9E);
  text-align: left;
  font-family: Inter;
  font-size: 10px;
  font-style: normal;
  font-weight: 600;
  line-height: 16px; /* 160% */
  position:absolute;
  left:0;
  top:-10px;
  width:75px;
}
.chart-y-item {
  color: var(--Tab-Color, #9E9E9E);
  text-align: right;
  font-family: Inter;
  font-size: 13px;
  font-style: normal;
  font-weight: 600;
  line-height: 18px; /* 138.462% */
}
.chart-x {
  width: 415px;
  height: 14px;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  position: absolute;
  right: 0;
}
.chart-x-title {
  color: var(--Tab-Color, #9E9E9E);
  text-align: center;
  font-family: Inter;
  font-size: 10px;
  font-style: normal;
  font-weight: 600;
  line-height: 16px; /* 160% */
  position: absolute;
  top: -15px;
  width:100%;
}
.chart-x-item {
  color: var(--Tab-Color, #9E9E9E);
  font-family: Inter;
  font-size: 13px;
  font-style: normal;
  font-weight: 600;
  line-height: 18px; /* 138.462% */
}
.desc-table {
  display: flex;
  justify-content: space-between;
  margin-top:20px;
  width:451px;
}
.desc-table-title {
  color: var(--Secondary-100, #EDF1F3);
  text-align: center;
  font-family: Inter;
  font-size: 15px;
  font-style: normal;
  font-weight: 600;
  line-height: 16px; /* 106.667% */
  width:100%;
}
.desc-table .item {
  display: flex;
  flex-direction: column;
  gap: 17px;
}
.desc-table .item .title {
  color: var(--Text-10, #fff);
  font-family: Inter;
  font-size: 14px;
  font-style: normal;
  font-weight: 600;
  line-height: normal;
}
.desc-table .item .content {
  color: var(--Font-Color-Light-Subtitle, #B6B6B6);

  /* Regular/Type@12 */
  font-family: Inter;
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 18px */
  letter-spacing: -0.12px;
  display: flex;
  align-items: center;
  height:30px;
}
.desc-table .item .content img {
  width:30px;
  height:30px;
}
.desc-table .item .content span {
  margin-left:5px;
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
.op {
  width:355px;
  height:100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* Temporary removal of historical data */
  /* margin-left:30px;
  margin-top:15px; */
  /* border-left: 2px solid rgba(255,255,255,0.2);*/
}
/* Heading */
.header {
  height:30px;
  display: flex;
  align-items: center;
  color: #fff;
  justify-content: center;
  position:relative;
  width:100%;
}
.close{
  position:absolute;
  right:0;
}
.title-row {
  display: flex;
  padding: 4.914px;
  justify-content: center;
  align-items: center;
  gap: 4.914px;
  border-radius: 4.095px;
  border: 0.819px solid rgba(68, 68, 74, 0.20);
  background: var(--Secondary-600, #2C2C30);
  box-shadow: 0 4.914px 8.191px -2.457px rgba(0, 0, 0, 0.25);
}
.logo {
  width: 20px;
  height: 20px;
}
.title {
  color: #FFF;
  font-family: Inter;
  font-size: 11.467px;
  font-style: normal;
  font-weight: 500;
  line-height: 150%; /* 17.2px */
  letter-spacing: -0.229px;
}
.close {
  display: flex;
  width: 30px;
  height: 30px;
  justify-content: center;
  align-items: center;
}

/* Tab */
.tabs {
  display: flex;
  padding:1px;
  height: 32px;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  align-self: stretch;
  margin-top:0px;
  margin-bottom:25px;
  border-radius: 8px;
  background: var(--Fill-Colors-Light-Tertiary, rgba(118, 118, 128, 0.12));
  box-shadow: 0 4px 4px 0 rgba(0, 0, 0, 0.25);
  overflow:hidden;
}
.tab {
  display: flex;
  padding: 4px;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  flex: 1 0 0;
  align-self: stretch;
  color: var(--Secondary-400, #6C7278);
  text-align: center;
  font-feature-settings: 'liga' off, 'clig' off;
  border-radius: 6px;
  border: 1px solid rgba(118, 118, 128, 0);
  font-family: Inter;
  font-size: 10.8px;
  font-style: normal;
  font-weight: 600;
  line-height: 20px; /* 185.185% */
  letter-spacing: -0.24px;
}
.tab.active {
  display: flex;
  padding: 4px;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 10px;
  flex: 1 0 0;
  align-self: stretch;
  border-radius: 6px;
  border: 1px solid var(--Primary-Default, #FFDD94);
  background: var(--Other-BG, #1E1E20);
  color: var(--Primary-Default, #FFDD94);
  text-align: center;
  font-feature-settings: 'liga' off, 'clig' off;
  font-family: Inter;
  font-size: 10.8px;
  font-style: normal;
  font-weight: 600;
  line-height: 20px; /* 185.185% */
  letter-spacing: -0.24px;
}

/* Body */
.body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.field label {
  font-size: 14px;
  color: #fff;
  margin-bottom: 8px;
  display: block;
}
.input-box {
  display: flex;
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px 16px;
  gap: 12px;
  border-radius: 4.626px;
  border: 0.771px solid var(--Secondary-600, #2C2C30);
  background: var(--Other-BG, #1E1E20);
}
.input-box input {
  flex: 1;
  border: none;
  background: none;
  color: #fff;
  font-size: 24px;
  font-weight: 600;
  outline: none;
}
.input-box .unit {
  font-size: 16px;
  color: #fff;
}
.input-box .max {
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 14px;
  cursor: pointer;
}
.balance {
  font-size: 14px;
  color: #fff;
  margin-top: 6px;
}
.error {
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 9.253px;
  font-style: normal;
  font-weight: 400;
  letter-spacing: -0.093px;
  border-radius: 6.169px;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.20) 0%, rgba(0, 0, 0, 0.20) 100%), var(--Accents-Red, #FF383C);
  box-shadow: 0 4.626px 7.711px -2.313px rgba(0, 0, 0, 0.25);
}
.arrow {
  text-align: center;
  font-size: 20px;
  color: #fff;
}
.stats {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.stats li {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
}
.stats span {
  color: #fff;
}
.stats b {
  color: #fff;
  font-weight: 600;
}

/* GENERAL PUSH-BUTTONS */
.stake-btn {
  margin-top: 24px;
  width: 100%;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 12px;
  padding: 16px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: 0.2s;
}
.stake-btn:disabled {
  background: #24232C;
  color: #fff;
  cursor: not-allowed;
}
.stake-btn:not(:disabled):hover {
  opacity: 0.9;
}
/* process */
.text {
  width:245px;
  display:flex;
  flex-direction: column;
  align-items:center;
  border-top: solid 1px rgb(236, 241, 240,0.3);
  padding-top:23px;
  padding-bottom:150px;
}
.tx-title {
  color: #FFF;
  text-align: center;
  font-family: Inter;
  font-size: 16px;
  font-style: normal;
  font-weight: 600;
  line-height: 150%; /* 24px */
  letter-spacing: -0.16px;
}
.confirm {
  padding-top:12px;
  color: rgba(255, 255, 255, 0.60);
  text-align: center;
  font-family: Inter;
  font-size: 10px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 15px */
  letter-spacing: -0.1px;
}
.banner {
  position:relative;
  display: flex;
  margin-top:23px;
  padding: 13px;
  width: 100%;
  height: 180px;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  border-radius: 5.648px;
  border: 0.565px solid var(--Secondary-600, #2C2C30);
  background: var(--Secondary-700, #161618);
  box-shadow: 0 7.907px 12.425px -5.083px rgba(255, 255, 255, 0.06) inset, 0 9.036px 11.295px -3.389px rgba(0, 0, 0, 0.65);
}
.banner img {
  position: absolute;
  width: 75%;
  right: 0;
  bottom: 0;
}
.banner-title {
  font-family: Inter;
  font-size: 16px;
  font-style: normal;
  font-weight: 600;
  line-height: 150%; /* 24px */
  letter-spacing: -0.32px;
  background: var(--gold, linear-gradient(90deg, #C49A4C 30.29%, #F6D77B 69.23%, #B1822A 100%));
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.banner-desc {
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 10px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 15px */
  letter-spacing: -0.1px;
}

/* = = = = = = = = = = Mobile Adaptation (< 768px) = = = = = = = = = = = */
@media (max-width: 768px) {
  .mask {
    padding: 0 0 60px 0;
    align-items: flex-end;
    overflow-y: auto;
  }

  .modal-overlay {
    width: 100%;
    height: auto;
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal {
    width: 100%;
    max-width: 100%;
    max-height: 85vh;
    height: auto;
    overflow-y: auto;
    border-radius: 20px 20px 0 0;
    padding: 16px 16px 32px;
    gap: 16px;
  }

  .op-body {
    flex-direction: column;
    gap: 16px;
    width: 100%;
  }

  .op {
    width: 100%;
    height: auto;
  }

  .header {
    height: auto;
    margin-bottom: 8px;
  }

  .tabs {
    margin-bottom: 16px;
  }

  .text {
    width: 100%;
    padding-bottom: 40px;
  }

  .banner {
    height: auto;
    min-height: 100px;
  }
}
</style>
