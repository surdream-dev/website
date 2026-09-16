/**
 * Balance Composable
 * Prefer the wallet cache, fall back to node queries
 */

import { ref, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { publicClient } from '@/chain/core/provider'
import { getAddress } from 'viem'

// ERC20 ABI (minimal)
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }]
  }
] as const

// ETH address placeholder
const ETH_PLACEHOLDER = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

// Global balance cache (key: `${address}:${tokenAddress}`)
const balanceCache = new Map<string, { wei: bigint; timestamp: number }>()
const balanceInflight = new Map<string, Promise<bigint>>()

/** Module-level helper for wallet lifecycle: clear one address without needing a component instance. */
export function clearBalanceCacheForAddress(userAddress?: string): void {
  if (!userAddress) {
    balanceCache.clear()
    return
  }
  const prefix = `${userAddress.toLowerCase()}:`
  for (const key of balanceCache.keys()) {
    if (key.startsWith(prefix)) balanceCache.delete(key)
  }
}

// Cache TTL (30 seconds)
const CACHE_EXPIRE_MS = 30_000

/** Get balance (cache first, node fallback) */
export function useBalance() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** Get the cache key */
  function getCacheKey(userAddress: string, tokenAddress: string): string {
    return `${userAddress.toLowerCase()}:${tokenAddress.toLowerCase()}`
  }

  /** Check whether the cache is valid */
  function isCacheValid(cacheKey: string): boolean {
    const cached = balanceCache.get(cacheKey)
    if (!cached) return false
    return Date.now() - cached.timestamp < CACHE_EXPIRE_MS
  }

  /** Set the cache */
  function setCache(cacheKey: string, wei: bigint): void {
    balanceCache.set(cacheKey, { wei, timestamp: Date.now() })
  }

  /** Clear the cache (refresh after a transaction) */
  function clearCache(userAddress?: string, tokenAddress?: string): void {
    if (userAddress && tokenAddress) {
      const key = getCacheKey(userAddress, tokenAddress)
      balanceCache.delete(key)
    } else {
      balanceCache.clear()
    }
  }

  /** Clear all cached balances for one address (account switch / disconnect). */
  function clearAddressCache(userAddress?: string): void {
    clearBalanceCacheForAddress(userAddress)
  }

  /** Determine whether it is ETH */
  function isEth(tokenAddress: string): boolean {
    return tokenAddress.toLowerCase() === ETH_PLACEHOLDER.toLowerCase() ||
           tokenAddress === '' ||
           !tokenAddress
  }

  /** Get the balance from the node */
  async function fetchFromNode(
    userAddress: string,
    tokenAddress: string
  ): Promise<bigint> {
    if (isEth(tokenAddress)) {
      // ETH balance
      return await publicClient.getBalance({
        address: userAddress as `0x${string}`
      })
    } else {
      // ERC20 balance
      return await publicClient.readContract({
        address: getAddress(tokenAddress),
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [userAddress as `0x${string}`]
      }) as bigint
    }
  }

  /**
 * Get balance (wei)
 * @param userAddress user address
 * @param tokenAddress token address (ETH uses a placeholder)
 * @param forceRefresh force refresh (skip cache)
 */
  async function getBalanceWei(
    userAddress: string,
    tokenAddress: string,
    forceRefresh: boolean = false
  ): Promise<bigint> {
    if (!userAddress) {
      return BigInt(0)
    }

    const cacheKey = getCacheKey(userAddress, tokenAddress)

    // Check Cache
    if (!forceRefresh && isCacheValid(cacheKey)) {
      const cached = balanceCache.get(cacheKey)
      return cached!.wei
    }

    const pending = balanceInflight.get(cacheKey)
    if (pending) return pending

    const p = (async () => {
      // Fetch from the node
      loading.value = true
      error.value = null

      try {
        const wei = await fetchFromNode(userAddress, tokenAddress)
        setCache(cacheKey, wei)
        return wei
      } catch (err: any) {
        console.error('[Balance] Fetch error:', err)
        error.value = err.message
        return BigInt(0)
      } finally {
        loading.value = false
      }
    })()

    balanceInflight.set(cacheKey, p)
    try {
      return await p
    } finally {
      balanceInflight.delete(cacheKey)
    }
  }

  /**
 * Get balance (readable format)
 * @param userAddress user address
 * @param tokenAddress token address
 * @param decimals decimals
 * @param forceRefresh force refresh
 */
  async function getBalanceReadable(
    userAddress: string,
    tokenAddress: string,
    decimals: number = 18,
    forceRefresh: boolean = false
  ): Promise<string> {
    const wei = await getBalanceWei(userAddress, tokenAddress, forceRefresh)
    const readable = Number(wei) / Math.pow(10, decimals)
    // Round down, keep 6 decimals
    return Math.floor(readable * 1e6) / 1e6 + ''
  }

  /** Get token decimals (from the node) */
  async function getTokenDecimals(tokenAddress: string): Promise<number> {
    if (isEth(tokenAddress)) {
      return 18
    }

    try {
      const decimals = await publicClient.readContract({
        address: getAddress(tokenAddress),
        abi: ERC20_ABI,
        functionName: 'decimals'
      })
      return decimals as number
    } catch (err) {
      console.warn('[Balance] Failed to get decimals:', err)
      return 18 // default fallback
    }
  }

  return {
    loading,
    error,
    getBalanceWei,
    getBalanceReadable,
    getTokenDecimals,
    clearCache,
    clearAddressCache,
    isEth
  }
}

/**
 * Get the user's ETH balance (reactive)
 * Fetched automatically after wallet connection, updated on balance changes
 */
export function useUserEthBalance() {
  const walletStore = useWalletStore()
  const { address, isConnected } = storeToRefs(walletStore)
  const { getBalanceReadable } = useBalance()

  const balance = ref('0')

  async function fetchBalance() {
    if (isConnected.value && address.value) {
      balance.value = await getBalanceReadable(address.value, ETH_PLACEHOLDER, 18)
    } else {
      balance.value = '0'
    }
  }

  watch([isConnected, address], fetchBalance, { immediate: true })

  return balance
}
