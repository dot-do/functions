/**
 * AssemblyScript to WASM Compiler
 *
 * STATUS: NOT YET SUPPORTED
 *
 * AssemblyScript compilation to WASM is planned but not yet implemented.
 * The previous implementation was a fake compiler that regex-parsed
 * AssemblyScript source code and generated hardcoded WASM bytecode.
 * This produced silently wrong results for any real AssemblyScript code.
 *
 * When real AssemblyScript compilation support is added, it will require:
 * - The actual AssemblyScript compiler (asc)
 * - Proper WASM code generation via Binaryen
 * - Real type checking and optimization
 *
 * Currently supported languages: TypeScript, JavaScript, Python (beta)
 */

// ============================================================================
// Types (preserved for API compatibility)
// ============================================================================

export interface CompileOptions {
  optimize?: boolean
  debug?: boolean
  generateTypes?: boolean
  generateBindings?: boolean
  moduleName?: string
}

export interface CompileResult {
  wasm: Uint8Array
  exports: string[]
  wasmSize: number
  compiledAt: Date
  typescriptTypes?: string
  capnwebBindings?: string
  signatures?: FunctionSignature[]
}

export interface FunctionSignature {
  name: string
  params: { name: string; type: string; tsType: string }[]
  returnType: string
  tsReturnType: string
}

const NOT_SUPPORTED_MESSAGE =
  'AssemblyScript compilation is not yet supported. ' +
  'The previous implementation was a fake regex-based compiler that produced incorrect results. ' +
  'Supported languages: TypeScript, JavaScript, Python (beta)'

/**
 * Compiles AssemblyScript code to WebAssembly
 *
 * @throws Error - Always throws because AssemblyScript compilation is not yet supported
 */
export async function compileAssemblyScript(_code: string, _options?: CompileOptions): Promise<CompileResult> {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Generate TypeScript type definitions from AssemblyScript function signatures
 *
 * @throws Error - Always throws because AssemblyScript compilation is not yet supported
 */
export function generateTypeScriptTypes(_signatures: FunctionSignature[], _moduleName?: string): string {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Generate capnweb RPC bindings from AssemblyScript function signatures
 *
 * @throws Error - Always throws because AssemblyScript compilation is not yet supported
 */
export function generateCapnwebBindings(_signatures: FunctionSignature[], _moduleName?: string): string {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}
