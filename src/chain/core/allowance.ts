// core/contract-helpers.ts
import { publicClient } from "./provider"
import { getSharedWalletClient, getWagmiWalletClient, hasWagmiConnection } from "./signer"
import { wagmiAdapter } from "@/config/appkit"
import { writeContract as wagmiWriteContract } from "@wagmi/core"
import { erc20Abi } from "viem"
import type { Address } from "./types"

// Compatible readContract wrapper
export async function readContract<T>(params: any): Promise<T> {
  const result = await publicClient.readContract({
    ...params,
    account: undefined
  } as any)

  return result as T
}

// Compatible writeContract wrapper
export async function writeContract(params: any) {
  // Prefer wagmi (supports WalletConnect, injected, etc.)
  if (hasWagmiConnection()) {
    try {
      const hash = await wagmiWriteContract(wagmiAdapter.wagmiConfig, {
        abi: params.abi,
        address: params.address,
        functionName: params.functionName,
        args: params.args,
        chainId: 1,
      } as any)
      return hash
    } catch (err) {
      console.warn('[Allowance] wagmi writeContract failed, falling back to legacy:', err)
    }
  }

  // Legacy fallback
  const walletClient = getSharedWalletClient()

  if (!walletClient || !walletClient.account) {
    throw new Error("Wallet not connected. Please connect your wallet first.")
  }

  return walletClient.writeContract({
    ...params,
    account: walletClient.account,
    authorizationList: []
  } as any)
}

// core/allowance.ts

export async function ensureAllowance(
  token: Address,
  owner: Address,
  spender: Address,
  amount: bigint
) {
  const current = await readContract<bigint>({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender]
  })

  if (current >= amount) return

  return writeContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount]
  })
}
