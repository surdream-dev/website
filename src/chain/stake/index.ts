import { register, getStake } from "./registry"
import { lido } from "./lido"
import { rocketpool } from "./rocketpool"
import { meth } from "./meth"
import { stader } from "./stader"
import { stakewise } from "./stakewise"
import { etherfi } from "./etherfi"

register("lido", lido)
register("rocketpool", rocketpool)
register("meth", meth)
register("stader", stader)
register("stakewise", stakewise)
register("etherfi", etherfi)

export const stake = {
  get: getStake
}
