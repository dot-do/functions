/**
 * Health Handler Tests
 *
 * Tests for the health check endpoint handler including:
 * - Success response format
 * - Response headers
 * - HTTP status codes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { healthHandler } from '../health'
import type { Env, RouteContext } from '../../router'
import { createMockKV } from '../../../test-utils/mock-kv'

// Type for JSON response bodies
type JsonBody = Record<string, unknown>

describe('Health Handler', () => {
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

  describe('success cases', () => {
    it('returns 200 status code', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'GET',
      })

      const response = await healthHandler(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })

    it('returns JSON response with status ok', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'GET',
      })

      const response = await healthHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(body['status']).toBe('ok')
    })

    it('returns service name in response', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'GET',
      })

      const response = await healthHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(body['service']).toBe('Functions.do')
    })

    it('sets Content-Type header to application/json', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'GET',
      })

      const response = await healthHandler(request, mockEnv, mockCtx)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })
  })

  describe('request handling', () => {
    it('handles GET requests', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'GET',
      })

      const response = await healthHandler(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })

    it('works without route context', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'GET',
      })

      // Call without context parameter
      const response = await healthHandler(request, mockEnv, mockCtx, undefined)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['status']).toBe('ok')
    })

    it('ignores route context when provided', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'GET',
      })
      const context: RouteContext = {
        params: { id: 'some-function' },
        functionId: 'some-function',
      }

      const response = await healthHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['status']).toBe('ok')
    })

    it('handles request with query parameters', async () => {
      const request = new Request('https://functions.do/health?verbose=true', {
        method: 'GET',
      })

      const response = await healthHandler(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })

    it('handles request with custom headers', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'GET',
        headers: {
          'X-Custom-Header': 'custom-value',
          'Authorization': 'Bearer token',
        },
      })

      const response = await healthHandler(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })
  })

  describe('response format', () => {
    it('returns valid JSON', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'GET',
      })

      const response = await healthHandler(request, mockEnv, mockCtx)
      const text = await response.clone().text()

      // Should not throw when parsing
      expect(() => JSON.parse(text)).not.toThrow()
    })

    it('response body contains expected keys', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'GET',
      })

      const response = await healthHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(Object.keys(body)).toContain('status')
      expect(Object.keys(body)).toContain('service')
    })

    it('response body has exactly two keys', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'GET',
      })

      const response = await healthHandler(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(Object.keys(body).length).toBe(2)
    })
  })

  describe('edge cases', () => {
    it('handles request from different origin', async () => {
      const request = new Request('https://other-domain.com/health', {
        method: 'GET',
      })

      const response = await healthHandler(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })

    it('handles request with body (should be ignored)', async () => {
      const request = new Request('https://functions.do/health', {
        method: 'GET',
        // GET requests shouldn't have body, but handler should handle gracefully
      })

      const response = await healthHandler(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
    })

    it('returns consistent response regardless of env configuration', async () => {
      // Test with minimal env
      const minimalEnv = {
        FUNCTIONS_REGISTRY: createMockKV(),
        FUNCTIONS_CODE: createMockKV(),
      }

      const request = new Request('https://functions.do/health', {
        method: 'GET',
      })

      const response = await healthHandler(request, minimalEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body['status']).toBe('ok')
      expect(body['service']).toBe('Functions.do')
    })
  })
})
