import type { PortfolioPosition } from '@/types/portfolio'

const ETH_PLACEHOLDER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

/** Normalize asset addresses for stablecoin/lending overlap checks. */
export function normalizePortfolioAssetAddress(address?: string): string {
  const value = (address || '').toLowerCase()
  return value === ETH_PLACEHOLDER ? WETH : value
}

function protocolKey(row: PortfolioPosition): string {
  return (row.protocolId || '').toLowerCase()
}

function overlapKey(row: PortfolioPosition): string {
  return `${protocolKey(row)}:${normalizePortfolioAssetAddress(row.assetAddress)}`
}

function parseUsd(value?: string): number {
  const parsed = Number.parseFloat((value || '').replace(/[$,]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Total Assets shown on the Portfolio overview.
 *
 * It is sourced from the deduped ALL rows, not from GET /portfolio/summary.
 * Borrow rows are liabilities (negative). Staking Withdraw rows represent
 * pending/claimable ETH that has already been unstaked, so they add 0.
 */
export function calculatePortfolioTotalAssets(rows: PortfolioPosition[]): number {
  return rows.reduce((sum, row) => {
    if (row.category === 'lending-borrow') {
      return sum - parseUsd(row.balanceUsd)
    }

    if ((row.category === 'staking' || row.category === 'stablecoin') && row.type === 'withdraw') {
      return sum
    }

    return sum + parseUsd(row.balanceUsd)
  }, 0)
}

/** Positive assets count as value; borrow rows count as a negative liability. */
function signedValue(row: PortfolioPosition): number {
  const value = parseUsd(row.balanceUsd)
  return row.category === 'lending-borrow' ? -value : value
}

function compareAssetOrPool(a: PortfolioPosition, b: PortfolioPosition): number {
  return (
    (a.asset || '').toLowerCase().localeCompare((b.asset || '').toLowerCase()) ||
    (a.id || '').localeCompare(b.id || '')
  )
}

/**
 * ALL page dedupe: when the same protocol + asset exists as both Stablecoin and
 * Lending Supply/Liquidity, keep one Stablecoin row and annotate it with the
 * merged Lending categories. The standalone Lending row is removed.
 */
export function mergeLendingStablecoinDuplicates(rows: PortfolioPosition[]): PortfolioPosition[] {
  const stablecoinKeys = new Set<string>()
  const overlappedLendingByKey = new Map<string, PortfolioPosition['category'][]>()

  for (const row of rows) {
    if (row.category === 'stablecoin') {
      stablecoinKeys.add(overlapKey(row))
      continue
    }

    if (row.category === 'lending-supply' || row.category === 'lending-liquidity') {
      const key = overlapKey(row)
      const categories = overlappedLendingByKey.get(key)
      if (categories) {
        categories.push(row.category)
      } else {
        overlappedLendingByKey.set(key, [row.category])
      }
    }
  }

  const result: PortfolioPosition[] = []
  for (const row of rows) {
    const key = overlapKey(row)

    if (row.category === 'stablecoin') {
      const overlapped = overlappedLendingByKey.get(key)
      result.push(
        overlapped?.length
          ? { ...row, overlappedLendingCategories: overlapped }
          : row
      )
      continue
    }

    const isOverlappableLendingRow =
      row.category === 'lending-supply' || row.category === 'lending-liquidity'
    if (isOverlappableLendingRow && stablecoinKeys.has(key)) continue

    result.push(row)
  }

  return result
}

/**
 * Default Portfolio ordering:
 * group by protocol, order groups by net value, then show positive rows by
 * value descending and borrow rows at the bottom by absolute debt descending.
 */
export function sortPortfolioPositions(rows: PortfolioPosition[]): PortfolioPosition[] {
  const groups = new Map<string, PortfolioPosition[]>()

  for (const row of rows) {
    const key = protocolKey(row)
    const list = groups.get(key)
    if (list) {
      list.push(row)
    } else {
      groups.set(key, [row])
    }
  }

  for (const groupRows of groups.values()) {
    groupRows.sort((a, b) => {
      const aBorrow = a.category === 'lending-borrow'
      const bBorrow = b.category === 'lending-borrow'

      // Positive rows first, borrow rows last.
      if (aBorrow !== bBorrow) return aBorrow ? 1 : -1

      const aValue = Math.abs(signedValue(a))
      const bValue = Math.abs(signedValue(b))
      return bValue - aValue || compareAssetOrPool(a, b)
    })
  }

  return [...groups.entries()]
    .sort((a, b) => {
      const netA = a[1].reduce((sum, row) => sum + signedValue(row), 0)
      const netB = b[1].reduce((sum, row) => sum + signedValue(row), 0)
      return netB - netA || a[0].localeCompare(b[0])
    })
    .flatMap(([, groupRows]) => groupRows)
}
