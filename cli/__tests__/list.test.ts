/**
 * Tests for dotdo list command
 *
 * TDD RED phase - these tests define the expected behavior
 * of the `dotdo list` command for listing deployed functions.
 *
 * The list command should:
 * - Show all deployed functions
 * - Display function name, version, language, status
 * - Support --json for JSON output
 * - Support --limit for pagination
 * - Handle empty list gracefully
 * - Require authentication
 * - Format output in a table by default
 */

import { describe, it, expect, beforeEach } from 'vitest'

/**
 * Function status values
 */
type FunctionStatus = 'active' | 'deploying' | 'failed' | 'inactive'

/**
 * Function language/runtime
 */
type FunctionLanguage = 'typescript' | 'rust' | 'go' | 'python'

/**
 * Function summary information returned from list API
 */
interface FunctionSummary {
  name: string
  version: string
  language: FunctionLanguage
  status: FunctionStatus
  lastDeployment: string
  url?: string
}

/**
 * Response from the list functions API
 */
interface ListFunctionsResponse {
  functions: FunctionSummary[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

/**
 * API Client interface for list operations
 * Used for dependency injection to enable testing
 */
interface ListAPIClient {
  /**
   * List deployed functions
   * @param options - Pagination and filter options
   */
  listFunctions(options?: ListOptions): Promise<ListFunctionsResponse>

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): Promise<boolean>
}

/**
 * Options for the list command
 */
interface ListOptions {
  limit?: number
  offset?: number
  json?: boolean
}

/**
 * CLI context for dependency injection
 */
interface CLIContext {
  stdout: (text: string) => void
  stderr: (text: string) => void
  exit: (code: number) => void
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
 * Run the list command with given options and context
 * This is the function under test - to be implemented
 */
declare function runList(
  options: ListOptions,
  context: CLIContext,
  apiClient: ListAPIClient
): Promise<CommandResult>

/**
 * Create a mock API client for testing
 */
function createMockAPIClient(): ListAPIClient & {
  functions: FunctionSummary[]
  authenticated: boolean
  setFunctions: (functions: FunctionSummary[]) => void
} {
  let functions: FunctionSummary[] = []
  let authenticated = true

  return {
    get functions() {
      return functions
    },
    set functions(value: FunctionSummary[]) {
      functions = value
    },
    authenticated,
    setFunctions(funcs: FunctionSummary[]) {
      functions = funcs
    },
    async listFunctions(options?: ListOptions): Promise<ListFunctionsResponse> {
      if (!authenticated) {
        throw new Error('Unauthorized: Please log in first')
      }
      const limit = options?.limit ?? 20
      const offset = options?.offset ?? 0
      const sliced = functions.slice(offset, offset + limit)
      return {
        functions: sliced,
        total: functions.length,
        limit,
        offset,
        hasMore: offset + limit < functions.length,
      }
    },
    async isAuthenticated(): Promise<boolean> {
      return authenticated
    },
  }
}

/**
 * Create a CLI context for testing
 */
function createTestContext(): CLIContext & {
  stdoutOutput: string[]
  stderrOutput: string[]
  exitCode: number | null
} {
  const stdoutOutput: string[] = []
  const stderrOutput: string[] = []
  let exitCode: number | null = null

  return {
    stdout: (text: string) => stdoutOutput.push(text),
    stderr: (text: string) => stderrOutput.push(text),
    exit: (code: number) => {
      exitCode = code
    },
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
 * Create sample function summaries for testing
 */
function createSampleFunction(overrides: Partial<FunctionSummary> = {}): FunctionSummary {
  return {
    name: 'my-function',
    version: '1.0.0',
    language: 'typescript',
    status: 'active',
    lastDeployment: '2024-01-15T10:30:00Z',
    url: 'https://my-function.workers.dev',
    ...overrides,
  }
}

describe('dotdo list', () => {
  let context: ReturnType<typeof createTestContext>
  let apiClient: ReturnType<typeof createMockAPIClient>

  beforeEach(() => {
    context = createTestContext()
    apiClient = createMockAPIClient()
  })

  describe('dotdo list shows all deployed functions', () => {
    it('should list all deployed functions', async () => {
      apiClient.setFunctions([
        createSampleFunction({ name: 'api-gateway', version: '2.1.0' }),
        createSampleFunction({ name: 'auth-service', version: '1.0.0' }),
        createSampleFunction({ name: 'data-processor', version: '3.0.5' }),
      ])

      const result = await runList({}, context, apiClient)

      expect(result.exitCode).toBe(0)
      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('api-gateway')
      expect(output).toContain('auth-service')
      expect(output).toContain('data-processor')
    })

    it('should return exit code 0 on success', async () => {
      apiClient.setFunctions([createSampleFunction({ name: 'my-function' })])

      const result = await runList({}, context, apiClient)

      expect(result.exitCode).toBe(0)
    })
  })

  describe('shows function name, version, language, status', () => {
    it('should display function name', async () => {
      apiClient.setFunctions([createSampleFunction({ name: 'hello-world' })])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('hello-world')
    })

    it('should display function version', async () => {
      apiClient.setFunctions([createSampleFunction({ name: 'my-function', version: '2.3.1' })])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('2.3.1')
    })

    it('should display function language for TypeScript', async () => {
      apiClient.setFunctions([createSampleFunction({ name: 'ts-function', language: 'typescript' })])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/typescript/i)
    })

    it('should display function language for Rust', async () => {
      apiClient.setFunctions([createSampleFunction({ name: 'rust-function', language: 'rust' })])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/rust/i)
    })

    it('should display function language for Go', async () => {
      apiClient.setFunctions([createSampleFunction({ name: 'go-function', language: 'go' })])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/go/i)
    })

    it('should display function language for Python', async () => {
      apiClient.setFunctions([createSampleFunction({ name: 'python-function', language: 'python' })])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/python/i)
    })

    it('should display function status as active', async () => {
      apiClient.setFunctions([createSampleFunction({ name: 'my-function', status: 'active' })])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/active/i)
    })

    it('should display function status as deploying', async () => {
      apiClient.setFunctions([createSampleFunction({ name: 'my-function', status: 'deploying' })])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/deploying/i)
    })

    it('should display function status as failed', async () => {
      apiClient.setFunctions([createSampleFunction({ name: 'my-function', status: 'failed' })])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/failed/i)
    })

    it('should display function status as inactive', async () => {
      apiClient.setFunctions([createSampleFunction({ name: 'my-function', status: 'inactive' })])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/inactive/i)
    })

    it('should display all fields for each function', async () => {
      apiClient.setFunctions([
        createSampleFunction({
          name: 'complete-function',
          version: '1.2.3',
          language: 'typescript',
          status: 'active',
        }),
      ])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('complete-function')
      expect(output).toContain('1.2.3')
      expect(output).toMatch(/typescript/i)
      expect(output).toMatch(/active/i)
    })
  })

  describe('--json flag for JSON output', () => {
    it('should output valid JSON when --json flag is provided', async () => {
      apiClient.setFunctions([createSampleFunction({ name: 'json-function' })])

      await runList({ json: true }, context, apiClient)

      const output = context.stdoutOutput.join('')
      expect(() => JSON.parse(output)).not.toThrow()
    })

    it('should include all function data in JSON output', async () => {
      apiClient.setFunctions([
        createSampleFunction({
          name: 'my-api',
          version: '2.0.0',
          language: 'rust',
          status: 'active',
          lastDeployment: '2024-02-20T15:00:00Z',
          url: 'https://my-api.workers.dev',
        }),
      ])

      await runList({ json: true }, context, apiClient)

      const output = context.stdoutOutput.join('')
      const json = JSON.parse(output)

      expect(json.functions).toBeInstanceOf(Array)
      expect(json.functions[0].name).toBe('my-api')
      expect(json.functions[0].version).toBe('2.0.0')
      expect(json.functions[0].language).toBe('rust')
      expect(json.functions[0].status).toBe('active')
      expect(json.functions[0].lastDeployment).toBe('2024-02-20T15:00:00Z')
      expect(json.functions[0].url).toBe('https://my-api.workers.dev')
    })

    it('should include total count in JSON output', async () => {
      apiClient.setFunctions([
        createSampleFunction({ name: 'func-1' }),
        createSampleFunction({ name: 'func-2' }),
        createSampleFunction({ name: 'func-3' }),
      ])

      await runList({ json: true }, context, apiClient)

      const output = context.stdoutOutput.join('')
      const json = JSON.parse(output)

      expect(json.total).toBe(3)
    })

    it('should include pagination info in JSON output', async () => {
      apiClient.setFunctions([
        createSampleFunction({ name: 'func-1' }),
        createSampleFunction({ name: 'func-2' }),
      ])

      await runList({ json: true, limit: 10, offset: 0 }, context, apiClient)

      const output = context.stdoutOutput.join('')
      const json = JSON.parse(output)

      expect(json.limit).toBeDefined()
      expect(json.offset).toBeDefined()
      expect(json.hasMore).toBeDefined()
    })

    it('should not include table formatting in JSON output', async () => {
      apiClient.setFunctions([createSampleFunction({ name: 'my-function' })])

      await runList({ json: true }, context, apiClient)

      const output = context.stdoutOutput.join('')

      // JSON output should not contain table borders or decorations
      expect(output).not.toMatch(/[─│┌┐└┘├┤┬┴┼]/)
      expect(output).not.toMatch(/\+[-+]+\+/)
      expect(output).not.toMatch(/\|[-|]+\|/)
    })

    it('should output empty functions array in JSON when no functions exist', async () => {
      apiClient.setFunctions([])

      await runList({ json: true }, context, apiClient)

      const output = context.stdoutOutput.join('')
      const json = JSON.parse(output)

      expect(json.functions).toEqual([])
      expect(json.total).toBe(0)
    })
  })

  describe('--limit flag for pagination', () => {
    beforeEach(() => {
      // Create 25 functions for pagination tests
      const functions: FunctionSummary[] = []
      for (let i = 1; i <= 25; i++) {
        functions.push(createSampleFunction({ name: `function-${i.toString().padStart(2, '0')}` }))
      }
      apiClient.setFunctions(functions)
    })

    it('should limit results when --limit is specified', async () => {
      await runList({ limit: 5 }, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      // Should contain first 5 functions
      expect(output).toContain('function-01')
      expect(output).toContain('function-05')
      // Should not contain function beyond limit
      expect(output).not.toContain('function-06')
    })

    it('should use default limit of 20 when not specified', async () => {
      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      // Should contain first 20 functions
      expect(output).toContain('function-01')
      expect(output).toContain('function-20')
      // Should not contain functions beyond default limit
      expect(output).not.toContain('function-21')
    })

    it('should indicate more results are available when hasMore is true', async () => {
      await runList({ limit: 10 }, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      // Should indicate there are more results
      expect(output).toMatch(/more|showing.*of.*25|page|next/i)
    })

    it('should not indicate more results when all functions are shown', async () => {
      apiClient.setFunctions([
        createSampleFunction({ name: 'only-function' }),
      ])

      await runList({ limit: 20 }, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('only-function')
    })

    it('should handle limit larger than total functions', async () => {
      apiClient.setFunctions([
        createSampleFunction({ name: 'func-1' }),
        createSampleFunction({ name: 'func-2' }),
      ])

      const result = await runList({ limit: 100 }, context, apiClient)

      expect(result.exitCode).toBe(0)
      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('func-1')
      expect(output).toContain('func-2')
    })

    it('should handle limit of 1', async () => {
      const result = await runList({ limit: 1 }, context, apiClient)

      expect(result.exitCode).toBe(0)
      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('function-01')
      expect(output).not.toContain('function-02')
    })

    it('should display total count regardless of limit', async () => {
      await runList({ limit: 5 }, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      // Should show total count is 25 even though only 5 are displayed
      expect(output).toMatch(/25|total/i)
    })
  })

  describe('handles empty list', () => {
    it('should handle empty function list gracefully', async () => {
      apiClient.setFunctions([])

      const result = await runList({}, context, apiClient)

      expect(result.exitCode).toBe(0)
    })

    it('should display helpful message when no functions are deployed', async () => {
      apiClient.setFunctions([])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/no functions|empty|none|deploy.*first/i)
    })

    it('should suggest deployment command when list is empty', async () => {
      apiClient.setFunctions([])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/dotdo deploy|dotdo init|get started/i)
    })
  })

  describe('requires authentication', () => {
    it('should require authentication to list functions', async () => {
      apiClient.authenticated = false

      const result = await runList({}, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/unauthorized|login|authenticate/i)
    })

    it('should suggest login command when not authenticated', async () => {
      apiClient.authenticated = false

      const result = await runList({}, context, apiClient)

      expect(result.error).toMatch(/dotdo login|please log in/i)
    })

    it('should output authentication error to stderr', async () => {
      apiClient.authenticated = false

      await runList({}, context, apiClient)

      const stderrOutput = context.stderrOutput.join('\n')
      expect(stderrOutput).toMatch(/unauthorized|login|authenticate/i)
    })

    it('should work correctly when authenticated', async () => {
      apiClient.authenticated = true
      apiClient.setFunctions([createSampleFunction({ name: 'authenticated-function' })])

      const result = await runList({}, context, apiClient)

      expect(result.exitCode).toBe(0)
      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('authenticated-function')
    })
  })

  describe('formats output in table', () => {
    it('should display output in table format by default', async () => {
      apiClient.setFunctions([
        createSampleFunction({ name: 'table-function', version: '1.0.0' }),
      ])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      // Table should have headers
      expect(output).toMatch(/name/i)
      expect(output).toMatch(/version/i)
      expect(output).toMatch(/language/i)
      expect(output).toMatch(/status/i)
    })

    it('should align columns properly', async () => {
      apiClient.setFunctions([
        createSampleFunction({ name: 'short', version: '1.0.0' }),
        createSampleFunction({ name: 'very-long-function-name', version: '10.20.30' }),
      ])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      // Both function names should be present and output should be readable
      expect(output).toContain('short')
      expect(output).toContain('very-long-function-name')
    })

    it('should include table headers', async () => {
      apiClient.setFunctions([createSampleFunction({ name: 'my-function' })])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n').toLowerCase()
      // Should have column headers
      expect(output).toMatch(/name/)
      expect(output).toMatch(/version/)
      expect(output).toMatch(/language|runtime/)
      expect(output).toMatch(/status/)
    })

    it('should format multiple functions in rows', async () => {
      apiClient.setFunctions([
        createSampleFunction({ name: 'api-v1', version: '1.0.0', language: 'typescript', status: 'active' }),
        createSampleFunction({ name: 'api-v2', version: '2.0.0', language: 'rust', status: 'deploying' }),
        createSampleFunction({ name: 'worker', version: '0.1.0', language: 'go', status: 'inactive' }),
      ])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      // All function names should appear
      expect(output).toContain('api-v1')
      expect(output).toContain('api-v2')
      expect(output).toContain('worker')
    })

    it('should visually distinguish different statuses', async () => {
      apiClient.setFunctions([
        createSampleFunction({ name: 'active-fn', status: 'active' }),
        createSampleFunction({ name: 'failed-fn', status: 'failed' }),
      ])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      // Both statuses should be clearly visible
      expect(output).toMatch(/active/i)
      expect(output).toMatch(/failed/i)
    })
  })

  describe('API error handling', () => {
    it('should handle API connection errors gracefully', async () => {
      const failingClient = createMockAPIClient()
      failingClient.listFunctions = async () => {
        throw new Error('Connection refused')
      }

      const result = await runList({}, context, failingClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/connection|error|failed/i)
    })

    it('should handle API timeout errors', async () => {
      const failingClient = createMockAPIClient()
      failingClient.listFunctions = async () => {
        throw new Error('Request timeout')
      }

      const result = await runList({}, context, failingClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/timeout|error|failed/i)
    })

    it('should handle server errors', async () => {
      const failingClient = createMockAPIClient()
      failingClient.listFunctions = async () => {
        throw new Error('Internal server error')
      }

      const result = await runList({}, context, failingClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/server|error|failed/i)
    })

    it('should output errors to stderr', async () => {
      const failingClient = createMockAPIClient()
      failingClient.listFunctions = async () => {
        throw new Error('API Error')
      }

      await runList({}, context, failingClient)

      const stderrOutput = context.stderrOutput.join('\n')
      expect(stderrOutput).toMatch(/error/i)
    })
  })

  describe('output to stdout/stderr', () => {
    it('should output function list to stdout', async () => {
      apiClient.setFunctions([createSampleFunction({ name: 'stdout-function' })])

      await runList({}, context, apiClient)

      expect(context.stdoutOutput.length).toBeGreaterThan(0)
      expect(context.stdoutOutput.join('\n')).toContain('stdout-function')
    })

    it('should output errors to stderr', async () => {
      apiClient.authenticated = false

      await runList({}, context, apiClient)

      expect(context.stderrOutput.length).toBeGreaterThan(0)
    })

    it('should not mix errors with function output', async () => {
      apiClient.setFunctions([createSampleFunction({ name: 'clean-output' })])

      await runList({}, context, apiClient)

      // stdout should contain function data only
      expect(context.stdoutOutput.join('\n')).toContain('clean-output')
      // stderr should be empty for successful operation
      expect(context.stderrOutput.length).toBe(0)
    })
  })

  describe('URL display', () => {
    it('should display function URL when available', async () => {
      apiClient.setFunctions([
        createSampleFunction({
          name: 'url-function',
          url: 'https://url-function.workers.dev',
        }),
      ])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('https://url-function.workers.dev')
    })

    it('should handle functions without URL', async () => {
      apiClient.setFunctions([
        createSampleFunction({
          name: 'no-url-function',
          url: undefined,
        }),
      ])

      const result = await runList({}, context, apiClient)

      expect(result.exitCode).toBe(0)
      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('no-url-function')
    })
  })

  describe('last deployment display', () => {
    it('should display last deployment time', async () => {
      apiClient.setFunctions([
        createSampleFunction({
          name: 'deployed-function',
          lastDeployment: '2024-03-15T14:30:00Z',
        }),
      ])

      await runList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      // Should contain deployment date in some format
      expect(output).toMatch(/2024|Mar|March|deployed/i)
    })
  })

  describe('sorting and ordering', () => {
    it('should display functions in a consistent order', async () => {
      apiClient.setFunctions([
        createSampleFunction({ name: 'zulu-function' }),
        createSampleFunction({ name: 'alpha-function' }),
        createSampleFunction({ name: 'mike-function' }),
      ])

      const result = await runList({}, context, apiClient)

      expect(result.exitCode).toBe(0)
      // All functions should be present
      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('zulu-function')
      expect(output).toContain('alpha-function')
      expect(output).toContain('mike-function')
    })
  })
})
