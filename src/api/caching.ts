/**
 * Caching Layer for Functions.do
 *
 * Provides caching utilities using Cloudflare's Cache API to reduce KV request
 * amplification by caching function metadata and code at the edge.
 *
 * Each invoke was previously doing 3 KV requests (metadata, compiled, source).
 * With Cache API, most requests hit the edge cache first.
 *
 * Issue: functions-1277
 *
 * @module api/caching
 */

import type { FunctionMetadata } from '../core/types'

// =============================================================================
// CONSTANTS
// =============================================================================

/** Cache TTL in seconds (1 minute) for Cache-Control headers */
export const CACHE_TTL_SECONDS = 60

/** Internal cache domain for creating cache keys */
const CACHE_DOMAIN = 'https://cache.internal'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Cache key types for different function data.
 */
export type CacheType = 'metadata' | 'compiled' | 'source'

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Create a cache key Request for function data.
 * Uses a synthetic URL that uniquely identifies the cached resource.
 */
function createCacheKey(functionId: string, type: CacheType, version?: string): Request {
  const versionPath = version ? `/${version}` : '/latest'
  return new Request(`${CACHE_DOMAIN}/functions/${functionId}${versionPath}/${type}`)
}

// =============================================================================
// METADATA CACHING
// =============================================================================

/**
 * Get cached metadata from Cloudflare Cache API.
 *
 * @param functionId - The function ID to get cached metadata for
 * @param version - Optional specific version (defaults to 'latest')
 * @returns The cached metadata or null if not found
 */
export async function getCachedMetadata(functionId: string, version?: string): Promise<FunctionMetadata | null> {
  try {
    const cache = caches.default
    const cacheKey = createCacheKey(functionId, 'metadata', version)
    const cached = await cache.match(cacheKey)
    if (cached) {
      return await cached.json() as FunctionMetadata
    }
  } catch (error) {
    // Cache miss or error - fall through to KV
    console.debug(`[cache] metadata get error for ${functionId}:`, error instanceof Error ? error.message : String(error))
  }
  return null
}

/**
 * Cache function metadata using Cloudflare Cache API.
 *
 * @param functionId - The function ID to cache metadata for
 * @param metadata - The metadata to cache
 * @param version - Optional specific version (defaults to 'latest')
 */
export async function cacheMetadata(functionId: string, metadata: FunctionMetadata, version?: string): Promise<void> {
  try {
    const cache = caches.default
    const cacheKey = createCacheKey(functionId, 'metadata', version)
    const response = new Response(JSON.stringify(metadata), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `max-age=${CACHE_TTL_SECONDS}`,
      },
    })
    await cache.put(cacheKey, response)
  } catch (error) {
    // Cache put failed - non-fatal, will just hit KV next time
    console.debug(`[cache] metadata put error for ${functionId}:`, error instanceof Error ? error.message : String(error))
  }
}

// =============================================================================
// COMPILED CODE CACHING
// =============================================================================

/**
 * Get cached compiled code from Cloudflare Cache API.
 *
 * @param functionId - The function ID to get cached compiled code for
 * @param version - Optional specific version (defaults to 'latest')
 * @returns The cached compiled code or null if not found
 */
export async function getCachedCompiledCode(functionId: string, version?: string): Promise<string | null> {
  try {
    const cache = caches.default
    const cacheKey = createCacheKey(functionId, 'compiled', version)
    const cached = await cache.match(cacheKey)
    if (cached) {
      return await cached.text()
    }
  } catch (error) {
    // Cache miss or error - fall through to KV
    console.debug(`[cache] compiled get error for ${functionId}:`, error instanceof Error ? error.message : String(error))
  }
  return null
}

/**
 * Cache compiled code using Cloudflare Cache API.
 *
 * @param functionId - The function ID to cache compiled code for
 * @param code - The compiled JavaScript code to cache
 * @param version - Optional specific version (defaults to 'latest')
 */
export async function cacheCompiledCode(functionId: string, code: string, version?: string): Promise<void> {
  try {
    const cache = caches.default
    const cacheKey = createCacheKey(functionId, 'compiled', version)
    const response = new Response(code, {
      headers: {
        'Content-Type': 'application/javascript',
        'Cache-Control': `max-age=${CACHE_TTL_SECONDS}`,
      },
    })
    await cache.put(cacheKey, response)
  } catch (error) {
    // Cache put failed - non-fatal
    console.debug(`[cache] compiled put error for ${functionId}:`, error instanceof Error ? error.message : String(error))
  }
}

// =============================================================================
// SOURCE CODE CACHING
// =============================================================================

/**
 * Get cached source code from Cloudflare Cache API.
 *
 * @param functionId - The function ID to get cached source code for
 * @param version - Optional specific version (defaults to 'latest')
 * @returns The cached source code or null if not found
 */
export async function getCachedSourceCode(functionId: string, version?: string): Promise<string | null> {
  try {
    const cache = caches.default
    const cacheKey = createCacheKey(functionId, 'source', version)
    const cached = await cache.match(cacheKey)
    if (cached) {
      return await cached.text()
    }
  } catch (error) {
    // Cache miss or error - fall through to KV
    console.debug(`[cache] source get error for ${functionId}:`, error instanceof Error ? error.message : String(error))
  }
  return null
}

/**
 * Cache source code using Cloudflare Cache API.
 *
 * @param functionId - The function ID to cache source code for
 * @param code - The source code to cache
 * @param version - Optional specific version (defaults to 'latest')
 */
export async function cacheSourceCode(functionId: string, code: string, version?: string): Promise<void> {
  try {
    const cache = caches.default
    const cacheKey = createCacheKey(functionId, 'source', version)
    const response = new Response(code, {
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': `max-age=${CACHE_TTL_SECONDS}`,
      },
    })
    await cache.put(cacheKey, response)
  } catch (error) {
    // Cache put failed - non-fatal
    console.debug(`[cache] source put error for ${functionId}:`, error instanceof Error ? error.message : String(error))
  }
}

// =============================================================================
// CACHE INVALIDATION
// =============================================================================

/**
 * Invalidate all cached data for a function using Cloudflare Cache API.
 * Called on deploy/delete to ensure cache consistency.
 *
 * @param functionId - The function ID to invalidate cache for
 * @param version - Optional specific version to invalidate (if not provided, invalidates 'latest')
 */
export async function invalidateFunctionCache(functionId: string, version?: string): Promise<void> {
  try {
    const cache = caches.default
    const cacheTypes: CacheType[] = ['metadata', 'compiled', 'source']

    // Delete cached entries for the specified version (or 'latest')
    const deletePromises = cacheTypes.map(type => {
      const cacheKey = createCacheKey(functionId, type, version)
      return cache.delete(cacheKey)
    })

    // If invalidating a specific version, also invalidate 'latest' since it may have changed
    if (version) {
      const latestDeletePromises = cacheTypes.map(type => {
        const cacheKey = createCacheKey(functionId, type, undefined)
        return cache.delete(cacheKey)
      })
      deletePromises.push(...latestDeletePromises)
    }

    await Promise.all(deletePromises)
  } catch (error) {
    // Cache invalidation failed - entries will expire naturally via TTL
    console.debug(`[cache] invalidate error for ${functionId}:`, error instanceof Error ? error.message : String(error))
  }
}
