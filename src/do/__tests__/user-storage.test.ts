/**
 * Tests for UserStorage Durable Object
 *
 * Tests the core functionality of the per-user storage DO that
 * replaces KV-based storage.
 *
 * Uses the cloudflare vitest-pool-workers to get real DO instances
 * and tests RPC method invocation.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import type { UserStorage } from '../user-storage'
import type { ApiKeyMetadata } from '../user-storage'

describe('UserStorage', () => {
  let stub: DurableObjectStub<UserStorage>
  let testUserId: string

  beforeEach(() => {
    // Create a unique user ID for each test to ensure isolation
    testUserId = `test-user-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const id = env.USER_STORAGE.idFromName(testUserId)
    stub = env.USER_STORAGE.get(id)
  })

  describe('Function Registry (RPC)', () => {
    it('should store and retrieve function metadata via RPC', async () => {
      const metadata = {
        id: 'test-function',
        version: '1.0.0',
        name: 'Test Function',
        type: 'code' as const,
        language: 'typescript' as const,
      }

      await stub.putFunction(metadata)
      const result = await stub.getFunction('test-function')

      expect(result).toBeDefined()
      expect(result?.id).toBe('test-function')
      expect(result?.name).toBe('Test Function')
    })

    it('should list functions with pagination via RPC', async () => {
      // Add some functions first
      await stub.putFunction({
        id: 'fn-1',
        version: '1.0.0',
        name: 'Function 1',
      })
      await stub.putFunction({
        id: 'fn-2',
        version: '1.0.0',
        name: 'Function 2',
      })

      const result = await stub.listFunctions({ limit: 10 })

      expect(result).toBeDefined()
      expect(result.items).toBeDefined()
      expect(result.items.length).toBeGreaterThanOrEqual(2)
    })

    it('should delete function and related data via RPC', async () => {
      const metadata = {
        id: 'to-delete',
        version: '1.0.0',
        name: 'To Delete',
        type: 'code' as const,
      }

      await stub.putFunction(metadata)
      await stub.deleteFunction('to-delete')

      // Function should be deleted
      const result = await stub.getFunction('to-delete')
      expect(result).toBeNull()
    })

    it('should store and retrieve function versions via RPC', async () => {
      const metadata = {
        id: 'versioned-fn',
        version: '1.0.0',
        name: 'Versioned Function',
      }

      await stub.putFunctionVersion('versioned-fn', '1.0.0', metadata)
      const result = await stub.getFunctionVersion('versioned-fn', '1.0.0')

      expect(result).toBeDefined()
      expect(result?.version).toBe('1.0.0')
    })

    it('should list function versions via RPC', async () => {
      await stub.putFunctionVersion('multi-version-fn', '1.0.0', {
        id: 'multi-version-fn',
        version: '1.0.0',
        name: 'Multi Version Function',
      })
      await stub.putFunctionVersion('multi-version-fn', '2.0.0', {
        id: 'multi-version-fn',
        version: '2.0.0',
        name: 'Multi Version Function',
      })

      const versions = await stub.listFunctionVersions('multi-version-fn')

      expect(versions).toBeDefined()
      expect(Array.isArray(versions)).toBe(true)
      expect(versions.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Code Storage (RPC)', () => {
    it('should store and retrieve code via RPC', async () => {
      await stub.putCode('test-fn', 'export default {}')
      const code = await stub.getCode('test-fn')

      expect(code).toBe('export default {}')
    })

    it('should store and retrieve versioned code via RPC', async () => {
      await stub.putCode('test-fn', 'v1 code', '1.0.0')
      await stub.putCode('test-fn', 'v2 code', '2.0.0')

      const v1 = await stub.getCode('test-fn', '1.0.0')
      const v2 = await stub.getCode('test-fn', '2.0.0')

      expect(v1).toBe('v1 code')
      expect(v2).toBe('v2 code')
    })

    it('should store and retrieve compiled code via RPC', async () => {
      await stub.putCompiledCode('test-fn', 'compiled code')
      const compiled = await stub.getCompiledCode('test-fn')

      expect(compiled).toBe('compiled code')
    })

    it('should store and retrieve source maps via RPC', async () => {
      await stub.putSourceMap('test-fn', '{"version":3}')
      const sourceMap = await stub.getSourceMap('test-fn')

      expect(sourceMap).toBe('{"version":3}')
    })

    it('should list code versions via RPC', async () => {
      await stub.putCode('versioned-code-fn', 'v1', '1.0.0')
      await stub.putCode('versioned-code-fn', 'v2', '2.0.0')

      const versions = await stub.listCodeVersions('versioned-code-fn')

      expect(versions).toBeDefined()
      expect(Array.isArray(versions)).toBe(true)
      expect(versions.length).toBeGreaterThanOrEqual(2)
    })

    it('should delete all code for a function via RPC', async () => {
      await stub.putCode('delete-all-fn', 'v1', '1.0.0')
      await stub.putCode('delete-all-fn', 'v2', '2.0.0')
      await stub.deleteAllCode('delete-all-fn')

      const v1 = await stub.getCode('delete-all-fn', '1.0.0')
      const v2 = await stub.getCode('delete-all-fn', '2.0.0')

      expect(v1).toBeNull()
      expect(v2).toBeNull()
    })

    it('should delete specific code version via RPC', async () => {
      await stub.putCode('delete-version-fn', 'v1', '1.0.0')
      await stub.putCode('delete-version-fn', 'v2', '2.0.0')
      await stub.deleteCode('delete-version-fn', '1.0.0')

      const v1 = await stub.getCode('delete-version-fn', '1.0.0')
      const v2 = await stub.getCode('delete-version-fn', '2.0.0')

      expect(v1).toBeNull()
      expect(v2).toBe('v2')
    })
  })

  describe('API Keys (RPC)', () => {
    it('should store and retrieve API keys via RPC', async () => {
      const keyMetadata: Omit<ApiKeyMetadata, 'keyHash'> = {
        name: 'Test Key',
        permissions: { invoke: true, manage: false, admin: false },
        created: Date.now(),
      }

      await stub.putApiKey('test-hash', keyMetadata)
      const result = await stub.getApiKey('test-hash')

      expect(result).toBeDefined()
      expect(result?.name).toBe('Test Key')
      expect(result?.keyHash).toBe('test-hash')
    })

    it('should list API keys via RPC', async () => {
      await stub.putApiKey('list-key-1', {
        name: 'Key 1',
        permissions: { invoke: true, manage: false, admin: false },
        created: Date.now(),
      })
      await stub.putApiKey('list-key-2', {
        name: 'Key 2',
        permissions: { invoke: true, manage: false, admin: false },
        created: Date.now(),
      })

      const keys = await stub.listApiKeys()

      expect(keys).toBeDefined()
      expect(Array.isArray(keys)).toBe(true)
      expect(keys.length).toBeGreaterThanOrEqual(2)
    })

    it('should delete API keys via RPC', async () => {
      const keyMetadata: Omit<ApiKeyMetadata, 'keyHash'> = {
        name: 'To Delete',
        permissions: { invoke: true, manage: false, admin: false },
        created: Date.now(),
      }

      await stub.putApiKey('to-delete-hash', keyMetadata)
      await stub.deleteApiKey('to-delete-hash')

      const result = await stub.getApiKey('to-delete-hash')
      expect(result).toBeNull()
    })

    it('should check rate limits via RPC', async () => {
      const result = await stub.checkRateLimit('nonexistent')

      // Without rate limit config, should always allow
      expect(result.allowed).toBe(true)
    })

    it('should record API key usage via RPC', async () => {
      await stub.putApiKey('usage-key', {
        name: 'Usage Key',
        permissions: { invoke: true, manage: false, admin: false },
        created: Date.now(),
        usageCount: 0,
      })

      await stub.recordApiKeyUsage('usage-key')
      await stub.recordApiKeyUsage('usage-key')

      const key = await stub.getApiKey('usage-key')
      expect(key?.usageCount).toBe(2)
    })
  })

  describe('HTTP Handler (Deprecated)', () => {
    it('should return deprecation message for HTTP requests', async () => {
      const request = new Request('http://test/functions')
      const response = await stub.fetch(request)

      expect(response.status).toBe(400)
      const body = await response.json() as { error: string; message: string }
      expect(body.error).toContain('deprecated')
    })

    it('should return 501 for WebSocket upgrade requests', async () => {
      const request = new Request('http://test/functions', {
        headers: { 'Upgrade': 'websocket' },
      })
      const response = await stub.fetch(request)
      // Consume the response to avoid storage isolation issues
      await response.text()

      expect(response.status).toBe(501)
    })
  })
})
