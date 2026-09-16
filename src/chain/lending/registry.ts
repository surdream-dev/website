import type { LendingAdapter } from "./base"

const registry = new Map<string, LendingAdapter>()

export function register(name: string, adapter: LendingAdapter) {
  registry.set(name, adapter)
}

export function getLending(name: string) {
  return registry.get(name)
}

export function has(name: string): boolean {
  return registry.has(name)
}