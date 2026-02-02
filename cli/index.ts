#!/usr/bin/env node
/**
 * CLI for functions.do - Multi-language serverless functions
 *
 * Commands:
 * - init [name]     - Create a new function project
 * - dev             - Start local development server
 * - deploy          - Deploy function to functions.do
 * - list            - List deployed functions
 * - logs <id>       - View function logs
 * - invoke <id>     - Invoke a function
 * - delete <id>     - Delete a function
 * - rollback <id>   - Rollback to previous version
 * - secrets         - Manage function secrets
 * - status <id>     - View function status
 */

import cac from 'cac'
import { runInit } from './commands/init.js'
import { runDeploy } from './commands/deploy.js'
import { runInvoke } from './commands/invoke.js'
import { runList } from './commands/list.js'
import { runLogs } from './commands/logs.js'
import { runDelete } from './commands/delete.js'
import { runStatus } from './commands/status.js'
import { runSecrets } from './commands/secrets.js'
import { runRollback } from './commands/rollback.js'
import { createDefaultContext, createDefaultAPIClient, createDefaultPrompt, createDefaultCompiler } from './context.js'
import type { CLIContext } from './types.js'

const VERSION = '0.1.0'

/**
 * Command result
 */
export interface CommandResult {
  exitCode: number
  error?: string
}

/**
 * Create and return the CLI instance with all commands registered
 */
export function createCLI() {
  const cli = cac('dotdo')

  cli.version(VERSION)
  cli.help()

  // init command
  cli.command('init [name]', 'Create a new function project')
    .option('-t, --template <template>', 'Project template (typescript, rust, go, python)')
    .option('-f, --force', 'Overwrite existing directory')
    .action(async (name: string | undefined, options: { template?: string; force?: boolean }) => {
      const context = createDefaultContext()
      const result = await runInit(name || '', {
        template: options.template as 'typescript' | 'rust' | 'go' | 'python' | undefined,
        force: options.force,
      }, context)
      process.exit(result.exitCode)
    })

  // dev command
  cli.command('dev', 'Start local development server')
    .option('-p, --port <port>', 'Port to listen on', { default: 8787 })
    .option('--inspect', 'Enable Chrome DevTools debugging')
    .action(async (options: { port?: number; inspect?: boolean }) => {
      const { spawn } = await import('child_process')
      const args = ['wrangler', 'dev']
      if (options.port) args.push('--port', String(options.port))
      if (options.inspect) args.push('--inspect')
      const child = spawn('npx', args, { stdio: 'inherit' })
      child.on('exit', (code) => process.exit(code || 0))
    })

  // deploy command
  cli.command('deploy', 'Deploy function to functions.do')
    .option('-n, --name <name>', 'Function name')
    .option('--dry-run', 'Show what would be deployed without deploying')
    .option('-e, --env <env>', 'Environment (production, staging)')
    .option('-v, --version <version>', 'Deployment version')
    .option('-m, --message <message>', 'Deployment message')
    .action(async (options: { name?: string; dryRun?: boolean; env?: string; version?: string; message?: string }) => {
      const context = createDefaultContext()
      const api = createDefaultAPIClient(context)
      const compiler = createDefaultCompiler()
      const result = await runDeploy({
        version: options.version,
        message: options.message,
      }, { ...context, api, compiler })
      process.exit(result.exitCode)
    })

  // list command
  cli.command('list', 'List deployed functions')
    .option('-l, --limit <limit>', 'Number of functions to show', { default: 20 })
    .option('--json', 'Output as JSON')
    .action(async (options: { limit?: number; json?: boolean }) => {
      const context = createDefaultContext()
      const api = createDefaultAPIClient(context)
      const result = await runList({
        limit: options.limit,
        json: options.json,
      }, context, api)
      process.exit(result.exitCode)
    })

  // logs command
  cli.command('logs <functionId>', 'View function logs')
    .option('-f, --follow', 'Follow log output')
    .option('-n, --limit <lines>', 'Number of lines to show', { default: 100 })
    .option('--level <level>', 'Filter by log level (debug, info, warn, error)')
    .option('--since <time>', 'Show logs since time (ISO date or relative like 1h, 30m)')
    .action(async (functionId: string, options: { follow?: boolean; limit?: number; level?: string; since?: string }) => {
      const context = createDefaultContext()
      const api = createDefaultAPIClient(context)
      const result = await runLogs(functionId, {
        follow: options.follow,
        limit: options.limit,
        level: options.level as 'debug' | 'info' | 'warn' | 'error' | undefined,
        since: options.since,
      }, context, api)
      process.exit(result.exitCode)
    })

  // invoke command
  cli.command('invoke <functionId>', 'Invoke a function')
    .option('-d, --data <data>', 'JSON data to send')
    .option('-f, --file <file>', 'Read data from file')
    .option('-m, --method <method>', 'HTTP method to use')
    .option('-H, --header <header>', 'Add custom header (can be used multiple times)')
    .option('--timing', 'Show timing information')
    .option('--headers', 'Show response headers')
    .option('-v, --version <version>', 'Invoke specific version')
    .action(async (functionId: string, options: { data?: string; file?: string; method?: string; header?: string | string[]; timing?: boolean; headers?: boolean; version?: string }) => {
      const context = createDefaultContext()
      const api = createDefaultAPIClient(context)
      const headers = options.header ? (Array.isArray(options.header) ? options.header : [options.header]) : undefined
      const result = await runInvoke(functionId, {
        data: options.data,
        file: options.file,
        method: options.method,
        header: headers,
        timing: options.timing,
        headers: options.headers,
        version: options.version,
      }, { ...context, api })
      process.exit(result.exitCode)
    })

  // delete command
  cli.command('delete <functionId>', 'Delete a function')
    .option('-f, --force', 'Skip confirmation')
    .option('--all-versions', 'Delete all versions')
    .action(async (functionId: string, options: { force?: boolean; allVersions?: boolean }) => {
      const context = createDefaultContext()
      const api = createDefaultAPIClient(context)
      const prompt = createDefaultPrompt()
      const result = await runDelete(functionId, {
        force: options.force,
        allVersions: options.allVersions,
      }, context, api, prompt)
      process.exit(result.exitCode)
    })

  // rollback command
  cli.command('rollback <functionId>', 'Rollback to previous version')
    .option('-v, --version <version>', 'Specific version to rollback to')
    .option('-f, --force', 'Skip confirmation')
    .action(async (functionId: string, options: { version?: string; force?: boolean }) => {
      const context = createDefaultContext()
      const api = createDefaultAPIClient(context)
      const prompt = createDefaultPrompt()
      const result = await runRollback(functionId, {
        version: options.version,
        force: options.force,
      }, context, api, prompt)
      process.exit(result.exitCode)
    })

  // secrets list command
  cli.command('secrets list <functionName>', 'List function secrets')
    .option('--json', 'Output as JSON')
    .action(async (functionName: string, options: { json?: boolean }) => {
      const context = createDefaultContext()
      const api = createDefaultAPIClient(context)
      const result = await runSecrets({
        action: 'list',
        functionName,
        json: options.json,
      }, context, api)
      process.exit(result.exitCode)
    })

  // secrets set command
  cli.command('secrets set <functionName> <secretName> <secretValue>', 'Set a function secret')
    .action(async (functionName: string, secretName: string, secretValue: string) => {
      const context = createDefaultContext()
      const api = createDefaultAPIClient(context)
      const result = await runSecrets({
        action: 'set',
        functionName,
        secretName,
        secretValue,
      }, context, api)
      process.exit(result.exitCode)
    })

  // secrets delete command
  cli.command('secrets delete <functionName> <secretName>', 'Delete a function secret')
    .action(async (functionName: string, secretName: string) => {
      const context = createDefaultContext()
      const api = createDefaultAPIClient(context)
      const result = await runSecrets({
        action: 'delete',
        functionName,
        secretName,
      }, context, api)
      process.exit(result.exitCode)
    })

  // status command
  cli.command('status <functionId>', 'View function status')
    .option('--json', 'Output as JSON')
    .action(async (functionId: string, options: { json?: boolean }) => {
      const context = createDefaultContext()
      const api = createDefaultAPIClient(context)
      const result = await runStatus(functionId, {
        json: options.json,
      }, context, api)
      process.exit(result.exitCode)
    })

  return {
    name: 'dotdo',
    parse: cli.parse.bind(cli),
    commands: ['init', 'dev', 'deploy', 'list', 'logs', 'invoke', 'delete', 'rollback', 'secrets', 'status'],
    cli
  }
}

/**
 * Default CLI context using real implementations
 */
export function createDefaultContext_legacy(): CLIContext {
  return {
    fs: {
      readFile: async () => '',
      readFileBytes: async () => new Uint8Array(),
      writeFile: async () => {},
      readdir: async () => [],
      mkdir: async () => {},
      rm: async () => {},
      exists: async () => false,
      stat: async () => ({ size: 0, mode: 0, mtime: 0, type: 'file' as const }),
    },
    stdout: (text: string) => process.stdout.write(text + '\n'),
    stderr: (text: string) => process.stderr.write(text + '\n'),
    exit: (code: number) => process.exit(code),
    cwd: process.cwd(),
  }
}

/**
 * Run CLI with given arguments
 */
export async function runCLI(args: string[], context?: CLIContext): Promise<CommandResult> {
  const ctx = context || createDefaultContext()
  const { stdout, stderr } = ctx

  // Handle --version and -v
  if (args.includes('--version') || args.includes('-v')) {
    stdout(VERSION)
    return { exitCode: 0 }
  }

  // Handle --help and -h at root level
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    stdout(`
dotdo v${VERSION}
Multi-language serverless functions on Cloudflare Workers

Usage:
  dotdo <command> [options]

Commands:
  init [name]        Create a new function project
  dev                Start local development server
  deploy             Deploy function to functions.do
  list               List deployed functions
  logs <id>          View function logs
  invoke <id>        Invoke a function
  delete <id>        Delete a function
  rollback <id>      Rollback to previous version
  secrets            Manage function secrets
  status <id>        View function status

Options:
  -h, --help         Show help
  -v, --version      Show version

Examples:
  dotdo init my-function --template typescript
  dotdo dev
  dotdo deploy
  dotdo logs my-function --follow
  dotdo invoke my-function -d '{"name": "World"}'

Documentation: https://functions.do/docs
`)
    return { exitCode: 0 }
  }

  const command = args[0]
  const commandArgs = args.slice(1)

  switch (command) {
    case 'init': {
      const name = commandArgs[0] || ''
      const templateIdx = commandArgs.indexOf('--template')
      const tIdx = commandArgs.indexOf('-t')
      const template = templateIdx !== -1 ? commandArgs[templateIdx + 1] : (tIdx !== -1 ? commandArgs[tIdx + 1] : undefined)
      const force = commandArgs.includes('--force') || commandArgs.includes('-f')

      const result = await runInit(name, {
        template: template as 'typescript' | 'rust' | 'go' | 'python' | undefined,
        force,
      }, ctx)
      return result
    }

    case 'dev':
      stdout('Starting development server...')
      stdout('Use: wrangler dev')
      return { exitCode: 0 }

    case 'deploy': {
      const api = createDefaultAPIClient(ctx)
      const compiler = createDefaultCompiler()
      const versionIdx = commandArgs.indexOf('--version')
      const vIdx = commandArgs.indexOf('-v')
      const version = versionIdx !== -1 ? commandArgs[versionIdx + 1] : (vIdx !== -1 ? commandArgs[vIdx + 1] : undefined)
      const messageIdx = commandArgs.indexOf('--message')
      const mIdx = commandArgs.indexOf('-m')
      const message = messageIdx !== -1 ? commandArgs[messageIdx + 1] : (mIdx !== -1 ? commandArgs[mIdx + 1] : undefined)

      const result = await runDeploy({ version, message }, { ...ctx, api, compiler })
      return result
    }

    case 'list': {
      const api = createDefaultAPIClient(ctx)
      const json = commandArgs.includes('--json')
      const limitIdx = commandArgs.indexOf('--limit')
      const lIdx = commandArgs.indexOf('-l')
      const limitStr = limitIdx !== -1 ? commandArgs[limitIdx + 1] : (lIdx !== -1 ? commandArgs[lIdx + 1] : undefined)
      const limit = limitStr ? parseInt(limitStr, 10) : undefined

      const result = await runList({ json, limit }, ctx, api)
      return result
    }

    case 'logs': {
      const functionId = commandArgs[0] || ''
      const api = createDefaultAPIClient(ctx)
      const follow = commandArgs.includes('--follow') || commandArgs.includes('-f')
      const levelIdx = commandArgs.indexOf('--level')
      const level = levelIdx !== -1 ? commandArgs[levelIdx + 1] as 'debug' | 'info' | 'warn' | 'error' : undefined
      const sinceIdx = commandArgs.indexOf('--since')
      const since = sinceIdx !== -1 ? commandArgs[sinceIdx + 1] : undefined
      const limitIdx = commandArgs.indexOf('--limit')
      const nIdx = commandArgs.indexOf('-n')
      const limitStr = limitIdx !== -1 ? commandArgs[limitIdx + 1] : (nIdx !== -1 ? commandArgs[nIdx + 1] : undefined)
      const limit = limitStr ? parseInt(limitStr, 10) : undefined

      const result = await runLogs(functionId, { follow, level, since, limit }, ctx, api)
      return result
    }

    case 'invoke': {
      const functionId = commandArgs[0] || ''
      const api = createDefaultAPIClient(ctx)
      const dataIdx = commandArgs.indexOf('--data')
      const dIdx = commandArgs.indexOf('-d')
      const data = dataIdx !== -1 ? commandArgs[dataIdx + 1] : (dIdx !== -1 ? commandArgs[dIdx + 1] : undefined)
      const fileIdx = commandArgs.indexOf('--file')
      const fIdx = commandArgs.indexOf('-f')
      const file = fileIdx !== -1 ? commandArgs[fileIdx + 1] : (fIdx !== -1 ? commandArgs[fIdx + 1] : undefined)
      const timing = commandArgs.includes('--timing')
      const headers = commandArgs.includes('--headers')
      const versionIdx = commandArgs.indexOf('--version')
      const vIdx = commandArgs.indexOf('-v')
      const version = versionIdx !== -1 ? commandArgs[versionIdx + 1] : (vIdx !== -1 ? commandArgs[vIdx + 1] : undefined)

      const result = await runInvoke(functionId, { data, file, timing, headers, version }, { ...ctx, api })
      return result
    }

    case 'delete': {
      const functionId = commandArgs[0] || ''
      const api = createDefaultAPIClient(ctx)
      const prompt = createDefaultPrompt()
      const force = commandArgs.includes('--force') || commandArgs.includes('-f')
      const allVersions = commandArgs.includes('--all-versions')

      const result = await runDelete(functionId, { force, allVersions }, ctx, api, prompt)
      return result
    }

    case 'rollback': {
      const functionId = commandArgs[0] || ''
      const api = createDefaultAPIClient(ctx)
      const prompt = createDefaultPrompt()
      const force = commandArgs.includes('--force') || commandArgs.includes('-f')
      const versionIdx = commandArgs.indexOf('--version')
      const vIdx = commandArgs.indexOf('-v')
      const version = versionIdx !== -1 ? commandArgs[versionIdx + 1] : (vIdx !== -1 ? commandArgs[vIdx + 1] : undefined)

      const result = await runRollback(functionId, { version, force }, ctx, api, prompt)
      return result
    }

    case 'secrets': {
      const subcommand = commandArgs[0] || ''
      const functionName = commandArgs[1] || ''
      const api = createDefaultAPIClient(ctx)

      if (subcommand === 'list') {
        const json = commandArgs.includes('--json')
        const result = await runSecrets({ action: 'list', functionName, json }, ctx, api)
        return result
      } else if (subcommand === 'set') {
        const secretName = commandArgs[2] || ''
        const secretValue = commandArgs[3] || ''
        const result = await runSecrets({ action: 'set', functionName, secretName, secretValue }, ctx, api)
        return result
      } else if (subcommand === 'delete') {
        const secretName = commandArgs[2] || ''
        const result = await runSecrets({ action: 'delete', functionName, secretName }, ctx, api)
        return result
      } else {
        stderr('Usage:')
        stderr('  dotdo secrets list <function-name>')
        stderr('  dotdo secrets set <function-name> <KEY> <value>')
        stderr('  dotdo secrets delete <function-name> <KEY>')
        return { exitCode: 1, error: 'Invalid secrets subcommand' }
      }
    }

    case 'status': {
      const functionId = commandArgs[0] || ''
      const api = createDefaultAPIClient(ctx)
      const json = commandArgs.includes('--json')

      const result = await runStatus(functionId, { json }, ctx, api)
      return result
    }

    default:
      stderr(`Unknown command: ${command}`)
      stderr('Run "dotdo --help" for usage information')
      return { exitCode: 1, error: `Unknown command: ${command}` }
  }
}

// Re-export types and context
export { createDefaultContext, createDefaultAPIClient } from './context.js'
export type { CLIContext, MockFS, CommandResult as CLICommandResult } from './types.js'

// Run if called directly
if (typeof process !== 'undefined' && process.argv) {
  const args = process.argv.slice(2)

  // If running directly (not imported for testing), use cac
  if (args.length > 0 && !args.includes('--test-mode')) {
    const { cli } = createCLI()
    cli.parse(process.argv)
  } else if (args.length === 0) {
    runCLI([]).then(result => {
      process.exit(result.exitCode)
    })
  }
}
