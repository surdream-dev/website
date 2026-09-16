import { encodeFunctionData, decodeAbiParameters, getAddress } from "viem"
import { multicall } from "viem/actions"
import { sendTx } from "../core/tx"
import { publicClient } from "../core/provider"
import { ADDRESSES } from "../evm/addresses"
import { ERC20_ABI } from "../evm/abis"
import type { LendingAdapter, PoolRateInfo } from "./base"

// ========================================================================
// Fluid Vault T1 operate ABI — T1 CD Borrowing Pool
// operate(uint256 nftId_, int256 newCol_, int256 newDebt_, address to_)
//   payable returns (uint256 nftId, int256 supplyAmt, int256 borrowAmt)
// ========================================================================
const VAULT_T1_ABI = [{
  name: "operate",
  type: "function",
  stateMutability: "payable",
  inputs: [
    { name: "nftId_", type: "uint256" },
    { name: "newCol_", type: "int256" },
    { name: "newDebt_", type: "int256" },
    { name: "to_", type: "address" },
  ],
  outputs: [
    { name: "nftId", type: "uint256" },
    { name: "supplyAmt", type: "int256" },
    { name: "borrowAmt", type: "int256" },
  ],
}] as const

// ========================================================================
// Fluid fToken (ERC4626 Interest-Bearing Voucher) ABI — Stablecoin/Portfolio Liquidity Injection Path
// FUSDC/FUSDT: deposit (assets, receiver) into stablecoin, withdraw (assets, receiver, owner) redemption
// FWETH: depositNative (receiver) (msg.value) to ETH, withdrawNative (assets, receiver, owner) to redeem
// On-chain confirmation (2026-08-11): FUSDT/FUSDC/FWETH are all live contracts, asset () points to the underlying asset,
// convertToAssets/previewWithdraw/previewRedeem is readable.
// ========================================================================
const FLUID_TOKEN_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "redeem",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    name: "convertToAssets",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "assets", type: "uint256" }],
  },
] as const

const FLUID_ETH_ABI = [
  {
    name: "depositNative",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "receiver", type: "address" }],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "withdrawNative",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "convertToAssets",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "assets", type: "uint256" }],
  },
] as const

/** minInt256 — in operate means "Withdraw All/Repay All" */
const MIN_INT256 = -(2n ** 255n)

// ========================================================================
// T1 Vault pool configuration (each vault = one collateral + one debt asset)
// ========================================================================
interface VaultConfig {
  address: `0x${string}`
  collateral: `0x${string}`
  debt: `0x${string}`
}

const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
const WETH_ADDR = getAddress(ADDRESSES.tokens.WETH)
const USDC_ADDR = getAddress(ADDRESSES.tokens.USDC)
const USDT_ADDR = getAddress(ADDRESSES.tokens.USDT)
const WSTETH_ADDR = getAddress(ADDRESSES.tokens.wstETH)
const FUSDT_ADDR = getAddress(ADDRESSES.lending.fluid.FUSDT)
const FUSDC_ADDR = getAddress(ADDRESSES.lending.fluid.FUSDC)
const FWETH_ADDR = getAddress(ADDRESSES.lending.fluid.FWETH)

/** Fluid fToken share accuracy (consistent with underlying assets: USDC/USDT 6 bits, WETH 18 bits) */
const FTOKEN_DECIMALS: Record<string, number> = {
  [FUSDT_ADDR.toLowerCase()]: 6,
  [FUSDC_ADDR.toLowerCase()]: 6,
  [FWETH_ADDR.toLowerCase()]: 18,
}

const VAULT_CONFIGS: Record<string, VaultConfig> = {
  "eth-usdc": {
    address: getAddress("0x0c8c77b7ff4c2af7f6cebbe67350a490e3dd6cb3"),
    collateral: getAddress(ETH_ADDRESS),
    debt: USDC_ADDR,
  },
  "eth-usdt": {
    address: getAddress("0xe16a6f5359abb1f61ce71e25dd0932e3e00b00eb"),
    collateral: getAddress(ETH_ADDRESS),
    debt: USDT_ADDR,
  },
  // wstETH mortgage/ETH loan vault (fluid-eth pool)
  // On-chain confirmation: VaultEntireData [11] = wstETH (collateral), [13] = ETH (debt)
  "wsteth-eth": {
    address: getAddress(ADDRESSES.lending.fluid.vaults["wsteth-eth"]),
    collateral: WSTETH_ADDR,
    debt: getAddress(ETH_ADDRESS),
  },
}

/**
 * Conservative collateral factor (only for UX estimation of getAvailableBorrows, off-chain real LTV).
 * * Description:
 * - Fluid Vault T1 does not expose a simple LTV/liquidationThreshold getter (detected getVaultState/* liquidationMaxLtv/getVaultEntireData are both revert) and cannot accurately read the real maxLtv on the front-end.
 * - The real borrowing cap is forcibly checked on-chain by the Vault contract at the time of operation (), and excessive borrowing will directly revert,
 * Therefore, this constant only affects the "borrowable limit" display and the Max button, and does not affect the safety of funds.
 * - 92% is a conservative valuation of ETH/stablecoin pools (Fluid real maxLtv of such pools is usually ~93-94.5%),
 * It is deliberately low to avoid overestimating the amount of borrowable, and the actual borrowing is based on the on-chain check.
 * - If a non-ETH collateral pool is added (LTV may be lower), this value needs to be re-evaluated to avoid overestimation.
 */
const CONSERVATIVE_COLLATERAL_FACTOR = 92n // %

// ========================================================================
// Tool Functions
// ========================================================================
function normalize(token: string): string {
  const t = token.toLowerCase()
  if (t === WETH_ADDR.toLowerCase() || t === ETH_ADDRESS.toLowerCase()) return ETH_ADDRESS.toLowerCase()
  return t
}

function isEth(token: string): boolean {
  return normalize(token) === ETH_ADDRESS.toLowerCase()
}

/**
 * USDC/USDT/ETH → Fluid fToken Interest-Bearing Voucher (Liquidity Injection Target Contract):
 * USDT FUSDT, → USDC FUSDC→, ETH/weth FWETH →
 * Other assets (collateral such as wstETH) return null.
 */
function getFTokenFor(token: string): `0x${string}` | null {
  const t = normalize(token)
  if (t === USDT_ADDR.toLowerCase()) return FUSDT_ADDR
  if (t === USDC_ADDR.toLowerCase()) return FUSDC_ADDR
  if (t === ETH_ADDRESS.toLowerCase()) return FWETH_ADDR
  return null
}

function isFToken(token: string): boolean {
  const t = normalize(token)
  return t === FUSDT_ADDR.toLowerCase() || t === FUSDC_ADDR.toLowerCase() || t === FWETH_ADDR.toLowerCase()
}

/**
 * Fluid fToken exchange rate: 1 fToken ≈ how many underlying assets (such as 1 fUSDT ≈ 1.2002 USDT)
 * read by ERC4626 convertToAssets (1 share); returns 1 on failure (back of caller pocket).
 */
export async function getFluidLiquidityExchangeRate(tokenOrFToken: string): Promise<number> {
  try {
    const fToken = getFTokenFor(tokenOrFToken) ?? (isFToken(tokenOrFToken) ? getAddress(tokenOrFToken) : null)
    if (!fToken) return 1
    const decimals = FTOKEN_DECIMALS[fToken.toLowerCase()] ?? 18
    const oneShare = 10n ** BigInt(decimals)
    const assets = await publicClient.readContract({
      address: fToken,
      abi: FLUID_TOKEN_ABI,
      functionName: "convertToAssets",
      args: [oneShare],
    }) as bigint
    const rate = Number(assets) / Number(oneShare)
    return Number.isFinite(rate) && rate > 0 ? rate : 1
  } catch (e) {
    console.warn('[Fluid] fToken exchange rate 获取失败:', e)
    return 1
  }
}

/**
 * Stablecoin/Portfolio Liquidity Deposit's approve targets:
 * USDT FUSDT→, USDC FUSDC → (fToken pulls money from users through transferFrom, need to approve to fToken itself);
 * ETH → '' (depositNative goes msg.value, no need to approve).
 */
export function getFluidLiquiditySpender(token: string): string {
  const t = normalize(token)
  if (t === USDT_ADDR.toLowerCase()) return FUSDT_ADDR
  if (t === USDC_ADDR.toLowerCase()) return FUSDC_ADDR
  return ''
}

/**
 * Whether the current pool context is fluid-eth:
 * ETH in the fluid-eth pool is a liquid asset (walk FWETH fToken);
 * ETH in the fluid-usdt/fluid-usdc pool is a vault collateral (walk operate ()).
 */
function isEthLiquidityContext(poolId?: string): boolean {
  const p = (poolId || _currentPoolId || '').toLowerCase()
  return p === 'fluid-eth' || p === 'wsteth-eth'
}

/** Whether the asset should follow the fToken liquidity path in the current context (USDC/USDT is always liquid; ETH only fluid-eth pool) */
function useLiquidityPath(token: string, poolId?: string): boolean {
  if (isEth(token)) return isEthLiquidityContext(poolId)
  return getFTokenFor(token) !== null
}

/** Find vaults by debt assets (unique) */
function vaultByDebt(token: string): VaultConfig | null {
  const t = normalize(token)
  for (const v of Object.values(VAULT_CONFIGS)) {
    if (v.debt.toLowerCase() === t) return v
  }
  return null
}

/** Look for vaults by collateral (there may be multiple, e.g. ETH can be collateralized in USDC/USDT pool at the same time) */
function vaultsByCollateral(token: string): VaultConfig[] {
  const t = normalize(token)
  return Object.values(VAULT_CONFIGS).filter(v => v.collateral.toLowerCase() === t)
}

// ========================================================================
// VaultFactory ERC-721 ABI (Enumerate user-held NFTs to → get nftId)
// ========================================================================
const FACTORY_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    name: "tokenOfOwnerByIndex",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
] as const

const VAULT_RESOLVER_ABI = [
  {
    name: "vaultByNftId",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "nftId_", type: "uint256" }],
    outputs: [{ name: "vault_", type: "address" }],
  },
] as const

const FACTORY_ADDR = getAddress("0x324c5Dc1fC42c7a4D43d92df1eBA58a54d13Bf2d")
const RESOLVER_ADDR = getAddress("0xA5C3E16523eeeDDcC34706b0E6bE88b4c6EA95cC")
const FLUID_LIQUIDITY = getAddress(ADDRESSES.lending.fluid.liquidity)
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

// Multicall3 (Ethereum mainnet canonical address) - position query for batch execution of handwritten calldata
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11" as `0x${string}`
const MULTICALL3_AGGREGATE_ABI = [
  {
    name: "aggregate",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "blockNumber", type: "uint256" },
      { name: "returnData", type: "bytes[]" },
    ],
  },
] as const

const POSITION_BY_NFT_ABI = [
  {
    name: "positionByNftId",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [],
  },
] as const

// ========================================================================
// Fluid Liquidity Layer – view function (queries the position of the old fToken path)
// ========================================================================
const LIQUIDITY_VIEW_ABI = [
  {
    name: "supplyOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }, { name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "debtOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }, { name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const

// ========================================================================
// nftId cache (user's position NFT ID in vault)
// ========================================================================
const nftIdCache = new Map<string, Map<string, bigint>>()

function cacheGet(user: string, vault: string): bigint | undefined {
  return nftIdCache.get(user.toLowerCase())?.get(vault.toLowerCase())
}
function cacheSet(user: string, vault: string, nftId: bigint) {
  const u = user.toLowerCase()
  if (!nftIdCache.has(u)) nftIdCache.set(u, new Map())
  nftIdCache.get(u)!.set(vault.toLowerCase(), nftId)
}
function cacheClearUser(user: string) {
  nftIdCache.delete(user.toLowerCase())
}
/** Clear nftId cache for specified (user, vault) - NFT is destroyed after full extraction, old nftId is invalid */
function cacheClearVault(user: string, vault: string) {
  nftIdCache.get(user.toLowerCase())?.delete(vault.toLowerCase())
}

/** Batch discovery of all vault NFTs held by users (balanceOf 1 time + tokenOfOwnerByIndex/vaultByNftId 1 time each multicall) */
async function getUserNftIds(user: `0x${string}`): Promise<Map<string, bigint>> {
  const map = new Map<string, bigint>()
  const addr = getAddress(user)
  try {
    const balance = await publicClient.readContract({
      address: FACTORY_ADDR,
      abi: FACTORY_ABI,
      functionName: "balanceOf",
      args: [addr],
    }) as bigint
    if (balance <= 0n) return map

    const nftIds = await multicall(publicClient, {
      contracts: Array.from({ length: Number(balance) }, (_, i) => ({
        address: FACTORY_ADDR,
        abi: FACTORY_ABI,
        functionName: "tokenOfOwnerByIndex",
        args: [addr, BigInt(i)],
      })),
      allowFailure: false,
    }) as bigint[]

    const vaults = await multicall(publicClient, {
      contracts: nftIds.map(nftId => ({
        address: RESOLVER_ADDR,
        abi: VAULT_RESOLVER_ABI,
        functionName: "vaultByNftId",
        args: [nftId],
      })),
      allowFailure: false,
    }) as `0x${string}`[]

    for (let i = 0; i < nftIds.length; i++) {
      const vaultKey = vaults[i].toLowerCase()
      map.set(vaultKey, nftIds[i])
      // Fill the cache for getSupplyBalance/getBorrowBalance multiplexing
      cacheSet(user, vaultKey, nftIds[i])
    }
  } catch (e) {
    console.warn("[Fluid] getUserNftIds failed:", e)
  }
  return map
}

/** VaultFactory ERC-721 enum → query user nftId in specified vault */
async function getUserNftId(user: `0x${string}`, vaultAddress: string): Promise<bigint | null> {
  const cached = cacheGet(user, vaultAddress)
  if (cached !== undefined) return cached

  const addr = getAddress(user)
  try {
    const balance = await publicClient.readContract({
      address: FACTORY_ADDR,
      abi: FACTORY_ABI,
      functionName: "balanceOf",
      args: [addr],
    }) as bigint

    for (let i = 0; i < Number(balance); i++) {
      const nftId = await publicClient.readContract({
        address: FACTORY_ADDR,
        abi: FACTORY_ABI,
        functionName: "tokenOfOwnerByIndex",
        args: [addr, BigInt(i)],
      }) as bigint

      const v = await publicClient.readContract({
        address: RESOLVER_ADDR,
        abi: VAULT_RESOLVER_ABI,
        functionName: "vaultByNftId",
        args: [nftId],
      }) as `0x${string}`

      if (v.toLowerCase() === vaultAddress.toLowerCase()) {
        cacheSet(user, vaultAddress, nftId)
        return nftId
      }
    }
  } catch (e) {
    console.warn("[Fluid] getUserNftId failed:", e)
  }
  return null
}

// UserPosition = Header 384 bytes (12 × 32) of return data
const USER_POSITION_TYPE = {
  type: "tuple",
  components: [
    { type: "uint256" },  // nftId
    { type: "address" },  // owner
    { type: "bool" },     // isLiquidated
    { type: "bool" },     // isSupplyPosition
    { type: "int256" },   // tick
    { type: "uint256" },  // tickId
    { type: "uint256" },  // beforeSupply
    { type: "uint256" },  // beforeBorrow
    { type: "uint256" },  // beforeDustBorrow
    { type: "uint256" },  // supply ←
    { type: "uint256" },  // borrow ←
    { type: "uint256" },  // dustBorrow
  ],
} as const

/** Decode the original return data of positionByNftId (take the first 384 bytes of UserPosition) */
function decodeUserPositionData(returnData: `0x${string}`): { supply: bigint; borrow: bigint } | null {
  if (!returnData || returnData === "0x") return null
  const userPosHex = ("0x" + returnData.slice(2, 2 + 768)) as `0x${string}`
  const [decoded] = decodeAbiParameters([USER_POSITION_TYPE], userPosHex)
  return {
    supply: decoded[9] as unknown as bigint,
    borrow: decoded[10] as unknown as bigint,
  }
}

// ========================================================================
// VaultResolver.positionByNftId — Query user position details (deposits, borrowings)
// Returns (UserPosition, VaultEntireData) where the fields of the UserPosition are:
// [0] nftId, [1] owner, [2-8] internal field,
//   [9] supply (uint256), [10] borrow (uint256), [11] dustBorrow
// UserPosition fixed 12 32-byte fields = 384 bytes
// ========================================================================
async function getUserPosition(
  nftId: bigint,
): Promise<{ supply: bigint; borrow: bigint } | null> {
  try {
    const calldata = encodeFunctionData({
      abi: [{ name: "positionByNftId", type: "function", inputs: [{ type: "uint256" }], outputs: [] }],
      functionName: "positionByNftId",
      args: [nftId],
    })
    const result = await publicClient.call({
      to: RESOLVER_ADDR,
      data: calldata,
    })
    if (!result.data || result.data === "0x") return null
    return decodeUserPositionData(result.data as `0x${string}`)
  } catch (e) {
    console.warn("[Fluid] getUserPosition failed:", e)
    return null
  }
}

/** Batch query for positions with multiple NFTs (Multicall3 aggregate one call) */
async function getUserPositions(
  nftIds: bigint[],
): Promise<Array<{ supply: bigint; borrow: bigint } | null>> {
  if (nftIds.length === 0) return []
  try {
    const calldatas = nftIds.map(nftId => encodeFunctionData({
      abi: POSITION_BY_NFT_ABI,
      functionName: "positionByNftId",
      args: [nftId],
    }))
    const result = await publicClient.readContract({
      address: MULTICALL3_ADDRESS,
      abi: MULTICALL3_AGGREGATE_ABI,
      functionName: "aggregate",
      args: [calldatas.map(cd => ({ target: RESOLVER_ADDR, callData: cd }))],
    })
    const [, returnData] = result as [bigint, `0x${string}`[]]
    return returnData.map(d => decodeUserPositionData(d))
  } catch (e) {
    console.warn("[Fluid] getUserPositions batch failed:", e)
    return nftIds.map(() => null)
  }
}

// ========================================================================
// Pool Context (required for supply/withdraw as ETH collateral may correspond to multiple vaults)
// The component calls the setFluidPool (poolId) setting and then operates
// ========================================================================
let _currentPoolId = ""

export function setFluidPool(poolId: string) {
  // pool format: "fluid-usdc", "fluid-usdt", "fluid-eth" → Remove "fluid-" prefix
  const stripped = poolId.replace(/^fluid-/i, "")
  // Key mapped to vault_configs
  const POOL_KEY_MAP: Record<string, string> = {
    usdc: "eth-usdc",
    usdt: "eth-usdt",
    eth: "wsteth-eth", // fluid-eth pool = wstETH mortgage/ETH loan
  }
  _currentPoolId = POOL_KEY_MAP[stripped] || stripped
}

/** resolveVaultForCollateral: → find the corresponding vault based on the collateral (may be disambiguated) */
function resolveVaultForCollateral(token: string): VaultConfig | null {
  const candidates = vaultsByCollateral(token)
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  // Multi-candidate → priority walk pool context
  if (_currentPoolId && VAULT_CONFIGS[_currentPoolId]) {
    return VAULT_CONFIGS[_currentPoolId]
  }
  // Otherwise default first
  return candidates[0]
}

/** poolId (fluid-usdc/fluid-usdt/fluid-eth)→ corresponds to VaultConfig */
function getVaultByPoolId(poolId: string): VaultConfig | null {
  const stripped = poolId.replace(/^fluid-/i, "")
  const POOL_KEY_MAP: Record<string, string> = {
    usdc: "eth-usdc",
    usdt: "eth-usdt",
    eth: "wsteth-eth",
  }
  const key = POOL_KEY_MAP[stripped] || stripped
  return VAULT_CONFIGS[key] || null
}

// ========================================================================
// Interest rate query ABI (Resolver → getOverallTokenData)
// ========================================================================
const FLUID_RESOLVER_ADDR = getAddress(ADDRESSES.lending.fluid.resolver)
const FLUID_RESOLVER_ABI = [{
  name: "getOverallTokenData",
  type: "function",
  stateMutability: "view",
  inputs: [{ name: "token", type: "address" }],
  outputs: [{
    type: "tuple",
    components: [
      { name: "borrowRate", type: "uint256" },
      { name: "supplyRate", type: "uint256" },
      { name: "fee", type: "uint256" },
      { name: "lastStoredUtilization", type: "uint256" },
      { name: "storageUpdateThreshold", type: "uint256" },
      { name: "lastUpdateTimestamp", type: "uint256" },
      { name: "supplyExchangePrice", type: "uint256" },
      { name: "borrowExchangePrice", type: "uint256" },
      { name: "supplyRawInterest", type: "uint256" },
      { name: "supplyInterestFree", type: "uint256" },
      { name: "borrowRawInterest", type: "uint256" },
      { name: "borrowInterestFree", type: "uint256" },
      { name: "totalSupply", type: "uint256" },
      { name: "totalBorrow", type: "uint256" },
      { name: "revenue", type: "uint256" },
      { name: "maxUtilization", type: "uint256" },
      { name: "rateData", type: "tuple", components: [
        { name: "version", type: "uint256" },
        { name: "kink", type: "uint256" },
        { name: "rateAtUtilizationZero", type: "uint256" },
        { name: "rateAtUtilizationKink", type: "uint256" },
        { name: "rateAtUtilizationMax", type: "uint256" },
        { name: "kink1", type: "uint256" },
        { name: "rateAtUtilizationKink1", type: "uint256" },
        { name: "kink2", type: "uint256" },
        { name: "rateAtUtilizationKink2", type: "uint256" },
      ]},
    ],
  }],
}] as const

/** Chainlink ETH/USD oracle */
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
const ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"

/** wstETH contract — stEthPerToken only, used to calculate wstETH/ETH exchange rate */
const WSTETH_STETH_PER_TOKEN_ABI = [{
  name: "stEthPerToken",
  type: "function",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "uint256" }],
}] as const

// Fluid Official rest v2 API (officially hosted, key-free, browser CORS available)
// Document: https://docs.fluid.instadapp.io/fluid-integration/borrow/read/vaults.html
const FLUID_REST_BASE = 'https://api.fluid.io/v2'

// Vault for Project Fluid Pool:
// vault 11 = deposit ETH borrow USDC (fluid-usdc), vault 12 = deposit ETH borrow USDT (fluid-usdt),
// vault 13 = Save wstETH and borrow ETH (fluid-eth).
// assetAddress uses the borrowed asset as the key (fluid-eth front-end loanAssetAddress is an ETH placeholder, normKey is mapped to WETH).
const FLUID_VAULTS: Array<{ poolId: string; vaultId: number; loanAsset: string }> = [
  { poolId: 'fluid-usdc', vaultId: 11, loanAsset: USDC_ADDR },
  { poolId: 'fluid-usdt', vaultId: 12, loanAsset: USDT_ADDR },
  { poolId: 'fluid-eth', vaultId: 13, loanAsset: WETH_ADDR },
]

interface FluidVaultData {
  supplyRate?: { vault?: { rate?: string | number } }
  borrowRate?: { vault?: { rate?: string | number } }
  totalSupply?: string | number
  totalBorrow?: string | number
  collateralFactor?: string | number
  liquidationThreshold?: string | number
  liquidationPenalty?: string | number
  supplyToken?: { token0?: { decimals?: number; stakingApr?: string | number } }
  borrowToken?: { token0?: { decimals?: number } }
}

/**
 * Pull the real-time interest rate of the project pool and the pool total from the official rest of Fluid by vault id (11/12/13).
 * Each pool is cross-asset vault: total supply is collateral (ETH/wstETH), total borrowings are borrowed assets (USDC/USDT/ETH),
 * Precision is distinguished by supplyDecimals/borrowDecimals for front-end proper formatting.
 */
async function fetchFluidVaultMarketData(): Promise<PoolRateInfo[] | null> {
  try {
    // Pull both vault (mortgage/borrowing rate) and tokens (liquidity supply rate for borrowed assets, e.g. fUSDC 4.75%)
    const [results, tokensRes] = await Promise.all([
      Promise.all(FLUID_VAULTS.map(async v => {
        const res = await fetch(`${FLUID_REST_BASE}/1/vaults/${v.vaultId}`)
        if (!res.ok) throw new Error(`vault ${v.vaultId} HTTP ${res.status}`)
        return res.json()
      })),
      fetch(`${FLUID_REST_BASE}/lending/1/tokens`),
    ])
    if (!tokensRes.ok) throw new Error(`tokens HTTP ${tokensRes.status}`)
    const tokensJson: any = await tokensRes.json()
    const liquidityApyByAsset = new Map<string, number>()
    for (const t of Array.isArray(tokensJson?.data) ? tokensJson.data : []) {
      const addr = (t?.assetAddress || '').toLowerCase()
      if (addr) liquidityApyByAsset.set(addr, Number(t?.supplyRate || 0) / 100)
    }

    const result: PoolRateInfo[] = []
    for (let i = 0; i < FLUID_VAULTS.length; i++) {
      const v = FLUID_VAULTS[i]
      const data: FluidVaultData = results[i]
      if (!data?.supplyRate?.vault?.rate) continue
      // Supply Apr = vault supplyRate + collateral staking Apr (e.g. wstETH 2.21%),
      // Consistent with the display caliber of the official Fluid app (vault 13: 0.03% + 2.21% = 2.24%)
      const stakingApr = Number(data.supplyToken?.token0?.stakingApr || 0) / 100
      // Fluid official rest directly returns the vault risk parameter (bps, e.g. 8700 = 87%):
      // vault 11/12 (USDC/USDT pool) penalty = 100 → 1%; vault 13 (wstETH pool) penalty = 10 → 0.1%
      const collateralFactor = Number(data.collateralFactor || 0) / 100
      const liquidationThreshold = Number(data.liquidationThreshold || 0) / 100
      const liquidationPenalty = Number(data.liquidationPenalty || 0) / 100
      result.push({
        assetAddress: v.loanAsset.toLowerCase(),
        // Fluid rate unit is percent × 100 (172 → 1.72%)
        supplyAPY: Number(data.supplyRate.vault.rate) / 100 + stakingApr,
        borrowAPY: Number(data.borrowRate?.vault?.rate || 0) / 100,
        totalSupply: BigInt(String(data.totalSupply ?? 0)),
        totalBorrow: BigInt(String(data.totalBorrow ?? 0)),
        supplyDecimals: data.supplyToken?.token0?.decimals || 18,
        borrowDecimals: data.borrowToken?.token0?.decimals || 18,
        // Liquidity supply rate for borrowed assets (fToken, e.g. fUSDC 4.75%/fUSDT 4.44%/fWETH 1.72%)
        liquidityAPY: liquidityApyByAsset.get(v.loanAsset.toLowerCase()) ?? 0,
        maxLtv: collateralFactor > 0 ? collateralFactor : undefined,
        liquidationThreshold: liquidationThreshold > 0 ? liquidationThreshold : undefined,
        liquidationPenalty: liquidationPenalty > 0 ? liquidationPenalty : undefined,
      })
    }

    // Additional collateral asset entries (Asset to supply/Your supplies by collateral asset matching supplyAPY):
    // vault 11/12 mortgage ETH (1.72%), vault 13 mortgage wstETH (0.03% + staking 2.21% = 2.24%)
    // These entries also carry the vault risk params so the Supply modal can read the collateral's own
    // Max LTV / Liq. Threshold / Penalty directly (ETH→vault 11/12: 87/92/1; wstETH→vault 13: 95/97/0.1),
    // instead of the front-end falling back to a WETH-lookup that grabs a different vault's loan asset.
    const collateralByAsset = new Map<string, {
      supplyAPY: number; liquidityAPY: number
      maxLtv?: number; liquidationThreshold?: number; liquidationPenalty?: number
    }>()
    for (let i = 0; i < FLUID_VAULTS.length; i++) {
      const data = results[i]
      const st = data?.supplyToken?.token0
      if (!st?.address || !data?.supplyRate?.vault?.rate) continue
      const addr = st.address.toLowerCase()
      const stakingApr = Number(st.stakingApr || 0) / 100
      const existing = collateralByAsset.get(addr) || { supplyAPY: 0, liquidityAPY: 0 }
      existing.supplyAPY = Math.max(existing.supplyAPY, Number(data.supplyRate.vault.rate) / 100 + stakingApr)
      // All vaults sharing a collateral asset (11 & 12 both collateral ETH) have the same risk, so first-wins is safe.
      if (existing.maxLtv === undefined) {
        existing.maxLtv = Number(data.collateralFactor || 0) / 100
        existing.liquidationThreshold = Number(data.liquidationThreshold || 0) / 100
        existing.liquidationPenalty = Number(data.liquidationPenalty || 0) / 100
      }
      collateralByAsset.set(addr, existing)
    }
    for (const [addr, entry] of collateralByAsset) {
      if (result.some(r => r.assetAddress === addr)) continue
      // ETH collateral liquidity rate takes fWETH (tokens endpoint key is WETH)
      const fTokenKey = addr === ETH_ADDRESS.toLowerCase() ? WETH_ADDR.toLowerCase() : addr
      result.push({
        assetAddress: addr,
        supplyAPY: entry.supplyAPY,
        borrowAPY: 0,
        totalSupply: 0n,
        totalBorrow: 0n,
        supplyDecimals: 18,
        borrowDecimals: 18,
        liquidityAPY: liquidityApyByAsset.get(fTokenKey) ?? 0,
        maxLtv: entry.maxLtv,
        liquidationThreshold: entry.liquidationThreshold,
        liquidationPenalty: entry.liquidationPenalty,
      })
    }
    return result.length > 0 ? result : null
  } catch (e) {
    console.warn('[Fluid] REST vault market data 获取失败，回退链上读取:', e)
    return null
  }
}

// ========================================================================
// Fluid LendingAdapter Implementation
// ========================================================================
export const fluid: LendingAdapter = {
  // ---- Supply: fToken/vault ----
  // USDC/USDT → FUSDC/FUSDT.deposit (assets, receiver) (Stablecoin Page + Portfolio Liquidity Panel)
  // ETH (fluid-eth pool)→ FWETH.depositNative (receiver), msg.value = deposit ETH
  // wstETH/ETH (fluid-usdt, fluid-usdc pool collateral)→ vault operate ()
  // operate (already has nftId or 0, + amount, 0, user)
  // value = ETH with msg.value; ERC20 collateral (wstETH) value = 0, approve token→ vault first
  //
  // Single position strategy: multiplex if the vault already has an "active" position (supply > 0, NFT not destroyed);
  // Otherwise, create a new one with nftId = 0. Fluid will destroy the NFT after the collateral is fully withdrawn, so the next deposit will be a new number.
  async supply(token, amount, account) {
    if (!account) throw new Error("Account is required")

    // ---- fToken Liquidity Injection Path ----
    if (useLiquidityPath(token)) {
      const fToken = getFTokenFor(token)!
      if (isEth(token)) {
        // FWETH.depositNative (receiver), msg.value = Deposit ETH
        const data = encodeFunctionData({
          abi: FLUID_ETH_ABI,
          functionName: "depositNative",
          args: [getAddress(account)],
        })
        return sendTx({
          to: fToken,
          data,
          value: amount,
          account: getAddress(account),
        })
      }
      // FUSDC/FUSDT.deposit (assets, receiver) (approve assets to fToken first, see getFluidLiquiditySpender)
      const data = encodeFunctionData({
        abi: FLUID_TOKEN_ABI,
        functionName: "deposit",
        args: [amount, getAddress(account)],
      })
      return sendTx({
        to: fToken,
        data,
        value: 0n,
        account: getAddress(account),
      })
    }

    const vault = resolveVaultForCollateral(token)
    if (!vault) throw new Error(`Fluid: no vault for collateral ${token}`)

    let nftId = 0n
    const existingNftId = await getUserNftId(getAddress(account), vault.address)
    if (existingNftId !== null) {
      const pos = await getUserPosition(existingNftId)
      if (pos && pos.supply > 0n) {
        nftId = existingNftId // Active Positions, Multiplexing
      } else {
        // The cached nftId is invalid (the position is fully extracted and destroyed)→ Clear the cache, create a new one
        cacheClearVault(account, vault.address)
      }
    }

    const data = encodeFunctionData({
      abi: VAULT_T1_ABI,
      functionName: "operate",
      args: [nftId, amount, 0n, getAddress(account)],
    })

    return sendTx({
      to: vault.address,
      data,
      value: isEth(token) ? amount : 0n,
      account: getAddress(account),
    })
  },

  // ----Withdraw: Withdraw liquidity (fToken)/collateral (vault) ----
  // USDC/USDT → FUSDC/FUSDT.withdraw (assets, receiver, owner) (input is the number of underlying assets)
  // ETH (fluid-eth pool)→ FWETH.withdrawNative (assets, receiver, owner)
  // wstETH/ETH (fluid-usdt, fluid-usdc pool collateral)→ vault operate ()
  // operate(nftId, -amount, 0, user)
  // If all collateral is withdrawn (amount > = current supply), Fluid will destroy the position NFT,
  // The nftId cache needs to be cleared so that the next deposit re-enumeration gets a new number.
  async withdraw(token, amount, account) {
    if (!account) throw new Error("Account is required")

    // ---- fToken Liquidity Extraction Path ----
    if (useLiquidityPath(token)) {
      const fToken = getFTokenFor(token)!
      if (isEth(token)) {
        const data = encodeFunctionData({
          abi: FLUID_ETH_ABI,
          functionName: "withdrawNative",
          args: [amount, getAddress(account), getAddress(account)],
        })
        return sendTx({ to: fToken, data, value: 0n, account: getAddress(account) })
      }
      const data = encodeFunctionData({
        abi: FLUID_TOKEN_ABI,
        functionName: "withdraw",
        args: [amount, getAddress(account), getAddress(account)],
      })
      return sendTx({ to: fToken, data, value: 0n, account: getAddress(account) })
    }

    const vault = resolveVaultForCollateral(token)
    if (!vault) throw new Error(`Fluid: no vault for collateral ${token}`)

    const nftId = await getUserNftId(getAddress(account), vault.address)
    if (nftId === null) throw new Error("Fluid: no position found")

    // Read the current supply to determine if the full amount is extracted
    let isFullWithdraw = false
    const pos = await getUserPosition(nftId)
    if (pos && pos.supply > 0n && amount >= pos.supply) isFullWithdraw = true

    // Full extraction using min_INT256 ("Extract all" semantics to avoid dust residue → NFT destruction);
    // -amount for partial extraction.
    const newCol = isFullWithdraw ? MIN_INT256 : -amount
    const data = encodeFunctionData({
      abi: VAULT_T1_ABI,
      functionName: "operate",
      args: [nftId, newCol, 0n, getAddress(account)],
    })

    const hash = await sendTx({
      to: vault.address,
      data,
      value: 0n,
      account: getAddress(account),
    })

    if (isFullWithdraw) cacheClearVault(account, vault.address)
    return hash
  },

  // ----Borrow: Borrow--
  // USDC/USDT → operate(nftId, 0, +amount, user)
  async borrow(token, amount, account) {
    if (!account) throw new Error("Account is required")
    const vault = vaultByDebt(token)
    if (!vault) throw new Error(`Fluid: no vault for debt ${token}`)

    const nftId = await getUserNftId(getAddress(account), vault.address)
    if (nftId === null) throw new Error("Fluid: no position found")

    const data = encodeFunctionData({
      abi: VAULT_T1_ABI,
      functionName: "operate",
      args: [nftId, 0n, amount, getAddress(account)],
    })

    return sendTx({
      to: vault.address,
      data,
      value: 0n,
      account: getAddress(account),
    })
  },

  // ---- Repay: Accurate Repayment ----
  // ERC20 debt (USDC/USDT): approve token→ vault first, operate value = 0, vault transferFrom pull
  // ETH debt (wsteth-eth pool): operate with msg.value = amount repayment (vault automatic wrap/unwrap, no approve required)
  async repay(token, amount, account) {
    if (!account) throw new Error("Account is required")
    const vault = vaultByDebt(token)
    if (!vault) throw new Error(`Fluid: no vault for debt ${token}`)

    const nftId = await getUserNftId(getAddress(account), vault.address)
    if (nftId === null) throw new Error("Fluid: no position found")

    const data = encodeFunctionData({
      abi: VAULT_T1_ABI,
      functionName: "operate",
      args: [nftId, 0n, -amount, getAddress(account)],
    })

    return sendTx({
      to: vault.address,
      data,
      value: isEth(token) ? amount : 0n,
      account: getAddress(account),
    })
  },

  // ---- RepayAll: Full Repayment ----
  // ERC20 debt: operate (nftId, 0, min_INT256, user) value = 0, vault transferFrom pull all
  // ETH debt: operate (nftId, 0, min_INT256, user) with msg.value = current debt + interest buffer, excess refund
  async repayAll(token, account) {
    if (!account) throw new Error("Account is required")
    const vault = vaultByDebt(token)
    if (!vault) throw new Error(`Fluid: no vault for debt ${token}`)

    const nftId = await getUserNftId(getAddress(account), vault.address)
    if (nftId === null) throw new Error("Fluid: no position found")

    let value = 0n
    if (isEth(token)) {
      // ETH debt repayAll needs msg.value to cover all arrears (including real-time interest), +0.1% buffer, balance refund
      const pos = await getUserPosition(nftId)
      const debt = pos?.borrow ?? 0n
      if (debt > 0n) value = debt + debt / 1000n + 1n
    }

    const data = encodeFunctionData({
      abi: VAULT_T1_ABI,
      functionName: "operate",
      args: [nftId, 0n, MIN_INT256, getAddress(account)],
    })

    return sendTx({
      to: vault.address,
      data,
      value,
      account: getAddress(account),
    })
  },

  async setCollateral() {
    throw new Error("Fluid auto-manages collateral")
  },

  // ---- getSupplyBalance: On-chain Balance Query ----
  // USDC/USDT → fToken share balanceOf → convertToAssets (number of underlying assets)
  // ETH (fluid-eth pool→) FWETH share → convertToAssets
  // Remaining (vault collateral)→ VaultResolver.positionByNftId Query user position data
  async getSupplyBalance(account: `0x${string}`, asset?: string, poolId?: string) {
    if (!asset) return 0n
    const addr = getAddress(account)

    // ---- fToken Liquidity Balance Path ----
    if (useLiquidityPath(asset, poolId)) {
      const fToken = getFTokenFor(asset)!
      try {
        const shares = await publicClient.readContract({
          address: fToken,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [addr],
        }) as bigint
        if (shares <= 0n) return 0n
        const assets = await publicClient.readContract({
          address: fToken,
          abi: isEth(asset) ? FLUID_ETH_ABI : FLUID_TOKEN_ABI,
          functionName: "convertToAssets",
          args: [shares],
        }) as bigint
        return assets
      } catch (e) {
        console.warn(`[Fluid] fToken supply balance query failed:`, e)
        return 0n
      }
    }

    // Scenario A: Vault Path (T1 Pool) - Prioritize targeting specific vaults by poolId to avoid cross-pool confusion
    const vaults = poolId ? (() => { const v = getVaultByPoolId(poolId); return v ? [v] : [] })()
      : Object.values(VAULT_CONFIGS).filter(v => v.collateral.toLowerCase() === normalize(asset))
    let total = 0n
    for (const v of vaults) {
      if (v.collateral.toLowerCase() !== normalize(asset)) continue
      const nftId = await getUserNftId(addr, v.address)
      if (nftId === null) continue
      const pos = await getUserPosition(nftId)
      if (pos) total += pos.supply
    }
    if (total > 0n) return total

    // Fallback Liquidity path (old fToken deposit) when no poolId or poolId positioning fails
    if (!poolId) {
      try {
        const liqToken = isEth(asset) ? WETH_ADDR : getAddress(asset)
        const liqSupply = await publicClient.readContract({
          address: FLUID_LIQUIDITY,
          abi: LIQUIDITY_VIEW_ABI,
          functionName: "supplyOf",
          args: [addr, liqToken],
        }) as bigint
        if (liqSupply > 0n) return liqSupply
      } catch (e) {
        console.warn("[Fluid] Liquidity supplyOf query failed:", e)
      }
    }

    return 0n
  },

  // ---- getBorrowBalance: On-chain query of loan balances ----
  // Query by VaultResolver.positionByNftId
  async getBorrowBalance(account: `0x${string}`, asset?: string, poolId?: string) {
    if (!asset) return 0n
    const addr = getAddress(account)

    // Scenario A: Vault Path - Prioritize targeting specific vaults by poolId
    const vaults = poolId ? (() => { const v = getVaultByPoolId(poolId); return v ? [v] : [] })()
      : Object.values(VAULT_CONFIGS).filter(v => v.debt.toLowerCase() === normalize(asset))
    let total = 0n
    for (const v of vaults) {
      if (v.debt.toLowerCase() !== normalize(asset)) continue
      const nftId = await getUserNftId(addr, v.address)
      if (nftId === null) continue
      const pos = await getUserPosition(nftId)
      if (pos) total += pos.borrow
    }
    if (total > 0n) return total

    // Scenario B: Liquidity Path
    if (!poolId) {
      try {
        const liqToken = isEth(asset) ? WETH_ADDR : getAddress(asset)
        const liqDebt = await publicClient.readContract({
          address: FLUID_LIQUIDITY,
          abi: LIQUIDITY_VIEW_ABI,
          functionName: "debtOf",
          args: [addr, liqToken],
        }) as bigint
        if (liqDebt > 0n) return liqDebt
      } catch (e) {
        console.warn("[Fluid] Liquidity debtOf query failed:", e)
      }
    }

    return 0n
  },

  // ---- getAvailableBorrows: User debit limit (USD cents) ----
  // Calculated from position data + oracle + conservative clearing factor:
  //   maxBorrow = supplyUSD × collateralFactor
  // available = maxBorrow − Existing borrowings (all converted to cents)
  // The collateral may be ETH or wstETH, converted at their respective USD prices (wstETH ≠ ETH, higher value).
  async getAvailableBorrows(account: `0x${string}`) {
    let totalCents = 0n
    const addr = getAddress(account)

    // If the pool context (_currentPoolId) is set, only the debit limit for this vault is calculated
    // Avoid cross-pool aggregation (USDC + USDT + ETH) causing the borrow tab to display inflated debits
    const targetVaults = _currentPoolId && VAULT_CONFIGS[_currentPoolId]
      ? { [_currentPoolId]: VAULT_CONFIGS[_currentPoolId] }
      : VAULT_CONFIGS

    // ETH/USD Price (Chainlink, 8 decimal places)
    let ethPrice = 0n
    try {
      const priceResult = await publicClient.readContract({
        address: ETH_USD_FEED as `0x${string}`,
        abi: CHAINLINK_ABI,
        functionName: "latestRoundData",
        args: [],
      })
      ethPrice = BigInt((priceResult as any)[1])
    } catch (e) {
      console.warn("[Fluid] ETH price fetch failed:", e)
      return 0n
    }
    if (ethPrice <= 0n) return 0n

    // wstETH/USD price = stEthPerToken (18) × ETH/USD (8)/1e18 → 8 digits USD
    // Chainlink mainnet has no wstETH/ETH direct price source, use wstETH contract stEthPerToken () instead
    // stETH ≈ ETH (1: 1 anchoring) with minimal bias and no material impact on UX estimation of borrowable credit
    let wstethUsd = 0n
    try {
      const stEthPerToken = await publicClient.readContract({
        address: WSTETH_ADDR,
        abi: WSTETH_STETH_PER_TOKEN_ABI,
        functionName: "stEthPerToken",
        args: [],
      }) as bigint
      wstethUsd = stEthPerToken * ethPrice / 10n ** 18n
    } catch (e) {
      console.warn("[Fluid] wstETH stEthPerToken fetch failed:", e)
    }

    // Collateral → 8-bit USD unit price (collateral is 18-bit precision)
    const collatPrice = (collateral: string): bigint => {
      if (isEth(collateral)) return ethPrice
      if (collateral.toLowerCase() === WSTETH_ADDR.toLowerCase()) return wstethUsd
      return 0n
    }

    // Scenario A: Vault Path — Filter by Pool
    for (const [pairId, v] of Object.entries(targetVaults)) {
      const nftId = await getUserNftId(addr, v.address)
      if (nftId === null) continue
      const pos = await getUserPosition(nftId)
      if (!pos || pos.supply <= 0n) continue

      try {
        const isStable = v.debt === USDC_ADDR || v.debt === USDT_ADDR
        const debtDecimals = isStable ? 6 : 18

        const price = collatPrice(v.collateral)
        if (price <= 0n) continue
        const supplyCents = pos.supply * price / 10n ** 24n
        const maxBorrowCents = supplyCents * CONSERVATIVE_COLLATERAL_FACTOR / 100n
        const currentBorrowCents = pos.borrow * 100n / BigInt(10 ** debtDecimals)

        if (maxBorrowCents <= currentBorrowCents) continue
        totalCents += maxBorrowCents - currentBorrowCents
      } catch (e) {
        console.warn(`[Fluid] getAvailableBorrows ${pairId}:`, e)
      }
    }

    // Option B: Liquidity Path (available on the old → fToken deposit lookup chain)
    if (totalCents === 0n) {
      try {
        for (const v of Object.values(targetVaults)) {
          const liqToken = isEth(v.collateral) ? WETH_ADDR : getAddress(v.collateral)
          const supply = await publicClient.readContract({
            address: FLUID_LIQUIDITY,
            abi: LIQUIDITY_VIEW_ABI,
            functionName: "supplyOf",
            args: [addr, liqToken],
          }) as bigint
          if (supply <= 0n) continue

          const price = collatPrice(v.collateral)
          if (price <= 0n) continue
          const isStable = v.debt === USDC_ADDR || v.debt === USDT_ADDR
          const debtDecimals = isStable ? 6 : 18
          const supplyCents = supply * price / 10n ** 24n
          const maxBorrowCents = supplyCents * CONSERVATIVE_COLLATERAL_FACTOR / 100n

          const debtToken = isEth(v.debt) ? WETH_ADDR : getAddress(v.debt)
          const debt = await publicClient.readContract({
            address: FLUID_LIQUIDITY,
            abi: LIQUIDITY_VIEW_ABI,
            functionName: "debtOf",
            args: [addr, debtToken],
          }) as bigint
          const currentBorrowCents = debt * 100n / BigInt(10 ** debtDecimals)

          if (maxBorrowCents > currentBorrowCents) {
            totalCents += maxBorrowCents - currentBorrowCents
          }
        }
      } catch (e) {
        console.warn("[Fluid] getAvailableBorrows Liquidity fallback:", e)
      }
    }

    return totalCents
  },

  async getHealthSnapshot(account: `0x${string}`, poolId?: string) {
    try {
      const vault = poolId ? getVaultByPoolId(poolId) : (VAULT_CONFIGS[_currentPoolId] || undefined)
      if (!vault) return undefined

      const addr = getAddress(account)
      const nftId = await getUserNftId(addr, vault.address)
      if (nftId === null) return undefined
      const pos = await getUserPosition(nftId)
      if (!pos || pos.supply <= 0n) return undefined

      // Liquidation threshold (bps) from the official REST vault config.
      const vaultId = FLUID_VAULTS.find(v => v.poolId === poolId)?.vaultId
      let liquidationThresholdBps = 0
      if (vaultId !== undefined) {
        try {
          const res = await fetch(`${FLUID_REST_BASE}/1/vaults/${vaultId}`)
          if (res.ok) {
            const json: any = await res.json()
            liquidationThresholdBps = Number(json?.liquidationThreshold || 0)
          }
        } catch (e) {
          console.warn('[Fluid] getHealthSnapshot liquidation threshold fetch failed:', e)
        }
      }

      // Collateral USD price (8-decimal); keep ETH price separately for ETH-denominated debt.
      let ethPrice = 0n
      let collatPrice = 0n
      try {
        const ethResult = await publicClient.readContract({
          address: ETH_USD_FEED as `0x${string}`,
          abi: CHAINLINK_ABI,
          functionName: "latestRoundData",
          args: [],
        })
        ethPrice = BigInt((ethResult as any)[1])
        if (isEth(vault.collateral)) {
          collatPrice = ethPrice
        } else if (vault.collateral.toLowerCase() === WSTETH_ADDR.toLowerCase()) {
          const rate = await publicClient.readContract({
            address: WSTETH_ADDR,
            abi: WSTETH_STETH_PER_TOKEN_ABI,
            functionName: "stEthPerToken",
            args: [],
          }) as bigint
          collatPrice = rate * ethPrice / 10n ** 18n
        }
      } catch (e) {
        console.warn('[Fluid] getHealthSnapshot price fetch failed:', e)
      }
      if (collatPrice <= 0n) return undefined

      const isStableDebt = vault.debt === USDC_ADDR || vault.debt === USDT_ADDR
      const debtDecimals = isStableDebt ? 6 : 18

      // 8-decimal USD values.
      const supplyUSD8 = pos.supply * collatPrice / 10n ** 18n
      const borrowUSD8 = isStableDebt
        ? pos.borrow * 100000000n / BigInt(10 ** debtDecimals)
        : pos.borrow * ethPrice / BigInt(10 ** debtDecimals)
      const riskAdjustedUSD8 = supplyUSD8 * BigInt(liquidationThresholdBps) / 10000n

      return {
        riskAdjustedCollateralUSD: Number(riskAdjustedUSD8) / 1e8,
        borrowUSD: Number(borrowUSD8) / 1e8,
        liquidationThresholdBps,
        isAccountLevel: false,
        scope: poolId || 'fluid',
      }
    } catch (e) {
      console.warn('[Fluid] getHealthSnapshot failed:', e)
      return undefined
    }
  },

  // ---- getBorrowBalances: asset-by-asset loan balances (portfolio preferred) ----
  async getBorrowBalances(account: `0x${string}`): Promise<Map<string, bigint>> {
    const addr = getAddress(account)
    const result = new Map<string, bigint>()

    for (const v of Object.values(VAULT_CONFIGS)) {
      try {
        const nftId = await getUserNftId(addr, v.address)
        if (nftId === null) continue
        const pos = await getUserPosition(nftId)
        if (!pos || pos.borrow <= 0n) continue

        const debtAddr = v.debt.toLowerCase()
        const existing = result.get(debtAddr) || 0n
        result.set(debtAddr, existing + pos.borrow)
      } catch (e) {
        console.warn(`[Fluid] getBorrowBalances vault ${v.address}:`, e)
      }
    }

    return result
  },

  // ---- getMarketData: Whole Market Rates ----
  async getMarketData(): Promise<PoolRateInfo[]> {
    // Use only the official Fluid rest vault endpoint (vault 11/12/13, browser cross-domain);
    // Failure returns an empty array with '-' displayed by the front-end, no on-chain fallback (official API and on-chain are two sets of data sources with different calibers)
    return (await fetchFluidVaultMarketData()) ?? []
  },

  // ---- discoverPositions: Discover all user Fluid Positions ----
  // fToken Liquidity Position (FUSDC/FUSDT/FWETH) + VaultResolver.positionByNftId Query vault position
  async discoverPositions(account: `0x${string}`) {
    const supplied: Array<{
      poolId: string; protocolId: string; protocol: string
      asset: string; assetAddress: string; collateral: boolean
    }> = []
    const borrowed: Array<{
      poolId: string; protocolId: string; protocol: string
      asset: string; assetAddress: string
    }> = []

    // ---- fToken Liquidity Position (Stablecoin Page/Portfolio "Your liquidity" Panel) ----
    const addr = getAddress(account)
    const FTOKEN_POSITIONS: Array<{ fToken: `0x${string}`; poolId: string; asset: string; assetAddress: string }> = [
      { fToken: FUSDT_ADDR, poolId: 'fluid-usdt', asset: 'USDT', assetAddress: USDT_ADDR },
      { fToken: FUSDC_ADDR, poolId: 'fluid-usdc', asset: 'USDC', assetAddress: USDC_ADDR },
      { fToken: FWETH_ADDR, poolId: 'fluid-eth', asset: 'ETH', assetAddress: getAddress(ETH_ADDRESS) },
    ]
    for (const pos of FTOKEN_POSITIONS) {
      try {
        const shares = await publicClient.readContract({
          address: pos.fToken,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [addr],
        }) as bigint
        if (shares > 0n) {
          supplied.push({
            poolId: pos.poolId,
            protocolId: 'fluid',
            protocol: 'fluid',
            asset: pos.asset,
            assetAddress: pos.assetAddress.toLowerCase(),
            collateral: false,
          })
        }
      } catch (e) {
        console.warn(`[Fluid] fToken position discovery failed (${pos.asset}):`, e)
      }
    }

    // The key of vault_configs (e.g. "eth-usdc") is mapped to the poolId used by the frontend (e.g. "fluid-usdc")
    const VAULT_KEY_TO_POOL_ID: Record<string, string> = {
      "eth-usdc": "fluid-usdc",
      "eth-usdt": "fluid-usdt",
      "wsteth-eth": "fluid-eth",
    }
    const collateralName = (c: string): string =>
      isEth(c) ? 'ETH' : c.toLowerCase() === WSTETH_ADDR.toLowerCase() ? 'wstETH' : ''
    const debtName = (d: string): string =>
      d === USDC_ADDR ? 'USDC' : d === USDT_ADDR ? 'USDT' : isEth(d) ? 'ETH' : ''

    // Batch discovery of all vault NFTs + batch query positions (multicall), reducing RPC requests
    const nftIdMap = await getUserNftIds(getAddress(account))
    const wanted: Array<{ pairId: string; v: (typeof VAULT_CONFIGS)[string]; nftId: bigint }> = []
    for (const [pairId, v] of Object.entries(VAULT_CONFIGS)) {
      const nftId = nftIdMap.get(v.address.toLowerCase())
      if (nftId !== undefined) wanted.push({ pairId, v, nftId })
    }
    if (wanted.length === 0) return { supplied, borrowed }

    const positions = await getUserPositions(wanted.map(w => w.nftId))
    for (let i = 0; i < wanted.length; i++) {
      const { pairId, v } = wanted[i]
      const pos = positions[i]
      if (!pos) continue

      if (pos.supply > 0n) {
        supplied.push({
          poolId: VAULT_KEY_TO_POOL_ID[pairId] || `fluid-${pairId}`,
          protocolId: 'fluid',
          protocol: 'fluid',
          asset: collateralName(v.collateral),
          assetAddress: v.collateral.toLowerCase(),
          collateral: true,
        })
      }
      if (pos.borrow > 0n) {
        borrowed.push({
          poolId: VAULT_KEY_TO_POOL_ID[pairId] || `fluid-${pairId}`,
          protocolId: 'fluid',
          protocol: 'fluid',
          asset: debtName(v.debt),
          assetAddress: v.debt.toLowerCase(),
        })
      }
    }

    return { supplied, borrowed }
  },
}
