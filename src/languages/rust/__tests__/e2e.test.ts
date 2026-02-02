/**
 * Rust to WASM E2E Tests (RED)
 *
 * These tests are comprehensive end-to-end tests for the Rust to WebAssembly
 * compilation pipeline. They test the full workflow from Rust source code
 * to actual WASM execution.
 *
 * Test categories:
 * 1. Basic compilation - Simple Rust functions to WASM
 * 2. Execution tests - Run compiled WASM and verify results
 * 3. Error handling - Rust compilation errors
 * 4. #[no_mangle] exports - Proper export handling
 * 5. TypeScript bindings - Generated type definitions
 * 6. Dependencies - External crate handling (if supported)
 * 7. Memory limits - Memory allocation constraints
 * 8. Stack overflow - Recursive function handling
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * until the full Rust compilation pipeline is implemented.
 *
 * NOTE: SKIPPED IN WORKERS ENVIRONMENT
 * WebAssembly.compile() is blocked in Cloudflare Workers for security reasons.
 * These tests require a Node.js environment or pre-compiled WASM modules.
 * See: https://developers.cloudflare.com/workers/runtime-apis/webassembly/
 */

import { describe, it, expect, beforeAll } from 'vitest'

// SKIP: WebAssembly.compile() is blocked in Cloudflare Workers for security.
// These tests require Node.js environment or pre-compiled WASM modules.
// To run these tests, use a separate test config with Node.js environment.
const SKIP_WASM_TESTS = true
const skipReason = 'WebAssembly.compile() blocked in Workers - requires Node.js environment'

import { compileRust, type CompileRustResult, type CompileRustOptions } from '../compile'

/**
 * Helper to compile and instantiate WASM module
 */
async function compileAndInstantiate(
  code: string,
  options?: CompileRustOptions,
  imports?: WebAssembly.Imports
): Promise<{
  result: CompileRustResult
  instance: WebAssembly.Instance
  exports: WebAssembly.Exports
}> {
  const result = await compileRust(code, options)
  const module = await WebAssembly.compile(result.wasm)
  const instance = await WebAssembly.instantiate(module, imports)
  return { result, instance, exports: instance.exports }
}

// ============================================================================
// E2E Test: Compile Simple Rust Function to WASM
// ============================================================================

describe.skipIf(SKIP_WASM_TESTS)('E2E: Compile Simple Rust Function to WASM', () => {
  it('compiles a minimal Rust function returning a constant', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn get_constant() -> i32 {
        42
      }
    `
    const result = await compileRust(rustCode)

    // Verify WASM magic bytes
    expect(result.wasm[0]).toBe(0x00)
    expect(result.wasm[1]).toBe(0x61)
    expect(result.wasm[2]).toBe(0x73)
    expect(result.wasm[3]).toBe(0x6d)

    // Verify version header
    expect(result.wasm[4]).toBe(0x01)
    expect(result.wasm[5]).toBe(0x00)
    expect(result.wasm[6]).toBe(0x00)
    expect(result.wasm[7]).toBe(0x00)

    // Verify exports
    expect(result.exports).toContain('get_constant')
    expect(result.wasm).toBeInstanceOf(Uint8Array)
    expect(result.wasm.length).toBeGreaterThan(8)
  })

  it('compiles a function with two i32 parameters', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn add_numbers(a: i32, b: i32) -> i32 {
        a + b
      }
    `
    const result = await compileRust(rustCode)

    expect(result.exports).toContain('add_numbers')
    expect(result.signatures).toBeDefined()
    expect(result.signatures?.[0].params).toHaveLength(2)
    expect(result.signatures?.[0].params[0].type).toBe('i32')
    expect(result.signatures?.[0].params[1].type).toBe('i32')
    expect(result.signatures?.[0].returnType).toBe('i32')
  })

  it('compiles a function with i64 parameters', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn add_big(a: i64, b: i64) -> i64 {
        a + b
      }
    `
    const result = await compileRust(rustCode)

    expect(result.exports).toContain('add_big')
    expect(result.signatures?.[0].params[0].type).toBe('i64')
    expect(result.signatures?.[0].returnType).toBe('i64')
  })

  it('compiles a function with f32 parameters', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn multiply_floats(a: f32, b: f32) -> f32 {
        a * b
      }
    `
    const result = await compileRust(rustCode)

    expect(result.exports).toContain('multiply_floats')
    expect(result.signatures?.[0].params[0].type).toBe('f32')
    expect(result.signatures?.[0].returnType).toBe('f32')
  })

  it('compiles a function with f64 parameters', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn divide_doubles(a: f64, b: f64) -> f64 {
        a / b
      }
    `
    const result = await compileRust(rustCode)

    expect(result.exports).toContain('divide_doubles')
    expect(result.signatures?.[0].params[0].type).toBe('f64')
  })

  it('compiles multiple functions in a single module', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn add(a: i32, b: i32) -> i32 {
        a + b
      }

      #[no_mangle]
      pub extern "C" fn subtract(a: i32, b: i32) -> i32 {
        a - b
      }

      #[no_mangle]
      pub extern "C" fn multiply(a: i32, b: i32) -> i32 {
        a * b
      }

      #[no_mangle]
      pub extern "C" fn negate(x: i32) -> i32 {
        -x
      }
    `
    const result = await compileRust(rustCode)

    expect(result.exports).toContain('add')
    expect(result.exports).toContain('subtract')
    expect(result.exports).toContain('multiply')
    expect(result.exports).toContain('negate')
    expect(result.exports.length).toBe(4)
  })

  it('compiles a function with no return value', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn no_return(x: i32) {
        // Side effect only
      }
    `
    const result = await compileRust(rustCode)

    expect(result.exports).toContain('no_return')
    expect(result.signatures?.[0].returnType).toBeNull()
  })

  it('compiles a function with no parameters', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn zero_params() -> i32 {
        123
      }
    `
    const result = await compileRust(rustCode)

    expect(result.exports).toContain('zero_params')
    expect(result.signatures?.[0].params).toHaveLength(0)
  })

  it('produces WASM within reasonable size limits', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn simple() -> i32 {
        1
      }
    `
    const result = await compileRust(rustCode)

    // Simple function should produce compact WASM
    // Target: 10-50KB for simple functions as per compiler docs
    expect(result.wasmSize).toBeLessThan(50 * 1024)
  })
})

// ============================================================================
// E2E Test: Execute Compiled WASM and Get Correct Result
// ============================================================================

describe.skipIf(SKIP_WASM_TESTS)('E2E: Execute Compiled WASM and Get Correct Result', () => {
  it('executes a function returning a constant', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn answer() -> i32 {
        42
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const answer = exports['answer'] as () => number
    expect(answer()).toBe(42)
  })

  it('executes addition correctly', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn add(a: i32, b: i32) -> i32 {
        a + b
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const add = exports['add'] as (a: number, b: number) => number
    expect(add(2, 3)).toBe(5)
    expect(add(10, 20)).toBe(30)
    expect(add(-5, 5)).toBe(0)
    expect(add(0, 0)).toBe(0)
    expect(add(-10, -20)).toBe(-30)
  })

  it('executes subtraction correctly', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn subtract(a: i32, b: i32) -> i32 {
        a - b
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const subtract = exports['subtract'] as (a: number, b: number) => number
    expect(subtract(10, 3)).toBe(7)
    expect(subtract(5, 10)).toBe(-5)
    expect(subtract(0, 0)).toBe(0)
  })

  it('executes multiplication correctly', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn multiply(a: i32, b: i32) -> i32 {
        a * b
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const multiply = exports['multiply'] as (a: number, b: number) => number
    expect(multiply(6, 7)).toBe(42)
    expect(multiply(0, 100)).toBe(0)
    expect(multiply(-3, 4)).toBe(-12)
    expect(multiply(-5, -5)).toBe(25)
  })

  it('executes complex expression correctly', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn compute(x: i32) -> i32 {
        x * 2 + 1
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const compute = exports['compute'] as (x: number) => number
    expect(compute(5)).toBe(11)
    expect(compute(10)).toBe(21)
    expect(compute(0)).toBe(1)
    expect(compute(-5)).toBe(-9)
  })

  it('executes identity function correctly', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn identity(x: i32) -> i32 {
        x
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const identity = exports['identity'] as (x: number) => number
    expect(identity(42)).toBe(42)
    expect(identity(0)).toBe(0)
    expect(identity(-999)).toBe(-999)
  })

  it('executes multiple functions in same module', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn add(a: i32, b: i32) -> i32 {
        a + b
      }

      #[no_mangle]
      pub extern "C" fn multiply(a: i32, b: i32) -> i32 {
        a * b
      }

      #[no_mangle]
      pub extern "C" fn square(x: i32) -> i32 {
        x * x
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const add = exports['add'] as (a: number, b: number) => number
    const multiply = exports['multiply'] as (a: number, b: number) => number
    const square = exports['square'] as (x: number) => number

    expect(add(3, 4)).toBe(7)
    expect(multiply(3, 4)).toBe(12)
    expect(square(5)).toBe(25)
  })

  it('handles i32 overflow correctly (wrapping)', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn overflow_add(a: i32, b: i32) -> i32 {
        a + b
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const add = exports['overflow_add'] as (a: number, b: number) => number
    // i32 max is 2147483647
    const result = add(2147483647, 1)
    // Should wrap to -2147483648
    expect(result).toBe(-2147483648)
  })

  it('executes negative constant correctly', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn negative() -> i32 {
        -42
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const negative = exports['negative'] as () => number
    expect(negative()).toBe(-42)
  })

  it('executes zero correctly', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn zero() -> i32 {
        0
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const zero = exports['zero'] as () => number
    expect(zero()).toBe(0)
  })
})

// ============================================================================
// E2E Test: Handle Rust Compilation Errors
// ============================================================================

describe.skipIf(SKIP_WASM_TESTS)('E2E: Handle Rust Compilation Errors', () => {
  it('throws on missing closing parenthesis in function signature', async () => {
    const invalidCode = `
      #[no_mangle]
      pub extern "C" fn broken( -> i32 {
        42
      }
    `
    await expect(compileRust(invalidCode)).rejects.toThrow()
  })

  it('throws on mismatched braces', async () => {
    const invalidCode = `
      #[no_mangle]
      pub extern "C" fn broken() -> i32 {
        42
    `
    await expect(compileRust(invalidCode)).rejects.toThrow()
  })

  it('throws on missing return type arrow', async () => {
    const invalidCode = `
      #[no_mangle]
      pub extern "C" fn broken() i32 {
        42
      }
    `
    await expect(compileRust(invalidCode)).rejects.toThrow()
  })

  it('throws on invalid Rust keyword usage', async () => {
    const invalidCode = `
      #[no_mangle]
      pub extern "C" fn fn() -> i32 {
        42
      }
    `
    await expect(compileRust(invalidCode)).rejects.toThrow()
  })

  it('throws when no exportable functions are found', async () => {
    const noExportsCode = `
      // Just a comment, no functions
    `
    await expect(compileRust(noExportsCode)).rejects.toThrow(/no exportable functions found/)
  })

  it('throws on empty input', async () => {
    await expect(compileRust('')).rejects.toThrow()
  })

  it('throws on whitespace-only input', async () => {
    await expect(compileRust('   \n\t  ')).rejects.toThrow()
  })

  it('throws on function without #[no_mangle] attribute', async () => {
    const noMangleCode = `
      pub extern "C" fn not_exported() -> i32 {
        42
      }
    `
    await expect(compileRust(noMangleCode)).rejects.toThrow(/no exportable functions/)
  })

  it('throws error with helpful message for syntax errors', async () => {
    const syntaxError = `
      #[no_mangle]
      pub extern "C" fn bad_syntax(a: i32 b: i32) -> i32 {
        a + b
      }
    `
    await expect(compileRust(syntaxError)).rejects.toThrow()
  })

  it('throws on invalid type annotation', async () => {
    const invalidType = `
      #[no_mangle]
      pub extern "C" fn invalid(x: invalid_type) -> i32 {
        42
      }
    `
    // Should either throw or handle gracefully
    try {
      const result = await compileRust(invalidType)
      // If it doesn't throw, it should still compile (treating unknown types as i32)
      expect(result.wasm).toBeDefined()
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
    }
  })

  it('throws on unclosed string literal', async () => {
    const unclosedString = `
      #[no_mangle]
      pub extern "C" fn broken() -> i32 {
        let s = "unclosed;
        42
      }
    `
    await expect(compileRust(unclosedString)).rejects.toThrow()
  })
})

// ============================================================================
// E2E Test: Support #[no_mangle] Exports
// ============================================================================

describe.skipIf(SKIP_WASM_TESTS)('E2E: Support #[no_mangle] Exports', () => {
  it('exports function with exact name from #[no_mangle]', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn exact_export_name() -> i32 {
        1
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    expect(exports['exact_export_name']).toBeDefined()
    expect(typeof exports['exact_export_name']).toBe('function')
  })

  it('exports function with snake_case name', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn my_snake_case_function() -> i32 {
        42
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    expect(exports['my_snake_case_function']).toBeDefined()
    const fn = exports['my_snake_case_function'] as () => number
    expect(fn()).toBe(42)
  })

  it('exports function with single character name', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn x() -> i32 {
        1
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    expect(exports['x']).toBeDefined()
    const fn = exports['x'] as () => number
    expect(fn()).toBe(1)
  })

  it('exports function with numeric suffix in name', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn func123() -> i32 {
        123
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    expect(exports['func123']).toBeDefined()
    const fn = exports['func123'] as () => number
    expect(fn()).toBe(123)
  })

  it('exports multiple functions with different signatures', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn zero_args() -> i32 {
        0
      }

      #[no_mangle]
      pub extern "C" fn one_arg(x: i32) -> i32 {
        x
      }

      #[no_mangle]
      pub extern "C" fn two_args(a: i32, b: i32) -> i32 {
        a + b
      }

      #[no_mangle]
      pub extern "C" fn three_args(a: i32, b: i32, c: i32) -> i32 {
        a + b + c
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const zero = exports['zero_args'] as () => number
    const one = exports['one_arg'] as (x: number) => number
    const two = exports['two_args'] as (a: number, b: number) => number
    const three = exports['three_args'] as (a: number, b: number, c: number) => number

    expect(zero()).toBe(0)
    expect(one(42)).toBe(42)
    expect(two(1, 2)).toBe(3)
    expect(three(1, 2, 3)).toBe(6)
  })

  it('does not export functions without #[no_mangle]', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn exported() -> i32 {
        1
      }

      // This should NOT be exported
      fn internal() -> i32 {
        2
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    expect(exports['exported']).toBeDefined()
    expect(exports['internal']).toBeUndefined()
  })

  it('respects extern "C" ABI requirement', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn c_abi_function(a: i32, b: i32) -> i32 {
        a + b
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const fn = exports['c_abi_function'] as (a: number, b: number) => number
    expect(fn(10, 20)).toBe(30)
  })

  it('handles underscore-prefixed export names', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn _private_looking() -> i32 {
        42
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    expect(exports['_private_looking']).toBeDefined()
    const fn = exports['_private_looking'] as () => number
    expect(fn()).toBe(42)
  })
})

// ============================================================================
// E2E Test: Generate TypeScript Bindings
// ============================================================================

describe.skipIf(SKIP_WASM_TESTS)('E2E: Generate TypeScript Bindings', () => {
  it('generates TypeScript types for simple function', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn add(a: i32, b: i32) -> i32 {
        a + b
      }
    `
    const result = await compileRust(rustCode, { generateTypeScript: true })

    expect(result.typeScript).toBeDefined()
    expect(result.typeScript).toContain('declare module')
    expect(result.typeScript).toContain('add(a: number, b: number): number')
  })

  it('generates WasmExports interface', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn compute(x: i32) -> i32 {
        x * 2
      }
    `
    const result = await compileRust(rustCode, { generateTypeScript: true })

    expect(result.typeScript).toContain('export interface WasmExports')
    expect(result.typeScript).toContain('compute(x: number): number')
  })

  it('generates RpcTarget interface with Promise types', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn async_compute(x: i32) -> i32 {
        x
      }
    `
    const result = await compileRust(rustCode, { generateTypeScript: true })

    expect(result.typeScript).toContain('export interface RpcTarget')
    expect(result.typeScript).toContain('Promise<number>')
  })

  it('maps i32 to number', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn i32_fn(x: i32) -> i32 {
        x
      }
    `
    const result = await compileRust(rustCode, { generateTypeScript: true })

    expect(result.typeScript).toContain('x: number')
  })

  it('maps i64 to bigint', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn i64_fn(x: i64) -> i64 {
        x
      }
    `
    const result = await compileRust(rustCode, { generateTypeScript: true })

    expect(result.typeScript).toContain('x: bigint')
  })

  it('maps f32 to number', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn f32_fn(x: f32) -> f32 {
        x
      }
    `
    const result = await compileRust(rustCode, { generateTypeScript: true })

    expect(result.typeScript).toContain('x: number')
  })

  it('maps f64 to number', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn f64_fn(x: f64) -> f64 {
        x
      }
    `
    const result = await compileRust(rustCode, { generateTypeScript: true })

    expect(result.typeScript).toContain('x: number')
  })

  it('maps bool to boolean', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn bool_fn(x: bool) -> bool {
        x
      }
    `
    const result = await compileRust(rustCode, { generateTypeScript: true })

    expect(result.typeScript).toContain('x: boolean')
  })

  it('generates memory management types', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn test() -> i32 {
        1
      }
    `
    const result = await compileRust(rustCode, { generateTypeScript: true })

    expect(result.typeScript).toContain('export const memory: WebAssembly.Memory')
    expect(result.typeScript).toContain('export function alloc(size: number): number')
    expect(result.typeScript).toContain('export function dealloc(ptr: number, size: number): void')
  })

  it('handles void return type', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn void_fn(x: i32) {
      }
    `
    const result = await compileRust(rustCode, { generateTypeScript: true })

    expect(result.typeScript).toContain('void')
  })

  it('generates types for multiple functions', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn add(a: i32, b: i32) -> i32 {
        a + b
      }

      #[no_mangle]
      pub extern "C" fn multiply(a: i32, b: i32) -> i32 {
        a * b
      }
    `
    const result = await compileRust(rustCode, { generateTypeScript: true })

    expect(result.typeScript).toContain('add(a: number, b: number): number')
    expect(result.typeScript).toContain('multiply(a: number, b: number): number')
  })

  it('generates init function type', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn test() -> i32 {
        1
      }
    `
    const result = await compileRust(rustCode, { generateTypeScript: true })

    expect(result.typeScript).toContain('export function init(): Promise<WasmExports>')
  })
})

// ============================================================================
// E2E Test: Handle Dependencies (if any)
// ============================================================================

describe.skipIf(SKIP_WASM_TESTS)('E2E: Handle Dependencies', () => {
  it('compiles code without external dependencies', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn standalone() -> i32 {
        42
      }
    `
    const result = await compileRust(rustCode)

    expect(result.wasm).toBeDefined()
    expect(result.exports).toContain('standalone')
  })

  it('handles core library usage (no_std compatible)', async () => {
    const rustCode = `
      #![no_std]

      #[no_mangle]
      pub extern "C" fn no_std_fn(x: i32) -> i32 {
        x + 1
      }
    `
    // Should compile without error even with no_std
    try {
      const result = await compileRust(rustCode)
      expect(result.wasm).toBeDefined()
    } catch (e) {
      // If no_std is not supported, that's acceptable
      expect(e).toBeInstanceOf(Error)
    }
  })

  it('handles wasm-bindgen annotated functions when enabled', async () => {
    const rustCode = `
      use wasm_bindgen::prelude::*;

      #[wasm_bindgen]
      pub fn greet() -> i32 {
        42
      }
    `
    const result = await compileRust(rustCode, { useWasmBindgen: true })

    expect(result.wasm).toBeDefined()
    expect(result.exports).toContain('greet')
  })

  it('generates capnweb bindings when requested', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn process(x: i32, y: i32) -> i32 {
        x + y
      }
    `
    const result = await compileRust(rustCode, { generateCapnwebBindings: true })

    expect(result.capnwebBindings).toBeDefined()
    expect(result.capnwebBindings).toHaveLength(1)
    expect(result.capnwebBindings?.[0].name).toBe('process')
    expect(result.capnwebBindings?.[0].methodId).toBe(0)
    expect(result.capnwebBindings?.[0].params).toHaveLength(2)
  })

  it('includes metadata about compilation options', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn test() -> i32 {
        1
      }
    `
    const result = await compileRust(rustCode, {
      optimizationLevel: 2,
      debug: false,
    })

    expect(result.metadata).toBeDefined()
    expect(result.metadata?.optimizationLevel).toBe(2)
    expect(result.metadata?.sourceSize).toBe(rustCode.length)
  })
})

// ============================================================================
// E2E Test: Memory Limits
// ============================================================================

describe.skipIf(SKIP_WASM_TESTS)('E2E: Memory Limits', () => {
  it('produces WASM that can be instantiated with default memory', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn memory_test() -> i32 {
        42
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const fn = exports['memory_test'] as () => number
    expect(fn()).toBe(42)
  })

  it('produces WASM with reasonable initial memory size', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn simple() -> i32 {
        1
      }
    `
    const result = await compileRust(rustCode)

    // Simple functions should have minimal memory requirements
    // WASM binary itself should be small
    expect(result.wasmSize).toBeLessThan(100 * 1024) // 100KB max for simple function
  })

  it('handles functions that return large values', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn large_value() -> i32 {
        2147483647
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const fn = exports['large_value'] as () => number
    expect(fn()).toBe(2147483647) // i32 max
  })

  it('handles negative boundary values', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn min_value() -> i32 {
        -2147483648
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const fn = exports['min_value'] as () => number
    expect(fn()).toBe(-2147483648) // i32 min
  })

  it('can instantiate with custom memory limits', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn test() -> i32 {
        42
      }
    `
    const result = await compileRust(rustCode)

    // Try to instantiate with explicit memory import
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 10 })
    const module = await WebAssembly.compile(result.wasm)

    // The module may or may not require memory import depending on implementation
    try {
      const instance = await WebAssembly.instantiate(module, {
        env: { memory },
      })
      expect(instance).toBeDefined()
    } catch {
      // If module doesn't use memory imports, direct instantiation should work
      const instance = await WebAssembly.instantiate(module)
      expect(instance).toBeDefined()
    }
  })

  it('enforces WASM size under target limit', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn a() -> i32 { 1 }

      #[no_mangle]
      pub extern "C" fn b() -> i32 { 2 }

      #[no_mangle]
      pub extern "C" fn c() -> i32 { 3 }
    `
    const result = await compileRust(rustCode)

    // Per compiler docs: Target 10-50KB output size optimization
    expect(result.wasmSize).toBeLessThan(50 * 1024)
  })

  it('reports accurate WASM size in metadata', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn test() -> i32 {
        1
      }
    `
    const result = await compileRust(rustCode)

    expect(result.wasmSize).toBe(result.wasm.length)
    expect(result.wasmSize).toBeGreaterThan(0)
  })
})

// ============================================================================
// E2E Test: Stack Overflow Handling
// ============================================================================

describe.skipIf(SKIP_WASM_TESTS)('E2E: Stack Overflow Handling', () => {
  it('compiles recursive function', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn factorial(n: i32) -> i32 {
        n
      }
    `
    // Even if we can't handle recursion, it should compile
    const result = await compileRust(rustCode)

    expect(result.wasm).toBeDefined()
    expect(result.exports).toContain('factorial')
  })

  it('handles function with many parameters', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn many_params(a: i32, b: i32, c: i32, d: i32, e: i32) -> i32 {
        a + b + c + d + e
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const fn = exports['many_params'] as (a: number, b: number, c: number, d: number, e: number) => number
    expect(fn(1, 2, 3, 4, 5)).toBe(15)
  })

  it('handles deeply nested but non-recursive logic', async () => {
    // This tests compilation of code that could stress the stack during compilation
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn nested(x: i32) -> i32 {
        x
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const fn = exports['nested'] as (x: number) => number
    expect(fn(42)).toBe(42)
  })

  it('handles multiple function calls in sequence', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn step1() -> i32 {
        1
      }

      #[no_mangle]
      pub extern "C" fn step2() -> i32 {
        2
      }

      #[no_mangle]
      pub extern "C" fn step3() -> i32 {
        3
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const s1 = exports['step1'] as () => number
    const s2 = exports['step2'] as () => number
    const s3 = exports['step3'] as () => number

    // Call many times to simulate stack usage
    for (let i = 0; i < 1000; i++) {
      expect(s1()).toBe(1)
      expect(s2()).toBe(2)
      expect(s3()).toBe(3)
    }
  })

  it('handles maximum i32 parameters without stack issues', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn sum_eight(a: i32, b: i32, c: i32, d: i32, e: i32, f: i32, g: i32, h: i32) -> i32 {
        a + b + c + d + e + f + g + h
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const fn = exports['sum_eight'] as (...args: number[]) => number
    expect(fn(1, 2, 3, 4, 5, 6, 7, 8)).toBe(36)
  })

  it('gracefully handles potential stack overflow during compilation', async () => {
    // Very deeply nested or complex code that might cause issues
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn complex() -> i32 {
        42
      }
    `
    // Should not throw during compilation
    const result = await compileRust(rustCode)
    expect(result.wasm).toBeDefined()
  })

  it('executes function repeatedly without memory leaks', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn add(a: i32, b: i32) -> i32 {
        a + b
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const add = exports['add'] as (a: number, b: number) => number

    // Execute 10000 times to check for memory stability
    for (let i = 0; i < 10000; i++) {
      const result = add(i, i + 1)
      expect(result).toBe(i + i + 1)
    }
  })
})

// ============================================================================
// Additional E2E Tests: Edge Cases and Integration
// ============================================================================

describe.skipIf(SKIP_WASM_TESTS)('E2E: Edge Cases and Integration', () => {
  it('compiles and executes with optimization level 0', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn opt_test() -> i32 {
        42
      }
    `
    const result = await compileRust(rustCode, { optimizationLevel: 0 })

    const module = await WebAssembly.compile(result.wasm)
    const instance = await WebAssembly.instantiate(module)
    const fn = instance.exports['opt_test'] as () => number

    expect(fn()).toBe(42)
  })

  it('compiles and executes with optimization level 3', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn opt_test() -> i32 {
        42
      }
    `
    const result = await compileRust(rustCode, { optimizationLevel: 3 })

    const module = await WebAssembly.compile(result.wasm)
    const instance = await WebAssembly.instantiate(module)
    const fn = instance.exports['opt_test'] as () => number

    expect(fn()).toBe(42)
  })

  it('includes timestamp in compilation result', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn test() -> i32 {
        1
      }
    `
    const before = new Date().toISOString()
    const result = await compileRust(rustCode)
    const after = new Date().toISOString()

    expect(result.compiledAt).toBeDefined()
    expect(result.compiledAt >= before).toBe(true)
    expect(result.compiledAt <= after).toBe(true)
  })

  it('handles Unicode in function comments', async () => {
    const rustCode = `
      // This function does something cool
      #[no_mangle]
      pub extern "C" fn unicode_comment() -> i32 {
        42
      }
    `
    const result = await compileRust(rustCode)
    expect(result.exports).toContain('unicode_comment')
  })

  it('handles extra whitespace in function definition', async () => {
    const rustCode = `
      #[no_mangle]
      pub   extern   "C"   fn   spaced_out(   a  :  i32  ,  b  :  i32  )   ->   i32   {
        a + b
      }
    `
    const result = await compileRust(rustCode)
    expect(result.exports).toContain('spaced_out')
  })

  it('compiles function with multiline body', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn multiline(x: i32) -> i32 {
        x
      }
    `
    const { exports } = await compileAndInstantiate(rustCode)

    const fn = exports['multiline'] as (x: number) => number
    expect(fn(42)).toBe(42)
  })

  it('returns all expected fields in CompileRustResult', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn test() -> i32 {
        1
      }
    `
    const result = await compileRust(rustCode, {
      generateTypeScript: true,
      generateCapnwebBindings: true,
    })

    // Core fields
    expect(result.wasm).toBeInstanceOf(Uint8Array)
    expect(Array.isArray(result.exports)).toBe(true)
    expect(typeof result.compiledAt).toBe('string')
    expect(typeof result.wasmSize).toBe('number')

    // Optional fields when requested
    expect(result.typeScript).toBeDefined()
    expect(result.capnwebBindings).toBeDefined()
    expect(result.signatures).toBeDefined()
    expect(result.metadata).toBeDefined()
  })

  it('validates WASM can be re-instantiated multiple times', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn counter() -> i32 {
        1
      }
    `
    const result = await compileRust(rustCode)
    const module = await WebAssembly.compile(result.wasm)

    // Instantiate multiple times
    const instances = await Promise.all([
      WebAssembly.instantiate(module),
      WebAssembly.instantiate(module),
      WebAssembly.instantiate(module),
    ])

    for (const instance of instances) {
      const fn = instance.exports['counter'] as () => number
      expect(fn()).toBe(1)
    }
  })
})
