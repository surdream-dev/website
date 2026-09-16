<!-- Portfolio.vue -->
<template>
  <div class="portfolio page bg-black text-gray-100 font-sans items-center justify-items-center ">
  <div class="container">
    <header class="header">
      <div class="left">
        <h1 class="title">Portfolio</h1>
        <p class="desc">Track your DeFi portfolio – view staking rewards, stablecoin earnings, and lending positions in one place.</p>
      </div>
      <div v-if="isConnected" class="right">
        <p class="total">
          <span>
            <img src="@/assets/icons/totalassets.svg"/>
            <span class="name">Total Assets</span>
          </span>
          <span class="num">{{ totalAssetsFormatted }}</span>
          <!-- <span class="change" :class="{ positive: summary?.totalAssets.change24h > 0 }">
            {{ summary?.totalAssets.change24hFormatted || '+0%' }}
          </span> -->
        </p>
        <div class="line"></div>
        <p class="profit">
          <span>
            <img src="@/assets/icons/totalearning.svg"/>
            <span class="name">Total Earnings</span>
          </span>
          <span class="num">{{ summary?.totalEarnings?.formatted || '$0.00' }}</span>
          <!--  <span class="change" :class="{ positive: summary?.totalEarnings.change7d > 0 }">
            {{ summary?.totalEarnings.change7dFormatted || '+0%' }}
          </span> -->
        </p>
      </div>
    </header>

    <section class="filter-bar">
      <div class="tabs">
        <button
          v-for="t in tabs"
          :key="t"
          :class="{ active: activeTab === t }"
          @click="activeTab = t"
        >
          {{ t }}
        </button>
      </div>
      <div v-if="isConnected" class="search-wrapper">
        <div class="search-box">
          <img class="search" src="@/assets/icons/search.svg" />
          <input v-model="keyword" placeholder="Search" />
          <img class="close" src="@/assets/icons/close-circle.png" @click="keyword = ''"/>
        </div>
        <Dropdown v-model="selectedProtocols" :options="protocols"></Dropdown>
      </div>
    </section>
    <section v-if="!isConnected" class="items-center justify-items-center portfolio-wallet">
      <div class="connect-wallet-btn" @click="walletStore.openConnect()">Connect Wallet</div>
    </section>
    <section v-else class="tables">
      <All v-if="activeTab === 'ALL'" :keyword="keyword" :protocols="selectedProtocols" @openOperation="handleOpenOperation" />
      <Tx v-if="activeTab === 'Transactions'" :keyword="keyword" :protocols="selectedProtocols" />
      <Earn v-if="activeTab === 'Earnings'" :keyword="keyword" :protocols="selectedProtocols" @openOperation="handleOpenOperation" />
      <Staking v-if="activeTab === 'Staking'" :keyword="keyword" :protocols="selectedProtocols" @openOperation="handleOpenOperation" />
      <Stablecoins v-if="activeTab === 'Stablecoins'" :keyword="keyword" :protocols="selectedProtocols" @openOperation="handleOpenOperation" />
      <Lending v-if="activeTab === 'Lending'" :keyword="keyword" />
    </section>
    <FOOT fixed></FOOT>
    </div>
  </div>
  <!-- Staking modal -->
  <LidoStakeModal
    v-model="stakeModalVisible"
    :balance="userEthBalance"
    :selectedItem="selectedItem"
    :availableTabs="stakeModalTabs"
    :initialTab="stakeModalInitialTab"
    @stake="handleStake"
  />
  <!-- Stablecoin modal -->
  <StablecoinsModal
    v-model="stablecoinModalVisible"
    :balance="userEthBalance"
    :selectedItem="selectedItem"
    :availableTabs="stablecoinModalTabs"
    :initialTab="stablecoinModalInitialTab"
    @stake="handleStake"
  />
  <!-- Lending modal -->
  <LendingModal
    v-model="lendingModalVisible"
    :balance="userEthBalance"
    :selectedItem="selectedItem"
    :availableTabs="lendingModalTabs"
    :initialTab="lendingModalInitialTab"
    @stake="handleStake"
  />
</template>

<script setup lang="ts">
import { computed, ref, provide, watch } from 'vue'
import FOOT from '../../components/Foot.vue'
import All from './all.vue'
import Tx from './tx.vue'
import Earn from './earn.vue'
import Staking from './staking.vue'
import Stablecoins from './stablecoins.vue'
import Lending from './lending/index.vue'
import Dropdown from '@/components/ProtocolDropdown.vue'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { usePortfolioSummary } from '@/composables/usePortfolio'
import {
  invalidatePortfolioPositions,
  usePortfolioTotalAssets,
} from '@/composables/usePortfolioChainData'
import { useUserEthBalance } from '@/composables/useBalance'
import LidoStakeModal from '../../components/stakeOp/index.vue'
import StablecoinsModal from '../../components/stablecoinsOp/index.vue'
import LendingModal from '../../components/lendingOp/index.vue'
import { enrichLendingItem } from '@/composables/useLendingItem'
import { stakeProtocols, stablecoinProtocols, getStablecoinPoolId } from '@/constants/protocols'
import { getProtocolIcon } from '@/utils/icons'

const walletStore = useWalletStore()
const { address, isConnected } = storeToRefs(walletStore)

// Use the Portfolio Summary composable
const { summary, loading: summaryLoading, refetch: refetchSummary } = usePortfolioSummary()
const { value: totalAssets } = usePortfolioTotalAssets()

const totalAssetsFormatted = computed(() => {
  const value = totalAssets.value || 0
  const sign = value < 0 ? '-' : ''
  return `${sign}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
})

// Restore the last active tab / keyword on refresh so the page stays on the current
// module (e.g. Lending) instead of falling back to the ALL homepage. Stored in
// sessionStorage: survives a page reload, resets when the browser tab session ends.
const VALID_TABS = ['ALL', 'Staking', 'Stablecoins', 'Lending', 'Earnings', 'Transactions'] as const
const storedTab = sessionStorage.getItem('portfolio_active_tab')
const activeTab = ref<typeof VALID_TABS[number]>(
  (VALID_TABS as readonly string[]).includes(storedTab || '') ? (storedTab as typeof VALID_TABS[number]) : 'ALL'
)
const keyword   = ref(sessionStorage.getItem('portfolio_keyword') || '')
const tabs: Array<typeof activeTab.value> = [...VALID_TABS]

const selectedProtocols = ref<string[]>([])

// Provided to child components (Lending etc.)
provide('selectedProtocols', selectedProtocols)

// All protocol categories
const PROTOCOL_CATEGORIES = {
  lending: [
    { label: 'AAVE', value: 'aave' },
    { label: 'Compound', value: 'compound' },
    { label: 'Morpho', value: 'morpho' },
    { label: 'SparkLend', value: 'sparklend' },
    { label: 'Fluid', value: 'fluid' },
  ],
  // ALL tab's lending uses the protocol level (to keep the dropdown short)
  lendingProtocol: [
    { label: 'AAVE', value: 'aave' },
    { label: 'Compound', value: 'compound' },
    { label: 'Morpho', value: 'morpho' },
    { label: 'SparkLend', value: 'sparklend' },
    { label: 'Fluid', value: 'fluid' },
  ],
  staking: [
    { label: 'Lido', value: 'lido' },
    { label: 'RocketPool', value: 'rocketpool' },
    { label: 'ether.fi', value: 'etherfi' },
    { label: 'StakeWise', value: 'stakewise' },
    { label: 'Stader', value: 'stader' },
    { label: 'mETH', value: 'meth' },
  ],
  stablecoin: [
    { label: 'Ethena', value: 'ethena' },
    { label: 'AAVE', value: 'aave' },
    { label: 'Compound', value: 'compound' },
    { label: 'SparkLend', value: 'sparklend' },
    { label: 'Morpho', value: 'morpho' },
    { label: 'Fluid', value: 'fluid' },
  ],
}

// Show the matching protocol filter options for the current tab
const protocols = computed(() => {
  switch (activeTab.value) {
    case 'Staking':
      return PROTOCOL_CATEGORIES.staking
    case 'Stablecoins':
      return PROTOCOL_CATEGORIES.stablecoin
    case 'Lending':
      return PROTOCOL_CATEGORIES.lending
    case 'ALL':
    case 'Earnings':
    case 'Transactions':
    default: {
      // Merge lending + staking + stablecoin, dedupe by value
      // (the stablecoin category already mixes in aave/compound/sparklend/morpho/fluid; expanding it directly would duplicate lendingProtocol)
      const merged = [
        ...PROTOCOL_CATEGORIES.lendingProtocol,
        ...PROTOCOL_CATEGORIES.staking,
        ...PROTOCOL_CATEGORIES.stablecoin,
      ]
      return [...new Map(merged.map(o => [o.value, o])).values()]
    }
  }
})

// Reset the protocol filter when switching tabs (defaults to none selected;
// an empty selection shows all positions) and persist the active tab so a
// refresh stays on the current module.
watch(activeTab, (tab) => {
  sessionStorage.setItem('portfolio_active_tab', tab)
  selectedProtocols.value = []
}, { immediate: true })

// Persist the search keyword across refresh too.
watch(keyword, (v) => {
  sessionStorage.setItem('portfolio_keyword', v)
})

/* User ETH balance (real on-chain data) */
const userEthBalance = useUserEthBalance()

/* Popup switch + currently selected row data */
const stakeModalVisible = ref(false)
const stablecoinModalVisible = ref(false)
const lendingModalVisible = ref(false)
const selectedItem = ref<any | null>(null)
const stakeModalInitialTab = ref('Stake')
const stablecoinModalInitialTab = ref('Deposit')
const lendingModalInitialTab = ref('Supply')

/* Tabs config for different modals */
const stakeModalTabs = computed(() => {
  const protocolId = selectedItem.value?.protocolId
  if (protocolId === 'rocketpool') return ['Stake', 'Unstake']
  return ['Stake', 'Unstake', 'Withdraw']
})
const stablecoinModalTabs = ref(['Deposit', 'Withdraw'])
const lendingModalTabs = ref(['Supply', 'Withdraw'])

/* Open popup */
function openStake(item: any) {
  selectedItem.value = item
  stakeModalVisible.value = true
}

/** Fill missing staking row fields from config (assetAddress/decimals/receiptToken etc.) so modal balances/actions match all pages */
function enrichStakeRow(row: any) {
  const pid = (row.protocolId || row.protocol || '').toLowerCase()
  const sym = (row.asset || '').toLowerCase()
  const proto = stakeProtocols.find(p => p.protocolId === pid && (p.asset || '').toLowerCase() === sym)
    || stakeProtocols.find(p => p.protocolId === pid)
  if (!proto) return row
  return {
    ...row,
    protocolId: proto.protocolId,
    protocol: proto.name || row.protocol,
    // Icon fallback: backend rows may lack icon; resolve the local logo by protocolId (same as the Stake page)
    icon: getProtocolIcon(proto.protocolId, row.icon),
    asset: proto.asset,
    assetAddress: row.assetAddress || proto.assetAddress,
    decimals: row.decimals || proto.decimals,
    receiptToken: row.receiptToken || proto.contracts?.token || proto.contracts?.staking,
    receiptTokenSymbol: row.receiptTokenSymbol || proto.receiptTokenSymbol || '',
    unstakePeriod: row.unstakePeriod || proto.unstakePeriod,
    contracts: proto.contracts,
    // APY/TVL completion (fixes Plane #0814-02: the Portfolio entry modal showed APY as NaN and TVL as 0)
    // Backend position rows only have apy/apyFormatted; metrics.apy.base is always numeric so the modal computed always gets a real value and never yields NaN
    basicApy: row.apyFormatted || '-',
    tvl: row.tvl || '-',
    metrics: {
      tvl: 0,
      apy: { base: typeof row.apy === 'number' ? row.apy : 0, boost: 0, total: 0 },
    },
  }
}

/** Fill missing stablecoin row fields from config (assetAddress/decimals/receiptToken etc.) */
function enrichStablecoinRow(row: any) {
  const pid = (row.protocolId || row.protocol || '').toLowerCase()
  const sym = (row.asset || '').toLowerCase()
  const proto = stablecoinProtocols.find(p => p.protocolId === pid && (p.asset || '').toLowerCase() === sym)
    || stablecoinProtocols.find(p => p.protocolId === pid)
  if (!proto) return row
  return {
    ...row,
    protocolId: proto.protocolId,
    protocol: proto.name || row.protocol,
    // Pooled protocols carry a per-asset poolId (e.g. morpho-usdc) so withdraw/getSupplyBalance use the vault path
    // (otherwise the All/Earnings entry poolId falls back to 'morpho' and USDC is misclassified as Morpho Blue collateral, returning 0)
    poolId: row.poolId || getStablecoinPoolId(proto.protocolId, proto.asset || ''),
    asset: proto.asset,
    assetAddress: row.assetAddress || proto.assetAddress,
    decimals: row.decimals || proto.decimals,
    receiptToken: row.receiptToken || proto.contracts?.staking || proto.contracts?.token,
    receiptTokenSymbol: row.receiptTokenSymbol || proto.receiptTokenSymbol || '',
    contracts: proto.contracts,
  }
}

/* Handle the openOperation event - open the matching modal by position type */
function handleOpenOperation(row: any) {
  // Fill the fields pooled protocols need (poolId/decimals/risk/loanAsset etc.)
  if (row.category === 'lending-supply') {
    selectedItem.value = enrichLendingItem(row, 'supply')
    lendingModalTabs.value = ['Supply', 'Withdraw']
    lendingModalInitialTab.value = 'Withdraw'
    lendingModalVisible.value = true
  } else if (row.category === 'lending-borrow') {
    selectedItem.value = enrichLendingItem(row, 'borrow')
    lendingModalTabs.value = ['Borrow', 'Repay']
    lendingModalInitialTab.value = 'Repay'
    lendingModalVisible.value = true
  } else if (row.category === 'lending-liquidity') {
    // Vault liquidity positions (Compound/Morpho/Fluid USDC/USDT/ETH): go through the Lending modal,
    // directly landing on Withdraw (liquidity balance lookup/withdrawals now uniformly use the vault path)
    selectedItem.value = enrichLendingItem(row, 'supply')
    lendingModalTabs.value = ['Supply', 'Withdraw']
    lendingModalInitialTab.value = 'Withdraw'
    lendingModalVisible.value = true
  } else {
    if (row.category === 'staking') {
      selectedItem.value = enrichStakeRow(row)
      stakeModalTabs.value = selectedItem.value?.protocolId === 'rocketpool'
        ? ['Stake', 'Unstake']
        : ['Stake', 'Unstake', 'Withdraw']
      stakeModalInitialTab.value = row.type === 'stake' || row.type === 'restake' ? 'Unstake' : 'Withdraw'
      stakeModalVisible.value = true
    } else if (row.category === 'stablecoin') {
      selectedItem.value = enrichStablecoinRow(row)
      stablecoinModalTabs.value = ['Deposit', 'Withdraw']
      const isEthenaClaim = row.type === 'withdraw' &&
        ((row.protocolId || row.protocol || '').toLowerCase() === 'ethena')
      stablecoinModalInitialTab.value = isEthenaClaim ? 'Claim' : 'Withdraw'
      stablecoinModalVisible.value = true
    } else {
      selectedItem.value = row
    }
  }
}

/* Callback after clicking Stake in the modal (refresh data after a successful transaction) */
function handleStake(ev: { amount: string }) {
  // Refresh Portfolio overview data after a successful transaction
  refetchSummary()
  invalidatePortfolioPositions()
}
</script>

<style scoped>
/* Styles identical to before; no further detail */
:root {
  --bg: #f7f8fc;
  --card: #ffffff;
  --title: #f5c16c;
  --primary: #635bff;
  --profit: #16c784;
  --text1: #1a1d29;
  --text2: #6b7280;
  --border: #e5e7eb;
  --shadow: 0 4px 12px rgba(0,0,0,.05);
  --radius: 16px;
  --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.portfolio {
  background-image:url("@/assets/img/stakebg.png") ;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  margin: 0px auto;
  padding: 110px 0px 0;
  font-family: var(--font);
  color: var(--text1);
}
.container {
  max-width: 1300px;
  margin: 0 auto;
}
.header {
  background: var(--card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 0px 0 11px;
  gap:30px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.header .line {
  width: 0.3px;
  height: 128.989px;
  background: #C49A4C;
}
.header .left .title {
  font-feature-settings: 'salt' on, 'liga' off;
  font-family: Raleway;
  font-size: 36px;
  font-style: normal;
  font-weight: 700;
  line-height: 44px; /* 122.222% */
  background: linear-gradient(90deg, #EECF75 0%, #887643 14.98%);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.header .left p {
  margin-top: 10px;
  color: var(--Secondary-300, #ACB5BB);

  /* Regular/Type@20 */
  font-family: Inter;
  font-size: 20px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 30px */
  letter-spacing: -0.4px;
}
.header .right {
  display: flex;
  flex-direction: row;
  width:600px;
  height:150px;
  box-sizing:border-box;
  padding: 8.505px 29.769px;
  align-items: center;
  gap: 36.148px;
  border-radius: 12.009px;
  border: 0.5px solid var(--gold, #C49A4C);
  background: rgba(22, 22, 24, 0.50);
}
.header .right p{
  display: flex;
  width: 233px;
  height: 140px;
  padding: 20px 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 17px;
  flex-shrink: 0;
  border-radius: 5.717px;
}
.header .right p .num{
  color: var(--Primary-0, #FFF);
  font-family: Inter;
  font-size: 38.428px;
  font-style: normal;
  font-weight: 300;
  line-height: 150%; /* 57.642px */
  letter-spacing: 1.269px;
}
.header .right p .name {
  color: var(--Secondary-200, #DCE4E8);
  font-family: Inter;
  font-size: 16.54px;
  font-style: normal;
  font-weight: 500;
  line-height: 150%; /* 24.81px */
  letter-spacing: -0.165px;
}
.header .right p .change {
  color: var(--Secondary-200, #DCE4E8);
  font-family: Inter;
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
}
.header .right p .change.positive {
  color: #16c784;
}
.header .right .total span{
  width: 100%;
  padding-left: 12px;
  display:flex;
  justify-content: space-between;
  align-items: center;
 }
.header .right .profit span {
  width: 100%;
  padding-left: 12px;
  display:flex;
  justify-content: space-between;
  align-items: center;
 }
 .header .right p span img{
  width:18px;
  height:18px;
 }
.header .desc { font-size: 14px; color: var(--text2); line-height: 1.5; margin: 0; }
.filter-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.tabs { display: flex; gap: 8px; }
.tabs button {
  display: flex;
  height: 23px;
  padding: 0 15px;
  justify-content: center;
  align-items: center;
  gap: 15px;
  border-radius: 15px;
  border: 1px solid #343437;
  color: var(--Tab-Color, #9E9E9E);
  text-align: center;
  font-family: Poppins;
  font-size: 12px;
  font-style: normal;
  font-weight: 500;
  line-height: 22px; /* 183.333% */
}
.tabs button.active,
.tabs button:hover {
  border-radius: 15px;
  border: 1px solid var(--Primary-Default, #FFDD94);
  color: var(--Primary-Default, #FFDD94);
  text-align: center;
  font-family: Poppins;
  font-size: 12px;
  font-style: normal;
  font-weight: 500;
  line-height: 22px; /* 183.333% */
}
.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  background:rgba(255,255,255,0);
  padding: 13px 0 10px;
}
.tabs { display: flex; gap: 8px; }
.tabs button {
  display: flex;
  height: 23px;
  padding: 0 15px;
  justify-content: center;
  align-items: center;
  gap: 15px;
  border-radius: 15px;
  border: 1px solid #343437;
  color: var(--Tab-Color, #9E9E9E);
  text-align: center;
  font-family: Poppins;
  font-size: 12px;
  font-style: normal;
  font-weight: 500;
  line-height: 22px; /* 183.333% */
}
.tabs button.active,
.tabs button:hover {
  border-radius: 15px;
  border: 1px solid var(--Primary-Default, #FFDD94);
  color: var(--Primary-Default, #FFDD94);
  text-align: center;
  font-family: Poppins;
  font-size: 12px;
  font-style: normal;
  font-weight: 500;
  line-height: 22px; /* 183.333% */
}
.search-wrapper {
  display: flex;
  gap:14px;
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
  color: #fff;
}
.search-box input::placeholder {
  color: rgba(255,255,255,0.4);
}
.search-box .search,img {
  width:16px;
  height:16px;
}
.search-box .close,img {
  width:24px;
  height:24px;
}

.connect-wallet-btn {
  margin-top:37px;
  color: var(--Primary-Default, #FFDD94);
  text-align: center;
  font-family: Inter;
  font-size: 16px;
  font-style: normal;
  font-weight: 600;
  line-height: 150%; /* 24px */
  letter-spacing: -0.32px;
  display: flex;
  width: 195px;
  height: 52px;
  padding: 15px 28px;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  border-radius: 10px;
  border: 1px solid var(--Primary-Default, #FFDD94);
}

/* = = = = = = = = = = Mobile Adaptation (< 768px) = = = = = = = = = = = */
@media (max-width: 768px) {
  .portfolio {
    /* Bottom 80px reserved for the mobile fixed footer */
    padding: 80px 0 80px;
    background-image: none;
    min-height: auto;
  }

  .container {
    max-width: 100%;
    padding: 0 16px;
  }

  /* Header stacked vertically */
  .header {
    flex-direction: column;
    gap: 16px;
    padding: 16px;
    background: transparent;
    box-shadow: none;
    border-radius: 0;
  }

  .header .left .title {
    font-size: 24px;
    line-height: 32px;
  }

  .header .left p {
    font-size: 14px;
    line-height: 20px;
  }

  .header .right {
    width: 100%;
    height: auto;
    flex-direction: row;
    align-items: stretch;
    gap: 10px;
    padding: 14px 10px;
    border-radius: 12px;
  }

  .header .right p {
    width: auto;
    flex: 1 1 0;
    min-width: 0;
    height: auto;
    padding: 8px 2px;
    gap: 8px;
  }

  .header .right .total span,
  .header .right .profit span {
    padding-left: 0;
    justify-content: flex-start;
    gap: 6px;
  }

  .header .right p .num {
    font-size: 18px;
    line-height: 24px;
    letter-spacing: 0;
    word-break: break-word;
  }

  .header .right p .name {
    font-size: 12px;
  }

  /* Same gold divider in the middle: becomes a vertical line on mobile */
  .header .line {
    width: 1px;
    height: auto;
    min-height: 64px;
    align-self: stretch;
    flex-shrink: 0;
    background: #C49A4C;
  }

  /* Filter bar */
  .filter-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    padding: 12px 0 8px;
  }

  .tabs {
    flex-wrap: wrap;
    gap: 6px;
  }

  .tabs button {
    height: 32px;
    padding: 0 12px;
    font-size: 12px;
    line-height: 20px;
  }

  .search-wrapper {
    width: 100%;
    gap: 8px;
  }

  .search-box {
    flex: 1;
    width: auto;
    padding: 6px 12px;
  }

  .search-box input {
    width: 100%;
  }

  .connect-wallet-btn {
    margin-top: 20px;
    width: 100%;
    height: 44px;
  }

  .portfolio-wallet {
    min-height: auto;
    padding: 40px 0;
  }
  .tables {
    height: auto;
  }
}

/* = = = = = = = = = = Medium screen (768px-1024px) = = = = = = = = = = = */
@media (min-width: 768px) and (max-width: 1024px) {
  .container {
    max-width: 100%;
    padding: 0 24px;
  }

  .header {
    gap: 20px;
  }

  .header .right {
    width: auto;
    max-width: 500px;
  }

  .header .right p .num {
    font-size: 28px;
  }
}
</style>
