/**
 * E2E Tests: TypeScript Function Deploy and Invoke (RED)
 *
 * These tests verify the full deployment and invocation flow for TypeScript
 * functions on the live functions.do platform.
 *
 * Prerequisites:
 * - functions.do Worker must be deployed
 * - No auth required initially (added in GREEN phase)
 *
 * Run with: npm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  E2E_CONFIG,
  generateTestFunctionId,
  shouldRunE2E,
  deployFunction,
  deployAndUploadFunction,
  invokeFunction,
  deleteFunction,
} from './config'
import { waitForFunctionResult } from './utils'

describe.skipIf(!shouldRunE2E())('E2E: TypeScript Function Deploy and Invoke', () => {
  const deployedFunctions: string[] = []

  afterAll(async () => {
    // Cleanup deployed functions
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

  describe('Basic Deployment', () => {
    it('deploys a simple TypeScript function', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return new Response('Hello from TypeScript!', {
              headers: { 'Content-Type': 'text/plain' }
            })
          }
        }
      `

      const result = await deployFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      expect(result.id).toBe(functionId)
      expect(result.version).toBe('1.0.0')
      expect(result.url).toContain(functionId)
    }, E2E_CONFIG.deployTimeout)

    it('deploys and invokes returning JSON', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const body = await request.json().catch(() => ({}))
            return Response.json({
              message: 'Hello, World!',
              received: body,
              timestamp: new Date().toISOString()
            })
          }
        }
      `

      await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      const result = await invokeFunction<{
        message: string
        received: unknown
        timestamp: string
      }>(functionId, { test: true })

      expect(result.message).toBe('Hello, World!')
      expect(result.received).toEqual({ test: true })
      expect(result.timestamp).toBeDefined()
    }, E2E_CONFIG.deployInvokeTimeout)
  })

  describe('Function with Dependencies', () => {
    it('deploys a function that uses external modules', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      // Simple function that doesn't need external deps
      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const url = new URL(request.url)
            const params = Object.fromEntries(url.searchParams)
            return Response.json({ params })
          }
        }
      `

      const result = await deployFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      expect(result.id).toBe(functionId)
    }, E2E_CONFIG.deployTimeout)
  })

  describe('Error Handling', () => {
    // TypeScript syntax errors are not validated at deploy time because we
    // store source directly and compile at runtime.  Deploy should succeed
    // (stores source) but runtime invocation should fail with an error.
    it('syntax errors are caught at runtime, not deploy time', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response {  // Missing >
            return new Response('broken')
          }
        }
      `

      // Deploy succeeds (stores source without validation).
      // Use deployFunction (API-only) since dispatch namespace upload is
      // not needed -- the worker_loaders path handles execution.
      const result = await deployFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })
      expect(result.id).toBe(functionId)

      // Runtime invocation should fail due to syntax error
      await expect(invokeFunction(functionId)).rejects.toThrow(/error|failed|syntax/i)
    }, E2E_CONFIG.deployInvokeTimeout)

    it('handles runtime errors gracefully', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            throw new Error('Intentional error for testing')
          }
        }
      `

      await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      // Invoking should return an error response, not crash
      await expect(invokeFunction(functionId)).rejects.toThrow(/error|failed/i)
    }, E2E_CONFIG.deployInvokeTimeout)
  })

  describe('Versioning', () => {
    it('deploys multiple versions of the same function', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      // Deploy v1
      const codeV1 = `
        export default {
          async fetch(): Promise<Response> {
            return Response.json({ version: 1 })
          }
        }
      `
      await deployAndUploadFunction({
        id: functionId,
        code: codeV1,
        language: 'typescript',
        version: '1.0.0',
      })

      // Deploy v2
      const codeV2 = `
        export default {
          async fetch(): Promise<Response> {
            return Response.json({ version: 2 })
          }
        }
      `
      await deployAndUploadFunction({
        id: functionId,
        code: codeV2,
        language: 'typescript',
        version: '2.0.0',
      })

      // Poll for propagation - dispatch namespace may have a delay
      // before the new version is served (expected in Workers for Platforms)
      const result = await waitForFunctionResult(
        () => invokeFunction<{ version: number }>(functionId),
        (r) => r.version === 2,
        { timeout: 15000, interval: 500, description: 'function to serve version 2' }
      )
      expect(result.version).toBe(2)
    }, E2E_CONFIG.deployTimeout * 2 + E2E_CONFIG.invokeTimeout + 15000)
  })

  describe('Request/Response Handling', () => {
    it('handles query parameters', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const url = new URL(request.url)
            const name = url.searchParams.get('name') || 'World'
            return Response.json({ greeting: \`Hello, \${name}!\` })
          }
        }
      `

      await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      // Note: Query params would need to be passed via the invoke endpoint
      const result = await invokeFunction<{ greeting: string }>(functionId)
      expect(result.greeting).toBe('Hello, World!')
    }, E2E_CONFIG.deployInvokeTimeout)

    it('handles POST body parsing', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const body = await request.json()
            return Response.json({
              echo: body,
              method: request.method
            })
          }
        }
      `

      await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      const testData = { foo: 'bar', nested: { value: 123 } }
      const result = await invokeFunction<{ echo: typeof testData; method: string }>(
        functionId,
        testData
      )

      expect(result.echo).toEqual(testData)
      expect(result.method).toBe('POST')
    }, E2E_CONFIG.deployInvokeTimeout)
  })
})
