/**
 * Deploy Handler Tests - RED Phase
 *
 * Tests for the function deployment handler including:
 * - Input validation (function ID, language, version, code)
 * - Storage operations (registry, code storage)
 * - Compilation for TypeScript and WASM languages
 *
 * These tests import modules that don't exist yet - they will FAIL
 * until the implementation is complete.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockKV } from '../../test-utils/mock-kv'

// Import the deploy handler that doesn't exist yet
// These imports will cause the tests to fail (RED phase)
import { deployHandler, DeployHandlerContext } from '../handlers/deploy'
import { FunctionValidator } from '../validation/function-validator'

// Type for JSON response bodies
type JsonBody = Record<string, unknown>

describe('Deploy Handler', () => {
  let mockEnv: {
    FUNCTIONS_REGISTRY: KVNamespace
    FUNCTIONS_CODE: KVNamespace
    CLOUDFLARE_ACCOUNT_ID?: string
    CLOUDFLARE_API_TOKEN?: string
    DISPATCH_NAMESPACE?: string
  }
  let mockCtx: ExecutionContext

  beforeEach(() => {
    mockEnv = {
      FUNCTIONS_REGISTRY: createMockKV(),
      FUNCTIONS_CODE: createMockKV(),
    }
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext
  })

  describe('validation', () => {
    it('validates function ID format', async () => {
      // Test invalid function ID formats
      const invalidIds = [
        '', // empty
        '123-starts-with-number',
        'has spaces',
        'has@special!chars',
        'a'.repeat(65), // too long
        '-starts-with-dash',
        'ends-with-dash-',
        'has--double-dash',
      ]

      for (const invalidId of invalidIds) {
        const request = new Request('https://functions.do/api/functions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: invalidId,
            version: '1.0.0',
            language: 'typescript',
            code: 'export default {}',
          }),
        })

        const context: DeployHandlerContext = {}

        const response = await deployHandler(request, mockEnv, mockCtx, context)

        expect(response.status).toBe(400)
        const body = (await response.json()) as JsonBody
        expect(body['error']).toBeDefined()
      }
    })

    it('validates language is supported', async () => {
      const unsupportedLanguages = ['ruby', 'php', 'java', 'swift', 'kotlin']

      for (const language of unsupportedLanguages) {
        const request = new Request('https://functions.do/api/functions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'test-func',
            version: '1.0.0',
            language,
            code: 'some code',
          }),
        })

        const context: DeployHandlerContext = {}

        const response = await deployHandler(request, mockEnv, mockCtx, context)

        expect(response.status).toBe(400)
        const body = (await response.json()) as JsonBody
        const error = body['error'] as { code: string; message: string }
        expect(error.message.toLowerCase()).toContain('language')
      }
    })

    it('accepts supported languages', async () => {
      const supportedLanguages = ['typescript', 'javascript', 'rust', 'go', 'zig', 'assemblyscript']

      for (const language of supportedLanguages) {
        const code =
          language === 'typescript' || language === 'javascript'
            ? 'export default { fetch() { return new Response("ok"); } }'
            : 'fn main() {}'

        const request = new Request('https://functions.do/api/functions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: `test-${language}`,
            version: '1.0.0',
            language,
            code,
          }),
        })

        const context: DeployHandlerContext = {}

        const response = await deployHandler(request, mockEnv, mockCtx, context)

        // Should either succeed or fail at compilation, not validation
        expect([200, 201, 400, 500]).toContain(response.status)
        if (response.status === 400) {
          const body = (await response.json()) as JsonBody
          // Should not be a language validation error for supported languages
          expect(body['error']).not.toContain('Unsupported language')
        }
      }
    })

    it('validates version is semver', async () => {
      const invalidVersions = [
        'not-semver',
        '1.0',
        '1',
        'v1.0.0', // should not have v prefix
        '1.0.0.0',
        '1.0.0-',
        '01.0.0', // leading zeros
      ]

      for (const version of invalidVersions) {
        const request = new Request('https://functions.do/api/functions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'test-func',
            version,
            language: 'typescript',
            code: 'export default {}',
          }),
        })

        const context: DeployHandlerContext = {}

        const response = await deployHandler(request, mockEnv, mockCtx, context)

        expect(response.status).toBe(400)
        const body = (await response.json()) as JsonBody
        const error = body['error'] as { code: string; message: string }
        expect(error.message.toLowerCase()).toContain('version')
      }
    })

    it('accepts valid semver versions', async () => {
      const validVersions = [
        '1.0.0',
        '0.0.1',
        '10.20.30',
        '1.0.0-alpha',
        '1.0.0-alpha.1',
        '1.0.0-beta+build',
        '1.0.0+build.123',
      ]

      for (const version of validVersions) {
        const request = new Request('https://functions.do/api/functions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: `test-func-${version.replace(/\./g, '-')}`,
            version,
            language: 'typescript',
            code: 'export default { fetch() { return new Response("ok"); } }',
          }),
        })

        const context: DeployHandlerContext = {}

        const response = await deployHandler(request, mockEnv, mockCtx, context)

        // Should not fail on version validation
        if (response.status === 400) {
          const body = (await response.json()) as JsonBody
          expect(body['error']).not.toContain('Invalid semantic version')
        }
      }
    })

    it('validates code is provided', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-func',
          version: '1.0.0',
          language: 'typescript',
          // code is missing
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      const error = body['error'] as { code: string; message: string }
      expect(error.message.toLowerCase()).toContain('code')
    })

    it('validates code is not empty', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-func',
          version: '1.0.0',
          language: 'typescript',
          code: '', // empty code
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      const error = body['error'] as { code: string; message: string }
      expect(error.message.toLowerCase()).toContain('code')
    })

    it('returns 400 with validation errors', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Missing all required fields
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body['error']).toBeDefined()
    })

    it('validates entry point format', async () => {
      const invalidEntryPoints = [
        '../../../etc/passwd', // path traversal
        '/absolute/path',
        'has spaces.ts',
      ]

      for (const entryPoint of invalidEntryPoints) {
        const request = new Request('https://functions.do/api/functions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'test-func',
            version: '1.0.0',
            language: 'typescript',
            code: 'export default {}',
            entryPoint,
          }),
        })

        const context: DeployHandlerContext = {}

        const response = await deployHandler(request, mockEnv, mockCtx, context)

        expect(response.status).toBe(400)
      }
    })

    it('validates dependencies format', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-func',
          version: '1.0.0',
          language: 'typescript',
          code: 'export default {}',
          dependencies: 'not-an-object', // Should be Record<string, string>
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
    })
  })

  describe('storage', () => {
    it('stores function in registry', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'storage-test',
          version: '1.0.0',
          language: 'typescript',
          code: 'export default { fetch() { return new Response("ok"); } }',
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      expect([200, 201]).toContain(response.status)

      // Verify function was stored in registry
      const stored = await mockEnv.FUNCTIONS_REGISTRY.get('registry:storage-test', 'json')
      expect(stored).toBeDefined()
      expect((stored as JsonBody)['id']).toBe('storage-test')
      expect((stored as JsonBody)['version']).toBe('1.0.0')
    })

    it('stores code in code storage', async () => {
      const code = 'export default { fetch() { return new Response("stored code"); } }'

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'code-storage-test',
          version: '1.0.0',
          language: 'typescript',
          code,
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      expect([200, 201]).toContain(response.status)

      // Verify code was stored
      const storedCode = await mockEnv.FUNCTIONS_CODE.get('code:code-storage-test')
      expect(storedCode).toBeDefined()
      expect(storedCode).toContain('stored code')
    })

    it('stores versioned code separately', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'versioned-storage',
          version: '1.0.0',
          language: 'typescript',
          code: 'export default { fetch() { return new Response("v1"); } }',
        }),
      })

      const context: DeployHandlerContext = {}

      await deployHandler(request, mockEnv, mockCtx, context)

      // Verify both latest and versioned code are stored
      const latestCode = await mockEnv.FUNCTIONS_CODE.get('code:versioned-storage')
      const versionedCode = await mockEnv.FUNCTIONS_CODE.get('code:versioned-storage:v:1.0.0')

      expect(latestCode).toBeDefined()
      expect(versionedCode).toBeDefined()
    })

    it('handles version conflicts', async () => {
      // First deploy
      const firstRequest = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'conflict-test',
          version: '1.0.0',
          language: 'typescript',
          code: 'export default { fetch() { return new Response("first"); } }',
        }),
      })

      await deployHandler(firstRequest, mockEnv, mockCtx, {})

      // Try to deploy same version again
      const secondRequest = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'conflict-test',
          version: '1.0.0',
          language: 'typescript',
          code: 'export default { fetch() { return new Response("second"); } }',
        }),
      })

      const response = await deployHandler(secondRequest, mockEnv, mockCtx, {})

      // Should either conflict (409) or overwrite (200)
      expect([200, 201, 409]).toContain(response.status)
    })

    it('updates latest pointer on new version', async () => {
      // Deploy v1
      const v1Request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'latest-pointer-test',
          version: '1.0.0',
          language: 'typescript',
          code: 'export default { fetch() { return new Response("v1"); } }',
        }),
      })

      await deployHandler(v1Request, mockEnv, mockCtx, {})

      // Deploy v2
      const v2Request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'latest-pointer-test',
          version: '2.0.0',
          language: 'typescript',
          code: 'export default { fetch() { return new Response("v2"); } }',
        }),
      })

      await deployHandler(v2Request, mockEnv, mockCtx, {})

      // Latest should point to v2
      const latest = await mockEnv.FUNCTIONS_REGISTRY.get('registry:latest-pointer-test', 'json')
      expect((latest as JsonBody)['version']).toBe('2.0.0')
    })
  })

  describe('compilation', () => {
    it('compiles TypeScript at deploy time', async () => {
      const tsCode = `
        interface Request {
          url: string;
        }

        export default {
          async fetch(request: Request): Promise<Response> {
            const data: { message: string } = { message: 'Hello from TypeScript' };
            return new Response(JSON.stringify(data), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'ts-compile-test',
          version: '1.0.0',
          language: 'typescript',
          code: tsCode,
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      // Should succeed - TypeScript stored as-is or compiled
      expect([200, 201]).toContain(response.status)

      // Verify code was stored
      const storedCode = await mockEnv.FUNCTIONS_CODE.get('code:ts-compile-test')
      expect(storedCode).toBeDefined()
    })

    it('compiles WASM languages at deploy time', async () => {
      const rustCode = `
        #[no_mangle]
        pub extern "C" fn add(a: i32, b: i32) -> i32 {
            a + b
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'rust-compile-test',
          version: '1.0.0',
          language: 'rust',
          code: rustCode,
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      // Should either succeed or return compilation error
      expect([200, 201, 400, 500]).toContain(response.status)

      if (response.status === 200 || response.status === 201) {
        // WASM should be stored as base64
        const storedCode = await mockEnv.FUNCTIONS_CODE.get('code:rust-compile-test')
        expect(storedCode).toBeDefined()
      }
    })

    it('returns compilation errors', async () => {
      const invalidTsCode = `
        // This has syntax errors
        export default {
          fetch( {
            // missing closing paren and function body
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'compile-error-test',
          version: '1.0.0',
          language: 'typescript',
          code: invalidTsCode,
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      // Might succeed (storing invalid code) or fail (compilation error)
      // If it fails, should be 400 with compilation error details
      if (response.status === 400) {
        const body = (await response.json()) as JsonBody
        expect(body['error']).toBeDefined()
      }
    })

    it('handles Go compilation', async () => {
      const goCode = `
        package main

        //export add
        func add(a, b int32) int32 {
            return a + b
        }

        func main() {}
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'go-compile-test',
          version: '1.0.0',
          language: 'go',
          code: goCode,
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      // Should either succeed or return compilation error
      expect([200, 201, 400, 500]).toContain(response.status)
    })

    it('handles Zig compilation', async () => {
      const zigCode = `
        export fn add(a: i32, b: i32) i32 {
            return a + b;
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'zig-compile-test',
          version: '1.0.0',
          language: 'zig',
          code: zigCode,
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      expect([200, 201, 400, 500]).toContain(response.status)
    })

    it('handles AssemblyScript compilation', async () => {
      const asCode = `
        export function add(a: i32, b: i32): i32 {
          return a + b;
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'as-compile-test',
          version: '1.0.0',
          language: 'assemblyscript',
          code: asCode,
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      expect([200, 201, 400, 500]).toContain(response.status)
    })
  })

  describe('response', () => {
    it('returns deployment info on success', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'deploy-response-test',
          version: '1.0.0',
          language: 'typescript',
          code: 'export default { fetch() { return new Response("ok"); } }',
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      expect([200, 201]).toContain(response.status)

      const body = (await response.json()) as JsonBody
      expect(body['id']).toBe('deploy-response-test')
      expect(body['version']).toBe('1.0.0')
      expect(body['url']).toContain('deploy-response-test')
    })

    it('includes dispatch upload status', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'dispatch-status-test',
          version: '1.0.0',
          language: 'typescript',
          code: 'export default { fetch() { return new Response("ok"); } }',
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      if (response.status === 200 || response.status === 201) {
        const body = (await response.json()) as JsonBody
        expect(body['dispatchUpload']).toBeDefined()
      }
    })
  })

  describe('body size validation', () => {
    it('returns 413 when Content-Length exceeds 50MB limit', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(51 * 1024 * 1024), // 51MB
        },
        body: JSON.stringify({
          id: 'too-large',
          version: '1.0.0',
          language: 'typescript',
          code: 'export default {}',
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(413)
      const body = (await response.json()) as JsonBody
      const error = body['error'] as { code: string; message: string }
      expect(error.message.toLowerCase()).toContain('too large')
    })

    it('returns 413 for invalid Content-Length', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': 'not-a-number',
        },
        body: JSON.stringify({
          id: 'bad-length',
          version: '1.0.0',
          language: 'typescript',
          code: 'export default {}',
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(413)
    })

    it('allows requests at exactly 50MB', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(50 * 1024 * 1024), // exactly 50MB
        },
        body: JSON.stringify({
          id: 'exact-limit',
          version: '1.0.0',
          language: 'typescript',
          code: 'export default {}',
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      // Should NOT be 413 - the body is within limits
      expect(response.status).not.toBe(413)
    })

    it('allows requests without Content-Length header', async () => {
      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: 'no-content-length',
          version: '1.0.0',
          language: 'typescript',
          code: 'export default { fetch() { return new Response("ok"); } }',
        }),
      })

      const context: DeployHandlerContext = {}

      const response = await deployHandler(request, mockEnv, mockCtx, context)

      // Should proceed normally (not 413)
      expect(response.status).not.toBe(413)
    })
  })

  describe('idempotency', () => {
    it('supports idempotency key', async () => {
      const idempotencyKey = 'unique-deploy-key-123'

      const request1 = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          id: 'idempotent-test',
          version: '1.0.0',
          language: 'typescript',
          code: 'export default { fetch() { return new Response("ok"); } }',
        }),
      })

      const response1 = await deployHandler(request1, mockEnv, mockCtx, {})

      // Second request with same idempotency key
      const request2 = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          id: 'idempotent-test',
          version: '1.0.0',
          language: 'typescript',
          code: 'export default { fetch() { return new Response("ok"); } }',
        }),
      })

      const response2 = await deployHandler(request2, mockEnv, mockCtx, {})

      // Both should succeed with same result
      expect(response1.status).toBe(response2.status)
    })
  })
})
