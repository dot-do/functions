/**
 * Log Aggregation Tests (RED Phase - TDD)
 *
 * Comprehensive tests for log aggregation functionality including:
 * 1. Function execution logs capture
 * 2. Structured JSON log format
 * 3. Log levels (debug, info, warn, error)
 * 4. Log filtering by function ID
 * 5. Log filtering by time range
 * 6. Log pagination for large result sets
 * 7. Real-time log streaming API
 * 8. Log retention policies
 * 9. Log search/query capabilities
 *
 * These tests are designed to FAIL initially as the implementation
 * doesn't exist yet (RED phase of TDD).
 *
 * References the existing FunctionLogs Durable Object in src/do/function-logs.ts
 *
 * @module __tests__/observability/logs
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
      name: 'mock-logs-do',
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
  }
}

/**
 * Creates a mock WebSocket for testing real-time streaming
 */
class MockWebSocket {
  public messages: string[] = []
  public closed = false
  public accepted = false
  public readyState = 1 // OPEN

  accept(): void {
    this.accepted = true
  }

  send(data: string): void {
    if (!this.closed) {
      this.messages.push(data)
    }
  }

  close(): void {
    this.closed = true
    this.readyState = 3 // CLOSED
  }

  addEventListener(_event: string, _handler: (event: unknown) => void): void {
    // Mock implementation
  }

  removeEventListener(_event: string, _handler: (event: unknown) => void): void {
    // Mock implementation
  }
}

// ============================================================================
// TYPE DEFINITIONS FOR EXPECTED LOG AGGREGATION API
// ============================================================================

/**
 * Log severity levels
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/**
 * Expected interface for LogEntry
 */
interface ExpectedLogEntry {
  id: string
  functionId: string
  timestamp: number
  level: LogLevel
  message: string
  metadata?: Record<string, unknown>
  requestId?: string
  durationMs?: number
}

/**
 * Expected interface for LogQuery
 */
interface ExpectedLogQuery {
  functionId: string
  startTime?: number
  endTime?: number
  level?: LogLevel
  levels?: LogLevel[]
  minLevel?: LogLevel
  limit?: number
  cursor?: string
  order?: 'asc' | 'desc'
}

/**
 * Expected interface for LogQueryResult
 */
interface ExpectedLogQueryResult {
  entries: ExpectedLogEntry[]
  cursor: string | null
  hasMore: boolean
  total?: number
}

/**
 * Expected interface for RetentionPolicy
 */
interface ExpectedRetentionPolicy {
  maxAge?: number
  maxCount?: number
  perFunction?: boolean
  interval?: number
}

/**
 * Expected interface for SearchQuery
 */
interface ExpectedSearchQuery {
  query: string
  functionId?: string
  limit?: number
}

/**
 * Expected interface for StreamOptions
 */
interface ExpectedStreamOptions {
  functionId: string
  levels?: LogLevel[]
  heartbeat?: number
  tail?: number
}

// ============================================================================
// TEST SUITE 1: FUNCTION EXECUTION LOGS CAPTURE
// ============================================================================

describe('Log Aggregation - Function Execution Logs Capture', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should capture log entry when function executes', async () => {
    // Import the log aggregator (expected to fail - not implemented)
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const logEntry = await aggregator.captureLog({
      functionId: 'my-function',
      level: 'info',
      message: 'Function executed successfully',
      requestId: 'req-123',
    })

    expect(logEntry).toBeDefined()
    expect(logEntry.id).toBeDefined()
    expect(logEntry.functionId).toBe('my-function')
    expect(logEntry.level).toBe('info')
    expect(logEntry.message).toBe('Function executed successfully')
    expect(logEntry.timestamp).toBeDefined()
  })

  it('should capture console.log output from function execution', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Simulate capturing console output during function execution
    const logs = await aggregator.captureExecutionLogs('my-function', 'req-456', async () => {
      console.log('Starting execution')
      console.info('Processing data')
      console.warn('Performance warning')
      console.error('Non-fatal error occurred')
      return { result: 'success' }
    })

    expect(logs.length).toBe(4)
    expect(logs[0].message).toContain('Starting execution')
    expect(logs[1].level).toBe('info')
    expect(logs[2].level).toBe('warn')
    expect(logs[3].level).toBe('error')
  })

  it('should capture execution duration with log entry', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const logEntry = await aggregator.captureLog({
      functionId: 'my-function',
      level: 'info',
      message: 'Execution complete',
      requestId: 'req-789',
      durationMs: 250,
    })

    expect(logEntry.durationMs).toBe(250)
  })

  it('should capture error stack traces when function throws', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const error = new Error('Test error message')
    const logEntry = await aggregator.captureError('my-function', 'req-error', error)

    expect(logEntry.level).toBe('error')
    expect(logEntry.message).toContain('Test error message')
    expect(logEntry.metadata?.stack).toBeDefined()
    expect(logEntry.metadata?.errorName).toBe('Error')
  })

  it('should capture logs with correlation ID across multiple operations', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const requestId = 'req-correlation'

    await aggregator.captureLog({
      functionId: 'api-gateway',
      level: 'info',
      message: 'Request received',
      requestId,
    })

    await aggregator.captureLog({
      functionId: 'auth-service',
      level: 'info',
      message: 'User authenticated',
      requestId,
    })

    await aggregator.captureLog({
      functionId: 'data-service',
      level: 'info',
      message: 'Data fetched',
      requestId,
    })

    const correlatedLogs = await aggregator.getLogsByRequestId(requestId)

    expect(correlatedLogs.length).toBe(3)
    expect(correlatedLogs.every((log) => log.requestId === requestId)).toBe(true)
  })

  it('should capture batch logs in a single operation', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const entries = await aggregator.captureBatch([
      { functionId: 'func-1', level: 'info', message: 'Log 1' },
      { functionId: 'func-1', level: 'warn', message: 'Log 2' },
      { functionId: 'func-1', level: 'error', message: 'Log 3' },
    ])

    expect(entries).toHaveLength(3)
    expect(entries[0].message).toBe('Log 1')
    expect(entries[1].message).toBe('Log 2')
    expect(entries[2].message).toBe('Log 3')
  })
})

// ============================================================================
// TEST SUITE 2: STRUCTURED JSON LOG FORMAT
// ============================================================================

describe('Log Aggregation - Structured JSON Log Format', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should store logs in structured JSON format', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const logEntry = await aggregator.captureLog({
      functionId: 'my-function',
      level: 'info',
      message: 'Test message',
      metadata: {
        userId: 'user-123',
        action: 'login',
        details: { ip: '192.168.1.1' },
      },
    })

    // Verify JSON structure
    expect(typeof logEntry.id).toBe('string')
    expect(typeof logEntry.functionId).toBe('string')
    expect(typeof logEntry.timestamp).toBe('number')
    expect(typeof logEntry.level).toBe('string')
    expect(typeof logEntry.message).toBe('string')
    expect(typeof logEntry.metadata).toBe('object')
  })

  it('should include all required fields in log entry', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const logEntry = await aggregator.captureLog({
      functionId: 'test-func',
      level: 'debug',
      message: 'Debug info',
    })

    // Required fields must be present
    expect(logEntry).toHaveProperty('id')
    expect(logEntry).toHaveProperty('functionId')
    expect(logEntry).toHaveProperty('timestamp')
    expect(logEntry).toHaveProperty('level')
    expect(logEntry).toHaveProperty('message')
  })

  it('should serialize complex metadata correctly', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const complexMetadata = {
      array: [1, 2, 3],
      nested: {
        deep: {
          value: 'test',
        },
      },
      nullValue: null,
      boolValue: true,
      numberValue: 42.5,
    }

    const logEntry = await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Complex metadata test',
      metadata: complexMetadata,
    })

    expect(logEntry.metadata?.array).toEqual([1, 2, 3])
    expect(logEntry.metadata?.nested).toEqual({ deep: { value: 'test' } })
    expect(logEntry.metadata?.nullValue).toBeNull()
    expect(logEntry.metadata?.boolValue).toBe(true)
    expect(logEntry.metadata?.numberValue).toBe(42.5)
  })

  it('should handle large log messages', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const largeMessage = 'x'.repeat(100000) // 100KB message

    const logEntry = await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: largeMessage,
    })

    // Should either store the full message or truncate with indicator
    expect(logEntry.message.length).toBeLessThanOrEqual(100000)
    if (logEntry.message.length < largeMessage.length) {
      expect(logEntry.metadata?.truncated).toBe(true)
    }
  })

  it('should export logs in standard JSON Lines format', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log 1',
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'warn',
      message: 'Log 2',
    })

    const jsonLines = await aggregator.exportJsonLines('test-func')

    // Each line should be valid JSON
    const lines = jsonLines.trim().split('\n')
    expect(lines.length).toBe(2)

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it('should validate log entry schema', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Should reject invalid log entry
    await expect(
      aggregator.captureLog({
        functionId: '', // Invalid empty function ID
        level: 'info',
        message: 'Test',
      })
    ).rejects.toThrow('Invalid function ID')

    await expect(
      aggregator.captureLog({
        functionId: 'test-func',
        level: 'invalid' as LogLevel, // Invalid level
        message: 'Test',
      })
    ).rejects.toThrow('Invalid log level')
  })
})

// ============================================================================
// TEST SUITE 3: LOG LEVELS (DEBUG, INFO, WARN, ERROR)
// ============================================================================

describe('Log Aggregation - Log Levels', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should support debug level logs', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const logEntry = await aggregator.captureLog({
      functionId: 'test-func',
      level: 'debug',
      message: 'Debug information',
    })

    expect(logEntry.level).toBe('debug')
  })

  it('should support info level logs', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const logEntry = await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Informational message',
    })

    expect(logEntry.level).toBe('info')
  })

  it('should support warn level logs', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const logEntry = await aggregator.captureLog({
      functionId: 'test-func',
      level: 'warn',
      message: 'Warning message',
    })

    expect(logEntry.level).toBe('warn')
  })

  it('should support error level logs', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const logEntry = await aggregator.captureLog({
      functionId: 'test-func',
      level: 'error',
      message: 'Error message',
    })

    expect(logEntry.level).toBe('error')
  })

  it('should support fatal level logs', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const logEntry = await aggregator.captureLog({
      functionId: 'test-func',
      level: 'fatal',
      message: 'Fatal error message',
    })

    expect(logEntry.level).toBe('fatal')
  })

  it('should respect log level severity ordering', async () => {
    const { LogAggregator, LOG_LEVEL_SEVERITY } = await import('../../core/log-aggregator')

    // Severity should be: debug < info < warn < error < fatal
    expect(LOG_LEVEL_SEVERITY.debug).toBeLessThan(LOG_LEVEL_SEVERITY.info)
    expect(LOG_LEVEL_SEVERITY.info).toBeLessThan(LOG_LEVEL_SEVERITY.warn)
    expect(LOG_LEVEL_SEVERITY.warn).toBeLessThan(LOG_LEVEL_SEVERITY.error)
    expect(LOG_LEVEL_SEVERITY.error).toBeLessThan(LOG_LEVEL_SEVERITY.fatal)
  })

  it('should filter logs by minimum severity level', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Add logs at different levels
    await aggregator.captureLog({ functionId: 'test-func', level: 'debug', message: 'Debug' })
    await aggregator.captureLog({ functionId: 'test-func', level: 'info', message: 'Info' })
    await aggregator.captureLog({ functionId: 'test-func', level: 'warn', message: 'Warn' })
    await aggregator.captureLog({ functionId: 'test-func', level: 'error', message: 'Error' })
    await aggregator.captureLog({ functionId: 'test-func', level: 'fatal', message: 'Fatal' })

    // Query with minLevel = warn
    const result = await aggregator.query({
      functionId: 'test-func',
      minLevel: 'warn',
    })

    expect(result.entries.length).toBe(3) // warn, error, fatal
    expect(result.entries.every((e) => ['warn', 'error', 'fatal'].includes(e.level))).toBe(true)
  })

  it('should count logs by level', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({ functionId: 'test-func', level: 'info', message: 'Info 1' })
    await aggregator.captureLog({ functionId: 'test-func', level: 'info', message: 'Info 2' })
    await aggregator.captureLog({ functionId: 'test-func', level: 'error', message: 'Error 1' })
    await aggregator.captureLog({ functionId: 'test-func', level: 'error', message: 'Error 2' })
    await aggregator.captureLog({ functionId: 'test-func', level: 'error', message: 'Error 3' })

    const counts = await aggregator.countByLevel('test-func')

    expect(counts.info).toBe(2)
    expect(counts.error).toBe(3)
  })
})

// ============================================================================
// TEST SUITE 4: LOG FILTERING BY FUNCTION ID
// ============================================================================

describe('Log Aggregation - Log Filtering by Function ID', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should filter logs by specific function ID', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Add logs for multiple functions
    await aggregator.captureLog({ functionId: 'func-alpha', level: 'info', message: 'Alpha log' })
    await aggregator.captureLog({ functionId: 'func-beta', level: 'info', message: 'Beta log' })
    await aggregator.captureLog({ functionId: 'func-alpha', level: 'warn', message: 'Another alpha log' })

    const result = await aggregator.query({ functionId: 'func-alpha' })

    expect(result.entries.length).toBe(2)
    expect(result.entries.every((e) => e.functionId === 'func-alpha')).toBe(true)
  })

  it('should return empty result for non-existent function ID', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({ functionId: 'existing-func', level: 'info', message: 'Test' })

    const result = await aggregator.query({ functionId: 'non-existent-func' })

    expect(result.entries).toHaveLength(0)
    expect(result.hasMore).toBe(false)
  })

  it('should support querying logs across all functions', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Log 1' })
    await aggregator.captureLog({ functionId: 'func-2', level: 'info', message: 'Log 2' })
    await aggregator.captureLog({ functionId: 'func-3', level: 'info', message: 'Log 3' })

    const result = await aggregator.queryAll({ limit: 100 })

    expect(result.entries.length).toBe(3)
    const functionIds = new Set(result.entries.map((e) => e.functionId))
    expect(functionIds.has('func-1')).toBe(true)
    expect(functionIds.has('func-2')).toBe(true)
    expect(functionIds.has('func-3')).toBe(true)
  })

  it('should list all function IDs with logs', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({ functionId: 'func-alpha', level: 'info', message: 'Log' })
    await aggregator.captureLog({ functionId: 'func-beta', level: 'info', message: 'Log' })
    await aggregator.captureLog({ functionId: 'func-gamma', level: 'info', message: 'Log' })

    const functionIds = await aggregator.listFunctions()

    expect(functionIds).toContain('func-alpha')
    expect(functionIds).toContain('func-beta')
    expect(functionIds).toContain('func-gamma')
  })

  it('should support wildcard/pattern matching for function IDs', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({ functionId: 'api-users', level: 'info', message: 'Log' })
    await aggregator.captureLog({ functionId: 'api-orders', level: 'info', message: 'Log' })
    await aggregator.captureLog({ functionId: 'worker-email', level: 'info', message: 'Log' })

    // Query with prefix pattern
    const result = await aggregator.queryByPattern('api-*', { limit: 100 })

    expect(result.entries.length).toBe(2)
    expect(result.entries.every((e) => e.functionId.startsWith('api-'))).toBe(true)
  })

  it('should delete logs for specific function ID', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({ functionId: 'func-to-delete', level: 'info', message: 'Log 1' })
    await aggregator.captureLog({ functionId: 'func-to-delete', level: 'info', message: 'Log 2' })
    await aggregator.captureLog({ functionId: 'func-to-keep', level: 'info', message: 'Log 3' })

    await aggregator.deleteLogs('func-to-delete')

    const deletedResult = await aggregator.query({ functionId: 'func-to-delete' })
    expect(deletedResult.entries).toHaveLength(0)

    const keptResult = await aggregator.query({ functionId: 'func-to-keep' })
    expect(keptResult.entries.length).toBe(1)
  })
})

// ============================================================================
// TEST SUITE 5: LOG FILTERING BY TIME RANGE
// ============================================================================

describe('Log Aggregation - Log Filtering by Time Range', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should filter logs by start time', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const baseTime = new Date('2024-01-15T00:00:00Z').getTime()
    vi.setSystemTime(baseTime)

    // Add logs at different times
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log at hour 0',
      timestamp: baseTime,
    })

    vi.setSystemTime(baseTime + 3600000) // +1 hour
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log at hour 1',
      timestamp: baseTime + 3600000,
    })

    vi.setSystemTime(baseTime + 7200000) // +2 hours
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log at hour 2',
      timestamp: baseTime + 7200000,
    })

    // Query with startTime = hour 1
    const result = await aggregator.query({
      functionId: 'test-func',
      startTime: baseTime + 3600000,
    })

    expect(result.entries.length).toBe(2)
    expect(result.entries.every((e) => e.timestamp >= baseTime + 3600000)).toBe(true)
  })

  it('should filter logs by end time', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const baseTime = new Date('2024-01-15T00:00:00Z').getTime()

    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log at hour 0',
      timestamp: baseTime,
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log at hour 1',
      timestamp: baseTime + 3600000,
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log at hour 2',
      timestamp: baseTime + 7200000,
    })

    // Query with endTime = hour 1
    const result = await aggregator.query({
      functionId: 'test-func',
      endTime: baseTime + 3600000,
    })

    expect(result.entries.every((e) => e.timestamp <= baseTime + 3600000)).toBe(true)
  })

  it('should filter logs by both start and end time', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const baseTime = new Date('2024-01-15T00:00:00Z').getTime()

    // Add logs at hours 0, 1, 2, 3, 4
    for (let i = 0; i < 5; i++) {
      await aggregator.captureLog({
        functionId: 'test-func',
        level: 'info',
        message: `Log at hour ${i}`,
        timestamp: baseTime + i * 3600000,
      })
    }

    // Query for hours 1-3
    const result = await aggregator.query({
      functionId: 'test-func',
      startTime: baseTime + 3600000, // hour 1
      endTime: baseTime + 10800000, // hour 3
    })

    expect(result.entries.length).toBe(3) // hours 1, 2, 3
    for (const entry of result.entries) {
      expect(entry.timestamp).toBeGreaterThanOrEqual(baseTime + 3600000)
      expect(entry.timestamp).toBeLessThanOrEqual(baseTime + 10800000)
    }
  })

  it('should return logs sorted by timestamp descending by default', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const baseTime = Date.now()

    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log 1',
      timestamp: baseTime,
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log 2',
      timestamp: baseTime + 1000,
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log 3',
      timestamp: baseTime + 2000,
    })

    const result = await aggregator.query({ functionId: 'test-func' })

    // Should be newest first
    expect(result.entries[0].message).toBe('Log 3')
    expect(result.entries[1].message).toBe('Log 2')
    expect(result.entries[2].message).toBe('Log 1')
  })

  it('should support ascending sort order', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const baseTime = Date.now()

    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log 1',
      timestamp: baseTime,
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log 2',
      timestamp: baseTime + 1000,
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log 3',
      timestamp: baseTime + 2000,
    })

    const result = await aggregator.query({
      functionId: 'test-func',
      order: 'asc',
    })

    // Should be oldest first
    expect(result.entries[0].message).toBe('Log 1')
    expect(result.entries[1].message).toBe('Log 2')
    expect(result.entries[2].message).toBe('Log 3')
  })

  it('should return empty result when no logs match time range', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const baseTime = new Date('2024-01-15T00:00:00Z').getTime()

    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Past log',
      timestamp: baseTime,
    })

    // Query for future time
    const result = await aggregator.query({
      functionId: 'test-func',
      startTime: baseTime + 86400000 * 365, // 1 year in future
    })

    expect(result.entries).toHaveLength(0)
  })

  it('should support relative time queries (e.g., last hour)', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const now = Date.now()
    vi.setSystemTime(now)

    // Add logs at different times
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Recent log',
      timestamp: now - 30 * 60 * 1000, // 30 minutes ago
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Old log',
      timestamp: now - 2 * 60 * 60 * 1000, // 2 hours ago
    })

    // Query for last hour
    const result = await aggregator.queryLastHour('test-func')

    expect(result.entries.length).toBe(1)
    expect(result.entries[0].message).toBe('Recent log')
  })
})

// ============================================================================
// TEST SUITE 6: LOG PAGINATION FOR LARGE RESULT SETS
// ============================================================================

describe('Log Aggregation - Log Pagination', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should respect limit parameter', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Add 50 logs
    for (let i = 0; i < 50; i++) {
      await aggregator.captureLog({
        functionId: 'test-func',
        level: 'info',
        message: `Log ${i}`,
      })
    }

    const result = await aggregator.query({
      functionId: 'test-func',
      limit: 10,
    })

    expect(result.entries).toHaveLength(10)
  })

  it('should return cursor when more results are available', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Add 25 logs
    for (let i = 0; i < 25; i++) {
      await aggregator.captureLog({
        functionId: 'test-func',
        level: 'info',
        message: `Log ${i}`,
      })
    }

    const result = await aggregator.query({
      functionId: 'test-func',
      limit: 10,
    })

    expect(result.cursor).toBeDefined()
    expect(result.cursor).not.toBeNull()
    expect(result.hasMore).toBe(true)
  })

  it('should return null cursor when all results returned', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Add 5 logs
    for (let i = 0; i < 5; i++) {
      await aggregator.captureLog({
        functionId: 'test-func',
        level: 'info',
        message: `Log ${i}`,
      })
    }

    const result = await aggregator.query({
      functionId: 'test-func',
      limit: 10, // More than available
    })

    expect(result.cursor).toBeNull()
    expect(result.hasMore).toBe(false)
  })

  it('should fetch next page using cursor', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Add 25 logs with distinct messages
    for (let i = 0; i < 25; i++) {
      await aggregator.captureLog({
        functionId: 'test-func',
        level: 'info',
        message: `Log ${i}`,
        timestamp: Date.now() + i * 1000,
      })
    }

    // First page
    const firstPage = await aggregator.query({
      functionId: 'test-func',
      limit: 10,
    })

    expect(firstPage.entries).toHaveLength(10)
    expect(firstPage.cursor).not.toBeNull()

    // Second page
    const secondPage = await aggregator.query({
      functionId: 'test-func',
      limit: 10,
      cursor: firstPage.cursor!,
    })

    // Pages should have different entries
    const firstPageIds = new Set(firstPage.entries.map((e) => e.id))
    const secondPageIds = new Set(secondPage.entries.map((e) => e.id))

    for (const id of secondPageIds) {
      expect(firstPageIds.has(id)).toBe(false)
    }
  })

  it('should iterate through all pages', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Add 55 logs
    for (let i = 0; i < 55; i++) {
      await aggregator.captureLog({
        functionId: 'test-func',
        level: 'info',
        message: `Log ${i}`,
      })
    }

    const allEntries: ExpectedLogEntry[] = []
    let cursor: string | null = null

    do {
      const result = await aggregator.query({
        functionId: 'test-func',
        limit: 20,
        cursor: cursor ?? undefined,
      })

      allEntries.push(...result.entries)
      cursor = result.cursor
    } while (cursor)

    expect(allEntries.length).toBe(55)
  })

  it('should use default limit when not specified', async () => {
    const { LogAggregator, DEFAULT_LOG_LIMIT } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Add more logs than default limit
    for (let i = 0; i < DEFAULT_LOG_LIMIT + 50; i++) {
      await aggregator.captureLog({
        functionId: 'test-func',
        level: 'info',
        message: `Log ${i}`,
      })
    }

    const result = await aggregator.query({ functionId: 'test-func' })

    expect(result.entries.length).toBe(DEFAULT_LOG_LIMIT)
  })

  it('should enforce maximum limit', async () => {
    const { LogAggregator, MAX_LOG_LIMIT } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Add many logs
    for (let i = 0; i < MAX_LOG_LIMIT + 500; i++) {
      await aggregator.captureLog({
        functionId: 'test-func',
        level: 'info',
        message: `Log ${i}`,
      })
    }

    const result = await aggregator.query({
      functionId: 'test-func',
      limit: 10000, // Exceeds maximum
    })

    expect(result.entries.length).toBeLessThanOrEqual(MAX_LOG_LIMIT)
  })

  it('should return total count when requested', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Add 75 logs
    for (let i = 0; i < 75; i++) {
      await aggregator.captureLog({
        functionId: 'test-func',
        level: 'info',
        message: `Log ${i}`,
      })
    }

    const result = await aggregator.queryWithCount({
      functionId: 'test-func',
      limit: 10,
    })

    expect(result.entries.length).toBe(10)
    expect(result.total).toBe(75)
  })

  it('should handle invalid cursor gracefully', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log',
    })

    await expect(
      aggregator.query({
        functionId: 'test-func',
        cursor: 'invalid-cursor',
      })
    ).rejects.toThrow('Invalid cursor')
  })
})

// ============================================================================
// TEST SUITE 7: REAL-TIME LOG STREAMING API
// ============================================================================

describe('Log Aggregation - Real-time Log Streaming', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should accept WebSocket connection for streaming', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)
    const mockWs = new MockWebSocket()

    await aggregator.handleWebSocketStream(mockWs as unknown as WebSocket, {
      functionId: 'test-func',
    })

    expect(mockWs.accepted).toBe(true)
  })

  it('should stream new log entries to connected clients', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)
    const mockWs = new MockWebSocket()

    await aggregator.handleWebSocketStream(mockWs as unknown as WebSocket, {
      functionId: 'test-func',
    })

    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Streamed log entry',
    })

    expect(mockWs.messages.length).toBeGreaterThanOrEqual(1)

    const lastMessage = JSON.parse(mockWs.messages[mockWs.messages.length - 1])
    expect(lastMessage.type).toBe('log')
    expect(lastMessage.entry.message).toBe('Streamed log entry')
  })

  it('should filter streamed logs by level', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)
    const mockWs = new MockWebSocket()

    await aggregator.handleWebSocketStream(mockWs as unknown as WebSocket, {
      functionId: 'test-func',
      levels: ['error', 'fatal'],
    })

    // Add logs at different levels
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Info log (should not stream)',
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'error',
      message: 'Error log (should stream)',
    })

    const logMessages = mockWs.messages.map((m) => JSON.parse(m)).filter((m) => m.type === 'log')

    expect(logMessages.length).toBe(1)
    expect(logMessages[0].entry.level).toBe('error')
  })

  it('should support multiple concurrent WebSocket connections', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)
    const mockWs1 = new MockWebSocket()
    const mockWs2 = new MockWebSocket()

    await aggregator.handleWebSocketStream(mockWs1 as unknown as WebSocket, {
      functionId: 'test-func',
    })
    await aggregator.handleWebSocketStream(mockWs2 as unknown as WebSocket, {
      functionId: 'test-func',
    })

    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Broadcast log',
    })

    expect(mockWs1.messages.length).toBeGreaterThanOrEqual(1)
    expect(mockWs2.messages.length).toBeGreaterThanOrEqual(1)
  })

  it('should only stream logs for subscribed function', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)
    const mockWs = new MockWebSocket()

    await aggregator.handleWebSocketStream(mockWs as unknown as WebSocket, {
      functionId: 'func-1',
    })

    await aggregator.captureLog({
      functionId: 'func-2',
      level: 'info',
      message: 'Log for different function',
    })

    const logMessages = mockWs.messages.map((m) => JSON.parse(m)).filter((m) => m.type === 'log')

    expect(logMessages).toHaveLength(0)
  })

  it('should handle WebSocket disconnection gracefully', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)
    const mockWs = new MockWebSocket()

    await aggregator.handleWebSocketStream(mockWs as unknown as WebSocket, {
      functionId: 'test-func',
    })

    mockWs.close()

    // Should not throw when trying to stream to closed connection
    await expect(
      aggregator.captureLog({
        functionId: 'test-func',
        level: 'info',
        message: 'Log after disconnect',
      })
    ).resolves.toBeDefined()
  })

  it('should send heartbeat messages to keep connection alive', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)
    const mockWs = new MockWebSocket()

    await aggregator.handleWebSocketStream(mockWs as unknown as WebSocket, {
      functionId: 'test-func',
      heartbeat: 5000,
    })

    // Fast-forward 5 seconds
    vi.advanceTimersByTime(5000)

    const heartbeatMessages = mockWs.messages.map((m) => JSON.parse(m)).filter((m) => m.type === 'heartbeat')

    expect(heartbeatMessages.length).toBeGreaterThanOrEqual(1)
  })

  it('should send initial batch of recent logs on connection', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Add existing logs before connection
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Existing log 1',
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Existing log 2',
    })

    const mockWs = new MockWebSocket()

    await aggregator.handleWebSocketStream(mockWs as unknown as WebSocket, {
      functionId: 'test-func',
      tail: 10, // Send last 10 logs on connect
    })

    const historyMessages = mockWs.messages.map((m) => JSON.parse(m)).filter((m) => m.type === 'history')

    expect(historyMessages.length).toBeGreaterThanOrEqual(1)
    expect(historyMessages[0].entries.length).toBe(2)
  })

  it('should support Server-Sent Events (SSE) streaming', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Create SSE stream
    const stream = await aggregator.createSSEStream('test-func', {
      levels: ['error', 'fatal'],
    })

    expect(stream).toBeDefined()
    expect(stream instanceof ReadableStream).toBe(true)
  })

  it('should support Last-Event-ID for stream reconnection', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Add some logs
    const log1 = await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log 1',
    })
    const log2 = await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log 2',
    })
    const log3 = await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log 3',
    })

    // Reconnect with Last-Event-ID
    const mockWs = new MockWebSocket()

    await aggregator.handleWebSocketStream(mockWs as unknown as WebSocket, {
      functionId: 'test-func',
      lastEventId: log1.id,
    })

    // Should receive logs after the last event ID
    const historyMessages = mockWs.messages.map((m) => JSON.parse(m)).filter((m) => m.type === 'history')

    expect(historyMessages[0].entries.length).toBe(2) // log2 and log3
    expect(historyMessages[0].entries.some((e: ExpectedLogEntry) => e.id === log1.id)).toBe(false)
  })
})

// ============================================================================
// TEST SUITE 8: LOG RETENTION POLICIES
// ============================================================================

describe('Log Aggregation - Log Retention Policies', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should delete logs older than retention period', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const now = Date.now()
    vi.setSystemTime(now)

    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000

    // Add old log
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Old log',
      timestamp: twoWeeksAgo,
    })

    // Add recent log
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Recent log',
      timestamp: now,
    })

    // Apply retention policy (7 days)
    const deleted = await aggregator.applyRetention({
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    })

    expect(deleted).toBeGreaterThanOrEqual(1)

    // Verify old log is deleted
    const result = await aggregator.query({
      functionId: 'test-func',
    })

    expect(result.entries.length).toBe(1)
    expect(result.entries[0].message).toBe('Recent log')
  })

  it('should delete logs exceeding max count', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Add 150 logs
    for (let i = 0; i < 150; i++) {
      await aggregator.captureLog({
        functionId: 'test-func',
        level: 'info',
        message: `Log ${i}`,
        timestamp: Date.now() + i * 1000, // Ensure ordering
      })
    }

    // Apply retention with max count
    await aggregator.applyRetention({
      maxCount: 100,
    })

    const result = await aggregator.query({
      functionId: 'test-func',
      limit: 200,
    })

    expect(result.entries.length).toBeLessThanOrEqual(100)
  })

  it('should combine age and count retention policies', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const now = Date.now()
    vi.setSystemTime(now)

    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

    // Add 50 old logs
    for (let i = 0; i < 50; i++) {
      await aggregator.captureLog({
        functionId: 'test-func',
        level: 'info',
        message: `Old log ${i}`,
        timestamp: thirtyDaysAgo - i * 1000,
      })
    }

    // Add 200 recent logs
    for (let i = 0; i < 200; i++) {
      await aggregator.captureLog({
        functionId: 'test-func',
        level: 'info',
        message: `Recent log ${i}`,
        timestamp: now - i * 1000,
      })
    }

    await aggregator.applyRetention({
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      maxCount: 100,
    })

    const result = await aggregator.query({
      functionId: 'test-func',
      limit: 500,
    })

    // All old logs should be deleted, and only 100 recent logs retained
    expect(result.entries.length).toBeLessThanOrEqual(100)
    expect(result.entries.every((e) => e.message.startsWith('Recent'))).toBe(true)
  })

  it('should apply retention per function independently', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Add 50 logs for func-1
    for (let i = 0; i < 50; i++) {
      await aggregator.captureLog({
        functionId: 'func-1',
        level: 'info',
        message: `Func1 log ${i}`,
      })
    }

    // Add 50 logs for func-2
    for (let i = 0; i < 50; i++) {
      await aggregator.captureLog({
        functionId: 'func-2',
        level: 'info',
        message: `Func2 log ${i}`,
      })
    }

    await aggregator.applyRetention({
      maxCount: 25,
      perFunction: true,
    })

    const result1 = await aggregator.query({ functionId: 'func-1', limit: 100 })
    const result2 = await aggregator.query({ functionId: 'func-2', limit: 100 })

    expect(result1.entries.length).toBeLessThanOrEqual(25)
    expect(result2.entries.length).toBeLessThanOrEqual(25)
  })

  it('should schedule automatic retention cleanup', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const cleanupFn = vi.fn()

    aggregator.scheduleRetention(
      {
        maxAge: 7 * 24 * 60 * 60 * 1000,
        interval: 60 * 60 * 1000, // Every hour
      },
      cleanupFn
    )

    // Fast-forward 1 hour
    vi.advanceTimersByTime(60 * 60 * 1000)

    expect(cleanupFn).toHaveBeenCalled()
  })

  it('should return retention statistics', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const baseTime = Date.now()

    // Add test logs
    for (let i = 0; i < 20; i++) {
      await aggregator.captureLog({
        functionId: 'test-func',
        level: 'info',
        message: `Log ${i}`,
        timestamp: baseTime + i * 1000,
      })
    }

    const stats = await aggregator.getRetentionStats()

    expect(stats.totalLogs).toBe(20)
    expect(stats.oldestTimestamp).toBe(baseTime)
    expect(stats.newestTimestamp).toBe(baseTime + 19000)
  })

  it('should support different retention policies per log level', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const now = Date.now()
    vi.setSystemTime(now)

    // Add old error logs (should be retained longer)
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'error',
      message: 'Old error',
      timestamp: now - 60 * 24 * 60 * 60 * 1000, // 60 days ago
    })

    // Add old info logs
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Old info',
      timestamp: now - 60 * 24 * 60 * 60 * 1000, // 60 days ago
    })

    await aggregator.applyRetention({
      levelPolicies: {
        error: { maxAge: 90 * 24 * 60 * 60 * 1000 }, // 90 days for errors
        info: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 days for info
      },
    })

    const result = await aggregator.query({
      functionId: 'test-func',
      limit: 100,
    })

    // Error log should be retained, info log should be deleted
    expect(result.entries.length).toBe(1)
    expect(result.entries[0].level).toBe('error')
  })

  it('should estimate storage usage', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Add some logs
    for (let i = 0; i < 100; i++) {
      await aggregator.captureLog({
        functionId: 'test-func',
        level: 'info',
        message: `Log message with some content ${i}`,
        metadata: { index: i, data: 'test data' },
      })
    }

    const usage = await aggregator.estimateStorageUsage()

    expect(usage.totalBytes).toBeGreaterThan(0)
    expect(usage.logCount).toBe(100)
    expect(usage.avgBytesPerLog).toBeGreaterThan(0)
  })
})

// ============================================================================
// TEST SUITE 9: LOG SEARCH/QUERY CAPABILITIES
// ============================================================================

describe('Log Aggregation - Log Search/Query Capabilities', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should search logs by message content', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'User login successful for user@example.com',
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'error',
      message: 'Database connection failed',
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'User logout for user@example.com',
    })

    const result = await aggregator.search({
      query: 'user@example.com',
    })

    expect(result.entries.length).toBe(2)
    expect(result.entries.every((e) => e.message.includes('user@example.com'))).toBe(true)
  })

  it('should search logs within specific function', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({
      functionId: 'func-1',
      level: 'info',
      message: 'Payment processed',
    })
    await aggregator.captureLog({
      functionId: 'func-2',
      level: 'info',
      message: 'Payment failed',
    })

    const result = await aggregator.search({
      query: 'Payment',
      functionId: 'func-1',
    })

    expect(result.entries.length).toBe(1)
    expect(result.entries[0].functionId).toBe('func-1')
  })

  it('should support case-insensitive search', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'User LOGIN successful',
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'user login failed',
    })

    const result = await aggregator.search({
      query: 'login',
      caseInsensitive: true,
    })

    expect(result.entries.length).toBe(2)
  })

  it('should search in metadata fields', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Request processed',
      metadata: { userId: 'usr-12345', orderId: 'ord-67890' },
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Another request',
      metadata: { userId: 'usr-99999' },
    })

    const result = await aggregator.search({
      query: 'usr-12345',
      searchMetadata: true,
    })

    expect(result.entries.length).toBe(1)
    expect(result.entries[0].metadata?.userId).toBe('usr-12345')
  })

  it('should support regex search', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Processing order-123',
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Processing order-456',
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Processing user-789',
    })

    const result = await aggregator.search({
      query: 'order-\\d+',
      regex: true,
    })

    expect(result.entries.length).toBe(2)
  })

  it('should support structured query language', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({
      functionId: 'api',
      level: 'error',
      message: 'Request failed',
      metadata: { statusCode: 500, endpoint: '/users' },
    })
    await aggregator.captureLog({
      functionId: 'api',
      level: 'warn',
      message: 'Request slow',
      metadata: { statusCode: 200, endpoint: '/users' },
    })
    await aggregator.captureLog({
      functionId: 'api',
      level: 'error',
      message: 'Request failed',
      metadata: { statusCode: 404, endpoint: '/orders' },
    })

    // Structured query: level=error AND metadata.statusCode>=500
    const result = await aggregator.structuredQuery({
      functionId: 'api',
      conditions: [
        { field: 'level', operator: '=', value: 'error' },
        { field: 'metadata.statusCode', operator: '>=', value: 500 },
      ],
    })

    expect(result.entries.length).toBe(1)
    expect(result.entries[0].metadata?.statusCode).toBe(500)
  })

  it('should support full-text search with ranking', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'User authentication successful',
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'error',
      message: 'User authentication failed, invalid credentials for user',
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Database query executed',
    })

    const result = await aggregator.fullTextSearch({
      query: 'user authentication',
      limit: 10,
    })

    expect(result.entries.length).toBe(2)
    // More relevant result should be ranked higher
    expect(result.entries[0].score).toBeGreaterThan(result.entries[1].score || 0)
  })

  it('should aggregate log counts by field', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Log' })
    await aggregator.captureLog({ functionId: 'func-1', level: 'error', message: 'Log' })
    await aggregator.captureLog({ functionId: 'func-1', level: 'error', message: 'Log' })
    await aggregator.captureLog({ functionId: 'func-2', level: 'info', message: 'Log' })
    await aggregator.captureLog({ functionId: 'func-2', level: 'info', message: 'Log' })
    await aggregator.captureLog({ functionId: 'func-2', level: 'info', message: 'Log' })

    const aggregation = await aggregator.aggregate({
      groupBy: 'functionId',
      metrics: ['count', 'errorRate'],
    })

    expect(aggregation['func-1'].count).toBe(3)
    expect(aggregation['func-1'].errorRate).toBeCloseTo(2 / 3, 2)
    expect(aggregation['func-2'].count).toBe(3)
    expect(aggregation['func-2'].errorRate).toBe(0)
  })

  it('should support log tailing (follow mode)', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    const logs: ExpectedLogEntry[] = []

    // Start tailing
    const unsubscribe = await aggregator.tail('test-func', (entry) => {
      logs.push(entry)
    })

    // Add logs
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log 1',
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'Log 2',
    })

    expect(logs.length).toBe(2)
    expect(logs[0].message).toBe('Log 1')
    expect(logs[1].message).toBe('Log 2')

    unsubscribe()
  })

  it('should export logs with search results', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'error',
      message: 'Critical error 1',
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'error',
      message: 'Critical error 2',
    })

    const exportData = await aggregator.exportSearchResults({
      query: 'Critical',
      format: 'csv',
    })

    expect(exportData).toContain('timestamp')
    expect(exportData).toContain('level')
    expect(exportData).toContain('message')
    expect(exportData).toContain('Critical error')
  })

  it('should suggest search terms based on log content', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')

    const aggregator = new LogAggregator(mockState, mockKV)

    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'User authentication successful',
    })
    await aggregator.captureLog({
      functionId: 'test-func',
      level: 'info',
      message: 'User authorization granted',
    })

    const suggestions = await aggregator.suggestSearchTerms('auth')

    expect(suggestions).toContain('authentication')
    expect(suggestions).toContain('authorization')
  })
})

// ============================================================================
// TEST SUITE: INTEGRATION WITH FUNCTIONLOGS DURABLE OBJECT
// ============================================================================

describe('Log Aggregation - FunctionLogs Durable Object Integration', () => {
  let mockKV: KVNamespace
  let mockState: ReturnType<typeof createMockDurableObjectState>

  beforeEach(() => {
    mockKV = createMockKV()
    mockState = createMockDurableObjectState()
  })

  it('should use FunctionLogs DO for persistent storage', async () => {
    const { LogAggregator } = await import('../../core/log-aggregator')
    const { FunctionLogs } = await import('../../do/function-logs')

    const aggregator = new LogAggregator(mockState, mockKV)

    // Verify that LogAggregator delegates to FunctionLogs DO
    expect(aggregator.getFunctionLogsDO()).toBeInstanceOf(Function)
  })

  it('should handle HTTP requests through FunctionLogs DO', async () => {
    const { FunctionLogs } = await import('../../do/function-logs')

    const doState = mockState as unknown as DurableObjectState
    const functionLogs = new FunctionLogs(doState, {})

    const request = new Request('http://localhost/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        functionId: 'test-func',
        level: 'info',
        message: 'Test log via HTTP',
      }),
    })

    const response = await functionLogs.fetch(request)

    expect(response.status).toBe(201)
  })

  it('should query logs through FunctionLogs DO', async () => {
    const { FunctionLogs } = await import('../../do/function-logs')

    const doState = mockState as unknown as DurableObjectState
    const functionLogs = new FunctionLogs(doState, {})

    // First add a log
    await functionLogs.append({
      functionId: 'test-func',
      level: 'info',
      message: 'Test log',
    })

    // Then query
    const result = await functionLogs.query({
      functionId: 'test-func',
    })

    expect(result.entries.length).toBeGreaterThanOrEqual(1)
  })
})
