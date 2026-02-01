/**
 * Observability Backend Integration
 *
 * This module provides observability integration for sending tracing data
 * to external backends like Honeycomb, Jaeger, or any OpenTelemetry-compatible endpoint.
 *
 * Features:
 * - Configurable endpoint and authentication
 * - Sampling rate control
 * - Buffered span collection with automatic flushing
 * - Integration with existing TracingHooks interface
 */

import type { TracingHooks, SpanContext, RequestMetrics } from './function-target'
import { OBSERVABILITY } from '../config'

// ============================================================================
// Types
// ============================================================================

/**
 * Supported observability backend types
 */
export type ObservabilityBackend = 'honeycomb' | 'otlp' | 'generic'

/**
 * Configuration for the observability backend
 */
export interface ObservabilityConfig {
  /**
   * Whether observability is enabled
   * @default true
   */
  enabled: boolean

  /**
   * Backend type for authentication header format
   * - 'honeycomb': Uses X-Honeycomb-Team header
   * - 'otlp': Uses Authorization: Bearer header (OpenTelemetry standard)
   * - 'generic': Uses Authorization: Bearer header
   * @default Auto-detected from endpoint URL, or 'generic' if not detected
   */
  backend?: ObservabilityBackend

  /**
   * Endpoint URL for sending trace data
   * e.g., https://api.honeycomb.io/1/events/dataset-name
   */
  endpoint?: string

  /**
   * API key for authentication with the backend
   */
  apiKey?: string

  /**
   * Service name to tag all spans with
   * @default 'functions-do'
   */
  serviceName?: string

  /**
   * Sample rate between 0 and 1
   * 1.0 = 100% of spans, 0.5 = 50%, 0.1 = 10%
   * @default 1.0
   */
  sampleRate?: number

  /**
   * Maximum number of spans to buffer before auto-flushing
   * @default 100
   */
  bufferSize?: number

  /**
   * Interval in milliseconds to auto-flush buffered spans
   * @default 5000
   */
  flushIntervalMs?: number

  /**
   * Headers to include with export requests
   */
  headers?: Record<string, string>

  /**
   * Timeout for export requests in milliseconds
   * @default 30000
   */
  exportTimeoutMs?: number
}

/**
 * Span representation for export
 * Compatible with OpenTelemetry span format
 */
export interface Span {
  /** Trace ID linking related spans */
  traceId: string

  /** Unique identifier for this span */
  spanId: string

  /** Parent span ID if this is a child span */
  parentSpanId?: string

  /** Name/operation of the span */
  name: string

  /** Start time in milliseconds since epoch */
  startTime: number

  /** End time in milliseconds since epoch (set when span ends) */
  endTime?: number

  /** Duration in milliseconds */
  durationMs?: number

  /** Arbitrary attributes/tags for the span */
  attributes: Record<string, unknown>

  /** Status of the span */
  status: 'ok' | 'error'

  /** Error message if status is 'error' */
  errorMessage?: string

  /** Service name */
  serviceName?: string
}

/**
 * Result of an export operation
 */
export interface ExportResult {
  /** Whether the export succeeded */
  success: boolean

  /** Number of spans exported */
  spanCount: number

  /** Error message if export failed */
  error?: string

  /** HTTP status code if applicable */
  statusCode?: number
}

// ============================================================================
// ObservabilityExporter Class
// ============================================================================

/**
 * Exports spans to an observability backend
 *
 * Handles buffering, sampling, and batch export of trace data.
 */
export class ObservabilityExporter {
  private buffer: Span[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private readonly config: Required<
    Pick<ObservabilityConfig, 'enabled' | 'serviceName' | 'sampleRate' | 'bufferSize' | 'flushIntervalMs' | 'exportTimeoutMs' | 'backend'>
  > &
    Pick<ObservabilityConfig, 'endpoint' | 'apiKey' | 'headers'>

  constructor(config: ObservabilityConfig) {
    const baseConfig = {
      enabled: config.enabled ?? true,
      serviceName: config.serviceName ?? OBSERVABILITY.DEFAULT_SERVICE_NAME,
      sampleRate: Math.max(0, Math.min(1, config.sampleRate ?? OBSERVABILITY.DEFAULT_SAMPLE_RATE)),
      bufferSize: config.bufferSize ?? OBSERVABILITY.BUFFER_SIZE,
      flushIntervalMs: config.flushIntervalMs ?? OBSERVABILITY.FLUSH_INTERVAL_MS,
      exportTimeoutMs: config.exportTimeoutMs ?? OBSERVABILITY.EXPORT_TIMEOUT_MS,
      backend: config.backend ?? this.detectBackend(config.endpoint),
    }

    this.config = baseConfig as typeof this.config
    if (config.endpoint !== undefined) {
      this.config.endpoint = config.endpoint
    }
    if (config.apiKey !== undefined) {
      this.config.apiKey = config.apiKey
    }
    if (config.headers !== undefined) {
      this.config.headers = config.headers
    }

    // Start periodic flush if enabled and has endpoint
    if (this.config.enabled && this.config.endpoint && this.config.flushIntervalMs > 0) {
      this.startFlushTimer()
    }
  }

  /**
   * Detect the backend type from the endpoint URL
   */
  private detectBackend(endpoint?: string): ObservabilityBackend {
    if (!endpoint) {
      return 'generic'
    }

    try {
      const url = new URL(endpoint)
      const hostname = url.hostname.toLowerCase()

      // Detect Honeycomb endpoints
      if (hostname.includes('honeycomb.io') || hostname.includes('honeycomb.com')) {
        return 'honeycomb'
      }

      // Detect common OTLP endpoints
      if (
        hostname.includes('otel') ||
        hostname.includes('opentelemetry') ||
        url.pathname.includes('/v1/traces')
      ) {
        return 'otlp'
      }

      return 'generic'
    } catch {
      // If URL parsing fails, default to generic
      return 'generic'
    }
  }

  /**
   * Get the current configuration
   */
  getConfig(): ObservabilityConfig {
    return { ...this.config }
  }

  /**
   * Get the number of buffered spans
   */
  getBufferSize(): number {
    return this.buffer.length
  }

  /**
   * Record a span for export
   *
   * Applies sampling and adds to buffer. May trigger auto-flush.
   */
  recordSpan(span: Span): void {
    if (!this.config.enabled) return

    // Apply sampling
    if (this.config.sampleRate < 1 && Math.random() > this.config.sampleRate) {
      return
    }

    // Add service name if not present
    const spanWithService: Span = {
      ...span,
      serviceName: span.serviceName ?? this.config.serviceName,
    }

    this.buffer.push(spanWithService)

    // Auto-flush if buffer is full
    if (this.buffer.length >= this.config.bufferSize) {
      this.flush().catch(() => {
        // Silently ignore flush errors in auto-flush
      })
    }
  }

  /**
   * Flush all buffered spans to the backend
   *
   * @returns Export result with success status and span count
   */
  async flush(): Promise<ExportResult> {
    if (!this.buffer.length) {
      return { success: true, spanCount: 0 }
    }

    if (!this.config.endpoint) {
      // Clear buffer but report as not exported
      const count = this.buffer.length
      this.buffer = []
      return {
        success: false,
        spanCount: count,
        error: 'No endpoint configured',
      }
    }

    // Take spans from buffer
    const spansToExport = [...this.buffer]
    this.buffer = []

    try {
      const result = await this.exportSpans(spansToExport)
      return result
    } catch (error) {
      // On failure, optionally re-buffer spans (up to limit)
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Don't re-buffer to avoid infinite growth
      return {
        success: false,
        spanCount: spansToExport.length,
        error: errorMessage,
      }
    }
  }

  /**
   * Export spans to the configured endpoint
   */
  private async exportSpans(spans: Span[]): Promise<ExportResult> {
    if (!this.config.endpoint) {
      return {
        success: false,
        spanCount: spans.length,
        error: 'No endpoint configured',
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    }

    // Add API key header based on backend type
    if (this.config.apiKey) {
      switch (this.config.backend) {
        case 'honeycomb':
          headers['X-Honeycomb-Team'] = this.config.apiKey
          break
        case 'otlp':
        case 'generic':
        default:
          headers['Authorization'] = `Bearer ${this.config.apiKey}`
          break
      }
    }

    const body = JSON.stringify({
      spans,
      metadata: {
        serviceName: this.config.serviceName,
        exportedAt: Date.now(),
        spanCount: spans.length,
      },
    })

    // Create abort controller for timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.exportTimeoutMs)

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        return {
          success: false,
          spanCount: spans.length,
          error: `Export failed: ${response.status} ${errorText}`,
          statusCode: response.status,
        }
      }

      return {
        success: true,
        spanCount: spans.length,
        statusCode: response.status,
      }
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          spanCount: spans.length,
          error: 'Export timed out',
        }
      }

      throw error
    }
  }

  /**
   * Start the periodic flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) return

    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {
        // Silently ignore periodic flush errors
      })
    }, this.config.flushIntervalMs)
  }

  /**
   * Stop the periodic flush timer
   */
  stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  /**
   * Shutdown the exporter, flushing remaining spans
   */
  async shutdown(): Promise<ExportResult> {
    this.stopFlushTimer()
    return this.flush()
  }
}

// ============================================================================
// Tracing Hooks Factory
// ============================================================================

/**
 * Create TracingHooks that export spans to an ObservabilityExporter
 *
 * This bridges the existing TracingHooks interface with the observability backend.
 *
 * @param exporter - The ObservabilityExporter instance to use
 * @returns TracingHooks compatible with FunctionTarget
 */
export function createTracingHooks(exporter: ObservabilityExporter): TracingHooks {
  // Map to track in-progress spans
  const activeSpans = new Map<string, { context: SpanContext; span: Partial<Span> }>()

  return {
    onSpanStart(context: SpanContext): void {
      const span: Partial<Span> = {
        traceId: context.traceId,
        spanId: context.spanId,
        name: `${context.operation}.${context.method}`,
        startTime: Date.now(),
        attributes: { ...context.attributes },
        status: 'ok',
      }
      if (context.parentSpanId !== undefined) {
        span.parentSpanId = context.parentSpanId
      }

      activeSpans.set(context.spanId, { context, span })
    },

    onSpanEnd(context: SpanContext, metrics: RequestMetrics): void {
      const active = activeSpans.get(context.spanId)

      if (active) {
        const endTime = Date.now()
        const completedSpan: Span = {
          ...active.span,
          traceId: context.traceId,
          spanId: context.spanId,
          name: active.span.name ?? `${context.operation}.${context.method}`,
          startTime: active.span.startTime ?? endTime,
          endTime,
          durationMs: metrics.totalTimeMs,
          attributes: {
            ...active.span.attributes,
            ...context.attributes,
            // Add metrics as attributes
            'metrics.serializationTimeMs': metrics.serializationTimeMs,
            'metrics.networkTimeMs': metrics.networkTimeMs,
            'metrics.deserializationTimeMs': metrics.deserializationTimeMs,
            'metrics.totalTimeMs': metrics.totalTimeMs,
            'metrics.requestSizeBytes': metrics.requestSizeBytes,
            'metrics.responseSizeBytes': metrics.responseSizeBytes,
            'metrics.deduplicated': metrics.deduplicated,
            'metrics.batched': metrics.batched,
            ...(metrics.batchSize !== undefined && { 'metrics.batchSize': metrics.batchSize }),
          },
          status: 'ok',
        }
        if (context.parentSpanId !== undefined) {
          completedSpan.parentSpanId = context.parentSpanId
        }

        activeSpans.delete(context.spanId)
        exporter.recordSpan(completedSpan)
      } else {
        // Span wasn't tracked (possibly started before hooks were attached)
        // Create a complete span from available info
        const endTime = Date.now()
        const span: Span = {
          traceId: context.traceId,
          spanId: context.spanId,
          name: `${context.operation}.${context.method}`,
          startTime: endTime - metrics.totalTimeMs,
          endTime,
          durationMs: metrics.totalTimeMs,
          attributes: {
            ...context.attributes,
            'metrics.serializationTimeMs': metrics.serializationTimeMs,
            'metrics.networkTimeMs': metrics.networkTimeMs,
            'metrics.deserializationTimeMs': metrics.deserializationTimeMs,
            'metrics.totalTimeMs': metrics.totalTimeMs,
            'metrics.requestSizeBytes': metrics.requestSizeBytes,
            'metrics.responseSizeBytes': metrics.responseSizeBytes,
            'metrics.deduplicated': metrics.deduplicated,
            'metrics.batched': metrics.batched,
            ...(metrics.batchSize !== undefined && { 'metrics.batchSize': metrics.batchSize }),
          },
          status: 'ok',
        }
        if (context.parentSpanId !== undefined) {
          span.parentSpanId = context.parentSpanId
        }
        exporter.recordSpan(span)
      }
    },

    onError(context: SpanContext, error: Error): void {
      const active = activeSpans.get(context.spanId)

      if (active) {
        active.span.status = 'error'
        active.span.errorMessage = error.message
        active.span.attributes = {
          ...active.span.attributes,
          'error.type': error.name,
          'error.message': error.message,
          'error.stack': error.stack,
        }
      } else {
        // Create an error span immediately
        const endTime = Date.now()
        const errorAttrs: Record<string, unknown> = {
          ...context.attributes,
          'error.type': error.name,
          'error.message': error.message,
        }
        if (error.stack !== undefined) {
          errorAttrs['error.stack'] = error.stack
        }
        const span: Span = {
          traceId: context.traceId,
          spanId: context.spanId,
          name: `${context.operation}.${context.method}`,
          startTime: context.startTime,
          endTime,
          durationMs: endTime - context.startTime,
          attributes: errorAttrs,
          status: 'error',
          errorMessage: error.message,
        }
        if (context.parentSpanId !== undefined) {
          span.parentSpanId = context.parentSpanId
        }
        exporter.recordSpan(span)
      }
    },
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create an ObservabilityExporter from environment variables
 *
 * Supported environment variables:
 * - OBSERVABILITY_ENABLED: 'true' or 'false'
 * - OBSERVABILITY_ENDPOINT: URL for the backend
 * - OBSERVABILITY_API_KEY: API key for authentication
 * - OBSERVABILITY_SERVICE_NAME: Service name for spans
 * - OBSERVABILITY_SAMPLE_RATE: Number between 0 and 1
 * - OBSERVABILITY_BACKEND: Backend type ('honeycomb', 'otlp', or 'generic')
 *
 * @param env - Environment object with optional observability config
 * @returns ObservabilityExporter instance
 */
export function createExporterFromEnv(env: Record<string, unknown>): ObservabilityExporter {
  const endpoint = env['OBSERVABILITY_ENDPOINT'] as string | undefined
  const apiKey = env['OBSERVABILITY_API_KEY'] as string | undefined
  const serviceName = (env['OBSERVABILITY_SERVICE_NAME'] as string | undefined) ?? 'functions-do'
  const sampleRateStr = env['OBSERVABILITY_SAMPLE_RATE'] as string | undefined
  const backendStr = env['OBSERVABILITY_BACKEND'] as string | undefined

  const config: ObservabilityConfig = {
    enabled: env['OBSERVABILITY_ENABLED'] !== 'false',
    serviceName,
    sampleRate: sampleRateStr ? parseFloat(sampleRateStr) : 1.0,
  }

  if (endpoint !== undefined) {
    config.endpoint = endpoint
  }
  if (apiKey !== undefined) {
    config.apiKey = apiKey
  }
  if (backendStr !== undefined && isValidBackend(backendStr)) {
    config.backend = backendStr
  }

  return new ObservabilityExporter(config)
}

/**
 * Type guard to validate backend string
 */
function isValidBackend(value: string): value is ObservabilityBackend {
  return value === 'honeycomb' || value === 'otlp' || value === 'generic'
}

/**
 * Create a no-op exporter that doesn't send data anywhere
 *
 * Useful for development or testing when you don't want to send real data.
 */
export function createNoOpExporter(): ObservabilityExporter {
  return new ObservabilityExporter({
    enabled: false,
  })
}
