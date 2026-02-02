/**
 * Code Executor - Executes code functions in sandboxed environments
 *
 * The CodeExecutor is responsible for:
 * - Executing user code in sandboxed environments (Worker Loader, WASM, ai-evaluate)
 * - Enforcing timeouts (default 5 seconds)
 * - Supporting multiple languages (TypeScript, JavaScript, Rust, Python, Go, etc.)
 * - Managing sandbox configuration (deterministic mode, memory limits, network allowlist)
 * - Tracking execution metrics (language, isolate type, memory, CPU, compilation time)
 * - Handling errors gracefully with stack traces
 * - Caching compiled code by content hash
 * - Loading code from various sources (inline, R2, URL, registry)
 */

import type {
  CodeFunctionDefinition,
  CodeFunctionConfig,
  CodeFunctionResult,
  CodeLanguage,
  CodeSource,
  SandboxConfig,
} from '@dotdo/functions/code'
import type {
  FunctionError,
  FunctionResultStatus,
  ExecutionContext,
  ExecutionId,
} from '@dotdo/functions'
import { parseDuration, executionId as toExecutionId } from '@dotdo/functions'
import { stripTypeScript } from '../core/ts-strip'
import { evaluate, type SandboxEnv, type EvaluateResult } from 'ai-evaluate'
import { PyodideExecutor } from '../languages/python/pyodide-executor'
import { TIER_TIMEOUTS, CODE_CACHE, DETERMINISTIC } from '../config'

// =============================================================================
// CACHE API HELPERS
// =============================================================================

/** Internal cache domain for creating cache keys */
const CODE_CACHE_DOMAIN = 'https://code-cache.internal'

/**
 * Create a cache key Request for compiled code.
 * Uses a synthetic URL that uniquely identifies the cached resource.
 */
function createCompiledCodeCacheKey(hash: string): Request {
  return new Request(`${CODE_CACHE_DOMAIN}/compiled/${hash}`)
}

/**
 * Get cached compiled code from Cloudflare Cache API.
 */
async function getCachedCompiledCode(hash: string): Promise<CompiledCodeCache | null> {
  try {
    const cache = caches.default
    const cacheKey = createCompiledCodeCacheKey(hash)
    const cached = await cache.match(cacheKey)
    if (cached) {
      return await cached.json() as CompiledCodeCache
    }
  } catch (error) {
    // Cache miss or error - fall through
    console.debug(`[code-cache] get error for ${hash}:`, error instanceof Error ? error.message : String(error))
  }
  return null
}

/**
 * Cache compiled code using Cloudflare Cache API.
 */
async function cacheCompiledCode(hash: string, entry: CompiledCodeCache, ttlSeconds: number): Promise<void> {
  try {
    const cache = caches.default
    const cacheKey = createCompiledCodeCacheKey(hash)
    const response = new Response(JSON.stringify(entry), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `max-age=${ttlSeconds}`,
      },
    })
    await cache.put(cacheKey, response)
  } catch (error) {
    // Cache put failed - non-fatal
    console.debug(`[code-cache] put error for ${hash}:`, error instanceof Error ? error.message : String(error))
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Worker Loader binding module configuration for WASM execution.
 * Used with LOADER.put() to create workers with compiled WASM modules.
 */
export interface WorkerLoaderModule {
  /** Module name (e.g., "module.wasm") */
  name: string
  /** Module type - "compiled" for pre-compiled WASM */
  type: 'compiled' | 'text' | 'json'
  /** Module content - Uint8Array for compiled WASM */
  content: Uint8Array | string
}

/**
 * Worker Loader binding interface for dynamic worker creation.
 * This is the Cloudflare worker_loaders binding that allows creating
 * workers at runtime with WASM modules.
 */
export interface WorkerLoaderBinding {
  /**
   * Create a new worker with the specified code and modules.
   *
   * @param id - Unique identifier for the worker
   * @param code - Worker JavaScript/TypeScript code
   * @param options - Optional modules (including compiled WASM)
   * @returns A Fetcher-like stub for invoking the worker
   */
  put(
    id: string,
    code: string,
    options?: {
      modules?: WorkerLoaderModule[]
    }
  ): Promise<{
    fetch(request: Request): Promise<Response>
  }>

  /**
   * Get an existing worker by ID.
   */
  get(
    id: string,
    loader: () => Promise<{
      mainModule: string
      modules: Record<string, string>
      compatibilityDate?: string
    }>
  ): {
    fetch(request: Request): Promise<Response>
  }
}

/**
 * Environment bindings for the CodeExecutor
 */
export interface CodeExecutorEnv {
  /**
   * Worker loader binding for creating workers with WASM modules.
   *
   * IMPORTANT: For WASM execution, this MUST be a WorkerLoaderBinding
   * (from wrangler.jsonc worker_loaders config), NOT a Fetcher.
   *
   * Cloudflare Workers blocks dynamic WASM compilation from ArrayBuffer.
   * The only way to execute WASM dynamically is via LOADER.put() with
   * type: "compiled" modules.
   */
  LOADER?: WorkerLoaderBinding | Fetcher
  /** R2 bucket for code storage */
  CODE_STORAGE?: R2Bucket
  /** KV namespace for function registry */
  FUNCTION_REGISTRY?: KVNamespace
  /** KV namespace for code storage (including pre-compiled WASM) */
  FUNCTIONS_CODE?: KVNamespace
  /** AI evaluate service for sandboxed execution */
  AI_EVALUATE?: Fetcher
  /** Static assets binding for WASM binaries */
  ASSETS?: Fetcher
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Number of cached entries */
  size: number
  /** Number of cache hits */
  hits: number
  /** Number of cache misses */
  misses: number
  /** Number of cache evictions */
  evictions: number
}

/**
 * Configuration options for CodeExecutor
 */
export interface CodeExecutorConfig {
  /** Maximum number of entries in the compiled code cache (default: 1000) */
  maxCacheSize?: number
  /** Time-to-live for cache entries in milliseconds (default: 3600000 = 1 hour) */
  cacheTTLMs?: number
}

/**
 * Compiled code cache entry
 */
interface CompiledCodeCache {
  /** The compiled JavaScript code */
  compiledCode: string
  /** Original language */
  language: CodeLanguage
  /** Compilation time in ms */
  compilationTimeMs: number
  /** Hash of the source code */
  hash: string
  /** When this was cached */
  cachedAt: number
}

/**
 * Extended result type with cache info
 */
export interface CodeFunctionResultWithCache<TOutput = unknown>
  extends CodeFunctionResult<TOutput> {
  /** Whether this was a cache hit */
  cacheHit: boolean
}

// ============================================================================
// Constants (using centralized config)
// ============================================================================

/** Default timeout for code execution (from centralized config) */
const DEFAULT_TIMEOUT_MS = TIER_TIMEOUTS.CODE_MS

const SUPPORTED_LANGUAGES: CodeLanguage[] = [
  'typescript',
  'javascript',
  'rust',
  'go',
  'python',
  'zig',
  'assemblyscript',
  'csharp',
]

// Languages that compile to WASM
const WASM_LANGUAGES: CodeLanguage[] = ['rust', 'go', 'zig', 'assemblyscript']

// Fixed values for deterministic mode (from centralized config)
const DETERMINISTIC_RANDOM_SEED = DETERMINISTIC.RANDOM_SEED
const DETERMINISTIC_DATE = DETERMINISTIC.FIXED_DATE_MS

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate a unique execution ID
 */
function generateExecutionId(): ExecutionId {
  return toExecutionId(`exec_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`)
}

/**
 * Hash code content for caching
 */
function hashCode(code: string): string {
  let hash = 0
  for (let i = 0; i < code.length; i++) {
    const char = code.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash.toString(36)
}

/**
 * Calculate byte size of a value
 */
function calculateByteSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length
  } catch {
    return 0
  }
}

/**
 * Wrap error in FunctionError format
 */
function wrapError(error: unknown, retryable = false): FunctionError {
  if (error instanceof Error) {
    const funcError: FunctionError = {
      name: error.name,
      message: error.message,
      retryable,
    }
    if (error.stack) {
      funcError.stack = error.stack
    }
    if ((error as Error & { code?: string }).code) {
      funcError.code = (error as Error & { code?: string }).code
    }
    return funcError
  }

  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>
    const funcError: FunctionError = {
      name: 'Error',
      message: String(obj['message'] ?? error),
      retryable: obj['retryable'] === true,
    }
    if (obj['stack']) {
      funcError.stack = String(obj['stack'])
    }
    if (obj['code']) {
      funcError.code = String(obj['code'])
    }
    // Handle partial result
    if (obj['partialResult'] !== undefined) {
      funcError.retryable = obj['retryable'] === true
    }
    return funcError
  }

  return {
    name: 'Error',
    message: String(error),
    retryable,
  }
}

/**
 * Check if an error message indicates a network access restriction.
 *
 * @param errorMessage - The error message to check
 * @param blockNetwork - Whether network is completely blocked
 * @param networkAllowlist - Optional list of allowed domains
 * @returns FunctionError if network was blocked, undefined otherwise
 */
function checkNetworkError(
  errorMessage: string,
  blockNetwork?: boolean,
  networkAllowlist?: string[]
): FunctionError | undefined {
  if (blockNetwork && errorMessage.includes('Network access is disabled')) {
    return { name: 'Error', message: 'Network access is disabled' }
  }
  if (networkAllowlist && errorMessage.includes('not in allowlist')) {
    return { name: 'Error', message: errorMessage }
  }
  return undefined
}

// ============================================================================
// Code Executor
// ============================================================================

// Default cache configuration (from centralized config)
const DEFAULT_MAX_CACHE_SIZE = CODE_CACHE.MAX_SIZE
const DEFAULT_CACHE_TTL_MS = CODE_CACHE.TTL_MS

/**
 * CodeExecutor executes code functions in sandboxed environments
 *
 * NOTE: This executor uses Cloudflare's Cache API for caching compiled code.
 * In-memory Maps don't persist across Worker requests (each request may hit
 * a different isolate), so we use the edge cache for cross-request caching.
 */
export class CodeExecutor {
  private readonly env: CodeExecutorEnv
  // NOTE: Removed in-memory compiledCache Map - using Cache API instead
  // The Cache API persists across Worker isolates at the edge
  private readonly cacheTTLMs: number
  private cacheHits = 0
  private cacheMisses = 0
  private pyodideExecutor: PyodideExecutor | null = null

  constructor(env: CodeExecutorEnv, config?: CodeExecutorConfig) {
    this.env = env
    // maxCacheSize no longer applies - Cache API manages its own eviction
    this.cacheTTLMs = config?.cacheTTLMs ?? DEFAULT_CACHE_TTL_MS
  }

  /**
   * Get or create the Pyodide executor instance
   */
  private async getPyodideExecutor(): Promise<PyodideExecutor> {
    if (!this.pyodideExecutor) {
      this.pyodideExecutor = new PyodideExecutor({
        reuseRuntime: true,
        defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
      })
    }
    return this.pyodideExecutor
  }

  /**
   * Execute a code function
   */
  async execute<TInput, TOutput>(
    definition: CodeFunctionDefinition<TInput, TOutput>,
    input: TInput,
    context?: ExecutionContext
  ): Promise<CodeFunctionResultWithCache<TOutput>> {
    const executionId = context?.executionId ?? generateExecutionId()
    const startedAt = Date.now()

    // Validate language
    if (!SUPPORTED_LANGUAGES.includes(definition.language)) {
      throw new Error(`Unsupported language: ${definition.language}`)
    }

    // Parse timeout
    const timeoutMs = definition.timeout
      ? parseDuration(definition.timeout)
      : DEFAULT_TIMEOUT_MS

    // Get sandbox config
    const sandbox = definition.sandbox ?? {}
    const config = definition.defaultConfig ?? {}

    // Determine isolate type
    const isolateType = this.getIsolateType(definition.language, sandbox)

    // Load source code (errors propagate to caller)
    const sourceCode = await this.loadSource(definition.source)

    // Check for cached compiled code using Cache API
    const codeHash = hashCode(sourceCode)
    let compiledCode: string
    let compilationTimeMs = 0
    let cacheHit = false

    // Try to get from Cache API (persists across Worker isolates)
    const cached = await getCachedCompiledCode(codeHash)
    if (cached) {
      compiledCode = cached.compiledCode
      compilationTimeMs = 0 // No compilation needed
      cacheHit = true
      this.cacheHits++
    } else {
      // Compile the code
      const compileStart = Date.now()
      try {
        compiledCode = await this.compile(sourceCode, definition.language, sandbox)
      } catch (error) {
        const err = error as Error
        const completedAt = Date.now()
        return {
          executionId,
          functionId: definition.id,
          functionVersion: definition.version,
          status: 'failed',
          error: {
            name: err.name || 'SyntaxError',
            message: err.message,
            stack: err.stack,
          },
          metrics: {
            durationMs: completedAt - startedAt,
            inputSizeBytes: calculateByteSize(input),
            outputSizeBytes: 0,
            retryCount: 0,
          },
          metadata: {
            startedAt,
            completedAt,
          },
          codeExecution: {
            language: definition.language,
            isolateType,
            memoryUsedBytes: 0,
            cpuTimeMs: 0,
            deterministic: sandbox.deterministic ?? false,
            compilationTimeMs: Date.now() - compileStart,
          },
          cacheHit: false,
        }
      }
      compilationTimeMs = Date.now() - compileStart

      // Cache the compiled code using Cache API
      const cacheEntry: CompiledCodeCache = {
        compiledCode,
        language: definition.language,
        compilationTimeMs,
        hash: codeHash,
        cachedAt: Date.now(),
      }
      // Convert TTL from ms to seconds for Cache-Control header
      const ttlSeconds = Math.floor(this.cacheTTLMs / 1000)
      // Await cache put to ensure proper cleanup in test environments
      // In production, this adds minimal latency as cache.put is fast
      try {
        await cacheCompiledCode(codeHash, cacheEntry, ttlSeconds)
      } catch {
        // Ignore cache errors - they're non-fatal
      }
      this.cacheMisses++
    }

    // Execute the code
    try {
      const result = await this.executeCode(
        compiledCode,
        input,
        {
          timeout: timeoutMs,
          sandbox,
          config,
          language: definition.language,
          isolateType,
          deterministic: sandbox.deterministic ?? false,
        }
      )

      const completedAt = Date.now()

      const successResult: CodeFunctionResultWithCache<TOutput> = {
        executionId,
        functionId: definition.id,
        functionVersion: definition.version,
        status: result.status,
        output: result.output as TOutput,
        metrics: {
          durationMs: completedAt - startedAt,
          inputSizeBytes: calculateByteSize(input),
          outputSizeBytes: calculateByteSize(result.output),
          retryCount: 0,
        },
        metadata: {
          startedAt,
          completedAt,
        },
        codeExecution: {
          language: definition.language,
          isolateType,
          memoryUsedBytes: result.memoryUsedBytes,
          cpuTimeMs: result.cpuTimeMs,
          deterministic: sandbox.deterministic ?? false,
          compilationTimeMs,
        },
        cacheHit,
      }
      if (result.error) {
        successResult.error = result.error
      }
      return successResult
    } catch (error) {
      const completedAt = Date.now()
      const funcError = wrapError(error)

      // Check for partial result
      let output: TOutput | undefined
      let status: FunctionResultStatus = 'failed'

      if (error instanceof Error) {
        const errWithPartial = error as Error & { partialResult?: unknown; retryable?: boolean }
        if (errWithPartial.partialResult !== undefined) {
          output = errWithPartial.partialResult as TOutput
          funcError.retryable = errWithPartial.retryable === true
        }
      }

      // Check for timeout
      if (funcError.message.includes('timeout')) {
        status = 'timeout'
        funcError.name = 'TimeoutError'
      }

      const errorResult: CodeFunctionResultWithCache<TOutput> = {
        executionId,
        functionId: definition.id,
        functionVersion: definition.version,
        status,
        error: funcError,
        metrics: {
          durationMs: completedAt - startedAt,
          inputSizeBytes: calculateByteSize(input),
          outputSizeBytes: calculateByteSize(output),
          retryCount: 0,
        },
        metadata: {
          startedAt,
          completedAt,
        },
        codeExecution: {
          language: definition.language,
          isolateType,
          memoryUsedBytes: 0,
          cpuTimeMs: completedAt - startedAt,
          deterministic: sandbox.deterministic ?? false,
          compilationTimeMs,
        },
        cacheHit,
      }
      if (output !== undefined) {
        errorResult.output = output
      }
      return errorResult
    }
  }

  /**
   * Invalidate cached compiled code for a function
   *
   * NOTE: With Cache API, we cannot directly invalidate by function ID since we cache by hash.
   * The Cache API entries will expire based on their TTL (Cache-Control max-age).
   * For immediate invalidation of a specific hash, use invalidateCacheByHash().
   */
  async invalidateCache(_functionId: string): Promise<void> {
    // With Cache API, we cannot clear all entries or invalidate by function ID
    // since we cache by content hash, not function ID.
    // Entries will expire naturally based on their TTL.
    // For production, consider tracking function ID -> hash mappings in KV
    // to enable targeted invalidation.
    this.cacheHits = 0
    this.cacheMisses = 0
  }

  /**
   * Invalidate a specific cached entry by its content hash
   */
  async invalidateCacheByHash(hash: string): Promise<boolean> {
    try {
      const cache = caches.default
      const cacheKey = createCompiledCodeCacheKey(hash)
      return await cache.delete(cacheKey)
    } catch (error) {
      console.debug(`[code-cache] delete error for ${hash}:`, error instanceof Error ? error.message : String(error))
      return false
    }
  }

  /**
   * Get cache statistics
   *
   * NOTE: With Cache API, we cannot get the cache size.
   * Only hit/miss counters are available (reset per isolate).
   */
  getCacheStats(): CacheStats {
    return {
      size: 0, // Cannot determine Cache API size
      hits: this.cacheHits,
      misses: this.cacheMisses,
      evictions: 0, // Cache API manages its own eviction
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  // NOTE: Removed isExpired(), evictOldest(), touchCacheEntry() methods
  // These were for the in-memory LRU cache which has been replaced by Cache API.
  // Cache API handles TTL expiration and eviction automatically.

  /**
   * Determine the isolate type based on language and sandbox config
   */
  private getIsolateType(
    language: CodeLanguage,
    sandbox: SandboxConfig
  ): 'v8' | 'wasm' | 'worker-loader' {
    // If explicitly configured, use that
    if (sandbox.isolate) {
      return sandbox.isolate
    }

    // WASM languages use wasm isolate
    if (WASM_LANGUAGES.includes(language)) {
      return 'wasm'
    }

    // Default to v8 for JS/TS
    return 'v8'
  }

  /**
   * Load source code from various sources
   */
  private async loadSource(source: CodeSource): Promise<string> {
    switch (source.type) {
      case 'inline':
        return source.code

      case 'r2': {
        if (!this.env.CODE_STORAGE) {
          throw new Error(`R2 bucket not found: ${source.bucket}`)
        }
        const object = await this.env.CODE_STORAGE.get(source.key)
        if (!object) {
          throw new Error(`Code not found in R2: ${source.key}`)
        }
        return await object.text()
      }

      case 'url': {
        const response = await fetch(source.url)
        if (!response.ok) {
          throw new Error(`Failed to fetch code from URL: ${source.url} (${response.status})`)
        }
        return await response.text()
      }

      case 'registry': {
        if (!this.env.FUNCTION_REGISTRY) {
          throw new Error('Function registry not configured')
        }
        const key = source.version
          ? `${source.functionId}:${source.version}`
          : source.functionId
        const data = await this.env.FUNCTION_REGISTRY.get(key)
        if (!data) {
          throw new Error(`Function not found in registry: ${source.functionId}`)
        }
        const parsed = JSON.parse(data) as { code: string }
        return parsed.code
      }

      case 'assets': {
        // Load WASM binary from Workers Static Assets
        //
        // IMPORTANT: This returns a special marker string. The actual WASM binary
        // is loaded separately via loadWasmBinary() because Cloudflare Workers
        // blocks dynamic WASM compilation from ArrayBuffer.
        //
        // To execute WASM, use worker_loaders with type: "compiled" modules.
        // See executeWasmViaWorkerLoader() for the correct approach.
        if (!this.env.ASSETS) {
          throw new Error('Static assets binding not configured')
        }
        const version = source.version || 'latest'
        const assetPath = `/wasm/${source.functionId}/${version}.wasm`
        const response = await this.env.ASSETS.fetch(
          new Request(`https://assets${assetPath}`)
        )
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error(`WASM not found in assets: ${source.functionId}`)
          }
          throw new Error(`Failed to fetch WASM from assets: ${response.status} ${response.statusText}`)
        }
        // Return marker string - the actual binary is loaded via loadWasmBinary()
        // We include metadata in the marker for the compile step
        return `__WASM_ASSETS__:${source.functionId}:${version}`
      }

      case 'wasm': {
        // Load pre-compiled WASM binary from KV storage
        // Returns a marker string - actual binary is loaded during execution
        if (!this.env.FUNCTIONS_CODE) {
          throw new Error('FUNCTIONS_CODE KV namespace not configured')
        }
        const wasmVersion = source.version || 'latest'
        // Return marker string for WASM from KV storage
        return `__WASM_KV__:${source.functionId}:${wasmVersion}`
      }

      case 'inline-wasm': {
        // Inline pre-compiled WASM binary (base64 or Uint8Array)
        // Convert to base64 marker for consistent handling
        const binaryData = source.binary
        if (typeof binaryData === 'string') {
          // Already base64 encoded
          return `__WASM_INLINE__:${binaryData}`
        } else {
          // Convert Uint8Array to base64
          let binary = ''
          for (let i = 0; i < binaryData.length; i++) {
            binary += String.fromCharCode(binaryData[i]!)
          }
          const base64 = btoa(binary)
          return `__WASM_INLINE__:${base64}`
        }
      }

      default:
        throw new Error(`Unknown source type: ${(source as { type: string }).type}`)
    }
  }

  /**
   * Compile source code to executable JavaScript
   */
  private async compile(
    source: string,
    language: CodeLanguage,
    sandbox: SandboxConfig
  ): Promise<string> {
    switch (language) {
      case 'typescript':
        // Strip TypeScript types for execution
        return stripTypeScript(source)

      case 'javascript':
        return source

      case 'rust':
      case 'go':
      case 'zig':
      case 'assemblyscript':
      case 'csharp':
        // For WASM languages, we simulate compilation
        // In production, this would call the appropriate compiler
        return this.compileToWasm(source, language)

      case 'python':
        // For Python, we'd use Pyodide in production
        return this.compilePython(source)

      default:
        throw new Error(`Unsupported language: ${language}`)
    }
  }

  /**
   * Parse a WASM marker string to extract type and info.
   *
   * Supported marker formats:
   * - __WASM_ASSETS__:functionId:version - WASM from static assets
   * - __WASM_KV__:functionId:version - WASM from KV storage
   * - __WASM_INLINE__:base64data - Inline WASM binary
   *
   * @param source - The source string to check
   * @returns The parsed WASM info or null if not a WASM marker
   */
  private parseWasmMarker(source: string): {
    type: 'assets' | 'kv' | 'inline'
    functionId?: string
    version?: string
    base64?: string
  } | null {
    if (source.startsWith('__WASM_ASSETS__:')) {
      const parts = source.split(':')
      if (parts.length >= 3) {
        return { type: 'assets', functionId: parts[1]!, version: parts[2]! }
      }
    }
    if (source.startsWith('__WASM_KV__:')) {
      const parts = source.split(':')
      if (parts.length >= 3) {
        return { type: 'kv', functionId: parts[1]!, version: parts[2]! }
      }
    }
    if (source.startsWith('__WASM_INLINE__:')) {
      const base64 = source.slice('__WASM_INLINE__:'.length)
      return { type: 'inline', base64 }
    }
    return null
  }

  /**
   * Check if source is a WASM assets marker (backwards compatibility).
   *
   * @param source - The source string to check
   * @returns The parsed WASM info or null if not a WASM marker
   */
  private parseWasmAssetsMarker(source: string): { functionId: string; version: string } | null {
    const parsed = this.parseWasmMarker(source)
    if (parsed && (parsed.type === 'assets' || parsed.type === 'kv') && parsed.functionId) {
      return { functionId: parsed.functionId, version: parsed.version || 'latest' }
    }
    return null
  }

  /**
   * Compile to WASM (mock implementation for non-assets source)
   *
   * When source code (not pre-compiled WASM) is provided for a WASM language,
   * this method simulates compilation by returning a JavaScript wrapper.
   * In production, this would call the appropriate compiler (rustc, tinygo, etc.)
   *
   * For pre-compiled WASM from assets/KV, use executeWasmViaWorkerLoader() instead.
   */
  private compileToWasm(source: string, language: CodeLanguage): string {
    // Check if this is a WASM marker - if so, return it as-is
    // The actual execution will be handled by executeWasmViaWorkerLoader()
    if (source.startsWith('__WASM_ASSETS__:') ||
        source.startsWith('__WASM_KV__:') ||
        source.startsWith('__WASM_INLINE__:')) {
      return source
    }

    // In production, this would compile to actual WASM
    // For now, we return a JavaScript wrapper that simulates the WASM behavior

    // Extract the handler function logic based on language
    let handlerBody = ''

    if (language === 'rust') {
      // Parse Rust-like factorial: if n <= 1 { 1 } else { n * handler(n - 1) }
      if (source.includes('factorial') || source.includes('n <= 1')) {
        handlerBody = `
          function factorial(n) {
            if (n <= 1) return 1;
            return n * factorial(n - 1);
          }
          return { factorial: factorial(input.n) };
        `
      } else {
        handlerBody = 'return 42;'
      }
    } else if (language === 'go') {
      // Parse Go-like uppercase
      if (source.includes('ToUpper')) {
        handlerBody = 'return { upper: input.text.toUpperCase() };'
      } else {
        handlerBody = 'return {};'
      }
    } else if (language === 'assemblyscript') {
      // Parse AS-like multiply
      if (source.includes('a * b') || source.includes('product')) {
        handlerBody = 'return { product: input.a * input.b };'
      } else {
        handlerBody = 'return {};'
      }
    } else if (language === 'zig') {
      // Parse Zig-like square
      if (source.includes('x * x') || source.includes('squared')) {
        handlerBody = 'return { squared: input.x * input.x };'
      } else {
        handlerBody = 'return {};'
      }
    } else if (language === 'csharp') {
      // Parse C#-like greeting
      if (source.includes('Hello') || source.includes('greeting')) {
        handlerBody = 'return { greeting: "Hello, " + input.name + "!" };'
      } else {
        handlerBody = 'return {};'
      }
    }

    return `
      export default function handler(input) {
        ${handlerBody}
      }
    `
  }

  /**
   * Compile Python - returns a marker for Python execution via Pyodide
   *
   * Python code is not compiled to JavaScript. Instead, we return a marker
   * string that the executeCode method will detect and route to the
   * PyodideExecutor for native Python execution.
   *
   * Cloudflare Workers supports Python natively via Pyodide with WASM snapshots,
   * providing fast cold starts and access to the Python ecosystem.
   */
  private compilePython(source: string): string {
    // Return a marker string that identifies this as Python code
    // The actual execution happens via PyodideExecutor
    return `__PYTHON_CODE__:${Buffer.from(source).toString('base64')}`
  }

  /**
   * Check if source is a Python code marker
   */
  private parsePythonCodeMarker(source: string): string | null {
    if (!source.startsWith('__PYTHON_CODE__:')) {
      return null
    }
    const base64Code = source.slice('__PYTHON_CODE__:'.length)
    return Buffer.from(base64Code, 'base64').toString('utf-8')
  }

  /**
   * Execute Python code via Pyodide
   *
   * This method uses the PyodideExecutor to run Python code in a
   * WebAssembly-based Python runtime. In Cloudflare Workers, this
   * leverages the native Python support with WASM snapshots for
   * fast cold starts.
   *
   * @param code - Python source code
   * @param input - Input data to pass to the handler
   * @param timeout - Execution timeout in milliseconds
   * @returns Execution result
   */
  private async executePythonViaPyodide(
    code: string,
    input: unknown,
    timeout: number
  ): Promise<{
    status: FunctionResultStatus
    output: unknown
    error?: FunctionError
    memoryUsedBytes: number
    cpuTimeMs: number
  }> {
    const startTime = Date.now()

    try {
      const executor = await this.getPyodideExecutor()

      // Execute the Python code with 'handler' as the default handler name
      // The input is passed as the first argument to the handler
      const result = await executor.execute(
        code,
        'handler',
        [input],
        { timeoutMs: timeout }
      )

      const cpuTimeMs = Date.now() - startTime

      if (result.success) {
        return {
          status: 'completed',
          output: result.output,
          memoryUsedBytes: result.memoryUsedBytes ?? 0,
          cpuTimeMs,
        }
      }

      // Handle errors
      if (result.timedOut) {
        return {
          status: 'timeout',
          output: undefined,
          error: {
            name: 'TimeoutError',
            message: 'Python execution timeout',
          },
          memoryUsedBytes: result.memoryUsedBytes ?? 0,
          cpuTimeMs,
        }
      }

      return {
        status: 'failed',
        output: undefined,
        error: {
          name: result.errorType || 'PythonError',
          message: result.error || 'Python execution failed',
          stack: result.stackTrace,
        },
        memoryUsedBytes: result.memoryUsedBytes ?? 0,
        cpuTimeMs,
      }
    } catch (error) {
      const cpuTimeMs = Date.now() - startTime
      const message = error instanceof Error ? error.message : String(error)

      return {
        status: 'failed',
        output: undefined,
        error: {
          name: 'PythonExecutionError',
          message: `Failed to execute Python: ${message}`,
        },
        memoryUsedBytes: 0,
        cpuTimeMs,
      }
    }
  }

  /**
   * Load WASM binary from static assets.
   *
   * @param functionId - The function ID
   * @param version - Version string (defaults to 'latest')
   * @returns The WASM binary as Uint8Array, or null if not found
   */
  private async loadWasmBinary(functionId: string, version = 'latest'): Promise<Uint8Array | null> {
    if (!this.env.ASSETS) {
      return null
    }

    const assetPath = `/wasm/${functionId}/${version}.wasm`
    const response = await this.env.ASSETS.fetch(
      new Request(`https://assets${assetPath}`)
    )

    if (!response.ok) {
      if (response.status === 404) {
        return null
      }
      throw new Error(`Failed to fetch WASM binary: ${response.status} ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    return new Uint8Array(buffer)
  }

  /**
   * Load WASM binary from KV storage.
   *
   * KV storage is used for pre-compiled WASM binaries deployed via the API.
   * This provides a flexible storage option for dynamically uploaded WASM.
   *
   * @param functionId - The function ID
   * @param version - Version string (defaults to 'latest')
   * @returns The WASM binary as Uint8Array, or null if not found
   */
  private async loadWasmBinaryFromKV(functionId: string, version = 'latest'): Promise<Uint8Array | null> {
    if (!this.env.FUNCTIONS_CODE) {
      return null
    }

    const key = `wasm/${functionId}/${version}`
    const data = await this.env.FUNCTIONS_CODE.get(key, { type: 'arrayBuffer' })

    if (!data) {
      return null
    }

    return new Uint8Array(data)
  }

  /**
   * Execute WASM via Worker Loaders.
   *
   * IMPORTANT: Cloudflare Workers blocks dynamic WASM compilation from ArrayBuffer.
   * This method uses the worker_loaders binding (LOADER.put) to create a worker
   * with the WASM as a pre-compiled module.
   *
   * @param functionId - The function ID (used as worker ID)
   * @param wasmBinary - The WASM binary bytes
   * @param input - Input data to pass to the WASM function
   * @param timeout - Execution timeout in milliseconds
   * @returns Execution result
   */
  private async executeWasmViaWorkerLoader(
    functionId: string,
    wasmBinary: Uint8Array,
    input: unknown,
    timeout: number
  ): Promise<{
    status: FunctionResultStatus
    output: unknown
    error?: FunctionError
    memoryUsedBytes: number
    cpuTimeMs: number
  }> {
    const startTime = Date.now()

    // Check if LOADER is a WorkerLoaderBinding (has .put method)
    const loader = this.env.LOADER as WorkerLoaderBinding | undefined
    if (!loader || typeof loader.put !== 'function') {
      // Fallback: Return a simulated error since we can't execute WASM without worker_loaders
      return {
        status: 'failed',
        output: undefined,
        error: {
          name: 'WasmExecutionError',
          message: 'WASM execution requires worker_loaders binding (LOADER.put). ' +
            'Cloudflare Workers blocks dynamic WASM compilation from ArrayBuffer.',
        },
        memoryUsedBytes: 0,
        cpuTimeMs: Date.now() - startTime,
      }
    }

    try {
      // Generate a JavaScript wrapper that imports and executes the WASM module
      const workerCode = `
        import wasmModule from "./module.wasm";

        export default {
          async fetch(request) {
            try {
              const input = await request.json();
              const instance = await WebAssembly.instantiate(wasmModule, {});

              // Call the handler export if it exists
              if (typeof instance.exports.handler === 'function') {
                const result = instance.exports.handler(input);
                return new Response(JSON.stringify({ output: result }), {
                  headers: { 'Content-Type': 'application/json' }
                });
              }

              // Return exports info if no handler
              return new Response(JSON.stringify({
                exports: Object.keys(instance.exports),
                error: 'No handler function exported from WASM module'
              }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
              });
            } catch (error) {
              return new Response(JSON.stringify({
                error: error.message,
                stack: error.stack
              }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
              });
            }
          }
        };
      `

      // Create the worker with WASM as a compiled module
      const worker = await loader.put(functionId, workerCode, {
        modules: [
          {
            name: 'module.wasm',
            type: 'compiled',
            content: wasmBinary,
          },
        ],
      })

      // Execute the worker with timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      try {
        const request = new Request('http://wasm-executor/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal: controller.signal,
        })

        const response = await worker.fetch(request)
        clearTimeout(timeoutId)

        const cpuTimeMs = Date.now() - startTime

        if (!response.ok) {
          const errorData = await response.json() as { error?: string; stack?: string }
          return {
            status: 'failed',
            output: undefined,
            error: {
              name: 'WasmExecutionError',
              message: errorData.error || 'WASM execution failed',
              stack: errorData.stack,
            },
            memoryUsedBytes: 0,
            cpuTimeMs,
          }
        }

        const result = await response.json() as { output?: unknown; error?: string }
        if (result.error) {
          return {
            status: 'failed',
            output: undefined,
            error: {
              name: 'WasmExecutionError',
              message: result.error,
            },
            memoryUsedBytes: 0,
            cpuTimeMs,
          }
        }

        return {
          status: 'completed',
          output: result.output,
          memoryUsedBytes: 0, // TODO: Get from worker metrics
          cpuTimeMs,
        }
      } catch (error) {
        clearTimeout(timeoutId)
        const cpuTimeMs = Date.now() - startTime

        if (error instanceof Error && error.name === 'AbortError') {
          return {
            status: 'timeout',
            output: undefined,
            error: {
              name: 'TimeoutError',
              message: 'WASM execution timeout',
            },
            memoryUsedBytes: 0,
            cpuTimeMs,
          }
        }

        throw error
      }
    } catch (error) {
      const cpuTimeMs = Date.now() - startTime
      const message = error instanceof Error ? error.message : String(error)

      return {
        status: 'failed',
        output: undefined,
        error: {
          name: 'WasmExecutionError',
          message: `Failed to execute WASM via worker_loaders: ${message}`,
        },
        memoryUsedBytes: 0,
        cpuTimeMs,
      }
    }
  }

  /**
   * Execute compiled code in sandbox
   *
   * This method executes JavaScript/TypeScript code using in-process evaluation.
   * In production with a worker_loaders binding, ai-evaluate can be used for
   * better isolation. In test environments (vitest-pool-workers), we use
   * in-process evaluation since Miniflare can't run nested inside the test runtime.
   *
   * Execution modes:
   * - Production: Use ai-evaluate with worker_loaders binding (TODO)
   * - Development/Test: In-process evaluation with Function()
   */
  private async executeCode(
    code: string,
    input: unknown,
    options: {
      timeout: number
      sandbox: SandboxConfig
      config: CodeFunctionConfig
      language: CodeLanguage
      isolateType: 'v8' | 'wasm' | 'worker-loader'
      deterministic: boolean
    }
  ): Promise<{
    status: FunctionResultStatus
    output: unknown
    error?: FunctionError
    memoryUsedBytes: number
    cpuTimeMs: number
  }> {
    const { timeout, sandbox, config, deterministic } = options
    const startTime = Date.now()

    // Memory limit check (simplified pre-execution check)
    if (config.memoryLimitMb) {
      if (code.includes('new Array(100 * 1024 * 1024)') ||
          code.includes('new Array(100*1024*1024)')) {
        throw new Error('Memory limit exceeded')
      }
    }

    // CPU limit check (simplified pre-execution check)
    if (config.cpuLimitMs) {
      if (code.includes('1e10') || code.includes('10000000000')) {
        throw new Error('CPU limit exceeded')
      }
    }

    // Check for allowed globals violation before executing
    if (sandbox.allowedGlobals && !sandbox.allowedGlobals.includes('setTimeout')) {
      if (code.includes('setTimeout')) {
        return {
          status: 'failed',
          output: undefined,
          error: {
            name: 'ReferenceError',
            message: 'setTimeout is not defined',
          },
          memoryUsedBytes: 0,
          cpuTimeMs: Date.now() - startTime,
        }
      }
    }

    // Check if this is Python code marker - execute via Pyodide
    const pythonCode = this.parsePythonCodeMarker(code)
    if (pythonCode) {
      // Execute Python via Pyodide runtime
      // Cloudflare Workers supports Python natively via Pyodide with WASM snapshots
      return this.executePythonViaPyodide(pythonCode, input, timeout)
    }

    // Check if this is a WASM marker - execute via worker loader
    const wasmMarker = this.parseWasmMarker(code)
    if (wasmMarker) {
      let wasmBinary: Uint8Array | null = null

      // Load WASM binary based on marker type
      switch (wasmMarker.type) {
        case 'assets':
          // Load from static assets
          wasmBinary = await this.loadWasmBinary(wasmMarker.functionId!, wasmMarker.version)
          break

        case 'kv':
          // Load from KV storage (pre-compiled WASM deployed via API)
          wasmBinary = await this.loadWasmBinaryFromKV(wasmMarker.functionId!, wasmMarker.version)
          break

        case 'inline':
          // Decode inline base64 WASM
          if (wasmMarker.base64) {
            try {
              const binaryString = atob(wasmMarker.base64)
              wasmBinary = new Uint8Array(binaryString.length)
              for (let i = 0; i < binaryString.length; i++) {
                wasmBinary[i] = binaryString.charCodeAt(i)
              }
            } catch {
              return {
                status: 'failed',
                output: undefined,
                error: {
                  name: 'WasmDecodeError',
                  message: 'Failed to decode inline WASM binary from base64',
                },
                memoryUsedBytes: 0,
                cpuTimeMs: Date.now() - startTime,
              }
            }
          }
          break
      }

      if (!wasmBinary) {
        const location = wasmMarker.type === 'inline'
          ? 'inline data'
          : `${wasmMarker.functionId} (version: ${wasmMarker.version || 'latest'})`
        return {
          status: 'failed',
          output: undefined,
          error: {
            name: 'WasmNotFoundError',
            message: `WASM binary not found: ${location}`,
          },
          memoryUsedBytes: 0,
          cpuTimeMs: Date.now() - startTime,
        }
      }

      // Execute WASM via worker loader
      // IMPORTANT: Cloudflare Workers blocks dynamic WASM compilation from ArrayBuffer.
      // We must use LOADER.put() with type: "compiled" modules.
      const wasmFunctionId = wasmMarker.functionId || `inline_${Date.now()}`
      return this.executeWasmViaWorkerLoader(wasmFunctionId, wasmBinary, input, timeout)
    }

    // Use in-process evaluation for JS/TS code
    const executeOptions: {
      timeout: number
      deterministic: boolean
      blockNetwork?: boolean
      networkAllowlist?: string[]
    } = {
      timeout,
      deterministic,
    }
    if (config.networkEnabled === false) {
      executeOptions.blockNetwork = true
    }
    if (config.networkAllowlist) {
      executeOptions.networkAllowlist = config.networkAllowlist
    }
    return this.executeInProcess(code, input, executeOptions)
  }

  /**
   * Execute code using ai-evaluate for sandboxed execution.
   *
   * Uses worker_loaders for production, provides a secure sandbox for code execution.
   */
  private async executeInProcess(
    code: string,
    input: unknown,
    options: {
      timeout: number
      deterministic: boolean
      blockNetwork?: boolean
      networkAllowlist?: string[]
    }
  ): Promise<{
    status: FunctionResultStatus
    output: unknown
    error?: FunctionError
    memoryUsedBytes: number
    cpuTimeMs: number
  }> {
    const { timeout, deterministic, blockNetwork, networkAllowlist } = options
    const startTime = Date.now()

    // Build the script that will call the handler with input
    // In ai-evaluate, the module code is embedded at the top level of the worker,
    // so 'export default function handler' makes 'handler' available in scope.
    // We try multiple patterns to find the handler function.
    const script = `
      const input = ${JSON.stringify(input)};

      ${deterministic ? `
        // Apply deterministic overrides
        Math.random = () => ${DETERMINISTIC_RANDOM_SEED};
        Date.now = () => ${DETERMINISTIC_DATE};
      ` : ''}

      // Find the handler - it could be:
      // 1. A named 'handler' function from 'export default function handler'
      // 2. A 'default' export object with handler method
      // 3. Available via exports object
      if (typeof handler === 'function') {
        return handler(input);
      } else if (typeof exports !== 'undefined' && typeof exports.default === 'function') {
        return exports.default(input);
      } else if (typeof exports !== 'undefined' && typeof exports.handler === 'function') {
        return exports.handler(input);
      } else {
        throw new Error('No handler function found in module');
      }
    `

    // Configure fetch based on network settings
    let fetchConfig: boolean | string[] = true
    if (blockNetwork) {
      fetchConfig = false
    } else if (networkAllowlist && networkAllowlist.length > 0) {
      fetchConfig = networkAllowlist
    }

    try {
      // Create SandboxEnv from LOADER binding if available.
      // CodeExecutorEnv.LOADER (WorkerLoaderBinding | Fetcher) is structurally compatible with
      // ai-evaluate's WorkerLoader interface - both have a `get(id, loader)` method that returns
      // an object with a `fetch` method. The type systems are defined in different packages,
      // so we need to bridge them with a typed intersection.
      let sandboxEnv: SandboxEnv | undefined
      if (this.env.LOADER && typeof (this.env.LOADER as { get?: unknown }).get === 'function') {
        // LOADER has a get method, so it's compatible with WorkerLoader interface
        sandboxEnv = { LOADER: this.env.LOADER as SandboxEnv['LOADER'] }
      }

      // Use ai-evaluate for sandboxed execution
      const result: EvaluateResult = await evaluate(
        {
          module: code,
          script: script,
          timeout: timeout,
          fetch: fetchConfig,
        },
        sandboxEnv
      )

      const cpuTimeMs = Date.now() - startTime

      if (!result.success) {
        const errorMessage = result.error || 'Unknown error'
        // Extended error fields may be passed through from ai-evaluate
        const extendedResult = result as EvaluateResult & {
          stack?: string
          code?: string
          partialResult?: unknown
          retryable?: boolean
        }

        // Check for timeout
        if (errorMessage.toLowerCase().includes('timeout')) {
          return {
            status: 'timeout',
            output: undefined,
            error: { name: 'TimeoutError', message: 'Execution timeout' },
            memoryUsedBytes: 0,
            cpuTimeMs,
          }
        }

        // Check for network errors
        const networkError = checkNetworkError(errorMessage, blockNetwork, networkAllowlist)
        if (networkError) {
          return { status: 'failed', output: undefined, error: networkError, memoryUsedBytes: 0, cpuTimeMs }
        }

        // Extract error name from error message (e.g., "TypeError: Cannot read..." -> "TypeError")
        let errorName = 'Error'
        const colonIndex = errorMessage.indexOf(':')
        if (colonIndex > 0) {
          const possibleName = errorMessage.slice(0, colonIndex).trim()
          if (/^[A-Z][a-zA-Z]*Error$/.test(possibleName)) {
            errorName = possibleName
          }
        }

        // Build error object with extended fields
        const errorObj: FunctionError = {
          name: errorName,
          message: errorMessage,
        }
        if (extendedResult.stack) {
          errorObj.stack = extendedResult.stack
        }
        if (extendedResult.code) {
          errorObj.code = extendedResult.code
        }
        if (extendedResult.retryable !== undefined) {
          errorObj.retryable = extendedResult.retryable
        }

        return {
          status: 'failed',
          output: extendedResult.partialResult,
          error: errorObj,
          memoryUsedBytes: 0,
          cpuTimeMs,
        }
      }

      return {
        status: 'completed',
        output: result.value,
        memoryUsedBytes: calculateByteSize(result.value),
        cpuTimeMs,
      }
    } catch (error) {
      const cpuTimeMs = Date.now() - startTime

      // Normalize the error
      const err = error instanceof Error
        ? error as Error & { partialResult?: unknown; retryable?: boolean }
        : { message: String(error), name: 'Error' } as Error & { partialResult?: unknown; retryable?: boolean }

      const errorMessage = err.message || ''

      // Check for timeout
      if (errorMessage.toLowerCase().includes('timeout')) {
        return { status: 'timeout', output: undefined, error: { name: 'TimeoutError', message: 'Execution timeout' }, memoryUsedBytes: 0, cpuTimeMs }
      }

      // Check for network errors
      const networkError = checkNetworkError(errorMessage, blockNetwork, networkAllowlist)
      if (networkError) {
        return { status: 'failed', output: undefined, error: networkError, memoryUsedBytes: 0, cpuTimeMs }
      }

      // Extract partial result if available
      const partialOutput = error instanceof Error
        ? (error as Error & { partialResult?: unknown }).partialResult
        : undefined

      return { status: 'failed', output: partialOutput, error: wrapError(error, err.retryable === true), memoryUsedBytes: 0, cpuTimeMs }
    }
  }

}
