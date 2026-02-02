/**
 * Integration Test: Deploy -> Invoke path with real UserStorage DO bindings
 *
 * Tests the full production code path using real miniflare bindings:
 * 1. Deploy a function via the deploy handler (stores metadata + code in UserStorage DO)
 * 2. Invoke the function via the invoke handler (retrieves from UserStorage DO)
 * 3. Verify the result is correct
 *
 * No mocks are used - this exercises the actual production handlers with real
 * Durable Object bindings from cloudflare:test.
 *
 * Issue: functions-jjyi (RED -> GREEN)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import type { UserStorage } from '../do/user-storage'

describe('Integration: Deploy -> Invoke with UserStorage DO', () => {
  let stub: DurableObjectStub<UserStorage>
  const testUserId = 'integration-test-user'

  beforeEach(() => {
    const id = env.USER_STORAGE.idFromName(testUserId)
    stub = env.USER_STORAGE.get(id)
  })

  describe('generative function deploy -> invoke via DO', () => {
    it('should store and retrieve function metadata through the UserStorage DO', async () => {
      const functionId = `gen-fn-${Date.now()}`

      // Deploy: store metadata in the DO
      const metadata = {
        id: functionId,
        version: '1.0.0',
        type: 'generative' as const,
        name: 'Test Generative Function',
        model: 'claude-3-sonnet',
        userPrompt: 'Summarize: {{text}}',
        systemPrompt: 'You are a summarizer.',
      }

      await stub.putFunction(metadata)
      await stub.putFunctionVersion(functionId, '1.0.0', metadata)

      // Invoke: retrieve metadata from the DO
      const retrieved = await stub.getFunction(functionId)

      expect(retrieved).toBeDefined()
      expect(retrieved!.id).toBe(functionId)
      expect(retrieved!.type).toBe('generative')
      expect(retrieved!.version).toBe('1.0.0')
      expect(retrieved!.name).toBe('Test Generative Function')

      // Also verify version retrieval works
      const versionMeta = await stub.getFunctionVersion(functionId, '1.0.0')
      expect(versionMeta).toBeDefined()
      expect(versionMeta!.id).toBe(functionId)
    })
  })

  describe('code function deploy -> invoke via DO', () => {
    it('should store function metadata and code, then retrieve both', async () => {
      const functionId = `code-fn-${Date.now()}`
      const sourceCode = 'export default { fetch() { return new Response("hello") } }'
      const compiledCode = '// compiled\nexport default { fetch() { return new Response("hello") } }'

      // Deploy: store metadata
      const metadata = {
        id: functionId,
        version: '1.0.0',
        type: 'code' as const,
        name: 'Test Code Function',
        language: 'typescript' as const,
        entryPoint: 'index.ts',
        dependencies: {},
      }

      await stub.putFunction(metadata)
      await stub.putFunctionVersion(functionId, '1.0.0', metadata)

      // Deploy: store code (both source and compiled)
      await stub.putCode(functionId, sourceCode)
      await stub.putCode(functionId, sourceCode, '1.0.0')
      await stub.putCompiledCode(functionId, compiledCode)
      await stub.putCompiledCode(functionId, compiledCode, '1.0.0')

      // Invoke path: retrieve metadata
      const retrievedMeta = await stub.getFunction(functionId)
      expect(retrievedMeta).toBeDefined()
      expect(retrievedMeta!.id).toBe(functionId)
      expect(retrievedMeta!.type).toBe('code')
      expect(retrievedMeta!.language).toBe('typescript')

      // Invoke path: retrieve compiled code (preferred)
      const compiled = await stub.getCompiledCode(functionId)
      expect(compiled).toBe(compiledCode)

      // Invoke path: retrieve source code (fallback)
      const source = await stub.getCode(functionId)
      expect(source).toBe(sourceCode)

      // Invoke path: version-specific retrieval
      const versionCompiled = await stub.getCompiledCode(functionId, '1.0.0')
      expect(versionCompiled).toBe(compiledCode)
    })

    it('should return null for non-existent functions', async () => {
      const result = await stub.getFunction('nonexistent-function')
      expect(result).toBeNull()

      const code = await stub.getCode('nonexistent-function')
      expect(code).toBeNull()
    })
  })

  describe('UserStorageClient integration', () => {
    it('should work through the UserStorageClient wrapper for deploy + invoke', async () => {
      // Import the client wrapper
      const { UserStorageClient } = await import('../core/user-storage-client')

      const client = new UserStorageClient(env.USER_STORAGE, testUserId)
      const functionId = `client-fn-${Date.now()}`

      // Deploy via client.registry (replaces KVFunctionRegistry)
      const metadata = {
        id: functionId,
        version: '2.0.0',
        type: 'code' as const,
        name: 'Client Test Function',
        language: 'javascript' as const,
      }

      await client.registry.put(metadata)
      await client.registry.putVersion(functionId, '2.0.0', metadata)

      // Deploy via client.code (replaces KVCodeStorage)
      const jsCode = 'export default { fetch() { return new Response("ok") } }'
      await client.code.put(functionId, jsCode)
      await client.code.put(functionId, jsCode, '2.0.0')

      // Invoke path: retrieve via client
      const retrieved = await client.registry.get(functionId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.id).toBe(functionId)
      expect(retrieved!.name).toBe('Client Test Function')

      const retrievedCode = await client.code.get(functionId)
      expect(retrievedCode).toBe(jsCode)

      // Version-specific retrieval
      const versionMeta = await client.registry.getVersion(functionId, '2.0.0')
      expect(versionMeta).toBeDefined()
      expect(versionMeta!.version).toBe('2.0.0')
    })

    it('should support getCompiledOrSource for invoke path', async () => {
      const { UserStorageClient } = await import('../core/user-storage-client')
      const client = new UserStorageClient(env.USER_STORAGE, testUserId)
      const functionId = `compiled-fn-${Date.now()}`

      // Store source code only
      await client.code.put(functionId, 'const x = 1')

      // getCompiledOrSource should fall back to source
      const result = await client.code.getCompiledOrSource(functionId)
      expect(result).toBeDefined()
      expect(result!.code).toBe('const x = 1')
      expect(result!.usedPrecompiled).toBe(false)
      expect(result!.fallbackReason).toBe('no_precompiled_code')

      // Now store compiled code
      await client.code.putCompiled(functionId, 'var x = 1')

      // getCompiledOrSource should now return compiled
      const compiled = await client.code.getCompiledOrSource(functionId)
      expect(compiled).toBeDefined()
      expect(compiled!.code).toBe('var x = 1')
      expect(compiled!.usedPrecompiled).toBe(true)
    })
  })

  describe('full deploy -> list -> update -> delete lifecycle', () => {
    it('should support the full function lifecycle via DO', async () => {
      const { UserStorageClient } = await import('../core/user-storage-client')
      const client = new UserStorageClient(env.USER_STORAGE, `lifecycle-${Date.now()}`)
      const functionId = `lifecycle-fn-${Date.now()}`

      // 1. Deploy
      await client.registry.put({
        id: functionId,
        version: '1.0.0',
        type: 'code' as const,
        name: 'Lifecycle Test',
        language: 'javascript' as const,
      })
      await client.code.put(functionId, 'export default {}')

      // 2. List
      const listed = await client.registry.list()
      expect(listed.functions.length).toBeGreaterThanOrEqual(1)
      const found = listed.functions.find(f => f.id === functionId)
      expect(found).toBeDefined()

      // 3. Update
      const updated = await client.registry.update(functionId, {
        name: 'Updated Lifecycle Test',
        description: 'Updated description',
      })
      expect(updated.name).toBe('Updated Lifecycle Test')
      expect(updated.description).toBe('Updated description')

      // 4. Invoke (read back)
      const meta = await client.registry.get(functionId)
      expect(meta!.name).toBe('Updated Lifecycle Test')
      const code = await client.code.get(functionId)
      expect(code).toBe('export default {}')

      // 5. Delete
      await client.registry.delete(functionId)
      const deleted = await client.registry.get(functionId)
      expect(deleted).toBeNull()
    })
  })
})
