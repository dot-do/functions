/**
 * Tests for the Rust function template
 *
 * These tests verify that the Rust template creates valid configuration files
 * and source code that compiles to WebAssembly correctly.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

const TEMPLATE_DIR = path.resolve(__dirname, '..')

describe('Rust Template', () => {
  describe('Cargo.toml', () => {
    let cargoContent: string

    beforeAll(() => {
      const cargoPath = path.join(TEMPLATE_DIR, 'Cargo.toml')
      expect(fs.existsSync(cargoPath)).toBe(true)
      cargoContent = fs.readFileSync(cargoPath, 'utf-8')
    })

    it('should exist', () => {
      const cargoPath = path.join(TEMPLATE_DIR, 'Cargo.toml')
      expect(fs.existsSync(cargoPath)).toBe(true)
    })

    it('should have a valid [package] section', () => {
      expect(cargoContent).toMatch(/^\[package\]/m)
    })

    it('should have a name field', () => {
      expect(cargoContent).toMatch(/^name\s*=/m)
    })

    it('should have a version field', () => {
      expect(cargoContent).toMatch(/^version\s*=/m)
      // Version should be semver-like
      expect(cargoContent).toMatch(/version\s*=\s*["']\d+\.\d+\.\d+["']/)
    })

    it('should have edition 2021 or later', () => {
      expect(cargoContent).toMatch(/edition\s*=\s*["'](2021|2024)["']/)
    })

    it('should have [lib] section with cdylib crate-type', () => {
      expect(cargoContent).toMatch(/^\[lib\]/m)
      expect(cargoContent).toMatch(/crate-type\s*=.*cdylib/)
    })

    it('should have [dependencies] section', () => {
      expect(cargoContent).toMatch(/^\[dependencies\]/m)
    })

    it('should include wasm-bindgen dependency', () => {
      expect(cargoContent).toMatch(/wasm-bindgen\s*=/)
    })

    it('should have [profile.release] optimizations for WASM size', () => {
      expect(cargoContent).toMatch(/^\[profile\.release\]/m)
      // Should have size optimizations
      expect(cargoContent).toMatch(/opt-level\s*=\s*["']?[zs]["']?/)
      expect(cargoContent).toMatch(/lto\s*=\s*true/)
    })

    it('should have panic = "abort" for smaller WASM', () => {
      expect(cargoContent).toMatch(/panic\s*=\s*["']abort["']/)
    })

    it('should have strip = true for smaller WASM', () => {
      expect(cargoContent).toMatch(/strip\s*=\s*true/)
    })
  })

  describe('src/lib.rs', () => {
    let libContent: string

    beforeAll(() => {
      const libPath = path.join(TEMPLATE_DIR, 'src', 'lib.rs')
      expect(fs.existsSync(libPath)).toBe(true)
      libContent = fs.readFileSync(libPath, 'utf-8')
    })

    it('should exist', () => {
      const libPath = path.join(TEMPLATE_DIR, 'src', 'lib.rs')
      expect(fs.existsSync(libPath)).toBe(true)
    })

    it('should import wasm_bindgen prelude', () => {
      expect(libContent).toMatch(/use\s+wasm_bindgen::prelude::\*/)
    })

    it('should have #[wasm_bindgen] exports', () => {
      expect(libContent).toMatch(/#\[wasm_bindgen\]/)
    })

    it('should have #[no_mangle] exports for raw FFI', () => {
      expect(libContent).toMatch(/#\[no_mangle\]/)
    })

    it('should have pub extern "C" functions for raw FFI', () => {
      expect(libContent).toMatch(/pub\s+extern\s+["']C["']\s+fn/)
    })

    it('should have alloc function for WASM memory management', () => {
      expect(libContent).toMatch(/pub\s+extern\s+["']C["']\s+fn\s+alloc/)
    })

    it('should have dealloc function for WASM memory management', () => {
      expect(libContent).toMatch(/pub\s+extern\s+["']C["']\s+fn\s+dealloc/)
    })

    it('should have example functions', () => {
      // Should have at least one public function
      expect(libContent).toMatch(/pub\s+fn\s+\w+/)
    })

    it('should have unit tests', () => {
      expect(libContent).toMatch(/#\[cfg\(test\)\]/)
      expect(libContent).toMatch(/mod\s+tests/)
      expect(libContent).toMatch(/#\[test\]/)
    })

    it('should have documentation comments', () => {
      // Should have at least one doc comment
      expect(libContent).toMatch(/\/\/[\/!]/)
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

    it('should point main to WASM output', () => {
      // Should point to the WASM build output
      expect(wranglerContent).toMatch(/main\s*=\s*["'].*\.wasm["']|main\s*=\s*["'].*pkg/)
    })

    it('should have [build] section for Rust compilation', () => {
      expect(wranglerContent).toMatch(/^\[build\]/m)
    })

    it('should have build command for Rust', () => {
      // Should have a build command that uses cargo/wasm-pack
      expect(wranglerContent).toMatch(/command\s*=.*(?:cargo|wasm-pack|build\.sh)/)
    })
  })

  describe('build.sh', () => {
    let buildContent: string

    beforeAll(() => {
      const buildPath = path.join(TEMPLATE_DIR, 'build.sh')
      expect(fs.existsSync(buildPath)).toBe(true)
      buildContent = fs.readFileSync(buildPath, 'utf-8')
    })

    it('should exist', () => {
      const buildPath = path.join(TEMPLATE_DIR, 'build.sh')
      expect(fs.existsSync(buildPath)).toBe(true)
    })

    it('should be executable', () => {
      const buildPath = path.join(TEMPLATE_DIR, 'build.sh')
      const stats = fs.statSync(buildPath)
      // Check if executable bit is set (mode & 0o111)
      expect(stats.mode & 0o111).toBeGreaterThan(0)
    })

    it('should have shebang', () => {
      expect(buildContent).toMatch(/^#!\/bin\/bash/)
    })

    it('should use wasm-pack or cargo build', () => {
      expect(buildContent).toMatch(/wasm-pack|cargo\s+build/)
    })

    it('should target wasm32-unknown-unknown', () => {
      expect(buildContent).toMatch(/wasm32-unknown-unknown/)
    })

    it('should check for required tools', () => {
      expect(buildContent).toMatch(/rustc|cargo/)
      expect(buildContent).toMatch(/wasm-pack/)
    })
  })

  describe('Template compilation', () => {
    const isRustAvailable = (): boolean => {
      try {
        execSync('rustc --version', { stdio: 'pipe' })
        return true
      } catch {
        return false
      }
    }

    const isWasmTargetAvailable = (): boolean => {
      try {
        const output = execSync('rustup target list --installed', {
          stdio: 'pipe',
          encoding: 'utf-8',
        })
        return output.includes('wasm32-unknown-unknown')
      } catch {
        return false
      }
    }

    it('should have valid Cargo.toml syntax', () => {
      // This test verifies the Cargo.toml can be parsed
      // We do a basic TOML validation by checking structure
      const cargoPath = path.join(TEMPLATE_DIR, 'Cargo.toml')
      const content = fs.readFileSync(cargoPath, 'utf-8')

      // Basic TOML structure checks
      expect(content).toMatch(/^\[package\]/m)
      expect(content).toMatch(/^\[dependencies\]/m)

      // Check for no obvious syntax errors (unclosed brackets, etc.)
      const openBrackets = (content.match(/^\[/gm) || []).length
      expect(openBrackets).toBeGreaterThan(0)
    })

    it('should compile without Rust errors (if rustc available)', () => {
      if (!isRustAvailable()) {
        console.log('Skipping: rustc not available')
        return
      }

      // Run cargo check to verify the code compiles
      try {
        execSync('cargo check', {
          cwd: TEMPLATE_DIR,
          stdio: 'pipe',
          encoding: 'utf-8',
        })
      } catch (error) {
        const execError = error as { stderr?: string; stdout?: string }
        const errorOutput = execError.stderr || execError.stdout || 'Unknown error'
        expect.fail(`Rust compilation check failed:\n${errorOutput}`)
      }
    })

    it('should compile to WASM (if wasm target available)', () => {
      if (!isRustAvailable() || !isWasmTargetAvailable()) {
        console.log('Skipping: rustc or wasm32 target not available')
        return
      }

      // Run cargo build for wasm32 target
      try {
        execSync('cargo build --target wasm32-unknown-unknown --release', {
          cwd: TEMPLATE_DIR,
          stdio: 'pipe',
          encoding: 'utf-8',
        })
      } catch (error) {
        const execError = error as { stderr?: string; stdout?: string }
        const errorOutput = execError.stderr || execError.stdout || 'Unknown error'
        expect.fail(`WASM compilation failed:\n${errorOutput}`)
      }
    })

    it('should pass cargo test (if rustc available)', () => {
      if (!isRustAvailable()) {
        console.log('Skipping: rustc not available')
        return
      }

      // Run cargo test to verify the unit tests pass
      try {
        execSync('cargo test', {
          cwd: TEMPLATE_DIR,
          stdio: 'pipe',
          encoding: 'utf-8',
        })
      } catch (error) {
        const execError = error as { stderr?: string; stdout?: string }
        const errorOutput = execError.stderr || execError.stdout || 'Unknown error'
        expect.fail(`Rust tests failed:\n${errorOutput}`)
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
      const requiredFiles = ['src/lib.rs']

      for (const file of requiredFiles) {
        const filePath = path.join(TEMPLATE_DIR, file)
        expect(fs.existsSync(filePath)).toBe(true)
      }
    })

    it('should have Cargo.toml', () => {
      const filePath = path.join(TEMPLATE_DIR, 'Cargo.toml')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('should have build.sh', () => {
      const filePath = path.join(TEMPLATE_DIR, 'build.sh')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('should have wrangler.toml', () => {
      const filePath = path.join(TEMPLATE_DIR, 'wrangler.toml')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('should not have target directory in template', () => {
      // Templates should not include compiled output
      const targetPath = path.join(TEMPLATE_DIR, 'target')
      expect(fs.existsSync(targetPath)).toBe(false)
    })

    it('should not have pkg directory in template', () => {
      // Templates should not include wasm-pack output
      const pkgPath = path.join(TEMPLATE_DIR, 'pkg')
      expect(fs.existsSync(pkgPath)).toBe(false)
    })

    it('should not have Cargo.lock in template', () => {
      // Library templates typically don't include Cargo.lock
      const lockPath = path.join(TEMPLATE_DIR, 'Cargo.lock')
      expect(fs.existsSync(lockPath)).toBe(false)
    })
  })

  describe('#[no_mangle] exports', () => {
    let libContent: string

    beforeAll(() => {
      const libPath = path.join(TEMPLATE_DIR, 'src', 'lib.rs')
      libContent = fs.readFileSync(libPath, 'utf-8')
    })

    it('should export memory allocation functions', () => {
      // Essential for WASM host to allocate memory
      expect(libContent).toMatch(/#\[no_mangle\]\s*\n\s*pub\s+extern\s+["']C["']\s+fn\s+alloc/)
      expect(libContent).toMatch(/#\[no_mangle\]\s*\n\s*pub\s+extern\s+["']C["']\s+fn\s+dealloc/)
    })

    it('should have raw FFI function exports', () => {
      // Should have at least one raw_ prefixed function for direct WASM calls
      expect(libContent).toMatch(/#\[no_mangle\]\s*\n\s*pub\s+extern\s+["']C["']\s+fn\s+raw_/)
    })

    it('should use i32 for FFI-safe integers', () => {
      // FFI functions should use i32/u32 for portability
      const ffiMatches = libContent.match(/extern\s+["']C["']\s+fn\s+\w+\([^)]*\)/g) || []
      expect(ffiMatches.length).toBeGreaterThan(0)

      // At least some should use i32
      const hasI32 = ffiMatches.some((match) => match.includes('i32'))
      expect(hasI32).toBe(true)
    })
  })
})
