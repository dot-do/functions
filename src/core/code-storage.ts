import type { CodeStorage } from './function-loader'
import { validateFunctionId } from './function-registry'
import { compareVersions } from './types'

/**
 * Compression encoding types
 */
type CompressionEncoding = 'gzip' | 'none'

/**
 * Result from getWithFallback method
 */
export interface CodeWithFallback {
  code: string
  version: string
  fallback: boolean
}

/**
 * Result from getWasmBinary method
 */
export interface WasmBinaryResult {
  /** The WASM binary */
  binary: Uint8Array
  /** Version that was retrieved */
  version: string
  /** Exported function names (if stored) */
  exports?: string[] | undefined
}

/**
 * Metadata stored alongside WASM binaries
 */
interface WasmMetadata {
  /** Size in bytes */
  size: number
  /** Exported function names */
  exports?: string[] | undefined
  /** Upload timestamp */
  uploadedAt: string
  /** Original language (rust, go, etc.) */
  language?: string | undefined
}

/**
 * Pagination options for listing versions
 */
export interface PaginationOptions {
  limit?: number | undefined
  cursor?: string | undefined
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
 * Result from getCompiledOrSource method
 */
export interface CompiledCodeResult {
  /** The code (compiled or source) */
  code: string
  /** Whether precompiled code was used */
  usedPrecompiled: boolean
  /** Reason for fallback if precompiled was not used */
  fallbackReason?: 'no_precompiled_code' | 'empty_precompiled_code' | undefined
  /** Version of the code */
  version?: string | undefined
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
 * Compression metadata stored alongside compressed code
 */
interface CompressionMetadata {
  /** Compression encoding used */
  encoding: CompressionEncoding
  /** Original uncompressed size in bytes */
  originalSize: number
  /** Compressed size in bytes */
  compressedSize: number
}

/**
 * Options for KVCodeStorage
 */
export interface KVCodeStorageOptions {
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
 * KV-backed implementation of the CodeStorage interface.
 * Stores and retrieves function code from Cloudflare Workers KV.
 *
 * Features:
 * - Gzip compression for stored code (configurable)
 * - Automatic decompression on retrieval
 * - Backward compatible with uncompressed data
 * - Chunking support for large code files
 */
export class KVCodeStorage implements CodeStorage {
  private static readonly CHUNK_SIZE = 25 * 1024 * 1024 // 25MB - KV limit
  private readonly compressionEnabled: boolean
  private readonly compressionThreshold: number

  constructor(private kv: KVNamespace, options: KVCodeStorageOptions = {}) {
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
  private async decompress(data: ArrayBuffer | ArrayBufferLike, encoding: CompressionEncoding): Promise<string> {
    // Convert to Uint8Array for consistent handling
    const bytes = new Uint8Array(data as ArrayBuffer)

    if (encoding === 'none') {
      const decoder = new TextDecoder()
      return decoder.decode(bytes)
    }

    try {
      // Use DecompressionStream API (available in Cloudflare Workers)
      const stream = new Blob([bytes]).stream()
      const decompressionStream = new DecompressionStream('gzip')
      const decompressedStream = stream.pipeThrough(decompressionStream)
      const decompressedBlob = await new Response(decompressedStream).blob()
      return decompressedBlob.text()
    } catch {
      // If decompression fails, try treating as uncompressed text
      const decoder = new TextDecoder()
      return decoder.decode(bytes)
    }
  }

  /**
   * Detect if data is gzip compressed by checking magic bytes.
   */
  private isGzipCompressed(data: ArrayBuffer | ArrayBufferLike): boolean {
    const bytes = new Uint8Array(data as ArrayBuffer)
    // Gzip magic bytes: 0x1f 0x8b
    return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  }

  /**
   * Convert Uint8Array to base64 string for KV storage.
   */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!)
    }
    return btoa(binary)
  }

  /**
   * Convert base64 string to Uint8Array.
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
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
    const key = version ? `code:${functionId}:v:${version}` : `code:${functionId}`

    // First check for compression metadata
    const metaKey = `${key}:compression`
    const metaStr = await this.kv.get(metaKey, 'text')

    if (metaStr) {
      // Compressed data - stored as base64 in KV
      const meta = JSON.parse(metaStr) as CompressionMetadata
      const base64Data = await this.kv.get(key, 'text')
      if (!base64Data) {
        return null
      }

      const compressedBytes = this.base64ToUint8Array(base64Data)
      return this.decompress(compressedBytes.buffer, meta.encoding)
    }

    // Try to get as text (uncompressed or legacy data)
    const textData = await this.kv.get(key, 'text')
    if (!textData) {
      return null
    }

    // Check if it looks like base64-encoded gzip by attempting to decode and check magic bytes
    // This handles backward compatibility for data stored without metadata
    try {
      // If it starts with H4sI (base64 for gzip magic bytes), try to decompress
      if (textData.startsWith('H4sI')) {
        const bytes = this.base64ToUint8Array(textData)
        if (this.isGzipCompressed(bytes.buffer)) {
          return this.decompress(bytes.buffer, 'gzip')
        }
      }
    } catch {
      // Not compressed, return as-is
    }

    return textData
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
    const key = version ? `code:${functionId}:v:${version}` : `code:${functionId}`

    // Compress the code
    const originalSize = new TextEncoder().encode(code).length
    const { compressed, encoding } = await this.compress(code)

    if (encoding === 'gzip') {
      // Store compressed data as base64 (KV doesn't support binary directly)
      const base64 = this.uint8ArrayToBase64(compressed)
      await this.kv.put(key, base64)

      // Store compression metadata
      const meta: CompressionMetadata = {
        encoding,
        originalSize,
        compressedSize: compressed.length,
      }
      await this.kv.put(`${key}:compression`, JSON.stringify(meta))
    } else {
      // Store uncompressed
      await this.kv.put(key, code)

      // Clean up any existing compression metadata
      await this.kv.delete(`${key}:compression`)
    }
  }

  /**
   * Delete code for a function, optionally for a specific version.
   * Also deletes associated compression metadata.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version to delete
   * @throws Error if the function ID format is invalid
   */
  async delete(functionId: string, version?: string): Promise<void> {
    validateFunctionId(functionId)
    const key = version ? `code:${functionId}:v:${version}` : `code:${functionId}`
    await this.kv.delete(key)
    // Also delete compression metadata
    await this.kv.delete(`${key}:compression`)
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

  // ============ Compiled Code Methods ============

  /**
   * Store pre-compiled JavaScript for a function.
   * Used by the deploy flow to cache esbuild compilation results.
   * Automatically compresses code using gzip if compression is enabled.
   *
   * @param functionId - The unique function identifier
   * @param compiledCode - The compiled JavaScript code
   * @param version - Optional version for version-specific compiled code
   */
  async putCompiled(functionId: string, compiledCode: string, version?: string): Promise<void> {
    validateFunctionId(functionId)
    const key = version
      ? `code:${functionId}:v:${version}:compiled`
      : `code:${functionId}:compiled`

    // Compress the compiled code
    const originalSize = new TextEncoder().encode(compiledCode).length
    const { compressed, encoding } = await this.compress(compiledCode)

    if (encoding === 'gzip') {
      // Store compressed data as base64
      const base64 = this.uint8ArrayToBase64(compressed)
      await this.kv.put(key, base64)

      // Store compression metadata
      const meta: CompressionMetadata = {
        encoding,
        originalSize,
        compressedSize: compressed.length,
      }
      await this.kv.put(`${key}:compression`, JSON.stringify(meta))
    } else {
      // Store uncompressed
      await this.kv.put(key, compiledCode)
      await this.kv.delete(`${key}:compression`)
    }
  }

  /**
   * Retrieve pre-compiled JavaScript for a function.
   * Returns null if no compiled code exists (fallback to original source).
   * Automatically decompresses gzip-compressed code.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version for version-specific compiled code
   * @returns The compiled JavaScript or null if not found
   */
  async getCompiled(functionId: string, version?: string): Promise<string | null> {
    validateFunctionId(functionId)
    const key = version
      ? `code:${functionId}:v:${version}:compiled`
      : `code:${functionId}:compiled`

    // Check for compression metadata
    const metaKey = `${key}:compression`
    const metaStr = await this.kv.get(metaKey, 'text')

    if (metaStr) {
      // Compressed data
      const meta = JSON.parse(metaStr) as CompressionMetadata
      const base64Data = await this.kv.get(key, 'text')
      if (!base64Data) {
        return null
      }

      const compressedBytes = this.base64ToUint8Array(base64Data)
      return this.decompress(compressedBytes.buffer, meta.encoding)
    }

    // Try to get as text (uncompressed or legacy data)
    return this.kv.get(key, 'text')
  }

  /**
   * Delete pre-compiled code for a function.
   * Also deletes associated compression metadata.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version for version-specific deletion
   */
  async deleteCompiled(functionId: string, version?: string): Promise<void> {
    validateFunctionId(functionId)
    const key = version
      ? `code:${functionId}:v:${version}:compiled`
      : `code:${functionId}:compiled`
    await this.kv.delete(key)
    await this.kv.delete(`${key}:compression`)
  }

  /**
   * Get compiled JavaScript if available, falling back to original source.
   * Useful for runtime execution where precompiled code is preferred.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version to retrieve
   * @returns Compiled code result with metadata, or null if not found
   */
  async getCompiledOrSource(
    functionId: string,
    version?: string
  ): Promise<CompiledCodeResult | null> {
    validateFunctionId(functionId)

    // Try compiled version first
    const compiled = await this.getCompiled(functionId, version)
    if (compiled && compiled.trim().length > 0) {
      return {
        code: compiled,
        usedPrecompiled: true,
        version,
      }
    }

    // Fall back to source
    const source = await this.get(functionId, version)
    if (!source) {
      return null
    }

    return {
      code: source,
      usedPrecompiled: false,
      fallbackReason: compiled ? 'empty_precompiled_code' : 'no_precompiled_code',
      version,
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
    const key = version
      ? `code:${functionId}:v:${version}:map`
      : `code:${functionId}:map`

    // Compress the source map
    const originalSize = new TextEncoder().encode(sourceMap).length
    const { compressed, encoding } = await this.compress(sourceMap)

    if (encoding === 'gzip') {
      // Store compressed data as base64
      const base64 = this.uint8ArrayToBase64(compressed)
      await this.kv.put(key, base64)

      // Store compression metadata
      const meta: CompressionMetadata = {
        encoding,
        originalSize,
        compressedSize: compressed.length,
      }
      await this.kv.put(`${key}:compression`, JSON.stringify(meta))
    } else {
      // Store uncompressed
      await this.kv.put(key, sourceMap)
      await this.kv.delete(`${key}:compression`)
    }
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
    const key = version
      ? `code:${functionId}:v:${version}:map`
      : `code:${functionId}:map`

    // Check for compression metadata
    const metaKey = `${key}:compression`
    const metaStr = await this.kv.get(metaKey, 'text')

    if (metaStr) {
      // Compressed data
      const meta = JSON.parse(metaStr) as CompressionMetadata
      const base64Data = await this.kv.get(key, 'text')
      if (!base64Data) {
        return null
      }

      const compressedBytes = this.base64ToUint8Array(base64Data)
      return this.decompress(compressedBytes.buffer, meta.encoding)
    }

    // Try to get as text (uncompressed or legacy data)
    return this.kv.get(key, 'text')
  }

  /**
   * Delete code and its associated source map.
   * Also deletes associated compression metadata.
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
    await this.kv.delete(`${mapKey}:compression`)
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

  // ============ WASM Binary Storage ============

  /**
   * Store a pre-compiled WASM binary for a function.
   *
   * WASM binaries are stored as base64-encoded strings in KV.
   * Metadata (exports, size, timestamp) is stored separately.
   *
   * @param functionId - The unique function identifier
   * @param binary - The WASM binary to store
   * @param version - Optional version for version-specific storage
   * @param options - Additional metadata options
   */
  async putWasmBinary(
    functionId: string,
    binary: Uint8Array,
    version?: string,
    options?: { exports?: string[]; language?: string }
  ): Promise<void> {
    validateFunctionId(functionId)
    const baseKey = version ? `wasm:${functionId}:v:${version}` : `wasm:${functionId}`

    // Store binary as base64
    const base64 = this.uint8ArrayToBase64(binary)
    await this.kv.put(baseKey, base64)

    // Store metadata
    const metadata: WasmMetadata = {
      size: binary.length,
      exports: options?.exports,
      uploadedAt: new Date().toISOString(),
      language: options?.language,
    }
    await this.kv.put(`${baseKey}:meta`, JSON.stringify(metadata))
  }

  /**
   * Retrieve a pre-compiled WASM binary for a function.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version to retrieve
   * @returns The WASM binary with metadata, or null if not found
   */
  async getWasmBinary(functionId: string, version?: string): Promise<WasmBinaryResult | null> {
    validateFunctionId(functionId)
    const baseKey = version ? `wasm:${functionId}:v:${version}` : `wasm:${functionId}`

    // Get binary data
    const base64 = await this.kv.get(baseKey, 'text')
    if (!base64) {
      return null
    }

    // Get metadata
    const metadataStr = await this.kv.get(`${baseKey}:meta`, 'text')
    const metadata = metadataStr ? (JSON.parse(metadataStr) as WasmMetadata) : undefined

    // Decode base64 to Uint8Array
    const binary = this.base64ToUint8Array(base64)

    return {
      binary,
      version: version || 'latest',
      exports: metadata?.exports,
    }
  }

  /**
   * Delete a WASM binary and its metadata.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version to delete
   */
  async deleteWasmBinary(functionId: string, version?: string): Promise<void> {
    validateFunctionId(functionId)
    const baseKey = version ? `wasm:${functionId}:v:${version}` : `wasm:${functionId}`

    await this.kv.delete(baseKey)
    await this.kv.delete(`${baseKey}:meta`)
  }

  /**
   * Check if a WASM binary exists for a function.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version to check
   * @returns true if the binary exists
   */
  async hasWasmBinary(functionId: string, version?: string): Promise<boolean> {
    validateFunctionId(functionId)
    const baseKey = version ? `wasm:${functionId}:v:${version}` : `wasm:${functionId}`
    const data = await this.kv.get(baseKey, 'text')
    return data !== null
  }

  /**
   * List all WASM binary versions for a function.
   *
   * @param functionId - The unique function identifier
   * @returns Array of version strings
   */
  async listWasmVersions(functionId: string): Promise<string[]> {
    validateFunctionId(functionId)
    const prefix = `wasm:${functionId}`
    const result = await this.kv.list({ prefix })

    const versions: string[] = []
    for (const key of result.keys) {
      // Skip metadata keys
      if (key.name.endsWith(':meta')) continue

      if (key.name === `wasm:${functionId}`) {
        versions.push('latest')
      } else if (key.name.startsWith(`wasm:${functionId}:v:`)) {
        const version = key.name.slice(`wasm:${functionId}:v:`.length)
        // Skip any sub-keys
        if (!version.includes(':')) {
          versions.push(version)
        }
      }
    }

    return versions
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

  // ============ Compression Utilities ============

  /**
   * Get compression statistics for stored code.
   *
   * @param functionId - The unique function identifier
   * @param version - Optional version to check
   * @returns Compression stats or null if not found or not compressed
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
    validateFunctionId(functionId)
    const key = version ? `code:${functionId}:v:${version}` : `code:${functionId}`
    const metaKey = `${key}:compression`

    const metaStr = await this.kv.get(metaKey, 'text')
    if (!metaStr) {
      return null
    }

    const meta = JSON.parse(metaStr) as CompressionMetadata

    return {
      originalSize: meta.originalSize,
      compressedSize: meta.compressedSize,
      compressionRatio: meta.originalSize > 0 ? 1 - meta.compressedSize / meta.originalSize : 0,
      encoding: meta.encoding,
    }
  }

  /**
   * Check if compression is enabled for this storage instance.
   */
  isCompressionEnabled(): boolean {
    return this.compressionEnabled
  }
}

// Export types for external use
export type { CompressionEncoding, CompressionMetadata }
