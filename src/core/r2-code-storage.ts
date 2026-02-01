import type { CodeStorage } from './function-loader'
import { validateFunctionId } from './function-registry'
import { compareVersions } from './types'
import type { CodeWithFallback, PaginationOptions, PaginatedVersions } from './code-storage'

/**
 * Metadata stored with R2 objects for code storage
 */
interface CodeObjectMetadata {
  functionId: string
  version?: string
  contentType: 'code' | 'source-map'
  createdAt: string
  sizeBytes: number
}

/**
 * R2-backed implementation of the CodeStorage interface.
 * Stores and retrieves function code from Cloudflare R2.
 *
 * R2 is better suited for larger code files than KV:
 * - R2: 5GB max object size, no read/write limits
 * - KV: 25MB max value size, eventual consistency
 *
 * Key format:
 * - code/{functionId}/latest - Latest version of function code
 * - code/{functionId}/v/{version} - Specific version of function code
 * - code/{functionId}/latest.map - Source map for latest
 * - code/{functionId}/v/{version}.map - Source map for specific version
 */
export class R2CodeStorage implements CodeStorage {
  constructor(private bucket: R2Bucket) {}

  /**
   * Build the R2 object key for a function's code.
   */
  private buildKey(functionId: string, version?: string, isSourceMap = false): string {
    const suffix = isSourceMap ? '.map' : ''
    if (version) {
      return `code/${functionId}/v/${version}${suffix}`
    }
    return `code/${functionId}/latest${suffix}`
  }

  /**
   * Get the code for a function, optionally for a specific version.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version to retrieve
   * @returns The function code or null if not found
   * @throws Error if the function ID format is invalid
   */
  async get(functionId: string, version?: string): Promise<string | null> {
    validateFunctionId(functionId)
    const key = this.buildKey(functionId, version)

    const object = await this.bucket.get(key)
    if (!object) {
      return null
    }

    return object.text()
  }

  /**
   * Store code for a function, optionally for a specific version.
   *
   * @param functionId - The unique function identifier
   * @param code - The function code to store
   * @param version - Optional version to store
   * @throws Error if the function ID format is invalid
   */
  async put(functionId: string, code: string, version?: string): Promise<void> {
    validateFunctionId(functionId)
    const key = this.buildKey(functionId, version)

    const metadata: CodeObjectMetadata = {
      functionId,
      contentType: 'code',
      createdAt: new Date().toISOString(),
      sizeBytes: new TextEncoder().encode(code).length,
    }

    if (version) {
      metadata.version = version
    }

    await this.bucket.put(key, code, {
      customMetadata: metadata as unknown as Record<string, string>,
    })
  }

  /**
   * Delete code for a function, optionally for a specific version.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version to delete
   * @throws Error if the function ID format is invalid
   */
  async delete(functionId: string, version?: string): Promise<void> {
    validateFunctionId(functionId)
    const key = this.buildKey(functionId, version)
    await this.bucket.delete(key)
  }

  /**
   * List all stored code entries for a function.
   * Returns an array of version strings (or 'latest' for unversioned entries).
   *
   * @param functionId - The unique function identifier
   * @returns Array of version strings
   * @throws Error if the function ID format is invalid
   */
  async listVersions(functionId: string): Promise<string[]> {
    validateFunctionId(functionId)
    const prefix = `code/${functionId}/`

    const listed = await this.bucket.list({ prefix })
    const versions: string[] = []

    for (const object of listed.objects) {
      // Skip source maps
      if (object.key.endsWith('.map')) {
        continue
      }

      if (object.key === `code/${functionId}/latest`) {
        versions.push('latest')
      } else if (object.key.startsWith(`code/${functionId}/v/`)) {
        const version = object.key.slice(`code/${functionId}/v/`.length)
        // Skip if it's a source map (shouldn't happen after the .map check, but be safe)
        if (!version.endsWith('.map')) {
          versions.push(version)
        }
      }
    }

    return versions
  }

  /**
   * Delete all code entries for a function (all versions).
   *
   * @param functionId - The unique function identifier
   * @throws Error if the function ID format is invalid
   */
  async deleteAll(functionId: string): Promise<void> {
    validateFunctionId(functionId)
    const prefix = `code/${functionId}/`

    // List all objects with this prefix
    const listed = await this.bucket.list({ prefix })

    // Delete all objects
    const keys = listed.objects.map((obj) => obj.key)
    if (keys.length > 0) {
      // R2 supports batch delete
      await this.bucket.delete(keys)
    }
  }

  // ============ Source Map Methods ============

  /**
   * Store a source map for a function.
   *
   * @param functionId - The unique function identifier
   * @param sourceMap - The source map content
   * @param version - Optional version for version-specific source maps
   */
  async putSourceMap(functionId: string, sourceMap: string, version?: string): Promise<void> {
    validateFunctionId(functionId)
    const key = this.buildKey(functionId, version, true)

    const metadata: CodeObjectMetadata = {
      functionId,
      contentType: 'source-map',
      createdAt: new Date().toISOString(),
      sizeBytes: new TextEncoder().encode(sourceMap).length,
    }

    if (version) {
      metadata.version = version
    }

    await this.bucket.put(key, sourceMap, {
      customMetadata: metadata as unknown as Record<string, string>,
    })
  }

  /**
   * Retrieve a source map for a function.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version for version-specific source maps
   * @returns The source map or null if not found
   */
  async getSourceMap(functionId: string, version?: string): Promise<string | null> {
    validateFunctionId(functionId)
    const key = this.buildKey(functionId, version, true)

    const object = await this.bucket.get(key)
    if (!object) {
      return null
    }

    return object.text()
  }

  /**
   * Delete code and its associated source map.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version for version-specific deletion
   */
  async deleteWithSourceMap(functionId: string, version?: string): Promise<void> {
    validateFunctionId(functionId)
    const codeKey = this.buildKey(functionId, version)
    const mapKey = this.buildKey(functionId, version, true)

    await this.bucket.delete([codeKey, mapKey])
  }

  // ============ Version Fallback ============

  /**
   * Get code with fallback to alternative versions if requested version not found.
   *
   * @param functionId - The unique function identifier
   * @param version - The preferred version
   * @param fallback - Fallback version or array of fallback versions to try
   * @returns Code with version info and fallback status, or null if nothing found
   */
  async getWithFallback(
    functionId: string,
    version: string,
    fallback: string | string[] = 'latest'
  ): Promise<CodeWithFallback | null> {
    validateFunctionId(functionId)

    // Try the requested version first
    const code = await this.get(functionId, version)
    if (code !== null) {
      return {
        code,
        version,
        fallback: false,
      }
    }

    // Try fallback versions
    const fallbacks = Array.isArray(fallback) ? fallback : [fallback]

    for (const fallbackVersion of fallbacks) {
      const fallbackCode =
        fallbackVersion === 'latest'
          ? await this.get(functionId)
          : await this.get(functionId, fallbackVersion)

      if (fallbackCode !== null) {
        return {
          code: fallbackCode,
          version: fallbackVersion,
          fallback: true,
        }
      }
    }

    return null
  }

  // ============ Version Listing Enhancements ============

  /**
   * List all versions sorted by semantic version order.
   *
   * @param functionId - The unique function identifier
   * @returns Array of version strings sorted in ascending semver order
   */
  async listVersionsSorted(functionId: string): Promise<string[]> {
    const versions = await this.listVersions(functionId)

    // Filter out 'latest' for sorting, then sort semantically
    const semanticVersions = versions.filter((v) => v !== 'latest')
    semanticVersions.sort((a, b) => compareVersions(a, b))

    return semanticVersions
  }

  /**
   * List versions with pagination support.
   *
   * @param functionId - The unique function identifier
   * @param options - Pagination options (limit, cursor)
   * @returns Paginated version list with cursor for next page
   */
  async listVersionsPaginated(
    functionId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedVersions> {
    validateFunctionId(functionId)
    const { limit = 20, cursor } = options

    const prefix = `code/${functionId}/v/`
    const listOptions: R2ListOptions = {
      prefix,
      limit: limit + 1, // Fetch one extra to detect if there are more
    }

    if (cursor) {
      listOptions.cursor = cursor
    }

    const listed = await this.bucket.list(listOptions)

    const versions: string[] = []
    for (const object of listed.objects) {
      // Skip source maps
      if (object.key.endsWith('.map')) {
        continue
      }

      const version = object.key.slice(prefix.length)
      versions.push(version)
    }

    // Check if there are more results
    const hasMore = versions.length > limit || !listed.truncated === false
    const returnVersions = versions.slice(0, limit)

    const result: PaginatedVersions = {
      versions: returnVersions,
      hasMore: hasMore && returnVersions.length === limit,
    }

    if (listed.truncated && listed.cursor) {
      result.cursor = listed.cursor
    }

    return result
  }

  // ============ Binary Code Support ============

  /**
   * Store binary code (e.g., WASM) for a function.
   *
   * @param functionId - The unique function identifier
   * @param data - The binary data to store
   * @param version - Optional version to store
   */
  async putBinary(functionId: string, data: ArrayBuffer | Uint8Array, version?: string): Promise<void> {
    validateFunctionId(functionId)
    const key = this.buildKey(functionId, version)

    const metadata: CodeObjectMetadata = {
      functionId,
      contentType: 'code',
      createdAt: new Date().toISOString(),
      sizeBytes: data.byteLength,
    }

    if (version) {
      metadata.version = version
    }

    await this.bucket.put(key, data, {
      customMetadata: metadata as unknown as Record<string, string>,
    })
  }

  /**
   * Get binary code (e.g., WASM) for a function.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version to retrieve
   * @returns The binary data or null if not found
   */
  async getBinary(functionId: string, version?: string): Promise<ArrayBuffer | null> {
    validateFunctionId(functionId)
    const key = this.buildKey(functionId, version)

    const object = await this.bucket.get(key)
    if (!object) {
      return null
    }

    return object.arrayBuffer()
  }

  // ============ Metadata Access ============

  /**
   * Get metadata for stored code without fetching the code itself.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version to check
   * @returns Object metadata or null if not found
   */
  async getMetadata(functionId: string, version?: string): Promise<CodeObjectMetadata | null> {
    validateFunctionId(functionId)
    const key = this.buildKey(functionId, version)

    const head = await this.bucket.head(key)
    if (!head) {
      return null
    }

    return head.customMetadata as unknown as CodeObjectMetadata
  }

  /**
   * Check if code exists for a function.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version to check
   * @returns True if code exists, false otherwise
   */
  async exists(functionId: string, version?: string): Promise<boolean> {
    validateFunctionId(functionId)
    const key = this.buildKey(functionId, version)

    const head = await this.bucket.head(key)
    return head !== null
  }
}
