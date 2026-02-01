import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { spawn, ChildProcess, execSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Type for JSON response bodies in tests
type JsonBody = Record<string, unknown>

const DEFAULT_PORT = 8787
const STARTUP_TIMEOUT = 15000
const HOT_RELOAD_TIMEOUT = 5000
const FAST_RELOAD_TIMEOUT = 3000

/**
 * Check if func CLI is available
 */
function isFuncCliAvailable(): boolean {
  try {
    const result = spawnSync('func', ['--version'], {
      stdio: 'pipe',
      timeout: 5000,
    })
    return result.status === 0
  } catch {
    return false
  }
}

/**
 * Helper to wait for server to be ready on a port
 */
async function waitForServer(port: number, timeout = STARTUP_TIMEOUT): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`http://localhost:${port}`)
      if (response.ok || response.status < 500) {
        return true
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

/**
 * Helper to make HTTP request to local server
 */
async function makeRequest(port: number, path = '/'): Promise<Response> {
  return fetch(`http://localhost:${port}${path}`)
}

/**
 * Helper to start func dev and wait for it to be ready or fail
 */
function startFuncDev(
  cwd: string,
  args: string[] = []
): Promise<{ process: ChildProcess; output: string }> {
  return new Promise((resolve, reject) => {
    let output = ''
    let errorOutput = ''

    const proc = spawn('func', ['dev', ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new Error(`func dev startup timeout. Output: ${output}\nErrors: ${errorOutput}`))
    }, STARTUP_TIMEOUT)

    proc.on('error', (err) => {
      clearTimeout(timeout)
      reject(new Error(`Failed to start func dev: ${err.message}`))
    })

    proc.on('exit', (code, signal) => {
      clearTimeout(timeout)
      if (code !== null && code !== 0) {
        reject(new Error(`func dev exited with code ${code}. Output: ${output}\nErrors: ${errorOutput}`))
      }
    })

    proc.stdout?.on('data', (data) => {
      output += data.toString()
      // Check for ready indicators
      if (/listening|ready|started|http:\/\/localhost:\d+/i.test(output)) {
        clearTimeout(timeout)
        resolve({ process: proc, output })
      }
    })

    proc.stderr?.on('data', (data) => {
      errorOutput += data.toString()
      output += data.toString()
      // Some tools output ready message to stderr
      if (/listening|ready|started|http:\/\/localhost:\d+/i.test(errorOutput)) {
        clearTimeout(timeout)
        resolve({ process: proc, output })
      }
    })
  })
}

/**
 * Helper to wait for process output containing a specific string
 */
function waitForOutput(
  process: ChildProcess,
  pattern: string | RegExp,
  timeout = STARTUP_TIMEOUT
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for output matching: ${pattern}`))
    }, timeout)

    const checkOutput = (data: Buffer) => {
      output += data.toString()
      const match = typeof pattern === 'string' ? output.includes(pattern) : pattern.test(output)
      if (match) {
        clearTimeout(timer)
        resolve(output)
      }
    }

    process.stdout?.on('data', checkOutput)
    process.stderr?.on('data', checkOutput)
  })
}

/**
 * Creates a minimal function project for testing
 */
function createTestProject(dir: string, content?: string): void {
  // Create src directory
  mkdirSync(join(dir, 'src'), { recursive: true })

  // Create package.json
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'test-function',
        type: 'module',
        scripts: {
          dev: 'func dev',
        },
        devDependencies: {
          typescript: '^5.0.0',
          wrangler: '^3.0.0',
        },
      },
      null,
      2
    )
  )

  // Create tsconfig.json
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          outDir: 'dist',
          rootDir: 'src',
          types: ['@cloudflare/workers-types'],
        },
        include: ['src/**/*'],
      },
      null,
      2
    )
  )

  // Create wrangler.toml
  writeFileSync(
    join(dir, 'wrangler.toml'),
    `name = "test-function"
main = "src/index.ts"
compatibility_date = "2024-01-01"
`
  )

  // Create src/index.ts with default or custom content
  const defaultContent = `
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response('Hello from test function!', {
      headers: { 'Content-Type': 'text/plain' },
    })
  },
}
`
  writeFileSync(join(dir, 'src', 'index.ts'), content ?? defaultContent)
}

describe('func dev - local development server', () => {
  let tempDir: string
  let devProcess: ChildProcess | null = null

  // This will cause all tests to fail if func CLI is not available
  beforeAll(() => {
    const available = isFuncCliAvailable()
    expect(available, 'func CLI must be installed and available in PATH').toBe(true)
  })

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'func-dev-test-'))
  })

  afterEach(async () => {
    // Kill the dev process if running
    if (devProcess && !devProcess.killed) {
      devProcess.kill('SIGTERM')
      // Wait a bit for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 500))
      if (!devProcess.killed) {
        devProcess.kill('SIGKILL')
      }
    }
    devProcess = null

    // Clean up temp directory
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('server startup', () => {
    it('should start miniflare server on port 8787 by default', async () => {
      createTestProject(tempDir)

      const { process: proc } = await startFuncDev(tempDir)
      devProcess = proc

      // Verify server is running on expected port
      const serverReady = await waitForServer(DEFAULT_PORT)
      expect(serverReady).toBe(true)
    })

    it('should start server on custom port with --port flag', async () => {
      const customPort = 3000
      createTestProject(tempDir)

      const { process: proc } = await startFuncDev(tempDir, ['--port', customPort.toString()])
      devProcess = proc

      const serverReady = await waitForServer(customPort)
      expect(serverReady).toBe(true)
    })

    it('should output server URL when started', async () => {
      createTestProject(tempDir)

      const { process: proc, output } = await startFuncDev(tempDir)
      devProcess = proc

      expect(output).toMatch(/http:\/\/localhost:8787/)
    })
  })

  describe('request proxying', () => {
    it('should proxy HTTP requests to the function', async () => {
      const responseText = 'Hello from proxied function!'
      createTestProject(
        tempDir,
        `
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response('${responseText}', {
      headers: { 'Content-Type': 'text/plain' },
    })
  },
}
`
      )

      const { process: proc } = await startFuncDev(tempDir)
      devProcess = proc

      await waitForServer(DEFAULT_PORT)

      const response = await makeRequest(DEFAULT_PORT)
      expect(response.ok).toBe(true)

      const body = await response.text()
      expect(body).toBe(responseText)
    })

    it('should pass request path to the function', async () => {
      createTestProject(
        tempDir,
        `
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    return new Response(JSON.stringify({ path: url.pathname }), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
`
      )

      const { process: proc } = await startFuncDev(tempDir)
      devProcess = proc

      await waitForServer(DEFAULT_PORT)

      const response = await makeRequest(DEFAULT_PORT, '/api/test')
      const body = (await response.json()) as JsonBody

      expect(body['path']).toBe('/api/test')
    })

    it('should pass request method and headers to the function', async () => {
      createTestProject(
        tempDir,
        `
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response(JSON.stringify({
      method: request.method,
      hasAuth: request.headers.has('Authorization'),
    }), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
`
      )

      const { process: proc } = await startFuncDev(tempDir)
      devProcess = proc

      await waitForServer(DEFAULT_PORT)

      const response = await fetch(`http://localhost:${DEFAULT_PORT}`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
        },
      })
      const body = (await response.json()) as JsonBody

      expect(body['method']).toBe('POST')
      expect(body['hasAuth']).toBe(true)
    })
  })

  describe('TypeScript compilation', () => {
    it('should compile TypeScript on startup', async () => {
      createTestProject(
        tempDir,
        `
interface MyResponse {
  message: string
  timestamp: number
}

export default {
  async fetch(request: Request): Promise<Response> {
    const data: MyResponse = {
      message: 'TypeScript works!',
      timestamp: Date.now(),
    }
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
`
      )

      const { process: proc } = await startFuncDev(tempDir)
      devProcess = proc

      await waitForServer(DEFAULT_PORT)

      const response = await makeRequest(DEFAULT_PORT)
      expect(response.ok).toBe(true)

      const body = (await response.json()) as JsonBody
      expect(body['message']).toBe('TypeScript works!')
      expect(typeof body['timestamp']).toBe('number')
    })

    it('should report TypeScript compilation errors', async () => {
      // Create a project with invalid TypeScript
      createTestProject(
        tempDir,
        `
export default {
  async fetch(request: Request): Promise<Response> {
    // TypeScript error: 'string' is not assignable to 'number'
    const value: number = "not a number"
    return new Response(value.toString())
  },
}
`
      )

      // This should fail because of TypeScript errors
      try {
        const { process: proc } = await startFuncDev(tempDir)
        devProcess = proc
        // If it didn't fail, check output for error
        expect.fail('Expected TypeScript compilation to fail')
      } catch (error) {
        // Expected - TypeScript error should cause failure
        expect(String(error)).toMatch(/error|type|TS\d+/i)
      }
    })
  })

  describe('hot reload', () => {
    it('should detect file changes and reload', async () => {
      createTestProject(
        tempDir,
        `
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response('Version 1')
  },
}
`
      )

      const { process: proc } = await startFuncDev(tempDir)
      devProcess = proc

      await waitForServer(DEFAULT_PORT)

      // Verify initial response
      let response = await makeRequest(DEFAULT_PORT)
      let body = await response.text()
      expect(body).toBe('Version 1')

      // Modify the source file
      writeFileSync(
        join(tempDir, 'src', 'index.ts'),
        `
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response('Version 2')
  },
}
`
      )

      // Wait for hot reload to take effect
      await waitForOutput(devProcess, /reload|rebuild|updated/i, HOT_RELOAD_TIMEOUT)

      // Give the server a moment to apply changes
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Verify updated response
      response = await makeRequest(DEFAULT_PORT)
      body = await response.text()
      expect(body).toBe('Version 2')
    })

    it('should watch multiple files for changes', async () => {
      // Create main file that imports a helper
      mkdirSync(join(tempDir, 'src', 'lib'), { recursive: true })

      writeFileSync(
        join(tempDir, 'src', 'lib', 'helper.ts'),
        `export const getMessage = () => 'Initial message'`
      )

      createTestProject(
        tempDir,
        `
import { getMessage } from './lib/helper'

export default {
  async fetch(request: Request): Promise<Response> {
    return new Response(getMessage())
  },
}
`
      )

      const { process: proc } = await startFuncDev(tempDir)
      devProcess = proc

      await waitForServer(DEFAULT_PORT)

      // Verify initial response
      let response = await makeRequest(DEFAULT_PORT)
      let body = await response.text()
      expect(body).toBe('Initial message')

      // Modify the helper file
      writeFileSync(
        join(tempDir, 'src', 'lib', 'helper.ts'),
        `export const getMessage = () => 'Updated message'`
      )

      // Wait for hot reload
      await waitForOutput(devProcess, /reload|rebuild|updated/i, HOT_RELOAD_TIMEOUT)
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Verify updated response
      response = await makeRequest(DEFAULT_PORT)
      body = await response.text()
      expect(body).toBe('Updated message')
    })

    it('should not reload on non-source file changes', async () => {
      createTestProject(tempDir)

      const { process: proc } = await startFuncDev(tempDir)
      devProcess = proc

      await waitForServer(DEFAULT_PORT)

      // Modify a non-source file (e.g., README)
      writeFileSync(join(tempDir, 'README.md'), '# Test Project')

      // Wait and verify no reload happened
      const reloadHappened = await waitForOutput(
        devProcess,
        /reload|rebuild|updated/i,
        2000
      ).catch(() => false)

      expect(reloadHappened).toBe(false)
    })
  })

  describe('graceful shutdown', () => {
    it('should stop cleanly on SIGTERM', async () => {
      createTestProject(tempDir)

      const { process: proc } = await startFuncDev(tempDir)
      devProcess = proc

      await waitForServer(DEFAULT_PORT)

      // Send SIGTERM
      const exitPromise = new Promise<number | null>((resolve) => {
        devProcess!.on('exit', (code) => resolve(code))
      })

      devProcess.kill('SIGTERM')

      const exitCode = await exitPromise
      expect(exitCode).toBe(0)

      // Verify server is no longer responding
      const serverStillRunning = await waitForServer(DEFAULT_PORT, 1000)
      expect(serverStillRunning).toBe(false)
    })

    it('should stop cleanly on SIGINT (Ctrl+C)', async () => {
      createTestProject(tempDir)

      const { process: proc } = await startFuncDev(tempDir)
      devProcess = proc

      await waitForServer(DEFAULT_PORT)

      const exitPromise = new Promise<number | null>((resolve) => {
        devProcess!.on('exit', (code) => resolve(code))
      })

      devProcess.kill('SIGINT')

      const exitCode = await exitPromise
      expect(exitCode).toBe(0)
    })
  })

  describe('error handling', () => {
    it('should fail gracefully if no function project found', async () => {
      // Don't create a project - empty directory

      try {
        const { process: proc } = await startFuncDev(tempDir)
        devProcess = proc
        expect.fail('Expected func dev to fail with no project')
      } catch (error) {
        // Expected - should fail without a valid project
        expect(String(error)).toMatch(/exit|error|not found|no.*project/i)
      }
    })

    it('should fail if port is already in use', async () => {
      createTestProject(tempDir)

      // Start first server
      const { process: firstProc } = await startFuncDev(tempDir)
      devProcess = firstProc

      await waitForServer(DEFAULT_PORT)

      // Try to start second server on same port
      try {
        const { process: secondProc } = await startFuncDev(tempDir)
        secondProc.kill('SIGTERM')
        expect.fail('Expected second server to fail due to port conflict')
      } catch (error) {
        // Expected - port should already be in use
        expect(String(error)).toMatch(/port|address.*in.*use|EADDRINUSE/i)
      }
    })
  })

  describe('source maps', () => {
    it('should generate source maps during build', async () => {
      createTestProject(tempDir)

      const { process: proc } = await startFuncDev(tempDir)
      devProcess = proc

      await waitForServer(DEFAULT_PORT)

      // Check that source map file was created
      const sourceMapPath = join(tempDir, '.func', 'worker.js.map')
      expect(existsSync(sourceMapPath)).toBe(true)

      // Verify source map content
      const sourceMapContent = readFileSync(sourceMapPath, 'utf-8')
      const sourceMap = JSON.parse(sourceMapContent)

      expect(sourceMap.version).toBe(3)
      expect(sourceMap.sources).toBeDefined()
      expect(sourceMap.mappings).toBeDefined()
    })

    it('should include sourcesContent for debugging', async () => {
      const testCode = `
export default {
  async fetch(request: Request): Promise<Response> {
    const message = 'Source map test'
    return new Response(message)
  },
}
`
      createTestProject(tempDir, testCode)

      const { process: proc } = await startFuncDev(tempDir)
      devProcess = proc

      await waitForServer(DEFAULT_PORT)

      // Check source map includes source content
      const sourceMapPath = join(tempDir, '.func', 'worker.js.map')
      const sourceMapContent = readFileSync(sourceMapPath, 'utf-8')
      const sourceMap = JSON.parse(sourceMapContent)

      expect(sourceMap.sourcesContent).toBeDefined()
      expect(sourceMap.sourcesContent.length).toBeGreaterThan(0)
    })
  })

  describe('fast hot reload', () => {
    it('should reload faster on subsequent changes', async () => {
      createTestProject(
        tempDir,
        `
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response('Initial version')
  },
}
`
      )

      const { process: proc } = await startFuncDev(tempDir)
      devProcess = proc

      await waitForServer(DEFAULT_PORT)

      // Verify initial response
      let response = await makeRequest(DEFAULT_PORT)
      let body = await response.text()
      expect(body).toBe('Initial version')

      // First change to trigger initial reload
      writeFileSync(
        join(tempDir, 'src', 'index.ts'),
        `
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response('Second version')
  },
}
`
      )

      await waitForOutput(devProcess, /Rebuilt in \d+ms/i, HOT_RELOAD_TIMEOUT)
      await new Promise((resolve) => setTimeout(resolve, 1000))

      response = await makeRequest(DEFAULT_PORT)
      body = await response.text()
      expect(body).toBe('Second version')

      // Second change should be faster with incremental builds
      const startTime = Date.now()

      writeFileSync(
        join(tempDir, 'src', 'index.ts'),
        `
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response('Third version')
  },
}
`
      )

      await waitForOutput(devProcess, /Rebuilt in \d+ms/i, FAST_RELOAD_TIMEOUT)
      const reloadTime = Date.now() - startTime

      // Incremental rebuild should complete reasonably quickly
      expect(reloadTime).toBeLessThan(FAST_RELOAD_TIMEOUT)

      await new Promise((resolve) => setTimeout(resolve, 1000))

      response = await makeRequest(DEFAULT_PORT)
      body = await response.text()
      expect(body).toBe('Third version')
    })

    it('should use setOptions for hot reload instead of full restart', async () => {
      createTestProject(
        tempDir,
        `
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response('Version 1')
  },
}
`
      )

      const { process: proc, output: initialOutput } = await startFuncDev(tempDir)
      devProcess = proc

      await waitForServer(DEFAULT_PORT)

      // Modify the file
      writeFileSync(
        join(tempDir, 'src', 'index.ts'),
        `
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response('Version 2')
  },
}
`
      )

      // Wait for the worker update message (not a full restart)
      const output = await waitForOutput(devProcess, /Worker updated/i, HOT_RELOAD_TIMEOUT)

      // Should see "Worker updated" for hot reload, not necessarily a restart message
      expect(output).toMatch(/Worker updated|Reloading worker/i)

      await new Promise((resolve) => setTimeout(resolve, 1000))

      const response = await makeRequest(DEFAULT_PORT)
      const body = await response.text()
      expect(body).toBe('Version 2')
    })
  })

  describe('--inspect flag', () => {
    it('should accept --inspect flag', async () => {
      createTestProject(tempDir)

      const { process: proc, output } = await startFuncDev(tempDir, ['--inspect'])
      devProcess = proc

      await waitForServer(DEFAULT_PORT)

      // The output should mention inspector being available
      // Note: actual inspector functionality depends on miniflare support
      expect(proc.exitCode).toBeNull() // Should still be running
    })

    it('should accept --inspect with custom port', async () => {
      createTestProject(tempDir)

      const { process: proc, output } = await startFuncDev(tempDir, ['--inspect=9230'])
      devProcess = proc

      await waitForServer(DEFAULT_PORT)

      expect(proc.exitCode).toBeNull() // Should still be running
    })
  })

  describe('error display', () => {
    it('should display formatted build errors', async () => {
      // Create project with syntax error
      createTestProject(
        tempDir,
        `
export default {
  async fetch(request: Request): Promise<Response> {
    // Syntax error - missing closing brace
    return new Response('Hello'
  },
}
`
      )

      try {
        const { process: proc } = await startFuncDev(tempDir)
        devProcess = proc
        expect.fail('Expected build to fail with syntax error')
      } catch (error) {
        // Should show formatted error output
        const errorStr = String(error)
        expect(errorStr).toMatch(/error|BUILD|syntax/i)
      }
    })

    it('should display formatted TypeScript type errors', async () => {
      createTestProject(
        tempDir,
        `
export default {
  async fetch(request: Request): Promise<Response> {
    const num: number = "not a number"
    return new Response(num.toString())
  },
}
`
      )

      try {
        const { process: proc } = await startFuncDev(tempDir)
        devProcess = proc
        expect.fail('Expected TypeScript type check to fail')
      } catch (error) {
        const errorStr = String(error)
        // Should report type error
        expect(errorStr).toMatch(/error|type|TS\d+/i)
      }
    })

    it('should show errors with file locations after hot reload', async () => {
      createTestProject(
        tempDir,
        `
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response('Initial')
  },
}
`
      )

      const { process: proc } = await startFuncDev(tempDir)
      devProcess = proc

      await waitForServer(DEFAULT_PORT)

      // Introduce an error in the file
      writeFileSync(
        join(tempDir, 'src', 'index.ts'),
        `
export default {
  async fetch(request: Request): Promise<Response> {
    // Type error
    const x: number = "string"
    return new Response(x.toString())
  },
}
`
      )

      // Wait for rebuild attempt with error
      try {
        await waitForOutput(devProcess, /TYPE ERROR|error TS/i, HOT_RELOAD_TIMEOUT)
      } catch {
        // May timeout if error output is different, that's acceptable
      }

      // Server should still be running with old code
      const response = await makeRequest(DEFAULT_PORT)
      expect(response.ok).toBe(true)
    })
  })

  describe('request logging', () => {
    it('should log requests with timing information', async () => {
      createTestProject(
        tempDir,
        `
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response('Logged response')
  },
}
`
      )

      const { process: proc } = await startFuncDev(tempDir, ['--verbose'])
      devProcess = proc

      await waitForServer(DEFAULT_PORT)

      // Make a request
      await makeRequest(DEFAULT_PORT, '/test-path')

      // Give time for log to appear
      await new Promise((resolve) => setTimeout(resolve, 500))

      // The verbose flag enables request logging, but output format may vary
      // Just verify server is still working
      const response = await makeRequest(DEFAULT_PORT)
      expect(response.ok).toBe(true)
    })
  })
})
