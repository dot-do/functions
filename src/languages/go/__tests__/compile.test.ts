/**
 * Go to WASM Compilation Tests
 *
 * These tests validate the Go to WASM compilation pipeline for Functions.do.
 * The compiler is responsible for:
 * 1. Compiling Go function code to WASM using TinyGo
 * 2. Ensuring compiled WASM exports the function correctly via go:wasmexport
 * 3. Producing valid WASM binary that can be executed
 * 4. Generating TypeScript types and capnweb bindings
 */

import { describe, it, expect } from 'vitest'
import {
  compileGo,
  parseGoExports,
  generateTypeScriptTypes,
  generateCapnwebBindings,
  generateWasmExportDirective,
  wrapWithWasmExport,
  generateGoExportedFunction,
  generateSDKTemplate,
  type FunctionSignature,
} from '../compile'

describe('Go Compiler', () => {
  it('compiles Go to WASM', async () => {
    const goCode = `
package main

//go:wasmexport hello
func hello() int32 {
    return 42
}

func main() {}
`
    const result = await compileGo(goCode)

    // WASM magic bytes
    expect(result.wasm[0]).toBe(0x00)
    expect(result.wasm[1]).toBe(0x61)
    expect(result.wasm[2]).toBe(0x73)
    expect(result.wasm[3]).toBe(0x6d)
  })

  it('produces small binary with TinyGo', async () => {
    const goCode = `
package main

//go:wasmexport getValue
func getValue() int32 {
    return 100
}

func main() {}
`
    const result = await compileGo(goCode)
    // TinyGo should produce <2MB for simple functions
    expect(result.wasm.length).toBeLessThan(2 * 1024 * 1024)
  })

  it('exports the function specified by go:wasmexport directive', async () => {
    const goCode = `
package main

//go:wasmexport multiply
func multiply(a, b int32) int32 {
    return a * b
}

func main() {}
`
    const result = await compileGo(goCode)

    // Instantiate the WASM and verify the export exists
    const module = await WebAssembly.compile(result.wasm)
    const instance = await WebAssembly.instantiate(module)
    const exports = instance.exports

    expect(exports).toHaveProperty('multiply')
    expect(typeof exports['multiply']).toBe('function')
  })

  it('executes compiled WASM function correctly', async () => {
    const goCode = `
package main

//go:wasmexport add
func add(a, b int32) int32 {
    return a + b
}

func main() {}
`
    const result = await compileGo(goCode)

    // Instantiate and execute the function
    const module = await WebAssembly.compile(result.wasm)
    const instance = await WebAssembly.instantiate(module)
    const addFn = instance.exports['add'] as (a: number, b: number) => number

    expect(addFn(2, 3)).toBe(5)
    expect(addFn(10, 20)).toBe(30)
    expect(addFn(-5, 5)).toBe(0)
  })

  it('handles multiple exported functions', async () => {
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

func main() {}
`
    const result = await compileGo(goCode)

    const module = await WebAssembly.compile(result.wasm)
    const instance = await WebAssembly.instantiate(module)
    const exports = instance.exports

    // All functions should be exported
    expect(exports).toHaveProperty('add')
    expect(exports).toHaveProperty('subtract')
    expect(exports).toHaveProperty('multiply')

    // All functions should work correctly
    const add = exports['add'] as (a: number, b: number) => number
    const subtract = exports['subtract'] as (a: number, b: number) => number
    const multiply = exports['multiply'] as (a: number, b: number) => number

    expect(add(5, 3)).toBe(8)
    expect(subtract(10, 4)).toBe(6)
    expect(multiply(6, 7)).toBe(42)
  })

  it('generates TypeScript types when requested', async () => {
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
    expect(result.typescriptTypes).toContain('interface GoModuleExports')
    expect(result.typescriptTypes).toContain('add(a: number, b: number): number')
  })

  it('generates capnweb bindings when requested', async () => {
    const goCode = `
package main

//go:wasmexport multiply
func multiply(a, b int32) int32 {
    return a * b
}

func main() {}
`
    const result = await compileGo(goCode, { generateBindings: true })

    expect(result.capnwebBindings).toBeDefined()
    expect(result.capnwebBindings).toContain('extends RpcTarget')
    expect(result.capnwebBindings).toContain('multiply(a: number, b: number): number')
  })

  it('includes compilation metadata', async () => {
    const goCode = `
package main

//go:wasmexport hello
func hello() int32 {
    return 42
}

func main() {}
`
    const result = await compileGo(goCode)

    expect(result.metadata).toBeDefined()
    expect(result.metadata?.wasmSize).toBeGreaterThan(0)
    expect(result.metadata?.compiledAt).toBeDefined()
    expect(typeof result.metadata?.usedTinyGo).toBe('boolean')
  })
})

describe('parseGoExports', () => {
  it('parses single function export', () => {
    const code = `
package main

//go:wasmexport hello
func hello() int32 {
    return 42
}
`
    const exports = parseGoExports(code)

    expect(exports).toHaveLength(1)
    expect(exports[0].name).toBe('hello')
    expect(exports[0].params).toHaveLength(0)
    expect(exports[0].returnType).toBe('int32')
  })

  it('parses function with parameters', () => {
    const code = `
package main

//go:wasmexport add
func add(a, b int32) int32 {
    return a + b
}
`
    const exports = parseGoExports(code)

    expect(exports).toHaveLength(1)
    expect(exports[0].name).toBe('add')
    expect(exports[0].params).toHaveLength(2)
    expect(exports[0].params[0]).toEqual({ name: 'a', type: 'int32' })
    expect(exports[0].params[1]).toEqual({ name: 'b', type: 'int32' })
    expect(exports[0].returnType).toBe('int32')
  })

  it('parses multiple function exports', () => {
    const code = `
package main

//go:wasmexport add
func add(a, b int32) int32 {
    return a + b
}

//go:wasmexport multiply
func multiply(x, y int32) int32 {
    return x * y
}
`
    const exports = parseGoExports(code)

    expect(exports).toHaveLength(2)
    expect(exports[0].name).toBe('add')
    expect(exports[1].name).toBe('multiply')
  })

  it('handles functions without return type', () => {
    const code = `
package main

//go:wasmexport doSomething
func doSomething(x int32) {
    // side effect
}
`
    const exports = parseGoExports(code)

    expect(exports).toHaveLength(1)
    expect(exports[0].name).toBe('doSomething')
    expect(exports[0].returnType).toBeNull()
  })
})

describe('generateTypeScriptTypes', () => {
  it('generates interface with function signatures', () => {
    const signatures: FunctionSignature[] = [
      { name: 'add', params: [{ name: 'a', type: 'int32' }, { name: 'b', type: 'int32' }], returnType: 'int32' },
    ]

    const types = generateTypeScriptTypes(signatures, 'Calculator')

    expect(types).toContain('interface CalculatorExports')
    expect(types).toContain('add(a: number, b: number): number')
  })

  it('maps Go types to TypeScript types', () => {
    const signatures: FunctionSignature[] = [
      { name: 'process', params: [{ name: 'x', type: 'int64' }, { name: 'y', type: 'float64' }], returnType: 'bool' },
    ]

    const types = generateTypeScriptTypes(signatures)

    expect(types).toContain('x: bigint')
    expect(types).toContain('y: number')
    // bool return type should map to boolean, but the function returns it
  })

  it('generates parameter interfaces', () => {
    const signatures: FunctionSignature[] = [
      { name: 'add', params: [{ name: 'a', type: 'int32' }, { name: 'b', type: 'int32' }], returnType: 'int32' },
    ]

    const types = generateTypeScriptTypes(signatures)

    expect(types).toContain('interface AddParams')
    expect(types).toContain('a: number')
    expect(types).toContain('b: number')
  })

  it('generates RpcTarget interface', () => {
    const signatures: FunctionSignature[] = [
      { name: 'compute', params: [{ name: 'x', type: 'int32' }], returnType: 'int32' },
    ]

    const types = generateTypeScriptTypes(signatures, 'Math')

    expect(types).toContain('interface MathRpcTarget')
    expect(types).toContain('compute(x: number): Promise<number>')
  })
})

describe('generateCapnwebBindings', () => {
  it('generates RpcTarget class', () => {
    const signatures: FunctionSignature[] = [
      { name: 'greet', params: [], returnType: 'int32' },
    ]

    const bindings = generateCapnwebBindings(signatures, 'Hello')

    expect(bindings).toContain('class HelloTarget extends RpcTarget')
    expect(bindings).toContain('greet(): number')
  })

  it('generates factory function', () => {
    const signatures: FunctionSignature[] = [
      { name: 'compute', params: [{ name: 'x', type: 'int32' }], returnType: 'int32' },
    ]

    const bindings = generateCapnwebBindings(signatures, 'Math')

    expect(bindings).toContain('async function createMathTarget')
    expect(bindings).toContain('Promise<MathTarget>')
  })

  it('generates proper method implementations', () => {
    const signatures: FunctionSignature[] = [
      { name: 'add', params: [{ name: 'a', type: 'int32' }, { name: 'b', type: 'int32' }], returnType: 'int32' },
    ]

    const bindings = generateCapnwebBindings(signatures)

    expect(bindings).toContain('add(a: number, b: number): number')
    expect(bindings).toContain('return this.instance.exports.add(a, b)')
  })
})

describe('go:wasmexport helpers', () => {
  it('generates wasmexport directive', () => {
    const directive = generateWasmExportDirective('myFunc')
    expect(directive).toBe('//go:wasmexport myFunc')
  })

  it('generates wasmexport directive with custom export name', () => {
    const directive = generateWasmExportDirective('myFunc', 'exported_name')
    expect(directive).toBe('//go:wasmexport exported_name')
  })

  it('wraps existing function with wasmexport', () => {
    const code = `
package main

func add(a, b int32) int32 {
    return a + b
}
`
    const wrapped = wrapWithWasmExport(code, 'add')

    expect(wrapped).toContain('//go:wasmexport add')
    expect(wrapped).toContain('func add(a, b int32) int32')
  })

  it('generates complete exported function', () => {
    const sig: FunctionSignature = {
      name: 'multiply',
      params: [{ name: 'a', type: 'int32' }, { name: 'b', type: 'int32' }],
      returnType: 'int32',
    }

    const func = generateGoExportedFunction(sig)

    expect(func).toContain('//go:wasmexport multiply')
    expect(func).toContain('func multiply(a int32, b int32) int32')
    expect(func).toContain('return 0')
  })
})

describe('generateSDKTemplate', () => {
  it('generates all required files', () => {
    const signatures: FunctionSignature[] = [
      { name: 'add', params: [{ name: 'a', type: 'int32' }, { name: 'b', type: 'int32' }], returnType: 'int32' },
    ]

    const template = generateSDKTemplate('calculator', signatures)

    expect(template['go.mod']).toBeDefined()
    expect(template['main.go']).toBeDefined()
    expect(template['Makefile']).toBeDefined()
    expect(template['README.md']).toBeDefined()
    expect(template['types.d.ts']).toBeDefined()
    expect(template['bindings.ts']).toBeDefined()
  })

  it('generates valid go.mod', () => {
    const template = generateSDKTemplate('mymodule', [])

    expect(template['go.mod']).toContain('module functions-do/mymodule')
    expect(template['go.mod']).toContain('go 1.21')
  })

  it('generates Makefile with size targets', () => {
    const template = generateSDKTemplate('mymodule', [])

    expect(template['Makefile']).toContain('TINYGO = tinygo')
    expect(template['Makefile']).toContain('-gc=leaking')
    expect(template['Makefile']).toContain('-scheduler=none')
    expect(template['Makefile']).toContain('100KB')
    expect(template['Makefile']).toContain('2MB')
  })

  it('generates README with function documentation', () => {
    const signatures: FunctionSignature[] = [
      { name: 'calculate', params: [{ name: 'x', type: 'int32' }], returnType: 'int32' },
    ]

    const template = generateSDKTemplate('calc', signatures)

    expect(template['README.md']).toContain('calculate')
    expect(template['README.md']).toContain('x: int32')
    expect(template['README.md']).toContain('-> int32')
  })
})
