/**
 * Pyodide Executor for Functions.do
 *
 * This module provides the interface for executing Python code via Pyodide
 * (Python running in WebAssembly). It handles:
 * - Loading and initializing the Pyodide runtime
 * - Executing Python code with specified handlers
 * - Managing packages and dependencies
 * - Enforcing memory and time limits
 * - Converting data between JavaScript and Python
 * - Memory snapshots for cold start optimization
 */

import { isPackageCompatible } from './pyodide-compat'

/**
 * Type guard for the non-standard performance.memory API (Chrome/Node.js).
 * This checks for the presence of the memory property at runtime without
 * requiring double type assertions through unknown.
 */
interface PerformanceWithMemory extends Performance {
  memory: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number }
}

function hasMemoryInfo(perf: Performance): perf is PerformanceWithMemory {
  return 'memory' in perf && typeof (perf as PerformanceWithMemory).memory?.usedJSHeapSize === 'number'
}

/**
 * Type guard for globalThis with a loadPyodide function (Workers environment).
 */
interface GlobalWithPyodide {
  loadPyodide: (options: { indexURL?: string }) => Promise<PyodideInterface>
}

function hasLoadPyodide(global: typeof globalThis): global is typeof globalThis & GlobalWithPyodide {
  return 'loadPyodide' in global && typeof (global as Record<string, unknown>)['loadPyodide'] === 'function'
}

/**
 * Adapt an external Pyodide module's return value to our internal PyodideInterface.
 * The external API is structurally compatible but TypeScript can't verify it across
 * module boundaries. This helper encapsulates the cast in a documented location.
 */
function asPyodideInterface(loaded: unknown): PyodideInterface {
  return loaded as never
}

/**
 * Options for initializing the Pyodide runtime
 */
export interface PyodideRuntimeOptions {
  /**
   * URL to load Pyodide from (e.g., CDN URL)
   */
  indexURL?: string

  /**
   * Initial memory allocation in MB
   */
  initialMemoryMB?: number

  /**
   * Maximum memory allocation in MB
   */
  maxMemoryMB?: number

  /**
   * Packages to preload during initialization
   */
  preloadPackages?: string[]

  /**
   * Standard library modules to preload
   */
  preloadModules?: string[]
}

/**
 * Options for executing Python code
 */
export interface PyodideExecutionOptions {
  /**
   * Packages to install before execution
   */
  packages?: string[]

  /**
   * requirements.txt content to parse and install
   */
  requirementsTxt?: string

  /**
   * Timeout in milliseconds
   */
  timeoutMs?: number

  /**
   * Memory limit in MB
   */
  memoryLimitMB?: number

  /**
   * Initial memory in MB
   */
  initialMemoryMB?: number

  /**
   * Keyword arguments to pass to the handler
   */
  kwargs?: Record<string, unknown>

  /**
   * Skip incompatible packages instead of failing
   */
  skipIncompatible?: boolean

  /**
   * Only validate packages without executing code
   */
  validateOnly?: boolean

  /**
   * Isolate execution (fresh namespace)
   */
  isolate?: boolean
}

/**
 * Execution metrics for profiling
 */
export interface ExecutionMetrics {
  /**
   * Time to parse Python code in ms
   */
  parseTimeMs: number

  /**
   * Time to execute handler in ms
   */
  executeTimeMs: number

  /**
   * Total execution time in ms
   */
  totalTimeMs: number

  /**
   * Time to install packages in ms (if any)
   */
  packageInstallTimeMs?: number
}

/**
 * Result of executing Python code via Pyodide
 */
export interface PyodideExecutionResult {
  /**
   * Whether execution succeeded
   */
  success: boolean

  /**
   * Return value from the handler (if successful)
   */
  value?: unknown

  /**
   * Error message (if failed)
   */
  error?: string

  /**
   * Type of error (e.g., "ValueError", "TypeError")
   */
  errorType?: string

  /**
   * Line number where error occurred
   */
  errorLine?: number

  /**
   * Full stack trace
   */
  stackTrace?: string

  /**
   * Whether execution timed out
   */
  timedOut?: boolean

  /**
   * Memory used in bytes
   */
  memoryUsedBytes?: number

  /**
   * Peak memory usage in bytes
   */
  peakMemoryBytes?: number

  /**
   * Execution time in milliseconds
   */
  executionTimeMs?: number

  /**
   * List of available handler functions
   */
  handlers?: string[]

  /**
   * Packages that were incompatible and not installed
   */
  incompatiblePackages?: string[]

  /**
   * Packages that were skipped (when skipIncompatible is true)
   */
  skippedPackages?: string[]

  /**
   * Suggestion for fixing incompatible packages
   */
  suggestion?: string

  /**
   * Warning messages
   */
  warnings?: string[]

  /**
   * Execution metrics for profiling
   */
  metrics?: ExecutionMetrics
}

/**
 * Interface for the Pyodide runtime module
 * This represents the external Pyodide API we use internally
 */
interface PyodideInterface {
  runPython(code: string, options?: { globals?: unknown }): unknown
  runPythonAsync(code: string, options?: { globals?: unknown }): Promise<unknown>
  loadPackage(packages: string | string[]): Promise<void>
  pyimport(module: string): { install(packages: string | string[]): Promise<void> }
  globals: Map<string, unknown>
  toPy(obj: unknown): unknown
  isPyProxy?(obj: unknown): boolean
  _module?: {
    HEAPU8?: { byteLength: number }
  }
}

/**
 * Pyodide runtime instance wrapper
 */
export interface PyodideRuntime {
  /**
   * Execute Python code synchronously
   */
  runPython(code: string): unknown

  /**
   * Run async Python code
   */
  runPythonAsync(code: string): Promise<unknown>

  /**
   * Load a package
   */
  loadPackage(packages: string | string[]): Promise<void>

  /**
   * Install packages from PyPI via micropip
   */
  micropip: {
    install(packages: string | string[]): Promise<void>
  }

  /**
   * Access Python globals
   */
  globals: Map<string, unknown>

  /**
   * Convert a JavaScript object to Python
   */
  toPy(obj: unknown): unknown

  /**
   * Dispose of the runtime and free resources
   */
  dispose(): Promise<void>

  /**
   * Internal Pyodide instance
   */
  _pyodide: PyodideInterface

  /**
   * Memory tracking
   */
  _memoryTracker: MemoryTracker

  /**
   * Memory snapshot data (if created)
   */
  _snapshot?: MemorySnapshot
}

/**
 * Memory snapshot for cold start optimization
 */
export interface MemorySnapshot {
  /**
   * Snapshot data (serialized state)
   */
  data: Uint8Array

  /**
   * Modules included in the snapshot
   */
  modules: string[]

  /**
   * Packages included in the snapshot
   */
  packages: string[]

  /**
   * Snapshot creation time in ms
   */
  createTimeMs: number

  /**
   * Size in bytes
   */
  sizeBytes: number
}

/**
 * Memory tracker for monitoring Pyodide memory usage
 */
class MemoryTracker {
  private baselineMemory: number = 0
  private peakMemory: number = 0
  private currentMemory: number = 0
  private memoryLimit: number = 0
  private pyodide: PyodideInterface

  constructor(pyodide: PyodideInterface, limitMB: number = 128) {
    this.pyodide = pyodide
    this.memoryLimit = limitMB * 1024 * 1024
    this.updateBaseline()
  }

  updateBaseline(): void {
    this.baselineMemory = this.getCurrentMemory()
    this.peakMemory = this.baselineMemory
  }

  getCurrentMemory(): number {
    try {
      // Pyodide exposes memory through the HEAPU8 buffer
      if (this.pyodide?._module?.HEAPU8?.byteLength) {
        return this.pyodide._module.HEAPU8.byteLength
      }
      // Fallback: estimate based on performance.memory if available (Chrome/Node.js non-standard API)
      if (typeof performance !== 'undefined' && hasMemoryInfo(performance)) {
        return performance.memory.usedJSHeapSize
      }
      return 0
    } catch {
      return 0
    }
  }

  updatePeak(): void {
    this.currentMemory = this.getCurrentMemory()
    if (this.currentMemory > this.peakMemory) {
      this.peakMemory = this.currentMemory
    }
  }

  checkLimit(): boolean {
    this.updatePeak()
    return this.currentMemory - this.baselineMemory < this.memoryLimit
  }

  getUsedBytes(): number {
    return this.getCurrentMemory() - this.baselineMemory
  }

  getPeakBytes(): number {
    return this.peakMemory - this.baselineMemory
  }

  setLimit(limitMB: number): void {
    this.memoryLimit = limitMB * 1024 * 1024
  }
}

/**
 * Package compatibility information
 */
interface PackageCompat {
  compatible: string[]
  incompatible: Array<{ name: string; reason: string; suggestion?: string }>
  skipped: string[]
}

/**
 * Known incompatible packages with suggestions
 */
const INCOMPATIBLE_PACKAGES: Record<string, { reason: string; suggestion?: string }> = {
  psycopg2: { reason: 'Requires native PostgreSQL library', suggestion: 'Use Hyperdrive or REST APIs' },
  'psycopg2-binary': { reason: 'Requires native PostgreSQL library', suggestion: 'Use Hyperdrive or REST APIs' },
  boto3: { reason: 'Requires socket connections', suggestion: 'Use fetch with AWS Signature V4' },
  botocore: { reason: 'Requires socket connections', suggestion: 'Use fetch with AWS Signature V4' },
  redis: { reason: 'Requires socket connections', suggestion: 'Use Workers KV or Upstash Redis REST API' },
  tensorflow: { reason: 'Too large for Workers', suggestion: 'Use Workers AI for inference' },
  torch: { reason: 'Too large for Workers', suggestion: 'Use Workers AI for inference' },
  pytorch: { reason: 'Too large for Workers', suggestion: 'Use Workers AI for inference' },
  django: { reason: 'Web framework not compatible with Workers', suggestion: 'Export handler functions directly' },
  flask: { reason: 'Web framework not compatible with Workers', suggestion: 'Export handler functions directly' },
  fastapi: { reason: 'Requires ASGI server', suggestion: 'Export handler functions directly' },
}

/**
 * Check package compatibility and categorize them
 */
function checkPackageCompatibility(packages: string[]): PackageCompat {
  const result: PackageCompat = {
    compatible: [],
    incompatible: [],
    skipped: [],
  }

  for (const pkg of packages) {
    const normalizedPkg = pkg.toLowerCase().split(/[>=<~!]/)[0].trim()

    if (INCOMPATIBLE_PACKAGES[normalizedPkg]) {
      const info = INCOMPATIBLE_PACKAGES[normalizedPkg]
      result.incompatible.push({
        name: normalizedPkg,
        reason: info.reason,
        suggestion: info.suggestion,
      })
    } else {
      const compat = isPackageCompatible(normalizedPkg)
      if (compat === 'incompatible') {
        result.incompatible.push({
          name: normalizedPkg,
          reason: 'Not compatible with Pyodide/WASM',
        })
      } else {
        result.compatible.push(pkg)
      }
    }
  }

  return result
}

/**
 * Parse requirements.txt content and extract package names
 */
export function parseRequirementsTxt(content: string): string[] {
  const packages: string[] = []
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    // Skip options like --index-url, -r, -e, etc.
    if (trimmed.startsWith('-')) {
      continue
    }

    // Extract package name (handle version specifiers)
    const match = trimmed.match(/^([a-zA-Z0-9_-]+(?:\[[a-zA-Z0-9_,]+\])?)/)
    if (match) {
      packages.push(match[1])
    }
  }

  return packages
}

/**
 * Validate Python packages for Pyodide compatibility
 */
export function validatePyodidePackages(packages: string[]): {
  compatible: string[]
  incompatible: Array<{ name: string; reason: string; suggestion?: string }>
} {
  const compat = checkPackageCompatibility(packages)
  return {
    compatible: compat.compatible,
    incompatible: compat.incompatible,
  }
}

/**
 * Extract error information from a Python exception
 */
function extractErrorInfo(error: unknown): {
  errorType: string
  errorMessage: string
  errorLine?: number
  stackTrace?: string
} {
  const errorStr = String(error)

  // Try to extract from PythonError's type property first
  if (error && typeof error === 'object' && 'type' in error) {
    const pyError = error as { type?: string; message?: string }
    if (pyError.type && pyError.type !== 'PythonError') {
      return {
        errorType: pyError.type,
        errorMessage: `${pyError.type}: ${pyError.message || errorStr}`,
        errorLine: errorStr.match(/line (\d+)/i)?.[1] ? parseInt(errorStr.match(/line (\d+)/i)![1], 10) : undefined,
        stackTrace: errorStr,
      }
    }
  }

  // Look for Python error type in the traceback
  // Pattern: "ErrorType: message" or just "ErrorType" at the end of traceback
  const patterns = [
    // Match "ErrorType: message" pattern in traceback
    /(\w+Error|\w+Exception):\s*(.+?)(?:\n|$)/,
    // Match the last error type in a traceback
    /(?:^|\n)(\w+Error|\w+Exception)/gm,
    // Match at the start of the string
    /^(\w+Error|\w+Exception):/m,
  ]

  let errorType = 'Error'
  let errorMessage = errorStr

  for (const pattern of patterns) {
    const match = errorStr.match(pattern)
    if (match && match[1]) {
      // Filter out generic "PythonError"
      if (match[1] !== 'PythonError') {
        errorType = match[1]
        if (match[2]) {
          errorMessage = match[2].trim()
        } else {
          // Extract message after the error type
          const msgMatch = errorStr.match(new RegExp(`${errorType}:\\s*(.+?)(?:\\n|$)`))
          if (msgMatch) {
            errorMessage = msgMatch[1].trim()
          }
        }
        break
      }
    }
  }

  // Extract line number
  const lineMatch = errorStr.match(/line (\d+)/i)
  const errorLine = lineMatch ? parseInt(lineMatch[1], 10) : undefined

  return {
    errorType,
    errorMessage: `${errorType}: ${errorMessage}`,
    errorLine,
    stackTrace: errorStr,
  }
}

/**
 * Recursively convert undefined to null in a JavaScript value
 */
function undefinedToNull(value: unknown): unknown {
  if (value === undefined) {
    return null
  }
  if (Array.isArray(value)) {
    return value.map(undefinedToNull)
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = undefinedToNull(val)
    }
    return result
  }
  return value
}

/**
 * Convert a Python proxy object to a plain JavaScript value
 */
function pyToJs(pyValue: unknown, pyodide: PyodideInterface): unknown {
  if (pyValue === null || pyValue === undefined) {
    return null
  }

  // Check if it's a Pyodide proxy
  if (pyValue && typeof pyValue === 'object' && 'toJs' in pyValue && typeof (pyValue as { toJs: () => unknown }).toJs === 'function') {
    try {
      const jsValue = (pyValue as { toJs: (options?: { dict_converter?: typeof Object.fromEntries }) => unknown }).toJs({ dict_converter: Object.fromEntries })
      // Destroy the proxy to free memory
      if ('destroy' in pyValue && typeof (pyValue as { destroy: () => void }).destroy === 'function') {
        (pyValue as { destroy: () => void }).destroy()
      }
      // Convert any undefined values to null (Python None -> JS null)
      return undefinedToNull(jsValue)
    } catch {
      // If toJs fails, try to get the value directly
      return pyValue
    }
  }

  // Handle Python None -> JavaScript null
  if (pyodide?.isPyProxy?.(pyValue)) {
    const pyProxy = pyValue as { type?: string; toJs?: () => unknown; destroy?: () => void }
    if (pyProxy.type === 'NoneType' || String(pyProxy) === 'None') {
      if (pyProxy.destroy) pyProxy.destroy()
      return null
    }
    const result = pyProxy.toJs?.() ?? null
    if (pyProxy.destroy) pyProxy.destroy()
    return undefinedToNull(result)
  }

  return pyValue
}

// Global Pyodide loader promise to avoid multiple concurrent loads
let pyodideLoaderPromise: Promise<PyodideInterface> | null = null

/**
 * Load Pyodide using dynamic import (for Node.js compatibility)
 *
 * CLI-only: This function is only called in Node.js environments.
 * It is NOT used in the Cloudflare Workers runtime.
 */
async function loadPyodideNode(indexURL?: string): Promise<PyodideInterface> {
  const pyodideModule = await import('pyodide')
  const loadOptions: { indexURL?: string } = {}
  if (indexURL && !indexURL.startsWith('http')) {
    loadOptions.indexURL = indexURL
  }
  return (pyodideModule as any).loadPyodide(loadOptions)
}

/**
 * Load and initialize the Pyodide runtime
 */
export async function loadPyodideRuntime(
  options: PyodideRuntimeOptions = {}
): Promise<PyodideRuntime> {
  const {
    indexURL,
    maxMemoryMB = 128,
    preloadPackages = [],
    preloadModules = [],
  } = options

  // Load Pyodide library
  if (!pyodideLoaderPromise) {
    pyodideLoaderPromise = (async () => {
      // Try to load from globalThis (Workers environment)
      if (typeof globalThis !== 'undefined' && hasLoadPyodide(globalThis)) {
        const loadOptions: { indexURL?: string } = {}
        if (indexURL) loadOptions.indexURL = indexURL
        const g: GlobalWithPyodide = globalThis
        return g.loadPyodide(loadOptions)
      }

      // Check if we're in Node.js environment
      const isNode = typeof process !== 'undefined' &&
                     process.versions?.node !== undefined

      if (isNode) {
        // Use dynamic import for Node.js
        return loadPyodideNode(indexURL)
      }

      // Try dynamic import for bundler environment
      try {
        const pyodideModule = await import('pyodide')
        if (pyodideModule.loadPyodide) {
          // In browser/Workers, pass indexURL if provided
          const loadOptions: { indexURL?: string } = {}
          if (indexURL) {
            loadOptions.indexURL = indexURL
          }
          // The external Pyodide module's loadPyodide returns a structurally compatible interface.
          // We adapt it to our internal PyodideInterface via a helper that encapsulates the cast.
          const loaded = await pyodideModule.loadPyodide(loadOptions)
          return asPyodideInterface(loaded)
        }
      } catch {
        // Fallback: try loading from CDN via fetch
      }

      // For test environment, use a mock or the actual Pyodide
      throw new Error('Pyodide not available in this environment')
    })()
  }

  const pyodide = await pyodideLoaderPromise

  // Initialize memory tracker
  const memoryTracker = new MemoryTracker(pyodide, maxMemoryMB)

  // Load micropip for package installation
  await pyodide.loadPackage('micropip')

  // Preload specified modules
  if (preloadModules.length > 0) {
    const importCode = preloadModules.map((mod) => `import ${mod}`).join('\n')
    try {
      pyodide.runPython(importCode)
    } catch {
      // Ignore import errors for preload modules
    }
  }

  // Preload specified packages
  if (preloadPackages.length > 0) {
    try {
      await pyodide.loadPackage(preloadPackages)
    } catch {
      // Ignore package load errors for preload
    }
  }

  // Create the runtime wrapper
  const runtime: PyodideRuntime = {
    runPython: (code: string) => pyodide.runPython(code),
    runPythonAsync: (code: string) => pyodide.runPythonAsync(code),
    loadPackage: (packages: string | string[]) => pyodide.loadPackage(packages),
    micropip: pyodide.pyimport('micropip'),
    globals: pyodide.globals,
    toPy: (obj: unknown) => pyodide.toPy(obj),
    dispose: async () => {
      // Clean up Python globals
      try {
        pyodide.runPython(`
import gc
gc.collect()
`)
      } catch {
        // Ignore cleanup errors
      }
      // Reset the loader promise to allow reloading
      pyodideLoaderPromise = null
    },
    _pyodide: pyodide,
    _memoryTracker: memoryTracker,
  }

  return runtime
}

/**
 * Execute Python code via Pyodide
 */
export async function executePyodide(
  runtime: PyodideRuntime,
  code: string,
  handlerName: string,
  args: unknown[],
  options: PyodideExecutionOptions = {}
): Promise<PyodideExecutionResult> {
  const startTime = Date.now()
  const {
    packages = [],
    requirementsTxt,
    timeoutMs = 30000,
    memoryLimitMB,
    kwargs = {},
    skipIncompatible = false,
    validateOnly = false,
    isolate = false,
  } = options

  const pyodide = runtime._pyodide
  const memoryTracker = runtime._memoryTracker
  const warnings: string[] = []
  let parseTimeMs = 0
  let executeTimeMs = 0
  let packageInstallTimeMs = 0

  // Set memory limit if specified
  if (memoryLimitMB) {
    memoryTracker.setLimit(memoryLimitMB)
  }

  // Collect all packages to install
  let allPackages = [...packages]
  if (requirementsTxt) {
    const parsedPackages = parseRequirementsTxt(requirementsTxt)
    allPackages = [...allPackages, ...parsedPackages]
  }

  // Check package compatibility
  const packageCompat = checkPackageCompatibility(allPackages)

  // Handle validate-only mode
  if (validateOnly) {
    if (packageCompat.incompatible.length > 0) {
      return {
        success: false,
        incompatiblePackages: packageCompat.incompatible.map((p) => p.name),
        error: `Incompatible packages: ${packageCompat.incompatible.map((p) => p.name).join(', ')}`,
      }
    }
    return { success: true }
  }

  // Handle incompatible packages
  if (packageCompat.incompatible.length > 0) {
    if (!skipIncompatible) {
      // Generate suggestion based on first incompatible package
      const firstIncompat = packageCompat.incompatible[0]
      return {
        success: false,
        error: `Package "${firstIncompat.name}" is not compatible: ${firstIncompat.reason}`,
        incompatiblePackages: packageCompat.incompatible.map((p) => p.name),
        suggestion: firstIncompat.suggestion,
      }
    }

    // Skip incompatible packages and continue
    packageCompat.skipped = packageCompat.incompatible.map((p) => p.name)
    warnings.push(`Skipped incompatible packages: ${packageCompat.skipped.join(', ')}`)
  }

  // Install compatible packages
  if (packageCompat.compatible.length > 0) {
    const pkgStartTime = Date.now()
    try {
      // Try loading from Pyodide built-in packages first
      const builtinPackages: string[] = []
      const pipPackages: string[] = []

      for (const pkg of packageCompat.compatible) {
        const pkgName = pkg.split(/[>=<~!]/)[0].trim()
        // Check if it's a Pyodide built-in
        try {
          await pyodide.loadPackage(pkgName)
          builtinPackages.push(pkgName)
        } catch {
          pipPackages.push(pkg)
        }
      }

      // Install remaining packages via micropip
      if (pipPackages.length > 0) {
        await runtime.micropip.install(pipPackages)
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to install packages: ${String(error)}`,
        warnings,
      }
    }
    packageInstallTimeMs = Date.now() - pkgStartTime
  }

  // Handle empty code
  if (!code || !code.trim()) {
    return {
      success: false,
      error: `Handler "${handlerName}" not found: code is empty`,
    }
  }

  // Create isolated namespace if requested
  // The namespace is used to isolate the Python execution context
  let namespace: unknown = pyodide.globals
  if (isolate) {
    namespace = pyodide.runPython('dict()')
  }

  // Execute the Python code
  const parseStart = Date.now()
  try {
    // Execute the code in the namespace
    if (isolate) {
      pyodide.runPython(code, { globals: namespace })
    } else {
      pyodide.runPython(code)
    }
    parseTimeMs = Date.now() - parseStart
  } catch (error) {
    const errorInfo = extractErrorInfo(error)
    return {
      success: false,
      error: errorInfo.errorMessage,
      errorType: errorInfo.errorType,
      errorLine: errorInfo.errorLine,
      stackTrace: errorInfo.stackTrace,
      warnings,
      metrics: {
        parseTimeMs: Date.now() - parseStart,
        executeTimeMs: 0,
        totalTimeMs: Date.now() - startTime,
        packageInstallTimeMs,
      },
    }
  }

  // Handle special __list_handlers__ request
  if (handlerName === '__list_handlers__') {
    try {
      const listCode = `
[name for name, obj in ${isolate ? 'namespace' : 'globals()'}.items()
 if callable(obj) and not name.startswith('_') and not isinstance(obj, type)]
`
      const handlersProxy = isolate
        ? pyodide.runPython(listCode.replace('namespace', 'globals()'), { globals: namespace })
        : pyodide.runPython(listCode)
      const handlers = pyToJs(handlersProxy, pyodide) as string[]

      return {
        success: true,
        handlers,
        warnings,
        metrics: {
          parseTimeMs,
          executeTimeMs: 0,
          totalTimeMs: Date.now() - startTime,
          packageInstallTimeMs,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to list handlers: ${String(error)}`,
        warnings,
      }
    }
  }

  // Check if the handler exists and is callable
  // We need to verify the handler was defined in the code that was just executed
  // by checking if it's in the namespace after running the code
  try {
    // First, extract names defined in the code (functions, classes, and top-level assignments)
    const findDefinedNamesCode = `
import ast
_defined_names = []
try:
    _tree = ast.parse('''${code.replace(/'/g, "\\'")}''')
    for node in ast.iter_child_nodes(_tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            _defined_names.append(node.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    _defined_names.append(target.id)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            _defined_names.append(node.target.id)
except:
    pass
_defined_names
`
    const definedNamesProxy = pyodide.runPython(findDefinedNamesCode)
    const definedNamesArray = pyToJs(definedNamesProxy, pyodide) as string[] | null
    const definedNames = new Set(definedNamesArray || [])

    // Check if the handler was defined in the provided code
    if (handlerName !== '__list_handlers__' && !definedNames.has(handlerName)) {
      // Handler is not statically defined in the code
      // The only way it should be valid is if it's dynamically created (e.g., exec)
      // AND was created by THIS code execution, not a previous one
      //
      // To detect this properly, we'd need to track state before/after execution
      // For now, we simply require the handler to be in the code AST
      // This is stricter but safer for shared runtime environments
      return {
        success: false,
        error: `Handler "${handlerName}" not found in the provided code`,
        warnings,
      }
    }

    const checkCode = `
_handler_check_result = None
if "${handlerName}" not in ${isolate ? 'globals()' : 'dir()'}:
    _handler_check_result = "not_found"
elif not callable(${handlerName}):
    _handler_check_result = "not_callable"
else:
    _handler_check_result = "ok"
_handler_check_result
`
    const checkResult = isolate
      ? pyodide.runPython(checkCode, { globals: namespace })
      : pyodide.runPython(checkCode)

    if (checkResult === 'not_found') {
      return {
        success: false,
        error: `Handler "${handlerName}" not found in the provided code`,
        warnings,
      }
    }

    if (checkResult === 'not_callable') {
      return {
        success: false,
        error: `Handler "${handlerName}" is not callable (not a function)`,
        warnings,
      }
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to validate handler: ${String(error)}`,
      warnings,
    }
  }

  // Check if handler is async
  let isAsync = false
  try {
    const asyncCheckCode = `
import asyncio
asyncio.iscoroutinefunction(${handlerName})
`
    const asyncResult = isolate
      ? pyodide.runPython(asyncCheckCode, { globals: namespace })
      : pyodide.runPython(asyncCheckCode)
    isAsync = asyncResult === true
  } catch {
    // Assume sync if check fails
  }

  // Prepare arguments - escape for Python string literal
  const escapeForPythonString = (json: string): string => {
    // Escape backslashes first, then single quotes
    return json.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  }
  const argsJson = escapeForPythonString(JSON.stringify(args))
  const kwargsJson = escapeForPythonString(JSON.stringify(kwargs))

  // Create timeout wrapper
  const timeoutPromise = new Promise<PyodideExecutionResult>((resolve) => {
    setTimeout(() => {
      resolve({
        success: false,
        error: 'Execution timed out',
        timedOut: true,
        warnings,
        executionTimeMs: timeoutMs,
        metrics: {
          parseTimeMs,
          executeTimeMs: timeoutMs,
          totalTimeMs: Date.now() - startTime,
          packageInstallTimeMs,
        },
      })
    }, timeoutMs)
  })

  // Execute the handler
  const executeStart = Date.now()
  const executionPromise = (async () => {
    try {
      // Check memory before execution
      if (memoryLimitMB && !memoryTracker.checkLimit()) {
        return {
          success: false,
          error: 'Memory limit exceeded before execution',
          memoryUsedBytes: memoryTracker.getUsedBytes(),
          peakMemoryBytes: memoryTracker.getPeakBytes(),
          warnings,
        }
      }

      // Prepare and execute the handler call
      let result
      if (isAsync) {
        // For async functions, use await directly in runPythonAsync
        const asyncCallCode = `
import json

_args = json.loads('${argsJson}')
_kwargs = json.loads('${kwargsJson}')

async def _async_execute_handler():
    return await ${handlerName}(*_args, **_kwargs)

await _async_execute_handler()
`
        result = await pyodide.runPythonAsync(asyncCallCode)
      } else {
        // For sync functions, use regular execution
        const syncCallCode = `
import json

_args = json.loads('${argsJson}')
_kwargs = json.loads('${kwargsJson}')

def _execute_handler():
    return ${handlerName}(*_args, **_kwargs)

_execute_handler()
`
        result = isolate
          ? pyodide.runPython(syncCallCode, { globals: namespace })
          : pyodide.runPython(syncCallCode)
      }

      executeTimeMs = Date.now() - executeStart

      // Check memory after execution
      memoryTracker.updatePeak()
      if (memoryLimitMB && !memoryTracker.checkLimit()) {
        return {
          success: false,
          error: 'Memory limit exceeded during execution',
          memoryUsedBytes: memoryTracker.getUsedBytes(),
          peakMemoryBytes: memoryTracker.getPeakBytes(),
          warnings,
        }
      }

      // Convert result to JavaScript
      const jsResult = pyToJs(result, pyodide)

      return {
        success: true,
        value: jsResult,
        memoryUsedBytes: memoryTracker.getUsedBytes(),
        peakMemoryBytes: memoryTracker.getPeakBytes(),
        executionTimeMs: executeTimeMs,
        warnings: warnings.length > 0 ? warnings : undefined,
        skippedPackages: packageCompat.skipped.length > 0 ? packageCompat.skipped : undefined,
        metrics: {
          parseTimeMs,
          executeTimeMs,
          totalTimeMs: Date.now() - startTime,
          packageInstallTimeMs: packageInstallTimeMs > 0 ? packageInstallTimeMs : undefined,
        },
      }
    } catch (error) {
      executeTimeMs = Date.now() - executeStart
      const errorInfo = extractErrorInfo(error)

      return {
        success: false,
        error: errorInfo.errorMessage,
        errorType: errorInfo.errorType,
        errorLine: errorInfo.errorLine,
        stackTrace: errorInfo.stackTrace,
        memoryUsedBytes: memoryTracker.getUsedBytes(),
        peakMemoryBytes: memoryTracker.getPeakBytes(),
        executionTimeMs: executeTimeMs,
        warnings: warnings.length > 0 ? warnings : undefined,
        metrics: {
          parseTimeMs,
          executeTimeMs,
          totalTimeMs: Date.now() - startTime,
          packageInstallTimeMs: packageInstallTimeMs > 0 ? packageInstallTimeMs : undefined,
        },
      }
    }
  })()

  // Race between execution and timeout
  return Promise.race([executionPromise, timeoutPromise])
}

/**
 * Create a memory snapshot from the current runtime state
 */
export async function createMemorySnapshot(
  runtime: PyodideRuntime,
  options: {
    modules?: string[]
    packages?: string[]
    initCode?: string
  } = {}
): Promise<MemorySnapshot> {
  const startTime = Date.now()
  const { modules = [], packages = [], initCode } = options
  const pyodide = runtime._pyodide

  // Load requested packages
  if (packages.length > 0) {
    await runtime.micropip.install(packages)
  }

  // Import requested modules
  if (modules.length > 0) {
    const importCode = modules.map((mod) => `import ${mod}`).join('\n')
    pyodide.runPython(importCode)
  }

  // Run initialization code if provided
  if (initCode) {
    await pyodide.runPythonAsync(initCode)
  }

  // Run garbage collection
  pyodide.runPython(`
import gc
gc.collect()
`)

  // For now, create a marker snapshot (actual memory snapshot depends on Pyodide version)
  // In future versions, Pyodide may support actual memory snapshots
  const snapshotMarker = new TextEncoder().encode(
    JSON.stringify({
      modules,
      packages,
      timestamp: Date.now(),
    })
  )

  runtime._snapshot = {
    data: snapshotMarker,
    modules,
    packages,
    createTimeMs: Date.now() - startTime,
    sizeBytes: snapshotMarker.byteLength,
  }

  return runtime._snapshot
}

/**
 * Restore runtime from a memory snapshot
 */
export async function restoreFromSnapshot(
  snapshot: MemorySnapshot,
  options: PyodideRuntimeOptions = {}
): Promise<PyodideRuntime> {
  // Load a fresh runtime
  const runtime = await loadPyodideRuntime({
    ...options,
    preloadModules: snapshot.modules,
    preloadPackages: snapshot.packages,
  })

  runtime._snapshot = snapshot
  return runtime
}

// =============================================================================
// PYODIDE EXECUTOR CLASS
// =============================================================================

/**
 * Options for the PyodideExecutor class
 */
export interface PyodideExecutorOptions extends PyodideRuntimeOptions {
  /** Default timeout in milliseconds for Python execution */
  defaultTimeoutMs?: number
  /** Whether to reuse the runtime between executions */
  reuseRuntime?: boolean
  /** Whether to use native Python support (Cloudflare Workers) */
  useNativePython?: boolean
}

/**
 * Result from PyodideExecutor execution
 */
export interface PyodideExecutorResult<T = unknown> {
  /** Whether the execution was successful */
  success: boolean
  /** The output value (if successful) */
  output?: T
  /** Error message (if failed) */
  error?: string
  /** Python error type (e.g., 'ValueError', 'TypeError') */
  errorType?: string
  /** Line number where error occurred */
  errorLine?: number
  /** Full stack trace */
  stackTrace?: string
  /** Whether execution timed out */
  timedOut?: boolean
  /** Execution time in milliseconds */
  executionTimeMs?: number
  /** Memory used in bytes */
  memoryUsedBytes?: number
  /** Detailed metrics */
  metrics?: ExecutionMetrics
}

/**
 * High-level Pyodide executor for Python code execution.
 *
 * This class provides a convenient interface for executing Python code
 * with proper lifecycle management, error handling, and resource cleanup.
 *
 * In Cloudflare Workers, Python is now natively supported via Pyodide
 * with WASM snapshots for fast cold starts.
 *
 * @example
 * ```typescript
 * const executor = new PyodideExecutor({
 *   reuseRuntime: true,
 *   defaultTimeoutMs: 30000,
 * })
 *
 * await executor.initialize()
 *
 * const result = await executor.execute(
 *   'def handler(x): return x * 2',
 *   'handler',
 *   [21]
 * )
 *
 * console.log(result.output) // 42
 *
 * await executor.dispose()
 * ```
 */
export class PyodideExecutor {
  private runtime: PyodideRuntime | null = null
  private readonly options: PyodideExecutorOptions
  private initialized = false

  constructor(options: PyodideExecutorOptions = {}) {
    this.options = {
      reuseRuntime: true,
      defaultTimeoutMs: 30000,
      ...options,
    }
  }

  /**
   * Initialize the Pyodide runtime.
   * Must be called before executing Python code.
   */
  async initialize(): Promise<void> {
    if (this.initialized && this.runtime) {
      return
    }

    this.runtime = await loadPyodideRuntime({
      maxMemoryMB: this.options.maxMemoryMB,
      preloadPackages: this.options.preloadPackages,
      preloadModules: this.options.preloadModules,
      indexURL: this.options.indexURL,
    })
    this.initialized = true
  }

  /**
   * Check if the executor is initialized
   */
  isInitialized(): boolean {
    return this.initialized && this.runtime !== null
  }

  /**
   * Execute Python code with a specified handler function.
   *
   * @param code - Python source code containing the handler function
   * @param handlerName - Name of the handler function to call
   * @param args - Arguments to pass to the handler
   * @param options - Execution options (timeout, packages, etc.)
   * @returns Execution result with output or error information
   */
  async execute<T = unknown>(
    code: string,
    handlerName: string,
    args: unknown[] = [],
    options: PyodideExecutionOptions = {}
  ): Promise<PyodideExecutorResult<T>> {
    const startTime = Date.now()

    try {
      // Initialize runtime if needed
      if (!this.runtime) {
        await this.initialize()
      }

      if (!this.runtime) {
        return {
          success: false,
          error: 'Failed to initialize Pyodide runtime',
          errorType: 'RuntimeError',
        }
      }

      // Execute the code
      const result = await executePyodide(this.runtime, code, handlerName, args, {
        ...options,
        timeoutMs: options.timeoutMs ?? this.options.defaultTimeoutMs,
      })

      const executionTimeMs = Date.now() - startTime

      if (result.success) {
        return {
          success: true,
          output: result.output as T,
          executionTimeMs,
          memoryUsedBytes: result.memoryUsedBytes,
          metrics: result.metrics,
        }
      }

      return {
        success: false,
        error: result.error,
        errorType: result.errorType,
        errorLine: result.errorLine,
        stackTrace: result.stackTrace,
        timedOut: result.timedOut,
        executionTimeMs,
        memoryUsedBytes: result.memoryUsedBytes,
        metrics: result.metrics,
      }
    } catch (error) {
      const executionTimeMs = Date.now() - startTime
      const message = error instanceof Error ? error.message : String(error)

      return {
        success: false,
        error: message,
        errorType: error instanceof Error ? error.name : 'Error',
        executionTimeMs,
      }
    } finally {
      // Clean up runtime if not reusing
      if (!this.options.reuseRuntime && this.runtime) {
        await this.runtime.dispose()
        this.runtime = null
        this.initialized = false
      }
    }
  }

  /**
   * Execute Python code and return just the result (throws on error).
   *
   * @param code - Python source code
   * @param handlerName - Handler function name
   * @param args - Arguments for the handler
   * @param options - Execution options
   * @returns The handler's return value
   * @throws Error if execution fails
   */
  async run<T = unknown>(
    code: string,
    handlerName: string,
    args: unknown[] = [],
    options: PyodideExecutionOptions = {}
  ): Promise<T> {
    const result = await this.execute<T>(code, handlerName, args, options)

    if (!result.success) {
      const error = new Error(result.error || 'Python execution failed')
      error.name = result.errorType || 'PythonError'
      throw error
    }

    return result.output as T
  }

  /**
   * Install Python packages.
   *
   * @param packages - Package names to install
   */
  async installPackages(packages: string[]): Promise<void> {
    if (!this.runtime) {
      await this.initialize()
    }

    if (this.runtime) {
      await this.runtime.micropip.install(packages)
    }
  }

  /**
   * List handler functions in Python code.
   *
   * @param code - Python source code
   * @returns Array of function names that could be handlers
   */
  async listHandlers(code: string): Promise<string[]> {
    if (!this.runtime) {
      await this.initialize()
    }

    if (!this.runtime) {
      return []
    }

    // Execute code to define functions, then list them
    const listCode = `
${code}

# Get all function names defined in the code
import types
[name for name, obj in locals().items()
 if isinstance(obj, types.FunctionType) and not name.startswith('_')]
`

    try {
      const result = await executePyodide(this.runtime, listCode, '__builtins__', [], {
        timeoutMs: 5000,
      })

      if (result.success && Array.isArray(result.output)) {
        return result.output as string[]
      }
    } catch {
      // Ignore errors, return empty list
    }

    return []
  }

  /**
   * Create a memory snapshot for faster cold starts.
   *
   * @returns Memory snapshot that can be used to restore state
   */
  async createSnapshot(): Promise<MemorySnapshot> {
    if (!this.runtime) {
      await this.initialize()
    }

    if (!this.runtime) {
      throw new Error('Runtime not initialized')
    }

    return createMemorySnapshot(this.runtime)
  }

  /**
   * Dispose of the executor and free resources.
   */
  async dispose(): Promise<void> {
    if (this.runtime) {
      await this.runtime.dispose()
      this.runtime = null
      this.initialized = false
    }
  }

  /**
   * Get the underlying Pyodide runtime (for advanced use cases).
   */
  getRuntime(): PyodideRuntime | null {
    return this.runtime
  }
}
