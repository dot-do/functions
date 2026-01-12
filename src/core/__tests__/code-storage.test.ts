import { describe, it, expect, beforeEach } from 'vitest'
import { KVCodeStorage } from '../code-storage'
import { createMockKV } from '../../test-utils/mock-kv'

describe('KVCodeStorage', () => {
  let storage: KVCodeStorage
  let mockKV: KVNamespace

  beforeEach(() => {
    mockKV = createMockKV()
    storage = new KVCodeStorage(mockKV)
  })

  describe('get()', () => {
    it('should return null for non-existent code', async () => {
      const result = await storage.get('non-existent')
      expect(result).toBeNull()
    })

    it('should retrieve stored code without version', async () => {
      await mockKV.put('code:my-func', 'export default { fetch() {} }')

      const result = await storage.get('my-func')
      expect(result).toBe('export default { fetch() {} }')
    })

    it('should retrieve stored code for a specific version', async () => {
      await mockKV.put('code:my-func:v:1.0.0', 'export default { fetch() { return "v1" } }')
      await mockKV.put('code:my-func:v:2.0.0', 'export default { fetch() { return "v2" } }')

      const v1 = await storage.get('my-func', '1.0.0')
      const v2 = await storage.get('my-func', '2.0.0')

      expect(v1).toBe('export default { fetch() { return "v1" } }')
      expect(v2).toBe('export default { fetch() { return "v2" } }')
    })

    it('should return null for non-existent version', async () => {
      await mockKV.put('code:my-func', 'export default {}')

      const result = await storage.get('my-func', '999.0.0')
      expect(result).toBeNull()
    })

    it('should distinguish between versioned and unversioned keys', async () => {
      await mockKV.put('code:my-func', 'latest code')
      await mockKV.put('code:my-func:v:1.0.0', 'versioned code')

      const latest = await storage.get('my-func')
      const versioned = await storage.get('my-func', '1.0.0')

      expect(latest).toBe('latest code')
      expect(versioned).toBe('versioned code')
    })
  })

  describe('put()', () => {
    it('should store code without version', async () => {
      await storage.put('my-func', 'export default { fetch() {} }')

      const stored = await mockKV.get('code:my-func', 'text')
      expect(stored).toBe('export default { fetch() {} }')
    })

    it('should store code for a specific version', async () => {
      await storage.put('my-func', 'export default { fetch() {} }', '1.0.0')

      const stored = await mockKV.get('code:my-func:v:1.0.0', 'text')
      expect(stored).toBe('export default { fetch() {} }')
    })

    it('should overwrite existing code', async () => {
      await storage.put('my-func', 'old code')
      await storage.put('my-func', 'new code')

      const stored = await mockKV.get('code:my-func', 'text')
      expect(stored).toBe('new code')
    })

    it('should store multiple versions independently', async () => {
      await storage.put('my-func', 'latest code')
      await storage.put('my-func', 'v1 code', '1.0.0')
      await storage.put('my-func', 'v2 code', '2.0.0')

      const latest = await mockKV.get('code:my-func', 'text')
      const v1 = await mockKV.get('code:my-func:v:1.0.0', 'text')
      const v2 = await mockKV.get('code:my-func:v:2.0.0', 'text')

      expect(latest).toBe('latest code')
      expect(v1).toBe('v1 code')
      expect(v2).toBe('v2 code')
    })
  })

  describe('delete()', () => {
    it('should delete unversioned code', async () => {
      await storage.put('my-func', 'code to delete')
      await storage.delete('my-func')

      const result = await storage.get('my-func')
      expect(result).toBeNull()
    })

    it('should delete versioned code', async () => {
      await storage.put('my-func', 'v1 code', '1.0.0')
      await storage.delete('my-func', '1.0.0')

      const result = await storage.get('my-func', '1.0.0')
      expect(result).toBeNull()
    })

    it('should not affect other versions when deleting', async () => {
      await storage.put('my-func', 'latest code')
      await storage.put('my-func', 'v1 code', '1.0.0')
      await storage.put('my-func', 'v2 code', '2.0.0')

      await storage.delete('my-func', '1.0.0')

      const latest = await storage.get('my-func')
      const v1 = await storage.get('my-func', '1.0.0')
      const v2 = await storage.get('my-func', '2.0.0')

      expect(latest).toBe('latest code')
      expect(v1).toBeNull()
      expect(v2).toBe('v2 code')
    })

    it('should handle deleting non-existent code gracefully', async () => {
      // Should not throw
      await expect(storage.delete('non-existent')).resolves.toBeUndefined()
      await expect(storage.delete('non-existent', '1.0.0')).resolves.toBeUndefined()
    })
  })

  describe('listVersions()', () => {
    it('should return empty array when no code exists', async () => {
      const versions = await storage.listVersions('non-existent')
      expect(versions).toEqual([])
    })

    it('should return latest for unversioned code', async () => {
      await storage.put('my-func', 'code')

      const versions = await storage.listVersions('my-func')
      expect(versions).toContain('latest')
    })

    it('should list all versions', async () => {
      await storage.put('my-func', 'latest code')
      await storage.put('my-func', 'v1 code', '1.0.0')
      await storage.put('my-func', 'v2 code', '2.0.0')
      await storage.put('my-func', 'v3 code', '3.0.0-beta.1')

      const versions = await storage.listVersions('my-func')

      expect(versions).toContain('latest')
      expect(versions).toContain('1.0.0')
      expect(versions).toContain('2.0.0')
      expect(versions).toContain('3.0.0-beta.1')
      expect(versions).toHaveLength(4)
    })

    it('should not include other functions', async () => {
      await storage.put('my-func', 'code', '1.0.0')
      await storage.put('other-func', 'code', '2.0.0')

      const myVersions = await storage.listVersions('my-func')
      const otherVersions = await storage.listVersions('other-func')

      expect(myVersions).toEqual(['1.0.0'])
      expect(otherVersions).toEqual(['2.0.0'])
    })
  })

  describe('deleteAll()', () => {
    it('should delete all versions of a function', async () => {
      await storage.put('my-func', 'latest code')
      await storage.put('my-func', 'v1 code', '1.0.0')
      await storage.put('my-func', 'v2 code', '2.0.0')

      await storage.deleteAll('my-func')

      const latest = await storage.get('my-func')
      const v1 = await storage.get('my-func', '1.0.0')
      const v2 = await storage.get('my-func', '2.0.0')

      expect(latest).toBeNull()
      expect(v1).toBeNull()
      expect(v2).toBeNull()
    })

    it('should not affect other functions', async () => {
      await storage.put('my-func', 'my code')
      await storage.put('other-func', 'other code')

      await storage.deleteAll('my-func')

      const myCode = await storage.get('my-func')
      const otherCode = await storage.get('other-func')

      expect(myCode).toBeNull()
      expect(otherCode).toBe('other code')
    })

    it('should handle deleting non-existent function gracefully', async () => {
      await expect(storage.deleteAll('non-existent')).resolves.toBeUndefined()
    })
  })

  describe('key format', () => {
    it('should use correct key format for unversioned code', async () => {
      await storage.put('test-func', 'code')

      const keys = await mockKV.list({ prefix: 'code:' })
      expect(keys.keys.some((k) => k.name === 'code:test-func')).toBe(true)
    })

    it('should use correct key format for versioned code', async () => {
      await storage.put('test-func', 'code', '1.2.3')

      const keys = await mockKV.list({ prefix: 'code:' })
      expect(keys.keys.some((k) => k.name === 'code:test-func:v:1.2.3')).toBe(true)
    })

    it('should handle function IDs with special characters', async () => {
      await storage.put('my-func-123', 'code')
      await storage.put('my_func_456', 'code', '1.0.0')

      const code1 = await storage.get('my-func-123')
      const code2 = await storage.get('my_func_456', '1.0.0')

      expect(code1).toBe('code')
      expect(code2).toBe('code')
    })
  })
})
