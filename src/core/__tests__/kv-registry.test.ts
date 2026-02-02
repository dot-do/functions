import { describe, it, expect, beforeEach } from 'vitest'
import { createMockKV } from '../../test-utils/mock-kv'
import type { FunctionMetadata } from '../types'
import { KVFunctionRegistry } from '../kv-function-registry'

describe('KVFunctionRegistry', () => {
  let mockKV: KVNamespace
  let registry: KVFunctionRegistry

  const createTestMetadata = (overrides: Partial<FunctionMetadata> = {}): FunctionMetadata => ({
    id: 'test-function',
    version: '1.0.0',
    type: 'code',
    language: 'typescript',
    entryPoint: 'index.ts',
    dependencies: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as FunctionMetadata)

  beforeEach(() => {
    mockKV = createMockKV()
    registry = new KVFunctionRegistry(mockKV)
  })

  describe('Key Structure: registry:{functionId}', () => {
    describe('put() - Storing function metadata', () => {
      it('should store function metadata with key registry:{functionId}', async () => {
        const metadata = createTestMetadata({ id: 'my-function' })

        await registry.put(metadata)

        // Verify the metadata was stored with the correct key pattern
        const stored = await mockKV.get('registry:my-function', 'json')
        expect(stored).toMatchObject({
          id: 'my-function',
          version: '1.0.0',
          language: 'typescript',
          entryPoint: 'index.ts',
        })
      })

      it('should automatically set createdAt timestamp on first put', async () => {
        const metadata = createTestMetadata({ id: 'new-func' })
        delete (metadata as Partial<FunctionMetadata>).createdAt
        delete (metadata as Partial<FunctionMetadata>).updatedAt

        await registry.put(metadata as FunctionMetadata)

        const stored = (await mockKV.get('registry:new-func', 'json')) as FunctionMetadata
        expect(stored.createdAt).toBeDefined()
        expect(typeof stored.createdAt).toBe('string')
      })

      it('should set updatedAt timestamp on put', async () => {
        const metadata = createTestMetadata({ id: 'my-func' })

        await registry.put(metadata)

        const stored = (await mockKV.get('registry:my-func', 'json')) as FunctionMetadata
        expect(stored.updatedAt).toBeDefined()
        expect(typeof stored.updatedAt).toBe('string')
      })

      it('should preserve createdAt on subsequent puts', async () => {
        const originalCreatedAt = '2024-01-01T00:00:00.000Z'
        const metadata = createTestMetadata({
          id: 'my-func',
          createdAt: originalCreatedAt,
        })

        await registry.put(metadata)

        // Update with new version
        await registry.put(createTestMetadata({ id: 'my-func', version: '2.0.0' }))

        const stored = (await mockKV.get('registry:my-func', 'json')) as FunctionMetadata
        expect(stored.createdAt).toBe(originalCreatedAt)
        expect(stored.version).toBe('2.0.0')
      })

      it('should store metadata with dependencies', async () => {
        const metadata = createTestMetadata({
          id: 'func-with-deps',
          dependencies: {
            lodash: '^4.17.21',
            axios: '~1.6.0',
          },
        })

        await registry.put(metadata)

        const stored = (await mockKV.get('registry:func-with-deps', 'json')) as FunctionMetadata
        expect(stored.dependencies).toEqual({
          lodash: '^4.17.21',
          axios: '~1.6.0',
        })
      })

      it('should handle different languages', async () => {
        const languages = ['typescript', 'javascript', 'rust', 'python', 'go'] as const

        for (const language of languages) {
          const metadata = createTestMetadata({
            id: `func-${language}`,
            language,
          })

          await registry.put(metadata)

          const stored = (await mockKV.get(`registry:func-${language}`, 'json')) as FunctionMetadata
          expect(stored.language).toBe(language)
        }
      })
    })

    describe('get() - Retrieving function metadata', () => {
      it('should retrieve function metadata by functionId', async () => {
        const metadata = createTestMetadata({ id: 'my-function' })
        await mockKV.put('registry:my-function', JSON.stringify(metadata))

        const result = await registry.get('my-function')

        expect(result).toMatchObject({
          id: 'my-function',
          version: '1.0.0',
        })
      })

      it('should return null for non-existent function', async () => {
        const result = await registry.get('non-existent-function')

        expect(result).toBeNull()
      })

      it('should return complete metadata with all fields', async () => {
        const metadata = createTestMetadata({
          id: 'complete-func',
          version: '2.1.0',
          language: 'rust',
          entryPoint: 'lib/main.rs',
          dependencies: { serde: '1.0.0' },
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-06-15T12:30:00.000Z',
        })
        await mockKV.put('registry:complete-func', JSON.stringify(metadata))

        const result = await registry.get('complete-func')

        expect(result).toEqual(metadata)
      })

      it('should handle function IDs with hyphens and underscores', async () => {
        const ids = ['my-function', 'my_function', 'my-func_123', 'a1-b2_c3']

        for (const id of ids) {
          const metadata = createTestMetadata({ id })
          await mockKV.put(`registry:${id}`, JSON.stringify(metadata))

          const result = await registry.get(id)
          expect(result?.id).toBe(id)
        }
      })
    })

    describe('list() - Listing all functions with pagination', () => {
      it('should return empty result when no functions exist', async () => {
        const result = await registry.list()

        expect(result.functions).toEqual([])
        expect(result.hasMore).toBe(false)
      })

      it('should return all functions without pagination', async () => {
        const func1 = createTestMetadata({ id: 'func-1' })
        const func2 = createTestMetadata({ id: 'func-2' })
        const func3 = createTestMetadata({ id: 'func-3' })

        await mockKV.put('registry:func-1', JSON.stringify(func1))
        await mockKV.put('registry:func-2', JSON.stringify(func2))
        await mockKV.put('registry:func-3', JSON.stringify(func3))

        const result = await registry.list()

        expect(result.functions).toHaveLength(3)
        expect(result.functions.map((f) => f.id).sort()).toEqual(['func-1', 'func-2', 'func-3'])
        expect(result.hasMore).toBe(false)
      })

      it('should support pagination with limit', async () => {
        // Create 5 functions
        for (let i = 1; i <= 5; i++) {
          const metadata = createTestMetadata({ id: `func-${i}` })
          await mockKV.put(`registry:func-${i}`, JSON.stringify(metadata))
        }

        const result = await registry.list({ limit: 2 })

        expect(result.functions).toHaveLength(2)
        expect(result.hasMore).toBe(true)
        expect(result.cursor).toBeDefined()
      })

      it('should support pagination with cursor', async () => {
        // Create 5 functions
        for (let i = 1; i <= 5; i++) {
          const metadata = createTestMetadata({ id: `func-${i}` })
          await mockKV.put(`registry:func-${i}`, JSON.stringify(metadata))
        }

        // Get first page
        const page1 = await registry.list({ limit: 2 })
        expect(page1.functions).toHaveLength(2)
        expect(page1.hasMore).toBe(true)

        // Get second page using cursor
        const page2 = await registry.list({ limit: 2, cursor: page1.cursor })
        expect(page2.functions).toHaveLength(2)
        expect(page2.hasMore).toBe(true)

        // Get third page
        const page3 = await registry.list({ limit: 2, cursor: page2.cursor })
        expect(page3.functions).toHaveLength(1)
        expect(page3.hasMore).toBe(false)
      })

      it('should not include version entries in list results', async () => {
        const metadata = createTestMetadata({ id: 'my-func' })
        await mockKV.put('registry:my-func', JSON.stringify(metadata))
        await mockKV.put('registry:my-func:v:1.0.0', JSON.stringify(metadata))
        await mockKV.put('registry:my-func:v:2.0.0', JSON.stringify({ ...metadata, version: '2.0.0' }))

        const result = await registry.list()

        // Should only return the main entry, not version entries
        expect(result.functions).toHaveLength(1)
        expect(result.functions[0]?.id).toBe('my-func')
      })

      it('should handle concurrent list calls correctly', async () => {
        for (let i = 1; i <= 10; i++) {
          const metadata = createTestMetadata({ id: `func-${i}` })
          await mockKV.put(`registry:func-${i}`, JSON.stringify(metadata))
        }

        // Make multiple concurrent list calls
        const results = await Promise.all([registry.list({ limit: 5 }), registry.list({ limit: 5 }), registry.list({ limit: 5 })])

        // All should return consistent results
        for (const result of results) {
          expect(result.functions).toHaveLength(5)
          expect(result.hasMore).toBe(true)
        }
      })
    })

    describe('update() - Updating function metadata', () => {
      it('should update specific fields of function metadata', async () => {
        const original = createTestMetadata({ id: 'my-func', version: '1.0.0' })
        await mockKV.put('registry:my-func', JSON.stringify(original))

        const updated = await registry.update('my-func', { version: '1.1.0' })

        expect(updated.version).toBe('1.1.0')
        expect(updated.id).toBe('my-func')
        expect(updated.entryPoint).toBe('index.ts') // Unchanged
      })

      it('should update updatedAt timestamp on update', async () => {
        const original = createTestMetadata({
          id: 'my-func',
          updatedAt: '2024-01-01T00:00:00.000Z',
        })
        await mockKV.put('registry:my-func', JSON.stringify(original))

        const updated = await registry.update('my-func', { version: '2.0.0' })

        expect(updated.updatedAt).not.toBe('2024-01-01T00:00:00.000Z')
      })

      it('should preserve createdAt on update', async () => {
        const createdAt = '2024-01-01T00:00:00.000Z'
        const original = createTestMetadata({ id: 'my-func', createdAt })
        await mockKV.put('registry:my-func', JSON.stringify(original))

        const updated = await registry.update('my-func', { version: '2.0.0' })

        expect(updated.createdAt).toBe(createdAt)
      })

      it('should throw error when updating non-existent function', async () => {
        await expect(registry.update('non-existent', { version: '2.0.0' })).rejects.toThrow()
      })

      it('should update dependencies correctly', async () => {
        const original = createTestMetadata({
          id: 'my-func',
          dependencies: { lodash: '^4.17.21' },
        })
        await mockKV.put('registry:my-func', JSON.stringify(original))

        const updated = await registry.update('my-func', {
          dependencies: { lodash: '^4.17.21', axios: '~1.6.0' },
        })

        expect(updated.dependencies).toEqual({
          lodash: '^4.17.21',
          axios: '~1.6.0',
        })
      })

      it('should update language and entryPoint together', async () => {
        const original = createTestMetadata({
          id: 'my-func',
          language: 'typescript',
          entryPoint: 'index.ts',
        })
        await mockKV.put('registry:my-func', JSON.stringify(original))

        const updated = await registry.update('my-func', {
          language: 'rust',
          entryPoint: 'lib/main.rs',
        })

        expect(updated.language).toBe('rust')
        expect(updated.entryPoint).toBe('lib/main.rs')
      })

      it('should persist updated metadata to KV', async () => {
        const original = createTestMetadata({ id: 'my-func', version: '1.0.0' })
        await mockKV.put('registry:my-func', JSON.stringify(original))

        await registry.update('my-func', { version: '2.0.0' })

        const stored = (await mockKV.get('registry:my-func', 'json')) as FunctionMetadata
        expect(stored.version).toBe('2.0.0')
      })
    })

    describe('delete() - Deleting function metadata', () => {
      it('should delete function metadata by functionId', async () => {
        const metadata = createTestMetadata({ id: 'my-func' })
        await mockKV.put('registry:my-func', JSON.stringify(metadata))

        await registry.delete('my-func')

        const stored = await mockKV.get('registry:my-func', 'json')
        expect(stored).toBeNull()
      })

      it('should handle deleting non-existent function gracefully', async () => {
        // Should not throw
        await expect(registry.delete('non-existent')).resolves.toBeUndefined()
      })

      it('should not affect other functions when deleting', async () => {
        const func1 = createTestMetadata({ id: 'func-1' })
        const func2 = createTestMetadata({ id: 'func-2' })
        await mockKV.put('registry:func-1', JSON.stringify(func1))
        await mockKV.put('registry:func-2', JSON.stringify(func2))

        await registry.delete('func-1')

        const stored1 = await mockKV.get('registry:func-1', 'json')
        const stored2 = await mockKV.get('registry:func-2', 'json')
        expect(stored1).toBeNull()
        expect(stored2).not.toBeNull()
      })

      it('should also delete associated version entries', async () => {
        const metadata = createTestMetadata({ id: 'my-func' })
        await mockKV.put('registry:my-func', JSON.stringify(metadata))
        await mockKV.put('registry:my-func:v:1.0.0', JSON.stringify(metadata))
        await mockKV.put('registry:my-func:v:2.0.0', JSON.stringify({ ...metadata, version: '2.0.0' }))

        await registry.delete('my-func')

        const main = await mockKV.get('registry:my-func', 'json')
        const v1 = await mockKV.get('registry:my-func:v:1.0.0', 'json')
        const v2 = await mockKV.get('registry:my-func:v:2.0.0', 'json')

        expect(main).toBeNull()
        expect(v1).toBeNull()
        expect(v2).toBeNull()
      })
    })
  })

  describe('Version Management: registry:{functionId}:v:{version}', () => {
    describe('putVersion() - Storing version-specific metadata', () => {
      it('should store version metadata with key registry:{functionId}:v:{version}', async () => {
        const metadata = createTestMetadata({ id: 'my-func', version: '1.0.0' })

        await registry.putVersion('my-func', '1.0.0', metadata)

        const stored = await mockKV.get('registry:my-func:v:1.0.0', 'json')
        expect(stored).toMatchObject({
          id: 'my-func',
          version: '1.0.0',
        })
      })

      it('should store multiple versions independently', async () => {
        const v1 = createTestMetadata({ id: 'my-func', version: '1.0.0', dependencies: { v1: '1.0.0' } })
        const v2 = createTestMetadata({ id: 'my-func', version: '2.0.0', dependencies: { v2: '1.0.0' } })

        await registry.putVersion('my-func', '1.0.0', v1)
        await registry.putVersion('my-func', '2.0.0', v2)

        const storedV1 = (await mockKV.get('registry:my-func:v:1.0.0', 'json')) as FunctionMetadata
        const storedV2 = (await mockKV.get('registry:my-func:v:2.0.0', 'json')) as FunctionMetadata

        expect(storedV1.version).toBe('1.0.0')
        expect(storedV1.dependencies).toEqual({ v1: '1.0.0' })
        expect(storedV2.version).toBe('2.0.0')
        expect(storedV2.dependencies).toEqual({ v2: '1.0.0' })
      })

      it('should handle prerelease versions', async () => {
        const metadata = createTestMetadata({ id: 'my-func', version: '1.0.0-beta.1' })

        await registry.putVersion('my-func', '1.0.0-beta.1', metadata)

        const stored = await mockKV.get('registry:my-func:v:1.0.0-beta.1', 'json')
        expect(stored).toMatchObject({ version: '1.0.0-beta.1' })
      })

      it('should handle version with build metadata', async () => {
        const metadata = createTestMetadata({ id: 'my-func', version: '1.0.0+build.123' })

        await registry.putVersion('my-func', '1.0.0+build.123', metadata)

        const stored = await mockKV.get('registry:my-func:v:1.0.0+build.123', 'json')
        expect(stored).toMatchObject({ version: '1.0.0+build.123' })
      })

      it('should overwrite existing version', async () => {
        const original = createTestMetadata({ id: 'my-func', version: '1.0.0', dependencies: { old: '1.0.0' } })
        const updated = createTestMetadata({ id: 'my-func', version: '1.0.0', dependencies: { new: '2.0.0' } })

        await registry.putVersion('my-func', '1.0.0', original)
        await registry.putVersion('my-func', '1.0.0', updated)

        const stored = (await mockKV.get('registry:my-func:v:1.0.0', 'json')) as FunctionMetadata
        expect(stored.dependencies).toEqual({ new: '2.0.0' })
      })
    })

    describe('getVersion() - Retrieving version-specific metadata', () => {
      it('should retrieve version metadata by functionId and version', async () => {
        const metadata = createTestMetadata({ id: 'my-func', version: '1.0.0' })
        await mockKV.put('registry:my-func:v:1.0.0', JSON.stringify(metadata))

        const result = await registry.getVersion('my-func', '1.0.0')

        expect(result).toMatchObject({
          id: 'my-func',
          version: '1.0.0',
        })
      })

      it('should return null for non-existent version', async () => {
        const result = await registry.getVersion('my-func', '999.0.0')

        expect(result).toBeNull()
      })

      it('should return null for non-existent function', async () => {
        const result = await registry.getVersion('non-existent', '1.0.0')

        expect(result).toBeNull()
      })

      it('should retrieve correct version when multiple exist', async () => {
        const v1 = createTestMetadata({ id: 'my-func', version: '1.0.0', dependencies: { v1: '1.0.0' } })
        const v2 = createTestMetadata({ id: 'my-func', version: '2.0.0', dependencies: { v2: '1.0.0' } })
        const v3 = createTestMetadata({ id: 'my-func', version: '3.0.0', dependencies: { v3: '1.0.0' } })

        await mockKV.put('registry:my-func:v:1.0.0', JSON.stringify(v1))
        await mockKV.put('registry:my-func:v:2.0.0', JSON.stringify(v2))
        await mockKV.put('registry:my-func:v:3.0.0', JSON.stringify(v3))

        const result = await registry.getVersion('my-func', '2.0.0')

        expect(result?.version).toBe('2.0.0')
        expect(result?.dependencies).toEqual({ v2: '1.0.0' })
      })
    })

    describe('listVersions() - Listing all versions of a function', () => {
      it('should return empty array when no versions exist', async () => {
        const versions = await registry.listVersions('non-existent')

        expect(versions).toEqual([])
      })

      it('should list all versions of a function', async () => {
        const v1 = createTestMetadata({ id: 'my-func', version: '1.0.0' })
        const v2 = createTestMetadata({ id: 'my-func', version: '1.1.0' })
        const v3 = createTestMetadata({ id: 'my-func', version: '2.0.0' })

        await mockKV.put('registry:my-func:v:1.0.0', JSON.stringify(v1))
        await mockKV.put('registry:my-func:v:1.1.0', JSON.stringify(v2))
        await mockKV.put('registry:my-func:v:2.0.0', JSON.stringify(v3))

        const versions = await registry.listVersions('my-func')

        expect(versions).toContain('1.0.0')
        expect(versions).toContain('1.1.0')
        expect(versions).toContain('2.0.0')
        expect(versions).toHaveLength(3)
      })

      it('should return versions sorted descending (newest first)', async () => {
        const versions = ['1.0.0', '1.1.0', '2.0.0', '1.2.0', '3.0.0-beta.1']

        for (const version of versions) {
          const metadata = createTestMetadata({ id: 'my-func', version })
          await mockKV.put(`registry:my-func:v:${version}`, JSON.stringify(metadata))
        }

        const result = await registry.listVersions('my-func')

        // Should be sorted newest first
        expect(result[0]).toBe('3.0.0-beta.1')
        expect(result[1]).toBe('2.0.0')
        expect(result[2]).toBe('1.2.0')
        expect(result[3]).toBe('1.1.0')
        expect(result[4]).toBe('1.0.0')
      })

      it('should not include main entry in versions list', async () => {
        const metadata = createTestMetadata({ id: 'my-func', version: '1.0.0' })
        await mockKV.put('registry:my-func', JSON.stringify(metadata))
        await mockKV.put('registry:my-func:v:1.0.0', JSON.stringify(metadata))

        const versions = await registry.listVersions('my-func')

        // Should only include version entries, not the main entry
        expect(versions).toEqual(['1.0.0'])
      })

      it('should not include versions from other functions', async () => {
        await mockKV.put('registry:func-a:v:1.0.0', JSON.stringify(createTestMetadata({ id: 'func-a', version: '1.0.0' })))
        await mockKV.put('registry:func-b:v:2.0.0', JSON.stringify(createTestMetadata({ id: 'func-b', version: '2.0.0' })))

        const versionsA = await registry.listVersions('func-a')
        const versionsB = await registry.listVersions('func-b')

        expect(versionsA).toEqual(['1.0.0'])
        expect(versionsB).toEqual(['2.0.0'])
      })
    })

    describe('deleteVersion() - Deleting a specific version', () => {
      it('should delete a specific version', async () => {
        const v1 = createTestMetadata({ id: 'my-func', version: '1.0.0' })
        const v2 = createTestMetadata({ id: 'my-func', version: '2.0.0' })
        await mockKV.put('registry:my-func:v:1.0.0', JSON.stringify(v1))
        await mockKV.put('registry:my-func:v:2.0.0', JSON.stringify(v2))

        await registry.deleteVersion('my-func', '1.0.0')

        const deletedVersion = await mockKV.get('registry:my-func:v:1.0.0', 'json')
        const remainingVersion = await mockKV.get('registry:my-func:v:2.0.0', 'json')

        expect(deletedVersion).toBeNull()
        expect(remainingVersion).not.toBeNull()
      })

      it('should handle deleting non-existent version gracefully', async () => {
        await expect(registry.deleteVersion('my-func', '999.0.0')).resolves.toBeUndefined()
      })

      it('should not affect main entry when deleting version', async () => {
        const metadata = createTestMetadata({ id: 'my-func', version: '2.0.0' })
        await mockKV.put('registry:my-func', JSON.stringify(metadata))
        await mockKV.put('registry:my-func:v:1.0.0', JSON.stringify({ ...metadata, version: '1.0.0' }))

        await registry.deleteVersion('my-func', '1.0.0')

        const main = await mockKV.get('registry:my-func', 'json')
        expect(main).not.toBeNull()
      })
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty function ID gracefully', async () => {
      await expect(registry.get('')).rejects.toThrow()
    })

    it('should handle very long function IDs', async () => {
      const longId = 'a'.repeat(255)
      const metadata = createTestMetadata({ id: longId })

      await registry.put(metadata)

      const result = await registry.get(longId)
      expect(result?.id).toBe(longId)
    })

    it('should handle concurrent put operations', async () => {
      const promises = []
      for (let i = 0; i < 10; i++) {
        const metadata = createTestMetadata({ id: `func-${i}` })
        promises.push(registry.put(metadata))
      }

      await Promise.all(promises)

      for (let i = 0; i < 10; i++) {
        const result = await registry.get(`func-${i}`)
        expect(result?.id).toBe(`func-${i}`)
      }
    })

    it('should handle concurrent version operations', async () => {
      const functionId = 'concurrent-func'
      const promises = []

      for (let i = 0; i < 5; i++) {
        const version = `${i}.0.0`
        const metadata = createTestMetadata({ id: functionId, version })
        promises.push(registry.putVersion(functionId, version, metadata))
      }

      await Promise.all(promises)

      const versions = await registry.listVersions(functionId)
      expect(versions).toHaveLength(5)
    })

    it('should handle special characters in version strings', async () => {
      const versions = ['1.0.0-alpha', '1.0.0-beta.1', '1.0.0-rc.1+build.123']

      for (const version of versions) {
        const metadata = createTestMetadata({ id: 'my-func', version })
        await registry.putVersion('my-func', version, metadata)

        const result = await registry.getVersion('my-func', version)
        expect(result?.version).toBe(version)
      }
    })
  })

  describe('Key Format Validation', () => {
    it('should use registry: prefix for all keys', async () => {
      const metadata = createTestMetadata({ id: 'test-func' })

      await registry.put(metadata)
      await registry.putVersion('test-func', '1.0.0', metadata)

      const keys = await mockKV.list({ prefix: 'registry:' })
      expect(keys.keys.length).toBeGreaterThan(0)

      // All keys should start with registry:
      for (const key of keys.keys) {
        expect(key.name.startsWith('registry:')).toBe(true)
      }
    })

    it('should not use function: prefix (different from FunctionRegistry)', async () => {
      const metadata = createTestMetadata({ id: 'test-func' })

      await registry.put(metadata)

      const functionKeys = await mockKV.list({ prefix: 'function:' })
      expect(functionKeys.keys).toHaveLength(0)
    })

    it('should format version keys correctly as registry:{functionId}:v:{version}', async () => {
      const metadata = createTestMetadata({ id: 'test-func', version: '1.2.3' })

      await registry.putVersion('test-func', '1.2.3', metadata)

      const stored = await mockKV.get('registry:test-func:v:1.2.3', 'json')
      expect(stored).not.toBeNull()
    })
  })
})
