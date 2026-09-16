<template>
  <div class="tooltip-wrapper">
    <slot />

    <div class="tooltip-content">
      <span class="head">{{head}}</span>
      <span>{{ content }}</span>
      <span>{{ contentmore }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  head: string,
  content: string,
  contentmore: string
}>()
</script>

<style scoped>
.tooltip-wrapper {
  width:auto;
  position: relative;
  display: inline-flex;
  align-items: center;
}
.tooltip-content .head{
  color: #FFF;
  font-family: Inter;
  font-size: 8px;
  font-style: normal;
  font-weight: 600;
  line-height: 9.6px; /* 9.6px */
}
.tooltip-content {
  display: flex;
  gap:1px;
  flex-direction: column;
  position: absolute;
  left: 63%;
  top: 49%;
  z-index: 1000;

  width: max-content;
  max-width:200px;
  height:auto;
  background: #22221E;
  color: #fff;
  font-size: 8px;
  line-height: 9.6px;
  padding: 2px 4px;
  border-radius: 1px;

  opacity: 0;
  pointer-events: none;
}

.tooltip-wrapper:hover .tooltip-content {
  opacity: 1;
}

/* Mobile: shrink trigger icon to 2/3 and move the tooltip to the top-left */
@media (max-width: 768px) {
  .tooltip-wrapper :slotted(img),
  .tooltip-wrapper :slotted(.tip-icon) {
    transform: scale(0.667);
  }
  .tooltip-wrapper .tooltip-content {
    left: 0;
    top: -200%;
    transform: translateX(-100%);
  }
}
</style>
