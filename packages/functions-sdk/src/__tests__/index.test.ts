/**
 * SDK Public API Surface Tests
 *
 * Tests that the @dotdo/functions SDK correctly exports all public types,
 * classes, and functions. Complements client.test.ts which tests FunctionClient
 * behavior in depth.
 *
 * Covers:
 * - All named exports from the SDK entry point
 * - createFunction factory behavior
 * - RpcTarget re-export
 * - FunctionTarget and RpcError re-exports
 * - Error class hierarchy and error code mappings
 * - FunctionClient constructor validation
 * - batchInvoke validation and concurrency control
 *
 * @module __tests__/index.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  // create-function
  createFunction,

  // capnweb
  RpcTarget,

  // function-target
  FunctionTarget,
  RpcError,

  // Error types
  FunctionErrorCode,
  FunctionClientError,
  NetworkError,
  TimeoutError,
  RateLimitError,
  ValidationError,
  ExecutionError,

  // Client
  FunctionClient,

  // Types (these are type-only exports, we verify they exist at runtime where applicable)
  type FunctionEnv,
  type FunctionContext,
  type FunctionHandler,
  type FunctionExport,
  type WorkerStub,
  type TracingHooks,
  type SpanContext,
  type RequestMetrics,
  type AggregatedMetrics,
  type FunctionTargetOptions,
  type RetryConfig,
  type InvokeOptions,
  type StreamOptions,
  type BatchInvokeRequest,
  type BatchInvokeResultItem,
  type BatchInvokeOptions,
  type FunctionClientConfig,
  type FunctionMetadata,
  type FunctionResponse,
  type InvokeResult,
  type DeployResult,
  type ListOptions,
  type GetOptions,
  type DeleteResult,
  type StreamChunk,
  type FunctionStream,
} from '../index'

// =============================================================================
// EXPORT EXISTENCE CHECKS
// =============================================================================

describe('SDK Public API surface', () => {
  describe('named exports exist', () => {
    it('should export createFunction', () => {
      expect(createFunction).toBeDefined()
      expect(typeof createFunction).toBe('function')
    })

    it('should export RpcTarget class', () => {
      expect(RpcTarget).toBeDefined()
      expect(typeof RpcTarget).toBe('function')
    })

    it('should export FunctionTarget class', () => {
      expect(FunctionTarget).toBeDefined()
      expect(typeof FunctionTarget).toBe('function')
    })

    it('should export RpcError class', () => {
      expect(RpcError).toBeDefined()
      expect(typeof RpcError).toBe('function')
    })

    it('should export FunctionErrorCode enum', () => {
      expect(FunctionErrorCode).toBeDefined()
      expect(typeof FunctionErrorCode).toBe('object')
    })

    it('should export FunctionClientError class', () => {
      expect(FunctionClientError).toBeDefined()
      expect(typeof FunctionClientError).toBe('function')
    })

    it('should export NetworkError class', () => {
      expect(NetworkError).toBeDefined()
      expect(typeof NetworkError).toBe('function')
    })

    it('should export TimeoutError class', () => {
      expect(TimeoutError).toBeDefined()
      expect(typeof TimeoutError).toBe('function')
    })

    it('should export RateLimitError class', () => {
      expect(RateLimitError).toBeDefined()
      expect(typeof RateLimitError).toBe('function')
    })

    it('should export ValidationError class', () => {
      expect(ValidationError).toBeDefined()
      expect(typeof ValidationError).toBe('function')
    })

    it('should export ExecutionError class', () => {
      expect(ExecutionError).toBeDefined()
      expect(typeof ExecutionError).toBe('function')
    })

    it('should export FunctionClient class', () => {
      expect(FunctionClient).toBeDefined()
      expect(typeof FunctionClient).toBe('function')
    })
  })

  // =============================================================================
  // FunctionErrorCode ENUM
  // =============================================================================

  describe('FunctionErrorCode', () => {
    it('should have exactly 10 error codes', () => {
      const codes = Object.values(FunctionErrorCode)
      expect(codes.length).toBe(10)
    })

    it('should include all expected codes', () => {
      const expected = [
        'NETWORK_ERROR',
        'TIMEOUT',
        'UNAUTHORIZED',
        'FORBIDDEN',
        'NOT_FOUND',
        'VALIDATION_ERROR',
        'RATE_LIMITED',
        'EXECUTION_ERROR',
        'SERVER_ERROR',
        'UNKNOWN',
      ]
      for (const code of expected) {
        expect(Object.values(FunctionErrorCode)).toContain(code)
      }
    })
  })

  // =============================================================================
  // ERROR CLASS HIERARCHY
  // =============================================================================

  describe('error class hierarchy', () => {
    it('NetworkError should extend FunctionClientError', () => {
      const err = new NetworkError('test')
      expect(err).toBeInstanceOf(FunctionClientError)
      expect(err).toBeInstanceOf(Error)
    })

    it('TimeoutError should extend FunctionClientError', () => {
      const err = new TimeoutError('test', 5000)
      expect(err).toBeInstanceOf(FunctionClientError)
      expect(err).toBeInstanceOf(Error)
    })

    it('RateLimitError should extend FunctionClientError', () => {
      const err = new RateLimitError('test', 60)
      expect(err).toBeInstanceOf(FunctionClientError)
      expect(err).toBeInstanceOf(Error)
    })

    it('ValidationError should extend FunctionClientError', () => {
      const err = new ValidationError('test')
      expect(err).toBeInstanceOf(FunctionClientError)
      expect(err).toBeInstanceOf(Error)
    })

    it('ExecutionError should extend FunctionClientError', () => {
      const err = new ExecutionError('test', 'func-id')
      expect(err).toBeInstanceOf(FunctionClientError)
      expect(err).toBeInstanceOf(Error)
    })

    it('FunctionClientError should extend Error', () => {
      const err = new FunctionClientError('test', 500)
      expect(err).toBeInstanceOf(Error)
    })
  })

  // =============================================================================
  // FunctionClientError auto-code mapping
  // =============================================================================

  describe('FunctionClientError status-to-code mapping', () => {
    it('should map status 0 to NETWORK_ERROR', () => {
      const err = new FunctionClientError('test', 0)
      expect(err.code).toBe(FunctionErrorCode.NETWORK_ERROR)
    })

    it('should map status 401 to UNAUTHORIZED', () => {
      const err = new FunctionClientError('test', 401)
      expect(err.code).toBe(FunctionErrorCode.UNAUTHORIZED)
    })

    it('should map status 403 to FORBIDDEN', () => {
      const err = new FunctionClientError('test', 403)
      expect(err.code).toBe(FunctionErrorCode.FORBIDDEN)
    })

    it('should map status 404 to NOT_FOUND', () => {
      const err = new FunctionClientError('test', 404)
      expect(err.code).toBe(FunctionErrorCode.NOT_FOUND)
    })

    it('should map status 400 to VALIDATION_ERROR', () => {
      const err = new FunctionClientError('test', 400)
      expect(err.code).toBe(FunctionErrorCode.VALIDATION_ERROR)
    })

    it('should map status 422 to VALIDATION_ERROR', () => {
      const err = new FunctionClientError('test', 422)
      expect(err.code).toBe(FunctionErrorCode.VALIDATION_ERROR)
    })

    it('should map status 429 to RATE_LIMITED', () => {
      const err = new FunctionClientError('test', 429)
      expect(err.code).toBe(FunctionErrorCode.RATE_LIMITED)
    })

    it('should map status 408 to TIMEOUT', () => {
      const err = new FunctionClientError('test', 408)
      expect(err.code).toBe(FunctionErrorCode.TIMEOUT)
    })

    it('should map status 504 to TIMEOUT', () => {
      const err = new FunctionClientError('test', 504)
      expect(err.code).toBe(FunctionErrorCode.TIMEOUT)
    })

    it('should map status 500 to SERVER_ERROR', () => {
      const err = new FunctionClientError('test', 500)
      expect(err.code).toBe(FunctionErrorCode.SERVER_ERROR)
    })

    it('should map unknown status to UNKNOWN', () => {
      const err = new FunctionClientError('test', 418)
      expect(err.code).toBe(FunctionErrorCode.UNKNOWN)
    })

    it('should allow explicit code override', () => {
      const err = new FunctionClientError('test', 500, {
        code: FunctionErrorCode.EXECUTION_ERROR,
      })
      expect(err.code).toBe(FunctionErrorCode.EXECUTION_ERROR)
    })
  })

  // =============================================================================
  // createFunction FACTORY
  // =============================================================================

  describe('createFunction', () => {
    it('should return an empty object for empty handlers', () => {
      const result = createFunction({})
      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })

    it('should include fetch handler when provided', () => {
      const handler = vi.fn().mockResolvedValue(new Response('ok'))
      const result = createFunction({
        fetch: handler,
      })

      expect(result.fetch).toBeDefined()
      expect(typeof result.fetch).toBe('function')
    })

    it('should include scheduled handler when provided', () => {
      const handler = vi.fn().mockResolvedValue(undefined)
      const result = createFunction({
        scheduled: handler,
      })

      expect(result.scheduled).toBeDefined()
      expect(typeof result.scheduled).toBe('function')
    })

    it('should include queue handler when provided', () => {
      const handler = vi.fn().mockResolvedValue(undefined)
      const result = createFunction({
        queue: handler,
      })

      expect(result.queue).toBeDefined()
      expect(typeof result.queue).toBe('function')
    })

    it('should not include handlers that were not provided', () => {
      const result = createFunction({
        fetch: vi.fn().mockResolvedValue(new Response('ok')),
      })

      expect(result.fetch).toBeDefined()
      expect(result.scheduled).toBeUndefined()
      expect(result.queue).toBeUndefined()
    })

    it('should wrap fetch handler with FunctionContext', async () => {
      const originalHandler = vi.fn().mockResolvedValue(new Response('ok'))
      const result = createFunction({ fetch: originalHandler })

      const mockEnv = { MY_VAR: 'value' }
      const waitUntilFn = vi.fn()
      const passThroughFn = vi.fn()
      const mockCtx = {
        waitUntil: waitUntilFn,
        passThroughOnException: passThroughFn,
      } as unknown as ExecutionContext

      const request = new Request('https://test.com')
      await result.fetch!(request, mockEnv, mockCtx)

      expect(originalHandler).toHaveBeenCalledWith(
        request,
        mockEnv,
        expect.objectContaining({
          waitUntil: expect.any(Function),
        })
      )
    })
  })

  // =============================================================================
  // RpcTarget RE-EXPORT
  // =============================================================================

  describe('RpcTarget re-export', () => {
    it('should be instantiable', () => {
      const target = new RpcTarget()
      expect(target).toBeInstanceOf(RpcTarget)
    })

    it('should support subclassing', () => {
      class MyTarget extends RpcTarget {
        getValue(): number {
          return 42
        }
      }

      const target = new MyTarget()
      expect(target).toBeInstanceOf(RpcTarget)
      expect(target.getValue()).toBe(42)
    })
  })

  // =============================================================================
  // FunctionClient CONSTRUCTOR
  // =============================================================================

  describe('FunctionClient constructor', () => {
    it('should throw when API key is empty', () => {
      expect(() => new FunctionClient({ apiKey: '' })).toThrow('API key is required')
    })

    it('should throw when API key is whitespace only', () => {
      expect(() => new FunctionClient({ apiKey: '   ' })).toThrow('API key is required')
    })

    it('should trim API key', () => {
      const client = new FunctionClient({ apiKey: '  test-key  ' })
      expect(client.getApiKey()).toBe('test-key')
    })

    it('should use default base URL', () => {
      const client = new FunctionClient({ apiKey: 'test-key' })
      expect(client.getBaseUrl()).toBe('https://api.functions.do')
    })

    it('should use custom base URL', () => {
      const client = new FunctionClient({
        apiKey: 'test-key',
        baseUrl: 'https://custom.example.com',
      })
      expect(client.getBaseUrl()).toBe('https://custom.example.com')
    })

    it('should use default timeout of 60000ms', () => {
      const client = new FunctionClient({ apiKey: 'test-key' })
      expect(client.getTimeout()).toBe(60000)
    })

    it('should use custom timeout', () => {
      const client = new FunctionClient({ apiKey: 'test-key', timeout: 5000 })
      expect(client.getTimeout()).toBe(5000)
    })
  })

  // =============================================================================
  // FunctionClient BATCH INVOKE
  // =============================================================================

  describe('FunctionClient.batchInvoke', () => {
    let client: FunctionClient

    beforeEach(() => {
      client = new FunctionClient({ apiKey: 'test-key' })
      global.fetch = vi.fn()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should throw when requests array is empty', async () => {
      await expect(client.batchInvoke([])).rejects.toThrow(
        'Requests array is required and must not be empty'
      )
    })

    it('should invoke multiple functions', async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            result: 'result1',
            executionTime: 10,
            functionId: 'func1',
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            result: 'result2',
            executionTime: 20,
            functionId: 'func2',
          }),
        } as Response)

      const results = await client.batchInvoke([
        { functionId: 'func1', input: { a: 1 } },
        { functionId: 'func2', input: { b: 2 } },
      ])

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[0].functionId).toBe('func1')
      expect(results[1].success).toBe(true)
      expect(results[1].functionId).toBe('func2')
    })

    it('should handle partial failures without stopOnError', async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers(),
          json: async () => ({ error: 'Failed' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            result: 'ok',
            executionTime: 10,
            functionId: 'func2',
          }),
        } as Response)

      const results = await client.batchInvoke([
        { functionId: 'func1' },
        { functionId: 'func2' },
      ])

      expect(results[0].success).toBe(false)
      expect(results[0].error).toBeDefined()
      expect(results[1].success).toBe(true)
    })

    it('should stop on first error when stopOnError is true', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers(),
        json: async () => ({ error: 'Failed' }),
      } as Response)

      const results = await client.batchInvoke(
        [
          { functionId: 'func1' },
          { functionId: 'func2' },
          { functionId: 'func3' },
        ],
        { stopOnError: true, concurrency: 1 }
      )

      expect(results).toHaveLength(3)
      expect(results[0].success).toBe(false)
      // Subsequent items should be marked as failed due to stop
      expect(results[1].success).toBe(false)
      expect(results[2].success).toBe(false)
    })
  })

  // =============================================================================
  // FunctionClient VALIDATION
  // =============================================================================

  describe('FunctionClient input validation', () => {
    let client: FunctionClient

    beforeEach(() => {
      client = new FunctionClient({ apiKey: 'test-key' })
      global.fetch = vi.fn()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should throw ValidationError for empty function ID in invoke', async () => {
      await expect(client.invoke('')).rejects.toThrow('Function ID is required')
    })

    it('should throw for whitespace-only function ID in invoke', async () => {
      await expect(client.invoke('   ')).rejects.toThrow('Function ID is required')
    })

    it('should throw for empty function ID in stream', async () => {
      await expect(client.stream('')).rejects.toThrow('Function ID is required')
    })

    it('should throw for empty function ID in get', async () => {
      await expect(client.get('')).rejects.toThrow('Function ID is required')
    })

    it('should throw for empty function ID in delete', async () => {
      await expect(client.delete('')).rejects.toThrow('Function ID is required')
    })

    it('should throw for empty code in deploy', async () => {
      await expect(client.deploy('', { name: 'test' })).rejects.toThrow(
        'Function code is required'
      )
    })

    it('should throw for empty name in deploy', async () => {
      await expect(client.deploy('code', { name: '' })).rejects.toThrow(
        'Function name is required'
      )
    })
  })
})
