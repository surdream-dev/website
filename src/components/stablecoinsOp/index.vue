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
                  <img :src="selectedItem.icon" />
                  <div class="desc-title">
                    <div class="name">{{selectedItem.asset}}</div>
                    <div class="apy">APY:{{ currentApy === '-' ? '-' : currentApy + '%' }}</div>
                  </div>
                </div>
                <div class="timeTabs">
                  <button
                    v-for="t in timeTabs"
                    :key="t"
                    :class="{ active: activeTab === t }"
                    @click="activeTab = t"
                  >
                    {{ t }}
                  </button>
                </div>
                <div class="chart-wrapper">
                  <div class="chart-title">APY</div>
                  <div class="chart-body">
                    <div class="chart">
                      <img src="@/assets/img/lendingopline.png" />
                    </div>
                    <div class="chart-y">
                      <div class="chart-y-item">20%</div>
                      <div class="chart-y-item">15%</div>
                      <div class="chart-y-item">10%</div>
                      <div class="chart-y-item">5%</div>
                      <div class="chart-y-item">0</div>
                    </div>
                    <div class="chart-x">
                      <div class="chart-x-item">Jan 1</div>
                      <div class="chart-x-item">Feb 22</div>
                      <div class="chart-x-item">Mar 3</div>
                      <div class="chart-x-item">Apr 5</div>
                    </div>
                  </div>
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
                    <div class="title">TVL</div>
                    <div class="content">{{ tvl }}</div>
                  </div>
                  <div class="item">
                    <div class="title">Curator</div>
                    <div class="content">
                      <img v-if="selectedItem?.curator" :src="getIcon(selectedItem.curator)" />
                      <img v-else src="@/assets/logos/stablecoin.svg" />
                    </div>
                  </div>
                  <div class="item">
                    <div class="title">Collateral</div>
                    <div class="content collateral">
                      <template v-if="selectedItem?.collateral?.length > 0">
                        <img v-for="(col, i) in selectedItem.collateral" :key="i" :src="getIcon(col)" />
                      </template>
                      <template v-else>
                        <img :src="getIcon('usdc')"/>
                        <img :src="getIcon('wsteth')"/>
                      </template>
                    </div>
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
                  v-if="tab==='Deposit'"
                  :asset="selectedItem.asset"
                  :asseticon="getIcon(selectedItem.asset)"
                  :assetAddress="selectedItem.assetAddress"
                  :protocol="selectedItem.protocol"
                  :decimals="selectedItem.decimals"
                  @openProcess="handleUpdate"
                  :apy="currentApy"
                  :collateralization="collateralization"
                ></Deposit>
                <Withdraw
                  v-if="tab==='Withdraw'"
                  :asset="selectedItem.asset"
                  :asseticon="getIcon(selectedItem.asset)"
                  :assetAddress="selectedItem.assetAddress"
                  :receiptToken="selectedItem.receiptToken"
                  :receiptTokenSymbol="selectedItem.receiptTokenSymbol"
                  :approveSpender="selectedItem.approveSpender"
                  :protocol="selectedItem.protocolId || selectedItem.protocol"
                  :decimals="selectedItem.decimals"
                  :apy="currentApy"
                  :selectedItem="selectedItem"
                  @openProcess="handleUpdate"
                ></Withdraw>
                <Claim
                  v-if="tab==='Claim'"
                  :protocol="selectedItem.protocolId || selectedItem.protocol"
                  :asset="selectedItem.asset"
                  :asseticon="getIcon(selectedItem.asset)"
                  :decimals="selectedItem.decimals"
                  :selectedItem="selectedItem"
                  @openProcess="handleUpdate"
                ></Claim>
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
import Claim from './claim.vue'
import Process from '../process.vue'
import { getLendingRates } from '@/composables/useLendingApy'

// Lending protocols (use on-chain maxLtv to decide whether the asset can be collateral)
const LENDING_PROTOCOLS = ['aave', 'compound', 'morpho', 'sparklend', 'fluid']

const isProcess = ref(false)
const activeTab = ref<'1 Week'|'1 Month'|'3 Month'|'1 Year'>('1 Week')
const timeTabs: Array<typeof activeTab.value> = ['1 Week', '1 Month', '3 Month', '1 Year']

interface StableItem {
  protocol: string
  protocolId?: string
  icon: string
  tvl: string
  apy: string
  curator?: string
  collateral?: string[]
  category: string
  year: number
  asset?: string
  assetAddress?: string
  decimals?: number
  receiptToken?: string
  receiptTokenSymbol?: string
  approveSpender?: string
  metrics?: {
    apy?: number
    tvl?: number
  }
}

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
  selectedItem?: StableItem
  availableTabs?: string[]     // Available tabs
  initialTab?: string          // Initially active tab (e.g. clicking Withdraw in the list)
}>(), {
  availableTabs: () => ['Deposit'],
  initialTab: ''
})

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  stake: [{ amount: string }] // Click on Stake to throw
}>()

/* Status */
// Use externally provided tabs, defaulting to only Deposit
// Ethena has a two-step unstake flow (cooldown → claim): append the Claim tab
// so users can see pending/available USDe and claim after the cooldown ends.
const tabs = computed(() => {
  const base = props.availableTabs
  const pid = ((props.selectedItem?.protocolId || props.selectedItem?.protocol) || '').toLowerCase()
  return pid === 'ethena' && !base.includes('Claim') ? [...base, 'Claim'] : base
})
const tab = ref(props.initialTab && tabs.value.includes(props.initialTab)
  ? props.initialTab
  : tabs.value[0] || 'Deposit')
const amount = ref('')

// Reset the tab each time the modal opens: prefer initialTab (clicking Withdraw in the list opens Withdraw), otherwise the first tab
watch(() => props.modelValue, (val) => {
  if (val) tab.value = props.initialTab && tabs.value.includes(props.initialTab)
    ? props.initialTab
    : tabs.value[0] || 'Deposit'
})

// Clamp the active tab when the available tabs change (e.g. protocol switch)
watch(tabs, (val) => {
  if (!val.includes(tab.value)) {
    tab.value = props.initialTab && val.includes(props.initialTab) ? props.initialTab : val[0] || 'Deposit'
  }
})

/* COMPUTING: */
const receive = computed(() => amount.value || '0') // 1: 1 Simplification

// Read data directly from selectedItem (no more API calls)
const currentApy = computed(() => {
  const val = props.selectedItem?.metrics?.apy ?? props.selectedItem?.apy
  if (typeof val === 'number' && Number.isFinite(val)) return val.toFixed(2)
  if (typeof val === 'string' && val.trim() !== '' && val.trim() !== '-') {
    const n = parseFloat(val)
    if (Number.isFinite(n)) return n.toFixed(2)
  }
  return '-'
})
const tvl = computed(() => {
  const tvlValue = props.selectedItem?.metrics?.tvl ?? props.selectedItem?.tvl
  if (!tvlValue) return '0'
  if (typeof tvlValue === 'string') return tvlValue
  if (tvlValue >= 1e9) return `$${(tvlValue / 1e9).toFixed(2)}B`
  if (tvlValue >= 1e6) return `$${(tvlValue / 1e6).toFixed(2)}M`
  return `$${tvlValue}`
})

// Collateralization: real data (no longer inferred from whether TVL is populated).
// Lending protocols use on-chain maxLtv>0 to decide collateral eligibility; non-lending protocols (ethena etc.) have no collateral concept and show Enabled.
const collateralization = ref<'Enabled' | 'Disabled'>('Enabled')
watch(() => props.selectedItem, async (item) => {
  collateralization.value = 'Enabled'
  if (!item) return
  const pid = (item.protocolId || '').toLowerCase()
  if (LENDING_PROTOCOLS.includes(pid) && item.assetAddress) {
    try {
      const rates = await getLendingRates(pid)
      const info = rates?.get(item.assetAddress.toLowerCase())
      collateralization.value = info?.maxLtv !== undefined && info.maxLtv > 0 ? 'Enabled' : 'Disabled'
    } catch (e) {
      console.warn('[StablecoinsOp] collateralization 获取失败:', e)
    }
  }
}, { immediate: true })

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
  min-height: 620px;
  padding: 30px 30px 47px;
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
  transform: translateY(-35px);
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
.timeTabs { display: flex; gap: 8px; padding:23px 0 0px;}
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
  height:332px;
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
  width:100%;
  display: flex;
  justify-content: space-between;
  margin-top:30px;
}
.desc-table .item {
  display: flex;
  flex-direction: column;
  gap: 17px;
}
.desc-table .item .title {
  color: var(--Text-10, #9E9E9E);
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
