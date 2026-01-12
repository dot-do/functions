/**
 * Assembly Cache and Hot-Swap Tests (RED)
 *
 * These tests validate the assembly caching and hot-swap functionality
 * for the C# distributed runtime. Key features tested:
 * 1. LRU caching for compiled assemblies
 * 2. Hot-swap using collectible AssemblyLoadContext
 * 3. Cache statistics and eviction
 * 4. Persistent storage integration
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the implementation does not exist yet.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createAssemblyCache,
  createAssemblyLoadContextManager,
  createLRUPolicy,
  createDelegateCache,
  createPersistentCacheStorage,
  computeAssemblyHash,
  createAssemblyId,
  parseAssemblyId,
  compareVersions,
  type AssemblyCache,
  type AssemblyCacheConfig,
  type CachedAssembly,
  type AssemblyLoadContextManager,
  type LRUPolicy,
  type DelegateCache,
} from '../assembly-cache'

describe('Assembly Cache', () => {
  let cache: AssemblyCache

  beforeEach(() => {
    cache = createAssemblyCache({
      maxEntries: 100,
      maxSizeBytes: 100 * 1024 * 1024, // 100 MB
      ttlMs: 3600000, // 1 hour
    })
  })

  afterEach(() => {
    cache.dispose()
  })

  describe('createAssemblyCache', () => {
    it('creates cache with default options', () => {
      const c = createAssemblyCache()
      expect(c).toBeDefined()
      expect(c.get).toBeDefined()
      expect(c.put).toBeDefined()
      c.dispose()
    })

    it('creates cache with custom options', () => {
      const config: AssemblyCacheConfig = {
        maxEntries: 50,
        maxSizeBytes: 50 * 1024 * 1024,
        ttlMs: 1800000,
        persistent: true,
        hotSwapEnabled: true,
      }
      const c = createAssemblyCache(config)
      expect(c).toBeDefined()
      c.dispose()
    })
  })

  describe('get/put', () => {
    it('stores and retrieves assembly by hash', async () => {
      const assemblyData = new Uint8Array([1, 2, 3, 4, 5])
      const hash = await computeAssemblyHash(assemblyData)

      cache.put({
        hash,
        name: 'TestAssembly',
        version: '1.0.0',
        data: assemblyData,
        size: assemblyData.length,
        contextId: 'ctx-1',
        delegatePtrs: new Map(),
      })

      const retrieved = cache.get(hash)
      expect(retrieved).toBeDefined()
      expect(retrieved?.name).toBe('TestAssembly')
      expect(retrieved?.version).toBe('1.0.0')
      expect(retrieved?.data).toEqual(assemblyData)
    })

    it('retrieves assembly by name', async () => {
      const assemblyData = new Uint8Array([1, 2, 3])
      const hash = await computeAssemblyHash(assemblyData)

      cache.put({
        hash,
        name: 'MyLib',
        version: '2.0.0',
        data: assemblyData,
        size: assemblyData.length,
        contextId: 'ctx-1',
        delegatePtrs: new Map(),
      })

      const retrieved = cache.getByName('MyLib')
      expect(retrieved).toBeDefined()
      expect(retrieved?.hash).toBe(hash)
    })

    it('retrieves assembly by name and version', async () => {
      const v1Data = new Uint8Array([1])
      const v2Data = new Uint8Array([2])
      const hash1 = await computeAssemblyHash(v1Data)
      const hash2 = await computeAssemblyHash(v2Data)

      cache.put({
        hash: hash1,
        name: 'VersionedLib',
        version: '1.0.0',
        data: v1Data,
        size: v1Data.length,
        contextId: 'ctx-1',
        delegatePtrs: new Map(),
      })

      cache.put({
        hash: hash2,
        name: 'VersionedLib',
        version: '2.0.0',
        data: v2Data,
        size: v2Data.length,
        contextId: 'ctx-2',
        delegatePtrs: new Map(),
      })

      const v1 = cache.getByName('VersionedLib', '1.0.0')
      const v2 = cache.getByName('VersionedLib', '2.0.0')

      expect(v1?.version).toBe('1.0.0')
      expect(v2?.version).toBe('2.0.0')
    })

    it('returns undefined for non-existent hash', () => {
      expect(cache.get('nonexistent')).toBeUndefined()
    })

    it('updates lastAccessedAt on get', async () => {
      const data = new Uint8Array([1])
      const hash = await computeAssemblyHash(data)

      cache.put({
        hash,
        name: 'AccessTest',
        version: '1.0.0',
        data,
        size: data.length,
        contextId: 'ctx-1',
        delegatePtrs: new Map(),
      })

      const first = cache.get(hash)
      const firstAccess = first?.lastAccessedAt

      // Small delay
      await new Promise((r) => setTimeout(r, 10))

      const second = cache.get(hash)
      expect(second?.lastAccessedAt.getTime()).toBeGreaterThan(firstAccess!.getTime())
    })

    it('increments accessCount on get', async () => {
      const data = new Uint8Array([1])
      const hash = await computeAssemblyHash(data)

      cache.put({
        hash,
        name: 'CountTest',
        version: '1.0.0',
        data,
        size: data.length,
        contextId: 'ctx-1',
        delegatePtrs: new Map(),
      })

      cache.get(hash)
      cache.get(hash)
      cache.get(hash)

      const entry = cache.get(hash)
      expect(entry?.accessCount).toBe(4) // 3 gets + 1 for this get
    })
  })

  describe('has/remove', () => {
    it('checks if assembly exists', async () => {
      const data = new Uint8Array([1])
      const hash = await computeAssemblyHash(data)

      expect(cache.has(hash)).toBe(false)

      cache.put({
        hash,
        name: 'HasTest',
        version: '1.0.0',
        data,
        size: data.length,
        contextId: 'ctx-1',
        delegatePtrs: new Map(),
      })

      expect(cache.has(hash)).toBe(true)
    })

    it('removes assembly from cache', async () => {
      const data = new Uint8Array([1])
      const hash = await computeAssemblyHash(data)

      cache.put({
        hash,
        name: 'RemoveTest',
        version: '1.0.0',
        data,
        size: data.length,
        contextId: 'ctx-1',
        delegatePtrs: new Map(),
      })

      expect(cache.remove(hash)).toBe(true)
      expect(cache.has(hash)).toBe(false)
    })

    it('returns false when removing non-existent', () => {
      expect(cache.remove('nonexistent')).toBe(false)
    })
  })

  describe('clear', () => {
    it('removes all entries', async () => {
      for (let i = 0; i < 5; i++) {
        const data = new Uint8Array([i])
        const hash = await computeAssemblyHash(data)
        cache.put({
          hash,
          name: `Assembly${i}`,
          version: '1.0.0',
          data,
          size: data.length,
          contextId: `ctx-${i}`,
          delegatePtrs: new Map(),
        })
      }

      expect(cache.stats().entries).toBe(5)
      cache.clear()
      expect(cache.stats().entries).toBe(0)
    })
  })

  describe('stats', () => {
    it('returns cache statistics', () => {
      const stats = cache.stats()

      expect(stats.entries).toBe(0)
      expect(stats.totalSize).toBe(0)
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
      expect(stats.hitRate).toBe(0)
      expect(stats.evictions).toBe(0)
      expect(stats.hotSwaps).toBe(0)
    })

    it('tracks hits and misses', async () => {
      const data = new Uint8Array([1])
      const hash = await computeAssemblyHash(data)

      cache.put({
        hash,
        name: 'StatsTest',
        version: '1.0.0',
        data,
        size: data.length,
        contextId: 'ctx-1',
        delegatePtrs: new Map(),
      })

      cache.get(hash) // hit
      cache.get(hash) // hit
      cache.get('miss1') // miss
      cache.get('miss2') // miss
      cache.get('miss3') // miss

      const stats = cache.stats()
      expect(stats.hits).toBe(2)
      expect(stats.misses).toBe(3)
      expect(stats.hitRate).toBeCloseTo(0.4)
    })
  })

  describe('hotSwap', () => {
    it('swaps assembly version', async () => {
      const v1Data = new Uint8Array([1, 1, 1])
      const v1Hash = await computeAssemblyHash(v1Data)

      cache.put({
        hash: v1Hash,
        name: 'HotSwapLib',
        version: '1.0.0',
        data: v1Data,
        size: v1Data.length,
        contextId: 'ctx-1',
        delegatePtrs: new Map([['Method1', 100]]),
      })

      const v2Data = new Uint8Array([2, 2, 2])
      const result = await cache.hotSwap('HotSwapLib', v2Data, '2.0.0')

      expect(result.success).toBe(true)
      expect(result.previousVersion).toBe('1.0.0')
      expect(result.newVersion).toBe('2.0.0')
      expect(result.delegatesInvalidated).toBe(1)
    })

    it('creates new entry if no previous version', async () => {
      const data = new Uint8Array([1])
      const result = await cache.hotSwap('NewLib', data, '1.0.0')

      expect(result.success).toBe(true)
      expect(result.previousVersion).toBeUndefined()
      expect(result.newVersion).toBe('1.0.0')
    })

    it('returns swap time', async () => {
      const data = new Uint8Array([1])
      const result = await cache.hotSwap('TimedLib', data, '1.0.0')

      expect(result.swapTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('increments hotSwaps stat', async () => {
      const data = new Uint8Array([1])
      await cache.hotSwap('SwapCountLib', data, '1.0.0')
      await cache.hotSwap('SwapCountLib', data, '2.0.0')

      expect(cache.stats().hotSwaps).toBe(2)
    })
  })

  describe('getVersions', () => {
    it('returns all versions of an assembly', async () => {
      for (let i = 1; i <= 3; i++) {
        const data = new Uint8Array([i])
        const hash = await computeAssemblyHash(data)
        cache.put({
          hash,
          name: 'MultiVersion',
          version: `${i}.0.0`,
          data,
          size: data.length,
          contextId: `ctx-${i}`,
          delegatePtrs: new Map(),
        })
      }

      const versions = cache.getVersions('MultiVersion')
      expect(versions).toHaveLength(3)
      expect(versions.map((v) => v.version).sort()).toEqual(['1.0.0', '2.0.0', '3.0.0'])
    })

    it('returns empty array for unknown assembly', () => {
      const versions = cache.getVersions('Unknown')
      expect(versions).toHaveLength(0)
    })
  })

  describe('evictLRU', () => {
    it('evicts least recently used entries', async () => {
      // Add entries
      for (let i = 0; i < 5; i++) {
        const data = new Uint8Array([i])
        const hash = await computeAssemblyHash(data)
        cache.put({
          hash,
          name: `LRU${i}`,
          version: '1.0.0',
          data,
          size: data.length,
          contextId: `ctx-${i}`,
          delegatePtrs: new Map(),
        })
        // Small delay between puts
        await new Promise((r) => setTimeout(r, 5))
      }

      // Access some entries to make them "recent"
      cache.getByName('LRU3')
      cache.getByName('LRU4')

      // Evict 2 entries
      const evicted = cache.evictLRU(2)
      expect(evicted).toBe(2)

      // LRU0 and LRU1 should be evicted (least recently accessed)
      expect(cache.getByName('LRU0')).toBeUndefined()
      expect(cache.getByName('LRU1')).toBeUndefined()
      // Recently accessed should still exist
      expect(cache.getByName('LRU3')).toBeDefined()
      expect(cache.getByName('LRU4')).toBeDefined()
    })
  })

  describe('persist/restore', () => {
    it('persists cache to storage', async () => {
      const data = new Uint8Array([1, 2, 3])
      const hash = await computeAssemblyHash(data)

      cache.put({
        hash,
        name: 'PersistTest',
        version: '1.0.0',
        data,
        size: data.length,
        contextId: 'ctx-1',
        delegatePtrs: new Map(),
      })

      await expect(cache.persist()).resolves.not.toThrow()
    })

    it('restores cache from storage', async () => {
      await expect(cache.restore()).resolves.not.toThrow()
    })
  })
})

describe('AssemblyLoadContext Manager', () => {
  let manager: AssemblyLoadContextManager

  beforeEach(() => {
    manager = createAssemblyLoadContextManager()
  })

  describe('create', () => {
    it('creates a new context', () => {
      const contextId = manager.create('TestContext')
      expect(contextId).toBeDefined()
      expect(typeof contextId).toBe('string')
    })

    it('creates collectible context by default', () => {
      const contextId = manager.create('CollectibleTest')
      expect(manager.isCollectible(contextId)).toBe(true)
    })
  })

  describe('load', () => {
    it('loads assembly into context', async () => {
      const contextId = manager.create('LoadTest')
      const assemblyData = new Uint8Array([77, 90, /* ... PE header */])

      const result = await manager.load(contextId, assemblyData)

      expect(result.success).toBe(true)
      expect(result.loadTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('returns exported types on success', async () => {
      const contextId = manager.create('TypesTest')
      const assemblyData = new Uint8Array([/* valid assembly */])

      const result = await manager.load(contextId, assemblyData)

      if (result.success) {
        expect(result.exportedTypes).toBeDefined()
        expect(Array.isArray(result.exportedTypes)).toBe(true)
      }
    })

    it('handles invalid assembly data', async () => {
      const contextId = manager.create('InvalidTest')
      const invalidData = new Uint8Array([0, 0, 0, 0])

      const result = await manager.load(contextId, invalidData)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('unload', () => {
    it('unloads a context', async () => {
      const contextId = manager.create('UnloadTest')
      const result = await manager.unload(contextId)

      expect(result).toBe(true)
      expect(manager.getContext(contextId)).toBeUndefined()
    })

    it('handles non-existent context', async () => {
      const result = await manager.unload('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('getContext', () => {
    it('returns context info', () => {
      const contextId = manager.create('InfoTest')
      const info = manager.getContext(contextId)

      expect(info).toBeDefined()
      expect(info?.id).toBe(contextId)
      expect(info?.name).toBe('InfoTest')
      expect(info?.isCollectible).toBe(true)
      expect(info?.createdAt).toBeInstanceOf(Date)
    })
  })

  describe('listContexts', () => {
    it('lists all contexts', () => {
      manager.create('Context1')
      manager.create('Context2')
      manager.create('Context3')

      const contexts = manager.listContexts()
      expect(contexts.length).toBeGreaterThanOrEqual(3)
    })
  })
})

describe('LRU Policy', () => {
  let policy: LRUPolicy

  beforeEach(() => {
    policy = createLRUPolicy()
  })

  describe('access', () => {
    it('tracks access order', () => {
      policy.access('a')
      policy.access('b')
      policy.access('c')
      policy.access('a') // Access 'a' again

      const lru = policy.getLRU(2)
      expect(lru).toEqual(['b', 'c']) // 'a' was recently accessed
    })
  })

  describe('getLRU', () => {
    it('returns least recently used keys', () => {
      policy.access('key1')
      policy.access('key2')
      policy.access('key3')

      const lru = policy.getLRU(2)
      expect(lru).toHaveLength(2)
      expect(lru[0]).toBe('key1')
      expect(lru[1]).toBe('key2')
    })

    it('returns all keys if count exceeds size', () => {
      policy.access('only')
      const lru = policy.getLRU(10)
      expect(lru).toEqual(['only'])
    })
  })

  describe('remove', () => {
    it('removes key from tracking', () => {
      policy.access('a')
      policy.access('b')
      policy.remove('a')

      const lru = policy.getLRU(10)
      expect(lru).toEqual(['b'])
    })
  })

  describe('clear', () => {
    it('clears all tracked keys', () => {
      policy.access('a')
      policy.access('b')
      policy.clear()

      const lru = policy.getLRU(10)
      expect(lru).toHaveLength(0)
    })
  })
})

describe('Delegate Cache', () => {
  let delegateCache: DelegateCache

  beforeEach(() => {
    delegateCache = createDelegateCache()
  })

  describe('get/put', () => {
    it('stores and retrieves delegate pointer', () => {
      delegateCache.put('hash1', 'MyClass.MyMethod(int)', 12345)
      const ptr = delegateCache.get('hash1', 'MyClass.MyMethod(int)')
      expect(ptr).toBe(12345)
    })

    it('returns undefined for non-existent', () => {
      expect(delegateCache.get('unknown', 'Method')).toBeUndefined()
    })
  })

  describe('invalidateAssembly', () => {
    it('removes all delegates for an assembly', () => {
      delegateCache.put('hash1', 'Method1', 100)
      delegateCache.put('hash1', 'Method2', 200)
      delegateCache.put('hash1', 'Method3', 300)
      delegateCache.put('hash2', 'Method1', 400)

      const invalidated = delegateCache.invalidateAssembly('hash1')

      expect(invalidated).toBe(3)
      expect(delegateCache.get('hash1', 'Method1')).toBeUndefined()
      expect(delegateCache.get('hash1', 'Method2')).toBeUndefined()
      expect(delegateCache.get('hash2', 'Method1')).toBe(400) // Still exists
    })
  })

  describe('clear', () => {
    it('removes all delegates', () => {
      delegateCache.put('a', 'm1', 1)
      delegateCache.put('b', 'm2', 2)
      delegateCache.clear()
      expect(delegateCache.size()).toBe(0)
    })
  })

  describe('size', () => {
    it('returns number of cached delegates', () => {
      expect(delegateCache.size()).toBe(0)
      delegateCache.put('a', 'm1', 1)
      delegateCache.put('a', 'm2', 2)
      expect(delegateCache.size()).toBe(2)
    })
  })
})

describe('Utility Functions', () => {
  describe('computeAssemblyHash', () => {
    it('computes SHA-256 hash', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const hash = await computeAssemblyHash(data)

      expect(hash).toBeDefined()
      expect(hash).toHaveLength(64) // SHA-256 = 32 bytes = 64 hex chars
    })

    it('produces consistent hashes', async () => {
      const data = new Uint8Array([1, 2, 3])
      const hash1 = await computeAssemblyHash(data)
      const hash2 = await computeAssemblyHash(data)

      expect(hash1).toBe(hash2)
    })

    it('produces different hashes for different data', async () => {
      const data1 = new Uint8Array([1])
      const data2 = new Uint8Array([2])
      const hash1 = await computeAssemblyHash(data1)
      const hash2 = await computeAssemblyHash(data2)

      expect(hash1).not.toBe(hash2)
    })
  })

  describe('createAssemblyId', () => {
    it('creates versioned ID', () => {
      const id = createAssemblyId('MyLib', '1.2.3')
      expect(id).toBe('MyLib@1.2.3')
    })
  })

  describe('parseAssemblyId', () => {
    it('parses versioned ID', () => {
      const result = parseAssemblyId('MyLib@1.2.3')
      expect(result).toEqual({ name: 'MyLib', version: '1.2.3' })
    })

    it('returns null for invalid ID', () => {
      expect(parseAssemblyId('invalid')).toBeNull()
    })
  })

  describe('compareVersions', () => {
    it('compares versions correctly', () => {
      expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0)
      expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0)
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
      expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0)
      expect(compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0)
    })

    it('handles different version lengths', () => {
      expect(compareVersions('1.0', '1.0.0')).toBe(0)
      expect(compareVersions('1.0', '1.0.1')).toBeLessThan(0)
    })
  })
})
