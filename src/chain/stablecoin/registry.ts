import type { StablecoinAdapter } from "./base"

const registry = new Map<string, StablecoinAdapter>()

export function register(name: string, adapter: StablecoinAdapter) {
  registry.set(name, adapter)
}

export function getStablecoin(name: string) {
  return registry.get(name)
}
