/**
 * Rate Limiter Tests
 *
 * Tests for the rate limiting functionality including:
 * - InMemoryRateLimiter basic operations
 * - Window expiration and reset
 * - CompositeRateLimiter with multiple limiters
 * - Helper functions (getClientIP, createRateLimitResponse)
 * - Integration with worker fetch handler
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  InMemoryRateLimiter,
  CompositeRateLimiter,
  createDefaultRateLimiter,
  getClientIP,
  createRateLimitResponse,
  DEFAULT_RATE_LIMITS,
  type RateLimitConfig,
  type RateLimitResult,
} from '../rate-limiter'

describe('InMemoryRateLimiter', () => {
  let limiter: InMemoryRateLimiter
  const config: RateLimitConfig = {
    windowMs: 60_000, // 1 minute
    maxRequests: 10,
  }

  beforeEach(() => {
    vi.useFakeTimers()
    limiter = new InMemoryRateLimiter(config)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('check()', () => {
    it('should allow first request for a new key', async () => {
      const result = await limiter.check('test-key')

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(config.maxRequests - 1)
      expect(result.resetAt).toBeGreaterThan(Date.now())
    })

    it('should not increment counter on check', async () => {
      await limiter.check('test-key')
      await limiter.check('test-key')
      await limiter.check('test-key')

      const result = await limiter.check('test-key')

      // Counter should still be at 0 since check doesn't increment
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(config.maxRequests - 1)
    })

    it('should return correct remaining count after increments', async () => {
      const key = 'test-key'

      await limiter.increment(key)
      await limiter.increment(key)
      await limiter.increment(key)

      const result = await limiter.check(key)

      expect(result.remaining).toBe(config.maxRequests - 3)
    })

    it('should return allowed=false when limit is exceeded', async () => {
      const key = 'test-key'

      // Exhaust the limit
      for (let i = 0; i < config.maxRequests; i++) {
        await limiter.increment(key)
      }

      const result = await limiter.check(key)

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })
  })

  describe('increment()', () => {
    it('should increment the counter for a key', async () => {
      const key = 'test-key'

      await limiter.increment(key)
      const result = await limiter.check(key)

      expect(result.remaining).toBe(config.maxRequests - 1)
    })

    it('should create a new window for a new key', async () => {
      const key = 'new-key'
      const now = Date.now()

      await limiter.increment(key)
      const result = await limiter.check(key)

      expect(result.resetAt).toBeGreaterThanOrEqual(now + config.windowMs)
    })

    it('should increment existing window', async () => {
      const key = 'test-key'

      await limiter.increment(key)
      await limiter.increment(key)
      await limiter.increment(key)

      const result = await limiter.check(key)

      expect(result.remaining).toBe(config.maxRequests - 3)
    })
  })

  describe('checkAndIncrement()', () => {
    it('should check and increment atomically', async () => {
      const key = 'test-key'

      const result1 = await limiter.checkAndIncrement(key)
      const result2 = await limiter.checkAndIncrement(key)

      expect(result1.allowed).toBe(true)
      expect(result1.remaining).toBe(config.maxRequests - 1)
      expect(result2.allowed).toBe(true)
      expect(result2.remaining).toBe(config.maxRequests - 2)
    })

    it('should not increment when limit is reached', async () => {
      const key = 'test-key'

      // Exhaust the limit
      for (let i = 0; i < config.maxRequests; i++) {
        await limiter.checkAndIncrement(key)
      }

      // This should fail and not increment
      const result = await limiter.checkAndIncrement(key)

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('should return consistent resetAt for same window', async () => {
      const key = 'test-key'

      const result1 = await limiter.checkAndIncrement(key)
      const result2 = await limiter.checkAndIncrement(key)

      expect(result1.resetAt).toBe(result2.resetAt)
    })
  })

  describe('Window Expiration', () => {
    it('should reset window after expiration', async () => {
      const key = 'test-key'

      // Exhaust the limit
      for (let i = 0; i < config.maxRequests; i++) {
        await limiter.increment(key)
      }

      // Verify limit is reached
      let result = await limiter.check(key)
      expect(result.allowed).toBe(false)

      // Advance time past the window
      vi.advanceTimersByTime(config.windowMs + 1)

      // Should be allowed again
      result = await limiter.check(key)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(config.maxRequests - 1)
    })

    it('should create new window on increment after expiration', async () => {
      const key = 'test-key'

      await limiter.increment(key)
      const firstReset = (await limiter.check(key)).resetAt

      // Advance time past the window
      vi.advanceTimersByTime(config.windowMs + 1)

      await limiter.increment(key)
      const secondReset = (await limiter.check(key)).resetAt

      expect(secondReset).toBeGreaterThan(firstReset)
    })
  })

  describe('reset()', () => {
    it('should reset the rate limit for a specific key', async () => {
      const key = 'test-key'

      // Add some requests
      for (let i = 0; i < 5; i++) {
        await limiter.increment(key)
      }

      // Reset the key
      await limiter.reset(key)

      // Should be back to full limit
      const result = await limiter.check(key)
      expect(result.remaining).toBe(config.maxRequests - 1)
    })

    it('should not affect other keys', async () => {
      const key1 = 'key-1'
      const key2 = 'key-2'

      await limiter.increment(key1)
      await limiter.increment(key1)
      await limiter.increment(key2)

      await limiter.reset(key1)

      const result1 = await limiter.check(key1)
      const result2 = await limiter.check(key2)

      expect(result1.remaining).toBe(config.maxRequests - 1)
      expect(result2.remaining).toBe(config.maxRequests - 1)
    })
  })

  describe('getConfig()', () => {
    it('should return the configuration', () => {
      const returnedConfig = limiter.getConfig()

      expect(returnedConfig.windowMs).toBe(config.windowMs)
      expect(returnedConfig.maxRequests).toBe(config.maxRequests)
    })

    it('should return a copy of the configuration', () => {
      const returnedConfig = limiter.getConfig()
      returnedConfig.maxRequests = 999

      expect(limiter.getConfig().maxRequests).toBe(config.maxRequests)
    })
  })

  describe('cleanup()', () => {
    it('should remove expired windows', async () => {
      const key1 = 'key-1'
      const key2 = 'key-2'

      await limiter.increment(key1)

      // Advance time past the window for key1
      vi.advanceTimersByTime(config.windowMs + 1)

      // Add key2 in the new window
      await limiter.increment(key2)

      // Before cleanup
      expect(limiter.getTrackedKeyCount()).toBe(2)

      // Cleanup should remove expired key1
      limiter.cleanup()

      expect(limiter.getTrackedKeyCount()).toBe(1)
    })

    it('should not remove active windows', async () => {
      await limiter.increment('key-1')
      await limiter.increment('key-2')
      await limiter.increment('key-3')

      limiter.cleanup()

      expect(limiter.getTrackedKeyCount()).toBe(3)
    })
  })

  describe('getTrackedKeyCount()', () => {
    it('should return the number of tracked keys', async () => {
      expect(limiter.getTrackedKeyCount()).toBe(0)

      await limiter.increment('key-1')
      expect(limiter.getTrackedKeyCount()).toBe(1)

      await limiter.increment('key-2')
      expect(limiter.getTrackedKeyCount()).toBe(2)

      await limiter.increment('key-1') // Same key, should not increase count
      expect(limiter.getTrackedKeyCount()).toBe(2)
    })
  })
})

describe('CompositeRateLimiter', () => {
  let composite: CompositeRateLimiter
  let ipLimiter: InMemoryRateLimiter
  let functionLimiter: InMemoryRateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    composite = new CompositeRateLimiter()

    ipLimiter = new InMemoryRateLimiter({
      windowMs: 60_000,
      maxRequests: 10,
    })

    functionLimiter = new InMemoryRateLimiter({
      windowMs: 60_000,
      maxRequests: 100,
    })

    composite.addLimiter('ip', ipLimiter)
    composite.addLimiter('function', functionLimiter)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('addLimiter() and getLimiter()', () => {
    it('should add and retrieve limiters', () => {
      expect(composite.getLimiter('ip')).toBe(ipLimiter)
      expect(composite.getLimiter('function')).toBe(functionLimiter)
    })

    it('should return undefined for unknown category', () => {
      expect(composite.getLimiter('unknown')).toBeUndefined()
    })
  })

  describe('checkAll()', () => {
    it('should check all rate limits and return combined result', async () => {
      const result = await composite.checkAll({
        ip: '1.2.3.4',
        function: 'my-func',
      })

      expect(result.allowed).toBe(true)
      expect(result.results).toHaveProperty('ip')
      expect(result.results).toHaveProperty('function')
      expect(result.results.ip.allowed).toBe(true)
      expect(result.results.function.allowed).toBe(true)
    })

    it('should fail if any limiter blocks', async () => {
      // Exhaust IP limit
      for (let i = 0; i < 10; i++) {
        await ipLimiter.increment('1.2.3.4')
      }

      const result = await composite.checkAll({
        ip: '1.2.3.4',
        function: 'my-func',
      })

      expect(result.allowed).toBe(false)
      expect(result.blockingCategory).toBe('ip')
      expect(result.results.ip.allowed).toBe(false)
      expect(result.results.function.allowed).toBe(true)
    })

    it('should skip unknown categories', async () => {
      const result = await composite.checkAll({
        ip: '1.2.3.4',
        unknown: 'value',
      })

      expect(result.allowed).toBe(true)
      expect(result.results).toHaveProperty('ip')
      expect(result.results).not.toHaveProperty('unknown')
    })
  })

  describe('checkAndIncrementAll()', () => {
    it('should check and increment all limits when allowed', async () => {
      const result = await composite.checkAndIncrementAll({
        ip: '1.2.3.4',
        function: 'my-func',
      })

      expect(result.allowed).toBe(true)

      // Verify counters were incremented
      const ipResult = await ipLimiter.check('1.2.3.4')
      const funcResult = await functionLimiter.check('my-func')

      expect(ipResult.remaining).toBe(9) // 10 - 1
      expect(funcResult.remaining).toBe(99) // 100 - 1
    })

    it('should not increment any limits when blocked', async () => {
      // Exhaust IP limit
      for (let i = 0; i < 10; i++) {
        await ipLimiter.increment('1.2.3.4')
      }

      const result = await composite.checkAndIncrementAll({
        ip: '1.2.3.4',
        function: 'my-func',
      })

      expect(result.allowed).toBe(false)

      // Function limiter should not have been incremented
      const funcResult = await functionLimiter.check('my-func')
      expect(funcResult.remaining).toBe(99) // Should still be at initial value
    })

    it('should track the blocking category', async () => {
      // Exhaust function limit (different from IP)
      for (let i = 0; i < 100; i++) {
        await functionLimiter.increment('my-func')
      }

      const result = await composite.checkAndIncrementAll({
        ip: '1.2.3.4',
        function: 'my-func',
      })

      expect(result.allowed).toBe(false)
      expect(result.blockingCategory).toBe('function')
    })
  })
})

describe('createDefaultRateLimiter()', () => {
  it('should create a composite limiter with default IP and function limits', () => {
    const limiter = createDefaultRateLimiter()

    expect(limiter.getLimiter('ip')).toBeDefined()
    expect(limiter.getLimiter('function')).toBeDefined()
  })

  it('should use default rate limit values', () => {
    const limiter = createDefaultRateLimiter()

    const ipLimiter = limiter.getLimiter('ip')
    const funcLimiter = limiter.getLimiter('function')

    expect(ipLimiter?.getConfig().windowMs).toBe(DEFAULT_RATE_LIMITS.ip.windowMs)
    expect(ipLimiter?.getConfig().maxRequests).toBe(DEFAULT_RATE_LIMITS.ip.maxRequests)
    expect(funcLimiter?.getConfig().windowMs).toBe(DEFAULT_RATE_LIMITS.function.windowMs)
    expect(funcLimiter?.getConfig().maxRequests).toBe(DEFAULT_RATE_LIMITS.function.maxRequests)
  })
})

describe('getClientIP()', () => {
  it('should extract IP from CF-Connecting-IP header', () => {
    const request = new Request('https://example.com', {
      headers: {
        'CF-Connecting-IP': '192.168.1.1',
        'X-Forwarded-For': '10.0.0.1',
        'X-Real-IP': '172.16.0.1',
      },
    })

    expect(getClientIP(request)).toBe('192.168.1.1')
  })

  it('should fall back to X-Forwarded-For if CF-Connecting-IP is not present', () => {
    const request = new Request('https://example.com', {
      headers: {
        'X-Forwarded-For': '10.0.0.1, 10.0.0.2, 10.0.0.3',
        'X-Real-IP': '172.16.0.1',
      },
    })

    expect(getClientIP(request)).toBe('10.0.0.1')
  })

  it('should extract first IP from X-Forwarded-For chain', () => {
    const request = new Request('https://example.com', {
      headers: {
        'X-Forwarded-For': '203.0.113.195, 70.41.3.18, 150.172.238.178',
      },
    })

    expect(getClientIP(request)).toBe('203.0.113.195')
  })

  it('should fall back to X-Real-IP if no other headers present', () => {
    const request = new Request('https://example.com', {
      headers: {
        'X-Real-IP': '172.16.0.1',
      },
    })

    expect(getClientIP(request)).toBe('172.16.0.1')
  })

  it('should return "unknown" if no IP headers are present', () => {
    const request = new Request('https://example.com')

    expect(getClientIP(request)).toBe('unknown')
  })

  it('should trim whitespace from IP addresses', () => {
    const request = new Request('https://example.com', {
      headers: {
        'X-Forwarded-For': '  10.0.0.1  , 10.0.0.2',
      },
    })

    expect(getClientIP(request)).toBe('10.0.0.1')
  })
})

describe('createRateLimitResponse()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return a 429 response', () => {
    const result: RateLimitResult = {
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
    }

    const response = createRateLimitResponse(result)

    expect(response.status).toBe(429)
  })

  it('should include Retry-After header', async () => {
    const result: RateLimitResult = {
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
    }

    const response = createRateLimitResponse(result)

    expect(response.headers.get('Retry-After')).toBe('30')
  })

  it('should include rate limit headers', async () => {
    const resetAt = Date.now() + 30_000
    const result: RateLimitResult = {
      allowed: false,
      remaining: 0,
      resetAt,
    }

    const response = createRateLimitResponse(result)

    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(response.headers.get('X-RateLimit-Reset')).toBe(String(resetAt))
  })

  it('should include category in error message when provided', async () => {
    const result: RateLimitResult = {
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
    }

    const response = createRateLimitResponse(result, 'ip')
    const body = await response.json()

    expect(body.message).toContain('ip')
  })

  it('should return JSON content type', () => {
    const result: RateLimitResult = {
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
    }

    const response = createRateLimitResponse(result)

    expect(response.headers.get('Content-Type')).toBe('application/json')
  })

  it('should include error details in body', async () => {
    const resetAt = Date.now() + 30_000
    const result: RateLimitResult = {
      allowed: false,
      remaining: 0,
      resetAt,
    }

    const response = createRateLimitResponse(result)
    const body = await response.json()

    expect(body.error).toBe('Too Many Requests')
    expect(body.retryAfter).toBe(30)
    expect(body.resetAt).toBe(resetAt)
  })
})

describe('DEFAULT_RATE_LIMITS', () => {
  it('should have IP rate limit configuration', () => {
    expect(DEFAULT_RATE_LIMITS.ip).toBeDefined()
    expect(DEFAULT_RATE_LIMITS.ip.windowMs).toBe(60_000)
    expect(DEFAULT_RATE_LIMITS.ip.maxRequests).toBe(100)
  })

  it('should have function rate limit configuration', () => {
    expect(DEFAULT_RATE_LIMITS.function).toBeDefined()
    expect(DEFAULT_RATE_LIMITS.function.windowMs).toBe(60_000)
    expect(DEFAULT_RATE_LIMITS.function.maxRequests).toBe(1000)
  })
})
