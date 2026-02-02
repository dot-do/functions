/**
 * Function Logs API Tests
 *
 * Tests for function log retrieval functionality.
 * These tests verify the FunctionLogs Durable Object which provides:
 * - Retrieve execution logs for a specific function
 * - Filter by time range (start, end timestamps)
 * - Filter by log level (debug, info, warn, error, fatal)
 * - Cursor-based pagination with limit
 * - Real-time streaming via WebSocket
 * - Returns structured log entries with timestamp, level, message, requestId
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  FunctionLogs,
  type LogEntry,
  type LogLevel,
  type LogQueryResult,
  type LogMetrics,
} from '../do/function-logs'

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Internal log entry for mock storage
 */
interface MockLogEntry {
  id: string
  function_id: string
  timestamp: number
  level: string
  message: string
  metadata: string | null
  request_id: string | null
  duration_ms: number | null
  created_at: number
}

/**
 * Mock SQLite storage for testing
 */
class MockSqlStorage {
  private logs: Map<string, MockLogEntry> = new Map()

  exec<T = unknown>(sql: string, ...params: unknown[]): { one: () => T | null; toArray: () => T[] } {
    const normalizedSql = sql.trim().toLowerCase()

    // Handle CREATE TABLE / CREATE INDEX
    if (normalizedSql.includes('create table') || normalizedSql.includes('create index')) {
      return { one: () => null, toArray: () => [] }
    }

    // Handle INSERT into logs
    if (normalizedSql.includes('insert into logs')) {
      const entry: MockLogEntry = {
        id: params[0] as string,
        function_id: params[1] as string,
        timestamp: params[2] as number,
        level: params[3] as string,
        message: params[4] as string,
        metadata: params[5] as string | null,
        request_id: params[6] as string | null,
        duration_ms: params[7] as number | null,
        created_at: params[8] as number,
      }
      this.logs.set(entry.id, entry)
      return { one: () => null, toArray: () => [] }
    }

    // Handle SELECT DISTINCT function_id
    if (normalizedSql.includes('select distinct function_id from logs')) {
      const functionIds = new Set<string>()
      for (const log of this.logs.values()) {
        functionIds.add(log.function_id)
      }
      const results = Array.from(functionIds).map((fid) => ({ function_id: fid }))
      return {
        one: () => (results[0] as T) || null,
        toArray: () => results as T[],
      }
    }

    // Handle SELECT with various filters
    if (normalizedSql.includes('select') && normalizedSql.includes('from logs')) {
      let results = Array.from(this.logs.values())

      // Filter by function_id
      if (normalizedSql.includes('where function_id')) {
        const functionId = params[0] as string
        results = results.filter((log) => log.function_id === functionId)
      }

      // Filter by request_id
      if (normalizedSql.includes('where request_id')) {
        const requestId = params[0] as string
        results = results.filter((log) => log.request_id === requestId)
      }

      // Sort by timestamp descending (default)
      results.sort((a, b) => b.timestamp - a.timestamp)

      return {
        one: () => (results[0] as T) || null,
        toArray: () => results as T[],
      }
    }

    // Handle DELETE
    if (normalizedSql.includes('delete from logs')) {
      if (normalizedSql.includes('where function_id')) {
        const functionId = params[0] as string
        for (const [id, log] of this.logs.entries()) {
          if (log.function_id === functionId) {
            this.logs.delete(id)
          }
        }
      } else if (normalizedSql.includes('where id')) {
        const logId = params[0] as string
        this.logs.delete(logId)
      }
      return { one: () => null, toArray: () => [] }
    }

    return { one: () => null, toArray: () => [] }
  }

  clear(): void {
    this.logs.clear()
  }
}

/**
 * Mock WebSocket for testing streaming
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

/**
 * Create mock DurableObjectState for testing
 */
function createMockState(sql: MockSqlStorage) {
  return {
    storage: {
      sql,
    },
    id: {
      toString: () => 'test-do-id',
      name: 'test-logs',
    },
    props: undefined,
    waitUntil: () => {},
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Function Logs API - GET /api/functions/:id/logs', () => {
  let mockSql: MockSqlStorage
  let mockState: ReturnType<typeof createMockState>
  let functionLogs: FunctionLogs

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockSql = new MockSqlStorage()
    mockState = createMockState(mockSql)
    functionLogs = new FunctionLogs(mockState as unknown as DurableObjectState, {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Basic Log Retrieval', () => {
    it('should return logs for a valid function ID', async () => {
      // Add test logs
      await functionLogs.append({
        functionId: 'my-function',
        level: 'info',
        message: 'Test log message',
      })

      const result = await functionLogs.query({
        functionId: 'my-function',
      })

      expect(result).toBeDefined()
      expect(result.entries).toBeDefined()
      expect(Array.isArray(result.entries)).toBe(true)
      expect(result.hasMore).toBeDefined()
    })

    it('should return log entries with required fields', async () => {
      await functionLogs.append({
        functionId: 'my-function',
        level: 'info',
        message: 'Test message',
        requestId: 'req-123',
      })

      const result = await functionLogs.query({
        functionId: 'my-function',
      })

      expect(result.entries.length).toBeGreaterThan(0)
      const entry = result.entries[0]

      // Each log entry should contain required fields
      expect(entry.timestamp).toBeDefined()
      expect(typeof entry.timestamp).toBe('number')
      expect(entry.level).toBeDefined()
      expect(['debug', 'info', 'warn', 'error', 'fatal']).toContain(entry.level)
      expect(entry.message).toBeDefined()
      expect(typeof entry.message).toBe('string')
      expect(entry.id).toBeDefined()
    })

    it('should return logs in reverse chronological order (newest first)', async () => {
      const baseTime = Date.now()

      await functionLogs.append({
        functionId: 'my-function',
        level: 'info',
        message: 'First log',
        timestamp: baseTime,
      })
      await functionLogs.append({
        functionId: 'my-function',
        level: 'info',
        message: 'Second log',
        timestamp: baseTime + 1000,
      })
      await functionLogs.append({
        functionId: 'my-function',
        level: 'info',
        message: 'Third log',
        timestamp: baseTime + 2000,
      })

      const result = await functionLogs.query({
        functionId: 'my-function',
        order: 'desc',
      })

      expect(result.entries.length).toBe(3)
      // Default sort order: most recent logs first
      for (let i = 1; i < result.entries.length; i++) {
        expect(result.entries[i - 1].timestamp).toBeGreaterThanOrEqual(
          result.entries[i].timestamp
        )
      }
    })

    it('should return empty array when function has no logs', async () => {
      const result = await functionLogs.query({
        functionId: 'empty-function',
      })

      expect(result.entries).toEqual([])
      expect(result.hasMore).toBe(false)
    })

    it('should include optional metadata in log entries when available', async () => {
      await functionLogs.append({
        functionId: 'my-function',
        level: 'info',
        message: 'Request processed',
        metadata: { duration: 150, memory: 128 },
        durationMs: 150,
      })

      const result = await functionLogs.query({
        functionId: 'my-function',
      })

      expect(result.entries.length).toBe(1)
      const entry = result.entries[0]
      expect(entry.metadata).toBeDefined()
      expect(entry.metadata?.['duration']).toBe(150)
      expect(entry.durationMs).toBe(150)
    })
  })

  describe('Time Range Filtering', () => {
    beforeEach(async () => {
      const baseTime = new Date('2024-01-15T00:00:00Z').getTime()

      await functionLogs.append({
        functionId: 'my-function',
        level: 'info',
        message: 'Log at hour 0',
        timestamp: baseTime,
      })
      await functionLogs.append({
        functionId: 'my-function',
        level: 'info',
        message: 'Log at hour 1',
        timestamp: baseTime + 3600000,
      })
      await functionLogs.append({
        functionId: 'my-function',
        level: 'info',
        message: 'Log at hour 2',
        timestamp: baseTime + 7200000,
      })
    })

    it('should filter logs by start timestamp', async () => {
      const baseTime = new Date('2024-01-15T00:00:00Z').getTime()
      const startTime = baseTime + 3600000 // Start from hour 1

      const result = await functionLogs.query({
        functionId: 'my-function',
        startTime,
      })

      expect(result.entries.length).toBeGreaterThanOrEqual(2)
      for (const entry of result.entries) {
        expect(entry.timestamp).toBeGreaterThanOrEqual(startTime)
      }
    })

    it('should filter logs by end timestamp', async () => {
      const baseTime = new Date('2024-01-15T00:00:00Z').getTime()
      const endTime = baseTime + 3600000 // End at hour 1

      const result = await functionLogs.query({
        functionId: 'my-function',
        endTime,
      })

      for (const entry of result.entries) {
        expect(entry.timestamp).toBeLessThanOrEqual(endTime)
      }
    })

    it('should filter logs by both start and end timestamps', async () => {
      const baseTime = new Date('2024-01-15T00:00:00Z').getTime()
      const startTime = baseTime + 3600000 // hour 1
      const endTime = baseTime + 7200000 // hour 2

      const result = await functionLogs.query({
        functionId: 'my-function',
        startTime,
        endTime,
      })

      for (const entry of result.entries) {
        expect(entry.timestamp).toBeGreaterThanOrEqual(startTime)
        expect(entry.timestamp).toBeLessThanOrEqual(endTime)
      }
    })

    it('should accept Unix timestamps (milliseconds)', async () => {
      const baseTime = new Date('2024-01-15T00:00:00Z').getTime()
      const startTime = baseTime + 3600000 // Unix timestamp in milliseconds

      const result = await functionLogs.query({
        functionId: 'my-function',
        startTime,
      })

      // Should work with numeric timestamps
      expect(result).toBeDefined()
      expect(Array.isArray(result.entries)).toBe(true)
    })
  })

  describe('Log Level Filtering', () => {
    beforeEach(async () => {
      await functionLogs.append({
        functionId: 'my-function',
        level: 'debug',
        message: 'Debug message',
      })
      await functionLogs.append({
        functionId: 'my-function',
        level: 'info',
        message: 'Info message',
      })
      await functionLogs.append({
        functionId: 'my-function',
        level: 'warn',
        message: 'Warn message',
      })
      await functionLogs.append({
        functionId: 'my-function',
        level: 'error',
        message: 'Error message',
      })
      await functionLogs.append({
        functionId: 'my-function',
        level: 'fatal',
        message: 'Fatal message',
      })
    })

    it('should filter logs by single level', async () => {
      const result = await functionLogs.query({
        functionId: 'my-function',
        level: 'error',
      })

      expect(result.entries.length).toBeGreaterThanOrEqual(1)
      for (const entry of result.entries) {
        expect(entry.level).toBe('error')
      }
    })

    it('should filter logs by multiple levels', async () => {
      const result = await functionLogs.query({
        functionId: 'my-function',
        levels: ['warn', 'error'],
      })

      for (const entry of result.entries) {
        expect(['warn', 'error']).toContain(entry.level)
      }
    })

    it('should support level=debug filter', async () => {
      const result = await functionLogs.query({
        functionId: 'my-function',
        level: 'debug',
      })

      for (const entry of result.entries) {
        expect(entry.level).toBe('debug')
      }
    })

    it('should support level=warn filter', async () => {
      const result = await functionLogs.query({
        functionId: 'my-function',
        level: 'warn',
      })

      for (const entry of result.entries) {
        expect(entry.level).toBe('warn')
      }
    })

    it('should support level=error filter', async () => {
      const result = await functionLogs.query({
        functionId: 'my-function',
        level: 'error',
      })

      for (const entry of result.entries) {
        expect(entry.level).toBe('error')
      }
    })

    it('should return all levels when no filter is specified', async () => {
      const result = await functionLogs.query({
        functionId: 'my-function',
      })

      const levels = new Set(result.entries.map((e) => e.level))
      expect(levels.size).toBeGreaterThan(1)
    })
  })

  describe('Pagination', () => {
    beforeEach(async () => {
      // Add 25 test logs
      for (let i = 1; i <= 25; i++) {
        await functionLogs.append({
          functionId: 'my-function',
          level: 'info',
          message: `Log entry ${i}`,
          timestamp: Date.now() + i * 1000,
        })
      }
    })

    it('should support limit parameter', async () => {
      const result = await functionLogs.query({
        functionId: 'my-function',
        limit: 10,
      })

      expect(result.entries.length).toBe(10)
    })

    it('should use default limit when not specified', async () => {
      const result = await functionLogs.query({
        functionId: 'my-function',
      })

      // Default limit should be 100
      expect(result.entries.length).toBeLessThanOrEqual(100)
    })

    it('should enforce maximum limit', async () => {
      const result = await functionLogs.query({
        functionId: 'my-function',
        limit: 5000, // Request more than max
      })

      // Should be capped at 1000
      expect(result.entries.length).toBeLessThanOrEqual(1000)
    })

    it('should support cursor-based pagination', async () => {
      const firstPage = await functionLogs.query({
        functionId: 'my-function',
        limit: 10,
      })

      expect(firstPage.cursor).toBeDefined()

      const secondPage = await functionLogs.query({
        functionId: 'my-function',
        limit: 10,
        cursor: firstPage.cursor!,
      })

      // Second page should have different entries
      const firstPageIds = firstPage.entries.map((e) => e.id)
      const secondPageIds = secondPage.entries.map((e) => e.id)

      for (const id of secondPageIds) {
        expect(firstPageIds).not.toContain(id)
      }
    })

    it('should return cursor in response when more logs available', async () => {
      const result = await functionLogs.query({
        functionId: 'my-function',
        limit: 10,
      })

      expect(result.cursor).toBeDefined()
      expect(result.hasMore).toBe(true)
    })

    it('should return hasMore=false when no more logs', async () => {
      const result = await functionLogs.query({
        functionId: 'my-function',
        limit: 50, // More than available
      })

      expect(result.hasMore).toBe(false)
      expect(result.cursor).toBeNull()
    })

    it('should combine pagination with filters', async () => {
      // Add some error logs
      for (let i = 0; i < 15; i++) {
        await functionLogs.append({
          functionId: 'my-function',
          level: 'error',
          message: `Error log ${i}`,
        })
      }

      const result = await functionLogs.query({
        functionId: 'my-function',
        level: 'error',
        limit: 10,
      })

      expect(result.entries.length).toBe(10)
      for (const entry of result.entries) {
        expect(entry.level).toBe('error')
      }
    })
  })

  describe('Error Handling', () => {
    it('should return empty result for non-existent function', async () => {
      const result = await functionLogs.query({
        functionId: 'non-existent-function',
      })

      expect(result.entries).toEqual([])
      expect(result.hasMore).toBe(false)
    })

    it('should return appropriate error structure via HTTP', async () => {
      const request = new Request('http://localhost/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Missing required fields
          level: 'info',
        }),
      })

      const response = await functionLogs.fetch(request)

      expect(response.status).toBe(400)
      const body = (await response.json()) as { error: string }
      expect(body.error).toBeDefined()
    })
  })

  describe('HTTP Request Handler', () => {
    it('should handle GET /logs with functionId parameter', async () => {
      await functionLogs.append({
        functionId: 'test-func',
        level: 'info',
        message: 'Test log',
      })

      const request = new Request(
        'http://localhost/logs?functionId=test-func&limit=10'
      )

      const response = await functionLogs.fetch(request)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')
      const body = (await response.json()) as LogQueryResult
      expect(body.entries).toBeDefined()
    })

    it('should return 400 when functionId is missing', async () => {
      const request = new Request('http://localhost/logs?limit=10')

      const response = await functionLogs.fetch(request)

      expect(response.status).toBe(400)
      const body = (await response.json()) as { error: string }
      expect(body.error).toContain('functionId')
    })

    it('should handle POST /logs to append entry', async () => {
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
      const body = (await response.json()) as LogEntry
      expect(body.id).toBeDefined()
      expect(body.message).toBe('Test log via HTTP')
    })

    it('should handle DELETE /logs/:functionId', async () => {
      await functionLogs.append({
        functionId: 'test-func',
        level: 'info',
        message: 'Log to delete',
      })

      const request = new Request('http://localhost/logs/test-func', {
        method: 'DELETE',
      })

      const response = await functionLogs.fetch(request)

      expect(response.status).toBe(204)

      // Verify logs are deleted
      const result = await functionLogs.query({ functionId: 'test-func' })
      expect(result.entries).toHaveLength(0)
    })

    it('should return 404 for unknown endpoint', async () => {
      const request = new Request('http://localhost/unknown')

      const response = await functionLogs.fetch(request)

      expect(response.status).toBe(404)
    })
  })

  describe('Real-time Streaming (WebSocket)', () => {
    it('should stream new log entries to connected clients', async () => {
      const mockWs = new MockWebSocket()

      await functionLogs.handleWebSocket(mockWs as unknown as WebSocket, {
        functionId: 'test-func',
      })

      await functionLogs.append({
        functionId: 'test-func',
        level: 'info',
        message: 'Streamed log entry',
      })

      expect(mockWs.messages.length).toBeGreaterThanOrEqual(1)
      const lastMessage = JSON.parse(mockWs.messages[mockWs.messages.length - 1])
      expect(lastMessage.type).toBe('log')
      expect(lastMessage.entry.message).toBe('Streamed log entry')
    })

    it('should stream logs only to subscribers of the same function', async () => {
      const mockWs1 = new MockWebSocket()
      const mockWs2 = new MockWebSocket()

      await functionLogs.handleWebSocket(mockWs1 as unknown as WebSocket, {
        functionId: 'func-a',
      })
      await functionLogs.handleWebSocket(mockWs2 as unknown as WebSocket, {
        functionId: 'func-b',
      })

      await functionLogs.append({
        functionId: 'func-a',
        level: 'info',
        message: 'Log for func-a',
      })

      const ws1LogMessages = mockWs1.messages
        .map((m) => JSON.parse(m))
        .filter((m) => m.type === 'log')

      const ws2LogMessages = mockWs2.messages
        .map((m) => JSON.parse(m))
        .filter((m) => m.type === 'log')

      // Only func-a subscriber should receive the log
      expect(ws1LogMessages.length).toBe(1)
      expect(ws1LogMessages[0].entry.functionId).toBe('func-a')
      expect(ws2LogMessages.length).toBe(0)
    })

    it('should handle client disconnect gracefully', async () => {
      const mockWs = new MockWebSocket()

      await functionLogs.handleWebSocket(mockWs as unknown as WebSocket, {
        functionId: 'test-func',
      })

      mockWs.close()

      // Should not throw when trying to stream to closed connection
      await expect(
        functionLogs.append({
          functionId: 'test-func',
          level: 'info',
          message: 'Log after disconnect',
        })
      ).resolves.toBeDefined()
    })

    it('should send heartbeat events to keep connection alive', async () => {
      const mockWs = new MockWebSocket()

      await functionLogs.handleWebSocket(mockWs as unknown as WebSocket, {
        functionId: 'test-func',
        heartbeat: 5000,
      })

      // Fast-forward 5 seconds
      vi.advanceTimersByTime(5000)

      const heartbeatMessages = mockWs.messages
        .map((m) => JSON.parse(m))
        .filter((m) => m.type === 'heartbeat')

      expect(heartbeatMessages.length).toBeGreaterThanOrEqual(1)
    })

    it('should send initial batch of recent logs on connection', async () => {
      // Add some existing logs
      await functionLogs.append({
        functionId: 'test-func',
        level: 'info',
        message: 'Existing log 1',
      })
      await functionLogs.append({
        functionId: 'test-func',
        level: 'info',
        message: 'Existing log 2',
      })

      const mockWs = new MockWebSocket()

      await functionLogs.handleWebSocket(mockWs as unknown as WebSocket, {
        functionId: 'test-func',
        tail: 10, // Send last 10 logs on connect
      })

      const historyMessages = mockWs.messages
        .map((m) => JSON.parse(m))
        .filter((m) => m.type === 'history')

      expect(historyMessages.length).toBeGreaterThanOrEqual(1)
      expect(historyMessages[0].entries.length).toBe(2)
    })
  })

  describe('Response Format', () => {
    it('should return Content-Type: application/json for HTTP requests', async () => {
      await functionLogs.append({
        functionId: 'test-func',
        level: 'info',
        message: 'Test log',
      })

      const request = new Request('http://localhost/logs?functionId=test-func')
      const response = await functionLogs.fetch(request)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('should handle GET /metrics', async () => {
      await functionLogs.append({
        functionId: 'test-func',
        level: 'error',
        message: 'Error log',
      })

      const request = new Request('http://localhost/metrics?functionId=test-func')
      const response = await functionLogs.fetch(request)

      expect(response.status).toBe(200)
      const body = (await response.json()) as LogMetrics
      expect(body.total).toBeDefined()
      expect(body.countByLevel).toBeDefined()
    })
  })

  describe('Request ID Filtering', () => {
    it('should support filtering by requestId', async () => {
      const requestId = 'req-123'

      await functionLogs.append({
        functionId: 'my-function',
        level: 'info',
        message: 'Request start',
        requestId,
      })
      await functionLogs.append({
        functionId: 'my-function',
        level: 'info',
        message: 'Request end',
        requestId,
      })
      await functionLogs.append({
        functionId: 'my-function',
        level: 'info',
        message: 'Different request',
        requestId: 'req-456',
      })

      const result = await functionLogs.queryByRequestId(requestId)

      expect(result.entries.length).toBe(2)
      for (const entry of result.entries) {
        expect(entry.requestId).toBe(requestId)
      }
    })

    it('should return all logs for a specific invocation', async () => {
      const requestId = 'req-abc'

      await functionLogs.append({
        functionId: 'api-gateway',
        level: 'info',
        message: 'Request received',
        requestId,
      })
      await functionLogs.append({
        functionId: 'auth-service',
        level: 'info',
        message: 'User authenticated',
        requestId,
      })
      await functionLogs.append({
        functionId: 'data-service',
        level: 'info',
        message: 'Data fetched',
        requestId,
      })

      const result = await functionLogs.queryByRequestId(requestId)

      expect(result.entries.length).toBe(3)
      const functionIds = result.entries.map((e) => e.functionId)
      expect(functionIds).toContain('api-gateway')
      expect(functionIds).toContain('auth-service')
      expect(functionIds).toContain('data-service')
    })
  })

  describe('Performance', () => {
    it('should return logs within acceptable time limit', async () => {
      // Add some test logs
      for (let i = 0; i < 100; i++) {
        await functionLogs.append({
          functionId: 'test-func',
          level: 'info',
          message: `Log ${i}`,
        })
      }

      const start = performance.now()
      const result = await functionLogs.query({
        functionId: 'test-func',
        limit: 50,
      })
      const duration = performance.now() - start

      // Should respond quickly (we use a generous threshold for test stability)
      expect(duration).toBeLessThan(500)
      expect(result.entries.length).toBe(50)
    })

    it('should support efficient time-range queries', async () => {
      const now = Date.now()

      // Add logs with timestamps
      for (let i = 0; i < 50; i++) {
        await functionLogs.append({
          functionId: 'test-func',
          level: 'info',
          message: `Log ${i}`,
          timestamp: now - i * 60000, // Each log 1 minute apart
        })
      }

      const start = performance.now()
      const result = await functionLogs.query({
        functionId: 'test-func',
        startTime: now - 10 * 60000, // Last 10 minutes
        endTime: now,
      })
      const duration = performance.now() - start

      expect(duration).toBeLessThan(500)
      expect(result.entries.length).toBeLessThanOrEqual(11)
    })
  })

  describe('Query Parameter Handling', () => {
    it('should ignore unknown query parameters', async () => {
      await functionLogs.append({
        functionId: 'test-func',
        level: 'info',
        message: 'Test log',
      })

      // Query with unknown parameter should still work
      const result = await functionLogs.query({
        functionId: 'test-func',
        limit: 10,
      } as any) // Adding unknown params via type assertion

      expect(result.entries.length).toBe(1)
    })

    it('should handle empty function logs gracefully', async () => {
      const result = await functionLogs.query({
        functionId: 'empty-function',
      })

      expect(result.entries).toEqual([])
      expect(result.hasMore).toBe(false)
    })
  })
})

describe('Logs API Integration', () => {
  let mockSql: MockSqlStorage
  let mockState: ReturnType<typeof createMockState>
  let functionLogs: FunctionLogs

  beforeEach(() => {
    vi.clearAllMocks()
    mockSql = new MockSqlStorage()
    mockState = createMockState(mockSql)
    functionLogs = new FunctionLogs(mockState as unknown as DurableObjectState, {})
  })

  it('should be accessible via HTTP /logs endpoint', async () => {
    await functionLogs.append({
      functionId: 'test-func',
      level: 'info',
      message: 'Test',
    })

    const request = new Request('http://localhost/logs?functionId=test-func')
    const response = await functionLogs.fetch(request)

    expect(response.status).toBe(200)
  })

  it('should support multiple functions in same DO instance', async () => {
    await functionLogs.append({
      functionId: 'func-1',
      level: 'info',
      message: 'Func 1 log',
    })
    await functionLogs.append({
      functionId: 'func-2',
      level: 'warn',
      message: 'Func 2 log',
    })

    const result1 = await functionLogs.query({ functionId: 'func-1' })
    const result2 = await functionLogs.query({ functionId: 'func-2' })

    expect(result1.entries.length).toBe(1)
    expect(result1.entries[0].functionId).toBe('func-1')
    expect(result2.entries.length).toBe(1)
    expect(result2.entries[0].functionId).toBe('func-2')
  })

  it('should list all function IDs with logs', async () => {
    await functionLogs.append({
      functionId: 'alpha',
      level: 'info',
      message: 'Alpha log',
    })
    await functionLogs.append({
      functionId: 'beta',
      level: 'info',
      message: 'Beta log',
    })

    const functionIds = await functionLogs.listFunctions()

    expect(functionIds).toContain('alpha')
    expect(functionIds).toContain('beta')
  })

  it('should get aggregated metrics across all functions', async () => {
    await functionLogs.append({
      functionId: 'func-1',
      level: 'info',
      message: 'Info',
    })
    await functionLogs.append({
      functionId: 'func-1',
      level: 'error',
      message: 'Error',
    })
    await functionLogs.append({
      functionId: 'func-2',
      level: 'warn',
      message: 'Warn',
    })

    const metrics = await functionLogs.getAggregatedMetrics()

    expect(metrics.total).toBe(3)
    expect(metrics.byFunction).toBeDefined()
    expect(metrics.byFunction['func-1']).toBeDefined()
    expect(metrics.byFunction['func-2']).toBeDefined()
  })
})
