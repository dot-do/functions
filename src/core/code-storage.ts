import type { CodeStorage } from './function-loader'
import { validateFunctionId } from './function-registry'

/**
 * KV-backed implementation of the CodeStorage interface.
 * Stores and retrieves function code from Cloudflare Workers KV.
 */
export class KVCodeStorage implements CodeStorage {
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
}
