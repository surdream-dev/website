import type { StakeAdapter } from "./base"

const registry = new Map<string, StakeAdapter>()

export function register(name: string, adapter: StakeAdapter) {
  registry.set(name, adapter)
}

export function getStake(name: string) {
  return registry.get(name)
}
