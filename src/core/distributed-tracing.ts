/**
 * Distributed Tracing Module
 *
 * This module provides distributed tracing functionality for the Functions.do platform.
 * It implements W3C Trace Context propagation and OpenTelemetry-compatible export format.
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Span status codes
 */
export type SpanStatusCode = 'ok' | 'error' | 'unset'

/**
 * Span kind representing the relationship of the span
 */
export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer'

/**
 * Span status
 */
export interface SpanStatus {
  code: SpanStatusCode
  message?: string
}

/**
 * Link to another span
 */
export interface SpanLink {
  traceId: string
  spanId: string
  attributes?: Record<string, unknown>
}

/**
 * Exception information recorded on a span
 */
export interface SpanException {
  type: string
  message: string
  stacktrace?: string
  attributes?: Record<string, unknown>
}

/**
 * Exported span format (OpenTelemetry compatible)
 */
export interface TraceSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: SpanKind
  startTimeUnixNano: number
  endTimeUnixNano?: number
  attributes: Record<string, unknown>
  status: SpanStatus
  links?: SpanLink[]
  events?: Array<{
    name: string
    timeUnixNano: number
    attributes?: Record<string, unknown>
  }>
}

/**
 * Exported trace with resource information
 */
export interface ExportedTrace {
  serviceName: string
  spans: TraceSpan[]
  resource: Record<string, unknown>
}

/**
 * Configuration for the distributed tracer
 */
export interface TraceConfig {
  serviceName: string
  enabled: boolean
  sampleRate: number
  exporterEndpoint?: string
  exporter?: OpenTelemetryExporter
  sampler?: (context: TraceContext, name: string) => SamplingDecision
  resourceAttributes?: Record<string, unknown>
}

/**
 * Sampling decision returned by custom samplers
 */
export interface SamplingDecision {
  sampled: boolean
  attributes?: Record<string, unknown>
}

/**
 * Options for starting a span
 */
export interface StartSpanOptions {
  parent?: Span
  parentContext?: TraceContext
  kind?: SpanKind
  attributes?: Record<string, unknown>
  links?: SpanLink[]
  startTime?: number
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate random hex string of specified length
 */
function generateRandomHex(length: number): string {
  const bytes = new Uint8Array(length / 2)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate a W3C compliant trace ID (32 hex characters)
 */
function generateTraceId(): string {
  return generateRandomHex(32)
}

/**
 * Generate a W3C compliant span ID (16 hex characters)
 */
function generateSpanId(): string {
  return generateRandomHex(16)
}

// ============================================================================
// TraceContext Class
// ============================================================================

/**
 * Represents the context of a trace that can be propagated across boundaries
 */
export class TraceContext {
  constructor(
    public readonly traceId: string,
    public readonly spanId: string,
    public readonly parentSpanId?: string,
    public readonly sampled: boolean = true,
    private traceState?: string
  ) {}

  /**
   * Create a new trace context with generated IDs
   */
  static create(): TraceContext {
    return new TraceContext(generateTraceId(), generateSpanId(), undefined, true)
  }

  /**
   * Parse trace context from W3C traceparent header
   */
  static fromTraceparent(traceparent: string): TraceContext | null {
    // W3C traceparent format: version-traceid-parentid-flags
    // Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
    const match = traceparent.match(/^([a-f0-9]{2})-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/)
    if (!match) {
      return null
    }

    const [, version, traceId, spanId, flags] = match
    // version 00 is the only supported version currently
    if (version !== '00') {
      return null
    }

    const sampled = (parseInt(flags!, 16) & 0x01) === 0x01

    return new TraceContext(traceId!, spanId!, undefined, sampled)
  }

  /**
   * Create a child context with new span ID
   */
  createChildContext(): TraceContext {
    return new TraceContext(this.traceId, generateSpanId(), this.spanId, this.sampled, this.traceState)
  }

  /**
   * Serialize to W3C traceparent header format
   */
  toTraceparent(): string {
    const flags = this.sampled ? '01' : '00'
    return `00-${this.traceId}-${this.spanId}-${flags}`
  }

  /**
   * Get the trace state
   */
  getTraceState(): string | undefined {
    return this.traceState
  }

  /**
   * Set the trace state
   */
  setTraceState(state: string): void {
    this.traceState = state
  }
}

// ============================================================================
// Span Interface and Implementation
// ============================================================================

/**
 * Interface for a tracing span
 */
export interface Span {
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly name: string
  readonly kind: SpanKind
  readonly startTime: number
  endTime?: number
  status: SpanStatus

  /**
   * Check if the span is recording events
   */
  isRecording(): boolean

  /**
   * Check if the span is sampled
   */
  isSampled(): boolean

  /**
   * Set an attribute on the span
   */
  setAttribute(key: string, value: unknown): void

  /**
   * Set multiple attributes at once
   */
  setAttributes(attributes: Record<string, unknown>): void

  /**
   * Get an attribute value
   */
  getAttribute(key: string): unknown

  /**
   * Set the span status
   */
  setStatus(status: SpanStatus): void

  /**
   * Record an exception on the span
   */
  recordException(error: Error, additionalAttributes?: Record<string, unknown>): void

  /**
   * Get all recorded exceptions
   */
  getExceptions(): SpanException[]

  /**
   * Get all links
   */
  getLinks(): SpanLink[]

  /**
   * Get duration in milliseconds
   */
  getDurationMs(): number

  /**
   * End the span
   */
  end(): void
}

/**
 * Implementation of the Span interface
 */
class SpanImpl implements Span {
  public endTime?: number
  public status: SpanStatus = { code: 'unset' }

  private attributes: Record<string, unknown> = {}
  private exceptions: SpanException[] = []
  private links: SpanLink[]
  private sampled: boolean
  private recording: boolean
  private onEnd?: (span: SpanImpl) => void

  constructor(
    public readonly traceId: string,
    public readonly spanId: string,
    public readonly name: string,
    public readonly kind: SpanKind,
    public readonly startTime: number,
    public readonly parentSpanId?: string,
    options?: {
      attributes?: Record<string, unknown>
      links?: SpanLink[]
      sampled?: boolean
      onEnd?: (span: SpanImpl) => void
    }
  ) {
    this.attributes = options?.attributes ? { ...options.attributes } : {}
    this.links = options?.links ? [...options.links] : []
    this.sampled = options?.sampled ?? true
    this.recording = this.sampled
    this.onEnd = options?.onEnd
  }

  isRecording(): boolean {
    return this.recording
  }

  isSampled(): boolean {
    return this.sampled
  }

  setAttribute(key: string, value: unknown): void {
    if (this.recording) {
      this.attributes[key] = value
    }
  }

  setAttributes(attributes: Record<string, unknown>): void {
    if (this.recording) {
      Object.assign(this.attributes, attributes)
    }
  }

  getAttribute(key: string): unknown {
    return this.attributes[key]
  }

  setStatus(status: SpanStatus): void {
    if (this.recording) {
      this.status = status
    }
  }

  recordException(error: Error, additionalAttributes?: Record<string, unknown>): void {
    if (this.recording) {
      const exception: SpanException = {
        type: error.name,
        message: error.message,
        stacktrace: error.stack,
      }
      this.exceptions.push(exception)

      // Set exception attributes on span
      this.setAttribute('exception.type', error.name)
      this.setAttribute('exception.message', error.message)
      if (error.stack) {
        this.setAttribute('exception.stacktrace', error.stack)
      }

      // Set additional attributes if provided
      if (additionalAttributes) {
        this.setAttributes(additionalAttributes)
      }
    }
  }

  getExceptions(): SpanException[] {
    return [...this.exceptions]
  }

  getLinks(): SpanLink[] {
    return [...this.links]
  }

  getDurationMs(): number {
    if (this.endTime === undefined) {
      return Date.now() - this.startTime
    }
    return this.endTime - this.startTime
  }

  end(): void {
    if (this.recording) {
      this.endTime = Date.now()
      this.recording = false
      if (this.onEnd) {
        this.onEnd(this)
      }
    }
  }

  /**
   * Convert span to exportable format
   */
  toTraceSpan(): TraceSpan {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      kind: this.kind,
      startTimeUnixNano: this.startTime * 1_000_000,
      endTimeUnixNano: this.endTime ? this.endTime * 1_000_000 : undefined,
      attributes: { ...this.attributes },
      status: { ...this.status },
      links: this.links.length > 0 ? [...this.links] : undefined,
    }
  }
}

// ============================================================================
// SpanBuilder Class
// ============================================================================

/**
 * Builder for creating spans with a fluent interface
 */
export class SpanBuilder {
  private name: string
  private attributes: Record<string, unknown> = {}
  private kind: SpanKind = 'internal'
  private parent?: Span
  private links: SpanLink[] = []
  private startTime?: number

  private constructor(name: string) {
    this.name = name
  }

  /**
   * Create a new SpanBuilder
   */
  static create(name: string): SpanBuilder {
    return new SpanBuilder(name)
  }

  /**
   * Add an attribute to the span
   */
  withAttribute(key: string, value: unknown): SpanBuilder {
    this.attributes[key] = value
    return this
  }

  /**
   * Set the span kind
   */
  withKind(kind: SpanKind): SpanBuilder {
    this.kind = kind
    return this
  }

  /**
   * Set the parent span
   */
  withParent(parent: Span): SpanBuilder {
    this.parent = parent
    return this
  }

  /**
   * Add a link to another span
   */
  withLink(link: SpanLink): SpanBuilder {
    this.links.push(link)
    return this
  }

  /**
   * Set the start time
   */
  withStartTime(startTime: number): SpanBuilder {
    this.startTime = startTime
    return this
  }

  /**
   * Build the span using the provided tracer
   */
  build(tracer: DistributedTracer): Span {
    return tracer.startSpan(this.name, {
      parent: this.parent,
      kind: this.kind,
      attributes: this.attributes,
      links: this.links,
      startTime: this.startTime,
    })
  }
}

// ============================================================================
// DistributedTracer Class
// ============================================================================

/**
 * Main distributed tracer class for creating and managing spans
 */
export class DistributedTracer {
  private config: TraceConfig
  private pendingSpans: SpanImpl[] = []
  private isShutdown: boolean = false

  constructor(config?: Partial<TraceConfig>) {
    this.config = {
      serviceName: config?.serviceName ?? 'functions-do',
      enabled: config?.enabled ?? true,
      sampleRate: config?.sampleRate ?? 1.0,
      ...config,
    } as TraceConfig
  }

  /**
   * Get the tracer configuration
   */
  getConfig(): TraceConfig {
    return { ...this.config }
  }

  /**
   * Generate a new trace ID
   */
  generateTraceId(): string {
    return generateTraceId()
  }

  /**
   * Generate a new span ID
   */
  generateSpanId(): string {
    return generateSpanId()
  }

  /**
   * Determine if a span should be sampled
   */
  private shouldSample(context: TraceContext | null, name: string, parentSampled?: boolean): SamplingDecision {
    // If parent has a sampling decision, respect it
    if (parentSampled !== undefined) {
      return { sampled: parentSampled }
    }

    // If custom sampler is provided, use it
    if (this.config.sampler) {
      const samplerContext = context ?? TraceContext.create()
      return this.config.sampler(samplerContext, name)
    }

    // Default probabilistic sampling
    if (this.config.sampleRate === 0) {
      return { sampled: false }
    }
    if (this.config.sampleRate === 1) {
      return { sampled: true }
    }
    return { sampled: Math.random() < this.config.sampleRate }
  }

  /**
   * Start a new span
   */
  startSpan(name: string, options?: StartSpanOptions): Span {
    const parent = options?.parent
    const parentContext = options?.parentContext

    let traceId: string
    let parentSpanId: string | undefined
    let parentSampled: boolean | undefined

    if (parent) {
      traceId = parent.traceId
      parentSpanId = parent.spanId
      parentSampled = parent.isSampled()
    } else if (parentContext) {
      traceId = parentContext.traceId
      parentSpanId = parentContext.spanId
      parentSampled = parentContext.sampled
    } else {
      traceId = this.generateTraceId()
      parentSpanId = undefined
    }

    const spanId = this.generateSpanId()
    const startTime = options?.startTime ?? Date.now()
    const kind = options?.kind ?? 'internal'

    // Determine sampling
    const samplingDecision = this.shouldSample(parentContext ?? null, name, parentSampled)

    const span = new SpanImpl(traceId, spanId, name, kind, startTime, parentSpanId, {
      attributes: options?.attributes,
      links: options?.links,
      sampled: samplingDecision.sampled,
      onEnd: (s) => this.onSpanEnd(s),
    })

    // Add sampling attributes if any
    if (samplingDecision.attributes) {
      span.setAttributes(samplingDecision.attributes)
    }

    return span
  }

  /**
   * Called when a span ends
   */
  private onSpanEnd(span: SpanImpl): void {
    if (span.isSampled() && !this.isShutdown) {
      this.pendingSpans.push(span)
    }
  }

  /**
   * Create a trace context from a span
   */
  createContext(span: Span): TraceContext {
    return new TraceContext(span.traceId, span.spanId, span.parentSpanId, span.isSampled())
  }

  /**
   * Flush all buffered spans to the exporter
   */
  async flush(): Promise<void> {
    if (!this.config.exporter || this.pendingSpans.length === 0) {
      this.pendingSpans = []
      return
    }

    const spansToExport = [...this.pendingSpans]
    this.pendingSpans = []

    const traceSpans = spansToExport.map((s) => s.toTraceSpan())

    const exportedTrace: ExportedTrace = {
      serviceName: this.config.serviceName,
      spans: traceSpans,
      resource: {
        'service.name': this.config.serviceName,
        ...this.config.resourceAttributes,
      },
    }

    try {
      await this.config.exporter.export(exportedTrace)
    } catch {
      // Silently handle export failures
    }
  }

  /**
   * Shutdown the tracer
   */
  shutdown(): void {
    this.isShutdown = true
    this.pendingSpans = []
  }
}

// ============================================================================
// W3CTraceContextPropagator Class
// ============================================================================

/**
 * Propagator for W3C Trace Context headers
 */
export class W3CTraceContextPropagator {
  /**
   * Inject trace context into headers
   */
  inject(context: TraceContext, headers: Headers): void {
    headers.set('traceparent', context.toTraceparent())

    const traceState = context.getTraceState()
    if (traceState) {
      headers.set('tracestate', traceState)
    }
  }

  /**
   * Extract trace context from headers
   */
  extract(headers: Headers): TraceContext | null {
    const traceparent = headers.get('traceparent')
    if (!traceparent) {
      return null
    }

    const context = TraceContext.fromTraceparent(traceparent)
    if (!context) {
      return null
    }

    const tracestate = headers.get('tracestate')
    if (tracestate) {
      context.setTraceState(tracestate)
    }

    return context
  }
}

// ============================================================================
// OpenTelemetryExporter Class
// ============================================================================

/**
 * Options for the OpenTelemetry exporter
 */
export interface OpenTelemetryExporterOptions {
  batchSize?: number
}

/**
 * Exporter for OpenTelemetry format traces
 */
export class OpenTelemetryExporter {
  private batchSize: number

  constructor(
    private sendFn: (traces: ExportedTrace[]) => Promise<{ success: boolean; id: string }>,
    private options?: OpenTelemetryExporterOptions
  ) {
    this.batchSize = options?.batchSize ?? 100
  }

  /**
   * Export traces
   */
  async export(trace: ExportedTrace): Promise<void> {
    const spans = trace.spans
    const batches: ExportedTrace[] = []

    // Split spans into batches
    for (let i = 0; i < spans.length; i += this.batchSize) {
      const batchSpans = spans.slice(i, i + this.batchSize)
      batches.push({
        serviceName: trace.serviceName,
        spans: batchSpans,
        resource: trace.resource,
      })
    }

    // Export each batch
    for (const batch of batches) {
      try {
        await this.sendFn([batch])
      } catch {
        // Silently handle export failures
      }
    }
  }
}

// ============================================================================
// TraceExporter Factory
// ============================================================================

/**
 * HTTP exporter options
 */
export interface HttpExporterOptions {
  endpoint: string
  headers?: Record<string, string>
}

/**
 * Factory for creating trace exporters
 */
export class TraceExporter {
  /**
   * Create an HTTP exporter
   */
  static http(options: HttpExporterOptions): {
    export(trace: ExportedTrace): Promise<void>
  } {
    return {
      async export(trace: ExportedTrace): Promise<void> {
        await fetch(options.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
          },
          body: JSON.stringify(trace),
        })
      },
    }
  }

  /**
   * Create a console exporter for debugging
   */
  static console(): {
    export(trace: ExportedTrace): Promise<void>
  } {
    return {
      async export(trace: ExportedTrace): Promise<void> {
        for (const span of trace.spans) {
          console.log(
            `[TRACE] ${span.name} | traceId=${span.traceId} spanId=${span.spanId} ` +
              `duration=${span.endTimeUnixNano && span.startTimeUnixNano ? (span.endTimeUnixNano - span.startTimeUnixNano) / 1_000_000 : 0}ms`
          )
        }
      },
    }
  }

  /**
   * Create a no-op exporter
   */
  static noop(): {
    export(trace: ExportedTrace): Promise<void>
  } {
    return {
      async export(): Promise<void> {
        // No-op
      },
    }
  }
}

// ============================================================================
// SamplingConfig Helper
// ============================================================================

/**
 * Rate limiting options
 */
export interface RateLimitingOptions {
  maxSpansPerSecond: number
}

/**
 * Helper for creating sampling configurations
 */
export class SamplingConfig {
  /**
   * Create a rate limiting sampler
   */
  static rateLimiting(options: RateLimitingOptions): (context: TraceContext, name: string) => SamplingDecision {
    let tokenBucket = options.maxSpansPerSecond
    let lastRefillTime = Date.now()
    const refillRate = options.maxSpansPerSecond // tokens per second

    return (_context: TraceContext, _name: string): SamplingDecision => {
      const now = Date.now()
      const timeSinceLastRefill = (now - lastRefillTime) / 1000 // in seconds

      // Refill the bucket
      tokenBucket = Math.min(options.maxSpansPerSecond, tokenBucket + timeSinceLastRefill * refillRate)
      lastRefillTime = now

      // Try to consume a token
      if (tokenBucket >= 1) {
        tokenBucket -= 1
        return { sampled: true }
      }

      return { sampled: false }
    }
  }
}
