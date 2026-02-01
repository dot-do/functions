/**
 * Index Router Integration Tests
 *
 * Tests that verify index.ts properly delegates to the API router
 * while maintaining backward compatibility with existing API.
 *
 * This follows TDD - these tests define the expected behavior for the refactor.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockKV } from '../test-utils/mock-kv'
import type { Env } from '../index'

// Import the worker and reset function
import worker, { resetRateLimiter } from '../index'

type JsonBody = Record<string, unknown>

describe('Index Router Integration', () => {
  let mockEnv: Env
  let mockCtx: ExecutionContext

  beforeEach(async () => {
    resetRateLimiter()

    const mockRegistry = createMockKV()
    const mockCodeStorage = createMockKV()

    mockEnv = {
      FUNCTIONS_REGISTRY: mockRegistry,
      FUNCTIONS_CODE: mockCodeStorage,
    } as Env

    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext

    // Set up a test function
    const testMetadata = {
      id: 'test-func',
      version: '1.0.0',
      language: 'typescript',
      entryPoint: 'index.ts',
      dependencies: {},
    }
    await mockRegistry.put('registry:test-func', JSON.stringify(testMetadata))
    await mockCodeStorage.put(
      'code:test-func',
      `export default {
        async fetch(request) {
          return new Response(JSON.stringify({ message: 'Hello from test-func' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }`
    )
  })

  afterEach(() => {
    resetRateLimiter()
  })

  describe('Health endpoints (delegated to router)', () => {
    it('GET / returns health status', async () => {
      const request = new Request('https://functions.do/')
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body.status).toBe('ok')
      expect(body.service).toBe('Functions.do')
    })

    it('GET /health returns health status', async () => {
      const request = new Request('https://functions.do/health')
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body.status).toBe('ok')
      expect(body.service).toBe('Functions.do')
    })
  })

  describe('Function info endpoint (delegated to router)', () => {
    it('GET /api/functions/:id returns function info', async () => {
      const request = new Request('https://functions.do/api/functions/test-func')
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body.id).toBe('test-func')
    })

    it('GET /api/functions/:id returns 404 for missing function', async () => {
      const request = new Request('https://functions.do/api/functions/non-existent')
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
    })
  })

  describe('Function deploy endpoint (delegated to router)', () => {
    it('POST /api/functions deploys a function', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'new-func',
          version: '1.0.0',
          language: 'javascript',
          code: 'export default { fetch() { return new Response("ok"); } }',
        }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Should either succeed or return validation error
      expect([200, 201, 400]).toContain(response.status)
    })

    it('POST /api/functions returns 400 for missing fields', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'incomplete' }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body.error).toBeDefined()
    })
  })

  describe('Function delete endpoint (delegated to router)', () => {
    it('DELETE /api/functions/:id deletes a function', async () => {
      const request = new Request('https://functions.do/api/functions/test-func', {
        method: 'DELETE',
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body.success).toBe(true)
    })

    it('DELETE /api/functions/:id returns 404 for missing function', async () => {
      const request = new Request('https://functions.do/api/functions/non-existent', {
        method: 'DELETE',
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
    })
  })

  describe('Function logs endpoint (delegated to router)', () => {
    it('GET /api/functions/:id/logs returns 503 when FUNCTION_LOGS not configured', async () => {
      const request = new Request('https://functions.do/api/functions/test-func/logs')
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(503)
      const body = (await response.json()) as JsonBody
      expect(body.error).toContain('not configured')
    })
  })

  describe('Function invoke endpoint (delegated to router)', () => {
    it('POST /functions/:id invokes a function', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      // 501 expected when LOADER/USER_FUNCTIONS not configured
      expect([200, 501]).toContain(response.status)
    })

    it('POST /functions/:id/invoke invokes a function', async () => {
      const request = new Request('https://functions.do/functions/test-func/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      // 501 expected when LOADER/USER_FUNCTIONS not configured
      expect([200, 501]).toContain(response.status)
    })

    it('POST /functions/:id returns 404 for missing function', async () => {
      const request = new Request('https://functions.do/functions/non-existent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
    })
  })

  describe('Legacy function info endpoint (backward compatibility)', () => {
    it('GET /functions/:id returns function info', async () => {
      const request = new Request('https://functions.do/functions/test-func', {
        method: 'GET',
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body.id).toBe('test-func')
    })

    it('GET /functions/:id/info returns function info', async () => {
      const request = new Request('https://functions.do/functions/test-func/info', {
        method: 'GET',
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body.id).toBe('test-func')
    })
  })

  describe('Error handling', () => {
    it('returns 404 for unknown routes', async () => {
      const request = new Request('https://functions.do/unknown/path', {
        method: 'GET',
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      expect(body.error).toBeDefined()
    })

    it('returns 405 for unsupported methods on known routes', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'DELETE',
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(405)
    })
  })

  describe('JSON response format', () => {
    it('all responses have JSON content-type', async () => {
      const request = new Request('https://functions.do/health')
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('error responses have JSON content-type', async () => {
      const request = new Request('https://functions.do/unknown')
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })
  })
})
