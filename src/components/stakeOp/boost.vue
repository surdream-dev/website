<template>
  <div class="panel">
    <div class="head">
      <h2>Lido GGV</h2>
      <p class="curated"><span>Curated by</span><img src="@/assets/logos/boost.svg" /><span>Inhra provldar</span><img src="@/assets/logos/boost.svg" /></p>
    </div>

    <div class="tvl-apy">
      <div>TVL<span>$144.7M</span></div>
      <div>APY<span>35.3%</span></div>
    </div>

    <p class="desc">
Lido GGV (Golden Goose Vault) utilizes tried and tested strategies with premier DeFi protocols for increased rewards on deposits of ETH or (w)stETH.
    </p>

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
    <div v-if="tab === 'Deposit'" class="amount-wrapper">
      <div class="row">
        <span>Available to deposit</span>
      </div>
      <div class="input-wrapper">
        <InputBox modelValue="0" />
        <button :class="address ? 'max active':'max'">Max</button>
        <div class="token-wrapper">
          <img src="@/assets/logos/eth.svg"/>
          <span>ETH</span>
        </div>
      </div>
    </div>
    <div v-if="tab === 'Withdraw'" class="amount-wrapper">
      <div class="row">
        <span>Available to withdraw</span>
      </div>
      <div class="input-wrapper">
        <InputBox modelValue="0" />
        <button :class="address ? 'max active':'max'">Max</button>
        <div class="token-wrapper">
          <img src="@/assets/logos/eth.svg"/>
          <span>ETH</span>
        </div>
      </div>
    </div>
    <div v-if="tab === 'Deposit'"class="more">
      <div class="title">You will receive</div>
      <div class="amount">0.2GG <img src="@/assets/logos/gg.svg"/></div>
    </div>
    <div v-else class="more">
      <div class="title">You will receive</div>
      <div class="amount">0.2ETH <img src="@/assets/logos/eth.svg"/></div>
    </div>

    <p class="tip">
      Deposited funds cannot be withdrawn, and GG token is non-transferable for 24 hours after deposit.Withdrawals are only in wstETH, regardless of deposited asset(s).
    </p>

    <PrimaryBtn v-if="address">{{tab}}</PrimaryBtn>
    <PrimaryBtn v-else @click="walletStore.openConnect()">Connect Wallet</PrimaryBtn>

    <div class="links">
      <span>Vault details</span>
      <a href="#">Vew on Etherscan</a>
    </div>
    <div class="info">
      <div><span>Vault created</span><span>22/May2025</span></div>
      <div><span>Deposit period</span><span>Immediately (with 24h lock on withdrawals)</span></div>
      <div><span>Withdraw period</span><span>~3 days</span></div>
      <div><span>Performance fee</span><span>10%</span></div>
      <div><span>Platform fee</span><span>1%</span></div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import InputBox from './InputBox.vue'
import PrimaryBtn from './PrimaryBtn.vue'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'

const walletStore = useWalletStore()
const { address, isConnected } = storeToRefs(walletStore)
const tabs = ['Deposit', 'Withdraw']
const tab = ref('Deposit')
</script>

<style scoped>
.panel{
    width:100%;
    margin:0 auto;
}.head{
  margin-bottom:12px;
  padding: 10px 0;  
}
.head h2{
  color: var(--Primary-Default, #FFDD94);
  font-family: Inter;
  font-size: 22px;
  font-style: normal;
  font-weight: 700;
  line-height: 150%; /* 33px */
  letter-spacing: -0.44px;
}
.head p {
  display:flex;
  align-items:center;
  gap:5px;
  margin-top:6px;
}
.head p img {
  margin-left:
}
.curated{
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 9px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 13.5px */
  letter-spacing: -0.18px;
}
.curated span{
  display:flex;
  align-items:center;
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 9px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 13.5px */
  letter-spacing: -0.18px;
}
.tvl-apy{
  display:flex;
  gap:22px;
  margin-bottom:5px;
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 15px;
  font-style: normal;
  font-weight: 500;
  line-height: 150%; /* 22.5px */
  letter-spacing: -0.3px;
}
.tvl-apy span{
  margin-left:5px;
  color: var(--Primary-Default, #FFDD94);
  font-family: Inter;
  font-size: 15px;
  font-style: normal;
  font-weight: 800;
  line-height: 150%;
  letter-spacing: -0.3px;
}
.desc{
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 9px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 13.5px */
  letter-spacing: -0.18px;
}
.tabs{
  margin:20px auto;
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
.amount-wrapper {
  width:100%;
  display: flex;
  height: 75px;
  padding: 4.626px 10px;
  flex-direction: column;
  justify-content: center;
  align-items: flex-end;
  flex-shrink: 0;
  align-self: stretch;
  margin-bottom:0px;
  border-radius: 4.626px;
  border: 0.771px solid var(--Secondary-600, #2C2C30);
  background: var(--Secondary-700, #161618);
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
.tip{
  color: var(--Secondary-300, #ACB5BB);
  font-family: Inter;
  font-size: 9px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 13.5px */
  letter-spacing: -0.18px;
  margin:2.5px 0 23px;
  line-height:1.5;
}
.info{
  display: flex;
  margin-top:2.7px;
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
.links{
  margin-top:20px;
  display:flex;
  justify-content: space-between;
  color: var(--Secondary-100, #EDF1F3);
  font-family: Inter;
  font-size: 10px;
  font-style: normal;
  font-weight: 600;
  line-height: 150%; /* 15px */
  letter-spacing: -0.2px;
}
.links a{
  color: var(--Information-500, #4D81E7);
  text-align: right;
  font-family: Inter;
  font-size: 10px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 15px */
  letter-spacing: -0.2px;
  text-decoration-line: underline;
  text-decoration-style: solid;
  text-decoration-skip-ink: none;
  text-decoration-thickness: auto;
  text-underline-offset: auto;
  text-underline-position: from-font;
}
</style>