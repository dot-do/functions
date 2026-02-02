/**
 * Function Details API Tests
 *
 * Tests for the GET /api/functions/:id endpoint including:
 * - Function metadata retrieval
 * - 404 for non-existent functions
 * - Authentication requirements
 *
 * These tests verify the actual implementation behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockKV } from '../test-utils/mock-kv'
import type { Env } from '../index'

// Import the worker for testing
import worker, { resetRateLimiter } from '../index'

// Type for JSON response bodies in tests
type JsonBody = Record<string, unknown>

/**
 * Helper to hash an API key using SHA-256 (same as auth middleware)
 */
async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(apiKey)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

describe('Function Details API - GET /functions/:id', () => {
  let mockEnv: Env
  let mockRegistry: KVNamespace
  let mockCodeStorage: KVNamespace
  let mockApiKeys: KVNamespace
  let mockCtx: ExecutionContext

  beforeEach(async () => {
    resetRateLimiter()

    mockRegistry = createMockKV()
    mockCodeStorage = createMockKV()
    mockApiKeys = createMockKV()

    mockEnv = {
      FUNCTIONS_REGISTRY: mockRegistry,
      FUNCTIONS_CODE: mockCodeStorage,
      FUNCTIONS_API_KEYS: mockApiKeys,
    }

    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext

    // Set up a valid API key (stored with keys: prefix and hashed key)
    const testApiKeyHash = await hashApiKey('test-api-key')
    await mockApiKeys.put(
      `keys:${testApiKeyHash}`,
      JSON.stringify({
        userId: 'user-123',
        active: true,
      })
    )

    // Set up a test function with full metadata (stored with registry: prefix)
    const testFunctionMetadata = {
      id: 'my-function',
      version: '1.2.0',
      language: 'typescript',
      entryPoint: 'index.ts',
      dependencies: {
        lodash: '^4.17.21',
      },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-06-15T12:30:00Z',
      description: 'A sample test function',
      author: 'test-user',
    }
    await mockRegistry.put('registry:my-function', JSON.stringify(testFunctionMetadata))

    // Set up version history entries (stored with registry:{id}:v:{version} pattern)
    const v100Metadata = { ...testFunctionMetadata, version: '1.0.0' }
    const v110Metadata = { ...testFunctionMetadata, version: '1.1.0' }
    const v120Metadata = { ...testFunctionMetadata, version: '1.2.0' }

    await mockRegistry.put('registry:my-function:v:1.0.0', JSON.stringify(v100Metadata))
    await mockRegistry.put('registry:my-function:v:1.1.0', JSON.stringify(v110Metadata))
    await mockRegistry.put('registry:my-function:v:1.2.0', JSON.stringify(v120Metadata))

    // Set up function code for each version
    const testFunctionCode = `
      export default {
        async fetch(request) {
          return new Response(JSON.stringify({ message: 'Hello' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    `
    await mockCodeStorage.put('my-function', testFunctionCode)
    await mockCodeStorage.put('my-function@1.0.0', testFunctionCode)
    await mockCodeStorage.put('my-function@1.1.0', testFunctionCode)
    await mockCodeStorage.put('my-function@1.2.0', testFunctionCode)
  })

  describe('Function Metadata Retrieval', () => {
    it('should return function info for GET /api/functions/:id', async () => {
      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
        headers: { 'X-API-Key': 'test-api-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('my-function')
      expect(body['status']).toBe('available')
    })

    it('should include function id in response', async () => {
      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
        headers: { 'X-API-Key': 'test-api-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('my-function')
    })

    it('should include status in response', async () => {
      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
        headers: { 'X-API-Key': 'test-api-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['status']).toBe('available')
    })

    it('should include version property in response', async () => {
      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
        headers: { 'X-API-Key': 'test-api-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body).toHaveProperty('version')
      expect(typeof body['version']).toBe('string')
    })

    it('should include language property in response', async () => {
      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
        headers: { 'X-API-Key': 'test-api-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body).toHaveProperty('language')
      expect(typeof body['language']).toBe('string')
    })
  })

  describe('Function Info Endpoint', () => {
    it('should return function info for GET /v1/api/functions/:id', async () => {
      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'GET',
        headers: { 'X-API-Key': 'test-api-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('my-function')
      expect(body['status']).toBe('available')
    })

    it('should return same data for v1 and legacy endpoints', async () => {
      const request1 = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
        headers: { 'X-API-Key': 'test-api-key' },
      })
      const request2 = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'GET',
        headers: { 'X-API-Key': 'test-api-key' },
      })

      const response1 = await worker.fetch(request1, mockEnv, mockCtx)
      const response2 = await worker.fetch(request2, mockEnv, mockCtx)

      expect(response1.status).toBe(200)
      expect(response2.status).toBe(200)

      const body1 = (await response1.json()) as JsonBody
      const body2 = (await response2.json()) as JsonBody

      expect(body1['id']).toBe(body2['id'])
      expect(body1['status']).toBe(body2['status'])
    })
  })

  describe('404 for Non-Existent Function', () => {
    it('should return 404 for non-existent function ID', async () => {
      const request = new Request('https://functions.do/api/functions/non-existent-function', {
        method: 'GET',
        headers: { 'X-API-Key': 'test-api-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
    })

    it('should return 404 with error message', async () => {
      const request = new Request('https://functions.do/api/functions/non-existent-function', {
        method: 'GET',
        headers: { 'X-API-Key': 'test-api-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBeTruthy()
    })

    it('should return 200 for function with metadata but no code', async () => {
      // Note: The info handler only checks registry, not code storage
      // This test verifies that a function with only metadata returns 200
      // since the info endpoint doesn't require code to exist
      const noCodeFunctionMetadata = {
        id: 'no-code-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:no-code-func', JSON.stringify(noCodeFunctionMetadata))

      const request = new Request('https://functions.do/api/functions/no-code-func', {
        method: 'GET',
        headers: { 'X-API-Key': 'test-api-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Info endpoint returns 200 if metadata exists (code is not required for info)
      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('no-code-func')
    })
  })

  describe('Authentication Requirements', () => {
    it('should require authentication for GET /api/functions/:id', async () => {
      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
        // No API key header
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(401)
    })

    it('should return 401 for missing API key', async () => {
      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
        // No API key
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(401)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Missing authentication')
    })

    it('should return 401 for invalid API key', async () => {
      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
        headers: { 'X-API-Key': 'invalid-key-12345' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(401)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Invalid API key')
    })

    it('should return 401 for expired API key', async () => {
      // Set up an expired API key (stored with keys: prefix and hashed key)
      const expiredKeyHash = await hashApiKey('expired-key')
      await mockApiKeys.put(
        `keys:${expiredKeyHash}`,
        JSON.stringify({
          userId: 'user-456',
          active: true,
          expiresAt: '2020-01-01T00:00:00Z', // Past date
        })
      )

      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
        headers: { 'X-API-Key': 'expired-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(401)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('API key has expired')
    })

    it('should allow access with valid API key', async () => {
      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
        headers: { 'X-API-Key': 'test-api-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('my-function')
    })

    it('should support Authorization Bearer token', async () => {
      // Authorization Bearer is supported by the auth middleware
      // Bearer tokens are validated as API keys if they have the right prefix
      // or tried against OAuth and then API key fallback
      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-api-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Bearer token 'test-api-key' is validated and succeeds since it's stored in KV
      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('my-function')
    })
  })

  describe('Response Format', () => {
    it('should return JSON response with Content-Type header', async () => {
      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
        headers: { 'X-API-Key': 'test-api-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('should return consistent response schema', async () => {
      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
        headers: { 'X-API-Key': 'test-api-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody

      // Verify consistent schema
      expect(body).toHaveProperty('id')
      expect(body).toHaveProperty('status')
      expect(body).toHaveProperty('version')
      expect(body).toHaveProperty('language')
    })
  })

  describe('Edge Cases', () => {
    it('should handle function IDs with hyphens', async () => {
      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
        headers: { 'X-API-Key': 'test-api-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('my-function')
    })

    it('should handle function IDs with alphanumeric characters', async () => {
      // Set up a function with alphanumeric ID (stored with registry: prefix)
      const alphaFunctionMetadata = {
        id: 'func123',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:func123', JSON.stringify(alphaFunctionMetadata))

      const alphaFunctionCode = `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ message: 'Hello' }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('func123', alphaFunctionCode)

      const request = new Request('https://functions.do/api/functions/func123', {
        method: 'GET',
        headers: { 'X-API-Key': 'test-api-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('func123')
    })

    it('should handle concurrent requests', async () => {
      const requests = [
        new Request('https://functions.do/api/functions/my-function', {
          method: 'GET',
          headers: { 'X-API-Key': 'test-api-key' },
        }),
        new Request('https://functions.do/api/functions/my-function', {
          method: 'GET',
          headers: { 'X-API-Key': 'test-api-key' },
        }),
        new Request('https://functions.do/api/functions/my-function', {
          method: 'GET',
          headers: { 'X-API-Key': 'test-api-key' },
        }),
      ]

      const responses = await Promise.all(
        requests.map((req) => worker.fetch(req, mockEnv, mockCtx))
      )

      for (const response of responses) {
        expect(response.status).toBe(200)
        const body = (await response.json()) as JsonBody
        expect(body['id']).toBe('my-function')
      }
    })
  })

  describe('Health Endpoints', () => {
    it('should not require authentication for health endpoint', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['status']).toBe('ok')
      expect(body['service']).toBe('Functions.do')
    })

    it('should not require authentication for root endpoint', async () => {
      const request = new Request('https://functions.do/', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['status']).toBe('ok')
      expect(body['service']).toBe('Functions.do')
    })
  })

  describe('Method Handling', () => {
    it('should return 405 for unsupported methods on api/functions/:id', async () => {
      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'PUT',
        headers: { 'X-API-Key': 'test-api-key' },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(405)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('not allowed')
    })

    it('should return 405 for POST requests on api/functions/:id', async () => {
      // POST is for /api/functions (create) not /api/functions/:id
      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'POST',
        headers: { 'X-API-Key': 'test-api-key' },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(405)
    })

    it('should allow DELETE requests on api/functions/:id', async () => {
      // DELETE is supported on /api/functions/:id
      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'DELETE',
        headers: { 'X-API-Key': 'test-api-key' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // DELETE handler should work (returns 200 or 404 depending on function existence)
      expect([200, 404]).toContain(response.status)
    })
  })

  describe('Without Authentication (FUNCTIONS_API_KEYS not configured)', () => {
    it('should allow access without API key when FUNCTIONS_API_KEYS is not configured', async () => {
      const envWithoutAuth: Env = {
        FUNCTIONS_REGISTRY: mockRegistry,
        FUNCTIONS_CODE: mockCodeStorage,
        // No FUNCTIONS_API_KEYS
      }

      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
      })
      const response = await worker.fetch(request, envWithoutAuth, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('my-function')
    })
  })
})
