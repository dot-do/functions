/**
 * Update Handler Tests
 *
 * Tests for the function update endpoint handler including:
 * - Success cases (updating function metadata)
 * - Partial updates
 * - Validation (immutable fields, unknown fields, field types)
 * - Error handling (not found, invalid JSON)
 * - Response format validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { updateHandler } from '../update'
import type { Env, RouteContext } from '../../router'
import { createMockKV } from '../../../test-utils/mock-kv'

// Type for JSON response bodies
type JsonBody = Record<string, unknown>

describe('Update Handler', () => {
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
      type?: string
      name?: string
      description?: string
      tags?: string[]
      language?: string
      permissions?: Record<string, unknown>
    } = {}
  ): Promise<void> {
    const metadata = {
      id: functionId,
      version: options.version ?? '1.0.0',
      type: options.type ?? 'code',
      name: options.name ?? functionId,
      description: options.description,
      tags: options.tags,
      language: options.language ?? 'typescript',
      entryPoint: 'index.ts',
      permissions: options.permissions,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
    }
    await mockEnv.FUNCTIONS_REGISTRY.put(`registry:${functionId}`, JSON.stringify(metadata))
  }

  describe('success cases', () => {
    it('returns 200 status code on successful update', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
    })

    it('updates function name', async () => {
      await setupFunction('my-function', { name: 'Original Name' })

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(body['name']).toBe('Updated Name')
    })

    it('updates function description', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'New description' }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(body['description']).toBe('New description')
    })

    it('updates function tags', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: ['new-tag', 'another-tag'] }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(body['tags']).toEqual(['new-tag', 'another-tag'])
    })

    it('updates function permissions', async () => {
      await setupFunction('my-function')

      const permissions = {
        public: false,
        requiredScopes: ['read:functions'],
      }

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(body['permissions']).toEqual(permissions)
    })

    it('updates multiple fields at once', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Name',
          description: 'New Description',
          tags: ['tag1', 'tag2'],
        }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(body['name']).toBe('New Name')
      expect(body['description']).toBe('New Description')
      expect(body['tags']).toEqual(['tag1', 'tag2'])
    })

    it('preserves unchanged fields', async () => {
      await setupFunction('my-function', {
        name: 'Original Name',
        description: 'Original Description',
        tags: ['original-tag'],
      })

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(body['name']).toBe('New Name')
      expect(body['description']).toBe('Original Description')
      expect(body['tags']).toEqual(['original-tag'])
    })

    it('updates updatedAt timestamp', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(body['updatedAt']).not.toBe('2025-01-02T00:00:00.000Z')
    })

    it('preserves createdAt timestamp', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(body['createdAt']).toBe('2025-01-01T00:00:00.000Z')
    })

    it('sets Content-Type header to application/json', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('extracts function ID from context.params when functionId not set', async () => {
      await setupFunction('params-id-test')

      const request = new Request('https://functions.do/v1/api/functions/params-id-test', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      })
      const context: RouteContext = {
        params: { id: 'params-id-test' },
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
    })
  })

  describe('error handling', () => {
    it('returns 400 when function ID is not provided', async () => {
      const request = new Request('https://functions.do/v1/api/functions/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      })
      const context: RouteContext = {
        params: {},
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Function ID required')
    })

    it('returns 400 when context is undefined', async () => {
      const request = new Request('https://functions.do/v1/api/functions/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      })

      const response = await updateHandler(request, mockEnv, mockCtx, undefined)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Function ID required')
    })

    it('returns 400 for invalid function ID format', async () => {
      const request = new Request('https://functions.do/v1/api/functions/123-invalid', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      })
      const context: RouteContext = {
        params: { id: '123-invalid' },
        functionId: '123-invalid',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Invalid function ID')
    })

    it('returns 404 when function does not exist', async () => {
      const request = new Request('https://functions.do/v1/api/functions/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      })
      const context: RouteContext = {
        params: { id: 'nonexistent' },
        functionId: 'nonexistent',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Function not found')
    })

    it('returns 400 for invalid JSON body', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Invalid JSON body')
    })

    it('returns 400 when body is not an object', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(['array', 'instead', 'of', 'object']),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Request body must be a JSON object')
    })

    it('returns 400 for empty update body', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('No fields provided for update')
    })
  })

  describe('immutable field protection', () => {
    it('rejects attempt to update id', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'new-id' }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Cannot update immutable fields')
      expect(body['error']).toContain('id')
    })

    it('rejects attempt to update version', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: '2.0.0' }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Cannot update immutable fields')
    })

    it('rejects attempt to update type', async () => {
      await setupFunction('my-function', { type: 'code' })

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'generative' }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Cannot update immutable fields')
    })

    it('rejects attempt to update createdAt', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createdAt: '2020-01-01T00:00:00.000Z' }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Cannot update immutable fields')
    })

    it('rejects attempt to update language', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'javascript' }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Cannot update immutable fields')
    })
  })

  describe('unknown field handling', () => {
    it('rejects unknown fields', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unknownField: 'value' }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Unknown fields')
      expect(body['error']).toContain('unknownField')
    })
  })

  describe('field type validation', () => {
    it('rejects non-string name', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 123 }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Field "name" must be a string')
    })

    it('rejects non-string description', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: { nested: 'object' } }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Field "description" must be a string')
    })

    it('rejects non-array tags', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: 'not-an-array' }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Field "tags" must be an array')
    })

    it('rejects non-string elements in tags array', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: ['valid', 123, 'also-valid'] }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Field "tags[1]" must be a string')
    })

    it('rejects non-object permissions', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: 'not-an-object' }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBe('Field "permissions" must be an object')
    })
  })

  describe('response format', () => {
    it('returns valid JSON', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)
      const text = await response.clone().text()

      expect(() => JSON.parse(text)).not.toThrow()
    })

    it('response body contains expected keys', async () => {
      await setupFunction('my-function')

      const request = new Request('https://functions.do/v1/api/functions/my-function', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      })
      const context: RouteContext = {
        params: { id: 'my-function' },
        functionId: 'my-function',
      }

      const response = await updateHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(Object.keys(body)).toContain('id')
      expect(Object.keys(body)).toContain('version')
      expect(Object.keys(body)).toContain('type')
      expect(Object.keys(body)).toContain('createdAt')
      expect(Object.keys(body)).toContain('updatedAt')
    })
  })
})
