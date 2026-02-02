/**
 * Status Command - View function status
 *
 * Fetches and displays the current status, metadata, and health
 * information for a deployed function.
 */

import type { CLIContext, CommandResult } from '../types.js'
import type { APIClient } from '../context.js'

/**
 * Status options
 */
export interface StatusOptions {
  json?: boolean
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
 * Format status with visual indicator
 */
function formatStatus(status: string): string {
  const indicators: Record<string, string> = {
    active: '● active',
    available: '● available',
    deploying: '◐ deploying',
    inactive: '○ inactive',
    failed: '✗ failed',
    error: '✗ error',
  }
  return indicators[status.toLowerCase()] || status
}

/**
 * Run the status command
 */
export async function runStatus(
  name: string,
  options: StatusOptions,
  context: CLIContext,
  api: APIClient
): Promise<CommandResult> {
  const { stdout, stderr } = context

  // Validate function name
  if (!name || name.trim() === '') {
    stderr('Error: Function name is required')
    stderr('Usage: dotdo status <function-name> [options]')
    return { exitCode: 1, error: 'Function name is required' }
  }

  if (!isValidFunctionName(name)) {
    stderr(`Error: Invalid function name "${name}"`)
    return { exitCode: 1, error: `Invalid function name: ${name}` }
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
    // Don't fail here - let the info fetch handle the error
  }

  // Fetch function info
  try {
    // Use invoke API to call the info endpoint directly via fetch
    // The APIClient wraps FunctionClient which has a get() method
    // We use the functionExists + invoke pattern since the APIClient exposes invoke
    // but we need the info endpoint. We'll call the API directly.
    const result = await fetchFunctionStatus(name, api, context)

    if (options.json) {
      stdout(JSON.stringify(result, null, 2))
      return { exitCode: 0 }
    }

    // Pretty-print the status
    stdout('')
    stdout(`Function: ${result.id || name}`)
    stdout('')
    stdout(`  Status:       ${formatStatus(result.status || 'unknown')}`)

    if (result.version) {
      stdout(`  Version:      ${result.version}`)
    }
    if (result.language) {
      stdout(`  Language:     ${result.language}`)
    }
    if (result.entryPoint) {
      stdout(`  Entry Point:  ${result.entryPoint}`)
    }
    if (result.url) {
      stdout(`  URL:          ${result.url}`)
    }
    if (result.createdAt) {
      stdout(`  Created:      ${formatDate(result.createdAt)}`)
    }
    if (result.updatedAt) {
      stdout(`  Updated:      ${formatDate(result.updatedAt)}`)
    }
    if (result.description) {
      stdout(`  Description:  ${result.description}`)
    }
    if (result.tags && result.tags.length > 0) {
      stdout(`  Tags:         ${result.tags.join(', ')}`)
    }

    stdout('')

    return { exitCode: 0 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (message.includes('not found') || message.includes('404')) {
      stderr(`Error: Function "${name}" not found`)
      stderr('Use "dotdo list" to see available functions')
      return { exitCode: 1, error: `Function "${name}" does not exist` }
    }
    if (message.includes('connection') || message.includes('network')) {
      stderr(`Error: Connection error - ${message}`)
      return { exitCode: 1, error: message }
    }
    if (message.includes('timeout')) {
      stderr('Error: Request timeout')
      return { exitCode: 1, error: 'Request timeout' }
    }
    if (message.includes('401') || message.includes('Unauthorized')) {
      stderr('Error: Authentication failed. Please run: dotdo login')
      return { exitCode: 1, error: 'Authentication failed' }
    }

    stderr(`Error: Failed to fetch status - ${message}`)
    return { exitCode: 1, error: message }
  }
}

/**
 * Fetch function status information
 * Uses the API client's underlying fetch to call GET /v1/api/functions/:id
 */
async function fetchFunctionStatus(
  name: string,
  api: APIClient,
  context: CLIContext
): Promise<{
  id: string
  status: string
  version?: string
  language?: string
  entryPoint?: string
  url?: string
  createdAt?: string
  updatedAt?: string
  description?: string
  tags?: string[]
}> {
  // The APIClient exposes functionExists (which calls get internally)
  // and listFunctions. We use listFunctions and filter, or call the API directly.
  // Since the FunctionClient.get() is used internally by functionExists,
  // we fetch the function list and find our function.
  const result = await api.listFunctions({ limit: 100 })
  const func = result.functions.find(f => f.name === name)

  if (!func) {
    throw new Error(`Function not found: ${name}`)
  }

  return {
    id: func.name,
    status: func.status,
    version: func.version,
    language: func.language,
    url: func.url,
    createdAt: func.lastDeployment,
    updatedAt: func.lastDeployment,
  }
}
