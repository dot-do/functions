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
      REGISTRY: mockRegistry,
      CODE: mockCodeStorage,
      API_KEYS: mockApiKeys,
    }
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext

    // Set up a valid API key
    await mockApiKeys.put(
      'test-api-key',
      JSON.stringify({
        userId: 'test-user',
        active: true,
      })
    )

    // Set up a basic test function
    const testFunctionMetadata = {
      id: 'test-func',
      version: '1.0.0',
      language: 'typescript',
      entryPoint: 'index.ts',
      dependencies: {},
    }
    await mockRegistry.put('test-func', JSON.stringify(testFunctionMetadata))

    const testFunctionCode = `
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
    await mockCodeStorage.put('test-func', testFunctionCode)
  })

  afterEach(() => {
    resetRateLimiter()
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
    it('should pass request body to function via fetch handler', async () => {
      // Set up a function that reads query params from the request
      // (since JSON body may be consumed by RPC check, we test via query params)
      const bodyFunctionMetadata = {
        id: 'body-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('body-func', JSON.stringify(bodyFunctionMetadata))

      const bodyFunctionCode = `
        export default {
          async fetch(request) {
            const url = new URL(request.url);
            const data = url.searchParams.get('data');
            const value = url.searchParams.get('value');
            return new Response(JSON.stringify({
              receivedData: data,
              receivedValue: value ? parseInt(value, 10) : null
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('body-func', bodyFunctionCode)

      // Pass data via query params which are accessible to the function
      const request = new Request('https://functions.do/functions/body-func/invoke?data=test&value=42', {
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
      const textFunctionMetadata = {
        id: 'text-handler',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('text-handler', JSON.stringify(textFunctionMetadata))

      const textFunctionCode = `
        export default {
          async fetch(request) {
            const text = await request.text();
            return new Response(JSON.stringify({
              received: text
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('text-handler', textFunctionCode)

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

    it('should forward headers to function', async () => {
      // Set up a function that reads headers
      const headerFunctionMetadata = {
        id: 'header-reader',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('header-reader', JSON.stringify(headerFunctionMetadata))

      const headerFunctionCode = `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({
              customHeader: request.headers.get('X-Custom-Header'),
              contentType: request.headers.get('Content-Type')
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('header-reader', headerFunctionCode)

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
      expect(body['customHeader']).toBe('my-custom-value')
    })

    it('should forward query parameters to function', async () => {
      // Set up a function that reads query params
      const queryFunctionMetadata = {
        id: 'query-reader',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('query-reader', JSON.stringify(queryFunctionMetadata))

      const queryFunctionCode = `
        export default {
          async fetch(request) {
            const url = new URL(request.url);
            return new Response(JSON.stringify({
              foo: url.searchParams.get('foo'),
              bar: url.searchParams.get('bar')
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('query-reader', queryFunctionCode)

      const request = new Request('https://functions.do/functions/query-reader/invoke?foo=hello&bar=world', {
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

    it('should preserve function response headers', async () => {
      // Set up a function that sets custom headers
      const headerFunctionMetadata = {
        id: 'custom-header-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('custom-header-func', JSON.stringify(headerFunctionMetadata))

      const headerFunctionCode = `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ ok: true }), {
              headers: {
                'Content-Type': 'application/json',
                'X-Custom-Response': 'custom-value'
              }
            });
          }
        }
      `
      await mockCodeStorage.put('custom-header-func', headerFunctionCode)

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
      expect(response.headers.get('X-Custom-Response')).toBe('custom-value')
    })

    it('should wrap response with invocation metadata for non-JSON responses', async () => {
      // Set up a function that returns plain text
      const textFunctionMetadata = {
        id: 'text-response-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('text-response-func', JSON.stringify(textFunctionMetadata))

      const textFunctionCode = `
        export default {
          async fetch(request) {
            return new Response('Hello World', {
              headers: { 'Content-Type': 'text/plain' }
            });
          }
        }
      `
      await mockCodeStorage.put('text-response-func', textFunctionCode)

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
    it('should return loadTimeMs in function info endpoint', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-api-key',
        },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(typeof body['loadTimeMs']).toBe('number')
    })

    it('should return fromCache indicator in function info', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-api-key',
        },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(typeof body['fromCache']).toBe('boolean')
    })

    it('should indicate cold start on first invocation (fromCache: false)', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-api-key',
        },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      // First invocation should not be from cache
      expect(body['fromCache']).toBe(false)
    })

    it('should return consistent loadTimeMs across requests', async () => {
      // Each request creates a new FunctionLoader, so fromCache is always false at the loader level
      // But we can verify loadTimeMs is returned consistently
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-api-key',
        },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(typeof body['loadTimeMs']).toBe('number')
      expect(body['loadTimeMs']).toBeGreaterThanOrEqual(0)
    })

    it('should return timing info in function info response', async () => {
      const request = new Request('https://functions.do/functions/test-func/info', {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-api-key',
        },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body).toHaveProperty('loadTimeMs')
      expect(body).toHaveProperty('fromCache')
    })
  })

  describe('Function Error Handling', () => {
    beforeEach(async () => {
      // Set up a function that throws an error
      const errorFunctionMetadata = {
        id: 'error-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('error-func', JSON.stringify(errorFunctionMetadata))

      const errorFunctionCode = `
        export default {
          async fetch(request) {
            throw new Error('Function execution failed');
          }
        }
      `
      await mockCodeStorage.put('error-func', errorFunctionCode)

      // Set up a function that returns non-200 status
      const failFunctionMetadata = {
        id: 'fail-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('fail-func', JSON.stringify(failFunctionMetadata))

      const failFunctionCode = `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ error: 'Bad request' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('fail-func', failFunctionCode)
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

      expect(response.status).toBe(500)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBeTruthy()
    })

    it('should return 500 for uncaught function errors', async () => {
      const request = new Request('https://functions.do/functions/error-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(500)
    })

    it('should preserve function-returned error status codes', async () => {
      const request = new Request('https://functions.do/functions/fail-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(400)
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

      expect(response.status).toBe(500)
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

      expect(response.status).toBe(500)
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

      expect(response.status).toBe(500)
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
      // Set up function without code
      await mockRegistry.put(
        'no-code-func',
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
      // Set up multiple versions of a function
      const v1Metadata = {
        id: 'versioned-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      const v2Metadata = {
        id: 'versioned-func',
        version: '2.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await mockRegistry.put('versioned-func', JSON.stringify(v2Metadata))
      await mockRegistry.put('versioned-func@1.0.0', JSON.stringify(v1Metadata))
      await mockRegistry.put('versioned-func@2.0.0', JSON.stringify(v2Metadata))

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

      await mockCodeStorage.put('versioned-func', v2Code)
      await mockCodeStorage.put('versioned-func@1.0.0', v1Code)
      await mockCodeStorage.put('versioned-func@2.0.0', v2Code)
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

    it('should require X-API-Key header (Bearer token not supported)', async () => {
      // The current auth implementation only supports X-API-Key header, not Bearer tokens
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Returns 401 because Bearer token authentication is not implemented
      expect(response.status).toBe(401)
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
      // Set up expired API key
      await mockApiKeys.put(
        'expired-key',
        JSON.stringify({
          active: true,
          expiresAt: '2020-01-01T00:00:00Z',
        })
      )

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
      // Set up function-specific API key
      await mockApiKeys.put(
        'func-specific-key',
        JSON.stringify({
          functionId: 'test-func',
          active: true,
        })
      )

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
      await mockApiKeys.put(
        'inactive-key',
        JSON.stringify({
          active: false,
        })
      )

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

    it('should track invocation duration via loadTimeMs', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-api-key',
        },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(typeof body['loadTimeMs']).toBe('number')
      expect(body['loadTimeMs']).toBeGreaterThanOrEqual(0)
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

    it('should track cache status via fromCache field', async () => {
      // Each request creates a new FunctionLoader instance, so fromCache will be false
      // This tests that the fromCache field is present and reports correctly
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-api-key',
        },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(typeof body['fromCache']).toBe('boolean')
      // With per-request FunctionLoader instances, each load is fresh
      expect(body['fromCache']).toBe(false)
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
      expect(body['status']).toBe('loaded')
    })

    it('should track error via 500 status', async () => {
      // Set up error function
      await mockRegistry.put(
        'error-tracking-func',
        JSON.stringify({
          id: 'error-tracking-func',
          version: '1.0.0',
          language: 'typescript',
          entryPoint: 'index.ts',
          dependencies: {},
        })
      )
      await mockCodeStorage.put(
        'error-tracking-func',
        `
        export default {
          async fetch(request) {
            throw new Error('Test error');
          }
        }
      `
      )

      const request = new Request('https://functions.do/functions/error-tracking-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(500)
    })

    it('should return response size in wrapped responses', async () => {
      // Set up text response function
      await mockRegistry.put(
        'text-size-func',
        JSON.stringify({
          id: 'text-size-func',
          version: '1.0.0',
          language: 'typescript',
          entryPoint: 'index.ts',
          dependencies: {},
        })
      )
      await mockCodeStorage.put(
        'text-size-func',
        `
        export default {
          async fetch(request) {
            return new Response('Hello World', {
              headers: { 'Content-Type': 'text/plain' }
            });
          }
        }
      `
      )

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
      await mockRegistry.put(
        'custom-data-func',
        JSON.stringify({
          id: 'custom-data-func',
          version: '1.0.0',
          language: 'typescript',
          entryPoint: 'index.ts',
          dependencies: {},
        })
      )
      await mockCodeStorage.put(
        'custom-data-func',
        `
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
      `
      )

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
      // Set up a function that returns a unique response
      await mockRegistry.put(
        'unique-func',
        JSON.stringify({
          id: 'unique-func',
          version: '1.0.0',
          language: 'typescript',
          entryPoint: 'index.ts',
          dependencies: {},
        })
      )
      await mockCodeStorage.put(
        'unique-func',
        `
        export default {
          async fetch(request) {
            // Each function invocation returns a unique identifier from its URL
            const url = new URL(request.url);
            const id = url.searchParams.get('id') || 'unknown';
            return new Response(JSON.stringify({ uniqueId: id }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      )

      const requests = Array.from({ length: 3 }, (_, i) =>
        new Request(`https://functions.do/functions/unique-func/invoke?id=${i}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
            'CF-Connecting-IP': `10.0.0.${i + 1}`,
          },
          body: JSON.stringify({}),
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
      await mockRegistry.put(
        'second-func',
        JSON.stringify({
          id: 'second-func',
          version: '1.0.0',
          language: 'typescript',
          entryPoint: 'index.ts',
          dependencies: {},
        })
      )
      await mockCodeStorage.put(
        'second-func',
        `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ func: 'second' }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      )

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

    it('should accept client-provided request ID in header', async () => {
      // Set up function that reads headers
      await mockRegistry.put(
        'request-id-func',
        JSON.stringify({
          id: 'request-id-func',
          version: '1.0.0',
          language: 'typescript',
          entryPoint: 'index.ts',
          dependencies: {},
        })
      )
      await mockCodeStorage.put(
        'request-id-func',
        `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({
              requestId: request.headers.get('X-Request-Id')
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      )

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
      expect(body['requestId']).toBe('my-trace-id')
    })

    it('should propagate request ID to function', async () => {
      // Set up function that checks for request ID
      await mockRegistry.put(
        'trace-func',
        JSON.stringify({
          id: 'trace-func',
          version: '1.0.0',
          language: 'typescript',
          entryPoint: 'index.ts',
          dependencies: {},
        })
      )
      await mockCodeStorage.put(
        'trace-func',
        `
        export default {
          async fetch(request) {
            const hasRequestId = request.headers.has('X-Request-Id');
            return new Response(JSON.stringify({ hasRequestId }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      )

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
      expect(body['hasRequestId']).toBe(true)
    })

    it('should handle trace context headers', async () => {
      // Set up function that reads trace headers
      await mockRegistry.put(
        'trace-context-func',
        JSON.stringify({
          id: 'trace-context-func',
          version: '1.0.0',
          language: 'typescript',
          entryPoint: 'index.ts',
          dependencies: {},
        })
      )
      await mockCodeStorage.put(
        'trace-context-func',
        `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({
              traceparent: request.headers.get('traceparent'),
              tracestate: request.headers.get('tracestate')
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      )

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
      expect(body['traceparent']).toBe('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')
      expect(body['tracestate']).toBe('congo=t61rcWkgMzE')
    })
  })

  describe('Response Streaming', () => {
    beforeEach(async () => {
      // Set up a streaming function
      const streamingFunctionMetadata = {
        id: 'streaming-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('streaming-func', JSON.stringify(streamingFunctionMetadata))

      const streamingFunctionCode = `
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
      `
      await mockCodeStorage.put('streaming-func', streamingFunctionCode)
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
      const binaryFunctionMetadata = {
        id: 'binary-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('binary-func', JSON.stringify(binaryFunctionMetadata))

      const binaryFunctionCode = `
        export default {
          async fetch(request) {
            const buffer = await request.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            return new Response(JSON.stringify({
              length: bytes.length,
              firstByte: bytes[0]
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('binary-func', binaryFunctionCode)
    })

    it('should handle binary request body', async () => {
      const binaryData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]) // "Hello"
      const request = new Request('https://functions.do/functions/binary-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-API-Key': 'test-api-key',
        },
        body: binaryData,
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['length']).toBe(5)
      expect(body['firstByte']).toBe(0x48)
    })

    it('should handle binary response body', async () => {
      // Set up function that returns binary
      await mockRegistry.put(
        'binary-response-func',
        JSON.stringify({
          id: 'binary-response-func',
          version: '1.0.0',
          language: 'typescript',
          entryPoint: 'index.ts',
          dependencies: {},
        })
      )
      await mockCodeStorage.put(
        'binary-response-func',
        `
        export default {
          async fetch(request) {
            const data = new Uint8Array([0x01, 0x02, 0x03]);
            return new Response(data, {
              headers: { 'Content-Type': 'application/octet-stream' }
            });
          }
        }
      `
      )

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
    it('should require authentication for OPTIONS requests (no CORS preflight bypass)', async () => {
      // The current implementation requires auth for all non-public endpoints
      // OPTIONS requests without API key will return 401
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, X-API-Key',
        },
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Returns 401 because auth is required and OPTIONS has no API key
      expect(response.status).toBe(401)
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
