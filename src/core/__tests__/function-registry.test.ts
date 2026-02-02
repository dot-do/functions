import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  FunctionRegistry,
  validateFunctionId,
  validateEntryPoint,
  validateLanguage,
  validateDependencies,
  validateMetadata,
} from '../function-registry'
import { createMockKV } from '../../test-utils/mock-kv'
import { parseVersion, compareVersions, isValidVersion } from '../types'

/**
 * FailingMockKV - A mock KV that can simulate various failure scenarios
 * Used for testing network partitions, partial writes, and transient failures
 */
type FailureMode = 'none' | 'get' | 'put' | 'list' | 'delete' | 'all'

class FailingMockKV {
  private store = new Map<string, { value: string; metadata: unknown; expiration?: number }>()
  private failureMode: FailureMode = 'none'
  private failureCount = 0
  private operationCount = 0 // Track total operations for delayed failure mode
  private maxFailures = Infinity
  private failureError = 'KV operation failed'
  private delay = 0
  private successesBeforeFailure = 0 // Number of successes before starting to fail

  /**
   * Set the failure mode for the mock KV
   * @param mode - Which operation(s) should fail
   * @param maxFailures - Number of failures before succeeding (default: Infinity)
   * @param errorMessage - Custom error message
   */
  setFailureMode(mode: FailureMode, maxFailures = Infinity, errorMessage = 'KV operation failed'): void {
    this.failureMode = mode
    this.maxFailures = maxFailures
    this.failureCount = 0
    this.operationCount = 0
    this.successesBeforeFailure = 0
    this.failureError = errorMessage
  }

  /**
   * Set failure mode with successes before failure pattern
   * Useful for testing partial writes where N operations succeed before failure
   * @param mode - Which operation(s) should fail
   * @param successCount - Number of successful operations before failure starts
   * @param failureCount - Number of failures after successes (default: Infinity)
   * @param errorMessage - Custom error message
   */
  setDelayedFailureMode(
    mode: FailureMode,
    successCount: number,
    failureCount = Infinity,
    errorMessage = 'KV operation failed'
  ): void {
    this.failureMode = mode
    this.successesBeforeFailure = successCount
    this.maxFailures = failureCount
    this.failureCount = 0
    this.operationCount = 0
    this.failureError = errorMessage
  }

  /**
   * Set a delay for all operations (simulates network latency/timeout)
   * @param ms - Delay in milliseconds
   */
  setDelay(ms: number): void {
    this.delay = ms
  }

  /**
   * Reset the mock to its initial state
   */
  reset(): void {
    this.store.clear()
    this.failureMode = 'none'
    this.failureCount = 0
    this.operationCount = 0
    this.maxFailures = Infinity
    this.successesBeforeFailure = 0
    this.failureError = 'KV operation failed'
    this.delay = 0
  }

  /**
   * Get the current number of failures that have occurred
   */
  getFailureCount(): number {
    return this.failureCount
  }

  private shouldFail(operation: 'get' | 'put' | 'list' | 'delete'): boolean {
    if (this.failureMode === 'none') return false
    if (this.failureMode !== 'all' && this.failureMode !== operation) return false

    this.operationCount++

    // If we haven't used up all successes yet, don't fail
    if (this.operationCount <= this.successesBeforeFailure) {
      return false
    }

    // After successes, check if we should fail
    if (this.failureCount >= this.maxFailures) return false
    this.failureCount++
    return true
  }

  private async maybeDelay(): Promise<void> {
    if (this.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delay))
    }
  }

  async get(key: string, options?: KVNamespaceGetOptions<'text'> | 'text'): Promise<string | null>
  async get(key: string, options: KVNamespaceGetOptions<'json'> | 'json'): Promise<unknown>
  async get(key: string, options: KVNamespaceGetOptions<'arrayBuffer'> | 'arrayBuffer'): Promise<ArrayBuffer | null>
  async get(key: string, options: KVNamespaceGetOptions<'stream'> | 'stream'): Promise<ReadableStream | null>
  async get(
    key: string,
    options?: KVNamespaceGetOptions<'text' | 'json' | 'arrayBuffer' | 'stream'> | 'text' | 'json' | 'arrayBuffer' | 'stream'
  ): Promise<string | object | ArrayBuffer | ReadableStream | null> {
    await this.maybeDelay()
    if (this.shouldFail('get')) {
      throw new Error(this.failureError)
    }

    const entry = this.store.get(key)
    if (!entry) return null

    // Check expiration
    if (entry.expiration && Date.now() / 1000 > entry.expiration) {
      this.store.delete(key)
      return null
    }

    const type = typeof options === 'string' ? options : options?.type
    if (type === 'json') {
      return JSON.parse(entry.value) as object
    }
    if (type === 'arrayBuffer') {
      return new TextEncoder().encode(entry.value).buffer
    }
    if (type === 'stream') {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(entry.value))
          controller.close()
        },
      })
    }
    return entry.value
  }

  async put(key: string, value: string | ArrayBuffer | ReadableStream, options?: KVNamespacePutOptions): Promise<void> {
    await this.maybeDelay()
    if (this.shouldFail('put')) {
      throw new Error(this.failureError)
    }

    let stringValue: string
    if (typeof value === 'string') {
      stringValue = value
    } else if (value instanceof ArrayBuffer) {
      stringValue = new TextDecoder().decode(value)
    } else {
      const reader = value.getReader()
      const chunks: Uint8Array[] = []
      let done = false
      while (!done) {
        const result = await reader.read()
        if (result.value) chunks.push(result.value)
        done = result.done
      }
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
      const combined = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.length
      }
      stringValue = new TextDecoder().decode(combined)
    }

    let expiration: number | undefined
    if (options?.expiration) {
      expiration = options.expiration
    } else if (options?.expirationTtl) {
      expiration = Math.floor(Date.now() / 1000) + options.expirationTtl
    }

    const entryToStore: { value: string; metadata: unknown; expiration?: number } = {
      value: stringValue,
      metadata: options?.metadata ?? null,
    }
    if (expiration !== undefined) {
      entryToStore.expiration = expiration
    }
    this.store.set(key, entryToStore)
  }

  async delete(key: string): Promise<void> {
    await this.maybeDelay()
    if (this.shouldFail('delete')) {
      throw new Error(this.failureError)
    }
    this.store.delete(key)
  }

  async list(options?: KVNamespaceListOptions): Promise<KVNamespaceListResult<unknown, string>> {
    await this.maybeDelay()
    if (this.shouldFail('list')) {
      throw new Error(this.failureError)
    }

    const prefix = options?.prefix ?? ''
    const limit = options?.limit ?? 1000
    const cursor = options?.cursor ?? ''

    const keys: KVNamespaceListKey<unknown, string>[] = []
    const now = Date.now() / 1000

    for (const [key, entry] of this.store) {
      if (entry.expiration && now > entry.expiration) {
        this.store.delete(key)
        continue
      }
      if (key.startsWith(prefix)) {
        const keyEntry: KVNamespaceListKey<unknown, string> = {
          name: key,
        }
        if (entry.expiration !== undefined) {
          keyEntry.expiration = entry.expiration
        }
        if (entry.metadata !== undefined && entry.metadata !== null) {
          keyEntry.metadata = entry.metadata
        }
        keys.push(keyEntry)
      }
    }

    keys.sort((a, b) => a.name.localeCompare(b.name))

    const startIndex = cursor ? parseInt(cursor, 10) : 0
    const endIndex = startIndex + limit
    const slicedKeys = keys.slice(startIndex, endIndex)
    const hasMore = endIndex < keys.length

    if (hasMore) {
      return {
        keys: slicedKeys,
        list_complete: false,
        cursor: String(endIndex),
        cacheStatus: null,
      }
    }
    return {
      keys: slicedKeys,
      list_complete: true,
      cacheStatus: null,
    }
  }

  async getWithMetadata<Metadata = unknown>(
    key: string,
    options?: KVNamespaceGetOptions<'text' | 'json' | 'arrayBuffer' | 'stream'> | 'text' | 'json' | 'arrayBuffer' | 'stream'
  ): Promise<KVNamespaceGetWithMetadataResult<string | object | ArrayBuffer | ReadableStream | null, Metadata>> {
    await this.maybeDelay()
    if (this.shouldFail('get')) {
      throw new Error(this.failureError)
    }

    const entry = this.store.get(key)
    if (!entry) {
      return { value: null, metadata: null, cacheStatus: null }
    }

    const type = typeof options === 'string' ? options : options?.type
    let value: string | object | ArrayBuffer | ReadableStream | null = entry.value
    if (type === 'json') {
      value = JSON.parse(entry.value) as object
    }

    return {
      value,
      metadata: (entry.metadata as Metadata) ?? null,
      cacheStatus: null,
    }
  }
}

describe('FunctionRegistry', () => {
  let registry: FunctionRegistry
  let mockKV: KVNamespace

  beforeEach(() => {
    mockKV = createMockKV()
    registry = new FunctionRegistry(mockKV)
  })

  describe('deploy()', () => {
    it('should store function metadata', async () => {
      const metadata = {
        id: 'my-func',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {
          lodash: '^4.17.21',
        },
      }

      await registry.deploy(metadata)

      // Verify the metadata was stored in KV
      const stored = await mockKV.get('function:my-func', 'json')
      expect(stored).toEqual({
        ...metadata,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      })
    })

    it('should update existing function metadata on redeploy', async () => {
      const initialMetadata = {
        id: 'my-func',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      const updatedMetadata = {
        id: 'my-func',
        version: '1.1.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {
          axios: '^1.6.0',
        },
      }

      await registry.deploy(initialMetadata)
      await registry.deploy(updatedMetadata)

      const stored = await mockKV.get('function:my-func', 'json')
      expect(stored).toMatchObject({
        id: 'my-func',
        version: '1.1.0',
        dependencies: { axios: '^1.6.0' },
      })
    })

    it('should reject invalid semantic versions', async () => {
      const metadata = {
        id: 'my-func',
        version: 'invalid-version',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await expect(registry.deploy(metadata)).rejects.toThrow('Invalid semantic version: invalid-version')
    })

    it('should store version snapshots', async () => {
      const metadata = {
        id: 'my-func',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(metadata)

      // Verify version snapshot was stored
      const snapshot = await mockKV.get('function:my-func:v:1.0.0', 'json')
      expect(snapshot).toMatchObject({
        id: 'my-func',
        version: '1.0.0',
      })
    })
  })

  describe('get()', () => {
    it('should retrieve function metadata by ID', async () => {
      const metadata = {
        id: 'my-func',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {
          lodash: '^4.17.21',
        },
      }

      await registry.deploy(metadata)
      const result = await registry.get('my-func')

      expect(result).toMatchObject({
        id: 'my-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {
          lodash: '^4.17.21',
        },
      })
    })

    it('should return null for non-existent function', async () => {
      const result = await registry.get('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('list()', () => {
    it('should return all deployed functions', async () => {
      const func1 = {
        id: 'func-1',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      const func2 = {
        id: 'func-2',
        version: '2.0.0',
        language: 'python' as const,
        entryPoint: 'main.py',
        dependencies: {
          requests: '^2.31.0',
        },
      }

      await registry.deploy(func1)
      await registry.deploy(func2)

      const result = await registry.list()

      expect(result).toHaveLength(2)
      expect(result).toContainEqual(expect.objectContaining({ id: 'func-1' }))
      expect(result).toContainEqual(expect.objectContaining({ id: 'func-2' }))
    })

    it('should return empty array when no functions deployed', async () => {
      const result = await registry.list()
      expect(result).toEqual([])
    })

    it('should not include version snapshots or history entries', async () => {
      const metadata = {
        id: 'my-func',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(metadata)
      await registry.deploy({ ...metadata, version: '1.1.0' })

      const result = await registry.list()

      // Should only have one function, not version snapshots
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ id: 'my-func' })
    })

    it('should use manifest for optimized listing after deploy', async () => {
      const func1 = {
        id: 'func-1',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(func1)

      // Verify manifest was created
      const manifest = await mockKV.get('functions:manifest', 'json')
      expect(manifest).toEqual(['func-1'])

      // list() should use manifest
      const result = await registry.list()
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ id: 'func-1' })
    })

    it('should update manifest when new functions are deployed', async () => {
      const func1 = {
        id: 'func-1',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      const func2 = {
        id: 'func-2',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(func1)
      await registry.deploy(func2)

      const manifest = await mockKV.get('functions:manifest', 'json')
      expect(manifest).toEqual(['func-1', 'func-2'])
    })

    it('should not duplicate function ID in manifest on redeploy', async () => {
      const metadata = {
        id: 'my-func',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(metadata)
      await registry.deploy({ ...metadata, version: '1.1.0' })
      await registry.deploy({ ...metadata, version: '1.2.0' })

      const manifest = await mockKV.get('functions:manifest', 'json')
      expect(manifest).toEqual(['my-func'])
    })

    it('should remove function from manifest on delete', async () => {
      const func1 = {
        id: 'func-1',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      const func2 = {
        id: 'func-2',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(func1)
      await registry.deploy(func2)
      await registry.delete('func-1')

      const manifest = await mockKV.get('functions:manifest', 'json')
      expect(manifest).toEqual(['func-2'])

      const result = await registry.list()
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ id: 'func-2' })
    })

    it('should handle stale manifest entries gracefully', async () => {
      const func1 = {
        id: 'func-1',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(func1)

      // Manually add a stale entry to manifest
      await mockKV.put('functions:manifest', JSON.stringify(['func-1', 'non-existent']))

      const result = await registry.list()

      // Should only return existing function, filtering out stale entry
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ id: 'func-1' })
    })

    it('should rebuild manifest when listing legacy data without manifest', async () => {
      // Simulate legacy data: function exists but no manifest
      const legacyMetadata = {
        id: 'legacy-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }

      // Directly insert without going through deploy (simulating legacy data)
      await mockKV.put('function:legacy-func', JSON.stringify(legacyMetadata))

      // First list should scan and rebuild manifest
      const result = await registry.list()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ id: 'legacy-func' })

      // Verify manifest was created
      const manifest = await mockKV.get('functions:manifest', 'json')
      expect(manifest).toEqual(['legacy-func'])
    })

    it('should efficiently list using manifest without scanning all keys', async () => {
      // Deploy a function
      const func1 = {
        id: 'func-1',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(func1)

      // Spy on KV list to verify it's not called when manifest exists
      const listSpy = vi.spyOn(mockKV, 'list')

      // Call list - should use manifest
      const result = await registry.list()

      expect(result).toHaveLength(1)
      // list() should NOT have been called because manifest exists
      expect(listSpy).not.toHaveBeenCalled()

      listSpy.mockRestore()
    })
  })

  describe('delete()', () => {
    it('should remove function from registry', async () => {
      const metadata = {
        id: 'my-func',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(metadata)
      await registry.delete('my-func')

      const result = await registry.get('my-func')
      expect(result).toBeNull()
    })

    it('should remove all version snapshots and history', async () => {
      const metadata = {
        id: 'my-func',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(metadata)
      await registry.deploy({ ...metadata, version: '1.1.0' })
      await registry.delete('my-func')

      // Verify version snapshots are deleted
      const snapshot1 = await mockKV.get('function:my-func:v:1.0.0', 'json')
      const snapshot2 = await mockKV.get('function:my-func:v:1.1.0', 'json')
      const history = await mockKV.get('function:my-func:versions', 'json')

      expect(snapshot1).toBeNull()
      expect(snapshot2).toBeNull()
      expect(history).toBeNull()
    })
  })

  describe('getVersions()', () => {
    it('should return all versions of a function sorted descending', async () => {
      const metadata = {
        id: 'my-func',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy({ ...metadata, version: '1.0.0' })
      await registry.deploy({ ...metadata, version: '1.1.0' })
      await registry.deploy({ ...metadata, version: '2.0.0' })
      await registry.deploy({ ...metadata, version: '1.2.0' })

      const versions = await registry.getVersions('my-func')

      expect(versions).toEqual(['2.0.0', '1.2.0', '1.1.0', '1.0.0'])
    })

    it('should return empty array for non-existent function', async () => {
      const versions = await registry.getVersions('non-existent')
      expect(versions).toEqual([])
    })

    it('should not duplicate versions when same version is deployed multiple times', async () => {
      const metadata = {
        id: 'my-func',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(metadata)
      await registry.deploy(metadata)
      await registry.deploy(metadata)

      const versions = await registry.getVersions('my-func')

      expect(versions).toEqual(['1.0.0'])
    })
  })

  describe('getVersion()', () => {
    it('should retrieve metadata for a specific version', async () => {
      const metadata = {
        id: 'my-func',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy({ ...metadata, version: '1.0.0', dependencies: { v1: '1.0.0' } })
      await registry.deploy({ ...metadata, version: '1.1.0', dependencies: { v2: '1.0.0' } })

      const v1 = await registry.getVersion('my-func', '1.0.0')
      const v2 = await registry.getVersion('my-func', '1.1.0')

      expect(v1).toMatchObject({ version: '1.0.0', dependencies: { v1: '1.0.0' } })
      expect(v2).toMatchObject({ version: '1.1.0', dependencies: { v2: '1.0.0' } })
    })

    it('should return null for non-existent version', async () => {
      const metadata = {
        id: 'my-func',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(metadata)

      const result = await registry.getVersion('my-func', '2.0.0')
      expect(result).toBeNull()
    })
  })

  describe('getDeploymentHistory()', () => {
    it('should return deployment records sorted newest first', async () => {
      const metadata = {
        id: 'my-func',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy({ ...metadata, version: '1.0.0' })
      await registry.deploy({ ...metadata, version: '1.1.0' })
      await registry.deploy({ ...metadata, version: '1.2.0' })

      const history = await registry.getDeploymentHistory('my-func')

      expect(history).toHaveLength(3)
      expect(history[0]!.version).toBe('1.2.0')
      expect(history[1]!.version).toBe('1.1.0')
      expect(history[2]!.version).toBe('1.0.0')

      // Each record should have deployedAt and metadata
      for (const record of history) {
        expect(record.deployedAt).toBeDefined()
        expect(record.metadata).toBeDefined()
        expect(record.metadata.id).toBe('my-func')
      }
    })

    it('should return empty array for non-existent function', async () => {
      const history = await registry.getDeploymentHistory('non-existent')
      expect(history).toEqual([])
    })

    it('should record multiple deployments of same version', async () => {
      const metadata = {
        id: 'my-func',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(metadata)
      await registry.deploy(metadata)
      await registry.deploy(metadata)

      const history = await registry.getDeploymentHistory('my-func')

      expect(history).toHaveLength(3)
      expect(history.every((r) => r.version === '1.0.0')).toBe(true)
    })
  })

  describe('rollback()', () => {
    it('should restore a previous version as the active version', async () => {
      const metadata = {
        id: 'my-func',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy({ ...metadata, version: '1.0.0', dependencies: { old: '1.0.0' } })
      await registry.deploy({ ...metadata, version: '2.0.0', dependencies: { new: '1.0.0' } })

      // Current should be 2.0.0
      let current = await registry.get('my-func')
      expect(current?.version).toBe('2.0.0')

      // Rollback to 1.0.0
      const restored = await registry.rollback('my-func', '1.0.0')

      expect(restored.version).toBe('1.0.0')
      expect(restored.dependencies).toEqual({ old: '1.0.0' })

      // Current should now be 1.0.0
      current = await registry.get('my-func')
      expect(current?.version).toBe('1.0.0')
      expect(current?.dependencies).toEqual({ old: '1.0.0' })
    })

    it('should record rollback in deployment history', async () => {
      const metadata = {
        id: 'my-func',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy({ ...metadata, version: '1.0.0' })
      await registry.deploy({ ...metadata, version: '2.0.0' })
      await registry.rollback('my-func', '1.0.0')

      const history = await registry.getDeploymentHistory('my-func')

      expect(history).toHaveLength(3)
      expect(history[0]!.version).toBe('1.0.0') // Rollback
      expect(history[1]!.version).toBe('2.0.0')
      expect(history[2]!.version).toBe('1.0.0') // Original
    })

    it('should throw error for non-existent version', async () => {
      const metadata = {
        id: 'my-func',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy(metadata)

      await expect(registry.rollback('my-func', '2.0.0')).rejects.toThrow(
        'Version 2.0.0 not found for function my-func'
      )
    })

    it('should throw error for non-existent function', async () => {
      await expect(registry.rollback('non-existent', '1.0.0')).rejects.toThrow(
        'Version 1.0.0 not found for function non-existent'
      )
    })

    it('should update updatedAt timestamp on rollback', async () => {
      const metadata = {
        id: 'my-func',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await registry.deploy({ ...metadata, version: '1.0.0' })

      // Small delay to ensure timestamps differ
      await new Promise((resolve) => setTimeout(resolve, 10))

      await registry.deploy({ ...metadata, version: '2.0.0' })
      const v2 = await registry.get('my-func')
      const v2UpdatedAt = v2?.updatedAt

      // Small delay to ensure timestamps differ
      await new Promise((resolve) => setTimeout(resolve, 10))

      await registry.rollback('my-func', '1.0.0')

      const restored = await registry.get('my-func')
      // Rollback should have a newer updatedAt than the version being rolled back to
      expect(restored?.updatedAt).not.toBe(v2UpdatedAt)
      expect(restored?.version).toBe('1.0.0')
    })
  })
})

describe('Semantic Version Utilities', () => {
  describe('parseVersion()', () => {
    it('should parse basic semver', () => {
      const result = parseVersion('1.2.3')
      expect(result).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: undefined,
        build: undefined,
      })
    })

    it('should parse semver with prerelease', () => {
      const result = parseVersion('1.0.0-beta.1')
      expect(result).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: 'beta.1',
        build: undefined,
      })
    })

    it('should parse semver with build metadata', () => {
      const result = parseVersion('1.0.0+build.123')
      expect(result).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: undefined,
        build: 'build.123',
      })
    })

    it('should parse semver with both prerelease and build', () => {
      const result = parseVersion('1.0.0-alpha.1+build.456')
      expect(result).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: 'alpha.1',
        build: 'build.456',
      })
    })

    it('should return null for invalid versions', () => {
      expect(parseVersion('invalid')).toBeNull()
      expect(parseVersion('1.0')).toBeNull()
      expect(parseVersion('1.0.0.0')).toBeNull()
      expect(parseVersion('v1.0.0')).toBeNull()
      expect(parseVersion('')).toBeNull()
    })
  })

  describe('compareVersions()', () => {
    it('should compare major versions', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBe(1)
      expect(compareVersions('1.0.0', '2.0.0')).toBe(-1)
    })

    it('should compare minor versions', () => {
      expect(compareVersions('1.2.0', '1.1.0')).toBe(1)
      expect(compareVersions('1.1.0', '1.2.0')).toBe(-1)
    })

    it('should compare patch versions', () => {
      expect(compareVersions('1.0.2', '1.0.1')).toBe(1)
      expect(compareVersions('1.0.1', '1.0.2')).toBe(-1)
    })

    it('should return 0 for equal versions', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
      expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    })

    it('should handle prerelease versions correctly', () => {
      // Release > prerelease
      expect(compareVersions('1.0.0', '1.0.0-alpha')).toBe(1)
      expect(compareVersions('1.0.0-alpha', '1.0.0')).toBe(-1)

      // Compare prereleases
      expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBe(1)
      expect(compareVersions('1.0.0-alpha.2', '1.0.0-alpha.1')).toBe(1)
    })

    it('should throw for invalid versions', () => {
      expect(() => compareVersions('invalid', '1.0.0')).toThrow('Invalid semantic version: invalid')
      expect(() => compareVersions('1.0.0', 'invalid')).toThrow('Invalid semantic version: invalid')
    })
  })

  describe('isValidVersion()', () => {
    it('should return true for valid versions', () => {
      expect(isValidVersion('1.0.0')).toBe(true)
      expect(isValidVersion('0.0.1')).toBe(true)
      expect(isValidVersion('10.20.30')).toBe(true)
      expect(isValidVersion('1.0.0-alpha')).toBe(true)
      expect(isValidVersion('1.0.0+build')).toBe(true)
    })

    it('should return false for invalid versions', () => {
      expect(isValidVersion('invalid')).toBe(false)
      expect(isValidVersion('1.0')).toBe(false)
      expect(isValidVersion('')).toBe(false)
      expect(isValidVersion('v1.0.0')).toBe(false)
    })
  })
})

describe('Metadata Validation', () => {
  describe('validateFunctionId()', () => {
    it('should accept valid function IDs', () => {
      expect(() => validateFunctionId('a')).not.toThrow()
      expect(() => validateFunctionId('my-func')).not.toThrow()
      expect(() => validateFunctionId('my-function-123')).not.toThrow()
      expect(() => validateFunctionId('A1')).not.toThrow()
      expect(() => validateFunctionId('func123')).not.toThrow()
      expect(() => validateFunctionId('my-very-long-function-name')).not.toThrow()
    })

    it('should reject empty function ID', () => {
      expect(() => validateFunctionId('')).toThrow('Invalid function ID: ID is required')
    })

    it('should reject function ID longer than 64 characters', () => {
      const longId = 'a'.repeat(65)
      expect(() => validateFunctionId(longId)).toThrow('Invalid function ID: ID must be 64 characters or less')
    })

    it('should reject function ID with leading hyphen', () => {
      expect(() => validateFunctionId('-my-func')).toThrow(
        'Invalid function ID: must start with a letter'
      )
    })

    it('should reject function ID with trailing hyphen', () => {
      expect(() => validateFunctionId('my-func-')).toThrow(
        'Invalid function ID: cannot start or end with hyphen or underscore'
      )
    })

    it('should reject function ID with invalid characters', () => {
      expect(() => validateFunctionId('my.func')).toThrow()
      expect(() => validateFunctionId('my func')).toThrow()
      expect(() => validateFunctionId('my@func')).toThrow()
    })

    it('should accept function ID with underscores', () => {
      expect(() => validateFunctionId('my_func')).not.toThrow()
      expect(() => validateFunctionId('my_func_123')).not.toThrow()
    })

    it('should reject single character hyphen', () => {
      expect(() => validateFunctionId('-')).toThrow('Invalid function ID: must start with a letter')
    })
  })

  describe('validateEntryPoint()', () => {
    it('should accept valid entry points', () => {
      expect(() => validateEntryPoint('index.ts')).not.toThrow()
      expect(() => validateEntryPoint('src/index.ts')).not.toThrow()
      expect(() => validateEntryPoint('src/handlers/main.js')).not.toThrow()
      expect(() => validateEntryPoint('main.py')).not.toThrow()
      expect(() => validateEntryPoint('lib/mod.rs')).not.toThrow()
    })

    it('should reject empty entry point', () => {
      expect(() => validateEntryPoint('')).toThrow('Invalid entry point: entry point is required')
    })

    it('should reject entry point without extension', () => {
      expect(() => validateEntryPoint('index')).toThrow(
        'Invalid entry point: must be a valid file path with extension'
      )
    })

    it('should reject absolute paths', () => {
      expect(() => validateEntryPoint('/src/index.ts')).toThrow(
        'Invalid entry point: must be a relative path without parent directory references'
      )
    })

    it('should reject paths with parent directory references', () => {
      expect(() => validateEntryPoint('../index.ts')).toThrow(
        'Invalid entry point: must be a relative path without parent directory references'
      )
      expect(() => validateEntryPoint('src/../index.ts')).toThrow(
        'Invalid entry point: must be a relative path without parent directory references'
      )
    })

    it('should reject paths with double slashes', () => {
      expect(() => validateEntryPoint('src//index.ts')).toThrow(
        'Invalid entry point: path contains invalid double slashes'
      )
    })

    it('should reject paths with invalid characters', () => {
      expect(() => validateEntryPoint('src/index$.ts')).toThrow(
        'Invalid entry point: must be a valid file path with extension'
      )
      expect(() => validateEntryPoint('src/in dex.ts')).toThrow(
        'Invalid entry point: must be a valid file path with extension'
      )
    })
  })

  describe('validateLanguage()', () => {
    it('should accept valid languages', () => {
      expect(() => validateLanguage('typescript')).not.toThrow()
      expect(() => validateLanguage('javascript')).not.toThrow()
      expect(() => validateLanguage('rust')).not.toThrow()
      expect(() => validateLanguage('python')).not.toThrow()
      expect(() => validateLanguage('go')).not.toThrow()
      expect(() => validateLanguage('zig')).not.toThrow()
      expect(() => validateLanguage('assemblyscript')).not.toThrow()
      expect(() => validateLanguage('csharp')).not.toThrow()
    })

    it('should reject empty language', () => {
      expect(() => validateLanguage('')).toThrow('Invalid language: language is required')
    })

    it('should reject invalid language', () => {
      expect(() => validateLanguage('java')).toThrow(
        'Invalid language: must be one of typescript, javascript, rust, python, go, zig, assemblyscript, csharp'
      )
      expect(() => validateLanguage('ruby')).toThrow(
        'Invalid language: must be one of typescript, javascript, rust, python, go, zig, assemblyscript, csharp'
      )
      expect(() => validateLanguage('TypeScript')).toThrow(
        'Invalid language: must be one of typescript, javascript, rust, python, go, zig, assemblyscript, csharp'
      )
    })
  })

  describe('validateDependencies()', () => {
    it('should accept valid dependencies', () => {
      expect(() => validateDependencies({})).not.toThrow()
      expect(() => validateDependencies({ lodash: '^4.17.21' })).not.toThrow()
      expect(() => validateDependencies({ axios: '~1.6.0' })).not.toThrow()
      expect(() => validateDependencies({ express: '>=4.0.0' })).not.toThrow()
      expect(() => validateDependencies({ react: '1.0.0 - 2.0.0' })).not.toThrow()
      expect(() => validateDependencies({ 'left-pad': '*' })).not.toThrow()
      expect(() => validateDependencies({ moment: 'latest' })).not.toThrow()
    })

    it('should accept undefined or null dependencies', () => {
      expect(() => validateDependencies(undefined)).not.toThrow()
      expect(() => validateDependencies(null)).not.toThrow()
    })

    it('should reject non-object dependencies', () => {
      expect(() => validateDependencies('lodash')).toThrow('Invalid dependencies: must be an object')
      expect(() => validateDependencies(['lodash'])).toThrow('Invalid dependencies: must be an object')
      expect(() => validateDependencies(123)).toThrow('Invalid dependencies: must be an object')
    })

    it('should reject non-string version', () => {
      expect(() => validateDependencies({ lodash: 123 })).toThrow(
        'Invalid dependencies: version for "lodash" must be a string'
      )
      expect(() => validateDependencies({ lodash: null })).toThrow(
        'Invalid dependencies: version for "lodash" must be a string'
      )
    })

    it('should reject invalid semver version', () => {
      expect(() => validateDependencies({ lodash: 'invalid' })).toThrow(
        'Invalid dependencies: "lodash" has invalid semver version "invalid"'
      )
      expect(() => validateDependencies({ lodash: '1.0' })).toThrow(
        'Invalid dependencies: "lodash" has invalid semver version "1.0"'
      )
    })
  })

  describe('validateMetadata()', () => {
    const validMetadata = {
      id: 'my-func',
      version: '1.0.0',
      type: 'code' as const,
      language: 'typescript' as const,
      entryPoint: 'src/index.ts',
      dependencies: { lodash: '^4.17.21' },
    }

    it('should accept valid metadata', () => {
      expect(() => validateMetadata(validMetadata)).not.toThrow()
    })

    it('should reject metadata with invalid id', () => {
      expect(() => validateMetadata({ ...validMetadata, id: '' })).toThrow('Invalid function ID')
    })

    it('should reject metadata with invalid entryPoint', () => {
      expect(() => validateMetadata({ ...validMetadata, entryPoint: '' })).toThrow('Invalid entry point')
    })

    it('should reject metadata with invalid language', () => {
      expect(() => validateMetadata({ ...validMetadata, language: 'java' as never })).toThrow('Invalid language')
    })

    it('should reject metadata with invalid dependencies', () => {
      expect(() => validateMetadata({ ...validMetadata, dependencies: { lodash: 'invalid' } })).toThrow(
        'Invalid dependencies'
      )
    })
  })

  describe('FunctionRegistry.deploy() metadata validation', () => {
    let registry: FunctionRegistry
    let mockKV: KVNamespace

    beforeEach(() => {
      mockKV = createMockKV()
      registry = new FunctionRegistry(mockKV)
    })

    it('should reject deploy with invalid function ID', async () => {
      const metadata = {
        id: '-invalid-id-',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await expect(registry.deploy(metadata)).rejects.toThrow('Invalid function ID')
    })

    it('should reject deploy with invalid entry point', async () => {
      const metadata = {
        id: 'my-func',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: '/absolute/path.ts',
        dependencies: {},
      }

      await expect(registry.deploy(metadata)).rejects.toThrow('Invalid entry point')
    })

    it('should reject deploy with invalid language', async () => {
      const metadata = {
        id: 'my-func',
        version: '1.0.0',
        language: 'java' as never,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await expect(registry.deploy(metadata)).rejects.toThrow('Invalid language')
    })

    it('should reject deploy with invalid dependencies', async () => {
      const metadata = {
        id: 'my-func',
        version: '1.0.0',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: { lodash: 'not-a-valid-semver' },
      }

      await expect(registry.deploy(metadata)).rejects.toThrow('Invalid dependencies')
    })

    it('should still reject invalid semantic version', async () => {
      const metadata = {
        id: 'my-func',
        version: 'invalid-version',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await expect(registry.deploy(metadata)).rejects.toThrow('Invalid semantic version: invalid-version')
    })
  })
})

describe('FunctionRegistry Network Partition Tests', () => {
  let failingKV: FailingMockKV
  let registry: FunctionRegistry

  const validMetadata = {
    id: 'test-func',
    version: '1.0.0',
    language: 'typescript' as const,
    entryPoint: 'index.ts',
    dependencies: { lodash: '^4.17.21' },
  }

  beforeEach(() => {
    failingKV = new FailingMockKV()
    registry = new FunctionRegistry(failingKV as unknown as KVNamespace)
  })

  describe('KV get failures during load', () => {
    it('should propagate error when get() fails during function retrieval', async () => {
      // First deploy successfully
      await registry.deploy(validMetadata)

      // Then simulate get failure
      failingKV.setFailureMode('get', Infinity, 'Network partition: KV get failed')

      await expect(registry.get('test-func')).rejects.toThrow('Network partition: KV get failed')
    })

    it('should propagate error when get() fails during getVersion()', async () => {
      await registry.deploy(validMetadata)
      failingKV.setFailureMode('get', Infinity, 'KV read timeout')

      await expect(registry.getVersion('test-func', '1.0.0')).rejects.toThrow('KV read timeout')
    })

    it('should propagate error when get() fails during getVersions()', async () => {
      await registry.deploy(validMetadata)
      failingKV.setFailureMode('get', Infinity, 'Connection refused')

      await expect(registry.getVersions('test-func')).rejects.toThrow('Connection refused')
    })

    it('should propagate error when get() fails during getDeploymentHistory()', async () => {
      await registry.deploy(validMetadata)
      failingKV.setFailureMode('get', Infinity, 'KV unavailable')

      await expect(registry.getDeploymentHistory('test-func')).rejects.toThrow('KV unavailable')
    })

    it('should propagate error when get() fails checking existing function during deploy', async () => {
      // First deploy succeeds
      await registry.deploy(validMetadata)

      // Now fail on get during second deploy (which checks existing)
      failingKV.setFailureMode('get', Infinity, 'Get failed during deploy')

      await expect(registry.deploy({ ...validMetadata, version: '1.1.0' })).rejects.toThrow('Get failed during deploy')
    })

    it('should propagate error when get() fails during rollback', async () => {
      await registry.deploy(validMetadata)
      await registry.deploy({ ...validMetadata, version: '2.0.0' })

      failingKV.setFailureMode('get', Infinity, 'Version snapshot unavailable')

      await expect(registry.rollback('test-func', '1.0.0')).rejects.toThrow('Version snapshot unavailable')
    })
  })

  describe('KV put failures during deploy (partial write scenarios)', () => {
    it('should propagate error when first put() fails during deploy', async () => {
      failingKV.setFailureMode('put', Infinity, 'KV write failed')

      await expect(registry.deploy(validMetadata)).rejects.toThrow('KV write failed')

      // Verify nothing was stored
      failingKV.setFailureMode('none')
      const result = await registry.get('test-func')
      expect(result).toBeNull()
    })

    it('should leave partial state when second put() fails during deploy', async () => {
      // This tests a partial write scenario - first put succeeds, second fails
      // Deploy does: get(check existing) -> put(key) -> put(versionKey) -> get+put(history) -> get+put(manifest)
      // Using setDelayedFailureMode to succeed on first put, then fail
      failingKV.setDelayedFailureMode('put', 1, Infinity, 'Second write failed')

      await expect(registry.deploy(validMetadata)).rejects.toThrow('Second write failed')

      // First put (main metadata) succeeded, but version snapshot failed
      failingKV.setFailureMode('none')
      const stored = await registry.get('test-func')
      expect(stored).toMatchObject({ id: 'test-func', version: '1.0.0' })

      // Version snapshot was not stored (second put failed)
      const versionSnapshot = await registry.getVersion('test-func', '1.0.0')
      expect(versionSnapshot).toBeNull()
    })

    it('should leave partially updated state when history put() fails', async () => {
      // Deploy does: get(check existing) -> put(main) -> put(version) -> get+put(history) -> get+put(manifest)
      // First two puts succeed, third (history) fails
      failingKV.setDelayedFailureMode('put', 2, Infinity, 'History write failed')

      await expect(registry.deploy(validMetadata)).rejects.toThrow('History write failed')

      failingKV.setFailureMode('none')

      // Main metadata and version snapshot were stored
      const stored = await registry.get('test-func')
      expect(stored).toMatchObject({ id: 'test-func' })

      const versionSnapshot = await registry.getVersion('test-func', '1.0.0')
      expect(versionSnapshot).toMatchObject({ id: 'test-func' })

      // But history/versions list is empty since that put failed
      const versions = await registry.getVersions('test-func')
      expect(versions).toEqual([])
    })

    it('should propagate error when put() fails during rollback', async () => {
      await registry.deploy(validMetadata)
      await registry.deploy({ ...validMetadata, version: '2.0.0' })

      failingKV.setFailureMode('put', Infinity, 'Rollback write failed')

      await expect(registry.rollback('test-func', '1.0.0')).rejects.toThrow('Rollback write failed')

      // Current version should still be 2.0.0
      failingKV.setFailureMode('none')
      const current = await registry.get('test-func')
      expect(current?.version).toBe('2.0.0')
    })
  })

  describe('KV list failures', () => {
    it('should propagate error when list() falls back to kv.list() without manifest', async () => {
      // Deploy without manifest (simulate legacy data by directly inserting)
      await failingKV.put('function:test-func', JSON.stringify({
        ...validMetadata,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }))

      // No manifest exists, so list() will use kv.list()
      failingKV.setFailureMode('list', Infinity, 'KV list operation failed')

      await expect(registry.list()).rejects.toThrow('KV list operation failed')
    })

    it('should propagate get error when list() uses manifest-based lookup', async () => {
      // Deploy creates manifest
      await registry.deploy(validMetadata)

      // Now list() will use manifest-based lookup (via get calls)
      failingKV.setFailureMode('get', Infinity, 'KV get failed during list')

      await expect(registry.list()).rejects.toThrow('KV get failed during list')
    })
  })

  describe('KV delete failures', () => {
    it('should propagate error when delete() fails', async () => {
      await registry.deploy(validMetadata)
      failingKV.setFailureMode('delete', Infinity, 'Delete operation denied')

      await expect(registry.delete('test-func')).rejects.toThrow('Delete operation denied')

      // Function should still exist
      failingKV.setFailureMode('none')
      const result = await registry.get('test-func')
      expect(result).toMatchObject({ id: 'test-func' })
    })

    it('should leave partial state when second delete fails during function deletion', async () => {
      await registry.deploy(validMetadata)
      await registry.deploy({ ...validMetadata, version: '1.1.0' })

      // delete() order: getVersions() -> delete(main) -> delete(history) -> delete(snapshots)...
      // Use setDelayedFailureMode: first delete succeeds (main entry), second fails (history)
      failingKV.setDelayedFailureMode('delete', 1, Infinity, 'Partial delete failure')

      await expect(registry.delete('test-func')).rejects.toThrow('Partial delete failure')

      // Main entry was deleted (first delete succeeded)
      failingKV.setFailureMode('none')
      const result = await registry.get('test-func')
      expect(result).toBeNull()

      // Version history still exists (orphaned state) - second delete failed
      const history = await failingKV.get('function:test-func:versions', 'json')
      expect(history).not.toBeNull()
    })
  })

  describe('Transient failures that recover', () => {
    it('should succeed after transient get failures', async () => {
      await registry.deploy(validMetadata)

      // Fail 2 times, then succeed
      failingKV.setFailureMode('get', 2, 'Transient failure')

      // First two calls fail
      await expect(registry.get('test-func')).rejects.toThrow('Transient failure')
      await expect(registry.get('test-func')).rejects.toThrow('Transient failure')

      // Third call succeeds
      const result = await registry.get('test-func')
      expect(result).toMatchObject({ id: 'test-func', version: '1.0.0' })
    })

    it('should succeed after transient put failures', async () => {
      // Fail 2 times, then succeed
      failingKV.setFailureMode('put', 2, 'Transient write failure')

      // First two deploys fail
      await expect(registry.deploy(validMetadata)).rejects.toThrow('Transient write failure')
      await expect(registry.deploy(validMetadata)).rejects.toThrow('Transient write failure')

      // Third deploy succeeds
      await registry.deploy(validMetadata)
      const result = await registry.get('test-func')
      expect(result).toMatchObject({ id: 'test-func' })
    })

    it('should succeed after transient list failures (fallback path without manifest)', async () => {
      // Insert data directly without manifest to test list fallback path
      await failingKV.put('function:test-func', JSON.stringify({
        ...validMetadata,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }))

      // Fail 3 times on kv.list(), then succeed
      failingKV.setFailureMode('list', 3, 'Service temporarily unavailable')

      await expect(registry.list()).rejects.toThrow('Service temporarily unavailable')
      await expect(registry.list()).rejects.toThrow('Service temporarily unavailable')
      await expect(registry.list()).rejects.toThrow('Service temporarily unavailable')

      // Fourth call succeeds and rebuilds manifest
      const result = await registry.list()
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ id: 'test-func' })
    })

    it('should track failure count accurately', async () => {
      await registry.deploy(validMetadata)
      failingKV.setFailureMode('get', 3, 'Failure')

      expect(failingKV.getFailureCount()).toBe(0)

      try {
        await registry.get('test-func')
      } catch {
        /* expected */
      }
      expect(failingKV.getFailureCount()).toBe(1)

      try {
        await registry.get('test-func')
      } catch {
        /* expected */
      }
      expect(failingKV.getFailureCount()).toBe(2)

      try {
        await registry.get('test-func')
      } catch {
        /* expected */
      }
      expect(failingKV.getFailureCount()).toBe(3)

      // Fourth call succeeds, counter doesn't increment
      await registry.get('test-func')
      expect(failingKV.getFailureCount()).toBe(3)
    })

    it('should work with deploy retry pattern', async () => {
      // Simulate a retry pattern where first attempt fails partially
      failingKV.setFailureMode('put', 1, 'First attempt failed')

      // First attempt fails
      await expect(registry.deploy(validMetadata)).rejects.toThrow('First attempt failed')

      // Retry succeeds (only 1 failure configured)
      await registry.deploy(validMetadata)

      const result = await registry.get('test-func')
      expect(result).toMatchObject({ id: 'test-func', version: '1.0.0' })
    })
  })

  describe('Timeout simulation', () => {
    it('should handle delayed operations', async () => {
      failingKV.setDelay(10) // 10ms delay

      const start = Date.now()
      await registry.deploy(validMetadata)
      const elapsed = Date.now() - start

      // Each operation in deploy has the delay, so total should be > 10ms
      // deploy does: get (check existing), put, put, get (history), put
      expect(elapsed).toBeGreaterThanOrEqual(10)

      const result = await registry.get('test-func')
      expect(result).toMatchObject({ id: 'test-func' })
    })

    it('should complete operations despite delays', async () => {
      failingKV.setDelay(5)

      await registry.deploy(validMetadata)
      await registry.deploy({ ...validMetadata, version: '1.1.0' })

      const versions = await registry.getVersions('test-func')
      expect(versions).toContain('1.0.0')
      expect(versions).toContain('1.1.0')
    })

    it('should support combined delay and failure modes', async () => {
      failingKV.setDelay(5)
      failingKV.setFailureMode('get', 1, 'Delayed failure')

      // First get fails (with delay)
      const start = Date.now()
      await expect(registry.get('test-func')).rejects.toThrow('Delayed failure')
      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(5)

      // Second get succeeds (still with delay)
      await registry.deploy(validMetadata)
      const result = await registry.get('test-func')
      expect(result).toMatchObject({ id: 'test-func' })
    })
  })

  describe('All operations failing (complete network partition)', () => {
    it('should fail all operations when in complete partition', async () => {
      // First deploy successfully
      await registry.deploy(validMetadata)

      // Now simulate complete network partition
      failingKV.setFailureMode('all', Infinity, 'Network unreachable')

      await expect(registry.get('test-func')).rejects.toThrow('Network unreachable')
      await expect(registry.list()).rejects.toThrow('Network unreachable')
      await expect(registry.deploy({ ...validMetadata, version: '1.1.0' })).rejects.toThrow('Network unreachable')
      await expect(registry.delete('test-func')).rejects.toThrow('Network unreachable')
    })

    it('should recover from complete partition', async () => {
      await registry.deploy(validMetadata)

      // Simulate partition
      failingKV.setFailureMode('all', 2, 'Temporary partition')

      await expect(registry.get('test-func')).rejects.toThrow('Temporary partition')
      await expect(registry.get('test-func')).rejects.toThrow('Temporary partition')

      // Partition heals
      const result = await registry.get('test-func')
      expect(result).toMatchObject({ id: 'test-func' })
    })
  })

  describe('Reset functionality', () => {
    it('should clear all state and failure modes on reset', async () => {
      await registry.deploy(validMetadata)
      failingKV.setFailureMode('get', Infinity, 'Failure')
      failingKV.setDelay(100)

      await expect(registry.get('test-func')).rejects.toThrow('Failure')

      // Reset clears everything
      failingKV.reset()

      // Data is gone
      const result = await registry.get('test-func')
      expect(result).toBeNull()

      // Failure mode is cleared (operations succeed)
      await registry.deploy(validMetadata)
      const stored = await registry.get('test-func')
      expect(stored).toMatchObject({ id: 'test-func' })
    })
  })

  describe('Edge cases', () => {
    it('should handle failure during multi-step operations correctly', async () => {
      // Deploy v1 successfully
      await registry.deploy(validMetadata)

      // Deploy v2 with failure after storing main metadata
      // Deploy order: get(check existing) -> put(main) -> put(version) -> get+put(history) -> get+put(manifest)
      // Setting maxFailures=1 means first put fails, second succeeds
      // We want first put to succeed, second to fail - so set maxFailures=2 (fail twice)
      // Actually we want exactly one put to succeed then fail
      // Let's use a different approach: fail on second put
      // maxFailures=1 -> first put fails (main), so nothing stored
      // We need first put to succeed, second to fail
      // With current logic: maxFailures=N means "fail N times then succeed"
      // So to have first put succeed and second fail, we can't do it directly

      // Let's test a simpler scenario: first put fails, nothing is stored
      failingKV.setFailureMode('put', 1, 'First write failed')

      // v2 deploy fails on first put (main metadata)
      await expect(registry.deploy({ ...validMetadata, version: '2.0.0' })).rejects.toThrow('First write failed')

      // Main metadata was NOT updated (first put failed), still v1
      failingKV.setFailureMode('none')
      const current = await registry.get('test-func')
      expect(current?.version).toBe('1.0.0')

      // v2 snapshot doesn't exist
      const v2Snapshot = await registry.getVersion('test-func', '2.0.0')
      expect(v2Snapshot).toBeNull()

      // v1 snapshot still exists
      const v1Snapshot = await registry.getVersion('test-func', '1.0.0')
      expect(v1Snapshot).toMatchObject({ version: '1.0.0' })
    })

    it('should leave partial state when put fails after main metadata write', async () => {
      // Deploy v1 successfully
      await registry.deploy(validMetadata)

      // For v2: want main metadata to be written, but version snapshot to fail
      // v2 deploy order: get(existing) -> put(main) -> put(version) -> ...
      // Using setDelayedFailureMode to succeed first put, fail on second
      failingKV.setDelayedFailureMode('put', 1, Infinity, 'Version write failed')

      await expect(registry.deploy({ ...validMetadata, version: '2.0.0' })).rejects.toThrow('Version write failed')

      failingKV.setFailureMode('none')

      // Main metadata WAS updated to v2 (first put succeeded)
      const current = await registry.get('test-func')
      expect(current?.version).toBe('2.0.0')

      // But v2 version snapshot doesn't exist (second put failed)
      const v2Snapshot = await registry.getVersion('test-func', '2.0.0')
      expect(v2Snapshot).toBeNull()

      // v1 snapshot still exists from first deploy
      const v1Snapshot = await registry.getVersion('test-func', '1.0.0')
      expect(v1Snapshot).toMatchObject({ version: '1.0.0' })
    })

    it('should handle getWithMetadata failures', async () => {
      await registry.deploy(validMetadata)
      failingKV.setFailureMode('get', Infinity, 'Metadata fetch failed')

      await expect(failingKV.getWithMetadata('function:test-func', 'json')).rejects.toThrow('Metadata fetch failed')
    })

    it('should handle empty store operations gracefully even with failures', async () => {
      // get on empty store before any failure
      const result = await registry.get('non-existent')
      expect(result).toBeNull()

      // Now set failure mode - get still fails
      failingKV.setFailureMode('get', Infinity, 'Failure')
      await expect(registry.get('non-existent')).rejects.toThrow('Failure')
    })
  })
})
