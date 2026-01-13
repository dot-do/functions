import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * E2E Test Configuration
 *
 * Configuration for live deployment tests against functions.do
 */

export const E2E_CONFIG = {
  /** Base URL for the functions.do API */
  baseUrl: process.env.FUNCTIONS_E2E_URL || 'https://functions-do.dotdo.workers.dev',

  /** API key for authenticated requests (added later with oauth.do) */
  apiKey: process.env.FUNCTIONS_API_KEY,

  /** Timeout for deployment operations (ms) - includes wrangler dispatch upload */
  deployTimeout: 60_000,

  /** Timeout for function invocation (ms) */
  invokeTimeout: 10_000,

  /** Timeout for deploy + invoke operations (ms) */
  deployInvokeTimeout: 90_000,

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

/**
 * Upload a script to the dispatch namespace using wrangler CLI.
 * This is needed for Workers for Platforms to execute the function.
 */
export async function uploadToDispatchNamespace(
  functionId: string,
  code: string,
  language: 'typescript' | 'javascript'
): Promise<void> {
  // Create a temporary directory for the worker
  const tmpDir = mkdtempSync(join(tmpdir(), 'e2e-worker-'))

  try {
    // Determine file extension
    const ext = language === 'typescript' ? 'ts' : 'js'

    // Write the worker code
    writeFileSync(join(tmpDir, `index.${ext}`), code)

    // Write wrangler.jsonc
    writeFileSync(
      join(tmpDir, 'wrangler.jsonc'),
      JSON.stringify({
        name: functionId,
        main: `index.${ext}`,
        compatibility_date: '2025-01-01',
      })
    )

    // Write package.json
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: functionId,
        type: 'module',
      })
    )

    // Deploy using wrangler
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || 'b6641681fe423910342b9ffa1364c76d'
    const namespace = process.env.DISPATCH_NAMESPACE || 'dotdo-public'

    execSync(`npx wrangler deploy --dispatch-namespace=${namespace}`, {
      cwd: tmpDir,
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: accountId,
      },
      stdio: 'pipe',
    })
  } finally {
    // Clean up temporary directory
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

/**
 * Deploy a function to functions.do AND upload to dispatch namespace.
 * This combines the API deploy with wrangler dispatch upload for full functionality.
 */
export async function deployAndUploadFunction(params: {
  id: string
  code: string
  language: 'typescript' | 'javascript'
  version?: string
  entryPoint?: string
}): Promise<{
  id: string
  version: string
  url: string
}> {
  // First deploy via API (stores metadata and code in KV)
  const result = await deployFunction({
    ...params,
    language: params.language,
  })

  // Then upload to dispatch namespace for execution
  await uploadToDispatchNamespace(params.id, params.code, params.language)

  return result
}
