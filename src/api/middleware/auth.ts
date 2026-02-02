/**
 * Auth Middleware for Functions.do
 *
 * Provides API key-based and OAuth-based authentication for protected endpoints.
 * Supports:
 * - API key authentication via X-API-Key header or Bearer token
 * - OAuth token authentication via oauth.do service binding
 * - Organization context via X-Organization header
 */

import { jsonResponse } from '../http-utils'
import {
  OAuthClient,
  extractBearerToken,
  type OAuthService,
  type OAuthContext,
  type OrganizationMembership,
} from '../../core/oauth'
import { hashApiKey } from '../../core/crypto-utils'

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
 *
 * Note: The full API key is NOT stored to prevent exposure if this object
 * is logged or serialized. Instead, we store:
 * - keyHash: SHA-256 hash for unique identification/correlation
 * - keyHint: Masked hint showing only last 4 characters (e.g., "****abcd")
 */
export interface AuthContext {
  userId: string
  keyHash: string
  keyHint: string
  scopes: string[]
  authenticatedAt: number
  isInternal?: boolean
  /** Authentication method used */
  authMethod?: 'api-key' | 'oauth'
  /** User email (from OAuth) */
  email?: string
  /** User name (from OAuth) */
  name?: string
  /** User's organizations (from OAuth) */
  organizations?: OrganizationMembership[]
  /** Current organization context */
  currentOrgId?: string
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
  /** OAuth.do service binding for token validation */
  oauthService?: OAuthService
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
 * Create a safe hint from an API key showing only the last 4 characters
 * Example: "sk_live_abc123xyz" -> "****3xyz"
 */
function createKeyHint(apiKey: string): string {
  if (apiKey.length <= 4) {
    return '****'
  }
  return '****' + apiKey.slice(-4)
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
 * Check if a token looks like an API key (vs OAuth token).
 * API keys typically have specific prefixes.
 */
function isApiKeyFormat(token: string): boolean {
  const apiKeyPrefixes = ['sk_', 'pk_', 'fn_', 'api_', 'key_']
  return apiKeyPrefixes.some((prefix) => token.startsWith(prefix))
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
    oauthService,
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
            keyHash: 'internal',
            keyHint: 'internal',
            scopes: ['*'],
            authenticatedAt: Date.now(),
            isInternal: true,
            authMethod: 'api-key',
          },
        }
      }
    }

    // Get KV namespace and OAuth service from config or env
    const kv = apiKeysKV || (env['FUNCTIONS_API_KEYS'] as KVNamespace | undefined)
    const oauth = oauthService || (env['OAUTH'] as OAuthService | undefined)

    // SECURITY: Default-deny when no auth backend is configured.
    // If neither API_KEYS KV nor OAuth service is available, deny the request.
    // This prevents a critical vulnerability where unconfigured auth silently
    // allows all requests through.
    if (!kv && !oauth) {
      console.warn(
        'Auth middleware: no auth backend configured (neither API_KEYS KV nor OAuth service). ' +
        'Denying request to', path, '- configure FUNCTIONS_API_KEYS or OAUTH to enable authentication.'
      )
      return {
        shouldContinue: false,
        response: jsonResponse(
          { error: 'Authentication not configured. Please contact the service administrator.' },
          401,
          { 'WWW-Authenticate': 'Bearer realm="Functions.do"' }
        ),
      }
    }

    // Extract credentials
    const xApiKey = request.headers.get(apiKeyHeader)
    const authHeader = request.headers.get('Authorization')
    const bearerToken = extractBearerToken(authHeader)
    const orgHeader = request.headers.get('X-Organization')

    // No credentials provided
    if (!xApiKey && !bearerToken) {
      return {
        shouldContinue: false,
        response: jsonResponse(
          { error: 'Missing authentication' },
          401,
          { 'WWW-Authenticate': 'Bearer realm="Functions.do"' }
        ),
      }
    }

    // Priority 1: X-API-Key header (always API key auth)
    if (xApiKey && kv) {
      return await validateApiKey(xApiKey, kv, request, scopeRequirements)
    }

    // Priority 2: Bearer token
    if (bearerToken) {
      // Check if this looks like an API key
      if (isApiKeyFormat(bearerToken) && kv) {
        return await validateApiKey(bearerToken, kv, request, scopeRequirements)
      }

      // Try OAuth validation if service is available
      if (oauth) {
        const oauthResult = await validateOAuthToken(
          bearerToken,
          oauth,
          orgHeader,
          request,
          scopeRequirements
        )
        if (oauthResult.shouldContinue || !oauthResult.error?.includes('OAuth')) {
          return oauthResult
        }
        // OAuth failed, try API key fallback
      }

      // Fall back to API key lookup for Bearer token
      if (kv) {
        const apiKeyResult = await validateApiKey(bearerToken, kv, request, scopeRequirements)
        // Only return API key result if it was successful or definitively failed
        if (apiKeyResult.shouldContinue || apiKeyResult.response?.status === 403) {
          return apiKeyResult
        }
      }

      // If OAuth is available but failed, return OAuth error
      if (oauth) {
        return {
          shouldContinue: false,
          response: jsonResponse(
            { error: 'Invalid or expired token' },
            401,
            { 'WWW-Authenticate': 'Bearer realm="Functions.do"' }
          ),
        }
      }
    }

    // No valid authentication
    return {
      shouldContinue: false,
      response: jsonResponse(
        { error: 'Invalid authentication' },
        401,
        { 'WWW-Authenticate': 'Bearer realm="Functions.do"' }
      ),
    }
  }
}

/**
 * Validate an API key against KV storage.
 */
async function validateApiKey(
  apiKey: string,
  kv: KVNamespace,
  request: Request,
  scopeRequirements?: Record<string, string[]>
): Promise<AuthMiddlewareResult> {
  const keyHash = await hashApiKey(apiKey)
  const record = await kv.get<ApiKeyRecord>(`keys:${keyHash}`, 'json')
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

  // Build auth context with hashed/hinted key (never store full key)
  const authContext: AuthContext = {
    userId: record.userId || 'anonymous',
    keyHash,
    keyHint: createKeyHint(apiKey),
    scopes: record.scopes || [],
    authenticatedAt: Date.now(),
    authMethod: 'api-key',
  }

  // Check scope requirements
  if (!hasRequiredScopes(request, authContext.scopes, scopeRequirements)) {
    return {
      shouldContinue: false,
      response: jsonResponse({ error: 'Insufficient permissions' }, 403),
    }
  }

  return { shouldContinue: true, authContext }
}

/**
 * Validate an OAuth token via the oauth.do service binding.
 */
async function validateOAuthToken(
  token: string,
  oauthService: OAuthService,
  orgHeader: string | null,
  request: Request,
  scopeRequirements?: Record<string, string[]>
): Promise<AuthMiddlewareResult> {
  const oauthClient = new OAuthClient(oauthService)

  try {
    const context = await oauthClient.buildContext(token, orgHeader)
    if (!context) {
      return {
        shouldContinue: false,
        error: 'OAuth token validation failed',
        response: jsonResponse(
          { error: 'Invalid or expired token' },
          401,
          { 'WWW-Authenticate': 'Bearer realm="Functions.do"' }
        ),
      }
    }

    // Build auth context from OAuth context
    const authContext: AuthContext = {
      userId: context.userId,
      keyHash: await hashApiKey(token), // Hash the token for correlation
      keyHint: context.tokenHint,
      scopes: context.scopes,
      authenticatedAt: Date.now(),
      authMethod: 'oauth',
      email: context.email,
      name: context.name,
      organizations: context.organizations,
      currentOrgId: context.currentOrg?.id,
    }

    // Check scope requirements
    if (!hasRequiredScopes(request, authContext.scopes, scopeRequirements)) {
      return {
        shouldContinue: false,
        response: jsonResponse({ error: 'Insufficient permissions' }, 403),
      }
    }

    return { shouldContinue: true, authContext }
  } catch (error) {
    console.error('OAuth validation error:', error)
    return {
      shouldContinue: false,
      error: 'OAuth service error',
      response: jsonResponse(
        { error: 'Authentication service unavailable' },
        503
      ),
    }
  }
}

/**
 * Default auth middleware with standard configuration
 */
export const authMiddleware = createAuthMiddleware({
  publicEndpoints: [
    '/health',
    '/',
    '/api/status',
    '/v1/api/auth/validate', // Auth validation should be accessible
    '/api/auth/validate',
  ],
})
