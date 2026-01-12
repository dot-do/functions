/**
 * C/C++ to WASM Compilation Tests (RED)
 *
 * These tests validate the C/C++ to WebAssembly compilation pipeline for Functions.do.
 * The compiler is responsible for:
 * 1. Compiling C/C++ source code to WASM via Emscripten
 * 2. Producing valid WASM binary output with correct magic bytes
 * 3. Exporting the expected functions that can be loaded by Worker Loader
 * 4. Producing small binaries optimized for serverless execution
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the compileC implementation does not exist yet.
 */

import { describe, it, expect } from 'vitest'
import {
  compileC,
  generateTypescriptTypes,
  generateCapnwebBindings,
  generateEmscriptenToolchain,
  generateCMakeLists,
} from '../compile'

// WASM magic bytes: \0asm (0x00 0x61 0x73 0x6d)
const WASM_MAGIC_BYTES = [0x00, 0x61, 0x73, 0x6d] as const

// WASM version 1 bytes (0x01 0x00 0x00 0x00)
const WASM_VERSION_1 = [0x01, 0x00, 0x00, 0x00] as const

describe('C/C++ Compiler', () => {
  it('compiles C to WASM', async () => {
    const code = `
int hello() {
    return 42;
}
`
    const result = await compileC(code)

    // WASM magic bytes: \0asm
    expect(result.wasm[0]).toBe(0x00)
    expect(result.wasm[1]).toBe(0x61) // 'a'
    expect(result.wasm[2]).toBe(0x73) // 's'
    expect(result.wasm[3]).toBe(0x6d) // 'm'
  })

  it('produces valid WASM with correct version header', async () => {
    const code = `
int add(int a, int b) {
    return a + b;
}
`
    const result = await compileC(code)

    // WASM binary should have version 1 header after magic bytes
    expect(result.wasm[4]).toBe(0x01)
    expect(result.wasm[5]).toBe(0x00)
    expect(result.wasm[6]).toBe(0x00)
    expect(result.wasm[7]).toBe(0x00)
  })

  it('exports the function', async () => {
    const code = 'int hello() { return 42; }'
    const result = await compileC(code)
    expect(result.exports).toContain('hello')
  })

  it('produces small binaries', async () => {
    const code = `
int x() {
    return 1;
}
`
    const result = await compileC(code)
    // Emscripten should produce reasonably small binaries (<100KB for simple functions)
    expect(result.wasm.length).toBeLessThan(100 * 1024)
    // And should be at least a few bytes (not empty)
    expect(result.wasm.length).toBeGreaterThan(100)
  })

  it('produces WASM that can be instantiated', async () => {
    const code = `
int getAnswer() {
    return 42;
}
`
    const result = await compileC(code)

    // The WASM should be instantiable without errors
    const wasmModule = await WebAssembly.compile(result.wasm)
    const wasmInstance = await WebAssembly.instantiate(wasmModule)

    expect(wasmInstance).toBeDefined()
    expect(wasmInstance.exports).toBeDefined()
  })

  it('produces WASM with executable functions', async () => {
    const code = `
int compute(int x) {
    return x * 2 + 1;
}
`
    const result = await compileC(code)

    const wasmModule = await WebAssembly.compile(result.wasm)
    const wasmInstance = await WebAssembly.instantiate(wasmModule)

    const compute = wasmInstance.exports.compute as (x: number) => number
    expect(compute(5)).toBe(11)
    expect(compute(10)).toBe(21)
    expect(compute(0)).toBe(1)
  })

  it('compiles multiple exported functions', async () => {
    const code = `
int add(int a, int b) {
    return a + b;
}

int multiply(int a, int b) {
    return a * b;
}

int subtract(int a, int b) {
    return a - b;
}
`
    const result = await compileC(code)

    expect(result.exports).toContain('add')
    expect(result.exports).toContain('multiply')
    expect(result.exports).toContain('subtract')

    // Verify the functions work
    const wasmModule = await WebAssembly.compile(result.wasm)
    const wasmInstance = await WebAssembly.instantiate(wasmModule)

    const add = wasmInstance.exports.add as (a: number, b: number) => number
    const multiply = wasmInstance.exports.multiply as (a: number, b: number) => number
    const subtract = wasmInstance.exports.subtract as (a: number, b: number) => number

    expect(add(5, 3)).toBe(8)
    expect(multiply(6, 7)).toBe(42)
    expect(subtract(10, 4)).toBe(6)
  })

  it('returns a Uint8Array for the WASM binary', async () => {
    const code = `
int identity(int x) {
    return x;
}
`
    const result = await compileC(code)

    expect(result.wasm).toBeInstanceOf(Uint8Array)
    expect(result.wasm.length).toBeGreaterThan(8) // At least header size
  })

  it('handles compilation errors gracefully', async () => {
    const invalidCode = `
int broken( {  // Syntax error - missing parameter list close
    return 42;
}
`
    await expect(compileC(invalidCode)).rejects.toThrow()
  })

  it('supports C++ code compilation', async () => {
    const cppCode = `
extern "C" {
    int factorial(int n) {
        if (n <= 1) return 1;
        return n * factorial(n - 1);
    }
}
`
    const result = await compileC(cppCode, { language: 'cpp' })

    expect(result.wasm).toBeDefined()
    expect(result.exports).toContain('factorial')
  })

  it('includes compilation metadata', async () => {
    const code = `
int test() {
    return 1;
}
`
    const result = await compileC(code)

    expect(result.compiledAt).toBeDefined()
    expect(result.wasmSize).toBe(result.wasm.length)
  })

  it('extracts function signatures', async () => {
    const code = `
int add(int a, int b) {
    return a + b;
}
`
    const result = await compileC(code)

    expect(result.signatures).toBeDefined()
    expect(result.signatures).toHaveLength(1)
    expect(result.signatures![0].name).toBe('add')
    expect(result.signatures![0].params).toHaveLength(2)
    expect(result.signatures![0].params[0].name).toBe('a')
    expect(result.signatures![0].params[0].type).toBe('int')
    expect(result.signatures![0].returnType).toBe('int')
  })

  it('supports optimization levels', async () => {
    const code = `
int compute() {
    int sum = 0;
    for (int i = 0; i < 100; i++) {
        sum += i;
    }
    return sum;
}
`
    const unoptimized = await compileC(code, { optimize: false })
    const optimized = await compileC(code, { optimize: true })

    // Optimized version should be smaller or equal
    expect(optimized.wasm.length).toBeLessThanOrEqual(unoptimized.wasm.length)
  })

  it('compiles with EMSCRIPTEN_KEEPALIVE attribute', async () => {
    const code = `
#include <emscripten.h>

EMSCRIPTEN_KEEPALIVE
int exported_function() {
    return 100;
}
`
    const result = await compileC(code)

    expect(result.exports).toContain('exported_function')
  })

  it('supports pointer and array parameters', async () => {
    const code = `
int sum_array(int* arr, int len) {
    int sum = 0;
    for (int i = 0; i < len; i++) {
        sum += arr[i];
    }
    return sum;
}
`
    const result = await compileC(code)

    expect(result.exports).toContain('sum_array')
    expect(result.signatures).toBeDefined()
    expect(result.signatures![0].params).toHaveLength(2)
    expect(result.signatures![0].params[0].type).toBe('int*')
    expect(result.signatures![0].params[1].type).toBe('int')
  })

  it('handles void return type', async () => {
    const code = `
void do_nothing() {
    // No return value
}
`
    const result = await compileC(code)

    expect(result.exports).toContain('do_nothing')
    expect(result.signatures![0].returnType).toBeNull()
  })

  it('compiles float operations correctly', async () => {
    const code = `
float multiply_floats(float a, float b) {
    return a * b;
}

double add_doubles(double a, double b) {
    return a + b;
}
`
    const result = await compileC(code)

    expect(result.exports).toContain('multiply_floats')
    expect(result.exports).toContain('add_doubles')
  })

  it('generates TypeScript types by default', async () => {
    const code = `
int add(int a, int b) {
    return a + b;
}
`
    const result = await compileC(code)

    expect(result.typescriptTypes).toBeDefined()
    expect(result.typescriptTypes).toContain('export interface')
    expect(result.typescriptTypes).toContain('add(a: number, b: number): number')
  })

  it('generates capnweb bindings by default', async () => {
    const code = `
int add(int a, int b) {
    return a + b;
}
`
    const result = await compileC(code)

    expect(result.capnwebBindings).toBeDefined()
    expect(result.capnwebBindings).toContain('import { RpcTarget }')
    expect(result.capnwebBindings).toContain('extends RpcTarget')
    expect(result.capnwebBindings).toContain('createAddModuleTarget')
  })

  it('can disable TypeScript type generation', async () => {
    const code = `int test() { return 1; }`
    const result = await compileC(code, { generateTypes: false })

    expect(result.typescriptTypes).toBeUndefined()
  })

  it('can disable capnweb bindings generation', async () => {
    const code = `int test() { return 1; }`
    const result = await compileC(code, { generateBindings: false })

    expect(result.capnwebBindings).toBeUndefined()
  })

  it('uses custom module name for generated code', async () => {
    const code = `int compute(int x) { return x * 2; }`
    const result = await compileC(code, { moduleName: 'Calculator' })

    expect(result.typescriptTypes).toContain('CalculatorExports')
    expect(result.capnwebBindings).toContain('CalculatorTarget')
    expect(result.capnwebBindings).toContain('createCalculatorTarget')
  })
})

describe('TypeScript Type Generation', () => {
  it('generates correct interface for simple functions', () => {
    const signatures = [
      {
        name: 'add',
        params: [
          { name: 'a', type: 'int' },
          { name: 'b', type: 'int' },
        ],
        returnType: 'int',
        isAsync: false,
      },
    ]

    const types = generateTypescriptTypes(signatures, 'Math')

    expect(types).toContain('export interface MathExports')
    expect(types).toContain('add(a: number, b: number): number')
    expect(types).toContain('memory: WebAssembly.Memory')
  })

  it('generates correct types for 64-bit integers', () => {
    const signatures = [
      {
        name: 'factorial',
        params: [{ name: 'n', type: 'int' }],
        returnType: 'int64_t',
        isAsync: false,
      },
    ]

    const types = generateTypescriptTypes(signatures, 'Math')

    expect(types).toContain('factorial(n: number): bigint')
  })

  it('generates correct types for floating point', () => {
    const signatures = [
      {
        name: 'compute',
        params: [
          { name: 'x', type: 'float' },
          { name: 'y', type: 'double' },
        ],
        returnType: 'double',
        isAsync: false,
      },
    ]

    const types = generateTypescriptTypes(signatures, 'Calc')

    expect(types).toContain('compute(x: number, y: number): number')
  })

  it('generates correct types for pointers', () => {
    const signatures = [
      {
        name: 'process',
        params: [
          { name: 'data', type: 'int*' },
          { name: 'len', type: 'int' },
        ],
        returnType: 'int',
        isAsync: false,
      },
    ]

    const types = generateTypescriptTypes(signatures, 'Data')

    expect(types).toContain('process(data: number, len: number): number')
  })

  it('generates void return type correctly', () => {
    const signatures = [
      {
        name: 'reset',
        params: [],
        returnType: null,
        isAsync: false,
      },
    ]

    const types = generateTypescriptTypes(signatures, 'State')

    expect(types).toContain('reset(): void')
  })

  it('generates parameter interfaces for functions with params', () => {
    const signatures = [
      {
        name: 'add',
        params: [
          { name: 'a', type: 'int' },
          { name: 'b', type: 'int' },
        ],
        returnType: 'int',
        isAsync: false,
      },
    ]

    const types = generateTypescriptTypes(signatures, 'Math')

    expect(types).toContain('export interface AddParams')
    expect(types).toContain('a: number')
    expect(types).toContain('b: number')
  })

  it('generates RPC target interface', () => {
    const signatures = [
      {
        name: 'compute',
        params: [{ name: 'x', type: 'int' }],
        returnType: 'int',
        isAsync: false,
      },
    ]

    const types = generateTypescriptTypes(signatures, 'Calc')

    expect(types).toContain('export interface CalcRpcTarget')
    expect(types).toContain('compute(x: number): Promise<number>')
  })
})

describe('Capnweb Bindings Generation', () => {
  it('generates RpcTarget class with methods', () => {
    const signatures = [
      {
        name: 'add',
        params: [
          { name: 'a', type: 'int' },
          { name: 'b', type: 'int' },
        ],
        returnType: 'int',
        isAsync: false,
      },
    ]

    const bindings = generateCapnwebBindings(signatures, 'Math')

    expect(bindings).toContain("import { RpcTarget } from 'capnweb'")
    expect(bindings).toContain('export class MathTarget extends RpcTarget')
    expect(bindings).toContain('add(a: number, b: number): number')
    expect(bindings).toContain('return this.instance.exports.add(a, b)')
  })

  it('generates factory function', () => {
    const signatures = [
      {
        name: 'test',
        params: [],
        returnType: 'int',
        isAsync: false,
      },
    ]

    const bindings = generateCapnwebBindings(signatures, 'Example')

    expect(bindings).toContain('export async function createExampleTarget')
    expect(bindings).toContain('wasmBytes: Uint8Array')
    expect(bindings).toContain('Promise<ExampleTarget>')
    expect(bindings).toContain('WebAssembly.compile(wasmBytes)')
    expect(bindings).toContain('return new ExampleTarget(instance)')
  })

  it('generates fromModule factory function', () => {
    const signatures = [
      {
        name: 'test',
        params: [],
        returnType: 'int',
        isAsync: false,
      },
    ]

    const bindings = generateCapnwebBindings(signatures, 'Example')

    expect(bindings).toContain('export async function createExampleTargetFromModule')
    expect(bindings).toContain('module: WebAssembly.Module')
  })

  it('generates type guard function', () => {
    const signatures = [
      {
        name: 'test',
        params: [],
        returnType: 'int',
        isAsync: false,
      },
    ]

    const bindings = generateCapnwebBindings(signatures, 'Example')

    expect(bindings).toContain('export function isExampleTarget')
    expect(bindings).toContain('obj is ExampleTarget')
    expect(bindings).toContain('obj instanceof ExampleTarget')
  })

  it('generates memory accessor', () => {
    const signatures = [
      {
        name: 'test',
        params: [],
        returnType: 'int',
        isAsync: false,
      },
    ]

    const bindings = generateCapnwebBindings(signatures, 'Example')

    expect(bindings).toContain('get memory(): WebAssembly.Memory')
    expect(bindings).toContain('return this.instance.exports.memory')
  })

  it('generates dispose method', () => {
    const signatures = [
      {
        name: 'test',
        params: [],
        returnType: 'int',
        isAsync: false,
      },
    ]

    const bindings = generateCapnwebBindings(signatures, 'Example')

    expect(bindings).toContain('[Symbol.dispose](): void')
  })

  it('handles void return type methods', () => {
    const signatures = [
      {
        name: 'reset',
        params: [],
        returnType: null,
        isAsync: false,
      },
    ]

    const bindings = generateCapnwebBindings(signatures, 'State')

    expect(bindings).toContain('reset(): void')
    expect(bindings).toContain('this.instance.exports.reset()')
  })

  it('generates documentation comments', () => {
    const signatures = [
      {
        name: 'add',
        params: [
          { name: 'a', type: 'int' },
          { name: 'b', type: 'int' },
        ],
        returnType: 'int',
        isAsync: false,
      },
    ]

    const bindings = generateCapnwebBindings(signatures, 'Math')

    expect(bindings).toContain('@param a - int')
    expect(bindings).toContain('@param b - int')
    expect(bindings).toContain('@returns int')
  })
})

describe('CMake Toolchain Generation', () => {
  it('generates valid Emscripten toolchain file', () => {
    const toolchain = generateEmscriptenToolchain()

    expect(toolchain).toContain('CMAKE_SYSTEM_NAME Emscripten')
    expect(toolchain).toContain('CMAKE_C_COMPILER')
    expect(toolchain).toContain('CMAKE_CXX_COMPILER')
    expect(toolchain).toContain('emcc')
    expect(toolchain).toContain('em++')
  })

  it('includes Emscripten SDK detection', () => {
    const toolchain = generateEmscriptenToolchain()

    expect(toolchain).toContain('EMSDK')
    expect(toolchain).toContain('/usr/local/emsdk')
    expect(toolchain).toContain('$ENV{HOME}/emsdk')
  })

  it('includes Functions.do optimization flags', () => {
    const toolchain = generateEmscriptenToolchain()

    expect(toolchain).toContain('STANDALONE_WASM=1')
    expect(toolchain).toContain('ALLOW_MEMORY_GROWTH=1')
    expect(toolchain).toContain('-fno-exceptions')
    expect(toolchain).toContain('-flto')
  })

  it('includes helper function for WASM modules', () => {
    const toolchain = generateEmscriptenToolchain()

    expect(toolchain).toContain('function(functions_do_add_wasm_module')
    expect(toolchain).toContain('SOURCES')
    expect(toolchain).toContain('EXPORTS')
    expect(toolchain).toContain('EXPORTED_FUNCTIONS')
  })

  it('includes release and debug flag sets', () => {
    const toolchain = generateEmscriptenToolchain()

    expect(toolchain).toContain('FUNCTIONS_DO_RELEASE_FLAGS')
    expect(toolchain).toContain('FUNCTIONS_DO_DEBUG_FLAGS')
    expect(toolchain).toContain('-O3')
    expect(toolchain).toContain('-O0')
  })
})

describe('CMakeLists Generation', () => {
  it('generates valid CMakeLists.txt', () => {
    const cmake = generateCMakeLists('my_function')

    expect(cmake).toContain('cmake_minimum_required')
    expect(cmake).toContain('project(my_function')
  })

  it('includes C/C++ standard settings', () => {
    const cmake = generateCMakeLists('test')

    expect(cmake).toContain('CMAKE_C_STANDARD 11')
    expect(cmake).toContain('CMAKE_CXX_STANDARD 17')
  })

  it('includes Emscripten-specific build configuration', () => {
    const cmake = generateCMakeLists('test')

    expect(cmake).toContain('CMAKE_SYSTEM_NAME STREQUAL "Emscripten"')
    expect(cmake).toContain('functions_do_add_wasm_module')
    expect(cmake).toContain('EXPORTS')
  })

  it('includes native build configuration for testing', () => {
    const cmake = generateCMakeLists('test')

    expect(cmake).toContain('FUNCTIONS_DO_NATIVE_TEST')
    expect(cmake).toContain('enable_testing()')
    expect(cmake).toContain('add_test')
  })

  it('includes custom targets for size and optimization', () => {
    const cmake = generateCMakeLists('test')

    expect(cmake).toContain('add_custom_target(size')
    expect(cmake).toContain('add_custom_target(optimize')
    expect(cmake).toContain('wasm-opt')
  })
})
