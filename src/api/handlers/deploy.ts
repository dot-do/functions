/**
 * Deploy Handler for Functions.do
 *
 * Handles function deployment including validation, compilation, and storage.
 * Uses Cloudflare Workers KV for metadata and code storage.
 *
 * Supported languages:
 * - TypeScript/JavaScript: Compiled with esbuild-wasm at deploy time
 * - Rust, Go, Zig, AssemblyScript: Accept pre-compiled WASM binaries OR compile from source
 *
 * ## TypeScript Compilation
 *
 * TypeScript code is compiled to JavaScript at deploy time using the
 * esbuild-compiler service binding. This provides:
 * - Full TypeScript support (enums, decorators, namespaces)
 * - Source map generation for debugging
 * - Zero runtime compilation overhead
 *
 * Design reference: docs/ESBUILD_WASM_DESIGN.md
 *
 * For WASM languages, two deployment modes are supported:
 * 1. **Pre-compiled WASM (Recommended)**: Upload a compiled .wasm binary
 *    - Set `language: "rust"` (or other WASM language)
 *    - Set `wasmBinary: "<base64-encoded .wasm file>"`
 *    - The `code` field can optionally contain the source for reference
 *
 * 2. **Source compilation**: Provide source code for server-side compilation
 *    - Set `language: "rust"` and `code: "<rust source>"`
 *    - Requires compiler availability (limited in production)
 *
 * @module handlers/deploy
 */

import type { RouteContext, Env, Handler } from '../router'
import { compileTypeScript } from '../../core/ts-compiler'

/**
 * Extended route context for deploy handler.
 * Currently empty as deploy uses request body for all data.
 */
export interface DeployHandlerContext extends RouteContext {}

import { KVFunctionRegistry } from '../../core/kv-function-registry'
import { KVCodeStorage } from '../../core/code-storage'
import {
  validateFunctionId,
  validateLanguage,
  validateEntryPoint,
  validateDependencies,
} from '../../core/function-registry'
import { isValidVersion, type FunctionMetadata } from '../../core/types'
import { jsonResponse } from '../http-utils'

/**
 * Result from WASM compilation.
 */
type CompileResult = { wasm: Uint8Array; exports?: string[] }

/**
 * Function type for WASM compilers.
 */
type CompileFunction = (code: string) => Promise<CompileResult>

/**
 * Function type for pre-compiled WASM validation.
 */
type AcceptPrecompiledFn = (binary: Uint8Array) => Promise<CompileResult>

/**
 * Function type for WASM binary validation.
 */
type ValidateWasmFn = (binary: Uint8Array) => { valid: boolean; error?: string; exports?: string[] }

/**
 * WASM languages that support pre-compiled binary upload
 */
const WASM_LANGUAGES = ['rust', 'go', 'zig', 'assemblyscript'] as const
type WasmLanguage = (typeof WASM_LANGUAGES)[number]

/**
 * Check if a language is a WASM language
 */
function isWasmLanguage(language: string): language is WasmLanguage {
  return WASM_LANGUAGES.includes(language as WasmLanguage)
}

// WASM compilers are dynamically imported to avoid issues with Node.js modules in Workers
let compileRust: CompileFunction | null = null
let compileGo: CompileFunction | null = null
let compileZig: CompileFunction | null = null
let compileAssemblyScript: CompileFunction | null = null

// WASM validation functions (always available)
let acceptPrecompiledWasm: AcceptPrecompiledFn | null = null
let validateWasmBinary: ValidateWasmFn | null = null

/**
 * Dynamically load WASM compilers and validation utilities.
 *
 * Compilers are loaded on-demand to avoid bundling issues in Worker environments.
 * Failures are silently ignored; the deploy handler will return an error if a
 * required compiler is not available.
 *
 * WASM validation utilities (acceptPrecompiledWasm, validateWasmBinary) are
 * always loaded as they don't have external dependencies.
 */
async function loadCompilers(): Promise<void> {
  // Always load WASM validation utilities (no external deps)
  try {
    const rustModule = await import('../../languages/rust/compile')
    compileRust = rustModule.compileRust
    acceptPrecompiledWasm = rustModule.acceptPrecompiledWasm
    validateWasmBinary = rustModule.validateWasmBinary
  } catch {
    // Rust compiler not available, but try to get validation functions
    try {
      const { acceptPrecompiledWasm: accept, validateWasmBinary: validate } =
        await import('../../languages/rust/compile')
      acceptPrecompiledWasm = accept
      validateWasmBinary = validate
    } catch {
      // Validation also not available
    }
  }
  try {
    const goModule = await import('../../languages/go/compile')
    compileGo = goModule.compileGo
  } catch {
    // Go compiler not available
  }
  try {
    const zigModule = await import('../../languages/zig/compile')
    compileZig = zigModule.compileZig
  } catch {
    // Zig compiler not available
  }
  try {
    const asModule = await import('../../languages/assemblyscript/compile')
    compileAssemblyScript = asModule.compileAssemblyScript
  } catch {
    // AssemblyScript compiler not available
  }
}

/**
 * Upload code to Cloudflare dispatch namespace via API.
 *
 * This enables Workers for Platforms execution of deployed functions.
 *
 * @param code - The JavaScript/TypeScript code to upload
 * @param scriptName - The name for the worker script (usually the function ID)
 * @param env - Environment with Cloudflare credentials and namespace config
 * @returns Success status and optional error message
 */
async function uploadToDispatchNamespace(
  code: string,
  scriptName: string,
  env: Pick<Env, 'CLOUDFLARE_ACCOUNT_ID' | 'CLOUDFLARE_API_TOKEN' | 'DISPATCH_NAMESPACE'>
): Promise<{ success: boolean; error?: string }> {
  const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, DISPATCH_NAMESPACE } = env

  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN || !DISPATCH_NAMESPACE) {
    return { success: false, error: 'Dispatch upload not configured' }
  }

  const wrappedCode = code.includes('export default')
    ? code
    : `export default { fetch(request) { return new Response('Function not properly formatted'); } }`

  const formData = new FormData()
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
        headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
        body: formData,
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ errors: [{ message: 'Unknown error' }] }))
      const errorMessage =
        (errorData as { errors?: Array<{ message: string }> }).errors?.[0]?.message || `HTTP ${response.status}`
      return { success: false, error: `Failed to upload: ${errorMessage}` }
    }

    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: `Upload failed: ${message}` }
  }
}

/**
 * Deploy handler - validates, compiles, and stores function code and metadata.
 *
 * Workflow:
 * 1. Parse and validate request body (id, version, language, code)
 * 2. Validate function ID format, semantic version, language support
 * 3. Compile code if needed (WASM for Rust/Go/Zig/AssemblyScript)
 * 4. Store code in KV (versioned and latest)
 * 5. Store metadata in registry (versioned and latest)
 * 6. Upload to dispatch namespace for TS/JS functions
 *
 * @param request - The incoming HTTP request with JSON deployment payload
 * @param env - Environment bindings (KV namespaces, Cloudflare credentials)
 * @param ctx - Execution context
 * @param context - Route context (unused for deploy)
 * @returns JSON response with deployment result including function URL
 *
 * @example
 * // POST /api/functions
 * // Body: { "id": "my-fn", "version": "1.0.0", "language": "typescript", "code": "..." }
 * // Response: { "id": "my-fn", "version": "1.0.0", "url": "https://.../functions/my-fn" }
 */
export const deployHandler: Handler = async (
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  _context?: RouteContext
): Promise<Response> => {
  // Parse request body
  let body: {
    id?: string
    version?: string
    language?: string
    code?: string
    entryPoint?: string
    dependencies?: Record<string, string>
    /** Base64-encoded pre-compiled WASM binary (for Rust/Go/Zig/AssemblyScript) */
    wasmBinary?: string
  }

  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { id, version, language, code, entryPoint, dependencies, wasmBinary } = body

  // Validate required fields
  if (!id) {
    return jsonResponse({ error: 'Missing required field: id' }, 400)
  }
  if (!version) {
    return jsonResponse({ error: 'Missing required field: version' }, 400)
  }
  if (!language) {
    return jsonResponse({ error: 'Missing required field: language' }, 400)
  }

  // For WASM languages, either wasmBinary OR code is required
  // For other languages, code is always required
  const hasWasmBinary = wasmBinary && wasmBinary.length > 0
  const hasCode = code && code.length > 0

  if (isWasmLanguage(language)) {
    if (!hasWasmBinary && !hasCode) {
      return jsonResponse({
        error: `Missing required field for ${language}: provide either 'wasmBinary' (base64-encoded .wasm) or 'code' (source)`,
      }, 400)
    }
  } else {
    if (!hasCode) {
      return jsonResponse({ error: 'Missing required field: code' }, 400)
    }
  }

  // Validate function ID
  try {
    validateFunctionId(id)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid function ID'
    return jsonResponse({ error: message }, 400)
  }

  // Validate version
  if (!isValidVersion(version)) {
    return jsonResponse({ error: `Invalid semantic version: ${version}` }, 400)
  }

  // Validate language
  try {
    validateLanguage(language)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid language'
    return jsonResponse({ error: message }, 400)
  }

  // Validate entry point if provided
  const resolvedEntryPoint = entryPoint || (language === 'typescript' || language === 'javascript' ? 'index.ts' : 'main')
  try {
    validateEntryPoint(resolvedEntryPoint)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid entry point'
    return jsonResponse({ error: message }, 400)
  }

  // Validate dependencies if provided
  try {
    validateDependencies(dependencies)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid dependencies'
    return jsonResponse({ error: message }, 400)
  }

  // Load compilers if not already loaded
  await loadCompilers()

  // Track extracted exports from WASM (for metadata)
  let wasmExports: string[] | undefined

  // Track TypeScript compilation results
  let tsCompileResult: {
    success: boolean
    compiledJs?: string
    sourceMap?: string
    warnings?: string[]
    compiler?: string
  } | undefined

  // Compile code based on language
  let compiledCode: string | Uint8Array
  try {
    switch (language) {
      case 'typescript': {
        // Compile TypeScript to JavaScript using esbuild-wasm at deploy time
        // This enables full TypeScript support (enums, decorators, namespaces)
        const result = await compileTypeScript(code!, env.ESBUILD_COMPILER, {
          loader: resolvedEntryPoint.endsWith('.tsx') ? 'tsx' : 'ts',
          sourcemap: true,
        })

        if (!result.success) {
          return jsonResponse({
            error: 'TypeScript compilation failed',
            errors: result.errors,
            warnings: result.warnings,
          }, 400)
        }

        // Store source as the main code
        compiledCode = code!
        // Track compilation results for storage
        tsCompileResult = {
          success: true,
          compiledJs: result.code,
          compiler: result.compiler,
        }
        if (result.map) {
          tsCompileResult.sourceMap = result.map
        }
        if (result.warnings.length > 0) {
          tsCompileResult.warnings = result.warnings
        }
        break
      }

      case 'javascript':
        // JavaScript is stored directly (no compilation needed)
        compiledCode = code!
        break

      case 'rust':
      case 'go':
      case 'zig':
      case 'assemblyscript': {
        // Check if pre-compiled WASM binary is provided
        if (hasWasmBinary) {
          // Decode base64 to binary
          let wasmBytes: Uint8Array
          try {
            const binaryString = atob(wasmBinary!)
            wasmBytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
              wasmBytes[i] = binaryString.charCodeAt(i)
            }
          } catch {
            return jsonResponse({ error: 'Invalid wasmBinary: must be valid base64-encoded data' }, 400)
          }

          // Validate the WASM binary
          if (!validateWasmBinary) {
            return jsonResponse({ error: 'WASM validation not available' }, 500)
          }

          const validation = validateWasmBinary(wasmBytes)
          if (!validation.valid) {
            return jsonResponse({ error: `Invalid WASM binary: ${validation.error}` }, 400)
          }

          // Store exports for metadata
          wasmExports = validation.exports

          // Use the validated binary directly
          compiledCode = wasmBytes
        } else {
          // Fall back to source compilation
          let compiler: CompileFunction | null = null
          let compilerName = ''

          switch (language) {
            case 'rust':
              compiler = compileRust
              compilerName = 'Rust'
              break
            case 'go':
              compiler = compileGo
              compilerName = 'Go'
              break
            case 'zig':
              compiler = compileZig
              compilerName = 'Zig'
              break
            case 'assemblyscript':
              compiler = compileAssemblyScript
              compilerName = 'AssemblyScript'
              break
          }

          if (!compiler) {
            return jsonResponse({
              error: `${compilerName} compiler not available. Please provide a pre-compiled WASM binary via 'wasmBinary' field.`,
              hint: `Compile your ${language} code locally and upload the .wasm file as base64-encoded 'wasmBinary'`,
            }, 400)
          }

          const result = await compiler(code!)
          compiledCode = result.wasm
          wasmExports = result.exports
        }
        break
      }

      default:
        return jsonResponse({ error: `Compilation not supported for language: ${language}` }, 400)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Compilation failed'
    return jsonResponse({ error: message }, 400)
  }

  // Create storage instances
  const registry = new KVFunctionRegistry(env.FUNCTIONS_REGISTRY)
  const codeStorage = new KVCodeStorage(env.FUNCTIONS_CODE)

  // Store code
  if (compiledCode instanceof Uint8Array) {
    // Store WASM binary using dedicated WASM storage methods
    // This stores the binary with proper metadata (exports, language)
    const wasmOptions: { exports?: string[]; language?: string } = { language }
    if (wasmExports) {
      wasmOptions.exports = wasmExports
    }
    await codeStorage.putWasmBinary(id, compiledCode, version, wasmOptions)
    await codeStorage.putWasmBinary(id, compiledCode, undefined, wasmOptions)

    // Also store source code if provided (for reference/debugging)
    if (hasCode) {
      await codeStorage.put(id, code!, version)
      await codeStorage.put(id, code!)
    }
  } else {
    // Store source code
    await codeStorage.put(id, compiledCode, version)
    await codeStorage.put(id, compiledCode)

    // For TypeScript, also store the compiled JavaScript and source map
    if (tsCompileResult?.success && tsCompileResult.compiledJs) {
      // Store compiled JS for fast runtime execution (no compilation overhead)
      await codeStorage.putCompiled(id, tsCompileResult.compiledJs, version)
      await codeStorage.putCompiled(id, tsCompileResult.compiledJs)

      // Store source map for debugging
      if (tsCompileResult.sourceMap) {
        await codeStorage.putSourceMap(id, tsCompileResult.sourceMap, version)
        await codeStorage.putSourceMap(id, tsCompileResult.sourceMap)
      }
    }
  }

  // Store metadata
  const metadata: FunctionMetadata = {
    id,
    version,
    language: language as FunctionMetadata['language'],
    entryPoint: resolvedEntryPoint,
    dependencies: dependencies || {},
  }
  await registry.put(metadata)
  await registry.putVersion(id, version, metadata)

  // Upload to dispatch namespace for TS/JS (use compiled JS if available)
  let dispatchUploadResult: { success: boolean; error?: string } = { success: true }
  if ((language === 'typescript' || language === 'javascript') && typeof compiledCode === 'string') {
    // For TypeScript, upload the compiled JavaScript to dispatch namespace
    const codeToUpload = tsCompileResult?.compiledJs || compiledCode
    dispatchUploadResult = await uploadToDispatchNamespace(codeToUpload, id, env)
  }

  // Return success response
  const baseUrl = new URL(request.url).origin
  const response: {
    id: string
    version: string
    url: string
    dispatchUpload: string
    wasmExports?: string[]
    wasmSize?: number
    compilation?: {
      compiler: string
      warnings?: string[]
      hasSourceMap: boolean
    }
  } = {
    id,
    version,
    url: `${baseUrl}/functions/${id}`,
    dispatchUpload: dispatchUploadResult.success
      ? 'success'
      : dispatchUploadResult.error || 'Dispatch upload not configured',
  }

  // Include WASM-specific metadata in response
  if (isWasmLanguage(language) && compiledCode instanceof Uint8Array) {
    if (wasmExports) {
      response.wasmExports = wasmExports
    }
    response.wasmSize = compiledCode.length
  }

  // Include TypeScript compilation metadata in response
  if (tsCompileResult?.success) {
    const compilation: { compiler: string; warnings?: string[]; hasSourceMap: boolean } = {
      compiler: tsCompileResult.compiler || 'unknown',
      hasSourceMap: !!tsCompileResult.sourceMap,
    }
    if (tsCompileResult.warnings && tsCompileResult.warnings.length > 0) {
      compilation.warnings = tsCompileResult.warnings
    }
    response.compilation = compilation
  }

  return jsonResponse(response)
}
