<template>
  <div class="scene">
    <div class="loader-orbit" ref="ringRef">
      <span
        v-for="i in 20"
        :key="i"
        class="dot"
        :style="`--i:${i - 1}`"
        ref="dots"
      ></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const ringRef = ref<HTMLElement | null>(null)
const dots = ref<HTMLElement[]>([])

let rafId = 0
let startTime = performance.now()

const COUNT = 20
const RADIUS = 105
const TILT = -10 // rotateX
const DURATION = 10000 // One revolution per 10s

function animate(time: number) {
  const elapsed = (time - startTime) % DURATION
  const progress = elapsed / DURATION
  const rotationY = progress * 360

  // Update loader rotation
  if (ringRef.value) {
    ringRef.value.style.transform = `
      rotateX(${TILT}deg)
      rotateY(${rotationY}deg)
    `
  }

  // Update the 'true depth' of each segment
  dots.value.forEach((dot, i) => {
    const angle =
      ((i * 360) / COUNT + rotationY) * (Math.PI / 180)

    // cos ∈ [-1, 1]
    const depth = Math.cos(angle)

    // Depth mapping (you can fine-tune)
    const blur = (1 - depth) * 1 // 0 → 5px
    const scale = 0.85 + depth * 0.15
    const opacity = 1 + depth * 0.75

    dot.style.filter = `blur(${blur}px)`
    dot.style.opacity = opacity.toString()
    dot.style.transform = `
      rotateY(${(i * 360) / COUNT}deg)
      translateZ(${RADIUS}px)
      scale(${scale})
    `
  })

  rafId = requestAnimationFrame(animate)
}

onMounted(() => {
  rafId = requestAnimationFrame(animate)
})

onUnmounted(() => {
  cancelAnimationFrame(rafId)
})
</script>

<style scoped>
/* ================= Scene ================= */
.scene {
  padding:120px;
  width: 175px;
  height: 160px;
  perspective: 350px;
}

/* ================= Rotating loader ================= */
.loader-orbit {
  position: relative;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
}

/* ================= Segments ================= */
.dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 30px;
  height: 30px;
  margin: -15px;
  border-radius: 50%;
  background: linear-gradient(
    90deg,
    #c49a4c 30%,
    #f6d77b 60%,
    #b1822a 100%
  );

  transform-style: preserve-3d;
  will-change: transform, filter, opacity;
}

/* = = = = = = = = = = Mobile Adaptation (< 768px) = = = = = = = = = = = */
@media (max-width: 768px) {
  .scene {
    width: 175px;
    max-width: 100%;
    height: 160px;
    padding: 0;
    box-sizing: border-box;
  }
}
</style>
