import { publicClient } from "./provider"

export async function readContract(config: any) {
  return publicClient.readContract(config)
}
