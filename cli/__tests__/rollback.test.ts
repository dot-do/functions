/**
 * Tests for dotdo rollback command
 *
 * TDD RED phase - these tests define the expected behavior
 * of the `dotdo rollback <name> <version>` command for rolling back
 * a deployed function to a previous version.
 *
 * The rollback command should:
 * - Roll back to specified version with `dotdo rollback <name> <version>`
 * - List available versions if no version specified
 * - Prompt for confirmation before rollback
 * - Support --force to skip confirmation
 * - Show success message with new active version
 * - Return exit code 1 for non-existent function
 * - Return exit code 1 for non-existent version
 * - Require authentication
 */

import { describe, it, expect, beforeEach } from 'vitest'

/**
 * Version information for a function deployment
 */
interface FunctionVersion {
  version: string
  deployedAt: string // ISO 8601 timestamp
  commitHash?: string
  isActive: boolean
  size: number // bytes
  message?: string // deployment message
}

/**
 * Response from listing versions
 */
interface ListVersionsResponse {
  functionName: string
  versions: FunctionVersion[]
  total: number
}

/**
 * Response from rollback operation
 */
interface RollbackResponse {
  success: boolean
  functionName: string
  previousVersion: string
  newActiveVersion: string
  message: string
}

/**
 * API Client interface for rollback operations
 * Used for dependency injection to enable testing
 */
interface RollbackAPIClient {
  /**
   * List all available versions for a function
   * @param functionName - The name of the function
   */
  listVersions(functionName: string): Promise<ListVersionsResponse>

  /**
   * Roll back a function to a specific version
   * @param functionName - The name of the function
   * @param version - The version to roll back to
   */
  rollback(functionName: string, version: string): Promise<RollbackResponse>

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): Promise<boolean>

  /**
   * Get the current active version of a function
   * @param functionName - The name of the function
   */
  getActiveVersion(functionName: string): Promise<string>
}

/**
 * Prompt interface for interactive input
 */
interface PromptInterface {
  /**
   * Prompt for confirmation (yes/no)
   */
  confirm(message: string): Promise<boolean>

  /**
   * Prompt for selecting from a list of options
   */
  select<T>(message: string, choices: Array<{ name: string; value: T }>): Promise<T>
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
 * Options for rollback command
 */
interface RollbackOptions {
  force?: boolean
}

/**
 * Run the rollback command with given arguments and context
 * This is the function under test - to be implemented
 */
declare function runRollback(
  functionName: string,
  version: string | undefined,
  options: RollbackOptions,
  context: CLIContext,
  apiClient: RollbackAPIClient,
  prompt: PromptInterface
): Promise<CommandResult>

/**
 * Create a mock API client for testing
 */
function createMockAPIClient(): RollbackAPIClient & {
  functions: Map<string, { versions: FunctionVersion[]; activeVersion: string }>
  authenticated: boolean
  setFunction: (name: string, versions: FunctionVersion[], activeVersion: string) => void
} {
  const functions = new Map<string, { versions: FunctionVersion[]; activeVersion: string }>()
  let authenticated = true

  return {
    functions,
    get authenticated() {
      return authenticated
    },
    set authenticated(value: boolean) {
      authenticated = value
    },
    setFunction(name: string, versions: FunctionVersion[], activeVersion: string) {
      functions.set(name, { versions, activeVersion })
    },
    async listVersions(functionName: string): Promise<ListVersionsResponse> {
      if (!authenticated) {
        throw new Error('Unauthorized: Please log in first')
      }
      const func = functions.get(functionName)
      if (!func) {
        throw new Error(`Function "${functionName}" not found`)
      }
      return {
        functionName,
        versions: func.versions,
        total: func.versions.length,
      }
    },
    async rollback(functionName: string, version: string): Promise<RollbackResponse> {
      if (!authenticated) {
        throw new Error('Unauthorized: Please log in first')
      }
      const func = functions.get(functionName)
      if (!func) {
        throw new Error(`Function "${functionName}" not found`)
      }
      const targetVersion = func.versions.find((v) => v.version === version)
      if (!targetVersion) {
        throw new Error(`Version "${version}" not found for function "${functionName}"`)
      }
      const previousVersion = func.activeVersion
      func.activeVersion = version
      // Update isActive flags
      func.versions.forEach((v) => {
        v.isActive = v.version === version
      })
      return {
        success: true,
        functionName,
        previousVersion,
        newActiveVersion: version,
        message: `Successfully rolled back "${functionName}" from ${previousVersion} to ${version}`,
      }
    },
    async isAuthenticated(): Promise<boolean> {
      return authenticated
    },
    async getActiveVersion(functionName: string): Promise<string> {
      if (!authenticated) {
        throw new Error('Unauthorized: Please log in first')
      }
      const func = functions.get(functionName)
      if (!func) {
        throw new Error(`Function "${functionName}" not found`)
      }
      return func.activeVersion
    },
  }
}

/**
 * Create a mock prompt interface for testing
 */
function createMockPrompt(): PromptInterface & {
  confirmResponses: Map<string, boolean>
  selectResponses: Map<string, unknown>
  confirmCalls: string[]
  selectCalls: string[]
  defaultConfirm: boolean
  setConfirmResponse: (message: string, value: boolean) => void
  setSelectResponse: (message: string, value: unknown) => void
} {
  const confirmResponses = new Map<string, boolean>()
  const selectResponses = new Map<string, unknown>()
  const confirmCalls: string[] = []
  const selectCalls: string[] = []
  let defaultConfirm = true

  return {
    confirmResponses,
    selectResponses,
    confirmCalls,
    selectCalls,
    get defaultConfirm() {
      return defaultConfirm
    },
    set defaultConfirm(value: boolean) {
      defaultConfirm = value
    },
    setConfirmResponse(message: string, value: boolean) {
      confirmResponses.set(message, value)
    },
    setSelectResponse(message: string, value: unknown) {
      selectResponses.set(message, value)
    },
    async confirm(message: string): Promise<boolean> {
      confirmCalls.push(message)
      return confirmResponses.get(message) ?? defaultConfirm
    },
    async select<T>(message: string, choices: Array<{ name: string; value: T }>): Promise<T> {
      selectCalls.push(message)
      const response = selectResponses.get(message)
      if (response !== undefined) {
        return response as T
      }
      // Default to first choice
      return choices[0].value
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
 * Create sample function versions for testing
 */
function createSampleVersions(): FunctionVersion[] {
  return [
    {
      version: 'v3',
      deployedAt: '2024-01-15T10:30:00Z',
      commitHash: 'abc123',
      isActive: true,
      size: 1024000,
      message: 'Add new feature',
    },
    {
      version: 'v2',
      deployedAt: '2024-01-10T08:00:00Z',
      commitHash: 'def456',
      isActive: false,
      size: 980000,
      message: 'Bug fixes',
    },
    {
      version: 'v1',
      deployedAt: '2024-01-01T00:00:00Z',
      commitHash: 'ghi789',
      isActive: false,
      size: 950000,
      message: 'Initial deployment',
    },
  ]
}

describe('dotdo rollback', () => {
  let context: ReturnType<typeof createTestContext>
  let apiClient: ReturnType<typeof createMockAPIClient>
  let prompt: ReturnType<typeof createMockPrompt>

  beforeEach(() => {
    context = createTestContext('/projects/my-function')
    apiClient = createMockAPIClient()
    prompt = createMockPrompt()

    // Set up a default function with versions
    apiClient.setFunction('my-function', createSampleVersions(), 'v3')
  })

  describe('dotdo rollback <name> <version>', () => {
    it('should roll back function to specified version', async () => {
      const result = await runRollback('my-function', 'v2', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.functions.get('my-function')?.activeVersion).toBe('v2')
    })

    it('should show success message with new active version', async () => {
      await runRollback('my-function', 'v2', {}, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/success|rolled back/i)
      expect(output).toContain('v2')
    })

    it('should show previous and new version in output', async () => {
      await runRollback('my-function', 'v1', {}, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('v3') // previous version
      expect(output).toContain('v1') // new version
    })

    it('should display function name in success message', async () => {
      await runRollback('my-function', 'v2', {}, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('my-function')
    })
  })

  describe('listing available versions (no version specified)', () => {
    it('should list available versions when no version is specified', async () => {
      await runRollback('my-function', undefined, {}, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('v1')
      expect(output).toContain('v2')
      expect(output).toContain('v3')
    })

    it('should indicate which version is currently active', async () => {
      await runRollback('my-function', undefined, {}, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/v3.*active|active.*v3/i)
    })

    it('should show deployment dates for versions', async () => {
      await runRollback('my-function', undefined, {}, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/2024|Jan|January/i)
    })

    it('should prompt to select a version to roll back to', async () => {
      prompt.setSelectResponse('Select version to roll back to:', 'v2')

      await runRollback('my-function', undefined, {}, context, apiClient, prompt)

      expect(prompt.selectCalls.length).toBeGreaterThan(0)
    })

    it('should perform rollback after selecting version from prompt', async () => {
      prompt.setSelectResponse('Select version to roll back to:', 'v1')

      const result = await runRollback('my-function', undefined, {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.functions.get('my-function')?.activeVersion).toBe('v1')
    })

    it('should show version messages/descriptions in list', async () => {
      await runRollback('my-function', undefined, {}, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/Add new feature|Bug fixes|Initial deployment/i)
    })

    it('should show commit hashes when available', async () => {
      await runRollback('my-function', undefined, {}, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/abc123|def456|ghi789/)
    })
  })

  describe('confirmation prompt', () => {
    it('should prompt for confirmation before rollback', async () => {
      prompt.defaultConfirm = true

      await runRollback('my-function', 'v2', {}, context, apiClient, prompt)

      expect(prompt.confirmCalls.length).toBeGreaterThan(0)
    })

    it('should include function name in confirmation prompt', async () => {
      await runRollback('my-function', 'v2', {}, context, apiClient, prompt)

      const confirmMessage = prompt.confirmCalls[0]
      expect(confirmMessage).toContain('my-function')
    })

    it('should include target version in confirmation prompt', async () => {
      await runRollback('my-function', 'v2', {}, context, apiClient, prompt)

      const confirmMessage = prompt.confirmCalls[0]
      expect(confirmMessage).toContain('v2')
    })

    it('should abort rollback when user declines confirmation', async () => {
      prompt.defaultConfirm = false

      const result = await runRollback('my-function', 'v2', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0) // Graceful abort, not an error
      expect(apiClient.functions.get('my-function')?.activeVersion).toBe('v3') // unchanged
    })

    it('should show cancellation message when user declines', async () => {
      prompt.defaultConfirm = false

      await runRollback('my-function', 'v2', {}, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/cancel|abort/i)
    })

    it('should proceed with rollback when user confirms', async () => {
      prompt.defaultConfirm = true

      const result = await runRollback('my-function', 'v2', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.functions.get('my-function')?.activeVersion).toBe('v2')
    })
  })

  describe('--force flag', () => {
    it('should skip confirmation when --force is set', async () => {
      const result = await runRollback('my-function', 'v2', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(prompt.confirmCalls.length).toBe(0) // no confirmation prompt
    })

    it('should perform rollback immediately with --force', async () => {
      await runRollback('my-function', 'v2', { force: true }, context, apiClient, prompt)

      expect(apiClient.functions.get('my-function')?.activeVersion).toBe('v2')
    })

    it('should still show success message with --force', async () => {
      await runRollback('my-function', 'v2', { force: true }, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/success|rolled back/i)
    })
  })

  describe('success message with new active version', () => {
    it('should clearly indicate the rollback was successful', async () => {
      await runRollback('my-function', 'v2', { force: true }, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/success/i)
    })

    it('should show the new active version', async () => {
      await runRollback('my-function', 'v1', { force: true }, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/v1.*active|active.*v1|now.*v1/i)
    })

    it('should show what version was replaced', async () => {
      await runRollback('my-function', 'v2', { force: true }, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('v3') // the previous active version
    })

    it('should use stdout for success message', async () => {
      await runRollback('my-function', 'v2', { force: true }, context, apiClient, prompt)

      expect(context.stdoutOutput.length).toBeGreaterThan(0)
      expect(context.stderrOutput.length).toBe(0)
    })
  })

  describe('non-existent function error', () => {
    it('should return exit code 1 for non-existent function', async () => {
      const result = await runRollback('nonexistent-function', 'v1', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
    })

    it('should show error message for non-existent function', async () => {
      const result = await runRollback('nonexistent-function', 'v1', { force: true }, context, apiClient, prompt)

      expect(result.error).toMatch(/not found|does not exist/i)
    })

    it('should include function name in error message', async () => {
      const result = await runRollback('nonexistent-function', 'v1', { force: true }, context, apiClient, prompt)

      expect(result.error).toContain('nonexistent-function')
    })

    it('should write error to stderr', async () => {
      await runRollback('nonexistent-function', 'v1', { force: true }, context, apiClient, prompt)

      expect(context.stderrOutput.length).toBeGreaterThan(0)
      expect(context.stderrOutput.join('\n')).toMatch(/not found/i)
    })
  })

  describe('non-existent version error', () => {
    it('should return exit code 1 for non-existent version', async () => {
      const result = await runRollback('my-function', 'v999', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
    })

    it('should show error message for non-existent version', async () => {
      const result = await runRollback('my-function', 'v999', { force: true }, context, apiClient, prompt)

      expect(result.error).toMatch(/version.*not found|not found.*version/i)
    })

    it('should include version identifier in error message', async () => {
      const result = await runRollback('my-function', 'v999', { force: true }, context, apiClient, prompt)

      expect(result.error).toContain('v999')
    })

    it('should suggest available versions in error', async () => {
      const result = await runRollback('my-function', 'v999', { force: true }, context, apiClient, prompt)

      // Should hint at valid versions
      expect(result.error).toMatch(/v1|v2|v3|available|valid/i)
    })

    it('should write error to stderr', async () => {
      await runRollback('my-function', 'v999', { force: true }, context, apiClient, prompt)

      expect(context.stderrOutput.length).toBeGreaterThan(0)
      expect(context.stderrOutput.join('\n')).toMatch(/not found/i)
    })
  })

  describe('authentication requirement', () => {
    it('should require authentication for rollback', async () => {
      apiClient.authenticated = false

      const result = await runRollback('my-function', 'v2', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/unauthorized|login|authenticate/i)
    })

    it('should require authentication for listing versions', async () => {
      apiClient.authenticated = false

      const result = await runRollback('my-function', undefined, {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/unauthorized|login|authenticate/i)
    })

    it('should suggest login command when not authenticated', async () => {
      apiClient.authenticated = false

      const result = await runRollback('my-function', 'v2', { force: true }, context, apiClient, prompt)

      expect(result.error).toMatch(/dotdo login|please log in/i)
    })

    it('should write authentication error to stderr', async () => {
      apiClient.authenticated = false

      await runRollback('my-function', 'v2', { force: true }, context, apiClient, prompt)

      expect(context.stderrOutput.length).toBeGreaterThan(0)
      expect(context.stderrOutput.join('\n')).toMatch(/unauthorized|login/i)
    })
  })

  describe('edge cases', () => {
    it('should handle function with only one version', async () => {
      apiClient.setFunction(
        'single-version-fn',
        [
          {
            version: 'v1',
            deployedAt: '2024-01-01T00:00:00Z',
            isActive: true,
            size: 1000,
          },
        ],
        'v1'
      )

      const result = await runRollback('single-version-fn', undefined, {}, context, apiClient, prompt)

      // Should handle gracefully - maybe show message that there are no other versions
      expect(result.exitCode).toBe(0)
      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/no other versions|only.*version|cannot roll back/i)
    })

    it('should not allow rollback to already active version', async () => {
      const result = await runRollback('my-function', 'v3', { force: true }, context, apiClient, prompt)

      // Should indicate this version is already active
      const output = context.stdoutOutput.join('\n') + context.stderrOutput.join('\n')
      expect(output).toMatch(/already active|current version|no change/i)
    })

    it('should handle empty function name', async () => {
      const result = await runRollback('', 'v1', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/function name.*required|name.*required/i)
    })

    it('should validate function name format', async () => {
      const result = await runRollback('invalid function name!', 'v1', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/invalid.*name|name.*format/i)
    })

    it('should handle version with special format', async () => {
      apiClient.setFunction(
        'semver-function',
        [
          {
            version: '1.2.3',
            deployedAt: '2024-01-15T00:00:00Z',
            isActive: true,
            size: 1000,
          },
          {
            version: '1.2.2',
            deployedAt: '2024-01-10T00:00:00Z',
            isActive: false,
            size: 1000,
          },
        ],
        '1.2.3'
      )

      const result = await runRollback('semver-function', '1.2.2', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.functions.get('semver-function')?.activeVersion).toBe('1.2.2')
    })

    it('should handle commit hash as version identifier', async () => {
      apiClient.setFunction(
        'hash-function',
        [
          {
            version: 'abc123def',
            deployedAt: '2024-01-15T00:00:00Z',
            commitHash: 'abc123def',
            isActive: true,
            size: 1000,
          },
          {
            version: '789xyz012',
            deployedAt: '2024-01-10T00:00:00Z',
            commitHash: '789xyz012',
            isActive: false,
            size: 1000,
          },
        ],
        'abc123def'
      )

      const result = await runRollback('hash-function', '789xyz012', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.functions.get('hash-function')?.activeVersion).toBe('789xyz012')
    })
  })

  describe('API error handling', () => {
    it('should handle API connection errors gracefully', async () => {
      apiClient.rollback = async () => {
        throw new Error('Connection refused')
      }

      const result = await runRollback('my-function', 'v2', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/connection|error|failed/i)
    })

    it('should handle API timeout errors', async () => {
      apiClient.rollback = async () => {
        throw new Error('Request timeout')
      }

      const result = await runRollback('my-function', 'v2', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/timeout|error|failed/i)
    })

    it('should handle rate limiting', async () => {
      apiClient.rollback = async () => {
        throw new Error('Rate limit exceeded')
      }

      const result = await runRollback('my-function', 'v2', { force: true }, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/rate limit|too many/i)
    })

    it('should write API errors to stderr', async () => {
      apiClient.rollback = async () => {
        throw new Error('Server error')
      }

      await runRollback('my-function', 'v2', { force: true }, context, apiClient, prompt)

      expect(context.stderrOutput.length).toBeGreaterThan(0)
      expect(context.stderrOutput.join('\n')).toMatch(/error/i)
    })
  })

  describe('output formatting', () => {
    it('should format version list in a readable way', async () => {
      await runRollback('my-function', undefined, {}, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      // Should have multiple lines for readability
      expect(output.split('\n').length).toBeGreaterThan(1)
    })

    it('should show version sizes when listing', async () => {
      await runRollback('my-function', undefined, {}, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      // Should include size info
      expect(output).toMatch(/\d+.*KB|\d+.*MB|\d+.*bytes|size/i)
    })

    it('should sort versions by deployment date (newest first)', async () => {
      await runRollback('my-function', undefined, {}, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      const v3Index = output.indexOf('v3')
      const v2Index = output.indexOf('v2')
      const v1Index = output.indexOf('v1')

      // v3 should appear before v2, v2 before v1
      expect(v3Index).toBeLessThan(v2Index)
      expect(v2Index).toBeLessThan(v1Index)
    })
  })
})
