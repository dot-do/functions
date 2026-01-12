/**
 * FunctionTarget - capnweb RPC wrapper for WorkerStub
 *
 * This class extends capnweb's RpcTarget to wrap a WorkerStub for invoking
 * serverless functions. It provides:
 * - JSON-RPC style method invocation via fetch()
 * - Response deserialization
 * - Promise pipelining for chained operations
 * - Method security (allowlist, prototype pollution prevention)
 * - Disposable interface for resource cleanup
 * - Request deduplication for identical concurrent calls
 * - Tracing/observability with span/trace IDs
 * - Performance metrics (timing, request sizes)
 * - Optimized serialization for common patterns
 *
 * Reference: projects/dot-do-capnweb/src/core.ts
 */

import { RpcTarget } from 'capnweb'

// ============================================================================
// Types
// ============================================================================

/**
 * WorkerStub interface matching Cloudflare's WorkerStub
 */
export interface WorkerStub {
  fetch(request: Request): Promise<Response>
  getEntrypoint?(name?: string): WorkerEntrypoint
}

interface WorkerEntrypoint {
  fetch(request: Request): Promise<Response>
}

/**
 * Tracing hook interface for observability
 */
export interface TracingHooks {
  /**
   * Called when a span starts
   */
  onSpanStart?(span: SpanContext): void

  /**
   * Called when a span ends
   */
  onSpanEnd?(span: SpanContext, metrics: RequestMetrics): void

  /**
   * Called when an error occurs
   */
  onError?(span: SpanContext, error: Error): void
}

/**
 * Span context for tracing
 */
export interface SpanContext {
  /** Unique trace ID (propagated across calls) */
  traceId: string
  /** Unique span ID for this specific call */
  spanId: string
  /** Parent span ID if this is a child span */
  parentSpanId?: string
  /** Method being called */
  method: string
  /** Operation name (e.g., 'invoke', 'pipeline') */
  operation: string
  /** Start timestamp (high-resolution) */
  startTime: number
  /** Custom attributes */
  attributes: Record<string, unknown>
}

/**
 * Performance metrics for a request
 */
export interface RequestMetrics {
  /** Request serialization time in ms */
  serializationTimeMs: number
  /** Network round-trip time in ms */
  networkTimeMs: number
  /** Response deserialization time in ms */
  deserializationTimeMs: number
  /** Total request time in ms */
  totalTimeMs: number
  /** Request body size in bytes */
  requestSizeBytes: number
  /** Response body size in bytes */
  responseSizeBytes: number
  /** Whether this request was deduplicated */
  deduplicated: boolean
  /** Whether this request was batched */
  batched: boolean
  /** Number of operations in batch (if batched) */
  batchSize?: number
}

/**
 * Aggregated metrics over time
 */
export interface AggregatedMetrics {
  /** Total number of requests */
  totalRequests: number
  /** Number of deduplicated requests */
  deduplicatedRequests: number
  /** Number of batched requests */
  batchedRequests: number
  /** Average latency in ms */
  avgLatencyMs: number
  /** P50 latency in ms */
  p50LatencyMs: number
  /** P95 latency in ms */
  p95LatencyMs: number
  /** P99 latency in ms */
  p99LatencyMs: number
  /** Total bytes sent */
  totalBytesSent: number
  /** Total bytes received */
  totalBytesReceived: number
}

/**
 * Configuration options for FunctionTarget
 */
export interface FunctionTargetOptions {
  /**
   * Timeout in milliseconds for RPC calls
   * @default 30000
   */
  timeout?: number

  /**
   * Number of retry attempts for failed calls
   * @default 0
   */
  retries?: number

  /**
   * Serialization format
   * @default 'json'
   */
  serializer?: 'json' | 'msgpack'

  /**
   * Base URL for RPC requests
   * @default 'https://rpc.local/'
   */
  baseUrl?: string

  /**
   * Enable request deduplication for identical concurrent calls
   * @default true
   */
  enableDeduplication?: boolean

  /**
   * TTL for deduplication cache in ms (how long to wait for identical requests)
   * @default 100
   */
  deduplicationTtlMs?: number

  /**
   * Enable automatic batching of concurrent requests
   * @default true
   */
  enableBatching?: boolean

  /**
   * Maximum time to wait for batching more requests (ms)
   * @default 5
   */
  batchWindowMs?: number

  /**
   * Maximum number of requests to batch together
   * @default 50
   */
  maxBatchSize?: number

  /**
   * Tracing hooks for observability
   */
  tracingHooks?: TracingHooks

  /**
   * Parent trace ID to propagate
   */
  parentTraceId?: string

  /**
   * Enable performance metrics collection
   * @default true
   */
  enableMetrics?: boolean

  /**
   * Maximum number of latency samples to keep for percentile calculations
   * @default 1000
   */
  maxMetricsSamples?: number
}

/**
 * Required options for FunctionTarget after defaults are applied.
 * These are the options that have guaranteed values at runtime.
 */
type FunctionTargetRequiredOptions = Required<
  Pick<
    FunctionTargetOptions,
    | 'timeout'
    | 'retries'
    | 'serializer'
    | 'baseUrl'
    | 'enableDeduplication'
    | 'deduplicationTtlMs'
    | 'enableBatching'
    | 'batchWindowMs'
    | 'maxBatchSize'
    | 'enableMetrics'
    | 'maxMetricsSamples'
  >
>

/**
 * Full resolved options including optional tracing hooks.
 */
type ResolvedFunctionTargetOptions = FunctionTargetRequiredOptions &
  Pick<FunctionTargetOptions, 'tracingHooks' | 'parentTraceId'>

/**
 * JSON-RPC style request body
 */
interface RpcRequest {
  id: string
  method: string
  params: unknown[]
  pipeline?: PipelineOperation[]
  /** Trace ID for distributed tracing */
  traceId?: string
  /** Span ID for this specific request */
  spanId?: string
  /** Parent span ID if this is a child request */
  parentSpanId?: string
}

/**
 * Batched RPC request containing multiple operations
 */
interface BatchedRpcRequest {
  batch: RpcRequest[]
  traceId?: string
}

/**
 * Pipeline operation for chained calls
 */
interface PipelineOperation {
  id: string
  method: string
  params: unknown[]
  dependsOn?: string
}

/**
 * Single RPC response with type discriminator
 */
export interface SingleRpcResponse {
  /** Type discriminator for discriminated union */
  type: 'single'
  id?: string
  result?: unknown
  error?: string
  code?: string
  failedAt?: number
}

/**
 * Batched response containing results for multiple requests with type discriminator
 */
export interface BatchedRpcResponse {
  /** Type discriminator for discriminated union */
  type: 'batch'
  responses: SingleRpcResponse[]
}

/**
 * Discriminated union type for RPC responses
 * Use response.type to determine which variant you have
 */
export type RpcResponse = SingleRpcResponse | BatchedRpcResponse

/**
 * In-flight request tracking for deduplication
 */
interface InFlightRequest {
  promise: Promise<unknown>
  requestKey: string
  timestamp: number
}

/**
 * Custom error class for RPC errors
 */
export class RpcError extends Error {
  code?: string
  failedAt?: number

  constructor(message: string, code?: string, failedAt?: number) {
    super(message)
    this.name = 'RpcError'
    // Only assign optional properties if defined (for exactOptionalPropertyTypes)
    if (code !== undefined) {
      this.code = code
    }
    if (failedAt !== undefined) {
      this.failedAt = failedAt
    }
  }
}

// ============================================================================
// Blocked Methods (security)
// ============================================================================

/**
 * Methods that are blocked for security reasons
 */
const BLOCKED_METHODS = new Set([
  // Object prototype methods
  'constructor',
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf',
  // Function prototype methods
  'apply',
  'bind',
  'call',
])

// ============================================================================
// ID Generation
// ============================================================================

let requestIdCounter = 0
let traceIdCounter = 0
let spanIdCounter = 0

function generateRequestId(): string {
  return `req_${Date.now()}_${++requestIdCounter}`
}

/**
 * Generate a unique trace ID (W3C Trace Context compatible format)
 */
function generateTraceId(): string {
  const timestamp = Date.now().toString(16).padStart(12, '0')
  const random = Math.random().toString(16).slice(2, 10)
  const counter = (++traceIdCounter).toString(16).padStart(4, '0')
  return `${timestamp}${random}${counter}`.slice(0, 32)
}

/**
 * Generate a unique span ID
 */
function generateSpanId(): string {
  const random = Math.random().toString(16).slice(2, 10)
  const counter = (++spanIdCounter).toString(16).padStart(8, '0')
  return `${random}${counter}`.slice(0, 16)
}

/**
 * Get high-resolution timestamp (works in both Node.js and browser)
 */
function getHighResTime(): number {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now()
  }
  return Date.now()
}

/**
 * Generate a cache key for request deduplication
 */
function generateRequestKey(method: string, params: unknown[]): string {
  return `${method}:${fastSerialize(params)}`
}

// ============================================================================
// Optimized Serialization
// ============================================================================

/**
 * Fast serialization for common patterns
 * Uses optimized paths for primitives and simple objects
 */
function fastSerialize(value: unknown): string {
  // Handle primitives quickly
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'

  const type = typeof value
  if (type === 'string') return JSON.stringify(value)
  if (type === 'number' || type === 'boolean') return String(value)

  // Handle arrays
  if (Array.isArray(value)) {
    // Optimization: check if all elements are primitives
    if (value.length <= 10 && value.every(isPrimitive)) {
      return '[' + value.map(fastSerialize).join(',') + ']'
    }
    return JSON.stringify(value)
  }

  // Handle plain objects
  if (type === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)

    // Optimization: small objects with primitive values
    if (keys.length <= 5 && keys.every((k) => isPrimitive(obj[k]))) {
      const parts = keys.map((k) => `${JSON.stringify(k)}:${fastSerialize(obj[k])}`)
      return '{' + parts.join(',') + '}'
    }
    return JSON.stringify(value)
  }

  return JSON.stringify(value)
}

/**
 * Check if a value is a primitive
 */
function isPrimitive(value: unknown): boolean {
  if (value === null || value === undefined) return true
  const type = typeof value
  return type === 'string' || type === 'number' || type === 'boolean'
}

/**
 * Calculate byte size of a string (UTF-8)
 */
function getByteSize(str: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length
  }
  // Fallback for older environments
  let bytes = 0
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code < 0xd800 || code >= 0xe000) bytes += 3
    else {
      i++
      bytes += 4
    }
  }
  return bytes
}

// ============================================================================
// Pipeline Proxy
// ============================================================================

/**
 * Internal state for pipeline proxies
 */
interface PipelineState {
  target: FunctionTarget
  operations: PipelineOperation[]
  lastId?: string
}

/**
 * Creates a proxy for promise pipelining
 *
 * Returns a thenable proxy that can be awaited and also supports
 * chained method calls that build up a pipeline of operations.
 */
function createPipelineProxy(
  target: FunctionTarget,
  operations: PipelineOperation[],
  lastId?: string
): PipelinedPromise {
  // Store state in a separate object to avoid issues with Promise constructor timing
  // Only include lastId if defined (for exactOptionalPropertyTypes)
  const state: PipelineState = lastId !== undefined
    ? { target, operations, lastId }
    : { target, operations }

  // Create a thenable object as the base
  const thenable = {
    __state: state,
    then(onfulfilled?: (value: unknown) => unknown, onrejected?: (reason: unknown) => unknown): Promise<unknown> {
      return target
        .executePipeline(operations)
        .then(onfulfilled, onrejected)
    },
    catch(onrejected?: (reason: unknown) => unknown): Promise<unknown> {
      return target
        .executePipeline(operations)
        .catch(onrejected)
    },
    finally(onfinally?: () => void): Promise<unknown> {
      return target
        .executePipeline(operations)
        .finally(onfinally)
    },
  }

  return new Proxy(thenable as any, {
    get(innerTarget, prop) {
      // Return built-in Promise methods directly
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return innerTarget[prop].bind(innerTarget)
      }

      // Skip Symbol properties
      if (typeof prop === 'symbol') {
        return undefined
      }

      // Skip internal/prototype properties that shouldn't become operations
      if (prop === 'constructor' || prop === '__proto__' || prop === 'prototype' || prop === '__state') {
        return undefined
      }

      // Handle other properties - chain as new pipeline operation
      if (typeof prop === 'string') {
        const { target: funcTarget, operations: ops, lastId: currentLastId } = innerTarget.__state as PipelineState
        // Return a function that creates a new operation
        return (...args: unknown[]) => {
          const opId = generateRequestId()
          // Only include dependsOn if defined (for exactOptionalPropertyTypes)
          const operation: PipelineOperation = currentLastId !== undefined
            ? { id: opId, method: prop, params: args, dependsOn: currentLastId }
            : { id: opId, method: prop, params: args }
          const newOps = [...ops, operation]
          return createPipelineProxy(funcTarget, newOps, opId)
        }
      }

      return undefined
    },
  }) as PipelinedPromise
}

/**
 * Pipelined promise interface
 */
interface PipelinedPromise extends Promise<unknown> {
  // Allow dynamic method calls to return PipelinedPromise
  // Using a more specific index signature that doesn't conflict with Promise methods
}

/**
 * Property proxy interface for accessing nested properties on promises.
 *
 * This interface represents a thenable object that allows chained property access.
 * When awaited, it navigates to the specified path in the resolved value.
 * Property access returns another PropertyProxy for further chaining.
 *
 * Note: We use PromiseLike<unknown> as the base with an index signature.
 * The actual implementation provides then/catch/finally via the Proxy handler.
 *
 * @example
 * ```ts
 * // Access nested property on promise result
 * const value = await target.invoke('getData').nested.property
 * ```
 */
type PropertyProxy = PromiseLike<unknown> & {
  /** Access a nested property, returning another PropertyProxy for chaining */
  [key: string]: PropertyProxy
}

// ============================================================================
// Property Access Proxy
// ============================================================================

/**
 * Creates a proxy for property access on promises (e.g., promise.nested.value)
 */
function createPropertyProxy(promise: Promise<unknown>, path: string[]): PropertyProxy {
  // Create a base object that the proxy will wrap
  const baseTarget = {} as PropertyProxy

  return new Proxy(baseTarget, {
    get(_, prop): unknown {
      // Handle Promise methods
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        // Navigate to the nested property when the promise resolves
        const navigatedPromise = promise.then((value: unknown) => {
          let current: unknown = value
          for (const key of path) {
            if (current == null) return undefined
            current = (current as Record<string, unknown>)[key]
          }
          return current
        })

        if (prop === 'then') {
          return <TResult1 = unknown, TResult2 = never>(
            onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
            onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
          ): Promise<TResult1 | TResult2> => navigatedPromise.then(onfulfilled, onrejected)
        } else if (prop === 'catch') {
          return <TResult = never>(
            onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
          ): Promise<unknown | TResult> => navigatedPromise.catch(onrejected)
        } else {
          return (onfinally?: (() => void) | null): Promise<unknown> => navigatedPromise.finally(onfinally)
        }
      }

      // Handle property access - extend the path
      if (typeof prop === 'string') {
        return createPropertyProxy(promise, [...path, prop])
      }

      return undefined
    },
  })
}

// ============================================================================
// FunctionTarget Class
// ============================================================================

/**
 * Pending batch item for batched requests
 */
interface PendingBatchItem {
  request: RpcRequest
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  span: SpanContext
  metrics: Partial<RequestMetrics>
}

/**
 * FunctionTarget extends capnweb RpcTarget to wrap a WorkerStub.
 *
 * It enables RPC-style invocation of serverless functions with:
 * - JSON serialization of method calls
 * - Response deserialization
 * - Promise pipelining
 * - Security allowlist
 * - Request deduplication
 * - Automatic batching
 * - Tracing and observability
 * - Performance metrics
 */
export class FunctionTarget extends RpcTarget {
  private stub: WorkerStub
  private _options: ResolvedFunctionTargetOptions
  private _disposed: boolean = false
  private _allowedMethods: string[] = ['invoke', 'pipeline', 'hasMethod', 'getMetrics', 'resetMetrics']

  // Tracing
  private _traceId: string
  private _currentSpanId?: string

  // Deduplication
  private _inFlightRequests: Map<string, InFlightRequest> = new Map()

  // Batching
  private _pendingBatch: PendingBatchItem[] = []
  private _batchTimer: ReturnType<typeof setTimeout> | null = null

  // Metrics
  private _latencySamples: number[] = []
  private _totalRequests: number = 0
  private _deduplicatedRequests: number = 0
  private _batchedRequests: number = 0
  private _totalBytesSent: number = 0
  private _totalBytesReceived: number = 0

  constructor(stub: WorkerStub, options: FunctionTargetOptions = {}) {
    super()
    this.stub = stub
    // Build options, only including optional properties if defined (for exactOptionalPropertyTypes)
    const baseOptions = {
      timeout: options.timeout ?? 30000,
      retries: options.retries ?? 0,
      serializer: options.serializer ?? 'json',
      baseUrl: options.baseUrl ?? 'https://rpc.local/',
      enableDeduplication: options.enableDeduplication ?? true,
      deduplicationTtlMs: options.deduplicationTtlMs ?? 100,
      enableBatching: options.enableBatching ?? true,
      batchWindowMs: options.batchWindowMs ?? 5,
      maxBatchSize: options.maxBatchSize ?? 50,
      enableMetrics: options.enableMetrics ?? true,
      maxMetricsSamples: options.maxMetricsSamples ?? 1000,
    } as const
    this._options = {
      ...baseOptions,
      ...(options.tracingHooks !== undefined && { tracingHooks: options.tracingHooks }),
      ...(options.parentTraceId !== undefined && { parentTraceId: options.parentTraceId }),
    } as ResolvedFunctionTargetOptions

    // Initialize tracing
    this._traceId = options.parentTraceId ?? generateTraceId()
  }

  /**
   * Get the current options
   */
  get options(): FunctionTargetOptions {
    return this._options
  }

  /**
   * Get the list of allowed methods
   */
  get allowedMethods(): string[] {
    return [...this._allowedMethods]
  }

  /**
   * Check if a method is allowed
   */
  hasMethod(methodName: string): boolean {
    return this._allowedMethods.includes(methodName)
  }

  /**
   * Check if the target has been disposed
   */
  get disposed(): boolean {
    return this._disposed
  }

  /**
   * Get the current trace ID
   */
  get traceId(): string {
    return this._traceId
  }

  /**
   * Create a child FunctionTarget with the same trace ID
   */
  createChild(stub: WorkerStub, options?: FunctionTargetOptions): FunctionTarget {
    return new FunctionTarget(stub, {
      ...this._options,
      ...options,
      parentTraceId: this._traceId,
    })
  }

  /**
   * Get aggregated performance metrics
   */
  getMetrics(): AggregatedMetrics {
    const samples = [...this._latencySamples].sort((a, b) => a - b)
    const len = samples.length

    return {
      totalRequests: this._totalRequests,
      deduplicatedRequests: this._deduplicatedRequests,
      batchedRequests: this._batchedRequests,
      avgLatencyMs: len > 0 ? samples.reduce((a, b) => a + b, 0) / len : 0,
      p50LatencyMs: len > 0 ? (samples[Math.floor(len * 0.5)] ?? 0) : 0,
      p95LatencyMs: len > 0 ? (samples[Math.floor(len * 0.95)] ?? 0) : 0,
      p99LatencyMs: len > 0 ? (samples[Math.floor(len * 0.99)] ?? 0) : 0,
      totalBytesSent: this._totalBytesSent,
      totalBytesReceived: this._totalBytesReceived,
    }
  }

  /**
   * Reset performance metrics
   */
  resetMetrics(): void {
    this._latencySamples = []
    this._totalRequests = 0
    this._deduplicatedRequests = 0
    this._batchedRequests = 0
    this._totalBytesSent = 0
    this._totalBytesReceived = 0
  }

  /**
   * Record a latency sample for metrics
   */
  private recordLatency(latencyMs: number): void {
    if (!this._options.enableMetrics) return

    this._latencySamples.push(latencyMs)

    // Keep samples bounded
    if (this._latencySamples.length > this._options.maxMetricsSamples) {
      this._latencySamples.shift()
    }
  }

  /**
   * Create a span context for tracing
   */
  private createSpan(method: string, operation: string, attributes?: Record<string, unknown>): SpanContext {
    // Build span with optional parentSpanId (for exactOptionalPropertyTypes)
    const baseSpan = {
      traceId: this._traceId,
      spanId: generateSpanId(),
      method,
      operation,
      startTime: getHighResTime(),
      attributes: attributes ?? {},
    }
    const span: SpanContext = this._currentSpanId !== undefined
      ? { ...baseSpan, parentSpanId: this._currentSpanId }
      : baseSpan

    this._options.tracingHooks?.onSpanStart?.(span)
    return span
  }

  /**
   * End a span and record metrics
   */
  private endSpan(span: SpanContext, metrics: RequestMetrics): void {
    this._options.tracingHooks?.onSpanEnd?.(span, metrics)
  }

  /**
   * Report an error for a span
   */
  private reportError(span: SpanContext, error: Error): void {
    this._options.tracingHooks?.onError?.(span, error)
  }

  /**
   * Invoke a method on the remote function
   *
   * @param methodName - The name of the method to invoke
   * @param args - Arguments to pass to the method
   * @returns A proxied promise that supports property access
   */
  invoke(methodName: string, ...args: unknown[]): PropertyProxy {
    if (this._disposed) {
      return createPropertyProxy(Promise.reject(new Error('FunctionTarget has been disposed')), [])
    }

    // Security check - block dangerous methods
    if (BLOCKED_METHODS.has(methodName)) {
      return createPropertyProxy(Promise.reject(new RpcError(`Method '${methodName}' is not allowed`, 'METHOD_NOT_ALLOWED')), [])
    }

    const span = this.createSpan(methodName, 'invoke', { args })

    const requestId = generateRequestId()
    // Build request body with optional parentSpanId (for exactOptionalPropertyTypes)
    const baseRequestBody = {
      id: requestId,
      method: methodName,
      params: args,
      traceId: this._traceId,
      spanId: span.spanId,
    }
    const requestBody: RpcRequest = span.parentSpanId !== undefined
      ? { ...baseRequestBody, parentSpanId: span.parentSpanId }
      : baseRequestBody

    // Check for deduplication
    if (this._options.enableDeduplication) {
      const requestKey = generateRequestKey(methodName, args)
      const existing = this._inFlightRequests.get(requestKey)

      if (existing && Date.now() - existing.timestamp < this._options.deduplicationTtlMs) {
        this._deduplicatedRequests++
        this._totalRequests++

        // Return existing promise with metrics
        return createPropertyProxy(
          existing.promise.then((result) => {
            const endTime = getHighResTime()
            const metrics: RequestMetrics = {
              serializationTimeMs: 0,
              networkTimeMs: endTime - span.startTime,
              deserializationTimeMs: 0,
              totalTimeMs: endTime - span.startTime,
              requestSizeBytes: 0,
              responseSizeBytes: 0,
              deduplicated: true,
              batched: false,
            }
            this.endSpan(span, metrics)
            this.recordLatency(metrics.totalTimeMs)
            return result
          }),
          []
        )
      }
    }

    // Execute request (possibly batched)
    const promise = this._options.enableBatching
      ? this.enqueueForBatch(requestBody, span)
      : this.executeRequest(requestBody, span)

    // Track for deduplication
    if (this._options.enableDeduplication) {
      const requestKey = generateRequestKey(methodName, args)
      const inFlight: InFlightRequest = {
        promise,
        requestKey,
        timestamp: Date.now(),
      }
      this._inFlightRequests.set(requestKey, inFlight)

      // Clean up after TTL
      promise.finally(() => {
        setTimeout(() => {
          const current = this._inFlightRequests.get(requestKey)
          if (current === inFlight) {
            this._inFlightRequests.delete(requestKey)
          }
        }, this._options.deduplicationTtlMs)
      })
    }

    // Return a proxy that allows property access on the promise
    return createPropertyProxy(promise, [])
  }

  /**
   * Enqueue a request for batching
   */
  private enqueueForBatch(requestBody: RpcRequest, span: SpanContext): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const item: PendingBatchItem = {
        request: requestBody,
        resolve,
        reject,
        span,
        metrics: {},
      }

      this._pendingBatch.push(item)

      // Start batch timer if not already running
      if (!this._batchTimer) {
        this._batchTimer = setTimeout(() => this.flushBatch(), this._options.batchWindowMs)
      }

      // Flush immediately if batch is full
      if (this._pendingBatch.length >= this._options.maxBatchSize) {
        this.flushBatch()
      }
    })
  }

  /**
   * Flush pending batch and execute all requests
   */
  private async flushBatch(): Promise<void> {
    if (this._batchTimer) {
      clearTimeout(this._batchTimer)
      this._batchTimer = null
    }

    const batch = this._pendingBatch
    this._pendingBatch = []

    if (batch.length === 0) return

    // Single request - no batching needed
    if (batch.length === 1) {
      const item = batch[0]!
      try {
        const result = await this.executeRequest(item.request, item.span, false)
        item.resolve(result)
      } catch (error) {
        item.reject(error as Error)
      }
      return
    }

    // Multiple requests - batch them
    this._batchedRequests += batch.length
    const batchSpan = this.createSpan('__batch__', 'batch', { batchSize: batch.length })

    const serializeStart = getHighResTime()
    const batchedRequest: BatchedRpcRequest = {
      batch: batch.map((item) => item.request),
      traceId: this._traceId,
    }
    const bodyStr = JSON.stringify(batchedRequest)
    const serializeEnd = getHighResTime()
    const requestSizeBytes = getByteSize(bodyStr)

    this._totalBytesSent += requestSizeBytes

    const request = new Request(this._options.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Batch-Request': 'true',
        'X-Trace-ID': this._traceId,
        'X-Span-ID': batchSpan.spanId,
      },
      body: bodyStr,
    })

    const networkStart = getHighResTime()

    try {
      const response = await this.stub.fetch(request)
      const networkEnd = getHighResTime()

      const responseText = await response.text()
      const responseSizeBytes = getByteSize(responseText)
      this._totalBytesReceived += responseSizeBytes

      const deserializeStart = getHighResTime()
      const contentType = response.headers.get('Content-Type')

      if (!contentType?.includes('application/json')) {
        throw new RpcError(`Unexpected response: ${responseText}`, 'INVALID_RESPONSE')
      }

      const responseBody = JSON.parse(responseText) as RpcResponse

      const deserializeEnd = getHighResTime()

      // Calculate batch metrics
      const batchMetrics: RequestMetrics = {
        serializationTimeMs: serializeEnd - serializeStart,
        networkTimeMs: networkEnd - networkStart,
        deserializationTimeMs: deserializeEnd - deserializeStart,
        totalTimeMs: deserializeEnd - serializeStart,
        requestSizeBytes,
        responseSizeBytes,
        deduplicated: false,
        batched: true,
        batchSize: batch.length,
      }

      this.endSpan(batchSpan, batchMetrics)
      this.recordLatency(batchMetrics.totalTimeMs)
      this._totalRequests += batch.length

      // Handle response using type discriminator
      if (responseBody.type === 'batch') {
        // TypeScript knows this is BatchedRpcResponse
        for (let i = 0; i < batch.length; i++) {
          const item = batch[i]!
          const itemResponse = responseBody.responses[i]

          // Calculate per-item metrics (approximate)
          const itemMetrics: RequestMetrics = {
            ...batchMetrics,
            batchSize: batch.length,
          }
          this.endSpan(item.span, itemMetrics)

          if (itemResponse?.error) {
            const error = new RpcError(itemResponse.error, itemResponse.code, itemResponse.failedAt)
            this.reportError(item.span, error)
            item.reject(error)
          } else {
            item.resolve(itemResponse?.result)
          }
        }
      } else {
        // TypeScript knows this is SingleRpcResponse (error case or simplified server)
        if (!response.ok || responseBody.error) {
          const error = new RpcError(
            responseBody.error || 'Batch request failed',
            responseBody.code
          )
          for (const item of batch) {
            this.reportError(item.span, error)
            item.reject(error)
          }
        } else {
          // Unexpected: single result for batch
          for (const item of batch) {
            item.resolve(responseBody.result)
          }
        }
      }
    } catch (error) {
      const err = error as Error
      this.reportError(batchSpan, err)
      for (const item of batch) {
        this.reportError(item.span, err)
        item.reject(err)
      }
    }
  }

  /**
   * Create a pipeline for chained operations
   */
  pipeline(): PipelinedPromise {
    if (this._disposed) {
      const rejected = Promise.reject(new Error('FunctionTarget has been disposed'))
      return rejected as unknown as PipelinedPromise
    }

    return createPipelineProxy(this, [])
  }

  /**
   * Execute a pipeline of operations
   * @internal
   */
  async executePipeline(operations: PipelineOperation[]): Promise<unknown> {
    if (this._disposed) {
      throw new Error('FunctionTarget has been disposed')
    }

    if (operations.length === 0) {
      return undefined
    }

    // Separate operations into server operations and local operations
    // Local operations like 'getProperty' can be applied client-side
    const serverOps: PipelineOperation[] = []
    const localOps: PipelineOperation[] = []

    for (const op of operations) {
      if (op.method === 'getProperty') {
        // getProperty is handled locally after server response
        localOps.push(op)
      } else {
        // If we have pending local ops, they depend on this server op
        // Push them to server and reset
        serverOps.push(op)
      }
    }

    const span = this.createSpan('__pipeline__', 'pipeline', {
      operationCount: operations.length,
      serverOps: serverOps.length,
      localOps: localOps.length,
    })

    const requestId = generateRequestId()
    // Build request body with optional parentSpanId (for exactOptionalPropertyTypes)
    const basePipelineRequest = {
      id: requestId,
      method: '__pipeline__',
      params: [] as unknown[],
      pipeline: serverOps.length > 0 ? serverOps : operations,
      traceId: this._traceId,
      spanId: span.spanId,
    }
    const requestBody: RpcRequest = span.parentSpanId !== undefined
      ? { ...basePipelineRequest, parentSpanId: span.parentSpanId }
      : basePipelineRequest

    let result = await this.executeRequest(requestBody, span)

    // Apply local operations to the result
    for (const op of localOps) {
      if (op.method === 'getProperty' && op.params.length > 0) {
        const propName = op.params[0] as string
        result = (result as Record<string, unknown>)?.[propName]
      }
    }

    return result
  }

  /**
   * Execute an RPC request with tracing and metrics
   */
  private async executeRequest(requestBody: RpcRequest, span: SpanContext, countRequest = true): Promise<unknown> {
    const serializeStart = getHighResTime()
    const bodyStr = JSON.stringify(requestBody)
    const serializeEnd = getHighResTime()
    const requestSizeBytes = getByteSize(bodyStr)

    this._totalBytesSent += requestSizeBytes

    const request = new Request(this._options.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-ID': this._traceId,
        'X-Span-ID': span.spanId,
        ...(span.parentSpanId ? { 'X-Parent-Span-ID': span.parentSpanId } : {}),
      },
      body: bodyStr,
    })

    const networkStart = getHighResTime()

    try {
      const response = await this.stub.fetch(request)
      const networkEnd = getHighResTime()

      const responseText = await response.text()
      const responseSizeBytes = getByteSize(responseText)
      this._totalBytesReceived += responseSizeBytes

      const deserializeStart = getHighResTime()

      // Check content type
      const contentType = response.headers.get('Content-Type')
      if (!contentType?.includes('application/json')) {
        throw new RpcError(`Unexpected response: ${responseText}`, 'INVALID_RESPONSE')
      }

      const responseBody = JSON.parse(responseText) as SingleRpcResponse
      const deserializeEnd = getHighResTime()

      // Calculate metrics
      const metrics: RequestMetrics = {
        serializationTimeMs: serializeEnd - serializeStart,
        networkTimeMs: networkEnd - networkStart,
        deserializationTimeMs: deserializeEnd - deserializeStart,
        totalTimeMs: deserializeEnd - serializeStart,
        requestSizeBytes,
        responseSizeBytes,
        deduplicated: false,
        batched: false,
      }

      this.endSpan(span, metrics)
      this.recordLatency(metrics.totalTimeMs)

      if (countRequest) {
        this._totalRequests++
      }

      // Handle error responses - check type discriminator first for proper type narrowing
      if (responseBody.type === 'single' && responseBody.error) {
        const error = new RpcError(responseBody.error, responseBody.code, responseBody.failedAt)
        this.reportError(span, error)
        throw error
      }

      // Also handle non-ok HTTP responses
      if (!response.ok) {
        const error = new RpcError(responseBody.error || 'Unknown error', responseBody.code, responseBody.failedAt)
        this.reportError(span, error)
        throw error
      }

      return responseBody.result
    } catch (error) {
      if (!(error instanceof RpcError)) {
        this.reportError(span, error as Error)
      }
      throw error
    }
  }

  /**
   * Force flush any pending batched requests
   */
  async flush(): Promise<void> {
    await this.flushBatch()
  }

  /**
   * Dispose of resources
   */
  [Symbol.dispose](): void {
    this._disposed = true

    // Flush pending batch
    if (this._batchTimer) {
      clearTimeout(this._batchTimer)
      this._batchTimer = null
    }

    // Reject pending batch items
    for (const item of this._pendingBatch) {
      item.reject(new Error('FunctionTarget has been disposed'))
    }
    this._pendingBatch = []

    // Clear in-flight requests
    this._inFlightRequests.clear()
  }
}
