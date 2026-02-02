/**
 * Unified Environment Type for Functions.do
 *
 * This is the single source of truth for all Cloudflare Worker bindings.
 * All handlers, dispatchers, and Durable Objects should import Env from here.
 *
 * Bindings are derived from wrangler.jsonc and include:
 * - KV Namespaces (deprecated, migrating to UserStorage DO)
 * - Durable Objects (FunctionExecutor, FunctionLogs, RateLimiter, UserStorage)
 * - Service Bindings (FSX, BASHX, TEST, ESBUILD_COMPILER, OAUTH)
 * - Worker Loaders (LOADER)
 * - Dispatch Namespaces (USER_FUNCTIONS)
 * - Static Assets (ASSETS)
 * - AI Bindings (AI, AI_CLIENT)
 * - Environment Variables
 *
 * @module core/env
 */

import type { RateLimiterDO } from '../do/rate-limiter'
import type { OAuthService } from './oauth'

// =============================================================================
// BINDING INTERFACES
// =============================================================================

/**
 * esbuild-compiler RPC interface for TypeScript compilation via Service Binding.
 * See: workers/esbuild-compiler/src/types.ts
 */
export interface EsbuildCompiler {
  transform(options: {
    code: string
    loader: 'ts' | 'tsx' | 'js' | 'jsx'
    target?: string
    format?: 'esm' | 'cjs' | 'iife'
    jsx?: { factory?: string; fragment?: string }
    sourcemap?: boolean
  }): Promise<{
    code: string
    map?: string
    warnings: string[]
    errors?: string[]
  }>
}

/**
 * Workers AI binding interface for function classification and AI execution
 */
export interface WorkersAI {
  run(model: string, input: unknown): Promise<unknown>
}

/**
 * AI client interface for generative/agentic execution
 */
export interface AIClient {
  messages?: {
    create(params: unknown): Promise<{
      content: Array<{ type: string; text: string }>
      usage?: { input_tokens: number; output_tokens: number }
      stop_reason?: string
      model?: string
    }>
  }
  chat?: (request: unknown) => Promise<{
    content: string
    toolCalls?: Array<{ name: string; input: unknown }>
    stopReason: string
    tokens: { inputTokens: number; outputTokens: number; totalTokens: number }
  }>
}

/**
 * OAuth.do service binding type alias
 */
export type OAuthServiceBinding = OAuthService

// =============================================================================
// UNIFIED ENV INTERFACE
// =============================================================================

/**
 * Unified environment bindings for the Functions.do Cloudflare Worker.
 *
 * This interface is the single source of truth for all environment bindings.
 * It includes all bindings from wrangler.jsonc plus runtime-injected bindings.
 *
 * All bindings are optional because:
 * 1. Not all bindings are available in all environments (dev, test, production)
 * 2. The test wrangler config only provides a subset of bindings
 * 3. Graceful degradation is preferred over hard failures
 */
export interface Env {
  // ===========================================================================
  // KV Namespaces (DEPRECATED - migrating to UserStorage DO)
  // ===========================================================================

  /**
   * @deprecated Use USER_STORAGE Durable Object instead.
   * KV namespace for function registry. Kept for backward compatibility during migration.
   * TODO: Remove after migration is complete (functions-yamv)
   */
  FUNCTIONS_REGISTRY?: KVNamespace

  /**
   * @deprecated Use USER_STORAGE Durable Object instead.
   * KV namespace for function code. Kept for backward compatibility during migration.
   * TODO: Remove after migration is complete (functions-yamv)
   */
  FUNCTIONS_CODE?: KVNamespace

  /** KV namespace for API keys */
  FUNCTIONS_API_KEYS?: KVNamespace

  // ===========================================================================
  // Durable Objects
  // ===========================================================================

  /** Durable Object namespace for function executor */
  FUNCTION_EXECUTOR?: DurableObjectNamespace

  /** Durable Object namespace for function logs */
  FUNCTION_LOGS?: DurableObjectNamespace

  /**
   * Rate Limiter Durable Object namespace.
   * Provides distributed rate limiting that persists across Worker isolates.
   * Replaces in-memory rate limiting which resets on each isolate.
   */
  RATE_LIMITER?: DurableObjectNamespace<RateLimiterDO>

  /**
   * Per-user storage Durable Object namespace.
   * Provides isolated storage for functions, code, and API keys.
   * Replaces KV-based storage with strong consistency and per-user isolation.
   */
  USER_STORAGE?: DurableObjectNamespace

  /** Durable Object for human task execution (cascade tier 4) */
  HUMAN_TASKS?: DurableObjectNamespace

  // ===========================================================================
  // Service Bindings
  // ===========================================================================

  /** FSX.do file system service binding */
  FSX?: Fetcher

  /** BASHX.do bash execution service binding */
  BASHX?: Fetcher

  /** Test service binding for ai-evaluate (from ai-tests Worker) */
  TEST?: unknown

  /** esbuild-wasm compiler service for TypeScript compilation */
  ESBUILD_COMPILER?: EsbuildCompiler

  /** OAuth.do service binding for user authentication */
  OAUTH?: OAuthServiceBinding

  // ===========================================================================
  // Worker Loaders
  // ===========================================================================

  /** Worker loader binding for sandboxed code execution (ai-evaluate) */
  LOADER?: unknown

  // ===========================================================================
  // Dispatch Namespaces
  // ===========================================================================

  /** Dispatch namespace for user-deployed functions (Workers for Platforms) */
  USER_FUNCTIONS?: unknown

  // ===========================================================================
  // Static Assets
  // ===========================================================================

  /** Static assets binding for WASM binaries */
  ASSETS?: Fetcher

  // ===========================================================================
  // AI Bindings
  // ===========================================================================

  /** Workers AI binding for function classification and generative/agentic execution */
  AI?: WorkersAI

  /** AI client for generative/agentic cascade tiers (legacy name, prefer AI) */
  AI_CLIENT?: AIClient

  // ===========================================================================
  // R2 Buckets
  // ===========================================================================

  /** R2 bucket for code storage */
  CODE_STORAGE?: R2Bucket

  // ===========================================================================
  // Environment Variables (from wrangler.jsonc vars)
  // ===========================================================================

  /** Current environment (e.g., 'production', 'staging') */
  ENVIRONMENT?: string

  /** Service name identifier */
  SERVICE_NAME?: string

  /** Cloudflare account ID for API calls */
  CLOUDFLARE_ACCOUNT_ID?: string

  /** Cloudflare API token for Workers API access */
  CLOUDFLARE_API_TOKEN?: string

  /** Dispatch namespace name for Workers for Platforms */
  DISPATCH_NAMESPACE?: string

  /** Comma-separated list of additional public endpoints */
  PUBLIC_ENDPOINTS?: string
}
