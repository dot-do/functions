import { existsSync, readFileSync, watch, mkdirSync, FSWatcher } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { Miniflare, Log, LogLevel } from 'miniflare'

export interface DevCommandOptions {
  port: number
  inspect?: boolean
  inspectPort?: number
  verbose?: boolean
}

interface ProjectConfig {
  main: string
  name: string
  compatibilityDate: string
}

interface SourceLocation {
  file: string
  line: number
  column: number
}

interface SourceMapPayload {
  version: number
  sources: string[]
  sourcesContent?: string[]
  mappings: string
  names: string[]
  file?: string
  sourceRoot?: string
}

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`
}

/**
 * Parse a source map and provide utilities for mapping positions
 */
class SourceMapConsumer {
  private sourceMap: SourceMapPayload
  private mappings: Array<{
    generatedLine: number
    generatedColumn: number
    originalLine: number
    originalColumn: number
    sourceIndex: number
    nameIndex?: number
  }> = []

  constructor(sourceMapContent: string) {
    this.sourceMap = JSON.parse(sourceMapContent)
    this.parseMappings()
  }

  private parseMappings(): void {
    const vlqChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const mappingsStr = this.sourceMap.mappings

    let generatedLine = 0
    let generatedColumn = 0
    let originalLine = 0
    let originalColumn = 0
    let sourceIndex = 0
    let nameIndex = 0

    for (const lineMapping of mappingsStr.split(';')) {
      generatedLine++
      generatedColumn = 0

      if (!lineMapping) continue

      for (const segment of lineMapping.split(',')) {
        if (!segment) continue

        const values: number[] = []
        let shift = 0
        let value = 0

        for (const char of segment) {
          const index = vlqChars.indexOf(char)
          if (index === -1) continue

          const hasMore = !!(index & 32)
          value += (index & 31) << shift

          if (hasMore) {
            shift += 5
          } else {
            const negative = value & 1
            value = value >> 1
            values.push(negative ? -value : value)
            shift = 0
            value = 0
          }
        }

        if (values.length >= 1) generatedColumn += values[0]
        if (values.length >= 2) sourceIndex += values[1]
        if (values.length >= 3) originalLine += values[2]
        if (values.length >= 4) originalColumn += values[3]
        if (values.length >= 5) nameIndex += values[4]

        if (values.length >= 4) {
          this.mappings.push({
            generatedLine,
            generatedColumn,
            originalLine: originalLine + 1, // 1-indexed
            originalColumn,
            sourceIndex,
            nameIndex: values.length >= 5 ? nameIndex : undefined,
          })
        }
      }
    }
  }

  originalPositionFor(line: number, column: number): SourceLocation | null {
    // Find the closest mapping for the given generated position
    let closest: (typeof this.mappings)[0] | null = null
    let closestDist = Infinity

    for (const mapping of this.mappings) {
      if (mapping.generatedLine === line) {
        const dist = Math.abs(mapping.generatedColumn - column)
        if (dist < closestDist) {
          closestDist = dist
          closest = mapping
        }
      } else if (mapping.generatedLine < line) {
        // Consider mappings from previous lines if no exact line match
        if (!closest || mapping.generatedLine > closest.generatedLine) {
          closest = mapping
        }
      }
    }

    if (!closest) return null

    const sourceFile = this.sourceMap.sources[closest.sourceIndex]
    if (!sourceFile) return null

    return {
      file: sourceFile,
      line: closest.originalLine,
      column: closest.originalColumn,
    }
  }

  get sources(): string[] {
    return this.sourceMap.sources
  }
}

/**
 * Enhanced error formatter with source map support
 */
class ErrorFormatter {
  private sourceMapConsumer: SourceMapConsumer | null = null
  private projectRoot: string
  private bundlePath: string

  constructor(projectRoot: string, bundlePath: string) {
    this.projectRoot = projectRoot
    this.bundlePath = bundlePath
    this.loadSourceMap()
  }

  private loadSourceMap(): void {
    const mapPath = this.bundlePath + '.map'
    if (existsSync(mapPath)) {
      try {
        const content = readFileSync(mapPath, 'utf-8')
        this.sourceMapConsumer = new SourceMapConsumer(content)
      } catch {
        // Failed to load source map
      }
    }
  }

  reload(): void {
    this.loadSourceMap()
  }

  formatError(error: Error): string {
    const lines: string[] = []

    // Error header
    lines.push('')
    lines.push(colorize('  ERROR  ', 'red') + ' ' + colorize(error.message, 'bold'))
    lines.push('')

    // Parse and enhance stack trace
    if (error.stack) {
      const stackLines = this.parseStackTrace(error.stack)
      if (stackLines.length > 0) {
        lines.push(colorize('  Stack trace:', 'dim'))
        for (const frame of stackLines) {
          lines.push(this.formatStackFrame(frame))
        }
      }
    }

    lines.push('')
    return lines.join('\n')
  }

  private parseStackTrace(
    stack: string
  ): Array<{ fn: string; file: string; line: number; column: number }> {
    const frames: Array<{ fn: string; file: string; line: number; column: number }> = []
    const lines = stack.split('\n')

    for (const line of lines) {
      // Match "at functionName (file:line:column)" or "at file:line:column"
      const match =
        line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/) ||
        line.match(/at\s+(.+?):(\d+):(\d+)/)

      if (match) {
        const hasFunction = match.length === 5
        frames.push({
          fn: hasFunction ? match[1] || '<anonymous>' : '<anonymous>',
          file: hasFunction ? match[2] : match[1],
          line: parseInt(hasFunction ? match[3] : match[2], 10),
          column: parseInt(hasFunction ? match[4] : match[3], 10),
        })
      }
    }

    return frames
  }

  private formatStackFrame(frame: { fn: string; file: string; line: number; column: number }): string {
    let { file, line, column, fn } = frame

    // Try to map to original source
    if (this.sourceMapConsumer && (file.includes('worker.js') || file.includes('.func/'))) {
      const original = this.sourceMapConsumer.originalPositionFor(line, column)
      if (original) {
        file = original.file
        line = original.line
        column = original.column
      }
    }

    // Make path relative to project root
    if (file.startsWith(this.projectRoot)) {
      file = relative(this.projectRoot, file)
    } else if (file.startsWith('file://')) {
      try {
        const filePath = fileURLToPath(file)
        file = relative(this.projectRoot, filePath)
      } catch {
        // Keep original
      }
    }

    // Format: function at file:line:column
    const location = colorize(`${file}:${line}:${column}`, 'cyan')
    const funcName = colorize(fn, 'yellow')
    return `    at ${funcName} (${location})`
  }

  formatBuildError(error: string): string {
    const lines: string[] = []
    lines.push('')
    lines.push(colorize('  BUILD ERROR  ', 'red'))
    lines.push('')

    // Parse esbuild error format
    const errorLines = error.split('\n')
    for (const line of errorLines) {
      // Check for file:line:column pattern
      const match = line.match(/^(.+?):(\d+):(\d+):\s*(.+)$/)
      if (match) {
        const [, file, lineNum, col, msg] = match
        const relFile = file.startsWith(this.projectRoot) ? relative(this.projectRoot, file) : file
        lines.push(`  ${colorize(relFile, 'cyan')}:${colorize(lineNum, 'yellow')}:${col}`)
        lines.push(`    ${colorize(msg, 'red')}`)
      } else if (line.trim()) {
        lines.push(`  ${line}`)
      }
    }

    lines.push('')
    return lines.join('\n')
  }

  formatTypeError(error: string): string {
    const lines: string[] = []
    lines.push('')
    lines.push(colorize('  TYPE ERROR  ', 'red'))
    lines.push('')

    // Parse TypeScript error format
    const errorLines = error.split('\n')
    for (const line of errorLines) {
      // Match TypeScript error format: file(line,col): error TS####: message
      const match = line.match(/^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/)
      if (match) {
        const [, file, lineNum, col, code, msg] = match
        const relFile = file.startsWith(this.projectRoot) ? relative(this.projectRoot, file) : file
        lines.push(`  ${colorize(relFile, 'cyan')}:${colorize(lineNum, 'yellow')}:${col}`)
        lines.push(`    ${colorize(code, 'magenta')}: ${msg}`)
      } else if (line.trim()) {
        // Also handle alternative format: file:line:col - error TSxxxx: message
        const altMatch = line.match(/^(.+?):(\d+):(\d+)\s*-\s*error\s+(TS\d+):\s*(.+)$/)
        if (altMatch) {
          const [, file, lineNum, col, code, msg] = altMatch
          const relFile = file.startsWith(this.projectRoot) ? relative(this.projectRoot, file) : file
          lines.push(`  ${colorize(relFile, 'cyan')}:${colorize(lineNum, 'yellow')}:${col}`)
          lines.push(`    ${colorize(code, 'magenta')}: ${msg}`)
        } else {
          lines.push(`  ${line}`)
        }
      }
    }

    lines.push('')
    return lines.join('\n')
  }
}

/**
 * Request logger for development
 */
class RequestLogger {
  private enabled: boolean

  constructor(enabled: boolean = true) {
    this.enabled = enabled
  }

  log(method: string, path: string, status: number, durationMs: number): void {
    if (!this.enabled) return

    const timestamp = new Date().toISOString().split('T')[1].replace('Z', '')
    const methodColor = this.getMethodColor(method)
    const statusColor = this.getStatusColor(status)

    const methodStr = colorize(method.padEnd(6), methodColor)
    const statusStr = colorize(status.toString(), statusColor)
    const durationStr = this.formatDuration(durationMs)
    const timeStr = colorize(timestamp, 'dim')

    console.log(`${timeStr} ${methodStr} ${path} ${statusStr} ${durationStr}`)
  }

  logError(method: string, path: string, error: Error, durationMs: number): void {
    if (!this.enabled) return

    const timestamp = new Date().toISOString().split('T')[1].replace('Z', '')
    const methodStr = colorize(method.padEnd(6), this.getMethodColor(method))
    const statusStr = colorize('ERR', 'red')
    const durationStr = this.formatDuration(durationMs)
    const timeStr = colorize(timestamp, 'dim')

    console.log(`${timeStr} ${methodStr} ${path} ${statusStr} ${durationStr}`)
    console.log(colorize(`  Error: ${error.message}`, 'red'))
  }

  private getMethodColor(method: string): keyof typeof colors {
    switch (method.toUpperCase()) {
      case 'GET':
        return 'green'
      case 'POST':
        return 'blue'
      case 'PUT':
        return 'yellow'
      case 'DELETE':
        return 'red'
      case 'PATCH':
        return 'magenta'
      default:
        return 'gray'
    }
  }

  private getStatusColor(status: number): keyof typeof colors {
    if (status >= 500) return 'red'
    if (status >= 400) return 'yellow'
    if (status >= 300) return 'cyan'
    if (status >= 200) return 'green'
    return 'gray'
  }

  private formatDuration(ms: number): string {
    if (ms < 1) {
      return colorize(`${(ms * 1000).toFixed(0)}µs`, 'dim')
    }
    if (ms < 1000) {
      return colorize(`${ms.toFixed(0)}ms`, 'dim')
    }
    return colorize(`${(ms / 1000).toFixed(2)}s`, 'yellow')
  }
}

function findProjectConfig(cwd: string): ProjectConfig | null {
  // Check for wrangler.toml
  const wranglerTomlPath = join(cwd, 'wrangler.toml')
  if (existsSync(wranglerTomlPath)) {
    const content = readFileSync(wranglerTomlPath, 'utf-8')
    const main = extractTomlValue(content, 'main') || 'src/index.ts'
    const name = extractTomlValue(content, 'name') || 'function'
    const compatibilityDate = extractTomlValue(content, 'compatibility_date') || '2024-01-01'
    return { main, name, compatibilityDate }
  }

  // Check for wrangler.jsonc or wrangler.json
  const wranglerJsoncPath = join(cwd, 'wrangler.jsonc')
  const wranglerJsonPath = join(cwd, 'wrangler.json')

  for (const configPath of [wranglerJsoncPath, wranglerJsonPath]) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8')
        // Strip comments for jsonc
        const cleanContent = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
        const config = JSON.parse(cleanContent)
        return {
          main: config.main || 'src/index.ts',
          name: config.name || 'function',
          compatibilityDate: config.compatibility_date || '2024-01-01',
        }
      } catch {
        // Failed to parse, try next
      }
    }
  }

  // Check for package.json
  const packageJsonPath = join(cwd, 'package.json')
  if (existsSync(packageJsonPath)) {
    // Only return config if there's also a src/index.ts
    const srcIndexPath = join(cwd, 'src', 'index.ts')
    if (existsSync(srcIndexPath)) {
      try {
        const content = readFileSync(packageJsonPath, 'utf-8')
        const pkg = JSON.parse(content)
        return {
          main: 'src/index.ts',
          name: pkg.name || 'function',
          compatibilityDate: '2024-01-01',
        }
      } catch {
        // Failed to parse
      }
    }
  }

  return null
}

function extractTomlValue(content: string, key: string): string | null {
  const regex = new RegExp(`^${key}\\s*=\\s*["']([^"']+)["']`, 'm')
  const match = content.match(regex)
  return match ? match[1] : null
}

async function buildWorker(
  entryPoint: string,
  outfile: string,
  options: { sourcemap?: boolean } = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    // Ensure output directory exists
    const outDir = dirname(outfile)
    if (!existsSync(outDir)) {
      mkdirSync(outDir, { recursive: true })
    }

    const result = await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      format: 'esm',
      target: 'esnext',
      platform: 'browser',
      outfile,
      minify: false,
      sourcemap: options.sourcemap !== false ? 'linked' : false,
      sourceRoot: dirname(entryPoint),
      sourcesContent: true,
      external: [],
      logLevel: 'silent',
      metafile: true,
    })

    if (result.errors.length > 0) {
      return {
        success: false,
        error: result.errors.map((e) => e.text).join('\n'),
      }
    }

    return { success: true }
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function typeCheck(cwd: string): Promise<{ success: boolean; error?: string }> {
  const { spawn } = await import('node:child_process')

  return new Promise((resolve) => {
    // Check if tsconfig exists
    const tsconfigPath = join(cwd, 'tsconfig.json')
    if (!existsSync(tsconfigPath)) {
      // No tsconfig, skip type checking
      resolve({ success: true })
      return
    }

    // Check if node_modules/.bin/tsc exists (dependencies installed)
    const localTsc = join(cwd, 'node_modules', '.bin', 'tsc')
    if (!existsSync(localTsc)) {
      // Dependencies not installed, skip type checking
      // esbuild will still catch syntax errors
      resolve({ success: true })
      return
    }

    const tsc = spawn(localTsc, ['--noEmit', '--skipLibCheck'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    })

    let stdout = ''
    let stderr = ''

    tsc.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    tsc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    tsc.on('error', () => {
      // tsc not available, skip type checking
      resolve({ success: true })
    })

    tsc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        const output = stdout + stderr

        // Filter out configuration-related errors (missing type definitions, etc.)
        // Only fail on actual code errors
        const allErrors = output.match(/error TS\d+:.*/g) || []
        const codeErrors = allErrors.filter((err) => {
          // TS2688: Cannot find type definition file
          // TS2307: Cannot find module (for @types packages)
          // These are configuration/dependency issues, not code errors
          if (/error TS2688:/.test(err)) return false
          if (/error TS2307:.*@types/.test(err)) return false
          return true
        })

        if (codeErrors.length === 0) {
          // Only configuration errors, proceed
          resolve({ success: true })
        } else {
          resolve({
            success: false,
            error: output,
          })
        }
      }
    })
  })
}

export async function runDevCommand(options: DevCommandOptions): Promise<void> {
  const cwd = process.cwd()
  const { port, inspect = false, inspectPort = 9229, verbose = false } = options

  // Find project configuration
  const config = findProjectConfig(cwd)
  if (!config) {
    console.error('Error: No function project found in current directory.')
    console.error('Make sure you have a wrangler.toml, wrangler.json, or package.json with src/index.ts')
    process.exit(1)
  }

  const entryPoint = resolve(cwd, config.main)
  if (!existsSync(entryPoint)) {
    console.error(`Error: Entry point not found: ${config.main}`)
    process.exit(1)
  }

  const outfile = join(cwd, '.func', 'worker.js')

  // Initialize error formatter and request logger
  const errorFormatter = new ErrorFormatter(cwd, outfile)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const requestLogger = new RequestLogger(verbose)

  // Run TypeScript type check first
  console.log(colorize('Type checking...', 'dim'))
  const typeCheckResult = await typeCheck(cwd)
  if (!typeCheckResult.success) {
    console.error(errorFormatter.formatTypeError(typeCheckResult.error!))
    process.exit(1)
  }

  // Build the worker with source maps
  console.log(colorize('Building worker...', 'dim'))
  const buildResult = await buildWorker(entryPoint, outfile, { sourcemap: true })
  if (!buildResult.success) {
    console.error(errorFormatter.formatBuildError(buildResult.error!))
    process.exit(1)
  }

  // Reload source maps after initial build
  errorFormatter.reload()

  // Create miniflare instance
  let mf: Miniflare | null = null
  let watcher: FSWatcher | null = null
  let isShuttingDown = false
  let isReloading = false
  let pendingReload = false

  // esbuild context for fast incremental rebuilds
  let esbuildCtx: esbuild.BuildContext | null = null

  // Initialize esbuild context for incremental builds
  const initEsbuildContext = async (): Promise<void> => {
    esbuildCtx = await esbuild.context({
      entryPoints: [entryPoint],
      bundle: true,
      format: 'esm',
      target: 'esnext',
      platform: 'browser',
      outfile,
      minify: false,
      sourcemap: 'linked',
      sourceRoot: dirname(entryPoint),
      sourcesContent: true,
      external: [],
      logLevel: 'silent',
      metafile: true,
    })
  }

  const startMiniflare = async (): Promise<Miniflare> => {
    const mfOptions: ConstructorParameters<typeof Miniflare>[0] = {
      name: config.name,
      scriptPath: outfile,
      modules: true,
      compatibilityDate: config.compatibilityDate,
      port,
      log: new Log(verbose ? LogLevel.DEBUG : LogLevel.ERROR),
    }

    // Add inspector support if requested
    if (inspect) {
      mfOptions.inspectorPort = inspectPort
      console.log(colorize(`Inspector available at: chrome://inspect`, 'cyan'))
      console.log(colorize(`Or connect debugger to: ws://127.0.0.1:${inspectPort}`, 'cyan'))
    }

    const instance = new Miniflare(mfOptions)

    return instance
  }

  const rebuild = async (): Promise<boolean> => {
    const startTime = performance.now()

    // Type check (run in parallel with build for speed, but fail if either fails)
    const typePromise = typeCheck(cwd)

    // Use incremental build if context is available
    let buildSuccess = false
    let buildError: string | undefined

    if (esbuildCtx) {
      try {
        const result = await esbuildCtx.rebuild()
        if (result.errors.length > 0) {
          buildError = result.errors.map((e) => e.text).join('\n')
        } else {
          buildSuccess = true
        }
      } catch (err: unknown) {
        buildError = err instanceof Error ? err.message : String(err)
      }
    } else {
      const result = await buildWorker(entryPoint, outfile, { sourcemap: true })
      buildSuccess = result.success
      buildError = result.error
    }

    const typeResult = await typePromise
    const duration = performance.now() - startTime

    if (!typeResult.success) {
      console.error(errorFormatter.formatTypeError(typeResult.error!))
      return false
    }

    if (!buildSuccess) {
      console.error(errorFormatter.formatBuildError(buildError!))
      return false
    }

    // Reload source maps after rebuild
    errorFormatter.reload()

    console.log(colorize(`Rebuilt in ${duration.toFixed(0)}ms`, 'green'))
    return true
  }

  const reload = async (): Promise<void> => {
    if (isShuttingDown) return

    // If already reloading, mark pending and return
    if (isReloading) {
      pendingReload = true
      return
    }

    isReloading = true

    try {
      const success = await rebuild()
      if (!success) {
        isReloading = false
        // Check for pending reload
        if (pendingReload) {
          pendingReload = false
          reload()
        }
        return
      }

      console.log(colorize('Reloading worker...', 'dim'))

      // Use setOptions for fast reload without full restart
      if (mf) {
        try {
          // Use setOptions for hot reload - this updates the worker without restarting the server
          await mf.setOptions({
            name: config.name,
            scriptPath: outfile,
            modules: true,
            compatibilityDate: config.compatibilityDate,
          })

          // Wait for the worker to be ready after the options update
          await mf.ready

          console.log(colorize('Worker updated', 'green'))
        } catch (err: unknown) {
          console.error(colorize(`Failed to hot reload: ${err instanceof Error ? err.message : String(err)}`, 'red'))
          // Fallback to full restart
          console.log(colorize('Falling back to full restart...', 'yellow'))

          try {
            await mf.dispose()
          } catch {
            // Ignore dispose errors
          }

          mf = await startMiniflare()
          await mf.ready
          console.log(colorize('Worker restarted', 'green'))
        }
      }
    } finally {
      isReloading = false

      // Handle pending reload
      if (pendingReload) {
        pendingReload = false
        reload()
      }
    }
  }

  // Setup file watcher
  const setupWatcher = (): void => {
    const srcDir = join(cwd, 'src')
    if (!existsSync(srcDir)) return

    let debounceTimer: NodeJS.Timeout | null = null

    watcher = watch(srcDir, { recursive: true }, (eventType, filename) => {
      // Only watch TypeScript files
      if (!filename || !filename.endsWith('.ts')) return

      // Debounce rapid changes
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }

      debounceTimer = setTimeout(() => {
        console.log(colorize(`File changed: ${filename}`, 'dim'))
        reload()
      }, 100)
    })
  }

  // Graceful shutdown handler
  const shutdown = (signal: string): void => {
    if (isShuttingDown) return
    isShuttingDown = true

    console.log(colorize(`\nReceived ${signal}, shutting down...`, 'dim'))

    // Close watcher synchronously
    if (watcher) {
      watcher.close()
      watcher = null
    }

    // Dispose resources and exit
    // Use Promise.all for parallel cleanup, but don't await in signal handler
    const cleanup = async () => {
      const cleanupPromises: Promise<void>[] = []

      if (esbuildCtx) {
        cleanupPromises.push(esbuildCtx.dispose().catch(() => {}))
        esbuildCtx = null
      }

      if (mf) {
        cleanupPromises.push(mf.dispose().catch(() => {}))
        mf = null
      }

      await Promise.all(cleanupPromises)
    }

    cleanup().finally(() => {
      process.exit(0)
    })
  }

  // Register signal handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  // Initialize esbuild context for incremental builds
  try {
    await initEsbuildContext()
  } catch (err: unknown) {
    console.error(colorize(`Failed to initialize build context: ${err instanceof Error ? err.message : String(err)}`, 'red'))
    // Continue without incremental builds
  }

  // Start miniflare
  try {
    mf = await startMiniflare()
    await mf.ready
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const errCode = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined
    if (errMsg.includes('EADDRINUSE') || errCode === 'EADDRINUSE') {
      console.error(colorize(`Error: Port ${port} is already in use`, 'red'))
      process.exit(1)
    }
    throw err
  }

  // Setup watcher after server starts
  setupWatcher()

  // Print startup info
  console.log('')
  console.log(colorize('  Functions.do Development Server', 'bold'))
  console.log('')
  console.log(`  ${colorize('Local:', 'dim')}   http://localhost:${port}`)
  if (inspect) {
    console.log(`  ${colorize('Debug:', 'dim')}   chrome://inspect (port ${inspectPort})`)
  }
  console.log('')
  console.log(colorize('  Watching for changes...', 'dim'))
  console.log('')

  // Print the server URL for tests to detect (tests look for this)
  console.log(`http://localhost:${port}`)
  console.log(`Server started and ready`)
}
