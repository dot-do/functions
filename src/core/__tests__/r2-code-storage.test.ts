import { describe, it, expect, beforeEach } from 'vitest'
import { R2CodeStorage } from '../r2-code-storage'
import { createMockR2 } from '../../test-utils/mock-r2'

describe('R2CodeStorage', () => {
  let storage: R2CodeStorage
  let mockR2: R2Bucket

  beforeEach(() => {
    mockR2 = createMockR2()
    storage = new R2CodeStorage(mockR2)
  })

  describe('get()', () => {
    it('should return null for non-existent code', async () => {
      const result = await storage.get('non-existent')
      expect(result).toBeNull()
    })

    it('should retrieve stored code without version', async () => {
      await mockR2.put('code/my-func/latest', 'export default { fetch() {} }')

      const result = await storage.get('my-func')
      expect(result).toBe('export default { fetch() {} }')
    })

    it('should retrieve stored code for a specific version', async () => {
      await mockR2.put('code/my-func/v/1.0.0', 'export default { fetch() { return "v1" } }')
      await mockR2.put('code/my-func/v/2.0.0', 'export default { fetch() { return "v2" } }')

      const v1 = await storage.get('my-func', '1.0.0')
      const v2 = await storage.get('my-func', '2.0.0')

      expect(v1).toBe('export default { fetch() { return "v1" } }')
      expect(v2).toBe('export default { fetch() { return "v2" } }')
    })

    it('should return null for non-existent version', async () => {
      await mockR2.put('code/my-func/latest', 'export default {}')

      const result = await storage.get('my-func', '999.0.0')
      expect(result).toBeNull()
    })

    it('should distinguish between versioned and unversioned keys', async () => {
      await mockR2.put('code/my-func/latest', 'latest code')
      await mockR2.put('code/my-func/v/1.0.0', 'versioned code')

      const latest = await storage.get('my-func')
      const versioned = await storage.get('my-func', '1.0.0')

      expect(latest).toBe('latest code')
      expect(versioned).toBe('versioned code')
    })
  })

  describe('put()', () => {
    it('should store code without version', async () => {
      await storage.put('my-func', 'export default { fetch() {} }')

      const object = await mockR2.get('code/my-func/latest')
      expect(object).not.toBeNull()
      expect(await object!.text()).toBe('export default { fetch() {} }')
    })

    it('should store code for a specific version', async () => {
      await storage.put('my-func', 'export default { fetch() {} }', '1.0.0')

      const object = await mockR2.get('code/my-func/v/1.0.0')
      expect(object).not.toBeNull()
      expect(await object!.text()).toBe('export default { fetch() {} }')
    })

    it('should overwrite existing code', async () => {
      await storage.put('my-func', 'old code')
      await storage.put('my-func', 'new code')

      const result = await storage.get('my-func')
      expect(result).toBe('new code')
    })

    it('should store multiple versions independently', async () => {
      await storage.put('my-func', 'latest code')
      await storage.put('my-func', 'v1 code', '1.0.0')
      await storage.put('my-func', 'v2 code', '2.0.0')

      const latest = await storage.get('my-func')
      const v1 = await storage.get('my-func', '1.0.0')
      const v2 = await storage.get('my-func', '2.0.0')

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

    it('should not include source map keys in version list', async () => {
      await storage.put('my-func', 'code')
      await storage.putSourceMap('my-func', 'sourcemap')

      const versions = await storage.listVersions('my-func')

      expect(versions).toEqual(['latest'])
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

    it('should delete source maps when deleting all', async () => {
      await storage.put('my-func', 'code')
      await storage.putSourceMap('my-func', '{"version":3}')
      await storage.put('my-func', 'v1', '1.0.0')
      await storage.putSourceMap('my-func', '{"version":3}', '1.0.0')

      await storage.deleteAll('my-func')

      expect(await storage.getSourceMap('my-func')).toBeNull()
      expect(await storage.getSourceMap('my-func', '1.0.0')).toBeNull()
    })
  })

  describe('source maps', () => {
    it('should store source maps with proper key structure', async () => {
      const functionId = 'my-function'
      const sourceMap = JSON.stringify({
        version: 3,
        sources: ['index.ts'],
        mappings: 'AAAA',
        names: [],
      })

      await storage.putSourceMap(functionId, sourceMap)

      const object = await mockR2.get(`code/${functionId}/latest.map`)
      expect(object).not.toBeNull()
      expect(await object!.text()).toBe(sourceMap)
    })

    it('should retrieve source maps', async () => {
      const functionId = 'my-function'
      const sourceMap = JSON.stringify({
        version: 3,
        sources: ['index.ts'],
        mappings: 'AAAA',
      })

      await mockR2.put(`code/${functionId}/latest.map`, sourceMap)

      const retrievedMap = await storage.getSourceMap(functionId)
      expect(retrievedMap).toBe(sourceMap)
    })

    it('should store version-specific source maps', async () => {
      const functionId = 'my-function'
      const version = '1.0.0'
      const sourceMap = JSON.stringify({ version: 3, mappings: 'AAAA' })

      await storage.putSourceMap(functionId, sourceMap, version)

      const object = await mockR2.get(`code/${functionId}/v/${version}.map`)
      expect(object).not.toBeNull()
      expect(await object!.text()).toBe(sourceMap)
    })

    it('should return null for non-existent source maps', async () => {
      const result = await storage.getSourceMap('non-existent')
      expect(result).toBeNull()
    })

    it('should delete source maps when deleting code with source map', async () => {
      const functionId = 'my-function'
      await storage.put(functionId, 'code')
      await storage.putSourceMap(functionId, '{"version":3}')

      await storage.deleteWithSourceMap(functionId)

      expect(await storage.get(functionId)).toBeNull()
      expect(await storage.getSourceMap(functionId)).toBeNull()
    })
  })

  describe('version fallback', () => {
    it('should fall back to latest when specific version not found', async () => {
      const functionId = 'my-function'
      await storage.put(functionId, 'latest-code')

      const result = await storage.getWithFallback(functionId, '999.0.0')

      expect(result).toEqual({
        code: 'latest-code',
        version: 'latest',
        fallback: true,
      })
    })

    it('should return specific version when available', async () => {
      const functionId = 'my-function'
      await storage.put(functionId, 'latest-code')
      await storage.put(functionId, 'v1-code', '1.0.0')

      const result = await storage.getWithFallback(functionId, '1.0.0')

      expect(result).toEqual({
        code: 'v1-code',
        version: '1.0.0',
        fallback: false,
      })
    })

    it('should return null when neither version nor fallback exists', async () => {
      const functionId = 'non-existent'

      const result = await storage.getWithFallback(functionId, '1.0.0')

      expect(result).toBeNull()
    })

    it('should support custom fallback version', async () => {
      const functionId = 'my-function'
      await storage.put(functionId, 'stable-code', 'stable')

      const result = await storage.getWithFallback(functionId, '1.0.0', 'stable')

      expect(result).toEqual({
        code: 'stable-code',
        version: 'stable',
        fallback: true,
      })
    })

    it('should try fallback chain in order', async () => {
      const functionId = 'my-function'
      await storage.put(functionId, 'v2-code', '2.0.0')

      const result = await storage.getWithFallback(functionId, '3.0.0', ['2.0.0', '1.0.0', 'latest'])

      expect(result).toEqual({
        code: 'v2-code',
        version: '2.0.0',
        fallback: true,
      })
    })
  })

  describe('listVersionsSorted()', () => {
    it('should return versions sorted by semantic version order', async () => {
      const functionId = 'my-function'
      await storage.put(functionId, 'v1', '1.0.0')
      await storage.put(functionId, 'v10', '10.0.0')
      await storage.put(functionId, 'v2', '2.0.0')
      await storage.put(functionId, 'v1.1', '1.1.0')

      const versions = await storage.listVersionsSorted(functionId)

      expect(versions).toEqual(['1.0.0', '1.1.0', '2.0.0', '10.0.0'])
    })

    it('should exclude latest from sorted list', async () => {
      const functionId = 'my-function'
      await storage.put(functionId, 'latest')
      await storage.put(functionId, 'v1', '1.0.0')
      await storage.put(functionId, 'v2', '2.0.0')

      const versions = await storage.listVersionsSorted(functionId)

      expect(versions).not.toContain('latest')
      expect(versions).toEqual(['1.0.0', '2.0.0'])
    })
  })

  describe('listVersionsPaginated()', () => {
    it('should support pagination for functions with many versions', async () => {
      const functionId = 'my-function'

      // Store many versions
      for (let i = 0; i < 50; i++) {
        await storage.put(functionId, `code-${i}`, `1.0.${i}`)
      }

      const page1 = await storage.listVersionsPaginated(functionId, { limit: 20 })

      expect(page1.versions).toHaveLength(20)
      expect(page1.hasMore).toBe(true)
    })
  })

  describe('binary code support', () => {
    it('should store and retrieve binary data', async () => {
      const functionId = 'wasm-function'
      const wasmData = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])

      await storage.putBinary(functionId, wasmData)

      const retrieved = await storage.getBinary(functionId)
      expect(retrieved).not.toBeNull()
      expect(new Uint8Array(retrieved!)).toEqual(wasmData)
    })

    it('should store binary data with version', async () => {
      const functionId = 'wasm-function'
      const wasmData = new Uint8Array([0x00, 0x61, 0x73, 0x6d])

      await storage.putBinary(functionId, wasmData, '1.0.0')

      const retrieved = await storage.getBinary(functionId, '1.0.0')
      expect(retrieved).not.toBeNull()
      expect(new Uint8Array(retrieved!)).toEqual(wasmData)
    })

    it('should return null for non-existent binary', async () => {
      const result = await storage.getBinary('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('metadata access', () => {
    it('should check if code exists', async () => {
      await storage.put('my-func', 'code')

      const exists = await storage.exists('my-func')
      const notExists = await storage.exists('non-existent')

      expect(exists).toBe(true)
      expect(notExists).toBe(false)
    })

    it('should check if versioned code exists', async () => {
      await storage.put('my-func', 'code', '1.0.0')

      const exists = await storage.exists('my-func', '1.0.0')
      const notExists = await storage.exists('my-func', '2.0.0')

      expect(exists).toBe(true)
      expect(notExists).toBe(false)
    })
  })

  describe('key format', () => {
    it('should use correct key format for unversioned code', async () => {
      await storage.put('test-func', 'code')

      const object = await mockR2.head('code/test-func/latest')
      expect(object).not.toBeNull()
    })

    it('should use correct key format for versioned code', async () => {
      await storage.put('test-func', 'code', '1.2.3')

      const object = await mockR2.head('code/test-func/v/1.2.3')
      expect(object).not.toBeNull()
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

  describe('edge cases and error handling', () => {
    it('should reject invalid function IDs', async () => {
      await expect(storage.put('', 'code')).rejects.toThrow()
      await expect(storage.put('invalid id with spaces', 'code')).rejects.toThrow()
      await expect(storage.put('../path-traversal', 'code')).rejects.toThrow()
    })

    it('should handle empty code string', async () => {
      await storage.put('empty-func', '')
      const result = await storage.get('empty-func')
      expect(result).toBe('')
    })

    it('should handle code with unicode characters', async () => {
      const code = 'export default { message: "\u0041" }'
      await storage.put('unicode-func', code)
      const result = await storage.get('unicode-func')
      expect(result).toBe(code)
    })

    it('should handle very long version strings', async () => {
      const longVersion = '1.0.0-alpha.beta.gamma.delta.epsilon.zeta.eta.theta'
      await storage.put('func', 'code', longVersion)
      const result = await storage.get('func', longVersion)
      expect(result).toBe('code')
    })

    it('should handle concurrent writes to the same key', async () => {
      const functionId = 'concurrent-func'

      // Simulate concurrent writes
      const writes = Promise.all([
        storage.put(functionId, 'code-1'),
        storage.put(functionId, 'code-2'),
        storage.put(functionId, 'code-3'),
      ])

      await expect(writes).resolves.toBeDefined()

      // One of the writes should win
      const result = await storage.get(functionId)
      expect(['code-1', 'code-2', 'code-3']).toContain(result)
    })
  })
})
