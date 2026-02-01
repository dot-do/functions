import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  getAuthHeaders,
  getAuthStrategy,
  isOAuthConfigured,
  validateAuth,
  clearTokenCache,
  type AuthStrategy,
} from './auth'

/**
 * E2E Test Configuration
 *
 * Configuration for live deployment tests against functions.do
 *
 * Authentication:
 * - OAuth.do: Set OAUTH_DO_CLIENT_ID and OAUTH_DO_CLIENT_SECRET for M2M auth
 * - OAuth.do: Set OAUTH_DO_ACCESS_TOKEN for pre-existing token
 * - API Key: Set FUNCTIONS_API_KEY as fallback
 */

export const E2E_CONFIG = {
  /** Base URL for the functions.do API */
  baseUrl: process.env.FUNCTIONS_E2E_URL || 'https://functions-do.dotdo.workers.dev',

  /** API key for authenticated requests (legacy, prefer oauth.do) */
  apiKey: process.env.FUNCTIONS_API_KEY,

  /** Whether oauth.do is configured */
  oauthConfigured: isOAuthConfigured(),

  /** Current authentication strategy */
  authStrategy: getAuthStrategy(),

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
 * Check if authenticated E2E tests should run
 * These require either OAuth or API key authentication
 */
export function shouldRunAuthenticatedE2E(): boolean {
  return E2E_CONFIG.authStrategy !== 'none'
}

/**
 * Get authentication headers for E2E requests
 * Uses oauth.do if configured, otherwise falls back to API key
 */
export async function getE2EAuthHeaders(): Promise<Record<string, string>> {
  return getAuthHeaders()
}

/**
 * Validate E2E authentication is working
 */
export async function validateE2EAuth(): Promise<boolean> {
  return validateAuth(E2E_CONFIG.baseUrl)
}

/**
 * Clear authentication token cache
 */
export function clearE2EAuthCache(): void {
  clearTokenCache()
}

// Re-export auth types and functions for convenience
export { getAuthStrategy, isOAuthConfigured, type AuthStrategy }

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
  const authHeaders = await getE2EAuthHeaders()

  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/functions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
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
  const authHeaders = await getE2EAuthHeaders()

  const response = await fetch(`${E2E_CONFIG.baseUrl}/functions/${functionId}/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
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
  const authHeaders = await getE2EAuthHeaders()

  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/functions/${functionId}`, {
    method: 'DELETE',
    headers: {
      ...authHeaders,
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
  const authHeaders = await getE2EAuthHeaders()
  const params = new URLSearchParams()
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.since) params.set('since', options.since)

  const response = await fetch(
    `${E2E_CONFIG.baseUrl}/api/functions/${functionId}/logs?${params}`,
    {
      headers: {
        ...authHeaders,
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
 * Deploy a function to functions.do AND optionally upload to dispatch namespace.
 * This combines the API deploy with wrangler dispatch upload for full functionality.
 *
 * Note: The worker_loaders path allows function execution without dispatch namespace upload.
 * Dispatch namespace upload is skipped if CLOUDFLARE_API_TOKEN is not set.
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

  // Upload to dispatch namespace only if Cloudflare API credentials are available
  // The worker_loaders path works without dispatch namespace upload
  if (process.env.CLOUDFLARE_API_TOKEN) {
    try {
      await uploadToDispatchNamespace(params.id, params.code, params.language)
    } catch (error) {
      // Log but don't fail - worker_loaders path will still work
      console.warn(`Dispatch namespace upload failed (worker_loaders will be used): ${error}`)
    }
  }

  // Wait for KV propagation before returning
  // Cloudflare KV has eventual consistency, so we need to wait a bit
  // for the code to be available across all edge locations
  await new Promise(resolve => setTimeout(resolve, 2000))

  return result
}
