/**
 * Small stale-while-revalidate cache for public data.
 *
 * Public data lives in memory for a short TTL and is also persisted to localStorage,
 * so the next page load can render a stale snapshot immediately while a background
 * refresh replaces it.
 */

const STORAGE_PREFIX = 'surdream_public_data:v1'

export interface PublicDataCacheOptions<T> {
  /** Unique cache key; the final localStorage key becomes `surdream_public_data:v1:<key>`. */
  key: string
  /** In-memory freshness window in ms. */
  ttlMs: number
  /** Maximum age of a persisted snapshot that may still be used as a stale value. */
  maxAgeMs: number
  /** Return false for empty/error values so they are not persisted or treated as a usable snapshot. */
  isUsable?: (value: T) => boolean
}

interface StoredSnapshot {
  value: unknown
  timestamp: number
}

/** Recursively serialize values that JSON cannot represent (bigint / Map). */
export function serializePublicValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return { __bigint: value.toString() }
  }
  if (value instanceof Map) {
    return {
      __map: Array.from(value.entries()).map(([k, v]) => [
        serializePublicValue(k),
        serializePublicValue(v),
      ]),
    }
  }
  if (Array.isArray(value)) {
    return value.map(item => serializePublicValue(item))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = serializePublicValue(v)
    }
    return out
  }
  return value
}

/** Recursively revive values serialized by `serializePublicValue`. */
export function deserializePublicValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => deserializePublicValue(item))
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.__bigint === 'string') {
      try {
        return BigInt(obj.__bigint)
      } catch {
        return undefined
      }
    }
    if (Array.isArray(obj.__map)) {
      return new Map(
        obj.__map.map((pair) => [
          deserializePublicValue((pair as unknown[])[0]),
          deserializePublicValue((pair as unknown[])[1]),
        ]),
      )
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      out[k] = deserializePublicValue(v)
    }
    return out
  }
  return value
}

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}:${key}`
}

function readStoredSnapshot(key: string): StoredSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(key))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSnapshot
    if (typeof parsed.timestamp !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function writeStoredSnapshot<T>(key: string, value: T, timestamp: number): void {
  if (typeof window === 'undefined') return
  try {
    const snapshot: StoredSnapshot = {
      value: serializePublicValue(value),
      timestamp,
    }
    window.localStorage.setItem(storageKey(key), JSON.stringify(snapshot))
  } catch (err) {
    console.warn(`[PublicDataCache] Failed to persist ${key}:`, err)
  }
}

export interface PublicDataCache<T> {
  get(fetcher: () => Promise<T>): Promise<T>
  set(value: T): void
  clear(): void
}

/**
 * Create a stale-while-revalidate cache.
 *
 * `get(fetcher)` returns fresh in-memory data first, then an in-flight request,
 * then a valid persisted snapshot (starting a background refresh), then falls back
 * to a blocking fetch.
 */
export function createPublicDataCache<T>(options: PublicDataCacheOptions<T>): PublicDataCache<T> {
  let memory: { value: T; timestamp: number } | null = null
  let inflight: Promise<T> | null = null
  let background: Promise<T> | null = null

  function isUsable(value: T): boolean {
    return options.isUsable ? options.isUsable(value) : value !== null && value !== undefined
  }

  function persist(value: T): void {
    const timestamp = Date.now()
    memory = { value, timestamp }
    writeStoredSnapshot(options.key, value, timestamp)
  }

  function readStale(): T | null {
    const snapshot = readStoredSnapshot(options.key)
    if (!snapshot || Date.now() - snapshot.timestamp > options.maxAgeMs) return null
    const value = deserializePublicValue(snapshot.value) as T
    return isUsable(value) ? value : null
  }

  return {
    async get(fetcher: () => Promise<T>): Promise<T> {
      const now = Date.now()
      if (memory && now - memory.timestamp < options.ttlMs) {
        return memory.value
      }
      if (inflight) return inflight

      const stale = readStale()
      if (stale !== null) {
        if (!background) {
          background = fetcher()
            .then((value) => {
              if (isUsable(value)) persist(value)
              return value
            })
            .catch((err) => {
              console.warn(`[PublicDataCache] Background refresh failed for ${options.key}:`, err)
              return stale
            })
            .finally(() => {
              background = null
            })
        }
        return stale
      }

      inflight = fetcher()
        .then((value) => {
          if (isUsable(value)) persist(value)
          return value
        })
        .finally(() => {
          inflight = null
        })
      return inflight
    },
    set(value: T): void {
      if (isUsable(value)) persist(value)
    },
    clear(): void {
      memory = null
      inflight = null
      background = null
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.removeItem(storageKey(options.key))
        } catch {
          // ignore storage errors
        }
      }
    },
  }
}
