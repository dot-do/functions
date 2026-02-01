/**
 * Auth Middleware Tests - RED Phase
 *
 * Tests for the refactored authentication middleware including:
 * - Public endpoint access
 * - API key validation from various sources
 * - User context attachment
 * - Error responses
 *
 * These tests import modules that don't exist yet - they will FAIL
 * until the implementation is complete.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockKV } from '../../test-utils/mock-kv'

// Import the auth middleware that doesn't exist yet
// These imports will cause the tests to fail (RED phase)
import {
  authMiddleware,
  AuthMiddlewareConfig,
  AuthContext,
  createAuthMiddleware,
} from '../middleware/auth'

// Type for JSON response bodies
type JsonBody = Record<string, unknown>

describe('Auth Middleware', () => {
  let mockEnv: {
    FUNCTIONS_API_KEYS: KVNamespace
  }
  let mockCtx: ExecutionContext

  beforeEach(async () => {
    mockEnv = {
      FUNCTIONS_API_KEYS: createMockKV(),
    }
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext

    // Set up test API keys
    await mockEnv.FUNCTIONS_API_KEYS.put(
      'valid-api-key-123',
      JSON.stringify({
        userId: 'user-456',
        active: true,
        scopes: ['read', 'write', 'deploy'],
      })
    )

    await mockEnv.FUNCTIONS_API_KEYS.put(
      'read-only-key',
      JSON.stringify({
        userId: 'user-readonly',
        active: true,
        scopes: ['read'],
      })
    )

    await mockEnv.FUNCTIONS_API_KEYS.put(
      'inactive-key',
      JSON.stringify({
        userId: 'user-inactive',
        active: false,
      })
    )

    await mockEnv.FUNCTIONS_API_KEYS.put(
      'expired-key',
      JSON.stringify({
        userId: 'user-expired',
        active: true,
        expiresAt: '2020-01-01T00:00:00Z', // Expired in the past
      })
    )
  })

  describe('public endpoints', () => {
    it('allows public endpoints without auth', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/health', '/', '/api/status'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
      }

      const middleware = createAuthMiddleware(config)

      // Test various public endpoints
      const publicRequests = [
        new Request('https://functions.do/health'),
        new Request('https://functions.do/'),
        new Request('https://functions.do/api/status'),
      ]

      for (const request of publicRequests) {
        const result = await middleware(request, mockEnv, mockCtx)

        // Public endpoints should pass through (return null or success context)
        expect(result.error).toBeUndefined()
        expect(result.shouldContinue).toBe(true)
      }
    })

    it('supports wildcard patterns for public endpoints', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/public/*', '/docs/**'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
      }

      const middleware = createAuthMiddleware(config)

      const publicRequests = [
        new Request('https://functions.do/public/anything'),
        new Request('https://functions.do/docs/getting-started'),
        new Request('https://functions.do/docs/api/reference'),
      ]

      for (const request of publicRequests) {
        const result = await middleware(request, mockEnv, mockCtx)
        expect(result.shouldContinue).toBe(true)
      }
    })
  })

  describe('API key validation', () => {
    it('requires API key for protected endpoints', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/health'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
      }

      const middleware = createAuthMiddleware(config)

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        // No API key provided
      })

      const result = await middleware(request, mockEnv, mockCtx)

      expect(result.shouldContinue).toBe(false)
      expect(result.response?.status).toBe(401)
    })

    it('validates API key from X-API-Key header', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/health'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
      }

      const middleware = createAuthMiddleware(config)

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: {
          'X-API-Key': 'valid-api-key-123',
        },
      })

      const result = await middleware(request, mockEnv, mockCtx)

      expect(result.shouldContinue).toBe(true)
      expect(result.authContext?.userId).toBe('user-456')
    })

    it('validates API key from Authorization Bearer', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/health'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
      }

      const middleware = createAuthMiddleware(config)

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer valid-api-key-123',
        },
      })

      const result = await middleware(request, mockEnv, mockCtx)

      expect(result.shouldContinue).toBe(true)
      expect(result.authContext?.userId).toBe('user-456')
    })

    it('prefers X-API-Key over Authorization header', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/health'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
      }

      const middleware = createAuthMiddleware(config)

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: {
          'X-API-Key': 'valid-api-key-123',
          Authorization: 'Bearer different-key',
        },
      })

      const result = await middleware(request, mockEnv, mockCtx)

      expect(result.shouldContinue).toBe(true)
      expect(result.authContext?.userId).toBe('user-456')
    })

    it('returns 401 for missing API key', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/health'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
      }

      const middleware = createAuthMiddleware(config)

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
      })

      const result = await middleware(request, mockEnv, mockCtx)

      expect(result.shouldContinue).toBe(false)
      expect(result.response?.status).toBe(401)

      const body = (await result.response?.json()) as JsonBody
      expect(body.error).toBe('Missing API key')
    })

    it('returns 401 for invalid API key', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/health'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
      }

      const middleware = createAuthMiddleware(config)

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: {
          'X-API-Key': 'completely-invalid-key',
        },
      })

      const result = await middleware(request, mockEnv, mockCtx)

      expect(result.shouldContinue).toBe(false)
      expect(result.response?.status).toBe(401)

      const body = (await result.response?.json()) as JsonBody
      expect(body.error).toBe('Invalid API key')
    })

    it('returns 401 for expired API key', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/health'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
      }

      const middleware = createAuthMiddleware(config)

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: {
          'X-API-Key': 'expired-key',
        },
      })

      const result = await middleware(request, mockEnv, mockCtx)

      expect(result.shouldContinue).toBe(false)
      expect(result.response?.status).toBe(401)

      const body = (await result.response?.json()) as JsonBody
      expect(body.error).toContain('expired')
    })

    it('returns 401 for inactive API key', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/health'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
      }

      const middleware = createAuthMiddleware(config)

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: {
          'X-API-Key': 'inactive-key',
        },
      })

      const result = await middleware(request, mockEnv, mockCtx)

      expect(result.shouldContinue).toBe(false)
      expect(result.response?.status).toBe(401)
    })
  })

  describe('user context', () => {
    it('attaches user context to request', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/health'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
      }

      const middleware = createAuthMiddleware(config)

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: {
          'X-API-Key': 'valid-api-key-123',
        },
      })

      const result = await middleware(request, mockEnv, mockCtx)

      expect(result.authContext).toBeDefined()
      expect(result.authContext?.userId).toBe('user-456')
      expect(result.authContext?.apiKey).toBe('valid-api-key-123')
      expect(result.authContext?.scopes).toContain('read')
      expect(result.authContext?.scopes).toContain('write')
      expect(result.authContext?.scopes).toContain('deploy')
    })

    it('includes authentication timestamp', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/health'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
      }

      const middleware = createAuthMiddleware(config)
      const beforeAuth = Date.now()

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: {
          'X-API-Key': 'valid-api-key-123',
        },
      })

      const result = await middleware(request, mockEnv, mockCtx)
      const afterAuth = Date.now()

      expect(result.authContext?.authenticatedAt).toBeDefined()
      expect(result.authContext?.authenticatedAt).toBeGreaterThanOrEqual(beforeAuth)
      expect(result.authContext?.authenticatedAt).toBeLessThanOrEqual(afterAuth)
    })
  })

  describe('scope validation', () => {
    it('validates required scopes for endpoint', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/health'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
        scopeRequirements: {
          'POST /api/functions': ['deploy'],
          'DELETE /api/functions/*': ['deploy'],
          'GET /api/functions/*': ['read'],
        },
      }

      const middleware = createAuthMiddleware(config)

      // Read-only key should not be able to deploy
      const deployRequest = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: {
          'X-API-Key': 'read-only-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: 'test',
          version: '1.0.0',
          language: 'typescript',
          code: 'export default {}',
        }),
      })

      const result = await middleware(deployRequest, mockEnv, mockCtx)

      expect(result.shouldContinue).toBe(false)
      expect(result.response?.status).toBe(403) // Forbidden, not 401
    })

    it('allows access with sufficient scopes', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/health'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
        scopeRequirements: {
          'GET /api/functions/*': ['read'],
        },
      }

      const middleware = createAuthMiddleware(config)

      const request = new Request('https://functions.do/api/functions/test-func', {
        method: 'GET',
        headers: {
          'X-API-Key': 'read-only-key',
        },
      })

      const result = await middleware(request, mockEnv, mockCtx)

      expect(result.shouldContinue).toBe(true)
    })
  })

  describe('error response format', () => {
    it('returns JSON error responses', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/health'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
      }

      const middleware = createAuthMiddleware(config)

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
      })

      const result = await middleware(request, mockEnv, mockCtx)

      expect(result.response?.headers.get('Content-Type')).toBe('application/json')
    })

    it('includes WWW-Authenticate header on 401', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/health'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
      }

      const middleware = createAuthMiddleware(config)

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
      })

      const result = await middleware(request, mockEnv, mockCtx)

      expect(result.response?.headers.get('WWW-Authenticate')).toBeDefined()
    })
  })

  describe('configuration options', () => {
    it('supports custom header name', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/health'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
        apiKeyHeader: 'X-Custom-Auth',
      }

      const middleware = createAuthMiddleware(config)

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: {
          'X-Custom-Auth': 'valid-api-key-123',
        },
      })

      const result = await middleware(request, mockEnv, mockCtx)

      expect(result.shouldContinue).toBe(true)
    })

    it('supports auth bypass for internal requests', async () => {
      const config: AuthMiddlewareConfig = {
        publicEndpoints: ['/health'],
        apiKeysKV: mockEnv.FUNCTIONS_API_KEYS,
        trustInternalRequests: true,
        internalHeader: 'X-Internal-Request',
        internalSecret: 'internal-secret-123',
      }

      const middleware = createAuthMiddleware(config)

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: {
          'X-Internal-Request': 'internal-secret-123',
        },
      })

      const result = await middleware(request, mockEnv, mockCtx)

      expect(result.shouldContinue).toBe(true)
      expect(result.authContext?.isInternal).toBe(true)
    })
  })
})

describe('authMiddleware default export', () => {
  let mockEnv: {
    FUNCTIONS_API_KEYS: KVNamespace
  }
  let mockCtx: ExecutionContext

  beforeEach(async () => {
    mockEnv = {
      FUNCTIONS_API_KEYS: createMockKV(),
    }
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext

    await mockEnv.FUNCTIONS_API_KEYS.put(
      'test-key',
      JSON.stringify({ userId: 'user-1', active: true })
    )
  })

  it('works with default configuration', async () => {
    const request = new Request('https://functions.do/api/functions', {
      method: 'GET',
      headers: {
        'X-API-Key': 'test-key',
      },
    })

    const result = await authMiddleware(request, mockEnv, mockCtx)

    expect(result.shouldContinue).toBe(true)
  })

  it('allows health endpoint by default', async () => {
    const request = new Request('https://functions.do/health')

    const result = await authMiddleware(request, mockEnv, mockCtx)

    expect(result.shouldContinue).toBe(true)
  })
})
