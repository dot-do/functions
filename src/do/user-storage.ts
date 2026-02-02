/**
 * UserStorage Durable Object - Per-user function storage
 *
 * Replaces KV-based storage (FUNCTIONS_REGISTRY, FUNCTIONS_CODE, FUNCTIONS_API_KEYS)
 * with user-specific Durable Objects that provide:
 * - Strong consistency (no eventual consistency issues)
 * - Transactional operations (atomic updates)
 * - Per-user isolation (data segregation)
 * - SQLite storage for structured queries
 *
 * Each user gets their own DO instance identified by userId.
 * DO stores:
 * - Function metadata (replaces KVFunctionRegistry)
 * - Function code (replaces KVCodeStorage for small code)
 * - API keys (replaces KVApiKeyStore)
 *
 * For large code blobs (>1MB), use R2CodeStorage instead.
 *
 * Uses Workers RPC for direct method invocation instead of HTTP routes.
 * Reference: https://developers.cloudflare.com/durable-objects/api/rpc/
 *
 * @module durable-object/user-storage
 */

import { DurableObject } from 'cloudflare:workers'
import type { FunctionMetadata } from '../core/types'
import { compareVersions } from '../core/types'
import { validateFunctionId } from '../core/function-registry'
import { ValidationError, NotFoundError } from '../core/errors'
import { validateFunctionMetadata } from '../core/validation'

// ============================================================================
// TYPES
// ============================================================================

/**
 * API key permissions
 */
export interface ApiKeyPermissions {
  invoke: boolean
  manage: boolean
  admin: boolean
}

/**
 * API key metadata stored in the DO
 */
export interface ApiKeyMetadata {
  keyHash: string
  name: string
  permissions: ApiKeyPermissions
  scopes?: string[]
  created: number
  expiresAt?: number
  revokedAt?: number
  revokedReason?: string
  rotatedAt?: number
  lastModified?: number
  lastUsed?: number
  usageCount?: number
  rateLimit?: {
    maxRequests: number
    windowMs: number
  }
}

/**
 * Code storage entry
 */
export interface CodeEntry {
  functionId: string
  version: string | null
  code: string
  compiledCode?: string
  sourceMap?: string
  createdAt: number
  updatedAt: number
}

/**
 * Result from list operations
 */
export interface ListResult<T> {
  items: T[]
  cursor?: string
  hasMore: boolean
}

// ============================================================================
// SQL ROW TYPES
// ============================================================================

// SQL row types must use SqlStorageValue (string | number | null | ArrayBuffer)
// Note: SqlStorageCursor is globally available from @cloudflare/workers-types
type SqlStorageValue = string | number | null | ArrayBuffer

interface FunctionRow extends Record<string, SqlStorageValue> {
  id: string
  version: string
  type: string | null
  name: string | null
  description: string | null
  tags: string | null
  language: string | null
  entry_point: string | null
  dependencies: string | null
  metadata_json: string
  created_at: number
  updated_at: number
}

interface CodeRow extends Record<string, SqlStorageValue> {
  function_id: string
  version: string | null
  code: string
  compiled_code: string | null
  source_map: string | null
  created_at: number
  updated_at: number
}

interface ApiKeyRow extends Record<string, SqlStorageValue> {
  key_hash: string
  name: string
  permissions: string
  scopes: string | null
  rate_limit: string | null
  created: number
  expires_at: number | null
  revoked_at: number | null
  revoked_reason: string | null
  rotated_at: number | null
  last_modified: number | null
  last_used: number | null
  usage_count: number
}

interface VersionRow extends Record<string, SqlStorageValue> {
  version: string
}

// ============================================================================
// USER STORAGE DURABLE OBJECT
// ============================================================================

/**
 * Environment bindings for UserStorage
 */
interface Env {
  // Add any required bindings here
}

/**
 * UserStorage Durable Object
 *
 * Provides per-user storage for functions, code, and API keys.
 * Uses SQLite for structured data with strong consistency guarantees.
 *
 * Extends DurableObject for Workers RPC support - all public methods
 * are callable directly via the stub without HTTP routing.
 */
export class UserStorage extends DurableObject<Env> {
  private schemaInitialized = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Safely get a single row from a SQL result, returning null if not found.
   * Unlike .one(), this doesn't throw on empty results.
   */
  private oneOrNull<T extends Record<string, SqlStorageValue>>(
    cursor: SqlStorageCursor<T>
  ): T | null {
    const rows = cursor.toArray()
    return rows.length > 0 ? (rows[0] ?? null) : null
  }

  // ===========================================================================
  // SCHEMA INITIALIZATION
  // ===========================================================================

  /**
   * Initialize SQLite schema for all storage tables
   */
  private initializeSchema(): void {
    if (this.schemaInitialized) return

    // Functions table (metadata)
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS functions (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        type TEXT,
        name TEXT,
        description TEXT,
        tags TEXT,
        language TEXT,
        entry_point TEXT,
        dependencies TEXT,
        metadata_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // Function versions table (version history)
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS function_versions (
        id TEXT NOT NULL,
        version TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (id, version)
      )
    `)

    // Code table
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS code (
        function_id TEXT NOT NULL,
        version TEXT,
        code TEXT NOT NULL,
        compiled_code TEXT,
        source_map TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (function_id, version)
      )
    `)

    // API keys table
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        key_hash TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        permissions TEXT NOT NULL,
        scopes TEXT,
        rate_limit TEXT,
        created INTEGER NOT NULL,
        expires_at INTEGER,
        revoked_at INTEGER,
        revoked_reason TEXT,
        rotated_at INTEGER,
        last_modified INTEGER,
        last_used INTEGER,
        usage_count INTEGER DEFAULT 0
      )
    `)

    // Rate limit tracking table
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key_hash TEXT PRIMARY KEY,
        request_count INTEGER NOT NULL,
        window_start INTEGER NOT NULL
      )
    `)

    // Indexes
    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_functions_type ON functions (type)
    `)
    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_functions_updated ON functions (updated_at)
    `)
    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_code_function ON code (function_id)
    `)

    this.schemaInitialized = true
  }

  // ===========================================================================
  // FUNCTION REGISTRY OPERATIONS
  // ===========================================================================

  /**
   * Store function metadata
   */
  async putFunction(metadata: FunctionMetadata): Promise<void> {
    this.initializeSchema()

    if (!metadata.id) {
      throw new ValidationError('Function ID is required', { field: 'id' })
    }

    const now = Date.now()
    const existing = await this.getFunction(metadata.id)
    const createdAt = existing?.createdAt ? new Date(existing.createdAt).getTime() : now

    const fullMetadata: FunctionMetadata = {
      ...metadata,
      createdAt: new Date(createdAt).toISOString(),
      updatedAt: new Date(now).toISOString(),
    }

    const metadataJson = JSON.stringify(fullMetadata)
    const tagsJson = metadata.tags ? JSON.stringify(metadata.tags) : null
    const depsJson = metadata.dependencies ? JSON.stringify(metadata.dependencies) : null

    // Upsert the function
    this.ctx.storage.sql.exec(`
      INSERT OR REPLACE INTO functions
      (id, version, type, name, description, tags, language, entry_point, dependencies, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      metadata.id,
      metadata.version,
      metadata.type ?? 'code',
      metadata.name ?? null,
      metadata.description ?? null,
      tagsJson,
      metadata.language ?? null,
      metadata.entryPoint ?? null,
      depsJson,
      metadataJson,
      createdAt,
      now
    )
  }

  /**
   * Get function metadata by ID
   */
  async getFunction(functionId: string): Promise<FunctionMetadata | null> {
    this.initializeSchema()

    if (!functionId) {
      throw new ValidationError('Function ID is required', { field: 'id' })
    }

    const result = this.oneOrNull(
      this.ctx.storage.sql.exec<FunctionRow>(
        `SELECT * FROM functions WHERE id = ?`,
        functionId
      )
    )

    if (!result) return null

    return validateFunctionMetadata(JSON.parse(result.metadata_json))
  }

  /**
   * List all functions with optional pagination
   */
  async listFunctions(options?: { cursor?: string; limit?: number }): Promise<ListResult<FunctionMetadata>> {
    this.initializeSchema()

    const limit = options?.limit ?? 100
    const offset = options?.cursor ? parseInt(options.cursor, 10) : 0

    const rows = this.ctx.storage.sql.exec<FunctionRow>(
      `SELECT * FROM functions ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      limit + 1,
      offset
    ).toArray()

    const hasMore = rows.length > limit
    const items = rows.slice(0, limit).map(row => validateFunctionMetadata(JSON.parse(row.metadata_json as string)))

    const result: ListResult<FunctionMetadata> = {
      items,
      hasMore,
    }
    if (hasMore) {
      result.cursor = String(offset + limit)
    }
    return result
  }

  /**
   * Update function metadata (partial update)
   */
  async updateFunction(
    functionId: string,
    updates: Partial<Omit<FunctionMetadata, 'id' | 'createdAt'>>
  ): Promise<FunctionMetadata> {
    this.initializeSchema()

    const existing = await this.getFunction(functionId)
    if (!existing) {
      throw new NotFoundError('Function', functionId)
    }

    const updatedMetadata: FunctionMetadata = {
      ...existing,
      ...updates,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    }
    // Preserve createdAt if it exists
    if (existing.createdAt) {
      updatedMetadata.createdAt = existing.createdAt
    }

    await this.putFunction(updatedMetadata)
    return updatedMetadata
  }

  /**
   * Delete function and all its versions/code
   */
  async deleteFunction(functionId: string): Promise<void> {
    this.initializeSchema()

    // Delete versions
    this.ctx.storage.sql.exec(
      `DELETE FROM function_versions WHERE id = ?`,
      functionId
    )

    // Delete code
    this.ctx.storage.sql.exec(
      `DELETE FROM code WHERE function_id = ?`,
      functionId
    )

    // Delete function
    this.ctx.storage.sql.exec(
      `DELETE FROM functions WHERE id = ?`,
      functionId
    )
  }

  /**
   * Store a specific version of function metadata
   */
  async putFunctionVersion(functionId: string, version: string, metadata: FunctionMetadata): Promise<void> {
    this.initializeSchema()

    const metadataJson = JSON.stringify(metadata)
    const now = Date.now()

    this.ctx.storage.sql.exec(`
      INSERT OR REPLACE INTO function_versions (id, version, metadata_json, created_at)
      VALUES (?, ?, ?, ?)
    `,
      functionId,
      version,
      metadataJson,
      now
    )
  }

  /**
   * Get a specific version of function metadata
   */
  async getFunctionVersion(functionId: string, version: string): Promise<FunctionMetadata | null> {
    this.initializeSchema()

    const result = this.oneOrNull(
      this.ctx.storage.sql.exec<{ metadata_json: string }>(
        `SELECT metadata_json FROM function_versions WHERE id = ? AND version = ?`,
        functionId,
        version
      )
    )

    if (!result) return null
    return validateFunctionMetadata(JSON.parse(result.metadata_json))
  }

  /**
   * List all versions of a function
   */
  async listFunctionVersions(functionId: string): Promise<string[]> {
    this.initializeSchema()

    const rows = this.ctx.storage.sql.exec<VersionRow>(
      `SELECT version FROM function_versions WHERE id = ?`,
      functionId
    ).toArray()

    const versions = rows.map(r => r.version)
    versions.sort((a, b) => compareVersions(b, a)) // Newest first

    return versions
  }

  // ===========================================================================
  // CODE STORAGE OPERATIONS
  // ===========================================================================

  /**
   * Store code for a function
   */
  async putCode(functionId: string, code: string, version?: string): Promise<void> {
    this.initializeSchema()
    validateFunctionId(functionId)

    const now = Date.now()
    const versionKey = version ?? null

    this.ctx.storage.sql.exec(`
      INSERT OR REPLACE INTO code (function_id, version, code, compiled_code, source_map, created_at, updated_at)
      VALUES (?, ?, ?, NULL, NULL, COALESCE((SELECT created_at FROM code WHERE function_id = ? AND version IS ?), ?), ?)
    `,
      functionId,
      versionKey,
      code,
      functionId,
      versionKey,
      now,
      now
    )
  }

  /**
   * Get code for a function
   */
  async getCode(functionId: string, version?: string): Promise<string | null> {
    this.initializeSchema()
    validateFunctionId(functionId)

    const versionKey = version ?? null
    const result = this.oneOrNull(
      this.ctx.storage.sql.exec<CodeRow>(
        `SELECT code FROM code WHERE function_id = ? AND version IS ?`,
        functionId,
        versionKey
      )
    )

    return result?.code ?? null
  }

  /**
   * Store compiled code
   */
  async putCompiledCode(functionId: string, compiledCode: string, version?: string): Promise<void> {
    this.initializeSchema()
    validateFunctionId(functionId)

    const versionKey = version ?? null
    const now = Date.now()

    // First ensure the row exists
    const existing = this.oneOrNull(
      this.ctx.storage.sql.exec<CodeRow>(
        `SELECT * FROM code WHERE function_id = ? AND version IS ?`,
        functionId,
        versionKey
      )
    )

    if (existing) {
      this.ctx.storage.sql.exec(`
        UPDATE code SET compiled_code = ?, updated_at = ? WHERE function_id = ? AND version IS ?
      `,
        compiledCode,
        now,
        functionId,
        versionKey
      )
    } else {
      this.ctx.storage.sql.exec(`
        INSERT INTO code (function_id, version, code, compiled_code, source_map, created_at, updated_at)
        VALUES (?, ?, '', ?, NULL, ?, ?)
      `,
        functionId,
        versionKey,
        compiledCode,
        now,
        now
      )
    }
  }

  /**
   * Get compiled code
   */
  async getCompiledCode(functionId: string, version?: string): Promise<string | null> {
    this.initializeSchema()
    validateFunctionId(functionId)

    const versionKey = version ?? null
    const result = this.oneOrNull(
      this.ctx.storage.sql.exec<CodeRow>(
        `SELECT compiled_code FROM code WHERE function_id = ? AND version IS ?`,
        functionId,
        versionKey
      )
    )

    return result?.compiled_code ?? null
  }

  /**
   * Store source map
   */
  async putSourceMap(functionId: string, sourceMap: string, version?: string): Promise<void> {
    this.initializeSchema()
    validateFunctionId(functionId)

    const versionKey = version ?? null
    const now = Date.now()

    const existing = this.oneOrNull(
      this.ctx.storage.sql.exec<CodeRow>(
        `SELECT * FROM code WHERE function_id = ? AND version IS ?`,
        functionId,
        versionKey
      )
    )

    if (existing) {
      this.ctx.storage.sql.exec(`
        UPDATE code SET source_map = ?, updated_at = ? WHERE function_id = ? AND version IS ?
      `,
        sourceMap,
        now,
        functionId,
        versionKey
      )
    } else {
      this.ctx.storage.sql.exec(`
        INSERT INTO code (function_id, version, code, compiled_code, source_map, created_at, updated_at)
        VALUES (?, ?, '', NULL, ?, ?, ?)
      `,
        functionId,
        versionKey,
        sourceMap,
        now,
        now
      )
    }
  }

  /**
   * Get source map
   */
  async getSourceMap(functionId: string, version?: string): Promise<string | null> {
    this.initializeSchema()
    validateFunctionId(functionId)

    const versionKey = version ?? null
    const result = this.oneOrNull(
      this.ctx.storage.sql.exec<CodeRow>(
        `SELECT source_map FROM code WHERE function_id = ? AND version IS ?`,
        functionId,
        versionKey
      )
    )

    return result?.source_map ?? null
  }

  /**
   * Delete code for a function
   */
  async deleteCode(functionId: string, version?: string): Promise<void> {
    this.initializeSchema()
    validateFunctionId(functionId)

    const versionKey = version ?? null
    this.ctx.storage.sql.exec(
      `DELETE FROM code WHERE function_id = ? AND version IS ?`,
      functionId,
      versionKey
    )
  }

  /**
   * List code versions for a function
   */
  async listCodeVersions(functionId: string): Promise<string[]> {
    this.initializeSchema()
    validateFunctionId(functionId)

    const rows = this.ctx.storage.sql.exec<{ version: string | null }>(
      `SELECT version FROM code WHERE function_id = ?`,
      functionId
    ).toArray()

    const versions: string[] = []
    for (const row of rows) {
      if (row.version === null) {
        versions.push('latest')
      } else {
        versions.push(row.version)
      }
    }

    return versions
  }

  /**
   * Delete all code for a function (all versions)
   */
  async deleteAllCode(functionId: string): Promise<void> {
    this.initializeSchema()
    validateFunctionId(functionId)

    this.ctx.storage.sql.exec(
      `DELETE FROM code WHERE function_id = ?`,
      functionId
    )
  }

  // ===========================================================================
  // API KEY OPERATIONS
  // ===========================================================================

  /**
   * Store an API key
   */
  async putApiKey(keyHash: string, metadata: Omit<ApiKeyMetadata, 'keyHash'>): Promise<void> {
    this.initializeSchema()

    this.ctx.storage.sql.exec(`
      INSERT OR REPLACE INTO api_keys
      (key_hash, name, permissions, scopes, rate_limit, created, expires_at, revoked_at, revoked_reason, rotated_at, last_modified, last_used, usage_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      keyHash,
      metadata.name,
      JSON.stringify(metadata.permissions),
      metadata.scopes ? JSON.stringify(metadata.scopes) : null,
      metadata.rateLimit ? JSON.stringify(metadata.rateLimit) : null,
      metadata.created,
      metadata.expiresAt ?? null,
      metadata.revokedAt ?? null,
      metadata.revokedReason ?? null,
      metadata.rotatedAt ?? null,
      metadata.lastModified ?? null,
      metadata.lastUsed ?? null,
      metadata.usageCount ?? 0
    )
  }

  /**
   * Get API key metadata
   */
  async getApiKey(keyHash: string): Promise<ApiKeyMetadata | null> {
    this.initializeSchema()

    const result = this.oneOrNull(
      this.ctx.storage.sql.exec<ApiKeyRow>(
        `SELECT * FROM api_keys WHERE key_hash = ?`,
        keyHash
      )
    )

    if (!result) return null

    const metadata: ApiKeyMetadata = {
      keyHash: result.key_hash,
      name: result.name,
      permissions: JSON.parse(result.permissions) as ApiKeyPermissions,
      created: result.created,
      usageCount: result.usage_count,
    }

    if (result.scopes) {
      metadata.scopes = JSON.parse(result.scopes) as string[]
    }
    if (result.rate_limit) {
      metadata.rateLimit = JSON.parse(result.rate_limit) as { maxRequests: number; windowMs: number }
    }
    if (result.expires_at !== null) {
      metadata.expiresAt = result.expires_at
    }
    if (result.revoked_at !== null) {
      metadata.revokedAt = result.revoked_at
    }
    if (result.revoked_reason !== null) {
      metadata.revokedReason = result.revoked_reason
    }
    if (result.rotated_at !== null) {
      metadata.rotatedAt = result.rotated_at
    }
    if (result.last_modified !== null) {
      metadata.lastModified = result.last_modified
    }
    if (result.last_used !== null) {
      metadata.lastUsed = result.last_used
    }

    return metadata
  }

  /**
   * List all API keys
   */
  async listApiKeys(options?: { includeRevoked?: boolean }): Promise<ApiKeyMetadata[]> {
    this.initializeSchema()

    const includeRevoked = options?.includeRevoked ?? true

    let rows: ApiKeyRow[]
    if (includeRevoked) {
      rows = this.ctx.storage.sql.exec<ApiKeyRow>(
        `SELECT * FROM api_keys ORDER BY created DESC`
      ).toArray()
    } else {
      rows = this.ctx.storage.sql.exec<ApiKeyRow>(
        `SELECT * FROM api_keys WHERE revoked_at IS NULL ORDER BY created DESC`
      ).toArray()
    }

    return rows.map(row => {
      const metadata: ApiKeyMetadata = {
        keyHash: row.key_hash,
        name: row.name,
        permissions: JSON.parse(row.permissions) as ApiKeyPermissions,
        created: row.created,
        usageCount: row.usage_count,
      }

      if (row.scopes) {
        metadata.scopes = JSON.parse(row.scopes) as string[]
      }
      if (row.rate_limit) {
        metadata.rateLimit = JSON.parse(row.rate_limit) as { maxRequests: number; windowMs: number }
      }
      if (row.expires_at !== null) {
        metadata.expiresAt = row.expires_at
      }
      if (row.revoked_at !== null) {
        metadata.revokedAt = row.revoked_at
      }
      if (row.revoked_reason !== null) {
        metadata.revokedReason = row.revoked_reason
      }
      if (row.rotated_at !== null) {
        metadata.rotatedAt = row.rotated_at
      }
      if (row.last_modified !== null) {
        metadata.lastModified = row.last_modified
      }
      if (row.last_used !== null) {
        metadata.lastUsed = row.last_used
      }

      return metadata
    })
  }

  /**
   * Delete an API key
   */
  async deleteApiKey(keyHash: string): Promise<void> {
    this.initializeSchema()

    this.ctx.storage.sql.exec(
      `DELETE FROM api_keys WHERE key_hash = ?`,
      keyHash
    )

    // Also delete rate limit tracking
    this.ctx.storage.sql.exec(
      `DELETE FROM rate_limits WHERE key_hash = ?`,
      keyHash
    )
  }

  /**
   * Record API key usage
   */
  async recordApiKeyUsage(keyHash: string): Promise<void> {
    this.initializeSchema()

    const now = Date.now()
    this.ctx.storage.sql.exec(`
      UPDATE api_keys SET last_used = ?, usage_count = usage_count + 1 WHERE key_hash = ?
    `,
      now,
      keyHash
    )
  }

  /**
   * Check and increment rate limit
   */
  async checkRateLimit(keyHash: string): Promise<{ allowed: boolean; remaining?: number; resetAt?: number }> {
    this.initializeSchema()

    const keyMetadata = await this.getApiKey(keyHash)
    if (!keyMetadata?.rateLimit) {
      return { allowed: true }
    }

    const now = Date.now()
    const { maxRequests, windowMs } = keyMetadata.rateLimit

    // Get current rate limit state
    const current = this.oneOrNull(
      this.ctx.storage.sql.exec<{ request_count: number; window_start: number }>(
        `SELECT request_count, window_start FROM rate_limits WHERE key_hash = ?`,
        keyHash
      )
    )

    let requestCount = 0
    let windowStart = now

    if (current) {
      if (now - current.window_start < windowMs) {
        // Still in current window
        requestCount = current.request_count
        windowStart = current.window_start
      }
      // Otherwise, window has expired, start fresh
    }

    const remaining = Math.max(0, maxRequests - requestCount)
    const resetAt = windowStart + windowMs

    if (requestCount >= maxRequests) {
      return { allowed: false, remaining: 0, resetAt }
    }

    // Increment counter
    this.ctx.storage.sql.exec(`
      INSERT OR REPLACE INTO rate_limits (key_hash, request_count, window_start)
      VALUES (?, ?, ?)
    `,
      keyHash,
      requestCount + 1,
      windowStart
    )

    return { allowed: true, remaining: remaining - 1, resetAt }
  }

  // ===========================================================================
  // HTTP REQUEST HANDLER (DEPRECATED - use RPC methods directly)
  // ===========================================================================

  /**
   * Minimal fetch handler for WebSocket upgrades or legacy HTTP support.
   *
   * NOTE: Use RPC methods directly via the stub instead of HTTP routes.
   * All public methods on this class are callable via Workers RPC.
   *
   * @deprecated Prefer RPC: stub.methodName(args) instead of stub.fetch()
   */
  async fetch(request: Request): Promise<Response> {
    // Handle WebSocket upgrades if needed in the future
    if (request.headers.get('Upgrade') === 'websocket') {
      return new Response('WebSocket not implemented', { status: 501 })
    }

    // Return guidance to use RPC
    return new Response(
      JSON.stringify({
        error: 'HTTP routes deprecated - use Workers RPC instead',
        message: 'Call methods directly via stub: stub.getFunction(id), stub.putCode(id, code), etc.',
        docs: 'https://developers.cloudflare.com/durable-objects/api/rpc/',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
