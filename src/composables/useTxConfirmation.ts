import { ref } from 'vue'
import { publicClient } from '@/chain/core/provider'
import { reportTransaction, type TransactionReport } from '@/api/portfolio'
import { useTxReporter } from './useTxReporter'

export type TxReportMeta = Omit<TransactionReport, 'txHash' | 'status'>

// Module-level singleton handle (useTxReporter internal state is module-level; just use it from module scope)
const txReporter = useTxReporter()

/**
 * Composable for waiting on transaction confirmation
 * Waits for on-chain confirmation after receiving txHash, then shows the success state
 */
export function useTxConfirmation() {
  const isConfirming = ref(false)
  const confirmError = ref<string | null>(null)

  /**
 * Wait for a transaction to be confirmed on-chain
 * @param txHash transaction hash
 * @param timeout timeout in milliseconds, default 45s
 * @param reportMeta transaction report metadata (optional); when provided, reports pending immediately before waiting
 * @returns confirmation result
 */
  async function waitForConfirmation(
    txHash: string,
    timeout: number = 45000,
    reportMeta?: TxReportMeta
  ): Promise<{
    success: boolean
    timedOut: boolean
    blockNumber?: bigint
    gasUsed?: bigint
    error?: string
  }> {
    // Report pending immediately (non-blocking, does not wait for confirmation)
    if (reportMeta) {
      reportTransaction({ ...reportMeta, txHash, status: 'pending', amount: String(reportMeta.amount ?? '0') })
        .then(() => {
          // Report success → register in the poller as a fallback after the 45s confirmation timeout/modal close
          txReporter.registerPending(txHash, reportMeta)
        })
        .catch(err => console.warn('[Report] Failed to report pending tx:', err))
    }

    isConfirming.value = true
    confirmError.value = null

    try {

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
        timeout
      })

      const success = receipt.status === 'success'

      // Report the on-chain confirmation result immediately (non-blocking)
      if (reportMeta) {
        reportTransaction({ ...reportMeta, txHash, status: success ? 'success' : 'failed', amount: String(reportMeta.amount ?? '0') })
          .then(() => {
            // Final status reported → remove from the poller to avoid duplicate checks
            txReporter.unregisterPending(txHash)
          })
          .catch(err => console.warn('[Report] Failed to report confirmed tx:', err))
      }


      isConfirming.value = false

      return {
        success,
        timedOut: false,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed
      }
    } catch (err: any) {
      console.error('[TxConfirmation] Error:', err)
      isConfirming.value = false

      const errMsg = err?.message || ''
      const isTimeout =
        errMsg.toLowerCase().includes('timed out') ||
        errMsg.toLowerCase().includes('timeout') ||
        errMsg.toLowerCase().includes('could not be found')

      if (isTimeout) {
        return {
          success: false,
          timedOut: true,
          error: 'Transaction not confirmed on chain within ' + (timeout / 1000) + ' seconds'
        }
      }

      confirmError.value = errMsg || 'Transaction confirmation failed'

      return {
        success: false,
        timedOut: false,
        error: confirmError.value
      }
    }
  }

  /**
 * Full flow of sending a transaction and waiting for confirmation
 * Replaces directly calling adapter methods + updateTxSuccess
 * * @param sendFn function that sends the transaction (returns txHash)
 * @param onSuccess success callback
 * @param onError error callback
 */
  async function sendAndWait(
    sendFn: () => Promise<string>,
    onSuccess?: (txHash: string) => void,
    onError?: (error: string) => void
  ): Promise<string> {
    try {
      // 1. Send the transaction
      const txHash = await sendFn()

      // 2. Wait for confirmation
      const result = await waitForConfirmation(txHash)

      if (result.success) {
        onSuccess?.(txHash)
        return txHash
      } else {
        const errMsg = result.error || 'Transaction failed on-chain'
        onError?.(errMsg)
        throw new Error(errMsg)
      }
    } catch (err: any) {
      // Only call when onError has not already handled it (i.e. errors thrown by sendFn itself)
      if (err.message && !err.message.includes('Transaction failed on-chain')) {
        onError?.(err.message)
      }
      throw err
    }
  }

  return {
    isConfirming,
    confirmError,
    waitForConfirmation,
    sendAndWait
  }
}