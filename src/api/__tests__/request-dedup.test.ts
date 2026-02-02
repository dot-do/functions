/**
 * Request Deduplication Tests
 *
 * Tests for the request deduplication / coalescing layer including:
 * - Content-hash key computation
 * - Dedup hit (identical concurrent requests coalesced)
 * - Dedup miss (different requests execute independently)
 * - TTL-based stale entry eviction
 * - Cleanup after execution settles
 * - Error propagation to all waiters
 * - Disabled mode bypass
 * - X-Deduplicated header on coalesced responses
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  computeDedupKey,
  RequestDedupMap,
  getDefaultDedupMap,
  resetDefaultDedupMap,
  DEDUP_DEFAULTS,
} from '../request-dedup'

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Create a simple JSON Response for testing.
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * A deferred promise helper so we can control when an execution completes.
 */
function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// =============================================================================
// TESTS: computeDedupKey
// =============================================================================

describe('computeDedupKey', () => {
  it('produces a hex string', async () => {
    const key = await computeDedupKey('my-func', { x: 1 })
    expect(key).toMatch(/^[a-f0-9]{64}$/) // SHA-256 = 64 hex chars
  })

  it('returns the same key for the same inputs', async () => {
    const a = await computeDedupKey('func-a', { name: 'alice' })
    const b = await computeDedupKey('func-a', { name: 'alice' })
    expect(a).toBe(b)
  })

  it('returns different keys for different function IDs', async () => {
    const a = await computeDedupKey('func-a', { x: 1 })
    const b = await computeDedupKey('func-b', { x: 1 })
    expect(a).not.toBe(b)
  })

  it('returns different keys for different inputs', async () => {
    const a = await computeDedupKey('func-a', { x: 1 })
    const b = await computeDedupKey('func-a', { x: 2 })
    expect(a).not.toBe(b)
  })

  it('handles null/undefined input', async () => {
    const a = await computeDedupKey('func-a', null)
    const b = await computeDedupKey('func-a', undefined)
    // Both should normalize to {} via the ?? fallback
    expect(a).toBe(b)
  })

  it('handles empty object input', async () => {
    const a = await computeDedupKey('func-a', {})
    // Should produce a valid key without throwing
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })
})

// =============================================================================
// TESTS: RequestDedupMap
// =============================================================================

describe('RequestDedupMap', () => {
  let dedupMap: RequestDedupMap

  beforeEach(() => {
    dedupMap = new RequestDedupMap({ ttlMs: 5000 })
  })

  afterEach(() => {
    dedupMap.clear()
  })

  // ---------------------------------------------------------------------------
  // Basic operation
  // ---------------------------------------------------------------------------

  it('executes the factory and returns the response', async () => {
    let callCount = 0
    const response = await dedupMap.dedupOrExecute('key-1', async () => {
      callCount++
      return jsonResponse({ result: 'hello' })
    })

    expect(callCount).toBe(1)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ result: 'hello' })
  })

  it('cleans up the map entry after execution completes', async () => {
    expect(dedupMap.size).toBe(0)

    await dedupMap.dedupOrExecute('key-1', async () => jsonResponse({ ok: true }))

    // Entry should be cleaned up after promise settles
    expect(dedupMap.size).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // Dedup hit: identical concurrent requests
  // ---------------------------------------------------------------------------

  it('coalesces identical concurrent requests', async () => {
    let callCount = 0
    const deferred = createDeferred<Response>()

    // Launch two concurrent requests with the same key
    const p1 = dedupMap.dedupOrExecute('same-key', async () => {
      callCount++
      return deferred.promise
    })
    const p2 = dedupMap.dedupOrExecute('same-key', async () => {
      callCount++
      return jsonResponse({ should: 'not-reach' })
    })

    // Only the first factory should have been called
    expect(callCount).toBe(1)

    // Now resolve the shared execution
    deferred.resolve(jsonResponse({ shared: true }))

    const [r1, r2] = await Promise.all([p1, p2])

    const b1 = await r1.json()
    const b2 = await r2.json()

    expect(b1).toEqual({ shared: true })
    expect(b2).toEqual({ shared: true })
  })

  it('marks coalesced responses with X-Deduplicated header', async () => {
    const deferred = createDeferred<Response>()

    const p1 = dedupMap.dedupOrExecute('hdr-key', async () => deferred.promise)
    const p2 = dedupMap.dedupOrExecute('hdr-key', async () => jsonResponse({}))

    deferred.resolve(jsonResponse({ v: 1 }))

    const [r1, r2] = await Promise.all([p1, p2])

    // First caller is NOT deduplicated
    expect(r1.headers.get('X-Deduplicated')).toBeNull()
    // Second caller IS deduplicated
    expect(r2.headers.get('X-Deduplicated')).toBe('true')
  })

  // ---------------------------------------------------------------------------
  // Dedup miss: different keys execute independently
  // ---------------------------------------------------------------------------

  it('executes independently for different keys', async () => {
    let callCount = 0

    const p1 = dedupMap.dedupOrExecute('key-a', async () => {
      callCount++
      return jsonResponse({ key: 'a' })
    })
    const p2 = dedupMap.dedupOrExecute('key-b', async () => {
      callCount++
      return jsonResponse({ key: 'b' })
    })

    const [r1, r2] = await Promise.all([p1, p2])

    expect(callCount).toBe(2)

    const b1 = await r1.json()
    const b2 = await r2.json()

    expect(b1).toEqual({ key: 'a' })
    expect(b2).toEqual({ key: 'b' })
  })

  // ---------------------------------------------------------------------------
  // Error propagation
  // ---------------------------------------------------------------------------

  it('propagates errors to all waiters', async () => {
    const deferred = createDeferred<Response>()

    const p1 = dedupMap.dedupOrExecute('err-key', async () => deferred.promise)
    const p2 = dedupMap.dedupOrExecute('err-key', async () => jsonResponse({}))

    deferred.reject(new Error('execution failed'))

    await expect(p1).rejects.toThrow('execution failed')
    await expect(p2).rejects.toThrow('execution failed')

    // Map should be cleaned up even after error
    expect(dedupMap.size).toBe(0)
  })

  it('cleans up the map entry after factory throws', async () => {
    await expect(
      dedupMap.dedupOrExecute('throw-key', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    expect(dedupMap.size).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // TTL eviction
  // ---------------------------------------------------------------------------

  it('evicts stale entries based on TTL', async () => {
    vi.useFakeTimers()

    try {
      const shortTtlMap = new RequestDedupMap({ ttlMs: 100 })
      const deferred = createDeferred<Response>()

      // Start an execution that will hang
      const p1 = shortTtlMap.dedupOrExecute('stale-key', async () => deferred.promise)

      // Advance time past the TTL
      vi.advanceTimersByTime(200)

      // Now a new request with the same key should start a fresh execution
      // because the stale entry should be evicted
      let secondCallExecuted = false
      const p2 = shortTtlMap.dedupOrExecute('stale-key', async () => {
        secondCallExecuted = true
        return jsonResponse({ fresh: true })
      })

      expect(secondCallExecuted).toBe(true)

      // Resolve the original deferred to avoid hanging
      deferred.resolve(jsonResponse({ old: true }))

      const r2 = await p2
      const b2 = await r2.json()
      expect(b2).toEqual({ fresh: true })

      // Clean up first promise
      await p1
    } finally {
      vi.useRealTimers()
    }
  })

  // ---------------------------------------------------------------------------
  // Disabled mode
  // ---------------------------------------------------------------------------

  it('bypasses dedup when disabled', async () => {
    const disabledMap = new RequestDedupMap({ enabled: false })
    let callCount = 0

    const deferred = createDeferred<Response>()

    const p1 = disabledMap.dedupOrExecute('key', async () => {
      callCount++
      return deferred.promise
    })
    const p2 = disabledMap.dedupOrExecute('key', async () => {
      callCount++
      return jsonResponse({ second: true })
    })

    // With dedup disabled, both factories should execute
    expect(callCount).toBe(2)

    deferred.resolve(jsonResponse({ first: true }))
    const [r1, r2] = await Promise.all([p1, p2])

    const b1 = await r1.json()
    const b2 = await r2.json()

    expect(b1).toEqual({ first: true })
    expect(b2).toEqual({ second: true })
  })

  // ---------------------------------------------------------------------------
  // Response independence
  // ---------------------------------------------------------------------------

  it('returns independent Response objects for each caller', async () => {
    const deferred = createDeferred<Response>()

    const p1 = dedupMap.dedupOrExecute('ind-key', async () => deferred.promise)
    const p2 = dedupMap.dedupOrExecute('ind-key', async () => jsonResponse({}))

    deferred.resolve(jsonResponse({ value: 42 }, 201))

    const [r1, r2] = await Promise.all([p1, p2])

    // Both should have the same status and body
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)

    // But reading one body should not affect the other
    const b1 = await r1.json()
    const b2 = await r2.json()

    expect(b1).toEqual({ value: 42 })
    expect(b2).toEqual({ value: 42 })
  })

  // ---------------------------------------------------------------------------
  // Preserves response headers
  // ---------------------------------------------------------------------------

  it('preserves original response headers', async () => {
    const resp = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Custom-Header': 'test-value',
        'X-Execution-Time': '42',
      },
    })

    const result = await dedupMap.dedupOrExecute('hdr-test', async () => resp)

    expect(result.headers.get('Content-Type')).toBe('application/json')
    expect(result.headers.get('X-Custom-Header')).toBe('test-value')
    expect(result.headers.get('X-Execution-Time')).toBe('42')
  })

  // ---------------------------------------------------------------------------
  // Sequential requests (no coalescing after completion)
  // ---------------------------------------------------------------------------

  it('does not coalesce sequential (non-overlapping) requests', async () => {
    let callCount = 0

    await dedupMap.dedupOrExecute('seq-key', async () => {
      callCount++
      return jsonResponse({ call: 1 })
    })

    await dedupMap.dedupOrExecute('seq-key', async () => {
      callCount++
      return jsonResponse({ call: 2 })
    })

    // Both should have executed because the first completed before the second started
    expect(callCount).toBe(2)
  })
})

// =============================================================================
// TESTS: Singleton management
// =============================================================================

describe('getDefaultDedupMap / resetDefaultDedupMap', () => {
  afterEach(() => {
    resetDefaultDedupMap()
  })

  it('returns the same instance on subsequent calls', () => {
    const a = getDefaultDedupMap()
    const b = getDefaultDedupMap()
    expect(a).toBe(b)
  })

  it('returns a fresh instance after reset', () => {
    const a = getDefaultDedupMap()
    resetDefaultDedupMap()
    const b = getDefaultDedupMap()
    expect(a).not.toBe(b)
  })

  it('accepts config on first call', () => {
    const map = getDefaultDedupMap({ enabled: false, ttlMs: 1000 })
    // Should work without throwing
    expect(map).toBeDefined()
    expect(map.size).toBe(0)
  })
})

// =============================================================================
// TESTS: DEDUP_DEFAULTS
// =============================================================================

describe('DEDUP_DEFAULTS', () => {
  it('has expected default values', () => {
    expect(DEDUP_DEFAULTS.ENABLED).toBe(true)
    expect(DEDUP_DEFAULTS.TTL_MS).toBe(30_000)
  })
})
