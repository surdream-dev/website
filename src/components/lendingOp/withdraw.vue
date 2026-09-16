<template>
  <div class="panel">
    <div class="stake-wrapper">
      <div class="row">
        <span>Available to withdraw</span>
        <span v-if="address">
          {{ availableLoading ? '...' : available }} {{ asset }}
        </span>
      </div>
      <div class="input-wrapper">
        <InputBox v-model="inputAmount"/>
        <button
          :class="address && availableWei > BigInt(0) ? 'max active' : 'max'"
          @click="handleMax"
          :disabled="!address || availableWei <= BigInt(0)"
        >
          Max
        </button>
        <div class="token-wrapper">
          <img :src="asseticon"/>
          <span>{{ asset }}</span>
        </div>
      </div>
    </div>

    <div v-if="health.hint" :class="['health-hint', health.hint.level]">
      {{ health.hint.message }}
    </div>

    <PrimaryBtn
      v-if="address"
      :is-loading="isApproving || isWithdrawing"
      :is-disabled="isApproving || isWithdrawing || health.isBlocked"
      @click="handleAction()"
    >
      {{ isApproving ? 'Approving...' : isWithdrawing ? 'Withdrawing...' : buttonLabel }}
    </PrimaryBtn>
    <PrimaryBtn v-else @click="walletStore.openConnect()">Connect Wallet</PrimaryBtn>

    <div class="info">
      <div v-if="showHF" class="hf-row">
        <span class="hf-title">Health Factor{{ health.isAccountLevel ? ' · ' + health.scope : '' }}</span>
        <span :class="['hf-value', health.riskLevel]">{{ health.hfText }}</span>
      </div>
      <div><span>APY</span><span>{{ currentSupplyApy === '-' ? '-' : currentSupplyApy + '%' }}</span></div>
      <div><span>Collateralization</span><span>{{ currentCollateralization }}</span></div>
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
import { maxUint256 } from 'viem'
import InputBox from './InputBox.vue'
import PrimaryBtn from './PrimaryBtn.vue'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { lending } from "@/chain/lending"
import { toWei, fromWei } from "@/chain/utils/decimals"
import { useApprove, getSpenderAddress } from "@/chain/utils/approve"
import { toast } from "@/utils/toast"
import TxStatusModal from '@/components/TxStatusModal.vue'
import { useBalance } from "@/composables/useBalance"
import { useTxConfirmation } from "@/composables/useTxConfirmation"
import { ADDRESSES } from "@/chain/evm/addresses"
import { useTxCost, GAS } from "@/chain/core/gas"
import { setFluidPool } from "@/chain/lending/fluid"
import { setMorphoPool } from "@/chain/lending/morpho"
import { isLiquidityAsset, getBackendPoolId } from '@/constants/protocols'
import { useLendingHealth } from '@/composables/useLendingHealth'

// Use balance composable
const { getBalanceWei, getTokenDecimals: fetchTokenDecimals, clearCache, loading: balanceLoading } = useBalance()

// Confirm hook with transaction
const { waitForConfirmation } = useTxConfirmation()

// Transaction Status Type
type TxStatus = 'pending' | 'success' | 'error'
type TxAction = 'approve' | 'withdraw' | 'unwrap'

const emit = defineEmits<{
  (e: 'openProcess', value: boolean): void
}>()

const props = defineProps<{
  asset?: string
  asseticon?: string
  assetAddress?: string
  receiptToken?: string      // Receipt token address (e.g. aUSDC)
  receiptTokenSymbol?: string // Receipt token symbol (e.g. aUSDC)
  protocol?: string
  poolId?: string            // Pool ID (Flattened primary key)
  decimals?: number
  supplyApy?: string
  collateralization?: string
}>()

const walletStore = useWalletStore()
const { address, isConnected } = storeToRefs(walletStore)

// Status
const inputAmount = ref<string>('')
const balance = ref<string>('0.00')
const balanceWei = ref<bigint>(BigInt(0))
// Available to withdraw: equal to the actual on-chain supplied collateral amount
const available = ref<string>('0.00')
const availableWei = ref<bigint>(BigInt(0))
const availableLoading = ref(false)
// Whether the current operation is a full (Max) withdrawal — pass maxUint256 to the adapter
// so protocols with real "withdraw all" semantics don't leave dust from the 6-decimal front-end truncation.
const isFullWithdraw = ref(false)
// Guard flag: handleMax() also mutates inputAmount, which triggers watch(inputAmount);
// suppress that watch so the full-withdraw intent isn't reset by our own programmatic write.
let suppressInputWatch = false

// Use generic approve hook
const { isApproving, needsApprove, approve: approveToken, checkAllowance: checkAllowanceStatus } = useApprove()

// Withdraw status
const isWithdrawing = ref(false)

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
const txAction = ref<TxAction>('withdraw')
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

// Determine whether it is a gas token
const isGasToken = computed(() => {
  return props.asset?.toUpperCase() === 'ETH' ||
         props.assetAddress?.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
})

// Default Value
const currentSupplyApy = computed(() => props.supplyApy || '-')
const currentCollateralization = computed(() => props.collateralization || 'Enabled')
const { txCost: currentTxCost } = useTxCost(GAS.withdraw)

const protocolId = computed(() => props.protocol?.toLowerCase().replace(/[\s.]/g, '') || '')
// Liquidity positions (fToken, e.g. Compound/Morpho/Fluid USDC-USDT "Your Liquidity") are not
// vault collateral — withdrawing them never changes health factor, so HF is neither fetched
// nor shown for them (see useLendingHealth `enabled`).
const isLiquidity = computed(() => isLiquidityAsset(props.poolId || '', props.asset || ''))
const health = useLendingHealth({
  account: () => address.value || '',
  protocol: () => protocolId.value,
  poolId: () => props.poolId,
  assetAddress: () => props.assetAddress,
  action: 'withdraw',
  amount: inputAmount,
  enabled: () => !isLiquidity.value,
})
const showHF = computed(() => !isLiquidity.value && health.hasDebt)

// Button Label
const buttonLabel = computed(() => {
  if (!props.receiptToken) return 'Withdraw'
  return needsApprove.value ? 'Approve' : 'Withdraw'
})

// Query receipt token balance (aToken, etc.)
async function fetchBalance() {

  if (!address.value) {
    balance.value = '0.00'
    balanceWei.value = BigInt(0)
    return
  }

  // Prefer the protocol adapter's getSupplyBalance for the actual on-chain deposited amount
  // Avoid wrongly showing wallet balance when receiptToken is missing
  const protocolId = props.protocol?.toLowerCase()
  const protocolAdapter = lending.getByPool(props.poolId || protocolId || '')

  if (protocolAdapter?.getSupplyBalance && props.assetAddress) {
    try {
      const poolId = props.poolId || props.protocol?.toLowerCase().replace(/[\s.]/g, '')
      const wei = await protocolAdapter.getSupplyBalance(address.value as `0x${string}`, props.assetAddress, poolId)
      balanceWei.value = wei
      const decimals = props.decimals ?? await fetchTokenDecimals(props.assetAddress!) ?? 18
      balance.value = formatReadable(wei, decimals)
      return
    } catch (error) {
      console.error(`[Lending Withdraw] ${protocolId} getSupplyBalance failed:`, error)
    }
  }

  // Fallback: query receipt balance via receiptToken (e.g. aUSDC)
  if (props.receiptToken) {
    try {
      const decimals = await getTokenDecimals()
      const wei = await getBalanceWei(address.value, props.receiptToken)
      balanceWei.value = wei
      balance.value = formatReadable(wei, decimals)
      return
    } catch (error) {
      console.error('Failed to fetch receiptToken balance:', error)
    }
  }

  balance.value = '0.00'
  balanceWei.value = BigInt(0)
}

// Get Token Precision
async function getTokenDecimals(): Promise<number> {
  // Morpho: receiptToken is the Morpho Blue contract address; use assetAddress or props.decimals
  if (props.protocol?.toLowerCase() === 'morpho') {
    if (props.decimals !== undefined && props.decimals > 0) {
      return props.decimals
    }
    if (props.assetAddress) {
      try {
        return await fetchTokenDecimals(props.assetAddress)
      } catch {}
    }
    return 18
  }

  // Withdraw query is receiptToken (voucher token), get its precision first
  const tokenAddress = props.receiptToken || props.assetAddress
  if (tokenAddress) {
    try {
      const decimals = await fetchTokenDecimals(tokenAddress)
      return decimals
    } catch (error) {
      console.warn('[Lending Withdraw] Failed to fetch decimals, using props.decimals or default 18')
    }
  }
  // If the query fails, use props.decimals
  if (props.decimals !== undefined && props.decimals > 0) {
    return props.decimals
  }
  return 18
}

// Get underlying asset decimals (available is shown in underlying asset units)
async function getAssetDecimals(): Promise<number> {
  if (props.decimals !== undefined && props.decimals > 0) return props.decimals
  if (props.assetAddress) {
    try { return await fetchTokenDecimals(props.assetAddress) } catch {}
  }
  return 18
}

function formatReadable(wei: bigint, decimals: number): string {
  const num = Number(wei) / Math.pow(10, decimals)
  // Dust balance: non-zero but rounds to 0 at the 6-decimal display precision
  // (e.g. 0.0000009 WBTC at 8 decimals) — show the real tiny amount instead of "0".
  if (num > 0 && num < 1e-6) {
    const maxPrec = Math.min(Math.max(decimals, 6), 8)
    const s = num.toFixed(maxPrec).replace(/\.?0+$/, '')
    return parseFloat(s) > 0 ? s : '<0.000001'
  }
  return Math.floor(num * 1e6) / 1e6 + ''
}

// Compute Available to withdraw.
// The collateral itself is not reduced by existing borrows; show the full supplied amount as available.
async function computeAvailable() {
  if (!address.value || !props.assetAddress) {
    availableWei.value = BigInt(0)
    available.value = '0.00'
    return
  }
  availableLoading.value = true
  try {
    const decimals = await getAssetDecimals()
    availableWei.value = balanceWei.value
    available.value = formatReadable(balanceWei.value, decimals)
  } finally {
    availableLoading.value = false
  }
}

// Max button handler: directly use the computed Available
async function handleMax() {
  if (availableLoading.value || balanceLoading.value) {
    toast.show('Fetching balance, please wait...', 'warning')
    return
  }

  // Liquidity positions (fToken, e.g. Fluid/Compound USDC-USDT "Your Liquidity") are not
  // vault collateral — withdrawing them never changes health factor, so Max must not gate
  // on the health snapshot (which is undefined for a liquidity-only position) and simply
  // fills the full available liquidity amount.
  if (!isLiquidity.value) {
    // The Max button means "the largest amount I can safely withdraw". That decision
    // needs the health snapshot, not just the wallet/balance. On the first render the
    // snapshot may still be loading (the immediate health fetch is in-flight); rather
    // than bailing out on the first click, wait for that load to settle. If we treated
    // a null snapshot as "no debt → withdraw everything", Max would incorrectly fill the
    // full balance and could push HF into liquidation.
    await health.awaitLoaded()
    if (!health.snapshot) {
      try {
        await health.refresh()
      } catch {
        // ignore; the snapshot check below handles the failure
      }
    }

    if (health.loading || !health.snapshot) {
      toast.show('Health data not available, please try again...', 'warning')
      return
    }
  }

  if (!availableWei.value || availableWei.value <= BigInt(0)) {
    toast.show('No balance available', 'warning')
    return
  }

  const decimals = await getAssetDecimals()
  const availableNum = Number(availableWei.value) / Math.pow(10, decimals)

  // The Max button means "the largest amount I can safely withdraw": keep the
  // resulting HF at the safe buffer. With no debt there is no liquidation risk,
  // so the full available balance is safe. Liquidity positions skip this whole
  // health calculation (see above).
  let num = availableNum
  let isFull = true
  if (!isLiquidity.value) {
    const safeMax = health.safeMaxWithdraw
    if (typeof safeMax === 'number' && Number.isFinite(safeMax)) {
      if (safeMax < availableNum) {
        num = safeMax
        isFull = false
      }
    } else if (safeMax === null || safeMax === undefined) {
      // Snapshot is present but safeMax is null. Only the "no debt" case makes a full
      // withdrawal safe; if there is debt but the calculation is unavailable, do not
      // silently guess "full is safe".
      if (health.hasDebt) {
        toast.show('Unable to calculate a safe amount, please try again...', 'warning')
        return
      }
      isFull = true
    } else {
      // Non-finite safeMax (NaN/Infinity) means the calculation is broken for this
      // asset; do not guess "full is safe".
      toast.show('Unable to calculate a safe amount, please try again...', 'warning')
      return
    }
  }

  if (num <= 0) {
    inputAmount.value = '0'
    isFullWithdraw.value = false
    toast.show('No safe amount available to withdraw', 'warning')
    suppressInputWatch = true
    queueMicrotask(() => { suppressInputWatch = false })
    return
  }

  const floor6 = Math.floor(num * 1e6) / 1e6
  // Preserve dust amounts (e.g. 0.0000009 WBTC) that would otherwise floor to "0"
  // so the full-withdraw sends the real balance instead of a zero-amount tx.
  inputAmount.value = floor6 > 0
    ? floor6 + ''
    : (num > 0 ? num.toFixed(decimals).replace(/\.?0+$/, '') : '0')
  isFullWithdraw.value = isFull
  suppressInputWatch = true
  queueMicrotask(() => { suppressInputWatch = false })
}

// Execute approve
async function handleApprove() {
  if (!address.value || !props.receiptToken) return

  const protocolId = props.protocol?.toLowerCase() || ''
  const spenderAddress = getSpenderAddress(protocolId, 'lending', props.receiptToken, isGasToken.value)

  if (!spenderAddress) {
    throw new Error(`No spender address for protocol: ${protocolId}`)
  }

  showTxModal('approve')

  try {
    const decimals = await getTokenDecimals()
    // Full withdraw: approve the on-chain full balance + 1% buffer (matches the repay rule),
    // not maxUint256. The spWETH balance accrues interest between query and execution, so the
    // small buffer keeps the withdraw-all from exceeding the approved allowance.
    const amountWei = isFullWithdraw.value
      ? availableWei.value + availableWei.value / 100n
      : toWei(inputAmount.value, decimals)


    await approveToken(props.receiptToken, spenderAddress, amountWei, address.value as `0x${string}`)

    // After Approve is successful, switch directly to the withdraw state (without closing the pop-up)
    needsApprove.value = false
    txStatus.value = 'pending'
    txAction.value = 'withdraw'
    txHash.value = ''
    txError.value = ''
    // Continue with withdraw without closing the popup

    // Automatically call withdraw
    await handleWithdraw()
  } catch (error: any) {
    // approve failed, interrupting process
    txModalVisible.value = false

    const isUserRejected =
      error?.code === 4001 ||
      error?.cause?.code === 4001 ||
      error?.message?.toLowerCase().includes('user rejected') ||
      error?.message?.toLowerCase().includes('user denied')

    if (isUserRejected) {
      toast.show('Approval cancelled by user', 'error')
    } else {
      console.error('[Lending Withdraw] Approve failed:', error)
      toast.show('Approval failed: ' + (error?.message || 'Unknown error'), 'error')
    }
  }
}

// Process button click
async function handleAction() {
  try {
    if (balanceLoading.value || availableLoading.value) {
      toast.show('Fetching balance, please wait...', 'warning')
      return
    }

    const inputNum = parseFloat(inputAmount.value) || 0
    if (inputNum <= 0) {
      toast.show('Please enter a valid amount', 'warning')
      return
    }

    const decimals = await getAssetDecimals()
    const amountWei = toWei(inputAmount.value, decimals)

    // Full withdraw skips the available check: the actual on-chain balance may exceed the
    // truncated display value, and the adapter resolves the true amount.
    if (!isFullWithdraw.value && amountWei > availableWei.value) {
      toast.show('Amount exceeds available balance', 'warning')
      return
    }

    if (needsApprove.value) {
      await handleApprove()
    } else {
      await handleWithdraw()
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
      console.error('[Lending Withdraw] Transaction error:', error)
      updateTxError(error?.message || 'Transaction failed')
    }
  }
}

// Send withdraw transaction
async function handleWithdraw() {
  if (!address.value || !props.assetAddress) {
    throw new Error("Wallet not connected or asset address missing")
  }

  isWithdrawing.value = true

  // Only update the status if the popup is open (switched from approve); otherwise reopen
  if (!txModalVisible.value) {
    showTxModal('withdraw')
  } else {
    // Popup is open, switch to withdraw state directly
    txAction.value = 'withdraw'
    txStatus.value = 'pending'
    txHash.value = ''
    txError.value = ''
  }

  try {
    // Withdraw amounts are in underlying asset units; always use underlying asset decimals (e.g. USDC=6), not receiptToken decimals (e.g. gtUSDC=18)
    const assetDecimals = await getAssetDecimals()
    const amountWei = isFullWithdraw.value ? maxUint256 : toWei(inputAmount.value, assetDecimals)

    const protocolId = props.protocol?.toLowerCase()


    const poolAdapter = lending.getByPool(props.poolId || protocolId || '')
    if (!poolAdapter) {
      throw new Error(`No adapter found for pool: ${props.poolId || protocolId}`)
    }
    // Fluid Vault: set pool context before withdraw (ETH collateral must determine which vault)
    if (protocolId === 'morpho') setMorphoPool(props.poolId || '')
    if (protocolId === 'fluid') setFluidPool(props.poolId || '')
    let hash: string = ''
    hash = await poolAdapter.withdraw(props.assetAddress, amountWei, address.value as `0x${string}`, props.poolId)


    // Waiting for transaction confirmation to be linked
    const result = await waitForConfirmation(hash, 45000, {
      protocolId: props.protocol?.toLowerCase() || '',
      protocol: props.protocol || '',
      poolId: getBackendPoolId(props.poolId || '', props.protocol || ''),
      asset: props.asset || '',
      category: 'lending',
      // Liquidity asset removal in single-supply/single-borrow pools → remove-liquidity; collateral/cross-asset pools → withdraw
      action: isLiquidityAsset(props.poolId || '', props.asset || '') ? 'remove-liquidity' : 'withdraw',
      amount: inputAmount.value
    })

    if (!result.success) {
      if (result.timedOut) {
        txStatus.value = 'timeout'
        txError.value = result.error || ''
        return
      }
      updateTxError(result.error || 'Transaction failed on-chain')
      return
    }


    // SparkLend ETH: WETH_GATEWAY.withdrawETH completes withdraw + unwrap in one step
    updateTxSuccess(hash)
    // Clear balance cache
    const tokenAddress = props.receiptToken || props.assetAddress
    clearCache(address.value, tokenAddress)

    emit('openProcess', true)
  } finally {
    isWithdrawing.value = false
  }
}

// Check approval status (withdraw requires approving the aToken)
async function checkApprovalStatus() {
  if (!address.value || !props.receiptToken) {
    needsApprove.value = false
    return
  }

  const protocolId = props.protocol?.toLowerCase() || ''

  // Aave ETH withdraw: Approve aWETH to WETH_gateway is required
  // Aave other assets withdraw: no approve needed, call Pool.withdraw directly
  if (protocolId === 'aave' && !isGasToken.value) {
    needsApprove.value = false
    return
  }

  // Compound V3 withdraw: call comet.withdraw directly, no approve needed
  if (protocolId === 'compound') {
    needsApprove.value = false
    return
  }

  // SparkLend withdraw:
  // - ETH: two-step (official Spark) — approve spWETH → WETH_GATEWAY, then WETH_Gateway.withdrawETH (native ETH)
  // - Other assets: call Pool.withdraw directly, no approve needed
  if (protocolId === 'sparklend' && !isGasToken.value) {
    needsApprove.value = false
    return
  }

  // Fluid withdraw uses redeem/withdrawNative, no approve needed
  if (protocolId === 'fluid') {
    needsApprove.value = false
    return
  }

  // Morpho MetaMorpho Vault withdraw follows the ERC-4626 standard, no approve needed (shares are burned directly)
  if (protocolId === 'morpho') {
    needsApprove.value = false
    return
  }

  const spenderAddress = getSpenderAddress(protocolId, 'lending', props.receiptToken, isGasToken.value)

  if (!spenderAddress) {
    needsApprove.value = false
    return
  }

  const decimals = await getTokenDecimals()
  // Full withdraw: check allowance against on-chain full balance + 1% buffer (matches the repay
  // rule), not maxUint256 — covers interest accrued between query and execution.
  const amountWei = isFullWithdraw.value
    ? availableWei.value + availableWei.value / 100n
    : toWei(inputAmount.value || '0', decimals)


  await checkAllowanceStatus(props.receiptToken, address.value as `0x${string}`, spenderAddress, amountWei)
}

// Unified refresh: fetch supply first, then compute Available from supply + borrow
async function refresh() {
  await fetchBalance()
  await computeAvailable()
  checkApprovalStatus()
}

// Listen for address changes
watch(address, () => {
  isFullWithdraw.value = false
  refresh()
})

// Listen for token changes
watch(() => props.receiptToken, () => {
  isFullWithdraw.value = false
  refresh()
})

// Watch pool/asset changes (Available depends on the current pool context)
watch(() => [props.poolId, props.assetAddress], () => {
  isFullWithdraw.value = false
  refresh()
})

// Changes in the amount of monitored input (anti-shake)
watch(inputAmount, () => {
  // handleMax() also triggers this watcher; keep the full-withdraw intent but still
  // re-run the approval check (Aave ETH needs max approval before withdraw).
  if (!suppressInputWatch) {
    // User typed a specific amount — the previous Max intent no longer applies
    isFullWithdraw.value = false
  }
  debouncedCheckApproval()
})

onMounted(() => {
  refresh()
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
