/**
 * Python Dependency Parser for Functions.do
 *
 * This module parses requirements.txt and pyproject.toml files
 * to extract Python package dependencies for bundling with Pyodide.
 */

import * as fs from 'fs/promises'
import * as path from 'path'

/**
 * Represents a parsed Python dependency
 */
export interface PythonDependency {
  /**
   * Package name (normalized)
   */
  name: string

  /**
   * Version specifier (e.g., ">=1.0.0", "==2.1.0", "~=3.0")
   */
  versionSpec?: string

  /**
   * Extra features to install (e.g., ["dev", "test"])
   */
  extras?: string[]

  /**
   * Environment markers (e.g., "python_version >= '3.8'")
   */
  markers?: string

  /**
   * Whether this is a dev dependency
   */
  isDev?: boolean
}

/**
 * Result of parsing dependency files
 */
export interface DependencyParseResult {
  /**
   * List of parsed dependencies
   */
  dependencies: PythonDependency[]

  /**
   * Python version constraint if specified
   */
  pythonVersion?: string

  /**
   * Project name if found in pyproject.toml
   */
  projectName?: string

  /**
   * Entry points if defined
   */
  entryPoints?: Record<string, string>

  /**
   * Parsing errors or warnings
   */
  warnings?: string[]
}

/**
 * Normalize a Python package name according to PEP 503
 * (lowercase, replace underscores/dots with hyphens)
 */
export function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/[_.]/g, '-')
}

/**
 * Parse a requirements.txt file content
 *
 * Handles:
 * - Basic package names: `requests`
 * - Version specifiers: `requests>=2.0.0`, `flask==2.0.1`
 * - Extras: `requests[security]`
 * - Environment markers: `pywin32; sys_platform == 'win32'`
 * - Comments: Lines starting with #
 * - Line continuations: Lines ending with \
 * - -r/-c include directives (returns them as warnings)
 * - Editable installs: -e (skipped with warning)
 */
export function parseRequirementsTxt(content: string): DependencyParseResult {
  const dependencies: PythonDependency[] = []
  const warnings: string[] = []

  // Join line continuations
  const normalizedContent = content.replace(/\\\n/g, '')
  const lines = normalizedContent.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    let line = lines[i].trim()

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) {
      continue
    }

    // Handle include directives
    if (line.startsWith('-r ') || line.startsWith('-c ') || line.startsWith('--requirement') || line.startsWith('--constraint')) {
      warnings.push(`Line ${lineNum}: Include directive "${line}" not supported - please inline dependencies`)
      continue
    }

    // Handle editable installs
    if (line.startsWith('-e ') || line.startsWith('--editable')) {
      warnings.push(`Line ${lineNum}: Editable install "${line}" not supported in serverless environment`)
      continue
    }

    // Handle other pip options
    if (line.startsWith('-') || line.startsWith('--')) {
      warnings.push(`Line ${lineNum}: pip option "${line}" ignored`)
      continue
    }

    // Handle URLs (direct downloads)
    if (line.includes('://') || line.startsWith('git+')) {
      warnings.push(`Line ${lineNum}: URL-based dependency "${line}" not supported - use PyPI packages`)
      continue
    }

    // Parse the requirement
    const parsed = parseRequirementLine(line)
    if (parsed) {
      dependencies.push(parsed)
    } else {
      warnings.push(`Line ${lineNum}: Could not parse "${line}"`)
    }
  }

  return {
    dependencies,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

/**
 * Parse a single requirement line
 */
function parseRequirementLine(line: string): PythonDependency | null {
  // Remove inline comments
  const commentIndex = line.indexOf('#')
  if (commentIndex !== -1) {
    line = line.substring(0, commentIndex).trim()
  }

  if (!line) {
    return null
  }

  // Match package name with optional extras, version spec, and markers
  // Pattern: name[extras](version_spec); markers
  const match = line.match(/^([a-zA-Z0-9][-a-zA-Z0-9._]*)(?:\[([^\]]+)\])?\s*([<>=!~].*?)?(?:\s*;\s*(.+))?$/)

  if (!match) {
    return null
  }

  const [, name, extrasStr, versionSpec, markers] = match

  const dependency: PythonDependency = {
    name: normalizePackageName(name),
  }

  if (extrasStr) {
    dependency.extras = extrasStr.split(',').map((e) => e.trim())
  }

  if (versionSpec) {
    dependency.versionSpec = versionSpec.trim()
  }

  if (markers) {
    dependency.markers = markers.trim()
  }

  return dependency
}

/**
 * Parse a pyproject.toml file content
 *
 * Supports both PEP 621 (standard) and Poetry formats
 */
export function parsePyprojectToml(content: string): DependencyParseResult {
  const dependencies: PythonDependency[] = []
  const warnings: string[] = []
  let pythonVersion: string | undefined
  let projectName: string | undefined
  let entryPoints: Record<string, string> | undefined

  try {
    const parsed = parseTomlSimple(content)

    // Extract project name
    projectName = parsed.project?.name || parsed.tool?.poetry?.name

    // Extract Python version constraint
    pythonVersion = parsed.project?.['requires-python'] || parsed.tool?.poetry?.python

    // Parse PEP 621 style dependencies (project.dependencies)
    if (Array.isArray(parsed.project?.dependencies)) {
      for (const dep of parsed.project.dependencies) {
        const result = parseRequirementLine(dep)
        if (result) {
          dependencies.push(result)
        }
      }
    }

    // Parse PEP 621 optional dependencies (project.optional-dependencies)
    if (parsed.project?.['optional-dependencies']) {
      for (const [group, deps] of Object.entries(parsed.project['optional-dependencies'])) {
        if (Array.isArray(deps)) {
          for (const dep of deps) {
            const result = parseRequirementLine(dep)
            if (result) {
              result.isDev = group === 'dev' || group === 'test'
              result.extras = [...(result.extras || []), group]
              dependencies.push(result)
            }
          }
        }
      }
    }

    // Parse Poetry style dependencies (tool.poetry.dependencies)
    if (parsed.tool?.poetry?.dependencies) {
      for (const [name, spec] of Object.entries(parsed.tool.poetry.dependencies)) {
        if (name === 'python') {
          if (typeof spec === 'string') {
            pythonVersion = spec
          } else if (typeof spec === 'object' && spec !== null && 'version' in spec) {
            const specObj = spec as { version: unknown }
            if (typeof specObj.version === 'string') {
              pythonVersion = specObj.version
            }
          }
          continue
        }

        const dep = parsePoetryDependency(name, spec)
        if (dep) {
          dependencies.push(dep)
        }
      }
    }

    // Parse Poetry dev dependencies (tool.poetry.dev-dependencies or tool.poetry.group.dev.dependencies)
    const devDeps =
      parsed.tool?.poetry?.['dev-dependencies'] || parsed.tool?.poetry?.group?.dev?.dependencies

    if (devDeps) {
      for (const [name, spec] of Object.entries(devDeps)) {
        const dep = parsePoetryDependency(name, spec)
        if (dep) {
          dep.isDev = true
          dependencies.push(dep)
        }
      }
    }

    // Parse entry points (PEP 621: project.scripts, project.gui-scripts, project.entry-points)
    if (parsed.project?.scripts || parsed.project?.['gui-scripts'] || parsed.project?.['entry-points']) {
      entryPoints = {
        ...(parsed.project.scripts || {}),
        ...(parsed.project['gui-scripts'] || {}),
      }

      // Flatten entry-points groups
      if (parsed.project['entry-points']) {
        for (const group of Object.values(parsed.project['entry-points'])) {
          if (typeof group === 'object' && group !== null) {
            Object.assign(entryPoints, group)
          }
        }
      }
    }

    // Parse Poetry entry points
    if (parsed.tool?.poetry?.scripts) {
      entryPoints = { ...entryPoints, ...parsed.tool.poetry.scripts }
    }
  } catch (error) {
    warnings.push(`Failed to parse pyproject.toml: ${error instanceof Error ? error.message : String(error)}`)
  }

  return {
    dependencies,
    pythonVersion,
    projectName,
    entryPoints,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

/**
 * Parse a Poetry-style dependency specification
 */
function parsePoetryDependency(name: string, spec: unknown): PythonDependency | null {
  const dep: PythonDependency = {
    name: normalizePackageName(name),
  }

  if (typeof spec === 'string') {
    // Simple version string: "^1.0.0" or ">=2.0,<3.0"
    dep.versionSpec = convertPoetryVersionSpec(spec)
  } else if (typeof spec === 'object' && spec !== null) {
    const specObj = spec as Record<string, unknown>

    if (typeof specObj['version'] === 'string') {
      dep.versionSpec = convertPoetryVersionSpec(specObj['version'])
    }

    if (Array.isArray(specObj['extras'])) {
      dep.extras = specObj['extras'].filter((e): e is string => typeof e === 'string')
    }

    if (typeof specObj['markers'] === 'string') {
      dep.markers = specObj['markers']
    }

    if (typeof specObj['python'] === 'string') {
      dep.markers = dep.markers ? `${dep.markers} and ${specObj['python']}` : `python_version ${specObj['python']}`
    }

    // Skip git, path, and url dependencies
    if (specObj['git'] || specObj['path'] || specObj['url']) {
      return null
    }
  }

  return dep
}

/**
 * Convert Poetry version specifiers to PEP 440 format
 */
function convertPoetryVersionSpec(spec: string): string {
  // Handle caret (^) - compatible release
  if (spec.startsWith('^')) {
    const version = spec.slice(1)
    const parts = version.split('.')
    if (parts.length >= 1) {
      const major = parseInt(parts[0], 10)
      if (major === 0 && parts.length >= 2) {
        // ^0.x means >=0.x.0,<0.(x+1).0
        const minor = parseInt(parts[1], 10)
        return `>=${version},<0.${minor + 1}.0`
      }
      // ^x means >=x.0.0,<(x+1).0.0
      return `>=${version},<${major + 1}.0.0`
    }
  }

  // Handle tilde (~) - approximately equivalent
  if (spec.startsWith('~')) {
    return `~=${spec.slice(1)}`
  }

  // Handle wildcard (*)
  if (spec === '*') {
    return ''
  }

  return spec
}

/**
 * Type for TOML values - can be primitives, arrays, or nested objects
 */
type TomlValue = string | number | boolean | TomlValue[] | TomlObject

/**
 * Type for parsed TOML object structure
 */
interface TomlObject {
  [key: string]: TomlValue | undefined
}

/**
 * Interface for pyproject.toml structure (PEP 621 and Poetry)
 * This is a more specific type layered on top of TomlObject for type-safe access
 */
interface PyprojectToml {
  project?: {
    name?: string
    'requires-python'?: string
    dependencies?: string[]
    'optional-dependencies'?: Record<string, string[]>
    scripts?: Record<string, string>
    'gui-scripts'?: Record<string, string>
    'entry-points'?: Record<string, Record<string, string>>
  }
  tool?: {
    poetry?: {
      name?: string
      python?: string
      dependencies?: Record<string, unknown>
      'dev-dependencies'?: Record<string, unknown>
      group?: {
        dev?: {
          dependencies?: Record<string, unknown>
        }
      }
      scripts?: Record<string, string>
    }
  }
  // Allow additional TOML keys
  [key: string]: unknown
}

/**
 * Simple TOML parser for basic pyproject.toml files
 * This handles the subset of TOML needed for dependency parsing
 * Returns a PyprojectToml which is a more specific type for pyproject.toml files
 */
function parseTomlSimple(content: string): PyprojectToml {
  const result: PyprojectToml = {}
  let currentSection: string[] = []

  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim()

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) {
      continue
    }

    // Handle section headers [section] or [[array]]
    if (line.startsWith('[')) {
      const sectionMatch = line.match(/^\[+([^\]]+)\]+$/)
      if (sectionMatch) {
        currentSection = sectionMatch[1].split('.').map((s) => s.trim().replace(/"/g, ''))
      }
      continue
    }

    // Handle key = value pairs
    const eqIndex = line.indexOf('=')
    if (eqIndex !== -1) {
      const key = line.substring(0, eqIndex).trim().replace(/"/g, '')
      let value = line.substring(eqIndex + 1).trim()

      // Handle multi-line arrays
      if (value.startsWith('[') && !value.endsWith(']')) {
        const arrayLines = [value]
        while (i + 1 < lines.length && !arrayLines[arrayLines.length - 1].includes(']')) {
          i++
          arrayLines.push(lines[i].trim())
        }
        value = arrayLines.join('')
      }

      // Handle multi-line strings
      if (value.startsWith('"""') || value.startsWith("'''")) {
        const quote = value.substring(0, 3)
        if (!value.endsWith(quote) || value.length === 3) {
          const stringLines = [value]
          while (i + 1 < lines.length && !lines[i + 1].includes(quote)) {
            i++
            stringLines.push(lines[i])
          }
          if (i + 1 < lines.length) {
            i++
            stringLines.push(lines[i])
          }
          value = stringLines.join('\n')
        }
      }

      // Parse the value
      const parsedValue = parseTomlValue(value)

      // Set the value in the result object
      setNestedValue(result, [...currentSection, key], parsedValue)
    }
  }

  return result
}

/**
 * Parse a TOML value
 */
function parseTomlValue(value: string): TomlValue {
  value = value.trim()

  // Handle strings
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }

  // Handle multi-line strings
  if (value.startsWith('"""') || value.startsWith("'''")) {
    return value.slice(3, -3)
  }

  // Handle arrays
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    if (!inner) return []

    // Simple array parsing (handles strings and basic values)
    const items: TomlValue[] = []
    let current = ''
    let inString = false
    let stringChar = ''
    let depth = 0

    for (let i = 0; i < inner.length; i++) {
      const char = inner[i]

      if (!inString && (char === '"' || char === "'")) {
        inString = true
        stringChar = char
        current += char
      } else if (inString && char === stringChar && inner[i - 1] !== '\\') {
        inString = false
        current += char
      } else if (!inString && char === '[') {
        depth++
        current += char
      } else if (!inString && char === ']') {
        depth--
        current += char
      } else if (!inString && depth === 0 && char === ',') {
        const trimmed = current.trim()
        if (trimmed) items.push(parseTomlValue(trimmed))
        current = ''
      } else {
        current += char
      }
    }

    const trimmed = current.trim()
    if (trimmed) items.push(parseTomlValue(trimmed))

    return items
  }

  // Handle inline tables
  if (value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1).trim()
    if (!inner) return {}

    const result: TomlObject = {}
    const pairs = inner.split(',')
    for (const pair of pairs) {
      const eqIndex = pair.indexOf('=')
      if (eqIndex !== -1) {
        const k = pair.substring(0, eqIndex).trim().replace(/"/g, '')
        const v = pair.substring(eqIndex + 1).trim()
        result[k] = parseTomlValue(v)
      }
    }
    return result
  }

  // Handle booleans
  if (value === 'true') return true
  if (value === 'false') return false

  // Handle numbers
  if (/^-?\d+$/.test(value)) return parseInt(value, 10)
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value)

  return value
}

/**
 * Set a nested value in an object
 * Works with any object that has string keys
 */
function setNestedValue(obj: Record<string, unknown>, path: string[], value: TomlValue): void {
  let current: Record<string, unknown> = obj
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    if (!(key in current) || current[key] === undefined) {
      current[key] = {}
    }
    const next = current[key]
    // Ensure we're navigating into an object
    if (typeof next === 'object' && next !== null && !Array.isArray(next)) {
      current = next as Record<string, unknown>
    } else {
      // Create new object if current value is not an object
      current[key] = {}
      current = current[key] as Record<string, unknown>
    }
  }
  current[path[path.length - 1]] = value
}

/**
 * Parse dependencies from a directory containing requirements.txt and/or pyproject.toml
 */
export async function parseDependenciesFromDir(dirPath: string): Promise<DependencyParseResult> {
  const dependencies: PythonDependency[] = []
  const warnings: string[] = []
  let pythonVersion: string | undefined
  let projectName: string | undefined
  let entryPoints: Record<string, string> | undefined

  // Try pyproject.toml first (more modern)
  try {
    const pyprojectPath = path.join(dirPath, 'pyproject.toml')
    const content = await fs.readFile(pyprojectPath, 'utf-8')
    const result = parsePyprojectToml(content)

    dependencies.push(...result.dependencies)
    if (result.warnings) warnings.push(...result.warnings)
    pythonVersion = result.pythonVersion
    projectName = result.projectName
    entryPoints = result.entryPoints
  } catch {
    // pyproject.toml not found or not readable
  }

  // Also check requirements.txt
  try {
    const requirementsPath = path.join(dirPath, 'requirements.txt')
    const content = await fs.readFile(requirementsPath, 'utf-8')
    const result = parseRequirementsTxt(content)

    // Merge dependencies, avoiding duplicates
    for (const dep of result.dependencies) {
      const existing = dependencies.find((d) => d.name === dep.name)
      if (!existing) {
        dependencies.push(dep)
      }
    }

    if (result.warnings) warnings.push(...result.warnings)
  } catch {
    // requirements.txt not found or not readable
  }

  return {
    dependencies,
    pythonVersion,
    projectName,
    entryPoints,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

/**
 * Generate a requirements.txt string from parsed dependencies
 */
export function generateRequirementsTxt(dependencies: PythonDependency[], includeDevDeps = false): string {
  const lines: string[] = []

  for (const dep of dependencies) {
    if (dep.isDev && !includeDevDeps) {
      continue
    }

    let line = dep.name

    if (dep.extras && dep.extras.length > 0) {
      line += `[${dep.extras.join(',')}]`
    }

    if (dep.versionSpec) {
      line += dep.versionSpec
    }

    if (dep.markers) {
      line += `; ${dep.markers}`
    }

    lines.push(line)
  }

  return lines.join('\n')
}
