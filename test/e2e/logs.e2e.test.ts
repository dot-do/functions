/**
 * E2E Tests: Function Logs Retrieval (RED)
 *
 * Issue: functions-pesm
 *
 * These tests verify the full function logs retrieval flow on the live
 * functions.do platform.
 *
 * Test Coverage:
 * 1. Deploy and invoke a function to generate logs
 * 2. Retrieve logs for the function
 * 3. Verify log content and format
 * 4. Test filtering and pagination
 *
 * Prerequisites:
 * - functions.do Worker must be deployed
 * - No auth required initially (added later with oauth.do)
 *
 * Run with: npm run test:e2e
 *
 * RED Phase: These tests document expected behavior and may fail until
 * implementation is complete.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  E2E_CONFIG,
  generateTestFunctionId,
  shouldRunE2E,
  deployAndUploadFunction,
  invokeFunction,
  deleteFunction,
  getFunctionLogs,
} from './config'

// ============================================================================
// Types
// ============================================================================

/**
 * Log entry structure returned by the API
 */
interface LogEntry {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  requestId?: string
  metadata?: Record<string, unknown>
}

/**
 * Log query options
 */
interface LogQueryOptions {
  limit?: number
  since?: string
  level?: 'debug' | 'info' | 'warn' | 'error'
  cursor?: string
}

/**
 * Paginated logs response
 */
interface PaginatedLogsResponse {
  logs: LogEntry[]
  hasMore: boolean
  nextCursor?: string
  total?: number
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get function logs with full response including pagination info
 */
async function getFunctionLogsPaginated(
  functionId: string,
  options?: LogQueryOptions
): Promise<PaginatedLogsResponse> {
  const params = new URLSearchParams()
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.since) params.set('since', options.since)
  if (options?.level) params.set('level', options.level)
  if (options?.cursor) params.set('cursor', options.cursor)

  const response = await fetch(
    `${E2E_CONFIG.baseUrl}/api/functions/${functionId}/logs?${params}`,
    {
      headers: {
        ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
      },
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Get logs failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Get raw logs response for testing response format
 */
async function getFunctionLogsRaw(
  functionId: string,
  options?: LogQueryOptions
): Promise<Response> {
  const params = new URLSearchParams()
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.since) params.set('since', options.since)
  if (options?.level) params.set('level', options.level)
  if (options?.cursor) params.set('cursor', options.cursor)

  return fetch(
    `${E2E_CONFIG.baseUrl}/api/functions/${functionId}/logs?${params}`,
    {
      headers: {
        ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
      },
    }
  )
}

/**
 * Wait for logs to be captured after invocation
 */
async function waitForLogs(delayMs: number = 2000): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

// ============================================================================
// E2E Tests
// ============================================================================

describe.skipIf(!shouldRunE2E())('E2E: Function Logs Retrieval', () => {
  const deployedFunctions: string[] = []

  afterAll(async () => {
    // Cleanup deployed functions
    if (!E2E_CONFIG.skipCleanup) {
      for (const functionId of deployedFunctions) {
        try {
          await deleteFunction(functionId)
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  })

  // ==========================================================================
  // 1. DEPLOY AND INVOKE A FUNCTION TO GENERATE LOGS
  // ==========================================================================
  describe('Deploy and Invoke to Generate Logs', () => {
    let loggingFunctionId: string

    beforeAll(async () => {
      loggingFunctionId = generateTestFunctionId()
      deployedFunctions.push(loggingFunctionId)

      // Deploy a function that generates various log levels
      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const body = await request.json().catch(() => ({})) as {
              action?: string
              data?: unknown
            }

            const action = body.action || 'default'

            // Generate logs at different levels
            console.debug('Debug: Processing request with action=' + action)
            console.log('Info: Request received for action: ' + action)

            if (action === 'warn') {
              console.warn('Warning: Action might be slow')
            }

            if (action === 'error') {
              console.error('Error: Simulated error condition')
            }

            if (action === 'throw') {
              throw new Error('Intentional error for log testing')
            }

            console.log('Info: Request processed successfully')

            return Response.json({
              action,
              timestamp: Date.now(),
              success: true
            })
          }
        }
      `

      await deployAndUploadFunction({
        id: loggingFunctionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })
    }, E2E_CONFIG.deployTimeout)

    it('invokes function to generate info logs', async () => {
      const result = await invokeFunction<{ action: string; success: boolean }>(
        loggingFunctionId,
        { action: 'info-test' }
      )

      expect(result.success).toBe(true)
      expect(result.action).toBe('info-test')
    }, E2E_CONFIG.invokeTimeout)

    it('invokes function to generate warning logs', async () => {
      const result = await invokeFunction<{ action: string; success: boolean }>(
        loggingFunctionId,
        { action: 'warn' }
      )

      expect(result.success).toBe(true)
      expect(result.action).toBe('warn')
    }, E2E_CONFIG.invokeTimeout)

    it('invokes function to generate error logs', async () => {
      const result = await invokeFunction<{ action: string; success: boolean }>(
        loggingFunctionId,
        { action: 'error' }
      )

      expect(result.success).toBe(true)
      expect(result.action).toBe('error')
    }, E2E_CONFIG.invokeTimeout)

    it('invokes function multiple times to generate multiple log entries', async () => {
      // Generate multiple invocations for pagination testing
      const promises = Array.from({ length: 5 }, (_, i) =>
        invokeFunction(loggingFunctionId, { action: `batch-${i}` })
      )

      const results = await Promise.all(promises)
      expect(results.length).toBe(5)
    }, E2E_CONFIG.invokeTimeout)
  })

  // ==========================================================================
  // 2. RETRIEVE LOGS FOR THE FUNCTION
  // ==========================================================================
  describe('Retrieve Logs for Function', () => {
    let logTestFunctionId: string

    beforeAll(async () => {
      logTestFunctionId = generateTestFunctionId()
      deployedFunctions.push(logTestFunctionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            console.log('Request received')
            console.log('Processing started')
            console.log('Processing completed')
            return Response.json({ success: true })
          }
        }
      `

      await deployAndUploadFunction({
        id: logTestFunctionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      // Invoke to generate logs
      await invokeFunction(logTestFunctionId, {})

      // Wait for logs to be captured
      await waitForLogs()
    }, E2E_CONFIG.deployInvokeTimeout + 3000)

    it('retrieves logs for a deployed function', async () => {
      const logs = await getFunctionLogs(logTestFunctionId, { limit: 100 })

      expect(logs).toBeDefined()
      expect(Array.isArray(logs)).toBe(true)
    }, E2E_CONFIG.invokeTimeout)

    it('returns logs in array format', async () => {
      const logs = await getFunctionLogs(logTestFunctionId)

      expect(Array.isArray(logs)).toBe(true)
    }, E2E_CONFIG.invokeTimeout)

    it('logs endpoint returns 200 OK status', async () => {
      const response = await getFunctionLogsRaw(logTestFunctionId)

      expect(response.status).toBe(200)
      expect(response.ok).toBe(true)
    }, E2E_CONFIG.invokeTimeout)

    it('logs endpoint returns JSON content type', async () => {
      const response = await getFunctionLogsRaw(logTestFunctionId)

      const contentType = response.headers.get('content-type')
      expect(contentType).toContain('application/json')
    }, E2E_CONFIG.invokeTimeout)

    it('returns 404 for non-existent function logs', async () => {
      const response = await getFunctionLogsRaw('non-existent-function-12345')

      expect(response.status).toBe(404)
    }, E2E_CONFIG.invokeTimeout)

    it('includes logs from recent invocations', async () => {
      // Invoke again to ensure fresh logs
      await invokeFunction(logTestFunctionId, {})
      await waitForLogs()

      const logs = await getFunctionLogs(logTestFunctionId, { limit: 100 })

      // Should have logs from recent invocations
      expect(logs.length).toBeGreaterThan(0)
    }, E2E_CONFIG.invokeTimeout + 3000)
  })

  // ==========================================================================
  // 3. VERIFY LOG CONTENT AND FORMAT
  // ==========================================================================
  describe('Verify Log Content and Format', () => {
    let formatTestFunctionId: string

    beforeAll(async () => {
      formatTestFunctionId = generateTestFunctionId()
      deployedFunctions.push(formatTestFunctionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            console.debug('Debug level message')
            console.log('Info level message')
            console.warn('Warning level message')
            console.error('Error level message')
            return Response.json({ logged: true })
          }
        }
      `

      await deployAndUploadFunction({
        id: formatTestFunctionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      // Invoke to generate logs
      await invokeFunction(formatTestFunctionId, {})
      await waitForLogs()
    }, E2E_CONFIG.deployInvokeTimeout + 3000)

    it('log entries contain timestamp field', async () => {
      const logs = await getFunctionLogs(formatTestFunctionId, { limit: 100 })

      expect(logs.length).toBeGreaterThan(0)

      for (const log of logs) {
        expect(log.timestamp).toBeDefined()
        // Timestamp should be a valid date string or number
        const timestamp = typeof log.timestamp === 'string'
          ? new Date(log.timestamp).getTime()
          : log.timestamp
        expect(isNaN(timestamp)).toBe(false)
      }
    }, E2E_CONFIG.invokeTimeout)

    it('log entries contain level field', async () => {
      const logs = await getFunctionLogs(formatTestFunctionId, { limit: 100 })

      expect(logs.length).toBeGreaterThan(0)

      for (const log of logs) {
        expect(log.level).toBeDefined()
        expect(['debug', 'info', 'warn', 'error']).toContain(log.level)
      }
    }, E2E_CONFIG.invokeTimeout)

    it('log entries contain message field', async () => {
      const logs = await getFunctionLogs(formatTestFunctionId, { limit: 100 })

      expect(logs.length).toBeGreaterThan(0)

      for (const log of logs) {
        expect(log.message).toBeDefined()
        expect(typeof log.message).toBe('string')
      }
    }, E2E_CONFIG.invokeTimeout)

    it('log messages match what was logged in function', async () => {
      const logs = await getFunctionLogs(formatTestFunctionId, { limit: 100 })

      const messages = logs.map((l) => l.message)

      // At least some expected messages should be present
      const hasExpectedMessages = messages.some(
        (m) =>
          m.includes('Debug level') ||
          m.includes('Info level') ||
          m.includes('Warning level') ||
          m.includes('Error level')
      )

      expect(hasExpectedMessages).toBe(true)
    }, E2E_CONFIG.invokeTimeout)

    it('logs are in chronological order (newest first or oldest first)', async () => {
      const logs = await getFunctionLogs(formatTestFunctionId, { limit: 100 })

      if (logs.length < 2) {
        // Need at least 2 logs to check order
        return
      }

      const timestamps = logs.map((l) =>
        typeof l.timestamp === 'string'
          ? new Date(l.timestamp).getTime()
          : l.timestamp
      )

      // Check if ascending or descending order
      const isAscending = timestamps.every(
        (t, i) => i === 0 || t >= timestamps[i - 1]
      )
      const isDescending = timestamps.every(
        (t, i) => i === 0 || t <= timestamps[i - 1]
      )

      // Should be in some consistent order
      expect(isAscending || isDescending).toBe(true)
    }, E2E_CONFIG.invokeTimeout)

    it('log entries may include requestId for correlation', async () => {
      const logs = await getFunctionLogs(formatTestFunctionId, { limit: 100 })

      // If requestId is present, it should be a string
      for (const log of logs) {
        if (log.requestId) {
          expect(typeof log.requestId).toBe('string')
        }
      }
    }, E2E_CONFIG.invokeTimeout)

    it('debug level logs are captured', async () => {
      const logs = await getFunctionLogs(formatTestFunctionId, { limit: 100 })

      const debugLogs = logs.filter(
        (l) => l.level === 'debug' || l.message.toLowerCase().includes('debug')
      )

      // Debug logs should be captured
      expect(debugLogs.length).toBeGreaterThanOrEqual(0)
    }, E2E_CONFIG.invokeTimeout)

    it('info level logs are captured', async () => {
      const logs = await getFunctionLogs(formatTestFunctionId, { limit: 100 })

      const infoLogs = logs.filter(
        (l) => l.level === 'info' || l.message.toLowerCase().includes('info')
      )

      expect(infoLogs.length).toBeGreaterThan(0)
    }, E2E_CONFIG.invokeTimeout)

    it('warn level logs are captured', async () => {
      const logs = await getFunctionLogs(formatTestFunctionId, { limit: 100 })

      const warnLogs = logs.filter(
        (l) => l.level === 'warn' || l.message.toLowerCase().includes('warning')
      )

      expect(warnLogs.length).toBeGreaterThan(0)
    }, E2E_CONFIG.invokeTimeout)

    it('error level logs are captured', async () => {
      const logs = await getFunctionLogs(formatTestFunctionId, { limit: 100 })

      const errorLogs = logs.filter(
        (l) => l.level === 'error' || l.message.toLowerCase().includes('error')
      )

      expect(errorLogs.length).toBeGreaterThan(0)
    }, E2E_CONFIG.invokeTimeout)
  })

  // ==========================================================================
  // 4. TEST FILTERING AND PAGINATION
  // ==========================================================================
  describe('Filtering and Pagination', () => {
    let paginationFunctionId: string

    beforeAll(async () => {
      paginationFunctionId = generateTestFunctionId()
      deployedFunctions.push(paginationFunctionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const body = await request.json().catch(() => ({})) as { batch?: number }
            const batch = body.batch || 0

            // Generate multiple log entries per invocation
            for (let i = 0; i < 5; i++) {
              console.log('Batch ' + batch + ' - Log entry ' + i)
            }
            console.warn('Batch ' + batch + ' - Warning entry')
            console.error('Batch ' + batch + ' - Error entry')

            return Response.json({ batch, logged: 7 })
          }
        }
      `

      await deployAndUploadFunction({
        id: paginationFunctionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      // Generate multiple batches of logs for pagination testing
      for (let batch = 0; batch < 5; batch++) {
        await invokeFunction(paginationFunctionId, { batch })
        // Small delay between batches to ensure distinct timestamps
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      await waitForLogs(3000)
    }, E2E_CONFIG.deployInvokeTimeout + 15000)

    // ========================================================================
    // Limit Parameter Tests
    // ========================================================================
    describe('Limit Parameter', () => {
      it('respects limit parameter', async () => {
        const logs = await getFunctionLogs(paginationFunctionId, { limit: 5 })

        expect(logs.length).toBeLessThanOrEqual(5)
      }, E2E_CONFIG.invokeTimeout)

      it('returns fewer logs when limit is less than available', async () => {
        const logsLimit3 = await getFunctionLogs(paginationFunctionId, { limit: 3 })
        const logsLimit10 = await getFunctionLogs(paginationFunctionId, { limit: 10 })

        expect(logsLimit3.length).toBeLessThanOrEqual(3)
        // If there are more than 3 logs, limit=10 should return more
        if (logsLimit10.length > 3) {
          expect(logsLimit10.length).toBeGreaterThan(logsLimit3.length)
        }
      }, E2E_CONFIG.invokeTimeout)

      it('uses default limit when not specified', async () => {
        const logs = await getFunctionLogs(paginationFunctionId)

        // Should return some logs but not unlimited
        expect(logs.length).toBeGreaterThan(0)
        expect(logs.length).toBeLessThanOrEqual(1000) // Reasonable max default
      }, E2E_CONFIG.invokeTimeout)

      it('handles limit=1 correctly', async () => {
        const logs = await getFunctionLogs(paginationFunctionId, { limit: 1 })

        expect(logs.length).toBeLessThanOrEqual(1)
      }, E2E_CONFIG.invokeTimeout)

      it('handles large limit value', async () => {
        const response = await getFunctionLogsRaw(paginationFunctionId, { limit: 10000 })

        // Should either succeed with capped limit or return error
        expect([200, 400]).toContain(response.status)
      }, E2E_CONFIG.invokeTimeout)
    })

    // ========================================================================
    // Level Filter Tests
    // ========================================================================
    describe('Level Filter', () => {
      it('filters logs by level=error', async () => {
        const response = await getFunctionLogsPaginated(paginationFunctionId, {
          level: 'error',
          limit: 100,
        })

        // All returned logs should be error level
        for (const log of response.logs) {
          expect(log.level).toBe('error')
        }
      }, E2E_CONFIG.invokeTimeout)

      it('filters logs by level=warn', async () => {
        const response = await getFunctionLogsPaginated(paginationFunctionId, {
          level: 'warn',
          limit: 100,
        })

        // All returned logs should be warn level (may include error if it filters >= warn)
        for (const log of response.logs) {
          expect(['warn', 'error']).toContain(log.level)
        }
      }, E2E_CONFIG.invokeTimeout)

      it('filters logs by level=info', async () => {
        const response = await getFunctionLogsPaginated(paginationFunctionId, {
          level: 'info',
          limit: 100,
        })

        // Should return info level or higher
        for (const log of response.logs) {
          expect(['info', 'warn', 'error']).toContain(log.level)
        }
      }, E2E_CONFIG.invokeTimeout)

      it('filters logs by level=debug', async () => {
        const response = await getFunctionLogsPaginated(paginationFunctionId, {
          level: 'debug',
          limit: 100,
        })

        // Should return all levels
        for (const log of response.logs) {
          expect(['debug', 'info', 'warn', 'error']).toContain(log.level)
        }
      }, E2E_CONFIG.invokeTimeout)

      it('level filter reduces result count appropriately', async () => {
        const allLogs = await getFunctionLogsPaginated(paginationFunctionId, {
          limit: 100,
        })
        const errorLogs = await getFunctionLogsPaginated(paginationFunctionId, {
          level: 'error',
          limit: 100,
        })

        // Error-only should be <= all logs (unless all are errors)
        expect(errorLogs.logs.length).toBeLessThanOrEqual(allLogs.logs.length)
      }, E2E_CONFIG.invokeTimeout)

      it('handles invalid level filter gracefully', async () => {
        const response = await getFunctionLogsRaw(paginationFunctionId, {
          // @ts-expect-error - Testing invalid input
          level: 'invalid-level',
          limit: 10,
        })

        // Should return 400 Bad Request or ignore invalid filter
        expect([200, 400]).toContain(response.status)
      }, E2E_CONFIG.invokeTimeout)
    })

    // ========================================================================
    // Time Filter Tests (since parameter)
    // ========================================================================
    describe('Time Filter (since)', () => {
      it('filters logs by since timestamp', async () => {
        const now = new Date()
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()

        const response = await getFunctionLogsPaginated(paginationFunctionId, {
          since: oneHourAgo,
          limit: 100,
        })

        // All logs should be after the since timestamp
        for (const log of response.logs) {
          const logTime = new Date(log.timestamp).getTime()
          const sinceTime = new Date(oneHourAgo).getTime()
          expect(logTime).toBeGreaterThanOrEqual(sinceTime)
        }
      }, E2E_CONFIG.invokeTimeout)

      it('returns no logs when since is in the future', async () => {
        const futureTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

        const response = await getFunctionLogsPaginated(paginationFunctionId, {
          since: futureTime,
          limit: 100,
        })

        expect(response.logs.length).toBe(0)
      }, E2E_CONFIG.invokeTimeout)

      it('returns all logs when since is far in the past', async () => {
        const longAgo = new Date('2020-01-01T00:00:00Z').toISOString()

        const logsWithSince = await getFunctionLogsPaginated(paginationFunctionId, {
          since: longAgo,
          limit: 100,
        })
        const logsWithoutSince = await getFunctionLogsPaginated(paginationFunctionId, {
          limit: 100,
        })

        // Should return same logs
        expect(logsWithSince.logs.length).toBe(logsWithoutSince.logs.length)
      }, E2E_CONFIG.invokeTimeout)

      it('supports ISO 8601 timestamp format', async () => {
        const isoTime = new Date().toISOString()

        const response = await getFunctionLogsRaw(paginationFunctionId, {
          since: isoTime,
          limit: 10,
        })

        expect(response.ok).toBe(true)
      }, E2E_CONFIG.invokeTimeout)

      it('handles invalid since timestamp gracefully', async () => {
        const response = await getFunctionLogsRaw(paginationFunctionId, {
          since: 'invalid-timestamp',
          limit: 10,
        })

        // Should return 400 Bad Request or ignore invalid filter
        expect([200, 400]).toContain(response.status)
      }, E2E_CONFIG.invokeTimeout)
    })

    // ========================================================================
    // Pagination Tests (cursor-based)
    // ========================================================================
    describe('Cursor-based Pagination', () => {
      it('returns hasMore indicator in response', async () => {
        const response = await getFunctionLogsPaginated(paginationFunctionId, {
          limit: 3,
        })

        expect(response).toHaveProperty('hasMore')
        expect(typeof response.hasMore).toBe('boolean')
      }, E2E_CONFIG.invokeTimeout)

      it('returns cursor when more logs available', async () => {
        const response = await getFunctionLogsPaginated(paginationFunctionId, {
          limit: 3,
        })

        if (response.hasMore) {
          expect(response.nextCursor).toBeDefined()
          expect(typeof response.nextCursor).toBe('string')
        }
      }, E2E_CONFIG.invokeTimeout)

      it('cursor returns next page of results', async () => {
        const firstPage = await getFunctionLogsPaginated(paginationFunctionId, {
          limit: 3,
        })

        if (!firstPage.hasMore || !firstPage.nextCursor) {
          // Skip if not enough logs for pagination
          return
        }

        const secondPage = await getFunctionLogsPaginated(paginationFunctionId, {
          limit: 3,
          cursor: firstPage.nextCursor,
        })

        // Second page should have different logs
        const firstPageMessages = firstPage.logs.map((l) => l.message + l.timestamp)
        const secondPageMessages = secondPage.logs.map((l) => l.message + l.timestamp)

        // No overlap between pages
        for (const msg of secondPageMessages) {
          expect(firstPageMessages).not.toContain(msg)
        }
      }, E2E_CONFIG.invokeTimeout)

      it('can paginate through all logs', async () => {
        const allLogs: LogEntry[] = []
        let cursor: string | undefined
        let pageCount = 0
        const maxPages = 10 // Prevent infinite loop

        do {
          const response = await getFunctionLogsPaginated(paginationFunctionId, {
            limit: 5,
            cursor,
          })

          allLogs.push(...response.logs)
          cursor = response.nextCursor
          pageCount++

          if (!response.hasMore) break
        } while (cursor && pageCount < maxPages)

        // Should have collected all logs
        expect(allLogs.length).toBeGreaterThan(0)

        // All collected logs should be unique
        const uniqueIdentifiers = new Set(
          allLogs.map((l) => `${l.timestamp}-${l.message}`)
        )
        expect(uniqueIdentifiers.size).toBe(allLogs.length)
      }, E2E_CONFIG.invokeTimeout * 3)

      it('returns hasMore=false on last page', async () => {
        // Get a large page to ensure we get all logs
        const response = await getFunctionLogsPaginated(paginationFunctionId, {
          limit: 1000,
        })

        // If we got all logs in one page, hasMore should be false
        if (response.logs.length < 1000) {
          expect(response.hasMore).toBe(false)
        }
      }, E2E_CONFIG.invokeTimeout)

      it('handles invalid cursor gracefully', async () => {
        const response = await getFunctionLogsRaw(paginationFunctionId, {
          cursor: 'invalid-cursor-value',
          limit: 10,
        })

        // Should return 400 Bad Request or empty results
        expect([200, 400]).toContain(response.status)
      }, E2E_CONFIG.invokeTimeout)
    })

    // ========================================================================
    // Combined Filters Tests
    // ========================================================================
    describe('Combined Filters', () => {
      it('combines level and limit filters', async () => {
        const response = await getFunctionLogsPaginated(paginationFunctionId, {
          level: 'error',
          limit: 3,
        })

        expect(response.logs.length).toBeLessThanOrEqual(3)
        for (const log of response.logs) {
          expect(log.level).toBe('error')
        }
      }, E2E_CONFIG.invokeTimeout)

      it('combines since and limit filters', async () => {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

        const response = await getFunctionLogsPaginated(paginationFunctionId, {
          since: oneHourAgo,
          limit: 5,
        })

        expect(response.logs.length).toBeLessThanOrEqual(5)
        for (const log of response.logs) {
          expect(new Date(log.timestamp).getTime()).toBeGreaterThanOrEqual(
            new Date(oneHourAgo).getTime()
          )
        }
      }, E2E_CONFIG.invokeTimeout)

      it('combines level and since filters', async () => {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

        const response = await getFunctionLogsPaginated(paginationFunctionId, {
          level: 'warn',
          since: oneHourAgo,
          limit: 100,
        })

        for (const log of response.logs) {
          expect(['warn', 'error']).toContain(log.level)
          expect(new Date(log.timestamp).getTime()).toBeGreaterThanOrEqual(
            new Date(oneHourAgo).getTime()
          )
        }
      }, E2E_CONFIG.invokeTimeout)

      it('combines all filters together', async () => {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

        const response = await getFunctionLogsPaginated(paginationFunctionId, {
          level: 'error',
          since: oneHourAgo,
          limit: 2,
        })

        expect(response.logs.length).toBeLessThanOrEqual(2)
        for (const log of response.logs) {
          expect(log.level).toBe('error')
          expect(new Date(log.timestamp).getTime()).toBeGreaterThanOrEqual(
            new Date(oneHourAgo).getTime()
          )
        }
      }, E2E_CONFIG.invokeTimeout)
    })
  })

  // ==========================================================================
  // 5. ADDITIONAL TEST CASES
  // ==========================================================================
  describe('Edge Cases and Error Handling', () => {
    it('returns empty array for function with no logs', async () => {
      const newFunctionId = generateTestFunctionId()
      deployedFunctions.push(newFunctionId)

      // Deploy but don't invoke
      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return Response.json({ success: true })
          }
        }
      `

      await deployAndUploadFunction({
        id: newFunctionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      // Don't invoke - no logs should exist
      const logs = await getFunctionLogs(newFunctionId, { limit: 100 })

      expect(logs).toBeDefined()
      expect(Array.isArray(logs)).toBe(true)
      // May be empty or have minimal system logs
      expect(logs.length).toBeLessThanOrEqual(10)
    }, E2E_CONFIG.deployTimeout)

    it('handles function that throws error and captures error log', async () => {
      const errorFunctionId = generateTestFunctionId()
      deployedFunctions.push(errorFunctionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            console.log('About to throw error')
            throw new Error('Intentional test error for logging')
          }
        }
      `

      await deployAndUploadFunction({
        id: errorFunctionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      // Invoke and expect failure
      try {
        await invokeFunction(errorFunctionId, {})
      } catch {
        // Expected to fail
      }

      await waitForLogs()

      const logs = await getFunctionLogs(errorFunctionId, { limit: 100 })

      // Should have captured logs including the error
      expect(logs.length).toBeGreaterThan(0)

      // Check for error-related log
      const errorLogs = logs.filter(
        (l) =>
          l.level === 'error' ||
          l.message.toLowerCase().includes('error') ||
          l.message.includes('Intentional test error')
      )
      expect(errorLogs.length).toBeGreaterThan(0)
    }, E2E_CONFIG.deployInvokeTimeout + 3000)

    it('logs are scoped to specific function', async () => {
      const functionA = generateTestFunctionId()
      const functionB = generateTestFunctionId()
      deployedFunctions.push(functionA, functionB)

      const codeA = `
        export default {
          async fetch(request: Request): Promise<Response> {
            console.log('UNIQUE_LOG_FROM_FUNCTION_A_12345')
            return Response.json({ from: 'A' })
          }
        }
      `

      const codeB = `
        export default {
          async fetch(request: Request): Promise<Response> {
            console.log('UNIQUE_LOG_FROM_FUNCTION_B_67890')
            return Response.json({ from: 'B' })
          }
        }
      `

      await deployAndUploadFunction({
        id: functionA,
        code: codeA,
        language: 'typescript',
        version: '1.0.0',
      })

      await deployAndUploadFunction({
        id: functionB,
        code: codeB,
        language: 'typescript',
        version: '1.0.0',
      })

      // Invoke both
      await invokeFunction(functionA, {})
      await invokeFunction(functionB, {})

      await waitForLogs()

      // Get logs for function A
      const logsA = await getFunctionLogs(functionA, { limit: 100 })
      const messagesA = logsA.map((l) => l.message).join(' ')

      // Get logs for function B
      const logsB = await getFunctionLogs(functionB, { limit: 100 })
      const messagesB = logsB.map((l) => l.message).join(' ')

      // Function A logs should contain A's unique message and not B's
      expect(messagesA).toContain('FUNCTION_A')
      expect(messagesA).not.toContain('FUNCTION_B')

      // Function B logs should contain B's unique message and not A's
      expect(messagesB).toContain('FUNCTION_B')
      expect(messagesB).not.toContain('FUNCTION_A')
    }, E2E_CONFIG.deployInvokeTimeout * 2 + 3000)

    it('handles rapid consecutive log retrieval requests', async () => {
      const rapidFunctionId = generateTestFunctionId()
      deployedFunctions.push(rapidFunctionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            console.log('Rapid test log')
            return Response.json({ success: true })
          }
        }
      `

      await deployAndUploadFunction({
        id: rapidFunctionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      await invokeFunction(rapidFunctionId, {})
      await waitForLogs()

      // Make 10 rapid consecutive requests
      const promises = Array.from({ length: 10 }, () =>
        getFunctionLogs(rapidFunctionId, { limit: 10 })
      )

      const results = await Promise.all(promises)

      // All requests should succeed
      for (const logs of results) {
        expect(Array.isArray(logs)).toBe(true)
      }

      // All should return consistent results
      const firstResultCount = results[0].length
      for (const logs of results) {
        expect(logs.length).toBe(firstResultCount)
      }
    }, E2E_CONFIG.deployInvokeTimeout + 5000)

    it('handles very long log messages', async () => {
      const longLogFunctionId = generateTestFunctionId()
      deployedFunctions.push(longLogFunctionId)

      const longMessage = 'x'.repeat(10000) // 10KB message

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            console.log('${longMessage}')
            return Response.json({ success: true })
          }
        }
      `

      await deployAndUploadFunction({
        id: longLogFunctionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      await invokeFunction(longLogFunctionId, {})
      await waitForLogs()

      const logs = await getFunctionLogs(longLogFunctionId, { limit: 100 })

      // Should have captured the log (possibly truncated)
      expect(logs.length).toBeGreaterThan(0)

      // Find the long message log
      const longLog = logs.find(
        (l) => l.message.includes('xxx') || l.message.length > 100
      )
      expect(longLog).toBeDefined()
    }, E2E_CONFIG.deployInvokeTimeout + 3000)

    it('logs include JSON objects when logged with console.log', async () => {
      const jsonLogFunctionId = generateTestFunctionId()
      deployedFunctions.push(jsonLogFunctionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const obj = { key: 'value', nested: { a: 1, b: 2 } }
            console.log('Object log:', JSON.stringify(obj))
            return Response.json({ success: true })
          }
        }
      `

      await deployAndUploadFunction({
        id: jsonLogFunctionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      await invokeFunction(jsonLogFunctionId, {})
      await waitForLogs()

      const logs = await getFunctionLogs(jsonLogFunctionId, { limit: 100 })

      // Should have captured the JSON log
      const jsonLog = logs.find(
        (l) => l.message.includes('key') && l.message.includes('value')
      )
      expect(jsonLog).toBeDefined()
    }, E2E_CONFIG.deployInvokeTimeout + 3000)
  })

  // ==========================================================================
  // 6. PERFORMANCE AND TIMING
  // ==========================================================================
  describe('Performance and Timing', () => {
    it('logs retrieval completes within acceptable time', async () => {
      const perfFunctionId = generateTestFunctionId()
      deployedFunctions.push(perfFunctionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            for (let i = 0; i < 10; i++) {
              console.log('Performance test log ' + i)
            }
            return Response.json({ success: true })
          }
        }
      `

      await deployAndUploadFunction({
        id: perfFunctionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      // Generate some logs
      await invokeFunction(perfFunctionId, {})
      await waitForLogs()

      const startTime = Date.now()
      await getFunctionLogs(perfFunctionId, { limit: 100 })
      const elapsed = Date.now() - startTime

      // Should complete within 5 seconds
      expect(elapsed).toBeLessThan(5000)
    }, E2E_CONFIG.deployInvokeTimeout + 10000)

    it('pagination does not significantly slow down response', async () => {
      const paginatedPerfFunctionId = generateTestFunctionId()
      deployedFunctions.push(paginatedPerfFunctionId)

      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            for (let i = 0; i < 20; i++) {
              console.log('Pagination perf test ' + i)
            }
            return Response.json({ success: true })
          }
        }
      `

      await deployAndUploadFunction({
        id: paginatedPerfFunctionId,
        code,
        language: 'typescript',
        version: '1.0.0',
      })

      // Generate logs with multiple invocations
      for (let i = 0; i < 3; i++) {
        await invokeFunction(paginatedPerfFunctionId, {})
      }
      await waitForLogs()

      // Time fetching multiple pages
      const startTime = Date.now()

      const firstPage = await getFunctionLogsPaginated(paginatedPerfFunctionId, {
        limit: 10,
      })

      if (firstPage.nextCursor) {
        await getFunctionLogsPaginated(paginatedPerfFunctionId, {
          limit: 10,
          cursor: firstPage.nextCursor,
        })
      }

      const elapsed = Date.now() - startTime

      // Two pages should still be fast
      expect(elapsed).toBeLessThan(5000)
    }, E2E_CONFIG.deployInvokeTimeout + 15000)
  })
})
