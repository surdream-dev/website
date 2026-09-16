import { createPublicClient, http } from "viem"
import { mainnet } from "viem/chains"
import { ethereumRpcs } from "@/config/rpc"

/**
 * Custom transport: per-request random endpoint selection with failover.
 *
 * Each RPC request shuffles the endpoint pool and tries it in that random order;
 * the first healthy endpoint answers. This spreads reads uniformly across all
 * configured nodes (no single hot node) AND survives a single endpoint outage —
 * a downed node is tried once, fails fast (retryCount 0), and the request moves
 * to the next endpoint instead of hammering it with viem's default retries.
 */
function randomEthereumHttp(args: any) {
  // Build on the shape of a real http transport so createPublicClient sees a
  // complete { config, value, request, ... } transport object.
  const make = (url: string) => http(url, { retryCount: 0 })(args)
  const base = make(ethereumRpcs[0])
  return {
    ...base,
    request: async ({ method, params }: any) => {
      const order = [...ethereumRpcs].sort(() => Math.random() - 0.5)
      let lastError: unknown
      for (const url of order) {
        try {
          return await make(url).request({ method, params })
        } catch (e) {
          lastError = e
        }
      }
      throw lastError
    },
  }
}

export const publicClient = createPublicClient({
  chain: mainnet,
  transport: randomEthereumHttp
})
