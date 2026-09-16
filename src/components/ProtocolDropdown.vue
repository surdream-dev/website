<template>
  <div class="dropdown">
    <!-- Link ‘Trigger’ -->
    <div class="search-box" @click="open = !open">
      <img class="search" src="@/assets/icons/search.svg" />
      <input :placeholder="`Protocols: ${modelValue.length}`" />
      <img class="close" :class="{ open }" src="@/assets/icons/arrow_circle_down.svg"/>
    </div>
    <!-- Drop-down panel -->
    <div v-if="open" class="panel">
      <div class="header">
        <span class="clear" @click.stop="clearAll">Clear all</span>
      </div>

      <ul class="list">
        <li
          v-for="item in options"
          :key="item.value"
          class="item"
          @click="toggle(item.value)"
        >
          <div class="left">
            <img :src="getIcon(item.value)" class="icon" />
            <span>{{ item.label }}</span>
          </div>

          <div class="check">
            <span v-if="isChecked(item.value)" class="checked">✓</span>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'

interface Option {
  label: string
  value: string
  icon?: string
}

const props = defineProps<{
  modelValue: string[]
  options: Option[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string[]): void
}>()

const open = ref(false)

const isChecked = (val: string) => {
  return props.modelValue.includes(val)
}

const toggle = (val: string) => {
  const next = [...props.modelValue]
  const idx = next.indexOf(val)

  if (idx > -1) next.splice(idx, 1)
  else next.push(val)

  emit('update:modelValue', next)
}
const clearAll = () => {
  emit('update:modelValue', [])
}
// Bulk import using Vite's import.meta.glob
const icons = import.meta.glob('@/assets/logos/*.svg', { 
  eager: true,
  import: 'default' 
})

// Extract symbol from path
// For pool IDs (e.g. compound-eth), extract the protocol name (compound) to match the logo
const getIcon = (symbol: string) => {
  const lookup = symbol.toLowerCase().split('-')[0]
  for (const [path, icon] of Object.entries(icons)) {
    if (path.includes(lookup)) {
      return icon as string
    }
  }
  return ''
}

</script>
<style scoped>
.dropdown {
  position: relative;
  font-family: Inter, system-ui, sans-serif;
}

.trigger {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #1e1e20;
  border: 1px solid #2a2a2e;
  border-radius: 12px;
  color: #fff;
  cursor: pointer;
}

.arrow {
  transition: transform 0.2s ease;
}
.arrow.open {
  transform: rotate(180deg);
}

/* Drop-down panel */
.panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  width: 100%;
  border-radius: 4.533px;
  border: 0.567px solid var(--Secondary-600, #2C2C30);
  background: #000;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.7);
  z-index: 10;
}

.header {
  padding: 4.533px 9.067px;
  border-radius: 4.533px 4.533px 0 0;
  border-bottom: 0.12px solid var(--Tab-Color, #9e9e9e26);
  background: #000;
  display: flex;
  height: 27px;
  padding: 4.533px 9.067px;
  align-items: center;
  gap: 5.667px;
  flex-shrink: 0;
  align-self: stretch;
}

.clear {
  color: #FFF;
  text-align: center;
  font-family: Inter;
  font-size: 9.067px;
  font-style: normal;
  font-weight: 500;
  line-height: normal;
  cursor:pointer;
}
.clear:hover {
  color: #fff;
}

/* Vertical */
.list {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.item {
  display: flex;
  height: 27.2px;
  padding: 6.8px 13.6px;
  align-items: center;
  align-self: stretch;
  background: #000;
}

.left {
  width:150px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #fff;
  color: #FFF;
  text-align: center;
  font-family: Inter;
  font-size: 9.067px;
  font-style: normal;
  font-weight: 500;
  line-height: normal;
}

.icon {
  width: 18px;
  height: 18px;
  border-radius: 50%;
}

/* check */
.check {
  width: 16px;
  height: 16px;
  border-radius: 20%;
  border: 1px solid #2a2a2a;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor:pointer;
  background:#fff;
}

.checked {
  background: rgba(20, 161, 85, 1);
  color: #fff;
  width: 100%;
  height: 100%;
  border-radius: 20%;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.search-box{
  display: flex;
  align-items: center;
  gap:16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 14px;
  width: 200px;
  background-color: rgba(255,255,255,0);
  border-radius: 8px;
  border: 1px solid var(--Secondary-600, #2C2C30);
  background: var(--Secondary-700, #161618);
  outline: none;
}
.search-box input {
  width: 100px;
  background: rgba(255,255,255,0);
  outline: none;
}
.search-box .search,img {
  width:16px;
  height:16px;
}
.search-box .close,img {
  width:24px;
  height:24px;
}
</style>