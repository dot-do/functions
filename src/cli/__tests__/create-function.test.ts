import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('create-function CLI', () => {
  let tempDir: string

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'create-function-test-'))
  })

  afterEach(() => {
    // Clean up temp directory
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('npx create-function hello --lang typescript', () => {
    it('should create the project directory', () => {
      const projectDir = join(tempDir, 'hello')

      // Run create-function CLI
      execSync(`npx create-function hello --lang typescript`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      expect(existsSync(projectDir)).toBe(true)
    })

    it('should create package.json with correct dependencies', () => {
      const projectDir = join(tempDir, 'hello')

      execSync(`npx create-function hello --lang typescript`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const packageJsonPath = join(projectDir, 'package.json')
      expect(existsSync(packageJsonPath)).toBe(true)

      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))

      // Check basic package.json structure
      expect(packageJson.name).toBe('hello')
      expect(packageJson.type).toBe('module')

      // Check for required dependencies
      expect(packageJson.devDependencies).toBeDefined()
      expect(packageJson.devDependencies['typescript']).toBeDefined()
      expect(packageJson.devDependencies['wrangler']).toBeDefined()
      expect(packageJson.devDependencies['@cloudflare/workers-types']).toBeDefined()

      // Check for scripts
      expect(packageJson.scripts).toBeDefined()
      expect(packageJson.scripts.dev).toBe('wrangler dev')
      expect(packageJson.scripts.deploy).toBe('wrangler deploy')
      expect(packageJson.scripts.build).toBeDefined()
    })

    it('should create tsconfig.json with correct configuration', () => {
      const projectDir = join(tempDir, 'hello')

      execSync(`npx create-function hello --lang typescript`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const tsconfigPath = join(projectDir, 'tsconfig.json')
      expect(existsSync(tsconfigPath)).toBe(true)

      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'))

      // Check compiler options for Cloudflare Workers
      expect(tsconfig.compilerOptions).toBeDefined()
      expect(tsconfig.compilerOptions.target).toBe('ES2022')
      expect(tsconfig.compilerOptions.module).toBe('ESNext')
      expect(tsconfig.compilerOptions.moduleResolution).toBe('bundler')
      expect(tsconfig.compilerOptions.strict).toBe(true)
      expect(tsconfig.compilerOptions.types).toContain('@cloudflare/workers-types')

      // Check include/exclude
      expect(tsconfig.include).toContain('src/**/*')
    })

    it('should create src/index.ts with a template function', () => {
      const projectDir = join(tempDir, 'hello')

      execSync(`npx create-function hello --lang typescript`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const indexPath = join(projectDir, 'src', 'index.ts')
      expect(existsSync(indexPath)).toBe(true)

      const indexContent = readFileSync(indexPath, 'utf-8')

      // Check that it exports a default Worker handler
      expect(indexContent).toContain('export default')
      expect(indexContent).toContain('fetch')

      // Check for proper TypeScript types
      expect(indexContent).toMatch(/Request|ExportedHandler/)
      expect(indexContent).toContain('Response')
    })

    it('should create wrangler.toml with correct Worker config', () => {
      const projectDir = join(tempDir, 'hello')

      execSync(`npx create-function hello --lang typescript`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const wranglerPath = join(projectDir, 'wrangler.toml')
      expect(existsSync(wranglerPath)).toBe(true)

      const wranglerContent = readFileSync(wranglerPath, 'utf-8')

      // Check for required wrangler.toml fields
      expect(wranglerContent).toContain('name = "hello"')
      expect(wranglerContent).toContain('main = "src/index.ts"')
      expect(wranglerContent).toContain('compatibility_date')

      // Check for compatibility flags (recommended for new projects)
      expect(wranglerContent).toMatch(/compatibility_date\s*=\s*"202[4-9]-\d{2}-\d{2}"/)
    })

    it('should create all required files in the correct structure', () => {
      const projectDir = join(tempDir, 'hello')

      execSync(`npx create-function hello --lang typescript`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      // Verify complete directory structure
      const requiredFiles = [
        'package.json',
        'tsconfig.json',
        'wrangler.toml',
        'src/index.ts',
      ]

      for (const file of requiredFiles) {
        const filePath = join(projectDir, file)
        expect(existsSync(filePath), `Expected ${file} to exist`).toBe(true)
      }
    })
  })

  describe('npx create-function hello --lang rust', () => {
    it('should create the project directory with Rust files', () => {
      const projectDir = join(tempDir, 'hello-rust')

      execSync(`npx create-function hello-rust --lang rust`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      expect(existsSync(projectDir)).toBe(true)
    })

    it('should create Cargo.toml with correct configuration', () => {
      const projectDir = join(tempDir, 'hello-rust')

      execSync(`npx create-function hello-rust --lang rust`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const cargoPath = join(projectDir, 'Cargo.toml')
      expect(existsSync(cargoPath)).toBe(true)

      const cargoContent = readFileSync(cargoPath, 'utf-8')

      // Check for project name substitution
      expect(cargoContent).toContain('name = "hello-rust"')
      // Check for WASM crate type
      expect(cargoContent).toContain('crate-type = ["cdylib"]')
      // Check for worker dependency
      expect(cargoContent).toContain('worker')
      expect(cargoContent).toContain('wasm-bindgen')
    })

    it('should create src/lib.rs with handler', () => {
      const projectDir = join(tempDir, 'hello-rust')

      execSync(`npx create-function hello-rust --lang rust`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const libPath = join(projectDir, 'src', 'lib.rs')
      expect(existsSync(libPath)).toBe(true)

      const libContent = readFileSync(libPath, 'utf-8')

      expect(libContent).toContain('use worker::*')
      expect(libContent).toContain('#[event(fetch)]')
      expect(libContent).toContain('Response::ok')
    })

    it('should create wrangler.toml with Rust build config', () => {
      const projectDir = join(tempDir, 'hello-rust')

      execSync(`npx create-function hello-rust --lang rust`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const wranglerPath = join(projectDir, 'wrangler.toml')
      expect(existsSync(wranglerPath)).toBe(true)

      const wranglerContent = readFileSync(wranglerPath, 'utf-8')

      expect(wranglerContent).toContain('name = "hello-rust"')
      expect(wranglerContent).toContain('[build]')
      expect(wranglerContent).toContain('worker-build')
    })

    it('should create all required Rust files', () => {
      const projectDir = join(tempDir, 'hello-rust')

      execSync(`npx create-function hello-rust --lang rust`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const requiredFiles = [
        'Cargo.toml',
        'wrangler.toml',
        'src/lib.rs',
        '.gitignore',
      ]

      for (const file of requiredFiles) {
        const filePath = join(projectDir, file)
        expect(existsSync(filePath), `Expected ${file} to exist`).toBe(true)
      }
    })
  })

  describe('npx create-function hello --lang python', () => {
    it('should create the project directory with Python files', () => {
      const projectDir = join(tempDir, 'hello-python')

      execSync(`npx create-function hello-python --lang python`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      expect(existsSync(projectDir)).toBe(true)
    })

    it('should create pyproject.toml with correct configuration', () => {
      const projectDir = join(tempDir, 'hello-python')

      execSync(`npx create-function hello-python --lang python`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const pyprojectPath = join(projectDir, 'pyproject.toml')
      expect(existsSync(pyprojectPath)).toBe(true)

      const pyprojectContent = readFileSync(pyprojectPath, 'utf-8')

      expect(pyprojectContent).toContain('name = "hello-python"')
      expect(pyprojectContent).toContain('requires-python')
    })

    it('should create src/handler.py with fetch handler', () => {
      const projectDir = join(tempDir, 'hello-python')

      execSync(`npx create-function hello-python --lang python`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const handlerPath = join(projectDir, 'src', 'handler.py')
      expect(existsSync(handlerPath)).toBe(true)

      const handlerContent = readFileSync(handlerPath, 'utf-8')

      expect(handlerContent).toContain('async def on_fetch')
      expect(handlerContent).toContain('Response')
      expect(handlerContent).toContain('request')
    })

    it('should create wrangler.toml with Python config', () => {
      const projectDir = join(tempDir, 'hello-python')

      execSync(`npx create-function hello-python --lang python`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const wranglerPath = join(projectDir, 'wrangler.toml')
      expect(existsSync(wranglerPath)).toBe(true)

      const wranglerContent = readFileSync(wranglerPath, 'utf-8')

      expect(wranglerContent).toContain('name = "hello-python"')
      expect(wranglerContent).toContain('main = "src/handler.py"')
      expect(wranglerContent).toContain('python_workers')
    })

    it('should create all required Python files', () => {
      const projectDir = join(tempDir, 'hello-python')

      execSync(`npx create-function hello-python --lang python`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const requiredFiles = [
        'pyproject.toml',
        'wrangler.toml',
        'src/handler.py',
        'requirements.txt',
        '.gitignore',
      ]

      for (const file of requiredFiles) {
        const filePath = join(projectDir, file)
        expect(existsSync(filePath), `Expected ${file} to exist`).toBe(true)
      }
    })
  })

  describe('npx create-function hello --lang go', () => {
    it('should create the project directory with Go files', () => {
      const projectDir = join(tempDir, 'hello-go')

      execSync(`npx create-function hello-go --lang go`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      expect(existsSync(projectDir)).toBe(true)
    })

    it('should create go.mod with correct module name', () => {
      const projectDir = join(tempDir, 'hello-go')

      execSync(`npx create-function hello-go --lang go`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const goModPath = join(projectDir, 'go.mod')
      expect(existsSync(goModPath)).toBe(true)

      const goModContent = readFileSync(goModPath, 'utf-8')

      expect(goModContent).toContain('module hello-go')
      expect(goModContent).toContain('github.com/syumai/workers')
    })

    it('should create main.go with HTTP handler', () => {
      const projectDir = join(tempDir, 'hello-go')

      execSync(`npx create-function hello-go --lang go`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const mainPath = join(projectDir, 'main.go')
      expect(existsSync(mainPath)).toBe(true)

      const mainContent = readFileSync(mainPath, 'utf-8')

      expect(mainContent).toContain('package main')
      expect(mainContent).toContain('net/http')
      expect(mainContent).toContain('workers.Serve')
      expect(mainContent).toContain('http.HandleFunc')
    })

    it('should create wrangler.toml with TinyGo build config', () => {
      const projectDir = join(tempDir, 'hello-go')

      execSync(`npx create-function hello-go --lang go`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const wranglerPath = join(projectDir, 'wrangler.toml')
      expect(existsSync(wranglerPath)).toBe(true)

      const wranglerContent = readFileSync(wranglerPath, 'utf-8')

      expect(wranglerContent).toContain('name = "hello-go"')
      expect(wranglerContent).toContain('[build]')
      expect(wranglerContent).toContain('tinygo')
    })

    it('should create Makefile for build commands', () => {
      const projectDir = join(tempDir, 'hello-go')

      execSync(`npx create-function hello-go --lang go`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const makefilePath = join(projectDir, 'Makefile')
      expect(existsSync(makefilePath)).toBe(true)

      const makefileContent = readFileSync(makefilePath, 'utf-8')

      expect(makefileContent).toContain('build:')
      expect(makefileContent).toContain('tinygo build')
    })

    it('should create all required Go files', () => {
      const projectDir = join(tempDir, 'hello-go')

      execSync(`npx create-function hello-go --lang go`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const requiredFiles = [
        'go.mod',
        'main.go',
        'wrangler.toml',
        'Makefile',
        '.gitignore',
      ]

      for (const file of requiredFiles) {
        const filePath = join(projectDir, file)
        expect(existsSync(filePath), `Expected ${file} to exist`).toBe(true)
      }
    })
  })

  describe('npx create-function hello --lang assemblyscript', () => {
    it('should create the project directory with AssemblyScript files', () => {
      const projectDir = join(tempDir, 'hello-as')

      execSync(`npx create-function hello-as --lang assemblyscript`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      expect(existsSync(projectDir)).toBe(true)
    })

    it('should create package.json with AssemblyScript dependencies', () => {
      const projectDir = join(tempDir, 'hello-as')

      execSync(`npx create-function hello-as --lang assemblyscript`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const packageJsonPath = join(projectDir, 'package.json')
      expect(existsSync(packageJsonPath)).toBe(true)

      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))

      expect(packageJson.name).toBe('hello-as')
      expect(packageJson.devDependencies['assemblyscript']).toBeDefined()
      expect(packageJson.scripts.asbuild).toBeDefined()
    })

    it('should create assembly/index.ts with fetch handler', () => {
      const projectDir = join(tempDir, 'hello-as')

      execSync(`npx create-function hello-as --lang assemblyscript`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const indexPath = join(projectDir, 'assembly', 'index.ts')
      expect(existsSync(indexPath)).toBe(true)

      const indexContent = readFileSync(indexPath, 'utf-8')

      expect(indexContent).toContain('export function fetch')
      expect(indexContent).toContain('Hello World')
    })

    it('should create asconfig.json for AssemblyScript compiler', () => {
      const projectDir = join(tempDir, 'hello-as')

      execSync(`npx create-function hello-as --lang assemblyscript`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const asconfigPath = join(projectDir, 'asconfig.json')
      expect(existsSync(asconfigPath)).toBe(true)

      const asconfig = JSON.parse(readFileSync(asconfigPath, 'utf-8'))

      expect(asconfig.targets).toBeDefined()
      expect(asconfig.targets.release).toBeDefined()
      expect(asconfig.targets.release.outFile).toContain('.wasm')
    })

    it('should create wrangler.toml with WASM config', () => {
      const projectDir = join(tempDir, 'hello-as')

      execSync(`npx create-function hello-as --lang assemblyscript`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const wranglerPath = join(projectDir, 'wrangler.toml')
      expect(existsSync(wranglerPath)).toBe(true)

      const wranglerContent = readFileSync(wranglerPath, 'utf-8')

      expect(wranglerContent).toContain('name = "hello-as"')
      expect(wranglerContent).toContain('.wasm')
      expect(wranglerContent).toContain('[build]')
    })

    it('should create all required AssemblyScript files', () => {
      const projectDir = join(tempDir, 'hello-as')

      execSync(`npx create-function hello-as --lang assemblyscript`, {
        cwd: tempDir,
        stdio: 'pipe',
      })

      const requiredFiles = [
        'package.json',
        'wrangler.toml',
        'asconfig.json',
        'assembly/index.ts',
        'assembly/tsconfig.json',
        '.gitignore',
      ]

      for (const file of requiredFiles) {
        const filePath = join(projectDir, file)
        expect(existsSync(filePath), `Expected ${file} to exist`).toBe(true)
      }
    })
  })

  describe('error handling', () => {
    it('should fail if project directory already exists', () => {
      const projectDir = join(tempDir, 'hello')

      // Create the directory first
      execSync(`mkdir -p ${projectDir}`, { cwd: tempDir })

      // Try to create a function with the same name
      expect(() => {
        execSync(`npx create-function hello --lang typescript`, {
          cwd: tempDir,
          stdio: 'pipe',
        })
      }).toThrow()
    })

    it('should fail if --lang is not provided', () => {
      expect(() => {
        execSync(`npx create-function hello`, {
          cwd: tempDir,
          stdio: 'pipe',
        })
      }).toThrow()
    })

    it('should fail if unsupported language is provided', () => {
      expect(() => {
        execSync(`npx create-function hello --lang unsupported`, {
          cwd: tempDir,
          stdio: 'pipe',
        })
      }).toThrow()
    })

    it('should list supported languages in error message for unsupported language', () => {
      try {
        execSync(`npx create-function hello --lang unsupported`, {
          cwd: tempDir,
          stdio: 'pipe',
        })
      } catch (error: any) {
        const stderr = error.stderr?.toString() || ''
        expect(stderr).toContain('typescript')
        expect(stderr).toContain('rust')
        expect(stderr).toContain('python')
        expect(stderr).toContain('go')
        expect(stderr).toContain('assemblyscript')
      }
    })
  })
})
