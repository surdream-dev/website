<template>
  <div class="inp">
    <input
      :value="modelValue"
      @input="handleInput"
      :readonly="readonly"
      type="text"
      placeholder="0.00"
    />
  </div>
</template>

<script setup>
defineProps({
  modelValue: String,
  token: String,
  readonly: Boolean
})
const emit = defineEmits(['update:modelValue'])

function handleInput(event) {
  const value = event.target.value
  // Only numbers and decimals are allowed, no other characters allowed
  let cleaned = value.replace(/[^0-9.]/g, '')

  // Prevent multiple decimal points, keep only the first
  const firstDotIndex = cleaned.indexOf('.')
  if (firstDotIndex !== -1) {
    cleaned = cleaned.slice(0, firstDotIndex + 1) + cleaned.slice(firstDotIndex + 1).replace(/\./g, '')
  }

  emit('update:modelValue', cleaned)
}
</script>

<style scoped>
.inp{
  width:100%;
  max-width:317px;
  box-sizing:border-box;
  display:flex;
  align-items:center;
  border-radius:8px;
  padding:0;
  height:48px
}
.inp input{
  border:none;
  outline:none;
  display: flex;
  height: 48px;
  flex-direction: column;
  justify-content: center;
  align-items: flex-end;
  gap: 9.253px;
  flex-shrink: 0;
  align-self: stretch;
  background:rgba(255,255,255,0);
  color: var(--Secondary-200, #DCE4E8);
  font-family: Inter;
  font-size: 16px;
  font-style: normal;
  font-weight: 600;
  line-height: 150%; /* 24px */
  letter-spacing: -0.32px;
  }
</style>