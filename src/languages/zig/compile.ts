/**
 * Zig to WASM Compiler
 *
 * STATUS: NOT YET SUPPORTED
 *
 * Zig compilation to WASM is planned but not yet implemented.
 * The previous implementation was a fake compiler that regex-parsed
 * Zig source code and generated hardcoded WASM bytecode. This produced
 * silently wrong results for any real Zig code.
 *
 * When real Zig compilation support is added, it will require:
 * - A real Zig toolchain accessible via API
 * - Proper wasm32-freestanding target compilation
 * - Actual LLVM-based code generation
 *
 * Currently supported languages: TypeScript, JavaScript, Python (beta)
 */

// ============================================================================
// Types (preserved for API compatibility)
// ============================================================================

export interface ParsedParam {
  name: string
  type: string
}

export interface FunctionSignature {
  name: string
  params: ParsedParam[]
  returnType: string | null
  isAsync: boolean
}

export interface CompileZigOptions {
  optimizationLevel?: 'Debug' | 'ReleaseSafe' | 'ReleaseFast' | 'ReleaseSmall'
  debug?: boolean
  sizeOptimize?: boolean
}

export interface CompileZigResult {
  wasm: Uint8Array
  exports: string[]
  compiledAt: string
  wasmSize: number
  metadata?: {
    optimizationLevel?: string
    sourceSize?: number
  }
  signatures?: FunctionSignature[]
  typescriptTypes?: string
  capnwebBindings?: string
}

const NOT_SUPPORTED_MESSAGE =
  'Zig compilation is not yet supported. ' +
  'The previous implementation was a fake regex-based compiler that produced incorrect results. ' +
  'Supported languages: TypeScript, JavaScript, Python (beta)'

/**
 * Compile Zig source code to WebAssembly
 *
 * @throws Error - Always throws because Zig compilation is not yet supported
 */
export async function compileZig(_code: string, _options?: CompileZigOptions): Promise<CompileZigResult> {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Generate TypeScript type definitions from function signatures
 *
 * @throws Error - Always throws because Zig compilation is not yet supported
 */
export function generateTypeScriptTypes(
  _signatures: FunctionSignature[],
  _moduleName?: string
): string {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Generate capnweb RPC bindings from function signatures
 *
 * @throws Error - Always throws because Zig compilation is not yet supported
 */
export function generateCapnwebBindings(
  _signatures: FunctionSignature[],
  _moduleName?: string
): string {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}
