// src/chain/lending/sparklend.ts
//
// SparkLend = Aave V3 fork
// supply/withdraw directly via Pool contract (Lending product line)
// Savings product line (spToken) implemented in a standalone module (todo)

import { encodeFunctionData, getAddress, maxUint256 } from "viem"
import { multicall } from "viem/actions"
import { publicClient } from "../core/provider"
import { sendTx, sendTxAndWait } from "../core/tx"
import { ADDRESSES } from "../evm/addresses"
import { AAVE_POOL_ABI, WETH_ABI, WETH_GATEWAY_ABI, ERC20_ABI } from "../evm/abis"
import type { LendingAdapter, PoolRateInfo } from "./base"

const pool = getAddress(ADDRESSES.lending.sparklend.pool)
const WETH = getAddress(ADDRESSES.tokens.WETH)
const WETH_GATEWAY = getAddress(ADDRESSES.lending.sparklend.WETH_GATEWAY)
// WETH variableDebtToken — Spark stores Aave-V3 credit delegation on the debt token:
// approveDelegation / borrowAllowance both live here (pool.getReserveData(WETH)[10]).
// Matches the official app's "Approve delegation ETH" step.
const WETH_VARIABLE_DEBT = getAddress("0x2e7576042566f8D6990e07A1B61Ad1efd86Ae70d")

// SparkLend credit-delegation ABI (WETH variableDebtToken)
const VARIABLE_DEBT_ABI = [
  {
    name: "approveDelegation",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "delegatee", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: []
  },
  {
    name: "borrowAllowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "fromUser", type: "address" },
      { name: "toUser", type: "address" }
    ],
    outputs: [{ type: "uint256" }]
  }
] as const

const ETH_PLACEHOLDER = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
const USDC_ADDRESS = ADDRESSES.tokens.USDC
const USDT_ADDRESS = ADDRESSES.tokens.USDT
const WSTETH_ADDRESS = getAddress(ADDRESSES.tokens.wstETH)

// Pool.getReserveData ABI — Query variableDebtToken address
const POOL_RESERVE_DATA_ABI = [
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
        { type: "address" },  // 8: aTokenAddress
        { type: "address" },  // 9: stableDebtTokenAddress
        { type: "address" },  // 10: variableDebtTokenAddress What ← we want
        { type: "address" },  // 11: interestRateStrategyAddress
        { type: "uint128" },  // 12: accruedToTreasury
        { type: "uint128" },  // 13: unbacked
        { type: "uint128" },  // 14: isolationModeTotalDebt
      ]
    }]
  }
] as const

// WETH withdraw ABI (unwrap WETH to ETH)
const WETH_WITHDRAW_ABI = [
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "wad", type: "uint256" }],
    outputs: []
  }
] as const

function isETH(asset: string): boolean {
  return asset.toLowerCase() === ETH_PLACEHOLDER.toLowerCase()
}

function isWETH(asset: string): boolean {
  return asset.toLowerCase() === WETH.toLowerCase()
}

// Get aToken address
function getATokenAddress(asset?: string): string | null {
  if (!asset) return null
  const a = asset.toLowerCase()
  const eth = ETH_PLACEHOLDER.toLowerCase()
  const weth = ADDRESSES.tokens.WETH.toLowerCase()
  const usdc = USDC_ADDRESS.toLowerCase()
  const usdt = USDT_ADDRESS.toLowerCase()
  const wbtc = ADDRESSES.tokens.WBTC.toLowerCase()
  const wsteth = WSTETH_ADDRESS.toLowerCase()

  if (a === eth || a === weth) return ADDRESSES.lending.sparklend.aWETH
  if (a === usdc) return ADDRESSES.lending.sparklend.aUSDC
  if (a === usdt) return ADDRESSES.lending.sparklend.aUSDT
  if (a === wbtc) return ADDRESSES.lending.sparklend.aWBTC
  if (a === wsteth) return ADDRESSES.lending.sparklend.aWstETH
  return null
}

/**
 * SparkLend adapter
 * supply/withdraw walk Pool contract (AAVE_pool_ABI), use aToken
 * ETH via weth_gateway one-stop wrap + supply/withdraw + unwrap
 * * Note: SparkLend also has a set of Savings products (spToken), different from this Lending module
 */
export const sparklend: LendingAdapter & {
  wrapETH?: (amount: bigint, account: string) => Promise<string>
  unwrapWETH?: (wad: bigint, account: string) => Promise<string>
  borrowETH?: (amount: bigint, account: string) => Promise<string>
} = {
  // wrapETH reserved for front-end use (ETH → WETH)
  async wrapETH(amount, account) {
    if (!account) throw new Error("Account is required")

    const wrapData = encodeFunctionData({
      abi: WETH_ABI,
      functionName: "deposit",
      args: []
    })

    return sendTx({
      to: WETH,
      data: wrapData,
      value: amount,
      account: getAddress(account)
    })
  },

  // supply walk Pool contract
  async supply(token, amount, account) {
    if (!account) throw new Error("Account is required")

    const owner = getAddress(account)

    // ETH: One-stop wrap + supply via weth_gateway
    // Note: The front-end deposit.vue went to ETH first wrapETH → approve → supply (weth)
    // So when we get here, the token is already a WETH address.
    if (isETH(token)) {
      const data = encodeFunctionData({
        abi: WETH_GATEWAY_ABI,
        functionName: "depositETH",
        args: [pool, owner, 0]
      })


      return sendTx({ to: WETH_GATEWAY, data, value: amount, account: owner })
    }

    // Other Assets (USDC/USDT/WETH) Directly Pool.supply
    const data = encodeFunctionData({
      abi: AAVE_POOL_ABI,
      functionName: "supply",
      args: [getAddress(token), amount, owner, 0]
    })


    return sendTx({ to: pool, data, account: owner })
  },

  // withdraw walk pool contract
  // ETH/weth → WETH_Gateway.withdrawETH (pulls approved spWETH, unwraps to native ETH).
  // Two-step, matches official Spark: approve spWETH → WETH_GATEWAY first, then withdrawETH.
  // Other assets → Pool.withdraw directly
  async withdraw(token, amount, account) {
    if (!account) throw new Error("Account is required")

    const owner = getAddress(account)
    // ETH/WETH → withdrawETH delivers native ETH (official Spark two-step: approve spWETH → withdrawETH)
    if (isETH(token) || isWETH(token)) {
      const data = encodeFunctionData({
        abi: WETH_GATEWAY_ABI,
        functionName: "withdrawETH",
        args: [pool, amount, owner]
      })
      return sendTx({ to: WETH_GATEWAY, data, account: owner })
    }

    const data = encodeFunctionData({
      abi: AAVE_POOL_ABI,
      functionName: "withdraw",
      args: [getAddress(token), amount, owner]
    })


    return sendTx({ to: pool, data, account: owner })
  },

  // ETH unwrap: weth → ETH (reserved for front-end use)
  async unwrapWETH(wad, account) {
    if (!account) throw new Error("Account is required")

    const data = encodeFunctionData({
      abi: WETH_WITHDRAW_ABI,
      functionName: "withdraw",
      args: [wad]
    })

    return sendTx({ to: WETH, data, account: getAddress(account) })
  },

  // Borrow ETH/WETH via official Spark two-step: approveDelegation on the WETH
  // variableDebtToken (delegate the WETHGateway), then WETHGateway.borrowETH —
  // which borrows WETH on-chain and unwraps it to native ETH, so the resulting
  // Spark debt position is WETH (Spark has no native ETH reserve).
  // Non-ETH assets borrow directly via Pool.borrow (self-borrow, no delegation).
  async borrow(token, amount, account) {
    if (!account) throw new Error("Account is required")

    const owner = getAddress(account)

    if (isETH(token) || isWETH(token)) {
      return this.borrowETH!(amount, owner)
    }

    const data = encodeFunctionData({
      abi: AAVE_POOL_ABI,
      functionName: "borrow",
      args: [getAddress(token), amount, BigInt(2), 0, owner] // 2 = variable rate
    })

    return sendTx({ to: pool, data, account: owner })
  },

  // Two-step borrowETH (matches official app's "Approve delegation ETH" → "Borrow ETH"):
  // step 1 approveDelegation(WETHGateway) on the WETH variableDebtToken (only if the
  // existing delegation < amount — delegation is a persistent, non-additive allowance),
  // step 2 borrowETH(pool, amount, 2, 128) on the WETHGateway (returns native ETH).
  async borrowETH(amount, account) {
    if (!account) throw new Error("Account is required")

    const owner = getAddress(account)
    const gateway = WETH_GATEWAY

    // Step 1: ensure the gateway may borrow WETH on our behalf.
    const current = await publicClient.readContract({
      address: WETH_VARIABLE_DEBT,
      abi: VARIABLE_DEBT_ABI,
      functionName: "borrowAllowance",
      args: [owner, gateway],
    }) as bigint

    if (current < amount) {
      const delegateData = encodeFunctionData({
        abi: VARIABLE_DEBT_ABI,
        functionName: "approveDelegation",
        args: [gateway, amount],
      })
      const { receipt } = await sendTxAndWait({
        to: WETH_VARIABLE_DEBT,
        data: delegateData,
        account: owner,
      })
      if (receipt.status !== 'success') throw new Error("Spark delegation approval failed")
    }

    // Step 2: borrow via gateway (borrows WETH, unwraps to native ETH).
    const borrowData = encodeFunctionData({
      abi: WETH_GATEWAY_ABI,
      functionName: "borrowETH",
      args: [pool, amount, 2n, 128], // 2 = variable rate, 128 = Spark referral code (matches official)
    })

    return sendTx({ to: gateway, data: borrowData, account: owner })
  },

  // ETH/WETH repay via official Spark flow: WETHGateway.repayETH is payable — the user
  // sends native ETH as value, the gateway wraps it to WETH and repays the WETH debt,
  // refunding any excess. Spark has no native ETH reserve, so the repaid position is WETH.
  async repay(token, amount, account) {
    if (!account) throw new Error("Account is required")

    const owner = getAddress(account)

    if (isETH(token) || isWETH(token)) {
      const data = encodeFunctionData({
        abi: WETH_GATEWAY_ABI,
        functionName: "repayETH",
        args: [pool, amount, 2n, owner], // 2 = variable rate; onBehalfOf = self
      })
      return sendTx({ to: WETH_GATEWAY, data, value: amount, account: owner })
    }

    const data = encodeFunctionData({
      abi: AAVE_POOL_ABI,
      functionName: "repay",
      args: [getAddress(token), amount, BigInt(2), owner]
    })

    return sendTx({ to: pool, data, account: owner })
  },

  async repayAll(asset, account) {
    if (!asset) throw new Error("Asset is required")
    const owner = getAddress(account)

    if (isETH(asset) || isWETH(asset)) {
      // Query the exact current WETH debt, then repay it all via the payable gateway.
      // Pass a CONCRETE amount (not maxUint256): Spark's repayETH interprets maxUint256 as
      // "repay the full outstanding debt" and then requires msg.value >= that full debt —
      // since the debt accrues between query and tx, value (queried debt) < full debt and it
      // reverts with "msg.value is less than repayment amount". With a concrete amount the
      // gateway repays exactly it, so value == amount always passes; any tiny interest accrual
      // between query and tx leaves at most negligible dust rather than failing.
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
        abi: WETH_GATEWAY_ABI,
        functionName: "repayETH",
        args: [pool, repayAmount, 2n, owner],
      })
      return sendTx({ to: WETH_GATEWAY, data, value: repayAmount, account: owner })
    }

    const data = encodeFunctionData({
      abi: AAVE_POOL_ABI,
      functionName: "repay",
      args: [getAddress(asset), maxUint256, BigInt(2), owner]
    })
    return sendTx({ to: pool, data, account: owner })
  },

  async setCollateral(token, enable, account) {
    const data = encodeFunctionData({
      abi: AAVE_POOL_ABI,
      functionName: "setUserUseReserveAsCollateral",
      args: [getAddress(token), enable]
    })

    return sendTx({ to: pool, data, account: account ? getAddress(account) : undefined })
  },

  async getSupplyBalance(account: `0x${string}`, asset?: string) {
    // Query single aToken balance
    const aTokenAddress = getATokenAddress(asset)
    if (aTokenAddress) {
      const balance = await publicClient.readContract({
        address: getAddress(aTokenAddress),
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [getAddress(account)]
      }) as bigint
      return balance
    }

    // fallback: Query Total Mortgage Value
    const result = await publicClient.readContract({
      address: pool,
      abi: AAVE_POOL_ABI,
      functionName: "getUserAccountData",
      args: [getAddress(account)]
    })

    return result[0] // totalCollateralBase
  },

  async getBorrowBalance(account: `0x${string}`, _asset?: string) {
    const result = await publicClient.readContract({
      address: pool,
      abi: AAVE_POOL_ABI,
      functionName: "getUserAccountData",
      args: [getAddress(account)]
    })

    return result[1] // totalDebtBase
  },

  async getHealthSnapshot(account: `0x${string}`) {
    try {
      const result = await publicClient.readContract({
        address: pool,
        abi: AAVE_POOL_ABI,
        functionName: "getUserAccountData",
        args: [getAddress(account)],
      })
      // Same return layout as Aave V3 (account-level).
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
      console.warn('[SparkLend] getHealthSnapshot failed:', e)
      return undefined
    }
  },

  async getAvailableBorrows(account: `0x${string}`) {
    const accountData = await publicClient.readContract({
      address: pool,
      abi: AAVE_POOL_ABI,
      functionName: "getUserAccountData",
      args: [getAddress(account)]
    })

    // SparkLend is homologous to Aave V3: base currency = USD in 1e8 (8 decimal places).
    // Transfer to USD cents: availableBase × 100/1e8 (=/1e6), no longer multiplied by the ETH price.
    const availableBase = accountData[2] as bigint // availableBorrowsBase
    if (availableBase <= 0n) return 0n
    return availableBase * 100n / 10n ** 8n
  },

  async getBorrowBalances(account: `0x${string}`): Promise<Map<string, bigint>> {
    const result = new Map<string, bigint>()
    const assetAddresses = [
      USDC_ADDRESS,
      USDT_ADDRESS,
      WETH,
      getAddress(ADDRESSES.tokens.WBTC),
      WSTETH_ADDRESS,
    ]

    try {
      // Step 1: reserveData for all assets multicall at once
      const reserveResults = await multicall(publicClient, {
        contracts: assetAddresses.map(addr => ({
          address: pool,
          abi: POOL_RESERVE_DATA_ABI,
          functionName: "getReserveData",
          args: [getAddress(addr)],
        })),
        allowFailure: true,
      })

      // Step 2: BalanceOf for all variableDebtTokens multicall at once
      const debtCalls: Array<{ address: `0x${string}`; abi: typeof ERC20_ABI; functionName: "balanceOf"; args: [`0x${string}`] }> = []
      const meta: Array<{ addr: string }> = []
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
        meta.push({ addr: assetAddresses[i] })
      }

      if (debtCalls.length > 0) {
        const debtResults = await multicall(publicClient, { contracts: debtCalls, allowFailure: true })
        for (let i = 0; i < meta.length; i++) {
          const r = debtResults[i]
          if (r.status === 'success' && (r.result as bigint) > 0n) {
            result.set(getAddress(meta[i].addr), r.result as bigint)
          }
        }
      }
    } catch (e) {
      console.warn('[SparkLend] getBorrowBalances failed:', e)
    }

    return result
  },

  async getMarketData(): Promise<PoolRateInfo[]> {
    const RAY = 1_000_000_000_000_000_000_000_000_000n // 1e27
    const SECONDS_PER_YEAR = 31_536_000n
    const assetAddresses = [
      USDC_ADDRESS,
      USDT_ADDRESS,
      WETH,
      getAddress(ADDRESSES.tokens.WBTC),
      WSTETH_ADDRESS,
    ]

    // Round 1: getReserveData for all assets
    const reserveResults = await multicall(publicClient, {
      contracts: assetAddresses.map(addr => ({
        address: pool,
        abi: POOL_RESERVE_DATA_ABI,
        functionName: "getReserveData",
        args: [getAddress(addr)],
      })),
      allowFailure: true,
    })

    // Collect aToken + debtToken addresses for totalSupply query
    const tokenTotalSupplyCalls: Array<{ address: `0x${string}`; abi: typeof ERC20_ABI; functionName: "balanceOf" | "totalSupply"; args: any[] }> = []
    for (let i = 0; i < assetAddresses.length; i++) {
      const r = reserveResults[i]
      if (r.status !== 'success') continue
      const data = r.result as any
      const aTokenAddr = data[8] as `0x${string}`
      if (aTokenAddr && aTokenAddr !== '0x0000000000000000000000000000000000000000') {
        tokenTotalSupplyCalls.push({ address: aTokenAddr, abi: ERC20_ABI, functionName: "totalSupply", args: [] })
      }
      const debtAddr = data[10] as `0x${string}`
      if (debtAddr && debtAddr !== '0x0000000000000000000000000000000000000000') {
        tokenTotalSupplyCalls.push({ address: debtAddr, abi: ERC20_ABI, functionName: "totalSupply", args: [] })
      }
    }

    // Round 2: totalSupply for aTokens + debtTokens
    let supplyResults: any[] = []
    if (tokenTotalSupplyCalls.length > 0) {
      supplyResults = await multicall(publicClient, {
        contracts: tokenTotalSupplyCalls,
        allowFailure: true,
      }) as any[]
    }

    const result: PoolRateInfo[] = []
    let supplyIdx = 0
    for (let i = 0; i < assetAddresses.length; i++) {
      const r = reserveResults[i]
      if (r.status !== 'success') continue
      const data = r.result as any[]

      const liquidityRate = data[2] as bigint   // currentLiquidityRate (ray, annualized)
      const variableBorrowRate = data[4] as bigint

      // Risk Parameter: Decodes the ReserveConfigurationMap bitmap (data [0]) returned from getReserveData.
      // Aave V3 bitmap: LTV = bits 0-15, LiquidationThreshold = bits 16-31, LiquidationBonus = bits 32-47 (all bps).
      // Same getReserveData call as APY without additional RPC. Non-collateralized assets (e.g. USDC/USDT for pure borrowing) LTV/Threshold = 0 is correct.
      const cfg = data[0] as bigint
      const ltvBps = (cfg >> 0n) & 0xFFFFn
      const ltBps = (cfg >> 16n) & 0xFFFFn
      const bonusBps = (cfg >> 32n) & 0xFFFFn
      const maxLtv = ltvBps > 0n ? Number(ltvBps) / 100 : undefined
      const liquidationThreshold = ltBps > 0n ? Number(ltBps) / 100 : undefined
      const liquidationPenalty = bonusBps > 0n ? (Number(bonusBps) - 10000) / 100 : undefined

      // On-chain currentLiquidityRate/currentVariableBorrowRate is the linear annualized rate (Apr, Ray).
      // The official app shows APYs compounded by seconds: APY = (1 + Apr/secondsPerYear) ^ secondsPerYear - 1
      // (Aave/SparkLend front-end math-utils same formula; direct use of ray/1e25 will reduce ~0.1pp)
      const supplyAPR = Number(liquidityRate) / Number(RAY)
      const borrowAPR = Number(variableBorrowRate) / Number(RAY)
      const supplyAPY = (Math.pow(1 + supplyAPR / Number(SECONDS_PER_YEAR), Number(SECONDS_PER_YEAR)) - 1) * 100
      const borrowAPY = (Math.pow(1 + borrowAPR / Number(SECONDS_PER_YEAR), Number(SECONDS_PER_YEAR)) - 1) * 100

      let totalSupply = 0n
      let totalBorrow = 0n
      if (supplyIdx < supplyResults.length && supplyResults[supplyIdx]?.status === 'success') {
        totalSupply = supplyResults[supplyIdx].result as bigint
      }
      supplyIdx++
      if (supplyIdx < supplyResults.length && supplyResults[supplyIdx]?.status === 'success') {
        totalBorrow = supplyResults[supplyIdx].result as bigint
      }
      supplyIdx++

      result.push({
        assetAddress: getAddress(assetAddresses[i]).toLowerCase(),
        supplyAPY,
        borrowAPY,
        totalSupply,
        totalBorrow,
        maxLtv,
        liquidationThreshold,
        liquidationPenalty,
      })
    }

    return result
  },

  async discoverPositions(account: `0x${string}`) {
    const ZERO = '0x0000000000000000000000000000000000000000'
    const SPARKLEND_ASSET_SYMBOLS: Record<string, string> = {
      [ADDRESSES.tokens.USDC.toLowerCase()]: 'USDC',
      [ADDRESSES.tokens.USDT.toLowerCase()]: 'USDT',
      [ADDRESSES.tokens.WETH.toLowerCase()]: 'WETH',
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': 'ETH',
      [ADDRESSES.tokens.WBTC.toLowerCase()]: 'WBTC',
      [ADDRESSES.tokens.wstETH.toLowerCase()]: 'wstETH',
    }

    const assetAddrs = Object.keys(SPARKLEND_ASSET_SYMBOLS).map(a => getAddress(a))

    // Round 1: getReserveData for all assets → extract aToken[8] + debtToken[10]
    const reserveResults = await multicall(publicClient, {
      contracts: assetAddrs.map(a => ({
        address: pool,
        abi: POOL_RESERVE_DATA_ABI,
        functionName: "getReserveData",
        args: [a],
      })),
      allowFailure: true,
    })

    // Build balanceOf calls for all found aTokens + debtTokens.
    // Align every balance result back to its asset via an explicit key (addr + ':a' / ':d')
    // instead of a positional cursor: SparkLend has no native ETH reserve, so
    // getReserveData(0xeeeE…) succeeds with a zero aToken/debtToken and pushes no balance
    // calls — a flat index cursor over `bals` then drifts by 2 after ETH and misattributes
    // (e.g. aWBTC's balance read for WBTC becomes 0, while the phantom ETH row shows it).
    const calls: Array<{ address: `0x${string}`; abi: typeof ERC20_ABI; functionName: "balanceOf"; args: [`0x${string}`] }> = []
    const callKeys: string[] = []
    const meta: Array<{ addr: `0x${string}`; symbol: string }> = []
    for (let i = 0; i < assetAddrs.length; i++) {
      const r = reserveResults[i]
      if (r.status !== 'success') continue
      const data = r.result as any
      const aToken = data[8] as string
      const debtToken = data[10] as string
      const lowerAddr = assetAddrs[i].toLowerCase()
      meta.push({ addr: assetAddrs[i], symbol: SPARKLEND_ASSET_SYMBOLS[lowerAddr] || lowerAddr.slice(0, 6) })
      if (aToken && aToken !== ZERO) {
        callKeys.push(assetAddrs[i].toLowerCase() + ':a')
        calls.push({ address: getAddress(aToken), abi: ERC20_ABI, functionName: "balanceOf", args: [account] })
      }
      if (debtToken && debtToken !== ZERO) {
        callKeys.push(assetAddrs[i].toLowerCase() + ':d')
        calls.push({ address: getAddress(debtToken), abi: ERC20_ABI, functionName: "balanceOf", args: [account] })
      }
    }

    // Round 2: balanceOf all aTokens + debtTokens
    const bals = await multicall(publicClient, { contracts: calls, allowFailure: true })
    const balOf = (key: string): bigint => {
      const i = callKeys.indexOf(key)
      return i >= 0 && bals[i]?.status === 'success' ? (bals[i].result as bigint) : 0n
    }

    // SparkLend's ETH market is backed by the WETH reserve (no native ETH reserve), so a WETH
    // supply/borrow is the user's ETH position. Display it as ETH; keep assetAddress as WETH so
    // on-chain reads (aToken, debt token, price, APY, repay) keep resolving correctly.
    const displaySymbol = (s: string) => (s === 'WETH' ? 'ETH' : s)

    const supplied: Array<{
      poolId: string; protocolId: string; protocol: string
      asset: string; assetAddress: string; collateral: boolean
    }> = []
    const borrowed: Array<{
      poolId: string; protocolId: string; protocol: string
      asset: string; assetAddress: string
    }> = []
    for (const m of meta) {
      if (balOf(m.addr.toLowerCase() + ':a') > 0n) {
        supplied.push({ poolId: 'sparklend', protocolId: 'sparklend', protocol: 'sparklend', asset: displaySymbol(m.symbol), assetAddress: getAddress(m.addr), collateral: true })
      }
      if (balOf(m.addr.toLowerCase() + ':d') > 0n) {
        borrowed.push({ poolId: 'sparklend', protocolId: 'sparklend', protocol: 'sparklend', asset: displaySymbol(m.symbol), assetAddress: getAddress(m.addr) })
      }
    }

    return { supplied, borrowed }
  }
}
