/**
 * Rust to WASM Compiler
 *
 * STATUS: NOT YET SUPPORTED
 *
 * Rust compilation to WASM is planned but not yet implemented.
 * The previous implementation was a fake regex-based compiler that
 * pattern-matched simple Rust expressions and returned hardcoded WASM
 * bytecode. This produced silently wrong results for any real code.
 *
 * When real Rust compilation support is added, it will require:
 * - A real Rust toolchain (rustc/wasm-pack) accessible via API
 * - Proper cross-compilation to wasm32-unknown-unknown target
 * - Actual LLVM-based code generation
 *
 * Currently supported languages: TypeScript, JavaScript, Python (beta)
 */

/**
 * Options for Rust compilation
 */
export interface CompileRustOptions {
  useWasmBindgen?: boolean
  optimizationLevel?: 0 | 1 | 2 | 3
  debug?: boolean
  generateCapnwebBindings?: boolean
  generateTypeScript?: boolean
}

/**
 * Parsed parameter information
 */
export interface ParsedParam {
  name: string
  type: string
}

/**
 * Function signature information for binding generation
 */
export interface FunctionSignature {
  name: string
  params: ParsedParam[]
  returnType: string | null
  isAsync: boolean
}

/**
 * capnweb stub binding definition
 */
export interface CapnwebBinding {
  name: string
  methodId: number
  params: Array<{
    name: string
    type: string
    wasmType: number
    offset: number
  }>
  returnType: {
    type: string
    wasmType: number
  } | null
}

/**
 * Result of Rust compilation
 */
export interface CompileRustResult {
  wasm: Uint8Array
  exports: string[]
  compiledAt: string
  wasmSize: number
  metadata?: {
    optimizationLevel?: number
    wasmBindgen?: boolean
    sourceSize?: number
  }
  capnwebBindings?: CapnwebBinding[]
  typeScript?: string
  signatures?: FunctionSignature[]
}

const NOT_SUPPORTED_MESSAGE =
  'Rust compilation is not yet supported. ' +
  'The previous implementation was a fake regex-based compiler that produced incorrect results. ' +
  'Supported languages: TypeScript, JavaScript, Python (beta)'

/**
 * Compile Rust source code to WebAssembly
 *
 * @throws Error - Always throws because Rust compilation is not yet supported
 */
export async function compileRust(_code: string, _options?: CompileRustOptions): Promise<CompileRustResult> {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Generate capnweb stub bindings from function signatures
 *
 * @throws Error - Always throws because Rust compilation is not yet supported
 */
export function generateCapnwebBindings(_signatures: FunctionSignature[]): CapnwebBinding[] {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Generate TypeScript type definitions from function signatures
 *
 * @throws Error - Always throws because Rust compilation is not yet supported
 */
export function generateTypeScriptTypes(_signatures: FunctionSignature[], _moduleName?: string): string {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Generate wasm-bindgen integration helper code
 *
 * @throws Error - Always throws because Rust compilation is not yet supported
 */
export function generateWasmBindgenHelpers(_signatures: FunctionSignature[]): string {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}
