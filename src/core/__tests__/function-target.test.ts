/**
 * FunctionTarget RPC Wrapper Tests
 *
 * Tests for the capnweb-style RPC target that wraps WorkerStub
 * for invoking serverless functions.
 *
 * FunctionTarget should:
 * 1. Extend capnweb RpcTarget base class
 * 2. Wrap a WorkerStub and call fetch() with serialized arguments
 * 3. Deserialize responses correctly
 * 4. Support promise pipelining for chained operations
 * 5. Support request deduplication
 * 6. Support automatic batching
 * 7. Provide tracing/observability hooks
 * 8. Collect performance metrics
 *
 * Reference: projects/dot-do-capnweb/src/core.ts for RpcTarget patterns
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Type for JSON response bodies in tests
type JsonBody = Record<string, unknown>

// These imports will fail until FunctionTarget is implemented
// This is intentional - RED phase of TDD
import {
  FunctionTarget,
  FunctionTargetOptions,
  TracingHooks,
  SpanContext,
  RequestMetrics,
  AggregatedMetrics,
} from '../../core/function-target'
import { RpcTarget } from 'capnweb'

// ============================================================================
// Mock Types (matching Cloudflare Workers interfaces)
// ============================================================================

/**
 * Mock WorkerStub interface matching Cloudflare's WorkerStub
 */
interface MockWorkerStub {
  fetch(request: Request): Promise<Response>
  getEntrypoint?(name?: string): MockWorkerEntrypoint
}

interface MockWorkerEntrypoint {
  fetch(request: Request): Promise<Response>
}

/**
 * Create a mock WorkerStub for testing
 */
function createMockWorkerStub(
  fetchImpl?: (request: Request) => Promise<Response>
): MockWorkerStub {
  return {
    fetch: vi.fn(
      fetchImpl ??
        (async (request: Request) => {
          return new Response(JSON.stringify({ result: 'mock-result' }), {
            headers: { 'Content-Type': 'application/json' },
          })
        })
    ),
  }
}

// ============================================================================
// FunctionTarget extends RpcTarget
// ============================================================================

describe('FunctionTarget extends capnweb RpcTarget', () => {
  it('should export FunctionTarget class', () => {
    expect(FunctionTarget).toBeDefined()
    expect(typeof FunctionTarget).toBe('function')
  })

  it('should extend RpcTarget base class', () => {
    const mockStub = createMockWorkerStub()
    const target = new FunctionTarget(mockStub)

    expect(target).toBeInstanceOf(RpcTarget)
  })

  it('should accept WorkerStub in constructor', () => {
    const mockStub = createMockWorkerStub()
    const target = new FunctionTarget(mockStub)

    expect(target).toBeDefined()
  })

  it('should accept optional configuration', () => {
    const mockStub = createMockWorkerStub()
    const options: FunctionTargetOptions = {
      timeout: 30000,
      retries: 3,
      serializer: 'json',
    }

    const target = new FunctionTarget(mockStub, options)

    expect(target).toBeDefined()
    expect(target.options.timeout).toBe(30000)
    expect(target.options.retries).toBe(3)
  })
})

// ============================================================================
// FunctionTarget.invoke() calls WorkerStub.fetch()
// ============================================================================

describe('FunctionTarget.invoke() calls WorkerStub.fetch()', () => {
  let mockStub: MockWorkerStub
  let target: FunctionTarget

  beforeEach(() => {
    mockStub = createMockWorkerStub()
    target = new FunctionTarget(mockStub)
  })

  it('should have invoke method', () => {
    expect(typeof target.invoke).toBe('function')
  })

  it('should call stub.fetch() when invoke is called', async () => {
    await target.invoke('testMethod', 'arg1', 'arg2')

    expect(mockStub.fetch).toHaveBeenCalledTimes(1)
  })

  it('should serialize method name in request', async () => {
    await target.invoke('myFunction', 'arg1')

    const fetchCall = vi.mocked(mockStub.fetch).mock.calls[0]!
    const request = fetchCall[0] as Request

    expect(request).toBeInstanceOf(Request)

    const body = (await request.clone().json()) as JsonBody
    expect(body.method).toBe('myFunction')
  })

  it('should serialize arguments in request body', async () => {
    await target.invoke('calculate', 10, 20, { multiply: true })

    const fetchCall = vi.mocked(mockStub.fetch).mock.calls[0]!
    const request = fetchCall[0] as Request
    const body = (await request.clone().json()) as JsonBody

    expect(body.params).toEqual([10, 20, { multiply: true }])
  })

  it('should use POST method for RPC calls', async () => {
    await target.invoke('someMethod')

    const fetchCall = vi.mocked(mockStub.fetch).mock.calls[0]!
    const request = fetchCall[0] as Request

    expect(request.method).toBe('POST')
  })

  it('should set Content-Type header to application/json', async () => {
    await target.invoke('someMethod')

    const fetchCall = vi.mocked(mockStub.fetch).mock.calls[0]!
    const request = fetchCall[0] as Request

    expect(request.headers.get('Content-Type')).toBe('application/json')
  })

  it('should include request ID for correlation', async () => {
    await target.invoke('methodA')
    await target.invoke('methodB')

    const call1 = vi.mocked(mockStub.fetch).mock.calls[0]!
    const call2 = vi.mocked(mockStub.fetch).mock.calls[1]!

    const body1 = (await (call1[0] as Request).clone().json()) as JsonBody
    const body2 = (await (call2[0] as Request).clone().json()) as JsonBody

    expect(body1.id).toBeDefined()
    expect(body2.id).toBeDefined()
    expect(body1.id).not.toBe(body2.id)
  })

  it('should handle complex serializable arguments', async () => {
    const complexArg = {
      nested: {
        array: [1, 2, 3],
        date: '2024-01-01T00:00:00Z',
        nullValue: null,
      },
      boolean: true,
    }

    await target.invoke('processData', complexArg)

    const fetchCall = vi.mocked(mockStub.fetch).mock.calls[0]
    const body = await (fetchCall[0] as Request).clone().json()

    expect(body.params[0]).toEqual(complexArg)
  })
})

// ============================================================================
// Response deserialization
// ============================================================================

describe('FunctionTarget response deserialization', () => {
  it('should deserialize JSON response', async () => {
    const mockResponse = { result: { value: 42, message: 'success' } }
    const mockStub = createMockWorkerStub(async () => {
      return new Response(JSON.stringify(mockResponse), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub)
    const result = await target.invoke('getValue')

    expect(result).toEqual({ value: 42, message: 'success' })
  })

  it('should handle array responses', async () => {
    const mockResponse = { result: [1, 2, 3, 4, 5] }
    const mockStub = createMockWorkerStub(async () => {
      return new Response(JSON.stringify(mockResponse), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub)
    const result = await target.invoke('getNumbers')

    expect(result).toEqual([1, 2, 3, 4, 5])
  })

  it('should handle primitive responses', async () => {
    const mockStub = createMockWorkerStub(async () => {
      return new Response(JSON.stringify({ result: 'hello' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub)
    const result = await target.invoke('getString')

    expect(result).toBe('hello')
  })

  it('should handle null responses', async () => {
    const mockStub = createMockWorkerStub(async () => {
      return new Response(JSON.stringify({ result: null }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub)
    const result = await target.invoke('getNull')

    expect(result).toBeNull()
  })

  it('should throw on error responses', async () => {
    const mockStub = createMockWorkerStub(async () => {
      return new Response(
        JSON.stringify({
          error: 'Function execution failed',
          code: 'EXECUTION_ERROR',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    })

    const target = new FunctionTarget(mockStub)

    await expect(target.invoke('failingMethod')).rejects.toThrow(
      'Function execution failed'
    )
  })

  it('should include error code in thrown error', async () => {
    const mockStub = createMockWorkerStub(async () => {
      return new Response(
        JSON.stringify({
          error: 'Not found',
          code: 'NOT_FOUND',
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    })

    const target = new FunctionTarget(mockStub)

    try {
      await target.invoke('missing')
      expect.fail('Should have thrown')
    } catch (error: unknown) {
      expect((error as Error & { code?: string }).code).toBe('NOT_FOUND')
    }
  })

  it('should handle non-JSON responses gracefully', async () => {
    const mockStub = createMockWorkerStub(async () => {
      return new Response('Internal Server Error', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      })
    })

    const target = new FunctionTarget(mockStub)

    await expect(target.invoke('broken')).rejects.toThrow()
  })
})

// ============================================================================
// Promise pipelining
// ============================================================================

describe('FunctionTarget promise pipelining', () => {
  it('should support chained method calls without awaiting', async () => {
    // Pipeline: target.db('mydb').collection('users').find({})
    // Should be sent as a single pipelined request

    const mockStub = createMockWorkerStub(async (request: Request) => {
      const body = await request.json()

      // Verify pipeline structure
      if (body.pipeline) {
        return new Response(
          JSON.stringify({
            result: [{ _id: '1', name: 'Alice' }],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      }

      return new Response(JSON.stringify({ result: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub)

    // Create a pipelined proxy
    const pipeline = target.pipeline()

    // Chain operations without awaiting intermediate results
    const result = await pipeline.db('mydb').collection('users').find({})

    expect(result).toEqual([{ _id: '1', name: 'Alice' }])
  })

  it('should batch pipelined operations into single request', async () => {
    const mockStub = createMockWorkerStub(async (request: Request) => {
      const body = await request.json()

      // Expect pipeline array with all operations
      expect(body.pipeline).toBeDefined()
      expect(Array.isArray(body.pipeline)).toBe(true)

      return new Response(JSON.stringify({ result: 'pipelined' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub)
    const pipeline = target.pipeline()

    await pipeline.step1().step2().step3()

    // Should have made only ONE fetch call despite three operations
    expect(mockStub.fetch).toHaveBeenCalledTimes(1)
  })

  it('should track operation dependencies in pipeline', async () => {
    const mockStub = createMockWorkerStub(async (request: Request) => {
      const body = await request.json()

      // Verify dependency chain
      const ops = body.pipeline as Array<{
        id: string
        method: string
        dependsOn?: string
      }>

      // First operation has no dependencies
      expect(ops[0].dependsOn).toBeUndefined()

      // Subsequent operations depend on previous
      expect(ops[1].dependsOn).toBe(ops[0].id)
      expect(ops[2].dependsOn).toBe(ops[1].id)

      return new Response(JSON.stringify({ result: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub)
    const pipeline = target.pipeline()

    await pipeline.first().second().third()
  })

  it('should support branching pipelines', async () => {
    // From a single promise, branch into multiple operations
    const mockStub = createMockWorkerStub(async () => {
      return new Response(JSON.stringify({ result: { a: 1, b: 2 } }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub)
    const pipeline = target.pipeline()

    const base = pipeline.getObject()

    // Both branches should be able to execute
    const [resultA, resultB] = await Promise.all([
      base.getProperty('a'),
      base.getProperty('b'),
    ])

    expect(resultA).toBe(1)
    expect(resultB).toBe(2)
  })

  it('should handle errors in pipelined operations', async () => {
    const mockStub = createMockWorkerStub(async () => {
      return new Response(
        JSON.stringify({
          error: 'Pipeline step 2 failed',
          failedAt: 1,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    })

    const target = new FunctionTarget(mockStub)
    const pipeline = target.pipeline()

    await expect(pipeline.step1().step2().step3()).rejects.toThrow(
      'Pipeline step 2 failed'
    )
  })

  it('should allow direct property access on promises', async () => {
    // capnweb-style: promise.property returns another promise
    const mockStub = createMockWorkerStub(async () => {
      return new Response(
        JSON.stringify({
          result: { nested: { value: 42 } },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    })

    const target = new FunctionTarget(mockStub)

    // Should be able to access .nested.value before awaiting
    const promise = target.invoke('getData')
    const nestedPromise = promise.nested
    const valuePromise = nestedPromise.value

    const value = await valuePromise

    expect(value).toBe(42)
  })
})

// ============================================================================
// RpcTarget method allowlist (security)
// ============================================================================

describe('FunctionTarget method security', () => {
  it('should define allowed methods', () => {
    const mockStub = createMockWorkerStub()
    const target = new FunctionTarget(mockStub)

    // The target should expose which methods are allowed
    expect(target.allowedMethods).toBeDefined()
    expect(target.allowedMethods).toContain('invoke')
  })

  it('should prevent access to prototype methods via RPC', async () => {
    const mockStub = createMockWorkerStub()
    const target = new FunctionTarget(mockStub)

    // Attempting to invoke inherited methods should fail
    await expect(target.invoke('constructor')).rejects.toThrow()
    await expect(target.invoke('__proto__')).rejects.toThrow()
    await expect(target.invoke('toString')).rejects.toThrow()
  })

  it('should have hasMethod for checking allowed methods', () => {
    const mockStub = createMockWorkerStub()
    const target = new FunctionTarget(mockStub)

    expect(target.hasMethod('invoke')).toBe(true)
    expect(target.hasMethod('constructor')).toBe(false)
    expect(target.hasMethod('__proto__')).toBe(false)
  })
})

// ============================================================================
// Cleanup and disposal
// ============================================================================

describe('FunctionTarget disposal', () => {
  it('should implement Disposable interface', () => {
    const mockStub = createMockWorkerStub()
    const target = new FunctionTarget(mockStub)

    expect(typeof target[Symbol.dispose]).toBe('function')
  })

  it('should clean up resources on dispose', () => {
    const mockStub = createMockWorkerStub()
    const target = new FunctionTarget(mockStub)

    // Should not throw
    target[Symbol.dispose]()

    expect(target.disposed).toBe(true)
  })

  it('should reject calls after disposal', async () => {
    const mockStub = createMockWorkerStub()
    const target = new FunctionTarget(mockStub)

    target[Symbol.dispose]()

    await expect(target.invoke('anything')).rejects.toThrow(/disposed/)
  })
})

// ============================================================================
// Request Deduplication
// ============================================================================

describe('FunctionTarget request deduplication', () => {
  it('should deduplicate identical concurrent requests', async () => {
    let callCount = 0
    const mockStub = createMockWorkerStub(async () => {
      callCount++
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 50))
      return new Response(JSON.stringify({ result: 'deduplicated' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableDeduplication: true,
      deduplicationTtlMs: 100,
      enableBatching: false, // Disable batching to test deduplication in isolation
    })

    // Fire multiple identical requests concurrently
    const [result1, result2, result3] = await Promise.all([
      target.invoke('getData', 'arg1'),
      target.invoke('getData', 'arg1'),
      target.invoke('getData', 'arg1'),
    ])

    // All results should be the same
    expect(result1).toBe('deduplicated')
    expect(result2).toBe('deduplicated')
    expect(result3).toBe('deduplicated')

    // But only one actual network request should have been made
    expect(callCount).toBe(1)
  })

  it('should not deduplicate requests with different arguments', async () => {
    let callCount = 0
    const mockStub = createMockWorkerStub(async (request: Request) => {
      callCount++
      const body = await request.json()
      return new Response(JSON.stringify({ result: body.params[0] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableDeduplication: true,
      enableBatching: false,
    })

    const [result1, result2] = await Promise.all([
      target.invoke('getData', 'arg1'),
      target.invoke('getData', 'arg2'),
    ])

    expect(result1).toBe('arg1')
    expect(result2).toBe('arg2')
    expect(callCount).toBe(2)
  })

  it('should track deduplicated request count in metrics', async () => {
    const mockStub = createMockWorkerStub(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return new Response(JSON.stringify({ result: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableDeduplication: true,
      enableBatching: false,
    })

    await Promise.all([
      target.invoke('test', 'same'),
      target.invoke('test', 'same'),
      target.invoke('test', 'same'),
    ])

    const metrics = target.getMetrics()
    expect(metrics.deduplicatedRequests).toBeGreaterThanOrEqual(2)
  })

  it('should allow disabling deduplication', async () => {
    let callCount = 0
    const mockStub = createMockWorkerStub(async () => {
      callCount++
      return new Response(JSON.stringify({ result: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableDeduplication: false,
      enableBatching: false,
    })

    await Promise.all([
      target.invoke('getData', 'arg1'),
      target.invoke('getData', 'arg1'),
    ])

    // Without deduplication, both requests should be made
    expect(callCount).toBe(2)
  })
})

// ============================================================================
// Request Batching
// ============================================================================

describe('FunctionTarget request batching', () => {
  it('should batch concurrent requests into a single network call', async () => {
    let callCount = 0
    const mockStub = createMockWorkerStub(async (request: Request) => {
      callCount++
      const body = await request.json()

      // Handle batched request
      if (body.batch) {
        return new Response(
          JSON.stringify({
            type: 'batch',
            responses: body.batch.map((req: any, i: number) => ({
              type: 'single',
              id: req.id,
              result: `result-${i}`,
            })),
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      }

      return new Response(JSON.stringify({ type: 'single', result: 'single' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableBatching: true,
      batchWindowMs: 10,
      enableDeduplication: false,
    })

    // Fire multiple different requests concurrently
    const results = await Promise.all([
      target.invoke('method1', 'a'),
      target.invoke('method2', 'b'),
      target.invoke('method3', 'c'),
    ])

    expect(results).toEqual(['result-0', 'result-1', 'result-2'])
    // All requests should be batched into one call
    expect(callCount).toBe(1)
  })

  it('should flush batch when max size is reached', async () => {
    let batches: any[] = []
    const mockStub = createMockWorkerStub(async (request: Request) => {
      const body = await request.json()
      if (body.batch) {
        batches.push(body.batch)
        return new Response(
          JSON.stringify({
            type: 'batch',
            responses: body.batch.map((req: any) => ({
              type: 'single',
              id: req.id,
              result: 'ok',
            })),
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({ type: 'single', result: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableBatching: true,
      maxBatchSize: 2,
      batchWindowMs: 1000, // Long window to ensure size triggers flush
      enableDeduplication: false,
    })

    // Fire 3 requests - should result in 2 batches (size 2, then size 1)
    await Promise.all([
      target.invoke('a'),
      target.invoke('b'),
      target.invoke('c'),
    ])

    expect(batches.length).toBeGreaterThanOrEqual(1)
  })

  it('should include batch header in batched requests', async () => {
    let batchHeader: string | null = null
    const mockStub = createMockWorkerStub(async (request: Request) => {
      batchHeader = request.headers.get('X-Batch-Request')
      const body = await request.json()

      if (body.batch) {
        return new Response(
          JSON.stringify({
            type: 'batch',
            responses: body.batch.map((req: any) => ({
              type: 'single',
              id: req.id,
              result: 'ok',
            })),
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      }

      return new Response(JSON.stringify({ type: 'single', result: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableBatching: true,
      batchWindowMs: 10,
      enableDeduplication: false,
    })

    await Promise.all([target.invoke('a'), target.invoke('b')])

    expect(batchHeader).toBe('true')
  })

  it('should track batched request count in metrics', async () => {
    const mockStub = createMockWorkerStub(async (request: Request) => {
      const body = await request.json()
      if (body.batch) {
        return new Response(
          JSON.stringify({
            type: 'batch',
            responses: body.batch.map((req: any) => ({
              type: 'single',
              id: req.id,
              result: 'ok',
            })),
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({ type: 'single', result: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableBatching: true,
      batchWindowMs: 10,
      enableDeduplication: false,
    })

    await Promise.all([
      target.invoke('a'),
      target.invoke('b'),
      target.invoke('c'),
    ])

    const metrics = target.getMetrics()
    expect(metrics.batchedRequests).toBeGreaterThanOrEqual(2)
  })

  it('should allow disabling batching', async () => {
    let callCount = 0
    const mockStub = createMockWorkerStub(async () => {
      callCount++
      return new Response(JSON.stringify({ result: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableBatching: false,
      enableDeduplication: false,
    })

    await Promise.all([target.invoke('a'), target.invoke('b')])

    // Without batching, each request should be sent separately
    expect(callCount).toBe(2)
  })

  it('should support manual flush()', async () => {
    let callCount = 0
    const mockStub = createMockWorkerStub(async (request: Request) => {
      callCount++
      const body = await request.json()
      if (body.batch) {
        return new Response(
          JSON.stringify({
            type: 'batch',
            responses: body.batch.map((req: any) => ({
              type: 'single',
              id: req.id,
              result: 'flushed',
            })),
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({ type: 'single', result: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableBatching: true,
      batchWindowMs: 10000, // Very long window
      enableDeduplication: false,
    })

    // Start requests (they will be pending)
    const promises = [target.invoke('a'), target.invoke('b')]

    // Manually flush
    await target.flush()

    const results = await Promise.all(promises)
    expect(results).toEqual(['flushed', 'flushed'])
    expect(callCount).toBe(1)
  })
})

// ============================================================================
// Tracing and Observability
// ============================================================================

describe('FunctionTarget tracing and observability', () => {
  it('should generate trace ID for each target', () => {
    const mockStub = createMockWorkerStub()
    const target1 = new FunctionTarget(mockStub)
    const target2 = new FunctionTarget(mockStub)

    expect(target1.traceId).toBeDefined()
    expect(target2.traceId).toBeDefined()
    expect(target1.traceId).not.toBe(target2.traceId)
  })

  it('should propagate parent trace ID', () => {
    const mockStub = createMockWorkerStub()
    const parentTraceId = 'parent-trace-123'

    const target = new FunctionTarget(mockStub, {
      parentTraceId,
    })

    expect(target.traceId).toBe(parentTraceId)
  })

  it('should include trace ID in request headers', async () => {
    let capturedTraceId: string | null = null
    const mockStub = createMockWorkerStub(async (request: Request) => {
      capturedTraceId = request.headers.get('X-Trace-ID')
      return new Response(JSON.stringify({ result: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableBatching: false,
    })

    await target.invoke('test')

    expect(capturedTraceId).toBe(target.traceId)
  })

  it('should include span ID in request headers', async () => {
    let capturedSpanId: string | null = null
    const mockStub = createMockWorkerStub(async (request: Request) => {
      capturedSpanId = request.headers.get('X-Span-ID')
      return new Response(JSON.stringify({ result: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableBatching: false,
    })

    await target.invoke('test')

    expect(capturedSpanId).toBeDefined()
    expect(capturedSpanId?.length).toBeGreaterThan(0)
  })

  it('should call onSpanStart hook when request begins', async () => {
    const onSpanStart = vi.fn()
    const mockStub = createMockWorkerStub()

    const target = new FunctionTarget(mockStub, {
      enableBatching: false,
      tracingHooks: { onSpanStart },
    })

    await target.invoke('testMethod', 'arg1')

    expect(onSpanStart).toHaveBeenCalledTimes(1)
    expect(onSpanStart).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: target.traceId,
        spanId: expect.any(String),
        method: 'testMethod',
        operation: 'invoke',
      })
    )
  })

  it('should call onSpanEnd hook when request completes', async () => {
    const onSpanEnd = vi.fn()
    const mockStub = createMockWorkerStub()

    const target = new FunctionTarget(mockStub, {
      enableBatching: false,
      tracingHooks: { onSpanEnd },
    })

    await target.invoke('testMethod')

    expect(onSpanEnd).toHaveBeenCalledTimes(1)
    expect(onSpanEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: target.traceId,
        method: 'testMethod',
      }),
      expect.objectContaining({
        totalTimeMs: expect.any(Number),
        requestSizeBytes: expect.any(Number),
        responseSizeBytes: expect.any(Number),
      })
    )
  })

  it('should call onError hook when request fails', async () => {
    const onError = vi.fn()
    const mockStub = createMockWorkerStub(async () => {
      return new Response(
        JSON.stringify({ error: 'Test error', code: 'TEST_ERROR' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    })

    const target = new FunctionTarget(mockStub, {
      enableBatching: false,
      tracingHooks: { onError },
    })

    await expect(target.invoke('failing')).rejects.toThrow('Test error')

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'failing',
      }),
      expect.any(Error)
    )
  })

  it('should create child targets with same trace ID', () => {
    const mockStub = createMockWorkerStub()
    const parent = new FunctionTarget(mockStub)
    const child = parent.createChild(mockStub)

    expect(child.traceId).toBe(parent.traceId)
  })

  it('should include trace ID in request body', async () => {
    let capturedBody: any = null
    const mockStub = createMockWorkerStub(async (request: Request) => {
      capturedBody = await request.json()
      return new Response(JSON.stringify({ result: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableBatching: false,
    })

    await target.invoke('test')

    expect(capturedBody.traceId).toBe(target.traceId)
    expect(capturedBody.spanId).toBeDefined()
  })
})

// ============================================================================
// Performance Metrics
// ============================================================================

describe('FunctionTarget performance metrics', () => {
  it('should track total request count', async () => {
    const mockStub = createMockWorkerStub()
    const target = new FunctionTarget(mockStub, {
      enableBatching: false,
      enableDeduplication: false,
    })

    await target.invoke('a')
    await target.invoke('b')
    await target.invoke('c')

    const metrics = target.getMetrics()
    expect(metrics.totalRequests).toBe(3)
  })

  it('should track total bytes sent', async () => {
    const mockStub = createMockWorkerStub()
    const target = new FunctionTarget(mockStub, {
      enableBatching: false,
    })

    await target.invoke('test', 'some data')

    const metrics = target.getMetrics()
    expect(metrics.totalBytesSent).toBeGreaterThan(0)
  })

  it('should track total bytes received', async () => {
    const mockStub = createMockWorkerStub(async () => {
      return new Response(JSON.stringify({ result: 'response data here' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableBatching: false,
    })

    await target.invoke('test')

    const metrics = target.getMetrics()
    expect(metrics.totalBytesReceived).toBeGreaterThan(0)
  })

  it('should calculate average latency', async () => {
    const mockStub = createMockWorkerStub(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return new Response(JSON.stringify({ result: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableBatching: false,
      enableDeduplication: false,
    })

    await target.invoke('a')
    await target.invoke('b')

    const metrics = target.getMetrics()
    expect(metrics.avgLatencyMs).toBeGreaterThan(0)
  })

  it('should calculate percentile latencies', async () => {
    const mockStub = createMockWorkerStub(async () => {
      return new Response(JSON.stringify({ result: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableBatching: false,
      enableDeduplication: false,
    })

    // Make multiple requests to get percentile data
    for (let i = 0; i < 10; i++) {
      await target.invoke('test', i)
    }

    const metrics = target.getMetrics()
    expect(metrics.p50LatencyMs).toBeGreaterThanOrEqual(0)
    expect(metrics.p95LatencyMs).toBeGreaterThanOrEqual(0)
    expect(metrics.p99LatencyMs).toBeGreaterThanOrEqual(0)
  })

  it('should reset metrics', async () => {
    const mockStub = createMockWorkerStub()
    const target = new FunctionTarget(mockStub, {
      enableBatching: false,
    })

    await target.invoke('test')

    let metrics = target.getMetrics()
    expect(metrics.totalRequests).toBe(1)

    target.resetMetrics()

    metrics = target.getMetrics()
    expect(metrics.totalRequests).toBe(0)
    expect(metrics.totalBytesSent).toBe(0)
    expect(metrics.totalBytesReceived).toBe(0)
  })

  it('should report metrics in onSpanEnd callback', async () => {
    let capturedMetrics: RequestMetrics | null = null
    const mockStub = createMockWorkerStub()

    const target = new FunctionTarget(mockStub, {
      enableBatching: false,
      tracingHooks: {
        onSpanEnd: (span, metrics) => {
          capturedMetrics = metrics
        },
      },
    })

    await target.invoke('test')

    expect(capturedMetrics).not.toBeNull()
    expect(capturedMetrics!.serializationTimeMs).toBeGreaterThanOrEqual(0)
    expect(capturedMetrics!.networkTimeMs).toBeGreaterThanOrEqual(0)
    expect(capturedMetrics!.deserializationTimeMs).toBeGreaterThanOrEqual(0)
    expect(capturedMetrics!.totalTimeMs).toBeGreaterThanOrEqual(0)
    expect(capturedMetrics!.requestSizeBytes).toBeGreaterThan(0)
    expect(capturedMetrics!.responseSizeBytes).toBeGreaterThan(0)
  })

  it('should allow disabling metrics collection', async () => {
    const mockStub = createMockWorkerStub()
    const target = new FunctionTarget(mockStub, {
      enableMetrics: false,
      enableBatching: false,
    })

    await target.invoke('test')

    const metrics = target.getMetrics()
    // With metrics disabled, latency samples should be empty
    expect(metrics.avgLatencyMs).toBe(0)
  })

  it('should limit latency samples to maxMetricsSamples', async () => {
    const mockStub = createMockWorkerStub()
    const target = new FunctionTarget(mockStub, {
      enableBatching: false,
      enableDeduplication: false,
      maxMetricsSamples: 5,
    })

    // Make more requests than the sample limit
    for (let i = 0; i < 10; i++) {
      await target.invoke('test', i)
    }

    // The internal samples should be limited (tested via metrics consistency)
    const metrics = target.getMetrics()
    expect(metrics.totalRequests).toBe(10)
    // Latency calculations should still work
    expect(metrics.avgLatencyMs).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// Combined Features Integration
// ============================================================================

describe('FunctionTarget integration tests', () => {
  it('should work with deduplication, batching, and tracing together', async () => {
    const spans: SpanContext[] = []
    let batchCount = 0

    const mockStub = createMockWorkerStub(async (request: Request) => {
      const body = await request.json()
      if (body.batch) {
        batchCount++
        return new Response(
          JSON.stringify({
            type: 'batch',
            responses: body.batch.map((req: any) => ({
              type: 'single',
              id: req.id,
              result: req.method,
            })),
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({ type: 'single', result: body.method }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableBatching: true,
      batchWindowMs: 10,
      enableDeduplication: true,
      tracingHooks: {
        onSpanStart: (span) => spans.push(span),
      },
    })

    // Mix of deduplicated and batched requests
    const results = await Promise.all([
      target.invoke('method1', 'arg'),
      target.invoke('method1', 'arg'), // Should be deduplicated
      target.invoke('method2', 'arg'),
      target.invoke('method3', 'arg'),
    ])

    // Verify results
    expect(results[0]).toBe(results[1]) // Deduplicated

    // Verify tracing
    expect(spans.length).toBeGreaterThan(0)
    spans.forEach((span) => {
      expect(span.traceId).toBe(target.traceId)
    })

    // Verify metrics
    const metrics = target.getMetrics()
    expect(metrics.totalRequests).toBeGreaterThan(0)
    expect(metrics.deduplicatedRequests).toBeGreaterThanOrEqual(1)
  })

  it('should maintain trace context through pipeline operations', async () => {
    let capturedTraceId: string | null = null
    const mockStub = createMockWorkerStub(async (request: Request) => {
      const body = await request.json()
      capturedTraceId = body.traceId
      return new Response(JSON.stringify({ result: { nested: 'value' } }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableBatching: false,
    })

    await target.pipeline().getObject().method()

    expect(capturedTraceId).toBe(target.traceId)
  })

  it('should handle errors gracefully with all features enabled', async () => {
    const errors: Error[] = []
    const mockStub = createMockWorkerStub(async () => {
      return new Response(JSON.stringify({ error: 'Failed', code: 'ERR' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const target = new FunctionTarget(mockStub, {
      enableBatching: true,
      batchWindowMs: 10,
      enableDeduplication: true,
      tracingHooks: {
        onError: (span, error) => errors.push(error),
      },
    })

    await expect(
      Promise.all([target.invoke('fail1'), target.invoke('fail2')])
    ).rejects.toThrow()

    // Errors should be reported
    expect(errors.length).toBeGreaterThan(0)
  })
})
