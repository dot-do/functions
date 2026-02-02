/**
 * Go to WASM Compiler
 *
 * STATUS: NOT YET SUPPORTED
 *
 * Go compilation to WASM is planned but not yet implemented.
 * The previous implementation was a fake compiler that:
 * - Used child_process (cannot run in Cloudflare Workers)
 * - Fell back to regex-based Go parsing that generated hardcoded WASM bytecode
 * - Produced silently wrong results for any real Go code
 *
 * When real Go compilation support is added, it will require:
 * - A real TinyGo toolchain accessible via API
 * - Proper WASI target compilation
 * - Actual Go compiler backend
 *
 * Currently supported languages: TypeScript, JavaScript, Python (beta)
 */

// ============================================================================
// Types (preserved for API compatibility)
// ============================================================================

export interface CompileResult {
  wasm: Uint8Array
  exports: string[]
  typescriptTypes?: string
  capnwebBindings?: string
  metadata?: CompileMetadata
}

export interface CompileMetadata {
  wasmSize: number
  compiledAt: string
  usedTinyGo: boolean
  tinyGoVersion?: string
  optimizationLevel?: string
}

export interface CompileOptions {
  generateTypes?: boolean
  generateBindings?: boolean
  optimizationLevel?: 's' | 'z' | '0' | '1' | '2'
  targetSize?: number
  debug?: boolean
}

export interface FunctionSignature {
  name: string
  params: Array<{ name: string; type: string }>
  returnType: string | null
  doc?: string
}

const NOT_SUPPORTED_MESSAGE =
  'Go compilation is not yet supported. ' +
  'The previous implementation was a fake compiler that used child_process (incompatible with Workers) ' +
  'and fell back to regex-based parsing that produced incorrect results. ' +
  'Supported languages: TypeScript, JavaScript, Python (beta)'

/**
 * Compile Go code to WebAssembly
 *
 * @throws Error - Always throws because Go compilation is not yet supported
 */
export async function compileGo(
  _code: string,
  _options?: CompileOptions
): Promise<CompileResult> {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Parse Go code to extract exported function signatures from go:wasmexport directives
 *
 * @throws Error - Always throws because Go compilation is not yet supported
 */
export function parseGoExports(_code: string): FunctionSignature[] {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Parse Go struct definitions for complex type mapping
 *
 * @throws Error - Always throws because Go compilation is not yet supported
 */
export function parseGoStructs(_code: string): Map<string, Array<{ name: string; type: string }>> {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Generate TypeScript type definitions from Go function signatures
 *
 * @throws Error - Always throws because Go compilation is not yet supported
 */
export function generateTypeScriptTypes(
  _signatures: FunctionSignature[],
  _moduleName?: string
): string {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Generate capnweb RPC bindings from Go function signatures
 *
 * @throws Error - Always throws because Go compilation is not yet supported
 */
export function generateCapnwebBindings(
  _signatures: FunctionSignature[],
  _moduleName?: string
): string {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Generate go:wasmexport directive for a function signature
 *
 * @throws Error - Always throws because Go compilation is not yet supported
 */
export function generateWasmExportDirective(
  _funcName: string,
  _exportName?: string
): string {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Wrap existing Go function with go:wasmexport directive
 *
 * @throws Error - Always throws because Go compilation is not yet supported
 */
export function wrapWithWasmExport(
  _goCode: string,
  _funcName: string,
  _exportName?: string
): string {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Generate a complete Go function with go:wasmexport
 *
 * @throws Error - Always throws because Go compilation is not yet supported
 */
export function generateGoExportedFunction(_sig: FunctionSignature): string {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * SDK template file contents
 */
export interface SDKTemplateFiles {
  'go.mod': string
  'main.go': string
  'Makefile': string
  'README.md': string
  'types.d.ts'?: string
  'bindings.ts'?: string
}

/**
 * Generate SDK template files for a Go function
 *
 * @throws Error - Always throws because Go compilation is not yet supported
 */
export function generateSDKTemplate(
  _moduleName: string,
  _signatures: FunctionSignature[]
): SDKTemplateFiles {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}
