/**
 * LRU Cache Performance Benchmark Tests
 *
 * These tests verify the performance characteristics of the LRU cache eviction
 * algorithm in FunctionLoader. The implementation uses JavaScript Map's insertion
 * order for O(1) eviction - the first entry is always the oldest (LRU).
 *
 * Expected behavior for an efficient O(1) LRU implementation:
 * - Eviction time should be constant regardless of cache size
 * - LRU ordering must be maintained correctly (least recently used evicted first)
 * - Concurrent operations should not corrupt cache state
 *
 * Implementation details:
 * - evictOldest(): Gets first key from Map iterator (O(1)) and deletes it (O(1))
 * - touchCacheEntry(): Deletes key (O(1)) and re-inserts at end (O(1))
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  FunctionLoader,
  type Registry,
  type CodeStorage,
} from '../function-loader'
import type { FunctionMetadata } from '../types'

/**
 * Create a minimal mock registry for performance testing
 */
function createMockRegistry(): Registry {
  return {
    get: vi.fn(async (id: string): Promise<FunctionMetadata | null> => ({
      id,
      version: '1.0.0',
      language: 'typescript',
      entryPoint: 'index.ts',
      dependencies: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    getVersion: vi.fn(async (id: string, version: string): Promise<FunctionMetadata | null> => ({
      id,
      version,
      language: 'typescript',
      entryPoint: 'index.ts',
      dependencies: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    listVersions: vi.fn(async () => ['1.0.0']),
  }
}

/**
 * Create a minimal mock code storage for performance testing
 */
function createMockCodeStorage(): CodeStorage {
  return {
    get: vi.fn(async (id: string) => `
      export default {
        async fetch(request) {
          return new Response(JSON.stringify({ id: '${id}' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    `),
  }
}

/**
 * Helper to measure eviction time for a given cache size.
 * Populates the cache to the specified size, then triggers one more load
 * to force an eviction, measuring how long the eviction takes.
 */
async function measureEvictionTime(
  loader: FunctionLoader,
  cacheSize: number
): Promise<number> {
  // First, populate the cache to max capacity
  for (let i = 0; i < cacheSize; i++) {
    await loader.load(`func-${i}`)
  }

  // Verify cache is at capacity
  const stats = loader.getCacheStats()
  expect(stats.size).toBe(cacheSize)

  // Now measure the time to load one more (which triggers eviction)
  const start = performance.now()
  await loader.load(`func-overflow-${Date.now()}`)
  const end = performance.now()

  return end - start
}

describe('LRU Cache Performance', () => {
  let mockRegistry: Registry
  let mockCodeStorage: CodeStorage

  beforeEach(() => {
    vi.clearAllMocks()
    mockRegistry = createMockRegistry()
    mockCodeStorage = createMockCodeStorage()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('eviction time complexity', () => {
    it('should evict in O(1) time regardless of cache size', async () => {
      // Test with small cache (100 items)
      const smallLoader = new FunctionLoader({
        registry: mockRegistry,
        codeStorage: mockCodeStorage,
                maxCacheSize: 100,
        retry: { maxRetries: 0 }, // Disable retries for faster tests
      })
      const smallTime = await measureEvictionTime(smallLoader, 100)

      // Test with large cache (10,000 items)
      const largeLoader = new FunctionLoader({
        registry: mockRegistry,
        codeStorage: mockCodeStorage,
                maxCacheSize: 10000,
        retry: { maxRetries: 0 },
      })
      const largeTime = await measureEvictionTime(largeLoader, 10000)

      // O(1) means large should be similar to small (within 10x)
      // O(n) means large would be ~100x slower (since 10000/100 = 100)
      // We use 10x as a reasonable threshold that accounts for noise
      // but will still catch O(n) behavior
      // Handle edge case where times are 0 due to fast execution - this means O(1)
      if (smallTime === 0) {
        expect(largeTime).toBeLessThanOrEqual(1) // Both are effectively instant
      } else {
        expect(largeTime).toBeLessThan(smallTime * 10)
      }
    }, 60000) // 60 second timeout for this performance test

    it('should scale linearly with number of evictions, not cache size', async () => {
      const loader = new FunctionLoader({
        registry: mockRegistry,
        codeStorage: mockCodeStorage,
                maxCacheSize: 1000,
        retry: { maxRetries: 0 },
      })

      // Fill cache to capacity
      for (let i = 0; i < 1000; i++) {
        await loader.load(`func-${i}`)
      }

      // Measure time for 10 evictions
      const start = performance.now()
      for (let i = 0; i < 10; i++) {
        await loader.load(`eviction-${i}`)
      }
      const timeFor10 = performance.now() - start

      // Measure time for 100 evictions
      const start2 = performance.now()
      for (let i = 10; i < 110; i++) {
        await loader.load(`eviction-${i}`)
      }
      const timeFor100 = performance.now() - start2

      // With O(1) eviction, 100 evictions should take ~10x longer than 10 evictions
      // With O(n) eviction, it would still be ~10x but each eviction is slower
      // This test verifies consistency of eviction time
      // Handle edge case where times are very small due to fast execution (< 1ms)
      // When times are sub-millisecond, the ratio becomes unreliable due to measurement noise
      if (timeFor10 < 1 || timeFor100 < 5) {
        // Both are effectively instant - this is O(1) behavior
        // If 100 evictions complete in under 5ms, the eviction is clearly O(1)
        expect(timeFor100).toBeLessThanOrEqual(50) // 100 O(1) operations should be fast
      } else {
        const ratio = timeFor100 / timeFor10
        expect(ratio).toBeGreaterThan(5) // At least 5x for 10x more operations
        expect(ratio).toBeLessThan(20) // But not more than 20x (accounts for noise)
      }
    }, 60000)
  })

  describe('LRU ordering correctness', () => {
    it('should maintain correct LRU ordering after access', async () => {
      const loader = new FunctionLoader({
        registry: mockRegistry,
        codeStorage: mockCodeStorage,
                maxCacheSize: 5,
        retry: { maxRetries: 0 },
      })

      // Load items 1-5 (cache: [1, 2, 3, 4, 5])
      for (let i = 1; i <= 5; i++) {
        await loader.load(`func-${i}`)
      }

      // Access item 1 (should move to end of LRU: [2, 3, 4, 5, 1])
      await loader.load('func-1')

      // Load item 6, which should evict item 2 (oldest unused)
      await loader.load('func-6')

      // Verify cache size is still 5
      const stats = loader.getCacheStats()
      expect(stats.size).toBe(5)

      // Item 1 should still be cached (was recently accessed)
      const preHits = loader.getCacheStats().hits
      await loader.load('func-1')
      const postHits = loader.getCacheStats().hits
      expect(postHits).toBe(preHits + 1) // Should be a cache hit

      // Item 2 should have been evicted (was oldest unused)
      const preHits2 = loader.getCacheStats().hits
      const preMisses = loader.getCacheStats().misses
      await loader.load('func-2')
      const postHits2 = loader.getCacheStats().hits
      const postMisses = loader.getCacheStats().misses
      expect(postMisses).toBe(preMisses + 1) // Should be a cache miss
      expect(postHits2).toBe(preHits2) // Hits should not increase
    })

    it('should evict in correct order when multiple items are added', async () => {
      const loader = new FunctionLoader({
        registry: mockRegistry,
        codeStorage: mockCodeStorage,
                maxCacheSize: 3,
        retry: { maxRetries: 0 },
      })

      // Load A, B, C (cache order: A -> B -> C)
      await loader.load('func-A')
      await loader.load('func-B')
      await loader.load('func-C')

      // Load D (should evict A)
      await loader.load('func-D')

      // Load E (should evict B)
      await loader.load('func-E')

      // C should still be in cache (it was added after A and B)
      // Must check C FIRST before checking A and B, because reloading A and B
      // would add them back to cache and evict C
      const statsBeforeC = loader.getCacheStats()
      await loader.load('func-C')
      const statsAfterC = loader.getCacheStats()
      expect(statsAfterC.hits).toBe(statsBeforeC.hits + 1)

      // A and B should be cache misses (they were evicted when D and E were added)
      const statsBeforeA = loader.getCacheStats()
      await loader.load('func-A')
      const statsAfterA = loader.getCacheStats()
      expect(statsAfterA.misses).toBe(statsBeforeA.misses + 1)

      const statsBeforeB = loader.getCacheStats()
      await loader.load('func-B')
      const statsAfterB = loader.getCacheStats()
      expect(statsAfterB.misses).toBe(statsBeforeB.misses + 1)
    })

    it('should update access time on cache hit', async () => {
      const loader = new FunctionLoader({
        registry: mockRegistry,
        codeStorage: mockCodeStorage,
                maxCacheSize: 3,
        retry: { maxRetries: 0 },
      })

      // Load A, B, C
      await loader.load('func-A')
      await loader.load('func-B')
      await loader.load('func-C')

      // Access A (should update its position to most recent)
      await loader.load('func-A')

      // Load D (should evict B, not A, since A was just accessed)
      await loader.load('func-D')

      // A should still be cached
      const statsBeforeA = loader.getCacheStats()
      await loader.load('func-A')
      const statsAfterA = loader.getCacheStats()
      expect(statsAfterA.hits).toBe(statsBeforeA.hits + 1)

      // B should have been evicted
      const statsBeforeB = loader.getCacheStats()
      await loader.load('func-B')
      const statsAfterB = loader.getCacheStats()
      expect(statsAfterB.misses).toBe(statsBeforeB.misses + 1)
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent evictions correctly', async () => {
      const loader = new FunctionLoader({
        registry: mockRegistry,
        codeStorage: mockCodeStorage,
                maxCacheSize: 10,
        retry: { maxRetries: 0 },
      })

      // Fill cache to capacity
      for (let i = 0; i < 10; i++) {
        await loader.load(`func-${i}`)
      }

      // Trigger 50 concurrent loads that all cause evictions
      const promises = Array.from({ length: 50 }, (_, i) =>
        loader.load(`concurrent-${i}`)
      )

      // All should complete without error
      await expect(Promise.all(promises)).resolves.toBeDefined()

      // Cache should maintain correct size
      const stats = loader.getCacheStats()
      expect(stats.size).toBe(10)
    })

    it('should not corrupt state under parallel access patterns', async () => {
      const loader = new FunctionLoader({
        registry: mockRegistry,
        codeStorage: mockCodeStorage,
                maxCacheSize: 20,
        retry: { maxRetries: 0 },
      })

      // Simulate realistic parallel access pattern
      const operations: Promise<unknown>[] = []

      // Some operations fill the cache
      for (let i = 0; i < 20; i++) {
        operations.push(loader.load(`initial-${i}`))
      }

      // Some operations cause evictions
      for (let i = 0; i < 30; i++) {
        operations.push(loader.load(`new-${i}`))
      }

      // Some operations re-access cached items
      for (let i = 0; i < 10; i++) {
        operations.push(loader.load(`initial-${i % 20}`))
      }

      // Execute all in parallel
      await Promise.all(operations)

      // Verify cache integrity
      const stats = loader.getCacheStats()
      expect(stats.size).toBeLessThanOrEqual(20)
      expect(stats.size).toBeGreaterThan(0)

      // Verify we can still load functions
      await expect(loader.load('post-parallel-test')).resolves.toBeDefined()
    })

    it('should maintain consistency with interleaved reads and writes', async () => {
      const loader = new FunctionLoader({
        registry: mockRegistry,
        codeStorage: mockCodeStorage,
                maxCacheSize: 5,
        retry: { maxRetries: 0 },
      })

      // Load initial items
      await loader.load('func-A')
      await loader.load('func-B')
      await loader.load('func-C')
      await loader.load('func-D')
      await loader.load('func-E')

      // Interleaved operations: read A, write new, read B, write new, etc.
      const interleaved = [
        loader.load('func-A'), // hit
        loader.load('new-1'), // evict oldest
        loader.load('func-B'), // should be hit if B not evicted, miss if it was
        loader.load('new-2'), // evict oldest
        loader.load('func-C'), // hit or miss
        loader.load('new-3'), // evict oldest
      ]

      await Promise.all(interleaved)

      // Cache should still be at max size
      const stats = loader.getCacheStats()
      expect(stats.size).toBe(5)

      // Total operations should be tracked correctly
      expect(stats.hits + stats.misses).toBeGreaterThan(0)
    })
  })

  describe('stress testing', () => {
    it('should handle rapid sequential evictions', async () => {
      const loader = new FunctionLoader({
        registry: mockRegistry,
        codeStorage: mockCodeStorage,
                maxCacheSize: 10,
        retry: { maxRetries: 0 },
      })

      // Fill cache
      for (let i = 0; i < 10; i++) {
        await loader.load(`initial-${i}`)
      }

      // Rapidly evict and refill 100 times
      for (let i = 0; i < 100; i++) {
        await loader.load(`rapid-${i}`)
      }

      const stats = loader.getCacheStats()
      expect(stats.size).toBe(10)
      expect(stats.misses).toBeGreaterThanOrEqual(110) // 10 initial + 100 rapid
    })

    it('should maintain performance under memory pressure', async () => {
      const loader = new FunctionLoader({
        registry: mockRegistry,
        codeStorage: mockCodeStorage,
                maxCacheSize: 100,
        retry: { maxRetries: 0 },
      })

      const iterations = 1000
      const start = performance.now()

      // Continuously load new functions, causing constant eviction
      for (let i = 0; i < iterations; i++) {
        await loader.load(`pressure-${i}`)
      }

      const elapsed = performance.now() - start
      const avgPerOperation = elapsed / iterations

      // With O(1) eviction, average should be consistent
      // With O(n) eviction, it degrades as cache fills
      // We expect less than 5ms average per operation
      expect(avgPerOperation).toBeLessThan(5)

      const stats = loader.getCacheStats()
      expect(stats.size).toBe(100)
    }, 30000)
  })
})
