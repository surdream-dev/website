export interface StakeProtocolRate {
  /** Annualized yield (e.g. 2.43 for 2.43%) */
  apy: number
  /** Agreed total locked value (wei unit) */
  tvl: bigint
}

/** Result of an on-chain unstake liquidity pre-check (e.g. Rocket Pool rETH burn liquidity). */
export interface UnstakeLiquidity {
  /** ETH required to cover this unstake (wei) */
  requiredEthWei: bigint
  /** ETH currently available in the pool for unstakes (wei) */
  availableEthWei: bigint
  /** true when available < required (the burn would revert with "Insufficient liquidity") */
  insufficient: boolean
}

export interface StakeAdapter {
  deposit(amount: bigint, account?: `0x${string}`): Promise<string>
  unstake(amount: bigint, account?: `0x${string}`): Promise<string>
  withdraw?(requestIds: bigint[], account?: `0x${string}`): Promise<string>
  wrap?(amount: bigint, account?: `0x${string}`): Promise<string>
  claim?(account?: `0x${string}`): Promise<string>
  /** Query the number of withdrawal/claims a user can claim (wei) */
  getClaimableAmount?(account: `0x${string}`): Promise<bigint>
  /** Query unstake status (distinguish pending and claimable), return wei precision */
  getUnstakeStatus?(account: `0x${string}`): Promise<{
    pending: bigint
    claimable: bigint
    tickets?: { positionTicket: bigint; shares: bigint; exitedAssets: bigint; timestamp: bigint; exitQueueIndex: bigint }[]
  }>
  /** Get on-chain agreement real-time rates and TVL */
  getMarketData?(): Promise<StakeProtocolRate>
  /** 1 Number of ETH redeemable voucher tokens (Stake pop-up exchange rate display/estimate) */
  getStakeRate?(): Promise<number>
  /** 1 Number of ETH that can be redeemed for voucher tokens (Unstake pop-up exchange rate display/estimate) */
  getUnstakeRate?(): Promise<number>
  /** Pre-check unstake liquidity on-chain (e.g. Rocket Pool rETH burn pool liquidity). Returns undefined when not applicable/unreadable. */
  getUnstakeLiquidity?(amount: bigint): Promise<UnstakeLiquidity | undefined>
}
