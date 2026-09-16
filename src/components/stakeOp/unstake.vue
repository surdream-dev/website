<template>
  <div class="panel">
    <div class="stake-wrapper">
      <div class="row">
        <span>Unstake</span>
        <span v-if="address">
          Balance: {{ balanceLoading ? '...' : balance }} {{ receiptTokenSymbol || 'stETH' }}
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
          <img :src="receiptTokenIcon"/>
          <span>{{ receiptTokenSymbol || 'stETH' }}</span>
        </div>
      </div>
    </div>

    <div v-if="isBelowMinimum" class="min-amount-hint">
      Must unstake at least {{ minUnstakeAmount }} {{ receiptTokenSymbol }}
    </div>

    <div v-if="isInsufficientLiquidity" class="min-amount-hint">
      Insufficient liquidity
    </div>

    <div class="receive-wrapper">
      <div class="row">
        <span>You will receive</span>
      </div>
      <div class="input-wrapper">
        <InputBox :modelValue="receiveAmount" readonly />
        <div class="token-wrapper">
          <img :src="outputTokenIcon"/>
          <span>ETH</span>
        </div>
      </div>
    </div>

    <!-- Unstake method selection -->
    <div class="unstake-path">
      <div @click="unstakeMode = 'protocol'" :class="unstakeMode === 'protocol' ? 'item active':'item'">
        <div class="title">
          <span>Use Protocol</span>
          <img :src="protocolIcon"/>
        </div>
        <div class="text">
          <span>Rate</span>
          <span>{{ exchangeRateDisplay }}</span>
        </div>
        <div class="text">
          <span>Waiting time:</span>
          <span>{{ unstakePeriod }}</span>
        </div>
      </div>
      <div @click="unstakeMode = 'dex'" :class="unstakeMode === 'dex' ? 'item active':'item'">
        <div class="title">
          <span>Use DEXs</span>
          <img class="dexs" src="@/assets/logos/dexs.svg"/>
        </div>
        <div class="text">
          <span>Best Rate</span>
          <span></span>
        </div>
        <div class="text">
          <span>Waiting time:</span>
          <span>~1-5 mins</span>
        </div>
      </div>
    </div>

    <PrimaryBtn
      v-if="address"
      :is-loading="isApproving || isUnstaking"
      :is-disabled="isApproving || isUnstaking || isBelowMinimum || isInsufficientLiquidity"
      @click="handleAction()"
    >
      {{ isApproving ? 'Approving...' : isUnstaking ? 'Unstaking...' : buttonLabel }}
    </PrimaryBtn>
    <PrimaryBtn v-else @click="walletStore.openConnect()">Connect Wallet</PrimaryBtn>

    <!-- Protocol unstake info -->
    <div v-if="unstakeMode === 'protocol'" class="info">
      <div><span>Max unlock cost</span><span>{{ unlockCost }}</span></div>
      <div><span>Max transaction cost</span><span>{{ txCost }}</span></div>
      <div><span>Exchange rate</span><span>{{ exchangeRateDisplay }}</span></div>
    </div>

    <!-- DEX list -->
    <div v-else class="dex-list">
      <div class="item" @click="openDex('1inch')">
        <img src="@/assets/logos/1inch.svg"/>
        <span>1inch</span>
      </div>
      <!-- Bebop has no pairs for these tokens (hidden): eETH/rETH/osETH/mETH/ETHx -->
      <div v-if="!isUnsupportedBebopToken" class="item" @click="openDex('bebop')">
        <img src="@/assets/logos/bebop.svg"/>
        <span>Bebop</span>
      </div>
      <div class="item" @click="openDex('jumper')">
        <img src="@/assets/logos/jumper.svg"/>
        <span>Jumper</span>
      </div>
    </div>

    <!-- Transaction Status Popup -->
    <TxStatusModal
      :visible="txModalVisible"
      :status="txStatus"
      :action="txAction"
      :txHash="txHash"
      :errorMessage="txError"
      :amount="inputAmount"
      :asset="receiptTokenSymbol"
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
import { stake } from "@/chain/stake"
import type { UnstakeLiquidity } from "@/chain/stake/base"
import { toWei, fromWei } from "@/chain/utils/decimals"
import { useApprove, getSpenderAddress } from "@/chain/utils/approve"
import { toast } from "@/utils/toast"
import TxStatusModal from '@/components/TxStatusModal.vue'
import { useBalance } from "@/composables/useBalance"
import { useTxConfirmation } from "@/composables/useTxConfirmation"
import { ADDRESSES } from "@/chain/evm/addresses"
import { useTxCost, GAS } from "@/chain/core/gas"

// Use balance composable
const { getBalanceWei, getTokenDecimals: fetchTokenDecimals, clearCache, loading: balanceLoading } = useBalance()

// Confirm hook with transaction
const { waitForConfirmation } = useTxConfirmation()

// Transaction Status Type
type TxStatus = 'pending' | 'success' | 'error'
type TxAction = 'approve' | 'unstake'

// Protocol Adapter
const lido = stake.get("lido")
const etherfi = stake.get("etherfi")
const rocketpool = stake.get("rocketpool")
const stakewise = stake.get("stakewise")
const meth = stake.get("meth")
const stader = stake.get("stader")

const emit = defineEmits<{
  (e: 'openProcess', value: boolean, amount?: string, asset?: string): void
}>()

const props = defineProps<{
  protocol?: string
  receiptToken?: string      // Token address (e.g. stETH, rETH)
  receiptTokenSymbol?: string // Voucher token symbol
  unstakePeriod?: string     // unstake wait time
  exchangeRate?: number      // Exchange rate
}>()

const walletStore = useWalletStore()
const { address, isConnected } = storeToRefs(walletStore)

// Status
const inputAmount = ref<string>('')
const balance = ref<string>('0.00')
const balanceWei = ref<bigint>(BigInt(0))
const unstakeMode = ref<'protocol' | 'dex'>('protocol')
const dynamicRate = ref<number>(1)

// Use generic approve hook
const { isApproving, needsApprove, approve: approveToken, checkAllowance: checkAllowanceStatus } = useApprove()

// Unstake status
const isUnstaking = ref(false)

// Transaction Status Popup
const txModalVisible = ref(false)
const txStatus = ref<TxStatus>('pending')
const txAction = ref<TxAction>('unstake')
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

// Agreement ID
const protocolId = computed(() => {
  return props.protocol?.toLowerCase().replace(/[\s.]/g, '') || 'lido'
})

// Protocol config
const protocolConfig: Record<string, {
  receiptToken: string
  receiptTokenSymbol: string
  icon: string
  unstakePeriod: string
}> = {
  lido: { receiptToken: ADDRESSES.lido.stETH, receiptTokenSymbol: 'stETH', icon: 'lido.svg', unstakePeriod: '1–5 days' },
  etherfi: { receiptToken: ADDRESSES.etherfi.weETH, receiptTokenSymbol: 'weETH', icon: 'weeth.webp', unstakePeriod: '~1 day' },
  rocketpool: { receiptToken: ADDRESSES.rocketpool.rETH, receiptTokenSymbol: 'rETH', icon: 'rocketpool.svg', unstakePeriod: 'Varies' },
  stakewise: { receiptToken: ADDRESSES.stakewise.osETH, receiptTokenSymbol: 'osETH', icon: 'stakewise.svg', unstakePeriod: '≥24 hours' },
  meth: { receiptToken: ADDRESSES.meth.mETH, receiptTokenSymbol: 'mETH', icon: 'meth.svg', unstakePeriod: '12h–7.5 days' },
  stader: { receiptToken: ADDRESSES.stader.ethx, receiptTokenSymbol: 'ETHx', icon: 'stader.svg', unstakePeriod: '7–10 days' }
}

// Current protocol config
const currentConfig = computed(() => {
  return protocolConfig[protocolId.value] || protocolConfig.lido
})

// Receipt token info
// StakeWise's backend API returns an incorrect osETH contract address; force the frontend-hardcoded ADDRESSES value
const receiptToken = computed(() => {
  if (protocolId.value === 'stakewise') return currentConfig.value.receiptToken
  return props.receiptToken || currentConfig.value.receiptToken
})
const receiptTokenSymbol = computed(() => props.receiptTokenSymbol || currentConfig.value.receiptTokenSymbol)
const unstakePeriod = computed(() => props.unstakePeriod || currentConfig.value.unstakePeriod)

// Icon
const receiptTokenIcon = computed(() => {
  const icons = import.meta.glob('@/assets/logos/*.{svg,webp}', { eager: true, import: 'default' })
  const iconFileName = currentConfig.value.icon
  for (const [path, icon] of Object.entries(icons)) {
    if (path.endsWith(iconFileName)) {
      return icon as string
    }
  }
  return ''
})

const protocolIcon = computed(() => receiptTokenIcon.value)
const outputTokenIcon = computed(() => {
  const icons = import.meta.glob('@/assets/logos/*.svg', { eager: true, import: 'default' })
  for (const [path, icon] of Object.entries(icons)) {
    if (path.endsWith('eth.svg')) {
      return icon as string
    }
  }
  return ''
})

// Default Value
const unlockCost = computed(() => protocolId.value === 'lido' ? 'FREE' : '$0.10')
const { txCost } = useTxCost(GAS.unstake)

// Exchange rate display (all protocols take on-chain real-time exchange rate)
const exchangeRateDisplay = computed(() => {
  return `1 ${receiptTokenSymbol.value} ≈ ${dynamicRate.value.toFixed(4)} ETH`
})

// Minimum unstake amount per protocol (protocol path only, DEX swap has no minimum)
const MIN_UNSTAKE_AMOUNT: Record<string, number> = {
  etherfi: 0.001,  // "Must unstake at least 0.001 weETH."
  meth: 0.01,      // "Must unstake at least 0.01 mETH."
}
const minUnstakeAmount = computed(() => MIN_UNSTAKE_AMOUNT[protocolId.value])

// Below minimum → show hint + block submit (only for the protocol path)
const isBelowMinimum = computed(() => {
  if (unstakeMode.value !== 'protocol') return false
  const min = minUnstakeAmount.value
  if (!min) return false
  const inputNum = parseFloat(inputAmount.value) || 0
  return inputNum > 0 && inputNum < min
})

// --- Rocket Pool unstake liquidity pre-check (on-chain, mirrors burn revert) ---
const unstakeLiquidity = ref<UnstakeLiquidity | undefined>(undefined)
// Only the protocol path for Rocket Pool burns its own pool; DEX path uses Bebop/1inch instead
const isLiquidityCheckable = computed(() => protocolId.value === 'rocketpool' && unstakeMode.value === 'protocol')

async function fetchLiquidity() {
  unstakeLiquidity.value = undefined
  if (!isLiquidityCheckable.value) return
  const inputNum = parseFloat(inputAmount.value) || 0
  if (inputNum <= 0) return
  try {
    const decimals = await getTokenDecimals()
    unstakeLiquidity.value = await rocketpool?.getUnstakeLiquidity?.(toWei(inputAmount.value, decimals))
  } catch (e) {
    console.warn('[Unstake] Failed to fetch liquidity:', e)
    unstakeLiquidity.value = undefined
  }
}

// Insufficient pool liquidity → show "Insufficient liquidity" hint + block submit
const isInsufficientLiquidity = computed(() => {
  if (!isLiquidityCheckable.value) return false
  return unstakeLiquidity.value?.insufficient === true
})

// Tokens not supported by Bebop (Bebop has no corresponding pair)
// ETHx: Stader removed the ETHx pool from Bebop, so the DEX no longer lists it
const unsupportedBebopTokens = ['eETH', 'rETH', 'osETH', 'mETH', 'ETHx']

// Check whether the current token is unsupported by Bebop
const isUnsupportedBebopToken = computed(() => {
  const symbol = receiptTokenSymbol.value || ''
  return unsupportedBebopTokens.includes(symbol)
})

// DEX link config - build the swap link from protocol and token
// ETH address (zero address represents native ETH)
const ETH_ADDRESS = '0x0000000000000000000000000000000000000000'

// Bebop pair IDs are case-sensitive token symbols:
// stETH / weETH keep their official case; Stader's ETHx is listed as ETHX on Bebop
const bebopTokenIds: Record<string, string> = {
  stETH: 'stETH',
  weETH: 'weETH',
  ETHx: 'ETHX',
}

const dexLinks: Record<string, (tokenSymbol: string, tokenAddress: string) => string> = {
  // 1inch: src=chainId:tokenSymbol, dst=chainId:ETH
  '1inch': (tokenSymbol, _tokenAddress) => `https://1inch.com/swap?src=1:${tokenSymbol}&dst=1:ETH`,
  // Bebop: network=ethereum, sell=token, buy=ETH (token symbol is case-sensitive)
  'bebop': (tokenSymbol, _tokenAddress) => `https://trade.bebop.xyz/?network=ethereum&sell=${bebopTokenIds[tokenSymbol] ?? tokenSymbol}&buy=ETH`,
  // Jumper: fromChain=1, fromToken=tokenAddress, toChain=1, toToken=ETH_ADDRESS
  'jumper': (_tokenSymbol, tokenAddress) => `https://jumper.xyz/?fromChain=1&fromToken=${tokenAddress}&toChain=1&toToken=${ETH_ADDRESS}`
}

// Open the DEX swap link
function openDex(dexName: string) {
  const tokenSymbol = receiptTokenSymbol.value || 'stETH'
  const tokenAddress = receiptToken.value || ADDRESSES.lido.stETH
  const linkGenerator = dexLinks[dexName]
  if (linkGenerator) {
    const link = linkGenerator(tokenSymbol, tokenAddress)
    window.open(link, '_blank')
  }
}

// Receive amount
const receiveAmount = computed(() => {
  const inputNum = parseFloat(inputAmount.value) || 0
  return Math.floor(inputNum * dynamicRate.value * 1e6) / 1e6
})

// Button Label
const buttonLabel = computed(() => {
  if (unstakeMode.value === 'dex') return 'Swap'
  return needsApprove.value ? 'Approve' : 'Unstake'
})

// Get the live exchange rate (Unstake: 1 token → X ETH, each protocol uses its native method, see adapter.getUnstakeRate)
async function fetchDynamicRate() {
  const adapter = stake.get(protocolId.value)
  if (!adapter?.getUnstakeRate) {
    dynamicRate.value = 1
    return
  }
  try {
    dynamicRate.value = await adapter.getUnstakeRate()
  } catch (error) {
    console.warn('[Unstake] Failed to fetch rate:', error)
    dynamicRate.value = 1
  }
}

// Query voucher token balance
async function fetchBalance() {
  if (!address.value) {
    balance.value = '0.00'
    balanceWei.value = BigInt(0)
    return
  }

  try {
    const decimals = await getTokenDecimals()
    const wei = await getBalanceWei(address.value, receiptToken.value)
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
  if (receiptToken.value) {
    return await fetchTokenDecimals(receiptToken.value)
  }
  return 18
}

// Max Button Handling
async function handleMax() {
  if (balanceLoading.value) {
    toast.show('Fetching balance, please wait...', 'warning')
    return
  }

  if (!balanceWei.value || balanceWei.value <= BigInt(0)) {
    toast.show('No balance available', 'warning')
    return
  }

  const decimals = await getTokenDecimals()
  const rawValue = Number(balanceWei.value) / Math.pow(10, decimals)
  inputAmount.value = Math.floor(rawValue * 1e6) / 1e6
}

// Execute approve
async function handleApprove() {
  if (!address.value || !receiptToken.value) return

  // Stader unstake requires approve ETHx to unstakeManager
  let spenderAddress: string
  if (protocolId.value === 'stader') {
    spenderAddress = ADDRESSES.stader.unstakeManager
  } else {
    spenderAddress = getSpenderAddress(protocolId.value, 'stake', receiptToken.value)
  }

  if (!spenderAddress) {
    // Most protocols need no approve; unstake directly
    needsApprove.value = false
    return
  }

  showTxModal('approve')

  try {
    const decimals = await getTokenDecimals()
    let amountWei = toWei(inputAmount.value, decimals)

    // Stader requires approving slightly more than the actual unstake amount
    // Add a 1% buffer for potential exchange rate changes or fees
    if (protocolId.value === 'stader') {
      const bufferAmount = amountWei + (amountWei / 100n)  // +1% buffer
      amountWei = bufferAmount
    }

    await approveToken(receiptToken.value, spenderAddress, amountWei, address.value as `0x${string}`)

    // After approve succeeds, switch directly to unstake state (without closing the modal)
    needsApprove.value = false
    txStatus.value = 'pending'
    txAction.value = 'unstake'
    txHash.value = ''
    txError.value = ''
    // Continue unstake directly without closing the modal

    await handleUnstake()
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
      console.error('[Unstake] Approve failed:', error)
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

    if (amountWei > balanceWei.value) {
      toast.show('Amount exceeds available balance', 'warning')
      return
    }

    // Minimum unstake amount check (protocol path only)
    if (isBelowMinimum.value) {
      toast.show(`Must unstake at least ${minUnstakeAmount.value} ${receiptTokenSymbol.value}`, 'warning')
      return
    }

    if (unstakeMode.value === 'dex') {
      toast.show('DEX swap coming soon...', 'warning')
      return
    }

    // Re-check approve status (based on the current input amount)
    await checkApprovalStatus()

    if (needsApprove.value) {
      await handleApprove()
    } else {
      await handleUnstake()
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
      console.error('[Unstake] Transaction error:', error)
      updateTxError(error?.message || 'Transaction failed')
    }
  }
}

// Send the unstake transaction
async function handleUnstake() {
  if (!address.value) {
    throw new Error("Wallet not connected")
  }

  isUnstaking.value = true

  // Only update the status if the popup is open (switched from approve); otherwise reopen
  if (!txModalVisible.value) {
    showTxModal('unstake')
  } else {
    // Modal already open; switch directly to unstake state
    txAction.value = 'unstake'
    txStatus.value = 'pending'
    txHash.value = ''
    txError.value = ''
  }

  try {
    const decimals = await getTokenDecimals()
    const amountWei = toWei(inputAmount.value, decimals)

    // StakeWise debug: print input value, decimals, and computed wei
    if (protocolId.value === 'stakewise') {
    }


    let hash: string = ''

    switch (protocolId.value) {
      case 'lido':
        hash = await lido?.unstake(amountWei, address.value as `0x${string}`) || ''
        break
      case 'etherfi':
        hash = await etherfi?.unstake(amountWei, address.value as `0x${string}`) || ''
        break
      case 'rocketpool':
        hash = await rocketpool?.unstake(amountWei, address.value as `0x${string}`) || ''
        break
      case 'stakewise':
        hash = await stakewise?.unstake(amountWei, address.value as `0x${string}`) || ''
        break
      case 'meth':
        hash = await meth?.unstake(amountWei, address.value as `0x${string}`) || ''
        break
      case 'stader':
        hash = await stader?.unstake(amountWei, address.value as `0x${string}`) || ''
        break
      default:
        hash = await lido?.unstake(amountWei, address.value as `0x${string}`) || ''
    }


    // Waiting for transaction confirmation to be linked
    const result = await waitForConfirmation(hash, 45000, {
      protocolId: protocolId.value,
      protocol: props.protocol || protocolId.value,
      asset: props.receiptTokenSymbol || 'stETH',
      category: 'staking',
      action: 'unstake',
      amount: inputAmount.value
    })

    if (result.success) {

      clearCache(address.value, receiptToken.value)

      updateTxSuccess(hash)
      emit('openProcess', true, inputAmount.value, props.receiptTokenSymbol || 'stETH')
    } else if (result.timedOut) {
      txStatus.value = 'timeout'
      txError.value = result.error || ''
    } else {
      updateTxError(result.error || 'Transaction failed on-chain')
    }
  } finally {
    isUnstaking.value = false
  }
}

// Check Authorization Status
async function checkApprovalStatus() {
  if (!address.value || !receiptToken.value) {
    needsApprove.value = false
    return
  }

  const protocol = protocolId.value

  // StakeWise unstake uses osETH multicall(burnOsToken), no approve needed
  // mETH unstake uses unstakeRequestWithPermit, embedding the Permit signature in the tx; no upfront approve needed
  // Rocket Pool unstake uses rETH burn(uint256), no approve needed
  if (protocol === 'stakewise' || protocol === 'meth' || protocol === 'rocketpool') {
    needsApprove.value = false
    return
  }

  const spenderAddress = getSpenderAddress(protocol, 'stake', receiptToken.value)

  // Stader unstake requires approve ETHx to unstakeManager
  // spender: unstakeManager (0x9F0491B32DBce587c50c4C43AB303b06478193A7)
  let spender: string
  if (protocol === 'stader') {
    spender = ADDRESSES.stader.unstakeManager
  } else {
    spender = spenderAddress
  }

  if (!spender) {
    needsApprove.value = false
    return
  }

  const decimals = await getTokenDecimals()
  const amountWei = toWei(inputAmount.value || '0', decimals)

  await checkAllowanceStatus(receiptToken.value, address.value as `0x${string}`, spender as `0x${string}`, amountWei)
}

// Listen for address changes
watch(address, () => {
  fetchBalance()
  fetchDynamicRate()
  checkApprovalStatus()
})

// Watch protocol changes
watch(protocolId, () => {
  fetchBalance()
  fetchDynamicRate()
  checkApprovalStatus()
  fetchLiquidity()
})

// Re-check liquidity as the amount or unstake path changes
watch([inputAmount, unstakeMode], () => {
  fetchLiquidity()
})

onMounted(() => {
  fetchBalance()
  fetchDynamicRate()
  checkApprovalStatus()
  fetchLiquidity()
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
  margin-bottom: 10px;
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
.min-amount-hint {
  color: #FF6B6B;
  font-family: Inter;
  font-size: 11px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  letter-spacing: -0.22px;
  margin: 0 0 10px;
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
.unstake-path {
  display:flex;
  align-items: center;
  gap:6px;
  margin-bottom:10px;
}
.unstake-path .item {
  display: flex;
  flex-direction: column;
  width: 50%;
  height: 104px;
  padding: 10.5px 12.5px 8.5px 12.5px;
  align-items: center;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: var(--High-Fidelity-Color-Card-Background, rgba(255, 255, 255, 0.02));
  cursor: pointer;
}
.unstake-path .item.active {
  border-radius: 18px;
  border: 1px solid var(--gold, #C49A4C);
  background: var(--High-Fidelity-Color-Card-Background, rgba(255, 255, 255, 0.02));
}
.unstake-path .item .title {
  width:100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.unstake-path .item .title img{
  width:30px;
  height:30px;
}
.unstake-path .item .title .dexs{
  width:75px;
  height:30px;
}
.unstake-path .item .title span {
  color: #FFF;
  font-family: Inter;
  font-size: 15px;
  font-style: normal;
  font-weight: 600;
  line-height: 150%;
  letter-spacing: -0.15px;
}
.unstake-path .item .text {
  width:100%;
  display: flex;
  justify-content: space-between;
  color: #FFF;
  font-family: Inter;
  font-size: 11px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  letter-spacing: -0.11px;
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
.dex-list{
  display: flex;
  margin-top:20px;
  padding: 7.711px;
  align-items: center;
  flex-direction: column;
  gap: 12px;
  align-self: stretch;
}
.dex-list .item {
  padding: 6px 11px;
  width: 100%;
  height: 62px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: var(--High-Fidelity-Color-Card-Background, rgba(255, 255, 255, 0.02));
  display: flex;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease;
}
.dex-list .item:hover {
  border-color: var(--gold, #C49A4C);
  background: rgba(255, 255, 255, 0.05);
}
.dex-list .item img{
  width: 50px;
  height: 50px;
  flex-shrink: 0;
}
.dex-list .item span{
  color: #FFF;
  font-family: Inter;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  letter-spacing: -0.14px;
  margin-left:22px;
}
</style>
