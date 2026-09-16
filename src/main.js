import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './index.css'  // Import Tailwind styles
import { createPinia } from 'pinia'
import { WagmiPlugin } from '@wagmi/vue'
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query'
import { createAppKit } from '@reown/appkit/vue'
import { wagmiAdapter, networks, metadata, projectId } from '@/config/appkit'
import { ethereumRpc } from '@/config/rpc'

// Buffer polyfill for Ledger
import { Buffer } from 'buffer'
globalThis.Buffer = Buffer
window.Buffer = Buffer

const app = createApp(App)
const pinia = createPinia()
const queryClient = new QueryClient()

// Must be called before useAppKit()
createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata,
  featuredWalletIds: [],
  enableWalletConnect: true,
  enableEIP6963: true,
  enableInjected: true,
  customRpcUrls: {
    'eip155:1': [{ url: ethereumRpc }]
  },
  features: {
    swaps: true,
    onramp: true,
    analytics: true,
    // Explicitly disable the Reown Auth (email/social) login: its account-linking flow
    // requests an extra wallet EIP-4361 signature on session restore. Must be `false`
    // (NOT just removed) — AppKit falls back to the remote default when the key is
    // undefined. NOTE: if a remote project config is fetched, it overrides these local
    // values, so email/social login must also be disabled on dashboard.reown.com.
    email: false,
    socials: false
  }
})

app.use(pinia)
app.use(router)
app.use(WagmiPlugin, { config: wagmiAdapter.wagmiConfig })
app.use(VueQueryPlugin, { queryClient })
app.mount('#app')

// src/utils/rem.ts
// function setRemBase() {
//   const baseWidth = 1300
//   const baseRem = 100

//   const width = document.documentElement.clientWidth
//   const fontSize = (width / baseWidth) * baseRem

//   document.documentElement.style.fontSize = fontSize + 'px'
// }

// setRemBase()
// window.addEventListener('resize', setRemBase)
