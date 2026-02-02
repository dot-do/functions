/**
 * List Functions API Tests
 *
 * Tests for function listing capabilities using the FunctionRegistry.
 * These tests verify the list functionality that would power a GET /api/functions endpoint.
 *
 * The tests use the FunctionRegistry directly since the HTTP endpoint
 * routing is handled separately. This ensures the core listing logic
 * is properly tested regardless of the routing layer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockKV } from '../test-utils/mock-kv'
import { FunctionRegistry } from '../core/function-registry'
import type { FunctionMetadata } from '../core/types'
import type { Env } from '../index'
import worker, { resetRateLimiter } from '../index'

// Type for JSON response bodies in tests
type JsonBody = Record<string, unknown>

/**
 * Hash an API key using SHA-256 (same algorithm as auth middleware)
 */
async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(apiKey)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Helper to create test function metadata
 */
function createTestFunction(overrides: Partial<FunctionMetadata> = {}): Omit<FunctionMetadata, 'createdAt' | 'updatedAt'> {
  return {
    id: 'test-func',
    version: '1.0.0',
    language: 'typescript',
    entryPoint: 'index.ts',
    dependencies: {},
    ...overrides,
  }
}

describe('Function Registry List Operations', () => {
  let mockRegistry: KVNamespace
  let registry: FunctionRegistry

  beforeEach(() => {
    mockRegistry = createMockKV()
    registry = new FunctionRegistry(mockRegistry)
  })

  describe('Basic Listing', () => {
    it('should return list of functions with metadata', async () => {
      // Deploy test functions
      await registry.deploy(createTestFunction({ id: 'func-1', version: '1.0.0' }))
      await registry.deploy(createTestFunction({ id: 'func-2', version: '2.0.0' }))

      const functions = await registry.list()

      expect(functions).toHaveLength(2)
      expect(functions.map((f) => f.id).sort()).toEqual(['func-1', 'func-2'])
    })

    it('should return function id in response', async () => {
      await registry.deploy(createTestFunction({ id: 'my-function' }))

      const functions = await registry.list()

      expect(functions).toHaveLength(1)
      expect(functions[0]?.id).toBe('my-function')
    })

    it('should return function version in response', async () => {
      await registry.deploy(createTestFunction({ id: 'versioned-func', version: '2.3.4' }))

      const functions = await registry.list()

      expect(functions).toHaveLength(1)
      expect(functions[0]?.version).toBe('2.3.4')
    })

    it('should return function language in response', async () => {
      await registry.deploy(createTestFunction({ id: 'ts-func', language: 'typescript' }))
      await registry.deploy(createTestFunction({ id: 'rust-func', language: 'rust' }))

      const functions = await registry.list()
      const tsFunc = functions.find((f) => f.id === 'ts-func')
      const rustFunc = functions.find((f) => f.id === 'rust-func')

      expect(tsFunc?.language).toBe('typescript')
      expect(rustFunc?.language).toBe('rust')
    })

    it('should return createdAt timestamp for each function', async () => {
      await registry.deploy(createTestFunction({ id: 'timestamped-func' }))

      const functions = await registry.list()

      expect(functions).toHaveLength(1)
      expect(functions[0]?.createdAt).toBeDefined()
      // Verify it's a valid ISO timestamp
      const createdAt = new Date(functions[0]?.createdAt as string)
      expect(createdAt.getTime()).not.toBeNaN()
    })

    it('should return updatedAt timestamp when available', async () => {
      await registry.deploy(createTestFunction({ id: 'update-func', version: '1.0.0' }))
      // Update the function
      await registry.deploy(createTestFunction({ id: 'update-func', version: '1.1.0' }))

      const functions = await registry.list()
      const func = functions.find((f) => f.id === 'update-func')

      expect(func?.updatedAt).toBeDefined()
      expect(func?.createdAt).toBeDefined()
      // updatedAt should be >= createdAt
      const createdAt = new Date(func?.createdAt as string)
      const updatedAt = new Date(func?.updatedAt as string)
      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(createdAt.getTime())
    })
  })

  describe('Empty Results', () => {
    it('should return empty list when no functions exist', async () => {
      const functions = await registry.list()

      expect(functions).toEqual([])
    })

    it('should return empty array for empty results', async () => {
      const functions = await registry.list()

      expect(Array.isArray(functions)).toBe(true)
      expect(functions.length).toBe(0)
    })
  })

  describe('Function Metadata Fields', () => {
    it('should include all required metadata fields', async () => {
      await registry.deploy({
        id: 'complete-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'src/main.ts',
        dependencies: { lodash: '^4.17.0' },
      })

      const functions = await registry.list()
      const func = functions[0]

      expect(func).toBeDefined()
      expect(func?.id).toBe('complete-func')
      expect(func?.version).toBe('1.0.0')
      expect(func?.language).toBe('typescript')
      expect(func?.entryPoint).toBe('src/main.ts')
      expect(func?.dependencies).toEqual({ lodash: '^4.17.0' })
      expect(func?.createdAt).toBeDefined()
    })

    it('should support all valid languages', async () => {
      const languages = ['typescript', 'javascript', 'rust', 'python', 'go', 'zig', 'assemblyscript', 'csharp'] as const

      for (const language of languages) {
        await registry.deploy(createTestFunction({ id: `${language}-func`, language }))
      }

      const functions = await registry.list()

      expect(functions).toHaveLength(languages.length)
      for (const language of languages) {
        const func = functions.find((f) => f.language === language)
        expect(func).toBeDefined()
      }
    })
  })

  describe('List with Multiple Functions', () => {
    it('should handle many functions efficiently', async () => {
      // Deploy multiple functions
      const count = 20
      for (let i = 0; i < count; i++) {
        await registry.deploy(createTestFunction({ id: `func-${i.toString().padStart(3, '0')}`, version: '1.0.0' }))
      }

      const functions = await registry.list()

      expect(functions).toHaveLength(count)
    })

    it('should return functions in consistent order', async () => {
      await registry.deploy(createTestFunction({ id: 'alpha-func' }))
      await registry.deploy(createTestFunction({ id: 'beta-func' }))
      await registry.deploy(createTestFunction({ id: 'gamma-func' }))

      const functions1 = await registry.list()
      const functions2 = await registry.list()

      // Order should be consistent across calls
      expect(functions1.map((f) => f.id)).toEqual(functions2.map((f) => f.id))
    })
  })

  describe('Version Handling', () => {
    it('should return current version after updates', async () => {
      await registry.deploy(createTestFunction({ id: 'version-test', version: '1.0.0' }))
      await registry.deploy(createTestFunction({ id: 'version-test', version: '2.0.0' }))

      const functions = await registry.list()
      const func = functions.find((f) => f.id === 'version-test')

      expect(func?.version).toBe('2.0.0')
    })

    it('should track version history separately', async () => {
      await registry.deploy(createTestFunction({ id: 'history-test', version: '1.0.0' }))
      await registry.deploy(createTestFunction({ id: 'history-test', version: '1.1.0' }))
      await registry.deploy(createTestFunction({ id: 'history-test', version: '2.0.0' }))

      const versions = await registry.getVersions('history-test')

      expect(versions).toContain('1.0.0')
      expect(versions).toContain('1.1.0')
      expect(versions).toContain('2.0.0')
    })
  })

  describe('Delete and List', () => {
    it('should not include deleted functions in list', async () => {
      await registry.deploy(createTestFunction({ id: 'keep-func' }))
      await registry.deploy(createTestFunction({ id: 'delete-func' }))

      await registry.delete('delete-func')

      const functions = await registry.list()

      expect(functions).toHaveLength(1)
      expect(functions[0]?.id).toBe('keep-func')
    })
  })
})

describe('Worker Fetch Handler - List Endpoint Behavior', () => {
  let mockEnv: Env
  let mockRegistry: KVNamespace
  let mockCodeStorage: KVNamespace
  let mockCtx: ExecutionContext

  beforeEach(async () => {
    resetRateLimiter()

    mockRegistry = createMockKV()
    mockCodeStorage = createMockKV()
    mockEnv = {
      FUNCTIONS_REGISTRY: mockRegistry,
      FUNCTIONS_CODE: mockCodeStorage,
    }
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext
  })

  afterEach(() => {
    resetRateLimiter()
  })

  describe('GET /api/functions behavior', () => {
    it('should return 200 with list of functions when accessing /api/functions', async () => {
      // List endpoint returns a list of functions (empty if none deployed)
      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['functions']).toBeDefined()
      expect(Array.isArray(body['functions'])).toBe(true)
    })

    it('should return JSON response with Content-Type header', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })
  })

  describe('Authentication for protected endpoints', () => {
    let mockApiKeys: KVNamespace

    beforeEach(async () => {
      mockApiKeys = createMockKV()
      mockEnv = {
        ...mockEnv,
        FUNCTIONS_API_KEYS: mockApiKeys,
      }

      // Store API key with keys:{hash} prefix as expected by auth middleware
      const validKeyHash = await hashApiKey('valid-api-key')
      await mockApiKeys.put(
        `keys:${validKeyHash}`,
        JSON.stringify({
          userId: 'user-123',
          active: true,
        })
      )
    })

    it('should require authentication when FUNCTIONS_API_KEYS is configured', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(401)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Missing authentication')
    })

    it('should return 401 for invalid API key', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: { 'X-API-Key': 'invalid-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(401)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Invalid API key')
    })

    it('should return 401 for expired API key', async () => {
      const expiredKeyHash = await hashApiKey('expired-key')
      await mockApiKeys.put(
        `keys:${expiredKeyHash}`,
        JSON.stringify({
          userId: 'user-expired',
          active: true,
          expiresAt: '2020-01-01T00:00:00Z',
        })
      )

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: { 'X-API-Key': 'expired-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(401)
    })

    it('should accept valid API key in X-API-Key header', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: { 'X-API-Key': 'valid-api-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // With valid API key, should get 200 with list of functions
      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['functions']).toBeDefined()
    })

    it('should allow health endpoint without authentication', async () => {
      const request = new Request('https://functions.do/health')
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })
  })

  describe('HTTP Method Handling', () => {
    it('should return appropriate response for different HTTP methods', async () => {
      // GET /api/functions -> listHandler (200 with list)
      const getRequest = new Request('https://functions.do/api/functions', { method: 'GET' })
      const getResponse = await worker.fetch(getRequest, mockEnv, mockCtx)
      expect(getResponse.status).toBe(200)

      // POST /api/functions -> deployHandler (400 without proper body)
      const postRequest = new Request('https://functions.do/api/functions', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      })
      const postResponse = await worker.fetch(postRequest, mockEnv, mockCtx)
      expect(postResponse.status).toBe(400) // Missing required fields

      // PUT /api/functions -> 404 (not a registered route)
      const putRequest = new Request('https://functions.do/api/functions', {
        method: 'PUT',
        body: JSON.stringify({}),
      })
      const putResponse = await worker.fetch(putRequest, mockEnv, mockCtx)
      expect(putResponse.status).toBe(405) // Method not allowed (route exists for GET/POST)

      // DELETE /api/functions -> needs function ID
      const deleteRequest = new Request('https://functions.do/api/functions', { method: 'DELETE' })
      const deleteResponse = await worker.fetch(deleteRequest, mockEnv, mockCtx)
      expect(deleteResponse.status).toBe(405) // Method not allowed

      // PATCH /api/functions -> needs function ID
      const patchRequest = new Request('https://functions.do/api/functions', {
        method: 'PATCH',
        body: JSON.stringify({}),
      })
      const patchResponse = await worker.fetch(patchRequest, mockEnv, mockCtx)
      expect(patchResponse.status).toBe(405) // Method not allowed
    })
  })

  describe('Query Parameter Handling', () => {
    it('should handle requests with query parameters', async () => {
      const request = new Request('https://functions.do/api/functions?limit=10&language=typescript', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // List endpoint accepts query parameters and returns 200
      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['functions']).toBeDefined()
    })

    it('should handle URL-encoded query parameters', async () => {
      const request = new Request('https://functions.do/api/functions?owner=user%2D123', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // List endpoint handles query parameters gracefully
      expect(response.status).toBe(200)
    })
  })
})

describe('List Functions - Response Format', () => {
  let mockRegistry: KVNamespace
  let registry: FunctionRegistry

  beforeEach(() => {
    mockRegistry = createMockKV()
    registry = new FunctionRegistry(mockRegistry)
  })

  it('should return functions as an array', async () => {
    await registry.deploy(createTestFunction({ id: 'test-1' }))
    await registry.deploy(createTestFunction({ id: 'test-2' }))

    const functions = await registry.list()

    expect(Array.isArray(functions)).toBe(true)
  })

  it('should return well-formed FunctionMetadata objects', async () => {
    await registry.deploy({
      id: 'well-formed',
      version: '1.2.3',
      language: 'python',
      entryPoint: 'main.py',
      dependencies: { requests: '^2.28.0' },
    })

    const functions = await registry.list()
    const func = functions[0]

    expect(func).toMatchObject({
      id: 'well-formed',
      version: '1.2.3',
      language: 'python',
      entryPoint: 'main.py',
      dependencies: { requests: '^2.28.0' },
    })
    expect(typeof func?.createdAt).toBe('string')
  })
})

describe('List Functions Integration with FunctionRegistry', () => {
  let mockRegistry: KVNamespace
  let registry: FunctionRegistry

  beforeEach(() => {
    mockRegistry = createMockKV()
    registry = new FunctionRegistry(mockRegistry)
  })

  it('should work with the FunctionRegistry class', async () => {
    // Verify FunctionRegistry is properly instantiated
    expect(registry).toBeInstanceOf(FunctionRegistry)
  })

  it('should persist functions across list calls', async () => {
    await registry.deploy(createTestFunction({ id: 'persistent-func' }))

    const list1 = await registry.list()
    const list2 = await registry.list()

    expect(list1).toHaveLength(1)
    expect(list2).toHaveLength(1)
    expect(list1[0]?.id).toBe(list2[0]?.id)
  })

  it('should use manifest for optimized listing', async () => {
    // Deploy functions to create manifest
    await registry.deploy(createTestFunction({ id: 'manifest-func-1' }))
    await registry.deploy(createTestFunction({ id: 'manifest-func-2' }))

    // List should use manifest internally
    const functions = await registry.list()

    expect(functions).toHaveLength(2)
  })

  it('should handle rollback and list correctly', async () => {
    await registry.deploy(createTestFunction({ id: 'rollback-test', version: '1.0.0' }))
    await registry.deploy(createTestFunction({ id: 'rollback-test', version: '2.0.0' }))

    // Rollback to v1
    await registry.rollback('rollback-test', '1.0.0')

    const functions = await registry.list()
    const func = functions.find((f) => f.id === 'rollback-test')

    expect(func?.version).toBe('1.0.0')
  })
})

describe('Performance and Edge Cases', () => {
  let mockRegistry: KVNamespace
  let registry: FunctionRegistry

  beforeEach(() => {
    mockRegistry = createMockKV()
    registry = new FunctionRegistry(mockRegistry)
  })

  it('should handle rapid deploy and list operations', async () => {
    // Rapid sequential deploys
    for (let i = 0; i < 10; i++) {
      await registry.deploy(createTestFunction({ id: `rapid-${i}`, version: '1.0.0' }))
    }

    const functions = await registry.list()

    expect(functions).toHaveLength(10)
  })

  it('should handle function IDs with special characters', async () => {
    await registry.deploy(createTestFunction({ id: 'my-function-123' }))
    await registry.deploy(createTestFunction({ id: 'another_function' }))

    const functions = await registry.list()

    expect(functions).toHaveLength(2)
    expect(functions.map((f) => f.id).sort()).toEqual(['another_function', 'my-function-123'])
  })

  it('should handle functions with complex dependencies', async () => {
    await registry.deploy({
      id: 'complex-deps',
      version: '1.0.0',
      language: 'typescript',
      entryPoint: 'index.ts',
      dependencies: {
        lodash: '^4.17.21',
        axios: '~1.4.0',
        react: '18.2.0',
        'date-fns': '>=2.0.0',
      },
    })

    const functions = await registry.list()
    const func = functions[0]

    expect(func?.dependencies).toEqual({
      lodash: '^4.17.21',
      axios: '~1.4.0',
      react: '18.2.0',
      'date-fns': '>=2.0.0',
    })
  })
})
