/**
 * Info Handler Tests
 *
 * Tests for the function info endpoint handler including:
 * - Success cases (returning function metadata)
 * - Error handling (validation, not found, missing ID)
 * - Authorization edge cases
 * - Response format validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { infoHandler } from '../info'
import type { Env, RouteContext } from '../../router'
import { createMockKV } from '../../../test-utils/mock-kv'

// Type for JSON response bodies
type JsonBody = Record<string, unknown>

describe('Info Handler', () => {
  let mockEnv: Env
  let mockCtx: ExecutionContext

  beforeEach(() => {
    mockEnv = {
      FUNCTIONS_REGISTRY: createMockKV(),
      FUNCTIONS_CODE: createMockKV(),
    }
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext
  })

  /**
   * Helper to set up a function in the registry
   */
  async function setupFunction(
    functionId: string,
    options: {
      version?: string
      language?: string
      entryPoint?: string
      createdAt?: string
      updatedAt?: string
    } = {}
  ): Promise<void> {
    const metadata = {
      id: functionId,
      version: options.version ?? '1.0.0',
      language: options.language ?? 'typescript',
      entryPoint: options.entryPoint ?? 'index.ts',
      createdAt: options.createdAt ?? '2025-01-01T00:00:00.000Z',
      updatedAt: options.updatedAt ?? '2025-01-02T00:00:00.000Z',
    }
    await mockEnv.FUNCTIONS_REGISTRY.put(`registry:${functionId}`, JSON.stringify(metadata))
  }

  describe('success cases', () => {
    it('returns 200 status code for existing function', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
    })

    it('returns function metadata in response body', async () => {
      await setupFunction('my-function', {
        version: '2.0.0',
        language: 'typescript',
        entryPoint: 'main.ts',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-15T12:00:00.000Z',
      })

      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(body['id']).toBe('my-function')
      expect(body['version']).toBe('2.0.0')
      expect(body['language']).toBe('typescript')
      expect(body['entryPoint']).toBe('main.ts')
      expect(body['status']).toBe('available')
      expect(body['createdAt']).toBe('2025-01-01T00:00:00.000Z')
      expect(body['updatedAt']).toBe('2025-01-15T12:00:00.000Z')
    })

    it('always returns status as available', async () => {
      await setupFunction('status-test')

      const request = new Request('https://functions.do/api/functions/status-test', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'status-test' },
        functionId: 'status-test',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(body['status']).toBe('available')
    })

    it('sets Content-Type header to application/json', async () => {
      await setupFunction('content-type-test')

      const request = new Request('https://functions.do/api/functions/content-type-test', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'content-type-test' },
        functionId: 'content-type-test',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('extracts function ID from context.params when functionId not set', async () => {
      await setupFunction('params-id-test')

      const request = new Request('https://functions.do/api/functions/params-id-test', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'params-id-test' },
        // functionId not set
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('params-id-test')
    })

    it('prefers functionId over params.id when both are set', async () => {
      await setupFunction('preferred-id')

      const request = new Request('https://functions.do/api/functions/preferred-id', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'other-id' },
        functionId: 'preferred-id',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('preferred-id')
    })

    it('returns metadata for javascript function', async () => {
      await setupFunction('js-function', {
        language: 'javascript',
        entryPoint: 'index.js',
      })

      const request = new Request('https://functions.do/api/functions/js-function', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'js-function' },
        functionId: 'js-function',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(body['language']).toBe('javascript')
      expect(body['entryPoint']).toBe('index.js')
    })
  })

  describe('error handling', () => {
    it('returns 400 when function ID is not provided', async () => {
      const request = new Request('https://functions.do/api/functions/', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: {},
        // No functionId
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toEqual({ code: 'MISSING_REQUIRED', message: 'Function ID required' })
    })

    it('returns 400 when context is undefined', async () => {
      const request = new Request('https://functions.do/api/functions/', {
        method: 'GET',
      })

      const response = await infoHandler(request, mockEnv, mockCtx, undefined)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toEqual({ code: 'MISSING_REQUIRED', message: 'Function ID required' })
    })

    it('returns 404 when function does not exist', async () => {
      const request = new Request('https://functions.do/api/functions/nonexistent-function', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'nonexistent-function' },
        functionId: 'nonexistent-function',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toEqual({ code: 'FUNCTION_NOT_FOUND', message: 'Function not found: nonexistent-function' })
    })

    it('returns 404 with function ID in error message', async () => {
      const request = new Request('https://functions.do/api/functions/specific-missing-func', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'specific-missing-func' },
        functionId: 'specific-missing-func',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      const error = body['error'] as { code: string; message: string }
      expect(error.message).toContain('specific-missing-func')
    })

    it('returns 400 for invalid function ID format - starts with number', async () => {
      const request = new Request('https://functions.do/api/functions/123-invalid', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: '123-invalid' },
        functionId: '123-invalid',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      const error = body['error'] as { code: string; message: string }
      expect(error.code).toBe('INVALID_FUNCTION_ID')
      expect(error.message).toContain('Invalid function ID')
    })

    it('returns 400 for invalid function ID format - special characters', async () => {
      const request = new Request('https://functions.do/api/functions/invalid@function', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'invalid@function' },
        functionId: 'invalid@function',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      const error = body['error'] as { code: string; message: string }
      expect(error.code).toBe('INVALID_FUNCTION_ID')
      expect(error.message).toContain('Invalid function ID')
    })

    it('returns 400 for invalid function ID format - too long', async () => {
      const longId = 'a'.repeat(65)
      const request = new Request(`https://functions.do/api/functions/${longId}`, {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: longId },
        functionId: longId,
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      const error = body['error'] as { code: string; message: string }
      expect(error.code).toBe('INVALID_FUNCTION_ID')
      expect(error.message).toContain('Invalid function ID')
    })

    it('returns 400 for invalid function ID format - starts with hyphen', async () => {
      const request = new Request('https://functions.do/api/functions/-invalid-id', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: '-invalid-id' },
        functionId: '-invalid-id',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
    })

    it('returns 400 for invalid function ID format - ends with hyphen', async () => {
      const request = new Request('https://functions.do/api/functions/invalid-id-', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'invalid-id-' },
        functionId: 'invalid-id-',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
    })

    it('returns 400 for invalid function ID format - consecutive hyphens', async () => {
      const request = new Request('https://functions.do/api/functions/invalid--id', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'invalid--id' },
        functionId: 'invalid--id',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
    })

    it('returns 400 for empty string function ID', async () => {
      const request = new Request('https://functions.do/api/functions/', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: '' },
        functionId: '',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
    })
  })

  describe('authorization edge cases', () => {
    it('does not require authorization header (handled by middleware)', async () => {
      await setupFunction('no-auth-test')

      const request = new Request('https://functions.do/api/functions/no-auth-test', {
        method: 'GET',
        // No Authorization header
      })
      const context: RouteContext = {
        params: { id: 'no-auth-test' },
        functionId: 'no-auth-test',
      }

      // Handler itself does not check auth - that's middleware responsibility
      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
    })

    it('ignores authorization header if provided', async () => {
      await setupFunction('with-auth-test')

      const request = new Request('https://functions.do/api/functions/with-auth-test', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer some-token',
        },
      })
      const context: RouteContext = {
        params: { id: 'with-auth-test' },
        functionId: 'with-auth-test',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('with-auth-test')
    })
  })

  describe('response format', () => {
    it('returns valid JSON', async () => {
      await setupFunction('json-test')

      const request = new Request('https://functions.do/api/functions/json-test', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'json-test' },
        functionId: 'json-test',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)
      const text = await response.clone().text()

      // Should not throw when parsing
      expect(() => JSON.parse(text)).not.toThrow()
    })

    it('response body contains expected keys', async () => {
      await setupFunction('keys-test')

      const request = new Request('https://functions.do/api/functions/keys-test', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'keys-test' },
        functionId: 'keys-test',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(Object.keys(body)).toContain('id')
      expect(Object.keys(body)).toContain('version')
      expect(Object.keys(body)).toContain('language')
      expect(Object.keys(body)).toContain('entryPoint')
      expect(Object.keys(body)).toContain('status')
      expect(Object.keys(body)).toContain('createdAt')
      expect(Object.keys(body)).toContain('updatedAt')
    })

    it('response body has exactly seven keys', async () => {
      await setupFunction('key-count-test')

      const request = new Request('https://functions.do/api/functions/key-count-test', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'key-count-test' },
        functionId: 'key-count-test',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(Object.keys(body).length).toBe(7)
    })

    it('error response contains error key', async () => {
      const request = new Request('https://functions.do/api/functions/', {
        method: 'GET',
      })

      const response = await infoHandler(request, mockEnv, mockCtx, undefined)
      const body = (await response.json()) as JsonBody

      expect(Object.keys(body)).toContain('error')
    })
  })

  describe('edge cases', () => {
    it('handles valid function ID with underscores', async () => {
      await setupFunction('my_function_name')

      const request = new Request('https://functions.do/api/functions/my_function_name', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'my_function_name' },
        functionId: 'my_function_name',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('my_function_name')
    })

    it('handles valid function ID with mixed case', async () => {
      await setupFunction('MyFunction')

      const request = new Request('https://functions.do/api/functions/MyFunction', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'MyFunction' },
        functionId: 'MyFunction',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('MyFunction')
    })

    it('handles function ID at maximum valid length (64 chars)', async () => {
      const maxLengthId = 'a'.repeat(64)
      await setupFunction(maxLengthId)

      const request = new Request(`https://functions.do/api/functions/${maxLengthId}`, {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: maxLengthId },
        functionId: maxLengthId,
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
    })

    it('handles request with query parameters', async () => {
      await setupFunction('query-test')

      const request = new Request('https://functions.do/api/functions/query-test?verbose=true', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'query-test' },
        functionId: 'query-test',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
    })

    it('handles request with custom headers', async () => {
      await setupFunction('headers-test')

      const request = new Request('https://functions.do/api/functions/headers-test', {
        method: 'GET',
        headers: {
          'X-Custom-Header': 'custom-value',
        },
      })
      const context: RouteContext = {
        params: { id: 'headers-test' },
        functionId: 'headers-test',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
    })

    it('handles request from different origin', async () => {
      await setupFunction('origin-test')

      const request = new Request('https://other-domain.com/api/functions/origin-test', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'origin-test' },
        functionId: 'origin-test',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
    })

    it('does not return extra metadata fields beyond the defined set', async () => {
      // Store metadata with extra fields
      const metadata = {
        id: 'extra-fields-test',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
        extraField: 'should-not-appear',
        secretKey: 'should-not-leak',
      }
      await mockEnv.FUNCTIONS_REGISTRY.put('registry:extra-fields-test', JSON.stringify(metadata))

      const request = new Request('https://functions.do/api/functions/extra-fields-test', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'extra-fields-test' },
        functionId: 'extra-fields-test',
      }

      const response = await infoHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(body['extraField']).toBeUndefined()
      expect(body['secretKey']).toBeUndefined()
      expect(Object.keys(body).length).toBe(7)
    })
  })
})
