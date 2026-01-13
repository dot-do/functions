/**
 * Tests for dotdo delete command
 *
 * TDD RED phase - these tests define the expected behavior
 * of the `dotdo delete <name>` command for deleting functions.
 *
 * The delete command should:
 * - Delete a function by name
 * - Prompt for confirmation before deleting
 * - Support --force to skip confirmation
 * - Show success message after deletion
 * - Return exit code 1 for non-existent function
 * - Require authentication
 * - Support --all-versions flag to delete all versions
 */

import { describe, it, expect, beforeEach } from 'vitest'

/**
 * Function metadata returned from API
 */
interface FunctionMetadata {
  name: string
  version: string
  createdAt: string
  updatedAt: string
  url?: string
}

/**
 * Response from deleting a function
 */
interface DeleteFunctionResponse {
  success: boolean
  name: string
  message?: string
  versionsDeleted?: number
}

/**
 * API Client interface for delete operations
 * Used for dependency injection to enable testing
 */
interface DeleteAPIClient {
  /**
   * Delete a function by name
   * @param name - The function name to delete
   * @param options - Delete options
   */
  deleteFunction(name: string, options?: { allVersions?: boolean }): Promise<DeleteFunctionResponse>

  /**
   * Check if a function exists
   * @param name - The function name to check
   */
  functionExists(name: string): Promise<boolean>

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): Promise<boolean>
}

/**
 * Prompt interface for interactive input
 */
interface PromptInterface {
  /**
   * Prompt for confirmation
   * @param message - The confirmation message to display
   * @returns true if user confirms, false otherwise
   */
  confirm(message: string): Promise<boolean>
}

/**
 * CLI context for dependency injection
 */
interface CLIContext {
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
 * Options for delete command
 */
interface DeleteOptions {
  force?: boolean
  allVersions?: boolean
}

/**
 * Run the delete command with given arguments and context
 * This is the function under test - to be implemented
 */
declare function runDelete(
  name: string,
  options: DeleteOptions,
  context: CLIContext,
  apiClient: DeleteAPIClient,
  prompt: PromptInterface
): Promise<CommandResult>

/**
 * Create a mock API client for testing
 */
function createMockAPIClient(): DeleteAPIClient & {
  functions: Map<string, FunctionMetadata>
  authenticated: boolean
  deleteCalls: Array<{ name: string; options?: { allVersions?: boolean } }>
  setFunction: (metadata: FunctionMetadata) => void
} {
  const functions = new Map<string, FunctionMetadata>()
  const deleteCalls: Array<{ name: string; options?: { allVersions?: boolean } }> = []
  let authenticated = true

  return {
    functions,
    authenticated,
    deleteCalls,
    setFunction(metadata: FunctionMetadata): void {
      functions.set(metadata.name, metadata)
    },
    async deleteFunction(name: string, options?: { allVersions?: boolean }): Promise<DeleteFunctionResponse> {
      if (!authenticated) {
        throw new Error('Unauthorized: Please log in first')
      }
      deleteCalls.push({ name, options })
      const func = functions.get(name)
      if (!func) {
        throw new Error(`Function "${name}" not found`)
      }
      functions.delete(name)
      return {
        success: true,
        name,
        message: `Function "${name}" has been deleted`,
        versionsDeleted: options?.allVersions ? 5 : 1,
      }
    },
    async functionExists(name: string): Promise<boolean> {
      if (!authenticated) {
        throw new Error('Unauthorized: Please log in first')
      }
      return functions.has(name)
    },
    async isAuthenticated(): Promise<boolean> {
      return authenticated
    },
  }
}

/**
 * Create a mock prompt interface for testing
 */
function createMockPrompt(defaultResponse = true): PromptInterface & {
  confirmCalls: string[]
  response: boolean
} {
  const confirmCalls: string[] = []
  let response = defaultResponse

  return {
    confirmCalls,
    get response() {
      return response
    },
    set response(value: boolean) {
      response = value
    },
    async confirm(message: string): Promise<boolean> {
      confirmCalls.push(message)
      return response
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
 * Create a sample function metadata for testing
 */
function createSampleFunction(overrides: Partial<FunctionMetadata> = {}): FunctionMetadata {
  return {
    name: 'my-function',
    version: '1.0.0',
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-15T10:30:00Z',
    url: 'https://my-function.workers.dev',
    ...overrides,
  }
}

describe('dotdo delete', () => {
  let context: ReturnType<typeof createTestContext>
  let apiClient: ReturnType<typeof createMockAPIClient>
  let prompt: ReturnType<typeof createMockPrompt>

  beforeEach(() => {
    context = createTestContext('/projects/my-function')
    apiClient = createMockAPIClient()
    prompt = createMockPrompt(true)
  })

  describe('dotdo delete <name>', () => {
    it('should delete function when name is provided and user confirms', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)

      const result = await runDelete('my-function', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.functions.has('my-function')).toBe(false)
    })

    it('should fail if no function name is provided', async () => {
      const result = await runDelete('', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/name.*required|missing.*name/i)
    })

    it('should return exit code 1 for non-existent function', async () => {
      const result = await runDelete('nonexistent-function', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/not found|does not exist/i)
    })

    it('should output error message to stderr for non-existent function', async () => {
      await runDelete('nonexistent-function', {}, context, apiClient, prompt)

      const stderrOutput = context.stderrOutput.join('\n')
      expect(stderrOutput).toMatch(/not found|does not exist/i)
      expect(stderrOutput).toContain('nonexistent-function')
    })

    it('should make API call with correct function name', async () => {
      const func = createSampleFunction({ name: 'target-function' })
      apiClient.setFunction(func)

      await runDelete('target-function', {}, context, apiClient, prompt)

      expect(apiClient.deleteCalls).toHaveLength(1)
      expect(apiClient.deleteCalls[0].name).toBe('target-function')
    })
  })

  describe('confirmation prompt', () => {
    it('should prompt for confirmation before deleting', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)

      await runDelete('my-function', {}, context, apiClient, prompt)

      expect(prompt.confirmCalls).toHaveLength(1)
      expect(prompt.confirmCalls[0]).toMatch(/delete|confirm|sure/i)
    })

    it('should include function name in confirmation prompt', async () => {
      const func = createSampleFunction({ name: 'important-function' })
      apiClient.setFunction(func)

      await runDelete('important-function', {}, context, apiClient, prompt)

      expect(prompt.confirmCalls[0]).toContain('important-function')
    })

    it('should not delete when user declines confirmation', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)
      prompt.response = false

      const result = await runDelete('my-function', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.functions.has('my-function')).toBe(true)
      expect(apiClient.deleteCalls).toHaveLength(0)
    })

    it('should show cancelled message when user declines', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)
      prompt.response = false

      await runDelete('my-function', {}, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/cancelled|aborted/i)
    })

    it('should delete when user confirms', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)
      prompt.response = true

      const result = await runDelete('my-function', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.functions.has('my-function')).toBe(false)
    })
  })

  describe('--force flag', () => {
    it('should skip confirmation with --force flag', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)

      await runDelete('my-function', { force: true }, context, apiClient, prompt)

      expect(prompt.confirmCalls).toHaveLength(0)
    })

    it('should delete immediately with --force flag', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)

      const result = await runDelete('my-function', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.functions.has('my-function')).toBe(false)
    })

    it('should still fail for non-existent function with --force flag', async () => {
      const result = await runDelete('nonexistent', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/not found|does not exist/i)
    })
  })

  describe('success message', () => {
    it('should show success message after deletion', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)

      await runDelete('my-function', { force: true }, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/success|deleted|removed/i)
    })

    it('should include function name in success message', async () => {
      const func = createSampleFunction({ name: 'deleted-function' })
      apiClient.setFunction(func)

      await runDelete('deleted-function', { force: true }, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('deleted-function')
    })

    it('should output success message to stdout', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)

      await runDelete('my-function', { force: true }, context, apiClient, prompt)

      expect(context.stdoutOutput.length).toBeGreaterThan(0)
      expect(context.stderrOutput).toHaveLength(0)
    })
  })

  describe('authentication requirement', () => {
    it('should require authentication for delete command', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)
      apiClient.authenticated = false

      const result = await runDelete('my-function', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/unauthorized|login|authenticate/i)
    })

    it('should suggest login command when not authenticated', async () => {
      apiClient.authenticated = false

      const result = await runDelete('my-function', { force: true }, context, apiClient, prompt)

      expect(result.error).toMatch(/dotdo login|please log in/i)
    })

    it('should output authentication error to stderr', async () => {
      apiClient.authenticated = false

      await runDelete('my-function', { force: true }, context, apiClient, prompt)

      const stderrOutput = context.stderrOutput.join('\n')
      expect(stderrOutput).toMatch(/unauthorized|login|authenticate/i)
    })

    it('should not prompt for confirmation when not authenticated', async () => {
      apiClient.authenticated = false

      await runDelete('my-function', {}, context, apiClient, prompt)

      // Should fail before prompting
      expect(prompt.confirmCalls).toHaveLength(0)
    })
  })

  describe('--all-versions flag', () => {
    it('should pass allVersions option to API when flag is set', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)

      await runDelete('my-function', { force: true, allVersions: true }, context, apiClient, prompt)

      expect(apiClient.deleteCalls).toHaveLength(1)
      expect(apiClient.deleteCalls[0].options?.allVersions).toBe(true)
    })

    it('should show number of versions deleted when using --all-versions', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)

      await runDelete('my-function', { force: true, allVersions: true }, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/version|5/i)
    })

    it('should not pass allVersions when flag is not set', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)

      await runDelete('my-function', { force: true }, context, apiClient, prompt)

      expect(apiClient.deleteCalls[0].options?.allVersions).toBeFalsy()
    })

    it('should include all-versions in confirmation prompt', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)

      await runDelete('my-function', { allVersions: true }, context, apiClient, prompt)

      expect(prompt.confirmCalls[0]).toMatch(/all.*version|every.*version/i)
    })

    it('should warn about destructive nature of --all-versions', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)

      await runDelete('my-function', { allVersions: true }, context, apiClient, prompt)

      const allOutput = [...context.stdoutOutput, ...context.stderrOutput].join('\n')
      expect(allOutput).toMatch(/warning|caution|permanent|irreversible/i)
    })
  })

  describe('error handling', () => {
    it('should handle API connection errors gracefully', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)
      apiClient.deleteFunction = async () => {
        throw new Error('Connection refused')
      }

      const result = await runDelete('my-function', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/connection|error|failed/i)
    })

    it('should handle API timeout errors', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)
      apiClient.deleteFunction = async () => {
        throw new Error('Request timeout')
      }

      const result = await runDelete('my-function', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/timeout|error|failed/i)
    })

    it('should handle permission denied errors', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)
      apiClient.deleteFunction = async () => {
        throw new Error('Permission denied: You do not have access to delete this function')
      }

      const result = await runDelete('my-function', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/permission|access|denied/i)
    })

    it('should output API errors to stderr', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)
      apiClient.deleteFunction = async () => {
        throw new Error('Server error')
      }

      await runDelete('my-function', { force: true }, context, apiClient, prompt)

      const stderrOutput = context.stderrOutput.join('\n')
      expect(stderrOutput).toMatch(/error/i)
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
        const testApiClient = createMockAPIClient()
        const testPrompt = createMockPrompt(true)
        testApiClient.setFunction(createSampleFunction({ name }))

        const result = await runDelete(name, { force: true }, testContext, testApiClient, testPrompt)
        expect(result.exitCode).toBe(0)
      }
    })

    it('should accept function names with namespace', async () => {
      const func = createSampleFunction({ name: 'my-namespace/my-function' })
      apiClient.setFunction(func)

      const result = await runDelete('my-namespace/my-function', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.deleteCalls[0].name).toBe('my-namespace/my-function')
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
        const testApiClient = createMockAPIClient()
        const testPrompt = createMockPrompt(true)

        const result = await runDelete(name, { force: true }, testContext, testApiClient, testPrompt)
        expect(result.exitCode).toBe(1)
      }
    })
  })

  describe('combined flags', () => {
    it('should support --force with --all-versions', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)

      const result = await runDelete('my-function', { force: true, allVersions: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(prompt.confirmCalls).toHaveLength(0)
      expect(apiClient.deleteCalls[0].options?.allVersions).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle function with special characters in name', async () => {
      const func = createSampleFunction({ name: 'my-function-v2.0' })
      apiClient.setFunction(func)

      const result = await runDelete('my-function-v2.0', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
    })

    it('should handle concurrent deletion attempts gracefully', async () => {
      const func = createSampleFunction({ name: 'my-function' })
      apiClient.setFunction(func)

      // First delete succeeds
      await runDelete('my-function', { force: true }, context, apiClient, prompt)

      // Second delete should fail (already deleted)
      const result = await runDelete('my-function', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/not found|does not exist/i)
    })

    it('should handle very long function names', async () => {
      const longName = 'a'.repeat(100)
      const func = createSampleFunction({ name: longName })
      apiClient.setFunction(func)

      const result = await runDelete(longName, { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
    })
  })
})
