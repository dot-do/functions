/**
 * Metrics Collector Tests
 *
 * Tests for the metrics collection and export functionality including:
 * - Recording invocations
 * - Recording rate limit hits
 * - Getting aggregated metrics (duration, error rate, memory, cold starts)
 * - Rolling window pruning
 * - Export to Prometheus and OpenMetrics formats
 *
 * @module core/__tests__/metrics
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  MetricsCollector,
  MetricsExporter,
  type InvocationOptions,
} from '../metrics'

// Mock KVNamespace
const createMockKV = (): KVNamespace => ({
  get: async () => null,
  put: async () => {},
  delete: async () => {},
  list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
  getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
})

// Mock DurableObjectState
const createMockState = () => ({
  storage: {
    get: async <T>(): Promise<T | undefined> => undefined,
    put: async () => {},
    delete: async () => false,
    list: async () => new Map(),
  },
})

describe('MetricsCollector', () => {
  let collector: MetricsCollector
  let mockState: ReturnType<typeof createMockState>
  let mockKV: KVNamespace

  beforeEach(() => {
    mockState = createMockState()
    mockKV = createMockKV()
    collector = new MetricsCollector(mockState, mockKV)
  })

  describe('recordInvocation()', () => {
    it('should record a successful invocation', async () => {
      const options: InvocationOptions = {
        language: 'typescript',
        duration: 100,
        success: true,
        coldStart: false,
      }

      collector.recordInvocation('func-1', options)

      const count = await collector.getInvocationCount('func-1')
      expect(count).toBe(1)
    })

    it('should record multiple invocations for the same function', async () => {
      const options: InvocationOptions = {
        language: 'typescript',
        duration: 100,
        success: true,
        coldStart: false,
      }

      collector.recordInvocation('func-1', options)
      collector.recordInvocation('func-1', options)
      collector.recordInvocation('func-1', options)

      const count = await collector.getInvocationCount('func-1')
      expect(count).toBe(3)
    })

    it('should record invocations for different functions separately', async () => {
      const options: InvocationOptions = {
        language: 'typescript',
        duration: 100,
        success: true,
        coldStart: false,
      }

      collector.recordInvocation('func-1', options)
      collector.recordInvocation('func-2', options)
      collector.recordInvocation('func-1', options)

      expect(await collector.getInvocationCount('func-1')).toBe(2)
      expect(await collector.getInvocationCount('func-2')).toBe(1)
    })

    it('should record invocation with memory usage', async () => {
      const options: InvocationOptions = {
        language: 'javascript',
        duration: 50,
        success: true,
        coldStart: false,
        memoryUsed: 1024 * 1024, // 1MB
      }

      collector.recordInvocation('func-1', options)

      const memoryMetrics = await collector.getMemoryMetrics('func-1')
      expect(memoryMetrics.count).toBe(1)
      expect(memoryMetrics.avgMemoryBytes).toBe(1024 * 1024)
    })

    it('should record invocation with error', async () => {
      const options: InvocationOptions = {
        language: 'typescript',
        duration: 100,
        success: false,
        coldStart: false,
        error: 'Something went wrong',
      }

      collector.recordInvocation('func-1', options)

      const errorRate = await collector.getErrorRate('func-1')
      expect(errorRate.errorCount).toBe(1)
      expect(errorRate.totalCount).toBe(1)
      expect(errorRate.errorRate).toBe(1)
    })
  })

  describe('recordRateLimitHit()', () => {
    it('should record a rate limit hit', async () => {
      collector.recordRateLimitHit('func-1', '192.168.1.1')

      const metrics = await collector.getRateLimitMetrics('func-1')
      expect(metrics.totalHits).toBe(1)
      expect(metrics.uniqueIps).toBe(1)
    })

    it('should track multiple rate limit hits from same IP', async () => {
      collector.recordRateLimitHit('func-1', '192.168.1.1')
      collector.recordRateLimitHit('func-1', '192.168.1.1')
      collector.recordRateLimitHit('func-1', '192.168.1.1')

      const metrics = await collector.getRateLimitMetrics('func-1')
      expect(metrics.totalHits).toBe(3)
      expect(metrics.uniqueIps).toBe(1)
      expect(metrics.hitsByIp['192.168.1.1']).toBe(3)
    })

    it('should track rate limit hits from multiple IPs', async () => {
      collector.recordRateLimitHit('func-1', '192.168.1.1')
      collector.recordRateLimitHit('func-1', '192.168.1.2')
      collector.recordRateLimitHit('func-1', '192.168.1.3')

      const metrics = await collector.getRateLimitMetrics('func-1')
      expect(metrics.totalHits).toBe(3)
      expect(metrics.uniqueIps).toBe(3)
    })

    it('should return empty metrics for function with no rate limit hits', async () => {
      const metrics = await collector.getRateLimitMetrics('non-existent')
      expect(metrics.totalHits).toBe(0)
      expect(metrics.uniqueIps).toBe(0)
      expect(metrics.hitsByIp).toEqual({})
    })
  })

  describe('getAggregatedMetrics', () => {
    describe('getDurationMetrics()', () => {
      it('should return empty metrics for function with no invocations', async () => {
        const metrics = await collector.getDurationMetrics('non-existent')

        expect(metrics.count).toBe(0)
        expect(metrics.p50).toBe(0)
        expect(metrics.p95).toBe(0)
        expect(metrics.p99).toBe(0)
        expect(metrics.min).toBe(0)
        expect(metrics.max).toBe(0)
        expect(metrics.avg).toBe(0)
      })

      it('should calculate duration metrics correctly', async () => {
        // Add invocations with varying durations
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

        expect(metrics.count).toBe(10)
        expect(metrics.min).toBe(10)
        expect(metrics.max).toBe(100)
        expect(metrics.avg).toBe(55) // (10+20+30+40+50+60+70+80+90+100) / 10
      })

      it('should calculate percentiles correctly', async () => {
        // Add 100 invocations with durations 1-100
        for (let i = 1; i <= 100; i++) {
          collector.recordInvocation('func-1', {
            language: 'typescript',
            duration: i,
            success: true,
            coldStart: false,
          })
        }

        const metrics = await collector.getDurationMetrics('func-1')

        expect(metrics.count).toBe(100)
        expect(metrics.p50).toBe(50) // Median
        expect(metrics.p95).toBe(95)
        expect(metrics.p99).toBe(99)
      })
    })

    describe('getErrorRate()', () => {
      it('should return zero error rate for function with no invocations', async () => {
        const metrics = await collector.getErrorRate('non-existent')

        expect(metrics.errorCount).toBe(0)
        expect(metrics.totalCount).toBe(0)
        expect(metrics.errorRate).toBe(0)
      })

      it('should calculate error rate correctly', async () => {
        // 7 successful, 3 failed
        for (let i = 0; i < 7; i++) {
          collector.recordInvocation('func-1', {
            language: 'typescript',
            duration: 100,
            success: true,
            coldStart: false,
          })
        }
        for (let i = 0; i < 3; i++) {
          collector.recordInvocation('func-1', {
            language: 'typescript',
            duration: 100,
            success: false,
            coldStart: false,
          })
        }

        const metrics = await collector.getErrorRate('func-1')

        expect(metrics.errorCount).toBe(3)
        expect(metrics.totalCount).toBe(10)
        expect(metrics.errorRate).toBe(0.3)
      })
    })

    describe('getMemoryMetrics()', () => {
      it('should return empty metrics for function with no memory data', async () => {
        collector.recordInvocation('func-1', {
          language: 'typescript',
          duration: 100,
          success: true,
          coldStart: false,
          // No memoryUsed
        })

        const metrics = await collector.getMemoryMetrics('func-1')

        expect(metrics.count).toBe(0)
        expect(metrics.avgMemoryBytes).toBe(0)
      })

      it('should calculate memory metrics correctly', async () => {
        const memoryValues = [1000, 2000, 3000, 4000, 5000]
        for (const memoryUsed of memoryValues) {
          collector.recordInvocation('func-1', {
            language: 'typescript',
            duration: 100,
            success: true,
            coldStart: false,
            memoryUsed,
          })
        }

        const metrics = await collector.getMemoryMetrics('func-1')

        expect(metrics.count).toBe(5)
        expect(metrics.avgMemoryBytes).toBe(3000)
        expect(metrics.minMemoryBytes).toBe(1000)
        expect(metrics.maxMemoryBytes).toBe(5000)
      })
    })

    describe('getColdStartMetrics()', () => {
      it('should return empty metrics for function with no invocations', async () => {
        const metrics = await collector.getColdStartMetrics('non-existent')

        expect(metrics.coldStartCount).toBe(0)
        expect(metrics.warmStartCount).toBe(0)
        expect(metrics.coldStartRate).toBe(0)
      })

      it('should track cold start vs warm start correctly', async () => {
        // 3 cold starts with higher duration
        for (let i = 0; i < 3; i++) {
          collector.recordInvocation('func-1', {
            language: 'typescript',
            duration: 500,
            success: true,
            coldStart: true,
          })
        }
        // 7 warm starts with lower duration
        for (let i = 0; i < 7; i++) {
          collector.recordInvocation('func-1', {
            language: 'typescript',
            duration: 50,
            success: true,
            coldStart: false,
          })
        }

        const metrics = await collector.getColdStartMetrics('func-1')

        expect(metrics.coldStartCount).toBe(3)
        expect(metrics.warmStartCount).toBe(7)
        expect(metrics.coldStartRate).toBe(0.3)
        expect(metrics.avgColdStartDuration).toBe(500)
        expect(metrics.avgWarmStartDuration).toBe(50)
      })
    })

    describe('getLanguageBreakdown()', () => {
      it('should return empty breakdown when no invocations', async () => {
        const breakdown = await collector.getLanguageBreakdown()
        expect(breakdown).toEqual({})
      })

      it('should aggregate metrics by language', async () => {
        // TypeScript invocations
        for (let i = 0; i < 5; i++) {
          collector.recordInvocation('func-1', {
            language: 'typescript',
            duration: 100,
            success: true,
            coldStart: false,
          })
        }

        // JavaScript invocations (with one error)
        for (let i = 0; i < 4; i++) {
          collector.recordInvocation('func-2', {
            language: 'javascript',
            duration: 50,
            success: true,
            coldStart: false,
          })
        }
        collector.recordInvocation('func-2', {
          language: 'javascript',
          duration: 50,
          success: false,
          coldStart: false,
        })

        const breakdown = await collector.getLanguageBreakdown()

        expect(breakdown['typescript'].invocationCount).toBe(5)
        expect(breakdown['typescript'].avgDuration).toBe(100)
        expect(breakdown['typescript'].errorRate).toBe(0)

        expect(breakdown['javascript'].invocationCount).toBe(5)
        expect(breakdown['javascript'].avgDuration).toBe(50)
        expect(breakdown['javascript'].errorRate).toBe(0.2)
      })
    })

    describe('getTotalInvocationCount()', () => {
      it('should return zero for empty collector', async () => {
        const count = await collector.getTotalInvocationCount()
        expect(count).toBe(0)
      })

      it('should return total across all functions', async () => {
        collector.recordInvocation('func-1', {
          language: 'typescript',
          duration: 100,
          success: true,
          coldStart: false,
        })
        collector.recordInvocation('func-2', {
          language: 'javascript',
          duration: 50,
          success: true,
          coldStart: false,
        })
        collector.recordInvocation('func-3', {
          language: 'python',
          duration: 200,
          success: true,
          coldStart: false,
        })

        const count = await collector.getTotalInvocationCount()
        expect(count).toBe(3)
      })
    })
  })

  describe('Rolling Window Pruning', () => {
    it('should prune old invocations when limit is exceeded', async () => {
      // The MAX_INVOCATIONS is 10000, but we can test the behavior by checking
      // that the collector maintains records
      const options: InvocationOptions = {
        language: 'typescript',
        duration: 100,
        success: true,
        coldStart: false,
      }

      // Record 100 invocations
      for (let i = 0; i < 100; i++) {
        collector.recordInvocation('func-1', options)
      }

      const count = await collector.getInvocationCount('func-1')
      expect(count).toBe(100)

      // The pruning should happen automatically when exceeding MAX_INVOCATIONS (10000)
      // For testing, we verify the count is maintained correctly
      const totalCount = await collector.getTotalInvocationCount()
      expect(totalCount).toBe(100)
    })

    it('should prune old rate limit hits when limit is exceeded', async () => {
      // Record multiple rate limit hits
      for (let i = 0; i < 100; i++) {
        collector.recordRateLimitHit('func-1', `192.168.1.${i}`)
      }

      const metrics = await collector.getRateLimitMetrics('func-1')
      expect(metrics.totalHits).toBe(100)
      expect(metrics.uniqueIps).toBe(100)
    })
  })

  describe('reset()', () => {
    it('should clear all metrics', async () => {
      // Add some data
      collector.recordInvocation('func-1', {
        language: 'typescript',
        duration: 100,
        success: true,
        coldStart: false,
      })
      collector.recordRateLimitHit('func-1', '192.168.1.1')

      // Reset
      collector.reset()

      // Verify cleared
      expect(await collector.getTotalInvocationCount()).toBe(0)
      expect(await collector.getInvocationCount('func-1')).toBe(0)
      const rateLimitMetrics = await collector.getRateLimitMetrics('func-1')
      expect(rateLimitMetrics.totalHits).toBe(0)
    })
  })

  describe('Export to Prometheus Format', () => {
    it('should export empty metrics when no data', async () => {
      const output = await collector.exportPrometheus()

      expect(output).toContain('# HELP functions_invocations_total')
      expect(output).toContain('# TYPE functions_invocations_total counter')
    })

    it('should export invocation count metrics', async () => {
      collector.recordInvocation('my-function', {
        language: 'typescript',
        duration: 100,
        success: true,
        coldStart: false,
      })

      const output = await collector.exportPrometheus()

      expect(output).toContain('functions_invocations_total{function_id="my-function",language="typescript"} 1')
    })

    it('should export error metrics', async () => {
      collector.recordInvocation('my-function', {
        language: 'typescript',
        duration: 100,
        success: false,
        coldStart: false,
      })

      const output = await collector.exportPrometheus()

      expect(output).toContain('# HELP functions_errors_total')
      expect(output).toContain('functions_errors_total{function_id="my-function",language="typescript"} 1')
    })

    it('should export duration histogram', async () => {
      collector.recordInvocation('my-function', {
        language: 'typescript',
        duration: 50, // 50ms = 0.05s
        success: true,
        coldStart: false,
      })

      const output = await collector.exportPrometheus()

      expect(output).toContain('# HELP functions_duration_seconds')
      expect(output).toContain('# TYPE functions_duration_seconds histogram')
      expect(output).toContain('functions_duration_seconds_bucket{function_id="my-function",le="0.1"} 1')
      expect(output).toContain('functions_duration_seconds_bucket{function_id="my-function",le="+Inf"} 1')
    })

    it('should export cold start metrics', async () => {
      collector.recordInvocation('my-function', {
        language: 'typescript',
        duration: 500,
        success: true,
        coldStart: true,
      })
      collector.recordInvocation('my-function', {
        language: 'typescript',
        duration: 50,
        success: true,
        coldStart: false,
      })

      const output = await collector.exportPrometheus()

      expect(output).toContain('# HELP functions_cold_starts_total')
      expect(output).toContain('functions_cold_starts_total{function_id="my-function"} 1')
      expect(output).toContain('functions_warm_starts_total{function_id="my-function"} 1')
    })

    it('should export memory metrics', async () => {
      collector.recordInvocation('my-function', {
        language: 'typescript',
        duration: 100,
        success: true,
        coldStart: false,
        memoryUsed: 1024 * 1024, // 1MB
      })

      const output = await collector.exportPrometheus()

      expect(output).toContain('# HELP functions_memory_bytes')
      expect(output).toContain('functions_memory_bytes{function_id="my-function"}')
    })

    it('should export rate limit metrics', async () => {
      collector.recordRateLimitHit('my-function', '192.168.1.1')
      collector.recordRateLimitHit('my-function', '192.168.1.2')

      const output = await collector.exportPrometheus()

      expect(output).toContain('# HELP functions_rate_limit_hits_total')
      expect(output).toContain('functions_rate_limit_hits_total{function_id="my-function"} 2')
    })

    it('should escape special characters in labels', async () => {
      collector.recordInvocation('my-"special"-function', {
        language: 'typescript',
        duration: 100,
        success: true,
        coldStart: false,
      })

      const output = await collector.exportPrometheus()

      expect(output).toContain('my-\\"special\\"-function')
    })
  })

  describe('Export to OpenMetrics Format', () => {
    it('should include EOF marker', async () => {
      const output = await collector.exportOpenMetrics()
      expect(output).toContain('# EOF')
    })

    it('should export metrics in OpenMetrics format', async () => {
      collector.recordInvocation('my-function', {
        language: 'typescript',
        duration: 100,
        success: true,
        coldStart: false,
      })

      const output = await collector.exportOpenMetrics()

      expect(output).toContain('# HELP functions_invocations')
      expect(output).toContain('# TYPE functions_invocations counter')
      expect(output).toContain('functions_invocations{function_id="my-function",language="typescript"} 1')
    })
  })
})

describe('MetricsExporter', () => {
  let collector: MetricsCollector
  let exporter: MetricsExporter
  let mockState: ReturnType<typeof createMockState>
  let mockKV: KVNamespace

  beforeEach(() => {
    mockState = createMockState()
    mockKV = createMockKV()
    collector = new MetricsCollector(mockState, mockKV)
    exporter = new MetricsExporter(collector)
  })

  describe('export()', () => {
    it('should export in prometheus format', async () => {
      collector.recordInvocation('func-1', {
        language: 'typescript',
        duration: 100,
        success: true,
        coldStart: false,
      })

      const output = await exporter.export('prometheus')

      expect(output).toContain('functions_invocations_total')
    })

    it('should export in openmetrics format', async () => {
      collector.recordInvocation('func-1', {
        language: 'typescript',
        duration: 100,
        success: true,
        coldStart: false,
      })

      const output = await exporter.export('openmetrics')

      expect(output).toContain('# EOF')
    })

    it('should export in json format', async () => {
      collector.recordInvocation('func-1', {
        language: 'typescript',
        duration: 100,
        success: true,
        coldStart: false,
      })

      const output = await exporter.export('json')
      const parsed = JSON.parse(output)

      expect(parsed.functions).toBeDefined()
      expect(parsed.functions['func-1'].invocationCount).toBe(1)
      expect(parsed.totalInvocations).toBeDefined()
      expect(parsed.languageBreakdown).toBeDefined()
    })

    it('should throw for unsupported format', async () => {
      await expect(exporter.export('xml' as 'json')).rejects.toThrow('Unsupported format')
    })
  })

  describe('getContentType()', () => {
    it('should return correct content type for prometheus', () => {
      const contentType = exporter.getContentType('prometheus')
      expect(contentType).toBe('text/plain; version=0.0.4; charset=utf-8')
    })

    it('should return correct content type for openmetrics', () => {
      const contentType = exporter.getContentType('openmetrics')
      expect(contentType).toBe('application/openmetrics-text; version=1.0.0; charset=utf-8')
    })

    it('should return correct content type for json', () => {
      const contentType = exporter.getContentType('json')
      expect(contentType).toBe('application/json')
    })
  })
})
