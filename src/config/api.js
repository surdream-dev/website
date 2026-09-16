/**
 * API config
 * Backend service URL and configuration
 */

// API base URL - overridable via environment variables
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api.surdream.com'

// Request timeout (ms)
export const API_TIMEOUT = 30000

// CDN base URL
export const CDN_BASE_URL = 'https://cdn.surdream.com'

// API endpoints
export const API_ENDPOINTS = {
  // Auth - Web3 login
  AUTH_CHALLENGE: '/auth/web3/challenge',
  AUTH_LOGIN: '/auth/web3/login',
  AUTH_REFRESH: '/auth/refresh',

  // User portfolio (requires JWT)
  PORTFOLIO_SUMMARY: '/portfolio/summary',
  PORTFOLIO_POSITIONS: '/portfolio/positions',
  PORTFOLIO_TRANSACTIONS: '/portfolio/transactions',
  PORTFOLIO_TRANSACTIONS_REPORT: '/portfolio/transactions/report',

  // Price oracle
  PRICES: '/prices',
}

// Note: endpoint constants /earn/stablecoins*, /lending/*, /staking/protocols, /protocols/{id}, /portfolio/lending
// Removed during the 2026-08-14 dead-code cleanup (list pages now use local config + on-chain; Portfolio Lending reads on-chain directly).

// Asset type
export const ASSET_TYPES = {
  STABLECOIN: 'stablecoin',
  ETH: 'eth',
  BTC: 'btc',
}

// Category type
export const CATEGORIES = {
  STAKING: 'staking',
  STABLECOIN: 'stablecoin',
  LENDING: 'lending',
}

// Default pagination config
export const DEFAULT_PAGE_SIZE = 20
