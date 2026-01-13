/**
 * E2E Test Configuration
 *
 * Configuration for live deployment tests against functions.do
 */

export const E2E_CONFIG = {
  /** Base URL for the functions.do API */
  baseUrl: process.env.FUNCTIONS_E2E_URL || 'https://functions.do',

  /** API key for authenticated requests (added later with oauth.do) */
  apiKey: process.env.FUNCTIONS_API_KEY,

  /** Timeout for deployment operations (ms) */
  deployTimeout: 30_000,

  /** Timeout for function invocation (ms) */
  invokeTimeout: 10_000,

  /** Prefix for test function IDs (for cleanup) */
  testPrefix: 'e2e-test-',

  /** Whether to skip cleanup after tests (for debugging) */
  skipCleanup: process.env.E2E_SKIP_CLEANUP === 'true',
}

/**
 * Generate a unique test function ID
 */
export function generateTestFunctionId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8)
  return `${E2E_CONFIG.testPrefix}${timestamp}-${random}`
}

/**
 * Check if e2e tests should run
 * Skip if no API endpoint is configured or in CI without credentials
 */
export function shouldRunE2E(): boolean {
  // For now, always try to run (no auth required initially)
  return true
}

/**
 * Deploy a function to functions.do
 */
export async function deployFunction(params: {
  id: string
  code: string
  language: 'typescript' | 'javascript' | 'rust' | 'go' | 'python' | 'zig' | 'assemblyscript' | 'csharp'
  version?: string
  entryPoint?: string
}): Promise<{
  id: string
  version: string
  url: string
}> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/functions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
    body: JSON.stringify({
      id: params.id,
      version: params.version || '1.0.0',
      language: params.language,
      code: params.code,
      entryPoint: params.entryPoint || 'index.ts',
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Deploy failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Invoke a deployed function
 */
export async function invokeFunction<T = unknown>(
  functionId: string,
  data?: unknown
): Promise<T> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/functions/${functionId}/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Invoke failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Delete a deployed function (cleanup)
 */
export async function deleteFunction(functionId: string): Promise<void> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/functions/${functionId}`, {
    method: 'DELETE',
    headers: {
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
  })

  if (!response.ok && response.status !== 404) {
    const error = await response.text()
    throw new Error(`Delete failed (${response.status}): ${error}`)
  }
}

/**
 * Get function logs
 */
export async function getFunctionLogs(
  functionId: string,
  options?: { limit?: number; since?: string }
): Promise<Array<{
  timestamp: string
  level: string
  message: string
}>> {
  const params = new URLSearchParams()
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.since) params.set('since', options.since)

  const response = await fetch(
    `${E2E_CONFIG.baseUrl}/api/functions/${functionId}/logs?${params}`,
    {
      headers: {
        ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
      },
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Get logs failed (${response.status}): ${error}`)
  }

  return response.json()
}
