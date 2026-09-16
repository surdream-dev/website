/**
 * Unified RPC config (the project's single entry point)
 * * Convention: prefer environment variables (deployment contract; names must not change),
 * fall back to default RPC nodes when missing.
 * * Env var names (deployment contract):
 * VITE_ETHEREUM_RPC_URL / VITE_ARBITRUM_RPC_URL / VITE_OPTIMISM_RPC_URL
 * * Default values (2026-08-14):
 * - Ethereum mainnet defaults to a public node fallback (publicnode, CORS-enabled); in production the
 * Alchemy key is injected by the deployment-side env (e.g. Cloudflare variable VITE_ETHEREUM_RPC_URL);
 * the key is no longer hardcoded.
 * - Arbitrum/Optimism default to official public RPCs (arb1.arbitrum.io / mainnet.optimism.io).
 * - Historical lesson: git 0a9627a removed CORS-restricted RPCs like llamarpc; do not switch back to eth.llamarpc.com.
 */

const env = import.meta.env

/**
 * Split a possibly comma-separated RPC env value into a non-empty endpoint list.
 * Falls back to the default node when the env is empty.
 */
function rpcPool(raw: string | undefined, fallback: string): string[] {
  const parts = (raw || '').split(',').map(s => s.trim()).filter(Boolean)
  return parts.length ? parts : [fallback]
}

/**
 * Ethereum Mainnet RPC pool.
 * VITE_ETHEREUM_RPC_URL may list several endpoints comma-separated, e.g.
 *   https://eth-mainnet.g.alchemy.com/v2/KEY1,https://eth-mainnet.g.alchemy.com/v2/KEY2
 * Each is an independent node; requests are spread across them so a single
 * endpoint outage only affects ~1/N of reads instead of all of them.
 */
export const ethereumRpcs: string[] = rpcPool(env.VITE_ETHEREUM_RPC_URL, 'https://ethereum.publicnode.com')

/** Pick a random Ethereum RPC endpoint (for configs that need one concrete URL). */
export function pickEthereumRpc(): string {
  return ethereumRpcs[Math.floor(Math.random() * ethereumRpcs.length)]
}

/**
 * Ethereum Mainnet RPC (single URL).
 * Configs that need a concrete string at load time (AppKit transports, EIP-6963
 * provider fallback) get one random endpoint chosen here; the hot read path uses
 * pickEthereumRpc() per request instead.
 */
export const ethereumRpc: string = pickEthereumRpc()

/** Arbitrum One RPC */
export const arbitrumRpc: string = env.VITE_ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc'

/** Optimism RPC */
export const optimismRpc: string = env.VITE_OPTIMISM_RPC_URL || 'https://mainnet.optimism.io'
