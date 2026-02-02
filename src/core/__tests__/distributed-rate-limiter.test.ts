/**
 * Distributed Rate Limiter Tests
 *
 * Tests for the Durable Object-backed distributed rate limiting:
 * - RateLimiterDO Durable Object
 * - DurableObjectRateLimiter client
 * - createDistributedRateLimiter factory
 * - Cross-instance rate limiting behavior
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  RateLimiterDO,
  DurableObjectRateLimiter,
  createDistributedRateLimiter,
  DEFAULT_RATE_LIMITS,
  type RateLimitConfig,
} from '../rate-limiter'
import { createMockDurableObjectState, createMockRateLimiterNamespace, createResettableMockNamespace } from '../../test-utils/mock-durable-object'

describe('RateLimiterDO', () => {
  let doInstance: RateLimiterDO
  const config: RateLimitConfig = {
    windowMs: 60_000,
    maxRequests: 10,
  }

  beforeEach(() => {
    vi.useFakeTimers()
    // Create a fresh DO instance for each test
    const mockState = createMockDurableObjectState()
    doInstance = new RateLimiterDO(mockState)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('check action', () => {
    it('should allow first request for a new key', async () => {
      const request = new Request('http://rate-limiter/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'check',
          key: 'test-key',
          config,
        }),
      })

      const response = await doInstance.fetch(request)
      const data = await response.json() as { result: { allowed: boolean; remaining: number } }

      expect(response.status).toBe(200)
      expect(data.result.allowed).toBe(true)
      expect(data.result.remaining).toBe(config.maxRequests - 1)
    })
  })

  describe('checkAndIncrement action', () => {
    it('should increment counter on each request', async () => {
      const makeRequest = async () => {
        const request = new Request('http://rate-limiter/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'checkAndIncrement',
            key: 'test-key',
            config,
          }),
        })
        const response = await doInstance.fetch(request)
        return response.json() as Promise<{ result: { allowed: boolean; remaining: number } }>
      }

      const result1 = await makeRequest()
      expect(result1.result.remaining).toBe(9)

      const result2 = await makeRequest()
      expect(result2.result.remaining).toBe(8)

      const result3 = await makeRequest()
      expect(result3.result.remaining).toBe(7)
    })

    it('should block when limit is exceeded', async () => {
      const makeRequest = async () => {
        const request = new Request('http://rate-limiter/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'checkAndIncrement',
            key: 'test-key',
            config,
          }),
        })
        const response = await doInstance.fetch(request)
        return response.json() as Promise<{ result: { allowed: boolean; remaining: number } }>
      }

      // Exhaust the limit
      for (let i = 0; i < config.maxRequests; i++) {
        await makeRequest()
      }

      // Next request should be blocked
      const blockedResult = await makeRequest()
      expect(blockedResult.result.allowed).toBe(false)
      expect(blockedResult.result.remaining).toBe(0)
    })
  })

  describe('reset action', () => {
    it('should reset the rate limit for a key', async () => {
      // First, use up some quota
      const incrementRequest = new Request('http://rate-limiter/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'checkAndIncrement',
          key: 'test-key',
          config,
        }),
      })

      for (let i = 0; i < 5; i++) {
        await doInstance.fetch(incrementRequest)
      }

      // Reset
      const resetRequest = new Request('http://rate-limiter/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset',
          key: 'test-key',
          config,
        }),
      })
      await doInstance.fetch(resetRequest)

      // Check should show full quota again
      const checkRequest = new Request('http://rate-limiter/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'check',
          key: 'test-key',
          config,
        }),
      })
      const response = await doInstance.fetch(checkRequest)
      const data = await response.json() as { result: { remaining: number } }

      expect(data.result.remaining).toBe(config.maxRequests - 1)
    })
  })

  describe('window expiration', () => {
    it('should reset after window expires', async () => {
      const makeRequest = async () => {
        const request = new Request('http://rate-limiter/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'checkAndIncrement',
            key: 'test-key',
            config,
          }),
        })
        const response = await doInstance.fetch(request)
        return response.json() as Promise<{ result: { allowed: boolean; remaining: number } }>
      }

      // Exhaust the limit
      for (let i = 0; i < config.maxRequests; i++) {
        await makeRequest()
      }

      // Should be blocked
      let result = await makeRequest()
      expect(result.result.allowed).toBe(false)

      // Advance time past the window
      vi.advanceTimersByTime(config.windowMs + 1)

      // Should be allowed again
      result = await makeRequest()
      expect(result.result.allowed).toBe(true)
      expect(result.result.remaining).toBe(config.maxRequests - 1)
    })
  })
})

describe('DurableObjectRateLimiter', () => {
  let namespace: DurableObjectNamespace
  let resetNamespace: () => void
  const config: RateLimitConfig = {
    windowMs: 60_000,
    maxRequests: 10,
  }

  beforeEach(() => {
    vi.useFakeTimers()
    const mock = createResettableMockNamespace()
    namespace = mock.namespace
    resetNamespace = mock.reset
  })

  afterEach(() => {
    vi.useRealTimers()
    resetNamespace()
  })

  describe('check()', () => {
    it('should check without incrementing', async () => {
      const limiter = new DurableObjectRateLimiter(namespace, config, 'test')

      const result1 = await limiter.check('key1')
      const result2 = await limiter.check('key1')
      const result3 = await limiter.check('key1')

      // All checks should show same remaining (no increment on check)
      expect(result1.remaining).toBe(result2.remaining)
      expect(result2.remaining).toBe(result3.remaining)
    })
  })

  describe('checkAndIncrement()', () => {
    it('should increment on each call', async () => {
      const limiter = new DurableObjectRateLimiter(namespace, config, 'test')

      const result1 = await limiter.checkAndIncrement('key1')
      const result2 = await limiter.checkAndIncrement('key1')
      const result3 = await limiter.checkAndIncrement('key1')

      expect(result1.remaining).toBe(9)
      expect(result2.remaining).toBe(8)
      expect(result3.remaining).toBe(7)
    })

    it('should track different keys independently', async () => {
      const limiter = new DurableObjectRateLimiter(namespace, config, 'test')

      // Use up quota for key1
      for (let i = 0; i < config.maxRequests; i++) {
        await limiter.checkAndIncrement('key1')
      }

      // key1 should be blocked
      const result1 = await limiter.checkAndIncrement('key1')
      expect(result1.allowed).toBe(false)

      // key2 should still have full quota
      const result2 = await limiter.checkAndIncrement('key2')
      expect(result2.allowed).toBe(true)
      expect(result2.remaining).toBe(config.maxRequests - 1)
    })
  })

  describe('reset()', () => {
    it('should reset a key', async () => {
      const limiter = new DurableObjectRateLimiter(namespace, config, 'test')

      // Use some quota
      for (let i = 0; i < 5; i++) {
        await limiter.checkAndIncrement('key1')
      }

      // Reset
      await limiter.reset('key1')

      // Should have full quota again
      const result = await limiter.check('key1')
      expect(result.remaining).toBe(config.maxRequests - 1)
    })
  })

  describe('getConfig()', () => {
    it('should return the configuration', () => {
      const limiter = new DurableObjectRateLimiter(namespace, config, 'test')
      const returnedConfig = limiter.getConfig()

      expect(returnedConfig.windowMs).toBe(config.windowMs)
      expect(returnedConfig.maxRequests).toBe(config.maxRequests)
    })

    it('should return a copy of the configuration', () => {
      const limiter = new DurableObjectRateLimiter(namespace, config, 'test')
      const returnedConfig = limiter.getConfig()
      returnedConfig.maxRequests = 999

      expect(limiter.getConfig().maxRequests).toBe(config.maxRequests)
    })
  })
})

describe('createDistributedRateLimiter()', () => {
  let namespace: DurableObjectNamespace
  let resetNamespace: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    const mock = createResettableMockNamespace()
    namespace = mock.namespace
    resetNamespace = mock.reset
  })

  afterEach(() => {
    vi.useRealTimers()
    resetNamespace()
  })

  it('should create a composite rate limiter with IP and function limiters', () => {
    const limiter = createDistributedRateLimiter(namespace)

    expect(limiter.getLimiter('ip')).toBeDefined()
    expect(limiter.getLimiter('function')).toBeDefined()
  })

  it('should use default rate limits', async () => {
    const limiter = createDistributedRateLimiter(namespace)

    const ipLimiter = limiter.getLimiter('ip')!
    const functionLimiter = limiter.getLimiter('function')!

    expect(ipLimiter.getConfig().windowMs).toBe(DEFAULT_RATE_LIMITS.ip.windowMs)
    expect(ipLimiter.getConfig().maxRequests).toBe(DEFAULT_RATE_LIMITS.ip.maxRequests)
    expect(functionLimiter.getConfig().windowMs).toBe(DEFAULT_RATE_LIMITS.function.windowMs)
    expect(functionLimiter.getConfig().maxRequests).toBe(DEFAULT_RATE_LIMITS.function.maxRequests)
  })

  it('should allow custom rate limit configurations', async () => {
    const customConfig = {
      ip: { windowMs: 30_000, maxRequests: 50 },
      function: { windowMs: 120_000, maxRequests: 500 },
    }

    const limiter = createDistributedRateLimiter(namespace, customConfig)

    const ipLimiter = limiter.getLimiter('ip')!
    const functionLimiter = limiter.getLimiter('function')!

    expect(ipLimiter.getConfig().windowMs).toBe(30_000)
    expect(ipLimiter.getConfig().maxRequests).toBe(50)
    expect(functionLimiter.getConfig().windowMs).toBe(120_000)
    expect(functionLimiter.getConfig().maxRequests).toBe(500)
  })

  describe('checkAndIncrementAll()', () => {
    it('should check both IP and function limits', async () => {
      const limiter = createDistributedRateLimiter(namespace)

      const result = await limiter.checkAndIncrementAll({
        ip: '192.168.1.1',
        function: 'my-function',
      })

      expect(result.allowed).toBe(true)
      expect(result.results.ip).toBeDefined()
      expect(result.results.function).toBeDefined()
    })

    it('should block when IP limit is exceeded', async () => {
      const customConfig = {
        ip: { windowMs: 60_000, maxRequests: 3 },
        function: { windowMs: 60_000, maxRequests: 1000 },
      }
      const limiter = createDistributedRateLimiter(namespace, customConfig)

      // Exhaust IP limit
      for (let i = 0; i < 3; i++) {
        await limiter.checkAndIncrementAll({
          ip: '192.168.1.1',
          function: 'my-function',
        })
      }

      // Should be blocked by IP limit
      const result = await limiter.checkAndIncrementAll({
        ip: '192.168.1.1',
        function: 'my-function',
      })

      expect(result.allowed).toBe(false)
      expect(result.blockingCategory).toBe('ip')
    })

    it('should block when function limit is exceeded', async () => {
      const customConfig = {
        ip: { windowMs: 60_000, maxRequests: 1000 },
        function: { windowMs: 60_000, maxRequests: 3 },
      }
      const limiter = createDistributedRateLimiter(namespace, customConfig)

      // Exhaust function limit with different IPs
      for (let i = 0; i < 3; i++) {
        await limiter.checkAndIncrementAll({
          ip: `192.168.1.${i + 1}`,
          function: 'limited-function',
        })
      }

      // Should be blocked by function limit
      const result = await limiter.checkAndIncrementAll({
        ip: '192.168.1.100', // Different IP
        function: 'limited-function',
      })

      expect(result.allowed).toBe(false)
      expect(result.blockingCategory).toBe('function')
    })
  })
})

describe('Distributed rate limiting - cross-instance behavior', () => {
  let namespace: DurableObjectNamespace
  let resetNamespace: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    const mock = createResettableMockNamespace()
    namespace = mock.namespace
    resetNamespace = mock.reset
  })

  afterEach(() => {
    vi.useRealTimers()
    resetNamespace()
  })

  it('should share rate limit state across multiple limiter instances', async () => {
    const config = { windowMs: 60_000, maxRequests: 5 }

    // Simulate multiple Worker instances with their own limiter objects
    // but sharing the same DO namespace
    const limiter1 = new DurableObjectRateLimiter(namespace, config, 'ip')
    const limiter2 = new DurableObjectRateLimiter(namespace, config, 'ip')
    const limiter3 = new DurableObjectRateLimiter(namespace, config, 'ip')

    // Each "worker" makes a request for the same IP
    await limiter1.checkAndIncrement('192.168.1.1')
    await limiter2.checkAndIncrement('192.168.1.1')
    await limiter3.checkAndIncrement('192.168.1.1')

    // Any limiter should see the combined count
    const result = await limiter1.check('192.168.1.1')
    expect(result.remaining).toBe(2) // 5 max - 3 used = 2 remaining

    // Use up the rest
    await limiter2.checkAndIncrement('192.168.1.1')
    await limiter3.checkAndIncrement('192.168.1.1')

    // All limiters should now block this IP
    const blocked1 = await limiter1.checkAndIncrement('192.168.1.1')
    const blocked2 = await limiter2.checkAndIncrement('192.168.1.1')
    const blocked3 = await limiter3.checkAndIncrement('192.168.1.1')

    expect(blocked1.allowed).toBe(false)
    expect(blocked2.allowed).toBe(false)
    expect(blocked3.allowed).toBe(false)
  })

  it('should correctly handle concurrent requests from different IPs', async () => {
    const config = { windowMs: 60_000, maxRequests: 2 }

    const limiter1 = new DurableObjectRateLimiter(namespace, config, 'ip')
    const limiter2 = new DurableObjectRateLimiter(namespace, config, 'ip')

    // Concurrent requests from different IPs
    const [result1, result2, result3, result4] = await Promise.all([
      limiter1.checkAndIncrement('ip-a'),
      limiter2.checkAndIncrement('ip-b'),
      limiter1.checkAndIncrement('ip-a'),
      limiter2.checkAndIncrement('ip-b'),
    ])

    // All should be allowed (2 requests per IP, limit is 2)
    expect(result1.allowed).toBe(true)
    expect(result2.allowed).toBe(true)
    expect(result3.allowed).toBe(true)
    expect(result4.allowed).toBe(true)

    // Third request for each IP should be blocked
    const blocked1 = await limiter1.checkAndIncrement('ip-a')
    const blocked2 = await limiter2.checkAndIncrement('ip-b')

    expect(blocked1.allowed).toBe(false)
    expect(blocked2.allowed).toBe(false)
  })
})
