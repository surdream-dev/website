<template>
  <div class="panel">
    <div v-if="loading" class="loading-state">Loading withdrawal info...</div>

    <!-- No cooldown in progress -->
    <div v-else-if="!hasPending" class="empty-state">
      <div class="empty-icon">⏳</div>
      <p class="empty-title">No pending withdrawals</p>
      <p class="empty-desc">
        Start a cooldown in the Withdraw tab; once it finishes, claim your USDe here.
      </p>
    </div>

    <!-- Pending / Available -->
    <template v-else>
      <div class="request-list">
        <div class="request-item" :class="hasAvailable ? 'available' : 'pending'">
          <div class="request-info">
            <span class="request-id">Cooldown</span>
            <span class="request-status" :class="hasAvailable ? 'available' : 'pending'">
              {{ hasAvailable ? 'Available' : 'Pending' }}
            </span>
          </div>
          <span class="request-amount">{{ pendingFormatted }} USDe</span>
        </div>
      </div>

      <div class="stake-wrapper">
        <div class="row">
          <span>Available to claim</span>
          <span v-if="address">{{ availableFormatted }} USDe</span>
        </div>
        <div class="input-wrapper">
          <InputBox v-model="inputAmount" :readonly="true"/>
          <div class="token-wrapper">
            <img :src="asseticon"/>
            <span>USDe</span>
          </div>
        </div>
      </div>

      <PrimaryBtn
        v-if="address"
        :is-loading="isClaiming"
        :is-disabled="isClaiming || !hasAvailable"
        @click="handleClaim"
      >
        {{ isClaiming ? 'Claiming...' : 'Claim All Available' }}
      </PrimaryBtn>
      <PrimaryBtn v-else @click="walletStore.openConnect()">Connect Wallet</PrimaryBtn>

      <div class="info">
        <div><span>Pending</span><span>{{ pendingFormatted }} USDe</span></div>
        <div><span>Cooldown period</span><span>{{ cooldownDurationDisplay }}</span></div>
        <div v-if="!hasAvailable && remainingSeconds > 0">
          <span>Remaining</span><span>{{ countdownText }}</span>
        </div>
      </div>
    </template>

    <!-- Transaction Status Popup -->
    <TxStatusModal
      :visible="txModalVisible"
      :status="txStatus"
      :action="txAction"
      :txHash="txHash"
      :errorMessage="txError"
      :amount="availableFormatted"
      asset="USDe"
      @close="closeTxModal"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import InputBox from './InputBox.vue'
import PrimaryBtn from './PrimaryBtn.vue'
import TxStatusModal from '@/components/TxStatusModal.vue'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { stablecoin } from '@/chain/stablecoin'
import { ethenaCooldown } from '@/chain/stablecoin/ethena'
import { useTxConfirmation } from '@/composables/useTxConfirmation'
import { toast } from '@/utils/toast'
import { getBackendPoolId } from '@/constants/protocols'

type TxStatus = 'pending' | 'success' | 'error' | 'timeout'
type TxAction = 'claim'

const props = defineProps<{
  protocol?: string          // Protocol ID (ethena)
  asset?: string             // Asset name (USDe)
  asseticon?: string
  decimals?: number          // Underlying token precision
  selectedItem?: any         // Full row data (used for poolId reporting etc.)
}>()

const emit = defineEmits<{
  (e: 'openProcess', value: boolean): void
}>()

const walletStore = useWalletStore()
const { address } = storeToRefs(walletStore)

// Confirm hook with transaction
const { waitForConfirmation } = useTxConfirmation()

// Status
const loading = ref(true)
const isClaiming = ref(false)
const pendingWei = ref<bigint>(BigInt(0))
const availableWei = ref<bigint>(BigInt(0))
const remainingSeconds = ref(0)
const cooldownDuration = ref<number>(0)
const inputAmount = ref<string>('0')

// Transaction Status Popup
const txModalVisible = ref(false)
const txStatus = ref<TxStatus>('pending')
const txAction = ref<TxAction>('claim')
const txHash = ref<string>('')
const txError = ref<string>('')

function showTxModal() {
  txAction.value = 'claim'
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

const decimals = computed(() => props.decimals ?? 18)
const hasPending = computed(() => pendingWei.value > 0n)
const hasAvailable = computed(() => availableWei.value > 0n)

function formatUsde(wei: bigint): string {
  const f = Number(wei) / 10 ** decimals.value
  return f > 0 ? Math.floor(f * 1e6) / 1e6 + '' : '0'
}

const pendingFormatted = computed(() => formatUsde(pendingWei.value))
const availableFormatted = computed(() => formatUsde(availableWei.value))

const cooldownDurationDisplay = computed(() => {
  const s = cooldownDuration.value
  if (s <= 0) return '-'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  if (d > 0) return `${d} day${d > 1 ? 's' : ''}`
  if (h > 0) return `${h} hour${h > 1 ? 's' : ''}`
  return `${Math.max(1, Math.floor(s / 60))} min`
})

const countdownText = computed(() => {
  const s = remainingSeconds.value
  if (s <= 0) return 'Ready to claim'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h left`
  if (h > 0) return `${h}h ${m}m left`
  return `${m}m ${s % 60}s left`
})

function resetState() {
  pendingWei.value = BigInt(0)
  availableWei.value = BigInt(0)
  remainingSeconds.value = 0
  cooldownDuration.value = 0
  inputAmount.value = '0'
}

// Query cooldown status (pending USDe + availability)
async function fetchStatus() {
  if (!address.value) {
    resetState()
    loading.value = false
    return
  }

  loading.value = true
  try {
    const status = await ethenaCooldown.getCooldownStatus(address.value as `0x${string}`)
    pendingWei.value = status.pendingAssets
    availableWei.value = status.isReady ? status.pendingAssets : 0n
    remainingSeconds.value = status.remainingSeconds
    cooldownDuration.value = status.duration
    inputAmount.value = availableWei.value > 0n ? formatUsde(availableWei.value) : '0'
  } catch (e) {
    console.warn('[Stablecoin Claim] Failed to fetch cooldown status:', e)
    resetState()
  } finally {
    loading.value = false
  }
}

// Claim the full pending USDe after the cooldown expires
async function handleClaim() {
  if (!address.value) return
  if (!hasAvailable.value) {
    toast.show('Nothing available to claim yet', 'warning')
    return
  }

  const adapter = stablecoin.get((props.protocol || '').toLowerCase())
  if (!adapter?.claim) {
    toast.show('Claim not supported for this protocol', 'error')
    return
  }

  isClaiming.value = true
  showTxModal()

  try {
    const hash = await adapter.claim(address.value as `0x${string}`)

    const result = await waitForConfirmation(hash, 45000, {
      protocolId: (props.protocol || '').toLowerCase(),
      protocol: props.protocol || '',
      poolId: getBackendPoolId((props.selectedItem as any)?.poolId || (props.protocol || '').toLowerCase(), props.protocol || ''),
      asset: props.asset || 'USDe',
      category: 'stablecoin',
      action: 'claim',
      amount: availableFormatted.value
    })

    if (result.success) {
      updateTxSuccess(hash)
      emit('openProcess', true)
      await fetchStatus()
    } else if (result.timedOut) {
      txStatus.value = 'timeout'
      txError.value = result.error || ''
    } else {
      updateTxError(result.error || 'Transaction failed on-chain')
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
      console.error('[Stablecoin Claim] Error:', error)
      updateTxError(error?.message || 'Transaction failed')
    }
  } finally {
    isClaiming.value = false
  }
}

// Countdown tick: refresh status once the cooldown ends so the button unlocks
let tickTimer: ReturnType<typeof setInterval> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

function startTimers() {
  stopTimers()
  tickTimer = setInterval(() => {
    if (remainingSeconds.value > 0) {
      remainingSeconds.value -= 1
      if (remainingSeconds.value === 0 && pendingWei.value > 0n) {
        fetchStatus()
      }
    }
  }, 1000)
  // Re-read the on-chain slot periodically to catch state changes
  pollTimer = setInterval(fetchStatus, 30000)
}

function stopTimers() {
  if (tickTimer) clearInterval(tickTimer)
  if (pollTimer) clearInterval(pollTimer)
  tickTimer = null
  pollTimer = null
}

watch(address, () => {
  fetchStatus()
})

watch(() => props.protocol, () => {
  resetState()
  fetchStatus()
})

onMounted(() => {
  fetchStatus()
  startTimers()
})

onBeforeUnmount(() => {
  stopTimers()
})
</script>

<style scoped>
.panel {
  width: 100%;
  margin: 0 auto;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--Secondary-300, #ACB5BB);
  font-size: 14px;
}

/* Requests List */
.request-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.request-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--Secondary-700, #161618);
  border: 1px solid var(--Secondary-600, #2C2C30);
}

.request-item.available {
  border-color: rgba(246, 215, 123, 0.3);
}

.request-item.pending {
  opacity: 0.5;
}

.request-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.request-id {
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 11px;
  font-weight: 400;
  line-height: 150%;
}

.request-status {
  font-family: Inter;
  font-size: 9px;
  font-weight: 600;
  line-height: 150%;
  padding: 1px 6px;
  border-radius: 3px;
}

.request-status.pending {
  color: #F6D77B;
  background: rgba(246, 215, 123, 0.1);
}

.request-status.available {
  color: #4ADE80;
  background: rgba(74, 222, 128, 0.1);
}

.request-amount {
  color: #FFF;
  font-family: Inter;
  font-size: 13px;
  font-weight: 600;
  line-height: 150%;
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 48px;
  opacity: 0.5;
  margin-bottom: 16px;
}

.empty-title {
  color: var(--Secondary-200, #DCE4E8);
  font-family: Inter;
  font-size: 16px;
  font-weight: 600;
  line-height: 150%;
  margin-bottom: 8px;
}

.empty-desc {
  color: var(--Secondary-400, #6C7278);
  font-family: Inter;
  font-size: 12px;
  font-weight: 400;
  line-height: 150%;
  max-width: 320px;
}

/* Input area styles */
.stake-wrapper {
  width: 100%;
  display: flex;
  height: 75px;
  padding: 4.626px 10px;
  flex-direction: column;
  justify-content: center;
  align-items: flex-end;
  flex-shrink: 0;
  align-self: stretch;
  margin-bottom: 10px;
  border-radius: 4.626px;
  border: 0.771px solid var(--Secondary-600, #2C2C30);
  background: var(--Secondary-700, #161618);
}

.input-wrapper {
  width: 100%;
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

.token-wrapper img {
  width: 15px;
  height: 15px;
}

.token-wrapper span {
  color: #FFF;
  font-family: Inter;
  font-size: 10.795px;
  font-style: normal;
  font-weight: 500;
  line-height: 150%;
  letter-spacing: -0.216px;
}

.row {
  margin-top: 5px;
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.row span {
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 10px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  letter-spacing: -0.2px;
}

.info {
  display: flex;
  margin-top: 20px;
  padding: 7.711px;
  align-items: center;
  flex-direction: column;
  gap: 2px;
  align-self: stretch;
  border-radius: 6.169px;
  background: var(--Secondary-600, #2C2C30);
  box-shadow: 0 4.626px 7.711px -2.313px rgba(0, 0, 0, 0.25);
}

.info div {
  width: 100%;
  display: flex;
  justify-content: space-between;
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
