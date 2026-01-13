/**
 * Metrics Export Tests (RED Phase - TDD)
 *
 * Comprehensive tests for metrics export functionality including:
 * 1. Function invocation counts
 * 2. Execution duration metrics (p50, p95, p99)
 * 3. Error rate metrics
 * 4. Memory usage metrics per function
 * 5. Cold start vs warm start metrics
 * 6. Prometheus/OpenMetrics export format
 * 7. Per-language breakdown metrics
 * 8. Rate limiting metrics
 *
 * These tests are designed to FAIL initially as the implementation
 * doesn't exist yet (RED phase of TDD).
 *
 * @module __tests__/observability/metrics
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockKV } from '../../test-utils/mock-kv'

// ============================================================================
// MOCK DURABLE OBJECT STATE
// ============================================================================

/**
 * Creates a mock Durable Object state for testing
 */
function createMockDurableObjectState() {
  const storage = new Map<string, unknown>()
  const sqlData: Record<string, unknown[]> = {}

  return {
    storage: {
      get: async <T>(key: string): Promise<T | undefined> => storage.get(key) as T | undefined,
      put: async (key: string, value: unknown): Promise<void> => {
        storage.set(key, value)
      },
      delete: async (key: string): Promise<boolean> => storage.delete(key),
      list: async () => new Map(storage),
      sql: {
        exec: vi.fn().mockReturnValue({
          toArray: () => [],
          one: () => null,
        }),
      },
      setAlarm: vi.fn(),
      getAlarm: vi.fn(),
      deleteAlarm: vi.fn(),
    },
    id: {
      toString: () => 'mock-do-id',
      name: 'mock-do',
    },
    waitUntil: vi.fn(),
  }
}

// ============================================================================
// TYPE DEFINITIONS FOR EXPECTED METRICS API
// ============================================================================

/**
 * Expected interface for MetricsCollector
 * These types define what we expect the implementation to provide
 */
interface ExpectedMetricsCollector {
  recordInvocation(functionId: string, options: {
    language: string
    duration: number
    success: boolean
    coldStart: boolean
    memoryUsed?: number
    error?: string
  }): void

  recordRateLimitHit(functionId: string, clientIp: string): void

  getInvocationCount(functionId: string): Promise<number>
  getTotalInvocationCount(): Promise<number>

  getDurationMetrics(functionId: string): Promise<{
    p50: number
    p95: number
    p99: number
    min: number
    max: number
    avg: number
    count: number
  }>

  getErrorRate(functionId: string): Promise<{
    errorCount: number
    totalCount: number
    errorRate: number
  }>

  getMemoryMetrics(functionId: string): Promise<{
    avgMemoryBytes: number
    maxMemoryBytes: number
    minMemoryBytes: number
    count: number
  }>

  getColdStartMetrics(functionId: string): Promise<{
    coldStartCount: number
    warmStartCount: number
    coldStartRate: number
    avgColdStartDuration: number
    avgWarmStartDuration: number
  }>

  getLanguageBreakdown(): Promise<Record<string, {
    invocationCount: number
    avgDuration: number
    errorRate: number
  }>>

  getRateLimitMetrics(functionId: string): Promise<{
    totalHits: number
    uniqueIps: number
    hitsByIp: Record<string, number>
  }>

  exportPrometheus(): Promise<string>
  exportOpenMetrics(): Promise<string>

  reset(): void
}

/**
 * Expected interface for MetricsExporter
 */
interface ExpectedMetricsExporter {
  export(format: 'prometheus' | 'openmetrics' | 'json'): Promise<string>
  getContentType(format: 'prometheus' | 'openmetrics' | 'json'): string
}

// ============================================================================
// TEST SUITE: FUNCTION INVOCATION COUNTS
// ============================================================================

describe('Metrics Export - Function Invocation Counts', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should track total invocation count for a function', async () => {
    // Import the metrics collector (expected to fail - not implemented)
    const { MetricsCollector } = await import('../../core/metrics')

    const collector = new MetricsCollector(mockState, mockKV)

    // Record some invocations
    collector.recordInvocation('func-1', {
      language: 'typescript',
      duration: 100,
      success: true,
      coldStart: false,
    })
    collector.recordInvocation('func-1', {
      language: 'typescript',
      duration: 150,
      success: true,
      coldStart: false,
    })
    collector.recordInvocation('func-1', {
      language: 'typescript',
      duration: 200,
      success: false,
      coldStart: true,
      error: 'Test error',
    })

    const count = await collector.getInvocationCount('func-1')
    expect(count).toBe(3)
  })

  it('should track invocation counts separately for different functions', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-1', {
      language: 'typescript',
      duration: 100,
      success: true,
      coldStart: false,
    })
    collector.recordInvocation('func-2', {
      language: 'python',
      duration: 200,
      success: true,
      coldStart: false,
    })
    collector.recordInvocation('func-2', {
      language: 'python',
      duration: 250,
      success: true,
      coldStart: false,
    })

    expect(await collector.getInvocationCount('func-1')).toBe(1)
    expect(await collector.getInvocationCount('func-2')).toBe(2)
  })

  it('should return 0 for functions with no invocations', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    const count = await collector.getInvocationCount('non-existent-func')
    expect(count).toBe(0)
  })

  it('should track total invocations across all functions', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-1', {
      language: 'typescript',
      duration: 100,
      success: true,
      coldStart: false,
    })
    collector.recordInvocation('func-2', {
      language: 'python',
      duration: 200,
      success: true,
      coldStart: false,
    })
    collector.recordInvocation('func-3', {
      language: 'go',
      duration: 50,
      success: true,
      coldStart: true,
    })

    const total = await collector.getTotalInvocationCount()
    expect(total).toBe(3)
  })
})

// ============================================================================
// TEST SUITE: EXECUTION DURATION METRICS
// ============================================================================

describe('Metrics Export - Execution Duration Metrics (p50, p95, p99)', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should calculate p50 (median) duration correctly', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    // Record durations: 10, 20, 30, 40, 50, 60, 70, 80, 90, 100
    const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    for (const duration of durations) {
      collector.recordInvocation('func-1', {
        language: 'typescript',
        duration,
        success: true,
        coldStart: false,
      })
    }

    const metrics = await collector.getDurationMetrics('func-1')
    expect(metrics.p50).toBe(55) // median of 10 values
  })

  it('should calculate p95 duration correctly', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    // Record 100 durations from 1 to 100
    for (let i = 1; i <= 100; i++) {
      collector.recordInvocation('func-1', {
        language: 'typescript',
        duration: i,
        success: true,
        coldStart: false,
      })
    }

    const metrics = await collector.getDurationMetrics('func-1')
    expect(metrics.p95).toBe(95) // 95th percentile
  })

  it('should calculate p99 duration correctly', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    // Record 100 durations from 1 to 100
    for (let i = 1; i <= 100; i++) {
      collector.recordInvocation('func-1', {
        language: 'typescript',
        duration: i,
        success: true,
        coldStart: false,
      })
    }

    const metrics = await collector.getDurationMetrics('func-1')
    expect(metrics.p99).toBe(99) // 99th percentile
  })

  it('should track min, max, and average duration', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-1', { language: 'typescript', duration: 50, success: true, coldStart: false })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 150, success: true, coldStart: false })

    const metrics = await collector.getDurationMetrics('func-1')
    expect(metrics.min).toBe(50)
    expect(metrics.max).toBe(150)
    expect(metrics.avg).toBe(100) // (50 + 100 + 150) / 3
    expect(metrics.count).toBe(3)
  })

  it('should return zero metrics for functions with no data', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    const metrics = await collector.getDurationMetrics('non-existent')
    expect(metrics.p50).toBe(0)
    expect(metrics.p95).toBe(0)
    expect(metrics.p99).toBe(0)
    expect(metrics.min).toBe(0)
    expect(metrics.max).toBe(0)
    expect(metrics.avg).toBe(0)
    expect(metrics.count).toBe(0)
  })
})

// ============================================================================
// TEST SUITE: ERROR RATE METRICS
// ============================================================================

describe('Metrics Export - Error Rate Metrics', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should calculate error rate correctly', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    // 3 successes, 2 failures = 40% error rate
    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: false, coldStart: false, error: 'Error 1' })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: false, coldStart: false, error: 'Error 2' })

    const errorMetrics = await collector.getErrorRate('func-1')
    expect(errorMetrics.errorCount).toBe(2)
    expect(errorMetrics.totalCount).toBe(5)
    expect(errorMetrics.errorRate).toBeCloseTo(0.4, 2) // 40%
  })

  it('should return 0% error rate when all invocations succeed', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })

    const errorMetrics = await collector.getErrorRate('func-1')
    expect(errorMetrics.errorCount).toBe(0)
    expect(errorMetrics.errorRate).toBe(0)
  })

  it('should return 100% error rate when all invocations fail', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: false, coldStart: false, error: 'Error' })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: false, coldStart: false, error: 'Error' })

    const errorMetrics = await collector.getErrorRate('func-1')
    expect(errorMetrics.errorCount).toBe(2)
    expect(errorMetrics.errorRate).toBe(1) // 100%
  })

  it('should return 0 error rate for functions with no data', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    const errorMetrics = await collector.getErrorRate('non-existent')
    expect(errorMetrics.errorCount).toBe(0)
    expect(errorMetrics.totalCount).toBe(0)
    expect(errorMetrics.errorRate).toBe(0)
  })
})

// ============================================================================
// TEST SUITE: MEMORY USAGE METRICS
// ============================================================================

describe('Metrics Export - Memory Usage Metrics', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should track memory usage per function', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-1', {
      language: 'typescript',
      duration: 100,
      success: true,
      coldStart: false,
      memoryUsed: 1024 * 1024 * 10, // 10MB
    })
    collector.recordInvocation('func-1', {
      language: 'typescript',
      duration: 100,
      success: true,
      coldStart: false,
      memoryUsed: 1024 * 1024 * 20, // 20MB
    })
    collector.recordInvocation('func-1', {
      language: 'typescript',
      duration: 100,
      success: true,
      coldStart: false,
      memoryUsed: 1024 * 1024 * 30, // 30MB
    })

    const memMetrics = await collector.getMemoryMetrics('func-1')
    expect(memMetrics.avgMemoryBytes).toBe(1024 * 1024 * 20) // 20MB average
    expect(memMetrics.maxMemoryBytes).toBe(1024 * 1024 * 30) // 30MB max
    expect(memMetrics.minMemoryBytes).toBe(1024 * 1024 * 10) // 10MB min
    expect(memMetrics.count).toBe(3)
  })

  it('should handle invocations without memory data gracefully', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    // Some invocations with memory, some without
    collector.recordInvocation('func-1', {
      language: 'typescript',
      duration: 100,
      success: true,
      coldStart: false,
      memoryUsed: 1024 * 1024 * 10,
    })
    collector.recordInvocation('func-1', {
      language: 'typescript',
      duration: 100,
      success: true,
      coldStart: false,
      // No memoryUsed
    })

    const memMetrics = await collector.getMemoryMetrics('func-1')
    expect(memMetrics.count).toBe(1) // Only counts invocations with memory data
    expect(memMetrics.avgMemoryBytes).toBe(1024 * 1024 * 10)
  })

  it('should return zero memory metrics for functions with no data', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    const memMetrics = await collector.getMemoryMetrics('non-existent')
    expect(memMetrics.avgMemoryBytes).toBe(0)
    expect(memMetrics.maxMemoryBytes).toBe(0)
    expect(memMetrics.minMemoryBytes).toBe(0)
    expect(memMetrics.count).toBe(0)
  })
})

// ============================================================================
// TEST SUITE: COLD START VS WARM START METRICS
// ============================================================================

describe('Metrics Export - Cold Start vs Warm Start Metrics', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should track cold start count and rate', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    // 2 cold starts, 3 warm starts
    collector.recordInvocation('func-1', { language: 'typescript', duration: 500, success: true, coldStart: true })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 600, success: true, coldStart: true })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })

    const coldStartMetrics = await collector.getColdStartMetrics('func-1')
    expect(coldStartMetrics.coldStartCount).toBe(2)
    expect(coldStartMetrics.warmStartCount).toBe(3)
    expect(coldStartMetrics.coldStartRate).toBeCloseTo(0.4, 2) // 40%
  })

  it('should calculate average duration for cold starts and warm starts separately', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    // Cold starts: 400ms, 600ms (avg = 500ms)
    // Warm starts: 100ms, 100ms, 100ms (avg = 100ms)
    collector.recordInvocation('func-1', { language: 'typescript', duration: 400, success: true, coldStart: true })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 600, success: true, coldStart: true })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })

    const coldStartMetrics = await collector.getColdStartMetrics('func-1')
    expect(coldStartMetrics.avgColdStartDuration).toBe(500)
    expect(coldStartMetrics.avgWarmStartDuration).toBe(100)
  })

  it('should handle all cold starts correctly', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-1', { language: 'typescript', duration: 500, success: true, coldStart: true })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 600, success: true, coldStart: true })

    const coldStartMetrics = await collector.getColdStartMetrics('func-1')
    expect(coldStartMetrics.coldStartRate).toBe(1) // 100%
    expect(coldStartMetrics.warmStartCount).toBe(0)
    expect(coldStartMetrics.avgWarmStartDuration).toBe(0) // No warm starts
  })

  it('should handle all warm starts correctly', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 150, success: true, coldStart: false })

    const coldStartMetrics = await collector.getColdStartMetrics('func-1')
    expect(coldStartMetrics.coldStartRate).toBe(0) // 0%
    expect(coldStartMetrics.coldStartCount).toBe(0)
    expect(coldStartMetrics.avgColdStartDuration).toBe(0) // No cold starts
  })
})

// ============================================================================
// TEST SUITE: PROMETHEUS/OPENMETRICS EXPORT FORMAT
// ============================================================================

describe('Metrics Export - Prometheus/OpenMetrics Format', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should export metrics in Prometheus format', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 200, success: false, coldStart: true, error: 'Error' })

    const prometheus = await collector.exportPrometheus()

    // Should contain HELP and TYPE declarations
    expect(prometheus).toContain('# HELP functions_invocations_total')
    expect(prometheus).toContain('# TYPE functions_invocations_total counter')

    // Should contain metric values with labels
    expect(prometheus).toContain('functions_invocations_total{function_id="func-1"')
    expect(prometheus).toContain('functions_errors_total{function_id="func-1"')
    expect(prometheus).toContain('functions_duration_seconds_bucket')
  })

  it('should export metrics in OpenMetrics format', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })

    const openmetrics = await collector.exportOpenMetrics()

    // OpenMetrics format should end with # EOF
    expect(openmetrics).toContain('# EOF')

    // Should use proper OpenMetrics type declarations
    expect(openmetrics).toContain('# TYPE functions_invocations counter')
  })

  it('should include histogram buckets for duration', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    // Record various durations to populate buckets
    collector.recordInvocation('func-1', { language: 'typescript', duration: 10, success: true, coldStart: false })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 50, success: true, coldStart: false })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 500, success: true, coldStart: false })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 1000, success: true, coldStart: false })

    const prometheus = await collector.exportPrometheus()

    // Should have histogram buckets (in seconds)
    expect(prometheus).toContain('functions_duration_seconds_bucket{function_id="func-1",le="0.01"')
    expect(prometheus).toContain('functions_duration_seconds_bucket{function_id="func-1",le="0.05"')
    expect(prometheus).toContain('functions_duration_seconds_bucket{function_id="func-1",le="0.1"')
    expect(prometheus).toContain('functions_duration_seconds_bucket{function_id="func-1",le="0.5"')
    expect(prometheus).toContain('functions_duration_seconds_bucket{function_id="func-1",le="1"')
    expect(prometheus).toContain('functions_duration_seconds_bucket{function_id="func-1",le="+Inf"')

    // Should have histogram sum and count
    expect(prometheus).toContain('functions_duration_seconds_sum{function_id="func-1"')
    expect(prometheus).toContain('functions_duration_seconds_count{function_id="func-1"')
  })

  it('should include cold start metrics in export', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-1', { language: 'typescript', duration: 500, success: true, coldStart: true })
    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })

    const prometheus = await collector.exportPrometheus()

    expect(prometheus).toContain('functions_cold_starts_total{function_id="func-1"')
    expect(prometheus).toContain('functions_warm_starts_total{function_id="func-1"')
  })

  it('should include memory metrics in export', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-1', {
      language: 'typescript',
      duration: 100,
      success: true,
      coldStart: false,
      memoryUsed: 1024 * 1024 * 50, // 50MB
    })

    const prometheus = await collector.exportPrometheus()

    expect(prometheus).toContain('functions_memory_bytes{function_id="func-1"')
  })

  it('should escape special characters in labels', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    // Function ID with special characters
    collector.recordInvocation('func-with"quotes\\and\nnewline', {
      language: 'typescript',
      duration: 100,
      success: true,
      coldStart: false,
    })

    const prometheus = await collector.exportPrometheus()

    // Should properly escape quotes, backslashes, and newlines
    expect(prometheus).not.toContain('"quotes"')
    expect(prometheus).toContain('func-with')
  })
})

// ============================================================================
// TEST SUITE: PER-LANGUAGE BREAKDOWN METRICS
// ============================================================================

describe('Metrics Export - Per-Language Breakdown', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should track metrics per language', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    // TypeScript invocations
    collector.recordInvocation('func-ts-1', { language: 'typescript', duration: 100, success: true, coldStart: false })
    collector.recordInvocation('func-ts-2', { language: 'typescript', duration: 150, success: true, coldStart: false })
    collector.recordInvocation('func-ts-3', { language: 'typescript', duration: 200, success: false, coldStart: false, error: 'Error' })

    // Python invocations
    collector.recordInvocation('func-py-1', { language: 'python', duration: 300, success: true, coldStart: true })
    collector.recordInvocation('func-py-2', { language: 'python', duration: 350, success: true, coldStart: false })

    // Go invocations
    collector.recordInvocation('func-go-1', { language: 'go', duration: 50, success: true, coldStart: false })

    const breakdown = await collector.getLanguageBreakdown()

    expect(breakdown['typescript'].invocationCount).toBe(3)
    expect(breakdown['typescript'].avgDuration).toBeCloseTo(150, 1) // (100+150+200)/3
    expect(breakdown['typescript'].errorRate).toBeCloseTo(0.333, 2) // 1/3

    expect(breakdown['python'].invocationCount).toBe(2)
    expect(breakdown['python'].avgDuration).toBe(325) // (300+350)/2
    expect(breakdown['python'].errorRate).toBe(0)

    expect(breakdown['go'].invocationCount).toBe(1)
    expect(breakdown['go'].avgDuration).toBe(50)
    expect(breakdown['go'].errorRate).toBe(0)
  })

  it('should include language labels in Prometheus export', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })
    collector.recordInvocation('func-2', { language: 'python', duration: 200, success: true, coldStart: false })

    const prometheus = await collector.exportPrometheus()

    expect(prometheus).toContain('language="typescript"')
    expect(prometheus).toContain('language="python"')
  })

  it('should handle unknown or custom languages', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-1', { language: 'custom-lang', duration: 100, success: true, coldStart: false })

    const breakdown = await collector.getLanguageBreakdown()

    expect(breakdown['custom-lang']).toBeDefined()
    expect(breakdown['custom-lang'].invocationCount).toBe(1)
  })
})

// ============================================================================
// TEST SUITE: RATE LIMITING METRICS
// ============================================================================

describe('Metrics Export - Rate Limiting Metrics', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should track rate limit hits', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordRateLimitHit('func-1', '192.168.1.1')
    collector.recordRateLimitHit('func-1', '192.168.1.1')
    collector.recordRateLimitHit('func-1', '192.168.1.2')
    collector.recordRateLimitHit('func-1', '10.0.0.1')

    const rateLimitMetrics = await collector.getRateLimitMetrics('func-1')

    expect(rateLimitMetrics.totalHits).toBe(4)
    expect(rateLimitMetrics.uniqueIps).toBe(3)
    expect(rateLimitMetrics.hitsByIp['192.168.1.1']).toBe(2)
    expect(rateLimitMetrics.hitsByIp['192.168.1.2']).toBe(1)
    expect(rateLimitMetrics.hitsByIp['10.0.0.1']).toBe(1)
  })

  it('should track rate limit hits per function', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordRateLimitHit('func-1', '192.168.1.1')
    collector.recordRateLimitHit('func-1', '192.168.1.1')
    collector.recordRateLimitHit('func-2', '192.168.1.1')

    const func1Metrics = await collector.getRateLimitMetrics('func-1')
    const func2Metrics = await collector.getRateLimitMetrics('func-2')

    expect(func1Metrics.totalHits).toBe(2)
    expect(func2Metrics.totalHits).toBe(1)
  })

  it('should include rate limit metrics in Prometheus export', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordRateLimitHit('func-1', '192.168.1.1')

    const prometheus = await collector.exportPrometheus()

    expect(prometheus).toContain('# HELP functions_rate_limit_hits_total')
    expect(prometheus).toContain('# TYPE functions_rate_limit_hits_total counter')
    expect(prometheus).toContain('functions_rate_limit_hits_total{function_id="func-1"')
  })

  it('should return empty metrics for functions with no rate limit hits', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    const rateLimitMetrics = await collector.getRateLimitMetrics('non-existent')

    expect(rateLimitMetrics.totalHits).toBe(0)
    expect(rateLimitMetrics.uniqueIps).toBe(0)
    expect(Object.keys(rateLimitMetrics.hitsByIp)).toHaveLength(0)
  })
})

// ============================================================================
// TEST SUITE: METRICS EXPORTER
// ============================================================================

describe('Metrics Export - MetricsExporter', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should export metrics in JSON format', async () => {
    const { MetricsCollector, MetricsExporter } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)
    const exporter = new MetricsExporter(collector)

    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })

    const json = await exporter.export('json')
    const parsed = JSON.parse(json)

    expect(parsed.functions).toBeDefined()
    expect(parsed.functions['func-1']).toBeDefined()
    expect(parsed.functions['func-1'].invocationCount).toBe(1)
  })

  it('should return correct content type for each format', async () => {
    const { MetricsCollector, MetricsExporter } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)
    const exporter = new MetricsExporter(collector)

    expect(exporter.getContentType('prometheus')).toBe('text/plain; version=0.0.4; charset=utf-8')
    expect(exporter.getContentType('openmetrics')).toBe('application/openmetrics-text; version=1.0.0; charset=utf-8')
    expect(exporter.getContentType('json')).toBe('application/json')
  })

  it('should handle export with no data gracefully', async () => {
    const { MetricsCollector, MetricsExporter } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)
    const exporter = new MetricsExporter(collector)

    const prometheus = await exporter.export('prometheus')
    expect(prometheus).toBeDefined()
    expect(typeof prometheus).toBe('string')

    const json = await exporter.export('json')
    const parsed = JSON.parse(json)
    expect(parsed.functions).toBeDefined()
  })
})

// ============================================================================
// TEST SUITE: METRICS RESET
// ============================================================================

describe('Metrics Export - Reset Functionality', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should reset all metrics', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-1', { language: 'typescript', duration: 100, success: true, coldStart: false })
    collector.recordInvocation('func-2', { language: 'python', duration: 200, success: true, coldStart: false })
    collector.recordRateLimitHit('func-1', '192.168.1.1')

    // Verify data exists
    expect(await collector.getTotalInvocationCount()).toBe(2)

    // Reset
    collector.reset()

    // Verify data is cleared
    expect(await collector.getTotalInvocationCount()).toBe(0)
    expect(await collector.getInvocationCount('func-1')).toBe(0)
    expect(await collector.getInvocationCount('func-2')).toBe(0)
    const rateLimitMetrics = await collector.getRateLimitMetrics('func-1')
    expect(rateLimitMetrics.totalHits).toBe(0)
  })
})

// ============================================================================
// TEST SUITE: CONCURRENT ACCESS
// ============================================================================

describe('Metrics Export - Concurrent Access', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should handle concurrent invocation recordings', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    // Simulate concurrent recordings
    const promises = []
    for (let i = 0; i < 100; i++) {
      promises.push(
        Promise.resolve().then(() => {
          collector.recordInvocation('func-1', {
            language: 'typescript',
            duration: Math.random() * 1000,
            success: Math.random() > 0.1,
            coldStart: Math.random() > 0.8,
          })
        })
      )
    }

    await Promise.all(promises)

    const count = await collector.getInvocationCount('func-1')
    expect(count).toBe(100)
  })
})

// ============================================================================
// TEST SUITE: EDGE CASES
// ============================================================================

describe('Metrics Export - Edge Cases', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should handle very large duration values', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-1', {
      language: 'typescript',
      duration: Number.MAX_SAFE_INTEGER,
      success: true,
      coldStart: false,
    })

    const metrics = await collector.getDurationMetrics('func-1')
    expect(metrics.max).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('should handle zero duration', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-1', {
      language: 'typescript',
      duration: 0,
      success: true,
      coldStart: false,
    })

    const metrics = await collector.getDurationMetrics('func-1')
    expect(metrics.min).toBe(0)
    expect(metrics.avg).toBe(0)
  })

  it('should handle empty function ID', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('', {
      language: 'typescript',
      duration: 100,
      success: true,
      coldStart: false,
    })

    const count = await collector.getInvocationCount('')
    expect(count).toBe(1)
  })

  it('should handle special characters in function ID for Prometheus export', async () => {
    const { MetricsCollector } = await import('../../core/metrics')
    const collector = new MetricsCollector(mockState, mockKV)

    collector.recordInvocation('func-with-special!@#$%^&*()chars', {
      language: 'typescript',
      duration: 100,
      success: true,
      coldStart: false,
    })

    const prometheus = await collector.exportPrometheus()
    // Should not throw and should produce valid output
    expect(prometheus).toBeDefined()
    expect(typeof prometheus).toBe('string')
  })
})
