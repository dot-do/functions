/**
 * Invoke Command - Invoke a deployed function
 *
 * Invokes a function by name with optional data, showing the response.
 */

import { join } from 'path'
import type { CLIContext, CommandResult } from '../types.js'
import type { InvokeAPIClient } from '../context.js'

/**
 * Invoke options
 */
export interface InvokeOptions {
  data?: string
  file?: string
  version?: string
  timing?: boolean
  headers?: boolean
  method?: string
  header?: string[]
}

/**
 * Extended context for invoke command
 */
export interface InvokeCLIContext extends CLIContext {
  api: InvokeAPIClient
  stdin?: string
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
 * Parse header string "Key: Value" into [key, value]
 */
function parseHeader(header: string): [string, string] | null {
  const colonIndex = header.indexOf(':')
  if (colonIndex === -1) return null

  const key = header.slice(0, colonIndex).trim()
  const value = header.slice(colonIndex + 1).trim()

  if (!key) return null

  return [key, value]
}

/**
 * Run the invoke command
 */
export async function runInvoke(
  name: string,
  options: InvokeOptions,
  context: InvokeCLIContext
): Promise<CommandResult> {
  const { fs, stdout, stderr, cwd, api, stdin } = context

  // Validate function name
  if (!name || name.trim() === '') {
    stderr('Error: Function name is required')
    stderr('Usage: dotdo invoke <function-name> [options]')
    return { exitCode: 1, error: 'Function name is required' }
  }

  if (!isValidFunctionName(name)) {
    stderr(`Error: Invalid function name "${name}"`)
    return { exitCode: 1, error: `Invalid function name: ${name}` }
  }

  // Check for conflicting options
  if (options.data && options.file) {
    stderr('Error: Cannot use both --data and --file options')
    stderr('Use either --data for inline JSON or --file to read from a file')
    return { exitCode: 1, error: 'Cannot use both --data and --file - they are mutually exclusive' }
  }

  // Parse request data
  let requestData: unknown = undefined

  // Priority: --data > --file > stdin
  if (options.data) {
    try {
      requestData = JSON.parse(options.data)
    } catch {
      stderr('Error: Invalid JSON in --data option')
      stderr(`Provided: ${options.data}`)
      return { exitCode: 1, error: 'Invalid JSON in --data option' }
    }
  } else if (options.file) {
    // Read from file
    try {
      const filePath = options.file.startsWith('/') ? options.file : join(cwd, options.file)
      const fileContent = await fs.readFile(filePath)
      try {
        requestData = JSON.parse(fileContent)
      } catch {
        stderr(`Error: Invalid JSON in file "${options.file}"`)
        return { exitCode: 1, error: `Invalid JSON in file: ${options.file}` }
      }
    } catch {
      stderr(`Error: File not found: ${options.file}`)
      return { exitCode: 1, error: `File not found: ${options.file}` }
    }
  } else if (stdin) {
    // Read from stdin
    try {
      requestData = JSON.parse(stdin)
    } catch {
      stderr('Error: Invalid JSON from stdin')
      return { exitCode: 1, error: 'Invalid JSON from stdin' }
    }
  }

  // Parse custom headers
  const customHeaders: Record<string, string> = {}
  if (options.header) {
    for (const headerStr of options.header) {
      const parsed = parseHeader(headerStr)
      if (!parsed) {
        stderr(`Error: Invalid header format: "${headerStr}"`)
        stderr('Expected format: "Header-Name: value"')
        return { exitCode: 1, error: `Invalid header format: ${headerStr}` }
      }
      customHeaders[parsed[0]] = parsed[1]
    }
  }

  // Determine HTTP method
  let method = options.method?.toUpperCase() || (requestData !== undefined ? 'POST' : 'GET')

  try {
    const response = await api.invoke(name, {
      data: requestData,
      version: options.version,
      method,
      headers: Object.keys(customHeaders).length > 0 ? customHeaders : undefined,
    })

    // Check for error status codes
    if (response.status >= 400) {
      if (response.status === 401) {
        stderr('Error: Unauthorized - authentication required')
        return { exitCode: 1, error: 'Unauthorized - authentication required' }
      }
      if (response.status === 403) {
        stderr('Error: Forbidden - access denied')
        return { exitCode: 1, error: 'Forbidden - access denied (403)' }
      }
      if (response.status === 404) {
        stderr(`Error: Function "${name}" not found (404)`)
        return { exitCode: 1, error: `Function not found: ${name}` }
      }
      if (response.status === 429) {
        stderr('Error: Rate limit exceeded - too many requests (429)')
        return { exitCode: 1, error: 'Rate limit exceeded (429)' }
      }
      if (response.status >= 500) {
        stderr(`Error: Server error (${response.status})`)
        if (response.body && typeof response.body === 'object') {
          const errorBody = response.body as Record<string, unknown>
          if (errorBody.error) {
            stderr(`  ${errorBody.error}`)
          }
          if (errorBody.details) {
            stderr(`  ${errorBody.details}`)
          }
        }
        return { exitCode: 1, error: `Server error: ${response.status} ${response.statusText}` }
      }

      // Other 4xx errors
      stderr(`Error: Request failed with status ${response.status}`)
      if (response.body && typeof response.body === 'object') {
        const errorBody = response.body as Record<string, unknown>
        if (errorBody.error) {
          stderr(`  ${errorBody.error}`)
        }
        if (errorBody.details) {
          stderr(`  ${errorBody.details}`)
        }
      }
      return { exitCode: 1, error: `Request failed: ${response.status}` }
    }

    // Show headers if requested
    if (options.headers) {
      stdout(`HTTP/${response.status} ${response.statusText}`)
      for (const [key, value] of Object.entries(response.headers)) {
        stdout(`${key}: ${value}`)
      }
      stdout('')
    }

    // Output response body
    const body = response.body
    if (typeof body === 'string') {
      stdout(body)
    } else if (body !== undefined && body !== null) {
      stdout(JSON.stringify(body, null, 2))
    }

    // Show timing if requested
    if (options.timing) {
      stdout('')
      stdout('Timing:')
      stdout(`  Total: ${response.timing.total} ms`)
      if (response.timing.dns !== undefined) {
        stdout(`  DNS: ${response.timing.dns} ms`)
      }
      if (response.timing.connect !== undefined) {
        stdout(`  Connect: ${response.timing.connect} ms`)
      }
      if (response.timing.ttfb !== undefined) {
        stdout(`  TTFB: ${response.timing.ttfb} ms`)
      }
    }

    return { exitCode: 0 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (message.includes('timeout')) {
      stderr('Error: Request timeout')
    } else if (message.includes('network') || message.includes('connection')) {
      stderr(`Error: Network error - ${message}`)
    } else {
      stderr(`Error: ${message}`)
    }

    return { exitCode: 1, error: message }
  }
}
