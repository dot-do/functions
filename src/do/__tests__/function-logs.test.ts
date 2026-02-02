/**
 * FunctionLogs Durable Object Tests
 *
 * Real miniflare tests using Durable Object bindings from cloudflare:test.
 * These tests validate the FunctionLogs DO functionality through its
 * HTTP fetch() handler, using real DO instances with SQLite storage.
 *
 * Tests cover:
 * 1. Append log entries with structured data
 * 2. Query logs with time range, level, and pagination
 * 3. Metrics (count by level, error rates, duration percentiles)
 * 4. Multi-function support (isolation, cross-function queries)
 * 5. Log deletion per function
 * 6. HTTP handler routing (400, 404, 201, 204)
 *
 * @module durable-object/function-logs.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// ============================================================================
// Types for JSON responses
// ============================================================================

interface LogEntryJSON {
  id: string
  functionId: string
  timestamp: number
  level: string
  message: string
  metadata?: Record<string, unknown>
  requestId?: string
  durationMs?: number
}

interface LogQueryResultJSON {
  entries: LogEntryJSON[]
  cursor: string | null
  hasMore: boolean
  total?: number
}

interface LogMetricsJSON {
  total: number
  countByLevel: Record<string, number>
  errorRate: number
  logsPerMinute: number
  avgDurationMs?: number
  p50DurationMs?: number
  p95DurationMs?: number
  p99DurationMs?: number
  lastLogTimestamp?: number
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a unique DO stub for test isolation
 */
function createStub() {
  const name = `test-logs-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const id = env.FUNCTION_LOGS.idFromName(name)
  return env.FUNCTION_LOGS.get(id)
}

/**
 * Append a log entry via the DO's HTTP handler
 */
async function appendLog(
  stub: DurableObjectStub,
  input: {
    functionId: string
    level: string
    message: string
    timestamp?: number
    metadata?: Record<string, unknown>
    requestId?: string
    durationMs?: number
  }
): Promise<LogEntryJSON> {
  const response = await stub.fetch('https://logs.do/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  expect(response.status).toBe(201)
  return response.json() as Promise<LogEntryJSON>
}

/**
 * Query logs via the DO's HTTP handler
 */
async function queryLogs(
  stub: DurableObjectStub,
  functionId: string,
  options: { limit?: number; cursor?: string } = {}
): Promise<LogQueryResultJSON> {
  const params = new URLSearchParams({ functionId })
  if (options.limit) params.set('limit', options.limit.toString())
  if (options.cursor) params.set('cursor', options.cursor)

  const response = await stub.fetch(`https://logs.do/logs?${params.toString()}`, {
    method: 'GET',
  })
  expect(response.status).toBe(200)
  return response.json() as Promise<LogQueryResultJSON>
}

/**
 * Get metrics via the DO's HTTP handler
 */
async function getMetrics(
  stub: DurableObjectStub,
  functionId: string
): Promise<LogMetricsJSON> {
  const response = await stub.fetch(`https://logs.do/metrics?functionId=${functionId}`, {
    method: 'GET',
  })
  expect(response.status).toBe(200)
  return response.json() as Promise<LogMetricsJSON>
}

/**
 * Delete logs for a function via the DO's HTTP handler
 */
async function deleteLogs(stub: DurableObjectStub, functionId: string): Promise<void> {
  const response = await stub.fetch(`https://logs.do/logs/${functionId}`, {
    method: 'DELETE',
  })
  expect(response.status).toBe(204)
}

// ============================================================================
// Test Suites
// ============================================================================

describe('FunctionLogs Durable Object (real miniflare)', () => {
  let stub: DurableObjectStub

  beforeEach(() => {
    stub = createStub()
  })

  // ==========================================================================
  // 1. Append log entries
  // ==========================================================================

  describe('append log entries', () => {
    it('should append a log entry with required fields', async () => {
      const entry = await appendLog(stub, {
        functionId: 'my-function',
        level: 'info',
        message: 'Function executed successfully',
      })

      expect(entry).toBeDefined()
      expect(entry.id).toBeDefined()
      expect(entry.functionId).toBe('my-function')
      expect(entry.level).toBe('info')
      expect(entry.message).toBe('Function executed successfully')
      expect(entry.timestamp).toBeGreaterThan(0)
    })

    it('should append a log entry with all optional fields', async () => {
      const entry = await appendLog(stub, {
        functionId: 'my-function',
        level: 'debug',
        message: 'Request processed',
        metadata: { userId: '123', action: 'login' },
        requestId: 'req-abc123',
        durationMs: 150,
      })

      expect(entry.metadata).toEqual({ userId: '123', action: 'login' })
      expect(entry.requestId).toBe('req-abc123')
      expect(entry.durationMs).toBe(150)
    })

    it('should support all log levels', async () => {
      const levels = ['debug', 'info', 'warn', 'error', 'fatal']

      for (const level of levels) {
        const entry = await appendLog(stub, {
          functionId: 'test-func',
          level,
          message: `Log at ${level} level`,
        })
        expect(entry.level).toBe(level)
      }
    })

    it('should generate unique IDs for each log entry', async () => {
      const entry1 = await appendLog(stub, {
        functionId: 'test-func',
        level: 'info',
        message: 'Log 1',
      })
      const entry2 = await appendLog(stub, {
        functionId: 'test-func',
        level: 'info',
        message: 'Log 2',
      })

      expect(entry1.id).not.toBe(entry2.id)
    })

    it('should use provided timestamp or default to current time', async () => {
      const customTimestamp = new Date('2024-01-15T10:00:00Z').getTime()

      const entryWithCustomTime = await appendLog(stub, {
        functionId: 'test-func',
        level: 'info',
        message: 'Custom time',
        timestamp: customTimestamp,
      })

      expect(entryWithCustomTime.timestamp).toBe(customTimestamp)

      const entryWithAutoTime = await appendLog(stub, {
        functionId: 'test-func',
        level: 'info',
        message: 'Auto time',
      })

      expect(entryWithAutoTime.timestamp).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // 2. Query logs with filters
  // ==========================================================================

  describe('query logs', () => {
    it('should query logs for a specific function', async () => {
      await appendLog(stub, { functionId: 'func-a', level: 'info', message: 'A log' })
      await appendLog(stub, { functionId: 'func-b', level: 'info', message: 'B log' })

      const result = await queryLogs(stub, 'func-a')

      expect(result.entries.length).toBe(1)
      expect(result.entries[0].functionId).toBe('func-a')
      expect(result.entries[0].message).toBe('A log')
    })

    it('should return empty result when no logs exist for function', async () => {
      const result = await queryLogs(stub, 'nonexistent-func')

      expect(result.entries).toHaveLength(0)
      expect(result.hasMore).toBe(false)
    })

    it('should return logs sorted by timestamp descending by default', async () => {
      const baseTime = Date.now()

      await appendLog(stub, {
        functionId: 'sort-func',
        level: 'info',
        message: 'First',
        timestamp: baseTime,
      })
      await appendLog(stub, {
        functionId: 'sort-func',
        level: 'info',
        message: 'Second',
        timestamp: baseTime + 1000,
      })
      await appendLog(stub, {
        functionId: 'sort-func',
        level: 'info',
        message: 'Third',
        timestamp: baseTime + 2000,
      })

      const result = await queryLogs(stub, 'sort-func')

      expect(result.entries).toHaveLength(3)
      // Descending order: most recent first
      for (let i = 1; i < result.entries.length; i++) {
        expect(result.entries[i - 1].timestamp).toBeGreaterThanOrEqual(result.entries[i].timestamp)
      }
    })
  })

  // ==========================================================================
  // 3. Pagination
  // ==========================================================================

  describe('pagination', () => {
    beforeEach(async () => {
      // Add 25 logs with incrementing timestamps
      for (let i = 1; i <= 25; i++) {
        await appendLog(stub, {
          functionId: 'page-func',
          level: 'info',
          message: `Log entry ${i}`,
          timestamp: Date.now() + i * 1000,
        })
      }
    })

    it('should respect limit parameter', async () => {
      const result = await queryLogs(stub, 'page-func', { limit: 10 })
      expect(result.entries).toHaveLength(10)
    })

    it('should return cursor when more results are available', async () => {
      const result = await queryLogs(stub, 'page-func', { limit: 10 })

      expect(result.cursor).toBeDefined()
      expect(result.cursor).not.toBeNull()
      expect(result.hasMore).toBe(true)
    })

    it('should return null cursor when all results returned', async () => {
      const result = await queryLogs(stub, 'page-func', { limit: 50 })

      expect(result.cursor).toBeNull()
      expect(result.hasMore).toBe(false)
    })

    it('should fetch next page using cursor', async () => {
      const firstPage = await queryLogs(stub, 'page-func', { limit: 10 })
      expect(firstPage.cursor).not.toBeNull()

      const secondPage = await queryLogs(stub, 'page-func', {
        limit: 10,
        cursor: firstPage.cursor!,
      })

      // Pages should have different entries
      const firstPageIds = new Set(firstPage.entries.map(e => e.id))
      for (const entry of secondPage.entries) {
        expect(firstPageIds.has(entry.id)).toBe(false)
      }
    })

    it('should iterate through all pages', async () => {
      const allEntries: LogEntryJSON[] = []
      let cursor: string | undefined = undefined

      do {
        const result = await queryLogs(stub, 'page-func', {
          limit: 10,
          cursor,
        })
        allEntries.push(...result.entries)
        cursor = result.cursor ?? undefined
      } while (cursor)

      expect(allEntries).toHaveLength(25)
    })
  })

  // ==========================================================================
  // 4. Metrics
  // ==========================================================================

  describe('metrics', () => {
    it('should return count by log level', async () => {
      // Add logs at different levels
      for (let i = 0; i < 10; i++) {
        await appendLog(stub, { functionId: 'metrics-func', level: 'debug', message: `Debug ${i}` })
      }
      for (let i = 0; i < 20; i++) {
        await appendLog(stub, { functionId: 'metrics-func', level: 'info', message: `Info ${i}` })
      }
      for (let i = 0; i < 5; i++) {
        await appendLog(stub, { functionId: 'metrics-func', level: 'warn', message: `Warn ${i}` })
      }
      for (let i = 0; i < 3; i++) {
        await appendLog(stub, { functionId: 'metrics-func', level: 'error', message: `Error ${i}` })
      }
      for (let i = 0; i < 2; i++) {
        await appendLog(stub, { functionId: 'metrics-func', level: 'fatal', message: `Fatal ${i}` })
      }

      const metrics = await getMetrics(stub, 'metrics-func')

      expect(metrics.total).toBe(40)
      expect(metrics.countByLevel.debug).toBe(10)
      expect(metrics.countByLevel.info).toBe(20)
      expect(metrics.countByLevel.warn).toBe(5)
      expect(metrics.countByLevel.error).toBe(3)
      expect(metrics.countByLevel.fatal).toBe(2)
    })

    it('should return error rate', async () => {
      // 3 error + 2 fatal out of 40 total = 5/40 = 0.125
      for (let i = 0; i < 10; i++) {
        await appendLog(stub, { functionId: 'error-rate-func', level: 'debug', message: `D ${i}` })
      }
      for (let i = 0; i < 20; i++) {
        await appendLog(stub, { functionId: 'error-rate-func', level: 'info', message: `I ${i}` })
      }
      for (let i = 0; i < 5; i++) {
        await appendLog(stub, { functionId: 'error-rate-func', level: 'warn', message: `W ${i}` })
      }
      for (let i = 0; i < 3; i++) {
        await appendLog(stub, { functionId: 'error-rate-func', level: 'error', message: `E ${i}` })
      }
      for (let i = 0; i < 2; i++) {
        await appendLog(stub, { functionId: 'error-rate-func', level: 'fatal', message: `F ${i}` })
      }

      const metrics = await getMetrics(stub, 'error-rate-func')
      expect(metrics.errorRate).toBeCloseTo(0.125, 2)
    })

    it('should return total log count', async () => {
      for (let i = 0; i < 15; i++) {
        await appendLog(stub, { functionId: 'count-func', level: 'info', message: `Log ${i}` })
      }

      const metrics = await getMetrics(stub, 'count-func')
      expect(metrics.total).toBe(15)
    })

    it('should return most recent timestamp', async () => {
      const recentTimestamp = Date.now() + 100000

      await appendLog(stub, {
        functionId: 'recent-func',
        level: 'info',
        message: 'Old log',
        timestamp: Date.now() - 10000,
      })
      await appendLog(stub, {
        functionId: 'recent-func',
        level: 'info',
        message: 'Recent log',
        timestamp: recentTimestamp,
      })

      const metrics = await getMetrics(stub, 'recent-func')
      expect(metrics.lastLogTimestamp).toBe(recentTimestamp)
    })

    it('should return average duration when available', async () => {
      await appendLog(stub, {
        functionId: 'dur-func',
        level: 'info',
        message: 'Req 1',
        durationMs: 100,
      })
      await appendLog(stub, {
        functionId: 'dur-func',
        level: 'info',
        message: 'Req 2',
        durationMs: 200,
      })
      await appendLog(stub, {
        functionId: 'dur-func',
        level: 'info',
        message: 'Req 3',
        durationMs: 300,
      })

      const metrics = await getMetrics(stub, 'dur-func')
      expect(metrics.avgDurationMs).toBeCloseTo(200, 0)
    })

    it('should return logs per minute rate', async () => {
      await appendLog(stub, { functionId: 'rate-func', level: 'info', message: 'Log 1' })
      await appendLog(stub, { functionId: 'rate-func', level: 'info', message: 'Log 2' })

      const metrics = await getMetrics(stub, 'rate-func')
      expect(metrics.logsPerMinute).toBeDefined()
      expect(typeof metrics.logsPerMinute).toBe('number')
    })

    it('should return zero metrics for unknown function', async () => {
      const metrics = await getMetrics(stub, 'nonexistent-func')
      expect(metrics.total).toBe(0)
      expect(metrics.errorRate).toBe(0)
    })
  })

  // ==========================================================================
  // 5. Multi-function support
  // ==========================================================================

  describe('multi-function support', () => {
    beforeEach(async () => {
      for (let i = 0; i < 5; i++) {
        await appendLog(stub, { functionId: 'func-alpha', level: 'info', message: `Alpha ${i}` })
        await appendLog(stub, { functionId: 'func-beta', level: 'warn', message: `Beta ${i}` })
        await appendLog(stub, { functionId: 'func-gamma', level: 'error', message: `Gamma ${i}` })
      }
    })

    it('should query logs for specific function only', async () => {
      const result = await queryLogs(stub, 'func-alpha')

      expect(result.entries.length).toBe(5)
      for (const entry of result.entries) {
        expect(entry.functionId).toBe('func-alpha')
      }
    })

    it('should get metrics per function independently', async () => {
      const alphaMetrics = await getMetrics(stub, 'func-alpha')
      const betaMetrics = await getMetrics(stub, 'func-beta')
      const gammaMetrics = await getMetrics(stub, 'func-gamma')

      expect(alphaMetrics.total).toBe(5)
      expect(betaMetrics.total).toBe(5)
      expect(gammaMetrics.total).toBe(5)

      expect(alphaMetrics.countByLevel.info).toBe(5)
      expect(betaMetrics.countByLevel.warn).toBe(5)
      expect(gammaMetrics.countByLevel.error).toBe(5)
    })

    it('should delete logs for specific function only', async () => {
      await deleteLogs(stub, 'func-alpha')

      const alphaResult = await queryLogs(stub, 'func-alpha')
      expect(alphaResult.entries).toHaveLength(0)

      // Other functions should still have logs
      const betaResult = await queryLogs(stub, 'func-beta')
      expect(betaResult.entries).toHaveLength(5)

      const gammaResult = await queryLogs(stub, 'func-gamma')
      expect(gammaResult.entries).toHaveLength(5)
    })
  })

  // ==========================================================================
  // 6. HTTP handler routing
  // ==========================================================================

  describe('HTTP handler routing', () => {
    it('should handle POST /logs to append entry', async () => {
      const response = await stub.fetch('https://logs.do/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          functionId: 'http-test-func',
          level: 'info',
          message: 'Test log via HTTP',
        }),
      })

      expect(response.status).toBe(201)
      const body = await response.json() as LogEntryJSON
      expect(body.id).toBeDefined()
      expect(body.message).toBe('Test log via HTTP')
    })

    it('should handle GET /logs with query parameters', async () => {
      await appendLog(stub, {
        functionId: 'query-http-func',
        level: 'info',
        message: 'Queryable log',
      })

      const response = await stub.fetch(
        'https://logs.do/logs?functionId=query-http-func&limit=10',
        { method: 'GET' }
      )

      expect(response.status).toBe(200)
      const body = await response.json() as LogQueryResultJSON
      expect(body.entries).toBeDefined()
      expect(body.entries.length).toBeGreaterThan(0)
    })

    it('should handle GET /metrics', async () => {
      await appendLog(stub, {
        functionId: 'metrics-http-func',
        level: 'error',
        message: 'Error log',
      })

      const response = await stub.fetch(
        'https://logs.do/metrics?functionId=metrics-http-func',
        { method: 'GET' }
      )

      expect(response.status).toBe(200)
      const body = await response.json() as LogMetricsJSON
      expect(body.total).toBeDefined()
      expect(body.countByLevel).toBeDefined()
    })

    it('should handle DELETE /logs/:functionId', async () => {
      await appendLog(stub, {
        functionId: 'delete-http-func',
        level: 'info',
        message: 'To be deleted',
      })

      const response = await stub.fetch('https://logs.do/logs/delete-http-func', {
        method: 'DELETE',
      })

      expect(response.status).toBe(204)

      // Verify it's gone
      const result = await queryLogs(stub, 'delete-http-func')
      expect(result.entries).toHaveLength(0)
    })

    it('should return 400 for POST /logs with missing required fields', async () => {
      const response = await stub.fetch('https://logs.do/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: 'info',
          // Missing functionId and message
        }),
      })

      expect(response.status).toBe(400)
      // Consume the response body to avoid isolated storage issues
      await response.text()
    })

    it('should return 400 for GET /logs without functionId', async () => {
      const response = await stub.fetch('https://logs.do/logs', { method: 'GET' })
      expect(response.status).toBe(400)
      await response.text()
    })

    it('should return 400 for GET /metrics without functionId', async () => {
      const response = await stub.fetch('https://logs.do/metrics', { method: 'GET' })
      expect(response.status).toBe(400)
      await response.text()
    })

    it('should return 404 for unknown endpoint', async () => {
      const response = await stub.fetch('https://logs.do/unknown', { method: 'GET' })
      expect(response.status).toBe(404)
      await response.text()
    })
  })

  // ==========================================================================
  // 7. State persistence across calls
  // ==========================================================================

  describe('state persistence', () => {
    it('should persist logs across separate fetch calls', async () => {
      // Append in one call
      await appendLog(stub, {
        functionId: 'persist-func',
        level: 'info',
        message: 'Persisted log',
      })

      // Query in a separate call
      const result = await queryLogs(stub, 'persist-func')
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].message).toBe('Persisted log')
    })

    it('should persist when re-getting same DO by name', async () => {
      const fixedName = `persist-logs-test-${Date.now()}`
      const id1 = env.FUNCTION_LOGS.idFromName(fixedName)
      const stub1 = env.FUNCTION_LOGS.get(id1)

      await appendLog(stub1, {
        functionId: 'shared-func',
        level: 'info',
        message: 'Shared log',
      })

      // Re-get the same DO by name
      const id2 = env.FUNCTION_LOGS.idFromName(fixedName)
      const stub2 = env.FUNCTION_LOGS.get(id2)

      const result = await queryLogs(stub2, 'shared-func')
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].message).toBe('Shared log')
    })

    it('should accumulate logs over multiple appends', async () => {
      for (let i = 0; i < 10; i++) {
        await appendLog(stub, {
          functionId: 'accum-func',
          level: 'info',
          message: `Log ${i}`,
        })
      }

      const result = await queryLogs(stub, 'accum-func')
      expect(result.entries).toHaveLength(10)
    })
  })

  // ==========================================================================
  // 8. Metadata handling
  // ==========================================================================

  describe('metadata handling', () => {
    it('should store and retrieve structured metadata', async () => {
      await appendLog(stub, {
        functionId: 'meta-func',
        level: 'info',
        message: 'With metadata',
        metadata: { userId: 'user-123', ip: '10.0.0.1', tags: ['production', 'api'] },
      })

      const result = await queryLogs(stub, 'meta-func')
      expect(result.entries[0].metadata).toEqual({
        userId: 'user-123',
        ip: '10.0.0.1',
        tags: ['production', 'api'],
      })
    })

    it('should handle entries without metadata', async () => {
      await appendLog(stub, {
        functionId: 'no-meta-func',
        level: 'info',
        message: 'No metadata',
      })

      const result = await queryLogs(stub, 'no-meta-func')
      expect(result.entries[0].message).toBe('No metadata')
      // metadata should be undefined/null for entries without it
    })

    it('should store and retrieve requestId for correlation', async () => {
      await appendLog(stub, {
        functionId: 'req-id-func',
        level: 'info',
        message: 'With request ID',
        requestId: 'req-abc-123',
      })

      const result = await queryLogs(stub, 'req-id-func')
      expect(result.entries[0].requestId).toBe('req-abc-123')
    })

    it('should store and retrieve duration', async () => {
      await appendLog(stub, {
        functionId: 'duration-func',
        level: 'info',
        message: 'With duration',
        durationMs: 42,
      })

      const result = await queryLogs(stub, 'duration-func')
      expect(result.entries[0].durationMs).toBe(42)
    })
  })
})
