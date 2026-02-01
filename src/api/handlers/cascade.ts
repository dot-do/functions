/**
 * Cascade Handler for Functions.do
 *
 * Handles cascade execution requests that escalate through the 4-tier function system:
 * - Tier 1: Code (5s timeout) - Fast, deterministic, cheap
 * - Tier 2: Generative (30s timeout) - Single AI call
 * - Tier 3: Agentic (5m timeout) - Multi-step AI
 * - Tier 4: Human (24h timeout) - Human-in-the-loop
 *
 * The cascade automatically escalates to the next tier on failure or timeout.
 *
 * @module handlers/cascade
 */

import type { RouteContext, Handler } from '../router'
import type { CascadeEnv } from './cascade-types'
import { KVFunctionRegistry } from '../../core/kv-function-registry'
import { KVCodeStorage } from '../../core/code-storage'
import { validateFunctionId } from '../../core/function-registry'
import { jsonResponse } from '../http-utils'
import { CascadeExecutor, createCascadeExecutor } from '../../core/cascade-executor'
import type {
  CascadeDefinition,
  CascadeTiers,
  CascadeOptions,
  CascadeResult,
  TierContext,
  TierAttempt,
  FunctionType,
} from '@dotdo/functions'
import { TierDispatcher, type ExtendedMetadata, type TierDispatcherEnv } from '../tier-dispatcher'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Cascade request body configuration
 */
export interface CascadeRequestBody {
  /** Input data to pass to the cascade */
  input?: unknown
  /** Cascade execution options */
  options?: CascadeRequestOptions
}

/**
 * Options for cascade execution from request
 */
export interface CascadeRequestOptions {
  /** Starting tier (default: 'code') */
  startTier?: FunctionType
  /** Tiers to skip */
  skipTiers?: FunctionType[]
  /** Per-tier timeouts in milliseconds */
  tierTimeouts?: {
    code?: number
    generative?: number
    agentic?: number
    human?: number
  }
  /** Total cascade timeout in milliseconds */
  totalTimeout?: number
  /** Enable parallel tier execution */
  enableParallel?: boolean
  /** Enable fallback mode (pass previous result to next tier) */
  enableFallback?: boolean
}

/**
 * Cascade response structure
 */
export interface CascadeResponse {
  /** Final output from the successful tier */
  output?: unknown
  /** The tier that produced the result */
  successTier?: FunctionType
  /** History of all tier attempts */
  history: Array<{
    tier: FunctionType
    attempt: number
    status: 'completed' | 'failed' | 'timeout' | 'skipped'
    result?: unknown
    error?: string
    durationMs: number
    timestamp: number
  }>
  /** Tiers that were skipped */
  skippedTiers: FunctionType[]
  /** Execution metrics */
  metrics: {
    totalDurationMs: number
    tierDurations: Partial<Record<FunctionType, number>>
    escalations: number
    totalRetries: number
  }
  /** Error message if cascade failed */
  error?: string
  /** Execution metadata */
  _meta: {
    cascadeId: string
    functionId: string
    executedAt: string
    tiersAttempted: FunctionType[]
  }
}

// =============================================================================
// HANDLER
// =============================================================================

/**
 * Cascade handler - executes functions through the tiered cascade system.
 *
 * POST /cascade/:id
 *
 * The handler:
 * 1. Validates the function ID and loads its definition
 * 2. Builds tier handlers from the function's tier definitions
 * 3. Executes the cascade with automatic escalation
 * 4. Returns the result with full execution history
 *
 * @example
 * // Request
 * POST /cascade/my-function
 * Content-Type: application/json
 * {
 *   "input": { "query": "What is 2+2?" },
 *   "options": {
 *     "startTier": "code",
 *     "skipTiers": [],
 *     "tierTimeouts": { "code": 5000, "generative": 30000 }
 *   }
 * }
 *
 * // Response
 * {
 *   "output": { "answer": 4 },
 *   "successTier": "code",
 *   "history": [
 *     { "tier": "code", "attempt": 1, "status": "completed", "durationMs": 12 }
 *   ],
 *   "skippedTiers": [],
 *   "metrics": { "totalDurationMs": 15, "escalations": 0 },
 *   "_meta": { "cascadeId": "...", "functionId": "my-function" }
 * }
 */
export const cascadeHandler: Handler = async (
  request: Request,
  env: CascadeEnv,
  ctx: ExecutionContext,
  context?: RouteContext
): Promise<Response> => {
  const functionId = context?.functionId || context?.params?.['id']
  const startedAt = Date.now()

  if (!functionId) {
    return jsonResponse({ error: 'Function ID required' }, 400)
  }

  // Validate function ID
  try {
    validateFunctionId(functionId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid function ID'
    return jsonResponse({ error: message }, 400)
  }

  // Parse request body
  let body: CascadeRequestBody = {}
  const contentType = request.headers.get('Content-Type')

  if (contentType?.includes('application/json')) {
    const bodyText = await request.text()
    if (bodyText.trim()) {
      try {
        body = JSON.parse(bodyText)
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400)
      }
    }
  }

  const input = body.input ?? {}
  const options = body.options ?? {}

  // Get function metadata
  const registry = new KVFunctionRegistry(env.FUNCTIONS_REGISTRY)
  const metadata = await registry.get(functionId) as ExtendedMetadata | null

  if (!metadata) {
    return jsonResponse({ error: `Function not found: ${functionId}` }, 404)
  }

  // Get function code for code tier
  const codeStorage = new KVCodeStorage(env.FUNCTIONS_CODE)
  const code = await codeStorage.get(functionId)

  // Generate cascade ID
  const cascadeId = `cascade_${functionId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  try {
    // Build cascade definition from function metadata
    const cascadeDefinition = buildCascadeDefinition(
      functionId,
      metadata,
      code || undefined,
      env,
      options
    )

    // Create and execute the cascade
    const executor = createCascadeExecutor(cascadeDefinition)

    const result = await executor.execute(input, {
      signal: undefined, // Could add AbortController support
    })

    // Build response
    const response: CascadeResponse = {
      output: result.output,
      successTier: result.successTier,
      history: result.history.map(attempt => ({
        tier: attempt.tier,
        attempt: attempt.attempt,
        status: attempt.status,
        result: attempt.result,
        error: attempt.error?.message,
        durationMs: attempt.durationMs,
        timestamp: attempt.timestamp,
      })),
      skippedTiers: result.skippedTiers,
      metrics: result.metrics,
      _meta: {
        cascadeId,
        functionId,
        executedAt: new Date(startedAt).toISOString(),
        tiersAttempted: result.history.map(h => h.tier),
      },
    }

    return jsonResponse(response, 200, {
      'X-Cascade-Id': cascadeId,
      'X-Success-Tier': result.successTier,
      'X-Execution-Time': String(result.metrics.totalDurationMs),
    })
  } catch (error) {
    const totalDurationMs = Date.now() - startedAt
    const message = error instanceof Error ? error.message : 'Cascade execution failed'

    // Extract history from CascadeExhaustedError if available
    let history: TierAttempt[] = []
    if (error instanceof Error && 'history' in error) {
      history = (error as Error & { history: TierAttempt[] }).history
    }

    const response: CascadeResponse = {
      history: history.map(attempt => ({
        tier: attempt.tier,
        attempt: attempt.attempt,
        status: attempt.status,
        result: attempt.result,
        error: attempt.error?.message,
        durationMs: attempt.durationMs,
        timestamp: attempt.timestamp,
      })),
      skippedTiers: [],
      metrics: {
        totalDurationMs,
        tierDurations: {},
        escalations: 0,
        totalRetries: 0,
      },
      error: message,
      _meta: {
        cascadeId,
        functionId,
        executedAt: new Date(startedAt).toISOString(),
        tiersAttempted: history.map(h => h.tier),
      },
    }

    // Determine appropriate status code
    const statusCode = message.includes('exhausted') ? 422 : 500

    return jsonResponse(response, statusCode, {
      'X-Cascade-Id': cascadeId,
      'X-Execution-Time': String(totalDurationMs),
    })
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Build a CascadeDefinition from function metadata and options
 */
function buildCascadeDefinition(
  functionId: string,
  metadata: ExtendedMetadata,
  code: string | undefined,
  env: CascadeEnv,
  requestOptions: CascadeRequestOptions
): CascadeDefinition<unknown, unknown> {
  // Build tier handlers based on available executors
  const tiers: CascadeTiers<unknown, unknown> = {}

  // Tier 1: Code handler
  if (code) {
    tiers.code = async (input: unknown, tierContext: TierContext) => {
      const dispatcher = createTierDispatcher(env)
      const result = await dispatcher.dispatch(
        { ...metadata, type: 'code' },
        input,
        code
      )

      if (result.status >= 400) {
        const error = new Error(result.body.error || 'Code execution failed')
        throw error
      }

      return result.body.output ?? result.body
    }
  }

  // Tier 2: Generative handler
  if (env.AI_CLIENT || metadata.type === 'generative') {
    tiers.generative = async (input: unknown, tierContext: TierContext) => {
      const dispatcher = createTierDispatcher(env)
      const result = await dispatcher.dispatch(
        { ...metadata, type: 'generative' },
        input
      )

      if (result.status >= 400) {
        const error = new Error(result.body.error || 'Generative execution failed')
        throw error
      }

      return result.body.output ?? result.body
    }
  }

  // Tier 3: Agentic handler
  if (env.AI_CLIENT || metadata.type === 'agentic') {
    tiers.agentic = async (input: unknown, tierContext: TierContext) => {
      const dispatcher = createTierDispatcher(env)
      const result = await dispatcher.dispatch(
        { ...metadata, type: 'agentic' },
        input
      )

      if (result.status >= 400) {
        const error = new Error(result.body.error || 'Agentic execution failed')
        throw error
      }

      return result.body.output ?? result.body
    }
  }

  // Tier 4: Human handler
  if (env.HUMAN_TASKS) {
    tiers.human = async (input: unknown, tierContext: TierContext) => {
      const dispatcher = createTierDispatcher(env)
      const result = await dispatcher.dispatch(
        { ...metadata, type: 'human' },
        input
      )

      if (result.status >= 400 && result.status !== 202) {
        const error = new Error(result.body.error || 'Human task creation failed')
        throw error
      }

      // Human tasks return 202 with task info
      return {
        taskId: result.body.taskId,
        taskUrl: result.body.taskUrl,
        taskStatus: result.body.taskStatus,
        pendingHumanReview: true,
      }
    }
  }

  // Build cascade options from request
  const cascadeOptions: CascadeOptions = {}

  if (requestOptions.startTier) {
    cascadeOptions.startTier = requestOptions.startTier
  }

  if (requestOptions.skipTiers && requestOptions.skipTiers.length > 0) {
    cascadeOptions.skipTiers = requestOptions.skipTiers
  }

  if (requestOptions.tierTimeouts) {
    cascadeOptions.tierTimeouts = {}
    if (requestOptions.tierTimeouts.code) {
      cascadeOptions.tierTimeouts.code = `${requestOptions.tierTimeouts.code}ms`
    }
    if (requestOptions.tierTimeouts.generative) {
      cascadeOptions.tierTimeouts.generative = `${requestOptions.tierTimeouts.generative}ms`
    }
    if (requestOptions.tierTimeouts.agentic) {
      cascadeOptions.tierTimeouts.agentic = `${requestOptions.tierTimeouts.agentic}ms`
    }
    if (requestOptions.tierTimeouts.human) {
      cascadeOptions.tierTimeouts.human = `${requestOptions.tierTimeouts.human}ms`
    }
  }

  if (requestOptions.totalTimeout) {
    cascadeOptions.totalTimeout = `${requestOptions.totalTimeout}ms`
  }

  if (requestOptions.enableParallel) {
    cascadeOptions.enableParallel = true
  }

  if (requestOptions.enableFallback) {
    cascadeOptions.enableFallback = true
  }

  return {
    id: `cascade-${functionId}`,
    name: `Cascade for ${functionId}`,
    description: `Tiered execution cascade for function ${functionId}`,
    tiers,
    options: cascadeOptions,
  }
}

/**
 * Create a TierDispatcher from the environment
 */
function createTierDispatcher(env: CascadeEnv): TierDispatcher {
  const dispatcherEnv: TierDispatcherEnv = {
    FUNCTIONS_REGISTRY: env.FUNCTIONS_REGISTRY,
    FUNCTIONS_CODE: env.FUNCTIONS_CODE,
    LOADER: env.LOADER,
    USER_FUNCTIONS: env.USER_FUNCTIONS,
    AI_CLIENT: env.AI_CLIENT,
    HUMAN_TASKS: env.HUMAN_TASKS,
    CODE_STORAGE: env.CODE_STORAGE,
  }
  return new TierDispatcher(dispatcherEnv)
}

export default cascadeHandler
