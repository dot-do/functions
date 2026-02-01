/**
 * KV-backed API Key Store for Functions.do
 *
 * Provides secure API key management using Cloudflare Workers KV.
 * Keys are stored with SHA-256 hashed identifiers for security.
 *
 * Key storage format:
 * - keys:{keyHash} - API key metadata
 * - owner:{ownerId}:keys:{keyHash} - Owner index for key lookup
 * - ratelimit:{keyHash} - Rate limit tracking data
 */

/**
 * Permissions that can be granted to an API key
 */
export interface ApiKeyPermissions {
  /** Permission to invoke functions */
  invoke: boolean
  /** Permission to manage functions (create, update, delete) */
  manage: boolean
  /** Admin-level permissions */
  admin: boolean
}

/**
 * Rate limit configuration for an API key
 */
export interface ApiKeyRateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number
  /** Time window in milliseconds */
  windowMs: number
}

/**
 * Metadata stored with each API key
 */
export interface ApiKeyMetadata {
  /** Owner ID (user or organization) */
  ownerId: string
  /** Human-readable name for the key */
  name: string
  /** Permissions granted to this key */
  permissions: ApiKeyPermissions
  /** Optional scopes for fine-grained access control */
  scopes?: string[]
  /** Rate limit configuration */
  rateLimit?: ApiKeyRateLimitConfig
  /** Creation timestamp */
  created: number
  /** Expiration timestamp (optional) */
  expiresAt?: number
  /** Revocation timestamp (set when key is revoked) */
  revokedAt?: number
  /** Reason for revocation */
  revokedReason?: string
  /** Rotation timestamp (set when key is rotated) */
  rotatedAt?: number
  /** Last modification timestamp */
  lastModified?: number
  /** Last usage timestamp */
  lastUsed?: number
  /** Total usage count */
  usageCount?: number
}

/**
 * Options for creating a new API key
 */
export interface CreateApiKeyOptions {
  /** Owner ID (user or organization) */
  ownerId: string
  /** Human-readable name for the key */
  name: string
  /** Permissions to grant (defaults to invoke-only) */
  permissions?: ApiKeyPermissions
  /** Optional scopes for fine-grained access control */
  scopes?: string[]
  /** Rate limit configuration */
  rateLimit?: ApiKeyRateLimitConfig
  /** Expiration timestamp */
  expiresAt?: number
}

/**
 * Result of creating a new API key
 */
export interface CreateApiKeyResult {
  /** The raw API key (only returned once at creation) */
  apiKey: string
  /** The hash of the API key (used for lookups) */
  keyHash: string
  /** The metadata stored with the key */
  metadata: ApiKeyMetadata
}

/**
 * Result of validating an API key
 */
export interface ValidateApiKeyResult {
  /** Whether the key is valid */
  valid: boolean
  /** The key metadata (if valid) */
  metadata?: ApiKeyMetadata
  /** Error message (if invalid) */
  error?: string
}

/**
 * Rate limit information for an API key
 */
export interface ApiKeyRateLimitInfo {
  /** Number of requests made in current window */
  requestCount: number
  /** When the current window started */
  windowStart: number
}

/**
 * Result of checking rate limit
 */
export interface RateLimitCheckResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Remaining requests in the window */
  remaining?: number
  /** When the rate limit resets */
  resetAt?: number
}

/**
 * Options for key rotation
 */
export interface RotateKeyOptions {
  /** Grace period in ms during which old key still works */
  gracePeriodMs?: number
}

/**
 * Result of key rotation
 */
export interface RotateKeyResult {
  /** The new API key */
  newApiKey: string
  /** The hash of the new key */
  newKeyHash: string
  /** The new key metadata */
  metadata: ApiKeyMetadata
}

/**
 * Options for listing keys
 */
export interface ListKeysOptions {
  /** Maximum number of keys to return */
  limit?: number
  /** Cursor for pagination */
  cursor?: string
  /** Whether to include revoked keys */
  includeRevoked?: boolean
}

/**
 * Result of listing keys
 */
export interface ListKeysResult {
  /** The keys found */
  keys: Array<{ keyHash: string; metadata: ApiKeyMetadata }>
  /** Cursor for next page (if more results) */
  cursor?: string
}

/**
 * Options for revoking a key
 */
export interface RevokeKeyOptions {
  /** Reason for revocation */
  reason?: string
}

/**
 * Fields that can be updated on a key
 */
export interface UpdateApiKeyMetadata {
  /** New name for the key */
  name?: string
  /** New permissions */
  permissions?: ApiKeyPermissions
  /** New scopes */
  scopes?: string[]
  /** New rate limit configuration */
  rateLimit?: ApiKeyRateLimitConfig
}

/**
 * Hash an API key using SHA-256
 *
 * @param apiKey - The raw API key to hash
 * @returns The hex-encoded SHA-256 hash
 */
export async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(apiKey)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate a random API key with fnk_ prefix
 */
function generateApiKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = 'fnk_'
  const randomBytes = new Uint8Array(32)
  crypto.getRandomValues(randomBytes)
  for (let i = 0; i < 32; i++) {
    result += chars[randomBytes[i] % chars.length]
  }
  return result
}

/**
 * Validate API key format (must start with fnk_ and have correct length)
 */
function isValidKeyFormat(apiKey: string): boolean {
  return /^fnk_[a-zA-Z0-9]{32}$/.test(apiKey)
}

/**
 * KV-backed API Key Store
 *
 * Manages API keys using Cloudflare Workers KV for persistent storage.
 */
export class KVApiKeyStore {
  constructor(private kv: KVNamespace) {}

  /**
   * Create a new API key
   */
  async create(options: CreateApiKeyOptions): Promise<CreateApiKeyResult> {
    const apiKey = generateApiKey()
    const keyHash = await hashApiKey(apiKey)

    const metadata: ApiKeyMetadata = {
      ownerId: options.ownerId,
      name: options.name,
      permissions: options.permissions ?? {
        invoke: true,
        manage: false,
        admin: false,
      },
      created: Date.now(),
    }

    if (options.scopes) {
      metadata.scopes = options.scopes
    }
    if (options.rateLimit) {
      metadata.rateLimit = options.rateLimit
    }
    if (options.expiresAt) {
      metadata.expiresAt = options.expiresAt
    }

    // Store the key metadata
    await this.kv.put(`keys:${keyHash}`, JSON.stringify(metadata))

    // Store owner index
    await this.kv.put(`owner:${options.ownerId}:keys:${keyHash}`, '')

    // Initialize rate limit tracking if configured
    if (options.rateLimit) {
      const rateLimitInfo: ApiKeyRateLimitInfo = {
        requestCount: 0,
        windowStart: Date.now(),
      }
      await this.kv.put(`ratelimit:${keyHash}`, JSON.stringify(rateLimitInfo))
    }

    return {
      apiKey,
      keyHash,
      metadata,
    }
  }

  /**
   * Validate an API key
   */
  async validate(apiKey: string): Promise<ValidateApiKeyResult> {
    // Check key format first
    if (!isValidKeyFormat(apiKey)) {
      return { valid: false, error: 'Invalid key format' }
    }

    const keyHash = await hashApiKey(apiKey)
    const metadata = await this.getMetadata(keyHash)

    if (!metadata) {
      return { valid: false, error: 'Key not found' }
    }

    // Check if key has been rotated (without grace period or grace period expired)
    if (metadata.rotatedAt) {
      // If there's a grace period expiration, check if it's still valid
      if (metadata.expiresAt && Date.now() < metadata.expiresAt) {
        // Key is in grace period, still valid
        return { valid: true, metadata }
      }
      return { valid: false, error: 'Key rotated' }
    }

    // Check if key has been revoked
    if (metadata.revokedAt) {
      return { valid: false, error: 'Key revoked' }
    }

    // Check if key has expired
    if (metadata.expiresAt && Date.now() > metadata.expiresAt) {
      return { valid: false, error: 'Key expired' }
    }

    return { valid: true, metadata }
  }

  /**
   * Get metadata for a key by its hash
   */
  async getMetadata(keyHash: string): Promise<ApiKeyMetadata | null> {
    const data = await this.kv.get(`keys:${keyHash}`, 'json')
    return data as ApiKeyMetadata | null
  }

  /**
   * Get key info by hash
   */
  async getByHash(keyHash: string): Promise<{ keyHash: string; metadata: ApiKeyMetadata } | null> {
    const metadata = await this.getMetadata(keyHash)
    if (!metadata) {
      return null
    }
    return { keyHash, metadata }
  }

  /**
   * Get rate limit info for a key
   */
  async getRateLimitInfo(keyHash: string): Promise<ApiKeyRateLimitInfo | null> {
    const data = await this.kv.get(`ratelimit:${keyHash}`, 'json')
    return data as ApiKeyRateLimitInfo | null
  }

  /**
   * Increment rate limit counter for a key
   */
  async incrementRateLimit(keyHash: string): Promise<void> {
    const metadata = await this.getMetadata(keyHash)
    if (!metadata?.rateLimit) {
      return
    }

    let info = await this.getRateLimitInfo(keyHash)
    const now = Date.now()

    // Reset window if expired
    if (!info || now - info.windowStart >= metadata.rateLimit.windowMs) {
      info = {
        requestCount: 1,
        windowStart: now,
      }
    } else {
      info.requestCount++
    }

    await this.kv.put(`ratelimit:${keyHash}`, JSON.stringify(info))
  }

  /**
   * Check if a key has exceeded its rate limit
   */
  async checkRateLimit(keyHash: string): Promise<RateLimitCheckResult> {
    const metadata = await this.getMetadata(keyHash)

    // No rate limit configured - unlimited
    if (!metadata?.rateLimit) {
      return { allowed: true }
    }

    let info = await this.getRateLimitInfo(keyHash)
    const now = Date.now()

    // If no info or window expired, reset and allow
    if (!info || now - info.windowStart >= metadata.rateLimit.windowMs) {
      return {
        allowed: true,
        remaining: metadata.rateLimit.maxRequests,
        resetAt: now + metadata.rateLimit.windowMs,
      }
    }

    const remaining = Math.max(0, metadata.rateLimit.maxRequests - info.requestCount)
    const resetAt = info.windowStart + metadata.rateLimit.windowMs

    return {
      allowed: remaining > 0,
      remaining,
      resetAt,
    }
  }

  /**
   * Rotate an API key (create new, invalidate old)
   */
  async rotate(keyHash: string, options?: RotateKeyOptions): Promise<RotateKeyResult> {
    const oldMetadata = await this.getMetadata(keyHash)
    if (!oldMetadata) {
      throw new Error('Key not found')
    }

    // Create new key with same metadata
    const newApiKey = generateApiKey()
    const newKeyHash = await hashApiKey(newApiKey)

    const newMetadata: ApiKeyMetadata = {
      ownerId: oldMetadata.ownerId,
      name: oldMetadata.name,
      permissions: oldMetadata.permissions,
      created: Date.now(),
    }

    if (oldMetadata.scopes) {
      newMetadata.scopes = oldMetadata.scopes
    }
    if (oldMetadata.rateLimit) {
      newMetadata.rateLimit = oldMetadata.rateLimit
    }

    // Store new key
    await this.kv.put(`keys:${newKeyHash}`, JSON.stringify(newMetadata))

    // Update owner index - remove old, add new
    await this.kv.delete(`owner:${oldMetadata.ownerId}:keys:${keyHash}`)
    await this.kv.put(`owner:${oldMetadata.ownerId}:keys:${newKeyHash}`, '')

    // Initialize rate limit for new key if needed
    if (oldMetadata.rateLimit) {
      const rateLimitInfo: ApiKeyRateLimitInfo = {
        requestCount: 0,
        windowStart: Date.now(),
      }
      await this.kv.put(`ratelimit:${newKeyHash}`, JSON.stringify(rateLimitInfo))
    }

    // Mark old key as rotated
    const updatedOldMetadata: ApiKeyMetadata = {
      ...oldMetadata,
      rotatedAt: Date.now(),
    }

    // If grace period specified, set expiration on old key
    if (options?.gracePeriodMs) {
      updatedOldMetadata.expiresAt = Date.now() + options.gracePeriodMs
    }

    await this.kv.put(`keys:${keyHash}`, JSON.stringify(updatedOldMetadata))

    return {
      newApiKey,
      newKeyHash,
      metadata: newMetadata,
    }
  }

  /**
   * List all keys for an owner
   */
  async listByOwner(ownerId: string, options?: ListKeysOptions): Promise<ListKeysResult | Array<{ keyHash: string; metadata: ApiKeyMetadata }>> {
    const limit = options?.limit ?? 1000
    const cursor = options?.cursor
    const includeRevoked = options?.includeRevoked ?? true

    const listOptions: KVNamespaceListOptions = {
      prefix: `owner:${ownerId}:keys:`,
      limit,
    }
    if (cursor !== undefined) {
      listOptions.cursor = cursor
    }

    const listResult = await this.kv.list(listOptions)

    const keys: Array<{ keyHash: string; metadata: ApiKeyMetadata }> = []

    for (const key of listResult.keys) {
      // Extract keyHash from the key name (owner:{ownerId}:keys:{keyHash})
      const keyHash = key.name.replace(`owner:${ownerId}:keys:`, '')
      const metadata = await this.getMetadata(keyHash)

      if (metadata) {
        // Filter out revoked keys if requested
        if (!includeRevoked && metadata.revokedAt) {
          continue
        }
        keys.push({ keyHash, metadata })
      }
    }

    // Check if options were passed to determine return type
    if (options?.limit !== undefined || options?.cursor !== undefined || options?.includeRevoked !== undefined) {
      const result: ListKeysResult = { keys }
      if (!listResult.list_complete) {
        result.cursor = listResult.cursor
      }
      return result
    }

    // Return simple array for backward compatibility with tests that don't pass options
    return keys
  }

  /**
   * Revoke an API key
   */
  async revoke(keyHash: string, options?: RevokeKeyOptions): Promise<void> {
    const metadata = await this.getMetadata(keyHash)
    if (!metadata) {
      throw new Error('Key not found')
    }

    // Already revoked - idempotent
    if (metadata.revokedAt) {
      return
    }

    const updatedMetadata: ApiKeyMetadata = {
      ...metadata,
      revokedAt: Date.now(),
    }

    if (options?.reason) {
      updatedMetadata.revokedReason = options.reason
    }

    await this.kv.put(`keys:${keyHash}`, JSON.stringify(updatedMetadata))
  }

  /**
   * Permanently delete an API key
   */
  async delete(keyHash: string): Promise<void> {
    const metadata = await this.getMetadata(keyHash)

    // Delete key data
    await this.kv.delete(`keys:${keyHash}`)
    await this.kv.delete(`ratelimit:${keyHash}`)

    // Delete owner index entry if we have metadata
    if (metadata) {
      await this.kv.delete(`owner:${metadata.ownerId}:keys:${keyHash}`)
    }
  }

  /**
   * Update key metadata
   */
  async updateMetadata(keyHash: string, updates: UpdateApiKeyMetadata): Promise<void> {
    const metadata = await this.getMetadata(keyHash)
    if (!metadata) {
      throw new Error('Key not found')
    }

    // Check for forbidden updates
    if ('ownerId' in updates) {
      throw new Error('Cannot change key owner')
    }

    const updatedMetadata: ApiKeyMetadata = {
      ...metadata,
      lastModified: Date.now(),
    }

    if (updates.name !== undefined) {
      updatedMetadata.name = updates.name
    }
    if (updates.permissions !== undefined) {
      updatedMetadata.permissions = updates.permissions
    }
    if (updates.scopes !== undefined) {
      updatedMetadata.scopes = updates.scopes
    }
    if (updates.rateLimit !== undefined) {
      updatedMetadata.rateLimit = updates.rateLimit
    }

    await this.kv.put(`keys:${keyHash}`, JSON.stringify(updatedMetadata))
  }

  /**
   * Record usage of an API key
   */
  async recordUsage(keyHash: string): Promise<void> {
    const metadata = await this.getMetadata(keyHash)
    if (!metadata) {
      // Silently ignore non-existent keys for resilience
      return
    }

    const updatedMetadata: ApiKeyMetadata = {
      ...metadata,
      lastUsed: Date.now(),
      usageCount: (metadata.usageCount ?? 0) + 1,
    }

    await this.kv.put(`keys:${keyHash}`, JSON.stringify(updatedMetadata))
  }
}
