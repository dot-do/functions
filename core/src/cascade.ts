/**
 * Cascade Execution - Tiered escalation across function types
 *
 * Cascade execution automatically escalates through function tiers
 * when a tier fails or times out:
 *
 * 1. Code (5s) - Fast, deterministic, cheap
 * 2. Generative (30s) - Single AI call
 * 3. Agentic (5m) - Multi-step AI
 * 4. Human (24h) - Human-in-the-loop
 *
 * Each tier can:
 * - Succeed: Return result, cascade complete
 * - Fail: Escalate to next tier with context
 * - Timeout: Escalate to next tier
 * - Skip: Move to next tier (configured)
 */

import type {
  FunctionType,
  ExecutionContext,
  Duration,
} from './types.js'
import type { CodeFunctionDefinition } from './code/index.js'
import type { GenerativeFunctionDefinition } from './generative/index.js'
import type { AgenticFunctionDefinition } from './agentic/index.js'
import type { HumanFunctionDefinition } from './human/index.js'

// =============================================================================
// CASCADE DEFINITION
// =============================================================================

export interface CascadeDefinition<
  TInput = unknown,
  TOutput = unknown,
> {
  /** Unique cascade ID */
  id: string

  /** Human-readable name */
  name: string

  /** Description */
  description?: string

  /** Tier definitions */
  tiers: CascadeTiers<TInput, TOutput>

  /** Cascade options */
  options?: CascadeOptions
}

export interface CascadeTiers<TInput, TOutput> {
  code?: CodeFunctionDefinition<TInput, TOutput> | CodeTierHandler<TInput, TOutput>
  generative?: GenerativeFunctionDefinition<TInput, TOutput> | GenerativeTierHandler<TInput, TOutput>
  agentic?: AgenticFunctionDefinition<TInput, TOutput> | AgenticTierHandler<TInput, TOutput>
  human?: HumanFunctionDefinition<TInput, TOutput> | HumanTierHandler<TInput, TOutput>
}

// Tier handlers are simplified inline definitions
export type CodeTierHandler<TInput, TOutput> = (
  input: TInput,
  context: TierContext
) => Promise<TOutput>

export type GenerativeTierHandler<TInput, TOutput> = (
  input: TInput,
  context: TierContext
) => Promise<TOutput>

export type AgenticTierHandler<TInput, TOutput> = (
  input: TInput,
  context: TierContext
) => Promise<TOutput>

export type HumanTierHandler<TInput, TOutput> = (
  input: TInput,
  context: TierContext
) => Promise<TOutput>

// =============================================================================
// TIER CONTEXT
// =============================================================================

export interface TierContext {
  /** Current tier */
  tier: FunctionType

  /** Previous tier that failed (if any) */
  previousTier?: FunctionType

  /** Error from previous tier (if any) */
  previousError?: Error

  /** Result from previous tier (if partial) */
  previousResult?: unknown

  /** Attempt number within this tier */
  attempt: number

  /** Total cascade attempt */
  cascadeAttempt: number

  /** Time remaining before cascade timeout */
  timeRemainingMs: number
}

// =============================================================================
// CASCADE OPTIONS
// =============================================================================

export interface CascadeOptions {
  /** Starting tier (default: 'code') */
  startTier?: FunctionType

  /** Tiers to skip */
  skipTiers?: FunctionType[]

  /** Per-tier timeouts */
  tierTimeouts?: Partial<Record<FunctionType, Duration>>

  /** Total cascade timeout */
  totalTimeout?: Duration

  /** Enable tier fallback (pass previous result to next tier) */
  enableFallback?: boolean

  /** Retry policy per tier */
  tierRetries?: Partial<Record<FunctionType, number>>

  /** Conditions to skip tiers */
  skipConditions?: TierSkipCondition[]

  /** Parallel tier execution (if applicable) */
  enableParallel?: boolean
}

export interface TierSkipCondition {
  /** Tier to potentially skip */
  tier: FunctionType

  /** Condition to check */
  condition: (input: unknown, context: TierContext) => boolean | Promise<boolean>

  /** Reason for skip (for logging) */
  reason: string
}

// Default timeouts per tier
export const DEFAULT_TIER_TIMEOUTS = {
  code: '5s',
  generative: '30s',
  agentic: '5m',
  human: '24h',
} as const satisfies Record<FunctionType, Duration>

// Tier order for escalation
export const TIER_ORDER = ['code', 'generative', 'agentic', 'human'] as const satisfies readonly FunctionType[]

// =============================================================================
// CASCADE RESULT
// =============================================================================

export interface CascadeResult<TOutput = unknown> {
  /** Final output */
  output: TOutput

  /** Tier that produced the result */
  successTier: FunctionType

  /** Execution history */
  history: TierAttempt[]

  /** Tiers that were skipped */
  skippedTiers: FunctionType[]

  /** Metrics */
  metrics: CascadeMetrics
}

export interface TierAttempt {
  /** Tier */
  tier: FunctionType

  /** Attempt number */
  attempt: number

  /** Status */
  status: 'completed' | 'failed' | 'timeout' | 'skipped'

  /** Result (if completed) */
  result?: unknown

  /** Error (if failed) */
  error?: Error

  /** Duration in ms */
  durationMs: number

  /** Timestamp */
  timestamp: number
}

export interface CascadeMetrics {
  /** Total duration */
  totalDurationMs: number

  /** Per-tier durations */
  tierDurations: Partial<Record<FunctionType, number>>

  /** Number of escalations */
  escalations: number

  /** Total retries */
  totalRetries: number
}

// =============================================================================
// CASCADE EXECUTOR
// =============================================================================

export interface CascadeExecutor<TInput = unknown, TOutput = unknown> {
  /** Execute cascade */
  execute(
    input: TInput,
    context?: ExecutionContext
  ): Promise<CascadeResult<TOutput>>

  /** Execute specific tier */
  executeTier(
    tier: FunctionType,
    input: TInput,
    tierContext: TierContext
  ): Promise<TOutput>
}

// =============================================================================
// HELPER: Define a cascade
// =============================================================================

export function defineCascade<TInput, TOutput>(
  id: string,
  tiers: CascadeTiers<TInput, TOutput>,
  options?: CascadeOptions & { name?: string; description?: string }
): CascadeDefinition<TInput, TOutput> {
  const result: CascadeDefinition<TInput, TOutput> = {
    id,
    name: options?.name ?? id,
    tiers,
  }
  if (options?.description !== undefined) {
    result.description = options.description
  }
  if (options !== undefined) {
    result.options = options
  }
  return result
}

// =============================================================================
// HELPER: Quick cascade with inline handlers
// =============================================================================

export function cascade<TInput, TOutput>(
  id: string,
  handlers: {
    code?: (input: TInput) => Promise<TOutput>
    generative?: (input: TInput, context: TierContext) => Promise<TOutput>
    agentic?: (input: TInput, context: TierContext) => Promise<TOutput>
    human?: (input: TInput, context: TierContext) => Promise<TOutput>
  }
): CascadeDefinition<TInput, TOutput> {
  const tiers: CascadeTiers<TInput, TOutput> = {}

  if (handlers.code) {
    tiers.code = async (input, ctx) => handlers.code!(input)
  }
  if (handlers.generative) {
    tiers.generative = handlers.generative
  }
  if (handlers.agentic) {
    tiers.agentic = handlers.agentic
  }
  if (handlers.human) {
    tiers.human = handlers.human
  }

  return defineCascade(id, tiers)
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export class CascadeExhaustedError extends Error {
  constructor(
    message: string,
    public readonly history: TierAttempt[],
    public readonly totalDurationMs: number
  ) {
    super(message)
    this.name = 'CascadeExhaustedError'
  }
}

export class TierTimeoutError extends Error {
  constructor(
    public readonly tier: FunctionType,
    public readonly timeoutMs: number
  ) {
    super(`Tier '${tier}' timed out after ${timeoutMs}ms`)
    this.name = 'TierTimeoutError'
  }
}

export class TierSkippedError extends Error {
  constructor(
    public readonly tier: FunctionType,
    public readonly reason: string
  ) {
    super(`Tier '${tier}' skipped: ${reason}`)
    this.name = 'TierSkippedError'
  }
}

// =============================================================================
// CASCADE EXECUTOR IMPLEMENTATION
// =============================================================================

import { parseDuration } from './types.js'

/**
 * Create a cascade executor from a cascade definition.
 *
 * The executor automatically escalates through tiers based on:
 * - Timeout: When a tier exceeds its time limit
 * - Failure: When a tier throws an error
 * - Skip conditions: When configured conditions are met
 *
 * @param definition - The cascade definition
 * @returns An executor that can run the cascade
 */
export function createCascadeExecutor<TInput, TOutput>(
  definition: CascadeDefinition<TInput, TOutput>
): CascadeExecutor<TInput, TOutput> {
  const { tiers, options } = definition

  /**
   * Get the tier handler for a given tier type.
   * Returns undefined if the tier has no handler defined.
   */
  const getTierHandler = (tier: FunctionType): ((input: TInput, context: TierContext) => Promise<TOutput>) | undefined => {
    const tierDef = tiers[tier]
    if (!tierDef) return undefined

    // If it's a function (handler), return it directly
    if (typeof tierDef === 'function') {
      return tierDef as (input: TInput, context: TierContext) => Promise<TOutput>
    }

    // If it's a definition object, we don't have an executor yet
    // In a real implementation, this would look up the executor from a registry
    // For now, return undefined to skip these tiers
    return undefined
  }

  /** Get timeout for a tier in milliseconds */
  const getTierTimeout = (tier: FunctionType): number => {
    const customTimeout = options?.tierTimeouts?.[tier]
    if (customTimeout !== undefined) {
      return parseDuration(customTimeout)
    }
    return parseDuration(DEFAULT_TIER_TIMEOUTS[tier])
  }

  /** Get the number of retries for a tier */
  const getTierRetries = (tier: FunctionType): number => {
    return options?.tierRetries?.[tier] ?? 1
  }

  /** Check if a tier should be skipped */
  const shouldSkipTier = async (
    tier: FunctionType,
    input: TInput,
    context: TierContext
  ): Promise<{ skip: boolean; reason?: string }> => {
    // Check if tier is in skipTiers list
    if (options?.skipTiers?.includes(tier)) {
      return { skip: true, reason: 'Listed in skipTiers' }
    }

    // Check skip conditions
    const skipConditions = options?.skipConditions ?? []
    for (const condition of skipConditions) {
      if (condition.tier === tier) {
        const shouldSkip = await Promise.resolve(condition.condition(input, context))
        if (shouldSkip) {
          return { skip: true, reason: condition.reason }
        }
      }
    }

    return { skip: false }
  }

  /** Execute a tier with timeout */
  const executeTierWithTimeout = async (
    tier: FunctionType,
    input: TInput,
    context: TierContext,
    timeoutMs: number
  ): Promise<TOutput> => {
    const handler = getTierHandler(tier)
    if (!handler) {
      throw new Error(`No handler found for tier: ${tier}`)
    }

    return new Promise<TOutput>((resolve, reject) => {
      let settled = false
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new TierTimeoutError(tier, timeoutMs))
        }
      }, timeoutMs)

      handler(input, context)
        .then((result) => {
          if (!settled) {
            settled = true
            clearTimeout(timeoutId)
            resolve(result)
          }
        })
        .catch((error) => {
          if (!settled) {
            settled = true
            clearTimeout(timeoutId)
            reject(error)
          }
        })
    })
  }

  /** Get the next tier in the escalation order */
  const getNextTier = (currentTier: FunctionType): FunctionType | undefined => {
    const currentIndex = TIER_ORDER.indexOf(currentTier)
    if (currentIndex === -1 || currentIndex >= TIER_ORDER.length - 1) {
      return undefined
    }
    return TIER_ORDER[currentIndex + 1]
  }

  /** Get available tiers starting from a given tier */
  const getAvailableTiers = (startTier: FunctionType): FunctionType[] => {
    const startIndex = TIER_ORDER.indexOf(startTier)
    if (startIndex === -1) return []

    return TIER_ORDER.slice(startIndex).filter((tier) => {
      // Check if tier has a handler or definition
      return tiers[tier] !== undefined
    })
  }

  /** Main execute function */
  const execute = async (
    input: TInput,
    executionContext?: ExecutionContext
  ): Promise<CascadeResult<TOutput>> => {
    const startTime = Date.now()
    const history: TierAttempt[] = []
    const skippedTiers: FunctionType[] = []
    const tierDurations: Partial<Record<FunctionType, number>> = {}
    let escalations = 0
    let totalRetries = 0

    const startTier = options?.startTier ?? 'code'
    const availableTiers = getAvailableTiers(startTier)

    if (availableTiers.length === 0) {
      throw new CascadeExhaustedError(
        'No available tiers in cascade',
        history,
        Date.now() - startTime
      )
    }

    let previousTier: FunctionType | undefined
    let previousError: Error | undefined
    let previousResult: unknown

    let cascadeAttempt = 0

    for (const tier of availableTiers) {
      cascadeAttempt++

      // Build tier context
      const tierContext: TierContext = {
        tier,
        ...(previousTier !== undefined && { previousTier }),
        ...(previousError !== undefined && { previousError }),
        ...(options?.enableFallback && previousResult !== undefined && { previousResult }),
        attempt: 1,
        cascadeAttempt,
        timeRemainingMs: Date.now() - startTime, // Simplified - would need total timeout
      }

      // Check if tier should be skipped
      const skipResult = await shouldSkipTier(tier, input, tierContext)
      if (skipResult.skip) {
        skippedTiers.push(tier)
        history.push({
          tier,
          attempt: 0,
          status: 'skipped',
          durationMs: 0,
          timestamp: Date.now(),
        })
        if (previousTier !== undefined) {
          escalations++
        }
        previousTier = tier
        continue
      }

      // Check if tier has a handler
      const handler = getTierHandler(tier)
      if (!handler) {
        skippedTiers.push(tier)
        continue
      }

      const maxRetries = getTierRetries(tier)
      const timeoutMs = getTierTimeout(tier)
      let lastError: Error | undefined

      // Retry loop for this tier
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const attemptStartTime = Date.now()
        tierContext.attempt = attempt

        try {
          const result = await executeTierWithTimeout(
            tier,
            input,
            tierContext,
            timeoutMs
          )

          const durationMs = Date.now() - attemptStartTime
          tierDurations[tier] = (tierDurations[tier] ?? 0) + durationMs

          history.push({
            tier,
            attempt,
            status: 'completed',
            result,
            durationMs,
            timestamp: attemptStartTime,
          })

          // Success! Return the result
          return {
            output: result,
            successTier: tier,
            history,
            skippedTiers,
            metrics: {
              totalDurationMs: Date.now() - startTime,
              tierDurations,
              escalations,
              totalRetries,
            },
          }
        } catch (error) {
          const durationMs = Date.now() - attemptStartTime
          tierDurations[tier] = (tierDurations[tier] ?? 0) + durationMs
          lastError = error as Error

          const isTimeout = error instanceof TierTimeoutError
          const status: TierAttempt['status'] = isTimeout ? 'timeout' : 'failed'

          history.push({
            tier,
            attempt,
            status,
            error: lastError,
            durationMs,
            timestamp: attemptStartTime,
          })

          // If we have more retries, count this as a retry
          if (attempt < maxRetries) {
            totalRetries++
          }

          // Extract partial result if available (for fallback)
          if ((error as Record<string, unknown>)?.partialResult !== undefined) {
            previousResult = (error as Record<string, unknown>).partialResult
          }
        }
      }

      // All retries exhausted for this tier, escalate to next
      previousTier = tier
      previousError = lastError

      // Check if there's a next tier
      const nextTier = getNextTier(tier)
      if (nextTier && tiers[nextTier] !== undefined) {
        escalations++
      }
    }

    // All tiers exhausted
    throw new CascadeExhaustedError(
      `All tiers exhausted in cascade '${definition.id}'`,
      history,
      Date.now() - startTime
    )
  }

  /** Execute a specific tier directly */
  const executeTier = async (
    tier: FunctionType,
    input: TInput,
    tierContext: TierContext
  ): Promise<TOutput> => {
    const handler = getTierHandler(tier)
    if (!handler) {
      throw new Error(`No handler found for tier: ${tier}`)
    }
    return handler(input, tierContext)
  }

  return {
    execute,
    executeTier,
  }
}
