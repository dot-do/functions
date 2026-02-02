import type { FunctionMetadata } from './types'
import { compareVersions } from './types'
import { ValidationError, NotFoundError } from './errors'
import { validateFunctionMetadata } from './validation'

/**
 * KVFunctionRegistry manages function metadata in the FUNCTIONS_REGISTRY
 * KV namespace using the key pattern: registry:{functionId}
 *
 * This is distinct from FunctionRegistry which uses function:{id}
 *
 * Key structure:
 * - registry:{functionId} - Current function metadata
 * - registry:{functionId}:v:{version} - Version-specific metadata snapshot
 */
export class KVFunctionRegistry {
  private kv: KVNamespace

  constructor(kv: KVNamespace) {
    this.kv = kv
  }

  /**
   * Store function metadata with the key registry:{functionId}
   */
  async put(metadata: FunctionMetadata): Promise<void> {
    if (!metadata.id) {
      throw new ValidationError('Function ID is required', { field: 'id' })
    }

    const key = `registry:${metadata.id}`
    const now = new Date().toISOString()

    // Check if function already exists to preserve createdAt
    const existing = await this.get(metadata.id)
    const createdAt = existing?.createdAt ?? metadata.createdAt ?? now

    const fullMetadata: FunctionMetadata = {
      ...metadata,
      createdAt,
      updatedAt: now,
    }

    await this.kv.put(key, JSON.stringify(fullMetadata))
  }

  /**
   * Retrieve function metadata by functionId
   */
  async get(functionId: string): Promise<FunctionMetadata | null> {
    if (!functionId) {
      throw new ValidationError('Function ID is required', { field: 'id' })
    }

    const key = `registry:${functionId}`
    const result = await this.kv.get(key, 'json')
    if (result === null) return null
    return validateFunctionMetadata(result)
  }

  /**
   * List all functions with optional pagination
   */
  async list(options?: { cursor?: string; limit?: number }): Promise<{
    functions: FunctionMetadata[]
    cursor?: string
    hasMore: boolean
  }> {
    const limit = options?.limit
    // Parse cursor as numeric offset (0 if not provided)
    const offset = options?.cursor ? parseInt(options.cursor, 10) : 0

    // Collect all main function keys (excluding version entries)
    const allMainKeys: KVNamespaceListKey<unknown, string>[] = []
    let kvCursor: string | undefined

    // Paginate through all KV entries to get complete list of main function keys
    do {
      const listOptions: KVNamespaceListOptions = { prefix: 'registry:' }
      if (kvCursor) {
        listOptions.cursor = kvCursor
      }

      const listResult = await this.kv.list(listOptions)

      // Filter out version entries (registry:{id}:v:{version})
      const mainKeys = listResult.keys.filter((key) => !key.name.includes(':v:'))
      allMainKeys.push(...mainKeys)

      if (!listResult.list_complete) {
        kvCursor = (listResult as { cursor: string }).cursor
      } else {
        kvCursor = undefined
      }
    } while (kvCursor)

    // Apply offset and limit
    const startIndex = offset
    const endIndex = limit ? startIndex + limit : allMainKeys.length
    const keysToFetch = allMainKeys.slice(startIndex, endIndex)
    const hasMore = endIndex < allMainKeys.length

    // Fetch metadata for each key
    const functions: FunctionMetadata[] = []
    for (const key of keysToFetch) {
      const metadata = await this.kv.get(key.name, 'json')
      if (metadata) {
        functions.push(validateFunctionMetadata(metadata))
      }
    }

    // Calculate cursor for next page
    let cursor: string | undefined
    if (hasMore) {
      cursor = String(endIndex)
    }

    return {
      functions,
      cursor,
      hasMore,
    }
  }

  /**
   * Update function metadata (partial update)
   */
  async update(
    functionId: string,
    updates: Partial<Omit<FunctionMetadata, 'id' | 'createdAt'>>
  ): Promise<FunctionMetadata> {
    const existing = await this.get(functionId)
    if (!existing) {
      throw new NotFoundError('Function', functionId)
    }

    const now = new Date().toISOString()
    const updatedMetadata: FunctionMetadata = {
      ...existing,
      ...updates,
      id: existing.id, // Ensure ID cannot be changed
      createdAt: existing.createdAt, // Ensure createdAt is preserved
      updatedAt: now,
    }

    const key = `registry:${functionId}`
    await this.kv.put(key, JSON.stringify(updatedMetadata))

    return updatedMetadata
  }

  /**
   * Delete function metadata
   */
  async delete(functionId: string): Promise<void> {
    const key = `registry:${functionId}`

    // Also delete all version entries
    const versions = await this.listVersions(functionId)
    for (const version of versions) {
      await this.deleteVersion(functionId, version)
    }

    await this.kv.delete(key)
  }

  /**
   * Store a specific version of function metadata
   */
  async putVersion(functionId: string, version: string, metadata: FunctionMetadata): Promise<void> {
    const key = `registry:${functionId}:v:${version}`
    await this.kv.put(key, JSON.stringify(metadata))
  }

  /**
   * Get a specific version of function metadata
   */
  async getVersion(functionId: string, version: string): Promise<FunctionMetadata | null> {
    const key = `registry:${functionId}:v:${version}`
    const result = await this.kv.get(key, 'json')
    if (result === null) return null
    return validateFunctionMetadata(result)
  }

  /**
   * List all versions of a function
   */
  async listVersions(functionId: string): Promise<string[]> {
    const prefix = `registry:${functionId}:v:`
    const listResult = await this.kv.list({ prefix })

    const versions: string[] = []
    for (const key of listResult.keys) {
      // Extract version from key: registry:{functionId}:v:{version}
      const version = key.name.substring(prefix.length)
      if (version) {
        versions.push(version)
      }
    }

    // Sort versions descending (newest first)
    versions.sort((a, b) => compareVersions(b, a))

    return versions
  }

  /**
   * Delete a specific version
   */
  async deleteVersion(functionId: string, version: string): Promise<void> {
    const key = `registry:${functionId}:v:${version}`
    await this.kv.delete(key)
  }
}
