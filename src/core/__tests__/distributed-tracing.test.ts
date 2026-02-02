/**
 * Distributed Tracing Comprehensive Tests
 *
 * Tests for the distributed tracing module (src/core/distributed-tracing.ts).
 * Covers all exported classes, interfaces, and edge cases:
 *
 * 1. TraceContext - creation, parsing, serialization, child contexts
 * 2. Span (SpanImpl) - lifecycle, attributes, exceptions, recording state
 * 3. SpanBuilder - fluent interface for span creation
 * 4. DistributedTracer - span creation, sampling, flush, shutdown
 * 5. W3CTraceContextPropagator - inject/extract headers
 * 6. OpenTelemetryExporter - batching and export
 * 7. TraceExporter - factory (http, console, noop)
 * 8. SamplingConfig - rate limiting sampler with token bucket
 * 9. Edge cases - idempotent end, unsampled spans, error handling
 *
 * @module core/__tests__/distributed-tracing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DistributedTracer,
  TraceContext,
  SpanBuilder,
  TraceExporter,
  SamplingConfig,
  W3CTraceContextPropagator,
  OpenTelemetryExporter,
  type TraceSpan,
  type ExportedTrace,
  type SamplingDecision,
  type Span,
  type SpanLink,
} from '../distributed-tracing'

// ============================================================================
// TraceContext Tests
// ============================================================================

describe('TraceContext', () => {
  describe('create()', () => {
    it('should create a context with valid trace ID (32 hex chars)', () => {
      const ctx = TraceContext.create()
      expect(ctx.traceId).toMatch(/^[a-f0-9]{32}$/)
    })

    it('should create a context with valid span ID (16 hex chars)', () => {
      const ctx = TraceContext.create()
      expect(ctx.spanId).toMatch(/^[a-f0-9]{16}$/)
    })

    it('should create a context that is sampled by default', () => {
      const ctx = TraceContext.create()
      expect(ctx.sampled).toBe(true)
    })

    it('should create a context with no parent span ID', () => {
      const ctx = TraceContext.create()
      expect(ctx.parentSpanId).toBeUndefined()
    })

    it('should generate unique contexts on each call', () => {
      const contexts = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const ctx = TraceContext.create()
        contexts.add(`${ctx.traceId}-${ctx.spanId}`)
      }
      expect(contexts.size).toBe(100)
    })
  })

  describe('fromTraceparent()', () => {
    it('should parse a valid sampled traceparent header', () => {
      const ctx = TraceContext.fromTraceparent(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
      )
      expect(ctx).not.toBeNull()
      expect(ctx!.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
      expect(ctx!.spanId).toBe('b7ad6b7169203331')
      expect(ctx!.sampled).toBe(true)
    })

    it('should parse a valid unsampled traceparent header', () => {
      const ctx = TraceContext.fromTraceparent(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00'
      )
      expect(ctx).not.toBeNull()
      expect(ctx!.sampled).toBe(false)
    })

    it('should return null for unsupported version', () => {
      const ctx = TraceContext.fromTraceparent(
        '01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
      )
      expect(ctx).toBeNull()
    })

    it('should return null for version ff', () => {
      const ctx = TraceContext.fromTraceparent(
        'ff-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
      )
      expect(ctx).toBeNull()
    })

    it('should return null for invalid format - too short', () => {
      expect(TraceContext.fromTraceparent('00-abc-def-01')).toBeNull()
    })

    it('should return null for invalid format - wrong separators', () => {
      expect(TraceContext.fromTraceparent('00_0af7651916cd43dd8448eb211c80319c_b7ad6b7169203331_01')).toBeNull()
    })

    it('should return null for empty string', () => {
      expect(TraceContext.fromTraceparent('')).toBeNull()
    })

    it('should return null for uppercase hex characters', () => {
      expect(TraceContext.fromTraceparent(
        '00-0AF7651916CD43DD8448EB211C80319C-B7AD6B7169203331-01'
      )).toBeNull()
    })

    it('should return null for invalid hex in trace ID', () => {
      expect(TraceContext.fromTraceparent(
        '00-0gf7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
      )).toBeNull()
    })

    it('should parse flags with bit 0 set for sampled', () => {
      // flags = 03 (binary 00000011) has bit 0 set = sampled
      const ctx = TraceContext.fromTraceparent(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-03'
      )
      expect(ctx).not.toBeNull()
      expect(ctx!.sampled).toBe(true)
    })

    it('should parse flags with bit 0 unset for not sampled', () => {
      // flags = 02 (binary 00000010) has bit 0 unset = not sampled
      const ctx = TraceContext.fromTraceparent(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-02'
      )
      expect(ctx).not.toBeNull()
      expect(ctx!.sampled).toBe(false)
    })
  })

  describe('createChildContext()', () => {
    it('should preserve the trace ID in child', () => {
      const parent = TraceContext.create()
      const child = parent.createChildContext()
      expect(child.traceId).toBe(parent.traceId)
    })

    it('should set parentSpanId to parent spanId', () => {
      const parent = TraceContext.create()
      const child = parent.createChildContext()
      expect(child.parentSpanId).toBe(parent.spanId)
    })

    it('should generate a new spanId for child', () => {
      const parent = TraceContext.create()
      const child = parent.createChildContext()
      expect(child.spanId).not.toBe(parent.spanId)
      expect(child.spanId).toMatch(/^[a-f0-9]{16}$/)
    })

    it('should preserve sampled flag', () => {
      const unsampled = new TraceContext('a'.repeat(32), 'b'.repeat(16), undefined, false)
      const child = unsampled.createChildContext()
      expect(child.sampled).toBe(false)
    })

    it('should preserve traceState across child creation', () => {
      const parent = TraceContext.create()
      parent.setTraceState('vendor1=val1,vendor2=val2')
      const child = parent.createChildContext()
      expect(child.getTraceState()).toBe('vendor1=val1,vendor2=val2')
    })

    it('should support multi-level child creation', () => {
      const root = TraceContext.create()
      const child = root.createChildContext()
      const grandchild = child.createChildContext()

      expect(grandchild.traceId).toBe(root.traceId)
      expect(grandchild.parentSpanId).toBe(child.spanId)
      expect(grandchild.spanId).not.toBe(child.spanId)
      expect(grandchild.spanId).not.toBe(root.spanId)
    })
  })

  describe('toTraceparent()', () => {
    it('should serialize sampled context correctly', () => {
      const ctx = new TraceContext('a'.repeat(32), 'b'.repeat(16), undefined, true)
      const traceparent = ctx.toTraceparent()
      expect(traceparent).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`)
    })

    it('should serialize unsampled context correctly', () => {
      const ctx = new TraceContext('a'.repeat(32), 'b'.repeat(16), undefined, false)
      const traceparent = ctx.toTraceparent()
      expect(traceparent).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-00`)
    })

    it('should produce valid W3C format', () => {
      const ctx = TraceContext.create()
      const traceparent = ctx.toTraceparent()
      expect(traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]$/)
    })

    it('should round-trip through fromTraceparent', () => {
      const original = TraceContext.create()
      const serialized = original.toTraceparent()
      const restored = TraceContext.fromTraceparent(serialized)

      expect(restored).not.toBeNull()
      expect(restored!.traceId).toBe(original.traceId)
      expect(restored!.spanId).toBe(original.spanId)
      expect(restored!.sampled).toBe(original.sampled)
    })
  })

  describe('traceState', () => {
    it('should return undefined traceState by default', () => {
      const ctx = TraceContext.create()
      expect(ctx.getTraceState()).toBeUndefined()
    })

    it('should set and get traceState', () => {
      const ctx = TraceContext.create()
      ctx.setTraceState('key1=value1')
      expect(ctx.getTraceState()).toBe('key1=value1')
    })

    it('should overwrite traceState on subsequent set calls', () => {
      const ctx = TraceContext.create()
      ctx.setTraceState('key1=value1')
      ctx.setTraceState('key2=value2')
      expect(ctx.getTraceState()).toBe('key2=value2')
    })
  })
})

// ============================================================================
// Span Tests (via DistributedTracer.startSpan)
// ============================================================================

describe('Span', () => {
  let tracer: DistributedTracer

  beforeEach(() => {
    tracer = new DistributedTracer({
      serviceName: 'test-service',
      enabled: true,
      sampleRate: 1.0,
    })
  })

  afterEach(() => {
    tracer.shutdown()
  })

  describe('basic properties', () => {
    it('should have a valid traceId', () => {
      const span = tracer.startSpan('test-span')
      expect(span.traceId).toMatch(/^[a-f0-9]{32}$/)
      span.end()
    })

    it('should have a valid spanId', () => {
      const span = tracer.startSpan('test-span')
      expect(span.spanId).toMatch(/^[a-f0-9]{16}$/)
      span.end()
    })

    it('should have the correct name', () => {
      const span = tracer.startSpan('my-operation')
      expect(span.name).toBe('my-operation')
      span.end()
    })

    it('should default kind to internal', () => {
      const span = tracer.startSpan('test-span')
      expect(span.kind).toBe('internal')
      span.end()
    })

    it('should set kind from options', () => {
      const span = tracer.startSpan('test-span', { kind: 'server' })
      expect(span.kind).toBe('server')
      span.end()
    })

    it('should have startTime set', () => {
      const before = Date.now()
      const span = tracer.startSpan('test-span')
      const after = Date.now()
      expect(span.startTime).toBeGreaterThanOrEqual(before)
      expect(span.startTime).toBeLessThanOrEqual(after)
      span.end()
    })

    it('should accept custom startTime', () => {
      const customTime = 1700000000000
      const span = tracer.startSpan('test-span', { startTime: customTime })
      expect(span.startTime).toBe(customTime)
      span.end()
    })

    it('should not have endTime before end() is called', () => {
      const span = tracer.startSpan('test-span')
      expect(span.endTime).toBeUndefined()
      span.end()
    })

    it('should have endTime after end() is called', () => {
      const span = tracer.startSpan('test-span')
      span.end()
      expect(span.endTime).toBeDefined()
      expect(typeof span.endTime).toBe('number')
    })

    it('should default status to unset', () => {
      const span = tracer.startSpan('test-span')
      expect(span.status.code).toBe('unset')
      span.end()
    })

    it('should not have parentSpanId for root span', () => {
      const span = tracer.startSpan('root-span')
      expect(span.parentSpanId).toBeUndefined()
      span.end()
    })
  })

  describe('isRecording() and isSampled()', () => {
    it('should be recording when sampled', () => {
      const span = tracer.startSpan('test-span')
      expect(span.isRecording()).toBe(true)
      expect(span.isSampled()).toBe(true)
      span.end()
    })

    it('should stop recording after end()', () => {
      const span = tracer.startSpan('test-span')
      expect(span.isRecording()).toBe(true)
      span.end()
      expect(span.isRecording()).toBe(false)
    })

    it('should not be recording when not sampled', () => {
      const unsampledTracer = new DistributedTracer({
        serviceName: 'test',
        enabled: true,
        sampleRate: 0,
      })
      const span = unsampledTracer.startSpan('unsampled-span')
      expect(span.isSampled()).toBe(false)
      expect(span.isRecording()).toBe(false)
      span.end()
      unsampledTracer.shutdown()
    })
  })

  describe('attributes', () => {
    it('should set and get a single attribute', () => {
      const span = tracer.startSpan('test-span')
      span.setAttribute('key', 'value')
      expect(span.getAttribute('key')).toBe('value')
      span.end()
    })

    it('should set multiple attributes at once', () => {
      const span = tracer.startSpan('test-span')
      span.setAttributes({ a: 1, b: 'two', c: true })
      expect(span.getAttribute('a')).toBe(1)
      expect(span.getAttribute('b')).toBe('two')
      expect(span.getAttribute('c')).toBe(true)
      span.end()
    })

    it('should overwrite existing attribute', () => {
      const span = tracer.startSpan('test-span')
      span.setAttribute('key', 'original')
      span.setAttribute('key', 'updated')
      expect(span.getAttribute('key')).toBe('updated')
      span.end()
    })

    it('should return undefined for non-existent attribute', () => {
      const span = tracer.startSpan('test-span')
      expect(span.getAttribute('nonexistent')).toBeUndefined()
      span.end()
    })

    it('should accept initial attributes from options', () => {
      const span = tracer.startSpan('test-span', {
        attributes: { initial: 'value', count: 42 },
      })
      expect(span.getAttribute('initial')).toBe('value')
      expect(span.getAttribute('count')).toBe(42)
      span.end()
    })

    it('should not record attributes on unsampled span', () => {
      const unsampledTracer = new DistributedTracer({
        serviceName: 'test',
        enabled: true,
        sampleRate: 0,
      })
      const span = unsampledTracer.startSpan('unsampled-span')
      span.setAttribute('key', 'value')
      expect(span.getAttribute('key')).toBeUndefined()
      span.end()
      unsampledTracer.shutdown()
    })

    it('should not record attributes after span is ended', () => {
      const span = tracer.startSpan('test-span')
      span.setAttribute('before', 'ok')
      span.end()
      span.setAttribute('after', 'ignored')
      expect(span.getAttribute('before')).toBe('ok')
      expect(span.getAttribute('after')).toBeUndefined()
    })
  })

  describe('setStatus()', () => {
    it('should set status to ok', () => {
      const span = tracer.startSpan('test-span')
      span.setStatus({ code: 'ok' })
      expect(span.status.code).toBe('ok')
      span.end()
    })

    it('should set status to error with message', () => {
      const span = tracer.startSpan('test-span')
      span.setStatus({ code: 'error', message: 'something failed' })
      expect(span.status.code).toBe('error')
      expect(span.status.message).toBe('something failed')
      span.end()
    })

    it('should not update status on unsampled span', () => {
      const unsampledTracer = new DistributedTracer({
        serviceName: 'test',
        enabled: true,
        sampleRate: 0,
      })
      const span = unsampledTracer.startSpan('test')
      span.setStatus({ code: 'error', message: 'ignored' })
      expect(span.status.code).toBe('unset')
      span.end()
      unsampledTracer.shutdown()
    })

    it('should not update status after span is ended', () => {
      const span = tracer.startSpan('test-span')
      span.setStatus({ code: 'ok' })
      span.end()
      span.setStatus({ code: 'error', message: 'too late' })
      expect(span.status.code).toBe('ok')
    })
  })

  describe('recordException()', () => {
    it('should record a basic exception', () => {
      const span = tracer.startSpan('test-span')
      const error = new Error('test failure')
      span.recordException(error)

      expect(span.getAttribute('exception.type')).toBe('Error')
      expect(span.getAttribute('exception.message')).toBe('test failure')
      expect(span.getAttribute('exception.stacktrace')).toBeDefined()
      span.end()
    })

    it('should record exception type for custom errors', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'CustomError'
        }
      }

      const span = tracer.startSpan('test-span')
      span.recordException(new CustomError('custom failure'))

      expect(span.getAttribute('exception.type')).toBe('CustomError')
      expect(span.getAttribute('exception.message')).toBe('custom failure')
      span.end()
    })

    it('should add additional attributes from recordException', () => {
      const span = tracer.startSpan('test-span')
      span.recordException(new Error('test'), {
        'error.code': 'TIMEOUT',
        'error.retryable': true,
      })

      expect(span.getAttribute('error.code')).toBe('TIMEOUT')
      expect(span.getAttribute('error.retryable')).toBe(true)
      span.end()
    })

    it('should accumulate multiple exceptions', () => {
      const span = tracer.startSpan('test-span')
      span.recordException(new Error('first'))
      span.recordException(new TypeError('second'))

      const exceptions = span.getExceptions()
      expect(exceptions).toHaveLength(2)
      expect(exceptions[0]!.type).toBe('Error')
      expect(exceptions[0]!.message).toBe('first')
      expect(exceptions[1]!.type).toBe('TypeError')
      expect(exceptions[1]!.message).toBe('second')
      span.end()
    })

    it('should not record exceptions on unsampled span', () => {
      const unsampledTracer = new DistributedTracer({
        serviceName: 'test',
        enabled: true,
        sampleRate: 0,
      })
      const span = unsampledTracer.startSpan('test')
      span.recordException(new Error('ignored'))
      expect(span.getExceptions()).toHaveLength(0)
      span.end()
      unsampledTracer.shutdown()
    })

    it('should not record exceptions after span is ended', () => {
      const span = tracer.startSpan('test-span')
      span.end()
      span.recordException(new Error('too late'))
      expect(span.getExceptions()).toHaveLength(0)
    })

    it('should return copies of exceptions array', () => {
      const span = tracer.startSpan('test-span')
      span.recordException(new Error('test'))
      const ex1 = span.getExceptions()
      const ex2 = span.getExceptions()
      expect(ex1).not.toBe(ex2)
      expect(ex1).toEqual(ex2)
      span.end()
    })
  })

  describe('links', () => {
    it('should return empty links by default', () => {
      const span = tracer.startSpan('test-span')
      expect(span.getLinks()).toHaveLength(0)
      span.end()
    })

    it('should accept links from options', () => {
      const links: SpanLink[] = [
        { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), attributes: { type: 'follows_from' } },
        { traceId: 'c'.repeat(32), spanId: 'd'.repeat(16) },
      ]
      const span = tracer.startSpan('test-span', { links })
      const spanLinks = span.getLinks()
      expect(spanLinks).toHaveLength(2)
      expect(spanLinks[0]!.attributes?.['type']).toBe('follows_from')
      span.end()
    })

    it('should return copies of links array', () => {
      const span = tracer.startSpan('test-span', {
        links: [{ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }],
      })
      const links1 = span.getLinks()
      const links2 = span.getLinks()
      expect(links1).not.toBe(links2)
      expect(links1).toEqual(links2)
      span.end()
    })
  })

  describe('getDurationMs()', () => {
    it('should return duration after span is ended', () => {
      vi.useFakeTimers()
      try {
        const span = tracer.startSpan('timed-span')
        vi.advanceTimersByTime(100)
        span.end()
        expect(span.getDurationMs()).toBe(100)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should return elapsed time for active (un-ended) span', () => {
      vi.useFakeTimers()
      try {
        const span = tracer.startSpan('active-span')
        vi.advanceTimersByTime(50)
        const duration = span.getDurationMs()
        expect(duration).toBe(50)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('end() idempotency', () => {
    it('should only set endTime once', () => {
      vi.useFakeTimers()
      try {
        const span = tracer.startSpan('test-span')
        vi.advanceTimersByTime(100)
        span.end()
        const firstEndTime = span.endTime

        vi.advanceTimersByTime(200)
        span.end() // second call should be no-op
        expect(span.endTime).toBe(firstEndTime)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should not call onEnd callback twice', async () => {
      const mockBackend = {
        traces: [] as ExportedTrace[],
        async receiveTraces(traces: ExportedTrace[]): Promise<{ success: boolean; id: string }> {
          for (const t of traces) this.traces.push(t)
          return { success: true, id: 'test' }
        },
      }
      const exporter = new OpenTelemetryExporter(mockBackend.receiveTraces.bind(mockBackend))
      const tracerWithExporter = new DistributedTracer({
        serviceName: 'test',
        enabled: true,
        exporter,
        sampleRate: 1.0,
      })

      const span = tracerWithExporter.startSpan('test-span')
      span.end()
      span.end() // should be no-op

      await tracerWithExporter.flush()
      // Should only have 1 span exported, not 2
      expect(mockBackend.traces.length).toBe(1)
      expect(mockBackend.traces[0]!.spans.length).toBe(1)

      tracerWithExporter.shutdown()
    })
  })

  describe('parent-child relationships', () => {
    it('should inherit traceId from parent span', () => {
      const parent = tracer.startSpan('parent')
      const child = tracer.startSpan('child', { parent })
      expect(child.traceId).toBe(parent.traceId)
      child.end()
      parent.end()
    })

    it('should set parentSpanId to parent spanId', () => {
      const parent = tracer.startSpan('parent')
      const child = tracer.startSpan('child', { parent })
      expect(child.parentSpanId).toBe(parent.spanId)
      child.end()
      parent.end()
    })

    it('should generate unique spanId for child', () => {
      const parent = tracer.startSpan('parent')
      const child = tracer.startSpan('child', { parent })
      expect(child.spanId).not.toBe(parent.spanId)
      child.end()
      parent.end()
    })

    it('should inherit traceId from parentContext', () => {
      const parentCtx = TraceContext.create()
      const span = tracer.startSpan('child', { parentContext: parentCtx })
      expect(span.traceId).toBe(parentCtx.traceId)
      expect(span.parentSpanId).toBe(parentCtx.spanId)
      span.end()
    })

    it('should inherit sampled=true from parent', () => {
      const parent = tracer.startSpan('parent')
      expect(parent.isSampled()).toBe(true)
      const child = tracer.startSpan('child', { parent })
      expect(child.isSampled()).toBe(true)
      child.end()
      parent.end()
    })

    it('should support deeply nested parent-child chains', () => {
      const spans: Span[] = []
      let current: Span | undefined

      for (let i = 0; i < 10; i++) {
        const opts = current ? { parent: current } : undefined
        current = tracer.startSpan(`span-${i}`, opts)
        spans.push(current)
      }

      // Verify chain
      const rootTraceId = spans[0]!.traceId
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i]!.traceId).toBe(rootTraceId)
        expect(spans[i]!.parentSpanId).toBe(spans[i - 1]!.spanId)
      }

      // Cleanup
      for (const s of spans.reverse()) s.end()
    })
  })
})

// ============================================================================
// DistributedTracer Tests
// ============================================================================

describe('DistributedTracer', () => {
  describe('constructor and configuration', () => {
    it('should use default config when no options provided', () => {
      const tracer = new DistributedTracer()
      const config = tracer.getConfig()
      expect(config.serviceName).toBe('functions-do')
      expect(config.enabled).toBe(true)
      expect(config.sampleRate).toBe(1.0)
      tracer.shutdown()
    })

    it('should accept partial config', () => {
      const tracer = new DistributedTracer({ serviceName: 'custom-service' })
      expect(tracer.getConfig().serviceName).toBe('custom-service')
      expect(tracer.getConfig().enabled).toBe(true)
      tracer.shutdown()
    })

    it('should return a copy of config (not reference)', () => {
      const tracer = new DistributedTracer({ serviceName: 'test' })
      const config1 = tracer.getConfig()
      const config2 = tracer.getConfig()
      expect(config1).not.toBe(config2)
      expect(config1).toEqual(config2)
      tracer.shutdown()
    })
  })

  describe('generateTraceId() and generateSpanId()', () => {
    it('should generate W3C-compliant trace IDs', () => {
      const tracer = new DistributedTracer()
      for (let i = 0; i < 50; i++) {
        expect(tracer.generateTraceId()).toMatch(/^[a-f0-9]{32}$/)
      }
      tracer.shutdown()
    })

    it('should generate W3C-compliant span IDs', () => {
      const tracer = new DistributedTracer()
      for (let i = 0; i < 50; i++) {
        expect(tracer.generateSpanId()).toMatch(/^[a-f0-9]{16}$/)
      }
      tracer.shutdown()
    })
  })

  describe('createContext()', () => {
    it('should create a TraceContext from a span', () => {
      const tracer = new DistributedTracer()
      const span = tracer.startSpan('test')
      const ctx = tracer.createContext(span)
      expect(ctx.traceId).toBe(span.traceId)
      expect(ctx.spanId).toBe(span.spanId)
      expect(ctx.sampled).toBe(span.isSampled())
      span.end()
      tracer.shutdown()
    })
  })

  describe('flush()', () => {
    it('should clear pending spans when no exporter is configured', async () => {
      const tracer = new DistributedTracer({ sampleRate: 1.0 })
      const span = tracer.startSpan('test')
      span.end()
      // No exporter, flush should just clear
      await expect(tracer.flush()).resolves.not.toThrow()
      tracer.shutdown()
    })

    it('should export spans to configured exporter', async () => {
      const exported: ExportedTrace[] = []
      const exporter = new OpenTelemetryExporter(
        async (traces) => {
          exported.push(...traces)
          return { success: true, id: 'test' }
        }
      )
      const tracer = new DistributedTracer({
        serviceName: 'test',
        enabled: true,
        exporter,
        sampleRate: 1.0,
      })

      const span = tracer.startSpan('flush-test')
      span.end()
      await tracer.flush()

      expect(exported.length).toBe(1)
      expect(exported[0]!.spans.length).toBe(1)
      expect(exported[0]!.spans[0]!.name).toBe('flush-test')
      tracer.shutdown()
    })

    it('should include resource attributes in exported trace', async () => {
      const exported: ExportedTrace[] = []
      const exporter = new OpenTelemetryExporter(
        async (traces) => {
          exported.push(...traces)
          return { success: true, id: 'test' }
        }
      )
      const tracer = new DistributedTracer({
        serviceName: 'my-service',
        enabled: true,
        exporter,
        resourceAttributes: {
          'service.version': '2.0.0',
          'cloud.provider': 'cloudflare',
        },
      })

      const span = tracer.startSpan('test')
      span.end()
      await tracer.flush()

      expect(exported[0]!.resource['service.name']).toBe('my-service')
      expect(exported[0]!.resource['service.version']).toBe('2.0.0')
      expect(exported[0]!.resource['cloud.provider']).toBe('cloudflare')
      tracer.shutdown()
    })

    it('should not export unsampled spans', async () => {
      const exported: ExportedTrace[] = []
      const exporter = new OpenTelemetryExporter(
        async (traces) => {
          exported.push(...traces)
          return { success: true, id: 'test' }
        }
      )
      const tracer = new DistributedTracer({
        serviceName: 'test',
        enabled: true,
        exporter,
        sampleRate: 0, // nothing sampled
      })

      const span = tracer.startSpan('unsampled')
      span.end()
      await tracer.flush()

      expect(exported.length).toBe(0)
      tracer.shutdown()
    })

    it('should handle exporter errors gracefully', async () => {
      const exporter = new OpenTelemetryExporter(
        async () => { throw new Error('export failed') }
      )
      const tracer = new DistributedTracer({
        serviceName: 'test',
        enabled: true,
        exporter,
        sampleRate: 1.0,
      })

      const span = tracer.startSpan('test')
      span.end()

      // Should not throw
      await expect(tracer.flush()).resolves.not.toThrow()
      tracer.shutdown()
    })

    it('should clear pending spans after flush even with no exporter', async () => {
      const tracer = new DistributedTracer({ sampleRate: 1.0 })

      tracer.startSpan('s1').end()
      tracer.startSpan('s2').end()
      await tracer.flush()

      // Second flush should have nothing
      const exported: ExportedTrace[] = []
      // Can't directly inspect pending spans, but calling flush twice should be harmless
      await expect(tracer.flush()).resolves.not.toThrow()
      tracer.shutdown()
    })
  })

  describe('shutdown()', () => {
    it('should prevent further span collection after shutdown', async () => {
      const exported: ExportedTrace[] = []
      const exporter = new OpenTelemetryExporter(
        async (traces) => {
          exported.push(...traces)
          return { success: true, id: 'test' }
        }
      )
      const tracer = new DistributedTracer({
        serviceName: 'test',
        enabled: true,
        exporter,
        sampleRate: 1.0,
      })

      tracer.shutdown()

      // Spans created after shutdown should not be collected
      const span = tracer.startSpan('after-shutdown')
      span.end()
      await tracer.flush()

      expect(exported.length).toBe(0)
    })
  })

  describe('sampling', () => {
    it('should respect sampleRate=0 (no sampling)', () => {
      const tracer = new DistributedTracer({ sampleRate: 0 })
      const span = tracer.startSpan('test')
      expect(span.isSampled()).toBe(false)
      span.end()
      tracer.shutdown()
    })

    it('should respect sampleRate=1 (full sampling)', () => {
      const tracer = new DistributedTracer({ sampleRate: 1 })
      for (let i = 0; i < 50; i++) {
        const span = tracer.startSpan(`test-${i}`)
        expect(span.isSampled()).toBe(true)
        span.end()
      }
      tracer.shutdown()
    })

    it('should apply probabilistic sampling with sampleRate=0.5', () => {
      const tracer = new DistributedTracer({ sampleRate: 0.5 })
      let sampled = 0
      const total = 2000
      for (let i = 0; i < total; i++) {
        const span = tracer.startSpan(`test-${i}`)
        if (span.isSampled()) sampled++
        span.end()
      }
      // With 50% sampling, expect roughly 800-1200
      expect(sampled).toBeGreaterThan(700)
      expect(sampled).toBeLessThan(1300)
      tracer.shutdown()
    })

    it('should use custom sampler when provided', () => {
      const tracer = new DistributedTracer({
        sampler: (_ctx, name) => ({
          sampled: name.startsWith('important'),
          attributes: name.startsWith('important')
            ? { 'sampling.reason': 'important' }
            : undefined,
        }),
      })

      const important = tracer.startSpan('important-op')
      const regular = tracer.startSpan('regular-op')

      expect(important.isSampled()).toBe(true)
      expect(important.getAttribute('sampling.reason')).toBe('important')
      expect(regular.isSampled()).toBe(false)

      important.end()
      regular.end()
      tracer.shutdown()
    })

    it('should respect parent sampling decision (sampled parent)', () => {
      const tracer = new DistributedTracer({ sampleRate: 1.0 })
      const parent = tracer.startSpan('parent')
      expect(parent.isSampled()).toBe(true)

      const child = tracer.startSpan('child', { parent })
      expect(child.isSampled()).toBe(true)

      child.end()
      parent.end()
      tracer.shutdown()
    })

    it('should respect parentContext sampling decision', () => {
      const tracer = new DistributedTracer({ sampleRate: 1.0 })
      const unsampledCtx = new TraceContext('a'.repeat(32), 'b'.repeat(16), undefined, false)
      const span = tracer.startSpan('child', { parentContext: unsampledCtx })
      expect(span.isSampled()).toBe(false)
      span.end()
      tracer.shutdown()
    })
  })
})

// ============================================================================
// W3CTraceContextPropagator Tests
// ============================================================================

describe('W3CTraceContextPropagator', () => {
  let propagator: W3CTraceContextPropagator

  beforeEach(() => {
    propagator = new W3CTraceContextPropagator()
  })

  describe('inject()', () => {
    it('should set traceparent header', () => {
      const ctx = TraceContext.create()
      const headers = new Headers()
      propagator.inject(ctx, headers)
      const traceparent = headers.get('traceparent')
      expect(traceparent).not.toBeNull()
      expect(traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]$/)
    })

    it('should set tracestate header when traceState is present', () => {
      const ctx = TraceContext.create()
      ctx.setTraceState('vendor=value')
      const headers = new Headers()
      propagator.inject(ctx, headers)
      expect(headers.get('tracestate')).toBe('vendor=value')
    })

    it('should not set tracestate header when traceState is absent', () => {
      const ctx = TraceContext.create()
      const headers = new Headers()
      propagator.inject(ctx, headers)
      expect(headers.get('tracestate')).toBeNull()
    })

    it('should overwrite existing traceparent header', () => {
      const ctx = TraceContext.create()
      const headers = new Headers()
      headers.set('traceparent', 'old-value')
      propagator.inject(ctx, headers)
      expect(headers.get('traceparent')).not.toBe('old-value')
    })
  })

  describe('extract()', () => {
    it('should extract context from valid traceparent', () => {
      const headers = new Headers()
      headers.set('traceparent', '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')
      const ctx = propagator.extract(headers)
      expect(ctx).not.toBeNull()
      expect(ctx!.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
      expect(ctx!.spanId).toBe('b7ad6b7169203331')
      expect(ctx!.sampled).toBe(true)
    })

    it('should extract tracestate when present', () => {
      const headers = new Headers()
      headers.set('traceparent', '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')
      headers.set('tracestate', 'congo=lZWRzIHRoNHJlEgAAkA')
      const ctx = propagator.extract(headers)
      expect(ctx!.getTraceState()).toBe('congo=lZWRzIHRoNHJlEgAAkA')
    })

    it('should return null when no traceparent header', () => {
      const headers = new Headers()
      expect(propagator.extract(headers)).toBeNull()
    })

    it('should return null for invalid traceparent', () => {
      const headers = new Headers()
      headers.set('traceparent', 'invalid')
      expect(propagator.extract(headers)).toBeNull()
    })

    it('should round-trip inject/extract', () => {
      const original = TraceContext.create()
      original.setTraceState('vendor=value')
      const headers = new Headers()
      propagator.inject(original, headers)
      const extracted = propagator.extract(headers)

      expect(extracted).not.toBeNull()
      expect(extracted!.traceId).toBe(original.traceId)
      expect(extracted!.spanId).toBe(original.spanId)
      expect(extracted!.sampled).toBe(original.sampled)
      expect(extracted!.getTraceState()).toBe('vendor=value')
    })
  })
})

// ============================================================================
// SpanBuilder Tests
// ============================================================================

describe('SpanBuilder', () => {
  let tracer: DistributedTracer

  beforeEach(() => {
    tracer = new DistributedTracer({ serviceName: 'test', enabled: true })
  })

  afterEach(() => {
    tracer.shutdown()
  })

  it('should create a span with fluent API', () => {
    const span = SpanBuilder.create('builder-span')
      .withAttribute('key', 'value')
      .withKind('client')
      .build(tracer)

    expect(span.name).toBe('builder-span')
    expect(span.getAttribute('key')).toBe('value')
    expect(span.kind).toBe('client')
    span.end()
  })

  it('should support setting parent', () => {
    const parent = tracer.startSpan('parent')
    const child = SpanBuilder.create('child')
      .withParent(parent)
      .build(tracer)

    expect(child.parentSpanId).toBe(parent.spanId)
    expect(child.traceId).toBe(parent.traceId)
    child.end()
    parent.end()
  })

  it('should support adding links', () => {
    const linked = tracer.startSpan('linked')
    linked.end()

    const span = SpanBuilder.create('with-link')
      .withLink({
        traceId: linked.traceId,
        spanId: linked.spanId,
        attributes: { 'link.type': 'follows_from' },
      })
      .build(tracer)

    expect(span.getLinks()).toHaveLength(1)
    expect(span.getLinks()[0]!.traceId).toBe(linked.traceId)
    span.end()
  })

  it('should support custom start time', () => {
    const customTime = 1700000000000
    const span = SpanBuilder.create('timed')
      .withStartTime(customTime)
      .build(tracer)

    expect(span.startTime).toBe(customTime)
    span.end()
  })

  it('should support multiple attributes', () => {
    const span = SpanBuilder.create('multi-attr')
      .withAttribute('a', 1)
      .withAttribute('b', 'two')
      .withAttribute('c', true)
      .build(tracer)

    expect(span.getAttribute('a')).toBe(1)
    expect(span.getAttribute('b')).toBe('two')
    expect(span.getAttribute('c')).toBe(true)
    span.end()
  })

  it('should default to internal kind', () => {
    const span = SpanBuilder.create('default-kind').build(tracer)
    expect(span.kind).toBe('internal')
    span.end()
  })

  it('should support multiple links', () => {
    const span = SpanBuilder.create('multi-link')
      .withLink({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) })
      .withLink({ traceId: 'c'.repeat(32), spanId: 'd'.repeat(16) })
      .build(tracer)

    expect(span.getLinks()).toHaveLength(2)
    span.end()
  })
})

// ============================================================================
// OpenTelemetryExporter Tests
// ============================================================================

describe('OpenTelemetryExporter', () => {
  it('should send trace to sendFn', async () => {
    const sendFn = vi.fn().mockResolvedValue({ success: true, id: 'test' })
    const exporter = new OpenTelemetryExporter(sendFn)

    const trace: ExportedTrace = {
      serviceName: 'test',
      spans: [{
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        name: 'test-span',
        kind: 'internal',
        startTimeUnixNano: Date.now() * 1_000_000,
        attributes: {},
        status: { code: 'ok' },
      }],
      resource: {},
    }

    await exporter.export(trace)
    expect(sendFn).toHaveBeenCalledTimes(1)
  })

  it('should batch spans when exceeding batchSize', async () => {
    const sendFn = vi.fn().mockResolvedValue({ success: true, id: 'test' })
    const exporter = new OpenTelemetryExporter(sendFn, { batchSize: 3 })

    const spans: TraceSpan[] = []
    for (let i = 0; i < 7; i++) {
      spans.push({
        traceId: 'a'.repeat(32),
        spanId: `${'b'.repeat(8)}${i.toString().padStart(8, '0')}`,
        name: `span-${i}`,
        kind: 'internal',
        startTimeUnixNano: Date.now() * 1_000_000,
        attributes: {},
        status: { code: 'ok' },
      })
    }

    await exporter.export({
      serviceName: 'test',
      spans,
      resource: {},
    })

    // 7 spans / 3 batch size = 3 batches (3, 3, 1)
    expect(sendFn).toHaveBeenCalledTimes(3)

    // Verify batch sizes
    const call1Spans = sendFn.mock.calls[0]![0][0].spans
    const call2Spans = sendFn.mock.calls[1]![0][0].spans
    const call3Spans = sendFn.mock.calls[2]![0][0].spans
    expect(call1Spans.length).toBe(3)
    expect(call2Spans.length).toBe(3)
    expect(call3Spans.length).toBe(1)
  })

  it('should handle sendFn failures gracefully (per batch)', async () => {
    let callCount = 0
    const sendFn = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 2) throw new Error('batch 2 failed')
      return { success: true, id: 'test' }
    })
    const exporter = new OpenTelemetryExporter(sendFn, { batchSize: 2 })

    const spans: TraceSpan[] = []
    for (let i = 0; i < 6; i++) {
      spans.push({
        traceId: 'a'.repeat(32),
        spanId: `${'b'.repeat(8)}${i.toString().padStart(8, '0')}`,
        name: `span-${i}`,
        kind: 'internal',
        startTimeUnixNano: Date.now() * 1_000_000,
        attributes: {},
        status: { code: 'ok' },
      })
    }

    // Should not throw even though one batch fails
    await expect(
      exporter.export({ serviceName: 'test', spans, resource: {} })
    ).resolves.not.toThrow()

    // All 3 batches should have been attempted
    expect(sendFn).toHaveBeenCalledTimes(3)
  })

  it('should default batchSize to 100', async () => {
    const sendFn = vi.fn().mockResolvedValue({ success: true, id: 'test' })
    const exporter = new OpenTelemetryExporter(sendFn)

    const spans: TraceSpan[] = []
    for (let i = 0; i < 50; i++) {
      spans.push({
        traceId: 'a'.repeat(32),
        spanId: `${'b'.repeat(8)}${i.toString().padStart(8, '0')}`,
        name: `span-${i}`,
        kind: 'internal',
        startTimeUnixNano: Date.now() * 1_000_000,
        attributes: {},
        status: { code: 'ok' },
      })
    }

    await exporter.export({ serviceName: 'test', spans, resource: {} })

    // 50 spans < 100 batch size = 1 batch
    expect(sendFn).toHaveBeenCalledTimes(1)
    expect(sendFn.mock.calls[0]![0][0].spans.length).toBe(50)
  })

  it('should preserve serviceName and resource in each batch', async () => {
    const sendFn = vi.fn().mockResolvedValue({ success: true, id: 'test' })
    const exporter = new OpenTelemetryExporter(sendFn, { batchSize: 2 })

    const spans: TraceSpan[] = []
    for (let i = 0; i < 4; i++) {
      spans.push({
        traceId: 'a'.repeat(32),
        spanId: `${'b'.repeat(8)}${i.toString().padStart(8, '0')}`,
        name: `span-${i}`,
        kind: 'internal',
        startTimeUnixNano: Date.now() * 1_000_000,
        attributes: {},
        status: { code: 'ok' },
      })
    }

    const resource = { 'service.version': '1.0' }
    await exporter.export({ serviceName: 'my-svc', spans, resource })

    expect(sendFn).toHaveBeenCalledTimes(2)
    for (const call of sendFn.mock.calls) {
      const batch = call[0][0] as ExportedTrace
      expect(batch.serviceName).toBe('my-svc')
      expect(batch.resource).toEqual(resource)
    }
  })
})

// ============================================================================
// TraceExporter Factory Tests
// ============================================================================

describe('TraceExporter', () => {
  describe('http()', () => {
    it('should create an exporter that calls fetch with correct options', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
      vi.stubGlobal('fetch', mockFetch)

      try {
        const exporter = TraceExporter.http({
          endpoint: 'https://traces.example.com/v1/traces',
          headers: { 'X-Custom': 'header' },
        })

        const trace: ExportedTrace = {
          serviceName: 'test',
          spans: [{
            traceId: 'a'.repeat(32),
            spanId: 'b'.repeat(16),
            name: 'test',
            kind: 'internal',
            startTimeUnixNano: 0,
            attributes: {},
            status: { code: 'ok' },
          }],
          resource: {},
        }

        await exporter.export(trace)

        expect(mockFetch).toHaveBeenCalledTimes(1)
        const [url, opts] = mockFetch.mock.calls[0]!
        expect(url).toBe('https://traces.example.com/v1/traces')
        expect(opts.method).toBe('POST')
        expect(opts.headers['Content-Type']).toBe('application/json')
        expect(opts.headers['X-Custom']).toBe('header')
        expect(JSON.parse(opts.body)).toEqual(trace)
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('console()', () => {
    it('should log trace spans to console', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        const exporter = TraceExporter.console()
        await exporter.export({
          serviceName: 'test',
          spans: [{
            traceId: 'a'.repeat(32),
            spanId: 'b'.repeat(16),
            name: 'console-span',
            kind: 'internal',
            startTimeUnixNano: 1000000000,
            endTimeUnixNano: 2000000000,
            attributes: {},
            status: { code: 'ok' },
          }],
          resource: {},
        })

        expect(consoleSpy).toHaveBeenCalledTimes(1)
        const logOutput = consoleSpy.mock.calls[0]![0] as string
        expect(logOutput).toContain('console-span')
        expect(logOutput).toContain('[TRACE]')
      } finally {
        consoleSpy.mockRestore()
      }
    })

    it('should handle 0 duration when endTimeUnixNano is missing', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        const exporter = TraceExporter.console()
        await exporter.export({
          serviceName: 'test',
          spans: [{
            traceId: 'a'.repeat(32),
            spanId: 'b'.repeat(16),
            name: 'no-end-time',
            kind: 'internal',
            startTimeUnixNano: 1000000000,
            attributes: {},
            status: { code: 'ok' },
          }],
          resource: {},
        })

        expect(consoleSpy).toHaveBeenCalledTimes(1)
        const logOutput = consoleSpy.mock.calls[0]![0] as string
        expect(logOutput).toContain('duration=0ms')
      } finally {
        consoleSpy.mockRestore()
      }
    })
  })

  describe('noop()', () => {
    it('should create an exporter that does nothing', async () => {
      const exporter = TraceExporter.noop()
      await expect(
        exporter.export({
          serviceName: 'test',
          spans: [],
          resource: {},
        })
      ).resolves.not.toThrow()
    })
  })
})

// ============================================================================
// SamplingConfig Tests
// ============================================================================

describe('SamplingConfig', () => {
  describe('rateLimiting()', () => {
    it('should allow spans up to the rate limit', () => {
      const sampler = SamplingConfig.rateLimiting({ maxSpansPerSecond: 5 })
      const ctx = TraceContext.create()

      let sampled = 0
      for (let i = 0; i < 5; i++) {
        const decision = sampler(ctx, `span-${i}`)
        if (decision.sampled) sampled++
      }

      expect(sampled).toBe(5)
    })

    it('should reject spans beyond the rate limit', () => {
      const sampler = SamplingConfig.rateLimiting({ maxSpansPerSecond: 3 })
      const ctx = TraceContext.create()

      let sampled = 0
      for (let i = 0; i < 10; i++) {
        const decision = sampler(ctx, `span-${i}`)
        if (decision.sampled) sampled++
      }

      // Should have sampled at most 3 (the bucket starts full at maxSpansPerSecond)
      expect(sampled).toBeLessThanOrEqual(4) // Allow small tolerance
    })

    it('should refill tokens over time', () => {
      vi.useFakeTimers()
      try {
        const sampler = SamplingConfig.rateLimiting({ maxSpansPerSecond: 5 })
        const ctx = TraceContext.create()

        // Exhaust the bucket
        for (let i = 0; i < 5; i++) {
          sampler(ctx, `span-${i}`)
        }

        // Next span should fail (bucket empty)
        const blocked = sampler(ctx, 'blocked')
        expect(blocked.sampled).toBe(false)

        // Advance time by 1 second - should refill 5 tokens
        vi.advanceTimersByTime(1000)

        // Now should be sampled
        const allowed = sampler(ctx, 'allowed')
        expect(allowed.sampled).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should not exceed maxSpansPerSecond in the bucket', () => {
      vi.useFakeTimers()
      try {
        const sampler = SamplingConfig.rateLimiting({ maxSpansPerSecond: 3 })
        const ctx = TraceContext.create()

        // Use 1 token
        sampler(ctx, 'span-1')

        // Wait 10 seconds (would refill 30 tokens if uncapped)
        vi.advanceTimersByTime(10000)

        // Should only be able to sample maxSpansPerSecond = 3 tokens total
        let sampled = 0
        for (let i = 0; i < 10; i++) {
          const decision = sampler(ctx, `span-${i}`)
          if (decision.sampled) sampled++
        }

        // Bucket caps at 3, so max 3 sampled (plus fractional tolerance)
        expect(sampled).toBeLessThanOrEqual(4)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})

// ============================================================================
// Integration: End-to-end trace lifecycle
// ============================================================================

describe('End-to-end trace lifecycle', () => {
  it('should create a complete trace with parent-child-grandchild and export', async () => {
    const exported: ExportedTrace[] = []
    const exporter = new OpenTelemetryExporter(
      async (traces) => {
        exported.push(...traces)
        return { success: true, id: 'test' }
      }
    )
    const tracer = new DistributedTracer({
      serviceName: 'integration-test',
      enabled: true,
      exporter,
      sampleRate: 1.0,
    })

    // Root span
    const root = tracer.startSpan('http.request', {
      kind: 'server',
      attributes: { 'http.method': 'POST', 'http.url': '/api/invoke' },
    })

    // Child: function execution
    const funcSpan = tracer.startSpan('function.invoke', {
      parent: root,
      attributes: { 'function.id': 'my-func', 'function.language': 'typescript' },
    })

    // Grandchild: database call
    const dbSpan = tracer.startSpan('db.query', {
      parent: funcSpan,
      kind: 'client',
      attributes: { 'db.system': 'postgresql', 'db.statement': 'SELECT * FROM users' },
    })

    dbSpan.setStatus({ code: 'ok' })
    dbSpan.end()

    funcSpan.setAttribute('function.result.success', true)
    funcSpan.end()

    root.setStatus({ code: 'ok' })
    root.end()

    await tracer.flush()

    // Verify export
    expect(exported.length).toBe(1)
    const trace = exported[0]!
    expect(trace.serviceName).toBe('integration-test')
    expect(trace.spans.length).toBe(3)

    // Verify relationships
    const rootExported = trace.spans.find(s => s.name === 'http.request')!
    const funcExported = trace.spans.find(s => s.name === 'function.invoke')!
    const dbExported = trace.spans.find(s => s.name === 'db.query')!

    expect(rootExported.parentSpanId).toBeUndefined()
    expect(funcExported.parentSpanId).toBe(rootExported.spanId)
    expect(dbExported.parentSpanId).toBe(funcExported.spanId)

    // All share same traceId
    expect(funcExported.traceId).toBe(rootExported.traceId)
    expect(dbExported.traceId).toBe(rootExported.traceId)

    // Verify attributes
    expect(rootExported.attributes['http.method']).toBe('POST')
    expect(funcExported.attributes['function.id']).toBe('my-func')
    expect(dbExported.attributes['db.system']).toBe('postgresql')

    // Verify timing
    expect(rootExported.startTimeUnixNano).toBeDefined()
    expect(rootExported.endTimeUnixNano).toBeDefined()

    tracer.shutdown()
  })

  it('should propagate context across service boundaries via headers', async () => {
    const exported: ExportedTrace[] = []
    const exporter = new OpenTelemetryExporter(
      async (traces) => {
        exported.push(...traces)
        return { success: true, id: 'test' }
      }
    )

    // Service A creates initial span
    const serviceA = new DistributedTracer({
      serviceName: 'service-a',
      enabled: true,
      exporter,
      sampleRate: 1.0,
    })

    const spanA = serviceA.startSpan('outbound-call', { kind: 'client' })

    // Inject context into headers for cross-service propagation
    const propagator = new W3CTraceContextPropagator()
    const headers = new Headers()
    propagator.inject(serviceA.createContext(spanA), headers)

    // Service B receives and extracts context
    const serviceB = new DistributedTracer({
      serviceName: 'service-b',
      enabled: true,
      exporter,
      sampleRate: 1.0,
    })

    const extractedCtx = propagator.extract(headers)
    expect(extractedCtx).not.toBeNull()

    const spanB = serviceB.startSpan('handle-request', {
      parentContext: extractedCtx!,
      kind: 'server',
    })

    spanB.end()
    spanA.end()

    await serviceA.flush()
    await serviceB.flush()

    // Both spans should share the same traceId
    const allSpans = exported.flatMap(t => t.spans)
    expect(allSpans.length).toBe(2)
    const traceIds = new Set(allSpans.map(s => s.traceId))
    expect(traceIds.size).toBe(1)

    // spanB should be child of spanA
    const exportedSpanA = allSpans.find(s => s.name === 'outbound-call')!
    const exportedSpanB = allSpans.find(s => s.name === 'handle-request')!
    expect(exportedSpanB.parentSpanId).toBe(exportedSpanA.spanId)

    serviceA.shutdown()
    serviceB.shutdown()
  })

  it('should correctly export span with error and exception', async () => {
    const exported: ExportedTrace[] = []
    const exporter = new OpenTelemetryExporter(
      async (traces) => {
        exported.push(...traces)
        return { success: true, id: 'test' }
      }
    )
    const tracer = new DistributedTracer({
      serviceName: 'test',
      enabled: true,
      exporter,
      sampleRate: 1.0,
    })

    const span = tracer.startSpan('failing-operation')
    try {
      throw new Error('Something broke')
    } catch (e) {
      span.recordException(e as Error)
      span.setStatus({ code: 'error', message: (e as Error).message })
    }
    span.end()

    await tracer.flush()

    const exportedSpan = exported[0]!.spans[0]!
    expect(exportedSpan.status.code).toBe('error')
    expect(exportedSpan.status.message).toBe('Something broke')
    expect(exportedSpan.attributes['exception.type']).toBe('Error')
    expect(exportedSpan.attributes['exception.message']).toBe('Something broke')
    expect(exportedSpan.attributes['exception.stacktrace']).toBeDefined()

    tracer.shutdown()
  })
})
