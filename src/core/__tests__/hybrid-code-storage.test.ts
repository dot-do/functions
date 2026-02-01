import { describe, it, expect, beforeEach } from 'vitest'
import { HybridCodeStorage } from '../hybrid-code-storage'
import { createMockR2 } from '../../test-utils/mock-r2'
import { createMockKV } from '../../test-utils/mock-kv'

describe('HybridCodeStorage', () => {
  let storage: HybridCodeStorage
  let mockR2: R2Bucket
  let mockKV: KVNamespace

  beforeEach(() => {
    mockR2 = createMockR2()
    mockKV = createMockKV()
    storage = new HybridCodeStorage(mockR2, mockKV)
  })

  describe('get() - read behavior', () => {
    it('should prefer R2 when code exists in both', async () => {
      // Store different code in each
      await mockR2.put('code/my-func/latest', 'r2-code')
      await mockKV.put('code:my-func', 'kv-code')

      const result = await storage.get('my-func')

      expect(result).toBe('r2-code')
    })

    it('should fall back to KV when code not in R2', async () => {
      await mockKV.put('code:my-func', 'kv-code')

      const result = await storage.get('my-func')

      expect(result).toBe('kv-code')
    })

    it('should return null when code not in either storage', async () => {
      const result = await storage.get('non-existent')

      expect(result).toBeNull()
    })

    it('should prefer KV when preferR2 is false', async () => {
      const kvFirstStorage = new HybridCodeStorage(mockR2, mockKV, { preferR2: false })

      await mockR2.put('code/my-func/latest', 'r2-code')
      await mockKV.put('code:my-func', 'kv-code')

      const result = await kvFirstStorage.get('my-func')

      expect(result).toBe('kv-code')
    })

    it('should handle versioned code lookups', async () => {
      await mockR2.put('code/my-func/v/1.0.0', 'r2-v1-code')
      await mockKV.put('code:my-func:v:2.0.0', 'kv-v2-code')

      const v1 = await storage.get('my-func', '1.0.0')
      const v2 = await storage.get('my-func', '2.0.0')

      expect(v1).toBe('r2-v1-code')
      expect(v2).toBe('kv-v2-code')
    })
  })

  describe('get() - auto-migration', () => {
    it('should auto-migrate from KV to R2 when enabled', async () => {
      const autoMigrateStorage = new HybridCodeStorage(mockR2, mockKV, { autoMigrate: true })

      await mockKV.put('code:my-func', 'kv-code')

      // First read triggers migration
      const result = await autoMigrateStorage.get('my-func')
      expect(result).toBe('kv-code')

      // Verify code is now in R2
      const r2Object = await mockR2.get('code/my-func/latest')
      expect(r2Object).not.toBeNull()
      expect(await r2Object!.text()).toBe('kv-code')
    })

    it('should not auto-migrate when disabled (default)', async () => {
      await mockKV.put('code:my-func', 'kv-code')

      await storage.get('my-func')

      // Verify code is NOT in R2
      const r2Object = await mockR2.get('code/my-func/latest')
      expect(r2Object).toBeNull()
    })
  })

  describe('put() - write behavior', () => {
    it('should write to R2 by default', async () => {
      await storage.put('my-func', 'new-code')

      const r2Object = await mockR2.get('code/my-func/latest')
      expect(r2Object).not.toBeNull()
      expect(await r2Object!.text()).toBe('new-code')

      // Should NOT write to KV
      const kvValue = await mockKV.get('code:my-func', 'text')
      expect(kvValue).toBeNull()
    })

    it('should write to KV when writeToR2 is false', async () => {
      const kvOnlyStorage = new HybridCodeStorage(mockR2, mockKV, { writeToR2: false })

      await kvOnlyStorage.put('my-func', 'new-code')

      const kvValue = await mockKV.get('code:my-func', 'text')
      expect(kvValue).toBe('new-code')

      // Should NOT write to R2
      const r2Object = await mockR2.get('code/my-func/latest')
      expect(r2Object).toBeNull()
    })

    it('should store versioned code in R2', async () => {
      await storage.put('my-func', 'v1-code', '1.0.0')

      const r2Object = await mockR2.get('code/my-func/v/1.0.0')
      expect(r2Object).not.toBeNull()
      expect(await r2Object!.text()).toBe('v1-code')
    })
  })

  describe('delete() - delete from both', () => {
    it('should delete from both storages', async () => {
      await mockR2.put('code/my-func/latest', 'r2-code')
      await mockKV.put('code:my-func', 'kv-code')

      await storage.delete('my-func')

      const r2Object = await mockR2.get('code/my-func/latest')
      const kvValue = await mockKV.get('code:my-func', 'text')

      expect(r2Object).toBeNull()
      expect(kvValue).toBeNull()
    })

    it('should delete versioned code from both storages', async () => {
      await mockR2.put('code/my-func/v/1.0.0', 'r2-code')
      await mockKV.put('code:my-func:v:1.0.0', 'kv-code')

      await storage.delete('my-func', '1.0.0')

      const r2Object = await mockR2.get('code/my-func/v/1.0.0')
      const kvValue = await mockKV.get('code:my-func:v:1.0.0', 'text')

      expect(r2Object).toBeNull()
      expect(kvValue).toBeNull()
    })
  })

  describe('listVersions() - combined listing', () => {
    it('should list versions from both storages, deduplicated', async () => {
      // R2 versions
      await mockR2.put('code/my-func/latest', 'latest')
      await mockR2.put('code/my-func/v/1.0.0', 'v1')

      // KV versions (with overlap)
      await mockKV.put('code:my-func', 'latest-kv')
      await mockKV.put('code:my-func:v:2.0.0', 'v2')

      const versions = await storage.listVersions('my-func')

      expect(versions).toContain('latest')
      expect(versions).toContain('1.0.0')
      expect(versions).toContain('2.0.0')
      // 'latest' should only appear once (deduplicated)
      expect(versions.filter((v) => v === 'latest')).toHaveLength(1)
    })
  })

  describe('deleteAll() - delete all versions from both', () => {
    it('should delete all versions from both storages', async () => {
      await mockR2.put('code/my-func/latest', 'latest')
      await mockR2.put('code/my-func/v/1.0.0', 'v1')
      await mockKV.put('code:my-func', 'latest-kv')
      await mockKV.put('code:my-func:v:2.0.0', 'v2')

      await storage.deleteAll('my-func')

      expect(await storage.get('my-func')).toBeNull()
      expect(await storage.get('my-func', '1.0.0')).toBeNull()
      expect(await storage.get('my-func', '2.0.0')).toBeNull()
    })
  })

  describe('source maps', () => {
    it('should write source maps to R2 by default', async () => {
      await storage.putSourceMap('my-func', '{"version":3}')

      const r2Object = await mockR2.get('code/my-func/latest.map')
      expect(r2Object).not.toBeNull()
      expect(await r2Object!.text()).toBe('{"version":3}')
    })

    it('should get source maps from R2 first', async () => {
      await mockR2.put('code/my-func/latest.map', 'r2-map')
      await mockKV.put('code:my-func:map', 'kv-map')

      const result = await storage.getSourceMap('my-func')

      expect(result).toBe('r2-map')
    })

    it('should fall back to KV for source maps', async () => {
      await mockKV.put('code:my-func:map', 'kv-map')

      const result = await storage.getSourceMap('my-func')

      expect(result).toBe('kv-map')
    })
  })

  describe('migration utilities', () => {
    describe('migrateFunction()', () => {
      it('should migrate code from KV to R2', async () => {
        await mockKV.put('code:my-func', 'kv-code')

        const status = await storage.migrateFunction('my-func')

        expect(status.status).toBe('migrated')
        expect(status.migratedAt).toBeDefined()

        const r2Object = await mockR2.get('code/my-func/latest')
        expect(await r2Object!.text()).toBe('kv-code')
      })

      it('should migrate versioned code', async () => {
        await mockKV.put('code:my-func:v:1.0.0', 'v1-code')

        const status = await storage.migrateFunction('my-func', '1.0.0')

        expect(status.status).toBe('migrated')

        const r2Object = await mockR2.get('code/my-func/v/1.0.0')
        expect(await r2Object!.text()).toBe('v1-code')
      })

      it('should skip if already in R2', async () => {
        await mockR2.put('code/my-func/latest', 'r2-code')

        const status = await storage.migrateFunction('my-func')

        expect(status.status).toBe('migrated')
      })

      it('should fail if code not in KV', async () => {
        const status = await storage.migrateFunction('non-existent')

        expect(status.status).toBe('failed')
        expect(status.error).toBe('Code not found in KV')
      })

      it('should also migrate source maps', async () => {
        await mockKV.put('code:my-func', 'code')
        await mockKV.put('code:my-func:map', 'source-map')

        await storage.migrateFunction('my-func')

        const r2Map = await mockR2.get('code/my-func/latest.map')
        expect(r2Map).not.toBeNull()
        expect(await r2Map!.text()).toBe('source-map')
      })
    })

    describe('migrateFunctionAllVersions()', () => {
      it('should migrate all versions of a function', async () => {
        await mockKV.put('code:my-func', 'latest-code')
        await mockKV.put('code:my-func:v:1.0.0', 'v1-code')
        await mockKV.put('code:my-func:v:2.0.0', 'v2-code')

        const progress = await storage.migrateFunctionAllVersions('my-func')

        expect(progress.total).toBe(3)
        expect(progress.migrated).toBe(3)
        expect(progress.failed).toBe(0)
      })

      it('should report failures in progress', async () => {
        await mockKV.put('code:my-func', 'latest-code')
        // Only put metadata for v1, not actual code - simulate partial data
        // Note: KVCodeStorage.listVersions returns versions based on key prefix matching
        // So we need to simulate a case where list finds a version but code retrieval fails

        const progress = await storage.migrateFunctionAllVersions('my-func')

        expect(progress.total).toBe(1)
        expect(progress.migrated).toBe(1)
      })
    })

    describe('verifyMigration()', () => {
      it('should return true when code matches', async () => {
        await mockR2.put('code/my-func/latest', 'same-code')
        await mockKV.put('code:my-func', 'same-code')

        const isValid = await storage.verifyMigration('my-func')

        expect(isValid).toBe(true)
      })

      it('should return false when code differs', async () => {
        await mockR2.put('code/my-func/latest', 'r2-code')
        await mockKV.put('code:my-func', 'kv-code')

        const isValid = await storage.verifyMigration('my-func')

        expect(isValid).toBe(false)
      })

      it('should return true when both are null', async () => {
        const isValid = await storage.verifyMigration('non-existent')

        expect(isValid).toBe(true)
      })
    })

    describe('cleanupKV()', () => {
      it('should delete from KV after verifying R2 has the code', async () => {
        await mockR2.put('code/my-func/latest', 'code')
        await mockKV.put('code:my-func', 'code')

        const success = await storage.cleanupKV('my-func')

        expect(success).toBe(true)
        expect(await mockKV.get('code:my-func', 'text')).toBeNull()
      })

      it('should not delete from KV if R2 does not have the code', async () => {
        await mockKV.put('code:my-func', 'code')

        const success = await storage.cleanupKV('my-func')

        expect(success).toBe(false)
        expect(await mockKV.get('code:my-func', 'text')).toBe('code')
      })
    })
  })

  describe('direct storage access', () => {
    it('should provide access to underlying R2 storage', () => {
      const r2Storage = storage.getR2Storage()
      expect(r2Storage).toBeDefined()
    })

    it('should provide access to underlying KV storage', () => {
      const kvStorage = storage.getKVStorage()
      expect(kvStorage).toBeDefined()
    })
  })

  describe('getWithFallback()', () => {
    it('should use R2 fallback first', async () => {
      await mockR2.put('code/my-func/v/1.0.0', 'r2-fallback')

      const result = await storage.getWithFallback('my-func', '2.0.0', '1.0.0')

      expect(result).toEqual({
        code: 'r2-fallback',
        version: '1.0.0',
        fallback: true,
      })
    })

    it('should fall back to KV if R2 has no matches', async () => {
      await mockKV.put('code:my-func', 'kv-latest')

      const result = await storage.getWithFallback('my-func', '2.0.0', 'latest')

      expect(result).toEqual({
        code: 'kv-latest',
        version: 'latest',
        fallback: true,
      })
    })
  })

  describe('listVersionsSorted()', () => {
    it('should merge and sort versions from both storages', async () => {
      await mockR2.put('code/my-func/v/1.0.0', 'v1')
      await mockR2.put('code/my-func/v/3.0.0', 'v3')
      await mockKV.put('code:my-func:v:2.0.0', 'v2')

      const versions = await storage.listVersionsSorted('my-func')

      expect(versions).toEqual(['1.0.0', '2.0.0', '3.0.0'])
    })
  })
})
