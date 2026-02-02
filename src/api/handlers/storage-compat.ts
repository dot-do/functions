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

/**
 * Minimal registry interface shared by UserStorageRegistry and KVFunctionRegistry
 */
export interface RegistryLike {
  get(functionId: string): Promise<any>
  put(metadata: any): Promise<void>
  list(options?: any): Promise<any>
  update?(functionId: string, updates: any): Promise<any>
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
export function getStorageClientCompat(env: any, userId: string = 'anonymous'): StorageClientCompat {
  // Prefer DO storage (production)
  if (env.USER_STORAGE) {
    return createUserStorageClient(env.USER_STORAGE, userId)
  }

  // Fall back to KV (legacy tests)
  const registry = env.FUNCTIONS_REGISTRY ? new KVFunctionRegistry(env.FUNCTIONS_REGISTRY) : null
  const code = env.FUNCTIONS_CODE ? new KVCodeStorage(env.FUNCTIONS_CODE) : null

  return {
    registry: registry as unknown as RegistryLike,
    code: code as unknown as CodeStorageLike,
    userId,
  }
}
