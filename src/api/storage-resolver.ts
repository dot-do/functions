/**
 * Storage Resolver
 *
 * Resolves the appropriate storage backend for function operations.
 * Uses the UserStorage Durable Object for all storage operations.
 *
 * @module api/storage-resolver
 */

import type { Env } from './router'
import type { AuthContext } from './middleware/auth'
import {
  UserStorageClient,
  createUserStorageClient,
  type UserStorageApiKeys,
} from '../core/user-storage-client'
import type { FunctionMetadata } from '../core/types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Storage backend discriminator
 */
export type StorageBackend = 'durable-object'

/**
 * Unified registry interface compatible with DO backend
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
 * Unified code storage interface compatible with DO backend
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
  /** The user ID */
  userId: string
  /** Function registry interface */
  registry: IFunctionRegistry
  /** Code storage interface */
  code: ICodeStorage
  /** API key store */
  apiKeys?: UserStorageApiKeys
}

// ============================================================================
// RESOLVER
// ============================================================================

/**
 * Resolve storage backend using UserStorage Durable Object.
 *
 * @param env - Environment bindings
 * @param authContext - Optional authentication context from middleware
 * @returns Resolved storage interfaces
 */
export function resolveStorage(
  env: Env,
  authContext?: AuthContext
): ResolvedStorage {
  const userId = authContext?.userId || 'anonymous'

  if (!env.USER_STORAGE) {
    throw new Error('USER_STORAGE Durable Object is not configured')
  }

  const client = createUserStorageClient(env.USER_STORAGE, userId)

  return {
    backend: 'durable-object',
    userId,
    registry: client.registry,
    code: client.code,
    apiKeys: client.apiKeys,
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

  return createUserStorageClient(env.USER_STORAGE, userId)
}
