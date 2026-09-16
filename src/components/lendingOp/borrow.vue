<template>
  <div class="panel">
    <div class="stake-wrapper">
      <div class="row">
        <span>Available to borrow</span>
        <span v-if="address">
          Borrowable: {{ balanceLoading ? '...' : balance }} {{ asset }}
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
          <img :src="asseticon"/>
          <span>{{asset}}</span>
        </div>
      </div>
    </div>

    <div v-if="health.hint" :class="['health-hint', health.hint.level]">
      {{ health.hint.message }}
    </div>

    <div v-if="minBorrowHint" :class="['health-hint', minBorrowHint.level]">
      {{ minBorrowHint.message }}
    </div>

    <PrimaryBtn
      v-if="address"
      :is-loading="isApproving || isBorrowing"
      :is-disabled="isApproving || isBorrowing || health.isBlocked || minBorrowBlocked"
      @click="handleAction()"
    >
      {{ isApproving ? 'Approving...' : isBorrowing ? 'Borrowing...' : buttonLabel }}
    </PrimaryBtn>
    <PrimaryBtn v-else @click="walletStore.openConnect()">Connect Wallet</PrimaryBtn>

    <div class="info">
      <div class="hf-row">
        <span class="hf-title">Health Factor{{ health.isAccountLevel ? ' · ' + health.scope : '' }}</span>
        <span :class="['hf-value', health.riskLevel]">{{ health.hfText }}</span>
      </div>
      <div><span>Borrow APY</span><span>{{ currentBorrowApy === '-' ? '-' : currentBorrowApy + '%' }}</span></div>
      <div><span>Trans cost</span><span>{{ currentTxCost }}</span></div>
    </div>

    <!-- Transaction Status Popup -->
    <TxStatusModal
      :visible="txModalVisible"
      :status="txStatus"
      :action="txAction"
      :txHash="txHash"
      :errorMessage="txError"
      :amount="inputAmount"
      :asset="asset"
      @close="closeTxModal"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import InputBox from './InputBox.vue'
import PrimaryBtn from './PrimaryBtn.vue'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { lending } from "@/chain/lending"
import { toWei, calculateMaxAmount } from "@/chain/utils/decimals"
import { useApprove, getSpenderAddress } from "@/chain/utils/approve"
import { setMorphoPool } from "@/chain/lending/morpho"
import { getBackendPoolId } from '@/constants/protocols'
import { setFluidPool } from "@/chain/lending/fluid"
import { toast } from "@/utils/toast"
import TxStatusModal from '@/components/TxStatusModal.vue'
import { useBalance } from "@/composables/useBalance"
import { useTxConfirmation } from "@/composables/useTxConfirmation"
import { useTxCost, GAS, APPROVE_GAS } from "@/chain/core/gas"
import { getLendingPrices, getPriceByAddress } from '@/composables/useLendingPrices'
import { useLendingHealth } from '@/composables/useLendingHealth'

// Use balance composable (preferential caching, fallback nodes)
const { getBalanceWei, getTokenDecimals: fetchTokenDecimals, clearCache, loading: balanceLoading } = useBalance()

// Confirm hook with transaction
const { waitForConfirmation } = useTxConfirmation()

// Transaction Status Type
type TxStatus = 'pending' | 'success' | 'error'
type TxAction = 'approve' | 'borrow'

// Protocol Adapter
const aave = lending.get("aave")
const compound = lending.get("compound")
const morpho = lending.get("morpho")
const sparklend = lending.get("sparklend")
const fluid = lending.get("fluid")

const emit = defineEmits<{
  (e: 'openProcess', value: boolean): void
}>()

const props = defineProps<{
  asset?: string             // Asset name (e.g. "ETH", "USDC")
  asseticon?: string
  assetAddress?: string      // Asset Contract Address
  protocol?: string          // Protocol ID (aave, compound, sparklend, etc.)
  poolId?: string            // Pool ID (Flattened primary key)
  decimals?: number          // Token precision (default 18)
  borrowApy?: string         // Loan APY
  balance?: string           // Borrowable amount (incoming from parent component)
}>()

const protocolId = computed(() => props.protocol?.toLowerCase().replace(/[\s.]/g, '') || '')

const walletStore = useWalletStore()
const { address, isConnected } = storeToRefs(walletStore)

// Status
const inputAmount = ref<string>('')
const balance = ref<string>('0.00')
const balanceWei = ref<bigint>(BigInt(0))
// Protocol minimum borrow (human units) enforced on-chain, e.g. Compound baseBorrowMin (USDC/USDT 100, WETH 0.1)
const minBorrow = ref<number | undefined>(undefined)

// Use generic approve hook
const { isApproving, needsApprove, approve: approveToken, checkAllowance: checkAllowanceStatus } = useApprove()

// Borrowing Status
const isBorrowing = ref(false)

// Input anti-shake timer
let approveDebounceTimer: ReturnType<typeof setTimeout> | null = null

function debouncedCheckApproval() {
  if (approveDebounceTimer) clearTimeout(approveDebounceTimer)
  approveDebounceTimer = setTimeout(() => {
    checkApprovalStatus()
  }, 300)
}

onUnmounted(() => {
  if (approveDebounceTimer) clearTimeout(approveDebounceTimer)
})

// Transaction Status Popup
const txModalVisible = ref(false)
const txStatus = ref<TxStatus>('pending')
const txAction = ref<TxAction>('borrow')
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

// Determine if it is a Gas Token (ETH)
const isGasToken = computed(() => {
  return props.asset?.toUpperCase() === 'ETH' ||
         props.assetAddress?.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
})

// Default (downgrade scheme)
const currentBorrowApy = computed(() => props.borrowApy || '-')
const { txCost: currentTxCost } = useTxCost(APPROVE_GAS + GAS.borrow)

const health = useLendingHealth({
  account: () => address.value || '',
  protocol: () => protocolId.value,
  poolId: () => props.poolId,
  assetAddress: () => props.assetAddress,
  action: 'borrow',
  amount: inputAmount,
})

// Button Label
const buttonLabel = computed(() => {
  return needsApprove.value ? 'Approve' : 'Borrow'
})

// Query the borrowable amount (the maximum borrowable amount of the user's individual can be queried from the agreement chain first)
async function fetchBalance() {
  if (!address.value || !props.assetAddress) {
    balance.value = '0.00'
    balanceWei.value = BigInt(0)
    return
  }

  // 1. Query the user's personal maximum debit (collateral based) from the protocol adapter
  if (address.value && props.protocol) {
    const adapter = lending.getByPool(props.poolId || props.protocol?.toLowerCase() || '')
    if (adapter?.getAvailableBorrows) {
      try {
        // Set pool context (Morpho/Fluid needs to filter borrowable limits by pool to avoid cross-pool aggregation)
        if (protocolId.value === 'morpho') setMorphoPool(props.poolId || '')
        if (protocolId.value === 'fluid') setFluidPool(props.poolId || '')
        // Compound: Only check the comet corresponding to the current asset to avoid traversing all
        const isCompound = protocolId.value === 'compound'
        const availableWei = await adapter.getAvailableBorrows(address.value as `0x${string}`, isCompound ? props.assetAddress : undefined)
        if (availableWei > BigInt(0)) {
          const prices = await getLendingPrices()
          const priceFromFeed = getPriceByAddress(prices, props.assetAddress)
          // Default $1 when stablecoin price fetch fails
          const isStable = props.asset === 'USDC' || props.asset === 'USDT' || props.asset === 'DAI'
          const usdPrice = priceFromFeed > 0 ? priceFromFeed : (isStable ? 1 : 0)

          if (usdPrice > 0) {
            // availableBorrowsBase = USD value × 100 (2-digit extra precision)
            const availableUSD = Number(availableWei) / 100
            const availableAsset = availableUSD / usdPrice
            const decimals = await getTokenDecimals()

            balance.value = availableAsset.toFixed(Math.min(decimals, 6))
            balanceWei.value = toWei(balance.value, decimals)
            return
          }
        }
      } catch (e) {
        console.warn('[Lending Borrow] Failed to fetch available borrows from protocol:', e)
      }
    }
  }

  // 2. Demote: Pool available liquidity using parent component (non-user personal borrowable)
  // Compatible with formats such as "$1,234.56"; $ prefixed as USD amount, converted to asset quantity at current price
  const rawBalance = String(props.balance || '').replace(/[$,\s]/g, '')
  const parsedBalance = parseFloat(rawBalance)
  if (parsedBalance > 0) {
    let assetAmount = parsedBalance
    if (String(props.balance).includes('$')) {
      const prices = await getLendingPrices()
      const priceFromFeed = getPriceByAddress(prices, props.assetAddress)
      const isStable = props.asset === 'USDC' || props.asset === 'USDT' || props.asset === 'DAI'
      const usdPrice = priceFromFeed > 0 ? priceFromFeed : (isStable ? 1 : 0)
      if (usdPrice > 0) assetAmount = parsedBalance / usdPrice
    }
    const decimals = await getTokenDecimals()
    balance.value = assetAmount.toFixed(Math.min(decimals, 6))
    balanceWei.value = toWei(balance.value, decimals)
    return
  }

  // 3. No debit limit data
  balance.value = '0.00'
  balanceWei.value = BigInt(0)
}

// Fetch the protocol minimum borrow (e.g. Compound baseBorrowMin) so the button can reject amounts below it
async function fetchMinBorrow() {
  minBorrow.value = undefined
  if (protocolId.value !== 'compound') return
  try {
    const adapter = lending.getByPool(props.poolId || props.protocol?.toLowerCase() || '')
    minBorrow.value = await adapter?.getMinimumBorrow?.(props.poolId, props.assetAddress)
  } catch (e) {
    console.warn('[Lending Borrow] Failed to fetch minimum borrow:', e)
  }
}

// Minimum borrow validation: block the button and show an inline hint below the input when below the on-chain minimum
const minBorrowBlocked = computed(() => {
  const amt = parseFloat(inputAmount.value) || 0
  return typeof minBorrow.value === 'number' && minBorrow.value > 0 && amt > 0 && amt < minBorrow.value
})
const minBorrowHint = computed(() => {
  if (!minBorrowBlocked.value || typeof minBorrow.value !== 'number') return null
  return { level: 'blocked', message: `Minimum borrow amount is ${minBorrow.value} ${props.asset}.` }
})

// Fetch Token Precision (use pass-through first, then fetch from cache/node)
async function getTokenDecimals(): Promise<number> {
  if (props.decimals !== undefined && props.decimals > 0) {
    return props.decimals
  }

  if (props.assetAddress) {
    return await fetchTokenDecimals(props.assetAddress)
  }

  return 18
}

// Max Button Processing: Fill 95% of Maximum Secured Borrowing Amount
async function handleMax() {
  if (balanceLoading.value) {
    toast.show('Fetching balance, please wait...', 'warning')
    return
  }

  if (!balanceWei.value || balanceWei.value <= BigInt(0)) {
    toast.show('No balance available', 'warning')
    return
  }

  // 95% of max borrowable (safety buffer)
  const maxAmount = balanceWei.value * 95n / 100n

  const decimals = await getTokenDecimals()
  const rawValue = Number(maxAmount) / Math.pow(10, decimals)
  inputAmount.value = Math.floor(rawValue * 1e6) / 1e6
}

// Execute approve (wrapper function)
async function handleApprove() {
  if (!address.value) return

  const protocolId = props.protocol?.toLowerCase() || ''

  showTxModal('approve')

  try {
    const decimals = props.decimals || 18
    const amountWei = toWei(inputAmount.value, decimals)


    const spenderAddress = getSpenderAddress(protocolId, 'lending', props.assetAddress)
    if (!spenderAddress) {
      throw new Error(`No spender address for protocol: ${protocolId}`)
    }

    await approveToken(props.assetAddress || '', spenderAddress, amountWei, address.value as `0x${string}`)

    // After Approve is successful, switch directly to the borrow state (without closing the pop-up)
    needsApprove.value = false
    txStatus.value = 'pending'
    txAction.value = 'borrow'
    txHash.value = ''
    txError.value = ''

    // Automatically call borrow
    await handleBorrow()
  } catch (error: any) {
    txModalVisible.value = false

    const isUserRejected =
      error?.code === 4001 ||
      error?.cause?.code === 4001 ||
      error?.message?.toLowerCase().includes('user rejected') ||
      error?.message?.toLowerCase().includes('user denied')

    if (isUserRejected) {
      toast.show('Approval cancelled by user', 'error')
    } else {
      console.error('[Lending Borrow] Approve failed:', error)
      toast.show('Approval failed: ' + (error?.message || 'Unknown error'), 'error')
    }
  }
}

// Process button click
async function handleAction() {
  try {
    if (balanceLoading.value) {
      toast.show('Fetching balance, please wait...', 'warning')
      return
    }

    const inputNum = parseFloat(inputAmount.value) || 0
    if (inputNum <= 0) {
      toast.show('Please enter a valid amount', 'warning')
      return
    }

    // Protocol minimum borrow enforced on-chain (e.g. Compound baseBorrowMin: USDC/USDT 100, WETH 0.1)
    if (typeof minBorrow.value === 'number' && minBorrow.value > 0 && inputNum < minBorrow.value) {
      toast.show(`Minimum borrow amount is ${minBorrow.value} ${props.asset}`, 'warning')
      return
    }

    const decimals = await getTokenDecimals()
    const amountWei = toWei(inputAmount.value, decimals)

    if (amountWei > balanceWei.value) {
      toast.show('Amount exceeds available borrowable', 'warning')
      return
    }

    if (needsApprove.value && !isGasToken.value) {
      await handleApprove()
    } else {
      await handleBorrow()
    }
  } catch (error: any) {
    const isUserRejected =
      error?.code === 4001 ||
      error?.cause?.code === 4001 ||
      error?.message?.toLowerCase().includes('user rejected') ||
      error?.message?.toLowerCase().includes('user denied')

    if (isUserRejected) {
      txModalVisible.value = false
      toast.show('Transaction cancelled by user', 'error')
    } else {
      console.error('[Lending Borrow] Transaction error:', error)
      updateTxError(error?.message || 'Transaction failed')
    }
  }
}

// Send Loan Transaction
async function handleBorrow() {
  if (!address.value || !props.assetAddress) {
    throw new Error("Wallet not connected or asset address missing")
  }

  isBorrowing.value = true

  if (!txModalVisible.value) {
    showTxModal('borrow')
  } else {
    txAction.value = 'borrow'
    txStatus.value = 'pending'
    txHash.value = ''
    txError.value = ''
  }

  try {
    const decimals = await getTokenDecimals()
    const amountWei = toWei(inputAmount.value, decimals)

    const protocolId = props.protocol?.toLowerCase()


    let hash: string = ''

    switch (protocolId) {
      case 'aave':
        hash = await aave?.borrow(props.assetAddress, amountWei, address.value as `0x${string}`) || ''
        break
      case 'compound':
        hash = await compound?.borrow(props.assetAddress, amountWei, address.value as `0x${string}`) || ''
        break
      case 'sparklend':
        hash = await sparklend?.borrow(props.assetAddress, amountWei, address.value as `0x${string}`) || ''
        break
      case 'morpho':
        setMorphoPool(props.poolId || '')
        hash = await morpho?.borrow(props.assetAddress, amountWei, address.value as `0x${string}`) || ''
        break
      case 'fluid':
        hash = await fluid?.borrow(props.assetAddress, amountWei, address.value as `0x${string}`) || ''
        break
      default:
        hash = await aave?.borrow(props.assetAddress, amountWei, address.value as `0x${string}`) || ''
    }


    const result = await waitForConfirmation(hash, 45000, {
      protocolId: props.protocol?.toLowerCase() || '',
      protocol: props.protocol || '',
      poolId: getBackendPoolId(props.poolId || '', props.protocol || ''),
      asset: props.asset || '',
      category: 'lending',
      action: 'borrow',
      amount: inputAmount.value
    })

    if (result.success) {
      clearCache(address.value, props.assetAddress)
      updateTxSuccess(hash)
      emit('openProcess', true)
    } else if (result.timedOut) {
      txStatus.value = 'timeout'
      txError.value = result.error || ''
    } else {
      updateTxError(result.error || 'Transaction failed on-chain')
    }
  } finally {
    isBorrowing.value = false
  }
}

// Check authorization status (most protocols borrow do not require approve)
async function checkApprovalStatus() {
  if (!address.value || !props.assetAddress || isGasToken.value) {
    needsApprove.value = false
    return
  }

  const protocolId = props.protocol?.toLowerCase() || ''

  // Aave borrow: Direct call to Pool.borrow, no approve required
  if (protocolId === 'aave') {
    needsApprove.value = false
    return
  }

  // Compound borrow: directly call Comet.borrow/cToken.borrow, no need to approve
  if (protocolId === 'compound') {
    needsApprove.value = false
    return
  }

  // SparkLend borrow: Direct call to Pool.borrow, no approve required
  if (protocolId === 'sparklend') {
    needsApprove.value = false
    return
  }

  // Morpho borrow: Morpho Blue uses on-chain mortgages and does not require approve
  if (protocolId === 'morpho') {
    needsApprove.value = false
    return
  }

  // Fluid borrow: Vault sends debt assets directly, no approve required
  if (protocolId === 'fluid') {
    needsApprove.value = false
    return
  }

  const spenderAddress = getSpenderAddress(protocolId, 'lending', props.assetAddress)
  if (!spenderAddress) {
    needsApprove.value = false
    return
  }

  const decimals = props.decimals || 18
  const amountWei = toWei(inputAmount.value || '0', decimals)

  await checkAllowanceStatus(props.assetAddress, address.value as `0x${string}`, spenderAddress, amountWei)
}

// Listen for address changes
watch(address, () => {
  fetchBalance()
  checkApprovalStatus()
})

// Listen for asset changes
watch(() => props.assetAddress, () => {
  fetchBalance()
  fetchMinBorrow()
  checkApprovalStatus()
})

// Re-fetch when the parent passes an `available` balance after mount (e.g. the
// Lending main page pre-computes Fluid/Morpho borrowable in the background so
// the modal opens instantly). Without this, a late props.balance would be missed
// and the borrowable would stay at 0.
watch(() => props.balance, (v) => {
  if (v) fetchBalance()
})

// Changes in the amount of monitored input (anti-shake)
watch(inputAmount, () => {
  debouncedCheckApproval()
})

onMounted(() => {
  fetchBalance()
  fetchMinBorrow()
  checkApprovalStatus()
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
  line-height: 150%;
  letter-spacing: -0.216px;
}
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
  line-height: 150%;
  letter-spacing: -0.2px;
}
.max{
  color: var(--Secondary-200, #DCE4E8);
  text-align: center;
  font-family: Inter;
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
  line-height: 150%;
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
  line-height: 150%;
  letter-spacing: -0.22px;
}
.info{
  display: flex;
  margin-top:25px;
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
  justify-content:space-between
}
.info div span {
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  letter-spacing: -0.12px;
}
.hf-title{
  color: var(--Secondary-300, #ACB5BB);
}
.hf-value.safe{color:#4ADE80;font-weight:600}
.hf-value.warning{color:#FBBF24;font-weight:600}
.hf-value.danger{color:#F87171;font-weight:600}
.hf-value.blocked{color:#EF4444;font-weight:700}
.health-hint{
  width:100%;
  box-sizing:border-box;
  margin-bottom:10px;
  padding:8px 10px;
  border-radius:6px;
  font-family:Inter,sans-serif;
  font-size:12px;
  line-height:150%;
  letter-spacing:-0.12px;
}
.health-hint.warning{
  color:#FBBF24;
  background:rgba(251,191,36,0.12);
  border:1px solid rgba(251,191,36,0.35);
}
.health-hint.danger{
  color:#F87171;
  background:rgba(248,113,113,0.12);
  border:1px solid rgba(248,113,113,0.35);
}
.health-hint.blocked{
  color:#EF4444;
  background:rgba(239,68,68,0.16);
  border:1px solid rgba(239,68,68,0.5);
}
</style>
