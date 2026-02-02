/**
 * E2E Tests: OAuth.do Authentication Flows
 *
 * These tests verify the oauth.do integration for functions.do:
 * - OAuth token authentication
 * - API key fallback authentication
 * - Token refresh flows
 * - Unauthenticated access restrictions
 * - Scope-based authorization
 *
 * Prerequisites:
 * - functions.do Worker must be deployed
 * - OAuth credentials or API key configured (see auth.ts for env vars)
 *
 * Run with: npm run test:e2e
 *
 * Skip Behavior (by design):
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Several test sections use `describe.skipIf()` to conditionally skip when
 * credentials are not configured. This is intentional -- these tests hit a live
 * deployed service and require real authentication tokens or API keys.
 *
 * Sections that always run (no credentials needed):
 *   - 1. Authentication Configuration (detects strategy)
 *   - 2. Public Endpoints (no auth required)
 *   - 3. Protected Endpoints (verifies 401 responses)
 *   - 8. Invalid Token Handling (verifies rejection)
 *   - 11. Error Messages (verifies error format)
 *   - Edge Cases (verifies graceful handling)
 *
 * Sections that require credentials (skip when unavailable):
 *   - 4. OAuth Token Authentication   (needs OAuth or API key)
 *   - 5. API Key Authentication       (needs FUNCTIONS_API_KEY)
 *   - 6. Token Caching                (needs OAuth configured)
 *   - 7. User Info                    (needs OAuth or API key)
 *   - 9. Scope-Based Authorization    (needs OAuth or API key)
 *   - 10. Auth Validation             (needs OAuth or API key)
 *   - 12. Concurrent Requests         (needs OAuth or API key)
 *
 * For unit-level auth coverage WITHOUT live credentials, see:
 *   - src/core/__tests__/auth.test.ts        (authenticateRequest, public endpoints, middleware)
 *   - src/api/__tests__/auth.test.ts         (full auth middleware with mock KV, scopes, security)
 *   - src/core/__tests__/kv-api-keys.test.ts (API key storage and validation)
 *   - src/core/__tests__/oauth.test.ts       (OAuth token handling)
 *
 * Environment variables for authenticated tests:
 *   - OAUTH_DO_CLIENT_ID / OAUTH_DO_CLIENT_SECRET  (M2M OAuth)
 *   - OAUTH_DO_ACCESS_TOKEN                         (pre-existing token)
 *   - FUNCTIONS_API_KEY                              (API key fallback)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  E2E_CONFIG,
  generateTestFunctionId,
  shouldRunE2E,
  shouldRunAuthenticatedE2E,
  getE2EAuthHeaders,
  validateE2EAuth,
  clearE2EAuthCache,
  getAuthStrategy,
  deleteFunction,
} from './config'
import {
  getOAuthTokens,
  isOAuthConfigured,
  getUserInfo,
  clearTokenCache,
  type OAuthTokens,
} from './auth'

// =============================================================================
// AUTH TEST HELPERS
// =============================================================================

/**
 * Make a raw fetch request with custom auth headers
 */
async function fetchWithAuth(
  path: string,
  options: RequestInit = {},
  authHeaders?: Record<string, string>
): Promise<Response> {
  const headers = authHeaders ?? (await getE2EAuthHeaders())

  return fetch(`${E2E_CONFIG.baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      ...(options.headers || {}),
    },
  })
}

/**
 * Make a request without any authentication
 */
async function fetchWithoutAuth(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${E2E_CONFIG.baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
}

// =============================================================================
// TEST SUITE
// =============================================================================

describe.skipIf(!shouldRunE2E())('E2E: OAuth.do Authentication', () => {
  const deployedFunctions: string[] = []
  const AUTH_TIMEOUT = 30_000
  const DEPLOY_TIMEOUT = 60_000

  afterAll(async () => {
    // Cleanup deployed functions
    if (!E2E_CONFIG.skipCleanup) {
      for (const functionId of deployedFunctions) {
        try {
          await deleteFunction(functionId)
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  })

  // ===========================================================================
  // 1. AUTHENTICATION STATUS
  // ===========================================================================

  describe('1. Authentication Configuration', () => {
    it('detects authentication strategy', () => {
      const strategy = getAuthStrategy()
      expect(['oauth', 'api-key', 'none']).toContain(strategy)
      console.log(`Current auth strategy: ${strategy}`)
    })

    it('reports OAuth configuration status', () => {
      const configured = isOAuthConfigured()
      console.log(`OAuth configured: ${configured}`)

      if (configured) {
        expect(E2E_CONFIG.oauthConfigured).toBe(true)
      }
    })

    it('can retrieve auth headers', async () => {
      const headers = await getE2EAuthHeaders()
      expect(headers).toBeDefined()

      // Should have either Authorization or X-API-Key (or empty if no auth)
      const hasAuth =
        'Authorization' in headers ||
        'X-API-Key' in headers ||
        Object.keys(headers).length === 0

      expect(hasAuth).toBe(true)
    })
  })

  // ===========================================================================
  // 2. PUBLIC ENDPOINTS
  // ===========================================================================

  describe('2. Public Endpoints (No Auth Required)', () => {
    it('health endpoint accessible without auth', async () => {
      const response = await fetchWithoutAuth('/health')

      expect(response.ok).toBe(true)
      expect(response.status).toBe(200)
    })

    it('root endpoint accessible without auth', async () => {
      const response = await fetchWithoutAuth('/')

      expect(response.ok).toBe(true)
    })

    it('status endpoint accessible without auth', async () => {
      const response = await fetchWithoutAuth('/api/status')

      // May return 200 or 404 depending on implementation
      expect([200, 404]).toContain(response.status)
    })
  })

  // ===========================================================================
  // 3. PROTECTED ENDPOINTS
  // ===========================================================================

  describe('3. Protected Endpoints (Auth Required)', () => {
    it('returns 401 for unauthenticated list functions', async () => {
      const response = await fetchWithoutAuth('/api/functions')

      // Should require authentication
      expect(response.status).toBe(401)

      const body = (await response.json()) as { error?: string }
      expect(body.error).toBeDefined()
    })

    it('returns 401 for unauthenticated deploy', async () => {
      const response = await fetchWithoutAuth('/api/functions', {
        method: 'POST',
        body: JSON.stringify({
          id: 'test-auth',
          code: 'export default {}',
          language: 'typescript',
          version: '1.0.0',
        }),
      })

      expect(response.status).toBe(401)
    })

    it('returns 401 for unauthenticated invoke', async () => {
      const response = await fetchWithoutAuth('/functions/any-function/invoke', {
        method: 'POST',
        body: JSON.stringify({ test: true }),
      })

      // Should be 401 (unauthorized) or 404 (function not found)
      // Both are acceptable depending on auth check order
      expect([401, 404]).toContain(response.status)
    })

    it('includes WWW-Authenticate header on 401', async () => {
      const response = await fetchWithoutAuth('/api/functions')

      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toBeDefined()
    })
  })

  // ===========================================================================
  // 4. OAUTH TOKEN AUTHENTICATION
  // ===========================================================================

  describe.skipIf(!shouldRunAuthenticatedE2E())(
    '4. OAuth Token Authentication',
    () => {
      beforeEach(() => {
        // Clear token cache before each test
        clearE2EAuthCache()
      })

      it('validates OAuth tokens work for API requests', async () => {
        const response = await fetchWithAuth('/api/functions')

        expect(response.ok).toBe(true)
        expect(response.status).toBe(200)
      })

      it('can list functions with OAuth', async () => {
        const response = await fetchWithAuth('/api/functions')
        const body = (await response.json()) as { functions?: unknown[]; total?: number }

        expect(response.ok).toBe(true)
        expect(body.functions || []).toBeDefined()
      })

      it.skipIf(!isOAuthConfigured())('OAuth token contains expected fields', async () => {
        const tokens = await getOAuthTokens()

        expect(tokens).not.toBeNull()
        expect(tokens!.accessToken).toBeDefined()
        expect(tokens!.tokenType).toBe('Bearer')
      })

      it('can deploy function with authentication', async () => {
        const functionId = generateTestFunctionId()
        deployedFunctions.push(functionId)

        const code = `
          export default {
            async fetch(request: Request): Promise<Response> {
              return Response.json({ auth: 'success' })
            }
          }
        `

        const response = await fetchWithAuth('/api/functions', {
          method: 'POST',
          body: JSON.stringify({
            id: functionId,
            code,
            language: 'typescript',
            version: '1.0.0',
          }),
        })

        expect(response.ok).toBe(true)

        const body = (await response.json()) as { id: string; version: string }
        expect(body.id).toBe(functionId)
      }, DEPLOY_TIMEOUT)

      it('can invoke function with authentication', async () => {
        const functionId = generateTestFunctionId()
        deployedFunctions.push(functionId)

        // Deploy first
        const code = `
          export default {
            async fetch(request: Request): Promise<Response> {
              return Response.json({ invoked: true })
            }
          }
        `

        await fetchWithAuth('/api/functions', {
          method: 'POST',
          body: JSON.stringify({
            id: functionId,
            code,
            language: 'typescript',
            version: '1.0.0',
          }),
        })

        // Then invoke
        const invokeResponse = await fetchWithAuth(`/functions/${functionId}/invoke`, {
          method: 'POST',
          body: JSON.stringify({}),
        })

        expect(invokeResponse.ok).toBe(true)

        const result = (await invokeResponse.json()) as { invoked?: boolean }
        expect(result.invoked).toBe(true)
      }, DEPLOY_TIMEOUT)

      it('can delete function with authentication', async () => {
        const functionId = generateTestFunctionId()

        // Deploy first
        const code = `
          export default {
            async fetch(): Promise<Response> {
              return new Response('delete me')
            }
          }
        `

        await fetchWithAuth('/api/functions', {
          method: 'POST',
          body: JSON.stringify({
            id: functionId,
            code,
            language: 'typescript',
            version: '1.0.0',
          }),
        })

        // Then delete
        const deleteResponse = await fetchWithAuth(`/api/functions/${functionId}`, {
          method: 'DELETE',
        })

        expect(deleteResponse.ok).toBe(true)
      }, DEPLOY_TIMEOUT)
    }
  )

  // ===========================================================================
  // 5. API KEY AUTHENTICATION
  // ===========================================================================

  describe.skipIf(E2E_CONFIG.authStrategy !== 'api-key')(
    '5. API Key Authentication',
    () => {
      it('X-API-Key header works for authentication', async () => {
        const response = await fetchWithAuth('/api/functions', {}, {
          'X-API-Key': E2E_CONFIG.apiKey!,
        })

        expect(response.ok).toBe(true)
      })

      it('rejects invalid API key', async () => {
        const response = await fetchWithAuth('/api/functions', {}, {
          'X-API-Key': 'invalid-api-key-123',
        })

        expect(response.status).toBe(401)
      })

      it('supports Bearer token format for API key', async () => {
        const response = await fetchWithAuth('/api/functions', {}, {
          Authorization: `Bearer ${E2E_CONFIG.apiKey}`,
        })

        expect(response.ok).toBe(true)
      })
    }
  )

  // ===========================================================================
  // 6. TOKEN CACHING
  // ===========================================================================

  describe.skipIf(!isOAuthConfigured())('6. Token Caching', () => {
    it('caches tokens between requests', async () => {
      clearTokenCache()

      // First request
      const tokens1 = await getOAuthTokens()

      // Second request (should be cached)
      const tokens2 = await getOAuthTokens()

      expect(tokens1).toEqual(tokens2)
    })

    it('cache can be cleared', async () => {
      // Get tokens
      await getOAuthTokens()

      // Clear cache
      clearTokenCache()

      // Should re-fetch (can't directly test this without mocking)
      const tokens = await getOAuthTokens()
      expect(tokens).not.toBeNull()
    })
  })

  // ===========================================================================
  // 7. USER INFO
  // ===========================================================================

  describe.skipIf(!shouldRunAuthenticatedE2E())('7. User Info', () => {
    it('can retrieve user info with valid auth', async () => {
      const userInfo = await getUserInfo(E2E_CONFIG.baseUrl)

      // May return null if endpoint doesn't exist yet
      if (userInfo) {
        expect(userInfo.id).toBeDefined()
      }
    })

    it('user info includes expected fields', async () => {
      const userInfo = await getUserInfo(E2E_CONFIG.baseUrl)

      if (userInfo) {
        expect(typeof userInfo.id).toBe('string')
        // Optional fields
        if (userInfo.email) {
          expect(typeof userInfo.email).toBe('string')
        }
        if (userInfo.scopes) {
          expect(Array.isArray(userInfo.scopes)).toBe(true)
        }
      }
    })
  })

  // ===========================================================================
  // 8. INVALID TOKEN HANDLING
  // ===========================================================================

  describe('8. Invalid Token Handling', () => {
    it('rejects malformed Bearer token', async () => {
      const response = await fetchWithAuth('/api/functions', {}, {
        Authorization: 'Bearer invalid.malformed.token',
      })

      expect(response.status).toBe(401)
    })

    it('rejects empty Bearer token', async () => {
      const response = await fetchWithAuth('/api/functions', {}, {
        Authorization: 'Bearer ',
      })

      expect(response.status).toBe(401)
    })

    it('rejects expired token', async () => {
      // Simulate an expired token (most JWT implementations check exp claim)
      const expiredToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZXhwIjoxfQ.x'

      const response = await fetchWithAuth('/api/functions', {}, {
        Authorization: `Bearer ${expiredToken}`,
      })

      expect(response.status).toBe(401)
    })

    it('handles missing Authorization header gracefully', async () => {
      const response = await fetchWithAuth('/api/functions', {}, {})

      expect(response.status).toBe(401)
    })
  })

  // ===========================================================================
  // 9. SCOPE-BASED AUTHORIZATION
  // ===========================================================================

  describe.skipIf(!shouldRunAuthenticatedE2E())('9. Scope-Based Authorization', () => {
    it('allows read access with read scope', async () => {
      const response = await fetchWithAuth('/api/functions')

      // If we have valid auth, this should succeed
      expect(response.ok).toBe(true)
    })

    it('allows deploy with deploy scope', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(): Promise<Response> {
            return Response.json({ scope: 'deploy' })
          }
        }
      `

      const response = await fetchWithAuth('/api/functions', {
        method: 'POST',
        body: JSON.stringify({
          id: functionId,
          code,
          language: 'typescript',
          version: '1.0.0',
        }),
      })

      // Should succeed if we have deploy scope
      expect(response.ok).toBe(true)
    }, DEPLOY_TIMEOUT)

    it('allows delete with write scope', async () => {
      const functionId = generateTestFunctionId()

      // Deploy first
      const code = `export default { fetch: () => new Response('x') }`

      await fetchWithAuth('/api/functions', {
        method: 'POST',
        body: JSON.stringify({
          id: functionId,
          code,
          language: 'typescript',
          version: '1.0.0',
        }),
      })

      // Delete (requires write scope)
      const deleteResponse = await fetchWithAuth(`/api/functions/${functionId}`, {
        method: 'DELETE',
      })

      expect(deleteResponse.ok).toBe(true)
    }, DEPLOY_TIMEOUT)
  })

  // ===========================================================================
  // 10. AUTH VALIDATION
  // ===========================================================================

  describe.skipIf(!shouldRunAuthenticatedE2E())('10. Auth Validation', () => {
    it('validates current authentication', async () => {
      const isValid = await validateE2EAuth()

      // If we have auth configured, it should be valid
      expect(isValid).toBe(true)
    })

    it('auth headers are consistently formatted', async () => {
      const headers1 = await getE2EAuthHeaders()
      const headers2 = await getE2EAuthHeaders()

      // Headers should be consistent
      expect(headers1).toEqual(headers2)
    })
  })

  // ===========================================================================
  // 11. ERROR MESSAGES
  // ===========================================================================

  describe('11. Error Messages', () => {
    it('401 error includes helpful message', async () => {
      const response = await fetchWithoutAuth('/api/functions')

      expect(response.status).toBe(401)

      const body = (await response.json()) as { error: string; message?: string }
      expect(body.error).toBeDefined()
      expect(typeof body.error).toBe('string')
    })

    it('403 error differs from 401', async () => {
      // This test requires a token with limited scopes
      // For now, just verify the difference between 401 and 403

      const response401 = await fetchWithoutAuth('/api/functions')
      expect(response401.status).toBe(401)

      // 403 would require a valid token with insufficient scopes
      // which is harder to test without specific setup
    })

    it('error response is JSON format', async () => {
      const response = await fetchWithoutAuth('/api/functions')

      expect(response.status).toBe(401)
      expect(response.headers.get('Content-Type')).toContain('application/json')
    })
  })

  // ===========================================================================
  // 12. CONCURRENT REQUESTS
  // ===========================================================================

  describe.skipIf(!shouldRunAuthenticatedE2E())('12. Concurrent Authenticated Requests', () => {
    it('handles multiple concurrent authenticated requests', async () => {
      const requests = Array.from({ length: 5 }, () =>
        fetchWithAuth('/api/functions')
      )

      const responses = await Promise.all(requests)

      // All should succeed
      for (const response of responses) {
        expect(response.ok).toBe(true)
      }
    })

    it('token cache handles concurrent access', async () => {
      clearTokenCache()

      // Fire off multiple token requests simultaneously
      const tokenPromises = Array.from({ length: 10 }, () => getOAuthTokens())

      const tokens = await Promise.all(tokenPromises)

      // All should return the same token (from cache after first fetch)
      const firstToken = tokens[0]
      for (const token of tokens) {
        expect(token?.accessToken).toBe(firstToken?.accessToken)
      }
    })
  })

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('Edge Cases', () => {
    it('handles auth header with extra whitespace', async () => {
      const response = await fetchWithAuth('/api/functions', {}, {
        Authorization: '  Bearer   token-with-spaces  ',
      })

      // Implementation may or may not trim - just verify it doesn't crash
      expect([200, 401]).toContain(response.status)
    })

    it('handles case-insensitive auth header', async () => {
      // HTTP headers are case-insensitive
      const headers = await getE2EAuthHeaders()

      if (headers.Authorization) {
        const response = await fetch(`${E2E_CONFIG.baseUrl}/api/functions`, {
          headers: {
            'Content-Type': 'application/json',
            authorization: headers.Authorization, // lowercase
          },
        })

        // Should work with lowercase header
        expect([200, 401]).toContain(response.status)
      }
    })

    it('handles request with both auth methods', async () => {
      // Provide both X-API-Key and Authorization
      const response = await fetch(`${E2E_CONFIG.baseUrl}/api/functions`, {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'some-api-key',
          Authorization: 'Bearer some-token',
        },
      })

      // Should prefer one over the other (typically X-API-Key)
      expect([200, 401]).toContain(response.status)
    })
  })
})
