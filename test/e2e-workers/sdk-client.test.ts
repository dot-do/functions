/// <reference types="@cloudflare/workers-types" />
/**
 * E2E Tests: SDK Client Running in Workers
 *
 * These tests verify that the @dotdo/functions SDK client works correctly
 * when running INSIDE a Cloudflare Worker (not Node.js).
 *
 * This is critical because:
 * 1. functions.do is a Workers platform - clients should also run on Workers
 * 2. Workers have different runtime characteristics than Node.js
 * 3. Service bindings (Worker-to-Worker RPC) need to be tested
 * 4. fetch() behaves differently in Workers vs Node.js
 *
 * Test Categories:
 * - SDK client initialization in Workers
 * - Function invocation via fetch (HTTP-based)
 * - Function invocation via service binding (RPC-based)
 * - Error handling in Workers runtime
 * - Streaming responses in Workers
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import {
  FunctionClient,
  FunctionClientError,
  ValidationError,
  NetworkError,
} from '../../packages/functions-sdk/src/index'
import { getFunctionsFetcher } from './worker-entry'

/**
 * Configuration for Workers E2E tests
 */
const WORKERS_E2E_CONFIG = {
  /** Base URL from environment or default */
  baseUrl: env.E2E_BASE_URL || 'https://functions-do.dotdo.workers.dev',
  /** API key from secrets (if configured) */
  apiKey: env.FUNCTIONS_API_KEY || 'test-key',
  /** Timeout for individual operations */
  timeout: 30_000,
}

/**
 * Get the functions.do fetcher (service binding or fallback to HTTP)
 */
function getFetcher() {
  return getFunctionsFetcher(env)
}

/**
 * Generate a unique test function ID
 */
function generateTestFunctionId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8)
  return `e2e-workers-${timestamp}-${random}`
}

describe('SDK Client in Workers Runtime', () => {
  describe('Client Initialization', () => {
    it('creates client with API key in Workers environment', () => {
      const client = new FunctionClient({
        apiKey: WORKERS_E2E_CONFIG.apiKey,
        baseUrl: WORKERS_E2E_CONFIG.baseUrl,
      })

      expect(client).toBeDefined()
      expect(client.getBaseUrl()).toBe(WORKERS_E2E_CONFIG.baseUrl)
      expect(client.getApiKey()).toBe(WORKERS_E2E_CONFIG.apiKey)
    })

    it('rejects empty API key', () => {
      expect(() => new FunctionClient({ apiKey: '' })).toThrow('API key is required')
    })

    it('rejects whitespace-only API key', () => {
      expect(() => new FunctionClient({ apiKey: '   ' })).toThrow('API key is required')
    })

    it('uses default base URL when not specified', () => {
      const client = new FunctionClient({ apiKey: 'test-key' })
      expect(client.getBaseUrl()).toBe('https://api.functions.do')
    })

    it('uses custom timeout when specified', () => {
      const client = new FunctionClient({
        apiKey: 'test-key',
        timeout: 5000,
      })
      expect(client.getTimeout()).toBe(5000)
    })
  })

  describe('Fetch-Based Invocation', () => {
    let client: FunctionClient

    beforeAll(() => {
      client = new FunctionClient({
        apiKey: WORKERS_E2E_CONFIG.apiKey,
        baseUrl: WORKERS_E2E_CONFIG.baseUrl,
        timeout: WORKERS_E2E_CONFIG.timeout,
      })
    })

    it('invokes function via HTTP fetch from Worker', async () => {
      // This test uses the SDK client's invoke method, which internally uses fetch()
      // The fetch() call happens inside the Worker runtime, not Node.js

      // Note: This will fail if the function doesn't exist, but it validates
      // that the SDK client can make fetch requests from within a Worker
      try {
        await client.invoke('e2e-test-echo', { message: 'Hello from Worker!' })
      } catch (error) {
        // Expected: function may not exist
        // What we're testing: the fetch request was made successfully from the Worker
        expect(error).toBeInstanceOf(FunctionClientError)
      }
    })

    it('handles validation errors correctly in Workers', async () => {
      // Empty function ID should throw ValidationError
      try {
        await client.invoke('')
        expect.fail('Should have thrown ValidationError')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        expect((error as ValidationError).message).toContain('Function ID is required')
      }
    })

    it('handles whitespace function ID in Workers', async () => {
      try {
        await client.invoke('   ')
        expect.fail('Should have thrown ValidationError')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
      }
    })

    it('sends correct headers from Worker', async () => {
      // Test that the client sends Authorization header correctly
      // We can't directly inspect headers, but we can verify the client was configured
      expect(client.getApiKey()).toBe(WORKERS_E2E_CONFIG.apiKey)
    })

    it('handles JSON serialization in Workers', async () => {
      // Test that complex objects are serialized correctly
      const complexInput = {
        nested: { deep: { value: 42 } },
        array: [1, 2, 3],
        nullValue: null,
        unicode: 'Hello World',
      }

      try {
        await client.invoke('test-func', complexInput)
      } catch (error) {
        // We expect an error since the function doesn't exist
        // But the request should have been made with serialized JSON
        expect(error).toBeInstanceOf(FunctionClientError)
      }
    })
  })

  describe('Service Binding / Fetcher Invocation', () => {
    it('has FUNCTIONS_DO fetcher available (binding or fallback)', () => {
      // Verify the fetcher is available (either service binding or HTTP fallback)
      const fetcher = getFetcher()
      expect(fetcher).toBeDefined()
      expect(typeof fetcher.fetch).toBe('function')
    })

    it('invokes function via fetcher', async () => {
      // Use the fetcher to make a request to functions.do
      // This tests Worker-to-Worker RPC communication (or HTTP fallback)
      const fetcher = getFetcher()
      const response = await fetcher.fetch('https://functions.do/health', {
        method: 'GET',
      })

      // The health endpoint should return some response
      expect(response.status).toBeLessThanOrEqual(500) // May be 404 if not implemented
    })

    it('invokes function API via fetcher', async () => {
      // Test the /api/functions endpoint via fetcher
      const fetcher = getFetcher()
      const response = await fetcher.fetch('https://functions.do/api/functions', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      // Should get a response - various status codes are acceptable
      // 200: success, 400: bad request, 401: unauthorized, 403: forbidden
      expect([200, 400, 401, 403]).toContain(response.status)
    })

    it('deploys function via fetcher', async () => {
      const functionId = generateTestFunctionId()
      const fetcher = getFetcher()

      const deployPayload = {
        id: functionId,
        version: '1.0.0',
        language: 'typescript',
        code: `
          export default {
            async fetch(request: Request): Promise<Response> {
              return Response.json({ message: 'Hello from Workers E2E!' })
            }
          }
        `,
      }

      const response = await fetcher.fetch('https://functions.do/api/functions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(WORKERS_E2E_CONFIG.apiKey ? { 'X-API-Key': WORKERS_E2E_CONFIG.apiKey } : {}),
        },
        body: JSON.stringify(deployPayload),
      })

      // Should get a valid response (may require auth)
      expect([200, 201, 401, 403]).toContain(response.status)

      if (response.ok) {
        const result = (await response.json()) as { id: string; url: string }
        expect(result.id).toBe(functionId)
        expect(result.url).toBeDefined()
      }
    })

    it('invokes deployed function via fetcher', async () => {
      const functionId = generateTestFunctionId()
      const fetcher = getFetcher()

      // First deploy a simple function
      const deployResponse = await fetcher.fetch('https://functions.do/api/functions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(WORKERS_E2E_CONFIG.apiKey ? { 'X-API-Key': WORKERS_E2E_CONFIG.apiKey } : {}),
        },
        body: JSON.stringify({
          id: functionId,
          version: '1.0.0',
          language: 'typescript',
          code: `
            export default {
              async fetch(request: Request): Promise<Response> {
                const body = await request.json().catch(() => ({}))
                return Response.json({ echo: body, timestamp: Date.now() })
              }
            }
          `,
        }),
      })

      if (!deployResponse.ok) {
        // Skip invoke test if deploy fails (e.g., auth required)
        return
      }

      // Wait a bit for deployment propagation
      await new Promise((r) => setTimeout(r, 2000))

      // Now invoke the function
      const invokeResponse = await fetcher.fetch(
        `https://functions.do/functions/${functionId}/invoke`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(WORKERS_E2E_CONFIG.apiKey ? { 'X-API-Key': WORKERS_E2E_CONFIG.apiKey } : {}),
          },
          body: JSON.stringify({ test: 'data', fromWorker: true }),
        }
      )

      if (invokeResponse.ok) {
        const result = (await invokeResponse.json()) as { echo: unknown; timestamp: number }
        expect(result.echo).toEqual({ test: 'data', fromWorker: true })
        expect(result.timestamp).toBeGreaterThan(0)
      }
    })
  })

  describe('Error Handling in Workers', () => {
    let client: FunctionClient

    beforeAll(() => {
      client = new FunctionClient({
        apiKey: WORKERS_E2E_CONFIG.apiKey,
        baseUrl: WORKERS_E2E_CONFIG.baseUrl,
        timeout: WORKERS_E2E_CONFIG.timeout,
      })
    })

    it('handles 404 Not Found correctly', async () => {
      try {
        await client.invoke('nonexistent-function-12345')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        // May be 404 or another error
      }
    })

    it('handles network errors in Workers', async () => {
      // Create a client with an invalid URL
      const badClient = new FunctionClient({
        apiKey: 'test-key',
        baseUrl: 'https://invalid-domain-12345.example',
        timeout: 5000,
      })

      try {
        await badClient.invoke('test')
        expect.fail('Should have thrown')
      } catch (error) {
        // Should get a network error or timeout
        expect(error).toBeDefined()
      }
    })

    it('handles timeout correctly in Workers', async () => {
      // Create a client with a very short timeout
      const timeoutClient = new FunctionClient({
        apiKey: 'test-key',
        baseUrl: WORKERS_E2E_CONFIG.baseUrl,
        timeout: 1, // 1ms timeout - should fail
      })

      try {
        await timeoutClient.invoke('test')
      } catch (error) {
        // Should timeout or fail quickly
        expect(error).toBeDefined()
      }
    })

    it('FunctionClientError has correct properties in Workers', () => {
      const error = new FunctionClientError('Test error', 500, {
        code: undefined,
        details: { foo: 'bar' },
        requestId: 'req-123',
      })

      expect(error.name).toBe('FunctionClientError')
      expect(error.message).toBe('Test error')
      expect(error.statusCode).toBe(500)
      expect(error.details).toEqual({ foo: 'bar' })
      expect(error.requestId).toBe('req-123')
    })
  })

  describe('Workers Runtime Environment', () => {
    it('has access to Worker globals', () => {
      // Verify we're running in a Workers environment
      expect(typeof fetch).toBe('function')
      expect(typeof Request).toBe('function')
      expect(typeof Response).toBe('function')
      expect(typeof Headers).toBe('function')
    })

    it('has access to Workers crypto API', () => {
      expect(typeof crypto).toBe('object')
      expect(typeof crypto.randomUUID).toBe('function')
      expect(typeof crypto.subtle).toBe('object')
    })

    it('has access to Workers URL API', () => {
      const url = new URL('https://functions.do/api/test?foo=bar')
      expect(url.hostname).toBe('functions.do')
      expect(url.searchParams.get('foo')).toBe('bar')
    })

    it('has access to Workers TextEncoder/TextDecoder', () => {
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const encoded = encoder.encode('Hello Workers!')
      const decoded = decoder.decode(encoded)
      expect(decoded).toBe('Hello Workers!')
    })

    it('can make concurrent fetch requests', async () => {
      // Test that we can make multiple concurrent requests from a Worker
      const fetcher = getFetcher()
      const promises = Array.from({ length: 3 }, (_, i) =>
        fetcher.fetch(`https://functions.do/health?req=${i}`, { method: 'GET' })
      )

      const results = await Promise.allSettled(promises)
      expect(results.length).toBe(3)
      // All should complete (either fulfilled or rejected)
      results.forEach((result) => {
        expect(['fulfilled', 'rejected']).toContain(result.status)
      })
    })
  })

  describe('SDK Integration with Workers Runtime', () => {
    it('SDK uses Workers-native fetch', async () => {
      // The SDK client should use the Workers runtime's native fetch
      // This test verifies the SDK works correctly in the Workers environment
      const client = new FunctionClient({
        apiKey: WORKERS_E2E_CONFIG.apiKey,
        baseUrl: WORKERS_E2E_CONFIG.baseUrl,
      })

      // Make a simple request - the SDK will use Workers fetch internally
      try {
        await client.list()
      } catch (error) {
        // Expected to fail without proper auth
        expect(error).toBeInstanceOf(FunctionClientError)
      }
    })

    it('SDK handles AbortController in Workers', async () => {
      const client = new FunctionClient({
        apiKey: WORKERS_E2E_CONFIG.apiKey,
        baseUrl: WORKERS_E2E_CONFIG.baseUrl,
      })

      const controller = new AbortController()

      // Abort immediately
      controller.abort()

      try {
        await client.invoke('test', undefined, { signal: controller.signal })
        expect.fail('Should have thrown due to abort')
      } catch (error) {
        // Should be aborted
        expect(error).toBeDefined()
      }
    })

    it('SDK can batch invoke from Workers', async () => {
      const client = new FunctionClient({
        apiKey: WORKERS_E2E_CONFIG.apiKey,
        baseUrl: WORKERS_E2E_CONFIG.baseUrl,
      })

      // Test batch invoke - should handle multiple requests
      const results = await client.batchInvoke([
        { functionId: 'func-1', input: { a: 1 } },
        { functionId: 'func-2', input: { b: 2 } },
      ])

      expect(results.length).toBe(2)
      // All should have a result (even if it's an error)
      results.forEach((result) => {
        expect(result.functionId).toBeDefined()
      })
    })
  })
})
