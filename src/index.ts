/**
 * Functions.do - Multi-language serverless platform
 *
 * Main entry point for the Cloudflare Worker
 */

import { FunctionLoader, type Registry, type CodeStorage } from './core/function-loader'
import { FunctionTarget } from './core/function-target'
import type { FunctionMetadata } from './core/types'
import { isValidVersion } from './core/types'
import {
  validateFunctionId,
  validateEntryPoint,
  validateLanguage,
  validateDependencies,
} from './core/function-registry'
import { KVFunctionRegistry } from './core/kv-function-registry'
import { KVCodeStorage } from './core/code-storage'
import { compileTypeScript } from './languages/typescript/compile'
import { compileRust } from './languages/rust/compile'
import { compileGo } from './languages/go/compile'
import { compileZig } from './languages/zig/compile'
import { compileAssemblyScript } from './languages/assemblyscript/compile'
import { ValidationError } from './core/errors'
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
  /** Static assets binding for WASM binaries */
  ASSETS?: Fetcher
  /** Comma-separated list of additional public endpoints */
  PUBLIC_ENDPOINTS?: string
  /** Durable Object namespace for function logs */
  FUNCTION_LOGS?: DurableObjectNamespace
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

    // Handle DELETE /api/functions/{functionId} endpoint
    const apiMatch = url.pathname.match(/^\/api\/functions\/([^\/]+)$/)
    if (apiMatch && request.method === 'DELETE') {
      const functionId = apiMatch[1]

      // Validate function ID format
      try {
        validateFunctionId(functionId)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid function ID format'
        return errorResponse(message, 400)
      }

      // Authentication check for API endpoints (if API_KEYS KV is configured)
      if (env.API_KEYS) {
        const publicEndpoints = parsePublicEndpoints(env.PUBLIC_ENDPOINTS)
        if (!isPublicEndpoint(url.pathname, publicEndpoints)) {
          const authConfig = createKVAuthConfig(env.API_KEYS, publicEndpoints)
          const authResult = await authenticateRequest(request, authConfig)
          if (!authResult.authenticated) {
            return errorResponse(authResult.error || 'Unauthorized', 401)
          }
        }
      }

      // Create registry and code storage instances
      const registry = new KVFunctionRegistry(env.REGISTRY)
      const codeStorage = new KVCodeStorage(env.CODE)

      // Check if function exists
      const metadata = await registry.get(functionId)
      if (!metadata) {
        return errorResponse('Function not found', 404)
      }

      // Delete all code entries (including all versions)
      await codeStorage.deleteAll(functionId)

      // Delete function metadata (including all version metadata)
      await registry.delete(functionId)

      return jsonResponse({ success: true, id: functionId, message: 'Function deleted' })
    }

    // Handle GET /api/functions/{functionId}/logs endpoint
    const logsMatch = url.pathname.match(/^\/api\/functions\/([^\/]+)\/logs$/)
    if (logsMatch && request.method === 'GET') {
      const functionId = logsMatch[1]

      // Validate function ID format
      try {
        validateFunctionId(functionId)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid function ID format'
        return errorResponse(message, 400)
      }

      // Authentication check for API endpoints (if API_KEYS KV is configured)
      if (env.API_KEYS) {
        const publicEndpoints = parsePublicEndpoints(env.PUBLIC_ENDPOINTS)
        if (!isPublicEndpoint(url.pathname, publicEndpoints)) {
          const authConfig = createKVAuthConfig(env.API_KEYS, publicEndpoints)
          const authResult = await authenticateRequest(request, authConfig)
          if (!authResult.authenticated) {
            return errorResponse(authResult.error || 'Unauthorized', 401)
          }
        }
      }

      // Check if FUNCTION_LOGS Durable Object is configured
      if (!env.FUNCTION_LOGS) {
        return errorResponse('Function logs not configured', 503)
      }

      // Parse query parameters
      const limitParam = url.searchParams.get('limit')
      const sinceParam = url.searchParams.get('since')

      const limit = limitParam ? parseInt(limitParam, 10) : 100
      if (isNaN(limit) || limit < 1 || limit > 1000) {
        return errorResponse('Invalid limit parameter. Must be between 1 and 1000.', 400)
      }

      let startTime: number | undefined
      if (sinceParam) {
        const parsedDate = Date.parse(sinceParam)
        if (isNaN(parsedDate)) {
          return errorResponse('Invalid since parameter. Must be an ISO 8601 timestamp.', 400)
        }
        startTime = parsedDate
      }

      // Get a stub for the FunctionLogs Durable Object (using functionId as the DO instance ID)
      const doId = env.FUNCTION_LOGS.idFromName(functionId)
      const stub = env.FUNCTION_LOGS.get(doId)

      // Build the query URL for the Durable Object
      const doUrl = new URL('/logs', 'https://function-logs.internal')
      doUrl.searchParams.set('functionId', functionId)
      doUrl.searchParams.set('limit', String(limit))

      // Forward request to the Durable Object
      const doResponse = await stub.fetch(doUrl.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!doResponse.ok) {
        const errorText = await doResponse.text()
        return errorResponse(`Failed to retrieve logs: ${errorText}`, doResponse.status)
      }

      // Parse the DO response and transform to expected format
      const doResult = await doResponse.json() as {
        entries: Array<{
          timestamp: number
          level: string
          message: string
        }>
      }

      // Filter by startTime if provided and transform timestamps to ISO strings
      let entries = doResult.entries || []
      if (startTime !== undefined) {
        entries = entries.filter(entry => entry.timestamp >= startTime!)
      }

      // Transform to the expected response format with ISO timestamps
      const logs = entries.map(entry => ({
        timestamp: new Date(entry.timestamp).toISOString(),
        level: entry.level,
        message: entry.message,
      }))

      return jsonResponse(logs)
    }

    // Handle POST /api/functions endpoint for deploying functions
    if (url.pathname === '/api/functions' && request.method === 'POST') {
      // Authentication check for API endpoints (if API_KEYS KV is configured)
      if (env.API_KEYS) {
        const publicEndpoints = parsePublicEndpoints(env.PUBLIC_ENDPOINTS)
        if (!isPublicEndpoint(url.pathname, publicEndpoints)) {
          const authConfig = createKVAuthConfig(env.API_KEYS, publicEndpoints)
          const authResult = await authenticateRequest(request, authConfig)
          if (!authResult.authenticated) {
            return errorResponse(authResult.error || 'Unauthorized', 401)
          }
        }
      }

      // Parse request body
      let body: {
        id?: string
        version?: string
        language?: string
        code?: string
        entryPoint?: string
        dependencies?: Record<string, string>
      }
      try {
        body = await request.json()
      } catch {
        return errorResponse('Invalid JSON body', 400)
      }

      // Validate required fields
      const { id, version, language, code, entryPoint, dependencies } = body

      if (!id) {
        return errorResponse('Missing required field: id', 400)
      }
      if (!version) {
        return errorResponse('Missing required field: version', 400)
      }
      if (!language) {
        return errorResponse('Missing required field: language', 400)
      }
      if (!code) {
        return errorResponse('Missing required field: code', 400)
      }

      // Validate function metadata
      try {
        validateFunctionId(id)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid function ID'
        return errorResponse(message, 400)
      }

      if (!isValidVersion(version)) {
        return errorResponse(`Invalid semantic version: ${version}`, 400)
      }

      try {
        validateLanguage(language)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid language'
        return errorResponse(message, 400)
      }

      // Validate entry point if provided, otherwise use defaults
      const resolvedEntryPoint = entryPoint || (language === 'typescript' || language === 'javascript' ? 'index.ts' : 'main')
      try {
        validateEntryPoint(resolvedEntryPoint)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid entry point'
        return errorResponse(message, 400)
      }

      // Validate dependencies if provided
      try {
        validateDependencies(dependencies)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid dependencies'
        return errorResponse(message, 400)
      }

      // Compile the code based on language
      let compiledCode: string | Uint8Array
      try {
        switch (language) {
          case 'typescript':
          case 'javascript': {
            const result = await compileTypeScript(code)
            if (result.errors && result.errors.length > 0) {
              return errorResponse(`Compilation failed: ${result.errors.map(e => e.message).join(', ')}`, 400)
            }
            compiledCode = result.code
            break
          }
          case 'rust': {
            const result = await compileRust(code)
            compiledCode = result.wasm
            break
          }
          case 'go': {
            const result = await compileGo(code)
            compiledCode = result.wasm
            break
          }
          case 'zig': {
            const result = await compileZig(code)
            compiledCode = result.wasm
            break
          }
          case 'assemblyscript': {
            const result = await compileAssemblyScript(code)
            compiledCode = result.wasm
            break
          }
          default:
            return errorResponse(`Compilation not yet supported for language: ${language}`, 400)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Compilation failed'
        return errorResponse(message, 400)
      }

      // Create registry and code storage instances
      const registry = new KVFunctionRegistry(env.REGISTRY)
      const codeStorage = new KVCodeStorage(env.CODE)

      // Store compiled code in CODE namespace
      if (compiledCode instanceof Uint8Array) {
        // For WASM binaries, store as base64
        const base64Code = btoa(String.fromCharCode(...compiledCode))
        await codeStorage.put(id, base64Code, version)
        // Also store as latest
        await codeStorage.put(id, base64Code)
      } else {
        // For text-based code (TypeScript/JavaScript)
        await codeStorage.put(id, compiledCode, version)
        // Also store as latest
        await codeStorage.put(id, compiledCode)
      }

      // Store metadata in REGISTRY namespace
      const metadata: FunctionMetadata = {
        id,
        version,
        language: language as FunctionMetadata['language'],
        entryPoint: resolvedEntryPoint,
        dependencies: dependencies || {},
      }
      await registry.put(metadata)
      await registry.putVersion(id, version, metadata)

      // Return success response
      const baseUrl = new URL(request.url).origin
      return jsonResponse({
        id,
        version,
        url: `${baseUrl}/functions/${id}`,
      })
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

        // Clone request before reading body so we can pass it to the function if needed
        const requestClone = request.clone()

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

        // Otherwise, forward the cloned request to the function's fetch handler
        // We use the clone because the original request's body was consumed for RPC check
        const response = await result.stub.fetch(requestClone)

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
