// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'

// Import components
import Home from '../views/Home.vue'
import RWA from '../views/RWA.vue'
import Stake from '../views/Stake/index.vue'
import Portfolio from '../views/Portfolio/index.vue'
import Stablecoins from '../views/Stablecoin/index.vue'
import Lending from '../views/Lending/index.vue'

// Define routes
const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home
  },
  {
    path: '/rwa',
    name: 'RWA',
    component: RWA
  },
  {
    path: '/stake',
    name: 'Stake',
    component: Stake
  },
  {
    path: '/portfolio',
    name: 'Portfolio',
    component: Portfolio
  },
  {
    path: '/stablecoins',
    name: 'Stablecoins',
    component:Stablecoins
  },
  {
    path: '/lending',
    name: 'Lending',
    component:Lending
  },
]

// Create the router instance
const router = createRouter({
  // Use HTML5 history mode
  history: createWebHistory(),
  routes,
  scrollBehavior(to) {
    if (to.hash) {
      const el = document.querySelector(to.hash)
      if (el) {
        return {
          top: el.offsetTop + 780, // Leave room for the header height
          left: 0,
          behavior: 'smooth'
        }
      }
    }
    return { top: 0, left: 0 }
  }
  // scrollBehavior(to) {
  //   if (to.hash) {
  //     const el = document.querySelector(to.hash) as HTMLElement
  //     if (el) {
  //       const top =
  //         el.getBoundingClientRect().top + window.pageYOffset - 40
  
  //       return {
  //         top,
  // left: 0 // 🔒 lock horizontal
  //       }
  //     }
  //   }
  //   return { top: 0, left: 0 }
  // }
})

export default router
