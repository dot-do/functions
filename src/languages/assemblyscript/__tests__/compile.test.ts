/**
 * AssemblyScript to WASM Compilation Tests (RED)
 *
 * These tests validate the AssemblyScript to WebAssembly compilation pipeline for Functions.do.
 * The compiler is responsible for:
 * 1. Compiling AssemblyScript function code to WASM via asc (AssemblyScript compiler)
 * 2. Producing valid WASM binary output with correct magic bytes
 * 3. Exporting the expected functions that can be loaded by Worker Loader
 * 4. Producing small binaries (5-20KB for simple functions)
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the compileAssemblyScript implementation does not exist yet.
 */

import { describe, it, expect } from 'vitest'
import { compileAssemblyScript, generateTypeScriptTypes, generateCapnwebBindings, FunctionSignature } from '../compile'

// WASM magic bytes: \0asm (0x00 0x61 0x73 0x6d)
const WASM_MAGIC_BYTES = [0x00, 0x61, 0x73, 0x6d] as const

// WASM version 1 bytes (0x01 0x00 0x00 0x00)
const WASM_VERSION_1 = [0x01, 0x00, 0x00, 0x00] as const

describe('AssemblyScript Compiler', () => {
  it('compiles AssemblyScript to WASM', async () => {
    const code = `
export function hello(): i32 {
  return 42
}
`
    const result = await compileAssemblyScript(code)

    // WASM magic bytes: \0asm
    expect(result.wasm[0]).toBe(0x00)
    expect(result.wasm[1]).toBe(0x61) // 'a'
    expect(result.wasm[2]).toBe(0x73) // 's'
    expect(result.wasm[3]).toBe(0x6d) // 'm'
  })

  it('produces valid WASM with correct version header', async () => {
    const code = `
export function add(a: i32, b: i32): i32 {
  return a + b
}
`
    const result = await compileAssemblyScript(code)

    // WASM binary should have version 1 header after magic bytes
    expect(result.wasm[4]).toBe(0x01)
    expect(result.wasm[5]).toBe(0x00)
    expect(result.wasm[6]).toBe(0x00)
    expect(result.wasm[7]).toBe(0x00)
  })

  it('exports the function', async () => {
    const code = `
export function hello(): i32 {
  return 42
}
`
    const result = await compileAssemblyScript(code)
    expect(result.exports).toContain('hello')
  })

  it('produces small binaries', async () => {
    const code = `
export function x(): i32 {
  return 1
}
`
    const result = await compileAssemblyScript(code)
    // AssemblyScript should produce very small binaries (<20KB for simple functions)
    expect(result.wasm.length).toBeLessThan(20 * 1024)
    // And should be at least a few KB (not empty)
    expect(result.wasm.length).toBeGreaterThan(100)
  })

  // WebAssembly.compile() is disallowed by the Workers runtime embedder (miniflare)
  it.skip('produces WASM that can be instantiated', async () => {
    const code = `
export function getAnswer(): i32 {
  return 42
}
`
    const result = await compileAssemblyScript(code)

    // The WASM should be instantiable without errors
    const wasmModule = await WebAssembly.compile(result.wasm)
    const wasmInstance = await WebAssembly.instantiate(wasmModule)

    expect(wasmInstance).toBeDefined()
    expect(wasmInstance.exports).toBeDefined()
  })

  // WebAssembly.compile() is disallowed by the Workers runtime embedder (miniflare)
  it.skip('produces WASM with executable functions', async () => {
    const code = `
export function compute(x: i32): i32 {
  return x * 2 + 1
}
`
    const result = await compileAssemblyScript(code)

    const wasmModule = await WebAssembly.compile(result.wasm)
    const wasmInstance = await WebAssembly.instantiate(wasmModule)

    const compute = wasmInstance.exports['compute'] as (x: number) => number
    expect(compute(5)).toBe(11)
    expect(compute(10)).toBe(21)
    expect(compute(0)).toBe(1)
  })

  // WebAssembly.compile() is disallowed by the Workers runtime embedder (miniflare)
  it.skip('compiles multiple exported functions', async () => {
    const code = `
export function add(a: i32, b: i32): i32 {
  return a + b
}

export function multiply(a: i32, b: i32): i32 {
  return a * b
}

export function subtract(a: i32, b: i32): i32 {
  return a - b
}
`
    const result = await compileAssemblyScript(code)

    expect(result.exports).toContain('add')
    expect(result.exports).toContain('multiply')
    expect(result.exports).toContain('subtract')

    // Verify the functions work
    const wasmModule = await WebAssembly.compile(result.wasm)
    const wasmInstance = await WebAssembly.instantiate(wasmModule)

    const add = wasmInstance.exports['add'] as (a: number, b: number) => number
    const multiply = wasmInstance.exports['multiply'] as (a: number, b: number) => number
    const subtract = wasmInstance.exports['subtract'] as (a: number, b: number) => number

    expect(add(5, 3)).toBe(8)
    expect(multiply(6, 7)).toBe(42)
    expect(subtract(10, 4)).toBe(6)
  })

  it('returns a Uint8Array for the WASM binary', async () => {
    const code = `
export function identity(x: i32): i32 {
  return x
}
`
    const result = await compileAssemblyScript(code)

    expect(result.wasm).toBeInstanceOf(Uint8Array)
    expect(result.wasm.length).toBeGreaterThan(8) // At least header size
  })

  it('handles compilation errors gracefully', async () => {
    const invalidCode = `
export function broken(: i32 {  // Syntax error - missing parameter
  return 42
}
`
    await expect(compileAssemblyScript(invalidCode)).rejects.toThrow()
  })

  it('supports AssemblyScript-specific types', async () => {
    const code = `
export function float64Op(x: f64, y: f64): f64 {
  return x * y + 1.5
}

export function int64Op(x: i64, y: i64): i64 {
  return x + y
}
`
    const result = await compileAssemblyScript(code)

    expect(result.exports).toContain('float64Op')
    expect(result.exports).toContain('int64Op')
  })

  it('includes compilation metadata', async () => {
    const code = `
export function test(): i32 {
  return 1
}
`
    const result = await compileAssemblyScript(code)

    expect(result.compiledAt).toBeDefined()
    expect(result.wasmSize).toBe(result.wasm.length)
  })

  it('supports optimization levels', async () => {
    const code = `
export function compute(): i32 {
  let sum: i32 = 0
  for (let i: i32 = 0; i < 100; i++) {
    sum += i
  }
  return sum
}
`
    const unoptimized = await compileAssemblyScript(code, { optimize: false })
    const optimized = await compileAssemblyScript(code, { optimize: true })

    // Optimized version should be smaller or equal
    expect(optimized.wasm.length).toBeLessThanOrEqual(unoptimized.wasm.length)
  })

  it('generates TypeScript types by default', async () => {
    const code = `
export function add(a: i32, b: i32): i32 {
  return a + b
}
`
    const result = await compileAssemblyScript(code)

    expect(result.typescriptTypes).toBeDefined()
    expect(result.typescriptTypes).toContain('add(a: number, b: number): number')
    expect(result.typescriptTypes).toContain('ModuleExports')
  })

  it('generates capnweb bindings by default', async () => {
    const code = `
export function multiply(x: i32, y: i32): i32 {
  return x * y
}
`
    const result = await compileAssemblyScript(code)

    expect(result.capnwebBindings).toBeDefined()
    expect(result.capnwebBindings).toContain('ModuleTarget')
    expect(result.capnwebBindings).toContain('multiply(x: number, y: number): number')
    expect(result.capnwebBindings).toContain('createModuleTarget')
  })

  it('includes function signatures in result', async () => {
    const code = `
export function add(a: i32, b: i32): i32 {
  return a + b
}

export function subtract(x: f64, y: f64): f64 {
  return x - y
}
`
    const result = await compileAssemblyScript(code)

    expect(result.signatures).toBeDefined()
    expect(result.signatures).toHaveLength(2)

    const addSig = result.signatures!.find((s) => s.name === 'add')
    expect(addSig).toBeDefined()
    expect(addSig!.params).toHaveLength(2)
    expect(addSig!.params[0].tsType).toBe('number')
    expect(addSig!.returnType).toBe('i32')
    expect(addSig!.tsReturnType).toBe('number')

    const subSig = result.signatures!.find((s) => s.name === 'subtract')
    expect(subSig).toBeDefined()
    expect(subSig!.params[0].tsType).toBe('number')
    expect(subSig!.returnType).toBe('f64')
    expect(subSig!.tsReturnType).toBe('number')
  })

  it('can disable type generation', async () => {
    const code = `
export function test(): i32 {
  return 1
}
`
    const result = await compileAssemblyScript(code, { generateTypes: false })

    expect(result.typescriptTypes).toBeUndefined()
    expect(result.capnwebBindings).toBeDefined() // bindings still enabled
  })

  it('can disable bindings generation', async () => {
    const code = `
export function test(): i32 {
  return 1
}
`
    const result = await compileAssemblyScript(code, { generateBindings: false })

    expect(result.typescriptTypes).toBeDefined() // types still enabled
    expect(result.capnwebBindings).toBeUndefined()
  })

  it('uses custom module name in generated types', async () => {
    const code = `
export function add(a: i32, b: i32): i32 {
  return a + b
}
`
    const result = await compileAssemblyScript(code, { moduleName: 'Calculator' })

    expect(result.typescriptTypes).toContain('CalculatorExports')
    expect(result.typescriptTypes).toContain('CalculatorRpcTarget')
    expect(result.capnwebBindings).toContain('CalculatorTarget')
    expect(result.capnwebBindings).toContain('createCalculatorTarget')
  })

  it('correctly maps i64 types to bigint', async () => {
    const code = `
export function add64(a: i64, b: i64): i64 {
  return a + b
}
`
    const result = await compileAssemblyScript(code)

    expect(result.typescriptTypes).toContain('a: bigint')
    expect(result.typescriptTypes).toContain('b: bigint')
    expect(result.typescriptTypes).toContain('): bigint')
    expect(result.signatures![0].params[0].tsType).toBe('bigint')
    expect(result.signatures![0].tsReturnType).toBe('bigint')
  })

  it('correctly maps u64 types to bigint', async () => {
    const code = `
export function add64u(a: u64, b: u64): u64 {
  return a + b
}
`
    const result = await compileAssemblyScript(code)

    expect(result.signatures![0].params[0].tsType).toBe('bigint')
    expect(result.signatures![0].tsReturnType).toBe('bigint')
  })
})

describe('TypeScript Type Generation', () => {
  it('generates valid TypeScript interfaces', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'add',
        params: [
          { name: 'a', type: 'i32', tsType: 'number' },
          { name: 'b', type: 'i32', tsType: 'number' },
        ],
        returnType: 'i32',
        tsReturnType: 'number',
      },
    ]

    const types = generateTypeScriptTypes(signatures, 'Math')

    expect(types).toContain('MathExports')
    expect(types).toContain('add(a: number, b: number): number')
    expect(types).toContain('AddParams')
    expect(types).toContain('MathRpcTarget')
    expect(types).toContain('memory: WebAssembly.Memory')
  })

  it('generates parameter interfaces for functions with params', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'multiply',
        params: [
          { name: 'x', type: 'f64', tsType: 'number' },
          { name: 'y', type: 'f64', tsType: 'number' },
        ],
        returnType: 'f64',
        tsReturnType: 'number',
      },
    ]

    const types = generateTypeScriptTypes(signatures, 'Module')

    expect(types).toContain('MultiplyParams')
    expect(types).toContain('x: number')
    expect(types).toContain('y: number')
  })

  it('does not generate param interfaces for zero-param functions', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'getAnswer',
        params: [],
        returnType: 'i32',
        tsReturnType: 'number',
      },
    ]

    const types = generateTypeScriptTypes(signatures, 'Module')

    expect(types).not.toContain('GetAnswerParams')
    expect(types).toContain('getAnswer(): number')
  })

  it('handles multiple functions', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'add',
        params: [
          { name: 'a', type: 'i32', tsType: 'number' },
          { name: 'b', type: 'i32', tsType: 'number' },
        ],
        returnType: 'i32',
        tsReturnType: 'number',
      },
      {
        name: 'subtract',
        params: [
          { name: 'a', type: 'i32', tsType: 'number' },
          { name: 'b', type: 'i32', tsType: 'number' },
        ],
        returnType: 'i32',
        tsReturnType: 'number',
      },
      {
        name: 'getAnswer',
        params: [],
        returnType: 'i32',
        tsReturnType: 'number',
      },
    ]

    const types = generateTypeScriptTypes(signatures, 'Calc')

    expect(types).toContain('add(a: number, b: number): number')
    expect(types).toContain('subtract(a: number, b: number): number')
    expect(types).toContain('getAnswer(): number')
    expect(types).toContain('CalcExports')
    expect(types).toContain('CalcRpcTarget')
  })
})

describe('Capnweb Bindings Generation', () => {
  it('generates RpcTarget class', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'add',
        params: [
          { name: 'a', type: 'i32', tsType: 'number' },
          { name: 'b', type: 'i32', tsType: 'number' },
        ],
        returnType: 'i32',
        tsReturnType: 'number',
      },
    ]

    const bindings = generateCapnwebBindings(signatures, 'Math')

    expect(bindings).toContain('class MathTarget extends RpcTarget')
    expect(bindings).toContain('add(a: number, b: number): number')
    expect(bindings).toContain('return this.instance.exports.add(a, b)')
  })

  it('generates factory functions', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'test',
        params: [],
        returnType: 'i32',
        tsReturnType: 'number',
      },
    ]

    const bindings = generateCapnwebBindings(signatures, 'Test')

    expect(bindings).toContain('export async function createTestTarget')
    expect(bindings).toContain('export async function createTestTargetFromModule')
    expect(bindings).toContain('Promise<TestTarget>')
  })

  it('generates type guard', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'test',
        params: [],
        returnType: 'i32',
        tsReturnType: 'number',
      },
    ]

    const bindings = generateCapnwebBindings(signatures, 'Example')

    expect(bindings).toContain('export function isExampleTarget')
    expect(bindings).toContain('obj is ExampleTarget')
    expect(bindings).toContain('obj instanceof ExampleTarget')
  })

  it('includes Symbol.dispose for resource cleanup', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'test',
        params: [],
        returnType: 'i32',
        tsReturnType: 'number',
      },
    ]

    const bindings = generateCapnwebBindings(signatures, 'Module')

    expect(bindings).toContain('[Symbol.dispose](): void')
  })

  it('generates memory accessor', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'test',
        params: [],
        returnType: 'i32',
        tsReturnType: 'number',
      },
    ]

    const bindings = generateCapnwebBindings(signatures, 'Module')

    expect(bindings).toContain('get memory(): WebAssembly.Memory')
    expect(bindings).toContain('return this.instance.exports.memory')
  })

  it('handles bigint types correctly', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'add64',
        params: [
          { name: 'a', type: 'i64', tsType: 'bigint' },
          { name: 'b', type: 'i64', tsType: 'bigint' },
        ],
        returnType: 'i64',
        tsReturnType: 'bigint',
      },
    ]

    const bindings = generateCapnwebBindings(signatures, 'Module')

    expect(bindings).toContain('add64(a: bigint, b: bigint): bigint')
  })

  it('exports WasmInstance type', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'test',
        params: [],
        returnType: 'i32',
        tsReturnType: 'number',
      },
    ]

    const bindings = generateCapnwebBindings(signatures, 'Example')

    expect(bindings).toContain('export type { WasmInstance as ExampleWasmInstance }')
  })
})
