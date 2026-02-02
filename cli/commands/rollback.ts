/**
 * Rollback Command - Rollback a function to a previous version
 *
 * Reverts a deployed function to a specified previous version or to the
 * last known good version if no version is specified.
 */

import type { CLIContext, CommandResult } from '../types.js'
import type { APIClient, PromptInterface } from '../context.js'

/**
 * Rollback options
 */
export interface RollbackOptions {
  version?: string
  force?: boolean
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
 * Validate version string
 */
function isValidVersion(version: string): boolean {
  if (!version || version.trim() === '') return false
  // Accept semver-like (v1.0.0, 1.0.0) or simple numeric (1, 2, 3)
  return /^v?\d+(\.\d+(\.\d+)?)?$/.test(version)
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
 * Run the rollback command
 */
export async function runRollback(
  name: string,
  options: RollbackOptions,
  context: CLIContext,
  api: APIClient,
  prompt: PromptInterface
): Promise<CommandResult> {
  const { stdout, stderr } = context

  // Validate function name
  if (!name || name.trim() === '') {
    stderr('Error: Function name is required')
    stderr('Usage: dotdo rollback <function-name> [options]')
    return { exitCode: 1, error: 'Function name is required' }
  }

  if (!isValidFunctionName(name)) {
    stderr(`Error: Invalid function name "${name}"`)
    return { exitCode: 1, error: `Invalid function name: ${name}` }
  }

  // Validate version if provided
  if (options.version && !isValidVersion(options.version)) {
    stderr(`Error: Invalid version format "${options.version}"`)
    stderr('Version must be a valid semver (e.g., v1.0.0, 1.2.3) or a simple number (e.g., 1, 2)')
    return { exitCode: 1, error: `Invalid version format: ${options.version}` }
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

  // Get current function info for display
  let currentVersion = 'unknown'
  try {
    const result = await api.listFunctions({ limit: 100 })
    const func = result.functions.find(f => f.name === name)
    if (func) {
      currentVersion = func.version
    }
  } catch {
    // Continue with rollback even if we can't fetch current version
  }

  const targetVersion = options.version || 'previous version'

  // Prompt for confirmation unless --force is used
  if (!options.force) {
    stdout('')
    stdout(`Function:        ${name}`)
    stdout(`Current version: ${currentVersion}`)
    stdout(`Rollback to:     ${targetVersion}`)
    stdout('')

    const confirmed = await prompt.confirm(
      `Are you sure you want to rollback "${name}" to ${targetVersion}?`
    )

    if (!confirmed) {
      stdout('Rollback cancelled.')
      return { exitCode: 0 }
    }
  }

  // Perform the rollback
  stdout('')
  stdout(`Rolling back "${name}" to ${targetVersion}...`)

  try {
    const result = await performRollback(name, options.version, api)

    stdout('')
    stdout('Rollback successful!')
    stdout('')
    stdout(`  Function:     ${name}`)
    stdout(`  Version:      ${result.version}`)

    if (result.deploymentId) {
      stdout(`  Deployment:   ${result.deploymentId}`)
    }
    if (result.url) {
      stdout(`  URL:          ${result.url}`)
    }
    if (result.rolledBackAt) {
      stdout(`  Rolled back:  ${formatDate(result.rolledBackAt)}`)
    }

    stdout('')

    return { exitCode: 0 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (message.includes('not found') || message.includes('404')) {
      if (options.version) {
        stderr(`Error: Version "${options.version}" not found for function "${name}"`)
        stderr('Use "dotdo status <function-name>" to see available versions')
      } else {
        stderr(`Error: No previous version found for function "${name}"`)
        stderr('Cannot rollback a function with only one version')
      }
      return { exitCode: 1, error: `Version not found: ${targetVersion}` }
    }
    if (message.includes('Permission') || message.includes('denied') || message.includes('403')) {
      stderr(`Error: Permission denied - you do not have access to rollback "${name}"`)
      return { exitCode: 1, error: 'Permission denied' }
    }
    if (message.includes('already') || message.includes('same version')) {
      stderr(`Error: Function "${name}" is already at version ${targetVersion}`)
      return { exitCode: 1, error: `Already at version ${targetVersion}` }
    }
    if (message.includes('in progress') || message.includes('deploying')) {
      stderr('Error: A deployment is currently in progress. Please wait and try again.')
      return { exitCode: 1, error: 'Deployment in progress' }
    }
    if (message.includes('connection') || message.includes('network')) {
      stderr(`Error: Connection error - ${message}`)
      return { exitCode: 1, error: message }
    }
    if (message.includes('timeout')) {
      stderr('Error: Request timeout - rollback may still be in progress')
      return { exitCode: 1, error: 'Request timeout' }
    }

    stderr(`Error: Rollback failed - ${message}`)
    return { exitCode: 1, error: message }
  }
}

/**
 * Rollback result from the API
 */
interface RollbackResult {
  version: string
  deploymentId?: string
  url?: string
  rolledBackAt?: string
}

/**
 * Perform the rollback via the API
 * Calls POST /v1/functions/:id/rollback or uses the deploy endpoint
 */
async function performRollback(
  functionName: string,
  targetVersion: string | undefined,
  api: APIClient
): Promise<RollbackResult> {
  // Use the invoke API to send a rollback command to the platform.
  // The platform intercepts __dotdo_internal messages for management operations.
  // When a dedicated rollback API endpoint is available, this will be updated.
  const response = await api.invoke(functionName, {
    data: {
      __dotdo_internal: 'rollback',
      targetVersion: targetVersion || 'previous',
    },
  })

  const body = response.body as Record<string, unknown> | undefined

  return {
    version: targetVersion || (body?.version as string) || 'previous',
    deploymentId: (body?.deploymentId as string) || undefined,
    url: (body?.url as string) || undefined,
    rolledBackAt: new Date().toISOString(),
  }
}
