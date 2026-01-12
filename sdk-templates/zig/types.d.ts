/**
 * TypeScript type definitions for ZigModule
 * Generated from Zig source by Functions.do
 */

// WASM module exports interface
export interface ZigModuleExports {
  /**
   * add function
   */
  add(a: number, b: number): number
  /**
   * subtract function
   */
  subtract(a: number, b: number): number
  /**
   * multiply function
   */
  multiply(a: number, b: number): number
  /**
   * identity function
   */
  identity(x: number): number
  /**
   * get_answer function
   */
  get_answer(): number
  /**
   * compute function
   */
  compute(x: number): number
  /**
   * add_floats function
   */
  add_floats(a: number, b: number): number
  /**
   * add_doubles function
   */
  add_doubles(a: number, b: number): number
  /**
   * add_i64 function
   */
  add_i64(a: bigint, b: bigint): bigint
  /**
   * bool_identity function
   */
  bool_identity(x: boolean): boolean
  /**
   * no_op function
   */
  no_op(): void
  /**
   * string_length function
   */
  string_length(ptr: number, len: number): number
  /**
   * string_copy function
   */
  string_copy(src_ptr: number, len: number): number
  /**
   * alloc function
   */
  alloc(size: number): number
  /**
   * dealloc function
   */
  dealloc(ptr: number, size: number): void
  /**
   * WASM linear memory
   */
  memory: WebAssembly.Memory
}

export interface AddParams {
  a: number
  b: number
}

export interface SubtractParams {
  a: number
  b: number
}

export interface MultiplyParams {
  a: number
  b: number
}

export interface IdentityParams {
  x: number
}

export interface ComputeParams {
  x: number
}

export interface AddFloatsParams {
  a: number
  b: number
}

export interface AddDoublesParams {
  a: number
  b: number
}

export interface AddI64Params {
  a: bigint
  b: bigint
}

export interface BoolIdentityParams {
  x: boolean
}

export interface StringLengthParams {
  ptr: number
  len: number
}

export interface StringCopyParams {
  src_ptr: number
  len: number
}

export interface AllocParams {
  size: number
}

export interface DeallocParams {
  ptr: number
  size: number
}

// Capnweb RPC wrapper
export interface ZigModuleRpcTarget {
  add(a: number, b: number): Promise<number>
  subtract(a: number, b: number): Promise<number>
  multiply(a: number, b: number): Promise<number>
  identity(x: number): Promise<number>
  get_answer(): Promise<number>
  compute(x: number): Promise<number>
  add_floats(a: number, b: number): Promise<number>
  add_doubles(a: number, b: number): Promise<number>
  add_i64(a: bigint, b: bigint): Promise<bigint>
  bool_identity(x: boolean): Promise<boolean>
  no_op(): Promise<void>
  string_length(ptr: number, len: number): Promise<number>
  string_copy(src_ptr: number, len: number): Promise<number>
  alloc(size: number): Promise<number>
  dealloc(ptr: number, size: number): Promise<void>
}

/**
 * Raw WASM instance type (for direct access)
 */
export interface ZigModuleWasmInstance {
  exports: ZigModuleExports
}

/**
 * Compilation result from Functions.do compiler
 */
export interface CompileResult {
  wasm: Uint8Array
  exports: string[]
  typescriptTypes?: string
  capnwebBindings?: string
  metadata?: {
    wasmSize: number
    compiledAt: string
    optimizationLevel?: string
    sourceSize?: number
  }
}
