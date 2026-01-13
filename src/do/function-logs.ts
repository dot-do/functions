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
 * @module durable-object/function-logs
 */

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
// FUNCTION LOGS DURABLE OBJECT
// ============================================================================

/**
 * FunctionLogs Durable Object
 *
 * Provides centralized logging infrastructure for serverless functions.
 * Uses in-memory storage for fast access with WebSocket streaming support.
 */
export class FunctionLogs {
  private state: DurableObjectState
  private env: unknown
  private initialized = false
  private subscribers: Map<string, Set<WebSocket>> = new Map()

  // In-memory log storage
  private logs: Map<string, LogEntry[]> = new Map()
  private allLogs: LogEntry[] = []
  private retentionTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimers: Map<WebSocket, ReturnType<typeof setInterval>> = new Map()

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state
    this.env = env
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  /**
   * Initialize (lazy initialization)
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
  }

  // ===========================================================================
  // LOG ENTRY OPERATIONS
  // ===========================================================================

  /**
   * Append a log entry
   */
  async append(input: LogEntryInput): Promise<LogEntry> {
    await this.ensureInitialized()

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

    // Store the log
    this.storeLog(entry)

    // Notify WebSocket subscribers
    this.notifySubscribers(entry)

    return entry
  }

  /**
   * Append multiple log entries in batch
   */
  async appendBatch(inputs: LogEntryInput[]): Promise<LogEntry[]> {
    await this.ensureInitialized()

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
    await this.ensureInitialized()

    let entries = this.logs.get(query.functionId) || []

    // Apply filters
    entries = this.applyFilters(entries, query)

    // Apply sorting
    const order = query.order || 'desc'
    entries = [...entries].sort((a, b) => {
      const diff = a.timestamp - b.timestamp
      return order === 'asc' ? diff : -diff
    })

    // Apply pagination
    return this.applyPagination(entries, query.limit, query.cursor)
  }

  /**
   * Query logs across all functions
   */
  async queryAll(options: Omit<LogQuery, 'functionId'>): Promise<LogQueryResult> {
    await this.ensureInitialized()

    let entries = [...this.allLogs]

    // Apply filters (without functionId)
    if (options.startTime !== undefined) {
      entries = entries.filter((e) => e.timestamp >= options.startTime!)
    }
    if (options.endTime !== undefined) {
      entries = entries.filter((e) => e.timestamp <= options.endTime!)
    }
    if (options.level) {
      entries = entries.filter((e) => e.level === options.level)
    }
    if (options.levels) {
      entries = entries.filter((e) => options.levels!.includes(e.level))
    }
    if (options.minLevel) {
      const minSeverity = LOG_LEVEL_SEVERITY[options.minLevel]
      entries = entries.filter((e) => LOG_LEVEL_SEVERITY[e.level] >= minSeverity)
    }

    // Apply sorting
    const order = options.order || 'desc'
    entries = entries.sort((a, b) => {
      const diff = a.timestamp - b.timestamp
      return order === 'asc' ? diff : -diff
    })

    // Apply pagination
    return this.applyPagination(entries, options.limit, options.cursor)
  }

  /**
   * Query logs by request ID
   */
  async queryByRequestId(requestId: string): Promise<LogQueryResult> {
    await this.ensureInitialized()

    const entries = this.allLogs.filter((e) => e.requestId === requestId)
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
    await this.ensureInitialized()

    let entries = query.functionId
      ? this.logs.get(query.functionId) || []
      : [...this.allLogs]

    const searchQuery = query.query.toLowerCase()
    entries = entries.filter((e) => e.message.toLowerCase().includes(searchQuery))

    const limit = query.limit || DEFAULT_LIMIT
    const hasMore = entries.length > limit
    entries = entries.slice(0, limit)

    return {
      entries,
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
    await this.ensureInitialized()

    let entries = this.logs.get(options.functionId) || []

    if (options.startTime !== undefined) {
      entries = entries.filter((e) => e.timestamp >= options.startTime!)
    }
    if (options.endTime !== undefined) {
      entries = entries.filter((e) => e.timestamp <= options.endTime!)
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

    for (const entry of entries) {
      countByLevel[entry.level]++
      if (entry.durationMs !== undefined) {
        durations.push(entry.durationMs)
      }
      if (lastTimestamp === undefined || entry.timestamp > lastTimestamp) {
        lastTimestamp = entry.timestamp
      }
    }

    const total = entries.length
    const errorCount = countByLevel.error + countByLevel.fatal
    const errorRate = total > 0 ? errorCount / total : 0

    // Calculate time range for logs per minute
    const timestamps = entries.map((e) => e.timestamp)
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
    await this.ensureInitialized()

    const byFunction: Record<string, LogMetrics> = {}

    for (const functionId of this.logs.keys()) {
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
    await this.ensureInitialized()

    let deleted = 0
    const now = Date.now()

    if (policy.perFunction) {
      for (const [functionId, entries] of this.logs.entries()) {
        const { kept, deletedCount } = this.applyRetentionToEntries(entries, policy, now)
        this.logs.set(functionId, kept)
        deleted += deletedCount
      }
    } else {
      for (const [functionId, entries] of this.logs.entries()) {
        const { kept, deletedCount } = this.applyRetentionToEntries(entries, policy, now)
        this.logs.set(functionId, kept)
        deleted += deletedCount
      }
    }

    // Update allLogs
    const allKept = new Set<string>()
    for (const entries of this.logs.values()) {
      for (const entry of entries) {
        allKept.add(entry.id)
      }
    }
    this.allLogs = this.allLogs.filter((e) => allKept.has(e.id))

    return deleted
  }

  /**
   * Get retention statistics
   */
  async getRetentionStats(): Promise<RetentionStats> {
    await this.ensureInitialized()

    const totalLogs = this.allLogs.length

    if (totalLogs === 0) {
      return { totalLogs: 0 }
    }

    const timestamps = this.allLogs.map((e) => e.timestamp)
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
    // Store subscription
    if (!this.subscribers.has(options.functionId)) {
      this.subscribers.set(options.functionId, new Set())
    }
    this.subscribers.get(options.functionId)!.add(ws)

    // Send initial history if tail is requested
    if (options.tail && options.tail > 0) {
      const functionLogs = this.logs.get(options.functionId) || []
      const historyEntries = functionLogs.slice(-options.tail)
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
    await this.ensureInitialized()
    return Array.from(this.logs.keys())
  }

  /**
   * Delete all logs for a function
   */
  async deleteLogs(functionId: string): Promise<void> {
    await this.ensureInitialized()
    this.logs.delete(functionId)
    this.allLogs = this.allLogs.filter((e) => e.functionId !== functionId)
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
      console.error('FunctionLogs error:', error)
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

  private storeLog(entry: LogEntry): void {
    if (!this.logs.has(entry.functionId)) {
      this.logs.set(entry.functionId, [])
    }
    this.logs.get(entry.functionId)!.push(entry)
    this.allLogs.push(entry)
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

  private applyFilters(entries: LogEntry[], query: LogQuery): LogEntry[] {
    let filtered = [...entries]

    if (query.startTime !== undefined) {
      filtered = filtered.filter((e) => e.timestamp >= query.startTime!)
    }
    if (query.endTime !== undefined) {
      filtered = filtered.filter((e) => e.timestamp <= query.endTime!)
    }
    if (query.level) {
      filtered = filtered.filter((e) => e.level === query.level)
    }
    if (query.levels) {
      filtered = filtered.filter((e) => query.levels!.includes(e.level))
    }
    if (query.minLevel) {
      const minSeverity = LOG_LEVEL_SEVERITY[query.minLevel]
      filtered = filtered.filter((e) => LOG_LEVEL_SEVERITY[e.level] >= minSeverity)
    }

    return filtered
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
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString())
        offset = decoded.offset
      } catch {
        // Invalid cursor, start from beginning
      }
    }

    const sliced = entries.slice(offset, offset + effectiveLimit)
    const hasMore = offset + effectiveLimit < entries.length

    let nextCursor: string | null = null
    if (hasMore) {
      nextCursor = Buffer.from(JSON.stringify({ offset: offset + effectiveLimit })).toString('base64')
    }

    return {
      entries: sliced,
      cursor: nextCursor,
      hasMore,
    }
  }

  private applyRetentionToEntries(
    entries: LogEntry[],
    policy: RetentionPolicy,
    now: number
  ): { kept: LogEntry[]; deletedCount: number } {
    let kept = [...entries]
    const originalCount = kept.length

    // Apply maxAge
    if (policy.maxAge) {
      kept = kept.filter((e) => now - e.timestamp < policy.maxAge!)
    }

    // Apply maxCount
    if (policy.maxCount && kept.length > policy.maxCount) {
      // Sort by timestamp descending and keep only the most recent
      kept.sort((a, b) => b.timestamp - a.timestamp)
      kept = kept.slice(0, policy.maxCount)
    }

    return {
      kept,
      deletedCount: originalCount - kept.length,
    }
  }
}
