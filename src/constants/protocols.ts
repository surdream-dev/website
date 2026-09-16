/**
 * Protocol Registry
 * * Protocol metadata registry — replaces the structural info in Mock data (contract addresses, decimals, risk params, etc.).
 * No metric data like TVL/APY; only metadata that rarely changes.
 * * APY defaults are UI fallbacks only; real data should come from the API or on-chain.
 * * Usage:
 * import { lendingProtocols, stakeProtocols, stablecoinProtocols, getProtocolByAsset } from '@/constants/protocols'
 */

// ============================================================
// Lending protocols
// ============================================================

export interface LendingProtocolMeta {
  protocolId: string
  protocol: string
  chain: string
  name: string
  asset: string
  assetAddress: string
  decimals: number
  receiptToken?: string
  receiptTokenSymbol?: string
  logo?: string
  risk: {
    maxLtv?: number
    liquidationThreshold?: number
    liquidationPenalty?: number
  }
  contracts: {
    aToken?: string
    pool?: string
  }
  defaultSupplyApy: number
  defaultBorrowApy: number
  launchYear: number
}

export const lendingProtocols: LendingProtocolMeta[] = [
  // ---- Aave ----
  {
    protocolId: 'aave', protocol: 'aave', chain: 'ETH', name: 'AAVE',
    asset: 'ETH', assetAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18,
    receiptToken: '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8', receiptTokenSymbol: 'aWETH',
    risk: { maxLtv: 80.5, liquidationThreshold: 83.0, liquidationPenalty: 5.0 },
    contracts: { aToken: '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8', pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' },
    defaultSupplyApy: 2.15, defaultBorrowApy: 3.42, launchYear: 2017,
  },
  {
    protocolId: 'aave', protocol: 'aave', chain: 'ETH', name: 'AAVE',
    asset: 'wstETH', assetAddress: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0', decimals: 18,
    receiptToken: '0x0B925eD163218f6662a35e0f0371Ac234f9E9371', receiptTokenSymbol: 'awstETH',
    risk: { maxLtv: 78.5, liquidationThreshold: 81.0, liquidationPenalty: 6.0 },
    contracts: { aToken: '0x828b154032950C8ff7CF8085D841723Db2696056', pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' },
    defaultSupplyApy: 2.52, defaultBorrowApy: 3.75, launchYear: 2017,
  },
  {
    protocolId: 'aave', protocol: 'aave', chain: 'ETH', name: 'AAVE',
    asset: 'USDT', assetAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6,
    receiptToken: '0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a', receiptTokenSymbol: 'aUSDT',
    risk: { maxLtv: 75.0, liquidationThreshold: 78.0, liquidationPenalty: 4.5 },
    contracts: { aToken: '0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a', pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' },
    defaultSupplyApy: 4.35, defaultBorrowApy: 6.12, launchYear: 2017,
  },
  {
    protocolId: 'aave', protocol: 'aave', chain: 'ETH', name: 'AAVE',
    asset: 'USDC', assetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6,
    receiptToken: '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c', receiptTokenSymbol: 'aUSDC',
    risk: { maxLtv: 75.0, liquidationThreshold: 78.0, liquidationPenalty: 4.5 },
    contracts: { aToken: '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c', pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' },
    defaultSupplyApy: 3.92, defaultBorrowApy: 5.48, launchYear: 2017,
  },
  {
    protocolId: 'aave', protocol: 'aave', chain: 'ETH', name: 'AAVE',
    asset: 'DAI', assetAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18,
    receiptToken: '0x018008bfb33d285247A21d44E50697654f754e63', receiptTokenSymbol: 'aDAI',
    risk: { maxLtv: 0.0, liquidationThreshold: 77.0, liquidationPenalty: 5.0 },
    contracts: { aToken: '0x018008bfb33d285247A21d44E50697654f754e63', pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' },
    defaultSupplyApy: 3.68, defaultBorrowApy: 5.15, launchYear: 2017,
  },
  {
    protocolId: 'aave', protocol: 'aave', chain: 'ETH', name: 'AAVE',
    asset: 'WBTC', assetAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8,
    receiptToken: '0x5Ee5bf7ae06D1Be5997A1A72006FE6C607eC6DE8', receiptTokenSymbol: 'aWBTC',
    risk: { maxLtv: 73.0, liquidationThreshold: 78.0, liquidationPenalty: 5.0 },
    contracts: { aToken: '0x5Ee5bf7ae06D1Be5997A1A72006FE6C607eC6DE8', pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' },
    defaultSupplyApy: 1.85, defaultBorrowApy: 2.95, launchYear: 2017,
  },


  // ---- Compound ----
  {
    protocolId: 'compound', protocol: 'compound', chain: 'ETH', name: 'Compound',
    asset: 'ETH', assetAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18,
    receiptToken: '0xA17581A9E3356d9A858b789D68B4d866e593aE94', receiptTokenSymbol: 'cETH',
    risk: { maxLtv: 83.0, liquidationThreshold: 88.0, liquidationPenalty: 7.0 },
    contracts: { aToken: '0xA17581A9E3356d9A858b789D68B4d866e593aE94', pool: '0xA17581A9E3356d9A858b789D68B4d866e593aE94' },
    defaultSupplyApy: 1.95, defaultBorrowApy: 3.15, launchYear: 2017,
  },
  {
    protocolId: 'compound', protocol: 'compound', chain: 'ETH', name: 'Compound',
    asset: 'USDT', assetAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6,
    receiptToken: '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840', receiptTokenSymbol: 'cUSDT',
    risk: { maxLtv: 82.0, liquidationThreshold: 85.0, liquidationPenalty: 4.5 },
    contracts: { aToken: '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840', pool: '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840' },
    defaultSupplyApy: 3.85, defaultBorrowApy: 5.42, launchYear: 2017,
  },
  {
    protocolId: 'compound', protocol: 'compound', chain: 'ETH', name: 'Compound',
    asset: 'USDC', assetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6,
    receiptToken: '0xc3d688B66703497DAA19211EEdff47f25384cdc3', receiptTokenSymbol: 'cUSDC',
    risk: { maxLtv: 83.0, liquidationThreshold: 86.0, liquidationPenalty: 4.0 },
    contracts: { aToken: '0xc3d688B66703497DAA19211EEdff47f25384cdc3', pool: '0xc3d688B66703497DAA19211EEdff47f25384cdc3' },
    defaultSupplyApy: 3.52, defaultBorrowApy: 4.95, launchYear: 2017,
  },
  {
    protocolId: 'compound', protocol: 'compound', chain: 'ETH', name: 'Compound',
    asset: 'WBTC', assetAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8,
    receiptToken: '0xC11b1268C1A384e55C48c2391d8d480264A3A7F4', receiptTokenSymbol: 'cWBTC',
    risk: { maxLtv: 80.0, liquidationThreshold: 85.0, liquidationPenalty: 10.0 },
    contracts: { aToken: '0xC11b1268C1A384e55C48c2391d8d480264A3A7F4', pool: '0xC11b1268C1A384e55C48c2391d8d480264A3A7F4' },
    defaultSupplyApy: 1.65, defaultBorrowApy: 2.68, launchYear: 2017,
  },

  // ---- SparkLend ----
  {
    protocolId: 'sparklend', protocol: 'sparklend', chain: 'ETH', name: 'SparkLend',
    asset: 'ETH', assetAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18,
    receiptToken: '0x59cD1C87501baa753d0B5B5Ab5D8416A45cD71DB', receiptTokenSymbol: 'spWETH',
    risk: { maxLtv: 80.0, liquidationThreshold: 83.0, liquidationPenalty: 5.0 },
    contracts: { aToken: '0x59cD1C87501baa753d0B5B5Ab5D8416A45cD71DB', pool: '0xC13e21B648A5Ee794902342038FF3aDAB66BE987' },
    defaultSupplyApy: 2.18, defaultBorrowApy: 3.38, launchYear: 2023,
  },
  {
    protocolId: 'sparklend', protocol: 'sparklend', chain: 'ETH', name: 'SparkLend',
    asset: 'USDT', assetAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6,
    receiptToken: '0xe2e7a17dFf93280dec073C995595155283e3C372', receiptTokenSymbol: 'sparkUSDT',
    // USDT cannot be used as collateral (borrow-only) → no risk params, the Supply modal shows '-'
    risk: {},
    contracts: { aToken: '0x22a2dd8E3510E0909e2a2c16ACD21b0e698fD2b0', pool: '0xC13e21B648A5Ee794902342038FF3aDAB66BE987' },
    defaultSupplyApy: 4.25, defaultBorrowApy: 5.95, launchYear: 2023,
  },
  {
    protocolId: 'sparklend', protocol: 'sparklend', chain: 'ETH', name: 'SparkLend',
    asset: 'USDC', assetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6,
    receiptToken: '0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d', receiptTokenSymbol: 'sparkUSDC',
    // USDC cannot be used as collateral (borrow-only) → no risk params, the Supply modal shows '-'
    risk: {},
    contracts: { aToken: '0x98C23E9d8f34FEFb1B7BD6a91B9FFea4775685F5', pool: '0xC13e21B648A5Ee794902342038FF3aDAB66BE987' },
    defaultSupplyApy: 4.15, defaultBorrowApy: 5.85, launchYear: 2023,
  },
  {
    protocolId: 'sparklend', protocol: 'sparklend', chain: 'ETH', name: 'SparkLend',
    asset: 'wstETH', assetAddress: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', decimals: 18,
    receiptTokenSymbol: 'sparkwstETH',
    risk: { maxLtv: 78.0, liquidationThreshold: 81.0, liquidationPenalty: 5.0 },
    contracts: { pool: '0xC13e21B648A5Ee794902342038FF3aDAB66BE987' },
    defaultSupplyApy: 2.65, defaultBorrowApy: 3.85, launchYear: 2023,
  },
  {
    protocolId: 'sparklend', protocol: 'sparklend', chain: 'ETH', name: 'SparkLend',
    asset: 'WBTC', assetAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8,
    receiptTokenSymbol: 'sparkWBTC',
    risk: { maxLtv: 75.0, liquidationThreshold: 78.0, liquidationPenalty: 5.0 },
    contracts: { pool: '0xC13e21B648A5Ee794902342038FF3aDAB66BE987' },
    defaultSupplyApy: 1.85, defaultBorrowApy: 2.95, launchYear: 2023,
  },

  // ---- Morpho ----
  {
    protocolId: 'morpho', protocol: 'morpho', chain: 'ETH', name: 'Morpho',
    asset: 'USDT', assetAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6,
    receiptTokenSymbol: 'morphoUSDT',
    risk: { maxLtv: 86.0, liquidationThreshold: 86.0, liquidationPenalty: 4.38 },
    contracts: { pool: '0x33333aea097c193e66081E930c33020272b33333' },
    defaultSupplyApy: 4.58, defaultBorrowApy: 6.35, launchYear: 2021,
  },
  {
    protocolId: 'morpho', protocol: 'morpho', chain: 'ETH', name: 'Morpho',
    asset: 'USDC', assetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6,
    receiptToken: '0xdd0f28e19c1780eb6396170735d45153d261490d', receiptTokenSymbol: 'gtUSDC',
    risk: { maxLtv: 86.0, liquidationThreshold: 86.0, liquidationPenalty: 4.38 },
    contracts: { aToken: '0xdd0f28e19c1780eb6396170735d45153d261490d', pool: '0x33333aea097c193e66081E930c33020272b33333' },
    defaultSupplyApy: 4.12, defaultBorrowApy: 5.78, launchYear: 2021,
  },

  // ---- Fluid ----
  {
    protocolId: 'fluid', protocol: 'fluid', chain: 'ETH', name: 'Fluid',
    asset: 'ETH', assetAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18,
    receiptTokenSymbol: 'fETH',
    // ETH is collateral for Fluid vaults 11 (USDC) / 12 (USDT) → 87/92/1. The 95/97/0.1 values
    // belong to vault 13 (wstETH collateral, fluid-eth pool), not the ETH asset.
    risk: { maxLtv: 87.0, liquidationThreshold: 92.0, liquidationPenalty: 1.0 },
    contracts: { aToken: '0x90551c1795392094FE6D29B758EcCD233cFAa260', pool: '0x90551c1795392094FE6D29B758EcCD233cFAa260' },
    defaultSupplyApy: 2.42, defaultBorrowApy: 3.68, launchYear: 2018,
  },
  {
    protocolId: 'fluid', protocol: 'fluid', chain: 'ETH', name: 'Fluid',
    asset: 'USDT', assetAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6,
    receiptTokenSymbol: 'fUSDT',
    risk: { maxLtv: 87.0, liquidationThreshold: 92.0, liquidationPenalty: 1.0 },
    contracts: { aToken: '0x5C20B550819128074FD538Edf79791733ccEdd18', pool: '0x5C20B550819128074FD538Edf79791733ccEdd18' },
    defaultSupplyApy: 4.42, defaultBorrowApy: 6.18, launchYear: 2018,
  },
  {
    protocolId: 'fluid', protocol: 'fluid', chain: 'ETH', name: 'Fluid',
    asset: 'USDC', assetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6,
    receiptTokenSymbol: 'fUSDC',
    risk: { maxLtv: 87.0, liquidationThreshold: 92.0, liquidationPenalty: 1.0 },
    contracts: { aToken: '0x9Fb7b4477576Fe5B32be4C1843aFB1e55F251B33', pool: '0x9Fb7b4477576Fe5B32be4C1843aFB1e55F251B33' },
    defaultSupplyApy: 4.38, defaultBorrowApy: 6.12, launchYear: 2018,
  },
]

// ============================================================
// Staking protocols
// ============================================================

export interface StakeProtocolMeta {
  protocolId: string
  chain: string
  name: string
  asset: string
  assetAddress: string
  decimals: number
  receiptTokenSymbol?: string
  category: 'stake' | 'restake'
  logo?: string
  contracts: {
    token: string
    staking: string
  }
  unstakePeriod: string
  defaultApy: number
  launchYear: number
}

export const stakeProtocols: StakeProtocolMeta[] = [
  {
    protocolId: 'lido', chain: 'ETH', name: 'Lido',
    asset: 'ETH', assetAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18,
    receiptTokenSymbol: 'stETH', category: 'stake',
    contracts: { token: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', staking: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84' },
    unstakePeriod: '1–5 days', defaultApy: 2.433, launchYear: 2020,
  },
  {
    protocolId: 'etherfi', chain: 'ETH', name: 'ether.fi',
    asset: 'ETH', assetAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18,
    receiptTokenSymbol: 'weETH', category: 'restake',
    contracts: { token: '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee', staking: '0xcfC6d9Bd7411962Bfe7145451A7EF71A24b6A7A2' },
    unstakePeriod: '~1 day', defaultApy: 2.435, launchYear: 2023,
  },
  {
    protocolId: 'rocketpool', chain: 'ETH', name: 'Rocket Pool',
    asset: 'ETH', assetAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18,
    receiptTokenSymbol: 'rETH', category: 'stake',
    contracts: { token: '0xae78736Cd615f374D3085123A210448E74Fc6393', staking: '0xCE15294273CFb9D9b628F4D61636623decDF4fdC' },
    unstakePeriod: 'Varies', defaultApy: 2.184, launchYear: 2017,
  },
  {
    protocolId: 'stakewise', chain: 'ETH', name: 'StakeWise',
    asset: 'ETH', assetAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18,
    receiptTokenSymbol: 'osETH', category: 'stake',
    contracts: { token: '0xf1C9acDc66974dFB6dEcB12aA385b9cD01190E38', staking: '0xBEeF69Ac7870777598A04B2bd4771c71212E6AbC' },
    unstakePeriod: '≥24 hours', defaultApy: 4.033, launchYear: 2019,
  },
  {
    protocolId: 'meth', chain: 'ETH', name: 'mETH',
    asset: 'ETH', assetAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18,
    receiptTokenSymbol: 'mETH', category: 'restake',
    contracts: { token: '0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa', staking: '0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f' },
    unstakePeriod: '12h–7.5 days', defaultApy: 2.745, launchYear: 2024,
  },
  {
    protocolId: 'stader', chain: 'ETH', name: 'Stader',
    asset: 'ETH', assetAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18,
    receiptTokenSymbol: 'ETHx', category: 'stake',
    contracts: { token: '0xA35b1B31CE002FBF2058D22F30F95D405200A15b', staking: '0xcf501b35091e4880C34e944a0Ea20E099c2482C8' },
    unstakePeriod: '7–10 days', defaultApy: 2.693, launchYear: 2021,
  },
]

// ============================================================
// Stablecoin protocols
// ============================================================

export interface StablecoinProtocolMeta {
  protocolId: string
  protocol: string
  chain: string
  name: string
  asset: string
  assetAddress: string
  decimals: number
  receiptTokenSymbol?: string
  category: 'lending' | 'vault'
  logo?: string
  curator?: { id: string; name: string }
  contracts: {
    token: string
    staking: string
  }
  defaultApy: number
  launchYear: number
}

export const stablecoinProtocols: StablecoinProtocolMeta[] = [
  // ---- Ethena ----
  {
    protocolId: 'ethena', protocol: 'ethena', chain: 'ETH', name: 'Ethena',
    asset: 'USDe', assetAddress: '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3', decimals: 18,
    receiptTokenSymbol: 'sUSDe', category: 'vault',
    curator: { id: 'ethena', name: 'Ethena' },
    contracts: { token: '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3', staking: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497' },
    defaultApy: 8.1, launchYear: 2023,
  },

  // ---- Curve ----
  {
    protocolId: 'curve', protocol: 'curve', chain: 'ETH', name: 'Curve',
    asset: 'USDT', assetAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6,
    receiptTokenSymbol: '3CRV', category: 'vault',
    curator: { id: 'curve-dao', name: 'Curve DAO' },
    contracts: { token: '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490', staking: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7' },
    defaultApy: 3.2, launchYear: 2020,
  },
  {
    protocolId: 'curve', protocol: 'curve', chain: 'ETH', name: 'Curve',
    asset: 'USDC', assetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6,
    receiptTokenSymbol: '3CRV', category: 'vault',
    curator: { id: 'curve-dao', name: 'Curve DAO' },
    contracts: { token: '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490', staking: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7' },
    defaultApy: 3.1, launchYear: 2020,
  },
  {
    protocolId: 'curve', protocol: 'curve', chain: 'ETH', name: 'Curve',
    asset: 'DAI', assetAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18,
    receiptTokenSymbol: '3CRV', category: 'vault',
    curator: { id: 'curve-dao', name: 'Curve DAO' },
    contracts: { token: '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490', staking: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7' },
    defaultApy: 2.9, launchYear: 2020,
  },

  // ---- Aave (stablecoin) ----
  {
    protocolId: 'aave', protocol: 'aave', chain: 'ETH', name: 'AAVE',
    asset: 'USDT', assetAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6,
    receiptTokenSymbol: 'aUSDT', category: 'lending',
    curator: { id: 'aave-dao', name: 'Aave DAO' },
    contracts: { token: '0xdAC17F958D2ee523a2206206994597C13D831ec7', staking: '0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a' },
    defaultApy: 4.35, launchYear: 2017,
  },
  {
    protocolId: 'aave', protocol: 'aave', chain: 'ETH', name: 'AAVE',
    asset: 'USDC', assetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6,
    receiptTokenSymbol: 'aUSDC', category: 'lending',
    curator: { id: 'aave-dao', name: 'Aave DAO' },
    contracts: { token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', staking: '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c' },
    defaultApy: 3.92, launchYear: 2017,
  },

  // ---- Compound (stablecoin) ----
  {
    protocolId: 'compound', protocol: 'compound', chain: 'ETH', name: 'Compound',
    asset: 'USDT', assetAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6,
    receiptTokenSymbol: 'cUSDT', category: 'lending',
    curator: { id: 'compound-dao', name: 'Compound DAO' },
    contracts: { token: '0xdAC17F958D2ee523a2206206994597C13D831ec7', staking: '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840' },
    defaultApy: 3.85, launchYear: 2017,
  },
  {
    protocolId: 'compound', protocol: 'compound', chain: 'ETH', name: 'Compound',
    asset: 'USDC', assetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6,
    receiptTokenSymbol: 'cUSDC', category: 'lending',
    curator: { id: 'compound-dao', name: 'Compound DAO' },
    contracts: { token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', staking: '0xc3d688B66703497DAA19211EEdff47f25384cdc3' },
    defaultApy: 3.52, launchYear: 2017,
  },

  // ---- Morpho (stablecoin) ----
  {
    protocolId: 'morpho', protocol: 'morpho', chain: 'ETH', name: 'Morpho',
    asset: 'USDT', assetAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6,
    receiptTokenSymbol: 'morphoUSDT', category: 'lending',
    curator: { id: 'sky-money', name: 'Sky Money' },
    contracts: { token: '0xdAC17F958D2ee523a2206206994597C13D831ec7', staking: '0x23f5e9c35820f4bab695ac1f19c203cc3f8e1e11' },
    defaultApy: 4.58, launchYear: 2021,
  },
  {
    protocolId: 'morpho', protocol: 'morpho', chain: 'ETH', name: 'Morpho',
    asset: 'USDC', assetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6,
    receiptTokenSymbol: 'gtUSDC', category: 'lending',
    curator: { id: 'gauntlet', name: 'Gauntlet' },
    contracts: { token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', staking: '0x8c106EEDAd96553e64287A5A6839c3Cc78afA3D0' },
    defaultApy: 4.12, launchYear: 2021,
  },

  // ---- SparkLend (stablecoin) ----
  {
    protocolId: 'sparklend', protocol: 'sparklend', chain: 'ETH', name: 'SparkLend',
    asset: 'USDT', assetAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6,
    receiptTokenSymbol: 'sparkUSDT', category: 'lending',
    curator: { id: 'spark-dao', name: 'Spark DAO' },
    contracts: { token: '0xdAC17F958D2ee523a2206206994597C13D831ec7', staking: '0xe7dF13b8e3d6740fe17CBE928C7334243d86c92f' },
    defaultApy: 4.25, launchYear: 2023,
  },
  {
    protocolId: 'sparklend', protocol: 'sparklend', chain: 'ETH', name: 'SparkLend',
    asset: 'USDC', assetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6,
    receiptTokenSymbol: 'sparkUSDC', category: 'lending',
    curator: { id: 'spark-dao', name: 'Spark DAO' },
    contracts: { token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', staking: '0x377C3bd93f2a2984E1E7bE6A5C22c525eD4A4815' },
    defaultApy: 4.15, launchYear: 2023,
  },

  // ---- Fluid (stablecoin) ----
  {
    protocolId: 'fluid', protocol: 'fluid', chain: 'ETH', name: 'Fluid',
    asset: 'USDT', assetAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6,
    receiptTokenSymbol: 'fUSDT', category: 'lending',
    curator: { id: 'fluid-dao', name: 'Fluid DAO' },
    contracts: { token: '0xdAC17F958D2ee523a2206206994597C13D831ec7', staking: '0x5C20B550819128074FD538Edf79791733ccEdd18' },
    defaultApy: 4.42, launchYear: 2018,
  },
  {
    protocolId: 'fluid', protocol: 'fluid', chain: 'ETH', name: 'Fluid',
    asset: 'USDC', assetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6,
    receiptTokenSymbol: 'fUSDC', category: 'lending',
    curator: { id: 'fluid-dao', name: 'Fluid DAO' },
    contracts: { token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', staking: '0x9Fb7b4477576Fe5B32be4C1843aFB1e55F251B33' },
    defaultApy: 4.38, launchYear: 2018,
  },
]

// ============================================================
// Helper functions
// ============================================================

/** Find a lending protocol by protocolId + asset */
export function getLendingProtocol(protocolId: string, asset: string) {
  return lendingProtocols.find(
    p => p.protocolId.toLowerCase() === protocolId.toLowerCase() &&
         p.asset.toUpperCase() === asset.toUpperCase()
  )
}

/**
 * Stablecoin page pooled protocols → poolId (single-collateral/single-borrow pools per asset):
 * morpho/fluid/compound USDT/USDC rows must carry a concrete poolId (e.g. morpho-usdc),
 * otherwise withdraw/getSupplyBalance falls back to protocol-level 'morpho' and USDC gets misclassified as
 * Morpho Blue collateral (WETH/USDC market) instead of a vault liquidity position (Gauntlet USDC Prime).
 */
export function getStablecoinPoolId(protocolId: string, asset?: string): string {
  const pid = protocolId.toLowerCase()
  const sym = (asset || '').toUpperCase()
  if (pid === 'morpho') return sym === 'USDT' ? 'morpho-usdt' : sym === 'USDC' ? 'morpho-usdc' : pid
  if (pid === 'fluid') return sym === 'USDT' ? 'fluid-usdt' : sym === 'USDC' ? 'fluid-usdc' : sym === 'ETH' ? 'fluid-eth' : pid
  if (pid === 'compound') return sym === 'USDT' ? 'compound-usdt' : sym === 'USDC' ? 'compound-usdc' : sym === 'ETH' ? 'compound-eth' : pid
  return pid
}

/** Get the unique lending protocol list by protocolId (for protocol auto-discovery) */
export function getUniqueLendingProtocols(): LendingProtocolMeta[] {
  const seen = new Set<string>()
  return lendingProtocols.filter(p => {
    if (seen.has(p.protocolId)) return false
    seen.add(p.protocolId)
    return true
  })
}

/** Find a stake protocol by protocolId + asset */
export function getStakeProtocol(protocolId: string, asset: string) {
  return stakeProtocols.find(
    p => p.protocolId.toLowerCase() === protocolId.toLowerCase() &&
         p.asset.toUpperCase() === asset.toUpperCase()
  )
}

/** Find a stablecoin protocol by protocolId + asset */
export function getStablecoinProtocol(protocolId: string, asset: string) {
  return stablecoinProtocols.find(
    p => p.protocolId.toLowerCase() === protocolId.toLowerCase() &&
         p.asset.toUpperCase() === asset.toUpperCase()
  )
}

/** Generic: find across all protocols by protocolId + asset */
export function getProtocolByAsset(protocolId: string, asset: string) {
  return getLendingProtocol(protocolId, asset)
      ?? getStakeProtocol(protocolId, asset)
      ?? getStablecoinProtocol(protocolId, asset)
}

/** Lending protocol ID → display name mapping */
export const LENDING_PROTOCOL_NAMES: Record<string, string> = {
  aave: 'AAVE',
  compound: 'Compound',
  morpho: 'Morpho',
  sparklend: 'SparkLend',
  curve: 'Curve',
  fluid: 'Fluid',
}

/**
 * Generic protocol ID → standard display name (case fallback).
 * Backend API protocol names may vary in case/naming (e.g. aave, AAVE, compound…),
 * so the frontend maps protocolId to our standard brand names.
 */
export const PROTOCOL_DISPLAY_NAMES: Record<string, string> = {
  ...LENDING_PROTOCOL_NAMES,
  ethena: 'Ethena',
  lido: 'Lido',
  etherfi: 'ether.fi',
  rocketpool: 'Rocket Pool',
  stakewise: 'StakeWise',
  meth: 'mETH',
  stader: 'Stader',
}

// ============================================================
// Lending pooled model (10 pools)
// ============================================================

export interface LendingPoolMeta {
  poolId: string
  protocolId: string
  displayName: string
  isCrossAsset: boolean
  /** Liquidity assets (Compound/Morpho/Fluid only; deposit earns APY but cannot be used as collateral) */
  liquidityAsset: string
  liquidityAddress: string
  liquidityAssets?: { symbol: string; address: string }[]
  collateralAsset: string
  collateralAddress: string
  borrowAsset: string
  borrowAddress: string
  /** Full borrowable asset list for cross-asset pools (empty for single-collateral/single-borrow pools) */
  borrowAssets?: { symbol: string; address: string }[]
  /** Full supplyable asset list for cross-asset pools (empty for single-collateral/single-borrow pools) */
  collateralAssets?: { symbol: string; address: string }[]
  /** Collateral/liquidation params for single-collateral/single-borrow pools (Fluid etc., aligned with the official vault's Collat. Factor/Liq. Thresh.) */
  risk?: { maxLtv?: number; liquidationThreshold?: number; liquidationPenalty?: number }
}

export const lendingPools: LendingPoolMeta[] = [
  // ---- Cross-asset pools ----
  {
    poolId: 'aave', protocolId: 'aave', displayName: 'AAVE', isCrossAsset: true,
    liquidityAsset: '', liquidityAddress: '', liquidityAssets: [],
    collateralAsset: '', collateralAddress: '', borrowAsset: '', borrowAddress: '',
    collateralAssets: [
      { symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
      { symbol: 'wstETH', address: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0' },
      { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
      { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' },
      { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
    ],
    borrowAssets: [
      { symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
      { symbol: 'wstETH', address: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0' },
      { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
      { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
      { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' },
      { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
    ],
  },
  {
    poolId: 'sparklend', protocolId: 'sparklend', displayName: 'SparkLend', isCrossAsset: true,
    liquidityAsset: '', liquidityAddress: '', liquidityAssets: [],
    collateralAsset: '', collateralAddress: '', borrowAsset: '', borrowAddress: '',
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
  // ---- Single-collateral/single-borrow pools ----
  {
    poolId: 'compound-eth', protocolId: 'compound', displayName: 'Compound-ETH', isCrossAsset: false,
    liquidityAsset: 'ETH', liquidityAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    liquidityAssets: [{ symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' }],
    collateralAsset: 'wstETH', collateralAddress: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0',
    collateralAssets: [{ symbol: 'wstETH', address: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0' }],
    borrowAsset: 'ETH', borrowAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  },
  {
    poolId: 'compound-usdc', protocolId: 'compound', displayName: 'Compound-USDC', isCrossAsset: false,
    liquidityAsset: 'USDC', liquidityAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    liquidityAssets: [{ symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }],
    collateralAsset: 'WBTC', collateralAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    collateralAssets: [
      { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
      { symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
    ],
    borrowAsset: 'USDC', borrowAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  {
    poolId: 'compound-usdt', protocolId: 'compound', displayName: 'Compound-USDT', isCrossAsset: false,
    liquidityAsset: 'USDT', liquidityAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    liquidityAssets: [{ symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }],
    collateralAsset: 'WBTC', collateralAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    collateralAssets: [
      { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
      { symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
    ],
    borrowAsset: 'USDT', borrowAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  },
  {
    poolId: 'morpho-usdt', protocolId: 'morpho', displayName: 'Morpho-USDT', isCrossAsset: false,
    liquidityAsset: 'USDT', liquidityAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    liquidityAssets: [{ symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }],
    collateralAsset: 'wstETH', collateralAddress: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0',
    collateralAssets: [{ symbol: 'wstETH', address: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0' }],
    borrowAsset: 'USDT', borrowAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    // Morpho Blue: risk belongs to the (collateral, loan) pair; official GraphQL lltv=86%, LIF penalty=4.38%, threshold=lltv.
    risk: { maxLtv: 86.0, liquidationThreshold: 86.0, liquidationPenalty: 4.38 },
  },
  {
    poolId: 'morpho-usdc', protocolId: 'morpho', displayName: 'Morpho-USDC', isCrossAsset: false,
    liquidityAsset: 'USDC', liquidityAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    liquidityAssets: [{ symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }],
    collateralAsset: 'WBTC', collateralAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    collateralAssets: [{ symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' }],
    borrowAsset: 'USDC', borrowAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    risk: { maxLtv: 86.0, liquidationThreshold: 86.0, liquidationPenalty: 4.38 },
  },
  {
    poolId: 'fluid-usdt', protocolId: 'fluid', displayName: 'Fluid-USDT', isCrossAsset: false,
    liquidityAsset: 'USDT', liquidityAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    liquidityAssets: [{ symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }],
    collateralAsset: 'ETH', collateralAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    collateralAssets: [{ symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' }],
    borrowAsset: 'USDT', borrowAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    risk: { maxLtv: 87, liquidationThreshold: 92, liquidationPenalty: 1 },
  },
  {
    poolId: 'fluid-usdc', protocolId: 'fluid', displayName: 'Fluid-USDC', isCrossAsset: false,
    liquidityAsset: 'USDC', liquidityAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    liquidityAssets: [{ symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }],
    collateralAsset: 'ETH', collateralAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    collateralAssets: [{ symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' }],
    borrowAsset: 'USDC', borrowAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    risk: { maxLtv: 87, liquidationThreshold: 92, liquidationPenalty: 1 },
  },
  {
    poolId: 'fluid-eth', protocolId: 'fluid', displayName: 'Fluid-ETH', isCrossAsset: false,
    liquidityAsset: 'ETH', liquidityAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    liquidityAssets: [{ symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' }],
    collateralAsset: 'wstETH', collateralAddress: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0',
    collateralAssets: [{ symbol: 'wstETH', address: '0x7f39C581F595B53c5cb19bD0b3f8Da6c935E2Ca0' }],
    borrowAsset: 'ETH', borrowAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    risk: { maxLtv: 95, liquidationThreshold: 97, liquidationPenalty: 0.1 },
  },
]

/** Find a lending pool by poolId */
export function getLendingPool(poolId: string): LendingPoolMeta | undefined {
  return lendingPools.find(p => p.poolId === poolId)
}

/**
 * Determine whether an asset is a liquidity asset of a pool (for reporting add-liquidity/remove-liquidity to reporttx).
 * - Cross-asset pools (aave/sparklend) treat liquidity = collateral, return false (all goes through supply/withdraw);
 * - non-cross-asset pools match against the pool's liquidityAssets (by symbol or address).
 */
export function isLiquidityAsset(poolId: string, asset: string): boolean {
  const pool = getLendingPool(poolId)
  if (!pool || pool.isCrossAsset) return false
  const assets = pool.liquidityAssets?.length
    ? pool.liquidityAssets
    : pool.liquidityAsset
      ? [{ symbol: pool.liquidityAsset, address: pool.liquidityAddress }]
      : []
  const key = (asset || '').toLowerCase()
  return assets.some(a =>
    (a.symbol || '').toLowerCase() === key ||
    (a.address || '').toLowerCase() === key
  )
}

/**
 * Frontend poolId (compound-usdc / morpho-usdc / fluid-eth) → backend reporttx poolId (usdc/eth).
 * Backend contract: poolId is a lowercase asset identifier (the pool's borrow/liquidity asset), combined with protocolId to uniquely locate a pool;
 * for cross-asset pools (aave/sparklend) the backend poolId is the protocolId itself.
 */
export function getBackendPoolId(poolId: string, protocolId?: string): string {
  const pid = (protocolId || '').toLowerCase()
  if (pid === 'aave' || pid === 'sparklend') return pid
  const parts = (poolId || '').split('-')
  return parts.length > 1 ? parts[parts.length - 1] : (poolId || '')
}

/** Get all pools associated with a protocolId */
export function getPoolsByProtocol(protocolId: string): LendingPoolMeta[] {
  return lendingPools.filter(p => p.protocolId === protocolId)
}

/** Get a protocol's Launch Year by protocolId (protocol-level uniform metric, not a specific collateral asset) */
export function getLendingLaunchYear(protocolId: string): number {
  const meta = lendingProtocols.find(p => p.protocolId === protocolId)
  return meta?.launchYear ?? 0
}

/** Map a protocolId to the corresponding poolId (for routing single-collateral/single-borrow pools) */
export function getPoolIdForPosition(protocolId: string, collateralAsset: string, borrowAsset: string): string {
  // Cross-asset pools use the protocolId directly
  if (protocolId === 'aave' || protocolId === 'sparklend') return protocolId
  // Look up the matching pool
  const pool = lendingPools.find(
    p => p.protocolId === protocolId &&
         p.collateralAsset === collateralAsset &&
         p.borrowAsset === borrowAsset
  )
  return pool?.poolId || protocolId
}

/** Lending pool ID → display name mapping */
export const LENDING_POOL_NAMES: Record<string, string> = {
  aave: 'AAVE',
  sparklend: 'SparkLend',
  'compound-eth': 'Compound-ETH',
  'compound-usdc': 'Compound-USDC',
  'compound-usdt': 'Compound-USDT',
  'morpho-usdt': 'Morpho-USDT',
  'morpho-usdc': 'Morpho-USDC',
  'fluid-usdt': 'Fluid-USDT',
  'fluid-usdc': 'Fluid-USDC',
  'fluid-eth': 'Fluid-ETH',
}

/** Stake protocol ID → display name mapping */
export const STAKE_PROTOCOL_NAMES: Record<string, string> = {
  lido: 'Lido',
  etherfi: 'ether.fi',
  rocketpool: 'Rocket Pool',
  stakewise: 'StakeWise',
  meth: 'mETH',
  stader: 'Stader',
}
