import type { CodeStorage } from './function-loader'
import { validateFunctionId } from './function-registry'
import { compareVersions } from './types'
import type { CodeWithFallback, PaginationOptions, PaginatedVersions } from './code-storage'

/**
 * Compression encoding types
 */
type CompressionEncoding = 'gzip' | 'none'

/**
 * Metadata stored with R2 objects for code storage.
 * This is the typed interface used internally.
 */
interface CodeObjectMetadata {
  functionId: string
  version?: string
  contentType: 'code' | 'source-map'
  createdAt: string
  sizeBytes: number
  /** Original uncompressed size in bytes */
  originalSize?: string
  /** Compression encoding used (gzip or none) */
  encoding?: CompressionEncoding
}

/**
 * R2 customMetadata is always Record<string, string>, so we serialize
 * our typed metadata to/from this format.
 */
type R2CustomMetadata = Record<string, string>

/**
 * Serialize CodeObjectMetadata to R2-compatible string Record.
 * Converts numeric sizeBytes to string for R2 storage.
 */
function serializeMetadata(metadata: CodeObjectMetadata): R2CustomMetadata {
  const result: R2CustomMetadata = {
    functionId: metadata.functionId,
    contentType: metadata.contentType,
    createdAt: metadata.createdAt,
    sizeBytes: String(metadata.sizeBytes),
  }
  if (metadata.version !== undefined) {
    result.version = metadata.version
  }
  if (metadata.originalSize !== undefined) {
    result.originalSize = metadata.originalSize
  }
  if (metadata.encoding !== undefined) {
    result.encoding = metadata.encoding
  }
  return result
}

/**
 * Deserialize R2 customMetadata back to typed CodeObjectMetadata.
 * Returns undefined if the metadata doesn't have required fields.
 */
function deserializeMetadata(raw: R2CustomMetadata | undefined): CodeObjectMetadata | undefined {
  if (!raw || !raw.functionId || !raw.contentType || !raw.createdAt || !raw.sizeBytes) {
    return undefined
  }
  const metadata: CodeObjectMetadata = {
    functionId: raw.functionId,
    contentType: raw.contentType as 'code' | 'source-map',
    createdAt: raw.createdAt,
    sizeBytes: parseInt(raw.sizeBytes, 10),
  }
  if (raw.version !== undefined) {
    metadata.version = raw.version
  }
  if (raw.originalSize !== undefined) {
    metadata.originalSize = raw.originalSize
  }
  if (raw.encoding !== undefined) {
    metadata.encoding = raw.encoding as CompressionEncoding
  }
  return metadata
}

/**
 * Options for R2CodeStorage
 */
export interface R2CodeStorageOptions {
  /**
   * Enable gzip compression for stored code (default: true)
   * When enabled, code is compressed before storage and decompressed on retrieval.
   * This can reduce storage costs by 60-80% for text-based code.
   */
  compression?: boolean

  /**
   * Minimum size in bytes before compression is applied (default: 1024)
   * Code smaller than this threshold is stored uncompressed to avoid
   * compression overhead for small files.
   */
  compressionThreshold?: number
}

/**
 * R2-backed implementation of the CodeStorage interface.
 * Stores and retrieves function code from Cloudflare R2.
 *
 * NOTE: This is an **opt-in** storage backend for use cases that exceed
 * KV's 25 MB value limit or require R2-specific features (e.g., large WASM
 * binaries, bulk data). For most function code storage, use KVCodeStorage
 * instead -- it is the default used by all production code paths.
 *
 * R2 is better suited for larger code files than KV:
 * - R2: 5GB max object size, strong consistency
 * - KV: 25MB max value size, eventual consistency
 *
 * CONSISTENCY NOTE: KV has eventual consistency (reads may lag writes by
 * up to 60 seconds). R2 provides strong read-after-write consistency.
 * If you need immediate read-after-write for small code, consider using
 * UserStorage DO (Durable Object) which provides transactional guarantees.
 *
 * Features:
 * - Gzip compression for stored code (configurable)
 * - Automatic decompression on retrieval
 * - Backward compatible with uncompressed data
 *
 * Key format:
 * - code/{functionId}/latest - Latest version of function code
 * - code/{functionId}/v/{version} - Specific version of function code
 * - code/{functionId}/latest.map - Source map for latest
 * - code/{functionId}/v/{version}.map - Source map for specific version
 *
 * @see KVCodeStorage - The recommended default storage backend
 * @see HybridCodeStorage - For KV-to-R2 migration only (not for general use)
 */
export class R2CodeStorage implements CodeStorage {
  private readonly compressionEnabled: boolean
  private readonly compressionThreshold: number

  constructor(private bucket: R2Bucket, options: R2CodeStorageOptions = {}) {
    this.compressionEnabled = options.compression ?? true
    this.compressionThreshold = options.compressionThreshold ?? 1024
  }

  /**
   * Compress data using gzip via CompressionStream API.
   * Falls back to uncompressed if compression fails.
   */
  private async compress(data: string): Promise<{ compressed: Uint8Array; encoding: CompressionEncoding }> {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(data)

    // Skip compression for small data
    if (!this.compressionEnabled || bytes.length < this.compressionThreshold) {
      return { compressed: bytes, encoding: 'none' }
    }

    try {
      // Use CompressionStream API (available in Cloudflare Workers)
      const stream = new Blob([bytes]).stream()
      const compressionStream = new CompressionStream('gzip')
      const compressedStream = stream.pipeThrough(compressionStream)
      const compressedBlob = await new Response(compressedStream).blob()
      const compressedBytes = new Uint8Array(await compressedBlob.arrayBuffer())

      // Only use compression if it actually reduces size
      if (compressedBytes.length < bytes.length) {
        return { compressed: compressedBytes, encoding: 'gzip' }
      }
      return { compressed: bytes, encoding: 'none' }
    } catch {
      // Fallback to uncompressed if compression fails
      return { compressed: bytes, encoding: 'none' }
    }
  }

  /**
   * Decompress gzip data using DecompressionStream API.
   */
  private async decompress(data: ArrayBuffer, encoding: CompressionEncoding): Promise<string> {
    if (encoding === 'none') {
      const decoder = new TextDecoder()
      return decoder.decode(data)
    }

    try {
      // Use DecompressionStream API (available in Cloudflare Workers)
      const stream = new Blob([data]).stream()
      const decompressionStream = new DecompressionStream('gzip')
      const decompressedStream = stream.pipeThrough(decompressionStream)
      const decompressedBlob = await new Response(decompressedStream).blob()
      return decompressedBlob.text()
    } catch {
      // If decompression fails, try treating as uncompressed text
      const decoder = new TextDecoder()
      return decoder.decode(data)
    }
  }

  /**
   * Detect if data is gzip compressed by checking magic bytes.
   */
  private isGzipCompressed(data: ArrayBuffer): boolean {
    const bytes = new Uint8Array(data)
    // Gzip magic bytes: 0x1f 0x8b
    return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  }

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
   * Automatically decompresses gzip-compressed code.
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

    // Check metadata for encoding information using type-safe deserialization
    const metadata = deserializeMetadata(object.customMetadata)
    const encoding = metadata?.encoding

    // Get the raw data
    const data = await object.arrayBuffer()

    // Determine encoding: use metadata if available, otherwise auto-detect
    let effectiveEncoding: CompressionEncoding = 'none'
    if (encoding) {
      effectiveEncoding = encoding
    } else if (this.isGzipCompressed(data)) {
      // Auto-detect gzip for backward compatibility or missing metadata
      effectiveEncoding = 'gzip'
    }

    return this.decompress(data, effectiveEncoding)
  }

  /**
   * Store code for a function, optionally for a specific version.
   * Automatically compresses code using gzip if compression is enabled.
   *
   * @param functionId - The unique function identifier
   * @param code - The function code to store
   * @param version - Optional version to store
   * @throws Error if the function ID format is invalid
   */
  async put(functionId: string, code: string, version?: string): Promise<void> {
    validateFunctionId(functionId)
    const key = this.buildKey(functionId, version)

    // Compress the code
    const originalSize = new TextEncoder().encode(code).length
    const { compressed, encoding } = await this.compress(code)

    const metadata: CodeObjectMetadata = {
      functionId,
      contentType: 'code',
      createdAt: new Date().toISOString(),
      sizeBytes: compressed.length,
      originalSize: String(originalSize),
      encoding,
    }

    if (version) {
      metadata.version = version
    }

    await this.bucket.put(key, compressed, {
      customMetadata: serializeMetadata(metadata),
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
   * Automatically compresses source maps using gzip if compression is enabled.
   *
   * @param functionId - The unique function identifier
   * @param sourceMap - The source map content
   * @param version - Optional version for version-specific source maps
   */
  async putSourceMap(functionId: string, sourceMap: string, version?: string): Promise<void> {
    validateFunctionId(functionId)
    const key = this.buildKey(functionId, version, true)

    // Compress the source map
    const originalSize = new TextEncoder().encode(sourceMap).length
    const { compressed, encoding } = await this.compress(sourceMap)

    const metadata: CodeObjectMetadata = {
      functionId,
      contentType: 'source-map',
      createdAt: new Date().toISOString(),
      sizeBytes: compressed.length,
      originalSize: String(originalSize),
      encoding,
    }

    if (version) {
      metadata.version = version
    }

    await this.bucket.put(key, compressed, {
      customMetadata: serializeMetadata(metadata),
    })
  }

  /**
   * Retrieve a source map for a function.
   * Automatically decompresses gzip-compressed source maps.
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

    // Check metadata for encoding information using type-safe deserialization
    const metadata = deserializeMetadata(object.customMetadata)
    const encoding = metadata?.encoding

    // Get the raw data
    const data = await object.arrayBuffer()

    // Determine encoding: use metadata if available, otherwise auto-detect
    let effectiveEncoding: CompressionEncoding = 'none'
    if (encoding) {
      effectiveEncoding = encoding
    } else if (this.isGzipCompressed(data)) {
      // Auto-detect gzip for backward compatibility or missing metadata
      effectiveEncoding = 'gzip'
    }

    return this.decompress(data, effectiveEncoding)
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
      customMetadata: serializeMetadata(metadata),
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

    return deserializeMetadata(head.customMetadata) ?? null
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

  // ============ Compression Utilities ============

  /**
   * Get compression statistics for stored code.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version to check
   * @returns Compression stats or null if not found
   */
  async getCompressionStats(
    functionId: string,
    version?: string
  ): Promise<{
    originalSize: number
    compressedSize: number
    compressionRatio: number
    encoding: CompressionEncoding
  } | null> {
    const metadata = await this.getMetadata(functionId, version)
    if (!metadata) {
      return null
    }

    const originalSize = metadata.originalSize ? parseInt(metadata.originalSize, 10) : metadata.sizeBytes
    const compressedSize = metadata.sizeBytes
    const encoding = metadata.encoding ?? 'none'

    return {
      originalSize,
      compressedSize,
      compressionRatio: originalSize > 0 ? 1 - compressedSize / originalSize : 0,
      encoding,
    }
  }

  /**
   * Check if compression is enabled for this storage instance.
   */
  isCompressionEnabled(): boolean {
    return this.compressionEnabled
  }
}

// Export the metadata type for external use
export type { CodeObjectMetadata, CompressionEncoding }
