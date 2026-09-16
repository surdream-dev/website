/**
 * Morpho MetaMorpho vault data (Stablecoin page semantics)
 * * The Morpho USDT/USDC rows on the Stablecoin page are vault in/out flows (deposit/withdraw both go through the ERC-4626 vault),
 * so APY/TVL use the vault's own data, not the Morpho Blue lending market (supplyApy/supplyAssets):
 * - TVL = vault.totalAssets() (underlying, 6 decimals; USDT/USDC ≈ $1)
 * - APY = Morpho official netApy (instantaneous, after protocol fees, no external rewards), matching the official vault page
 * With TTL cache + concurrent dedup.
 */
import { publicClient } from '@/chain/core/provider'
import { ADDRESSES } from '@/chain/evm/addresses'
import { multicall } from 'viem/actions'
import { createPublicDataCache, type PublicDataCache } from '@/utils/publicDataCache'

export interface MorphoVaultInfo {
  /** Official netApy (%, e.g. 3.29), instantaneous; null when the API is unavailable */
  apy: number | null
  /** totalAssets (underlying wei, 6 decimals) */
  totalAssets: bigint
}

const ERC4626_TOTAL_ASSETS_ABI = [
  {
    name: 'totalAssets',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'convertToAssets',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

/** Morpho official GraphQL: vault instantaneous net APY (same source as the main figure on app.morpho.org vault pages) */
const MORPHO_GRAPHQL_URL = 'https://api.morpho.org/graphql'
const FETCH_TIMEOUT = 10_000

/** Vault address and underlying token decimals */
const VAULTS: Record<'usdt' | 'usdc', { address: `0x${string}`; decimals: number }> = {
  usdt: { address: ADDRESSES.lending.morpho.withdrawVaultUSDT as `0x${string}`, decimals: 6 },
  usdc: { address: ADDRESSES.lending.morpho.withdrawVaultUSDC as `0x${string}`, decimals: 6 },
}

const CACHE_TTL = 5 * 60_000
const STORAGE_MAX_AGE = 7 * 24 * 60 * 60_000
const vaultCaches = new Map<string, PublicDataCache<MorphoVaultInfo | null>>()

function getVaultCache(key: string) {
  let cache = vaultCaches.get(key)
  if (!cache) {
    cache = createPublicDataCache<MorphoVaultInfo | null>({
      key: `morpho-vault:${key}`,
      ttlMs: CACHE_TTL,
      maxAgeMs: STORAGE_MAX_AGE,
      isUsable: (value) => value !== null && value.totalAssets > 0n,
    })
    vaultCaches.set(key, cache)
  }
  return cache
}

interface VaultOnchainInfo {
  /** totalAssets（underlying wei） */
  totalAssets: bigint
  /** convertToAssets(1e18 shares) → underlying wei */
  convertToAssets: bigint
}

const onchainCache = new Map<string, { value: VaultOnchainInfo | null; timestamp: number }>()
const onchainInflight = new Map<string, Promise<VaultOnchainInfo | null>>()

/**
 * On-chain vault read (totalAssets + convertToAssets combined into one multicall, with TTL cache + concurrent dedup).
 * totalAssets failure fails the whole call (keeping the old semantics: vault info unavailable); convertToAssets failure only falls the rate back to 1.
 */
async function getVaultOnchain(key: string): Promise<VaultOnchainInfo | null> {
  const now = Date.now()
  const hit = onchainCache.get(key)
  if (hit && now - hit.timestamp < CACHE_TTL) return hit.value

  const pending = onchainInflight.get(key)
  if (pending) return pending

  const p = (async () => {
    try {
      const cfg = VAULTS[key]
      if (!cfg) return null
      const results = await multicall(publicClient, {
        contracts: [
          { address: cfg.address, abi: ERC4626_TOTAL_ASSETS_ABI, functionName: 'totalAssets', args: [] },
          { address: cfg.address, abi: ERC4626_TOTAL_ASSETS_ABI, functionName: 'convertToAssets', args: [10n ** 18n] },
        ],
        allowFailure: true,
      })
      if (results[0]?.status !== 'success') return null
      const value: VaultOnchainInfo = {
        totalAssets: results[0].result as bigint,
        convertToAssets: results[1]?.status === 'success' ? (results[1].result as bigint) : 0n,
      }
      onchainCache.set(key, { value, timestamp: Date.now() })
      return value
    } catch (e) {
      console.warn(`[MorphoVault] ${key} 链上读取失败:`, e)
      return null
    } finally {
      onchainInflight.delete(key)
    }
  })()
  onchainInflight.set(key, p)
  return p
}

async function fetchNetApy(address: `0x${string}`): Promise<number | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    const res = await fetch(MORPHO_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query ($address: String!) {
          vault: vaultV2ByAddress(address: $address, chainId: 1) {
            netApy
          }
        }`,
        variables: { address: address.toLowerCase() },
      }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    const apy = data?.data?.vault?.netApy
    return typeof apy === 'number' && Number.isFinite(apy) ? apy * 100 : null
  } catch (e) {
    console.warn('[MorphoVault] official netApy fetch failed:', e)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Get vault TVL (on-chain) + official instantaneous net APY (with TTL cache + concurrent dedup) */
export async function getMorphoVaultInfo(asset: string): Promise<MorphoVaultInfo | null> {
  const key = (asset || '').toLowerCase()
  const cfg = VAULTS[key]
  if (!cfg) return null

  const cache = getVaultCache(key)
  return cache.get(async () => {
    try {
      const [onchain, apy] = await Promise.all([
        getVaultOnchain(key),
        fetchNetApy(cfg.address),
      ])
      if (!onchain) return null

      const value: MorphoVaultInfo = { apy, totalAssets: onchain.totalAssets }
      return value
    } catch (e) {
      console.warn(`[MorphoVault] ${key} 金库数据获取失败:`, e)
      return null
    }
  })
}

/**
 * Morpho vault share rate: how much underlying 1 share equals (e.g. 1 morphoUSDT ≈ 1.04x USDT)
 * Read via ERC4626 convertToAssets(1 share); return 1 on failure (callers fall back).
 */
export async function getMorphoVaultExchangeRate(asset: string): Promise<number> {
  const key = (asset || '').toLowerCase()
  const cfg = VAULTS[key]
  if (!cfg) return 1
  try {
    const onchain = await getVaultOnchain(key)
    if (!onchain || onchain.convertToAssets <= 0n) return 1
    // MetaMorpho shares are fixed at 18 decimals; underlying USDC/USDT are 6 (cfg.decimals = underlying decimals).
    // 1 share ≈ convertToAssets(1e18 shares) / 1e6 underlying
    const rate = Number(onchain.convertToAssets) / 10 ** cfg.decimals
    return Number.isFinite(rate) && rate > 0 ? rate : 1
  } catch (e) {
    console.warn('[MorphoVault] exchange rate 获取失败:', e)
    return 1
  }
}
