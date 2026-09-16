<template>
  <div class="panel">
    <div class="stake-wrapper">
      <div class="row">
        <span>Claim</span>
      </div>
      <div class="input-wrapper">
        <InputBox modelValue="0"/>
        <button :class="address ? 'max active':'max'">Max</button>
        <div class="token-wrapper">
          <img src="@/assets/logos/eth.svg"/>
          <span>ETH</span>
        </div>
      </div>
    </div>

    <PrimaryBtn v-if="address">Claim</PrimaryBtn>
    <PrimaryBtn v-else @click="walletStore.openConnect()">Connect Wallet</PrimaryBtn>

    <div class="info">
      <div><span>APY</span><span>2.60%</span></div>
      <div><span>TVL</span><span>3.71B</span></div>
      <div><span>Max trans cost</span><span>{{ txCost }}</span></div>
      <div><span>Reward fee</span><span>10%</span></div>
    </div>
  </div>
  <div class="banner">
    <div class="banner-title">One place. Best yields. Full control.</div>
    <div class="banner-desc">Compare and earn across top DeFi protocols.</div>
    <img class="banner-bg-1" src="@/assets/img/stableopbg.png" />
    <img class="banner-bg-2" src="@/assets/img/stableopbg1.png" />
  </div>
</template>

<script setup>
import InputBox from './InputBox.vue'
import PrimaryBtn from './PrimaryBtn.vue'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { useTxCost, GAS } from '@/chain/core/gas'

const walletStore = useWalletStore()
const { address, isConnected } = storeToRefs(walletStore)
const { txCost } = useTxCost(GAS.claim)
</script>

<style scoped>
.panel{
    width:100%;
    margin:0 auto;
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
.title{font-size:24px;font-weight:700;margin-bottom:20px}
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
</style>