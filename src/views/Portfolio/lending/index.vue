<!-- Portfolio Lending -->
<template>
  <div class="portfolio-lending">
    <div class="portfolio-lending-top">
      <Assets />
      <Supply />
    </div>
    <div v-if="showLiquidityPanels" class="portfolio-lending-middle">
      <Assets :liquidityOnly="true" />
      <Supply :liquidityOnly="true" />
    </div>
    <div class="portfolio-lending-bottom">
      <Toborrow />
      <Borrow />
    </div>
  </div>
</template>

<script setup lang="ts">
  import Supply from './supply.vue'
  import Assets from './assets.vue'
  import Borrow from './borrow.vue'
  import Toborrow from './toborrow.vue'
  import { inject, ref, computed, provide, type Ref } from 'vue'
  import { useLendingPosition } from '@/composables/usePortfolio'

  const props = defineProps<{
    keyword?: string
  }>()

  // Get the selected protocol list from the Portfolio parent component
  const selectedProtocols = inject<Ref<string[]>>('selectedProtocols', ref([]))

  // Normalized: the Dropdown value is already a lowercase protocolId, use it directly
  const normalizedProtocols = computed(() => {
    const raw = selectedProtocols.value
    if (raw.length === 0) return []
    return raw.map(p => p.toLowerCase())
  })

  // The liquidity / added-liquidity panels only show for single-collateral/single-borrow protocols (Compound/Morpho/Fluid);
  // Aave/SparkLend collateral = liquidity, so no separate liquidity module is needed
  const showLiquidityPanels = computed(() => {
    const sel = normalizedProtocols.value
    if (sel.length === 0) return true
    return sel.some(p => !['aave', 'sparklend'].includes(p))
  })

  // Provided to child components (normalized lowercase protocolId)
  provide('lendingSelectedProtocols', normalizedProtocols)
  provide('portfolioKeyword', computed(() => props.keyword || ''))

  // The parent creates the lending position state once; children share it via inject
  const lendingPosition = useLendingPosition(normalizedProtocols)
  provide('lendingPosition', lendingPosition)
</script>

<style scoped>
.portfolio-lending {
  display: flex;
  flex-direction: column;
  gap: 41px;
}
.portfolio-lending-top {
  display: flex;
  gap: 41px;
}
.portfolio-lending-middle {
  display: flex;
  gap: 41px;
}
.portfolio-lending-bottom {
  display: flex;
  gap: 41px;
}
.portfolio-lending-top > *,
.portfolio-lending-middle > *,
.portfolio-lending-bottom > * {
  flex: 1;
}

/* = = = = = = = = = = Mobile Adaptation (< 768px) = = = = = = = = = = = */
@media (max-width: 768px) {
  .portfolio-lending {
    gap: 24px;
  }

  .portfolio-lending-top,
  .portfolio-lending-middle,
  .portfolio-lending-bottom {
    flex-direction: column;
    gap: 24px;
  }
  .sort {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 5px;
    margin-left: 2px;
  }
}
</style>
