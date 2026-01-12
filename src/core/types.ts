/**
 * Core types for Functions.do Worker Loader
 *
 * These types define the interface for dynamically loaded function workers.
 */

/**
 * WorkerStub represents a loaded function that can be invoked.
 *
 * It provides methods similar to Cloudflare Workers' Fetcher interface,
 * allowing the function to be called via various trigger mechanisms.
 */
export interface WorkerStub {
  /**
   * The unique identifier of the loaded function
   */
  id: string

  /**
   * Handle an HTTP request to the function
   *
   * @param request - The incoming HTTP request
   * @returns A Promise resolving to the function's response
   */
  fetch(request: Request): Promise<Response>

  /**
   * Establish a WebSocket or Durable Object-style connection
   *
   * @param request - The WebSocket upgrade request
   * @returns A Promise resolving to the upgrade response
   */
  connect(request: Request): Promise<Response>

  /**
   * Handle a scheduled/cron trigger
   *
   * @param controller - The scheduled event controller
   * @returns A Promise that resolves when the scheduled handler completes
   */
  scheduled(controller: ScheduledController): Promise<void>

  /**
   * Handle queue messages
   *
   * @param batch - The batch of queue messages to process
   * @returns A Promise that resolves when the queue handler completes
   */
  queue(batch: MessageBatch<unknown>): Promise<void>
}

/**
 * Cache statistics for the Worker Loader
 */
export interface CacheStats {
  /**
   * Number of unique functions currently cached
   */
  size: number

  /**
   * Number of cache hits (requests served from cache)
   */
  hits: number

  /**
   * Number of cache misses (requests that required loading)
   */
  misses: number
}

/**
 * Configuration options for the Worker Loader
 */
export interface WorkerLoaderOptions {
  /**
   * Timeout in milliseconds for loading a function
   * @default 30000
   */
  timeout?: number

  /**
   * Maximum number of functions to cache
   * @default 1000
   */
  maxCacheSize?: number
}

/**
 * Function metadata stored in the registry
 */
export interface FunctionMetadata {
  /**
   * Unique function identifier
   */
  id: string

  /**
   * Semantic version of the function
   */
  version: string

  /**
   * Programming language of the function source
   */
  language: 'typescript' | 'javascript' | 'rust' | 'python' | 'go' | 'zig' | 'assemblyscript' | 'csharp'

  /**
   * Entry point file for the function
   */
  entryPoint: string

  /**
   * Dependencies required by the function
   */
  dependencies: Record<string, string>

  /**
   * Timestamp when the function was first deployed
   */
  createdAt?: string

  /**
   * Timestamp when the function was last updated
   */
  updatedAt?: string
}

/**
 * Parsed semantic version components
 */
export interface SemanticVersion {
  major: number
  minor: number
  patch: number
  prerelease?: string
  build?: string
}

/**
 * Deployment record for version history tracking
 */
export interface DeploymentRecord {
  /**
   * The version that was deployed
   */
  version: string

  /**
   * Timestamp when this deployment occurred
   */
  deployedAt: string

  /**
   * The full metadata snapshot at deployment time
   */
  metadata: FunctionMetadata
}

/**
 * Version history for a function
 */
export interface VersionHistory {
  /**
   * Function identifier
   */
  functionId: string

  /**
   * List of all versions ever deployed (sorted newest first)
   */
  versions: string[]

  /**
   * Full deployment records with timestamps and metadata
   */
  deployments: DeploymentRecord[]
}

/**
 * Parse a semantic version string into components.
 *
 * @param version - The version string (e.g., "1.2.3", "1.0.0-beta.1+build.123")
 * @returns Parsed semantic version or null if invalid
 */
export function parseVersion(version: string): SemanticVersion | null {
  // Semantic version regex: major.minor.patch[-prerelease][+build]
  const regex = /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$/
  const match = version.match(regex)

  if (!match) {
    return null
  }

  const result: SemanticVersion = {
    major: parseInt(match[1]!, 10),
    minor: parseInt(match[2]!, 10),
    patch: parseInt(match[3]!, 10),
  }
  if (match[4] !== undefined) {
    result.prerelease = match[4]
  }
  if (match[5] !== undefined) {
    result.build = match[5]
  }
  return result
}

/**
 * Compare two semantic versions.
 *
 * @param a - First version string
 * @param b - Second version string
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 * @throws Error if either version is invalid
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parsedA = parseVersion(a)
  const parsedB = parseVersion(b)

  if (!parsedA || !parsedB) {
    throw new Error(`Invalid semantic version: ${!parsedA ? a : b}`)
  }

  // Compare major.minor.patch
  if (parsedA.major !== parsedB.major) {
    return parsedA.major > parsedB.major ? 1 : -1
  }
  if (parsedA.minor !== parsedB.minor) {
    return parsedA.minor > parsedB.minor ? 1 : -1
  }
  if (parsedA.patch !== parsedB.patch) {
    return parsedA.patch > parsedB.patch ? 1 : -1
  }

  // Handle prerelease: version without prerelease > version with prerelease
  if (parsedA.prerelease && !parsedB.prerelease) return -1
  if (!parsedA.prerelease && parsedB.prerelease) return 1

  // Compare prerelease identifiers
  if (parsedA.prerelease && parsedB.prerelease) {
    const partsA = parsedA.prerelease.split('.')
    const partsB = parsedB.prerelease.split('.')
    const maxLen = Math.max(partsA.length, partsB.length)

    for (let i = 0; i < maxLen; i++) {
      const partA = partsA[i]
      const partB = partsB[i]

      // Missing parts come before existing parts
      if (partA === undefined) return -1
      if (partB === undefined) return 1

      // Numeric identifiers compared as integers
      const numA = parseInt(partA, 10)
      const numB = parseInt(partB, 10)
      const isNumA = !isNaN(numA) && String(numA) === partA
      const isNumB = !isNaN(numB) && String(numB) === partB

      if (isNumA && isNumB) {
        if (numA !== numB) return numA > numB ? 1 : -1
      } else if (isNumA) {
        // Numeric < alphanumeric
        return -1
      } else if (isNumB) {
        return 1
      } else {
        // Alphanumeric comparison
        const cmp = partA.localeCompare(partB)
        if (cmp !== 0) return cmp > 0 ? 1 : -1
      }
    }
  }

  return 0
}

/**
 * Check if a version string is a valid semantic version.
 *
 * @param version - The version string to validate
 * @returns True if valid semantic version, false otherwise
 */
export function isValidVersion(version: string): boolean {
  return parseVersion(version) !== null
}
