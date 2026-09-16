<template>
  <HEAD></HEAD>
  <router-view />
</template>

<style scoped>
</style>
<script setup>
import { useRouter } from 'vue-router'
import HEAD from './components/Head.vue'
import { useAppKitAuth } from '@/composables/useAppKitAuth'
import { startPublicDataPrefetch } from '@/composables/usePublicDataPrefetch'

// Initialize AppKit Auth bridge (listen for connection status, automatically trigger login process)
useAppKitAuth()
startPublicDataPrefetch()

const router = useRouter()
const goToUser = (path) => {
  router.push({
    name: path
  })
}
</script>
