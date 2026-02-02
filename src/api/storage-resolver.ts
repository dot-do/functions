/**
 * Storage Resolver
 *
 * Resolves the appropriate storage backend for function operations.
 * Supports gradual migration from KV to Durable Objects.
 *
 * Migration strategy:
 * 1. If USER_STORAGE DO is available AND user is authenticated, use DO storage
 * 2. Otherwise, fall back to KV storage (legacy behavior)
 *
 * This allows:
 * - Authenticated users to benefit from DO's consistency/isolation
 * - Unauthenticated requests to continue working with KV
 * - Gradual migration without breaking changes
 *
 * @module api/storage-resolver
 */

import type { Env } from './router'
import type { AuthContext } from './middleware/auth'
import { KVFunctionRegistry } from '../core/kv-function-registry'
import { KVCodeStorage } from '../core/code-storage'
import { KVApiKeyStore } from '../core/kv-api-keys'
import {
  UserStorageClient,
  createUserStorageClient,
  type UserStorageRegistry,
  type UserStorageCode,
  type UserStorageApiKeys,
} from '../core/user-storage-client'
import type { FunctionMetadata } from '../core/types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Storage backend discriminator
 */
export type StorageBackend = 'durable-object' | 'kv'

/**
 * Unified registry interface compatible with both KV and DO backends
 */
export interface IFunctionRegistry {
  put(metadata: FunctionMetadata): Promise<void>
  get(functionId: string): Promise<FunctionMetadata | null>
  list(options?: { cursor?: string; limit?: number }): Promise<{
    functions: FunctionMetadata[]
    cursor?: string
    hasMore: boolean
  }>
  update(
    functionId: string,
    updates: Partial<Omit<FunctionMetadata, 'id' | 'createdAt'>>
  ): Promise<FunctionMetadata>
  delete(functionId: string): Promise<void>
  putVersion(functionId: string, version: string, metadata: FunctionMetadata): Promise<void>
  getVersion(functionId: string, version: string): Promise<FunctionMetadata | null>
  listVersions(functionId: string): Promise<string[]>
}

/**
 * Unified code storage interface compatible with both KV and DO backends
 */
export interface ICodeStorage {
  put(functionId: string, code: string, version?: string): Promise<void>
  get(functionId: string, version?: string): Promise<string | null>
  delete(functionId: string, version?: string): Promise<void>
  putCompiled(functionId: string, compiledCode: string, version?: string): Promise<void>
  getCompiled(functionId: string, version?: string): Promise<string | null>
  putSourceMap(functionId: string, sourceMap: string, version?: string): Promise<void>
  getSourceMap(functionId: string, version?: string): Promise<string | null>
  listVersions(functionId: string): Promise<string[]>
}

/**
 * Resolved storage with backend information
 */
export interface ResolvedStorage {
  /** The storage backend being used */
  backend: StorageBackend
  /** The user ID (if authenticated and using DO) */
  userId?: string
  /** Function registry interface */
  registry: IFunctionRegistry
  /** Code storage interface */
  code: ICodeStorage
  /** API key store (only available for DO backend with auth) */
  apiKeys?: UserStorageApiKeys
}

// ============================================================================
// KV ADAPTERS
// ============================================================================

/**
 * Adapter to make KVFunctionRegistry match IFunctionRegistry
 */
class KVRegistryAdapter implements IFunctionRegistry {
  constructor(private kv: KVFunctionRegistry) {}

  async put(metadata: FunctionMetadata): Promise<void> {
    return this.kv.put(metadata)
  }

  async get(functionId: string): Promise<FunctionMetadata | null> {
    return this.kv.get(functionId)
  }

  async list(options?: { cursor?: string; limit?: number }): Promise<{
    functions: FunctionMetadata[]
    cursor?: string
    hasMore: boolean
  }> {
    return this.kv.list(options)
  }

  async update(
    functionId: string,
    updates: Partial<Omit<FunctionMetadata, 'id' | 'createdAt'>>
  ): Promise<FunctionMetadata> {
    return this.kv.update(functionId, updates)
  }

  async delete(functionId: string): Promise<void> {
    return this.kv.delete(functionId)
  }

  async putVersion(functionId: string, version: string, metadata: FunctionMetadata): Promise<void> {
    return this.kv.putVersion(functionId, version, metadata)
  }

  async getVersion(functionId: string, version: string): Promise<FunctionMetadata | null> {
    return this.kv.getVersion(functionId, version)
  }

  async listVersions(functionId: string): Promise<string[]> {
    return this.kv.listVersions(functionId)
  }
}

/**
 * Adapter to make KVCodeStorage match ICodeStorage
 */
class KVCodeAdapter implements ICodeStorage {
  constructor(private kv: KVCodeStorage) {}

  async put(functionId: string, code: string, version?: string): Promise<void> {
    return this.kv.put(functionId, code, version)
  }

  async get(functionId: string, version?: string): Promise<string | null> {
    return this.kv.get(functionId, version)
  }

  async delete(functionId: string, version?: string): Promise<void> {
    return this.kv.delete(functionId, version)
  }

  async putCompiled(functionId: string, compiledCode: string, version?: string): Promise<void> {
    return this.kv.putCompiled(functionId, compiledCode, version)
  }

  async getCompiled(functionId: string, version?: string): Promise<string | null> {
    return this.kv.getCompiled(functionId, version)
  }

  async putSourceMap(functionId: string, sourceMap: string, version?: string): Promise<void> {
    return this.kv.putSourceMap(functionId, sourceMap, version)
  }

  async getSourceMap(functionId: string, version?: string): Promise<string | null> {
    return this.kv.getSourceMap(functionId, version)
  }

  async listVersions(functionId: string): Promise<string[]> {
    return this.kv.listVersions(functionId)
  }
}

// ============================================================================
// DO ADAPTERS
// ============================================================================

/**
 * Adapter to make UserStorageRegistry match IFunctionRegistry
 */
class DORegistryAdapter implements IFunctionRegistry {
  constructor(private registry: UserStorageRegistry) {}

  async put(metadata: FunctionMetadata): Promise<void> {
    return this.registry.put(metadata)
  }

  async get(functionId: string): Promise<FunctionMetadata | null> {
    return this.registry.get(functionId)
  }

  async list(options?: { cursor?: string; limit?: number }): Promise<{
    functions: FunctionMetadata[]
    cursor?: string
    hasMore: boolean
  }> {
    return this.registry.list(options)
  }

  async update(
    functionId: string,
    updates: Partial<Omit<FunctionMetadata, 'id' | 'createdAt'>>
  ): Promise<FunctionMetadata> {
    return this.registry.update(functionId, updates)
  }

  async delete(functionId: string): Promise<void> {
    return this.registry.delete(functionId)
  }

  async putVersion(functionId: string, version: string, metadata: FunctionMetadata): Promise<void> {
    return this.registry.putVersion(functionId, version, metadata)
  }

  async getVersion(functionId: string, version: string): Promise<FunctionMetadata | null> {
    return this.registry.getVersion(functionId, version)
  }

  async listVersions(functionId: string): Promise<string[]> {
    return this.registry.listVersions(functionId)
  }
}

/**
 * Adapter to make UserStorageCode match ICodeStorage
 */
class DOCodeAdapter implements ICodeStorage {
  constructor(private code: UserStorageCode) {}

  async put(functionId: string, code: string, version?: string): Promise<void> {
    return this.code.put(functionId, code, version)
  }

  async get(functionId: string, version?: string): Promise<string | null> {
    return this.code.get(functionId, version)
  }

  async delete(functionId: string, version?: string): Promise<void> {
    return this.code.delete(functionId, version)
  }

  async putCompiled(functionId: string, compiledCode: string, version?: string): Promise<void> {
    return this.code.putCompiled(functionId, compiledCode, version)
  }

  async getCompiled(functionId: string, version?: string): Promise<string | null> {
    return this.code.getCompiled(functionId, version)
  }

  async putSourceMap(functionId: string, sourceMap: string, version?: string): Promise<void> {
    return this.code.putSourceMap(functionId, sourceMap, version)
  }

  async getSourceMap(functionId: string, version?: string): Promise<string | null> {
    return this.code.getSourceMap(functionId, version)
  }

  async listVersions(functionId: string): Promise<string[]> {
    return this.code.listVersions(functionId)
  }
}

// ============================================================================
// RESOLVER
// ============================================================================

/**
 * Resolve storage backend based on environment and authentication context.
 *
 * Strategy:
 * 1. If USER_STORAGE DO is available AND user is authenticated, use DO
 * 2. Otherwise, fall back to KV storage
 *
 * @param env - Environment bindings
 * @param authContext - Optional authentication context from middleware
 * @returns Resolved storage interfaces
 */
export function resolveStorage(
  env: Env,
  authContext?: AuthContext
): ResolvedStorage {
  // Check if we can use DO storage
  const canUseDO = env.USER_STORAGE && authContext?.userId

  if (canUseDO && env.USER_STORAGE && authContext?.userId) {
    const client = createUserStorageClient(env.USER_STORAGE, authContext.userId)

    return {
      backend: 'durable-object',
      userId: authContext.userId,
      registry: new DORegistryAdapter(client.registry),
      code: new DOCodeAdapter(client.code),
      apiKeys: client.apiKeys,
    }
  }

  // Fall back to KV storage
  return {
    backend: 'kv',
    registry: new KVRegistryAdapter(new KVFunctionRegistry(env.FUNCTIONS_REGISTRY)),
    code: new KVCodeAdapter(new KVCodeStorage(env.FUNCTIONS_CODE)),
  }
}

/**
 * Get a UserStorageClient for a specific user.
 * Requires USER_STORAGE DO binding.
 *
 * @param env - Environment bindings
 * @param userId - The user ID
 * @returns UserStorageClient instance
 * @throws Error if USER_STORAGE is not configured
 */
export function getUserStorageClient(
  env: Env,
  userId: string
): UserStorageClient {
  if (!env.USER_STORAGE) {
    throw new Error('USER_STORAGE Durable Object is not configured')
  }

  return createUserStorageClient(env.USER_STORAGE!, userId)
}

/**
 * Check if DO storage is available and should be preferred.
 *
 * @param env - Environment bindings
 * @param authContext - Optional authentication context
 * @returns True if DO storage should be used
 */
export function shouldUseDOStorage(
  env: Env,
  authContext?: AuthContext
): boolean {
  return !!(env.USER_STORAGE && authContext?.userId)
}
