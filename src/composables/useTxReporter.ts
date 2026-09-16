/**
 * Automatic check of pending transactions
 * After login, periodically check the on-chain status of pending transactions and update them to success/failed once confirmed
 * * Usage:
 * - call useTxReporter().start() after successful login (see useAppKitAuth.ts)
 * - call registerPending() after waitForConfirmation reports a pending success (see useTxConfirmation.ts)
 * - call stop() on logout/wallet disconnect
 */

import { publicClient } from '@/chain/core/provider'
import {
  getPortfolioTransactions,
  reportTransaction,
  type TransactionReport
} from '@/api/portfolio'

/** Polling interval: 5 minutes */
const POLL_INTERVAL = 5 * 60 * 1000

/** Transactions that still have no on-chain receipt after this age are considered failed (dropped / never mined) */
const STALE_MS = 15 * 60 * 1000

/** Report metadata carried when registering a pending transaction (without txHash/status) */
type PendingTxMeta = Omit<TransactionReport, 'txHash' | 'status'>

let timer: ReturnType<typeof setInterval> | null = null
let running = false

/**
 * Locally registered pending transactions: txHash → report metadata + local registration time
 * Registered by useTxConfirmation after the pending report succeeds.
 * Purpose: fallback beyond the backend list API (pageSize 50) — even if a transaction is not in the first 50 records,
 * we can still query the on-chain receipt and update its status.
 */
const pendingRegistry = new Map<string, { meta: PendingTxMeta; ts: number }>()

/** Register a pending transaction into the polling scope (idempotent; duplicate registration has no side effects) */
function registerPending(txHash: string, meta: PendingTxMeta) {
  if (pendingRegistry.has(txHash)) return
  pendingRegistry.set(txHash, { meta, ts: Date.now() })
}

/** Remove the registration once the transaction is confirmed and the final status is reported (idempotent) */
function unregisterPending(txHash: string) {
  if (pendingRegistry.delete(txHash)) {
  }
}

async function checkPendingTransactions() {
  if (running) return
  running = true

  try {

    const res = await getPortfolioTransactions({ pageSize: 50 })
    const pendingTxs = (res.list || []).filter((tx: any) => tx.status === 'pending')

    if (pendingTxs.length === 0 && pendingRegistry.size === 0) {
      return
    }


    const backendPendingHashes = new Set<string>()
    for (const tx of pendingTxs) {
      backendPendingHashes.add(tx.txHash)
    }

    // 1) Pending transactions from the backend records
    for (const tx of pendingTxs) {
      try {
        const receipt = await publicClient.getTransactionReceipt({
          hash: tx.txHash as `0x${string}`
        })

        const newStatus = receipt.status === 'success' ? 'success' : 'failed'

        await reportTransaction({
          protocolId: tx.protocolId,
          protocol: tx.protocol,
          asset: tx.asset,
          category: tx.category,
          action: tx.action,
          amount: String(tx.amount),
          txHash: tx.txHash,
          status: newStatus
        })

        unregisterPending(tx.txHash)
      } catch {
        // Transaction not confirmed on-chain (no receipt yet).
        // If it has been pending for more than 5 minutes without landing, it is considered failed
        // (dropped from mempool / never mined), otherwise leave it pending for the next poll.
        const ageMs = Date.now() - (tx.timestamp ? tx.timestamp * 1000 : Date.now())
        if (ageMs > STALE_MS) {
          await reportTransaction({
            protocolId: tx.protocolId,
            protocol: tx.protocol,
            asset: tx.asset,
            category: tx.category,
            action: tx.action,
            amount: String(tx.amount),
            txHash: tx.txHash,
            status: 'failed'
          })
          unregisterPending(tx.txHash)
        }
      }
    }

    // 2) Locally registered pending transactions (may be outside the backend's first 50 records; query the chain directly as fallback)
    if (pendingRegistry.size > 0) {
      for (const [txHash, entry] of pendingRegistry) {
        if (backendPendingHashes.has(txHash)) continue // Already handled above
        const meta = entry.meta
        try {
          const receipt = await publicClient.getTransactionReceipt({
            hash: txHash as `0x${string}`
          })

          const newStatus = receipt.status === 'success' ? 'success' : 'failed'

          await reportTransaction({
            ...meta,
            txHash,
            status: newStatus,
            amount: String(meta.amount ?? '0')
          })

          unregisterPending(txHash)
        } catch {
          // Transaction not confirmed on-chain (no receipt yet).
          // If it has been pending locally for more than 5 minutes without landing, consider it failed.
          if (Date.now() - entry.ts > STALE_MS) {
            await reportTransaction({
              ...meta,
              txHash,
              status: 'failed',
              amount: String(meta.amount ?? '0')
            })
            unregisterPending(txHash)
          }
        }
      }
    }
  } catch (err) {
    console.warn('[TxReporter] Failed to check pending transactions:', err)
  } finally {
    running = false
  }
}

export function useTxReporter() {
  function start() {
    // Idempotent: stop first then start; repeated calls do not stack timers
    stop()
    checkPendingTransactions()
    timer = setInterval(checkPendingTransactions, POLL_INTERVAL)
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    // Clear local registrations on logout/restart to avoid checking stale transactions across sessions
    pendingRegistry.clear()
  }

  return { start, stop, checkPendingTransactions, registerPending, unregisterPending }
}
