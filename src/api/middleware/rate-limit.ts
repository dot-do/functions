/**
 * Rate Limit Middleware for Functions.do
 *
 * Provides request rate limiting based on IP, function ID, and custom keys.
 */

import {
  InMemoryRateLimiter,
  CompositeRateLimiter,
  RateLimitConfig,
  RateLimitResult as CoreRateLimitResult,
} from '../../core/rate-limiter'
import { jsonResponse } from '../http-utils'
import { RATE_LIMITS } from '../../config'

/**
 * Rate limit configuration for middleware
 */
export interface RateLimitMiddlewareConfig {
  limits?: {
    ip?: RateLimitConfig
    function?: RateLimitConfig
    custom?: RateLimitConfig
  }
  bypass?: string[]
  whitelistIPs?: string[]
  endpointLimits?: Record<string, RateLimitConfig>
  keyExtractor?: (request: Request) => string
}

/**
 * Context passed to rate limit middleware
 */
export interface RateLimitContext {
  functionId?: string
}

/**
 * Result from rate limit middleware
 */
export interface RateLimitResult {
  allowed: boolean
  response?: Response
  headers?: Record<string, string>
  limitType?: string
  remaining?: number
  resetAt?: number
}

// Re-export for convenience
export type { RateLimitConfig }

/**
 * Extract client IP from request
 */
function getClientIP(request: Request): string {
  const cfIP = request.headers.get('CF-Connecting-IP')
  if (cfIP) return cfIP

  const xForwardedFor = request.headers.get('X-Forwarded-For')
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0]!.trim()
  }

  const xRealIP = request.headers.get('X-Real-IP')
  if (xRealIP) return xRealIP

  return 'unknown'
}

/**
 * Extract function ID from request path
 */
function getFunctionIdFromPath(path: string): string | undefined {
  const match = path.match(/^\/functions\/([^\/]+)/)
  return match?.[1]
}

/**
 * Check if path matches bypass patterns
 */
function shouldBypass(path: string, bypass?: string[]): boolean {
  if (!bypass) return false
  return bypass.some(pattern => {
    if (pattern === path) return true
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2)
      return path.startsWith(prefix)
    }
    return false
  })
}

/**
 * Check if IP is whitelisted
 */
function isWhitelisted(ip: string, whitelist?: string[]): boolean {
  if (!whitelist) return false
  return whitelist.some(pattern => {
    if (pattern === ip) return true
    // Handle CIDR notation (simplified - just /24)
    if (pattern.includes('/')) {
      const [prefix] = pattern.split('/')
      if (prefix && ip.startsWith(prefix.replace(/\.\d+$/, '.'))) {
        return true
      }
    }
    return false
  })
}

/**
 * Get endpoint-specific limit if defined
 */
function getEndpointLimit(
  method: string,
  path: string,
  endpointLimits?: Record<string, RateLimitConfig>
): RateLimitConfig | undefined {
  if (!endpointLimits) return undefined

  const key = `${method} ${path}`
  if (endpointLimits[key]) return endpointLimits[key]

  // Try wildcard patterns
  for (const [pattern, limit] of Object.entries(endpointLimits)) {
    const [requiredMethod, requiredPath] = pattern.split(' ')
    if (requiredMethod !== method) continue

    if (requiredPath?.endsWith('/*')) {
      const prefix = requiredPath.slice(0, -2)
      if (path.startsWith(prefix)) return limit
    }
  }

  return undefined
}

/**
 * Create rate limit middleware with custom configuration
 */
export function createRateLimitMiddleware(config: RateLimitMiddlewareConfig) {
  const {
    limits = { ip: { windowMs: 60_000, maxRequests: 100 } },
    bypass = [],
    whitelistIPs,
    endpointLimits,
    keyExtractor,
  } = config

  // Create limiter storage for this middleware instance
  const limiters = new Map<string, InMemoryRateLimiter>()

  const getLimiter = (category: string, limitConfig: RateLimitConfig): InMemoryRateLimiter => {
    const key = `${category}:${limitConfig.windowMs}:${limitConfig.maxRequests}`
    let limiter = limiters.get(key)
    if (!limiter) {
      limiter = new InMemoryRateLimiter(limitConfig)
      limiters.set(key, limiter)
    }
    return limiter
  }

  const getCustomLimiter = (key: string, limitConfig: RateLimitConfig): InMemoryRateLimiter => {
    const fullKey = `custom:${key}:${limitConfig.windowMs}:${limitConfig.maxRequests}`
    let limiter = limiters.get(fullKey)
    if (!limiter) {
      limiter = new InMemoryRateLimiter(limitConfig)
      limiters.set(fullKey, limiter)
    }
    return limiter
  }

  return async (
    request: Request,
    env: Record<string, unknown>,
    ctx: ExecutionContext,
    context?: RateLimitContext
  ): Promise<RateLimitResult> => {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method.toUpperCase()
    const ip = getClientIP(request)

    // Check bypass
    if (shouldBypass(path, bypass)) {
      return {
        allowed: true,
        headers: {
          'X-RateLimit-Limit': 'unlimited',
          'X-RateLimit-Remaining': 'unlimited',
          'X-RateLimit-Reset': '0',
        },
      }
    }

    // Check whitelist
    if (isWhitelisted(ip, whitelistIPs)) {
      return {
        allowed: true,
        headers: {
          'X-RateLimit-Limit': 'unlimited',
          'X-RateLimit-Remaining': 'unlimited',
          'X-RateLimit-Reset': '0',
        },
      }
    }

    // Check endpoint-specific limits first
    const endpointLimit = getEndpointLimit(method, path, endpointLimits)
    if (endpointLimit) {
      const limiter = getCustomLimiter(`endpoint:${method}:${path}`, endpointLimit)
      const result = await limiter.checkAndIncrement(`${ip}:${method}:${path}`)

      if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000)
        return {
          allowed: false,
          limitType: 'endpoint',
          response: jsonResponse(
            {
              error: 'Too Many Requests',
              message: `Rate limit exceeded for endpoint. Please retry after ${retryAfter} seconds.`,
              retryAfter,
              resetAt: result.resetAt,
            },
            429,
            { 'Retry-After': String(retryAfter) }
          ),
          headers: {
            'X-RateLimit-Limit': String(endpointLimit.maxRequests),
            'X-RateLimit-Remaining': String(result.remaining),
            'X-RateLimit-Reset': String(result.resetAt),
          },
        }
      }
    }

    // Handle custom key extraction
    if (keyExtractor && limits.custom) {
      const customKey = keyExtractor(request)
      const limiter = getLimiter('custom', limits.custom)
      const result = await limiter.checkAndIncrement(customKey)

      if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000)
        return {
          allowed: false,
          limitType: 'custom',
          response: jsonResponse(
            {
              error: 'Too Many Requests',
              message: `Rate limit exceeded for custom key. Please retry after ${retryAfter} seconds.`,
              retryAfter,
              resetAt: result.resetAt,
            },
            429,
            { 'Retry-After': String(retryAfter) }
          ),
          headers: {
            'X-RateLimit-Limit': String(limits.custom.maxRequests),
            'X-RateLimit-Remaining': String(result.remaining),
            'X-RateLimit-Reset': String(result.resetAt),
          },
        }
      }

      return {
        allowed: true,
        headers: {
          'X-RateLimit-Limit': String(limits.custom.maxRequests),
          'X-RateLimit-Remaining': String(result.remaining),
          'X-RateLimit-Reset': String(result.resetAt),
        },
      }
    }

    // Check function limit first (more specific)
    const functionId = context?.functionId || getFunctionIdFromPath(path)
    if (functionId && limits.function) {
      const limiter = getLimiter('function', limits.function)
      const result = await limiter.checkAndIncrement(functionId)

      if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000)
        return {
          allowed: false,
          limitType: 'function',
          response: jsonResponse(
            {
              error: 'Too Many Requests',
              message: `Rate limit exceeded for function. Please retry after ${retryAfter} seconds.`,
              retryAfter,
              resetAt: result.resetAt,
            },
            429,
            { 'Retry-After': String(retryAfter) }
          ),
          headers: {
            'X-RateLimit-Limit': String(limits.function.maxRequests),
            'X-RateLimit-Remaining': String(result.remaining),
            'X-RateLimit-Reset': String(result.resetAt),
          },
        }
      }
    }

    // Check IP limit
    if (limits.ip) {
      const limiter = getLimiter('ip', limits.ip)
      const result = await limiter.checkAndIncrement(ip)

      if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000)
        return {
          allowed: false,
          limitType: 'ip',
          response: jsonResponse(
            {
              error: 'Too Many Requests',
              message: `Rate limit exceeded for ip. Please retry after ${retryAfter} seconds.`,
              retryAfter,
              resetAt: result.resetAt,
            },
            429,
            { 'Retry-After': String(retryAfter) }
          ),
          headers: {
            'X-RateLimit-Limit': String(limits.ip.maxRequests),
            'X-RateLimit-Remaining': String(result.remaining),
            'X-RateLimit-Reset': String(result.resetAt),
          },
        }
      }

      return {
        allowed: true,
        headers: {
          'X-RateLimit-Limit': String(limits.ip.maxRequests),
          'X-RateLimit-Remaining': String(result.remaining),
          'X-RateLimit-Reset': String(result.resetAt),
        },
      }
    }

    // No limits configured - allow
    return { allowed: true, headers: {} }
  }
}

/**
 * Default rate limit middleware with standard configuration (from centralized config)
 */
export const rateLimitMiddleware = createRateLimitMiddleware({
  limits: {
    ip: { windowMs: RATE_LIMITS.IP.WINDOW_MS, maxRequests: RATE_LIMITS.IP.MAX_REQUESTS },
    function: { windowMs: RATE_LIMITS.FUNCTION.WINDOW_MS, maxRequests: RATE_LIMITS.FUNCTION.MAX_REQUESTS },
  },
  bypass: ['/health', '/'],
})
