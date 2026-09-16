// types.ts

// Capability type
export type Address = `0x${string}`
export type HexString = `0x${string}`

// Strict type (for internal)
export interface StrictTxConfig {
  to: Address
  data: HexString
  value?: bigint
}

// Loose type (for creating)
export interface TxConfig extends Omit<StrictTxConfig, 'to' | 'data'> {
  to: string | Address
  data: string | HexString
  account?: Address  // Optional: Avoid wallet requests by passing in a known address
}

// Type guard function
export function isStrictTxConfig(config: any): config is StrictTxConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    typeof config.to === 'string' &&
    config.to.startsWith('0x') &&
    config.to.length === 42 &&
    typeof config.data === 'string' &&
    config.data.startsWith('0x') &&
    /^0x[0-9a-fA-F]*$/.test(config.data)
  )
}

// conversion function
export function toStrictTxConfig(config: TxConfig): StrictTxConfig {
  const to = config.to.startsWith('0x') ? config.to : `0x${config.to}`
  const data = config.data.startsWith('0x') ? config.data : `0x${config.data}`
  
  // Verify
  if (to.length !== 42) {
    throw new Error(`Invalid address length: ${to}`)
  }
  
  if (!/^0x[0-9a-fA-F]*$/.test(data)) {
    throw new Error(`Invalid hex data: ${data}`)
  }
  
  return {
    ...config,
    to: to as Address,
    data: data as HexString
  }
}

// You can also leave the original interface name but add a help type
// export { StrictTxConfig as TxConfig }
// Then use TxConfigCreate as the type on creation
export type TxConfigCreate = TxConfig

export interface TransactionContext {
  chainId: number
  account: Address
}
