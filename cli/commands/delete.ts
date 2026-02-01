/**
 * Delete Command - Delete a deployed function
 *
 * Deletes a function from functions.do with confirmation prompt.
 */

import type { CLIContext, CommandResult } from '../types.js'
import type { DeleteAPIClient, PromptInterface } from '../context.js'

/**
 * Delete options
 */
export interface DeleteOptions {
  force?: boolean
  allVersions?: boolean
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
 * Run the delete command
 */
export async function runDelete(
  name: string,
  options: DeleteOptions,
  context: CLIContext,
  api: DeleteAPIClient,
  prompt: PromptInterface
): Promise<CommandResult> {
  const { stdout, stderr } = context

  // Validate function name
  if (!name || name.trim() === '') {
    stderr('Error: Function name is required')
    stderr('Usage: dotdo delete <function-name> [options]')
    return { exitCode: 1, error: 'Function name is required' }
  }

  if (!isValidFunctionName(name)) {
    stderr(`Error: Invalid function name "${name}"`)
    return { exitCode: 1, error: `Invalid function name: ${name}` }
  }

  // Check authentication first
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

  // Show warning for --all-versions
  if (options.allVersions) {
    stderr('Warning: This will permanently delete all versions of this function.')
    stderr('This action is irreversible.')
  }

  // Prompt for confirmation unless --force is used
  if (!options.force) {
    const confirmMessage = options.allVersions
      ? `Are you sure you want to delete "${name}" and all its versions?`
      : `Are you sure you want to delete "${name}"?`

    const confirmed = await prompt.confirm(confirmMessage)

    if (!confirmed) {
      stdout('Delete cancelled.')
      return { exitCode: 0 }
    }
  }

  // Delete the function
  try {
    const result = await api.deleteFunction(name, {
      allVersions: options.allVersions,
    })

    stdout('')
    stdout(`Successfully deleted function "${name}"`)

    if (options.allVersions && result.versionsDeleted) {
      stdout(`  Versions deleted: ${result.versionsDeleted}`)
    }

    stdout('')

    return { exitCode: 0 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (message.includes('not found')) {
      stderr(`Error: Function "${name}" not found`)
      return { exitCode: 1, error: `Function "${name}" does not exist` }
    }
    if (message.includes('Permission') || message.includes('denied') || message.includes('access')) {
      stderr(`Error: Permission denied - you do not have access to delete "${name}"`)
      return { exitCode: 1, error: 'Permission denied' }
    }
    if (message.includes('connection') || message.includes('network')) {
      stderr(`Error: Connection error - ${message}`)
      return { exitCode: 1, error: message }
    }
    if (message.includes('timeout')) {
      stderr('Error: Request timeout')
      return { exitCode: 1, error: 'Request timeout' }
    }

    stderr(`Error: Failed to delete function - ${message}`)
    return { exitCode: 1, error: message }
  }
}
