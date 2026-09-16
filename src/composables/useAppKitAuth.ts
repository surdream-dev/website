import { useAppKit } from '@reown/appkit/vue'
import { ChainController, CoreHelperUtil } from '@reown/appkit-controllers'
import { useWalletStore, setAppKitOpenFn } from '@/stores/wallet'
import { useTxReporter } from '@/composables/useTxReporter'
import { invalidatePortfolioPositions } from '@/composables/usePortfolioChainData'
import { clearBalanceCacheForAddress } from '@/composables/useBalance'
import { login, saveTokens } from '@/api/auth'
import { updateAccessToken } from '@/composables/usePortfolio'

// Module-level shared state to keep a single ChainController subscription across useAppKitAuth() calls
let lastPortfolioAddress: string | null = null
let subscribed = false

// Guards one in-flight login per address: ChainController pushes the same address
// repeatedly on connect, which would otherwise fire parallel /auth/web3/login POSTs.
let loggingInAddress: string | null = null

/** Check whether the JWT access token is still valid */
function isAccessTokenValid(): boolean {
  const token = localStorage.getItem('surdream_access_token')
  if (!token) return false
  try {
    // The JWT payload is the second part (base64-encoded JSON)
    const parts = token.split('.')
    if (parts.length !== 3) return false // Not a valid JWT
    const payload = JSON.parse(atob(parts[1]))
    // exp is a Unix timestamp in seconds
    return payload.exp * 1000 > Date.now()
  } catch {
    return false // Cannot decode; treat as expired
  }
}

/** Read the currently connected plain address from ChainController state */
function getConnectedAddress(): string | null {
  const activeChain = ChainController.state.activeChain
  const accountState = activeChain
    ? ChainController.state.chains.get(activeChain)?.accountState
    : undefined
  return CoreHelperUtil.getPlainAddress(accountState?.caipAddress) || null
}

/**
 * Bridge AppKit wallet connection with the app state.
 *
 * The EIP-4361 wallet-signature sign-in (challenge / signMessage) is disabled —
 * connecting never prompts for a signature. When no valid access token exists, a
 * fresh one is minted via login() directly: the backend no longer verifies the
 * proof, so signature/nonce are sent as placeholders and a token is returned.
 * A pre-existing valid token is honored without re-requesting.
 */
export function useAppKitAuth() {
  const walletStore = useWalletStore()
  const txReporter = useTxReporter()
  const { open, close } = useAppKit()

  // Register the open function to the wallet store
  setAppKitOpenFn(() => open())

  // Subscribe to ChainController only on the first call
  if (!subscribed) {
    subscribed = true

    function syncState() {
      const addr = getConnectedAddress()
      const connected = Boolean(addr)

      if (connected && addr) {
        walletStore.setWallet({ address: addr })

        if (addr.toLowerCase() !== lastPortfolioAddress?.toLowerCase()) {
          clearBalanceCacheForAddress(lastPortfolioAddress || undefined)
          invalidatePortfolioPositions()
          lastPortfolioAddress = addr
        }

        // No signature sign-in. A pre-existing valid token is honored (starts
        // pending-tx polling) without a request; when it is missing or expired,
        // mint a fresh one via login() (no challenge/signMessage round-trip).
        if (isAccessTokenValid()) {
          txReporter.start()
        } else {
          loginAndPersist(addr)
        }
      } else {
        walletStore.clearWallet()
        if (lastPortfolioAddress) {
          clearBalanceCacheForAddress(lastPortfolioAddress)
          invalidatePortfolioPositions()
          lastPortfolioAddress = null
        }
        // Wallet disconnected → stop pending polling
        txReporter.stop()
      }
    }

    ChainController.subscribe(() => {
      syncState()
    })
  }

  // Mint a backend token for a connected address WITHOUT a signature: the API
  // ignores the EIP-4361 proof, so we skip challenge/signMessage and send a
  // placeholder signature/nonce. Guarded per-address so repeated ChainController
  // pushes do not fire parallel login POSTs while one is in flight.
  async function loginAndPersist(addr: string) {
    const norm = addr.toLowerCase()
    if (loggingInAddress === norm) return
    loggingInAddress = norm
    try {
      const loginRes = await login({
        chainType: 'evm',
        address: addr,
        signature: '0x', // placeholder — backend no longer verifies the proof
        nonce: '',       // placeholder
      })
      const token = loginRes?.token
      if (token?.accessToken) {
        saveTokens(token.accessToken, token.refreshToken)
        updateAccessToken()
        // Login success → start pending-tx polling
        txReporter.start()
      }
    } catch (e: any) {
      console.error('[AppKit Auth] login failed:', e)
    } finally {
      if (loggingInAddress === norm) loggingInAddress = null
    }
  }

  function disconnect() {
    close()
    walletStore.clearWallet()
    if (lastPortfolioAddress) {
      clearBalanceCacheForAddress(lastPortfolioAddress)
      invalidatePortfolioPositions()
      lastPortfolioAddress = null
    }
    txReporter.stop()
  }

  return {
    openAppKit: open,
    disconnect
  }
}
