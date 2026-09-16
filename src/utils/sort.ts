/**
 * Table sorting utility (shared by Staking / Stablecoin / Lending pages)
 * * Parsing rules:
 * - number / bigint / boolean → convert to a numeric value directly
 * - "$1.23B" / "$850.00M" / "123.45K" / "1,234,567.890 ETH" / "$123.45" → normalize by T/B/M/K units into a standard number
 * - "5.43%" → 5.43; "<0.01%" / "≤0.01%" → 0
 * - "-" / "" / null / undefined → null (always sorted last; same for asc/desc)
 * - others (text columns like protocol/asset names) → returned as-is, use localeCompare
 */

export type SortOrder = 'asc' | 'desc'

export function parseSortValue(
  row: Record<string, any> | null | undefined,
  key: string
): number | string | null {
  const val = row?.[key]
  if (val === null || val === undefined) return null
  if (typeof val === 'number') return Number.isFinite(val) ? val : null
  if (typeof val === 'bigint') return Number(val)
  if (typeof val === 'boolean') return val ? 1 : 0
  if (typeof val !== 'string') return null

  const s = val.trim()
  if (s === '' || s === '-') return null

  // Percentages: <0.01% / 5.43% / 12.34%
  if (s.includes('%')) {
    const m = s.match(/[<≤]?\s*([\d][\d,]*(?:\.\d+)?)/)
    if (!m) return null
    const num = parseFloat(m[1].replace(/,/g, ''))
    if (!Number.isFinite(num)) return null
    return /^[<≤]/.test(s) ? 0 : num
  }

  // Amounts/quantities: $1.23B, $850.00M, 123.45K, 1,234,567.890 ETH, $123.45, 10.5
  const amountMatch = s.match(/^[$\u00A5\u00A3\u20AC]?\s*([\d][\d,]*(?:\.\d+)?)\s*([A-Za-z]*)$/)
  if (amountMatch) {
    const num = parseFloat(amountMatch[1].replace(/,/g, ''))
    if (Number.isFinite(num)) {
      const unit = amountMatch[2].toUpperCase()
      const mult = unit === 'T' ? 1e12 : unit === 'B' ? 1e9 : unit === 'M' ? 1e6 : unit === 'K' ? 1e3 : 1
      return num * mult
    }
  }

  return s
}

export function compareForSort(
  a: Record<string, any>,
  b: Record<string, any>,
  key: string,
  order: SortOrder
): number {
  const v1 = parseSortValue(a, key)
  const v2 = parseSortValue(b, key)

  // Empty values (- / empty string / null) always sort last
  if (v1 === null) return 1
  if (v2 === null) return -1

  const n1 = typeof v1 === 'number'
  const n2 = typeof v2 === 'number'
  if (n1 && n2) return order === 'asc' ? v1 - v2 : v2 - v1
  if (n1 !== n2) return n1 ? -1 : 1 // A column never mixes types; fallback: numbers first

  const s1 = String(v1)
  const s2 = String(v2)
  return order === 'asc' ? s1.localeCompare(s2) : s2.localeCompare(s1)
}

export function sortRows<T extends Record<string, any>>(
  data: T[],
  key: string,
  order: SortOrder
): T[] {
  if (!key) return [...data]
  return [...data].sort((a, b) => compareForSort(a, b, key, order))
}
