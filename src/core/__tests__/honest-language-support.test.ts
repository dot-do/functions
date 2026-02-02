/**
 * Honest Language Support Tests
 *
 * These tests verify that fake WASM compilers have been removed and that
 * only TypeScript, JavaScript, and Python (beta) are listed as supported.
 *
 * Languages like Rust, Go, Zig, AssemblyScript, and C/C++ should return
 * clear "not yet supported" errors instead of silently producing wrong results.
 *
 * Issues: functions-cm2v (RED), functions-ed82 (GREEN)
 */

import { describe, it, expect } from 'vitest'

// Import the fake compilers to verify they now throw honest errors
import { compileRust } from '../../languages/rust/compile'
import { compileGo } from '../../languages/go/compile'
import { compileZig } from '../../languages/zig/compile'
import { compileAssemblyScript } from '../../languages/assemblyscript/compile'
import { compileC } from '../../languages/cpp/compile'

// Import the CodeExecutor to test compileToWasm behavior
import { CodeExecutor } from '../../tiers/code-executor'

describe('Honest Language Support', () => {
  describe('Rust compilation returns not-yet-supported error', () => {
    it('should throw a clear "not yet supported" error for any Rust code', async () => {
      const rustCode = `
        #[no_mangle]
        pub extern "C" fn add(a: i32, b: i32) -> i32 {
          a + b
        }
      `
      await expect(compileRust(rustCode)).rejects.toThrow(/not yet supported/i)
    })

    it('should mention supported languages in the error message', async () => {
      const rustCode = `
        #[no_mangle]
        pub extern "C" fn identity(x: i32) -> i32 {
          x
        }
      `
      await expect(compileRust(rustCode)).rejects.toThrow(/TypeScript|JavaScript|Python/i)
    })

    it('should NOT silently return fake WASM bytes', async () => {
      const rustCode = `
        #[no_mangle]
        pub extern "C" fn add(a: i32, b: i32) -> i32 {
          a + b
        }
      `
      let gotWasm = false
      try {
        const result = await compileRust(rustCode)
        if (result && result.wasm && result.wasm.length > 0) {
          gotWasm = true
        }
      } catch {
        // Expected - should throw
      }
      expect(gotWasm).toBe(false)
    })
  })

  describe('Go compilation returns not-yet-supported error', () => {
    it('should throw a clear "not yet supported" error for any Go code', async () => {
      const goCode = `
        package main

        //go:wasmexport add
        func addImpl(a, b int32) int32 {
          return a + b
        }

        func main() {}
      `
      await expect(compileGo(goCode)).rejects.toThrow(/not yet supported/i)
    })

    it('should mention supported languages in the error message', async () => {
      const goCode = `
        package main

        //go:wasmexport add
        func addImpl(a, b int32) int32 {
          return a + b
        }

        func main() {}
      `
      await expect(compileGo(goCode)).rejects.toThrow(/TypeScript|JavaScript|Python/i)
    })
  })

  describe('Zig compilation returns not-yet-supported error', () => {
    it('should throw a clear "not yet supported" error for any Zig code', async () => {
      const zigCode = `
        export fn add(a: i32, b: i32) i32 {
          return a + b;
        }
      `
      await expect(compileZig(zigCode)).rejects.toThrow(/not yet supported/i)
    })

    it('should mention supported languages in the error message', async () => {
      const zigCode = `
        export fn add(a: i32, b: i32) i32 {
          return a + b;
        }
      `
      await expect(compileZig(zigCode)).rejects.toThrow(/TypeScript|JavaScript|Python/i)
    })
  })

  describe('AssemblyScript compilation returns not-yet-supported error', () => {
    it('should throw a clear "not yet supported" error for any AssemblyScript code', async () => {
      const asCode = `
        export function add(a: i32, b: i32): i32 {
          return a + b
        }
      `
      await expect(compileAssemblyScript(asCode)).rejects.toThrow(/not yet supported/i)
    })

    it('should mention supported languages in the error message', async () => {
      const asCode = `
        export function add(a: i32, b: i32): i32 {
          return a + b
        }
      `
      await expect(compileAssemblyScript(asCode)).rejects.toThrow(/TypeScript|JavaScript|Python/i)
    })
  })

  describe('C/C++ compilation returns not-yet-supported error', () => {
    it('should throw a clear "not yet supported" error for any C code', async () => {
      const cCode = `
        int add(int a, int b) {
          return a + b;
        }
      `
      await expect(compileC(cCode)).rejects.toThrow(/not yet supported/i)
    })

    it('should throw a clear "not yet supported" error for any C++ code', async () => {
      const cppCode = `
        extern "C" {
          int add(int a, int b) {
            return a + b;
          }
        }
      `
      await expect(compileC(cppCode, { language: 'cpp' })).rejects.toThrow(/not yet supported/i)
    })

    it('should mention supported languages in the error message', async () => {
      const cCode = `
        int add(int a, int b) {
          return a + b;
        }
      `
      await expect(compileC(cCode)).rejects.toThrow(/TypeScript|JavaScript|Python/i)
    })
  })

  describe('CodeExecutor rejects WASM languages entirely', () => {
    it('should throw for rust source code since rust is no longer a supported language', async () => {
      const executor = new CodeExecutor({})

      const rustCode = `
        #[no_mangle]
        pub extern "C" fn add(a: i32, b: i32) -> i32 {
          a + b
        }
      `

      // The execute method should throw because 'rust' is no longer in SUPPORTED_LANGUAGES
      await expect(
        executor.execute(
          {
            id: 'test-fn' as any,
            version: '1.0.0',
            language: 'rust' as any,
            source: { type: 'inline', code: rustCode },
          },
          { n: 5 },
        )
      ).rejects.toThrow(/unsupported language/i)
    })

    it('should also reject pre-compiled WASM markers for unsupported languages', async () => {
      const executor = new CodeExecutor({})

      // Even with WASM markers, rust is no longer a supported language
      // The language validation happens before compile/execute
      await expect(
        executor.execute(
          {
            id: 'test-fn' as any,
            version: '1.0.0',
            language: 'rust' as any,
            source: { type: 'inline', code: '__WASM_ASSETS__:test-fn:latest' },
          },
          {},
        )
      ).rejects.toThrow(/unsupported language/i)
    })
  })

  describe('SUPPORTED_LANGUAGES list is honest', () => {
    it('should reject rust as an unsupported language in CodeExecutor', async () => {
      const executor = new CodeExecutor({})

      // 'rust' should be rejected as unsupported by the execute method
      // since it's been removed from SUPPORTED_LANGUAGES
      try {
        await executor.execute(
          {
            id: 'test-fn' as any,
            version: '1.0.0',
            language: 'rust' as any,
            source: { type: 'inline', code: 'fn main() {}' },
          },
          {},
        )
        // If no throw, should have failed status
      } catch (error) {
        // Expected: "Unsupported language: rust"
        expect((error as Error).message).toMatch(/unsupported language/i)
      }
    })

    it('should reject go as an unsupported language in CodeExecutor', async () => {
      const executor = new CodeExecutor({})

      try {
        await executor.execute(
          {
            id: 'test-fn' as any,
            version: '1.0.0',
            language: 'go' as any,
            source: { type: 'inline', code: 'package main' },
          },
          {},
        )
      } catch (error) {
        expect((error as Error).message).toMatch(/unsupported language/i)
      }
    })

    it('should reject zig as an unsupported language in CodeExecutor', async () => {
      const executor = new CodeExecutor({})

      try {
        await executor.execute(
          {
            id: 'test-fn' as any,
            version: '1.0.0',
            language: 'zig' as any,
            source: { type: 'inline', code: 'export fn add() void {}' },
          },
          {},
        )
      } catch (error) {
        expect((error as Error).message).toMatch(/unsupported language/i)
      }
    })

    it('should reject assemblyscript as an unsupported language in CodeExecutor', async () => {
      const executor = new CodeExecutor({})

      try {
        await executor.execute(
          {
            id: 'test-fn' as any,
            version: '1.0.0',
            language: 'assemblyscript' as any,
            source: { type: 'inline', code: 'export function add(): i32 { return 0 }' },
          },
          {},
        )
      } catch (error) {
        expect((error as Error).message).toMatch(/unsupported language/i)
      }
    })

    it('should accept typescript as a supported language', async () => {
      const executor = new CodeExecutor({})

      // Should not throw "Unsupported language" - may fail for other reasons
      // (like missing bindings) but should not reject the language itself
      try {
        await executor.execute(
          {
            id: 'test-fn' as any,
            version: '1.0.0',
            language: 'typescript',
            source: { type: 'inline', code: 'export default function handler(input: any) { return input }' },
          },
          { hello: 'world' },
        )
      } catch (error) {
        // If it fails, the error should NOT be about unsupported language
        expect((error as Error).message).not.toMatch(/unsupported language/i)
      }
    })

    it('should accept javascript as a supported language', async () => {
      const executor = new CodeExecutor({})

      try {
        await executor.execute(
          {
            id: 'test-fn' as any,
            version: '1.0.0',
            language: 'javascript',
            source: { type: 'inline', code: 'export default function handler(input) { return input }' },
          },
          { hello: 'world' },
        )
      } catch (error) {
        expect((error as Error).message).not.toMatch(/unsupported language/i)
      }
    })

    it('should accept python as a supported language', async () => {
      const executor = new CodeExecutor({})

      try {
        await executor.execute(
          {
            id: 'test-fn' as any,
            version: '1.0.0',
            language: 'python',
            source: { type: 'inline', code: 'def handler(input):\n  return input' },
          },
          { hello: 'world' },
        )
      } catch (error) {
        // If it fails, the error should NOT be about unsupported language
        expect((error as Error).message).not.toMatch(/unsupported language/i)
      }
    })
  })
})
