/**
 * Rate Limiting for Functions.do
 *
 * Provides rate limiting capabilities for function invocations to prevent abuse
 * and ensure fair resource usage across all users.
 */

import { RATE_LIMITS } from '../config'

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
 * Interface for rate limiter implementations
 */
export interface RateLimiter {
  /**
   * Check if a request is allowed for the given key
   * @param key - Unique identifier for rate limiting (e.g., IP address, function ID)
   * @returns Rate limit check result
   */
  check(key: string): Promise<RateLimitResult>

  /**
   * Increment the request count for the given key
   * @param key - Unique identifier for rate limiting
   */
  increment(key: string): Promise<void>

  /**
   * Check and increment in one operation (atomic)
   * @param key - Unique identifier for rate limiting
   * @returns Rate limit check result after incrementing
   */
  checkAndIncrement(key: string): Promise<RateLimitResult>

  /**
   * Reset the rate limit for a specific key
   * @param key - Unique identifier to reset
   */
  reset(key: string): Promise<void>

  /**
   * Get current configuration
   */
  getConfig(): RateLimitConfig
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
 * In-memory rate limiter implementation for single-worker deployments
 *
 * This implementation uses a sliding window counter approach and is suitable
 * for single-instance deployments. For multi-worker deployments, consider
 * using a distributed rate limiter backed by Durable Objects or KV.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private windows = new Map<string, WindowState>()
  private config: RateLimitConfig

  constructor(config: RateLimitConfig) {
    this.config = config
  }

  /**
   * Check if a request is allowed without incrementing the counter
   */
  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now()
    const window = this.windows.get(key)

    // No existing window or window has expired
    if (!window || window.resetAt <= now) {
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        resetAt: now + this.config.windowMs,
      }
    }

    // Check against current window
    const remaining = Math.max(0, this.config.maxRequests - window.count)
    return {
      allowed: window.count < this.config.maxRequests,
      remaining,
      resetAt: window.resetAt,
    }
  }

  /**
   * Increment the request count for the given key
   */
  async increment(key: string): Promise<void> {
    const now = Date.now()
    const window = this.windows.get(key)

    // Create new window or reset expired window
    if (!window || window.resetAt <= now) {
      this.windows.set(key, {
        count: 1,
        resetAt: now + this.config.windowMs,
      })
      return
    }

    // Increment existing window
    window.count++
  }

  /**
   * Check and increment atomically
   */
  async checkAndIncrement(key: string): Promise<RateLimitResult> {
    const now = Date.now()
    const window = this.windows.get(key)

    // Create new window or reset expired window
    if (!window || window.resetAt <= now) {
      const resetAt = now + this.config.windowMs
      this.windows.set(key, {
        count: 1,
        resetAt,
      })
      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetAt,
      }
    }

    // Check and increment existing window
    const allowed = window.count < this.config.maxRequests
    if (allowed) {
      window.count++
    }

    return {
      allowed,
      remaining: Math.max(0, this.config.maxRequests - window.count),
      resetAt: window.resetAt,
    }
  }

  /**
   * Reset the rate limit for a specific key
   */
  async reset(key: string): Promise<void> {
    this.windows.delete(key)
  }

  /**
   * Get current configuration
   */
  getConfig(): RateLimitConfig {
    return { ...this.config }
  }

  /**
   * Clean up expired windows to prevent memory leaks
   * Call this periodically in long-running workers
   */
  cleanup(): void {
    const now = Date.now()
    for (const [key, window] of this.windows.entries()) {
      if (window.resetAt <= now) {
        this.windows.delete(key)
      }
    }
  }

  /**
   * Get the current number of tracked keys (for monitoring)
   */
  getTrackedKeyCount(): number {
    return this.windows.size
  }
}

/**
 * Composite rate limiter that applies multiple rate limits
 * (e.g., per-IP and per-function limits)
 */
export class CompositeRateLimiter {
  private limiters: Map<string, RateLimiter> = new Map()

  /**
   * Add a rate limiter for a specific category
   * @param category - Category name (e.g., 'ip', 'function')
   * @param limiter - The rate limiter instance
   */
  addLimiter(category: string, limiter: RateLimiter): void {
    this.limiters.set(category, limiter)
  }

  /**
   * Get a rate limiter by category
   */
  getLimiter(category: string): RateLimiter | undefined {
    return this.limiters.get(category)
  }

  /**
   * Check all rate limits for the given keys
   * @param keys - Map of category to key (e.g., { ip: '1.2.3.4', function: 'my-func' })
   * @returns Combined result - allowed only if all limits allow
   */
  async checkAll(keys: Record<string, string>): Promise<{
    allowed: boolean
    results: Record<string, RateLimitResult>
    blockingCategory?: string
  }> {
    const results: Record<string, RateLimitResult> = {}
    let allowed = true
    let blockingCategory: string | undefined

    for (const [category, key] of Object.entries(keys)) {
      const limiter = this.limiters.get(category)
      if (limiter) {
        const result = await limiter.check(key)
        results[category] = result
        if (!result.allowed && allowed) {
          allowed = false
          blockingCategory = category
        }
      }
    }

    // Only include blockingCategory if defined (for exactOptionalPropertyTypes)
    if (blockingCategory !== undefined) {
      return { allowed, results, blockingCategory }
    }
    return { allowed, results }
  }

  /**
   * Check and increment all rate limits atomically
   * @param keys - Map of category to key
   * @returns Combined result with all individual results
   */
  async checkAndIncrementAll(keys: Record<string, string>): Promise<{
    allowed: boolean
    results: Record<string, RateLimitResult>
    blockingCategory?: string
  }> {
    // First check all without incrementing
    const checkResult = await this.checkAll(keys)

    // If any check fails, return without incrementing
    if (!checkResult.allowed) {
      return checkResult
    }

    // All checks passed, now increment all
    const results: Record<string, RateLimitResult> = {}
    for (const [category, key] of Object.entries(keys)) {
      const limiter = this.limiters.get(category)
      if (limiter) {
        results[category] = await limiter.checkAndIncrement(key)
      }
    }

    return { allowed: true, results }
  }
}

/**
 * Default rate limit configurations (from centralized config)
 */
export const DEFAULT_RATE_LIMITS = {
  /** Per-IP rate limit: 100 requests per minute */
  ip: {
    windowMs: RATE_LIMITS.IP.WINDOW_MS,
    maxRequests: RATE_LIMITS.IP.MAX_REQUESTS,
  },
  /** Per-function rate limit: 1000 requests per minute */
  function: {
    windowMs: RATE_LIMITS.FUNCTION.WINDOW_MS,
    maxRequests: RATE_LIMITS.FUNCTION.MAX_REQUESTS,
  },
} as const

/**
 * Create a pre-configured composite rate limiter with default settings
 */
export function createDefaultRateLimiter(): CompositeRateLimiter {
  const composite = new CompositeRateLimiter()
  composite.addLimiter('ip', new InMemoryRateLimiter(DEFAULT_RATE_LIMITS.ip))
  composite.addLimiter('function', new InMemoryRateLimiter(DEFAULT_RATE_LIMITS.function))
  return composite
}

/**
 * Extract client IP from request headers
 * Supports common proxy headers used by Cloudflare and other CDNs
 */
export function getClientIP(request: Request): string {
  // Cloudflare's connecting IP header (most reliable when behind Cloudflare)
  const cfConnectingIP = request.headers.get('CF-Connecting-IP')
  if (cfConnectingIP) return cfConnectingIP

  // Standard forwarded header
  const xForwardedFor = request.headers.get('X-Forwarded-For')
  if (xForwardedFor) {
    // Take the first IP in the chain (original client)
    return xForwardedFor.split(',')[0].trim()
  }

  // Real IP header (used by some proxies)
  const xRealIP = request.headers.get('X-Real-IP')
  if (xRealIP) return xRealIP

  // Fallback to unknown (should rarely happen in production)
  return 'unknown'
}

/**
 * Create a 429 Too Many Requests response with appropriate headers
 */
export function createRateLimitResponse(result: RateLimitResult, category?: string): Response {
  const retryAfterSeconds = Math.ceil((result.resetAt - Date.now()) / 1000)

  const body = {
    error: 'Too Many Requests',
    message: category
      ? `Rate limit exceeded for ${category}. Please retry after ${retryAfterSeconds} seconds.`
      : `Rate limit exceeded. Please retry after ${retryAfterSeconds} seconds.`,
    retryAfter: retryAfterSeconds,
    resetAt: result.resetAt,
  }

  return new Response(JSON.stringify(body), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfterSeconds),
      'X-RateLimit-Remaining': String(result.remaining),
      'X-RateLimit-Reset': String(result.resetAt),
    },
  })
}
