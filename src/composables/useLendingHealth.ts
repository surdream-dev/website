import { computed, reactive, ref, watch, type Ref } from 'vue'
import { lending } from '@/chain/lending'
import type { HealthSnapshot } from '@/chain/lending/base'
import { getLendingPrices, getPriceByAddress } from '@/composables/useLendingPrices'

export type LendingAction = 'supply' | 'withdraw' | 'borrow' | 'repay'
export type RiskLevel = 'safe' | 'warning' | 'danger' | 'blocked'

/**
 * Minimum safe health factor buffer. Any action that would push the resulting HF
 * below this value is blocked; actions landing at/below 1.2 still show a high-risk
 * warning but are not blocked.
 */
export const SAFE_HF_THRESHOLD = 1.02

/**
 * Unified three-color + liquidation-line classification.
 * Green > 1.5 / Yellow (1.2, 1.5] / Red [1.02, 1.2] / Blocked < 1.02.
 * `null` represents HF = ∞ (no debt), treated as safe.
 */
export function classifyHealthFactor(hf: number | null): RiskLevel {
  if (hf === null) return 'safe'
  if (hf < SAFE_HF_THRESHOLD) return 'blocked'
  if (hf <= 1.2) return 'danger'
  if (hf <= 1.5) return 'warning'
  return 'safe'
}

/** Compute the preview HF given a snapshot, action, human amount and the operated asset USD price. */
export function computePreviewHF(
  snapshot: HealthSnapshot,
  action: LendingAction,
  amount: number,
  price: number,
): number | null {
  const amountUSD = amount * price
  let riskAdjusted = snapshot.riskAdjustedCollateralUSD
  let borrow = snapshot.borrowUSD
  const threshold = snapshot.liquidationThresholdBps / 10000

  if (action === 'supply') {
    riskAdjusted += amountUSD * threshold
  } else if (action === 'withdraw') {
    riskAdjusted = Math.max(0, riskAdjusted - amountUSD * threshold)
  } else if (action === 'borrow') {
    borrow += amountUSD
  } else if (action === 'repay') {
    borrow = Math.max(0, borrow - amountUSD)
  }

  if (borrow <= 0) return null
  return riskAdjusted / borrow
}

/** Human-readable max withdraw amount that keeps the resulting HF at the safe buffer. */
export function computeSafeMaxWithdraw(snapshot: HealthSnapshot, price: number): number | null {
  if (!snapshot || !Number.isFinite(price) || price <= 0) return null
  // No debt → withdrawing collateral cannot trigger liquidation, so there is no limit.
  if (snapshot.borrowUSD <= 0) return null

  const threshold = snapshot.liquidationThresholdBps / 10000
  if (threshold <= 0) return null

  const riskAdjusted = snapshot.riskAdjustedCollateralUSD
  const borrow = snapshot.borrowUSD
  // A tiny buffer avoids float-rounding the filled amount just below the blocked line.
  const targetRiskAdjusted = SAFE_HF_THRESHOLD * borrow * 1.000001
  const amountUSD = (riskAdjusted - targetRiskAdjusted) / threshold
  if (amountUSD <= 0) return 0
  const result = amountUSD / price
  return Number.isFinite(result) ? result : null
}

function formatHF(hf: number | null): string {
  return hf === null ? '∞' : hf.toFixed(2)
}

export interface LendingHealthHint {
  level: RiskLevel
  message: string
}

export function useLendingHealth(args: {
  account: () => string | undefined
  protocol: () => string
  poolId: () => string | undefined
  assetAddress: () => string | undefined
  action: LendingAction
  amount: Ref<string>
  /** When false, the health snapshot is neither fetched nor computed (e.g. liquidity positions whose withdraw/supply never affects HF). */
  enabled?: () => boolean
}) {
  const snapshot = ref<HealthSnapshot | null>(null)
  const price = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Reference to the currently in-flight health load (if any), so callers can await it.
  let inflight: Promise<void> | null = null

  function runLoad(): Promise<void> {
    // Liquidity positions are never health-relevant: skip the snapshot fetch/compute entirely.
    if (args.enabled && !args.enabled()) {
      snapshot.value = null
      loading.value = false
      error.value = null
      return Promise.resolve()
    }
    const acct = args.account()
    const protocolId = args.protocol()
    if (!acct || !protocolId) {
      snapshot.value = null
      return Promise.resolve()
    }
    // Coalesce concurrent calls (the immediate watch on mount + a manual refresh) into one load.
    if (inflight) return inflight

    loading.value = true
    error.value = null
    const promise = (async () => {
      try {
        const adapter = lending.get(protocolId)
        const poolId = args.poolId()
        const [snap, prices] = await Promise.all([
          adapter?.getHealthSnapshot
            ? adapter.getHealthSnapshot(acct as `0x${string}`, poolId)
            : Promise.resolve(undefined),
          getLendingPrices(),
        ])
        snapshot.value = snap ?? null
        const addr = args.assetAddress()
        price.value = addr ? getPriceByAddress(prices, addr) : 0
      } catch (e: any) {
        console.warn('[useLendingHealth] fetch failed:', e)
        error.value = e?.message || 'Failed to fetch health factor'
        snapshot.value = null
      } finally {
        loading.value = false
        inflight = null
      }
    })()
    inflight = promise
    return promise
  }

  async function refresh() {
    await runLoad()
  }

  /** Resolve once any in-flight health load completes (immediately when none is running). */
  function awaitLoaded(): Promise<void> {
    return inflight ?? Promise.resolve()
  }

  watch(
    [() => args.account(), () => args.protocol(), () => args.poolId(), () => args.assetAddress()],
    refresh,
    { immediate: true },
  )

  const currentHF = computed<number | null>(() => {
    const s = snapshot.value
    if (!s) return null
    if (s.borrowUSD <= 0) return null
    return s.riskAdjustedCollateralUSD / s.borrowUSD
  })

  const previewHF = computed<number | null>(() => {
    const s = snapshot.value
    if (!s) return null
    const amount = parseFloat(args.amount.value) || 0
    return computePreviewHF(s, args.action, amount, price.value)
  })

  const hasDebt = computed(() => (snapshot.value?.borrowUSD ?? 0) > 0)
  const isAccountLevel = computed(() => snapshot.value?.isAccountLevel ?? false)
  const scope = computed(() => snapshot.value?.scope ?? '')
  const hasAmount = computed(() => (parseFloat(args.amount.value) || 0) > 0)
  const isRiskIncreasing = args.action === 'borrow' || args.action === 'withdraw'

  const riskLevel = computed<RiskLevel>(() => classifyHealthFactor(previewHF.value))
  const safeMaxWithdraw = computed<number | null>(() => {
    if (args.action !== 'withdraw') return null
    if (!snapshot.value) return null
    return computeSafeMaxWithdraw(snapshot.value, price.value)
  })

  const isBlocked = computed(
    () => isRiskIncreasing && hasAmount.value && riskLevel.value === 'blocked',
  )

  const hint = computed<LendingHealthHint | null>(() => {
    if (!isRiskIncreasing || !hasAmount.value) return null
    const level = riskLevel.value
    if (level === 'blocked') {
      return { level, message: 'This action would push your health factor below the safe buffer (HF < 1.02) and into liquidation risk. It has been blocked.' }
    }
    if (level === 'danger') {
      return { level, message: 'This action would move your health factor into the high-risk zone (1.02 ≤ HF ≤ 1.2), with a risk of liquidation.' }
    }
    if (level === 'warning') {
      return { level, message: 'This action would move your health factor into the caution zone (1.2 < HF ≤ 1.5).' }
    }
    return null
  })

  const hfText = computed(() => {
    const cur = formatHF(currentHF.value)
    if (!hasAmount.value) return cur
    return `${cur} → ${formatHF(previewHF.value)}`
  })

  return reactive({
    snapshot,
    loading,
    error,
    refresh,
    awaitLoaded,
    currentHF,
    previewHF,
    hasDebt,
    isAccountLevel,
    scope,
    riskLevel,
    price,
    safeMaxWithdraw,
    isBlocked,
    hint,
    hfText,
  })
}
