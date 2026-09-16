import { encodeFunctionData, getAddress } from "viem"
import { ADDRESSES } from "../evm/addresses"
import { ERC20_ABI } from "../evm/abis"
import { sendTx } from "../core/tx"
import type { StablecoinAdapter } from "./base"

export const meth: StablecoinAdapter = {
  async transfer(to, amount) {
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [to, amount]
    })

    return sendTx({
      to: ADDRESSES.stablecoin.mETH.mETH,
      data
    })
  },

  async approve(amount, spender) {
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [getAddress(spender || ADDRESSES.meth.stakingContract), amount]
    })

    return sendTx({
      to: ADDRESSES.stablecoin.mETH.mETH,
      data
    })
  }
}
