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
// CASCADE EXECUTOR - Re-exported from main implementation
// =============================================================================

// The createCascadeExecutor function is implemented in src/core/cascade-executor.ts
// which provides a more complete implementation with:
// - AbortSignal support
// - Parallel execution mode
// - Better encapsulation via CascadeExecutor class
//
// This re-export maintains backward compatibility for consumers of this module.
export { createCascadeExecutor } from '../../src/core/cascade-executor.js'
