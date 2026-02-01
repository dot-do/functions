/**
 * RateLimiterDO Durable Object Tests
 *
 * These tests validate the RateLimiterDO Durable Object functionality:
 * - Check rate limit without incrementing
 * - Increment rate limit counter
 * - Check and increment atomically
 * - Reset rate limit for a key
 * - Window expiration and reset
 * - Statistics and monitoring
 * - HTTP handler for all operations
 * - Alarm-based cleanup
 * - SQLite persistence
 *
 * @module durable-object/rate-limiter.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  RateLimiterDO,
  type RateLimitConfig,
  type RateLimitResult,
  type RateLimiterRequest,
  type RateLimiterResponse,
  type RateLimiterStats,
} from '../rate-limiter.js'

// ============================================================================
// Mock Types and Utilities
// ============================================================================

/**
 * Mock SQL result interface
 */
interface MockSqlResult<T> {
  one: () => T | null
  toArray: () => T[]
}

/**
 * Mock rate limit row from SQLite
 */
interface MockRateLimitRow {
  key: string
  count: number
  reset_at: number
}

/**
 * Mock SQLite storage that simulates Cloudflare DO SQLite behavior
 */
class MockSqlStorage {
  private rateLimits: Map<string, MockRateLimitRow> = new Map()
  public execCalls: { sql: string; params: unknown[] }[] = []
  public schemaCreated = false

  exec<T = unknown>(sql: string, ...params: unknown[]): MockSqlResult<T> {
    this.execCalls.push({ sql, params })
    const normalizedSql = sql.trim().toLowerCase()

    // Handle CREATE TABLE
    if (normalizedSql.includes('create table')) {
      this.schemaCreated = true
      return this.emptyResult<T>()
    }

    // Handle CREATE INDEX
    if (normalizedSql.includes('create index')) {
      return this.emptyResult<T>()
    }

    // Handle SELECT from rate_limits
    if (normalizedSql.includes('select') && normalizedSql.includes('rate_limits')) {
      const results = Array.from(this.rateLimits.values())
      return {
        one: () => (results[0] as T) || null,
        toArray: () => results as T[],
      }
    }

    // Handle INSERT OR REPLACE into rate_limits
    if (normalizedSql.includes('insert') && normalizedSql.includes('rate_limits')) {
      const row: MockRateLimitRow = {
        key: params[0] as string,
        count: params[1] as number,
        reset_at: params[2] as number,
      }
      this.rateLimits.set(row.key, row)
      return this.emptyResult<T>()
    }

    // Handle DELETE from rate_limits
    if (normalizedSql.includes('delete') && normalizedSql.includes('rate_limits')) {
      const key = params[0] as string
      this.rateLimits.delete(key)
      return this.emptyResult<T>()
    }

    return this.emptyResult<T>()
  }

  private emptyResult<T>(): MockSqlResult<T> {
    return {
      one: () => null,
      toArray: () => [],
    }
  }

  // Test helpers
  getRateLimit(key: string): MockRateLimitRow | undefined {
    return this.rateLimits.get(key)
  }

  getAllRateLimits(): MockRateLimitRow[] {
    return Array.from(this.rateLimits.values())
  }

  clear(): void {
    this.rateLimits.clear()
    this.execCalls = []
    this.schemaCreated = false
  }

  // Manually add rate limit for testing
  addRateLimit(key: string, count: number, resetAt: number): void {
    this.rateLimits.set(key, { key, count, reset_at: resetAt })
  }
}

/**
 * Mock Durable Object storage
 */
class MockDurableObjectStorage {
  public sql: MockSqlStorage
  private alarms: number[] = []

  constructor() {
    this.sql = new MockSqlStorage()
  }

  async setAlarm(time: number | Date): Promise<void> {
    const timestamp = time instanceof Date ? time.getTime() : time
    this.alarms.push(timestamp)
  }

  async getAlarm(): Promise<number | null> {
    return this.alarms[0] ?? null
  }

  async deleteAlarm(): Promise<void> {
    this.alarms.shift()
  }

  // Test helpers
  getAlarms(): number[] {
    return [...this.alarms]
  }

  clearAlarms(): void {
    this.alarms = []
  }
}

/**
 * Mock Durable Object state
 */
class MockDurableObjectState {
  public storage: MockDurableObjectStorage
  public id: DurableObjectId

  constructor() {
    this.storage = new MockDurableObjectStorage()
    this.id = { toString: () => 'test-rate-limiter-id' } as DurableObjectId
  }
}

/**
 * Create a rate limiter request
 */
function createRateLimiterRequest(
  action: RateLimiterRequest['action'],
  key: string,
  config?: RateLimitConfig
): Request {
  return new Request('https://rate-limiter.do/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, key, config }),
  })
}

// ============================================================================
// Test Suites
// ============================================================================

describe('RateLimiterDO Durable Object', () => {
  let rateLimiter: RateLimiterDO
  let mockState: MockDurableObjectState
  const defaultConfig: RateLimitConfig = {
    windowMs: 60_000, // 1 minute
    maxRequests: 10,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockState = new MockDurableObjectState()
    rateLimiter = new RateLimiterDO(mockState as unknown as DurableObjectState, {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe('initialization', () => {
    it('should create rate limiter instance', () => {
      expect(rateLimiter).toBeDefined()
      expect(rateLimiter).toBeInstanceOf(RateLimiterDO)
    })

    it('should not create schema until first operation', async () => {
      // Just creating the DO should not trigger any SQL
      expect(mockState.storage.sql.execCalls.length).toBe(0)
      expect(mockState.storage.sql.schemaCreated).toBe(false)
    })

    it('should initialize schema on first rate limit operation', async () => {
      const request = createRateLimiterRequest('checkAndIncrement', 'test-key', defaultConfig)
      await rateLimiter.fetch(request)

      expect(mockState.storage.sql.schemaCreated).toBe(true)
    })
  })

  // ==========================================================================
  // Check Rate Limit Tests
  // ==========================================================================

  describe('check rate limit', () => {
    it('should allow first request for a new key', async () => {
      const request = createRateLimiterRequest('check', 'new-key', defaultConfig)
      const response = await rateLimiter.fetch(request)
      const data = await response.json() as RateLimiterResponse

      expect(response.status).toBe(200)
      expect(data.result?.allowed).toBe(true)
      expect(data.result?.remaining).toBe(defaultConfig.maxRequests - 1)
    })

    it('should not increment counter on check', async () => {
      // Check multiple times
      for (let i = 0; i < 5; i++) {
        const request = createRateLimiterRequest('check', 'check-key', defaultConfig)
        await rateLimiter.fetch(request)
      }

      // Counter should still show full quota
      const request = createRateLimiterRequest('check', 'check-key', defaultConfig)
      const response = await rateLimiter.fetch(request)
      const data = await response.json() as RateLimiterResponse

      expect(data.result?.remaining).toBe(defaultConfig.maxRequests - 1)
    })

    it('should return correct remaining count after increments', async () => {
      // Increment 3 times
      for (let i = 0; i < 3; i++) {
        const request = createRateLimiterRequest('checkAndIncrement', 'count-key', defaultConfig)
        await rateLimiter.fetch(request)
      }

      // Check should show reduced quota
      const request = createRateLimiterRequest('check', 'count-key', defaultConfig)
      const response = await rateLimiter.fetch(request)
      const data = await response.json() as RateLimiterResponse

      expect(data.result?.remaining).toBe(defaultConfig.maxRequests - 3)
    })

    it('should return allowed=false when limit is exceeded', async () => {
      // Exhaust the limit
      for (let i = 0; i < defaultConfig.maxRequests; i++) {
        const request = createRateLimiterRequest('checkAndIncrement', 'exhausted-key', defaultConfig)
        await rateLimiter.fetch(request)
      }

      // Check should show not allowed
      const request = createRateLimiterRequest('check', 'exhausted-key', defaultConfig)
      const response = await rateLimiter.fetch(request)
      const data = await response.json() as RateLimiterResponse

      expect(data.result?.allowed).toBe(false)
      expect(data.result?.remaining).toBe(0)
    })

    it('should return reset time in the future', async () => {
      const now = Date.now()
      const request = createRateLimiterRequest('check', 'time-key', defaultConfig)
      const response = await rateLimiter.fetch(request)
      const data = await response.json() as RateLimiterResponse

      expect(data.result?.resetAt).toBeGreaterThanOrEqual(now + defaultConfig.windowMs)
    })
  })

  // ==========================================================================
  // Increment Rate Limit Tests
  // ==========================================================================

  describe('increment rate limit', () => {
    it('should increment the counter for a key', async () => {
      const request = createRateLimiterRequest('increment', 'inc-key', defaultConfig)
      await rateLimiter.fetch(request)

      // Check the counter
      const checkRequest = createRateLimiterRequest('check', 'inc-key', defaultConfig)
      const response = await rateLimiter.fetch(checkRequest)
      const data = await response.json() as RateLimiterResponse

      expect(data.result?.remaining).toBe(defaultConfig.maxRequests - 1)
    })

    it('should create a new window for a new key', async () => {
      const now = Date.now()
      const request = createRateLimiterRequest('increment', 'new-window-key', defaultConfig)
      await rateLimiter.fetch(request)

      const checkRequest = createRateLimiterRequest('check', 'new-window-key', defaultConfig)
      const response = await rateLimiter.fetch(checkRequest)
      const data = await response.json() as RateLimiterResponse

      expect(data.result?.resetAt).toBeGreaterThanOrEqual(now + defaultConfig.windowMs)
    })

    it('should increment existing window', async () => {
      // Increment multiple times
      for (let i = 0; i < 5; i++) {
        const request = createRateLimiterRequest('increment', 'multi-inc-key', defaultConfig)
        await rateLimiter.fetch(request)
      }

      const checkRequest = createRateLimiterRequest('check', 'multi-inc-key', defaultConfig)
      const response = await rateLimiter.fetch(checkRequest)
      const data = await response.json() as RateLimiterResponse

      expect(data.result?.remaining).toBe(defaultConfig.maxRequests - 5)
    })
  })

  // ==========================================================================
  // Check and Increment Tests
  // ==========================================================================

  describe('check and increment', () => {
    it('should check and increment atomically', async () => {
      const request1 = createRateLimiterRequest('checkAndIncrement', 'atomic-key', defaultConfig)
      const response1 = await rateLimiter.fetch(request1)
      const data1 = await response1.json() as RateLimiterResponse

      const request2 = createRateLimiterRequest('checkAndIncrement', 'atomic-key', defaultConfig)
      const response2 = await rateLimiter.fetch(request2)
      const data2 = await response2.json() as RateLimiterResponse

      expect(data1.result?.allowed).toBe(true)
      expect(data1.result?.remaining).toBe(defaultConfig.maxRequests - 1)
      expect(data2.result?.allowed).toBe(true)
      expect(data2.result?.remaining).toBe(defaultConfig.maxRequests - 2)
    })

    it('should not increment when limit is reached', async () => {
      // Exhaust the limit
      for (let i = 0; i < defaultConfig.maxRequests; i++) {
        const request = createRateLimiterRequest('checkAndIncrement', 'limited-key', defaultConfig)
        await rateLimiter.fetch(request)
      }

      // This should fail and not increment
      const request = createRateLimiterRequest('checkAndIncrement', 'limited-key', defaultConfig)
      const response = await rateLimiter.fetch(request)
      const data = await response.json() as RateLimiterResponse

      expect(data.result?.allowed).toBe(false)
      expect(data.result?.remaining).toBe(0)
    })

    it('should return consistent resetAt for same window', async () => {
      const request1 = createRateLimiterRequest('checkAndIncrement', 'consistent-key', defaultConfig)
      const response1 = await rateLimiter.fetch(request1)
      const data1 = await response1.json() as RateLimiterResponse

      const request2 = createRateLimiterRequest('checkAndIncrement', 'consistent-key', defaultConfig)
      const response2 = await rateLimiter.fetch(request2)
      const data2 = await response2.json() as RateLimiterResponse

      expect(data1.result?.resetAt).toBe(data2.result?.resetAt)
    })

    it('should track different keys independently', async () => {
      // Exhaust limit for key1
      for (let i = 0; i < defaultConfig.maxRequests; i++) {
        const request = createRateLimiterRequest('checkAndIncrement', 'key1', defaultConfig)
        await rateLimiter.fetch(request)
      }

      // key1 should be blocked
      const request1 = createRateLimiterRequest('checkAndIncrement', 'key1', defaultConfig)
      const response1 = await rateLimiter.fetch(request1)
      const data1 = await response1.json() as RateLimiterResponse

      // key2 should still have full quota
      const request2 = createRateLimiterRequest('checkAndIncrement', 'key2', defaultConfig)
      const response2 = await rateLimiter.fetch(request2)
      const data2 = await response2.json() as RateLimiterResponse

      expect(data1.result?.allowed).toBe(false)
      expect(data2.result?.allowed).toBe(true)
      expect(data2.result?.remaining).toBe(defaultConfig.maxRequests - 1)
    })
  })

  // ==========================================================================
  // Window Expiration Tests
  // ==========================================================================

  describe('window expiration', () => {
    it('should reset window after expiration', async () => {
      // Exhaust the limit
      for (let i = 0; i < defaultConfig.maxRequests; i++) {
        const request = createRateLimiterRequest('checkAndIncrement', 'expire-key', defaultConfig)
        await rateLimiter.fetch(request)
      }

      // Verify limit is reached
      let request = createRateLimiterRequest('check', 'expire-key', defaultConfig)
      let response = await rateLimiter.fetch(request)
      let data = await response.json() as RateLimiterResponse
      expect(data.result?.allowed).toBe(false)

      // Advance time past the window
      vi.advanceTimersByTime(defaultConfig.windowMs + 1)

      // Should be allowed again
      request = createRateLimiterRequest('check', 'expire-key', defaultConfig)
      response = await rateLimiter.fetch(request)
      data = await response.json() as RateLimiterResponse
      expect(data.result?.allowed).toBe(true)
      expect(data.result?.remaining).toBe(defaultConfig.maxRequests - 1)
    })

    it('should create new window on increment after expiration', async () => {
      const request1 = createRateLimiterRequest('checkAndIncrement', 'new-window', defaultConfig)
      const response1 = await rateLimiter.fetch(request1)
      const data1 = await response1.json() as RateLimiterResponse
      const firstReset = data1.result?.resetAt

      // Advance time past the window
      vi.advanceTimersByTime(defaultConfig.windowMs + 1)

      const request2 = createRateLimiterRequest('checkAndIncrement', 'new-window', defaultConfig)
      const response2 = await rateLimiter.fetch(request2)
      const data2 = await response2.json() as RateLimiterResponse

      expect(data2.result?.resetAt).toBeGreaterThan(firstReset!)
    })
  })

  // ==========================================================================
  // Reset Rate Limit Tests
  // ==========================================================================

  describe('reset rate limit', () => {
    it('should reset the rate limit for a specific key', async () => {
      // Add some requests
      for (let i = 0; i < 5; i++) {
        const request = createRateLimiterRequest('checkAndIncrement', 'reset-key', defaultConfig)
        await rateLimiter.fetch(request)
      }

      // Reset the key
      const resetRequest = createRateLimiterRequest('reset', 'reset-key', defaultConfig)
      await rateLimiter.fetch(resetRequest)

      // Should be back to full limit
      const checkRequest = createRateLimiterRequest('check', 'reset-key', defaultConfig)
      const response = await rateLimiter.fetch(checkRequest)
      const data = await response.json() as RateLimiterResponse

      expect(data.result?.remaining).toBe(defaultConfig.maxRequests - 1)
    })

    it('should not affect other keys', async () => {
      // Add requests to both keys
      for (let i = 0; i < 3; i++) {
        const request1 = createRateLimiterRequest('checkAndIncrement', 'reset-key-1', defaultConfig)
        await rateLimiter.fetch(request1)
        const request2 = createRateLimiterRequest('checkAndIncrement', 'reset-key-2', defaultConfig)
        await rateLimiter.fetch(request2)
      }

      // Reset only key-1
      const resetRequest = createRateLimiterRequest('reset', 'reset-key-1', defaultConfig)
      await rateLimiter.fetch(resetRequest)

      // key-1 should be reset
      const checkRequest1 = createRateLimiterRequest('check', 'reset-key-1', defaultConfig)
      const response1 = await rateLimiter.fetch(checkRequest1)
      const data1 = await response1.json() as RateLimiterResponse

      // key-2 should still have reduced quota
      const checkRequest2 = createRateLimiterRequest('check', 'reset-key-2', defaultConfig)
      const response2 = await rateLimiter.fetch(checkRequest2)
      const data2 = await response2.json() as RateLimiterResponse

      expect(data1.result?.remaining).toBe(defaultConfig.maxRequests - 1)
      expect(data2.result?.remaining).toBe(defaultConfig.maxRequests - 3)
    })
  })

  // ==========================================================================
  // Statistics Tests
  // ==========================================================================

  describe('statistics', () => {
    it('should return stats via HTTP GET /stats', async () => {
      // Add some rate limits
      for (let i = 0; i < 3; i++) {
        const request = createRateLimiterRequest('checkAndIncrement', `stats-key-${i}`, defaultConfig)
        await rateLimiter.fetch(request)
      }

      const statsRequest = new Request('https://rate-limiter.do/stats', {
        method: 'GET',
      })
      const response = await rateLimiter.fetch(statsRequest)
      const data = await response.json() as { stats: RateLimiterStats }

      expect(response.status).toBe(200)
      expect(data.stats).toBeDefined()
      expect(data.stats.totalKeys).toBe(3)
      expect(data.stats.activeWindows).toBe(3)
      expect(data.stats.totalRequests).toBe(3)
    })

    it('should return stats via POST action', async () => {
      const request = new Request('https://rate-limiter.do/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getStats', key: 'any' }),
      })
      const response = await rateLimiter.fetch(request)
      const data = await response.json() as RateLimiterResponse

      expect(data.stats).toBeDefined()
    })

    it('should accurately count requests across multiple keys', async () => {
      // Add varying requests to different keys
      for (let i = 0; i < 5; i++) {
        const request = createRateLimiterRequest('checkAndIncrement', 'multi-key-1', defaultConfig)
        await rateLimiter.fetch(request)
      }
      for (let i = 0; i < 3; i++) {
        const request = createRateLimiterRequest('checkAndIncrement', 'multi-key-2', defaultConfig)
        await rateLimiter.fetch(request)
      }

      const statsRequest = new Request('https://rate-limiter.do/stats', { method: 'GET' })
      const response = await rateLimiter.fetch(statsRequest)
      const data = await response.json() as { stats: RateLimiterStats }

      expect(data.stats.totalKeys).toBe(2)
      expect(data.stats.totalRequests).toBe(8)
    })
  })

  // ==========================================================================
  // HTTP Handler Tests
  // ==========================================================================

  describe('HTTP handler', () => {
    it('should handle POST /check requests', async () => {
      const request = createRateLimiterRequest('check', 'http-check-key', defaultConfig)
      const response = await rateLimiter.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json() as RateLimiterResponse
      expect(data.result).toBeDefined()
    })

    it('should handle POST /increment requests', async () => {
      const request = createRateLimiterRequest('increment', 'http-inc-key', defaultConfig)
      const response = await rateLimiter.fetch(request)

      expect(response.status).toBe(200)
    })

    it('should handle POST /checkAndIncrement requests', async () => {
      const request = createRateLimiterRequest('checkAndIncrement', 'http-cai-key', defaultConfig)
      const response = await rateLimiter.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json() as RateLimiterResponse
      expect(data.result?.allowed).toBe(true)
    })

    it('should handle POST /reset requests', async () => {
      const request = createRateLimiterRequest('reset', 'http-reset-key', defaultConfig)
      const response = await rateLimiter.fetch(request)

      expect(response.status).toBe(200)
    })

    it('should handle GET /stats requests', async () => {
      const request = new Request('https://rate-limiter.do/stats', { method: 'GET' })
      const response = await rateLimiter.fetch(request)

      expect(response.status).toBe(200)
    })

    it('should handle GET /cleanup requests', async () => {
      const request = new Request('https://rate-limiter.do/cleanup', { method: 'GET' })
      const response = await rateLimiter.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json() as { deleted: number }
      expect(data.deleted).toBeDefined()
    })

    it('should return 404 for unknown GET endpoints', async () => {
      const request = new Request('https://rate-limiter.do/unknown', { method: 'GET' })
      const response = await rateLimiter.fetch(request)

      expect(response.status).toBe(404)
    })

    it('should return 405 for unsupported methods', async () => {
      const request = new Request('https://rate-limiter.do/', { method: 'DELETE' })
      const response = await rateLimiter.fetch(request)

      expect(response.status).toBe(405)
    })

    it('should return 400 for missing key', async () => {
      const request = new Request('https://rate-limiter.do/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check', config: defaultConfig }),
      })
      const response = await rateLimiter.fetch(request)

      expect(response.status).toBe(400)
    })

    it('should return 400 for missing config on check', async () => {
      const request = new Request('https://rate-limiter.do/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check', key: 'test' }),
      })
      const response = await rateLimiter.fetch(request)

      expect(response.status).toBe(400)
    })

    it('should return 400 for unknown action', async () => {
      const request = new Request('https://rate-limiter.do/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unknown', key: 'test', config: defaultConfig }),
      })
      const response = await rateLimiter.fetch(request)

      expect(response.status).toBe(400)
    })
  })

  // ==========================================================================
  // Cleanup Tests
  // ==========================================================================

  describe('cleanup', () => {
    it('should remove expired windows via GET /cleanup', async () => {
      // Add some rate limits
      const request1 = createRateLimiterRequest('checkAndIncrement', 'cleanup-key-1', defaultConfig)
      await rateLimiter.fetch(request1)

      // Advance time past the window
      vi.advanceTimersByTime(defaultConfig.windowMs + 1)

      // Add another key (should not be deleted)
      const request2 = createRateLimiterRequest('checkAndIncrement', 'cleanup-key-2', defaultConfig)
      await rateLimiter.fetch(request2)

      // Run cleanup
      const cleanupRequest = new Request('https://rate-limiter.do/cleanup', { method: 'GET' })
      const response = await rateLimiter.fetch(cleanupRequest)
      const data = await response.json() as { deleted: number }

      expect(data.deleted).toBe(1)

      // Verify stats
      const statsRequest = new Request('https://rate-limiter.do/stats', { method: 'GET' })
      const statsResponse = await rateLimiter.fetch(statsRequest)
      const statsData = await statsResponse.json() as { stats: RateLimiterStats }

      expect(statsData.stats.totalKeys).toBe(1)
    })

    it('should not remove active windows', async () => {
      // Add multiple rate limits
      for (let i = 0; i < 3; i++) {
        const request = createRateLimiterRequest('checkAndIncrement', `active-key-${i}`, defaultConfig)
        await rateLimiter.fetch(request)
      }

      // Run cleanup (no time advanced)
      const cleanupRequest = new Request('https://rate-limiter.do/cleanup', { method: 'GET' })
      const response = await rateLimiter.fetch(cleanupRequest)
      const data = await response.json() as { deleted: number }

      expect(data.deleted).toBe(0)

      // Verify all keys still exist
      const statsRequest = new Request('https://rate-limiter.do/stats', { method: 'GET' })
      const statsResponse = await rateLimiter.fetch(statsRequest)
      const statsData = await statsResponse.json() as { stats: RateLimiterStats }

      expect(statsData.stats.totalKeys).toBe(3)
    })
  })

  // ==========================================================================
  // Alarm Handler Tests
  // ==========================================================================

  describe('alarm handler', () => {
    it('should cleanup expired windows on alarm', async () => {
      // Add rate limits
      const request1 = createRateLimiterRequest('checkAndIncrement', 'alarm-key-1', defaultConfig)
      await rateLimiter.fetch(request1)

      // Advance time past window
      vi.advanceTimersByTime(defaultConfig.windowMs + 1)

      // Trigger alarm
      await rateLimiter.alarm()

      // Verify cleanup happened
      const statsRequest = new Request('https://rate-limiter.do/stats', { method: 'GET' })
      const response = await rateLimiter.fetch(statsRequest)
      const data = await response.json() as { stats: RateLimiterStats }

      expect(data.stats.totalKeys).toBe(0)
    })

    it('should schedule next alarm if windows remain', async () => {
      // Add a rate limit
      const request = createRateLimiterRequest('checkAndIncrement', 'alarm-schedule-key', defaultConfig)
      await rateLimiter.fetch(request)

      // Trigger alarm (no cleanup needed yet)
      await rateLimiter.alarm()

      // Verify alarm was scheduled
      const alarms = mockState.storage.getAlarms()
      expect(alarms.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // Persistence Tests
  // ==========================================================================

  describe('persistence', () => {
    it('should persist rate limit to SQLite storage', async () => {
      const request = createRateLimiterRequest('checkAndIncrement', 'persist-key', defaultConfig)
      await rateLimiter.fetch(request)

      // Verify persisted in mock storage
      const stored = mockState.storage.sql.getRateLimit('persist-key')
      expect(stored).toBeDefined()
      expect(stored?.count).toBe(1)
    })

    it('should update persisted rate limit on increment', async () => {
      // Increment multiple times
      for (let i = 0; i < 3; i++) {
        const request = createRateLimiterRequest('checkAndIncrement', 'update-persist-key', defaultConfig)
        await rateLimiter.fetch(request)
      }

      const stored = mockState.storage.sql.getRateLimit('update-persist-key')
      expect(stored?.count).toBe(3)
    })

    it('should delete persisted rate limit on reset', async () => {
      // Create a rate limit
      const incRequest = createRateLimiterRequest('checkAndIncrement', 'delete-persist-key', defaultConfig)
      await rateLimiter.fetch(incRequest)

      // Reset it
      const resetRequest = createRateLimiterRequest('reset', 'delete-persist-key', defaultConfig)
      await rateLimiter.fetch(resetRequest)

      // Verify deleted from storage
      const stored = mockState.storage.sql.getRateLimit('delete-persist-key')
      expect(stored).toBeUndefined()
    })
  })

  // ==========================================================================
  // Edge Cases Tests
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle zero maxRequests config', async () => {
      const zeroConfig: RateLimitConfig = { windowMs: 60_000, maxRequests: 0 }
      const request = createRateLimiterRequest('checkAndIncrement', 'zero-limit-key', zeroConfig)
      const response = await rateLimiter.fetch(request)
      const data = await response.json() as RateLimiterResponse

      expect(data.result?.allowed).toBe(false)
      expect(data.result?.remaining).toBe(0)
    })

    it('should handle very large maxRequests config', async () => {
      const largeConfig: RateLimitConfig = { windowMs: 60_000, maxRequests: 1_000_000 }
      const request = createRateLimiterRequest('checkAndIncrement', 'large-limit-key', largeConfig)
      const response = await rateLimiter.fetch(request)
      const data = await response.json() as RateLimiterResponse

      expect(data.result?.allowed).toBe(true)
      expect(data.result?.remaining).toBe(999_999)
    })

    it('should handle very short window duration', async () => {
      const shortConfig: RateLimitConfig = { windowMs: 1, maxRequests: 10 }
      const request = createRateLimiterRequest('checkAndIncrement', 'short-window-key', shortConfig)
      const response = await rateLimiter.fetch(request)
      const data = await response.json() as RateLimiterResponse

      expect(data.result?.allowed).toBe(true)

      // Advance time slightly
      vi.advanceTimersByTime(2)

      // Should create new window
      const request2 = createRateLimiterRequest('checkAndIncrement', 'short-window-key', shortConfig)
      const response2 = await rateLimiter.fetch(request2)
      const data2 = await response2.json() as RateLimiterResponse

      expect(data2.result?.allowed).toBe(true)
      expect(data2.result?.remaining).toBe(9) // New window
    })

    it('should handle concurrent requests correctly', async () => {
      const promises = []
      for (let i = 0; i < 15; i++) {
        const request = createRateLimiterRequest('checkAndIncrement', 'concurrent-key', defaultConfig)
        promises.push(rateLimiter.fetch(request))
      }

      const responses = await Promise.all(promises)
      const results = await Promise.all(responses.map(r => r.json() as Promise<RateLimiterResponse>))

      // First 10 should be allowed, rest should be blocked
      const allowed = results.filter(r => r.result?.allowed).length
      const blocked = results.filter(r => !r.result?.allowed).length

      expect(allowed).toBe(defaultConfig.maxRequests)
      expect(blocked).toBe(5)
    })

    it('should handle empty key gracefully', async () => {
      const request = new Request('https://rate-limiter.do/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check', key: '', config: defaultConfig }),
      })
      const response = await rateLimiter.fetch(request)

      // Empty key should be treated as missing
      expect(response.status).toBe(400)
    })

    it('should handle special characters in key', async () => {
      const specialKey = 'user@example.com:192.168.1.1'
      const request = createRateLimiterRequest('checkAndIncrement', specialKey, defaultConfig)
      const response = await rateLimiter.fetch(request)
      const data = await response.json() as RateLimiterResponse

      expect(data.result?.allowed).toBe(true)
    })
  })

  // ==========================================================================
  // Configuration Variations Tests
  // ==========================================================================

  describe('configuration variations', () => {
    it('should handle different configs for different keys', async () => {
      const shortConfig: RateLimitConfig = { windowMs: 1000, maxRequests: 5 }
      const longConfig: RateLimitConfig = { windowMs: 60000, maxRequests: 100 }

      // Use short config for key1
      for (let i = 0; i < 5; i++) {
        const request = createRateLimiterRequest('checkAndIncrement', 'config-key-1', shortConfig)
        await rateLimiter.fetch(request)
      }

      // Use long config for key2
      for (let i = 0; i < 5; i++) {
        const request = createRateLimiterRequest('checkAndIncrement', 'config-key-2', longConfig)
        await rateLimiter.fetch(request)
      }

      // key1 should be exhausted (with shortConfig)
      const check1 = createRateLimiterRequest('checkAndIncrement', 'config-key-1', shortConfig)
      const response1 = await rateLimiter.fetch(check1)
      const data1 = await response1.json() as RateLimiterResponse

      // key2 should have plenty remaining (with longConfig)
      const check2 = createRateLimiterRequest('checkAndIncrement', 'config-key-2', longConfig)
      const response2 = await rateLimiter.fetch(check2)
      const data2 = await response2.json() as RateLimiterResponse

      expect(data1.result?.allowed).toBe(false)
      expect(data2.result?.allowed).toBe(true)
      expect(data2.result?.remaining).toBe(94) // 100 - 6
    })
  })
})
