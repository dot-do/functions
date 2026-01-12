/**
 * Zig to WASM Compilation Tests (RED)
 *
 * These tests validate the Zig to WebAssembly compilation pipeline for Functions.do.
 * The compiler is responsible for:
 * 1. Taking Zig source code and compiling it to WASM
 * 2. Producing valid WASM binary output with correct magic bytes
 * 3. Exporting the expected functions that can be loaded by Worker Loader
 * 4. Producing efficient binaries in the 10-100KB range
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the compileZig implementation does not exist yet.
 */

import { describe, it, expect } from 'vitest'
import { compileZig, type CompileZigResult, type FunctionSignature } from '../compile'

// WASM magic bytes: \0asm (0x00 0x61 0x73 0x6d)
const WASM_MAGIC_BYTES = {
  0: 0x00, // null byte
  1: 0x61, // 'a'
  2: 0x73, // 's'
  3: 0x6d, // 'm'
}

// WASM version 1 bytes (0x01 0x00 0x00 0x00)
const WASM_VERSION_1 = new Uint8Array([0x01, 0x00, 0x00, 0x00])

describe('Zig Compiler', () => {
  it('compiles Zig to WASM', async () => {
    const code = `
export fn hello() i32 {
    return 42;
}
`
    const result = await compileZig(code)

    // WASM magic bytes: \0asm
    expect(result.wasm[0]).toBe(0x00)
    expect(result.wasm[1]).toBe(0x61) // 'a'
    expect(result.wasm[2]).toBe(0x73) // 's'
    expect(result.wasm[3]).toBe(0x6d) // 'm'
  })

  it('produces valid WASM with correct version header', async () => {
    const code = `
export fn add(a: i32, b: i32) i32 {
    return a + b;
}
`
    const result = await compileZig(code)

    // WASM binary should have version 1 header after magic bytes
    expect(result.wasm[4]).toBe(0x01)
    expect(result.wasm[5]).toBe(0x00)
    expect(result.wasm[6]).toBe(0x00)
    expect(result.wasm[7]).toBe(0x00)
  })

  it('exports the function', async () => {
    const code = `
export fn hello() i32 {
    return 42;
}
`
    const result = await compileZig(code)
    expect(result.exports).toContain('hello')
  })

  it('produces reasonable binary size (10KB-100KB)', async () => {
    const code = `
export fn x() i32 {
    return 1;
}
`
    const result = await compileZig(code)
    // Zig produces very efficient WASM - should be in reasonable range
    expect(result.wasm.length).toBeLessThan(100 * 1024) // <100KB
    expect(result.wasm.length).toBeGreaterThan(100) // >100 bytes (minimal valid WASM)
  })

  it('returns a Uint8Array for the WASM binary', async () => {
    const code = `
export fn identity(x: i32) i32 {
    return x;
}
`
    const result = await compileZig(code)

    expect(result.wasm).toBeInstanceOf(Uint8Array)
    expect(result.wasm.length).toBeGreaterThan(8) // At least header size
  })

  it('produces WASM that can be instantiated', async () => {
    const code = `
export fn get_answer() i32 {
    return 42;
}
`
    const result = await compileZig(code)

    // The WASM should be instantiable without errors
    const wasmModule = await WebAssembly.compile(result.wasm)
    const wasmInstance = await WebAssembly.instantiate(wasmModule)

    expect(wasmInstance).toBeDefined()
    expect(wasmInstance.exports).toBeDefined()
  })

  it('produces WASM with executable functions', async () => {
    const code = `
export fn compute(x: i32) i32 {
    return x * 2 + 1;
}
`
    const result = await compileZig(code)

    const wasmModule = await WebAssembly.compile(result.wasm)
    const wasmInstance = await WebAssembly.instantiate(wasmModule)

    const compute = wasmInstance.exports.compute as (x: number) => number
    expect(compute(5)).toBe(11)
    expect(compute(10)).toBe(21)
    expect(compute(0)).toBe(1)
  })

  it('compiles multiple exported functions', async () => {
    const code = `
export fn add(a: i32, b: i32) i32 {
    return a + b;
}

export fn multiply(a: i32, b: i32) i32 {
    return a * b;
}

export fn subtract(a: i32, b: i32) i32 {
    return a - b;
}
`
    const result = await compileZig(code)

    expect(result.exports).toContain('add')
    expect(result.exports).toContain('multiply')
    expect(result.exports).toContain('subtract')
  })

  it('handles compilation errors gracefully', async () => {
    const invalidZigCode = `
export fn broken( i32 {  // Syntax error - missing parameter name and close paren
    return 42;
}
`

    await expect(compileZig(invalidZigCode)).rejects.toThrow()
  })

  it('includes compilation metadata', async () => {
    const code = `
export fn test() i32 {
    return 1;
}
`
    const result = await compileZig(code)

    expect(result.compiledAt).toBeDefined()
    expect(result.wasmSize).toBe(result.wasm.length)
  })

  it('extracts function signatures', async () => {
    const code = `
export fn add(a: i32, b: i32) i32 {
    return a + b;
}
`
    const result = await compileZig(code)

    expect(result.signatures).toBeDefined()
    expect(result.signatures).toHaveLength(1)
    expect(result.signatures![0].name).toBe('add')
    expect(result.signatures![0].params).toHaveLength(2)
    expect(result.signatures![0].params[0].name).toBe('a')
    expect(result.signatures![0].params[0].type).toBe('i32')
    expect(result.signatures![0].returnType).toBe('i32')
  })

  it('handles functions with different return types', async () => {
    const code = `
export fn get_float() f32 {
    return 3.14;
}

export fn get_double() f64 {
    return 2.718281828;
}

export fn get_long() i64 {
    return 9223372036854775807;
}
`
    const result = await compileZig(code)

    expect(result.exports).toContain('get_float')
    expect(result.exports).toContain('get_double')
    expect(result.exports).toContain('get_long')

    // Verify signatures have correct types
    const floatSig = result.signatures?.find((s) => s.name === 'get_float')
    expect(floatSig?.returnType).toBe('f32')

    const doubleSig = result.signatures?.find((s) => s.name === 'get_double')
    expect(doubleSig?.returnType).toBe('f64')

    const longSig = result.signatures?.find((s) => s.name === 'get_long')
    expect(longSig?.returnType).toBe('i64')
  })

  it('handles void functions', async () => {
    const code = `
export fn side_effect() void {
    // Does something with no return
}
`
    const result = await compileZig(code)

    expect(result.exports).toContain('side_effect')
    const sig = result.signatures?.find((s) => s.name === 'side_effect')
    expect(sig?.returnType).toBeNull()
  })
})

describe('Zig Binary Size Optimization', () => {
  it('produces binaries under 50KB for simple functions', async () => {
    const code = `
export fn simple() i32 {
    return 42;
}
`
    const result = await compileZig(code)
    // Zig is known for producing very small WASM binaries
    expect(result.wasm.length).toBeLessThan(50 * 1024) // <50KB
  })

  it('keeps binary size reasonable with multiple functions', async () => {
    const code = `
export fn fn1() i32 { return 1; }
export fn fn2() i32 { return 2; }
export fn fn3() i32 { return 3; }
export fn fn4() i32 { return 4; }
export fn fn5() i32 { return 5; }
`
    const result = await compileZig(code)
    // Even with multiple functions, should stay under 100KB
    expect(result.wasm.length).toBeLessThan(100 * 1024)
  })

  it('reports accurate wasmSize in metadata', async () => {
    const code = `
export fn test() i32 {
    return 42;
}
`
    const result = await compileZig(code)
    expect(result.wasmSize).toBe(result.wasm.length)
    expect(result.metadata?.sourceSize).toBe(code.length)
  })
})

describe('Zig Type Mapping', () => {
  it('maps Zig i32 to WASM i32', async () => {
    const code = `
export fn int_fn(x: i32) i32 {
    return x;
}
`
    const result = await compileZig(code)
    const sig = result.signatures?.find((s) => s.name === 'int_fn')
    expect(sig?.params[0].type).toBe('i32')
    expect(sig?.returnType).toBe('i32')
  })

  it('maps Zig u32 to WASM i32', async () => {
    const code = `
export fn uint_fn(x: u32) u32 {
    return x;
}
`
    const result = await compileZig(code)
    const sig = result.signatures?.find((s) => s.name === 'uint_fn')
    expect(sig?.params[0].type).toBe('u32')
    expect(sig?.returnType).toBe('u32')
  })

  it('maps Zig bool to WASM i32', async () => {
    const code = `
export fn bool_fn(x: bool) bool {
    return x;
}
`
    const result = await compileZig(code)
    const sig = result.signatures?.find((s) => s.name === 'bool_fn')
    expect(sig?.params[0].type).toBe('bool')
    expect(sig?.returnType).toBe('bool')
  })

  it('handles pointer types for WASM memory access', async () => {
    const code = `
export fn ptr_fn(ptr: [*]u8, len: usize) i32 {
    return 0;
}
`
    const result = await compileZig(code)
    const sig = result.signatures?.find((s) => s.name === 'ptr_fn')
    expect(sig?.params).toHaveLength(2)
    // Pointers become i32 in WASM
    expect(sig?.params[0].type).toBe('[*]u8')
    expect(sig?.params[1].type).toBe('usize')
  })
})

describe('TypeScript Type Generation', () => {
  it('generates TypeScript types from compilation result', async () => {
    const code = `
export fn add(a: i32, b: i32) i32 {
    return a + b;
}
`
    const result = await compileZig(code)

    expect(result.typescriptTypes).toBeDefined()
    expect(result.typescriptTypes).toContain('TypeScript type definitions')
    expect(result.typescriptTypes).toContain('ZigModuleExports')
    expect(result.typescriptTypes).toContain('add(a: number, b: number): number')
  })

  it('generates parameter interfaces', async () => {
    const code = `
export fn multiply(x: i32, y: i32) i32 {
    return x * y;
}
`
    const result = await compileZig(code)

    expect(result.typescriptTypes).toContain('MultiplyParams')
    expect(result.typescriptTypes).toContain('x: number')
    expect(result.typescriptTypes).toContain('y: number')
  })

  it('maps Zig types to TypeScript types correctly', async () => {
    const code = `
export fn types_demo(a: i32, b: i64, c: f32, d: f64, e: bool) i32 {
    return 0;
}
`
    const result = await compileZig(code)

    expect(result.typescriptTypes).toContain('a: number')
    expect(result.typescriptTypes).toContain('b: bigint')
    expect(result.typescriptTypes).toContain('c: number')
    expect(result.typescriptTypes).toContain('d: number')
    expect(result.typescriptTypes).toContain('e: boolean')
  })

  it('includes RPC target interface', async () => {
    const code = `
export fn hello() i32 {
    return 42;
}
`
    const result = await compileZig(code)

    expect(result.typescriptTypes).toContain('ZigModuleRpcTarget')
    expect(result.typescriptTypes).toContain('Promise<number>')
  })

  it('includes compilation result interface', async () => {
    const code = `
export fn test_fn() i32 {
    return 1;
}
`
    const result = await compileZig(code)

    expect(result.typescriptTypes).toContain('CompileResult')
    expect(result.typescriptTypes).toContain('wasm: Uint8Array')
    expect(result.typescriptTypes).toContain('exports: string[]')
  })

  it('handles void return types', async () => {
    const code = `
export fn no_return() void {
    // Nothing
}
`
    const result = await compileZig(code)

    expect(result.typescriptTypes).toContain('no_return(): void')
  })
})

describe('Capnweb Bindings Generation', () => {
  it('generates capnweb bindings from compilation result', async () => {
    const code = `
export fn add(a: i32, b: i32) i32 {
    return a + b;
}
`
    const result = await compileZig(code)

    expect(result.capnwebBindings).toBeDefined()
    expect(result.capnwebBindings).toContain('Capnweb RPC bindings')
    expect(result.capnwebBindings).toContain("import { RpcTarget } from 'capnweb'")
  })

  it('generates RpcTarget class', async () => {
    const code = `
export fn multiply(x: i32, y: i32) i32 {
    return x * y;
}
`
    const result = await compileZig(code)

    expect(result.capnwebBindings).toContain('class ZigModuleTarget extends RpcTarget')
    expect(result.capnwebBindings).toContain('private instance: WasmInstance')
    expect(result.capnwebBindings).toContain('multiply(x: number, y: number): number')
  })

  it('generates factory functions', async () => {
    const code = `
export fn test_fn() i32 {
    return 42;
}
`
    const result = await compileZig(code)

    expect(result.capnwebBindings).toContain('createZigModuleTarget(wasmBytes: Uint8Array)')
    expect(result.capnwebBindings).toContain('createZigModuleTargetFromModule(module: WebAssembly.Module)')
  })

  it('generates type guard function', async () => {
    const code = `
export fn hello() i32 {
    return 1;
}
`
    const result = await compileZig(code)

    expect(result.capnwebBindings).toContain('isZigModuleTarget(obj: unknown): obj is ZigModuleTarget')
  })

  it('includes memory accessor', async () => {
    const code = `
export fn ptr_fn(ptr: [*]u8, len: usize) i32 {
    return 0;
}
`
    const result = await compileZig(code)

    expect(result.capnwebBindings).toContain('get memory(): WebAssembly.Memory')
  })

  it('includes Symbol.dispose for resource cleanup', async () => {
    const code = `
export fn cleanup_test() void {
    // Test
}
`
    const result = await compileZig(code)

    expect(result.capnwebBindings).toContain('[Symbol.dispose](): void')
  })

  it('generates JSDoc comments', async () => {
    const code = `
export fn documented(a: i32, b: i32) i32 {
    return a + b;
}
`
    const result = await compileZig(code)

    expect(result.capnwebBindings).toContain('@param a - i32 parameter')
    expect(result.capnwebBindings).toContain('@param b - i32 parameter')
    expect(result.capnwebBindings).toContain('@returns i32 result')
  })

  it('generates example usage in comments', async () => {
    const code = `
export fn example_fn(x: i32) i32 {
    return x;
}
`
    const result = await compileZig(code)

    expect(result.capnwebBindings).toContain('@example')
    expect(result.capnwebBindings).toContain('createZigModuleTarget')
  })
})

describe('Multiple Functions Generation', () => {
  it('generates bindings for multiple functions', async () => {
    const code = `
export fn add(a: i32, b: i32) i32 {
    return a + b;
}

export fn subtract(a: i32, b: i32) i32 {
    return a - b;
}

export fn multiply(a: i32, b: i32) i32 {
    return a * b;
}
`
    const result = await compileZig(code)

    // TypeScript types should have all functions
    expect(result.typescriptTypes).toContain('add(a: number, b: number): number')
    expect(result.typescriptTypes).toContain('subtract(a: number, b: number): number')
    expect(result.typescriptTypes).toContain('multiply(a: number, b: number): number')

    // capnweb bindings should have all functions
    expect(result.capnwebBindings).toContain('add(a: number, b: number)')
    expect(result.capnwebBindings).toContain('subtract(a: number, b: number)')
    expect(result.capnwebBindings).toContain('multiply(a: number, b: number)')

    // Parameter interfaces
    expect(result.typescriptTypes).toContain('AddParams')
    expect(result.typescriptTypes).toContain('SubtractParams')
    expect(result.typescriptTypes).toContain('MultiplyParams')
  })

  it('handles mixed return types', async () => {
    const code = `
export fn get_int() i32 {
    return 42;
}

export fn get_float() f32 {
    return 3.14;
}

export fn get_long() i64 {
    return 1234567890;
}

export fn do_nothing() void {
    // Nothing
}
`
    const result = await compileZig(code)

    expect(result.typescriptTypes).toContain('get_int(): number')
    expect(result.typescriptTypes).toContain('get_float(): number')
    expect(result.typescriptTypes).toContain('get_long(): bigint')
    expect(result.typescriptTypes).toContain('do_nothing(): void')
  })
})
