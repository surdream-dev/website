/**
 * Shared reactive state for protocol official APY
 * All pages (Home / Stake / Stablecoin / Portfolio) share the same apyMap,
 * ensuring the same protocol APY is consistent across pages.
 */
import { ref } from 'vue'
import { getStakeApy } from '@/api/apy'

const apyMap = ref<Record<string, number | null>>({})

export function useProtocolApy() {
  /** Batch-fetch protocol official APY (skip protocols already fetched) */
  async function fetchApys(protocolIds: string[]) {
    const ids = [...new Set(protocolIds.filter(id => !(id in apyMap.value)))]
    await Promise.all(ids.map(async id => {
      apyMap.value[id] = await getStakeApy(id)
    }))
  }

  /** Get protocol APY: number → x.xx%; null (no official API / failure) → '-' */
  function formatApy(protocolId: string): string {
    const v = apyMap.value[protocolId]
    return typeof v === 'number' ? v.toFixed(2) + '%' : '-'
  }

  function getApy(protocolId: string): number | null | undefined {
    return apyMap.value[protocolId]
  }

  return { apyMap, fetchApys, formatApy, getApy }
}
