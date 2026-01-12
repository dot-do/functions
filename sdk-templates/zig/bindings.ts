/**
 * Capnweb RPC bindings for ZigModule
 * Generated from Zig source by Functions.do
 */

import { RpcTarget } from 'capnweb'

// WASM instance type
interface WasmInstance {
  exports: {
    add(a: number, b: number): number
    subtract(a: number, b: number): number
    multiply(a: number, b: number): number
    identity(x: number): number
    get_answer(): number
    compute(x: number): number
    add_floats(a: number, b: number): number
    add_doubles(a: number, b: number): number
    add_i64(a: bigint, b: bigint): bigint
    bool_identity(x: boolean): boolean
    no_op(): void
    string_length(ptr: number, len: number): number
    string_copy(src_ptr: number, len: number): number
    alloc(size: number): number
    dealloc(ptr: number, size: number): void
    memory: WebAssembly.Memory
  }
}

/**
 * ZigModuleTarget wraps a WASM instance as an RpcTarget
 *
 * This class provides a type-safe wrapper around the WASM exports,
 * integrating with Functions.do's capnweb RPC system.
 *
 * @example
 * ```typescript
 * const wasmBytes = await fetch('/zigmodule.wasm').then(r => r.arrayBuffer())
 * const target = await createZigModuleTarget(new Uint8Array(wasmBytes))
 *
 * const sum = target.add(2, 3)  // 5
 * const product = target.multiply(6, 7)  // 42
 * ```
 */
export class ZigModuleTarget extends RpcTarget {
  private instance: WasmInstance

  constructor(instance: WasmInstance) {
    super()
    this.instance = instance
  }

  /**
   * Add two integers and return the result
   * @param a - i32 parameter
   * @param b - i32 parameter
   * @returns i32 result
   */
  add(a: number, b: number): number {
    return this.instance.exports.add(a, b)
  }

  /**
   * Subtract b from a and return the result
   * @param a - i32 parameter
   * @param b - i32 parameter
   * @returns i32 result
   */
  subtract(a: number, b: number): number {
    return this.instance.exports.subtract(a, b)
  }

  /**
   * Multiply two integers and return the result
   * @param a - i32 parameter
   * @param b - i32 parameter
   * @returns i32 result
   */
  multiply(a: number, b: number): number {
    return this.instance.exports.multiply(a, b)
  }

  /**
   * Identity function - returns input unchanged
   * @param x - i32 parameter
   * @returns i32 result
   */
  identity(x: number): number {
    return this.instance.exports.identity(x)
  }

  /**
   * Returns the answer to life, the universe, and everything
   * @returns 42
   */
  get_answer(): number {
    return this.instance.exports.get_answer()
  }

  /**
   * Compute x * 2 + 1
   * @param x - i32 parameter
   * @returns i32 result
   */
  compute(x: number): number {
    return this.instance.exports.compute(x)
  }

  /**
   * Add two f32 floats
   * @param a - f32 parameter
   * @param b - f32 parameter
   * @returns f32 result
   */
  add_floats(a: number, b: number): number {
    return this.instance.exports.add_floats(a, b)
  }

  /**
   * Add two f64 doubles
   * @param a - f64 parameter
   * @param b - f64 parameter
   * @returns f64 result
   */
  add_doubles(a: number, b: number): number {
    return this.instance.exports.add_doubles(a, b)
  }

  /**
   * Add two i64 integers
   * @param a - i64 parameter
   * @param b - i64 parameter
   * @returns i64 result
   */
  add_i64(a: bigint, b: bigint): bigint {
    return this.instance.exports.add_i64(a, b)
  }

  /**
   * Boolean identity function
   * @param x - bool parameter
   * @returns bool result
   */
  bool_identity(x: boolean): boolean {
    return this.instance.exports.bool_identity(x)
  }

  /**
   * No-op function (side effects only)
   */
  no_op(): void {
    this.instance.exports.no_op()
  }

  /**
   * Calculate string length from pointer and length
   * @param ptr - Pointer to string data
   * @param len - Length of string
   * @returns Length of processed string
   */
  string_length(ptr: number, len: number): number {
    return this.instance.exports.string_length(ptr, len)
  }

  /**
   * Copy a string to a new buffer
   * @param src_ptr - Source pointer
   * @param len - Length to copy
   * @returns Pointer to new buffer
   */
  string_copy(src_ptr: number, len: number): number {
    return this.instance.exports.string_copy(src_ptr, len)
  }

  /**
   * Allocate memory in WASM linear memory
   * @param size - Number of bytes to allocate
   * @returns Pointer to allocated memory
   */
  alloc(size: number): number {
    return this.instance.exports.alloc(size)
  }

  /**
   * Free previously allocated memory
   * @param ptr - Pointer to memory
   * @param size - Size of allocation
   */
  dealloc(ptr: number, size: number): void {
    this.instance.exports.dealloc(ptr, size)
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

  // =========================================================================
  // Helper methods for string handling
  // =========================================================================

  /**
   * Write a string to WASM memory and return the pointer
   * @param str - The string to write
   * @returns Object containing pointer and length
   */
  writeString(str: string): { ptr: number; len: number } {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(str)
    const ptr = this.alloc(bytes.length)
    const view = new Uint8Array(this.memory.buffer, ptr, bytes.length)
    view.set(bytes)
    return { ptr, len: bytes.length }
  }

  /**
   * Read a string from WASM memory
   * @param ptr - Pointer to string data
   * @param len - Length of string
   * @returns The decoded string
   */
  readString(ptr: number, len: number): string {
    const view = new Uint8Array(this.memory.buffer, ptr, len)
    const decoder = new TextDecoder()
    return decoder.decode(view)
  }
}

/**
 * Create a ZigModuleTarget from compiled WASM bytes
 *
 * @param wasmBytes - The compiled WASM binary
 * @returns A new ZigModuleTarget instance
 *
 * @example
 * ```typescript
 * // From fetch
 * const wasmBytes = await fetch('/zigmodule.wasm')
 *   .then(r => r.arrayBuffer())
 *   .then(b => new Uint8Array(b))
 *
 * const target = await createZigModuleTarget(wasmBytes)
 * console.log(target.add(2, 3)) // 5
 * ```
 */
export async function createZigModuleTarget(wasmBytes: Uint8Array): Promise<ZigModuleTarget> {
  const module = await WebAssembly.compile(wasmBytes)
  const instance = (await WebAssembly.instantiate(module)) as unknown as WasmInstance
  return new ZigModuleTarget(instance)
}

/**
 * Create a ZigModuleTarget from a pre-compiled WebAssembly.Module
 *
 * @param module - The pre-compiled WASM module
 * @returns A new ZigModuleTarget instance
 */
export async function createZigModuleTargetFromModule(module: WebAssembly.Module): Promise<ZigModuleTarget> {
  const instance = (await WebAssembly.instantiate(module)) as unknown as WasmInstance
  return new ZigModuleTarget(instance)
}

/**
 * Type guard to check if an object is a ZigModuleTarget
 */
export function isZigModuleTarget(obj: unknown): obj is ZigModuleTarget {
  return obj instanceof ZigModuleTarget
}

/**
 * Export types for consumers
 */
export type { WasmInstance as ZigModuleWasmInstance }
