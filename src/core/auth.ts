/**
 * Authentication Layer for Functions.do
 *
 * Provides API key-based authentication for function invocations.
 */

/**
 * Configuration for the authentication layer
 */
export interface AuthConfig {
  /**
   * Header name to read the API key from
   * @default 'X-API-Key'
   */
  apiKeyHeader?: string

  /**
   * Function to validate an API key
   * Should return true if the key is valid, false otherwise
   */
  validateApiKey: (key: string) => Promise<boolean>

  /**
   * Optional function to extract user ID from a valid API key
   * Called only when the key is valid
   */
  getUserId?: (key: string) => Promise<string | undefined>

  /**
   * List of public endpoints that do not require authentication
   * Supports exact paths (e.g., '/health') and patterns with wildcards (e.g., '/public/*')
   */
  publicEndpoints?: string[]
}

/**
 * Result of an authentication attempt
 */
export interface AuthResult {
  /**
   * Whether the request was successfully authenticated
   */
  authenticated: boolean

  /**
   * User ID associated with the API key (if available)
   */
  userId?: string

  /**
   * Error message if authentication failed
   */
  error?: string
}

/**
 * Check if a path matches a public endpoint pattern
 *
 * @param path - The request path to check
 * @param patterns - List of public endpoint patterns
 * @returns True if the path matches any public pattern
 */
export function isPublicEndpoint(path: string, patterns: string[]): boolean {
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

    // Double wildcard match (e.g., '/api/**' matches '/api/v1/users')
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
 * Authenticate an incoming request using API key authentication
 *
 * @param request - The incoming HTTP request
 * @param config - Authentication configuration
 * @returns Authentication result indicating success or failure
 */
export async function authenticateRequest(
  request: Request,
  config: AuthConfig
): Promise<AuthResult> {
  const headerName = config.apiKeyHeader || 'X-API-Key'
  const apiKey = request.headers.get(headerName)

  if (!apiKey) {
    return { authenticated: false, error: 'Missing API key' }
  }

  const valid = await config.validateApiKey(apiKey)

  if (!valid) {
    return { authenticated: false, error: 'Invalid API key' }
  }

  // Get user ID if the getter is provided
  let userId: string | undefined
  if (config.getUserId) {
    userId = await config.getUserId(apiKey)
  }

  // Only include userId if it's defined (for exactOptionalPropertyTypes)
  if (userId !== undefined) {
    return { authenticated: true, userId }
  }
  return { authenticated: true }
}

/**
 * Create an authentication middleware function
 *
 * @param config - Authentication configuration
 * @returns A function that can be used as middleware
 */
export function createAuthMiddleware(config: AuthConfig): (request: Request) => Promise<AuthResult | null> {
  return async (request: Request): Promise<AuthResult | null> => {
    const url = new URL(request.url)
    const path = url.pathname

    // Check if this is a public endpoint
    if (config.publicEndpoints && isPublicEndpoint(path, config.publicEndpoints)) {
      return null // No auth required
    }

    return authenticateRequest(request, config)
  }
}

/**
 * Default public endpoints that don't require authentication.
 * @deprecated Import PUBLIC_ENDPOINTS from '../config' instead for the canonical list.
 */
export { PUBLIC_ENDPOINTS } from '../config'
import { PUBLIC_ENDPOINTS } from '../config'
export const DEFAULT_PUBLIC_ENDPOINTS: string[] = [...PUBLIC_ENDPOINTS.CORE]
