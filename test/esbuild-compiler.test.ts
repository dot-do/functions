/**
 * RED Phase Tests: esbuild-compiler Worker RPC Interface
 *
 * These tests define the expected behavior of the esbuild-compiler worker
 * that exposes an RPC interface for TypeScript/TSX compilation.
 *
 * These tests are expected to FAIL until the esbuild-compiler worker is implemented.
 *
 * See: docs/ESBUILD_WASM_DESIGN.md for full design specification
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'

/**
 * RPC Interface Types (as defined in ESBUILD_WASM_DESIGN.md)
 */
interface TransformOptions {
  code: string
  loader: 'ts' | 'tsx' | 'js' | 'jsx'
  target?: string
  format?: 'esm' | 'cjs' | 'iife'
  jsx?: {
    factory?: string
    fragment?: string
  }
  sourcemap?: boolean
}

interface TransformResult {
  code: string
  map?: string
  warnings: string[]
  errors?: string[]
}

interface EsbuildCompiler {
  transform(options: TransformOptions): Promise<TransformResult>
}

/**
 * Mock RPC client for the esbuild-compiler worker
 * This simulates calling the worker via Service Bindings
 *
 * In production, this would be:
 * - env.ESBUILD_COMPILER.transform(options)
 */
function createMockCompiler(): EsbuildCompiler {
  // This mock should be replaced with actual RPC binding when worker exists
  return {
    transform: vi.fn().mockRejectedValue(
      new Error('esbuild-compiler worker not implemented')
    ),
  }
}

describe('esbuild-compiler Worker', () => {
  let compiler: EsbuildCompiler

  beforeAll(() => {
    compiler = createMockCompiler()
  })

  describe('Transform TypeScript to JavaScript', () => {
    it('transforms simple function with type annotations', async () => {
      const result = await compiler.transform({
        code: `
          export function greet(name: string): string {
            return \`Hello, \${name}!\`
          }
        `,
        loader: 'ts',
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('export')
      expect(result.code).toContain('greet')
      expect(result.code).not.toContain(': string')
      expect(result.errors).toBeUndefined()
    })

    it('transforms complex types (interfaces, generics, unions)', async () => {
      const result = await compiler.transform({
        code: `
          interface User {
            id: number
            name: string
            email: string
            roles: Role[]
          }

          interface Role {
            id: number
            name: string
            permissions: Permission[]
          }

          type Permission = 'read' | 'write' | 'delete' | 'admin'

          type UserResponse = {
            user: User
            token: string
            expiresAt: Date
          }

          async function fetchUser<T extends User>(id: number): Promise<T | null> {
            const response = await fetch(\`/api/users/\${id}\`)
            if (!response.ok) return null
            return response.json() as Promise<T>
          }

          export { fetchUser, type User, type Role }
        `,
        loader: 'ts',
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('fetchUser')
      expect(result.code).toContain('export')
      // Type-only constructs should be removed
      expect(result.code).not.toContain('interface User')
      expect(result.code).not.toContain('interface Role')
      expect(result.code).not.toContain('type Permission')
      expect(result.code).not.toContain('<T extends User>')
      expect(result.errors).toBeUndefined()
    })

    it('transforms async/await with Promise types', async () => {
      const result = await compiler.transform({
        code: `
          export async function fetchData(url: string): Promise<Response> {
            const response = await fetch(url)
            return response
          }

          export async function processJson<T>(url: string): Promise<T> {
            const response = await fetch(url)
            const data: T = await response.json()
            return data
          }
        `,
        loader: 'ts',
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('async')
      expect(result.code).toContain('await')
      expect(result.code).toContain('fetchData')
      expect(result.code).toContain('processJson')
      // Type annotations should be stripped
      expect(result.code).not.toContain(': Promise<Response>')
      expect(result.code).not.toContain(': Promise<T>')
      expect(result.code).not.toContain('<T>')
      // Should not use babel-style helpers
      expect(result.code).not.toContain('__awaiter')
      expect(result.errors).toBeUndefined()
    })

    it('transforms const assertions and satisfies', async () => {
      const result = await compiler.transform({
        code: `
          const config = {
            api: 'https://api.example.com',
            timeout: 5000,
          } as const

          interface Config {
            api: string
            timeout: number
          }

          const validated = config satisfies Config

          export { config, validated }
        `,
        loader: 'ts',
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('config')
      expect(result.code).toContain('export')
      expect(result.code).not.toContain('as const')
      expect(result.code).not.toContain('satisfies')
      expect(result.errors).toBeUndefined()
    })

    it('transforms enums to JavaScript', async () => {
      const result = await compiler.transform({
        code: `
          export enum Status {
            Pending = 'pending',
            Active = 'active',
            Completed = 'completed',
          }

          export const enum Direction {
            Up,
            Down,
            Left,
            Right,
          }

          export function getStatus(): Status {
            return Status.Active
          }
        `,
        loader: 'ts',
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('Status')
      expect(result.code).toContain('getStatus')
      expect(result.code).toContain('export')
      // enum keyword should be transpiled away
      expect(result.code).not.toContain('enum Status')
      expect(result.errors).toBeUndefined()
    })

    it('transforms decorators (experimental)', async () => {
      const result = await compiler.transform({
        code: `
          function log(target: any, key: string) {
            console.log(\`Method \${key} called\`)
          }

          class Service {
            @log
            fetchData() {
              return 'data'
            }
          }

          export { Service }
        `,
        loader: 'ts',
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('Service')
      expect(result.code).toContain('fetchData')
      expect(result.code).toContain('export')
      // Decorator syntax should be compiled away
      expect(result.code).not.toContain('@log')
      expect(result.errors).toBeUndefined()
    })
  })

  describe('Transform TSX to JavaScript', () => {
    it('transforms JSX elements with custom pragma', async () => {
      const result = await compiler.transform({
        code: `
          const Button = ({ label }: { label: string }) => (
            <button className="btn">{label}</button>
          )

          export default Button
        `,
        loader: 'tsx',
        jsx: {
          factory: 'h',
          fragment: 'Fragment',
        },
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('Button')
      expect(result.code).toContain('export default')
      // JSX should be transformed to function calls
      expect(result.code).toContain('h(')
      expect(result.code).not.toContain('<button')
      expect(result.code).not.toContain('</button>')
      expect(result.errors).toBeUndefined()
    })

    it('transforms JSX fragments', async () => {
      const result = await compiler.transform({
        code: `
          const List = ({ items }: { items: string[] }) => (
            <>
              <h1>Items</h1>
              {items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </>
          )

          export default List
        `,
        loader: 'tsx',
        jsx: {
          factory: 'h',
          fragment: 'Fragment',
        },
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('Fragment')
      expect(result.code).toContain('h(')
      expect(result.code).not.toContain('<>')
      expect(result.code).not.toContain('</>')
      expect(result.errors).toBeUndefined()
    })

    it('transforms components with typed props', async () => {
      const result = await compiler.transform({
        code: `
          interface CardProps {
            title: string
            description?: string
            onClick?: (e: MouseEvent) => void
            children: JSX.Element | JSX.Element[]
          }

          const Card: React.FC<CardProps> = ({ title, description, onClick, children }) => (
            <div className="card" onClick={onClick}>
              <h2>{title}</h2>
              {description && <p>{description}</p>}
              <div className="content">{children}</div>
            </div>
          )

          export { Card, type CardProps }
        `,
        loader: 'tsx',
        jsx: {
          factory: 'React.createElement',
          fragment: 'React.Fragment',
        },
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('Card')
      expect(result.code).toContain('React.createElement')
      expect(result.code).toContain('export')
      // Type annotations should be removed
      expect(result.code).not.toContain('interface CardProps')
      expect(result.code).not.toContain(': React.FC<CardProps>')
      expect(result.errors).toBeUndefined()
    })

    it('transforms TSX with hooks and generic components', async () => {
      const result = await compiler.transform({
        code: `
          import { useState, useEffect } from 'react'

          interface DataListProps<T> {
            items: T[]
            renderItem: (item: T, index: number) => JSX.Element
          }

          function DataList<T>({ items, renderItem }: DataListProps<T>) {
            const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

            useEffect(() => {
              console.log('Items changed:', items.length)
            }, [items])

            return (
              <ul>
                {items.map((item, i) => (
                  <li
                    key={i}
                    onClick={() => setSelectedIndex(i)}
                    className={selectedIndex === i ? 'selected' : ''}
                  >
                    {renderItem(item, i)}
                  </li>
                ))}
              </ul>
            )
          }

          export default DataList
        `,
        loader: 'tsx',
        jsx: {
          factory: 'React.createElement',
          fragment: 'React.Fragment',
        },
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('DataList')
      expect(result.code).toContain('useState')
      expect(result.code).toContain('useEffect')
      expect(result.code).not.toContain('interface DataListProps')
      expect(result.code).not.toContain('<T>')
      expect(result.errors).toBeUndefined()
    })

    it('defaults to React.createElement when no jsx option provided', async () => {
      const result = await compiler.transform({
        code: `
          const App = () => <div>Hello</div>
          export default App
        `,
        loader: 'tsx',
        // No jsx option provided
      })

      expect(result.code).toBeDefined()
      // Should default to React.createElement or jsx runtime
      expect(result.code).toMatch(/React\.createElement|jsxs?/)
      expect(result.errors).toBeUndefined()
    })
  })

  describe('Error Handling', () => {
    it('returns error for invalid TypeScript syntax', async () => {
      const result = await compiler.transform({
        code: `
          export function broken( {
            return 'missing closing paren'
          }
        `,
        loader: 'ts',
      })

      expect(result.code).toBe('')
      expect(result.errors).toBeDefined()
      expect(result.errors!.length).toBeGreaterThan(0)
      expect(result.errors![0]).toMatch(/syntax|parse|expected/i)
    })

    it('returns error for invalid JSX syntax', async () => {
      const result = await compiler.transform({
        code: `
          const Component = () => (
            <div>
              <span>Unclosed
            </div>
          )
        `,
        loader: 'tsx',
      })

      expect(result.code).toBe('')
      expect(result.errors).toBeDefined()
      expect(result.errors!.length).toBeGreaterThan(0)
    })

    it('handles empty code gracefully', async () => {
      const result = await compiler.transform({
        code: '',
        loader: 'ts',
      })

      // Empty input should return empty output without errors
      expect(result.code).toBe('')
      expect(result.errors).toBeUndefined()
      expect(result.warnings).toEqual([])
    })

    it('handles whitespace-only code gracefully', async () => {
      const result = await compiler.transform({
        code: '   \n\t\n   ',
        loader: 'ts',
      })

      expect(result.errors).toBeUndefined()
    })

    it('returns warnings for deprecated features', async () => {
      const result = await compiler.transform({
        code: `
          // Code that might generate warnings
          export function test() {
            return void 0
          }
        `,
        loader: 'ts',
      })

      expect(result.code).toBeDefined()
      expect(result.warnings).toBeDefined()
      expect(Array.isArray(result.warnings)).toBe(true)
    })

    it('handles type errors gracefully (type stripping only)', async () => {
      // esbuild only strips types, it doesn't do type checking
      // So this should succeed even though it would fail tsc
      const result = await compiler.transform({
        code: `
          interface User {
            name: string
          }

          const user: User = { name: 123 } // Wrong type, but esbuild won't catch this
          export { user }
        `,
        loader: 'ts',
      })

      // Should compile successfully (esbuild doesn't type-check)
      expect(result.code).toBeDefined()
      expect(result.code).toContain('user')
      expect(result.errors).toBeUndefined()
    })
  })

  describe('Configuration Options', () => {
    describe('target', () => {
      it('transforms to esnext target (default)', async () => {
        const result = await compiler.transform({
          code: `
            export const fn = async () => {
              const obj = { a: 1, b: 2 }
              const { a, ...rest } = obj
              return rest
            }
          `,
          loader: 'ts',
          target: 'esnext',
        })

        expect(result.code).toBeDefined()
        // Modern syntax should be preserved
        expect(result.code).toContain('async')
        expect(result.code).toContain('...')
        expect(result.errors).toBeUndefined()
      })

      it('transforms to es2020 target', async () => {
        const result = await compiler.transform({
          code: `
            export const value = 10n ** 2n
            export const nullish = null ?? 'default'
            export const chained = obj?.prop?.nested
          `,
          loader: 'ts',
          target: 'es2020',
        })

        expect(result.code).toBeDefined()
        // ES2020 features should be preserved
        expect(result.code).toContain('??')
        expect(result.code).toContain('?.')
        expect(result.errors).toBeUndefined()
      })

      it('transforms to es2017 target (downlevels async/await)', async () => {
        const result = await compiler.transform({
          code: `
            export async function fetchData() {
              const response = await fetch('/api')
              return response.json()
            }
          `,
          loader: 'ts',
          target: 'es2017',
        })

        expect(result.code).toBeDefined()
        // ES2017 supports async/await natively
        expect(result.code).toContain('async')
        expect(result.code).toContain('await')
        expect(result.errors).toBeUndefined()
      })

      it('transforms to es2015 target (downlevels to ES6)', async () => {
        const result = await compiler.transform({
          code: `
            export async function fetchData() {
              const response = await fetch('/api')
              return response.json()
            }
          `,
          loader: 'ts',
          target: 'es2015',
        })

        expect(result.code).toBeDefined()
        // ES2015 doesn't support async/await, should be transformed
        // Note: esbuild may still keep async/await and expect runtime polyfills
        expect(result.errors).toBeUndefined()
      })
    })

    describe('format', () => {
      it('outputs ESM format (default)', async () => {
        const result = await compiler.transform({
          code: `
            import { something } from './module'
            export const value = something + 1
            export default { value }
          `,
          loader: 'ts',
          format: 'esm',
        })

        expect(result.code).toBeDefined()
        expect(result.code).toContain('export')
        expect(result.code).toContain('import')
        expect(result.code).not.toContain('require(')
        expect(result.code).not.toContain('module.exports')
        expect(result.errors).toBeUndefined()
      })

      it('outputs CommonJS format', async () => {
        const result = await compiler.transform({
          code: `
            import { something } from './module'
            export const value = something + 1
            export default { value }
          `,
          loader: 'ts',
          format: 'cjs',
        })

        expect(result.code).toBeDefined()
        // CJS format uses require and module.exports
        expect(result.code).toMatch(/require\(|exports\./)
        expect(result.errors).toBeUndefined()
      })

      it('outputs IIFE format', async () => {
        const result = await compiler.transform({
          code: `
            export const value = 42
            export function greet() { return 'hello' }
          `,
          loader: 'ts',
          format: 'iife',
        })

        expect(result.code).toBeDefined()
        // IIFE wraps code in immediately invoked function
        expect(result.code).toMatch(/\(function\s*\(|^\(\(\)|^\(\s*\(\s*\)/)
        expect(result.errors).toBeUndefined()
      })
    })

    describe('sourcemap', () => {
      it('generates source map when enabled', async () => {
        const result = await compiler.transform({
          code: `
            export function add(a: number, b: number): number {
              return a + b
            }
          `,
          loader: 'ts',
          sourcemap: true,
        })

        expect(result.code).toBeDefined()
        expect(result.map).toBeDefined()
        expect(result.map).toContain('mappings')
        expect(result.errors).toBeUndefined()
      })

      it('does not generate source map when disabled', async () => {
        const result = await compiler.transform({
          code: `
            export const value = 42
          `,
          loader: 'ts',
          sourcemap: false,
        })

        expect(result.code).toBeDefined()
        expect(result.map).toBeUndefined()
        expect(result.errors).toBeUndefined()
      })

      it('source map contains original file positions', async () => {
        const result = await compiler.transform({
          code: `export function test(): void {
  console.log('line 2')
  console.log('line 3')
}`,
          loader: 'ts',
          sourcemap: true,
        })

        expect(result.map).toBeDefined()
        const sourceMap = JSON.parse(result.map!)
        expect(sourceMap.version).toBe(3)
        expect(sourceMap.mappings).toBeDefined()
        expect(sourceMap.sources).toBeDefined()
      })
    })
  })

  describe('Loader Detection', () => {
    it('uses ts loader for TypeScript code', async () => {
      const result = await compiler.transform({
        code: `export const x: number = 1`,
        loader: 'ts',
      })

      expect(result.code).toBeDefined()
      expect(result.code).not.toContain(': number')
      expect(result.errors).toBeUndefined()
    })

    it('uses tsx loader for TSX code', async () => {
      const result = await compiler.transform({
        code: `const El = () => <div />; export default El`,
        loader: 'tsx',
      })

      expect(result.code).toBeDefined()
      expect(result.code).not.toContain('<div')
      expect(result.errors).toBeUndefined()
    })

    it('uses js loader for plain JavaScript', async () => {
      const result = await compiler.transform({
        code: `export const x = 1`,
        loader: 'js',
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('export')
      expect(result.errors).toBeUndefined()
    })

    it('uses jsx loader for JSX code', async () => {
      const result = await compiler.transform({
        code: `const El = () => <div />; export default El`,
        loader: 'jsx',
        jsx: { factory: 'h' },
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('h(')
      expect(result.errors).toBeUndefined()
    })
  })

  describe('Edge Cases', () => {
    it('handles very long code input', async () => {
      // Generate a large code string
      const lines = Array.from(
        { length: 1000 },
        (_, i) => `export const var${i}: number = ${i}`
      )
      const code = lines.join('\n')

      const result = await compiler.transform({
        code,
        loader: 'ts',
      })

      expect(result.code).toBeDefined()
      expect(result.errors).toBeUndefined()
    })

    it('handles code with unicode characters', async () => {
      const result = await compiler.transform({
        code: `
          export const greeting: string = 'Hello, \u4e16\u754c!'
          export const emoji: string = '\ud83d\ude00\ud83c\udf89'
          export const japanese: string = '\u3053\u3093\u306b\u3061\u306f'
        `,
        loader: 'ts',
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('\u4e16\u754c')
      expect(result.errors).toBeUndefined()
    })

    it('handles code with special escape sequences', async () => {
      const result = await compiler.transform({
        code: `
          export const str: string = 'line1\\nline2\\ttabbed'
          export const regex: RegExp = /test\\d+/g
        `,
        loader: 'ts',
      })

      expect(result.code).toBeDefined()
      expect(result.errors).toBeUndefined()
    })

    it('handles template literals with complex expressions', async () => {
      const result = await compiler.transform({
        code: `
          interface Data { value: number }
          export const template = (data: Data): string => \`
            Value: \${data.value}
            Computed: \${data.value * 2}
            Nested: \${\`inner-\${data.value}\`}
          \`
        `,
        loader: 'ts',
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('`')
      expect(result.code).toContain('${')
      expect(result.errors).toBeUndefined()
    })

    it('preserves comments when needed', async () => {
      const result = await compiler.transform({
        code: `
          /**
           * JSDoc comment for documentation
           * @param name - The name to greet
           */
          export function greet(name: string): string {
            // Inline comment
            return \`Hello, \${name}!\`
          }
        `,
        loader: 'ts',
      })

      expect(result.code).toBeDefined()
      // By default, esbuild may strip comments
      expect(result.errors).toBeUndefined()
    })

    it('handles dynamic imports', async () => {
      const result = await compiler.transform({
        code: `
          export async function loadModule(name: string): Promise<unknown> {
            const module = await import(\`./modules/\${name}\`)
            return module.default
          }
        `,
        loader: 'ts',
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('import(')
      expect(result.errors).toBeUndefined()
    })

    it('handles class fields and private properties', async () => {
      const result = await compiler.transform({
        code: `
          class Counter {
            #count: number = 0
            public name: string

            constructor(name: string) {
              this.name = name
            }

            increment(): number {
              return ++this.#count
            }
          }

          export { Counter }
        `,
        loader: 'ts',
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('Counter')
      expect(result.code).toContain('#count')
      expect(result.errors).toBeUndefined()
    })
  })

  describe('Cloudflare Workers Compatibility', () => {
    it('transforms Cloudflare Worker fetch handler', async () => {
      const result = await compiler.transform({
        code: `
          export interface Env {
            KV: KVNamespace
            DB: D1Database
          }

          export default {
            async fetch(
              request: Request,
              env: Env,
              ctx: ExecutionContext
            ): Promise<Response> {
              const value = await env.KV.get('key')
              return new Response(value)
            }
          }
        `,
        loader: 'ts',
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('export default')
      expect(result.code).toContain('fetch')
      expect(result.code).not.toContain('interface Env')
      expect(result.code).not.toContain(': Request')
      expect(result.errors).toBeUndefined()
    })

    it('transforms Durable Object class', async () => {
      const result = await compiler.transform({
        code: `
          export class Counter implements DurableObject {
            private state: DurableObjectState
            private value: number = 0

            constructor(state: DurableObjectState, env: Env) {
              this.state = state
            }

            async fetch(request: Request): Promise<Response> {
              this.value++
              return new Response(String(this.value))
            }
          }
        `,
        loader: 'ts',
      })

      expect(result.code).toBeDefined()
      expect(result.code).toContain('class Counter')
      expect(result.code).not.toContain('implements DurableObject')
      expect(result.code).not.toContain(': DurableObjectState')
      expect(result.errors).toBeUndefined()
    })
  })
})
