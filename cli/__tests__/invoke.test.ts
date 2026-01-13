/**
 * Tests for dotdo invoke command
 *
 * TDD RED phase - these tests define the expected behavior
 * of the `dotdo invoke` command for invoking deployed functions.
 *
 * The invoke command should:
 * - Invoke a function by name
 * - Support passing JSON data via --data flag
 * - Support reading data from file via --file flag
 * - Support reading data from stdin
 * - Return response body
 * - Show timing info with --timing flag
 * - Show headers with --headers flag
 * - Support --version for specific version
 * - Handle errors gracefully
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { MockFS, CLIContext, CommandResult } from '../types'

/**
 * Mock API client interface for dependency injection
 * Allows testing without making actual HTTP requests
 */
interface MockAPIClient {
  invoke: (
    functionName: string,
    options: InvokeAPIOptions
  ) => Promise<InvokeAPIResponse>
}

/**
 * Options passed to the API client for invoking a function
 */
interface InvokeAPIOptions {
  data?: unknown
  version?: string
  method?: string
  headers?: Record<string, string>
}

/**
 * Response from the API client after invoking a function
 */
interface InvokeAPIResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: unknown
  timing: {
    total: number
    dns?: number
    connect?: number
    ttfb?: number
  }
}

/**
 * Extended CLI context with API client for invoke command
 */
interface InvokeCLIContext extends CLIContext {
  api: MockAPIClient
  stdin?: string
}

/**
 * Invoke command options
 */
interface InvokeOptions {
  data?: string
  file?: string
  version?: string
  timing?: boolean
  headers?: boolean
  method?: string
  header?: string[]
}

/**
 * Run the invoke command with given arguments and context
 * This is the function under test - to be implemented
 */
declare function runInvoke(
  name: string,
  options: InvokeOptions,
  context: InvokeCLIContext
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
    async readFileBytes(path: string): Promise<Uint8Array> {
      const content = files.get(path)
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`)
      }
      return new TextEncoder().encode(content)
    },
    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
      if (content instanceof Uint8Array) {
        files.set(path, new TextDecoder().decode(content))
      } else {
        files.set(path, content)
      }
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
        return {
          size: content.length,
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
 * Create a mock API client for testing
 */
function createMockAPIClient(): MockAPIClient & {
  calls: Array<{ functionName: string; options: InvokeAPIOptions }>
  mockResponse: InvokeAPIResponse
  mockError: Error | null
} {
  const calls: Array<{ functionName: string; options: InvokeAPIOptions }> = []
  let mockResponse: InvokeAPIResponse = {
    status: 200,
    statusText: 'OK',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'test-request-id',
    },
    body: { message: 'Hello, World!' },
    timing: {
      total: 150,
      dns: 10,
      connect: 20,
      ttfb: 100,
    },
  }
  let mockError: Error | null = null

  return {
    calls,
    get mockResponse() {
      return mockResponse
    },
    set mockResponse(response: InvokeAPIResponse) {
      mockResponse = response
    },
    get mockError() {
      return mockError
    },
    set mockError(error: Error | null) {
      mockError = error
    },
    async invoke(
      functionName: string,
      options: InvokeAPIOptions
    ): Promise<InvokeAPIResponse> {
      calls.push({ functionName, options })
      if (mockError) {
        throw mockError
      }
      return mockResponse
    },
  }
}

/**
 * Create a CLI context for testing invoke command
 */
function createTestContext(cwd = '/test'): InvokeCLIContext & {
  stdoutOutput: string[]
  stderrOutput: string[]
  exitCode: number | null
  fs: ReturnType<typeof createMockFS>
  api: ReturnType<typeof createMockAPIClient>
} {
  const stdoutOutput: string[] = []
  const stderrOutput: string[] = []
  let exitCode: number | null = null

  const fs = createMockFS()
  const api = createMockAPIClient()

  return {
    fs,
    api,
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

describe('dotdo invoke', () => {
  let context: ReturnType<typeof createTestContext>

  beforeEach(() => {
    context = createTestContext('/projects/my-function')
  })

  describe('dotdo invoke <name>', () => {
    it('should invoke function by name', async () => {
      const result = await runInvoke('my-function', {}, context)

      expect(result.exitCode).toBe(0)
      expect(context.api.calls).toHaveLength(1)
      expect(context.api.calls[0].functionName).toBe('my-function')
    })

    it('should fail if no function name is provided', async () => {
      const result = await runInvoke('', {}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/function name.*required/i)
    })

    it('should return response body in output', async () => {
      context.api.mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: { result: 'success', data: [1, 2, 3] },
        timing: { total: 100 },
      }

      const result = await runInvoke('my-function', {}, context)

      expect(result.exitCode).toBe(0)
      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('success')
      expect(output).toContain('[1,2,3]')
    })

    it('should pretty-print JSON response body', async () => {
      context.api.mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: { key: 'value' },
        timing: { total: 100 },
      }

      await runInvoke('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      // Should be formatted with indentation
      expect(output).toMatch(/{\s*"key":\s*"value"\s*}/s)
    })

    it('should handle string response body', async () => {
      context.api.mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
        body: 'Hello, World!',
        timing: { total: 100 },
      }

      await runInvoke('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('Hello, World!')
    })
  })

  describe('dotdo invoke <name> --data', () => {
    it('should pass JSON data to function', async () => {
      const result = await runInvoke(
        'my-function',
        { data: '{"name": "test", "count": 42}' },
        context
      )

      expect(result.exitCode).toBe(0)
      expect(context.api.calls[0].options.data).toEqual({
        name: 'test',
        count: 42,
      })
    })

    it('should fail with invalid JSON data', async () => {
      const result = await runInvoke(
        'my-function',
        { data: '{invalid json}' },
        context
      )

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/invalid.*json/i)
    })

    it('should support array data', async () => {
      const result = await runInvoke(
        'my-function',
        { data: '[1, 2, 3]' },
        context
      )

      expect(result.exitCode).toBe(0)
      expect(context.api.calls[0].options.data).toEqual([1, 2, 3])
    })

    it('should support primitive values', async () => {
      const result = await runInvoke(
        'my-function',
        { data: '"hello"' },
        context
      )

      expect(result.exitCode).toBe(0)
      expect(context.api.calls[0].options.data).toBe('hello')
    })

    it('should support null value', async () => {
      const result = await runInvoke('my-function', { data: 'null' }, context)

      expect(result.exitCode).toBe(0)
      expect(context.api.calls[0].options.data).toBeNull()
    })

    it('should support empty object', async () => {
      const result = await runInvoke('my-function', { data: '{}' }, context)

      expect(result.exitCode).toBe(0)
      expect(context.api.calls[0].options.data).toEqual({})
    })
  })

  describe('dotdo invoke <name> --file', () => {
    it('should read JSON data from file', async () => {
      context.fs.files.set(
        '/projects/my-function/data.json',
        '{"input": "from-file"}'
      )

      const result = await runInvoke(
        'my-function',
        { file: 'data.json' },
        context
      )

      expect(result.exitCode).toBe(0)
      expect(context.api.calls[0].options.data).toEqual({ input: 'from-file' })
    })

    it('should support absolute file path', async () => {
      context.fs.files.set('/tmp/request.json', '{"key": "absolute"}')

      const result = await runInvoke(
        'my-function',
        { file: '/tmp/request.json' },
        context
      )

      expect(result.exitCode).toBe(0)
      expect(context.api.calls[0].options.data).toEqual({ key: 'absolute' })
    })

    it('should fail if file does not exist', async () => {
      const result = await runInvoke(
        'my-function',
        { file: 'nonexistent.json' },
        context
      )

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/file.*not found|no such file/i)
    })

    it('should fail if file contains invalid JSON', async () => {
      context.fs.files.set('/projects/my-function/bad.json', 'not valid json')

      const result = await runInvoke('my-function', { file: 'bad.json' }, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/invalid.*json/i)
    })

    it('should error if both --data and --file are provided', async () => {
      context.fs.files.set('/projects/my-function/data.json', '{}')

      const result = await runInvoke(
        'my-function',
        { data: '{}', file: 'data.json' },
        context
      )

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/cannot.*both|mutually exclusive/i)
    })
  })

  describe('stdin support', () => {
    it('should read data from stdin when available', async () => {
      const stdinContext = createTestContext()
      stdinContext.stdin = '{"from": "stdin"}'

      const result = await runInvoke('my-function', {}, stdinContext)

      expect(result.exitCode).toBe(0)
      expect(stdinContext.api.calls[0].options.data).toEqual({ from: 'stdin' })
    })

    it('should fail if stdin contains invalid JSON', async () => {
      const stdinContext = createTestContext()
      stdinContext.stdin = 'invalid stdin json'

      const result = await runInvoke('my-function', {}, stdinContext)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/invalid.*json/i)
    })

    it('should prioritize --data over stdin', async () => {
      const stdinContext = createTestContext()
      stdinContext.stdin = '{"from": "stdin"}'

      const result = await runInvoke(
        'my-function',
        { data: '{"from": "data-flag"}' },
        stdinContext
      )

      expect(result.exitCode).toBe(0)
      expect(stdinContext.api.calls[0].options.data).toEqual({
        from: 'data-flag',
      })
    })

    it('should prioritize --file over stdin', async () => {
      const stdinContext = createTestContext()
      stdinContext.stdin = '{"from": "stdin"}'
      stdinContext.fs.files.set(
        '/test/data.json',
        '{"from": "file"}'
      )

      const result = await runInvoke(
        'my-function',
        { file: 'data.json' },
        stdinContext
      )

      expect(result.exitCode).toBe(0)
      expect(stdinContext.api.calls[0].options.data).toEqual({ from: 'file' })
    })
  })

  describe('--timing flag', () => {
    it('should show timing info when --timing flag is set', async () => {
      context.api.mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {},
        body: {},
        timing: {
          total: 150,
          dns: 10,
          connect: 20,
          ttfb: 100,
        },
      }

      await runInvoke('my-function', { timing: true }, context)

      const output = context.stdoutOutput.join('\n') + context.stderrOutput.join('\n')
      expect(output).toMatch(/total.*150\s*ms/i)
    })

    it('should show detailed timing breakdown', async () => {
      context.api.mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {},
        body: {},
        timing: {
          total: 150,
          dns: 10,
          connect: 20,
          ttfb: 100,
        },
      }

      await runInvoke('my-function', { timing: true }, context)

      const output = context.stdoutOutput.join('\n') + context.stderrOutput.join('\n')
      expect(output).toMatch(/dns.*10\s*ms/i)
      expect(output).toMatch(/connect.*20\s*ms/i)
      expect(output).toMatch(/ttfb.*100\s*ms/i)
    })

    it('should not show timing info by default', async () => {
      await runInvoke('my-function', {}, context)

      const output = context.stdoutOutput.join('\n') + context.stderrOutput.join('\n')
      expect(output).not.toMatch(/dns/i)
      expect(output).not.toMatch(/ttfb/i)
    })
  })

  describe('--headers flag', () => {
    it('should show response headers when --headers flag is set', async () => {
      context.api.mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'application/json',
          'x-custom-header': 'custom-value',
          'x-request-id': 'abc123',
        },
        body: {},
        timing: { total: 100 },
      }

      await runInvoke('my-function', { headers: true }, context)

      const output = context.stdoutOutput.join('\n') + context.stderrOutput.join('\n')
      expect(output).toMatch(/content-type.*application\/json/i)
      expect(output).toMatch(/x-custom-header.*custom-value/i)
      expect(output).toMatch(/x-request-id.*abc123/i)
    })

    it('should show status code with headers', async () => {
      context.api.mockResponse = {
        status: 201,
        statusText: 'Created',
        headers: {},
        body: {},
        timing: { total: 100 },
      }

      await runInvoke('my-function', { headers: true }, context)

      const output = context.stdoutOutput.join('\n') + context.stderrOutput.join('\n')
      expect(output).toMatch(/201.*created/i)
    })

    it('should not show headers by default', async () => {
      context.api.mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {
          'x-custom-header': 'should-not-appear',
        },
        body: { result: 'success' },
        timing: { total: 100 },
      }

      await runInvoke('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).not.toContain('x-custom-header')
      expect(output).not.toContain('should-not-appear')
    })

    it('should support both --headers and --timing together', async () => {
      context.api.mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: { 'x-test': 'value' },
        body: {},
        timing: { total: 100, dns: 5 },
      }

      await runInvoke('my-function', { headers: true, timing: true }, context)

      const output = context.stdoutOutput.join('\n') + context.stderrOutput.join('\n')
      expect(output).toMatch(/x-test.*value/i)
      expect(output).toMatch(/total.*100\s*ms/i)
    })
  })

  describe('--version flag', () => {
    it('should invoke specific version when --version is set', async () => {
      const result = await runInvoke(
        'my-function',
        { version: 'v2.0.0' },
        context
      )

      expect(result.exitCode).toBe(0)
      expect(context.api.calls[0].options.version).toBe('v2.0.0')
    })

    it('should support semantic version format', async () => {
      await runInvoke('my-function', { version: '1.2.3' }, context)

      expect(context.api.calls[0].options.version).toBe('1.2.3')
    })

    it('should support commit hash as version', async () => {
      await runInvoke('my-function', { version: 'abc123def' }, context)

      expect(context.api.calls[0].options.version).toBe('abc123def')
    })

    it('should support "latest" as version', async () => {
      await runInvoke('my-function', { version: 'latest' }, context)

      expect(context.api.calls[0].options.version).toBe('latest')
    })

    it('should not pass version if not specified', async () => {
      await runInvoke('my-function', {}, context)

      expect(context.api.calls[0].options.version).toBeUndefined()
    })
  })

  describe('HTTP method support', () => {
    it('should default to POST method', async () => {
      await runInvoke('my-function', { data: '{}' }, context)

      expect(context.api.calls[0].options.method).toBe('POST')
    })

    it('should support custom HTTP method', async () => {
      await runInvoke('my-function', { method: 'GET' }, context)

      expect(context.api.calls[0].options.method).toBe('GET')
    })

    it('should normalize method to uppercase', async () => {
      await runInvoke('my-function', { method: 'put' }, context)

      expect(context.api.calls[0].options.method).toBe('PUT')
    })

    it('should default to GET when no data is provided', async () => {
      await runInvoke('my-function', {}, context)

      expect(context.api.calls[0].options.method).toBe('GET')
    })
  })

  describe('custom headers', () => {
    it('should support custom request headers via --header', async () => {
      await runInvoke(
        'my-function',
        { header: ['Authorization: Bearer token123'] },
        context
      )

      expect(context.api.calls[0].options.headers).toEqual({
        Authorization: 'Bearer token123',
      })
    })

    it('should support multiple custom headers', async () => {
      await runInvoke(
        'my-function',
        { header: ['X-Custom: value1', 'X-Another: value2'] },
        context
      )

      expect(context.api.calls[0].options.headers).toEqual({
        'X-Custom': 'value1',
        'X-Another': 'value2',
      })
    })

    it('should fail with malformed header', async () => {
      const result = await runInvoke(
        'my-function',
        { header: ['InvalidHeaderNoColon'] },
        context
      )

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/invalid.*header/i)
    })
  })

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      context.api.mockError = new Error('Network error: connection refused')

      const result = await runInvoke('my-function', {}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/network.*error|connection/i)
    })

    it('should handle timeout errors', async () => {
      context.api.mockError = new Error('Request timeout')

      const result = await runInvoke('my-function', {}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/timeout/i)
    })

    it('should handle 404 function not found', async () => {
      context.api.mockResponse = {
        status: 404,
        statusText: 'Not Found',
        headers: {},
        body: { error: 'Function not found' },
        timing: { total: 50 },
      }

      const result = await runInvoke('nonexistent-function', {}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/not found|404/i)
    })

    it('should handle 500 server errors', async () => {
      context.api.mockResponse = {
        status: 500,
        statusText: 'Internal Server Error',
        headers: {},
        body: { error: 'Internal error occurred' },
        timing: { total: 100 },
      }

      const result = await runInvoke('my-function', {}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/server error|500|internal/i)
    })

    it('should handle 401 unauthorized', async () => {
      context.api.mockResponse = {
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        body: { error: 'Authentication required' },
        timing: { total: 50 },
      }

      const result = await runInvoke('my-function', {}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/unauthorized|authentication/i)
    })

    it('should handle 403 forbidden', async () => {
      context.api.mockResponse = {
        status: 403,
        statusText: 'Forbidden',
        headers: {},
        body: { error: 'Access denied' },
        timing: { total: 50 },
      }

      const result = await runInvoke('my-function', {}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/forbidden|access denied|403/i)
    })

    it('should handle rate limiting (429)', async () => {
      context.api.mockResponse = {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'retry-after': '60' },
        body: { error: 'Rate limit exceeded' },
        timing: { total: 10 },
      }

      const result = await runInvoke('my-function', {}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/rate limit|too many requests|429/i)
    })

    it('should display error response body when available', async () => {
      context.api.mockResponse = {
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        body: { error: 'Invalid input format', details: 'Expected JSON object' },
        timing: { total: 50 },
      }

      const result = await runInvoke('my-function', { data: '{}' }, context)

      expect(result.exitCode).toBe(1)
      const output = context.stderrOutput.join('\n')
      expect(output).toMatch(/invalid input|expected json/i)
    })

    it('should handle malformed response gracefully', async () => {
      context.api.mockError = new Error('Invalid JSON response')

      const result = await runInvoke('my-function', {}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toBeDefined()
    })
  })

  describe('output formatting', () => {
    it('should output only response body by default', async () => {
      context.api.mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: { result: 'clean output' },
        timing: { total: 100 },
      }

      await runInvoke('my-function', {}, context)

      // Should only contain the body, no extra decoration
      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('clean output')
      expect(output).not.toMatch(/status|timing|header/i)
    })

    it('should write errors to stderr', async () => {
      context.api.mockError = new Error('Test error')

      await runInvoke('my-function', {}, context)

      expect(context.stderrOutput.length).toBeGreaterThan(0)
      expect(context.stderrOutput.join('\n')).toMatch(/error/i)
    })

    it('should format binary response appropriately', async () => {
      context.api.mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/octet-stream' },
        body: '<binary data>',
        timing: { total: 100 },
      }

      await runInvoke('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      // Should indicate binary data somehow, not raw dump
      expect(output).toBeDefined()
    })
  })

  describe('function name validation', () => {
    it('should accept valid function names', async () => {
      const validNames = [
        'my-function',
        'my_function',
        'myFunction',
        'function123',
        'a',
        'a-b-c',
      ]

      for (const name of validNames) {
        const testContext = createTestContext()
        const result = await runInvoke(name, {}, testContext)
        expect(result.exitCode).toBe(0)
      }
    })

    it('should accept function names with namespace', async () => {
      const result = await runInvoke('my-namespace/my-function', {}, context)

      expect(result.exitCode).toBe(0)
      expect(context.api.calls[0].functionName).toBe('my-namespace/my-function')
    })

    it('should reject invalid function names', async () => {
      const invalidNames = [
        '',
        ' ',
        '../escape',
        'func name',
        'func\nname',
      ]

      for (const name of invalidNames) {
        const testContext = createTestContext()
        const result = await runInvoke(name, {}, testContext)
        expect(result.exitCode).toBe(1)
      }
    })
  })
})
