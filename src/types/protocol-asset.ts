/**
 * Protocol-asset mapping type definitions
 * Ensures consistency between Mock data and Adapters
 */

// ==================== Lending protocols (legacy: protocol-asset dimension) ====================
export type LendingProtocolId = 'aave' | 'compound' | 'morpho' | 'sparklend' | 'curve' | 'fluid'

export type LendingAsset = 'ETH' | 'stETH' | 'wstETH' | 'USDT' | 'USDC' | 'DAI' | 'WBTC'

// Asset mapping supported by Lending protocols
export const LENDING_SUPPORTED: Record<LendingProtocolId, LendingAsset[]> = {
  aave: ['ETH', 'stETH', 'wstETH', 'USDT', 'USDC', 'DAI', 'WBTC'],
  compound: ['ETH', 'USDT', 'USDC', 'WBTC'],  // Compound V3: USDC, USDT, WETH; V2: WBTC
  morpho: ['ETH', 'USDT', 'USDC', 'WBTC'],
  sparklend: ['ETH', 'USDT'],
  curve: [],  // Curve lending adapter exists but is not used in the Mock data
  fluid: ['ETH', 'USDT']
}

// ==================== Lending pooled model (new) ====================
export type LendingPoolId =
  | 'aave'
  | 'sparklend'
  | 'compound-eth'
  | 'compound-usdc'
  | 'compound-usdt'
  | 'morpho-usdt'
  | 'morpho-usdc'
  | 'fluid-usdt'
  | 'fluid-usdc'
  | 'fluid-eth'

export interface LendingPoolMeta {
  poolId: LendingPoolId
  protocolId: LendingProtocolId
  displayName: string
  isCrossAsset: boolean
  collateralAssets: { symbol: string; address: string }[]
  borrowAssets: { symbol: string; address: string }[]
  /**
 * Main collateral (the primary collateral for single-collateral/single-borrow pools)
 * Cross-asset pools Aave/SparkLend have no main collateral
 */
  primaryCollateral?: { symbol: string; address: string }
  primaryBorrow?: { symbol: string; address: string }
}

export const LENDING_POOLS: LendingPoolMeta[] = [
  {
    poolId: 'aave',
    protocolId: 'aave',
    displayName: 'AAVE',
    isCrossAsset: true,
    collateralAssets: [
      { symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
      { symbol: 'wstETH', address: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0' },
      { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
      { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' },
      { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
      { symbol: 'tBTC', address: '0x18084fbA666a33d37592fA2633fD49a74DD93a88' },
    ],
    borrowAssets: [
      { symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
      { symbol: 'wstETH', address: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0' },
      { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
      { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' },
      { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
      { symbol: 'tBTC', address: '0x18084fbA666a33d37592fA2633fD49a74DD93a88' },
    ],
  },
  {
    poolId: 'sparklend',
    protocolId: 'sparklend',
    displayName: 'SparkLend',
    isCrossAsset: true,
    collateralAssets: [
      { symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
      { symbol: 'wstETH', address: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0' },
      { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
      { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
    ],
    borrowAssets: [
      { symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
      { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
    ],
  },
  {
    poolId: 'compound-eth',
    protocolId: 'compound',
    displayName: 'Compound-ETH',
    isCrossAsset: false,
    collateralAssets: [
      { symbol: 'wstETH', address: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0' },
    ],
    borrowAssets: [
      { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
    ],
    primaryCollateral: { symbol: 'wstETH', address: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0' },
    primaryBorrow: { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
  },
  {
    poolId: 'compound-usdc',
    protocolId: 'compound',
    displayName: 'Compound-USDC',
    isCrossAsset: false,
    collateralAssets: [
      { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
      { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
    ],
    borrowAssets: [
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
    ],
    primaryBorrow: { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  },
  {
    poolId: 'compound-usdt',
    protocolId: 'compound',
    displayName: 'Compound-USDT',
    isCrossAsset: false,
    collateralAssets: [
      { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
      { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
    ],
    borrowAssets: [
      { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
    ],
    primaryBorrow: { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
  },
  {
    poolId: 'morpho-usdt',
    protocolId: 'morpho',
    displayName: 'Morpho-USDT',
    isCrossAsset: false,
    collateralAssets: [
      { symbol: 'wstETH', address: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0' },
    ],
    borrowAssets: [
      { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
    ],
    primaryCollateral: { symbol: 'wstETH', address: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0' },
    primaryBorrow: { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
  },
  {
    poolId: 'morpho-usdc',
    protocolId: 'morpho',
    displayName: 'Morpho-USDC',
    isCrossAsset: false,
    collateralAssets: [
      { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
    ],
    borrowAssets: [
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
    ],
    primaryCollateral: { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
    primaryBorrow: { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  },
  {
    poolId: 'fluid-usdt',
    protocolId: 'fluid',
    displayName: 'Fluid-USDT',
    isCrossAsset: false,
    collateralAssets: [
      { symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
    ],
    borrowAssets: [
      { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
    ],
    primaryCollateral: { symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
    primaryBorrow: { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
  },
  {
    poolId: 'fluid-usdc',
    protocolId: 'fluid',
    displayName: 'Fluid-USDC',
    isCrossAsset: false,
    collateralAssets: [
      { symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
    ],
    borrowAssets: [
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
    ],
    primaryCollateral: { symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
    primaryBorrow: { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  },
  {
    poolId: 'fluid-eth',
    protocolId: 'fluid',
    displayName: 'Fluid-ETH',
    isCrossAsset: false,
    collateralAssets: [
      { symbol: 'wstETH', address: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0' },
    ],
    borrowAssets: [
      { symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
    ],
    primaryCollateral: { symbol: 'wstETH', address: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0' },
    primaryBorrow: { symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
  },
]

// ==================== Stake protocols ====================
export type StakeProtocolId = 'lido' | 'rocketpool' | 'etherfi' | 'stakewise' | 'meth' | 'stader'

export type StakeAsset = 'ETH'

// All Stake protocols support ETH
export const STAKE_SUPPORTED: Record<StakeProtocolId, StakeAsset[]> = {
  lido: ['ETH'],
  rocketpool: ['ETH'],
  etherfi: ['ETH'],
  stakewise: ['ETH'],
  meth: ['ETH'],
  stader: ['ETH'],
}

// ==================== Stablecoin protocols ====================
export type StablecoinProtocolId = 'ethena' | 'curve'

export type StablecoinAsset = 'USDe' | 'USDT' | 'USDC' | 'DAI'

// Asset mapping supported by Stablecoin protocols
export const STABLECOIN_SUPPORTED: Record<StablecoinProtocolId, StablecoinAsset[]> = {
  ethena: ['USDe'],  // Ethena only supports staking USDe
  curve: ['USDT', 'USDC', 'DAI']  // Curve 3pool
}

// ==================== Validation functions ====================
export function isLendingSupported(protocol: string, asset: string): boolean {
  const supported = LENDING_SUPPORTED[protocol as LendingProtocolId]
  return supported?.includes(asset as LendingAsset) ?? false
}

export function isStakeSupported(protocol: string, asset: string): boolean {
  const supported = STAKE_SUPPORTED[protocol as StakeProtocolId]
  return supported?.includes(asset as StakeAsset) ?? false
}

export function isStablecoinSupported(protocol: string, asset: string): boolean {
  const supported = STABLECOIN_SUPPORTED[protocol as StablecoinProtocolId]
  return supported?.includes(asset as StablecoinAsset) ?? false
}

// ==================== All valid combinations ====================
export type ProtocolAssetPair = {
  type: 'lending' | 'stake' | 'stablecoin'
  protocol: string
  asset: string
}

export const ALL_VALID_PAIRS: ProtocolAssetPair[] = [
  // Lending
  ...Object.entries(LENDING_SUPPORTED).flatMap(([protocol, assets]) =>
    assets.map(asset => ({ type: 'lending' as const, protocol, asset }))
  ),
  // Stake
  ...Object.entries(STAKE_SUPPORTED).flatMap(([protocol, assets]) =>
    assets.map(asset => ({ type: 'stake' as const, protocol, asset }))
  ),
  // Stablecoin
  ...Object.entries(STABLECOIN_SUPPORTED).flatMap(([protocol, assets]) =>
    assets.map(asset => ({ type: 'stablecoin' as const, protocol, asset }))
  )
]
