// src/chain/lending/compound.ts
// Compound V2 + V3 adapter

import { encodeFunctionData, getAddress, encodeAbiParameters, maxUint256 } from "viem"
import { multicall } from "viem/actions"
import { publicClient } from "../core/provider"
import { sendTx } from "../core/tx"
import { ADDRESSES } from "../evm/addresses"
import { ERC20_ABI } from "../evm/abis"
import type { LendingAdapter, PoolRateInfo } from "./base"

const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
const WETH = ADDRESSES.tokens.WETH

// Token symbol mapping (used to populate the asset name when a position is found on the chain)
const TOKEN_SYMBOLS: Record<string, string> = {
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': 'ETH',
  [ADDRESSES.tokens.WETH.toLowerCase()]: 'WETH',
  [ADDRESSES.tokens.USDC.toLowerCase()]: 'USDC',
  [ADDRESSES.tokens.USDT.toLowerCase()]: 'USDT',
  [ADDRESSES.tokens.WBTC.toLowerCase()]: 'WBTC',
  [ADDRESSES.tokens.wstETH.toLowerCase()]: 'wstETH',
  '0xc00e94cb662c3520282e6f5717214004a7f26888': 'COMP',
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 'UNI',
  '0x514910771af9ca656af840dff83e8264ecf986ca': 'LINK',
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 'cbBTC',
  '0x18084fba666a33d37592fa2633fd49a74dd93a88': 'tBTC',
  '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee': 'weETH',
  '0x15700b564ca08d9439c58ca5053166e8317aa138': 'USDC.e',
  '0xa1290d69c65a6fe4df752f95823fae25cb99e5a7': 'rsETH',
  '0x4c9edd5852cd905f086c759e8383e09bff1e68b3': 'USDS',
}

// PoolId → Comet Address Mapping
const POOL_TO_COMET: Record<string, string> = {
  'compound-eth': ADDRESSES.lending.compound.cometWETH,
  'compound-usdc': ADDRESSES.lending.compound.cometUSDC,
  'compound-usdt': ADDRESSES.lending.compound.cometUSDT,
  'compound-wbtc': ADDRESSES.lending.compound.cometWBTC,
}

// Comet → Base token address mapping.
// Compound V3 only treats amount == maxUint256 as "withdraw all" for the BASE token;
// collateral assets must pass the exact live balance (max reverts on safe128).
const COMET_BASE_TOKENS: Record<string, string> = {
  [ADDRESSES.lending.compound.cometWETH.toLowerCase()]: ADDRESSES.tokens.WETH.toLowerCase(),
  [ADDRESSES.lending.compound.cometUSDC.toLowerCase()]: ADDRESSES.tokens.USDC.toLowerCase(),
  [ADDRESSES.lending.compound.cometUSDT.toLowerCase()]: ADDRESSES.tokens.USDT.toLowerCase(),
  [ADDRESSES.lending.compound.cometWBTC.toLowerCase()]: ADDRESSES.tokens.WBTC.toLowerCase(),
}

// Comet → Address PoolId Reverse Mapping
const COMET_TO_POOL: Record<string, string> = {}
for (const [poolId, addr] of Object.entries(POOL_TO_COMET)) {
  COMET_TO_POOL[addr.toLowerCase()] = poolId
}
COMET_TO_POOL[ADDRESSES.lending.compound.cometWBTC.toLowerCase()] = 'compound-wbtc'

// Main collateral assets for each Comet pool (for LTV/Threshold/Penalty on the Borrow page):
// Compound V3 poolless LTV, official display factor by collateral assets; here, the chain factor of the main collateral of each pool is taken
// (compound-usdc/usdt main mortgage WBTC; compound-eth main mortgage wstETH)
const COMET_PRIMARY_COLLATERAL: Record<string, string> = {
  [ADDRESSES.lending.compound.cometWETH.toLowerCase()]: ADDRESSES.tokens.wstETH.toLowerCase(), // wstETH
  [ADDRESSES.lending.compound.cometUSDC.toLowerCase()]: ADDRESSES.tokens.WBTC.toLowerCase(), // WBTC
  [ADDRESSES.lending.compound.cometUSDT.toLowerCase()]: ADDRESSES.tokens.WBTC.toLowerCase(), // WBTC
}

// ==================== Compound V3 (Comet) ====================

// Compound V3 Comet contract address mapping (use lowercase for key)
const COMETS: Record<string, string> = {
  // USDC
  [ADDRESSES.tokens.USDC.toLowerCase()]: ADDRESSES.lending.compound.cometUSDC,
  // USDT
  [ADDRESSES.tokens.USDT.toLowerCase()]: ADDRESSES.lending.compound.cometUSDT,
  // WETH
  [ADDRESSES.tokens.WETH.toLowerCase()]: ADDRESSES.lending.compound.cometWETH,
  // ETH -> WETH comet
  [ETH_ADDRESS.toLowerCase()]: ADDRESSES.lending.compound.cometWETH,
  // WBTC
  [ADDRESSES.tokens.WBTC.toLowerCase()]: ADDRESSES.lending.compound.cometWBTC,
  // wstETH - > WETH comet (wstETH can only enter the WETH pool)
  [ADDRESSES.tokens.wstETH.toLowerCase()]: ADDRESSES.lending.compound.cometWETH,
}

// Reverse index of comets values — used to identify comet addresses
const COMET_ADDRESSES = new Set(Object.values(COMETS).map(a => a.toLowerCase()))

// Compound V3 Comet ABI
const COMET_ABI = [
  // supply(address asset, uint256 amount)
  { name: "supply", type: "function", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  // withdraw(address asset, uint256 amount)
  { name: "withdraw", type: "function", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  // borrow(address asset, uint256 amount)
  { name: "borrow", type: "function", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  // repay(address asset, uint256 amount)
  { name: "repay", type: "function", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  // balanceOf(address account)
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  // borrowBalanceOf(address account)
  { name: "borrowBalanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  // allow(address manager, bool isAllowed) - for WETH comet
  { name: "allow", type: "function", inputs: [{ type: "address" }, { type: "bool" }], outputs: [] },
  // isAllowed(address manager, address account) - check if allowed
  { name: "isAllowed", type: "function", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "bool" }] }
] as const

// Compound WETH Comet Manager ABI (for invoke)
// invoke(bytes32[] actions, bytes[] data)
const MANAGER_ABI = [
  {
    name: "invoke",
    type: "function",
    inputs: [
      { type: "bytes32[]", name: "actions" },
      { type: "bytes[]", name: "data" }
    ],
    outputs: []
  }
] as const

// Action identifier for supply native token (ASCII string encoded to bytes32)
// "action_supply_native_token" (Note the underscore!) - > 0x414354494f4e5f535550504c595f4e41544956455f544f4b454e...
const ACTION_SUPPLY_NATIVE_TOKEN: `0x${string}` = "0x414354494f4e5f535550504c595f4e41544956455f544f4b454e000000000000"
const ACTION_WITHDRAW_NATIVE_TOKEN: `0x${string}` = "0x414354494f4e5f57495448445241575f4e41544956455f544f4b454e00000000"

// ==================== Compound V3 Extended View ABI (getAvailableBorrows) ====================

const COMET_VIEW_ABI = [
  // Basic View Function — User Balance Query
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "borrowBalanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  // Market information inquiry
  { name: "baseToken", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "numAssets", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  // Protocol minimum borrow position size (governance-set). Initial borrow must be ≥ this, else BorrowTooSmall reverts.
  { name: "baseBorrowMin", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    name: "getAssetInfo", type: "function", stateMutability: "view", inputs: [{ name: "i", type: "uint8" }], outputs: [
      { name: "offset", type: "uint8" },
      { name: "asset", type: "address" },
      { name: "priceFeed", type: "address" },
      { name: "scale", type: "uint64" },
      { name: "borrowCollateralFactor", type: "uint64" },
      { name: "liquidateCollateralFactor", type: "uint64" },
      { name: "liquidationFactor", type: "uint64" },
      { name: "supplyCap", type: "uint256" },
    ]
  },
  {
    name: "getAssetInfoByAddress", type: "function", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [
      { name: "offset", type: "uint8" },
      { name: "asset", type: "address" },
      { name: "priceFeed", type: "address" },
      { name: "scale", type: "uint64" },
      { name: "borrowCollateralFactor", type: "uint64" },
      { name: "liquidateCollateralFactor", type: "uint64" },
      { name: "liquidationFactor", type: "uint64" },
      { name: "supplyCap", type: "uint256" },
    ]
  },
  { name: "collateralBalanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "asset", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "getPrice", type: "function", stateMutability: "view", inputs: [{ name: "priceFeed", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "totalBorrow", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "getSupplyRate", type: "function", stateMutability: "view", inputs: [{ name: "utilization", type: "uint256" }], outputs: [{ name: "", type: "uint64" }] },
  { name: "getBorrowRate", type: "function", stateMutability: "view", inputs: [{ name: "utilization", type: "uint256" }], outputs: [{ name: "", type: "uint64" }] },
] as const

// Chainlink latestRoundData ABI
const CHAINLINK_ABI = [{
  name: "latestRoundData",
  type: "function",
  stateMutability: "view",
  inputs: [],
  outputs: [
    { name: "roundId", type: "uint80" },
    { name: "answer", type: "int256" },
    { name: "startedAt", type: "uint256" },
    { name: "updatedAt", type: "uint256" },
    { name: "answeredInRound", type: "uint80" },
  ],
}] as const

// wstETH stEthPerToken ABI — reads the wstETH stETH→ exchange rate directly, no longer relying on Comet's priceFeed
const WSTETH_ADDRESS = ADDRESSES.tokens.wstETH
const WSTETH_ABI = [{
  name: "stEthPerToken",
  type: "function",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "uint256" }],
}] as const

const ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"
const BTC_USD_FEED = "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c"
const FACTOR_SCALE = 1000000000000000000n   // 1e18 — Compound v3 factor scale
const USD_8_DECIMALS = 100000000n           // 1e8

// Alchemy Request Throttling — Avoid too many requests
const MIN_DELAY_MS = 50
let lastCall = 0
async function throttle() {
  const now = Date.now()
  const elapsed = now - lastCall
  if (elapsed < MIN_DELAY_MS) {
    await new Promise(r => setTimeout(r, MIN_DELAY_MS - elapsed))
  }
  lastCall = Date.now()
}

async function getTokenBaseUSDPrice(token: `0x${string}`): Promise<{ price: bigint; decimals: number }> {
  const normalized = token.toLowerCase()
  const usdc = ADDRESSES.tokens.USDC.toLowerCase()
  const usdt = ADDRESSES.tokens.USDT.toLowerCase()
  const wbtc = ADDRESSES.tokens.WBTC.toLowerCase()

  if (normalized === usdc || normalized === usdt) {
    return { price: USD_8_DECIMALS, decimals: 6 }  // stablecoin ≈ $1
  }
  if (normalized === WETH.toLowerCase() || normalized === ETH_ADDRESS.toLowerCase()) {
    const result = await publicClient.readContract({
      address: ETH_USD_FEED as `0x${string}`,
      abi: CHAINLINK_ABI,
      functionName: "latestRoundData",
      args: [],
    })
    return { price: BigInt((result as any)[1]), decimals: 18 }
  }
  if (normalized === wbtc) {
    const result = await publicClient.readContract({
      address: BTC_USD_FEED as `0x${string}`,
      abi: CHAINLINK_ABI,
      functionName: "latestRoundData",
      args: [],
    })
    return { price: BigInt((result as any)[1]), decimals: 8 }
  }
  return { price: 0n, decimals: 18 }
}

export async function computeCometAvailableBorrow(cometAddress: string, account: `0x${string}`): Promise<bigint> {
  try {
    const addr = getAddress(cometAddress) as `0x${string}`
    const acct = getAddress(account) as `0x${string}`

    // Round 1: borrowBalanceOf, baseToken, numAssets (use comet_view_ABI uniformly to avoid cross-ABI encoding problems)
    const round1 = await multicall(publicClient, {
      contracts: [
        { address: addr, abi: COMET_VIEW_ABI, functionName: "borrowBalanceOf", args: [acct] },
        { address: addr, abi: COMET_VIEW_ABI, functionName: "baseToken", args: [] },
        { address: addr, abi: COMET_VIEW_ABI, functionName: "numAssets", args: [] },
      ],
      allowFailure: false,
    })
    const borrowRaw = round1[0] as bigint
    const baseTokenResult = round1[1] as `0x${string}`
    const numAssets = Number(round1[2])

    if (numAssets === 0) return 0n

    // Get base token price (8-decimal USD)
    const basePriceData = await getTokenBaseUSDPrice(baseTokenResult)
    if (basePriceData.price === 0n) return 0n

    // Round 2: getAssetInfo for all assets (batched)
    const assetInfos = await multicall(publicClient, {
      contracts: Array.from({ length: numAssets }, (_, i) => ({
        address: addr, abi: COMET_VIEW_ABI, functionName: "getAssetInfo", args: [i],
      })),
      allowFailure: false,
    }) as any[]

    // Round 3: collateralBalanceOf + price + token decimals — all in one multicall
    // wstETH: Read the wstETH stETH exchange rate (stETH→ ≈ ETH 1: 1) directly with stEthPerToken (), no longer relying on Comet's priceFeed
    // Other assets: Go Comet.getPrice (priceFeed)
    const round3 = await multicall(publicClient, {
      contracts: [
        // collateralBalanceOf for each asset (comet)
        ...assetInfos.map(info => ({ address: addr, abi: COMET_VIEW_ABI, functionName: "collateralBalanceOf", args: [acct, info[1] as `0x${string}`] })),
        // price for each asset
        ...assetInfos.map(info => {
          if ((info[1] as string).toLowerCase() === WSTETH_ADDRESS.toLowerCase()) {
            return { address: info[1] as `0x${string}`, abi: WSTETH_ABI, functionName: "stEthPerToken", args: [] }
          }
          return { address: addr, abi: COMET_VIEW_ABI, functionName: "getPrice", args: [info[2] as `0x${string}`] }
        }),
        // decimals for each ERC20 token
        ...assetInfos.map(info => ({ address: info[1] as `0x${string}`, abi: ERC20_ABI, functionName: "decimals", args: [] })),
      ],
      allowFailure: true,
    })

    // Calculate total borrowing power (baseToken units), directly compared to borrowRaw
    let totalBorrowPower = 0n
    for (let i = 0; i < numAssets; i++) {
      const collatResult = round3[i]
      const priceResult = round3[numAssets + i]
      const decimalsResult = round3[2 * numAssets + i]

      if (collatResult.status !== 'success') continue
      const collateral = collatResult.result as bigint
      if (collateral === 0n) continue
      if (priceResult.status !== 'success' || decimalsResult.status !== 'success') {
        continue
      }

      const tokenDecimals = Number(decimalsResult.result)
      const bcf = assetInfos[i][4] as bigint  // borrowCollateralFactor (1e18 scale)

      // Collateral value (unified in 8-decimal USD, consistent with borrowUSD8)
      // - Other assets: getPrice() returns the 8-decimal USD price → collateralValue is already 8-decimal USD
      // - wstETH: stEthPerToken() is an 18-dec exchange ratio (wstETH↔ETH), NOT a USD price. It yields the ETH-wei
      //   value of the collateral; multiply by the base (ETH) USD price to convert to 8-decimal USD.
      //   Without this the wstETH collateral is overcounted ~1e7× and the per-user borrowable shows a pool-level (huge) number.
      const isWstEth = (assetInfos[i][1] as string).toLowerCase() === WSTETH_ADDRESS.toLowerCase()
      const price = priceResult.result as bigint
      const collateralValue = isWstEth
        ? collateral * price / (10n ** BigInt(tokenDecimals)) * basePriceData.price / BigInt(10 ** basePriceData.decimals)
        : collateral * price / (10n ** BigInt(tokenDecimals))
      totalBorrowPower += collateralValue * bcf / FACTOR_SCALE
    }

    // Collateral totalBorrowPower is already 8-decimal USD (collateralValue = collateral × getPrice/10 ^ tokenDecimals).
    // borrowRaw is the number of baseTokens, convert to 8-decimal USD first and then compare to avoid the amount amplification caused by unit mixing.
    const borrowUSD8 = borrowRaw * basePriceData.price / BigInt(10 ** basePriceData.decimals)
    if (totalBorrowPower <= borrowUSD8) return 0n
    const availableUSD8 = totalBorrowPower - borrowUSD8

    // 8-decimal USD → cents (× 100/1e8), consistent with Aave availableBorrowsBase format
    return availableUSD8 * 100n / USD_8_DECIMALS
  } catch (e: any) {
    const detail = e?.cause?.reason || e?.cause?.message || e?.message || String(e)
    console.warn(`[Compound] computeCometAvailableBorrow failed for comet=${cometAddress}, account=${account}:`, detail, e)
    return 0n
  }
}

/** Compute a Comet-level health snapshot using liquidateCollateralFactor (not borrowCollateralFactor). */
async function computeCometHealthSnapshot(
  cometAddress: string,
  account: `0x${string}`,
): Promise<{ riskAdjustedCollateralUSD8: bigint; borrowUSD8: bigint; liquidationThresholdBps: number } | null> {
  try {
    const addr = getAddress(cometAddress) as `0x${string}`
    const acct = getAddress(account) as `0x${string}`

    const round1 = await multicall(publicClient, {
      contracts: [
        { address: addr, abi: COMET_VIEW_ABI, functionName: "borrowBalanceOf", args: [acct] },
        { address: addr, abi: COMET_VIEW_ABI, functionName: "baseToken", args: [] },
        { address: addr, abi: COMET_VIEW_ABI, functionName: "numAssets", args: [] },
      ],
      allowFailure: false,
    })
    const borrowRaw = round1[0] as bigint
    const baseTokenResult = round1[1] as `0x${string}`
    const numAssets = Number(round1[2])
    if (numAssets === 0) return null

    const basePriceData = await getTokenBaseUSDPrice(baseTokenResult)
    if (basePriceData.price === 0n) return null

    const assetInfos = await multicall(publicClient, {
      contracts: Array.from({ length: numAssets }, (_, i) => ({
        address: addr, abi: COMET_VIEW_ABI, functionName: "getAssetInfo", args: [i],
      })),
      allowFailure: false,
    }) as any[]

    const round3 = await multicall(publicClient, {
      contracts: [
        ...assetInfos.map(info => ({ address: addr, abi: COMET_VIEW_ABI, functionName: "collateralBalanceOf", args: [acct, info[1] as `0x${string}`] })),
        ...assetInfos.map(info => {
          if ((info[1] as string).toLowerCase() === WSTETH_ADDRESS.toLowerCase()) {
            return { address: info[1] as `0x${string}`, abi: WSTETH_ABI, functionName: "stEthPerToken", args: [] }
          }
          return { address: addr, abi: COMET_VIEW_ABI, functionName: "getPrice", args: [info[2] as `0x${string}`] }
        }),
        ...assetInfos.map(info => ({ address: info[1] as `0x${string}`, abi: ERC20_ABI, functionName: "decimals", args: [] })),
      ],
      allowFailure: true,
    })

    let riskAdjustedUSD8 = 0n
    let totalCollateralUSD8 = 0n
    for (let i = 0; i < numAssets; i++) {
      const collatResult = round3[i]
      const priceResult = round3[numAssets + i]
      const decimalsResult = round3[2 * numAssets + i]
      if (collatResult.status !== 'success') continue
      const collateral = collatResult.result as bigint
      if (collateral === 0n) continue
      if (priceResult.status !== 'success' || decimalsResult.status !== 'success') continue

      const tokenDecimals = Number(decimalsResult.result)
      const lcf = assetInfos[i][5] as bigint // liquidateCollateralFactor (1e18 scale)
      const isWstEth = (assetInfos[i][1] as string).toLowerCase() === WSTETH_ADDRESS.toLowerCase()
      const price = priceResult.result as bigint
      const collateralValue = isWstEth
        ? collateral * price / (10n ** BigInt(tokenDecimals)) * basePriceData.price / BigInt(10 ** basePriceData.decimals)
        : collateral * price / (10n ** BigInt(tokenDecimals))
      totalCollateralUSD8 += collateralValue
      riskAdjustedUSD8 += collateralValue * lcf / FACTOR_SCALE
    }

    const borrowUSD8 = borrowRaw * basePriceData.price / BigInt(10 ** basePriceData.decimals)

    let liquidationThresholdBps = 0
    if (totalCollateralUSD8 > 0n) {
      liquidationThresholdBps = Number(riskAdjustedUSD8 * 10000n / totalCollateralUSD8)
    } else {
      // No collateral yet: use the pool's primary collateral liquidation factor as a preview fallback.
      const primary = COMET_PRIMARY_COLLATERAL[addr.toLowerCase()]
      if (primary) {
        try {
          const info = await publicClient.readContract({
            address: addr,
            abi: COMET_VIEW_ABI,
            functionName: "getAssetInfoByAddress",
            args: [getAddress(primary)],
          }) as any[]
          const lcf = info[5] as bigint
          if (lcf > 0n) liquidationThresholdBps = Number(lcf) / 1e14
        } catch {
          // fall through with 0
        }
      }
    }

    return { riskAdjustedCollateralUSD8: riskAdjustedUSD8, borrowUSD8, liquidationThresholdBps }
  } catch (e) {
    console.warn(`[Compound] computeCometHealthSnapshot failed for comet=${cometAddress}:`, e)
    return null
  }
}

// ==================== Compound V2 (cToken) ====================

// Compound V2 cToken contract address mapping (key in lowercase, for V2-supported assets only)
const CTOKENS: Record<string, string> = {
  [ETH_ADDRESS.toLowerCase()]: ADDRESSES.lending.compound.cETH,
  [ADDRESSES.tokens.USDT.toLowerCase()]: ADDRESSES.lending.compound.cUSDT,
  [ADDRESSES.tokens.USDC.toLowerCase()]: ADDRESSES.lending.compound.cUSDC,
  [ADDRESSES.tokens.DAI.toLowerCase()]: ADDRESSES.lending.compound.cDAI,
  [ADDRESSES.tokens.WBTC.toLowerCase()]: ADDRESSES.lending.compound.cWBTC,
}

const V2_ABI = [
  { name: "mint", type: "function", inputs: [{ type: "uint256" }], outputs: [] },
  { name: "redeemUnderlying", type: "function", inputs: [{ type: "uint256" }], outputs: [] },
  { name: "borrow", type: "function", inputs: [{ type: "uint256" }], outputs: [] },
  { name: "repayBorrow", type: "function", inputs: [{ type: "uint256" }], outputs: [] },
  { name: "balanceOfUnderlying", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "borrowBalanceCurrent", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }
] as const

// ETH requires special handling (calling deposit instead of mint)
const V2_ETH_ABI = [
  { name: "deposit", type: "function", inputs: [], outputs: [], stateMutability: "payable" },
  { name: "redeemUnderlying", type: "function", inputs: [{ type: "uint256" }], outputs: [] },
  { name: "borrow", type: "function", inputs: [{ type: "uint256" }], outputs: [] },
  { name: "repayBorrow", type: "function", inputs: [{ type: "uint256" }], outputs: [] },
  { name: "balanceOfUnderlying", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "borrowBalanceCurrent", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }
] as const

// ==================== Helper functions ====================

const DEFAULT_COMET = ADDRESSES.lending.compound.cometUSDC
const DEFAULT_CTOKEN = ADDRESSES.lending.compound.cUSDC
// Factor is 1e18 precision (0.85 e18 = 85%), ÷ 1e16 rpm value
const FACTOR_PERCENT = 1e16

function getComet(tokenAddress: string): string | null {
  if (!tokenAddress) return null
  const addr = tokenAddress.toLowerCase()
  // If tokenAddress itself is a known comet address, return directly (supports caller to specify pool)
  if (COMET_ADDRESSES.has(addr)) return getAddress(tokenAddress)
  return COMETS[addr] || null
}

function getCToken(tokenAddress: string): string {
  if (!tokenAddress) return DEFAULT_CTOKEN
  const cToken = CTOKENS[getAddress(tokenAddress).toLowerCase()] || CTOKENS[tokenAddress.toLowerCase()]
  return cToken || DEFAULT_CTOKEN
}

function isETH(tokenAddress: string): boolean {
  return tokenAddress?.toLowerCase() === ETH_ADDRESS.toLowerCase()
}

function normalizeToken(tokenAddress: string): string {
  if (isETH(tokenAddress)) {
    return WETH
  }
  return tokenAddress
}

// Find the correct comet based on the user's position (ETH/WETH may exist in either comet)
async function findCometByCollateral(user: string, asset: string): Promise<string | null> {
  const target = asset.toLowerCase() === WETH.toLowerCase() ? WETH : asset
  for (const cometAddr of Object.values(POOL_TO_COMET)) {
    try {
      const balance = await publicClient.readContract({
        address: cometAddr as `0x${string}`,
        abi: COMET_VIEW_ABI,
        functionName: "collateralBalanceOf",
        args: [getAddress(user), getAddress(target)]
      })
      if (balance > 0n) return cometAddr
    } catch { /* skip */ }
  }
  return null
}

// Compound weth comet requires allow manager
async function checkAndAllowManager(cometAddress: string, account: string): Promise<void> {
  const manager = ADDRESSES.lending.compound.cometWETHManager

  // Check if it has been allowed (parameter order: user, manager)
  const isAllowed = await publicClient.readContract({
    address: cometAddress as `0x${string}`,
    abi: COMET_ABI,
    functionName: "isAllowed",
    args: [getAddress(account), getAddress(manager)]
  })

  if (isAllowed) {
    return
  }


  // Execute allow
  const data = encodeFunctionData({
    abi: COMET_ABI,
    functionName: "allow",
    args: [getAddress(manager), true]
  })

  const txHash = await sendTx({
    to: cometAddress,
    data,
    account: getAddress(account)
  })

  // Awaiting transaction confirmation
  await publicClient.waitForTransactionReceipt({
    hash: txHash as `0x${string}`,
    timeout: 45000
  })

}

export const compound: LendingAdapter = {
  async supply(token, amount, account, recipient?: string) {
    if (!account) throw new Error("Account is required")

    // recipient transmissible comet address override (scenario → such as WBTC cometUSDC)
    const cometHint = recipient && COMET_ADDRESSES.has(recipient.toLowerCase()) ? getAddress(recipient) : null
    const comet = cometHint || getComet(token)

    // V3 (Comet) Path
    if (comet) {
      // ETH/WETH special treatment: via manager invoke
      if (isETH(token) || token.toLowerCase() === WETH.toLowerCase()) {
        // 1. First check and execute allow
        await checkAndAllowManager(comet, account)

        // 2. Invoke the invoke method of the manager
        const manager = ADDRESSES.lending.compound.cometWETHManager

        // Encoding supply data: comet address + account address + amount (ABI format, 32 bytes each)
        const supplyData = encodeAbiParameters(
          [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
          [getAddress(comet), getAddress(account), amount]
        )

        const data = encodeFunctionData({
          abi: MANAGER_ABI,
          functionName: "invoke",
          args: [
            [ACTION_SUPPLY_NATIVE_TOKEN], // actions: bytes32[]
            [supplyData]                   // data: bytes[]
          ]
        })


        return sendTx({
          to: getAddress(manager),
          data,
          value: amount, // ETH needs to send value
          account: getAddress(account)
        })
      }

      // Other assets: Direct call to comet supply
      const underlying = normalizeToken(token)

      const data = encodeFunctionData({
        abi: COMET_ABI,
        functionName: "supply",
        args: [getAddress(underlying), amount]
      })

      return sendTx({ to: comet, data, account: getAddress(account) })
    }

    // Use V2 (cToken)
    const cToken = getCToken(token)
    const useEthAbi = isETH(token)

    const data = encodeFunctionData({
      abi: useEthAbi ? V2_ETH_ABI : V2_ABI,
      functionName: useEthAbi ? "deposit" : "mint",
      args: useEthAbi ? [] : [amount]
    })

    return sendTx({
      to: cToken,
      data,
      value: useEthAbi ? amount : 0n,
      account: getAddress(account)
    })
  },

  async withdraw(token, amount, account, poolId?: string) {
    if (!account) throw new Error("Account is required")

    let comet = getComet(token)

    // Use V3 (Comet)
    if (comet) {
      // Prioritize the comet corresponding to the poolId (the pool from which the user enters)
      if (poolId && POOL_TO_COMET[poolId]) {
        comet = POOL_TO_COMET[poolId]
      } else if (isETH(token) || token.toLowerCase() === WETH.toLowerCase()) {
        // Back pocket: Find the comet of the user's actual position
        const actualComet = await findCometByCollateral(account, token)
        if (actualComet) {
          comet = actualComet
        }
      }

      // Full withdrawal (amount == maxUint256): Comet only supports max for the base token.
      // For collateral assets resolve the exact live balance, otherwise the safe128 cast reverts.
      let withdrawAmount = amount
      if (amount === maxUint256) {
        const underlying = normalizeToken(token).toLowerCase()
        if (COMET_BASE_TOKENS[comet.toLowerCase()] !== underlying) {
          withdrawAmount = await publicClient.readContract({
            address: getAddress(comet),
            abi: COMET_VIEW_ABI,
            functionName: "collateralBalanceOf",
            args: [getAddress(account), getAddress(normalizeToken(token))]
          })
        }
      }

      // ETH/WETH special treatment: Retrieve native ETH via manager invoke
      if (isETH(token) || token.toLowerCase() === WETH.toLowerCase()) {
        await checkAndAllowManager(comet, account)

        const manager = ADDRESSES.lending.compound.cometWETHManager

        const withdrawData = encodeAbiParameters(
          [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
          [getAddress(comet), getAddress(account), withdrawAmount]
        )

        const data = encodeFunctionData({
          abi: MANAGER_ABI,
          functionName: "invoke",
          args: [
            [ACTION_WITHDRAW_NATIVE_TOKEN],
            [withdrawData]
          ]
        })


        return sendTx({
          to: getAddress(manager),
          data,
          account: getAddress(account)
        })
      }

      const underlying = normalizeToken(token)


      const data = encodeFunctionData({
        abi: COMET_ABI,
        functionName: "withdraw",
        args: [getAddress(underlying), withdrawAmount]
      })

      return sendTx({ to: comet, data, account: getAddress(account) })
    }

    // Use V2 (cToken)
    const cToken = getCToken(token)
    // Compound V2 redeemUnderlying does not accept maxUint256; resolve the live underlying
    // balance so a full withdraw doesn't revert.
    let redeemAmount = amount
    if (amount === maxUint256) {
      redeemAmount = await publicClient.readContract({
        address: getAddress(cToken),
        abi: V2_ABI,
        functionName: "balanceOfUnderlying",
        args: [getAddress(account)]
      })
    }

    const data = encodeFunctionData({
      abi: V2_ABI,
      functionName: "redeemUnderlying",
      args: [redeemAmount]
    })

    return sendTx({ to: cToken, data, account: getAddress(account) })
  },

  async borrow(token, amount, account) {
    if (!account) throw new Error("Account is required")

    const comet = getComet(token)

    // Use V3 (Comet)
    if (comet) {
      // ETH/WETH special treatment: Lend native ETH via manager invoke
      // Refer to the official Compound App: allow (manager, true) + invoke (action_withdraw_native_token)
      if (isETH(token) || token.toLowerCase() === WETH.toLowerCase()) {
        await checkAndAllowManager(comet, account)

        const manager = ADDRESSES.lending.compound.cometWETHManager

        const withdrawData = encodeAbiParameters(
          [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
          [getAddress(comet), getAddress(account), amount]
        )

        const data = encodeFunctionData({
          abi: MANAGER_ABI,
          functionName: "invoke",
          args: [
            [ACTION_WITHDRAW_NATIVE_TOKEN],
            [withdrawData]
          ]
        })


        return sendTx({
          to: getAddress(manager),
          data,
          account: getAddress(account)
        })
      }

      // Other assets (USDC/USDT): directly call comet withdraw to lend the underlying asset
      const underlying = normalizeToken(token)

      const data = encodeFunctionData({
        abi: COMET_ABI,
        functionName: "withdraw",
        args: [getAddress(underlying), amount]
      })


      return sendTx({ to: comet, data, account: getAddress(account) })
    }

    // Use V2 (cToken)
    const cToken = getCToken(token)

    const data = encodeFunctionData({
      abi: V2_ABI,
      functionName: "borrow",
      args: [amount]
    })

    return sendTx({ to: cToken, data, account: getAddress(account) })
  },

  async repay(token, amount, account) {
    if (!account) throw new Error("Account is required")

    const comet = getComet(token)

    // Use V3 (Comet)
    if (comet) {
      // ETH/weth special treatment: reimbursement of raw ETH via manager invoke
      // Refer to the official Compound App: invoke (action_supply_native_token)
      if (isETH(token) || token.toLowerCase() === WETH.toLowerCase()) {
        await checkAndAllowManager(comet, account)

        const manager = ADDRESSES.lending.compound.cometWETHManager

        const supplyData = encodeAbiParameters(
          [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
          [getAddress(comet), getAddress(account), amount]
        )

        const data = encodeFunctionData({
          abi: MANAGER_ABI,
          functionName: "invoke",
          args: [
            [ACTION_SUPPLY_NATIVE_TOKEN],
            [supplyData]
          ]
        })


        return sendTx({
          to: getAddress(manager),
          data,
          value: amount,
          account: getAddress(account)
        })
      }

      // Other assets (USDC/USDT): Direct call to comet supply for reimbursement
      const underlying = normalizeToken(token)

      const data = encodeFunctionData({
        abi: COMET_ABI,
        functionName: "supply",
        args: [getAddress(underlying), amount]
      })


      return sendTx({ to: comet, data, account: getAddress(account) })
    }

    // Use V2 (cToken)
    const cToken = getCToken(token)

    const data = encodeFunctionData({
      abi: V2_ABI,
      functionName: "repayBorrow",
      args: [amount]
    })

    return sendTx({ to: cToken, data, account: getAddress(account) })
  },

  async repayAll(asset, account) {
    const token = getAddress(asset)
    const comet = getComet(token)
    if (comet) {
      // ETH/weth special treatment: reimbursement of all native ETH via manager invoke
      if (isETH(token) || token.toLowerCase() === WETH.toLowerCase()) {
        await checkAndAllowManager(comet, account)

        // Query the actual debt as the transaction value (maxUint256 cannot be sent directly, MetaMask will display the sky-high price)
        const debt = await publicClient.readContract({
          address: comet as `0x${string}`,
          abi: COMET_ABI,
          functionName: "borrowBalanceOf",
          args: [getAddress(account)]
        }) as bigint

        // Add 0.5% buffer for interest accumulation (time window between query and transaction)
        const buffer = debt * 5n / 1000n
        const repayValue = debt + (buffer > 0n ? buffer : 1000000000000000n) // At least +0.001 ETH

        const manager = ADDRESSES.lending.compound.cometWETHManager

        // use maxUint256 in encoded data to tell the Manager to use all msg.value
        const supplyData = encodeAbiParameters(
          [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
          [getAddress(comet), getAddress(account), maxUint256]
        )

        const data = encodeFunctionData({
          abi: MANAGER_ABI,
          functionName: "invoke",
          args: [
            [ACTION_SUPPLY_NATIVE_TOKEN],
            [supplyData]
          ]
        })


        return sendTx({
          to: getAddress(manager),
          data,
          value: repayValue,
          account: getAddress(account)
        })
      }

      // Other assets: Call comet supply directly to repay all
      const underlying = normalizeToken(token)
      const data = encodeFunctionData({
        abi: COMET_ABI,
        functionName: "supply",
        args: [getAddress(underlying), maxUint256]
      })
      return sendTx({ to: comet, data, account: getAddress(account) })
    }
    throw new Error("Compound: no comet found for asset")
  },

  async setCollateral() {
    // Compound automatically manages mortgages
    throw new Error("Compound automatically manages collateral")
  },

  async getSupplyBalance(account: `0x${string}`, asset?: string, poolId?: string) {
    // If there is a poolId, only look at the comet corresponding to the pool (to avoid cross-pool confusion)
    if (poolId && POOL_TO_COMET[poolId]) {
      const cometAddr = POOL_TO_COMET[poolId]
      const isBaseToken = COMETS[asset?.toLowerCase() || '']?.toLowerCase() === cometAddr.toLowerCase()
      const contracts: any[] = []

      if (isBaseToken) {
        contracts.push({
          address: getAddress(cometAddr) as `0x${string}`,
          abi: COMET_ABI,
          functionName: "balanceOf",
          args: [getAddress(account)],
        })
      }
      // Non-fundamental asset → lookup collateralBalanceOf
      if (asset) {
        contracts.push({
          address: getAddress(cometAddr) as `0x${string}`,
          abi: COMET_VIEW_ABI,
          functionName: "collateralBalanceOf",
          // ETH collateral is actually WETH on the chain (Comet does not accept 0xEeee placeholder addresses),
          // Check again after normalization, otherwise the ETH mortgage position balance will always be 0 (Plane # 56)
          args: [getAddress(account), getAddress(normalizeToken(asset))],
        })
      }

      if (contracts.length === 0) return 0n
      try {
        const results = await multicall(publicClient, { contracts, allowFailure: true })
        let total = 0n
        for (const r of results) {
          if (r.status === 'success') total += r.result as bigint
        }
        return total
      } catch { return 0n }
    }

    // Full review without poolId (old behavior)
    let totalBalance = 0n
    const uniqueComets = [...new Set(Object.values(COMETS))]
    const contracts: any[] = []

    if (asset) {
      const baseComet = getComet(asset)
      if (baseComet) {
        contracts.push({
          address: getAddress(baseComet) as `0x${string}`,
          abi: COMET_ABI,
          functionName: "balanceOf",
          args: [getAddress(account)],
        })
      }
    }

    for (const cometAddr of uniqueComets) {
      contracts.push({
        address: getAddress(cometAddr) as `0x${string}`,
        abi: COMET_VIEW_ABI,
        functionName: "collateralBalanceOf",
        args: [getAddress(account), getAddress(normalizeToken(asset as string))],
      })
    }

    if (contracts.length === 0) return totalBalance
    try {
      const results = await multicall(publicClient, { contracts, allowFailure: true })
      for (const r of results) {
        if (r.status === 'success' && (r.result as bigint) > 0n) {
          totalBalance += r.result as bigint
        }
      }
    } catch (e) {
      console.warn(`[Compound] getSupplyBalance multicall failed:`, e)
    }

    return totalBalance
  },

  async getBorrowBalance(account: `0x${string}`, asset?: string, poolId?: string) {
    // Prioritize comet positioning by poolId (prevents comets from mapping to cometWETH when WETH is collateralized in USDC comet)
    let comet: string | null = null
    if (poolId && POOL_TO_COMET[poolId]) {
      comet = POOL_TO_COMET[poolId]
    } else {
      comet = (asset && getComet(asset)) || DEFAULT_COMET
    }

    return publicClient.readContract({
      address: comet as `0x${string}`,
      abi: COMET_ABI,
      functionName: "borrowBalanceOf",
      args: [account]
    }) as Promise<bigint>
  },

  /** Batch query all comet's borrowing amount (one time multicall) */
  async getBorrowBalances(account: `0x${string}`): Promise<Map<string, bigint>> {
    const uniqueComets = [...new Set(Object.values(COMETS))]
    const reverseMap = new Map<string, string>() // cometAddr → baseToken
    const contracts: any[] = []

    for (const [token, cometAddr] of Object.entries(COMETS)) {
      const addr = cometAddr.toLowerCase()
      if (!reverseMap.has(addr)) {
        reverseMap.set(addr, token)
        contracts.push({
          address: getAddress(cometAddr) as `0x${string}`,
          abi: COMET_ABI,
          functionName: "borrowBalanceOf",
          args: [getAddress(account)],
        })
      }
    }

    // The baseToken of WETH comet is WETH, but the user's mind is ETH
    // Unified mapping to ETH addresses to ensure that presentation layers such as Portfolio are matched correctly
    for (const [comet, token] of reverseMap) {
      if (token.toLowerCase() === WETH.toLowerCase()) {
        reverseMap.set(comet, ETH_ADDRESS)
      }
    }

    const result = new Map<string, bigint>()
    if (contracts.length === 0) return result

    try {
      const results = await multicall(publicClient, { contracts, allowFailure: true })
      const comets = [...reverseMap.keys()]
      for (let i = 0; i < comets.length; i++) {
        const r = results[i]
        const debt = r.status === 'success' ? (r.result as bigint) : 0n
        if (debt > 0n) {
          const baseToken = reverseMap.get(comets[i]) || ''
          result.set(baseToken, debt)
        }
      }
    } catch (e) {
      console.warn('[Compound] getBorrowBalances multicall failed:', e)
    }

    return result
  },

  async getAvailableBorrows(account: `0x${string}`, asset?: string) {
    // If asset is passed, only check the corresponding comet of the asset to avoid all traversal
    if (asset) {
      const comet = getComet(asset)
      if (comet) {
        const cents = await computeCometAvailableBorrow(comet, account)
        return cents
      }
      return 0n
    }

    const uniqueComets = [...new Set(Object.values(COMETS))]
    let totalCents = 0n
    let i = 0
    for (const cometAddr of uniqueComets) {
      i++
      if (i > 0) await throttle()
      const cents = await computeCometAvailableBorrow(cometAddr, account)
      totalCents += cents
    }

    return totalCents
  },

  /** Protocol minimum borrow (in base-token human units), read from on-chain baseBorrowMin(). */
  async getMinimumBorrow(poolId?: string, asset?: string) {
    const comet = (poolId && POOL_TO_COMET[poolId]) || (asset ? getComet(asset) : undefined)
    if (!comet) return undefined
    try {
      const [minRaw, baseAddr] = await Promise.all([
        publicClient.readContract({ address: getAddress(comet), abi: COMET_VIEW_ABI, functionName: "baseBorrowMin", args: [] }),
        publicClient.readContract({ address: getAddress(comet), abi: COMET_VIEW_ABI, functionName: "baseToken", args: [] }),
      ])
      const decimals = await publicClient.readContract({ address: getAddress(baseAddr as `0x${string}`), abi: ERC20_ABI, functionName: "decimals", args: [] })
      return Number(minRaw) / 10 ** Number(decimals)
    } catch (e) {
      console.warn(`[Compound] getMinimumBorrow failed: poolId=${poolId} asset=${asset}`, e)
      return undefined
    }
  },

  async getHealthSnapshot(account: `0x${string}`, poolId?: string) {
    const comet = poolId ? POOL_TO_COMET[poolId] : undefined
    if (!comet) return undefined
    const snap = await computeCometHealthSnapshot(comet, account)
    if (!snap) return undefined
    return {
      riskAdjustedCollateralUSD: Number(snap.riskAdjustedCollateralUSD8) / 1e8,
      borrowUSD: Number(snap.borrowUSD8) / 1e8,
      liquidationThresholdBps: snap.liquidationThresholdBps,
      isAccountLevel: false,
      scope: poolId || 'compound',
    }
  },

  async discoverPositions(account: `0x${string}`) {
    const uniqueComets = [...new Set(Object.values(COMETS))]
    const supplied: Array<{
      poolId: string; protocolId: string; protocol: string
      asset: string; assetAddress: string; collateral: boolean
    }> = []
    const borrowed: Array<{
      poolId: string; protocolId: string; protocol: string
      asset: string; assetAddress: string
    }> = []

    // Keep only comets with pool mapping
    const comets = uniqueComets.filter(ca => COMET_TO_POOL[ca.toLowerCase()])
    if (comets.length === 0) return { supplied, borrowed }

    const acct = getAddress(account) as `0x${string}`

    // Round 1: baseToken/balanceOf/borrowBalanceOf/numAssets one-time multicall for all comets
    let round1: any[]
    try {
      round1 = await multicall(publicClient, {
        contracts: comets.flatMap(ca => [
          { address: getAddress(ca) as `0x${string}`, abi: COMET_VIEW_ABI, functionName: "baseToken", args: [] },
          { address: getAddress(ca) as `0x${string}`, abi: COMET_VIEW_ABI, functionName: "balanceOf", args: [acct] },
          { address: getAddress(ca) as `0x${string}`, abi: COMET_VIEW_ABI, functionName: "borrowBalanceOf", args: [acct] },
          { address: getAddress(ca) as `0x${string}`, abi: COMET_VIEW_ABI, functionName: "numAssets", args: [] },
        ]),
        allowFailure: false,
      })
    } catch (e) {
      console.warn('[Compound] discoverPositions: 批量查询 comets 失败:', e)
      return { supplied, borrowed }
    }

    const cometInfos: Array<{ cometAddr: string; poolId: string; baseToken: `0x${string}`; bal: bigint; borrowBal: bigint; numAssets: number }> = []
    for (let i = 0; i < comets.length; i++) {
      const baseToken = round1[i * 4] as `0x${string}`
      const bal = round1[i * 4 + 1] as bigint
      const borrowBal = round1[i * 4 + 2] as bigint
      const numAssets = Number(round1[i * 4 + 3])
      const poolId = COMET_TO_POOL[comets[i].toLowerCase()]!
      cometInfos.push({ cometAddr: comets[i], poolId, baseToken, bal, borrowBal, numAssets })

      const baseAddr = baseToken.toLowerCase()
      // The baseToken of WETH comet is WETH, but the user's mind is ETH
      const isWethComet = baseAddr === WETH.toLowerCase()
      const baseSymbol = isWethComet ? 'ETH' : (TOKEN_SYMBOLS[baseAddr] || baseAddr.slice(0, 6))
      const displayAddr = isWethComet ? ETH_ADDRESS : getAddress(baseAddr)

      // base token liquidity supply
      if (bal > 0n) {
        supplied.push({ poolId, protocolId: 'compound', protocol: 'compound', asset: baseSymbol, assetAddress: displayAddr, collateral: false })
      }
      // Loan
      if (borrowBal > 0n) {
        borrowed.push({ poolId, protocolId: 'compound', protocol: 'compound', asset: baseSymbol, assetAddress: displayAddr })
      }
    }

    // Round 2 +3: comet bulk check with collateral getAssetInfo + collateralBalanceOf
    const collatComets = cometInfos.filter(c => c.numAssets > 0)
    if (collatComets.length > 0) {
      try {
        const assetInfos = await multicall(publicClient, {
          contracts: collatComets.flatMap(c =>
            Array.from({ length: c.numAssets }, (_, i) => ({
              address: getAddress(c.cometAddr) as `0x${string}`,
              abi: COMET_VIEW_ABI,
              functionName: "getAssetInfo",
              args: [i],
            }))
          ),
          allowFailure: false,
        }) as any[]

        const collatCalls: Array<{ address: `0x${string}`; abi: any; functionName: string; args: [`0x${string}`, `0x${string}`] }> = []
        const collatMeta: Array<{ poolId: string; assetAddr: string }> = []
        let infoIdx = 0
        for (const c of collatComets) {
          for (let i = 0; i < c.numAssets; i++) {
            const info = assetInfos[infoIdx]
            infoIdx++
            if (!info) continue
            const assetAddr = info[1] as `0x${string}`
            collatCalls.push({
              address: getAddress(c.cometAddr) as `0x${string}`,
              abi: COMET_VIEW_ABI,
              functionName: "collateralBalanceOf",
              args: [acct, assetAddr],
            })
            collatMeta.push({ poolId: c.poolId, assetAddr: assetAddr.toLowerCase() })
          }
        }

        const collatResults = await multicall(publicClient, { contracts: collatCalls, allowFailure: false }) as bigint[]
        for (let i = 0; i < collatMeta.length; i++) {
          const collat = collatResults[i]
          if (collat === 0n) continue
          const assetAddr = collatMeta[i].assetAddr
          const symbol = TOKEN_SYMBOLS[assetAddr] || assetAddr.slice(0, 6)
          supplied.push({
            poolId: collatMeta[i].poolId,
            protocolId: 'compound',
            protocol: 'compound',
            asset: symbol,
            assetAddress: getAddress(assetAddr),
            collateral: true,
          })
        }
      } catch (e) {
        console.warn('[Compound] discoverPositions: 查询抵押品失败:', e)
      }
    }

    return { supplied, borrowed }
  },

  async getMarketData(): Promise<PoolRateInfo[]> {
    const SECONDS_PER_YEAR = 31_536_000n
    const FACTOR_SCALE = 1_000_000_000_000_000_000n // 1e18
    const uniqueComets = [...new Set(Object.values(COMETS))]
    const result: PoolRateInfo[] = []

    // Round 1: baseToken + totalSupply + totalBorrow for all comets
    const round1 = await multicall(publicClient, {
      contracts: uniqueComets.flatMap(addr => [
        { address: getAddress(addr) as `0x${string}`, abi: COMET_VIEW_ABI, functionName: "baseToken", args: [] },
        { address: getAddress(addr) as `0x${string}`, abi: COMET_VIEW_ABI, functionName: "totalSupply", args: [] },
        { address: getAddress(addr) as `0x${string}`, abi: COMET_VIEW_ABI, functionName: "totalBorrow", args: [] },
      ]),
      allowFailure: false,
    })

    const cometData: Array<{
      addr: string; baseToken: `0x${string}`; totalSupply: bigint; totalBorrow: bigint; utilization: bigint
    }> = []
    for (let i = 0; i < uniqueComets.length; i++) {
      const baseToken = round1[i * 3] as `0x${string}`
      const totalSupply = round1[i * 3 + 1] as bigint
      const totalBorrow = round1[i * 3 + 2] as bigint
      const utilization = totalSupply > 0n ? totalBorrow * BigInt(1e18) / totalSupply : 0n
      cometData.push({ addr: uniqueComets[i], baseToken, totalSupply, totalBorrow, utilization })
    }

    // Round 2: getSupplyRate + getBorrowRate for all comets
    const round2 = await multicall(publicClient, {
      contracts: cometData.flatMap(c => [
        { address: getAddress(c.addr) as `0x${string}`, abi: COMET_VIEW_ABI, functionName: "getSupplyRate", args: [c.utilization] },
        { address: getAddress(c.addr) as `0x${string}`, abi: COMET_VIEW_ABI, functionName: "getBorrowRate", args: [c.utilization] },
      ]),
      allowFailure: false,
    })

    // Round 3: Main collateral factor (getAssetInfoByAddress) Back→ pocket LTV/Threshold/Penalty
    // Returns tuple: [offset, asset, priceFeed, scale, borrowCollateralFactor, liquidateCollateralFactor, liquidationFactor, supplyCap]
    const riskComets = uniqueComets.filter(addr => COMET_PRIMARY_COLLATERAL[addr.toLowerCase()])
    const round3 = await multicall(publicClient, {
      contracts: riskComets.map(addr => ({
        address: getAddress(addr) as `0x${string}`,
        abi: COMET_VIEW_ABI,
        functionName: "getAssetInfoByAddress",
        args: [getAddress(COMET_PRIMARY_COLLATERAL[addr.toLowerCase()])],
      })),
      allowFailure: true,
    })
    const riskByComet = new Map<string, { maxLtv?: number; liquidationThreshold?: number; liquidationPenalty?: number }>()
    for (let i = 0; i < riskComets.length; i++) {
      const r = round3[i]
      if (r?.status !== 'success') continue
      const info = r.result as any[]
      const bcf = Number(info[4] ?? 0) // borrowCollateralFactor
      const lcf = Number(info[5] ?? 0) // liquidateCollateralFactor
      const lf = Number(info[6] ?? 0)  // liquidationFactor (official Liquidation Penalty cal. = 1 - lf)
      riskByComet.set(riskComets[i].toLowerCase(), {
        // The official app shows rounding (82.5% → 83%, 2.5% → 3%), consistent with the official page
        maxLtv: bcf > 0 ? Math.round(bcf / FACTOR_PERCENT) : undefined,
        liquidationThreshold: lcf > 0 ? Math.round(lcf / FACTOR_PERCENT) : undefined,
        // Official App Liquidation Penalty = 1 - liquidationFactor:
        // WBTC lf = 90% → 10%; WETH lf = 93% → 7% (consistent with app.compound.finance)
        liquidationPenalty: lf > 0 ? Math.round((1e18 - lf) / FACTOR_PERCENT) : undefined,
      })
    }

    for (let i = 0; i < cometData.length; i++) {
      const c = cometData[i]
      const supplyRate = round2[i * 2] as bigint
      const borrowRate = round2[i * 2 + 1] as bigint
      // per-second rate → APY: rate * SECONDS_PER_YEAR / 1e18 = APR decimal → continuous compounding
      const supplyAPR = Number(supplyRate * SECONDS_PER_YEAR) / Number(FACTOR_SCALE)
      const borrowAPR = Number(borrowRate * SECONDS_PER_YEAR) / Number(FACTOR_SCALE)
      const supplyAPY = (Math.exp(supplyAPR) - 1) * 100
      const borrowAPY = (Math.exp(borrowAPR) - 1) * 100

      // Base Asset (USDC/USDT/ETH) Rate
      const risk = riskByComet.get(c.addr.toLowerCase()) || {}
      result.push({
        assetAddress: c.baseToken.toLowerCase(),
        supplyAPY, borrowAPY,
        totalSupply: c.totalSupply, totalBorrow: c.totalBorrow,
        maxLtv: risk.maxLtv,
        liquidationThreshold: risk.liquidationThreshold,
        liquidationPenalty: risk.liquidationPenalty,
      })

      // Collateral assets (e.g. WBTC/weth into USDC pools) do not return interest rate data, with “-” displayed on the front-end
      // These assets are only mortgaged and not lent, and querying on-chain interest rates is a waste of RPC
    }

    return result
  },

  /**
 * Query Compound V3 risk parameters by (poolId, collateralized assets).
 * The Compound per pool per collateral asset factor is independent (such as wstETH in USDC pool 82/86/9, and in WETH pool 90/93/2),
 * the map of the protocol-level getMarketData cannot be expressed, and the Supply pop-up window takes the exact value according to this method.
 * ETH placeholders are normalized to WETH (Comet does not accept 0xEeee); underlying asset (non-collateral) queries revert → back to undefined.
 */
  async getCollateralRisk(poolId: string, asset: string): Promise<{ maxLtv?: number; liquidationThreshold?: number; liquidationPenalty?: number } | undefined> {
    const comet = POOL_TO_COMET[poolId]
    if (!comet) return undefined
    try {
      const info = await publicClient.readContract({
        address: getAddress(comet),
        abi: COMET_VIEW_ABI,
        functionName: "getAssetInfoByAddress",
        args: [getAddress(normalizeToken(asset))],
      }) as any[]
      const bcf = Number(info[4] ?? 0)
      const lcf = Number(info[5] ?? 0)
      const lf = Number(info[6] ?? 0)
      if (bcf <= 0) return undefined
      return {
        // The official app shows rounding (CF 82.5% → 83%, Penalty 2.5% → 3%), consistent with the official page
        maxLtv: Math.round(bcf / FACTOR_PERCENT),
        liquidationThreshold: lcf > 0 ? Math.round(lcf / FACTOR_PERCENT) : undefined,
        liquidationPenalty: lf > 0 ? Math.round((1e18 - lf) / FACTOR_PERCENT) : undefined,
      }
    } catch (e) {
      console.warn(`[Compound] getCollateralRisk failed: poolId=${poolId} asset=${asset}`, e)
      return undefined
    }
  }
}
