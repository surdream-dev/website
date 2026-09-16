<template>
  <div class="page-nav">
    <button
      class="arrow"
      :disabled="current <= 1"
      @click="current = 1"
    ><img src="@/assets/icons/page_start.svg"/></button>
    <!-- Left arrow -->
    <button
      class="arrow"
      :disabled="current <= 1"
      @click="current--"
    ><img src="@/assets/icons/page_left.svg"/></button>

    <!-- Page number button -->
    <button
      v-for="p in pages"
      :key="p"
      class="num"
      :class="{ active: p === current }"
      @click="current = p"
    >{{ p }}</button>

    <!-- Right arrow -->
    <button
      class="arrow"
      :disabled="current >= total"
      @click="current++"
    ><img src="@/assets/icons/page_right.svg"/></button>
    <button
      class="arrow"
      :disabled="current >= total"
      @click="current = total"
    ><img src="@/assets/icons/page_end.svg"/></button>
  </div>
</template>

<script setup>
import { computed, watch } from 'vue'

/* Props and v-model */
const props = defineProps({
  total:     { type: Number, required: true }, // Total pages
  modelValue:{ type: Number, default: 1 }      // Current page
})
const emit = defineEmits(['update:modelValue'])

const current = computed({
  get: () => props.modelValue,
  set: val => emit('update:modelValue', val)
})

/* Clamp an out-of-range current page back into [1, total] when the result set
   shrinks (e.g. after applying a filter), so no stale selected page points
   past an empty slice. */
watch(() => props.total, (t) => {
  if (props.modelValue > t) emit('update:modelValue', Math.max(1, t))
})

/* Generate page numbers (max 7 shown, including ellipsis) */
const pages = computed(() => {
  const t = props.total
  const c = current.value
  if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1)

  const left  = [1, 2]
  const right = [t - 1, t]
  const mid   = []

  if (c > 4) mid.push('…')
  for (let i = Math.max(3, c - 1); i <= Math.min(t - 2, c + 1); i++) mid.push(i)
  if (c < t - 3) mid.push('…')

  return [...left, ...mid, ...right].filter((v, i, a) => a.indexOf(v) === i)
})
</script>

<style scoped>
.page-nav{
  display:inline-flex;
  align-items:center;
  justify-content: center;
  width:100%;
  gap:10px;
}
.arrow,.num{
  display: flex;
  width: 32px;
  height: 32px;
  padding: 10px;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 10px;
  border-radius: 8px;
  border: 1px solid #343437;
  background: rgba(30, 30, 32, 0.20);
  color: var(--Tab-Color, #9E9E9E);
  font-family: "Open Sans";
  font-size: 13px;
  font-style: normal;
  font-weight: 600;
  line-height: normal;
}
.arrow:disabled{cursor:not-allowed;opacity:.4}
.num.active{
  border-radius: 8px;
  border: 1px solid var(--Primary-Default, #FFDD94);
  background: rgba(30, 30, 32, 0.20);
  color: var(--Primary-Default, #FFDD94);
  font-family: "Open Sans";
  font-size: 13px;
  font-style: normal;
  font-weight: 600;
  line-height: normal;
}
.num:hover:not(.active){
  border-radius: 8px;
  border: 1px solid var(--Primary-Default, #FFDD94);
  background: rgba(30, 30, 32, 0.20);
  color: var(--Primary-Default, #FFDD94);
  font-family: "Open Sans";
  font-size: 13px;
  font-style: normal;
  font-weight: 600;
  line-height: normal;
}
</style>