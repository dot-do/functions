/**
 * Tests for dotdo init command
 *
 * TDD RED phase - these tests define the expected behavior
 * of the `dotdo init` command for initializing function projects.
 *
 * The init command should:
 * - Create a project directory with the given name
 * - Support multiple language templates (typescript, rust, go, python)
 * - Generate appropriate configuration files
 * - Output success message with next steps
 */

import { describe, it, expect, beforeEach } from 'vitest'

/**
 * Mock filesystem interface for dependency injection
 * Following the fsx CLI pattern for testability
 */
interface MockFS {
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>
  exists: (path: string) => Promise<boolean>
  readdir: (path: string) => Promise<string[]>
}

/**
 * CLI context for dependency injection
 */
interface CLIContext {
  fs: MockFS
  stdout: (text: string) => void
  stderr: (text: string) => void
  exit: (code: number) => void
  cwd: string
}

/**
 * Result of executing a CLI command
 */
interface CommandResult {
  exitCode: number
  output?: string
  error?: string
}

/**
 * Init command options
 */
interface InitOptions {
  template?: 'typescript' | 'rust' | 'go' | 'python'
  force?: boolean
}

/**
 * Run the init command with given arguments and context
 * This is the function under test - to be implemented
 */
declare function runInit(
  name: string,
  options: InitOptions,
  context: CLIContext
): Promise<CommandResult>

/**
 * Create a mock filesystem for testing
 */
function createMockFS(): MockFS & { files: Map<string, string>; directories: Set<string> } {
  const files = new Map<string, string>()
  const directories = new Set<string>()

  return {
    files,
    directories,
    async readFile(path: string): Promise<string> {
      const content = files.get(path)
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`)
      }
      return content
    },
    async writeFile(path: string, content: string): Promise<void> {
      files.set(path, content)
    },
    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      if (options?.recursive) {
        // Create all parent directories
        const parts = path.split('/').filter(Boolean)
        let currentPath = ''
        for (const part of parts) {
          currentPath += '/' + part
          directories.add(currentPath)
        }
      } else {
        directories.add(path)
      }
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path) || directories.has(path)
    },
    async readdir(path: string): Promise<string[]> {
      const entries: string[] = []
      for (const filePath of files.keys()) {
        if (filePath.startsWith(path + '/')) {
          const relativePath = filePath.slice(path.length + 1)
          const firstPart = relativePath.split('/')[0]
          if (!entries.includes(firstPart)) {
            entries.push(firstPart)
          }
        }
      }
      for (const dirPath of directories) {
        if (dirPath.startsWith(path + '/') && dirPath !== path) {
          const relativePath = dirPath.slice(path.length + 1)
          const firstPart = relativePath.split('/')[0]
          if (!entries.includes(firstPart)) {
            entries.push(firstPart)
          }
        }
      }
      return entries
    },
  }
}

/**
 * Create a CLI context for testing
 */
function createTestContext(cwd = '/test'): CLIContext & {
  stdoutOutput: string[]
  stderrOutput: string[]
  exitCode: number | null
  fs: ReturnType<typeof createMockFS>
} {
  const stdoutOutput: string[] = []
  const stderrOutput: string[] = []
  let exitCode: number | null = null

  const fs = createMockFS()

  return {
    fs,
    stdout: (text: string) => stdoutOutput.push(text),
    stderr: (text: string) => stderrOutput.push(text),
    exit: (code: number) => {
      exitCode = code
    },
    cwd,
    stdoutOutput,
    stderrOutput,
    get exitCode() {
      return exitCode
    },
    set exitCode(code: number | null) {
      exitCode = code
    },
  }
}

describe('dotdo init', () => {
  let context: ReturnType<typeof createTestContext>

  beforeEach(() => {
    context = createTestContext('/projects')
  })

  describe('dotdo init <name>', () => {
    it('should create project directory with the given name', async () => {
      const result = await runInit('my-function', {}, context)

      expect(result.exitCode).toBe(0)
      expect(await context.fs.exists('/projects/my-function')).toBe(true)
    })

    it('should fail if project directory already exists', async () => {
      // Create existing directory
      await context.fs.mkdir('/projects/existing-project')

      const result = await runInit('existing-project', {}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/already exists/i)
    })

    it('should allow overwrite with --force flag when directory exists', async () => {
      // Create existing directory
      await context.fs.mkdir('/projects/existing-project')

      const result = await runInit('existing-project', { force: true }, context)

      expect(result.exitCode).toBe(0)
    })

    it('should fail if no name is provided', async () => {
      const result = await runInit('', {}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/name.*required/i)
    })

    it('should validate project name format', async () => {
      const result = await runInit('Invalid Name!', {}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/invalid.*name/i)
    })
  })

  describe('dotdo init --template typescript', () => {
    it('should create TypeScript project structure', async () => {
      const result = await runInit('my-ts-function', { template: 'typescript' }, context)

      expect(result.exitCode).toBe(0)
      expect(await context.fs.exists('/projects/my-ts-function/src')).toBe(true)
    })

    it('should create package.json with correct name', async () => {
      await runInit('my-ts-function', { template: 'typescript' }, context)

      const packageJsonContent = await context.fs.readFile('/projects/my-ts-function/package.json')
      const packageJson = JSON.parse(packageJsonContent)

      expect(packageJson.name).toBe('my-ts-function')
    })

    it('should create package.json with TypeScript dependencies', async () => {
      await runInit('my-ts-function', { template: 'typescript' }, context)

      const packageJsonContent = await context.fs.readFile('/projects/my-ts-function/package.json')
      const packageJson = JSON.parse(packageJsonContent)

      expect(packageJson.devDependencies).toBeDefined()
      expect(packageJson.devDependencies['typescript']).toBeDefined()
      expect(packageJson.devDependencies['wrangler']).toBeDefined()
      expect(packageJson.devDependencies['@cloudflare/workers-types']).toBeDefined()
    })

    it('should create package.json with correct scripts', async () => {
      await runInit('my-ts-function', { template: 'typescript' }, context)

      const packageJsonContent = await context.fs.readFile('/projects/my-ts-function/package.json')
      const packageJson = JSON.parse(packageJsonContent)

      expect(packageJson.scripts).toBeDefined()
      expect(packageJson.scripts.dev).toBe('wrangler dev')
      expect(packageJson.scripts.deploy).toBe('wrangler deploy')
      expect(packageJson.scripts.build).toBeDefined()
    })

    it('should create tsconfig.json with Workers-compatible configuration', async () => {
      await runInit('my-ts-function', { template: 'typescript' }, context)

      const tsconfigContent = await context.fs.readFile('/projects/my-ts-function/tsconfig.json')
      const tsconfig = JSON.parse(tsconfigContent)

      expect(tsconfig.compilerOptions).toBeDefined()
      expect(tsconfig.compilerOptions.target).toBe('ES2022')
      expect(tsconfig.compilerOptions.module).toBe('ESNext')
      expect(tsconfig.compilerOptions.moduleResolution).toBe('bundler')
      expect(tsconfig.compilerOptions.strict).toBe(true)
      expect(tsconfig.compilerOptions.types).toContain('@cloudflare/workers-types')
    })

    it('should create src/index.ts with Worker handler template', async () => {
      await runInit('my-ts-function', { template: 'typescript' }, context)

      const indexContent = await context.fs.readFile('/projects/my-ts-function/src/index.ts')

      expect(indexContent).toContain('export default')
      expect(indexContent).toContain('fetch')
      expect(indexContent).toContain('Request')
      expect(indexContent).toContain('Response')
    })

    it('should create wrangler.toml with function configuration', async () => {
      await runInit('my-ts-function', { template: 'typescript' }, context)

      const wranglerContent = await context.fs.readFile('/projects/my-ts-function/wrangler.toml')

      expect(wranglerContent).toContain('name = "my-ts-function"')
      expect(wranglerContent).toContain('main = "src/index.ts"')
      expect(wranglerContent).toMatch(/compatibility_date\s*=\s*"202[4-9]-\d{2}-\d{2}"/)
    })

    it('should create .gitignore with appropriate entries', async () => {
      await runInit('my-ts-function', { template: 'typescript' }, context)

      const gitignoreContent = await context.fs.readFile('/projects/my-ts-function/.gitignore')

      expect(gitignoreContent).toContain('node_modules')
      expect(gitignoreContent).toContain('dist')
      expect(gitignoreContent).toContain('.wrangler')
    })

    it('should default to typescript template when not specified', async () => {
      await runInit('my-function', {}, context)

      // Should create TypeScript files by default
      expect(await context.fs.exists('/projects/my-function/package.json')).toBe(true)
      expect(await context.fs.exists('/projects/my-function/tsconfig.json')).toBe(true)
      expect(await context.fs.exists('/projects/my-function/src/index.ts')).toBe(true)
    })
  })

  describe('dotdo init --template rust', () => {
    it('should create Rust project structure', async () => {
      const result = await runInit('my-rust-function', { template: 'rust' }, context)

      expect(result.exitCode).toBe(0)
      expect(await context.fs.exists('/projects/my-rust-function/src')).toBe(true)
    })

    it('should create Cargo.toml with correct name', async () => {
      await runInit('my-rust-function', { template: 'rust' }, context)

      const cargoContent = await context.fs.readFile('/projects/my-rust-function/Cargo.toml')

      expect(cargoContent).toContain('name = "my-rust-function"')
    })

    it('should create Cargo.toml with WASM crate type', async () => {
      await runInit('my-rust-function', { template: 'rust' }, context)

      const cargoContent = await context.fs.readFile('/projects/my-rust-function/Cargo.toml')

      expect(cargoContent).toContain('crate-type = ["cdylib"]')
    })

    it('should create Cargo.toml with worker dependencies', async () => {
      await runInit('my-rust-function', { template: 'rust' }, context)

      const cargoContent = await context.fs.readFile('/projects/my-rust-function/Cargo.toml')

      expect(cargoContent).toContain('worker')
      expect(cargoContent).toContain('wasm-bindgen')
    })

    it('should create src/lib.rs with fetch handler', async () => {
      await runInit('my-rust-function', { template: 'rust' }, context)

      const libContent = await context.fs.readFile('/projects/my-rust-function/src/lib.rs')

      expect(libContent).toContain('use worker::*')
      expect(libContent).toContain('#[event(fetch)]')
      expect(libContent).toContain('Response::ok')
    })

    it('should create wrangler.toml with Rust build config', async () => {
      await runInit('my-rust-function', { template: 'rust' }, context)

      const wranglerContent = await context.fs.readFile('/projects/my-rust-function/wrangler.toml')

      expect(wranglerContent).toContain('name = "my-rust-function"')
      expect(wranglerContent).toContain('[build]')
      expect(wranglerContent).toContain('worker-build')
    })

    it('should create .gitignore with Rust-specific entries', async () => {
      await runInit('my-rust-function', { template: 'rust' }, context)

      const gitignoreContent = await context.fs.readFile('/projects/my-rust-function/.gitignore')

      expect(gitignoreContent).toContain('target')
      expect(gitignoreContent).toContain('Cargo.lock')
      expect(gitignoreContent).toContain('.wrangler')
    })
  })

  describe('dotdo init --template go', () => {
    it('should create Go project structure', async () => {
      const result = await runInit('my-go-function', { template: 'go' }, context)

      expect(result.exitCode).toBe(0)
      expect(await context.fs.exists('/projects/my-go-function')).toBe(true)
    })

    it('should create go.mod with correct module name', async () => {
      await runInit('my-go-function', { template: 'go' }, context)

      const goModContent = await context.fs.readFile('/projects/my-go-function/go.mod')

      expect(goModContent).toContain('module my-go-function')
    })

    it('should create go.mod with workers dependency', async () => {
      await runInit('my-go-function', { template: 'go' }, context)

      const goModContent = await context.fs.readFile('/projects/my-go-function/go.mod')

      expect(goModContent).toContain('github.com/syumai/workers')
    })

    it('should create main.go with HTTP handler', async () => {
      await runInit('my-go-function', { template: 'go' }, context)

      const mainContent = await context.fs.readFile('/projects/my-go-function/main.go')

      expect(mainContent).toContain('package main')
      expect(mainContent).toContain('net/http')
      expect(mainContent).toContain('workers.Serve')
      expect(mainContent).toContain('http.HandleFunc')
    })

    it('should create wrangler.toml with TinyGo build config', async () => {
      await runInit('my-go-function', { template: 'go' }, context)

      const wranglerContent = await context.fs.readFile('/projects/my-go-function/wrangler.toml')

      expect(wranglerContent).toContain('name = "my-go-function"')
      expect(wranglerContent).toContain('[build]')
      expect(wranglerContent).toContain('tinygo')
    })

    it('should create Makefile for build commands', async () => {
      await runInit('my-go-function', { template: 'go' }, context)

      const makefileContent = await context.fs.readFile('/projects/my-go-function/Makefile')

      expect(makefileContent).toContain('build:')
      expect(makefileContent).toContain('tinygo build')
    })

    it('should create .gitignore with Go-specific entries', async () => {
      await runInit('my-go-function', { template: 'go' }, context)

      const gitignoreContent = await context.fs.readFile('/projects/my-go-function/.gitignore')

      expect(gitignoreContent).toContain('*.wasm')
      expect(gitignoreContent).toContain('.wrangler')
    })
  })

  describe('dotdo init --template python', () => {
    it('should create Python project structure', async () => {
      const result = await runInit('my-python-function', { template: 'python' }, context)

      expect(result.exitCode).toBe(0)
      expect(await context.fs.exists('/projects/my-python-function/src')).toBe(true)
    })

    it('should create pyproject.toml with correct name', async () => {
      await runInit('my-python-function', { template: 'python' }, context)

      const pyprojectContent = await context.fs.readFile('/projects/my-python-function/pyproject.toml')

      expect(pyprojectContent).toContain('name = "my-python-function"')
    })

    it('should create pyproject.toml with Python version requirement', async () => {
      await runInit('my-python-function', { template: 'python' }, context)

      const pyprojectContent = await context.fs.readFile('/projects/my-python-function/pyproject.toml')

      expect(pyprojectContent).toContain('requires-python')
    })

    it('should create src/handler.py with fetch handler', async () => {
      await runInit('my-python-function', { template: 'python' }, context)

      const handlerContent = await context.fs.readFile('/projects/my-python-function/src/handler.py')

      expect(handlerContent).toContain('async def on_fetch')
      expect(handlerContent).toContain('Response')
      expect(handlerContent).toContain('request')
    })

    it('should create wrangler.toml with Python config', async () => {
      await runInit('my-python-function', { template: 'python' }, context)

      const wranglerContent = await context.fs.readFile('/projects/my-python-function/wrangler.toml')

      expect(wranglerContent).toContain('name = "my-python-function"')
      expect(wranglerContent).toContain('main = "src/handler.py"')
      expect(wranglerContent).toContain('python_workers')
    })

    it('should create requirements.txt', async () => {
      await runInit('my-python-function', { template: 'python' }, context)

      expect(await context.fs.exists('/projects/my-python-function/requirements.txt')).toBe(true)
    })

    it('should create .gitignore with Python-specific entries', async () => {
      await runInit('my-python-function', { template: 'python' }, context)

      const gitignoreContent = await context.fs.readFile('/projects/my-python-function/.gitignore')

      expect(gitignoreContent).toContain('__pycache__')
      expect(gitignoreContent).toContain('.venv')
      expect(gitignoreContent).toContain('*.pyc')
      expect(gitignoreContent).toContain('.wrangler')
    })
  })

  describe('output and messaging', () => {
    it('should output success message after project creation', async () => {
      await runInit('my-function', { template: 'typescript' }, context)

      const output = context.stdoutOutput.join('\n')

      expect(output).toMatch(/success|created/i)
      expect(output).toContain('my-function')
    })

    it('should output next steps instructions', async () => {
      await runInit('my-function', { template: 'typescript' }, context)

      const output = context.stdoutOutput.join('\n')

      expect(output).toMatch(/next steps|get started/i)
      expect(output).toContain('cd my-function')
      expect(output).toMatch(/npm install|pnpm install|yarn/i)
      expect(output).toMatch(/npm run dev|pnpm dev|yarn dev/i)
    })

    it('should output deployment instructions', async () => {
      await runInit('my-function', { template: 'typescript' }, context)

      const output = context.stdoutOutput.join('\n')

      expect(output).toMatch(/deploy/i)
      expect(output).toMatch(/dotdo deploy|wrangler deploy/i)
    })

    it('should output language-specific next steps for Rust', async () => {
      await runInit('my-rust-function', { template: 'rust' }, context)

      const output = context.stdoutOutput.join('\n')

      expect(output).toContain('cd my-rust-function')
      expect(output).toMatch(/cargo|rustup/i)
    })

    it('should output language-specific next steps for Go', async () => {
      await runInit('my-go-function', { template: 'go' }, context)

      const output = context.stdoutOutput.join('\n')

      expect(output).toContain('cd my-go-function')
      expect(output).toMatch(/tinygo|go mod/i)
    })

    it('should output language-specific next steps for Python', async () => {
      await runInit('my-python-function', { template: 'python' }, context)

      const output = context.stdoutOutput.join('\n')

      expect(output).toContain('cd my-python-function')
      expect(output).toMatch(/pip|python|venv/i)
    })
  })

  describe('error handling', () => {
    it('should handle filesystem errors gracefully', async () => {
      // Create a context where mkdir fails
      const errorContext = createTestContext()
      errorContext.fs.mkdir = async () => {
        throw new Error('Permission denied')
      }

      const result = await runInit('my-function', {}, errorContext)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/permission|error|failed/i)
    })

    it('should handle invalid template name', async () => {
      // @ts-expect-error - Testing invalid input
      const result = await runInit('my-function', { template: 'invalid' }, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/invalid.*template|unknown.*template/i)
      expect(result.error).toMatch(/typescript|rust|go|python/i)
    })

    it('should list available templates in error message for invalid template', async () => {
      // @ts-expect-error - Testing invalid input
      const result = await runInit('my-function', { template: 'java' }, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toContain('typescript')
      expect(result.error).toContain('rust')
      expect(result.error).toContain('go')
      expect(result.error).toContain('python')
    })
  })

  describe('all templates create required files', () => {
    const templates = ['typescript', 'rust', 'go', 'python'] as const

    for (const template of templates) {
      describe(`${template} template`, () => {
        it('should create wrangler.toml', async () => {
          await runInit(`my-${template}-function`, { template }, context)

          expect(await context.fs.exists(`/projects/my-${template}-function/wrangler.toml`)).toBe(
            true
          )
        })

        it('should create .gitignore', async () => {
          await runInit(`my-${template}-function`, { template }, context)

          expect(await context.fs.exists(`/projects/my-${template}-function/.gitignore`)).toBe(true)
        })

        it('should set correct project name in wrangler.toml', async () => {
          await runInit(`my-${template}-function`, { template }, context)

          const wranglerContent = await context.fs.readFile(
            `/projects/my-${template}-function/wrangler.toml`
          )

          expect(wranglerContent).toContain(`name = "my-${template}-function"`)
        })

        it('should include .wrangler in .gitignore', async () => {
          await runInit(`my-${template}-function`, { template }, context)

          const gitignoreContent = await context.fs.readFile(
            `/projects/my-${template}-function/.gitignore`
          )

          expect(gitignoreContent).toContain('.wrangler')
        })

        it('should include compatibility_date in wrangler.toml', async () => {
          await runInit(`my-${template}-function`, { template }, context)

          const wranglerContent = await context.fs.readFile(
            `/projects/my-${template}-function/wrangler.toml`
          )

          expect(wranglerContent).toMatch(/compatibility_date\s*=\s*"202[4-9]-\d{2}-\d{2}"/)
        })
      })
    }
  })
})
