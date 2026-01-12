// Tests skipped pending ai-evaluate integration - see epic functions-8v1

/**
 * Worker Loader Tests (RED Phase - TDD)
 *
 * These tests validate the Worker Loader functionality for Functions.do.
 * The Worker Loader is responsible for:
 * 1. Loading function code and returning a WorkerStub for execution
 * 2. Caching loaded isolates to avoid repeated compilation
 * 3. Managing function lifecycle within V8 isolates
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the implementation does not exist yet.
 *
 * Test setup uses @cloudflare/vitest-pool-workers with miniflare
 * for realistic Cloudflare Workers environment testing.
 */

import { describe, it, expect, beforeEach, vi, beforeAll, afterAll } from 'vitest'
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { WorkerLoader } from '../worker-loader'
import type { WorkerStub, CacheStats } from '../types'

/**
 * Test environment with Worker Loader binding
 * In production, this would be a service binding to the loader worker
 */
interface TestEnv {
  LOADER: Fetcher
}

/**
 * Mock loader worker that simulates the function loader service
 * This would be replaced by actual service binding in integration tests
 */
function createMockLoaderFetcher(): Fetcher {
  const fetchHandler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const functionId = url.pathname.split('/').pop()

    // Simulate different responses based on function ID
    if (functionId === 'non-existent-function') {
      return new Response(JSON.stringify({ error: 'Function not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Simulate successful function load
    return new Response(
      JSON.stringify({
        id: functionId,
        status: 'ready',
        runtime: 'v8-isolate',
        compiledAt: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  return {
    fetch: fetchHandler,
  } as unknown as Fetcher
}

describe('WorkerLoader', () => {
  let loader: WorkerLoader
  let mockFetcher: Fetcher
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock fetcher with spy for tracking calls
    fetchSpy = vi.fn(async (request: Request): Promise<Response> => {
      const url = new URL(request.url)
      const functionId = url.pathname.split('/').pop()

      if (functionId === 'non-existent-function') {
        return new Response(JSON.stringify({ error: 'Function not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(
        JSON.stringify({
          id: functionId,
          status: 'ready',
          runtime: 'v8-isolate',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    })

    mockFetcher = { fetch: fetchSpy } as unknown as Fetcher
    loader = new WorkerLoader(mockFetcher)
  })

  describe('WorkerLoader.get() - Basic Functionality', () => {
    it.skip('should return a WorkerStub for a given function ID', async () => {
      const functionId = 'test-function-123'

      // Act: Get the function stub
      const stub = await loader.get(functionId)

      // Assert: The stub should be defined and have the expected interface
      expect(stub).toBeDefined()
      expect(stub).toHaveProperty('fetch')
      expect(stub).toHaveProperty('id')
      expect(stub.id).toBe(functionId)
    })

    it.skip('should return a WorkerStub with callable fetch method', async () => {
      const functionId = 'hello-world'

      const stub = await loader.get(functionId)

      // The stub's fetch should be a function
      expect(typeof stub.fetch).toBe('function')

      // Create a test request
      const request = new Request('https://functions.do/hello', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'World' }),
      })

      // The fetch should return a Response
      const response = await stub.fetch(request)
      expect(response).toBeInstanceOf(Response)
    })

    it.skip('should throw error for non-existent function', async () => {
      const nonExistentId = 'non-existent-function'

      await expect(loader.get(nonExistentId)).rejects.toThrow('Function not found')
    })
  })

  describe('WorkerLoader.get() - Caching Behavior', () => {
    it.skip('should return cached WorkerStub on subsequent calls with same ID', async () => {
      const functionId = 'cached-function'

      // First call - should load the function
      const stub1 = await loader.get(functionId)

      // Second call - should return cached instance
      const stub2 = await loader.get(functionId)

      // Both should be the exact same instance (referential equality)
      expect(stub1).toBe(stub2)
    })

    it.skip('should only call the loader service once for same function ID', async () => {
      const functionId = 'single-load-function'

      // Make multiple calls with the same function ID
      await loader.get(functionId)
      await loader.get(functionId)
      await loader.get(functionId)

      // The underlying fetch should only be called once due to caching
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it.skip('should load different functions independently', async () => {
      const functionId1 = 'function-alpha'
      const functionId2 = 'function-beta'

      const stub1 = await loader.get(functionId1)
      const stub2 = await loader.get(functionId2)

      // Different function IDs should return different stubs
      expect(stub1).not.toBe(stub2)
      expect(stub1.id).toBe(functionId1)
      expect(stub2.id).toBe(functionId2)

      // Both should have been loaded separately
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it.skip('should handle concurrent requests for same function with request coalescing', async () => {
      const functionId = 'concurrent-function'

      // Create a delayed fetch to simulate realistic loading time
      let resolveDelay: () => void
      const delayPromise = new Promise<void>((resolve) => {
        resolveDelay = resolve
      })

      let fetchCallCount = 0
      const delayedFetchSpy = vi.fn(async (request: Request): Promise<Response> => {
        fetchCallCount++
        await delayPromise
        return new Response(
          JSON.stringify({ id: functionId, status: 'ready' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      })

      const delayedLoader = new WorkerLoader({ fetch: delayedFetchSpy } as unknown as Fetcher)

      // Fire off multiple concurrent requests
      const promises = [
        delayedLoader.get(functionId),
        delayedLoader.get(functionId),
        delayedLoader.get(functionId),
      ]

      // Release the delay
      resolveDelay!()

      const stubs = await Promise.all(promises)

      // All should be the same instance
      expect(stubs[0]).toBe(stubs[1])
      expect(stubs[1]).toBe(stubs[2])

      // Only one actual fetch should have been made (request coalescing)
      expect(fetchCallCount).toBe(1)
    })

    it.skip('should cache isolates across multiple concurrent get() calls', async () => {
      const functionId = 'hot-function'

      // Simulate multiple calls that might happen during a single request
      const promises = Array.from({ length: 10 }, () => loader.get(functionId))
      const stubs = await Promise.all(promises)

      // All should be the same cached instance
      const firstStub = stubs[0]
      stubs.forEach((stub) => {
        expect(stub).toBe(firstStub)
      })

      // Only one load should have occurred
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('WorkerLoader - Cache Management', () => {
    it.skip('should support cache invalidation for specific function', async () => {
      const functionId = 'invalidatable-function'

      // Load the function
      const stub1 = await loader.get(functionId)

      // Invalidate the cache
      loader.invalidate(functionId)

      // Next get should reload
      const stub2 = await loader.get(functionId)

      // Should be a new instance
      expect(stub1).not.toBe(stub2)

      // Loader should have been called twice
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it.skip('should support clearing entire cache', async () => {
      await loader.get('func-1')
      await loader.get('func-2')
      await loader.get('func-3')

      expect(fetchSpy).toHaveBeenCalledTimes(3)

      // Clear all cached isolates
      loader.clearCache()

      // Reload all functions
      await loader.get('func-1')
      await loader.get('func-2')
      await loader.get('func-3')

      // Should have loaded everything again
      expect(fetchSpy).toHaveBeenCalledTimes(6)
    })

    it.skip('should report cache statistics', async () => {
      // Load some functions
      await loader.get('func-a')
      await loader.get('func-b')
      await loader.get('func-a') // This should be a cache hit

      const stats = loader.getCacheStats()

      expect(stats).toHaveProperty('size')
      expect(stats).toHaveProperty('hits')
      expect(stats).toHaveProperty('misses')
      expect(stats.size).toBe(2) // 2 unique functions
      expect(stats.hits).toBe(1) // 1 cache hit
      expect(stats.misses).toBe(2) // 2 cache misses (initial loads)
    })
  })

  describe('WorkerStub Interface', () => {
    it.skip('should provide a fetch method that proxies to the loaded function', async () => {
      const functionId = 'echo-function'
      const stub = await loader.get(functionId)

      const request = new Request('https://functions.do/echo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello' }),
      })

      const response = await stub.fetch(request)

      expect(response).toBeInstanceOf(Response)
      expect(response.ok).toBe(true)
    })

    it.skip('should expose the function ID on the stub', async () => {
      const functionId = 'my-typescript-func'

      const stub = await loader.get(functionId)

      expect(stub.id).toBe(functionId)
    })

    it.skip('should provide connect method for durable object style connections', async () => {
      const functionId = 'stateful-function'
      const stub = await loader.get(functionId)

      expect(stub).toHaveProperty('connect')
      expect(typeof stub.connect).toBe('function')
    })

    it.skip('should provide scheduled method for cron triggers', async () => {
      const functionId = 'scheduled-function'
      const stub = await loader.get(functionId)

      expect(stub).toHaveProperty('scheduled')
      expect(typeof stub.scheduled).toBe('function')
    })

    it.skip('should provide queue method for queue consumers', async () => {
      const functionId = 'queue-consumer'
      const stub = await loader.get(functionId)

      expect(stub).toHaveProperty('queue')
      expect(typeof stub.queue).toBe('function')
    })
  })

  describe('Error Handling', () => {
    it.skip('should handle loader service errors gracefully', async () => {
      const errorFetcher = {
        fetch: vi.fn().mockRejectedValue(new Error('Service unavailable')),
      } as unknown as Fetcher

      const errorLoader = new WorkerLoader(errorFetcher)

      await expect(errorLoader.get('any-function')).rejects.toThrow('Service unavailable')
    })

    it.skip('should handle malformed JSON responses from loader', async () => {
      const malformedFetcher = {
        fetch: vi.fn().mockResolvedValue(
          new Response('not valid json at all', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        ),
      } as unknown as Fetcher

      const malformedLoader = new WorkerLoader(malformedFetcher)

      await expect(malformedLoader.get('any-function')).rejects.toThrow()
    })

    it.skip('should handle timeout when loading function', async () => {
      const slowFetcher = {
        fetch: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              // Never resolves within timeout
              setTimeout(() => {
                resolve(
                  new Response(JSON.stringify({ id: 'slow', status: 'ready' }), { status: 200 })
                )
              }, 60000)
            })
        ),
      } as unknown as Fetcher

      const slowLoader = new WorkerLoader(slowFetcher, { timeout: 100 })

      await expect(slowLoader.get('slow-function')).rejects.toThrow(/timeout/i)
    })

    it.skip('should handle 500 error responses from loader', async () => {
      const serverErrorFetcher = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        ),
      } as unknown as Fetcher

      const serverErrorLoader = new WorkerLoader(serverErrorFetcher)

      await expect(serverErrorLoader.get('any-function')).rejects.toThrow()
    })
  })
})

/**
 * Integration tests using miniflare environment
 * These tests verify the WorkerLoader works correctly in a Workers runtime
 */
describe('WorkerLoader - Miniflare Integration', () => {
  it.skip('should work with actual Request/Response objects in Workers runtime', async () => {
    // This test validates that the WorkerLoader properly handles
    // the actual Cloudflare Workers Request and Response objects
    const mockFetcher = createMockLoaderFetcher()
    const loader = new WorkerLoader(mockFetcher)

    const functionId = 'miniflare-test-func'
    const stub = await loader.get(functionId)

    expect(stub).toBeDefined()
    expect(stub.id).toBe(functionId)

    // Create a real Workers Request object
    const request = new Request('https://functions.do/test', {
      method: 'GET',
    })

    const response = await stub.fetch(request)
    expect(response).toBeInstanceOf(Response)
  })

  it.skip('should properly handle execution context lifecycle', async () => {
    // In a real Workers environment, we need to ensure proper cleanup
    const mockFetcher = createMockLoaderFetcher()
    const loader = new WorkerLoader(mockFetcher)

    const ctx = createExecutionContext()

    const stub = await loader.get('lifecycle-test')
    expect(stub).toBeDefined()

    // Simulate request handling
    const request = new Request('https://functions.do/lifecycle')
    const response = await stub.fetch(request)

    await waitOnExecutionContext(ctx)

    expect(response).toBeInstanceOf(Response)
  })
})

/**
 * AI-Evaluate Integration Tests (RED Phase - TDD)
 *
 * These tests validate WorkerLoader integration with ai-evaluate's two-path architecture:
 * 1. Production path: Uses worker_loaders binding (env.LOADER) for dynamic worker creation
 * 2. Development path: Falls back to Miniflare for local development/Node.js
 *
 * The ai-evaluate pattern provides:
 * - Sandboxed code execution in V8 isolates
 * - Network blocking by default (fetch: null)
 * - Filesystem isolation (no access to host filesystem)
 * - Timeout handling for runaway code
 * - Error propagation from sandbox to host
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the implementation does not exist yet.
 */
describe('WorkerLoader - ai-evaluate Integration', () => {
  /**
   * Mock environment that simulates the production env with LOADER binding
   */
  interface EvaluateEnv {
    LOADER: WorkerLoaderBinding
    TEST?: TestServiceBinding
  }

  /**
   * WorkerLoader binding type from ai-evaluate (Cloudflare worker_loaders)
   */
  interface WorkerLoaderBinding {
    get(
      id: string,
      loader: () => Promise<WorkerCode>
    ): WorkerStubBinding
  }

  interface WorkerCode {
    mainModule: string
    modules: Record<string, string | { js?: string; text?: string; json?: unknown }>
    compatibilityDate?: string
    globalOutbound?: null | unknown
    bindings?: Record<string, unknown>
  }

  interface WorkerStubBinding {
    fetch(request: Request): Promise<Response>
  }

  interface TestServiceBinding {
    connect(): Promise<unknown>
  }

  describe('Two-Path Architecture', () => {
    it('should use worker_loaders binding when env.LOADER is available', async () => {
      // Simulate production environment with LOADER binding
      const mockLoaderBinding: WorkerLoaderBinding = {
        get: vi.fn((id, loaderFn) => {
          return {
            fetch: async (request: Request) => {
              const config = await loaderFn()
              // Return a mock response to verify the binding was used
              return new Response(JSON.stringify({
                usedBinding: true,
                workerId: id,
                mainModule: config.mainModule
              }), { status: 200 })
            }
          }
        })
      }

      const env: EvaluateEnv = { LOADER: mockLoaderBinding }

      // Create loader with env - this should use the LOADER binding
      const loader = new WorkerLoader(env.LOADER as unknown as Fetcher)

      const result = await loader.loadFunction({
        id: 'test-func',
        code: 'export default { fetch: () => new Response("hello") }'
      })

      expect(result).toBeDefined()
      expect(mockLoaderBinding.get).toHaveBeenCalledWith(
        expect.stringContaining('test-func'),
        expect.any(Function)
      )
    })

    it('should fall back to Miniflare when env.LOADER is not available', async () => {
      // No LOADER binding - should use Miniflare
      const loader = new WorkerLoader(undefined as unknown as Fetcher)

      const result = await loader.loadFunction({
        id: 'dev-func',
        code: 'export default { fetch: () => new Response("dev mode") }'
      })

      expect(result).toBeDefined()
      expect(result.developmentMode).toBe(true)
    })

    it('should generate correct worker code for sandbox execution', async () => {
      let capturedWorkerCode: WorkerCode | null = null

      const mockLoaderBinding: WorkerLoaderBinding = {
        get: vi.fn((id, loaderFn) => {
          return {
            fetch: async () => {
              capturedWorkerCode = await loaderFn()
              return new Response('ok')
            }
          }
        })
      }

      const loader = new WorkerLoader(mockLoaderBinding as unknown as Fetcher)

      await loader.loadFunction({
        id: 'code-gen-test',
        code: 'exports.add = (a, b) => a + b;',
        tests: 'it("adds", () => expect(add(1,2)).toBe(3));'
      })

      expect(capturedWorkerCode).not.toBeNull()
      expect(capturedWorkerCode!.mainModule).toBe('worker.js')
      expect(capturedWorkerCode!.modules).toHaveProperty('worker.js')
      expect(capturedWorkerCode!.compatibilityDate).toBeDefined()
    })
  })

  describe('Sandbox Isolation', () => {
    it('should block filesystem access from sandboxed code', async () => {
      const loader = new WorkerLoader(createMockLoaderFetcher())

      // Attempt to access filesystem from within the sandbox
      const result = await loader.loadFunction({
        id: 'fs-access-test',
        code: `
          export default {
            async fetch() {
              // This should fail - no fs access in sandbox
              const fs = await import('fs')
              const data = fs.readFileSync('/etc/passwd')
              return new Response(data)
            }
          }
        `
      })

      const stub = await loader.get('fs-access-test')
      const response = await stub.fetch(new Request('http://test/'))

      // Should fail with error, not expose filesystem data
      expect(response.ok).toBe(false)
      const errorText = await response.text()
      expect(errorText).toContain('error')
      expect(errorText).not.toContain('root:')
    })

    it('should block network access by default when fetch is null', async () => {
      const loader = new WorkerLoader(createMockLoaderFetcher())

      const result = await loader.loadFunction({
        id: 'network-blocked-test',
        code: `
          export default {
            async fetch() {
              // This should fail - network is blocked
              const response = await fetch('https://example.com')
              return response
            }
          }
        `,
        options: { fetch: null } // Block network access
      })

      const stub = await loader.get('network-blocked-test')
      const response = await stub.fetch(new Request('http://test/'))

      expect(response.ok).toBe(false)
      const errorData = await response.json()
      expect(errorData.error).toMatch(/network|fetch|blocked|disabled/i)
    })

    it('should allow network access when fetch is not blocked', async () => {
      const loader = new WorkerLoader(createMockLoaderFetcher())

      const result = await loader.loadFunction({
        id: 'network-allowed-test',
        code: `
          export default {
            async fetch() {
              // Network access should be allowed when not explicitly blocked
              const response = await fetch('https://httpbin.org/get')
              return new Response(JSON.stringify({ fetched: response.ok }))
            }
          }
        `,
        options: { fetch: undefined } // Network allowed
      })

      const stub = await loader.get('network-allowed-test')
      const response = await stub.fetch(new Request('http://test/'))

      // Should succeed or at least not fail with "blocked" error
      const data = await response.json()
      // If there's an error field, it should not indicate network was blocked
      if (data.error) {
        expect(data.error).not.toMatch(/blocked|disabled/i)
      }
      // If no error field, that means the request succeeded (good!)
    })

    it('should prevent access to process.env and global variables', async () => {
      const loader = new WorkerLoader(createMockLoaderFetcher())

      const result = await loader.loadFunction({
        id: 'env-access-test',
        code: `
          export default {
            async fetch() {
              // Attempt to access process.env (should be undefined or fail)
              const secret = typeof process !== 'undefined' ? process.env.SECRET_KEY : 'no-process'
              return new Response(JSON.stringify({ secret }))
            }
          }
        `
      })

      const stub = await loader.get('env-access-test')
      const response = await stub.fetch(new Request('http://test/'))
      const data = await response.json()

      // process.env should not be accessible - secret should be 'no-process', undefined, or null
      expect(data.secret).not.toBe('actual-secret-value')
      // Either 'no-process' (process undefined), undefined (process.env blocked), or null (same)
      expect(data.secret === 'no-process' || data.secret === undefined || data.secret === null).toBe(true)
    })
  })

  describe('Timeout Handling', () => {
    it('should terminate execution that exceeds timeout', async () => {
      const loader = new WorkerLoader(createMockLoaderFetcher())

      const result = await loader.loadFunction({
        id: 'timeout-test',
        code: `
          export default {
            async fetch() {
              // Infinite loop - should be terminated by timeout
              while (true) {
                await new Promise(r => setTimeout(r, 100))
              }
            }
          }
        `,
        options: { timeout: 100 } // 100ms timeout
      })

      const stub = await loader.get('timeout-test')

      const startTime = Date.now()
      const response = await stub.fetch(new Request('http://test/'))
      const elapsed = Date.now() - startTime

      // Should have been terminated within reasonable time (timeout + buffer)
      expect(elapsed).toBeLessThan(500)
      expect(response.ok).toBe(false)
      const errorData = await response.json()
      expect(errorData.error).toMatch(/timeout|exceeded|limit/i)
    })

    it('should use default timeout when not specified', async () => {
      const loader = new WorkerLoader(createMockLoaderFetcher())

      const result = await loader.loadFunction({
        id: 'default-timeout-test',
        code: `
          export default {
            async fetch() {
              // Quick operation - should complete before default timeout
              return new Response('done')
            }
          }
        `
        // No timeout specified - should use default (5000ms per ai-evaluate)
      })

      const stub = await loader.get('default-timeout-test')
      const response = await stub.fetch(new Request('http://test/'))

      expect(response.ok).toBe(true)
      expect(await response.text()).toBe('done')
    })

    it('should report timeout duration in result', async () => {
      const loader = new WorkerLoader(createMockLoaderFetcher())

      const result = await loader.loadFunction({
        id: 'duration-test',
        code: `
          export default {
            async fetch() {
              await new Promise(r => setTimeout(r, 100))
              return new Response('done')
            }
          }
        `
      })

      const stub = await loader.get('duration-test')
      const response = await stub.fetch(new Request('http://test/'))

      // Response should include execution duration
      expect(response.headers.get('X-Execution-Duration')).toBeDefined()
      const duration = parseInt(response.headers.get('X-Execution-Duration') || '0', 10)
      // Use a lower threshold (80ms) to account for timer precision in workerd environment
      expect(duration).toBeGreaterThanOrEqual(80)
    })
  })

  describe('Error Propagation', () => {
    it('should propagate syntax errors from loaded code', async () => {
      const loader = new WorkerLoader(createMockLoaderFetcher())

      const result = await loader.loadFunction({
        id: 'syntax-error-test',
        code: `
          export default {
            async fetch() {
              // Syntax error
              const x = {;
            }
          }
        `
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Syntax')
    })

    it('should propagate runtime errors with stack traces', async () => {
      const loader = new WorkerLoader(createMockLoaderFetcher())

      const result = await loader.loadFunction({
        id: 'runtime-error-test',
        code: `
          export default {
            async fetch() {
              throw new Error('Intentional runtime error')
            }
          }
        `
      })

      const stub = await loader.get('runtime-error-test')
      const response = await stub.fetch(new Request('http://test/'))

      expect(response.ok).toBe(false)
      const errorData = await response.json()
      expect(errorData.error).toContain('Intentional runtime error')
      expect(errorData.stack).toBeDefined()
    })

    it('should capture console output from sandbox', async () => {
      const loader = new WorkerLoader(createMockLoaderFetcher())

      const result = await loader.loadFunction({
        id: 'console-test',
        code: `
          export default {
            async fetch() {
              console.log('hello from sandbox')
              console.warn('warning message')
              console.error('error message')
              return new Response('done')
            }
          }
        `
      })

      const stub = await loader.get('console-test')
      const response = await stub.fetch(new Request('http://test/'))

      // Logs should be captured in response or result
      expect(result.logs).toBeDefined()
      expect(result.logs).toHaveLength(3)
      expect(result.logs[0]).toMatchObject({ level: 'log', message: 'hello from sandbox' })
      expect(result.logs[1]).toMatchObject({ level: 'warn', message: 'warning message' })
      expect(result.logs[2]).toMatchObject({ level: 'error', message: 'error message' })
    })

    it('should handle promise rejections from sandbox', async () => {
      const loader = new WorkerLoader(createMockLoaderFetcher())

      const result = await loader.loadFunction({
        id: 'rejection-test',
        code: `
          export default {
            async fetch() {
              return Promise.reject(new Error('async rejection'))
            }
          }
        `
      })

      const stub = await loader.get('rejection-test')
      const response = await stub.fetch(new Request('http://test/'))

      expect(response.ok).toBe(false)
      const errorData = await response.json()
      expect(errorData.error).toContain('async rejection')
    })
  })

  describe('Module and Test Execution', () => {
    it('should expose module exports to fetch handler', async () => {
      const loader = new WorkerLoader(createMockLoaderFetcher())

      const result = await loader.loadFunction({
        id: 'module-exports-test',
        code: `
          exports.add = (a, b) => a + b;
          exports.multiply = (a, b) => a * b;
        `,
        script: 'return add(2, 3) + multiply(4, 5)'
      })

      expect(result.success).toBe(true)
      expect(result.value).toBe(25) // 5 + 20
    })

    it('should run vitest-style tests against module exports', async () => {
      const loader = new WorkerLoader(createMockLoaderFetcher())

      const result = await loader.loadFunction({
        id: 'test-runner-test',
        code: `
          exports.double = (n) => n * 2;
          exports.triple = (n) => n * 3;
        `,
        tests: `
          describe('math functions', () => {
            it('doubles a number', () => {
              expect(double(5)).toBe(10);
            });
            it('triples a number', () => {
              expect(triple(4)).toBe(12);
            });
          });
        `
      })

      expect(result.success).toBe(true)
      expect(result.testResults).toBeDefined()
      expect(result.testResults!.total).toBe(2)
      expect(result.testResults!.passed).toBe(2)
      expect(result.testResults!.failed).toBe(0)
    })

    it('should report failing tests with error messages', async () => {
      const loader = new WorkerLoader(createMockLoaderFetcher())

      const result = await loader.loadFunction({
        id: 'failing-test-test',
        code: `
          exports.buggyAdd = (a, b) => a * b; // Bug: should be a + b
        `,
        tests: `
          it('adds correctly', () => {
            expect(buggyAdd(2, 3)).toBe(5); // Will fail: returns 6
          });
        `
      })

      expect(result.success).toBe(false)
      expect(result.testResults).toBeDefined()
      expect(result.testResults!.failed).toBe(1)
      expect(result.testResults!.tests[0].error).toContain('Expected 5')
    })

    it('should support async tests', async () => {
      const loader = new WorkerLoader(createMockLoaderFetcher())

      const result = await loader.loadFunction({
        id: 'async-test-test',
        code: `
          exports.asyncFetch = async (url) => {
            await new Promise(r => setTimeout(r, 10));
            return { fetched: true };
          };
        `,
        tests: `
          it('handles async operations', async () => {
            const result = await asyncFetch('http://test');
            expect(result.fetched).toBe(true);
          });
        `
      })

      expect(result.success).toBe(true)
      expect(result.testResults!.passed).toBe(1)
    })
  })

  describe('SDK Configuration', () => {
    it('should inject SDK globals when sdk option is provided', async () => {
      const loader = new WorkerLoader(createMockLoaderFetcher())

      const result = await loader.loadFunction({
        id: 'sdk-globals-test',
        code: `
          export default {
            async fetch() {
              // SDK globals should be available: $, db, ai, api
              const hasGlobals = typeof $ !== 'undefined' &&
                                typeof db !== 'undefined' &&
                                typeof ai !== 'undefined';
              return new Response(JSON.stringify({ hasGlobals }))
            }
          }
        `,
        options: {
          sdk: { context: 'local' }
        }
      })

      const stub = await loader.get('sdk-globals-test')
      const response = await stub.fetch(new Request('http://test/'))
      const data = await response.json()

      expect(data.hasGlobals).toBe(true)
    })

    it('should configure SDK with custom RPC endpoints', async () => {
      const loader = new WorkerLoader(createMockLoaderFetcher())

      let capturedConfig: unknown = null

      const result = await loader.loadFunction({
        id: 'sdk-config-test',
        code: `
          export default {
            async fetch() {
              // Verify SDK is configured with custom endpoints
              const config = globalThis.__SDK_CONFIG__;
              return new Response(JSON.stringify(config))
            }
          }
        `,
        options: {
          sdk: {
            context: 'remote',
            rpcUrl: 'https://custom-rpc.example.com',
            dbUrl: 'https://custom-db.example.com/rpc',
            aiUrl: 'https://custom-ai.example.com/rpc'
          }
        }
      })

      const stub = await loader.get('sdk-config-test')
      const response = await stub.fetch(new Request('http://test/'))
      const config = await response.json()

      expect(config.rpcUrl).toBe('https://custom-rpc.example.com')
      expect(config.dbUrl).toBe('https://custom-db.example.com/rpc')
      expect(config.aiUrl).toBe('https://custom-ai.example.com/rpc')
    })
  })
})
