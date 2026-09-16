<template>
  <div class="panel">
    <div class="tabs">
      <button
        v-for="t in tabs"
        :key="t"
        :class="['tab', { active: tab === t }]"
        @click="tab = t"
      >
        {{ t }}
      </button>
    </div>
    <div v-if="tab === 'Wrap'" class="receive-wrapper">
      <div class="row">
      <span>Available to wrap</span>
      </div>
      <div class="input-wrapper">
        <InputBox modelValue="0" :readonly="true" />
        <button class="max">Max</button>
        <div class="token-wrapper" @click="open = !open">
          <img :src="getIcon(selected)"/>
          <span>{{selected}}</span>
          <img class="icon" src="@/assets/icons/arrow_down.svg"/>
          <Transition name="drop">
            <ul v-if="open" class="list">
              <li
                v-for="item in list"
                :key="item"
                @click.stop="choose(item)"
                :class="{ active: item === selected }"
              >
                <img :src="getIcon(item)" class="icon" />
                <span>{{ item }}</span>
              </li>
            </ul>
          </Transition>
        </div>
      </div>
    </div>
    <div v-if="tab === 'Unwrap'" class="receive-wrapper">
      <div class="row">
      <span>Available to unwrap</span>
      </div>
      <div class="input-wrapper">
        <InputBox modelValue="0" :readonly="true" />
        <button class="max">Max</button>
        <div class="token-wrapper">
          <img src="@/assets/logos/lido.svg"/>
          <span>stETH</span>
        </div>
      </div>
    </div>
    <div class="more">
      <div class="title">You will receive</div>
      <div class="amount">0.2{{selected}} <img :src="getIcon(selected)"/></div>
    </div>

    <PrimaryBtn v-if="address">Wrap</PrimaryBtn>
    <PrimaryBtn v-else @click="walletStore.openConnect()">Connect Wallet</PrimaryBtn>

    <div class="info">
      <div><span>Max unlock cost</span><span>$0.04</span></div>
      <div><span>Max transaction cost</span><span>$0.10</span></div>
      <div><span>Exchange rate</span><span>1 stETH = 0.8209 WstETH</span></div>
      <div><span>Allowance</span><span>0.01</span></div>
    </div>
    <div class="banner">
      <div class="banner-title">One place. Best yields. Full control.</div>
      <div class="banner-desc">Compare and earn across top DeFi protocols.</div>
      <img class="banner-bg-1" src="@/assets/img/stableopbg.png" />
      <img class="banner-bg-2" src="@/assets/img/stableopbg1.png" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref,onMounted,onUnmounted } from 'vue'
import InputBox from './InputBox.vue'
import PrimaryBtn from './PrimaryBtn.vue'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'

const walletStore = useWalletStore()
const { address, isConnected } = storeToRefs(walletStore)
const tabs = ['Wrap', 'Unwrap']
const tab = ref('Wrap')

// Bulk import using Vite's import.meta.glob
const icons = import.meta.glob('@/assets/logos/*.svg', { 
  eager: true,
  import: 'default' 
})

// Extract symbol from path
const getIcon = (symbol: string) => {
  if(symbol){
    const key = `@/assets/logos/${symbol.toLowerCase()}.svg`
    for (const [path, icon] of Object.entries(icons)) {
      if (path.includes(symbol.toLowerCase())) {
        return icon as string
      }
    }
  }
  return ''
}

const selected = ref('stETH')
const list = ['stETH', 'ETH']
const open = ref(false)
/* Select & close */
const choose = (item:string) => {
  open.value = false
  selected.value = item
}

</script>

<style scoped>
.panel{
    width:100%;
    margin:0 auto;
}
.tabs{
  margin:4px auto 12px;
  display: flex;
  width: 315px;
  height: 29px;
  justify-content: center;
  align-items: center;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: var(--Fill-Colors-Light-Tertiary, rgba(118, 118, 128, 0.12));
}
.tabs .tab {
  width:50%;
  color: var(--Secondary-400, #6C7278);
  text-align: center;
  font-feature-settings: 'liga' off, 'clig' off;
  font-family: Inter;
  font-size: 10.8px;
  font-style: normal;
  font-weight: 600;
  line-height: 20px; /* 185.185% */
  letter-spacing: -0.24px;
}
.tabs .tab.active {
  color: var(--Primary-Default, #FFDD94);
  text-align: center;
  font-feature-settings: 'liga' off, 'clig' off;
  font-family: Inter;
  font-size: 10.8px;
  font-style: normal;
  font-weight: 600;
  line-height: 20px; /* 185.185% */
  letter-spacing: -0.24px;
  border-radius: 6px;
  border: 1px solid var(--Primary-Default, #FFDD94);
}
.stake-wrapper {
  width:100%;
  display: flex;
  height: 75px;
  padding: 4.626px 10px;
  flex-direction: column;
  justify-content: center;
  align-items: flex-end;
  flex-shrink: 0;
  align-self: stretch;
  margin-bottom:10px;
  border-radius: 4.626px;
  border: 0.771px solid var(--Secondary-600, #2C2C30);
  background: var(--Secondary-700, #161618);
}
.receive-wrapper {
  width:100%;
  display: flex;
  height: 75px;
  padding: 4.626px 10px;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  flex-shrink: 0;
  align-self: stretch;
  border-radius: 4.626px;
  border: 0.771px solid var(--Secondary-600, #2C2C30);
  background: var(--Other-BG, #1E1E20);
}
.input-wrapper {
  width:100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.token-wrapper {
  position:relative;
  display: flex;
  align-items: center;
  gap: 4.626px;
  border-radius: 3.855px;
  background: var(--Secondary-600, #2C2C30);
  box-shadow: 0 4.626px 7.711px -2.313px rgba(0, 0, 0, 0.25);
}
.token-wrapper img{
  width:15px;
  height:15px;
}
.token-wrapper span{
  color: #FFF;
  font-family: Inter;
  font-size: 10.795px;
  font-style: normal;
  font-weight: 500;
  line-height: 150%; /* 16.193px */
  letter-spacing: -0.216px;
}
.token-wrapper .list {
  position: absolute;
  right: 0;
  bottom: 0;
  transform: translateY(50px);
  width: 100%;
  height: 50px;
  display: flex;
  flex-direction: column;
}
.token-wrapper li {
  display: flex;
  width: 72px;
  padding: 4.555px 13px 4.555px 4.555px;
  align-items: center;
  gap: 4.555px;
  border-radius: 3.796px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  background: #1E1E20;
}
.row{
  margin-top: 5px;
  width:100%;
  display:flex;
  justify-content:space-between;
  align-items:center;
}
.row span{
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 10px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 15px */
  letter-spacing: -0.2px;
}
.max{
  color: var(--Secondary-200, #DCE4E8);
  text-align: center;
  font-family: Inter;
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
  line-height: 150%; /* 16.5px */
  letter-spacing: -0.22px;
  padding-right:7px;
}
.max.active {
  color: var(--Primary-Default, #FFDD94);
  text-align: center;
  font-family: Inter;
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
  line-height: 150%; /* 16.5px */
  letter-spacing: -0.22px;
}
.info{
  display: flex;
  margin-top:20px;
  padding: 7.711px;
  align-items: center;
  flex-direction: column;
  gap: 2px;
  align-self: stretch;
  border-radius: 6.169px;
  background: var(--Secondary-600, #2C2C30);
  box-shadow: 0 4.626px 7.711px -2.313px rgba(0, 0, 0, 0.25);
}
.info div{
  width:100%;
  display:flex;
  justify-content:space-between
  }
.info div span {
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 18px */
  letter-spacing: -0.12px;
}
.more {
  margin-top: 1.5px;
  width:100%;
  display:flex;
  justify-content: space-between;
  align-items:center;
}
.more .title{
  color: var(--Secondary-100, #EDF1F3);
  font-family: Inter;
  font-size: 10px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 15px */
  letter-spacing: -0.2px;
  margin-bottom: 0;
}
.more .amount {
  display:flex;
  align-items: center;
  color: var(--Secondary-100, #EDF1F3);
  text-align: right;
  font-family: Inter;
  font-size: 10px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 15px */
  letter-spacing: -0.2px;
}
.more .amount img {
  width:12px;
  height:12px;
  margin-left:3px;
}
</style>