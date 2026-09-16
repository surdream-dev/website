import { register, getStablecoin } from "./registry"
import { ethena } from "./ethena"
import { curve } from "./curve"

// Only register protocols that exist in Mock data
register("ethena", ethena)
register("curve", curve)

export const stablecoin = {
  get: getStablecoin
}
