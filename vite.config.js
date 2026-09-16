import { fileURLToPath, URL } from 'node:url'
import { loadEnv } from 'vite'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
// Vite 5+ Buffer/Process polyfill config
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    plugins: [
      vue(),
      vueDevTools(),
      nodePolyfills({
        include: ['buffer'], // Explicitly include the buffer polyfill
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // Buffer polyfill
        buffer: 'buffer',
      },
    },
    define: {
      __APP_ENV__: JSON.stringify(env.VITE_API_BASE_URL || 'https://api.surdream.com'),
      // Add global polyfills
      global: 'globalThis',
      // Ensure Buffer is available
      'process.env': '{}',
    },
    // Optimize dependencies - pre-bundle these modules
    optimizeDeps: {
      include: [
        '@ledgerhq/hw-app-eth',
        '@ledgerhq/hw-transport-webhid',
        'buffer',
      ],
    },
  }
})
