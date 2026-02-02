/**
 * Function Deployment Tests
 *
 * Tests for function deployment functionality via the FunctionRegistry class.
 * These tests validate:
 * - Creating functions with code and metadata
 * - Validating function ID format
 * - Validating supported languages
 * - Validating entry points
 * - Storing metadata in REGISTRY KV
 * - Versioning support (new version vs update)
 * - Rollback functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockKV } from '../test-utils/mock-kv'
import {
  FunctionRegistry,
  validateFunctionId,
  validateLanguage,
  validateEntryPoint,
  validateDependencies,
} from '../core/function-registry'
import type { FunctionMetadata } from '../core/types'

describe('Function Deployment via FunctionRegistry', () => {
  let mockRegistry: KVNamespace
  let registry: FunctionRegistry

  beforeEach(async () => {
    mockRegistry = createMockKV()
    registry = new FunctionRegistry(mockRegistry)
  })

  describe('Basic Deployment', () => {
    it('should create a new function with deploy()', async () => {
      const metadata = {
        id: 'my-function',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(metadata)

      const stored = await registry.get('my-function')
      expect(stored).toMatchObject({
        id: 'my-function',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
      })
      expect(stored?.createdAt).toBeDefined()
      expect(stored?.updatedAt).toBeDefined()
    })

    it('should store function metadata in REGISTRY KV', async () => {
      const metadata = {
        id: 'my-function',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: { lodash: '^4.17.21' },
      }

      await registry.deploy(metadata)

      // Verify the metadata was stored in KV
      const stored = await mockRegistry.get('function:my-function', 'json')
      expect(stored).toMatchObject({
        id: 'my-function',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: { lodash: '^4.17.21' },
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      })
    })

    it('should store version snapshot on deployment', async () => {
      const metadata = {
        id: 'my-function',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(metadata)

      // Verify version snapshot was stored
      const snapshot = await registry.getVersion('my-function', '1.0.0')
      expect(snapshot).toMatchObject({
        id: 'my-function',
        version: '1.0.0',
      })
    })

    it('should return deployment info with id, version from get()', async () => {
      const metadata = {
        id: 'my-function',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(metadata)

      const result = await registry.get('my-function')
      expect(result?.id).toBe('my-function')
      expect(result?.version).toBe('1.0.0')
      expect(result?.createdAt).toBeDefined()
      expect(result?.updatedAt).toBeDefined()
    })

    it('should set createdAt on new function', async () => {
      const metadata = {
        id: 'my-function',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(metadata)

      const result = await registry.get('my-function')
      expect(result?.createdAt).toBeDefined()
      const createdAt = new Date(result!.createdAt)
      expect(createdAt.getTime()).toBeGreaterThan(Date.now() - 5000)
    })

    it('should preserve createdAt and update updatedAt on function update', async () => {
      const initialMetadata = {
        id: 'my-function',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(initialMetadata)
      const initial = await registry.get('my-function')
      const initialCreatedAt = initial?.createdAt

      // Use fake timers to advance time deterministically, ensuring timestamps differ
      vi.useFakeTimers({ now: Date.now() })
      vi.advanceTimersByTime(100)

      const updatedMetadata = {
        ...initialMetadata,
        version: '1.1.0',
      }

      await registry.deploy(updatedMetadata)
      vi.useRealTimers()
      const updated = await registry.get('my-function')

      // createdAt should be preserved
      expect(updated?.createdAt).toBe(initialCreatedAt)
      // updatedAt should be newer
      expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThan(new Date(initial!.updatedAt).getTime())
    })
  })

  describe('Function ID Validation', () => {
    it('should validate function ID format - alphanumeric with hyphens/underscores', () => {
      // Valid IDs should not throw
      expect(() => validateFunctionId('my-function')).not.toThrow()
      expect(() => validateFunctionId('my_function')).not.toThrow()
      expect(() => validateFunctionId('myFunction123')).not.toThrow()
    })

    it('should reject function ID with leading hyphen', () => {
      expect(() => validateFunctionId('-my-function')).toThrow('Invalid function ID')
    })

    it('should reject function ID with trailing hyphen', () => {
      expect(() => validateFunctionId('my-function-')).toThrow('Invalid function ID')
    })

    it('should reject function ID with special characters', () => {
      expect(() => validateFunctionId('my@function')).toThrow('Invalid function ID')
      expect(() => validateFunctionId('my!function')).toThrow('Invalid function ID')
      expect(() => validateFunctionId('my$function')).toThrow('Invalid function ID')
    })

    it('should reject function ID exceeding 64 characters', () => {
      const longId = 'a'.repeat(65)
      expect(() => validateFunctionId(longId)).toThrow('Invalid function ID: ID must be 64 characters or less')
    })

    it('should reject empty function ID', () => {
      expect(() => validateFunctionId('')).toThrow('Invalid function ID: ID is required')
    })

    it('should accept valid function IDs', () => {
      // Single character
      expect(() => validateFunctionId('a')).not.toThrow()
      // With hyphens
      expect(() => validateFunctionId('my-func')).not.toThrow()
      // With underscores
      expect(() => validateFunctionId('my_func')).not.toThrow()
      // Mixed case with numbers
      expect(() => validateFunctionId('myFunc123')).not.toThrow()
      // All caps with hyphens
      expect(() => validateFunctionId('MY-FUNC-2')).not.toThrow()
    })
  })

  describe('Language Validation', () => {
    it('should validate language is supported', () => {
      expect(() => validateLanguage('typescript')).not.toThrow()
      expect(() => validateLanguage('javascript')).not.toThrow()
      expect(() => validateLanguage('rust')).not.toThrow()
      expect(() => validateLanguage('python')).not.toThrow()
      expect(() => validateLanguage('go')).not.toThrow()
    })

    it('should reject unsupported language', () => {
      expect(() => validateLanguage('ruby')).toThrow('Invalid language: must be one of')
    })

    it('should accept typescript language', () => {
      expect(() => validateLanguage('typescript')).not.toThrow()
    })

    it('should accept javascript language', () => {
      expect(() => validateLanguage('javascript')).not.toThrow()
    })

    it('should accept rust language', () => {
      expect(() => validateLanguage('rust')).not.toThrow()
    })

    it('should accept python language', () => {
      expect(() => validateLanguage('python')).not.toThrow()
    })

    it('should accept go language', () => {
      expect(() => validateLanguage('go')).not.toThrow()
    })

    it('should accept zig language', () => {
      expect(() => validateLanguage('zig')).not.toThrow()
    })

    it('should accept assemblyscript language', () => {
      expect(() => validateLanguage('assemblyscript')).not.toThrow()
    })

    it('should accept csharp language', () => {
      expect(() => validateLanguage('csharp')).not.toThrow()
    })

    it('should reject empty language', () => {
      expect(() => validateLanguage('')).toThrow('Invalid language: language is required')
    })

    it('should reject deploy with missing/invalid language', async () => {
      const metadata = {
        id: 'my-function',
        version: '1.0.0',
        language: '' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await expect(registry.deploy(metadata as any)).rejects.toThrow('Invalid language')
    })
  })

  describe('Entry Point Validation', () => {
    it('should validate entry point has valid extension', () => {
      expect(() => validateEntryPoint('index.ts')).not.toThrow()
      expect(() => validateEntryPoint('src/main.ts')).not.toThrow()
    })

    it('should reject entry point with absolute path', () => {
      expect(() => validateEntryPoint('/index.ts')).toThrow('Invalid entry point: must be a relative path')
    })

    it('should reject entry point with parent directory reference', () => {
      expect(() => validateEntryPoint('../index.ts')).toThrow('Invalid entry point: must be a relative path')
    })

    it('should reject entry point with invalid characters', () => {
      expect(() => validateEntryPoint('index<>.ts')).toThrow('Invalid entry point')
    })

    it('should reject entry point without file extension', () => {
      expect(() => validateEntryPoint('index')).toThrow('Invalid entry point: must be a valid file path with extension')
    })

    it('should accept valid entry point paths', () => {
      expect(() => validateEntryPoint('index.ts')).not.toThrow()
      expect(() => validateEntryPoint('src/main.ts')).not.toThrow()
      expect(() => validateEntryPoint('lib/utils/helper.js')).not.toThrow()
    })

    it('should reject empty entry point', () => {
      expect(() => validateEntryPoint('')).toThrow('Invalid entry point: entry point is required')
    })

    it('should reject deploy with missing entry point', async () => {
      const metadata = {
        id: 'my-function',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: '',
        dependencies: {},
      }

      await expect(registry.deploy(metadata)).rejects.toThrow('Invalid entry point')
    })
  })

  describe('Versioning', () => {
    it('should validate semantic version format', async () => {
      const metadata = {
        id: 'my-function',
        version: 'invalid',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await expect(registry.deploy(metadata)).rejects.toThrow('Invalid semantic version')
    })

    it('should create new version on first deployment', async () => {
      const metadata = {
        id: 'my-function',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(metadata)

      const versions = await registry.getVersions('my-function')
      expect(versions).toContain('1.0.0')
    })

    it('should store version history', async () => {
      const metadata = {
        id: 'my-function',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy({ ...metadata, version: '1.0.0' })
      await registry.deploy({ ...metadata, version: '1.1.0' })

      const history = await registry.getDeploymentHistory('my-function')
      expect(history.length).toBe(2)
      expect(history[0]?.version).toBe('1.1.0') // Newest first
      expect(history[1]?.version).toBe('1.0.0')
    })

    it('should store version snapshots', async () => {
      const metadata = {
        id: 'my-function',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy({ ...metadata, version: '1.0.0' })
      await registry.deploy({ ...metadata, version: '1.1.0' })

      const v1 = await registry.getVersion('my-function', '1.0.0')
      const v2 = await registry.getVersion('my-function', '1.1.0')

      expect(v1?.version).toBe('1.0.0')
      expect(v2?.version).toBe('1.1.0')
    })

    it('should allow deploying same version multiple times (records in history)', async () => {
      const metadata = {
        id: 'my-function',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(metadata)
      await registry.deploy(metadata)
      await registry.deploy(metadata)

      // Version list should only have one entry
      const versions = await registry.getVersions('my-function')
      expect(versions).toEqual(['1.0.0'])

      // But deployment history should have 3 entries
      const history = await registry.getDeploymentHistory('my-function')
      expect(history.length).toBe(3)
    })

    it('should allow updating with higher version', async () => {
      const metadata = {
        id: 'my-function',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy({ ...metadata, version: '1.0.0' })
      await registry.deploy({ ...metadata, version: '1.0.1' })

      const current = await registry.get('my-function')
      expect(current?.version).toBe('1.0.1')
    })

    it('should support prerelease versions', async () => {
      const metadata = {
        id: 'my-function',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy({ ...metadata, version: '1.0.0-alpha.1' })
      await registry.deploy({ ...metadata, version: '1.0.0-beta.1' })
      await registry.deploy({ ...metadata, version: '1.0.0-rc.1' })

      const versions = await registry.getVersions('my-function')
      expect(versions).toContain('1.0.0-alpha.1')
      expect(versions).toContain('1.0.0-beta.1')
      expect(versions).toContain('1.0.0-rc.1')
    })

    it('should support build metadata in versions', async () => {
      const metadata = {
        id: 'my-function',
        version: '1.0.0+build.123',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(metadata)

      const result = await registry.get('my-function')
      expect(result?.version).toBe('1.0.0+build.123')
    })

    it('should update current version pointer on deployment', async () => {
      const metadata = {
        id: 'my-function',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy({ ...metadata, version: '1.0.0' })
      let current = await registry.get('my-function')
      expect(current?.version).toBe('1.0.0')

      await registry.deploy({ ...metadata, version: '2.0.0' })
      current = await registry.get('my-function')
      expect(current?.version).toBe('2.0.0')
    })
  })

  describe('Request Validation', () => {
    it('should require all mandatory fields (id, language, entryPoint, version)', async () => {
      // Missing id
      await expect(
        registry.deploy({
          id: '',
          version: '1.0.0',
          language: 'typescript' as const,
          entryPoint: 'index.ts',
          dependencies: {},
        })
      ).rejects.toThrow('Invalid function ID')

      // Missing language (or invalid)
      await expect(
        registry.deploy({
          id: 'my-func',
          version: '1.0.0',
          language: '' as any,
          entryPoint: 'index.ts',
          dependencies: {},
        })
      ).rejects.toThrow('Invalid language')

      // Missing entryPoint
      await expect(
        registry.deploy({
          id: 'my-func',
          version: '1.0.0',
          language: 'typescript' as const,
          entryPoint: '',
          dependencies: {},
        })
      ).rejects.toThrow('Invalid entry point')

      // Invalid version
      await expect(
        registry.deploy({
          id: 'my-func',
          version: 'invalid',
          language: 'typescript' as const,
          entryPoint: 'index.ts',
          dependencies: {},
        })
      ).rejects.toThrow('Invalid semantic version')
    })

    it('should reject request with missing id', async () => {
      await expect(
        registry.deploy({
          id: '',
          version: '1.0.0',
          language: 'typescript' as const,
          entryPoint: 'index.ts',
          dependencies: {},
        })
      ).rejects.toThrow('Invalid function ID')
    })

    it('should reject request with missing version', async () => {
      await expect(
        registry.deploy({
          id: 'my-func',
          version: '',
          language: 'typescript' as const,
          entryPoint: 'index.ts',
          dependencies: {},
        })
      ).rejects.toThrow('Invalid semantic version')
    })

    it('should validate dependencies format', () => {
      // Valid dependencies
      expect(() => validateDependencies({ lodash: '^4.17.21' })).not.toThrow()
      expect(() => validateDependencies({ axios: '~1.6.0' })).not.toThrow()

      // Invalid dependencies
      expect(() => validateDependencies({ lodash: 'not-a-version' })).toThrow('Invalid dependencies')
    })

    it('should reject invalid dependency version format', () => {
      expect(() => validateDependencies({ lodash: 'invalid' })).toThrow(
        'Invalid dependencies: "lodash" has invalid semver version "invalid"'
      )
    })

    it('should accept valid dependency declarations', () => {
      expect(() => validateDependencies({ lodash: '^4.17.21', axios: '~1.6.0' })).not.toThrow()
    })
  })

  describe('Rollback Support', () => {
    it('should rollback to a previous version', async () => {
      const metadata = {
        id: 'my-function',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy({ ...metadata, version: '1.0.0', dependencies: { old: '1.0.0' } })
      await registry.deploy({ ...metadata, version: '2.0.0', dependencies: { new: '2.0.0' } })

      // Current should be 2.0.0
      let current = await registry.get('my-function')
      expect(current?.version).toBe('2.0.0')

      // Rollback to 1.0.0
      await registry.rollback('my-function', '1.0.0')

      // Current should now be 1.0.0
      current = await registry.get('my-function')
      expect(current?.version).toBe('1.0.0')
      expect(current?.dependencies).toEqual({ old: '1.0.0' })
    })

    it('should record rollback in deployment history', async () => {
      const metadata = {
        id: 'my-function',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy({ ...metadata, version: '1.0.0' })
      await registry.deploy({ ...metadata, version: '2.0.0' })
      await registry.rollback('my-function', '1.0.0')

      const history = await registry.getDeploymentHistory('my-function')
      expect(history.length).toBe(3) // Deploy 1.0.0, deploy 2.0.0, rollback to 1.0.0
      expect(history[0]?.version).toBe('1.0.0') // Rollback is newest
    })

    it('should throw error when rolling back to non-existent version', async () => {
      const metadata = {
        id: 'my-function',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(metadata)

      await expect(registry.rollback('my-function', '2.0.0')).rejects.toThrow(
        'Version 2.0.0 not found for function my-function'
      )
    })
  })

  describe('Function Deletion', () => {
    it('should delete function and all versions', async () => {
      const metadata = {
        id: 'my-function',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy({ ...metadata, version: '1.0.0' })
      await registry.deploy({ ...metadata, version: '1.1.0' })

      await registry.delete('my-function')

      // Function should be gone
      const result = await registry.get('my-function')
      expect(result).toBeNull()

      // Version snapshots should be gone
      const v1 = await registry.getVersion('my-function', '1.0.0')
      const v2 = await registry.getVersion('my-function', '1.1.0')
      expect(v1).toBeNull()
      expect(v2).toBeNull()

      // History should be empty
      const history = await registry.getDeploymentHistory('my-function')
      expect(history).toEqual([])
    })

    it('should return 404 for non-existent function on get', async () => {
      const result = await registry.get('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('Function List', () => {
    it('should list all functions for authenticated user', async () => {
      await registry.deploy({
        id: 'func-1',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      })

      await registry.deploy({
        id: 'func-2',
        version: '1.0.0',
        language: 'python' as const,
        entryPoint: 'main.py',
        dependencies: {},
      })

      const functions = await registry.list()
      expect(functions.length).toBe(2)
      expect(functions.map((f) => f.id)).toContain('func-1')
      expect(functions.map((f) => f.id)).toContain('func-2')
    })

    it('should return empty array when no functions deployed', async () => {
      const functions = await registry.list()
      expect(functions).toEqual([])
    })
  })

  describe('Update Existing Function', () => {
    it('should update existing function metadata', async () => {
      const initialMetadata = {
        id: 'my-function',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: { v1: '1.0.0' },
      }

      await registry.deploy(initialMetadata)

      const updatedMetadata = {
        id: 'my-function',
        version: '1.1.0',
        language: 'typescript' as const,
        entryPoint: 'src/index.ts',
        dependencies: { v2: '2.0.0' },
      }

      await registry.deploy(updatedMetadata)

      const result = await registry.get('my-function')
      expect(result?.version).toBe('1.1.0')
      expect(result?.entryPoint).toBe('src/index.ts')
      expect(result?.dependencies).toEqual({ v2: '2.0.0' })
    })

    it('should preserve function history on update', async () => {
      const metadata = {
        id: 'my-function',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy({ ...metadata, version: '1.0.0' })
      await registry.deploy({ ...metadata, version: '1.1.0' })
      await registry.deploy({ ...metadata, version: '2.0.0' })

      // All versions should remain accessible
      const v1 = await registry.getVersion('my-function', '1.0.0')
      const v2 = await registry.getVersion('my-function', '1.1.0')
      const v3 = await registry.getVersion('my-function', '2.0.0')

      expect(v1?.version).toBe('1.0.0')
      expect(v2?.version).toBe('1.1.0')
      expect(v3?.version).toBe('2.0.0')
    })
  })
})
