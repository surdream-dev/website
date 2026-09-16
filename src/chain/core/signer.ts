import { createWalletClient, custom } from "viem"
import { mainnet } from "viem/chains"
import { wagmiAdapter } from "@/config/appkit"
import { signTypedData as wagmiSignTypedData } from "@wagmi/core"

// Get the right wallet provider (for multi-wallet coexistence)
export function getWalletProvider(): any {
  const { ethereum } = window as any

  if (!ethereum) {
    return null
  }

  // When multiple wallets coexist, MetaMask is preferred
  if (ethereum.providers?.length) {
    // Find MetaMask
    const metamask = ethereum.providers.find((p: any) => p.isMetaMask && !p.isBrave)
    if (metamask) return metamask

    // Find other known wallets
    const okx = ethereum.providers.find((p: any) => p.isOkxWallet)
    if (okx) return okx

    const coinbase = ethereum.providers.find((p: any) => p.isCoinbaseWallet)
    if (coinbase) return coinbase

    // If none found, use the first
    return ethereum.providers[0]
  }

  // Single wallet condition
  return ethereum
}

// Check if there is a wallet
export function hasWallet(): boolean {
  return getWalletProvider() !== null
}

// Get walletClient dynamically (reacquire the correct provider on every call)
// Return null if no wallet
export function getWalletClient() {
  const provider = getWalletProvider()

  if (!provider) {
    return null
  }

  return createWalletClient({
    chain: mainnet,
    transport: custom(provider)
  })
}

// Delay fetching walletClient (avoids executing immediately when the module is loaded)
let _walletClient: ReturnType<typeof createWalletClient> | null = null

export function getSharedWalletClient() {
  if (!_walletClient) {
    _walletClient = getWalletClient()
  }
  return _walletClient
}

// Recreate walletClient (called when a user switches wallets or connects wallets)
export function refreshWalletClient() {
  _walletClient = getWalletClient()
}

// Keep Backward Compatible Exports (Deferred Initialization)
// Note: null should be checked when using
export const walletClient = new Proxy({} as ReturnType<typeof createWalletClient>, {
  get(_, prop) {
    const client = getSharedWalletClient()
    if (!client) {
      throw new Error("No wallet provider found. Please install a wallet extension.")
    }
    return client[prop as keyof typeof client]
  }
})

// = = = = = AppKit/wagmi compatible layer = = = = =

/** Check if wagmi has an active connection */
export function hasWagmiConnection(): boolean {
  try {
    return wagmiAdapter.wagmiConfig.state.status === 'connected'
  } catch {
    return false
  }
}

/**
 * Get viem WalletClient from wagmi active connection
 * Support all AppKit connection methods such as WalletConnect, injected, etc.
 */
export async function getWagmiWalletClient() {
  try {
    const config = wagmiAdapter.wagmiConfig
    const uid = config.state.current
    const connection = uid ? config.state.connections.get(uid) : undefined
    if (!connection || !connection.connector) return null

    const provider = await connection.connector.getProvider?.()
    if (!provider) return null

    const chain = config.chains.find(c => c.id === connection.chainId) || mainnet

    return createWalletClient({
      chain,
      transport: custom(provider),
    })
  } catch {
    return null
  }
}

/** Get current address (sync, wagmi first, fallback window.ethereum) */
export function getActiveAddress(): string | null {
  // wagmi
  try {
    const config = wagmiAdapter.wagmiConfig
    const uid = config.state.current
    const connection = uid ? config.state.connections.get(uid) : undefined
    if (connection?.accounts?.length) {
      return connection.accounts[0]
    }
  } catch {}

  // Legacy window.ethereum
  const provider = getWalletProvider()
  if (provider?.selectedAddress) {
    return provider.selectedAddress
  }
  return null
}

/**
 * Unified signTypedData packaging
 * Priority wagmi (supports WalletConnect, injected, etc.)
 * Fallback to legacy viem walletClient
 */
export async function signTypedData(params: {
  account: `0x${string}`
  domain: any
  types: any
  primaryType: string
  message: any
}): Promise<`0x${string}`> {
  if (hasWagmiConnection()) {
    try {
      const signature = await wagmiSignTypedData(wagmiAdapter.wagmiConfig, params as any)
      return signature
    } catch (err) {
      console.warn('[signTypedData] wagmi signTypedData failed, falling back to legacy:', err)
    }
  }

  const walletClient = getSharedWalletClient()
  if (!walletClient) {
    throw new Error("Wallet not connected. Please connect your wallet first.")
  }

  return walletClient.signTypedData({
    ...params,
    account: params.account,
  } as any)
}