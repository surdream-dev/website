<template>
  <div class="min-h-screen bg-black text-gray-100 font-sans home">
    <div class="firstpage-bg"></div>
    <div class="first-page-bg-1"></div>
    <!-- Hero -->
    <section class="first-page items-center justify-items-center">
      <div class="container mx-auto flex items-center justify-between">
        <div class="float-swing">
              <img src="@/assets/img/firstpage1.png" alt="hero" class="w-80 h-80 object-contain floating-img"/>
          </div>
        <div>
          <h2 class="text-5xl font-extrabold leading-tight fisrt-page-head">
            <div class="fisrt-page-am">
              <span>Dream your</span><br/>
              <span>Manage your</span><br/>
              <span>Grow your</span><br/>
              <span>Decentralize your</span><br/>
            </div>
            <span class="wealth">Wealth</span><br/>
            <span>Own your future</span></h2>
          <p class="mt-4 text-gray-300 max-w-xl fisrt-page-head-desc">
              <span><span class="blod">SurDream</span> is a decentralized wealth management protocol </span><br/>
              <span>— seamlessly connecting staking, yield, lending, and RWA opportunities into one intelligent ecosystem.</span><br/>
              <span>We bring the entire DeFi world into one place, empowering everyone to realize their wealth dream.</span></p>
        </div>
      </div>
    </section>

    <!-- Top APY Cards -->
    <section class="container mx-auto apy">
      <h3 class="text-2xl font-bold apy-head"><span>TOP APY</span></h3>
      <div class="flex justify-between flex-wrap">
        <div
          v-for="(card, i) in apyCards" :key="i"
          :class="[
            'apy-card-wrapper',
            card.asset === 'USDT' ? 'bg-usdt' : (card.asset === 'USDC' || card.asset === 'USDe') ? 'bg-usdc' : 'bg-generic'
          ]"
        >
          <div class="apy-card">
            <!-- Background decoration: protocol logo + asset logo -->
            <template v-if="card.asset !== 'USDT' && card.asset !== 'USDC' && card.asset !== 'USDe'">
              <img :src="card.icon" class="card-bg-logo card-bg-logo-1" />
              <img :src="getIcon(card.asset)" class="card-bg-logo card-bg-logo-2" />
            </template>
            <div class="grid justify-items-center gap-4">
              <div class="w-32 h-32 rounded-full flex items-center justify-center apy-logo-wrap">
                <img :src="card.icon" alt="icon" class="w-30 h-30 apy-logo" />
              </div>
              <div class="justify-items-center">
                <div class="card-protocol">{{ card.symbol }}</div>
                <div class="card-symbol">{{ card.asset }}</div>
              </div>
            </div>
            <div class="grid justify-items-center">
              <div class="card-apy">APY: <span class="font-semibold">{{ card.apy }}</span></div>
              <div class="card-tvl">TVL: <span class="font-medium">{{ card.tvl }}</span></div>
              <button class="earn-btn" @click="handleEarn(card)">Earn</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Integrated DeFi Logos -->
    <section class="container mx-auto defi">
      <h3 class="flex defi-head justify-between">
        <span>Integrated DeFi</span>
        <div class="flex justify-between defi-menu align-center" >
          <div :class="activeFilter==='all'?'defi-menu-item-active':'defi-menu-item'" @click="activeFilter='all'">ALL</div>
          <div :class="activeFilter==='staking'?'defi-menu-item-active':'defi-menu-item'" @click="activeFilter='staking'">Staking</div>
          <div :class="activeFilter==='lending'?'defi-menu-item-active':'defi-menu-item'" @click="activeFilter='lending'">Lending</div>
          <div :class="activeFilter==='yield'?'defi-menu-item-active':'defi-menu-item'" @click="activeFilter='yield'">Yield</div>
          <div :class="activeFilter==='rwa'?'defi-menu-item-active':'defi-menu-item'" @click="activeFilter='rwa'">RWA</div>
        </div>
      </h3>
      <div class="grid defi-content">
        <div v-for="(logo, idx) in filteredProtocols" :key="idx" @click="goToUser('Stake')" class="defi-card">
          <img :src="logo.src" :alt="logo.name" class="w-12 h-12 object-contain defi-card-img" />
          <div class="defi-card-text">{{logo.name}}</div>
        </div>
      </div>
    </section>

    <!-- FAQ Accordion -->
    <section class="container mx-auto faq" id="faq">
    <h3 class="text-2xl font-bold faq-head"><span>Frequently Asked Questions</span></h3>
      <div class="faq-content">
        <div v-for="(f, i) in faqs" :key="i" class="faq-item">
          <div class="flex items-center justify-between cursor-pointer faq-item-q" @click="toggleFAQ(i)">
            <div class="faq-item-q-text">{{ f.q }}</div>
            <div :class="f.f ? 'faq-item-btn':'faq-item-btn btn-close'"><img src="@/assets/img/arrow.svg"/></div>
          </div>
          <div v-show="f.f" class="faq-item-a-text">
            <p v-if="i<3"><span v-for="(item, i) in f.a" :key="i">{{ item }}</span></p>
            <p v-if="i>2">
            <div class="mb-6">SurDream itself does not have any smart contracts. Therefore, you do not interact with SurDream at the contract level. You remain in full control of your assets and interact directly with the smart contracts of different DeFi protocols. But all DeFi Protocols may have different kinds of risks, such as: </div>
            <div><span class="font-semibold faq-item-a-text-1">Smart Contract Risks:</span> The potential for a bug or vulnerability in the code that could be exploited.</div>
            <div><span class="font-semibold faq-item-a-text-1">Liquidity Risks:</span> DeFi Protocols could run out of liquidity.</div>
            <div class="italic faq-item-a-text-2 mt-6">SurDream is not responsible for any losses caused by third-party DeFi protocols. </div>
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="flex flex-col foot align-center">
      <div class="container mx-auto flex items-center flex-col">
        <p class="foot-text1">Grow with the SurDream Community</p>
        <p class="foot-text2">Connect with crypto investors, DeFi builders, and creators shaping the future of decentralized wealth. Share ideas, collaborate, and stay ahead of the market.</p>
        <div class="foot-social">
          <a href="https://x.com/surdream2026" class="hover:underline"><img src="../assets/logos/x.svg" /></a>
          <a href="https://t.me/surdream2026" class="hover:underline"><img src="../assets/logos/tg.svg" /></a>
        </div>
        <p class="foot-text3">© 2026 SurDream Protocol. All rights reserved.</p>
      </div>
    </footer>

    <!-- Modal components -->
    <StakeModal v-model="stakeModalVisible" :selectedItem="selectedItem" :availableTabs="stakeModalTabs" />
    <LendingModal v-model="lendingModalVisible" :selectedItem="selectedItem" :availableTabs="lendingModalTabs" />
    <StablecoinsModal v-model="stableModalVisible" :selectedItem="selectedItem" :availableTabs="stablecoinModalTabs" />
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue'
import { useRouter } from 'vue-router'
import { lendingProtocols, stakeProtocols, stablecoinProtocols, getLendingProtocol, getStakeProtocol, getStablecoinProtocol, LENDING_PROTOCOL_NAMES } from '@/constants/protocols'
import StakeModal from '@/components/stakeOp/index.vue'
import LendingModal from '@/components/lendingOp/index.vue'
import StablecoinsModal from '@/components/stablecoinsOp/index.vue'
import { enrichLendingItem } from '@/composables/useLendingItem'
import { getLendingRates } from '@/composables/useLendingApy'
import { useProtocolApy } from '@/composables/useProtocolApy'
import { getStablecoinTvlUsd, getStablecoinApy, formatUsd, buildStablecoinOpItem } from '@/composables/useStablecoinData'

const router = useRouter()
const goToUser = (path) => {
  router.push({
    name: path
  })
}

// Modal state
const stakeModalVisible = ref(false)
const lendingModalVisible = ref(false)
const stableModalVisible = ref(false)
const selectedItem = ref<any>(null)
const stakeModalTabs = ['Stake']
const lendingModalTabs = ['Supply']
const stablecoinModalTabs = ['Deposit', 'Withdraw']

// Real-time on-chain lending APY (key: protocolId:assetAddress → supplyAPY); cards and the modal share the same source
const lendingApyMap = ref<Record<string, number>>({})

async function loadLendingApy() {
  const protocolIds = [...new Set(lendingProtocols.map(p => p.protocolId))]
  const merged: Record<string, number> = {}
  await Promise.all(protocolIds.map(async protocolId => {
    const rates = await getLendingRates(protocolId)
    if (!rates) return
    for (const [addr, info] of rates) {
      merged[`${protocolId}:${addr}`] = info.supplyAPY
    }
  }))
  lendingApyMap.value = merged
}
loadLendingApy()

// Official APY (stake/stablecoin): API first; '-' when no official API
const { apyMap: officialApyMap, fetchApys } = useProtocolApy()
fetchApys(['lido', 'rocketpool', 'etherfi', 'stakewise', 'stader', 'meth', 'ethena'])

// Top APY card APY + TVL (key: protocolId-asset → formatted), filled per card asynchronously.
// APY shares getStablecoinApy with the Stablecoin page (Fluid→fToken supplyRate, Morpho→vault netApy, lending→on-chain rates, ethena→official); the two no longer drift.
const cardApys = ref<Record<string, string>>({})
const cardTvls = ref<Record<string, string>>({})
async function loadCardData() {
  const apyMerged: Record<string, string> = {}
  const tvlMerged: Record<string, string> = {}
  await Promise.all(stablecoinProtocols.map(async p => {
    if (p.protocolId === 'curve') return
    const key = `${p.protocolId}-${p.asset}`.toLowerCase()
    try {
      const apy = await getStablecoinApy(p)
      if (apy !== null) apyMerged[key] = apy.toFixed(2) + '%'
    } catch (e) {
      console.warn(`[Home] ${p.protocolId}/${p.asset} APY 获取失败:`, e)
    }
    try {
      const tvlUsd = await getStablecoinTvlUsd(p)
      if (tvlUsd !== null && tvlUsd > 0) tvlMerged[key] = formatUsd(tvlUsd)
    } catch (e) {
      console.warn(`[Home] ${p.protocolId}/${p.asset} TVL 获取失败:`, e)
    }
  }))
  cardApys.value = apyMerged
  cardTvls.value = tvlMerged
}
loadCardData()

// Shared by stablecoin cards/modals: read cardApys (same source as the list); missing real-time values uniformly → '-' (no fallback to hardcoded config defaults)
function stablecoinApyDisplay(p: any): string {
  return cardApys.value[`${p.protocolId}-${p.asset}`.toLowerCase()] || '-'
}

// Open the corresponding modal
function handleEarn(card: Card) {
  if (card.type === 'stake') {
    const item = stakeProtocols.find(p => p.protocolId === card.protocol && p.asset === card.asset)
    if (item) {
      const baseApy = officialApyMap.value[item.protocolId] ?? null
      selectedItem.value = {
        protocol: item.name,
        protocolId: item.protocolId,
        icon: card.icon,
        asset: item.asset,
        assetAddress: item.assetAddress,
        decimals: item.decimals,
        receiptToken: item.contracts.token,
        receiptTokenSymbol: item.receiptTokenSymbol,
        tvl: '-',
        basicApy: baseApy !== null ? baseApy.toFixed(2) + '%' : '-',
        unstakePeriod: item.unstakePeriod,
        launchYear: item.launchYear,
        metrics: { apy: { base: baseApy ?? 0, boost: baseApy ?? 0, total: baseApy ?? 0 }, tvl: 0 },
        unstake: { period: item.unstakePeriod }
      }
      stakeModalVisible.value = true
    }
  } else if (card.type === 'lending') {
    const item = getLendingProtocol(card.protocol, card.asset)
    if (item) {
      // Consistent with other entry points: fill in pooled fields (poolId/loanAsset/loanAssetAddress/loanDecimals etc.)
      const enriched = enrichLendingItem(item, 'supply')
      // APY prefers real-time on-chain data (same source as all pages); falls back to metadata while not loaded
      const chainSupplyApy = lendingApyMap.value[`${item.protocolId}:${(item.assetAddress || '').toLowerCase()}`]
      // Missing real-time values show explicit '-' (matching list cards), not hardcoded config defaults
      selectedItem.value = {
        ...enriched,
        supplyApy: chainSupplyApy !== undefined ? chainSupplyApy.toFixed(2) + '%' : '-',
        borrowApy: undefined,
        metrics: {
          supplyApy: chainSupplyApy,
          borrowApy: undefined,
          utilization: 0,
          totalSuppliedFmt: '-',
          totalBorrowedFmt: '-'
        }
      }
      lendingModalVisible.value = true
    }
  } else if (card.type === 'stablecoin') {
    const item = getStablecoinProtocol(card.protocol, card.asset)
    if (item) {
      const key = `${item.protocolId}-${item.asset}`.toLowerCase()
      const apyStr = stablecoinApyDisplay(item)
      const apyVal = apyStr === '-' ? undefined : parseFloat(apyStr)
      // Shares the same row data as the Stablecoin page (receiptToken/approveSpender/contracts etc.) so Withdraw works
      selectedItem.value = {
        ...buildStablecoinOpItem(item),
        icon: getIcon(item.asset),
        apy: apyStr,
        tvl: cardTvls.value[key] || '-',
        metrics: { apy: apyVal, tvl: 0, tvlFmt: '-' }
      }
      stableModalVisible.value = true
    }
  }
}


const videoRef = ref(null)
// const videoSrc = firstVideo
const isLoading = ref(true)
const hasError = ref(false)
const errorCount = ref(0)
const maxRetries = 3

// Backup video source list
const backupSources = [
  '@/assets/firstpage.mp4'
]

// Fixed video error handling
const onVideoError = (event) => {
  
  hasError.value = true
  isLoading.value = false
  
  // Retry logic
  if (errorCount.value < maxRetries) {
    errorCount.value++
    
    // Switch to the backup video source
    if (errorCount.value - 1 < backupSources.length) {
      videoSrc.value = backupSources[errorCount.value - 1]
      setTimeout(() => {
        if (videoRef.value) {
          videoRef.value.load() // Reload the video
        }
      }, 1000)
    } else {
      // All backup sources failed
    }
  } else {
  }
}

// Video starts loading
const onVideoLoadStart = () => {
  isLoading.value = true
  hasError.value = false
}

// Video stutters
const onVideoStalled = () => {
  if (videoRef.value && errorCount.value < maxRetries) {
    setTimeout(() => {
      if (videoRef.value) {
        videoRef.value.load()
      }
    }, 2000)
  }
}

// Improved autoplay function
const ensureAutoplay = async () => {
  if (!videoRef.value) {
    return
  }
  
  try {
    // Set muted
    videoRef.value.muted = true
    
    // Check whether the video has buffered enough data
    if (videoRef.value.readyState < 2) { // HAVE_CURRENT_DATA
      await new Promise((resolve, reject) => {
        const onCanPlay = () => {
          videoRef.value.removeEventListener('canplay', onCanPlay)
          resolve()
        }
        const onError = () => {
          videoRef.value.removeEventListener('error', onError)
          reject(new Error('Video failed to load'))
        }
        videoRef.value.addEventListener('canplay', onCanPlay, { once: true })
        videoRef.value.addEventListener('error', onError, { once: true })
        
        // Set a timeout
        setTimeout(() => {
          videoRef.value.removeEventListener('canplay', onCanPlay)
          videoRef.value.removeEventListener('error', onError)
          resolve() // Keep trying to play
        }, 5000)
      })
    }
    
    // Try to play
    const playPromise = videoRef.value.play()
    
    if (playPromise !== undefined) {
      await playPromise
      isLoading.value = false
      hasError.value = false
    }
  } catch (error) {
    console.warn('自动播放失败:', error)
    hasError.value = true
    
    // Retry playback after user interaction
    const handleUserInteraction = () => {
      if (videoRef.value && !videoRef.value.playing) {
        videoRef.value.play().catch(e => console.warn('用户交互后播放失败:', e))
      }
      // Remove listeners
      document.removeEventListener('click', handleUserInteraction)
      document.removeEventListener('touchstart', handleUserInteraction)
      document.removeEventListener('keydown', handleUserInteraction)
    }
    
    // Add multiple user-interaction listeners
    document.addEventListener('click', handleUserInteraction, { once: true })
    document.addEventListener('touchstart', handleUserInteraction, { once: true })
    document.addEventListener('keydown', handleUserInteraction, { once: true })
  }
}

// Video can play
const onVideoCanPlay = () => {
  isLoading.value = false
}

interface Card {
  symbol: string;
  apy: string;
  tvl: string;
  icon: string;
  protocol: string;
  type: 'stake' | 'lending' | 'stablecoin';
  asset: string;
}

// Bulk import using Vite's import.meta.glob
const icons = import.meta.glob('@/assets/logos/*.svg', {
  eager: true,
  import: 'default'
})

// Extract symbol from path
const getIcon = (symbol: string) => {
  if (!symbol || typeof symbol !== 'string') return ''
  const s = symbol.toLowerCase()
  for (const [path, icon] of Object.entries(icons)) {
    if (path.toLowerCase().includes(s)) {
      return icon as string
    }
  }
  return ''
}

// Protocol name mapping
const protocolNameMap: Record<string, string> = {
  lido: 'Lido',
  etherfi: 'ether.fi',
  rocketpool: 'Rocket Pool',
  stakewise: 'StakeWise',
  meth: 'mETH',
  stader: 'Stader',
  aave: 'AAVE',
  compound: 'Compound',
  morpho: 'Morpho',
  sparklend: 'SparkLend',
  fluid: 'Fluid',
  euler: 'Euler',
  ethena: 'Ethena',
  curve: 'Curve'
}

// Top APY: pick only from stablecoin yield pools (ethena + lending's USDC/USDT liquidity, curve hidden), sorted by APY, take the top 8
const apyCards = computed<Card[]>(() => {
  const result: Card[] = []
  const seen = new Set<string>() // Dedupe by: "protocol-asset"

  // Stablecoin protocols (ethena + USDC/USDT liquidity in aave/compound/morpho/sparklend/fluid)
  stablecoinProtocols.forEach(p => {
    // Hide Curve (nearly zero yield; excluded from Top APY operation entries)
    if (p.protocolId === 'curve') return
    const key = `${p.protocolId}-${p.asset}`.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    result.push({
      symbol: LENDING_PROTOCOL_NAMES[p.protocolId] || p.name,
      apy: stablecoinApyDisplay(p),
      tvl: cardTvls.value[key] || '-',
      icon: getIcon(p.protocolId),
      protocol: p.protocolId,
      type: 'stablecoin',
      asset: p.asset
    })
  })

  // Sort by APY descending, take the top 8
  return result
    .sort((a, b) => parseFloat(b.apy) - parseFloat(a.apy))
    .slice(0, 8)
})


const filters = [
  { value: 'all', label: 'All' },
  { value: 'staking', label: 'Staking' },
  { value: 'lending', label: 'Lending' },
  { value: 'yield', label: 'Yield' },
  { value: 'rwa', label: 'RWA' }
]

const activeFilter = ref('all')

const protocolsData = ref([
  { name: 'AAVE', src: getIcon('AAVE'), type: 'lending' },
  { name: 'Lido', src: getIcon('Lido'), type: 'staking' },
  { name: 'Eigen Layer', src: getIcon('EigenLayer'), type: 'staking' },
  { name: 'Ethena', src: getIcon('Ethena'), type: 'yield' },
  { name: 'ether.fi', src: getIcon('etherfi'), type: 'staking' },
  { name: 'SparkLend', src: getIcon('SparkLend'), type: 'lending' },
  { name: 'Morpho', src: getIcon('Morpho'), type: 'lending' },
  { name: 'Rocket Pool', src: getIcon('RocketPool'), type: 'staking' },
  { name: 'Compound', src: getIcon('Compound'), type: 'lending' },
  { name: 'Tether Gold', src: getIcon('TetherGold'), type: 'rwa' },
  { name: 'Curve', src: getIcon('Curve'), type: 'lending' },
  { name: 'Ondo', src: getIcon('Ondo'), type: 'rwa' },
  { name: 'StakeWise', src: getIcon('StakeWise'), type: 'staking' },
  { name: 'Paxos Gold', src: getIcon('PaxosGold'), type: 'rwa' },
  { name: 'Fluid', src: getIcon('Fluid'), type: 'lending' },
  { name: 'mETH', src: getIcon('mETH'), type: 'staking' },
  { name: 'Euler', src: getIcon('Euler'), type: 'lending' },
  { name: 'Stader', src: getIcon('Stader'), type: 'staking' },
  { name: 'Centrifuge', src: getIcon('Centrifuge'), type: 'rwa' }
])
const filteredProtocols = computed(() => {
  if (activeFilter.value === 'all') {
    return protocolsData.value
  }
  return protocolsData.value.filter(protocol => protocol.type === activeFilter.value)
})

const faqs = ref([
  { q: 'What is SurDream Protocol?', a: ['SurDream is an all-in-one protocol to help you manage your wealth in different DeFi platforms, such as staking, yield, lending and RWA.'] ,f:true},
  { q: 'What are the advantages of SurDream?', a: ['You could find the best yields and rates without switching between different websites. You can do all kinds of DeFi transactions on SurDream platform. You can easily track your DeFi positions across different DeFi protocols and manage your portfolio whenever you want.'] ,f:true},
  { q: 'Are there any fees?', a: ['SurDream does not charge any fees. You only need to pay gas fees for the transactions.'],f:true },
  { q: 'What are the risks?', a: ['SurDream itself does not have any smart contracts. Therefore, you do not interact with SurDream at the contract level. You remain in full control of your assets and interact directly with the smart contracts of different DeFi protocols.','But all DeFi Protocols may have different kinds of risks, such as:\'.\'Smart Contract Risks: The potential for a bug or vulnerability in the code that could be exploited.Liquidity Risks: DeFi Protocols could run out of liquidity.','SurDream is not responsible for any losses caused by third-party DeFi protocols. '],f:true }
])

const activeFaq = ref<number | null>(null)
const toggleFAQ=(i: number)=> {
  faqs.value[i].f = !faqs.value[i].f
}

// Add video source monitoring
// watch(videoSrc, (newSrc) => {
//   if (videoRef.value) {
//     videoRef.value.load()
//   }
// })

// onMounted(() => {
// // Ensure the DOM is loaded
//   nextTick(() => {
//     if (videoRef.value) {
//       ensureAutoplay()
//     } else {
//       console.error('videoRef')
//     }
//   })
  
// // Add a global error handler
//   window.addEventListener('error', (event) => {
//     if (event.target && event.target.tagName === 'VIDEO') {
//       console.error('error:', event)
//     }
//   })
// })

onUnmounted(() => {
  // Cleanup
  if (videoRef.value) {
    videoRef.value.pause()
    videoRef.value.src = ''
    videoRef.value.load()
  }
})
</script>

<style scoped>
/* Basic styling, recommend using Tailwind in a real project */
.container { max-width: 1300px; padding: 0 32px; box-sizing: border-box; }
.justify-items-center {
    justify-items:center;
}
.first-page {
    height: 697px;
    width: 100%;
    z-index:1;
    position: relative;
    padding-top:128px;
}
.first-page-bg-1 {
    height: 910px;
    width: 100%;
    background-image: url("@/assets/firstpagebg.svg");
    background-size: cover;
    position: absolute;
    z-index:0;
}
.firstpage-bg {
  background: linear-gradient(180deg, #F5EBFF -22.42%, #F8D78E 13.7%, #F3D48F 63.92%, rgba(0, 0, 0, 0.00) 99.73%);
  opacity: 0.18;
  filter: blur(100px);
  width: 875px;
  height: 1669px;
  transform: rotate(-60deg);
  position: absolute;
  z-index:0;
  top: -386px;
}
.fisrt-page-head {
    color: var(--Secondary-300, #ACB5BB);
    font-family: Rhythm;
    font-size: 40px;
    font-style: normal;
    font-weight: 400;
    line-height: 150%; /* 60px */
    letter-spacing: -1.2px;
}
.fisrt-page-head-desc {
  color: var(--Secondary-300, #ACB5BB);
  /* Regular/Type@16 */
  font-family: Inter;
  font-size: 16px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  letter-spacing: -0.32px;
  width: 560px;
}
.fisrt-page-head-desc .blod {
  font-weight: 600;
}
@keyframes preciseMove {
  0% { transform: translateY(0); }
  2.78% { transform: translateY(-60px); }
  
  /* 2nd move: -60px → -120px */
  16.667% { transform: translateY(-60px); }
  19.447% { transform: translateY(-120px); }
  
  /* 3rd move: -120px → -180px */
  33.333% { transform: translateY(-120px); }
  36.113% { transform: translateY(-180px); }
  
  /* Stay in */
  50% { transform: translateY(-180px); }
  
  /* Reverse Move Stage */
  /* 4th move: -180px → -120px */
  52.78% { transform: translateY(-120px); }
  66.667% { transform: translateY(-120px); }
  
  /* 5th move: -120px → -60px */
  69.447% { transform: translateY(-60px); }
  83.333% { transform: translateY(-60px); }
  
  /* 6th move: -60px → 0 */
  86.113% { transform: translateY(0); }
  
  /* Final stay */
  100% { transform: translateY(0); }
}
.fisrt-page-am {
  position:relative;
  height:60px;
  overflow: hidden;
  margin-bottom:8px;
}
.fisrt-page-am span {
  position: absolute;
  animation: preciseMove 25s linear infinite;
}
.wealth {
  font-family: Rhythm;
  font-size: 96px;
  font-style: normal;
  font-weight: 400;
  line-height: 100%; /* 115.2px */
  letter-spacing: -2.88px;
  background: var(--gold, linear-gradient(90deg, #C49A4C 30.29%, #F6D77B 69.23%, #B1822A 100%));
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  padding-top:8px;
}
.video{
  width:360px;
}
@keyframes float-gyro {
  0%, 100% {
    transform: translateY(0);
  }
  25% {
    transform: translateY(-8px);
  }
  50% {
    transform: translateY(0);
  }
  75% {
    transform: translateY(-4px);
  }
}
.float-swing {
  width: 591.852px;
  height: 568.747px;
  flex-shrink: 0;
  padding: 73px 104px 93px 84px;
}
.float-swing img {
  width:403px;
  height:403px;
  animation: float-gyro 6s ease-in-out infinite;
}

.apy {
  margin-top:150px;
  z-index:1;
  width:100%;
  max-width:1300px;
  height: 876px;
}
.apy-head{
    padding-bottom:50px;
}
.apy-head span{
    font-feature-settings: 'salt' on, 'liga' off;

    /* Heading/Heading 3 */
    font-family: Raleway;
    font-size: 36px;
    font-style: normal;
    font-weight: 700;
    line-height: 44px; /* 122.222% */
    background: linear-gradient(90deg, #C49A4C 30.29%, #F6D77B 69.23%, #B1822A 100%);
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}
.apy-card-wrapper {
  border-radius: 18px;
  width:289px;
  height:355px;
  overflow: hidden;
}
.apy-card-wrapper.bg-usdt {
  background: url('../assets/img/usdtbg.png');
}
.apy-card-wrapper.bg-usdc {
  background: url('../assets/img/usdcbg.png') no-repeat;
}
.apy-card-wrapper.bg-generic {
  background: var(--Secondary-700, #161618);
  border: 1px solid rgba(255, 255, 255, 0.10);
}
.apy-card {
  width:289px;
  height:355px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.50);
  box-shadow: 0 4px 200px 0 rgba(0, 0, 0, 0.25);
  background-color:rgba(0,0,0,0);
  padding: 29px 0 22px;
  position:relative;
  z-index:1;
  overflow: hidden;
}
.card-bg-logo {
  position: absolute;
  bottom: -20px;
  right: -20px;
  width: 180px;
  height: 180px;
  object-fit: contain;
  opacity: 0.08;
  pointer-events: none;
  z-index: 0;
}
.card-bg-logo-1 {
  bottom: -10px;
  right: -10px;
  width: 160px;
  height: 160px;
  opacity: 0.10;
}
.card-bg-logo-2 {
  bottom: -30px;
  right: 20px;
  width: 140px;
  height: 140px;
  opacity: 0.06;
}
.apy-logo-wrap {
  width: 80px;
  height: 80px;
}
.apy-logo {
  width: 64px;
  height: 64px;
  object-fit: contain;
}
.card-protocol {
  color: var(--Font-Color-Light-Title, #ECF1F0);
  font-family: Raleway;
  font-size: 18px;
  font-style: normal;
  font-weight: 600;
  line-height: normal;
  margin-top:8px;
  text-align: center;
}
.card-symbol {
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  margin-top:2px;
  text-align: center;
}
.apy-card-wrapper:nth-child(1),
.apy-card-wrapper:nth-child(2),
.apy-card-wrapper:nth-child(3),
.apy-card-wrapper:nth-child(4){
  margin-bottom:80px;
}
.coinbg {
  position:absolute;
  bottom: 0;
}
.card-apy {
  margin-top: 35px;
  color: var(--Font-Color-Light-Title, #ECF1F0);
  font-family: Roboto;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: normal;
}
.card-tvl {
  margin-top: 8px;
  color: var(--Font-Color-Light-Subtitle, #B6B6B6);
  font-feature-settings: 'salt' on, 'liga' off;
  font-family: Roboto;
  font-size: 11px;
  font-style: normal;
  font-weight: 500;
  line-height: 160%; /* 17.6px */
}
.earn-btn{
    border-radius: 10px;
    background: var(--gold, linear-gradient(90deg, #C49A4C 30.29%, #F6D77B 69.23%, #B1822A 100%));
    display: flex;
    padding: 4px 24px;
    justify-content: center;
    align-items: center;
    gap: 10px;
    color: var(--Font-Color-Pure-White, #FFF);
    text-align: center;

    /* Semibold/Type@16 */
    font-family: Inter;
    font-size: 16px;
    font-style: normal;
    font-weight: 600;
    line-height: 150%; /* 24px */
    letter-spacing: -0.32px;
    margin-top: 14px;
}
.defi {
  margin-top:150px;
  z-index:1;
  width:100%;
  max-width:1300px;
}
.defi-head{
    padding-bottom:50px;
}
.defi-head span{
    font-feature-settings: 'salt' on, 'liga' off;
    /* Heading/Heading 3 */
    font-family: Raleway;
    font-size: 36px;
    font-style: normal;
    font-weight: 700;
    line-height: 44px; /* 122.222% */
    background: var(--gold, linear-gradient(90deg, #C49A4C 30.29%, #F6D77B 69.23%, #B1822A 100%));
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}
.defi-menu {
  width:443px;
  height:44px;
  align-items:center;
}
.defi-menu-item {
  display: flex;
  height: 23px;
  padding: 0 15px;
  justify-content: center;
  align-items: center;
  gap: 15px;
  border-radius: 15px;
  border: 1px solid #343437;
  color: var(--Text-10, #9E9E9E);
  text-align: center;
  font-family: Poppins;
  font-size: 15px;
  font-style: normal;
  font-weight: 500;
  line-height: 22px; /* 146.667% */
  cursor:pointer;
  transition: all ease 0.3;
}
.defi-menu-item-active {
  display: flex;
  height: 23px;
  padding: 0 15px;
  justify-content: center;
  align-items: center;
  gap: 15px;
  border-radius: 15px;
  border: 1px solid var(--Primary-Default, #FFDD94);
  background: var(--Other-BG, #1E1E20);
  color: var(--Primary-Default, #FFDD94);
  text-align: center;
  font-family: Poppins;
  font-size: 15px;
  font-style: normal;
  font-weight: 500;
  line-height: 22px; /* 146.667% */
  cursor:pointer;
  transition: all ease 0.3;
}
.defi-menu-item:hover {
  display: flex;
  height: 23px;
  padding: 0 15px;
  justify-content: center;
  align-items: center;
  gap: 15px;
  border-radius: 15px;
  border: 1px solid var(--Primary-Default, #FFDD94);
  background: var(--Other-BG, #1E1E20);
  color: var(--Primary-Default, #FFDD94);
  text-align: center;
  font-family: Poppins;
  font-size: 15px;
  font-style: normal;
  font-weight: 500;
  line-height: 22px; /* 146.667% */
  cursor:pointer;
  transition: all ease 0.3;
}
.defi-content {
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 30px 45px;
}
.defi-card {
  display: flex;
  width: 225px;
  height: 234.052px;
  padding: 26px 32px;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.30);
  background: var(--High-Fidelity-Color-Card-Background, rgba(255, 255, 255, 0.02));
  box-shadow: 0 4px 200px 0 rgba(0, 0, 0, 0.25);
}
.defi-card-img{
  width:100px;
  height:100px;
}
.defi-card-text{
    color: var(--Font-Color-Light-Title, #ECF1F0);
    font-family: Raleway;
    font-size: 24px;
    font-style: normal;
    font-weight: 600;
    line-height: normal;
    padding: 12px 0 0;
    border-top: 1px solid rgba(255,255,255,0.2);
    width:100%;
    text-align: center;
}
.faq {
  margin-top:90px;
  z-index:1;
  width:100%;
  max-width:1300px;
}

.faq-head{
    padding-bottom:50px;
}
.faq-head span{
  color: #FFF;

  /* Medium/Type@40 */
  font-family: Inter;
  font-size: 40px;
  font-style: normal;
  font-weight: 500;
  line-height: 150%; /* 60px */
  letter-spacing: -1.2px;
}
.faq-content {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 24px;
  align-self: stretch;
}
.faq-item {
  display: flex;
  padding: 32px;
  justify-content: space-between;
  align-items: flex-start;
  align-self: stretch;
  border-radius: 16px;
  border: 1px solid var(--Secondary-600, #2C2C30);
  background: var(--Secondary-700, #161618);
  flex-direction: column;
}
.faq-item-q {
  width:100%;
}
.faq-item-btn {
  display: flex;
  width: 48px;
  height: 48px;
  justify-content: center;
  align-items: center;
  gap: 6px;
  border-radius: 46px;
  border: 1px solid var(--Secondary-500, #44444A);
  background: var(--Secondary-700, #161618);
  box-shadow: 0 7.4px 18.5px 0 rgba(255, 255, 255, 0.11) inset;
  transition: transform ease 0.3;
}
.btn-close {
  transform:rotate(180deg);
  transition: transform ease 0.3;
}
.faq-item-q-text {
  color: #FFF;
  /* Medium/Type@24 */
  font-family: Inter;
  font-size: 24px;
  font-style: normal;
  font-weight: 500;
  line-height: 150%; /* 36px */
  letter-spacing: 0.48px;
}
.faq-item-a-text {
  padding-top:12px;
  color: var(--Secondary-300, #ACB5BB);

  /* Medium/Type@16 */
  font-family: Inter;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: 150%; /* 24px */
  letter-spacing: -0.32px;
  max-width:1143px;
}
.faq-item-a-text-1 {
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 18px;
  font-style: normal;
  font-weight: 600;
  line-height: 150%;
  letter-spacing: -0.36px;
}
.faq-item-a-text-2 {
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 18px;
  font-style: italic;
  font-weight: 500;
  line-height: 150%;
  letter-spacing: -0.36px;
}
.foot {
  width:100%;
  margin-top:135px;
  padding-top:65px;
  padding-bottom: 20px;
  background:url("@/assets/img/homefootbg.svg");
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}
.foot-text1{
  text-align: center;
  font-family: Rhythm;
  font-size: 64px;
  font-style: normal;
  font-weight: 400;
  line-height: 120%; /* 76.8px */
  letter-spacing: -1.92px;
  background: var(--gold, linear-gradient(90deg, #C49A4C 30.29%, #F6D77B 69.23%, #B1822A 100%));
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.foot-text2{
  color: var(--Secondary-200, #DCE4E8);
  text-align: center;

  /* Medium/Type@16 */
  font-family: Inter;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: 150%; /* 24px */
  letter-spacing: -0.32px;
  width:760px;
}
.foot-social{
  margin: 68px 0 64px;
  display: flex;
}
.foot-social img {
  width: 48px;
  height: 48px;
  margin: 0 25px;
}
.foot-text3{
  color: var(--Secondary-300, #ACB5BB);
  /* Medium/Type@16 */
  font-family: Inter;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: 150%; /* 24px */
  letter-spacing: -0.32px;
}

/* = = = = = = = = = = Mobile Adaptation (< 768px) = = = = = = = = = = = */
@media (max-width: 768px) {
  .home {
    padding-top: 60px;
  }

  .container {
    max-width: 100%;
    padding: 0 16px;
  }
  @keyframes preciseMove {
    0% { transform: translate(-50%,0); }
    2.78% { transform: translate(-50%,-36px); }
    
    /* 2nd move: -60px → -120px */
    16.667% { transform: translate(-50%,-36px); }
    19.447% { transform: translate(-50%,-72px); }
    
    /* 3rd move: -120px → -180px */
    33.333% { transform: translate(-50%,-72px); }
    36.113% { transform: translate(-50%,-108px); }
    
    /* Stay in */
    50% { transform: translate(-50%,-108px); }
    
    /* Reverse Move Stage */
    /* 4th move: -180px → -120px */
    52.78% { transform: translate(-50%,-72px); }
    66.667% { transform: translate(-50%,-72px); }
    
    /* 5th move: -120px → -60px */
    69.447% { transform: translate(-50%,-36px); }
    83.333% { transform: translate(-50%,-36px); }
    
    /* 6th move: -60px → 0 */
    86.113% { transform: translate(-50%,0); }
    
    /* Final stay */
    100% { transform: translate(-50%,0); }
  }
  .fisrt-page-am {
    position:relative;
    height:36px;
    overflow: hidden;
    margin-bottom:8px;
  }
  .fisrt-page-am span {
    position: absolute;
    left:50%;
    animation: preciseMove 25s linear infinite;
  }
  /* Hero section */
  .first-page {
    height: auto;
    padding-top: 80px;
    flex-direction: column;
    text-align: center;
  }

  .first-page .container {
    flex-direction: column-reverse;
    align-items: center;
  }

  .first-page-bg-1,
  .firstpage-bg {
    display: none;
  }

  .float-swing {
    width: 100%;
    height: auto;
    padding: 20px;
    margin-bottom: 24px;
  }

  .float-swing img {
    margin:auto;
    width: 200px;
    height: 200px;
  }

  .fisrt-page-head {
    font-size: 24px;
  }

  .fisrt-page-head-desc {
    width: 100%;
    font-size: 14px;
    text-align: center;
  }

  .wealth {
    font-size: 48px;
    letter-spacing: -1.44px;
  }

  /* APY cards - 2 columns */
  .apy {
    width: 100%;
    height: auto;
    margin-top: 60px;
  }

  .apy-head span {
    font-size: 24px;
  }

  /* Shrink APY card logos */
  .apy-card .w-32 {
    width: 64px;
    height: 64px;
  }

  .apy-card img.w-30 {
    width: 48px;
    height: 48px;
  }

  .apy-card-wrapper {
    width: calc(50% - 8px);
    height: 280px;
  }

  .card-bg-logo {
    width: 100px;
    height: 100px;
  }
  .card-bg-logo-1 {
    width: 90px;
    height: 90px;
  }
  .card-bg-logo-2 {
    width: 80px;
    height: 80px;
  }

  .apy-card {
    width: 100%;
    height: 100%;
    padding: 16px 0 12px;
  }
  .apy-card-wrapper.bg-usdt {
    background: url('../assets/img/usdtbg.png');
    background-size: cover;
  }
  .apy-card-wrapper.bg-usdc {
    background: url('../assets/img/usdcbg.png') no-repeat;
    background-size: cover;
  }

  .apy-card-wrapper:nth-child(1),
  .apy-card-wrapper:nth-child(2),
  .apy-card-wrapper:nth-child(3),
  .apy-card-wrapper:nth-child(4),
  .apy-card-wrapper:nth-child(5),
  .apy-card-wrapper:nth-child(6) {
    margin-bottom: 16px;
  }

  .card-symbol {
    font-size: 16px;
  }

  .card-apy {
    margin-top: 14px;
    font-size: 14px;
  }

  .card-tvl {
    font-size: 10px;
  }

  .earn-btn {
    font-size: 14px;
    padding: 4px 16px;
  }

  /* DeFi section */
  .defi {
    width: 100%;
    margin-top: 60px;
  }

  .defi-head {
    flex-direction: column;
    gap: 16px;
    padding-bottom: 24px;
  }

  .defi-head span {
    font-size: 24px;
  }

  .defi-menu {
    width: 100%;
    height: auto;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  }

  .defi-menu-item,
  .defi-menu-item-active {
    height: 28px;
    font-size: 12px;
    padding: 0 10px;
  }
  .defi-menu-item:hover {
    height: 28px;
    font-size: 12px;
    padding: 0 10px;
  }

  /* DeFi cards - 2 columns */
  .defi-content {
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }

  .defi-card {
    width: 100%;
    height: auto;
    min-height: 160px;
    padding: 16px;
  }

  .defi-card-img {
    width: 60px;
    height: 60px;
  }

  .defi-card-text {
    font-size: 16px;
    padding-top: 8px;
  }

  /* FAQ */
  .faq {
    width: 100%;
    margin-top: 40px;
  }

  .faq-head span {
    font-size: 24px;
  }

  .faq-item {
    padding: 16px;
  }

  .faq-item-q-text {
    font-size: 16px;
  }

  .faq-item-btn {
    width: 36px;
    height: 36px;
  }

  .faq-item-a-text {
    font-size: 14px;
  }

  /* Footer */
  .foot {
    margin-top: 60px;
    padding-top: 40px;
  }

  .foot-text1 {
    font-size: 32px;
  }

  .foot-text2 {
    width: 100%;
    font-size: 14px;
  }

  .foot-social {
    margin: 40px 0 32px;
  }

  .foot-social img {
    width: 36px;
    height: 36px;
    margin: 0 12px;
  }
}

/* = = = = = = = = = = Medium screen (768px-1151px) = = = = = = = = = = = */
@media (min-width: 768px) and (max-width: 1151px) {
  .container {
    max-width: 100%;
    padding: 0 24px;
  }

  .first-page {
    height: auto;
    padding-top: 100px;
  }
  .float-swing {
    width: 350px;
    height: auto;
    padding: 40px;
  }

  .float-swing img {
    width: 270px;
    height: 270px;
  }

  .fisrt-page-head {
    font-size: 40px;
  }

  .wealth {
    font-size: 72px;
  }

  .fisrt-page-head-desc {
    width: 400px;
  }

  /* APY - 4 columns, shrunk */
  .apy {
    width: 100%;
    height: auto;
  }

  .apy-card-wrapper {
    width: calc(25% - 12px);
    height: 300px;
  }

  /* Card fills its fluid wrapper (no fixed 289px overflow / clipping) */
  .apy-card {
    width: 100%;
    height: 100%;
  }
  .card-apy {
    margin-top: 14px;
    font-size: 14px;
  }

  /* DeFi - 3 columns */
  .defi {
    width: 100%;
  }

  .defi-content {
    grid-template-columns: repeat(3, 1fr);
    gap: 24px;
  }

  .defi-card {
    width: 100%;
    min-height: 200px;
  }

  .faq {
    width: 100%;
  }

  .foot-text2 {
    width: 90%;
  }
}

/* = = = = = = = = = = Narrow desktop (1152px-1299px) = = = = = = = = = = = */
@media (min-width: 1152px) and (max-width: 1299px) {
  .first-page {
    height: auto;
    padding-top: 108px;
  }

  .float-swing {
    width: 470px;
    height: auto;
    padding: 46px;
  }

  .float-swing img {
    width: 360px;
    height: 360px;
  }

  .fisrt-page-head {
    font-size: 36px;
  }

  .wealth {
    font-size: 84px;
  }

  .fisrt-page-head-desc {
    width: 480px;
  }

  /* APY - 4 fluid columns, card grows toward the 289px desktop size */
  .apy {
    height: auto;
  }

  .apy-card-wrapper {
    width: calc(25% - 12px);
    height: 320px;
  }

  .apy-card {
    width: 100%;
    height: 100%;
  }

  /* DeFi - 4 columns bridging 3 (mid) and 5 (>=1300 desktop) */
  .defi-content {
    grid-template-columns: repeat(4, 1fr);
    gap: 30px 28px;
  }

  .defi-card {
    min-height: 210px;
  }
}
</style>
