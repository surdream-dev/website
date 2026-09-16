<template>
  <section class="staking-page page bg-black text-gray-100 font-sans items-center justify-items-center">
    <div class="container">
      <!-- Title -->
      <header class="header">
        <h1>Staking</h1>
        <p>
          Compare staking and restaking opportunities and boost your APY across DeFi protocols
        </p>
      </header>

      <div v-if="isLoading" class="loading-state">
        <p>Loading...</p>
      </div>
      <div v-else-if="rawData.length === 0" class="empty-state">
        <p>No data available</p>
      </div>
      <div v-else class="crypto-table">
        <table>
          <thead>
            <tr>
              <th
                v-for="col in columns"
                :key="col.key"
                @click="sort(col.key)"
              >
                <div class="sortable">
                  <span>{{ col.label }}</span>
                  <span class="sort" :class="sortCls(col.key)">
                    <span class="sort-icon up"></span>
                    <span class="sort-icon down"></span>
                  </span>
                </div>
              </th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            <tr v-for="(row, idx) in sortedData" :key="idx" class="table-row" @click="onRowClick(row)">
              <td>
                <div class="protocol">
                  <img v-if="row.icon" :src="row.icon"/>
                  {{ row.protocol }}
                </div>
              </td>
              <td>
                <div class="asset"><img :src="getIcon('ETH')"/>{{ row.asset }}</div></td>
              <td>
                {{ row.tvl }}
                <Tooltips
                  v-if="DEFI_LLAMA_PROTOCOLS.includes(row.protocolId)"
                  :head="row.protocol"
                  content="TVL from DefiLlama"
                  contentmore=""
                >
                  <span class="tip-icon">!</span>
                </Tooltips>
              </td>
              <td class="total">
                {{ row.basicApy }}
                <Tooltips
                  v-if="DEFI_LLAMA_PROTOCOLS.includes(row.protocolId)"
                  :head="row.protocol"
                  :content="defiLlamaApyTip(row.protocolId)"
                  contentmore=""
                >
                  <span class="tip-icon">!</span>
                </Tooltips>
              </td>
              <td>{{ row.unstakePeriod }}</td>
              <td>{{ row.launchYear }}</td>
              <td>
                <div class="list-op-btn" @click="openStake(row)">Stake</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <FOOT></FOOT>
    </div>
  </section>
  <LidoStakeModal v-model="stakeModalVisible" :balance="userEthBalance" :protocol="userProtocol" :selectedItem="selectedItem" :availableTabs="stakeModalTabs" @stake="handleStake" />
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import LidoStakeModal from '@/components/stakeOp/index.vue'
import { useUserEthBalance } from '@/composables/useBalance'
import FOOT from '../../components/Foot.vue'
import Tooltips from '@/components/tooltips.vue'
import { transformStakingData } from '@/api/staking'
import { stakeProtocols } from '@/constants/protocols'
import { getStakeApy } from '@/api/apy'
import { getDefiLlamaPool, getEthPriceUsd } from '@/api/defillama'
import { stake } from '@/chain/stake'
import { ADDRESSES } from '@/chain/evm/addresses'
import { publicClient } from '@/chain/core/provider'
import { multicall } from 'viem/actions'
import { toast } from '@/utils/toast'
import { sortRows } from '@/utils/sort'

interface StakingItem {
  protocol: string
  icon: string
  tvl: string
  basicApy: string
  boostApy: string
  totalApy: string
  unstake: string
  year: number
}

// Modal tabs config (Rocket Pool has no Withdraw; unstake settles instantly)
const stakeModalTabs = computed(() => {
  if (userProtocolId.value === 'rocketpool') return ['Stake', 'Unstake']
  return ['Stake', 'Unstake', 'Withdraw']
})

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

const columns = [
  { key: 'protocol', label: 'Protocol' },
  { key: 'asset', label: 'Asset' },
  { key: 'tvl', label: 'TVL' },
  { key: 'basicApy', label: 'APY' },
  { key: 'unstakePeriod', label: 'Unstake Period' },
  { key: 'launchYear', label: 'Launch Year' }
]

// Protocols using the DefiLlama data source: both APY and TVL come from DefiLlama yields
const DEFI_LLAMA_PROTOCOLS = ['etherfi', 'stader']
function defiLlamaApyTip(protocolId: string): string {
  return protocolId === 'stader' ? 'APY from DefiLlama (30-day average)' : 'APY from DefiLlama'
}

// Real data
const apiData = ref<any[]>([])
const isLoading = ref(false)

// Unified duration formatting: <1h → minutes, <48h → hours, otherwise → days
function formatDuration(ms: number): string {
  const hours = ms / 3600000
  if (hours < 1) return `~${Math.round(ms / 60000)} min`
  if (hours < 48) return `~${Math.round(hours)}h`
  return `~${Math.round(hours / 24)} days`
}

// Unstake days rounded for display (shared by Lido / mETH): ≤36h → ~1 day; (36h, 60h] → ~2 days; then +1 tier every 24h
function formatUnstakeDays(ms: number): string {
  const hours = ms / 3600000
  const days = Math.max(1, Math.ceil((hours - 12) / 24))
  return `~${days} day`
}

// Update a protocol row's Unstake Period (keep the static fallback when no real-time value is available)
function updateUnstakePeriod(protocolId: string, text: string) {
  apiData.value = apiData.value.map(item =>
    item.protocolId === protocolId ? { ...item, unstakePeriod: text } : item,
  )
}

// Lido Unstake Period dynamic estimate: call the official wq-api (using 32 ETH as a representative amount); fall back to the static value on failure
async function fetchLidoUnstakePeriod() {
  try {
    const res = await fetch('https://wq-api.lido.fi/v2/request-time/calculate?amount=32')
    if (!res.ok) return
    const data = await res.json()
    const finalizationIn = data?.requestInfo?.finalizationIn
    if (typeof finalizationIn !== 'number' || finalizationIn <= 0) return
    updateUnstakePeriod('lido', formatUnstakeDays(finalizationIn))
  } catch {
    // Keep the static fallback '1–5 days' when the request fails
  }
}

// StakeWise Unstake Period: official GraphQL exitStats.duration (seconds); fall back to '≥24 hours' on failure
async function fetchStakewiseUnstakePeriod() {
  try {
    const res = await fetch('https://mainnet-api.stakewise.io/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ exitStats { duration } }' }),
    })
    if (!res.ok) return
    const data = await res.json()
    const duration = data?.data?.exitStats?.duration
    if (typeof duration !== 'number' || duration <= 0) return
    updateUnstakePeriod('stakewise', formatDuration(duration * 1000))
  } catch {
    // Keep the static fallback '≥24 hours' when the request fails
  }
}

// mETH Unstake Period + Rocket Pool Unstake Period: combine both on-chain reads into one multicall to reduce RPC requests
async function fetchUnstakePeriods() {
  try {
    const results = await multicall(publicClient, {
      contracts: [
        // mETH: numberOfBlocksToFinalize() (currently 3600 blocks; at 12s/block ≈ 12h → ~1 day)
        {
          address: ADDRESSES.meth.unstakeRequestsManager as `0x${string}`,
          abi: [{ name: 'numberOfBlocksToFinalize', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
          functionName: 'numberOfBlocksToFinalize',
          args: [],
        },
        // Rocket Pool: deposit pool balance; ≥1 ETH exchanges instantly, otherwise goes through DEX/queue
        {
          address: ADDRESSES.rocketpool.depositPool as `0x${string}`,
          abi: [{ name: 'getBalance', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
          functionName: 'getBalance',
          args: [],
        },
      ],
      allowFailure: true,
    })

    const blocks = results[0]?.status === 'success' ? (results[0].result as bigint) : 0n
    if (blocks > 0n) {
      // Ethereum average block time 12s (consistent with official docs)
      updateUnstakePeriod('meth', formatUnstakeDays(Number(blocks) * 12000))
    }

    const balance = results[1]?.status === 'success' ? (results[1].result as bigint) : 0n
    if (results[1]?.status === 'success') {
      updateUnstakePeriod('rocketpool', balance >= 10n ** 18n ? 'Instant' : 'Varies')
    }
  } catch {
    // Any failure keeps the static fallback (mETH '12h–7.5 days' / Rocket Pool 'Varies')
  }
}

// Access Data
async function fetchData() {
  isLoading.value = true
  try {
    // No longer depends on the backend API: the protocol list comes from local config (consistent with the backend response)
    const list = stakeProtocols.map(p => ({
      name: p.name,
      protocolId: p.protocolId,
      logo: p.logo || '',
      asset: p.asset,
      assetAddress: p.assetAddress,
      decimals: p.decimals,
      contracts: { token: p.contracts.token, staking: p.contracts.staking },
      receiptTokenSymbol: p.receiptTokenSymbol || '',
      metrics: { tvl: 0, apy: { base: 0, boost: 0, total: 0 } },
      unstake: { period: p.unstakePeriod, available: true },
      launchYear: p.launchYear,
      tags: [],
    }))
    let items = transformStakingData({ list }).map(item => ({
      ...item,
      icon: getIcon(item.protocolId) || item.icon
    }))

    // Static rows (protocol/asset/unstake period etc.) render first; TVL/APY dynamic fields are '-'
    apiData.value = items
    isLoading.value = false

    // Unstake Period filled dynamically (async; failures do not affect other rows and fall back to static official ranges)
    fetchLidoUnstakePeriod()
    fetchStakewiseUnstakePeriod()
    fetchUnstakePeriods()

    // TVL/APY line-by-line asynchronous padding: first to return, first to show, not to block other lines
    const DEFI_LLAMA_TVL_PROTOCOLS = ['etherfi', 'stader']
    const ETH_ONE = 10n ** 18n
    const formatEthTvl = (tvlEth: bigint) => {
      const whole = tvlEth / ETH_ONE
      const frac = (tvlEth % ETH_ONE).toString().padStart(18, '0').slice(0, 3)
      return whole.toLocaleString('en-US') + '.' + frac + ' ETH'
    }

    // Pre-warm the shared ETH price once (cached; later rows reuse it directly for DefiLlama conversions)
    getEthPriceUsd().catch(() => undefined)

    items.forEach((item: any) => {
      ;(async () => {
        // TVL: on-chain adapter first; ether.fi/Stader use DefiLlama (USD → ETH conversion)
        try {
          let tvlEth: bigint | null = null
          const adapter = stake.get(item.protocolId)
          if (DEFI_LLAMA_TVL_PROTOCOLS.includes(item.protocolId)) {
            const pool = await getDefiLlamaPool(item.protocolId)
            const ethPrice = await getEthPriceUsd()
            if (pool?.tvlUsd && ethPrice && ethPrice > 0) {
              tvlEth = BigInt(Math.round((pool.tvlUsd / ethPrice) * 1e18))
            }
          }
          if (tvlEth === null && adapter?.getMarketData) {
            const cd = await adapter.getMarketData()
            if (cd && cd.tvl > 0n) tvlEth = cd.tvl
          }
          if (tvlEth !== null) {
            const row = apiData.value.find((r: any) => r.protocolId === item.protocolId)
            if (row) row.tvl = formatEthTvl(tvlEth)
          }
        } catch (e) {
          console.warn(`[Stake] ${item.protocolId} TVL 获取失败:`, e)
        }
      })()

      // APY: official APIs are authoritative; '-' when none exists
      getStakeApy(item.protocolId).then(apy => {
        const row = apiData.value.find((r: any) => r.protocolId === item.protocolId)
        if (!row) return
        row.basicApy = apy !== null ? apy.toFixed(2) + '%' : '-'
        row.totalApy = apy !== null ? apy.toFixed(2) + '%' : '-'
        if (row.metrics?.apy) {
          row.metrics.apy.base = apy ?? 0
          row.metrics.apy.total = apy ?? 0
        }
      }).catch(() => {
        const row = apiData.value.find((r: any) => r.protocolId === item.protocolId)
        if (row) {
          row.basicApy = '-'
          row.totalApy = '-'
        }
      })
    })
  } catch (err) {
    console.error('[Stake] API load failed:', err)
    apiData.value = []
    toast.show('API connection error, please try again later', 'error')
  } finally {
    isLoading.value = false
  }
}

// Merge data sources
const rawData = computed(() => apiData.value)

// Lifecycle - Get data when component is mounted
onMounted(() => {
  fetchData()
})
// Sort Status
const sortKey = ref('')
const sortOrder = ref('') // 'asc' | 'desc'

function sort (key) {
  if (sortKey.value !== key) {
    sortKey.value = key
    sortOrder.value = 'asc'
  } else {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : sortOrder.value === 'desc' ? '' : 'asc'
    if (!sortOrder.value) sortKey.value = ''
  }
}

const sortedData = computed(() => {
  if (!sortKey.value) return rawData.value
  return sortRows(rawData.value, sortKey.value, sortOrder.value)
})

function sortCls (key) {
  if (sortKey.value !== key) return ''
  return sortOrder.value === 'asc' ? 'asc' : 'desc'
}

/* Balance first mock, followed by real data */
const userEthBalance = useUserEthBalance()
const userProtocol = ref('')
const userProtocolimg = ref('')
const userProtocolId = ref('')

/* Popup switch + currently selected row data */
const stakeModalVisible = ref(false)
const selectedItem = ref<StakingItem | null>(null)

/* After hiding the action column on the mobile side, click on the row to open the corresponding action pop-up window */
function onRowClick(item: StakingItem) {
  if (window.innerWidth <= 768) {
    openStake(item)
  }
}

/* Open popup */
function openStake(item: StakingItem) {
  // Backend row fields may be missing: fill assetAddress/decimals/receiptToken from config so modal balances/actions are correct
  const pid = (item.protocolId || item.protocol || '').toLowerCase()
  const sym = (item.asset || '').toLowerCase()
  const proto = stakeProtocols.find(p => p.protocolId === pid && (p.asset || '').toLowerCase() === sym)
    || stakeProtocols.find(p => p.protocolId === pid)
  selectedItem.value = proto ? {
    ...item,
    protocolId: proto.protocolId,
    protocol: proto.name || item.protocol,
    asset: proto.asset,
    assetAddress: item.assetAddress || proto.assetAddress,
    decimals: item.decimals || proto.decimals,
    receiptToken: item.receiptToken || proto.contracts?.token || proto.contracts?.staking,
    receiptTokenSymbol: item.receiptTokenSymbol || proto.receiptTokenSymbol || '',
    unstakePeriod: item.unstakePeriod || proto.unstakePeriod,
    contracts: proto.contracts,
  } : item
  userProtocol.value = item.protocol
  userProtocolId.value = item.protocolId
  userProtocolimg.value = item.icon
  stakeModalVisible.value = true
}

/* Callback after the transaction is completed in the pop-up window */
function handleStake() {
  // Staking operations do not change the protocol list data; no refresh needed
}

</script>

<style scoped>
/* Overall Page */
.staking-page {
  background-image:url("@/assets/img/stakebg.png") ;
  color: #fff;
  padding: 110px 0 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}
.container {
  max-width: 1300px;
  margin: 0 auto;
}
/* Title */
.header h1 {
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

.header p {
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

.loading-state, .empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #ACB5BB;
  font-size: 18px;
  min-height: 480px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.crypto-table {
  margin: 60px 0 0;
  max-width: 1300px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: var(--High-Fidelity-Color-Card-Background, rgba(255, 255, 255, 0.02));
}


table {
  width: 100%;
  border-collapse: collapse;
  /* Fixed table layout: column widths are set by th; sorting/data refresh no longer recompute widths from content */
  table-layout: fixed;
}

/* Fix Stake desktop column widths. Column widths are set by the header th (table-layout: fixed); width on td does not affect column allocation. */
.crypto-table thead th:nth-child(1),
.crypto-table tbody td:nth-child(1) { width: 15%; }
.crypto-table thead th:nth-child(2),
.crypto-table tbody td:nth-child(2) { width: 12%; }
.crypto-table thead th:nth-child(3),
.crypto-table tbody td:nth-child(3) { width: 15%; }
.crypto-table thead th:nth-child(4),
.crypto-table tbody td:nth-child(4) { width: 13%; }
.crypto-table thead th:nth-child(5),
.crypto-table tbody td:nth-child(5) { width: 20%; }
.crypto-table thead th:nth-child(6),
.crypto-table tbody td:nth-child(6) { width: 12%; }
.crypto-table thead th:nth-child(7),
.crypto-table tbody td:nth-child(7) { width: 13%; }

.crypto-table tbody td {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

tbody tr:last-child td {
  border-bottom: none;
}

.protocol {
  display: flex;
  align-items: center;
  gap: 7px;
  /* protocol is now a div inside td, so it no longer hits .crypto-table tbody td's nowrap/overflow rules. white-space:normal overrides the nowrap inherited on td, and flex-wrap lets names wrap when they do not fit the column width instead of being clipped. */
  white-space: normal;
  flex-wrap: wrap;
}

.tag {
  background: #f0f0f0;
  color: #555;
  font-size: 11px;
  padding: 3px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.total {
  font-weight: 600;
  color: #16a34a;
}
.sort {
  display: flex;
  flex-direction: column;
  align-items:center;
  width:5px;
  margin-left:10px;
}
.sort-icon {
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  transition: border-color 0.2s;
}
.up {
  border-bottom-color:rgba(255,255,255,0.2);
  border-bottom: 6px solid #ccc;
  transform:translateY(-1px);
}
.down { 
  border-top-color:rgba(255,255,255,0.2);
  border-top: 6px solid #ccc;
  transform:translateY(1px);
}
.asc .up {
  border-bottom-color:rgba(255,255,255,1);
}
.desc .down { 
  border-top-color:rgba(255,255,255,1);
}

.protocol img {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}

/* asset */
.asset {
  display: flex;
  align-items: center;
  gap: 10px;
}

.asset img {
  width: 40px;
  height: 40px;
}

/* total apy */
.total {
  font-weight: 600;
}

/* tooltip exclamation point icon: 14px, 0.6 transparency */
.tip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-left: 0px;
  border: 1px solid #ACB5BB;
  border-radius: 50%;
  color: #ACB5BB;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  opacity: 0.6;
  vertical-align: middle;
  cursor: pointer;
}

/* stake button */
.stake-btn {
  display: flex;
  width: 60px;
  padding: 4px 24px;
  justify-content: center;
  align-items: flex-start;
  gap: 10px;
  border-radius: 10px;
  background: var(--gold, linear-gradient(90deg, #C49A4C 30.29%, #F6D77B 69.23%, #B1822A 100%));
  color: var(--Font-Color-Pure-White, #FFF);
  text-align: center;

  /* Semibold/Type@16 */
  font-family: Inter;
  font-size: 16px;
  font-style: normal;
  font-weight: 600;
  line-height: 150%; /* 24px */
  letter-spacing: -0.32px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.stake-btn:hover {
  opacity: 0.85;
}

/* Action Button */
.list-op-btn {
  display: flex;
  padding: 4px 24px;
  justify-content: center;
  align-items: center;
  border-radius: 10px;
  background: var(--gold, linear-gradient(90deg, #C49A4C 30.29%, #F6D77B 69.23%, #B1822A 100%));
  color: #FFF;
  font-family: Inter;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.list-op-btn:hover {
  opacity: 0.85;
}

/* = = = = = = = = = = Mobile Adaptation (< 768px) = = = = = = = = = = = */
@media (max-width: 768px) {
  .staking-page {
    padding: 80px 0 0;
    background-image: none;
    min-height: auto;
    height: auto;
  }

  .container {
    max-width: 100%;
    padding: 0 16px;
  }

  .header h1 {
    font-size: 24px;
    line-height: 32px;
  }

  .header p {
    font-size: 14px;
    line-height: 20px;
  }

  .crypto-table {
    margin: 24px 0 0;
    border: none;
    background: transparent;
    min-height: auto;
  }

  .loading-state, .empty-state {
    min-height: auto;
    padding: 40px 20px;
  }

  /* Mobile Preservation Table List: Protocol/Asset/TVL/APY Four Columns Only */
  .crypto-table {
    border: 1px solid rgba(255, 255, 255, 0.05);
    background: rgba(255, 255, 255, 0.02);
  }

  .crypto-table table {
    display: table;
    width: 100%;
    table-layout: fixed;
    font-size: 12px;
  }

  .crypto-table thead {
    display: table-header-group;
  }

  .crypto-table tbody {
    display: table-row-group;
  }

  .crypto-table tbody tr {
    display: table-row;
    padding: 0;
    border: none;
    background: transparent;
    gap: 0;
  }

  .crypto-table tbody tr.table-row {
    cursor: pointer;
  }

  .crypto-table tbody tr.table-row:active {
    background: rgba(255, 255, 255, 0.04);
  }

  .crypto-table thead th,
  .crypto-table tbody tr td {
    display: table-cell;
    height: auto;
    padding: 10px 6px;
    border: 0px solid rgba(255, 255, 255, 0.05) !important;
    font-size: 12px;
    line-height: 18px;
    word-break: break-word;
    /* Let the tooltip popup (absolute, high z-index) escape the cell on mobile so it isn't clipped by the row/card */
    white-space: normal;
    overflow: visible;
  }

  /* Column Width: Protocol/Asset/TVL/APY */
  .crypto-table thead th:first-child,
  .crypto-table tbody tr td:first-child {
    width: 32%;
  }

  .crypto-table thead th:nth-child(2),
  .crypto-table tbody tr td:nth-child(2) {
    width: 23%;
  }

  .crypto-table thead th:nth-child(3),
  .crypto-table tbody tr td:nth-child(3) {
    width: 25%;
  }

  .crypto-table thead th:nth-child(4),
  .crypto-table tbody tr td:nth-child(4) {
    width: 20%;
  }

  /* Hide Unstake Period / Launch Year / action columns on mobile */
  .crypto-table thead th:nth-child(5),
  .crypto-table thead th:nth-child(6),
  .crypto-table thead th:nth-child(7),
  .crypto-table tbody tr td:nth-child(5),
  .crypto-table tbody tr td:nth-child(6),
  .crypto-table tbody tr td:nth-child(7) {
    display: none;
  }

  .crypto-table .sortable {
    padding-right: 0;
  }

  .crypto-table .sort {
    width: 4px;
    margin-left: 3px;
  }

  .crypto-table .sort-icon {
    border-left-width: 3px;
    border-right-width: 3px;
  }

  .crypto-table .up {
    border-bottom-width: 4px;
  }

  .crypto-table .down {
    border-top-width: 4px;
  }

  .protocol img,
  .asset img {
    width: 26px;
    height: 26px;
  }

  .protocol {
    gap: 4px;
  }

  .asset {
    gap: 4px;
  }

  /* ===== Mobile rows stay one horizontal table line, styled as rounded cards ===== */
  .crypto-table {
    border: none;
    background: transparent;
  }

  .crypto-table table {
    border-collapse: separate;
    border-spacing: 0 8px;
  }

  .crypto-table thead th {
    padding: 0 6px 8px;
    border: none;
    background: transparent;
    color: #7A8A94;
    font-size: 11px;
    line-height: 16px;
    font-weight: 500;
  }

  .crypto-table tbody tr td {
    background: #1a1a1a;
    transition: background-color 0.15s ease;
  }

  .crypto-table tbody tr td:first-child {
    border-radius: 10px 0 0 10px;
  }

  .crypto-table tbody tr.table-row:active td {
    background: #2a2a2a;
  }

  /* Last visible column (APY): rounded right corner + reserved space for the arrow */
  .crypto-table tbody tr.table-row td:nth-child(4) {
    border-radius: 0 10px 10px 0;
    position: relative;
    padding-right: 24px;
  }

  /* Right arrow: hints the row opens the next screen */
  .crypto-table tbody tr.table-row td:nth-child(4)::after {
    content: '›';
    position: absolute;
    right: 7px;
    top: 50%;
    transform: translateY(-50%);
    color: rgba(255, 255, 255, 0.3);
    font-size: 20px;
    line-height: 1;
  }
}

/* = = = = = = = = = = Medium screen (768px-1024px) = = = = = = = = = = = */
@media (min-width: 768px) and (max-width: 1024px) {
  .container {
    max-width: 100%;
    padding: 0 24px;
  }

  .crypto-table {
    margin: 40px 0 0;
  }

  .crypto-table table {
    font-size: 14px;
  }

  .protocol img,
  .asset img {
    width: 32px;
    height: 32px;
  }
}
</style>
