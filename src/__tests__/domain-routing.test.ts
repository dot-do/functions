/**
 * Domain Routing Tests for functions.do
 *
 * Tests for the routing behavior on the functions.do domain:
 * - GET / and /health return health status
 * - GET /functions/:functionId returns function info
 * - POST /functions/:functionId invokes the function
 * - X-Function-Id header for function identification
 * - 404 for non-existent functions
 * - 400 for missing function ID
 *
 * @see https://github.com/drivly/ai/issues/functions-i9b
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockKV } from '../test-utils/mock-kv'
import type { Env } from '../index'
import worker, { resetRateLimiter } from '../index'

// Type for JSON response bodies in tests
type JsonBody = Record<string, unknown>

describe('Domain Routing - functions.do', () => {
  let mockEnv: Env
  let mockRegistry: KVNamespace
  let mockCodeStorage: KVNamespace
  let mockCtx: ExecutionContext

  beforeEach(async () => {
    // Reset rate limiter before each test
    resetRateLimiter()

    mockRegistry = createMockKV()
    mockCodeStorage = createMockKV()
    mockEnv = {
      REGISTRY: mockRegistry,
      CODE: mockCodeStorage,
    }
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext

    // Set up test functions in the mock KV
    const testFunctionMetadata = {
      id: 'hello-world',
      version: '1.0.0',
      language: 'typescript',
      entryPoint: 'index.ts',
      dependencies: {},
    }
    await mockRegistry.put('hello-world', JSON.stringify(testFunctionMetadata))

    const testFunctionCode = `
      export default {
        async fetch(request) {
          const url = new URL(request.url);
          return new Response(JSON.stringify({
            message: 'Hello from hello-world',
            path: url.pathname,
            method: request.method
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    `
    await mockCodeStorage.put('hello-world', testFunctionCode)

    // Set up another test function
    const mathFunctionMetadata = {
      id: 'math-utils',
      version: '1.0.0',
      language: 'typescript',
      entryPoint: 'index.ts',
      dependencies: {},
    }
    await mockRegistry.put('math-utils', JSON.stringify(mathFunctionMetadata))

    const mathFunctionCode = `
      export default {
        async fetch(request) {
          const body = await request.json().catch(() => ({}));
          const result = (body.a || 0) + (body.b || 0);
          return new Response(JSON.stringify({
            result,
            operation: 'add'
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    `
    await mockCodeStorage.put('math-utils', mathFunctionCode)
  })

  afterEach(() => {
    resetRateLimiter()
  })

  describe('Root Path Routing', () => {
    it('should return health status for GET /', async () => {
      const request = new Request('https://functions.do/')
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody

      // Root path returns health status
      expect(body).toHaveProperty('status', 'ok')
      expect(body).toHaveProperty('service', 'Functions.do')
    })
  })

  describe('Health Check Endpoint', () => {
    it('should return health status for GET /health', async () => {
      const request = new Request('https://functions.do/health')
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body).toHaveProperty('status', 'ok')
      expect(body).toHaveProperty('service', 'Functions.do')
    })
  })

  describe('Function Routing - GET /functions/:functionId', () => {
    it('should return function info via GET /functions/:functionId', async () => {
      const request = new Request('https://functions.do/functions/hello-world', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')

      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('hello-world')
      expect(body['status']).toBe('loaded')
    })

    it('should return function info via GET /functions/:functionId/info', async () => {
      const request = new Request('https://functions.do/functions/hello-world/info', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('hello-world')
      expect(body['status']).toBe('loaded')
    })

    it('should return 404 for non-existent function via GET /functions/:functionId', async () => {
      const request = new Request('https://functions.do/functions/non-existent-func', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      expect(body).toHaveProperty('error')
    })
  })

  describe('Function Routing - POST /functions/:functionId', () => {
    it('should invoke function via POST /functions/:functionId with JSON body', async () => {
      const request = new Request('https://functions.do/functions/hello-world', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')

      const body = (await response.json()) as JsonBody
      expect(body['message']).toBe('Hello from hello-world')
    })

    it('should invoke function via POST /functions/:functionId/invoke', async () => {
      const request = new Request('https://functions.do/functions/hello-world/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')

      const body = (await response.json()) as JsonBody
      expect(body['message']).toBe('Hello from hello-world')
    })

    it('should return 404 for non-existent function via POST /functions/:functionId', async () => {
      const request = new Request('https://functions.do/functions/non-existent-func', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      expect(body).toHaveProperty('error')
    })

    it('should return 400 for invalid JSON body', async () => {
      const request = new Request('https://functions.do/functions/hello-world', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json{',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Invalid JSON')
    })
  })

  describe('X-Function-Id Header Routing', () => {
    it('should identify function via X-Function-Id header', async () => {
      const request = new Request('https://functions.do/invoke', {
        method: 'POST',
        headers: {
          'X-Function-Id': 'hello-world',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['message']).toBe('Hello from hello-world')
    })

    it('should get function info via X-Function-Id header with GET', async () => {
      const request = new Request('https://functions.do/invoke', {
        method: 'GET',
        headers: {
          'X-Function-Id': 'hello-world',
        },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('hello-world')
      expect(body['status']).toBe('loaded')
    })

    it('should prefer URL path over header when both are present', async () => {
      const request = new Request('https://functions.do/functions/hello-world', {
        method: 'GET',
        headers: { 'X-Function-Id': 'math-utils' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('hello-world')
    })
  })

  describe('Missing Function ID', () => {
    it('should return 400 when no function ID is provided', async () => {
      const request = new Request('https://functions.do/invoke', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Function ID required')
    })

    it('should return 400 for paths that do not match /functions/:id pattern', async () => {
      const request = new Request('https://functions.do/some-random-path', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Function ID required')
    })
  })

  describe('404 Error Handling', () => {
    it('should return 404 with proper JSON error for non-existent function', async () => {
      const request = new Request('https://functions.do/functions/non-existent-function', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
      expect(response.headers.get('Content-Type')).toBe('application/json')

      const body = (await response.json()) as JsonBody
      expect(body).toHaveProperty('error')
      expect(String(body['error']).toLowerCase()).toContain('not found')
    })

    it('should return 404 when function metadata exists but code is missing', async () => {
      // Set up a function with metadata but no code
      const noCodeFunctionMetadata = {
        id: 'no-code-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('no-code-func', JSON.stringify(noCodeFunctionMetadata))
      // Intentionally don't add code

      const request = new Request('https://functions.do/functions/no-code-func', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      expect(String(body['error']).toLowerCase()).toContain('not found')
    })
  })

  describe('HTTP Method Support', () => {
    it('should return 405 for unsupported PUT method', async () => {
      const request = new Request('https://functions.do/functions/hello-world', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'update' }),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(405)
      const body = (await response.json()) as JsonBody
      expect(String(body['error']).toLowerCase()).toContain('not allowed')
    })

    it('should return 405 for unsupported PATCH method', async () => {
      const request = new Request('https://functions.do/functions/hello-world', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'patch' }),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(405)
      const body = (await response.json()) as JsonBody
      expect(String(body['error']).toLowerCase()).toContain('not allowed')
    })

    it('should return 405 for unsupported DELETE method', async () => {
      const request = new Request('https://functions.do/functions/hello-world', {
        method: 'DELETE',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(405)
      const body = (await response.json()) as JsonBody
      expect(String(body['error']).toLowerCase()).toContain('not allowed')
    })
  })

  describe('Routing Priority', () => {
    it('should prioritize /health over /:functionId even if function named "health" exists', async () => {
      // Set up a function named "health"
      const healthFunctionMetadata = {
        id: 'health',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('health', JSON.stringify(healthFunctionMetadata))

      const healthFunctionCode = `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ message: 'Function health' }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('health', healthFunctionCode)

      const request = new Request('https://functions.do/health', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      // Should return system health, not the function
      expect(body).toHaveProperty('status', 'ok')
      expect(body).toHaveProperty('service', 'Functions.do')
    })

    it('should prioritize root / route over functions', async () => {
      const request = new Request('https://functions.do/', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body).toHaveProperty('status', 'ok')
      expect(body).toHaveProperty('service', 'Functions.do')
    })
  })

  describe('Function ID Validation', () => {
    it('should accept valid function IDs with alphanumeric and hyphens', async () => {
      const request = new Request('https://functions.do/functions/hello-world', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })

    it('should reject function IDs with invalid characters', async () => {
      const request = new Request('https://functions.do/functions/hello_world!', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body).toHaveProperty('error')
    })
  })

  describe('Response Content Type', () => {
    it('should return JSON content type for function info', async () => {
      const request = new Request('https://functions.do/functions/hello-world', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('should return JSON content type for errors', async () => {
      const request = new Request('https://functions.do/functions/non-existent', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
      expect(response.headers.get('Content-Type')).toBe('application/json')
    })
  })

  describe('Function Loading Info', () => {
    it('should include loading metadata in function info response', async () => {
      const request = new Request('https://functions.do/functions/hello-world', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body).toHaveProperty('id')
      expect(body).toHaveProperty('status')
      expect(body).toHaveProperty('fromCache')
      expect(body).toHaveProperty('loadTimeMs')
    })
  })

  describe('RPC-style Invocation', () => {
    beforeEach(async () => {
      // Set up an RPC-capable function that understands JSON-RPC format
      const rpcFunctionMetadata = {
        id: 'rpc-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('rpc-func', JSON.stringify(rpcFunctionMetadata))

      const rpcFunctionCode = `
        export default {
          async fetch(request) {
            const body = await request.json();
            if (body.id && body.method) {
              // RPC request - return result in JSON-RPC format
              return new Response(JSON.stringify({
                id: body.id,
                result: { computed: true, method: body.method }
              }), {
                headers: { 'Content-Type': 'application/json' }
              });
            }
            return new Response(JSON.stringify({ message: 'RPC function' }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('rpc-func', rpcFunctionCode)
    })

    it('should invoke RPC method when method is specified in body', async () => {
      const request = new Request('https://functions.do/functions/rpc-func', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'calculate',
          params: [1, 2, 3],
        }),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body).toHaveProperty('result')
    })
  })
})
