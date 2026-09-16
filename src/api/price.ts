/**
 * Price API
 * Get all token prices in USD from server side (aggregated by Chainlink + Lido oracle)
 * * get/prices → {code: 0, msg: "success", data: {updatedAt, prices: {symbol: {usd: number}}}}
 */

import { API_BASE_URL, API_ENDPOINTS } from '@/config/api'

export interface PriceApiData {
  updatedAt: number
  prices: Record<string, { usd: number }>
}

/** Get all token prices (server-side aggregation, single HTTP request) */
export async function getAllPrices(): Promise<PriceApiData> {
  const url = `${API_BASE_URL}${API_ENDPOINTS.PRICES}`

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(`Price API HTTP Error: ${response.status}`)
  }

  const json = await response.json()

  if (json.code !== 0) {
    throw new Error(json.msg || 'Price API request failed')
  }

  return json.data as PriceApiData
}
