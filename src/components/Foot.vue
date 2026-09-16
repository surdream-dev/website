<template>
  <div class="foot" :class="{ 'foot-fixed': fixed }">
    <a href="https://x.com/surdream2026" class="hover:underline pointer"><img src="@/assets/logos/x.svg" /></a>
    <a href="https://t.me/surdream2026" class="hover:underline pointer"><img src="@/assets/logos/tg.svg" /></a>
    <span @click="goToFaq()" class="pointer">FAQS</span>
  </div>
</template>
<script lang="ts" setup>
import { useRouter } from 'vue-router'

defineProps<{ fixed?: boolean }>()

const router = useRouter()
const goToFaq = () => {
  router.push('/#faq')
}
</script>
<style scoped>
.pointer {
  cursor:pointer;
}
.foot{
  text-align: left;
  display:flex;
  gap:60px;
  padding:50px 0;
  width:100%;
}
.foot a img {
  width:30px;
  height:30px;
}
.foot span {
  color: var(--Secondary-100, #EDF1F3);
  font-family: Inter;
  font-size: 24px;
  font-style: normal;
  font-weight: 600;
  line-height: 150%; /* 36px */
  letter-spacing: -0.72px;
}

/* = = = = = = = = = = Mobile Adaptation (< 768px) = = = = = = = = = = = */
@media (max-width: 768px) {
  .foot {
    gap: 24px;
    padding: 30px 0;
    justify-content: center;
  }

  .foot a img {
    width: 24px;
    height: 24px;
  }

  .foot span {
    font-size: 18px;
  }

  /* Need to be fixed at the bottom (Portfolio mobile) */
  .foot.foot-fixed {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 50;
    justify-content: center;
    padding: 12px 0;
    margin: 0;
    background: rgba(15, 14, 19, 0.92);
    backdrop-filter: blur(10px);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
}
</style>
