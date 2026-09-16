/**
 * ERC20 Approve tool function
 * provides a common method for token authorization limit checking and authorization execution
 */

import { getAddress, encodeFunctionData, type Address, maxUint160, maxUint48 } from "viem"
import { publicClient } from "../core/provider"
import { sendTx } from "../core/tx"
import { ERC20_ABI, PERMIT2_ABI, PERMIT2_TYPES } from "../evm/abis"
import { ref, type Ref } from "vue"
import { ADDRESSES } from "../evm/addresses"

// Permit2 contract address
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address

/**
 * Sign Permit2 PermitSingle data
 * @param walletClient wallet client
 * @param tokenAddress token address
 * @param spender authorized object address (Morpho vault)
 * @param amount authorized
 * @returns signed data
 */
export async function signPermit2Single(
  walletClient: any,
  tokenAddress: string,
  spender: string,
  amount: bigint
): Promise<{ signature: `0x${string}`; permitSingle: any }> {
  const chainId = await publicClient.getChainId()

  // PermitSingle Data Structure
  const permitSingle = {
    details: {
      token: getAddress(tokenAddress),
      amount: amount > maxUint160 ? maxUint160 : amount as any,
      expiration: maxUint48 as any, // It never expires
      nonce: 0 as any
    },
    spender: getAddress(spender),
    sigDeadline: Math.floor(Date.now() / 1000) + 3600 as any // Expires in 1 hour
  }


  // EIP-712 Signature
  const signature = await walletClient.signTypedData({
    domain: {
      name: 'Permit2',
      chainId,
      verifyingContract: PERMIT2_ADDRESS
    },
    types: PERMIT2_TYPES,
    primaryType: 'PermitSingle',
    message: permitSingle
  })


  return { signature, permitSingle }
}

/**
 * Check token authorization limit
 * @param tokenAddress token contract address
 * @param owner token owner address
 * @param spender authorized spender address
 * @param amount Amount to check (wei unit)
 * @returns whether authorization is required (true = authorization required, false = authorized)
 */
export async function checkAllowance(
  tokenAddress: string,
  owner: Address,
  spender: Address,
  amount: bigint
): Promise<boolean> {
  try {
    const allowance = await publicClient.readContract({
      address: getAddress(tokenAddress),
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [owner, getAddress(spender)]
    }) as bigint

    const needsApprove = allowance < amount


    return needsApprove
  } catch (error) {
    console.error('[Approve] Failed to check allowance:', error)
    return true // Authorization is required by default on error
  }
}

/**
 * Execute Token Authorization
 * @param tokenAddress Token Contract Address
 * @param spender Authorized spender address
 * @param amount Authorized amount (wei unit)
 * @param account Optional: Known address, avoid wallet requests
 * @returns Transaction hash
 */
export async function approve(
  tokenAddress: string,
  spender: Address,
  amount: bigint,
  account?: Address
): Promise<string> {

  const tokenAddr = getAddress(tokenAddress)
  const spenderAddr = getAddress(spender)

  // USDT special treatment: Must approve (0) before approve (new limit)
  // USDT Address: 0xdAC17F958D2ee523a2206206994597C13D831ec7
  const USDT = ADDRESSES.tokens.USDT.toLowerCase()
  const isUSDT = tokenAddress.toLowerCase() === USDT

  if (isUSDT && account && amount > 0) {
    // Review current authorization limit
    const currentAllowance = await publicClient.readContract({
      address: tokenAddr,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account, spenderAddr]
    }) as bigint


    // If you currently have a non-zero authorization, you need to approve (0) first
    if (currentAllowance > 0) {

      const resetData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spenderAddr, 0n]
      })

      const resetHash = await sendTx({
        to: tokenAddr,
        data: resetData,
        account
      })

      // Waiting for reset transaction confirmation
      await publicClient.waitForTransactionReceipt({
        hash: resetHash as `0x${string}`,
        timeout: 45000
      })

    }
  }

  // Execute approve
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spenderAddr, amount]
  })

  const txHash = await sendTx({
    to: tokenAddr,
    data,
    account
  })

  return txHash
}

/**
 * Check Morpho Permit2 authorization status
 * 1. Check if the token has been approved to Permit2
 * 2. If authorized, returns false (no approve required)
 * @param tokenAddress Token Contract Address
 * @param owner User Address
 * @param amount Required Amount
 * @returns Whether authorization is required
 */
export async function checkMorphoAllowance(
  tokenAddress: string,
  owner: Address,
  amount: bigint
): Promise<boolean> {
  try {
    // Morpho Process: Check Token Authorization for Permit2
    const allowance = await publicClient.readContract({
      address: getAddress(tokenAddress),
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [owner, PERMIT2_ADDRESS]
    }) as bigint

    // If Permit2 has sufficient authorization, there is no need to approve again
    // Users only need to sign PermitSingle
    const needsApprove = allowance < amount


    return needsApprove
  } catch (error) {
    console.error('[Morpho] Failed to check allowance:', error)
    return true
  }
}

/**
 * Execute Morpho Pre-approve: approve token Permit2 →
 * Standard ERC20 approve, only need to do once
 * @param tokenAddress token address
 * @param amount authorized amount
 * @param account user address
 * @returns transaction hash
 */
export async function approveMorphoToken(
  tokenAddress: string,
  amount: bigint,
  account?: Address
): Promise<string> {

  const tokenAddr = getAddress(tokenAddress)
  const spenderAddr = PERMIT2_ADDRESS

  // USDT special treatment: Must approve (0) before approve (new limit)
  const USDT = ADDRESSES.tokens.USDT.toLowerCase()
  const isUSDT = tokenAddress.toLowerCase() === USDT

  if (isUSDT && account && amount > 0) {
    const currentAllowance = await publicClient.readContract({
      address: tokenAddr,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account, spenderAddr]
    }) as bigint


    if (currentAllowance > 0) {
      const resetData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spenderAddr, 0n]
      })

      const resetHash = await sendTx({
        to: tokenAddr,
        data: resetData,
        account
      })

      await publicClient.waitForTransactionReceipt({
        hash: resetHash as `0x${string}`,
        timeout: 45000
      })

    }
  }

  // Standard ERC20 approve: approve (spender, amount)
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spenderAddr, amount]
  })

  const txHash = await sendTx({
    to: tokenAddr,
    data,
    account
  })

  return txHash
}

/**
 * Get nonce of Permit2
 * Permit2 uses bitmap to store nonce and needs to be queried
 */
export async function getPermit2Nonce(
  owner: Address
): Promise<number> {
  try {
    // Query nonce bitmap for Permit2
    // Usually starts with 0
    return 0
  } catch {
    return 0
  }
}

/**
 * Construct Morpho PermitSingle signature data
 * @param tokenAddress token address
 * @param spender vault address
 * @param amount authorized amount
 * @param owner user address
 * @returns PermitSingle data structure
 */
export async function buildMorphoPermitSingle(
  tokenAddress: string,
  spender: string,
  amount: bigint,
  owner: Address
): Promise<any> {
  const chainId = await publicClient.getChainId()
  const nonce = await getPermit2Nonce(owner)

  // PermitSingle Structure
  const permitSingle = {
    details: {
      token: getAddress(tokenAddress),
      amount: (amount > maxUint160 ? maxUint160 : amount) as any,
      expiration: maxUint48 as any, // It never expires
      nonce: nonce as any
    },
    spender: getAddress(spender),
    sigDeadline: BigInt(Math.floor(Date.now() / 1000) + 3600) as any // Expires in 1 hour
  }


  return permitSingle
}

/**
 * Signature Morpho PermitSingle
 * Wallet client required
 * @param walletClient wallet client
 * @param permitSingle PermitSingle data
 * @returns signature
 */
export async function signMorphoPermitSingle(
  walletClient: any,
  permitSingle: any
): Promise<`0x${string}`> {
  const chainId = await publicClient.getChainId()

  const signature = await walletClient.signTypedData({
    domain: {
      name: 'Permit2',
      chainId,
      verifyingContract: PERMIT2_ADDRESS
    },
    types: PERMIT2_TYPES,
    primaryType: 'PermitSingle',
    message: permitSingle
  })

  return signature
}

/**
 * Check Permit2 internal authorization limit
 * Permit2.allowance (owner, token, spender) - > (amount, expiration)
 * Used to determine if Permit2.approve () needs to be called
 */
const PERMIT2_ALLOWANCE_ABI = [{
  name: 'allowance',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'owner', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'spender', type: 'address' }
  ],
  outputs: [
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' }
  ]
}] as const

export async function checkPermit2Allowance(
  tokenAddress: string,
  owner: Address,
  spender: Address,
  amount: bigint
): Promise<boolean> {
  try {
    const result = await publicClient.readContract({
      address: PERMIT2_ADDRESS,
      abi: PERMIT2_ALLOWANCE_ABI,
      functionName: 'allowance',
      args: [owner, getAddress(tokenAddress), spender]
    }) as [bigint, bigint]

    const permitAllowance = result[0]
    const expiration = result[1]
    const isExpired = expiration < BigInt(Math.floor(Date.now() / 1000))
    const needsApprove = permitAllowance < amount || isExpired


    return needsApprove
  } catch (error) {
    console.error('[Permit2] Failed to check internal allowance:', error)
    return true
  }
}

/**
 * Perform Permit2.approve authorization
 * Set the Permit2 internal token authorization limit (allowance [owner] [token] [spender])
 * This is a necessary step to authorize contracts such as GeneralAdapter1 to pull coins through Permit2
 * Different from ERC20 approve, which is an authorization inside Permit2
 */
export async function approvePermit2(
  tokenAddress: string,
  spender: Address,
  amount: bigint,
  account?: Address
): Promise<string> {

  const data = encodeFunctionData({
    abi: PERMIT2_ABI,
    functionName: 'approve',
    args: [
      getAddress(tokenAddress),
      spender,
      amount > maxUint160 ? maxUint160 : amount,
      maxUint48 // It never expires
    ]
  })

  const txHash = await sendTx({
    to: PERMIT2_ADDRESS,
    data,
    account
  })

  return txHash
}

/**
 * Get the token address of approve
 * For some protocols, the token and asset of approve are different
 * For example, SparkLend ETH requires the token address of approve WETH
 * @param protocolId protocol ID
 * @param assetAddress asset address
 * @returns approve
 */
export function getApproveTokenAddress(
  protocolId: string,
  assetAddress?: string
): string | null {
  const pid = protocolId.toLowerCase()

  // SparkLend ETH requires approve WETH
  if (pid === 'sparklend' && assetAddress) {
    const asset = assetAddress.toLowerCase()
    const eth = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'.toLowerCase()
    if (asset === eth) {
      // ETH -> approve WETH
      return ADDRESSES.tokens.WETH
    }
  }

  // Otherwise, approve token = asset
  return null
}

/**
 * Get the spender address corresponding to the protocol
 * @param protocolId protocol ID (aave, compound, ethena, etc.)
 * @param category category (lending, stablecoin, stake)
 * @param assetAddress Optional: Asset address (Compound V3 needs to determine the spender based on the asset)
 * @param isGasToken Optional: Whether it is a Gas Token (ETH), used for Aave ETH withdraw judgment
 * @returns spender contract address, empty string means approve is not required
 */
export function getSpenderAddress(
  protocolId: string,
  category: 'lending' | 'stablecoin' | 'stake',
  assetAddress?: string,
  isGasToken?: boolean,
  poolId?: string
): string {
  const pid = protocolId.toLowerCase()

  if (category === 'lending') {
    switch (pid) {
      case 'aave':
        // Aave ETH supply: wrap ETH WETH + approve WETH is required to use → WETH_gateway
        // Aave non-ETH supply: approve token to Aave Pool
        // Aave ETH withdraw: Approve aWETH to WETH_gateway is required
        // Aave non-ETH withdraw: No approve required (directly call Pool.withdraw)
        if (isGasToken) {
          return ADDRESSES.lending.aave.WETH_GATEWAY
        }
        // Aave non-ETH supply: approve token to Pool
        return ADDRESSES.lending.aave.pool
      case 'compound':
        // Compound V3: poolId is preferred (each pool is independent), if there is no poolId, guess by asset address
        if (poolId) {
          const poolToComet: Record<string, string> = {
            'compound-eth': ADDRESSES.lending.compound.cometWETH,
            'compound-usdc': ADDRESSES.lending.compound.cometUSDC,
            'compound-usdt': ADDRESSES.lending.compound.cometUSDT,
          }
          if (poolToComet[poolId]) return poolToComet[poolId]
        }
        if (assetAddress) {
          const asset = assetAddress.toLowerCase()
          const usdc = ADDRESSES.tokens.USDC.toLowerCase()
          const usdt = ADDRESSES.tokens.USDT.toLowerCase()
          const weth = ADDRESSES.tokens.WETH.toLowerCase()
          const eth = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'.toLowerCase()
          const wbtc = ADDRESSES.tokens.WBTC.toLowerCase()
          const wsteth = ADDRESSES.tokens.wstETH.toLowerCase().toLowerCase()

          if (asset === usdc) {
            return ADDRESSES.lending.compound.cometUSDC
          }
          if (asset === usdt) {
            return ADDRESSES.lending.compound.cometUSDT
          }
          if (asset === weth || asset === eth || asset === wsteth) {
            return ADDRESSES.lending.compound.cometWETH
          }
          if (asset === wbtc) {
            return ADDRESSES.lending.compound.cometWBTC
          }
        }
        // Default return to USDC comet
        return ADDRESSES.lending.compound.cometUSDC
      case 'morpho':
        // Morpho: Returns the corresponding spender based on the asset address
        if (assetAddress) {
          const asset = assetAddress.toLowerCase()
          const usdt = ADDRESSES.tokens.USDT.toLowerCase()
          const usdc = ADDRESSES.tokens.USDC.toLowerCase()

          // USDT/USDC repay now mirrors the SUPPLY path (in line with app.morpho.org), so supply and
          // repay share the same authorization — no per-repay approve transaction:
          // - USDT: approve Permit2 once (0x0000...78BA3), then each repay signs a PermitSingle and pulls
          //   via Permit2.permitTransferFrom (morpho.buildRepayMulticallPermit2).
          // - USDC: EIP-2612 gasless signed permit inside the repay multicall (buildRepayMulticallEIP2612),
          //   so no on-chain approve is needed at all ("" = skip approve).
          if (asset === usdt) {
            return PERMIT2_ADDRESS
          }
          if (asset === usdc) {
            return ""
          }

          // WBTC/weth/wstETH as collateral for Morpho Blue supply → approve to Morpho Blue
          return ADDRESSES.lending.morpho.blue
        }
        // Default return to old Morpho master contract
        return ADDRESSES.lending.morpho.morpho
      case 'sparklend':
        // SparkLend ETH withdraw: two-step — approve spWETH → WETH_GATEWAY, then WETH_Gateway.withdrawETH (native ETH)
        // Other assets (USDC/USDT/WETH...) supply/withdraw → approve pool directly
        if (isGasToken) {
          return ADDRESSES.lending.sparklend.WETH_GATEWAY
        }
        return ADDRESSES.lending.sparklend.pool
      case 'fluid':
        // Fluid Vault: approve target = corresponding vault address
        // - supply ERC20 collateral (wstETH)→ approve collateral to vault
        // - repay ERC20 debt (USDC/USDT)→ approve debt assets to vault
        // - ETH collateral supply/ETH debt repay → without approve (msg.value)
        if (assetAddress) {
          const asset = assetAddress.toLowerCase()
          const usdt = ADDRESSES.tokens.USDT.toLowerCase()
          const usdc = ADDRESSES.tokens.USDC.toLowerCase()
          const weth = ADDRESSES.tokens.WETH.toLowerCase()
          const wsteth = ADDRESSES.tokens.wstETH.toLowerCase().toLowerCase()
          const eth = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'.toLowerCase()

          // repay USDC → approve for ETH-USDC vault
          if (asset === usdc) {
            return ADDRESSES.lending.fluid.vaults['eth-usdc']
          }
          // repay USDT → approve to ETH-USDT vault
          if (asset === usdt) {
            return ADDRESSES.lending.fluid.vaults['eth-usdt']
          }
          // supply wstETH collateral → approve to wstETH-ETH vault
          if (asset === wsteth) {
            return ADDRESSES.lending.fluid.vaults['wsteth-eth']
          }
          // supply non-ETH collateral (such as WETH)→ approve to the corresponding vault
          if (asset === weth) {
            return ADDRESSES.lending.fluid.FWETH
          }
          // ETH does not require approve (supply collateral goes msg.value, repay ETH debt goes msg.value)
          if (asset === eth) {
            return ''
          }
        }
        return ADDRESSES.lending.fluid.pool
      default:
        return ADDRESSES.lending.aave.pool
    }
  }

  if (category === 'stablecoin') {
    switch (pid) {
      case 'ethena':
        return ADDRESSES.stablecoin.ethena.sUSDe
      case 'curve':
        return ADDRESSES.curve.threePool
      default:
        return ADDRESSES.stablecoin.ethena.sUSDe
    }
  }

  if (category === 'stake') {
    switch (pid) {
      case 'lido':
        // Lido unstake uses the Permit signature process (requestWithdrawalsWithPermit)
        // Signature is done inside the unstake method and does not require pre-approve
        // Deposit: ETH does not require approve
        return ''
      case 'rocketpool':
        return ADDRESSES.rocketpool.depositPool
      case 'etherfi':
        // ether.fi weETH unstake: need to approve weETH to weETH withdrawal contract (requestWithdraw)
        // (deposit ETH→ weETH go payable, ETH do not need approve, do not go here)
        return ADDRESSES.etherfi.liquidityPoolWeETHWithdrawal
      case 'stakewise':
        return ADDRESSES.stakewise.vault
      case 'meth':
        return ADDRESSES.meth.stakingContract
      case 'stader':
        return ADDRESSES.stader.stakeManager
      default:
        return ''
    }
  }

  return ''
}

/**
 * Approve State Management Hook (Vue 3 Composition API)
 * @returns approve related states and methods
 */
export function useApprove() {
  const isApproving: Ref<boolean> = ref(false)
  const needsApprove: Ref<boolean> = ref(false)

  /** Check and update authorization status */
  async function checkAllowanceWrapper(
    tokenAddress: string,
    owner: Address,
    spender: string,
    amount: bigint
  ) {
    if (!tokenAddress || !owner || !spender) {
      needsApprove.value = false
      return
    }

    needsApprove.value = await checkAllowance(tokenAddress, owner, spender as Address, amount)
  }

  /** Execute authorization and wait for confirmation */
  async function approveWrapper(
    tokenAddress: string,
    spender: string,
    amount: bigint,
    account?: Address
  ): Promise<string> {
    isApproving.value = true

    try {
      const txHash = await approve(tokenAddress, spender as Address, amount, account)

      // Awaiting transaction confirmation
      await publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
        timeout: 45000 // 45 seconds timeout
      })

      // Update status after confirmation
      needsApprove.value = false
      return txHash
    } catch (error) {
      throw error
    } finally {
      isApproving.value = false
    }
  }

  return {
    isApproving,
    needsApprove,
    checkAllowance: checkAllowanceWrapper,
    approve: approveWrapper,
    getSpenderAddress,
    checkMorphoAllowance,
    approveMorphoToken
  }
}
