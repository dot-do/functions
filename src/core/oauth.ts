/**
 * OAuth.do Service Integration for Functions.do
 *
 * Provides OAuth 2.0 authentication using the oauth.do service binding.
 * Supports:
 * - Token validation and introspection
 * - User/session information retrieval
 * - Function-level permissions (scopes)
 * - Team/organization support
 *
 * @module core/oauth
 */

// Re-export FunctionPermissions from types for convenience
export { type FunctionPermissions } from './types'

import { createLogger } from './logger'

const logger = createLogger({ context: { component: 'oauth' } })

/**
 * OAuth.do service binding interface.
 * This defines the RPC methods available on the oauth.do service.
 */
export interface OAuthService {
  /**
   * Validate an access token and return token info.
   * Returns null if the token is invalid or expired.
   */
  validateToken(token: string): Promise<TokenInfo | null>

  /**
   * Get user information from a valid access token.
   * Returns null if the token is invalid.
   */
  getUserInfo(token: string): Promise<UserInfo | null>

  /**
   * Check if a token has specific scopes.
   * Returns an object with a boolean for each requested scope.
   */
  checkScopes(token: string, scopes: string[]): Promise<Record<string, boolean>>

  /**
   * Get organization/team memberships for a user.
   * Returns null if the token is invalid.
   */
  getOrganizations(token: string): Promise<Organization[] | null>

  /**
   * Check if a user has permission to access a specific resource.
   * Used for function-level permissions.
   */
  checkPermission(
    token: string,
    resource: string,
    action: string
  ): Promise<PermissionResult>

  /**
   * Introspect a token (RFC 7662 style).
   * Returns full token metadata.
   */
  introspect(token: string): Promise<TokenIntrospection | null>
}

/**
 * Token information returned from validation.
 */
export interface TokenInfo {
  /** Whether the token is active/valid */
  active: boolean
  /** Token subject (user ID) */
  sub: string
  /** Client ID that issued the token */
  clientId: string
  /** Token scopes */
  scopes: string[]
  /** Token expiration timestamp (Unix seconds) */
  exp: number
  /** Token issued-at timestamp (Unix seconds) */
  iat: number
  /** Token audience */
  aud?: string | string[]
  /** Token issuer */
  iss?: string
}

/**
 * User information from OAuth token.
 */
export interface UserInfo {
  /** Unique user identifier */
  id: string
  /** User email address */
  email?: string
  /** User display name */
  name?: string
  /** User avatar URL */
  picture?: string
  /** Whether email is verified */
  emailVerified?: boolean
  /** User's organizations */
  organizations?: OrganizationMembership[]
  /** User metadata */
  metadata?: Record<string, unknown>
}

/**
 * Organization information.
 */
export interface Organization {
  /** Organization ID */
  id: string
  /** Organization name */
  name: string
  /** Organization slug (URL-friendly name) */
  slug: string
  /** Organization logo URL */
  logo?: string
  /** Organization creation timestamp */
  createdAt?: string
}

/**
 * User's membership in an organization.
 */
export interface OrganizationMembership {
  /** Organization info */
  organization: Organization
  /** User's role in the organization */
  role: 'owner' | 'admin' | 'member' | 'viewer'
  /** When the user joined */
  joinedAt: string
}

/**
 * Result of a permission check.
 */
export interface PermissionResult {
  /** Whether the permission is granted */
  allowed: boolean
  /** Reason for the decision */
  reason?: string
  /** The role or scope that granted/denied access */
  grantedBy?: string
}

/**
 * Full token introspection response (RFC 7662).
 */
export interface TokenIntrospection {
  /** Whether the token is active */
  active: boolean
  /** Token scopes (space-separated) */
  scope?: string
  /** Client identifier */
  client_id?: string
  /** Token username */
  username?: string
  /** Token type (e.g., "Bearer") */
  token_type?: string
  /** Token expiration time (Unix timestamp) */
  exp?: number
  /** Token issued-at time (Unix timestamp) */
  iat?: number
  /** Token not-before time (Unix timestamp) */
  nbf?: number
  /** Token subject (user ID) */
  sub?: string
  /** Token audience */
  aud?: string | string[]
  /** Token issuer */
  iss?: string
  /** Token unique identifier */
  jti?: string
}

/**
 * OAuth authentication context attached to requests.
 */
export interface OAuthContext {
  /** User ID from the token */
  userId: string
  /** User email (if available) */
  email?: string
  /** User display name (if available) */
  name?: string
  /** Token scopes */
  scopes: string[]
  /** Token expiration timestamp */
  expiresAt: number
  /** Organizations the user belongs to */
  organizations?: OrganizationMembership[]
  /** Current organization context (from X-Organization header or default) */
  currentOrg?: Organization
  /** Whether this is an API key auth (not OAuth) */
  isApiKey?: boolean
  /** Token hint for logging (last 4 chars) */
  tokenHint: string
}

// FunctionPermissions is re-exported from ./types above

/**
 * OAuth client for interacting with oauth.do service binding.
 */
export class OAuthClient {
  private service: OAuthService | null

  constructor(service?: OAuthService) {
    this.service = service || null
  }

  /**
   * Check if OAuth service is available.
   */
  isAvailable(): boolean {
    return this.service !== null
  }

  /**
   * Validate an access token.
   *
   * @param token - The Bearer token to validate
   * @returns Token info if valid, null otherwise
   */
  async validateToken(token: string): Promise<TokenInfo | null> {
    if (!this.service) {
      return null
    }

    try {
      return await this.service.validateToken(token)
    } catch (error) {
      logger.error('OAuth token validation error', { error: error instanceof Error ? error : new Error(String(error)) })
      return null
    }
  }

  /**
   * Get user information from a token.
   *
   * @param token - The Bearer token
   * @returns User info if token is valid, null otherwise
   */
  async getUserInfo(token: string): Promise<UserInfo | null> {
    if (!this.service) {
      return null
    }

    try {
      return await this.service.getUserInfo(token)
    } catch (error) {
      logger.error('OAuth get user info error', { error: error instanceof Error ? error : new Error(String(error)) })
      return null
    }
  }

  /**
   * Check if a token has required scopes.
   *
   * @param token - The Bearer token
   * @param requiredScopes - Scopes that must all be present
   * @returns True if all scopes are present, false otherwise
   */
  async hasScopes(token: string, requiredScopes: string[]): Promise<boolean> {
    if (!this.service || requiredScopes.length === 0) {
      return true
    }

    try {
      const scopeResults = await this.service.checkScopes(token, requiredScopes)
      return requiredScopes.every((scope) => scopeResults[scope] === true)
    } catch (error) {
      logger.error('OAuth scope check error', { error: error instanceof Error ? error : new Error(String(error)) })
      return false
    }
  }

  /**
   * Get organizations for a user.
   *
   * @param token - The Bearer token
   * @returns List of organizations or null if invalid token
   */
  async getOrganizations(token: string): Promise<Organization[] | null> {
    if (!this.service) {
      return null
    }

    try {
      return await this.service.getOrganizations(token)
    } catch (error) {
      logger.error('OAuth get organizations error', { error: error instanceof Error ? error : new Error(String(error)) })
      return null
    }
  }

  /**
   * Check if a user has permission to perform an action on a resource.
   *
   * @param token - The Bearer token
   * @param resource - Resource identifier (e.g., "function:my-function")
   * @param action - Action to perform (e.g., "invoke", "deploy", "delete")
   * @returns Permission result
   */
  async checkPermission(
    token: string,
    resource: string,
    action: string
  ): Promise<PermissionResult> {
    if (!this.service) {
      // If OAuth is not available, default to allow (rely on API key auth)
      return { allowed: true, reason: 'OAuth not configured' }
    }

    try {
      return await this.service.checkPermission(token, resource, action)
    } catch (error) {
      logger.error('OAuth permission check error', { error: error instanceof Error ? error : new Error(String(error)) })
      return { allowed: false, reason: 'Permission check failed' }
    }
  }

  /**
   * Build an OAuth context from a valid token.
   *
   * @param token - The Bearer token
   * @param orgHeader - Optional X-Organization header value
   * @returns OAuth context or null if token is invalid
   */
  async buildContext(
    token: string,
    orgHeader?: string | null
  ): Promise<OAuthContext | null> {
    const tokenInfo = await this.validateToken(token)
    if (!tokenInfo || !tokenInfo.active) {
      return null
    }

    const userInfo = await this.getUserInfo(token)

    // Build base context
    const context: OAuthContext = {
      userId: tokenInfo.sub,
      email: userInfo?.email,
      name: userInfo?.name,
      scopes: tokenInfo.scopes,
      expiresAt: tokenInfo.exp * 1000, // Convert to milliseconds
      tokenHint: '****' + token.slice(-4),
    }

    // Add organization info if available
    if (userInfo?.organizations && userInfo.organizations.length > 0) {
      context.organizations = userInfo.organizations

      // Set current org from header or default to first
      if (orgHeader) {
        const matchedOrg = userInfo.organizations.find(
          (m) => m.organization.id === orgHeader || m.organization.slug === orgHeader
        )
        if (matchedOrg) {
          context.currentOrg = matchedOrg.organization
        }
      } else {
        // Default to first organization
        context.currentOrg = userInfo.organizations[0]?.organization
      }
    }

    return context
  }
}

/**
 * Check if a user has permission to access a function.
 *
 * @param context - OAuth context from authentication
 * @param permissions - Function's permission configuration
 * @returns Permission result
 */
export function checkFunctionPermission(
  context: OAuthContext | null,
  permissions: FunctionPermissions | undefined
): PermissionResult {
  // If no permissions defined, default to requiring authentication
  if (!permissions) {
    if (!context) {
      return { allowed: false, reason: 'Authentication required' }
    }
    return { allowed: true, reason: 'No specific permissions required' }
  }

  // Public functions allow anonymous access
  if (permissions.public) {
    return { allowed: true, reason: 'Public function' }
  }

  // All other checks require authentication
  if (!context) {
    return { allowed: false, reason: 'Authentication required' }
  }

  // Check required scopes
  if (permissions.requiredScopes && permissions.requiredScopes.length > 0) {
    const hasAllScopes = permissions.requiredScopes.every((scope) =>
      context.scopes.includes(scope)
    )
    if (!hasAllScopes) {
      return {
        allowed: false,
        reason: `Missing required scopes: ${permissions.requiredScopes.join(', ')}`,
      }
    }
  }

  // Check allowed users
  if (permissions.allowedUsers && permissions.allowedUsers.length > 0) {
    if (permissions.allowedUsers.includes(context.userId)) {
      return { allowed: true, reason: 'User is in allowed list', grantedBy: 'user' }
    }
  }

  // Check allowed organizations
  if (permissions.allowedOrgs && permissions.allowedOrgs.length > 0) {
    const userOrgIds = context.organizations?.map((m) => m.organization.id) || []
    const matchedOrg = permissions.allowedOrgs.find((orgId) => userOrgIds.includes(orgId))
    if (matchedOrg) {
      // Check role if specified
      if (permissions.allowedRoles && permissions.allowedRoles.length > 0) {
        const membership = context.organizations?.find(
          (m) => m.organization.id === matchedOrg
        )
        if (membership && permissions.allowedRoles.includes(membership.role)) {
          return {
            allowed: true,
            reason: `Organization member with role: ${membership.role}`,
            grantedBy: 'org-role',
          }
        }
        return {
          allowed: false,
          reason: `Required role: ${permissions.allowedRoles.join(' or ')}`,
        }
      }
      return { allowed: true, reason: 'Organization is in allowed list', grantedBy: 'org' }
    }
  }

  // If specific users or orgs are configured but none matched, deny
  if (
    (permissions.allowedUsers && permissions.allowedUsers.length > 0) ||
    (permissions.allowedOrgs && permissions.allowedOrgs.length > 0)
  ) {
    return { allowed: false, reason: 'User not in allowed list' }
  }

  // Default: authenticated users are allowed
  return { allowed: true, reason: 'Authenticated user' }
}

/**
 * Extract Bearer token from Authorization header.
 *
 * @param authHeader - The Authorization header value
 * @returns The token or null if not a Bearer token
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null
  }

  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') {
    return null
  }

  return parts[1] || null
}

/**
 * Standard OAuth scopes for functions.do
 */
export const FUNCTION_SCOPES = {
  /** Read function metadata and logs */
  READ: 'functions:read',
  /** Deploy and update functions */
  WRITE: 'functions:write',
  /** Invoke functions */
  INVOKE: 'functions:invoke',
  /** Delete functions */
  DELETE: 'functions:delete',
  /** Manage function permissions */
  ADMIN: 'functions:admin',
  /** Full access */
  ALL: 'functions:*',
} as const

/**
 * Check if scopes include a specific permission.
 *
 * @param scopes - User's scopes
 * @param required - Required scope
 * @returns True if scope is granted
 */
export function hasScope(scopes: string[], required: string): boolean {
  // Check for exact match
  if (scopes.includes(required)) {
    return true
  }

  // Check for wildcard (functions:*)
  if (scopes.includes(FUNCTION_SCOPES.ALL)) {
    return true
  }

  // Check for namespace wildcard (e.g., "functions:*" matches "functions:read")
  const namespace = required.split(':')[0]
  if (namespace && scopes.includes(`${namespace}:*`)) {
    return true
  }

  return false
}
