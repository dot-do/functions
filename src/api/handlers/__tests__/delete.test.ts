/**
 * Delete Handler Tests
 *
 * Tests for the function deletion handler including:
 * - Success cases (function deletion)
 * - Error handling (validation, not found)
 * - Authorization edge cases
 * - Edge cases
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { deleteHandler } from '../delete'
import type { Env, RouteContext } from '../../router'
import { createMockKV } from '../../../test-utils/mock-kv'

// Type for JSON response bodies
type JsonBody = Record<string, unknown>

describe('Delete Handler', () => {
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
   * Helper to set up a function in the registry and code storage
   */
  async function setupFunction(functionId: string, version = '1.0.0'): Promise<void> {
    const metadata = {
      id: functionId,
      version,
      language: 'typescript',
      entryPoint: 'index.ts',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await mockEnv.FUNCTIONS_REGISTRY.put(`registry:${functionId}`, JSON.stringify(metadata))
    await mockEnv.FUNCTIONS_CODE.put(`code:${functionId}`, 'export default {}')
    await mockEnv.FUNCTIONS_CODE.put(`code:${functionId}:v:${version}`, 'export default {}')
  }

  describe('success cases', () => {
    it('deletes function and returns success response', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/api/functions/my-function', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['success']).toBe(true)
      expect(body['id']).toBe('my-function')
      expect(body['message']).toBe('Function deleted')
    })

    it('removes function from registry after deletion', async () => {
      await setupFunction('delete-registry-test')

      const request = new Request('https://functions.do/api/functions/delete-registry-test', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: 'delete-registry-test' },
        functionId: 'delete-registry-test',
      }

      await deleteHandler(request, mockEnv, mockCtx, context)

      // Verify function is removed from registry
      const registryEntry = await mockEnv.FUNCTIONS_REGISTRY.get('registry:delete-registry-test')
      expect(registryEntry).toBeNull()
    })

    it('removes function code after deletion', async () => {
      await setupFunction('delete-code-test')

      const request = new Request('https://functions.do/api/functions/delete-code-test', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: 'delete-code-test' },
        functionId: 'delete-code-test',
      }

      await deleteHandler(request, mockEnv, mockCtx, context)

      // Verify code is removed
      const codeEntry = await mockEnv.FUNCTIONS_CODE.get('code:delete-code-test')
      expect(codeEntry).toBeNull()
    })

    it('sets Content-Type header to application/json', async () => {
      await setupFunction('content-type-test')

      const request = new Request('https://functions.do/api/functions/content-type-test', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: 'content-type-test' },
        functionId: 'content-type-test',
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('extracts function ID from context.params when functionId not set', async () => {
      await setupFunction('params-id-test')

      const request = new Request('https://functions.do/api/functions/params-id-test', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: 'params-id-test' },
        // functionId not set
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
    })
  })

  describe('error handling', () => {
    it('returns 400 when function ID is not provided', async () => {
      const request = new Request('https://functions.do/api/functions/', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: {},
        // No functionId
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toEqual({ code: 'MISSING_REQUIRED', message: 'Function ID required' })
    })

    it('returns 400 when context is undefined', async () => {
      const request = new Request('https://functions.do/api/functions/', {
        method: 'DELETE',
      })

      const response = await deleteHandler(request, mockEnv, mockCtx, undefined)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toEqual({ code: 'MISSING_REQUIRED', message: 'Function ID required' })
    })

    it('returns 404 when function does not exist', async () => {
      const request = new Request('https://functions.do/api/functions/nonexistent-function', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: 'nonexistent-function' },
        functionId: 'nonexistent-function',
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toEqual({ code: 'FUNCTION_NOT_FOUND', message: 'Function not found' })
    })

    it('returns 400 for invalid function ID format - empty string', async () => {
      const request = new Request('https://functions.do/api/functions/', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: '' },
        functionId: '',
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
    })

    it('returns 400 for invalid function ID format - starts with number', async () => {
      const request = new Request('https://functions.do/api/functions/123-invalid', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: '123-invalid' },
        functionId: '123-invalid',
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      const error = body['error'] as { code: string; message: string }
      expect(error.code).toBe('INVALID_FUNCTION_ID')
      expect(error.message).toContain('Invalid function ID')
    })

    it('returns 400 for invalid function ID format - special characters', async () => {
      const request = new Request('https://functions.do/api/functions/invalid@function', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: 'invalid@function' },
        functionId: 'invalid@function',
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      const error = body['error'] as { code: string; message: string }
      expect(error.code).toBe('INVALID_FUNCTION_ID')
      expect(error.message).toContain('Invalid function ID')
    })

    it('returns 400 for invalid function ID format - too long', async () => {
      const longId = 'a'.repeat(65)
      const request = new Request(`https://functions.do/api/functions/${longId}`, {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: longId },
        functionId: longId,
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      const error = body['error'] as { code: string; message: string }
      expect(error.code).toBe('INVALID_FUNCTION_ID')
      expect(error.message).toContain('Invalid function ID')
    })

    it('returns 400 for invalid function ID format - starts with hyphen', async () => {
      const request = new Request('https://functions.do/api/functions/-invalid-id', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: '-invalid-id' },
        functionId: '-invalid-id',
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
    })

    it('returns 400 for invalid function ID format - ends with hyphen', async () => {
      const request = new Request('https://functions.do/api/functions/invalid-id-', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: 'invalid-id-' },
        functionId: 'invalid-id-',
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
    })

    it('returns 400 for invalid function ID format - consecutive hyphens', async () => {
      const request = new Request('https://functions.do/api/functions/invalid--id', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: 'invalid--id' },
        functionId: 'invalid--id',
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
    })
  })

  describe('authorization edge cases', () => {
    it('does not require authorization header (handled by middleware)', async () => {
      await setupFunction('no-auth-test')

      const request = new Request('https://functions.do/api/functions/no-auth-test', {
        method: 'DELETE',
        // No Authorization header
      })
      const context: RouteContext = {
        params: { id: 'no-auth-test' },
        functionId: 'no-auth-test',
      }

      // Handler itself does not check auth - that's middleware responsibility
      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
    })

    it('ignores authorization header if provided', async () => {
      await setupFunction('with-auth-test')

      const request = new Request('https://functions.do/api/functions/with-auth-test', {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer some-token',
        },
      })
      const context: RouteContext = {
        params: { id: 'with-auth-test' },
        functionId: 'with-auth-test',
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
    })
  })

  describe('edge cases', () => {
    it('handles function with multiple versions', async () => {
      await setupFunction('multi-version-func', '1.0.0')
      // Add more versions
      await mockEnv.FUNCTIONS_CODE.put('code:multi-version-func:v:2.0.0', 'export default { v: 2 }')
      await mockEnv.FUNCTIONS_CODE.put('code:multi-version-func:v:3.0.0', 'export default { v: 3 }')

      const request = new Request('https://functions.do/api/functions/multi-version-func', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: 'multi-version-func' },
        functionId: 'multi-version-func',
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
    })

    it('handles valid function ID with underscores', async () => {
      await setupFunction('my_function_name')

      const request = new Request('https://functions.do/api/functions/my_function_name', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: 'my_function_name' },
        functionId: 'my_function_name',
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
    })

    it('handles valid function ID with mixed case', async () => {
      await setupFunction('MyFunction')

      const request = new Request('https://functions.do/api/functions/MyFunction', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: 'MyFunction' },
        functionId: 'MyFunction',
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
    })

    it('handles function ID at maximum valid length (64 chars)', async () => {
      const maxLengthId = 'a'.repeat(64)
      await setupFunction(maxLengthId)

      const request = new Request(`https://functions.do/api/functions/${maxLengthId}`, {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: maxLengthId },
        functionId: maxLengthId,
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
    })

    it('deletes function with compiled code and source maps', async () => {
      await setupFunction('compiled-func')
      // Add compiled code and source map
      await mockEnv.FUNCTIONS_CODE.put('code:compiled-func:compiled', 'compiled js code')
      await mockEnv.FUNCTIONS_CODE.put('code:compiled-func:map', '{"mappings": ""}')

      const request = new Request('https://functions.do/api/functions/compiled-func', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: 'compiled-func' },
        functionId: 'compiled-func',
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
    })

    it('is idempotent - calling delete twice on same function', async () => {
      await setupFunction('idempotent-test')

      const request = new Request('https://functions.do/api/functions/idempotent-test', {
        method: 'DELETE',
      })
      const context: RouteContext = {
        params: { id: 'idempotent-test' },
        functionId: 'idempotent-test',
      }

      // First delete
      const response1 = await deleteHandler(request, mockEnv, mockCtx, context)
      expect(response1.status).toBe(200)

      // Second delete should return 404
      const response2 = await deleteHandler(request, mockEnv, mockCtx, context)
      expect(response2.status).toBe(404)
    })

    it('handles request with body (should be ignored)', async () => {
      await setupFunction('body-test')

      const request = new Request('https://functions.do/api/functions/body-test', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extra: 'data' }),
      })
      const context: RouteContext = {
        params: { id: 'body-test' },
        functionId: 'body-test',
      }

      const response = await deleteHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
    })
  })
})
