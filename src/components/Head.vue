<template>
<div class="bg-black text-gray-100 font-sans app-head container grid grid-cols-1 items-center">
    <header class="flex items-center justify-between px-8 py-8 app-head-wrapper">
      <div class="flex items-center start" @click="goToUser('Home')">
        <img src="../assets/logo.svg" alt="logo" class="logo-img" />
        <h1 class="text-2xl title">SurDream</h1>
      </div>

      <!-- Desktop Navigation Bar -->
      <nav class="menu desktop-menu">
        <a :class="route.name?.indexOf('Home') > -1 ? 'menu-item-active':'menu-item'" @click="goToUser('Home')">Home</a>
        <a :class="route.name?.indexOf('Stake') > -1 ? 'menu-item-active':'menu-item'" @click="goToUser('Stake')" >Staking</a>
        <a :class="route.name?.indexOf('Stablecoins') > -1 ? 'menu-item-active':'menu-item'" @click="goToUser('Stablecoins')">Stablecoins</a>
        <a :class="route.name?.indexOf('Lending') > -1 ? 'menu-item-active':'menu-item'" @click="goToUser('Lending')">Lending</a>
        <a :class="route.name?.indexOf('RWA') > -1 ? 'menu-item-active':'menu-item'" @click="goToUser('RWA')">RWA</a>
        <a :class="route.name?.indexOf('Portfolio') > -1 ? 'menu-item-active':'menu-item'" @click="goToUser('Portfolio')">Portfolio</a>
      </nav>

      <!-- Desktop Wallet Button -->
      <div class="wallet-btn desktop-wallet">
        <button class="end" @click="handleOpenAppKit()">          <span v-if="!isConnected">Connect Wallet</span>
          <span v-else>{{address?.substr(0,4)}}...{{address?.slice(-6)}}</span>
        </button>
      </div>

      <!-- Mobile Hamburger Button -->
      <button class="hamburger-btn" @click="mobileMenuOpen = !mobileMenuOpen">
        <span class="hamburger-line" :class="{ 'open': mobileMenuOpen }"></span>
        <span class="hamburger-line" :class="{ 'open': mobileMenuOpen }"></span>
        <span class="hamburger-line" :class="{ 'open': mobileMenuOpen }"></span>
      </button>
    </header>

    <!-- Mobile Menu Overlay -->
    <Transition name="slide">
      <div v-if="mobileMenuOpen" class="mobile-menu-overlay" @click.self="mobileMenuOpen = false">
        <nav class="mobile-menu">
          <a :class="route.name?.indexOf('Home') > -1 ? 'mobile-menu-item-active':'mobile-menu-item'" @click="goToUser('Home'); mobileMenuOpen = false">Home</a>
          <a :class="route.name?.indexOf('Stake') > -1 ? 'mobile-menu-item-active':'mobile-menu-item'" @click="goToUser('Stake'); mobileMenuOpen = false">Staking</a>
          <a :class="route.name?.indexOf('Stablecoins') > -1 ? 'mobile-menu-item-active':'mobile-menu-item'" @click="goToUser('Stablecoins'); mobileMenuOpen = false">Stablecoins</a>
          <a :class="route.name?.indexOf('Lending') > -1 ? 'mobile-menu-item-active':'mobile-menu-item'" @click="goToUser('Lending'); mobileMenuOpen = false">Lending</a>
          <a :class="route.name?.indexOf('RWA') > -1 ? 'mobile-menu-item-active':'mobile-menu-item'" @click="goToUser('RWA'); mobileMenuOpen = false">RWA</a>
          <a :class="route.name?.indexOf('Portfolio') > -1 ? 'mobile-menu-item-active':'mobile-menu-item'" @click="goToUser('Portfolio'); mobileMenuOpen = false">Portfolio</a>
          <div class="mobile-wallet-btn">
            <button class="end" @click="handleOpenAppKit(); mobileMenuOpen = false">
              <span v-if="!isConnected">Connect Wallet</span>
              <span v-else>{{address?.substr(0,4)}}...{{address?.slice(-6)}}</span>
            </button>
          </div>
        </nav>
      </div>
    </Transition>

    <div v-if="false" class="disclaim flex items-center justify-between px-8 py-8 app-head-wrapper">
      <div class="part1"></div>
      <div class="part2 flex items-center">
        <img src="@/assets/icons/wait.svg" />
        <span class="disclaim-text">This is a preview environment. Transactions are disabled and no real funds are used.</span>
      </div>
      <div class="part3">
        <img @click="isClose = true" src="@/assets/icons/waitclose.svg" />
      </div>
    </div>
 </div>
</template>
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { useAppKitAuth } from '@/composables/useAppKitAuth'
import { toast } from '@/utils/toast'
import { ethereumRpc } from '@/config/rpc'
const isClose = ref(false)
const mobileMenuOpen = ref(false)
const walletStore = useWalletStore()
const { address, isConnected } = storeToRefs(walletStore)
const { openAppKit, disconnect } = useAppKitAuth()

function handleOpenAppKit() {
  openAppKit()
}

const route = useRoute()
const router = useRouter()
const goToUser = (path) => {
  router.push({
    name: path
  })
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast.show('Copied to clipboard', 'success')
  } catch {
    toast.show('Copy failed', 'error')
  }
}

</script>
<style scoped>
.container { max-width: 1300px; }
.logo-img {
  width:35px;
  height:35px;
  margin-right:12px;
}
.title {
  color: #FFF;
  font-feature-settings: 'liga' off, 'clig' off;
  font-family: Rhythm;
  font-size: 24.714px;
  font-style: normal;
  font-weight: 400;
  line-height: 130%; /* 32.128px */
  letter-spacing: -0.989px;
  padding-top:6px;
}
.app-head {
  width: 100%;
  position: absolute;
  background-color: rgba(0,0,0,0);
  z-index:2;
  left:50%;
  transform:translateX(-50%);
}
.app-head-wrapper {
  width:100%;
  height:41px;
  padding: 15px 0;
  box-sizing: content-box;
}
.start {
  width:142px;
  height: 33px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.menu {
  width:659px;
  height:41px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.menu-item {
  color: var(--Secondary-300, #ACB5BB);
  /* Medium/Type@14 */
  font-family: Inter;
  font-size: 14px;
  font-style: normal;
  font-weight: 500;
  line-height: 150%; /* 21px */
  letter-spacing: -0.28px;
  transition:all ease 0.3;
  cursor:pointer;
}
.menu-item-active,.menu-item:hover {
  color: var(--Secondary-100, #EDF1F3);
  /* Medium/Type@14 */
  font-family: Inter;
  font-size: 14px;
  font-style: normal;
  font-weight: 500;
  line-height: 150%; /* 21px */
  letter-spacing: -0.28px;
  transition:all ease 0.3;
  cursor:pointer;
}
.end {
  display: flex;
  width: 124px;
  height: 38px;
  justify-content: center;
  align-items: center;
  gap: 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: var(--gold, linear-gradient(90deg, #C49A4C 30.29%, #F6D77B 69.23%, #B1822A 100%));
  box-shadow: 0 0 0 3.7px rgba(190, 202, 234, 0.03), 0 7.4px 18.5px 0 rgba(255, 255, 255, 0.11) inset;
  color: var(--Primary-0, #FFF);
  text-align: center;

  /* Semibold/Type@14 */
  font-family: Inter;
  font-size: 14px;
  font-style: normal;
  font-weight: 600;
  line-height: 150%; /* 21px */
  letter-spacing: -0.28px;
}
.wallet-btn {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
}
.disclaim {
  box-sizing:border-box;
  display: flex;
  padding: 8px 16px;
  align-items: center;
  background: linear-gradient(90deg, rgba(196, 154, 76, 0.80) 30.29%, rgba(246, 215, 123, 0.80) 69.23%, rgba(177, 130, 42, 0.80) 100%);
}
.part1 {

}
.part2 {
  gap:12px;
  color: #1E1E20;
  font-family: Inter;
  font-size: 16px;
  font-style: normal;
  font-weight: 600;
  line-height: 20px; /* 125% */
  letter-spacing: -0.25px;
}
.part2 img {
  width:16px;
  height:16px;
}
.part3 {
  cursor: pointer;
  justify-content:flex-end;
}

/* = = = = = = = = = = Mobile Burger Button = = = = = = = = = = */
.hamburger-btn {
  display: none;
  width: 32px;
  height: 32px;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
}
.hamburger-line {
  width: 24px;
  height: 2px;
  background: #fff;
  border-radius: 2px;
  transition: all 0.3s ease;
}
.hamburger-line.open:nth-child(1) {
  transform: rotate(45deg) translate(5px, 5px);
}
.hamburger-line.open:nth-child(2) {
  opacity: 0;
}
.hamburger-line.open:nth-child(3) {
  transform: rotate(-45deg) translate(5px, -5px);
}

/* = = = = = = = = = = Mobile Menu Overlay = = = = = = = = = = */
.mobile-menu-overlay {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  z-index: 100;
}
.mobile-menu {
  position: fixed;
  top: 0;
  right: 0;
  width: 280px;
  height: 100%;
  background: #1E1E20;
  padding: 80px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.5);
}
.mobile-menu-item {
  color: #ACB5BB;
  font-family: Inter;
  font-size: 18px;
  font-style: normal;
  font-weight: 500;
  line-height: 150%;
  letter-spacing: -0.36px;
  padding: 12px 0;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.mobile-menu-item-active {
  color: #EDF1F3;
  font-family: Inter;
  font-size: 18px;
  font-style: normal;
  font-weight: 600;
  line-height: 150%;
  letter-spacing: -0.36px;
  padding: 12px 0;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}
.mobile-wallet-btn {
  margin-top: 24px;
}
.mobile-wallet-btn .end {
  width: 100%;
  height: 48px;
  font-size: 16px;
}

/* Slide In Animation */
.slide-enter-active,
.slide-leave-active {
  transition: opacity 0.3s ease;
}
.slide-enter-active .mobile-menu,
.slide-leave-active .mobile-menu {
  transition: transform 0.3s ease;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
}
.slide-enter-from .mobile-menu,
.slide-leave-to .mobile-menu {
  transform: translateX(100%);
}

/* = = = = = = = = = = Mobile Adaptation (< 768px) = = = = = = = = = = = */
@media (max-width: 768px) {
  .container {
    max-width: 100%;
    padding: 0 16px;
  }

  .app-head {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    transform: none;
    background-color: rgba(0, 0, 0, 0.95);
    padding: 0 16px;
    z-index:60;
  }

  .app-head-wrapper {
    padding: 12px 0;
    height: auto;
    box-sizing: border-box;
  }

  .start {
    width: auto;
  }

  /* Hide desktop navigation and wallet */
  .desktop-menu,
  .desktop-wallet {
    display: none !important;
  }

  /* Show Hamburger Button */
  .hamburger-btn {
    display: flex;
  }

  /* Show mobile menu overlay */
  .mobile-menu-overlay {
    display: block;
  }

  /* Warning Bar Fit */
  .disclaim {
    flex-wrap: wrap;
    padding: 12px 16px;
    gap: 8px;
  }

  .part1 {
    display: none;
  }

  .disclaim-text {
    font-size: 12px;
    line-height: 16px;
  }

  .part3 {
    flex-shrink: 0;
  }
}

/* = = = = = = = = = = Medium screen (768px-1024px) = = = = = = = = = = = */
@media (min-width: 768px) and (max-width: 1024px) {
  .container {
    max-width: 100%;
    padding: 0 24px;
  }

  .menu {
    width: auto;
    gap: 16px;
  }

  .wallet-btn .end {
    width: 100px;
    font-size: 12px;
  }
}

</style>
