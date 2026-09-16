export interface PoolRateInfo {
  /** Asset address (lowercase) */
  assetAddress: string
  /** Supply APY (e.g. 3.50 for 3.50%) */
  supplyAPY: number
  /** Borrowing APY (e.g. 5.00 for 5.00%) */
  borrowAPY: number
  /** Total pool supply (original wei) */
  totalSupply: bigint
  /** Total pool borrowings (original wei) */
  totalBorrow: bigint
  /** Across asset pools (e.g. Fluid): decimals of total supply (collateral precision, which may differ from borrowed assets) */
  supplyDecimals?: number
  /** Across asset pools (e.g. Fluid): decimals of total borrowings */
  borrowDecimals?: number
  /** Across asset pools (e.g. Fluid): supply rates that provide liquidity to borrowed assets (fToken supplyRate, e.g. fUSDC 4.75%) */
  liquidityAPY?: number
  /** Maximum LTV (%, e.g. 82.5). The data source can be found in each adapter getMarketData; if it is missing, the caller will fallback config */
  maxLtv?: number
  /** Liquidation threshold (%, e.g. 85.0). For data sources, see each adapter getMarketData */
  liquidationThreshold?: number
  /** Liquidation penalty (%, e.g. 5.0). Aave system = (liquidationBonus - 10000)/100; Morpho = LIF-1 (derived from LLTV); Fallback when Fluid/Compound is missing config */
  liquidationPenalty?: number
}

/** Normalized cross-protocol health snapshot for a user (account-level or per-pool). */
export interface HealthSnapshot {
  /** Risk-adjusted collateral value in USD: Σ(collateral_i × price_i × liquidationThreshold_i). */
  riskAdjustedCollateralUSD: number
  /** Total debt value in USD. */
  borrowUSD: number
  /** Representative liquidation threshold in basis points (1e4 = 100%), used for preview deltas. */
  liquidationThresholdBps: number
  /** True for account-level protocols (Aave/SparkLend); false for per-pool protocols. */
  isAccountLevel: boolean
  /** Display scope: '账户级' or the pool/market name. */
  scope: string
}

export interface LendingAdapter {
  supply(asset: `0x${string}`, amount: bigint, account: `0x${string}`, recipient?: string): Promise<string>
  borrow(asset: `0x${string}`, amount: bigint, account: `0x${string}`): Promise<string>
  repay(asset: `0x${string}`, amount: bigint, account: `0x${string}`): Promise<string>
  withdraw(asset: `0x${string}`, amount: bigint, account: `0x${string}`): Promise<string>

  setCollateral(asset: `0x${string}`, enable: boolean, account?: `0x${string}`): Promise<string>

  getSupplyBalance?(account: `0x${string}`, asset?: string, poolId?: string): Promise<bigint>
  getBorrowBalance?(account: `0x${string}`, asset?: string, poolId?: string): Promise<bigint>
  getAvailableBorrows?(account: `0x${string}`): Promise<bigint>
  /** Returns the amount borrowed by the user for each asset under this agreement (assetAddress → debtWei) */
  getBorrowBalances?(account: `0x${string}`): Promise<Map<string, bigint>>
  /** Returns the debit limit (USD cents) by pool (loanToken address) for pooling protocol presentation */
  getAvailableBorrowsByPool?(account: `0x${string}`): Promise<Map<string, bigint>>
  /** Full repayment: repayment of all outstanding borrowings of specified assets */
  repayAll?(asset: `0x${string}`, account: `0x${string}`): Promise<string>
  /** Discover all positions of the user under the agreement from the chain (instead of backend API data) */
  discoverPositions?(account: `0x${string}`): Promise<{
    supplied: Array<{
      poolId: string
      protocolId: string
      protocol: string
      asset: string
      assetAddress: string
      collateral: boolean
    }>
    borrowed: Array<{
      poolId: string
      protocolId: string
      protocol: string
      asset: string
      assetAddress: string
    }>
  }>
  /** Get real-time interest rate and pool volume data for this agreement (instead of hard-coded APY) */
  getMarketData?(): Promise<PoolRateInfo[]>
  /** Query risk parameters by pool + collateralized assets (each pool is independent of each asset factor such as Compound, and the agreement-level map cannot be expressed) */
  getCollateralRisk?(poolId: string, asset: string): Promise<{ maxLtv?: number; liquidationThreshold?: number; liquidationPenalty?: number } | undefined>
  /** Get the user's health snapshot (account-level or per-pool). Returns undefined when unavailable. */
  getHealthSnapshot?(account: `0x${string}`, poolId?: string): Promise<HealthSnapshot | undefined>
  /** Protocol minimum borrow (human units) enforced on-chain (e.g. Compound baseBorrowMin). Returns undefined when not applicable. */
  getMinimumBorrow?(poolId?: string, asset?: string): Promise<number | undefined>
}
