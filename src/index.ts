/**
 * Functions.do - Multi-language serverless platform
 *
 * Main entry point for the Cloudflare Worker.
 * Uses the modular router from src/api/router.ts with handlers in src/api/handlers/.
 */

import { createRouter, Env as RouterEnv } from './api/router'
import type { RateLimitConfig } from './core/rate-limiter'

/**
 * Dispatch namespace binding for Workers for Platforms
 */
interface DispatchNamespace {
  get(scriptName: string, options?: { entrypoint?: string }): {
    fetch(request: Request): Promise<Response>
  }
}

/**
 * Environment bindings for the Worker
 *
 * Extends the router's Env with additional optional bindings.
 */
export interface Env extends RouterEnv {
  /** KV namespace for API keys (optional - if not set, auth is disabled) */
  FUNCTIONS_API_KEYS?: KVNamespace
  /** Static assets binding for WASM binaries */
  ASSETS?: Fetcher
  /** Comma-separated list of additional public endpoints */
  PUBLIC_ENDPOINTS?: string
  /** Durable Object namespace for function executor */
  FUNCTION_EXECUTOR?: DurableObjectNamespace
  /** Test service binding for ai-evaluate (from ai-tests Worker) */
  TEST?: unknown
  /** Dispatch namespace for user-deployed functions (Workers for Platforms fallback) */
  USER_FUNCTIONS?: DispatchNamespace
}

// Create the router instance (shared for rate limiting state)
const router = createRouter()

/**
 * Reset the rate limiter (useful for testing)
 */
export function resetRateLimiter(): void {
  router.resetRateLimit()
}

/**
 * Configure custom rate limits
 */
export function configureRateLimiter(config: {
  ip?: RateLimitConfig
  function?: RateLimitConfig
}): void {
  router.configureRateLimit(config)
}

// Export the default fetch handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return router.handle(request, env, ctx)
  },
}

// Re-export types and modules for consumers
export * from './core/types'
export * from './core/worker-loader'
export * from './core/auth'
export * from './core/rate-limiter'
export * from './core/errors'
export { KVCodeStorage } from './core/code-storage'
export type { CodeStorage } from './core/function-loader'

// Re-export OAuth types and utilities
export {
  OAuthClient,
  extractBearerToken,
  checkFunctionPermission,
  hasScope,
  FUNCTION_SCOPES,
  type OAuthService,
  type TokenInfo,
  type UserInfo,
  type Organization,
  type OrganizationMembership,
  type PermissionResult,
  type OAuthContext,
  type FunctionPermissions,
} from './core/oauth'

// Re-export TypeScript compiler for consumers
export {
  compileTypeScript,
  needsFullCompilation,
  stripTypeScriptSync,
  type EsbuildCompiler,
  type CompileResult,
  type CompileOptions,
} from './core/ts-compiler'

// Re-export template literals for inline function definitions
export {
  typescript,
  javascript,
  rust,
  go,
  python,
  csharp,
  zig,
  assemblyscript,
  type InlineFunction,
  type CompiledFunction,
  type DeployedFunction,
  type DeployOptions,
} from './template-literals'

// Export Durable Objects for Worker binding
export { FunctionExecutor } from './do/function-executor'
export { FunctionLogs } from './do/function-logs'
export { RateLimiterDO } from './do/rate-limiter'

// Export router types for consumers who want to extend routing
export type { Handler, Middleware, Router, RouteContext } from './api/router'
export { createRouter } from './api/router'
