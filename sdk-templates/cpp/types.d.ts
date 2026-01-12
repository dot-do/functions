/**
 * TypeScript type definitions for CModule
 * Generated from C/C++ source by Functions.do
 */

// WASM module exports interface
export interface CModuleExports {
  /**
   * add(a: int, b: int) -> int
   */
  add(a: number, b: number): number
  /**
   * subtract(a: int, b: int) -> int
   */
  subtract(a: number, b: number): number
  /**
   * multiply(a: int, b: int) -> int
   */
  multiply(a: number, b: number): number
  /**
   * get_answer() -> int
   */
  get_answer(): number
  /**
   * factorial(n: int) -> int64_t
   */
  factorial(n: number): bigint
  /**
   * fibonacci(n: int) -> int64_t
   */
  fibonacci(n: number): bigint
  /**
   * sum_array(arr: int*, len: int) -> int
   */
  sum_array(arr: number, len: number): number
  /**
   * dot_product(a: double*, b: double*, len: int) -> double
   */
  dot_product(a: number, b: number, len: number): number
  /**
   * string_length(str: char*) -> int
   */
  string_length(str: number): number
  /**
   * alloc(size: size_t) -> void*
   */
  alloc(size: number): number
  /**
   * dealloc(ptr: void*, size: size_t) -> void
   */
  dealloc(ptr: number, size: number): void
  /**
   * reset_heap() -> void
   */
  reset_heap(): void
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

export interface FactorialParams {
  n: number
}

export interface FibonacciParams {
  n: number
}

export interface Sum_arrayParams {
  arr: number
  len: number
}

export interface Dot_productParams {
  a: number
  b: number
  len: number
}

export interface String_lengthParams {
  str: number
}

export interface AllocParams {
  size: number
}

export interface DeallocParams {
  ptr: number
  size: number
}

// Capnweb RPC wrapper
export interface CModuleRpcTarget {
  add(a: number, b: number): Promise<number>
  subtract(a: number, b: number): Promise<number>
  multiply(a: number, b: number): Promise<number>
  get_answer(): Promise<number>
  factorial(n: number): Promise<bigint>
  fibonacci(n: number): Promise<bigint>
  sum_array(arr: number, len: number): Promise<number>
  dot_product(a: number, b: number, len: number): Promise<number>
  string_length(str: number): Promise<number>
  alloc(size: number): Promise<number>
  dealloc(ptr: number, size: number): Promise<void>
  reset_heap(): Promise<void>
}

/**
 * Raw WASM instance type (for direct access)
 */
export interface CModuleWasmInstance {
  exports: CModuleExports
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
    language: 'c' | 'cpp'
    optimizationLevel?: number
  }
}
