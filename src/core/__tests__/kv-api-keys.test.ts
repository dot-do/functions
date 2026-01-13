/**
 * KV API Key Store Tests
 *
 * Tests for the FUNCTIONS_API_KEYS KV namespace operations including:
 * - Storing API keys with metadata (keys:{keyHash})
 * - Validating API keys
 * - Key metadata (owner, permissions, created, expires)
 * - Rate limit tracking per key
 * - Key rotation (new key, invalidate old)
 * - Listing keys for an owner
 * - Revoking keys
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockKV } from '../../test-utils/mock-kv'
import {
  KVApiKeyStore,
  type ApiKeyMetadata,
  type ApiKeyPermissions,
  type ApiKeyRateLimitInfo,
  type CreateApiKeyOptions,
  type CreateApiKeyResult,
  hashApiKey,
} from '../kv-api-keys'

describe('KVApiKeyStore', () => {
  let store: KVApiKeyStore
  let mockKV: KVNamespace

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
    mockKV = createMockKV()
    store = new KVApiKeyStore(mockKV)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('hashApiKey()', () => {
    it('should produce consistent hash for same input', async () => {
      const key = 'fnk_test123456789'
      const hash1 = await hashApiKey(key)
      const hash2 = await hashApiKey(key)

      expect(hash1).toBe(hash2)
    })

    it('should produce different hashes for different inputs', async () => {
      const hash1 = await hashApiKey('fnk_key1')
      const hash2 = await hashApiKey('fnk_key2')

      expect(hash1).not.toBe(hash2)
    })

    it('should produce a hex string of correct length', async () => {
      const hash = await hashApiKey('fnk_testkey')

      // SHA-256 produces 64 hex characters
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe('create()', () => {
    it('should create an API key with default permissions', async () => {
      const options: CreateApiKeyOptions = {
        ownerId: 'user_123',
        name: 'Test Key',
      }

      const result = await store.create(options)

      expect(result.apiKey).toMatch(/^fnk_[a-zA-Z0-9]{32}$/)
      expect(result.keyHash).toBeDefined()
      expect(result.metadata.ownerId).toBe('user_123')
      expect(result.metadata.name).toBe('Test Key')
      expect(result.metadata.created).toBe(Date.now())
      expect(result.metadata.permissions).toEqual({
        invoke: true,
        manage: false,
        admin: false,
      })
    })

    it('should create an API key with custom permissions', async () => {
      const options: CreateApiKeyOptions = {
        ownerId: 'user_123',
        name: 'Admin Key',
        permissions: {
          invoke: true,
          manage: true,
          admin: true,
        },
      }

      const result = await store.create(options)

      expect(result.metadata.permissions).toEqual({
        invoke: true,
        manage: true,
        admin: true,
      })
    })

    it('should create an API key with expiration', async () => {
      const expiresAt = Date.now() + 86400000 // 24 hours from now

      const options: CreateApiKeyOptions = {
        ownerId: 'user_123',
        name: 'Expiring Key',
        expiresAt,
      }

      const result = await store.create(options)

      expect(result.metadata.expiresAt).toBe(expiresAt)
    })

    it('should store the key hash in KV with correct prefix', async () => {
      const result = await store.create({
        ownerId: 'user_123',
        name: 'Test Key',
      })

      const storedData = await mockKV.get(`keys:${result.keyHash}`, 'json')
      expect(storedData).toBeDefined()
    })

    it('should store owner index for key lookup', async () => {
      const result = await store.create({
        ownerId: 'user_123',
        name: 'Test Key',
      })

      const ownerKeys = await mockKV.list({ prefix: 'owner:user_123:keys:' })
      expect(ownerKeys.keys.length).toBe(1)
    })

    it('should include optional scopes in metadata', async () => {
      const options: CreateApiKeyOptions = {
        ownerId: 'user_123',
        name: 'Scoped Key',
        scopes: ['function:read', 'function:execute'],
      }

      const result = await store.create(options)

      expect(result.metadata.scopes).toEqual(['function:read', 'function:execute'])
    })

    it('should include optional rate limit config', async () => {
      const options: CreateApiKeyOptions = {
        ownerId: 'user_123',
        name: 'Rate Limited Key',
        rateLimit: {
          maxRequests: 100,
          windowMs: 60000,
        },
      }

      const result = await store.create(options)

      expect(result.metadata.rateLimit).toEqual({
        maxRequests: 100,
        windowMs: 60000,
      })
    })
  })

  describe('validate()', () => {
    it('should validate a valid API key', async () => {
      const { apiKey, metadata } = await store.create({
        ownerId: 'user_123',
        name: 'Valid Key',
      })

      const result = await store.validate(apiKey)

      expect(result.valid).toBe(true)
      expect(result.metadata).toBeDefined()
      expect(result.metadata?.ownerId).toBe('user_123')
    })

    it('should reject an invalid API key', async () => {
      // Key with valid format (fnk_ + 32 chars) but not in store
      const result = await store.validate('fnk_abcdefghijklmnopqrstuvwxyz123456')

      expect(result.valid).toBe(false)
      expect(result.metadata).toBeUndefined()
      expect(result.error).toBe('Key not found')
    })

    it('should reject an expired API key', async () => {
      const expiresAt = Date.now() + 3600000 // 1 hour from now

      const { apiKey } = await store.create({
        ownerId: 'user_123',
        name: 'Expiring Key',
        expiresAt,
      })

      // Advance time past expiration
      vi.advanceTimersByTime(3600001)

      const result = await store.validate(apiKey)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Key expired')
    })

    it('should reject a revoked API key', async () => {
      const { apiKey, keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Key to revoke',
      })

      await store.revoke(keyHash)

      const result = await store.validate(apiKey)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Key revoked')
    })

    it('should validate key format before lookup', async () => {
      const result = await store.validate('invalid-format')

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid key format')
    })
  })

  describe('getMetadata()', () => {
    it('should retrieve metadata for a key hash', async () => {
      const { keyHash, metadata: createdMeta } = await store.create({
        ownerId: 'user_123',
        name: 'Test Key',
      })

      const metadata = await store.getMetadata(keyHash)

      expect(metadata).toBeDefined()
      expect(metadata?.ownerId).toBe('user_123')
      expect(metadata?.name).toBe('Test Key')
    })

    it('should return null for non-existent key hash', async () => {
      const metadata = await store.getMetadata('nonexistent_hash')

      expect(metadata).toBeNull()
    })

    it('should include all metadata fields', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Full Key',
        permissions: { invoke: true, manage: true, admin: false },
        scopes: ['scope1'],
        expiresAt: Date.now() + 86400000,
        rateLimit: { maxRequests: 50, windowMs: 30000 },
      })

      const metadata = await store.getMetadata(keyHash)

      expect(metadata).toMatchObject({
        ownerId: 'user_123',
        name: 'Full Key',
        permissions: { invoke: true, manage: true, admin: false },
        scopes: ['scope1'],
        rateLimit: { maxRequests: 50, windowMs: 30000 },
      })
      expect(metadata?.created).toBeDefined()
      expect(metadata?.expiresAt).toBeDefined()
    })
  })

  describe('Rate Limit Tracking', () => {
    it('should initialize rate limit tracking for a key', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Rate Limited Key',
        rateLimit: { maxRequests: 10, windowMs: 60000 },
      })

      const info = await store.getRateLimitInfo(keyHash)

      expect(info).toBeDefined()
      expect(info?.requestCount).toBe(0)
      expect(info?.windowStart).toBeDefined()
    })

    it('should track requests against rate limit', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Rate Limited Key',
        rateLimit: { maxRequests: 10, windowMs: 60000 },
      })

      await store.incrementRateLimit(keyHash)
      await store.incrementRateLimit(keyHash)
      await store.incrementRateLimit(keyHash)

      const info = await store.getRateLimitInfo(keyHash)

      expect(info?.requestCount).toBe(3)
    })

    it('should check if rate limit is exceeded', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Rate Limited Key',
        rateLimit: { maxRequests: 3, windowMs: 60000 },
      })

      await store.incrementRateLimit(keyHash)
      await store.incrementRateLimit(keyHash)
      await store.incrementRateLimit(keyHash)

      const result = await store.checkRateLimit(keyHash)

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('should reset rate limit after window expires', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Rate Limited Key',
        rateLimit: { maxRequests: 3, windowMs: 60000 },
      })

      await store.incrementRateLimit(keyHash)
      await store.incrementRateLimit(keyHash)
      await store.incrementRateLimit(keyHash)

      // Advance time past the window
      vi.advanceTimersByTime(60001)

      const result = await store.checkRateLimit(keyHash)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(3)
    })

    it('should return unlimited for keys without rate limit config', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Unlimited Key',
      })

      const result = await store.checkRateLimit(keyHash)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBeUndefined()
    })
  })

  describe('Key Rotation', () => {
    it('should rotate a key and return new credentials', async () => {
      const { keyHash: oldKeyHash, apiKey: oldApiKey } = await store.create({
        ownerId: 'user_123',
        name: 'Key to Rotate',
      })

      const rotationResult = await store.rotate(oldKeyHash)

      expect(rotationResult.newApiKey).toBeDefined()
      expect(rotationResult.newApiKey).not.toBe(oldApiKey)
      expect(rotationResult.newKeyHash).toBeDefined()
      expect(rotationResult.newKeyHash).not.toBe(oldKeyHash)
    })

    it('should preserve metadata during rotation', async () => {
      const { keyHash: oldKeyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Key to Rotate',
        permissions: { invoke: true, manage: true, admin: false },
        scopes: ['scope1', 'scope2'],
      })

      const rotationResult = await store.rotate(oldKeyHash)
      const newMetadata = await store.getMetadata(rotationResult.newKeyHash)

      expect(newMetadata?.ownerId).toBe('user_123')
      expect(newMetadata?.name).toBe('Key to Rotate')
      expect(newMetadata?.permissions).toEqual({ invoke: true, manage: true, admin: false })
      expect(newMetadata?.scopes).toEqual(['scope1', 'scope2'])
    })

    it('should invalidate old key after rotation', async () => {
      const { keyHash: oldKeyHash, apiKey: oldApiKey } = await store.create({
        ownerId: 'user_123',
        name: 'Key to Rotate',
      })

      await store.rotate(oldKeyHash)

      const validationResult = await store.validate(oldApiKey)

      expect(validationResult.valid).toBe(false)
      expect(validationResult.error).toBe('Key rotated')
    })

    it('should update owner index during rotation', async () => {
      const { keyHash: oldKeyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Key to Rotate',
      })

      const { newKeyHash } = await store.rotate(oldKeyHash)

      const ownerKeys = await store.listByOwner('user_123')

      expect(ownerKeys.some((k) => k.keyHash === newKeyHash)).toBe(true)
      expect(ownerKeys.some((k) => k.keyHash === oldKeyHash)).toBe(false)
    })

    it('should allow optional grace period for old key', async () => {
      const { keyHash: oldKeyHash, apiKey: oldApiKey } = await store.create({
        ownerId: 'user_123',
        name: 'Key to Rotate',
      })

      await store.rotate(oldKeyHash, { gracePeriodMs: 300000 }) // 5 minute grace

      // Old key should still work during grace period
      const validationResult = await store.validate(oldApiKey)
      expect(validationResult.valid).toBe(true)

      // After grace period, old key should be invalid
      vi.advanceTimersByTime(300001)

      const expiredResult = await store.validate(oldApiKey)
      expect(expiredResult.valid).toBe(false)
    })

    it('should update rotatedAt timestamp on old key', async () => {
      const { keyHash: oldKeyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Key to Rotate',
      })

      const now = Date.now()
      await store.rotate(oldKeyHash)

      const oldMetadata = await store.getMetadata(oldKeyHash)
      expect(oldMetadata?.rotatedAt).toBe(now)
    })

    it('should throw error when rotating non-existent key', async () => {
      await expect(store.rotate('nonexistent_hash')).rejects.toThrow('Key not found')
    })
  })

  describe('listByOwner()', () => {
    it('should list all keys for an owner', async () => {
      await store.create({ ownerId: 'user_123', name: 'Key 1' })
      await store.create({ ownerId: 'user_123', name: 'Key 2' })
      await store.create({ ownerId: 'user_123', name: 'Key 3' })

      const keys = await store.listByOwner('user_123')

      expect(keys).toHaveLength(3)
      expect(keys.map((k) => k.metadata.name)).toContain('Key 1')
      expect(keys.map((k) => k.metadata.name)).toContain('Key 2')
      expect(keys.map((k) => k.metadata.name)).toContain('Key 3')
    })

    it('should return empty array for owner with no keys', async () => {
      const keys = await store.listByOwner('user_with_no_keys')

      expect(keys).toEqual([])
    })

    it('should not include keys from other owners', async () => {
      await store.create({ ownerId: 'user_123', name: 'User 123 Key' })
      await store.create({ ownerId: 'user_456', name: 'User 456 Key' })

      const keys = await store.listByOwner('user_123')

      expect(keys).toHaveLength(1)
      expect(keys[0].metadata.name).toBe('User 123 Key')
    })

    it('should include key hash and metadata in results', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Test Key',
        permissions: { invoke: true, manage: false, admin: false },
      })

      const keys = await store.listByOwner('user_123')

      expect(keys[0].keyHash).toBe(keyHash)
      expect(keys[0].metadata.ownerId).toBe('user_123')
      expect(keys[0].metadata.name).toBe('Test Key')
      expect(keys[0].metadata.permissions).toBeDefined()
    })

    it('should support pagination', async () => {
      for (let i = 0; i < 25; i++) {
        await store.create({ ownerId: 'user_123', name: `Key ${i}` })
      }

      const page1 = await store.listByOwner('user_123', { limit: 10 })
      const page2 = await store.listByOwner('user_123', { limit: 10, cursor: page1.cursor })

      expect(page1.keys.length).toBe(10)
      expect(page2.keys.length).toBe(10)
      expect(page1.cursor).toBeDefined()
    })

    it('should optionally filter out revoked keys', async () => {
      const { keyHash: key1Hash } = await store.create({ ownerId: 'user_123', name: 'Active Key' })
      const { keyHash: key2Hash } = await store.create({ ownerId: 'user_123', name: 'Revoked Key' })

      await store.revoke(key2Hash)

      const activeKeys = await store.listByOwner('user_123', { includeRevoked: false })
      const allKeys = await store.listByOwner('user_123', { includeRevoked: true })

      expect(activeKeys.keys).toHaveLength(1)
      expect(allKeys.keys).toHaveLength(2)
    })
  })

  describe('revoke()', () => {
    it('should revoke an API key', async () => {
      const { keyHash, apiKey } = await store.create({
        ownerId: 'user_123',
        name: 'Key to Revoke',
      })

      await store.revoke(keyHash)

      const result = await store.validate(apiKey)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Key revoked')
    })

    it('should set revokedAt timestamp', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Key to Revoke',
      })

      const now = Date.now()
      await store.revoke(keyHash)

      const metadata = await store.getMetadata(keyHash)
      expect(metadata?.revokedAt).toBe(now)
    })

    it('should accept optional reason for revocation', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Key to Revoke',
      })

      await store.revoke(keyHash, { reason: 'Security breach detected' })

      const metadata = await store.getMetadata(keyHash)
      expect(metadata?.revokedReason).toBe('Security breach detected')
    })

    it('should be idempotent', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Key to Revoke',
      })

      await store.revoke(keyHash)
      await store.revoke(keyHash)

      const metadata = await store.getMetadata(keyHash)
      expect(metadata?.revokedAt).toBeDefined()
    })

    it('should throw error when revoking non-existent key', async () => {
      await expect(store.revoke('nonexistent_hash')).rejects.toThrow('Key not found')
    })

    it('should update owner index to mark key as revoked', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Key to Revoke',
      })

      await store.revoke(keyHash)

      const activeKeys = await store.listByOwner('user_123', { includeRevoked: false })
      expect(activeKeys.keys).toHaveLength(0)
    })
  })

  describe('delete()', () => {
    it('should permanently delete an API key', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Key to Delete',
      })

      await store.delete(keyHash)

      const metadata = await store.getMetadata(keyHash)
      expect(metadata).toBeNull()
    })

    it('should remove key from owner index', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Key to Delete',
      })

      await store.delete(keyHash)

      const keys = await store.listByOwner('user_123')
      expect(keys.keys).toHaveLength(0)
    })

    it('should handle deleting non-existent key gracefully', async () => {
      await expect(store.delete('nonexistent_hash')).resolves.toBeUndefined()
    })
  })

  describe('updateMetadata()', () => {
    it('should update key name', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Original Name',
      })

      await store.updateMetadata(keyHash, { name: 'Updated Name' })

      const metadata = await store.getMetadata(keyHash)
      expect(metadata?.name).toBe('Updated Name')
    })

    it('should update permissions', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Test Key',
        permissions: { invoke: true, manage: false, admin: false },
      })

      await store.updateMetadata(keyHash, {
        permissions: { invoke: true, manage: true, admin: false },
      })

      const metadata = await store.getMetadata(keyHash)
      expect(metadata?.permissions).toEqual({ invoke: true, manage: true, admin: false })
    })

    it('should update scopes', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Test Key',
        scopes: ['scope1'],
      })

      await store.updateMetadata(keyHash, { scopes: ['scope1', 'scope2', 'scope3'] })

      const metadata = await store.getMetadata(keyHash)
      expect(metadata?.scopes).toEqual(['scope1', 'scope2', 'scope3'])
    })

    it('should update rate limit config', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Test Key',
        rateLimit: { maxRequests: 10, windowMs: 60000 },
      })

      await store.updateMetadata(keyHash, {
        rateLimit: { maxRequests: 100, windowMs: 30000 },
      })

      const metadata = await store.getMetadata(keyHash)
      expect(metadata?.rateLimit).toEqual({ maxRequests: 100, windowMs: 30000 })
    })

    it('should not allow updating ownerId', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Test Key',
      })

      await expect(
        store.updateMetadata(keyHash, { ownerId: 'user_456' } as any)
      ).rejects.toThrow('Cannot change key owner')
    })

    it('should throw error for non-existent key', async () => {
      await expect(
        store.updateMetadata('nonexistent_hash', { name: 'New Name' })
      ).rejects.toThrow('Key not found')
    })

    it('should update lastModified timestamp', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Test Key',
      })

      vi.advanceTimersByTime(1000)

      await store.updateMetadata(keyHash, { name: 'Updated Name' })

      const metadata = await store.getMetadata(keyHash)
      expect(metadata?.lastModified).toBe(Date.now())
    })
  })

  describe('Key Format', () => {
    it('should generate keys with fnk_ prefix', async () => {
      const { apiKey } = await store.create({
        ownerId: 'user_123',
        name: 'Test Key',
      })

      expect(apiKey.startsWith('fnk_')).toBe(true)
    })

    it('should generate keys of correct length', async () => {
      const { apiKey } = await store.create({
        ownerId: 'user_123',
        name: 'Test Key',
      })

      // fnk_ prefix (4) + 32 random chars = 36 total
      expect(apiKey.length).toBe(36)
    })

    it('should use correct KV key prefix for storage', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Test Key',
      })

      const keys = await mockKV.list({ prefix: 'keys:' })
      expect(keys.keys.some((k) => k.name === `keys:${keyHash}`)).toBe(true)
    })
  })

  describe('getByHash()', () => {
    it('should retrieve key info by hash', async () => {
      const { keyHash, metadata: created } = await store.create({
        ownerId: 'user_123',
        name: 'Test Key',
      })

      const result = await store.getByHash(keyHash)

      expect(result).toBeDefined()
      expect(result?.keyHash).toBe(keyHash)
      expect(result?.metadata.name).toBe('Test Key')
    })

    it('should return null for non-existent hash', async () => {
      const result = await store.getByHash('nonexistent_hash')

      expect(result).toBeNull()
    })
  })

  describe('recordUsage()', () => {
    it('should record last used timestamp', async () => {
      const { keyHash, apiKey } = await store.create({
        ownerId: 'user_123',
        name: 'Test Key',
      })

      await store.recordUsage(keyHash)

      const metadata = await store.getMetadata(keyHash)
      expect(metadata?.lastUsed).toBe(Date.now())
    })

    it('should increment usage count', async () => {
      const { keyHash } = await store.create({
        ownerId: 'user_123',
        name: 'Test Key',
      })

      await store.recordUsage(keyHash)
      await store.recordUsage(keyHash)
      await store.recordUsage(keyHash)

      const metadata = await store.getMetadata(keyHash)
      expect(metadata?.usageCount).toBe(3)
    })

    it('should be resilient to non-existent keys', async () => {
      await expect(store.recordUsage('nonexistent_hash')).resolves.toBeUndefined()
    })
  })
})
