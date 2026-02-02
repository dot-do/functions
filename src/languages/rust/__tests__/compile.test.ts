/**
 * Rust to WASM Compilation Tests (RED)
 *
 * These tests validate the Rust to WebAssembly compilation pipeline for Functions.do.
 * The compiler is responsible for:
 * 1. Taking Rust source code and compiling it to WASM
 * 2. Producing valid WASM binary output with correct magic bytes
 * 3. Exporting the expected functions that can be loaded by Worker Loader
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the compileRust implementation does not exist yet.
 */

import { describe, it, expect } from 'vitest'
import {
  compileRust,
  generateCapnwebBindings,
  generateTypeScriptTypes,
  generateWasmBindgenHelpers,
  type FunctionSignature,
} from '../compile'

// WASM magic bytes: \0asm (0x00 0x61 0x73 0x6d)
const WASM_MAGIC_BYTES = {
  0: 0x00, // null byte
  1: 0x61, // 'a'
  2: 0x73, // 's'
  3: 0x6d, // 'm'
}

// WASM version 1 bytes (0x01 0x00 0x00 0x00)
const WASM_VERSION_1 = new Uint8Array([0x01, 0x00, 0x00, 0x00])

describe('Rust Compiler', () => {
  it('compiles Rust to WASM', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn hello() -> i32 {
        42
      }
    `
    const result = await compileRust(rustCode)

    // WASM magic bytes: \0asm
    expect(result.wasm[0]).toBe(0x00)
    expect(result.wasm[1]).toBe(0x61) // 'a'
    expect(result.wasm[2]).toBe(0x73) // 's'
    expect(result.wasm[3]).toBe(0x6d) // 'm'
  })

  it('exports the function', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn hello() -> i32 {
        42
      }
    `
    const result = await compileRust(rustCode)
    expect(result.exports).toContain('hello')
  })

  it('produces valid WASM with correct version header', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn add(a: i32, b: i32) -> i32 {
        a + b
      }
    `
    const result = await compileRust(rustCode)

    // WASM binary should have version 1 header after magic bytes
    expect(result.wasm[4]).toBe(0x01)
    expect(result.wasm[5]).toBe(0x00)
    expect(result.wasm[6]).toBe(0x00)
    expect(result.wasm[7]).toBe(0x00)
  })

  it('compiles multiple exported functions', async () => {
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
      pub extern "C" fn subtract(a: i32, b: i32) -> i32 {
        a - b
      }
    `
    const result = await compileRust(rustCode)

    expect(result.exports).toContain('add')
    expect(result.exports).toContain('multiply')
    expect(result.exports).toContain('subtract')
  })

  it('returns a Uint8Array for the WASM binary', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn identity(x: i32) -> i32 {
        x
      }
    `
    const result = await compileRust(rustCode)

    expect(result.wasm).toBeInstanceOf(Uint8Array)
    expect(result.wasm.length).toBeGreaterThan(8) // At least header size
  })

  // WebAssembly.compile() is disallowed by the Workers runtime embedder (miniflare)
  it.skip('produces WASM that can be instantiated', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn get_answer() -> i32 {
        42
      }
    `
    const result = await compileRust(rustCode)

    // The WASM should be instantiable without errors
    const wasmModule = await WebAssembly.compile(result.wasm)
    const wasmInstance = await WebAssembly.instantiate(wasmModule)

    expect(wasmInstance).toBeDefined()
    expect(wasmInstance.exports).toBeDefined()
  })

  // WebAssembly.compile() is disallowed by the Workers runtime embedder (miniflare)
  it.skip('produces WASM with executable functions', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn compute(x: i32) -> i32 {
        x * 2 + 1
      }
    `
    const result = await compileRust(rustCode)

    const wasmModule = await WebAssembly.compile(result.wasm)
    const wasmInstance = await WebAssembly.instantiate(wasmModule)

    const compute = wasmInstance.exports['compute'] as (x: number) => number
    expect(compute(5)).toBe(11)
    expect(compute(10)).toBe(21)
    expect(compute(0)).toBe(1)
  })

  it('handles compilation errors gracefully', async () => {
    const invalidRustCode = `
      #[no_mangle]
      pub extern "C" fn broken( -> i32 {  // Syntax error
        42
      }
    `

    await expect(compileRust(invalidRustCode)).rejects.toThrow()
  })

  it('supports wasm-bindgen annotated functions', async () => {
    const rustCode = `
      use wasm_bindgen::prelude::*;

      #[wasm_bindgen]
      pub fn greet(name: &str) -> String {
        format!("Hello, {}!", name)
      }
    `
    const result = await compileRust(rustCode, {
      useWasmBindgen: true,
    })

    expect(result.wasm).toBeDefined()
    expect(result.exports).toContain('greet')
  })

  it('includes compilation metadata', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn test() -> i32 {
        1
      }
    `
    const result = await compileRust(rustCode)

    expect(result.compiledAt).toBeDefined()
    expect(result.wasmSize).toBe(result.wasm.length)
  })

  it('extracts function signatures', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn add(a: i32, b: i32) -> i32 {
        a + b
      }
    `
    const result = await compileRust(rustCode)

    expect(result.signatures).toBeDefined()
    expect(result.signatures).toHaveLength(1)
    expect(result.signatures![0].name).toBe('add')
    expect(result.signatures![0].params).toHaveLength(2)
    expect(result.signatures![0].params[0].name).toBe('a')
    expect(result.signatures![0].params[0].type).toBe('i32')
    expect(result.signatures![0].returnType).toBe('i32')
  })

  it('generates capnweb bindings when requested', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn add(a: i32, b: i32) -> i32 {
        a + b
      }

      #[no_mangle]
      pub extern "C" fn multiply(x: i32, y: i32) -> i32 {
        x * y
      }
    `
    const result = await compileRust(rustCode, { generateCapnwebBindings: true })

    expect(result.capnwebBindings).toBeDefined()
    expect(result.capnwebBindings).toHaveLength(2)

    // Check first binding
    const addBinding = result.capnwebBindings![0]
    expect(addBinding.name).toBe('add')
    expect(addBinding.methodId).toBe(0)
    expect(addBinding.params).toHaveLength(2)
    expect(addBinding.params[0].name).toBe('a')
    expect(addBinding.params[0].wasmType).toBe(0x7f) // i32
    expect(addBinding.params[0].offset).toBe(0)
    expect(addBinding.params[1].offset).toBe(4) // Second i32 at offset 4
    expect(addBinding.returnType).toBeDefined()
    expect(addBinding.returnType!.type).toBe('i32')

    // Check second binding
    const mulBinding = result.capnwebBindings![1]
    expect(mulBinding.name).toBe('multiply')
    expect(mulBinding.methodId).toBe(1)
  })

  it('generates TypeScript types when requested', async () => {
    const rustCode = `
      #[no_mangle]
      pub extern "C" fn add(a: i32, b: i32) -> i32 {
        a + b
      }
    `
    const result = await compileRust(rustCode, { generateTypeScript: true })

    expect(result.typeScript).toBeDefined()
    expect(result.typeScript).toContain('declare module')
    expect(result.typeScript).toContain('export interface WasmExports')
    expect(result.typeScript).toContain('add(a: number, b: number): number')
    expect(result.typeScript).toContain('export interface RpcTarget')
    expect(result.typeScript).toContain('Promise<number>')
  })
})

describe('capnweb Bindings Generator', () => {
  it('generates bindings from function signatures', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'add',
        params: [
          { name: 'a', type: 'i32' },
          { name: 'b', type: 'i32' },
        ],
        returnType: 'i32',
        isAsync: false,
      },
    ]

    const bindings = generateCapnwebBindings(signatures)

    expect(bindings).toHaveLength(1)
    expect(bindings[0].name).toBe('add')
    expect(bindings[0].methodId).toBe(0)
    expect(bindings[0].params).toHaveLength(2)
    expect(bindings[0].returnType).toBeDefined()
  })

  it('assigns sequential method IDs', () => {
    const signatures: FunctionSignature[] = [
      { name: 'fn1', params: [], returnType: 'i32', isAsync: false },
      { name: 'fn2', params: [], returnType: 'i32', isAsync: false },
      { name: 'fn3', params: [], returnType: 'i32', isAsync: false },
    ]

    const bindings = generateCapnwebBindings(signatures)

    expect(bindings[0].methodId).toBe(0)
    expect(bindings[1].methodId).toBe(1)
    expect(bindings[2].methodId).toBe(2)
  })

  it('calculates parameter offsets correctly', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'mixed',
        params: [
          { name: 'a', type: 'i32' },  // 4 bytes
          { name: 'b', type: 'i64' },  // 8 bytes
          { name: 'c', type: 'f32' },  // 4 bytes
        ],
        returnType: 'i32',
        isAsync: false,
      },
    ]

    const bindings = generateCapnwebBindings(signatures)

    expect(bindings[0].params[0].offset).toBe(0)   // i32 at 0
    expect(bindings[0].params[1].offset).toBe(4)   // i64 at 4
    expect(bindings[0].params[2].offset).toBe(12)  // f32 at 12 (4 + 8)
  })

  it('handles functions with no return type', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'void_fn',
        params: [{ name: 'x', type: 'i32' }],
        returnType: null,
        isAsync: false,
      },
    ]

    const bindings = generateCapnwebBindings(signatures)

    expect(bindings[0].returnType).toBeNull()
  })
})

describe('TypeScript Type Generator', () => {
  it('generates module declaration', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'test',
        params: [],
        returnType: 'i32',
        isAsync: false,
      },
    ]

    const ts = generateTypeScriptTypes(signatures, 'my-module')

    expect(ts).toContain("declare module 'my-module'")
  })

  it('converts Rust types to TypeScript types', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'multi_type',
        params: [
          { name: 'a', type: 'i32' },
          { name: 'b', type: 'i64' },
          { name: 'c', type: 'f64' },
          { name: 'd', type: 'bool' },
        ],
        returnType: 'String',
        isAsync: false,
      },
    ]

    const ts = generateTypeScriptTypes(signatures)

    expect(ts).toContain('a: number')   // i32 -> number
    expect(ts).toContain('b: bigint')   // i64 -> bigint
    expect(ts).toContain('c: number')   // f64 -> number
    expect(ts).toContain('d: boolean')  // bool -> boolean
    expect(ts).toContain('): string')   // String -> string
  })

  it('generates WasmExports interface', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'add',
        params: [
          { name: 'a', type: 'i32' },
          { name: 'b', type: 'i32' },
        ],
        returnType: 'i32',
        isAsync: false,
      },
    ]

    const ts = generateTypeScriptTypes(signatures)

    expect(ts).toContain('export interface WasmExports')
    expect(ts).toContain('add(a: number, b: number): number;')
  })

  it('generates RpcTarget interface with Promise return types', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'compute',
        params: [{ name: 'x', type: 'i32' }],
        returnType: 'i32',
        isAsync: false,
      },
    ]

    const ts = generateTypeScriptTypes(signatures)

    expect(ts).toContain('export interface RpcTarget')
    expect(ts).toContain('compute(x: number): Promise<number>')
  })

  it('generates memory management exports', () => {
    const signatures: FunctionSignature[] = []

    const ts = generateTypeScriptTypes(signatures)

    expect(ts).toContain('export const memory: WebAssembly.Memory')
    expect(ts).toContain('export function alloc(size: number): number')
    expect(ts).toContain('export function dealloc(ptr: number, size: number): void')
  })

  it('handles void return types', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'side_effect',
        params: [],
        returnType: null,
        isAsync: false,
      },
    ]

    const ts = generateTypeScriptTypes(signatures)

    expect(ts).toContain('side_effect(): void')
    expect(ts).toContain('side_effect(): Promise<void>')
  })
})

describe('wasm-bindgen Helpers Generator', () => {
  it('generates JavaScript glue code', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'add',
        params: [
          { name: 'a', type: 'i32' },
          { name: 'b', type: 'i32' },
        ],
        returnType: 'i32',
        isAsync: false,
      },
    ]

    const js = generateWasmBindgenHelpers(signatures)

    expect(js).toContain('export function add(a, b)')
    expect(js).toContain('return ret')
    expect(js).toContain('export async function init(wasmPath)')
  })

  it('generates string handling code for string params', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'greet',
        params: [{ name: 'name', type: '&str' }],
        returnType: 'String',
        isAsync: false,
      },
    ]

    const js = generateWasmBindgenHelpers(signatures)

    expect(js).toContain('passStringToWasm0')
    expect(js).toContain('ptr_name')
    expect(js).toContain('len_name')
  })

  it('generates RpcDispatcher class', () => {
    const signatures: FunctionSignature[] = [
      { name: 'fn1', params: [], returnType: 'i32', isAsync: false },
      { name: 'fn2', params: [], returnType: 'i32', isAsync: false },
    ]

    const js = generateWasmBindgenHelpers(signatures)

    expect(js).toContain('export class RpcDispatcher')
    expect(js).toContain('async invoke(methodId, args)')
    expect(js).toContain("'fn1'")
    expect(js).toContain("'fn2'")
  })

  it('includes memory utilities', () => {
    const signatures: FunctionSignature[] = []

    const js = generateWasmBindgenHelpers(signatures)

    expect(js).toContain('getUint8Memory0')
    expect(js).toContain('cachedTextDecoder')
    expect(js).toContain('cachedTextEncoder')
  })
})
