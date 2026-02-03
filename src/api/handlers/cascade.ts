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
import { getStorageClientCompat } from './storage-compat'
import { validateFunctionId } from '../../core/function-registry'
import { getErrorMessage } from '../../core/errors'
import { jsonResponse, jsonErrorResponse } from '../http-utils'
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
import { TierDispatcher, type ExtendedMetadata, type TierDispatcherEnv, isExtendedMetadata } from '../tier-dispatcher'
import {
  FunctionClassifier,
  createClassifierFromBinding,
  type ClassificationResult,
  type ClassifierAIClient,
} from '../../core/function-classifier'
import type { AuthContext } from '../middleware/auth'

// =============================================================================
// TIER AUTHORIZATION SCOPES
// =============================================================================

/**
 * Required scopes for each tier.
 * Code tier (tier 1) is the default and doesn't require a special scope.
 * Higher tiers require explicit scope authorization.
 */
export const TIER_SCOPES: Record<FunctionType, string | null> = {
  code: null, // No special scope needed for code tier
  generative: 'functions:tier:generative',
  agentic: 'functions:tier:agentic',
  human: 'functions:tier:human',
}

/**
 * Check if auth context has required scope for a tier.
 * Returns true if:
 * - The tier doesn't require a special scope (code tier)
 * - The auth context has the wildcard scope '*'
 * - The auth context has the specific tier scope
 * - No auth context is provided (auth may be disabled)
 */
export function hasTierScope(authContext: AuthContext | undefined, tier: FunctionType): boolean {
  const requiredScope = TIER_SCOPES[tier]

  // Code tier doesn't require special scope
  if (!requiredScope) {
    return true
  }

  // If no auth context, we can't check scopes - allow through (auth may be disabled)
  // However, handlers should typically have auth context in production
  if (!authContext) {
    return true
  }

  // Check for wildcard scope
  if (authContext.scopes.includes('*')) {
    return true
  }

  // Check for specific tier scope
  return authContext.scopes.includes(requiredScope)
}

/**
 * Custom error for tier authorization failures
 */
export class TierAuthorizationError extends Error {
  tier: FunctionType
  requiredScope: string

  constructor(tier: FunctionType, requiredScope: string) {
    super(`Tier '${tier}' requires scope '${requiredScope}'`)
    this.name = 'TierAuthorizationError'
    this.tier = tier
    this.requiredScope = requiredScope
  }
}

/**
 * Type guard for errors that have TierAuthorizationError shape,
 * used when instanceof check may not work across module boundaries.
 */
function isTierAuthError(error: unknown): error is { tier: FunctionType; requiredScope: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'tier' in error &&
    'requiredScope' in error &&
    typeof (error as Record<string, unknown>)['tier'] === 'string' &&
    typeof (error as Record<string, unknown>)['requiredScope'] === 'string'
  )
}

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
  /** Starting tier (default: 'code'). Set to 'auto' for AI-based classification. */
  startTier?: FunctionType | 'auto'
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
// INPUT VALIDATION
// =============================================================================

/**
 * JSON Schema type for input validation (mirrors core JsonSchema)
 */
export interface InputJsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  properties?: Record<string, InputJsonSchema>
  items?: InputJsonSchema
  required?: string[]
  enum?: unknown[]
  description?: string
  default?: unknown
  [key: string]: unknown
}

/**
 * Result of input validation against a JSON Schema
 */
export interface InputValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validate input data against a JSON Schema definition.
 *
 * Performs fail-fast validation including:
 * - Type checking (object, array, string, number, boolean, null)
 * - Required field validation
 * - Enum value validation
 * - Nested object property validation
 * - Array item validation
 *
 * @param data - The input data to validate
 * @param schema - The JSON Schema to validate against
 * @param path - Current property path for error messages (used in recursion)
 * @returns Validation result with any errors found
 */
export function validateInput(
  data: unknown,
  schema: InputJsonSchema,
  path = ''
): InputValidationResult {
  const errors: string[] = []
  const prefix = path ? `${path}: ` : ''

  // Type validation
  if (schema.type) {
    const actualType = data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data
    if (schema.type !== actualType) {
      // Allow number coercion from string
      if (!(schema.type === 'number' && actualType === 'string' && !isNaN(Number(data)))) {
        errors.push(`${prefix}expected type '${schema.type}', got '${actualType}'`)
        // Fail fast on type mismatch - nested checks would be meaningless
        return { valid: false, errors }
      }
    }
  }

  // Required fields validation
  if (
    schema.type === 'object' &&
    schema.required &&
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data)
  ) {
    for (const field of schema.required) {
      if (!(field in (data as Record<string, unknown>))) {
        errors.push(`${prefix}missing required field '${field}'`)
      }
    }
  }

  // Property-level validation for objects
  if (schema.properties && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const record = data as Record<string, unknown>
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const value = record[key]
      if (value === undefined) continue

      // Enum validation
      if (propSchema.enum && !propSchema.enum.includes(value)) {
        errors.push(`${prefix}field '${key}' must be one of: ${propSchema.enum.join(', ')}`)
      }

      // Recursive validation for nested objects and arrays
      if (propSchema.type === 'object' || propSchema.type === 'array') {
        const nestedResult = validateInput(value, propSchema, path ? `${path}.${key}` : key)
        if (!nestedResult.valid) {
          errors.push(...nestedResult.errors)
        }
      }
    }
  }

  // Array items validation
  if (schema.type === 'array' && schema.items && Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      const itemResult = validateInput(data[i], schema.items, `${path}[${i}]`)
      if (!itemResult.valid) {
        errors.push(...itemResult.errors)
      }
    }
  }

  return { valid: errors.length === 0, errors }
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
    return jsonErrorResponse('MISSING_REQUIRED', 'Function ID required')
  }

  // Validate function ID
  try {
    validateFunctionId(functionId)
  } catch (error) {
    return jsonErrorResponse('INVALID_FUNCTION_ID', getErrorMessage(error, 'Invalid function ID'))
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
        return jsonErrorResponse('INVALID_JSON', 'Invalid JSON body')
      }
    }
  }

  const input = body.input ?? {}
  const options = body.options ?? {}

  // Get function metadata from UserStorage DO
  const userId = context?.authContext?.userId || 'anonymous'
  const storageClient = getStorageClientCompat(env, userId)
  const rawMetadata = await storageClient.registry.get(functionId)
  const metadata: ExtendedMetadata | null = rawMetadata && isExtendedMetadata(rawMetadata)
    ? rawMetadata
    : rawMetadata
    ? { ...rawMetadata }  // Wrap base FunctionMetadata as minimal ExtendedMetadata
    : null

  if (!metadata) {
    return jsonErrorResponse('FUNCTION_NOT_FOUND', `Function not found: ${functionId}`)
  }

  // Validate input against function's inputSchema (fail fast)
  if (metadata.inputSchema) {
    const validation = validateInput(input, metadata.inputSchema as InputJsonSchema)
    if (!validation.valid) {
      return jsonErrorResponse('VALIDATION_ERROR', 'Input validation failed', 400, {
        details: {
          validationErrors: validation.errors,
          functionId,
          schemaType: 'inputSchema',
        },
      })
    }
  }

  // Auto-classify the start tier if requested
  let classificationMeta: ClassificationResult | undefined
  if (options.startTier === 'auto' && env.AI_CLIENT) {
    const classifier = createClassifierFromBinding(env.AI_CLIENT as ClassifierAIClient)
    const description = metadata.userPrompt || metadata.goal || metadata.systemPrompt
    const result = await classifier.classify(
      functionId,
      description as string | undefined,
      metadata.inputSchema,
    )
    if (result.confidence >= 0.6) {
      options.startTier = result.type as FunctionType
    } else {
      options.startTier = 'code' // Default to code on low confidence
    }
    classificationMeta = result
  } else if (options.startTier === 'auto') {
    // No AI client available, fall back to heuristic
    const { classifyByHeuristic } = await import('../../core/function-classifier')
    const result = classifyByHeuristic(functionId, metadata.systemPrompt as string | undefined)
    if (result.confidence >= 0.6) {
      options.startTier = result.type as FunctionType
    } else {
      options.startTier = 'code'
    }
    classificationMeta = result
  }

  // Get function code for code tier
  const code = await storageClient.code.get(functionId)

  // Generate cascade ID
  const cascadeId = `cascade_${functionId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  // Get auth context from route context
  const authContext = context?.authContext

  // Pre-execution authorization check for requested start tier
  // This ensures we fail fast with 403 before any tier execution begins
  const startTier = (options.startTier && options.startTier !== 'auto')
    ? options.startTier as FunctionType
    : 'code'

  if (!hasTierScope(authContext, startTier)) {
    const requiredScope = TIER_SCOPES[startTier]!
    return jsonErrorResponse('FORBIDDEN', 'Insufficient permissions for tier escalation', 403, {
      details: {
        tier: startTier,
        requiredScope,
        cascadeId,
        functionId,
        executedAt: new Date(startedAt).toISOString(),
      },
      headers: {
        'X-Cascade-Id': cascadeId,
        'X-Execution-Time': String(Date.now() - startedAt),
      },
    })
  }

  try {
    // Build cascade definition from function metadata
    const cascadeDefinition = buildCascadeDefinition(
      functionId,
      metadata,
      code || undefined,
      env,
      options as CascadeRequestOptions & { startTier?: FunctionType },
      authContext
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
        ...(classificationMeta ? {
          autoClassified: true,
          classification: {
            type: classificationMeta.type,
            confidence: classificationMeta.confidence,
            reasoning: classificationMeta.reasoning,
          },
        } : {}),
      },
    }

    return jsonResponse(response, 200, {
      'X-Cascade-Id': cascadeId,
      'X-Success-Tier': result.successTier,
      'X-Execution-Time': String(result.metrics.totalDurationMs),
    })
  } catch (error) {
    const totalDurationMs = Date.now() - startedAt
    const message = getErrorMessage(error, 'Cascade execution failed')

    // Check for tier authorization error - return 403
    if (error instanceof TierAuthorizationError) {
      return jsonResponse(
        {
          error: 'Insufficient permissions for tier escalation',
          tier: error.tier,
          requiredScope: error.requiredScope,
          _meta: {
            cascadeId,
            functionId,
            executedAt: new Date(startedAt).toISOString(),
          },
        },
        403,
        {
          'X-Cascade-Id': cascadeId,
          'X-Execution-Time': String(totalDurationMs),
        }
      )
    }

    // Extract history from CascadeExhaustedError if available
    let history: TierAttempt[] = []
    if (error instanceof Error && 'history' in error) {
      history = (error as Error & { history: TierAttempt[] }).history
    }

    // Check if any tier attempt failed due to authorization
    // This handles escalation scenarios where TierAuthorizationError is wrapped
    for (const attempt of history) {
      if (attempt.error instanceof TierAuthorizationError) {
        const authError = attempt.error as TierAuthorizationError
        return jsonResponse(
          {
            error: 'Insufficient permissions for tier escalation',
            tier: authError.tier,
            requiredScope: authError.requiredScope,
            _meta: {
              cascadeId,
              functionId,
              executedAt: new Date(startedAt).toISOString(),
            },
          },
          403,
          {
            'X-Cascade-Id': cascadeId,
            'X-Execution-Time': String(totalDurationMs),
          }
        )
      }
      // Also check by error name in case instanceof doesn't work across modules
      if (attempt.error?.name === 'TierAuthorizationError' && isTierAuthError(attempt.error)) {
        return jsonResponse(
          {
            error: 'Insufficient permissions for tier escalation',
            tier: attempt.error.tier,
            requiredScope: attempt.error.requiredScope,
            _meta: {
              cascadeId,
              functionId,
              executedAt: new Date(startedAt).toISOString(),
            },
          },
          403,
          {
            'X-Cascade-Id': cascadeId,
            'X-Execution-Time': String(totalDurationMs),
          }
        )
      }
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
  requestOptions: CascadeRequestOptions,
  authContext?: AuthContext
): CascadeDefinition<unknown, unknown> {
  // Build tier handlers based on available executors
  const tiers: CascadeTiers<unknown, unknown> = {}

  // Tier 1: Code handler (no special scope required)
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

  // Tier 2: Generative handler (requires functions:tier:generative scope)
  if (env.AI_CLIENT || metadata.type === 'generative') {
    tiers.generative = async (input: unknown, tierContext: TierContext) => {
      // Authorization check for generative tier
      if (!hasTierScope(authContext, 'generative')) {
        throw new TierAuthorizationError('generative', TIER_SCOPES.generative!)
      }

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

  // Tier 3: Agentic handler (requires functions:tier:agentic scope)
  if (env.AI_CLIENT || metadata.type === 'agentic') {
    tiers.agentic = async (input: unknown, tierContext: TierContext) => {
      // Authorization check for agentic tier
      if (!hasTierScope(authContext, 'agentic')) {
        throw new TierAuthorizationError('agentic', TIER_SCOPES.agentic!)
      }

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

  // Tier 4: Human handler (requires functions:tier:human scope)
  if (env.HUMAN_TASKS) {
    tiers.human = async (input: unknown, tierContext: TierContext) => {
      // Authorization check for human tier
      if (!hasTierScope(authContext, 'human')) {
        throw new TierAuthorizationError('human', TIER_SCOPES.human!)
      }

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

  const tierTimeouts = requestOptions.tierTimeouts
    ? Object.fromEntries(
        (['code', 'generative', 'agentic', 'human'] as const)
          .filter(t => requestOptions.tierTimeouts?.[t])
          .map(t => [t, `${requestOptions.tierTimeouts![t]}ms`])
      )
    : undefined

  Object.assign(cascadeOptions, {
    ...(requestOptions.startTier && { startTier: requestOptions.startTier }),
    ...(requestOptions.skipTiers?.length && { skipTiers: requestOptions.skipTiers }),
    ...(tierTimeouts && Object.keys(tierTimeouts).length > 0 && { tierTimeouts }),
    ...(requestOptions.totalTimeout && { totalTimeout: `${requestOptions.totalTimeout}ms` }),
    ...(requestOptions.enableParallel && { enableParallel: true }),
    ...(requestOptions.enableFallback && { enableFallback: true }),
  })

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
  // CascadeEnv is now a type alias for the unified Env type
  return new TierDispatcher(env)
}

export default cascadeHandler
