/**
 * API Router Tests - RED Phase
 *
 * Tests for the refactored API router including:
 * - Route matching and dispatch
 * - Middleware chain execution
 * - Error handling and response formatting
 *
 * These tests import modules that don't exist yet - they will FAIL
 * until the implementation is complete.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockKV } from '../../test-utils/mock-kv'

// Import the router and handlers that don't exist yet
// These imports will cause the tests to fail (RED phase)
import { createRouter, Router } from '../router'
import { healthHandler } from '../handlers/health'
import { deployHandler } from '../handlers/deploy'
import { infoHandler } from '../handlers/info'
import { invokeHandler } from '../handlers/invoke'
import { deleteHandler } from '../handlers/delete'
import { logsHandler } from '../handlers/logs'
import { authMiddleware } from '../middleware/auth'
import { rateLimitMiddleware } from '../middleware/rate-limit'

// Type for JSON response bodies
type JsonBody = Record<string, unknown>

describe('API Router', () => {
  let router: Router
  let mockEnv: {
    FUNCTIONS_REGISTRY: KVNamespace
    FUNCTIONS_CODE: KVNamespace
    FUNCTIONS_API_KEYS?: KVNamespace
  }
  let mockCtx: ExecutionContext

  beforeEach(() => {
    mockEnv = {
      FUNCTIONS_REGISTRY: createMockKV(),
      FUNCTIONS_CODE: createMockKV(),
    }
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext

    router = createRouter()
  })

  describe('route matching', () => {
    it('routes GET /health to health handler', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'GET',
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['status']).toBe('ok')
      expect(body['service']).toBe('Functions.do')
    })

    it('routes POST /api/functions to deploy handler', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-func',
          version: '1.0.0',
          language: 'typescript',
          code: 'export default { fetch() { return new Response("ok"); } }',
        }),
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      // Should route to deploy handler (expect success or validation error)
      expect([200, 201, 400]).toContain(response.status)
    })

    it('routes GET /api/functions/:id to info handler', async () => {
      // First deploy a function
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:test-func',
        JSON.stringify({
          id: 'test-func',
          version: '1.0.0',
          language: 'typescript',
        })
      )

      const request = new Request('https://functions.do/api/functions/test-func', {
        method: 'GET',
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('test-func')
    })

    it('routes POST /functions/:id to invoke handler', async () => {
      // Set up a test function
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:invoke-test',
        JSON.stringify({
          id: 'invoke-test',
          version: '1.0.0',
          language: 'javascript',
        })
      )
      await mockEnv.FUNCTIONS_CODE.put(
        'code:invoke-test',
        'export default { fetch() { return new Response(JSON.stringify({ result: "invoked" }), { headers: { "Content-Type": "application/json" } }); } }'
      )

      const request = new Request('https://functions.do/functions/invoke-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'test' }),
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      // Should route to invoke handler
      expect([200, 501]).toContain(response.status) // 501 if no executor available
    })

    it('routes POST /functions/:id/invoke to invoke handler', async () => {
      // Set up a test function
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:explicit-invoke',
        JSON.stringify({
          id: 'explicit-invoke',
          version: '1.0.0',
          language: 'javascript',
        })
      )
      await mockEnv.FUNCTIONS_CODE.put('code:explicit-invoke', 'export default { fetch() { return new Response("ok"); } }')

      const request = new Request('https://functions.do/functions/explicit-invoke/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      // Should route to invoke handler
      expect([200, 501]).toContain(response.status)
    })

    it('routes DELETE /api/functions/:id to delete handler', async () => {
      // Set up a function to delete
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:delete-me',
        JSON.stringify({
          id: 'delete-me',
          version: '1.0.0',
          language: 'typescript',
        })
      )
      await mockEnv.FUNCTIONS_CODE.put('code:delete-me', 'export default {}')

      const request = new Request('https://functions.do/api/functions/delete-me', {
        method: 'DELETE',
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['success']).toBe(true)
    })

    it('routes GET /api/functions/:id/logs to logs handler', async () => {
      const request = new Request('https://functions.do/api/functions/test-func/logs', {
        method: 'GET',
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      // Should route to logs handler (503 if logs not configured)
      expect([200, 503]).toContain(response.status)
    })

    it('returns 404 for unknown routes', async () => {
      const request = new Request('https://functions.do/unknown/path/here', {
        method: 'GET',
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBeDefined()
    })

    it('returns 405 for wrong method', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'DELETE',
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.status).toBe(405)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('not allowed')
    })
  })

  describe('middleware chain', () => {
    beforeEach(async () => {
      // Set up API keys for auth testing
      mockEnv.FUNCTIONS_API_KEYS = createMockKV()
      await mockEnv.FUNCTIONS_API_KEYS.put(
        'valid-key',
        JSON.stringify({ active: true, userId: 'user-123' })
      )

      // Set up a test function
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:protected-func',
        JSON.stringify({
          id: 'protected-func',
          version: '1.0.0',
          language: 'typescript',
        })
      )
    })

    it('runs auth middleware before handler', async () => {
      const request = new Request('https://functions.do/api/functions/protected-func', {
        method: 'GET',
        headers: { 'X-API-Key': 'valid-key' },
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      // Should succeed with valid auth
      expect(response.status).toBe(200)
    })

    it('runs rate-limit middleware before handler', async () => {
      // Make multiple requests to trigger rate limit check
      const requests = Array.from({ length: 5 }, () =>
        new Request('https://functions.do/api/functions/protected-func', {
          method: 'GET',
          headers: {
            'X-API-Key': 'valid-key',
            'CF-Connecting-IP': '192.168.1.1',
          },
        })
      )

      // All requests should be processed (checking middleware runs)
      for (const request of requests) {
        const response = await router.handle(request, mockEnv, mockCtx)
        expect([200, 429]).toContain(response.status)
      }
    })

    it('short-circuits on auth failure', async () => {
      const request = new Request('https://functions.do/api/functions/protected-func', {
        method: 'GET',
        headers: { 'X-API-Key': 'invalid-key' },
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.status).toBe(401)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBeDefined()
    })

    it('short-circuits on rate limit', async () => {
      // Configure aggressive rate limit for testing
      router.configureRateLimit({
        ip: { windowMs: 60_000, maxRequests: 2 },
      })

      // Exhaust rate limit
      for (let i = 0; i < 3; i++) {
        const request = new Request('https://functions.do/api/functions/protected-func', {
          method: 'GET',
          headers: {
            'X-API-Key': 'valid-key',
            'CF-Connecting-IP': '10.0.0.1',
          },
        })
        const response = await router.handle(request, mockEnv, mockCtx)

        if (i >= 2) {
          expect(response.status).toBe(429)
          expect(response.headers.get('Retry-After')).toBeDefined()
        }
      }
    })
  })

  describe('error handling', () => {
    it('catches handler errors', async () => {
      // Register a route that throws
      router.get('/api/throw-error', async () => {
        throw new Error('Handler exploded')
      })

      const request = new Request('https://functions.do/api/throw-error', {
        method: 'GET',
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.status).toBe(500)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBeDefined()
    })

    it('returns JSON error response', async () => {
      const request = new Request('https://functions.do/api/not-found-route', {
        method: 'GET',
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.headers.get('Content-Type')).toBe('application/json')
      const body = (await response.json()) as JsonBody
      expect(typeof body['error']).toBe('string')
    })

    it('includes correlation ID in error', async () => {
      const request = new Request('https://functions.do/api/error-with-id', {
        method: 'GET',
        headers: { 'X-Request-ID': 'test-correlation-123' },
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      const body = (await response.json()) as JsonBody
      // Should include correlation ID for debugging
      expect(body['correlationId'] || body['requestId']).toBeDefined()
    })
  })

  describe('route parameters', () => {
    it('extracts function ID from path', async () => {
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:param-test',
        JSON.stringify({
          id: 'param-test',
          version: '1.0.0',
          language: 'typescript',
        })
      )

      const request = new Request('https://functions.do/api/functions/param-test', {
        method: 'GET',
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('param-test')
    })

    it('handles special characters in function ID', async () => {
      // Function IDs should follow specific patterns
      const request = new Request('https://functions.do/api/functions/my-func_v2', {
        method: 'GET',
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      // Should either find it or return 404, not crash
      expect([200, 404]).toContain(response.status)
    })
  })

  describe('content negotiation', () => {
    it('returns JSON by default', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'GET',
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('respects Accept header for health check', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })

      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })
  })
})

describe('Router Builder API', () => {
  it('supports fluent route registration', () => {
    const router = createRouter()
      .get('/test', async () => new Response('GET'))
      .post('/test', async () => new Response('POST'))
      .delete('/test', async () => new Response('DELETE'))

    expect(router).toBeDefined()
    expect(typeof router.handle).toBe('function')
  })

  it('supports middleware registration', () => {
    const middleware = vi.fn(async (req, env, ctx, next) => next())

    const router = createRouter()
      .use(middleware)
      .get('/test', async () => new Response('ok'))

    expect(router).toBeDefined()
  })

  it('supports route-specific middleware', () => {
    const routeMiddleware = vi.fn(async (req, env, ctx, next) => next())

    const router = createRouter()
      .get('/protected', routeMiddleware, async () => new Response('protected'))

    expect(router).toBeDefined()
  })

  it('supports route groups with prefix', () => {
    const router = createRouter()
      .group('/api/v1', (group) => {
        group.get('/users', async () => new Response('users'))
        group.post('/users', async () => new Response('created'))
      })

    expect(router).toBeDefined()
  })
})
