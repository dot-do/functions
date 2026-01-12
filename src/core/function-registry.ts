import type { FunctionMetadata, DeploymentRecord, VersionHistory } from './types'
import { compareVersions, isValidVersion } from './types'
import { ValidationError, NotFoundError, FunctionsDoError } from './errors'

/**
 * Valid programming languages for function metadata
 */
const VALID_LANGUAGES = ['typescript', 'javascript', 'rust', 'python', 'go', 'zig', 'assemblyscript', 'csharp'] as const

/**
 * Semver regex pattern for validating dependency versions
 * Supports ranges like ^1.0.0, ~1.0.0, >=1.0.0, 1.0.0 - 2.0.0, etc.
 */
const SEMVER_RANGE_PATTERN = /^(\^|~|>=?|<=?|=)?(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$|^(\d+)\.(\d+)\.(\d+)\s*-\s*(\d+)\.(\d+)\.(\d+)$|^\*$|^latest$/

/**
 * Validate function ID format.
 * Must be 1-255 characters, alphanumeric with hyphens and underscores, no leading/trailing hyphens or underscores.
 *
 * @param id - The function ID to validate
 * @throws ValidationError if the ID format is invalid
 */
export function validateFunctionId(id: string): void {
  if (!id) {
    throw new ValidationError('Invalid function ID: ID is required', { field: 'id' })
  }

  if (id.length > 255) {
    throw new ValidationError('Invalid function ID: ID must be 255 characters or less', { field: 'id', length: id.length })
  }

  // Single character IDs must be alphanumeric
  if (id.length === 1) {
    if (!/^[a-zA-Z0-9]$/.test(id)) {
      throw new ValidationError('Invalid function ID: must be alphanumeric', { field: 'id', value: id })
    }
    return
  }

  // Multi-character IDs: alphanumeric + hyphens + underscores, no leading/trailing hyphens or underscores
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$/.test(id)) {
    throw new ValidationError('Invalid function ID: must be alphanumeric with hyphens and underscores, no leading/trailing hyphens or underscores', { field: 'id', value: id })
  }
}

/**
 * Validate entry point file path format.
 * Must be a valid file path with a supported extension.
 *
 * @param entryPoint - The entry point path to validate
 * @throws ValidationError if the entry point format is invalid
 */
export function validateEntryPoint(entryPoint: string): void {
  if (!entryPoint) {
    throw new ValidationError('Invalid entry point: entry point is required', { field: 'entryPoint' })
  }

  // Should not start with / (relative paths only) or contain ..
  if (entryPoint.startsWith('/') || entryPoint.includes('..')) {
    throw new ValidationError('Invalid entry point: must be a relative path without parent directory references', { field: 'entryPoint', value: entryPoint })
  }

  // Should not have double slashes
  if (entryPoint.includes('//')) {
    throw new ValidationError('Invalid entry point: path contains invalid double slashes', { field: 'entryPoint', value: entryPoint })
  }

  // Check for valid file path format (basic validation)
  // Should not contain invalid characters and should have a file extension
  if (!/^[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+$/.test(entryPoint)) {
    throw new ValidationError('Invalid entry point: must be a valid file path with extension', { field: 'entryPoint', value: entryPoint })
  }
}

/**
 * Validate programming language is a supported enum value.
 *
 * @param language - The language to validate
 * @throws ValidationError if the language is not supported
 */
export function validateLanguage(language: string): void {
  if (!language) {
    throw new ValidationError('Invalid language: language is required', { field: 'language' })
  }

  if (!VALID_LANGUAGES.includes(language as (typeof VALID_LANGUAGES)[number])) {
    throw new ValidationError(`Invalid language: must be one of ${VALID_LANGUAGES.join(', ')}`, { field: 'language', value: language, allowedValues: [...VALID_LANGUAGES] })
  }
}

/**
 * Validate a semver version range string (for dependencies).
 *
 * @param version - The version string to validate
 * @returns True if valid semver range, false otherwise
 */
function isValidSemverRange(version: string): boolean {
  // Handle common range patterns
  const trimmed = version.trim()

  // Handle * and latest
  if (trimmed === '*' || trimmed === 'latest') {
    return true
  }

  // Handle x-ranges like 1.x, 1.2.x
  if (/^\d+\.x(\.x)?$/.test(trimmed) || /^\d+\.\d+\.x$/.test(trimmed)) {
    return true
  }

  // Handle || operator (split and validate each part)
  if (trimmed.includes('||')) {
    return trimmed.split('||').every((part) => isValidSemverRange(part.trim()))
  }

  // Handle space-separated ranges (AND operator)
  if (trimmed.includes(' ') && !trimmed.includes(' - ')) {
    return trimmed.split(/\s+/).every((part) => isValidSemverRange(part))
  }

  // Handle hyphen ranges like 1.0.0 - 2.0.0
  if (trimmed.includes(' - ')) {
    const parts = trimmed.split(' - ')
    const part0 = parts[0]
    const part1 = parts[1]
    if (parts.length !== 2 || part0 === undefined || part1 === undefined) return false
    return isValidVersion(part0.trim()) && isValidVersion(part1.trim())
  }

  // Handle prefixed versions (^, ~, >=, <=, >, <, =)
  const prefixMatch = trimmed.match(/^(\^|~|>=|<=|>|<|=)?(.+)$/)
  if (prefixMatch) {
    const versionPart = prefixMatch[2]
    if (versionPart === undefined) return false
    return isValidVersion(versionPart)
  }

  return false
}

/**
 * Validate dependencies format.
 * Must be Record<string, string> with valid semver versions.
 *
 * @param dependencies - The dependencies object to validate
 * @throws ValidationError if dependencies format is invalid
 */
export function validateDependencies(dependencies: unknown): void {
  if (dependencies === undefined || dependencies === null) {
    return // Dependencies are optional
  }

  if (typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    throw new ValidationError('Invalid dependencies: must be an object', { field: 'dependencies', type: typeof dependencies })
  }

  const deps = dependencies as Record<string, unknown>

  for (const [name, version] of Object.entries(deps)) {
    // Validate package name (basic npm package name validation)
    if (!name || typeof name !== 'string') {
      throw new ValidationError('Dependency package name must be a non-empty string', { field: 'dependencies', packageName: name })
    }

    // Validate version is a string
    if (typeof version !== 'string') {
      throw new ValidationError(`Invalid dependencies: version for "${name}" must be a string`, { field: 'dependencies', packageName: name, versionType: typeof version })
    }

    // Validate version is valid semver or semver range
    if (!isValidSemverRange(version)) {
      throw new ValidationError(`Invalid dependencies: "${name}" has invalid semver version "${version}"`, { field: 'dependencies', packageName: name, version })
    }
  }
}

/**
 * Validate all function metadata fields.
 *
 * @param metadata - The function metadata to validate
 * @throws Error if any metadata field is invalid
 */
export function validateMetadata(metadata: Omit<FunctionMetadata, 'createdAt' | 'updatedAt'>): void {
  validateFunctionId(metadata.id)
  validateEntryPoint(metadata.entryPoint)
  validateLanguage(metadata.language)
  validateDependencies(metadata.dependencies)
}

/**
 * FunctionRegistry manages the storage and retrieval of function metadata
 * using Cloudflare Workers KV.
 *
 * Key patterns:
 * - `function:{id}` - Current active function metadata
 * - `function:{id}:versions` - Version history and deployment records
 * - `function:{id}:v:{version}` - Snapshot of metadata at specific version
 * - `functions:manifest` - List of all function IDs for optimized listing
 */
export class FunctionRegistry {
  private kv: KVNamespace
  private static readonly MANIFEST_KEY = 'functions:manifest'

  constructor(kv: KVNamespace) {
    this.kv = kv
  }

  /**
   * Get the manifest containing all function IDs.
   * Returns null if no manifest exists (backward compatibility).
   */
  private async getManifest(): Promise<string[] | null> {
    const manifest = await this.kv.get(FunctionRegistry.MANIFEST_KEY, 'json')
    return manifest as string[] | null
  }

  /**
   * Update the manifest with a new function ID.
   * Creates the manifest if it doesn't exist.
   */
  private async addToManifest(functionId: string): Promise<void> {
    const manifest = (await this.getManifest()) ?? []
    if (!manifest.includes(functionId)) {
      manifest.push(functionId)
      await this.kv.put(FunctionRegistry.MANIFEST_KEY, JSON.stringify(manifest))
    }
  }

  /**
   * Remove a function ID from the manifest.
   */
  private async removeFromManifest(functionId: string): Promise<void> {
    const manifest = await this.getManifest()
    if (manifest) {
      const index = manifest.indexOf(functionId)
      if (index !== -1) {
        manifest.splice(index, 1)
        await this.kv.put(FunctionRegistry.MANIFEST_KEY, JSON.stringify(manifest))
      }
    }
  }

  /**
   * Deploy a function by storing its metadata in KV.
   * Automatically adds createdAt/updatedAt timestamps and records version history.
   *
   * @param metadata - The function metadata to store
   * @throws Error if metadata validation fails (id, entryPoint, language, dependencies, or version)
   */
  async deploy(metadata: Omit<FunctionMetadata, 'createdAt' | 'updatedAt'>): Promise<void> {
    // Validate all metadata fields
    validateMetadata(metadata)

    // Validate semantic version
    if (!isValidVersion(metadata.version)) {
      throw new ValidationError(`Invalid semantic version: ${metadata.version}`, { field: 'version', value: metadata.version })
    }

    const key = `function:${metadata.id}`
    const versionKey = `function:${metadata.id}:v:${metadata.version}`
    const historyKey = `function:${metadata.id}:versions`
    const now = new Date().toISOString()

    // Check if function already exists to preserve createdAt
    const existing = await this.get(metadata.id)
    const createdAt = existing?.createdAt ?? now

    const fullMetadata: FunctionMetadata = {
      ...metadata,
      createdAt,
      updatedAt: now,
    }

    // Store current active version
    await this.kv.put(key, JSON.stringify(fullMetadata))

    // Store version snapshot
    await this.kv.put(versionKey, JSON.stringify(fullMetadata))

    // Update version history
    await this.addToVersionHistory(metadata.id, metadata.version, fullMetadata, now, historyKey)

    // Update manifest for optimized listing
    await this.addToManifest(metadata.id)
  }

  /**
   * Add a deployment to the version history.
   */
  private async addToVersionHistory(
    functionId: string,
    version: string,
    metadata: FunctionMetadata,
    deployedAt: string,
    historyKey: string
  ): Promise<void> {
    const history = await this.getVersionHistoryInternal(historyKey, functionId)

    const deploymentRecord: DeploymentRecord = {
      version,
      deployedAt,
      metadata,
    }

    // Add new deployment to the front (newest first)
    history.deployments.unshift(deploymentRecord)

    // Update versions list if this is a new version
    if (!history.versions.includes(version)) {
      history.versions.push(version)
      // Sort versions descending (newest first)
      history.versions.sort((a, b) => compareVersions(b, a))
    }

    await this.kv.put(historyKey, JSON.stringify(history))
  }

  /**
   * Get version history from KV (internal helper).
   */
  private async getVersionHistoryInternal(historyKey: string, functionId: string): Promise<VersionHistory> {
    const existing = await this.kv.get(historyKey, 'json')
    if (existing) {
      return existing as VersionHistory
    }
    return {
      functionId,
      versions: [],
      deployments: [],
    }
  }

  /**
   * Retrieve function metadata by ID.
   *
   * @param functionId - The unique function identifier
   * @returns The function metadata or null if not found
   */
  async get(functionId: string): Promise<FunctionMetadata | null> {
    const key = `function:${functionId}`
    const result = await this.kv.get(key, 'json')
    return result as FunctionMetadata | null
  }

  /**
   * Retrieve function metadata for a specific version.
   *
   * @param functionId - The unique function identifier
   * @param version - The semantic version to retrieve
   * @returns The function metadata at that version or null if not found
   */
  async getVersion(functionId: string, version: string): Promise<FunctionMetadata | null> {
    const versionKey = `function:${functionId}:v:${version}`
    const result = await this.kv.get(versionKey, 'json')
    return result as FunctionMetadata | null
  }

  /**
   * List all versions of a function.
   *
   * @param functionId - The unique function identifier
   * @returns Array of version strings sorted descending (newest first)
   */
  async getVersions(functionId: string): Promise<string[]> {
    const historyKey = `function:${functionId}:versions`
    const history = await this.getVersionHistoryInternal(historyKey, functionId)
    return history.versions
  }

  /**
   * Get the complete deployment history for a function.
   *
   * @param functionId - The unique function identifier
   * @returns Array of deployment records sorted by deployment time (newest first)
   */
  async getDeploymentHistory(functionId: string): Promise<DeploymentRecord[]> {
    const historyKey = `function:${functionId}:versions`
    const history = await this.getVersionHistoryInternal(historyKey, functionId)
    return history.deployments
  }

  /**
   * Rollback a function to a previous version.
   *
   * @param functionId - The unique function identifier
   * @param version - The version to rollback to
   * @returns The restored function metadata
   * @throws NotFoundError if version not found or function doesn't exist
   */
  async rollback(functionId: string, version: string): Promise<FunctionMetadata> {
    const versionMetadata = await this.getVersion(functionId, version)
    if (!versionMetadata) {
      throw new FunctionsDoError(
        `Version ${version} not found for function ${functionId}`,
        'NOT_FOUND',
        { functionId, version }
      )
    }

    const key = `function:${functionId}`
    const historyKey = `function:${functionId}:versions`
    const now = new Date().toISOString()

    // Create new metadata with updated timestamp but restored version data
    const restoredMetadata: FunctionMetadata = {
      ...versionMetadata,
      updatedAt: now,
    }

    // Update current active version
    await this.kv.put(key, JSON.stringify(restoredMetadata))

    // Record this rollback as a new deployment in history
    await this.addToVersionHistory(functionId, version, restoredMetadata, now, historyKey)

    return restoredMetadata
  }

  /**
   * List all deployed functions.
   * Uses manifest-based lookup for efficiency, with fallback to prefix scanning
   * for backward compatibility with data created before manifest was introduced.
   *
   * @returns Array of all function metadata
   */
  async list(): Promise<FunctionMetadata[]> {
    // Try manifest-based approach first (optimized)
    const manifest = await this.getManifest()

    if (manifest !== null) {
      // Fetch all function metadata in parallel using manifest
      const metadataPromises = manifest.map((id) => this.get(id))
      const results = await Promise.all(metadataPromises)
      // Filter out any null results (in case of stale manifest entries)
      return results.filter((metadata): metadata is FunctionMetadata => metadata !== null)
    }

    // Fallback: scan prefix and filter (backward compatibility)
    // This also rebuilds the manifest for future optimized lookups
    const functions: FunctionMetadata[] = []
    const functionIds: string[] = []
    let cursor: string | null = null

    do {
      // Build options without cursor if null (for exactOptionalPropertyTypes)
      const listOptions: KVNamespaceListOptions = { prefix: 'function:' }
      if (cursor !== null) {
        listOptions.cursor = cursor
      }
      const listResult = await this.kv.list(listOptions)

      for (const key of listResult.keys) {
        // Skip version snapshots and history entries
        if (key.name.includes(':v:') || key.name.includes(':versions')) {
          continue
        }
        const metadata = await this.kv.get(key.name, 'json')
        if (metadata) {
          functions.push(metadata as FunctionMetadata)
          // Extract function ID from key (function:{id})
          const id = key.name.substring('function:'.length)
          functionIds.push(id)
        }
      }

      cursor = listResult.list_complete ? null : (listResult as { cursor: string }).cursor
    } while (cursor !== null)

    // Rebuild manifest for future optimized lookups
    if (functionIds.length > 0) {
      await this.kv.put(FunctionRegistry.MANIFEST_KEY, JSON.stringify(functionIds))
    }

    return functions
  }

  /**
   * Delete a function from the registry.
   * Also removes all version history and snapshots.
   *
   * @param functionId - The unique function identifier to delete
   */
  async delete(functionId: string): Promise<void> {
    const key = `function:${functionId}`
    const historyKey = `function:${functionId}:versions`

    // Get all versions to delete their snapshots
    const versions = await this.getVersions(functionId)

    // Delete main function entry
    await this.kv.delete(key)

    // Delete version history
    await this.kv.delete(historyKey)

    // Delete all version snapshots
    for (const version of versions) {
      const versionKey = `function:${functionId}:v:${version}`
      await this.kv.delete(versionKey)
    }

    // Remove from manifest
    await this.removeFromManifest(functionId)
  }
}
