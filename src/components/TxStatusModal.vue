<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="tx-modal-overlay" @click.self="handleClose">
        <div class="tx-modal">
          <!-- Close-Button -->
          <div class="close-bar">
            <button class="close-btn" @click="handleClose">
              <img src="@/assets/icons/close-circle.png" />
            </button>
          </div>

          <!-- In Progress Status -->
          <div v-if="status === 'pending'" class="content pending">
            <div class="scene">
              <div class="loader-orbit">
                <span
                  v-for="i in 20"
                  :key="i"
                  class="dot"
                  :style="`--i:${i - 1}`"
                ></span>
              </div>
            </div>
            <div class="pending-title">{{ pendingTitle }}</div>
            <div class="pending-desc">{{ pendingDescription }}</div>
          </div>

          <!-- Success Status -->
          <div v-else-if="status === 'success'" class="content success">
            <div class="success-circle">
              <svg class="checkmark" viewBox="0 0 56 39" fill="none">
                <path d="M4 20L20 36L52 4" stroke="#C49A4C" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="success-text">
              <div class="congrats">Congratulations!</div>
              <div class="success-desc">You have {{ actionVerb }} {{ amount }} {{ asset }}</div>
            </div>
            <div v-if="newBalance" class="divider-section">
              <div class="divider"></div>
              <div class="balance-row">
                <span class="balance-text">Your new balance is {{ newBalance }} {{ newAsset }}</span>
              </div>
            </div>
            <div class="actions">
              <a
                v-if="txHash"
                :href="`https://etherscan.io/tx/${txHash}`"
                target="_blank"
                class="review-btn"
              >
                <span>Review trans</span>
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <rect x="1.88" y="3.75" width="9.38" height="9.38" rx="1" stroke="#ACB5BB" stroke-width="1"/>
                  <rect x="6.25" y="1.88" width="6.88" height="6.88" rx="1" stroke="#ACB5BB" stroke-width="1"/>
                </svg>
              </a>
              <button class="done-btn" @click="handleClose">Done</button>
            </div>
          </div>

          <!-- Timeout status (unconfirmed posting) -->
          <div v-else-if="status === 'timeout'" class="content success">
            <div class="success-circle timeout">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#F6D77B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <div class="success-text">
              <div class="congrats">Transaction Sent</div>
              <div class="success-desc">{{ errorMessage || 'Transaction not confirmed on chain' }}</div>
              <div class="success-desc">Please check on Etherscan to confirm.</div>
            </div>
            <div class="actions">
              <a
                v-if="txHash"
                :href="`https://etherscan.io/tx/${txHash}`"
                target="_blank"
                class="review-btn"
              >
                <span>View on Etherscan</span>
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <rect x="1.88" y="3.75" width="9.38" height="9.38" rx="1" stroke="#ACB5BB" stroke-width="1"/>
                  <rect x="6.25" y="1.88" width="6.88" height="6.88" rx="1" stroke="#ACB5BB" stroke-width="1"/>
                </svg>
              </a>
              <button class="done-btn" @click="handleClose">Got it</button>
            </div>
          </div>

          <!-- Failed status -->
          <div v-else-if="status === 'error'" class="content error">
            <div class="error-icon">✕</div>
            <div class="error-title">Transaction Failed</div>
            <div class="error-desc">{{ errorMessage }}</div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'

type TxStatus = 'pending' | 'success' | 'error' | 'timeout'
type TxAction = 'approve' | 'supply' | 'deposit' | 'stake' | 'unstake' | 'withdraw' | 'claim' | 'borrow' | 'repay' | 'wrap' | 'unwrap'

const props = defineProps<{
  visible: boolean
  status: TxStatus
  action: TxAction
  txHash?: string
  errorMessage?: string
  amount?: string
  asset?: string
  newBalance?: string
  newAsset?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const actionLabels: Record<TxAction, { noun: string; verb: string; pastVerb: string }> = {
  approve: { noun: 'Approval', verb: 'Approving', pastVerb: 'approved' },
  supply: { noun: 'Supply', verb: 'Supplying', pastVerb: 'supplied' },
  deposit: { noun: 'Deposit', verb: 'Depositing', pastVerb: 'deposited' },
  stake: { noun: 'Stake', verb: 'Staking', pastVerb: 'staked' },
  unstake: { noun: 'Unstake', verb: 'Unstaking', pastVerb: 'unstaked' },
  withdraw: { noun: 'Withdrawal', verb: 'Withdrawing', pastVerb: 'withdrawn' },
  claim: { noun: 'Claim', verb: 'Claiming', pastVerb: 'claimed' },
  borrow: { noun: 'Borrow', verb: 'Borrowing', pastVerb: 'borrowed' },
  repay: { noun: 'Repayment', verb: 'Repaying', pastVerb: 'repaid' },
  wrap: { noun: 'Wrap', verb: 'Wrapping', pastVerb: 'wrapped' },
  unwrap: { noun: 'Unwrap WETH', verb: 'Unwrapping', pastVerb: 'unwrapped' }
}

const actionVerb = computed(() => actionLabels[props.action].pastVerb)
const pendingTitle = computed(() => {
  const verb = actionLabels[props.action].verb
  if (props.amount && props.asset) return `${verb} ${props.amount} ${props.asset}`
  return `${verb}...`
})
const pendingDescription = computed(() => {
  if (props.action === 'approve') return 'Waiting for wallet approval...'
  return 'Confirm the transaction in your wallet...'
})

function handleClose() {
  emit('close')
}

// Rotation Animation
let rafId = 0
let startTime = performance.now()
const COUNT = 20
const RADIUS = 105
const TILT = -10
const DURATION = 10000

function animate(time: number) {
  const elapsed = (time - startTime) % DURATION
  const progress = elapsed / DURATION
  const rotationY = progress * 360
  const loaderOrbit = document.querySelector('.tx-modal .loader-orbit')
  if (loaderOrbit) {
    (loaderOrbit as HTMLElement).style.transform = `rotateX(${TILT}deg) rotateY(${rotationY}deg)`
  }
  const dots = document.querySelectorAll('.tx-modal .dot')
  dots.forEach((dot, i) => {
    const angle = ((i * 360) / COUNT + rotationY) * (Math.PI / 180)
    const depth = Math.cos(angle)
    const blur = (1 - depth) * 1
    const scale = 0.85 + depth * 0.15
    const opacity = 1 + depth * 0.75
    ;(dot as HTMLElement).style.filter = `blur(${blur}px)`
    ;(dot as HTMLElement).style.opacity = opacity.toString()
    ;(dot as HTMLElement).style.transform = `rotateY(${(i * 360) / COUNT}deg) translateZ(${RADIUS}px) scale(${scale})`
  })
  rafId = requestAnimationFrame(animate)
}

onMounted(() => {
  if (props.status === 'pending') {
    startTime = performance.now()
    rafId = requestAnimationFrame(animate)
  }
})

onUnmounted(() => {
  cancelAnimationFrame(rafId)
})
</script>

<style scoped>
.tx-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 99999;
}

.tx-modal {
  width: 100%;
  max-width: 375px;
  box-sizing: border-box;
  padding: 15px 18px;
  background: var(--Other-BG, #1E1E20);
  box-shadow: 21.12px 38.01px 63.35px -6.34px rgba(0, 0, 0, 0.75);
  border-radius: 30px;
  outline: 0.77px solid #C49A4C;
  outline-offset: -0.77px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 30px;
}

/* Close-Button */
.close-bar {
  align-self: stretch;
  height: 30px;
  position: relative;
}

.close-btn {
  position: absolute;
  right: 0;
  top: 0;
  width: 30px;
  height: 30px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn img {
  width: 30px;
  height: 30px;
}

/* Content */
.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 30px;
  width: 100%;
}

/* = = = = = = = = = = = = = = = = = = Pending Status = = = = = = = = = = = = = = = = = = */
.pending {
  gap: 20px;
}

.scene {
  padding: 40px 0;
  width: 175px;
  height: 160px;
  perspective: 350px;
}

.loader-orbit {
  position: relative;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
}

.dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 30px;
  height: 30px;
  margin: -15px;
  border-radius: 50%;
  background: linear-gradient(90deg, #c49a4c 30%, #f6d77b 60%, #b1822a 100%);
  transform-style: preserve-3d;
  will-change: transform, filter, opacity;
}

.pending-title {
  color: #FFF;
  text-align: center;
  font-family: Inter;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

.pending-desc {
  color: rgba(255, 255, 255, 0.60);
  text-align: center;
  font-family: Inter;
  font-size: 10px;
  font-weight: 400;
  line-height: 15px;
}

/* Success Status */
.success-circle {
  width: 123px;
  height: 123px;
  border: 2px solid #F6D77B;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.success-circle.timeout {
  border-color: #F6D77B;
  opacity: 0.8;
}

.checkmark {
  width: 55px;
  height: 38px;
}

.success-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.congrats {
  color: #FFF;
  text-align: center;
  font-family: Inter;
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
}

.success-desc {
  color: rgba(255, 255, 255, 0.60);
  text-align: center;
  font-family: Inter;
  font-size: 10px;
  font-weight: 400;
  line-height: 15px;
}

.divider-section {
  width: 195px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.divider {
  align-self: stretch;
  height: 1px;
  opacity: 0.30;
  background: #ECF1F0;
}

.balance-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.balance-text {
  color: rgba(255, 255, 255, 0.60);
  text-align: center;
  font-family: Inter;
  font-size: 10px;
  font-weight: 400;
  line-height: 15px;
}

.actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 11px;
}

.review-btn {
  display: inline-flex;
  align-items: center;
  gap: 15px;
  padding: 5px 6px;
  background: #2C2C30;
  border-radius: 9px;
  outline: 1px solid #44444A;
  outline-offset: -1px;
  text-decoration: none;
  color: #FFF;
  font-family: Inter;
  font-size: 8px;
  font-weight: 500;
  line-height: 12px;
}

.review-btn svg {
  flex-shrink: 0;
}

.done-btn {
  width: 69px;
  height: 24px;
  border: 1px solid #FFDD94;
  border-radius: 10px;
  background: none;
  color: #FFDD94;
  font-family: Inter;
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  cursor: pointer;
  padding: 0;
}

.done-btn:hover {
  background: rgba(255, 221, 148, 0.1);
}

/* Failed status */
.error {
  gap: 16px;
}

.error-icon {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  font-weight: bold;
  background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%);
  color: white;
}

.error-title {
  color: #FFF;
  text-align: center;
  font-family: Inter;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

.error-desc {
  color: rgba(255, 255, 255, 0.60);
  text-align: center;
  font-family: Inter;
  font-size: 10px;
  font-weight: 400;
  line-height: 15px;
}

/* ================= Transition ================= */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
