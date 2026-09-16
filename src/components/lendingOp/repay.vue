<template>
  <div class="panel">
    <div class="stake-wrapper">
      <div class="row">
        <span>Borrowed: {{ borrowedLoading ? '...' : borrowedDisplay }} {{ asset }}</span>
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
      <div class="row">
        <span>Balance</span>
        <span v-if="address">{{ balanceLoading ? '...' : balance }} {{ asset }}</span>
      </div>
    </div>

    <div v-if="health.hint" :class="['health-hint', health.hint.level]">
      {{ health.hint.message }}
    </div>

    <PrimaryBtn
      v-if="address"
      :is-loading="isApproving || isRepaying"
      :is-disabled="isApproving || isRepaying || health.isBlocked"
      @click="handleAction()"
    >
      {{ isApproving ? 'Approving...' : isRepaying ? 'Repaying...' : buttonLabel }}
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
import { toast } from "@/utils/toast"
import TxStatusModal from '@/components/TxStatusModal.vue'
import { useBalance } from "@/composables/useBalance"
import { useTxConfirmation } from "@/composables/useTxConfirmation"
import { publicClient } from "@/chain/core/provider"
import { useTxCost, GAS, APPROVE_GAS } from "@/chain/core/gas"
import { fetchLendingBorrowedBalance } from '@/composables/useLendingItem'
import { useLendingHealth } from '@/composables/useLendingHealth'

// Use balance composable (preferential caching, fallback nodes)
const { getBalanceWei, getTokenDecimals: fetchTokenDecimals, clearCache, loading: balanceLoading } = useBalance()

// Confirm hook with transaction
const { waitForConfirmation } = useTxConfirmation()

// Transaction Status Type
type TxStatus = 'pending' | 'success' | 'error'
type TxAction = 'approve' | 'repay'

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
  protocol?: string          // Protocol ID (aave, compound, etc.)
  poolId?: string            // Pool ID (Flattened primary key)
  decimals?: number          // Token precision (default 18)
  borrowApy?: string         // Loan APY
  borrowedBalance?: string   // Outstanding borrow amount (passed from parent)
  receiptToken?: string      // Receipt token address
}>()

const walletStore = useWalletStore()
const { address, isConnected } = storeToRefs(walletStore)

// Status
const inputAmount = ref<string>('')
const balance = ref<string>('0.00')
const balanceWei = ref<bigint>(BigInt(0))

// Outstanding borrow amount (live on-chain query first, props.borrowedBalance fallback)
const borrowedWei = ref<bigint>(BigInt(0))
const borrowed = ref<string>('0')
const borrowedLoading = ref(false)
const borrowedDisplay = computed(() => {
  if (borrowedWei.value > 0n) return borrowed.value
  return props.borrowedBalance || '0'
})

// Use generic approve hook
const { isApproving, needsApprove, approve: approveToken, checkAllowance: checkAllowanceStatus } = useApprove()

// Repay status
const isRepaying = ref(false)

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
const txAction = ref<TxAction>('repay')
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

// Query outstanding borrow from chain (unified across all entry points, no longer relying on props)
async function fetchBorrowed() {
  if (!address.value || !props.assetAddress) {
    borrowedWei.value = BigInt(0)
    borrowed.value = '0'
    return
  }
  borrowedLoading.value = true
  try {
    const wei = await fetchLendingBorrowedBalance({
      account: address.value,
      poolId: props.poolId,
      protocolId: props.protocol,
      assetAddress: props.assetAddress
    })
    borrowedWei.value = wei
    if (wei > 0n) {
      const decimals = await getTokenDecimals()
      borrowed.value = Math.floor(Number(wei) / 10 ** decimals * 1e6) / 1e6 + ''
    } else {
      borrowed.value = '0'
    }
  } catch (e) {
    console.warn('[Lending Repay] fetchBorrowed failed:', e)
    borrowedWei.value = BigInt(0)
    borrowed.value = '0'
  } finally {
    borrowedLoading.value = false
  }
}

// Determine if it is a Gas Token (ETH)
const isGasToken = computed(() => {
  return props.asset?.toUpperCase() === 'ETH' ||
         props.assetAddress?.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
})

// Default (downgrade scheme)
const currentBorrowApy = computed(() => props.borrowApy || '-')
const { txCost: currentTxCost } = useTxCost(APPROVE_GAS + GAS.repay)

const protocolId = computed(() => props.protocol?.toLowerCase().replace(/[\s.]/g, '') || '')
const health = useLendingHealth({
  account: () => address.value || '',
  protocol: () => protocolId.value,
  poolId: () => props.poolId,
  assetAddress: () => props.assetAddress,
  action: 'repay',
  amount: inputAmount,
})

// Button Label
const buttonLabel = computed(() => {
  return needsApprove.value ? 'Approve' : 'Repay'
})

// Query balance (asset balance in the user's wallet, used for repayment)
async function fetchBalance() {
  if (!address.value || !props.assetAddress) {
    balance.value = '0.00'
    balanceWei.value = BigInt(0)
    return
  }

  try {
    const decimals = await getTokenDecimals()
    // ETH (incl. SparkLend) is always repaid with native ETH (payable repayETH), so query the native
    // balance even when assetAddress is the WETH address (e.g. opened from "Your Borrows", where
    // discoverPositions keeps the on-chain WETH address but displays it as ETH). This keeps the
    // repairable amount consistent with the "Asset to Borrow" entry.
    const balanceAsset = isGasToken.value
      ? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
      : props.assetAddress
    const wei = await getBalanceWei(address.value, balanceAsset)
    balanceWei.value = wei
    balance.value = Math.floor(Number(wei) / Math.pow(10, decimals) * 1e6) / 1e6
  } catch (error) {
    console.error('Failed to fetch balance:', error)
    balance.value = '0.00'
    balanceWei.value = BigInt(0)
  }
}

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

// Resolve the current repay plan: whether the input represents a full-debt ("repay all")
// repayment, plus the raw input amount and the queried debt in wei. For repay-all the
// on-chain pull is the real-time debt, so the approval uses the queried debt + 1% buffer
// (interest accumulated between query and execution) instead of an infinite approval.
async function resolveRepayPlan(): Promise<{ amountWei: bigint; debtWei: bigint; useRepayAll: boolean }> {
  const decimals = await getTokenDecimals()
  const amountWei = toWei(inputAmount.value, decimals)

  let debtWei = borrowedWei.value
  if (debtWei <= 0n && props.borrowedBalance && parseFloat(props.borrowedBalance) > 0) {
    debtWei = toWei(props.borrowedBalance, decimals)
  }

  const useRepayAll = debtWei > 0n && amountWei >= debtWei * 99n / 100n
  return { amountWei, debtWei, useRepayAll }
}

// Max button handler: fill the full outstanding borrow (triggers repayAll)
async function handleMax() {
  if (balanceLoading.value) {
    toast.show('Fetching balance, please wait...', 'warning')
    return
  }

  // Use outstanding borrow as Max (repay all): on-chain query first, props fallback
  if (borrowedWei.value > 0n) {
    const decimals = await getTokenDecimals()
    inputAmount.value = Math.floor(Number(borrowedWei.value) / 10 ** decimals * 1e6) / 1e6 + ''
    return
  }
  if (props.borrowedBalance && parseFloat(props.borrowedBalance) > 0) {
    inputAmount.value = props.borrowedBalance
    return
  }

  // Fallback: use wallet balance
  if (!balanceWei.value || balanceWei.value <= BigInt(0)) {
    toast.show('No balance available', 'warning')
    return
  }

  const maxAmount = calculateMaxAmount(balanceWei.value, isGasToken.value)

  const decimals = await getTokenDecimals()
  const rawValue = Number(maxAmount) / Math.pow(10, decimals)
  inputAmount.value = Math.floor(rawValue * 1e6) / 1e6
}

// Execute approve
async function handleApprove() {
  if (!address.value) return

  const protocolId = props.protocol?.toLowerCase() || ''

  showTxModal('approve')

  try {
    const { amountWei, debtWei, useRepayAll } = await resolveRepayPlan()
    const approveWei = useRepayAll ? debtWei + debtWei / 100n : amountWei

    const spenderAddress = getSpenderAddress(protocolId, 'lending', props.assetAddress)
    if (!spenderAddress) {
      throw new Error(`No spender address for protocol: ${protocolId}`)
    }

    await approveToken(props.assetAddress || '', spenderAddress, approveWei, address.value as `0x${string}`)

    // After approve succeeds, switch directly to repay state (without closing the modal)
    needsApprove.value = false
    txStatus.value = 'pending'
    txAction.value = 'repay'
    txHash.value = ''
    txError.value = ''

    // Auto-call repay
    await handleRepay()
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
      console.error('[Lending Repay] Approve failed:', error)
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

    const decimals = await getTokenDecimals()
    const amountWei = toWei(inputAmount.value, decimals)

    // Check balance
    const maxWei = calculateMaxAmount(balanceWei.value, isGasToken.value)
    if (amountWei > maxWei) {
      toast.show('Amount exceeds available balance', 'warning')
      return
    }

    if (needsApprove.value && !isGasToken.value) {
      await handleApprove()
    } else {
      await handleRepay()
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
      console.error('[Lending Repay] Transaction error:', error)
      updateTxError(error?.message || 'Transaction failed')
    }
  }
}

// Send the repay transaction
async function handleRepay() {
  if (!address.value || !props.assetAddress) {
    throw new Error("Wallet not connected or asset address missing")
  }

  isRepaying.value = true

  if (!txModalVisible.value) {
    showTxModal('repay')
  } else {
    txAction.value = 'repay'
    txStatus.value = 'pending'
    txHash.value = ''
    txError.value = ''
  }

  try {
    const { amountWei, useRepayAll } = await resolveRepayPlan()
    const protocolId = props.protocol?.toLowerCase()

    let hash: string = ''

    if (useRepayAll) {
      switch (protocolId) {
        case 'aave':
          hash = await aave?.repayAll(props.assetAddress, address.value as `0x${string}`) || ''
          break
        case 'compound':
          hash = await compound?.repayAll(props.assetAddress, address.value as `0x${string}`) || ''
          break
        case 'sparklend':
          hash = await sparklend?.repayAll(props.assetAddress, address.value as `0x${string}`) || ''
          break
        case 'morpho':
          setMorphoPool(props.poolId || '')
          hash = await morpho?.repayAll(props.assetAddress, address.value as `0x${string}`) || ''
          break
        case 'fluid':
          hash = await fluid?.repayAll(props.assetAddress, address.value as `0x${string}`) || ''
          break
        default:
          hash = await aave?.repay(props.assetAddress, amountWei, address.value as `0x${string}`) || ''
      }
    } else {
      switch (protocolId) {
        case 'aave':
          hash = await aave?.repay(props.assetAddress, amountWei, address.value as `0x${string}`) || ''
          break
        case 'compound':
          hash = await compound?.repay(props.assetAddress, amountWei, address.value as `0x${string}`) || ''
          break
        case 'sparklend':
          hash = await sparklend?.repay(props.assetAddress, amountWei, address.value as `0x${string}`) || ''
          break
        case 'morpho':
          setMorphoPool(props.poolId || '')
          hash = await morpho?.repay(props.assetAddress, amountWei, address.value as `0x${string}`) || ''
          break
        case 'fluid':
          hash = await fluid?.repay(props.assetAddress, amountWei, address.value as `0x${string}`) || ''
          break
        default:
          hash = await aave?.repay(props.assetAddress, amountWei, address.value as `0x${string}`) || ''
      }
    }


    const result = await waitForConfirmation(hash, 45000, {
      protocolId: props.protocol?.toLowerCase() || '',
      protocol: props.protocol || '',
      poolId: getBackendPoolId(props.poolId || '', props.protocol || ''),
      asset: props.asset || '',
      category: 'lending',
      action: 'repay',
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
    isRepaying.value = false
  }
}

// Check Authorization Status
async function checkApprovalStatus() {
  if (!address.value || !props.assetAddress || isGasToken.value) {
    // ETH repayment needs no approve
    needsApprove.value = false
    return
  }

  const protocolId = props.protocol?.toLowerCase() || ''

  // Aave: repay requires approving the asset to the Aave Pool
  // Compound: repay requires approving the asset to Comet/cToken
  // SparkLend: repay requires approving the asset to the Pool (Aave interface)
  // No protocol-specific skips; check uniformly

  const spenderAddress = getSpenderAddress(protocolId, 'lending', props.assetAddress)
  if (!spenderAddress) {
    needsApprove.value = false
    return
  }

  const { amountWei, debtWei, useRepayAll } = await resolveRepayPlan()
  const approveWei = useRepayAll ? debtWei + debtWei / 100n : amountWei

  await checkAllowanceStatus(props.assetAddress, address.value as `0x${string}`, spenderAddress, approveWei)
}

// Listen for address changes
watch(address, () => {
  fetchBalance()
  fetchBorrowed()
  checkApprovalStatus()
})

// Listen for asset changes
watch(() => props.assetAddress, () => {
  fetchBalance()
  fetchBorrowed()
  checkApprovalStatus()
})

// Watch pool/protocol changes (re-query borrow when the same asset switches between pools)
watch(() => [props.poolId, props.protocol], () => {
  fetchBorrowed()
})

// Changes in the amount of monitored input (anti-shake)
watch(inputAmount, () => {
  debouncedCheckApproval()
})

onMounted(() => {
  fetchBalance()
  fetchBorrowed()
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
  padding: 4.626px 10px;
  flex-direction: column;
  justify-content: center;
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
