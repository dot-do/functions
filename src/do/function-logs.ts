/**
 * FunctionLogs Durable Object - Centralized logging for serverless functions
 *
 * This Durable Object provides:
 * - Append log entries with structured data
 * - Query logs with time range, level, and pagination
 * - Retention policy (auto-delete old logs)
 * - Real-time streaming via WebSocket
 * - Aggregate metrics (count by level, error rates)
 * - Multi-function support
 *
 * Storage: SQLite via Durable Object ctx.storage.sql (persisted across evictions)
 *
 * @module durable-object/function-logs
 */

import { createLogger } from '../core/logger'

const logger = createLogger({ context: { component: 'function-logs' } })

// ============================================================================
// SCHEMA VERSION
// ============================================================================

/** Current schema version for FunctionLogs migrations */
export const FUNCTION_LOGS_SCHEMA_VERSION = 1

// ============================================================================
// TYPES
// ============================================================================

/**
 * Log severity levels ordered by severity
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/**
 * Log entry structure
 */
export interface LogEntry {
  /** Unique log entry ID */
  id: string
  /** Function ID that generated the log */
  functionId: string
  /** Timestamp in milliseconds since epoch */
  timestamp: number
  /** Log severity level */
  level: LogLevel
  /** Log message */
  message: string
  /** Optional structured metadata */
  metadata?: Record<string, unknown>
  /** Optional request ID for correlation */
  requestId?: string
  /** Optional execution duration in milliseconds */
  durationMs?: number
}

/**
 * Input for appending a log entry
 */
export interface LogEntryInput {
  /** Function ID that generated the log */
  functionId: string
  /** Log severity level */
  level: LogLevel
  /** Log message */
  message: string
  /** Optional timestamp (defaults to current time) */
  timestamp?: number
  /** Optional structured metadata */
  metadata?: Record<string, unknown>
  /** Optional request ID for correlation */
  requestId?: string
  /** Optional execution duration in milliseconds */
  durationMs?: number
}

/**
 * Query parameters for fetching logs
 */
export interface LogQuery {
  /** Function ID to filter by */
  functionId: string
  /** Start time filter (inclusive) */
  startTime?: number
  /** End time filter (inclusive) */
  endTime?: number
  /** Filter by single level */
  level?: LogLevel
  /** Filter by multiple levels */
  levels?: LogLevel[]
  /** Minimum level (severity threshold) */
  minLevel?: LogLevel
  /** Maximum results to return */
  limit?: number
  /** Cursor for pagination */
  cursor?: string
  /** Sort order */
  order?: 'asc' | 'desc'
}

/**
 * Query result with pagination
 */
export interface LogQueryResult {
  /** Log entries */
  entries: LogEntry[]
  /** Cursor for next page (null if no more results) */
  cursor: string | null
  /** Whether more results are available */
  hasMore: boolean
  /** Total count (if available) */
  total?: number
}

/**
 * Log metrics for a function
 */
export interface LogMetrics {
  /** Total log count */
  total: number
  /** Count by log level */
  countByLevel: Record<LogLevel, number>
  /** Error rate (error + fatal / total) */
  errorRate: number
  /** Logs per minute rate */
  logsPerMinute: number
  /** Average duration in milliseconds */
  avgDurationMs?: number
  /** P50 duration in milliseconds */
  p50DurationMs?: number
  /** P95 duration in milliseconds */
  p95DurationMs?: number
  /** P99 duration in milliseconds */
  p99DurationMs?: number
  /** Timestamp of most recent log */
  lastLogTimestamp?: number
}

/**
 * Aggregated metrics across all functions
 */
export interface AggregatedMetrics extends LogMetrics {
  /** Metrics per function */
  byFunction: Record<string, LogMetrics>
}

/**
 * Retention policy configuration
 */
export interface RetentionPolicy {
  /** Maximum age in milliseconds */
  maxAge?: number
  /** Maximum count of logs to retain */
  maxCount?: number
  /** Apply retention per function independently */
  perFunction?: boolean
  /** Scheduled cleanup interval in milliseconds */
  interval?: number
}

/**
 * Retention statistics
 */
export interface RetentionStats {
  /** Total number of logs */
  totalLogs: number
  /** Oldest log timestamp */
  oldestTimestamp?: number
  /** Newest log timestamp */
  newestTimestamp?: number
}

/**
 * WebSocket streaming options
 */
export interface StreamOptions {
  /** Function ID to subscribe to */
  functionId: string
  /** Filter by levels */
  levels?: LogLevel[]
  /** Heartbeat interval in milliseconds */
  heartbeat?: number
  /** Number of recent logs to send on connect */
  tail?: number
}

/**
 * Search query parameters
 */
export interface SearchQuery {
  /** Search query string */
  query: string
  /** Optional function ID filter */
  functionId?: string
  /** Maximum results */
  limit?: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
}

// ============================================================================
// SQL ROW TYPE
// ============================================================================

/**
 * Row shape returned from the logs SQLite table
 */
interface LogRow {
  id: string
  function_id: string
  timestamp: number
  level: LogLevel
  message: string
  metadata: string | null
  request_id: string | null
  duration_ms: number | null
  created_at: number
}

// ============================================================================
// FUNCTION LOGS DURABLE OBJECT
// ============================================================================

/**
 * FunctionLogs Durable Object
 *
 * Provides centralized logging infrastructure for serverless functions.
 * Uses SQLite storage for persistence across DO evictions with WebSocket streaming support.
 */
export class FunctionLogs {
  private state: DurableObjectState
  private env: unknown
  private schemaInitialized = false
  private subscribers: Map<string, Set<WebSocket>> = new Map()
  private retentionTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimers: Map<WebSocket, ReturnType<typeof setInterval>> = new Map()

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state
    this.env = env
  }

  // ===========================================================================
  // SCHEMA INITIALIZATION
  // ===========================================================================

  /**
   * Initialize the SQLite schema for log storage.
   * Modeled after FunctionExecutor's initializeSchema pattern.
   */
  private initializeSchema(): void {
    if (this.schemaInitialized) return

    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        function_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT,
        request_id TEXT,
        duration_ms INTEGER,
        created_at INTEGER NOT NULL
      )
    `)

    this.state.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_logs_function_id
      ON logs (function_id)
    `)

    this.state.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp
      ON logs (timestamp)
    `)

    this.state.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_logs_function_id_timestamp
      ON logs (function_id, timestamp)
    `)

    this.state.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_logs_request_id
      ON logs (request_id)
    `)

    this.schemaInitialized = true
  }

  // ===========================================================================
  // LOG ENTRY OPERATIONS
  // ===========================================================================

  /**
   * Append a log entry
   */
  async append(input: LogEntryInput): Promise<LogEntry> {
    this.initializeSchema()

    const entry: LogEntry = {
      id: this.generateId(),
      functionId: input.functionId,
      timestamp: input.timestamp ?? Date.now(),
      level: input.level,
      message: input.message,
      metadata: input.metadata,
      requestId: input.requestId,
      durationMs: input.durationMs,
    }

    // Persist to SQLite
    this.state.storage.sql.exec(
      `INSERT INTO logs (id, function_id, timestamp, level, message, metadata, request_id, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.id,
      entry.functionId,
      entry.timestamp,
      entry.level,
      entry.message,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      entry.requestId ?? null,
      entry.durationMs ?? null,
      Date.now(),
    )

    // Notify WebSocket subscribers
    this.notifySubscribers(entry)

    return entry
  }

  /**
   * Append multiple log entries in batch
   */
  async appendBatch(inputs: LogEntryInput[]): Promise<LogEntry[]> {
    const entries: LogEntry[] = []
    for (const input of inputs) {
      const entry = await this.append(input)
      entries.push(entry)
    }
    return entries
  }

  // ===========================================================================
  // QUERY OPERATIONS
  // ===========================================================================

  /**
   * Query logs for a specific function
   */
  async query(query: LogQuery): Promise<LogQueryResult> {
    this.initializeSchema()

    const rows = this.queryRows(query)

    // Apply sorting
    const order = query.order || 'desc'
    rows.sort((a, b) => {
      const diff = a.timestamp - b.timestamp
      return order === 'asc' ? diff : -diff
    })

    // Convert rows to LogEntry objects
    const entries = rows.map((row) => this.rowToEntry(row))

    // Apply pagination
    return this.applyPagination(entries, query.limit, query.cursor)
  }

  /**
   * Query logs across all functions
   */
  async queryAll(options: Omit<LogQuery, 'functionId'>): Promise<LogQueryResult> {
    this.initializeSchema()

    // Get all logs from SQLite
    let rows = this.state.storage.sql.exec<LogRow>(
      `SELECT * FROM logs`
    ).toArray()

    // Apply filters
    if (options.startTime !== undefined) {
      rows = rows.filter((r) => r.timestamp >= options.startTime!)
    }
    if (options.endTime !== undefined) {
      rows = rows.filter((r) => r.timestamp <= options.endTime!)
    }
    if (options.level) {
      rows = rows.filter((r) => r.level === options.level)
    }
    if (options.levels) {
      rows = rows.filter((r) => options.levels!.includes(r.level))
    }
    if (options.minLevel) {
      const minSeverity = LOG_LEVEL_SEVERITY[options.minLevel]
      rows = rows.filter((r) => LOG_LEVEL_SEVERITY[r.level] >= minSeverity)
    }

    // Apply sorting
    const order = options.order || 'desc'
    rows.sort((a, b) => {
      const diff = a.timestamp - b.timestamp
      return order === 'asc' ? diff : -diff
    })

    const entries = rows.map((row) => this.rowToEntry(row))

    // Apply pagination
    return this.applyPagination(entries, options.limit, options.cursor)
  }

  /**
   * Query logs by request ID
   */
  async queryByRequestId(requestId: string): Promise<LogQueryResult> {
    this.initializeSchema()

    const rows = this.state.storage.sql.exec<LogRow>(
      `SELECT * FROM logs WHERE request_id = ?`,
      requestId
    ).toArray()

    const entries = rows.map((row) => this.rowToEntry(row))

    return {
      entries,
      cursor: null,
      hasMore: false,
    }
  }

  /**
   * Search logs by message content
   */
  async search(query: SearchQuery): Promise<LogQueryResult> {
    this.initializeSchema()

    let rows: LogRow[]
    if (query.functionId) {
      rows = this.state.storage.sql.exec<LogRow>(
        `SELECT * FROM logs WHERE function_id = ?`,
        query.functionId
      ).toArray()
    } else {
      rows = this.state.storage.sql.exec<LogRow>(
        `SELECT * FROM logs`
      ).toArray()
    }

    const searchQuery = query.query.toLowerCase()
    const filtered = rows.filter((r) => r.message.toLowerCase().includes(searchQuery))

    const limit = query.limit || DEFAULT_LIMIT
    const hasMore = filtered.length > limit
    const sliced = filtered.slice(0, limit)

    return {
      entries: sliced.map((row) => this.rowToEntry(row)),
      cursor: null,
      hasMore,
    }
  }

  // ===========================================================================
  // METRICS OPERATIONS
  // ===========================================================================

  /**
   * Get metrics for a specific function
   */
  async getMetrics(options: { functionId: string; startTime?: number; endTime?: number }): Promise<LogMetrics> {
    this.initializeSchema()

    let rows = this.state.storage.sql.exec<LogRow>(
      `SELECT * FROM logs WHERE function_id = ?`,
      options.functionId
    ).toArray()

    if (options.startTime !== undefined) {
      rows = rows.filter((r) => r.timestamp >= options.startTime!)
    }
    if (options.endTime !== undefined) {
      rows = rows.filter((r) => r.timestamp <= options.endTime!)
    }

    const countByLevel: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      fatal: 0,
    }

    const durations: number[] = []
    let lastTimestamp: number | undefined

    for (const row of rows) {
      countByLevel[row.level]++
      if (row.duration_ms !== null && row.duration_ms !== undefined) {
        durations.push(row.duration_ms)
      }
      if (lastTimestamp === undefined || row.timestamp > lastTimestamp) {
        lastTimestamp = row.timestamp
      }
    }

    const total = rows.length
    const errorCount = countByLevel.error + countByLevel.fatal
    const errorRate = total > 0 ? errorCount / total : 0

    // Calculate time range for logs per minute
    const timestamps = rows.map((r) => r.timestamp)
    const minTime = timestamps.length > 0 ? Math.min(...timestamps) : Date.now()
    const maxTime = timestamps.length > 0 ? Math.max(...timestamps) : Date.now()
    const timeRangeMinutes = Math.max(1, (maxTime - minTime) / 60000)
    const logsPerMinute = total / timeRangeMinutes

    // Calculate duration percentiles
    durations.sort((a, b) => a - b)
    const avgDurationMs = durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : undefined
    const p50DurationMs = durations.length > 0
      ? durations[Math.floor(durations.length * 0.5)]
      : undefined
    const p95DurationMs = durations.length > 0
      ? durations[Math.floor(durations.length * 0.95)]
      : undefined
    const p99DurationMs = durations.length > 0
      ? durations[Math.floor(durations.length * 0.99)]
      : undefined

    return {
      total,
      countByLevel,
      errorRate,
      logsPerMinute,
      avgDurationMs,
      p50DurationMs,
      p95DurationMs,
      p99DurationMs,
      lastLogTimestamp: lastTimestamp,
    }
  }

  /**
   * Get aggregated metrics across all functions
   */
  async getAggregatedMetrics(): Promise<AggregatedMetrics> {
    this.initializeSchema()

    const functionIds = await this.listFunctions()
    const byFunction: Record<string, LogMetrics> = {}

    for (const functionId of functionIds) {
      byFunction[functionId] = await this.getMetrics({ functionId })
    }

    // Aggregate totals
    const countByLevel: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      fatal: 0,
    }

    let total = 0
    let lastTimestamp: number | undefined

    for (const metrics of Object.values(byFunction)) {
      total += metrics.total
      for (const level of Object.keys(countByLevel) as LogLevel[]) {
        countByLevel[level] += metrics.countByLevel[level]
      }
      if (metrics.lastLogTimestamp !== undefined) {
        if (lastTimestamp === undefined || metrics.lastLogTimestamp > lastTimestamp) {
          lastTimestamp = metrics.lastLogTimestamp
        }
      }
    }

    const errorCount = countByLevel.error + countByLevel.fatal
    const errorRate = total > 0 ? errorCount / total : 0

    return {
      total,
      countByLevel,
      errorRate,
      logsPerMinute: 0, // Would need time range calculation
      lastLogTimestamp: lastTimestamp,
      byFunction,
    }
  }

  // ===========================================================================
  // RETENTION OPERATIONS
  // ===========================================================================

  /**
   * Apply retention policy
   * @returns Number of logs deleted
   */
  async applyRetention(policy: RetentionPolicy): Promise<number> {
    this.initializeSchema()

    let deleted = 0
    const now = Date.now()

    if (policy.perFunction) {
      const functionIds = await this.listFunctions()
      for (const functionId of functionIds) {
        deleted += this.applyRetentionForFunction(functionId, policy, now)
      }
    } else {
      const functionIds = await this.listFunctions()
      for (const functionId of functionIds) {
        deleted += this.applyRetentionForFunction(functionId, policy, now)
      }
    }

    return deleted
  }

  /**
   * Get retention statistics
   */
  async getRetentionStats(): Promise<RetentionStats> {
    this.initializeSchema()

    const rows = this.state.storage.sql.exec<LogRow>(
      `SELECT * FROM logs`
    ).toArray()

    const totalLogs = rows.length

    if (totalLogs === 0) {
      return { totalLogs: 0 }
    }

    const timestamps = rows.map((r) => r.timestamp)
    return {
      totalLogs,
      oldestTimestamp: Math.min(...timestamps),
      newestTimestamp: Math.max(...timestamps),
    }
  }

  /**
   * Schedule automatic retention cleanup
   */
  scheduleRetention(policy: RetentionPolicy & { interval: number }, callback?: () => void): void {
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer)
    }

    this.retentionTimer = setInterval(() => {
      this.applyRetention(policy).then(() => {
        if (callback) callback()
      })
    }, policy.interval)
  }

  // ===========================================================================
  // STREAMING OPERATIONS
  // ===========================================================================

  /**
   * Handle WebSocket connection for real-time streaming
   */
  async handleWebSocket(ws: WebSocket, options: StreamOptions): Promise<void> {
    this.initializeSchema()

    // Store subscription
    if (!this.subscribers.has(options.functionId)) {
      this.subscribers.set(options.functionId, new Set())
    }
    const subs = this.subscribers.get(options.functionId)
    if (subs) {
      subs.add(ws)
    }

    // Send initial history if tail is requested
    if (options.tail && options.tail > 0) {
      const rows = this.state.storage.sql.exec<LogRow>(
        `SELECT * FROM logs WHERE function_id = ?`,
        options.functionId
      ).toArray()

      // Sort by timestamp ascending to get chronological order, then take the last N
      rows.sort((a, b) => a.timestamp - b.timestamp)
      const historyRows = rows.slice(-options.tail)
      const historyEntries = historyRows.map((row) => this.rowToEntry(row))

      this.sendToWebSocket(ws, {
        type: 'history',
        entries: historyEntries,
      })
    }

    // Setup heartbeat if requested
    if (options.heartbeat && options.heartbeat > 0) {
      const timer = setInterval(() => {
        this.sendToWebSocket(ws, { type: 'heartbeat', timestamp: Date.now() })
      }, options.heartbeat)
      this.heartbeatTimers.set(ws, timer)
    }
  }

  // ===========================================================================
  // FUNCTION MANAGEMENT
  // ===========================================================================

  /**
   * List all function IDs with logs
   */
  async listFunctions(): Promise<string[]> {
    this.initializeSchema()

    const rows = this.state.storage.sql.exec<{ function_id: string }>(
      `SELECT DISTINCT function_id FROM logs`
    ).toArray()

    return rows.map((r) => r.function_id)
  }

  /**
   * Delete all logs for a function
   */
  async deleteLogs(functionId: string): Promise<void> {
    this.initializeSchema()

    this.state.storage.sql.exec(
      `DELETE FROM logs WHERE function_id = ?`,
      functionId
    )
  }

  // ===========================================================================
  // HTTP REQUEST HANDLER
  // ===========================================================================

  /**
   * Handle HTTP requests to the Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method

    try {
      // Handle WebSocket upgrade
      if (request.headers.get('Upgrade') === 'websocket') {
        return new Response('WebSocket upgrade', { status: 101 })
      }

      // Route requests
      if (url.pathname === '/logs' && method === 'POST') {
        const body = await request.json() as LogEntryInput
        if (!body.functionId || !body.level || !body.message) {
          return new Response(JSON.stringify({ error: 'Missing required fields' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const entry = await this.append(body)
        return new Response(JSON.stringify(entry), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.pathname === '/logs' && method === 'GET') {
        const functionId = url.searchParams.get('functionId')
        if (!functionId) {
          return new Response(JSON.stringify({ error: 'functionId required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const result = await this.query({
          functionId,
          limit: parseInt(url.searchParams.get('limit') || '100', 10),
          cursor: url.searchParams.get('cursor') || undefined,
        })
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.pathname.startsWith('/logs/') && method === 'DELETE') {
        const functionId = url.pathname.split('/')[2]
        await this.deleteLogs(functionId)
        return new Response(null, { status: 204 })
      }

      if (url.pathname === '/metrics' && method === 'GET') {
        const functionId = url.searchParams.get('functionId')
        if (!functionId) {
          return new Response(JSON.stringify({ error: 'functionId required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const metrics = await this.getMetrics({ functionId })
        return new Response(JSON.stringify(metrics), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not Found', { status: 404 })
    } catch (error) {
      logger.error('FunctionLogs error', { error: error instanceof Error ? error : new Error(String(error)) })
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private generateId(): string {
    return `log_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  }

  /**
   * Convert a SQLite row to a LogEntry object
   */
  private rowToEntry(row: LogRow): LogEntry {
    const entry: LogEntry = {
      id: row.id,
      functionId: row.function_id,
      timestamp: row.timestamp,
      level: row.level,
      message: row.message,
    }

    if (row.metadata) {
      try {
        entry.metadata = JSON.parse(row.metadata)
      } catch {
        // Ignore invalid JSON metadata
      }
    }

    if (row.request_id) {
      entry.requestId = row.request_id
    }

    if (row.duration_ms !== null && row.duration_ms !== undefined) {
      entry.durationMs = row.duration_ms
    }

    return entry
  }

  /**
   * Query rows from SQLite for a specific function with filters
   */
  private queryRows(query: LogQuery): LogRow[] {
    let rows = this.state.storage.sql.exec<LogRow>(
      `SELECT * FROM logs WHERE function_id = ?`,
      query.functionId
    ).toArray()

    // Apply filters in-memory (like the original implementation)
    if (query.startTime !== undefined) {
      rows = rows.filter((r) => r.timestamp >= query.startTime!)
    }
    if (query.endTime !== undefined) {
      rows = rows.filter((r) => r.timestamp <= query.endTime!)
    }
    if (query.level) {
      rows = rows.filter((r) => r.level === query.level)
    }
    if (query.levels) {
      rows = rows.filter((r) => query.levels!.includes(r.level))
    }
    if (query.minLevel) {
      const minSeverity = LOG_LEVEL_SEVERITY[query.minLevel]
      rows = rows.filter((r) => LOG_LEVEL_SEVERITY[r.level] >= minSeverity)
    }

    return rows
  }

  private notifySubscribers(entry: LogEntry): void {
    const subscribers = this.subscribers.get(entry.functionId)
    if (subscribers) {
      for (const ws of subscribers) {
        this.sendToWebSocket(ws, { type: 'log', entry })
      }
    }
  }

  private sendToWebSocket(ws: WebSocket, data: unknown): void {
    try {
      ws.send(JSON.stringify(data))
    } catch {
      // Ignore send errors for closed connections
    }
  }

  private applyPagination(
    entries: LogEntry[],
    limit?: number,
    cursor?: string
  ): LogQueryResult {
    const effectiveLimit = Math.min(limit || DEFAULT_LIMIT, MAX_LIMIT)
    let offset = 0

    if (cursor) {
      try {
        const decoded = JSON.parse(atob(cursor))
        offset = decoded.offset
      } catch {
        // Invalid cursor, start from beginning
      }
    }

    const sliced = entries.slice(offset, offset + effectiveLimit)
    const hasMore = offset + effectiveLimit < entries.length

    let nextCursor: string | null = null
    if (hasMore) {
      nextCursor = btoa(JSON.stringify({ offset: offset + effectiveLimit }))
    }

    return {
      entries: sliced,
      cursor: nextCursor,
      hasMore,
    }
  }

  /**
   * Apply retention policy for a specific function
   * @returns Number of logs deleted
   */
  private applyRetentionForFunction(
    functionId: string,
    policy: RetentionPolicy,
    now: number
  ): number {
    let rows = this.state.storage.sql.exec<LogRow>(
      `SELECT * FROM logs WHERE function_id = ?`,
      functionId
    ).toArray()

    const originalCount = rows.length
    let idsToDelete: Set<string> = new Set()

    // Apply maxAge - mark old entries for deletion
    if (policy.maxAge) {
      for (const row of rows) {
        if (now - row.timestamp >= policy.maxAge) {
          idsToDelete.add(row.id)
        }
      }
    }

    // Filter out the age-deleted entries
    let remaining = rows.filter((r) => !idsToDelete.has(r.id))

    // Apply maxCount - keep only the most recent entries
    if (policy.maxCount && remaining.length > policy.maxCount) {
      // Sort by timestamp descending to keep most recent
      remaining.sort((a, b) => b.timestamp - a.timestamp)
      const toRemove = remaining.slice(policy.maxCount)
      for (const row of toRemove) {
        idsToDelete.add(row.id)
      }
    }

    // Delete marked entries from SQLite
    for (const id of idsToDelete) {
      this.state.storage.sql.exec(
        `DELETE FROM logs WHERE id = ?`,
        id
      )
    }

    return idsToDelete.size
  }

  // ===========================================================================
  // GRACEFUL SHUTDOWN
  // ===========================================================================

  /**
   * Gracefully shut down the FunctionLogs DO.
   *
   * Cleans up all in-flight state:
   * 1. Stops the retention timer
   * 2. Clears all heartbeat timers
   * 3. Closes all WebSocket subscribers with a going-away message
   *
   * @returns Summary of what was cleaned up
   */
  async drain(): Promise<{
    subscribersClosed: number
    heartbeatTimersCleared: number
    retentionTimerStopped: boolean
  }> {
    let subscribersClosed = 0
    let heartbeatTimersCleared = 0
    let retentionTimerStopped = false

    // 1. Stop the retention timer
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer)
      this.retentionTimer = null
      retentionTimerStopped = true
    }

    // 2. Clear all heartbeat timers
    for (const [_ws, timer] of this.heartbeatTimers) {
      clearInterval(timer)
      heartbeatTimersCleared++
    }
    this.heartbeatTimers.clear()

    // 3. Close all WebSocket subscribers with a going-away message
    for (const [_functionId, subs] of this.subscribers) {
      for (const ws of subs) {
        try {
          ws.send(JSON.stringify({ type: 'shutdown', reason: 'Logs service is shutting down' }))
          ws.close(1001, 'Service shutting down')
          subscribersClosed++
        } catch {
          // Ignore errors on already-closed sockets
        }
      }
    }
    this.subscribers.clear()

    logger.info('FunctionLogs drained', {
      subscribersClosed,
      heartbeatTimersCleared,
      retentionTimerStopped,
    })

    return { subscribersClosed, heartbeatTimersCleared, retentionTimerStopped }
  }
}
