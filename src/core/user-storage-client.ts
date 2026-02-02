/**
 * UserStorage Client
 *
 * Provides a client interface to the UserStorage Durable Object that matches
 * the KVFunctionRegistry and KVCodeStorage APIs for easy migration.
 *
 * Uses Workers RPC for direct method invocation instead of HTTP routes.
 * Reference: https://developers.cloudflare.com/durable-objects/api/rpc/
 *
 * Usage:
 * ```typescript
 * // Get the user's storage DO
 * const client = new UserStorageClient(env.USER_STORAGE, userId)
 *
 * // Use like KVFunctionRegistry
 * await client.registry.put(metadata)
 * const fn = await client.registry.get(functionId)
 *
 * // Use like KVCodeStorage
 * await client.code.put(functionId, code, version)
 * const code = await client.code.get(functionId, version)
 * ```
 *
 * @module core/user-storage-client
 */

import type { FunctionMetadata } from './types'
import type {
  UserStorage,
  ApiKeyMetadata,
  ApiKeyPermissions,
  ListResult,
} from '../do/user-storage'
import { hashApiKey } from './crypto-utils'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result from getCompiledOrSource
 */
export interface CompiledCodeResult {
  code: string
  usedPrecompiled: boolean
  fallbackReason?: 'no_precompiled_code' | 'empty_precompiled_code'
  version?: string
}

/**
 * Create API key options
 */
export interface CreateApiKeyOptions {
  name: string
  permissions?: ApiKeyPermissions
  scopes?: string[]
  rateLimit?: {
    maxRequests: number
    windowMs: number
  }
  expiresAt?: number
}

/**
 * Create API key result
 */
export interface CreateApiKeyResult {
  apiKey: string
  keyHash: string
  metadata: ApiKeyMetadata
}

/**
 * Validate API key result
 */
export interface ValidateApiKeyResult {
  valid: boolean
  metadata?: ApiKeyMetadata
  error?: string
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a random API key with fnk_ prefix
 */
function generateApiKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = 'fnk_'
  const randomBytes = new Uint8Array(32)
  crypto.getRandomValues(randomBytes)
  for (let i = 0; i < 32; i++) {
    result += chars[(randomBytes[i] ?? 0) % chars.length]
  }
  return result
}

// hashApiKey is imported from ./crypto-utils
export { hashApiKey } from './crypto-utils'

/**
 * Validate API key format
 */
function isValidKeyFormat(apiKey: string): boolean {
  return /^fnk_[a-zA-Z0-9]{32}$/.test(apiKey)
}

// ============================================================================
// USER STORAGE CLIENT
// ============================================================================

/**
 * Client for the UserStorage Durable Object
 *
 * Provides registry, code, and API key interfaces that match the KV-based
 * implementations for easy migration.
 *
 * Uses Workers RPC for direct method invocation - no HTTP routing needed.
 */
export class UserStorageClient {
  private stub: DurableObjectStub<UserStorage>
  public readonly userId: string

  /**
   * Registry interface matching KVFunctionRegistry
   */
  public readonly registry: UserStorageRegistry

  /**
   * Code interface matching KVCodeStorage
   */
  public readonly code: UserStorageCode

  /**
   * API key interface matching KVApiKeyStore
   */
  public readonly apiKeys: UserStorageApiKeys

  constructor(namespace: DurableObjectNamespace<UserStorage>, userId: string) {
    // Create a deterministic ID based on the user ID
    const id = namespace.idFromName(userId)
    this.stub = namespace.get(id)
    this.userId = userId

    this.registry = new UserStorageRegistry(this.stub)
    this.code = new UserStorageCode(this.stub)
    this.apiKeys = new UserStorageApiKeys(this.stub, userId)
  }
}

// ============================================================================
// REGISTRY CLIENT (KVFunctionRegistry compatible)
// ============================================================================

/**
 * Registry interface for function metadata
 *
 * Uses Workers RPC to call methods directly on the UserStorage DO.
 */
export class UserStorageRegistry {
  constructor(private stub: DurableObjectStub<UserStorage>) {}

  /**
   * Store function metadata
   */
  async put(metadata: FunctionMetadata): Promise<void> {
    await this.stub.putFunction(metadata)
  }

  /**
   * Get function metadata
   */
  async get(functionId: string): Promise<FunctionMetadata | null> {
    return this.stub.getFunction(functionId)
  }

  /**
   * List all functions
   */
  async list(options?: { cursor?: string; limit?: number }): Promise<{
    functions: FunctionMetadata[]
    cursor?: string
    hasMore: boolean
  }> {
    const result = await this.stub.listFunctions(options)

    const response: { functions: FunctionMetadata[]; hasMore: boolean; cursor?: string } = {
      functions: result.items,
      hasMore: result.hasMore,
    }
    if (result.cursor) {
      response.cursor = result.cursor
    }
    return response
  }

  /**
   * Update function metadata
   */
  async update(
    functionId: string,
    updates: Partial<Omit<FunctionMetadata, 'id' | 'createdAt'>>
  ): Promise<FunctionMetadata> {
    return this.stub.updateFunction(functionId, updates)
  }

  /**
   * Delete function
   */
  async delete(functionId: string): Promise<void> {
    await this.stub.deleteFunction(functionId)
  }

  /**
   * Store version snapshot
   */
  async putVersion(functionId: string, version: string, metadata: FunctionMetadata): Promise<void> {
    await this.stub.putFunctionVersion(functionId, version, metadata)
  }

  /**
   * Get version snapshot
   */
  async getVersion(functionId: string, version: string): Promise<FunctionMetadata | null> {
    return this.stub.getFunctionVersion(functionId, version)
  }

  /**
   * List all versions
   */
  async listVersions(functionId: string): Promise<string[]> {
    return this.stub.listFunctionVersions(functionId)
  }
}

// ============================================================================
// CODE CLIENT (KVCodeStorage compatible)
// ============================================================================

/**
 * Code storage interface
 *
 * Uses Workers RPC to call methods directly on the UserStorage DO.
 */
export class UserStorageCode {
  constructor(private stub: DurableObjectStub<UserStorage>) {}

  /**
   * Store code
   */
  async put(functionId: string, code: string, version?: string): Promise<void> {
    await this.stub.putCode(functionId, code, version)
  }

  /**
   * Get code
   */
  async get(functionId: string, version?: string): Promise<string | null> {
    return this.stub.getCode(functionId, version)
  }

  /**
   * Delete code
   */
  async delete(functionId: string, version?: string): Promise<void> {
    await this.stub.deleteCode(functionId, version)
  }

  /**
   * Store compiled code
   */
  async putCompiled(functionId: string, compiledCode: string, version?: string): Promise<void> {
    await this.stub.putCompiledCode(functionId, compiledCode, version)
  }

  /**
   * Get compiled code
   */
  async getCompiled(functionId: string, version?: string): Promise<string | null> {
    return this.stub.getCompiledCode(functionId, version)
  }

  /**
   * Get compiled or source code
   */
  async getCompiledOrSource(functionId: string, version?: string): Promise<CompiledCodeResult | null> {
    // Try compiled first
    const compiled = await this.getCompiled(functionId, version)
    if (compiled && compiled.trim().length > 0) {
      const result: CompiledCodeResult = {
        code: compiled,
        usedPrecompiled: true,
      }
      if (version) {
        result.version = version
      }
      return result
    }

    // Fall back to source
    const source = await this.get(functionId, version)
    if (!source) {
      return null
    }

    const result: CompiledCodeResult = {
      code: source,
      usedPrecompiled: false,
      fallbackReason: compiled ? 'empty_precompiled_code' : 'no_precompiled_code',
    }
    if (version) {
      result.version = version
    }
    return result
  }

  /**
   * Store source map
   */
  async putSourceMap(functionId: string, sourceMap: string, version?: string): Promise<void> {
    await this.stub.putSourceMap(functionId, sourceMap, version)
  }

  /**
   * Get source map
   */
  async getSourceMap(functionId: string, version?: string): Promise<string | null> {
    return this.stub.getSourceMap(functionId, version)
  }

  /**
   * List versions
   */
  async listVersions(functionId: string): Promise<string[]> {
    return this.stub.listCodeVersions(functionId)
  }

  /**
   * Delete all code for a function
   */
  async deleteAll(functionId: string): Promise<void> {
    await this.stub.deleteAllCode(functionId)
  }
}

// ============================================================================
// API KEYS CLIENT (KVApiKeyStore compatible)
// ============================================================================

/**
 * API key storage interface
 *
 * Uses Workers RPC to call methods directly on the UserStorage DO.
 */
export class UserStorageApiKeys {
  constructor(private stub: DurableObjectStub<UserStorage>, private ownerId: string) {}

  /**
   * Create a new API key
   */
  async create(options: CreateApiKeyOptions): Promise<CreateApiKeyResult> {
    const apiKey = generateApiKey()
    const keyHash = await hashApiKey(apiKey)

    const metadata: ApiKeyMetadata = {
      keyHash,
      name: options.name,
      permissions: options.permissions ?? {
        invoke: true,
        manage: false,
        admin: false,
      },
      created: Date.now(),
    }

    Object.assign(metadata,
      ...[
        options.scopes && { scopes: options.scopes },
        options.rateLimit && { rateLimit: options.rateLimit },
        options.expiresAt && { expiresAt: options.expiresAt },
      ].filter(Boolean)
    )

    // Store via RPC - putApiKey expects (keyHash, metadata without keyHash)
    const { keyHash: _kh, ...metadataWithoutHash } = metadata
    await this.stub.putApiKey(keyHash, metadataWithoutHash)

    return { apiKey, keyHash, metadata }
  }

  /**
   * Validate an API key
   */
  async validate(apiKey: string): Promise<ValidateApiKeyResult> {
    if (!isValidKeyFormat(apiKey)) {
      return { valid: false, error: 'Invalid key format' }
    }

    const keyHash = await hashApiKey(apiKey)
    const metadata = await this.getMetadata(keyHash)

    if (!metadata) {
      return { valid: false, error: 'Key not found' }
    }

    // Check if rotated
    if (metadata.rotatedAt) {
      if (metadata.expiresAt && Date.now() < metadata.expiresAt) {
        return { valid: true, metadata }
      }
      return { valid: false, error: 'Key rotated' }
    }

    // Check if revoked
    if (metadata.revokedAt) {
      return { valid: false, error: 'Key revoked' }
    }

    // Check if expired
    if (metadata.expiresAt && Date.now() > metadata.expiresAt) {
      return { valid: false, error: 'Key expired' }
    }

    return { valid: true, metadata }
  }

  /**
   * Get key metadata by hash
   */
  async getMetadata(keyHash: string): Promise<ApiKeyMetadata | null> {
    return this.stub.getApiKey(keyHash)
  }

  /**
   * List all keys
   */
  async listByOwner(
    _ownerId: string,
    options?: { includeRevoked?: boolean }
  ): Promise<Array<{ keyHash: string; metadata: ApiKeyMetadata }>> {
    const keys = await this.stub.listApiKeys(options)

    return keys.map(metadata => ({
      keyHash: metadata.keyHash,
      metadata,
    }))
  }

  /**
   * Revoke a key
   */
  async revoke(keyHash: string, options?: { reason?: string }): Promise<void> {
    const metadata = await this.getMetadata(keyHash)
    if (!metadata) {
      throw new Error('Key not found')
    }

    if (metadata.revokedAt) {
      return // Already revoked
    }

    const updated: Omit<ApiKeyMetadata, 'keyHash'> = {
      name: metadata.name,
      permissions: metadata.permissions,
      created: metadata.created,
      revokedAt: Date.now(),
    }

    Object.assign(updated,
      ...[
        metadata.scopes && { scopes: metadata.scopes },
        metadata.rateLimit && { rateLimit: metadata.rateLimit },
        metadata.expiresAt && { expiresAt: metadata.expiresAt },
        options?.reason && { revokedReason: options.reason },
        metadata.rotatedAt && { rotatedAt: metadata.rotatedAt },
        metadata.lastModified && { lastModified: metadata.lastModified },
        metadata.lastUsed && { lastUsed: metadata.lastUsed },
        metadata.usageCount && { usageCount: metadata.usageCount },
      ].filter(Boolean)
    )

    await this.stub.putApiKey(keyHash, updated)
  }

  /**
   * Delete a key
   */
  async delete(keyHash: string): Promise<void> {
    await this.stub.deleteApiKey(keyHash)
  }

  /**
   * Check rate limit
   */
  async checkRateLimit(keyHash: string): Promise<{ allowed: boolean; remaining?: number; resetAt?: number }> {
    return this.stub.checkRateLimit(keyHash)
  }

  /**
   * Record usage
   */
  async recordUsage(keyHash: string): Promise<void> {
    await this.stub.recordApiKeyUsage(keyHash)
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a UserStorageClient for a user
 *
 * @param namespace - The USER_STORAGE Durable Object namespace
 * @param userId - The user's ID (from OAuth or API key)
 * @returns A client with registry, code, and apiKeys interfaces
 */
export function createUserStorageClient(
  namespace: DurableObjectNamespace<UserStorage>,
  userId: string
): UserStorageClient {
  return new UserStorageClient(namespace, userId)
}
