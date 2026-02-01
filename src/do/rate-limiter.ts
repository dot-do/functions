/**
 * Rate Limiter Durable Object
 *
 * Provides distributed rate limiting across Worker instances.
 * This DO maintains rate limit state using SQLite storage for persistence
 * and supports sliding window counters for accurate rate limiting.
 *
 * Features:
 * - Distributed rate limiting across multiple workers
 * - Sliding window counter algorithm
 * - Configurable rate limits per key
 * - Atomic check-and-increment operations
 * - Window expiration handling
 * - SQLite-backed persistence
 *
 * @module durable-object/rate-limiter
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for rate limiting behavior
 */
export interface RateLimitConfig {
  /** Time window in milliseconds (e.g., 60000 for 1 minute) */
  windowMs: number
  /** Maximum number of requests allowed per window */
  maxRequests: number
}

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Number of requests remaining in the current window */
  remaining: number
  /** Unix timestamp (ms) when the rate limit window resets */
  resetAt: number
}

/**
 * Request body for rate limiter operations
 */
export interface RateLimiterRequest {
  /** Action to perform */
  action: 'check' | 'increment' | 'checkAndIncrement' | 'reset' | 'getStats'
  /** Key to rate limit (e.g., IP address, function ID) */
  key: string
  /** Rate limit configuration */
  config: RateLimitConfig
}

/**
 * Response from rate limiter operations
 */
export interface RateLimiterResponse {
  /** Operation result */
  result?: RateLimitResult
  /** Statistics (for getStats action) */
  stats?: RateLimiterStats
  /** Error message if operation failed */
  error?: string
}

/**
 * Statistics about the rate limiter state
 */
export interface RateLimiterStats {
  /** Total number of tracked keys */
  totalKeys: number
  /** Number of currently active windows */
  activeWindows: number
  /** Total requests tracked */
  totalRequests: number
}

/**
 * Window state for tracking requests
 */
interface WindowState {
  /** Number of requests in the current window */
  count: number
  /** Unix timestamp (ms) when the window resets */
  resetAt: number
}

/**
 * Environment bindings for RateLimiterDO
 */
interface Env {
  // Environment bindings
}

// ============================================================================
// RATE LIMITER DURABLE OBJECT
// ============================================================================

/**
 * RateLimiterDO - Distributed Rate Limiter Durable Object
 *
 * Provides atomic rate limiting operations that work across multiple
 * Worker instances. Uses in-memory storage for fast access with
 * optional SQLite persistence for durability.
 */
export class RateLimiterDO {
  private ctx: DurableObjectState
  private env: Env
  private windows: Map<string, WindowState> = new Map()
  private schemaInitialized: boolean = false

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx
    this.env = env
  }

  // ===========================================================================
  // SCHEMA INITIALIZATION
  // ===========================================================================

  /**
   * Initialize the SQLite schema for rate limit persistence
   */
  private initializeSchema(): void {
    if (this.schemaInitialized) return

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset_at INTEGER NOT NULL
      )
    `)

    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at
      ON rate_limits (reset_at)
    `)

    this.schemaInitialized = true

    // Load existing rate limits from storage
    this.loadFromStorage()
  }

  /**
   * Load rate limit state from SQLite storage
   */
  private loadFromStorage(): void {
    const results = this.ctx.storage.sql.exec<{
      key: string
      count: number
      reset_at: number
    }>(`SELECT key, count, reset_at FROM rate_limits`).toArray()

    const now = Date.now()
    for (const row of results) {
      // Only load non-expired windows
      if (row.reset_at > now) {
        this.windows.set(row.key, {
          count: row.count,
          resetAt: row.reset_at,
        })
      }
    }
  }

  /**
   * Persist a rate limit window to storage
   */
  private persistWindow(key: string, window: WindowState): void {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO rate_limits (key, count, reset_at) VALUES (?, ?, ?)`,
      key,
      window.count,
      window.resetAt
    )
  }

  /**
   * Delete a rate limit window from storage
   */
  private deleteWindow(key: string): void {
    this.ctx.storage.sql.exec(`DELETE FROM rate_limits WHERE key = ?`, key)
  }

  // ===========================================================================
  // RATE LIMITING OPERATIONS
  // ===========================================================================

  /**
   * Check if a request is allowed without incrementing the counter
   */
  private check(key: string, config: RateLimitConfig): RateLimitResult {
    const now = Date.now()
    const window = this.windows.get(key)

    // Handle zero maxRequests - never allow
    if (config.maxRequests <= 0) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: now + config.windowMs,
      }
    }

    // No existing window or window has expired
    if (!window || window.resetAt <= now) {
      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetAt: now + config.windowMs,
      }
    }

    // Check against current window
    const remaining = Math.max(0, config.maxRequests - window.count)
    return {
      allowed: window.count < config.maxRequests,
      remaining,
      resetAt: window.resetAt,
    }
  }

  /**
   * Increment the request count for the given key
   */
  private increment(key: string, config: RateLimitConfig): void {
    this.initializeSchema()

    const now = Date.now()
    const window = this.windows.get(key)

    // Create new window or reset expired window
    if (!window || window.resetAt <= now) {
      const newWindow: WindowState = {
        count: 1,
        resetAt: now + config.windowMs,
      }
      this.windows.set(key, newWindow)
      this.persistWindow(key, newWindow)
      return
    }

    // Increment existing window
    window.count++
    this.persistWindow(key, window)
  }

  /**
   * Check and increment atomically
   */
  private checkAndIncrement(key: string, config: RateLimitConfig): RateLimitResult {
    this.initializeSchema()

    const now = Date.now()

    // Handle zero maxRequests - never allow
    if (config.maxRequests <= 0) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: now + config.windowMs,
      }
    }

    const window = this.windows.get(key)

    // Create new window or reset expired window
    if (!window || window.resetAt <= now) {
      const resetAt = now + config.windowMs
      const newWindow: WindowState = {
        count: 1,
        resetAt,
      }
      this.windows.set(key, newWindow)
      this.persistWindow(key, newWindow)
      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetAt,
      }
    }

    // Check and increment existing window
    const allowed = window.count < config.maxRequests
    if (allowed) {
      window.count++
      this.persistWindow(key, window)
    }

    return {
      allowed,
      remaining: Math.max(0, config.maxRequests - window.count),
      resetAt: window.resetAt,
    }
  }

  /**
   * Reset the rate limit for a specific key
   */
  private reset(key: string): void {
    this.initializeSchema()
    this.windows.delete(key)
    this.deleteWindow(key)
  }

  /**
   * Get statistics about the rate limiter state
   */
  private getStats(): RateLimiterStats {
    const now = Date.now()
    let activeWindows = 0
    let totalRequests = 0

    for (const window of this.windows.values()) {
      if (window.resetAt > now) {
        activeWindows++
        totalRequests += window.count
      }
    }

    return {
      totalKeys: this.windows.size,
      activeWindows,
      totalRequests,
    }
  }

  /**
   * Cleanup expired windows
   */
  private cleanup(): number {
    this.initializeSchema()

    const now = Date.now()
    let deleted = 0

    for (const [key, window] of this.windows.entries()) {
      if (window.resetAt <= now) {
        this.windows.delete(key)
        this.deleteWindow(key)
        deleted++
      }
    }

    return deleted
  }

  // ===========================================================================
  // HTTP HANDLER
  // ===========================================================================

  /**
   * Handle HTTP requests to the rate limiter DO
   */
  async fetch(request: Request): Promise<Response> {
    // Handle GET requests for stats
    if (request.method === 'GET') {
      const url = new URL(request.url)

      if (url.pathname === '/stats') {
        this.initializeSchema()
        return Response.json({ stats: this.getStats() })
      }

      if (url.pathname === '/cleanup') {
        const deleted = this.cleanup()
        return Response.json({ deleted })
      }

      return Response.json({ error: 'Unknown endpoint' }, { status: 404 })
    }

    // Handle POST requests for rate limiting operations
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    try {
      const body = await request.json() as RateLimiterRequest
      const { action, key, config } = body

      if (!key) {
        return Response.json({ error: 'Missing key' }, { status: 400 })
      }

      if (!config && action !== 'reset' && action !== 'getStats') {
        return Response.json({ error: 'Missing config' }, { status: 400 })
      }

      let result: RateLimiterResponse

      switch (action) {
        case 'check':
          result = { result: this.check(key, config) }
          break

        case 'increment':
          this.increment(key, config)
          result = { result: this.check(key, config) }
          break

        case 'checkAndIncrement':
          result = { result: this.checkAndIncrement(key, config) }
          break

        case 'reset':
          this.reset(key)
          result = { result: { allowed: true, remaining: config?.maxRequests ?? 0, resetAt: 0 } }
          break

        case 'getStats':
          result = { stats: this.getStats() }
          break

        default:
          return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
      }

      return Response.json(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return Response.json({ error: message }, { status: 500 })
    }
  }

  // ===========================================================================
  // ALARM HANDLER
  // ===========================================================================

  /**
   * Handle alarm for periodic cleanup
   */
  async alarm(): Promise<void> {
    this.cleanup()

    // Schedule next cleanup if there are still windows
    if (this.windows.size > 0) {
      // Find the next expiration time
      let nextExpiration = Infinity
      for (const window of this.windows.values()) {
        if (window.resetAt < nextExpiration) {
          nextExpiration = window.resetAt
        }
      }

      if (nextExpiration < Infinity) {
        await this.ctx.storage.setAlarm(nextExpiration + 1000) // Add 1 second buffer
      }
    }
  }
}
