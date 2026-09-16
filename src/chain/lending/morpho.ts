import { encodeFunctionData, getAddress, encodeAbiParameters, keccak256, maxUint160, maxUint48, maxUint256 } from "viem"
import { multicall } from "viem/actions"
import { sendTx } from "../core/tx"
import { ADDRESSES } from "../evm/addresses"
import { publicClient } from "../core/provider"
import { signTypedData } from "../core/signer"
import { PERMIT2_ABI, PERMIT2_TYPES, BUNDLER3_MULTICALL_ABI, GENERAL_ADAPTER1_ABI, ERC4626_PREVIEW_ABI, ERC20_PERMIT_ABI, ERC20_PERMIT_TYPES } from "../evm/abis"
import type { LendingAdapter, PoolRateInfo } from "./base"

// Permit2 contract address
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as `0x${string}`
// Morpho Blue
const MORPHO_BLUE = getAddress(ADDRESSES.lending.morpho.blue)
const WETH = getAddress(ADDRESSES.tokens.WETH)
const USDC = getAddress(ADDRESSES.tokens.USDC)

// USDC & BatchRouter Related Addresses
const USDC_ADDRESS = ADDRESSES.tokens.USDC
const USDT_ADDRESS = ADDRESSES.tokens.USDT
const BUNDLER3 = ADDRESSES.lending.morpho.bundler3
const ADAPTER_USDT = ADDRESSES.lending.morpho.adapterUSDT
const GENERAL_ADAPTER1 = ADDRESSES.lending.morpho.adapterUSDT // 0x4A6c... universal adapter
const SKY_USDT = ADDRESSES.lending.morpho.skyUSDT

// ==================== Price helpers for getAvailableBorrows ====================

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

const WBTC_ADDRESS = ADDRESSES.tokens.WBTC
const WSTETH_ADDRESS = ADDRESSES.tokens.wstETH
const ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"
const BTC_USD_FEED = "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c"
// stETH/USD feed (8 decimals). Mainnet has NO dedicated wstETH/ETH or wstETH/USD Chainlink proxy;
// wstETH price is derived as stETH/USD × wstETH.stEthPerToken(). The old WSTETH_ETH_FEED
// ("0xFeDe2bdf...") pointed at a non-existent address (bad checksum + not a contract), so the
// wstETH price read always threw and the morpho wstETH-collateral pools reported borrowable = 0.
const STETH_USD_FEED = "0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8"
const WSTETH_RATE_ABI = [{
  name: "stEthPerToken", type: "function", stateMutability: "view",
  inputs: [], outputs: [{ name: "", type: "uint256" }],
}] as const
const USD_8_DECIMALS = 100000000n  // 1e8

// Get the USD price of the token (8-bit precision) while returning the token precision
const IRM_BORROW_RATE_ABI = [{
  name: "borrowRate", type: "function", stateMutability: "view",
  inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "", type: "uint256" }],
}] as const

async function getTokenUSDPrice(token: `0x${string}`): Promise<{ price: bigint; decimals: number }> {
  const addr = token.toLowerCase()

  // Stablecoins
  if (addr === USDC_ADDRESS.toLowerCase() || addr === USDT_ADDRESS.toLowerCase()) {
    return { price: USD_8_DECIMALS, decimals: 6 }
  }
  // WETH / ETH
  if (addr === WETH.toLowerCase()) {
    const result = await publicClient.readContract({
      address: ETH_USD_FEED as `0x${string}`,
      abi: CHAINLINK_ABI,
      functionName: "latestRoundData",
      args: [],
    })
    return { price: BigInt((result as any)[1]), decimals: 18 }
  }
  // WBTC
  if (addr === WBTC_ADDRESS.toLowerCase()) {
    const result = await publicClient.readContract({
      address: BTC_USD_FEED as `0x${string}`,
      abi: CHAINLINK_ABI,
      functionName: "latestRoundData",
      args: [],
    })
    return { price: BigInt((result as any)[1]), decimals: 8 }
  }
  // wstETH: stETH/USD × stEthPerToken() — mainnet has no wstETH/ETH feed, this matches how
  // useLendingPrices prices wstETH (stETH/USD 8-decimal × stETH-per-wstETH 18-decimal → 8-decimal USD)
  if (addr === WSTETH_ADDRESS.toLowerCase()) {
    const [stEthUsdResult, wstEthRateResult] = await Promise.all([
      publicClient.readContract({
        address: STETH_USD_FEED as `0x${string}`,
        abi: CHAINLINK_ABI,
        functionName: "latestRoundData",
        args: [],
      }),
      publicClient.readContract({
        address: WSTETH_ADDRESS as `0x${string}`,
        abi: WSTETH_RATE_ABI,
        functionName: "stEthPerToken",
        args: [],
      }),
    ])
    const stEthUsd = BigInt((stEthUsdResult as any)[1])       // 8 decimals (USD per stETH)
    const wstEthRate = BigInt(wstEthRateResult as bigint)     // 18 decimals (stETH per wstETH)
    const price = stEthUsd * wstEthRate / BigInt(10 ** 18)    // → 8-decimal USD
    return { price, decimals: 18 }
  }

  return { price: 0n, decimals: 18 }
}

// ==================== Morpho Vault/Market supply ABI ====================
// Based on transaction data: selector 0x827fcfcc, parameter order [market, onBehalf, assets, data]
const MORPHO_SUPPLY_ABI = [
  {
    name: "supply",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "market", type: "address" },
      { name: "onBehalf", type: "address" },
      { name: "assets", type: "uint256" },
      { name: "data", type: "bytes" }
    ],
    outputs: []
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "market", type: "address" },
      { name: "assets", type: "uint256" },
      { name: "onBehalf", type: "address" }
    ],
    outputs: []
  }
] as const

// ERC-4626 Standard ABI (for MetaMorpho Vault)
// withdraw: 0xb460af94 = withdraw(uint256,address,address)
const ERC4626_WITHDRAW_ABI = {
  name: "withdraw",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { name: "assets", type: "uint256" },
    { name: "receiver", type: "address" },
    { name: "owner", type: "address" }
  ],
  outputs: [{ name: "shares", type: "uint256" }]
} as const

// ERC-4626 redeem: 0xba087652 = redeem(uint256,address,address)
// MetaMorpho does NOT treat withdraw(max) as "withdraw all"; full withdrawal must redeem all shares.
const ERC4626_REDEEM_ABI = {
  name: "redeem",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { name: "shares", type: "uint256" },
    { name: "receiver", type: "address" },
    { name: "owner", type: "address" }
  ],
  outputs: [{ name: "assets", type: "uint256" }]
} as const

// ERC-4626 view functions (for balance inquiry)
const ERC4626_VIEW_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "shares", type: "uint256" }]
  },
  {
    name: "convertToAssets",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "assets", type: "uint256" }]
  }
] as const

// Get the correct Morpho Vault/Market contract address based on asset (supply call)
function getMorphoVault(token: string): string {
  const usdt = USDT_ADDRESS.toLowerCase()
  const usdc = USDC_ADDRESS.toLowerCase()
  const asset = token.toLowerCase()

  if (asset === usdt) {
    return ADDRESSES.lending.morpho.vaultUSDT  // 0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0
  }
  if (asset === usdc) {
    return ADDRESSES.lending.morpho.vaultUSDC
  }
  return ADDRESSES.lending.morpho.morpho
}

// Get MetaMorpho Vault address based on asset (withdraw call, ERC-4626)
function getMorphoWithdrawVault(token: string): string {
  const usdt = USDT_ADDRESS.toLowerCase()
  const usdc = USDC_ADDRESS.toLowerCase()
  const asset = token.toLowerCase()

  if (asset === usdt) {
    return ADDRESSES.lending.morpho.withdrawVaultUSDT // 0x23f5e9c3... sky.money USDT Savings
  }
  if (asset === usdc) {
    return ADDRESSES.lending.morpho.withdrawVaultUSDC // 0x8c106EED... Gauntlet USDC Prime
  }
  // Non-USDT/USDC asset fallback to original vault
  return getMorphoVault(token)
}

// ERC-4626 vault full withdrawal: MetaMorpho does NOT treat withdraw(max) as "withdraw all",
// so query the user's full share balance and redeem all shares (dust-free).
async function buildFullVaultRedeemData(vaultAddress: string, account: `0x${string}`): Promise<`0x${string}`> {
  const shares = await publicClient.readContract({
    address: getAddress(vaultAddress),
    abi: ERC4626_VIEW_ABI,
    functionName: "balanceOf",
    args: [getAddress(account)],
  }) as bigint
  return encodeFunctionData({
    abi: [ERC4626_REDEEM_ABI],
    functionName: "redeem",
    args: [shares, getAddress(account), getAddress(account)],
  })
}

// Read nonce in allowance from Permit2 contract
// packed format for allowance [owner] [token] [spender]: nonce (48b) | expiration (48b) | amount (160b)
//
// ⚠️ Vulnerability Tip: This implementation reads nonce directly according to the storage slot layout of Permit2 (assuming that allowance mapping is
// slot 1, key order is owner→ token→ spender, nonce is 48 bits higher). If Permit2 upgrade or storage layout
// Changes, nonce will read incorrectly and the signature will fail. The catch pocket back returns 0 when an error occurs (only the first authorization is available). The mainnet is currently available.
async function getPermit2Nonce(
  token: string,
  spender: string,
  owner: `0x${string}`
): Promise<number> {
  try {
    // allowance in slot 1 (SignatureTransfer._nonceBitmap slot 0, AllowanceTransfer.allowance slot 1)
    const inner1 = keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [getAddress(owner), 1n])
    )
    const inner2 = keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [getAddress(token), inner1])
    )
    const allowanceSlot = keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [getAddress(spender), inner2])
    )

    const packed = await publicClient.getStorageAt({
      address: PERMIT2_ADDRESS,
      slot: allowanceSlot
    })

    // nonce = most significant 48 bits of the packed uint256
    // packed = (nonce << 208) | (expiration << 160) | amount
    const nonce = Number(BigInt(packed || "0x0") >> 208n)
    return nonce
  } catch (error) {
    console.error('[Permit2] Failed to read nonce, defaulting to 0:', error)
    return 0
  }
}

// Signature PermitSingle
async function signPermitSingle(
  token: string,
  spender: string,
  amount: bigint,
  account: `0x${string}`,
  nonce?: number
): Promise<{ signature: `0x${string}`; permitSingle: any }> {
  const chainId = await publicClient.getChainId()

  // Use incoming nonce, default 0 if not passed
  const actualNonce = nonce ?? 0

  // PermitSingle Data Structure
  // uint48 requires number type, uint160/uint256 requires bigint
  const permitSingle = {
    details: {
      token: getAddress(token),
      amount: (amount > maxUint160 ? maxUint160 : amount) as bigint,
      expiration: Number(maxUint48), // uint48 -> number
      nonce: actualNonce // uint48 -> number
    },
    spender: getAddress(spender),
    sigDeadline: BigInt(Math.floor(Date.now() / 1000) + 3600) // uint256 -> bigint
  }


  // EIP-712 Signature
  const signature = await signTypedData({
    account,
    domain: {
      name: 'Permit2',
      chainId: BigInt(chainId),
      verifyingContract: PERMIT2_ADDRESS
    },
    types: PERMIT2_TYPES,
    primaryType: 'PermitSingle',
    message: permitSingle
  })


  return { signature, permitSingle }
}

// Signature EIP-2612 Permit (for USDC)
async function signEIP2612Permit(
  token: string,
  spender: string,
  amount: bigint,
  account: `0x${string}`
): Promise<{ v: number; r: `0x${string}`; s: `0x${string}`; deadline: bigint }> {
  const chainId = await publicClient.getChainId()
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600) // Expires in 1 hour

  // Get current nonce (EIP-2612 nonces not in base ERC20_ABI)
  const NONCE_ABI = [{ name: "nonces", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }]
  const nonce = await publicClient.readContract({
    address: getAddress(token),
    abi: NONCE_ABI,
    functionName: "nonces",
    args: [account]
  }) as bigint


  // EIP-712 Signature
  const signature = await signTypedData({
    account,
    domain: {
      name: 'USD Coin',
      version: '2',
      chainId: BigInt(chainId),
      verifyingContract: getAddress(token)
    },
    types: ERC20_PERMIT_TYPES,
    primaryType: 'Permit',
    message: {
      owner: getAddress(account),
      spender: getAddress(spender),
      value: amount,
      nonce,
      deadline
    }
  })


  // Decomposition signature is v, r, s
  const sig = signature.startsWith('0x') ? signature.slice(2) : signature
  const r = `0x${sig.slice(0, 64)}` as `0x${string}`
  const s = `0x${sig.slice(64, 128)}` as `0x${string}`
  const v = parseInt(sig.slice(128, 130), 16)

  return { v, r, s, deadline }
}

// ==================== Morpho Blue (borrow/repay/supplyCollateral/withdrawCollateral) ====================

const MORPHO_BLUE_ABI = [
  {
    name: "supplyCollateral",
    type: "function",
    inputs: [
      {
        name: "marketParams", type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ]
      },
      { name: "assets", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "withdrawCollateral",
    type: "function",
    inputs: [
      {
        name: "marketParams", type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ]
      },
      { name: "assets", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "borrow",
    type: "function",
    inputs: [
      {
        name: "marketParams", type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ]
      },
      { name: "assets", type: "uint256" },
      { name: "shares", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "receiver", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [
      { name: "assetsBorrowed", type: "uint256" },
      { name: "sharesBorrowed", type: "uint256" },
    ]
  },
  {
    name: "repay",
    type: "function",
    inputs: [
      {
        name: "marketParams", type: "tuple",
        components: [
          { name: "loanToken", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "oracle", type: "address" },
          { name: "irm", type: "address" },
          { name: "lltv", type: "uint256" },
        ]
      },
      { name: "assets", type: "uint256" },
      { name: "shares", type: "uint256" },
      { name: "onBehalf", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [
      { name: "assetsRepaid", type: "uint256" },
      { name: "sharesRepaid", type: "uint256" },
    ]
  },
  {
    name: "position",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [
      {
        name: "position", type: "tuple",
        components: [
          { name: "supplyShares", type: "uint256" },
          { name: "borrowShares", type: "uint128" },
          { name: "collateral", type: "uint128" },
        ]
      }
    ]
  },
  {
    name: "market",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "bytes32" },
    ],
    outputs: [
      {
        name: "market", type: "tuple",
        components: [
          { name: "totalSupplyAssets", type: "uint128" },
          { name: "totalSupplyShares", type: "uint128" },
          { name: "totalBorrowAssets", type: "uint128" },
          { name: "totalBorrowShares", type: "uint128" },
          { name: "lastUpdate", type: "uint128" },
          { name: "fee", type: "uint128" },
        ]
      }
    ]
  },
] as const

interface MorphoBlueMarketParams {
  loanToken: `0x${string}`
  collateralToken: `0x${string}`
  oracle: `0x${string}`
  irm: `0x${string}`
  lltv: bigint
}

/**
 * Morpho Blue Known Markets Registry
 * All created markets can be queried via subgraph (https://blue.subgraph.morpho.org)
 * key = `$ {borrowToken.toLowerCase ()}: $ {collateralToken.toLowerCase ()}`
 * * Add New Market Example:
 * MORPHO_BLUE_MARKETS.set ('0x... usdc...: 0x... weth...', {loanToken, collateralToken, oracle, irm, lltv})
 */
const MORPHO_BLUE_MARKETS = new Map<string, MorphoBlueMarketParams>()

// Register Known Market: borrowToken: collateralToken → marketParams
function registerMorphoBlueMarket(market: MorphoBlueMarketParams) {
  const key = `${market.loanToken.toLowerCase()}:${market.collateralToken.toLowerCase()}`
  MORPHO_BLUE_MARKETS.set(key, market)
}

/**
 * Get Morpho Blue market parameters for a given loan asset pair
 * Prioritize finding exact matches (loanToken: collateralToken),
 * Fallback lookup (loanToken: weth)
 */
function getMorphoBlueMarket(borrowToken: `0x${string}`, collateralToken?: `0x${string}`): MorphoBlueMarketParams | undefined {
  if (collateralToken) {
    const exact = MORPHO_BLUE_MARKETS.get(`${borrowToken.toLowerCase()}:${collateralToken.toLowerCase()}`)
    if (exact) return exact
  }
  // Fallback: borrowToken + WETH
  return MORPHO_BLUE_MARKETS.get(`${borrowToken.toLowerCase()}:${WETH.toLowerCase()}`)
}

/** Get a list of Morpho Blue markets where the designated collateral asset is located (one collateral may correspond to multiple lending pools) */
function getMorphoBlueMarketsByCollateral(collateralToken: string): MorphoBlueMarketParams[] {
  const addr = collateralToken.toLowerCase()
  const result: MorphoBlueMarketParams[] = []
  for (const market of MORPHO_BLUE_MARKETS.values()) {
    if (market.collateralToken.toLowerCase() === addr) {
      result.push(market)
    }
  }
  return result
}

// ==================== Register Known Morpho Blue Mainnet Marketplace ====================
// Obtained by querying on-chain CreateMarket events
const IRM = "0x870aC11D48B15DB9a138Cf899d20F13f79bA00bc"

// Morpho Official GraphQL API (officially hosted, key-free, browser CORS available)
// Document: https://docs.morpho.org/developers/api/morpho/
const MORPHO_GRAPHQL_URL = 'https://api.morpho.org/graphql'

// Official marketId (uniqueKey) for the project Morpho pool:
// morpho-usdc = deposit WBTC borrow USDC, morpho-usdt = deposit wstETH borrow USDT
const MORPHO_PROJECT_MARKET_IDS: string[] = [
  '0x3a85e619751152991742810df6ec69ce473daef99e28a64ab2340d7b7ccfee49', // USDC/WBTC
  '0xe7e9694b754c4d4f7e21faf7223f6fa71abaeb10296a4c43a54a7977149687d2', // USDT/wstETH
]

/** Calculate Morpho Blue market id (same as on-chain market () key) */
function morphoMarketId(market: MorphoBlueMarketParams): `0x${string}` {
  return keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
    [market.loanToken, market.collateralToken, market.oracle, market.irm, market.lltv]
  ))
}

/**
 * Pull the project from the official Morpho GraphQL to support the real-time APY and pool total of the market (aggregated by loanToken, consistent with on-chain logic).
 * supplyApy/borrowApy is already a percentage value (e.g. 4.52 = 4.52%); supplyAssets/borrowAssets is underlying wei.
 */
async function fetchMorphoGraphqlMarketData(): Promise<PoolRateInfo[] | null> {
  try {
    // Precise query directly with the official marketId of the project pool to avoid relying on market parameter configuration calculations
    const marketIds = MORPHO_PROJECT_MARKET_IDS
    if (marketIds.length === 0) return null

    const res = await fetch(MORPHO_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query GetMarkets($keys: [String!]) {
          markets(where: { chainId_in: [1], uniqueKey_in: $keys }) {
            items {
              marketId
              loanAsset { address }
              lltv
              state { supplyApy borrowApy supplyAssets borrowAssets }
            }
          }
          vaultUsdt: vaultV2ByAddress(address: "${ADDRESSES.lending.morpho.skyUSDT}", chainId: 1) {
            netApy
          }
          vaultUsdc: vaultV2ByAddress(address: "${ADDRESSES.lending.morpho.withdrawVaultUSDC}", chainId: 1) {
            netApy
          }
        }`,
        variables: { keys: marketIds },
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json: any = await res.json()
    if (json?.errors?.length) throw new Error(json.errors[0].message)
    const items: any[] = json?.data?.markets?.items ?? []
    if (!Array.isArray(items) || items.length === 0) return null

    // Morpho Vault official instantaneous netApy (decimal, 0.0328 = 3.28% → × 100).
    // Stablecoin page APY is this caliber; liquidity positions (Portfolio/Home) should also take the vault rate rather than the Blue market rate.
    const vaultNetApy: Record<string, number> = {}
    const vaultUsdt = json?.data?.vaultUsdt?.netApy
    const vaultUsdc = json?.data?.vaultUsdc?.netApy
    if (typeof vaultUsdt === 'number' && Number.isFinite(vaultUsdt)) vaultNetApy[USDT_ADDRESS.toLowerCase()] = vaultUsdt * 100
    if (typeof vaultUsdc === 'number' && Number.isFinite(vaultUsdc)) vaultNetApy[USDC_ADDRESS.toLowerCase()] = vaultUsdc * 100

    const perToken = new Map<string, { supplyAPY: number[]; borrowAPY: number[]; totalSupply: bigint; totalBorrow: bigint; maxLltv: number }>()
    for (const item of items) {
      const loan = item?.loanAsset?.address?.toLowerCase()
      const st = item?.state
      if (!loan || !st) continue
      const entry = perToken.get(loan) || { supplyAPY: [], borrowAPY: [], totalSupply: 0n, totalBorrow: 0n, maxLltv: 0 }
      // Morpho GraphQL supplyApy/borrowApy is decimal (0.03 = 3%), × 100 rpm value
      entry.supplyAPY.push((Number(st.supplyApy) || 0) * 100)
      entry.borrowAPY.push((Number(st.borrowApy) || 0) * 100)
      entry.totalSupply += BigInt(String(st.supplyAssets ?? 0))
      entry.totalBorrow += BigInt(String(st.borrowAssets ?? 0))
      // lltv was uint256 (965000000000000000 = 96.5%). Morpho Blue's LTV is the clearing threshold (agreement to clear on LTV).
      // There are lltv in multiple markets (different collateral) under the same loan asset, and the maximum value is taken as the display.
      const lltv = Number(item?.lltv ?? 0)
      if (lltv > entry.maxLltv) entry.maxLltv = lltv
      perToken.set(loan, entry)
    }
    if (perToken.size === 0) return null

    const result: PoolRateInfo[] = []
    for (const [assetAddress, data] of perToken) {
      // lltv unit 1e18 → percent (× 100)
      const maxLtv = data.maxLltv > 0 ? data.maxLltv / 1e16 : undefined
      // Liquidation Penalty for Morpho Official App = LIF - 1:
      // LIF = min (1.15, 1/(1 - 0.3 × (1 - LLTV))), LLTV is decimal (e.g. 0.86)
      // Example: LLTV 86% → LIF ≈ 1.0438 → penalty 4.38% (consistent with the official app display)
      const lltvFraction = data.maxLltv / 1e18
      const liquidationPenalty = lltvFraction > 0
        ? (Math.min(1.15, 1 / (1 - 0.3 * (1 - lltvFraction))) - 1) * 100
        : undefined
      result.push({
        assetAddress,
        supplyAPY: data.supplyAPY.reduce((a, b) => a + b, 0) / data.supplyAPY.length,
        borrowAPY: data.borrowAPY.reduce((a, b) => a + b, 0) / data.borrowAPY.length,
        totalSupply: data.totalSupply,
        totalBorrow: data.totalBorrow,
        maxLtv,
        // Morpho Blue has no independent clearing threshold (clearing occurs on LTV), so threshold = LTV
        liquidationThreshold: maxLtv,
        // USDC/USDT liquidity rate = Gauntlet USDC Prime/Sky USDT official netApy,
        // Consistent with Stablecoin page; Blue Market supplyAPY is not a vault rate
        liquidityAPY: vaultNetApy[assetAddress],
        liquidationPenalty,
      })
    }
    return result
  } catch (e) {
    console.warn('[Morpho] GraphQL market data 获取失败，回退链上读取:', e)
    return null
  }
}

;(() => {
  const markets: MorphoBlueMarketParams[] = [
    // USDC/WETH (borrow USDC, collateral WETH)
    {
      loanToken: getAddress(ADDRESSES.tokens.USDC),
      collateralToken: getAddress(ADDRESSES.tokens.WETH),
      oracle: getAddress("0xdC6fD5831277c693B1054e19E94047cb37c77615"),
      irm: getAddress(IRM),
      lltv: 860000000000000000n, // 86%
    },
    // USDC/WETH 91.5% LTV
    {
      loanToken: getAddress(ADDRESSES.tokens.USDC),
      collateralToken: getAddress(ADDRESSES.tokens.WETH),
      oracle: getAddress("0xdC6fD5831277c693B1054e19E94047cb37c77615"),
      irm: getAddress(IRM),
      lltv: 915000000000000000n, // 91.5%
    },
    // USDT/WETH (borrow USDT, collateral WETH)
    {
      loanToken: getAddress(ADDRESSES.tokens.USDT),
      collateralToken: getAddress(ADDRESSES.tokens.WETH),
      oracle: getAddress("0xE9EE579684716c7BB837224f4c7bEEfA4F1f3D7f"),
      irm: getAddress(IRM),
      lltv: 860000000000000000n,
    },
    // USDT/WETH 91.5% LTV
    {
      loanToken: getAddress(ADDRESSES.tokens.USDT),
      collateralToken: getAddress(ADDRESSES.tokens.WETH),
      oracle: getAddress("0xE9EE579684716c7BB837224f4c7bEEfA4F1f3D7f"),
      irm: getAddress(IRM),
      lltv: 915000000000000000n,
    },
    // USDC/WBTC (borrow USDC, collateral WBTC)
    {
      loanToken: getAddress(ADDRESSES.tokens.USDC),
      collateralToken: getAddress(ADDRESSES.tokens.WBTC),
      oracle: getAddress("0xdddd770bADD886DF3864029E4b377b5f6A2b6b83"),
      irm: getAddress(IRM),
      lltv: 860000000000000000n,
    },
    // USDC/wstETH (borrow USDC, collateral wstETH)
    {
      loanToken: getAddress(ADDRESSES.tokens.USDC),
      collateralToken: getAddress(ADDRESSES.tokens.wstETH),
      oracle: getAddress("0x48F7e36EB6B826b2df4B2e630b62cD25e89e40e2"),
      irm: getAddress(IRM),
      lltv: 860000000000000000n,
    },
    // USDT/WBTC (borrow USDT, collateral WBTC)
    {
      loanToken: getAddress(ADDRESSES.tokens.USDT),
      collateralToken: getAddress(ADDRESSES.tokens.WBTC),
      oracle: getAddress("0x008bF4b1cDa0CC9f0E882E0697F036667652e1ef"),
      irm: getAddress(IRM),
      lltv: 860000000000000000n,
    },
    // USDT/wstETH (borrow USDT, collateral wstETH)
    {
      loanToken: getAddress(ADDRESSES.tokens.USDT),
      collateralToken: getAddress(ADDRESSES.tokens.wstETH),
      oracle: getAddress("0x95db30fab9a3754E42423000DF27732cB2396992"),
      irm: getAddress(IRM),
      lltv: 860000000000000000n,
    },
    // WETH/wstETH (borrow WETH, collateral wstETH)
    {
      loanToken: getAddress(ADDRESSES.tokens.WETH),
      collateralToken: getAddress(ADDRESSES.tokens.wstETH),
      oracle: getAddress("0x2a01eb9496094dA03c4e364deF50F5aD1280AD72"),
      irm: getAddress(IRM),
      lltv: 945000000000000000n, // 94.5%
    },
    // WETH/USDC (borrow WETH, collateral USDC)
    {
      loanToken: getAddress(ADDRESSES.tokens.WETH),
      collateralToken: getAddress(ADDRESSES.tokens.USDC),
      oracle: getAddress("0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"),
      irm: getAddress(IRM),
      lltv: 860000000000000000n,
    },
    // wstETH/WETH (borrow wstETH, collateral WETH)
    {
      loanToken: getAddress(ADDRESSES.tokens.wstETH),
      collateralToken: getAddress(ADDRESSES.tokens.WETH),
      oracle: getAddress("0x6F234ff075b35312756A6b0a19DDB55Ff683E59d"),
      irm: getAddress(IRM),
      lltv: 945000000000000000n,
    },
  ]

  for (const m of markets) {
    registerMorphoBlueMarket(m)
  }
})()

export const morpho: LendingAdapter = {

  // ---- pool context (for borrow/repay choosing the right market) ----
  _currentPoolId: '',

  async supply(token, amount, account) {
    if (!account) throw new Error("Account is required")

    // USDT uses the Bundler3 multicall path (permit + permit2TransferFrom + erc4626Deposit)
    if (token.toLowerCase() === USDT_ADDRESS.toLowerCase()) {

      // 1. Calculate expected shares by previewDeposit and apply 0.1% slippage protection
      let minShares = 1n
      try {
        const previewShares = await publicClient.readContract({
          address: getAddress(SKY_USDT),
          abi: ERC4626_PREVIEW_ABI,
          functionName: 'previewDeposit',
          args: [amount]
        }) as bigint
        minShares = previewShares * 999n / 1000n // 0.1% slippage
      } catch (e) {
        console.warn('[Morpho] previewDeposit failed, fallback minShares=1:', e)
      }

      // 2. Read Permit2 allowance nonce
      const nonce = await getPermit2Nonce(token, ADAPTER_USDT, account)

      // 3. Signature PermitSingle (EIP-712 signature, no nonce issues)
      const { signature, permitSingle } = await signPermitSingle(
        token,
        getAddress(ADAPTER_USDT), // spender = GeneralAdapter1
        amount,
        account,
        nonce // Use correct nonce read from chain
      )

      // 4. Build multicall subcalls

      // Call 0: Permit2.permit(owner, permitSingle, signature)
      const permitCall = encodeFunctionData({
        abi: PERMIT2_ABI,
        functionName: 'permit',
        args: [
          getAddress(account),
          permitSingle,
          signature
        ]
      })

      // Call 1: GeneralAdapter1.permit2TransferFrom(USDT, adapter, amount)
      const transferCall = encodeFunctionData({
        abi: GENERAL_ADAPTER1_ABI,
        functionName: 'permit2TransferFrom',
        args: [
          getAddress(token),
          getAddress(ADAPTER_USDT),
          amount
        ]
      })

      // Call 2: GeneralAdapter1.erc4626Deposit(skyUSDT, amount, minShares, receiver)
      const depositCall = encodeFunctionData({
        abi: GENERAL_ADAPTER1_ABI,
        functionName: 'erc4626Deposit',
        args: [
          getAddress(SKY_USDT),
          amount,
          minShares,
          getAddress(account)
        ]
      })

      // 5. Build multicall data (3 calls: permit + transfer + deposit)
      const zeroCallback = "0x0000000000000000000000000000000000000000000000000000000000000000"
      const multicallData = encodeFunctionData({
        abi: BUNDLER3_MULTICALL_ABI,
        functionName: 'multicall',
        args: [[
          { to: getAddress(PERMIT2_ADDRESS), data: permitCall, value: 0n, skipRevert: false, callbackHash: zeroCallback },
          { to: getAddress(ADAPTER_USDT), data: transferCall, value: 0n, skipRevert: false, callbackHash: zeroCallback },
          { to: getAddress(ADAPTER_USDT), data: depositCall, value: 0n, skipRevert: false, callbackHash: zeroCallback }
        ]]
      })


      return sendTx({ to: getAddress(BUNDLER3), data: multicallData, account: getAddress(account) })
    }

    // USDC uses the EIP-2612 Permit + Bundler3 Multicall path
    // Process: Signature EIP-2612 multicall → (permit + erc20TransferFrom + erc4626Deposit)
    if (token.toLowerCase() === USDC_ADDRESS.toLowerCase()) {

      // Gauntlet USDC Prime vault (Deposit Target)
      const USDC_PRIME_VAULT = ADDRESSES.lending.morpho.withdrawVaultUSDC

      // 1. Calculate expected shares by previewDeposit and apply 0.1% slippage protection
      let minShares = 1n
      try {
        const previewShares = await publicClient.readContract({
          address: getAddress(USDC_PRIME_VAULT),
          abi: ERC4626_PREVIEW_ABI,
          functionName: 'previewDeposit',
          args: [amount]
        }) as bigint
        minShares = previewShares * 999n / 1000n // 0.1% slippage
      } catch (e) {
        console.warn('[Morpho] USDC previewDeposit failed, fallback minShares=1:', e)
      }

      // 2. Signature EIP-2612 Permit (off-chain signature, spender = GeneralAdapter1)
      const { v, r, s, deadline } = await signEIP2612Permit(
        token,
        getAddress(GENERAL_ADAPTER1),
        amount,
        account
      )

      // 3. Build multicall subcalls (Bundler3 format)

      // Call 0: USDC.permit(owner, spender, value, deadline, v, r, s)
      const permitCall = encodeFunctionData({
        abi: ERC20_PERMIT_ABI,
        functionName: 'permit',
        args: [
          getAddress(account),       // owner
          getAddress(GENERAL_ADAPTER1), // spender
          amount,                    // value
          deadline,                  // deadline
          v, r, s                    // signature
        ]
      })

      // Call 1: GeneralAdapter1.erc20TransferFrom(USDC, adapter, amount)
      const transferCall = encodeFunctionData({
        abi: GENERAL_ADAPTER1_ABI,
        functionName: 'erc20TransferFrom',
        args: [
          getAddress(token),         // token = USDC
          getAddress(GENERAL_ADAPTER1), // to
          amount
        ]
      })

      // Call 2: GeneralAdapter1.erc4626Deposit(vault, amount, minShares, receiver)
      const depositCall = encodeFunctionData({
        abi: GENERAL_ADAPTER1_ABI,
        functionName: 'erc4626Deposit',
        args: [
          getAddress(USDC_PRIME_VAULT), // vault = Gauntlet USDC Prime
          amount,                        // assets
          minShares,                     // minShares (Slippage Protection)
          getAddress(account)            // receiver
        ]
      })

      // 4. Build multicall data (3 calls: permit + transfer + deposit)
      const zeroCallback = "0x0000000000000000000000000000000000000000000000000000000000000000"
      const multicallData = encodeFunctionData({
        abi: BUNDLER3_MULTICALL_ABI,
        functionName: 'multicall',
        args: [[
          { to: getAddress(token), data: permitCall, value: 0n, skipRevert: false, callbackHash: zeroCallback },
          { to: getAddress(GENERAL_ADAPTER1), data: transferCall, value: 0n, skipRevert: false, callbackHash: zeroCallback },
          { to: getAddress(GENERAL_ADAPTER1), data: depositCall, value: 0n, skipRevert: false, callbackHash: zeroCallback }
        ]]
      })


      return sendTx({ to: getAddress(BUNDLER3), data: multicallData, account: getAddress(account) })
    }

    // Morpho Blue Lending: supplyCollateral (direct deposit of collateral into the lending market)
    // Prefer to use poolId to select the correct market (wstETH may be used as collateral in multiple markets)
    let market: MorphoBlueMarketParams | undefined
    if (morpho._currentPoolId) {
      market = getMorphoBlueMarketByPoolId(morpho._currentPoolId)
    }
    if (!market) {
      const collatMarkets = getMorphoBlueMarketsByCollateral(token)
      if (collatMarkets.length > 0) {
        market = collatMarkets[0]
      }
    }
    if (market) {
      const data = encodeFunctionData({
        abi: MORPHO_BLUE_ABI,
        functionName: "supplyCollateral",
        args: [market, amount, getAddress(account), "0x" as `0x${string}`],
      })
      return sendTx({ to: MORPHO_BLUE, data, account: getAddress(account) })
    }

    // Non-USDC tokens use the original Permit2 path (Vault deposits for non-Morpho Blue collateralized assets)

    // Get Vault/Market contract address
    const vaultAddress = getAddress(getMorphoVault(token))

    // Signature PermitSingle
    const { signature, permitSingle } = await signPermitSingle(
      token,
      vaultAddress, // spender = vault address
      amount,
      account
    )

    // Encode PermitSingle + signature as bytes
    // Data format required for Morpho: encoded (permitSingle) + signature
    const encodedPermitSingle = encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            {
              type: 'tuple',
              name: 'details',
              components: [
                { type: 'address', name: 'token' },
                { type: 'uint160', name: 'amount' },
                { type: 'uint48', name: 'expiration' },
                { type: 'uint48', name: 'nonce' }
              ]
            },
            { type: 'address', name: 'spender' },
            { type: 'uint256', name: 'sigDeadline' }
          ]
        },
        { type: 'bytes' }
      ],
      [
        {
          details: {
            token: getAddress(token),
            amount: (amount > maxUint160 ? maxUint160 : amount) as any,
            expiration: maxUint48 as any,
            nonce: 0 as any
          },
          spender: vaultAddress,
          sigDeadline: permitSingle.sigDeadline
        },
        signature
      ]
    )


    const data = encodeFunctionData({
      abi: MORPHO_SUPPLY_ABI,
      functionName: "supply",
      args: [
        getAddress(token),      // market = token address (USDT)
        getAddress(account),    // onBehalf = User address
        amount,                 // assets = Amount
        encodedPermitSingle as `0x${string}`  // data = PermitSingle + signature
      ]
    })

    return sendTx({ to: vaultAddress, data, account: getAddress(account) })
  },

  async withdraw(token, amount, account, poolId?: string) {
    if (!account) throw new Error("Account is required")

    // Stablecoin Page/Portfolio Liquidity Morpho USDT/USDC is a Treasury (MetaMorpho ERC-4626) position,
    // Not collateral for Morpho Blue. Vault withdraw is required in the context of the morpho-usdt/morpho-usdc pool;
    // Otherwise, USDC will be mistakenly routed to the Blue Market withdrawCollateral (USDC is collateral in the WETH/USDC market,
    // The user's vault balance is at Gauntlet USDC Prime, which is independent of each other).
    const pid = (poolId || morpho._currentPoolId || '').toLowerCase()
    const isStableVaultAsset =
      token.toLowerCase() === USDT_ADDRESS.toLowerCase() ||
      token.toLowerCase() === USDC_ADDRESS.toLowerCase()
    if (isStableVaultAsset && (pid === 'morpho-usdt' || pid === 'morpho-usdc')) {
      const vaultAddress = getAddress(getMorphoWithdrawVault(token))
      // Full withdrawal: ERC-4626 withdraw(max) is not a "withdraw all" — redeem all shares instead
      if (amount === maxUint256) {
        const data = await buildFullVaultRedeemData(vaultAddress, getAddress(account))
        return sendTx({ to: vaultAddress, data, account: getAddress(account) })
      }
      const data = encodeFunctionData({
        abi: [ERC4626_WITHDRAW_ABI],
        functionName: "withdraw",
        args: [
          amount,                 // assets = Amount
          getAddress(account),    // receiver = User address
          getAddress(account)     // owner = User address
        ],
      })
      return sendTx({ to: vaultAddress, data, account: getAddress(account) })
    }

    // Morpho Blue Lending: withdrawCollateral
    let market: MorphoBlueMarketParams | undefined
    if (morpho._currentPoolId) {
      market = getMorphoBlueMarketByPoolId(morpho._currentPoolId)
    }
    if (!market) {
      const collatMarkets = getMorphoBlueMarketsByCollateral(token)
      if (collatMarkets.length > 0) {
        market = collatMarkets[0]
      }
    }
    if (market) {
      // Full withdrawal: Morpho Blue withdrawCollateral does not accept maxUint256;
      // resolve the exact collateral balance of the market first.
      const collateralAmount = amount === maxUint256
        ? await publicClient.readContract({
            address: MORPHO_BLUE,
            abi: MORPHO_BLUE_ABI,
            functionName: "position",
            args: [morphoMarketId(market), getAddress(account)],
          }).then(pos => BigInt((pos as any).collateral))
        : amount
      const data = encodeFunctionData({
        abi: MORPHO_BLUE_ABI,
        functionName: "withdrawCollateral",
        args: [market, collateralAmount, getAddress(account), getAddress(account)],
      })
      return sendTx({ to: MORPHO_BLUE, data, account: getAddress(account) })
    }

    // Vault withdraw for non-Morpho Blue → collateralized assets (ERC4626)
    const vaultAddress = getAddress(getMorphoWithdrawVault(token))
    // Full withdrawal: redeem all shares (same as the stable vault branch)
    if (amount === maxUint256) {
      const data = await buildFullVaultRedeemData(vaultAddress, getAddress(account))
      return sendTx({ to: vaultAddress, data, account: getAddress(account) })
    }

    const data = encodeFunctionData({
      abi: [ERC4626_WITHDRAW_ABI],
      functionName: "withdraw",
      args: [
        amount,                 // assets = Amount
        getAddress(account),    // receiver = User address
        getAddress(account)     // owner = User address
      ]
    })

    return sendTx({ to: vaultAddress, data, account: getAddress(account) })
  },

  async borrow(asset, amount, account) {
    if (!account) throw new Error("Account is required")

    const token = getAddress(asset)
    // Prefer to use poolId to select the correct market (single deposit pool needs to match collateral)
    let market: MorphoBlueMarketParams | undefined
    if (morpho._currentPoolId) {
      market = getMorphoBlueMarketByPoolId(morpho._currentPoolId)
    }
    if (!market) {
      market = getMorphoBlueMarket(token)
    }
    if (!market) {
      throw new Error(
        `Morpho Blue market not found for borrow token ${token}. ` +
        `Call registerMorphoBlueMarket() to register the market parameters (oracle, irm, lltv).`
      )
    }

    // Take the Bundler3 multicall (in line with the official app):
    // 1) [first borrow only] MorphoBlue.setAuthorizationWithSig: authorize Bundler3 via EIP-712 signature
    // 2) morphoBorrow: borrow from MorphoBlue via adapter, lend assets into Bundler3
    // 3) erc20Transfer: Transfer the loanToken to the user
    // Bundler3 authorization is merged into this same multicall (off-chain signature), so the first borrow
    // does not need a separate setAuthorization transaction anymore.
    const data = await buildBorrowMulticallWithAuth(market, amount, getAddress(account))
    return sendTx({ to: BUNDLER3, data, account: getAddress(account) })
  },

  async repay(asset, amount, account) {
    if (!account) throw new Error("Account is required")

    const token = getAddress(asset)
    const market = resolveRepayMarket(token)
    if (!market) {
      throw new Error(
        `Morpho Blue market not found for repay token ${token}. ` +
        `Call registerMorphoBlueMarket() to register market parameters.`
      )
    }

    // Take the Bundler3 multicall (in line with the official app.morpho.org flow):
    // The loan token's pull + permit mechanism matches the SUPPLY path so supply & repay share the SAME
    // one-time approve (USDT → Permit2) / gasless signed permit (USDC EIP-2612), instead of each repay
    // requiring a fresh approve to the adapter.
    // - USDT: Permit2.permit + permit2TransferFrom (one-time approve to Permit2, then gasless PermitSingle)
    // - USDC: EIP-2612 permit + erc20TransferFrom (fully gasless)
    // Then morphoRepay repays via the adapter, and the remaining token/ETH is refunded to the user.
    const data = await buildRepayMulticallForAsset(market, amount, account, false)
    return sendTx({ to: BUNDLER3, data, account: getAddress(account) })
  },

  async repayAll(asset, account) {
    if (!account) throw new Error("Account is required")

    const token = getAddress(asset)
    const market = resolveRepayMarket(token)
    if (!market) {
      throw new Error(
        `Morpho Blue market not found for repay token ${token}. ` +
        `Call registerMorphoBlueMarket() to register market parameters.`
      )
    }

    // Read the full repayment of the current debt. pull amount = debt (aligned with the approve amount of repay.vue:
    // input ≈ debt when the user points Max). Repay clears the EXACT borrow shares (repayAll=true), so accrued
    // interest dust is fully wiped; any pulled excess is refunded by the trailing erc20Transfer.
    const debt = await morpho.getBorrowBalance(getAddress(account), token)
    if (debt <= 0n) throw new Error("No debt to repay")

    const data = await buildRepayMulticallForAsset(market, debt, account, true)
    return sendTx({ to: BUNDLER3, data, account: getAddress(account) })
  },

  async setCollateral() {
    throw new Error("Morpho auto-manages collateral")
  },

  async getSupplyBalance(account: `0x${string}`, asset?: string, poolId?: string) {
    if (!asset) return BigInt(0)

    // ---- USDT/USDC Treasury First (Stablecoin/All/Earnings liquidity position in MetaMorpho Treasury) ----
    // The caller may only pass the protocol-level poolId ('morpho'), at which point the USDC will be routed by the Blue collateral path below
    // (Weth/USDC Market) is misjudged as 0. Here first check the vault (Gauntlet USDC Prime/Sky USDT),
    // There is a balance returned directly; the vault is 0 to continue with the Blue collateral query.
    const isStableVaultAsset =
      asset.toLowerCase() === USDT_ADDRESS.toLowerCase() ||
      asset.toLowerCase() === USDC_ADDRESS.toLowerCase()
    if (isStableVaultAsset) {
      try {
        const vaultAddress = getAddress(getMorphoWithdrawVault(asset))
        const shares = await publicClient.readContract({
          address: vaultAddress,
          abi: ERC4626_VIEW_ABI,
          functionName: "balanceOf",
          args: [getAddress(account)],
        }) as bigint
        if (shares > 0n) {
          const assets = await publicClient.readContract({
            address: vaultAddress,
            abi: ERC4626_VIEW_ABI,
            functionName: "convertToAssets",
            args: [shares],
          }) as bigint
          return assets
        }
      } catch (e) {
        console.warn(`[Morpho] vault supply balance query failed (${asset}):`, e)
      }
    }

    // Morpho Blue Lending: Query position.collateral
    const collatMarkets = getMorphoBlueMarketsByCollateral(asset)
    if (collatMarkets.length > 0) {
      // If poolId is passed, filter by loanToken (avoid aggregating collateral across pools)
      const markets = collatMarkets.filter(market => {
        if (!poolId) return true
        const loanKey = market.loanToken.toLowerCase()
        let marketPoolId = 'morpho'
        if (loanKey === USDT_ADDRESS.toLowerCase()) marketPoolId = 'morpho-usdt'
        else if (loanKey === USDC_ADDRESS.toLowerCase()) marketPoolId = 'morpho-usdc'
        return marketPoolId === poolId
      })

      // Synthesize a multicall for position in all relevant markets, reducing RPC requests
      const contracts = markets.map(market => {
        const id = keccak256(encodeAbiParameters(
          [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
          [market.loanToken, market.collateralToken, market.oracle, market.irm, market.lltv]
        ))
        return {
          address: MORPHO_BLUE,
          abi: MORPHO_BLUE_ABI,
          functionName: "position",
          args: [id, getAddress(account)],
        }
      })

      if (contracts.length > 0) {
        let totalCollateral = 0n
        try {
          const results = await multicall(publicClient, { contracts, allowFailure: true })
          for (let i = 0; i < markets.length; i++) {
            const r = results[i]
            if (r.status !== 'success') {
              continue
            }
            const pos = r.result as { supplyShares: bigint; borrowShares: bigint; collateral: bigint }
            totalCollateral += BigInt(pos.collateral)
          }
        } catch (e) {
          console.warn('[Morpho Blue] getSupplyBalance multicall failed:', e)
        }
        return totalCollateral
      }

      // Blue Market is empty after filtering: the asset is not Blue collateral under this poolId.
      // USDC/USDT is vault liquidity (Gauntlet/Sky vault) in the morpho-usdc/morpho-usdt pool,
      // Falls into the Vault balance path below; other assets remain at 0 (to avoid accidentally damaging other Blue positions).
      if (!isStableVaultAsset) return 0n
    }

    // Vault Balance Inquiry (USDT/USDC, etc.)
    const vaultAddress = getAddress(getMorphoWithdrawVault(asset))

    // Query user's share of the vault
    const shares = await publicClient.readContract({
      address: vaultAddress,
      abi: ERC4626_VIEW_ABI,
      functionName: "balanceOf",
      args: [getAddress(account)]
    })

    // Convert shares to underlying asset quantity (USDT/USDC)
    const balance = await publicClient.readContract({
      address: vaultAddress,
      abi: ERC4626_VIEW_ABI,
      functionName: "convertToAssets",
      args: [shares]
    })

    return balance
  },

  async getBorrowBalance(account: `0x${string}`, asset?: string) {
    if (!asset) return BigInt(0)

    const token = getAddress(asset)
    // Delegate to getBorrowBalances: traverse all markets for this loanToken (e.g. USDC/weth, USDC/WBTC, USDC/wstETH),
    // Avoid checking only getMorphoBlueMarket (token) default fallback WETH mortgage market and missing wstETH/WBTC mortgage market borrowing
    const balances = await morpho.getBorrowBalances(account)
    return balances.get(token) ?? 0n
  },

  // Asset-by-Asset Borrowing Balance: Return Map<loanTokenAddress, borrowAssetsWei>
  // Multiple markets for the same loanToken (e.g. USDC/WETH, USDC/WBTC) converge under the same key,
  // Consistent with the logic in discoverPositions that determines poolId by loanToken.
  async getBorrowBalances(account: `0x${string}`): Promise<Map<string, bigint>> {
    const result = new Map<string, bigint>()
    const markets = [...MORPHO_BLUE_MARKETS.values()]
    if (markets.length === 0) return result

    // Estimated ID for each market
    const entries = markets.map(market => {
      const id = keccak256(encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
        [market.loanToken, market.collateralToken, market.oracle, market.irm, market.lltv]
      ))
      return { id, market }
    })

    // One-time multicall: All positions first, then all markets (for shares→ assets conversion)
    const contracts: Array<{ address: `0x${string}`; abi: any; functionName: string; args: any[] }> = []
    for (const e of entries) {
      contracts.push({ address: MORPHO_BLUE, abi: MORPHO_BLUE_ABI, functionName: "position", args: [e.id, getAddress(account)] })
    }
    for (const e of entries) {
      contracts.push({ address: MORPHO_BLUE, abi: MORPHO_BLUE_ABI, functionName: "market", args: [e.id] })
    }

    try {
      const results = await multicall(publicClient, { contracts, allowFailure: true })
      const posResults = results.slice(0, entries.length)
      const mktResults = results.slice(entries.length)

      for (let i = 0; i < entries.length; i++) {
        const pr = posResults[i]
        const mr = mktResults[i]
        if (pr?.status !== 'success' || mr?.status !== 'success') continue
        const pos = pr.result as { supplyShares: bigint; borrowShares: bigint; collateral: bigint }
        const m = mr.result as { totalSupplyAssets: bigint; totalSupplyShares: bigint; totalBorrowAssets: bigint; totalBorrowShares: bigint; lastUpdate: bigint; fee: bigint }

        const borrowShares = BigInt(pos.borrowShares)
        if (borrowShares === 0n) continue
        const totalBorrowShares = BigInt(m.totalBorrowShares)
        if (totalBorrowShares === 0n) continue

        const borrowAssets = BigInt(m.totalBorrowAssets) * borrowShares / totalBorrowShares
        const loanToken = getAddress(entries[i].market.loanToken)
        result.set(loanToken, (result.get(loanToken) ?? 0n) + borrowAssets)
      }
    } catch (e) {
      console.warn('[Morpho Blue] getBorrowBalances multicall failed:', e)
    }

    return result
  },

  async getHealthSnapshot(account: `0x${string}`, poolId?: string) {
    try {
      const market = poolId ? getMorphoBlueMarketByPoolId(poolId) : undefined
      if (!market) return undefined

      const id = morphoMarketId(market)
      const pos = await publicClient.readContract({
        address: MORPHO_BLUE,
        abi: MORPHO_BLUE_ABI,
        functionName: "position",
        args: [id, getAddress(account)],
      }) as { supplyShares: bigint; borrowShares: bigint; collateral: bigint }

      const [collatPriceData, loanPriceData] = await Promise.all([
        getTokenUSDPrice(market.collateralToken),
        getTokenUSDPrice(market.loanToken),
      ])
      if (collatPriceData.price === 0n || loanPriceData.price === 0n) return undefined

      // 8-decimal USD: collateral(wei) × price(8-dec) / 10^collatDecimals
      const collatValueUSD8 =
        BigInt(pos.collateral) * collatPriceData.price / BigInt(10 ** collatPriceData.decimals)
      const riskAdjustedCollateralUSD8 = collatValueUSD8 * market.lltv / 10n ** 18n

      let borrowUSD8 = 0n
      if (BigInt(pos.borrowShares) > 0n) {
        const m = await publicClient.readContract({
          address: MORPHO_BLUE,
          abi: MORPHO_BLUE_ABI,
          functionName: "market",
          args: [id],
        }) as { totalSupplyAssets: bigint; totalSupplyShares: bigint; totalBorrowAssets: bigint; totalBorrowShares: bigint; lastUpdate: bigint; fee: bigint }
        if (m.totalBorrowShares > 0n) {
          const borrowAssets = m.totalBorrowAssets * BigInt(pos.borrowShares) / m.totalBorrowShares
          borrowUSD8 = borrowAssets * loanPriceData.price / BigInt(10 ** loanPriceData.decimals)
        }
      }

      return {
        riskAdjustedCollateralUSD: Number(riskAdjustedCollateralUSD8) / 1e8,
        borrowUSD: Number(borrowUSD8) / 1e8,
        liquidationThresholdBps: Number(market.lltv) / 1e14,
        isAccountLevel: false,
        scope: poolId || 'morpho',
      }
    } catch (e) {
      console.warn('[Morpho Blue] getHealthSnapshot failed:', e)
      return undefined
    }
  },

  // Press pool (loanToken) to return the borrowable amount (USD cents).
  // key = loanTokenAddress, the borrowable amount of all mortgage markets under the aggregation contract - loanToken.
  async getAvailableBorrowsByPool(account: `0x${string}`): Promise<Map<string, bigint>> {
    const byLoan = new Map<string, bigint>()

    for (const [key, market] of MORPHO_BLUE_MARKETS) {
      try {
        const id = keccak256(encodeAbiParameters(
          [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
          [market.loanToken, market.collateralToken, market.oracle, market.irm, market.lltv]
        ))

        const pos = await publicClient.readContract({
          address: MORPHO_BLUE,
          abi: MORPHO_BLUE_ABI,
          functionName: "position",
          args: [id, getAddress(account)],
        }) as { supplyShares: bigint; borrowShares: bigint; collateral: bigint }

        if (pos.collateral === 0n) continue

        const [collatPriceData, loanPriceData] = await Promise.all([
          getTokenUSDPrice(market.collateralToken),
          getTokenUSDPrice(market.loanToken),
        ])
        if (collatPriceData.price === 0n || loanPriceData.price === 0n) {
          continue
        }

        const collatValueUSD = BigInt(pos.collateral) * collatPriceData.price / BigInt(10 ** collatPriceData.decimals)
        const maxBorrowUSD = collatValueUSD * market.lltv / BigInt(10 ** 18)

        let borrowUSD = 0n
        if (BigInt(pos.borrowShares) > 0n) {
          const m = await publicClient.readContract({
            address: MORPHO_BLUE,
            abi: MORPHO_BLUE_ABI,
            functionName: "market",
            args: [id],
          }) as { totalSupplyAssets: bigint; totalSupplyShares: bigint; totalBorrowAssets: bigint; totalBorrowShares: bigint; lastUpdate: bigint; fee: bigint }

          if (m.totalBorrowShares > 0n) {
            const borrowAssets = m.totalBorrowAssets * BigInt(pos.borrowShares) / m.totalBorrowShares
            borrowUSD = borrowAssets * loanPriceData.price / BigInt(10 ** loanPriceData.decimals)
          }
        }

        if (maxBorrowUSD <= borrowUSD) continue
        const availableUSD = maxBorrowUSD - borrowUSD
        const cents = availableUSD * 100n / USD_8_DECIMALS
        const loanToken = getAddress(market.loanToken)
        byLoan.set(loanToken, (byLoan.get(loanToken) ?? 0n) + cents)
      } catch (e) {
        console.warn(`[Morpho Blue] getAvailableBorrowsByPool failed for market ${key}:`, e)
      }
    }

    return byLoan
  },

  async getAvailableBorrows(account: `0x${string}`) {
    const byLoan = await morpho.getAvailableBorrowsByPool(account)

    // If the pool context (_currentPoolId) is set, only the borrowable limit of the pool loanToken is returned
    // Avoid cross-pool aggregation (USDC + USDT + WETH) causing the borrow tab to display inflated debits
    if (morpho._currentPoolId) {
      const poolLoanToken = getLoanTokenByPoolId(morpho._currentPoolId)
      if (poolLoanToken) {
        const cents = byLoan.get(poolLoanToken) ?? 0n
        return cents
      }
    }

    let totalCents = 0n
    for (const cents of byLoan.values()) totalCents += cents
    return totalCents
  },

  async getMarketData(): Promise<PoolRateInfo[]> {
    // Only Morpho official GraphQL (real-time APY + pool total) is used; failure returns an empty array with '-' displayed by the front-end,
    // Do not do on-chain fallback (official API and on-chain are two sets of data sources with different calibers, and cannot be mixed)
    return (await fetchMorphoGraphqlMarketData()) ?? []
  },

  async discoverPositions(account: `0x${string}`) {
    const TOKEN_SYMBOLS: Record<string, string> = {
      [ADDRESSES.tokens.USDC.toLowerCase()]: 'USDC',
      [ADDRESSES.tokens.USDT.toLowerCase()]: 'USDT',
      [ADDRESSES.tokens.WETH.toLowerCase()]: 'WETH',
      [ADDRESSES.tokens.WBTC.toLowerCase()]: 'WBTC',
      [ADDRESSES.tokens.wstETH.toLowerCase()]: 'wstETH',
    }

    const SKY_USDT_ADDR = getAddress(ADDRESSES.lending.morpho.skyUSDT)
    const USDC_VAULT_ADDR = getAddress(ADDRESSES.lending.morpho.withdrawVaultUSDC)

    // Build multicall: vault shares + Blue position(id, user)
    const calls: Array<{ address: `0x${string}`; abi: any; functionName: string; args: any[] }> = []
    type MetaEntry =
      | { type: 'vault'; poolId: string; symbol: string; address: `0x${string}` }
      | { type: 'market'; market: MorphoBlueMarketParams }
    const meta: MetaEntry[] = []

    // Vault 1: Sky USDT (ERC-4626)
    calls.push({ address: SKY_USDT_ADDR, abi: ERC4626_VIEW_ABI, functionName: "balanceOf", args: [account] })
    meta.push({ type: 'vault', poolId: 'morpho-usdt', symbol: 'USDT', address: getAddress(USDT_ADDRESS) })

    // Vault 2: Gauntlet USDC Prime (ERC-4626)
    calls.push({ address: USDC_VAULT_ADDR, abi: ERC4626_VIEW_ABI, functionName: "balanceOf", args: [account] })
    meta.push({ type: 'vault', poolId: 'morpho-usdc', symbol: 'USDC', address: getAddress(USDC_ADDRESS) })

    // Blue market positions
    const marketEntries: Array<{ id: `0x${string}`; market: MorphoBlueMarketParams }> = []
    for (const market of MORPHO_BLUE_MARKETS.values()) {
      const id = keccak256(encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
        [market.loanToken, market.collateralToken, market.oracle, market.irm, market.lltv]
      ))
      calls.push({ address: MORPHO_BLUE, abi: MORPHO_BLUE_ABI, functionName: "position", args: [id, account] })
      meta.push({ type: 'market', market })
      marketEntries.push({ id, market })
    }

    const results = await multicall(publicClient, { contracts: calls, allowFailure: true })

    const supplied: Array<{
      poolId: string; protocolId: string; protocol: string
      asset: string; assetAddress: string; collateral: boolean
    }> = []
    const borrowed: Array<{
      poolId: string; protocolId: string; protocol: string
      asset: string; assetAddress: string
    }> = []

    // Process results
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r?.status !== 'success') continue
      const entry = meta[i]

      if (entry.type === 'vault') {
        if ((r.result as bigint) > 0n) {
          supplied.push({
            poolId: entry.poolId,
            protocolId: 'morpho', protocol: 'morpho',
            asset: entry.symbol,
            assetAddress: entry.address,
            collateral: false,
          })
        }
      } else {
        // Blue market position
        const pos = r.result as any
        const market = entry.market
        const loanKey = market.loanToken.toLowerCase()
        const collatKey = market.collateralToken.toLowerCase()

        let poolId = 'morpho'
        if (loanKey === USDT_ADDRESS.toLowerCase()) poolId = 'morpho-usdt'
        else if (loanKey === USDC_ADDRESS.toLowerCase()) poolId = 'morpho-usdc'

        if (BigInt(pos.collateral) > 0n) {
          supplied.push({
            poolId,
            protocolId: 'morpho', protocol: 'morpho',
            asset: TOKEN_SYMBOLS[collatKey] || collatKey.slice(0, 6),
            assetAddress: getAddress(market.collateralToken),
            collateral: true,
          })
        }
        if (BigInt(pos.borrowShares) > 0n) {
          borrowed.push({
            poolId,
            protocolId: 'morpho', protocol: 'morpho',
            asset: TOKEN_SYMBOLS[loanKey] || loanKey.slice(0, 6),
            assetAddress: getAddress(market.loanToken),
          })
        }
      }
    }

    return { supplied, borrowed }
  }
}

/** Set Morpho pool context (influencing market selection for borrow/repay) */
export function setMorphoPool(poolId: string) {
  morpho._currentPoolId = poolId
}

/** Get the corresponding loanToken address according to poolId */
function getLoanTokenByPoolId(poolId: string): `0x${string}` | null {
  switch (poolId) {
    case 'morpho-usdc': return getAddress(USDC_ADDRESS)
    case 'morpho-usdt': return getAddress(USDT_ADDRESS)
    default: return null
  }
}

/** Morpho Blue market parameters based on poolId */
function getMorphoBlueMarketByPoolId(poolId: string): MorphoBlueMarketParams | undefined {
  switch (poolId) {
    case 'morpho-usdc':
      // USDC/WBTC 86%
      return MORPHO_BLUE_MARKETS.get(`${USDC_ADDRESS.toLowerCase()}:${WBTC_ADDRESS.toLowerCase()}`)
    case 'morpho-usdt':
      // USDT/wstETH 86%
      return MORPHO_BLUE_MARKETS.get(`${USDT_ADDRESS.toLowerCase()}:${WSTETH_ADDRESS.toLowerCase()}`)
    default:
      return undefined
  }
}

/** Analyze repay market: Prioritize poolId context, fallback is found by loanToken */
function resolveRepayMarket(token: `0x${string}`): MorphoBlueMarketParams | undefined {
  if (morpho._currentPoolId) {
    const m = getMorphoBlueMarketByPoolId(morpho._currentPoolId)
    if (m) return m
  }
  return getMorphoBlueMarket(token)
}

// MorphoBlue authorization query/setup (Bundler3 borrowing requires the user to first authorize Bundler3 to operate its position)
const MORPHO_AUTH_ABI = [
  {
    name: "isAuthorized", type: "function", stateMutability: "view",
    inputs: [{ type: "address", name: "owner" }, { type: "address", name: "authorized" }],
    outputs: [{ type: "bool", name: "" }],
  },
  {
    name: "setAuthorization", type: "function", stateMutability: "nonpayable",
    inputs: [{ type: "address", name: "authorized" }, { type: "bool", name: "newIsAuthorized" }],
    outputs: [],
  },
  {
    name: "nonce", type: "function", stateMutability: "view",
    inputs: [{ type: "address", name: "authorizer" }],
    outputs: [{ type: "uint256", name: "" }],
  },
  {
    name: "setAuthorizationWithSig", type: "function", stateMutability: "nonpayable",
    inputs: [
      {
        type: "tuple", name: "authorization",
        components: [
          { type: "address", name: "authorizer" },
          { type: "address", name: "authorized" },
          { type: "bool", name: "isAuthorized" },
          { type: "uint256", name: "nonce" },
          { type: "uint256", name: "deadline" },
        ],
      },
      {
        type: "tuple", name: "signature",
        components: [
          { type: "uint8", name: "v" },
          { type: "bytes32", name: "r" },
          { type: "bytes32", name: "s" },
        ],
      },
    ],
    outputs: [],
  },
] as const

// EIP-712 Authorization struct types (Morpho Blue uses a 2-field domain: chainId + verifyingContract, no name/version)
const MORPHO_AUTHORIZATION_TYPES = [
  { name: "authorizer", type: "address" },
  { name: "authorized", type: "address" },
  { name: "isAuthorized", type: "bool" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
] as const

/**
 * Check whether GeneralAdapter1 is already authorized by the user to operate its MorphoBlue position.
 * The official app authorizes the ADAPTER (not Bundler3): Bundler3 calls the adapter via a regular call,
 * so Morpho sees msg.sender = adapter (0x4a6c) and checks isAuthorized[user][adapter].
 * Returns true when a separate authorization is unnecessary (already authorized).
 */
async function isAdapterAuthorized(account: `0x${string}`): Promise<boolean> {
  const user = getAddress(account)
  const adapter = getAddress(ADAPTER_USDT)
  try {
    return await publicClient.readContract({
      address: MORPHO_BLUE,
      abi: MORPHO_AUTH_ABI,
      functionName: "isAuthorized",
      args: [user, adapter],
    }) as boolean
  } catch (e) {
    console.warn("[Morpho] isAuthorized 查询失败，按未授权处理:", e)
    return false
  }
}

/**
 * EIP-712 sign an Authorization for GeneralAdapter1 (authorize the adapter to operate the user's MorphoBlue position).
 * Morpho Blue uses a 2-field domain (chainId + verifyingContract, no name/version). Returns both the
 * Authorization struct and the split {v, r, s} signature for setAuthorizationWithSig.
 */
async function signAdapterAuthorization(
  account: `0x${string}`
): Promise<{
  authorization: { authorizer: `0x${string}`; authorized: `0x${string}`; isAuthorized: boolean; nonce: bigint; deadline: bigint }
  signature: { v: number; r: `0x${string}`; s: `0x${string}` }
}> {
  const user = getAddress(account)
  const adapter = getAddress(ADAPTER_USDT)
  const chainId = await publicClient.getChainId()

  const nonce = await publicClient.readContract({
    address: MORPHO_BLUE,
    abi: MORPHO_AUTH_ABI,
    functionName: "nonce",
    args: [user],
  }) as bigint
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600) // expires in 1 hour

  const authorization = {
    authorizer: user,
    authorized: adapter,
    isAuthorized: true,
    nonce,
    deadline,
  }

  const signatureHex = await signTypedData({
    account: user,
    domain: {
      chainId: BigInt(chainId),
      verifyingContract: MORPHO_BLUE,
    },
    types: { Authorization: MORPHO_AUTHORIZATION_TYPES },
    primaryType: "Authorization",
    message: authorization,
  })

  // Decompose the standard 65-byte signature (0x + r32 + s32 + v1) into {v, r, s}
  const hex = signatureHex.slice(2)
  return {
    authorization,
    signature: {
      v: parseInt(hex.slice(128, 130), 16),
      r: `0x${hex.slice(0, 64)}` as `0x${string}`,
      s: `0x${hex.slice(64, 128)}` as `0x${string}`,
    },
  }
}

/**
 * Build the Borrow sub-calls of the Bundler3 multicall (consistent with the official app, selector 0x62577ad0).
 * The official borrow is a SINGLE GeneralAdapter1.morphoBorrow call: the adapter borrows from Morpho and sends
 * the loan token to the receiver itself, so no separate nativeTransfer/erc20Transfer is needed.
 * Note the call targets the ADAPTER (0x4a6c), matching the official transaction — NOT Bundler3 (0x6566).
 * Prerequisite: GeneralAdapter1 authorized by the user (via signature) + the user has collateral in the market.
 */
function buildBorrowCalls(
  market: MorphoBlueMarketParams,
  amount: bigint,
  account: string,
): Array<{ to: `0x${string}`; data: `0x${string}`; value: bigint; skipRevert: boolean; callbackHash: `0x${string}` }> {
  const user = getAddress(account)
  const zeroCb = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`

  // morphoBorrow(MarketParams, assets, shares=0, slippageAmount, receiver=user)
  // Signature on the adapter: ((address,address,address,address,uint256),uint256,uint256,uint256,address) = 0x62577ad0.
  // NOTE: slippageAmount must be a FINITE value — the adapter reverts on maxUint256 (arithmetic overflow). The
  // official app uses a finite max-debt cap; we use 2x the requested amount as a generous, never-blocking cap
  // (verified on-chain that a finite value in this range passes while maxUint256 reverts).
  const borrowCall = encodeFunctionData({
    abi: GENERAL_ADAPTER1_ABI,
    functionName: "morphoBorrow",
    args: [market, amount, 0n, amount * 2n, user],
  })

  return [
    { to: getAddress(ADAPTER_USDT), data: borrowCall, value: 0n, skipRevert: false, callbackHash: zeroCb },
  ]
}

/**
 * Construct Morpho Borrowing multicall, authorizing the adapter (GeneralAdapter1) on the first borrow.
 * If the adapter is not yet authorized, an EIP-712 signed setAuthorizationWithSig call is prepended as the first
 * multicall item — eliminating the separate authorization transaction the first borrow used to need.
 */
async function buildBorrowMulticallWithAuth(
  market: MorphoBlueMarketParams,
  amount: bigint,
  account: `0x${string}`,
): Promise<`0x${string}`> {
  const user = getAddress(account)
  const calls = buildBorrowCalls(market, amount, account)

  if (!(await isAdapterAuthorized(user))) {
    const { authorization, signature } = await signAdapterAuthorization(user)
    const authCall = encodeFunctionData({
      abi: MORPHO_AUTH_ABI,
      functionName: "setAuthorizationWithSig",
      args: [authorization, signature],
    })
    const zeroCb = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`
    calls.unshift({ to: MORPHO_BLUE, data: authCall, value: 0n, skipRevert: false, callbackHash: zeroCb })
  }

  return encodeFunctionData({
    abi: BUNDLER3_MULTICALL_ABI,
    functionName: "multicall",
    args: [calls],
  })
}

// Read the user's borrow shares + market totals for one market, so repayment can be done by SHARES.
// The official app.morpho.org repays by shares: repaying by ASSETS can revert with
// InsufficientBorrowShares whenever the converted shares exceed the user's actual position
// (interest accruing between the balance read and the tx, or rounding up).
async function getBorrowStateForMarket(
  market: MorphoBlueMarketParams,
  account: string,
): Promise<{ borrowShares: bigint; totalBorrowAssets: bigint; totalBorrowShares: bigint }> {
  const id = morphoMarketId(market)
  const [pos, mk] = await multicall(publicClient, {
    contracts: [
      { address: MORPHO_BLUE, abi: MORPHO_BLUE_ABI, functionName: "position", args: [id, getAddress(account)] },
      { address: MORPHO_BLUE, abi: MORPHO_BLUE_ABI, functionName: "market", args: [id] },
    ],
    allowFailure: true,
  })
  return {
    borrowShares: BigInt(pos.status === "success" ? (pos.result as any).borrowShares : 0n),
    totalBorrowAssets: BigInt(mk.status === "success" ? (mk.result as any).totalBorrowAssets : 0n),
    totalBorrowShares: BigInt(mk.status === "success" ? (mk.result as any).totalBorrowShares : 0n),
  }
}

/**
 * Construct Morpho repayment multicall (consistent with official app).
 * item1: GeneralAdapter1.erc20TransferFrom (loanToken, adapter, amount) Pull money from user to adapter
 * item2: GeneralAdapter1.morphoRepay (market, 0, shares, slippage, user, 0x) Repay by SHARES (official app), finite slippage
 * item3: GeneralAdapter1.erc20Transfer (loanToken, user, maxUint256) Refund excess tokens
 * (No nativeTransfer — a stablecoin repay has no ETH to refund.)
 * Prerequisite: User approve loanToken GeneralAdapter1 → (adapter_USDT 0x4a6c).
 */
function buildRepayMulticall(
  market: MorphoBlueMarketParams,
  assetsToPull: bigint,
  sharesToRepay: bigint,
  maxSharePriceE27: bigint,
  account: string,
): `0x${string}` {
  const user = getAddress(account)
  const loanToken = getAddress(market.loanToken)
  const adapter = getAddress(ADAPTER_USDT) // GeneralAdapter1 (0x4a6c)
  const zeroCb = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`

  const transferFromCall = encodeFunctionData({
    abi: GENERAL_ADAPTER1_ABI,
    functionName: "erc20TransferFrom",
    args: [loanToken, adapter, assetsToPull],
  })
  // Repay by SHARES (assets=0) like app.morpho.org. NOTE: maxSharePriceE27 must be FINITE —
  // GeneralAdapter1 reverts on maxUint256 (arithmetic overflow). It is the borrow share price ×1e27 cap.
  const repayCall = encodeFunctionData({
    abi: GENERAL_ADAPTER1_ABI,
    functionName: "morphoRepay",
    args: [market, 0n, sharesToRepay, maxSharePriceE27, user, "0x" as `0x${string}`],
  })
  const transferCall = encodeFunctionData({
    abi: GENERAL_ADAPTER1_ABI,
    functionName: "erc20Transfer",
    args: [loanToken, user, maxUint256],
  })

  return encodeFunctionData({
    abi: BUNDLER3_MULTICALL_ABI,
    functionName: "multicall",
    args: [[
      { to: adapter, data: transferFromCall, value: 0n, skipRevert: false, callbackHash: zeroCb },
      { to: adapter, data: repayCall, value: 0n, skipRevert: false, callbackHash: zeroCb },
      { to: adapter, data: transferCall, value: 0n, skipRevert: false, callbackHash: zeroCb },
    ]],
  })
}

/**
 * Dispatcher: pick the pull+permit mechanism that matches the loan token's SUPPLY path, so a single
 * one-time approve (USDT → Permit2) / gasless EIP-2612 permit (USDC) covers both supply and repay.
 * Only USDT/USDC are loan tokens in the registered Morpho Blue markets; anything else falls back to
 * the direct erc20TransferFrom path (requires a manual approve to the adapter).
 *
 * Repayment is always done by SHARES (assets=0), matching app.morpho.org — see getBorrowStateForMarket.
 * `amount` is the asset amount used for the pull + slippage basis; `repayAll` clears the exact shares.
 */
async function buildRepayMulticallForAsset(
  market: MorphoBlueMarketParams,
  amount: bigint,
  account: string,
  repayAll = false,
): Promise<`0x${string}`> {
  const { borrowShares, totalBorrowAssets, totalBorrowShares } = await getBorrowStateForMarket(market, account)
  if (borrowShares === 0n) throw new Error("No borrow shares to repay")

  const sharesToRepay = repayAll
    ? borrowShares // exact shares → fully clears the position (incl. accrued dust), like app.morpho.org
    : (totalBorrowShares === 0n ? 0n : (amount * totalBorrowShares) / totalBorrowAssets)
  if (sharesToRepay === 0n) throw new Error("No borrow shares to repay for the given amount")

  // maxSharePriceE27 = the pool's borrow share price scaled by 1e27 (+1% tolerance). The adapter's
  // morphoRepay enforces this as Morpho Blue's repay slippage guard (share price must be ≤ this cap).
  // The old `amount*2n+1000n` passed an asset amount, ~15 orders too small → always reverts. This matches
  // the cap app.morpho.org computes from the pool's borrow state (totalBorrowAssets×1e27/totalBorrowShares).
  const maxSharePriceE27 =
    totalBorrowShares === 0n ? 0n : (totalBorrowAssets * 10n ** 27n * 101n) / (totalBorrowShares * 100n)

  const lt = getAddress(market.loanToken).toLowerCase()
  if (lt === USDT_ADDRESS.toLowerCase()) {
    return buildRepayMulticallPermit2(market, amount, sharesToRepay, maxSharePriceE27, account)
  }
  if (lt === USDC_ADDRESS.toLowerCase()) {
    return buildRepayMulticallEIP2612(market, amount, sharesToRepay, maxSharePriceE27, account)
  }
  return buildRepayMulticall(market, amount, sharesToRepay, maxSharePriceE27, account)
}

/**
 * Build the USDT repay multicall using the Permit2 path (matches supply + official app.morpho.org):
 * item0: Permit2.permit(user, permitSingle, sig) — authorize the adapter via a gasless PermitSingle
 * item1: GeneralAdapter1.permit2TransferFrom(USDT, adapter, amount) — pull USDT user → adapter via Permit2
 * item2: GeneralAdapter1.morphoRepay(..., 0, shares, slippage, ...) — repay by SHARES (official app)
 * item3: GeneralAdapter1.erc20Transfer(USDT, user, maxUint256) — refund unused buffer back to the user
 * (No nativeTransfer — a stablecoin repay has no ETH to refund; matches the official 4-item multicall.)
 * Prerequisite: user has approved USDT → Permit2 (one-time, same as supply's deposit approve).
 */
async function buildRepayMulticallPermit2(
  market: MorphoBlueMarketParams,
  amount: bigint,
  sharesToRepay: bigint,
  maxSharePriceE27: bigint,
  account: string,
): Promise<`0x${string}`> {
  const user = getAddress(account)
  const loanToken = getAddress(market.loanToken)
  const adapter = getAddress(ADAPTER_USDT) // GeneralAdapter1 (0x4a6c)
  const zeroCb = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`

  // Pull a small buffer over the exact debt so the adapter's morphoRepay pull — which can exceed the debt
  // read by a tiny bit of accrued interest / rounding — never exceeds the Permit2 allowance and reverts
  // (the trailing erc20Transfer refunds any unused buffer back to the user). Matches app.morpho.org, where
  // the step-2 PermitSingle amount is slightly larger than the step-3 actual pull.
  const pullAmount = amount + amount / 10000n + 1000n // ~0.01% + 1000 wei dust buffer

  // Sign PermitSingle (spender = adapter). Reads the Permit2 nonce so re-repays don't collide.
  const nonce = await getPermit2Nonce(loanToken, adapter, user)
  const { signature, permitSingle } = await signPermitSingle(loanToken, adapter, pullAmount, user, nonce)

  const permitCall = encodeFunctionData({
    abi: PERMIT2_ABI,
    functionName: "permit",
    args: [user, permitSingle, signature],
  })
  const transferFromCall = encodeFunctionData({
    abi: GENERAL_ADAPTER1_ABI,
    functionName: "permit2TransferFrom",
    args: [loanToken, adapter, pullAmount],
  })
  // Repay by SHARES (assets=0) like app.morpho.org. NOTE: maxSharePriceE27 must be FINITE —
  // GeneralAdapter1 reverts on maxUint256 (arithmetic overflow), same as morphoBorrow.
  const repayCall = encodeFunctionData({
    abi: GENERAL_ADAPTER1_ABI,
    functionName: "morphoRepay",
    args: [market, 0n, sharesToRepay, maxSharePriceE27, user, "0x" as `0x${string}`],
  })
  const transferCall = encodeFunctionData({
    abi: GENERAL_ADAPTER1_ABI,
    functionName: "erc20Transfer",
    args: [loanToken, user, maxUint256],
  })

  return encodeFunctionData({
    abi: BUNDLER3_MULTICALL_ABI,
    functionName: "multicall",
    args: [[
      { to: getAddress(PERMIT2_ADDRESS), data: permitCall, value: 0n, skipRevert: false, callbackHash: zeroCb },
      { to: adapter, data: transferFromCall, value: 0n, skipRevert: false, callbackHash: zeroCb },
      { to: adapter, data: repayCall, value: 0n, skipRevert: false, callbackHash: zeroCb },
      { to: adapter, data: transferCall, value: 0n, skipRevert: false, callbackHash: zeroCb },
    ]],
  })
}

/**
 * Build the USDC repay multicall using the EIP-2612 path (matches supply):
 * item0: USDC.permit(user, adapter, amount, deadline, v, r, s) — gasless signed permit (no approve tx)
 * item1: GeneralAdapter1.erc20TransferFrom(USDC, adapter, amount) — pull USDC user → adapter
 * item2: GeneralAdapter1.morphoRepay(..., 0, shares, slippage, ...) — repay by SHARES (official app)
 * item3: GeneralAdapter1.erc20Transfer(USDC, user, maxUint256) — refund unused buffer back to the user
 * (No nativeTransfer — a stablecoin repay has no ETH to refund; matches the official 4-item multicall.)
 */
async function buildRepayMulticallEIP2612(
  market: MorphoBlueMarketParams,
  amount: bigint,
  sharesToRepay: bigint,
  maxSharePriceE27: bigint,
  account: string,
): Promise<`0x${string}`> {
  const user = getAddress(account)
  const loanToken = getAddress(market.loanToken)
  const adapter = getAddress(GENERAL_ADAPTER1) // GeneralAdapter1 (0x4a6c)
  const zeroCb = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`

  // Same small buffer as the USDT path: the adapter's morphoRepay pull can slightly exceed the debt read
  // (accrued interest / rounding), so grant & pull a little extra — the trailing erc20Transfer refunds it.
  const pullAmount = amount + amount / 10000n + 1000n // ~0.01% + 1000 wei dust buffer

  const { v, r, s, deadline } = await signEIP2612Permit(loanToken, adapter, pullAmount, user)

  const permitCall = encodeFunctionData({
    abi: ERC20_PERMIT_ABI,
    functionName: "permit",
    args: [user, adapter, pullAmount, deadline, v, r, s],
  })
  const transferFromCall = encodeFunctionData({
    abi: GENERAL_ADAPTER1_ABI,
    functionName: "erc20TransferFrom",
    args: [loanToken, adapter, pullAmount],
  })
  // Repay by SHARES (assets=0) like app.morpho.org. NOTE: maxSharePriceE27 must be FINITE —
  // GeneralAdapter1 reverts on maxUint256 (arithmetic overflow).
  const repayCall = encodeFunctionData({
    abi: GENERAL_ADAPTER1_ABI,
    functionName: "morphoRepay",
    args: [market, 0n, sharesToRepay, maxSharePriceE27, user, "0x" as `0x${string}`],
  })
  const transferCall = encodeFunctionData({
    abi: GENERAL_ADAPTER1_ABI,
    functionName: "erc20Transfer",
    args: [loanToken, user, maxUint256],
  })

  return encodeFunctionData({
    abi: BUNDLER3_MULTICALL_ABI,
    functionName: "multicall",
    args: [[
      { to: loanToken, data: permitCall, value: 0n, skipRevert: false, callbackHash: zeroCb },
      { to: adapter, data: transferFromCall, value: 0n, skipRevert: false, callbackHash: zeroCb },
      { to: adapter, data: repayCall, value: 0n, skipRevert: false, callbackHash: zeroCb },
      { to: adapter, data: transferCall, value: 0n, skipRevert: false, callbackHash: zeroCb },
    ]],
  })
}
