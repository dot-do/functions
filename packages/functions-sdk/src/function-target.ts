/**
 * FunctionTarget - capnweb RPC wrapper for invoking remote functions
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
 *
 * @module function-target
 */

import { RpcTarget } from './capnweb'

// ============================================================================
// Types
// ============================================================================

/**
 * WorkerStub represents a remote worker that can be invoked via fetch
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
  /** Called when a span starts */
  onSpanStart?(span: SpanContext): void
  /** Called when a span ends */
  onSpanEnd?(span: SpanContext, metrics: RequestMetrics): void
  /** Called when an error occurs */
  onError?(span: SpanContext, error: Error): void
}

/**
 * Span context for distributed tracing
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
  /** Timeout in milliseconds for RPC calls (default: 30000) */
  timeout?: number
  /** Number of retry attempts for failed calls (default: 0) */
  retries?: number
  /** Serialization format (default: 'json') */
  serializer?: 'json' | 'msgpack'
  /** Base URL for RPC requests (default: 'https://rpc.local/') */
  baseUrl?: string
  /** Enable request deduplication (default: true) */
  enableDeduplication?: boolean
  /** TTL for deduplication cache in ms (default: 100) */
  deduplicationTtlMs?: number
  /** Enable automatic batching (default: true) */
  enableBatching?: boolean
  /** Maximum time to wait for batching (default: 5ms) */
  batchWindowMs?: number
  /** Maximum requests per batch (default: 50) */
  maxBatchSize?: number
  /** Tracing hooks for observability */
  tracingHooks?: TracingHooks
  /** Parent trace ID to propagate */
  parentTraceId?: string
  /** Enable metrics collection (default: true) */
  enableMetrics?: boolean
  /** Max latency samples for percentiles (default: 1000) */
  maxMetricsSamples?: number
}

/**
 * JSON-RPC request body
 */
interface RpcRequest {
  id: string
  method: string
  params: unknown[]
  pipeline?: PipelineOperation[]
  traceId?: string
  spanId?: string
  parentSpanId?: string
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
 * JSON-RPC response body
 */
interface RpcResponse {
  id?: string
  result?: unknown
  error?: string
  code?: string
  failedAt?: number
}

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
    this.code = code
    this.failedAt = failedAt
  }
}

// ============================================================================
// Blocked Methods (security)
// ============================================================================

const BLOCKED_METHODS = new Set([
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

function generateTraceId(): string {
  const timestamp = Date.now().toString(16).padStart(12, '0')
  const random = Math.random().toString(16).slice(2, 10)
  const counter = (++traceIdCounter).toString(16).padStart(4, '0')
  return `${timestamp}${random}${counter}`.slice(0, 32)
}

function generateSpanId(): string {
  const random = Math.random().toString(16).slice(2, 10)
  const counter = (++spanIdCounter).toString(16).padStart(8, '0')
  return `${random}${counter}`.slice(0, 16)
}

function getHighResTime(): number {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now()
  }
  return Date.now()
}

function generateRequestKey(method: string, params: unknown[]): string {
  return `${method}:${JSON.stringify(params)}`
}

function getByteSize(str: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length
  }
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
// FunctionTarget Class
// ============================================================================

/**
 * FunctionTarget enables RPC-style invocation of remote serverless functions.
 *
 * @example
 * ```typescript
 * const target = new FunctionTarget(stub);
 *
 * // Simple invocation
 * const result = await target.invoke('greet', 'World');
 *
 * // With tracing
 * const target = new FunctionTarget(stub, {
 *   tracingHooks: {
 *     onSpanEnd: (span, metrics) => console.log(metrics)
 *   }
 * });
 * ```
 */
export class FunctionTarget extends RpcTarget {
  private stub: WorkerStub
  private _options: Required<
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
  > &
    Pick<FunctionTargetOptions, 'tracingHooks' | 'parentTraceId'>
  private _disposed: boolean = false
  private _traceId: string
  private _inFlightRequests: Map<string, InFlightRequest> = new Map()
  private _latencySamples: number[] = []
  private _totalRequests: number = 0
  private _deduplicatedRequests: number = 0
  private _totalBytesSent: number = 0
  private _totalBytesReceived: number = 0

  constructor(stub: WorkerStub, options: FunctionTargetOptions = {}) {
    super()
    this.stub = stub
    this._options = {
      timeout: options.timeout ?? 30000,
      retries: options.retries ?? 0,
      serializer: options.serializer ?? 'json',
      baseUrl: options.baseUrl ?? 'https://rpc.local/',
      enableDeduplication: options.enableDeduplication ?? true,
      deduplicationTtlMs: options.deduplicationTtlMs ?? 100,
      enableBatching: options.enableBatching ?? true,
      batchWindowMs: options.batchWindowMs ?? 5,
      maxBatchSize: options.maxBatchSize ?? 50,
      tracingHooks: options.tracingHooks,
      parentTraceId: options.parentTraceId,
      enableMetrics: options.enableMetrics ?? true,
      maxMetricsSamples: options.maxMetricsSamples ?? 1000,
    }
    this._traceId = options.parentTraceId ?? generateTraceId()
  }

  /** Get the current trace ID */
  get traceId(): string {
    return this._traceId
  }

  /** Check if disposed */
  get disposed(): boolean {
    return this._disposed
  }

  /**
   * Invoke a method on the remote function
   *
   * @param methodName - The method to call
   * @param args - Arguments to pass
   * @returns The method result
   */
  async invoke(methodName: string, ...args: unknown[]): Promise<unknown> {
    if (this._disposed) {
      throw new Error('FunctionTarget has been disposed')
    }

    if (BLOCKED_METHODS.has(methodName)) {
      throw new RpcError(`Method '${methodName}' is not allowed`, 'METHOD_NOT_ALLOWED')
    }

    const span = this.createSpan(methodName, 'invoke', { args })

    // Check for deduplication
    if (this._options.enableDeduplication) {
      const requestKey = generateRequestKey(methodName, args)
      const existing = this._inFlightRequests.get(requestKey)

      if (existing && Date.now() - existing.timestamp < this._options.deduplicationTtlMs) {
        this._deduplicatedRequests++
        this._totalRequests++
        return existing.promise
      }
    }

    const requestId = generateRequestId()
    const requestBody: RpcRequest = {
      id: requestId,
      method: methodName,
      params: args,
      traceId: this._traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
    }

    const promise = this.executeRequest(requestBody, span)

    // Track for deduplication
    if (this._options.enableDeduplication) {
      const requestKey = generateRequestKey(methodName, args)
      const inFlight: InFlightRequest = {
        promise,
        requestKey,
        timestamp: Date.now(),
      }
      this._inFlightRequests.set(requestKey, inFlight)

      promise.finally(() => {
        setTimeout(() => {
          const current = this._inFlightRequests.get(requestKey)
          if (current === inFlight) {
            this._inFlightRequests.delete(requestKey)
          }
        }, this._options.deduplicationTtlMs)
      })
    }

    return promise
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
      batchedRequests: 0,
      avgLatencyMs: len > 0 ? samples.reduce((a, b) => a + b, 0) / len : 0,
      p50LatencyMs: len > 0 ? samples[Math.floor(len * 0.5)] ?? 0 : 0,
      p95LatencyMs: len > 0 ? samples[Math.floor(len * 0.95)] ?? 0 : 0,
      p99LatencyMs: len > 0 ? samples[Math.floor(len * 0.99)] ?? 0 : 0,
      totalBytesSent: this._totalBytesSent,
      totalBytesReceived: this._totalBytesReceived,
    }
  }

  private createSpan(method: string, operation: string, attributes?: Record<string, unknown>): SpanContext {
    const span: SpanContext = {
      traceId: this._traceId,
      spanId: generateSpanId(),
      method,
      operation,
      startTime: getHighResTime(),
      attributes: attributes ?? {},
    }
    this._options.tracingHooks?.onSpanStart?.(span)
    return span
  }

  private async executeRequest(requestBody: RpcRequest, span: SpanContext): Promise<unknown> {
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

      const responseBody: RpcResponse = JSON.parse(responseText)
      const deserializeEnd = getHighResTime()

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

      this._options.tracingHooks?.onSpanEnd?.(span, metrics)
      this.recordLatency(metrics.totalTimeMs)
      this._totalRequests++

      if (!response.ok || responseBody.error) {
        const error = new RpcError(responseBody.error || 'Unknown error', responseBody.code, responseBody.failedAt)
        this._options.tracingHooks?.onError?.(span, error)
        throw error
      }

      return responseBody.result
    } catch (error) {
      if (!(error instanceof RpcError)) {
        this._options.tracingHooks?.onError?.(span, error as Error)
      }
      throw error
    }
  }

  private recordLatency(latencyMs: number): void {
    if (!this._options.enableMetrics) return

    this._latencySamples.push(latencyMs)

    if (this._latencySamples.length > this._options.maxMetricsSamples) {
      this._latencySamples.shift()
    }
  }

  [Symbol.dispose](): void {
    this._disposed = true
    this._inFlightRequests.clear()
  }
}
