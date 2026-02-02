/**
 * Router Tests
 *
 * Tests for the API router including:
 * - Route matching
 * - Method handling (GET, POST, etc.)
 * - Middleware chain execution
 * - Public endpoint bypass
 *
 * @module api/handlers/__tests__/router.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createRouter } from '../../router'
import type { Env, RouteContext, Handler, Middleware } from '../../router'
import { createMockKV } from '../../../test-utils/mock-kv'

// Type for JSON response bodies
type JsonBody = Record<string, unknown>

// =============================================================================
// TEST SETUP
// =============================================================================

describe('Router', () => {
  let mockEnv: Env
  let mockCtx: ExecutionContext

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock environment
    mockEnv = {
      FUNCTIONS_REGISTRY: createMockKV(),
      FUNCTIONS_CODE: createMockKV(),
      // FUNCTIONS_API_KEYS not set - auth disabled by default for most tests
    }

    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // =============================================================================
  // ROUTE MATCHING TESTS
  // =============================================================================

  describe('route matching', () => {
    it('matches exact path patterns', async () => {
      const router = createRouter()
      const handler: Handler = vi.fn().mockResolvedValue(new Response('matched'))

      router.get('/custom/path', handler)

      const request = new Request('https://functions.do/custom/path', { method: 'GET' })
      const response = await router.handle(request, mockEnv, mockCtx)

      expect(handler).toHaveBeenCalled()
      expect(await response.text()).toBe('matched')
    })

    it('matches path with parameter', async () => {
      const router = createRouter()
      const handler: Handler = vi.fn().mockImplementation(
        async (req, env, ctx, context) => {
          return new Response(JSON.stringify({ id: context?.params['id'] }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
      )

      router.get('/items/:id', handler)

      const request = new Request('https://functions.do/items/123', { method: 'GET' })
      const response = await router.handle(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(handler).toHaveBeenCalled()
      expect(body['id']).toBe('123')
    })

    it('matches path with multiple parameters', async () => {
      const router = createRouter()
      const handler: Handler = vi.fn().mockImplementation(
        async (req, env, ctx, context) => {
          return new Response(JSON.stringify({
            org: context?.params['org'],
            func: context?.params['func'],
          }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
      )

      router.get('/orgs/:org/functions/:func', handler)

      const request = new Request('https://functions.do/orgs/acme/functions/hello', { method: 'GET' })
      const response = await router.handle(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(body['org']).toBe('acme')
      expect(body['func']).toBe('hello')
    })

    it('returns 404 for unmatched routes', async () => {
      const router = createRouter()

      const request = new Request('https://functions.do/nonexistent/path/here', { method: 'GET' })
      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Not found')
    })

    it('matches routes registered with group prefix', async () => {
      const router = createRouter()
      const handler: Handler = vi.fn().mockResolvedValue(new Response('grouped'))

      router.group('/v2/api', (group) => {
        group.get('/status', handler)
      })

      const request = new Request('https://functions.do/v2/api/status', { method: 'GET' })
      const response = await router.handle(request, mockEnv, mockCtx)

      expect(handler).toHaveBeenCalled()
      expect(await response.text()).toBe('grouped')
    })

    it('extracts functionId from route params', async () => {
      const router = createRouter()
      const handler: Handler = vi.fn().mockImplementation(
        async (req, env, ctx, context) => {
          return new Response(JSON.stringify({ functionId: context?.functionId }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
      )

      // Use a different path that doesn't conflict with built-in routes
      router.post('/custom-functions/:id/invoke', handler)

      const request = new Request('https://functions.do/custom-functions/my-func/invoke', { method: 'POST' })
      const response = await router.handle(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(body['functionId']).toBe('my-func')
    })

    it('extracts version from query string', async () => {
      const router = createRouter()
      const handler: Handler = vi.fn().mockImplementation(
        async (req, env, ctx, context) => {
          return new Response(JSON.stringify({ version: context?.version }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
      )

      // Use a different path that doesn't conflict with built-in routes
      router.post('/custom-functions/:id', handler)

      const request = new Request('https://functions.do/custom-functions/my-func?version=2.0.0', { method: 'POST' })
      const response = await router.handle(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(body['version']).toBe('2.0.0')
    })
  })

  // =============================================================================
  // METHOD HANDLING TESTS
  // =============================================================================

  describe('method handling', () => {
    it('handles GET requests', async () => {
      const router = createRouter()
      const handler: Handler = vi.fn().mockResolvedValue(new Response('GET'))

      router.get('/test', handler)

      const request = new Request('https://functions.do/test', { method: 'GET' })
      const response = await router.handle(request, mockEnv, mockCtx)

      expect(handler).toHaveBeenCalled()
      expect(await response.text()).toBe('GET')
    })

    it('handles POST requests', async () => {
      const router = createRouter()
      const handler: Handler = vi.fn().mockResolvedValue(new Response('POST'))

      router.post('/test', handler)

      const request = new Request('https://functions.do/test', { method: 'POST' })
      const response = await router.handle(request, mockEnv, mockCtx)

      expect(handler).toHaveBeenCalled()
      expect(await response.text()).toBe('POST')
    })

    it('handles PATCH requests', async () => {
      const router = createRouter()
      const handler: Handler = vi.fn().mockResolvedValue(new Response('PATCH'))

      router.patch('/test', handler)

      const request = new Request('https://functions.do/test', { method: 'PATCH' })
      const response = await router.handle(request, mockEnv, mockCtx)

      expect(handler).toHaveBeenCalled()
      expect(await response.text()).toBe('PATCH')
    })

    it('handles DELETE requests', async () => {
      const router = createRouter()
      const handler: Handler = vi.fn().mockResolvedValue(new Response('DELETE'))

      router.delete('/test', handler)

      const request = new Request('https://functions.do/test', { method: 'DELETE' })
      const response = await router.handle(request, mockEnv, mockCtx)

      expect(handler).toHaveBeenCalled()
      expect(await response.text()).toBe('DELETE')
    })

    it('returns 405 when route exists but method does not match', async () => {
      const router = createRouter()
      const handler: Handler = vi.fn().mockResolvedValue(new Response('GET'))

      router.get('/test-method', handler)

      const request = new Request('https://functions.do/test-method', { method: 'POST' })
      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.status).toBe(405)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Method')
      expect(body['error']).toContain('not allowed')
    })

    it('matches correct handler when multiple methods registered for same path', async () => {
      const router = createRouter()
      const getHandler: Handler = vi.fn().mockResolvedValue(new Response('GET'))
      const postHandler: Handler = vi.fn().mockResolvedValue(new Response('POST'))

      router.get('/multi-method', getHandler)
      router.post('/multi-method', postHandler)

      const getRequest = new Request('https://functions.do/multi-method', { method: 'GET' })
      const postRequest = new Request('https://functions.do/multi-method', { method: 'POST' })

      const getResponse = await router.handle(getRequest, mockEnv, mockCtx)
      const postResponse = await router.handle(postRequest, mockEnv, mockCtx)

      expect(await getResponse.text()).toBe('GET')
      expect(await postResponse.text()).toBe('POST')
    })
  })

  // =============================================================================
  // MIDDLEWARE CHAIN EXECUTION TESTS
  // =============================================================================

  describe('middleware chain execution', () => {
    it('executes global middleware before handler', async () => {
      const router = createRouter()
      const order: string[] = []

      const middleware: Middleware = vi.fn().mockImplementation(
        async (req, env, ctx, next) => {
          order.push('middleware')
          return next()
        }
      )
      const handler: Handler = vi.fn().mockImplementation(async () => {
        order.push('handler')
        return new Response('done')
      })

      router.use(middleware)
      router.get('/test-middleware', handler)

      const request = new Request('https://functions.do/test-middleware', { method: 'GET' })
      await router.handle(request, mockEnv, mockCtx)

      expect(order).toEqual(['middleware', 'handler'])
    })

    it('executes multiple global middleware in order', async () => {
      const router = createRouter()
      const order: string[] = []

      const middleware1: Middleware = vi.fn().mockImplementation(
        async (req, env, ctx, next) => {
          order.push('middleware1')
          return next()
        }
      )
      const middleware2: Middleware = vi.fn().mockImplementation(
        async (req, env, ctx, next) => {
          order.push('middleware2')
          return next()
        }
      )
      const handler: Handler = vi.fn().mockImplementation(async () => {
        order.push('handler')
        return new Response('done')
      })

      router.use(middleware1)
      router.use(middleware2)
      router.get('/test-chain', handler)

      const request = new Request('https://functions.do/test-chain', { method: 'GET' })
      await router.handle(request, mockEnv, mockCtx)

      expect(order).toEqual(['middleware1', 'middleware2', 'handler'])
    })

    it('allows middleware to short-circuit the chain', async () => {
      const router = createRouter()

      const blockingMiddleware: Middleware = vi.fn().mockImplementation(async () => {
        return new Response('blocked', { status: 403 })
      })
      const handler: Handler = vi.fn().mockResolvedValue(new Response('should not reach'))

      router.use(blockingMiddleware)
      router.get('/test-block', handler)

      const request = new Request('https://functions.do/test-block', { method: 'GET' })
      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.status).toBe(403)
      expect(await response.text()).toBe('blocked')
      expect(handler).not.toHaveBeenCalled()
    })

    it('executes route-specific middleware', async () => {
      const router = createRouter()
      const order: string[] = []

      const routeMiddleware: Middleware = vi.fn().mockImplementation(
        async (req, env, ctx, next) => {
          order.push('route-middleware')
          return next()
        }
      )
      const handler: Handler = vi.fn().mockImplementation(async () => {
        order.push('handler')
        return new Response('done')
      })

      router.get('/test-route-mw', routeMiddleware, handler)

      const request = new Request('https://functions.do/test-route-mw', { method: 'GET' })
      await router.handle(request, mockEnv, mockCtx)

      expect(order).toEqual(['route-middleware', 'handler'])
    })

    it('executes global middleware before route-specific middleware', async () => {
      const router = createRouter()
      const order: string[] = []

      const globalMiddleware: Middleware = vi.fn().mockImplementation(
        async (req, env, ctx, next) => {
          order.push('global')
          return next()
        }
      )
      const routeMiddleware: Middleware = vi.fn().mockImplementation(
        async (req, env, ctx, next) => {
          order.push('route')
          return next()
        }
      )
      const handler: Handler = vi.fn().mockImplementation(async () => {
        order.push('handler')
        return new Response('done')
      })

      router.use(globalMiddleware)
      router.get('/test-order', routeMiddleware, handler)

      const request = new Request('https://functions.do/test-order', { method: 'GET' })
      await router.handle(request, mockEnv, mockCtx)

      expect(order).toEqual(['global', 'route', 'handler'])
    })
  })

  // =============================================================================
  // PUBLIC ENDPOINT BYPASS TESTS
  // =============================================================================

  describe('public endpoint bypass', () => {
    it('allows access to /health without authentication', async () => {
      const mockApiKeysKV = createMockKV()
      const envWithAuth: Env = {
        ...mockEnv,
        FUNCTIONS_API_KEYS: mockApiKeysKV,
      }

      const router = createRouter()

      // Request without auth header
      const request = new Request('https://functions.do/health', { method: 'GET' })
      const response = await router.handle(request, envWithAuth, mockCtx)

      // Should return 200, not 401
      expect(response.status).toBe(200)
    })

    it('allows access to / without authentication', async () => {
      const mockApiKeysKV = createMockKV()
      const envWithAuth: Env = {
        ...mockEnv,
        FUNCTIONS_API_KEYS: mockApiKeysKV,
      }

      const router = createRouter()

      const request = new Request('https://functions.do/', { method: 'GET' })
      const response = await router.handle(request, envWithAuth, mockCtx)

      expect(response.status).toBe(200)
    })

    it('requires authentication for non-public endpoints when auth configured', async () => {
      const mockApiKeysKV = createMockKV()
      const envWithAuth: Env = {
        ...mockEnv,
        FUNCTIONS_API_KEYS: mockApiKeysKV,
      }

      const router = createRouter()

      // Request to protected endpoint without auth
      const request = new Request('https://functions.do/api/functions', { method: 'GET' })
      const response = await router.handle(request, envWithAuth, mockCtx)

      // Should return 401
      expect(response.status).toBe(401)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('authentication')
    })

    it('allows authenticated requests to protected endpoints', async () => {
      const mockApiKeysKV = createMockKV()

      // Set up a valid API key
      const apiKey = 'sk_test_validkey123'
      const encoder = new TextEncoder()
      const data = encoder.encode(apiKey)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

      await mockApiKeysKV.put(`keys:${keyHash}`, JSON.stringify({
        userId: 'user-123',
        active: true,
        scopes: ['read', 'write'],
      }))

      const envWithAuth: Env = {
        ...mockEnv,
        FUNCTIONS_API_KEYS: mockApiKeysKV,
      }

      const router = createRouter()

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: {
          'X-API-Key': apiKey,
        },
      })
      const response = await router.handle(request, envWithAuth, mockCtx)

      // Should not return 401
      expect(response.status).not.toBe(401)
    })
  })

  // =============================================================================
  // ERROR HANDLING TESTS
  // =============================================================================

  describe('error handling', () => {
    it('catches handler errors and returns 500', async () => {
      const router = createRouter()
      const handler: Handler = vi.fn().mockRejectedValue(new Error('Handler error'))

      router.get('/test-error', handler)

      const request = new Request('https://functions.do/test-error', { method: 'GET' })
      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.status).toBe(500)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Handler error')
    })

    it('includes correlation ID in error responses', async () => {
      const router = createRouter()
      const handler: Handler = vi.fn().mockRejectedValue(new Error('Test error'))

      router.get('/test-correlation', handler)

      const requestId = 'test-request-id-123'
      const request = new Request('https://functions.do/test-correlation', {
        method: 'GET',
        headers: {
          'X-Request-ID': requestId,
        },
      })
      const response = await router.handle(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(body['correlationId']).toBe(requestId)
    })

    it('generates correlation ID when not provided', async () => {
      const router = createRouter()

      const request = new Request('https://functions.do/nonexistent', { method: 'GET' })
      const response = await router.handle(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(body['correlationId']).toBeDefined()
      expect(typeof body['correlationId']).toBe('string')
    })
  })

  // =============================================================================
  // RATE LIMITING TESTS
  // =============================================================================

  describe('rate limiting', () => {
    it('applies rate limits when configured', async () => {
      const router = createRouter()

      router.configureRateLimit({
        ip: { maxRequests: 2, windowMs: 60000 },
      })

      const handler: Handler = vi.fn().mockResolvedValue(new Response('ok'))
      router.get('/rate-limited', handler)

      // First two requests should succeed
      for (let i = 0; i < 2; i++) {
        const request = new Request('https://functions.do/rate-limited', {
          method: 'GET',
          headers: { 'CF-Connecting-IP': '1.2.3.4' },
        })
        const response = await router.handle(request, mockEnv, mockCtx)
        expect(response.status).toBe(200)
      }

      // Third request should be rate limited
      const request = new Request('https://functions.do/rate-limited', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      })
      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.status).toBe(429)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Too Many Requests')
    })

    it('does not rate limit public endpoints', async () => {
      const router = createRouter()

      router.configureRateLimit({
        ip: { maxRequests: 1, windowMs: 60000 },
      })

      // Multiple requests to health endpoint should all succeed
      for (let i = 0; i < 5; i++) {
        const request = new Request('https://functions.do/health', {
          method: 'GET',
          headers: { 'CF-Connecting-IP': '1.2.3.4' },
        })
        const response = await router.handle(request, mockEnv, mockCtx)
        expect(response.status).toBe(200)
      }
    })

    it('resets rate limit state when resetRateLimit called', async () => {
      const router = createRouter()

      router.configureRateLimit({
        ip: { maxRequests: 1, windowMs: 60000 },
      })

      const handler: Handler = vi.fn().mockResolvedValue(new Response('ok'))
      router.get('/reset-test', handler)

      // First request succeeds
      let request = new Request('https://functions.do/reset-test', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '5.6.7.8' },
      })
      let response = await router.handle(request, mockEnv, mockCtx)
      expect(response.status).toBe(200)

      // Second request is rate limited
      request = new Request('https://functions.do/reset-test', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '5.6.7.8' },
      })
      response = await router.handle(request, mockEnv, mockCtx)
      expect(response.status).toBe(429)

      // Reset rate limit
      router.resetRateLimit()

      // Now request should succeed again
      request = new Request('https://functions.do/reset-test', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '5.6.7.8' },
      })
      response = await router.handle(request, mockEnv, mockCtx)
      expect(response.status).toBe(200)
    })
  })
})
