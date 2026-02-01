/**
 * Go to WASM E2E Tests (RED)
 *
 * These tests are comprehensive end-to-end tests for the Go to WebAssembly
 * compilation pipeline using TinyGo. They test the full workflow from Go source
 * code to actual WASM execution.
 *
 * Test categories:
 * 1. Basic compilation - Simple Go functions to WASM with TinyGo
 * 2. Execution tests - Run compiled WASM and verify results
 * 3. Error handling - Go compilation errors
 * 4. go:wasmexport directives - Proper export handling
 * 5. TypeScript bindings - Generated type definitions
 * 6. Standard library imports - fmt, math, strings, etc.
 * 7. Memory limits - Memory allocation constraints
 * 8. Panic handling - Graceful panic recovery
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * until the full Go/TinyGo compilation pipeline is implemented.
 */

import { describe, it, expect } from 'vitest'
import { compileGo, type CompileResult, type CompileOptions } from '../compile'

/**
 * Helper to compile and instantiate WASM module
 */
async function compileAndInstantiate(
  code: string,
  options?: CompileOptions,
  imports?: WebAssembly.Imports
): Promise<{
  result: CompileResult
  instance: WebAssembly.Instance
  exports: WebAssembly.Exports
}> {
  const result = await compileGo(code, options)
  const module = await WebAssembly.compile(result.wasm)
  const instance = await WebAssembly.instantiate(module, imports)
  return { result, instance, exports: instance.exports }
}

// ============================================================================
// E2E Test: Compile Simple Go Function to WASM with TinyGo
// ============================================================================

describe('E2E: Compile Simple Go Function to WASM with TinyGo', () => {
  it('compiles a minimal Go function returning a constant', async () => {
    const goCode = `
package main

//go:wasmexport get_constant
func get_constant() int32 {
    return 42
}

func main() {}
`
    const result = await compileGo(goCode)

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

  it('compiles a function with two int32 parameters', async () => {
    const goCode = `
package main

//go:wasmexport add_numbers
func add_numbers(a, b int32) int32 {
    return a + b
}

func main() {}
`
    const result = await compileGo(goCode)

    expect(result.exports).toContain('add_numbers')
    expect(result.metadata).toBeDefined()
    expect(result.metadata?.wasmSize).toBeGreaterThan(0)
  })

  it('compiles a function with int64 parameters', async () => {
    const goCode = `
package main

//go:wasmexport add_big
func add_big(a, b int64) int64 {
    return a + b
}

func main() {}
`
    const result = await compileGo(goCode)

    expect(result.exports).toContain('add_big')
  })

  it('compiles a function with float32 parameters', async () => {
    const goCode = `
package main

//go:wasmexport multiply_floats
func multiply_floats(a, b float32) float32 {
    return a * b
}

func main() {}
`
    const result = await compileGo(goCode)

    expect(result.exports).toContain('multiply_floats')
  })

  it('compiles a function with float64 parameters', async () => {
    const goCode = `
package main

//go:wasmexport divide_doubles
func divide_doubles(a, b float64) float64 {
    return a / b
}

func main() {}
`
    const result = await compileGo(goCode)

    expect(result.exports).toContain('divide_doubles')
  })

  it('compiles multiple functions in a single module', async () => {
    const goCode = `
package main

//go:wasmexport add
func add(a, b int32) int32 {
    return a + b
}

//go:wasmexport subtract
func subtract(a, b int32) int32 {
    return a - b
}

//go:wasmexport multiply
func multiply(a, b int32) int32 {
    return a * b
}

//go:wasmexport negate
func negate(x int32) int32 {
    return -x
}

func main() {}
`
    const result = await compileGo(goCode)

    expect(result.exports).toContain('add')
    expect(result.exports).toContain('subtract')
    expect(result.exports).toContain('multiply')
    expect(result.exports).toContain('negate')
    expect(result.exports.length).toBe(4)
  })

  it('compiles a function with no return value', async () => {
    const goCode = `
package main

//go:wasmexport no_return
func no_return(x int32) {
    // Side effect only
}

func main() {}
`
    const result = await compileGo(goCode)

    expect(result.exports).toContain('no_return')
  })

  it('compiles a function with no parameters', async () => {
    const goCode = `
package main

//go:wasmexport zero_params
func zero_params() int32 {
    return 123
}

func main() {}
`
    const result = await compileGo(goCode)

    expect(result.exports).toContain('zero_params')
  })

  it('produces WASM within TinyGo target size limits (100KB-2MB)', async () => {
    const goCode = `
package main

//go:wasmexport simple
func simple() int32 {
    return 1
}

func main() {}
`
    const result = await compileGo(goCode)

    // TinyGo should produce compact WASM
    // Target: 100KB - 2MB for simple functions as per compiler docs
    expect(result.metadata?.wasmSize).toBeLessThan(2 * 1024 * 1024)
  })

  it('reports whether TinyGo was used in metadata', async () => {
    const goCode = `
package main

//go:wasmexport test
func test() int32 {
    return 1
}

func main() {}
`
    const result = await compileGo(goCode)

    expect(result.metadata).toBeDefined()
    expect(typeof result.metadata?.usedTinyGo).toBe('boolean')
  })
})

// ============================================================================
// E2E Test: Execute Compiled WASM and Get Correct Result
// ============================================================================

describe('E2E: Execute Compiled WASM and Get Correct Result', () => {
  it('executes a function returning a constant', async () => {
    const goCode = `
package main

//go:wasmexport answer
func answer() int32 {
    return 42
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const answer = exports['answer'] as () => number
    expect(answer()).toBe(42)
  })

  it('executes addition correctly', async () => {
    const goCode = `
package main

//go:wasmexport add
func add(a, b int32) int32 {
    return a + b
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const add = exports['add'] as (a: number, b: number) => number
    expect(add(2, 3)).toBe(5)
    expect(add(10, 20)).toBe(30)
    expect(add(-5, 5)).toBe(0)
    expect(add(0, 0)).toBe(0)
    expect(add(-10, -20)).toBe(-30)
  })

  it('executes subtraction correctly', async () => {
    const goCode = `
package main

//go:wasmexport subtract
func subtract(a, b int32) int32 {
    return a - b
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const subtract = exports['subtract'] as (a: number, b: number) => number
    expect(subtract(10, 3)).toBe(7)
    expect(subtract(5, 10)).toBe(-5)
    expect(subtract(0, 0)).toBe(0)
  })

  it('executes multiplication correctly', async () => {
    const goCode = `
package main

//go:wasmexport multiply
func multiply(a, b int32) int32 {
    return a * b
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const multiply = exports['multiply'] as (a: number, b: number) => number
    expect(multiply(6, 7)).toBe(42)
    expect(multiply(0, 100)).toBe(0)
    expect(multiply(-3, 4)).toBe(-12)
    expect(multiply(-5, -5)).toBe(25)
  })

  it('executes division correctly', async () => {
    const goCode = `
package main

//go:wasmexport divide
func divide(a, b int32) int32 {
    return a / b
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const divide = exports['divide'] as (a: number, b: number) => number
    expect(divide(10, 2)).toBe(5)
    expect(divide(7, 3)).toBe(2) // Go integer division
    expect(divide(-10, 3)).toBe(-3)
  })

  it('executes modulo correctly', async () => {
    const goCode = `
package main

//go:wasmexport modulo
func modulo(a, b int32) int32 {
    return a % b
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const modulo = exports['modulo'] as (a: number, b: number) => number
    expect(modulo(10, 3)).toBe(1)
    expect(modulo(10, 5)).toBe(0)
    expect(modulo(7, 2)).toBe(1)
  })

  it('executes complex expression correctly', async () => {
    const goCode = `
package main

//go:wasmexport compute
func compute(x int32) int32 {
    return x*2 + 1
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const compute = exports['compute'] as (x: number) => number
    expect(compute(5)).toBe(11)
    expect(compute(10)).toBe(21)
    expect(compute(0)).toBe(1)
    expect(compute(-5)).toBe(-9)
  })

  it('executes identity function correctly', async () => {
    const goCode = `
package main

//go:wasmexport identity
func identity(x int32) int32 {
    return x
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const identity = exports['identity'] as (x: number) => number
    expect(identity(42)).toBe(42)
    expect(identity(0)).toBe(0)
    expect(identity(-999)).toBe(-999)
  })

  it('executes multiple functions in same module', async () => {
    const goCode = `
package main

//go:wasmexport add
func add(a, b int32) int32 {
    return a + b
}

//go:wasmexport multiply
func multiply(a, b int32) int32 {
    return a * b
}

//go:wasmexport square
func square(x int32) int32 {
    return x * x
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const add = exports['add'] as (a: number, b: number) => number
    const multiply = exports['multiply'] as (a: number, b: number) => number
    const square = exports['square'] as (x: number) => number

    expect(add(3, 4)).toBe(7)
    expect(multiply(3, 4)).toBe(12)
    expect(square(5)).toBe(25)
  })

  it('handles int32 overflow correctly (wrapping)', async () => {
    const goCode = `
package main

//go:wasmexport overflow_add
func overflow_add(a, b int32) int32 {
    return a + b
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const add = exports['overflow_add'] as (a: number, b: number) => number
    // int32 max is 2147483647
    const result = add(2147483647, 1)
    // Should wrap to -2147483648
    expect(result).toBe(-2147483648)
  })

  it('executes negative constant correctly', async () => {
    const goCode = `
package main

//go:wasmexport negative
func negative() int32 {
    return -42
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const negative = exports['negative'] as () => number
    expect(negative()).toBe(-42)
  })

  it('executes zero correctly', async () => {
    const goCode = `
package main

//go:wasmexport zero
func zero() int32 {
    return 0
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const zero = exports['zero'] as () => number
    expect(zero()).toBe(0)
  })

  it('executes bitwise AND correctly', async () => {
    const goCode = `
package main

//go:wasmexport bitwise_and
func bitwise_and(a, b int32) int32 {
    return a & b
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const bitwiseAnd = exports['bitwise_and'] as (a: number, b: number) => number
    expect(bitwiseAnd(0b1010, 0b1100)).toBe(0b1000)
    expect(bitwiseAnd(0xFF, 0x0F)).toBe(0x0F)
  })

  it('executes bitwise OR correctly', async () => {
    const goCode = `
package main

//go:wasmexport bitwise_or
func bitwise_or(a, b int32) int32 {
    return a | b
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const bitwiseOr = exports['bitwise_or'] as (a: number, b: number) => number
    expect(bitwiseOr(0b1010, 0b0101)).toBe(0b1111)
  })

  it('executes left shift correctly', async () => {
    const goCode = `
package main

//go:wasmexport left_shift
func left_shift(x, n int32) int32 {
    return x << n
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const leftShift = exports['left_shift'] as (x: number, n: number) => number
    expect(leftShift(1, 4)).toBe(16)
    expect(leftShift(5, 2)).toBe(20)
  })
})

// ============================================================================
// E2E Test: Handle Go Compilation Errors
// ============================================================================

describe('E2E: Handle Go Compilation Errors', () => {
  it('throws on missing closing brace in function', async () => {
    const invalidCode = `
package main

//go:wasmexport broken
func broken() int32 {
    return 42

func main() {}
`
    await expect(compileGo(invalidCode)).rejects.toThrow()
  })

  it('throws on syntax error in function body', async () => {
    const invalidCode = `
package main

//go:wasmexport broken
func broken() int32 {
    return 42 +
}

func main() {}
`
    await expect(compileGo(invalidCode)).rejects.toThrow()
  })

  it('throws on type mismatch in return', async () => {
    const invalidCode = `
package main

//go:wasmexport broken
func broken() int32 {
    return "not an int"
}

func main() {}
`
    await expect(compileGo(invalidCode)).rejects.toThrow()
  })

  it('throws on undefined variable', async () => {
    const invalidCode = `
package main

//go:wasmexport broken
func broken() int32 {
    return undefined_var
}

func main() {}
`
    await expect(compileGo(invalidCode)).rejects.toThrow()
  })

  it('throws when no go:wasmexport directives are found', async () => {
    const noExportsCode = `
package main

func helper() int32 {
    return 42
}

func main() {}
`
    await expect(compileGo(noExportsCode)).rejects.toThrow(/no.*export/i)
  })

  it('throws on empty input', async () => {
    await expect(compileGo('')).rejects.toThrow()
  })

  it('throws on whitespace-only input', async () => {
    await expect(compileGo('   \n\t  ')).rejects.toThrow()
  })

  it('throws on missing package declaration', async () => {
    const noPackageCode = `
//go:wasmexport test
func test() int32 {
    return 42
}
`
    await expect(compileGo(noPackageCode)).rejects.toThrow()
  })

  it('throws error with helpful message for undefined imports', async () => {
    const undefinedImport = `
package main

import "nonexistent/package"

//go:wasmexport test
func test() int32 {
    return 42
}

func main() {}
`
    await expect(compileGo(undefinedImport)).rejects.toThrow()
  })

  it('throws on invalid Go keyword usage', async () => {
    const invalidKeyword = `
package main

//go:wasmexport func
func func() int32 {
    return 42
}

func main() {}
`
    await expect(compileGo(invalidKeyword)).rejects.toThrow()
  })

  it('throws on mismatched parentheses', async () => {
    const mismatchedParens = `
package main

//go:wasmexport broken
func broken(a int32 int32 {
    return a
}

func main() {}
`
    await expect(compileGo(mismatchedParens)).rejects.toThrow()
  })
})

// ============================================================================
// E2E Test: Support //go:wasmexport Directives
// ============================================================================

describe('E2E: Support //go:wasmexport Directives', () => {
  it('exports function with exact name from go:wasmexport', async () => {
    const goCode = `
package main

//go:wasmexport exact_export_name
func exact_export_name() int32 {
    return 1
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    expect(exports['exact_export_name']).toBeDefined()
    expect(typeof exports['exact_export_name']).toBe('function')
  })

  it('exports function with snake_case name', async () => {
    const goCode = `
package main

//go:wasmexport my_snake_case_function
func my_snake_case_function() int32 {
    return 42
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    expect(exports['my_snake_case_function']).toBeDefined()
    const fn = exports['my_snake_case_function'] as () => number
    expect(fn()).toBe(42)
  })

  it('exports function with different export name than Go function name', async () => {
    const goCode = `
package main

//go:wasmexport external_name
func internalGoFunctionName() int32 {
    return 123
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    expect(exports['external_name']).toBeDefined()
    const fn = exports['external_name'] as () => number
    expect(fn()).toBe(123)
  })

  it('exports function with single character name', async () => {
    const goCode = `
package main

//go:wasmexport x
func x() int32 {
    return 1
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    expect(exports['x']).toBeDefined()
    const fn = exports['x'] as () => number
    expect(fn()).toBe(1)
  })

  it('exports function with numeric suffix in name', async () => {
    const goCode = `
package main

//go:wasmexport func123
func func123() int32 {
    return 123
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    expect(exports['func123']).toBeDefined()
    const fn = exports['func123'] as () => number
    expect(fn()).toBe(123)
  })

  it('exports multiple functions with different signatures', async () => {
    const goCode = `
package main

//go:wasmexport zero_args
func zero_args() int32 {
    return 0
}

//go:wasmexport one_arg
func one_arg(x int32) int32 {
    return x
}

//go:wasmexport two_args
func two_args(a, b int32) int32 {
    return a + b
}

//go:wasmexport three_args
func three_args(a, b, c int32) int32 {
    return a + b + c
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const zero = exports['zero_args'] as () => number
    const one = exports['one_arg'] as (x: number) => number
    const two = exports['two_args'] as (a: number, b: number) => number
    const three = exports['three_args'] as (a: number, b: number, c: number) => number

    expect(zero()).toBe(0)
    expect(one(42)).toBe(42)
    expect(two(1, 2)).toBe(3)
    expect(three(1, 2, 3)).toBe(6)
  })

  it('does not export functions without go:wasmexport', async () => {
    const goCode = `
package main

//go:wasmexport exported
func exported() int32 {
    return 1
}

// This should NOT be exported
func internal() int32 {
    return 2
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    expect(exports['exported']).toBeDefined()
    expect(exports['internal']).toBeUndefined()
  })

  it('handles underscore-prefixed export names', async () => {
    const goCode = `
package main

//go:wasmexport _private_looking
func _private_looking() int32 {
    return 42
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    expect(exports['_private_looking']).toBeDefined()
    const fn = exports['_private_looking'] as () => number
    expect(fn()).toBe(42)
  })

  it('handles go:wasmexport with documentation comment', async () => {
    const goCode = `
package main

// Calculate computes a value
//go:wasmexport calculate
func calculate(x int32) int32 {
    return x * 2
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    expect(exports['calculate']).toBeDefined()
    const fn = exports['calculate'] as (x: number) => number
    expect(fn(5)).toBe(10)
  })
})

// ============================================================================
// E2E Test: Generate TypeScript Bindings
// ============================================================================

describe('E2E: Generate TypeScript Bindings', () => {
  it('generates TypeScript types for simple function', async () => {
    const goCode = `
package main

//go:wasmexport add
func add(a, b int32) int32 {
    return a + b
}

func main() {}
`
    const result = await compileGo(goCode, { generateTypes: true })

    expect(result.typescriptTypes).toBeDefined()
    expect(result.typescriptTypes).toContain('interface')
    expect(result.typescriptTypes).toContain('add')
  })

  it('generates WasmExports interface', async () => {
    const goCode = `
package main

//go:wasmexport compute
func compute(x int32) int32 {
    return x * 2
}

func main() {}
`
    const result = await compileGo(goCode, { generateTypes: true })

    expect(result.typescriptTypes).toContain('Exports')
    expect(result.typescriptTypes).toContain('compute')
  })

  it('generates RpcTarget interface with Promise types', async () => {
    const goCode = `
package main

//go:wasmexport async_compute
func async_compute(x int32) int32 {
    return x
}

func main() {}
`
    const result = await compileGo(goCode, { generateTypes: true })

    expect(result.typescriptTypes).toContain('RpcTarget')
    expect(result.typescriptTypes).toContain('Promise')
  })

  it('maps int32 to number', async () => {
    const goCode = `
package main

//go:wasmexport int32_fn
func int32_fn(x int32) int32 {
    return x
}

func main() {}
`
    const result = await compileGo(goCode, { generateTypes: true })

    expect(result.typescriptTypes).toContain('number')
  })

  it('maps int64 to bigint', async () => {
    const goCode = `
package main

//go:wasmexport int64_fn
func int64_fn(x int64) int64 {
    return x
}

func main() {}
`
    const result = await compileGo(goCode, { generateTypes: true })

    expect(result.typescriptTypes).toContain('bigint')
  })

  it('maps float32 to number', async () => {
    const goCode = `
package main

//go:wasmexport float32_fn
func float32_fn(x float32) float32 {
    return x
}

func main() {}
`
    const result = await compileGo(goCode, { generateTypes: true })

    expect(result.typescriptTypes).toContain('number')
  })

  it('maps float64 to number', async () => {
    const goCode = `
package main

//go:wasmexport float64_fn
func float64_fn(x float64) float64 {
    return x
}

func main() {}
`
    const result = await compileGo(goCode, { generateTypes: true })

    expect(result.typescriptTypes).toContain('number')
  })

  it('maps bool to boolean', async () => {
    const goCode = `
package main

//go:wasmexport bool_fn
func bool_fn(x bool) bool {
    return x
}

func main() {}
`
    const result = await compileGo(goCode, { generateTypes: true })

    expect(result.typescriptTypes).toContain('boolean')
  })

  it('handles void return type', async () => {
    const goCode = `
package main

//go:wasmexport void_fn
func void_fn(x int32) {
}

func main() {}
`
    const result = await compileGo(goCode, { generateTypes: true })

    expect(result.typescriptTypes).toContain('void')
  })

  it('generates types for multiple functions', async () => {
    const goCode = `
package main

//go:wasmexport add
func add(a, b int32) int32 {
    return a + b
}

//go:wasmexport multiply
func multiply(a, b int32) int32 {
    return a * b
}

func main() {}
`
    const result = await compileGo(goCode, { generateTypes: true })

    expect(result.typescriptTypes).toContain('add')
    expect(result.typescriptTypes).toContain('multiply')
  })

  it('generates capnweb bindings when requested', async () => {
    const goCode = `
package main

//go:wasmexport process
func process(x, y int32) int32 {
    return x + y
}

func main() {}
`
    const result = await compileGo(goCode, { generateBindings: true })

    expect(result.capnwebBindings).toBeDefined()
    expect(result.capnwebBindings).toContain('RpcTarget')
    expect(result.capnwebBindings).toContain('process')
  })

  it('generates parameter interfaces', async () => {
    const goCode = `
package main

//go:wasmexport calculate
func calculate(a, b int32) int32 {
    return a + b
}

func main() {}
`
    const result = await compileGo(goCode, { generateTypes: true })

    expect(result.typescriptTypes).toContain('Params')
  })
})

// ============================================================================
// E2E Test: Handle Standard Library Imports
// ============================================================================

describe('E2E: Handle Standard Library Imports', () => {
  it('compiles code without imports', async () => {
    const goCode = `
package main

//go:wasmexport standalone
func standalone() int32 {
    return 42
}

func main() {}
`
    const result = await compileGo(goCode)

    expect(result.wasm).toBeDefined()
    expect(result.exports).toContain('standalone')
  })

  it('handles math operations without imports', async () => {
    const goCode = `
package main

//go:wasmexport abs
func abs(x int32) int32 {
    if x < 0 {
        return -x
    }
    return x
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const abs = exports['abs'] as (x: number) => number
    expect(abs(-5)).toBe(5)
    expect(abs(5)).toBe(5)
    expect(abs(0)).toBe(0)
  })

  it('handles min/max logic without imports', async () => {
    const goCode = `
package main

//go:wasmexport min
func min(a, b int32) int32 {
    if a < b {
        return a
    }
    return b
}

//go:wasmexport max
func max(a, b int32) int32 {
    if a > b {
        return a
    }
    return b
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const minFn = exports['min'] as (a: number, b: number) => number
    const maxFn = exports['max'] as (a: number, b: number) => number

    expect(minFn(3, 7)).toBe(3)
    expect(maxFn(3, 7)).toBe(7)
  })

  it('handles control flow with if/else', async () => {
    const goCode = `
package main

//go:wasmexport classify
func classify(x int32) int32 {
    if x < 0 {
        return -1
    } else if x > 0 {
        return 1
    } else {
        return 0
    }
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const classify = exports['classify'] as (x: number) => number
    expect(classify(-5)).toBe(-1)
    expect(classify(5)).toBe(1)
    expect(classify(0)).toBe(0)
  })

  it('handles for loop', async () => {
    const goCode = `
package main

//go:wasmexport sum_to_n
func sum_to_n(n int32) int32 {
    var sum int32 = 0
    for i := int32(1); i <= n; i++ {
        sum += i
    }
    return sum
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const sumToN = exports['sum_to_n'] as (n: number) => number
    expect(sumToN(5)).toBe(15) // 1+2+3+4+5
    expect(sumToN(10)).toBe(55)
    expect(sumToN(0)).toBe(0)
  })

  it('handles switch statement', async () => {
    const goCode = `
package main

//go:wasmexport day_type
func day_type(day int32) int32 {
    switch day {
    case 0, 6:
        return 0 // weekend
    case 1, 2, 3, 4, 5:
        return 1 // weekday
    default:
        return -1 // invalid
    }
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const dayType = exports['day_type'] as (day: number) => number
    expect(dayType(0)).toBe(0) // Sunday - weekend
    expect(dayType(6)).toBe(0) // Saturday - weekend
    expect(dayType(1)).toBe(1) // Monday - weekday
    expect(dayType(7)).toBe(-1) // Invalid
  })

  it('handles local variables', async () => {
    const goCode = `
package main

//go:wasmexport with_locals
func with_locals(x int32) int32 {
    a := x * 2
    b := a + 10
    c := b / 2
    return c
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const withLocals = exports['with_locals'] as (x: number) => number
    // x=5 -> a=10 -> b=20 -> c=10
    expect(withLocals(5)).toBe(10)
  })

  it('handles calling internal functions', async () => {
    const goCode = `
package main

func helper(x int32) int32 {
    return x * 2
}

//go:wasmexport with_helper
func with_helper(x int32) int32 {
    return helper(x) + 1
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const withHelper = exports['with_helper'] as (x: number) => number
    expect(withHelper(5)).toBe(11) // (5*2) + 1
  })
})

// ============================================================================
// E2E Test: Memory Limits
// ============================================================================

describe('E2E: Memory Limits', () => {
  it('produces WASM that can be instantiated with default memory', async () => {
    const goCode = `
package main

//go:wasmexport memory_test
func memory_test() int32 {
    return 42
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const fn = exports['memory_test'] as () => number
    expect(fn()).toBe(42)
  })

  it('produces WASM with reasonable initial size for simple functions', async () => {
    const goCode = `
package main

//go:wasmexport simple
func simple() int32 {
    return 1
}

func main() {}
`
    const result = await compileGo(goCode)

    // Simple functions should have minimal size
    // TinyGo target: 100KB - 2MB
    expect(result.metadata?.wasmSize).toBeLessThan(2 * 1024 * 1024)
  })

  it('handles functions that return large values', async () => {
    const goCode = `
package main

//go:wasmexport large_value
func large_value() int32 {
    return 2147483647
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const fn = exports['large_value'] as () => number
    expect(fn()).toBe(2147483647) // int32 max
  })

  it('handles negative boundary values', async () => {
    const goCode = `
package main

//go:wasmexport min_value
func min_value() int32 {
    return -2147483648
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const fn = exports['min_value'] as () => number
    expect(fn()).toBe(-2147483648) // int32 min
  })

  it('can instantiate with custom memory limits', async () => {
    const goCode = `
package main

//go:wasmexport test
func test() int32 {
    return 42
}

func main() {}
`
    const result = await compileGo(goCode)

    // Try to instantiate with explicit memory import
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 10 })
    const module = await WebAssembly.compile(result.wasm)

    // The module may or may not require memory import depending on TinyGo output
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

  it('enforces WASM size under TinyGo target limit', async () => {
    const goCode = `
package main

//go:wasmexport a
func a() int32 { return 1 }

//go:wasmexport b
func b() int32 { return 2 }

//go:wasmexport c
func c() int32 { return 3 }

func main() {}
`
    const result = await compileGo(goCode)

    // Per compiler docs: Target 100KB-2MB output size optimization
    expect(result.metadata?.wasmSize).toBeLessThan(2 * 1024 * 1024)
  })

  it('reports accurate WASM size in metadata', async () => {
    const goCode = `
package main

//go:wasmexport test
func test() int32 {
    return 1
}

func main() {}
`
    const result = await compileGo(goCode)

    expect(result.metadata?.wasmSize).toBe(result.wasm.length)
    expect(result.metadata?.wasmSize).toBeGreaterThan(0)
  })

  it('includes optimization level in metadata when specified', async () => {
    const goCode = `
package main

//go:wasmexport test
func test() int32 {
    return 1
}

func main() {}
`
    const result = await compileGo(goCode, { optimizationLevel: 's' })

    expect(result.metadata).toBeDefined()
    // Optimization level should be recorded if TinyGo was used
    if (result.metadata?.usedTinyGo) {
      expect(result.metadata?.optimizationLevel).toBe('s')
    }
  })
})

// ============================================================================
// E2E Test: Panic Handling
// ============================================================================

describe('E2E: Panic Handling', () => {
  it('compiles function that could potentially panic', async () => {
    const goCode = `
package main

//go:wasmexport safe_divide
func safe_divide(a, b int32) int32 {
    if b == 0 {
        return 0 // Avoid panic by returning 0
    }
    return a / b
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const safeDivide = exports['safe_divide'] as (a: number, b: number) => number
    expect(safeDivide(10, 2)).toBe(5)
    expect(safeDivide(10, 0)).toBe(0) // Safe handling
  })

  it('handles function with bounds checking', async () => {
    const goCode = `
package main

//go:wasmexport clamp
func clamp(x, min, max int32) int32 {
    if x < min {
        return min
    }
    if x > max {
        return max
    }
    return x
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const clamp = exports['clamp'] as (x: number, min: number, max: number) => number
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
  })

  it('handles recursive function with base case', async () => {
    const goCode = `
package main

//go:wasmexport factorial
func factorial(n int32) int32 {
    if n <= 1 {
        return 1
    }
    return n * factorial(n-1)
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const factorial = exports['factorial'] as (n: number) => number
    expect(factorial(0)).toBe(1)
    expect(factorial(1)).toBe(1)
    expect(factorial(5)).toBe(120)
    expect(factorial(10)).toBe(3628800)
  })

  it('handles fibonacci with recursion', async () => {
    const goCode = `
package main

//go:wasmexport fibonacci
func fibonacci(n int32) int32 {
    if n <= 1 {
        return n
    }
    return fibonacci(n-1) + fibonacci(n-2)
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const fibonacci = exports['fibonacci'] as (n: number) => number
    expect(fibonacci(0)).toBe(0)
    expect(fibonacci(1)).toBe(1)
    expect(fibonacci(10)).toBe(55)
  })

  it('handles iterative fibonacci (no recursion)', async () => {
    const goCode = `
package main

//go:wasmexport fibonacci_iter
func fibonacci_iter(n int32) int32 {
    if n <= 1 {
        return n
    }
    var a, b int32 = 0, 1
    for i := int32(2); i <= n; i++ {
        a, b = b, a+b
    }
    return b
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const fib = exports['fibonacci_iter'] as (n: number) => number
    expect(fib(0)).toBe(0)
    expect(fib(1)).toBe(1)
    expect(fib(10)).toBe(55)
    expect(fib(20)).toBe(6765)
  })

  it('handles function with many parameters without stack issues', async () => {
    const goCode = `
package main

//go:wasmexport sum_eight
func sum_eight(a, b, c, d, e, f, g, h int32) int32 {
    return a + b + c + d + e + f + g + h
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const fn = exports['sum_eight'] as (...args: number[]) => number
    expect(fn(1, 2, 3, 4, 5, 6, 7, 8)).toBe(36)
  })

  it('executes function repeatedly without memory leaks', async () => {
    const goCode = `
package main

//go:wasmexport add
func add(a, b int32) int32 {
    return a + b
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const add = exports['add'] as (a: number, b: number) => number

    // Execute 10000 times to check for memory stability
    for (let i = 0; i < 10000; i++) {
      const result = add(i, i + 1)
      expect(result).toBe(i + i + 1)
    }
  })

  it('handles multiple function calls in sequence', async () => {
    const goCode = `
package main

//go:wasmexport step1
func step1() int32 {
    return 1
}

//go:wasmexport step2
func step2() int32 {
    return 2
}

//go:wasmexport step3
func step3() int32 {
    return 3
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

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
})

// ============================================================================
// Additional E2E Tests: Edge Cases and Integration
// ============================================================================

describe('E2E: Edge Cases and Integration', () => {
  it('compiles and executes with optimization level s', async () => {
    const goCode = `
package main

//go:wasmexport opt_test
func opt_test() int32 {
    return 42
}

func main() {}
`
    const result = await compileGo(goCode, { optimizationLevel: 's' })

    const module = await WebAssembly.compile(result.wasm)
    const instance = await WebAssembly.instantiate(module)
    const fn = instance.exports['opt_test'] as () => number

    expect(fn()).toBe(42)
  })

  it('compiles and executes with optimization level z', async () => {
    const goCode = `
package main

//go:wasmexport opt_test
func opt_test() int32 {
    return 42
}

func main() {}
`
    const result = await compileGo(goCode, { optimizationLevel: 'z' })

    const module = await WebAssembly.compile(result.wasm)
    const instance = await WebAssembly.instantiate(module)
    const fn = instance.exports['opt_test'] as () => number

    expect(fn()).toBe(42)
  })

  it('includes timestamp in compilation result', async () => {
    const goCode = `
package main

//go:wasmexport test
func test() int32 {
    return 1
}

func main() {}
`
    const before = new Date().toISOString()
    const result = await compileGo(goCode)
    const after = new Date().toISOString()

    expect(result.metadata?.compiledAt).toBeDefined()
    expect(result.metadata!.compiledAt >= before).toBe(true)
    expect(result.metadata!.compiledAt <= after).toBe(true)
  })

  it('handles extra whitespace in function definition', async () => {
    const goCode = `
package main

//go:wasmexport   spaced_out
func   spaced_out(   a   int32  ,   b   int32   )   int32   {
    return a + b
}

func main() {}
`
    const result = await compileGo(goCode)
    expect(result.exports).toContain('spaced_out')
  })

  it('compiles function with multiline body', async () => {
    const goCode = `
package main

//go:wasmexport multiline
func multiline(x int32) int32 {
    result := x
    result = result * 2
    result = result + 1
    return result
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const fn = exports['multiline'] as (x: number) => number
    expect(fn(5)).toBe(11) // (5*2)+1
  })

  it('returns all expected fields in CompileResult', async () => {
    const goCode = `
package main

//go:wasmexport test
func test() int32 {
    return 1
}

func main() {}
`
    const result = await compileGo(goCode, {
      generateTypes: true,
      generateBindings: true,
    })

    // Core fields
    expect(result.wasm).toBeInstanceOf(Uint8Array)
    expect(Array.isArray(result.exports)).toBe(true)

    // Metadata fields
    expect(result.metadata).toBeDefined()
    expect(typeof result.metadata?.compiledAt).toBe('string')
    expect(typeof result.metadata?.wasmSize).toBe('number')
    expect(typeof result.metadata?.usedTinyGo).toBe('boolean')

    // Optional fields when requested
    expect(result.typescriptTypes).toBeDefined()
    expect(result.capnwebBindings).toBeDefined()
  })

  it('validates WASM can be re-instantiated multiple times', async () => {
    const goCode = `
package main

//go:wasmexport counter
func counter() int32 {
    return 1
}

func main() {}
`
    const result = await compileGo(goCode)
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

  it('handles boolean parameters and returns', async () => {
    const goCode = `
package main

//go:wasmexport is_positive
func is_positive(x int32) bool {
    return x > 0
}

//go:wasmexport negate_bool
func negate_bool(b bool) bool {
    return !b
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const isPositive = exports['is_positive'] as (x: number) => number
    const negateBool = exports['negate_bool'] as (b: number) => number

    // WASM represents bool as i32 (0 or 1)
    expect(isPositive(5)).toBe(1)
    expect(isPositive(-5)).toBe(0)
    expect(isPositive(0)).toBe(0)
    expect(negateBool(1)).toBe(0)
    expect(negateBool(0)).toBe(1)
  })

  it('handles uint32 type', async () => {
    const goCode = `
package main

//go:wasmexport unsigned_add
func unsigned_add(a, b uint32) uint32 {
    return a + b
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const add = exports['unsigned_add'] as (a: number, b: number) => number
    expect(add(100, 200)).toBe(300)
  })

  it('handles byte type (alias for uint8)', async () => {
    const goCode = `
package main

//go:wasmexport byte_add
func byte_add(a, b byte) byte {
    return a + b
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const add = exports['byte_add'] as (a: number, b: number) => number
    expect(add(10, 20)).toBe(30)
  })

  it('handles multiple return types via struct (future feature)', async () => {
    // For now, Go WASM only supports single return values
    // This test documents the limitation
    const goCode = `
package main

//go:wasmexport single_return
func single_return(a, b int32) int32 {
    // Can only return single value in WASM export
    return a + b
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const fn = exports['single_return'] as (a: number, b: number) => number
    expect(fn(3, 4)).toBe(7)
  })

  it('handles GCD algorithm', async () => {
    const goCode = `
package main

//go:wasmexport gcd
func gcd(a, b int32) int32 {
    for b != 0 {
        a, b = b, a%b
    }
    return a
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const gcdFn = exports['gcd'] as (a: number, b: number) => number
    expect(gcdFn(48, 18)).toBe(6)
    expect(gcdFn(100, 25)).toBe(25)
    expect(gcdFn(17, 13)).toBe(1)
  })

  it('handles power function', async () => {
    const goCode = `
package main

//go:wasmexport power
func power(base, exp int32) int32 {
    result := int32(1)
    for exp > 0 {
        result *= base
        exp--
    }
    return result
}

func main() {}
`
    const { exports } = await compileAndInstantiate(goCode)

    const power = exports['power'] as (base: number, exp: number) => number
    expect(power(2, 0)).toBe(1)
    expect(power(2, 1)).toBe(2)
    expect(power(2, 8)).toBe(256)
    expect(power(3, 4)).toBe(81)
  })
})
