import { encodeFunctionData, getAddress, maxUint256 } from "viem"
import { multicall } from "viem/actions"
import { AAVE_POOL_ABI, WETH_GATEWAY_ABI, ERC20_ABI } from "../evm/abis"
import { ADDRESSES } from "../evm/addresses"
import { sendTx, sendTxAndWait } from "../core/tx"
import { publicClient } from "../core/provider"
import type { LendingAdapter, PoolRateInfo } from "./base"

const ETH_PLACEHOLDER = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
const WETH_GATEWAY = getAddress(ADDRESSES.lending.aave.WETH_GATEWAY)
const AAVE_V3_POOL = getAddress(ADDRESSES.lending.aave.pool)
const aWETH = getAddress(ADDRESSES.lending.aave.aWETH)
// Aave's ETH market is backed by the WETH reserve, and its credit delegation lives on the
// WETH variableDebtToken (same ICreditDelegationToken interface as SparkLend) — NOT on the Pool.
const WETH_VARIABLE_DEBT = getAddress("0xeA51d7853EEFb32b6ee06b1C12E6dcCA88Be0fFE")
const WETH = getAddress(ADDRESSES.tokens.WETH || ADDRESSES.tokens.WETH.toLowerCase())

// Aave V3 credit-delegation ABI, called on the WETH variableDebtToken. ApproveDelegation/
// borrowAllowance back the official two-step borrowETH:
// step 1 delegate borrowing power to the WETH gateway, step 2 borrowETH unwraps to native ETH.
const AAVE_DELEGATION_ABI = [
  {
    name: "approveDelegation",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "delegatee", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "borrowAllowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "fromUser", type: "address" },
      { name: "toUser", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const

// Aave V3.3 ETH Gateway (0xd0160...) ships SIMPLIFIED native-ETH signatures that DROP the
// interestRateMode param (always variable):
//   borrowETH(address pool, uint256 amount, uint16 referralCode)
//   repayETH(address pool, uint256 amount, address onBehalfOf)
// The classic 4-param borrowETH/repayETH (with interestRateMode) is NOT deployed on this
// gateway — calling it reverts with "Fallback not allowed" (matches the official app's tx).
// NOTE: SparkLend's gateway (separate deployment) still uses the classic 4-param signature,
// so the shared WETH_GATEWAY_ABI in abis.ts stays unchanged.
const AAVE_GATEWAY_ABI = [
  {
    name: "borrowETH",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pool", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
  {
    name: "repayETH",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "pool", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [],
  },
] as const

// Aave official GraphQL API (AaveKit V3) — official data source, browser CORS available (access-control-allow-origin: *).
// Document: https://aave.com/docs/aave-v3/getting-started/graphql
// Note: Legacy hosted subgraph (api.thegraph.com/subgraphs/name/messari/aave-v3-ethereum) has been discontinued
// (301 → error.thegraph.com), the currently recommended v3 market data endpoint in the official documentation is this GraphQL API.
const AAVE_GRAPHQL_URL = 'https://api.v3.aave.com/graphql'

// Aave V3 getReserveData ABI — Query aToken Address
const AAVE_GET_RESERVE_ABI = [
  {
    name: "getReserveData",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address", name: "asset" }],
    outputs: [{
      type: "tuple",
      components: [
        { type: "uint256" },  // 0: configuration
        { type: "uint128" },  // 1: liquidityIndex
        { type: "uint128" },  // 2: currentLiquidityRate
        { type: "uint128" },  // 3: variableBorrowIndex
        { type: "uint128" },  // 4: currentVariableBorrowRate
        { type: "uint128" },  // 5: currentStableBorrowRate
        { type: "uint40" },   // 6: lastUpdateTimestamp
        { type: "uint16" },   // 7: id
        { type: "address" },  // 8: aTokenAddress What ← we want
        { type: "address" },  // 9: stableDebtTokenAddress
        { type: "address" },  // 10: variableDebtTokenAddress
        { type: "address" },  // 11: interestRateStrategyAddress
        { type: "uint128" },  // 12: accruedToTreasury
        { type: "uint128" },  // 13: unbacked
        { type: "uint128" }   // 14: isolationModeTotalDebt
      ]
    }]
  }
] as const


function isETH(asset: string): boolean {
  return asset.toLowerCase() === ETH_PLACEHOLDER.toLowerCase()
}

// Aave V3 aToken address mapping (common assets are queried directly to avoid the complex ABI of getReserveData)
// Address validated by on-chain Aave V3 Pool.getReserveData ()
const AAVE_ATOKEN_MAP: Record<string, string> = {
  [ADDRESSES.tokens.USDC.toLowerCase()]: '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c',  // USDC → aEthUSDC
  [ADDRESSES.tokens.USDT.toLowerCase()]: '0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a',  // USDT → aEthUSDT
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8',  // ETH → aWETH
  [ADDRESSES.tokens.DAI.toLowerCase()]: '0x018008bfb33d285247A21d44E50697654f754e63',  // DAI
  [ADDRESSES.tokens.WBTC.toLowerCase()]: '0x5Ee5bf7ae06D1Be5997A1A72006FE6C607eC6DE8',  // WBTC
  [ADDRESSES.tokens.wstETH.toLowerCase()]: '0x0B925eD163218f6662a35e0f0371Ac234f9E9371',  // wstETH
}

const AAVE_ASSET_SYMBOLS: Record<string, string> = {
  [ADDRESSES.tokens.USDC.toLowerCase()]: 'USDC',
  [ADDRESSES.tokens.USDT.toLowerCase()]: 'USDT',
  [ADDRESSES.tokens.WETH.toLowerCase()]: 'WETH',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': 'ETH',
  [ADDRESSES.tokens.DAI.toLowerCase()]: 'DAI',
  [ADDRESSES.tokens.WBTC.toLowerCase()]: 'WBTC',
  [ADDRESSES.tokens.wstETH.toLowerCase()]: 'wstETH',
}

// Aave's ETH reserve is actually mounted under the WETH address (0xEeee placeholder query returns all 0s)
const ETH_PLACEHOLDER_LC = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const queryAddress = (addr: string) => addr.toLowerCase() === ETH_PLACEHOLDER_LC ? WETH : addr

interface AaveGraphqlReserve {
  underlyingToken: { address: string; decimals: number }
  supplyInfo: { apy: { value: string }; total: { value: string } }
  borrowInfo: { apy: { value: string }; total: { amount: { value: string } } } | null
}

/** Decimal string (e.g. "2125575600.087198")→ raw wei bigint (precise conversion by decimals, avoiding loss of floating-point accuracy) */
function decimalToBigInt(value: string, decimals: number): bigint {
  const [intPart, fracPart = ''] = value.split('.')
  const frac = fracPart.slice(0, decimals).padEnd(decimals, '0')
  return BigInt(intPart || '0') * 10n ** BigInt(decimals) + BigInt(frac || '0')
}

/**
 * On-chain risk parameter back pocket: Aave V3 Pool.getReserveData bitmap decoding (same set layout as SparkLend).
 * LTV = bits 0-15, LiquidationThreshold = bits 16-31, LiquidationBonus = bits 32-47 (all bps).
 * Multiplex the getReserveData that APY has relied on, one time multicall; returns the assetAddress (lowercase) → risk parameter.
 * Same as official app (e.g. USDT/USDC is currently 75/78/4 .5).
 */
async function fetchAaveOnchainRisk(): Promise<Map<string, { maxLtv?: number; liquidationThreshold?: number; liquidationPenalty?: number }>> {
  const riskMap = new Map<string, { maxLtv?: number; liquidationThreshold?: number; liquidationPenalty?: number }>()
  try {
    const assetAddrs = Object.keys(AAVE_ATOKEN_MAP)
    const results = await multicall(publicClient, {
      contracts: assetAddrs.map(addr => ({
        address: AAVE_V3_POOL,
        abi: AAVE_GET_RESERVE_ABI,
        functionName: 'getReserveData',
        args: [getAddress(queryAddress(addr))],
      })),
      allowFailure: true,
    })
    for (let i = 0; i < assetAddrs.length; i++) {
      const r = results[i]
      if (r.status !== 'success') continue
      const cfg = (r.result as any)[0] as bigint
      const ltvBps = Number((cfg >> 0n) & 0xFFFFn)
      const ltBps = Number((cfg >> 16n) & 0xFFFFn)
      const bonusBps = Number((cfg >> 32n) & 0xFFFFn)
      riskMap.set(getAddress(assetAddrs[i]).toLowerCase(), {
        // LTV = 0 (if Dai can no longer be used as collateral) is also a valid value, the official app shows 0.00%, can not be treated as missing
        maxLtv: ltvBps / 100,
        liquidationThreshold: ltBps / 100,
        liquidationPenalty: bonusBps > 0 ? (bonusBps - 10000) / 100 : undefined,
      })
    }
  } catch (e) {
    console.warn('[Aave] 链上风险参数获取失败，回退配置兜底:', e)
  }
  return riskMap
}

/** Fill the missing GraphQL risk field with on-chain getReserveData (when the GraphQL risk field is not returned/the query fails) */
async function enrichRiskFromOnchain(result: PoolRateInfo[]): Promise<void> {
  const missing = result.filter(
    i => i.maxLtv === undefined || i.liquidationThreshold === undefined || i.liquidationPenalty === undefined
  )
  if (missing.length === 0) return
  const riskMap = await fetchAaveOnchainRisk()
  for (const item of missing) {
    const r = riskMap.get(item.assetAddress)
    if (!r) continue
    item.maxLtv ??= r.maxLtv
    item.liquidationThreshold ??= r.liquidationThreshold
    item.liquidationPenalty ??= r.liquidationPenalty
  }
}

/**
 * Pull real-time APYs and pool totals for all mainnet reserves from Aave's official GraphQL API (browser can be cross-domain).
 * APY value is decimal (0.03315 = 3.315%), converted to percentage × 100.
 * Note: The Reserve type of this API does not contain the ltv/liquidationThreshold/liquidationBonus risk field,
 * and reserves does not support where filtering (only specified assets cannot be pulled), so APY/total goes to full query, risk parameters are completed by getReserveData on-chain.
 */
async function fetchAaveGraphqlMarketData(): Promise<PoolRateInfo[] | null> {
  try {
    const res = await fetch(AAVE_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{
          markets(request: { chainIds: [1] }) {
            reserves {
              underlyingToken { address decimals }
              supplyInfo { apy { value } total { value } }
              borrowInfo { apy { value } total { amount { value } } }
            }
          }
        }`,
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json: any = await res.json()
    if (json?.errors?.length) throw new Error(json.errors[0].message)
    const reserves: AaveGraphqlReserve[] = json?.data?.markets?.[0]?.reserves ?? []
    if (!Array.isArray(reserves) || reserves.length === 0) return null

    const byUnderlying = new Map<string, AaveGraphqlReserve>()
    for (const r of reserves) {
      try {
        byUnderlying.set(getAddress(r.underlyingToken.address).toLowerCase(), r)
      } catch {
        // Skip unresolvable addresses
      }
    }

    const result: PoolRateInfo[] = []
    for (const addr of Object.keys(AAVE_ATOKEN_MAP)) {
      const reserve = byUnderlying.get(getAddress(queryAddress(addr)).toLowerCase())
      if (!reserve) continue
      const decimals = reserve.underlyingToken.decimals || 18
      result.push({
        assetAddress: getAddress(addr).toLowerCase(),
        supplyAPY: Number(reserve.supplyInfo.apy.value) * 100,
        borrowAPY: reserve.borrowInfo ? Number(reserve.borrowInfo.apy.value) * 100 : 0,
        totalSupply: decimalToBigInt(reserve.supplyInfo.total.value, decimals),
        totalBorrow: reserve.borrowInfo ? decimalToBigInt(reserve.borrowInfo.total.amount.value, decimals) : 0n,
      })
    }
    await enrichRiskFromOnchain(result)
    return result
  } catch (e) {
    console.warn('[Aave] GraphQL market data 获取失败:', e)
    return null
  }
}

export const aave: LendingAdapter = {
  async supply(asset, amount, account, recipient?: string) {
    // Verify account address
    if (!account) {
      throw new Error("AAVE: Account address is required")
    }

    // Use recipient or account as the receiving address
    const onBehalfOf = recipient ? getAddress(recipient) : getAddress(account)

    if (isETH(asset)) {
      const data = encodeFunctionData({
        abi: WETH_GATEWAY_ABI,
        functionName: "depositETH",
        args: [AAVE_V3_POOL, onBehalfOf, 0]
      })
      return sendTx({ to: WETH_GATEWAY, data, value: amount, account: getAddress(account) })
    }

    const data = encodeFunctionData({
      abi: AAVE_POOL_ABI,
      functionName: "supply",
      args: [getAddress(asset), amount, onBehalfOf, 0]
    })
    return sendTx({ to: AAVE_V3_POOL, data, account: getAddress(account) })
  },


  async borrow(asset, amount, account) {
    // ETH: official two-step via WETH_GATEWAY (Pool.borrow on the 0xEeee placeholder reverts —
    // Aave's ETH market is backed by the WETH reserve, and borrowETH unwraps WETH to native ETH):
    // step 1 approveDelegation(WETH gateway) on the WETH variableDebtToken (only if the gateway's
    // existing borrowAllowance < amount — delegation is a persistent, non-additive allowance),
    // step 2 borrowETH(pool, amount, 2=variable, 0=referral) on the gateway.
    if (isETH(asset)) {
      const owner = getAddress(account)
      const gateway = WETH_GATEWAY

      const current = await publicClient.readContract({
        address: WETH_VARIABLE_DEBT,
        abi: AAVE_DELEGATION_ABI,
        functionName: "borrowAllowance",
        args: [owner, gateway],
      }) as bigint

      if (current < amount) {
        const delegateData = encodeFunctionData({
          abi: AAVE_DELEGATION_ABI,
          functionName: "approveDelegation",
          args: [gateway, maxUint256],
        })
        const { receipt } = await sendTxAndWait({ to: WETH_VARIABLE_DEBT, data: delegateData, account: owner })
        if (receipt.status !== 'success') throw new Error("Aave delegation approval failed")
      }

      const borrowData = encodeFunctionData({
        abi: AAVE_GATEWAY_ABI,
        functionName: "borrowETH",
        args: [AAVE_V3_POOL, amount, 0], // 0 = referral code; gateway borrows at variable rate
      })
      return sendTx({ to: gateway, data: borrowData, account: owner })
    }
    const data = encodeFunctionData({
      abi: AAVE_POOL_ABI,
      functionName: "borrow",
      args: [getAddress(asset), amount, BigInt(2), 0, account]
    })

    return sendTx({ to: AAVE_V3_POOL, data, account: getAddress(account) })
  },

  async repay(asset, amount, account) {
    // ETH: WETH_GATEWAY.repayETH is payable — the gateway wraps the sent native ETH to WETH
    // and repays the WETH debt, refunding excess. Must pass value = amount (else it reverts).
    if (isETH(asset)) {
      const data = encodeFunctionData({
        abi: AAVE_GATEWAY_ABI,
        functionName: "repayETH",
        args: [AAVE_V3_POOL, amount, getAddress(account)] // (pool, amount, onBehalfOf)
      })
      return sendTx({ to: WETH_GATEWAY, data, value: amount, account: getAddress(account) })
    }
    const data = encodeFunctionData({
      abi: AAVE_POOL_ABI,
      functionName: "repay",
      args: [asset, amount, BigInt(2), account]
    })

    return sendTx({ to: AAVE_V3_POOL, data, account: getAddress(account) })
  },

  async repayAll(asset, account) {
    if (isETH(asset)) {
      // Query the exact current WETH debt, then repay it all via the payable gateway with a
      // CONCRETE amount + value. Passing maxUint256 here makes the gateway interpret it as
      // "repay the full outstanding debt" and then require msg.value >= that full debt — since
      // the debt accrues between query and tx, value (queried debt) < full debt and it reverts.
      const owner = getAddress(account)
      const debt = await publicClient.readContract({
        address: WETH_VARIABLE_DEBT,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [owner],
      }) as bigint

      // 0.1% buffer over the queried debt so the full repayment clears despite interest
      // accruing between query and tx; the gateway refunds any excess ETH.
      const repayAmount = debt + debt / 1000n
      const data = encodeFunctionData({
        abi: AAVE_GATEWAY_ABI,
        functionName: "repayETH",
        args: [AAVE_V3_POOL, repayAmount, owner], // (pool, amount, onBehalfOf)
      })
      return sendTx({ to: WETH_GATEWAY, data, value: repayAmount, account: owner })
    }
    const data = encodeFunctionData({
      abi: AAVE_POOL_ABI,
      functionName: "repay",
      args: [getAddress(asset), maxUint256, BigInt(2), getAddress(account)]
    })
    return sendTx({ to: AAVE_V3_POOL, data, account: getAddress(account) })
  },

  async withdraw(asset, amount, account) {
    // Aave withdraw:
    // - ETH: Need to pass WETH_GATEWAY.withdrawETH (pool, amount, to)
    // and need to approve aWETH to WETH_gateway first
    // - Other assets: Direct call to Pool.withdraw (asset, amount, to)

    if (isETH(asset)) {
      // ETH withdraw: use weth_gateway
      const data = encodeFunctionData({
        abi: WETH_GATEWAY_ABI,
        functionName: "withdrawETH",
        args: [AAVE_V3_POOL, amount, getAddress(account)]
      })


      return sendTx({ to: WETH_GATEWAY, data, account: getAddress(account) })
    }

    // Other assets: Direct call to Pool
    const data = encodeFunctionData({
      abi: AAVE_POOL_ABI,
      functionName: "withdraw",
      args: [getAddress(asset), amount, getAddress(account)]
    })


    return sendTx({ to: AAVE_V3_POOL, data, account: getAddress(account) })
  },

  async setCollateral(asset: `0x${string}`, enable: boolean, account?: `0x${string}`) {
    const data = encodeFunctionData({
      abi: AAVE_POOL_ABI,
      functionName: "setUserUseReserveAsCollateral",
      args: [asset, enable]
    })

    return sendTx({ to: AAVE_V3_POOL, data, account })
  },

  async getSupplyBalance(account: `0x${string}`, asset?: string) {
    if (asset) {
      try {
        // 1. Try known aToken mappings first (avoid complex ABIs of getReserveData)
        const assetKey = asset.toLowerCase()
        const knownAToken = AAVE_ATOKEN_MAP[assetKey]
        if (knownAToken) {
          const balance = await publicClient.readContract({
            address: getAddress(knownAToken),
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [getAddress(account)]
          }) as bigint
          return balance
        }

        // 2. Unknown asset: call getReserveData to get aToken address
        const reserveData = await publicClient.readContract({
          address: AAVE_V3_POOL,
          abi: AAVE_GET_RESERVE_ABI,
          functionName: "getReserveData",
          args: [getAddress(asset)]
        })

        const aTokenAddress = (reserveData as any)[8] as `0x${string}`
        if (!aTokenAddress || aTokenAddress === '0x0000000000000000000000000000000000000000') {
          return BigInt(0)
        }

        // 3. Query aToken.balanceOf (user) — this is the user's deposit on the asset
        const balance = await publicClient.readContract({
          address: aTokenAddress,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [getAddress(account)]
        }) as bigint

        return balance
      } catch (e) {
        console.warn(`[Aave] getSupplyBalance failed for asset ${asset}, falling back to totalCollateralBase`, e)
      }
    }

    // fallback: return total collateral value without asset
    const result = await publicClient.readContract({
      address: AAVE_V3_POOL,
      abi: AAVE_POOL_ABI,
      functionName: "getUserAccountData",
      args: [getAddress(account)]
    })

    return result[0] // totalCollateralBase
  },

  async getBorrowBalance(account: string, _asset?: string) {
    const result = await publicClient.readContract({
      address: AAVE_V3_POOL,
      abi: AAVE_POOL_ABI,
      functionName: "getUserAccountData",
      args: [getAddress(account)]
    })

    return result[1] // totalDebtBase
  },

  async getHealthSnapshot(account: `0x${string}`) {
    try {
      const result = await publicClient.readContract({
        address: AAVE_V3_POOL,
        abi: AAVE_POOL_ABI,
        functionName: "getUserAccountData",
        args: [getAddress(account)],
      })
      // getUserAccountData: [0] totalCollateralBase (USD 1e8), [1] totalDebtBase (USD 1e8),
      // [3] currentLiquidationThreshold (bps, 1e4 = 100%)
      const totalCollateralBase = result[0] as bigint
      const totalDebtBase = result[1] as bigint
      const liquidationThresholdBps = Number(result[3] as bigint)
      const borrowUSD = Number(totalDebtBase) / 1e8
      const riskAdjustedCollateralUSD =
        (Number(totalCollateralBase) / 1e8) * (liquidationThresholdBps / 1e4)
      return {
        riskAdjustedCollateralUSD,
        borrowUSD,
        liquidationThresholdBps,
        isAccountLevel: true,
        scope: 'Account',
      }
    } catch (e) {
      console.warn('[Aave] getHealthSnapshot failed:', e)
      return undefined
    }
  },

  async getBorrowBalances(account: `0x${string}`): Promise<Map<string, bigint>> {
    const result = new Map<string, bigint>()
    const assetAddresses = Object.keys(AAVE_ATOKEN_MAP)
    // Consistent with getMarketData: The ETH placeholder address is queried with WETH (the placeholder address returns all 0s, which will cause the ETH loan to be missed)
    const ETH_PLACEHOLDER_LC = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    const queryAddress = (addr: string) => addr.toLowerCase() === ETH_PLACEHOLDER_LC ? WETH : addr

    try {
      // Step 1: reserveData for all assets multicall at once
      const reserveResults = await multicall(publicClient, {
        contracts: assetAddresses.map(addr => ({
          address: AAVE_V3_POOL,
          abi: AAVE_GET_RESERVE_ABI,
          functionName: "getReserveData",
          args: [getAddress(queryAddress(addr))],
        })),
        allowFailure: true,
      })

      // Step 2: BalanceOf for all variableDebtTokens multicall at once
      const debtCalls: Array<{ address: `0x${string}`; abi: typeof ERC20_ABI; functionName: "balanceOf"; args: [`0x${string}`] }> = []
      const meta: Array<{ addr: string; idx: number }> = []
      for (let i = 0; i < assetAddresses.length; i++) {
        if (reserveResults[i].status !== 'success') continue
        const data = reserveResults[i].result as any
        const varDebtToken = data[10] as string | undefined
        if (!varDebtToken || varDebtToken === '0x0000000000000000000000000000000000000000') continue
        debtCalls.push({
          address: getAddress(varDebtToken),
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [getAddress(account)],
        })
        meta.push({ addr: assetAddresses[i], idx: debtCalls.length - 1 })
      }

      if (debtCalls.length > 0) {
        const debtResults = await multicall(publicClient, { contracts: debtCalls, allowFailure: true })
        for (const m of meta) {
          const r = debtResults[m.idx]
          if (r.status === 'success' && (r.result as bigint) > 0n) {
            result.set(getAddress(m.addr), r.result as bigint)
          }
        }
      }
    } catch (e) {
      console.warn('[Aave] getBorrowBalances failed:', e)
    }

    return result
  },

  async getAvailableBorrows(account: `0x${string}`) {
    const accountData = await publicClient.readContract({
      address: AAVE_V3_POOL,
      abi: AAVE_POOL_ABI,
      functionName: "getUserAccountData",
      args: [getAddress(account)]
    })

    // Aave V3 mainnet base currency = USD in 1e8 (8 decimal places).
    // Measured ($0.20 collateral): availableBorrowsBase = 15129973 ≈ $0.15.
    // Transfer to USD cents: availableBase × 100/1e8 (=/1e6), no longer multiplied by the ETH price.
    const availableBase = accountData[2] as bigint // availableBorrowsBase
    if (availableBase <= 0n) return 0n
    return availableBase * 100n / 10n ** 8n
  },

  async discoverPositions(account: `0x${string}`) {
    const ZERO = '0x0000000000000000000000000000000000000000'
    const assetAddrs = Object.keys(AAVE_ATOKEN_MAP).map(a => getAddress(a))
    // Consistent with getMarketData/getBorrowBalances: ETH placeholder address is queried with WETH (placeholder address returns all 0, ETH position will be missed)
    const ETH_PLACEHOLDER_LC = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    const queryAddress = (addr: string) => addr.toLowerCase() === ETH_PLACEHOLDER_LC ? WETH : addr

    const reserveResults = await multicall(publicClient, {
      contracts: assetAddrs.map(a => ({
        address: AAVE_V3_POOL,
        abi: AAVE_GET_RESERVE_ABI,
        functionName: "getReserveData",
        args: [queryAddress(a)],
      })),
      allowFailure: true,
    })

    const seenATokens = new Set<string>() // Deduplication: ETH/WETH share the same aToken
    const supplyCalls: Array<{ aToken: `0x${string}`; underlying: `0x${string}`; symbol: string }> = []
    const debtCalls: Array<{ dToken: `0x${string}`; underlying: `0x${string}`; symbol: string }> = []
    for (let i = 0; i < assetAddrs.length; i++) {
      const r = reserveResults[i]
      if (r.status !== 'success') continue
      const data = r.result as any
      const aToken = data[8] as string
      const debtToken = data[10] as string
      const underlying = getAddress(assetAddrs[i])
      const symbol = AAVE_ASSET_SYMBOLS[assetAddrs[i].toLowerCase()] || assetAddrs[i].slice(0, 6)
      if (aToken && aToken !== ZERO && !seenATokens.has(aToken.toLowerCase())) {
        seenATokens.add(aToken.toLowerCase())
        supplyCalls.push({ aToken: getAddress(aToken), underlying, symbol })
      }
      if (debtToken && debtToken !== ZERO) {
        debtCalls.push({ dToken: getAddress(debtToken), underlying, symbol })
      }
    }

    const allCalls = [
      ...supplyCalls.map(c => ({ address: c.aToken, abi: ERC20_ABI, functionName: "balanceOf" as const, args: [account] as [`0x${string}`] })),
      ...debtCalls.map(c => ({ address: c.dToken, abi: ERC20_ABI, functionName: "balanceOf" as const, args: [account] as [`0x${string}`] })),
    ]
    const bals = await multicall(publicClient, { contracts: allCalls, allowFailure: true })

    const supplied: Array<{ poolId: string; protocolId: string; protocol: string; asset: string; assetAddress: string; collateral: boolean }> = []
    const borrowed: Array<{ poolId: string; protocolId: string; protocol: string; asset: string; assetAddress: string }> = []

    // Aave's ETH market is backed by the WETH reserve too; display any WETH row as ETH
    // (usually a no-op — the ETH placeholder entry already yields 'ETH' — kept for parity).
    const displaySymbol = (s: string) => (s === 'WETH' ? 'ETH' : s)

    for (let i = 0; i < supplyCalls.length; i++) {
      if (bals[i]?.status === 'success' && (bals[i].result as bigint) > 0n) {
        supplied.push({ poolId: 'aave', protocolId: 'aave', protocol: 'aave', asset: displaySymbol(supplyCalls[i].symbol), assetAddress: supplyCalls[i].underlying, collateral: true })
      }
    }
    for (let i = 0; i < debtCalls.length; i++) {
      const balIdx = supplyCalls.length + i
      if (bals[balIdx]?.status === 'success' && (bals[balIdx].result as bigint) > 0n) {
        borrowed.push({ poolId: 'aave', protocolId: 'aave', protocol: 'aave', asset: displaySymbol(debtCalls[i].symbol), assetAddress: debtCalls[i].underlying })
      }
    }
    return { supplied, borrowed }
  },

  async getMarketData(): Promise<PoolRateInfo[]> {
    // The main data source is Aave official GraphQL API (real-time APY + pool total + risk parameter);
    // When the risk parameter is missing, it is decoded by getReserveData on the chain (the same caliber as the official app).
    // Failure returns an empty array, '-' is displayed by the front-end, and APY does not do on-chain mixing.
    return (await fetchAaveGraphqlMarketData()) ?? []
  }
}
