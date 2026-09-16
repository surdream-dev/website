import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// Module-level callback, set by useAppKitAuth during initialization
let appKitOpenFn: (() => void) | null = null

export function setAppKitOpenFn(fn: () => void) {
  appKitOpenFn = fn
}

export const useWalletStore = defineStore('wallet', () => {
  /* ---------------- Wallet State ---------------- */
  const address = ref<string | null>(null)
  const chainId = ref<number | null>(null)
  const isConnected = computed(() => !!address.value)

  /* ---------------- Actions ---------------- */
  function setWallet(payload: {
    address?: string | null
    chainId?: number | null
  }) {
    if ('address' in payload) {
      address.value = payload.address ?? null
    }
    if ('chainId' in payload) {
      chainId.value = payload.chainId ?? null
    }
  }

  function clearWallet() {
    address.value = null
    chainId.value = null
  }

  // Backward compatible: delegate to AppKit
  function openConnect() {
    if (appKitOpenFn) {
      appKitOpenFn()
    }
  }

  return {
    address,
    chainId,
    isConnected,
    setWallet,
    clearWallet,
    openConnect
  }
})
