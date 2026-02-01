/**
 * Auth Middleware for Functions.do
 *
 * Provides API key-based authentication for protected endpoints.
 */

/**
 * API key record stored in KV
 */
export interface ApiKeyRecord {
  userId?: string
  active: boolean
  scopes?: string[]
  expiresAt?: string
}

/**
 * Auth context attached to authenticated requests
 */
export interface AuthContext {
  userId: string
  apiKey: string
  scopes: string[]
  authenticatedAt: number
  isInternal?: boolean
}

/**
 * Configuration for auth middleware
 */
export interface AuthMiddlewareConfig {
  publicEndpoints?: string[]
  apiKeysKV?: KVNamespace
  apiKeyHeader?: string
  scopeRequirements?: Record<string, string[]>
  trustInternalRequests?: boolean
  internalHeader?: string
  internalSecret?: string
}

/**
 * Result of auth middleware execution
 */
export interface AuthMiddlewareResult {
  shouldContinue: boolean
  response?: Response
  authContext?: AuthContext
  error?: string
}

/**
 * JSON response helper
 */
function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/**
 * Check if a path matches a public endpoint pattern
 */
function isPublicPath(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Exact match
    if (pattern === path) {
      return true
    }

    // Wildcard match (e.g., '/public/*' matches '/public/anything')
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1) // Remove the '*'
      if (path.startsWith(prefix) || path === prefix.slice(0, -1)) {
        return true
      }
    }

    // Double wildcard match (e.g., '/docs/**' matches '/docs/api/reference')
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
 * Extract API key from request
 */
function extractApiKey(request: Request, headerName: string): string | null {
  // Try custom header first (or X-API-Key by default)
  const customHeader = request.headers.get(headerName)
  if (customHeader) {
    return customHeader
  }

  // Try X-API-Key if not the default
  if (headerName !== 'X-API-Key') {
    const xApiKey = request.headers.get('X-API-Key')
    if (xApiKey) {
      return xApiKey
    }
  }

  // Try Authorization Bearer
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }

  return null
}

/**
 * Check if request has required scopes for the endpoint
 */
function hasRequiredScopes(
  request: Request,
  userScopes: string[],
  scopeRequirements?: Record<string, string[]>
): boolean {
  if (!scopeRequirements) {
    return true
  }

  const url = new URL(request.url)
  const method = request.method.toUpperCase()

  for (const [pattern, requiredScopes] of Object.entries(scopeRequirements)) {
    const [requiredMethod, ...pathParts] = pattern.split(' ')
    const requiredPath = pathParts.join(' ')

    if (requiredMethod !== method) {
      continue
    }

    // Check if path matches pattern
    let matches = false
    if (requiredPath.endsWith('/*')) {
      const prefix = requiredPath.slice(0, -2)
      matches = url.pathname.startsWith(prefix)
    } else if (requiredPath === url.pathname) {
      matches = true
    }

    if (matches) {
      // Check if user has all required scopes
      const hasAllScopes = requiredScopes.every(scope => userScopes.includes(scope))
      if (!hasAllScopes) {
        return false
      }
    }
  }

  return true
}

/**
 * Create auth middleware with custom configuration
 */
export function createAuthMiddleware(config: AuthMiddlewareConfig) {
  const {
    publicEndpoints = ['/health', '/'],
    apiKeysKV,
    apiKeyHeader = 'X-API-Key',
    scopeRequirements,
    trustInternalRequests = false,
    internalHeader,
    internalSecret,
  } = config

  return async (
    request: Request,
    env: Record<string, unknown>,
    ctx: ExecutionContext
  ): Promise<AuthMiddlewareResult> => {
    const url = new URL(request.url)
    const path = url.pathname

    // Check if public endpoint
    if (isPublicPath(path, publicEndpoints)) {
      return { shouldContinue: true }
    }

    // Check for internal request bypass
    if (trustInternalRequests && internalHeader && internalSecret) {
      const internalValue = request.headers.get(internalHeader)
      if (internalValue === internalSecret) {
        return {
          shouldContinue: true,
          authContext: {
            userId: 'internal',
            apiKey: 'internal',
            scopes: ['*'],
            authenticatedAt: Date.now(),
            isInternal: true,
          },
        }
      }
    }

    // Get KV namespace from config or env
    const kv = apiKeysKV || (env.FUNCTIONS_API_KEYS as KVNamespace | undefined)

    if (!kv) {
      // No KV namespace - auth is disabled
      return { shouldContinue: true }
    }

    // Extract API key
    const apiKey = extractApiKey(request, apiKeyHeader)
    if (!apiKey) {
      return {
        shouldContinue: false,
        response: jsonResponse(
          { error: 'Missing API key' },
          401,
          { 'WWW-Authenticate': 'Bearer realm="Functions.do"' }
        ),
      }
    }

    // Validate API key
    const record = await kv.get<ApiKeyRecord>(apiKey, 'json')
    if (!record) {
      return {
        shouldContinue: false,
        response: jsonResponse(
          { error: 'Invalid API key' },
          401,
          { 'WWW-Authenticate': 'Bearer realm="Functions.do"' }
        ),
      }
    }

    // Check if active
    if (!record.active) {
      return {
        shouldContinue: false,
        response: jsonResponse(
          { error: 'API key is inactive' },
          401,
          { 'WWW-Authenticate': 'Bearer realm="Functions.do"' }
        ),
      }
    }

    // Check expiration
    if (record.expiresAt) {
      const expiresAt = new Date(record.expiresAt)
      if (expiresAt < new Date()) {
        return {
          shouldContinue: false,
          response: jsonResponse(
            { error: 'API key has expired' },
            401,
            { 'WWW-Authenticate': 'Bearer realm="Functions.do"' }
          ),
        }
      }
    }

    // Build auth context
    const authContext: AuthContext = {
      userId: record.userId || 'anonymous',
      apiKey,
      scopes: record.scopes || [],
      authenticatedAt: Date.now(),
    }

    // Check scope requirements
    if (!hasRequiredScopes(request, authContext.scopes, scopeRequirements)) {
      return {
        shouldContinue: false,
        response: jsonResponse(
          { error: 'Insufficient permissions' },
          403
        ),
      }
    }

    return { shouldContinue: true, authContext }
  }
}

/**
 * Default auth middleware with standard configuration
 */
export const authMiddleware = createAuthMiddleware({
  publicEndpoints: ['/health', '/', '/api/status'],
})
