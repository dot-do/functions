/**
 * CSRF Middleware Tests
 *
 * Tests for the CSRF protection middleware including:
 * - Token validation (header + cookie matching)
 * - Safe method bypass (GET, HEAD, OPTIONS)
 * - API key authentication bypass
 * - Path exclusion rules
 * - Timing-safe comparison
 * - Token generation and cookie creation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createCSRFMiddleware,
  csrfMiddleware,
  generateCSRFToken,
  createCSRFCookie,
  CSRFMiddlewareConfig,
} from '../middleware/csrf'

describe('CSRF Middleware', () => {
  let mockEnv: Record<string, unknown>
  let mockCtx: ExecutionContext
  let nextCalled: boolean
  let mockNext: () => Promise<Response>

  beforeEach(() => {
    mockEnv = {}
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext
    nextCalled = false
    mockNext = async () => {
      nextCalled = true
      return new Response('OK', { status: 200 })
    }
  })

  describe('safe methods bypass', () => {
    it('allows GET requests without CSRF token', async () => {
      const middleware = createCSRFMiddleware()

      const request = new Request('https://functions.do/api/data', {
        method: 'GET',
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(true)
      expect(response.status).toBe(200)
    })

    it('allows HEAD requests without CSRF token', async () => {
      const middleware = createCSRFMiddleware()

      const request = new Request('https://functions.do/api/data', {
        method: 'HEAD',
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(true)
      expect(response.status).toBe(200)
    })

    it('allows OPTIONS requests without CSRF token', async () => {
      const middleware = createCSRFMiddleware()

      const request = new Request('https://functions.do/api/data', {
        method: 'OPTIONS',
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(true)
      expect(response.status).toBe(200)
    })
  })

  describe('CSRF token validation', () => {
    it('blocks POST requests without CSRF token', async () => {
      const middleware = createCSRFMiddleware({ excludePaths: [] })

      const request = new Request('https://functions.do/web/submit', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(false)
      expect(response.status).toBe(403)

      const body = await response.json() as Record<string, unknown>
      expect((body['error'] as Record<string, unknown>)?.['code']).toBe('CSRF_INVALID')
      expect((body['error'] as Record<string, unknown>)?.['message']).toContain('Missing')
    })

    it('blocks PUT requests without CSRF token', async () => {
      const middleware = createCSRFMiddleware({ excludePaths: [] })

      const request = new Request('https://functions.do/web/update', {
        method: 'PUT',
        body: JSON.stringify({ data: 'test' }),
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(false)
      expect(response.status).toBe(403)
    })

    it('blocks DELETE requests without CSRF token', async () => {
      const middleware = createCSRFMiddleware({ excludePaths: [] })

      const request = new Request('https://functions.do/web/delete', {
        method: 'DELETE',
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(false)
      expect(response.status).toBe(403)
    })

    it('blocks PATCH requests without CSRF token', async () => {
      const middleware = createCSRFMiddleware({ excludePaths: [] })

      const request = new Request('https://functions.do/web/patch', {
        method: 'PATCH',
        body: JSON.stringify({ data: 'test' }),
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(false)
      expect(response.status).toBe(403)
    })

    it('allows requests when header and cookie tokens match', async () => {
      const middleware = createCSRFMiddleware({ excludePaths: [] })
      const token = 'valid-csrf-token-12345'

      const request = new Request('https://functions.do/web/submit', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': token,
          'Cookie': `csrf=${token}`,
        },
        body: JSON.stringify({ data: 'test' }),
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(true)
      expect(response.status).toBe(200)
    })

    it('blocks requests when header token is missing', async () => {
      const middleware = createCSRFMiddleware({ excludePaths: [] })
      const token = 'valid-csrf-token-12345'

      const request = new Request('https://functions.do/web/submit', {
        method: 'POST',
        headers: {
          'Cookie': `csrf=${token}`,
        },
        body: JSON.stringify({ data: 'test' }),
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(false)
      expect(response.status).toBe(403)
    })

    it('blocks requests when cookie token is missing', async () => {
      const middleware = createCSRFMiddleware({ excludePaths: [] })
      const token = 'valid-csrf-token-12345'

      const request = new Request('https://functions.do/web/submit', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': token,
        },
        body: JSON.stringify({ data: 'test' }),
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(false)
      expect(response.status).toBe(403)
    })

    it('blocks requests when tokens do not match', async () => {
      const middleware = createCSRFMiddleware({ excludePaths: [] })

      const request = new Request('https://functions.do/web/submit', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': 'token-from-header',
          'Cookie': 'csrf=different-token-in-cookie',
        },
        body: JSON.stringify({ data: 'test' }),
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(false)
      expect(response.status).toBe(403)

      const body = await response.json() as Record<string, unknown>
      expect((body['error'] as Record<string, unknown>)?.['code']).toBe('CSRF_INVALID')
      expect((body['error'] as Record<string, unknown>)?.['message']).toContain('Invalid')
    })
  })

  describe('API key authentication bypass', () => {
    it('allows requests with X-API-Key header without CSRF token', async () => {
      const middleware = createCSRFMiddleware({ excludePaths: [] })

      const request = new Request('https://functions.do/web/submit', {
        method: 'POST',
        headers: {
          'X-API-Key': 'sk_live_test123',
        },
        body: JSON.stringify({ data: 'test' }),
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(true)
      expect(response.status).toBe(200)
    })

    it('allows requests with Bearer token without CSRF token', async () => {
      const middleware = createCSRFMiddleware({ excludePaths: [] })

      const request = new Request('https://functions.do/web/submit', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        },
        body: JSON.stringify({ data: 'test' }),
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(true)
      expect(response.status).toBe(200)
    })
  })

  describe('path exclusion', () => {
    it('excludes API paths by default', async () => {
      // Default middleware excludes /api/** and /v1/api/**
      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        body: JSON.stringify({ code: 'function test() {}' }),
      })

      const response = await csrfMiddleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(true)
      expect(response.status).toBe(200)
    })

    it('excludes versioned API paths by default', async () => {
      const request = new Request('https://functions.do/v1/api/functions', {
        method: 'POST',
        body: JSON.stringify({ code: 'function test() {}' }),
      })

      const response = await csrfMiddleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(true)
      expect(response.status).toBe(200)
    })

    it('supports exact path exclusion', async () => {
      const middleware = createCSRFMiddleware({
        excludePaths: ['/webhook'],
      })

      const request = new Request('https://functions.do/webhook', {
        method: 'POST',
        body: JSON.stringify({ event: 'test' }),
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(true)
      expect(response.status).toBe(200)
    })

    it('supports wildcard path exclusion', async () => {
      const middleware = createCSRFMiddleware({
        excludePaths: ['/webhooks/*'],
      })

      const request = new Request('https://functions.do/webhooks/stripe', {
        method: 'POST',
        body: JSON.stringify({ event: 'test' }),
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(true)
      expect(response.status).toBe(200)
    })

    it('supports double wildcard path exclusion', async () => {
      const middleware = createCSRFMiddleware({
        excludePaths: ['/internal/**'],
      })

      const request = new Request('https://functions.do/internal/admin/users', {
        method: 'DELETE',
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(true)
      expect(response.status).toBe(200)
    })
  })

  describe('custom configuration', () => {
    it('supports custom cookie name', async () => {
      const middleware = createCSRFMiddleware({
        cookieName: 'xsrf_token',
        excludePaths: [],
      })

      const token = 'custom-token-123'
      const request = new Request('https://functions.do/web/submit', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': token,
          'Cookie': `xsrf_token=${token}`,
        },
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(true)
      expect(response.status).toBe(200)
    })

    it('supports custom header name', async () => {
      const middleware = createCSRFMiddleware({
        headerName: 'X-XSRF-Token',
        excludePaths: [],
      })

      const token = 'custom-token-123'
      const request = new Request('https://functions.do/web/submit', {
        method: 'POST',
        headers: {
          'X-XSRF-Token': token,
          'Cookie': `csrf=${token}`,
        },
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(true)
      expect(response.status).toBe(200)
    })

    it('supports custom protected methods', async () => {
      const middleware = createCSRFMiddleware({
        protectedMethods: ['POST'], // Only protect POST, not PUT/DELETE/PATCH
        excludePaths: [],
      })

      // PUT should be allowed without CSRF token
      const putRequest = new Request('https://functions.do/web/update', {
        method: 'PUT',
      })
      const putResponse = await middleware(putRequest, mockEnv, mockCtx, mockNext)
      expect(putResponse.status).toBe(200)

      // Reset for next test
      nextCalled = false

      // POST should require CSRF token
      const postRequest = new Request('https://functions.do/web/submit', {
        method: 'POST',
      })
      const postResponse = await middleware(postRequest, mockEnv, mockCtx, mockNext)
      expect(postResponse.status).toBe(403)
    })

    it('can be disabled', async () => {
      const middleware = createCSRFMiddleware({
        enabled: false,
        excludePaths: [],
      })

      const request = new Request('https://functions.do/web/submit', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(true)
      expect(response.status).toBe(200)
    })
  })

  describe('cookie parsing', () => {
    it('handles cookies with equals signs in value', async () => {
      const middleware = createCSRFMiddleware({ excludePaths: [] })
      const token = 'token=with=equals=signs'

      const request = new Request('https://functions.do/web/submit', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': token,
          'Cookie': `csrf=${token}; other=value`,
        },
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(true)
      expect(response.status).toBe(200)
    })

    it('handles multiple cookies', async () => {
      const middleware = createCSRFMiddleware({ excludePaths: [] })
      const token = 'valid-token'

      const request = new Request('https://functions.do/web/submit', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': token,
          'Cookie': `session=abc123; csrf=${token}; theme=dark`,
        },
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(true)
      expect(response.status).toBe(200)
    })

    it('handles empty cookie header', async () => {
      const middleware = createCSRFMiddleware({ excludePaths: [] })

      const request = new Request('https://functions.do/web/submit', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': 'some-token',
          'Cookie': '',
        },
      })

      const response = await middleware(request, mockEnv, mockCtx, mockNext)

      expect(nextCalled).toBe(false)
      expect(response.status).toBe(403)
    })
  })
})

describe('generateCSRFToken', () => {
  it('generates a 64-character hex string', () => {
    const token = generateCSRFToken()

    expect(token).toHaveLength(64)
    expect(token).toMatch(/^[0-9a-f]+$/)
  })

  it('generates unique tokens', () => {
    const tokens = new Set<string>()

    for (let i = 0; i < 100; i++) {
      tokens.add(generateCSRFToken())
    }

    expect(tokens.size).toBe(100)
  })
})

describe('createCSRFCookie', () => {
  it('creates a cookie with default options', () => {
    const token = 'test-token-123'
    const cookie = createCSRFCookie(token)

    expect(cookie).toContain('csrf=test-token-123')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Max-Age=86400')
  })

  it('supports custom cookie name', () => {
    const token = 'test-token-123'
    const cookie = createCSRFCookie(token, { cookieName: 'xsrf' })

    expect(cookie).toContain('xsrf=test-token-123')
  })

  it('supports custom path', () => {
    const token = 'test-token-123'
    const cookie = createCSRFCookie(token, { path: '/app' })

    expect(cookie).toContain('Path=/app')
  })

  it('supports disabling Secure flag', () => {
    const token = 'test-token-123'
    const cookie = createCSRFCookie(token, { secure: false })

    expect(cookie).not.toContain('Secure')
  })

  it('supports different SameSite values', () => {
    const token = 'test-token-123'

    const strictCookie = createCSRFCookie(token, { sameSite: 'Strict' })
    expect(strictCookie).toContain('SameSite=Strict')

    const laxCookie = createCSRFCookie(token, { sameSite: 'Lax' })
    expect(laxCookie).toContain('SameSite=Lax')

    const noneCookie = createCSRFCookie(token, { sameSite: 'None' })
    expect(noneCookie).toContain('SameSite=None')
  })

  it('supports custom max age', () => {
    const token = 'test-token-123'
    const cookie = createCSRFCookie(token, { maxAge: 3600 })

    expect(cookie).toContain('Max-Age=3600')
  })

  it('does not set HttpOnly (JS needs to read it)', () => {
    const token = 'test-token-123'
    const cookie = createCSRFCookie(token)

    expect(cookie).not.toContain('HttpOnly')
  })
})

describe('timing-safe comparison', () => {
  let mockEnv: Record<string, unknown>
  let mockCtx: ExecutionContext

  beforeEach(() => {
    mockEnv = {}
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext
  })

  it('rejects tokens of different lengths', async () => {
    const middleware = createCSRFMiddleware({ excludePaths: [] })

    const request = new Request('https://functions.do/web/submit', {
      method: 'POST',
      headers: {
        'X-CSRF-Token': 'short',
        'Cookie': 'csrf=much-longer-token-value',
      },
    })

    const response = await middleware(request, mockEnv, mockCtx, vi.fn())

    expect(response.status).toBe(403)
  })

  it('handles empty strings correctly', async () => {
    const middleware = createCSRFMiddleware({ excludePaths: [] })

    const request = new Request('https://functions.do/web/submit', {
      method: 'POST',
      headers: {
        'X-CSRF-Token': '',
        'Cookie': 'csrf=',
      },
    })

    // Empty tokens should be rejected as "missing"
    const response = await middleware(request, mockEnv, mockCtx, vi.fn())

    expect(response.status).toBe(403)
  })
})
