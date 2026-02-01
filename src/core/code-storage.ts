import type { CodeStorage } from './function-loader'
import { validateFunctionId } from './function-registry'
import { compareVersions } from './types'

/**
 * Result from getWithFallback method
 */
export interface CodeWithFallback {
  code: string
  version: string
  fallback: boolean
}

/**
 * Pagination options for listing versions
 */
export interface PaginationOptions {
  limit?: number
  cursor?: string
}

/**
 * Paginated version list result
 */
export interface PaginatedVersions {
  versions: string[]
  cursor?: string
  hasMore: boolean
}

/**
 * Chunk metadata for large code storage
 */
interface ChunkMetadata {
  chunked: boolean
  totalChunks: number
  totalSize: number
  chunkSize?: number
}

/**
 * KV-backed implementation of the CodeStorage interface.
 * Stores and retrieves function code from Cloudflare Workers KV.
 */
export class KVCodeStorage implements CodeStorage {
  private static readonly CHUNK_SIZE = 25 * 1024 * 1024 // 25MB - KV limit

  constructor(private kv: KVNamespace) {}

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
    const key = version ? `code:${functionId}:v:${version}` : `code:${functionId}`
    return this.kv.get(key, 'text')
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
    const key = version ? `code:${functionId}:v:${version}` : `code:${functionId}`
    await this.kv.put(key, code)
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
    const key = version ? `code:${functionId}:v:${version}` : `code:${functionId}`
    await this.kv.delete(key)
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
    const prefix = `code:${functionId}`
    const result = await this.kv.list({ prefix })

    const versions: string[] = []
    for (const key of result.keys) {
      if (key.name === `code:${functionId}`) {
        versions.push('latest')
      } else if (key.name.startsWith(`code:${functionId}:v:`)) {
        const version = key.name.slice(`code:${functionId}:v:`.length)
        versions.push(version)
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
    const prefix = `code:${functionId}`
    const result = await this.kv.list({ prefix })

    for (const key of result.keys) {
      await this.kv.delete(key.name)
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
    const key = version
      ? `code:${functionId}:v:${version}:map`
      : `code:${functionId}:map`
    await this.kv.put(key, sourceMap)
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
    const key = version
      ? `code:${functionId}:v:${version}:map`
      : `code:${functionId}:map`
    return this.kv.get(key, 'text')
  }

  /**
   * Delete code and its associated source map.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version for version-specific deletion
   */
  async deleteWithSourceMap(functionId: string, version?: string): Promise<void> {
    validateFunctionId(functionId)
    await this.delete(functionId, version)
    const mapKey = version
      ? `code:${functionId}:v:${version}:map`
      : `code:${functionId}:map`
    await this.kv.delete(mapKey)
  }

  // ============ Large Code Handling (Chunking) ============

  /**
   * Store large code that may exceed the KV size limit by chunking.
   *
   * @param functionId - The unique function identifier
   * @param code - The code to store
   * @param version - Optional version
   */
  async putLarge(functionId: string, code: string, version?: string): Promise<void> {
    validateFunctionId(functionId)
    const baseKey = version ? `code:${functionId}:v:${version}` : `code:${functionId}`
    const chunkSize = KVCodeStorage.CHUNK_SIZE

    if (code.length <= chunkSize) {
      // Small enough to store directly
      await this.kv.put(baseKey, code)
      return
    }

    // Calculate number of chunks needed
    const totalChunks = Math.ceil(code.length / chunkSize)

    // Store metadata
    const metadata: ChunkMetadata = {
      chunked: true,
      totalChunks,
      totalSize: code.length,
      chunkSize,
    }
    await this.kv.put(`${baseKey}:meta`, JSON.stringify(metadata))

    // Store each chunk
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize
      const end = Math.min(start + chunkSize, code.length)
      const chunk = code.slice(start, end)
      await this.kv.put(`${baseKey}:chunk:${i}`, chunk)
    }
  }

  /**
   * Retrieve large code that may be stored across multiple chunks.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version
   * @returns The reassembled code or null if not found
   */
  async getLarge(functionId: string, version?: string): Promise<string | null> {
    validateFunctionId(functionId)
    const baseKey = version ? `code:${functionId}:v:${version}` : `code:${functionId}`

    // Check for chunk metadata
    const metadataStr = await this.kv.get(`${baseKey}:meta`, 'text')

    if (!metadataStr) {
      // No chunking, try direct retrieval
      return this.kv.get(baseKey, 'text')
    }

    const metadata = JSON.parse(metadataStr) as ChunkMetadata

    if (!metadata.chunked) {
      return this.kv.get(baseKey, 'text')
    }

    // Reassemble chunks
    const chunks: string[] = []
    for (let i = 0; i < metadata.totalChunks; i++) {
      const chunk = await this.kv.get(`${baseKey}:chunk:${i}`, 'text')
      if (chunk === null) {
        return null // Missing chunk
      }
      chunks.push(chunk)
    }

    return chunks.join('')
  }

  /**
   * Delete large code and all its chunks.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version
   */
  async deleteLarge(functionId: string, version?: string): Promise<void> {
    validateFunctionId(functionId)
    const baseKey = version ? `code:${functionId}:v:${version}` : `code:${functionId}`

    // Check for chunk metadata
    const metadataStr = await this.kv.get(`${baseKey}:meta`, 'text')

    if (metadataStr) {
      const metadata = JSON.parse(metadataStr) as ChunkMetadata

      // Delete all chunks
      for (let i = 0; i < metadata.totalChunks; i++) {
        await this.kv.delete(`${baseKey}:chunk:${i}`)
      }

      // Delete metadata
      await this.kv.delete(`${baseKey}:meta`)
    }

    // Also delete the main key in case there's non-chunked data
    await this.kv.delete(baseKey)
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

    const prefix = `code:${functionId}:v:`
    const listOptions: KVNamespaceListOptions = { prefix, limit: limit + 1 }
    if (cursor) {
      listOptions.cursor = cursor
    }

    const result = await this.kv.list(listOptions)

    const versions: string[] = []
    for (const key of result.keys) {
      // Extract version from key
      const version = key.name.slice(prefix.length)
      // Skip map and chunk keys
      if (!version.includes(':')) {
        versions.push(version)
      }
    }

    // Check if there are more results
    const hasMore = versions.length > limit || !result.list_complete
    const returnVersions = versions.slice(0, limit)

    const paginatedVersions: PaginatedVersions = {
      versions: returnVersions,
      hasMore,
    }
    if (hasMore && !result.list_complete) {
      const cursor = (result as { cursor?: string }).cursor
      if (cursor !== undefined) {
        paginatedVersions.cursor = cursor
      }
    }
    return paginatedVersions
  }
}
