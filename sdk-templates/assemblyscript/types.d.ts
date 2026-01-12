/**
 * TypeScript type definitions for {{functionName}}
 * Generated from AssemblyScript source by Functions.do
 */

// WASM module exports interface
export interface ModuleExports {
  /**
   * add function
   * @param a - i32 (number)
   * @param b - i32 (number)
   * @returns i32 (number)
   */
  add(a: number, b: number): number
  /**
   * subtract function
   * @param a - i32 (number)
   * @param b - i32 (number)
   * @returns i32 (number)
   */
  subtract(a: number, b: number): number
  /**
   * multiply function
   * @param a - i32 (number)
   * @param b - i32 (number)
   * @returns i32 (number)
   */
  multiply(a: number, b: number): number
  /**
   * divide function
   * @param a - i32 (number)
   * @param b - i32 (number)
   * @returns i32 (number)
   */
  divide(a: number, b: number): number
  /**
   * identity function
   * @param x - i32 (number)
   * @returns i32 (number)
   */
  identity(x: number): number
  /**
   * getAnswer function
   * @returns i32 (number)
   */
  getAnswer(): number
  /**
   * add64 function
   * @param a - i64 (bigint)
   * @param b - i64 (bigint)
   * @returns i64 (bigint)
   */
  add64(a: bigint, b: bigint): bigint
  /**
   * multiply64 function
   * @param a - i64 (bigint)
   * @param b - i64 (bigint)
   * @returns i64 (bigint)
   */
  multiply64(a: bigint, b: bigint): bigint
  /**
   * addFloat function
   * @param a - f32 (number)
   * @param b - f32 (number)
   * @returns f32 (number)
   */
  addFloat(a: number, b: number): number
  /**
   * addDouble function
   * @param a - f64 (number)
   * @param b - f64 (number)
   * @returns f64 (number)
   */
  addDouble(a: number, b: number): number
  /**
   * hypotenuse function
   * @param a - f64 (number)
   * @param b - f64 (number)
   * @returns f64 (number)
   */
  hypotenuse(a: number, b: number): number
  /**
   * factorial function
   * @param n - i32 (number)
   * @returns i64 (bigint)
   */
  factorial(n: number): bigint
  /**
   * fibonacci function
   * @param n - i32 (number)
   * @returns i64 (bigint)
   */
  fibonacci(n: number): bigint
  /**
   * isPrime function
   * @param n - i32 (number)
   * @returns i32 (number)
   */
  isPrime(n: number): number
  /**
   * gcd function
   * @param a - i32 (number)
   * @param b - i32 (number)
   * @returns i32 (number)
   */
  gcd(a: number, b: number): number
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

export interface DivideParams {
  a: number
  b: number
}

export interface IdentityParams {
  x: number
}

export interface Add64Params {
  a: bigint
  b: bigint
}

export interface Multiply64Params {
  a: bigint
  b: bigint
}

export interface AddFloatParams {
  a: number
  b: number
}

export interface AddDoubleParams {
  a: number
  b: number
}

export interface HypotenuseParams {
  a: number
  b: number
}

export interface FactorialParams {
  n: number
}

export interface FibonacciParams {
  n: number
}

export interface IsPrimeParams {
  n: number
}

export interface GcdParams {
  a: number
  b: number
}

// Capnweb RPC wrapper
export interface ModuleRpcTarget {
  add(a: number, b: number): Promise<number>
  subtract(a: number, b: number): Promise<number>
  multiply(a: number, b: number): Promise<number>
  divide(a: number, b: number): Promise<number>
  identity(x: number): Promise<number>
  getAnswer(): Promise<number>
  add64(a: bigint, b: bigint): Promise<bigint>
  multiply64(a: bigint, b: bigint): Promise<bigint>
  addFloat(a: number, b: number): Promise<number>
  addDouble(a: number, b: number): Promise<number>
  hypotenuse(a: number, b: number): Promise<number>
  factorial(n: number): Promise<bigint>
  fibonacci(n: number): Promise<bigint>
  isPrime(n: number): Promise<number>
  gcd(a: number, b: number): Promise<number>
}

/**
 * Raw WASM instance type (for direct access)
 */
export interface ModuleWasmInstance {
  exports: ModuleExports
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
    compiler: string
    optimized: boolean
  }
}
