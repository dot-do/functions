/**
 * esbuild-compiler Worker
 *
 * A Cloudflare Worker that uses esbuild-wasm to compile TypeScript/TSX to JavaScript.
 * Exposes an RPC interface for TypeScript compilation via Service Bindings.
 *
 * ## Architecture
 *
 * This worker is designed to be called via Service Bindings from other workers
 * in the functions.do ecosystem. It uses esbuild-wasm for full TypeScript support
 * including:
 * - Type stripping (interfaces, type aliases, generics)
 * - Enum compilation
 * - Decorator transformation
 * - JSX/TSX compilation
 * - Namespace compilation
 *
 * ## Performance Characteristics
 *
 * - Bundle size: ~13MB (esbuild.wasm)
 * - Cold start: ~580ms (includes WASM loading)
 * - Warm transform: <1ms per transform
 * - Initialization: Once per worker instance (cached in module scope)
 *
 * ## Usage via Service Binding
 *
 * ```typescript
 * // In your wrangler.toml:
 * // [[services]]
 * // binding = "ESBUILD_COMPILER"
 * // service = "esbuild-compiler"
 *
 * const result = await env.ESBUILD_COMPILER.transform({
 *   code: 'const x: number = 1',
 *   loader: 'ts',
 * })
 * ```
 *
 * See: docs/ESBUILD_WASM_DESIGN.md for full design specification
 *
 * @module workers/esbuild-compiler
 */

import * as esbuild from 'esbuild-wasm'

/**
 * Cloudflare Workers supports WebAssembly.compile() for dynamic WASM compilation,
 * but @cloudflare/workers-types does not include it in the WebAssembly namespace.
 * This augmentation adds the compile method to the global WebAssembly type.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/webassembly/
 */
declare global {
  namespace WebAssembly {
    function compile(bytes: ArrayBuffer): Promise<WebAssembly.Module>
  }
}

/**
 * WebAssembly.compile is available in Workers but not fully typed in @cloudflare/workers-types.
 * Use this wrapper for type safety.
 */
const compileWasm = (bytes: ArrayBuffer): Promise<WebAssembly.Module> =>
  WebAssembly.compile(bytes)

// Re-export types for consumers
export type {
  Loader,
  OutputFormat,
  JsxOptions,
  TransformOptions,
  TransformResult,
  EsbuildCompiler,
  CompilerMetrics,
  Env,
} from './types'

import type {
  TransformOptions,
  TransformResult,
  EsbuildCompiler,
  Env,
} from './types'

/**
 * Module-level initialization state.
 * These variables persist across requests within the same worker instance,
 * ensuring esbuild is only initialized once per cold start.
 */
let initialized = false
let initPromise: Promise<void> | null = null
let cachedWasmModule: WebAssembly.Module | null = null

/**
 * Metrics for monitoring initialization and transform performance.
 * Reset on worker cold start.
 */
const metrics = {
  initCount: 0,
  initTimeMs: 0,
  transformCount: 0,
  totalTransformTimeMs: 0,
  errorCount: 0,
}

/**
 * Initialize esbuild-wasm with optimized caching.
 *
 * This function implements several optimizations:
 * 1. Module-level caching: Only initializes once per worker instance
 * 2. WASM module caching: Compiles WASM once and reuses
 * 3. Promise deduplication: Concurrent calls share the same init promise
 *
 * @param env - Environment bindings including optional ASSETS binding
 * @throws Error if initialization fails (network error, invalid WASM, etc.)
 */
async function initializeEsbuild(env: Env): Promise<void> {
  // Fast path: already initialized
  if (initialized) return

  // Deduplication: return existing promise if initialization is in progress
  if (initPromise) return initPromise

  const startTime = Date.now()

  initPromise = (async () => {
    try {
      // Try to use cached WASM module first
      let wasmModule = cachedWasmModule

      // If not cached, try to load from assets
      if (!wasmModule && env.ASSETS) {
        try {
          const wasmResponse = await env.ASSETS.fetch(
            new Request('https://placeholder/esbuild.wasm')
          )
          if (wasmResponse.ok) {
            const wasmBuffer = await wasmResponse.arrayBuffer()
            wasmModule = await compileWasm(wasmBuffer)
            // Cache for future use (survives across requests in same instance)
            cachedWasmModule = wasmModule
          }
        } catch {
          // ASSETS fetch failed, will try default initialization
          // This is expected in local dev or when assets not configured
        }
      }

      // Initialize esbuild with the WASM module
      const initOptions: esbuild.InitializeOptions = {
        worker: false, // Don't use web worker in Cloudflare Workers environment
      }

      if (wasmModule) {
        initOptions.wasmModule = wasmModule
      }

      await esbuild.initialize(initOptions)
      initialized = true

      // Record metrics
      metrics.initCount++
      metrics.initTimeMs = Date.now() - startTime
    } catch (error) {
      // Reset state on failure to allow retry
      initPromise = null
      metrics.errorCount++
      throw error
    }
  })()

  return initPromise
}

/**
 * Default TypeScript compiler options for Cloudflare Workers compatibility.
 * These settings ensure proper compilation of modern TypeScript features.
 */
const DEFAULT_TSCONFIG = JSON.stringify({
  compilerOptions: {
    experimentalDecorators: true,
    useDefineForClassFields: true,
  },
})

/**
 * Format an esbuild message (error or warning) into a human-readable string.
 *
 * @param msg - esbuild message object
 * @returns Formatted message string with optional location info
 */
function formatMessage(msg: esbuild.Message): string {
  if (msg.location) {
    const { file, line, column } = msg.location
    return `${file || 'input'}:${line}:${column}: ${msg.text}`
  }
  return msg.text
}

/**
 * Build esbuild transform options from our simplified TransformOptions.
 *
 * @param options - Input transform options
 * @returns esbuild.TransformOptions ready for transform call
 */
function buildTransformOptions(options: TransformOptions): esbuild.TransformOptions {
  const transformOptions: esbuild.TransformOptions = {
    loader: options.loader,
    target: options.target || 'esnext',
    format: options.format || 'esm',
    sourcemap: options.sourcemap ? 'external' : false,
    tsconfigRaw: DEFAULT_TSCONFIG,
  }

  // Add JSX options if provided
  if (options.jsx) {
    transformOptions.jsx = 'transform'
    if (options.jsx.factory) {
      transformOptions.jsxFactory = options.jsx.factory
    }
    if (options.jsx.fragment) {
      transformOptions.jsxFragment = options.jsx.fragment
    }
  } else if (options.loader === 'tsx' || options.loader === 'jsx') {
    // Default JSX settings for React
    transformOptions.jsx = 'transform'
    transformOptions.jsxFactory = 'React.createElement'
    transformOptions.jsxFragment = 'React.Fragment'
  }

  return transformOptions
}

/**
 * Transform TypeScript/TSX code to JavaScript using esbuild.
 *
 * This is the core compilation function that handles:
 * - Empty code detection (returns early to avoid unnecessary processing)
 * - Lazy initialization of esbuild-wasm
 * - Full TypeScript compilation (not just type stripping)
 * - JSX/TSX transformation with configurable pragma
 * - Source map generation
 * - Detailed error reporting with line/column information
 *
 * @param options - Transform options including code, loader, and configuration
 * @param env - Environment bindings for WASM loading
 * @returns Transform result with compiled code, warnings, and optional errors
 */
async function transform(
  options: TransformOptions,
  env: Env
): Promise<TransformResult> {
  const startTime = Date.now()

  // Handle empty code gracefully - no need to initialize esbuild
  if (!options.code || options.code.trim() === '') {
    return {
      code: '',
      warnings: [],
    }
  }

  // Ensure esbuild is initialized (cached after first call)
  await initializeEsbuild(env)

  try {
    const transformOptions = buildTransformOptions(options)
    const result = await esbuild.transform(options.code, transformOptions)

    // Update metrics
    metrics.transformCount++
    metrics.totalTransformTimeMs += Date.now() - startTime

    return {
      code: result.code,
      map: options.sourcemap ? result.map : undefined,
      warnings: result.warnings.map(formatMessage),
    }
  } catch (error) {
    metrics.errorCount++

    // Handle esbuild-specific errors with detailed location info
    if (error && typeof error === 'object' && 'errors' in error) {
      const esbuildError = error as esbuild.TransformFailure
      return {
        code: '',
        warnings: esbuildError.warnings.map(formatMessage),
        errors: esbuildError.errors.map(formatMessage),
      }
    }

    // Generic error fallback
    return {
      code: '',
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}

/**
 * Worker class that implements the RPC interface.
 *
 * This class is the main export for Cloudflare Workers Service Bindings.
 * It wraps the transform function and provides a clean RPC interface.
 *
 * @example
 * ```typescript
 * // In another worker with service binding:
 * const result = await env.ESBUILD_COMPILER.transform({
 *   code: 'const x: number = 1',
 *   loader: 'ts',
 * })
 * ```
 */
export class EsbuildCompilerWorker implements EsbuildCompiler {
  private readonly env: Env

  constructor(env: Env) {
    this.env = env
  }

  /**
   * Transform TypeScript/TSX code to JavaScript.
   *
   * @param options - Transform options
   * @returns Transform result with compiled code
   */
  async transform(options: TransformOptions): Promise<TransformResult> {
    return transform(options, this.env)
  }
}

/**
 * Helper to create JSON responses with proper headers.
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Validate transform request options.
 *
 * @param options - Options to validate
 * @returns Error message or null if valid
 */
function validateTransformOptions(options: unknown): string | null {
  if (!options || typeof options !== 'object') {
    return 'Request body must be a JSON object'
  }

  const opts = options as Record<string, unknown>

  if (opts.code === undefined) {
    return 'Missing required field: code'
  }

  if (typeof opts.code !== 'string') {
    return 'Field "code" must be a string'
  }

  if (!opts.loader) {
    return 'Missing required field: loader'
  }

  const validLoaders = ['ts', 'tsx', 'js', 'jsx']
  if (!validLoaders.includes(opts.loader as string)) {
    return `Invalid loader: ${opts.loader}. Must be one of: ${validLoaders.join(', ')}`
  }

  if (opts.format !== undefined) {
    const validFormats = ['esm', 'cjs', 'iife']
    if (!validFormats.includes(opts.format as string)) {
      return `Invalid format: ${opts.format}. Must be one of: ${validFormats.join(', ')}`
    }
  }

  return null
}

/**
 * API documentation object for the root endpoint.
 */
const API_DOCS = {
  name: 'esbuild-compiler',
  version: '0.1.0',
  description: 'TypeScript/TSX to JavaScript compiler using esbuild-wasm',
  endpoints: {
    'GET /': 'API documentation (this page)',
    'GET /health': 'Health check with metrics',
    'GET /metrics': 'Detailed performance metrics',
    'POST /transform': 'Transform TypeScript/TSX to JavaScript',
  },
  transformOptions: {
    code: 'string (required) - Source code to transform',
    loader: "'ts' | 'tsx' | 'js' | 'jsx' (required) - Source file type",
    target: "string (optional, default: 'esnext') - JavaScript target version",
    format: "'esm' | 'cjs' | 'iife' (optional, default: 'esm') - Output format",
    jsx: {
      factory: "string (optional, default: 'React.createElement') - JSX factory function",
      fragment: "string (optional, default: 'React.Fragment') - JSX fragment component",
    },
    sourcemap: 'boolean (optional, default: false) - Generate source map',
  },
  examples: {
    basicTransform: {
      request: {
        method: 'POST',
        url: '/transform',
        body: {
          code: 'const x: number = 1',
          loader: 'ts',
        },
      },
      response: {
        code: 'const x = 1;\n',
        warnings: [],
      },
    },
  },
}

/**
 * Default worker export with fetch handler and RPC support.
 *
 * This export provides two interfaces:
 * 1. HTTP API: Direct REST access via fetch handler
 * 2. RPC: Service Binding access via transform method
 *
 * The HTTP API is useful for testing and direct access,
 * while RPC is preferred for worker-to-worker communication.
 */
export default {
  /**
   * HTTP fetch handler for direct API access.
   *
   * Endpoints:
   * - GET /: API documentation
   * - GET /health: Health check with initialization status
   * - GET /metrics: Performance metrics
   * - POST /transform: Transform TypeScript/TSX to JavaScript
   */
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // Health check endpoint with basic status
    if (path === '/health') {
      return jsonResponse({
        status: 'ok',
        worker: 'esbuild-compiler',
        initialized,
        version: '0.1.0',
      })
    }

    // Detailed metrics endpoint
    if (path === '/metrics') {
      return jsonResponse({
        status: 'ok',
        initialized,
        metrics: {
          ...metrics,
          avgTransformTimeMs: metrics.transformCount > 0
            ? Math.round(metrics.totalTransformTimeMs / metrics.transformCount * 100) / 100
            : 0,
        },
      })
    }

    // Transform endpoint (POST /transform)
    if (path === '/transform' && request.method === 'POST') {
      try {
        const options = await request.json()

        // Validate request
        const validationError = validateTransformOptions(options)
        if (validationError) {
          return jsonResponse({ error: validationError }, 400)
        }

        const result = await transform(options as TransformOptions, env)
        return jsonResponse(result)
      } catch (error) {
        if (error instanceof SyntaxError) {
          return jsonResponse({ error: 'Invalid JSON in request body' }, 400)
        }
        return jsonResponse({
          error: error instanceof Error ? error.message : String(error),
        }, 500)
      }
    }

    // Method not allowed for transform endpoint
    if (path === '/transform' && request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed. Use POST.' }, 405)
    }

    // API documentation (root endpoint)
    if (path === '/' || path === '/api') {
      return jsonResponse(API_DOCS)
    }

    return jsonResponse({ error: 'Not found' }, 404)
  },

  /**
   * RPC method exposed via Service Bindings.
   *
   * This is the preferred method for worker-to-worker communication.
   * Other workers can call: env.ESBUILD_COMPILER.transform(options)
   *
   * @param options - Transform options
   * @param env - Environment bindings
   * @returns Transform result
   */
  async transform(
    options: TransformOptions,
    env: Env
  ): Promise<TransformResult> {
    return transform(options, env)
  },
}
