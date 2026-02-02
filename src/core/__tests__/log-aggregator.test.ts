/**
 * Log Aggregator Tests
 *
 * Tests for the log aggregation functionality including:
 * - Log capture (single, batch, execution, error)
 * - Query operations (filter, sort, paginate)
 * - Search operations (text search, structured query, full-text)
 * - Retention policy enforcement
 * - Streaming (WebSocket, SSE, tail)
 * - Export functionality
 * - Error handling
 *
 * @module core/__tests__/log-aggregator
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  LogAggregator,
  DEFAULT_LOG_LIMIT,
  MAX_LOG_LIMIT,
  MAX_MESSAGE_SIZE,
  LOG_LEVEL_SEVERITY,
} from '../log-aggregator'
import type { LogEntryInput, LogLevel } from '../../do/function-logs'

// ============================================================================
// MOCKS
// ============================================================================

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
  id: {
    toString: () => 'test-do-id',
    name: 'test-do',
  },
  waitUntil: () => {},
  blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
})

// Mock WebSocket
const createMockWebSocket = () => ({
  send: vi.fn(),
  close: vi.fn(),
  accept: vi.fn(),
  readyState: 1, // OPEN
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})

// ============================================================================
// TESTS
// ============================================================================

describe('LogAggregator', () => {
  let aggregator: LogAggregator
  let mockState: ReturnType<typeof createMockState>
  let mockKV: KVNamespace

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockState()
    mockKV = createMockKV()
    aggregator = new LogAggregator(mockState as never, mockKV)
  })

  afterEach(() => {
    // Clear all timers to prevent interference between tests
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  // ==========================================================================
  // CONSTANTS
  // ==========================================================================

  describe('Constants', () => {
    it('should have correct default log limit', () => {
      expect(DEFAULT_LOG_LIMIT).toBe(100)
    })

    it('should have correct max log limit', () => {
      expect(MAX_LOG_LIMIT).toBe(1000)
    })

    it('should have correct max message size', () => {
      expect(MAX_MESSAGE_SIZE).toBe(100000)
    })

    it('should have correct log level severity ordering', () => {
      expect(LOG_LEVEL_SEVERITY.debug).toBe(0)
      expect(LOG_LEVEL_SEVERITY.info).toBe(1)
      expect(LOG_LEVEL_SEVERITY.warn).toBe(2)
      expect(LOG_LEVEL_SEVERITY.error).toBe(3)
      expect(LOG_LEVEL_SEVERITY.fatal).toBe(4)
    })
  })

  // ==========================================================================
  // LOG CAPTURE
  // ==========================================================================

  describe('captureLog()', () => {
    it('should capture a single log entry', async () => {
      const input: LogEntryInput = {
        functionId: 'func-1',
        level: 'info',
        message: 'Hello world',
      }

      const entry = await aggregator.captureLog(input)

      expect(entry.id).toBeDefined()
      expect(entry.functionId).toBe('func-1')
      expect(entry.level).toBe('info')
      expect(entry.message).toBe('Hello world')
      expect(entry.timestamp).toBeGreaterThan(0)
    })

    it('should capture log with custom timestamp', async () => {
      const customTimestamp = 1700000000000
      const input: LogEntryInput = {
        functionId: 'func-1',
        level: 'info',
        message: 'Test message',
        timestamp: customTimestamp,
      }

      const entry = await aggregator.captureLog(input)

      expect(entry.timestamp).toBe(customTimestamp)
    })

    it('should capture log with metadata', async () => {
      const input: LogEntryInput = {
        functionId: 'func-1',
        level: 'info',
        message: 'Test message',
        metadata: { userId: '123', action: 'login' },
      }

      const entry = await aggregator.captureLog(input)

      expect(entry.metadata).toEqual({ userId: '123', action: 'login' })
    })

    it('should capture log with requestId and durationMs', async () => {
      const input: LogEntryInput = {
        functionId: 'func-1',
        level: 'info',
        message: 'Request completed',
        requestId: 'req-123',
        durationMs: 150,
      }

      const entry = await aggregator.captureLog(input)

      expect(entry.requestId).toBe('req-123')
      expect(entry.durationMs).toBe(150)
    })

    it('should generate unique IDs for each log entry', async () => {
      const input: LogEntryInput = {
        functionId: 'func-1',
        level: 'info',
        message: 'Test',
      }

      const entry1 = await aggregator.captureLog(input)
      const entry2 = await aggregator.captureLog(input)

      expect(entry1.id).not.toBe(entry2.id)
    })

    it('should truncate messages exceeding max size', async () => {
      const longMessage = 'x'.repeat(MAX_MESSAGE_SIZE + 1000)
      const input: LogEntryInput = {
        functionId: 'func-1',
        level: 'info',
        message: longMessage,
      }

      const entry = await aggregator.captureLog(input)

      expect(entry.message.length).toBe(MAX_MESSAGE_SIZE)
      expect(entry.metadata?.truncated).toBe(true)
    })

    it('should throw error for invalid function ID', async () => {
      const input: LogEntryInput = {
        functionId: '',
        level: 'info',
        message: 'Test',
      }

      await expect(aggregator.captureLog(input)).rejects.toThrow('Invalid function ID')
    })

    it('should throw error for whitespace-only function ID', async () => {
      const input: LogEntryInput = {
        functionId: '   ',
        level: 'info',
        message: 'Test',
      }

      await expect(aggregator.captureLog(input)).rejects.toThrow('Invalid function ID')
    })

    it('should throw error for invalid log level', async () => {
      const input = {
        functionId: 'func-1',
        level: 'invalid' as LogLevel,
        message: 'Test',
      }

      await expect(aggregator.captureLog(input)).rejects.toThrow('Invalid log level')
    })

    it('should capture logs for all valid log levels', async () => {
      const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal']

      for (const level of levels) {
        const entry = await aggregator.captureLog({
          functionId: 'func-1',
          level,
          message: `${level} message`,
        })
        expect(entry.level).toBe(level)
      }
    })
  })

  describe('captureBatch()', () => {
    it('should capture multiple logs in batch', async () => {
      const inputs: LogEntryInput[] = [
        { functionId: 'func-1', level: 'info', message: 'Log 1' },
        { functionId: 'func-1', level: 'warn', message: 'Log 2' },
        { functionId: 'func-2', level: 'error', message: 'Log 3' },
      ]

      const entries = await aggregator.captureBatch(inputs)

      expect(entries).toHaveLength(3)
      expect(entries[0].message).toBe('Log 1')
      expect(entries[1].message).toBe('Log 2')
      expect(entries[2].message).toBe('Log 3')
    })

    it('should handle empty batch', async () => {
      const entries = await aggregator.captureBatch([])
      expect(entries).toHaveLength(0)
    })
  })

  describe('captureError()', () => {
    it('should capture an error as a log entry', async () => {
      const error = new Error('Something went wrong')
      error.name = 'TestError'

      const entry = await aggregator.captureError('func-1', 'req-123', error)

      expect(entry.level).toBe('error')
      expect(entry.message).toBe('Something went wrong')
      expect(entry.functionId).toBe('func-1')
      expect(entry.requestId).toBe('req-123')
      expect(entry.metadata?.errorName).toBe('TestError')
      expect(entry.metadata?.stack).toBeDefined()
    })
  })

  describe('captureExecutionLogs()', () => {
    it('should capture console.log during execution', async () => {
      const logs = await aggregator.captureExecutionLogs('func-1', 'req-123', async () => {
        console.log('Hello from execution')
      })

      expect(logs).toHaveLength(1)
      expect(logs[0].message).toBe('Hello from execution')
      expect(logs[0].level).toBe('info')
      expect(logs[0].requestId).toBe('req-123')
    })

    it('should capture console.info during execution', async () => {
      const logs = await aggregator.captureExecutionLogs('func-1', 'req-123', async () => {
        console.info('Info message')
      })

      expect(logs).toHaveLength(1)
      expect(logs[0].message).toBe('Info message')
      expect(logs[0].level).toBe('info')
    })

    it('should capture console.warn during execution', async () => {
      const logs = await aggregator.captureExecutionLogs('func-1', 'req-123', async () => {
        console.warn('Warning message')
      })

      expect(logs).toHaveLength(1)
      expect(logs[0].message).toBe('Warning message')
      expect(logs[0].level).toBe('warn')
    })

    it('should capture console.error during execution', async () => {
      const logs = await aggregator.captureExecutionLogs('func-1', 'req-123', async () => {
        console.error('Error message')
      })

      expect(logs).toHaveLength(1)
      expect(logs[0].message).toBe('Error message')
      expect(logs[0].level).toBe('error')
    })

    it('should capture multiple console calls', async () => {
      const logs = await aggregator.captureExecutionLogs('func-1', 'req-123', async () => {
        console.log('First')
        console.info('Second')
        console.warn('Third')
        console.error('Fourth')
      })

      expect(logs).toHaveLength(4)
    })

    it('should restore console methods after execution', async () => {
      // Test that console methods work normally after execution
      // (identity comparison doesn't work reliably in Workers environment due to binding)
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await aggregator.captureExecutionLogs('func-1', 'req-123', async () => {
        console.log('Test')
      })

      // Console should work normally after - spy should capture this
      console.log('After execution')
      expect(logSpy).toHaveBeenCalledWith('After execution')

      logSpy.mockRestore()
    })

    it('should restore console methods even if execution throws', async () => {
      // Test that console methods work normally after execution throws
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        await aggregator.captureExecutionLogs('func-1', 'req-123', async () => {
          throw new Error('Execution failed')
        })
      } catch {
        // Expected
      }

      // Console should work normally after - spy should capture this
      console.log('After error')
      expect(logSpy).toHaveBeenCalledWith('After error')

      logSpy.mockRestore()
    })
  })

  describe('getLogsByRequestId()', () => {
    it('should get all logs for a request ID', async () => {
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Log 1', requestId: 'req-123' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Log 2', requestId: 'req-123' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Log 3', requestId: 'req-456' })

      const logs = await aggregator.getLogsByRequestId('req-123')

      expect(logs).toHaveLength(2)
      expect(logs.every((l) => l.requestId === 'req-123')).toBe(true)
    })

    it('should return empty array for non-existent request ID', async () => {
      const logs = await aggregator.getLogsByRequestId('non-existent')
      expect(logs).toHaveLength(0)
    })
  })

  // ==========================================================================
  // QUERY OPERATIONS
  // ==========================================================================

  describe('query()', () => {
    beforeEach(async () => {
      // Add test data
      const now = Date.now()
      await aggregator.captureLog({ functionId: 'func-1', level: 'debug', message: 'Debug', timestamp: now - 4000 })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Info', timestamp: now - 3000 })
      await aggregator.captureLog({ functionId: 'func-1', level: 'warn', message: 'Warn', timestamp: now - 2000 })
      await aggregator.captureLog({ functionId: 'func-1', level: 'error', message: 'Error', timestamp: now - 1000 })
      await aggregator.captureLog({ functionId: 'func-2', level: 'info', message: 'Other function', timestamp: now })
    })

    it('should query logs by function ID', async () => {
      const result = await aggregator.query({ functionId: 'func-1' })

      expect(result.entries).toHaveLength(4)
      expect(result.entries.every((e) => e.functionId === 'func-1')).toBe(true)
    })

    it('should filter by time range', async () => {
      const now = Date.now()
      const result = await aggregator.query({
        functionId: 'func-1',
        startTime: now - 3500,
        endTime: now - 1500,
      })

      expect(result.entries).toHaveLength(2) // info and warn
    })

    it('should filter by single level', async () => {
      const result = await aggregator.query({
        functionId: 'func-1',
        level: 'info',
      })

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].level).toBe('info')
    })

    it('should filter by multiple levels', async () => {
      const result = await aggregator.query({
        functionId: 'func-1',
        levels: ['warn', 'error'],
      })

      expect(result.entries).toHaveLength(2)
      expect(result.entries.every((e) => ['warn', 'error'].includes(e.level))).toBe(true)
    })

    it('should filter by minimum level', async () => {
      const result = await aggregator.query({
        functionId: 'func-1',
        minLevel: 'warn',
      })

      expect(result.entries).toHaveLength(2) // warn and error
      expect(result.entries.every((e) => LOG_LEVEL_SEVERITY[e.level] >= LOG_LEVEL_SEVERITY.warn)).toBe(true)
    })

    it('should sort in descending order by default', async () => {
      const result = await aggregator.query({ functionId: 'func-1' })

      for (let i = 1; i < result.entries.length; i++) {
        expect(result.entries[i - 1].timestamp).toBeGreaterThanOrEqual(result.entries[i].timestamp)
      }
    })

    it('should sort in ascending order when specified', async () => {
      const result = await aggregator.query({ functionId: 'func-1', order: 'asc' })

      for (let i = 1; i < result.entries.length; i++) {
        expect(result.entries[i - 1].timestamp).toBeLessThanOrEqual(result.entries[i].timestamp)
      }
    })

    it('should return empty result for non-existent function', async () => {
      const result = await aggregator.query({ functionId: 'non-existent' })

      expect(result.entries).toHaveLength(0)
      expect(result.hasMore).toBe(false)
      expect(result.cursor).toBeNull()
    })
  })

  describe('Pagination', () => {
    beforeEach(async () => {
      // Add 150 logs
      for (let i = 0; i < 150; i++) {
        await aggregator.captureLog({
          functionId: 'func-1',
          level: 'info',
          message: `Log ${i}`,
          timestamp: Date.now() + i,
        })
      }
    })

    it('should limit results to default limit', async () => {
      const result = await aggregator.query({ functionId: 'func-1' })

      expect(result.entries).toHaveLength(DEFAULT_LOG_LIMIT)
      expect(result.hasMore).toBe(true)
      expect(result.cursor).not.toBeNull()
    })

    it('should respect custom limit', async () => {
      const result = await aggregator.query({ functionId: 'func-1', limit: 50 })

      expect(result.entries).toHaveLength(50)
      expect(result.hasMore).toBe(true)
    })

    it('should not exceed max limit', async () => {
      const result = await aggregator.query({ functionId: 'func-1', limit: 2000 })

      expect(result.entries.length).toBeLessThanOrEqual(MAX_LOG_LIMIT)
    })

    it('should paginate with cursor', async () => {
      const firstPage = await aggregator.query({ functionId: 'func-1', limit: 50 })
      expect(firstPage.cursor).not.toBeNull()

      const secondPage = await aggregator.query({
        functionId: 'func-1',
        limit: 50,
        cursor: firstPage.cursor!,
      })

      expect(secondPage.entries).toHaveLength(50)
      // Entries should be different
      expect(firstPage.entries[0].id).not.toBe(secondPage.entries[0].id)
    })

    it('should throw error for invalid cursor', async () => {
      await expect(
        aggregator.query({ functionId: 'func-1', cursor: 'invalid-cursor' })
      ).rejects.toThrow('Invalid cursor')
    })
  })

  describe('queryAll()', () => {
    beforeEach(async () => {
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Func 1 log' })
      await aggregator.captureLog({ functionId: 'func-2', level: 'warn', message: 'Func 2 log' })
      await aggregator.captureLog({ functionId: 'func-3', level: 'error', message: 'Func 3 log' })
    })

    it('should query logs across all functions', async () => {
      const result = await aggregator.queryAll({})

      expect(result.entries).toHaveLength(3)
    })

    it('should filter by level across all functions', async () => {
      const result = await aggregator.queryAll({ minLevel: 'warn' })

      expect(result.entries).toHaveLength(2) // warn and error
    })
  })

  describe('queryByPattern()', () => {
    beforeEach(async () => {
      await aggregator.captureLog({ functionId: 'api-users', level: 'info', message: 'Log 1' })
      await aggregator.captureLog({ functionId: 'api-posts', level: 'info', message: 'Log 2' })
      await aggregator.captureLog({ functionId: 'worker-task', level: 'info', message: 'Log 3' })
    })

    it('should match logs by pattern', async () => {
      const result = await aggregator.queryByPattern('api-*', {})

      expect(result.entries).toHaveLength(2)
      expect(result.entries.every((e) => e.functionId.startsWith('api-'))).toBe(true)
    })

    it('should handle exact pattern', async () => {
      const result = await aggregator.queryByPattern('worker-task', {})

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].functionId).toBe('worker-task')
    })
  })

  describe('queryLastHour()', () => {
    it('should query logs from the last hour', async () => {
      const now = Date.now()
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Recent', timestamp: now - 30 * 60 * 1000 })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Old', timestamp: now - 2 * 60 * 60 * 1000 })

      const result = await aggregator.queryLastHour('func-1')

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].message).toBe('Recent')
    })
  })

  describe('queryWithCount()', () => {
    it('should return total count with query results', async () => {
      for (let i = 0; i < 150; i++) {
        await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: `Log ${i}` })
      }

      const result = await aggregator.queryWithCount({ functionId: 'func-1', limit: 50 })

      expect(result.entries).toHaveLength(50)
      expect(result.total).toBe(150)
    })
  })

  // ==========================================================================
  // FUNCTION MANAGEMENT
  // ==========================================================================

  describe('listFunctions()', () => {
    it('should list all functions with logs', async () => {
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Test' })
      await aggregator.captureLog({ functionId: 'func-2', level: 'info', message: 'Test' })
      await aggregator.captureLog({ functionId: 'func-3', level: 'info', message: 'Test' })

      const functions = await aggregator.listFunctions()

      expect(functions).toContain('func-1')
      expect(functions).toContain('func-2')
      expect(functions).toContain('func-3')
    })

    it('should return empty array when no logs', async () => {
      const functions = await aggregator.listFunctions()
      expect(functions).toHaveLength(0)
    })
  })

  describe('countByLevel()', () => {
    it('should count logs by level for a function', async () => {
      await aggregator.captureLog({ functionId: 'func-1', level: 'debug', message: 'Debug 1' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Info 1' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Info 2' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'warn', message: 'Warn 1' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'error', message: 'Error 1' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'error', message: 'Error 2' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'error', message: 'Error 3' })

      const counts = await aggregator.countByLevel('func-1')

      expect(counts.debug).toBe(1)
      expect(counts.info).toBe(2)
      expect(counts.warn).toBe(1)
      expect(counts.error).toBe(3)
      expect(counts.fatal).toBe(0)
    })

    it('should return zero counts for non-existent function', async () => {
      const counts = await aggregator.countByLevel('non-existent')

      expect(counts.debug).toBe(0)
      expect(counts.info).toBe(0)
      expect(counts.warn).toBe(0)
      expect(counts.error).toBe(0)
      expect(counts.fatal).toBe(0)
    })
  })

  describe('deleteLogs()', () => {
    it('should delete all logs for a function', async () => {
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Log 1' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Log 2' })
      await aggregator.captureLog({ functionId: 'func-2', level: 'info', message: 'Log 3' })

      await aggregator.deleteLogs('func-1')

      const func1Result = await aggregator.query({ functionId: 'func-1' })
      const func2Result = await aggregator.query({ functionId: 'func-2' })

      expect(func1Result.entries).toHaveLength(0)
      expect(func2Result.entries).toHaveLength(1)
    })
  })

  // ==========================================================================
  // SEARCH OPERATIONS
  // ==========================================================================

  describe('search()', () => {
    beforeEach(async () => {
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'User login successful' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'warn', message: 'User login failed' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Order processed', metadata: { orderId: '123' } })
      await aggregator.captureLog({ functionId: 'func-2', level: 'error', message: 'Database connection error' })
    })

    it('should search logs by message content', async () => {
      const result = await aggregator.search({ query: 'login' })

      expect(result.entries).toHaveLength(2)
    })

    it('should search case-insensitively', async () => {
      const result = await aggregator.search({ query: 'LOGIN', caseInsensitive: true })

      expect(result.entries).toHaveLength(2)
    })

    it('should search within specific function', async () => {
      const result = await aggregator.search({ query: 'error', functionId: 'func-2' })

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].functionId).toBe('func-2')
    })

    it('should search in metadata when enabled', async () => {
      const result = await aggregator.search({
        query: '123',
        searchMetadata: true,
      })

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].message).toBe('Order processed')
    })

    it('should support regex search', async () => {
      const result = await aggregator.search({ query: 'User.*successful', regex: true })

      expect(result.entries).toHaveLength(1)
    })

    it('should respect limit', async () => {
      const result = await aggregator.search({ query: 'User', limit: 1 })

      expect(result.entries).toHaveLength(1)
      expect(result.hasMore).toBe(true)
    })
  })

  describe('fullTextSearch()', () => {
    beforeEach(async () => {
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'user login user authentication' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'user logout' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'order processed' })
    })

    it('should rank results by relevance', async () => {
      const result = await aggregator.fullTextSearch({ query: 'user' })

      // First result should have 'user' twice
      expect(result.entries[0].message).toContain('user')
      expect(result.entries[0].score).toBeGreaterThan(result.entries[1].score!)
    })

    it('should support multi-term search', async () => {
      const result = await aggregator.fullTextSearch({ query: 'user login' })

      expect(result.entries).toHaveLength(2)
      // First result should have both terms
      expect(result.entries[0].score).toBeGreaterThan(result.entries[1].score!)
    })
  })

  describe('structuredQuery()', () => {
    beforeEach(async () => {
      await aggregator.captureLog({
        functionId: 'func-1',
        level: 'info',
        message: 'API request',
        metadata: { statusCode: 200, path: '/api/users' },
      })
      await aggregator.captureLog({
        functionId: 'func-1',
        level: 'error',
        message: 'API error',
        metadata: { statusCode: 500, path: '/api/posts' },
      })
    })

    it('should filter by equality condition', async () => {
      const result = await aggregator.structuredQuery({
        conditions: [{ field: 'level', operator: '=', value: 'error' }],
      })

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].level).toBe('error')
    })

    it('should filter by inequality condition', async () => {
      const result = await aggregator.structuredQuery({
        conditions: [{ field: 'level', operator: '!=', value: 'error' }],
      })

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].level).toBe('info')
    })

    it('should filter by metadata field', async () => {
      const result = await aggregator.structuredQuery({
        conditions: [{ field: 'metadata.statusCode', operator: '>=', value: 400 }],
      })

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].metadata?.statusCode).toBe(500)
    })

    it('should filter by contains condition', async () => {
      const result = await aggregator.structuredQuery({
        conditions: [{ field: 'message', operator: 'contains', value: 'request' }],
      })

      expect(result.entries).toHaveLength(1)
    })

    it('should filter by startsWith condition', async () => {
      const result = await aggregator.structuredQuery({
        conditions: [{ field: 'message', operator: 'startsWith', value: 'API' }],
      })

      expect(result.entries).toHaveLength(2)
    })

    it('should filter by endsWith condition', async () => {
      const result = await aggregator.structuredQuery({
        conditions: [{ field: 'message', operator: 'endsWith', value: 'error' }],
      })

      expect(result.entries).toHaveLength(1)
    })

    it('should combine multiple conditions', async () => {
      const result = await aggregator.structuredQuery({
        conditions: [
          { field: 'level', operator: '=', value: 'error' },
          { field: 'metadata.statusCode', operator: '>=', value: 500 },
        ],
      })

      expect(result.entries).toHaveLength(1)
    })
  })

  describe('aggregate()', () => {
    beforeEach(async () => {
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Log 1' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Log 2' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'error', message: 'Log 3' })
      await aggregator.captureLog({ functionId: 'func-2', level: 'info', message: 'Log 4' })
      await aggregator.captureLog({ functionId: 'func-2', level: 'error', message: 'Log 5' })
      await aggregator.captureLog({ functionId: 'func-2', level: 'fatal', message: 'Log 6' })
    })

    it('should aggregate by function ID', async () => {
      const result = await aggregator.aggregate({
        groupBy: 'functionId',
        metrics: ['count', 'errorRate'],
      })

      expect(result['func-1'].count).toBe(3)
      expect(result['func-1'].errorRate).toBeCloseTo(1 / 3)
      expect(result['func-2'].count).toBe(3)
      expect(result['func-2'].errorRate).toBeCloseTo(2 / 3)
    })

    it('should aggregate by level', async () => {
      const result = await aggregator.aggregate({
        groupBy: 'level',
        metrics: ['count'],
      })

      expect(result['info'].count).toBe(3)
      expect(result['error'].count).toBe(2)
      expect(result['fatal'].count).toBe(1)
    })
  })

  describe('suggestSearchTerms()', () => {
    beforeEach(async () => {
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'user login successful' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'user logout completed' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'order processed' })
    })

    it('should suggest terms based on prefix', async () => {
      const suggestions = await aggregator.suggestSearchTerms('us')

      expect(suggestions).toContain('user')
    })

    it('should limit suggestions to 10', async () => {
      // Add many unique words
      for (let i = 0; i < 20; i++) {
        await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: `test${i} message` })
      }

      const suggestions = await aggregator.suggestSearchTerms('test')

      expect(suggestions.length).toBeLessThanOrEqual(10)
    })
  })

  // ==========================================================================
  // RETENTION OPERATIONS
  // ==========================================================================

  describe('applyRetention()', () => {
    it('should delete logs older than maxAge', async () => {
      const now = Date.now()
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Old', timestamp: now - 2 * 60 * 60 * 1000 })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Recent', timestamp: now })

      const deleted = await aggregator.applyRetention({ maxAge: 60 * 60 * 1000 }) // 1 hour

      expect(deleted).toBe(1)

      const result = await aggregator.query({ functionId: 'func-1' })
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].message).toBe('Recent')
    })

    it('should keep only maxCount most recent logs', async () => {
      for (let i = 0; i < 10; i++) {
        await aggregator.captureLog({
          functionId: 'func-1',
          level: 'info',
          message: `Log ${i}`,
          timestamp: Date.now() + i,
        })
      }

      const deleted = await aggregator.applyRetention({ maxCount: 5 })

      expect(deleted).toBe(5)

      const result = await aggregator.query({ functionId: 'func-1' })
      expect(result.entries).toHaveLength(5)
    })

    it('should apply retention per function when perFunction is true', async () => {
      for (let i = 0; i < 10; i++) {
        await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: `Log ${i}`, timestamp: Date.now() + i })
        await aggregator.captureLog({ functionId: 'func-2', level: 'info', message: `Log ${i}`, timestamp: Date.now() + i })
      }

      await aggregator.applyRetention({ maxCount: 5, perFunction: true })

      const func1Result = await aggregator.query({ functionId: 'func-1' })
      const func2Result = await aggregator.query({ functionId: 'func-2' })

      expect(func1Result.entries).toHaveLength(5)
      expect(func2Result.entries).toHaveLength(5)
    })

    it('should apply level-specific policies', async () => {
      const now = Date.now()
      await aggregator.captureLog({ functionId: 'func-1', level: 'debug', message: 'Debug', timestamp: now - 2 * 60 * 60 * 1000 })
      await aggregator.captureLog({ functionId: 'func-1', level: 'error', message: 'Error', timestamp: now - 2 * 60 * 60 * 1000 })

      await aggregator.applyRetention({
        levelPolicies: {
          debug: { maxAge: 60 * 60 * 1000 }, // 1 hour
          info: { maxAge: 24 * 60 * 60 * 1000 },
          warn: { maxAge: 24 * 60 * 60 * 1000 },
          error: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
          fatal: { maxAge: 7 * 24 * 60 * 60 * 1000 },
        },
      })

      const result = await aggregator.query({ functionId: 'func-1' })
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].level).toBe('error')
    })
  })

  describe('scheduleRetention()', () => {
    it('should run retention on interval', async () => {
      await aggregator.captureLog({
        functionId: 'func-1',
        level: 'info',
        message: 'Test',
        timestamp: Date.now() - 2 * 60 * 60 * 1000,
      })

      const callback = vi.fn()
      aggregator.scheduleRetention({ maxAge: 60 * 60 * 1000, interval: 1000 }, callback)

      vi.advanceTimersByTime(1000)

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should cancel previous scheduled retention', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      aggregator.scheduleRetention({ maxAge: 60 * 60 * 1000, interval: 1000 }, callback1)
      aggregator.scheduleRetention({ maxAge: 60 * 60 * 1000, interval: 1000 }, callback2)

      vi.advanceTimersByTime(1000)

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalledTimes(1)
    })
  })

  describe('getRetentionStats()', () => {
    it('should return retention statistics', async () => {
      const now = Date.now()
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Oldest', timestamp: now - 1000 })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Newest', timestamp: now })

      const stats = await aggregator.getRetentionStats()

      expect(stats.totalLogs).toBe(2)
      expect(stats.oldestTimestamp).toBe(now - 1000)
      expect(stats.newestTimestamp).toBe(now)
    })

    it('should return empty stats when no logs', async () => {
      const stats = await aggregator.getRetentionStats()

      expect(stats.totalLogs).toBe(0)
      expect(stats.oldestTimestamp).toBeUndefined()
      expect(stats.newestTimestamp).toBe(0)
    })
  })

  describe('estimateStorageUsage()', () => {
    it('should estimate storage usage', async () => {
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Test message' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Another message' })

      const usage = await aggregator.estimateStorageUsage()

      expect(usage.logCount).toBe(2)
      expect(usage.totalBytes).toBeGreaterThan(0)
      expect(usage.avgBytesPerLog).toBe(usage.totalBytes / 2)
    })

    it('should return zero for empty aggregator', async () => {
      const usage = await aggregator.estimateStorageUsage()

      expect(usage.logCount).toBe(0)
      expect(usage.totalBytes).toBe(0)
      expect(usage.avgBytesPerLog).toBe(0)
    })
  })

  // ==========================================================================
  // EXPORT OPERATIONS
  // ==========================================================================

  describe('exportJsonLines()', () => {
    it('should export logs in JSON Lines format', async () => {
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Log 1' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'warn', message: 'Log 2' })

      const jsonLines = await aggregator.exportJsonLines('func-1')
      const lines = jsonLines.split('\n')

      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[0]).message).toBe('Log 1')
      expect(JSON.parse(lines[1]).message).toBe('Log 2')
    })

    it('should return empty string for non-existent function', async () => {
      const jsonLines = await aggregator.exportJsonLines('non-existent')
      expect(jsonLines).toBe('')
    })
  })

  describe('exportSearchResults()', () => {
    beforeEach(async () => {
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'User login', requestId: 'req-1' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'warn', message: 'User warning' })
    })

    it('should export search results as CSV', async () => {
      const csv = await aggregator.exportSearchResults({ query: 'User', format: 'csv' })
      const lines = csv.split('\n')

      expect(lines[0]).toBe('timestamp,functionId,level,message,requestId')
      expect(lines).toHaveLength(3) // header + 2 results
    })

    it('should export search results as JSON', async () => {
      const json = await aggregator.exportSearchResults({ query: 'User', format: 'json' })
      const entries = JSON.parse(json)

      expect(entries).toHaveLength(2)
    })

    it('should escape quotes in CSV export', async () => {
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Message with "quotes"' })

      const csv = await aggregator.exportSearchResults({ query: 'quotes', format: 'csv' })

      expect(csv).toContain('""quotes""')
    })
  })

  // ==========================================================================
  // STREAMING OPERATIONS
  // ==========================================================================

  describe('handleWebSocketStream()', () => {
    it('should accept WebSocket connection', async () => {
      const ws = createMockWebSocket() as unknown as WebSocket

      await aggregator.handleWebSocketStream(ws, { functionId: 'func-1' })

      expect((ws as { accept: () => void }).accept).toHaveBeenCalled()
    })

    it('should send history when tail is specified', async () => {
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Log 1' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Log 2' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Log 3' })

      const ws = createMockWebSocket() as unknown as WebSocket

      await aggregator.handleWebSocketStream(ws, { functionId: 'func-1', tail: 2 })

      expect(ws.send).toHaveBeenCalled()
      const sentData = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0])
      expect(sentData.type).toBe('history')
      expect(sentData.entries).toHaveLength(2)
    })

    it('should send heartbeat at specified interval', async () => {
      const ws = createMockWebSocket() as unknown as WebSocket

      await aggregator.handleWebSocketStream(ws, { functionId: 'func-1', heartbeat: 1000 })

      vi.advanceTimersByTime(1000)

      expect(ws.send).toHaveBeenCalled()
      const sentData = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0])
      expect(sentData.type).toBe('heartbeat')
      expect(sentData.timestamp).toBeDefined()
    })

    it('should notify subscribers when new logs are captured', async () => {
      const ws = createMockWebSocket() as unknown as WebSocket
      const options = { functionId: 'func-1' }

      await aggregator.handleWebSocketStream(ws, options)

      // Clear the accept call
      ;(ws.send as ReturnType<typeof vi.fn>).mockClear()

      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'New log' })

      expect(ws.send).toHaveBeenCalled()
      const sentData = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0])
      expect(sentData.type).toBe('log')
      expect(sentData.entry.message).toBe('New log')
    })

    it('should filter notifications by level', async () => {
      const ws = createMockWebSocket() as unknown as WebSocket
      const options = { functionId: 'func-1', levels: ['error', 'fatal'] as const }

      await aggregator.handleWebSocketStream(ws, options)

      // Clear the accept call
      ;(ws.send as ReturnType<typeof vi.fn>).mockClear()

      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Info log' })
      expect(ws.send).not.toHaveBeenCalled()

      await aggregator.captureLog({ functionId: 'func-1', level: 'error', message: 'Error log' })
      expect(ws.send).toHaveBeenCalled()
    })

    it('should handle lastEventId for reconnection', async () => {
      const log1 = await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Log 1' })
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'Log 2' })

      const ws = createMockWebSocket() as unknown as WebSocket

      await aggregator.handleWebSocketStream(ws, { functionId: 'func-1', lastEventId: log1.id })

      expect(ws.send).toHaveBeenCalled()
      const sentData = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0])
      expect(sentData.type).toBe('history')
      expect(sentData.entries).toHaveLength(1)
      expect(sentData.entries[0].message).toBe('Log 2')
    })
  })

  describe('createSSEStream()', () => {
    it('should create a readable stream', async () => {
      const stream = await aggregator.createSSEStream('func-1', {})

      expect(stream).toBeInstanceOf(ReadableStream)
    })
  })

  describe('tail()', () => {
    it('should subscribe to log updates', async () => {
      const callback = vi.fn()

      await aggregator.tail('func-1', callback)
      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'New log' })

      expect(callback).toHaveBeenCalled()
      expect(callback.mock.calls[0][0].message).toBe('New log')
    })

    it('should return unsubscribe function', async () => {
      const callback = vi.fn()

      const unsubscribe = await aggregator.tail('func-1', callback)
      unsubscribe()

      await aggregator.captureLog({ functionId: 'func-1', level: 'info', message: 'New log' })

      expect(callback).not.toHaveBeenCalled()
    })

    it('should not call callback for different function', async () => {
      const callback = vi.fn()

      await aggregator.tail('func-1', callback)
      await aggregator.captureLog({ functionId: 'func-2', level: 'info', message: 'Other function' })

      expect(callback).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // DURABLE OBJECT INTEGRATION
  // ==========================================================================

  describe('getFunctionLogsDO()', () => {
    it('should return a factory function', () => {
      const factory = aggregator.getFunctionLogsDO()

      expect(typeof factory).toBe('function')
      expect(factory()).toBe(aggregator)
    })
  })
})
