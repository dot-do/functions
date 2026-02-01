/**
 * Logs Command - View function logs
 *
 * Shows logs for a deployed function with filtering and streaming support.
 */

import type { CLIContext, CommandResult } from '../types.js'
import type { LogsAPIClient } from '../context.js'

/**
 * Log level type
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Logs options
 */
export interface LogsOptions {
  follow?: boolean
  since?: string
  level?: LogLevel
  limit?: number
}

/**
 * Format a timestamp for display
 */
function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }) + '.' + date.getMilliseconds().toString().padStart(3, '0')
  } catch {
    return timestamp
  }
}

/**
 * Format log level for display
 */
function formatLevel(level: string): string {
  const levelMap: Record<string, string> = {
    debug: 'DEBUG',
    info: 'INFO ',
    warn: 'WARN ',
    error: 'ERROR',
  }
  return levelMap[level.toLowerCase()] || level.toUpperCase().padEnd(5)
}

/**
 * Validate function name
 */
function isValidFunctionName(name: string): boolean {
  if (!name || name.trim() === '') return false
  if (name.includes(' ') || name.includes('\n') || name.includes('\t')) return false
  if (name.startsWith('..') || name.includes('../')) return false
  return true
}

/**
 * Validate log level
 */
function isValidLogLevel(level: string): level is LogLevel {
  return ['debug', 'info', 'warn', 'error'].includes(level.toLowerCase())
}

/**
 * Parse relative time string (e.g., '1h', '30m') to ISO timestamp
 */
function parseRelativeTime(timeStr: string): string | null {
  const match = timeStr.match(/^(\d+)([hms])$/)
  if (!match) return null

  const [, amount, unit] = match
  const multipliers: Record<string, number> = {
    h: 60 * 60 * 1000,
    m: 60 * 1000,
    s: 1000,
  }

  const ms = parseInt(amount, 10) * multipliers[unit]
  const date = new Date(Date.now() - ms)
  return date.toISOString()
}

/**
 * Validate and parse --since value
 */
function parseSinceValue(since: string): string | null {
  // Try relative time first
  const relative = parseRelativeTime(since)
  if (relative) return relative

  // Try ISO date
  try {
    const date = new Date(since)
    if (isNaN(date.getTime())) return null
    return date.toISOString()
  } catch {
    return null
  }
}

/**
 * Run the logs command
 */
export async function runLogs(
  name: string,
  options: LogsOptions,
  context: CLIContext,
  api: LogsAPIClient
): Promise<CommandResult> {
  const { stdout, stderr } = context

  // Validate function name
  if (!name || name.trim() === '') {
    stderr('Error: Function name is required')
    stderr('Usage: dotdo logs <function-name> [options]')
    return { exitCode: 1, error: 'Function name is required' }
  }

  if (!isValidFunctionName(name)) {
    stderr(`Error: Invalid function name "${name}"`)
    return { exitCode: 1, error: `Invalid function name: ${name}` }
  }

  // Validate log level if provided
  if (options.level && !isValidLogLevel(options.level)) {
    stderr(`Error: Invalid log level "${options.level}"`)
    stderr('Valid levels: debug, info, warn, error')
    return { exitCode: 1, error: `Invalid log level: ${options.level}. Valid: debug, info, warn, error` }
  }

  // Validate limit
  if (options.limit !== undefined) {
    if (options.limit <= 0) {
      stderr('Error: --limit must be a positive number greater than 0')
      return { exitCode: 1, error: 'Invalid limit: must be a positive number greater than 0' }
    }
  }

  // Parse --since value
  let since: string | undefined
  if (options.since) {
    const parsed = parseSinceValue(options.since)
    if (!parsed) {
      stderr(`Error: Invalid time format "${options.since}"`)
      stderr('Use ISO format (2024-01-15T10:00:00Z) or relative (1h, 30m, 60s)')
      return { exitCode: 1, error: `Invalid time format: ${options.since}` }
    }
    since = parsed
  }

  // Check authentication
  try {
    const authenticated = await api.isAuthenticated()
    if (!authenticated) {
      stderr('Error: Not authenticated. Please run: dotdo login')
      return { exitCode: 1, error: 'Unauthorized. Please log in with: dotdo login' }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Unauthorized') || message.includes('login')) {
      stderr('Error: Not authenticated. Please run: dotdo login')
      return { exitCode: 1, error: 'Unauthorized. Please log in with: dotdo login' }
    }
    stderr(`Error: ${message}`)
    return { exitCode: 1, error: message }
  }

  // Check if function exists
  try {
    const exists = await api.functionExists(name)
    if (!exists) {
      stderr(`Error: Function "${name}" not found`)
      stderr('Use "dotdo list" to see available functions')
      return { exitCode: 1, error: `Function "${name}" does not exist` }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('not found')) {
      stderr(`Error: Function "${name}" not found`)
      return { exitCode: 1, error: `Function "${name}" does not exist` }
    }
    stderr(`Error: ${message}`)
    return { exitCode: 1, error: message }
  }

  // Handle streaming logs
  if (options.follow) {
    stdout(`Streaming logs for ${name}... (Press Ctrl+C to stop)`)
    stdout('')

    return new Promise((resolve) => {
      const unsubscribe = api.streamLogs(
        name,
        { level: options.level },
        (entry) => {
          const time = formatTimestamp(entry.timestamp)
          const level = formatLevel(entry.level)
          stdout(`${time} [${level}] ${entry.message}`)
        },
        (error) => {
          stderr(`Error: ${error.message}`)
          resolve({ exitCode: 1, error: error.message })
        }
      )

      // Handle exit
      const exitHandler = () => {
        unsubscribe()
        resolve({ exitCode: 0 })
      }

      // Note: In a real CLI, we'd set up signal handlers here
      // For now, rely on the context.exit being called
    })
  }

  // Fetch logs
  try {
    const result = await api.getLogs(name, {
      since,
      level: options.level,
      limit: options.limit,
    })

    if (result.logs.length === 0) {
      stdout(`No logs found for ${name}`)
      if (options.since || options.level) {
        stdout('Try adjusting your filter criteria')
      }
      return { exitCode: 0 }
    }

    // Print logs
    for (const entry of result.logs) {
      const time = formatTimestamp(entry.timestamp)
      const level = formatLevel(entry.level)
      const requestId = entry.requestId ? ` [${entry.requestId}]` : ''
      stdout(`${time} [${level}]${requestId} ${entry.message}`)
    }

    // Show if more logs available
    if (result.hasMore) {
      stdout('')
      stdout(`More logs available. Use --limit to fetch more.`)
    }

    return { exitCode: 0 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (message.includes('not found')) {
      stderr(`Error: Function "${name}" not found`)
      return { exitCode: 1, error: `Function "${name}" does not exist` }
    }
    if (message.includes('rate limit') || message.includes('429')) {
      stderr('Error: Rate limit exceeded - too many requests')
      return { exitCode: 1, error: 'Rate limit exceeded' }
    }
    if (message.includes('connection') || message.includes('network')) {
      stderr(`Error: Connection error - ${message}`)
      return { exitCode: 1, error: message }
    }
    if (message.includes('timeout')) {
      stderr('Error: Request timeout')
      return { exitCode: 1, error: 'Request timeout' }
    }

    stderr(`Error: ${message}`)
    return { exitCode: 1, error: message }
  }
}
