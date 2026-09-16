/**
 * Icon Utility
 * Gets protocol and asset icons with a default fallback
 */

// Bulk-import logos with Vite's import.meta.glob (supports svg + webp; ether.fi's official icon is .webp)
const icons = import.meta.glob('@/assets/logos/*.{svg,webp}', {
  eager: true,
  import: 'default'
})

// Default icon (used when nothing matches)
const defaultIcon = 'https://cdn.surdream.com/icons/default.png'

// Asset icon aliases: reuse the protocol icon when there is no standalone local icon (rETH → Rocket Pool)
const ICON_ALIAS: Record<string, string> = {
  reth: 'rocketpool',
}

/**
 * Get an icon by name
 * @param name - protocol name or asset symbol (e.g. 'lido', 'ETH', 'USDC')
 * @returns icon URL
 */
export function getIcon(name: string): string {
  if (!name) return defaultIcon

  // Extract the protocol name (compound) from a pool ID (e.g. compound-eth) to match the logo;
  // Then strip special characters (e.g. backend 'ether.fi' → 'etherfi' matches etherfi.svg)
  const lowerName = name.toLowerCase().split('-')[0].replace(/[^a-z0-9]/g, '')
  const matchName = ICON_ALIAS[lowerName] || lowerName

  // First try the local SVG icon
  for (const [path, icon] of Object.entries(icons)) {
    if (path.includes(matchName)) {
      return icon as string
    }
  }

  // If not available locally, return the CDN URL as fallback
  return `https://cdn.surdream.com/icons/${lowerName}.png`
}

/**
 * Get a protocol icon
 * @param protocolId - protocol ID (e.g. 'lido', 'aave', 'compound')
 * @param fallbackUrl - optional fallback URL (from mock data)
 */
export function getProtocolIcon(protocolId: string, fallbackUrl?: string): string {
  const localIcon = getIcon(protocolId)
  // If locally available, use locally first
  if (localIcon !== defaultIcon) return localIcon
  // Otherwise use CDN URL in mock data
  return fallbackUrl || defaultIcon
}

/**
 * Get an asset icon
 * @param assetSymbol - asset symbol (e.g. 'ETH', 'USDC', 'USDT')
 * @param fallbackUrl - optional fallback URL (from mock data)
 */
export function getAssetIcon(assetSymbol: string, fallbackUrl?: string): string {
  const localIcon = getIcon(assetSymbol)
  // If locally available, use locally first
  if (localIcon !== defaultIcon) return localIcon
  // Otherwise use CDN URL in mock data
  return fallbackUrl || defaultIcon
}