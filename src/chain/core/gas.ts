import { ref, onMounted, onUnmounted } from 'vue'
import { publicClient } from './provider'

// = = = = = = = = = = = = Cache (30s TTL, avoid duplicate RPC calls) = = = = = = = = = = = = = =

const CACHE_TTL = 30_000

let cachedGasPrice: bigint | null = null
let cachedGasPriceAt = 0

let cachedEthPrice: number | null = null
let cachedEthPriceAt = 0

// ============ Chainlink ETH/USD Price Feed ============

// Chainlink ETH/USD Price Feed on Ethereum mainnet
const CHAINLINK_ETH_USD = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'

const CHAINLINK_AGGREGATOR_ABI = [
  {
    inputs: [],
    name: 'latestRoundData',
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// = = = = = = = = = = = = Core functions = = = = = = = = = = = = =

/** Get the current gas price (wei, with cache) */
export async function getGasPrice(): Promise<bigint> {
  const now = Date.now()
  if (cachedGasPrice !== null && (now - cachedGasPriceAt) < CACHE_TTL) {
    return cachedGasPrice
  }
  cachedGasPrice = await publicClient.getGasPrice()
  cachedGasPriceAt = now
  return cachedGasPrice
}

/** Get EIP-1559 fee parameters (maxFeePerGas/maxPriorityFeePerGas) for incoming wallet when transaction is sent */
export async function getEip1559Fees(): Promise<{
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}> {
  const [block, maxPriorityFeePerGas] = await Promise.all([
    publicClient.getBlock({ blockTag: 'latest' }),
    publicClient.getMaxPriorityFeePerGas(),
  ])
  const baseFee = block.baseFeePerGas ?? 0n
  const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas
  return { maxFeePerGas, maxPriorityFeePerGas }
}

/** Get ETH/USD price from Chainlink (with cache) */
export async function getEthPrice(): Promise<number> {
  const now = Date.now()
  if (cachedEthPrice !== null && (now - cachedEthPriceAt) < CACHE_TTL) {
    return cachedEthPrice
  }

  try {
    const [, answer] = await publicClient.readContract({
      address: CHAINLINK_ETH_USD,
      abi: CHAINLINK_AGGREGATOR_ABI,
      functionName: 'latestRoundData',
    }) as [bigint, bigint, bigint, bigint, bigint]

    // Chainlink answer has 8 decimal places
    const price = Number(answer) / 1e8

    cachedEthPrice = price
    cachedEthPriceAt = now
    return price
  } catch (err) {
    console.warn('[Gas] Failed to get ETH price from Chainlink:', err)
    return cachedEthPrice ?? 3000 // fallback
  }
}

/** Estimated transaction cost (USD), returns formatted string e.g. "$0.42" */
export async function estimateTxCost(gasUnits: number): Promise<string> {
  try {
    const [gasPrice, ethPrice] = await Promise.all([
      getGasPrice(),
      getEthPrice(),
    ])

    // costWei = gasPrice (wei) × gasUnits
    const costWei = gasPrice * BigInt(gasUnits)
    // costEth = costWei / 1e18
    const costEth = Number(costWei) / 1e18
    const costUsd = costEth * ethPrice

    if (costUsd >= 0.01) {
      return `$${costUsd.toFixed(2)}`
    } else {
      return `$${costUsd.toFixed(4)}`
    }
  } catch (err) {
    console.warn('[Gas] Failed to estimate tx cost:', err)
    return '--'
  }
}

// = = = = = = = = = = = = Gas estimation constants for each operation = = = = = = = = = = = = =

/** ERC20 approve typical gas */
export const APPROVE_GAS = 46_000n

/** Typical gas for each operation */
export const GAS = {
  stake: 150_000n,        // ETH stake (no approve required)
  unstake: 200_000n,
  claim: 100_000n,
  deposit: 150_000n,      // stablecoin deposit (extra + approve)
  withdraw: 200_000n,
  supply: 200_000n,       // lending supply (extra + approve)
  borrow: 200_000n,
  repay: 200_000n,        // lending repay (extra + approve)
}

// ============ Vue Composable ============

/**
 * Real-time transaction cost composable
 * @param gasUnits Estimated gas quantity (sum of approve + operations)
 * @param refreshInterval Auto refresh interval (ms), default 30s, set 0 to disable
 */
export function useTxCost(gasUnits: bigint | number, refreshInterval = 30_000) {
  const txCost = ref('Estimating...')
  let timer: ReturnType<typeof setInterval> | null = null

  async function refresh() {
    txCost.value = await estimateTxCost(Number(gasUnits))
  }

  onMounted(() => {
    refresh()
    if (refreshInterval > 0) {
      timer = setInterval(refresh, refreshInterval)
    }
  })

  onUnmounted(() => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  })

  return { txCost, refresh }
}
