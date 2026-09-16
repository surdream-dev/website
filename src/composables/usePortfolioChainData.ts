/**
 * Portfolio position data sourced from local protocol metadata and on-chain balances.
 * Replaces usePortfolioPositions() for ALL / Staking / Stablecoins, removing the
 * dependency on GET /portfolio/positions.
 */
import { ref, computed, watch, getCurrentScope, onScopeDispose } from 'vue'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@/stores/wallet'
import { useBalance } from './useBalance'
import { getLendingPrices, getPriceByAddress, type LendingPrices } from './useLendingPrices'
import { getStakeApy } from '@/api/apy'
import { getDefiLlamaPool, getEthPriceUsd } from '@/api/defillama'
import { getStablecoinApy } from './useStablecoinData'
import { getMorphoVaultExchangeRate } from './useMorphoVault'
import { getFluidLiquidityExchangeRate } from '@/chain/lending/fluid'
import { ethenaRate, ethenaCooldown } from '@/chain/stablecoin/ethena'
import { stake } from '@/chain/stake'
import { stakeProtocols, stablecoinProtocols, getLendingPool } from '@/constants/protocols'
import { useLendingPosition } from './usePortfolio'
import { formatUnits } from 'viem'
import type { PortfolioPosition } from '@/types/portfolio'
import {
  mergeLendingStablecoinDuplicates,
  calculatePortfolioTotalAssets,
} from '@/utils/portfolioPositionSort'

const ETH_PLACEHOLDER = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

const portfolioPositionsRefreshKey = ref(0)
const INTEGRATED_LENDING_SUPPLY_PROTOCOLS = new Set(['aave', 'sparklend'])

/** Trigger all chain-sourced Portfolio position composables to refetch. */
export function invalidatePortfolioPositions() {
  portfolioPositionsRefreshKey.value += 1
}

function formatTokenAmount(wei: bigint, decimals: number): string {
  const full = Number(wei) / 10 ** decimals
  if (full <= 0) return '0'
  const truncated = Math.floor(full * 1e6) / 1e6
  return truncated > 0 ? truncated.toString() : '<0.000001'
}

function formatUsdValue(amount: number, usdPrice: number): string {
  const raw = amount * usdPrice
  if (raw > 0 && raw < 0.01) return '<$0.01'
  return `$${raw.toFixed(2)}`
}

function formatApy(apy: number | null | undefined): string {
  return typeof apy === 'number' && apy > 0 ? apy.toFixed(2) + '%' : '-'
}

// Staking protocols + Ethena. Dust positions (< $0.01) under these are hidden from
// the All/Staking/Stablecoin tables. Lending pools are excluded — their dust has real
// collateral semantics and must stay visible.
const DUST_HIDE_PROTOCOLS = new Set([
  ...stakeProtocols.map(p => p.protocolId.toLowerCase()),
  'ethena',
])

/** True when a staking/Ethena position is worth less than $0.01 and should be hidden from the table. */
export function isStakeDustPosition(row: PortfolioPosition): boolean {
  if (!DUST_HIDE_PROTOCOLS.has((row.protocolId || '').toLowerCase())) return false
  return (row.balanceUsdNum ?? 0) < 0.01
}

// Protocol TVL source: on-chain adapter first; ether.fi/Stader use DefiLlama (USD → ETH).
const DEFI_LLAMA_TVL_PROTOCOLS = ['etherfi', 'stader']
const ETH_ONE = 10n ** 18n
function formatEthTvl(tvlEth: bigint): string {
  const whole = tvlEth / ETH_ONE
  const frac = (tvlEth % ETH_ONE).toString().padStart(18, '0').slice(0, 3)
  return whole.toLocaleString('en-US') + '.' + frac + ' ETH'
}

function emptyPortfolioPosition(overrides: Partial<PortfolioPosition>): PortfolioPosition {
  return {
    id: '',
    protocol: '',
    protocolId: '',
    asset: '',
    assetAddress: '',
    category: 'staking',
    type: 'stake',
    balance: '0',
    balanceUsd: '$0.00',
    apy: 0,
    apyFormatted: '-',
    earnings: '0',
    earningsUsd: '$0.00',
    depositDate: '',
    lastUpdate: '',
    icon: '',
    assetIcon: '',
    ...overrides,
  }
}

function stakingUsdPrice(meta: (typeof stakeProtocols)[number], prices: LendingPrices): number {
  const receiptPrice = getPriceByAddress(prices, meta.contracts.token)
  if (receiptPrice > 0) return receiptPrice
  const underlyingPrice = getPriceByAddress(prices, meta.assetAddress)
  return underlyingPrice > 0 ? underlyingPrice : prices.eth
}

function stablecoinUsdPrice(meta: (typeof stablecoinProtocols)[number], prices: LendingPrices): number {
  const price = getPriceByAddress(prices, meta.assetAddress)
  return price > 0 ? price : 1
}

/** Combined pending + claimable unstake ETH. Instant/skip protocols return 0. */
async function getStakeWithdrawalTotal(account: `0x${string}`, protocolId: string): Promise<bigint> {
  const pid = protocolId.toLowerCase()
  if (pid === 'rocketpool' || pid === 'etherfi') return 0n

  const adapter = stake.get(pid)
  if (!adapter) return 0n

  if (adapter.getUnstakeStatus) {
    try {
      const status = await adapter.getUnstakeStatus(account)
      let pending = status.pending
      // Stader: status.pending is amountOfETHX (the locked ETHx receipt tokens), NOT ETH; only
      // claimable (ethFinalized) is already ETH. Convert pending ETHx → ETH via the ETHx→ETH rate
      // so both can be summed, priced and labeled uniformly as ETH by the withdraw row below.
      if (pid === 'stader' && pending > 0n) {
        const rate = (await adapter.getUnstakeRate?.()) ?? 1
        const rateWad = BigInt(Math.round(rate * 1e18))
        if (rateWad > 0n) pending = (pending * rateWad) / 10n ** 18n
      }
      return pending + status.claimable
    } catch (e) {
      console.warn(`[PortfolioChain] ${pid} getUnstakeStatus failed:`, e)
    }
  }

  if (adapter.getClaimableAmount) {
    try {
      return await adapter.getClaimableAmount(account)
    } catch (e) {
      console.warn(`[PortfolioChain] ${pid} getClaimableAmount failed:`, e)
    }
  }

  return 0n
}

/** Staking positions: current receipt-token balance + one optional Withdraw row per protocol. */
export function usePortfolioStaking() {
  const walletStore = useWalletStore()
  const { address, isConnected } = storeToRefs(walletStore)
  const { getBalanceWei } = useBalance()

  const positions = ref<PortfolioPosition[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const page = ref(1)
  const pageSize = ref(7)
  const total = ref(0)

  let requestSeq = 0

  async function fetchData() {
    requestSeq += 1
    const seq = requestSeq

    if (!isConnected.value || !address.value) {
      positions.value = []
      total.value = 0
      return
    }

    loading.value = true
    error.value = null
    const account = address.value as `0x${string}`

    try {
      const prices = await getLendingPrices()
      const rows = await Promise.all(stakeProtocols.map(async (meta): Promise<PortfolioPosition[]> => {
        const pid = meta.protocolId.toLowerCase()
        const receiptToken = meta.contracts.token
        const decimals = meta.decimals || 18
        const result: PortfolioPosition[] = []

        const [balanceWei, pendingWei, apy] = await Promise.all([
          getBalanceWei(account, receiptToken).catch(() => 0n),
          getStakeWithdrawalTotal(account, pid),
          getStakeApy(pid).catch(() => null),
        ])

        // Protocol-level TVL (ETH): on-chain adapter first; ether.fi/Stader use DefiLlama.
        // Fills the stake modal's Stake-tab TVL, which otherwise falls back to '-' because
        // these chain-sourced rows carried no tvl field.
        let tvlEth: bigint | null = null
        try {
          const adapter = stake.get(pid)
          if (DEFI_LLAMA_TVL_PROTOCOLS.includes(pid)) {
            const pool = await getDefiLlamaPool(pid)
            const ethPrice = await getEthPriceUsd()
            if (pool?.tvlUsd && ethPrice && ethPrice > 0) {
              tvlEth = BigInt(Math.round((pool.tvlUsd / ethPrice) * 1e18))
            }
          }
          if (tvlEth === null && adapter?.getMarketData) {
            const cd = await adapter.getMarketData()
            if (cd && cd.tvl > 0n) tvlEth = cd.tvl
          }
        } catch (e) {
          console.warn(`[Portfolio] ${pid} TVL 获取失败:`, e)
        }
        const tvl = tvlEth !== null ? formatEthTvl(tvlEth) : '-'

        if (balanceWei > 0n) {
          const balance = formatTokenAmount(balanceWei, decimals)
          const balanceNum = Number(balanceWei) / 10 ** decimals
          const usdPrice = stakingUsdPrice(meta, prices)
          result.push(emptyPortfolioPosition({
            id: `staking:${pid}`,
            protocol: meta.name,
            protocolId: meta.protocolId,
            asset: meta.asset,
            assetAddress: meta.assetAddress,
            receiptToken,
            receiptTokenSymbol: meta.receiptTokenSymbol || '',
            category: 'staking',
            type: meta.category,
            balance,
            balanceUsd: formatUsdValue(balanceNum, usdPrice),
            balanceUsdNum: balanceNum * usdPrice,
            apy: apy ?? 0,
            apyFormatted: formatApy(apy),
            decimals,
            tvl,
          }))
        }

        if (pendingWei > 0n) {
          const pendingBalance = formatTokenAmount(pendingWei, 18)
          const pendingNum = Number(pendingWei) / 1e18
          result.push(emptyPortfolioPosition({
            id: `staking-withdraw:${pid}`,
            protocol: meta.name,
            protocolId: meta.protocolId,
            asset: 'ETH',
            assetAddress: ETH_PLACEHOLDER,
            receiptToken,
            receiptTokenSymbol: meta.receiptTokenSymbol || '',
            category: 'staking',
            type: 'withdraw',
            balance: pendingBalance,
            balanceUsd: formatUsdValue(pendingNum, prices.eth),
            balanceUsdNum: pendingNum * prices.eth,
            apy: 0,
            apyFormatted: '-',
            decimals: 18,
          }))
        }

        return result
      }))

      if (seq !== requestSeq) return
      positions.value = rows.flat()
      total.value = 0
    } catch (e: any) {
      if (seq !== requestSeq) return
      console.warn('[PortfolioChain] Staking fetch failed:', e)
      positions.value = []
      error.value = e.message || 'Failed to fetch staking positions'
    } finally {
      if (seq === requestSeq) loading.value = false
    }
  }

  watch([isConnected, address, portfolioPositionsRefreshKey], fetchData, { immediate: true })

  return {
    positions,
    loading,
    error,
    total,
    page,
    pageSize,
    isLoggedIn: computed(() => isConnected.value),
    loadMore: () => {},
    refetch: fetchData,
  }
}

/** Stablecoin positions: local stablecoin protocol config + receipt-token balances. */
export function usePortfolioStablecoin() {
  const walletStore = useWalletStore()
  const { address, isConnected } = storeToRefs(walletStore)
  const { getBalanceWei } = useBalance()

  const positions = ref<PortfolioPosition[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const page = ref(1)
  const pageSize = ref(7)
  const total = ref(0)

  let requestSeq = 0

  async function fetchData() {
    requestSeq += 1
    const seq = requestSeq

    if (!isConnected.value || !address.value) {
      positions.value = []
      total.value = 0
      return
    }

    loading.value = true
    error.value = null
    const account = address.value as `0x${string}`

    try {
      const prices = await getLendingPrices()
      const metas = stablecoinProtocols.filter(p => p.protocolId.toLowerCase() !== 'curve')
      const rows = (await Promise.all(metas.map(async (meta): Promise<PortfolioPosition[]> => {
        const pid = meta.protocolId.toLowerCase()
        const receiptToken = meta.contracts.staking || meta.contracts.token
        const decimals = meta.decimals || 18
        let balanceWei = await getBalanceWei(account, receiptToken).catch(() => 0n)
        // Convert receipt-token balances that aren't 1:1 with the underlying asset into underlying units, so the
        // displayed balance matches the real deposit (and the overlapping Lending-side position in the All view):
        // - morpho: ERC-4626 vault shares (18-dec) → underlying USDC/USDT (6-dec) via vault exchange rate.
        // - fluid: fToken balance (6-dec) → underlying via fToken exchange rate (fUSDT≈1.20, fUSDC≈1.21).
        // - ethena: sUSDe is interest-bearing (ERC4626) → USDe via previewRedeem (1 sUSDe redeems for >1 USDe).
        // Aave/SparkLend aTokens are already denominated in underlying (balanceOf includes the accrued index), so they need no conversion.
        if (balanceWei > 0n) {
          if (pid === 'morpho') {
            const rate = await getMorphoVaultExchangeRate(meta.asset.toLowerCase())
            balanceWei = BigInt(Math.round((Number(balanceWei) / 10 ** 18) * rate * 10 ** decimals))
          } else if (pid === 'fluid') {
            const rate = await getFluidLiquidityExchangeRate(receiptToken)
            balanceWei = BigInt(Math.round(Number(balanceWei) * rate))
          } else if (pid === 'ethena') {
            // Otherwise the sUSDe share balance is priced 1:1 at USDe's ~$1, undercounting the real value.
            balanceWei = await ethenaRate.previewRedeem(balanceWei).catch(() => balanceWei)
          }
        }

        const result: PortfolioPosition[] = []

        if (balanceWei > 0n) {
          const apy = await getStablecoinApy({
            protocolId: pid,
            asset: meta.asset,
            assetAddress: meta.assetAddress,
          }).catch(() => null)

          const balance = formatTokenAmount(balanceWei, decimals)
          const balanceNum = Number(balanceWei) / 10 ** decimals
          result.push(emptyPortfolioPosition({
            id: `stablecoin:${pid}:${meta.asset.toLowerCase()}`,
            protocol: meta.name,
            protocolId: meta.protocolId,
            asset: meta.asset,
            assetAddress: meta.assetAddress,
            receiptToken,
            receiptTokenSymbol: meta.receiptTokenSymbol || '',
            category: 'stablecoin',
            type: meta.category === 'vault' ? 'vault' : 'supply',
            balance,
            balanceUsd: formatUsdValue(balanceNum, stablecoinUsdPrice(meta, prices)),
            balanceUsdNum: balanceNum * stablecoinUsdPrice(meta, prices),
            apy: apy ?? 0,
            apyFormatted: formatApy(apy),
            decimals,
          }))
        }

        // Ethena: the cooldown slot is the pending USDe locked after initiating a
        // withdrawal. Mirror the staking "withdraw" row so pending is visible and
        // clicking it opens the Claim tab.
        if (pid === 'ethena') {
          const cooldown = await ethenaCooldown.getCooldownStatus(account).catch(() => null)
          if (cooldown && cooldown.pendingAssets > 0n) {
            const pendingNum = Number(cooldown.pendingAssets) / 10 ** decimals
            result.push(emptyPortfolioPosition({
              id: `stablecoin-withdraw:${pid}:${meta.asset.toLowerCase()}`,
              protocol: meta.name,
              protocolId: meta.protocolId,
              asset: meta.asset,
              assetAddress: meta.assetAddress,
              receiptToken,
              receiptTokenSymbol: meta.receiptTokenSymbol || '',
              category: 'stablecoin',
              type: 'withdraw',
              balance: formatTokenAmount(cooldown.pendingAssets, decimals),
              balanceUsd: formatUsdValue(pendingNum, stablecoinUsdPrice(meta, prices)),
              balanceUsdNum: pendingNum * stablecoinUsdPrice(meta, prices),
              apy: 0,
              apyFormatted: '-',
              decimals,
            }))
          }
        }

        return result
      }))).flat()

      if (seq !== requestSeq) return
      positions.value = rows
      total.value = 0
    } catch (e: any) {
      if (seq !== requestSeq) return
      console.warn('[PortfolioChain] Stablecoin fetch failed:', e)
      positions.value = []
      error.value = e.message || 'Failed to fetch stablecoin positions'
    } finally {
      if (seq === requestSeq) loading.value = false
    }
  }

  watch([isConnected, address, portfolioPositionsRefreshKey], fetchData, { immediate: true })

  return {
    positions,
    loading,
    error,
    total,
    page,
    pageSize,
    isLoggedIn: computed(() => isConnected.value),
    loadMore: () => {},
    refetch: fetchData,
  }
}

/** Lending adapter for PortfolioPosition: wraps the existing on-chain useLendingPosition store. */
export function usePortfolioLending() {
  const walletStore = useWalletStore()
  const { address, isConnected } = storeToRefs(walletStore)
  const lending = useLendingPosition()

  watch(portfolioPositionsRefreshKey, () => {
    if (isConnected.value && address.value) {
      lending.refetchInfo()
    }
  })

  const lendingPositions = computed<PortfolioPosition[]>(() => {
    const supplied: PortfolioPosition[] = lending.suppliedBalances.value.map(s => {
      const pid = (s.protocolId || '').toLowerCase()
      const isIntegratedSupply = INTEGRATED_LENDING_SUPPLY_PROTOCOLS.has(pid)
      const category: PortfolioPosition['category'] =
        isIntegratedSupply || s.collateral ? 'lending-supply' : 'lending-liquidity'
      const type: PortfolioPosition['type'] = category === 'lending-liquidity' ? 'liquidity' : 'supply'

      return emptyPortfolioPosition({
        id: `${category}:${s.poolId || s.protocolId}:${s.assetAddress.toLowerCase()}`,
        protocol: s.protocol,
        protocolId: s.protocolId,
        // Carry poolId so the withdraw/borrow modal scopes to the exact pool (shared-collateral pools like
        // Compound ETH in USDC vs USDT would otherwise resolve to the wrong pool).
        poolId: s.poolId,
        asset: s.asset,
        assetAddress: s.assetAddress,
        // Pool borrowable asset — lets the All view distinguish supplies that share the same collateral across
        // single-collateral pools (e.g. Compound ETH collateral in the USDC vs USDT pool).
        loanAsset: getLendingPool(s.poolId || '')?.borrowAsset,
        receiptToken: s.receiptToken,
        receiptTokenSymbol: s.receiptTokenSymbol,
        category,
        type,
        balance: s.balance,
        balanceUsd: s.balanceUsd,
        apy: s.apy,
        apyFormatted: s.apyFormatted,
      })
    })
    const borrowed: PortfolioPosition[] = lending.borrowedBalances.value.map(b => emptyPortfolioPosition({
      id: `lending-borrow:${b.poolId || b.protocolId}:${b.assetAddress.toLowerCase()}`,
      protocol: b.protocol,
      protocolId: b.protocolId,
      // Carry poolId so the repay modal scopes to the exact pool the user clicked.
      poolId: b.poolId,
      asset: b.asset,
      assetAddress: b.assetAddress,
      category: 'lending-borrow',
      type: 'borrow',
      balance: b.balance,
      balanceUsd: b.balanceUsd,
      apy: b.apy,
      apyFormatted: b.apyFormatted,
    }))
    return [...supplied, ...borrowed]
  })

  return {
    positions: lendingPositions,
    loading: lending.loading,
    error: lending.error,
    refetch: () => {
      lending.refetchInfo()
      lending.refetchBalances()
    },
  }
}

let portfolioAllStore: ReturnType<typeof createPortfolioAllStore> | null = null
let portfolioAllConsumers = 0

function createPortfolioAllStore() {
  const walletStore = useWalletStore()
  const { address, isConnected } = storeToRefs(walletStore)
  const staking = usePortfolioStaking()
  const stablecoin = usePortfolioStablecoin()
  const lending = usePortfolioLending()

  const positions = computed<PortfolioPosition[]>(() => mergeLendingStablecoinDuplicates([
    ...staking.positions.value,
    ...stablecoin.positions.value,
    ...lending.positions.value,
  ]))

  return {
    positions,
    loading: computed(() => staking.loading.value || stablecoin.loading.value || lending.loading.value),
    error: computed(() => staking.error.value || stablecoin.error.value || lending.error.value),
    total: computed(() => 0),
    page: staking.page,
    pageSize: staking.pageSize,
    isLoggedIn: staking.isLoggedIn,
    loadMore: () => {},
    refetch: () => {
      staking.refetch()
      stablecoin.refetch()
      lending.refetch()
    },
  }
}

/**
 * ALL = Staking + Stablecoin + Lending positions.
 * Singleton so the Portfolio header and the ALL table share the same chain
 * requests instead of each creating a separate fetch lifecycle.
 */
export function usePortfolioAll() {
  if (!portfolioAllStore) {
    portfolioAllStore = createPortfolioAllStore()
    portfolioAllConsumers = 0
  }

  const store = portfolioAllStore
  portfolioAllConsumers += 1

  if (getCurrentScope()) {
    onScopeDispose(() => {
      portfolioAllConsumers -= 1
      if (portfolioAllConsumers <= 0 && portfolioAllStore === store) {
        portfolioAllStore = null
        portfolioAllConsumers = 0
      }
    })
  }

  return store
}

/** Total Assets based on the deduped ALL positions. */
export function usePortfolioTotalAssets() {
  const all = usePortfolioAll()

  const value = computed(() => calculatePortfolioTotalAssets(all.positions.value))

  return {
    value,
    loading: all.loading,
  }
}
