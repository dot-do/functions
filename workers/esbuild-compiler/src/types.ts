/**
 * esbuild-compiler Worker Types
 *
 * Public type definitions for the esbuild-compiler worker.
 * These types define the RPC interface that other workers can use
 * when calling this worker via Service Bindings.
 *
 * ## Type Usage
 *
 * Import these types in your worker to get proper TypeScript support:
 *
 * ```typescript
 * import type { EsbuildCompiler, TransformOptions, TransformResult } from '@dotdo/esbuild-compiler'
 * ```
 *
 * @module workers/esbuild-compiler/types
 */

/**
 * Supported source file loader types.
 *
 * - 'ts': TypeScript files (.ts)
 * - 'tsx': TypeScript with JSX (.tsx)
 * - 'js': JavaScript files (.js)
 * - 'jsx': JavaScript with JSX (.jsx)
 */
export type Loader = 'ts' | 'tsx' | 'js' | 'jsx'

/**
 * Supported output format types.
 *
 * - 'esm': ECMAScript modules (default, recommended for Workers)
 * - 'cjs': CommonJS modules
 * - 'iife': Immediately Invoked Function Expression
 */
export type OutputFormat = 'esm' | 'cjs' | 'iife'

/**
 * JSX transform configuration options.
 */
export interface JsxOptions {
  /**
   * JSX factory function name.
   * @default 'React.createElement'
   * @example 'h' for Preact
   * @example 'jsx' for automatic JSX runtime
   */
  factory?: string
  /**
   * JSX fragment component name.
   * @default 'React.Fragment'
   * @example 'Fragment' for Preact
   */
  fragment?: string
}

/**
 * Transform options for the RPC interface.
 *
 * @example Basic TypeScript transform
 * ```typescript
 * const options: TransformOptions = {
 *   code: 'const x: number = 1',
 *   loader: 'ts',
 * }
 * ```
 *
 * @example TSX with custom JSX pragma
 * ```typescript
 * const options: TransformOptions = {
 *   code: 'const App = () => <div>Hello</div>',
 *   loader: 'tsx',
 *   jsx: { factory: 'h', fragment: 'Fragment' },
 * }
 * ```
 */
export interface TransformOptions {
  /**
   * TypeScript/TSX/JS/JSX source code to transform.
   * Empty strings are handled gracefully and return empty output.
   */
  code: string

  /**
   * Source file loader type.
   * This determines how esbuild parses and transforms the code.
   */
  loader: Loader

  /**
   * JavaScript target version.
   * Controls which syntax features are downleveled.
   * @default 'esnext'
   * @example 'es2020', 'es2017', 'es2015'
   */
  target?: string

  /**
   * Output module format.
   * ESM is recommended for Cloudflare Workers.
   * @default 'esm'
   */
  format?: OutputFormat

  /**
   * JSX transform configuration.
   * If not provided and loader is 'tsx' or 'jsx',
   * defaults to React.createElement/React.Fragment.
   */
  jsx?: JsxOptions

  /**
   * Generate external source map.
   * When true, the result will include a 'map' field.
   * @default false
   */
  sourcemap?: boolean
}

/**
 * Transform result from the compilation.
 *
 * On success: 'code' contains compiled JavaScript, 'errors' is undefined.
 * On failure: 'code' is empty string, 'errors' contains error messages.
 */
export interface TransformResult {
  /**
   * Compiled JavaScript code.
   * Empty string if compilation failed.
   */
  code: string

  /**
   * Source map JSON string.
   * Only present if sourcemap option was true and compilation succeeded.
   */
  map?: string

  /**
   * Compilation warnings.
   * Warnings don't prevent compilation but may indicate issues.
   * Format: "file:line:column: message" or just "message"
   */
  warnings: string[]

  /**
   * Compilation errors.
   * Only present if compilation failed.
   * Format: "file:line:column: message" or just "message"
   */
  errors?: string[]
}

/**
 * RPC interface for the esbuild-compiler worker.
 *
 * This interface is exposed via Cloudflare Service Bindings and is the
 * recommended way for other workers to call the compiler.
 *
 * ## Setup
 *
 * Add the service binding to your wrangler.toml:
 *
 * ```toml
 * [[services]]
 * binding = "ESBUILD_COMPILER"
 * service = "esbuild-compiler"
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * interface Env {
 *   ESBUILD_COMPILER: EsbuildCompiler
 * }
 *
 * export default {
 *   async fetch(request: Request, env: Env): Promise<Response> {
 *     const result = await env.ESBUILD_COMPILER.transform({
 *       code: 'const x: number = 1',
 *       loader: 'ts',
 *     })
 *
 *     if (result.errors && result.errors.length > 0) {
 *       return new Response(`Compilation failed: ${result.errors.join('\n')}`, {
 *         status: 400,
 *       })
 *     }
 *
 *     return new Response(result.code, {
 *       headers: { 'Content-Type': 'application/javascript' },
 *     })
 *   }
 * }
 * ```
 *
 * ## Performance Notes
 *
 * - First call to transform() initializes esbuild-wasm (~580ms cold start)
 * - Subsequent calls are very fast (<1ms)
 * - Initialization is cached per worker instance
 * - Consider pre-warming the compiler if cold start latency is critical
 */
export interface EsbuildCompiler {
  /**
   * Transform TypeScript/TSX/JS/JSX code to JavaScript.
   *
   * @param options - Transform configuration
   * @returns Compilation result with code, warnings, and optional errors
   */
  transform(options: TransformOptions): Promise<TransformResult>
}

/**
 * Performance metrics exposed by the compiler.
 * Available via the GET /metrics endpoint.
 */
export interface CompilerMetrics {
  /** Number of times esbuild was initialized (should be 1 per instance) */
  initCount: number
  /** Time taken for last initialization in milliseconds */
  initTimeMs: number
  /** Total number of transform calls */
  transformCount: number
  /** Total time spent in transforms in milliseconds */
  totalTransformTimeMs: number
  /** Average transform time in milliseconds */
  avgTransformTimeMs: number
  /** Total number of errors encountered */
  errorCount: number
}

/**
 * Cloudflare Worker environment bindings for the esbuild-compiler worker.
 */
export interface Env {
  /**
   * Static assets binding for loading esbuild.wasm.
   *
   * The WASM file should be placed at ./assets/esbuild.wasm
   * and configured in wrangler.toml:
   *
   * ```toml
   * [assets]
   * directory = "./assets"
   * binding = "ASSETS"
   * ```
   *
   * If ASSETS is not available, the worker will attempt to load
   * esbuild.wasm from the bundled module (requires proper wrangler config).
   */
  ASSETS?: Fetcher
}
