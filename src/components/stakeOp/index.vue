<template>
  <!-- Mask -->
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modelValue" class="mask" @click.self="close">
        <!-- pop-up window -->
        <div class="modal-overlay">
          <div class="modal">
            <div v-if="!isProcess" class="op">
              <!-- Heading -->
              <header class="header">
                <div class="title-row">
                  <img
                    v-if="selectedItem?.icon || selectedItem?.protocolId"
                    :src="selectedItem.icon || getIcon(selectedItem.protocolId || selectedItem.protocol)"
                    alt="Lido"
                    class="logo"
                  />
                  <span class="title">{{selectedItem?.protocol}}</span>
                </div>
                <button class="close" @click="close"><img src="@/assets/icons/close-circle.png" /></button>
              </header>

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
              <div class="op-body">
                <Stake
                  v-if="tab==='Stake'"
                  @openProcess="handleStakeProcess"
                  :apy="basicApy"
                  :tvl="tvl"
                  :exchangeRate="unstakePeriod"
                  :rewardFee="stats.fee"
                  :protocol="selectedItem?.protocolId || selectedItem?.protocol"
                  :assetAddress="selectedItem?.assetAddress"
                  :decimals="selectedItem?.decimals"
                  :receiptTokenSymbol="selectedItem?.receiptTokenSymbol"
                ></Stake>
                <Unstake
                  v-if="tab==='Unstake'"
                  :protocol="selectedItem?.protocolId || selectedItem?.protocol"
                  :receiptToken="selectedItem?.receiptToken"
                  :receiptTokenSymbol="selectedItem?.receiptTokenSymbol"
                  :unstakePeriod="selectedItem?.unstake?.period || selectedItem?.unstakePeriod"
                  @openProcess="handleUnstakeProcess"
                ></Unstake>
                <Withdraw
                  v-if="tab==='Withdraw' && !isEtherFi"
                  :protocol="selectedItem?.protocolId || selectedItem?.protocol"
                  @openProcess="handleWithdrawProcess"
                ></Withdraw>
                <Boost v-if="tab==='Boost'"></Boost>
                <Wrap v-if="tab==='Wrap'"></Wrap>
                <Claim v-if="tab==='Claim'"></Claim>
              </div>
            </div>
            <div v-else class="op">
              <!-- Heading -->
              <header class="header">
                <button class="close" @click="close"><img src="@/assets/icons/close.svg" /></button>
              </header>
              <Process></Process>
              <div class="text">
                <!-- Dynamically display the operation type and amount -->
                <div class="tx-title">{{ processTitle }}</div>
                <div class="confirm">{{ processStatus }}</div>
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
import Stake from './stake.vue'
import Unstake from './unstake.vue'
import Withdraw from './withdraw.vue'
import Boost from './boost.vue'
import Wrap from './wrap.vue'
import Claim from './claim.vue'
import Process from '../process.vue'

const isProcess = ref(false)
const processAmount = ref('0')
const processAction = ref<'stake' | 'unstake' | 'withdraw' | 'boost' | 'wrap' | 'claim'>('stake')
const processAsset = ref('ETH')
const processStatus = ref('Please confirm this transaction in your wallet')
const txSuccess = ref(false)

// Dynamic title
const processTitle = computed(() => {
  const actionText = processAction.value === 'stake' ? 'Staking' :
                     processAction.value === 'unstake' ? 'Unstaking' :
                     processAction.value
  return `You're ${actionText} ${processAmount.value} ${processAsset.value}`
})

// Stake operation handler
function handleStakeProcess(success: boolean, amount?: string, asset?: string) {
  txSuccess.value = success
  processAmount.value = amount || '0'
  processAsset.value = asset || 'ETH'
  processAction.value = 'stake'

  if (success) {
    // Refresh data on the notification list page when the transaction is completed
    emit('stake', { amount: processAmount.value })
  } else {
    // Pending status
    processStatus.value = 'Please confirm this transaction in your wallet'
    isProcess.value = true
  }
}

// Unstake operation handler
function handleUnstakeProcess(success: boolean, amount?: string, asset?: string) {
  txSuccess.value = success
  processAmount.value = amount || '0'
  processAsset.value = asset || selectedItem?.receiptTokenSymbol || 'stETH'
  processAction.value = 'unstake'

  if (success) {
    emit('stake', { amount: '' })
  } else {
    processStatus.value = 'Please confirm this transaction in your wallet'
    isProcess.value = true
  }
}
// Withdraw operation handler
function handleWithdrawProcess(success: boolean, amount?: string, asset?: string) {
  txSuccess.value = success
  processAmount.value = amount || '0'
  processAsset.value = asset || 'ETH'
  processAction.value = 'withdraw'

  if (success) {
    emit('stake', { amount: '' })
  } else {
    processStatus.value = 'Please confirm this transaction in your wallet'
    isProcess.value = true
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
interface StakingItem {
  protocol: string
  protocolId: string       // Protocol ID (used to call contracts)
  icon: string
  tvl: string
  basicApy: string
  boostApy: string
  totalApy: string
  unstake: string
  year: number
  assetAddress?: string    // Asset Contract Address
  decimals?: number        // Token Accuracy
  receiptToken?: string    // Token address (e.g. stETH, rETH)
  receiptTokenSymbol?: string // Voucher token symbol
  unstakePeriod?: string   // unstake wait time
  metrics?: {
    apy?: {
      base?: number
      boost?: number
      total?: number
    }
    tvl?: number
  }
  unstake?: {
    period?: string
  }
}
/* Interface */
const props = withDefaults(defineProps<{
  modelValue: boolean          // v-model show/hide
  balance?: string             // Account ETH Balance
  protocol?: string             // Protocol name
  selectedItem?: StakingItem             // Protocol name
  availableTabs?: string[]     // Available tabs
  initialTab?: string          // Initially active tab (e.g. clicking Unstake/Withdraw in the list)
}>(), {
  availableTabs: () => ['Stake'],
  initialTab: ''
})

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  stake: [{ amount: string }] // Click on Stake to throw
}>()

/* Status */
// ether.fi: the Withdraw module is hidden (unstake credits automatically when mature; no manual claim needed)
const isEtherFi = computed(() => {
  const pid = (props.selectedItem?.protocolId || props.protocol || '').toLowerCase().replace(/[\s.]/g, '')
  return pid === 'etherfi'
})

// Use externally provided tabs, defaulting to only Stake; ether.fi filters out Withdraw
const tabs = computed(() =>
  isEtherFi.value
    ? props.availableTabs.filter(t => t.toLowerCase() !== 'withdraw')
    : props.availableTabs
)
const tab = ref(props.initialTab && tabs.value.includes(props.initialTab)
  ? props.initialTab
  : tabs.value[0] || 'Stake')
const amount = ref('')

// Reset the tab each time the modal opens: prefer initialTab (the list action opens its tab), otherwise the first tab
watch(() => props.modelValue, (val) => {
  if (val) {
    tab.value = props.initialTab && tabs.value.includes(props.initialTab)
      ? props.initialTab
      : tabs.value[0] || 'Stake'
  }
})

/* COMPUTING: */
const receive = computed(() => amount.value || '0') // 1: 1 Simplification

// Read data directly from selectedItem (no more API calls)
// Note: use Number.isFinite instead of typeof === 'number' to avoid the parseFloat(undefined)/parseFloat('-')
// NaN passing a typeof check then toFixed(2) rendering as "NaN" (same pattern as stablecoinsOp currentApy)
const basicApy = computed(() => {
  const val = props.selectedItem?.metrics?.apy?.base ?? parseFloat(props.selectedItem?.basicApy)
  return Number.isFinite(val) ? val.toFixed(2) : (props.selectedItem?.basicApy || '0.00')
})
const boostApy = computed(() => {
  const val = props.selectedItem?.metrics?.apy?.boost ?? parseFloat(props.selectedItem?.boostApy)
  return Number.isFinite(val) ? val.toFixed(2) : (props.selectedItem?.boostApy || '0.00')
})
const totalApy = computed(() => {
  const val = props.selectedItem?.metrics?.apy?.total ?? parseFloat(props.selectedItem?.totalApy)
  return Number.isFinite(val) ? val.toFixed(2) : (props.selectedItem?.totalApy || basicApy.value)
})
const tvl = computed(() => {
  // Prefer metrics.tvl (numeric, ETH amount); fall back to the already formatted page string when 0/undefined
  const tvlValue = props.selectedItem?.metrics?.tvl || props.selectedItem?.tvl
  if (!tvlValue) return '0'
  if (typeof tvlValue === 'string') return tvlValue
  // TVL is an ETH amount: thousands separators + 3 decimals + "ETH" suffix
  return tvlValue.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' ETH'
})
const unstakePeriod = computed(() => props.selectedItem?.unstake?.period || props.selectedItem?.unstake || '—')

const stats = {
  apy: '2.60%',
  tvl: '3.71B',
  rate: '1 ETH = 1 StETH',
  cost: '$0.09',
  fee: '10%'
}

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

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #ACB5BB;
  font-size: 18px;
}

.modal {
  display: flex;
  width: 415px;
  height: auto;
  padding: 20px 30px;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  border-radius: 30px;
  border: 0.771px solid var(--Secondary-500, #44444A);
  background: var(--Other-BG, #1E1E20);
  box-shadow: 21.118px 38.012px 63.354px -6.335px rgba(0, 0, 0, 0.75);
}
.op {
  width:100%;
  height:100%;
  display: flex;
  flex-direction: column;
  align-items: center;
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
.op-body {
  width:100%;
  display: flex;
  flex-direction: row;
  gap:27px;
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
  height: 32px;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  align-self: stretch;
  margin-top:16px;
  margin-bottom:16px;
  border-radius: 8px;
  background: var(--Fill-Colors-Light-Tertiary, rgba(118, 118, 128, 0.12));
  box-shadow: 0 4px 4px 0 rgba(0, 0, 0, 0.25);
}
.tab {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  flex: 1 0 0;
  align-self: stretch;
  color: var(--Secondary-400, #6C7278);
  text-align: center;
  font-feature-settings: 'liga' off, 'clig' off;
  font-family: Inter;
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
  line-height: 20px; /* 181.818% */
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
  background: var(--gold, linear-gradient(90deg, #C49A4C 30.29%, #F6D77B 69.23%, #B1822A 100%));
  color: #FFF;
  text-align: center;
  font-feature-settings: 'liga' off, 'clig' off;
  font-family: Inter;
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
  line-height: 20px; /* 181.818% */
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
    overflow-y: auto;
    border-radius: 20px 20px 0 0;
    padding: 16px 16px 32px;
    gap: 16px;
  }

  .op {
    height: auto;
    min-height: auto;
  }

  .op-body {
    flex-direction: column;
    gap: 16px;
    width: 100%;
  }

  .tabs {
    margin-top: 12px;
    margin-bottom: 12px;
  }

  .input-box input {
    font-size: 18px;
  }

  .stats li {
    font-size: 12px;
  }

  .stake-btn {
    padding: 12px;
    font-size: 14px;
  }

  .text {
    width: 100%;
    padding-bottom: 40px;
  }

  .tx-title {
    font-size: 14px;
  }

  .confirm {
    font-size: 12px;
  }
}
</style>
