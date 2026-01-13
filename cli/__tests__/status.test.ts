/**
 * Tests for dotdo status command
 *
 * TDD RED phase - these tests define the expected behavior
 * of the `dotdo status <name>` command for displaying function status.
 *
 * The status command should:
 * - Show function name and version
 * - Show language and entry point
 * - Show health status (healthy, degraded, unhealthy)
 * - Show recent invocations count
 * - Show error rate
 * - Show last deployment time
 * - Show active version
 * - Return exit code 1 if function not found
 * - Support --json for JSON output
 */

import { describe, it, expect, beforeEach } from 'vitest'

/**
 * Health status values for a function
 */
type HealthStatus = 'healthy' | 'degraded' | 'unhealthy'

/**
 * Function status information returned by the API
 */
interface FunctionStatus {
  name: string
  version: string
  language: 'typescript' | 'rust' | 'go' | 'python'
  entryPoint: string
  healthStatus: HealthStatus
  recentInvocations: number
  errorRate: number // percentage (0-100)
  lastDeployment: string // ISO 8601 timestamp
  activeVersion: string
  url?: string
}

/**
 * Mock API client interface for dependency injection
 * Allows testing without actual API calls
 */
interface MockAPIClient {
  getFunctionStatus: (name: string) => Promise<FunctionStatus | null>
}

/**
 * CLI context for dependency injection
 */
interface CLIContext {
  api: MockAPIClient
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
 * Status command options
 */
interface StatusOptions {
  json?: boolean
}

/**
 * Run the status command with given arguments and context
 * This is the function under test - to be implemented
 */
declare function runStatus(
  name: string,
  options: StatusOptions,
  context: CLIContext
): Promise<CommandResult>

/**
 * Create a mock API client for testing
 */
function createMockAPIClient(): MockAPIClient & {
  functions: Map<string, FunctionStatus>
  setFunction: (status: FunctionStatus) => void
} {
  const functions = new Map<string, FunctionStatus>()

  return {
    functions,
    setFunction(status: FunctionStatus): void {
      functions.set(status.name, status)
    },
    async getFunctionStatus(name: string): Promise<FunctionStatus | null> {
      return functions.get(name) ?? null
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
  api: ReturnType<typeof createMockAPIClient>
} {
  const stdoutOutput: string[] = []
  const stderrOutput: string[] = []
  let exitCode: number | null = null

  const api = createMockAPIClient()

  return {
    api,
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
 * Create a sample function status for testing
 */
function createSampleStatus(overrides: Partial<FunctionStatus> = {}): FunctionStatus {
  return {
    name: 'my-function',
    version: '1.0.0',
    language: 'typescript',
    entryPoint: 'src/index.ts',
    healthStatus: 'healthy',
    recentInvocations: 1234,
    errorRate: 0.5,
    lastDeployment: '2024-01-15T10:30:00Z',
    activeVersion: 'v3',
    url: 'https://my-function.workers.dev',
    ...overrides,
  }
}

describe('dotdo status', () => {
  let context: ReturnType<typeof createTestContext>

  beforeEach(() => {
    context = createTestContext()
  })

  describe('dotdo status <name>', () => {
    it('should show function status for existing function', async () => {
      const status = createSampleStatus({ name: 'my-function' })
      context.api.setFunction(status)

      const result = await runStatus('my-function', {}, context)

      expect(result.exitCode).toBe(0)
      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('my-function')
    })

    it('should return exit code 1 if function not found', async () => {
      const result = await runStatus('nonexistent-function', {}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/not found|does not exist/i)
    })

    it('should output error message to stderr if function not found', async () => {
      await runStatus('nonexistent-function', {}, context)

      const stderrOutput = context.stderrOutput.join('\n')
      expect(stderrOutput).toMatch(/not found|does not exist/i)
      expect(stderrOutput).toContain('nonexistent-function')
    })

    it('should fail if no name is provided', async () => {
      const result = await runStatus('', {}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/name.*required/i)
    })
  })

  describe('version display', () => {
    it('should show function version', async () => {
      const status = createSampleStatus({ name: 'my-function', version: '2.1.0' })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('2.1.0')
    })

    it('should show active version', async () => {
      const status = createSampleStatus({ name: 'my-function', activeVersion: 'v5' })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('v5')
    })
  })

  describe('language and entry point display', () => {
    it('should show TypeScript language', async () => {
      const status = createSampleStatus({ name: 'my-function', language: 'typescript' })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/typescript/i)
    })

    it('should show Rust language', async () => {
      const status = createSampleStatus({ name: 'my-function', language: 'rust' })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/rust/i)
    })

    it('should show Go language', async () => {
      const status = createSampleStatus({ name: 'my-function', language: 'go' })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/go/i)
    })

    it('should show Python language', async () => {
      const status = createSampleStatus({ name: 'my-function', language: 'python' })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/python/i)
    })

    it('should show entry point', async () => {
      const status = createSampleStatus({ name: 'my-function', entryPoint: 'src/main.ts' })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('src/main.ts')
    })
  })

  describe('health status display', () => {
    it('should show healthy status', async () => {
      const status = createSampleStatus({ name: 'my-function', healthStatus: 'healthy' })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/healthy/i)
    })

    it('should show degraded status', async () => {
      const status = createSampleStatus({ name: 'my-function', healthStatus: 'degraded' })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/degraded/i)
    })

    it('should show unhealthy status', async () => {
      const status = createSampleStatus({ name: 'my-function', healthStatus: 'unhealthy' })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/unhealthy/i)
    })

    it('should visually distinguish health statuses', async () => {
      // Test that different health statuses produce different output
      const healthyStatus = createSampleStatus({ name: 'healthy-fn', healthStatus: 'healthy' })
      const unhealthyStatus = createSampleStatus({
        name: 'unhealthy-fn',
        healthStatus: 'unhealthy',
      })

      const healthyContext = createTestContext()
      healthyContext.api.setFunction(healthyStatus)
      await runStatus('healthy-fn', {}, healthyContext)

      const unhealthyContext = createTestContext()
      unhealthyContext.api.setFunction(unhealthyStatus)
      await runStatus('unhealthy-fn', {}, unhealthyContext)

      const healthyOutput = healthyContext.stdoutOutput.join('\n')
      const unhealthyOutput = unhealthyContext.stdoutOutput.join('\n')

      // Outputs should be different due to health status
      expect(healthyOutput).not.toBe(unhealthyOutput)
    })
  })

  describe('recent invocations display', () => {
    it('should show recent invocations count', async () => {
      const status = createSampleStatus({ name: 'my-function', recentInvocations: 5678 })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/5678|5,678/)
    })

    it('should show zero invocations', async () => {
      const status = createSampleStatus({ name: 'my-function', recentInvocations: 0 })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('0')
    })

    it('should format large invocation counts', async () => {
      const status = createSampleStatus({ name: 'my-function', recentInvocations: 1234567 })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      // Should contain the number (possibly formatted with commas or abbreviated)
      expect(output).toMatch(/1,?234,?567|1\.2M/i)
    })
  })

  describe('error rate display', () => {
    it('should show error rate as percentage', async () => {
      const status = createSampleStatus({ name: 'my-function', errorRate: 2.5 })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/2\.5\s*%/)
    })

    it('should show zero error rate', async () => {
      const status = createSampleStatus({ name: 'my-function', errorRate: 0 })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/0\s*%/)
    })

    it('should show 100% error rate', async () => {
      const status = createSampleStatus({ name: 'my-function', errorRate: 100 })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/100\s*%/)
    })

    it('should handle decimal error rates', async () => {
      const status = createSampleStatus({ name: 'my-function', errorRate: 0.05 })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/0\.05\s*%/)
    })
  })

  describe('last deployment time display', () => {
    it('should show last deployment time', async () => {
      const status = createSampleStatus({
        name: 'my-function',
        lastDeployment: '2024-01-15T10:30:00Z',
      })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      // Should contain the date in some readable format
      expect(output).toMatch(/2024|Jan|January/i)
    })

    it('should show recent deployment as relative time', async () => {
      // Create a recent deployment time
      const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString() // 5 minutes ago
      const status = createSampleStatus({ name: 'my-function', lastDeployment: recentTime })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      // Should show relative time or absolute time
      expect(output).toMatch(/ago|minutes|min|\d{4}/)
    })

    it('should handle deployment from days ago', async () => {
      const daysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() // 3 days ago
      const status = createSampleStatus({ name: 'my-function', lastDeployment: daysAgo })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      // Should show the deployment info
      expect(output.length).toBeGreaterThan(0)
    })
  })

  describe('URL display', () => {
    it('should show function URL when available', async () => {
      const status = createSampleStatus({
        name: 'my-function',
        url: 'https://my-function.workers.dev',
      })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('https://my-function.workers.dev')
    })

    it('should handle function without URL', async () => {
      const status = createSampleStatus({ name: 'my-function', url: undefined })
      context.api.setFunction(status)

      const result = await runStatus('my-function', {}, context)

      expect(result.exitCode).toBe(0)
    })
  })

  describe('--json flag', () => {
    it('should output valid JSON when --json flag is provided', async () => {
      const status = createSampleStatus({ name: 'my-function' })
      context.api.setFunction(status)

      await runStatus('my-function', { json: true }, context)

      const output = context.stdoutOutput.join('')
      expect(() => JSON.parse(output)).not.toThrow()
    })

    it('should include all status fields in JSON output', async () => {
      const status = createSampleStatus({
        name: 'my-function',
        version: '1.2.3',
        language: 'typescript',
        entryPoint: 'src/index.ts',
        healthStatus: 'healthy',
        recentInvocations: 1000,
        errorRate: 1.5,
        lastDeployment: '2024-01-15T10:30:00Z',
        activeVersion: 'v2',
        url: 'https://my-function.workers.dev',
      })
      context.api.setFunction(status)

      await runStatus('my-function', { json: true }, context)

      const output = context.stdoutOutput.join('')
      const json = JSON.parse(output)

      expect(json.name).toBe('my-function')
      expect(json.version).toBe('1.2.3')
      expect(json.language).toBe('typescript')
      expect(json.entryPoint).toBe('src/index.ts')
      expect(json.healthStatus).toBe('healthy')
      expect(json.recentInvocations).toBe(1000)
      expect(json.errorRate).toBe(1.5)
      expect(json.lastDeployment).toBe('2024-01-15T10:30:00Z')
      expect(json.activeVersion).toBe('v2')
      expect(json.url).toBe('https://my-function.workers.dev')
    })

    it('should output error as JSON when function not found with --json flag', async () => {
      await runStatus('nonexistent-function', { json: true }, context)

      const stderrOutput = context.stderrOutput.join('')
      expect(() => JSON.parse(stderrOutput)).not.toThrow()

      const json = JSON.parse(stderrOutput)
      expect(json.error).toBeDefined()
      expect(json.error).toMatch(/not found|does not exist/i)
    })

    it('should not include human-readable formatting in JSON output', async () => {
      const status = createSampleStatus({ name: 'my-function' })
      context.api.setFunction(status)

      await runStatus('my-function', { json: true }, context)

      const output = context.stdoutOutput.join('')

      // JSON output should not contain table borders or decorations
      expect(output).not.toMatch(/[─│┌┐└┘├┤┬┴┼]/)
      expect(output).not.toMatch(/\+[-+]+\+/)
      expect(output).not.toMatch(/\|[-|]+\|/)
    })
  })

  describe('human-readable output formatting', () => {
    it('should include labels for each field', async () => {
      const status = createSampleStatus({ name: 'my-function' })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n').toLowerCase()

      // Should include labels for important fields
      expect(output).toMatch(/name|function/i)
      expect(output).toMatch(/version/i)
      expect(output).toMatch(/language/i)
      expect(output).toMatch(/health|status/i)
      expect(output).toMatch(/invocation|request/i)
      expect(output).toMatch(/error/i)
      expect(output).toMatch(/deploy|deployment/i)
    })

    it('should format output in a readable way', async () => {
      const status = createSampleStatus({ name: 'my-function' })
      context.api.setFunction(status)

      await runStatus('my-function', {}, context)

      const output = context.stdoutOutput.join('\n')

      // Output should have multiple lines for readability
      expect(output.split('\n').length).toBeGreaterThan(1)
    })
  })

  describe('API error handling', () => {
    it('should handle API connection errors gracefully', async () => {
      // Override the API client to simulate connection error
      context.api.getFunctionStatus = async () => {
        throw new Error('Connection refused')
      }

      const result = await runStatus('my-function', {}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/connection|error|failed/i)
    })

    it('should handle API timeout errors', async () => {
      context.api.getFunctionStatus = async () => {
        throw new Error('Request timeout')
      }

      const result = await runStatus('my-function', {}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/timeout|error|failed/i)
    })

    it('should handle API authentication errors', async () => {
      context.api.getFunctionStatus = async () => {
        throw new Error('Unauthorized: Invalid API key')
      }

      const result = await runStatus('my-function', {}, context)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/unauthorized|auth|error/i)
    })

    it('should output API errors to stderr', async () => {
      context.api.getFunctionStatus = async () => {
        throw new Error('Server error')
      }

      await runStatus('my-function', {}, context)

      const stderrOutput = context.stderrOutput.join('\n')
      expect(stderrOutput).toMatch(/error/i)
    })
  })
})
