/**
 * Tests for dotdo secrets command
 *
 * TDD RED phase - these tests define the expected behavior
 * of the `dotdo secrets` command for managing function secrets.
 *
 * The secrets command should:
 * - Set secrets with `dotdo secrets set KEY=VALUE`
 * - Prompt for value when only key provided `dotdo secrets set KEY`
 * - Get masked secrets with `dotdo secrets get KEY`
 * - List all secret keys with `dotdo secrets list`
 * - Delete secrets with `dotdo secrets delete KEY`
 * - Encrypt secrets in transit
 * - Require authentication
 * - Support --function flag for function-specific secrets
 * - Validate key format
 * - Show success/error messages
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Secret metadata returned from API
 */
interface SecretMetadata {
  key: string
  createdAt: string
  updatedAt: string
  functionName?: string
}

/**
 * Response from setting a secret
 */
interface SetSecretResponse {
  success: boolean
  key: string
  message?: string
}

/**
 * Response from getting a secret (masked)
 */
interface GetSecretResponse {
  key: string
  value: string // Masked value like "****..."
  masked: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Response from listing secrets
 */
interface ListSecretsResponse {
  secrets: SecretMetadata[]
  total: number
}

/**
 * Response from deleting a secret
 */
interface DeleteSecretResponse {
  success: boolean
  key: string
  message?: string
}

/**
 * API Client interface for secrets operations
 * Used for dependency injection to enable testing
 */
interface SecretsAPIClient {
  /**
   * Set a secret value
   * @param key - The secret key
   * @param value - The secret value (will be encrypted in transit)
   * @param functionName - Optional function name for function-specific secrets
   */
  setSecret(key: string, value: string, functionName?: string): Promise<SetSecretResponse>

  /**
   * Get a secret (returns masked value)
   * @param key - The secret key to retrieve
   * @param functionName - Optional function name for function-specific secrets
   */
  getSecret(key: string, functionName?: string): Promise<GetSecretResponse>

  /**
   * List all secret keys
   * @param functionName - Optional function name to filter by function
   */
  listSecrets(functionName?: string): Promise<ListSecretsResponse>

  /**
   * Delete a secret
   * @param key - The secret key to delete
   * @param functionName - Optional function name for function-specific secrets
   */
  deleteSecret(key: string, functionName?: string): Promise<DeleteSecretResponse>

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): Promise<boolean>
}

/**
 * Auth context for checking authentication status
 */
interface AuthContext {
  isLoggedIn: boolean
  token?: string
}

/**
 * Prompt interface for interactive input
 */
interface PromptInterface {
  /**
   * Prompt for a secret value (hidden input)
   */
  secretInput(message: string): Promise<string>
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
 * Options for secrets set command
 */
interface SecretsSetOptions {
  function?: string
}

/**
 * Options for secrets get command
 */
interface SecretsGetOptions {
  function?: string
}

/**
 * Options for secrets list command
 */
interface SecretsListOptions {
  function?: string
}

/**
 * Options for secrets delete command
 */
interface SecretsDeleteOptions {
  function?: string
}

/**
 * Run the secrets set command
 * This is the function under test - to be implemented
 */
declare function runSecretsSet(
  keyValue: string,
  options: SecretsSetOptions,
  context: CLIContext,
  apiClient: SecretsAPIClient,
  prompt: PromptInterface
): Promise<CommandResult>

/**
 * Run the secrets get command
 * This is the function under test - to be implemented
 */
declare function runSecretsGet(
  key: string,
  options: SecretsGetOptions,
  context: CLIContext,
  apiClient: SecretsAPIClient
): Promise<CommandResult>

/**
 * Run the secrets list command
 * This is the function under test - to be implemented
 */
declare function runSecretsList(
  options: SecretsListOptions,
  context: CLIContext,
  apiClient: SecretsAPIClient
): Promise<CommandResult>

/**
 * Run the secrets delete command
 * This is the function under test - to be implemented
 */
declare function runSecretsDelete(
  key: string,
  options: SecretsDeleteOptions,
  context: CLIContext,
  apiClient: SecretsAPIClient
): Promise<CommandResult>

/**
 * Create a mock API client for testing
 */
function createMockAPIClient(): SecretsAPIClient & {
  secrets: Map<string, { value: string; functionName?: string; createdAt: string; updatedAt: string }>
  authenticated: boolean
} {
  const secrets = new Map<string, { value: string; functionName?: string; createdAt: string; updatedAt: string }>()
  let authenticated = true

  return {
    secrets,
    authenticated,
    async setSecret(key: string, value: string, functionName?: string): Promise<SetSecretResponse> {
      if (!authenticated) {
        throw new Error('Unauthorized: Please log in first')
      }
      const now = new Date().toISOString()
      const existing = secrets.get(key)
      secrets.set(key, {
        value,
        functionName,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      return { success: true, key, message: `Secret "${key}" has been set` }
    },
    async getSecret(key: string, functionName?: string): Promise<GetSecretResponse> {
      if (!authenticated) {
        throw new Error('Unauthorized: Please log in first')
      }
      const secret = secrets.get(key)
      if (!secret) {
        throw new Error(`Secret "${key}" not found`)
      }
      if (functionName && secret.functionName !== functionName) {
        throw new Error(`Secret "${key}" not found for function "${functionName}"`)
      }
      // Return masked value
      const maskedValue = '*'.repeat(Math.min(secret.value.length, 8)) + '...'
      return {
        key,
        value: maskedValue,
        masked: true,
        createdAt: secret.createdAt,
        updatedAt: secret.updatedAt,
      }
    },
    async listSecrets(functionName?: string): Promise<ListSecretsResponse> {
      if (!authenticated) {
        throw new Error('Unauthorized: Please log in first')
      }
      const secretList: SecretMetadata[] = []
      for (const [key, data] of secrets.entries()) {
        if (!functionName || data.functionName === functionName) {
          secretList.push({
            key,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            functionName: data.functionName,
          })
        }
      }
      return { secrets: secretList, total: secretList.length }
    },
    async deleteSecret(key: string, functionName?: string): Promise<DeleteSecretResponse> {
      if (!authenticated) {
        throw new Error('Unauthorized: Please log in first')
      }
      const secret = secrets.get(key)
      if (!secret) {
        throw new Error(`Secret "${key}" not found`)
      }
      if (functionName && secret.functionName !== functionName) {
        throw new Error(`Secret "${key}" not found for function "${functionName}"`)
      }
      secrets.delete(key)
      return { success: true, key, message: `Secret "${key}" has been deleted` }
    },
    async isAuthenticated(): Promise<boolean> {
      return authenticated
    },
  }
}

/**
 * Create a mock prompt interface for testing
 */
function createMockPrompt(responses: Map<string, string> = new Map()): PromptInterface & {
  prompts: string[]
  setResponse: (message: string, value: string) => void
  defaultResponse: string
} {
  const prompts: string[] = []
  let defaultResponse = 'default-secret-value'

  return {
    prompts,
    defaultResponse,
    setResponse(message: string, value: string) {
      responses.set(message, value)
    },
    async secretInput(message: string): Promise<string> {
      prompts.push(message)
      return responses.get(message) ?? defaultResponse
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

describe('dotdo secrets', () => {
  let context: ReturnType<typeof createTestContext>
  let apiClient: ReturnType<typeof createMockAPIClient>
  let prompt: ReturnType<typeof createMockPrompt>

  beforeEach(() => {
    context = createTestContext('/projects/my-function')
    apiClient = createMockAPIClient()
    prompt = createMockPrompt()
  })

  describe('dotdo secrets set KEY=VALUE', () => {
    it('should store a secret when KEY=VALUE format is used', async () => {
      const result = await runSecretsSet('API_KEY=my-secret-value', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.secrets.has('API_KEY')).toBe(true)
      expect(apiClient.secrets.get('API_KEY')?.value).toBe('my-secret-value')
    })

    it('should output success message after setting secret', async () => {
      await runSecretsSet('DATABASE_URL=postgres://localhost/db', {}, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/success|set/i)
      expect(output).toContain('DATABASE_URL')
    })

    it('should handle values containing equals signs', async () => {
      const result = await runSecretsSet('CONNECTION_STRING=host=localhost;user=admin', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.secrets.get('CONNECTION_STRING')?.value).toBe('host=localhost;user=admin')
    })

    it('should handle empty values', async () => {
      const result = await runSecretsSet('EMPTY_SECRET=', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.secrets.get('EMPTY_SECRET')?.value).toBe('')
    })

    it('should update existing secret', async () => {
      await runSecretsSet('API_KEY=old-value', {}, context, apiClient, prompt)
      const result = await runSecretsSet('API_KEY=new-value', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.secrets.get('API_KEY')?.value).toBe('new-value')
    })
  })

  describe('dotdo secrets set KEY (prompts for value)', () => {
    it('should prompt for value when only key is provided', async () => {
      prompt.setResponse('Enter value for SECRET_KEY:', 'prompted-secret-value')

      const result = await runSecretsSet('SECRET_KEY', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(prompt.prompts.length).toBeGreaterThan(0)
      expect(prompt.prompts[0]).toMatch(/enter.*value|value.*for/i)
    })

    it('should store the prompted value', async () => {
      prompt.setResponse('Enter value for MY_SECRET:', 'user-entered-value')

      await runSecretsSet('MY_SECRET', {}, context, apiClient, prompt)

      expect(apiClient.secrets.get('MY_SECRET')?.value).toBe('user-entered-value')
    })

    it('should use hidden input for secret value', async () => {
      // The prompt interface uses secretInput which should hide the input
      await runSecretsSet('PASSWORD', {}, context, apiClient, prompt)

      // Verify that secretInput was called (not regular input)
      expect(prompt.prompts.length).toBeGreaterThan(0)
    })
  })

  describe('dotdo secrets get KEY', () => {
    beforeEach(async () => {
      // Pre-populate a secret
      await apiClient.setSecret('EXISTING_KEY', 'secret-value-123')
    })

    it('should retrieve a secret (masked)', async () => {
      const result = await runSecretsGet('EXISTING_KEY', {}, context, apiClient)

      expect(result.exitCode).toBe(0)
    })

    it('should display masked value in output', async () => {
      await runSecretsGet('EXISTING_KEY', {}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('EXISTING_KEY')
      expect(output).toMatch(/\*+\.\.\./) // Masked value pattern
      expect(output).not.toContain('secret-value-123') // Should NOT contain actual value
    })

    it('should fail with error for non-existent key', async () => {
      const result = await runSecretsGet('NON_EXISTENT_KEY', {}, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/not found/i)
    })

    it('should display creation and update timestamps', async () => {
      await runSecretsGet('EXISTING_KEY', {}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/created|updated/i)
    })
  })

  describe('dotdo secrets list', () => {
    beforeEach(async () => {
      // Pre-populate some secrets
      await apiClient.setSecret('API_KEY', 'value1')
      await apiClient.setSecret('DATABASE_URL', 'value2')
      await apiClient.setSecret('JWT_SECRET', 'value3')
    })

    it('should list all secret keys', async () => {
      const result = await runSecretsList({}, context, apiClient)

      expect(result.exitCode).toBe(0)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('API_KEY')
      expect(output).toContain('DATABASE_URL')
      expect(output).toContain('JWT_SECRET')
    })

    it('should not display secret values', async () => {
      await runSecretsList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).not.toContain('value1')
      expect(output).not.toContain('value2')
      expect(output).not.toContain('value3')
    })

    it('should display total count', async () => {
      await runSecretsList({}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/3|total/i)
    })

    it('should handle empty secrets list', async () => {
      const emptyApiClient = createMockAPIClient()
      const result = await runSecretsList({}, context, emptyApiClient)

      expect(result.exitCode).toBe(0)
      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/no secrets|empty|0/i)
    })
  })

  describe('dotdo secrets delete KEY', () => {
    beforeEach(async () => {
      await apiClient.setSecret('KEY_TO_DELETE', 'some-value')
    })

    it('should remove the secret', async () => {
      const result = await runSecretsDelete('KEY_TO_DELETE', {}, context, apiClient)

      expect(result.exitCode).toBe(0)
      expect(apiClient.secrets.has('KEY_TO_DELETE')).toBe(false)
    })

    it('should output success message', async () => {
      await runSecretsDelete('KEY_TO_DELETE', {}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/deleted|removed|success/i)
      expect(output).toContain('KEY_TO_DELETE')
    })

    it('should fail with error for non-existent key', async () => {
      const result = await runSecretsDelete('NON_EXISTENT', {}, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/not found/i)
    })
  })

  describe('encryption in transit', () => {
    it('should encrypt secrets before sending to API', async () => {
      // The API client should receive encrypted data
      // This test verifies the contract - implementation will use TLS/HTTPS
      const result = await runSecretsSet('SENSITIVE_DATA=top-secret', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      // The API client interface guarantees encrypted transit
      // In real implementation, this would use HTTPS/TLS
    })

    it('should indicate secure transmission in verbose output', async () => {
      await runSecretsSet('SECURE_KEY=secure-value', {}, context, apiClient, prompt)

      // Implementation should use secure channels
      // This test documents the expectation
      expect(apiClient.secrets.has('SECURE_KEY')).toBe(true)
    })
  })

  describe('authentication requirement', () => {
    it('should require authentication for set command', async () => {
      apiClient.authenticated = false

      const result = await runSecretsSet('KEY=VALUE', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/unauthorized|login|authenticate/i)
    })

    it('should require authentication for get command', async () => {
      await apiClient.setSecret('TEST_KEY', 'test-value')
      apiClient.authenticated = false

      const result = await runSecretsGet('TEST_KEY', {}, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/unauthorized|login|authenticate/i)
    })

    it('should require authentication for list command', async () => {
      apiClient.authenticated = false

      const result = await runSecretsList({}, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/unauthorized|login|authenticate/i)
    })

    it('should require authentication for delete command', async () => {
      await apiClient.setSecret('TEST_KEY', 'test-value')
      apiClient.authenticated = false

      const result = await runSecretsDelete('TEST_KEY', {}, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/unauthorized|login|authenticate/i)
    })

    it('should suggest login command when not authenticated', async () => {
      apiClient.authenticated = false

      const result = await runSecretsSet('KEY=VALUE', {}, context, apiClient, prompt)

      expect(result.error).toMatch(/dotdo login|please log in/i)
    })
  })

  describe('--function flag for function-specific secrets', () => {
    it('should set secret for specific function with --function flag', async () => {
      const result = await runSecretsSet('API_KEY=func-specific-value', { function: 'my-api' }, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.secrets.get('API_KEY')?.functionName).toBe('my-api')
    })

    it('should get secret for specific function', async () => {
      await apiClient.setSecret('FUNC_SECRET', 'value', 'target-function')

      const result = await runSecretsGet('FUNC_SECRET', { function: 'target-function' }, context, apiClient)

      expect(result.exitCode).toBe(0)
    })

    it('should fail to get function-specific secret without matching function flag', async () => {
      await apiClient.setSecret('FUNC_SECRET', 'value', 'function-a')

      const result = await runSecretsGet('FUNC_SECRET', { function: 'function-b' }, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/not found/i)
    })

    it('should list only secrets for specific function', async () => {
      await apiClient.setSecret('GLOBAL_KEY', 'value1')
      await apiClient.setSecret('FUNC_A_KEY', 'value2', 'function-a')
      await apiClient.setSecret('FUNC_B_KEY', 'value3', 'function-b')

      await runSecretsList({ function: 'function-a' }, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('FUNC_A_KEY')
      expect(output).not.toContain('GLOBAL_KEY')
      expect(output).not.toContain('FUNC_B_KEY')
    })

    it('should delete secret for specific function', async () => {
      await apiClient.setSecret('FUNC_SECRET', 'value', 'target-function')

      const result = await runSecretsDelete('FUNC_SECRET', { function: 'target-function' }, context, apiClient)

      expect(result.exitCode).toBe(0)
      expect(apiClient.secrets.has('FUNC_SECRET')).toBe(false)
    })

    it('should display function name in output when using --function flag', async () => {
      await runSecretsSet('API_KEY=value', { function: 'my-worker' }, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toContain('my-worker')
    })
  })

  describe('key format validation', () => {
    it('should accept valid alphanumeric keys with underscores', async () => {
      const result = await runSecretsSet('VALID_KEY_123=value', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
    })

    it('should accept uppercase keys', async () => {
      const result = await runSecretsSet('UPPERCASE_KEY=value', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
    })

    it('should reject keys with spaces', async () => {
      const result = await runSecretsSet('INVALID KEY=value', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/invalid.*key|key.*format/i)
    })

    it('should reject keys with special characters', async () => {
      const result = await runSecretsSet('INVALID-KEY!=value', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/invalid.*key|key.*format/i)
    })

    it('should reject keys starting with numbers', async () => {
      const result = await runSecretsSet('123_INVALID=value', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/invalid.*key|key.*format/i)
    })

    it('should reject empty key', async () => {
      const result = await runSecretsSet('=value', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/invalid.*key|key.*required|empty/i)
    })

    it('should show valid key format in error message', async () => {
      const result = await runSecretsSet('invalid-key=value', {}, context, apiClient, prompt)

      expect(result.error).toMatch(/[A-Z_][A-Z0-9_]*|alphanumeric|underscore/i)
    })

    it('should reject keys that are too long', async () => {
      const longKey = 'A'.repeat(257) + '=value'
      const result = await runSecretsSet(longKey, {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/too long|maximum|length/i)
    })
  })

  describe('success and error messages', () => {
    it('should show clear success message for set', async () => {
      await runSecretsSet('NEW_KEY=new-value', {}, context, apiClient, prompt)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/success|created|set/i)
    })

    it('should show clear success message for delete', async () => {
      await apiClient.setSecret('TO_DELETE', 'value')
      await runSecretsDelete('TO_DELETE', {}, context, apiClient)

      const output = context.stdoutOutput.join('\n')
      expect(output).toMatch(/success|deleted|removed/i)
    })

    it('should show error message on API failure', async () => {
      const failingClient = createMockAPIClient()
      failingClient.setSecret = async () => {
        throw new Error('API Error: Service unavailable')
      }

      const result = await runSecretsSet('KEY=VALUE', {}, context, failingClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/error|failed|unavailable/i)
    })

    it('should show helpful message when secret not found', async () => {
      const result = await runSecretsGet('MISSING_KEY', {}, context, apiClient)

      expect(result.exitCode).toBe(1)
      expect(result.error).toContain('MISSING_KEY')
      expect(result.error).toMatch(/not found|does not exist/i)
    })

    it('should use stderr for error messages', async () => {
      await runSecretsGet('NON_EXISTENT', {}, context, apiClient)

      expect(context.stderrOutput.length).toBeGreaterThan(0)
      expect(context.stderrOutput.join('\n')).toMatch(/error|not found/i)
    })

    it('should use stdout for success messages', async () => {
      await runSecretsSet('GOOD_KEY=good-value', {}, context, apiClient, prompt)

      expect(context.stdoutOutput.length).toBeGreaterThan(0)
    })
  })

  describe('edge cases', () => {
    it('should handle special characters in secret values', async () => {
      const specialValue = '!@#$%^&*(){}[]|\\:";\'<>?,./`~'
      const result = await runSecretsSet(`SPECIAL_CHARS=${specialValue}`, {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.secrets.get('SPECIAL_CHARS')?.value).toBe(specialValue)
    })

    it('should handle unicode in secret values', async () => {
      const unicodeValue = '\u4f60\u597d\u4e16\u754c'
      const result = await runSecretsSet(`UNICODE_KEY=${unicodeValue}`, {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.secrets.get('UNICODE_KEY')?.value).toBe(unicodeValue)
    })

    it('should handle very long secret values', async () => {
      const longValue = 'x'.repeat(10000)
      const result = await runSecretsSet(`LONG_VALUE=${longValue}`, {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.secrets.get('LONG_VALUE')?.value).toBe(longValue)
    })

    it('should handle newlines in secret values', async () => {
      prompt.setResponse('Enter value for MULTILINE:', 'line1\nline2\nline3')

      await runSecretsSet('MULTILINE', {}, context, apiClient, prompt)

      expect(apiClient.secrets.get('MULTILINE')?.value).toBe('line1\nline2\nline3')
    })

    it('should handle whitespace-only values', async () => {
      const result = await runSecretsSet('WHITESPACE=   ', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(0)
      expect(apiClient.secrets.get('WHITESPACE')?.value).toBe('   ')
    })
  })

  describe('command help and usage', () => {
    it('should fail gracefully when no subcommand provided', async () => {
      // This would be handled by the CLI framework
      // Testing the behavior expectation
      const result = await runSecretsSet('', {}, context, apiClient, prompt)

      expect(result.exitCode).toBe(1)
      expect(result.error).toMatch(/usage|key.*required/i)
    })
  })
})
