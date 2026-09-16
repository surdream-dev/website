<template>
  <div class="panel">
    <div class="stake-wrapper">
      <div class="row">
        <span>Stake</span>
        <span v-if="address">
          Balance: {{ balanceLoading ? '...' : balance }} ETH
        </span>
      </div>
      <div class="input-wrapper">
        <InputBox v-model="inputAmount"/>
        <button
          :class="address && balanceWei > BigInt(0) ? 'max active' : 'max'"
          @click="handleMax"
          :disabled="!address || balanceWei <= BigInt(0)"
        >
          Max
        </button>
        <div class="token-wrapper">
          <img src="@/assets/logos/eth.svg"/>
          <span>ETH</span>
        </div>
      </div>
    </div>

    <div v-if="isBelowMinimum" class="min-amount-hint">
      Minimum stake amount is {{ MIN_STAKE_AMOUNT }} ETH
    </div>

    <div class="receive-wrapper">
      <div class="row">
        <span>Receive</span>
      </div>
      <div class="input-wrapper">
        <InputBox :modelValue="receiveAmount" readonly />
        <div class="token-wrapper">
          <img :src="outputTokenIcon"/>
          <span>{{ outputTokenSymbol }}</span>
        </div>
      </div>
    </div>

    <PrimaryBtn v-if="address" :is-loading="isSubmitting" :is-disabled="isStakeDisabled" @click="sendToParent()">Stake</PrimaryBtn>
    <PrimaryBtn v-else @click="walletStore.openConnect()">Connect Wallet</PrimaryBtn>

    <div class="info">
      <div><span>APY</span><span>{{ apy }}%</span></div>
      <div><span>TVL</span><span>{{ tvl }}</span></div>
      <div><span>Exchange rate</span><span>{{ exchangeRateDisplay }}</span></div>
      <div><span>Max trans cost</span><span>{{ maxTxCost }}</span></div>
      <div>
        <span class="info-title"><span class="tool-tips-head">Reward fee</span><Tooltips content="Please note: this fee applies to staking rewards only, and is NOT taken from your staked amount."><img src="@/assets/icons/tips.svg" /></Tooltips>
        </span>
        <span>{{ rewardFee }}</span></div>
    </div>

    <!-- Transaction Status Popup -->
    <TxStatusModal
      :visible="txModalVisible"
      :status="txStatus"
      :action="txAction"
      :txHash="txHash"
      :errorMessage="txError"
      :amount="inputAmount"
      asset="ETH"
      :newBalance="receiveAmount"
      :newAsset="outputTokenSymbol"
      @close="closeTxModal"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import InputBox from './InputBox.vue'
import PrimaryBtn from './PrimaryBtn.vue'
import Tooltips from '../tooltips.vue'
import TxStatusModal from '@/components/TxStatusModal.vue'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { stake } from "@/chain/stake"
import { toWei, calculateMaxAmount } from "@/chain/utils/decimals"
import { useBalance } from "@/composables/useBalance"
import { useTxConfirmation } from "@/composables/useTxConfirmation"
import { toast } from "@/utils/toast"
import { useTxCost, GAS } from "@/chain/core/gas"

// Use balance composable (preferential caching, fallback nodes)
const { getBalanceWei, getBalanceReadable, clearCache, loading: balanceLoading } = useBalance()

// Confirm hook with transaction
const { waitForConfirmation } = useTxConfirmation()

// Transaction Status Popup
type TxStatus = 'pending' | 'success' | 'error'
type TxAction = 'stake'
const txModalVisible = ref(false)
const txStatus = ref<TxStatus>('pending')
const txAction = ref<TxAction>('stake')
const txHash = ref<string>('')
const txError = ref<string>('')

function showTxModal(action: TxAction) {
  txAction.value = action
  txStatus.value = 'pending'
  txHash.value = ''
  txError.value = ''
  txModalVisible.value = true
}

function updateTxSuccess(hash: string) {
  txStatus.value = 'success'
  txHash.value = hash
}

function updateTxError(error: string) {
  txStatus.value = 'error'
  txError.value = error
}

function closeTxModal() {
  txModalVisible.value = false
}

const lido = stake.get("lido")!
const etherfi = stake.get("etherfi")
const meth = stake.get("meth")
const rocketpool = stake.get("rocketpool")
const stader = stake.get("stader")
const stakewise = stake.get("stakewise")
const emit = defineEmits<{
  (e: 'openProcess', value: boolean, amount?: string, asset?: string): void
}>()

// Receive dynamic data from the parent component
const props = defineProps<{
  apy?: string
  tvl?: string
  exchangeRate?: string
  rewardFee?: string
  protocol?: string       // Protocol name (lido, etherfi, etc.)
  assetAddress?: string   // Asset Contract Address
  decimals?: number       // Token precision (default 18)
  receiptTokenSymbol?: string // Output receipt token symbol (e.g. stETH, eETH)
}>()

const walletStore = useWalletStore()
const { address, isConnected } = storeToRefs(walletStore)

// Output token config per protocol
const protocolOutputConfig: Record<string, { symbol: string; icon: string }> = {
  lido: { symbol: 'stETH', icon: 'lido.svg' },
  etherfi: { symbol: 'weETH', icon: 'weeth.webp' },
  rocketpool: { symbol: 'rETH', icon: 'rocketpool.svg' },
  stakewise: { symbol: 'osETH', icon: 'stakewise.svg' },
  meth: { symbol: 'mETH', icon: 'meth.svg' },
  stader: { symbol: 'ETHx', icon: 'stader.svg' },
}

// ETH address placeholder
const ETH_PLACEHOLDER = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

// Status
const inputAmount = ref<string>('')
const receiveAmount = ref<string>('0')
const balance = ref<string>('0.00')
const balanceWei = ref<bigint>(BigInt(0))
const dynamicRate = ref<number>(1) // Dynamic exchange rate (Rocket Pool, etc.)
const isSubmitting = ref(false) // Transaction submission status

// Get output token config by protocol
const currentProtocolId = computed(() => {
  return props.protocol?.toLowerCase().replace(/[\s.]/g, '') || 'lido'
})

const outputTokenConfig = computed(() => {
  return protocolOutputConfig[currentProtocolId.value] || protocolOutputConfig.lido
})

const outputTokenSymbol = computed(() => outputTokenConfig.value.symbol)
const outputTokenIcon = computed(() => {
  // Use import.meta.glob to load icons
  const icons = import.meta.glob('@/assets/logos/*.{svg,webp}', { eager: true, import: 'default' })
  const iconFileName = outputTokenConfig.value.icon
  // Match the filename directly
  for (const [path, icon] of Object.entries(icons)) {
    if (path.endsWith(iconFileName)) {
      return icon as string
    }
  }
  // Fallback: try matching by protocol name
  const protocolName = outputTokenConfig.value.icon.replace('.svg', '')
  for (const [path, icon] of Object.entries(icons)) {
    if (path.includes(protocolName.toLowerCase())) {
      return icon as string
    }
  }
  return '' // Empty by default
})

// Default (downgrade scheme)
const apy = computed(() => props.apy || '2.60')
const tvl = computed(() => props.tvl || '3.71B')
const { txCost: maxTxCost } = useTxCost(GAS.stake)
const rewardFee = computed(() => props.rewardFee || '10%')

// Exchange rate display (all protocols take on-chain real-time exchange rate)
const exchangeRateDisplay = computed(() => {
  return `1 ETH ≈ ${dynamicRate.value.toFixed(4)} ${outputTokenSymbol.value}`
})

// ETH is the gas token
const isGasToken = true

// Get decimals (prefer the passed-in value)
async function getTokenDecimals(): Promise<number> {
  if (props.decimals !== undefined && props.decimals > 0) {
    return props.decimals
  }
  return 18 // ETH defaults to 18
}

// Get the live exchange rate (Stake: 1 ETH → X tokens, each protocol uses its native method, see adapter.getStakeRate)
async function fetchDynamicRate() {
  const adapter = stake.get(currentProtocolId.value)
  if (!adapter?.getStakeRate) {
    dynamicRate.value = 1
    return
  }
  try {
    dynamicRate.value = await adapter.getStakeRate()
  } catch (error) {
    console.warn('[Stake] Failed to fetch dynamic rate, using fallback:', error)
    dynamicRate.value = 1
  }
}

// Query ETH balance (cache first, node fallback)
async function fetchBalance() {
  if (!address.value) {
    balance.value = '0.00'
    balanceWei.value = BigInt(0)
    return
  }

  try {
    const decimals = await getTokenDecimals()
    const wei = await getBalanceWei(address.value, ETH_PLACEHOLDER)
    balanceWei.value = wei
    balance.value = Math.floor(Number(wei) / Math.pow(10, decimals) * 1e6) / 1e6
  } catch (error) {
    console.error('Failed to fetch balance:', error)
    balance.value = '0.00'
    balanceWei.value = BigInt(0)
  }
}

// Max Button Handling
async function handleMax() {
  // Balance is loading
  if (balanceLoading.value) {
    toast.show('Fetching balance, please wait...', 'warning')
    return
  }

  // Balance is 0
  if (!balanceWei.value || balanceWei.value <= BigInt(0)) {
    toast.show('No balance available', 'warning')
    return
  }

  const maxAmount = calculateMaxAmount(balanceWei.value, isGasToken)
  const decimals = await getTokenDecimals()
  // Round down
  const rawValue = Number(maxAmount) / Math.pow(10, decimals)
  inputAmount.value = Math.floor(rawValue * 1e6) / 1e6
  updateReceiveAmount(inputAmount.value)
}

// Update the Receive amount (rounded down)
function updateReceiveAmount(amount: string) {
  const inputNum = parseFloat(amount) || 0
  const rawValue = inputNum * dynamicRate.value
  receiveAmount.value = Math.floor(rawValue * 1e6) / 1e6
}

// Minimum amount validation (Rocket Pool)
const MIN_STAKE_AMOUNT = 0.01
const isBelowMinimum = computed(() => {
  if (currentProtocolId.value !== 'rocketpool') return false
  const inputNum = parseFloat(inputAmount.value) || 0
  return inputNum > 0 && inputNum < MIN_STAKE_AMOUNT
})

// Whether the button is disabled (disabled below the minimum amount)
const isStakeDisabled = computed(() => {
  return isSubmitting.value || isBelowMinimum.value
})

// Watch input changes
watch(inputAmount, (newVal) => {
  updateReceiveAmount(newVal)
})

// Watch protocol changes and re-fetch the exchange rate
watch(currentProtocolId, () => {
  fetchDynamicRate()
})

// Send the transaction
async function sendToParent() {
  if (!address.value) return

  // Prevent duplicate submission
  if (isSubmitting.value) return

  // Balance is loading
  if (balanceLoading.value) {
    toast.show('Fetching balance, please wait...', 'warning')
    return
  }

  // Input Validation
  const inputNum = parseFloat(inputAmount.value) || 0
  if (inputNum <= 0) {
    toast.show('Please enter a valid amount', 'warning')
    return
  }

  // mETH minimum amount validation: 0.02 ETH
  const protocolId = currentProtocolId.value
  if (protocolId === 'meth' && inputNum < 0.02) {
    toast.show('Minimum stake amount for mETH is 0.02 ETH', 'warning')
    return
  }

  // Get Precision and Convert
  const decimals = await getTokenDecimals()
  const amountWei = toWei(inputAmount.value, decimals)

  // Check if the balance is exceeded (ETH needs to retain Gas)
  const maxWei = calculateMaxAmount(balanceWei.value, isGasToken)
  if (amountWei > maxWei) {
    toast.show('Amount exceeds available balance', 'warning')
    return
  }

  // Start submission
  isSubmitting.value = true
  showTxModal('stake')

  try {
    // Select the contract method by protocol

    let hash: string = ''

    switch (protocolId) {
      case 'lido':
        hash = await lido.deposit(amountWei, address.value as `0x${string}`)
        break
      case 'etherfi':
        hash = await etherfi?.deposit(amountWei, address.value as `0x${string}`) || ''
        break
      case 'meth':
        hash = await meth?.deposit(amountWei, address.value as `0x${string}`) || ''
        break
      case 'rocketpool':
        hash = await rocketpool?.deposit(amountWei, address.value as `0x${string}`) || ''
        break
      case 'stader':
        hash = await stader?.deposit(amountWei, address.value as `0x${string}`) || ''
        break
      case 'stakewise':
        hash = await stakewise?.deposit(amountWei, address.value as `0x${string}`) || ''
        break
      default:
        throw new Error(`Unknown protocol: ${props.protocol}`)
    }


    // Waiting for transaction confirmation to be linked
    const result = await waitForConfirmation(hash, 45000, {
      protocolId,
      protocol: props.protocol || protocolId,
      asset: 'ETH',
      category: 'staking',
      action: 'stake',
      amount: inputAmount.value
    })

    if (result.success) {

      // Clear the balance cache and it will be retrieved again from the node the next time it is retrieved
      clearCache(address.value, ETH_PLACEHOLDER)

      // Show the success state first
      updateTxSuccess(hash)

      // Close TxStatusModal after a 1.5s delay and notify the parent
      setTimeout(() => {
        txModalVisible.value = false
        emit('openProcess', true, inputAmount.value, 'ETH')
      }, 1500)
    } else if (result.timedOut) {
      txStatus.value = 'timeout'
      txError.value = result.error || ''
    } else {
      updateTxError(result.error || 'Transaction failed on-chain')
    }
  } catch (error: any) {
    // Detect User Cancel Transaction
    const isUserRejected =
      error?.code === 4001 ||
      error?.cause?.code === 4001 ||
      error?.message?.toLowerCase().includes('user rejected') ||
      error?.message?.toLowerCase().includes('user denied') ||
      error?.message?.toLowerCase().includes('rejected by user')

    if (isUserRejected) {
      txModalVisible.value = false
      toast.show('Transaction cancelled by user', 'error')
    } else {
      console.error('[Stake] Transaction failed:', error)
      updateTxError(error?.message || 'Transaction failed')
    }
  } finally {
    // Reset submission state on success, failure, or cancel
    isSubmitting.value = false
  }
}

// Listen for address changes
watch(address, () => {
  fetchBalance()
})

onMounted(() => {
  fetchBalance()
  fetchDynamicRate()
})
</script>

<style scoped>
.panel{
    width:100%;
    margin:0 auto;
}
.stake-wrapper {
  width:100%;
  display: flex;
  height: 75px;
  padding: 4.626px 10px;
  flex-direction: column;
  justify-content: center;
  align-items: flex-end;
  flex-shrink: 0;
  align-self: stretch;
  margin-bottom:10px;
  border-radius: 4.626px;
  border: 0.771px solid var(--Secondary-600, #2C2C30);
  background: var(--Secondary-700, #161618);
}
.receive-wrapper {
  width:100%;
  display: flex;
  height: 75px;
  padding: 4.626px 10px;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  flex-shrink: 0;
  align-self: stretch;
  border-radius: 4.626px;
  border: 0.771px solid var(--Secondary-600, #2C2C30);
  background: var(--Other-BG, #1E1E20);
}
.input-wrapper {
  width:100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.token-wrapper {
  display: flex;
  align-items: center;
  gap: 4.626px;
  border-radius: 3.855px;
  background: var(--Secondary-600, #2C2C30);
  box-shadow: 0 4.626px 7.711px -2.313px rgba(0, 0, 0, 0.25);
}
.token-wrapper img{
  width:15px;
  height:15px;
}
.token-wrapper span{
  color: #FFF;
  font-family: Inter;
  font-size: 10.795px;
  font-style: normal;
  font-weight: 500;
  line-height: 150%; /* 16.193px */
  letter-spacing: -0.216px;
}
.title{font-size:24px;font-weight:700;margin-bottom:20px}
.row{
  margin-top: 5px;
  width:100%;
  display:flex;
  justify-content:space-between;
  align-items:center;
}
.row span{
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 10px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 15px */
  letter-spacing: -0.2px;
}
.max{
  color: var(--Secondary-200, #DCE4E8);
  text-align: center;
  font-family: Inter;
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
  line-height: 150%; /* 16.5px */
  letter-spacing: -0.22px;
  padding-right:7px;
}
.max.active {
  color: var(--Primary-Default, #FFDD94);
  text-align: center;
  font-family: Inter;
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
  line-height: 150%; /* 16.5px */
  letter-spacing: -0.22px;
}
.info{
  display: flex;
  margin-top:20px;
  padding: 7.711px;
  align-items: center;
  flex-direction: column;
  gap: 2px;
  align-self: stretch;
  border-radius: 6.169px;
  background: var(--Secondary-600, #2C2C30);
  box-shadow: 0 4.626px 7.711px -2.313px rgba(0, 0, 0, 0.25);
}
.info div{
  width:100%;
  display:flex;
  justify-content:space-between;
  }
.info div span {
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 18px */
  letter-spacing: -0.12px;
  gap:5px;
  display:flex;
}
.info-title {
  display: flex;
  justify-content:flex-start;
}
.tool-tips-head {
  min-width:64px;
}
.info-title span{
  
}
.info-title img {
  width:16px;
  height:16px;
}
.min-amount-hint {
  color: #FF6B6B;
  font-family: Inter;
  font-size: 11px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  letter-spacing: -0.22px;
  margin-bottom: 10px;
  padding-left: 2px;
}
</style>
