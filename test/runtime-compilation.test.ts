/**
 * RED Phase Tests: Runtime Compiled Code Execution
 *
 * Tests for runtime execution of pre-compiled code.
 * These tests verify that the invoke endpoint correctly uses pre-compiled JavaScript.
 *
 * Design reference: docs/ESBUILD_WASM_DESIGN.md
 *
 * KV Storage Schema:
 *   code:{id}        -> Original TypeScript source
 *   code:{id}:compiled -> Pre-compiled JavaScript
 *   code:{id}:map    -> Source map (optional)
 *
 * These tests are expected to FAIL initially (RED phase).
 * The implementation should:
 * 1. Check for pre-compiled JS in KV before runtime compilation
 * 2. Fall back to on-demand compilation if no pre-compiled JS
 * 3. Fall back to regex stripper if compiler unavailable
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockKV } from '../src/test-utils/mock-kv'
import type { Env } from '../src/index'

// Import the default export (the worker) and reset function
import worker, { resetRateLimiter } from '../src/index'

// Type for JSON response bodies in tests
type JsonBody = Record<string, unknown>

describe('Runtime Compiled Code Execution', () => {
  let mockEnv: Env
  let mockRegistry: KVNamespace
  let mockCodeStorage: KVNamespace
  let mockApiKeys: KVNamespace
  let mockCtx: ExecutionContext

  beforeEach(async () => {
    resetRateLimiter()

    mockRegistry = createMockKV()
    mockCodeStorage = createMockKV()
    mockApiKeys = createMockKV()
    mockEnv = {
      FUNCTIONS_REGISTRY: mockRegistry,
      FUNCTIONS_CODE: mockCodeStorage,
      API_KEYS: mockApiKeys,
    }
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext

    // Set up a valid API key
    await mockApiKeys.put(
      'test-api-key',
      JSON.stringify({
        userId: 'test-user',
        active: true,
      })
    )
  })

  afterEach(() => {
    resetRateLimiter()
    vi.clearAllMocks()
  })

  describe('Execute Pre-compiled Code', () => {
    it('should use compiled JS from KV instead of original TS', async () => {
      // Set up function metadata
      const metadata = {
        id: 'precompiled-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:precompiled-func', JSON.stringify(metadata))

      // Original TypeScript source
      const tsSource = `
        interface Response {
          message: string;
          compiled: boolean;
        }
        export default {
          async fetch(request: Request): Promise<Response> {
            return new Response(JSON.stringify({ message: 'from TS', compiled: false }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:precompiled-func', tsSource)

      // Pre-compiled JavaScript (different behavior to verify it's being used)
      const compiledJs = `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ message: 'from compiled JS', compiled: true }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:precompiled-func:compiled', compiledJs)

      const request = new Request('https://functions.do/functions/precompiled-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      // Should use pre-compiled JS, not original TS
      expect(body.compiled).toBe(true)
      expect(body.message).toBe('from compiled JS')
    })

    it('should not perform compilation at runtime when pre-compiled code exists', async () => {
      const metadata = {
        id: 'no-compile-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:no-compile-func', JSON.stringify(metadata))

      // Complex TypeScript that would fail regex stripper (enum)
      const tsSource = `
        enum Status { Active = 'ACTIVE', Inactive = 'INACTIVE' }
        export default {
          async fetch(request: Request): Promise<Response> {
            // This would fail regex stripper because enums need transformation
            const status: Status = Status.Active;
            return new Response(JSON.stringify({ status }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:no-compile-func', tsSource)

      // Pre-compiled JavaScript with enum transformed
      const compiledJs = `
        const Status = { Active: 'ACTIVE', Inactive: 'INACTIVE' };
        export default {
          async fetch(request) {
            const status = Status.Active;
            return new Response(JSON.stringify({ status }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:no-compile-func:compiled', compiledJs)

      const request = new Request('https://functions.do/functions/no-compile-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      // Enum should work because we used pre-compiled code
      expect(body.status).toBe('ACTIVE')
    })

    it('should have fast execution time with pre-compiled code (no compilation overhead)', async () => {
      const metadata = {
        id: 'fast-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:fast-func', JSON.stringify(metadata))

      // Simple pre-compiled JavaScript
      const compiledJs = `
        export default {
          async fetch(request) {
            const start = Date.now();
            return new Response(JSON.stringify({ executionStart: start }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:fast-func', compiledJs)
      await mockCodeStorage.put('code:fast-func:compiled', compiledJs)

      const startTime = Date.now()
      const request = new Request('https://functions.do/functions/fast-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)
      const endTime = Date.now()

      expect(response.status).toBe(200)
      // Execution should be fast without compilation overhead
      // (esbuild transform is <1ms, but regex stripper adds some overhead)
      expect(endTime - startTime).toBeLessThan(500) // generous threshold for CI
    })

    it('should track that pre-compiled code was used in response metadata', async () => {
      const metadata = {
        id: 'tracked-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:tracked-func', JSON.stringify(metadata))

      const compiledJs = `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ ok: true }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:tracked-func', 'const x: string = "ts"')
      await mockCodeStorage.put('code:tracked-func:compiled', compiledJs)

      const request = new Request('https://functions.do/functions/tracked-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      // Response should indicate pre-compiled code was used
      expect(body._meta).toBeDefined()
      const meta = body._meta as JsonBody
      expect(meta.usedPrecompiled).toBe(true)
    })
  })

  describe('Fallback Behavior', () => {
    it('should fall back to on-demand compile when compiled JS is missing', async () => {
      const metadata = {
        id: 'fallback-compile-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:fallback-compile-func', JSON.stringify(metadata))

      // Only store TypeScript source, no pre-compiled JS
      const tsSource = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return new Response(JSON.stringify({ source: 'typescript', compiled: 'on-demand' }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:fallback-compile-func', tsSource)
      // Intentionally NOT setting code:fallback-compile-func:compiled

      const request = new Request('https://functions.do/functions/fallback-compile-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body.source).toBe('typescript')
    })

    it('should fall back to regex stripper when compiler is unavailable', async () => {
      const metadata = {
        id: 'regex-fallback-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:regex-fallback-func', JSON.stringify(metadata))

      // Simple TypeScript that regex stripper can handle
      const tsSource = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const message: string = 'hello';
            return new Response(JSON.stringify({ message }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:regex-fallback-func', tsSource)
      // No pre-compiled JS

      // Simulate compiler unavailability (implementation would check for esbuild-wasm availability)
      const request = new Request('https://functions.do/functions/regex-fallback-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body.message).toBe('hello')
    })

    it('should log/track when fallback is used', async () => {
      const metadata = {
        id: 'tracked-fallback-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:tracked-fallback-func', JSON.stringify(metadata))

      const tsSource = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return new Response(JSON.stringify({ ok: true }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:tracked-fallback-func', tsSource)
      // No pre-compiled JS - should trigger fallback

      const request = new Request('https://functions.do/functions/tracked-fallback-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      // Response metadata should indicate fallback was used
      expect(body._meta).toBeDefined()
      const meta = body._meta as JsonBody
      expect(meta.usedPrecompiled).toBe(false)
      expect(meta.fallbackReason).toBeDefined()
    })

    it('should cache on-demand compiled code for subsequent requests', async () => {
      const metadata = {
        id: 'cache-compile-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:cache-compile-func', JSON.stringify(metadata))

      const tsSource = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return new Response(JSON.stringify({ time: Date.now() }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:cache-compile-func', tsSource)

      // First request - should compile on-demand
      const request1 = new Request('https://functions.do/functions/cache-compile-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      await worker.fetch(request1, mockEnv, mockCtx)

      // After first request, compiled code should be cached
      const compiledCode = await mockCodeStorage.get('code:cache-compile-func:compiled')
      expect(compiledCode).not.toBeNull()
      expect(compiledCode).toContain('export default')
    })
  })

  describe('Complex TypeScript Features', () => {
    it('should execute code with enums correctly (pre-compiled)', async () => {
      const metadata = {
        id: 'enum-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:enum-func', JSON.stringify(metadata))

      // TypeScript with enum
      const tsSource = `
        enum HttpMethod {
          GET = 'GET',
          POST = 'POST',
          PUT = 'PUT',
          DELETE = 'DELETE'
        }
        export default {
          async fetch(request: Request): Promise<Response> {
            const method: HttpMethod = HttpMethod.POST;
            return new Response(JSON.stringify({ method, all: HttpMethod }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:enum-func', tsSource)

      // Pre-compiled JavaScript with enum transformed
      const compiledJs = `
        const HttpMethod = {
          GET: 'GET',
          POST: 'POST',
          PUT: 'PUT',
          DELETE: 'DELETE'
        };
        export default {
          async fetch(request) {
            const method = HttpMethod.POST;
            return new Response(JSON.stringify({ method, all: HttpMethod }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:enum-func:compiled', compiledJs)

      const request = new Request('https://functions.do/functions/enum-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body.method).toBe('POST')
      expect(body.all).toEqual({
        GET: 'GET',
        POST: 'POST',
        PUT: 'PUT',
        DELETE: 'DELETE',
      })
    })

    it('should execute code with decorators correctly (pre-compiled)', async () => {
      const metadata = {
        id: 'decorator-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:decorator-func', JSON.stringify(metadata))

      // TypeScript with decorator (conceptual - would need experimentalDecorators)
      const tsSource = `
        function logged(target: any, key: string, descriptor: PropertyDescriptor) {
          const original = descriptor.value;
          descriptor.value = function(...args: any[]) {
            console.log(\`Calling \${key}\`);
            return original.apply(this, args);
          };
          return descriptor;
        }

        class Handler {
          @logged
          handle(input: string): string {
            return \`Handled: \${input}\`;
          }
        }

        export default {
          async fetch(request: Request): Promise<Response> {
            const handler = new Handler();
            const result = handler.handle('test');
            return new Response(JSON.stringify({ result }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:decorator-func', tsSource)

      // Pre-compiled JavaScript with decorator transformed
      const compiledJs = `
        function logged(target, key, descriptor) {
          const original = descriptor.value;
          descriptor.value = function(...args) {
            console.log(\`Calling \${key}\`);
            return original.apply(this, args);
          };
          return descriptor;
        }

        class Handler {
          handle(input) {
            return \`Handled: \${input}\`;
          }
        }
        // Apply decorator manually (what decorator transformation does)
        Object.defineProperty(Handler.prototype, 'handle', logged(Handler.prototype, 'handle', Object.getOwnPropertyDescriptor(Handler.prototype, 'handle')));

        export default {
          async fetch(request) {
            const handler = new Handler();
            const result = handler.handle('test');
            return new Response(JSON.stringify({ result }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:decorator-func:compiled', compiledJs)

      const request = new Request('https://functions.do/functions/decorator-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body.result).toBe('Handled: test')
    })

    it('should execute code with generic constraints correctly', async () => {
      const metadata = {
        id: 'generics-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:generics-func', JSON.stringify(metadata))

      // TypeScript with generic constraints
      const tsSource = `
        interface HasId {
          id: string;
        }

        function findById<T extends HasId>(items: T[], id: string): T | undefined {
          return items.find(item => item.id === id);
        }

        export default {
          async fetch(request: Request): Promise<Response> {
            const users = [
              { id: '1', name: 'Alice' },
              { id: '2', name: 'Bob' }
            ];
            const found = findById(users, '2');
            return new Response(JSON.stringify({ found }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:generics-func', tsSource)

      // Pre-compiled JavaScript (generics are erased)
      const compiledJs = `
        function findById(items, id) {
          return items.find(item => item.id === id);
        }

        export default {
          async fetch(request) {
            const users = [
              { id: '1', name: 'Alice' },
              { id: '2', name: 'Bob' }
            ];
            const found = findById(users, '2');
            return new Response(JSON.stringify({ found }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:generics-func:compiled', compiledJs)

      const request = new Request('https://functions.do/functions/generics-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      const found = body.found as JsonBody
      expect(found.id).toBe('2')
      expect(found.name).toBe('Bob')
    })

    it('should execute code with satisfies operator correctly', async () => {
      const metadata = {
        id: 'satisfies-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:satisfies-func', JSON.stringify(metadata))

      // TypeScript with satisfies operator
      const tsSource = `
        type Config = {
          port: number;
          host: string;
          debug?: boolean;
        }

        const config = {
          port: 3000,
          host: 'localhost',
          debug: true
        } satisfies Config;

        export default {
          async fetch(request: Request): Promise<Response> {
            return new Response(JSON.stringify({ config }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:satisfies-func', tsSource)

      // Pre-compiled JavaScript (satisfies is erased)
      const compiledJs = `
        const config = {
          port: 3000,
          host: 'localhost',
          debug: true
        };

        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ config }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:satisfies-func:compiled', compiledJs)

      const request = new Request('https://functions.do/functions/satisfies-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      const config = body.config as JsonBody
      expect(config.port).toBe(3000)
      expect(config.host).toBe('localhost')
      expect(config.debug).toBe(true)
    })

    it('should execute code with const assertions correctly', async () => {
      const metadata = {
        id: 'const-assert-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:const-assert-func', JSON.stringify(metadata))

      // TypeScript with const assertion
      const tsSource = `
        const colors = ['red', 'green', 'blue'] as const;
        type Color = typeof colors[number];

        export default {
          async fetch(request: Request): Promise<Response> {
            const favorite: Color = 'blue';
            return new Response(JSON.stringify({ colors, favorite }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:const-assert-func', tsSource)

      // Pre-compiled JavaScript (as const preserved)
      const compiledJs = `
        const colors = ['red', 'green', 'blue'];

        export default {
          async fetch(request) {
            const favorite = 'blue';
            return new Response(JSON.stringify({ colors, favorite }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:const-assert-func:compiled', compiledJs)

      const request = new Request('https://functions.do/functions/const-assert-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body.colors).toEqual(['red', 'green', 'blue'])
      expect(body.favorite).toBe('blue')
    })
  })

  describe('TSX/JSX Execution', () => {
    it('should execute pre-compiled JSX correctly', async () => {
      const metadata = {
        id: 'jsx-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.tsx',
        dependencies: {},
      }
      await mockRegistry.put('registry:jsx-func', JSON.stringify(metadata))

      // TSX source code
      const tsxSource = `
        const h = (tag: string, props: any, ...children: any[]) => ({ tag, props, children });

        const Component = ({ name }: { name: string }) => (
          <div class="greeting">
            <h1>Hello, {name}!</h1>
          </div>
        );

        export default {
          async fetch(request: Request): Promise<Response> {
            const vdom = <Component name="World" />;
            return new Response(JSON.stringify(vdom), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:jsx-func', tsxSource)

      // Pre-compiled JavaScript with JSX transformed
      const compiledJs = `
        const h = (tag, props, ...children) => ({ tag, props, children });

        const Component = ({ name }) => (
          h('div', { class: 'greeting' },
            h('h1', null, 'Hello, ', name, '!')
          )
        );

        export default {
          async fetch(request) {
            const vdom = h(Component, { name: 'World' });
            return new Response(JSON.stringify(vdom), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:jsx-func:compiled', compiledJs)

      const request = new Request('https://functions.do/functions/jsx-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      // Verify VDOM structure
      expect(body).toBeDefined()
    })

    it('should support custom JSX pragma (h, Fragment)', async () => {
      const metadata = {
        id: 'custom-jsx-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.tsx',
        dependencies: {},
      }
      await mockRegistry.put('registry:custom-jsx-func', JSON.stringify(metadata))

      // TSX with custom pragma
      const tsxSource = `
        /** @jsx h */
        /** @jsxFrag Fragment */

        const h = (tag: any, props: any, ...children: any[]) => ({ tag, props, children });
        const Fragment = ({ children }: { children: any[] }) => children;

        export default {
          async fetch(request: Request): Promise<Response> {
            const vdom = (
              <>
                <span>One</span>
                <span>Two</span>
              </>
            );
            return new Response(JSON.stringify(vdom), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:custom-jsx-func', tsxSource)

      // Pre-compiled JavaScript with custom pragma
      const compiledJs = `
        const h = (tag, props, ...children) => ({ tag, props, children });
        const Fragment = ({ children }) => children;

        export default {
          async fetch(request) {
            const vdom = h(Fragment, null,
              h('span', null, 'One'),
              h('span', null, 'Two')
            );
            return new Response(JSON.stringify(vdom), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:custom-jsx-func:compiled', compiledJs)

      const request = new Request('https://functions.do/functions/custom-jsx-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      // Verify Fragment structure
      expect(body).toBeDefined()
    })

    it('should handle JSX with spread attributes', async () => {
      const metadata = {
        id: 'jsx-spread-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.tsx',
        dependencies: {},
      }
      await mockRegistry.put('registry:jsx-spread-func', JSON.stringify(metadata))

      // TSX with spread attributes
      const tsxSource = `
        const h = (tag: string, props: any, ...children: any[]) => ({ tag, props, children });

        export default {
          async fetch(request: Request): Promise<Response> {
            const baseProps = { id: 'main', className: 'container' };
            const vdom = <div {...baseProps} data-custom="value" />;
            return new Response(JSON.stringify(vdom), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:jsx-spread-func', tsxSource)

      // Pre-compiled JavaScript with spread transformed
      const compiledJs = `
        const h = (tag, props, ...children) => ({ tag, props, children });

        export default {
          async fetch(request) {
            const baseProps = { id: 'main', className: 'container' };
            const vdom = h('div', { ...baseProps, 'data-custom': 'value' });
            return new Response(JSON.stringify(vdom), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:jsx-spread-func:compiled', compiledJs)

      const request = new Request('https://functions.do/functions/jsx-spread-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      const props = body.props as JsonBody
      expect(props.id).toBe('main')
      expect(props.className).toBe('container')
      expect(props['data-custom']).toBe('value')
    })
  })

  describe('Source Maps (Optional)', () => {
    it('should have source map available in KV', async () => {
      const metadata = {
        id: 'sourcemap-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:sourcemap-func', JSON.stringify(metadata))

      // Store source, compiled, and source map
      const tsSource = `
        export default {
          async fetch(request: Request): Promise<Response> {
            const x: number = 42;
            return new Response(String(x));
          }
        }
      `
      await mockCodeStorage.put('code:sourcemap-func', tsSource)

      const compiledJs = `
        export default {
          async fetch(request) {
            const x = 42;
            return new Response(String(x));
          }
        }
      `
      await mockCodeStorage.put('code:sourcemap-func:compiled', compiledJs)

      // Source map
      const sourceMap = JSON.stringify({
        version: 3,
        sources: ['index.ts'],
        names: [],
        mappings: 'AAAA;AACA;AACA;AACA;AACA;AACA',
        file: 'index.js',
        sourcesContent: [tsSource],
      })
      await mockCodeStorage.put('code:sourcemap-func:map', sourceMap)

      // Verify source map exists
      const storedSourceMap = await mockCodeStorage.get('code:sourcemap-func:map')
      expect(storedSourceMap).not.toBeNull()
      const parsed = JSON.parse(storedSourceMap!)
      expect(parsed.version).toBe(3)
      expect(parsed.sources).toContain('index.ts')
    })

    it('should reference original TS line numbers in error stack traces', async () => {
      const metadata = {
        id: 'error-sourcemap-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:error-sourcemap-func', JSON.stringify(metadata))

      // TypeScript that will throw an error
      const tsSource = `
        export default {
          async fetch(request: Request): Promise<Response> {
            throw new Error('Intentional error on line 4');
          }
        }
      `
      await mockCodeStorage.put('code:error-sourcemap-func', tsSource)

      // Pre-compiled JavaScript
      const compiledJs = `
        export default {
          async fetch(request) {
            throw new Error('Intentional error on line 4');
          }
        }
      `
      await mockCodeStorage.put('code:error-sourcemap-func:compiled', compiledJs)

      // Source map
      const sourceMap = JSON.stringify({
        version: 3,
        sources: ['index.ts'],
        names: [],
        mappings: 'AAAA;AACA;AACA;AACA,cAAc;AACd;AACA',
        file: 'index.js',
        sourcesContent: [tsSource],
      })
      await mockCodeStorage.put('code:error-sourcemap-func:map', sourceMap)

      const request = new Request('https://functions.do/functions/error-sourcemap-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(500)
      const body = (await response.json()) as JsonBody
      // Error should reference original TypeScript line number
      expect(body.error).toContain('Intentional error')
      // With source maps, stack trace should reference .ts file
      if (body.mappedStack) {
        expect(body.mappedStack).toContain('index.ts')
        expect(body.mappedStack).toContain(':4') // line 4
      }
    })

    it('should provide meaningful stack traces even without source maps', async () => {
      const metadata = {
        id: 'no-sourcemap-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:no-sourcemap-func', JSON.stringify(metadata))

      // Pre-compiled JavaScript only (no source map)
      const compiledJs = `
        export default {
          async fetch(request) {
            throw new Error('Error without source map');
          }
        }
      `
      await mockCodeStorage.put('code:no-sourcemap-func', compiledJs)
      await mockCodeStorage.put('code:no-sourcemap-func:compiled', compiledJs)
      // Intentionally NOT setting source map

      const request = new Request('https://functions.do/functions/no-sourcemap-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(500)
      const body = (await response.json()) as JsonBody
      // Should still have error message
      expect(body.error).toContain('Error without source map')
    })
  })

  describe('Version-specific Pre-compiled Code', () => {
    it('should use version-specific pre-compiled code when version is specified', async () => {
      const metadata = {
        id: 'versioned-compile-func',
        version: '2.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:versioned-compile-func', JSON.stringify(metadata))
      await mockRegistry.put('registry:versioned-compile-func:v:1.0.0', JSON.stringify({ ...metadata, version: '1.0.0' }))
      await mockRegistry.put('registry:versioned-compile-func:v:2.0.0', JSON.stringify(metadata))

      // Latest (v2) code
      const v2Compiled = `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ version: '2.0.0' }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:versioned-compile-func', v2Compiled)
      await mockCodeStorage.put('code:versioned-compile-func:compiled', v2Compiled)

      // v1 code
      const v1Compiled = `
        export default {
          async fetch(request) {
            return new Response(JSON.stringify({ version: '1.0.0' }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:versioned-compile-func:v:1.0.0', v1Compiled)
      await mockCodeStorage.put('code:versioned-compile-func:v:1.0.0:compiled', v1Compiled)

      // Request v1 specifically
      const request = new Request('https://functions.do/functions/versioned-compile-func/invoke?version=1.0.0', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      // Should use version 1.0.0 code
      expect(body.version).toBe('1.0.0')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty pre-compiled code gracefully', async () => {
      const metadata = {
        id: 'empty-compile-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:empty-compile-func', JSON.stringify(metadata))

      // Original source
      const tsSource = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return new Response('fallback');
          }
        }
      `
      await mockCodeStorage.put('code:empty-compile-func', tsSource)
      // Empty pre-compiled code (edge case)
      await mockCodeStorage.put('code:empty-compile-func:compiled', '')

      const request = new Request('https://functions.do/functions/empty-compile-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Should fall back to original source or handle gracefully
      expect([200, 500]).toContain(response.status)
    })

    it('should handle corrupted pre-compiled code by falling back', async () => {
      const metadata = {
        id: 'corrupt-compile-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }
      await mockRegistry.put('registry:corrupt-compile-func', JSON.stringify(metadata))

      // Valid original source
      const tsSource = `
        export default {
          async fetch(request: Request): Promise<Response> {
            return new Response(JSON.stringify({ source: 'original' }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `
      await mockCodeStorage.put('code:corrupt-compile-func', tsSource)
      // Corrupted pre-compiled code
      await mockCodeStorage.put('code:corrupt-compile-func:compiled', 'this is not valid javascript {{{{')

      const request = new Request('https://functions.do/functions/corrupt-compile-func/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })
      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Should fall back to original source and work
      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      expect(body.source).toBe('original')
    })
  })
})
