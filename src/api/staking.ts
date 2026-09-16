/**
 * Staking API
 * Note: getStakingProtocols/getProtocolDetail was removed in 2026-08-14 Dead Code Cleanup (no caller),
 * This file only retains transformStakingData for views/Stake/index.vue.
 */

/**
 * Formatted TVL data
 * @param {number} tvl - TVL value
 * @returns {string} Formatted string
 */
function formatTVL(tvl) {
  if (!tvl) return '-'
  if (tvl >= 1e9) return `$${(tvl / 1e9).toFixed(2)}B`
  if (tvl >= 1e6) return `$${(tvl / 1e6).toFixed(2)}M`
  return `$${tvl}`
}

/**
 * Formatted APY
 * @param {number} apy-APY values
 * @returns {string} Formatted strings
 */
function formatAPY(apy) {
  if (!apy || apy <= 0) return '-'
  return `${apy.toFixed(2)}%`
}

/**
 * Convert API data to front-end table format
 * @param {array} apiData - list data returned by the API
 * @returns {array} front-end format data
 */
export function transformStakingData(apiData) {
  if (!apiData || !apiData.list) return []

  return apiData.list.map(item => ({
    protocol: item.name,
    protocolId: item.protocolId,
    icon: item.logo,
    asset: item.asset,
    assetAddress: item.assetAddress || '',  // Asset Contract Address
    decimals: item.decimals ?? 18,          // Token Accuracy
    receiptToken: item.contracts?.token || '', // Voucher Token Address
    receiptTokenSymbol: item.receiptTokenSymbol || '', // Voucher Token Symbol
    tvl: formatTVL(item.metrics.tvl),
    basicApy: formatAPY(item.metrics.apy.base),
    boostApy: item.metrics.apy.boost ? formatAPY(item.metrics.apy.boost) : '—',
    totalApy: formatAPY(item.metrics.apy.total || item.metrics.apy.base),
    unstakePeriod: item.unstake?.period || '—',
    launchYear: item.launchYear,
    tag: item.tags?.[0] || '',
    // Complete data passed to the pop-up component
    metrics: {
      apy: {
        base: item.metrics.apy.base,
        boost: item.metrics.apy.boost || 0,
        total: item.metrics.apy.total || item.metrics.apy.base
      },
      tvl: item.metrics.tvl
    },
    unstake: {
      period: item.unstake?.period || '—',
      available: item.unstake?.available ?? true
    }
  }))
}
