/**
 * CascadeExecutor - Tiered execution with automatic escalation
 *
 * Executes cascades by trying tiers in order (code -> generative -> agentic -> human),
 * escalating to the next tier on failure or timeout.
 *
 * @module core/cascade-executor
 */

import type {
  CascadeDefinition,
  CascadeTiers,
  CascadeOptions,
  CascadeResult,
  CascadeMetrics,
  TierContext,
  TierAttempt,
  TierSkipCondition,
  FunctionType,
  ExecutionContext,
  Duration,
} from '@dotdo/functions'

import {
  DEFAULT_TIER_TIMEOUTS,
  TIER_ORDER,
  CascadeExhaustedError,
  TierTimeoutError,
  TierSkippedError,
  parseDuration,
} from '@dotdo/functions'

/**
 * CascadeExecutor executes cascades by trying tiers in order,
 * escalating to the next tier on failure or timeout.
 */
export class CascadeExecutor<TInput = unknown, TOutput = unknown> {
  private definition: CascadeDefinition<TInput, TOutput>
  private options: CascadeOptions

  constructor(definition: CascadeDefinition<TInput, TOutput>) {
    this.definition = definition
    this.options = definition.options ?? {}
  }

  /**
   * Execute the cascade with the given input
   */
  async execute(
    input: TInput,
    context?: Partial<TierContext> & { signal?: AbortSignal }
  ): Promise<CascadeResult<TOutput>> {
    const startTime = Date.now()
    const history: TierAttempt[] = []
    const skippedTiers: FunctionType[] = []
    const tierDurations: Partial<Record<FunctionType, number>> = {}
    let escalations = 0
    let totalRetries = 0
    let previousError: Error | undefined
    let previousTier: FunctionType | undefined
    let previousResult: unknown

    // Calculate total timeout
    const totalTimeoutMs = this.options.totalTimeout
      ? parseDuration(this.options.totalTimeout)
      : undefined

    // Get tier order
    const tierOrder = this.getTierOrder()

    // Check for parallel execution mode
    if (this.options.enableParallel) {
      return this.executeParallel(input, context, tierOrder, startTime)
    }

    // Check if there are any defined tiers
    const definedTiers = tierOrder.filter(tier => this.getTierHandler(tier) !== undefined)
    if (definedTiers.length === 0) {
      throw new CascadeExhaustedError('No tiers defined in cascade', history, Date.now() - startTime)
    }

    let cascadeAttempt = context?.cascadeAttempt ?? 1

    for (const tier of tierOrder) {
      const handler = this.getTierHandler(tier)

      // Skip undefined tiers
      if (!handler) {
        skippedTiers.push(tier)
        continue
      }

      // Check signal for abort
      if (context?.signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError')
      }

      // Check if tier should be skipped via skipTiers option
      if (this.options.skipTiers?.includes(tier)) {
        skippedTiers.push(tier)
        continue
      }

      // Check skip conditions
      const tierContext: TierContext = {
        tier,
        attempt: 1,
        cascadeAttempt,
        timeRemainingMs: this.calculateTimeRemaining(startTime, totalTimeoutMs, tier),
      }
      if (previousError !== undefined) {
        tierContext.previousError = previousError
      }
      if (previousTier !== undefined) {
        tierContext.previousTier = previousTier
      }
      if (this.options.enableFallback && previousResult !== undefined) {
        tierContext.previousResult = previousResult
      }
      const skipReason = await this.evaluateSkipConditions(tier, input, tierContext)

      if (skipReason) {
        skippedTiers.push(tier)
        // If this is the last tier and it's skipped, we need to throw TierSkippedError
        const remainingTiers = tierOrder
          .slice(tierOrder.indexOf(tier) + 1)
          .filter(t => this.getTierHandler(t) !== undefined && !this.options.skipTiers?.includes(t))

        if (remainingTiers.length === 0) {
          throw new TierSkippedError(tier, skipReason)
        }
        continue
      }

      // Get retry count for this tier
      const maxRetries = this.options.tierRetries?.[tier] ?? 0
      let tierTotalDuration = 0

      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        if (attempt > 1) {
          totalRetries++
        }

        // Check signal for abort
        if (context?.signal?.aborted) {
          throw new DOMException('The operation was aborted', 'AbortError')
        }

        const tierTimeout = this.getTierTimeout(tier)
        const timeRemaining = this.calculateTimeRemaining(startTime, totalTimeoutMs, tier)

        const tierContext: TierContext = {
          tier,
          attempt,
          cascadeAttempt,
          timeRemainingMs: timeRemaining,
        }
        if (previousError !== undefined) {
          tierContext.previousError = previousError
        }
        if (previousTier !== undefined) {
          tierContext.previousTier = previousTier
        }
        if (this.options.enableFallback && previousResult !== undefined) {
          tierContext.previousResult = previousResult
        }

        const attemptStart = Date.now()
        let attemptResult: TierAttempt

        try {
          const result = await this.executeTierWithTimeout(
            handler,
            input,
            tierContext,
            tierTimeout,
            context?.signal
          )

          const duration = Date.now() - attemptStart
          tierTotalDuration += duration
          tierDurations[tier] = (tierDurations[tier] ?? 0) + duration

          attemptResult = {
            tier,
            attempt,
            status: 'completed',
            result,
            durationMs: duration,
            timestamp: attemptStart,
          }
          history.push(attemptResult)

          // Success - return the result
          return {
            output: result as TOutput,
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
          const duration = Date.now() - attemptStart
          tierTotalDuration += duration
          tierDurations[tier] = (tierDurations[tier] ?? 0) + duration

          const isTimeout = error instanceof TierTimeoutError

          attemptResult = {
            tier,
            attempt,
            status: isTimeout ? 'timeout' : 'failed',
            error: error instanceof Error ? error : new Error(String(error)),
            durationMs: duration,
            timestamp: attemptStart,
          }
          history.push(attemptResult)

          // Save error info for next tier
          previousError = error instanceof Error ? error : new Error(String(error))
          previousTier = tier

          // Extract partial result if available
          // Error objects may have a partialResult property attached for partial success scenarios
          const errorWithPartial = error as Error & { partialResult?: unknown }
          if (errorWithPartial?.partialResult !== undefined) {
            previousResult = errorWithPartial.partialResult
          }

          // If this is not the last retry attempt, continue retrying
          if (attempt < maxRetries + 1) {
            continue
          }

          // Check if there are more tiers to try
          const remainingTiers = tierOrder
            .slice(tierOrder.indexOf(tier) + 1)
            .filter(t => this.getTierHandler(t) !== undefined && !this.options.skipTiers?.includes(t))

          if (remainingTiers.length > 0) {
            escalations++
            break // Move to next tier
          }

          // No more tiers - if this was a timeout, check if custom timeout was used
          if (isTimeout) {
            // If custom timeout was configured for this tier, treat as cascade exhaustion
            const hasCustomTimeout = this.options.tierTimeouts?.[tier] !== undefined
            if (hasCustomTimeout) {
              throw new CascadeExhaustedError(
                `All tiers exhausted for cascade '${this.definition.id}'`,
                history,
                Date.now() - startTime
              )
            }
            // Default timeout - throw TierTimeoutError
            throw error
          }

          // All tiers exhausted with non-timeout failures
          throw new CascadeExhaustedError(
            `All tiers exhausted for cascade '${this.definition.id}'`,
            history,
            Date.now() - startTime
          )
        }
      }
    }

    // If we get here, all tiers were skipped
    throw new TierSkippedError(
      skippedTiers[skippedTiers.length - 1] ?? 'code',
      'All tiers were skipped'
    )
  }

  /**
   * Execute a specific tier directly
   */
  async executeTier(
    tier: FunctionType,
    input: TInput,
    tierContext: TierContext
  ): Promise<TOutput> {
    const handler = this.getTierHandler(tier)
    if (!handler) {
      throw new Error(`Tier '${tier}' not defined in cascade`)
    }

    return handler(input, tierContext) as Promise<TOutput>
  }

  /**
   * Execute tiers in parallel (race mode)
   */
  private async executeParallel(
    input: TInput,
    context: Partial<TierContext> & { signal?: AbortSignal } | undefined,
    tierOrder: FunctionType[],
    startTime: number
  ): Promise<CascadeResult<TOutput>> {
    const history: TierAttempt[] = []
    const skippedTiers: FunctionType[] = []
    const tierDurations: Partial<Record<FunctionType, number>> = {}
    const cascadeAttempt = context?.cascadeAttempt ?? 1

    const definedTiers = tierOrder.filter(tier => {
      const handler = this.getTierHandler(tier)
      if (!handler) {
        skippedTiers.push(tier)
        return false
      }
      if (this.options.skipTiers?.includes(tier)) {
        skippedTiers.push(tier)
        return false
      }
      return true
    })

    if (definedTiers.length === 0) {
      throw new CascadeExhaustedError('No tiers defined in cascade', history, Date.now() - startTime)
    }

    const promises = definedTiers.map(async (tier) => {
      const handler = this.getTierHandler(tier)!
      const tierTimeout = this.getTierTimeout(tier)
      const attemptStart = Date.now()

      const tierContext: TierContext = {
        tier,
        attempt: 1,
        cascadeAttempt,
        timeRemainingMs: tierTimeout,
      }

      try {
        const result = await this.executeTierWithTimeout(
          handler,
          input,
          tierContext,
          tierTimeout,
          context?.signal
        )

        const duration = Date.now() - attemptStart
        tierDurations[tier] = duration

        history.push({
          tier,
          attempt: 1,
          status: 'completed',
          result,
          durationMs: duration,
          timestamp: attemptStart,
        })

        return { tier, result, success: true as const }
      } catch (error) {
        const duration = Date.now() - attemptStart
        tierDurations[tier] = duration

        history.push({
          tier,
          attempt: 1,
          status: error instanceof TierTimeoutError ? 'timeout' : 'failed',
          error: error instanceof Error ? error : new Error(String(error)),
          durationMs: duration,
          timestamp: attemptStart,
        })

        return { tier, error, success: false as const }
      }
    })

    // Use Promise.any to get the first successful result
    try {
      const result = await Promise.any(
        promises.map(async (p) => {
          const r = await p
          if (r.success) return r
          throw r.error
        })
      )

      return {
        output: result.result as TOutput,
        successTier: result.tier,
        history,
        skippedTiers,
        metrics: {
          totalDurationMs: Date.now() - startTime,
          tierDurations,
          escalations: 0,
          totalRetries: 0,
        },
      }
    } catch {
      // All promises rejected
      throw new CascadeExhaustedError(
        `All tiers exhausted for cascade '${this.definition.id}'`,
        history,
        Date.now() - startTime
      )
    }
  }

  /**
   * Get the tier execution order
   */
  private getTierOrder(): FunctionType[] {
    const startTier = this.options.startTier ?? 'code'
    const startIndex = TIER_ORDER.indexOf(startTier)
    return TIER_ORDER.slice(startIndex)
  }

  /**
   * Get the handler function for a tier
   */
  private getTierHandler(tier: FunctionType): ((input: TInput, context: TierContext) => Promise<unknown>) | undefined {
    const tierDef = this.definition.tiers[tier]
    if (!tierDef) return undefined

    // If it's a function, use it directly
    if (typeof tierDef === 'function') {
      return tierDef as (input: TInput, context: TierContext) => Promise<unknown>
    }

    // If it's a definition object with an execute method, wrap it
    // For now, we assume all tier definitions are functions
    return tierDef as unknown as (input: TInput, context: TierContext) => Promise<unknown>
  }

  /**
   * Get the timeout for a tier in milliseconds
   */
  private getTierTimeout(tier: FunctionType): number {
    const customTimeout = this.options.tierTimeouts?.[tier]
    const timeout = customTimeout ?? DEFAULT_TIER_TIMEOUTS[tier]
    return parseDuration(timeout)
  }

  /**
   * Calculate time remaining for a tier
   */
  private calculateTimeRemaining(
    startTime: number,
    totalTimeoutMs: number | undefined,
    tier: FunctionType
  ): number {
    if (totalTimeoutMs) {
      const elapsed = Date.now() - startTime
      return Math.max(0, totalTimeoutMs - elapsed)
    }
    return this.getTierTimeout(tier)
  }

  /**
   * Evaluate skip conditions for a tier
   */
  private async evaluateSkipConditions(
    tier: FunctionType,
    input: TInput,
    context: TierContext
  ): Promise<string | null> {
    const conditions = this.options.skipConditions?.filter(c => c.tier === tier) ?? []

    for (const condition of conditions) {
      const shouldSkip = await Promise.resolve(condition.condition(input, context))
      if (shouldSkip) {
        return condition.reason
      }
    }

    return null
  }

  /**
   * Execute a tier handler with timeout
   */
  private async executeTierWithTimeout(
    handler: (input: TInput, context: TierContext) => Promise<unknown>,
    input: TInput,
    context: TierContext,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let settled = false
      let timeoutId: ReturnType<typeof setTimeout> | undefined

      const cleanup = () => {
        settled = true
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
      }

      // Set up abort signal handler
      const onAbort = () => {
        if (!settled) {
          cleanup()
          reject(new DOMException('The operation was aborted', 'AbortError'))
        }
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true })
      }

      // Set up timeout
      timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true
          if (signal) {
            signal.removeEventListener('abort', onAbort)
          }
          reject(new TierTimeoutError(context.tier, timeoutMs))
        }
      }, timeoutMs)

      // Execute the handler
      handler(input, context)
        .then((result) => {
          if (!settled) {
            cleanup()
            if (signal) {
              signal.removeEventListener('abort', onAbort)
            }
            resolve(result)
          }
        })
        .catch((error) => {
          if (!settled) {
            cleanup()
            if (signal) {
              signal.removeEventListener('abort', onAbort)
            }
            reject(error)
          }
        })
    })
  }
}

/**
 * Factory function to create a CascadeExecutor
 */
export function createCascadeExecutor<TInput, TOutput>(
  definition: CascadeDefinition<TInput, TOutput>,
  options?: CascadeOptions
): CascadeExecutor<TInput, TOutput> {
  const definitionWithOptions: CascadeDefinition<TInput, TOutput> = {
    ...definition,
    options: { ...definition.options, ...options },
  }
  return new CascadeExecutor(definitionWithOptions)
}
