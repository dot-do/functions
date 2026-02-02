/**
 * Tests for TypeScript Compiler Service
 *
 * Verifies the compileTypeScript function and its fallback behavior.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  compileTypeScript,
  needsFullCompilation,
  stripTypeScriptSync,
  type EsbuildCompiler,
} from '../ts-compiler'

describe('TypeScript Compiler Service', () => {
  describe('needsFullCompilation', () => {
    it('returns true for code with enums', () => {
      const code = `
        enum Status { Active = 'ACTIVE', Inactive = 'INACTIVE' }
        const s: Status = Status.Active;
      `
      expect(needsFullCompilation(code)).toBe(true)
    })

    it('returns true for code with decorators', () => {
      const code = `
        @Component({ selector: 'app' })
        class MyComponent {}
      `
      expect(needsFullCompilation(code)).toBe(true)
    })

    it('returns true for code with namespaces', () => {
      const code = `
        namespace MyNamespace {
          export const value = 42;
        }
      `
      expect(needsFullCompilation(code)).toBe(true)
    })

    it('returns false for code with abstract classes (regex handles them)', () => {
      const code = `
        abstract class BaseClass {
          abstract method(): void;
        }
      `
      // Abstract classes can be handled by regex stripping (just remove abstract keyword)
      expect(needsFullCompilation(code)).toBe(false)
    })

    it('returns true for code with constructor parameter properties', () => {
      const code = `
        class User {
          constructor(private name: string, public age: number) {}
        }
      `
      // Constructor parameter properties require code generation (this.name = name)
      expect(needsFullCompilation(code)).toBe(true)
    })

    it('returns true for JSX/TSX syntax', () => {
      // PascalCase tags indicate JSX components
      const code = `
        const App = () => <MyComponent>Hello</MyComponent>;
      `
      expect(needsFullCompilation(code)).toBe(true)
    })

    it('returns true for JSX fragments', () => {
      const code = `
        const App = () => <>Hello</>;
      `
      expect(needsFullCompilation(code)).toBe(true)
    })

    it('returns false for simple TypeScript', () => {
      const code = `
        interface User { name: string; age: number; }
        const user: User = { name: 'John', age: 30 };
      `
      expect(needsFullCompilation(code)).toBe(false)
    })

    it('returns false for type annotations only', () => {
      const code = `
        function greet(name: string): string {
          return \`Hello, \${name}\`;
        }
      `
      expect(needsFullCompilation(code)).toBe(false)
    })
  })

  describe('compileTypeScript', () => {
    it('returns success for empty code', async () => {
      const result = await compileTypeScript('')
      expect(result.success).toBe(true)
      expect(result.code).toBe('')
      expect(result.compiler).toBe('regex')
    })

    it('uses regex for simple TypeScript without esbuild', async () => {
      // The regex stripper handles function parameters and return types
      // but not variable declarations with primitive type annotations
      const code = `
        interface User { name: string; }
        function greet(name: string): string {
          return \`Hello, \${name}\`;
        }
      `
      const result = await compileTypeScript(code)
      expect(result.success).toBe(true)
      expect(result.compiler).toBe('regex')
      // Should remove interface
      expect(result.code).not.toContain('interface User')
      // Should strip function parameter types
      expect(result.code).toContain('function greet(name)')
    })

    it('uses esbuild when available', async () => {
      const mockCompiler: EsbuildCompiler = {
        transform: vi.fn().mockResolvedValue({
          code: 'const x = 42;',
          warnings: [],
        }),
      }

      const code = 'const x: number = 42;'
      const result = await compileTypeScript(code, mockCompiler)

      expect(result.success).toBe(true)
      expect(result.compiler).toBe('esbuild')
      expect(result.code).toBe('const x = 42;')
      expect(mockCompiler.transform).toHaveBeenCalledWith(
        expect.objectContaining({
          code,
          loader: 'ts',
          target: 'esnext',
          format: 'esm',
          sourcemap: true,
        })
      )
    })

    it('includes source map when esbuild returns one', async () => {
      const sourceMap = '{"version":3,"sources":["input.ts"]}'
      const mockCompiler: EsbuildCompiler = {
        transform: vi.fn().mockResolvedValue({
          code: 'const x = 42;',
          map: sourceMap,
          warnings: [],
        }),
      }

      const result = await compileTypeScript('const x: number = 42;', mockCompiler)

      expect(result.success).toBe(true)
      expect(result.map).toBe(sourceMap)
    })

    it('returns errors from esbuild', async () => {
      const mockCompiler: EsbuildCompiler = {
        transform: vi.fn().mockResolvedValue({
          code: '',
          warnings: [],
          errors: ['Syntax error at line 1'],
        }),
      }

      const result = await compileTypeScript('const x: = 42;', mockCompiler)

      expect(result.success).toBe(false)
      expect(result.errors).toContain('Syntax error at line 1')
      expect(result.compiler).toBe('esbuild')
    })

    it('falls back to regex when esbuild fails', async () => {
      const mockCompiler: EsbuildCompiler = {
        transform: vi.fn().mockRejectedValue(new Error('Service unavailable')),
      }

      const code = 'const x: number = 42;'
      const result = await compileTypeScript(code, mockCompiler)

      // Should fall back to regex for simple code
      expect(result.success).toBe(true)
      expect(result.compiler).toBe('regex')
      expect(result.warnings).toContain('esbuild-compiler service failed, fell back to regex stripping.')
    })

    it('respects forceRegex option', async () => {
      const mockCompiler: EsbuildCompiler = {
        transform: vi.fn(),
      }

      const code = 'const x: number = 42;'
      const result = await compileTypeScript(code, mockCompiler, { forceRegex: true })

      expect(result.success).toBe(true)
      expect(result.compiler).toBe('regex')
      expect(mockCompiler.transform).not.toHaveBeenCalled()
    })

    it('warns when complex code uses regex fallback', async () => {
      // Code with enums that needs full compilation but no esbuild available
      const code = `
        enum Status { Active = 'ACTIVE' }
        const s = Status.Active;
      `
      const result = await compileTypeScript(code)

      // Without esbuild, it will try regex as fallback
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings[0]).toContain('enums/decorators/namespaces')
    })

    it('uses tsx loader for TSX content', async () => {
      const mockCompiler: EsbuildCompiler = {
        transform: vi.fn().mockResolvedValue({
          code: 'const App = () => h("div", null);',
          warnings: [],
        }),
      }

      const code = 'const App: React.FC = () => <div />;'
      await compileTypeScript(code, mockCompiler, { loader: 'tsx' })

      expect(mockCompiler.transform).toHaveBeenCalledWith(
        expect.objectContaining({ loader: 'tsx' })
      )
    })
  })

  describe('stripTypeScriptSync', () => {
    it('strips function type annotations synchronously', () => {
      const code = 'function greet(name: string): string { return name; }'
      const result = stripTypeScriptSync(code)
      expect(result).toContain('function greet(name)')
      expect(result).not.toContain(': string)')
    })

    it('preserves JavaScript code', () => {
      const code = 'const x = 42;'
      const result = stripTypeScriptSync(code)
      expect(result).toBe('const x = 42;')
    })

    it('removes interface declarations', () => {
      const code = `
        interface User {
          name: string;
          age: number;
        }
        const user = { name: 'John', age: 30 };
      `.trim()
      const result = stripTypeScriptSync(code)
      expect(result).not.toContain('interface')
      expect(result).toContain("{ name: 'John', age: 30 }")
    })
  })
})
