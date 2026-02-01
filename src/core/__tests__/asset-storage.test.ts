import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AssetStorage, AssetUploader, type AssetsBinding } from '../asset-storage'

/**
 * Tests for AssetStorage - Workers Static Assets for WASM binaries
 *
 * Issue: functions-6tn3 - Storage: Workers Static Assets for WASM binaries
 *
 * The AssetStorage class provides:
 * - Edge-cached WASM binary retrieval
 * - Free storage (included in Workers pricing)
 * - 25MB per file limit (sufficient for WASM)
 * - Direct upload API for CI/CD deployments
 *
 * IMPORTANT - Cloudflare Workers WASM Compilation Limitation:
 * Cloudflare Workers blocks dynamic WASM compilation from ArrayBuffer.
 * The getWasmBinary() method returns raw binary data, NOT an instantiated module.
 * To execute WASM, use worker_loaders with type: "compiled" modules.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/webassembly/
 */

/**
 * Creates a mock ASSETS binding for testing
 */
function createMockAssets(files: Map<string, Uint8Array> = new Map()): AssetsBinding {
  return {
    async fetch(request: Request | string): Promise<Response> {
      const url = typeof request === 'string' ? request : request.url
      const pathname = new URL(url).pathname

      // Handle HEAD requests
      if (typeof request !== 'string' && request.method === 'HEAD') {
        if (files.has(pathname)) {
          return new Response(null, { status: 200 })
        }
        return new Response(null, { status: 404 })
      }

      // Handle GET requests
      const data = files.get(pathname)
      if (data) {
        return new Response(data, {
          status: 200,
          headers: {
            'content-type': 'application/wasm',
            'content-length': String(data.length),
          },
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  }
}

describe('AssetStorage', () => {
  let storage: AssetStorage
  let mockAssets: AssetsBinding
  let files: Map<string, Uint8Array>

  beforeEach(() => {
    files = new Map()
    mockAssets = createMockAssets(files)
    storage = new AssetStorage(mockAssets)
  })

  describe('getWasmBinary', () => {
    it('should fetch raw WASM binary from static assets', async () => {
      const functionId = 'my-rust-function'
      const wasmBinary = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
      files.set(`/wasm/${functionId}/latest.wasm`, wasmBinary)

      const result = await storage.getWasmBinary(functionId)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result).toEqual(wasmBinary)
    })

    it('should fetch versioned WASM binary', async () => {
      const functionId = 'my-rust-function'
      const version = '1.2.3'
      const wasmBinary = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
      files.set(`/wasm/${functionId}/${version}.wasm`, wasmBinary)

      const result = await storage.getWasmBinary(functionId, version)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result).toEqual(wasmBinary)
    })

    it('should return null for non-existent WASM binary', async () => {
      const result = await storage.getWasmBinary('non-existent-function')

      expect(result).toBeNull()
    })

    it('should throw error for invalid function ID', async () => {
      await expect(storage.getWasmBinary('')).rejects.toThrow('Invalid function ID')
      await expect(storage.getWasmBinary('invalid id')).rejects.toThrow('Invalid function ID')
      await expect(storage.getWasmBinary('../path-traversal')).rejects.toThrow('Invalid function ID')
    })

    it('should handle organization-prefixed function IDs', async () => {
      const functionId = 'org_acme_my-function'
      const wasmBinary = new Uint8Array([0x00, 0x61, 0x73, 0x6d])
      files.set(`/wasm/${functionId}/latest.wasm`, wasmBinary)

      const result = await storage.getWasmBinary(functionId)

      expect(result).toEqual(wasmBinary)
    })

    it('should handle version strings with pre-release tags', async () => {
      const functionId = 'my-function'
      const version = '2.0.0-beta.1'
      const wasmBinary = new Uint8Array([0x00, 0x61, 0x73, 0x6d])
      files.set(`/wasm/${functionId}/${version}.wasm`, wasmBinary)

      const result = await storage.getWasmBinary(functionId, version)

      expect(result).toEqual(wasmBinary)
    })

    it('should return raw bytes NOT an instantiated WASM module', async () => {
      // This test verifies the critical documentation point:
      // Cloudflare Workers blocks dynamic WASM compilation from ArrayBuffer.
      // getWasmBinary() returns raw bytes that must be used with worker_loaders.
      const functionId = 'wasm-bytes-test'
      const wasmBinary = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
      files.set(`/wasm/${functionId}/latest.wasm`, wasmBinary)

      const result = await storage.getWasmBinary(functionId)

      // Result should be raw Uint8Array, not WebAssembly.Module
      expect(result).toBeInstanceOf(Uint8Array)
      expect(result).not.toBeInstanceOf(WebAssembly.Module)
      // Verify the magic bytes are intact (WASM files start with \0asm)
      expect(result![0]).toBe(0x00)
      expect(result![1]).toBe(0x61)
      expect(result![2]).toBe(0x73)
      expect(result![3]).toBe(0x6d)
    })
  })

  describe('getWasm (deprecated)', () => {
    it('should still work for backwards compatibility', async () => {
      const functionId = 'my-rust-function'
      const wasmBinary = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
      files.set(`/wasm/${functionId}/latest.wasm`, wasmBinary)

      // getWasm is deprecated but should still work
      const result = await storage.getWasm(functionId)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result).toEqual(wasmBinary)
    })
  })

  describe('hasWasm', () => {
    it('should return true when WASM exists', async () => {
      const functionId = 'my-function'
      files.set(`/wasm/${functionId}/latest.wasm`, new Uint8Array([0x00]))

      const result = await storage.hasWasm(functionId)

      expect(result).toBe(true)
    })

    it('should return false when WASM does not exist', async () => {
      const result = await storage.hasWasm('non-existent')

      expect(result).toBe(false)
    })

    it('should check versioned WASM existence', async () => {
      const functionId = 'my-function'
      files.set(`/wasm/${functionId}/1.0.0.wasm`, new Uint8Array([0x00]))

      expect(await storage.hasWasm(functionId, '1.0.0')).toBe(true)
      expect(await storage.hasWasm(functionId, '2.0.0')).toBe(false)
    })

    it('should throw error for invalid function ID', async () => {
      await expect(storage.hasWasm('')).rejects.toThrow('Invalid function ID')
    })
  })

  describe('getWasmUrl', () => {
    it('should generate correct URL for latest WASM', () => {
      const functionId = 'my-function'

      const url = storage.getWasmUrl(functionId)

      expect(url).toBe('https://functions.do/wasm/my-function/latest.wasm')
    })

    it('should generate correct URL for versioned WASM', () => {
      const functionId = 'my-function'
      const version = '1.2.3'

      const url = storage.getWasmUrl(functionId, version)

      expect(url).toBe('https://functions.do/wasm/my-function/1.2.3.wasm')
    })

    it('should use custom base URL', () => {
      const functionId = 'my-function'
      const baseUrl = 'https://api.example.com'

      const url = storage.getWasmUrl(functionId, undefined, baseUrl)

      expect(url).toBe('https://api.example.com/wasm/my-function/latest.wasm')
    })

    it('should throw error for invalid function ID', () => {
      expect(() => storage.getWasmUrl('')).toThrow('Invalid function ID')
    })
  })
})

describe('AssetUploader', () => {
  let uploader: AssetUploader

  beforeEach(() => {
    uploader = new AssetUploader('test-account-id', 'test-api-token', 'functions-do')
    // Reset fetch mock
    vi.restoreAllMocks()
  })

  describe('uploadWasm', () => {
    it('should upload WASM binary via Direct Upload API', async () => {
      const functionId = 'my-function'
      const version = '1.0.0'
      const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])

      // Mock the upload session response
      const mockSessionResponse = {
        result: {
          jwt: 'test-jwt-token',
          buckets: [['hash123']],
        },
      }

      // Mock fetch for session creation and upload
      const fetchMock = vi.fn()
        // First call: create session
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSessionResponse,
        })
        // Second call: upload file
        .mockResolvedValueOnce({
          ok: true,
        })

      vi.stubGlobal('fetch', fetchMock)

      const result = await uploader.uploadWasm(functionId, version, wasm)

      expect(result).toEqual({
        path: '/wasm/my-function/1.0.0.wasm',
        size: 8,
        hash: expect.any(String),
      })

      // Verify session creation was called
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/test-account-id/workers/scripts/functions-do/assets-upload-session',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-token',
          }),
        })
      )
    })

    it('should throw error for invalid function ID', async () => {
      const wasm = new Uint8Array([0x00])

      await expect(uploader.uploadWasm('', '1.0.0', wasm)).rejects.toThrow('Invalid function ID')
    })

    it('should handle upload session creation failure', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: false,
        text: async () => 'Unauthorized',
      })

      vi.stubGlobal('fetch', fetchMock)

      const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d])

      await expect(uploader.uploadWasm('my-function', '1.0.0', wasm)).rejects.toThrow('Failed to create upload session')
    })

    it('should skip upload when file is already cached', async () => {
      const functionId = 'my-function'
      const version = '1.0.0'
      const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d])

      // Session response with empty buckets (file already cached)
      const mockSessionResponse = {
        result: {
          jwt: 'test-jwt-token',
          buckets: [], // Empty - no files need uploading
        },
      }

      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockSessionResponse,
      })

      vi.stubGlobal('fetch', fetchMock)

      const result = await uploader.uploadWasm(functionId, version, wasm)

      expect(result.path).toBe('/wasm/my-function/1.0.0.wasm')
      // Should only call once (session creation), not twice (no upload needed)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('uploadBatch', () => {
    it('should upload multiple WASM binaries in a single session', async () => {
      const files = [
        { functionId: 'func-a', version: '1.0.0', wasm: new Uint8Array([0x00, 0x61]) },
        { functionId: 'func-b', version: '1.0.0', wasm: new Uint8Array([0x00, 0x62]) },
        { functionId: 'func-c', version: '1.0.0', wasm: new Uint8Array([0x00, 0x63]) },
      ]

      const mockSessionResponse = {
        result: {
          jwt: 'test-jwt-token',
          buckets: [['hash1', 'hash2', 'hash3']],
        },
      }

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSessionResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
        })

      vi.stubGlobal('fetch', fetchMock)

      const results = await uploader.uploadBatch(files)

      expect(results).toHaveLength(3)
      expect(results[0].path).toBe('/wasm/func-a/1.0.0.wasm')
      expect(results[1].path).toBe('/wasm/func-b/1.0.0.wasm')
      expect(results[2].path).toBe('/wasm/func-c/1.0.0.wasm')
    })

    it('should throw error if any function ID is invalid', async () => {
      const files = [
        { functionId: 'valid-func', version: '1.0.0', wasm: new Uint8Array([0x00]) },
        { functionId: '', version: '1.0.0', wasm: new Uint8Array([0x00]) }, // Invalid
      ]

      await expect(uploader.uploadBatch(files)).rejects.toThrow('Invalid function ID')
    })
  })
})

describe('WASM Loading Integration', () => {
  it('should correctly identify WASM magic bytes', () => {
    // WASM magic bytes: 0x00 0x61 0x73 0x6d (\\0asm)
    const validWasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
    const invalidData = new Uint8Array([0x00, 0x00, 0x00, 0x00])

    // Check magic bytes
    const isValidWasm = (data: Uint8Array): boolean => {
      return data.length >= 4 &&
        data[0] === 0x00 &&
        data[1] === 0x61 &&
        data[2] === 0x73 &&
        data[3] === 0x6d
    }

    expect(isValidWasm(validWasm)).toBe(true)
    expect(isValidWasm(invalidData)).toBe(false)
  })

  it('documents that WebAssembly.compile is BLOCKED in Cloudflare Workers', () => {
    // CRITICAL: This test documents the Cloudflare Workers limitation.
    // Cloudflare Workers blocks dynamic WASM compilation from ArrayBuffer.
    //
    // The following approaches DO NOT WORK:
    //   - WebAssembly.compile(arrayBuffer)
    //   - WebAssembly.instantiate(arrayBuffer, imports)
    //   - new WebAssembly.Module(arrayBuffer)
    //
    // Instead, you MUST use worker_loaders with type: "compiled" modules:
    //
    // const worker = await env.LOADER.put(functionId, workerCode, {
    //   modules: [
    //     { name: "module.wasm", type: "compiled", content: wasmBinary }
    //   ]
    // })
    //
    // This test serves as documentation. In a real Cloudflare Worker,
    // calling WebAssembly.compile() with dynamic data would throw an error.

    expect(true).toBe(true) // Documentation test
  })

  it('shows the correct worker_loaders pattern for WASM execution', () => {
    // This test documents the correct pattern for executing WASM in Cloudflare Workers.
    //
    // Step 1: Fetch the WASM binary via AssetStorage
    //   const wasmBinary = await assetStorage.getWasmBinary(functionId, version)
    //
    // Step 2: Create a worker with the WASM as a compiled module
    //   const worker = await env.LOADER.put(functionId, workerCode, {
    //     modules: [
    //       { name: "module.wasm", type: "compiled", content: wasmBinary }
    //     ]
    //   })
    //
    // Step 3: Execute via the worker
    //   const result = await worker.fetch(request)
    //
    // The workerCode should import the WASM module:
    //   import wasmModule from "./module.wasm";
    //   const instance = await WebAssembly.instantiate(wasmModule, {});
    //   const result = instance.exports.handler(input);

    // Example worker code that imports WASM
    const exampleWorkerCode = `
      import wasmModule from "./module.wasm";

      export default {
        async fetch(request) {
          const input = await request.json();
          const instance = await WebAssembly.instantiate(wasmModule, {});
          const result = instance.exports.handler(input);
          return new Response(JSON.stringify({ output: result }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      };
    `

    expect(exampleWorkerCode).toContain('import wasmModule from "./module.wasm"')
    expect(exampleWorkerCode).toContain('WebAssembly.instantiate')
  })
})

describe('Storage Path Layout', () => {
  it('should use correct path format: /wasm/{functionId}/{version}.wasm', () => {
    const mockAssets = createMockAssets(new Map())
    const storage = new AssetStorage(mockAssets)

    // Test latest version
    expect(storage.getWasmUrl('my-function')).toContain('/wasm/my-function/latest.wasm')

    // Test specific version
    expect(storage.getWasmUrl('my-function', '1.2.3')).toContain('/wasm/my-function/1.2.3.wasm')

    // Test pre-release version
    expect(storage.getWasmUrl('my-function', '2.0.0-beta.1')).toContain('/wasm/my-function/2.0.0-beta.1.wasm')
  })

  it('should handle edge-cached responses efficiently', async () => {
    const files = new Map<string, Uint8Array>()
    const wasmBinary = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
    files.set('/wasm/cached-function/latest.wasm', wasmBinary)

    let fetchCount = 0
    const mockAssets: AssetsBinding = {
      async fetch(request: Request | string): Promise<Response> {
        fetchCount++
        const url = typeof request === 'string' ? request : request.url
        const pathname = new URL(url).pathname
        const data = files.get(pathname)
        if (data) {
          return new Response(data, {
            status: 200,
            headers: {
              'content-type': 'application/wasm',
              'cf-cache-status': 'HIT', // Edge cache hit
            },
          })
        }
        return new Response('Not Found', { status: 404 })
      },
    }

    const storage = new AssetStorage(mockAssets)

    // First fetch
    const result1 = await storage.getWasm('cached-function')
    expect(result1).toEqual(wasmBinary)

    // Second fetch (would normally be cached at edge)
    const result2 = await storage.getWasm('cached-function')
    expect(result2).toEqual(wasmBinary)

    // Both fetches go through (caching is handled at edge, not in AssetStorage)
    expect(fetchCount).toBe(2)
  })
})
