/** Portfolio API (requires JWT certification) */

import { authGet, authPost } from './request'
import { API_ENDPOINTS } from '@/config/api'

export interface TransactionReport {
  protocolId: string
  protocol: string
  /** Pool ID (required for lending): Lowercase asset identifier (usdc/usdt/eth), cross asset pool equals protocolId */
  poolId?: string
  asset: string
  category: 'staking' | 'stablecoin' | 'lending'
  action: 'stake' | 'unstake' | 'deposit' | 'withdraw' | 'claim' | 'supply' | 'borrow' | 'repay' | 'add-liquidity' | 'remove-liquidity'
  amount: string
  txHash: string
  status: 'pending' | 'success' | 'failed'
}

/**
 * Get an overview of user assets
 * @returns {Promise < {totalAssets: object, totalEarnings: object} >}
 */
export async function getPortfolioSummary() {
  return authGet(API_ENDPOINTS.PORTFOLIO_SUMMARY)
}

/**
 * Get user holdings list
 * @param {object} params - query parameters
 * @param {string} params.category - classification (staking/stablecoin/lending)
 * @param {string []} params.protocol - specify protocol
 * @param {string} params.period - time period (1d/7d/30d/all)
 * @param {string} params.sortBy - sort field
 * @param {string} params.order - sort direction
 * @param {number} params.page - page number
 * @param {number} params.pageSize - number per page
 * @returns {Promise < {list: array, pagination: object} >}
 */
export async function getPortfolioPositions(params = {}) {
  return authGet(API_ENDPOINTS.PORTFOLIO_POSITIONS, params)
}

/**
 * Get user transactions
 * @param {object} params - query parameters
 * @param {string []} params.protocol - specify agreement
 * @param {string} params.category - classification
 * @param {string} params.sortBy - sort field
 * @param {string} params.order - sort direction
 * @param {number} params.page - page number
 * @param {number} params.pageSize - number per page
 * @returns {Promise < {list: array, pagination: object} >}
 */
export async function getPortfolioTransactions(params = {}) {
  return authGet(API_ENDPOINTS.PORTFOLIO_TRANSACTIONS, params)
}

/**
 * Escalate user transaction history
 * @param {object} data - transaction data
 * @returns {Promise<object>}
 */
export async function reportTransaction(data: TransactionReport) {
  return authPost(API_ENDPOINTS.PORTFOLIO_TRANSACTIONS_REPORT, data)
}
