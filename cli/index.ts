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

const VERSION = '0.1.0'

/**
 * CLI context for dependency injection
 */
export interface CLIContext {
  stdout: (text: string) => void
  stderr: (text: string) => void
  exit: (code: number) => void
  fetch: typeof fetch
  env: Record<string, string | undefined>
}

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
    .option('-l, --lang <language>', 'Programming language (typescript, rust, go, python, csharp)')
    .option('-t, --template <template>', 'Project template')
    .action(() => {})

  // dev command
  cli.command('dev', 'Start local development server')
    .option('-p, --port <port>', 'Port to listen on', { default: 8787 })
    .option('--inspect', 'Enable Chrome DevTools debugging')
    .action(() => {})

  // deploy command
  cli.command('deploy', 'Deploy function to functions.do')
    .option('-n, --name <name>', 'Function name')
    .option('--dry-run', 'Show what would be deployed without deploying')
    .option('-e, --env <env>', 'Environment (production, staging)')
    .action(() => {})

  // list command
  cli.command('list', 'List deployed functions')
    .option('-l, --long', 'Show detailed information')
    .option('--json', 'Output as JSON')
    .action(() => {})

  // logs command
  cli.command('logs <functionId>', 'View function logs')
    .option('-f, --follow', 'Follow log output')
    .option('-n, --lines <lines>', 'Number of lines to show', { default: 100 })
    .option('--level <level>', 'Filter by log level (debug, info, warn, error)')
    .action(() => {})

  // invoke command
  cli.command('invoke <functionId>', 'Invoke a function')
    .option('-d, --data <data>', 'JSON data to send')
    .option('-f, --file <file>', 'Read data from file')
    .option('-m, --method <method>', 'RPC method to call')
    .action(() => {})

  // delete command
  cli.command('delete <functionId>', 'Delete a function')
    .option('-f, --force', 'Skip confirmation')
    .option('--all-versions', 'Delete all versions')
    .action(() => {})

  // rollback command
  cli.command('rollback <functionId>', 'Rollback to previous version')
    .option('-v, --version <version>', 'Specific version to rollback to')
    .action(() => {})

  // secrets command
  cli.command('secrets', 'Manage function secrets')
    .option('list', 'List all secrets')
    .option('set <name> <value>', 'Set a secret')
    .option('delete <name>', 'Delete a secret')
    .action(() => {})

  // status command
  cli.command('status <functionId>', 'View function status')
    .option('--json', 'Output as JSON')
    .action(() => {})

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
export function createDefaultContext(): CLIContext {
  return {
    stdout: (text: string) => process.stdout.write(text + '\n'),
    stderr: (text: string) => process.stderr.write(text + '\n'),
    exit: (code: number) => process.exit(code),
    fetch: globalThis.fetch,
    env: process.env,
  }
}

/**
 * Run CLI with given arguments
 */
export async function runCLI(args: string[], context: CLIContext = createDefaultContext()): Promise<CommandResult> {
  const { stdout, stderr } = context

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
  dotdo init my-function --lang typescript
  dotdo dev
  dotdo deploy
  dotdo logs my-function --follow
  dotdo invoke my-function -d '{"name": "World"}'

Documentation: https://functions.do/docs
`)
    return { exitCode: 0 }
  }

  const command = args[0]

  // Placeholder implementations - will be filled in with actual logic
  switch (command) {
    case 'init':
      stdout('Creating new function project...')
      stdout('Use: npx create-function <name> --lang <language>')
      return { exitCode: 0 }

    case 'dev':
      stdout('Starting development server...')
      stdout('Use: wrangler dev')
      return { exitCode: 0 }

    case 'deploy':
      stdout('Deploying function...')
      stdout('Use: wrangler deploy')
      return { exitCode: 0 }

    case 'list':
      stdout('Listing functions...')
      return { exitCode: 0 }

    case 'logs':
      stdout('Fetching logs...')
      return { exitCode: 0 }

    case 'invoke':
      stdout('Invoking function...')
      return { exitCode: 0 }

    case 'delete':
      stdout('Deleting function...')
      return { exitCode: 0 }

    case 'rollback':
      stdout('Rolling back function...')
      return { exitCode: 0 }

    case 'secrets':
      stdout('Managing secrets...')
      return { exitCode: 0 }

    case 'status':
      stdout('Fetching status...')
      return { exitCode: 0 }

    default:
      stderr(`Unknown command: ${command}`)
      stderr('Run "dotdo --help" for usage information')
      return { exitCode: 1, error: `Unknown command: ${command}` }
  }
}

// Run if called directly
if (typeof process !== 'undefined' && process.argv) {
  const args = process.argv.slice(2)
  runCLI(args).then(result => {
    process.exit(result.exitCode)
  })
}
