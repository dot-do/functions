/**
 * HTTP Utils Tests - RED Phase
 *
 * Tests for shared HTTP utility functions including:
 * - jsonResponse helper for creating JSON Response objects
 *
 * These tests verify the jsonResponse function that will be extracted
 * from multiple files into a shared utility.
 */

import { describe, it, expect } from 'vitest'

// Import from the shared utility that doesn't exist yet (RED phase)
import { jsonResponse } from '../http-utils'

describe('jsonResponse', () => {
  describe('basic functionality', () => {
    it('should return a Response object', () => {
      const response = jsonResponse({ message: 'test' })

      expect(response).toBeInstanceOf(Response)
    })

    it('should set Content-Type to application/json', async () => {
      const response = jsonResponse({ foo: 'bar' })

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('should stringify the body correctly', async () => {
      const data = { name: 'test', value: 123 }
      const response = jsonResponse(data)

      const body = await response.json()
      expect(body).toEqual(data)
    })

    it('should default to status 200', () => {
      const response = jsonResponse({ ok: true })

      expect(response.status).toBe(200)
    })
  })

  describe('custom status codes', () => {
    it('should handle 201 Created', () => {
      const response = jsonResponse({ id: 'new-resource' }, 201)

      expect(response.status).toBe(201)
    })

    it('should handle 400 Bad Request', () => {
      const response = jsonResponse({ error: 'Invalid input' }, 400)

      expect(response.status).toBe(400)
    })

    it('should handle 401 Unauthorized', () => {
      const response = jsonResponse({ error: 'Not authenticated' }, 401)

      expect(response.status).toBe(401)
    })

    it('should handle 403 Forbidden', () => {
      const response = jsonResponse({ error: 'Access denied' }, 403)

      expect(response.status).toBe(403)
    })

    it('should handle 404 Not Found', () => {
      const response = jsonResponse({ error: 'Resource not found' }, 404)

      expect(response.status).toBe(404)
    })

    it('should handle 429 Too Many Requests', () => {
      const response = jsonResponse({ error: 'Rate limited' }, 429)

      expect(response.status).toBe(429)
    })

    it('should handle 500 Internal Server Error', () => {
      const response = jsonResponse({ error: 'Server error' }, 500)

      expect(response.status).toBe(500)
    })

    it('should handle 503 Service Unavailable', () => {
      const response = jsonResponse({ error: 'Service unavailable' }, 503)

      expect(response.status).toBe(503)
    })
  })

  describe('custom headers', () => {
    it('should merge custom headers with Content-Type', () => {
      const response = jsonResponse(
        { data: 'test' },
        200,
        { 'X-Custom-Header': 'custom-value' }
      )

      expect(response.headers.get('Content-Type')).toBe('application/json')
      expect(response.headers.get('X-Custom-Header')).toBe('custom-value')
    })

    it('should support Retry-After header', () => {
      const response = jsonResponse(
        { error: 'Too many requests' },
        429,
        { 'Retry-After': '60' }
      )

      expect(response.headers.get('Retry-After')).toBe('60')
    })

    it('should support WWW-Authenticate header', () => {
      const response = jsonResponse(
        { error: 'Unauthorized' },
        401,
        { 'WWW-Authenticate': 'Bearer realm="Functions.do"' }
      )

      expect(response.headers.get('WWW-Authenticate')).toBe('Bearer realm="Functions.do"')
    })

    it('should support X-Execution-Time header', () => {
      const response = jsonResponse(
        { result: 'success' },
        200,
        { 'X-Execution-Time': '150' }
      )

      expect(response.headers.get('X-Execution-Time')).toBe('150')
    })

    it('should support multiple custom headers', () => {
      const response = jsonResponse(
        { data: 'test' },
        200,
        {
          'X-Request-ID': 'req-123',
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': '95',
        }
      )

      expect(response.headers.get('X-Request-ID')).toBe('req-123')
      expect(response.headers.get('X-RateLimit-Limit')).toBe('100')
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('95')
    })

    it('should not override Content-Type with custom headers', () => {
      // Content-Type should always be application/json for this helper
      const response = jsonResponse(
        { data: 'test' },
        200,
        { 'Content-Type': 'text/plain' }
      )

      // The implementation should use spread order that preserves application/json
      // or simply always set Content-Type to application/json
      expect(response.headers.get('Content-Type')).toBe('application/json')
    })
  })

  describe('data serialization', () => {
    it('should handle null values', async () => {
      const response = jsonResponse(null)
      const body = await response.text()

      expect(body).toBe('null')
    })

    it('should handle arrays', async () => {
      const data = [1, 2, 3, 'four', { five: 5 }]
      const response = jsonResponse(data)
      const body = await response.json()

      expect(body).toEqual(data)
    })

    it('should handle nested objects', async () => {
      const data = {
        level1: {
          level2: {
            level3: {
              value: 'deep'
            }
          }
        }
      }
      const response = jsonResponse(data)
      const body = await response.json()

      expect(body).toEqual(data)
    })

    it('should handle boolean values', async () => {
      const response = jsonResponse({ success: true, failed: false })
      const body = await response.json() as { success: boolean; failed: boolean }

      expect(body.success).toBe(true)
      expect(body.failed).toBe(false)
    })

    it('should handle numeric values', async () => {
      const data = { integer: 42, float: 3.14, negative: -100 }
      const response = jsonResponse(data)
      const body = await response.json()

      expect(body).toEqual(data)
    })

    it('should handle empty objects', async () => {
      const response = jsonResponse({})
      const body = await response.json()

      expect(body).toEqual({})
    })

    it('should handle empty arrays', async () => {
      const response = jsonResponse([])
      const body = await response.json()

      expect(body).toEqual([])
    })

    it('should handle strings', async () => {
      const response = jsonResponse('plain string')
      const body = await response.text()

      expect(body).toBe('"plain string"')
    })

    it('should handle numbers', async () => {
      const response = jsonResponse(42)
      const body = await response.text()

      expect(body).toBe('42')
    })
  })

  describe('error response patterns', () => {
    it('should create standard error response', async () => {
      const response = jsonResponse({ error: 'Something went wrong' }, 500)
      const body = await response.json() as { error: string }

      expect(response.status).toBe(500)
      expect(body.error).toBe('Something went wrong')
    })

    it('should create validation error response', async () => {
      const response = jsonResponse(
        {
          error: 'Validation failed',
          details: [
            { field: 'name', message: 'Required' },
            { field: 'version', message: 'Invalid format' }
          ]
        },
        400
      )
      const body = await response.json() as {
        error: string
        details: Array<{ field: string; message: string }>
      }

      expect(response.status).toBe(400)
      expect(body.details).toHaveLength(2)
    })

    it('should create rate limit error response', async () => {
      const response = jsonResponse(
        {
          error: 'Too Many Requests',
          retryAfter: 30,
          resetAt: Date.now() + 30000
        },
        429,
        { 'Retry-After': '30' }
      )
      const body = await response.json() as {
        error: string
        retryAfter: number
        resetAt: number
      }

      expect(response.status).toBe(429)
      expect(body.retryAfter).toBe(30)
      expect(response.headers.get('Retry-After')).toBe('30')
    })
  })
})
