/**
 * Shared util: uniformly complete the selectedItem fields for lending operation modals
 * Shared by all entry points (Lending page / Portfolio ALL / Portfolio Lending sub-panels)
 */
import { lendingPools, lendingProtocols } from '@/constants/protocols'
import { lending } from '@/chain/lending'
import { ADDRESSES } from '@/chain/evm/addresses'
import { getLendingPrices, getPriceByAddress } from './useLendingPrices'

export interface EnrichedLendingItem {
  poolId: string
  protocolId: string
  protocol: string
  asset: string
  assetAddress: string
  decimals: number
  loanAsset: string
  loanAssetAddress: string
  loanDecimals: number
  receiptToken: string
  receiptTokenSymbol: string
  maxLtv?: number
  liquidationThreshold?: number
  liquidationPenalty?: number
  // The following are optional fields (kept when present upstream, otherwise undefined)
  balance?: string
  balanceWei?: bigint
  balanceUsd?: string
  available?: string
  apy?: number
  apyFormatted?: string
  supplyAPY?: string
  borrowAPY?: string
}

const DEFAULT_RISK = { maxLtv: 80, liquidationThreshold: 83, liquidationPenalty: 5 }

/** Fill in the complete fields needed for pooled protocols from lendingPools + lendingProtocols */
export function enrichLendingItem(raw: any, category: 'supply' | 'borrow'): EnrichedLendingItem {
  const rawAddr = (raw.assetAddress || raw.loanAssetAddress || '').toLowerCase()

  // 1. Find the matching lendingPool
  // poolId exact match must take priority over protocolId + asset matching. Several pools share a
  // protocolId and collateral asset (fluid-usdt/usdc both have protocolId 'fluid' with ETH collateral),
  // so a single find() could match e.g. a fluid-eth ETH row to fluid-usdt first and pick up the wrong
  // vault's risk. Try the exact poolId first, then fall back to protocolId + asset address.
  const pool =
    (raw.poolId && lendingPools.find(p => p.poolId === raw.poolId)) ||
    (raw.protocolId && lendingPools.find(p => {
      if (p.protocolId !== raw.protocolId) return false
      // Check the collateral or borrow address
      const collatAddrs = (p.collateralAssets || []).map(a => a.address.toLowerCase())
      if (collatAddrs.includes(rawAddr)) return true
      if (p.borrowAddress?.toLowerCase() === rawAddr) return true
      if (p.liquidityAddress?.toLowerCase() === rawAddr) return true
      if (p.collateralAddress?.toLowerCase() === rawAddr) return true
      return false
    }))

  // 2. Find the matching lendingProtocol (richer metadata)
  // Handle rows missing assetAddress: match by protocolId / poolId / display name + asset symbol
  const proto = lendingProtocols.find(p => {
    const sameProto =
      (raw.protocolId && p.protocolId === raw.protocolId) ||
      (raw.poolId && p.protocolId === raw.poolId) ||
      (raw.protocol && p.protocol === raw.protocol) ||
      (raw.protocol && p.name === raw.protocol)
    if (!sameProto) return false
    if (rawAddr && p.assetAddress?.toLowerCase() === rawAddr) return true
    return (p.asset || '').toLowerCase() === (raw.asset || '').toLowerCase()
  })

  const poolId = raw.poolId || pool?.poolId || raw.protocolId || proto?.protocolId || ''
  const protocolId = raw.protocolId || pool?.protocolId || proto?.protocolId || ''
  const protocol = raw.protocol || pool?.displayName || protocolId

  // 3. Determine decimals
  const decimals = raw.decimals || raw.loanDecimals || proto?.decimals || poolDecimals(pool, raw) || 18
  const loanDecimals = raw.loanDecimals || decimals

  // 3.5 Determine the underlying asset address (fill from config when missing so withdraw can find on-chain supply/borrow)
  const assetAddress = raw.assetAddress || proto?.assetAddress || poolAssetAddress(pool, raw.asset || '')

  // 4. Determine the loan asset
  const loanAsset = raw.loanAsset || pool?.borrowAsset || raw.asset || ''
  const loanAssetAddress = raw.loanAssetAddress || raw.assetAddress || proto?.assetAddress || pool?.borrowAddress || poolAssetAddress(pool, raw.loanAsset || raw.asset || '')

  // 5. receipt token
  const receiptToken = raw.receiptToken || proto?.receiptToken || proto?.contracts?.aToken || ''
  const receiptTokenSymbol = raw.receiptTokenSymbol || proto?.receiptTokenSymbol || ''

  // 6. risk
  // Priority: raw.risk → pool.risk (specific, e.g. Fluid's per-vault LTV) → lendingProtocols asset risk → default.
  // Including pool.risk keeps the Portfolio entry (assets.vue/supply.vue, which pass no raw.risk) consistent with the
  // Lending page entry (which passes pool.risk || sa.risk). Without it, e.g. fluid-eth wstETH shows 95% on the Lending
  // page but 80% from Portfolio because lendingProtocols has no fluid/wstETH entry and falls back to the default.
  const risk = raw.risk || pool?.risk || proto?.risk || DEFAULT_RISK

  return {
    ...raw,
    poolId,
    protocolId,
    protocol,
    assetAddress,
    decimals,
    loanAsset: category === 'borrow' ? (raw.asset || loanAsset) : loanAsset,
    loanAssetAddress: category === 'borrow' ? (assetAddress || loanAssetAddress) : loanAssetAddress,
    loanDecimals,
    receiptToken,
    receiptTokenSymbol,
    maxLtv: risk.maxLtv,
    liquidationThreshold: risk.liquidationThreshold,
    liquidationPenalty: risk.liquidationPenalty,
  }
}

// Find the address by symbol among the lendingPool's collateral/liquidity/borrow assets (fallback when the row lacks assetAddress)
function poolAssetAddress(pool: any, symbol: string): string {
  if (!pool || !symbol) return ''
  const all = [
    ...(pool.collateralAssets || []),
    ...(pool.liquidityAssets || []),
    ...(pool.borrowAssets || []),
  ]
  const hit = all.find(a => a.symbol?.toLowerCase() === symbol.toLowerCase())
  return hit?.address || ''
}

function poolDecimals(pool: any, raw: any): number | undefined {
  // Look it up in KNOWN_DECIMALS
  const KNOWN: Record<string, number> = {
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': 18,
    [ADDRESSES.tokens.WETH.toLowerCase()]: 18,
    [ADDRESSES.tokens.wstETH.toLowerCase()]: 18,
    [ADDRESSES.tokens.WBTC.toLowerCase()]: 8,
    [ADDRESSES.tokens.USDC.toLowerCase()]: 6,
    [ADDRESSES.tokens.USDT.toLowerCase()]: 6,
    [ADDRESSES.tokens.DAI.toLowerCase()]: 18,
  }
  const addr = (raw.assetAddress || raw.loanAssetAddress || '').toLowerCase()
  return KNOWN[addr]
}

/**
 * Query a user's outstanding borrow (wei) on-chain for an asset in a pool/protocol.
 * * Prefer getBorrowBalances (aave/sparklend/compound/morpho/fluid all return assetAddress → wei);
 * fall back to getBorrowBalance only for protocols that return per-asset wei (Aave/SparkLend's getBorrowBalance returns a USD total and cannot be used per asset;
 * Compound maps WETH to the ETH placeholder address, so query per poolId).
 */
export async function fetchLendingBorrowedBalance(opts: {
  account?: string
  poolId?: string
  protocolId?: string
  assetAddress?: string
}): Promise<bigint> {
  const { account, poolId, protocolId, assetAddress } = opts
  if (!account || !assetAddress) return 0n

  const adapter = lending.getByPool(poolId || protocolId || '')
  if (!adapter) return 0n

  try {
    // Per-asset borrow balance
    if (adapter.getBorrowBalances) {
      const balances = await adapter.getBorrowBalances(account as `0x${string}`)
      const key = assetAddress.toLowerCase()
      for (const [addr, wei] of balances) {
        if (addr.toLowerCase() === key && wei > 0n) return wei
      }
    }

    // Fallback: only for protocols with per-asset semantics
    const baseProtocol = (protocolId || poolId || '').split('-')[0]
    if (adapter.getBorrowBalance && ['compound', 'fluid', 'morpho'].includes(baseProtocol)) {
      return await adapter.getBorrowBalance(account as `0x${string}`, assetAddress, poolId)
    }
  } catch (e) {
    console.warn('[Lending] fetchLendingBorrowedBalance failed:', e)
  }
  return 0n
}

const LOAN_DECIMALS: Record<string, number> = {
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': 18,
  [ADDRESSES.tokens.WETH.toLowerCase()]: 18,
  [ADDRESSES.tokens.wstETH.toLowerCase()]: 18,
  [ADDRESSES.tokens.WBTC.toLowerCase()]: 8,
  [ADDRESSES.tokens.USDC.toLowerCase()]: 6,
  [ADDRESSES.tokens.USDT.toLowerCase()]: 6,
  [ADDRESSES.tokens.DAI.toLowerCase()]: 18,
}

/**
 * Estimate a user's borrow amount (USD) in a pool/protocol.
 * - Aave/SparkLend: getBorrowBalance returns the account's total debt (USD, 8 decimals); convert directly.
 * - Pooled protocols (compound/morpho/fluid): debt sits on the loan asset; query by the pool's borrowAddress,
 * then convert to USD by the loan asset price (avoid querying the collateral address as the debt asset and undercounting).
 */
export async function fetchLendingBorrowUSD(opts: {
  account?: string
  poolId?: string
  protocolId?: string
  suppliedAssetAddress?: string
}): Promise<number> {
  const { account, poolId, protocolId, suppliedAssetAddress } = opts
  if (!account) return 0

  const base = (protocolId || poolId || '').split('-')[0]
  const adapter = lending.getByPool(poolId || protocolId || '')
  if (!adapter) return 0

  try {
    // Aave / SparkLend: account-level total debt (USD, 8 decimals)
    if (base === 'aave' || base === 'sparklend') {
      if (!adapter.getBorrowBalance) return 0
      const totalDebtBase = await adapter.getBorrowBalance(account as `0x${string}`)
      return totalDebtBase > 0n ? Number(totalDebtBase) / 1e8 : 0
    }

    // Pooled protocols: borrow on the pool's loan asset
    const pool = poolId ? lendingPools.find(p => p.poolId === poolId) : undefined
    const loanAddress = pool?.borrowAddress || suppliedAssetAddress || ''
    if (!loanAddress) return 0

    const debtWei = await fetchLendingBorrowedBalance({
      account,
      poolId,
      protocolId,
      assetAddress: loanAddress
    })
    if (debtWei <= 0n) return 0

    const prices = await getLendingPrices()
    const priceFromFeed = getPriceByAddress(prices, loanAddress)
    const isStable = pool?.borrowAsset ? ['USDC', 'USDT', 'DAI'].includes(pool.borrowAsset) : false
    const usdPrice = priceFromFeed > 0 ? priceFromFeed : (isStable ? 1 : 0)
    if (usdPrice <= 0) return 0

    const decimals = LOAN_DECIMALS[loanAddress.toLowerCase()] ?? 18
    return Number(debtWei) / 10 ** decimals * usdPrice
  } catch (e) {
    console.warn('[Lending] fetchLendingBorrowUSD failed:', e)
    return 0
  }
}
