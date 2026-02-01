/**
 * Structured Logger for Functions.do
 *
 * Provides structured logging with:
 * - Log levels (debug, info, warn, error)
 * - Context support (function ID, execution ID, etc.)
 * - Environment-based configuration
 * - JSON output for production, readable output for development
 *
 * @module core/logger
 */

/**
 * Log levels in order of severity
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Numeric log level values for comparison
 */
const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

/**
 * Context data for structured logging
 */
export interface LogContext {
  /** Function identifier */
  functionId?: string
  /** Execution/request identifier */
  executionId?: string
  /** Trace ID for distributed tracing */
  traceId?: string
  /** Span ID for distributed tracing */
  spanId?: string
  /** Additional context data */
  [key: string]: unknown
}

/**
 * A single log entry
 */
export interface LogEntry {
  /** Log level */
  level: LogLevel
  /** Log message */
  message: string
  /** Timestamp */
  timestamp: string
  /** Context data */
  context?: LogContext
  /** Additional data */
  data?: Record<string, unknown>
  /** Error details if present */
  error?: {
    message: string
    name?: string
    stack?: string
  }
}

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /** Minimum log level to output (default: 'info') */
  level?: LogLevel
  /** Base context to include in all log entries */
  context?: LogContext
  /** Output format: 'json' for structured output, 'text' for human-readable */
  format?: 'json' | 'text'
  /** Enable timestamps (default: true) */
  timestamps?: boolean
  /** Custom output handler (default: console) */
  output?: LogOutput
}

/**
 * Output handler interface
 */
export interface LogOutput {
  debug(entry: LogEntry): void
  info(entry: LogEntry): void
  warn(entry: LogEntry): void
  error(entry: LogEntry): void
}

/**
 * Logger interface
 */
export interface Logger {
  /** Log a debug message */
  debug(message: string, data?: Record<string, unknown>): void
  /** Log an info message */
  info(message: string, data?: Record<string, unknown>): void
  /** Log a warning message */
  warn(message: string, data?: Record<string, unknown>): void
  /** Log an error message */
  error(message: string, data?: Record<string, unknown>): void
  /** Create a child logger with additional context */
  child(context: LogContext): Logger
  /** Get current log level */
  getLevel(): LogLevel
  /** Set log level */
  setLevel(level: LogLevel): void
}

/**
 * Default console output handler
 */
class ConsoleOutput implements LogOutput {
  private format: 'json' | 'text'

  constructor(format: 'json' | 'text' = 'text') {
    this.format = format
  }

  private formatEntry(entry: LogEntry): string {
    if (this.format === 'json') {
      return JSON.stringify(entry)
    }

    // Text format: [LEVEL] timestamp - message (context) data
    const parts: string[] = []
    parts.push(`[${entry.level.toUpperCase()}]`)

    if (entry.timestamp) {
      parts.push(entry.timestamp)
    }

    parts.push('-')
    parts.push(entry.message)

    // Add context if present
    if (entry.context && Object.keys(entry.context).length > 0) {
      const contextStr = Object.entries(entry.context)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' ')
      parts.push(`(${contextStr})`)
    }

    // Add data if present
    if (entry.data && Object.keys(entry.data).length > 0) {
      parts.push(JSON.stringify(entry.data))
    }

    // Add error if present
    if (entry.error) {
      parts.push(`error=${entry.error.message}`)
      if (entry.error.stack) {
        parts.push(`\n${entry.error.stack}`)
      }
    }

    return parts.join(' ')
  }

  debug(entry: LogEntry): void {
    console.debug(this.formatEntry(entry))
  }

  info(entry: LogEntry): void {
    console.info(this.formatEntry(entry))
  }

  warn(entry: LogEntry): void {
    console.warn(this.formatEntry(entry))
  }

  error(entry: LogEntry): void {
    console.error(this.formatEntry(entry))
  }
}

/**
 * No-op output handler for silent logging
 */
export class NoopOutput implements LogOutput {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

/**
 * Structured logger implementation
 */
class StructuredLogger implements Logger {
  private level: LogLevel
  private context: LogContext
  private timestamps: boolean
  private output: LogOutput

  constructor(config: LoggerConfig = {}) {
    this.level = config.level ?? 'info'
    this.context = config.context ?? {}
    this.timestamps = config.timestamps ?? true
    this.output = config.output ?? new ConsoleOutput(config.format ?? 'text')
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_VALUES[level] >= LOG_LEVEL_VALUES[this.level]
  }

  /**
   * Create a log entry
   */
  private createEntry(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): LogEntry {
    const entry: LogEntry = {
      level,
      message,
      timestamp: this.timestamps ? new Date().toISOString() : '',
    }

    // Add context if present
    if (Object.keys(this.context).length > 0) {
      entry.context = { ...this.context }
    }

    // Extract error from data if present
    if (data) {
      const { error, ...rest } = data
      if (error instanceof Error) {
        entry.error = {
          message: error.message,
          name: error.name,
          stack: error.stack,
        }
      } else if (error && typeof error === 'object') {
        const errorObj = error as { message?: string; name?: string; stack?: string }
        entry.error = {
          message: errorObj.message ?? String(error),
          name: errorObj.name,
          stack: errorObj.stack,
        }
      } else if (typeof error === 'string') {
        entry.error = { message: error }
      }

      if (Object.keys(rest).length > 0) {
        entry.data = rest
      }
    }

    return entry
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) {
      const entry = this.createEntry('debug', message, data)
      this.output.debug(entry)
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      const entry = this.createEntry('info', message, data)
      this.output.info(entry)
    }
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) {
      const entry = this.createEntry('warn', message, data)
      this.output.warn(entry)
    }
  }

  error(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('error')) {
      const entry = this.createEntry('error', message, data)
      this.output.error(entry)
    }
  }

  child(context: LogContext): Logger {
    return new StructuredLogger({
      level: this.level,
      context: { ...this.context, ...context },
      timestamps: this.timestamps,
      output: this.output,
    })
  }

  getLevel(): LogLevel {
    return this.level
  }

  setLevel(level: LogLevel): void {
    this.level = level
  }
}

/**
 * Create a structured logger
 *
 * @example
 * ```typescript
 * // Basic usage
 * const logger = createLogger({ level: 'info' })
 * logger.warn('Something happened', { details: 'more info' })
 *
 * // With context
 * const logger = createLogger({
 *   level: 'debug',
 *   context: { functionId: 'my-function' }
 * })
 * logger.info('Function loaded')
 *
 * // Child logger with additional context
 * const childLogger = logger.child({ executionId: 'exec-123' })
 * childLogger.warn('Execution slow', { durationMs: 5000 })
 * ```
 */
export function createLogger(config: LoggerConfig = {}): Logger {
  return new StructuredLogger(config)
}

/**
 * Get log level from environment
 * Checks process.env.LOG_LEVEL or defaults to 'info'
 */
export function getLogLevelFromEnv(): LogLevel {
  if (typeof process !== 'undefined' && process.env?.['LOG_LEVEL']) {
    const level = process.env['LOG_LEVEL'].toLowerCase() as LogLevel
    if (level in LOG_LEVEL_VALUES) {
      return level
    }
  }
  return 'info'
}

/**
 * Get log format from environment
 * Checks process.env.LOG_FORMAT or defaults based on NODE_ENV
 */
export function getLogFormatFromEnv(): 'json' | 'text' {
  if (typeof process !== 'undefined') {
    if (process.env?.['LOG_FORMAT'] === 'json') {
      return 'json'
    }
    if (process.env?.['LOG_FORMAT'] === 'text') {
      return 'text'
    }
    // Default to JSON in production, text in development
    if (process.env?.['NODE_ENV'] === 'production') {
      return 'json'
    }
  }
  return 'text'
}

/**
 * Create a logger with environment-based configuration
 *
 * @example
 * ```typescript
 * // Uses LOG_LEVEL and LOG_FORMAT from environment
 * const logger = createLoggerFromEnv({ context: { service: 'functions-do' } })
 * ```
 */
export function createLoggerFromEnv(
  config: Omit<LoggerConfig, 'level' | 'format'> = {}
): Logger {
  return createLogger({
    ...config,
    level: getLogLevelFromEnv(),
    format: getLogFormatFromEnv(),
  })
}

/**
 * Default shared logger instance
 * Uses environment-based configuration
 */
let defaultLogger: Logger | null = null

/**
 * Get the default logger instance
 * Creates one if it doesn't exist using environment configuration
 */
export function getDefaultLogger(): Logger {
  if (!defaultLogger) {
    defaultLogger = createLoggerFromEnv()
  }
  return defaultLogger
}

/**
 * Set the default logger instance
 */
export function setDefaultLogger(logger: Logger): void {
  defaultLogger = logger
}

/**
 * No-op logger for testing or when logging is disabled
 */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
  getLevel: () => 'error' as LogLevel,
  setLevel: () => {},
}
