/**
 * Capnweb RPC bindings for Example
 * Generated from Go source by Functions.do
 */

import { RpcTarget } from 'capnweb'

// WASM instance type
interface WasmInstance {
  exports: {
    add(a: number, b: number): number
    subtract(a: number, b: number): number
    multiply(a: number, b: number): number
    get_answer(): number
    memory: WebAssembly.Memory
  }
}

/**
 * ExampleTarget wraps a WASM instance as an RpcTarget
 *
 * This class provides a type-safe wrapper around the WASM exports,
 * integrating with Functions.do's capnweb RPC system.
 *
 * @example
 * ```typescript
 * const wasmBytes = await fetch('/example.wasm').then(r => r.arrayBuffer())
 * const target = await createExampleTarget(new Uint8Array(wasmBytes))
 *
 * const sum = target.add(2, 3)  // 5
 * const product = target.multiply(6, 7)  // 42
 * ```
 */
export class ExampleTarget extends RpcTarget {
  private instance: WasmInstance

  constructor(instance: WasmInstance) {
    super()
    this.instance = instance
  }

  /**
   * Add two integers and return the result
   * @param a - First operand
   * @param b - Second operand
   * @returns Sum of a and b
   */
  add(a: number, b: number): number {
    return this.instance.exports.add(a, b)
  }

  /**
   * Subtract b from a and return the result
   * @param a - First operand (minuend)
   * @param b - Second operand (subtrahend)
   * @returns Difference of a and b
   */
  subtract(a: number, b: number): number {
    return this.instance.exports.subtract(a, b)
  }

  /**
   * Multiply two integers and return the result
   * @param a - First operand
   * @param b - Second operand
   * @returns Product of a and b
   */
  multiply(a: number, b: number): number {
    return this.instance.exports.multiply(a, b)
  }

  /**
   * Returns the answer to life, the universe, and everything
   * @returns 42
   */
  get_answer(): number {
    return this.instance.exports.get_answer()
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
 * Create an ExampleTarget from compiled WASM bytes
 *
 * @param wasmBytes - The compiled WASM binary
 * @returns A new ExampleTarget instance
 *
 * @example
 * ```typescript
 * // From fetch
 * const wasmBytes = await fetch('/example.wasm')
 *   .then(r => r.arrayBuffer())
 *   .then(b => new Uint8Array(b))
 *
 * const target = await createExampleTarget(wasmBytes)
 * ```
 */
export async function createExampleTarget(wasmBytes: Uint8Array): Promise<ExampleTarget> {
  const module = await WebAssembly.compile(wasmBytes)
  const instance = await WebAssembly.instantiate(module) as unknown as WasmInstance
  return new ExampleTarget(instance)
}

/**
 * Create an ExampleTarget from a pre-compiled WebAssembly.Module
 *
 * @param module - The pre-compiled WASM module
 * @returns A new ExampleTarget instance
 */
export async function createExampleTargetFromModule(module: WebAssembly.Module): Promise<ExampleTarget> {
  const instance = await WebAssembly.instantiate(module) as unknown as WasmInstance
  return new ExampleTarget(instance)
}

/**
 * Type guard to check if an object is an ExampleTarget
 */
export function isExampleTarget(obj: unknown): obj is ExampleTarget {
  return obj instanceof ExampleTarget
}

/**
 * Export types for consumers
 */
export type { WasmInstance as ExampleWasmInstance }
