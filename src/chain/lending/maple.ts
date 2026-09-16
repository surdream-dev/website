// src/chain/lending/maple.ts
import { encodeFunctionData, getAddress } from "viem"
import { publicClient } from "../core/provider"
import { sendTx } from "../core/tx"
import { ADDRESSES } from "../evm/addresses"
import { AAVE_POOL_ABI, WETH_GATEWAY_ABI } from "../evm/abis"
import type { LendingAdapter } from "./base"

// Maple uses an Aave-style interface
const ABI = [
  { name: "deposit", type: "function", inputs: [{ type: "address" }, { type: "uint256" }, { type: "address" }], outputs: [] },
  { name: "withdraw", type: "function", inputs: [{ type: "address" }, { type: "uint256" }, { type: "address" }], outputs: [] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }
]

// Use Aave pool as temporary implementation
const pool = ADDRESSES.lending.aave.pool
const WETH_GATEWAY = ADDRESSES.lending.aave.WETH_GATEWAY

const ETH_PLACEHOLDER = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"

function isETH(asset: string): boolean {
  return asset.toLowerCase() === ETH_PLACEHOLDER.toLowerCase()
}

export const maple: LendingAdapter = {
  async supply(asset, amount, account) {
    if (!account) throw new Error("Account is required")

    // ETH needs to be processed via weth_gateway
    if (isETH(asset)) {
      const data = encodeFunctionData({
        abi: WETH_GATEWAY_ABI,
        functionName: "depositETH",
        args: [pool, getAddress(account), 0]
      })
      return sendTx({ to: WETH_GATEWAY, data, value: amount, account: getAddress(account) })
    }

    const data = encodeFunctionData({
      abi: ABI,
      functionName: "deposit",
      args: [getAddress(asset), amount, getAddress(account)]
    })

    return sendTx({ to: pool, data, account: getAddress(account) })
  },

  async withdraw(asset, amount, account) {
    if (!account) throw new Error("Account is required")

    const data = encodeFunctionData({
      abi: AAVE_POOL_ABI,
      functionName: "withdraw",
      args: [getAddress(asset), amount, getAddress(account)]
    })

    return sendTx({ to: pool, data, account: getAddress(account) })
  },

  async borrow() {
    throw new Error("Maple does not support borrowing")
  },

  async repay() {
    throw new Error("Maple does not support borrowing")
  },

  async setCollateral() {
    throw new Error("Maple automatically manages collateral")
  },

  async getSupplyBalance(account: `0x${string}`) {
    return BigInt(0)
  },

  async getBorrowBalance(_account?: `0x${string}`, _asset?: string) {
    return BigInt(0)
  }
}