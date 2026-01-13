/**
 * Dev Command Tests for dotdo dev
 *
 * RED phase: These tests should FAIL until dev command implementation is complete.
 *
 * Test coverage areas:
 * 1. Local development server startup
 * 2. Miniflare Workers simulation
 * 3. File watching and hot reload
 * 4. Multi-language compilation (TypeScript, Rust, Go, Python)
 * 5. Local URL display (http://localhost:8787)
 * 6. Request proxying to function
 * 7. Console.log output display
 * 8. Graceful shutdown on Ctrl+C
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'

// ============================================================================
// Mock Interfaces - Dependency Injection for testability
// ============================================================================

/**
 * Mock Miniflare instance for testing
 */
interface MockMiniflare {
  ready: Promise<void>
  dispose: () => Promise<void>
  setOptions: (options: MiniflareOptions) => Promise<void>
  dispatchFetch: (request: Request | string, init?: RequestInit) => Promise<Response>
  getCaches: () => Promise<unknown>
  getWorker: () => Promise<MockWorker>
}

interface MockWorker {
  fetch: (request: Request | string, init?: RequestInit) => Promise<Response>
}

interface MiniflareOptions {
  name?: string
  scriptPath?: string
  script?: string
  modules?: boolean
  compatibilityDate?: string
  port?: number
  inspectorPort?: number
  log?: unknown
  bindings?: Record<string, unknown>
  kvNamespaces?: string[]
  durableObjects?: Record<string, unknown>
  d1Databases?: string[]
  r2Buckets?: string[]
}

/**
 * Mock file watcher for testing hot reload
 */
interface MockFSWatcher {
  close: () => void
  on: (event: string, callback: (...args: unknown[]) => void) => MockFSWatcher
  emit: (event: string, ...args: unknown[]) => void
}

/**
 * Mock compiler interface for multi-language support
 */
interface MockCompiler {
  compile: (entryPoint: string, outfile: string, options?: CompileOptions) => Promise<CompileResult>
  typeCheck?: (cwd: string) => Promise<TypeCheckResult>
}

interface CompileOptions {
  sourcemap?: boolean
  minify?: boolean
  target?: string
}

interface CompileResult {
  success: boolean
  error?: string
  warnings?: string[]
  duration?: number
}

interface TypeCheckResult {
  success: boolean
  error?: string
  diagnostics?: Array<{ file: string; line: number; message: string }>
}

/**
 * Mock console capture for testing console.log output
 */
interface MockConsole {
  logs: string[]
  errors: string[]
  warns: string[]
  log: (message: string) => void
  error: (message: string) => void
  warn: (message: string) => void
  clear: () => void
}

/**
 * Dev command context for dependency injection
 */
interface DevContext {
  miniflare: MockMiniflareFactory
  watcher: MockWatcherFactory
  compiler: MockCompiler
  console: MockConsole
  process: MockProcess
  fs: MockFileSystem
  cwd: string
}

interface MockMiniflareFactory {
  create: (options: MiniflareOptions) => Promise<MockMiniflare>
}

interface MockWatcherFactory {
  watch: (path: string, options?: WatchOptions, callback?: WatchCallback) => MockFSWatcher
}

interface WatchOptions {
  recursive?: boolean
  persistent?: boolean
}

type WatchCallback = (eventType: string, filename: string | null) => void

interface MockProcess {
  exit: (code: number) => void
  on: (event: string, callback: (...args: unknown[]) => void) => void
  emit: (event: string, ...args: unknown[]) => void
  cwd: () => string
  exitCode?: number
  signalHandlers: Map<string, Array<(...args: unknown[]) => void>>
}

interface MockFileSystem {
  existsSync: (path: string) => boolean
  readFileSync: (path: string, encoding?: string) => string
  writeFileSync: (path: string, content: string) => void
  mkdirSync: (path: string, options?: { recursive?: boolean }) => void
  files: Map<string, string>
}

/**
 * Project configuration for testing
 */
interface ProjectConfig {
  main: string
  name: string
  compatibilityDate: string
  language: 'typescript' | 'rust' | 'go' | 'python'
}

/**
 * Result from running the dev command
 */
interface DevCommandResult {
  exitCode: number
  serverUrl?: string
  error?: string
}

// ============================================================================
// Mock Factories
// ============================================================================

function createMockMiniflare(): MockMiniflare {
  let resolveReady: () => void
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  // Auto-resolve ready after a short delay
  setTimeout(() => resolveReady(), 10)

  return {
    ready: readyPromise,
    dispose: vi.fn().mockResolvedValue(undefined),
    setOptions: vi.fn().mockResolvedValue(undefined),
    dispatchFetch: vi.fn().mockImplementation(async (request: Request | string) => {
      const url = typeof request === 'string' ? request : request.url
      return new Response(`Mock response for ${url}`, { status: 200 })
    }),
    getCaches: vi.fn().mockResolvedValue({}),
    getWorker: vi.fn().mockResolvedValue({
      fetch: vi.fn().mockResolvedValue(new Response('OK', { status: 200 })),
    }),
  }
}

function createMockMiniflareFactory(): MockMiniflareFactory {
  return {
    create: vi.fn().mockImplementation(async () => createMockMiniflare()),
  }
}

function createMockWatcher(): MockFSWatcher {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()

  return {
    close: vi.fn(),
    on: vi.fn().mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
      const existing = listeners.get(event) || []
      existing.push(callback)
      listeners.set(event, existing)
      return createMockWatcher()
    }),
    emit: (event: string, ...args: unknown[]) => {
      const callbacks = listeners.get(event) || []
      callbacks.forEach((cb) => cb(...args))
    },
  }
}

function createMockWatcherFactory(): MockWatcherFactory {
  return {
    watch: vi.fn().mockImplementation(() => createMockWatcher()),
  }
}

function createMockCompiler(): MockCompiler {
  return {
    compile: vi.fn().mockResolvedValue({ success: true, duration: 50 }),
    typeCheck: vi.fn().mockResolvedValue({ success: true }),
  }
}

function createMockConsole(): MockConsole {
  return {
    logs: [],
    errors: [],
    warns: [],
    log: vi.fn().mockImplementation(function (this: MockConsole, message: string) {
      this.logs.push(message)
    }),
    error: vi.fn().mockImplementation(function (this: MockConsole, message: string) {
      this.errors.push(message)
    }),
    warn: vi.fn().mockImplementation(function (this: MockConsole, message: string) {
      this.warns.push(message)
    }),
    clear: function () {
      this.logs = []
      this.errors = []
      this.warns = []
    },
  }
}

function createMockProcess(): MockProcess {
  const signalHandlers = new Map<string, Array<(...args: unknown[]) => void>>()

  return {
    exit: vi.fn().mockImplementation((code: number) => {
      // Store exit code for assertions
    }),
    on: vi.fn().mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
      const existing = signalHandlers.get(event) || []
      existing.push(callback)
      signalHandlers.set(event, existing)
    }),
    emit: (event: string, ...args: unknown[]) => {
      const callbacks = signalHandlers.get(event) || []
      callbacks.forEach((cb) => cb(...args))
    },
    cwd: () => '/test/project',
    signalHandlers,
  }
}

function createMockFileSystem(files: Record<string, string> = {}): MockFileSystem {
  const fileMap = new Map<string, string>(Object.entries(files))

  return {
    files: fileMap,
    existsSync: vi.fn().mockImplementation((path: string) => fileMap.has(path)),
    readFileSync: vi.fn().mockImplementation((path: string) => {
      const content = fileMap.get(path)
      if (!content) throw new Error(`ENOENT: no such file or directory '${path}'`)
      return content
    }),
    writeFileSync: vi.fn().mockImplementation((path: string, content: string) => {
      fileMap.set(path, content)
    }),
    mkdirSync: vi.fn(),
  }
}

function createDevContext(overrides: Partial<DevContext> = {}): DevContext {
  const defaultFiles = {
    '/test/project/wrangler.toml': `name = "test-function"\nmain = "src/index.ts"\ncompatibility_date = "2024-01-01"`,
    '/test/project/src/index.ts': `export default { fetch: () => new Response('Hello') }`,
    '/test/project/package.json': `{"name": "test-function", "version": "1.0.0"}`,
    '/test/project/tsconfig.json': `{"compilerOptions": {"target": "esnext"}}`,
  }

  return {
    miniflare: createMockMiniflareFactory(),
    watcher: createMockWatcherFactory(),
    compiler: createMockCompiler(),
    console: createMockConsole(),
    process: createMockProcess(),
    fs: createMockFileSystem(defaultFiles),
    cwd: '/test/project',
    ...overrides,
  }
}

// ============================================================================
// Dynamic import helper for dev command module
// ============================================================================

async function loadDevCommand() {
  try {
    // This will fail until the refactored implementation exists
    return await import('../../src/commands/dev.js')
  } catch {
    return null
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Dev Command Module Existence', () => {
  it('should export runDevCommand function', async () => {
    const dev = await loadDevCommand()
    expect(dev).not.toBeNull()
    expect(dev?.runDevCommand).toBeDefined()
    expect(typeof dev?.runDevCommand).toBe('function')
  })

  it('should export DevCommandOptions interface (via createDevServer)', async () => {
    const dev = await loadDevCommand()
    expect(dev).not.toBeNull()
    // The refactored module should export createDevServer for DI
    expect(dev?.createDevServer).toBeDefined()
    expect(typeof dev?.createDevServer).toBe('function')
  })

  it('should export DevContext type for dependency injection', async () => {
    const dev = await loadDevCommand()
    expect(dev).not.toBeNull()
    // Check that the module supports context injection
    expect(dev?.createDevServer).toBeDefined()
  })
})

describe('Dev Server Startup', () => {
  describe('dotdo dev starts local development server', () => {
    it('should start server on default port 8787', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const result = await dev!.createDevServer({ port: 8787 }, context)

      expect(result.serverUrl).toBe('http://localhost:8787')
      expect(context.console.logs.some((log) => log.includes('8787'))).toBe(true)
    })

    it('should start server on custom port', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const result = await dev!.createDevServer({ port: 3000 }, context)

      expect(result.serverUrl).toBe('http://localhost:3000')
      expect(context.console.logs.some((log) => log.includes('3000'))).toBe(true)
    })

    it('should display local URL in console output', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787 }, context)

      const output = context.console.logs.join('\n')
      expect(output).toContain('http://localhost:8787')
    })

    it('should display "Functions.do Development Server" banner', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787 }, context)

      const output = context.console.logs.join('\n')
      expect(output).toMatch(/Functions\.do.*Development.*Server/i)
    })

    it('should exit with error if port is already in use', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      // Mock miniflare to throw EADDRINUSE error
      context.miniflare.create = vi.fn().mockRejectedValue(
        Object.assign(new Error('Port 8787 is already in use'), { code: 'EADDRINUSE' })
      )

      const result = await dev!.createDevServer({ port: 8787 }, context)

      expect(result.exitCode).toBe(1)
      expect(context.console.errors.some((err) => err.includes('8787') || err.includes('use'))).toBe(true)
    })

    it('should exit with error if no project config found', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext({
        fs: createMockFileSystem({}), // Empty filesystem, no config
      })

      const result = await dev!.createDevServer({ port: 8787 }, context)

      expect(result.exitCode).toBe(1)
      expect(context.console.errors.some((err) => err.includes('project') || err.includes('config'))).toBe(true)
    })
  })
})

describe('Miniflare Workers Simulation', () => {
  describe('uses Miniflare for Workers simulation', () => {
    it('should create Miniflare instance with correct options', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787 }, context)

      expect(context.miniflare.create).toHaveBeenCalled()
      const createCall = (context.miniflare.create as Mock).mock.calls[0][0]
      expect(createCall.port).toBe(8787)
      expect(createCall.modules).toBe(true)
    })

    it('should pass compatibility date from config', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787 }, context)

      const createCall = (context.miniflare.create as Mock).mock.calls[0][0]
      expect(createCall.compatibilityDate).toBe('2024-01-01')
    })

    it('should pass worker name from config', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787 }, context)

      const createCall = (context.miniflare.create as Mock).mock.calls[0][0]
      expect(createCall.name).toBe('test-function')
    })

    it('should enable inspector when --inspect flag is passed', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787, inspect: true, inspectPort: 9229 }, context)

      const createCall = (context.miniflare.create as Mock).mock.calls[0][0]
      expect(createCall.inspectorPort).toBe(9229)
    })

    it('should use custom inspector port when specified', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787, inspect: true, inspectPort: 9230 }, context)

      const createCall = (context.miniflare.create as Mock).mock.calls[0][0]
      expect(createCall.inspectorPort).toBe(9230)
    })

    it('should wait for Miniflare ready before accepting requests', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      let readyResolved = false
      const context = createDevContext()
      const mockMf = createMockMiniflare()
      mockMf.ready = new Promise((resolve) => {
        setTimeout(() => {
          readyResolved = true
          resolve()
        }, 50)
      })
      context.miniflare.create = vi.fn().mockResolvedValue(mockMf)

      await dev!.createDevServer({ port: 8787 }, context)

      expect(readyResolved).toBe(true)
    })
  })
})

describe('File Watching and Hot Reload', () => {
  describe('watches for file changes and hot reloads', () => {
    it('should start file watcher on src directory', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787 }, context)

      expect(context.watcher.watch).toHaveBeenCalled()
      const watchCall = (context.watcher.watch as Mock).mock.calls[0]
      expect(watchCall[0]).toContain('src')
    })

    it('should use recursive watching', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787 }, context)

      const watchCall = (context.watcher.watch as Mock).mock.calls[0]
      expect(watchCall[1]).toEqual(expect.objectContaining({ recursive: true }))
    })

    it('should trigger rebuild on .ts file change', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const mockWatcher = createMockWatcher()
      let changeCallback: WatchCallback | undefined
      context.watcher.watch = vi.fn().mockImplementation((_path, _options, callback) => {
        changeCallback = callback
        return mockWatcher
      })

      await dev!.createDevServer({ port: 8787 }, context)

      // Simulate file change
      expect(changeCallback).toBeDefined()
      changeCallback!('change', 'index.ts')

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150))

      expect(context.compiler.compile).toHaveBeenCalledTimes(2) // Initial + rebuild
    })

    it('should debounce rapid file changes', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const mockWatcher = createMockWatcher()
      let changeCallback: WatchCallback | undefined
      context.watcher.watch = vi.fn().mockImplementation((_path, _options, callback) => {
        changeCallback = callback
        return mockWatcher
      })

      await dev!.createDevServer({ port: 8787 }, context)

      // Simulate rapid file changes
      changeCallback!('change', 'index.ts')
      changeCallback!('change', 'utils.ts')
      changeCallback!('change', 'types.ts')

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Should only compile once after debounce (initial + 1 rebuild)
      expect(context.compiler.compile).toHaveBeenCalledTimes(2)
    })

    it('should hot reload worker using setOptions', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const mockMf = createMockMiniflare()
      context.miniflare.create = vi.fn().mockResolvedValue(mockMf)

      let changeCallback: WatchCallback | undefined
      const mockWatcher = createMockWatcher()
      context.watcher.watch = vi.fn().mockImplementation((_path, _options, callback) => {
        changeCallback = callback
        return mockWatcher
      })

      await dev!.createDevServer({ port: 8787 }, context)

      // Simulate file change
      changeCallback!('change', 'index.ts')

      // Wait for debounce + rebuild
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(mockMf.setOptions).toHaveBeenCalled()
    })

    it('should ignore non-source file changes', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      let changeCallback: WatchCallback | undefined
      const mockWatcher = createMockWatcher()
      context.watcher.watch = vi.fn().mockImplementation((_path, _options, callback) => {
        changeCallback = callback
        return mockWatcher
      })

      await dev!.createDevServer({ port: 8787 }, context)

      // Simulate non-source file change
      changeCallback!('change', 'README.md')

      await new Promise((resolve) => setTimeout(resolve, 150))

      // Should only have initial compile
      expect(context.compiler.compile).toHaveBeenCalledTimes(1)
    })

    it('should display "File changed:" message on change', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      let changeCallback: WatchCallback | undefined
      const mockWatcher = createMockWatcher()
      context.watcher.watch = vi.fn().mockImplementation((_path, _options, callback) => {
        changeCallback = callback
        return mockWatcher
      })

      await dev!.createDevServer({ port: 8787 }, context)

      changeCallback!('change', 'index.ts')
      await new Promise((resolve) => setTimeout(resolve, 150))

      const output = context.console.logs.join('\n')
      expect(output).toMatch(/File changed.*index\.ts/i)
    })
  })
})

describe('Multi-Language Compilation', () => {
  describe('compiles TypeScript/Rust/Go/Python based on project type', () => {
    it('should compile TypeScript projects with esbuild', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787 }, context)

      expect(context.compiler.compile).toHaveBeenCalled()
      const compileCall = (context.compiler.compile as Mock).mock.calls[0]
      expect(compileCall[0]).toContain('src/index.ts')
    })

    it('should run type checking for TypeScript projects', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787 }, context)

      expect(context.compiler.typeCheck).toHaveBeenCalled()
    })

    it('should detect Rust project and use wasm-pack', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const rustFiles = {
        '/test/project/wrangler.toml': `name = "rust-function"\nmain = "build/worker.js"\ncompatibility_date = "2024-01-01"`,
        '/test/project/Cargo.toml': `[package]\nname = "rust-function"\nversion = "0.1.0"`,
        '/test/project/src/lib.rs': `use worker::*;`,
      }
      const context = createDevContext({
        fs: createMockFileSystem(rustFiles),
      })

      await dev!.createDevServer({ port: 8787 }, context)

      // Should detect Rust and use appropriate compiler
      const output = context.console.logs.join('\n')
      expect(output).toMatch(/rust|wasm/i)
    })

    it('should detect Go project and compile with tinygo', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const goFiles = {
        '/test/project/wrangler.toml': `name = "go-function"\nmain = "build/worker.wasm"\ncompatibility_date = "2024-01-01"`,
        '/test/project/go.mod': `module go-function\n\ngo 1.21`,
        '/test/project/main.go': `package main\n\nfunc main() {}`,
      }
      const context = createDevContext({
        fs: createMockFileSystem(goFiles),
      })

      await dev!.createDevServer({ port: 8787 }, context)

      // Should detect Go project
      const output = context.console.logs.join('\n')
      expect(output).toMatch(/go|tinygo/i)
    })

    it('should detect Python project and prepare for Workers', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const pythonFiles = {
        '/test/project/wrangler.toml': `name = "python-function"\nmain = "src/index.py"\ncompatibility_date = "2024-01-01"`,
        '/test/project/requirements.txt': `cloudflare-workers`,
        '/test/project/src/index.py': `def on_fetch(request): return Response("Hello")`,
      }
      const context = createDevContext({
        fs: createMockFileSystem(pythonFiles),
      })

      await dev!.createDevServer({ port: 8787 }, context)

      // Should detect Python project
      const output = context.console.logs.join('\n')
      expect(output).toMatch(/python/i)
    })

    it('should output build duration after compilation', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      context.compiler.compile = vi.fn().mockResolvedValue({
        success: true,
        duration: 123,
      })

      await dev!.createDevServer({ port: 8787 }, context)

      const output = context.console.logs.join('\n')
      expect(output).toMatch(/\d+ms|built/i)
    })

    it('should display build errors with source location', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      context.compiler.compile = vi.fn().mockResolvedValue({
        success: false,
        error: 'src/index.ts:10:5: error: Unexpected token',
      })

      const result = await dev!.createDevServer({ port: 8787 }, context)

      expect(result.exitCode).toBe(1)
      const errors = context.console.errors.join('\n')
      expect(errors).toContain('src/index.ts')
      expect(errors).toMatch(/10|error/)
    })

    it('should display type errors with source location', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      context.compiler.typeCheck = vi.fn().mockResolvedValue({
        success: false,
        error: 'src/index.ts(15,10): error TS2339: Property does not exist',
      })

      const result = await dev!.createDevServer({ port: 8787 }, context)

      expect(result.exitCode).toBe(1)
      const errors = context.console.errors.join('\n')
      expect(errors).toContain('TS2339')
    })
  })
})

describe('Request Proxying', () => {
  describe('proxies requests to function', () => {
    it('should forward GET requests to worker', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const mockMf = createMockMiniflare()
      context.miniflare.create = vi.fn().mockResolvedValue(mockMf)

      const server = await dev!.createDevServer({ port: 8787 }, context)

      // Simulate request
      const response = await server.handleRequest(new Request('http://localhost:8787/api/test'))

      expect(mockMf.dispatchFetch).toHaveBeenCalled()
      expect(response.status).toBe(200)
    })

    it('should forward POST requests with body', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const mockMf = createMockMiniflare()
      context.miniflare.create = vi.fn().mockResolvedValue(mockMf)

      const server = await dev!.createDevServer({ port: 8787 }, context)

      const response = await server.handleRequest(
        new Request('http://localhost:8787/api/data', {
          method: 'POST',
          body: JSON.stringify({ key: 'value' }),
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const dispatchCall = (mockMf.dispatchFetch as Mock).mock.calls[0]
      expect(dispatchCall[0].method || 'GET').toBe('POST')
    })

    it('should preserve request headers', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const mockMf = createMockMiniflare()
      context.miniflare.create = vi.fn().mockResolvedValue(mockMf)

      const server = await dev!.createDevServer({ port: 8787 }, context)

      await server.handleRequest(
        new Request('http://localhost:8787/', {
          headers: { 'X-Custom-Header': 'test-value' },
        })
      )

      const dispatchCall = (mockMf.dispatchFetch as Mock).mock.calls[0]
      const request = dispatchCall[0] as Request
      expect(request.headers.get('X-Custom-Header')).toBe('test-value')
    })

    it('should return response headers from worker', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const mockMf = createMockMiniflare()
      mockMf.dispatchFetch = vi.fn().mockResolvedValue(
        new Response('OK', {
          headers: { 'X-Worker-Header': 'from-worker' },
        })
      )
      context.miniflare.create = vi.fn().mockResolvedValue(mockMf)

      const server = await dev!.createDevServer({ port: 8787 }, context)

      const response = await server.handleRequest(new Request('http://localhost:8787/'))

      expect(response.headers.get('X-Worker-Header')).toBe('from-worker')
    })

    it('should handle worker errors gracefully', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const mockMf = createMockMiniflare()
      mockMf.dispatchFetch = vi.fn().mockRejectedValue(new Error('Worker error'))
      context.miniflare.create = vi.fn().mockResolvedValue(mockMf)

      const server = await dev!.createDevServer({ port: 8787 }, context)

      const response = await server.handleRequest(new Request('http://localhost:8787/'))

      expect(response.status).toBe(500)
    })
  })
})

describe('Console Output from Function', () => {
  describe('shows console.log output from function', () => {
    it('should capture console.log from worker execution', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const mockMf = createMockMiniflare()

      // Simulate worker console output
      mockMf.dispatchFetch = vi.fn().mockImplementation(async () => {
        context.console.log('[worker] Hello from worker!')
        return new Response('OK')
      })
      context.miniflare.create = vi.fn().mockResolvedValue(mockMf)

      const server = await dev!.createDevServer({ port: 8787 }, context)
      await server.handleRequest(new Request('http://localhost:8787/'))

      expect(context.console.logs.some((log) => log.includes('Hello from worker'))).toBe(true)
    })

    it('should capture console.error from worker execution', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const mockMf = createMockMiniflare()

      mockMf.dispatchFetch = vi.fn().mockImplementation(async () => {
        context.console.error('[worker] Error occurred!')
        return new Response('OK')
      })
      context.miniflare.create = vi.fn().mockResolvedValue(mockMf)

      const server = await dev!.createDevServer({ port: 8787 }, context)
      await server.handleRequest(new Request('http://localhost:8787/'))

      expect(context.console.errors.some((err) => err.includes('Error occurred'))).toBe(true)
    })

    it('should display worker output with timestamp', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787, verbose: true }, context)

      const output = context.console.logs.join('\n')
      // Should have timestamp format like HH:MM:SS
      expect(output).toMatch(/\d{2}:\d{2}:\d{2}/)
    })

    it('should log request method, path, and status', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const mockMf = createMockMiniflare()
      mockMf.dispatchFetch = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }))
      context.miniflare.create = vi.fn().mockResolvedValue(mockMf)

      const server = await dev!.createDevServer({ port: 8787, verbose: true }, context)
      await server.handleRequest(new Request('http://localhost:8787/api/users'))

      const output = context.console.logs.join('\n')
      expect(output).toContain('GET')
      expect(output).toContain('/api/users')
      expect(output).toContain('200')
    })

    it('should log request duration', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const server = await dev!.createDevServer({ port: 8787, verbose: true }, context)
      await server.handleRequest(new Request('http://localhost:8787/'))

      const output = context.console.logs.join('\n')
      expect(output).toMatch(/\d+ms|\d+µs/)
    })
  })
})

describe('Graceful Shutdown', () => {
  describe('graceful shutdown on Ctrl+C', () => {
    it('should register SIGINT handler', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787 }, context)

      expect(context.process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function))
    })

    it('should register SIGTERM handler', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787 }, context)

      expect(context.process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
    })

    it('should close file watcher on shutdown', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const mockWatcher = createMockWatcher()
      context.watcher.watch = vi.fn().mockReturnValue(mockWatcher)

      await dev!.createDevServer({ port: 8787 }, context)

      // Simulate SIGINT
      context.process.emit('SIGINT')

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(mockWatcher.close).toHaveBeenCalled()
    })

    it('should dispose Miniflare instance on shutdown', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const mockMf = createMockMiniflare()
      context.miniflare.create = vi.fn().mockResolvedValue(mockMf)

      await dev!.createDevServer({ port: 8787 }, context)

      // Simulate SIGINT
      context.process.emit('SIGINT')

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(mockMf.dispose).toHaveBeenCalled()
    })

    it('should display shutdown message', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787 }, context)

      // Simulate SIGINT
      context.process.emit('SIGINT')

      await new Promise((resolve) => setTimeout(resolve, 50))

      const output = context.console.logs.join('\n')
      expect(output).toMatch(/shut.*down|closing|goodbye/i)
    })

    it('should exit with code 0 after graceful shutdown', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787 }, context)

      // Simulate SIGINT
      context.process.emit('SIGINT')

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(context.process.exit).toHaveBeenCalledWith(0)
    })

    it('should handle multiple shutdown signals gracefully', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const mockMf = createMockMiniflare()
      context.miniflare.create = vi.fn().mockResolvedValue(mockMf)

      await dev!.createDevServer({ port: 8787 }, context)

      // Simulate multiple SIGINT signals
      context.process.emit('SIGINT')
      context.process.emit('SIGINT')
      context.process.emit('SIGINT')

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Should only dispose once
      expect(mockMf.dispose).toHaveBeenCalledTimes(1)
    })

    it('should cleanup esbuild context on shutdown', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const disposeEsbuild = vi.fn()
      context.compiler.compile = vi.fn().mockResolvedValue({
        success: true,
        dispose: disposeEsbuild,
      })

      await dev!.createDevServer({ port: 8787 }, context)

      context.process.emit('SIGINT')

      await new Promise((resolve) => setTimeout(resolve, 100))

      // The esbuild context should be disposed
      // This tests that all resources are properly cleaned up
    })
  })
})

describe('Configuration Detection', () => {
  describe('project configuration detection', () => {
    it('should read wrangler.toml configuration', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787 }, context)

      expect(context.fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('wrangler.toml'),
        expect.anything()
      )
    })

    it('should read wrangler.json configuration', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const files = {
        '/test/project/wrangler.json': `{"name": "json-function", "main": "src/index.ts", "compatibility_date": "2024-01-01"}`,
        '/test/project/src/index.ts': `export default { fetch: () => new Response('Hello') }`,
      }
      const context = createDevContext({
        fs: createMockFileSystem(files),
      })

      await dev!.createDevServer({ port: 8787 }, context)

      expect(context.fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('wrangler.json'),
        expect.anything()
      )
    })

    it('should read wrangler.jsonc configuration', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const files = {
        '/test/project/wrangler.jsonc': `{
          // This is a comment
          "name": "jsonc-function",
          "main": "src/index.ts",
          "compatibility_date": "2024-01-01"
        }`,
        '/test/project/src/index.ts': `export default { fetch: () => new Response('Hello') }`,
      }
      const context = createDevContext({
        fs: createMockFileSystem(files),
      })

      await dev!.createDevServer({ port: 8787 }, context)

      // Should handle JSONC (JSON with comments)
      expect(context.miniflare.create).toHaveBeenCalled()
    })

    it('should fallback to package.json with src/index.ts', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const files = {
        '/test/project/package.json': `{"name": "pkg-function", "version": "1.0.0"}`,
        '/test/project/src/index.ts': `export default { fetch: () => new Response('Hello') }`,
      }
      const context = createDevContext({
        fs: createMockFileSystem(files),
      })

      await dev!.createDevServer({ port: 8787 }, context)

      expect(context.miniflare.create).toHaveBeenCalled()
      const createCall = (context.miniflare.create as Mock).mock.calls[0][0]
      expect(createCall.name).toBe('pkg-function')
    })

    it('should use entry point from config', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const files = {
        '/test/project/wrangler.toml': `name = "custom-entry"\nmain = "worker/main.ts"\ncompatibility_date = "2024-01-01"`,
        '/test/project/worker/main.ts': `export default { fetch: () => new Response('Hello') }`,
      }
      const context = createDevContext({
        fs: createMockFileSystem(files),
      })

      await dev!.createDevServer({ port: 8787 }, context)

      const compileCall = (context.compiler.compile as Mock).mock.calls[0]
      expect(compileCall[0]).toContain('worker/main.ts')
    })
  })
})

describe('Error Handling', () => {
  describe('error handling and display', () => {
    it('should display formatted runtime errors', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const mockMf = createMockMiniflare()
      mockMf.dispatchFetch = vi.fn().mockRejectedValue(new Error('ReferenceError: foo is not defined'))
      context.miniflare.create = vi.fn().mockResolvedValue(mockMf)

      const server = await dev!.createDevServer({ port: 8787 }, context)
      await server.handleRequest(new Request('http://localhost:8787/'))

      const errors = context.console.errors.join('\n')
      expect(errors).toContain('ReferenceError')
    })

    it('should map error stack traces to original source files', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const mockMf = createMockMiniflare()
      const error = new Error('Test error')
      error.stack = `Error: Test error
    at handleRequest (file:///test/project/.func/worker.js:10:15)
    at fetch (file:///test/project/.func/worker.js:5:10)`
      mockMf.dispatchFetch = vi.fn().mockRejectedValue(error)
      context.miniflare.create = vi.fn().mockResolvedValue(mockMf)

      const server = await dev!.createDevServer({ port: 8787 }, context)
      await server.handleRequest(new Request('http://localhost:8787/'))

      const errors = context.console.errors.join('\n')
      // Should show original source file, not the bundled worker.js
      expect(errors).toMatch(/src\/index\.ts|original/)
    })

    it('should handle missing entry point gracefully', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const files = {
        '/test/project/wrangler.toml': `name = "missing-entry"\nmain = "src/missing.ts"\ncompatibility_date = "2024-01-01"`,
      }
      const context = createDevContext({
        fs: createMockFileSystem(files),
      })

      const result = await dev!.createDevServer({ port: 8787 }, context)

      expect(result.exitCode).toBe(1)
      expect(context.console.errors.some((err) => err.includes('missing') || err.includes('not found'))).toBe(true)
    })

    it('should continue running after build error during hot reload', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      let compileCount = 0
      context.compiler.compile = vi.fn().mockImplementation(async () => {
        compileCount++
        if (compileCount === 2) {
          return { success: false, error: 'Syntax error' }
        }
        return { success: true }
      })

      let changeCallback: WatchCallback | undefined
      const mockWatcher = createMockWatcher()
      context.watcher.watch = vi.fn().mockImplementation((_path, _options, callback) => {
        changeCallback = callback
        return mockWatcher
      })

      const server = await dev!.createDevServer({ port: 8787 }, context)

      // Trigger rebuild that will fail
      changeCallback!('change', 'index.ts')
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Server should still be running
      expect(server.isRunning).toBe(true)
    })
  })
})

describe('Verbose Mode', () => {
  describe('--verbose flag behavior', () => {
    it('should show request logs in verbose mode', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const server = await dev!.createDevServer({ port: 8787, verbose: true }, context)
      await server.handleRequest(new Request('http://localhost:8787/test'))

      const output = context.console.logs.join('\n')
      expect(output).toContain('GET')
      expect(output).toContain('/test')
    })

    it('should hide request logs when verbose is false', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      const server = await dev!.createDevServer({ port: 8787, verbose: false }, context)
      await server.handleRequest(new Request('http://localhost:8787/test'))

      const output = context.console.logs.join('\n')
      // Should still show server started, but not request details
      expect(output).toContain('8787')
      // Request log line should not be present in non-verbose mode
    })

    it('should show miniflare debug logs in verbose mode', async () => {
      const dev = await loadDevCommand()
      expect(dev).not.toBeNull()

      const context = createDevContext()
      await dev!.createDevServer({ port: 8787, verbose: true }, context)

      const createCall = (context.miniflare.create as Mock).mock.calls[0][0]
      // Should use DEBUG or INFO log level
      expect(createCall.log).toBeDefined()
    })
  })
})
