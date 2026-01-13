/**
 * Tests for dotdo logs command
 *
 * TDD RED phase - these tests define the expected behavior
 * of the `dotdo logs` command for viewing function logs.
 *
 * The logs command should:
 * - Show function logs with `dotdo logs <name>`
 * - Support --follow for real-time streaming
 * - Support --since for time filtering
 * - Support --level for level filtering (debug, info, warn, error)
 * - Support --limit for pagination
 * - Format log entries with timestamp and level
 * - Handle no logs gracefully
 * - Require authentication
 * - Return exit code 1 for non-existent function
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Log level types
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * A single log entry from the function
 */
interface LogEntry {
  timestamp: string // ISO 8601 timestamp
  level: LogLevel
  message: string
  requestId?: string
  metadata?: Record<string, unknown>
}

/**
 * Response from listing logs
 */
interface ListLogsResponse {
  logs: LogEntry[]
  hasMore: boolean
  nextCursor?: string
}

/**
 * API Client interface for logs operations
 * Used for dependency injection to enable testing
 */
interface LogsAPIClient {
  /**
   * Get logs for a function
   * @param functionName - The name of the function
   * @param options - Query options for filtering logs
   */
  getLogs(
    functionName: string,
    options?: LogsQueryOptions
  ): Promise<ListLogsResponse>

  /**
   * Subscribe to real-time log stream
   * @param functionName - The name of the function
   * @param options - Query options for filtering logs
   * @param onLog - Callback for each log entry
   * @returns Unsubscribe function
   */
  streamLogs(
    functionName: string,
    options: LogsQueryOptions,
    onLog: (entry: LogEntry) => void,
    onError: (error: Error) => void
  ): () => void

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): Promise<boolean>

  /**
   * Check if function exists
   * @param functionName - The name of the function
   */
  functionExists(functionName: string): Promise<boolean>
}

/**
 * Query options for fetching logs
 */
interface LogsQueryOptions {
  since?: string // ISO 8601 timestamp or relative time like '1h', '30m'
  level?: LogLevel
  limit?: number
  cursor?: string
}

/**
 * CLI context for dependency injection
 */
interface CLIContext {
  stdout: (text: string) => void
  stderr: (text: string) => void
  exit: (code: number) => void
  cwd: string
}

/**
 * Result of executing a CLI command
 */
interface CommandResult {
  exitCode: number
  output?: string
  error?: string
}

/**
 * Options for logs command
 */
interface LogsOptions {
  follow?: boolean
  since?: string
  level?: LogLevel
  limit?: number
}

/**
 * Run the logs command
 * This is the function under test - to be implemented
 */
declare function runLogs(
  name: string,
  options: LogsOptions,
  context: CLIContext,
  apiClient: LogsAPIClient
): Promise<CommandResult>

/**
 * Create a mock API client for testing
 */
function createMockAPIClient(): LogsAPIClient & {
  logs: Map<string, LogEntry[]>
  functions: Set<string>
  authenticated: boolean
  streamCallbacks: Array<{
    functionName: string
    onLog: (entry: LogEntry) => void
    onError: (error: Error) => void
  }>
  emitLog: (functionName: string, entry: LogEntry) => void
  emitStreamError: (functionName: string, error: Error) => void
} {
  const logs = new Map<string, LogEntry[]>()
  const functions = new Set<string>()
  let authenticated = true
  const streamCallbacks: Array<{
    functionName: string
    onLog: (entry: LogEntry) => void
    onError: (error: Error) => void
  }> = []

  return {
    logs,
    functions,
    get authenticated() {
      return authenticated
    },
    set authenticated(value: boolean) {
      authenticated = value
    },
    streamCallbacks,
    async getLogs(
      functionName: string,
      options?: LogsQueryOptions
    ): Promise<ListLogsResponse> {
      if (!authenticated) {
        throw new Error('Unauthorized: Please log in first')
      }
      if (!functions.has(functionName)) {
        throw new Error(`Function "${functionName}" not found`)
      }

      let functionLogs = logs.get(functionName) ?? []

      // Apply since filter
      if (options?.since) {
        const sinceTime = new Date(options.since).getTime()
        functionLogs = functionLogs.filter(
          (log) => new Date(log.timestamp).getTime() >= sinceTime
        )
      }

      // Apply level filter
      if (options?.level) {
        const levelPriority: Record<LogLevel, number> = {
          debug: 0,
          info: 1,
          warn: 2,
          error: 3,
        }
        const minPriority = levelPriority[options.level]
        functionLogs = functionLogs.filter(
          (log) => levelPriority[log.level] >= minPriority
        )
      }

      // Apply limit
      const limit = options?.limit ?? 100
      const hasMore = functionLogs.length > limit
      const limitedLogs = functionLogs.slice(0, limit)

      return {
        logs: limitedLogs,
        hasMore,
        nextCursor: hasMore ? `cursor-${limit}` : undefined,
      }
    },
    streamLogs(
      functionName: string,
      _options: LogsQueryOptions,
      onLog: (entry: LogEntry) => void,
      onError: (error: Error) => void
    ): () => void {
      if (!authenticated) {
        onError(new Error('Unauthorized: Please log in first'))
        return () => {}
      }
      if (!functions.has(functionName)) {
        onError(new Error(`Function "${functionName}" not found`))
        return () => {}
      }

      const callback = { functionName, onLog, onError }
      streamCallbacks.push(callback)

      // Return unsubscribe function
      return () => {
        const index = streamCallbacks.indexOf(callback)
        if (index !== -1) {
          streamCallbacks.splice(index, 1)
        }
      }
    },
    async isAuthenticated(): Promise<boolean> {
      return authenticated
    },
    async functionExists(functionName: string): Promise<boolean> {
      return functions.has(functionName)
    },
    emitLog(functionName: string, entry: LogEntry): void {
      for (const callback of streamCallbacks) {
        if (callback.functionName === functionName) {
          callback.onLog(entry)
        }
      }
    },
    emitStreamError(functionName: string, error: Error): void {
      for (const callback of streamCallbacks) {
        if (callback.functionName === functionName) {
          callback.onError(error)
        }
      }
    },
  }
}

/**
 * Create a CLI context for testing
 */
function createTestContext(cwd = '/test'): CLIContext & {
  stdoutOutput: string[]
  stderrOutput: string[]
  exitCode: number | null
} {
  const stdoutOutput: string[] = []
  const stderrOutput: string[] = []
  let exitCode: number | null = null

  return {
    stdout: (text: string) => stdoutOutput.push(text),
    stderr: (text: string) => stderrOutput.push(text),
    exit: (code: number) => {
      exitCode = code
    },
    cwd,
    stdoutOutput,
    stderrOutput,
    get exitCode() {
      return exitCode
    },
    set exitCode(code: number | null) {
      exitCode = code
    },
  }
}

/**
 * Create a sample log entry for testing
 */
function createSampleLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: '2024-01-15T10:30:00.000Z',
    level: 'info',
    message: 'Request handled successfully',
    requestId: 'req-123',
    ...overrides,
  }
}

/**
 * Add sample logs to an API client for a function
 */
function addSampleLogs(
  apiClient: ReturnType<typeof createMockAPIClient>,
  functionName: string,
  count: number = 5
): void {
  apiClient.functions.add(functionName)
  const logEntries: LogEntry[] = []
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']

  for (let i = 0; i < count; i++) {
    const date = new Date(Date.now() - (count - i) * 60000) // Each log 1 minute apart
    logEntries.push(
      createSampleLogEntry({
        timestamp: date.toISOString(),
        level: levels[i % levels.length],
        message: `Log message ${i + 1}`,
        requestId: `req-${i + 1}`,
      })
    )
  }

  apiClient.logs.set(functionName, logEntries)
}

describe('dotdo logs', () => {
  let context: ReturnType<typeof createTestContext>
  let apiClient: ReturnType<typeof createMockAPIClient>

  beforeEach(() => {
    context = createTestContext('/projects/my-function')
    apiClient = createMockAPIClient()
  })

  describe('dotdo logs <name>', () => {
    it('should show function logs for existing function', async () => {
      addSampleLogs(apiClient, 'my-function', 5)

      const result = await runLogs('my-function', {}, context, apiClient)

      expect(result.exitCode).toBe(0)
      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('Log message')
    })

    it('should display multiple log entries', async () => {
      addSampleLogs(apiClient, 'my-function', 3)

      await runLogs('my-function', {}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('Log message 1')
      expect(output).toContain('Log message 2')
      expect(output).toContain('Log message 3')
    })

    it('should fail if no function name is provided', async () => {
      const result = await runLogs('', {}, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/function name.*required/i)
    })

    it('should return exit code 1 for non-existent function', async () => {
      const result = await runLogs('nonexistent-function', {}, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/not found|does not exist/i)
    })

    it('should output error message to stderr for non-existent function', async () => {
      await runLogs('nonexistent-function', {}, context, apiClient)

      const stderrOutput = context.stderrOutput.join('\n')
      expect(stderrOutput).toMatch(/not found|does not exist/i)
      expect(stderrOutput).toContain('nonexistent-function')
    })
  })

  describe('--follow flag for real-time streaming', () => {
    it('should enable real-time log streaming with --follow', async () => {
      apiClient.functions.add('my-function')

      // Start the logs command with follow
      const logsPromise = runLogs('my-function', { follow: true }, context, apiClient)

      // Emit some logs
      await new Promise((resolve) => setTimeout(resolve, 10))
      apiClient.emitLog('my-function', createSampleLogEntry({ message: 'Streamed log 1' }))
      apiClient.emitLog('my-function', createSampleLogEntry({ message: 'Streamed log 2' }))

      // Cancel the stream (simulate Ctrl+C)
      context.exit(0)

      await logsPromise

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('Streamed log 1')
      expect(output).toContain('Streamed log 2')
    })

    it('should continue streaming until interrupted', async () => {
      apiClient.functions.add('my-function')

      const logsPromise = runLogs('my-function', { follow: true }, context, apiClient)

      // Verify stream is active
      expect(apiClient.streamCallbacks.length).toBeGreaterThan(0)

      // Exit to stop streaming
      context.exit(0)
      await logsPromise

      expect(context.exitCode).toBe(0)
    })

    it('should handle stream errors gracefully', async () => {
      apiClient.functions.add('my-function')

      const logsPromise = runLogs('my-function', { follow: true }, context, apiClient)

      await new Promise((resolve) => setTimeout(resolve, 10))
      apiClient.emitStreamError('my-function', new Error('Connection lost'))

      await logsPromise

      const stderrOutput = context.stderrOutput.join('\n')
      expect(stderrOutput).toMatch(/error|connection/i)
    })

    it('should display streaming indicator when --follow is used', async () => {
      apiClient.functions.add('my-function')

      const logsPromise = runLogs('my-function', { follow: true }, context, apiClient)

      await new Promise((resolve) => setTimeout(resolve, 10))
      context.exit(0)

      await logsPromise

      const output = context.stdoutOutput.join('\n') + context.stderrOutput.join('\n')
      expect(output).toMatch(/streaming|watching|following|live/i)
    })
  })

  describe('--since flag for time filtering', () => {
    it('should filter logs by time with --since', async () => {
      apiClient.functions.add('my-function')
      const now = Date.now()

      // Add old logs and new logs
      apiClient.logs.set('my-function', [
        createSampleLogEntry({
          timestamp: new Date(now - 3600000).toISOString(), // 1 hour ago
          message: 'Old log',
        }),
        createSampleLogEntry({
          timestamp: new Date(now - 1800000).toISOString(), // 30 minutes ago
          message: 'Recent log',
        }),
        createSampleLogEntry({
          timestamp: new Date(now - 300000).toISOString(), // 5 minutes ago
          message: 'Very recent log',
        }),
      ])

      const sinceTime = new Date(now - 1800000).toISOString() // 30 minutes ago
      await runLogs('my-function', { since: sinceTime }, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).not.toContain('Old log')
      expect(output).toContain('Recent log')
      expect(output).toContain('Very recent log')
    })

    it('should support relative time format for --since', async () => {
      addSampleLogs(apiClient, 'my-function', 5)

      // This tests the API contract - the implementation should convert '1h' to ISO timestamp
      const result = await runLogs('my-function', { since: '1h' }, context, apiClient)

      expect(result.exitCode).toBe(0)
    })

    it('should support ISO timestamp format for --since', async () => {
      addSampleLogs(apiClient, 'my-function', 5)

      const result = await runLogs(
        'my-function',
        { since: '2024-01-15T10:00:00Z' },
        context,
        apiClient
      )

      expect(result.exitCode).toBe(0)
    })

    it('should fail with invalid --since format', async () => {
      apiClient.functions.add('my-function')

      const result = await runLogs(
        'my-function',
        { since: 'invalid-time' },
        context,
        apiClient
      )

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/invalid.*time|invalid.*since/i)
    })
  })

  describe('--level flag for level filtering', () => {
    beforeEach(() => {
      apiClient.functions.add('my-function')
      apiClient.logs.set('my-function', [
        createSampleLogEntry({ level: 'debug', message: 'Debug message' }),
        createSampleLogEntry({ level: 'info', message: 'Info message' }),
        createSampleLogEntry({ level: 'warn', message: 'Warning message' }),
        createSampleLogEntry({ level: 'error', message: 'Error message' }),
      ])
    })

    it('should filter logs by level with --level debug (shows all)', async () => {
      await runLogs('my-function', { level: 'debug' }, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('Debug message')
      expect(output).toContain('Info message')
      expect(output).toContain('Warning message')
      expect(output).toContain('Error message')
    })

    it('should filter logs by level with --level info', async () => {
      await runLogs('my-function', { level: 'info' }, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).not.toContain('Debug message')
      expect(output).toContain('Info message')
      expect(output).toContain('Warning message')
      expect(output).toContain('Error message')
    })

    it('should filter logs by level with --level warn', async () => {
      await runLogs('my-function', { level: 'warn' }, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).not.toContain('Debug message')
      expect(output).not.toContain('Info message')
      expect(output).toContain('Warning message')
      expect(output).toContain('Error message')
    })

    it('should filter logs by level with --level error', async () => {
      await runLogs('my-function', { level: 'error' }, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).not.toContain('Debug message')
      expect(output).not.toContain('Info message')
      expect(output).not.toContain('Warning message')
      expect(output).toContain('Error message')
    })

    it('should fail with invalid --level value', async () => {
      // @ts-expect-error - Testing invalid input
      const result = await runLogs('my-function', { level: 'invalid' }, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/invalid.*level/i)
      expect(result.error).toMatch(/debug|info|warn|error/i)
    })
  })

  describe('--limit flag for pagination', () => {
    it('should limit number of logs returned with --limit', async () => {
      addSampleLogs(apiClient, 'my-function', 10)

      await runLogs('my-function', { limit: 3 }, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      // Should only show 3 log entries
      const logCount = (output.match(/Log message/g) || []).length
      expect(logCount).toBe(3)
    })

    it('should default to reasonable limit when not specified', async () => {
      addSampleLogs(apiClient, 'my-function', 200)

      await runLogs('my-function', {}, context, apiClient)

      // Default limit should be applied (100 based on mock client)
      const output = context.stdoutOutput.join('\n')
      expect(output.length).toBeGreaterThan(0)
    })

    it('should indicate when more logs are available', async () => {
      addSampleLogs(apiClient, 'my-function', 150)

      await runLogs('my-function', { limit: 50 }, context, apiClient)

      const output = context.stdoutOutput.join('\n') + context.stderrOutput.join('\n')
      expect(output).toMatch(/more.*available|showing.*of|truncated/i)
    })

    it('should accept limit of 1', async () => {
      addSampleLogs(apiClient, 'my-function', 5)

      const result = await runLogs('my-function', { limit: 1 }, context, apiClient)

      expect(result.exitCode).toBe(0)
      const output = context.stdoutOutput.join('\n')
      const logCount = (output.match(/Log message/g) || []).length
      expect(logCount).toBe(1)
    })

    it('should fail with invalid --limit value (negative)', async () => {
      apiClient.functions.add('my-function')

      const result = await runLogs('my-function', { limit: -1 }, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/invalid.*limit|must be positive/i)
    })

    it('should fail with invalid --limit value (zero)', async () => {
      apiClient.functions.add('my-function')

      const result = await runLogs('my-function', { limit: 0 }, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/invalid.*limit|must be.*greater/i)
    })
  })

  describe('log entry formatting with timestamp and level', () => {
    it('should display timestamp for each log entry', async () => {
      apiClient.functions.add('my-function')
      apiClient.logs.set('my-function', [
        createSampleLogEntry({
          timestamp: '2024-01-15T10:30:45.123Z',
          message: 'Test message',
        }),
      ])

      await runLogs('my-function', {}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      // Should contain some form of timestamp (ISO, human readable, etc.)
      expect(output).toMatch(/\d{4}[-/]\d{2}[-/]\d{2}|\d{2}:\d{2}:\d{2}/)
    })

    it('should display log level for each entry', async () => {
      apiClient.functions.add('my-function')
      apiClient.logs.set('my-function', [
        createSampleLogEntry({ level: 'info', message: 'Info test' }),
        createSampleLogEntry({ level: 'error', message: 'Error test' }),
      ])

      await runLogs('my-function', {}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/info/i)
      expect(output).toMatch(/error/i)
    })

    it('should display message content', async () => {
      apiClient.functions.add('my-function')
      apiClient.logs.set('my-function', [
        createSampleLogEntry({ message: 'Specific test message content' }),
      ])

      await runLogs('my-function', {}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('Specific test message content')
    })

    it('should format logs in a readable manner', async () => {
      apiClient.functions.add('my-function')
      apiClient.logs.set('my-function', [
        createSampleLogEntry({
          timestamp: '2024-01-15T10:30:00.000Z',
          level: 'info',
          message: 'Handler started',
        }),
      ])

      await runLogs('my-function', {}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      // Should have structured output with timestamp, level, and message visible
      expect(output).toMatch(/\d{2}:\d{2}/) // Time portion
      expect(output).toMatch(/info/i)
      expect(output).toContain('Handler started')
    })

    it('should visually distinguish different log levels', async () => {
      apiClient.functions.add('my-function')
      apiClient.logs.set('my-function', [
        createSampleLogEntry({ level: 'error', message: 'Error log' }),
        createSampleLogEntry({ level: 'warn', message: 'Warning log' }),
        createSampleLogEntry({ level: 'info', message: 'Info log' }),
        createSampleLogEntry({ level: 'debug', message: 'Debug log' }),
      ])

      await runLogs('my-function', {}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      // Different levels should produce different output
      expect(output).toContain('Error log')
      expect(output).toContain('Warning log')
      expect(output).toContain('Info log')
      expect(output).toContain('Debug log')
    })

    it('should display request ID when available', async () => {
      apiClient.functions.add('my-function')
      apiClient.logs.set('my-function', [
        createSampleLogEntry({
          message: 'Test message',
          requestId: 'req-abc-123',
        }),
      ])

      await runLogs('my-function', {}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('req-abc-123')
    })
  })

  describe('handling no logs gracefully', () => {
    it('should handle empty logs list gracefully', async () => {
      apiClient.functions.add('my-function')
      apiClient.logs.set('my-function', [])

      const result = await runLogs('my-function', {}, context, apiClient)

      expect(result.exitCode).toBe(0)
      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/no logs|empty|no entries/i)
    })

    it('should show helpful message when no logs found', async () => {
      apiClient.functions.add('my-function')
      apiClient.logs.set('my-function', [])

      await runLogs('my-function', {}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/no logs found|no log entries/i)
    })

    it('should handle no logs matching filter criteria', async () => {
      apiClient.functions.add('my-function')
      apiClient.logs.set('my-function', [
        createSampleLogEntry({ level: 'debug', message: 'Debug only' }),
      ])

      await runLogs('my-function', { level: 'error' }, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/no logs|no entries|no matching/i)
    })

    it('should not show error for empty logs', async () => {
      apiClient.functions.add('my-function')
      apiClient.logs.set('my-function', [])

      const result = await runLogs('my-function', {}, context, apiClient)

      expect(result.exitCode).toBe(0)
      expect(context.stderrOutput.length).toBe(0)
    })
  })

  describe('authentication requirement', () => {
    it('should require authentication to view logs', async () => {
      addSampleLogs(apiClient, 'my-function', 5)
      apiClient.authenticated = false

      const result = await runLogs('my-function', {}, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/unauthorized|login|authenticate/i)
    })

    it('should suggest login command when not authenticated', async () => {
      addSampleLogs(apiClient, 'my-function', 5)
      apiClient.authenticated = false

      const result = await runLogs('my-function', {}, context, apiClient)

      expect(result.error).toMatch(/dotdo login|please log in/i)
    })

    it('should require authentication for streaming logs', async () => {
      apiClient.functions.add('my-function')
      apiClient.authenticated = false

      const result = await runLogs('my-function', { follow: true }, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/unauthorized|login|authenticate/i)
    })

    it('should output authentication error to stderr', async () => {
      apiClient.functions.add('my-function')
      apiClient.authenticated = false

      await runLogs('my-function', {}, context, apiClient)

      const stderrOutput = context.stderrOutput.join('\n')
      expect(stderrOutput).toMatch(/unauthorized|login|authenticate/i)
    })
  })

  describe('combined options', () => {
    it('should support --since and --level together', async () => {
      apiClient.functions.add('my-function')
      const now = Date.now()

      apiClient.logs.set('my-function', [
        createSampleLogEntry({
          timestamp: new Date(now - 3600000).toISOString(),
          level: 'error',
          message: 'Old error',
        }),
        createSampleLogEntry({
          timestamp: new Date(now - 300000).toISOString(),
          level: 'info',
          message: 'Recent info',
        }),
        createSampleLogEntry({
          timestamp: new Date(now - 300000).toISOString(),
          level: 'error',
          message: 'Recent error',
        }),
      ])

      const sinceTime = new Date(now - 1800000).toISOString()
      await runLogs('my-function', { since: sinceTime, level: 'error' }, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).not.toContain('Old error')
      expect(output).not.toContain('Recent info')
      expect(output).toContain('Recent error')
    })

    it('should support --level and --limit together', async () => {
      apiClient.functions.add('my-function')
      apiClient.logs.set('my-function', [
        createSampleLogEntry({ level: 'error', message: 'Error 1' }),
        createSampleLogEntry({ level: 'error', message: 'Error 2' }),
        createSampleLogEntry({ level: 'error', message: 'Error 3' }),
        createSampleLogEntry({ level: 'info', message: 'Info 1' }),
      ])

      await runLogs('my-function', { level: 'error', limit: 2 }, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      const errorCount = (output.match(/Error \d/g) || []).length
      expect(errorCount).toBe(2)
      expect(output).not.toContain('Info 1')
    })

    it('should support --follow with --level filter', async () => {
      apiClient.functions.add('my-function')

      const logsPromise = runLogs(
        'my-function',
        { follow: true, level: 'error' },
        context,
        apiClient
      )

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Emit logs of different levels
      apiClient.emitLog('my-function', createSampleLogEntry({ level: 'info', message: 'Info log' }))
      apiClient.emitLog('my-function', createSampleLogEntry({ level: 'error', message: 'Error log' }))

      context.exit(0)
      await logsPromise

      const output = context.stdoutOutput.join('\n')
      // With level filter, should only show error logs
      expect(output).toContain('Error log')
      // Info should be filtered out (implementation dependent)
    })
  })

  describe('error handling', () => {
    it('should handle API connection errors gracefully', async () => {
      apiClient.functions.add('my-function')
      apiClient.getLogs = async () => {
        throw new Error('Connection refused')
      }

      const result = await runLogs('my-function', {}, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/connection|error|failed/i)
    })

    it('should handle API timeout errors', async () => {
      apiClient.functions.add('my-function')
      apiClient.getLogs = async () => {
        throw new Error('Request timeout')
      }

      const result = await runLogs('my-function', {}, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/timeout|error|failed/i)
    })

    it('should output API errors to stderr', async () => {
      apiClient.functions.add('my-function')
      apiClient.getLogs = async () => {
        throw new Error('Server error')
      }

      await runLogs('my-function', {}, context, apiClient)

      const stderrOutput = context.stderrOutput.join('\n')
      expect(stderrOutput).toMatch(/error/i)
    })

    it('should handle rate limiting gracefully', async () => {
      apiClient.functions.add('my-function')
      apiClient.getLogs = async () => {
        throw new Error('Rate limit exceeded')
      }

      const result = await runLogs('my-function', {}, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/rate limit|too many requests/i)
    })
  })

  describe('function name validation', () => {
    it('should accept valid function names', async () => {
      const validNames = ['my-function', 'my_function', 'myFunction', 'function123']

      for (const name of validNames) {
        const testContext = createTestContext()
        const testApiClient = createMockAPIClient()
        addSampleLogs(testApiClient, name, 1)

        const result = await runLogs(name, {}, testContext, testApiClient)
        expect(result.exitCode).toBe(0)
      }
    })

    it('should accept function names with namespace', async () => {
      addSampleLogs(apiClient, 'my-namespace/my-function', 1)

      const result = await runLogs('my-namespace/my-function', {}, context, apiClient)

      expect(result.exitCode).toBe(0)
    })

    it('should reject invalid function names', async () => {
      const invalidNames = ['', ' ', '../escape', 'func name', 'func\nname']

      for (const name of invalidNames) {
        const testContext = createTestContext()
        const testApiClient = createMockAPIClient()

        const result = await runLogs(name, {}, testContext, testApiClient)
        expect(result.exitCode).toBe(1)
      }
    })
  })

  describe('output formatting', () => {
    it('should write logs to stdout', async () => {
      addSampleLogs(apiClient, 'my-function', 3)

      await runLogs('my-function', {}, context, apiClient)

      expect(context.stdoutOutput.length).toBeGreaterThan(0)
    })

    it('should write errors to stderr', async () => {
      const result = await runLogs('nonexistent', {}, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(context.stderrOutput.length).toBeGreaterThan(0)
    })

    it('should format timestamps in human-readable format', async () => {
      apiClient.functions.add('my-function')
      apiClient.logs.set('my-function', [
        createSampleLogEntry({
          timestamp: '2024-01-15T10:30:45.123Z',
          message: 'Test',
        }),
      ])

      await runLogs('my-function', {}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      // Should include time in readable format
      expect(output).toMatch(/10:30|Jan.*15|2024/)
    })
  })
})
