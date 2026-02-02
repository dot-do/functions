/**
 * List Handler Tests
 *
 * Tests for the function list endpoint handler including:
 * - Success cases (returning paginated function lists)
 * - Pagination (cursor, limit)
 * - Type filtering
 * - Error handling
 * - Response format validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { listHandler } from '../list'
import type { Env, RouteContext } from '../../router'
import { createMockKV } from '../../../test-utils/mock-kv'

// Type for JSON response bodies
type JsonBody = Record<string, unknown>

describe('List Handler', () => {
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
   * Helper to set up functions in the registry
   */
  async function setupFunctions(
    functions: Array<{
      id: string
      version?: string
      type?: string
      name?: string
      description?: string
      tags?: string[]
      language?: string
    }>
  ): Promise<void> {
    for (const fn of functions) {
      const metadata = {
        id: fn.id,
        version: fn.version ?? '1.0.0',
        type: fn.type,
        name: fn.name ?? fn.id,
        description: fn.description,
        tags: fn.tags,
        language: fn.language ?? 'typescript',
        entryPoint: 'index.ts',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
      }
      await mockEnv.FUNCTIONS_REGISTRY.put(`registry:${fn.id}`, JSON.stringify(metadata))
    }
  }

  describe('success cases', () => {
    it('returns 200 status code with empty list when no functions exist', async () => {
      const request = new Request('https://functions.do/v1/api/functions', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['functions']).toEqual([])
      expect(body['hasMore']).toBe(false)
    })

    it('returns list of functions', async () => {
      await setupFunctions([
        { id: 'function-a', name: 'Function A' },
        { id: 'function-b', name: 'Function B' },
      ])

      const request = new Request('https://functions.do/v1/api/functions', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      const functions = body['functions'] as Array<JsonBody>
      expect(functions.length).toBe(2)
      expect(functions.map((f) => f['id'])).toContain('function-a')
      expect(functions.map((f) => f['id'])).toContain('function-b')
    })

    it('returns function metadata in correct format', async () => {
      await setupFunctions([
        {
          id: 'my-function',
          version: '2.0.0',
          type: 'code',
          name: 'My Function',
          description: 'A test function',
          tags: ['test', 'example'],
          language: 'typescript',
        },
      ])

      const request = new Request('https://functions.do/v1/api/functions', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody
      const functions = body['functions'] as Array<JsonBody>
      const fn = functions[0]!

      expect(fn['id']).toBe('my-function')
      expect(fn['version']).toBe('2.0.0')
      expect(fn['type']).toBe('code')
      expect(fn['name']).toBe('My Function')
      expect(fn['description']).toBe('A test function')
      expect(fn['tags']).toEqual(['test', 'example'])
      expect(fn['language']).toBe('typescript')
      expect(fn['createdAt']).toBeDefined()
      expect(fn['updatedAt']).toBeDefined()
    })

    it('sets Content-Type header to application/json', async () => {
      const request = new Request('https://functions.do/v1/api/functions', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('defaults function type to code when not set', async () => {
      await setupFunctions([{ id: 'legacy-function' }])

      const request = new Request('https://functions.do/v1/api/functions', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody
      const functions = body['functions'] as Array<JsonBody>

      expect(functions[0]!['type']).toBe('code')
    })
  })

  describe('pagination', () => {
    it('respects limit parameter', async () => {
      await setupFunctions([
        { id: 'function-1' },
        { id: 'function-2' },
        { id: 'function-3' },
        { id: 'function-4' },
        { id: 'function-5' },
      ])

      const request = new Request('https://functions.do/v1/api/functions?limit=2', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody
      const functions = body['functions'] as Array<JsonBody>

      expect(functions.length).toBe(2)
      expect(body['hasMore']).toBe(true)
      expect(body['cursor']).toBeDefined()
    })

    it('returns cursor for next page', async () => {
      await setupFunctions([
        { id: 'function-1' },
        { id: 'function-2' },
        { id: 'function-3' },
      ])

      const request = new Request('https://functions.do/v1/api/functions?limit=2', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(body['cursor']).toBe('2')
      expect(body['hasMore']).toBe(true)
    })

    it('uses cursor parameter for pagination', async () => {
      await setupFunctions([
        { id: 'function-1' },
        { id: 'function-2' },
        { id: 'function-3' },
        { id: 'function-4' },
      ])

      const request = new Request('https://functions.do/v1/api/functions?limit=2&cursor=2', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody
      const functions = body['functions'] as Array<JsonBody>

      expect(functions.length).toBe(2)
    })

    it('does not include cursor when no more results', async () => {
      await setupFunctions([{ id: 'function-1' }])

      const request = new Request('https://functions.do/v1/api/functions', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(body['hasMore']).toBe(false)
      expect(body['cursor']).toBeUndefined()
    })

    it('caps limit at maximum value (100)', async () => {
      const functions = Array.from({ length: 50 }, (_, i) => ({ id: `function-${i}` }))
      await setupFunctions(functions)

      const request = new Request('https://functions.do/v1/api/functions?limit=200', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody
      const returnedFunctions = body['functions'] as Array<JsonBody>

      // Should be capped at 100 but we only have 50
      expect(returnedFunctions.length).toBe(50)
    })

    it('uses default limit when not specified', async () => {
      const functions = Array.from({ length: 25 }, (_, i) => ({ id: `function-${i}` }))
      await setupFunctions(functions)

      const request = new Request('https://functions.do/v1/api/functions', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody
      const returnedFunctions = body['functions'] as Array<JsonBody>

      // Default limit is 20
      expect(returnedFunctions.length).toBe(20)
      expect(body['hasMore']).toBe(true)
    })
  })

  describe('type filtering', () => {
    beforeEach(async () => {
      await setupFunctions([
        { id: 'code-fn', type: 'code' },
        { id: 'generative-fn', type: 'generative' },
        { id: 'agentic-fn', type: 'agentic' },
        { id: 'human-fn', type: 'human' },
        { id: 'legacy-fn' }, // no type, defaults to 'code'
      ])
    })

    it('filters by type=code', async () => {
      const request = new Request('https://functions.do/v1/api/functions?type=code', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody
      const functions = body['functions'] as Array<JsonBody>

      expect(functions.length).toBe(2) // code-fn and legacy-fn
      expect(functions.every((f) => f['type'] === 'code')).toBe(true)
    })

    it('filters by type=generative', async () => {
      const request = new Request('https://functions.do/v1/api/functions?type=generative', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody
      const functions = body['functions'] as Array<JsonBody>

      expect(functions.length).toBe(1)
      expect(functions[0]!['id']).toBe('generative-fn')
    })

    it('filters by type=agentic', async () => {
      const request = new Request('https://functions.do/v1/api/functions?type=agentic', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody
      const functions = body['functions'] as Array<JsonBody>

      expect(functions.length).toBe(1)
      expect(functions[0]!['id']).toBe('agentic-fn')
    })

    it('filters by type=human', async () => {
      const request = new Request('https://functions.do/v1/api/functions?type=human', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody
      const functions = body['functions'] as Array<JsonBody>

      expect(functions.length).toBe(1)
      expect(functions[0]!['id']).toBe('human-fn')
    })
  })

  describe('error handling', () => {
    it('returns 400 for invalid limit parameter', async () => {
      const request = new Request('https://functions.do/v1/api/functions?limit=invalid', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Invalid limit parameter')
    })

    it('returns 400 for negative limit', async () => {
      const request = new Request('https://functions.do/v1/api/functions?limit=-5', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Invalid limit parameter')
    })

    it('returns 400 for zero limit', async () => {
      const request = new Request('https://functions.do/v1/api/functions?limit=0', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Invalid limit parameter')
    })

    it('returns 400 for invalid type filter', async () => {
      const request = new Request('https://functions.do/v1/api/functions?type=invalid', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toContain('Invalid type parameter')
    })
  })

  describe('response format', () => {
    it('returns valid JSON', async () => {
      const request = new Request('https://functions.do/v1/api/functions', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)
      const text = await response.clone().text()

      expect(() => JSON.parse(text)).not.toThrow()
    })

    it('response body contains expected keys', async () => {
      const request = new Request('https://functions.do/v1/api/functions', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(Object.keys(body)).toContain('functions')
      expect(Object.keys(body)).toContain('hasMore')
    })

    it('does not expose sensitive internal fields', async () => {
      // Store metadata with internal fields
      const metadata = {
        id: 'test-function',
        version: '1.0.0',
        type: 'code',
        language: 'typescript',
        entryPoint: 'index.ts',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
        // Internal fields that should not be exposed
        dependencies: { lodash: '4.0.0' },
        code: 'export default {}',
        systemPrompt: 'secret prompt',
      }
      await mockEnv.FUNCTIONS_REGISTRY.put('registry:test-function', JSON.stringify(metadata))

      const request = new Request('https://functions.do/v1/api/functions', {
        method: 'GET',
      })

      const response = await listHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody
      const functions = body['functions'] as Array<JsonBody>
      const fn = functions[0]!

      expect(fn['dependencies']).toBeUndefined()
      expect(fn['code']).toBeUndefined()
      expect(fn['systemPrompt']).toBeUndefined()
    })
  })
})
