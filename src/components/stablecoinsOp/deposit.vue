<template>
  <div class="panel">
    <div class="stake-wrapper">
      <div class="row">
        <span>Available to deposit</span>
        <span v-if="address">
          Balance: {{ balanceLoading ? '...' : balance }} {{ asset }}
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

    <PrimaryBtn
      v-if="address"
      :is-loading="isApproving || isDepositing"
      :is-disabled="isApproving || isDepositing"
      @click="handleAction()"
    >
      {{ isApproving ? 'Approving...' : isDepositing ? 'Depositing...' : buttonLabel }}
    </PrimaryBtn>
    <PrimaryBtn v-else @click="walletStore.openConnect()">Connect Wallet</PrimaryBtn>

    <div class="info">
      <div><span>APY</span><span>{{ currentApy === '-' ? '-' : currentApy + '%' }}</span></div>
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
import { computed, ref, watch, onMounted } from 'vue'
import InputBox from './InputBox.vue'
import PrimaryBtn from './PrimaryBtn.vue'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { stablecoin } from "@/chain/stablecoin"
import { lending } from "@/chain/lending"
import { getFluidLiquiditySpender } from "@/chain/lending/fluid"
import { toWei, calculateMaxAmount } from "@/chain/utils/decimals"
import { checkAllowance, approve, getSpenderAddress, useApprove, approveMorphoToken } from "@/chain/utils/approve"
import { getBackendPoolId } from '@/constants/protocols'
import { toast } from "@/utils/toast"
import TxStatusModal from '@/components/TxStatusModal.vue'
import { useBalance } from "@/composables/useBalance"
import { useTxConfirmation } from "@/composables/useTxConfirmation"
import { getAddress } from "viem"
import { publicClient } from "@/chain/core/provider"
import { useTxCost, GAS, APPROVE_GAS } from "@/chain/core/gas"

// Lending protocol IDs (these use lending adapter, not stablecoin)
const LENDING_PROTOCOLS = ['aave', 'compound', 'morpho', 'sparklend', 'fluid']

// Use balance composable (preferential caching, fallback nodes)
const { getBalanceWei, getBalanceReadable, getTokenDecimals: fetchTokenDecimals, clearCache, loading: balanceLoading } = useBalance()

// Confirm hook with transaction
const { waitForConfirmation } = useTxConfirmation()

// Transaction Status Type
type TxStatus = 'pending' | 'success' | 'error'
type TxAction = 'approve' | 'supply' | 'deposit' | 'stake' | 'withdraw' | 'borrow' | 'repay'

// Only import protocols present in mock data: ethena and curve
const ethena = stablecoin.get("ethena")
const curve = stablecoin.get("curve")

const emit = defineEmits<{
  (e: 'openProcess', value: boolean): void
}>()

const props = defineProps<{
  asset?: string             // Asset name (e.g. "USDT", "USDC")
  asseticon?: string
  assetAddress?: string      // Asset Contract Address
  protocol?: string          // Protocol ID (ethena, meth)
  decimals?: number          // Token precision (default 18)
  apy?: string               // APY
  collateralization?: string // Mortgage Status
}>()

const walletStore = useWalletStore()
const { address, isConnected } = storeToRefs(walletStore)

// Status
const inputAmount = ref<string>('')
const balance = ref<string>('0.00')
const balanceWei = ref<bigint>(BigInt(0))

// Use generic approve hook
const { isApproving, needsApprove, approve: approveToken, checkAllowance: checkAllowanceStatus } = useApprove()

// Deposit status
const isDepositing = ref(false)

// Transaction Status Popup
const txModalVisible = ref(false)
const txStatus = ref<TxStatus>('pending')
const txAction = ref<TxAction>('deposit')
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

// Determine whether it is a gas token (USDT/USDC etc. are not)
const isGasToken = computed(() => false)

// Default (downgrade scheme)
const currentApy = computed(() => props.apy || '-')
const currentCollateralization = computed(() => props.collateralization || 'Enabled')
const { txCost: currentTxCost } = useTxCost(APPROVE_GAS + GAS.deposit)

// Button label (changes dynamically based on whether approve is needed)
// Non-ETH transactions require approve by default
const buttonLabel = computed(() => {
  if (!props.assetAddress) return 'Deposit'
  if (isGasToken.value) return 'Deposit'  // ETH needs no approve
  return needsApprove.value ? 'Approve' : 'Deposit'
})

// Initial state: non-ETH transactions require approve by default
needsApprove.value = !isGasToken.value && !!props.assetAddress

// Query Balance (Preferred Cache, Fallback Node)
async function fetchBalance() {
  if (!address.value || !props.assetAddress) {
    balance.value = '0.00'
    balanceWei.value = BigInt(0)
    return
  }

  try {
    const decimals = await getTokenDecimals()
    const wei = await getBalanceWei(address.value, props.assetAddress)
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
  // Prefer to use the precision passed by the parent component
  if (props.decimals !== undefined && props.decimals > 0) {
    return props.decimals
  }

  // Demote: Get using useBalance (preferential cache, fallback node)
  if (props.assetAddress) {
    return await fetchTokenDecimals(props.assetAddress)
  }

  // Last downgrade: default 18
  return 18
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

  const maxAmount = calculateMaxAmount(balanceWei.value, isGasToken.value)

  // Get Accuracy
  const decimals = await getTokenDecimals()

  // Convert to human readable number (rounded down)
  const rawValue = Number(maxAmount) / Math.pow(10, decimals)
  inputAmount.value = Math.floor(rawValue * 1e6) / 1e6
}

// Execute approve (wrapper function)
async function handleApprove() {
  if (!address.value || !props.assetAddress) return

  const protocolId = props.protocol?.toLowerCase() || ''
  const category = LENDING_PROTOCOLS.includes(protocolId) ? 'lending' : 'stablecoin'

  // Show in-progress status
  showTxModal('approve')

  try {
    // Use props.decimals or default 18 directly to avoid delays caused by on-chain queries
    const decimals = props.decimals || 18
    const amountWei = toWei(inputAmount.value, decimals)

    // Morpho USDT: use approveMorphoToken (ERC20 approve to Permit2 + race condition handling)
    if (protocolId === 'morpho' && props.assetAddress) {
      const hash1 = await approveMorphoToken(
        props.assetAddress,
        amountWei,
        address.value as `0x${string}`
      )
      await publicClient.waitForTransactionReceipt({
        hash: hash1 as `0x${string}`,
        timeout: 45000
      })
      needsApprove.value = false
      txModalVisible.value = false
      await handleDeposit()
      return
    }

    // Fluid Liquidity Injection (USDC/USDT → FUSDC/FUSDT): approve to fToken itself;
    // Other assets (e.g. wstETH collateral) use the generic spender resolution
    const spenderAddress = protocolId === 'fluid'
      ? (getFluidLiquiditySpender(props.assetAddress || '') || getSpenderAddress(protocolId, category, props.assetAddress))
      : getSpenderAddress(protocolId, category, props.assetAddress)

    if (!spenderAddress) {
      throw new Error(`No spender address for protocol: ${protocolId}`)
    }


    await approveToken(props.assetAddress, spenderAddress, amountWei, address.value as `0x${string}`)

    // After approve succeeds, run deposit automatically
    needsApprove.value = false
    txModalVisible.value = false

    // Automatically call deposit
    await handleDeposit()
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
      console.error('[Stablecoin Deposit] Approve failed:', error)
      toast.show('Approval failed: ' + (error?.message || 'Unknown error'), 'error')
    }
  }
}

// Handle button clicks (approve or deposit)
async function handleAction() {
  try {
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

    // Get Precision and Convert
    const decimals = await getTokenDecimals()
    const amountWei = toWei(inputAmount.value, decimals)

    // Check whether the amount exceeds the balance
    if (amountWei > balanceWei.value) {
      toast.show('Amount exceeds available balance', 'warning')
      return
    }

    if (needsApprove.value && !isGasToken.value) {
      await handleApprove()
    } else {
      await handleDeposit()
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
      console.error('[Stablecoin] Transaction error:', error)
      updateTxError(error?.message || 'Transaction failed')
    }
  }
}

// Send Deposit Transaction
async function handleDeposit() {
  if (!address.value || !props.assetAddress) return

  isDepositing.value = true

  // Show in-progress status
  showTxModal('deposit')

  try {
    // Get Accuracy
    const decimals = await getTokenDecimals()
    // Convert to Precision Numbers
    const amountWei = toWei(inputAmount.value, decimals)

    // Uniform Conversion to Lowercase
    const protocolId = props.protocol?.toLowerCase()


    let hash: string = ''

    // Select the corresponding contract method according to the protocol (only protocols that exist in Mock are supported)
    switch (protocolId) {
      case 'ethena':
        // Ethena: pass assetAddress to support USDC/USDT/USDe
        hash = await ethena?.stake(amountWei, address.value as `0x${string}`, props.assetAddress) || ''
        break
      case 'curve':
        // Curve: pass assetAddress (though curve.stake does not use this parameter yet)
        hash = await curve?.stake(amountWei, address.value as `0x${string}`, props.assetAddress) || ''
        break
      case 'aave':
      case 'compound':
      case 'morpho':
      case 'sparklend':
      case 'fluid':
        // Lending protocols: use the lending adapter's supply method
        {
          const adapter = lending.get(protocolId)
          if (!adapter?.supply) throw new Error(`Lending protocol ${protocolId} not implemented`)
          hash = await adapter.supply(props.assetAddress || '', amountWei, address.value as `0x${string}`) || ''
        }
        break
      default:
        // Default to ethena
        hash = await ethena?.stake(amountWei, address.value as `0x${string}`, props.assetAddress) || ''
    }


    // Waiting for transaction confirmation to be linked
    const result = await waitForConfirmation(hash, 45000, {
      protocolId: props.protocol?.toLowerCase() || '',
      protocol: props.protocol || '',
      poolId: getBackendPoolId((props.selectedItem as any)?.poolId || props.protocol?.toLowerCase() || '', props.protocol || ''),
      asset: props.asset || '',
      category: 'stablecoin',
      action: 'deposit',
      amount: inputAmount.value
    })

    if (result.success) {

      // Clear the balance cache and it will be retrieved again from the node the next time it is retrieved
      clearCache(address.value, props.assetAddress)

      // Update to Success Status
      updateTxSuccess(hash)
      emit('openProcess', true)
    } else if (result.timedOut) {
      txStatus.value = 'timeout'
      txError.value = result.error || ''
    } else {
      updateTxError(result.error || 'Transaction failed on-chain')
    }
  } finally {
    isDepositing.value = false
  }
}

// Slug: Keep Backward Compatible
const sendToParent = handleDeposit

// Check Authorization Status
async function checkApprovalStatus() {
  if (!address.value || !props.assetAddress || isGasToken.value) {
    needsApprove.value = false
    return
  }

  const protocolId = props.protocol?.toLowerCase() || ''

  // Morpho USDC: use EIP-2612 Permit, no ERC20 approve needed
  if (protocolId === 'morpho') {
    const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
    const usdtAddress = "0xdac17f958d2ee523a2206206994597c13d831ec7"
    const assetAddr = props.assetAddress?.toLowerCase() || ''
    if (assetAddr === usdcAddress) {
      needsApprove.value = false
      return
    }
    // Morpho USDT: check USDT.allowance(user, Permit2)
    if (assetAddr === usdtAddress) {
      // Use checkAllowance to check token allowance to Permit2
      const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
      const decimals = props.decimals || 18
      const amountWei = toWei(inputAmount.value || '0', decimals)
      await checkAllowanceStatus(props.assetAddress, address.value as `0x${string}`, PERMIT2, amountWei)
      return
    }
  }

  const category = LENDING_PROTOCOLS.includes(protocolId) ? 'lending' : 'stablecoin'
  // Fluid Liquidity Injection: approve target is fToken (FUSDC/FUSDT)
  const spenderAddress = protocolId === 'fluid'
    ? (getFluidLiquiditySpender(props.assetAddress || '') || getSpenderAddress(protocolId, category, props.assetAddress))
    : getSpenderAddress(protocolId, category, props.assetAddress)

  if (!spenderAddress) {
    needsApprove.value = false
    return
  }

  // Get decimals and amount
  const decimals = props.decimals || 18
  const amountWei = toWei(inputAmount.value || '0', decimals)

  // Use checkAllowance to check the actual authorization status
  await checkAllowanceStatus(props.assetAddress, address.value as `0x${string}`, spenderAddress, amountWei)
}

// Listen for address changes, re-query balance and authorization status
watch(address, () => {
  fetchBalance()
  checkApprovalStatus()
})

// Monitor asset changes, re-query balance and authorization status
watch(() => props.assetAddress, () => {
  fetchBalance()
  checkApprovalStatus()
})

// Watch input amount changes and re-check approval status
watch(inputAmount, () => {
  checkApprovalStatus()
})

onMounted(() => {
  fetchBalance()
  // Check Authorization Status
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
</style>
