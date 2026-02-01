/**
 * Auth Handlers for Functions.do
 *
 * Provides OAuth.do integration endpoints for authentication, user info,
 * and organization management.
 *
 * @module handlers/auth
 */

import type { RouteContext, Env, Handler } from '../router'
import { jsonResponse } from '../http-utils'
import {
  OAuthClient,
  extractBearerToken,
  type OAuthContext,
  type OAuthService,
} from '../../core/oauth'

/**
 * Extract API key from request headers.
 */
function extractApiKey(request: Request): string | null {
  // Try X-API-Key header
  const xApiKey = request.headers.get('X-API-Key')
  if (xApiKey) {
    return xApiKey
  }

  // Try Authorization header (for API keys passed as Bearer)
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }

  return null
}

/**
 * Check if this looks like an API key (vs OAuth token).
 * API keys typically start with prefixes like "sk_", "pk_", "fn_", etc.
 */
function isApiKey(token: string): boolean {
  // Common API key prefixes
  const apiKeyPrefixes = ['sk_', 'pk_', 'fn_', 'api_', 'key_']
  return apiKeyPrefixes.some((prefix) => token.startsWith(prefix))
}

/**
 * Build OAuth context from request.
 *
 * Tries OAuth service first, then falls back to API key lookup.
 */
async function buildAuthContext(
  request: Request,
  env: Env
): Promise<{ context: OAuthContext | null; error?: string; status?: number }> {
  const authHeader = request.headers.get('Authorization')
  const xApiKey = request.headers.get('X-API-Key')
  const orgHeader = request.headers.get('X-Organization')

  // Priority 1: X-API-Key header (always API key auth)
  if (xApiKey) {
    if (!env.FUNCTIONS_API_KEYS) {
      return { context: null, error: 'API key authentication not configured', status: 501 }
    }

    const record = await env.FUNCTIONS_API_KEYS.get<{
      userId?: string
      active: boolean
      scopes?: string[]
    }>(xApiKey, 'json')

    if (!record || !record.active) {
      return { context: null, error: 'Invalid or inactive API key', status: 401 }
    }

    return {
      context: {
        userId: record.userId || 'api-key-user',
        scopes: record.scopes || [],
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, // API keys don't expire by default
        tokenHint: '****' + xApiKey.slice(-4),
        isApiKey: true,
      },
    }
  }

  // Priority 2: Bearer token
  const token = extractBearerToken(authHeader)
  if (!token) {
    return { context: null, error: 'Missing authentication', status: 401 }
  }

  // Check if this is an API key passed as Bearer token
  if (isApiKey(token)) {
    if (!env.FUNCTIONS_API_KEYS) {
      return { context: null, error: 'API key authentication not configured', status: 501 }
    }

    const record = await env.FUNCTIONS_API_KEYS.get<{
      userId?: string
      active: boolean
      scopes?: string[]
    }>(token, 'json')

    if (!record || !record.active) {
      return { context: null, error: 'Invalid or inactive API key', status: 401 }
    }

    return {
      context: {
        userId: record.userId || 'api-key-user',
        scopes: record.scopes || [],
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        tokenHint: '****' + token.slice(-4),
        isApiKey: true,
      },
    }
  }

  // Priority 3: OAuth token via oauth.do service
  if (!env.OAUTH) {
    // If no OAuth service and not an API key, check if we can fall back to API key lookup
    if (env.FUNCTIONS_API_KEYS) {
      const record = await env.FUNCTIONS_API_KEYS.get<{
        userId?: string
        active: boolean
        scopes?: string[]
      }>(token, 'json')

      if (record?.active) {
        return {
          context: {
            userId: record.userId || 'api-key-user',
            scopes: record.scopes || [],
            expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
            tokenHint: '****' + token.slice(-4),
            isApiKey: true,
          },
        }
      }
    }

    return { context: null, error: 'OAuth service not configured', status: 501 }
  }

  // Use OAuth service
  const oauthClient = new OAuthClient(env.OAUTH as unknown as OAuthService)
  const context = await oauthClient.buildContext(token, orgHeader)

  if (!context) {
    return { context: null, error: 'Invalid or expired token', status: 401 }
  }

  return { context }
}

/**
 * Validate authentication handler.
 *
 * Returns whether the current authentication is valid.
 *
 * GET /api/auth/validate
 *
 * Response:
 * - 200: { valid: true, userId: string, scopes: string[] }
 * - 401: { valid: false, error: string }
 */
export const authValidateHandler: Handler = async (
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  _context?: RouteContext
): Promise<Response> => {
  const { context, error, status } = await buildAuthContext(request, env)

  if (!context) {
    return jsonResponse(
      {
        valid: false,
        error: error || 'Authentication failed',
      },
      status || 401
    )
  }

  return jsonResponse({
    valid: true,
    userId: context.userId,
    scopes: context.scopes,
    expiresAt: new Date(context.expiresAt).toISOString(),
    authMethod: context.isApiKey ? 'api-key' : 'oauth',
    ...(context.currentOrg && {
      organization: {
        id: context.currentOrg.id,
        name: context.currentOrg.name,
        slug: context.currentOrg.slug,
      },
    }),
  })
}

/**
 * Get current user info handler.
 *
 * Returns detailed information about the authenticated user.
 *
 * GET /api/auth/me
 *
 * Response:
 * - 200: { id: string, email?: string, name?: string, organizations?: Organization[] }
 * - 401: { error: string }
 */
export const authMeHandler: Handler = async (
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  _context?: RouteContext
): Promise<Response> => {
  const { context, error, status } = await buildAuthContext(request, env)

  if (!context) {
    return jsonResponse({ error: error || 'Authentication failed' }, status || 401)
  }

  // For API key auth, we have limited info
  if (context.isApiKey) {
    return jsonResponse({
      id: context.userId,
      authMethod: 'api-key',
      scopes: context.scopes,
    })
  }

  // For OAuth, try to get full user info
  const token = extractBearerToken(request.headers.get('Authorization'))
  if (!token || !env.OAUTH) {
    return jsonResponse({
      id: context.userId,
      email: context.email,
      name: context.name,
      authMethod: 'oauth',
      scopes: context.scopes,
      organizations: context.organizations?.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
    })
  }

  // Get detailed user info from OAuth service
  const oauthClient = new OAuthClient(env.OAUTH as unknown as OAuthService)
  const userInfo = await oauthClient.getUserInfo(token)

  if (!userInfo) {
    return jsonResponse({
      id: context.userId,
      email: context.email,
      name: context.name,
      authMethod: 'oauth',
      scopes: context.scopes,
    })
  }

  return jsonResponse({
    id: userInfo.id,
    email: userInfo.email,
    name: userInfo.name,
    picture: userInfo.picture,
    emailVerified: userInfo.emailVerified,
    authMethod: 'oauth',
    scopes: context.scopes,
    organizations: userInfo.organizations?.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role,
      joinedAt: m.joinedAt,
    })),
    metadata: userInfo.metadata,
  })
}

/**
 * Get user's organizations handler.
 *
 * Returns the list of organizations the user belongs to.
 *
 * GET /api/auth/orgs
 *
 * Response:
 * - 200: { organizations: Organization[] }
 * - 401: { error: string }
 */
export const authOrgsHandler: Handler = async (
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  _context?: RouteContext
): Promise<Response> => {
  const { context, error, status } = await buildAuthContext(request, env)

  if (!context) {
    return jsonResponse({ error: error || 'Authentication failed' }, status || 401)
  }

  // API key auth doesn't have org info
  if (context.isApiKey) {
    return jsonResponse({
      organizations: [],
      message: 'API key authentication does not have organization context',
    })
  }

  // Return organizations from context
  if (context.organizations && context.organizations.length > 0) {
    return jsonResponse({
      organizations: context.organizations.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        logo: m.organization.logo,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
      currentOrg: context.currentOrg
        ? {
            id: context.currentOrg.id,
            name: context.currentOrg.name,
            slug: context.currentOrg.slug,
          }
        : undefined,
    })
  }

  // Try to fetch from OAuth service
  const token = extractBearerToken(request.headers.get('Authorization'))
  if (!token || !env.OAUTH) {
    return jsonResponse({ organizations: [] })
  }

  const oauthClient = new OAuthClient(env.OAUTH as unknown as OAuthService)
  const orgs = await oauthClient.getOrganizations(token)

  if (!orgs) {
    return jsonResponse({ organizations: [] })
  }

  return jsonResponse({
    organizations: orgs.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      logo: org.logo,
    })),
  })
}
