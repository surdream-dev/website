/** Precision conversion tool function */
import { publicClient } from "../core/provider"
import { ERC20_ABI } from "../evm/abis"
import { getAddress } from "viem"

// Precision caching for common tokens
const decimalsCache = new Map<string, number>()

/**
 * Get the precision of the token
 * @param tokenAddress Token contract address
 * @returns precision value (18 for ETH, 6 for USDC, etc.)
 */
export async function getTokenDecimals(tokenAddress: string): Promise<number> {
  const checksumAddress = getAddress(tokenAddress)
  
  // Check Cache
  if (decimalsCache.has(checksumAddress)) {
    return decimalsCache.get(checksumAddress)!
  }

  // ETH or Native Token
  const ETH_PLACEHOLDER = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
  if (checksumAddress.toLowerCase() === ETH_PLACEHOLDER.toLowerCase() || !tokenAddress) {
    decimalsCache.set(checksumAddress, 18)
    return 18
  }

  try {
    const decimals = await publicClient.readContract({
      address: checksumAddress,
      abi: ERC20_ABI,
      functionName: "decimals"
    })
    
    decimalsCache.set(checksumAddress, decimals)
    return decimals
  } catch (error) {
    console.error(`Failed to get decimals for ${tokenAddress}:`, error)
    // Returns 18 by default (most tokens use 18)
    return 18
  }
}

/**
 * Convert human-readable numbers to contract precision numbers
 * @param amount human-readable numbers (e.g. "0.5", "100")
 * @param decimals Token precision (default 18)
 * @returns precision numbers in BigInt format
 */
export function toWei(amount: string | number, decimals: number = 18): bigint {
  const amountStr = typeof amount === 'string' ? amount : amount.toString()
  const num = parseFloat(amountStr)
  
  if (isNaN(num) || num < 0) {
    return BigInt(0)
  }
  
  // Use multiplication to convert to precision numbers
  const multiplier = Math.pow(10, decimals)
  const weiAmount = Math.floor(num * multiplier)
  
  return BigInt(weiAmount)
}

/**
 * Convert contract precision numbers to human-readable numbers
 * Precision numbers in @param amount BigInt format
 * @param decimals Token precision (default 18)
 * Human-readable numbers in @returns string format
 */
export function fromWei(amount: bigint, decimals: number = 18): string {
  const divisor = Math.pow(10, decimals)
  const num = Number(amount) / divisor
  
  // Reserve 6 decimal places
  return num.toFixed(6)
}

/**
 * Convert human-readable numbers to contract precision numbers (asynchronous version, automatically get precision)
 * @param amount human-readable numbers
 * @param tokenAddress Token contract address
 * @returns precision numbers in BigInt format
 */
export async function toWeiWithDecimals(amount: string | number, tokenAddress: string): Promise<bigint> {
  const decimals = await getTokenDecimals(tokenAddress)
  return toWei(amount, decimals)
}

/**
 * Calculate Max investable amount
 * @param balance current balance (precision number)
 * @param isGasToken is Gas Token (e.g. ETH)
 * @param gasReserve reserved amount of Gas (precision number, default 0.001 ETH)
 * @returns maximum investable amount
 */
export function calculateMaxAmount(balance: bigint, isGasToken: boolean = false, gasReserve?: bigint): bigint {
  if (!isGasToken) {
    return balance
  }
  
  const reserve = gasReserve ?? toWei("0.001", 18) // Default Reserved 0.001 ETH
  
  if (balance <= reserve) {
    return BigInt(0)
  }
  
  return balance - reserve
}
