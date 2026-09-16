/**
 * Real-time TVL of stablecoin yield items (ethena + USDC/USDT liquidity in aave/compound/morpho/sparklend/fluid).
 * The Home Top APY cards and Stablecoin page share the same logic to avoid implementation drift.
 */
import { getDefiLlamaPool } from '@/api/defillama'
import { getProtocolApy } from '@/api/apy'
import { getLendingRates } from './useLendingApy'
import { getLendingPrices, getPriceByAddress } from './useLendingPrices'
import { getMorphoVaultInfo } from './useMorphoVault'
import { stablecoin } from '@/chain/stablecoin'
import { stablecoinProtocols, getStablecoinPoolId } from '@/constants/protocols'

const LENDING_PROTOCOLS = ['aave', 'compound', 'morpho', 'sparklend', 'fluid']

/** Fluid fToken rate/total supply (official REST). TVL uses totalAssets, APY uses apy */
export async function fetchFluidTokenRates(assetAddress: string): Promise<{ apy: number; totalAssets: bigint } | null> {
  try {
    const res = await fetch('https://api.fluid.io/v2/lending/1/tokens')
    if (!res.ok) throw new Error(`Fluid tokens HTTP ${res.status}`)
    const json: any = await res.json()
    const t = (Array.isArray(json?.data) ? json.data : []).find(
      (x: any) => (x?.assetAddress || '').toLowerCase() === (assetAddress || '').toLowerCase()
    )
    if (!t) return null
    return { apy: Number(t.supplyRate || 0) / 100, totalAssets: BigInt(String(t.totalAssets || 0)) }
  } catch (e) {
    console.warn('[StablecoinData] Fluid tokens 获取失败:', e)
    return null
  }
}

/**
 * Return the real-time TVL of a stablecoin yield item (USD number, unformatted). Returns null if unavailable.
 * - ethena: DefiLlama pool tvlUsd
 * - fluid: on-chain fToken totalAssets × price
 * - morpho: vault totalAssets (USDC/USDT ≈ $1, no price multiplication)
 * - aave/compound/sparklend: on-chain pool totalSupply × price
 * - others: tvl from the stablecoin adapter getMarketData
 */
export async function getStablecoinTvlUsd(item: {
  protocolId?: string
  asset?: string
  assetAddress?: string
  decimals?: number
}): Promise<number | null> {
  const pid = (item.protocolId || '').toLowerCase()
  try {
    if (pid === 'ethena') {
      return (await getDefiLlamaPool('ethena'))?.tvlUsd ?? null
    } else if (LENDING_PROTOCOLS.includes(pid)) {
      if (pid === 'fluid') {
        const tr = await fetchFluidTokenRates(item.assetAddress || '')
        if (tr && tr.totalAssets > 0n) {
          const prices = await getLendingPrices()
          const usdPrice = getPriceByAddress(prices, item.assetAddress || '')
          if (usdPrice > 0) return Number(tr.totalAssets) / 10 ** (item.decimals ?? 18) * usdPrice
        }
      } else if (pid === 'morpho') {
        const v = await getMorphoVaultInfo(item.asset || '')
        if (v && v.totalAssets > 0n) return Number(v.totalAssets) / 10 ** (item.decimals ?? 6)
      } else {
        const rates = await getLendingRates(pid)
        const info = rates?.get((item.assetAddress || '').toLowerCase())
        if (info?.totalSupply && info.totalSupply > 0n) {
          const prices = await getLendingPrices()
          const usdPrice = getPriceByAddress(prices, item.assetAddress || '')
          if (usdPrice > 0) return Number(info.totalSupply) / 10 ** (item.decimals ?? 18) * usdPrice
        }
      }
    } else {
      const adapter = stablecoin.get(pid)
      const cd = adapter?.getMarketData ? await adapter.getMarketData() : null
      if (cd && cd.tvl > 0n) return Number(cd.tvl) / 1e18
    }
  } catch (e) {
    console.warn(`[StablecoinData] ${pid}/${item.asset} TVL 获取失败:`, e)
  }
  return null
}

/**
 * Return the real-time APY of a stablecoin yield item (number, unformatted). Returns null if unavailable.
 * Home Top APY cards and the Stablecoin page share the same logic to avoid implementation drift.
 * - fluid: official REST fToken supplyRate (api.fluid.io/v2/lending/1/tokens)
 * - morpho: vault instantaneous netApy (getMorphoVaultInfo)
 * - aave/compound/sparklend: on-chain getLendingRates supplyAPY
 * - others (ethena): official/DefiLlama getProtocolApy
 */
export async function getStablecoinApy(item: {
  protocolId?: string
  asset?: string
  assetAddress?: string
}): Promise<number | null> {
  const pid = (item.protocolId || '').toLowerCase()
  try {
    if (pid === 'fluid') {
      return (await fetchFluidTokenRates(item.assetAddress || ''))?.apy ?? null
    } else if (pid === 'morpho') {
      return (await getMorphoVaultInfo(item.asset || ''))?.apy ?? null
    } else if (LENDING_PROTOCOLS.includes(pid)) {
      const rates = await getLendingRates(pid)
      return rates?.get((item.assetAddress || '').toLowerCase())?.supplyAPY ?? null
    } else {
      return await getProtocolApy(pid)
    }
  } catch (e) {
    console.warn(`[StablecoinData] ${pid}/${item.asset} APY 获取失败:`, e)
  }
  return null
}

/** USD number → compact format ($1.23B / $4.56M / $78.90) */
export function formatUsd(v: number): string {
  return v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B'
    : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M'
    : '$' + v.toFixed(2)
}

/**
 * Convert a stablecoin config entry → the full row data needed by the operation modal (Deposit/Withdraw).
 * Home Top APY and the Stablecoin page share it so both modals receive exactly the same fields.
 * Excludes icon/tvl/apy/metrics (filled by each page): only protocol-related base fields.
 */
export function buildStablecoinOpItem(item: any): Record<string, any> {
  const protocolId = (item.protocolId || item.protocol || '').toLowerCase()
  // When fields are missing, match assetAddress/decimals from config so the modal balance query stays correct
  const meta = stablecoinProtocols.find(p =>
    p.protocolId.toLowerCase() === protocolId &&
    (p.asset || '').toLowerCase() === (item.asset || '').toLowerCase()
  ) || stablecoinProtocols.find(p => p.protocolId.toLowerCase() === protocolId)

  let receiptToken = ''
  let approveSpender = ''
  if (protocolId === 'curve') {
    receiptToken = item.contracts?.token || ''       // LP token
    approveSpender = item.contracts?.staking || ''   // Pool (approve target)
  } else if (protocolId === 'ethena') {
    receiptToken = item.contracts?.staking || ''     // sUSDe
    approveSpender = ''                               // No approve needed
  } else {
    receiptToken = item.contracts?.staking || ''
    approveSpender = ''
  }

  return {
    protocol: item.name || item.protocol || item.protocolId || '',
    protocolId: item.protocolId || '',
    // Pooled protocols carry a per-asset poolId (e.g. morpho-usdc): withdraw/getSupplyBalance rely on it to differentiate
    // Vault liquidity positions vs Morpho Blue collateral markets (USDC exists in both; protocol-level 'morpho' would misclassify)
    poolId: getStablecoinPoolId(protocolId, item.asset || ''),
    asset: item.asset || '',
    assetAddress: item.assetAddress || meta?.assetAddress || '',
    decimals: item.decimals ?? meta?.decimals ?? 18,
    receiptToken,
    receiptTokenSymbol: item.receiptTokenSymbol || '',
    approveSpender,
    curator: item.curator?.name || 'false',
    collateral: Array.isArray(item.collateral) && item.collateral.length > 0 ? item.collateral : [],
    category: item.category ? item.category.charAt(0).toUpperCase() + item.category.slice(1) : '',
    launchYear: item.launchYear || 0,
    contracts: item.contracts,
  }
}
