/**
 * OAuth.do Authentication for E2E Tests
 *
 * This module provides oauth.do integration for authenticated E2E testing.
 * It supports:
 * - Token-based authentication using stored credentials
 * - Machine-to-machine (M2M) authentication for CI/CD
 * - Interactive login for local development
 *
 * Environment variables:
 * - OAUTH_DO_CLIENT_ID: OAuth client ID for M2M auth
 * - OAUTH_DO_CLIENT_SECRET: OAuth client secret for M2M auth
 * - OAUTH_DO_ACCESS_TOKEN: Pre-existing access token (skip auth flow)
 * - OAUTH_DO_REFRESH_TOKEN: Refresh token for token renewal
 * - FUNCTIONS_API_KEY: Fallback to API key auth if no OAuth configured
 */

/**
 * Authentication result from oauth.do
 */
export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  tokenType: 'Bearer'
  scope?: string[]
}

/**
 * OAuth configuration for E2E tests
 */
export interface OAuthConfig {
  /** OAuth client ID */
  clientId?: string
  /** OAuth client secret */
  clientSecret?: string
  /** OAuth authorization server URL */
  authUrl?: string
  /** OAuth token endpoint */
  tokenUrl?: string
  /** OAuth scopes to request */
  scopes?: string[]
  /** Audience for the token */
  audience?: string
}

/**
 * Cached tokens to avoid repeated authentication
 */
let cachedTokens: OAuthTokens | null = null

/**
 * Get OAuth configuration from environment variables
 */
export function getOAuthConfig(): OAuthConfig {
  return {
    clientId: process.env.OAUTH_DO_CLIENT_ID,
    clientSecret: process.env.OAUTH_DO_CLIENT_SECRET,
    authUrl: process.env.OAUTH_DO_AUTH_URL || 'https://oauth.do/oauth/authorize',
    tokenUrl: process.env.OAUTH_DO_TOKEN_URL || 'https://oauth.do/oauth/token',
    scopes: process.env.OAUTH_DO_SCOPES?.split(',') || ['functions:read', 'functions:write', 'functions:deploy'],
    audience: process.env.OAUTH_DO_AUDIENCE || 'https://functions.do',
  }
}

/**
 * Check if OAuth is configured
 */
export function isOAuthConfigured(): boolean {
  // Check for direct access token
  if (process.env.OAUTH_DO_ACCESS_TOKEN) {
    return true
  }

  // Check for M2M credentials
  const config = getOAuthConfig()
  return !!(config.clientId && config.clientSecret)
}

/**
 * Get access token using M2M client credentials flow
 */
async function getM2MToken(config: OAuthConfig): Promise<OAuthTokens> {
  if (!config.clientId || !config.clientSecret) {
    throw new Error('OAuth client credentials not configured')
  }

  const response = await fetch(config.tokenUrl!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: config.scopes?.join(' ') || '',
      audience: config.audience || '',
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OAuth token request failed (${response.status}): ${error}`)
  }

  const data = await response.json() as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type: string
    scope?: string
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: 'Bearer',
    scope: data.scope?.split(' '),
  }
}

/**
 * Refresh an access token using the refresh token
 */
async function refreshAccessToken(config: OAuthConfig, refreshToken: string): Promise<OAuthTokens> {
  const response = await fetch(config.tokenUrl!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId || '',
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OAuth token refresh failed (${response.status}): ${error}`)
  }

  const data = await response.json() as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type: string
    scope?: string
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken, // Keep old refresh token if not returned
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: 'Bearer',
    scope: data.scope?.split(' '),
  }
}

/**
 * Check if tokens are expired or about to expire (within 5 minutes)
 */
function isTokenExpired(tokens: OAuthTokens): boolean {
  if (!tokens.expiresAt) {
    return false // No expiration info, assume valid
  }
  const bufferMs = 5 * 60 * 1000 // 5 minutes buffer
  return Date.now() >= tokens.expiresAt - bufferMs
}

/**
 * Get OAuth tokens for E2E tests
 *
 * This function will:
 * 1. Return cached tokens if still valid
 * 2. Use OAUTH_DO_ACCESS_TOKEN if provided
 * 3. Use M2M client credentials if configured
 * 4. Refresh tokens if expired and refresh token available
 *
 * @returns OAuth tokens or null if OAuth is not configured
 */
export async function getOAuthTokens(): Promise<OAuthTokens | null> {
  // Check for pre-configured access token
  if (process.env.OAUTH_DO_ACCESS_TOKEN) {
    return {
      accessToken: process.env.OAUTH_DO_ACCESS_TOKEN,
      refreshToken: process.env.OAUTH_DO_REFRESH_TOKEN,
      tokenType: 'Bearer',
    }
  }

  // Return cached tokens if valid
  if (cachedTokens && !isTokenExpired(cachedTokens)) {
    return cachedTokens
  }

  const config = getOAuthConfig()

  // Try to refresh if we have a refresh token
  if (cachedTokens?.refreshToken && isTokenExpired(cachedTokens)) {
    try {
      cachedTokens = await refreshAccessToken(config, cachedTokens.refreshToken)
      return cachedTokens
    } catch (error) {
      console.warn('Token refresh failed, attempting fresh authentication:', error)
      cachedTokens = null
    }
  }

  // Try M2M authentication
  if (config.clientId && config.clientSecret) {
    try {
      cachedTokens = await getM2MToken(config)
      return cachedTokens
    } catch (error) {
      console.error('M2M authentication failed:', error)
      throw error
    }
  }

  // No OAuth configured
  return null
}

/**
 * Get authentication headers for E2E requests
 *
 * This function will return appropriate auth headers based on configuration:
 * 1. OAuth Bearer token if OAuth is configured
 * 2. X-API-Key if FUNCTIONS_API_KEY is set
 * 3. Empty headers if no auth configured
 *
 * @returns Headers object with authentication
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  // Try OAuth first
  const tokens = await getOAuthTokens()
  if (tokens) {
    return {
      Authorization: `Bearer ${tokens.accessToken}`,
    }
  }

  // Fall back to API key
  const apiKey = process.env.FUNCTIONS_API_KEY
  if (apiKey) {
    return {
      'X-API-Key': apiKey,
    }
  }

  // No auth configured
  return {}
}

/**
 * Clear cached tokens (useful for testing auth flows)
 */
export function clearTokenCache(): void {
  cachedTokens = null
}

/**
 * Authentication strategy being used
 */
export type AuthStrategy = 'oauth' | 'api-key' | 'none'

/**
 * Get the current authentication strategy
 */
export function getAuthStrategy(): AuthStrategy {
  if (isOAuthConfigured()) {
    return 'oauth'
  }
  if (process.env.FUNCTIONS_API_KEY) {
    return 'api-key'
  }
  return 'none'
}

/**
 * Validate that authentication is working
 *
 * Makes a request to verify the current authentication is valid.
 *
 * @param baseUrl - The base URL for the functions.do API
 * @returns True if authentication is valid, false otherwise
 */
export async function validateAuth(baseUrl: string): Promise<boolean> {
  const headers = await getAuthHeaders()

  try {
    const response = await fetch(`${baseUrl}/api/auth/validate`, {
      method: 'GET',
      headers,
    })

    return response.ok
  } catch {
    return false
  }
}

/**
 * Get user info from the current authentication
 *
 * @param baseUrl - The base URL for the functions.do API
 * @returns User info or null if not authenticated
 */
export async function getUserInfo(baseUrl: string): Promise<{
  id: string
  email?: string
  name?: string
  scopes?: string[]
} | null> {
  const headers = await getAuthHeaders()

  try {
    const response = await fetch(`${baseUrl}/api/auth/me`, {
      method: 'GET',
      headers,
    })

    if (!response.ok) {
      return null
    }

    return response.json()
  } catch {
    return null
  }
}
