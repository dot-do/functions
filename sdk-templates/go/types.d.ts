/**
 * TypeScript type definitions for Example
 * Generated from Go source by Functions.do
 */

// WASM module exports interface
export interface ExampleExports {
  /**
   * Add two integers and return the result
   */
  add(a: number, b: number): number
  /**
   * Subtract b from a and return the result
   */
  subtract(a: number, b: number): number
  /**
   * Multiply two integers and return the result
   */
  multiply(a: number, b: number): number
  /**
   * Returns the answer to life, the universe, and everything
   */
  get_answer(): number
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

// Capnweb RPC wrapper
export interface ExampleRpcTarget {
  add(a: number, b: number): Promise<number>
  subtract(a: number, b: number): Promise<number>
  multiply(a: number, b: number): Promise<number>
  get_answer(): Promise<number>
}

/**
 * Raw WASM instance type (for direct access)
 */
export interface ExampleWasmInstance {
  exports: ExampleExports
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
    usedTinyGo: boolean
    tinyGoVersion?: string
    optimizationLevel?: string
  }
}
