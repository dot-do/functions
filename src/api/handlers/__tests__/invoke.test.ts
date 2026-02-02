/**
 * Invoke Handler Tests
 *
 * Tests for the function invoke endpoint handler including:
 * - Request validation (missing function ID, invalid method)
 * - Auth context handling
 * - Error response formatting
 * - Cache miss/hit scenarios (mock the cache)
 *
 * @module api/handlers/__tests__/invoke.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { invokeHandler, validateInvokeRequest, classifyFunction } from '../invoke'
import type { Env, RouteContext } from '../../router'
import type { ExtendedMetadata } from '../../tier-dispatcher'
import { createMockKV } from '../../../test-utils/mock-kv'

// Type for JSON response bodies
type JsonBody = Record<string, unknown>

// Mock the global caches API
const mockCacheMatch = vi.fn()
const mockCachePut = vi.fn()
const mockCacheDelete = vi.fn()

// Create mock cache before tests
const mockCache = {
  match: mockCacheMatch,
  put: mockCachePut,
  delete: mockCacheDelete,
}

// =============================================================================
// TEST SETUP
// =============================================================================

describe('Invoke Handler', () => {
  let mockEnv: Env
  let mockCtx: ExecutionContext

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()

    // Mock global caches API
    ;(globalThis as unknown as { caches: { default: typeof mockCache } }).caches = {
      default: mockCache,
    }

    // Default: cache miss
    mockCacheMatch.mockResolvedValue(null)
    mockCachePut.mockResolvedValue(undefined)
    mockCacheDelete.mockResolvedValue(true)

    // Create mock environment
    mockEnv = {
      FUNCTIONS_REGISTRY: createMockKV(),
      FUNCTIONS_CODE: createMockKV(),
    }

    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Helper to set up a function in the registry with code
   */
  async function setupFunction(
    functionId: string,
    options: {
      version?: string
      language?: string
      type?: string
      code?: string
    } = {}
  ): Promise<void> {
    const metadata = {
      id: functionId,
      version: options.version ?? '1.0.0',
      language: options.language ?? 'javascript',
      entryPoint: 'index.js',
      type: options.type ?? 'code',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
    }
    await mockEnv.FUNCTIONS_REGISTRY.put(`registry:${functionId}`, JSON.stringify(metadata))

    // Also set up code
    const code = options.code ?? `export default { fetch(req) { return new Response(JSON.stringify({ hello: 'world' }), { headers: { 'Content-Type': 'application/json' }}); } }`
    await mockEnv.FUNCTIONS_CODE.put(`code:${functionId}`, code)
  }

  // =============================================================================
  // REQUEST VALIDATION TESTS
  // =============================================================================

  describe('request validation', () => {
    it('returns 400 when function ID is missing', async () => {
      const request = new Request('https://functions.do/functions/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const context: RouteContext = {
        params: {},
        // No functionId
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Function ID required')
    })

    it('returns 400 when context is undefined', async () => {
      const request = new Request('https://functions.do/functions/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const response = await invokeHandler(request, mockEnv, mockCtx, undefined)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Function ID required')
    })

    it('returns 400 for invalid function ID format', async () => {
      const request = new Request('https://functions.do/functions/123-invalid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const context: RouteContext = {
        params: { id: '123-invalid' },
        functionId: '123-invalid',
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Invalid function ID')
    })

    it('returns 400 for invalid JSON body', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/functions/my-function', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json {{{',
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Invalid JSON body')
    })

    it('returns 413 when request body is too large', async () => {
      await setupFunction('my-function')

      // Create a request with a large Content-Length header
      const request = new Request('https://functions.do/functions/my-function', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '20000000', // 20MB, exceeds 10MB limit
        },
        body: JSON.stringify({}),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(413)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Request body too large')
    })

    it('returns 404 when function does not exist', async () => {
      const request = new Request('https://functions.do/functions/nonexistent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const context: RouteContext = {
        params: { id: 'nonexistent' },
        functionId: 'nonexistent',
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Function not found')
    })

    it('extracts function ID from context.params when functionId not set', async () => {
      await setupFunction('params-id-test')

      const request = new Request('https://functions.do/functions/params-id-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const context: RouteContext = {
        params: { id: 'params-id-test' },
        // functionId not set
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      // Should not return 400 for missing function ID
      expect(response.status).not.toBe(400)
    })
  })

  // =============================================================================
  // AUTH CONTEXT HANDLING TESTS
  // =============================================================================

  describe('auth context handling', () => {
    it('passes through without authorization header when no auth configured', async () => {
      await setupFunction('no-auth-test')

      const request = new Request('https://functions.do/functions/no-auth-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const context: RouteContext = {
        params: { id: 'no-auth-test' },
        functionId: 'no-auth-test',
      }

      // Handler itself does not check auth - that's middleware responsibility
      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      // Should not return 401 or 403
      expect(response.status).not.toBe(401)
      expect(response.status).not.toBe(403)
    })

    it('accepts authContext in route context', async () => {
      await setupFunction('auth-context-test')

      const request = new Request('https://functions.do/functions/auth-context-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const context: RouteContext = {
        params: { id: 'auth-context-test' },
        functionId: 'auth-context-test',
        authContext: {
          userId: 'user-123',
          keyHash: 'hash-abc',
          keyHint: '****1234',
          scopes: ['read', 'write'],
          authenticatedAt: Date.now(),
          authMethod: 'api-key',
        },
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      // Should process without auth errors
      expect(response.status).not.toBe(401)
      expect(response.status).not.toBe(403)
    })
  })

  // =============================================================================
  // ERROR RESPONSE FORMATTING TESTS
  // =============================================================================

  describe('error response formatting', () => {
    it('returns JSON content type for error responses', async () => {
      const request = new Request('https://functions.do/functions/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const context: RouteContext = {
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('includes error message in response body', async () => {
      const request = new Request('https://functions.do/functions/nonexistent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const context: RouteContext = {
        params: { id: 'nonexistent' },
        functionId: 'nonexistent',
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(body['error']).toBeDefined()
      expect(typeof body['error']).toBe('string')
    })

    it('returns proper 400 error structure for validation errors', async () => {
      const request = new Request('https://functions.do/functions/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const response = await invokeHandler(request, mockEnv, mockCtx, undefined)
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(400)
      expect(body).toHaveProperty('error')
    })

    it('returns proper 404 error structure for not found', async () => {
      const request = new Request('https://functions.do/functions/missing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const context: RouteContext = {
        params: { id: 'missing' },
        functionId: 'missing',
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(404)
      expect(body['error']).toContain('missing')
    })
  })

  // =============================================================================
  // CACHE MISS/HIT SCENARIO TESTS
  // =============================================================================

  describe('cache miss/hit scenarios', () => {
    it('fetches metadata from KV on cache miss', async () => {
      await setupFunction('cache-miss-test')

      // Cache miss
      mockCacheMatch.mockResolvedValue(null)

      const request = new Request('https://functions.do/functions/cache-miss-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const context: RouteContext = {
        params: { id: 'cache-miss-test' },
        functionId: 'cache-miss-test',
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      // Should have queried cache
      expect(mockCacheMatch).toHaveBeenCalled()
      // Should not return 404 since KV has the function
      expect(response.status).not.toBe(404)
    })

    it('uses cached metadata when cache hit', async () => {
      const cachedMetadata = {
        id: 'cache-hit-test',
        version: '1.0.0',
        language: 'javascript',
        entryPoint: 'index.js',
        type: 'code',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
      }

      // Also need code in storage
      const code = `export default { fetch(req) { return new Response(JSON.stringify({ cached: true }), { headers: { 'Content-Type': 'application/json' }}); } }`
      await mockEnv.FUNCTIONS_CODE.put('code:cache-hit-test', code)

      // Cache hit for metadata
      mockCacheMatch.mockImplementation(async (cacheKey: Request) => {
        const url = cacheKey.url
        if (url.includes('/metadata')) {
          return new Response(JSON.stringify(cachedMetadata), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return null
      })

      const request = new Request('https://functions.do/functions/cache-hit-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const context: RouteContext = {
        params: { id: 'cache-hit-test' },
        functionId: 'cache-hit-test',
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      // Should have queried cache
      expect(mockCacheMatch).toHaveBeenCalled()
      // Should not return 404 since cache had the metadata
      expect(response.status).not.toBe(404)
    })

    it('caches metadata after KV fetch', async () => {
      await setupFunction('cache-store-test')

      // Cache miss
      mockCacheMatch.mockResolvedValue(null)

      const request = new Request('https://functions.do/functions/cache-store-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const context: RouteContext = {
        params: { id: 'cache-store-test' },
        functionId: 'cache-store-test',
      }

      await invokeHandler(request, mockEnv, mockCtx, context)

      // Should have called cache.put to store metadata
      expect(mockCachePut).toHaveBeenCalled()
    })

    it('handles cache errors gracefully and falls through to KV', async () => {
      await setupFunction('cache-error-test')

      // Cache throws error
      mockCacheMatch.mockRejectedValue(new Error('Cache unavailable'))

      const request = new Request('https://functions.do/functions/cache-error-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const context: RouteContext = {
        params: { id: 'cache-error-test' },
        functionId: 'cache-error-test',
      }

      // Should not throw, should fall through to KV
      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      // Should have attempted cache
      expect(mockCacheMatch).toHaveBeenCalled()
      // Should not return 404 since KV has the function
      expect(response.status).not.toBe(404)
    })
  })

  // =============================================================================
  // CASCADE DEFAULT INVOKE PATH TESTS
  // =============================================================================

  describe('cascade as default invoke path', () => {
    /**
     * Helper to set up a function WITHOUT a type field in metadata.
     * This simulates a function that was registered without specifying an execution type.
     */
    async function setupFunctionWithoutType(
      functionId: string,
      extraMetadata: Record<string, unknown> = {}
    ): Promise<void> {
      const metadata = {
        id: functionId,
        version: '1.0.0',
        language: 'javascript',
        entryPoint: 'index.js',
        // NOTE: No 'type' field - this is the key scenario
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
        ...extraMetadata,
      }
      await mockEnv.FUNCTIONS_REGISTRY.put(`registry:${functionId}`, JSON.stringify(metadata))

      const code = `export default { fetch(req) { return new Response(JSON.stringify({ hello: 'world' }), { headers: { 'Content-Type': 'application/json' }}); } }`
      await mockEnv.FUNCTIONS_CODE.put(`code:${functionId}`, code)
    }

    describe('classifyFunction defaults to code', () => {
      it('returns code type when metadata has no type and no AI binding', async () => {
        const metadata: ExtendedMetadata = {
          id: 'no-type-func',
          version: '1.0.0',
          language: 'javascript',
          entryPoint: 'index.js',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-02T00:00:00.000Z',
          // No type field - defaults to 'code' for backward compatibility
        }

        const result = await classifyFunction(metadata, undefined)

        expect(result.type).toBe('code')
      })

      it('returns code type when metadata type is explicitly undefined', async () => {
        const metadata: ExtendedMetadata = {
          id: 'undefined-type-func',
          version: '1.0.0',
          language: 'javascript',
          entryPoint: 'index.js',
          type: undefined,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-02T00:00:00.000Z',
        }

        const result = await classifyFunction(metadata, undefined)

        expect(result.type).toBe('code')
      })

      it('still returns explicit type when type is set to code', async () => {
        const metadata: ExtendedMetadata = {
          id: 'code-func',
          version: '1.0.0',
          language: 'javascript',
          entryPoint: 'index.js',
          type: 'code',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-02T00:00:00.000Z',
        }

        const result = await classifyFunction(metadata, undefined)

        expect(result.type).toBe('code')
      })

      it('still returns explicit type when type is set to generative', async () => {
        const metadata: ExtendedMetadata = {
          id: 'gen-func',
          version: '1.0.0',
          language: 'javascript',
          entryPoint: 'index.js',
          type: 'generative',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-02T00:00:00.000Z',
        }

        const result = await classifyFunction(metadata, undefined)

        expect(result.type).toBe('generative')
      })

      it('still returns explicit type when type is set to agentic', async () => {
        const metadata: ExtendedMetadata = {
          id: 'agent-func',
          version: '1.0.0',
          language: 'javascript',
          entryPoint: 'index.js',
          type: 'agentic',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-02T00:00:00.000Z',
        }

        const result = await classifyFunction(metadata, undefined)

        expect(result.type).toBe('agentic')
      })

      it('still returns explicit type when type is set to human', async () => {
        const metadata: ExtendedMetadata = {
          id: 'human-func',
          version: '1.0.0',
          language: 'javascript',
          entryPoint: 'index.js',
          type: 'human',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-02T00:00:00.000Z',
        }

        const result = await classifyFunction(metadata, undefined)

        expect(result.type).toBe('human')
      })
    })

    describe('invokeHandler routes to cascade when type is not specified', () => {
      it('routes to code execution path when function has no type (defaults to code)', async () => {
        await setupFunctionWithoutType('cascade-default-test')

        const request = new Request('https://functions.do/functions/cascade-default-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'test' }),
        })
        const context: RouteContext = {
          params: { id: 'cascade-default-test' },
          functionId: 'cascade-default-test',
        }

        const response = await invokeHandler(request, mockEnv, mockCtx, context)
        const body = (await response.json()) as JsonBody

        // With discriminated union, functions without a type field default to 'code'
        // via validateFunctionMetadata. Without LOADER or USER_FUNCTIONS, code path
        // returns 501.
        const meta = body['_meta'] as Record<string, unknown> | undefined
        if (meta) {
          // executorType should be 'code' since type defaults to 'code'
          expect(meta['executorType']).toBe('code')
        }
        // Code path without LOADER/USER_FUNCTIONS returns 501
        expect(response.status).toBe(501)
      })

      it('still routes to code execution when type is explicitly code', async () => {
        await setupFunction('explicit-code-test', { type: 'code' })

        const request = new Request('https://functions.do/functions/explicit-code-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const context: RouteContext = {
          params: { id: 'explicit-code-test' },
          functionId: 'explicit-code-test',
        }

        const response = await invokeHandler(request, mockEnv, mockCtx, context)
        const body = (await response.json()) as JsonBody

        // With explicit type: 'code', it should go through code execution path
        // Without LOADER or USER_FUNCTIONS, this returns 501
        expect(response.status).toBe(501)
        const meta = body['_meta'] as Record<string, unknown> | undefined
        if (meta) {
          expect(meta['executorType']).toBe('code')
        }
      })
    })
  })

  // =============================================================================
  // validateInvokeRequest FUNCTION TESTS
  // =============================================================================

  describe('validateInvokeRequest', () => {
    it('returns valid:false when function ID is missing', async () => {
      const request = new Request('https://functions.do/functions/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const context: RouteContext = {
        params: {},
      }

      const result = await validateInvokeRequest(request, mockEnv, context)

      expect(result.valid).toBe(false)
      expect(result.errorResponse).toBeDefined()
      expect(result.errorResponse?.status).toBe(400)
    })

    it('returns valid:true with parsed data for valid request', async () => {
      await setupFunction('valid-request')

      const request = new Request('https://functions.do/functions/valid-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'test' }),
      })
      const context: RouteContext = {
        params: { id: 'valid-request' },
        functionId: 'valid-request',
      }

      const result = await validateInvokeRequest(request, mockEnv, context)

      expect(result.valid).toBe(true)
      expect(result.functionId).toBe('valid-request')
      expect(result.requestData).toEqual({ input: 'test' })
      expect(result.metadata).toBeDefined()
    })

    it('handles empty JSON body', async () => {
      await setupFunction('empty-body')

      const request = new Request('https://functions.do/functions/empty-body', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      })
      const context: RouteContext = {
        params: { id: 'empty-body' },
        functionId: 'empty-body',
      }

      const result = await validateInvokeRequest(request, mockEnv, context)

      expect(result.valid).toBe(true)
      expect(result.requestData).toEqual({})
    })

    it('handles text/plain content type', async () => {
      await setupFunction('text-body')

      const request = new Request('https://functions.do/functions/text-body', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'Hello, world!',
      })
      const context: RouteContext = {
        params: { id: 'text-body' },
        functionId: 'text-body',
      }

      const result = await validateInvokeRequest(request, mockEnv, context)

      expect(result.valid).toBe(true)
      expect(result.requestData).toEqual({ text: 'Hello, world!' })
    })

    it('returns version from context', async () => {
      // Set up the main function entry
      await setupFunction('versioned-func', { version: '2.0.0' })
      // Also set up the version-specific entry that registry.getVersion() looks for
      const metadata = {
        id: 'versioned-func',
        version: '2.0.0',
        language: 'javascript',
        entryPoint: 'index.js',
        type: 'code',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
      }
      await mockEnv.FUNCTIONS_REGISTRY.put('registry:versioned-func:v:2.0.0', JSON.stringify(metadata))

      const request = new Request('https://functions.do/functions/versioned-func?version=2.0.0', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const context: RouteContext = {
        params: { id: 'versioned-func' },
        functionId: 'versioned-func',
        version: '2.0.0',
      }

      const result = await validateInvokeRequest(request, mockEnv, context)

      expect(result.valid).toBe(true)
      expect(result.version).toBe('2.0.0')
    })
  })
})
