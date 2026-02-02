/**
 * API Version Header Support Tests
 *
 * Tests for header-based API versioning alongside URL path versioning.
 *
 * Covers:
 * - resolveApiVersion function (unit tests)
 * - Header-based version detection (Accept-Version, X-API-Version)
 * - URL path takes precedence over header
 * - Query param takes precedence over header
 * - Default version when neither specified
 * - X-API-Version response header on all responses
 *
 * @module api/__tests__/api-version.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRouter, resolveApiVersion, DEFAULT_API_VERSION } from '../router'
import type { Env, RouteContext, Handler, ApiVersionSource } from '../router'
import { createMockKV } from '../../test-utils/mock-kv'

// Type for JSON response bodies
type JsonBody = Record<string, unknown>

// =============================================================================
// TEST SETUP
// =============================================================================

describe('API Version Header Support', () => {
  let mockEnv: Env
  let mockCtx: ExecutionContext

  beforeEach(() => {
    vi.clearAllMocks()

    mockEnv = {
      FUNCTIONS_REGISTRY: createMockKV(),
      FUNCTIONS_CODE: createMockKV(),
    }

    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext
  })

  // ===========================================================================
  // resolveApiVersion UNIT TESTS
  // ===========================================================================

  describe('resolveApiVersion', () => {
    it('returns version from URL path prefix', () => {
      const request = new Request('https://functions.do/v1/api/functions')
      const result = resolveApiVersion(request, '/v1/api/functions')

      expect(result.apiVersion).toBe('v1')
      expect(result.apiVersionSource).toBe('path')
    })

    it('returns version v2 from URL path prefix', () => {
      const request = new Request('https://functions.do/v2/api/functions')
      const result = resolveApiVersion(request, '/v2/api/functions')

      expect(result.apiVersion).toBe('v2')
      expect(result.apiVersionSource).toBe('path')
    })

    it('returns version from query parameter', () => {
      const request = new Request('https://functions.do/api/functions?version=v2')
      const result = resolveApiVersion(request, '/api/functions')

      expect(result.apiVersion).toBe('v2')
      expect(result.apiVersionSource).toBe('query')
    })

    it('normalizes numeric query version to v-prefixed', () => {
      const request = new Request('https://functions.do/api/functions?version=2')
      const result = resolveApiVersion(request, '/api/functions')

      expect(result.apiVersion).toBe('v2')
      expect(result.apiVersionSource).toBe('query')
    })

    it('returns version from Accept-Version header', () => {
      const request = new Request('https://functions.do/api/functions', {
        headers: { 'Accept-Version': 'v2' },
      })
      const result = resolveApiVersion(request, '/api/functions')

      expect(result.apiVersion).toBe('v2')
      expect(result.apiVersionSource).toBe('accept-version')
    })

    it('normalizes numeric Accept-Version header to v-prefixed', () => {
      const request = new Request('https://functions.do/api/functions', {
        headers: { 'Accept-Version': '2' },
      })
      const result = resolveApiVersion(request, '/api/functions')

      expect(result.apiVersion).toBe('v2')
      expect(result.apiVersionSource).toBe('accept-version')
    })

    it('returns version from X-API-Version header', () => {
      const request = new Request('https://functions.do/api/functions', {
        headers: { 'X-API-Version': 'v3' },
      })
      const result = resolveApiVersion(request, '/api/functions')

      expect(result.apiVersion).toBe('v3')
      expect(result.apiVersionSource).toBe('x-api-version')
    })

    it('normalizes numeric X-API-Version header to v-prefixed', () => {
      const request = new Request('https://functions.do/api/functions', {
        headers: { 'X-API-Version': '3' },
      })
      const result = resolveApiVersion(request, '/api/functions')

      expect(result.apiVersion).toBe('v3')
      expect(result.apiVersionSource).toBe('x-api-version')
    })

    it('returns default version when nothing specified', () => {
      const request = new Request('https://functions.do/api/functions')
      const result = resolveApiVersion(request, '/api/functions')

      expect(result.apiVersion).toBe(DEFAULT_API_VERSION)
      expect(result.apiVersionSource).toBe('default')
    })

    it('DEFAULT_API_VERSION is v1', () => {
      expect(DEFAULT_API_VERSION).toBe('v1')
    })

    // =========================================================================
    // PRECEDENCE TESTS
    // =========================================================================

    it('URL path takes precedence over Accept-Version header', () => {
      const request = new Request('https://functions.do/v1/api/functions', {
        headers: { 'Accept-Version': 'v2' },
      })
      const result = resolveApiVersion(request, '/v1/api/functions')

      expect(result.apiVersion).toBe('v1')
      expect(result.apiVersionSource).toBe('path')
    })

    it('URL path takes precedence over X-API-Version header', () => {
      const request = new Request('https://functions.do/v1/api/functions', {
        headers: { 'X-API-Version': 'v3' },
      })
      const result = resolveApiVersion(request, '/v1/api/functions')

      expect(result.apiVersion).toBe('v1')
      expect(result.apiVersionSource).toBe('path')
    })

    it('URL path takes precedence over query parameter', () => {
      const request = new Request('https://functions.do/v1/api/functions?version=v2')
      const result = resolveApiVersion(request, '/v1/api/functions')

      expect(result.apiVersion).toBe('v1')
      expect(result.apiVersionSource).toBe('path')
    })

    it('query parameter takes precedence over Accept-Version header', () => {
      const request = new Request('https://functions.do/api/functions?version=v2', {
        headers: { 'Accept-Version': 'v3' },
      })
      const result = resolveApiVersion(request, '/api/functions')

      expect(result.apiVersion).toBe('v2')
      expect(result.apiVersionSource).toBe('query')
    })

    it('query parameter takes precedence over X-API-Version header', () => {
      const request = new Request('https://functions.do/api/functions?version=v2', {
        headers: { 'X-API-Version': 'v3' },
      })
      const result = resolveApiVersion(request, '/api/functions')

      expect(result.apiVersion).toBe('v2')
      expect(result.apiVersionSource).toBe('query')
    })

    it('Accept-Version takes precedence over X-API-Version', () => {
      const request = new Request('https://functions.do/api/functions', {
        headers: {
          'Accept-Version': 'v2',
          'X-API-Version': 'v3',
        },
      })
      const result = resolveApiVersion(request, '/api/functions')

      expect(result.apiVersion).toBe('v2')
      expect(result.apiVersionSource).toBe('accept-version')
    })

    it('URL path takes precedence over all headers and query', () => {
      const request = new Request('https://functions.do/v1/api/functions?version=v4', {
        headers: {
          'Accept-Version': 'v2',
          'X-API-Version': 'v3',
        },
      })
      const result = resolveApiVersion(request, '/v1/api/functions')

      expect(result.apiVersion).toBe('v1')
      expect(result.apiVersionSource).toBe('path')
    })
  })

  // ===========================================================================
  // ROUTER INTEGRATION TESTS
  // ===========================================================================

  describe('router integration', () => {
    it('passes apiVersion and apiVersionSource to handler via RouteContext', async () => {
      const router = createRouter()
      let capturedContext: RouteContext | undefined

      const handler: Handler = vi.fn().mockImplementation(
        async (req, env, ctx, context) => {
          capturedContext = context
          return new Response(JSON.stringify({
            apiVersion: context?.apiVersion,
            apiVersionSource: context?.apiVersionSource,
          }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
      )

      router.get('/test-version', handler)

      const request = new Request('https://functions.do/test-version', {
        method: 'GET',
        headers: { 'Accept-Version': 'v2' },
      })
      const response = await router.handle(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(body['apiVersion']).toBe('v2')
      expect(body['apiVersionSource']).toBe('accept-version')
    })

    it('sets X-API-Version response header from Accept-Version', async () => {
      const router = createRouter()

      const request = new Request('https://functions.do/health', {
        method: 'GET',
        headers: { 'Accept-Version': 'v2' },
      })
      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      expect(response.headers.get('X-API-Version')).toBe('v2')
    })

    it('sets X-API-Version response header from X-API-Version request header', async () => {
      const router = createRouter()

      const request = new Request('https://functions.do/health', {
        method: 'GET',
        headers: { 'X-API-Version': 'v3' },
      })
      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      expect(response.headers.get('X-API-Version')).toBe('v3')
    })

    it('sets X-API-Version response header to default when no version specified', async () => {
      const router = createRouter()

      const request = new Request('https://functions.do/health', {
        method: 'GET',
      })
      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      expect(response.headers.get('X-API-Version')).toBe('v1')
    })

    it('sets X-API-Version response header from URL path', async () => {
      const router = createRouter()

      const request = new Request('https://functions.do/v1/api/functions', {
        method: 'GET',
      })
      const response = await router.handle(request, mockEnv, mockCtx)

      // The v1 route exists, so we should get a valid response (200 or other)
      // The important thing is the header is set
      expect(response.headers.get('X-API-Version')).toBe('v1')
    })

    it('URL path version takes precedence in response header', async () => {
      const router = createRouter()

      // Request to /v1/api/functions but with Accept-Version: v2 header
      const request = new Request('https://functions.do/v1/api/functions', {
        method: 'GET',
        headers: { 'Accept-Version': 'v2' },
      })
      const response = await router.handle(request, mockEnv, mockCtx)

      // Path version (v1) should take precedence
      expect(response.headers.get('X-API-Version')).toBe('v1')
    })

    it('uses header version for legacy routes without path version', async () => {
      const router = createRouter()

      // Deploy a function so the info handler returns 200
      await (mockEnv.FUNCTIONS_REGISTRY as KVNamespace).put(
        'registry:my-func',
        JSON.stringify({ id: 'my-func', version: '1.0.0', language: 'typescript' })
      )

      const request = new Request('https://functions.do/api/functions/my-func', {
        method: 'GET',
        headers: { 'Accept-Version': 'v2' },
      })
      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      // Legacy route has no path version, so header should be used
      expect(response.headers.get('X-API-Version')).toBe('v2')
    })

    it('handler receives default version for legacy routes without headers', async () => {
      const router = createRouter()
      let capturedContext: RouteContext | undefined

      const handler: Handler = vi.fn().mockImplementation(
        async (req, env, ctx, context) => {
          capturedContext = context
          return new Response('ok')
        }
      )

      router.get('/test-default-version', handler)

      const request = new Request('https://functions.do/test-default-version', {
        method: 'GET',
      })
      await router.handle(request, mockEnv, mockCtx)

      expect(capturedContext).toBeDefined()
      expect(capturedContext!.apiVersion).toBe('v1')
      expect(capturedContext!.apiVersionSource).toBe('default')
    })

    it('preserves existing response headers when adding X-API-Version', async () => {
      const router = createRouter()

      const handler: Handler = vi.fn().mockImplementation(async () => {
        return new Response('ok', {
          headers: {
            'Content-Type': 'text/plain',
            'X-Custom-Header': 'custom-value',
          },
        })
      })

      router.get('/test-preserve-headers', handler)

      const request = new Request('https://functions.do/test-preserve-headers', {
        method: 'GET',
        headers: { 'Accept-Version': 'v2' },
      })
      const response = await router.handle(request, mockEnv, mockCtx)

      expect(response.headers.get('Content-Type')).toBe('text/plain')
      expect(response.headers.get('X-Custom-Header')).toBe('custom-value')
      expect(response.headers.get('X-API-Version')).toBe('v2')
    })

    it('does not override X-API-Version if handler already set it', async () => {
      const router = createRouter()

      const handler: Handler = vi.fn().mockImplementation(async () => {
        return new Response('ok', {
          headers: {
            'X-API-Version': 'v99-custom',
          },
        })
      })

      router.get('/test-no-override', handler)

      const request = new Request('https://functions.do/test-no-override', {
        method: 'GET',
        headers: { 'Accept-Version': 'v2' },
      })
      const response = await router.handle(request, mockEnv, mockCtx)

      // Handler's explicit X-API-Version should be preserved
      expect(response.headers.get('X-API-Version')).toBe('v99-custom')
    })
  })
})
