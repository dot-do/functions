/**
 * Worker Fetch Handler Routing Tests
 *
 * Tests for the main entry point fetch handler including:
 * - Function ID parsing from URL and headers
 * - GET requests for function info
 * - POST requests for function invocation
 * - Error handling for unknown functions
 * - Method routing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockKV } from '../test-utils/mock-kv'
import type { Env } from '../index'

// Import the default export (the worker) and reset function
import worker, { resetRateLimiter } from '../index'

// Type for JSON response bodies in tests
type JsonBody = Record<string, unknown>

describe('Worker Fetch Handler', () => {
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

    // Set up a test function in the mock KV
    const testFunctionMetadata = {
      id: 'test-func',
      version: '1.0.0',
      language: 'typescript',
      entryPoint: 'index.ts',
      dependencies: {},
    }
    await mockRegistry.put('test-func', JSON.stringify(testFunctionMetadata))

    const testFunctionCode = `
      export default {
        async fetch(request) {
          return new Response(JSON.stringify({ message: 'Hello from test-func' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    `
    await mockCodeStorage.put('test-func', testFunctionCode)
  })

  afterEach(() => {
    // Reset rate limiter after each test
    resetRateLimiter()
  })

  describe('Health Check Endpoints', () => {
    it('should return health status for root path', async () => {
      const request = new Request('https://functions.do/')
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body).toEqual({ status: 'ok', service: 'Functions.do' })
    })

    it('should return health status for /health path', async () => {
      const request = new Request('https://functions.do/health')
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body).toEqual({ status: 'ok', service: 'Functions.do' })
    })
  })

  describe('Function ID Parsing', () => {
    it('should parse function ID from URL path /functions/:functionId', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('test-func')
    })

    it('should parse function ID from X-Function-Id header', async () => {
      const request = new Request('https://functions.do/invoke', {
        method: 'GET',
        headers: { 'X-Function-Id': 'test-func' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('test-func')
    })

    it('should prefer URL path over header when both are present', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'X-Function-Id': 'other-func' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('test-func')
    })

    it('should return 400 when no function ID is provided', async () => {
      const request = new Request('https://functions.do/invoke', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Function ID required')
    })
  })

  describe('GET Requests - Function Info', () => {
    it('should return function info for GET /functions/:functionId', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')

      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('test-func')
      expect(body['status']).toBe('loaded')
      expect(body).toHaveProperty('fromCache')
      expect(body).toHaveProperty('loadTimeMs')
    })

    it('should return function info for GET /functions/:functionId/info', async () => {
      const request = new Request('https://functions.do/functions/test-func/info', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('test-func')
      expect(body['status']).toBe('loaded')
    })
  })

  describe('POST Requests - Function Invocation', () => {
    it('should invoke function via POST and return JSON response', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')

      const body = (await response.json()) as JsonBody
      expect(body['message']).toBe('Hello from test-func')
    })

    it('should invoke function via POST /functions/:functionId/invoke', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })

    it('should return 400 for invalid JSON body', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
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

  describe('Error Handling', () => {
    it('should return 404 for unknown function', async () => {
      const request = new Request('https://functions.do/functions/non-existent', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBeTruthy()
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
      expect(body['error']).toContain('not found')
    })
  })

  describe('Method Routing', () => {
    it('should return 405 for unsupported HTTP methods', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'DELETE',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(405)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('not allowed')
    })

    it('should return 405 for PUT requests', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'PUT',
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(405)
    })

    it('should return 405 for PATCH requests', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'PATCH',
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(405)
    })
  })

  describe('RPC-style Invocation', () => {
    beforeEach(async () => {
      // Set up an RPC-capable function
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
              // RPC request
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

  describe('Response Content-Type Handling', () => {
    beforeEach(async () => {
      // Set up a function that returns plain text
      const textFunctionMetadata = {
        id: 'text-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('text-func', JSON.stringify(textFunctionMetadata))

      const textFunctionCode = `
        export default {
          async fetch(request) {
            return new Response('Hello, plain text!', {
              headers: { 'Content-Type': 'text/plain' }
            });
          }
        }
      `
      await mockCodeStorage.put('text-func', textFunctionCode)
    })

    it('should wrap non-JSON responses in JSON envelope', async () => {
      const request = new Request('https://functions.do/functions/text-func', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')

      const body = (await response.json()) as JsonBody
      expect(body['result']).toBe('Hello, plain text!')
      expect(body['status']).toBe(200)
    })
  })

  describe('Authentication', () => {
    let mockApiKeys: KVNamespace

    beforeEach(() => {
      mockApiKeys = createMockKV()
    })

    describe('When API_KEYS KV is configured', () => {
      beforeEach(async () => {
        // Add mock env with API_KEYS
        mockEnv = {
          ...mockEnv,
          API_KEYS: mockApiKeys,
        }

        // Set up a valid API key
        await mockApiKeys.put(
          'valid-api-key-123',
          JSON.stringify({
            userId: 'user-456',
            active: true,
          })
        )

        // Set up an inactive API key
        await mockApiKeys.put(
          'inactive-key',
          JSON.stringify({
            userId: 'user-789',
            active: false,
          })
        )

        // Set up an expired API key
        await mockApiKeys.put(
          'expired-key',
          JSON.stringify({
            userId: 'user-expired',
            active: true,
            expiresAt: '2020-01-01T00:00:00Z',
          })
        )
      })

      it('should return 401 for missing API key on protected endpoint', async () => {
        const request = new Request('https://functions.do/functions/test-func', {
          method: 'GET',
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(401)
        const body = (await response.json()) as JsonBody
        expect(body['error']).toBe('Missing API key')
      })

      it('should return 401 for invalid API key', async () => {
        const request = new Request('https://functions.do/functions/test-func', {
          method: 'GET',
          headers: { 'X-API-Key': 'invalid-key' },
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(401)
        const body = (await response.json()) as JsonBody
        expect(body['error']).toBe('Invalid API key')
      })

      it('should return 401 for inactive API key', async () => {
        const request = new Request('https://functions.do/functions/test-func', {
          method: 'GET',
          headers: { 'X-API-Key': 'inactive-key' },
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(401)
        const body = (await response.json()) as JsonBody
        expect(body['error']).toBe('Invalid API key')
      })

      it('should return 401 for expired API key', async () => {
        const request = new Request('https://functions.do/functions/test-func', {
          method: 'GET',
          headers: { 'X-API-Key': 'expired-key' },
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(401)
        const body = (await response.json()) as JsonBody
        expect(body['error']).toBe('Invalid API key')
      })

      it('should allow request with valid API key', async () => {
        const request = new Request('https://functions.do/functions/test-func', {
          method: 'GET',
          headers: { 'X-API-Key': 'valid-api-key-123' },
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(200)
        const body = (await response.json()) as JsonBody
        expect(body['id']).toBe('test-func')
      })

      it('should allow health endpoint without authentication', async () => {
        const request = new Request('https://functions.do/health')
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(200)
        const body = (await response.json()) as JsonBody
        expect(body).toEqual({ status: 'ok', service: 'Functions.do' })
      })

      it('should allow root endpoint without authentication', async () => {
        const request = new Request('https://functions.do/')
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(200)
        const body = (await response.json()) as JsonBody
        expect(body).toEqual({ status: 'ok', service: 'Functions.do' })
      })
    })

    describe('Custom public endpoints', () => {
      beforeEach(async () => {
        // Add mock env with API_KEYS and custom public endpoints
        mockEnv = {
          ...mockEnv,
          API_KEYS: mockApiKeys,
          PUBLIC_ENDPOINTS: '/public/*,/api/v1/status',
        }

        // Set up a valid API key
        await mockApiKeys.put(
          'valid-key',
          JSON.stringify({
            active: true,
          })
        )
      })

      it('should allow custom public endpoints without auth', async () => {
        // Note: This tests the path pattern matching, not actual function invocation
        // The /public/anything path would normally need a function, but we're testing auth bypass
        const request = new Request('https://functions.do/api/v1/status', {
          method: 'GET',
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)

        // Should get 400 (function ID required) not 401 (unauthorized)
        expect(response.status).toBe(400)
        const body = (await response.json()) as JsonBody
        expect(body['error']).toContain('Function ID required')
      })

      it('should still require auth for non-public endpoints', async () => {
        const request = new Request('https://functions.do/functions/test-func', {
          method: 'GET',
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(401)
      })
    })

    describe('Without API_KEYS KV (auth disabled)', () => {
      it('should skip authentication when API_KEYS is not configured', async () => {
        // mockEnv without API_KEYS
        const envWithoutAuth = {
          REGISTRY: mockRegistry,
          CODE: mockCodeStorage,
        }

        const request = new Request('https://functions.do/functions/test-func', {
          method: 'GET',
        })
        const response = await worker.fetch(request, envWithoutAuth, mockCtx)

        expect(response.status).toBe(200)
        const body = (await response.json()) as JsonBody
        expect(body['id']).toBe('test-func')
      })
    })
  })

  describe('Rate Limiting', () => {
    beforeEach(() => {
      // Reset rate limiter before each rate limit test
      resetRateLimiter()
    })

    it('should include rate limit headers in successful responses', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '192.168.1.1' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })

    it('should rate limit by IP address', async () => {
      // Configure a very restrictive rate limit for testing
      const { configureRateLimiter } = await import('../index')
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 3 },
        function: { windowMs: 60_000, maxRequests: 1000 },
      })

      // Make requests from the same IP
      for (let i = 0; i < 3; i++) {
        const request = new Request('https://functions.do/functions/test-func', {
          method: 'GET',
          headers: { 'CF-Connecting-IP': '10.0.0.1' },
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)
        expect(response.status).toBe(200)
      }

      // Fourth request should be rate limited
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(429)
      expect(response.headers.get('Retry-After')).toBeTruthy()
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')

      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Too Many Requests')
      expect(body['message']).toContain('ip')
    })

    it('should rate limit by function ID', async () => {
      // Configure a very restrictive function rate limit
      const { configureRateLimiter } = await import('../index')
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 1000 },
        function: { windowMs: 60_000, maxRequests: 2 },
      })

      // Make requests from different IPs to the same function
      for (let i = 0; i < 2; i++) {
        const request = new Request('https://functions.do/functions/test-func', {
          method: 'GET',
          headers: { 'CF-Connecting-IP': `10.0.0.${i + 1}` },
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)
        expect(response.status).toBe(200)
      }

      // Third request should be rate limited (function limit exceeded)
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '10.0.0.100' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(429)
      const body = (await response.json()) as JsonBody
      expect(body['message']).toContain('function')
    })

    it('should allow requests from different IPs independently', async () => {
      const { configureRateLimiter } = await import('../index')
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 2 },
        function: { windowMs: 60_000, maxRequests: 1000 },
      })

      // Exhaust limit for IP 1
      for (let i = 0; i < 2; i++) {
        const request = new Request('https://functions.do/functions/test-func', {
          method: 'GET',
          headers: { 'CF-Connecting-IP': '192.168.1.1' },
        })
        await worker.fetch(request, mockEnv, mockCtx)
      }

      // IP 1 should be rate limited
      const requestIP1 = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '192.168.1.1' },
      })
      const responseIP1 = await worker.fetch(requestIP1, mockEnv, mockCtx)
      expect(responseIP1.status).toBe(429)

      // IP 2 should still be allowed
      const requestIP2 = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '192.168.1.2' },
      })
      const responseIP2 = await worker.fetch(requestIP2, mockEnv, mockCtx)
      expect(responseIP2.status).toBe(200)
    })

    it('should not rate limit health check endpoint', async () => {
      const { configureRateLimiter } = await import('../index')
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 1 },
        function: { windowMs: 60_000, maxRequests: 1 },
      })

      // Health check should bypass rate limiting
      for (let i = 0; i < 10; i++) {
        const request = new Request('https://functions.do/health', {
          headers: { 'CF-Connecting-IP': '10.0.0.1' },
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)
        expect(response.status).toBe(200)
      }
    })

    it('should return 429 response with proper JSON body', async () => {
      const { configureRateLimiter } = await import('../index')
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 1 },
        function: { windowMs: 60_000, maxRequests: 1000 },
      })

      // First request should succeed
      const request1 = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      await worker.fetch(request1, mockEnv, mockCtx)

      // Second request should be rate limited
      const request2 = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      const response = await worker.fetch(request2, mockEnv, mockCtx)

      expect(response.status).toBe(429)
      expect(response.headers.get('Content-Type')).toBe('application/json')

      const body = (await response.json()) as JsonBody
      expect(body).toHaveProperty('error')
      expect(body).toHaveProperty('message')
      expect(body).toHaveProperty('retryAfter')
      expect(body).toHaveProperty('resetAt')
      expect(typeof body['retryAfter']).toBe('number')
      expect(typeof body['resetAt']).toBe('number')
    })

    it('should extract IP from X-Forwarded-For when CF-Connecting-IP is not present', async () => {
      const { configureRateLimiter } = await import('../index')
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 2 },
        function: { windowMs: 60_000, maxRequests: 1000 },
      })

      // Make requests using X-Forwarded-For
      for (let i = 0; i < 2; i++) {
        const request = new Request('https://functions.do/functions/test-func', {
          method: 'GET',
          headers: { 'X-Forwarded-For': '203.0.113.195, 70.41.3.18' },
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)
        expect(response.status).toBe(200)
      }

      // Third request should be rate limited
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'X-Forwarded-For': '203.0.113.195, 70.41.3.18' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)
      expect(response.status).toBe(429)
    })
  })
})
