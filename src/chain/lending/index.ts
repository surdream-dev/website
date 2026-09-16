import { register, getLending, has } from "./registry"
import { aave } from "./aave"
import { compound } from "./compound"
import { morpho } from "./morpho"
import { sparklend } from "./sparklend"
import { fluid } from "./fluid"

// ---- Original Agreement Registration ----
// Note: Curve is not included in the lending scope (see memory lending-exclude-curve).
// Its borrow/repay is not supported and has been removed from the lending registry. Curve takes the stablecoin adapter.
register("aave", aave)
register("compound", compound)
register("morpho", morpho)
register("sparklend", sparklend)
register("fluid", fluid)

// ---- Pooled registration (single deposit certificate borrowing pool, pointing to the same adapter) ----
register("compound-eth", compound)
register("compound-usdc", compound)
register("compound-usdt", compound)
register("morpho-usdt", morpho)
register("morpho-usdc", morpho)
register("fluid-usdt", fluid)
register("fluid-usdc", fluid)
register("fluid-eth", fluid)

/**
 * Get adapter via poolId
 * Pooling ID may be 'compound-usdc', etc. Check the original protocolId before trying poolId
 */
export function getAdapterByPoolId(poolId: string) {
  // Check directly first (corresponding to the key of the pool registration)
  if (has(poolId)) return getLending(poolId)
  // The poolId across asset pools is the protocolId
  return getLending(poolId)
}

export const lending = {
  get: getLending,
  getByPool: getAdapterByPoolId,
  has,
}