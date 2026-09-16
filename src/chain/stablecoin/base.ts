export interface StablecoinAdapter {
  mint?(amount: bigint, data?: any): Promise<string>     // e.g. Ethena mint
  redeem?(amount: bigint, data?: any): Promise<string>   // e.g. Ethena redeem
  transfer?(to: string, amount: bigint): Promise<string> // ERC20 transfer
  approve?(amount: bigint, assetAddress?: string): Promise<string> // ERC20 approve (supports different assets)
  balanceOf?(account: string): Promise<bigint>          // Get balance
  // = = = = = Staking (Revenue Contract) = = = = =
  stake?(amount: bigint, account?: `0x${string}`, assetAddress?: string): Promise<string>
  unstake?(shares: bigint, account?: `0x${string}`): Promise<string>
  withdraw?(amount: bigint, account?: `0x${string}`): Promise<string>
  claim?(account?: `0x${string}`): Promise<string> // e.g. Ethena: claim pending cooldown USDe
  /** Query unstake status (pending / claimable), wei precision. E.g. Ethena cooldown slot. */
  getUnstakeStatus?(account: `0x${string}`): Promise<{
    pending: bigint
    claimable: bigint
  }>
}
