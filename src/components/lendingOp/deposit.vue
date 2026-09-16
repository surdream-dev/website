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

    <div v-if="health.hint" :class="['health-hint', health.hint.level]">
      {{ health.hint.message }}
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
      <div v-if="showHF" class="hf-row">
        <span class="hf-title">Health Factor{{ health.isAccountLevel ? ' · ' + health.scope : '' }}</span>
        <span :class="['hf-value', health.riskLevel]">{{ health.hfText }}</span>
      </div>
      <div><span>APY</span><span>{{ currentSupplyApy === '-' ? '-' : currentSupplyApy + '%' }}</span></div>
      <div><span>Utilization</span><span>{{ currentUtilization === '-' ? '-' : currentUtilization }}</span></div>
      <div><span>Max LTV</span><span>{{ currentMaxLtv === '-' ? '-' : currentMaxLtv + '%' }}</span></div>
      <div><span>Liquidation Threshold</span><span>{{ currentLiquidationThreshold === '-' ? '-' : currentLiquidationThreshold + '%' }}</span></div>
      <div><span>Liquidation Penalty</span><span>{{ currentLiquidationPenalty === '-' ? '-' : currentLiquidationPenalty + '%' }}</span></div>
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
import InputBox from './InputBox.vue'
import PrimaryBtn from './PrimaryBtn.vue'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { lending } from "@/chain/lending"
import { toWei, calculateMaxAmount } from "@/chain/utils/decimals"
import { checkAllowance, approve, getSpenderAddress, checkMorphoAllowance, approveMorphoToken, useApprove, getApproveTokenAddress } from "@/chain/utils/approve"
import { ADDRESSES } from "@/chain/evm/addresses"
import { toast } from "@/utils/toast"
import TxStatusModal from '@/components/TxStatusModal.vue'
import { useBalance } from "@/composables/useBalance"
import { useTxConfirmation } from "@/composables/useTxConfirmation"
import { publicClient } from "@/chain/core/provider"
import { getAddress } from "viem"
import { useTxCost, GAS, APPROVE_GAS } from "@/chain/core/gas"
import { setFluidPool, getFluidLiquiditySpender } from "@/chain/lending/fluid"
import { setMorphoPool } from "@/chain/lending/morpho"
import { isLiquidityAsset, getBackendPoolId } from '@/constants/protocols'
import { useLendingHealth } from '@/composables/useLendingHealth'

// Use balance composable (preferential caching, fallback nodes)
const { getBalanceWei, getBalanceReadable, getTokenDecimals: fetchTokenDecimals, clearCache, loading: balanceLoading } = useBalance()

// Confirm hook with transaction
const { waitForConfirmation } = useTxConfirmation()

// Transaction Status Type
type TxStatus = 'pending' | 'success' | 'error'
type TxAction = 'approve' | 'supply' | 'deposit' | 'stake' | 'withdraw' | 'borrow' | 'repay' | 'wrap'

// Only import protocols that exist in Mock data
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
  protocol?: string          // Protocol ID (aave, compound, morpho, etc.)
  poolId?: string            // Pool ID (Flattened primary key)
  decimals?: number          // Token precision (default 18)
  supplyApy?: string         // Supply APY
  utilization?: string       // Pool utilization
  collateralization?: string // Mortgage Status
  maxLtv?: string            // Maximum LTV
  liquidationThreshold?: string // Liquidation Threshold
  liquidationPenalty?: string   // Liquidation Penalty
}>()

const walletStore = useWalletStore()
const { address, isConnected } = storeToRefs(walletStore)

// Status
const inputAmount = ref<string>('')
const balance = ref<string>('0.00')
const balanceWei = ref<bigint>(BigInt(0))

// Use generic approve hook
const { isApproving, needsApprove, approve: approveToken, checkAllowance: checkAllowanceStatus, checkMorphoAllowance, approveMorphoToken } = useApprove()

// Deposit status
const isDepositing = ref(false)

// Input anti-shake timer
let approveDebounceTimer: ReturnType<typeof setTimeout> | null = null

function debouncedCheckApproval() {
  if (approveDebounceTimer) clearTimeout(approveDebounceTimer)
  approveDebounceTimer = setTimeout(() => {
    if (isSparkLendETH.value) {
      checkSparkLendETHStatus()
    } else {
      checkApprovalStatus()
    }
  }, 300)
}

onUnmounted(() => {
  if (approveDebounceTimer) clearTimeout(approveDebounceTimer)
})

// Transaction Status Popup
const txModalVisible = ref(false)
const txStatus = ref<TxStatus>('pending')
const txAction = ref<TxAction>('supply')
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
const currentSupplyApy = computed(() => props.supplyApy || '-')
const currentUtilization = computed(() => props.utilization || '-')
const currentCollateralization = computed(() => props.collateralization || 'Enabled')
const currentMaxLtv = computed(() => props.maxLtv || '-')
const currentLiquidationThreshold = computed(() => props.liquidationThreshold || '-')
const currentLiquidationPenalty = computed(() => props.liquidationPenalty || '-')
const { txCost: currentTxCost } = useTxCost(APPROVE_GAS + GAS.supply)

const protocolId = computed(() => props.protocol?.toLowerCase().replace(/[\s.]/g, '') || '')
// Liquidity positions (fToken, e.g. Compound/Morpho/Fluid USDC-USDT) are not vault collateral —
// supplying them never changes health factor, so HF is neither fetched nor shown for them.
const isLiquidity = computed(() => isLiquidityAsset(props.poolId || '', props.asset || ''))
const health = useLendingHealth({
  account: () => address.value || '',
  protocol: () => protocolId.value,
  poolId: () => props.poolId,
  assetAddress: () => props.assetAddress,
  action: 'supply',
  amount: inputAmount,
  enabled: () => !isLiquidity.value,
})
const showHF = computed(() => !isLiquidity.value && health.hasDebt)

// SparkLend ETH Judgment
const isSparkLendETH = computed(() => {
  return props.protocol?.toLowerCase() === 'sparklend' && isGasToken.value
})

// Button label (dynamically changes depending on whether approve/wrap is required)
// SparkLend ETH: Wrap → Approve → Supply
// Non-ETH transactions require approve by default
const buttonLabel = computed(() => {
  if (!props.assetAddress) return 'Supply'

  // ETH (incl. SparkLend) uses the native depositETH path — no wrap/approve needed
  if (isGasToken.value) return 'Supply'
  return needsApprove.value ? 'Approve' : 'Supply'
})

// Check SparkLend ETH Process Status
// SparkLend ETH uses the native WETH_Gateway.depositETH path:
// a single transaction that wraps + supplies native ETH — no wrap/approve needed.
async function checkSparkLendETHStatus() {
  if (!isSparkLendETH.value || !address.value) return

  needsApprove.value = false
}

// Query Balance (Preferred Cache, Fallback Node)
async function fetchBalance() {
  if (!address.value || !props.assetAddress) {
    balance.value = '0.00'
    balanceWei.value = BigInt(0)
    return
  }

  try {
    const decimals = await getTokenDecimals()
    // ETH (incl. SparkLend) is always supplied as native ETH (depositETH), so query the native
    // balance even when assetAddress is the WETH address (e.g. opened from "Your Supplies", where
    // discoverPositions keeps the on-chain WETH address but displays it as ETH). This keeps the
    // max-suppliable amount consistent with the "Asset to Supply" entry.
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
  if (!address.value) return

  const protocolId = props.protocol?.toLowerCase() || ''

  // Show in-progress status
  showTxModal('approve')

  try {
    // Use props.decimals or default 18 directly to avoid delays caused by on-chain queries
    const decimals = props.decimals || 18
    const amountWei = toWei(inputAmount.value, decimals)


    // SparkLend ETH: approve WETH (ETH has been wrapped)
    let approveTokenAddress = props.assetAddress
    if (isSparkLendETH.value) {
      // After ETH wrapped, approve WETH
      approveTokenAddress = ADDRESSES.tokens.WETH
    }

    // Morpho Process: ERC20 approve token
    if (protocolId === 'morpho' && approveTokenAddress) {
      // WBTC/weth/wstETH as collateral for Morpho Blue: approve Morpho_blue
      const MORPHO_BLUE_ADDR = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"
      const wbtcAddr = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"
      const wethAddr = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
      const wstethAddr = "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0"
      const asset = approveTokenAddress.toLowerCase()
      const isBlueCollateral = asset === wbtcAddr || asset === wethAddr || asset === wstethAddr

      if (isBlueCollateral) {
        // Morpho Blue Collateral: approve Morpho_blue
        await approveToken(approveTokenAddress, MORPHO_BLUE_ADDR, amountWei, address.value as `0x${string}`)
      } else {
        // USDT et al Vault Deposit Path: approve Permit2
        const hash1 = await approveMorphoToken(
          approveTokenAddress,
          amountWei,
          address.value as `0x${string}`
        )
        await publicClient.waitForTransactionReceipt({
          hash: hash1 as `0x${string}`,
          timeout: 45000
        })
      }

      needsApprove.value = false
      // Switch directly to the supply state without closing the pop-up window
      txStatus.value = 'pending'
      txAction.value = 'supply'
      txHash.value = ''
      txError.value = ''

      // Automatic execution of deposit (internal will request permit signature + send multicall)
      await handleDeposit()
      return
    }

    // Other protocols use the standard ERC20 approve
    // Fluid Liquidity Injection (USDC/USDT → FUSDC/FUSDT): approve to fToken itself;
    // The remaining assets (wstETH collateral, etc.) go through general spender analysis
    const spenderAddress = protocolId === 'fluid'
      ? (getFluidLiquiditySpender(approveTokenAddress || '') || getSpenderAddress(protocolId, 'lending', approveTokenAddress, false, props.poolId))
      : getSpenderAddress(protocolId, 'lending', approveTokenAddress, false, props.poolId)
    if (!spenderAddress) {
      throw new Error(`No spender address for protocol: ${protocolId}`)
    }

    await approveToken(approveTokenAddress || '', spenderAddress, amountWei, address.value as `0x${string}`)

    // After Approve is successful, switch directly to the supply state (without closing the pop-up)
    needsApprove.value = false
    txStatus.value = 'pending'
    txAction.value = 'supply'
    txHash.value = ''
    txError.value = ''
    // Continue directly to deposit without closing the pop-up window

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
      console.error('[Lending Deposit] Approve failed:', error)
      toast.show('Approval failed: ' + (error?.message || 'Unknown error'), 'error')
    }
  }
}

// Process button click (wrap/approve/deposit)
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

    // Check if the balance is exceeded (ETH needs to retain Gas)
    const maxWei = calculateMaxAmount(balanceWei.value, isGasToken.value)
    if (amountWei > maxWei) {
      toast.show('Amount exceeds available balance', 'warning')
      return
    }

    // SparkLend ETH: native depositETH — single tx, no wrap/approve
    if (isSparkLendETH.value) {
      await handleDeposit()
      return
    }

    // Other protocols: Automatic deposit after approve
    // handleDeposit will be called automatically after handleApprove internal success, no external re-tuning is required
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
      console.error('[Lending] Transaction error:', error)
      updateTxError(error?.message || 'Transaction failed')
    }
  }
}

// Send Deposit Transaction
async function handleDeposit() {
  if (!address.value || !props.assetAddress) {
    throw new Error("Wallet not connected or asset address missing")
  }

  isDepositing.value = true

  // Only update the status if the popup is open (switched from approve); otherwise reopen
  if (!txModalVisible.value) {
    showTxModal('supply')
  } else {
    // The pop-up window is open, directly switch to the supply state
    txAction.value = 'supply'
    txStatus.value = 'pending'
    txHash.value = ''
    txError.value = ''
  }

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
      case 'aave':
        hash = await aave?.supply(props.assetAddress, amountWei, address.value as `0x${string}`) || ''
        break
      case 'compound':
        // Select the correct comet according to poolId (Compound V3 each pool is independent)
        const poolToComet: Record<string, string> = {
          'compound-eth': ADDRESSES.lending.compound.cometWETH,
          'compound-usdc': ADDRESSES.lending.compound.cometUSDC,
          'compound-usdt': ADDRESSES.lending.compound.cometUSDT,
        }
        const cometAddress = (props.poolId && poolToComet[props.poolId]) || undefined
        hash = await compound?.supply(props.assetAddress, amountWei, address.value as `0x${string}`, cometAddress) || ''
        break
      case 'morpho':
        setMorphoPool(props.poolId || '')
        hash = await morpho?.supply(props.assetAddress, amountWei, address.value as `0x${string}`) || ''
        break
      case 'sparklend':
        // SparkLend ETH: pass the ETH placeholder so the adapter uses WETH_Gateway.depositETH
        // (one native tx that wraps + supplies, no approve needed) instead of pool.supply(WETH)
        hash = await sparklend?.supply(
          isSparkLendETH.value ? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' : props.assetAddress,
          amountWei,
          address.value as `0x${string}`
        ) || ''
        break

      case 'fluid':
        setFluidPool(props.poolId || '')
        hash = await fluid?.supply(props.assetAddress, amountWei, address.value as `0x${string}`) || ''
        break
      default:
        // Use aave by default
        hash = await aave?.supply(props.assetAddress, amountWei, address.value as `0x${string}`) || ''
    }


    // Waiting for transaction confirmation to be linked
    const result = await waitForConfirmation(hash, 45000, {
      protocolId: props.protocol?.toLowerCase() || '',
      protocol: props.protocol || '',
      poolId: getBackendPoolId(props.poolId || '', props.protocol || ''),
      asset: props.asset || '',
      category: 'lending',
      // Liquidity of single deposit pool (e.g. USDC/USDT of Morpho/Compound/Fluid)→ add-liquidity;
      // Collateral supply and cross-asset pool (Aave/SparkLend)→ supply
      action: isLiquidityAsset(props.poolId || '', props.asset || '') ? 'add-liquidity' : 'supply',
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
  // Other ETH assets (incl. SparkLend) do not require approve
  if (!address.value || !props.assetAddress || isGasToken.value) {
    needsApprove.value = false
    return
  }

  const protocolId = props.protocol?.toLowerCase() || ''
  const decimals = props.decimals || 18
  const amountWei = toWei(inputAmount.value || '0', decimals)

  // Morpho needs to check the token's authorization for Permit2
  if (protocolId === 'morpho') {
    // USDC uses EIP-2612 Permit and does not require Permit2 authorization
    const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
    if (props.assetAddress?.toLowerCase() === usdcAddress.toLowerCase()) {
      needsApprove.value = false
      return
    }

    // USDT: only need to check USDT.allowance(user, Permit2)
    // permit() + multicall handle Permit2-level authorization internally
    const usdtAddress = "0xdac17f958d2ee523a2206206994597c13d831ec7"
    if (props.assetAddress?.toLowerCase() === usdtAddress) {
      const owner = address.value as `0x${string}`
      const assetAddr = props.assetAddress

      // Only check USDT.allowance(user, Permit2)
      needsApprove.value = await checkMorphoAllowance(assetAddr, owner, amountWei)
      return
    }

    // WBTC/WETH/wstETH are Morpho Blue collateral: need to approve MORPHO_BLUE (0xBBB...), not Permit2
    const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"
    const wbtcAddr = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"
    const wethAddr = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
    const wstethAddr = "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0"
    const asset = props.assetAddress?.toLowerCase() || ''
    if (asset === wbtcAddr || asset === wethAddr || asset === wstethAddr) {
      needsApprove.value = await checkAllowance(asset, address.value as `0x${string}`, MORPHO_BLUE as `0x${string}`, amountWei)
    } else {
      needsApprove.value = await checkMorphoAllowance(props.assetAddress, address.value as `0x${string}`, amountWei)
    }
    return
  }

  // Fluid Liquidity Injection: approve target is fToken (FUSDC/FUSDT)
  const spenderAddress = protocolId === 'fluid'
    ? (getFluidLiquiditySpender(props.assetAddress || '') || getSpenderAddress(protocolId, 'lending', props.assetAddress, false, props.poolId))
    : getSpenderAddress(protocolId, 'lending', props.assetAddress, false, props.poolId)
  if (!spenderAddress) {
    needsApprove.value = false
    return
  }

  // Use checkAllowance to check the actual authorization status
  await checkAllowanceStatus(props.assetAddress, address.value as `0x${string}`, spenderAddress, amountWei)
}

// Listen for address changes, re-query balance and authorization status
watch(address, () => {
  fetchBalance()
  if (isSparkLendETH.value) {
    checkSparkLendETHStatus()
  } else {
    checkApprovalStatus()
  }
})

// Monitor asset changes, re-query balance and authorization status
watch(() => props.assetAddress, () => {
  fetchBalance()
  if (isSparkLendETH.value) {
    checkSparkLendETHStatus()
  } else {
    checkApprovalStatus()
  }
})

// Watch input amount changes and re-check approval status (debounced)
watch(inputAmount, () => {
  debouncedCheckApproval()
})

// Watch SparkLend ETH state changes
watch(isSparkLendETH, () => {
  if (isSparkLendETH.value) {
    checkSparkLendETHStatus()
  }
})

onMounted(() => {
  fetchBalance()
  // Check Authorization Status
  if (isSparkLendETH.value) {
    checkSparkLendETHStatus()
  } else {
    checkApprovalStatus()
  }
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
