/**
 * Rate Limit Middleware Tests - RED Phase
 *
 * Tests for the refactored rate limiting middleware including:
 * - Request allowance under limit
 * - Blocking when limit exceeded
 * - Per-IP and per-function tracking
 * - Window expiration and reset
 *
 * These tests import modules that don't exist yet - they will FAIL
 * until the implementation is complete.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockKV } from '../../test-utils/mock-kv'

// Import the rate limit middleware that doesn't exist yet
// These imports will cause the tests to fail (RED phase)
import {
  rateLimitMiddleware,
  RateLimitMiddlewareConfig,
  createRateLimitMiddleware,
  RateLimitResult,
} from '../middleware/rate-limit'

// Type for JSON response bodies
type JsonBody = Record<string, unknown>

describe('Rate Limit Middleware', () => {
  let mockEnv: Record<string, unknown>
  let mockCtx: ExecutionContext

  beforeEach(() => {
    vi.useFakeTimers()

    mockEnv = {
      FUNCTIONS_REGISTRY: createMockKV(),
    }
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic rate limiting', () => {
    it('allows requests under limit', async () => {
      const config: RateLimitMiddlewareConfig = {
        limits: {
          ip: { windowMs: 60_000, maxRequests: 10 },
        },
      }

      const middleware = createRateLimitMiddleware(config)

      // Make requests under the limit
      for (let i = 0; i < 5; i++) {
        const request = new Request('https://functions.do/api/functions', {
          headers: { 'CF-Connecting-IP': '192.168.1.1' },
        })

        const result = await middleware(request, mockEnv, mockCtx)

        expect(result.allowed).toBe(true)
        expect(result.response).toBeUndefined()
      }
    })

    it('returns 429 when limit exceeded', async () => {
      const config: RateLimitMiddlewareConfig = {
        limits: {
          ip: { windowMs: 60_000, maxRequests: 3 },
        },
      }

      const middleware = createRateLimitMiddleware(config)

      // Exhaust the limit
      for (let i = 0; i < 3; i++) {
        const request = new Request('https://functions.do/api/functions', {
          headers: { 'CF-Connecting-IP': '10.0.0.1' },
        })
        await middleware(request, mockEnv, mockCtx)
      }

      // Fourth request should be blocked
      const request = new Request('https://functions.do/api/functions', {
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })

      const result = await middleware(request, mockEnv, mockCtx)

      expect(result.allowed).toBe(false)
      expect(result.response?.status).toBe(429)
    })

    it('includes Retry-After header', async () => {
      const config: RateLimitMiddlewareConfig = {
        limits: {
          ip: { windowMs: 60_000, maxRequests: 1 },
        },
      }

      const middleware = createRateLimitMiddleware(config)

      // Exhaust limit
      const request1 = new Request('https://functions.do/api/functions', {
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      await middleware(request1, mockEnv, mockCtx)

      // This request should be blocked
      const request2 = new Request('https://functions.do/api/functions', {
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })

      const result = await middleware(request2, mockEnv, mockCtx)

      expect(result.response?.headers.get('Retry-After')).toBeDefined()
      const retryAfter = parseInt(result.response?.headers.get('Retry-After') || '0', 10)
      expect(retryAfter).toBeGreaterThan(0)
      expect(retryAfter).toBeLessThanOrEqual(60)
    })

    it('includes rate limit headers in response', async () => {
      const config: RateLimitMiddlewareConfig = {
        limits: {
          ip: { windowMs: 60_000, maxRequests: 10 },
        },
      }

      const middleware = createRateLimitMiddleware(config)

      const request = new Request('https://functions.do/api/functions', {
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })

      const result = await middleware(request, mockEnv, mockCtx)

      // Even successful requests should have rate limit info
      expect(result.headers).toBeDefined()
      expect(result.headers?.['X-RateLimit-Limit']).toBe('10')
      expect(result.headers?.['X-RateLimit-Remaining']).toBe('9')
      expect(result.headers?.['X-RateLimit-Reset']).toBeDefined()
    })
  })

  describe('per-IP limits', () => {
    it('tracks per-IP limits', async () => {
      const config: RateLimitMiddlewareConfig = {
        limits: {
          ip: { windowMs: 60_000, maxRequests: 2 },
        },
      }

      const middleware = createRateLimitMiddleware(config)

      // Exhaust limit for IP 1
      for (let i = 0; i < 2; i++) {
        const request = new Request('https://functions.do/api/functions', {
          headers: { 'CF-Connecting-IP': '192.168.1.1' },
        })
        await middleware(request, mockEnv, mockCtx)
      }

      // IP 1 should be blocked
      const blockedRequest = new Request('https://functions.do/api/functions', {
        headers: { 'CF-Connecting-IP': '192.168.1.1' },
      })
      const blockedResult = await middleware(blockedRequest, mockEnv, mockCtx)
      expect(blockedResult.allowed).toBe(false)

      // IP 2 should still be allowed
      const allowedRequest = new Request('https://functions.do/api/functions', {
        headers: { 'CF-Connecting-IP': '192.168.1.2' },
      })
      const allowedResult = await middleware(allowedRequest, mockEnv, mockCtx)
      expect(allowedResult.allowed).toBe(true)
    })

    it('extracts IP from CF-Connecting-IP header', async () => {
      const config: RateLimitMiddlewareConfig = {
        limits: {
          ip: { windowMs: 60_000, maxRequests: 1 },
        },
      }

      const middleware = createRateLimitMiddleware(config)

      const request = new Request('https://functions.do/api/functions', {
        headers: {
          'CF-Connecting-IP': '203.0.113.195',
          'X-Forwarded-For': '10.0.0.1', // Should be ignored
        },
      })

      const result = await middleware(request, mockEnv, mockCtx)

      // First request should be allowed
      expect(result.allowed).toBe(true)
    })

    it('falls back to X-Forwarded-For', async () => {
      const config: RateLimitMiddlewareConfig = {
        limits: {
          ip: { windowMs: 60_000, maxRequests: 1 },
        },
      }

      const middleware = createRateLimitMiddleware(config)

      // Exhaust limit using X-Forwarded-For
      const request1 = new Request('https://functions.do/api/functions', {
        headers: {
          'X-Forwarded-For': '203.0.113.195, 70.41.3.18',
        },
      })
      await middleware(request1, mockEnv, mockCtx)

      // Same X-Forwarded-For should be blocked
      const request2 = new Request('https://functions.do/api/functions', {
        headers: {
          'X-Forwarded-For': '203.0.113.195, 70.41.3.18',
        },
      })
      const result = await middleware(request2, mockEnv, mockCtx)

      expect(result.allowed).toBe(false)
    })
  })

  describe('per-function limits', () => {
    it('tracks per-function limits', async () => {
      const config: RateLimitMiddlewareConfig = {
        limits: {
          function: { windowMs: 60_000, maxRequests: 5 },
        },
      }

      const middleware = createRateLimitMiddleware(config)

      // Exhaust limit for function-a
      for (let i = 0; i < 5; i++) {
        const request = new Request('https://functions.do/functions/function-a', {
          headers: { 'CF-Connecting-IP': `10.0.0.${i + 1}` }, // Different IPs
        })
        await middleware(request, mockEnv, mockCtx, { functionId: 'function-a' })
      }

      // function-a should be blocked
      const blockedRequest = new Request('https://functions.do/functions/function-a', {
        headers: { 'CF-Connecting-IP': '10.0.0.100' },
      })
      const blockedResult = await middleware(blockedRequest, mockEnv, mockCtx, { functionId: 'function-a' })
      expect(blockedResult.allowed).toBe(false)

      // function-b should still be allowed
      const allowedRequest = new Request('https://functions.do/functions/function-b', {
        headers: { 'CF-Connecting-IP': '10.0.0.100' },
      })
      const allowedResult = await middleware(allowedRequest, mockEnv, mockCtx, { functionId: 'function-b' })
      expect(allowedResult.allowed).toBe(true)
    })

    it('combines IP and function limits', async () => {
      const config: RateLimitMiddlewareConfig = {
        limits: {
          ip: { windowMs: 60_000, maxRequests: 100 },
          function: { windowMs: 60_000, maxRequests: 3 },
        },
      }

      const middleware = createRateLimitMiddleware(config)

      // Exhaust function limit with same IP
      for (let i = 0; i < 3; i++) {
        const request = new Request('https://functions.do/functions/limited-func', {
          headers: { 'CF-Connecting-IP': '192.168.1.1' },
        })
        await middleware(request, mockEnv, mockCtx, { functionId: 'limited-func' })
      }

      // Should be blocked by function limit (IP still has quota)
      const blockedRequest = new Request('https://functions.do/functions/limited-func', {
        headers: { 'CF-Connecting-IP': '192.168.1.2' }, // Different IP
      })
      const result = await middleware(blockedRequest, mockEnv, mockCtx, { functionId: 'limited-func' })

      expect(result.allowed).toBe(false)
      expect(result.limitType).toBe('function')
    })
  })

  describe('window expiration', () => {
    it('resets after window expires', async () => {
      const config: RateLimitMiddlewareConfig = {
        limits: {
          ip: { windowMs: 60_000, maxRequests: 1 },
        },
      }

      const middleware = createRateLimitMiddleware(config)

      // Exhaust limit
      const request1 = new Request('https://functions.do/api/functions', {
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      await middleware(request1, mockEnv, mockCtx)

      // Should be blocked
      const request2 = new Request('https://functions.do/api/functions', {
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      const blockedResult = await middleware(request2, mockEnv, mockCtx)
      expect(blockedResult.allowed).toBe(false)

      // Advance time past window
      vi.advanceTimersByTime(60_001)

      // Should be allowed again
      const request3 = new Request('https://functions.do/api/functions', {
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      const allowedResult = await middleware(request3, mockEnv, mockCtx)
      expect(allowedResult.allowed).toBe(true)
    })

    it('tracks separate windows for different keys', async () => {
      const config: RateLimitMiddlewareConfig = {
        limits: {
          ip: { windowMs: 60_000, maxRequests: 1 },
        },
      }

      const middleware = createRateLimitMiddleware(config)

      // Start window for IP 1
      const request1 = new Request('https://functions.do/api/functions', {
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      await middleware(request1, mockEnv, mockCtx)

      // Advance time by 30 seconds
      vi.advanceTimersByTime(30_000)

      // Start window for IP 2 (30 seconds later)
      const request2 = new Request('https://functions.do/api/functions', {
        headers: { 'CF-Connecting-IP': '10.0.0.2' },
      })
      await middleware(request2, mockEnv, mockCtx)

      // Advance time by 31 seconds (IP 1's window expires, IP 2's doesn't)
      vi.advanceTimersByTime(31_000)

      // IP 1 should be allowed (window expired)
      const request3 = new Request('https://functions.do/api/functions', {
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      const result1 = await middleware(request3, mockEnv, mockCtx)
      expect(result1.allowed).toBe(true)

      // IP 2 should still be blocked (window not yet expired)
      const request4 = new Request('https://functions.do/api/functions', {
        headers: { 'CF-Connecting-IP': '10.0.0.2' },
      })
      const result2 = await middleware(request4, mockEnv, mockCtx)
      expect(result2.allowed).toBe(false)
    })
  })

  describe('response body', () => {
    it('returns JSON error body on 429', async () => {
      const config: RateLimitMiddlewareConfig = {
        limits: {
          ip: { windowMs: 60_000, maxRequests: 1 },
        },
      }

      const middleware = createRateLimitMiddleware(config)

      // Exhaust limit
      const request1 = new Request('https://functions.do/api/functions', {
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      await middleware(request1, mockEnv, mockCtx)

      // Get blocked response
      const request2 = new Request('https://functions.do/api/functions', {
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      const result = await middleware(request2, mockEnv, mockCtx)

      expect(result.response?.headers.get('Content-Type')).toBe('application/json')

      const body = (await result.response?.json()) as JsonBody
      expect(body.error).toBe('Too Many Requests')
      expect(body.retryAfter).toBeDefined()
      expect(body.resetAt).toBeDefined()
    })

    it('includes limit type in error message', async () => {
      const config: RateLimitMiddlewareConfig = {
        limits: {
          ip: { windowMs: 60_000, maxRequests: 1 },
        },
      }

      const middleware = createRateLimitMiddleware(config)

      // Exhaust limit
      const request1 = new Request('https://functions.do/api/functions', {
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      await middleware(request1, mockEnv, mockCtx)

      // Get blocked response
      const request2 = new Request('https://functions.do/api/functions', {
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      const result = await middleware(request2, mockEnv, mockCtx)

      const body = (await result.response?.json()) as JsonBody
      expect(body.message).toContain('ip')
    })
  })

  describe('bypass rules', () => {
    it('bypasses rate limit for health endpoints', async () => {
      const config: RateLimitMiddlewareConfig = {
        limits: {
          ip: { windowMs: 60_000, maxRequests: 1 },
        },
        bypass: ['/health', '/'],
      }

      const middleware = createRateLimitMiddleware(config)

      // Many health requests should all be allowed
      for (let i = 0; i < 100; i++) {
        const request = new Request('https://functions.do/health', {
          headers: { 'CF-Connecting-IP': '10.0.0.1' },
        })
        const result = await middleware(request, mockEnv, mockCtx)
        expect(result.allowed).toBe(true)
      }
    })

    it('bypasses rate limit for whitelisted IPs', async () => {
      const config: RateLimitMiddlewareConfig = {
        limits: {
          ip: { windowMs: 60_000, maxRequests: 1 },
        },
        whitelistIPs: ['10.0.0.1', '192.168.1.0/24'],
      }

      const middleware = createRateLimitMiddleware(config)

      // Whitelisted IP should never be blocked
      for (let i = 0; i < 100; i++) {
        const request = new Request('https://functions.do/api/functions', {
          headers: { 'CF-Connecting-IP': '10.0.0.1' },
        })
        const result = await middleware(request, mockEnv, mockCtx)
        expect(result.allowed).toBe(true)
      }
    })
  })

  describe('custom rate limit rules', () => {
    it('supports endpoint-specific limits', async () => {
      const config: RateLimitMiddlewareConfig = {
        limits: {
          ip: { windowMs: 60_000, maxRequests: 100 },
        },
        endpointLimits: {
          'POST /api/functions': { windowMs: 60_000, maxRequests: 5 },
          'DELETE /api/functions/*': { windowMs: 60_000, maxRequests: 2 },
        },
      }

      const middleware = createRateLimitMiddleware(config)

      // Exhaust deploy limit
      for (let i = 0; i < 5; i++) {
        const request = new Request('https://functions.do/api/functions', {
          method: 'POST',
          headers: { 'CF-Connecting-IP': '10.0.0.1' },
        })
        await middleware(request, mockEnv, mockCtx)
      }

      // Deploy should be blocked
      const deployRequest = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      const deployResult = await middleware(deployRequest, mockEnv, mockCtx)
      expect(deployResult.allowed).toBe(false)

      // But GET should still be allowed (uses default IP limit)
      const getRequest = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      const getResult = await middleware(getRequest, mockEnv, mockCtx)
      expect(getResult.allowed).toBe(true)
    })

    it('supports custom key extraction', async () => {
      const config: RateLimitMiddlewareConfig = {
        limits: {
          custom: { windowMs: 60_000, maxRequests: 2 },
        },
        keyExtractor: (request) => {
          // Rate limit by API key instead of IP
          return request.headers.get('X-API-Key') || 'anonymous'
        },
      }

      const middleware = createRateLimitMiddleware(config)

      // Exhaust limit for API key 1
      for (let i = 0; i < 2; i++) {
        const request = new Request('https://functions.do/api/functions', {
          headers: {
            'CF-Connecting-IP': `10.0.0.${i + 1}`, // Different IPs
            'X-API-Key': 'api-key-1',
          },
        })
        await middleware(request, mockEnv, mockCtx)
      }

      // API key 1 should be blocked (different IP but same key)
      const blockedRequest = new Request('https://functions.do/api/functions', {
        headers: {
          'CF-Connecting-IP': '10.0.0.100',
          'X-API-Key': 'api-key-1',
        },
      })
      const blockedResult = await middleware(blockedRequest, mockEnv, mockCtx)
      expect(blockedResult.allowed).toBe(false)

      // API key 2 should be allowed
      const allowedRequest = new Request('https://functions.do/api/functions', {
        headers: {
          'CF-Connecting-IP': '10.0.0.1', // Same IP as first request
          'X-API-Key': 'api-key-2',
        },
      })
      const allowedResult = await middleware(allowedRequest, mockEnv, mockCtx)
      expect(allowedResult.allowed).toBe(true)
    })
  })
})

describe('rateLimitMiddleware default export', () => {
  let mockEnv: Record<string, unknown>
  let mockCtx: ExecutionContext

  beforeEach(() => {
    vi.useFakeTimers()

    mockEnv = {}
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses default configuration', async () => {
    const request = new Request('https://functions.do/api/functions', {
      headers: { 'CF-Connecting-IP': '10.0.0.1' },
    })

    const result = await rateLimitMiddleware(request, mockEnv, mockCtx)

    expect(result.allowed).toBe(true)
    expect(result.headers).toBeDefined()
  })

  it('bypasses health endpoint by default', async () => {
    // Make many requests to health
    for (let i = 0; i < 1000; i++) {
      const request = new Request('https://functions.do/health', {
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      const result = await rateLimitMiddleware(request, mockEnv, mockCtx)
      expect(result.allowed).toBe(true)
    }
  })
})
