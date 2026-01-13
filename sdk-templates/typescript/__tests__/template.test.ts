/**
 * Tests for the TypeScript function template
 *
 * These tests verify that the template creates valid configuration files
 * and source code that compiles and type-checks correctly.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

const TEMPLATE_DIR = path.resolve(__dirname, '..')

describe('TypeScript Template', () => {
  describe('package.json', () => {
    let packageJson: Record<string, unknown>

    beforeAll(() => {
      const packageJsonPath = path.join(TEMPLATE_DIR, 'package.json')
      expect(fs.existsSync(packageJsonPath)).toBe(true)
      const content = fs.readFileSync(packageJsonPath, 'utf-8')
      packageJson = JSON.parse(content)
    })

    it('should have a valid name field', () => {
      expect(packageJson.name).toBeDefined()
      expect(typeof packageJson.name).toBe('string')
    })

    it('should have a valid version field', () => {
      expect(packageJson.version).toBeDefined()
      expect(typeof packageJson.version).toBe('string')
      // Version should be semver-like
      expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/)
    })

    it('should be an ES module', () => {
      expect(packageJson.type).toBe('module')
    })

    it('should have required scripts', () => {
      const scripts = packageJson.scripts as Record<string, string>
      expect(scripts).toBeDefined()
      expect(scripts.build).toBeDefined()
      expect(scripts.dev).toBeDefined()
      expect(scripts.deploy).toBeDefined()
      expect(scripts.test).toBeDefined()
      expect(scripts.typecheck).toBeDefined()
    })

    it('should include @dotdo/functions-sdk as a dependency', () => {
      const dependencies = packageJson.dependencies as Record<string, string>
      expect(dependencies).toBeDefined()
      expect(dependencies['@dotdo/functions-sdk']).toBeDefined()
      expect(typeof dependencies['@dotdo/functions-sdk']).toBe('string')
    })

    it('should have typescript as a devDependency', () => {
      const devDependencies = packageJson.devDependencies as Record<string, string>
      expect(devDependencies).toBeDefined()
      expect(devDependencies.typescript).toBeDefined()
    })

    it('should have @cloudflare/workers-types as a devDependency', () => {
      const devDependencies = packageJson.devDependencies as Record<string, string>
      expect(devDependencies).toBeDefined()
      expect(devDependencies['@cloudflare/workers-types']).toBeDefined()
    })

    it('should have vitest as a devDependency', () => {
      const devDependencies = packageJson.devDependencies as Record<string, string>
      expect(devDependencies).toBeDefined()
      expect(devDependencies.vitest).toBeDefined()
    })

    it('should have main entry point', () => {
      expect(packageJson.main).toBeDefined()
      expect(typeof packageJson.main).toBe('string')
    })

    it('should have types entry point', () => {
      expect(packageJson.types).toBeDefined()
      expect(typeof packageJson.types).toBe('string')
    })

    it('should define node engine requirement', () => {
      const engines = packageJson.engines as Record<string, string>
      expect(engines).toBeDefined()
      expect(engines.node).toBeDefined()
    })
  })

  describe('tsconfig.json', () => {
    let tsconfig: Record<string, unknown>

    beforeAll(() => {
      const tsconfigPath = path.join(TEMPLATE_DIR, 'tsconfig.json')
      expect(fs.existsSync(tsconfigPath)).toBe(true)
      // Read and parse, handling JSON with comments
      const content = fs.readFileSync(tsconfigPath, 'utf-8')
      // Remove single-line comments for parsing
      const cleanedContent = content.replace(/\/\/.*$/gm, '')
      tsconfig = JSON.parse(cleanedContent)
    })

    it('should have valid JSON structure', () => {
      expect(tsconfig).toBeDefined()
      expect(typeof tsconfig).toBe('object')
    })

    it('should have compilerOptions', () => {
      expect(tsconfig.compilerOptions).toBeDefined()
      expect(typeof tsconfig.compilerOptions).toBe('object')
    })

    it('should target ES2022 or later for Workers compatibility', () => {
      const compilerOptions = tsconfig.compilerOptions as Record<string, unknown>
      expect(compilerOptions.target).toBeDefined()
      expect(['ES2022', 'ES2023', 'ESNext']).toContain(compilerOptions.target)
    })

    it('should use ESNext module format', () => {
      const compilerOptions = tsconfig.compilerOptions as Record<string, unknown>
      expect(compilerOptions.module).toBeDefined()
      expect(['ESNext', 'ES2022']).toContain(compilerOptions.module)
    })

    it('should use bundler module resolution', () => {
      const compilerOptions = tsconfig.compilerOptions as Record<string, unknown>
      expect(compilerOptions.moduleResolution).toBeDefined()
      expect(['bundler', 'Bundler']).toContain(compilerOptions.moduleResolution)
    })

    it('should enable strict mode', () => {
      const compilerOptions = tsconfig.compilerOptions as Record<string, unknown>
      expect(compilerOptions.strict).toBe(true)
    })

    it('should enable declaration generation', () => {
      const compilerOptions = tsconfig.compilerOptions as Record<string, unknown>
      expect(compilerOptions.declaration).toBe(true)
    })

    it('should include @cloudflare/workers-types', () => {
      const compilerOptions = tsconfig.compilerOptions as Record<string, unknown>
      const types = compilerOptions.types as string[]
      expect(types).toBeDefined()
      expect(Array.isArray(types)).toBe(true)
      expect(types).toContain('@cloudflare/workers-types')
    })

    it('should have outDir configured', () => {
      const compilerOptions = tsconfig.compilerOptions as Record<string, unknown>
      expect(compilerOptions.outDir).toBeDefined()
    })

    it('should have rootDir configured', () => {
      const compilerOptions = tsconfig.compilerOptions as Record<string, unknown>
      expect(compilerOptions.rootDir).toBeDefined()
    })

    it('should include src directory', () => {
      const include = tsconfig.include as string[]
      expect(include).toBeDefined()
      expect(Array.isArray(include)).toBe(true)
      expect(include.some((pattern) => pattern.includes('src'))).toBe(true)
    })

    it('should exclude node_modules', () => {
      const exclude = tsconfig.exclude as string[]
      expect(exclude).toBeDefined()
      expect(Array.isArray(exclude)).toBe(true)
      expect(exclude).toContain('node_modules')
    })
  })

  describe('wrangler.toml', () => {
    let wranglerContent: string

    beforeAll(() => {
      const wranglerPath = path.join(TEMPLATE_DIR, 'wrangler.toml')
      expect(fs.existsSync(wranglerPath)).toBe(true)
      wranglerContent = fs.readFileSync(wranglerPath, 'utf-8')
    })

    it('should exist', () => {
      const wranglerPath = path.join(TEMPLATE_DIR, 'wrangler.toml')
      expect(fs.existsSync(wranglerPath)).toBe(true)
    })

    it('should have a name field', () => {
      expect(wranglerContent).toMatch(/^name\s*=/m)
    })

    it('should have a main entry point', () => {
      expect(wranglerContent).toMatch(/^main\s*=/m)
    })

    it('should have compatibility_date', () => {
      expect(wranglerContent).toMatch(/^compatibility_date\s*=/m)
    })

    it('should point main to src/index.ts', () => {
      expect(wranglerContent).toMatch(/main\s*=\s*["']?src\/index\.ts["']?/)
    })
  })

  describe('src/index.ts', () => {
    let indexContent: string

    beforeAll(() => {
      const indexPath = path.join(TEMPLATE_DIR, 'src', 'index.ts')
      expect(fs.existsSync(indexPath)).toBe(true)
      indexContent = fs.readFileSync(indexPath, 'utf-8')
    })

    it('should exist', () => {
      const indexPath = path.join(TEMPLATE_DIR, 'src', 'index.ts')
      expect(fs.existsSync(indexPath)).toBe(true)
    })

    it('should import from @dotdo/functions-sdk', () => {
      expect(indexContent).toMatch(/@dotdo\/functions-sdk/)
    })

    it('should have a default export', () => {
      expect(indexContent).toMatch(/export\s+default/)
    })

    it('should define an Env interface', () => {
      expect(indexContent).toMatch(/interface\s+Env/)
    })

    it('should have a fetch handler', () => {
      // Should have fetch function/handler
      expect(indexContent).toMatch(/fetch\s*[:(]/)
    })

    it('should have example function implementation', () => {
      // Should have at least one async function
      expect(indexContent).toMatch(/async\s+\w+\s*\(/)
    })

    it('should have proper TypeScript types', () => {
      // Should use TypeScript type annotations
      expect(indexContent).toMatch(/:\s*(string|number|boolean|Promise|Response|Request)/)
    })

    it('should export types', () => {
      // Should export types for consumers
      expect(indexContent).toMatch(/export\s+(type|interface)/)
    })
  })

  describe('Template compilation', () => {
    it('should compile without TypeScript errors', () => {
      // This test verifies that the template compiles successfully
      // by running tsc --noEmit on the template directory
      try {
        execSync('npx tsc --noEmit', {
          cwd: TEMPLATE_DIR,
          stdio: 'pipe',
          encoding: 'utf-8',
        })
      } catch (error) {
        const execError = error as { stderr?: string; stdout?: string }
        const errorOutput = execError.stderr || execError.stdout || 'Unknown error'
        expect.fail(`TypeScript compilation failed:\n${errorOutput}`)
      }
    })

    it('should pass type checking', () => {
      // Run typecheck script if available
      try {
        const packageJsonPath = path.join(TEMPLATE_DIR, 'package.json')
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
        const scripts = packageJson.scripts as Record<string, string>

        if (scripts.typecheck) {
          execSync('npm run typecheck', {
            cwd: TEMPLATE_DIR,
            stdio: 'pipe',
            encoding: 'utf-8',
          })
        } else {
          // Fallback to direct tsc
          execSync('npx tsc --noEmit', {
            cwd: TEMPLATE_DIR,
            stdio: 'pipe',
            encoding: 'utf-8',
          })
        }
      } catch (error) {
        const execError = error as { stderr?: string; stdout?: string }
        const errorOutput = execError.stderr || execError.stdout || 'Unknown error'
        expect.fail(`Type checking failed:\n${errorOutput}`)
      }
    })
  })

  describe('Template structure', () => {
    it('should have src directory', () => {
      const srcDir = path.join(TEMPLATE_DIR, 'src')
      expect(fs.existsSync(srcDir)).toBe(true)
      expect(fs.statSync(srcDir).isDirectory()).toBe(true)
    })

    it('should have all required source files', () => {
      const requiredFiles = ['src/index.ts']

      for (const file of requiredFiles) {
        const filePath = path.join(TEMPLATE_DIR, file)
        expect(fs.existsSync(filePath)).toBe(true)
      }
    })

    it('should have package.json', () => {
      const filePath = path.join(TEMPLATE_DIR, 'package.json')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('should have tsconfig.json', () => {
      const filePath = path.join(TEMPLATE_DIR, 'tsconfig.json')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('should have wrangler.toml', () => {
      const filePath = path.join(TEMPLATE_DIR, 'wrangler.toml')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('should not have node_modules in template', () => {
      // Templates should not include node_modules
      const nodeModulesPath = path.join(TEMPLATE_DIR, 'node_modules')
      expect(fs.existsSync(nodeModulesPath)).toBe(false)
    })

    it('should not have dist directory in template', () => {
      // Templates should not include compiled output
      const distPath = path.join(TEMPLATE_DIR, 'dist')
      expect(fs.existsSync(distPath)).toBe(false)
    })
  })
})
