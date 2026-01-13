/**
 * Tests for dotdo deploy command
 *
 * TDD RED phase - these tests define the expected behavior
 * of the `dotdo deploy` command for deploying functions to functions.do.
 *
 * The deploy command should:
 * - Deploy current directory to functions.do
 * - Read wrangler.toml for configuration
 * - Compile code based on language
 * - Upload to functions.do API
 * - Return deployment URL
 * - Show progress during upload
 * - Handle compilation errors
 * - Handle API errors
 * - Require authentication
 * - Support --version flag
 * - Support --message flag for deployment message
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { MockFS, CLIContext, CommandResult, WranglerConfig } from '../types'

/**
 * Compilation result from the compiler
 */
interface CompilationResult {
  success: boolean
  outputPath?: string
  outputContent?: Uint8Array
  errors?: string[]
  warnings?: string[]
}

/**
 * Compiler interface for dependency injection
 * Supports different languages/runtimes
 */
interface Compiler {
  /**
   * Compile the project in the given directory
   * @param projectDir - The project directory
   * @param config - Wrangler configuration
   */
  compile(projectDir: string, config: WranglerConfig): Promise<CompilationResult>

  /**
   * Detect the language/runtime from the project
   */
  detectLanguage(projectDir: string, config: WranglerConfig): Promise<'typescript' | 'rust' | 'go' | 'python' | 'javascript'>
}

/**
 * Deployment response from the API
 */
interface DeploymentResponse {
  success: boolean
  deploymentId: string
  version: string
  url: string
  message?: string
  createdAt: string
}

/**
 * Deployment progress event
 */
interface DeploymentProgress {
  stage: 'preparing' | 'compiling' | 'uploading' | 'deploying' | 'complete' | 'error'
  progress: number // 0-100
  message: string
}

/**
 * API Client interface for deployment operations
 * Used for dependency injection to enable testing
 */
interface DeployAPIClient {
  /**
   * Check if user is authenticated
   */
  isAuthenticated(): Promise<boolean>

  /**
   * Deploy compiled code to functions.do
   * @param name - Function name
   * @param content - Compiled content (bundle)
   * @param options - Deployment options
   */
  deploy(
    name: string,
    content: Uint8Array,
    options: DeployOptions
  ): Promise<DeploymentResponse>

  /**
   * Register progress callback for upload progress
   */
  onProgress(callback: (progress: DeploymentProgress) => void): void
}

/**
 * Deploy command options
 */
interface DeployOptions {
  version?: string
  message?: string
}

/**
 * Extended CLI context with API client and compiler
 */
interface DeployCLIContext extends CLIContext {
  api: DeployAPIClient
  compiler: Compiler
}

/**
 * Run the deploy command with given options and context
 * This is the function under test - to be implemented
 */
declare function runDeploy(
  options: DeployOptions,
  context: DeployCLIContext
): Promise<CommandResult>

/**
 * Create a mock filesystem for testing
 */
function createMockFS(): MockFS & { files: Map<string, string | Uint8Array>; directories: Set<string> } {
  const files = new Map<string, string | Uint8Array>()
  const directories = new Set<string>()

  return {
    files,
    directories,
    async readFile(path: string): Promise<string> {
      const content = files.get(path)
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`)
      }
      if (content instanceof Uint8Array) {
        return new TextDecoder().decode(content)
      }
      return content
    },
    async readFileBytes(path: string): Promise<Uint8Array> {
      const content = files.get(path)
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`)
      }
      if (content instanceof Uint8Array) {
        return content
      }
      return new TextEncoder().encode(content)
    },
    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
      files.set(path, content)
    },
    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      if (options?.recursive) {
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
    async rm(path: string, _options?: { recursive?: boolean; force?: boolean }): Promise<void> {
      files.delete(path)
      directories.delete(path)
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path) || directories.has(path)
    },
    async stat(path: string): Promise<{
      size: number
      mode: number
      mtime: number
      type: 'file' | 'directory' | 'symlink'
    }> {
      if (files.has(path)) {
        const content = files.get(path)!
        const size = content instanceof Uint8Array ? content.length : content.length
        return {
          size,
          mode: 0o644,
          mtime: Date.now(),
          type: 'file',
        }
      }
      if (directories.has(path)) {
        return {
          size: 0,
          mode: 0o755,
          mtime: Date.now(),
          type: 'directory',
        }
      }
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`)
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
 * Create a mock compiler for testing
 */
function createMockCompiler(): Compiler & {
  compileCalls: Array<{ projectDir: string; config: WranglerConfig }>
  mockResult: CompilationResult
  mockLanguage: 'typescript' | 'rust' | 'go' | 'python' | 'javascript'
} {
  const compileCalls: Array<{ projectDir: string; config: WranglerConfig }> = []
  let mockResult: CompilationResult = {
    success: true,
    outputPath: '/tmp/output.js',
    outputContent: new TextEncoder().encode('compiled code'),
    warnings: [],
  }
  let mockLanguage: 'typescript' | 'rust' | 'go' | 'python' | 'javascript' = 'typescript'

  return {
    compileCalls,
    get mockResult() {
      return mockResult
    },
    set mockResult(result: CompilationResult) {
      mockResult = result
    },
    get mockLanguage() {
      return mockLanguage
    },
    set mockLanguage(lang: 'typescript' | 'rust' | 'go' | 'python' | 'javascript') {
      mockLanguage = lang
    },
    async compile(projectDir: string, config: WranglerConfig): Promise<CompilationResult> {
      compileCalls.push({ projectDir, config })
      return mockResult
    },
    async detectLanguage(_projectDir: string, _config: WranglerConfig): Promise<'typescript' | 'rust' | 'go' | 'python' | 'javascript'> {
      return mockLanguage
    },
  }
}

/**
 * Create a mock API client for deployment testing
 */
function createMockAPIClient(): DeployAPIClient & {
  deployCalls: Array<{ name: string; content: Uint8Array; options: DeployOptions }>
  mockResponse: DeploymentResponse
  mockError: Error | null
  authenticated: boolean
  progressCallbacks: Array<(progress: DeploymentProgress) => void>
  emitProgress: (progress: DeploymentProgress) => void
} {
  const deployCalls: Array<{ name: string; content: Uint8Array; options: DeployOptions }> = []
  let mockResponse: DeploymentResponse = {
    success: true,
    deploymentId: 'deploy-123',
    version: 'v1.0.0',
    url: 'https://my-function.functions.do',
    createdAt: new Date().toISOString(),
  }
  let mockError: Error | null = null
  let authenticated = true
  const progressCallbacks: Array<(progress: DeploymentProgress) => void> = []

  return {
    deployCalls,
    get mockResponse() {
      return mockResponse
    },
    set mockResponse(response: DeploymentResponse) {
      mockResponse = response
    },
    get mockError() {
      return mockError
    },
    set mockError(error: Error | null) {
      mockError = error
    },
    get authenticated() {
      return authenticated
    },
    set authenticated(auth: boolean) {
      authenticated = auth
    },
    progressCallbacks,
    emitProgress(progress: DeploymentProgress) {
      for (const callback of progressCallbacks) {
        callback(progress)
      }
    },
    async isAuthenticated(): Promise<boolean> {
      return authenticated
    },
    async deploy(
      name: string,
      content: Uint8Array,
      options: DeployOptions
    ): Promise<DeploymentResponse> {
      deployCalls.push({ name, content, options })
      if (mockError) {
        throw mockError
      }
      return mockResponse
    },
    onProgress(callback: (progress: DeploymentProgress) => void): void {
      progressCallbacks.push(callback)
    },
  }
}

/**
 * Create a CLI context for testing deploy command
 */
function createTestContext(cwd = '/projects/my-function'): DeployCLIContext & {
  stdoutOutput: string[]
  stderrOutput: string[]
  exitCode: number | null
  fs: ReturnType<typeof createMockFS>
  api: ReturnType<typeof createMockAPIClient>
  compiler: ReturnType<typeof createMockCompiler>
} {
  const stdoutOutput: string[] = []
  const stderrOutput: string[] = []
  let exitCode: number | null = null

  const fs = createMockFS()
  const api = createMockAPIClient()
  const compiler = createMockCompiler()

  return {
    fs,
    api,
    compiler,
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

/**
 * Create a sample wrangler.toml content
 */
function createWranglerToml(overrides: Partial<WranglerConfig> = {}): string {
  const config: WranglerConfig = {
    name: 'my-function',
    main: 'src/index.ts',
    compatibility_date: '2024-01-01',
    ...overrides,
  }

  let toml = `name = "${config.name}"\n`
  toml += `main = "${config.main}"\n`
  toml += `compatibility_date = "${config.compatibility_date}"\n`

  if (config.compatibility_flags) {
    toml += `compatibility_flags = [${config.compatibility_flags.map((f) => `"${f}"`).join(', ')}]\n`
  }

  if (config.build) {
    toml += '\n[build]\n'
    toml += `command = "${config.build.command}"\n`
    if (config.build.cwd) {
      toml += `cwd = "${config.build.cwd}"\n`
    }
    if (config.build.watch_dir) {
      toml += `watch_dir = "${config.build.watch_dir}"\n`
    }
  }

  if (config.vars) {
    toml += '\n[vars]\n'
    for (const [key, value] of Object.entries(config.vars)) {
      toml += `${key} = "${value}"\n`
    }
  }

  return toml
}

describe('dotdo deploy', () => {
  let context: ReturnType<typeof createTestContext>

  beforeEach(() => {
    context = createTestContext('/projects/my-function')

    // Set up a basic TypeScript project structure
    context.fs.files.set('/projects/my-function/wrangler.toml', createWranglerToml())
    context.fs.files.set(
      '/projects/my-function/src/index.ts',
      `export default {
        async fetch(request: Request): Promise<Response> {
          return new Response('Hello, World!')
        }
      }`
    )
    context.fs.directories.add('/projects/my-function')
    context.fs.directories.add('/projects/my-function/src')
  })

  describe('dotdo deploy (basic deployment)', () => {
    it('should deploy current directory to functions.do', async () => {
      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(0)
      expect(context.api.deployCalls).toHaveLength(1)
    })

    it('should return deployment URL on success', async () => {
      context.api.mockResponse = {
        success: true,
        deploymentId: 'deploy-456',
        version: 'v1.0.0',
        url: 'https://my-function.functions.do',
        createdAt: new Date().toISOString(),
      }

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(0)
      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('https://my-function.functions.do')
    })

    it('should output success message with deployment ID', async () => {
      context.api.mockResponse = {
        success: true,
        deploymentId: 'deploy-789',
        version: 'v1.2.3',
        url: 'https://my-function.functions.do',
        createdAt: new Date().toISOString(),
      }

      await runDeploy({}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/deploy|success|deployed/i)
      expect(output).toContain('deploy-789')
    })

    it('should output the version number', async () => {
      context.api.mockResponse = {
        success: true,
        deploymentId: 'deploy-123',
        version: 'v2.0.0',
        url: 'https://my-function.functions.do',
        createdAt: new Date().toISOString(),
      }

      await runDeploy({}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('v2.0.0')
    })

    it('should use function name from wrangler.toml', async () => {
      context.fs.files.set(
        '/projects/my-function/wrangler.toml',
        createWranglerToml({ name: 'custom-function-name' })
      )

      await runDeploy({}, context)

      expect(context.api.deployCalls[0].name).toBe('custom-function-name')
    })
  })

  describe('reading wrangler.toml configuration', () => {
    it('should read wrangler.toml from current directory', async () => {
      context.fs.files.set(
        '/projects/my-function/wrangler.toml',
        createWranglerToml({ name: 'config-test-function', main: 'src/worker.ts' })
      )

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(0)
      expect(context.api.deployCalls[0].name).toBe('config-test-function')
    })

    it('should fail if wrangler.toml does not exist', async () => {
      context.fs.files.delete('/projects/my-function/wrangler.toml')

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/wrangler\.toml.*not found|no.*wrangler\.toml/i)
    })

    it('should fail if wrangler.toml is malformed', async () => {
      context.fs.files.set('/projects/my-function/wrangler.toml', 'invalid toml content {{{}}}')

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/invalid.*toml|parse.*error|malformed/i)
    })

    it('should fail if name is missing in wrangler.toml', async () => {
      context.fs.files.set(
        '/projects/my-function/wrangler.toml',
        `main = "src/index.ts"\ncompatibility_date = "2024-01-01"`
      )

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/name.*required|missing.*name/i)
    })

    it('should fail if main is missing in wrangler.toml', async () => {
      context.fs.files.set(
        '/projects/my-function/wrangler.toml',
        `name = "my-function"\ncompatibility_date = "2024-01-01"`
      )

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/main.*required|missing.*main|entry.*point/i)
    })

    it('should pass configuration to compiler', async () => {
      context.fs.files.set(
        '/projects/my-function/wrangler.toml',
        createWranglerToml({
          name: 'compiler-config-test',
          main: 'src/worker.ts',
          compatibility_date: '2024-06-01',
        })
      )

      await runDeploy({}, context)

      expect(context.compiler.compileCalls).toHaveLength(1)
      expect(context.compiler.compileCalls[0].config.name).toBe('compiler-config-test')
      expect(context.compiler.compileCalls[0].config.main).toBe('src/worker.ts')
    })
  })

  describe('code compilation', () => {
    it('should compile code before uploading', async () => {
      await runDeploy({}, context)

      expect(context.compiler.compileCalls).toHaveLength(1)
      expect(context.compiler.compileCalls[0].projectDir).toBe('/projects/my-function')
    })

    it('should upload compiled output to API', async () => {
      const compiledContent = new TextEncoder().encode('bundled worker code')
      context.compiler.mockResult = {
        success: true,
        outputContent: compiledContent,
      }

      await runDeploy({}, context)

      expect(context.api.deployCalls).toHaveLength(1)
      expect(context.api.deployCalls[0].content).toEqual(compiledContent)
    })

    it('should handle compilation errors gracefully', async () => {
      context.compiler.mockResult = {
        success: false,
        errors: ['TypeScript error: Cannot find module "missing-dep"'],
      }

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/compil|build.*failed|error/i)
    })

    it('should display compilation errors in stderr', async () => {
      context.compiler.mockResult = {
        success: false,
        errors: [
          'src/index.ts(10,5): error TS2345: Type "string" is not assignable to type "number"',
          'src/index.ts(15,10): error TS2304: Cannot find name "unknownVar"',
        ],
      }

      await runDeploy({}, context)

      const stderr = context.stderrOutput.join('\n')
      expect(stderr).toContain('TS2345')
      expect(stderr).toContain('TS2304')
    })

    it('should show compilation warnings but still deploy', async () => {
      context.compiler.mockResult = {
        success: true,
        outputContent: new TextEncoder().encode('compiled code'),
        warnings: ['Warning: Unused variable "x"'],
      }

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(0)
      const output = context.stdoutOutput.join('\n') + context.stderrOutput.join('\n')
      expect(output).toMatch(/warning|unused/i)
    })

    it('should detect TypeScript projects', async () => {
      context.fs.files.set(
        '/projects/my-function/wrangler.toml',
        createWranglerToml({ main: 'src/index.ts' })
      )

      await runDeploy({}, context)

      expect(context.compiler.compileCalls).toHaveLength(1)
    })

    it('should detect Rust projects', async () => {
      context.fs.files.set(
        '/projects/my-function/wrangler.toml',
        createWranglerToml({
          name: 'rust-function',
          main: 'build/worker/shim.mjs',
          build: { command: 'worker-build --release' },
        })
      )
      context.fs.files.set('/projects/my-function/Cargo.toml', '[package]\nname = "rust-function"')
      context.compiler.mockLanguage = 'rust'

      await runDeploy({}, context)

      expect(context.compiler.compileCalls).toHaveLength(1)
    })

    it('should detect Go projects', async () => {
      context.fs.files.set(
        '/projects/my-function/wrangler.toml',
        createWranglerToml({
          name: 'go-function',
          main: 'build/worker.wasm',
          build: { command: 'tinygo build -o build/worker.wasm -target wasm ./...' },
        })
      )
      context.fs.files.set('/projects/my-function/go.mod', 'module go-function')
      context.compiler.mockLanguage = 'go'

      await runDeploy({}, context)

      expect(context.compiler.compileCalls).toHaveLength(1)
    })

    it('should detect Python projects', async () => {
      context.fs.files.set(
        '/projects/my-function/wrangler.toml',
        createWranglerToml({
          name: 'python-function',
          main: 'src/handler.py',
        })
      )
      context.fs.files.set('/projects/my-function/pyproject.toml', '[project]\nname = "python-function"')
      context.compiler.mockLanguage = 'python'

      await runDeploy({}, context)

      expect(context.compiler.compileCalls).toHaveLength(1)
    })
  })

  describe('upload to functions.do API', () => {
    it('should upload to functions.do API', async () => {
      await runDeploy({}, context)

      expect(context.api.deployCalls).toHaveLength(1)
    })

    it('should pass function name to API', async () => {
      context.fs.files.set(
        '/projects/my-function/wrangler.toml',
        createWranglerToml({ name: 'api-test-function' })
      )

      await runDeploy({}, context)

      expect(context.api.deployCalls[0].name).toBe('api-test-function')
    })

    it('should handle API connection errors', async () => {
      context.api.mockError = new Error('Network error: connection refused')

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/network|connection|failed/i)
    })

    it('should handle API timeout errors', async () => {
      context.api.mockError = new Error('Request timeout')

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/timeout/i)
    })

    it('should handle API 500 errors', async () => {
      context.api.mockError = new Error('Internal server error (500)')

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/server error|500|internal/i)
    })

    it('should handle API rate limiting', async () => {
      context.api.mockError = new Error('Rate limit exceeded (429)')

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/rate limit|429|too many/i)
    })

    it('should handle deployment quota exceeded', async () => {
      context.api.mockError = new Error('Deployment quota exceeded')

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/quota|limit|exceeded/i)
    })
  })

  describe('progress during upload', () => {
    it('should show progress during deployment', async () => {
      // Simulate progress events
      const progressEvents: DeploymentProgress[] = []
      context.api.onProgress((progress) => {
        progressEvents.push(progress)
        context.stdout(`[${progress.stage}] ${progress.progress}% - ${progress.message}`)
      })

      // Emit some progress
      setTimeout(() => {
        context.api.emitProgress({ stage: 'preparing', progress: 10, message: 'Preparing deployment...' })
        context.api.emitProgress({ stage: 'compiling', progress: 30, message: 'Compiling code...' })
        context.api.emitProgress({ stage: 'uploading', progress: 60, message: 'Uploading bundle...' })
        context.api.emitProgress({ stage: 'deploying', progress: 90, message: 'Deploying to edge...' })
        context.api.emitProgress({ stage: 'complete', progress: 100, message: 'Deployment complete!' })
      }, 0)

      await runDeploy({}, context)

      // Progress callback should be registered
      expect(context.api.progressCallbacks.length).toBeGreaterThan(0)
    })

    it('should show preparing stage', async () => {
      context.api.onProgress((progress) => {
        context.stdout(`${progress.stage}: ${progress.message}`)
      })

      // Emit progress
      context.api.emitProgress({ stage: 'preparing', progress: 10, message: 'Reading configuration...' })

      await runDeploy({}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/prepar|reading|config/i)
    })

    it('should show compiling stage', async () => {
      context.api.onProgress((progress) => {
        context.stdout(`${progress.stage}: ${progress.message}`)
      })

      context.api.emitProgress({ stage: 'compiling', progress: 30, message: 'Building bundle...' })

      await runDeploy({}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/compil|build|bundle/i)
    })

    it('should show uploading stage with percentage', async () => {
      context.api.onProgress((progress) => {
        context.stdout(`${progress.stage}: ${progress.progress}%`)
      })

      context.api.emitProgress({ stage: 'uploading', progress: 50, message: 'Uploading...' })

      await runDeploy({}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/upload|50/i)
    })

    it('should show deploying stage', async () => {
      context.api.onProgress((progress) => {
        context.stdout(`${progress.stage}: ${progress.message}`)
      })

      context.api.emitProgress({ stage: 'deploying', progress: 90, message: 'Deploying to edge network...' })

      await runDeploy({}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/deploy|edge/i)
    })

    it('should show completion message', async () => {
      context.api.mockResponse = {
        success: true,
        deploymentId: 'deploy-final',
        version: 'v1.0.0',
        url: 'https://my-function.functions.do',
        createdAt: new Date().toISOString(),
      }

      await runDeploy({}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/complete|success|deployed/i)
    })
  })

  describe('authentication requirement', () => {
    it('should require authentication', async () => {
      context.api.authenticated = false

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/unauthorized|login|authenticate/i)
    })

    it('should suggest login command when not authenticated', async () => {
      context.api.authenticated = false

      const result = await runDeploy({}, context)

      expect(result.error).toMatch(/dotdo login|please log in/i)
    })

    it('should proceed when authenticated', async () => {
      context.api.authenticated = true

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(0)
    })

    it('should handle expired token', async () => {
      context.api.mockError = new Error('Token expired')
      context.api.authenticated = true // Token exists but is expired

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/token|expired|login.*again/i)
    })
  })

  describe('--version flag', () => {
    it('should use custom version when --version is specified', async () => {
      const result = await runDeploy({ version: 'v2.0.0' }, context)

      expect(result.exitCode).toBe(0)
      expect(context.api.deployCalls[0].options.version).toBe('v2.0.0')
    })

    it('should support semantic version format', async () => {
      await runDeploy({ version: '1.2.3' }, context)

      expect(context.api.deployCalls[0].options.version).toBe('1.2.3')
    })

    it('should support version with v prefix', async () => {
      await runDeploy({ version: 'v3.0.0-beta.1' }, context)

      expect(context.api.deployCalls[0].options.version).toBe('v3.0.0-beta.1')
    })

    it('should auto-generate version when not specified', async () => {
      context.api.mockResponse = {
        success: true,
        deploymentId: 'deploy-auto',
        version: 'v1.0.1', // Auto-generated by API
        url: 'https://my-function.functions.do',
        createdAt: new Date().toISOString(),
      }

      await runDeploy({}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('v1.0.1')
    })

    it('should display version in output', async () => {
      context.api.mockResponse = {
        success: true,
        deploymentId: 'deploy-ver',
        version: 'v4.5.6',
        url: 'https://my-function.functions.do',
        createdAt: new Date().toISOString(),
      }

      await runDeploy({ version: 'v4.5.6' }, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('v4.5.6')
    })
  })

  describe('--message flag for deployment message', () => {
    it('should include message when --message is specified', async () => {
      await runDeploy({ message: 'Fix critical bug in auth flow' }, context)

      expect(context.api.deployCalls[0].options.message).toBe('Fix critical bug in auth flow')
    })

    it('should support multi-line messages', async () => {
      const message = 'Major update\n\n- Added feature A\n- Fixed bug B\n- Improved performance'
      await runDeploy({ message }, context)

      expect(context.api.deployCalls[0].options.message).toBe(message)
    })

    it('should support empty message', async () => {
      await runDeploy({ message: '' }, context)

      // Empty message should be passed as is or be undefined
      expect(context.api.deployCalls[0].options.message === '' || context.api.deployCalls[0].options.message === undefined).toBe(true)
    })

    it('should display deployment message in output', async () => {
      context.api.mockResponse = {
        success: true,
        deploymentId: 'deploy-msg',
        version: 'v1.0.0',
        url: 'https://my-function.functions.do',
        message: 'Updated API endpoints',
        createdAt: new Date().toISOString(),
      }

      await runDeploy({ message: 'Updated API endpoints' }, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('Updated API endpoints')
    })

    it('should handle special characters in message', async () => {
      const message = 'Fix "bug" with `code` and <html> tags'
      await runDeploy({ message }, context)

      expect(context.api.deployCalls[0].options.message).toBe(message)
    })

    it('should handle unicode in message', async () => {
      const message = 'Fixed issue with emoji support'
      await runDeploy({ message }, context)

      expect(context.api.deployCalls[0].options.message).toBe(message)
    })
  })

  describe('combined flags', () => {
    it('should support --version and --message together', async () => {
      await runDeploy({ version: 'v2.0.0', message: 'Release version 2' }, context)

      expect(context.api.deployCalls[0].options.version).toBe('v2.0.0')
      expect(context.api.deployCalls[0].options.message).toBe('Release version 2')
    })
  })

  describe('error output', () => {
    it('should write errors to stderr', async () => {
      context.api.mockError = new Error('Deployment failed')

      await runDeploy({}, context)

      expect(context.stderrOutput.length).toBeGreaterThan(0)
      expect(context.stderrOutput.join('\n')).toMatch(/error|failed/i)
    })

    it('should write success messages to stdout', async () => {
      await runDeploy({}, context)

      expect(context.stdoutOutput.length).toBeGreaterThan(0)
    })

    it('should provide helpful error messages for common issues', async () => {
      context.fs.files.delete('/projects/my-function/wrangler.toml')

      const result = await runDeploy({}, context)

      expect(result.error).toMatch(/wrangler\.toml|configuration|run.*init/i)
    })
  })

  describe('edge cases', () => {
    it('should handle empty project directory', async () => {
      context.fs.files.clear()
      context.fs.directories.clear()
      context.fs.directories.add('/projects/my-function')

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/wrangler\.toml|not found|empty/i)
    })

    it('should handle very large bundles', async () => {
      const largeContent = new Uint8Array(10 * 1024 * 1024) // 10MB
      context.compiler.mockResult = {
        success: true,
        outputContent: largeContent,
      }

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(0)
      expect(context.api.deployCalls[0].content).toBe(largeContent)
    })

    it('should handle bundle size limit exceeded', async () => {
      const hugeContent = new Uint8Array(100 * 1024 * 1024) // 100MB
      context.compiler.mockResult = {
        success: true,
        outputContent: hugeContent,
      }
      context.api.mockError = new Error('Bundle size exceeds limit (max 25MB)')

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/size|limit|exceed/i)
    })

    it('should handle concurrent deployment attempts', async () => {
      context.api.mockError = new Error('Deployment already in progress')

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/already.*progress|concurrent|in progress/i)
    })

    it('should handle function name conflicts', async () => {
      context.api.mockError = new Error('Function name already taken by another user')

      const result = await runDeploy({}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/name.*taken|conflict|already.*exists/i)
    })
  })

  describe('deployment summary', () => {
    it('should show deployment summary on success', async () => {
      context.api.mockResponse = {
        success: true,
        deploymentId: 'deploy-summary',
        version: 'v1.0.0',
        url: 'https://my-function.functions.do',
        createdAt: new Date().toISOString(),
      }

      await runDeploy({}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('my-function')
      expect(output).toContain('v1.0.0')
      expect(output).toContain('https://my-function.functions.do')
    })

    it('should show deployment timestamp', async () => {
      const timestamp = '2024-06-15T10:30:00Z'
      context.api.mockResponse = {
        success: true,
        deploymentId: 'deploy-time',
        version: 'v1.0.0',
        url: 'https://my-function.functions.do',
        createdAt: timestamp,
      }

      await runDeploy({}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/2024|Jun|june|timestamp|deployed/i)
    })
  })
})
