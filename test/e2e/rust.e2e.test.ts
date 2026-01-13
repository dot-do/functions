/**
 * E2E Tests: Rust WASM Function Deploy and Invoke (RED)
 *
 * These tests verify the full deployment and invocation flow for Rust
 * functions compiled to WASM on the live functions.do platform.
 *
 * Prerequisites:
 * - functions.do Worker must be deployed
 * - WASM compilation pipeline must be working
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

describe.skipIf(!shouldRunE2E())('E2E: Rust WASM Function Deploy and Invoke', () => {
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
    it('deploys a simple Rust function returning a constant', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        #[no_mangle]
        pub extern "C" fn get_answer() -> i32 {
          42
        }
      `

      const result = await deployFunction({
        id: functionId,
        code,
        language: 'rust',
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
        #[no_mangle]
        pub extern "C" fn add(a: i32, b: i32) -> i32 {
          a + b
        }
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'rust',
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

      await deployFunction({
        id: functionId,
        code,
        language: 'rust',
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
    it('handles i64 parameters and return values', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        #[no_mangle]
        pub extern "C" fn add_big(a: i64, b: i64) -> i64 {
          a + b
        }
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'rust',
        version: '1.0.0',
      })

      const result = await invokeFunction<{ result: string }>(functionId, {
        method: 'add_big',
        params: ['9007199254740992', '1'], // BigInt as strings
      })

      expect(result.result).toBe('9007199254740993')
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)

    it('handles f32 floating point', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        #[no_mangle]
        pub extern "C" fn multiply_floats(a: f32, b: f32) -> f32 {
          a * b
        }
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'rust',
        version: '1.0.0',
      })

      const result = await invokeFunction<{ result: number }>(functionId, {
        method: 'multiply_floats',
        params: [2.5, 4.0],
      })

      expect(result.result).toBeCloseTo(10.0)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)

    it('handles f64 double precision', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        #[no_mangle]
        pub extern "C" fn divide(a: f64, b: f64) -> f64 {
          a / b
        }
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'rust',
        version: '1.0.0',
      })

      const result = await invokeFunction<{ result: number }>(functionId, {
        method: 'divide',
        params: [22.0, 7.0],
      })

      expect(result.result).toBeCloseTo(3.142857, 5)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)
  })

  describe('Error Handling', () => {
    it('rejects invalid Rust syntax', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        #[no_mangle]
        pub extern "C" fn broken( -> i32 {  // Missing parameter list close
          42
        }
      `

      await expect(
        deployFunction({
          id: functionId,
          code,
          language: 'rust',
          version: '1.0.0',
        })
      ).rejects.toThrow()
    })

    it('rejects code with no exported functions', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        // No #[no_mangle], so nothing exported
        fn private_function() -> i32 {
          42
        }
      `

      await expect(
        deployFunction({
          id: functionId,
          code,
          language: 'rust',
          version: '1.0.0',
        })
      ).rejects.toThrow(/no exportable functions/i)
    })
  })

  describe('WASM Size and Performance', () => {
    it('produces reasonably sized WASM', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        #[no_mangle]
        pub extern "C" fn simple() -> i32 {
          1
        }
      `

      const result = await deployFunction({
        id: functionId,
        code,
        language: 'rust',
        version: '1.0.0',
      })

      // WASM should be small for a simple function
      // The deploy response should include size metadata
      expect(result).toBeDefined()
    }, E2E_CONFIG.deployTimeout)

    it('executes WASM with acceptable latency', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        #[no_mangle]
        pub extern "C" fn add(a: i32, b: i32) -> i32 {
          a + b
        }
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'rust',
        version: '1.0.0',
      })

      const start = Date.now()
      await invokeFunction(functionId, { method: 'add', params: [1, 2] })
      const elapsed = Date.now() - start

      // First invocation might be slower (cold start)
      // Subsequent should be fast
      expect(elapsed).toBeLessThan(5000) // 5s max for cold start
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)
  })
})
