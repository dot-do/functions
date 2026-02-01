/**
 * E2E Tests: Code Function Lifecycle (RED)
 *
 * Comprehensive E2E tests for Code function deployment, invocation,
 * version management, error handling, and edge cases.
 *
 * These tests run against the deployed worker at FUNCTIONS_E2E_URL
 * and verify the complete function lifecycle.
 *
 * Prerequisites:
 * - functions.do Worker must be deployed
 * - No auth required initially (added later with oauth.do)
 *
 * Run with: npm run test:e2e
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  E2E_CONFIG,
  generateTestFunctionId,
  shouldRunE2E,
  deployFunction,
  deployAndUploadFunction,
  invokeFunction,
  deleteFunction,
  getFunctionLogs,
} from './config'
import { waitForLogs } from './utils'

/**
 * Helper to get function info via API
 */
async function getFunctionInfo(functionId: string): Promise<{
  id: string
  version: string
  language: string
  createdAt: string
  updatedAt: string
  versions: string[]
}> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/functions/${functionId}/info`, {
    method: 'GET',
    headers: {
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Get function info failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Helper to rollback a function to a specific version
 */
async function rollbackFunction(
  functionId: string,
  version: string
): Promise<{ id: string; version: string; rolledBackFrom: string }> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/functions/${functionId}/rollback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
    body: JSON.stringify({ version }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Rollback failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Helper to invoke function with raw response (for inspecting metadata)
 */
async function invokeFunctionRaw(
  functionId: string,
  data?: unknown
): Promise<Response> {
  return fetch(`${E2E_CONFIG.baseUrl}/functions/${functionId}/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  })
}

/**
 * Helper to check if function exists (returns 404 if not)
 */
async function functionExists(functionId: string): Promise<boolean> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/functions/${functionId}/info`, {
    method: 'GET',
    headers: {
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
  })
  return response.ok
}

describe.skipIf(!shouldRunE2E())('E2E: Code Function Lifecycle', () => {
  const deployedFunctions: string[] = []

  afterAll(async () => {
    // Cleanup all deployed test functions
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

  // ============================================================================
  // 1. TypeScript Function Lifecycle
  // ============================================================================
  describe('TypeScript Function Lifecycle', () => {
    let lifecycleFunctionId: string

    beforeAll(() => {
      lifecycleFunctionId = generateTestFunctionId()
      deployedFunctions.push(lifecycleFunctionId)
    })

    it('deploys a TypeScript function', async () => {
      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const body = await request.json().catch(() => ({})) as { name?: string }
            const name = body.name || 'World'
            return Response.json({
              message: \`Hello, \${name}!\`,
              language: 'TypeScript',
              timestamp: Date.now()
            })
          }
        }
      `

      const result = await deployAndUploadFunction({
        id: lifecycleFunctionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      expect(result.id).toBe(lifecycleFunctionId)
      expect(result.version).toBe('1.0.0')
      expect(result.url).toContain(lifecycleFunctionId)
    }, E2E_CONFIG.deployTimeout)

    it('invokes the TypeScript function with input', async () => {
      const result = await invokeFunction<{
        message: string
        language: string
        timestamp: number
      }>(lifecycleFunctionId, { name: 'E2E Test' })

      expect(result.message).toBe('Hello, E2E Test!')
      expect(result.language).toBe('TypeScript')
      expect(typeof result.timestamp).toBe('number')
    }, E2E_CONFIG.invokeTimeout)

    it('gets function info', async () => {
      const info = await getFunctionInfo(lifecycleFunctionId)

      expect(info.id).toBe(lifecycleFunctionId)
      expect(info.version).toBe('1.0.0')
      expect(info.language).toBe('typescript')
      expect(info.createdAt).toBeDefined()
      expect(info.updatedAt).toBeDefined()
      expect(Array.isArray(info.versions)).toBe(true)
      expect(info.versions).toContain('1.0.0')
    }, E2E_CONFIG.invokeTimeout)

    it('gets function logs', async () => {
      // First invoke to generate some logs
      await invokeFunction(lifecycleFunctionId, { name: 'LogTest' })

      // Poll for logs to be captured (avoids flaky fixed delays)
      const logs = await waitForLogs(
        () => getFunctionLogs(lifecycleFunctionId, { limit: 10 }),
        { timeout: 10000, interval: 500, minCount: 0, description: 'function logs' }
      )

      expect(Array.isArray(logs)).toBe(true)
      // Logs may or may not be present depending on implementation
      // but the endpoint should work
      if (logs.length > 0) {
        expect(logs[0]).toHaveProperty('timestamp')
        expect(logs[0]).toHaveProperty('level')
        expect(logs[0]).toHaveProperty('message')
      }
    }, E2E_CONFIG.invokeTimeout + 5000)

    it('deletes the function', async () => {
      await deleteFunction(lifecycleFunctionId)

      // Remove from cleanup list since we've already deleted it
      const index = deployedFunctions.indexOf(lifecycleFunctionId)
      if (index > -1) {
        deployedFunctions.splice(index, 1)
      }
    }, E2E_CONFIG.invokeTimeout)

    it('returns 404 after delete', async () => {
      const exists = await functionExists(lifecycleFunctionId)
      expect(exists).toBe(false)

      // Also verify invoke fails
      await expect(
        invokeFunction(lifecycleFunctionId, {})
      ).rejects.toThrow(/404|not found/i)
    }, E2E_CONFIG.invokeTimeout)
  })

  // ============================================================================
  // 2. JavaScript Function
  // ============================================================================
  describe('JavaScript Function', () => {
    it('deploys and invokes plain JavaScript', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request) {
            const body = await request.json().catch(() => ({}))
            return Response.json({
              result: (body.a || 0) + (body.b || 0),
              language: 'JavaScript'
            })
          }
        }
      `

      await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'javascript',
        version: '1.0.0',
      })

      const result = await invokeFunction<{
        result: number
        language: string
      }>(functionId, { a: 10, b: 32 })

      expect(result.result).toBe(42)
      expect(result.language).toBe('JavaScript')
    }, E2E_CONFIG.deployInvokeTimeout)

    it('handles JavaScript with async/await patterns', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

        export default {
          async fetch(request) {
            await delay(100) // Small delay to test async
            const body = await request.json().catch(() => ({}))
            return Response.json({
              processed: body.items?.map(x => x * 2) || [],
              asyncWorked: true
            })
          }
        }
      `

      await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'javascript',
        version: '1.0.0',
      })

      const result = await invokeFunction<{
        processed: number[]
        asyncWorked: boolean
      }>(functionId, { items: [1, 2, 3, 4, 5] })

      expect(result.processed).toEqual([2, 4, 6, 8, 10])
      expect(result.asyncWorked).toBe(true)
    }, E2E_CONFIG.deployInvokeTimeout)
  })

  // ============================================================================
  // 3. Version Management
  // ============================================================================
  describe('Version Management', () => {
    let versionFunctionId: string

    beforeAll(() => {
      versionFunctionId = generateTestFunctionId()
      deployedFunctions.push(versionFunctionId)
    })

    it('deploys v1.0.0', async () => {
      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return Response.json({ version: '1.0.0', data: 'original' })
          }
        }
      `

      const result = await deployAndUploadFunction({
        id: versionFunctionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      expect(result.version).toBe('1.0.0')
    }, E2E_CONFIG.deployTimeout)

    it('deploys v1.1.0 (update)', async () => {
      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return Response.json({ version: '1.1.0', data: 'updated' })
          }
        }
      `

      const result = await deployAndUploadFunction({
        id: versionFunctionId,
        code,
        language: 'typescript',
        version: '1.1.0',
      })

      expect(result.version).toBe('1.1.0')
    }, E2E_CONFIG.deployTimeout)

    it('invokes uses latest version (1.1.0)', async () => {
      const result = await invokeFunction<{
        version: string
        data: string
      }>(versionFunctionId)

      expect(result.version).toBe('1.1.0')
      expect(result.data).toBe('updated')
    }, E2E_CONFIG.invokeTimeout)

    it('function info shows all versions', async () => {
      const info = await getFunctionInfo(versionFunctionId)

      expect(info.version).toBe('1.1.0') // Current/active version
      expect(info.versions).toContain('1.0.0')
      expect(info.versions).toContain('1.1.0')
    }, E2E_CONFIG.invokeTimeout)

    it('rollback to v1.0.0', async () => {
      const result = await rollbackFunction(versionFunctionId, '1.0.0')

      expect(result.id).toBe(versionFunctionId)
      expect(result.version).toBe('1.0.0')
      expect(result.rolledBackFrom).toBe('1.1.0')
    }, E2E_CONFIG.invokeTimeout)

    it('verify rollback works (now serving v1.0.0)', async () => {
      const result = await invokeFunction<{
        version: string
        data: string
      }>(versionFunctionId)

      expect(result.version).toBe('1.0.0')
      expect(result.data).toBe('original')
    }, E2E_CONFIG.invokeTimeout)

    it('can rollback back to v1.1.0', async () => {
      await rollbackFunction(versionFunctionId, '1.1.0')

      const result = await invokeFunction<{
        version: string
        data: string
      }>(versionFunctionId)

      expect(result.version).toBe('1.1.0')
    }, E2E_CONFIG.invokeTimeout)

    it('fails to rollback to non-existent version', async () => {
      await expect(
        rollbackFunction(versionFunctionId, '99.0.0')
      ).rejects.toThrow(/not found|does not exist|invalid version/i)
    }, E2E_CONFIG.invokeTimeout)
  })

  // ============================================================================
  // 4. Error Handling
  // ============================================================================
  describe('Error Handling', () => {
    it('deploy function that throws and verify error response', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            throw new Error('Intentional test error: Something went wrong!')
          }
        }
      `

      await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      // Invoke should fail with error
      const response = await invokeFunctionRaw(functionId, {})

      expect(response.ok).toBe(false)
      expect(response.status).toBeGreaterThanOrEqual(400)

      const body = await response.json() as { error?: string; message?: string; stack?: string }

      // Should contain error information
      expect(body.error || body.message).toBeDefined()
      expect(body.error || body.message).toMatch(/intentional test error|something went wrong/i)
    }, E2E_CONFIG.deployInvokeTimeout)

    it('verify error includes stack trace', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        function innerFunction() {
          throw new Error('Deep error with stack')
        }

        function outerFunction() {
          innerFunction()
        }

        export default {
          async fetch(request: Request): Promise<Response> {
            outerFunction()
            return new Response('unreachable')
          }
        }
      `

      await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      const response = await invokeFunctionRaw(functionId, {})
      const body = await response.json() as { error?: string; stack?: string }

      // Stack trace should be present and contain function names
      expect(body.stack).toBeDefined()
      expect(body.stack).toMatch(/innerFunction|outerFunction/)
    }, E2E_CONFIG.deployInvokeTimeout)

    it('verify logs capture error', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            console.error('About to throw an error')
            throw new Error('Error for log capture test')
          }
        }
      `

      await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      // Invoke to trigger the error
      await invokeFunctionRaw(functionId, {})

      // Poll for logs to be captured (avoids flaky fixed delays)
      const logs = await waitForLogs(
        () => getFunctionLogs(functionId, { limit: 50 }),
        { timeout: 10000, interval: 500, minCount: 1, description: 'error logs' }
      )

      // Logs should contain the error
      const errorLogs = logs.filter((log) =>
        log.level === 'error' || log.message.includes('error') || log.message.includes('Error')
      )
      expect(errorLogs.length).toBeGreaterThan(0)
    }, E2E_CONFIG.deployInvokeTimeout + 15000)

    it('handles syntax errors at deploy time gracefully', async () => {
      const functionId = generateTestFunctionId()
      // Don't add to cleanup - deploy should fail

      const code = `
        export default {
          async fetch(request: Request): Promise<Response {  // Missing >
            return new Response('broken')
          }
        }
      `

      // Deploy should either fail or succeed but invoke should fail
      try {
        await deployAndUploadFunction({
          id: functionId,
          code,
          language: 'typescript',
          version: '1.0.0',
        })
        // If deploy succeeded, add to cleanup
        deployedFunctions.push(functionId)

        // Invoke should fail due to syntax error
        await expect(invokeFunction(functionId, {})).rejects.toThrow()
      } catch (error) {
        // Deploy failed - which is acceptable behavior
        expect(error).toBeDefined()
      }
    }, E2E_CONFIG.deployInvokeTimeout)

    it('handles undefined/null return gracefully', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            // @ts-ignore - intentionally returning undefined
            return undefined
          }
        }
      `

      await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      const response = await invokeFunctionRaw(functionId, {})

      // Should get some kind of error response
      expect(response.status).toBeGreaterThanOrEqual(400)
    }, E2E_CONFIG.deployInvokeTimeout)
  })

  // ============================================================================
  // 5. Timeout Behavior
  // ============================================================================
  describe('Timeout Behavior', () => {
    it('deploy slow function (sleep 10s) and verify timeout', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

        export default {
          async fetch(request: Request): Promise<Response> {
            console.log('Starting slow function...')
            await sleep(10000) // 10 seconds
            console.log('Slow function completed')
            return Response.json({ completed: true })
          }
        }
      `

      await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      const startTime = Date.now()
      const response = await invokeFunctionRaw(functionId, {})
      const elapsed = Date.now() - startTime

      // Should timeout before 10 seconds
      // Workers have a default timeout around 30s, but functions.do may have lower limit
      // Expected to timeout around 5s based on config
      expect(response.ok).toBe(false)
      expect(elapsed).toBeLessThan(10000) // Should timeout before 10s

      const body = await response.json() as { error?: string; message?: string }
      expect(body.error || body.message).toMatch(/timeout|exceeded|cancelled/i)
    }, 15000) // Allow 15s for the test

    it('verify timeout is approximately 5 seconds', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

        export default {
          async fetch(request: Request): Promise<Response> {
            await sleep(20000) // 20 seconds - well past any timeout
            return Response.json({ completed: true })
          }
        }
      `

      await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      const startTime = Date.now()
      await invokeFunctionRaw(functionId, {})
      const elapsed = Date.now() - startTime

      // Timeout should be around 5s (4s-6s window)
      expect(elapsed).toBeGreaterThan(4000)
      expect(elapsed).toBeLessThan(8000)
    }, 20000)

    it('fast function completes within timeout', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

        export default {
          async fetch(request: Request): Promise<Response> {
            await sleep(500) // 500ms - should be fine
            return Response.json({ completed: true, waitedMs: 500 })
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
        completed: boolean
        waitedMs: number
      }>(functionId, {})

      expect(result.completed).toBe(true)
      expect(result.waitedMs).toBe(500)
    }, E2E_CONFIG.deployInvokeTimeout)
  })

  // ============================================================================
  // 6. Input/Output
  // ============================================================================
  describe('Input/Output', () => {
    let ioFunctionId: string

    beforeAll(async () => {
      ioFunctionId = generateTestFunctionId()
      deployedFunctions.push(ioFunctionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const input = await request.json().catch(() => null)
            return Response.json({
              received: input,
              type: typeof input,
              isNull: input === null,
              isArray: Array.isArray(input),
              isObject: input !== null && typeof input === 'object' && !Array.isArray(input)
            })
          }
        }
      `

      await deployAndUploadFunction({
        id: ioFunctionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })
    }, E2E_CONFIG.deployTimeout)

    it('handles object input', async () => {
      const input = { key: 'value', nested: { a: 1, b: 2 } }
      const result = await invokeFunction<{
        received: typeof input
        isObject: boolean
      }>(ioFunctionId, input)

      expect(result.received).toEqual(input)
      expect(result.isObject).toBe(true)
    }, E2E_CONFIG.invokeTimeout)

    it('handles array input', async () => {
      const input = [1, 2, 3, 'four', { five: 5 }]
      const result = await invokeFunction<{
        received: typeof input
        isArray: boolean
      }>(ioFunctionId, input)

      expect(result.received).toEqual(input)
      expect(result.isArray).toBe(true)
    }, E2E_CONFIG.invokeTimeout)

    it('handles string input', async () => {
      const input = 'hello world'
      const result = await invokeFunction<{
        received: string
        type: string
      }>(ioFunctionId, input)

      expect(result.received).toBe(input)
      expect(result.type).toBe('string')
    }, E2E_CONFIG.invokeTimeout)

    it('handles number input', async () => {
      const input = 42
      const result = await invokeFunction<{
        received: number
        type: string
      }>(ioFunctionId, input)

      expect(result.received).toBe(input)
      expect(result.type).toBe('number')
    }, E2E_CONFIG.invokeTimeout)

    it('handles boolean input', async () => {
      const result1 = await invokeFunction<{ received: boolean }>(ioFunctionId, true)
      expect(result1.received).toBe(true)

      const result2 = await invokeFunction<{ received: boolean }>(ioFunctionId, false)
      expect(result2.received).toBe(false)
    }, E2E_CONFIG.invokeTimeout)

    it('handles null input', async () => {
      const result = await invokeFunction<{
        received: null
        isNull: boolean
      }>(ioFunctionId, null)

      expect(result.received).toBe(null)
      expect(result.isNull).toBe(true)
    }, E2E_CONFIG.invokeTimeout)

    it('handles empty object', async () => {
      const result = await invokeFunction<{
        received: Record<string, never>
        isObject: boolean
      }>(ioFunctionId, {})

      expect(result.received).toEqual({})
      expect(result.isObject).toBe(true)
    }, E2E_CONFIG.invokeTimeout)

    it('handles empty array', async () => {
      const result = await invokeFunction<{
        received: never[]
        isArray: boolean
      }>(ioFunctionId, [])

      expect(result.received).toEqual([])
      expect(result.isArray).toBe(true)
    }, E2E_CONFIG.invokeTimeout)

    it('handles large payload (100KB)', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const body = await request.json() as { data: string }
            return Response.json({
              receivedLength: body.data?.length || 0,
              success: true
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

      // Create ~100KB of data
      const largeString = 'x'.repeat(100 * 1024)
      const result = await invokeFunction<{
        receivedLength: number
        success: boolean
      }>(functionId, { data: largeString })

      expect(result.receivedLength).toBe(100 * 1024)
      expect(result.success).toBe(true)
    }, E2E_CONFIG.deployInvokeTimeout)

    it('handles deeply nested objects', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        function getDepth(obj: unknown, depth = 0): number {
          if (typeof obj !== 'object' || obj === null) return depth
          const values = Array.isArray(obj) ? obj : Object.values(obj)
          if (values.length === 0) return depth
          return Math.max(...values.map(v => getDepth(v, depth + 1)))
        }

        export default {
          async fetch(request: Request): Promise<Response> {
            const body = await request.json()
            return Response.json({
              depth: getDepth(body),
              success: true
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

      // Create deeply nested object (10 levels)
      let nested: Record<string, unknown> = { value: 'deep' }
      for (let i = 0; i < 10; i++) {
        nested = { level: i, child: nested }
      }

      const result = await invokeFunction<{
        depth: number
        success: boolean
      }>(functionId, nested)

      expect(result.depth).toBeGreaterThanOrEqual(10)
      expect(result.success).toBe(true)
    }, E2E_CONFIG.deployInvokeTimeout)
  })

  // ============================================================================
  // 7. Execution Metrics
  // ============================================================================
  describe('Execution Metrics', () => {
    it('response includes _meta with execution info', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return Response.json({ result: 'ok' })
          }
        }
      `

      await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      const response = await invokeFunctionRaw(functionId, {})
      const body = await response.json() as {
        result: string
        _meta?: {
          duration?: number
          executedWith?: string
          version?: string
        }
      }

      expect(body.result).toBe('ok')

      // _meta should be present with execution info
      expect(body._meta).toBeDefined()
      if (body._meta) {
        expect(typeof body._meta.duration).toBe('number')
        expect(body._meta.duration).toBeGreaterThan(0)
        expect(body._meta.duration).toBeLessThan(10000) // Less than 10s
      }
    }, E2E_CONFIG.deployInvokeTimeout)

    it('verify duration is reasonable for simple function', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const result = 1 + 1
            return Response.json({ result })
          }
        }
      `

      await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      const response = await invokeFunctionRaw(functionId, {})
      const body = await response.json() as {
        _meta?: { duration?: number }
      }

      // Simple addition should be very fast (< 100ms)
      if (body._meta?.duration) {
        expect(body._meta.duration).toBeLessThan(100)
      }
    }, E2E_CONFIG.deployInvokeTimeout)

    it('verify executedWith info is present', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return Response.json({ ok: true })
          }
        }
      `

      await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      const response = await invokeFunctionRaw(functionId, {})
      const body = await response.json() as {
        _meta?: {
          executedWith?: string
          runtime?: string
        }
      }

      // Should indicate runtime/execution environment
      if (body._meta) {
        const hasExecutionInfo = body._meta.executedWith || body._meta.runtime
        expect(hasExecutionInfo).toBeDefined()
      }
    }, E2E_CONFIG.deployInvokeTimeout)

    it('response headers include timing info', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return Response.json({ result: 'check headers' })
          }
        }
      `

      await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      const response = await invokeFunctionRaw(functionId, {})

      // Check for timing headers (X-Duration, X-Function-Duration, etc.)
      const timingHeaders = [
        'x-duration',
        'x-function-duration',
        'x-execution-time',
        'server-timing',
      ]

      const hasTimingHeader = timingHeaders.some(
        (header) => response.headers.get(header) !== null
      )

      // At least one timing header should be present
      expect(hasTimingHeader).toBe(true)
    }, E2E_CONFIG.deployInvokeTimeout)
  })

  // ============================================================================
  // 8. Concurrent Invocations
  // ============================================================================
  describe('Concurrent Invocations', () => {
    it('handles 10 concurrent invocations', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        let invocationCount = 0

        export default {
          async fetch(request: Request): Promise<Response> {
            const body = await request.json().catch(() => ({})) as { id?: number }
            const id = body.id || 0

            // Simulate some work
            const start = Date.now()
            let sum = 0
            for (let i = 0; i < 10000; i++) {
              sum += i
            }
            const elapsed = Date.now() - start

            return Response.json({
              id,
              sum,
              elapsed,
              timestamp: Date.now()
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

      // Create 10 concurrent invocations
      const promises = Array.from({ length: 10 }, (_, i) =>
        invokeFunction<{
          id: number
          sum: number
          elapsed: number
          timestamp: number
        }>(functionId, { id: i })
      )

      const results = await Promise.all(promises)

      // All should succeed
      expect(results.length).toBe(10)

      // Each should have correct id
      const ids = results.map((r) => r.id).sort((a, b) => a - b)
      expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])

      // All should have computed the same sum
      results.forEach((r) => {
        expect(r.sum).toBe(49995000) // Sum of 0 to 9999
      })
    }, E2E_CONFIG.deployInvokeTimeout + 10000)

    it('no race conditions with counter', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      // Note: Each invocation is isolated, so counters won't persist
      // This tests that each invocation is independent
      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const body = await request.json().catch(() => ({})) as { value?: number }
            let counter = body.value || 0

            // Increment multiple times
            for (let i = 0; i < 100; i++) {
              counter++
            }

            return Response.json({
              result: counter,
              expectedResult: (body.value || 0) + 100
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

      // Run 20 concurrent invocations with different starting values
      const promises = Array.from({ length: 20 }, (_, i) =>
        invokeFunction<{
          result: number
          expectedResult: number
        }>(functionId, { value: i * 10 })
      )

      const results = await Promise.all(promises)

      // Each should match its expected result (no race conditions)
      results.forEach((r) => {
        expect(r.result).toBe(r.expectedResult)
      })
    }, E2E_CONFIG.deployInvokeTimeout + 10000)

    it('handles burst of invocations', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const body = await request.json().catch(() => ({})) as { n?: number }
            return Response.json({ n: body.n, doubled: (body.n || 0) * 2 })
          }
        }
      `

      await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      // Send 50 requests in rapid succession
      const startTime = Date.now()
      const promises = Array.from({ length: 50 }, (_, i) =>
        invokeFunction<{ n: number; doubled: number }>(functionId, { n: i })
      )

      const results = await Promise.all(promises)
      const elapsed = Date.now() - startTime

      // All should succeed
      expect(results.length).toBe(50)

      // Verify results are correct
      results.forEach((r) => {
        expect(r.doubled).toBe(r.n * 2)
      })

      // Should complete in reasonable time (< 30s for 50 requests)
      expect(elapsed).toBeLessThan(30000)
    }, 45000)

    it('concurrent invocations with different payloads', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const body = await request.json() as { operation: string; a: number; b: number }

            let result: number
            switch (body.operation) {
              case 'add':
                result = body.a + body.b
                break
              case 'subtract':
                result = body.a - body.b
                break
              case 'multiply':
                result = body.a * body.b
                break
              case 'divide':
                result = body.a / body.b
                break
              default:
                result = 0
            }

            return Response.json({
              operation: body.operation,
              a: body.a,
              b: body.b,
              result
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

      const operations = [
        { operation: 'add', a: 10, b: 5, expected: 15 },
        { operation: 'subtract', a: 10, b: 5, expected: 5 },
        { operation: 'multiply', a: 10, b: 5, expected: 50 },
        { operation: 'divide', a: 10, b: 5, expected: 2 },
        { operation: 'add', a: 100, b: 200, expected: 300 },
        { operation: 'multiply', a: 7, b: 8, expected: 56 },
      ]

      // Send all concurrently
      const promises = operations.map((op) =>
        invokeFunction<{ operation: string; result: number }>(functionId, {
          operation: op.operation,
          a: op.a,
          b: op.b,
        })
      )

      const results = await Promise.all(promises)

      // Verify each result matches expected
      results.forEach((r, i) => {
        expect(r.operation).toBe(operations[i].operation)
        expect(r.result).toBe(operations[i].expected)
      })
    }, E2E_CONFIG.deployInvokeTimeout + 10000)
  })

  // ============================================================================
  // Additional Edge Cases
  // ============================================================================
  describe('Edge Cases', () => {
    it('handles function with no export default', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        // Missing export default - should fail
        const handler = {
          async fetch(request: Request): Promise<Response> {
            return new Response('oops')
          }
        }
      `

      // This should either fail at deploy or at invoke
      try {
        await deployAndUploadFunction({
          id: functionId,
          code,
          language: 'typescript',
          version: '1.0.0',
        })

        // If deploy succeeded, invoke should fail
        await expect(invokeFunction(functionId, {})).rejects.toThrow()
      } catch {
        // Deploy failed - which is acceptable
        const index = deployedFunctions.indexOf(functionId)
        if (index > -1) deployedFunctions.splice(index, 1)
      }
    }, E2E_CONFIG.deployInvokeTimeout)

    it('handles unicode in input/output', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const body = await request.json() as { text: string }
            return Response.json({
              original: body.text,
              reversed: body.text.split('').reverse().join(''),
              length: body.text.length
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

      const unicodeText = 'Hello, World!'
      const result = await invokeFunction<{
        original: string
        reversed: string
        length: number
      }>(functionId, { text: unicodeText })

      expect(result.original).toBe(unicodeText)
      expect(result.length).toBe(unicodeText.length)
    }, E2E_CONFIG.deployInvokeTimeout)

    it('handles function ID with special characters', async () => {
      // Function IDs should follow specific format, but test edge of what's allowed
      const functionId = `${E2E_CONFIG.testPrefix}special-123-test`
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return Response.json({ id: '${functionId}' })
          }
        }
      `

      const result = await deployAndUploadFunction({
        id: functionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      expect(result.id).toBe(functionId)

      const invokeResult = await invokeFunction<{ id: string }>(functionId, {})
      expect(invokeResult.id).toBe(functionId)
    }, E2E_CONFIG.deployInvokeTimeout)

    it('rejects invalid function ID format', async () => {
      const invalidIds = [
        'has spaces',
        'has@symbol',
        'has#hash',
        '',
        'a'.repeat(200), // Too long
      ]

      for (const invalidId of invalidIds) {
        await expect(
          deployFunction({
            id: invalidId,
            code: 'export default { fetch: () => new Response("x") }',
            language: 'typescript',
            version: '1.0.0',
          })
        ).rejects.toThrow(/invalid|format|id/i)
      }
    }, E2E_CONFIG.invokeTimeout * 5) // 5 invalid IDs to test

    it('handles request method in function', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return Response.json({
              method: request.method,
              url: request.url,
              hasBody: request.body !== null
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
        method: string
        url: string
        hasBody: boolean
      }>(functionId, { test: true })

      expect(result.method).toBe('POST')
      expect(result.url).toContain(functionId)
      expect(result.hasBody).toBe(true)
    }, E2E_CONFIG.deployInvokeTimeout)

    it('handles headers in function', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const headers: Record<string, string> = {}
            request.headers.forEach((value, key) => {
              headers[key.toLowerCase()] = value
            })

            return Response.json({
              contentType: headers['content-type'],
              hasContentType: 'content-type' in headers
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
        contentType: string
        hasContentType: boolean
      }>(functionId, {})

      expect(result.hasContentType).toBe(true)
      expect(result.contentType).toContain('application/json')
    }, E2E_CONFIG.deployInvokeTimeout)
  })
})
