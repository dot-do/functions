/**
 * Options for KV get operations
 */
interface KVGetOptions {
  type?: 'text' | 'json' | 'arrayBuffer' | 'stream'
  cacheTtl?: number
}

/**
 * Type for KV get options - can be a string shorthand or options object
 */
type KVGetOptionsOrType = KVGetOptions | 'text' | 'json' | 'arrayBuffer' | 'stream'

/**
 * Stored entry with value, metadata, and optional expiration.
 */
interface StoredEntry {
  value: string
  metadata: unknown
  expiration?: number
}

/**
 * Creates a mock KVNamespace for testing purposes.
 * Implements the Cloudflare Workers KV interface in-memory.
 */
export function createMockKV(): KVNamespace {
  const store = new Map<string, StoredEntry>()

  /**
   * Check if an entry is expired and remove it if so.
   * Returns true if the entry exists and is not expired.
   */
  const isValidEntry = (entry: StoredEntry | undefined, key: string): entry is StoredEntry => {
    if (entry === undefined) return false
    if (entry.expiration && Date.now() / 1000 > entry.expiration) {
      store.delete(key)
      return false
    }
    return true
  }

  /**
   * Internal get implementation to avoid `this` binding issues
   */
  const getValue = async (key: string, options?: KVGetOptionsOrType): Promise<string | ArrayBuffer | ReadableStream | object | null> => {
    const entry = store.get(key)
    if (!isValidEntry(entry, key)) return null

    const type = typeof options === 'string' ? options : options?.type
    if (type === 'json') {
      return JSON.parse(entry.value) as object
    }
    if (type === 'arrayBuffer') {
      return new TextEncoder().encode(entry.value).buffer
    }
    if (type === 'stream') {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(entry.value))
          controller.close()
        },
      })
    }
    return entry.value
  }

  /**
   * Internal getMetadata implementation
   */
  const getMetadata = (key: string): unknown => {
    const entry = store.get(key)
    if (!isValidEntry(entry, key)) return null
    return entry.metadata
  }

  return {
    get: getValue,

    put: async (key: string, value: string | ArrayBuffer | ReadableStream, options?: KVNamespacePutOptions): Promise<void> => {
      let stringValue: string
      if (typeof value === 'string') {
        stringValue = value
      } else if (value instanceof ArrayBuffer) {
        stringValue = new TextDecoder().decode(value)
      } else {
        // Handle ReadableStream
        const reader = value.getReader()
        const chunks: Uint8Array[] = []
        let done = false
        while (!done) {
          const result = await reader.read()
          if (result.value) chunks.push(result.value)
          done = result.done
        }
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
        const combined = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
          combined.set(chunk, offset)
          offset += chunk.length
        }
        stringValue = new TextDecoder().decode(combined)
      }

      // Calculate expiration time in seconds since epoch
      let expiration: number | undefined
      if (options?.expiration) {
        expiration = options.expiration
      } else if (options?.expirationTtl) {
        expiration = Math.floor(Date.now() / 1000) + options.expirationTtl
      }

      const entryToStore: StoredEntry = {
        value: stringValue,
        metadata: options?.metadata ?? null,
      }
      if (expiration !== undefined) {
        entryToStore.expiration = expiration
      }
      store.set(key, entryToStore)
    },

    delete: async (key: string): Promise<void> => {
      store.delete(key)
    },

    list: async (options?: KVNamespaceListOptions): Promise<KVNamespaceListResult<unknown, string>> => {
      const prefix = options?.prefix ?? ''
      const limit = options?.limit ?? 1000
      const cursor = options?.cursor ?? ''

      const keys: KVNamespaceListKey<unknown, string>[] = []
      const now = Date.now() / 1000

      for (const [key, entry] of store) {
        // Skip expired entries
        if (entry.expiration && now > entry.expiration) {
          store.delete(key)
          continue
        }

        if (key.startsWith(prefix)) {
          const keyEntry: KVNamespaceListKey<unknown, string> = {
            name: key,
          }
          if (entry.expiration !== undefined) {
            keyEntry.expiration = entry.expiration
          }
          if (entry.metadata !== undefined && entry.metadata !== null) {
            keyEntry.metadata = entry.metadata
          }
          keys.push(keyEntry)
        }
      }

      // Sort keys for consistent ordering
      keys.sort((a, b) => a.name.localeCompare(b.name))

      // Handle pagination (simplified)
      const startIndex = cursor ? parseInt(cursor, 10) : 0
      const endIndex = startIndex + limit
      const slicedKeys = keys.slice(startIndex, endIndex)
      const hasMore = endIndex < keys.length

      // Return type must match the union type exactly:
      // - When list_complete is false, cursor is required (string)
      // - When list_complete is true, cursor should not be present
      if (hasMore) {
        return {
          keys: slicedKeys,
          list_complete: false,
          cursor: String(endIndex),
          cacheStatus: null,
        }
      } else {
        return {
          keys: slicedKeys,
          list_complete: true,
          cacheStatus: null,
        }
      }
    },

    getWithMetadata: async <Metadata = unknown>(key: string, options?: KVGetOptionsOrType): Promise<KVNamespaceGetWithMetadataResult<string | ArrayBuffer | ReadableStream | object | null, Metadata>> => {
      const value = await getValue(key, options)
      const metadata = getMetadata(key) as Metadata | null
      return {
        value,
        metadata,
        cacheStatus: null,
      }
    },
  } as KVNamespace
}
