/**
 * CascadeExecutor Tests - RED Phase
 *
 * These tests validate the CascadeExecutor functionality for tiered escalation:
 * - Execute through tiers: code -> generative -> agentic -> human
 * - Auto-escalate on error or timeout
 * - Respect tier timeouts (5s, 30s, 5m, 24h)
 * - Skip conditions and custom tier ordering
 * - Comprehensive metrics collection
 * - Context passing between tiers
 *
 * Test setup uses @cloudflare/vitest-pool-workers with miniflare
 * for realistic Cloudflare Workers environment testing.
 *
 * RED PHASE: These tests are written before implementation exists.
 * All tests should FAIL until CascadeExecutor is implemented.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Types imported from core package (relative to core/src)
// Note: These types are defined in core/src/cascade.ts
import type {
  CascadeDefinition,
  CascadeTiers,
  CascadeOptions,
  CascadeResult,
  TierContext,
  TierAttempt,
  CascadeMetrics,
  TierSkipCondition,
  FunctionType,
} from '../../../core/src/cascade.js'

import {
  DEFAULT_TIER_TIMEOUTS,
  TIER_ORDER,
  CascadeExhaustedError,
  TierTimeoutError,
  TierSkippedError,
} from '../../../core/src/cascade.js'

// This import will fail until the executor is implemented
import { CascadeExecutor } from '../cascade-executor'

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create a mock tier handler that succeeds immediately
 */
function createSuccessHandler<TInput, TOutput>(
  output: TOutput,
  options?: { delay?: number }
): (input: TInput, context: TierContext) => Promise<TOutput> {
  return vi.fn(async (input: TInput, context: TierContext) => {
    if (options?.delay) {
      await new Promise(resolve => setTimeout(resolve, options.delay))
    }
    return output
  })
}

/**
 * Create a mock tier handler that fails
 */
function createFailingHandler<TInput>(
  errorMessage: string,
  options?: { delay?: number }
): (input: TInput, context: TierContext) => Promise<never> {
  return vi.fn(async (input: TInput, context: TierContext) => {
    if (options?.delay) {
      await new Promise(resolve => setTimeout(resolve, options.delay))
    }
    throw new Error(errorMessage)
  })
}

/**
 * Create a mock tier handler that times out (never resolves)
 */
function createTimeoutHandler<TInput>(): (input: TInput, context: TierContext) => Promise<never> {
  return vi.fn(() => new Promise(() => {})) // Never resolves
}

/**
 * Create a mock tier handler that returns partial result then fails
 */
function createPartialSuccessHandler<TInput, TOutput>(
  partialResult: Partial<TOutput>,
  errorMessage: string
): (input: TInput, context: TierContext) => Promise<TOutput> {
  return vi.fn(async (input: TInput, context: TierContext) => {
    // Simulate partial work being done
    const error = new Error(errorMessage) as Error & { partialResult?: unknown }
    error.partialResult = partialResult
    throw error
  })
}

/**
 * Create a cascade definition for testing
 */
function createTestCascade<TInput, TOutput>(
  tiers: CascadeTiers<TInput, TOutput>,
  options?: CascadeOptions
): CascadeDefinition<TInput, TOutput> {
  return {
    id: 'test-cascade',
    name: 'Test Cascade',
    description: 'A test cascade for unit testing',
    tiers,
    options,
  }
}

// =============================================================================
// Test Suites
// =============================================================================

describe('CascadeExecutor', () => {
  let executor: CascadeExecutor<unknown, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===========================================================================
  // 1. Tier Ordering Tests
  // ===========================================================================

  describe('Tier Ordering', () => {
    it('should execute code tier first by default', async () => {
      const codeHandler = createSuccessHandler({ result: 'from-code' })
      const generativeHandler = createSuccessHandler({ result: 'from-generative' })

      const cascade = createTestCascade({
        code: codeHandler,
        generative: generativeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('code')
      expect(codeHandler).toHaveBeenCalledTimes(1)
      expect(generativeHandler).not.toHaveBeenCalled()
    })

    it('should respect custom tier order if provided', async () => {
      const codeHandler = createSuccessHandler({ result: 'from-code' })
      const generativeHandler = createSuccessHandler({ result: 'from-generative' })

      const cascade = createTestCascade(
        {
          code: codeHandler,
          generative: generativeHandler,
        },
        {
          // Custom order: start with generative
          startTier: 'generative',
        }
      )

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('generative')
      expect(generativeHandler).toHaveBeenCalledTimes(1)
      expect(codeHandler).not.toHaveBeenCalled()
    })

    it('should skip tiers not defined in cascade', async () => {
      const agenticHandler = createSuccessHandler({ result: 'from-agentic' })

      // Only define agentic tier - should skip code and generative
      const cascade = createTestCascade({
        agentic: agenticHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('agentic')
      expect(result.skippedTiers).toContain('code')
      expect(result.skippedTiers).toContain('generative')
    })

    it('should follow TIER_ORDER constant for escalation sequence', async () => {
      expect(TIER_ORDER).toEqual(['code', 'generative', 'agentic', 'human'])
    })

    it('should escalate through all tiers in order when each fails', async () => {
      const codeHandler = createFailingHandler('code failed')
      const generativeHandler = createFailingHandler('generative failed')
      const agenticHandler = createFailingHandler('agentic failed')
      const humanHandler = createSuccessHandler({ result: 'from-human' })

      const cascade = createTestCascade({
        code: codeHandler,
        generative: generativeHandler,
        agentic: agenticHandler,
        human: humanHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('human')
      expect(codeHandler).toHaveBeenCalledTimes(1)
      expect(generativeHandler).toHaveBeenCalledTimes(1)
      expect(agenticHandler).toHaveBeenCalledTimes(1)
      expect(humanHandler).toHaveBeenCalledTimes(1)
    })
  })

  // ===========================================================================
  // 2. Timeout Enforcement Tests
  // ===========================================================================

  describe('Timeout Enforcement', () => {
    it('should enforce default 5s timeout for code tier', async () => {
      expect(DEFAULT_TIER_TIMEOUTS.code).toBe('5s')

      const slowCodeHandler = createTimeoutHandler()
      const generativeHandler = createSuccessHandler({ result: 'from-generative' })

      const cascade = createTestCascade({
        code: slowCodeHandler,
        generative: generativeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })

      // Advance past 5 second timeout
      await vi.advanceTimersByTimeAsync(5001)
      await vi.runAllTimersAsync()

      const result = await resultPromise

      // Should have escalated to generative after code timeout
      expect(result.successTier).toBe('generative')
      expect(result.history.find(h => h.tier === 'code')?.status).toBe('timeout')
    })

    it('should enforce default 30s timeout for generative tier', async () => {
      expect(DEFAULT_TIER_TIMEOUTS.generative).toBe('30s')

      const codeHandler = createFailingHandler('code failed')
      const slowGenerativeHandler = createTimeoutHandler()
      const agenticHandler = createSuccessHandler({ result: 'from-agentic' })

      const cascade = createTestCascade({
        code: codeHandler,
        generative: slowGenerativeHandler,
        agentic: agenticHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })

      // Advance past 30 second timeout for generative
      await vi.advanceTimersByTimeAsync(35000)
      await vi.runAllTimersAsync()

      const result = await resultPromise

      expect(result.successTier).toBe('agentic')
      expect(result.history.find(h => h.tier === 'generative')?.status).toBe('timeout')
    })

    it('should enforce default 5m timeout for agentic tier', async () => {
      expect(DEFAULT_TIER_TIMEOUTS.agentic).toBe('5m')

      const codeHandler = createFailingHandler('code failed')
      const generativeHandler = createFailingHandler('generative failed')
      const slowAgenticHandler = createTimeoutHandler()
      const humanHandler = createSuccessHandler({ result: 'from-human' })

      const cascade = createTestCascade({
        code: codeHandler,
        generative: generativeHandler,
        agentic: slowAgenticHandler,
        human: humanHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })

      // Advance past 5 minute timeout for agentic
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000)
      await vi.runAllTimersAsync()

      const result = await resultPromise

      expect(result.successTier).toBe('human')
      expect(result.history.find(h => h.tier === 'agentic')?.status).toBe('timeout')
    })

    it('should enforce default 24h timeout for human tier', async () => {
      expect(DEFAULT_TIER_TIMEOUTS.human).toBe('24h')

      const slowHumanHandler = createTimeoutHandler()

      const cascade = createTestCascade({
        human: slowHumanHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })

      // Advance past 24 hour timeout
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1000)
      await vi.runAllTimersAsync()

      await expect(resultPromise).rejects.toThrow(TierTimeoutError)
    })

    it('should allow custom timeouts to override defaults', async () => {
      const slowCodeHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 3000))
        return { result: 'from-code' }
      })

      const cascade = createTestCascade(
        {
          code: slowCodeHandler,
        },
        {
          tierTimeouts: {
            code: '2s', // Custom 2s timeout instead of default 5s
          },
        }
      )

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })

      // Advance 2.5 seconds - past custom timeout but within default
      await vi.advanceTimersByTimeAsync(2500)
      await vi.runAllTimersAsync()

      await expect(resultPromise).rejects.toThrow(CascadeExhaustedError)
    })

    it('should throw TierTimeoutError with correct tier info', async () => {
      const slowCodeHandler = createTimeoutHandler()

      const cascade = createTestCascade({
        code: slowCodeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })

      await vi.advanceTimersByTimeAsync(6000)
      await vi.runAllTimersAsync()

      try {
        await resultPromise
        expect.fail('Should have thrown TierTimeoutError')
      } catch (error) {
        expect(error).toBeInstanceOf(TierTimeoutError)
        expect((error as TierTimeoutError).tier).toBe('code')
        expect((error as TierTimeoutError).timeoutMs).toBe(5000)
      }
    })
  })

  // ===========================================================================
  // 3. Auto-Escalation Tests
  // ===========================================================================

  describe('Auto-Escalation', () => {
    it('should escalate to next tier on error', async () => {
      const codeHandler = createFailingHandler('code tier failed')
      const generativeHandler = createSuccessHandler({ result: 'from-generative' })

      const cascade = createTestCascade({
        code: codeHandler,
        generative: generativeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('generative')
      expect(result.history[0].tier).toBe('code')
      expect(result.history[0].status).toBe('failed')
    })

    it('should escalate to next tier on timeout', async () => {
      const slowCodeHandler = createTimeoutHandler()
      const generativeHandler = createSuccessHandler({ result: 'from-generative' })

      const cascade = createTestCascade({
        code: slowCodeHandler,
        generative: generativeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })

      await vi.advanceTimersByTimeAsync(6000)
      await vi.runAllTimersAsync()

      const result = await resultPromise

      expect(result.successTier).toBe('generative')
      expect(result.history[0].status).toBe('timeout')
    })

    it('should pass context.previousError to next tier', async () => {
      const codeError = new Error('Code tier specific error')
      const codeHandler = vi.fn(async () => {
        throw codeError
      })
      const generativeHandler = vi.fn(async (input: unknown, context: TierContext) => {
        return { previousError: context.previousError?.message }
      })

      const cascade = createTestCascade({
        code: codeHandler,
        generative: generativeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(generativeHandler).toHaveBeenCalled()
      const callContext = generativeHandler.mock.calls[0][1] as TierContext
      expect(callContext.previousError).toBeDefined()
      expect(callContext.previousError?.message).toBe('Code tier specific error')
      expect(callContext.previousTier).toBe('code')
    })

    it('should pass context.previousResult if partial success', async () => {
      const partialResult = { partialData: 'some-data' }
      const codeHandler = vi.fn(async () => {
        const error = new Error('Partial failure') as Error & { partialResult?: unknown }
        error.partialResult = partialResult
        throw error
      })
      const generativeHandler = vi.fn(async (input: unknown, context: TierContext) => {
        return {
          result: 'completed',
          previousPartial: context.previousResult
        }
      })

      const cascade = createTestCascade(
        {
          code: codeHandler,
          generative: generativeHandler,
        },
        {
          enableFallback: true, // Enable passing partial results
        }
      )

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      const callContext = generativeHandler.mock.calls[0][1] as TierContext
      expect(callContext.previousResult).toEqual(partialResult)
    })

    it('should not pass previousResult when enableFallback is false', async () => {
      const partialResult = { partialData: 'some-data' }
      const codeHandler = vi.fn(async () => {
        const error = new Error('Partial failure') as Error & { partialResult?: unknown }
        error.partialResult = partialResult
        throw error
      })
      const generativeHandler = vi.fn(async (input: unknown, context: TierContext) => {
        return { result: 'completed' }
      })

      const cascade = createTestCascade(
        {
          code: codeHandler,
          generative: generativeHandler,
        },
        {
          enableFallback: false,
        }
      )

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      await resultPromise

      const callContext = generativeHandler.mock.calls[0][1] as TierContext
      expect(callContext.previousResult).toBeUndefined()
    })
  })

  // ===========================================================================
  // 4. Skip Conditions Tests
  // ===========================================================================

  describe('Skip Conditions', () => {
    it('should skip tier if skipCondition returns true', async () => {
      const codeHandler = createSuccessHandler({ result: 'from-code' })
      const generativeHandler = createSuccessHandler({ result: 'from-generative' })

      const skipCondition: TierSkipCondition = {
        tier: 'code',
        condition: (input) => (input as any).skipCode === true,
        reason: 'User requested to skip code tier',
      }

      const cascade = createTestCascade(
        {
          code: codeHandler,
          generative: generativeHandler,
        },
        {
          skipConditions: [skipCondition],
        }
      )

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ skipCode: true })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('generative')
      expect(codeHandler).not.toHaveBeenCalled()
      expect(result.skippedTiers).toContain('code')
    })

    it('should evaluate skip conditions before execution', async () => {
      const codeHandler = createSuccessHandler({ result: 'from-code' })
      let conditionEvaluated = false

      const skipCondition: TierSkipCondition = {
        tier: 'code',
        condition: (input, context) => {
          conditionEvaluated = true
          expect(context.tier).toBe('code')
          return false // Don't skip
        },
        reason: 'Condition check',
      }

      const cascade = createTestCascade(
        {
          code: codeHandler,
        },
        {
          skipConditions: [skipCondition],
        }
      )

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      await resultPromise

      expect(conditionEvaluated).toBe(true)
      expect(codeHandler).toHaveBeenCalled()
    })

    it('should support async skip conditions', async () => {
      const codeHandler = createSuccessHandler({ result: 'from-code' })
      const generativeHandler = createSuccessHandler({ result: 'from-generative' })

      const asyncSkipCondition: TierSkipCondition = {
        tier: 'code',
        condition: async (input) => {
          await new Promise(resolve => setTimeout(resolve, 10))
          return true // Skip code
        },
        reason: 'Async condition check',
      }

      const cascade = createTestCascade(
        {
          code: codeHandler,
          generative: generativeHandler,
        },
        {
          skipConditions: [asyncSkipCondition],
        }
      )

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('generative')
    })

    it('should skip tiers listed in skipTiers option', async () => {
      const codeHandler = createSuccessHandler({ result: 'from-code' })
      const generativeHandler = createSuccessHandler({ result: 'from-generative' })
      const agenticHandler = createSuccessHandler({ result: 'from-agentic' })

      const cascade = createTestCascade(
        {
          code: codeHandler,
          generative: generativeHandler,
          agentic: agenticHandler,
        },
        {
          skipTiers: ['code', 'generative'],
        }
      )

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('agentic')
      expect(result.skippedTiers).toContain('code')
      expect(result.skippedTiers).toContain('generative')
    })
  })

  // ===========================================================================
  // 5. Error Handling Tests
  // ===========================================================================

  describe('Error Handling', () => {
    it('should throw CascadeExhaustedError when all tiers fail', async () => {
      const codeHandler = createFailingHandler('code failed')
      const generativeHandler = createFailingHandler('generative failed')
      const agenticHandler = createFailingHandler('agentic failed')
      const humanHandler = createFailingHandler('human failed')

      const cascade = createTestCascade({
        code: codeHandler,
        generative: generativeHandler,
        agentic: agenticHandler,
        human: humanHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()

      try {
        await resultPromise
        expect.fail('Should have thrown CascadeExhaustedError')
      } catch (error) {
        expect(error).toBeInstanceOf(CascadeExhaustedError)
        expect((error as CascadeExhaustedError).history).toHaveLength(4)
        expect((error as CascadeExhaustedError).totalDurationMs).toBeGreaterThanOrEqual(0)
      }
    })

    it('should include all tier attempts in CascadeExhaustedError history', async () => {
      const codeHandler = createFailingHandler('code specific error')
      const generativeHandler = createFailingHandler('generative specific error')

      const cascade = createTestCascade({
        code: codeHandler,
        generative: generativeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()

      try {
        await resultPromise
        expect.fail('Should have thrown')
      } catch (error) {
        const cascadeError = error as CascadeExhaustedError
        expect(cascadeError.history[0].tier).toBe('code')
        expect(cascadeError.history[0].error?.message).toBe('code specific error')
        expect(cascadeError.history[1].tier).toBe('generative')
        expect(cascadeError.history[1].error?.message).toBe('generative specific error')
      }
    })

    it('should throw TierTimeoutError with tier info', async () => {
      const slowCodeHandler = createTimeoutHandler()

      const cascade = createTestCascade({
        code: slowCodeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.advanceTimersByTimeAsync(6000)
      await vi.runAllTimersAsync()

      try {
        await resultPromise
        expect.fail('Should have thrown TierTimeoutError')
      } catch (error) {
        expect(error).toBeInstanceOf(TierTimeoutError)
        const timeoutError = error as TierTimeoutError
        expect(timeoutError.tier).toBe('code')
        expect(timeoutError.timeoutMs).toBe(5000)
        expect(timeoutError.message).toContain('code')
        expect(timeoutError.message).toContain('5000')
      }
    })

    it('should throw TierSkippedError when all tiers are skipped', async () => {
      const codeHandler = createSuccessHandler({ result: 'from-code' })
      const generativeHandler = createSuccessHandler({ result: 'from-generative' })

      const cascade = createTestCascade(
        {
          code: codeHandler,
          generative: generativeHandler,
        },
        {
          skipTiers: ['code', 'generative'], // Skip all defined tiers
        }
      )

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()

      await expect(resultPromise).rejects.toThrow(TierSkippedError)
    })

    it('should include skip reason in TierSkippedError', async () => {
      const skipCondition: TierSkipCondition = {
        tier: 'code',
        condition: () => true,
        reason: 'Custom skip reason for testing',
      }

      const cascade = createTestCascade(
        {
          code: createSuccessHandler({ result: 'from-code' }),
        },
        {
          skipConditions: [skipCondition],
        }
      )

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()

      try {
        await resultPromise
        expect.fail('Should have thrown TierSkippedError')
      } catch (error) {
        expect(error).toBeInstanceOf(TierSkippedError)
        const skipError = error as TierSkippedError
        expect(skipError.tier).toBe('code')
        expect(skipError.reason).toContain('Custom skip reason')
      }
    })
  })

  // ===========================================================================
  // 6. Metrics Collection Tests
  // ===========================================================================

  describe('Metrics Collection', () => {
    it('should record duration per tier', async () => {
      const codeHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        throw new Error('fail')
      })
      const generativeHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return { result: 'success' }
      })

      const cascade = createTestCascade({
        code: codeHandler,
        generative: generativeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.metrics.tierDurations.code).toBeGreaterThanOrEqual(100)
      expect(result.metrics.tierDurations.generative).toBeGreaterThanOrEqual(200)
    })

    it('should record which tier succeeded', async () => {
      const codeHandler = createFailingHandler('fail')
      const generativeHandler = createSuccessHandler({ result: 'success' })

      const cascade = createTestCascade({
        code: codeHandler,
        generative: generativeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('generative')
    })

    it('should record attempt count per tier', async () => {
      const codeHandler = createFailingHandler('fail')
      const generativeHandler = createSuccessHandler({ result: 'success' })

      const cascade = createTestCascade(
        {
          code: codeHandler,
          generative: generativeHandler,
        },
        {
          tierRetries: {
            code: 3, // Allow 3 retries for code tier
          },
        }
      )

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      const codeAttempts = result.history.filter(h => h.tier === 'code')
      expect(codeAttempts.length).toBe(4) // Initial + 3 retries
    })

    it('should return CascadeMetrics in result', async () => {
      const codeHandler = createSuccessHandler({ result: 'success' })

      const cascade = createTestCascade({
        code: codeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.metrics).toBeDefined()
      expect(result.metrics).toMatchObject<CascadeMetrics>({
        totalDurationMs: expect.any(Number),
        tierDurations: expect.any(Object),
        escalations: expect.any(Number),
        totalRetries: expect.any(Number),
      })
    })

    it('should count escalations correctly', async () => {
      const codeHandler = createFailingHandler('fail')
      const generativeHandler = createFailingHandler('fail')
      const agenticHandler = createSuccessHandler({ result: 'success' })

      const cascade = createTestCascade({
        code: codeHandler,
        generative: generativeHandler,
        agentic: agenticHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      // 2 escalations: code -> generative -> agentic
      expect(result.metrics.escalations).toBe(2)
    })

    it('should track total retries across all tiers', async () => {
      const codeHandler = createFailingHandler('fail')
      const generativeHandler = createFailingHandler('fail')
      const agenticHandler = createSuccessHandler({ result: 'success' })

      const cascade = createTestCascade(
        {
          code: codeHandler,
          generative: generativeHandler,
          agentic: agenticHandler,
        },
        {
          tierRetries: {
            code: 2,
            generative: 1,
          },
        }
      )

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      // 2 retries for code + 1 retry for generative = 3 total retries
      expect(result.metrics.totalRetries).toBe(3)
    })

    it('should calculate total duration correctly', async () => {
      const codeHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        throw new Error('fail')
      })
      const generativeHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return { result: 'success' }
      })

      const cascade = createTestCascade({
        code: codeHandler,
        generative: generativeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Total should be at least the sum of tier durations
      expect(result.metrics.totalDurationMs).toBeGreaterThanOrEqual(150)
    })
  })

  // ===========================================================================
  // 7. Context Passing Tests
  // ===========================================================================

  describe('Context Passing', () => {
    it('should include correct tier name in TierContext', async () => {
      const codeHandler = vi.fn(async (input: unknown, context: TierContext) => {
        expect(context.tier).toBe('code')
        return { result: 'success' }
      })

      const cascade = createTestCascade({
        code: codeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      await resultPromise

      expect(codeHandler).toHaveBeenCalled()
    })

    it('should include attempt number in TierContext', async () => {
      let attemptNumbers: number[] = []
      const codeHandler = vi.fn(async (input: unknown, context: TierContext) => {
        attemptNumbers.push(context.attempt)
        throw new Error('fail')
      })

      const cascade = createTestCascade(
        {
          code: codeHandler,
        },
        {
          tierRetries: {
            code: 2,
          },
        }
      )

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()

      try {
        await resultPromise
      } catch {
        // Expected to fail
      }

      // Attempts should be 1, 2, 3 (initial + 2 retries)
      expect(attemptNumbers).toEqual([1, 2, 3])
    })

    it('should include timeRemainingMs in TierContext', async () => {
      const codeHandler = vi.fn(async (input: unknown, context: TierContext) => {
        expect(context.timeRemainingMs).toBeDefined()
        expect(context.timeRemainingMs).toBeGreaterThan(0)
        expect(context.timeRemainingMs).toBeLessThanOrEqual(5000) // Default code timeout
        return { result: 'success' }
      })

      const cascade = createTestCascade({
        code: codeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      await resultPromise
    })

    it('should include cascadeAttempt in TierContext', async () => {
      let cascadeAttempts: number[] = []

      const codeHandler = vi.fn(async (input: unknown, context: TierContext) => {
        cascadeAttempts.push(context.cascadeAttempt)
        throw new Error('fail')
      })

      const generativeHandler = vi.fn(async (input: unknown, context: TierContext) => {
        cascadeAttempts.push(context.cascadeAttempt)
        throw new Error('fail')
      })

      const agenticHandler = vi.fn(async (input: unknown, context: TierContext) => {
        cascadeAttempts.push(context.cascadeAttempt)
        return { result: 'success' }
      })

      const cascade = createTestCascade({
        code: codeHandler,
        generative: generativeHandler,
        agentic: agenticHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      await resultPromise

      // All should have cascadeAttempt = 1 (first cascade attempt)
      expect(cascadeAttempts).toEqual([1, 1, 1])
    })

    it('should update timeRemainingMs as time passes', async () => {
      let timeRemaining1: number | undefined
      let timeRemaining2: number | undefined

      const codeHandler = vi.fn(async (input: unknown, context: TierContext) => {
        timeRemaining1 = context.timeRemainingMs
        await new Promise(resolve => setTimeout(resolve, 100))
        throw new Error('fail')
      })

      const generativeHandler = vi.fn(async (input: unknown, context: TierContext) => {
        timeRemaining2 = context.timeRemainingMs
        return { result: 'success' }
      })

      const cascade = createTestCascade(
        {
          code: codeHandler,
          generative: generativeHandler,
        },
        {
          totalTimeout: '10s',
        }
      )

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      await resultPromise

      // Time remaining should be less for generative tier
      expect(timeRemaining1).toBeDefined()
      expect(timeRemaining2).toBeDefined()
      expect(timeRemaining2!).toBeLessThan(timeRemaining1!)
    })
  })

  // ===========================================================================
  // Additional Edge Cases
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle empty cascade definition', async () => {
      const cascade = createTestCascade({})

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()

      await expect(resultPromise).rejects.toThrow()
    })

    it('should handle concurrent executions', async () => {
      const codeHandler = vi.fn(async (input: unknown) => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return { result: `processed-${(input as any).id}` }
      })

      const cascade = createTestCascade({
        code: codeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const promises = [
        executor.execute({ id: 1 }),
        executor.execute({ id: 2 }),
        executor.execute({ id: 3 }),
      ]

      await vi.runAllTimersAsync()
      const results = await Promise.all(promises)

      expect(results).toHaveLength(3)
      results.forEach((result, i) => {
        expect(result.output).toEqual({ result: `processed-${i + 1}` })
      })
    })

    it('should support parallel tier execution when enabled', async () => {
      const codeHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return { result: 'from-code' }
      })
      const generativeHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return { result: 'from-generative' }
      })

      const cascade = createTestCascade(
        {
          code: codeHandler,
          generative: generativeHandler,
        },
        {
          enableParallel: true, // Execute tiers in parallel, return first success
        }
      )

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Generative is faster, should win
      expect(result.successTier).toBe('generative')
    })

    it('should properly handle AbortSignal', async () => {
      const codeHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000))
        return { result: 'success' }
      })

      const cascade = createTestCascade({
        code: codeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const abortController = new AbortController()

      const resultPromise = executor.execute({ input: 'test' }, {
        signal: abortController.signal,
      })

      // Abort after 100ms
      setTimeout(() => abortController.abort(), 100)

      await vi.runAllTimersAsync()

      await expect(resultPromise).rejects.toThrow()
    })

    it('should record tier attempt timestamps', async () => {
      const codeHandler = createSuccessHandler({ result: 'success' })

      const cascade = createTestCascade({
        code: codeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.history[0].timestamp).toBeDefined()
      expect(result.history[0].timestamp).toBeGreaterThan(0)
    })

    it('should include result in successful tier attempt', async () => {
      const expectedResult = { result: 'success', data: 123 }
      const codeHandler = createSuccessHandler(expectedResult)

      const cascade = createTestCascade({
        code: codeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.history[0].status).toBe('completed')
      expect(result.history[0].result).toEqual(expectedResult)
      expect(result.output).toEqual(expectedResult)
    })

    it('should execute specific tier directly via executeTier', async () => {
      const generativeHandler = createSuccessHandler({ result: 'from-generative' })

      const cascade = createTestCascade({
        code: createSuccessHandler({ result: 'from-code' }),
        generative: generativeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const tierContext: TierContext = {
        tier: 'generative',
        attempt: 1,
        cascadeAttempt: 1,
        timeRemainingMs: 30000,
      }

      const resultPromise = executor.executeTier('generative', { input: 'test' }, tierContext)
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result).toEqual({ result: 'from-generative' })
    })
  })

  // ===========================================================================
  // Integration with Types
  // ===========================================================================

  describe('Type Compliance', () => {
    it('should return proper CascadeResult structure', async () => {
      const codeHandler = createSuccessHandler({ message: 'hello' })

      const cascade = createTestCascade({
        code: codeHandler,
      })

      executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Verify CascadeResult structure
      expect(result).toMatchObject<Partial<CascadeResult>>({
        output: { message: 'hello' },
        successTier: 'code',
        history: expect.any(Array),
        skippedTiers: expect.any(Array),
        metrics: expect.any(Object),
      })

      // Verify TierAttempt structure
      const tierAttempt = result.history[0]
      expect(tierAttempt).toMatchObject<Partial<TierAttempt>>({
        tier: 'code',
        attempt: expect.any(Number),
        status: 'completed',
        result: { message: 'hello' },
        durationMs: expect.any(Number),
        timestamp: expect.any(Number),
      })
    })

    it('should implement CascadeExecutor interface correctly', () => {
      const cascade = createTestCascade({
        code: createSuccessHandler({ result: 'test' }),
      })

      executor = new CascadeExecutor(cascade)

      // Verify interface methods exist
      expect(typeof executor.execute).toBe('function')
      expect(typeof executor.executeTier).toBe('function')
    })
  })
})
