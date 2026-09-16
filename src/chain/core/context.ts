import type { TransactionContext } from "./types"
import { getSharedWalletClient, hasWallet } from "./signer"

export async function getTxContext(): Promise<TransactionContext> {
  if (!hasWallet()) {
    throw new Error("No wallet provider found. Please install a wallet extension.")
  }

  const walletClient = getSharedWalletClient()
  if (!walletClient) {
    throw new Error("No wallet provider found. Please install a wallet extension.")
  }

  const [account] = await walletClient.getAddresses()
  return {
    chainId: 1,
    account
  }
}
