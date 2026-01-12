/**
 * Memory Snapshot Configuration for Python Functions
 *
 * Enables faster cold starts by pre-loading Python modules and creating
 * memory snapshots that can be restored quickly on function startup.
 *
 * This is particularly useful for Pyodide which has significant startup
 * overhead when loading Python packages.
 */

import type { PythonDependency } from './dependency-parser'
import { isPackageCompatible } from './pyodide-compat'

/**
 * Memory snapshot configuration
 */
export interface SnapshotConfig {
  /**
   * Whether snapshots are enabled
   */
  enabled: boolean

  /**
   * Modules to preload into the snapshot
   */
  preloadModules: string[]

  /**
   * Packages to preinstall (from pypi)
   */
  preinstallPackages: string[]

  /**
   * Global variables to initialize in snapshot
   */
  globals?: Record<string, unknown>

  /**
   * Code to run during snapshot creation
   */
  initCode?: string

  /**
   * Maximum snapshot size in bytes
   */
  maxSize?: number

  /**
   * Snapshot format version
   */
  version?: string
}

/**
 * Result of creating a snapshot
 */
export interface SnapshotResult {
  /**
   * Whether snapshot creation succeeded
   */
  success: boolean

  /**
   * Snapshot data (base64 encoded)
   */
  data?: string

  /**
   * Size of snapshot in bytes
   */
  size?: number

  /**
   * Modules included in snapshot
   */
  loadedModules?: string[]

  /**
   * Time taken to create snapshot in ms
   */
  createTimeMs?: number

  /**
   * Errors during snapshot creation
   */
  errors?: string[]

  /**
   * Warnings about potential issues
   */
  warnings?: string[]
}

/**
 * Default modules that are safe to preload
 */
const DEFAULT_PRELOAD_MODULES = [
  // Standard library essentials
  'json',
  'datetime',
  're',
  'math',
  'collections',
  'itertools',
  'functools',
  'operator',
  'typing',
  'dataclasses',
  'enum',
  'abc',
  'copy',
  'hashlib',
  'base64',
  'urllib.parse',
  'random',
  'string',
  'io',
  'contextlib',
  'decimal',
  'statistics',
]

/**
 * Modules that should NOT be preloaded (have side effects or state)
 */
const UNSAFE_PRELOAD_MODULES = new Set([
  'asyncio', // Event loop state
  'logging', // Logger configuration
  'warnings', // Warning filters
  'sys', // System state
  'os', // Environment state
  'threading', // Thread state
  'multiprocessing', // Process state
  'signal', // Signal handlers
  'atexit', // Exit handlers
  'gc', // Garbage collector state
  'tempfile', // Temp directory state
  'sqlite3', // Database connections
  'socket', // Socket state
])

/**
 * Parse snapshot configuration from pyproject.toml content
 */
export function parseSnapshotConfig(pyprojectContent: string): SnapshotConfig | null {
  // Look for [tool.functions-do.snapshot] section
  const snapshotMatch = pyprojectContent.match(
    /\[tool\.functions-do\.snapshot\]([\s\S]*?)(?=\[|$)/
  )

  if (!snapshotMatch) {
    return null
  }

  const section = snapshotMatch[1]
  const config: SnapshotConfig = {
    enabled: false,
    preloadModules: [],
    preinstallPackages: [],
  }

  // Parse enabled
  const enabledMatch = section.match(/enabled\s*=\s*(true|false)/i)
  if (enabledMatch) {
    config.enabled = enabledMatch[1].toLowerCase() === 'true'
  }

  // Parse preload_modules
  const modulesMatch = section.match(/preload_modules\s*=\s*\[([\s\S]*?)\]/)
  if (modulesMatch) {
    const modules = modulesMatch[1]
      .split(',')
      .map((m) => m.trim().replace(/["']/g, ''))
      .filter((m) => m.length > 0)
    config.preloadModules = modules
  }

  // Parse preinstall_packages
  const packagesMatch = section.match(/preinstall_packages\s*=\s*\[([\s\S]*?)\]/)
  if (packagesMatch) {
    const packages = packagesMatch[1]
      .split(',')
      .map((p) => p.trim().replace(/["']/g, ''))
      .filter((p) => p.length > 0)
    config.preinstallPackages = packages
  }

  // Parse max_size
  const maxSizeMatch = section.match(/max_size\s*=\s*(\d+)/)
  if (maxSizeMatch) {
    config.maxSize = parseInt(maxSizeMatch[1], 10)
  }

  // Parse init_code
  const initCodeMatch = section.match(/init_code\s*=\s*"""([\s\S]*?)"""/)
  if (initCodeMatch) {
    config.initCode = initCodeMatch[1].trim()
  }

  return config
}

/**
 * Generate optimized preload list from dependencies
 */
export function generatePreloadList(
  dependencies: PythonDependency[],
  userPreloads: string[] = []
): { modules: string[]; warnings: string[] } {
  const modules = new Set<string>()
  const warnings: string[] = []

  // Add default preloads
  for (const mod of DEFAULT_PRELOAD_MODULES) {
    modules.add(mod)
  }

  // Add user-specified preloads
  for (const mod of userPreloads) {
    if (UNSAFE_PRELOAD_MODULES.has(mod)) {
      warnings.push(
        `Module "${mod}" may have state/side effects and might not work correctly in a snapshot`
      )
    }
    modules.add(mod)
  }

  // Add compatible dependencies
  for (const dep of dependencies) {
    const compat = isPackageCompatible(dep.name)
    if (compat === 'compatible') {
      modules.add(dep.name)
    } else if (compat === 'unknown') {
      warnings.push(`Package "${dep.name}" compatibility unknown - may not preload correctly`)
      modules.add(dep.name) // Try anyway
    }
    // Skip incompatible packages
  }

  return {
    modules: Array.from(modules).sort(),
    warnings,
  }
}

/**
 * Generate Python code to create a snapshot
 */
export function generateSnapshotInitCode(config: SnapshotConfig): string {
  const lines: string[] = []

  lines.push('# Memory snapshot initialization')
  lines.push('# Auto-generated by functions-do')
  lines.push('')

  // Import all preload modules
  lines.push('# Preload modules')
  for (const mod of config.preloadModules) {
    // Handle submodules
    if (mod.includes('.')) {
      const parts = mod.split('.')
      lines.push(`import ${parts[0]}`)
      lines.push(`from ${parts.slice(0, -1).join('.')} import ${parts[parts.length - 1]}`)
    } else {
      lines.push(`import ${mod}`)
    }
  }
  lines.push('')

  // Install packages if specified
  if (config.preinstallPackages.length > 0) {
    lines.push('# Install packages')
    lines.push('import micropip')
    lines.push('await micropip.install([')
    for (const pkg of config.preinstallPackages) {
      lines.push(`    "${pkg}",`)
    }
    lines.push('])')
    lines.push('')
  }

  // Run custom init code
  if (config.initCode) {
    lines.push('# Custom initialization')
    lines.push(config.initCode)
    lines.push('')
  }

  // Set up globals
  if (config.globals) {
    lines.push('# Initialize globals')
    for (const [name, value] of Object.entries(config.globals)) {
      const jsonValue = JSON.stringify(value)
      lines.push(`${name} = ${jsonValue}`)
    }
    lines.push('')
  }

  // Clean up
  lines.push('# Clean up for snapshot')
  lines.push('import gc')
  lines.push('gc.collect()')
  lines.push('')

  lines.push('# Snapshot ready')
  lines.push('_snapshot_ready = True')

  return lines.join('\n')
}

/**
 * Estimate snapshot size based on modules
 */
export function estimateSnapshotSize(modules: string[]): {
  estimatedBytes: number
  breakdown: Record<string, number>
} {
  // Approximate sizes for common modules (in KB)
  const moduleSizes: Record<string, number> = {
    json: 50,
    datetime: 100,
    re: 200,
    math: 150,
    collections: 100,
    itertools: 50,
    functools: 50,
    typing: 150,
    dataclasses: 80,
    enum: 50,
    hashlib: 100,
    base64: 30,
    random: 100,
    decimal: 200,
    statistics: 80,
    numpy: 5000,
    pandas: 10000,
    scipy: 15000,
    'scikit-learn': 8000,
    pydantic: 1000,
    httpx: 500,
  }

  const breakdown: Record<string, number> = {}
  let total = 0

  // Base Pyodide size (~6MB)
  breakdown['pyodide_base'] = 6000
  total += 6000

  for (const mod of modules) {
    const baseMod = mod.split('.')[0]
    const size = moduleSizes[baseMod] || 100 // Default 100KB for unknown
    breakdown[mod] = size
    total += size
  }

  return {
    estimatedBytes: total * 1024,
    breakdown: Object.fromEntries(
      Object.entries(breakdown).map(([k, v]) => [k, v * 1024])
    ),
  }
}

/**
 * Validate snapshot configuration
 */
export function validateSnapshotConfig(config: SnapshotConfig): {
  valid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  // Check for unsafe preloads
  for (const mod of config.preloadModules) {
    if (UNSAFE_PRELOAD_MODULES.has(mod)) {
      warnings.push(
        `Module "${mod}" has state that may not survive snapshot/restore correctly`
      )
    }
  }

  // Check package compatibility
  for (const pkg of config.preinstallPackages) {
    const compat = isPackageCompatible(pkg)
    if (compat === 'incompatible') {
      errors.push(`Package "${pkg}" is not compatible with Pyodide`)
    } else if (compat === 'unknown') {
      warnings.push(`Package "${pkg}" compatibility is unknown - test thoroughly`)
    }
  }

  // Check estimated size
  const { estimatedBytes } = estimateSnapshotSize([
    ...config.preloadModules,
    ...config.preinstallPackages,
  ])

  const maxSize = config.maxSize || 50 * 1024 * 1024 // Default 50MB
  if (estimatedBytes > maxSize) {
    errors.push(
      `Estimated snapshot size (${Math.round(estimatedBytes / 1024 / 1024)}MB) ` +
        `exceeds maximum (${Math.round(maxSize / 1024 / 1024)}MB)`
    )
  } else if (estimatedBytes > maxSize * 0.8) {
    warnings.push(
      `Estimated snapshot size (${Math.round(estimatedBytes / 1024 / 1024)}MB) ` +
        `is close to maximum - consider reducing preloads`
    )
  }

  // Validate init code
  if (config.initCode) {
    // Check for common issues
    if (config.initCode.includes('open(') && !config.initCode.includes('# fs-ok')) {
      warnings.push('Init code contains file operations which may not work in Workers')
    }
    if (config.initCode.includes('socket')) {
      errors.push('Init code contains socket operations which are not available in Workers')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Generate Wrangler configuration for snapshot
 */
export function generateWranglerSnapshotConfig(config: SnapshotConfig): string {
  if (!config.enabled) {
    return ''
  }

  const lines: string[] = []

  lines.push('# Memory snapshot configuration')
  lines.push('[python.snapshot]')
  lines.push('enabled = true')
  lines.push('')

  if (config.preloadModules.length > 0) {
    lines.push('preload_modules = [')
    for (const mod of config.preloadModules) {
      lines.push(`  "${mod}",`)
    }
    lines.push(']')
    lines.push('')
  }

  if (config.preinstallPackages.length > 0) {
    lines.push('preinstall_packages = [')
    for (const pkg of config.preinstallPackages) {
      lines.push(`  "${pkg}",`)
    }
    lines.push(']')
  }

  return lines.join('\n')
}

/**
 * Create a minimal snapshot configuration
 */
export function createMinimalSnapshotConfig(): SnapshotConfig {
  return {
    enabled: true,
    preloadModules: ['json', 'datetime', 're', 'typing'],
    preinstallPackages: [],
  }
}

/**
 * Create a full snapshot configuration from dependencies
 */
export function createFullSnapshotConfig(
  dependencies: PythonDependency[]
): { config: SnapshotConfig; warnings: string[] } {
  const { modules, warnings } = generatePreloadList(dependencies)

  // Filter to only Pyodide-compatible packages
  const compatiblePackages = dependencies
    .filter((d) => isPackageCompatible(d.name) === 'compatible')
    .map((d) => d.name)

  return {
    config: {
      enabled: true,
      preloadModules: modules,
      preinstallPackages: compatiblePackages,
    },
    warnings,
  }
}
