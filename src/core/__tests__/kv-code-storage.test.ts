import { describe, it, expect, beforeEach } from 'vitest'
import { KVCodeStorage } from '../code-storage'
import { createMockKV } from '../../test-utils/mock-kv'

/**
 * Tests for FUNCTIONS_CODE KV namespace operations.
 * These tests cover the extended functionality for storing compiled code,
 * source maps, version management, and large code handling.
 *
 * Issue: functions-bxc [P1] - FUNCTIONS_CODE KV namespace
 */
describe('KVCodeStorage - FUNCTIONS_CODE KV Namespace', () => {
  let storage: KVCodeStorage
  let mockKV: KVNamespace

  beforeEach(() => {
    mockKV = createMockKV()
    storage = new KVCodeStorage(mockKV)
  })

  describe('compiled code storage with proper key structure', () => {
    it('should store compiled code with code:{functionId} key format', async () => {
      const functionId = 'my-function'
      const compiledCode = 'export default { fetch() { return new Response("Hello") } }'

      await storage.put(functionId, compiledCode)

      // Verify the key format in KV
      const storedValue = await mockKV.get(`code:${functionId}`, 'text')
      expect(storedValue).toBe(compiledCode)
    })

    it('should handle function IDs with organization prefix', async () => {
      const functionId = 'org_acme_my-function'
      const code = 'export default {}'

      await storage.put(functionId, code)

      const storedValue = await mockKV.get(`code:${functionId}`, 'text')
      expect(storedValue).toBe(code)
    })

    it('should maintain key isolation between different functions', async () => {
      await storage.put('func-a', 'code-a')
      await storage.put('func-b', 'code-b')

      expect(await storage.get('func-a')).toBe('code-a')
      expect(await storage.get('func-b')).toBe('code-b')
    })
  })

  describe('source map storage (code:{functionId}:map)', () => {
    it('should store source maps with proper key structure', async () => {
      const functionId = 'my-function'
      const sourceMap = JSON.stringify({
        version: 3,
        sources: ['index.ts'],
        mappings: 'AAAA',
        names: [],
      })

      // This method needs to be implemented
      await storage.putSourceMap(functionId, sourceMap)

      const storedMap = await mockKV.get(`code:${functionId}:map`, 'text')
      expect(storedMap).toBe(sourceMap)
    })

    it('should retrieve source maps', async () => {
      const functionId = 'my-function'
      const sourceMap = JSON.stringify({
        version: 3,
        sources: ['index.ts'],
        mappings: 'AAAA',
      })

      await mockKV.put(`code:${functionId}:map`, sourceMap)

      // This method needs to be implemented
      const retrievedMap = await storage.getSourceMap(functionId)
      expect(retrievedMap).toBe(sourceMap)
    })

    it('should store version-specific source maps', async () => {
      const functionId = 'my-function'
      const version = '1.0.0'
      const sourceMap = JSON.stringify({ version: 3, mappings: 'AAAA' })

      // This method needs to be implemented
      await storage.putSourceMap(functionId, sourceMap, version)

      const storedMap = await mockKV.get(`code:${functionId}:v:${version}:map`, 'text')
      expect(storedMap).toBe(sourceMap)
    })

    it('should return null for non-existent source maps', async () => {
      const result = await storage.getSourceMap('non-existent')
      expect(result).toBeNull()
    })

    it('should delete source maps when deleting code', async () => {
      const functionId = 'my-function'
      await storage.put(functionId, 'code')
      await storage.putSourceMap(functionId, '{"version":3}')

      await storage.deleteWithSourceMap(functionId)

      expect(await storage.get(functionId)).toBeNull()
      expect(await storage.getSourceMap(functionId)).toBeNull()
    })
  })

  describe('version-specific code storage (code:{functionId}:v:{version})', () => {
    it('should store code with version key format', async () => {
      const functionId = 'my-function'
      const version = '1.2.3'
      const code = 'export default { fetch() {} }'

      await storage.put(functionId, code, version)

      const storedValue = await mockKV.get(`code:${functionId}:v:${version}`, 'text')
      expect(storedValue).toBe(code)
    })

    it('should handle semantic versions with pre-release tags', async () => {
      const functionId = 'my-function'
      const version = '2.0.0-beta.1'
      const code = 'beta code'

      await storage.put(functionId, code, version)

      const result = await storage.get(functionId, version)
      expect(result).toBe(code)
    })

    it('should store multiple versions independently', async () => {
      const functionId = 'my-function'
      const versions = ['1.0.0', '1.1.0', '2.0.0']

      for (const version of versions) {
        await storage.put(functionId, `code-${version}`, version)
      }

      for (const version of versions) {
        const result = await storage.get(functionId, version)
        expect(result).toBe(`code-${version}`)
      }
    })

    it('should not mix up versioned and unversioned code', async () => {
      const functionId = 'my-function'

      await storage.put(functionId, 'latest-code')
      await storage.put(functionId, 'v1-code', '1.0.0')

      expect(await storage.get(functionId)).toBe('latest-code')
      expect(await storage.get(functionId, '1.0.0')).toBe('v1-code')
    })
  })

  describe('large code handling (chunking)', () => {
    const CHUNK_SIZE = 25 * 1024 * 1024 // 25MB - KV limit

    it('should detect when code exceeds single KV value limit', async () => {
      const functionId = 'large-function'
      const largeCode = 'x'.repeat(CHUNK_SIZE + 1000)

      // This should store the code in chunks
      await storage.putLarge(functionId, largeCode)

      // Should be able to retrieve it correctly
      const retrieved = await storage.getLarge(functionId)
      expect(retrieved).toBe(largeCode)
    })

    it('should store chunk metadata', async () => {
      const functionId = 'large-function'
      const largeCode = 'x'.repeat(CHUNK_SIZE * 2 + 1000) // Will need 3 chunks

      await storage.putLarge(functionId, largeCode)

      // Should store metadata about chunks
      const metadata = await mockKV.get(`code:${functionId}:meta`, 'json')
      expect(metadata).toMatchObject({
        chunked: true,
        totalChunks: expect.any(Number),
        totalSize: largeCode.length,
      })
    })

    it('should store individual chunks with proper keys', async () => {
      const functionId = 'large-function'
      const largeCode = 'a'.repeat(CHUNK_SIZE) + 'b'.repeat(CHUNK_SIZE)

      await storage.putLarge(functionId, largeCode)

      // Verify chunk keys exist
      const chunk0 = await mockKV.get(`code:${functionId}:chunk:0`, 'text')
      const chunk1 = await mockKV.get(`code:${functionId}:chunk:1`, 'text')

      expect(chunk0).not.toBeNull()
      expect(chunk1).not.toBeNull()
    })

    it('should reassemble chunks in correct order', async () => {
      const functionId = 'large-function'
      const part1 = 'FIRST_PART_'.repeat(1000)
      const part2 = 'SECOND_PART_'.repeat(1000)
      const part3 = 'THIRD_PART_'.repeat(1000)
      const largeCode = part1 + part2 + part3

      // Manually simulate chunking for test
      const chunkSize = Math.ceil(largeCode.length / 3)
      await mockKV.put(`code:${functionId}:meta`, JSON.stringify({
        chunked: true,
        totalChunks: 3,
        totalSize: largeCode.length,
        chunkSize,
      }))
      await mockKV.put(`code:${functionId}:chunk:0`, largeCode.slice(0, chunkSize))
      await mockKV.put(`code:${functionId}:chunk:1`, largeCode.slice(chunkSize, chunkSize * 2))
      await mockKV.put(`code:${functionId}:chunk:2`, largeCode.slice(chunkSize * 2))

      const retrieved = await storage.getLarge(functionId)
      expect(retrieved).toBe(largeCode)
    })

    it('should handle version-specific large code', async () => {
      const functionId = 'large-function'
      const version = '1.0.0'
      const largeCode = 'x'.repeat(CHUNK_SIZE + 1000)

      await storage.putLarge(functionId, largeCode, version)

      const retrieved = await storage.getLarge(functionId, version)
      expect(retrieved).toBe(largeCode)
    })

    it('should delete all chunks when deleting large code', async () => {
      const functionId = 'large-function'

      // Set up chunked data
      await mockKV.put(`code:${functionId}:meta`, JSON.stringify({
        chunked: true,
        totalChunks: 3,
        totalSize: 1000,
      }))
      await mockKV.put(`code:${functionId}:chunk:0`, 'chunk0')
      await mockKV.put(`code:${functionId}:chunk:1`, 'chunk1')
      await mockKV.put(`code:${functionId}:chunk:2`, 'chunk2')

      await storage.deleteLarge(functionId)

      expect(await mockKV.get(`code:${functionId}:meta`, 'text')).toBeNull()
      expect(await mockKV.get(`code:${functionId}:chunk:0`, 'text')).toBeNull()
      expect(await mockKV.get(`code:${functionId}:chunk:1`, 'text')).toBeNull()
      expect(await mockKV.get(`code:${functionId}:chunk:2`, 'text')).toBeNull()
    })
  })

  describe('code retrieval with version fallback', () => {
    it('should fall back to latest when specific version not found', async () => {
      const functionId = 'my-function'
      await storage.put(functionId, 'latest-code')

      // This method needs to be implemented
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

      // Request v3.0.0, fall back through chain
      const result = await storage.getWithFallback(functionId, '3.0.0', ['2.0.0', '1.0.0', 'latest'])

      expect(result).toEqual({
        code: 'v2-code',
        version: '2.0.0',
        fallback: true,
      })
    })
  })

  describe('listing all versions for a function', () => {
    it('should list all stored versions', async () => {
      const functionId = 'my-function'
      await storage.put(functionId, 'latest')
      await storage.put(functionId, 'v1', '1.0.0')
      await storage.put(functionId, 'v2', '2.0.0')
      await storage.put(functionId, 'beta', '3.0.0-beta.1')

      const versions = await storage.listVersions(functionId)

      expect(versions).toContain('latest')
      expect(versions).toContain('1.0.0')
      expect(versions).toContain('2.0.0')
      expect(versions).toContain('3.0.0-beta.1')
      expect(versions).toHaveLength(4)
    })

    it('should return empty array for non-existent function', async () => {
      const versions = await storage.listVersions('non-existent')
      expect(versions).toEqual([])
    })

    it('should not include source map keys in version list', async () => {
      const functionId = 'my-function'
      await storage.put(functionId, 'code')
      await mockKV.put(`code:${functionId}:map`, 'sourcemap')

      const versions = await storage.listVersions(functionId)

      expect(versions).toEqual(['latest'])
      expect(versions).not.toContain('map')
    })

    it('should not include chunk keys in version list', async () => {
      const functionId = 'my-function'
      await storage.put(functionId, 'code')
      await mockKV.put(`code:${functionId}:chunk:0`, 'chunk0')
      await mockKV.put(`code:${functionId}:meta`, '{}')

      const versions = await storage.listVersions(functionId)

      expect(versions).toEqual(['latest'])
      expect(versions).not.toContain('chunk:0')
      expect(versions).not.toContain('meta')
    })

    it('should return versions sorted by semantic version order', async () => {
      const functionId = 'my-function'
      await storage.put(functionId, 'v1', '1.0.0')
      await storage.put(functionId, 'v10', '10.0.0')
      await storage.put(functionId, 'v2', '2.0.0')
      await storage.put(functionId, 'v1.1', '1.1.0')

      // This method should return sorted versions
      const versions = await storage.listVersionsSorted(functionId)

      expect(versions).toEqual(['1.0.0', '1.1.0', '2.0.0', '10.0.0'])
    })

    it('should support pagination for functions with many versions', async () => {
      const functionId = 'my-function'

      // Store many versions
      for (let i = 0; i < 50; i++) {
        await storage.put(functionId, `code-${i}`, `1.0.${i}`)
      }

      // This method should support pagination
      const page1 = await storage.listVersionsPaginated(functionId, { limit: 20 })
      const page2 = await storage.listVersionsPaginated(functionId, { limit: 20, cursor: page1.cursor })

      expect(page1.versions).toHaveLength(20)
      expect(page2.versions).toHaveLength(20)
      expect(page1.hasMore).toBe(true)
    })
  })

  describe('deleting code and all versions', () => {
    it('should delete the latest code', async () => {
      const functionId = 'my-function'
      await storage.put(functionId, 'code')

      await storage.delete(functionId)

      expect(await storage.get(functionId)).toBeNull()
    })

    it('should delete a specific version', async () => {
      const functionId = 'my-function'
      await storage.put(functionId, 'latest')
      await storage.put(functionId, 'v1', '1.0.0')

      await storage.delete(functionId, '1.0.0')

      expect(await storage.get(functionId)).toBe('latest')
      expect(await storage.get(functionId, '1.0.0')).toBeNull()
    })

    it('should delete all versions with deleteAll', async () => {
      const functionId = 'my-function'
      await storage.put(functionId, 'latest')
      await storage.put(functionId, 'v1', '1.0.0')
      await storage.put(functionId, 'v2', '2.0.0')

      await storage.deleteAll(functionId)

      expect(await storage.get(functionId)).toBeNull()
      expect(await storage.get(functionId, '1.0.0')).toBeNull()
      expect(await storage.get(functionId, '2.0.0')).toBeNull()
    })

    it('should delete source maps when deleting all', async () => {
      const functionId = 'my-function'
      await storage.put(functionId, 'code')
      await mockKV.put(`code:${functionId}:map`, 'sourcemap')
      await storage.put(functionId, 'v1', '1.0.0')
      await mockKV.put(`code:${functionId}:v:1.0.0:map`, 'sourcemap-v1')

      await storage.deleteAll(functionId)

      expect(await mockKV.get(`code:${functionId}:map`, 'text')).toBeNull()
      expect(await mockKV.get(`code:${functionId}:v:1.0.0:map`, 'text')).toBeNull()
    })

    it('should delete chunked code when deleting all', async () => {
      const functionId = 'my-function'
      await mockKV.put(`code:${functionId}:meta`, JSON.stringify({ chunked: true, totalChunks: 2 }))
      await mockKV.put(`code:${functionId}:chunk:0`, 'chunk0')
      await mockKV.put(`code:${functionId}:chunk:1`, 'chunk1')

      await storage.deleteAll(functionId)

      expect(await mockKV.get(`code:${functionId}:meta`, 'text')).toBeNull()
      expect(await mockKV.get(`code:${functionId}:chunk:0`, 'text')).toBeNull()
      expect(await mockKV.get(`code:${functionId}:chunk:1`, 'text')).toBeNull()
    })

    it('should not affect other functions when deleting', async () => {
      await storage.put('func-a', 'code-a')
      await storage.put('func-b', 'code-b')

      await storage.deleteAll('func-a')

      expect(await storage.get('func-a')).toBeNull()
      expect(await storage.get('func-b')).toBe('code-b')
    })

    it('should handle deleting non-existent function gracefully', async () => {
      await expect(storage.deleteAll('non-existent')).resolves.toBeUndefined()
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
      // KV stores empty strings as null
      expect(result === '' || result === null).toBe(true)
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
