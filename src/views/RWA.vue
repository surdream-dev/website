<template>
  <div class="rwa-container page bg-black text-gray-100 font-sans items-center justify-items-center">
    <div class="container">
      <!-- Top title -->
      <div class="header">
        <h1 class="title">RWA</h1>
        <p class="subtitle">Explore the best RWA investment opportunities connecting real-world assets with on-chain liquidity.</p>
      </div>

      <!-- Investment product cards -->
      <div class="cards-wrapper">
        <div class="card" v-for="(item, index) in products" :key="index" @click="openUrl(item.url)">
          <div class="card-content">
            <img class="logo" :src="item.logo" />
            <h3 class="product-name">{{ item.name }}</h3>
            <a class="read-more" href="#" @click.stop.prevent="openUrl(item.url)">Read More <img src="@/assets/icons/sright.svg" /></a>
          </div>
        </div>
      </div>
      <FOOT></FOOT>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue'
import FOOT from '../components/Foot.vue'
// Bulk import using Vite's import.meta.glob
const icons = import.meta.glob('@/assets/logos/*.svg', { 
  eager: true,
  import: 'default' 
})

// Extract symbol from path
const getIcon = (symbol: string) => {
  const key = `/src/assets/logos/${symbol.toLowerCase()}.svg`
  for (const [path, icon] of Object.entries(icons)) {
    if (path.includes(symbol.toLowerCase())) {
      return icon as string
    }
  }
  return ''
}
const products = ref([
        { name: "Ondo Finance", logo: getIcon('Ondo'), url: "https://ondo.finance" },
        { name: "Tether Gold", logo: getIcon('TetherGold'), url: "https://gold.tether.to" },
        { name: "Paxos Gold", logo: getIcon('PaxosGold'), url: "https://paxos.com/paxgold" },
        { name: "Centrifuge", logo: getIcon('Centrifuge'), url: "https://centrifuge.io" }
])

// Clicking a card navigates to the corresponding website
function openUrl(url: string) {
  if (url) {
    window.open(url, '_blank')
  }
}
</script>

<style scoped>
/* Overall container: white background, rounded corners, shadow, fixed width */
.rwa-container {
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  margin:auto;
  padding: 110px 0 60px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.container {
  max-width: 1300px;
  margin: 0 auto;
}
/* Top title area */
.header {
  text-align: left;
  margin-bottom: 40px;
}
.title {
  font-feature-settings: 'salt' on, 'liga' off;

  /* Heading/Heading 3 */
  font-family: Raleway;
  font-size: 36px;
  font-style: normal;
  font-weight: 700;
  line-height: 44px; /* 122.222% */
  background: linear-gradient(90deg, #E7C56A 0%, #B49A53 20.53%, #816E3B 100%);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.subtitle {
  color: var(--Secondary-300, #ACB5BB);

  /* Regular/Type@20 */
  font-family: Inter;
  font-size: 20px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 30px */
  letter-spacing: -0.4px;
}

/* Card grid */
.cards-wrapper {
  width:1378px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
}

/* Individual card */
.card {
  display: flex;
  width: 324px;
  height: 600px;
  padding: 1px 0;
  flex-direction: column;
  align-items: flex-start;
  flex-shrink: 0;
  border-radius: 14px;
  border: 1px solid var(--gold, #C49A4C);
  background: #161618;
  cursor: pointer;
  transition: transform 0.2s ease;
}
.card:hover {
  transform: translateY(-4px);
}
.card:nth-child(1){
  background:url("@/assets/img/ondobg.png")
}
.card:nth-child(2){
  background:url("@/assets/img/tethergoldbg.png")
}
.card:nth-child(3){
  background:url("@/assets/img/paxosbg.png")
}
.card:nth-child(4){
  background:url("@/assets/img/centrifugebg.png")
}

/* Card inner text */
.card-content {
  flex: 1;
}
.card-content .logo {
  width:100px;
  height:100px;
  margin:174px 112px;
}
.product-name {
  color: var(--Primary-0, #FFF);

  /* Medium/Type20 */
  font-family: Inter;
  font-size: 20px;
  font-style: normal;
  font-weight: 500;
  line-height: 150%; /* 30px */
  letter-spacing: -0.4px;
  padding:36px 24px 17px;
}

/* Read More link */
.read-more {
  color: var(--Secondary-200, #DCE4E8);

  /* Medium/Type@16 */
  font-family: Inter;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: 150%; /* 24px */
  letter-spacing: -0.32px;
  padding:0 24px 0;
  display:flex;
  align-items:center;
}
.read-more img {
  margin-left:12px;
}

.foot{
  text-align: center;
  display:flex;
  gap:60px;
  padding:50px 0;
}
.foot a img {
  width:30px;
  height:30px;
}
.card:nth-child(n) {
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

/* = = = = = = = = = = Mobile Adaptation (< 768px) = = = = = = = = = = = */
@media (max-width: 768px) {
  .rwa-container {
    padding: 80px 0 40px;
  }

  .container {
    max-width: 100%;
    padding: 0 16px;
  }

  .header {
    margin-bottom: 24px;
  }

  .title {
    font-size: 24px;
    line-height: 32px;
  }

  .subtitle {
    font-size: 14px;
    line-height: 20px;
  }

  /* Four sections, two per row */
  .cards-wrapper {
    width: 100%;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  .card {
    width: 100%;
    height: 260px;
    padding: 0;
  }
  .card:hover {
    transform: translateY(0px);
  }

  .card-content {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .card-content .logo {
    width: 64px;
    height: 64px;
    margin: 30px auto 8px;
  }

  .product-name {
    font-size: 14px;
    line-height: 20px;
    padding: 12px 8px 8px;
    text-align: center;
  }

  .read-more {
    font-size: 12px;
    line-height: 18px;
    padding: 0;
    justify-content: center;
  }
}
</style>