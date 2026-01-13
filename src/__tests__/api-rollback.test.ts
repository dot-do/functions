/**
 * Function Rollback Tests
 *
 * Tests for the FunctionRegistry.rollback() method and related functionality.
 * This tests rolling back a function to a previously deployed version.
 *
 * Features tested:
 * - Rolling back to a previous version
 * - Updating the active version in registry
 * - Recording rollback in deployment history
 * - Version validation
 * - Function validation
 * - Edge cases (single version, many versions, pre-release versions)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockKV } from '../test-utils/mock-kv'
import { FunctionRegistry } from '../core/function-registry'
import type { FunctionMetadata } from '../core/types'

/**
 * Create test function metadata
 */
function createTestMetadata(
  overrides: Partial<Omit<FunctionMetadata, 'createdAt' | 'updatedAt'>> = {}
): Omit<FunctionMetadata, 'createdAt' | 'updatedAt'> {
  return {
    id: 'test-function',
    version: '1.0.0',
    language: 'typescript',
    entryPoint: 'index.ts',
    dependencies: {},
    ...overrides,
  }
}

describe('Function Rollback: FunctionRegistry.rollback()', () => {
  let mockRegistryKV: KVNamespace
  let registry: FunctionRegistry

  beforeEach(() => {
    mockRegistryKV = createMockKV()
    registry = new FunctionRegistry(mockRegistryKV)
  })

  describe('Successful Rollback', () => {
    it('should roll back function to specified version', async () => {
      // Setup: Deploy v1.0.0, then v2.0.0
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '2.0.0' }))

      // Verify current version is 2.0.0
      let current = await registry.get('my-func')
      expect(current?.version).toBe('2.0.0')

      // Rollback to 1.0.0
      const result = await registry.rollback('my-func', '1.0.0')

      // Verify rollback result
      expect(result.id).toBe('my-func')
      expect(result.version).toBe('1.0.0')

      // Verify current version is now 1.0.0
      current = await registry.get('my-func')
      expect(current?.version).toBe('1.0.0')
    })

    it('should update the active version in registry', async () => {
      // Deploy multiple versions
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0', dependencies: { v1: '1.0.0' } }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '2.0.0', dependencies: { v2: '1.0.0' } }))

      // Rollback to 1.0.0
      await registry.rollback('my-func', '1.0.0')

      // registry.get() should now return v1.0.0
      const stored = await registry.get('my-func')
      expect(stored).toBeDefined()
      expect(stored?.version).toBe('1.0.0')
      expect(stored?.dependencies).toEqual({ v1: '1.0.0' })
    })

    it('should return rollback confirmation with version details', async () => {
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '2.0.0' }))

      const result = await registry.rollback('my-func', '1.0.0')

      // Result should include version details
      expect(result.id).toBe('my-func')
      expect(result.version).toBe('1.0.0')
      expect(result.language).toBe('typescript')
      expect(result.entryPoint).toBe('index.ts')
    })

    it('should include rollback timestamp in response', async () => {
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '2.0.0' }))

      const beforeRollback = new Date().toISOString()
      const result = await registry.rollback('my-func', '1.0.0')
      const afterRollback = new Date().toISOString()

      // updatedAt should be within the time range of the rollback
      expect(result.updatedAt).toBeDefined()
      expect(result.updatedAt >= beforeRollback).toBe(true)
      expect(result.updatedAt <= afterRollback).toBe(true)
    })

    it('should support rolling back to any previous version', async () => {
      // Deploy versions: 1.0.0, 1.1.0, 2.0.0, 2.1.0 (current)
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.1.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '2.0.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '2.1.0' }))

      // Can roll back to 1.0.0
      let result = await registry.rollback('my-func', '1.0.0')
      expect(result.version).toBe('1.0.0')

      // Can roll back to 1.1.0
      result = await registry.rollback('my-func', '1.1.0')
      expect(result.version).toBe('1.1.0')

      // Can roll back to 2.0.0
      result = await registry.rollback('my-func', '2.0.0')
      expect(result.version).toBe('2.0.0')
    })
  })

  describe('Version Validation', () => {
    it('should throw error for non-existent version', async () => {
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))

      await expect(registry.rollback('my-func', '99.0.0')).rejects.toThrow(
        'Version 99.0.0 not found for function my-func'
      )
    })

    it('should allow rollback to current version (no-op but allowed)', async () => {
      // Note: The current implementation allows rollback to current version
      // This records it in history, which may be intentional for audit purposes
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))

      // Rollback to current version (1.0.0)
      const result = await registry.rollback('my-func', '1.0.0')
      expect(result.version).toBe('1.0.0')
    })
  })

  describe('Function Validation', () => {
    it('should throw error for non-existent function', async () => {
      await expect(registry.rollback('non-existent-func', '1.0.0')).rejects.toThrow(
        'Version 1.0.0 not found for function non-existent-func'
      )
    })

    it('should throw error when function has been deleted', async () => {
      // Deploy then delete
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))
      await registry.delete('my-func')

      // Rollback should fail because function no longer exists
      await expect(registry.rollback('my-func', '1.0.0')).rejects.toThrow(
        'Version 1.0.0 not found for function my-func'
      )
    })
  })

  describe('Rollback History Recording', () => {
    it('should record rollback in deployment history', async () => {
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '2.0.0' }))
      await registry.rollback('my-func', '1.0.0')

      const history = await registry.getDeploymentHistory('my-func')

      // History should have 3 entries: initial deploy, second deploy, rollback
      expect(history).toHaveLength(3)
      // Most recent (rollback) is first
      expect(history[0]?.version).toBe('1.0.0')
      expect(history[1]?.version).toBe('2.0.0')
      expect(history[2]?.version).toBe('1.0.0')
    })

    it('should maintain chronological order in history', async () => {
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '2.0.0' }))
      await registry.rollback('my-func', '1.0.0')
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '3.0.0' }))
      await registry.rollback('my-func', '2.0.0')

      const history = await registry.getDeploymentHistory('my-func')

      // Newest first: 2.0.0 (rollback), 3.0.0, 1.0.0 (rollback), 2.0.0, 1.0.0
      expect(history).toHaveLength(5)
      expect(history[0]?.version).toBe('2.0.0') // Most recent rollback
      expect(history[1]?.version).toBe('3.0.0')
      expect(history[2]?.version).toBe('1.0.0') // First rollback
      expect(history[3]?.version).toBe('2.0.0')
      expect(history[4]?.version).toBe('1.0.0')
    })

    it('should retrieve rollback history via getDeploymentHistory', async () => {
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '2.0.0' }))
      await registry.rollback('my-func', '1.0.0')

      const history = await registry.getDeploymentHistory('my-func')

      expect(history).toHaveLength(3)
      // Each record should have deployedAt and metadata
      for (const record of history) {
        expect(record.deployedAt).toBeDefined()
        expect(record.metadata).toBeDefined()
        expect(record.metadata.id).toBe('my-func')
      }
    })
  })

  describe('Rollback Verification', () => {
    it('should restore all metadata from target version', async () => {
      // Deploy v1 with specific metadata
      await registry.deploy(
        createTestMetadata({
          id: 'my-func',
          version: '1.0.0',
          dependencies: { lodash: '^4.17.21' },
          entryPoint: 'v1/index.ts',
        })
      )

      // Deploy v2 with different metadata
      await registry.deploy(
        createTestMetadata({
          id: 'my-func',
          version: '2.0.0',
          dependencies: { axios: '^1.6.0' },
          entryPoint: 'v2/main.ts',
        })
      )

      // Rollback to v1
      const result = await registry.rollback('my-func', '1.0.0')

      // Should have v1's metadata
      expect(result.version).toBe('1.0.0')
      expect(result.dependencies).toEqual({ lodash: '^4.17.21' })
      expect(result.entryPoint).toBe('v1/index.ts')
    })

    it('should preserve createdAt from original deployment', async () => {
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))
      const originalMetadata = await registry.get('my-func')
      const originalCreatedAt = originalMetadata?.createdAt

      // Deploy v2
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '2.0.0' }))

      // Rollback to v1
      const result = await registry.rollback('my-func', '1.0.0')

      // createdAt should be preserved from original
      expect(result.createdAt).toBe(originalCreatedAt)
    })
  })

  describe('Edge Cases', () => {
    it('should handle function with only one version', async () => {
      // Deploy only one version
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))

      // Rollback to the same version is allowed (no previous version to compare)
      const result = await registry.rollback('my-func', '1.0.0')
      expect(result.version).toBe('1.0.0')

      // Rollback to non-existent version should fail
      await expect(registry.rollback('my-func', '0.9.0')).rejects.toThrow(
        'Version 0.9.0 not found for function my-func'
      )
    })

    it('should handle rollback of function with many versions', async () => {
      // Deploy 100+ versions
      for (let i = 1; i <= 100; i++) {
        await registry.deploy(createTestMetadata({ id: 'my-func', version: `1.0.${i}` }))
      }

      // Rollback to an early version
      const result = await registry.rollback('my-func', '1.0.1')
      expect(result.version).toBe('1.0.1')

      // Verify current version is now 1.0.1
      const current = await registry.get('my-func')
      expect(current?.version).toBe('1.0.1')
    })

    it('should handle pre-release versions in rollback', async () => {
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0-beta.1' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0-beta.2' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))

      // Rollback to pre-release version
      const result = await registry.rollback('my-func', '1.0.0-beta.1')
      expect(result.version).toBe('1.0.0-beta.1')
    })

    it('should handle versions with build metadata', async () => {
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0+build.123' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0+build.456' }))

      // Rollback to version with build metadata
      const result = await registry.rollback('my-func', '1.0.0+build.123')
      expect(result.version).toBe('1.0.0+build.123')
    })
  })

  describe('Rollback Integration with Function Lifecycle', () => {
    it('should allow re-deployment after rollback', async () => {
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '2.0.0' }))

      // Rollback to v1.0.0
      await registry.rollback('my-func', '1.0.0')
      expect((await registry.get('my-func'))?.version).toBe('1.0.0')

      // Deploy v3.0.0
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '3.0.0' }))
      expect((await registry.get('my-func'))?.version).toBe('3.0.0')
    })

    it('should allow multiple sequential rollbacks', async () => {
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '2.0.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '3.0.0' }))

      // Rollback from v3.0.0 to v2.0.0
      await registry.rollback('my-func', '2.0.0')
      expect((await registry.get('my-func'))?.version).toBe('2.0.0')

      // Rollback from v2.0.0 to v1.0.0
      await registry.rollback('my-func', '1.0.0')
      expect((await registry.get('my-func'))?.version).toBe('1.0.0')
    })

    it('should allow rollback to a version that was previously rolled back from', async () => {
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '2.0.0' }))

      // Rollback v2.0.0 -> v1.0.0
      await registry.rollback('my-func', '1.0.0')
      expect((await registry.get('my-func'))?.version).toBe('1.0.0')

      // Rollback back to v2.0.0
      await registry.rollback('my-func', '2.0.0')
      expect((await registry.get('my-func'))?.version).toBe('2.0.0')
    })

    it('should preserve all version metadata after rollback', async () => {
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '2.0.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '3.0.0' }))

      // Rollback to v1.0.0
      await registry.rollback('my-func', '1.0.0')

      // All versions should still be accessible
      const v1 = await registry.getVersion('my-func', '1.0.0')
      const v2 = await registry.getVersion('my-func', '2.0.0')
      const v3 = await registry.getVersion('my-func', '3.0.0')

      expect(v1?.version).toBe('1.0.0')
      expect(v2?.version).toBe('2.0.0')
      expect(v3?.version).toBe('3.0.0')

      // Versions list should still include all versions
      const versions = await registry.getVersions('my-func')
      expect(versions).toContain('1.0.0')
      expect(versions).toContain('2.0.0')
      expect(versions).toContain('3.0.0')
    })
  })

  describe('Version List After Rollback', () => {
    it('should not add duplicate versions when rolling back', async () => {
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '2.0.0' }))

      // Rollback to v1.0.0 multiple times
      await registry.rollback('my-func', '1.0.0')
      await registry.rollback('my-func', '2.0.0')
      await registry.rollback('my-func', '1.0.0')

      // Versions list should not have duplicates
      const versions = await registry.getVersions('my-func')
      const uniqueVersions = [...new Set(versions)]
      expect(versions.length).toBe(uniqueVersions.length)
      expect(versions).toContain('1.0.0')
      expect(versions).toContain('2.0.0')
    })

    it('should maintain version sort order after rollback', async () => {
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.0.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '1.1.0' }))
      await registry.deploy(createTestMetadata({ id: 'my-func', version: '2.0.0' }))

      await registry.rollback('my-func', '1.0.0')

      // Versions should still be sorted descending
      const versions = await registry.getVersions('my-func')
      expect(versions).toEqual(['2.0.0', '1.1.0', '1.0.0'])
    })
  })
})
