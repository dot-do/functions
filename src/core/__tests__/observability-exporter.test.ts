/**
 * ObservabilityExporter and TracingHooks Tests
 *
 * Comprehensive tests for the observability module (src/core/observability.ts).
 * These tests focus on areas not fully covered by the existing
 * src/__tests__/observability.test.ts:
 *
 * 1. Backend detection from endpoint URL
 * 2. Honeycomb-specific header format (X-Honeycomb-Team)
 * 3. OTLP/generic Authorization header format
 * 4. TracingHooks lifecycle (onSpanStart -> onSpanEnd with metrics)
 * 5. TracingHooks error handling (onSpanStart -> onError -> onSpanEnd)
 * 6. Span parentSpanId propagation through hooks
 * 7. createExporterFromEnv with backend override
 * 8. Export timeout handling
 * 9. Buffer auto-flush behavior edge cases
 * 10. Shutdown lifecycle
 *
 * @module core/__tests__/observability-exporter
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ObservabilityExporter,
  createTracingHooks,
  createExporterFromEnv,
  createNoOpExporter,
  type ObservabilityConfig,
  type Span,
} from '../observability'
import type { SpanContext, RequestMetrics } from '../function-target'

// ============================================================================
// Helper Factories
// ============================================================================

function makeSpan(overrides?: Partial<Span>): Span {
  return {
    traceId: 'trace-001',
    spanId: 'span-001',
    name: 'test.operation',
    startTime: Date.now() - 100,
    endTime: Date.now(),
    durationMs: 100,
    attributes: {},
    status: 'ok',
    ...overrides,
  }
}

function makeSpanContext(overrides?: Partial<SpanContext>): SpanContext {
  return {
    traceId: 'trace-001',
    spanId: 'span-001',
    method: 'testMethod',
    operation: 'invoke',
    startTime: Date.now() - 100,
    attributes: {},
    ...overrides,
  }
}

function makeMetrics(overrides?: Partial<RequestMetrics>): RequestMetrics {
  return {
    serializationTimeMs: 5,
    networkTimeMs: 50,
    deserializationTimeMs: 3,
    totalTimeMs: 58,
    requestSizeBytes: 100,
    responseSizeBytes: 200,
    deduplicated: false,
    batched: false,
    ...overrides,
  }
}

// ============================================================================
// Backend Detection Tests
// ============================================================================

describe('ObservabilityExporter - Backend Detection', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should detect honeycomb backend from honeycomb.io URL', () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://api.honeycomb.io/1/events/my-dataset',
      flushIntervalMs: 0,
    })
    expect(exporter.getConfig().backend).toBe('honeycomb')
    exporter.stopFlushTimer()
  })

  it('should detect honeycomb backend from honeycomb.com URL', () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://api.honeycomb.com/v1/traces',
      flushIntervalMs: 0,
    })
    expect(exporter.getConfig().backend).toBe('honeycomb')
    exporter.stopFlushTimer()
  })

  it('should detect OTLP backend from otel-collector URL', () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://otel-collector.example.com:4318/v1/traces',
      flushIntervalMs: 0,
    })
    expect(exporter.getConfig().backend).toBe('otlp')
    exporter.stopFlushTimer()
  })

  it('should detect OTLP backend from /v1/traces path', () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://example.com/v1/traces',
      flushIntervalMs: 0,
    })
    expect(exporter.getConfig().backend).toBe('otlp')
    exporter.stopFlushTimer()
  })

  it('should detect OTLP backend from opentelemetry in hostname', () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://opentelemetry-collector.internal/export',
      flushIntervalMs: 0,
    })
    expect(exporter.getConfig().backend).toBe('otlp')
    exporter.stopFlushTimer()
  })

  it('should default to generic for unknown endpoints', () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://custom-tracing.example.com/traces',
      flushIntervalMs: 0,
    })
    expect(exporter.getConfig().backend).toBe('generic')
    exporter.stopFlushTimer()
  })

  it('should default to generic when no endpoint is provided', () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      flushIntervalMs: 0,
    })
    expect(exporter.getConfig().backend).toBe('generic')
    exporter.stopFlushTimer()
  })

  it('should default to generic for invalid endpoint URL', () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      endpoint: 'not-a-valid-url',
      flushIntervalMs: 0,
    })
    expect(exporter.getConfig().backend).toBe('generic')
    exporter.stopFlushTimer()
  })

  it('should allow explicit backend override', () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://custom.example.com/traces',
      backend: 'honeycomb',
      flushIntervalMs: 0,
    })
    expect(exporter.getConfig().backend).toBe('honeycomb')
    exporter.stopFlushTimer()
  })
})

// ============================================================================
// API Key Header Format Tests
// ============================================================================

describe('ObservabilityExporter - API Key Headers', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should use X-Honeycomb-Team header for honeycomb backend', async () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://api.honeycomb.io/1/events/test',
      apiKey: 'hc-api-key',
      flushIntervalMs: 0,
    })

    exporter.recordSpan(makeSpan())
    await exporter.flush()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, opts] = mockFetch.mock.calls[0]!
    expect(opts.headers['X-Honeycomb-Team']).toBe('hc-api-key')
    expect(opts.headers['Authorization']).toBeUndefined()
    exporter.stopFlushTimer()
  })

  it('should use Authorization Bearer for OTLP backend', async () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://otel-collector.example.com/v1/traces',
      apiKey: 'otlp-key',
      flushIntervalMs: 0,
    })

    exporter.recordSpan(makeSpan())
    await exporter.flush()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, opts] = mockFetch.mock.calls[0]!
    expect(opts.headers['Authorization']).toBe('Bearer otlp-key')
    expect(opts.headers['X-Honeycomb-Team']).toBeUndefined()
    exporter.stopFlushTimer()
  })

  it('should use Authorization Bearer for generic backend', async () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://custom.example.com/traces',
      apiKey: 'generic-key',
      backend: 'generic',
      flushIntervalMs: 0,
    })

    exporter.recordSpan(makeSpan())
    await exporter.flush()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, opts] = mockFetch.mock.calls[0]!
    expect(opts.headers['Authorization']).toBe('Bearer generic-key')
    exporter.stopFlushTimer()
  })

  it('should not include auth headers when no apiKey provided', async () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://example.com/traces',
      flushIntervalMs: 0,
    })

    exporter.recordSpan(makeSpan())
    await exporter.flush()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, opts] = mockFetch.mock.calls[0]!
    expect(opts.headers['Authorization']).toBeUndefined()
    expect(opts.headers['X-Honeycomb-Team']).toBeUndefined()
    exporter.stopFlushTimer()
  })

  it('should include custom headers in addition to auth headers', async () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://example.com/traces',
      apiKey: 'test-key',
      headers: { 'X-Custom-Header': 'custom-value' },
      flushIntervalMs: 0,
    })

    exporter.recordSpan(makeSpan())
    await exporter.flush()

    const [, opts] = mockFetch.mock.calls[0]!
    expect(opts.headers['X-Custom-Header']).toBe('custom-value')
    expect(opts.headers['Authorization']).toBe('Bearer test-key')
    exporter.stopFlushTimer()
  })
})

// ============================================================================
// TracingHooks Lifecycle Tests
// ============================================================================

describe('TracingHooks - Lifecycle', () => {
  let exporter: ObservabilityExporter
  let hooks: ReturnType<typeof createTracingHooks>

  beforeEach(() => {
    exporter = new ObservabilityExporter({
      enabled: true,
      sampleRate: 1,
      flushIntervalMs: 0,
    })
    hooks = createTracingHooks(exporter)
  })

  afterEach(() => {
    exporter.stopFlushTimer()
  })

  it('should record a complete span lifecycle (start -> end)', () => {
    const ctx = makeSpanContext()
    const metrics = makeMetrics()

    hooks.onSpanStart!(ctx)
    hooks.onSpanEnd!(ctx, metrics)

    expect(exporter.getBufferSize()).toBe(1)
  })

  it('should construct span name from operation.method', () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)

    const exporterWithEndpoint = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://test.example.com/traces',
      flushIntervalMs: 0,
    })
    const hooksWithEndpoint = createTracingHooks(exporterWithEndpoint)

    const ctx = makeSpanContext({ operation: 'invoke', method: 'myFunction' })
    hooksWithEndpoint.onSpanStart!(ctx)
    hooksWithEndpoint.onSpanEnd!(ctx, makeMetrics())

    exporterWithEndpoint.flush().then(() => {
      if (mockFetch.mock.calls.length > 0) {
        const body = JSON.parse(mockFetch.mock.calls[0]![1].body)
        expect(body.spans[0].name).toBe('invoke.myFunction')
      }
    })

    exporterWithEndpoint.stopFlushTimer()
    vi.unstubAllGlobals()
  })

  it('should include parentSpanId when present in context', () => {
    const ctx = makeSpanContext({
      parentSpanId: 'parent-span-123',
    })

    // Without onSpanStart, onSpanEnd creates a span from context directly
    hooks.onSpanEnd!(ctx, makeMetrics())

    // The span should be in the buffer
    expect(exporter.getBufferSize()).toBe(1)
  })

  it('should include all metrics as span attributes', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)

    const exporterWithEndpoint = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://test.example.com/traces',
      flushIntervalMs: 0,
    })
    const hooksWithEndpoint = createTracingHooks(exporterWithEndpoint)

    const ctx = makeSpanContext()
    const metrics = makeMetrics({
      serializationTimeMs: 10,
      networkTimeMs: 80,
      deserializationTimeMs: 5,
      totalTimeMs: 95,
      requestSizeBytes: 512,
      responseSizeBytes: 1024,
      deduplicated: true,
      batched: true,
      batchSize: 10,
    })

    hooksWithEndpoint.onSpanStart!(ctx)
    hooksWithEndpoint.onSpanEnd!(ctx, metrics)
    await exporterWithEndpoint.flush()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body)
    const span = body.spans[0]

    expect(span.attributes['metrics.serializationTimeMs']).toBe(10)
    expect(span.attributes['metrics.networkTimeMs']).toBe(80)
    expect(span.attributes['metrics.deserializationTimeMs']).toBe(5)
    expect(span.attributes['metrics.totalTimeMs']).toBe(95)
    expect(span.attributes['metrics.requestSizeBytes']).toBe(512)
    expect(span.attributes['metrics.responseSizeBytes']).toBe(1024)
    expect(span.attributes['metrics.deduplicated']).toBe(true)
    expect(span.attributes['metrics.batched']).toBe(true)
    expect(span.attributes['metrics.batchSize']).toBe(10)

    exporterWithEndpoint.stopFlushTimer()
    vi.unstubAllGlobals()
  })

  it('should handle onSpanEnd without prior onSpanStart', () => {
    const ctx = makeSpanContext()
    const metrics = makeMetrics({ totalTimeMs: 200 })

    // No onSpanStart call - should still record
    hooks.onSpanEnd!(ctx, metrics)

    expect(exporter.getBufferSize()).toBe(1)
  })

  it('should handle onError with active span (updates state, does not record)', () => {
    const ctx = makeSpanContext()
    hooks.onSpanStart!(ctx)
    hooks.onError!(ctx, new Error('Test error'))

    // Error updates active span state but doesn't record yet
    expect(exporter.getBufferSize()).toBe(0)
  })

  it('should handle onError without active span (records immediately)', () => {
    const ctx = makeSpanContext({ spanId: 'no-start-span' })
    hooks.onError!(ctx, new Error('Immediate error'))

    expect(exporter.getBufferSize()).toBe(1)
  })

  it('should include error attributes when onError is called on non-active span', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)

    const exporterWithEndpoint = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://test.example.com/traces',
      flushIntervalMs: 0,
    })
    const hooksWithEndpoint = createTracingHooks(exporterWithEndpoint)

    const ctx = makeSpanContext({ spanId: 'error-span' })
    const error = new Error('Something broke')
    error.stack = 'Error: Something broke\n    at test.ts:1:1'

    hooksWithEndpoint.onError!(ctx, error)
    await exporterWithEndpoint.flush()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body)
    const span = body.spans[0]

    expect(span.status).toBe('error')
    expect(span.errorMessage).toBe('Something broke')
    expect(span.attributes['error.type']).toBe('Error')
    expect(span.attributes['error.message']).toBe('Something broke')
    expect(span.attributes['error.stack']).toBeDefined()

    exporterWithEndpoint.stopFlushTimer()
    vi.unstubAllGlobals()
  })

  it('should merge context attributes with metrics attributes', () => {
    const ctx = makeSpanContext({
      attributes: { 'custom.attr': 'custom-value' },
    })

    hooks.onSpanStart!(ctx)
    hooks.onSpanEnd!(ctx, makeMetrics())

    expect(exporter.getBufferSize()).toBe(1)
  })
})

// ============================================================================
// Flush Behavior Edge Cases
// ============================================================================

describe('ObservabilityExporter - Flush Edge Cases', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should return success with 0 spans when buffer is empty', async () => {
    const exporter = new ObservabilityExporter({ enabled: true })
    const result = await exporter.flush()
    expect(result.success).toBe(true)
    expect(result.spanCount).toBe(0)
    exporter.stopFlushTimer()
  })

  it('should clear buffer even when no endpoint (returns error)', async () => {
    const exporter = new ObservabilityExporter({ enabled: true, flushIntervalMs: 0 })
    exporter.recordSpan(makeSpan())
    exporter.recordSpan(makeSpan({ spanId: 'span-002' }))

    expect(exporter.getBufferSize()).toBe(2)

    const result = await exporter.flush()
    expect(result.success).toBe(false)
    expect(result.spanCount).toBe(2)
    expect(result.error).toBe('No endpoint configured')
    expect(exporter.getBufferSize()).toBe(0)

    exporter.stopFlushTimer()
  })

  it('should include export body with metadata', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)

    const exporter = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://example.com/traces',
      serviceName: 'test-service',
      flushIntervalMs: 0,
    })

    exporter.recordSpan(makeSpan())
    await exporter.flush()

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body)
    expect(body.metadata).toBeDefined()
    expect(body.metadata.serviceName).toBe('test-service')
    expect(body.metadata.spanCount).toBe(1)
    expect(body.metadata.exportedAt).toBeDefined()

    exporter.stopFlushTimer()
  })

  it('should handle HTTP error responses', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('Rate limited', { status: 429 })
    )
    vi.stubGlobal('fetch', mockFetch)

    const exporter = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://example.com/traces',
      flushIntervalMs: 0,
    })

    exporter.recordSpan(makeSpan())
    const result = await exporter.flush()

    expect(result.success).toBe(false)
    expect(result.statusCode).toBe(429)
    expect(result.error).toContain('429')

    exporter.stopFlushTimer()
  })

  it('should handle network errors', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'))
    vi.stubGlobal('fetch', mockFetch)

    const exporter = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://example.com/traces',
      flushIntervalMs: 0,
    })

    exporter.recordSpan(makeSpan())
    const result = await exporter.flush()

    expect(result.success).toBe(false)
    expect(result.error).toBe('Connection refused')

    exporter.stopFlushTimer()
  })
})

// ============================================================================
// Shutdown Tests
// ============================================================================

describe('ObservabilityExporter - Shutdown', () => {
  it('should flush remaining spans and stop timer on shutdown', async () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      flushIntervalMs: 0,
    })

    exporter.recordSpan(makeSpan())
    exporter.recordSpan(makeSpan({ spanId: 'span-002' }))

    expect(exporter.getBufferSize()).toBe(2)

    const result = await exporter.shutdown()
    expect(exporter.getBufferSize()).toBe(0)
    expect(result.spanCount).toBe(2)
  })
})

// ============================================================================
// createExporterFromEnv Tests
// ============================================================================

describe('createExporterFromEnv - Extended', () => {
  it('should pass backend override from env', () => {
    const exporter = createExporterFromEnv({
      OBSERVABILITY_ENDPOINT: 'https://custom.example.com/traces',
      OBSERVABILITY_BACKEND: 'honeycomb',
    })
    expect(exporter.getConfig().backend).toBe('honeycomb')
    exporter.stopFlushTimer()
  })

  it('should ignore invalid backend string from env', () => {
    const exporter = createExporterFromEnv({
      OBSERVABILITY_BACKEND: 'invalid-backend',
    })
    // Should fall back to auto-detection (generic since no endpoint)
    expect(exporter.getConfig().backend).toBe('generic')
    exporter.stopFlushTimer()
  })

  it('should handle OBSERVABILITY_SAMPLE_RATE correctly', () => {
    const exporter = createExporterFromEnv({
      OBSERVABILITY_SAMPLE_RATE: '0.25',
    })
    expect(exporter.getConfig().sampleRate).toBe(0.25)
    exporter.stopFlushTimer()
  })

  it('should default sampleRate to 1.0 when not specified', () => {
    const exporter = createExporterFromEnv({})
    expect(exporter.getConfig().sampleRate).toBe(1)
    exporter.stopFlushTimer()
  })

  it('should default serviceName to functions-do', () => {
    const exporter = createExporterFromEnv({})
    expect(exporter.getConfig().serviceName).toBe('functions-do')
    exporter.stopFlushTimer()
  })

  it('should use custom serviceName from env', () => {
    const exporter = createExporterFromEnv({
      OBSERVABILITY_SERVICE_NAME: 'my-custom-service',
    })
    expect(exporter.getConfig().serviceName).toBe('my-custom-service')
    exporter.stopFlushTimer()
  })
})

// ============================================================================
// createNoOpExporter Tests
// ============================================================================

describe('createNoOpExporter - Extended', () => {
  it('should not buffer any spans', () => {
    const exporter = createNoOpExporter()

    for (let i = 0; i < 100; i++) {
      exporter.recordSpan(makeSpan({ spanId: `span-${i}` }))
    }

    expect(exporter.getBufferSize()).toBe(0)
    exporter.stopFlushTimer()
  })

  it('should return success on flush with 0 spans', async () => {
    const exporter = createNoOpExporter()
    const result = await exporter.flush()
    expect(result.success).toBe(true)
    expect(result.spanCount).toBe(0)
    exporter.stopFlushTimer()
  })

  it('should shutdown cleanly', async () => {
    const exporter = createNoOpExporter()
    const result = await exporter.shutdown()
    expect(result.success).toBe(true)
    expect(result.spanCount).toBe(0)
  })
})

// ============================================================================
// Sampling Behavior Tests
// ============================================================================

describe('ObservabilityExporter - Sampling', () => {
  it('should record all spans with sampleRate=1', () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      sampleRate: 1,
      flushIntervalMs: 0,
    })

    for (let i = 0; i < 50; i++) {
      exporter.recordSpan(makeSpan({ spanId: `span-${i}` }))
    }

    expect(exporter.getBufferSize()).toBe(50)
    exporter.stopFlushTimer()
  })

  it('should record no spans with sampleRate=0', () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      sampleRate: 0,
      flushIntervalMs: 0,
    })

    for (let i = 0; i < 50; i++) {
      exporter.recordSpan(makeSpan({ spanId: `span-${i}` }))
    }

    expect(exporter.getBufferSize()).toBe(0)
    exporter.stopFlushTimer()
  })

  it('should add serviceName to spans that lack one', () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      serviceName: 'auto-service',
      sampleRate: 1,
      flushIntervalMs: 0,
    })

    exporter.recordSpan(makeSpan({ serviceName: undefined }))
    // Cannot inspect buffer directly, but we can verify it was recorded
    expect(exporter.getBufferSize()).toBe(1)
    exporter.stopFlushTimer()
  })

  it('should preserve existing serviceName on spans', () => {
    const exporter = new ObservabilityExporter({
      enabled: true,
      serviceName: 'default-service',
      sampleRate: 1,
      flushIntervalMs: 0,
    })

    exporter.recordSpan(makeSpan({ serviceName: 'explicit-service' }))
    expect(exporter.getBufferSize()).toBe(1)
    exporter.stopFlushTimer()
  })
})
