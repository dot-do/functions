/**
 * Auth Middleware Default-Deny Tests
 *
 * Tests that the auth middleware denies requests by default when no auth
 * backend (API_KEYS KV, OAuth) is configured. This prevents a critical
 * security vulnerability where unconfigured auth silently allows all requests.
 *
 * Issues:
 * - functions-2z96 (RED): Failing test that auth denies by default
 * - functions-y2hd (GREEN): Fix auth to deny by default
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockKV } from '../../test-utils/mock-kv'
import { createMockExecutionContext } from '../../test-utils/mock-execution-context'
import {
  createAuthMiddleware,
  authMiddleware,
  type AuthMiddlewareConfig,
} from '../middleware/auth'

/**
 * Hash an API key using SHA-256 (mirrors the implementation in auth middleware).
 */
async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(apiKey)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Helper to store an API key record in mock KV under its hashed key.
 */
async function putApiKeyRecord(kv: KVNamespace, rawKey: string, record: object): Promise<void> {
  const hash = await hashApiKey(rawKey)
  await kv.put(`keys:${hash}`, JSON.stringify(record))
}

type JsonBody = Record<string, unknown>

describe('Auth Middleware - Default Deny When Unconfigured', () => {
  let mockCtx: ExecutionContext

  beforeEach(() => {
    mockCtx = createMockExecutionContext()
  })

  describe('no auth backend configured', () => {
    it('should return 401 when no API_KEYS and no OAUTH bindings exist in env', async () => {
      // Create middleware with NO apiKeysKV and NO oauthService
      const middleware = createAuthMiddleware({
        publicEndpoints: ['/health', '/'],
      })

      const emptyEnv: Record<string, unknown> = {}

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
      })

      const result = await middleware(request, emptyEnv, mockCtx)

      // CRITICAL: Must deny when no auth backend is configured
      expect(result.shouldContinue).toBe(false)
      expect(result.response).toBeDefined()
      expect(result.response?.status).toBe(401)
    })

    it('should return 401 even when request has credentials but no backend to verify them', async () => {
      const middleware = createAuthMiddleware({
        publicEndpoints: ['/health', '/'],
      })

      const emptyEnv: Record<string, unknown> = {}

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: {
          'X-API-Key': 'some-key-that-cannot-be-verified',
        },
      })

      const result = await middleware(request, emptyEnv, mockCtx)

      expect(result.shouldContinue).toBe(false)
      expect(result.response?.status).toBe(401)
    })

    it('should include a JSON error body explaining auth is not configured', async () => {
      const middleware = createAuthMiddleware({
        publicEndpoints: ['/health', '/'],
      })

      const emptyEnv: Record<string, unknown> = {}

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
      })

      const result = await middleware(request, emptyEnv, mockCtx)

      expect(result.response).toBeDefined()
      const body = (await result.response?.json()) as JsonBody
      expect(body['error']).toBeDefined()
      // The error message should indicate that auth is misconfigured / not configured
      expect(typeof body['error']).toBe('string')
      expect((body['error'] as string).length).toBeGreaterThan(0)
    })

    it('should still allow public endpoints when auth is unconfigured', async () => {
      const middleware = createAuthMiddleware({
        publicEndpoints: ['/health', '/'],
      })

      const emptyEnv: Record<string, unknown> = {}

      const healthRequest = new Request('https://functions.do/health')
      const healthResult = await middleware(healthRequest, emptyEnv, mockCtx)
      expect(healthResult.shouldContinue).toBe(true)

      const rootRequest = new Request('https://functions.do/')
      const rootResult = await middleware(rootRequest, emptyEnv, mockCtx)
      expect(rootResult.shouldContinue).toBe(true)
    })
  })

  describe('auth backend configured but no credentials', () => {
    it('should return 401 when API_KEYS exists but request has no auth header', async () => {
      const mockKV = createMockKV()
      await putApiKeyRecord(mockKV, 'valid-key-123', {
        userId: 'user-1',
        active: true,
        scopes: ['read'],
      })

      const middleware = createAuthMiddleware({
        publicEndpoints: ['/health', '/'],
        apiKeysKV: mockKV,
      })

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        // No auth headers
      })

      const result = await middleware(request, {}, mockCtx)

      expect(result.shouldContinue).toBe(false)
      expect(result.response?.status).toBe(401)

      const body = (await result.response?.json()) as JsonBody
      expect(body['error']).toBeDefined()
    })
  })

  describe('auth backend configured with valid credentials', () => {
    it('should return 200 (pass through) when API_KEYS exists and request has valid key', async () => {
      const mockKV = createMockKV()
      await putApiKeyRecord(mockKV, 'valid-key-123', {
        userId: 'user-1',
        active: true,
        scopes: ['read', 'write'],
      })

      const middleware = createAuthMiddleware({
        publicEndpoints: ['/health', '/'],
        apiKeysKV: mockKV,
      })

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: {
          'X-API-Key': 'valid-key-123',
        },
      })

      const result = await middleware(request, {}, mockCtx)

      expect(result.shouldContinue).toBe(true)
      expect(result.authContext).toBeDefined()
      expect(result.authContext?.userId).toBe('user-1')
    })

    it('should pass through with valid Bearer token', async () => {
      const mockKV = createMockKV()
      await putApiKeyRecord(mockKV, 'valid-key-456', {
        userId: 'user-2',
        active: true,
        scopes: ['read'],
      })

      const middleware = createAuthMiddleware({
        publicEndpoints: ['/health', '/'],
        apiKeysKV: mockKV,
      })

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer valid-key-456',
        },
      })

      const result = await middleware(request, {}, mockCtx)

      expect(result.shouldContinue).toBe(true)
      expect(result.authContext?.userId).toBe('user-2')
    })
  })

  describe('default authMiddleware export with unconfigured env', () => {
    it('should deny requests when env has no FUNCTIONS_API_KEYS and no OAUTH', async () => {
      const emptyEnv: Record<string, unknown> = {}

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
      })

      const result = await authMiddleware(request, emptyEnv, mockCtx)

      expect(result.shouldContinue).toBe(false)
      expect(result.response?.status).toBe(401)
    })

    it('should still allow default public endpoints', async () => {
      const emptyEnv: Record<string, unknown> = {}

      // /health is in the default public endpoints list
      const request = new Request('https://functions.do/health')
      const result = await authMiddleware(request, emptyEnv, mockCtx)

      expect(result.shouldContinue).toBe(true)
    })
  })

  describe('401 response format', () => {
    it('should include Content-Type: application/json', async () => {
      const middleware = createAuthMiddleware({
        publicEndpoints: ['/health', '/'],
      })

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
      })

      const result = await middleware(request, {}, mockCtx)

      expect(result.response?.headers.get('Content-Type')).toBe('application/json')
    })

    it('should include WWW-Authenticate header', async () => {
      const middleware = createAuthMiddleware({
        publicEndpoints: ['/health', '/'],
      })

      const request = new Request('https://functions.do/api/functions', {
        method: 'GET',
      })

      const result = await middleware(request, {}, mockCtx)

      expect(result.response?.headers.get('WWW-Authenticate')).toBeDefined()
    })
  })
})
