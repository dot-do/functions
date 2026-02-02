/**
 * CSRF Middleware for Functions.do
 *
 * Provides Cross-Site Request Forgery protection for state-changing endpoints.
 * This middleware verifies that a CSRF token from a request header matches
 * the token stored in a cookie, protecting against browser-based attacks.
 *
 * Note: This middleware is designed for browser-based clients. API clients
 * using API keys or OAuth tokens typically don't need CSRF protection since
 * they use explicit authentication headers that cannot be forged by browsers.
 */

import { jsonResponse } from '../http-utils'

/**
 * Configuration for CSRF middleware
 */
export interface CSRFMiddlewareConfig {
  /** Name of the cookie containing the CSRF token (default: 'csrf') */
  cookieName?: string
  /** Name of the header containing the CSRF token (default: 'X-CSRF-Token') */
  headerName?: string
  /** HTTP methods that require CSRF validation (default: POST, PUT, PATCH, DELETE) */
  protectedMethods?: string[]
  /** Paths to exclude from CSRF validation (e.g., API endpoints using API keys) */
  excludePaths?: string[]
  /** Whether to enable CSRF protection (default: true) */
  enabled?: boolean
}

/**
 * Result of CSRF middleware execution
 */
export interface CSRFMiddlewareResult {
  shouldContinue: boolean
  response?: Response
  error?: string
}

/**
 * Safe HTTP methods that don't require CSRF protection
 */
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

/**
 * Default HTTP methods that require CSRF protection
 */
const DEFAULT_PROTECTED_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

/**
 * Parse cookies from Cookie header
 */
function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) {
    return {}
  }

  const cookies: Record<string, string> = {}
  const pairs = cookieHeader.split(';')

  for (const pair of pairs) {
    const [name, ...valueParts] = pair.trim().split('=')
    if (name) {
      // Handle cookies with '=' in the value
      cookies[name.trim()] = valueParts.join('=').trim()
    }
  }

  return cookies
}

/**
 * Check if a path matches any of the exclude patterns
 */
function isExcludedPath(path: string, excludePaths?: string[]): boolean {
  if (!excludePaths || excludePaths.length === 0) {
    return false
  }

  for (const pattern of excludePaths) {
    // Exact match
    if (pattern === path) {
      return true
    }

    // Wildcard match (e.g., '/api/*' matches '/api/anything')
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1) // Remove the '*'
      if (path.startsWith(prefix) || path === prefix.slice(0, -1)) {
        return true
      }
    }

    // Double wildcard match (e.g., '/api/**' matches '/api/functions/test')
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -2) // Remove the '**'
      if (path.startsWith(prefix) || path === prefix.slice(0, -1)) {
        return true
      }
    }
  }

  return false
}

/**
 * Check if request has API key authentication (which doesn't need CSRF)
 */
function hasApiKeyAuth(request: Request): boolean {
  // Check for X-API-Key header
  if (request.headers.get('X-API-Key')) {
    return true
  }

  // Check for Bearer token in Authorization header
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return true
  }

  return false
}

/**
 * Create CSRF middleware with custom configuration
 */
export function createCSRFMiddleware(config: CSRFMiddlewareConfig = {}): CSRFMiddleware {
  const {
    cookieName = 'csrf',
    headerName = 'X-CSRF-Token',
    protectedMethods = DEFAULT_PROTECTED_METHODS,
    excludePaths = [],
    enabled = true,
  } = config

  return async (
    request: Request,
    env: Record<string, unknown>,
    ctx: ExecutionContext,
    next: () => Promise<Response>
  ): Promise<Response> => {
    // Skip if CSRF protection is disabled
    if (!enabled) {
      return next()
    }

    const method = request.method.toUpperCase()

    // Skip for safe methods (GET, HEAD, OPTIONS)
    if (SAFE_METHODS.includes(method)) {
      return next()
    }

    // Skip for methods not in the protected list
    if (!protectedMethods.includes(method)) {
      return next()
    }

    // Skip for requests with API key authentication
    // API clients don't need CSRF protection since they use explicit auth headers
    if (hasApiKeyAuth(request)) {
      return next()
    }

    const url = new URL(request.url)
    const path = url.pathname

    // Skip for excluded paths
    if (isExcludedPath(path, excludePaths)) {
      return next()
    }

    // Get CSRF token from header
    const tokenHeader = request.headers.get(headerName)

    // Get CSRF token from cookie
    const cookieHeader = request.headers.get('Cookie')
    const cookies = parseCookies(cookieHeader)
    const tokenCookie = cookies[cookieName]

    // Validate: both must be present and match
    if (!tokenHeader || !tokenCookie) {
      return jsonResponse(
        {
          error: {
            code: 'CSRF_INVALID',
            message: 'Missing CSRF token',
          },
        },
        403
      )
    }

    // Use timing-safe comparison to prevent timing attacks
    if (!timingSafeEqual(tokenHeader, tokenCookie)) {
      return jsonResponse(
        {
          error: {
            code: 'CSRF_INVALID',
            message: 'Invalid CSRF token',
          },
        },
        403
      )
    }

    return next()
  }
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 * Compares two strings in constant time to avoid leaking information
 * about the expected token through timing differences.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Even if lengths differ, do a comparison to maintain constant time
    // by comparing against a dummy string of the same length as 'a'
    let result = a.length === b.length ? 1 : 0
    for (let i = 0; i < a.length; i++) {
      result &= a.charCodeAt(i) === a.charCodeAt(i) ? 1 : 0
    }
    return false
  }

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

/**
 * Generate a cryptographically secure CSRF token.
 * Can be used to set the initial CSRF cookie.
 */
export function generateCSRFToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Create a Set-Cookie header value for the CSRF token.
 *
 * @param token - The CSRF token to set
 * @param options - Cookie options
 * @returns The Set-Cookie header value
 */
export function createCSRFCookie(
  token: string,
  options: {
    cookieName?: string
    path?: string
    secure?: boolean
    sameSite?: 'Strict' | 'Lax' | 'None'
    maxAge?: number
  } = {}
): string {
  const {
    cookieName = 'csrf',
    path = '/',
    secure = true,
    sameSite = 'Strict',
    maxAge = 86400, // 24 hours
  } = options

  const parts = [
    `${cookieName}=${token}`,
    `Path=${path}`,
    `SameSite=${sameSite}`,
    `Max-Age=${maxAge}`,
  ]

  if (secure) {
    parts.push('Secure')
  }

  // Note: We intentionally do NOT set HttpOnly because JavaScript needs
  // to read the cookie to send the token in the header

  return parts.join('; ')
}

/**
 * CSRF middleware function type for direct use
 */
export type CSRFMiddleware = (
  request: Request,
  env: Record<string, unknown>,
  ctx: ExecutionContext,
  next: () => Promise<Response>
) => Promise<Response>

/**
 * Default CSRF middleware with standard configuration.
 *
 * By default, this middleware:
 * - Protects POST, PUT, PATCH, DELETE methods
 * - Uses 'csrf' as the cookie name
 * - Uses 'X-CSRF-Token' as the header name
 * - Skips requests with API key authentication
 * - Excludes /api/* and /v1/api/* paths (API endpoints use key auth)
 */
export const csrfMiddleware = createCSRFMiddleware({
  excludePaths: [
    '/api/**',     // Legacy API endpoints
    '/v1/api/**',  // Versioned API endpoints
  ],
})
