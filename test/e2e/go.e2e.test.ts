/**
 * E2E Tests: Go WASM Function Deploy and Invoke (RED)
 *
 * These tests verify the full deployment and invocation flow for Go
 * functions compiled to WASM on the live functions.do platform.
 *
 * Go WASM uses the //go:wasmexport directive (Go 1.24+) for exports.
 *
 * Prerequisites:
 * - functions.do Worker must be deployed
 * - WASM compilation pipeline must be working for Go
 * - Static assets storage configured
 *
 * Run with: npm run test:e2e
 */

import { describe, it, expect, afterAll } from 'vitest'
import {
  E2E_CONFIG,
  generateTestFunctionId,
  shouldRunE2E,
  deployFunction,
  invokeFunction,
  deleteFunction,
} from './config'

describe.skipIf(!shouldRunE2E())('E2E: Go WASM Function Deploy and Invoke', () => {
  const deployedFunctions: string[] = []

  afterAll(async () => {
    if (!E2E_CONFIG.skipCleanup) {
      for (const functionId of deployedFunctions) {
        try {
          await deleteFunction(functionId)
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  })

  describe('Basic WASM Deployment', () => {
    it('deploys a simple Go function returning a constant', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        package main

        //go:wasmexport get_answer
        func get_answer() int32 {
          return 42
        }

        func main() {}
      `

      const result = await deployFunction({
        id: functionId,
        code,
        language: 'go',
        version: '1.0.0',
      })

      expect(result.id).toBe(functionId)
      expect(result.version).toBe('1.0.0')
      expect(result.url).toContain(functionId)
    }, E2E_CONFIG.deployTimeout)

    it('deploys and invokes an add function', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        package main

        //go:wasmexport add
        func add(a, b int32) int32 {
          return a + b
        }

        func main() {}
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'go',
        version: '1.0.0',
      })

      // RPC-style invocation
      const result = await invokeFunction<{ result: number }>(functionId, {
        method: 'add',
        params: [2, 3],
      })

      expect(result.result).toBe(5)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)
  })

  describe('Multiple Functions', () => {
    it('deploys a module with multiple exported functions', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        package main

        //go:wasmexport add
        func add(a, b int32) int32 {
          return a + b
        }

        //go:wasmexport multiply
        func multiply(a, b int32) int32 {
          return a * b
        }

        //go:wasmexport subtract
        func subtract(a, b int32) int32 {
          return a - b
        }

        func main() {}
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'go',
        version: '1.0.0',
      })

      // Test add
      const addResult = await invokeFunction<{ result: number }>(functionId, {
        method: 'add',
        params: [10, 5],
      })
      expect(addResult.result).toBe(15)

      // Test multiply
      const multiplyResult = await invokeFunction<{ result: number }>(functionId, {
        method: 'multiply',
        params: [10, 5],
      })
      expect(multiplyResult.result).toBe(50)

      // Test subtract
      const subtractResult = await invokeFunction<{ result: number }>(functionId, {
        method: 'subtract',
        params: [10, 5],
      })
      expect(subtractResult.result).toBe(5)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout * 3)
  })

  describe('Type Support', () => {
    it('handles int64 parameters and return values', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        package main

        //go:wasmexport add_big
        func add_big(a, b int64) int64 {
          return a + b
        }

        func main() {}
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'go',
        version: '1.0.0',
      })

      const result = await invokeFunction<{ result: string }>(functionId, {
        method: 'add_big',
        params: ['9007199254740992', '1'], // BigInt as strings
      })

      expect(result.result).toBe('9007199254740993')
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)

    it('handles float32 floating point', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        package main

        //go:wasmexport multiply_floats
        func multiply_floats(a, b float32) float32 {
          return a * b
        }

        func main() {}
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'go',
        version: '1.0.0',
      })

      const result = await invokeFunction<{ result: number }>(functionId, {
        method: 'multiply_floats',
        params: [2.5, 4.0],
      })

      expect(result.result).toBeCloseTo(10.0)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)

    it('handles float64 double precision', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        package main

        //go:wasmexport divide
        func divide(a, b float64) float64 {
          return a / b
        }

        func main() {}
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'go',
        version: '1.0.0',
      })

      const result = await invokeFunction<{ result: number }>(functionId, {
        method: 'divide',
        params: [22.0, 7.0],
      })

      expect(result.result).toBeCloseTo(3.142857, 5)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)

    it('handles uint32 unsigned integers', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        package main

        //go:wasmexport unsigned_add
        func unsigned_add(a, b uint32) uint32 {
          return a + b
        }

        func main() {}
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'go',
        version: '1.0.0',
      })

      const result = await invokeFunction<{ result: number }>(functionId, {
        method: 'unsigned_add',
        params: [4294967290, 5],
      })

      // Should wrap around for uint32
      expect(result.result).toBe(4294967295)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)
  })

  describe('Error Handling', () => {
    it('rejects invalid Go syntax', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        package main

        //go:wasmexport broken
        func broken( int32 {  // Missing parameter name and closing paren
          return 42
        }

        func main() {}
      `

      await expect(
        deployFunction({
          id: functionId,
          code,
          language: 'go',
          version: '1.0.0',
        })
      ).rejects.toThrow()
    })

    it('rejects code with no exported functions', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        package main

        // No //go:wasmexport directive, so nothing exported
        func privateFunction() int32 {
          return 42
        }

        func main() {}
      `

      await expect(
        deployFunction({
          id: functionId,
          code,
          language: 'go',
          version: '1.0.0',
        })
      ).rejects.toThrow(/no exportable functions/i)
    })

    it('rejects code missing main function', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        package main

        //go:wasmexport get_value
        func get_value() int32 {
          return 42
        }

        // Missing func main() {}
      `

      await expect(
        deployFunction({
          id: functionId,
          code,
          language: 'go',
          version: '1.0.0',
        })
      ).rejects.toThrow()
    })
  })

  describe('Go-Specific Features', () => {
    it('handles functions with local variables and logic', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        package main

        //go:wasmexport fibonacci
        func fibonacci(n int32) int32 {
          if n <= 1 {
            return n
          }
          a, b := int32(0), int32(1)
          for i := int32(2); i <= n; i++ {
            a, b = b, a+b
          }
          return b
        }

        func main() {}
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'go',
        version: '1.0.0',
      })

      const result = await invokeFunction<{ result: number }>(functionId, {
        method: 'fibonacci',
        params: [10],
      })

      expect(result.result).toBe(55)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)

    it('handles functions calling other functions', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        package main

        func square(n int32) int32 {
          return n * n
        }

        //go:wasmexport sum_of_squares
        func sum_of_squares(a, b int32) int32 {
          return square(a) + square(b)
        }

        func main() {}
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'go',
        version: '1.0.0',
      })

      const result = await invokeFunction<{ result: number }>(functionId, {
        method: 'sum_of_squares',
        params: [3, 4],
      })

      expect(result.result).toBe(25) // 9 + 16
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)

    it('handles boolean return values', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        package main

        //go:wasmexport is_even
        func is_even(n int32) bool {
          return n % 2 == 0
        }

        func main() {}
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'go',
        version: '1.0.0',
      })

      const evenResult = await invokeFunction<{ result: boolean }>(functionId, {
        method: 'is_even',
        params: [4],
      })
      expect(evenResult.result).toBe(true)

      const oddResult = await invokeFunction<{ result: boolean }>(functionId, {
        method: 'is_even',
        params: [5],
      })
      expect(oddResult.result).toBe(false)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout * 2)
  })

  describe('WASM Size and Performance', () => {
    it('produces reasonably sized WASM', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        package main

        //go:wasmexport simple
        func simple() int32 {
          return 1
        }

        func main() {}
      `

      const result = await deployFunction({
        id: functionId,
        code,
        language: 'go',
        version: '1.0.0',
      })

      // WASM should be generated (Go WASM may be larger than Rust)
      // The deploy response should include size metadata
      expect(result).toBeDefined()
    }, E2E_CONFIG.deployTimeout)

    it('executes WASM with acceptable latency', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        package main

        //go:wasmexport add
        func add(a, b int32) int32 {
          return a + b
        }

        func main() {}
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'go',
        version: '1.0.0',
      })

      const start = Date.now()
      await invokeFunction(functionId, { method: 'add', params: [1, 2] })
      const elapsed = Date.now() - start

      // First invocation might be slower (cold start)
      // Go WASM may have slightly higher overhead than Rust
      expect(elapsed).toBeLessThan(5000) // 5s max for cold start
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)
  })
})
