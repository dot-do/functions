/**
 * Rate Limiter Durable Object
 *
 * Provides distributed rate limiting across Worker instances using Workers RPC.
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
 * - Workers RPC for direct method invocation (no HTTP overhead)
 *
 * Uses Workers RPC for direct method invocation instead of HTTP routes.
 * Reference: https://developers.cloudflare.com/durable-objects/api/rpc/
 *
 * @module durable-object/rate-limiter
 */

import { DurableObject } from 'cloudflare:workers'

/** Schema version for rate limiter SQLite tables. Increment when schema changes. */
export const RATE_LIMITER_SCHEMA_VERSION = 1

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of a rate limit check
 */
export interface RateLimitCheckResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Number of requests remaining in the current window */
  remaining: number
  /** Unix timestamp (ms) when the rate limit window resets */
  resetAt: number
}

/**
 * SQL row type for rate limit entries
 */
type SqlStorageValue = string | number | null | ArrayBuffer

interface RateLimitRow extends Record<string, SqlStorageValue> {
  key: string
  count: number
  reset_at: number
}

/**
 * Environment bindings for RateLimiterDO
 */
interface Env {
  // No specific bindings needed
}

// ============================================================================
// RATE LIMITER DURABLE OBJECT
// ============================================================================

/**
 * RateLimiterDO - Distributed Rate Limiter Durable Object
 *
 * Provides atomic rate limiting operations that work across multiple
 * Worker instances. Uses SQLite storage for persistence and durability.
 *
 * Extends DurableObject for Workers RPC support - all public methods
 * are callable directly via the stub without HTTP routing.
 *
 * Usage from a Worker:
 * ```typescript
 * const id = env.RATE_LIMITER.idFromName(clientIP)
 * const stub = env.RATE_LIMITER.get(id)
 * const result = await stub.check('api-key-123', 100, 60000)
 * if (!result.allowed) { return new Response('Too Many Requests', { status: 429 }) }
 * await stub.increment('api-key-123', 60000)
 * ```
 */
export class RateLimiterDO extends DurableObject<Env> {
  private schemaInitialized = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
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
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Safely get a single row from a SQL result, returning null if not found.
   */
  private oneOrNull<T extends Record<string, SqlStorageValue>>(
    cursor: SqlStorageCursor<T>
  ): T | null {
    const rows = cursor.toArray()
    return rows.length > 0 ? (rows[0] ?? null) : null
  }

  /**
   * Get the current window state for a key from storage
   */
  private getWindow(key: string): { count: number; resetAt: number } | null {
    const row = this.oneOrNull(
      this.ctx.storage.sql.exec<RateLimitRow>(
        `SELECT key, count, reset_at FROM rate_limits WHERE key = ?`,
        key
      )
    )

    if (!row) return null

    return { count: row.count, resetAt: row.reset_at }
  }

  /**
   * Persist a rate limit window to storage
   */
  private persistWindow(key: string, count: number, resetAt: number): void {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO rate_limits (key, count, reset_at) VALUES (?, ?, ?)`,
      key,
      count,
      resetAt
    )
  }

  /**
   * Delete a rate limit window from storage
   */
  private deleteWindow(key: string): void {
    this.ctx.storage.sql.exec(`DELETE FROM rate_limits WHERE key = ?`, key)
  }

  // ===========================================================================
  // PUBLIC RPC METHODS
  // ===========================================================================

  /**
   * Check if a request is allowed for the given key without incrementing.
   *
   * @param key - Unique identifier for rate limiting (e.g., IP address, function ID)
   * @param limit - Maximum number of requests allowed per window
   * @param windowMs - Time window in milliseconds
   * @returns Rate limit check result
   */
  async check(key: string, limit: number, windowMs: number): Promise<RateLimitCheckResult> {
    this.initializeSchema()

    const now = Date.now()
    const window = this.getWindow(key)

    // No existing window or window has expired
    if (!window || window.resetAt <= now) {
      return {
        allowed: true,
        remaining: Math.max(0, limit),
        resetAt: now + windowMs,
      }
    }

    // Check against current window
    const remaining = Math.max(0, limit - window.count)
    return {
      allowed: window.count < limit,
      remaining,
      resetAt: window.resetAt,
    }
  }

  /**
   * Increment the request count for the given key.
   * Creates a new window if none exists or the current window has expired.
   *
   * @param key - Unique identifier for rate limiting
   * @param windowMs - Time window in milliseconds
   */
  async increment(key: string, windowMs: number): Promise<void> {
    this.initializeSchema()

    const now = Date.now()
    const window = this.getWindow(key)

    // Create new window or reset expired window
    if (!window || window.resetAt <= now) {
      this.persistWindow(key, 1, now + windowMs)
      return
    }

    // Increment existing window
    this.persistWindow(key, window.count + 1, window.resetAt)
  }

  /**
   * Reset the rate limit for a specific key.
   * Removes the key from storage entirely.
   *
   * @param key - Unique identifier to reset
   */
  async reset(key: string): Promise<void> {
    this.initializeSchema()
    this.deleteWindow(key)
  }

  /**
   * Check and increment in one atomic operation.
   * This is the most common operation for rate limiting.
   *
   * @param key - Unique identifier for rate limiting
   * @param limit - Maximum number of requests allowed per window
   * @param windowMs - Time window in milliseconds
   * @returns Rate limit check result after the operation
   */
  async checkAndIncrement(key: string, limit: number, windowMs: number): Promise<RateLimitCheckResult> {
    this.initializeSchema()

    const now = Date.now()
    const window = this.getWindow(key)

    // Create new window or reset expired window
    if (!window || window.resetAt <= now) {
      const resetAt = now + windowMs
      this.persistWindow(key, 1, resetAt)
      return {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        resetAt,
      }
    }

    // Check and increment existing window
    const allowed = window.count < limit
    if (allowed) {
      this.persistWindow(key, window.count + 1, window.resetAt)
    }

    return {
      allowed,
      remaining: Math.max(0, limit - (allowed ? window.count + 1 : window.count)),
      resetAt: window.resetAt,
    }
  }

  /**
   * Clean up expired windows from storage.
   *
   * @returns Number of expired windows deleted
   */
  async cleanup(): Promise<number> {
    this.initializeSchema()

    const now = Date.now()
    const expired = this.ctx.storage.sql.exec<RateLimitRow>(
      `SELECT key FROM rate_limits WHERE reset_at <= ?`,
      now
    ).toArray()

    for (const row of expired) {
      this.deleteWindow(row.key)
    }

    return expired.length
  }

  // ===========================================================================
  // ALARM HANDLER
  // ===========================================================================

  /**
   * Handle alarm for periodic cleanup of expired windows.
   */
  async alarm(): Promise<void> {
    await this.cleanup()

    // Schedule next cleanup if there are still windows
    const nextExpiry = this.oneOrNull(
      this.ctx.storage.sql.exec<{ min_reset: number }>(
        `SELECT MIN(reset_at) as min_reset FROM rate_limits`
      )
    )

    if (nextExpiry?.min_reset) {
      await this.ctx.storage.setAlarm(nextExpiry.min_reset + 1000) // Add 1 second buffer
    }
  }
}
