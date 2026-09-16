<template>
  <button :class="['btn', { disabled: isDisabled, loading: isLoading }]" :disabled="isDisabled || isLoading">
    <slot/>
  </button>
</template>

<script setup lang="ts">
const props = defineProps<{
  isDisabled?: boolean
  isLoading?: boolean
}>()
</script>

<style scoped>
.btn{
  margin-top:25px;
  cursor:pointer;
  display: flex;
  width: 100%;
  height: 35px;
  padding: 0 18.506px;
  justify-content: center;
  align-items: center;
  gap: 7.711px;
  border-radius: 4.626px;
  border: 0.771px solid rgba(255, 255, 255, 0.15);
  background: var(--gold, linear-gradient(90deg, #C49A4C 30.29%, #F6D77B 69.23%, #B1822A 100%));
  box-shadow: 0 0 0 2.853px rgba(190, 202, 234, 0.03), 0 5.706px 14.265px 0 rgba(255, 255, 255, 0.11) inset;
  color: var(--Secondary-100, #EDF1F3);
  text-align: center;
  font-family: Inter;
  font-size: 15px;
  font-style: normal;
  font-weight: 600;
  line-height: 150%; /* 22.5px */
  letter-spacing: -0.3px;
  box-sizing:border-box;
}

.btn.disabled,
.btn.loading {
  opacity: 0.8;
  cursor: not-allowed;
}

.btn.loading {
  pointer-events: none;
}
</style>