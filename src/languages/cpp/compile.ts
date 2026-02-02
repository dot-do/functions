/**
 * C/C++ to WASM Compiler
 *
 * STATUS: NOT YET SUPPORTED
 *
 * C/C++ compilation to WASM is planned but not yet implemented.
 * The previous implementation was a fake compiler that regex-parsed
 * C/C++ source code and generated hardcoded WASM bytecode. This produced
 * silently wrong results for any real C/C++ code.
 *
 * When real C/C++ compilation support is added, it will require:
 * - Emscripten or clang with wasm target accessible via API
 * - Proper wasm32 target compilation
 * - Actual LLVM-based code generation
 *
 * Currently supported languages: TypeScript, JavaScript, Python (beta)
 */

// ============================================================================
// Types (preserved for API compatibility)
// ============================================================================

export interface CompileCOptions {
  language?: 'c' | 'cpp'
  optimize?: boolean
  optimizationLevel?: 0 | 1 | 2 | 3
  debug?: boolean
  flags?: string[]
}

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

export interface CompileCResult {
  wasm: Uint8Array
  exports: string[]
  wasmSize: number
  compiledAt: Date
  signatures?: FunctionSignature[]
  metadata?: {
    language: 'c' | 'cpp'
    optimizationLevel?: number
    sourceSize?: number
  }
  typescriptTypes?: string
  capnwebBindings?: string
}

export interface BindingGenerationOptions {
  moduleName?: string
  generateTypes?: boolean
  generateBindings?: boolean
}

const NOT_SUPPORTED_MESSAGE =
  'C/C++ compilation is not yet supported. ' +
  'The previous implementation was a fake regex-based compiler that produced incorrect results. ' +
  'Supported languages: TypeScript, JavaScript, Python (beta)'

/**
 * Compiles C/C++ code to WebAssembly
 *
 * @throws Error - Always throws because C/C++ compilation is not yet supported
 */
export async function compileC(
  _code: string,
  _options?: CompileCOptions & BindingGenerationOptions
): Promise<CompileCResult> {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Generate TypeScript type definitions from function signatures
 *
 * @throws Error - Always throws because C/C++ compilation is not yet supported
 */
export function generateTypescriptTypes(
  _signatures: FunctionSignature[],
  _moduleName?: string
): string {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Generate capnweb RPC bindings from function signatures
 *
 * @throws Error - Always throws because C/C++ compilation is not yet supported
 */
export function generateCapnwebBindings(
  _signatures: FunctionSignature[],
  _moduleName?: string
): string {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Generate CMake toolchain file for Emscripten
 *
 * @throws Error - Always throws because C/C++ compilation is not yet supported
 */
export function generateEmscriptenToolchain(): string {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}

/**
 * Generate a sample CMakeLists.txt for a Functions.do C/C++ project
 *
 * @throws Error - Always throws because C/C++ compilation is not yet supported
 */
export function generateCMakeLists(_projectName?: string): string {
  throw new Error(NOT_SUPPORTED_MESSAGE)
}
