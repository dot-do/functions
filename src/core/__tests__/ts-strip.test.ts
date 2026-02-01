/**
 * TypeScript Stripping Tests (RED Phase - TDD)
 *
 * These tests validate the stripTypeScript function which removes TypeScript
 * type annotations from code, leaving only valid JavaScript.
 *
 * The function should handle:
 * - Interface declarations
 * - Type aliases
 * - Type imports
 * - Parameter type annotations
 * - Return type annotations
 * - Generics
 * - Type assertions
 * - Declare statements
 * - Access modifiers
 * - Non-null assertions
 * - Satisfies expressions
 */

import { describe, it, expect } from 'vitest'
import { stripTypeScript } from '../ts-strip'

describe('stripTypeScript', () => {
  describe('interface declarations', () => {
    it('should strip single-line interface declarations', () => {
      const code = `interface User { name: string; age: number; }`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })

    it('should strip multi-line interface declarations', () => {
      const code = `interface User {
  name: string;
  age: number;
}`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })

    it('should strip interface with extends', () => {
      const code = `interface Admin extends User {
  role: string;
}`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })

    it('should strip exported interface declarations', () => {
      const code = `export interface Config {
  host: string;
  port: number;
}`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })

    it('should strip interface with nested object types', () => {
      const code = `interface User {
  name: string;
  address: {
    street: string;
    city: string;
  };
}`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })
  })

  describe('type aliases', () => {
    it('should strip simple type aliases', () => {
      const code = `type ID = string;`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })

    it('should strip union type aliases', () => {
      const code = `type Status = 'active' | 'inactive' | 'pending';`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })

    it('should strip generic type aliases', () => {
      const code = `type Result<T> = { data: T; error: string | null };`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })

    it('should strip exported type aliases', () => {
      const code = `export type Handler = (req: Request) => Response;`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })

    it('should strip complex type aliases', () => {
      const code = `type Complex<T extends object> = T & { id: string };`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })
  })

  describe('type imports', () => {
    it('should strip import type statements', () => {
      const code = `import type { User } from './types';`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })

    it('should strip inline type imports', () => {
      const code = `import { type User, fetchUser } from './api';`
      const result = stripTypeScript(code)
      expect(result).toContain('fetchUser')
      expect(result).not.toContain('type User')
    })

    it('should strip multiple inline type imports', () => {
      const code = `import { type User, type Config, fetchUser } from './api';`
      const result = stripTypeScript(code)
      expect(result).toContain('fetchUser')
      expect(result).not.toContain('type User')
      expect(result).not.toContain('type Config')
    })

    it('should handle import type * as namespace', () => {
      const code = `import type * as Types from './types';`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })
  })

  describe('export type statements', () => {
    it('should strip export type statements', () => {
      const code = `export type { User, Config };`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })

    it('should strip export type from statements', () => {
      const code = `export type { User } from './types';`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })
  })

  describe('parameter type annotations', () => {
    it('should strip simple parameter types', () => {
      const code = `function greet(name: string) { return name; }`
      const result = stripTypeScript(code)
      expect(result).toContain('function greet(name)')
      expect(result).not.toContain(': string')
    })

    it('should strip multiple parameter types', () => {
      const code = `function add(a: number, b: number) { return a + b; }`
      const result = stripTypeScript(code)
      expect(result).toContain('function add(a, b)')
      expect(result).not.toContain(': number')
    })

    it('should strip object type annotations', () => {
      const code = `function process(data: { x: number; y: number }) { return data; }`
      const result = stripTypeScript(code)
      expect(result).toContain('function process(data)')
      expect(result).not.toContain('{ x: number')
    })

    it('should strip union type annotations', () => {
      const code = `function handle(value: string | number) { return value; }`
      const result = stripTypeScript(code)
      expect(result).toContain('function handle(value)')
      expect(result).not.toContain('string | number')
    })

    it('should strip array type annotations', () => {
      const code = `function sum(nums: number[]) { return nums.reduce((a, b) => a + b); }`
      const result = stripTypeScript(code)
      expect(result).toContain('function sum(nums)')
      expect(result).not.toContain('number[]')
    })

    it('should strip generic type annotations', () => {
      const code = `function first(arr: Array<string>) { return arr[0]; }`
      const result = stripTypeScript(code)
      expect(result).toContain('function first(arr)')
      expect(result).not.toContain('Array<string>')
    })

    it('should handle optional parameters', () => {
      const code = `function greet(name?: string) { return name || 'World'; }`
      const result = stripTypeScript(code)
      expect(result).toContain('function greet(name)')
      expect(result).not.toContain(': string')
    })

    it('should handle arrow functions', () => {
      const code = `const add = (a: number, b: number) => a + b;`
      const result = stripTypeScript(code)
      expect(result).toContain('(a, b)')
      expect(result).not.toContain(': number')
    })
  })

  describe('return type annotations', () => {
    it('should strip simple return types', () => {
      const code = `function getName(): string { return 'test'; }`
      const result = stripTypeScript(code)
      expect(result).toContain('function getName()')
      expect(result).toContain('{ return')
      expect(result).not.toContain(': string')
    })

    it('should strip Promise return types', () => {
      const code = `async function fetch(): Promise<Response> { return new Response(); }`
      const result = stripTypeScript(code)
      expect(result).toContain('async function fetch()')
      expect(result).not.toContain('Promise<Response>')
    })

    it('should strip void return types', () => {
      const code = `function log(msg: string): void { console.log(msg); }`
      const result = stripTypeScript(code)
      expect(result).not.toContain(': void')
    })

    it('should strip union return types', () => {
      const code = `function parse(s: string): number | null { return parseInt(s) || null; }`
      const result = stripTypeScript(code)
      expect(result).not.toContain('number | null')
    })

    it('should strip arrow function return types', () => {
      const code = `const greet = (name: string): string => name;`
      const result = stripTypeScript(code)
      expect(result).toContain('=> name')
      expect(result).not.toMatch(/:\s*string\s*=>/)
    })
  })

  describe('generics', () => {
    it('should strip generic function type parameters', () => {
      const code = `function identity<T>(value: T): T { return value; }`
      const result = stripTypeScript(code)
      expect(result).toContain('function identity(value)')
      expect(result).not.toContain('<T>')
    })

    it('should strip multiple generic parameters', () => {
      const code = `function map<T, U>(arr: T[], fn: (x: T) => U): U[] { return arr.map(fn); }`
      const result = stripTypeScript(code)
      expect(result).not.toContain('<T, U>')
    })

    it('should strip generic with extends constraint', () => {
      const code = `function keys<T extends object>(obj: T): string[] { return Object.keys(obj); }`
      const result = stripTypeScript(code)
      expect(result).not.toContain('<T extends object>')
    })

    it('should strip generic class type parameters', () => {
      const code = `class Container<T> { value: T; }`
      const result = stripTypeScript(code)
      expect(result).toContain('class Container')
      expect(result).not.toContain('<T>')
    })
  })

  describe('type assertions', () => {
    it('should strip as type assertions', () => {
      const code = `const el = document.getElementById('app') as HTMLElement;`
      const result = stripTypeScript(code)
      expect(result).not.toContain('as HTMLElement')
    })

    it('should preserve as const', () => {
      const code = `const arr = [1, 2, 3] as const;`
      const result = stripTypeScript(code)
      expect(result).toContain('as const')
    })

    it('should strip object type assertions', () => {
      const code = `const data = response as { name: string };`
      const result = stripTypeScript(code)
      expect(result).not.toContain('as { name: string }')
    })

    it('should strip angle bracket type assertions', () => {
      const code = `const el = <HTMLElement>document.getElementById('app');`
      const result = stripTypeScript(code)
      expect(result).not.toContain('<HTMLElement>')
    })

    it('should strip multiple type assertions', () => {
      const code = `const x = (val as unknown) as number;`
      const result = stripTypeScript(code)
      expect(result).not.toContain('as unknown')
      expect(result).not.toContain('as number')
    })
  })

  describe('declare statements', () => {
    it('should strip declare const', () => {
      const code = `declare const VERSION: string;`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })

    it('should strip declare function', () => {
      const code = `declare function alert(message: string): void;`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })

    it('should strip declare module', () => {
      const code = `declare module '*.css' { const content: string; export default content; }`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })

    it('should strip declare global', () => {
      const code = `declare global { interface Window { myVar: string; } }`
      const result = stripTypeScript(code)
      expect(result.trim()).toBe('')
    })
  })

  describe('access modifiers', () => {
    it('should strip public modifier', () => {
      const code = `class User { public name: string; }`
      const result = stripTypeScript(code)
      expect(result).not.toContain('public')
    })

    it('should strip private modifier', () => {
      const code = `class User { private id: number; }`
      const result = stripTypeScript(code)
      expect(result).not.toContain('private')
    })

    it('should strip protected modifier', () => {
      const code = `class User { protected secret: string; }`
      const result = stripTypeScript(code)
      expect(result).not.toContain('protected')
    })

    it('should strip readonly modifier', () => {
      const code = `class Config { readonly version: string; }`
      const result = stripTypeScript(code)
      expect(result).not.toContain('readonly')
    })

    it('should strip combined modifiers', () => {
      const code = `class User { public readonly name: string; }`
      const result = stripTypeScript(code)
      expect(result).not.toContain('public')
      expect(result).not.toContain('readonly')
    })
  })

  describe('non-null assertions', () => {
    it('should strip non-null assertions', () => {
      const code = `const name = user!.name;`
      const result = stripTypeScript(code)
      expect(result).toContain('user.name')
      expect(result).not.toContain('!')
    })

    it('should not strip !== operators', () => {
      const code = `if (a !== b) { return true; }`
      const result = stripTypeScript(code)
      expect(result).toContain('!==')
    })

    it('should not strip != operators', () => {
      const code = `if (a != b) { return true; }`
      const result = stripTypeScript(code)
      expect(result).toContain('!=')
    })
  })

  describe('satisfies expressions', () => {
    it('should strip satisfies type', () => {
      const code = `const config = { host: 'localhost' } satisfies Config;`
      const result = stripTypeScript(code)
      expect(result).not.toContain('satisfies Config')
      expect(result).toContain("{ host: 'localhost' }")
    })

    it('should strip satisfies with complex types', () => {
      const code = `const data = { x: 1 } satisfies Record<string, number>;`
      const result = stripTypeScript(code)
      expect(result).not.toContain('satisfies')
    })
  })

  describe('edge cases', () => {
    it('should handle empty input', () => {
      const result = stripTypeScript('')
      expect(result).toBe('')
    })

    it('should preserve regular JavaScript code', () => {
      const code = `function add(a, b) { return a + b; }`
      const result = stripTypeScript(code)
      expect(result).toContain('function add(a, b)')
      expect(result).toContain('return a + b')
    })

    it('should preserve string literals containing type-like patterns', () => {
      const code = `const msg = "type User = string";`
      const result = stripTypeScript(code)
      expect(result).toContain('"type User = string"')
    })

    it('should handle mixed TypeScript and JavaScript', () => {
      const code = `
interface User { name: string; }
function greet(user: User): string {
  return 'Hello, ' + user.name;
}
const result = greet({ name: 'World' });`
      const result = stripTypeScript(code)
      expect(result).not.toContain('interface')
      expect(result).not.toContain(': User')
      expect(result).not.toContain(': string')
      expect(result).toContain('function greet(user)')
      expect(result).toContain("return 'Hello, ' + user.name")
      expect(result).toContain("greet({ name: 'World' })")
    })

    it('should handle class with typed properties and methods', () => {
      const code = `
class Calculator {
  private result: number = 0;

  add(value: number): Calculator {
    this.result += value;
    return this;
  }

  getResult(): number {
    return this.result;
  }
}`
      const result = stripTypeScript(code)
      expect(result).toContain('class Calculator')
      expect(result).not.toContain('private')
      expect(result).not.toContain(': number')
      expect(result).not.toContain(': Calculator')
    })

    it('should clean up multiple consecutive empty lines', () => {
      const code = `interface A {}


interface B {}


const x = 1;`
      const result = stripTypeScript(code)
      // Should not have more than 2 consecutive newlines
      expect(result).not.toMatch(/\n{4,}/)
    })

    it('should clean up multiple spaces', () => {
      const code = `function test(a:   string): void {}`
      const result = stripTypeScript(code)
      expect(result).not.toMatch(/  +/)
    })
  })
})
