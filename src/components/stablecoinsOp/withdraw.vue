<template>
  <div class="panel">
    <div class="stake-wrapper">
      <div class="row">
        <span>Available to withdraw</span>
        <span v-if="address">
          {{ isLendingProtocol ? (availableLoading ? '...' : available) : (balanceLoading ? '...' : balance) }} {{ isLendingProtocol ? asset : (receiptTokenSymbol || asset) }}
        </span>
      </div>
      <div class="input-wrapper">
        <InputBox v-model="inputAmount"/>
        <button
          :class="address && displayWei > BigInt(0) ? 'max active' : 'max'"
          @click="handleMax"
          :disabled="!address || displayWei <= BigInt(0)"
        >
          Max
        </button>
        <div class="token-wrapper">
          <img :src="asseticon"/>
          <span>{{ isLendingProtocol ? asset : (receiptTokenSymbol || asset) }}</span>
        </div>
      </div>
    </div>

    <PrimaryBtn
      v-if="address"
      :is-loading="isApproving || isWithdrawing"
      :is-disabled="isApproving || isWithdrawing"
      @click="handleAction()"
    >
      {{ isApproving ? 'Approving...' : isWithdrawing ? 'Withdrawing...' : buttonLabel }}
    </PrimaryBtn>
    <PrimaryBtn v-else @click="walletStore.openConnect()">Connect Wallet</PrimaryBtn>

    <div class="info">
      <div><span>APY</span><span>{{ currentApy === '-' ? '-' : currentApy + '%' }}</span></div>
      <div><span>Exchange rate</span><span>{{ exchangeRateDisplay }}</span></div>
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
import { computed, ref, watch, onMounted } from 'vue'
import { maxUint256 } from 'viem'
import InputBox from './InputBox.vue'
import PrimaryBtn from './PrimaryBtn.vue'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { stablecoin } from "@/chain/stablecoin"
import { lending } from "@/chain/lending"
import { ethenaRate } from "@/chain/stablecoin/ethena"
import { toWei, fromWei } from "@/chain/utils/decimals"
import { useApprove, getSpenderAddress } from "@/chain/utils/approve"
import { getBackendPoolId } from '@/constants/protocols'
import { toast } from "@/utils/toast"
import TxStatusModal from '@/components/TxStatusModal.vue'
import { useBalance } from "@/composables/useBalance"
import { useTxConfirmation } from "@/composables/useTxConfirmation"
import { useTxCost, GAS } from "@/chain/core/gas"
import { getMorphoVaultExchangeRate } from '@/composables/useMorphoVault'
import { setMorphoPool } from "@/chain/lending/morpho"
import { getFluidLiquidityExchangeRate, setFluidPool } from "@/chain/lending/fluid"

// Use balance composable
const { getBalanceWei, getTokenDecimals: fetchTokenDecimals, clearCache, loading: balanceLoading } = useBalance()

// Confirm hook with transaction
const { waitForConfirmation } = useTxConfirmation()

// Transaction Status Type
type TxStatus = 'pending' | 'success' | 'error'
type TxAction = 'approve' | 'withdraw' | 'unstake'

// Protocol Adapter
const ethena = stablecoin.get("ethena")
const curve = stablecoin.get("curve")

// Lending protocol IDs (these use lending adapter, not stablecoin)
const LENDING_PROTOCOLS = ['aave', 'compound', 'morpho', 'sparklend', 'fluid']

const emit = defineEmits<{
  (e: 'openProcess', value: boolean): void
}>()

const props = defineProps<{
  asset?: string             // Asset name (e.g. "USDT", "USDC", "USDe")
  asseticon?: string
  assetAddress?: string      // Asset contract address (the underlying asset)
  receiptToken?: string      // Receipt token address (e.g. sUSDe, 3CRV LP token)
  receiptTokenSymbol?: string // Receipt token symbol (e.g. sUSDe, 3CRV)
  approveSpender?: string    // Approve spender address (Curve = Pool, Ethena = empty)
  protocol?: string          // Protocol ID (ethena, curve)
  decimals?: number          // Token Accuracy
  apy?: string
  selectedItem?: any         // Full row data (used as fallback for contracts.staking etc.)
}>()

const walletStore = useWalletStore()
const { address, isConnected } = storeToRefs(walletStore)

// Status
const inputAmount = ref<string>('')
const balance = ref<string>('0.00')
const balanceWei = ref<bigint>(BigInt(0))
const exchangeRate = ref<number>(1)
// Available to withdraw: only used by Lending protocols, equal to the supplied amount
const available = ref<string>('0.00')
const availableWei = ref<bigint>(BigInt(0))
const availableLoading = ref(false)
// Full (Max) withdrawal intent for lending protocols — pass maxUint256 to the adapter
// so "withdraw all" doesn't leave dust from the 6-decimal front-end truncation.
const isFullWithdraw = ref(false)
// Guard flag: handleMax() also mutates inputAmount, which triggers watch(inputAmount);
// suppress that watch so the full-withdraw intent isn't reset by our own programmatic write.
let suppressInputWatch = false

// Use generic approve hook
const { isApproving, needsApprove, approve: approveToken, checkAllowance: checkAllowanceStatus } = useApprove()

// Withdraw status
const isWithdrawing = ref(false)

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

// Default Value
const currentApy = computed(() => props.apy || '-')
const { txCost: currentTxCost } = useTxCost(GAS.withdraw)

// Button Label
const buttonLabel = computed(() => {
  if (!props.receiptToken) return 'Withdraw'
  return needsApprove.value ? 'Approve' : 'Withdraw'
})

// Whether it is a Lending protocol (these show underlying assets + plan A safe withdrawable amount)
const isLendingProtocol = computed(() =>
  LENDING_PROTOCOLS.includes((props.protocol || '').toLowerCase())
)

// Withdrawable amount used by Max: Lending uses available (safe amount), others use balance (receipt balance)
const displayWei = computed(() => isLendingProtocol.value ? availableWei.value : balanceWei.value)

// Exchange rate display
const exchangeRateDisplay = computed(() => {
  return `1 ${props.receiptTokenSymbol || 'Token'} ≈ ${exchangeRate.value.toFixed(4)} ${props.asset}`
})

// Query exchange rate
async function fetchExchangeRate() {
  const protocolId = props.protocol?.toLowerCase() || ''

  // Ethena uses ERC4626 previewRedeem for the real exchange rate
  if (protocolId === 'ethena') {
    try {
      const rate = await ethenaRate.getExchangeRate()
      exchangeRate.value = rate
    } catch (error) {
      console.warn('[Stablecoin Withdraw] Failed to fetch Ethena rate, using 1:1')
      exchangeRate.value = 1
    }
    return
  }

  // Curve: temporarily hardcode 1:1 (dynamic rate can be added later)
  if (protocolId === 'curve') {
    exchangeRate.value = 1
    return
  }

  // Fluid fToken liquidity: 1 fToken ≈ convertToAssets(1 share) of underlying (fUSDT≈1.20, fUSDC≈1.21)
  if (protocolId === 'fluid') {
    try {
      const rate = await getFluidLiquidityExchangeRate(props.receiptToken || props.assetAddress || '')
      exchangeRate.value = rate > 0 ? rate : 1
    } catch (error) {
      console.warn('[Stablecoin Withdraw] Failed to fetch Fluid rate, using 1:1')
      exchangeRate.value = 1
    }
    return
  }

  // Morpho vault shares: 1 share ≈ convertToAssets(1 share) of underlying (not 1:1)
  if (protocolId === 'morpho') {
    try {
      const rate = await getMorphoVaultExchangeRate(props.asset || '')
      exchangeRate.value = rate > 0 ? rate : 1
    } catch (error) {
      console.warn('[Stablecoin Withdraw] Failed to fetch Morpho rate, using 1:1')
      exchangeRate.value = 1
    }
    return
  }

  // Other protocols default to 1:1
  exchangeRate.value = 1
}

// Query voucher token balance
async function fetchBalance() {
  if (!address.value) {
    balance.value = '0.00'
    balanceWei.value = BigInt(0)
    return
  }

  // Lending protocols: query actual on-chain supply via the lending adapter (in underlying units) for the available calculation
  if (isLendingProtocol.value) {
    try {
      const protocolId = (props.protocol || '').toLowerCase()
      const poolId = (props.selectedItem as any)?.poolId || protocolId
      const adapter = lending.getByPool(poolId || protocolId || '')
      if (adapter?.getSupplyBalance && props.assetAddress) {
        const wei = await adapter.getSupplyBalance(address.value as `0x${string}`, props.assetAddress, poolId)
        balanceWei.value = wei
        const decimals = await getAssetDecimals()
        balance.value = Math.floor(Number(wei) / Math.pow(10, decimals) * 1e6) / 1e6 + ''
        return
      }
    } catch (error) {
      console.error('[Stablecoin Withdraw] Lending getSupplyBalance failed, falling back to receiptToken:', error)
    }
    // Fall back to the receipt token (aToken) balance logic below
  }

  // Prefer the receipt token; otherwise try contracts.staking (aToken address for Aave etc.)
  const tokenAddr = props.receiptToken
    || (props.selectedItem as any)?.contracts?.staking
  if (!tokenAddr) {
    balance.value = '0.00'
    balanceWei.value = BigInt(0)
    return
  }

  try {
    const decimals = await getTokenDecimals()
    const wei = await getBalanceWei(address.value, tokenAddr)
    balanceWei.value = wei
    balance.value = Math.floor(Number(wei) / Math.pow(10, decimals) * 1e6) / 1e6
  } catch (error) {
    console.error('Failed to fetch balance:', error)
    balance.value = '0.00'
    balanceWei.value = BigInt(0)
  }
}

// Get Token Precision
async function getTokenDecimals(): Promise<number> {
  // Withdraw query is receiptToken (voucher token), get its precision first
  if (props.receiptToken) {
    try {
      const decimals = await fetchTokenDecimals(props.receiptToken)
      return decimals
    } catch (error) {
      console.warn('[Stablecoin Withdraw] Failed to fetch receiptToken decimals, using default 18')
      return 18  // LP tokens default to 18 decimals
    }
  }
  // If there is no receiptToken, use props.decimals (underlying asset decimals)
  if (props.decimals !== undefined && props.decimals > 0) {
    return props.decimals
  }
  return 18
}

// Get underlying asset decimals (Lending shows/converts in underlying asset units)
async function getAssetDecimals(): Promise<number> {
  if (props.decimals !== undefined && props.decimals > 0) return props.decimals
  if (props.assetAddress) {
    try { return await fetchTokenDecimals(props.assetAddress) } catch {}
  }
  return 18
}

// Withdraw amount decimals: Lending uses underlying asset decimals, others use receipt token decimals
async function getWithdrawDecimals(): Promise<number> {
  return isLendingProtocol.value ? await getAssetDecimals() : await getTokenDecimals()
}

// Compute Available to withdraw for Lending protocols.
// The supplied collateral is not reduced by existing borrows; show the full supplied amount.
async function computeAvailable() {
  if (!isLendingProtocol.value) return
  if (!address.value || !props.assetAddress) {
    availableWei.value = BigInt(0)
    available.value = '0.00'
    return
  }
  availableLoading.value = true
  try {
    const decimals = await getAssetDecimals()
    availableWei.value = balanceWei.value
    available.value = Math.floor(Number(balanceWei.value) / Math.pow(10, decimals) * 1e6) / 1e6 + ''
  } finally {
    availableLoading.value = false
  }
}

// Max Button Handling
async function handleMax() {
  if (balanceLoading.value || (isLendingProtocol.value && availableLoading.value)) {
    toast.show('Fetching balance, please wait...', 'warning')
    return
  }

  if (!displayWei.value || displayWei.value <= BigInt(0)) {
    toast.show('No balance available', 'warning')
    return
  }

  const decimals = isLendingProtocol.value ? await getAssetDecimals() : await getTokenDecimals()
  const rawValue = Number(displayWei.value) / Math.pow(10, decimals)
  inputAmount.value = Math.floor(rawValue * 1e6) / 1e6
  // Only lending adapters support the maxUint256 "withdraw all" semantics
  if (isLendingProtocol.value) {
    isFullWithdraw.value = true
    suppressInputWatch = true
    queueMicrotask(() => { suppressInputWatch = false })
  }
}

// Execute approve
async function handleApprove() {
  if (!address.value || !props.receiptToken) return

  const protocolId = props.protocol?.toLowerCase() || ''
  // Prioritize props.approveSpender
  const spenderAddress = props.approveSpender || getSpenderAddress(protocolId, 'stablecoin', props.receiptToken)

  if (!spenderAddress) {
    throw new Error(`No spender address for protocol: ${protocolId}`)
  }

  showTxModal('approve')

  try {
    const decimals = await getTokenDecimals()
    const amountWei = toWei(inputAmount.value, decimals)


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
      console.error('[Stablecoin Withdraw] Approve failed:', error)
      toast.show('Approval failed: ' + (error?.message || 'Unknown error'), 'error')
    }
  }
}

// Process button click
async function handleAction() {
  try {
    if (balanceLoading.value || (isLendingProtocol.value && availableLoading.value)) {
      toast.show('Fetching balance, please wait...', 'warning')
      return
    }

    const inputNum = parseFloat(inputAmount.value) || 0
    if (inputNum <= 0) {
      toast.show('Please enter a valid amount', 'warning')
      return
    }

    const decimals = await getWithdrawDecimals()
    const amountWei = toWei(inputAmount.value, decimals)

    // Full withdraw skips the available check: the real on-chain balance may exceed the
    // truncated display value, and the adapter resolves the true amount.
    if (!isFullWithdraw.value && amountWei > displayWei.value) {
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
      console.error('[Stablecoin Withdraw] Transaction error:', error)
      updateTxError(error?.message || 'Transaction failed')
    }
  }
}

// Send withdraw transaction
async function handleWithdraw() {
  if (!address.value) return
  // Lending protocols need the asset address; stablecoin protocols need the receipt token
  if (isLendingProtocol.value ? !props.assetAddress : !props.receiptToken) return

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
    const decimals = await getWithdrawDecimals()
    // Full withdraw: pass maxUint256 for lending protocols (ethena/curve keep the exact amount)
    const amountWei = isLendingProtocol.value && isFullWithdraw.value
      ? maxUint256
      : toWei(inputAmount.value, decimals)

    const protocolId = props.protocol?.toLowerCase()


    let hash: string = ''

    switch (protocolId) {
      case 'ethena':
        hash = await ethena?.unstake(amountWei, address.value as `0x${string}`) || ''
        break
      case 'curve':
        // Curve unstake needs assetAddress to determine which stablecoin to withdraw
        hash = await curve?.unstake(amountWei, address.value as `0x${string}`, props.assetAddress) || ''
        break
      case 'aave':
      case 'compound':
      case 'morpho':
      case 'sparklend':
      case 'fluid':
        // Lending protocols: use the lending adapter's withdraw method
        {
          const poolId = (props.selectedItem as any)?.poolId || protocolId || ''
          const adapter = lending.getByPool(poolId || protocolId || '')
          if (!adapter?.withdraw) throw new Error(`Lending protocol ${protocolId} withdraw not implemented`)
          // Morpho/Fluid need pool context; compound needs poolId to locate the comet
          if (protocolId === 'morpho') setMorphoPool(poolId || '')
          if (protocolId === 'fluid') setFluidPool(poolId || '')
          hash = await adapter.withdraw(props.assetAddress || '', amountWei, address.value as `0x${string}`, poolId) || ''
        }
        break
      default:
        hash = await ethena?.unstake(amountWei, address.value as `0x${string}`) || ''
    }


    // Waiting for transaction confirmation to be linked
    const result = await waitForConfirmation(hash, 45000, {
      protocolId: props.protocol?.toLowerCase() || '',
      protocol: props.protocol || '',
      poolId: getBackendPoolId((props.selectedItem as any)?.poolId || props.protocol?.toLowerCase() || '', props.protocol || ''),
      asset: props.asset || '',
      category: 'stablecoin',
      action: 'withdraw',
      amount: inputAmount.value
    })

    if (result.success) {

      // Clear balance cache
      clearCache(address.value, props.receiptToken)

      updateTxSuccess(hash)
      emit('openProcess', true)
    } else if (result.timedOut) {
      txStatus.value = 'timeout'
      txError.value = result.error || ''
    } else {
      updateTxError(result.error || 'Transaction failed on-chain')
    }
  } finally {
    isWithdrawing.value = false
  }
}

// Check Authorization Status
async function checkApprovalStatus() {
  if (!address.value || !props.receiptToken) {
    needsApprove.value = false
    return
  }

  const protocolId = props.protocol?.toLowerCase() || ''

  // Curve uses remove_liquidity_one_coin, no approve needed
  if (protocolId === 'curve') {
    needsApprove.value = false
    return
  }

  // Ethena uses cooldownShares (step 1) and unstake (step 2)
  // cooldownShares needs no approve; call the sUSDe contract directly
  if (protocolId === 'ethena') {
    needsApprove.value = false
    return
  }

  // Lending protocol withdraw needs no approve (handled inside the adapter)
  if (LENDING_PROTOCOLS.includes(protocolId)) {
    needsApprove.value = false
    return
  }

  // Other protocols need an approve check
  // Prioritize props.approveSpender
  // If not, use getSpenderAddress to obtain it
  const spenderAddress = props.approveSpender || getSpenderAddress(protocolId, 'stablecoin', props.receiptToken)

  if (!spenderAddress) {
    needsApprove.value = false
    return
  }

  const decimals = await getTokenDecimals()
  const amountWei = toWei(inputAmount.value || '0', decimals)


  await checkAllowanceStatus(props.receiptToken, address.value as `0x${string}`, spenderAddress, amountWei)
}

// Unified refresh: fetch supply, then compute Available from supply + borrow (Lending protocols)
async function refresh() {
  await fetchBalance()
  if (isLendingProtocol.value) await computeAvailable()
  checkApprovalStatus()
  fetchExchangeRate()
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

// Watch input amount changes
watch(inputAmount, () => {
  // handleMax() also triggers this watcher; keep the full-withdraw intent but still
  // re-run the approval check.
  if (!suppressInputWatch) {
    // User typed a specific amount — the previous Max intent no longer applies
    isFullWithdraw.value = false
  }
  checkApprovalStatus()
})

// Watch protocol changes (exchange rate depends on the protocol)
watch(() => props.protocol, () => {
  isFullWithdraw.value = false
  fetchExchangeRate()
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
</style>
