/**
 * Template Literals Tests
 *
 * Tests for the tagged template literal functions that enable inline
 * multi-language function definitions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  typescript,
  javascript,
  rust,
  go,
  python,
  csharp,
  zig,
  assemblyscript,
  type InlineFunction,
  type SupportedLanguage,
} from '../template-literals'

describe('Template Literals', () => {
  describe('Basic Function Definition', () => {
    it('should create a TypeScript function with typescript tag', () => {
      const fn = typescript`
        export default async (request: Request) => {
          return new Response('Hello, World!')
        }
      `

      expect(fn).toBeDefined()
      expect(fn.language).toBe('typescript')
      expect(fn.code).toContain('export default async')
      expect(fn.code).toContain('Hello, World!')
    })

    it('should create a JavaScript function with javascript tag', () => {
      const fn = javascript`
        export default async (request) => {
          return new Response('Hello from JS!')
        }
      `

      expect(fn).toBeDefined()
      expect(fn.language).toBe('javascript')
      expect(fn.code).toContain('export default async')
    })

    it('should create a Rust function with rust tag', () => {
      const fn = rust`
        use wasm_bindgen::prelude::*;

        #[wasm_bindgen]
        pub fn greet(name: &str) -> String {
          format!("Hello, {}!", name)
        }
      `

      expect(fn).toBeDefined()
      expect(fn.language).toBe('rust')
      expect(fn.code).toContain('wasm_bindgen')
      expect(fn.code).toContain('pub fn greet')
    })

    it('should create a Go function with go tag', () => {
      const fn = go`
        package main

        //go:wasmexport hello
        func hello(name string) string {
          return "Hello, " + name + "!"
        }
      `

      expect(fn).toBeDefined()
      expect(fn.language).toBe('go')
      expect(fn.code).toContain('package main')
      expect(fn.code).toContain('wasmexport')
    })

    it('should create a Python function with python tag', () => {
      const fn = python`
        def handler(request):
          return {"message": "Hello from Python!"}
      `

      expect(fn).toBeDefined()
      expect(fn.language).toBe('python')
      expect(fn.code).toContain('def handler')
    })

    it('should create a C# function with csharp tag', () => {
      const fn = csharp`
        public class Handler {
          public static string Hello(string name) => $"Hello, {name}!";
        }
      `

      expect(fn).toBeDefined()
      expect(fn.language).toBe('csharp')
      expect(fn.code).toContain('public class Handler')
    })

    it('should create a Zig function with zig tag', () => {
      const fn = zig`
        export fn add(a: i32, b: i32) i32 {
          return a + b;
        }
      `

      expect(fn).toBeDefined()
      expect(fn.language).toBe('zig')
      expect(fn.code).toContain('export fn add')
    })

    it('should create an AssemblyScript function with assemblyscript tag', () => {
      const fn = assemblyscript`
        export function add(a: i32, b: i32): i32 {
          return a + b;
        }
      `

      expect(fn).toBeDefined()
      expect(fn.language).toBe('assemblyscript')
      expect(fn.code).toContain('export function add')
    })
  })

  describe('Template Interpolation', () => {
    it('should interpolate string values', () => {
      const name = 'World'
      const fn = typescript`
        export default () => "Hello, ${name}!"
      `

      expect(fn.code).toContain('Hello, World!')
    })

    it('should interpolate number values', () => {
      const count = 42
      const fn = typescript`
        export default () => ${count}
      `

      expect(fn.code).toContain('42')
    })

    it('should interpolate multiple values', () => {
      const a = 'foo'
      const b = 'bar'
      const c = 123
      const fn = typescript`
        const first = "${a}";
        const second = "${b}";
        const third = ${c};
      `

      expect(fn.code).toContain('"foo"')
      expect(fn.code).toContain('"bar"')
      expect(fn.code).toContain('123')
    })

    it('should handle undefined interpolation values', () => {
      const value = undefined
      const fn = typescript`
        const x = ${value};
      `

      // undefined should be treated as empty string
      expect(fn.code).toContain('const x = ;')
    })

    it('should convert objects to strings', () => {
      const obj = { key: 'value' }
      const fn = typescript`
        const config = ${obj};
      `

      expect(fn.code).toContain('[object Object]')
    })
  })

  describe('Code Trimming', () => {
    it('should trim leading and trailing whitespace', () => {
      const fn = typescript`


        export default () => "test"


      `

      expect(fn.code).toBe('export default () => "test"')
    })

    it('should preserve internal whitespace and indentation', () => {
      const fn = typescript`export default () => {
    const x = 1;
    const y = 2;
    return x + y;
  }`

      expect(fn.code).toContain('    const x = 1;')
      expect(fn.code).toContain('    const y = 2;')
    })
  })

  describe('InlineFunction Interface', () => {
    it('should have code property', () => {
      const fn = typescript`const x = 1;`
      expect(typeof fn.code).toBe('string')
      expect(fn.code).toBe('const x = 1;')
    })

    it('should have language property', () => {
      const fn = rust`fn main() {}`
      expect(fn.language).toBe('rust')
    })

    it('should have compile method', () => {
      const fn = typescript`export default () => "test"`
      expect(typeof fn.compile).toBe('function')
    })

    it('should have deploy method', () => {
      const fn = typescript`export default () => "test"`
      expect(typeof fn.deploy).toBe('function')
    })
  })

  describe('All Supported Languages', () => {
    const languageTags: Array<[string, (strings: TemplateStringsArray, ...values: unknown[]) => InlineFunction]> = [
      ['typescript', typescript],
      ['javascript', javascript],
      ['rust', rust],
      ['go', go],
      ['python', python],
      ['csharp', csharp],
      ['zig', zig],
      ['assemblyscript', assemblyscript],
    ]

    it.each(languageTags)('should create %s function with correct language', (expectedLang, tag) => {
      const fn = tag`const code = true;`
      expect(fn.language).toBe(expectedLang)
    })

    it.each(languageTags)('should preserve code content for %s', (_, tag) => {
      const fn = tag`function test() { return 42; }`
      expect(fn.code).toContain('function test()')
      expect(fn.code).toContain('return 42')
    })
  })

  describe('compile() Method', () => {
    beforeEach(() => {
      vi.resetModules()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should return a Promise', () => {
      const fn = typescript`export default () => "test"`
      const result = fn.compile()
      expect(result).toBeInstanceOf(Promise)
    })

    it('should compile TypeScript code', async () => {
      // Mock the TypeScript compiler import
      vi.doMock('../languages/typescript/compile', () => ({
        compileTypeScript: vi.fn().mockResolvedValue({
          code: 'export default () => "test"',
          map: null,
        }),
      }))

      // Re-import to get mocked version
      const { typescript: ts } = await import('../template-literals')
      const fn = ts`export default () => "test"`

      const compiled = await fn.compile()

      expect(compiled).toBeDefined()
      expect(compiled.metadata).toBeDefined()
      expect(compiled.metadata.language).toBe('typescript')
      expect(typeof compiled.metadata.originalSize).toBe('number')
      expect(typeof compiled.metadata.compiledSize).toBe('number')
      expect(typeof compiled.metadata.compilationTimeMs).toBe('number')
    })

    it('should compile JavaScript code', async () => {
      vi.doMock('../languages/typescript/compile', () => ({
        compileTypeScript: vi.fn().mockResolvedValue({
          code: 'export default () => "test"',
          map: null,
        }),
      }))

      const { javascript: js } = await import('../template-literals')
      const fn = js`export default () => "test"`

      const compiled = await fn.compile()

      expect(compiled).toBeDefined()
      expect(compiled.metadata.language).toBe('javascript')
    })

    it('should compile Python code (returns source)', async () => {
      const fn = python`
        def handler(data):
          return {"result": data}
      `

      const compiled = await fn.compile()

      expect(compiled).toBeDefined()
      // Python returns the original code (not compiled)
      expect(typeof compiled.output).toBe('string')
      expect(compiled.output).toContain('def handler(data)')
      expect(compiled.metadata.language).toBe('python')
    })

    it('should compile C# code (returns source)', async () => {
      const fn = csharp`
        public class Handler {
          public static string Run() => "test";
        }
      `

      const compiled = await fn.compile()

      expect(compiled).toBeDefined()
      // C# returns the original code for distributed runtime
      expect(typeof compiled.output).toBe('string')
      expect(compiled.output).toContain('public class Handler')
      expect(compiled.metadata.language).toBe('csharp')
    })

    it('should include compilation time in metadata', async () => {
      const fn = python`def test(): pass`

      const compiled = await fn.compile()

      expect(compiled.metadata.compilationTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('should include original and compiled sizes', async () => {
      const code = 'def handler(): return "hello"'
      const fn = python`${code}`

      const compiled = await fn.compile()

      expect(compiled.metadata.originalSize).toBeGreaterThan(0)
      expect(compiled.metadata.compiledSize).toBeGreaterThan(0)
    })
  })

  describe('deploy() Method', () => {
    let originalFetch: typeof fetch

    beforeEach(() => {
      originalFetch = global.fetch
      vi.resetModules()
    })

    afterEach(() => {
      global.fetch = originalFetch
      vi.restoreAllMocks()
    })

    it('should throw error when API key is not set', async () => {
      const fn = python`def handler(): pass`

      await expect(fn.deploy()).rejects.toThrow('API key required')
    })

    it('should use API key from options', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'fn-123',
          version: '1.0.0',
          url: 'https://functions.do/functions/fn-123',
        }),
      })

      const fn = python`def handler(): pass`
      await fn.deploy({ apiKey: 'test-api-key' })

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'test-api-key',
          }),
        })
      )
    })

    it('should use custom base URL when provided', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'fn-123',
          version: '1.0.0',
          url: 'https://custom.api.com/functions/fn-123',
        }),
      })

      const fn = python`def handler(): pass`
      await fn.deploy({ apiKey: 'test-key', baseUrl: 'https://custom.api.com' })

      expect(global.fetch).toHaveBeenCalledWith(
        'https://custom.api.com/api/functions',
        expect.any(Object)
      )
    })

    it('should generate function ID when not provided', async () => {
      let capturedBody: string | null = null
      global.fetch = vi.fn().mockImplementation(async (_, options) => {
        capturedBody = options?.body as string
        return {
          ok: true,
          json: async () => ({
            id: 'fn-auto-generated',
            version: '1.0.0',
            url: 'https://functions.do/functions/fn-auto-generated',
          }),
        }
      })

      const fn = python`def handler(): pass`
      await fn.deploy({ apiKey: 'test-key' })

      expect(capturedBody).toBeDefined()
      const body = JSON.parse(capturedBody!)
      expect(body.id).toMatch(/^fn-\d+-[a-z0-9]+$/)
    })

    it('should use provided function ID', async () => {
      let capturedBody: string | null = null
      global.fetch = vi.fn().mockImplementation(async (_, options) => {
        capturedBody = options?.body as string
        return {
          ok: true,
          json: async () => ({
            id: 'my-custom-fn',
            version: '1.0.0',
            url: 'https://functions.do/functions/my-custom-fn',
          }),
        }
      })

      const fn = python`def handler(): pass`
      await fn.deploy({ apiKey: 'test-key', id: 'my-custom-fn' })

      const body = JSON.parse(capturedBody!)
      expect(body.id).toBe('my-custom-fn')
    })

    it('should throw error on deployment failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        text: async () => 'Deployment quota exceeded',
      })

      const fn = python`def handler(): pass`

      await expect(fn.deploy({ apiKey: 'test-key' })).rejects.toThrow('Deployment failed')
    })

    it('should return deployed function with invoke method', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'fn-123',
          version: '1.0.0',
          url: 'https://functions.do/functions/fn-123',
        }),
      })

      const fn = python`def handler(): pass`
      const deployed = await fn.deploy({ apiKey: 'test-key' })

      expect(deployed.id).toBe('fn-123')
      expect(deployed.version).toBe('1.0.0')
      expect(deployed.url).toBe('https://functions.do/functions/fn-123')
      expect(typeof deployed.invoke).toBe('function')
    })

    it('should allow invoking deployed function', async () => {
      let invokeCount = 0
      global.fetch = vi.fn().mockImplementation(async () => {
        if (invokeCount === 0) {
          invokeCount++
          return {
            ok: true,
            json: async () => ({
              id: 'fn-123',
              version: '1.0.0',
              url: 'https://functions.do/functions/fn-123',
            }),
          }
        }
        return {
          ok: true,
          json: async () => ({ result: 'invoked successfully' }),
        }
      })

      const fn = python`def handler(data): return {"result": "invoked successfully"}`
      const deployed = await fn.deploy({ apiKey: 'test-key' })
      const result = await deployed.invoke({ input: 'test' })

      expect(result).toEqual({ result: 'invoked successfully' })
    })

    it('should include deployment metadata in request body', async () => {
      let capturedBody: string | null = null
      global.fetch = vi.fn().mockImplementation(async (_, options) => {
        capturedBody = options?.body as string
        return {
          ok: true,
          json: async () => ({
            id: 'fn-123',
            version: '2.0.0',
            url: 'https://functions.do/functions/fn-123',
          }),
        }
      })

      // Use Python to avoid TypeScript compilation issues in tests
      const fn = python`def handler(): return "test"`
      await fn.deploy({
        apiKey: 'test-key',
        id: 'my-fn',
        version: '2.0.0',
        entryPoint: 'main.py',
        dependencies: { requests: '^2.28.0' },
      })

      const body = JSON.parse(capturedBody!)
      expect(body.id).toBe('my-fn')
      expect(body.version).toBe('2.0.0')
      expect(body.entryPoint).toBe('main.py')
      expect(body.dependencies).toEqual({ requests: '^2.28.0' })
      expect(body.language).toBe('python')
    })
  })

  describe('Error Cases', () => {
    it('should handle empty template', () => {
      const fn = typescript``
      expect(fn.code).toBe('')
      expect(fn.language).toBe('typescript')
    })

    it('should handle template with only whitespace', () => {
      const fn = typescript`

         `
      expect(fn.code).toBe('')
    })

    it('should handle special characters in code', () => {
      const fn = typescript`
        const regex = /[a-z]+\\/\\d+/;
        const str = "Hello\\nWorld";
      `
      expect(fn.code).toContain('regex')
      expect(fn.code).toContain('str')
    })

    it('should handle backticks in interpolated values', () => {
      const value = 'text with `backticks`'
      const fn = typescript`const x = "${value}";`
      expect(fn.code).toContain('backticks')
    })

    it('should handle Unicode characters', () => {
      const fn = typescript`
        const greeting = "Hello, \u4e16\u754c!"; // Chinese for "world"
        const emoji = "\u{1F600}";
      `
      expect(fn.code).toContain('greeting')
      expect(fn.code).toContain('emoji')
    })
  })

  describe('Type Safety', () => {
    it('should return InlineFunction type', () => {
      const fn: InlineFunction = typescript`export default () => "test"`

      // These should compile without errors
      const code: string = fn.code
      const lang: SupportedLanguage = fn.language
      const compileMethod: () => Promise<unknown> = fn.compile

      expect(code).toBeDefined()
      expect(lang).toBeDefined()
      expect(compileMethod).toBeDefined()
    })

    it('should support all SupportedLanguage values', () => {
      const languages: SupportedLanguage[] = [
        'typescript',
        'javascript',
        'rust',
        'go',
        'python',
        'csharp',
        'zig',
        'assemblyscript',
      ]

      for (const lang of languages) {
        expect(typeof lang).toBe('string')
      }
    })
  })
})
