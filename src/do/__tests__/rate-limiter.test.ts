/**
 * RateLimiterDO Durable Object Tests (Legacy - Redirected)
 *
 * The RateLimiterDO has been rewritten to extend DurableObject (cloudflare:workers)
 * with Workers RPC instead of HTTP fetch(). The old mock-based tests are no longer
 * compatible because DurableObject subclasses require real DurableObjectState.
 *
 * All RateLimiterDO tests now live in rate-limiter-do.test.ts which uses real
 * miniflare bindings from cloudflare:test.
 *
 * @see ./rate-limiter-do.test.ts for the current test suite
 * @module durable-object/rate-limiter.test
 */

import { describe, it, expect } from 'vitest'

describe('RateLimiterDO (legacy test redirect)', () => {
  it('tests have been migrated to rate-limiter-do.test.ts', () => {
    // All RateLimiterDO tests are now in rate-limiter-do.test.ts
    // which uses real miniflare DO bindings via cloudflare:test.
    expect(true).toBe(true)
  })
})
