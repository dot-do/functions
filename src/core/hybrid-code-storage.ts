import type { CodeStorage } from './function-loader'
import { R2CodeStorage, type R2CodeStorageOptions } from './r2-code-storage'
import { KVCodeStorage, type CodeWithFallback, type PaginationOptions, type PaginatedVersions, type CompiledCodeResult, type KVCodeStorageOptions } from './code-storage'

/**
 * Migration status for a function's code
 */
export interface MigrationStatus {
  functionId: string
  version?: string | undefined
  migratedAt?: string | undefined
  source: 'kv' | 'r2'
  status: 'pending' | 'migrated' | 'failed'
  error?: string | undefined
}

/**
 * Migration progress report
 */
export interface MigrationProgress {
  total: number
  migrated: number
  failed: number
  pending: number
  errors: Array<{ functionId: string; version?: string | undefined; error: string }>
}

/**
 * Options for the hybrid storage
 */
export interface HybridStorageOptions {
  /**
   * Whether to write to R2 on new puts (default: true)
   * When false, new code is written to KV only (legacy mode)
   */
  writeToR2?: boolean

  /**
   * Whether to prefer R2 for reads (default: true)
   * When true, checks R2 first, falls back to KV
   * When false, checks KV first, falls back to R2
   */
  preferR2?: boolean

  /**
   * Whether to automatically migrate on read (default: false)
   * When true, code read from KV is automatically copied to R2
   */
  autoMigrate?: boolean

  /**
   * Compression options for R2 storage
   */
  r2Options?: R2CodeStorageOptions | undefined

  /**
   * Compression options for KV storage
   */
  kvOptions?: KVCodeStorageOptions | undefined
}

/**
 * Hybrid code storage that uses both KV and R2.
 *
 * This allows for a gradual migration from KV to R2:
 * - Reads check R2 first, then fall back to KV
 * - Writes go to R2 by default
 * - Migration utilities to move existing code from KV to R2
 *
 * After migration is complete, the KV storage can be deprecated
 * and removed in favor of R2-only storage.
 */
export class HybridCodeStorage implements CodeStorage {
  private r2Storage: R2CodeStorage
  private kvStorage: KVCodeStorage
  private options: Required<HybridStorageOptions>

  constructor(
    r2Bucket: R2Bucket,
    kvNamespace: KVNamespace,
    options: HybridStorageOptions = {}
  ) {
    this.r2Storage = new R2CodeStorage(r2Bucket, options.r2Options)
    this.kvStorage = new KVCodeStorage(kvNamespace, options.kvOptions)
    this.options = {
      writeToR2: options.writeToR2 ?? true,
      preferR2: options.preferR2 ?? true,
      autoMigrate: options.autoMigrate ?? false,
      r2Options: options.r2Options,
      kvOptions: options.kvOptions,
    }
  }

  /**
   * Get code, checking R2 first then KV.
   */
  async get(functionId: string, version?: string): Promise<string | null> {
    if (this.options.preferR2) {
      // Try R2 first
      const r2Code = await this.r2Storage.get(functionId, version)
      if (r2Code !== null) {
        return r2Code
      }

      // Fall back to KV
      const kvCode = await this.kvStorage.get(functionId, version)

      // Auto-migrate if enabled
      if (kvCode !== null && this.options.autoMigrate) {
        await this.r2Storage.put(functionId, kvCode, version)
      }

      return kvCode
    } else {
      // Try KV first (legacy mode)
      const kvCode = await this.kvStorage.get(functionId, version)
      if (kvCode !== null) {
        return kvCode
      }

      // Fall back to R2
      return this.r2Storage.get(functionId, version)
    }
  }

  /**
   * Store code. Writes to R2 by default, can optionally write to both.
   */
  async put(functionId: string, code: string, version?: string): Promise<void> {
    if (this.options.writeToR2) {
      await this.r2Storage.put(functionId, code, version)
    } else {
      await this.kvStorage.put(functionId, code, version)
    }
  }

  /**
   * Delete code from both storages.
   */
  async delete(functionId: string, version?: string): Promise<void> {
    await Promise.all([
      this.r2Storage.delete(functionId, version),
      this.kvStorage.delete(functionId, version),
    ])
  }

  /**
   * List versions from both storages, deduplicated.
   */
  async listVersions(functionId: string): Promise<string[]> {
    const [r2Versions, kvVersions] = await Promise.all([
      this.r2Storage.listVersions(functionId),
      this.kvStorage.listVersions(functionId),
    ])

    // Deduplicate
    const allVersions = new Set([...r2Versions, ...kvVersions])
    return Array.from(allVersions)
  }

  /**
   * Delete all versions from both storages.
   */
  async deleteAll(functionId: string): Promise<void> {
    await Promise.all([
      this.r2Storage.deleteAll(functionId),
      this.kvStorage.deleteAll(functionId),
    ])
  }

  // ============ Source Map Methods ============

  async putSourceMap(functionId: string, sourceMap: string, version?: string): Promise<void> {
    if (this.options.writeToR2) {
      await this.r2Storage.putSourceMap(functionId, sourceMap, version)
    } else {
      await this.kvStorage.putSourceMap(functionId, sourceMap, version)
    }
  }

  async getSourceMap(functionId: string, version?: string): Promise<string | null> {
    if (this.options.preferR2) {
      const r2Map = await this.r2Storage.getSourceMap(functionId, version)
      if (r2Map !== null) {
        return r2Map
      }
      return this.kvStorage.getSourceMap(functionId, version)
    } else {
      const kvMap = await this.kvStorage.getSourceMap(functionId, version)
      if (kvMap !== null) {
        return kvMap
      }
      return this.r2Storage.getSourceMap(functionId, version)
    }
  }

  async deleteWithSourceMap(functionId: string, version?: string): Promise<void> {
    await Promise.all([
      this.r2Storage.deleteWithSourceMap(functionId, version),
      this.kvStorage.deleteWithSourceMap(functionId, version),
    ])
  }

  // ============ Compiled Code Methods ============

  /**
   * Get pre-compiled JavaScript for a function.
   * Checks R2 first, then falls back to KV.
   */
  async getCompiled(functionId: string, version?: string): Promise<string | null> {
    if (this.options.preferR2) {
      // R2 doesn't have separate compiled storage - code is the compiled version
      const r2Code = await this.r2Storage.get(functionId, version ? `${version}:compiled` : undefined)
      if (r2Code !== null) {
        return r2Code
      }
      return this.kvStorage.getCompiled(functionId, version)
    } else {
      const kvCode = await this.kvStorage.getCompiled(functionId, version)
      if (kvCode !== null) {
        return kvCode
      }
      return this.r2Storage.get(functionId, version ? `${version}:compiled` : undefined)
    }
  }

  /**
   * Store pre-compiled JavaScript for a function.
   */
  async putCompiled(functionId: string, code: string, version?: string): Promise<void> {
    if (this.options.writeToR2) {
      await this.r2Storage.put(functionId, code, version ? `${version}:compiled` : undefined)
    } else {
      await this.kvStorage.putCompiled(functionId, code, version)
    }
  }

  /**
   * Get compiled JavaScript if available, falling back to original source.
   */
  async getCompiledOrSource(
    functionId: string,
    version?: string
  ): Promise<CompiledCodeResult | null> {
    if (this.options.preferR2) {
      // Try R2 first for compiled code
      const r2Result = await this.tryGetCompiledOrSourceFromR2(functionId, version)
      if (r2Result !== null) {
        return r2Result
      }
      // Fall back to KV
      return this.kvStorage.getCompiledOrSource(functionId, version)
    } else {
      // Try KV first
      const kvResult = await this.kvStorage.getCompiledOrSource(functionId, version)
      if (kvResult !== null) {
        return kvResult
      }
      // Fall back to R2
      return this.tryGetCompiledOrSourceFromR2(functionId, version)
    }
  }

  /**
   * Helper to get compiled or source from R2
   */
  private async tryGetCompiledOrSourceFromR2(
    functionId: string,
    version?: string
  ): Promise<CompiledCodeResult | null> {
    // Try compiled version first
    const compiled = await this.r2Storage.get(functionId, version ? `${version}:compiled` : undefined)
    if (compiled && compiled.trim().length > 0) {
      return {
        code: compiled,
        usedPrecompiled: true,
        version,
      }
    }

    // Fall back to source
    const source = await this.r2Storage.get(functionId, version)
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

  // ============ Version Fallback ============

  async getWithFallback(
    functionId: string,
    version: string,
    fallback: string | string[] = 'latest'
  ): Promise<CodeWithFallback | null> {
    if (this.options.preferR2) {
      const r2Result = await this.r2Storage.getWithFallback(functionId, version, fallback)
      if (r2Result !== null) {
        return r2Result
      }
      return this.kvStorage.getWithFallback(functionId, version, fallback)
    } else {
      const kvResult = await this.kvStorage.getWithFallback(functionId, version, fallback)
      if (kvResult !== null) {
        return kvResult
      }
      return this.r2Storage.getWithFallback(functionId, version, fallback)
    }
  }

  // ============ Version Listing Enhancements ============

  async listVersionsSorted(functionId: string): Promise<string[]> {
    const [r2Versions, kvVersions] = await Promise.all([
      this.r2Storage.listVersionsSorted(functionId),
      this.kvStorage.listVersionsSorted(functionId),
    ])

    // Merge and deduplicate sorted versions
    const allVersions = new Set([...r2Versions, ...kvVersions])
    const result = Array.from(allVersions)

    // Re-sort after merge
    const { compareVersions } = await import('./types')
    result.sort((a, b) => compareVersions(a, b))

    return result
  }

  async listVersionsPaginated(
    functionId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedVersions> {
    // For paginated listing, prefer R2
    return this.r2Storage.listVersionsPaginated(functionId, options)
  }

  // ============ Migration Methods ============

  /**
   * Migrate a single function's code from KV to R2.
   */
  async migrateFunction(functionId: string, version?: string): Promise<MigrationStatus> {
    const status: MigrationStatus = {
      functionId,
      version,
      source: 'kv',
      status: 'pending',
    }

    try {
      // Check if already in R2
      const r2Exists = await this.r2Storage.exists(functionId, version)
      if (r2Exists) {
        status.status = 'migrated'
        status.migratedAt = new Date().toISOString()
        return status
      }

      // Get from KV
      const kvCode = await this.kvStorage.get(functionId, version)
      if (kvCode === null) {
        status.status = 'failed'
        status.error = 'Code not found in KV'
        return status
      }

      // Store in R2
      await this.r2Storage.put(functionId, kvCode, version)

      // Also migrate source map if exists
      const sourceMap = await this.kvStorage.getSourceMap(functionId, version)
      if (sourceMap !== null) {
        await this.r2Storage.putSourceMap(functionId, sourceMap, version)
      }

      status.status = 'migrated'
      status.migratedAt = new Date().toISOString()
    } catch (error) {
      status.status = 'failed'
      status.error = error instanceof Error ? error.message : String(error)
    }

    return status
  }

  /**
   * Migrate all versions of a function from KV to R2.
   */
  async migrateFunctionAllVersions(functionId: string): Promise<MigrationProgress> {
    const progress: MigrationProgress = {
      total: 0,
      migrated: 0,
      failed: 0,
      pending: 0,
      errors: [],
    }

    // Get all versions from KV
    const versions = await this.kvStorage.listVersions(functionId)
    progress.total = versions.length

    for (const version of versions) {
      const versionToMigrate = version === 'latest' ? undefined : version
      const status = await this.migrateFunction(functionId, versionToMigrate)

      if (status.status === 'migrated') {
        progress.migrated++
      } else if (status.status === 'failed') {
        progress.failed++
        progress.errors.push({
          functionId,
          version: versionToMigrate,
          error: status.error || 'Unknown error',
        })
      } else {
        progress.pending++
      }
    }

    return progress
  }

  /**
   * Verify that a function's code matches between KV and R2.
   */
  async verifyMigration(functionId: string, version?: string): Promise<boolean> {
    const [kvCode, r2Code] = await Promise.all([
      this.kvStorage.get(functionId, version),
      this.r2Storage.get(functionId, version),
    ])

    return kvCode === r2Code
  }

  /**
   * Delete migrated code from KV after verification.
   * Only deletes from KV if the code exists in R2.
   */
  async cleanupKV(functionId: string, version?: string): Promise<boolean> {
    // Verify R2 has the code
    const r2Exists = await this.r2Storage.exists(functionId, version)
    if (!r2Exists) {
      return false
    }

    // Delete from KV
    await this.kvStorage.delete(functionId, version)

    // Also cleanup source map
    const r2MapExists = await this.r2Storage.getSourceMap(functionId, version) !== null
    if (r2MapExists) {
      await this.kvStorage.deleteWithSourceMap(functionId, version)
    }

    return true
  }

  /**
   * Get the underlying R2 storage for direct access.
   */
  getR2Storage(): R2CodeStorage {
    return this.r2Storage
  }

  /**
   * Get the underlying KV storage for direct access.
   */
  getKVStorage(): KVCodeStorage {
    return this.kvStorage
  }
}
