/**
 * Storage Compatibility Layer
 *
 * Provides backward-compatible storage access that works with both:
 * - UserStorage DO (production, preferred)
 * - KV namespaces (legacy, for existing tests)
 *
 * This exists to support the transition from KV to DO storage.
 * Once all tests are migrated to use real miniflare DO bindings,
 * this file should be removed.
 */

import { KVFunctionRegistry } from '../../core/kv-function-registry'
import { KVCodeStorage } from '../../core/code-storage'
import { createUserStorageClient, type UserStorageClient } from '../../core/user-storage-client'
import type { Env } from '../../core/env'
import type { FunctionMetadata } from '../../core/types'

/**
 * List options for registry queries
 */
export interface RegistryListOptions {
  prefix?: string
  limit?: number
  cursor?: string
}

/**
 * List result from registry queries
 */
export interface RegistryListResult {
  keys: Array<{ name: string; metadata?: FunctionMetadata }>
  list_complete?: boolean
  cursor?: string
}

/**
 * Minimal registry interface shared by UserStorageRegistry and KVFunctionRegistry
 */
export interface RegistryLike {
  get(functionId: string): Promise<FunctionMetadata | null>
  put(metadata: FunctionMetadata): Promise<void>
  list(options?: RegistryListOptions): Promise<RegistryListResult>
  update?(functionId: string, updates: Partial<FunctionMetadata>): Promise<FunctionMetadata | null>
  delete(functionId: string): Promise<void>
}

/**
 * Minimal code storage interface shared by UserStorageCode and KVCodeStorage
 */
export interface CodeStorageLike {
  get(functionId: string, version?: string): Promise<string | null>
  put(functionId: string, code: string, version?: string): Promise<void>
  delete(functionId: string, version?: string): Promise<void>
}

/**
 * Storage client that works with either DO or KV backend
 */
export interface StorageClientCompat {
  registry: RegistryLike
  code: CodeStorageLike
  userId: string
}

/**
 * Get a storage client from the environment.
 * Prefers USER_STORAGE DO, falls back to KV namespaces.
 */
export function getStorageClientCompat(env: Env, userId: string = 'anonymous'): StorageClientCompat {
  // Prefer DO storage (production)
  if (env.USER_STORAGE) {
    return createUserStorageClient(env.USER_STORAGE, userId)
  }

  // Fall back to KV (legacy tests)
  // KVFunctionRegistry and KVCodeStorage implement RegistryLike and CodeStorageLike
  // structurally. Use a fallback stub for the null case to avoid double assertions.
  const registry: RegistryLike = env.FUNCTIONS_REGISTRY
    ? new KVFunctionRegistry(env.FUNCTIONS_REGISTRY)
    : createNullRegistry()
  const code: CodeStorageLike = env.FUNCTIONS_CODE
    ? new KVCodeStorage(env.FUNCTIONS_CODE)
    : createNullCodeStorage()

  return {
    registry,
    code,
    userId,
  }
}

/**
 * Create a no-op registry stub for when no storage binding is available.
 * All operations return null/empty to fail gracefully.
 */
function createNullRegistry(): RegistryLike {
  return {
    get: async () => null,
    put: async () => {},
    list: async () => ({ keys: [] }),
    delete: async () => {},
  }
}

/**
 * Create a no-op code storage stub for when no storage binding is available.
 * All operations return null to fail gracefully.
 */
function createNullCodeStorage(): CodeStorageLike {
  return {
    get: async () => null,
    put: async () => {},
    delete: async () => {},
  }
}
