/**
 * Distributed Tracing Tests (RED Phase - TDD)
 *
 * These tests verify distributed tracing functionality for the Functions.do platform.
 * They are written in RED phase - the implementation does not exist yet, so all tests
 * should fail initially.
 *
 * Test Coverage:
 * 1. Trace ID propagation across function calls
 * 2. Span creation for each function invocation
 * 3. Parent-child span relationships
 * 4. Trace context in HTTP headers (W3C Trace Context)
 * 5. Span attributes (function ID, language, version)
 * 6. Error spans with stack traces
 * 7. Trace export in OpenTelemetry format
 * 8. Sampling configuration
 * 9. Cross-function trace correlation
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'

// These imports will fail until the implementation exists
// This is expected behavior for RED phase TDD
import {
  DistributedTracer,
  TraceContext,
  SpanBuilder,
  TraceExporter,
  SamplingConfig,
  W3CTraceContextPropagator,
  OpenTelemetryExporter,
  type TraceSpan,
  type TraceConfig,
  type ExportedTrace,
  type SamplingDecision,
} from '../../core/distributed-tracing'

// ============================================================================
// Mock Setup
// ============================================================================

/**
 * Mock tracing backend for capturing exported traces
 */
class MockTracingBackend {
  traces: ExportedTrace[] = []
  spans: TraceSpan[] = []
  exportCalls: { traces: ExportedTrace[]; timestamp: number }[] = []

  async receiveTraces(traces: ExportedTrace[]): Promise<{ success: boolean; id: string }> {
    this.exportCalls.push({ traces, timestamp: Date.now() })
    for (const trace of traces) {
      this.traces.push(trace)
      this.spans.push(...trace.spans)
    }
    return { success: true, id: `batch-${Date.now()}` }
  }

  clear(): void {
    this.traces = []
    this.spans = []
    this.exportCalls = []
  }

  getSpansByTraceId(traceId: string): TraceSpan[] {
    return this.spans.filter((s) => s.traceId === traceId)
  }

  getSpansByParentId(parentSpanId: string): TraceSpan[] {
    return this.spans.filter((s) => s.parentSpanId === parentSpanId)
  }
}

/**
 * Mock function executor for simulating function invocations
 */
class MockFunctionExecutor {
  async invoke(
    functionId: string,
    input: unknown,
    context?: { traceContext?: TraceContext }
  ): Promise<{ result: unknown; traceContext: TraceContext }> {
    // Simulate function execution with trace context
    const traceContext = context?.traceContext ?? TraceContext.create()
    return {
      result: { success: true, functionId, input },
      traceContext: traceContext.createChildContext(),
    }
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('DistributedTracer', () => {
  let tracer: DistributedTracer
  let mockBackend: MockTracingBackend

  beforeEach(() => {
    mockBackend = new MockTracingBackend()
    tracer = new DistributedTracer({
      serviceName: 'functions-do-test',
      enabled: true,
      sampleRate: 1.0,
    })
  })

  afterEach(() => {
    tracer.shutdown()
    mockBackend.clear()
  })

  describe('Basic Tracer Operations', () => {
    it('should create a new tracer with default configuration', () => {
      const defaultTracer = new DistributedTracer()

      expect(defaultTracer.getConfig().serviceName).toBe('functions-do')
      expect(defaultTracer.getConfig().enabled).toBe(true)
      expect(defaultTracer.getConfig().sampleRate).toBe(1.0)

      defaultTracer.shutdown()
    })

    it('should accept custom configuration', () => {
      const customTracer = new DistributedTracer({
        serviceName: 'custom-service',
        enabled: true,
        sampleRate: 0.5,
        exporterEndpoint: 'https://traces.example.com',
      })

      const config = customTracer.getConfig()
      expect(config.serviceName).toBe('custom-service')
      expect(config.sampleRate).toBe(0.5)
      expect(config.exporterEndpoint).toBe('https://traces.example.com')

      customTracer.shutdown()
    })

    it('should generate valid trace IDs', () => {
      const traceId = tracer.generateTraceId()

      // W3C Trace Context spec: 32 hex characters
      expect(traceId).toMatch(/^[a-f0-9]{32}$/)
      expect(traceId).not.toBe('00000000000000000000000000000000')
    })

    it('should generate valid span IDs', () => {
      const spanId = tracer.generateSpanId()

      // W3C Trace Context spec: 16 hex characters
      expect(spanId).toMatch(/^[a-f0-9]{16}$/)
      expect(spanId).not.toBe('0000000000000000')
    })

    it('should generate unique IDs across multiple calls', () => {
      const traceIds = new Set<string>()
      const spanIds = new Set<string>()

      for (let i = 0; i < 1000; i++) {
        traceIds.add(tracer.generateTraceId())
        spanIds.add(tracer.generateSpanId())
      }

      expect(traceIds.size).toBe(1000)
      expect(spanIds.size).toBe(1000)
    })
  })

  describe('Trace ID Propagation', () => {
    it('should propagate trace ID across function calls', async () => {
      const executor = new MockFunctionExecutor()

      // Start a trace
      const rootSpan = tracer.startSpan('root-operation')
      const traceId = rootSpan.traceId

      // First function call
      const ctx1 = tracer.createContext(rootSpan)
      const result1 = await executor.invoke('function-a', { data: 1 }, { traceContext: ctx1 })

      // Second function call with propagated context
      const result2 = await executor.invoke('function-b', { data: 2 }, { traceContext: result1.traceContext })

      // Third nested call
      const result3 = await executor.invoke('function-c', { data: 3 }, { traceContext: result2.traceContext })

      rootSpan.end()

      // All contexts should share the same trace ID
      expect(result1.traceContext.traceId).toBe(traceId)
      expect(result2.traceContext.traceId).toBe(traceId)
      expect(result3.traceContext.traceId).toBe(traceId)
    })

    it('should maintain trace ID through async boundaries', async () => {
      const rootSpan = tracer.startSpan('async-root')
      const traceId = rootSpan.traceId

      const asyncOperation = async (): Promise<string> => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        const childSpan = tracer.startSpan('async-child', { parent: rootSpan })
        await new Promise((resolve) => setTimeout(resolve, 10))
        childSpan.end()
        return childSpan.traceId
      }

      const childTraceId = await asyncOperation()
      rootSpan.end()

      expect(childTraceId).toBe(traceId)
    })

    it('should create new trace ID when no parent context exists', async () => {
      const span1 = tracer.startSpan('operation-1')
      const span2 = tracer.startSpan('operation-2')

      expect(span1.traceId).not.toBe(span2.traceId)

      span1.end()
      span2.end()
    })
  })

  describe('Span Creation', () => {
    it('should create spans for each function invocation', () => {
      const span = tracer.startSpan('invoke.myFunction')

      expect(span.name).toBe('invoke.myFunction')
      expect(span.traceId).toBeDefined()
      expect(span.spanId).toBeDefined()
      expect(span.startTime).toBeDefined()
      expect(span.endTime).toBeUndefined()
      expect(span.isRecording()).toBe(true)

      span.end()

      expect(span.endTime).toBeDefined()
      expect(span.isRecording()).toBe(false)
    })

    it('should support span builder pattern', () => {
      const span = SpanBuilder.create('function.invoke')
        .withAttribute('function.id', 'my-function')
        .withAttribute('function.language', 'typescript')
        .withAttribute('function.version', '1.0.0')
        .withStartTime(Date.now())
        .build(tracer)

      expect(span.name).toBe('function.invoke')
      expect(span.getAttribute('function.id')).toBe('my-function')
      expect(span.getAttribute('function.language')).toBe('typescript')
      expect(span.getAttribute('function.version')).toBe('1.0.0')

      span.end()
    })

    it('should record span duration correctly', async () => {
      const span = tracer.startSpan('timed-operation')

      await new Promise((resolve) => setTimeout(resolve, 50))
      span.end()

      const duration = span.getDurationMs()
      expect(duration).toBeGreaterThanOrEqual(50)
      expect(duration).toBeLessThan(150) // Allow some variance
    })

    it('should support span kind', () => {
      const serverSpan = tracer.startSpan('server-span', { kind: 'server' })
      const clientSpan = tracer.startSpan('client-span', { kind: 'client' })
      const internalSpan = tracer.startSpan('internal-span', { kind: 'internal' })

      expect(serverSpan.kind).toBe('server')
      expect(clientSpan.kind).toBe('client')
      expect(internalSpan.kind).toBe('internal')

      serverSpan.end()
      clientSpan.end()
      internalSpan.end()
    })
  })

  describe('Parent-Child Span Relationships', () => {
    it('should establish parent-child relationships', () => {
      const parentSpan = tracer.startSpan('parent-operation')
      const childSpan = tracer.startSpan('child-operation', { parent: parentSpan })

      expect(childSpan.parentSpanId).toBe(parentSpan.spanId)
      expect(childSpan.traceId).toBe(parentSpan.traceId)

      childSpan.end()
      parentSpan.end()
    })

    it('should support multiple levels of nesting', () => {
      const rootSpan = tracer.startSpan('root')
      const level1 = tracer.startSpan('level-1', { parent: rootSpan })
      const level2 = tracer.startSpan('level-2', { parent: level1 })
      const level3 = tracer.startSpan('level-3', { parent: level2 })

      expect(level1.parentSpanId).toBe(rootSpan.spanId)
      expect(level2.parentSpanId).toBe(level1.spanId)
      expect(level3.parentSpanId).toBe(level2.spanId)

      // All should share the same trace ID
      expect(level1.traceId).toBe(rootSpan.traceId)
      expect(level2.traceId).toBe(rootSpan.traceId)
      expect(level3.traceId).toBe(rootSpan.traceId)

      level3.end()
      level2.end()
      level1.end()
      rootSpan.end()
    })

    it('should support sibling spans', () => {
      const parentSpan = tracer.startSpan('parent')
      const sibling1 = tracer.startSpan('sibling-1', { parent: parentSpan })
      const sibling2 = tracer.startSpan('sibling-2', { parent: parentSpan })
      const sibling3 = tracer.startSpan('sibling-3', { parent: parentSpan })

      expect(sibling1.parentSpanId).toBe(parentSpan.spanId)
      expect(sibling2.parentSpanId).toBe(parentSpan.spanId)
      expect(sibling3.parentSpanId).toBe(parentSpan.spanId)

      expect(sibling1.spanId).not.toBe(sibling2.spanId)
      expect(sibling2.spanId).not.toBe(sibling3.spanId)

      sibling1.end()
      sibling2.end()
      sibling3.end()
      parentSpan.end()
    })

    it('should track span hierarchy in exported traces', async () => {
      const exporter = new OpenTelemetryExporter(mockBackend.receiveTraces.bind(mockBackend))
      const tracerWithExporter = new DistributedTracer({
        serviceName: 'test-service',
        enabled: true,
        exporter,
      })

      const root = tracerWithExporter.startSpan('root')
      const child1 = tracerWithExporter.startSpan('child-1', { parent: root })
      const child2 = tracerWithExporter.startSpan('child-2', { parent: root })
      const grandchild = tracerWithExporter.startSpan('grandchild', { parent: child1 })

      grandchild.end()
      child1.end()
      child2.end()
      root.end()

      await tracerWithExporter.flush()

      const spans = mockBackend.getSpansByTraceId(root.traceId)
      expect(spans).toHaveLength(4)

      const rootSpan = spans.find((s) => s.name === 'root')
      const child1Span = spans.find((s) => s.name === 'child-1')
      const grandchildSpan = spans.find((s) => s.name === 'grandchild')

      expect(rootSpan?.parentSpanId).toBeUndefined()
      expect(child1Span?.parentSpanId).toBe(rootSpan?.spanId)
      expect(grandchildSpan?.parentSpanId).toBe(child1Span?.spanId)

      tracerWithExporter.shutdown()
    })
  })

  describe('W3C Trace Context Headers', () => {
    let propagator: W3CTraceContextPropagator

    beforeEach(() => {
      propagator = new W3CTraceContextPropagator()
    })

    it('should inject traceparent header', () => {
      const span = tracer.startSpan('test-operation')
      const headers = new Headers()

      propagator.inject(tracer.createContext(span), headers)

      const traceparent = headers.get('traceparent')
      expect(traceparent).toBeDefined()
      expect(traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-[0-9]{2}$/)

      span.end()
    })

    it('should extract context from traceparent header', () => {
      const headers = new Headers()
      headers.set('traceparent', '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')

      const context = propagator.extract(headers)

      expect(context).toBeDefined()
      expect(context?.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
      expect(context?.spanId).toBe('b7ad6b7169203331')
      expect(context?.sampled).toBe(true)
    })

    it('should handle tracestate header', () => {
      const span = tracer.startSpan('test-operation')
      const context = tracer.createContext(span)
      context.setTraceState('vendor1=value1,vendor2=value2')

      const headers = new Headers()
      propagator.inject(context, headers)

      const tracestate = headers.get('tracestate')
      expect(tracestate).toBe('vendor1=value1,vendor2=value2')

      span.end()
    })

    it('should extract tracestate from headers', () => {
      const headers = new Headers()
      headers.set('traceparent', '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')
      headers.set('tracestate', 'vendor1=value1,vendor2=value2')

      const context = propagator.extract(headers)

      expect(context?.getTraceState()).toBe('vendor1=value1,vendor2=value2')
    })

    it('should handle invalid traceparent gracefully', () => {
      const headers = new Headers()
      headers.set('traceparent', 'invalid-format')

      const context = propagator.extract(headers)

      expect(context).toBeNull()
    })

    it('should handle missing headers gracefully', () => {
      const headers = new Headers()

      const context = propagator.extract(headers)

      expect(context).toBeNull()
    })

    it('should round-trip trace context through headers', () => {
      const originalSpan = tracer.startSpan('original-operation')
      const originalContext = tracer.createContext(originalSpan)

      // Inject into headers
      const headers = new Headers()
      propagator.inject(originalContext, headers)

      // Extract from headers
      const extractedContext = propagator.extract(headers)

      expect(extractedContext?.traceId).toBe(originalContext.traceId)
      expect(extractedContext?.spanId).toBe(originalContext.spanId)

      originalSpan.end()
    })
  })

  describe('Span Attributes', () => {
    it('should support function-specific attributes', () => {
      const span = tracer.startSpan('function.invoke')

      span.setAttribute('function.id', 'my-function-id')
      span.setAttribute('function.language', 'typescript')
      span.setAttribute('function.version', '1.2.3')
      span.setAttribute('function.entrypoint', 'index.ts')
      span.setAttribute('function.memory_mb', 256)
      span.setAttribute('function.timeout_ms', 30000)

      expect(span.getAttribute('function.id')).toBe('my-function-id')
      expect(span.getAttribute('function.language')).toBe('typescript')
      expect(span.getAttribute('function.version')).toBe('1.2.3')
      expect(span.getAttribute('function.entrypoint')).toBe('index.ts')
      expect(span.getAttribute('function.memory_mb')).toBe(256)
      expect(span.getAttribute('function.timeout_ms')).toBe(30000)

      span.end()
    })

    it('should support request/response attributes', () => {
      const span = tracer.startSpan('http.request')

      span.setAttribute('http.method', 'POST')
      span.setAttribute('http.url', 'https://api.functions.do/v1/invoke')
      span.setAttribute('http.status_code', 200)
      span.setAttribute('http.request_content_length', 1024)
      span.setAttribute('http.response_content_length', 2048)

      expect(span.getAttribute('http.method')).toBe('POST')
      expect(span.getAttribute('http.status_code')).toBe(200)

      span.end()
    })

    it('should support setting multiple attributes at once', () => {
      const span = tracer.startSpan('batch-attributes')

      span.setAttributes({
        'function.id': 'test-function',
        'function.language': 'python',
        'function.version': '2.0.0',
        'custom.attribute': 'value',
      })

      expect(span.getAttribute('function.id')).toBe('test-function')
      expect(span.getAttribute('function.language')).toBe('python')
      expect(span.getAttribute('custom.attribute')).toBe('value')

      span.end()
    })

    it('should support array attributes', () => {
      const span = tracer.startSpan('array-attributes')

      span.setAttribute('function.dependencies', ['lodash', 'axios', 'zod'])
      span.setAttribute('http.headers', ['Content-Type', 'Authorization'])

      expect(span.getAttribute('function.dependencies')).toEqual(['lodash', 'axios', 'zod'])

      span.end()
    })

    it('should support boolean attributes', () => {
      const span = tracer.startSpan('boolean-attributes')

      span.setAttribute('function.cached', true)
      span.setAttribute('function.cold_start', false)

      expect(span.getAttribute('function.cached')).toBe(true)
      expect(span.getAttribute('function.cold_start')).toBe(false)

      span.end()
    })
  })

  describe('Error Spans', () => {
    it('should record error status on spans', () => {
      const span = tracer.startSpan('error-operation')

      span.setStatus({ code: 'error', message: 'Something went wrong' })

      expect(span.status.code).toBe('error')
      expect(span.status.message).toBe('Something went wrong')

      span.end()
    })

    it('should record exceptions with stack traces', () => {
      const span = tracer.startSpan('exception-operation')

      try {
        throw new Error('Test error with stack trace')
      } catch (error) {
        span.recordException(error as Error)
      }

      expect(span.getAttribute('exception.type')).toBe('Error')
      expect(span.getAttribute('exception.message')).toBe('Test error with stack trace')
      expect(span.getAttribute('exception.stacktrace')).toBeDefined()
      expect(typeof span.getAttribute('exception.stacktrace')).toBe('string')

      span.end()
    })

    it('should record multiple exceptions on a span', () => {
      const span = tracer.startSpan('multi-exception-operation')

      span.recordException(new Error('First error'))
      span.recordException(new TypeError('Second error'))

      const exceptions = span.getExceptions()
      expect(exceptions).toHaveLength(2)
      expect(exceptions[0]?.type).toBe('Error')
      expect(exceptions[1]?.type).toBe('TypeError')

      span.end()
    })

    it('should capture custom error types', () => {
      class CustomFunctionError extends Error {
        constructor(
          message: string,
          public functionId: string,
          public errorCode: string
        ) {
          super(message)
          this.name = 'CustomFunctionError'
        }
      }

      const span = tracer.startSpan('custom-error-operation')

      const error = new CustomFunctionError('Function failed', 'my-function', 'TIMEOUT')
      span.recordException(error, {
        'function.id': error.functionId,
        'error.code': error.errorCode,
      })

      expect(span.getAttribute('exception.type')).toBe('CustomFunctionError')
      expect(span.getAttribute('function.id')).toBe('my-function')
      expect(span.getAttribute('error.code')).toBe('TIMEOUT')

      span.end()
    })

    it('should preserve stack trace in exported spans', async () => {
      const exporter = new OpenTelemetryExporter(mockBackend.receiveTraces.bind(mockBackend))
      const tracerWithExporter = new DistributedTracer({
        serviceName: 'test-service',
        enabled: true,
        exporter,
      })

      const span = tracerWithExporter.startSpan('error-span')

      try {
        throw new Error('Exported error')
      } catch (error) {
        span.recordException(error as Error)
      }

      span.end()
      await tracerWithExporter.flush()

      const exportedSpan = mockBackend.spans.find((s) => s.name === 'error-span')
      expect(exportedSpan?.attributes['exception.stacktrace']).toContain('Error: Exported error')

      tracerWithExporter.shutdown()
    })
  })

  describe('OpenTelemetry Export Format', () => {
    it('should export spans in OTLP-compatible format', async () => {
      const exporter = new OpenTelemetryExporter(mockBackend.receiveTraces.bind(mockBackend))
      const tracerWithExporter = new DistributedTracer({
        serviceName: 'test-service',
        enabled: true,
        exporter,
      })

      const span = tracerWithExporter.startSpan('otlp-test')
      span.setAttribute('custom.attr', 'value')
      span.end()

      await tracerWithExporter.flush()

      expect(mockBackend.exportCalls).toHaveLength(1)
      const exportedTrace = mockBackend.traces[0]

      expect(exportedTrace).toBeDefined()
      expect(exportedTrace?.serviceName).toBe('test-service')
      expect(exportedTrace?.spans).toHaveLength(1)

      const exportedSpan = exportedTrace?.spans[0]
      expect(exportedSpan?.name).toBe('otlp-test')
      expect(exportedSpan?.traceId).toBeDefined()
      expect(exportedSpan?.spanId).toBeDefined()
      expect(exportedSpan?.startTimeUnixNano).toBeDefined()
      expect(exportedSpan?.endTimeUnixNano).toBeDefined()
      expect(exportedSpan?.attributes['custom.attr']).toBe('value')

      tracerWithExporter.shutdown()
    })

    it('should batch spans for efficient export', async () => {
      const exporter = new OpenTelemetryExporter(mockBackend.receiveTraces.bind(mockBackend), {
        batchSize: 5,
      })
      const tracerWithExporter = new DistributedTracer({
        serviceName: 'test-service',
        enabled: true,
        exporter,
      })

      // Create multiple spans
      for (let i = 0; i < 10; i++) {
        const span = tracerWithExporter.startSpan(`span-${i}`)
        span.end()
      }

      await tracerWithExporter.flush()

      // Should have 2 export calls with 5 spans each
      expect(mockBackend.exportCalls).toHaveLength(2)
      expect(mockBackend.spans).toHaveLength(10)

      tracerWithExporter.shutdown()
    })

    it('should include resource attributes in export', async () => {
      const exporter = new OpenTelemetryExporter(mockBackend.receiveTraces.bind(mockBackend))
      const tracerWithExporter = new DistributedTracer({
        serviceName: 'test-service',
        enabled: true,
        exporter,
        resourceAttributes: {
          'service.version': '1.0.0',
          'deployment.environment': 'test',
          'cloud.provider': 'cloudflare',
        },
      })

      const span = tracerWithExporter.startSpan('resource-test')
      span.end()

      await tracerWithExporter.flush()

      const exportedTrace = mockBackend.traces[0]
      expect(exportedTrace?.resource?.['service.name']).toBe('test-service')
      expect(exportedTrace?.resource?.['service.version']).toBe('1.0.0')
      expect(exportedTrace?.resource?.['deployment.environment']).toBe('test')
      expect(exportedTrace?.resource?.['cloud.provider']).toBe('cloudflare')

      tracerWithExporter.shutdown()
    })

    it('should handle export failures gracefully', async () => {
      const failingBackend = {
        receiveTraces: vi.fn().mockRejectedValue(new Error('Network error')),
      }
      const exporter = new OpenTelemetryExporter(failingBackend.receiveTraces)
      const tracerWithExporter = new DistributedTracer({
        serviceName: 'test-service',
        enabled: true,
        exporter,
      })

      const span = tracerWithExporter.startSpan('failing-export')
      span.end()

      // Should not throw
      await expect(tracerWithExporter.flush()).resolves.not.toThrow()

      tracerWithExporter.shutdown()
    })
  })

  describe('Sampling Configuration', () => {
    it('should respect sample rate of 0 (no sampling)', () => {
      const noSampleTracer = new DistributedTracer({
        serviceName: 'test',
        enabled: true,
        sampleRate: 0,
      })

      const span = noSampleTracer.startSpan('unsampled-span')

      expect(span.isSampled()).toBe(false)
      expect(span.isRecording()).toBe(false)

      span.end()
      noSampleTracer.shutdown()
    })

    it('should respect sample rate of 1 (full sampling)', () => {
      const fullSampleTracer = new DistributedTracer({
        serviceName: 'test',
        enabled: true,
        sampleRate: 1.0,
      })

      // All spans should be sampled
      for (let i = 0; i < 100; i++) {
        const span = fullSampleTracer.startSpan(`sampled-span-${i}`)
        expect(span.isSampled()).toBe(true)
        span.end()
      }

      fullSampleTracer.shutdown()
    })

    it('should apply probabilistic sampling', () => {
      const samplingTracer = new DistributedTracer({
        serviceName: 'test',
        enabled: true,
        sampleRate: 0.5,
      })

      let sampledCount = 0
      const totalSpans = 1000

      for (let i = 0; i < totalSpans; i++) {
        const span = samplingTracer.startSpan(`span-${i}`)
        if (span.isSampled()) {
          sampledCount++
        }
        span.end()
      }

      // With 50% sampling, expect roughly 400-600 sampled spans
      expect(sampledCount).toBeGreaterThan(350)
      expect(sampledCount).toBeLessThan(650)

      samplingTracer.shutdown()
    })

    it('should support custom sampler function', () => {
      const customSampler = (context: TraceContext, name: string): SamplingDecision => {
        // Always sample spans with "critical" in the name
        if (name.includes('critical')) {
          return { sampled: true, attributes: { 'sampling.reason': 'critical' } }
        }
        // Never sample spans with "debug" in the name
        if (name.includes('debug')) {
          return { sampled: false, attributes: { 'sampling.reason': 'debug' } }
        }
        // Default: sample 50%
        return { sampled: Math.random() < 0.5 }
      }

      const customTracer = new DistributedTracer({
        serviceName: 'test',
        enabled: true,
        sampler: customSampler,
      })

      const criticalSpan = customTracer.startSpan('critical-operation')
      const debugSpan = customTracer.startSpan('debug-operation')

      expect(criticalSpan.isSampled()).toBe(true)
      expect(debugSpan.isSampled()).toBe(false)

      criticalSpan.end()
      debugSpan.end()
      customTracer.shutdown()
    })

    it('should respect parent sampling decision', () => {
      const parentSpan = tracer.startSpan('parent')

      // If parent is sampled, child should be sampled
      const sampledChild = tracer.startSpan('sampled-child', { parent: parentSpan })
      expect(sampledChild.isSampled()).toBe(parentSpan.isSampled())

      sampledChild.end()
      parentSpan.end()
    })

    it('should support rate limiting sampler', () => {
      const rateLimitedTracer = new DistributedTracer({
        serviceName: 'test',
        enabled: true,
        sampler: SamplingConfig.rateLimiting({
          maxSpansPerSecond: 10,
        }),
      })

      const startTime = Date.now()
      let sampledCount = 0

      // Create 50 spans rapidly
      for (let i = 0; i < 50; i++) {
        const span = rateLimitedTracer.startSpan(`span-${i}`)
        if (span.isSampled()) {
          sampledCount++
        }
        span.end()
      }

      // Should have limited to roughly 10 sampled spans
      expect(sampledCount).toBeLessThanOrEqual(15) // Allow some tolerance

      rateLimitedTracer.shutdown()
    })
  })

  describe('Cross-Function Trace Correlation', () => {
    it('should correlate traces across function-to-function calls', async () => {
      const exporter = new OpenTelemetryExporter(mockBackend.receiveTraces.bind(mockBackend))
      const tracerWithExporter = new DistributedTracer({
        serviceName: 'test-service',
        enabled: true,
        exporter,
      })

      // Simulate function A calling function B
      const functionASpan = tracerWithExporter.startSpan('function.invoke', {
        attributes: { 'function.id': 'function-a' },
      })

      // Function A makes an outbound call to Function B
      const outboundSpan = tracerWithExporter.startSpan('http.request', {
        parent: functionASpan,
        kind: 'client',
        attributes: {
          'http.method': 'POST',
          'http.url': 'https://function-b.functions.do',
        },
      })

      // Propagate context to Function B
      const headers = new Headers()
      const propagator = new W3CTraceContextPropagator()
      propagator.inject(tracerWithExporter.createContext(outboundSpan), headers)

      // Function B receives the request
      const extractedContext = propagator.extract(headers)
      const functionBSpan = tracerWithExporter.startSpan('function.invoke', {
        parentContext: extractedContext!,
        kind: 'server',
        attributes: { 'function.id': 'function-b' },
      })

      functionBSpan.end()
      outboundSpan.end()
      functionASpan.end()

      await tracerWithExporter.flush()

      // All spans should share the same trace ID
      const spans = mockBackend.spans
      expect(spans).toHaveLength(3)
      expect(new Set(spans.map((s) => s.traceId)).size).toBe(1)

      // Verify parent-child relationships
      const funcA = spans.find((s) => s.attributes['function.id'] === 'function-a')
      const httpReq = spans.find((s) => s.name === 'http.request')
      const funcB = spans.find((s) => s.attributes['function.id'] === 'function-b')

      expect(httpReq?.parentSpanId).toBe(funcA?.spanId)
      expect(funcB?.parentSpanId).toBe(httpReq?.spanId)

      tracerWithExporter.shutdown()
    })

    it('should handle concurrent function invocations with separate traces', async () => {
      const exporter = new OpenTelemetryExporter(mockBackend.receiveTraces.bind(mockBackend))
      const tracerWithExporter = new DistributedTracer({
        serviceName: 'test-service',
        enabled: true,
        exporter,
      })

      // Start 3 concurrent function invocations
      const span1 = tracerWithExporter.startSpan('function.invoke', {
        attributes: { 'request.id': 'req-1' },
      })
      const span2 = tracerWithExporter.startSpan('function.invoke', {
        attributes: { 'request.id': 'req-2' },
      })
      const span3 = tracerWithExporter.startSpan('function.invoke', {
        attributes: { 'request.id': 'req-3' },
      })

      // Each should have a unique trace ID
      expect(span1.traceId).not.toBe(span2.traceId)
      expect(span2.traceId).not.toBe(span3.traceId)
      expect(span1.traceId).not.toBe(span3.traceId)

      span1.end()
      span2.end()
      span3.end()

      await tracerWithExporter.flush()

      // Verify 3 separate traces
      const traceIds = new Set(mockBackend.spans.map((s) => s.traceId))
      expect(traceIds.size).toBe(3)

      tracerWithExporter.shutdown()
    })

    it('should support adding links between related traces', () => {
      const span1 = tracer.startSpan('trigger-function')
      span1.end()

      const span2 = tracer.startSpan('triggered-function', {
        links: [
          {
            traceId: span1.traceId,
            spanId: span1.spanId,
            attributes: { 'link.type': 'trigger' },
          },
        ],
      })

      const links = span2.getLinks()
      expect(links).toHaveLength(1)
      expect(links[0]?.traceId).toBe(span1.traceId)
      expect(links[0]?.spanId).toBe(span1.spanId)
      expect(links[0]?.attributes?.['link.type']).toBe('trigger')

      span2.end()
    })

    it('should handle trace context from queue messages', async () => {
      const exporter = new OpenTelemetryExporter(mockBackend.receiveTraces.bind(mockBackend))
      const tracerWithExporter = new DistributedTracer({
        serviceName: 'test-service',
        enabled: true,
        exporter,
      })

      // Producer creates a message with trace context
      const producerSpan = tracerWithExporter.startSpan('queue.produce', {
        attributes: {
          'messaging.system': 'cloudflare-queues',
          'messaging.destination': 'my-queue',
        },
      })
      const messageContext = tracerWithExporter.createContext(producerSpan)
      producerSpan.end()

      // Consumer receives and processes the message
      const consumerSpan = tracerWithExporter.startSpan('queue.consume', {
        links: [
          {
            traceId: messageContext.traceId,
            spanId: messageContext.spanId,
            attributes: { 'link.type': 'follows_from' },
          },
        ],
        attributes: {
          'messaging.system': 'cloudflare-queues',
          'messaging.destination': 'my-queue',
          'messaging.operation': 'receive',
        },
      })
      consumerSpan.end()

      await tracerWithExporter.flush()

      const producerExported = mockBackend.spans.find((s) => s.name === 'queue.produce')
      const consumerExported = mockBackend.spans.find((s) => s.name === 'queue.consume')

      expect(producerExported).toBeDefined()
      expect(consumerExported).toBeDefined()
      expect(consumerExported?.links?.[0]?.traceId).toBe(producerExported?.traceId)

      tracerWithExporter.shutdown()
    })
  })

  describe('Integration with Function Executor', () => {
    it('should automatically create spans for function invocations', async () => {
      const exporter = new OpenTelemetryExporter(mockBackend.receiveTraces.bind(mockBackend))
      const tracerWithExporter = new DistributedTracer({
        serviceName: 'functions-do',
        enabled: true,
        exporter,
      })

      // Simulate instrumented function executor
      const instrumentedExecutor = {
        async invoke(
          functionId: string,
          input: unknown,
          options?: { tracer?: DistributedTracer }
        ): Promise<unknown> {
          const span = options?.tracer?.startSpan('function.invoke', {
            kind: 'server',
            attributes: {
              'function.id': functionId,
              'function.language': 'typescript',
              'function.version': '1.0.0',
            },
          })

          try {
            // Simulate function execution
            await new Promise((resolve) => setTimeout(resolve, 10))
            span?.setAttribute('function.result.success', true)
            return { result: 'success', functionId }
          } catch (error) {
            span?.recordException(error as Error)
            span?.setStatus({ code: 'error', message: (error as Error).message })
            throw error
          } finally {
            span?.end()
          }
        },
      }

      await instrumentedExecutor.invoke('my-function', { data: 'test' }, { tracer: tracerWithExporter })
      await tracerWithExporter.flush()

      const span = mockBackend.spans.find((s) => s.name === 'function.invoke')
      expect(span).toBeDefined()
      expect(span?.attributes['function.id']).toBe('my-function')
      expect(span?.attributes['function.language']).toBe('typescript')
      expect(span?.attributes['function.result.success']).toBe(true)

      tracerWithExporter.shutdown()
    })

    it('should trace nested function calls with correct parent-child relationships', async () => {
      const exporter = new OpenTelemetryExporter(mockBackend.receiveTraces.bind(mockBackend))
      const tracerWithExporter = new DistributedTracer({
        serviceName: 'functions-do',
        enabled: true,
        exporter,
      })

      // Root request
      const rootSpan = tracerWithExporter.startSpan('http.request', {
        kind: 'server',
        attributes: { 'http.url': '/api/workflow' },
      })

      // First function call
      const func1Span = tracerWithExporter.startSpan('function.invoke', {
        parent: rootSpan,
        attributes: { 'function.id': 'step-1' },
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
      func1Span.end()

      // Second function call
      const func2Span = tracerWithExporter.startSpan('function.invoke', {
        parent: rootSpan,
        attributes: { 'function.id': 'step-2' },
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
      func2Span.end()

      rootSpan.end()
      await tracerWithExporter.flush()

      const httpSpan = mockBackend.spans.find((s) => s.name === 'http.request')
      const step1Span = mockBackend.spans.find((s) => s.attributes['function.id'] === 'step-1')
      const step2Span = mockBackend.spans.find((s) => s.attributes['function.id'] === 'step-2')

      expect(step1Span?.parentSpanId).toBe(httpSpan?.spanId)
      expect(step2Span?.parentSpanId).toBe(httpSpan?.spanId)
      expect(step1Span?.traceId).toBe(httpSpan?.traceId)
      expect(step2Span?.traceId).toBe(httpSpan?.traceId)

      tracerWithExporter.shutdown()
    })
  })
})

describe('TraceContext', () => {
  it('should create a new trace context', () => {
    const context = TraceContext.create()

    expect(context.traceId).toMatch(/^[a-f0-9]{32}$/)
    expect(context.spanId).toMatch(/^[a-f0-9]{16}$/)
    expect(context.sampled).toBe(true)
  })

  it('should create child context with same trace ID', () => {
    const parent = TraceContext.create()
    const child = parent.createChildContext()

    expect(child.traceId).toBe(parent.traceId)
    expect(child.spanId).not.toBe(parent.spanId)
    expect(child.parentSpanId).toBe(parent.spanId)
  })

  it('should serialize to W3C trace context format', () => {
    const context = TraceContext.create()
    const traceparent = context.toTraceparent()

    expect(traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]$/)
  })

  it('should parse from W3C trace context format', () => {
    const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
    const context = TraceContext.fromTraceparent(traceparent)

    expect(context?.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
    expect(context?.spanId).toBe('b7ad6b7169203331')
    expect(context?.sampled).toBe(true)
  })

  it('should handle unsampled trace context', () => {
    const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00'
    const context = TraceContext.fromTraceparent(traceparent)

    expect(context?.sampled).toBe(false)
  })
})

describe('SpanBuilder', () => {
  let tracer: DistributedTracer

  beforeEach(() => {
    tracer = new DistributedTracer({
      serviceName: 'test-service',
      enabled: true,
    })
  })

  afterEach(() => {
    tracer.shutdown()
  })

  it('should build spans with fluent interface', () => {
    const span = SpanBuilder.create('test-operation')
      .withAttribute('key1', 'value1')
      .withAttribute('key2', 123)
      .withKind('client')
      .build(tracer)

    expect(span.name).toBe('test-operation')
    expect(span.getAttribute('key1')).toBe('value1')
    expect(span.getAttribute('key2')).toBe(123)
    expect(span.kind).toBe('client')

    span.end()
  })

  it('should support parent span in builder', () => {
    const parent = tracer.startSpan('parent')

    const child = SpanBuilder.create('child')
      .withParent(parent)
      .withAttribute('child.attr', 'value')
      .build(tracer)

    expect(child.parentSpanId).toBe(parent.spanId)
    expect(child.traceId).toBe(parent.traceId)

    child.end()
    parent.end()
  })

  it('should support links in builder', () => {
    const related = tracer.startSpan('related')
    related.end()

    const span = SpanBuilder.create('linked-operation')
      .withLink({
        traceId: related.traceId,
        spanId: related.spanId,
        attributes: { 'link.reason': 'test' },
      })
      .build(tracer)

    const links = span.getLinks()
    expect(links).toHaveLength(1)
    expect(links[0]?.traceId).toBe(related.traceId)

    span.end()
  })
})

describe('TraceExporter', () => {
  it('should export to HTTP endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', mockFetch)

    const exporter = TraceExporter.http({
      endpoint: 'https://traces.example.com/v1/traces',
      headers: {
        Authorization: 'Bearer test-token',
      },
    })

    const spans: TraceSpan[] = [
      {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        name: 'test-span',
        startTimeUnixNano: Date.now() * 1_000_000,
        endTimeUnixNano: (Date.now() + 100) * 1_000_000,
        attributes: {},
        status: { code: 'ok' },
        kind: 'internal',
      },
    ]

    await exporter.export({
      serviceName: 'test-service',
      spans,
      resource: {},
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://traces.example.com/v1/traces',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        }),
      })
    )

    vi.unstubAllGlobals()
  })

  it('should support console exporter for debugging', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const exporter = TraceExporter.console()

    await exporter.export({
      serviceName: 'test-service',
      spans: [
        {
          traceId: '0af7651916cd43dd8448eb211c80319c',
          spanId: 'b7ad6b7169203331',
          name: 'debug-span',
          startTimeUnixNano: Date.now() * 1_000_000,
          endTimeUnixNano: (Date.now() + 100) * 1_000_000,
          attributes: {},
          status: { code: 'ok' },
          kind: 'internal',
        },
      ],
      resource: {},
    })

    expect(consoleSpy).toHaveBeenCalled()
    const logOutput = consoleSpy.mock.calls[0]?.[0]
    expect(logOutput).toContain('debug-span')

    consoleSpy.mockRestore()
  })

  it('should support no-op exporter', async () => {
    const exporter = TraceExporter.noop()

    // Should not throw
    await expect(
      exporter.export({
        serviceName: 'test-service',
        spans: [],
        resource: {},
      })
    ).resolves.not.toThrow()
  })
})
