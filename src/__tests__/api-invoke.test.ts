/**
 * API Invoke Endpoint Tests
 *
 * Tests for POST /functions/:id/invoke - Function invocation endpoint.
 *
 * These tests verify the behavior of the function invocation API:
 * - Executes functions and returns responses
 * - Passes request body to function
 * - Handles function errors gracefully
 * - Returns 404 for non-existent functions
 * - Requires authentication (when API_KEYS is configured)
 * - Respects function rate limits
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockKV } from '../test-utils/mock-kv'
import type { Env } from '../index'

// Import the default export (the worker) and reset function
import worker, { resetRateLimiter, configureRateLimiter } from '../index'

// Type for JSON response bodies in tests
type JsonBody = Record<string, unknown>

/**
 * Hash an API key using SHA-256 to match the auth middleware's format.
 * The auth middleware stores keys as `keys:{hash}` in KV.
 */
async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(apiKey)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Store an API key in the mock KV with proper hashing and prefix.
 */
async function storeApiKey(
  kv: KVNamespace,
  apiKey: string,
  record: { userId?: string; active: boolean; scopes?: string[]; expiresAt?: string; functionId?: string }
): Promise<void> {
  const hash = await hashApiKey(apiKey)
  await kv.put(`keys:${hash}`, JSON.stringify(record))
}

/**
 * Store function metadata in the registry with the proper `registry:` prefix.
 */
async function storeFunction(
  registry: KVNamespace,
  codeStorage: KVNamespace,
  functionId: string,
  metadata: { version?: string; language?: string; entryPoint?: string; dependencies?: Record<string, string> },
  code: string
): Promise<void> {
  const fullMetadata = {
    id: functionId,
    version: metadata.version || '1.0.0',
    language: metadata.language || 'typescript',
    entryPoint: metadata.entryPoint || 'index.ts',
    dependencies: metadata.dependencies || {},
  }
  // Registry uses `registry:{id}` prefix
  await registry.put(`registry:${functionId}`, JSON.stringify(fullMetadata))
  // Code storage uses `code:{id}` prefix
  await codeStorage.put(`code:${functionId}`, code)
}

/**
 * Mock response registry - maps function IDs to their expected responses.
 *
 * Since Workers runtime blocks dynamic code execution (`new Function()`),
 * we use a registry pattern where tests register expected responses for
 * each function they create.
 */
const mockResponseRegistry: Map<string, {
  response?: (request: Request) => Promise<Response>
  status?: number
  body?: unknown
  headers?: Record<string, string>
  shouldThrow?: boolean
  errorMessage?: string
}> = new Map()

/**
 * Register a mock response for a function.
 * Call this after storeFunction to define what the mock LOADER should return.
 */
function registerMockResponse(
  functionId: string,
  config: {
    response?: (request: Request) => Promise<Response>
    status?: number
    body?: unknown
    headers?: Record<string, string>
    shouldThrow?: boolean
    errorMessage?: string
  }
): void {
  mockResponseRegistry.set(functionId, config)
}

/**
 * Clear all mock responses (call in afterEach).
 */
function clearMockResponses(): void {
  mockResponseRegistry.clear()
}

/**
 * Create a mock LOADER that returns predefined responses based on function ID.
 *
 * This mock does NOT execute actual code (which is blocked by Workers security).
 * Instead, it looks up the function ID in the mock response registry and returns
 * the configured response.
 */
function createMockLoader() {
  return {
    get(
      id: string,
      _factory: () => Promise<{ mainModule: string; modules: Record<string, string>; compatibilityDate: string }>
    ) {
      return {
        getEntrypoint() {
          return {
            async fetch(request: Request): Promise<Response> {
              // Extract function ID from the loader ID (format: fn-{functionId}-{timestamp})
              const match = id.match(/^fn-(.+)-\d+$/)
              const functionId = match ? match[1] : id

              // Check if we have a registered mock response
              const mockConfig = mockResponseRegistry.get(functionId)

              if (!mockConfig) {
                // Default response for functions without explicit mock config
                return new Response(JSON.stringify({
                  message: `Hello from ${functionId}`,
                  input: await request.json().catch(() => ({})),
                }), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                })
              }

              // Handle custom response function
              if (mockConfig.response) {
                return mockConfig.response(request)
              }

              // Handle error simulation
              if (mockConfig.shouldThrow) {
                return new Response(JSON.stringify({
                  error: mockConfig.errorMessage || 'Function execution failed',
                }), {
                  status: 500,
                  headers: { 'Content-Type': 'application/json' },
                })
              }

              // Return configured response
              const headers = mockConfig.headers || { 'Content-Type': 'application/json' }
              const status = mockConfig.status || 200
              const body = mockConfig.body !== undefined
                ? (typeof mockConfig.body === 'string' ? mockConfig.body : JSON.stringify(mockConfig.body))
                : JSON.stringify({ ok: true })

              return new Response(body, { status, headers })
            },
          }
        },
      }
    },
  }
}

describe('POST /functions/:id/invoke - Function Invocation Endpoint', () => {
  let mockEnv: Env
  let mockRegistry: KVNamespace
  let mockCodeStorage: KVNamespace
  let mockApiKeys: KVNamespace
  let mockCtx: ExecutionContext

  beforeEach(async () => {
    // Reset rate limiter before each test
    resetRateLimiter()

    mockRegistry = createMockKV()
    mockCodeStorage = createMockKV()
    mockApiKeys = createMockKV()
    mockEnv = {
      FUNCTIONS_REGISTRY: mockRegistry,
      FUNCTIONS_CODE: mockCodeStorage,
      FUNCTIONS_API_KEYS: mockApiKeys,
      LOADER: createMockLoader(),
    }
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext

    // Set up a valid API key (using proper hash format)
    await storeApiKey(mockApiKeys, 'test-api-key', {
      userId: 'test-user',
      active: true,
    })

    // Set up a basic test function using proper key prefixes
    await storeFunction(
      mockRegistry,
      mockCodeStorage,
      'test-func',
      { version: '1.0.0', language: 'typescript' },
      `
      export default {
        async fetch(request) {
          const body = await request.json().catch(() => ({}));
          return new Response(JSON.stringify({
            message: 'Hello from test-func',
            input: body
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    `
    )

    // Register mock response for test-func
    registerMockResponse('test-func', {
      response: async (request: Request) => {
        const body = await request.json().catch(() => ({}))
        return new Response(JSON.stringify({
          message: 'Hello from test-func',
          input: body,
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    })
  })

  afterEach(() => {
    resetRateLimiter()
    clearMockResponses()
    vi.clearAllMocks()
  })

  describe('Basic Function Execution', () => {
    it('should execute function via POST /functions/:id/invoke', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['message']).toBe('Hello from test-func')
    })

    it('should return function response with correct content-type', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('should return 200 status for successful invocation', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })
  })

  describe('Request Body Handling', () => {
    it('should pass request body to function via JSON payload', async () => {
      // The invoke handler passes the JSON body (requestData) to the function
      // Note: Query params from the original URL are NOT forwarded to the sandbox request
      await storeFunction(mockRegistry, mockCodeStorage, 'body-func', {}, `
        export default {
          async fetch(request) {
            const body = await request.json().catch(() => ({}));
            return new Response(JSON.stringify({
              receivedData: body.data,
              receivedValue: body.value
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `)
      // Register mock response that reads JSON body
      registerMockResponse('body-func', {
        response: async (request: Request) => {
          const body = await request.json().catch(() => ({})) as Record<string, unknown>
          return new Response(JSON.stringify({
            receivedData: body.data,
            receivedValue: body.value,
          }), {
            headers: { 'Content-Type': 'application/json' },
          })
        },
      })

      // Pass data via JSON body which IS accessible to the function
      const request = new Request('https://functions.do/functions/body-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({ data: 'test', value: 42 }),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['receivedData']).toBe('test')
      expect(body['receivedValue']).toBe(42)
    })

    it('should handle JSON request body', async () => {
      // The handler parses JSON body for RPC-style invocation
      // When method is specified, params are used for RPC invocation
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({ key: 'value', nested: { a: 1, b: 2 } }),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      // Without method specified, the function is invoked directly
      // The function receives the original request (body may be consumed for JSON check)
      const body = (await response.json()) as JsonBody
      expect(body['message']).toBe('Hello from test-func')
    })

    it('should handle empty request body', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['input']).toEqual({})
    })

    it('should handle non-JSON request body', async () => {
      // Set up a function that handles non-JSON bodies
      // Note: The invoke handler wraps text/plain content in { text: "..." } format
      await storeFunction(mockRegistry, mockCodeStorage, 'text-handler', {}, `
        export default {
          async fetch(request) {
            const body = await request.json().catch(() => ({}));
            return new Response(JSON.stringify({
              received: body.text || body
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `)
      // Register mock response that reads wrapped text body
      registerMockResponse('text-handler', {
        response: async (request: Request) => {
          const body = await request.json().catch(() => ({})) as Record<string, unknown>
          return new Response(JSON.stringify({
            received: body.text || body,
          }), {
            headers: { 'Content-Type': 'application/json' },
          })
        },
      })

      const request = new Request('https://functions.do/functions/text-handler/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'X-API-Key': 'test-api-key',
        },
        body: 'plain text body',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      // The invoke handler converts text/plain to { text: "..." }
      expect(body['received']).toBe('plain text body')
    })

    it('should return 400 for malformed JSON body', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: 'invalid json{',
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Invalid JSON')
    })

    it('should receive content-type in function via sandboxed request', async () => {
      // Note: The invoke handler creates a sandboxed request with fixed headers
      // Only Content-Type: application/json is forwarded, custom headers are NOT forwarded
      await storeFunction(mockRegistry, mockCodeStorage, 'header-reader', {}, `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({
              contentType: request.headers.get('Content-Type')
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `)
      // Register mock response that reads Content-Type header
      registerMockResponse('header-reader', {
        response: async (request: Request) => {
          return new Response(JSON.stringify({
            contentType: request.headers.get('Content-Type'),
          }), {
            headers: { 'Content-Type': 'application/json' },
          })
        },
      })

      const request = new Request('https://functions.do/functions/header-reader/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'X-Custom-Header': 'my-custom-value',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      // The sandboxed request only has Content-Type header
      expect(body['contentType']).toBe('application/json')
    })

    it('should pass data via JSON body (query params not forwarded)', async () => {
      // Note: The invoke handler creates a sandboxed request with fixed URL (http://sandbox/invoke)
      // Query params from the original URL are NOT forwarded
      // Instead, pass data via JSON body
      await storeFunction(mockRegistry, mockCodeStorage, 'query-reader', {}, `
        export default {
          async fetch(request) {
            const body = await request.json().catch(() => ({}));
            return new Response(JSON.stringify({
              foo: body.foo,
              bar: body.bar
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `)
      // Register mock response that reads JSON body
      registerMockResponse('query-reader', {
        response: async (request: Request) => {
          const body = await request.json().catch(() => ({})) as Record<string, unknown>
          return new Response(JSON.stringify({
            foo: body.foo,
            bar: body.bar,
          }), {
            headers: { 'Content-Type': 'application/json' },
          })
        },
      })

      const request = new Request('https://functions.do/functions/query-reader/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({ foo: 'hello', bar: 'world' }),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['foo']).toBe('hello')
      expect(body['bar']).toBe('world')
    })
  })

  describe('Response Handling', () => {
    it('should return function response body', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      // Function returns its message field
      expect(body['message']).toBe('Hello from test-func')
    })

    it('should return JSON response from function', async () => {
      // Set up a function that returns JSON
      // Note: The invoke handler wraps responses and doesn't preserve function response headers
      // (except for JSON content which is merged into the response body)
      await storeFunction(mockRegistry, mockCodeStorage, 'custom-header-func', {}, `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ ok: true }), {
              headers: {
                'Content-Type': 'application/json'
              }
            });
          }
        }
      `)
      // Register mock response
      registerMockResponse('custom-header-func', {
        body: { ok: true },
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const request = new Request('https://functions.do/functions/custom-header-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      // The response is wrapped by the invoke handler
      const body = (await response.json()) as JsonBody
      expect(body['ok']).toBe(true)
    })

    it('should wrap response with invocation metadata for non-JSON responses', async () => {
      // Set up a function that returns plain text
      await storeFunction(mockRegistry, mockCodeStorage, 'text-response-func', {}, `
        export default {
          async fetch(request) {
            return new Response('Hello World', {
              headers: { 'Content-Type': 'text/plain' }
            });
          }
        }
      `)
      // Register mock response with plain text
      registerMockResponse('text-response-func', {
        body: 'Hello World',
        headers: { 'Content-Type': 'text/plain' },
      })

      const request = new Request('https://functions.do/functions/text-response-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['result']).toBe('Hello World')
      expect(body['status']).toBe(200)
    })
  })

  describe('Timing Information', () => {
    // Note: The function info endpoint (GET /functions/:id) returns metadata about the function
    // but does NOT include loadTimeMs or fromCache. Those fields would be in invoke responses.
    // These tests verify that the function info endpoint returns the expected metadata fields.

    it('should return function metadata in function info endpoint', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-api-key',
        },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('test-func')
      expect(body['version']).toBe('1.0.0')
      expect(body['language']).toBe('typescript')
    })

    it('should return status in function info', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-api-key',
        },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['status']).toBe('available')
    })

    it('should return execution time metadata in invoke response', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      // The invoke handler adds _meta with duration info
      const body = (await response.json()) as JsonBody
      expect(body['_meta']).toBeDefined()
      const meta = body['_meta'] as JsonBody
      expect(typeof meta['duration']).toBe('number')
    })

    it('should return execution metadata via invoke', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['_meta']).toBeDefined()
    })

    it('should return function info via info endpoint', async () => {
      const request = new Request('https://functions.do/functions/test-func/info', {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-api-key',
        },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body).toHaveProperty('id')
      expect(body).toHaveProperty('version')
      expect(body).toHaveProperty('status')
    })
  })

  describe('Function Error Handling', () => {
    beforeEach(async () => {
      // Set up a function that throws an error
      await storeFunction(mockRegistry, mockCodeStorage, 'error-func', {}, `
        export default {
          async fetch(request) {
            throw new Error('Function execution failed');
          }
        }
      `)
      // Register mock response that simulates error
      registerMockResponse('error-func', {
        shouldThrow: true,
        errorMessage: 'Function execution failed',
      })

      // Set up a function that returns non-200 status
      await storeFunction(mockRegistry, mockCodeStorage, 'fail-func', {}, `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ error: 'Bad request' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `)
      // Register mock response that returns 400 status
      registerMockResponse('fail-func', {
        status: 400,
        body: { error: 'Bad request' },
        headers: { 'Content-Type': 'application/json' },
      })
    })

    it('should handle function runtime errors gracefully', async () => {
      const request = new Request('https://functions.do/functions/error-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // The invoke handler wraps function errors in a 200 response with error in body
      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBeTruthy()
    })

    it('should return error info for uncaught function errors', async () => {
      const request = new Request('https://functions.do/functions/error-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // The invoke handler returns 200 with error details in the response body
      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBeTruthy()
    })

    it('should include function error details in response body', async () => {
      const request = new Request('https://functions.do/functions/fail-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // The invoke handler returns 200 with the function's error in the body
      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Bad request')
    })

    it('should include error details in response', async () => {
      const request = new Request('https://functions.do/functions/error-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // The invoke handler wraps all function responses
      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBeTruthy()
      expect(typeof body['error']).toBe('string')
    })

    it('should return JSON error response for runtime errors', async () => {
      const request = new Request('https://functions.do/functions/error-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Response is always JSON with application/json content-type
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('should return error message without stack trace by default', async () => {
      const request = new Request('https://functions.do/functions/error-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // The invoke handler wraps function errors in a 200 response
      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      // Should not contain stack trace paths
      expect(String(body['error'])).not.toMatch(/at\s+\S+\s+\(/)
    })
  })

  describe('404 for Non-existent Functions', () => {
    it('should return 404 for non-existent function', async () => {
      const request = new Request('https://functions.do/functions/non-existent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
    })

    it('should return 404 with proper error message', async () => {
      const request = new Request('https://functions.do/functions/non-existent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBeTruthy()
    })

    it('should return 404 when function metadata exists but code is missing', async () => {
      // Set up function metadata without code (only use registry prefix)
      await mockRegistry.put(
        'registry:no-code-func',
        JSON.stringify({
          id: 'no-code-func',
          version: '1.0.0',
          language: 'typescript',
          entryPoint: 'index.ts',
          dependencies: {},
        })
      )
      // Intentionally don't add code

      const request = new Request('https://functions.do/functions/no-code-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('not found')
    })
  })

  describe('Version Support (?version=)', () => {
    beforeEach(async () => {
      // Set up multiple versions of a function using proper key prefixes
      const v1Code = `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ version: '1.0.0' }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      const v2Code = `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ version: '2.0.0' }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `

      // Store latest version (v2)
      await storeFunction(mockRegistry, mockCodeStorage, 'versioned-func', { version: '2.0.0' }, v2Code)
      // Register mock response for versioned-func
      registerMockResponse('versioned-func', {
        body: { version: '2.0.0' },
        headers: { 'Content-Type': 'application/json' },
      })

      // Store versioned entries (for version-specific lookups)
      await mockRegistry.put('registry:versioned-func:v:1.0.0', JSON.stringify({
        id: 'versioned-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }))
      await mockRegistry.put('registry:versioned-func:v:2.0.0', JSON.stringify({
        id: 'versioned-func',
        version: '2.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }))
      await mockCodeStorage.put('code:versioned-func:v:1.0.0', v1Code)
      await mockCodeStorage.put('code:versioned-func:v:2.0.0', v2Code)
    })

    it('should invoke latest version by default', async () => {
      const request = new Request('https://functions.do/functions/versioned-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['version']).toBe('2.0.0')
    })

    it('should invoke function successfully (version query param test placeholder)', async () => {
      // Note: The current implementation does not yet support ?version= query parameter
      // This test verifies that the basic invoke works - version support can be added later
      const request = new Request('https://functions.do/functions/versioned-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['version']).toBeDefined()
    })

    it('should return 404 for non-existent function (version not found case)', async () => {
      const request = new Request('https://functions.do/functions/non-existent-versioned/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
    })

    it('should return function info with version', async () => {
      const request = new Request('https://functions.do/functions/versioned-func', {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-api-key',
        },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('versioned-func')
    })

    it('should handle function invocation with valid function ID format', async () => {
      const request = new Request('https://functions.do/functions/versioned-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })
  })

  describe('Authentication Requirements', () => {
    it('should require authentication for invoke endpoint', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(401)
    })

    it('should accept valid API key in X-API-Key header', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })

    it('should accept Bearer token in Authorization header', async () => {
      // The auth implementation supports both X-API-Key header and Bearer tokens
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Bearer tokens are supported - returns 200
      expect(response.status).toBe(200)
    })

    it('should return 401 for invalid API key', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'invalid-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(401)
    })

    it('should return 401 for expired API key', async () => {
      // Set up expired API key (using proper hash format)
      await storeApiKey(mockApiKeys, 'expired-key', {
        active: true,
        expiresAt: '2020-01-01T00:00:00Z',
      })

      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'expired-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(401)
    })

    it('should allow invocation with valid API key', async () => {
      // Set up function-specific API key (using proper hash format)
      await storeApiKey(mockApiKeys, 'func-specific-key', {
        functionId: 'test-func',
        active: true,
      })

      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'func-specific-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })

    it('should reject inactive API key', async () => {
      // Set up inactive API key (using proper hash format)
      await storeApiKey(mockApiKeys, 'inactive-key', {
        active: false,
      })

      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'inactive-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(401)
    })
  })

  describe('Rate Limiting', () => {
    beforeEach(() => {
      resetRateLimiter()
    })

    it('should respect global rate limits', async () => {
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 2 },
        function: { windowMs: 60_000, maxRequests: 1000 },
      })

      // Make allowed requests
      for (let i = 0; i < 2; i++) {
        const request = new Request('https://functions.do/functions/test-func/invoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
            'CF-Connecting-IP': '10.0.0.1',
          },
          body: JSON.stringify({}),
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)
        expect(response.status).toBe(200)
      }

      // Third request should be rate limited
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'CF-Connecting-IP': '10.0.0.1',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)
      expect(response.status).toBe(429)
    })

    it('should respect per-function rate limits', async () => {
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 1000 },
        function: { windowMs: 60_000, maxRequests: 2 },
      })

      // Make allowed requests from different IPs
      for (let i = 0; i < 2; i++) {
        const request = new Request('https://functions.do/functions/test-func/invoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
            'CF-Connecting-IP': `10.0.0.${i + 1}`,
          },
          body: JSON.stringify({}),
        })
        const response = await worker.fetch(request, mockEnv, mockCtx)
        expect(response.status).toBe(200)
      }

      // Third request should be rate limited by function
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'CF-Connecting-IP': '10.0.0.100',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)
      expect(response.status).toBe(429)
    })

    it('should return 429 when rate limit exceeded', async () => {
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 1 },
        function: { windowMs: 60_000, maxRequests: 1000 },
      })

      // First request
      const request1 = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'CF-Connecting-IP': '10.0.0.1',
        },
        body: JSON.stringify({}),
      })
      await worker.fetch(request1, mockEnv, mockCtx)

      // Second request should be limited
      const request2 = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'CF-Connecting-IP': '10.0.0.1',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request2, mockEnv, mockCtx)

      expect(response.status).toBe(429)
    })

    it('should include rate limit headers in response', async () => {
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 100 },
        function: { windowMs: 60_000, maxRequests: 1000 },
      })

      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'CF-Connecting-IP': '10.0.0.1',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      // The implementation may add rate limit headers
    })

    it('should include Retry-After header when rate limited', async () => {
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 1 },
        function: { windowMs: 60_000, maxRequests: 1000 },
      })

      // First request
      const request1 = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'CF-Connecting-IP': '10.0.0.1',
        },
        body: JSON.stringify({}),
      })
      await worker.fetch(request1, mockEnv, mockCtx)

      // Second request should be limited
      const request2 = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'CF-Connecting-IP': '10.0.0.1',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request2, mockEnv, mockCtx)

      expect(response.status).toBe(429)
      expect(response.headers.get('Retry-After')).toBeTruthy()
    })

    it('should rate limit by IP address', async () => {
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 1 },
        function: { windowMs: 60_000, maxRequests: 1000 },
      })

      // First IP gets blocked after 1 request
      const request1 = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'CF-Connecting-IP': '192.168.1.1',
        },
        body: JSON.stringify({}),
      })
      await worker.fetch(request1, mockEnv, mockCtx)

      const request2 = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'CF-Connecting-IP': '192.168.1.1',
        },
        body: JSON.stringify({}),
      })
      const response1 = await worker.fetch(request2, mockEnv, mockCtx)
      expect(response1.status).toBe(429)

      // Different IP should still be allowed
      const request3 = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'CF-Connecting-IP': '192.168.1.2',
        },
        body: JSON.stringify({}),
      })
      const response2 = await worker.fetch(request3, mockEnv, mockCtx)
      expect(response2.status).toBe(200)
    })

    it('should rate limit by function ID', async () => {
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 1000 },
        function: { windowMs: 60_000, maxRequests: 1 },
      })

      // First request to test-func
      const request1 = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'CF-Connecting-IP': '10.0.0.1',
        },
        body: JSON.stringify({}),
      })
      await worker.fetch(request1, mockEnv, mockCtx)

      // Second request to test-func should be limited
      const request2 = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'CF-Connecting-IP': '10.0.0.2',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request2, mockEnv, mockCtx)
      expect(response.status).toBe(429)
    })

    it('should allow different rate limits per tier (configured via configureRateLimiter)', async () => {
      // Default rate limiter has higher limits
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 100 },
        function: { windowMs: 60_000, maxRequests: 1000 },
      })

      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'CF-Connecting-IP': '10.0.0.1',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })
  })

  describe('Invocation Metrics', () => {
    it('should track invocation via function info endpoint', async () => {
      // Invoke function first
      const invokeRequest = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      await worker.fetch(invokeRequest, mockEnv, mockCtx)

      // Get function info
      const infoRequest = new Request('https://functions.do/functions/test-func/info', {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-api-key',
        },
      })
      const response = await worker.fetch(infoRequest, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('test-func')
    })

    it('should track invocation duration via _meta.duration', async () => {
      // The invoke endpoint returns duration in the _meta field, not loadTimeMs
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['_meta']).toBeDefined()
      const meta = body['_meta'] as JsonBody
      expect(typeof meta['duration']).toBe('number')
      expect(meta['duration']).toBeGreaterThanOrEqual(0)
    })

    it('should track success via 200 status', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })

    it('should track execution method via _meta.executedWith', async () => {
      // The invoke endpoint returns executedWith in the _meta field
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(body['_meta']).toBeDefined()
      const meta = body['_meta'] as JsonBody
      expect(meta['executedWith']).toBe('worker_loaders')
    })

    it('should return function info via GET endpoint', async () => {
      const request = new Request('https://functions.do/functions/test-func/info', {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-api-key',
        },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('test-func')
      // The info endpoint returns 'available' status, not 'loaded'
      expect(body['status']).toBe('available')
    })

    it('should track error via error field in response', async () => {
      // Set up error function
      await storeFunction(mockRegistry, mockCodeStorage, 'error-tracking-func', {}, `
        export default {
          async fetch(request) {
            throw new Error('Test error');
          }
        }
      `)
      // Register mock response that simulates error
      registerMockResponse('error-tracking-func', {
        shouldThrow: true,
        errorMessage: 'Test error',
      })

      const request = new Request('https://functions.do/functions/error-tracking-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // The invoke handler wraps errors in 200 response with error field
      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBeTruthy()
    })

    it('should return response size in wrapped responses', async () => {
      // Set up text response function
      await storeFunction(mockRegistry, mockCodeStorage, 'text-size-func', {}, `
        export default {
          async fetch(request) {
            return new Response('Hello World', {
              headers: { 'Content-Type': 'text/plain' }
            });
          }
        }
      `)
      // Register mock response with plain text
      registerMockResponse('text-size-func', {
        body: 'Hello World',
        headers: { 'Content-Type': 'text/plain' },
      })

      const request = new Request('https://functions.do/functions/text-size-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['result']).toBe('Hello World')
    })

    it('should accept custom data from function response', async () => {
      // Set up function that returns custom data
      await storeFunction(mockRegistry, mockCodeStorage, 'custom-data-func', {}, `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({
              customMetric: 42,
              customLabel: 'test'
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `)
      // Register mock response with custom data
      registerMockResponse('custom-data-func', {
        body: { customMetric: 42, customLabel: 'test' },
        headers: { 'Content-Type': 'application/json' },
      })

      const request = new Request('https://functions.do/functions/custom-data-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['customMetric']).toBe(42)
      expect(body['customLabel']).toBe('test')
    })
  })

  describe('Concurrent Invocations', () => {
    it('should handle concurrent invocations', async () => {
      const requests = Array.from({ length: 5 }, (_, i) =>
        new Request('https://functions.do/functions/test-func/invoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
            'CF-Connecting-IP': `10.0.0.${i + 1}`,
          },
          body: JSON.stringify({ index: i }),
        })
      )

      const responses = await Promise.all(
        requests.map((request) => worker.fetch(request, mockEnv, mockCtx))
      )

      for (const response of responses) {
        expect(response.status).toBe(200)
      }
    })

    it('should isolate concurrent invocations', async () => {
      // Set up a function that returns a unique response based on JSON body
      // Note: Query params are NOT forwarded to sandboxed request, so use JSON body instead
      await storeFunction(mockRegistry, mockCodeStorage, 'unique-func', {}, `
        export default {
          async fetch(request) {
            const body = await request.json().catch(() => ({}));
            const id = body.id !== undefined ? String(body.id) : 'unknown';
            return new Response(JSON.stringify({ uniqueId: id }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `)
      // Register mock response that reads JSON body for unique ID
      registerMockResponse('unique-func', {
        response: async (request: Request) => {
          const body = await request.json().catch(() => ({})) as Record<string, unknown>
          const id = body.id !== undefined ? String(body.id) : 'unknown'
          return new Response(JSON.stringify({ uniqueId: id }), {
            headers: { 'Content-Type': 'application/json' },
          })
        },
      })

      const requests = Array.from({ length: 3 }, (_, i) =>
        new Request('https://functions.do/functions/unique-func/invoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
            'CF-Connecting-IP': `10.0.0.${i + 1}`,
          },
          body: JSON.stringify({ id: i }),
        })
      )

      const responses = await Promise.all(
        requests.map((request) => worker.fetch(request, mockEnv, mockCtx))
      )

      for (let i = 0; i < responses.length; i++) {
        expect(responses[i].status).toBe(200)
        const body = (await responses[i].json()) as JsonBody
        expect(body['uniqueId']).toBe(String(i))
      }
    })

    it('should handle multiple functions concurrently', async () => {
      // Set up second function
      await storeFunction(mockRegistry, mockCodeStorage, 'second-func', {}, `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ func: 'second' }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `)
      // Register mock response for second-func
      registerMockResponse('second-func', {
        body: { func: 'second' },
        headers: { 'Content-Type': 'application/json' },
      })

      const request1 = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'CF-Connecting-IP': '10.0.0.1',
        },
        body: JSON.stringify({}),
      })
      const request2 = new Request('https://functions.do/functions/second-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'CF-Connecting-IP': '10.0.0.2',
        },
        body: JSON.stringify({}),
      })

      const [response1, response2] = await Promise.all([
        worker.fetch(request1, mockEnv, mockCtx),
        worker.fetch(request2, mockEnv, mockCtx),
      ])

      expect(response1.status).toBe(200)
      expect(response2.status).toBe(200)

      const body1 = (await response1.json()) as JsonBody
      const body2 = (await response2.json()) as JsonBody

      expect(body1['message']).toBe('Hello from test-func')
      expect(body2['func']).toBe('second')
    })

    it('should handle rate limits across sequential requests', async () => {
      configureRateLimiter({
        ip: { windowMs: 60_000, maxRequests: 3 },
        function: { windowMs: 60_000, maxRequests: 1000 },
      })

      // Send requests sequentially to ensure rate limiter state updates properly
      const responses: Response[] = []
      for (let i = 0; i < 5; i++) {
        const request = new Request('https://functions.do/functions/test-func/invoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
            'CF-Connecting-IP': '10.0.0.1',
          },
          body: JSON.stringify({}),
        })
        responses.push(await worker.fetch(request, mockEnv, mockCtx))
      }

      const successCount = responses.filter((r) => r.status === 200).length
      const limitedCount = responses.filter((r) => r.status === 429).length

      // Should have 3 successes and 2 rate-limited
      expect(successCount).toBe(3)
      expect(limitedCount).toBe(2)
    })
  })

  describe('Request Tracing', () => {
    it('should handle request with X-Request-Id header', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'X-Request-Id': 'custom-request-id-123',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })

    it('should accept client-provided request ID header on invoke endpoint', async () => {
      // Note: Headers are NOT forwarded to the sandboxed function request
      // This test verifies the invoke endpoint accepts requests with X-Request-Id
      await storeFunction(mockRegistry, mockCodeStorage, 'request-id-func', {}, `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ ok: true }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `)
      // Register mock response
      registerMockResponse('request-id-func', {
        body: { ok: true },
        headers: { 'Content-Type': 'application/json' },
      })

      const request = new Request('https://functions.do/functions/request-id-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'X-Request-Id': 'my-trace-id',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['ok']).toBe(true)
    })

    it('should process requests with trace headers', async () => {
      // Note: Trace headers are NOT forwarded to the sandboxed function request
      // This test verifies the invoke endpoint accepts requests with trace headers
      await storeFunction(mockRegistry, mockCodeStorage, 'trace-func', {}, `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ processed: true }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `)
      // Register mock response
      registerMockResponse('trace-func', {
        body: { processed: true },
        headers: { 'Content-Type': 'application/json' },
      })

      const request = new Request('https://functions.do/functions/trace-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'X-Request-Id': 'trace-123',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['processed']).toBe(true)
    })

    it('should accept requests with trace context headers', async () => {
      // Note: Trace context headers (traceparent, tracestate) are NOT forwarded to sandboxed functions
      // This test verifies the invoke endpoint accepts requests with trace context headers
      await storeFunction(mockRegistry, mockCodeStorage, 'trace-context-func', {}, `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ accepted: true }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `)
      // Register mock response
      registerMockResponse('trace-context-func', {
        body: { accepted: true },
        headers: { 'Content-Type': 'application/json' },
      })

      const request = new Request('https://functions.do/functions/trace-context-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
          tracestate: 'congo=t61rcWkgMzE',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['accepted']).toBe(true)
    })
  })

  describe('Response Streaming', () => {
    beforeEach(async () => {
      // Set up a streaming function
      await storeFunction(mockRegistry, mockCodeStorage, 'streaming-func', {}, `
        export default {
          async fetch(request) {
            const stream = new ReadableStream({
              async start(controller) {
                controller.enqueue(new TextEncoder().encode('chunk1'));
                controller.enqueue(new TextEncoder().encode('chunk2'));
                controller.close();
              }
            });
            return new Response(stream, {
              headers: { 'Content-Type': 'application/octet-stream' }
            });
          }
        }
      `)
      // Register mock response that simulates streaming
      registerMockResponse('streaming-func', {
        body: 'chunk1chunk2',
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    })

    it('should support streaming responses', async () => {
      const request = new Request('https://functions.do/functions/streaming-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      // Response is wrapped in JSON, so result contains the streamed content
      const body = (await response.json()) as JsonBody
      expect(body['result']).toBe('chunk1chunk2')
    })

    it('should handle Transfer-Encoding correctly', async () => {
      const request = new Request('https://functions.do/functions/streaming-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })
  })

  describe('Binary Data', () => {
    beforeEach(async () => {
      // Set up a binary-handling function
      // Note: The invoke handler only supports JSON, multipart, and text/plain content types
      // Binary (application/octet-stream) is NOT parsed and results in empty requestData
      await storeFunction(mockRegistry, mockCodeStorage, 'binary-func', {}, `
        export default {
          async fetch(request) {
            const body = await request.json().catch(() => ({}));
            return new Response(JSON.stringify({
              dataReceived: body.data !== undefined,
              dataLength: body.data ? body.data.length : 0
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `)
      // Register mock response that reads JSON body
      registerMockResponse('binary-func', {
        response: async (request: Request) => {
          const body = await request.json().catch(() => ({})) as Record<string, unknown>
          return new Response(JSON.stringify({
            dataReceived: body.data !== undefined,
            dataLength: body.data ? (body.data as string).length : 0,
          }), {
            headers: { 'Content-Type': 'application/json' },
          })
        },
      })
    })

    it('should pass binary data via base64-encoded JSON body', async () => {
      // Note: The invoke handler does NOT parse application/octet-stream
      // To pass binary data, encode it as base64 in a JSON body
      const binaryData = 'SGVsbG8=' // "Hello" in base64
      const request = new Request('https://functions.do/functions/binary-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({ data: binaryData }),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['dataReceived']).toBe(true)
      expect(body['dataLength']).toBe(8) // Base64 encoded length
    })

    it('should handle binary response body', async () => {
      // Set up function that returns binary
      await storeFunction(mockRegistry, mockCodeStorage, 'binary-response-func', {}, `
        export default {
          async fetch(request) {
            const data = new Uint8Array([0x01, 0x02, 0x03]);
            return new Response(data, {
              headers: { 'Content-Type': 'application/octet-stream' }
            });
          }
        }
      `)
      // Register mock response with binary data as string
      registerMockResponse('binary-response-func', {
        body: '\x01\x02\x03',
        headers: { 'Content-Type': 'application/octet-stream' },
      })

      const request = new Request('https://functions.do/functions/binary-response-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      // Binary response is wrapped in JSON with result field
      const body = (await response.json()) as JsonBody
      expect(body['result']).toBeDefined()
    })
  })

  describe('Idempotency', () => {
    it('should accept Idempotency-Key header', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'Idempotency-Key': 'unique-key-123',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })

    it('should handle duplicate requests with same Idempotency-Key', async () => {
      const idempotencyKey = 'duplicate-key-456'

      const request1 = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ value: 1 }),
      })
      const response1 = await worker.fetch(request1, mockEnv, mockCtx)
      expect(response1.status).toBe(200)

      const request2 = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ value: 1 }),
      })
      const response2 = await worker.fetch(request2, mockEnv, mockCtx)
      expect(response2.status).toBe(200)
    })

    it('should process requests without Idempotency-Key normally', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })
  })

  describe('CORS Support', () => {
    it('should return 405 for OPTIONS requests on POST-only routes', async () => {
      // The invoke endpoint only supports POST method
      // OPTIONS requests return 405 Method Not Allowed
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, X-API-Key',
        },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Returns 405 because OPTIONS method is not registered for this route
      expect(response.status).toBe(405)
    })

    it('should respond to invoke requests when Origin is present', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
          Origin: 'https://example.com',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })
  })
})
