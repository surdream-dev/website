import { getSharedWalletClient, getWalletProvider } from "./signer"
import { publicClient } from "./provider"
import { getEip1559Fees } from "./gas"
import { wagmiAdapter } from "@/config/appkit"
import { sendTransaction } from "@wagmi/core"
import type { TxConfig } from "./types"

/**
 * Detect whether it is an embedded browser for MetaMask Mobile
 * - MetaMask Mobile injects a window.ethereum without an array of providers
 * - The same provider is both a connection layer and a transaction signature layer, which is different from the desktop extension behavior
 */
function isMetaMaskMobile(): boolean {
  const { ethereum } = window as any
  if (!ethereum) return false
  // Desktop multi-wallet environment: ethereum.providers present
  // MetaMask Mobile embedded browser: ethereum is directly a MetaMask provider, no provider array
  return !ethereum.providers && (ethereum.isMetaMask || ethereum.isMobile)
}

/**
 * Send the transaction and return txHash (without waiting for confirmation)
 * gas estimation is done automatically by the wallet and there is no need to manually call estimateGas
 */
export async function sendTx(config: TxConfig): Promise<string> {
  // Address must be provided, no longer an internal request wallet
  let address = config.account

  if (!address) {
    throw new Error("Wallet not connected. Please check your wallet connection.")
  }

  const value = config.value ?? 0n

  // Consistent with official: Explicitly incoming EIP-1559 low-end fees (wallet shows "website suggestions" to avoid high Market).
  // When the acquisition fails, the fallback is a non-transmitting parameter, which is determined by the wallet itself, and does not affect the transmission.
  let eip1559Fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | null = null
  try {
    eip1559Fees = await getEip1559Fees()
  } catch (err) {
    console.warn('[TX] getEip1559Fees failed, falling back to wallet defaults:', err)
  }

  // Mobile MetaMask Mobile: Send transactions directly with provider.request
  // Bypass the step of doing the gas/fee estimation through the MetaMask provider inside the viem,
  // These steps may not be supported or timed out in MetaMask Mobile, causing the wallet UI to fail to evoke.
  if (isMetaMaskMobile()) {
    const provider = getWalletProvider()
    if (!provider) {
      throw new Error("No wallet provider found. Please open this page in MetaMask Mobile.")
    }

    const txParams: Record<string, string> = {
      from: address,
      to: config.to,
      data: config.data,
    }
    if (value > 0n) {
      txParams.value = `0x${value.toString(16)}`
    }
    if (eip1559Fees) {
      txParams.maxFeePerGas = `0x${eip1559Fees.maxFeePerGas.toString(16)}`
      txParams.maxPriorityFeePerGas = `0x${eip1559Fees.maxPriorityFeePerGas.toString(16)}`
    }

    const txHash: string = await provider.request({
      method: 'eth_sendTransaction',
      params: [txParams]
    })
    return txHash
  }

  // Prioritize sending with wagmi/AppKit (WalletConnect, injected, etc. are all supported)
  try {
    const txHash = await sendTransaction(wagmiAdapter.wagmiConfig, {
      to: config.to as `0x${string}`,
      data: config.data as `0x${string}`,
      value,
      chainId: 1,
      ...(eip1559Fees
        ? {
            maxFeePerGas: eip1559Fees.maxFeePerGas,
            maxPriorityFeePerGas: eip1559Fees.maxPriorityFeePerGas,
          }
        : {}),
    })
    return txHash
  } catch (err) {
    console.warn('[TX] wagmi sendTransaction failed, falling back to legacy:', err)
  }

  // Desktop: use viem walletClient (legacy fallback)
  const walletClient = getSharedWalletClient()
  if (!walletClient) {
    throw new Error("No wallet provider found. Please install a wallet extension.")
  }

  if (!walletClient.chain) {
    throw new Error("Chain not defined")
  }

  const txHash = await walletClient.sendTransaction({
    account: address,
    to: config.to as `0x${string}`,
    data: config.data as `0x${string}`,
    value,
    chain: walletClient.chain,
    ...(eip1559Fees
      ? {
          maxFeePerGas: eip1559Fees.maxFeePerGas,
          maxPriorityFeePerGas: eip1559Fees.maxPriorityFeePerGas,
        }
      : {}),
    kzg: undefined
  })

  return txHash
}

/**
 * Send the transaction and wait for confirmation
 * @param config transaction configuration
 * @param timeout timeout (milliseconds), default 45 seconds
 * @returns {txHash, receipt}
 */
export async function sendTxAndWait(
  config: TxConfig,
  timeout: number = 45000
): Promise<{
  txHash: string
  receipt: {
    status: 'success' | 'failed'
    blockNumber: bigint
    gasUsed: bigint
  }
}> {
  const txHash = await sendTx(config)


  // Awaiting transaction confirmation
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash as `0x${string}`,
    timeout
  })

  const status = receipt.status === 'success' ? 'success' : 'failed'


  return {
    txHash,
    receipt: {
      status,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed
    }
  }
}
