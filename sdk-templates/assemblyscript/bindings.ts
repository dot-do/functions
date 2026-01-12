/**
 * Capnweb RPC bindings for {{functionName}}
 * Generated from AssemblyScript source by Functions.do
 */

import { RpcTarget } from 'capnweb'

// WASM instance type
interface WasmInstance {
  exports: {
    add(a: number, b: number): number
    subtract(a: number, b: number): number
    multiply(a: number, b: number): number
    divide(a: number, b: number): number
    identity(x: number): number
    getAnswer(): number
    add64(a: bigint, b: bigint): bigint
    multiply64(a: bigint, b: bigint): bigint
    addFloat(a: number, b: number): number
    addDouble(a: number, b: number): number
    hypotenuse(a: number, b: number): number
    factorial(n: number): bigint
    fibonacci(n: number): bigint
    isPrime(n: number): number
    gcd(a: number, b: number): number
    memory: WebAssembly.Memory
  }
}

/**
 * ModuleTarget wraps a WASM instance as an RpcTarget
 *
 * This class provides a type-safe wrapper around the WASM exports,
 * integrating with Functions.do's capnweb RPC system.
 *
 * @example
 * ```typescript
 * const wasmBytes = await fetch('/module.wasm').then(r => r.arrayBuffer())
 * const target = await createModuleTarget(new Uint8Array(wasmBytes))
 *
 * const result = target.add(1, 2)
 * ```
 */
export class ModuleTarget extends RpcTarget {
  private instance: WasmInstance

  constructor(instance: WasmInstance) {
    super()
    this.instance = instance
  }

  /**
   * add function
   * @param a - i32
   * @param b - i32
   * @returns number
   */
  add(a: number, b: number): number {
    return this.instance.exports.add(a, b)
  }

  /**
   * subtract function
   * @param a - i32
   * @param b - i32
   * @returns number
   */
  subtract(a: number, b: number): number {
    return this.instance.exports.subtract(a, b)
  }

  /**
   * multiply function
   * @param a - i32
   * @param b - i32
   * @returns number
   */
  multiply(a: number, b: number): number {
    return this.instance.exports.multiply(a, b)
  }

  /**
   * divide function
   * @param a - i32
   * @param b - i32
   * @returns number
   */
  divide(a: number, b: number): number {
    return this.instance.exports.divide(a, b)
  }

  /**
   * identity function
   * @param x - i32
   * @returns number
   */
  identity(x: number): number {
    return this.instance.exports.identity(x)
  }

  /**
   * getAnswer function
   * @returns number
   */
  getAnswer(): number {
    return this.instance.exports.getAnswer()
  }

  /**
   * add64 function
   * @param a - i64
   * @param b - i64
   * @returns bigint
   */
  add64(a: bigint, b: bigint): bigint {
    return this.instance.exports.add64(a, b)
  }

  /**
   * multiply64 function
   * @param a - i64
   * @param b - i64
   * @returns bigint
   */
  multiply64(a: bigint, b: bigint): bigint {
    return this.instance.exports.multiply64(a, b)
  }

  /**
   * addFloat function
   * @param a - f32
   * @param b - f32
   * @returns number
   */
  addFloat(a: number, b: number): number {
    return this.instance.exports.addFloat(a, b)
  }

  /**
   * addDouble function
   * @param a - f64
   * @param b - f64
   * @returns number
   */
  addDouble(a: number, b: number): number {
    return this.instance.exports.addDouble(a, b)
  }

  /**
   * hypotenuse function
   * @param a - f64
   * @param b - f64
   * @returns number
   */
  hypotenuse(a: number, b: number): number {
    return this.instance.exports.hypotenuse(a, b)
  }

  /**
   * factorial function
   * @param n - i32
   * @returns bigint
   */
  factorial(n: number): bigint {
    return this.instance.exports.factorial(n)
  }

  /**
   * fibonacci function
   * @param n - i32
   * @returns bigint
   */
  fibonacci(n: number): bigint {
    return this.instance.exports.fibonacci(n)
  }

  /**
   * isPrime function
   * @param n - i32
   * @returns number
   */
  isPrime(n: number): number {
    return this.instance.exports.isPrime(n)
  }

  /**
   * gcd function
   * @param a - i32
   * @param b - i32
   * @returns number
   */
  gcd(a: number, b: number): number {
    return this.instance.exports.gcd(a, b)
  }

  /**
   * Get direct access to WASM memory
   * Useful for advanced operations like string passing
   */
  get memory(): WebAssembly.Memory {
    return this.instance.exports.memory
  }

  /**
   * Dispose of WASM resources
   * Called automatically when using `using` keyword (ES2022+)
   */
  [Symbol.dispose](): void {
    // Clean up WASM resources if needed
    // The GC will handle the actual memory cleanup
  }
}

/**
 * Create a ModuleTarget from compiled WASM bytes
 *
 * @param wasmBytes - The compiled WASM binary
 * @returns A new ModuleTarget instance
 *
 * @example
 * ```typescript
 * // From fetch
 * const wasmBytes = await fetch('/module.wasm')
 *   .then(r => r.arrayBuffer())
 *   .then(b => new Uint8Array(b))
 *
 * const target = await createModuleTarget(wasmBytes)
 * ```
 */
export async function createModuleTarget(wasmBytes: Uint8Array): Promise<ModuleTarget> {
  const module = await WebAssembly.compile(wasmBytes)
  const instance = (await WebAssembly.instantiate(module)) as unknown as WasmInstance
  return new ModuleTarget(instance)
}

/**
 * Create a ModuleTarget from a pre-compiled WebAssembly.Module
 *
 * @param module - The pre-compiled WASM module
 * @returns A new ModuleTarget instance
 */
export async function createModuleTargetFromModule(module: WebAssembly.Module): Promise<ModuleTarget> {
  const instance = (await WebAssembly.instantiate(module)) as unknown as WasmInstance
  return new ModuleTarget(instance)
}

/**
 * Type guard to check if an object is a ModuleTarget
 */
export function isModuleTarget(obj: unknown): obj is ModuleTarget {
  return obj instanceof ModuleTarget
}

/**
 * Export types for consumers
 */
export type { WasmInstance as ModuleWasmInstance }
