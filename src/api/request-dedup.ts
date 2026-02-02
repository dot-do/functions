/**
 * Request Deduplication for Functions.do
 *
 * Coalesces identical concurrent function invocations so they share a single
 * execution rather than running separately.
 *
 * ## How It Works
 *
 * 1. A content hash is computed from the function ID and serialized input.
 * 2. An in-flight Map tracks pending executions keyed by this hash.
 * 3. If a matching request is already in-flight, later callers receive the
 *    same Promise (the response body is cloned so each caller gets an
 *    independent Response).
 * 4. Entries are cleaned up when the execution settles (resolve or reject).
 * 5. A configurable TTL auto-evicts stale entries as a safety net.
 *
 * ## Cloudflare Workers Limitations
 *
 * - The Map is per-isolate / per-request-lifecycle.  Cross-isolate dedup
 *   is not supported (would require Durable Objects or external store).
 * - We use the Web Crypto API (`crypto.subtle.digest`) which is available
 *   in Cloudflare Workers.
 *
 * @module api/request-dedup
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Configuration for the request deduplication layer.
 */
export interface DedupConfig {
  /**
   * Whether deduplication is enabled.
   * @default true
   */
  enabled?: boolean

  /**
   * Maximum time (ms) an in-flight entry is kept before being evicted.
   * Acts as a safety net in case the execution Promise never settles.
   * @default 30000 (30 seconds)
   */
  ttlMs?: number
}

/** Default dedup configuration values. */
export const DEDUP_DEFAULTS = {
  ENABLED: true,
  TTL_MS: 30_000,
} as const

// =============================================================================
// TYPES
// =============================================================================

/**
 * A serializable snapshot of a Response that can be reused across callers.
 * We capture the response body/status/headers once and hand each waiting
 * caller a fresh Response built from this snapshot.
 */
interface ResponseSnapshot {
  body: ArrayBuffer
  status: number
  statusText: string
  headers: [string, string][]
}

/**
 * An in-flight entry in the dedup map.
 */
interface InFlightEntry {
  /** The Promise all callers share. Resolves to a ResponseSnapshot. */
  promise: Promise<ResponseSnapshot>
  /** Timestamp (epoch ms) when the entry was created. */
  createdAt: number
}

// =============================================================================
// HASHING
// =============================================================================

/**
 * Compute a SHA-256 hex digest of `functionId` + serialized `input`.
 *
 * Uses the Web Crypto API available in Cloudflare Workers.
 *
 * @param functionId - The function identifier
 * @param input - The request input data (will be JSON-stringified)
 * @returns Hex-encoded SHA-256 hash string
 */
export async function computeDedupKey(functionId: string, input: unknown): Promise<string> {
  // Deterministic serialisation: JSON.stringify is order-dependent on object
  // keys, but callers send the same parsed body so key order is preserved.
  const payload = `${functionId}:${JSON.stringify(input ?? {})}`
  const data = new TextEncoder().encode(payload)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// =============================================================================
// DEDUP MAP
// =============================================================================

/**
 * Request deduplication map.
 *
 * Manages in-flight entries and provides `dedupOrExecute` to transparently
 * coalesce identical concurrent invocations.
 *
 * Create one instance per isolate (module-level singleton is fine) or per
 * request batch if you want tighter scoping.
 */
export class RequestDedupMap {
  private readonly inflight = new Map<string, InFlightEntry>()
  private readonly ttlMs: number
  private readonly enabled: boolean

  constructor(config?: DedupConfig) {
    this.enabled = config?.enabled ?? DEDUP_DEFAULTS.ENABLED
    this.ttlMs = config?.ttlMs ?? DEDUP_DEFAULTS.TTL_MS
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * The number of currently in-flight entries.
   */
  get size(): number {
    return this.inflight.size
  }

  /**
   * Execute `fn` or coalesce with an existing in-flight execution that has
   * the same dedup key.
   *
   * @param key - Pre-computed dedup key (from `computeDedupKey`)
   * @param fn  - Factory that produces the Response for this invocation
   * @returns A Response (cloned from the shared execution if coalesced)
   */
  async dedupOrExecute(key: string, fn: () => Promise<Response>): Promise<Response> {
    if (!this.enabled) {
      return fn()
    }

    // Evict stale entries before checking
    this.evictStale()

    const existing = this.inflight.get(key)
    if (existing) {
      // Coalesce: wait for the same result and build a fresh Response
      const snapshot = await existing.promise
      return this.responseFromSnapshot(snapshot, true)
    }

    // First caller: run the actual execution and capture the response
    const promise = this.executeAndCapture(key, fn)
    this.inflight.set(key, { promise, createdAt: Date.now() })

    const snapshot = await promise
    return this.responseFromSnapshot(snapshot, false)
  }

  /**
   * Remove all entries from the map. Useful for testing or shutdown.
   */
  clear(): void {
    this.inflight.clear()
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Run the execution factory and capture its response as a snapshot.
   * Always cleans up the map entry when done.
   */
  private async executeAndCapture(key: string, fn: () => Promise<Response>): Promise<ResponseSnapshot> {
    try {
      const response = await fn()
      return await this.snapshotResponse(response)
    } finally {
      this.inflight.delete(key)
    }
  }

  /**
   * Snapshot a Response into a reusable form.
   */
  private async snapshotResponse(response: Response): Promise<ResponseSnapshot> {
    const body = await response.arrayBuffer()
    const headers: [string, string][] = []
    response.headers.forEach((value, name) => {
      headers.push([name, value])
    })
    return {
      body,
      status: response.status,
      statusText: response.statusText,
      headers,
    }
  }

  /**
   * Build a new Response from a snapshot.
   */
  private responseFromSnapshot(snapshot: ResponseSnapshot, deduplicated: boolean): Response {
    const headers = new Headers(snapshot.headers)
    if (deduplicated) {
      headers.set('X-Deduplicated', 'true')
    }
    return new Response(snapshot.body, {
      status: snapshot.status,
      statusText: snapshot.statusText,
      headers,
    })
  }

  /**
   * Remove entries older than `ttlMs`.
   */
  private evictStale(): void {
    const now = Date.now()
    for (const [key, entry] of this.inflight) {
      if (now - entry.createdAt > this.ttlMs) {
        this.inflight.delete(key)
      }
    }
  }
}

// =============================================================================
// MODULE-LEVEL SINGLETON
// =============================================================================

/**
 * Module-scoped singleton dedup map.
 *
 * In Cloudflare Workers each isolate gets its own module scope, so this map
 * is naturally per-isolate. It persists for the lifetime of the isolate
 * which may serve multiple requests.
 */
let _defaultMap: RequestDedupMap | null = null

/**
 * Get (or create) the default RequestDedupMap singleton.
 *
 * @param config - Optional configuration (only used on first call)
 */
export function getDefaultDedupMap(config?: DedupConfig): RequestDedupMap {
  if (!_defaultMap) {
    _defaultMap = new RequestDedupMap(config)
  }
  return _defaultMap
}

/**
 * Reset the default dedup map singleton. Primarily for testing.
 */
export function resetDefaultDedupMap(): void {
  _defaultMap?.clear()
  _defaultMap = null
}
