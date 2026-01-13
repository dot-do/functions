/**
 * Tests for the Go function template
 *
 * These tests verify that the template creates valid configuration files
 * and source code that can be built with TinyGo for WASM.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const TEMPLATE_DIR = path.resolve(__dirname, '..')

describe('Go Template', () => {
  describe('go.mod', () => {
    let goModContent: string

    beforeAll(() => {
      const goModPath = path.join(TEMPLATE_DIR, 'go.mod')
      expect(fs.existsSync(goModPath)).toBe(true)
      goModContent = fs.readFileSync(goModPath, 'utf-8')
    })

    it('should exist', () => {
      const goModPath = path.join(TEMPLATE_DIR, 'go.mod')
      expect(fs.existsSync(goModPath)).toBe(true)
    })

    it('should have a valid module declaration', () => {
      expect(goModContent).toMatch(/^module\s+\S+/m)
    })

    it('should specify Go version', () => {
      expect(goModContent).toMatch(/^go\s+\d+\.\d+/m)
    })

    it('should have Go version 1.21 or later for WASM export support', () => {
      const versionMatch = goModContent.match(/^go\s+(\d+)\.(\d+)/m)
      expect(versionMatch).not.toBeNull()
      if (versionMatch) {
        const major = parseInt(versionMatch[1], 10)
        const minor = parseInt(versionMatch[2], 10)
        // Go 1.21+ required for //go:wasmexport
        expect(major).toBeGreaterThanOrEqual(1)
        if (major === 1) {
          expect(minor).toBeGreaterThanOrEqual(21)
        }
      }
    })
  })

  describe('main.go', () => {
    let mainGoContent: string

    beforeAll(() => {
      const mainGoPath = path.join(TEMPLATE_DIR, 'main.go')
      expect(fs.existsSync(mainGoPath)).toBe(true)
      mainGoContent = fs.readFileSync(mainGoPath, 'utf-8')
    })

    it('should exist', () => {
      const mainGoPath = path.join(TEMPLATE_DIR, 'main.go')
      expect(fs.existsSync(mainGoPath)).toBe(true)
    })

    it('should have package main declaration', () => {
      expect(mainGoContent).toMatch(/^package\s+main/m)
    })

    it('should have a main function', () => {
      expect(mainGoContent).toMatch(/func\s+main\s*\(\s*\)/)
    })

    it('should have //go:wasmexport directive', () => {
      expect(mainGoContent).toMatch(/\/\/go:wasmexport\s+\w+/)
    })

    it('should have at least one exported WASM function', () => {
      const wasmExports = mainGoContent.match(/\/\/go:wasmexport\s+\w+/g)
      expect(wasmExports).not.toBeNull()
      expect(wasmExports!.length).toBeGreaterThanOrEqual(1)
    })

    it('should have function implementations after wasmexport directives', () => {
      // Check that wasmexport is followed by a func declaration
      expect(mainGoContent).toMatch(/\/\/go:wasmexport\s+\w+\s*\nfunc\s+\w+/)
    })

    it('should use WASM-compatible types (int32, int64, float32, float64)', () => {
      // WASM exported functions should use WASM-compatible primitive types
      const wasmFunctions = mainGoContent.match(/\/\/go:wasmexport[\s\S]*?func\s+\w+\([^)]*\)[^{]*/g)
      expect(wasmFunctions).not.toBeNull()
      // At least one function should use int32 (most common)
      expect(mainGoContent).toMatch(/int32/)
    })

    it('should have proper Go documentation comments immediately before wasmexport', () => {
      // Functions should have doc comments directly before the wasmexport directive
      // (not separated by a blank line, which breaks Go doc conventions)
      expect(mainGoContent).toMatch(/\/\/\s+\w+[^\n]*\n\/\/go:wasmexport/)
    })
  })

  describe('wrangler.toml', () => {
    const getWranglerContent = (): string => {
      const wranglerPath = path.join(TEMPLATE_DIR, 'wrangler.toml')
      if (!fs.existsSync(wranglerPath)) {
        throw new Error('wrangler.toml does not exist')
      }
      return fs.readFileSync(wranglerPath, 'utf-8')
    }

    it('should exist', () => {
      const wranglerPath = path.join(TEMPLATE_DIR, 'wrangler.toml')
      expect(fs.existsSync(wranglerPath)).toBe(true)
    })

    it('should have a name field', () => {
      const wranglerContent = getWranglerContent()
      expect(wranglerContent).toMatch(/^name\s*=/m)
    })

    it('should have a main entry point', () => {
      const wranglerContent = getWranglerContent()
      expect(wranglerContent).toMatch(/^main\s*=/m)
    })

    it('should have compatibility_date', () => {
      const wranglerContent = getWranglerContent()
      expect(wranglerContent).toMatch(/^compatibility_date\s*=/m)
    })

    it('should point main to the WASM output', () => {
      // Should reference a .wasm file or the dist directory
      const wranglerContent = getWranglerContent()
      expect(wranglerContent).toMatch(/main\s*=\s*["']?.*\.(wasm|js)["']?/)
    })
  })

  describe('Makefile', () => {
    let makefileContent: string

    beforeAll(() => {
      const makefilePath = path.join(TEMPLATE_DIR, 'Makefile')
      expect(fs.existsSync(makefilePath)).toBe(true)
      makefileContent = fs.readFileSync(makefilePath, 'utf-8')
    })

    it('should exist', () => {
      const makefilePath = path.join(TEMPLATE_DIR, 'Makefile')
      expect(fs.existsSync(makefilePath)).toBe(true)
    })

    it('should have a build target', () => {
      expect(makefileContent).toMatch(/^build:/m)
    })

    it('should have a clean target', () => {
      expect(makefileContent).toMatch(/^clean:/m)
    })

    it('should use tinygo for WASM compilation', () => {
      expect(makefileContent).toMatch(/tinygo/i)
    })

    it('should target wasi', () => {
      expect(makefileContent).toMatch(/wasi/i)
    })

    it('should output a .wasm file', () => {
      expect(makefileContent).toMatch(/\.wasm/)
    })

    it('should have optimization flags for small binary size', () => {
      // Should have size optimization (-opt=s or -opt=z or similar)
      expect(makefileContent).toMatch(/-opt[=\s]*[sz]|OPT_LEVEL\s*=\s*[sz]/i)
    })

    it('should have a test target', () => {
      expect(makefileContent).toMatch(/^test:/m)
    })
  })

  describe('Template structure', () => {
    it('should have go.mod', () => {
      const filePath = path.join(TEMPLATE_DIR, 'go.mod')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('should have main.go', () => {
      const filePath = path.join(TEMPLATE_DIR, 'main.go')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('should have Makefile', () => {
      const filePath = path.join(TEMPLATE_DIR, 'Makefile')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('should have wrangler.toml', () => {
      const filePath = path.join(TEMPLATE_DIR, 'wrangler.toml')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('should not have dist directory in template', () => {
      // Templates should not include compiled output
      const distPath = path.join(TEMPLATE_DIR, 'dist')
      expect(fs.existsSync(distPath)).toBe(false)
    })

    it('should not have vendor directory in template', () => {
      // Templates should not include vendored dependencies
      const vendorPath = path.join(TEMPLATE_DIR, 'vendor')
      expect(fs.existsSync(vendorPath)).toBe(false)
    })
  })

  describe('TypeScript bindings', () => {
    it('should have bindings.ts', () => {
      const filePath = path.join(TEMPLATE_DIR, 'bindings.ts')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('should have types.d.ts', () => {
      const filePath = path.join(TEMPLATE_DIR, 'types.d.ts')
      expect(fs.existsSync(filePath)).toBe(true)
    })
  })
})
