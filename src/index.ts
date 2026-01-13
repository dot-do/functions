/**
 * Functions.do - Multi-language serverless platform
 *
 * Main entry point for the Cloudflare Worker
 */

import { FunctionLoader, type Registry, type CodeStorage } from './core/function-loader'
import { FunctionTarget } from './core/function-target'
import type { FunctionMetadata } from './core/types'
import { validateFunctionId } from './core/function-registry'
import {
  authenticateRequest,
  isPublicEndpoint,
  DEFAULT_PUBLIC_ENDPOINTS,
  type AuthConfig,
  type AuthResult,
} from './core/auth'
import {
  CompositeRateLimiter,
  InMemoryRateLimiter,
  createDefaultRateLimiter,
  getClientIP,
  createRateLimitResponse,
  type RateLimitConfig,
} from './core/rate-limiter'

// Global rate limiter instance (persists across requests in the same worker)
let rateLimiter: CompositeRateLimiter | null = null

/**
 * Get or create the global rate limiter instance
 */
function getRateLimiter(): CompositeRateLimiter {
  if (!rateLimiter) {
    rateLimiter = createDefaultRateLimiter()
  }
  return rateLimiter
}

/**
 * Reset the rate limiter (useful for testing)
 */
export function resetRateLimiter(): void {
  rateLimiter = null
}

/**
 * Configure custom rate limits
 */
export function configureRateLimiter(config: {
  ip?: RateLimitConfig
  function?: RateLimitConfig
}): void {
  const composite = new CompositeRateLimiter()
  if (config.ip) {
    composite.addLimiter('ip', new InMemoryRateLimiter(config.ip))
  }
  if (config.function) {
    composite.addLimiter('function', new InMemoryRateLimiter(config.function))
  }
  rateLimiter = composite
}

/**
 * Environment bindings for the Worker
 */
export interface Env {
  /** KV namespace for function registry metadata */
  REGISTRY: KVNamespace
  /** KV namespace for function code storage */
  CODE: KVNamespace
  /** KV namespace for API keys (optional - if not set, auth is disabled) */
  API_KEYS?: KVNamespace
  /** Comma-separated list of additional public endpoints */
  PUBLIC_ENDPOINTS?: string
}

/**
 * Create a Registry implementation backed by KV
 */
function createKVRegistry(kv: KVNamespace): Registry {
  return {
    async get(functionId: string): Promise<FunctionMetadata | null> {
      const data = await kv.get(functionId, 'json')
      return data as FunctionMetadata | null
    },
    async getVersion(functionId: string, version: string): Promise<FunctionMetadata | null> {
      const data = await kv.get(`${functionId}@${version}`, 'json')
      return data as FunctionMetadata | null
    },
    async listVersions(functionId: string): Promise<string[]> {
      const list = await kv.list({ prefix: `${functionId}@` })
      return list.keys.map((key) => key.name.replace(`${functionId}@`, ''))
    },
  }
}

/**
 * Create a CodeStorage implementation backed by KV
 */
function createKVCodeStorage(kv: KVNamespace): CodeStorage {
  return {
    async get(functionId: string, version?: string): Promise<string | null> {
      const key = version ? `${functionId}@${version}` : functionId
      return kv.get(key, 'text')
    },
  }
}

/**
 * API key record stored in KV
 */
interface ApiKeyRecord {
  /** User ID associated with this key */
  userId?: string
  /** Whether the key is active */
  active: boolean
  /** Optional expiration timestamp */
  expiresAt?: string
}

/**
 * Create an AuthConfig backed by KV
 */
function createKVAuthConfig(kv: KVNamespace, publicEndpoints: string[]): AuthConfig {
  return {
    apiKeyHeader: 'X-API-Key',
    publicEndpoints,
    async validateApiKey(key: string): Promise<boolean> {
      const record = await kv.get<ApiKeyRecord>(key, 'json')
      if (!record || !record.active) {
        return false
      }
      // Check expiration if set
      if (record.expiresAt) {
        const expiresAt = new Date(record.expiresAt)
        if (expiresAt < new Date()) {
          return false
        }
      }
      return true
    },
    async getUserId(key: string): Promise<string | undefined> {
      const record = await kv.get<ApiKeyRecord>(key, 'json')
      return record?.userId
    },
  }
}

/**
 * Parse public endpoints from environment variable
 */
function parsePublicEndpoints(envValue?: string): string[] {
  const defaultEndpoints = [...DEFAULT_PUBLIC_ENDPOINTS]
  if (!envValue) {
    return defaultEndpoints
  }
  const customEndpoints = envValue.split(',').map((e) => e.trim()).filter(Boolean)
  return [...defaultEndpoints, ...customEndpoints]
}

/**
 * JSON response helper
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Error response helper
 */
function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status)
}

/**
 * Parse function ID from request
 * Supports:
 * - URL path: /functions/:functionId or /functions/:functionId/invoke
 * - X-Function-Id header
 */
function parseFunctionId(request: Request): string | null {
  const url = new URL(request.url)
  const pathParts = url.pathname.split('/').filter(Boolean)

  // Check for /functions/:functionId pattern
  if (pathParts[0] === 'functions' && pathParts[1]) {
    return pathParts[1]
  }

  // Fallback to X-Function-Id header
  return request.headers.get('X-Function-Id')
}

/**
 * Parse action from request path
 * Returns 'invoke', 'info', or null for default behavior
 */
function parseAction(request: Request): 'invoke' | 'info' | null {
  const url = new URL(request.url)
  const pathParts = url.pathname.split('/').filter(Boolean)

  // Check for /functions/:functionId/:action pattern
  if (pathParts[0] === 'functions' && pathParts[2]) {
    const action = pathParts[2].toLowerCase()
    if (action === 'invoke') return 'invoke'
    if (action === 'info') return 'info'
  }

  return null
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Health check endpoint
    if (url.pathname === '/health' || url.pathname === '/') {
      return jsonResponse({ status: 'ok', service: 'Functions.do' })
    }

    // Authentication check (if API_KEYS KV is configured)
    if (env.API_KEYS) {
      const publicEndpoints = parsePublicEndpoints(env.PUBLIC_ENDPOINTS)

      // Check if this is a public endpoint
      if (!isPublicEndpoint(url.pathname, publicEndpoints)) {
        const authConfig = createKVAuthConfig(env.API_KEYS, publicEndpoints)
        const authResult = await authenticateRequest(request, authConfig)

        if (!authResult.authenticated) {
          return errorResponse(authResult.error || 'Unauthorized', 401)
        }
      }
    }

    // Parse function ID
    const functionId = parseFunctionId(request)
    if (!functionId) {
      return errorResponse('Function ID required. Use /functions/:functionId or X-Function-Id header.', 400)
    }

    // Validate function ID format
    try {
      validateFunctionId(functionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid function ID format'
      return errorResponse(message, 400)
    }

    // Rate limiting check
    const clientIP = getClientIP(request)
    const limiter = getRateLimiter()
    const rateLimitResult = await limiter.checkAndIncrementAll({
      ip: clientIP,
      function: functionId,
    })

    if (!rateLimitResult.allowed) {
      const blockingResult = rateLimitResult.results[rateLimitResult.blockingCategory || 'ip']
      return createRateLimitResponse(blockingResult, rateLimitResult.blockingCategory)
    }

    // Create loader with KV-backed registry and code storage
    const loader = new FunctionLoader({
      registry: createKVRegistry(env.REGISTRY),
      codeStorage: createKVCodeStorage(env.CODE),
    })

    // Load the function
    const result = await loader.loadWithResult(functionId)

    if (!result.success || !result.stub) {
      const errorMessage = result.error?.message || 'Function not found'
      const status = errorMessage.toLowerCase().includes('not found') ? 404 : 500
      return errorResponse(errorMessage, status)
    }

    const method = request.method.toUpperCase()
    const action = parseAction(request)

    // GET /functions/:functionId or GET /functions/:functionId/info - return function info
    if (method === 'GET' && (action === 'info' || action === null)) {
      return jsonResponse({
        id: result.stub.id,
        status: 'loaded',
        fromCache: result.fromCache,
        loadTimeMs: result.loadTimeMs,
        degraded: result.degraded,
        degradationReason: result.degradationReason,
      })
    }

    // POST /functions/:functionId or POST /functions/:functionId/invoke - invoke function
    if (method === 'POST') {
      try {
        // Create FunctionTarget for RPC-style invocation
        const target = new FunctionTarget(result.stub)

        // Parse request body for method invocation
        let body: { method?: string; params?: unknown[] } = {}
        const contentType = request.headers.get('Content-Type')

        if (contentType?.includes('application/json')) {
          try {
            body = await request.json()
          } catch {
            return errorResponse('Invalid JSON body', 400)
          }
        }

        // If method is specified, use RPC-style invocation
        if (body.method) {
          const invokeResult = await target.invoke(body.method, ...(body.params || []))
          return jsonResponse({ result: invokeResult })
        }

        // Otherwise, forward the request directly to the function's fetch handler
        const response = await result.stub.fetch(request)

        // If the response is already JSON, return it as-is
        const responseContentType = response.headers.get('Content-Type')
        if (responseContentType?.includes('application/json')) {
          return response
        }

        // Wrap non-JSON responses
        const responseBody = await response.text()
        return jsonResponse({
          result: responseBody,
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invocation failed'
        return errorResponse(message, 500)
      }
    }

    // Unsupported method
    return errorResponse(`Method ${method} not allowed. Use GET for info or POST for invoke.`, 405)
  },
}

// Re-export types and modules
export * from './core/types'
export * from './core/worker-loader'
export * from './core/auth'
export * from './core/rate-limiter'
export * from './core/errors'
export { KVCodeStorage } from './core/code-storage'
export type { CodeStorage } from './core/function-loader'

// Re-export template literals for inline function definitions
export {
  typescript,
  javascript,
  rust,
  go,
  python,
  csharp,
  zig,
  assemblyscript,
  type InlineFunction,
  type CompiledFunction,
  type DeployedFunction,
  type DeployOptions,
} from './template-literals'
