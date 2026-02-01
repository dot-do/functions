/**
 * FunctionClient SDK Tests
 *
 * Additional tests for the FunctionClient SDK focusing on:
 * - invoke method edge cases
 * - deploy method edge cases
 * - Error handling and error classes
 * - Auth caching behavior
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  FunctionClient,
  FunctionClientConfig,
  FunctionMetadata,
  FunctionClientError,
  FunctionErrorCode,
  NetworkError,
  TimeoutError,
  RateLimitError,
  ValidationError,
  ExecutionError,
} from '../index'

describe('FunctionClient SDK', () => {
  let client: FunctionClient
  const mockApiKey = 'test-api-key-12345'
  const mockBaseUrl = 'https://api.functions.do'

  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('invoke() method', () => {
    beforeEach(() => {
      client = new FunctionClient({ apiKey: mockApiKey })
    })

    it('should invoke function with complex nested input data', async () => {
      const complexInput = {
        users: [
          { id: 1, name: 'Alice', tags: ['admin', 'active'] },
          { id: 2, name: 'Bob', tags: ['user'] },
        ],
        config: {
          nested: {
            deeply: {
              value: 42,
            },
          },
        },
        nullValue: null,
        emptyArray: [],
      }

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { processed: true },
          executionTime: 50,
          functionId: 'complex-func',
        }),
      } as Response)

      const result = await client.invoke('complex-func', complexInput)

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/functions/complex-func/invoke`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(complexInput),
        })
      )
      expect(result.result).toEqual({ processed: true })
    })

    it('should handle whitespace-only function ID', async () => {
      await expect(client.invoke('   ')).rejects.toThrow('Function ID is required')
    })

    it('should handle function ID with special characters', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: 'ok',
          executionTime: 10,
          functionId: 'my-function_v2',
        }),
      } as Response)

      await client.invoke('my-function_v2')

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/functions/my-function_v2/invoke`,
        expect.any(Object)
      )
    })

    it('should handle very large response payloads', async () => {
      const largeResult = { data: 'x'.repeat(1_000_000) }

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: largeResult,
          executionTime: 500,
          functionId: 'large-response-func',
        }),
      } as Response)

      const result = await client.invoke('large-response-func')
      expect(result.result).toEqual(largeResult)
    })

    it('should handle empty object input', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: 'processed',
          executionTime: 5,
          functionId: 'func',
        }),
      } as Response)

      await client.invoke('func', {})

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: '{}',
        })
      )
    })

    it('should handle array input', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: [1, 2, 3],
          executionTime: 10,
          functionId: 'array-func',
        }),
      } as Response)

      const result = await client.invoke('array-func', [1, 2, 3])

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: '[1,2,3]',
        })
      )
      expect(result.result).toEqual([1, 2, 3])
    })

    it('should handle primitive input values', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: 'echoed',
          executionTime: 5,
          functionId: 'echo-func',
        }),
      } as Response)

      await client.invoke('echo-func', 'string-input')

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: '"string-input"',
        })
      )
    })
  })

  describe('deploy() method', () => {
    beforeEach(() => {
      client = new FunctionClient({ apiKey: mockApiKey })
    })

    it('should deploy function with all metadata fields', async () => {
      const code = 'export default () => "full-metadata"'
      const metadata: FunctionMetadata = {
        name: 'full-function',
        description: 'A fully configured function',
        language: 'typescript',
        environment: {
          NODE_ENV: 'production',
          API_URL: 'https://api.example.com',
          SECRET_KEY: 'secret123',
        },
        routes: ['/api/v1/users', '/api/v1/users/:id', '/api/v1/products'],
        tags: ['production', 'v1', 'api', 'critical'],
      }

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'func-full',
          name: 'full-function',
          url: 'https://full-function.functions.do',
          createdAt: '2024-01-15T12:00:00Z',
        }),
      } as Response)

      const result = await client.deploy(code, metadata)

      const callBody = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]?.body as string)
      expect(callBody.code).toBe(code)
      expect(callBody.name).toBe('full-function')
      expect(callBody.description).toBe('A fully configured function')
      expect(callBody.language).toBe('typescript')
      expect(callBody.environment).toEqual(metadata.environment)
      expect(callBody.routes).toEqual(metadata.routes)
      expect(callBody.tags).toEqual(metadata.tags)

      expect(result.name).toBe('full-function')
    })

    it('should handle whitespace-only code', async () => {
      await expect(client.deploy('   ', { name: 'test' })).rejects.toThrow('Function code is required')
    })

    it('should handle whitespace-only name', async () => {
      await expect(client.deploy('code', { name: '   ' })).rejects.toThrow('Function name is required')
    })

    it('should handle very large code payload', async () => {
      const largeCode = 'export default () => "' + 'x'.repeat(100_000) + '"'

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'large-func',
          name: 'large-function',
          url: 'https://large-function.functions.do',
          createdAt: '2024-01-15T12:00:00Z',
        }),
      } as Response)

      await client.deploy(largeCode, { name: 'large-function' })

      const callBody = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]?.body as string)
      expect(callBody.code.length).toBeGreaterThan(100_000)
    })

    it('should deploy with empty environment and routes', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'minimal-func',
          name: 'minimal',
          url: 'https://minimal.functions.do',
          createdAt: '2024-01-15T12:00:00Z',
        }),
      } as Response)

      await client.deploy('code', {
        name: 'minimal',
        environment: {},
        routes: [],
        tags: [],
      })

      const callBody = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]?.body as string)
      expect(callBody.environment).toEqual({})
      expect(callBody.routes).toEqual([])
      expect(callBody.tags).toEqual([])
    })
  })

  describe('Error Handling', () => {
    beforeEach(() => {
      client = new FunctionClient({ apiKey: mockApiKey })
    })

    it('should map 400 status to VALIDATION_ERROR', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers(),
        json: async () => ({ error: 'Invalid input' }),
      } as Response)

      try {
        await client.invoke('func')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).code).toBe(FunctionErrorCode.VALIDATION_ERROR)
      }
    })

    it('should map 401 status to UNAUTHORIZED', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers(),
        json: async () => ({ error: 'Invalid API key' }),
      } as Response)

      try {
        await client.invoke('func')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).code).toBe(FunctionErrorCode.UNAUTHORIZED)
      }
    })

    it('should map 403 status to FORBIDDEN', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers(),
        json: async () => ({ error: 'Access denied' }),
      } as Response)

      try {
        await client.invoke('func')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).code).toBe(FunctionErrorCode.FORBIDDEN)
      }
    })

    it('should map 404 status to NOT_FOUND', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
        json: async () => ({ error: 'Function not found' }),
      } as Response)

      try {
        await client.invoke('func')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).code).toBe(FunctionErrorCode.NOT_FOUND)
      }
    })

    it('should map 408 status to TIMEOUT', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 408,
        statusText: 'Request Timeout',
        headers: new Headers(),
        json: async () => ({ error: 'Request timed out' }),
      } as Response)

      try {
        await client.invoke('func')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).code).toBe(FunctionErrorCode.TIMEOUT)
      }
    })

    it('should map 422 status to VALIDATION_ERROR', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: new Headers(),
        json: async () => ({ error: 'Validation failed' }),
      } as Response)

      try {
        await client.invoke('func')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).code).toBe(FunctionErrorCode.VALIDATION_ERROR)
      }
    })

    it('should map 429 status to RATE_LIMITED', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'retry-after': '30' }),
        json: async () => ({ error: 'Rate limit exceeded' }),
      } as Response)

      try {
        await client.invoke('func')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).code).toBe(FunctionErrorCode.RATE_LIMITED)
        expect((error as FunctionClientError).retryAfter).toBe(30)
      }
    })

    it('should map 500 status to SERVER_ERROR', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers(),
        json: async () => ({ error: 'Server error' }),
      } as Response)

      try {
        await client.invoke('func')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).code).toBe(FunctionErrorCode.SERVER_ERROR)
      }
    })

    it('should map 502 status to SERVER_ERROR', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: new Headers(),
        json: async () => ({ error: 'Bad gateway' }),
      } as Response)

      try {
        await client.invoke('func')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).code).toBe(FunctionErrorCode.SERVER_ERROR)
        expect((error as FunctionClientError).retryable).toBe(true)
      }
    })

    it('should map 503 status to SERVER_ERROR with retryable flag', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers(),
        json: async () => ({ error: 'Service unavailable' }),
      } as Response)

      try {
        await client.invoke('func')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).code).toBe(FunctionErrorCode.SERVER_ERROR)
        expect((error as FunctionClientError).retryable).toBe(true)
      }
    })

    it('should map 504 status to TIMEOUT', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 504,
        statusText: 'Gateway Timeout',
        headers: new Headers(),
        json: async () => ({ error: 'Gateway timeout' }),
      } as Response)

      try {
        await client.invoke('func')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).code).toBe(FunctionErrorCode.TIMEOUT)
      }
    })

    it('should handle non-JSON error responses', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers(),
        json: async () => {
          throw new SyntaxError('Invalid JSON')
        },
      } as Response)

      try {
        await client.invoke('func')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).statusCode).toBe(500)
      }
    })
  })

  describe('Auth Caching', () => {
    it('should cache 401 errors for subsequent requests', async () => {
      client = new FunctionClient({ apiKey: 'invalid-key' })

      // First request returns 401
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers(),
        json: async () => ({ error: 'Invalid API key' }),
      } as Response)

      // First call should make a fetch request
      try {
        await client.list()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).code).toBe(FunctionErrorCode.UNAUTHORIZED)
      }

      expect(global.fetch).toHaveBeenCalledTimes(1)

      // Second call may or may not make another fetch based on caching
      // The auth error is cached and should be thrown again
      try {
        await client.list()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).code).toBe(FunctionErrorCode.UNAUTHORIZED)
      }
    })

    it('should cache 403 errors for subsequent requests', async () => {
      client = new FunctionClient({ apiKey: 'forbidden-key' })

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers(),
        json: async () => ({ error: 'Access denied' }),
      } as Response)

      try {
        await client.invoke('restricted-func')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).code).toBe(FunctionErrorCode.FORBIDDEN)
      }

      expect(global.fetch).toHaveBeenCalledTimes(1)

      // Subsequent request should also fail with cached error
      try {
        await client.invoke('another-func')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).code).toBe(FunctionErrorCode.FORBIDDEN)
      }
    })

    it('should use statusText for auth error messages', async () => {
      client = new FunctionClient({ apiKey: 'test-key' })

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers(),
        json: async () => ({ error: 'Custom error message that should be ignored' }),
      } as Response)

      try {
        await client.list()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        // For auth errors, statusText is used instead of JSON error
        expect((error as FunctionClientError).message).toBe('Unauthorized')
      }
    })

    it('should not cache non-auth errors', async () => {
      client = new FunctionClient({ apiKey: mockApiKey })

      // First request returns 500
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers(),
        json: async () => ({ error: 'Server error' }),
      } as Response)

      try {
        await client.invoke('func')
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as FunctionClientError).code).toBe(FunctionErrorCode.SERVER_ERROR)
      }

      // Second request should succeed
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: 'success',
          executionTime: 10,
          functionId: 'func',
        }),
      } as Response)

      const result = await client.invoke('func')
      expect(result.result).toBe('success')
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('Error Classes', () => {
    describe('NetworkError', () => {
      it('should have correct properties', () => {
        const cause = new Error('Connection refused')
        const error = new NetworkError('Failed to connect', cause)

        expect(error.name).toBe('NetworkError')
        expect(error.message).toBe('Failed to connect')
        expect(error.code).toBe(FunctionErrorCode.NETWORK_ERROR)
        expect(error.statusCode).toBe(0)
        expect(error.cause).toBe(cause)
        expect(error.retryable).toBe(true)
      })
    })

    describe('TimeoutError', () => {
      it('should have correct properties', () => {
        const error = new TimeoutError('Request timed out', 30000)

        expect(error.name).toBe('TimeoutError')
        expect(error.message).toBe('Request timed out')
        expect(error.code).toBe(FunctionErrorCode.TIMEOUT)
        expect(error.statusCode).toBe(408)
        expect(error.details).toEqual({ timeout: 30000 })
        expect(error.retryable).toBe(true)
      })
    })

    describe('RateLimitError', () => {
      it('should have correct properties', () => {
        const error = new RateLimitError('Too many requests', 60)

        expect(error.name).toBe('RateLimitError')
        expect(error.message).toBe('Too many requests')
        expect(error.code).toBe(FunctionErrorCode.RATE_LIMITED)
        expect(error.statusCode).toBe(429)
        expect(error.retryAfter).toBe(60)
        expect(error.retryable).toBe(true)
      })

      it('should handle undefined retryAfter', () => {
        const error = new RateLimitError('Too many requests')

        expect(error.retryAfter).toBeUndefined()
      })
    })

    describe('ValidationError', () => {
      it('should have correct properties', () => {
        const error = new ValidationError('Invalid input', 'email', { expected: 'string' })

        expect(error.name).toBe('ValidationError')
        expect(error.message).toBe('Invalid input')
        expect(error.code).toBe(FunctionErrorCode.VALIDATION_ERROR)
        expect(error.statusCode).toBe(400)
        expect(error.field).toBe('email')
        expect(error.details).toEqual({ expected: 'string' })
        expect(error.retryable).toBe(false)
      })

      it('should handle undefined field', () => {
        const error = new ValidationError('Invalid input')

        expect(error.field).toBeUndefined()
      })
    })

    describe('ExecutionError', () => {
      it('should have correct properties', () => {
        const logs = ['Log line 1', 'Log line 2', 'Error at line 5']
        const error = new ExecutionError('Function crashed', 'func-123', logs, { exitCode: 1 })

        expect(error.name).toBe('ExecutionError')
        expect(error.message).toBe('Function crashed')
        expect(error.code).toBe(FunctionErrorCode.EXECUTION_ERROR)
        expect(error.statusCode).toBe(500)
        expect(error.functionId).toBe('func-123')
        expect(error.logs).toEqual(logs)
        expect(error.details).toEqual({ exitCode: 1 })
        expect(error.retryable).toBe(false)
      })

      it('should handle undefined logs', () => {
        const error = new ExecutionError('Function crashed', 'func-123')

        expect(error.logs).toBeUndefined()
      })
    })

    describe('FunctionClientError retryable property', () => {
      it('should mark NETWORK_ERROR as retryable', () => {
        const error = new FunctionClientError('Network error', 0, { code: FunctionErrorCode.NETWORK_ERROR })
        expect(error.retryable).toBe(true)
      })

      it('should mark TIMEOUT as retryable', () => {
        const error = new FunctionClientError('Timeout', 408, { code: FunctionErrorCode.TIMEOUT })
        expect(error.retryable).toBe(true)
      })

      it('should mark RATE_LIMITED as retryable', () => {
        const error = new FunctionClientError('Rate limited', 429, { code: FunctionErrorCode.RATE_LIMITED })
        expect(error.retryable).toBe(true)
      })

      it('should mark SERVER_ERROR as retryable', () => {
        const error = new FunctionClientError('Server error', 500, { code: FunctionErrorCode.SERVER_ERROR })
        expect(error.retryable).toBe(true)
      })

      it('should mark VALIDATION_ERROR as not retryable', () => {
        const error = new FunctionClientError('Validation error', 400, { code: FunctionErrorCode.VALIDATION_ERROR })
        expect(error.retryable).toBe(false)
      })

      it('should mark UNAUTHORIZED as not retryable', () => {
        const error = new FunctionClientError('Unauthorized', 401, { code: FunctionErrorCode.UNAUTHORIZED })
        expect(error.retryable).toBe(false)
      })

      it('should mark FORBIDDEN as not retryable', () => {
        const error = new FunctionClientError('Forbidden', 403, { code: FunctionErrorCode.FORBIDDEN })
        expect(error.retryable).toBe(false)
      })

      it('should mark NOT_FOUND as not retryable', () => {
        const error = new FunctionClientError('Not found', 404, { code: FunctionErrorCode.NOT_FOUND })
        expect(error.retryable).toBe(false)
      })

      it('should mark 502 status as retryable regardless of error code', () => {
        const error = new FunctionClientError('Bad gateway', 502)
        expect(error.retryable).toBe(true)
      })

      it('should mark 503 status as retryable regardless of error code', () => {
        const error = new FunctionClientError('Service unavailable', 503)
        expect(error.retryable).toBe(true)
      })
    })
  })

  describe('list() method', () => {
    beforeEach(() => {
      client = new FunctionClient({ apiKey: mockApiKey })
    })

    it('should handle empty response', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ functions: [] }),
      } as Response)

      const result = await client.list()
      expect(result).toEqual([])
    })

    it('should handle pagination with all options', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ functions: [] }),
      } as Response)

      await client.list({ limit: 50, offset: 100, status: 'deploying' })

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/api/functions?limit=50&offset=100&status=deploying`,
        expect.any(Object)
      )
    })

    it('should handle limit=0', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ functions: [] }),
      } as Response)

      await client.list({ limit: 0 })

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/api/functions?limit=0`,
        expect.any(Object)
      )
    })

    it('should handle offset=0', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ functions: [] }),
      } as Response)

      await client.list({ offset: 0 })

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/api/functions?offset=0`,
        expect.any(Object)
      )
    })
  })

  describe('get() method', () => {
    beforeEach(() => {
      client = new FunctionClient({ apiKey: mockApiKey })
    })

    it('should handle whitespace-only function ID', async () => {
      await expect(client.get('   ')).rejects.toThrow('Function ID is required')
    })

    it('should request function with includeCode=true', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'func-123',
          name: 'test-func',
          url: 'https://test-func.functions.do',
          createdAt: '2024-01-01T00:00:00Z',
          status: 'active',
          code: 'export default () => "test"',
        }),
      } as Response)

      await client.get('func-123', { includeCode: true })

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/api/functions/func-123?includeCode=true`,
        expect.any(Object)
      )
    })
  })

  describe('delete() method', () => {
    beforeEach(() => {
      client = new FunctionClient({ apiKey: mockApiKey })
    })

    it('should handle whitespace-only function ID', async () => {
      await expect(client.delete('   ')).rejects.toThrow('Function ID is required')
    })

    it('should return delete result with alreadyDeleted flag', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          deleted: true,
          id: 'func-123',
          alreadyDeleted: true,
        }),
      } as Response)

      const result = await client.delete('func-123')

      expect(result.deleted).toBe(true)
      expect(result.id).toBe('func-123')
      expect(result.alreadyDeleted).toBe(true)
    })
  })

  describe('Configuration', () => {
    it('should use custom timeout', () => {
      const customClient = new FunctionClient({
        apiKey: mockApiKey,
        timeout: 5000,
      })

      expect(customClient.getTimeout()).toBe(5000)
    })

    it('should use custom base URL', () => {
      const customClient = new FunctionClient({
        apiKey: mockApiKey,
        baseUrl: 'https://custom.api.example.com',
      })

      expect(customClient.getBaseUrl()).toBe('https://custom.api.example.com')
    })

    it('should handle base URL with trailing slash', async () => {
      const customClient = new FunctionClient({
        apiKey: mockApiKey,
        baseUrl: 'https://api.example.com/',
      })

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ functions: [] }),
      } as Response)

      await customClient.list()

      // Note: The current implementation doesn't strip trailing slashes
      // This test documents the current behavior
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com//v1/api/functions',
        expect.any(Object)
      )
    })
  })

  describe('FunctionErrorCode enum', () => {
    it('should have all expected error codes', () => {
      expect(FunctionErrorCode.NETWORK_ERROR).toBe('NETWORK_ERROR')
      expect(FunctionErrorCode.TIMEOUT).toBe('TIMEOUT')
      expect(FunctionErrorCode.UNAUTHORIZED).toBe('UNAUTHORIZED')
      expect(FunctionErrorCode.FORBIDDEN).toBe('FORBIDDEN')
      expect(FunctionErrorCode.NOT_FOUND).toBe('NOT_FOUND')
      expect(FunctionErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR')
      expect(FunctionErrorCode.RATE_LIMITED).toBe('RATE_LIMITED')
      expect(FunctionErrorCode.EXECUTION_ERROR).toBe('EXECUTION_ERROR')
      expect(FunctionErrorCode.SERVER_ERROR).toBe('SERVER_ERROR')
      expect(FunctionErrorCode.UNKNOWN).toBe('UNKNOWN')
    })
  })
})
