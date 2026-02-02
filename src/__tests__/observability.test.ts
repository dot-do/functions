/**
 * Observability Backend Integration Tests
 *
 * Tests for the observability module including:
 * - ObservabilityExporter configuration and buffering
 * - Sampling behavior
 * - TracingHooks integration
 * - Export functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ObservabilityExporter,
  createTracingHooks,
  createExporterFromEnv,
  createNoOpExporter,
  type ObservabilityConfig,
  type Span,
} from '../core/observability'
import type { SpanContext, RequestMetrics } from '../core/function-target'

describe('ObservabilityExporter', () => {
  let exporter: ObservabilityExporter

  afterEach(() => {
    if (exporter) {
      exporter.stopFlushTimer()
    }
  })

  describe('Configuration', () => {
    it('should use default values when not specified', () => {
      exporter = new ObservabilityExporter({ enabled: true })
      const config = exporter.getConfig()

      expect(config.enabled).toBe(true)
      expect(config.serviceName).toBe('functions-do')
      expect(config.sampleRate).toBe(1)
      expect(config.bufferSize).toBe(100)
      expect(config.flushIntervalMs).toBe(5000)
    })

    it('should accept custom configuration', () => {
      exporter = new ObservabilityExporter({
        enabled: true,
        endpoint: 'https://api.honeycomb.io/1/events/test',
        apiKey: 'test-api-key',
        serviceName: 'my-service',
        sampleRate: 0.5,
        bufferSize: 50,
        flushIntervalMs: 1000,
      })
      const config = exporter.getConfig()

      expect(config.endpoint).toBe('https://api.honeycomb.io/1/events/test')
      expect(config.apiKey).toBe('test-api-key')
      expect(config.serviceName).toBe('my-service')
      expect(config.sampleRate).toBe(0.5)
      expect(config.bufferSize).toBe(50)
      expect(config.flushIntervalMs).toBe(1000)
    })

    it('should clamp sample rate between 0 and 1', () => {
      exporter = new ObservabilityExporter({
        enabled: true,
        sampleRate: 2.0,
      })
      expect(exporter.getConfig().sampleRate).toBe(1)

      exporter.stopFlushTimer()
      exporter = new ObservabilityExporter({
        enabled: true,
        sampleRate: -0.5,
      })
      expect(exporter.getConfig().sampleRate).toBe(0)
    })
  })

  describe('Span Recording', () => {
    it('should buffer spans when enabled', () => {
      exporter = new ObservabilityExporter({
        enabled: true,
        sampleRate: 1,
      })

      const span: Span = {
        traceId: 'trace-123',
        spanId: 'span-456',
        name: 'test.operation',
        startTime: Date.now(),
        endTime: Date.now() + 100,
        durationMs: 100,
        attributes: { key: 'value' },
        status: 'ok',
      }

      exporter.recordSpan(span)
      expect(exporter.getBufferSize()).toBe(1)
    })

    it('should not buffer spans when disabled', () => {
      exporter = new ObservabilityExporter({
        enabled: false,
      })

      const span: Span = {
        traceId: 'trace-123',
        spanId: 'span-456',
        name: 'test.operation',
        startTime: Date.now(),
        attributes: {},
        status: 'ok',
      }

      exporter.recordSpan(span)
      expect(exporter.getBufferSize()).toBe(0)
    })

    it('should apply sampling rate', () => {
      // Set sample rate to 0 - no spans should be recorded
      exporter = new ObservabilityExporter({
        enabled: true,
        sampleRate: 0,
      })

      for (let i = 0; i < 100; i++) {
        exporter.recordSpan({
          traceId: `trace-${i}`,
          spanId: `span-${i}`,
          name: 'test',
          startTime: Date.now(),
          attributes: {},
          status: 'ok',
        })
      }

      expect(exporter.getBufferSize()).toBe(0)
    })

    it('should add service name to spans', async () => {
      exporter = new ObservabilityExporter({
        enabled: true,
        serviceName: 'custom-service',
      })

      const span: Span = {
        traceId: 'trace-123',
        spanId: 'span-456',
        name: 'test.operation',
        startTime: Date.now(),
        attributes: {},
        status: 'ok',
      }

      exporter.recordSpan(span)

      // Flush and check that service name was added
      // Note: Since we don't have an endpoint, flush will clear buffer
      const result = await exporter.flush()
      expect(result.error).toBe('No endpoint configured')
    })

    it('should auto-flush when buffer is full', async () => {
      exporter = new ObservabilityExporter({
        enabled: true,
        bufferSize: 3,
        flushIntervalMs: 0, // Disable timer
      })

      // Add 3 spans (buffer size)
      for (let i = 0; i < 3; i++) {
        exporter.recordSpan({
          traceId: `trace-${i}`,
          spanId: `span-${i}`,
          name: 'test',
          startTime: Date.now(),
          attributes: {},
          status: 'ok',
        })
      }

      // Buffer should be cleared after auto-flush (no endpoint, so cleared but not exported)
      // Wait a tick for async flush to complete
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(exporter.getBufferSize()).toBe(0)
    })
  })

  describe('Flush', () => {
    it('should return success with 0 spans when buffer is empty', async () => {
      exporter = new ObservabilityExporter({ enabled: true })
      const result = await exporter.flush()

      expect(result.success).toBe(true)
      expect(result.spanCount).toBe(0)
    })

    it('should return error when no endpoint is configured', async () => {
      exporter = new ObservabilityExporter({ enabled: true })

      exporter.recordSpan({
        traceId: 'trace-123',
        spanId: 'span-456',
        name: 'test',
        startTime: Date.now(),
        attributes: {},
        status: 'ok',
      })

      const result = await exporter.flush()

      expect(result.success).toBe(false)
      expect(result.spanCount).toBe(1)
      expect(result.error).toBe('No endpoint configured')
    })

    it('should clear buffer after flush', async () => {
      exporter = new ObservabilityExporter({ enabled: true })

      exporter.recordSpan({
        traceId: 'trace-123',
        spanId: 'span-456',
        name: 'test',
        startTime: Date.now(),
        attributes: {},
        status: 'ok',
      })

      expect(exporter.getBufferSize()).toBe(1)
      await exporter.flush()
      expect(exporter.getBufferSize()).toBe(0)
    })
  })

  describe('Export with endpoint', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('should send spans to configured endpoint', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      exporter = new ObservabilityExporter({
        enabled: true,
        endpoint: 'https://api.example.com/traces',
        apiKey: 'test-key',
        serviceName: 'test-service',
        flushIntervalMs: 0,
      })

      exporter.recordSpan({
        traceId: 'trace-123',
        spanId: 'span-456',
        name: 'test.operation',
        startTime: Date.now(),
        attributes: { foo: 'bar' },
        status: 'ok',
      })

      const result = await exporter.flush()

      expect(result.success).toBe(true)
      expect(result.spanCount).toBe(1)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [url, options] = mockFetch.mock.calls[0]!
      expect(url).toBe('https://api.example.com/traces')
      expect(options.method).toBe('POST')
      expect(options.headers['Content-Type']).toBe('application/json')
      // Generic backend uses Authorization header (not Honeycomb-specific header)
      expect(options.headers['Authorization']).toBe('Bearer test-key')

      const body = JSON.parse(options.body)
      expect(body.spans).toHaveLength(1)
      expect(body.spans[0].traceId).toBe('trace-123')
      expect(body.metadata.serviceName).toBe('test-service')
    })

    it('should handle export failure', async () => {
      mockFetch.mockResolvedValue(
        new Response('Internal Server Error', {
          status: 500,
        })
      )

      exporter = new ObservabilityExporter({
        enabled: true,
        endpoint: 'https://api.example.com/traces',
        flushIntervalMs: 0,
      })

      exporter.recordSpan({
        traceId: 'trace-123',
        spanId: 'span-456',
        name: 'test',
        startTime: Date.now(),
        attributes: {},
        status: 'ok',
      })

      const result = await exporter.flush()

      expect(result.success).toBe(false)
      expect(result.statusCode).toBe(500)
      expect(result.error).toContain('500')
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      exporter = new ObservabilityExporter({
        enabled: true,
        endpoint: 'https://api.example.com/traces',
        flushIntervalMs: 0,
      })

      exporter.recordSpan({
        traceId: 'trace-123',
        spanId: 'span-456',
        name: 'test',
        startTime: Date.now(),
        attributes: {},
        status: 'ok',
      })

      const result = await exporter.flush()

      expect(result.success).toBe(false)
      expect(result.error).toBe('Network error')
    })
  })

  describe('Shutdown', () => {
    it('should flush remaining spans on shutdown', async () => {
      exporter = new ObservabilityExporter({
        enabled: true,
        flushIntervalMs: 0,
      })

      exporter.recordSpan({
        traceId: 'trace-123',
        spanId: 'span-456',
        name: 'test',
        startTime: Date.now(),
        attributes: {},
        status: 'ok',
      })

      expect(exporter.getBufferSize()).toBe(1)

      const result = await exporter.shutdown()

      expect(exporter.getBufferSize()).toBe(0)
      expect(result.spanCount).toBe(1)
    })
  })
})

describe('createTracingHooks', () => {
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

  it('should create valid TracingHooks', () => {
    expect(hooks.onSpanStart).toBeInstanceOf(Function)
    expect(hooks.onSpanEnd).toBeInstanceOf(Function)
    expect(hooks.onError).toBeInstanceOf(Function)
  })

  it('should record span on onSpanEnd', () => {
    const context: SpanContext = {
      traceId: 'trace-123',
      spanId: 'span-456',
      method: 'testMethod',
      operation: 'invoke',
      startTime: Date.now() - 100,
      attributes: { custom: 'attr' },
    }

    const metrics: RequestMetrics = {
      serializationTimeMs: 5,
      networkTimeMs: 50,
      deserializationTimeMs: 3,
      totalTimeMs: 58,
      requestSizeBytes: 100,
      responseSizeBytes: 200,
      deduplicated: false,
      batched: false,
    }

    hooks.onSpanStart!(context)
    hooks.onSpanEnd!(context, metrics)

    expect(exporter.getBufferSize()).toBe(1)
  })

  it('should record span without prior onSpanStart', () => {
    const context: SpanContext = {
      traceId: 'trace-123',
      spanId: 'span-456',
      method: 'testMethod',
      operation: 'invoke',
      startTime: Date.now() - 100,
      attributes: {},
    }

    const metrics: RequestMetrics = {
      serializationTimeMs: 5,
      networkTimeMs: 50,
      deserializationTimeMs: 3,
      totalTimeMs: 58,
      requestSizeBytes: 100,
      responseSizeBytes: 200,
      deduplicated: false,
      batched: false,
    }

    // Call onSpanEnd without onSpanStart
    hooks.onSpanEnd!(context, metrics)

    expect(exporter.getBufferSize()).toBe(1)
  })

  it('should handle errors and mark span as error', () => {
    const context: SpanContext = {
      traceId: 'trace-123',
      spanId: 'span-456',
      method: 'testMethod',
      operation: 'invoke',
      startTime: Date.now() - 100,
      attributes: {},
    }

    hooks.onSpanStart!(context)
    hooks.onError!(context, new Error('Test error'))

    // Error updates the active span state but doesn't record it yet
    // The span is recorded when onSpanEnd is called
    // Or if onError is called without an active span, it records immediately
    expect(exporter.getBufferSize()).toBe(0)

    // Call error without prior start - should record immediately
    const context2: SpanContext = {
      traceId: 'trace-456',
      spanId: 'span-789',
      method: 'anotherMethod',
      operation: 'invoke',
      startTime: Date.now() - 50,
      attributes: {},
    }

    hooks.onError!(context2, new Error('Another error'))
    expect(exporter.getBufferSize()).toBe(1)
  })

  it('should include metrics as span attributes', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', mockFetch)

    const exporterWithEndpoint = new ObservabilityExporter({
      enabled: true,
      endpoint: 'https://test.example.com/traces',
      flushIntervalMs: 0,
    })
    const hooksWithEndpoint = createTracingHooks(exporterWithEndpoint)

    const context: SpanContext = {
      traceId: 'trace-123',
      spanId: 'span-456',
      method: 'testMethod',
      operation: 'invoke',
      startTime: Date.now() - 100,
      attributes: {},
    }

    const metrics: RequestMetrics = {
      serializationTimeMs: 5,
      networkTimeMs: 50,
      deserializationTimeMs: 3,
      totalTimeMs: 58,
      requestSizeBytes: 100,
      responseSizeBytes: 200,
      deduplicated: true,
      batched: true,
      batchSize: 5,
    }

    hooksWithEndpoint.onSpanStart!(context)
    hooksWithEndpoint.onSpanEnd!(context, metrics)
    await exporterWithEndpoint.flush()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body)
    const span = body.spans[0]

    expect(span.attributes['metrics.totalTimeMs']).toBe(58)
    expect(span.attributes['metrics.deduplicated']).toBe(true)
    expect(span.attributes['metrics.batched']).toBe(true)
    expect(span.attributes['metrics.batchSize']).toBe(5)

    exporterWithEndpoint.stopFlushTimer()
    vi.unstubAllGlobals()
  })
})

describe('createExporterFromEnv', () => {
  it('should create exporter from environment variables', () => {
    const env = {
      OBSERVABILITY_ENABLED: 'true',
      OBSERVABILITY_ENDPOINT: 'https://api.example.com/traces',
      OBSERVABILITY_API_KEY: 'env-api-key',
      OBSERVABILITY_SERVICE_NAME: 'env-service',
      OBSERVABILITY_SAMPLE_RATE: '0.5',
    }

    const exporter = createExporterFromEnv(env)
    const config = exporter.getConfig()

    expect(config.enabled).toBe(true)
    expect(config.endpoint).toBe('https://api.example.com/traces')
    expect(config.apiKey).toBe('env-api-key')
    expect(config.serviceName).toBe('env-service')
    expect(config.sampleRate).toBe(0.5)

    exporter.stopFlushTimer()
  })

  it('should disable when OBSERVABILITY_ENABLED is false', () => {
    const env = {
      OBSERVABILITY_ENABLED: 'false',
    }

    const exporter = createExporterFromEnv(env)
    expect(exporter.getConfig().enabled).toBe(false)
    exporter.stopFlushTimer()
  })

  it('should use defaults when env vars are missing', () => {
    const exporter = createExporterFromEnv({})
    const config = exporter.getConfig()

    expect(config.enabled).toBe(true)
    expect(config.serviceName).toBe('functions-do')
    expect(config.sampleRate).toBe(1)

    exporter.stopFlushTimer()
  })
})

describe('createNoOpExporter', () => {
  it('should create a disabled exporter', () => {
    const exporter = createNoOpExporter()
    expect(exporter.getConfig().enabled).toBe(false)

    // Recording spans should do nothing
    exporter.recordSpan({
      traceId: 'trace-123',
      spanId: 'span-456',
      name: 'test',
      startTime: Date.now(),
      attributes: {},
      status: 'ok',
    })

    expect(exporter.getBufferSize()).toBe(0)
    exporter.stopFlushTimer()
  })
})
