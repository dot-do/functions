/**
 * Deploy Command - Deploy function to functions.do
 *
 * Reads wrangler.toml configuration, compiles the code,
 * and deploys to the functions.do API.
 */

import { join } from 'path'
import type { CLIContext, WranglerConfig, CommandResult } from '../types.js'
import type { DeployAPIClient, Compiler, CompilationResult } from '../context.js'

/**
 * Deploy options
 */
export interface DeployOptions {
  version?: string
  message?: string
}

/**
 * Extended context for deploy command
 */
export interface DeployCLIContext extends CLIContext {
  api: DeployAPIClient
  compiler: Compiler
}

/**
 * Parse a simple TOML file (supports basic key = "value" format)
 */
function parseToml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  let currentSection: Record<string, unknown> = result
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue

    // Handle section headers [section]
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      const sectionName = sectionMatch[1]
      if (!result[sectionName]) {
        result[sectionName] = {}
      }
      currentSection = result[sectionName] as Record<string, unknown>
      continue
    }

    // Handle key = value pairs
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/)
    if (kvMatch) {
      const [, key, rawValue] = kvMatch
      let value: unknown = rawValue

      // Parse value type
      if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
        value = rawValue.slice(1, -1)
      } else if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
        value = rawValue.slice(1, -1)
      } else if (rawValue === 'true') {
        value = true
      } else if (rawValue === 'false') {
        value = false
      } else if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        // Parse array
        const arrayContent = rawValue.slice(1, -1)
        value = arrayContent.split(',').map(item => {
          const trimmedItem = item.trim()
          if (trimmedItem.startsWith('"') && trimmedItem.endsWith('"')) {
            return trimmedItem.slice(1, -1)
          }
          return trimmedItem
        }).filter(item => item !== '')
      } else if (!isNaN(Number(rawValue))) {
        value = Number(rawValue)
      }

      currentSection[key] = value
    }
  }

  return result
}

/**
 * Validate wrangler config
 */
function validateConfig(config: Record<string, unknown>): { valid: boolean; error?: string } {
  if (!config.name || typeof config.name !== 'string') {
    return { valid: false, error: 'Missing required field "name" in wrangler.toml' }
  }

  if (!config.main || typeof config.main !== 'string') {
    return { valid: false, error: 'Missing required field "main" (entry point) in wrangler.toml' }
  }

  return { valid: true }
}

/**
 * Run the deploy command
 */
export async function runDeploy(
  options: DeployOptions,
  context: DeployCLIContext
): Promise<CommandResult> {
  const { fs, stdout, stderr, cwd, api, compiler } = context

  // Check authentication
  try {
    const authenticated = await api.isAuthenticated()
    if (!authenticated) {
      stderr('Error: Not authenticated. Please run: dotdo login')
      return { exitCode: 1, error: 'Not authenticated. Please run: dotdo login' }
    }
  } catch (error) {
    stderr('Error: Not authenticated. Please run: dotdo login')
    return { exitCode: 1, error: 'Not authenticated. Please run: dotdo login' }
  }

  // Read wrangler.toml
  const wranglerPath = join(cwd, 'wrangler.toml')
  let wranglerContent: string

  try {
    wranglerContent = await fs.readFile(wranglerPath)
  } catch {
    stderr('Error: wrangler.toml not found in current directory')
    stderr('Run "dotdo init <name>" to create a new project')
    return { exitCode: 1, error: 'wrangler.toml not found. Run dotdo init to create a project.' }
  }

  // Parse wrangler.toml
  let config: Record<string, unknown>
  try {
    config = parseToml(wranglerContent)
  } catch (error) {
    stderr('Error: Failed to parse wrangler.toml - invalid TOML syntax')
    return { exitCode: 1, error: 'Invalid TOML in wrangler.toml' }
  }

  // Validate config
  const validation = validateConfig(config)
  if (!validation.valid) {
    stderr(`Error: ${validation.error}`)
    return { exitCode: 1, error: validation.error }
  }

  const wranglerConfig: WranglerConfig = {
    name: config.name as string,
    main: config.main as string,
    compatibility_date: (config.compatibility_date as string) || new Date().toISOString().split('T')[0],
    compatibility_flags: config.compatibility_flags as string[] | undefined,
    build: config.build as WranglerConfig['build'],
    vars: config.vars as Record<string, string> | undefined,
  }

  stdout(`Deploying ${wranglerConfig.name}...`)
  stdout('')

  // Set up progress reporting
  api.onProgress((progress) => {
    stdout(`[${progress.stage}] ${progress.progress}% - ${progress.message}`)
  })

  // Compile the code
  stdout('Compiling...')
  let compilationResult: CompilationResult

  try {
    compilationResult = await compiler.compile(cwd, wranglerConfig)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    stderr(`Error: Compilation failed: ${message}`)
    return { exitCode: 1, error: `Compilation failed: ${message}` }
  }

  if (!compilationResult.success) {
    stderr('Error: Compilation failed')
    if (compilationResult.errors) {
      for (const error of compilationResult.errors) {
        stderr(`  ${error}`)
      }
    }
    return { exitCode: 1, error: 'Compilation failed' }
  }

  // Show warnings if any
  if (compilationResult.warnings && compilationResult.warnings.length > 0) {
    for (const warning of compilationResult.warnings) {
      stderr(`Warning: ${warning}`)
    }
  }

  if (!compilationResult.outputContent) {
    stderr('Error: No compiled output')
    return { exitCode: 1, error: 'No compiled output' }
  }

  // Deploy to API
  stdout('Uploading...')
  try {
    const result = await api.deploy(
      wranglerConfig.name,
      compilationResult.outputContent,
      {
        version: options.version,
        message: options.message,
      }
    )

    stdout('')
    stdout('Deployment successful!')
    stdout('')
    stdout(`  Name:          ${wranglerConfig.name}`)
    stdout(`  Deployment ID: ${result.deploymentId}`)
    stdout(`  Version:       ${result.version}`)
    stdout(`  URL:           ${result.url}`)
    stdout(`  Deployed at:   ${new Date(result.createdAt).toLocaleString()}`)

    if (options.message) {
      stdout(`  Message:       ${options.message}`)
    }

    stdout('')

    return { exitCode: 0 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // Provide helpful error messages
    if (message.includes('timeout')) {
      stderr(`Error: Request timeout - deployment may still be in progress`)
    } else if (message.includes('401') || message.includes('Unauthorized')) {
      stderr('Error: Authentication failed. Please run: dotdo login')
    } else if (message.includes('429') || message.includes('rate limit')) {
      stderr('Error: Rate limit exceeded. Please try again later.')
    } else if (message.includes('size') || message.includes('limit')) {
      stderr('Error: Bundle size exceeds limit. Try reducing your bundle size.')
    } else if (message.includes('already in progress')) {
      stderr('Error: A deployment is already in progress. Please wait and try again.')
    } else if (message.includes('taken') || message.includes('conflict')) {
      stderr('Error: Function name is already taken by another user.')
    } else if (message.includes('Token expired')) {
      stderr('Error: Your authentication token has expired. Please login again: dotdo login')
    } else if (message.includes('connection') || message.includes('network')) {
      stderr(`Error: Network error - ${message}`)
    } else {
      stderr(`Error: Deployment failed - ${message}`)
    }

    return { exitCode: 1, error: message }
  }
}
