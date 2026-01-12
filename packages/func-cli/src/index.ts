#!/usr/bin/env node

import { runDevCommand } from './commands/dev.js'
import { runDeployCommand, DeployCommandOptions } from './commands/deploy.js'

interface ParsedArgs {
  command: string | undefined
  port: number
  help: boolean
  version: boolean
  env: string
  dryRun: boolean
  verbose: boolean
  json: boolean
  inspect: boolean
  inspectPort: number
  rollback?: string | boolean
  preview: boolean
  prNumber?: number
  generateGithubAction: boolean
}

function parseArgs(args: string[]): ParsedArgs {
  let command: string | undefined
  let port = 8787
  let help = false
  let version = false
  let env: string = 'staging'
  let dryRun = false
  let verbose = false
  let json = false
  let inspect = false
  let inspectPort = 9229
  let rollback: string | boolean | undefined
  let preview = false
  let prNumber: number | undefined
  let generateGithubAction = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--port' || arg === '-p') {
      const nextArg = args[i + 1]
      if (nextArg && !nextArg.startsWith('-')) {
        port = parseInt(nextArg, 10)
        i++
      }
    } else if (arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--version' || arg === '-v') {
      version = true
    } else if (arg === '--env' || arg === '-e') {
      const nextArg = args[i + 1]
      if (nextArg && !nextArg.startsWith('-')) {
        env = nextArg
        i++
      }
    } else if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--verbose') {
      verbose = true
    } else if (arg === '--json') {
      json = true
    } else if (arg === '--inspect') {
      inspect = true
      // Check if next arg is a port number
      const nextArg = args[i + 1]
      if (nextArg && /^\d+$/.test(nextArg)) {
        inspectPort = parseInt(nextArg, 10)
        i++
      }
    } else if (arg.startsWith('--inspect=')) {
      inspect = true
      const portStr = arg.split('=')[1]
      if (portStr && /^\d+$/.test(portStr)) {
        inspectPort = parseInt(portStr, 10)
      }
    } else if (arg === '--rollback') {
      // Check if next arg is a version string (not another flag)
      const nextArg = args[i + 1]
      if (nextArg && !nextArg.startsWith('-')) {
        rollback = nextArg
        i++
      } else {
        rollback = true // Rollback to previous version
      }
    } else if (arg.startsWith('--rollback=')) {
      rollback = arg.split('=')[1]
    } else if (arg === '--preview') {
      preview = true
    } else if (arg === '--pr-number') {
      const nextArg = args[i + 1]
      if (nextArg && /^\d+$/.test(nextArg)) {
        prNumber = parseInt(nextArg, 10)
        i++
      }
    } else if (arg.startsWith('--pr-number=')) {
      const numStr = arg.split('=')[1]
      if (numStr && /^\d+$/.test(numStr)) {
        prNumber = parseInt(numStr, 10)
      }
    } else if (arg === '--generate-github-action' || arg === '--init-ci') {
      generateGithubAction = true
    } else if (!arg.startsWith('-') && !command) {
      command = arg
    }
  }

  return { command, port, help, version, env, dryRun, verbose, json, inspect, inspectPort, rollback, preview, prNumber, generateGithubAction }
}

function showHelp(): void {
  console.log(`
func - Functions.do CLI

Usage:
  func <command> [options]

Commands:
  dev      Start local development server
  deploy   Deploy function to Cloudflare Workers

Dev Options:
  --port, -p <port>       Port to run the server on (default: 8787)
  --inspect [port]        Enable Chrome DevTools debugging (default port: 9229)
  --verbose               Show detailed output including request logs

Deploy Options:
  --env, -e <env>         Target environment: staging, production (default: staging)
  --dry-run               Preview deployment without actually deploying
  --json                  Output in JSON format
  --verbose               Show detailed output
  --rollback [version]    Rollback to previous or specific version
  --preview               Create a preview deployment (for PRs)
  --pr-number <number>    PR number for preview deployment
  --generate-github-action Generate GitHub Actions CI/CD workflow
  --init-ci               Alias for --generate-github-action

General Options:
  --help, -h              Show this help message
  --version, -v           Show version number

Environment Variables:
  CLOUDFLARE_API_TOKEN     Cloudflare API token for deployment
  CLOUDFLARE_ACCOUNT_ID    Cloudflare account ID for deployment

Examples:
  func dev
  func dev --port 3000
  func dev --inspect
  func dev --inspect=9230
  func deploy
  func deploy --env production
  func deploy --dry-run
  func deploy --json
  func deploy --rollback              # Rollback to previous version
  func deploy --rollback 1.0.0        # Rollback to specific version
  func deploy --preview --pr-number 42
  func deploy --generate-github-action
`)
}

function showVersion(): void {
  console.log('func-cli v0.1.0')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const { command, port, help, version, env, dryRun, verbose, json, inspect, inspectPort, rollback, preview, prNumber, generateGithubAction } = parseArgs(args)

  if (version) {
    showVersion()
    process.exit(0)
  }

  if (help || !command) {
    showHelp()
    process.exit(help ? 0 : 1)
  }

  switch (command) {
    case 'dev':
      await runDevCommand({ port, inspect, inspectPort, verbose })
      break
    case 'deploy':
      await runDeployCommand({ env, dryRun, verbose, json, rollback, preview, prNumber, generateGithubAction })
      break
    default:
      console.error(`Unknown command: ${command}`)
      showHelp()
      process.exit(1)
  }
}

main().catch((error) => {
  console.error('Error:', error.message)
  process.exit(1)
})
