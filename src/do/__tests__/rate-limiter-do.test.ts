/**
 * RateLimiterDO Durable Object Tests
 *
 * Tests the RateLimiterDO Durable Object with real miniflare bindings
 * from cloudflare:test. These tests validate:
 *
 * 1. Should allow requests under the limit
 * 2. Should deny requests over the limit (429)
 * 3. Should track remaining count accurately
 * 4. Should reset after the time window expires
 * 5. Should handle multiple keys independently
 * 6. Should persist state across calls (since it's a DO)
 *
 * Uses Workers RPC to call methods directly on the DO stub.
 *
 * @module durable-object/rate-limiter-do.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import type { RateLimiterDO } from '../rate-limiter'

describe('RateLimiterDO', () => {
  let stub: DurableObjectStub<RateLimiterDO>
  let stubId: string

  beforeEach(() => {
    // Create a unique DO instance for each test to ensure isolation
    stubId = `test-limiter-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const id = env.RATE_LIMITER.idFromName(stubId)
    stub = env.RATE_LIMITER.get(id)
  })

  // ==========================================================================
  // 1. Should allow requests under the limit
  // ==========================================================================

  describe('allows requests under the limit', () => {
    it('should allow the first request for a new key', async () => {
      const result = await stub.check('new-key', 10, 60_000)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(10)
      expect(result.resetAt).toBeGreaterThan(Date.now() - 1000)
    })

    it('should allow requests when count is below the limit', async () => {
      // Make 5 requests with a limit of 10
      for (let i = 0; i < 5; i++) {
        await stub.increment('under-limit-key', 60_000)
      }

      const result = await stub.check('under-limit-key', 10, 60_000)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(5)
    })

    it('should allow requests via checkAndIncrement when under the limit', async () => {
      const result = await stub.checkAndIncrement('cai-key', 10, 60_000)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(9)
    })
  })

  // ==========================================================================
  // 2. Should deny requests over the limit (429 scenario)
  // ==========================================================================

  describe('denies requests over the limit', () => {
    it('should deny requests when the limit is reached', async () => {
      const limit = 5

      // Exhaust the limit
      for (let i = 0; i < limit; i++) {
        const result = await stub.checkAndIncrement('exhaust-key', limit, 60_000)
        expect(result.allowed).toBe(true)
      }

      // The next request should be denied
      const result = await stub.checkAndIncrement('exhaust-key', limit, 60_000)
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('should deny on check() after the limit is reached', async () => {
      const limit = 3

      // Exhaust via increment
      for (let i = 0; i < limit; i++) {
        await stub.increment('check-deny-key', 60_000)
      }

      const result = await stub.check('check-deny-key', limit, 60_000)
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('should not increment count beyond the limit when denied', async () => {
      const limit = 3

      // Exhaust the limit
      for (let i = 0; i < limit; i++) {
        await stub.checkAndIncrement('no-over-inc-key', limit, 60_000)
      }

      // Try several more times - count should stay at the limit
      await stub.checkAndIncrement('no-over-inc-key', limit, 60_000)
      await stub.checkAndIncrement('no-over-inc-key', limit, 60_000)

      const result = await stub.check('no-over-inc-key', limit, 60_000)
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })
  })

  // ==========================================================================
  // 3. Should track remaining count accurately
  // ==========================================================================

  describe('tracks remaining count accurately', () => {
    it('should decrement remaining with each checkAndIncrement call', async () => {
      const limit = 10

      const r1 = await stub.checkAndIncrement('track-key', limit, 60_000)
      expect(r1.remaining).toBe(9)

      const r2 = await stub.checkAndIncrement('track-key', limit, 60_000)
      expect(r2.remaining).toBe(8)

      const r3 = await stub.checkAndIncrement('track-key', limit, 60_000)
      expect(r3.remaining).toBe(7)
    })

    it('should show correct remaining after mixed increment and check calls', async () => {
      const limit = 10

      await stub.increment('mixed-key', 60_000)
      await stub.increment('mixed-key', 60_000)
      await stub.increment('mixed-key', 60_000)

      const result = await stub.check('mixed-key', limit, 60_000)
      expect(result.remaining).toBe(7)
    })

    it('should show zero remaining when exactly at the limit', async () => {
      const limit = 5

      for (let i = 0; i < limit; i++) {
        await stub.increment('exact-limit-key', 60_000)
      }

      const result = await stub.check('exact-limit-key', limit, 60_000)
      expect(result.remaining).toBe(0)
      expect(result.allowed).toBe(false)
    })

    it('should return consistent resetAt within the same window', async () => {
      const r1 = await stub.checkAndIncrement('reset-time-key', 10, 60_000)
      const r2 = await stub.checkAndIncrement('reset-time-key', 10, 60_000)
      const r3 = await stub.checkAndIncrement('reset-time-key', 10, 60_000)

      // All should share the same resetAt since they are in the same window
      expect(r1.resetAt).toBe(r2.resetAt)
      expect(r2.resetAt).toBe(r3.resetAt)
    })
  })

  // ==========================================================================
  // 4. Should reset after the time window expires
  // ==========================================================================

  describe('resets after the time window expires', () => {
    it('should allow requests again after the window expires', async () => {
      const windowMs = 100 // Use a short window for testing
      const limit = 3

      // Exhaust the limit
      for (let i = 0; i < limit; i++) {
        await stub.checkAndIncrement('expire-key', limit, windowMs)
      }

      // Confirm denied
      const denied = await stub.check('expire-key', limit, windowMs)
      expect(denied.allowed).toBe(false)

      // Wait for the window to expire
      await new Promise(resolve => setTimeout(resolve, windowMs + 50))

      // Should be allowed again
      const allowed = await stub.check('expire-key', limit, windowMs)
      expect(allowed.allowed).toBe(true)
    })

    it('should start a new window after expiration on increment', async () => {
      const windowMs = 100
      const limit = 5

      const r1 = await stub.checkAndIncrement('new-window-key', limit, windowMs)
      const firstResetAt = r1.resetAt

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, windowMs + 50))

      const r2 = await stub.checkAndIncrement('new-window-key', limit, windowMs)

      // New window should have a later resetAt
      expect(r2.resetAt).toBeGreaterThan(firstResetAt)
      expect(r2.remaining).toBe(limit - 1)
    })
  })

  // ==========================================================================
  // 5. Should handle multiple keys independently
  // ==========================================================================

  describe('handles multiple keys independently', () => {
    it('should track different keys separately', async () => {
      const limit = 5

      // Exhaust key-a
      for (let i = 0; i < limit; i++) {
        await stub.checkAndIncrement('key-a', limit, 60_000)
      }

      // key-a should be blocked
      const resultA = await stub.check('key-a', limit, 60_000)
      expect(resultA.allowed).toBe(false)

      // key-b should still be available
      const resultB = await stub.check('key-b', limit, 60_000)
      expect(resultB.allowed).toBe(true)
      expect(resultB.remaining).toBe(limit)
    })

    it('should reset one key without affecting others', async () => {
      const limit = 10

      // Add some requests to both keys
      for (let i = 0; i < 5; i++) {
        await stub.increment('reset-a', 60_000)
        await stub.increment('reset-b', 60_000)
      }

      // Reset only key-a
      await stub.reset('reset-a')

      // key-a should be fresh (check returns full remaining)
      const resultA = await stub.check('reset-a', limit, 60_000)
      expect(resultA.allowed).toBe(true)
      expect(resultA.remaining).toBe(limit)

      // key-b should still have reduced remaining
      const resultB = await stub.check('reset-b', limit, 60_000)
      expect(resultB.remaining).toBe(5)
    })

    it('should handle many keys concurrently', async () => {
      const limit = 100
      const keyCount = 20

      // Create rate limits for many keys
      const promises = []
      for (let i = 0; i < keyCount; i++) {
        promises.push(stub.checkAndIncrement(`concurrent-key-${i}`, limit, 60_000))
      }
      const results = await Promise.all(promises)

      // All should be allowed since each key only has 1 request
      for (const result of results) {
        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(limit - 1)
      }
    })
  })

  // ==========================================================================
  // 6. Should persist state across calls (since it's a DO)
  // ==========================================================================

  describe('persists state across calls', () => {
    it('should remember request counts across separate RPC calls', async () => {
      const limit = 10

      // Make requests in separate RPC calls
      await stub.increment('persist-key', 60_000)
      await stub.increment('persist-key', 60_000)
      await stub.increment('persist-key', 60_000)

      // The state should be accumulated
      const result = await stub.check('persist-key', limit, 60_000)
      expect(result.remaining).toBe(7)
    })

    it('should persist state when getting the same stub by name', async () => {
      const limit = 10

      // Use the same DO name to get the same instance
      const id1 = env.RATE_LIMITER.idFromName('shared-instance')
      const stub1 = env.RATE_LIMITER.get(id1)

      await stub1.increment('shared-key', 60_000)
      await stub1.increment('shared-key', 60_000)

      // Get the same DO instance again by the same name
      const id2 = env.RATE_LIMITER.idFromName('shared-instance')
      const stub2 = env.RATE_LIMITER.get(id2)

      const result = await stub2.check('shared-key', limit, 60_000)
      expect(result.remaining).toBe(8)
    })

    it('should persist through check, increment, check cycle', async () => {
      const limit = 5

      // Check -> should be allowed
      const check1 = await stub.check('cycle-key', limit, 60_000)
      expect(check1.allowed).toBe(true)

      // Increment
      await stub.increment('cycle-key', 60_000)

      // Check again -> should reflect the increment
      const check2 = await stub.check('cycle-key', limit, 60_000)
      expect(check2.remaining).toBe(4)

      // Increment more
      await stub.increment('cycle-key', 60_000)
      await stub.increment('cycle-key', 60_000)
      await stub.increment('cycle-key', 60_000)
      await stub.increment('cycle-key', 60_000)

      // Check -> should be at the limit
      const check3 = await stub.check('cycle-key', limit, 60_000)
      expect(check3.allowed).toBe(false)
      expect(check3.remaining).toBe(0)
    })
  })

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  describe('cleanup', () => {
    it('should clean up expired windows', async () => {
      const windowMs = 100

      // Create a rate limit entry
      await stub.increment('cleanup-key', windowMs)

      // Wait for it to expire
      await new Promise(resolve => setTimeout(resolve, windowMs + 50))

      // Cleanup should remove it
      const deleted = await stub.cleanup()
      expect(deleted).toBeGreaterThanOrEqual(1)
    })

    it('should not remove active windows during cleanup', async () => {
      // Create a rate limit entry with a long window
      await stub.increment('active-cleanup-key', 60_000)

      const deleted = await stub.cleanup()
      expect(deleted).toBe(0)

      // The key should still be tracked
      const result = await stub.check('active-cleanup-key', 10, 60_000)
      expect(result.remaining).toBe(9)
    })
  })

  // ==========================================================================
  // Reset
  // ==========================================================================

  describe('reset', () => {
    it('should fully reset a key so it can be used again', async () => {
      const limit = 3

      // Exhaust the limit
      for (let i = 0; i < limit; i++) {
        await stub.checkAndIncrement('full-reset-key', limit, 60_000)
      }

      // Confirm blocked
      const blocked = await stub.check('full-reset-key', limit, 60_000)
      expect(blocked.allowed).toBe(false)

      // Reset
      await stub.reset('full-reset-key')

      // Should be allowed again
      const allowed = await stub.check('full-reset-key', limit, 60_000)
      expect(allowed.allowed).toBe(true)
      expect(allowed.remaining).toBe(limit)
    })

    it('should be safe to reset a key that does not exist', async () => {
      // This should not throw
      await stub.reset('nonexistent-key')

      // And checking it should work fine
      const result = await stub.check('nonexistent-key', 10, 60_000)
      expect(result.allowed).toBe(true)
    })
  })
})
