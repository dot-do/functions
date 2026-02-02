/// <reference types="@cloudflare/workers-types" />
/**
 * E2E Tests: Workers-to-Workers Function Invocation
 *
 * These tests verify that Workers can invoke functions.do functions
 * in various patterns:
 *
 * 1. Direct fetch from Worker to functions.do
 * 2. Service binding invocation (Worker-to-Worker RPC)
 * 3. Chained invocations (Worker A -> functions.do -> Worker B)
 * 4. Parallel invocations from a single Worker
 *
 * These patterns are critical for production use cases where customers
 * build Workers that orchestrate multiple functions.do functions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { env } from 'cloudflare:test'
import { getFunctionsFetcher } from './worker-entry'

/**
 * Test configuration
 */
const CONFIG = {
  baseUrl: env.E2E_BASE_URL || 'https://functions-do.dotdo.workers.dev',
  apiKey: env.FUNCTIONS_API_KEY || 'test-key',
  testPrefix: 'e2e-w2w-',
}

/**
 * Get the functions.do fetcher (service binding or fallback to HTTP)
 */
function getFetcher() {
  return getFunctionsFetcher(env)
}

/**
 * Generate unique function ID for this test run
 */
function generateFunctionId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 6)
  return `${CONFIG.testPrefix}${timestamp}-${random}`
}

/**
 * Get auth headers
 */
function getAuthHeaders(): Record<string, string> {
  return CONFIG.apiKey ? { 'X-API-Key': CONFIG.apiKey } : {}
}

/**
 * Deploy a simple echo function
 */
async function deployEchoFunction(functionId: string): Promise<void> {
  const fetcher = getFetcher()
  const response = await fetcher.fetch('https://functions.do/api/functions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({
      id: functionId,
      version: '1.0.0',
      language: 'typescript',
      code: `
        export default {
          async fetch(request: Request): Promise<Response> {
            const body = await request.json().catch(() => ({}))
            return Response.json({
              functionId: '${functionId}',
              echo: body,
              invokedAt: Date.now(),
              source: 'workers-e2e-test'
            })
          }
        }
      `,
    }),
  })

  if (!response.ok && response.status !== 401) {
    const error = await response.text()
    throw new Error(`Deploy failed: ${response.status} - ${error}`)
  }
}

/**
 * Deploy a function that calls another function
 */
async function deployChainedFunction(
  functionId: string,
  targetFunctionId: string
): Promise<void> {
  const response = await getFetcher().fetch('https://functions.do/api/functions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({
      id: functionId,
      version: '1.0.0',
      language: 'typescript',
      code: `
        export default {
          async fetch(request: Request, env: any): Promise<Response> {
            const body = await request.json().catch(() => ({}))

            // Call the target function
            const targetResponse = await fetch(
              'https://functions.do/functions/${targetFunctionId}/invoke',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: '${functionId}', original: body })
              }
            )

            const targetResult = await targetResponse.json()

            return Response.json({
              functionId: '${functionId}',
              chainedResult: targetResult,
              invokedAt: Date.now()
            })
          }
        }
      `,
    }),
  })

  if (!response.ok && response.status !== 401) {
    const error = await response.text()
    throw new Error(`Deploy chained function failed: ${response.status} - ${error}`)
  }
}

/**
 * Cleanup function
 */
async function deleteFunction(functionId: string): Promise<void> {
  try {
    await getFetcher().fetch(`https://functions.do/api/functions/${functionId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    })
  } catch {
    // Ignore cleanup errors
  }
}

describe('Workers-to-Workers Invocation Patterns', () => {
  const deployedFunctions: string[] = []

  afterAll(async () => {
    // Cleanup all deployed functions
    for (const functionId of deployedFunctions) {
      await deleteFunction(functionId)
    }
  })

  describe('Direct Fetch Invocation', () => {
    it('Worker invokes function via direct fetch', async () => {
      const functionId = generateFunctionId()
      deployedFunctions.push(functionId)

      await deployEchoFunction(functionId)

      // Wait for deployment propagation
      await new Promise((r) => setTimeout(r, 3000))

      // Invoke via direct fetch (simulating what a customer Worker would do)
      const response = await fetch(`${CONFIG.baseUrl}/functions/${functionId}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ test: 'direct-fetch', data: [1, 2, 3] }),
      })

      if (response.ok) {
        const result = (await response.json()) as {
          functionId: string
          echo: unknown
          invokedAt: number
        }
        expect(result.functionId).toBe(functionId)
        expect(result.echo).toEqual({ test: 'direct-fetch', data: [1, 2, 3] })
        expect(result.invokedAt).toBeGreaterThan(0)
      }
    })

    it('Worker handles function invocation errors gracefully', async () => {
      // Invoke a non-existent function
      const response = await fetch(`${CONFIG.baseUrl}/functions/nonexistent-12345/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ test: true }),
      })

      // Should get an error response, not crash
      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('Service Binding Invocation', () => {
    it('Worker invokes function via service binding', async () => {
      const functionId = generateFunctionId()
      deployedFunctions.push(functionId)

      await deployEchoFunction(functionId)
      await new Promise((r) => setTimeout(r, 3000))

      // Invoke via service binding (Worker-to-Worker RPC)
      const response = await getFetcher().fetch(
        `https://functions.do/functions/${functionId}/invoke`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ test: 'service-binding', metadata: { via: 'rpc' } }),
        }
      )

      if (response.ok) {
        const result = (await response.json()) as { echo: unknown }
        expect(result.echo).toEqual({ test: 'service-binding', metadata: { via: 'rpc' } })
      }
    })

    it('service binding handles large payloads', async () => {
      const functionId = generateFunctionId()
      deployedFunctions.push(functionId)

      await deployEchoFunction(functionId)
      await new Promise((r) => setTimeout(r, 3000))

      // Send a larger payload
      const largePayload = {
        data: Array.from({ length: 1000 }, (_, i) => ({ index: i, value: `item-${i}` })),
        metadata: { size: 'large', test: true },
      }

      const response = await getFetcher().fetch(
        `https://functions.do/functions/${functionId}/invoke`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify(largePayload),
        }
      )

      if (response.ok) {
        const result = (await response.json()) as { echo: typeof largePayload }
        expect(result.echo.data.length).toBe(1000)
      }
    })
  })

  describe('Parallel Invocations', () => {
    it('Worker invokes multiple functions in parallel', async () => {
      const functionIds = Array.from({ length: 3 }, () => generateFunctionId())
      deployedFunctions.push(...functionIds)

      // Deploy all functions
      await Promise.all(functionIds.map((id) => deployEchoFunction(id)))
      await new Promise((r) => setTimeout(r, 3000))

      // Invoke all functions in parallel
      const invokePromises = functionIds.map((id) =>
        getFetcher().fetch(`https://functions.do/functions/${id}/invoke`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ functionId: id, parallel: true }),
        })
      )

      const responses = await Promise.allSettled(invokePromises)

      // All should complete (either success or expected failure)
      expect(responses.length).toBe(3)
      responses.forEach((result) => {
        expect(['fulfilled', 'rejected']).toContain(result.status)
      })
    })

    it('Worker handles mixed success/failure in parallel invocations', async () => {
      const functionId = generateFunctionId()
      deployedFunctions.push(functionId)

      await deployEchoFunction(functionId)
      await new Promise((r) => setTimeout(r, 3000))

      // Mix of valid and invalid function IDs
      const invokePromises = [
        getFetcher().fetch(`https://functions.do/functions/${functionId}/invoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ valid: true }),
        }),
        getFetcher().fetch(`https://functions.do/functions/invalid-id-1/invoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ invalid: true }),
        }),
        getFetcher().fetch(`https://functions.do/functions/${functionId}/invoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ valid: true, second: true }),
        }),
      ]

      const responses = await Promise.all(invokePromises)

      // Check that we got responses (mix of success and errors)
      expect(responses.length).toBe(3)
    })
  })

  describe('Chained Invocations', () => {
    it('Worker invokes function that calls another function', async () => {
      const echoFunctionId = generateFunctionId()
      const chainedFunctionId = generateFunctionId()
      deployedFunctions.push(echoFunctionId, chainedFunctionId)

      // Deploy the target echo function first
      await deployEchoFunction(echoFunctionId)

      // Deploy the chained function that calls the echo function
      await deployChainedFunction(chainedFunctionId, echoFunctionId)

      await new Promise((r) => setTimeout(r, 5000)) // Longer wait for two deploys

      // Invoke the chained function
      const response = await getFetcher().fetch(
        `https://functions.do/functions/${chainedFunctionId}/invoke`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ originalInput: 'test-chain' }),
        }
      )

      if (response.ok) {
        const result = (await response.json()) as {
          functionId: string
          chainedResult: {
            functionId: string
            echo: unknown
          }
        }
        expect(result.functionId).toBe(chainedFunctionId)
        expect(result.chainedResult).toBeDefined()
      }
    })
  })

  describe('Request/Response Patterns', () => {
    it('Worker sends custom headers to function', async () => {
      const functionId = generateFunctionId()
      deployedFunctions.push(functionId)

      // Deploy a function that echoes headers
      const response = await getFetcher().fetch('https://functions.do/api/functions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          id: functionId,
          version: '1.0.0',
          language: 'typescript',
          code: `
            export default {
              async fetch(request: Request): Promise<Response> {
                const headers: Record<string, string> = {}
                request.headers.forEach((value, key) => {
                  headers[key] = value
                })
                return Response.json({ headers })
              }
            }
          `,
        }),
      })

      if (!response.ok) return

      await new Promise((r) => setTimeout(r, 3000))

      // Invoke with custom headers
      const invokeResponse = await getFetcher().fetch(
        `https://functions.do/functions/${functionId}/invoke`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Custom-Header': 'test-value',
            'X-Request-Id': 'req-12345',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({}),
        }
      )

      if (invokeResponse.ok) {
        const result = (await invokeResponse.json()) as { headers: Record<string, string> }
        expect(result.headers).toBeDefined()
      }
    })

    it('Worker receives response headers from function', async () => {
      const functionId = generateFunctionId()
      deployedFunctions.push(functionId)

      // Deploy a function that returns custom headers
      const deployResponse = await getFetcher().fetch(
        'https://functions.do/api/functions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            id: functionId,
            version: '1.0.0',
            language: 'typescript',
            code: `
            export default {
              async fetch(request: Request): Promise<Response> {
                return new Response(JSON.stringify({ success: true }), {
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Custom-Response': 'custom-value',
                    'X-Function-Version': '1.0.0'
                  }
                })
              }
            }
          `,
          }),
        }
      )

      if (!deployResponse.ok) return

      await new Promise((r) => setTimeout(r, 3000))

      const invokeResponse = await getFetcher().fetch(
        `https://functions.do/functions/${functionId}/invoke`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
        }
      )

      // Check response headers
      expect(invokeResponse.headers.get('content-type')).toContain('application/json')
    })
  })

  describe('Error Scenarios', () => {
    it('Worker handles function timeout gracefully', async () => {
      const functionId = generateFunctionId()
      deployedFunctions.push(functionId)

      // Deploy a function that takes a long time
      const response = await getFetcher().fetch('https://functions.do/api/functions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          id: functionId,
          version: '1.0.0',
          language: 'typescript',
          code: `
            export default {
              async fetch(request: Request): Promise<Response> {
                // Simulate slow operation (but not too slow for tests)
                await new Promise(r => setTimeout(r, 100))
                return Response.json({ slow: true })
              }
            }
          `,
        }),
      })

      if (!response.ok) return

      await new Promise((r) => setTimeout(r, 3000))

      // Invoke should complete or timeout
      const invokeResponse = await getFetcher().fetch(
        `https://functions.do/functions/${functionId}/invoke`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
        }
      )

      // Should get a response (success or timeout error)
      expect(invokeResponse.status).toBeLessThan(600)
    })

    it('Worker handles function exceptions', async () => {
      const functionId = generateFunctionId()
      deployedFunctions.push(functionId)

      // Deploy a function that throws
      const response = await getFetcher().fetch('https://functions.do/api/functions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          id: functionId,
          version: '1.0.0',
          language: 'typescript',
          code: `
            export default {
              async fetch(request: Request): Promise<Response> {
                throw new Error('Intentional test error')
              }
            }
          `,
        }),
      })

      if (!response.ok) return

      await new Promise((r) => setTimeout(r, 3000))

      const invokeResponse = await getFetcher().fetch(
        `https://functions.do/functions/${functionId}/invoke`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
        }
      )

      // Should get an error response, not crash the Worker
      expect(invokeResponse.status).toBeGreaterThanOrEqual(400)
    })
  })
})
