/** API unified export */

// Request encapsulation
export { request, get, post, authRequest, authGet, authPost } from './request'

// Configure
export { 
  API_BASE_URL, 
  API_ENDPOINTS, 
  ASSET_TYPES, 
  CATEGORIES,
  DEFAULT_PAGE_SIZE 
} from '@/config/api'

// Business APIs
// Note: stablecoin.ts/lending.ts deleted (dead code cleanup, no caller); staking.ts preserved (transformStakingData still used by views/Stake/index.vue)
export * from './staking'
export * from './portfolio'
export * from './auth'
