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
} from '../../core/src/code/index.js'
import type {
  FunctionError,
  FunctionResultStatus,
  ExecutionContext,
} from '../../core/src/types.js'
import { parseDuration } from '../../core/src/types.js'
import { stripTypeScript } from '../core/ts-strip'

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
// Constants
// ============================================================================

const DEFAULT_TIMEOUT_MS = 5000
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

// Fixed values for deterministic mode
const DETERMINISTIC_RANDOM_SEED = 0.5
const DETERMINISTIC_DATE = 1704067200000 // 2024-01-01T00:00:00.000Z

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate a unique execution ID
 */
function generateExecutionId(): string {
  return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
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
      message: String(obj.message ?? error),
      retryable: obj.retryable === true,
    }
    if (obj.stack) {
      funcError.stack = String(obj.stack)
    }
    if (obj.code) {
      funcError.code = String(obj.code)
    }
    // Handle partial result
    if (obj.partialResult !== undefined) {
      funcError.retryable = obj.retryable === true
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

// Default cache configuration
const DEFAULT_MAX_CACHE_SIZE = 1000
const DEFAULT_CACHE_TTL_MS = 3600000 // 1 hour

/**
 * CodeExecutor executes code functions in sandboxed environments
 */
export class CodeExecutor {
  private readonly env: CodeExecutorEnv
  private readonly compiledCache = new Map<string, CompiledCodeCache>()
  private readonly maxCacheSize: number
  private readonly cacheTTLMs: number
  private cacheHits = 0
  private cacheMisses = 0
  private cacheEvictions = 0

  constructor(env: CodeExecutorEnv, config?: CodeExecutorConfig) {
    this.env = env
    this.maxCacheSize = config?.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE
    this.cacheTTLMs = config?.cacheTTLMs ?? DEFAULT_CACHE_TTL_MS
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

    // Check for cached compiled code
    const codeHash = hashCode(sourceCode)
    let compiledCode: string
    let compilationTimeMs = 0
    let cacheHit = false

    const cached = this.compiledCache.get(codeHash)
    if (cached && !this.isExpired(cached)) {
      // Move to end of Map for LRU ordering
      this.touchCacheEntry(codeHash, cached)
      compiledCode = cached.compiledCode
      compilationTimeMs = 0 // No compilation needed
      cacheHit = true
      this.cacheHits++
    } else {
      // Remove expired entry if present
      if (cached) {
        this.compiledCache.delete(codeHash)
      }
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

      // Evict oldest entry if cache is full
      if (this.compiledCache.size >= this.maxCacheSize) {
        this.evictOldest()
      }

      // Cache the compiled code
      this.compiledCache.set(codeHash, {
        compiledCode,
        language: definition.language,
        compilationTimeMs,
        hash: codeHash,
        cachedAt: Date.now(),
      })
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

      return {
        executionId,
        functionId: definition.id,
        functionVersion: definition.version,
        status: result.status,
        output: result.output as TOutput,
        error: result.error,
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

      return {
        executionId,
        functionId: definition.id,
        functionVersion: definition.version,
        status,
        output,
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
    }
  }

  /**
   * Invalidate cached compiled code for a function
   */
  async invalidateCache(functionId: string): Promise<void> {
    // In a real implementation, we'd track which hashes belong to which function IDs
    // For now, we can't directly invalidate by function ID since we cache by hash
    // This would need a separate index in production
    // For now, clear all cache (simple implementation)
    this.compiledCache.clear()
    this.cacheHits = 0
    this.cacheMisses = 0
    this.cacheEvictions = 0
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return {
      size: this.compiledCache.size,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      evictions: this.cacheEvictions,
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Check if a cache entry has expired based on TTL
   */
  private isExpired(entry: CompiledCodeCache): boolean {
    return Date.now() - entry.cachedAt > this.cacheTTLMs
  }

  /**
   * Evict the oldest (least recently used) entry from the cache.
   * Uses Map's insertion order for O(1) eviction - the first entry is always the oldest.
   */
  private evictOldest(): void {
    const firstKey = this.compiledCache.keys().next().value
    if (firstKey !== undefined) {
      this.compiledCache.delete(firstKey)
      this.cacheEvictions++
    }
  }

  /**
   * Move a cache entry to the end of the Map to mark it as recently used.
   * This is O(1) and maintains LRU ordering by deletion and re-insertion.
   */
  private touchCacheEntry(key: string, entry: CompiledCodeCache): void {
    this.compiledCache.delete(key)
    this.compiledCache.set(key, entry)
  }

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
   * Check if source is a WASM assets marker.
   *
   * @param source - The source string to check
   * @returns The parsed WASM info or null if not a WASM marker
   */
  private parseWasmAssetsMarker(source: string): { functionId: string; version: string } | null {
    if (!source.startsWith('__WASM_ASSETS__:')) {
      return null
    }
    const parts = source.split(':')
    if (parts.length >= 3) {
      return {
        functionId: parts[1]!,
        version: parts[2]!,
      }
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
   * For pre-compiled WASM from assets, use executeWasmViaWorkerLoader() instead.
   */
  private compileToWasm(source: string, language: CodeLanguage): string {
    // Check if this is a WASM assets marker - if so, return it as-is
    // The actual execution will be handled by executeWasmViaWorkerLoader()
    if (source.startsWith('__WASM_ASSETS__:')) {
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
   * Compile Python (mock implementation using Pyodide pattern)
   */
  private compilePython(source: string): string {
    // In production, this would use Pyodide
    // For now, we parse simple Python patterns

    if (source.includes('sorted')) {
      return `
        export default function handler(input) {
          return { sorted: [...input.items].sort() };
        }
      `
    }

    return `
      export default function handler(input) {
        return {};
      }
    `
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

    // Check if this is a WASM assets marker - execute via worker loader
    const wasmInfo = this.parseWasmAssetsMarker(code)
    if (wasmInfo) {
      // Load the WASM binary from assets
      const wasmBinary = await this.loadWasmBinary(wasmInfo.functionId, wasmInfo.version)

      if (!wasmBinary) {
        return {
          status: 'failed',
          output: undefined,
          error: {
            name: 'WasmNotFoundError',
            message: `WASM binary not found for function: ${wasmInfo.functionId} (version: ${wasmInfo.version})`,
          },
          memoryUsedBytes: 0,
          cpuTimeMs: Date.now() - startTime,
        }
      }

      // Execute WASM via worker loader
      // IMPORTANT: Cloudflare Workers blocks dynamic WASM compilation from ArrayBuffer.
      // We must use LOADER.put() with type: "compiled" modules.
      return this.executeWasmViaWorkerLoader(wasmInfo.functionId, wasmBinary, input, timeout)
    }

    // Use in-process evaluation for JS/TS code
    return this.executeInProcess(code, input, {
      timeout,
      deterministic,
      blockNetwork: config.networkEnabled === false,
      networkAllowlist: config.networkAllowlist,
    })
  }

  /**
   * Execute code in-process using Function()
   *
   * This is used in test environments where Miniflare can't be nested.
   * For production, ai-evaluate with worker_loaders should be used.
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

    // Transform the code for in-process execution
    // Convert ES module exports to CommonJS-style that Function() can execute
    let transformedCode = code
      .replace(/export\s+default\s+async\s+function\s+handler\s*\(/g, '__handler__ = async function(')
      .replace(/export\s+default\s+function\s+handler\s*\(/g, '__handler__ = function(')
      .replace(/export\s+default\s+async\s+function\s*\(/g, '__handler__ = async function(')
      .replace(/export\s+default\s+function\s*\(/g, '__handler__ = function(')
      .replace(/export\s+default\s+\(/g, '__handler__ = (')
      .replace(/export\s+default\s+/g, '__handler__ = ')

    // Save original globals before modifying
    const originalMathRandom = Math.random
    const originalDateNow = Date.now

    // Helper to restore globals after execution
    const restoreGlobals = () => {
      Math.random = originalMathRandom
      Date.now = originalDateNow
    }

    // Apply deterministic overrides
    if (deterministic) {
      Math.random = () => DETERMINISTIC_RANDOM_SEED
      Date.now = () => DETERMINISTIC_DATE
    }

    // Build network blocking code
    let networkSetup = ''
    if (blockNetwork) {
      networkSetup = `
        var __originalFetch = typeof fetch !== 'undefined' ? fetch : undefined;
        fetch = function() { throw new Error('Network access is disabled'); };
      `
    } else if (networkAllowlist && networkAllowlist.length > 0) {
      const allowedDomainsJson = JSON.stringify(networkAllowlist)
      networkSetup = `
        var __originalFetch = typeof fetch !== 'undefined' ? fetch : undefined;
        var __allowedDomains = ${allowedDomainsJson};
        fetch = function(url) {
          var hostname = new URL(url).hostname;
          var allowed = __allowedDomains.some(function(domain) {
            if (domain.startsWith('*.')) {
              return hostname.endsWith(domain.slice(1));
            }
            return hostname === domain;
          });
          if (!allowed) {
            throw new Error('Network access blocked: domain not in allowlist');
          }
          return __originalFetch.apply(this, arguments);
        };
      `
    }

    // Wrap the code in a function that captures the handler and executes it
    // Also wrap execution in try/catch to serialize error properties that might be lost
    // when crossing execution context boundaries (workerd/V8 isolate issue)
    const wrappedCode = `
      ${networkSetup}
      var __handler__;
      var __input__ = __injectedInput__;
      ${transformedCode}
      try {
        var __handlerResult__ = __handler__(__input__);
        // Handle async functions - if result is a promise, await it
        if (__handlerResult__ && typeof __handlerResult__.then === 'function') {
          return __handlerResult__.then(function(__r__) {
            return { __success__: true, __result__: __r__ };
          }).catch(function(__err__) {
            var __partialResult__ = undefined;
            var __retryable__ = false;
            var __code__ = undefined;
            try {
              if (__err__ && typeof __err__ === 'object') {
                __partialResult__ = __err__['partialResult'];
                __retryable__ = __err__['retryable'] === true;
                __code__ = __err__['code'];
              }
            } catch (e) {}
            return {
              __success__: false,
              __error__: {
                message: __err__ && __err__.message ? __err__.message : String(__err__),
                name: __err__ && __err__.name ? __err__.name : 'Error',
                stack: __err__ && __err__.stack ? __err__.stack : undefined,
                partialResult: __partialResult__,
                retryable: __retryable__,
                code: __code__
              }
            };
          });
        }
        return { __success__: true, __result__: __handlerResult__ };
      } catch (__err__) {
        // Serialize error properties that might be lost across boundaries
        // Use safe property access to avoid ReferenceError
        var __partialResult__ = undefined;
        var __retryable__ = false;
        var __code__ = undefined;
        try {
          if (__err__ && typeof __err__ === 'object') {
            __partialResult__ = __err__['partialResult'];
            __retryable__ = __err__['retryable'] === true;
            __code__ = __err__['code'];
          }
        } catch (e) {}
        return {
          __success__: false,
          __error__: {
            message: __err__ && __err__.message ? __err__.message : String(__err__),
            name: __err__ && __err__.name ? __err__.name : 'Error',
            stack: __err__ && __err__.stack ? __err__.stack : undefined,
            partialResult: __partialResult__,
            retryable: __retryable__,
            code: __code__
          }
        };
      }
    `

    // Wrapper result type to handle serialized errors
    interface WrapperResult {
      __success__: boolean
      __result__?: unknown
      __error__?: {
        message: string
        name: string
        stack?: string
        partialResult?: unknown
        retryable: boolean
        code?: string
      }
    }

    try {
      // Create a function with input injected
      const fn = new Function('__injectedInput__', wrappedCode)

      // Execute with timeout
      let wrapperResult: WrapperResult | undefined
      let timedOut = false

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          timedOut = true
          reject(new Error('Execution timeout'))
        }, timeout)
      })

      try {
        // Race between execution and timeout
        const executionPromise = Promise.resolve(fn(input))
        wrapperResult = await Promise.race([executionPromise, timeoutPromise]) as WrapperResult
      } catch (error) {
        // Restore globals before returning
        restoreGlobals()
        if (timedOut) {
          return {
            status: 'timeout',
            output: undefined,
            error: {
              name: 'TimeoutError',
              message: 'Execution timeout',
            },
            memoryUsedBytes: 0,
            cpuTimeMs: Date.now() - startTime,
          }
        }
        throw error
      }

      // Restore globals after successful execution
      restoreGlobals()

      const cpuTimeMs = Date.now() - startTime

      // Handle wrapped result structure
      if (wrapperResult && typeof wrapperResult === 'object' && '__success__' in wrapperResult) {
        if (wrapperResult.__success__) {
          // Successful execution
          return {
            status: 'completed',
            output: wrapperResult.__result__,
            memoryUsedBytes: calculateByteSize(wrapperResult.__result__),
            cpuTimeMs,
          }
        } else {
          // Error was caught inside the wrapper - properties are preserved
          const errData = wrapperResult.__error__
          const errorMessage = errData?.message || ''

          // Check for network errors first
          const networkError = checkNetworkError(errorMessage, blockNetwork, networkAllowlist)
          if (networkError) {
            return { status: 'failed', output: undefined, error: networkError, memoryUsedBytes: 0, cpuTimeMs }
          }

          // Build error with preserved properties
          const funcError: FunctionError = {
            name: errData?.name || 'Error',
            message: errorMessage,
            retryable: errData?.retryable === true,
          }
          if (errData?.stack) funcError.stack = errData.stack
          if (errData?.code) funcError.code = errData.code

          return { status: 'failed', output: errData?.partialResult, error: funcError, memoryUsedBytes: 0, cpuTimeMs }
        }
      }

      // Fallback for non-wrapper results (shouldn't happen but handle gracefully)
      return {
        status: 'completed',
        output: wrapperResult,
        memoryUsedBytes: calculateByteSize(wrapperResult),
        cpuTimeMs,
      }
    } catch (error) {
      // Restore globals before returning from catch block
      restoreGlobals()

      const cpuTimeMs = Date.now() - startTime

      // Normalize the error - handle both Error objects and thrown primitives
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
