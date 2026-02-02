/**
 * Hono API Router Tests
 *
 * Tests for the API router following the fsx.do/gitx.do pattern.
 * These tests verify the expected routes and middleware behavior for
 * the Functions.do API.
 *
 * Architecture:
 * - Hono app for routing (via worker fetch handler)
 * - Authentication middleware
 * - Rate limiting middleware
 * - Error handling middleware
 * - Health check endpoint (/health)
 * - Function management endpoints (/functions/*)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockKV } from '../test-utils/mock-kv'
import type { Env } from '../index'

// Import the default export (the worker) and utility functions
import worker, { resetRateLimiter, configureRateLimiter } from '../index'

// Type for JSON response bodies in tests
type JsonBody = Record<string, unknown>

describe('Hono API Router', () => {
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
      FUNCTIONS_REGISTRY: mockRegistry,
      FUNCTIONS_CODE: mockCodeStorage,
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
    await mockRegistry.put('registry:test-func', JSON.stringify(testFunctionMetadata))

    const testFunctionCode = `
      export default {
        async fetch(request) {
          return new Response(JSON.stringify({ message: 'Hello from test-func' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    `
    await mockCodeStorage.put('code:test-func', testFunctionCode)
  })

  afterEach(() => {
    // Reset rate limiter after each test
    resetRateLimiter()
  })

  describe('App Initialization', () => {
    it('should have a fetch handler', async () => {
      expect(worker).toBeDefined()
      expect(typeof worker.fetch).toBe('function')
    })

    it('should accept environment bindings configuration', async () => {
      // The worker should work with typed environment bindings
      const request = new Request('https://functions.do/health')
      const response = await worker.fetch(request, mockEnv, mockCtx)
      expect(response.status).toBe(200)
    })

    it('should export the app as default for Cloudflare Workers', async () => {
      // The default export should have a fetch method
      expect(worker.fetch).toBeDefined()
      expect(typeof worker.fetch).toBe('function')
    })
  })

  describe('Health Check Endpoint', () => {
    it('should respond to GET /health with status ok', async () => {
      const request = new Request('https://functions.do/health')
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['status']).toBe('ok')
      expect(body['service']).toBe('Functions.do')
    })

    it('should respond to GET / with service info', async () => {
      const request = new Request('https://functions.do/')
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['status']).toBe('ok')
      expect(body['service']).toBe('Functions.do')
    })

    it('should not require authentication for health endpoints', async () => {
      // Set up auth
      const mockApiKeys = createMockKV()
      const envWithAuth: Env = {
        ...mockEnv,
        FUNCTIONS_API_KEYS: mockApiKeys,
      }

      // Health endpoint should be accessible without API key
      const request = new Request('https://functions.do/health')
      const response = await worker.fetch(request, envWithAuth, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['status']).toBe('ok')
    })
  })

  describe('API Documentation Endpoint', () => {
    it('should return service info at root endpoint for API docs', async () => {
      // The root endpoint provides basic API info
      const request = new Request('https://functions.do/')
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('should include service name in documentation response', async () => {
      const request = new Request('https://functions.do/')
      const response = await worker.fetch(request, mockEnv, mockCtx)

      const body = (await response.json()) as JsonBody
      expect(body['service']).toBeDefined()
    })

    it('should not require authentication for root endpoint', async () => {
      const mockApiKeys = createMockKV()
      const envWithAuth: Env = {
        ...mockEnv,
        FUNCTIONS_API_KEYS: mockApiKeys,
      }

      const request = new Request('https://functions.do/')
      const response = await worker.fetch(request, envWithAuth, mockCtx)

      expect(response.status).toBe(200)
    })
  })

  describe('Function Management Routes (/functions)', () => {
    describe('GET /functions/:functionId', () => {
      it('should return function metadata', async () => {
        const request = new Request('https://functions.do/functions/test-func', {
          method: 'GET',
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(200)
        const body = (await response.json()) as JsonBody
        expect(body['id']).toBe('test-func')
        expect(body['status']).toBe('available')
        expect(body).toHaveProperty('version')
        expect(body).toHaveProperty('language')
      })

      it('should return 404 for non-existent function', async () => {
        const request = new Request('https://functions.do/functions/non-existent', {
          method: 'GET',
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(404)
        const body = (await response.json()) as JsonBody
        expect(body['error']).toBeTruthy()
      })
    })

    describe('GET /functions/:functionId/info', () => {
      it('should return function info with explicit /info path', async () => {
        const request = new Request('https://functions.do/functions/test-func/info', {
          method: 'GET',
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(200)
        const body = (await response.json()) as JsonBody
        expect(body['id']).toBe('test-func')
        expect(body['status']).toBe('available')
      })
    })

    describe('POST /functions/:functionId', () => {
      it('should invoke a function', async () => {
        const request = new Request('https://functions.do/functions/test-func', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('application/json')
      })

      it('should validate function ID format', async () => {
        // Invalid function ID with special characters
        const request = new Request('https://functions.do/functions/invalid..func', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(400)
        const body = (await response.json()) as JsonBody
        expect(body['error']).toBeTruthy()
      })
    })

    describe('POST /functions/:functionId/invoke', () => {
      it('should invoke a function and return result', async () => {
        const request = new Request('https://functions.do/functions/test-func/invoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(200)
      })

      it('should pass request body to function', async () => {
        const request = new Request('https://functions.do/functions/test-func/invoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: 'test-data' }),
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(200)
        const body = (await response.json()) as JsonBody
        expect(body['message']).toBe('Hello from test-func')
      })

      it('should handle function execution errors gracefully', async () => {
        // Set up a function that throws an error
        const errorFunctionMetadata = {
          id: 'error-func',
          version: '1.0.0',
          language: 'typescript',
          entryPoint: 'index.ts',
          dependencies: {},
        }
        await mockRegistry.put('registry:error-func', JSON.stringify(errorFunctionMetadata))

        const errorFunctionCode = `
          export default {
            async fetch(request) {
              throw new Error('Intentional error');
            }
          }
        `
        await mockCodeStorage.put('code:error-func', errorFunctionCode)

        const request = new Request('https://functions.do/functions/error-func/invoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(500)
        const body = (await response.json()) as JsonBody
        expect(body['error']).toBeTruthy()
      })
    })

    describe('Unsupported Methods', () => {
      it('should return 405 for PUT requests', async () => {
        const request = new Request('https://functions.do/functions/test-func', {
          method: 'PUT',
          body: JSON.stringify({}),
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(405)
        const body = (await response.json()) as JsonBody
        expect(body['error']).toContain('not allowed')
      })

      it('should return 405 for DELETE requests', async () => {
        const request = new Request('https://functions.do/functions/test-func', {
          method: 'DELETE',
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)

        expect(response.status).toBe(405)
      })
    })
  })

  describe('Authentication Middleware', () => {
    let mockApiKeys: KVNamespace
    let envWithAuth: Env

    beforeEach(async () => {
      mockApiKeys = createMockKV()
      envWithAuth = {
        ...mockEnv,
        FUNCTIONS_API_KEYS: mockApiKeys,
      }

      // Set up a valid API key
      await mockApiKeys.put(
        'valid-api-key-123',
        JSON.stringify({
          userId: 'user-456',
          active: true,
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

    it('should extract API key from X-API-Key header', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'X-API-Key': 'valid-api-key-123' },
      })
      const response = await worker.fetch(request, envWithAuth, mockCtx)

      expect(response.status).toBe(200)
    })

    it('should return 401 for missing API key on protected routes', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
      })
      const response = await worker.fetch(request, envWithAuth, mockCtx)

      expect(response.status).toBe(401)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Missing API key')
    })

    it('should return 401 for invalid API key', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'X-API-Key': 'invalid-key' },
      })
      const response = await worker.fetch(request, envWithAuth, mockCtx)

      expect(response.status).toBe(401)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Invalid API key')
    })

    it('should return 401 for expired API key', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'X-API-Key': 'expired-key' },
      })
      const response = await worker.fetch(request, envWithAuth, mockCtx)

      expect(response.status).toBe(401)
    })

    it('should skip authentication for public endpoints', async () => {
      // Health endpoint should be public
      const request = new Request('https://functions.do/health')
      const response = await worker.fetch(request, envWithAuth, mockCtx)

      expect(response.status).toBe(200)
    })
  })

  describe('Rate Limiting Middleware', () => {
    beforeEach(() => {
      resetRateLimiter()
    })

    it('should rate limit by client IP address', async () => {
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 2 },
        function: { windowMs: 60_000, maxRequests: 1000 },
      })

      // Make requests from the same IP
      for (let i = 0; i < 2; i++) {
        const request = new Request('https://functions.do/functions/test-func', {
          method: 'GET',
          headers: { 'CF-Connecting-IP': '10.0.0.1' },
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)
        expect(response.status).toBe(200)
      }

      // Third request should be rate limited
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(429)
    })

    it('should rate limit by function ID', async () => {
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

      // Third request should be rate limited
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '10.0.0.100' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(429)
      const body = (await response.json()) as JsonBody
      expect(body['message']).toContain('function')
    })

    it('should return 429 when rate limit exceeded', async () => {
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
    })

    it('should include rate limit headers in response', async () => {
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 1 },
        function: { windowMs: 60_000, maxRequests: 1000 },
      })

      // First request
      const request1 = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      await worker.fetch(request1, mockEnv, mockCtx)

      // Rate limited request
      const request2 = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      const response = await worker.fetch(request2, mockEnv, mockCtx)

      expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
    })

    it('should include Retry-After header when rate limited', async () => {
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 1 },
        function: { windowMs: 60_000, maxRequests: 1000 },
      })

      // First request
      const request1 = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      await worker.fetch(request1, mockEnv, mockCtx)

      // Rate limited request
      const request2 = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      const response = await worker.fetch(request2, mockEnv, mockCtx)

      expect(response.headers.get('Retry-After')).toBeTruthy()
    })

    it('should not rate limit health endpoints', async () => {
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 1 },
        function: { windowMs: 60_000, maxRequests: 1 },
      })

      // Multiple health check requests should all succeed
      for (let i = 0; i < 5; i++) {
        const request = new Request('https://functions.do/health', {
          headers: { 'CF-Connecting-IP': '10.0.0.1' },
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)
        expect(response.status).toBe(200)
      }
    })

    it('should support configurable rate limits', async () => {
      // Configure custom rate limits
      configureRateLimiter({
        ip: { windowMs: 30_000, maxRequests: 5 },
        function: { windowMs: 60_000, maxRequests: 10 },
      })

      // Should allow 5 requests
      for (let i = 0; i < 5; i++) {
        const request = new Request('https://functions.do/functions/test-func', {
          method: 'GET',
          headers: { 'CF-Connecting-IP': '10.0.0.1' },
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)
        expect(response.status).toBe(200)
      }

      // 6th request should be rate limited
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)
      expect(response.status).toBe(429)
    })
  })

  describe('Error Handling Middleware', () => {
    it('should catch and format unhandled errors', async () => {
      // Request for non-existent function
      const request = new Request('https://functions.do/functions/non-existent', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
      expect(response.headers.get('Content-Type')).toBe('application/json')
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBeTruthy()
    })

    it('should return appropriate HTTP status codes', async () => {
      // 400 for validation errors
      const badRequest = new Request('https://functions.do/invoke', {
        method: 'GET',
      })
      const badResponse = await worker.fetch(badRequest, mockEnv, mockCtx)
      expect(badResponse.status).toBe(400)

      // 404 for not found
      const notFoundRequest = new Request('https://functions.do/functions/not-found', {
        method: 'GET',
      })
      const notFoundResponse = await worker.fetch(notFoundRequest, mockEnv, mockCtx)
      expect(notFoundResponse.status).toBe(404)

      // 405 for method not allowed
      const methodRequest = new Request('https://functions.do/functions/test-func', {
        method: 'DELETE',
      })
      const methodResponse = await worker.fetch(methodRequest, mockEnv, mockCtx)
      expect(methodResponse.status).toBe(405)
    })

    it('should handle JSON parsing errors', async () => {
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

    it('should include validation error details', async () => {
      // Request without required function ID
      const request = new Request('https://functions.do/invoke', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Function ID required')
    })
  })

  describe('Request/Response Handling', () => {
    it('should parse JSON request bodies', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'value' }),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })

    it('should return JSON responses with Content-Type header', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('should extract request headers', async () => {
      // The X-Function-Id header should be extracted
      const request = new Request('https://functions.do/invoke', {
        method: 'GET',
        headers: { 'X-Function-Id': 'test-func' },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('test-func')
    })
  })

  describe('Route Definitions', () => {
    it('should handle /functions/:functionId pattern', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('test-func')
    })

    it('should support typed route parameters', async () => {
      // functionId should be extracted from the URL
      const request = new Request('https://functions.do/functions/my-function-123', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Will return 404 because function doesn't exist, but we're testing parameter extraction
      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      // The error message should reference the function by ID
      expect(body['error']).toBeTruthy()
    })

    it('should return 400 for requests without function ID', async () => {
      const request = new Request('https://functions.do/invoke', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Function ID required')
    })
  })

  describe('Middleware Integration', () => {
    it('should apply authentication before rate limiting', async () => {
      const mockApiKeys = createMockKV()
      const envWithAuth: Env = {
        ...mockEnv,
        FUNCTIONS_API_KEYS: mockApiKeys,
      }

      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 100 },
        function: { windowMs: 60_000, maxRequests: 100 },
      })

      // Without API key, should get 401 (auth) not 429 (rate limit)
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
      })
      const response = await worker.fetch(request, envWithAuth, mockCtx)

      expect(response.status).toBe(401)
    })

    it('should pass context through middleware chain', async () => {
      // A successful request goes through all middleware
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('test-func')
      expect(body['status']).toBe('available')
    })
  })
})

describe('Router Integration with Current Worker', () => {
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

    // Set up a test function
    const testFunctionMetadata = {
      id: 'test-func',
      version: '1.0.0',
      language: 'typescript',
      entryPoint: 'index.ts',
      dependencies: {},
    }
    await mockRegistry.put('registry:test-func', JSON.stringify(testFunctionMetadata))

    const testFunctionCode = `
      export default {
        async fetch(request) {
          return new Response(JSON.stringify({ message: 'Hello' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    `
    await mockCodeStorage.put('code:test-func', testFunctionCode)
  })

  afterEach(() => {
    resetRateLimiter()
  })

  it('should be compatible with existing Env interface', async () => {
    // The Env interface includes FUNCTIONS_REGISTRY, FUNCTIONS_CODE, and optional FUNCTIONS_API_KEYS
    const request = new Request('https://functions.do/functions/test-func', {
      method: 'GET',
    })
    const response = await worker.fetch(request, mockEnv, mockCtx)

    expect(response.status).toBe(200)
  })

  it('should integrate with existing auth utilities', async () => {
    const mockApiKeys = createMockKV()
    await mockApiKeys.put(
      'test-key',
      JSON.stringify({ active: true, userId: 'user-1' })
    )

    const envWithAuth: Env = {
      ...mockEnv,
      FUNCTIONS_API_KEYS: mockApiKeys,
    }

    // Without key - should fail
    const request1 = new Request('https://functions.do/functions/test-func', {
      method: 'GET',
    })
    const response1 = await worker.fetch(request1, envWithAuth, mockCtx)
    expect(response1.status).toBe(401)

    // With key - should succeed
    const request2 = new Request('https://functions.do/functions/test-func', {
      method: 'GET',
      headers: { 'X-API-Key': 'test-key' },
    })
    const response2 = await worker.fetch(request2, envWithAuth, mockCtx)
    expect(response2.status).toBe(200)
  })

  it('should integrate with existing rate limiter', async () => {
    configureRateLimiter({
      ip: { windowMs: 60_000, maxRequests: 2 },
      function: { windowMs: 60_000, maxRequests: 1000 },
    })

    // Make requests until rate limited
    for (let i = 0; i < 2; i++) {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '10.0.0.1' },
      })
      await worker.fetch(request, mockEnv, mockCtx)
    }

    // Third request should be rate limited
    const request = new Request('https://functions.do/functions/test-func', {
      method: 'GET',
      headers: { 'CF-Connecting-IP': '10.0.0.1' },
    })
    const response = await worker.fetch(request, mockEnv, mockCtx)

    expect(response.status).toBe(429)
  })

  it('should integrate with existing function loader', async () => {
    const request = new Request('https://functions.do/functions/test-func', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const response = await worker.fetch(request, mockEnv, mockCtx)

    expect(response.status).toBe(200)
    const body = (await response.json()) as JsonBody
    expect(body['message']).toBe('Hello')
  })

  it('should maintain backward compatibility with /health route', async () => {
    const request = new Request('https://functions.do/health')
    const response = await worker.fetch(request, mockEnv, mockCtx)

    expect(response.status).toBe(200)
    const body = (await response.json()) as JsonBody
    expect(body['status']).toBe('ok')
    expect(body['service']).toBe('Functions.do')
  })

  it('should maintain backward compatibility with /functions/:id route', async () => {
    const request = new Request('https://functions.do/functions/test-func', {
      method: 'GET',
    })
    const response = await worker.fetch(request, mockEnv, mockCtx)

    expect(response.status).toBe(200)
    const body = (await response.json()) as JsonBody
    expect(body['id']).toBe('test-func')
  })

  it('should maintain backward compatibility with /functions/:id/invoke route', async () => {
    const request = new Request('https://functions.do/functions/test-func/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const response = await worker.fetch(request, mockEnv, mockCtx)

    expect(response.status).toBe(200)
  })
})
