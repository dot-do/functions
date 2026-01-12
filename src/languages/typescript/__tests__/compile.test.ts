/**
 * RED Phase Tests: TypeScript to ESM Compilation
 *
 * These tests validate that the TypeScript compiler:
 * 1. Compiles TypeScript function code to valid ESM via esbuild
 * 2. Compiled ESM has correct exports
 * 3. Source maps are generated
 *
 * These tests are expected to FAIL until compileTypeScript is implemented.
 */

import { describe, it, expect } from 'vitest'
import { compileTypeScript } from '../compile'

describe('TypeScript Compiler', () => {
  it('compiles TypeScript to ESM', async () => {
    const code = `
      export default {
        async fetch(request: Request): Promise<Response> {
          return new Response('Hello!')
        }
      }
    `
    const result = await compileTypeScript(code)
    expect(result.code).toContain('export default')
    expect(result.code).not.toContain('async fetch(request: Request)')  // types removed
  })

  it('generates source maps', async () => {
    const result = await compileTypeScript('export const x = 1')
    expect(result.map).toBeDefined()
  })

  it('removes TypeScript type annotations', async () => {
    const code = `
      interface User {
        id: string
        name: string
      }

      export function greet(user: User): string {
        return \`Hello, \${user.name}!\`
      }
    `
    const result = await compileTypeScript(code)
    expect(result.code).not.toContain('interface User')
    expect(result.code).not.toContain(': User')
    expect(result.code).not.toContain(': string')
    expect(result.code).toContain('export')
    expect(result.code).toContain('greet')
  })

  it('preserves async/await without transformation', async () => {
    const code = `
      export async function fetchData(): Promise<string> {
        const response = await fetch('https://api.example.com')
        return await response.text()
      }
    `
    const result = await compileTypeScript(code)
    expect(result.code).toContain('async')
    expect(result.code).toContain('await')
    expect(result.code).not.toContain('__awaiter')  // no babel helpers
  })

  it('outputs valid ESM (not CommonJS)', async () => {
    const code = `export const value = 42`
    const result = await compileTypeScript(code)
    expect(result.code).toContain('export')
    expect(result.code).not.toContain('module.exports')
    expect(result.code).not.toContain('require(')
  })

  it('handles generics correctly', async () => {
    const code = `
      export function identity<T>(value: T): T {
        return value
      }
    `
    const result = await compileTypeScript(code)
    expect(result.code).not.toContain('<T>')
    expect(result.code).toContain('identity')
    expect(result.code).toContain('export')
  })

  it('returns errors for invalid syntax', async () => {
    const code = `
      export function broken( {
        return 'missing closing paren'
      }
    `
    const result = await compileTypeScript(code)
    expect(result.code).toBe('')
    expect(result.errors).toBeDefined()
    expect(result.errors!.length).toBeGreaterThan(0)
  })
})
