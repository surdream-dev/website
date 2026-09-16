import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet } from '@reown/appkit/networks'
import { http } from '@wagmi/core'
import { ethereumRpc } from '@/config/rpc'

export const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID

if (!projectId) {
  console.warn(
    '[appkit] VITE_WALLETCONNECT_PROJECT_ID is not set — WalletConnect connections will fail. ' +
    'Injected browser wallets are unaffected. Get a project ID at https://cloud.reown.com'
  )
}

export const networks = [mainnet]

export const metadata = {
  name: 'SurDream',
  description: 'DeFi Asset Management',
  url: window.location.origin,
  icons: ['/favicon.ico']
}

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  transports: {
    [mainnet.id]: http(ethereumRpc)
  }
})
