/**
 * Portfolio Type Definitions
 * * Used by usePortfolio.ts and its child components.
 * (2026-08-14: api/mock/portfolio.mock.ts mentioned in the original comment was removed in the dead-code cleanup)
 */

export interface PortfolioSummary {
  totalAssets: {
    value: number
    formatted: string
    change24h: number
    change24hFormatted: string
  }
  totalEarnings: {
    value: number
    formatted: string
    change7d: number
    change7dFormatted: string
  }
  breakdown: {
    staking: { value: number; formatted: string; percent: number }
    stablecoin: { value: number; formatted: string; percent: number }
    lending: { value: number; formatted: string; percent: number }
  }
}

export interface PortfolioPosition {
  id: string
  protocol: string
  protocolId: string
  asset: string
  assetAddress: string
  /** Lending pool id for pooled protocols (Compound/Morpho/Fluid), e.g. compound-usdc / morpho-usdt / fluid-eth.
   *  Carried through so the operation modal scopes withdraw/borrow to the exact pool the user clicked
   *  (shared-collateral pools like Compound ETH in USDC vs USDT would otherwise resolve to the wrong pool). */
  poolId?: string
  /** Pool borrowable asset for single-collateral/single-borrow lending pools (Compound/Morpho/Fluid);
   *  used to distinguish supplies that share the same collateral across pools (e.g. Compound ETH in USDC vs USDT pools). */
  loanAsset?: string
  receiptToken?: string
  receiptTokenSymbol?: string
  category: 'staking' | 'stablecoin' | 'lending-supply' | 'lending-borrow' | 'lending-liquidity'
  type: 'stake' | 'restake' | 'withdraw' | 'vault' | 'supply' | 'borrow' | 'liquidity'
  balance: string
  balanceUsd: string
  /** Raw numeric USD value of this position (balanceUsd may be a formatted string like "<$0.01",
   *  which is ambiguous for precise dust-thresholding). Used to hide < $0.001 dust positions. */
  balanceUsdNum?: number
  apy: number
  apyFormatted: string
  earnings: string
  earningsUsd: string
  depositDate: string
  lastUpdate: string
  icon: string
  assetIcon: string
  decimals?: number
  /** Protocol-level TVL (formatted, e.g. "123.456 ETH"); fills the stake modal's Stake-tab TVL. */
  tvl?: string
  approveSpender?: string
  /** ALL page only: Lending categories merged into a matching Stablecoin row. */
  overlappedLendingCategories?: ('lending-supply' | 'lending-liquidity')[]
}

export interface PortfolioTransaction {
  id: string
  date: string
  timestamp: number
  protocol: string
  protocolId: string
  poolId?: string
  asset: string
  category: 'staking' | 'stablecoin' | 'lending'
  action: 'stake' | 'unstake' | 'deposit' | 'withdraw' | 'claim' | 'supply' | 'borrow' | 'repay' | 'add-liquidity' | 'remove-liquidity'
  amount: string
  amountUsd: string
  txHash: string
  status: 'success' | 'pending' | 'failed'
  gasUsed: string
  gasUsd: string
  icon: string
}

export interface LendingPositionInfo {
  supplied: {
    poolId: string
    protocolId: string
    protocol: string
    asset: string
    assetAddress: string
    collateral: boolean
  }[]
  borrowed: {
    poolId: string
    protocolId: string
    protocol: string
    asset: string
    assetAddress: string
  }[]
  availableToSupply: {
    poolId: string
    protocolId: string
    protocol: string
    asset: string
    assetAddress: string
  }[]
  availableToBorrow: {
    poolId: string
    protocolId: string
    protocol: string
    asset: string
    assetAddress: string
  }[]
}

export interface SupplyBalance {
  poolId: string
  protocolId: string
  protocol: string
  asset: string
  assetAddress: string
  receiptToken?: string
  receiptTokenSymbol?: string
  balanceWei: bigint
  balance: string
  balanceUsd: string
  collateral: boolean
  apy: number
  apyFormatted: string
  loading: boolean
  error: string | null
}

export interface BorrowBalance {
  poolId: string
  protocolId: string
  protocol: string
  asset: string
  assetAddress: string
  balanceWei: bigint
  balance: string
  balanceUsd: string
  apy: number
  apyFormatted: string
  loading: boolean
  error: string | null
}
