/**
 * List Command - List deployed functions
 *
 * Shows all deployed functions with their status, version, and language.
 */

import type { CLIContext, CommandResult } from '../types.js'
import type { ListAPIClient } from '../context.js'

/**
 * List options
 */
export interface ListOptions {
  limit?: number
  offset?: number
  json?: boolean
}

/**
 * Format a date for display
 */
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

/**
 * Pad a string to a certain length
 */
function pad(str: string, length: number): string {
  if (str.length >= length) return str.slice(0, length)
  return str + ' '.repeat(length - str.length)
}

/**
 * Run the list command
 */
export async function runList(
  options: ListOptions,
  context: CLIContext,
  api: ListAPIClient
): Promise<CommandResult> {
  const { stdout, stderr } = context

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

  try {
    const result = await api.listFunctions({
      limit: options.limit || 20,
      offset: options.offset || 0,
    })

    // Handle empty list
    if (result.functions.length === 0) {
      if (options.json) {
        stdout(JSON.stringify({
          functions: [],
          total: 0,
          limit: options.limit || 20,
          offset: options.offset || 0,
          hasMore: false,
        }))
      } else {
        stdout('No functions deployed yet.')
        stdout('')
        stdout('Get started by creating a new project:')
        stdout('  dotdo init my-function')
        stdout('')
        stdout('Then deploy it:')
        stdout('  cd my-function')
        stdout('  npm install')
        stdout('  dotdo deploy')
      }
      return { exitCode: 0 }
    }

    // JSON output
    if (options.json) {
      stdout(JSON.stringify({
        functions: result.functions,
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.hasMore,
      }))
      return { exitCode: 0 }
    }

    // Calculate column widths
    const nameWidth = Math.max(
      'Name'.length,
      ...result.functions.map(f => f.name.length)
    )
    const versionWidth = Math.max('Version'.length, 12)
    const languageWidth = Math.max('Language'.length, 12)
    const statusWidth = Math.max('Status'.length, 10)

    // Print header
    stdout('')
    stdout(
      pad('Name', nameWidth + 2) +
      pad('Version', versionWidth + 2) +
      pad('Language', languageWidth + 2) +
      pad('Status', statusWidth + 2) +
      'URL'
    )
    stdout('-'.repeat(nameWidth + versionWidth + languageWidth + statusWidth + 60))

    // Print functions
    for (const func of result.functions) {
      stdout(
        pad(func.name, nameWidth + 2) +
        pad(func.version, versionWidth + 2) +
        pad(func.language, languageWidth + 2) +
        pad(func.status, statusWidth + 2) +
        (func.url || '-')
      )
    }

    stdout('')

    // Show pagination info
    if (result.hasMore) {
      stdout(`Showing ${result.functions.length} of ${result.total} functions`)
      stdout(`Use --limit and --offset for pagination`)
    } else {
      stdout(`Total: ${result.total} function${result.total === 1 ? '' : 's'}`)
    }

    stdout('')

    return { exitCode: 0 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (message.includes('connection') || message.includes('network')) {
      stderr(`Error: Connection error - ${message}`)
    } else if (message.includes('timeout')) {
      stderr('Error: Request timeout')
    } else if (message.includes('server') || message.includes('500')) {
      stderr(`Error: Server error - ${message}`)
    } else {
      stderr(`Error: Failed to list functions - ${message}`)
    }

    return { exitCode: 1, error: message }
  }
}
