/**
 * Functions.do - Multi-language serverless platform
 *
 * Main entry point for the Cloudflare Worker
 */

import type { WorkerLoader, WorkerStub, SandboxEnv } from 'ai-evaluate'
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
// WASM compilers - use programmatic generation (no external tools)
import { compileRust } from './languages/rust/compile'
import { compileGo } from './languages/go/compile'
import { compileZig } from './languages/zig/compile'
import { compileAssemblyScript } from './languages/assemblyscript/compile'
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
import {
  stripTypeScript,
  parseFunctionId,
  parseAction,
  jsonResponse,
  errorResponse,
} from './core/routing-utils'

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
/**
 * Dispatch namespace binding for Workers for Platforms
 */
interface DispatchNamespace {
  get(scriptName: string, options?: { entrypoint?: string }): {
    fetch(request: Request): Promise<Response>
  }
}

export interface Env {
  /** KV namespace for function registry metadata */
  FUNCTIONS_REGISTRY: KVNamespace
  /** KV namespace for function code storage */
  FUNCTIONS_CODE: KVNamespace
  /** KV namespace for API keys (optional - if not set, auth is disabled) */
  FUNCTIONS_API_KEYS?: KVNamespace
  /** Static assets binding for WASM binaries */
  ASSETS?: Fetcher
  /** Comma-separated list of additional public endpoints */
  PUBLIC_ENDPOINTS?: string
  /** Durable Object namespace for function logs */
  FUNCTION_LOGS?: DurableObjectNamespace
  /** Durable Object namespace for function executor */
  FUNCTION_EXECUTOR?: DurableObjectNamespace
  /** Worker Loader for ai-evaluate sandbox execution */
  LOADER?: unknown
  /** Test service binding for ai-evaluate (from ai-tests Worker) */
  TEST?: unknown
  /** Dispatch namespace for user-deployed functions (Workers for Platforms fallback) */
  USER_FUNCTIONS?: DispatchNamespace
  /** Cloudflare Account ID for API calls */
  CLOUDFLARE_ACCOUNT_ID?: string
  /** Cloudflare API Token for script uploads (secret) */
  CLOUDFLARE_API_TOKEN?: string
  /** Dispatch namespace name for script uploads */
  DISPATCH_NAMESPACE?: string
}

/**
 * Create a Registry implementation backed by KV
 */
function createKVRegistry(kv: KVNamespace): Registry {
  return {
    async get(functionId: string): Promise<FunctionMetadata | null> {
      // Use same key format as KVFunctionRegistry: registry:{functionId}
      const data = await kv.get(`registry:${functionId}`, 'json')
      return data as FunctionMetadata | null
    },
    async getVersion(functionId: string, version: string): Promise<FunctionMetadata | null> {
      // Use same key format as KVFunctionRegistry: registry:{functionId}:v:{version}
      const data = await kv.get(`registry:${functionId}:v:${version}`, 'json')
      return data as FunctionMetadata | null
    },
    async listVersions(functionId: string): Promise<string[]> {
      const list = await kv.list({ prefix: `registry:${functionId}:v:` })
      return list.keys.map((key) => key.name.replace(`registry:${functionId}:v:`, ''))
    },
  }
}

/**
 * Create a CodeStorage implementation backed by KV
 */
function createKVCodeStorage(kv: KVNamespace): CodeStorage {
  return {
    async get(functionId: string, version?: string): Promise<string | null> {
      // Use same key format as KVCodeStorage: code:{functionId}:v:{version} or code:{functionId}
      const key = version ? `code:${functionId}:v:${version}` : `code:${functionId}`
      return kv.get(key, 'text')
    },
  }
}

/**
 * Upload a script to the dispatch namespace using the Cloudflare API.
 * This enables Workers for Platforms dynamic code execution.
 */
async function uploadToDispatchNamespace(
  code: string,
  scriptName: string,
  env: Pick<Env, 'CLOUDFLARE_ACCOUNT_ID' | 'CLOUDFLARE_API_TOKEN' | 'DISPATCH_NAMESPACE'>
): Promise<{ success: boolean; error?: string }> {
  const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, DISPATCH_NAMESPACE } = env

  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN || !DISPATCH_NAMESPACE) {
    return { success: false, error: 'Missing Cloudflare API configuration for dispatch namespace' }
  }

  // Wrap the code in a proper ES module format if needed
  const wrappedCode = code.includes('export default')
    ? code
    : `export default { fetch(request) { return new Response('Function not properly formatted'); } }`

  // Create a FormData with the script content
  const formData = new FormData()

  // Create metadata for the upload
  const metadata = {
    main_module: 'index.js',
    compatibility_date: '2025-01-01',
  }
  formData.append('metadata', JSON.stringify(metadata))
  formData.append('index.js', new Blob([wrappedCode], { type: 'application/javascript+module' }), 'index.js')

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/dispatch/namespaces/${DISPATCH_NAMESPACE}/scripts/${scriptName}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        },
        body: formData,
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ errors: [{ message: 'Unknown error' }] }))
      const errorMessage =
        (errorData as { errors?: Array<{ message: string }> }).errors?.[0]?.message || `HTTP ${response.status}`
      return { success: false, error: `Failed to upload to dispatch namespace: ${errorMessage}` }
    }

    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: `Failed to upload to dispatch namespace: ${message}` }
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
      const registry = new KVFunctionRegistry(env.FUNCTIONS_REGISTRY)
      const codeStorage = new KVCodeStorage(env.FUNCTIONS_CODE)

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
      // Note: TypeScript/JavaScript are stored as source and bundled at runtime
      // WASM languages are compiled using programmatic WASM generation
      let compiledCode: string | Uint8Array
      try {
        switch (language) {
          case 'typescript':
          case 'javascript': {
            // Store source directly - Workers can run TS/JS natively
            // Compilation happens at bundle time via wrangler or at runtime
            compiledCode = code
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
      const registry = new KVFunctionRegistry(env.FUNCTIONS_REGISTRY)
      const codeStorage = new KVCodeStorage(env.FUNCTIONS_CODE)

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

      // Upload to dispatch namespace for TypeScript/JavaScript execution
      let dispatchUploadResult: { success: boolean; error?: string } = { success: true }
      if ((language === 'typescript' || language === 'javascript') && typeof compiledCode === 'string') {
        dispatchUploadResult = await uploadToDispatchNamespace(compiledCode, id, env)
      }

      // Return success response
      const baseUrl = new URL(request.url).origin
      return jsonResponse({
        id,
        version,
        url: `${baseUrl}/functions/${id}`,
        dispatchUpload: dispatchUploadResult.success
          ? 'success'
          : dispatchUploadResult.error || 'Dispatch upload not configured',
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

    const method = request.method.toUpperCase()
    const action = parseAction(request)

    // Check if function exists in registry
    const registry = createKVRegistry(env.FUNCTIONS_REGISTRY)
    const metadata = await registry.get(functionId)
    if (!metadata) {
      return errorResponse(`Function not found: ${functionId}`, 404)
    }

    // GET /functions/:functionId or GET /functions/:functionId/info - return function info
    if (method === 'GET' && (action === 'info' || action === null)) {
      return jsonResponse({
        id: functionId,
        status: 'available',
        version: metadata.version,
        language: metadata.language,
      })
    }

    // POST /functions/:functionId or POST /functions/:functionId/invoke - invoke function
    if (method === 'POST') {
      try {
        // Get the function code from KV
        const codeStorage = createKVCodeStorage(env.FUNCTIONS_CODE)
        const code = await codeStorage.get(functionId)

        if (!code) {
          return errorResponse(`Function code not found: ${functionId}`, 404)
        }

        // Parse request body if present
        let requestData: unknown = {}
        const contentType = request.headers.get('Content-Type')
        if (contentType?.includes('application/json')) {
          const bodyText = await request.text()
          if (bodyText.trim()) {
            try {
              requestData = JSON.parse(bodyText)
            } catch {
              return errorResponse('Invalid JSON body', 400)
            }
          }
        }

        // Primary: Use worker_loaders via ai-evaluate types
        // Requires LOADER (worker_loaders) binding
        if (env.LOADER) {
          const loader = env.LOADER as WorkerLoader

          try {
            // Strip TypeScript annotations if needed
            let jsCode = code
            const isTypeScript = metadata.language === 'typescript' ||
              code.includes(': Request') ||
              code.includes(': Response') ||
              code.includes(': Promise')

            if (isTypeScript) {
              jsCode = stripTypeScript(code)
            }

            const workerId = `fn-${functionId}-${Date.now()}`
            const workerStub: WorkerStub = loader.get(workerId, async () => ({
              mainModule: 'worker.js',
              modules: { 'worker.js': jsCode },
              compatibilityDate: '2024-01-01',
            }))

            // Get the entrypoint and call fetch (ai-evaluate WorkerStub API)
            const entrypoint = workerStub.getEntrypoint()

            const sandboxRequest = new Request('http://sandbox/invoke', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: requestData ? JSON.stringify(requestData) : undefined,
            })

            const start = Date.now()
            const response = await entrypoint.fetch(sandboxRequest)
            const duration = Date.now() - start

            const responseContentType = response.headers.get('Content-Type')
            if (responseContentType?.includes('application/json')) {
              const result = await response.json()
              return jsonResponse({
                ...result as object,
                _meta: { duration, executedWith: 'worker_loaders' }
              })
            }

            const body = await response.text()
            return jsonResponse({
              result: body,
              status: response.status,
              _meta: { duration, executedWith: 'worker_loaders' }
            })

          } catch (loaderError) {
            console.error('Worker loader error:', loaderError)
            const msg = loaderError instanceof Error ? loaderError.message : String(loaderError)
            console.log('Falling back to dispatch namespace due to loader error:', msg)

            // Return the error immediately instead of falling back to dispatch namespace
            // This provides better debugging and faster failure
            return errorResponse(`Worker loader execution failed: ${msg}`, 500)
          }
        }

        // Fallback: Use Workers for Platforms dispatch namespace (only if LOADER not available)
        if (env.USER_FUNCTIONS && !env.LOADER) {
          try {
            const userWorker = env.USER_FUNCTIONS.get(functionId)

            // Check if the worker was returned correctly
            if (!userWorker || typeof userWorker.fetch !== 'function') {
              return errorResponse(
                `Function ${functionId} not available in dispatch namespace. userWorker type: ${typeof userWorker}. Upload the function with: wrangler deploy --dispatch-namespace=dotdo-public`,
                404
              )
            }

            // Create a new request since the original body was already consumed
            const dispatchRequest = new Request(request.url, {
              method: request.method,
              headers: request.headers,
              body: requestData ? JSON.stringify(requestData) : undefined,
            })

            const response = await userWorker.fetch(dispatchRequest)

            const responseContentType = response.headers.get('Content-Type')
            if (responseContentType?.includes('application/json')) {
              return response
            }

            const responseBody = await response.text()
            return jsonResponse({
              result: responseBody,
              status: response.status,
              headers: Object.fromEntries(response.headers.entries()),
            })
          } catch (dispatchError) {
            const msg = dispatchError instanceof Error ? dispatchError.message : 'Dispatch error'
            return errorResponse(`Dispatch namespace error: ${msg}`, 500)
          }
        }

        // No execution method available
        return errorResponse(
          'Function execution not available. LOADER or dispatch namespace required.',
          501
        )
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

// Export Durable Objects for Worker binding
export { FunctionExecutor } from './do/function-executor'
export { FunctionLogs } from './do/function-logs'
export { RateLimiterDO } from './do/rate-limiter'
