/**
 * Deploy-Time TypeScript Compilation Tests (RED Phase)
 *
 * These tests verify that TypeScript code is compiled to JavaScript at deploy time
 * via the POST /api/functions endpoint. This follows the design in ESBUILD_WASM_DESIGN.md:
 *
 * POST /api/functions -> esbuild transform -> Store JS in KV -> Runtime uses JS directly
 *
 * Expected behavior:
 * - TypeScript code is compiled to JavaScript at deploy
 * - Compiled JS is stored in FUNCTIONS_CODE KV
 * - Metadata includes compilation status/artifacts
 * - JavaScript code bypasses compilation
 * - Compilation errors return meaningful error messages
 *
 * These tests are expected to FAIL until deploy-time compilation is implemented.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockKV } from '../test-utils/mock-kv'
import type { Env } from '../index'
import worker, { resetRateLimiter } from '../index'

type JsonBody = Record<string, unknown>

/**
 * Mock esbuild-compiler worker for testing.
 * In production, this would be an RPC service binding.
 */
interface MockEsbuildCompiler {
  transform(options: {
    code: string
    loader: 'ts' | 'tsx' | 'js' | 'jsx'
    target?: string
    format?: 'esm' | 'cjs' | 'iife'
  }): Promise<{
    code: string
    map?: string
    warnings: string[]
  }>
}

describe('Deploy-Time TypeScript Compilation', () => {
  let mockEnv: Env
  let mockRegistry: KVNamespace
  let mockCodeStorage: KVNamespace
  let mockCtx: ExecutionContext

  beforeEach(() => {
    resetRateLimiter()
    mockRegistry = createMockKV()
    mockCodeStorage = createMockKV()
    mockEnv = {
      FUNCTIONS_REGISTRY: mockRegistry,
      FUNCTIONS_CODE: mockCodeStorage,
    } as Env
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext
  })

  describe('Deploy TypeScript Function', () => {
    it('should compile TypeScript code at deploy time', async () => {
      const typeScriptCode = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const message: string = 'Hello from TypeScript!'
            return new Response(message)
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'ts-function',
          version: '1.0.0',
          language: 'typescript',
          code: typeScriptCode,
        }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(200)
      expect(body['id']).toBe('ts-function')

      // Verify compiled JS is stored (without type annotations)
      const storedCode = await mockCodeStorage.get('code:ts-function', 'text')
      expect(storedCode).toBeDefined()
      expect(storedCode).not.toContain(': Request')
      expect(storedCode).not.toContain(': Promise<Response>')
      expect(storedCode).not.toContain(': string')
      expect(storedCode).toContain('export default')
    })

    it('should store compiled JavaScript in FUNCTIONS_CODE KV', async () => {
      const typeScriptCode = `
        interface User {
          id: string
          name: string
        }

        export default {
          async fetch(request: Request): Promise<Response> {
            const user: User = { id: '1', name: 'Test' }
            return Response.json(user)
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'ts-with-interface',
          version: '1.0.0',
          language: 'typescript',
          code: typeScriptCode,
        }),
      })

      await worker.fetch(request, mockEnv, mockCtx)

      // The stored code should be compiled JavaScript without interfaces
      const storedCode = await mockCodeStorage.get('code:ts-with-interface', 'text')
      expect(storedCode).not.toContain('interface User')
      expect(storedCode).not.toContain(': User')
      expect(storedCode).toContain('export default')
    })

    it('should include compilation status in response metadata', async () => {
      const typeScriptCode = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return new Response('Compiled!')
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'ts-metadata',
          version: '1.0.0',
          language: 'typescript',
          code: typeScriptCode,
        }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(200)
      // Response should include compilation info
      expect(body['compiled']).toBe(true)
      expect(body['compiledAt']).toBeDefined()
    })

    it('should store both source and compiled code', async () => {
      const typeScriptCode = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return new Response('Source and compiled')
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'ts-dual-storage',
          version: '1.0.0',
          language: 'typescript',
          code: typeScriptCode,
        }),
      })

      await worker.fetch(request, mockEnv, mockCtx)

      // Source should be stored at :source key
      const sourceCode = await mockCodeStorage.get('code:ts-dual-storage:source', 'text')
      expect(sourceCode).toContain(': Request')
      expect(sourceCode).toContain(': Promise<Response>')

      // Compiled JS should be at the main key (used for execution)
      const compiledCode = await mockCodeStorage.get('code:ts-dual-storage', 'text')
      expect(compiledCode).not.toContain(': Request')
      expect(compiledCode).not.toContain(': Promise<Response>')
    })
  })

  describe('Deploy JavaScript Function', () => {
    it('should store JavaScript directly without compilation', async () => {
      const javaScriptCode = `
        export default {
          async fetch(request) {
            return new Response('Pure JavaScript')
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'js-function',
          version: '1.0.0',
          language: 'javascript',
          code: javaScriptCode,
        }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(200)
      expect(body['id']).toBe('js-function')

      // JS should be stored as-is (trimmed/normalized is OK)
      const storedCode = await mockCodeStorage.get('code:js-function', 'text')
      expect(storedCode).toContain('Pure JavaScript')
    })

    it('should not incur compilation overhead for JavaScript', async () => {
      const javaScriptCode = `
        export default {
          async fetch(request) {
            return new Response('No compilation needed')
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'js-no-compile',
          version: '1.0.0',
          language: 'javascript',
          code: javaScriptCode,
        }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(200)
      // Response should indicate no compilation was performed
      expect(body['compiled']).toBe(false)
    })

    it('should not store :source key for JavaScript', async () => {
      const javaScriptCode = `export default { fetch() { return new Response('JS') } }`

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'js-no-source',
          version: '1.0.0',
          language: 'javascript',
          code: javaScriptCode,
        }),
      })

      await worker.fetch(request, mockEnv, mockCtx)

      // JS functions should not have a separate :source key
      const sourceCode = await mockCodeStorage.get('code:js-no-source:source', 'text')
      expect(sourceCode).toBeNull()
    })
  })

  describe('Compilation Errors', () => {
    it('should return meaningful error for invalid TypeScript syntax', async () => {
      const invalidCode = `
        export default {
          async fetch(request: Request): Promise<Response {
            return new Response('Missing angle bracket')
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'invalid-ts',
          version: '1.0.0',
          language: 'typescript',
          code: invalidCode,
        }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(400)
      expect(body['error']).toBeDefined()
      expect(typeof body['error']).toBe('string')
      expect((body['error'] as string).toLowerCase()).toContain('compil')
    })

    it('should not store code when compilation fails', async () => {
      const invalidCode = `
        export default {
          async fetch(request: Request {
            // Missing closing paren and type bracket
            return new Response('Broken')
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'failed-compile',
          version: '1.0.0',
          language: 'typescript',
          code: invalidCode,
        }),
      })

      await worker.fetch(request, mockEnv, mockCtx)

      // No code should be stored on compilation failure
      const storedCode = await mockCodeStorage.get('code:failed-compile', 'text')
      expect(storedCode).toBeNull()

      const storedSource = await mockCodeStorage.get('code:failed-compile:source', 'text')
      expect(storedSource).toBeNull()
    })

    it('should not create metadata entry when compilation fails', async () => {
      const invalidCode = `
        export default async broken syntax here
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'failed-metadata',
          version: '1.0.0',
          language: 'typescript',
          code: invalidCode,
        }),
      })

      await worker.fetch(request, mockEnv, mockCtx)

      // Metadata should not be created for failed compilations
      const metadata = await mockRegistry.get('registry:failed-metadata', 'json')
      expect(metadata).toBeNull()
    })

    it('should include line and column in compilation errors', async () => {
      const invalidCode = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const x: = 'invalid type annotation'
            return new Response(x)
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'error-location',
          version: '1.0.0',
          language: 'typescript',
          code: invalidCode,
        }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(400)
      // Error should include location info
      expect(body['line']).toBeDefined()
      expect(body['column']).toBeDefined()
    })
  })

  describe('Version Updates', () => {
    it('should recompile code when deploying new version', async () => {
      // Deploy v1
      const v1Code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const version: number = 1
            return Response.json({ version })
          }
        }
      `

      await worker.fetch(
        new Request('https://functions.do/api/functions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'versioned-ts',
            version: '1.0.0',
            language: 'typescript',
            code: v1Code,
          }),
        }),
        mockEnv,
        mockCtx
      )

      // Deploy v2 with different code
      const v2Code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const version: number = 2
            const newFeature: string = 'added in v2'
            return Response.json({ version, newFeature })
          }
        }
      `

      await worker.fetch(
        new Request('https://functions.do/api/functions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'versioned-ts',
            version: '2.0.0',
            language: 'typescript',
            code: v2Code,
          }),
        }),
        mockEnv,
        mockCtx
      )

      // Latest compiled code should be v2
      const latestCode = await mockCodeStorage.get('code:versioned-ts', 'text')
      expect(latestCode).toContain('newFeature')
      expect(latestCode).not.toContain(': number')
      expect(latestCode).not.toContain(': string')
    })

    it('should replace old compiled version with new', async () => {
      const oldCode = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const old: boolean = true
            return Response.json({ old })
          }
        }
      `

      await worker.fetch(
        new Request('https://functions.do/api/functions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'replace-ts',
            version: '1.0.0',
            language: 'typescript',
            code: oldCode,
          }),
        }),
        mockEnv,
        mockCtx
      )

      const newCode = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const replacement: boolean = true
            return Response.json({ replacement })
          }
        }
      `

      await worker.fetch(
        new Request('https://functions.do/api/functions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'replace-ts',
            version: '1.0.1',
            language: 'typescript',
            code: newCode,
          }),
        }),
        mockEnv,
        mockCtx
      )

      // Old code should be replaced
      const latestCode = await mockCodeStorage.get('code:replace-ts', 'text')
      expect(latestCode).toContain('replacement')
      expect(latestCode).not.toContain('old')
    })

    it('should store version-specific compiled code', async () => {
      const v1Code = `export default { fetch(): Response { return new Response('v1') } }`
      const v2Code = `export default { fetch(): Response { return new Response('v2') } }`

      await worker.fetch(
        new Request('https://functions.do/api/functions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'multi-version',
            version: '1.0.0',
            language: 'typescript',
            code: v1Code,
          }),
        }),
        mockEnv,
        mockCtx
      )

      await worker.fetch(
        new Request('https://functions.do/api/functions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'multi-version',
            version: '2.0.0',
            language: 'typescript',
            code: v2Code,
          }),
        }),
        mockEnv,
        mockCtx
      )

      // Both versions should have compiled code stored
      const v1Compiled = await mockCodeStorage.get('code:multi-version:v:1.0.0', 'text')
      const v2Compiled = await mockCodeStorage.get('code:multi-version:v:2.0.0', 'text')

      expect(v1Compiled).toContain('v1')
      expect(v2Compiled).toContain('v2')
      expect(v1Compiled).not.toContain(': Response')
      expect(v2Compiled).not.toContain(': Response')
    })
  })

  describe('Complex TypeScript', () => {
    it('should strip interfaces and type declarations', async () => {
      const code = `
        interface RequestContext {
          userId: string
          timestamp: number
          metadata: Record<string, unknown>
        }

        type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

        export default {
          async fetch(request: Request): Promise<Response> {
            const ctx: RequestContext = {
              userId: '123',
              timestamp: Date.now(),
              metadata: {}
            }
            const method: HttpMethod = request.method as HttpMethod
            return Response.json({ ctx, method })
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'complex-interfaces',
          version: '1.0.0',
          language: 'typescript',
          code,
        }),
      })

      await worker.fetch(request, mockEnv, mockCtx)

      const compiledCode = await mockCodeStorage.get('code:complex-interfaces', 'text')
      expect(compiledCode).not.toContain('interface RequestContext')
      expect(compiledCode).not.toContain('type HttpMethod')
      expect(compiledCode).not.toContain(': RequestContext')
      expect(compiledCode).not.toContain(': HttpMethod')
      expect(compiledCode).toContain('export default')
    })

    it('should compile generics correctly', async () => {
      const code = `
        function identity<T>(value: T): T {
          return value
        }

        async function processArray<T, U>(items: T[], transform: (item: T) => U): Promise<U[]> {
          return items.map(transform)
        }

        export default {
          async fetch(request: Request): Promise<Response> {
            const result = identity<number>(42)
            const mapped = await processArray<number, string>([1, 2, 3], n => String(n))
            return Response.json({ result, mapped })
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'generics-function',
          version: '1.0.0',
          language: 'typescript',
          code,
        }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)
      expect(response.status).toBe(200)

      const compiledCode = await mockCodeStorage.get('code:generics-function', 'text')
      expect(compiledCode).not.toContain('<T>')
      expect(compiledCode).not.toContain('<T, U>')
      expect(compiledCode).not.toContain(': T')
      expect(compiledCode).not.toContain(': U')
      expect(compiledCode).toContain('identity')
      expect(compiledCode).toContain('processArray')
    })

    it('should compile TSX with correct JSX pragma', async () => {
      const tsxCode = `
        /** @jsx h */
        /** @jsxFrag Fragment */

        interface Props {
          name: string
        }

        function Greeting({ name }: Props) {
          return <div>Hello, {name}!</div>
        }

        export default {
          async fetch(request: Request): Promise<Response> {
            const html = <Greeting name="World" />
            return new Response(html, {
              headers: { 'Content-Type': 'text/html' }
            })
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'tsx-function',
          version: '1.0.0',
          language: 'typescript',
          code: tsxCode,
        }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)
      expect(response.status).toBe(200)

      const compiledCode = await mockCodeStorage.get('code:tsx-function', 'text')
      // TSX should be compiled to h() calls
      expect(compiledCode).not.toContain('<div>')
      expect(compiledCode).not.toContain('interface Props')
      expect(compiledCode).toContain('h(')  // JSX pragma function calls
    })

    it('should handle enums correctly', async () => {
      const code = `
        enum Status {
          Pending = 'pending',
          Active = 'active',
          Completed = 'completed'
        }

        const enum Direction {
          Up = 1,
          Down = 2,
          Left = 3,
          Right = 4
        }

        export default {
          async fetch(request: Request): Promise<Response> {
            const status: Status = Status.Active
            const dir: Direction = Direction.Up
            return Response.json({ status, dir })
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'enum-function',
          version: '1.0.0',
          language: 'typescript',
          code,
        }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)
      expect(response.status).toBe(200)

      const compiledCode = await mockCodeStorage.get('code:enum-function', 'text')
      // Regular enums should be compiled to object patterns
      expect(compiledCode).not.toContain('enum Status')
      expect(compiledCode).not.toContain('const enum Direction')
      // Const enums should be inlined
      expect(compiledCode).not.toContain(': Status')
      expect(compiledCode).not.toContain(': Direction')
    })

    it('should preserve decorators when configured', async () => {
      const code = `
        function log(target: any, key: string, descriptor: PropertyDescriptor) {
          const original = descriptor.value
          descriptor.value = function(...args: any[]) {
            console.log(\`Calling \${key}\`)
            return original.apply(this, args)
          }
          return descriptor
        }

        class Handler {
          @log
          handle(data: unknown): string {
            return JSON.stringify(data)
          }
        }

        export default {
          async fetch(request: Request): Promise<Response> {
            const handler = new Handler()
            const body = await request.json()
            return new Response(handler.handle(body))
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'decorator-function',
          version: '1.0.0',
          language: 'typescript',
          code,
        }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)
      expect(response.status).toBe(200)

      const compiledCode = await mockCodeStorage.get('code:decorator-function', 'text')
      // Decorators should be transformed to decorator helper calls
      expect(compiledCode).not.toContain('@log')
      expect(compiledCode).toContain('Handler')
    })

    it('should compile namespace declarations', async () => {
      const code = `
        namespace Utils {
          export function capitalize(s: string): string {
            return s.charAt(0).toUpperCase() + s.slice(1)
          }

          export function lowercase(s: string): string {
            return s.toLowerCase()
          }
        }

        export default {
          async fetch(request: Request): Promise<Response> {
            const name = Utils.capitalize('world')
            return new Response(\`Hello, \${name}!\`)
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'namespace-function',
          version: '1.0.0',
          language: 'typescript',
          code,
        }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)
      expect(response.status).toBe(200)

      const compiledCode = await mockCodeStorage.get('code:namespace-function', 'text')
      // Namespace should be compiled to IIFE pattern
      expect(compiledCode).not.toContain('namespace Utils')
      expect(compiledCode).toContain('Utils')
      expect(compiledCode).toContain('capitalize')
    })
  })

  describe('Source Map Support', () => {
    it('should generate and store source maps', async () => {
      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return new Response('With source map')
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'sourcemap-function',
          version: '1.0.0',
          language: 'typescript',
          code,
        }),
      })

      await worker.fetch(request, mockEnv, mockCtx)

      // Source map should be stored
      const sourceMap = await mockCodeStorage.get('code:sourcemap-function:sourcemap', 'text')
      expect(sourceMap).toBeDefined()

      const parsed = JSON.parse(sourceMap!)
      expect(parsed.version).toBe(3)
      expect(parsed.mappings).toBeDefined()
    })
  })

  describe('Compilation Metadata in Registry', () => {
    it('should store compilation metadata in function registry', async () => {
      const code = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return new Response('Metadata test')
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'metadata-registry',
          version: '1.0.0',
          language: 'typescript',
          code,
        }),
      })

      await worker.fetch(request, mockEnv, mockCtx)

      const metadata = (await mockRegistry.get('registry:metadata-registry', 'json')) as Record<
        string,
        unknown
      >
      expect(metadata).toBeDefined()
      expect(metadata['compiled']).toBe(true)
      expect(metadata['compiledAt']).toBeDefined()
      expect(metadata['sourceSize']).toBeDefined()
      expect(metadata['compiledSize']).toBeDefined()
    })

    it('should not include compilation metadata for JavaScript functions', async () => {
      const code = `
        export default {
          async fetch(request) {
            return new Response('JS no compile metadata')
          }
        }
      `

      const request = new Request('https://functions.do/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'js-no-metadata',
          version: '1.0.0',
          language: 'javascript',
          code,
        }),
      })

      await worker.fetch(request, mockEnv, mockCtx)

      const metadata = (await mockRegistry.get('registry:js-no-metadata', 'json')) as Record<
        string,
        unknown
      >
      expect(metadata).toBeDefined()
      expect(metadata['compiled']).toBe(false)
      expect(metadata['compiledAt']).toBeUndefined()
    })
  })
})
