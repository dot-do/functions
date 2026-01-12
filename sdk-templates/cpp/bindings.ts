/**
 * Capnweb RPC bindings for CModule
 * Generated from C/C++ source by Functions.do
 */

import { RpcTarget } from 'capnweb'

// WASM instance type
interface WasmInstance {
  exports: {
    add(a: number, b: number): number
    subtract(a: number, b: number): number
    multiply(a: number, b: number): number
    get_answer(): number
    factorial(n: number): bigint
    fibonacci(n: number): bigint
    sum_array(arr: number, len: number): number
    dot_product(a: number, b: number, len: number): number
    string_length(str: number): number
    alloc(size: number): number
    dealloc(ptr: number, size: number): void
    reset_heap(): void
    memory: WebAssembly.Memory
  }
}

/**
 * CModuleTarget wraps a WASM instance as an RpcTarget
 *
 * This class provides a type-safe wrapper around the WASM exports,
 * integrating with Functions.do's capnweb RPC system.
 *
 * @example
 * ```typescript
 * const wasmBytes = await fetch('/cmodule.wasm').then(r => r.arrayBuffer())
 * const target = await createCModuleTarget(new Uint8Array(wasmBytes))
 *
 * const result = target.add(1, 2)
 * ```
 */
export class CModuleTarget extends RpcTarget {
  private instance: WasmInstance

  constructor(instance: WasmInstance) {
    super()
    this.instance = instance
  }

  /**
   * add
   * @param a - int
   * @param b - int
   * @returns int
   */
  add(a: number, b: number): number {
    return this.instance.exports.add(a, b)
  }

  /**
   * subtract
   * @param a - int
   * @param b - int
   * @returns int
   */
  subtract(a: number, b: number): number {
    return this.instance.exports.subtract(a, b)
  }

  /**
   * multiply
   * @param a - int
   * @param b - int
   * @returns int
   */
  multiply(a: number, b: number): number {
    return this.instance.exports.multiply(a, b)
  }

  /**
   * get_answer
   * @returns int
   */
  get_answer(): number {
    return this.instance.exports.get_answer()
  }

  /**
   * factorial
   * @param n - int
   * @returns int64_t
   */
  factorial(n: number): bigint {
    return this.instance.exports.factorial(n)
  }

  /**
   * fibonacci
   * @param n - int
   * @returns int64_t
   */
  fibonacci(n: number): bigint {
    return this.instance.exports.fibonacci(n)
  }

  /**
   * sum_array
   * @param arr - int*
   * @param len - int
   * @returns int
   */
  sum_array(arr: number, len: number): number {
    return this.instance.exports.sum_array(arr, len)
  }

  /**
   * dot_product
   * @param a - double*
   * @param b - double*
   * @param len - int
   * @returns double
   */
  dot_product(a: number, b: number, len: number): number {
    return this.instance.exports.dot_product(a, b, len)
  }

  /**
   * string_length
   * @param str - char*
   * @returns int
   */
  string_length(str: number): number {
    return this.instance.exports.string_length(str)
  }

  /**
   * alloc - Allocate memory in WASM linear memory
   * @param size - size_t
   * @returns void* (pointer as number)
   */
  alloc(size: number): number {
    return this.instance.exports.alloc(size)
  }

  /**
   * dealloc - Free previously allocated memory
   * @param ptr - void*
   * @param size - size_t
   */
  dealloc(ptr: number, size: number): void {
    this.instance.exports.dealloc(ptr, size)
  }

  /**
   * reset_heap - Reset the allocator
   */
  reset_heap(): void {
    this.instance.exports.reset_heap()
  }

  /**
   * Get direct access to WASM memory
   * Useful for advanced operations like string passing
   */
  get memory(): WebAssembly.Memory {
    return this.instance.exports.memory
  }

  /**
   * Helper: Write a string to WASM memory
   * @param str - The string to write
   * @returns Pointer to the string in WASM memory
   */
  writeString(str: string): number {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(str)
    const ptr = this.alloc(bytes.length + 1)
    const memory = new Uint8Array(this.memory.buffer)
    memory.set(bytes, ptr)
    memory[ptr + bytes.length] = 0 // null terminator
    return ptr
  }

  /**
   * Helper: Read a string from WASM memory
   * @param ptr - Pointer to null-terminated string
   * @returns The string
   */
  readString(ptr: number): string {
    const memory = new Uint8Array(this.memory.buffer)
    let end = ptr
    while (memory[end] !== 0) end++
    const bytes = memory.slice(ptr, end)
    return new TextDecoder().decode(bytes)
  }

  /**
   * Helper: Write an array of numbers to WASM memory
   * @param arr - Array of numbers
   * @param type - 'i32' | 'f32' | 'f64'
   * @returns Pointer to the array in WASM memory
   */
  writeArray(arr: number[], type: 'i32' | 'f32' | 'f64' = 'i32'): number {
    const byteSize = type === 'f64' ? 8 : 4
    const ptr = this.alloc(arr.length * byteSize)
    const view = new DataView(this.memory.buffer)

    for (let i = 0; i < arr.length; i++) {
      const offset = ptr + i * byteSize
      switch (type) {
        case 'i32':
          view.setInt32(offset, arr[i], true)
          break
        case 'f32':
          view.setFloat32(offset, arr[i], true)
          break
        case 'f64':
          view.setFloat64(offset, arr[i], true)
          break
      }
    }

    return ptr
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
 * Create a CModuleTarget from compiled WASM bytes
 *
 * @param wasmBytes - The compiled WASM binary
 * @returns A new CModuleTarget instance
 *
 * @example
 * ```typescript
 * // From fetch
 * const wasmBytes = await fetch('/cmodule.wasm')
 *   .then(r => r.arrayBuffer())
 *   .then(b => new Uint8Array(b))
 *
 * const target = await createCModuleTarget(wasmBytes)
 * ```
 */
export async function createCModuleTarget(wasmBytes: Uint8Array): Promise<CModuleTarget> {
  const module = await WebAssembly.compile(wasmBytes)
  const instance = (await WebAssembly.instantiate(module)) as unknown as WasmInstance
  return new CModuleTarget(instance)
}

/**
 * Create a CModuleTarget from a pre-compiled WebAssembly.Module
 *
 * @param module - The pre-compiled WASM module
 * @returns A new CModuleTarget instance
 */
export async function createCModuleTargetFromModule(
  module: WebAssembly.Module
): Promise<CModuleTarget> {
  const instance = (await WebAssembly.instantiate(module)) as unknown as WasmInstance
  return new CModuleTarget(instance)
}

/**
 * Type guard to check if an object is a CModuleTarget
 */
export function isCModuleTarget(obj: unknown): obj is CModuleTarget {
  return obj instanceof CModuleTarget
}

/**
 * Export types for consumers
 */
export type { WasmInstance as CModuleWasmInstance }
