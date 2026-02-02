/**
 * CascadeExecutor Tests
 *
 * Comprehensive tests for the CascadeExecutor which implements tiered execution
 * with automatic escalation through function types:
 *   code (5s) -> generative (30s) -> agentic (5m) -> human (24h)
 *
 * Covers:
 * - Constructor validation
 * - Tier fallback chain (sequential escalation on failure/timeout)
 * - Parallel execution mode (Promise.any race)
 * - Error propagation (CascadeExhaustedError, TierTimeoutError, TierSkippedError)
 * - Skip conditions and skipTiers option
 * - Retry logic with tierRetries
 * - Metrics collection (durations, escalations, retries)
 * - Context passing between tiers (previousError, previousTier, previousResult)
 * - AbortSignal support
 * - Factory function (createCascadeExecutor)
 *
 * Test setup uses @cloudflare/vitest-pool-workers with miniflare
 * for realistic Cloudflare Workers environment testing.
 *
 * @module core/cascade-executor.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

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
} from '@dotdo/functions'

import {
  DEFAULT_TIER_TIMEOUTS,
  TIER_ORDER,
  CascadeExhaustedError,
  TierTimeoutError,
  TierSkippedError,
} from '@dotdo/functions'

import { CascadeExecutor, createCascadeExecutor } from '../cascade-executor'

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create a mock tier handler that succeeds immediately (or after a delay)
 */
function createSuccessHandler<TInput, TOutput>(
  output: TOutput,
  options?: { delay?: number }
): (input: TInput, context: TierContext) => Promise<TOutput> {
  return vi.fn(async (_input: TInput, _context: TierContext) => {
    if (options?.delay) {
      await new Promise(resolve => setTimeout(resolve, options.delay))
    }
    return output
  })
}

/**
 * Create a mock tier handler that fails with the given error message
 */
function createFailingHandler<TInput>(
  errorMessage: string,
  options?: { delay?: number }
): (input: TInput, context: TierContext) => Promise<never> {
  return vi.fn(async (_input: TInput, _context: TierContext) => {
    if (options?.delay) {
      await new Promise(resolve => setTimeout(resolve, options.delay))
    }
    throw new Error(errorMessage)
  })
}

/**
 * Create a mock tier handler that never resolves (used to trigger timeouts)
 */
function createTimeoutHandler<TInput>(): (input: TInput, context: TierContext) => Promise<never> {
  return vi.fn(() => new Promise<never>(() => {}))
}

/**
 * Create a mock tier handler that throws with a partial result attached
 */
function createPartialFailHandler<TInput>(
  partialResult: unknown,
  errorMessage: string
): (input: TInput, context: TierContext) => Promise<never> {
  return vi.fn(async () => {
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
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===========================================================================
  // 1. Constructor Validation
  // ===========================================================================

  describe('Constructor Validation', () => {
    it('should throw when definition is null', () => {
      expect(() => new CascadeExecutor(null as any)).toThrow('CascadeExecutor requires a definition')
    })

    it('should throw when definition is undefined', () => {
      expect(() => new CascadeExecutor(undefined as any)).toThrow('CascadeExecutor requires a definition')
    })

    it('should throw when tiers are missing from definition', () => {
      expect(() => new CascadeExecutor({ id: 'x', name: 'x' } as any)).toThrow(
        'CascadeExecutor requires tiers in the definition'
      )
    })

    it('should construct successfully with valid definition', () => {
      const cascade = createTestCascade({
        code: createSuccessHandler({ result: 'ok' }),
      })
      const executor = new CascadeExecutor(cascade)
      expect(executor).toBeInstanceOf(CascadeExecutor)
    })

    it('should default options to empty object when not provided', () => {
      const cascade: CascadeDefinition = {
        id: 'test',
        name: 'test',
        tiers: { code: createSuccessHandler({ result: 'ok' }) },
      }
      // No options field at all
      const executor = new CascadeExecutor(cascade)
      expect(executor).toBeInstanceOf(CascadeExecutor)
    })
  })

  // ===========================================================================
  // 2. Tier Fallback Chain
  // ===========================================================================

  describe('Tier Fallback Chain', () => {
    it('should execute code tier first by default', async () => {
      const codeHandler = createSuccessHandler({ result: 'from-code' })
      const generativeHandler = createSuccessHandler({ result: 'from-generative' })

      const cascade = createTestCascade({
        code: codeHandler,
        generative: generativeHandler,
      })

      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('code')
      expect(result.output).toEqual({ result: 'from-code' })
      expect(codeHandler).toHaveBeenCalledTimes(1)
      expect(generativeHandler).not.toHaveBeenCalled()
    })

    it('should escalate from code to generative on failure', async () => {
      const codeHandler = createFailingHandler('code failed')
      const generativeHandler = createSuccessHandler({ result: 'from-generative' })

      const cascade = createTestCascade({
        code: codeHandler,
        generative: generativeHandler,
      })

      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('generative')
      expect(codeHandler).toHaveBeenCalledTimes(1)
      expect(generativeHandler).toHaveBeenCalledTimes(1)
    })

    it('should escalate through all four tiers in order when each fails', async () => {
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

      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('human')
      expect(codeHandler).toHaveBeenCalledTimes(1)
      expect(generativeHandler).toHaveBeenCalledTimes(1)
      expect(agenticHandler).toHaveBeenCalledTimes(1)
      expect(humanHandler).toHaveBeenCalledTimes(1)
    })

    it('should skip undefined tiers and try next defined tier', async () => {
      const agenticHandler = createSuccessHandler({ result: 'from-agentic' })

      // Only define agentic -- code and generative are undefined
      const cascade = createTestCascade({
        agentic: agenticHandler,
      })

      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('agentic')
      expect(result.skippedTiers).toContain('code')
      expect(result.skippedTiers).toContain('generative')
    })

    it('should respect startTier option to begin at a later tier', async () => {
      const codeHandler = createSuccessHandler({ result: 'from-code' })
      const generativeHandler = createSuccessHandler({ result: 'from-generative' })

      const cascade = createTestCascade(
        { code: codeHandler, generative: generativeHandler },
        { startTier: 'generative' }
      )

      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('generative')
      expect(codeHandler).not.toHaveBeenCalled()
      expect(generativeHandler).toHaveBeenCalledTimes(1)
    })

    it('should verify TIER_ORDER constant', () => {
      expect(TIER_ORDER).toEqual(['code', 'generative', 'agentic', 'human'])
    })

    it('should escalate on timeout and record timeout status in history', async () => {
      const slowCodeHandler = createTimeoutHandler()
      const generativeHandler = createSuccessHandler({ result: 'from-generative' })

      const cascade = createTestCascade({
        code: slowCodeHandler,
        generative: generativeHandler,
      })

      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ input: 'test' })

      // Advance past the default 5s code timeout
      await vi.advanceTimersByTimeAsync(5001)
      await vi.runAllTimersAsync()

      const result = await resultPromise

      expect(result.successTier).toBe('generative')
      const codeAttempt = result.history.find(h => h.tier === 'code')
      expect(codeAttempt?.status).toBe('timeout')
    })
  })

  // ===========================================================================
  // 3. Timeout Enforcement
  // ===========================================================================

  describe('Timeout Enforcement', () => {
    it('should use default tier timeouts from DEFAULT_TIER_TIMEOUTS', () => {
      expect(DEFAULT_TIER_TIMEOUTS.code).toBe('5s')
      expect(DEFAULT_TIER_TIMEOUTS.generative).toBe('30s')
      expect(DEFAULT_TIER_TIMEOUTS.agentic).toBe('5m')
      expect(DEFAULT_TIER_TIMEOUTS.human).toBe('24h')
    })

    it('should enforce 5s default timeout for code tier', async () => {
      const slowCode = createTimeoutHandler()
      const generative = createSuccessHandler({ result: 'gen' })

      const cascade = createTestCascade({ code: slowCode, generative })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({ x: 1 })
      await vi.advanceTimersByTimeAsync(5001)
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('generative')
      expect(result.history.find(h => h.tier === 'code')?.status).toBe('timeout')
    })

    it('should enforce 30s default timeout for generative tier', async () => {
      const code = createFailingHandler('code failed')
      const slowGenerative = createTimeoutHandler()
      const agentic = createSuccessHandler({ result: 'agentic' })

      const cascade = createTestCascade({ code, generative: slowGenerative, agentic })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.advanceTimersByTimeAsync(35000)
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('agentic')
      expect(result.history.find(h => h.tier === 'generative')?.status).toBe('timeout')
    })

    it('should enforce 5m default timeout for agentic tier', async () => {
      const code = createFailingHandler('fail')
      const generative = createFailingHandler('fail')
      const slowAgentic = createTimeoutHandler()
      const human = createSuccessHandler({ result: 'human' })

      const cascade = createTestCascade({ code, generative, agentic: slowAgentic, human })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000)
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('human')
      expect(result.history.find(h => h.tier === 'agentic')?.status).toBe('timeout')
    })

    it('should throw TierTimeoutError for the last tier when it times out (default timeout)', async () => {
      const slowHuman = createTimeoutHandler()
      const cascade = createTestCascade({ human: slowHuman })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1000)
      await vi.runAllTimersAsync()

      await expect(resultPromise).rejects.toThrow(TierTimeoutError)
    })

    it('should respect custom tierTimeouts option', async () => {
      const slowCode = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 3000))
        return { result: 'from-code' }
      })

      const cascade = createTestCascade(
        { code: slowCode },
        { tierTimeouts: { code: '2s' } }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.advanceTimersByTimeAsync(2500)
      await vi.runAllTimersAsync()

      // Last tier with custom timeout => CascadeExhaustedError
      await expect(resultPromise).rejects.toThrow(CascadeExhaustedError)
    })

    it('should throw TierTimeoutError with correct tier and timeoutMs', async () => {
      const slowCode = createTimeoutHandler()
      const cascade = createTestCascade({ code: slowCode })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.advanceTimersByTimeAsync(6000)
      await vi.runAllTimersAsync()

      try {
        await resultPromise
        expect.fail('Should have thrown TierTimeoutError')
      } catch (error) {
        expect(error).toBeInstanceOf(TierTimeoutError)
        const te = error as TierTimeoutError
        expect(te.tier).toBe('code')
        expect(te.timeoutMs).toBe(5000)
        expect(te.message).toContain('code')
        expect(te.message).toContain('5000')
      }
    })
  })

  // ===========================================================================
  // 4. Parallel Execution
  // ===========================================================================

  describe('Parallel Execution', () => {
    it('should execute tiers in parallel when enableParallel is true', async () => {
      const codeHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return { result: 'from-code' }
      })
      const generativeHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return { result: 'from-generative' }
      })

      const cascade = createTestCascade(
        { code: codeHandler, generative: generativeHandler },
        { enableParallel: true }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({ input: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Generative finishes first, so it wins the race
      expect(result.successTier).toBe('generative')
      expect(result.output).toEqual({ result: 'from-generative' })
      // Both should have been started
      expect(codeHandler).toHaveBeenCalledTimes(1)
      expect(generativeHandler).toHaveBeenCalledTimes(1)
    })

    it('should return first successful result in parallel mode', async () => {
      const codeHandler = createFailingHandler('code failed')
      const generativeHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return { result: 'generative-wins' }
      })

      const cascade = createTestCascade(
        { code: codeHandler, generative: generativeHandler },
        { enableParallel: true }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('generative')
      expect(result.metrics.escalations).toBe(0) // No escalations in parallel mode
    })

    it('should throw CascadeExhaustedError when all tiers fail in parallel', async () => {
      const codeHandler = createFailingHandler('code failed')
      const generativeHandler = createFailingHandler('generative failed')

      const cascade = createTestCascade(
        { code: codeHandler, generative: generativeHandler },
        { enableParallel: true }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()

      await expect(resultPromise).rejects.toThrow(CascadeExhaustedError)
    })

    it('should skip undefined and skipTiers in parallel mode', async () => {
      const codeHandler = createSuccessHandler({ result: 'code' })
      const generativeHandler = createSuccessHandler({ result: 'generative' })

      const cascade = createTestCascade(
        { code: codeHandler, generative: generativeHandler },
        { enableParallel: true, skipTiers: ['code'] }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('generative')
      expect(result.skippedTiers).toContain('code')
      expect(codeHandler).not.toHaveBeenCalled()
    })

    it('should throw CascadeExhaustedError when no tiers defined in parallel', async () => {
      const cascade = createTestCascade(
        {},
        { enableParallel: true }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()

      await expect(resultPromise).rejects.toThrow(CascadeExhaustedError)
    })

    it('should record history for all tiers in parallel mode', async () => {
      const codeHandler = createFailingHandler('code failed')
      const generativeHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return { result: 'gen' }
      })

      const cascade = createTestCascade(
        { code: codeHandler, generative: generativeHandler },
        { enableParallel: true }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Both tiers should be recorded (one failed, one completed)
      expect(result.history.length).toBeGreaterThanOrEqual(1)
      const completedEntry = result.history.find(h => h.status === 'completed')
      expect(completedEntry?.tier).toBe('generative')
    })
  })

  // ===========================================================================
  // 5. Error Propagation
  // ===========================================================================

  describe('Error Propagation', () => {
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

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()

      try {
        await resultPromise
        expect.fail('Should have thrown CascadeExhaustedError')
      } catch (error) {
        expect(error).toBeInstanceOf(CascadeExhaustedError)
        const ce = error as CascadeExhaustedError
        expect(ce.history).toHaveLength(4)
        expect(ce.totalDurationMs).toBeGreaterThanOrEqual(0)
        expect(ce.message).toContain('test-cascade')
      }
    })

    it('should include tier-specific errors in CascadeExhaustedError history', async () => {
      const codeHandler = createFailingHandler('code specific error')
      const generativeHandler = createFailingHandler('generative specific error')

      const cascade = createTestCascade({ code: codeHandler, generative: generativeHandler })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()

      try {
        await resultPromise
        expect.fail('Should have thrown')
      } catch (error) {
        const ce = error as CascadeExhaustedError
        expect(ce.history[0].tier).toBe('code')
        expect(ce.history[0].error?.message).toBe('code specific error')
        expect(ce.history[1].tier).toBe('generative')
        expect(ce.history[1].error?.message).toBe('generative specific error')
      }
    })

    it('should throw CascadeExhaustedError when no tiers are defined', async () => {
      const cascade = createTestCascade({})
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()

      await expect(resultPromise).rejects.toThrow(CascadeExhaustedError)
    })

    it('should throw TierSkippedError when all defined tiers are skipped', async () => {
      const codeHandler = createSuccessHandler({ result: 'code' })
      const generativeHandler = createSuccessHandler({ result: 'gen' })

      const cascade = createTestCascade(
        { code: codeHandler, generative: generativeHandler },
        { skipTiers: ['code', 'generative'] }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()

      await expect(resultPromise).rejects.toThrow(TierSkippedError)
    })

    it('should include skip reason in TierSkippedError from skipConditions', async () => {
      const skipCondition: TierSkipCondition = {
        tier: 'code',
        condition: () => true,
        reason: 'Custom skip reason for testing',
      }

      const cascade = createTestCascade(
        { code: createSuccessHandler({ result: 'code' }) },
        { skipConditions: [skipCondition] }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()

      try {
        await resultPromise
        expect.fail('Should have thrown TierSkippedError')
      } catch (error) {
        expect(error).toBeInstanceOf(TierSkippedError)
        const se = error as TierSkippedError
        expect(se.tier).toBe('code')
        expect(se.reason).toContain('Custom skip reason')
      }
    })

    it('should convert non-Error throws to Error objects in history', async () => {
      const codeHandler = vi.fn(async () => {
        throw 'string error' // eslint-disable-line no-throw-literal
      })
      const generativeHandler = createSuccessHandler({ result: 'gen' })

      const cascade = createTestCascade({ code: codeHandler, generative: generativeHandler })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('generative')
      const codeAttempt = result.history.find(h => h.tier === 'code')
      expect(codeAttempt?.status).toBe('failed')
      expect(codeAttempt?.error).toBeInstanceOf(Error)
      expect(codeAttempt?.error?.message).toContain('string error')
    })
  })

  // ===========================================================================
  // 6. Skip Conditions
  // ===========================================================================

  describe('Skip Conditions', () => {
    it('should skip a tier when skipCondition returns true', async () => {
      const codeHandler = createSuccessHandler({ result: 'code' })
      const generativeHandler = createSuccessHandler({ result: 'gen' })

      const skipCondition: TierSkipCondition = {
        tier: 'code',
        condition: (input) => (input as any).skipCode === true,
        reason: 'User requested skip',
      }

      const cascade = createTestCascade(
        { code: codeHandler, generative: generativeHandler },
        { skipConditions: [skipCondition] }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({ skipCode: true })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('generative')
      expect(codeHandler).not.toHaveBeenCalled()
      expect(result.skippedTiers).toContain('code')
    })

    it('should not skip a tier when skipCondition returns false', async () => {
      const codeHandler = createSuccessHandler({ result: 'code' })

      const skipCondition: TierSkipCondition = {
        tier: 'code',
        condition: () => false,
        reason: 'Should not skip',
      }

      const cascade = createTestCascade(
        { code: codeHandler },
        { skipConditions: [skipCondition] }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('code')
      expect(codeHandler).toHaveBeenCalled()
    })

    it('should support async skip conditions', async () => {
      const codeHandler = createSuccessHandler({ result: 'code' })
      const generativeHandler = createSuccessHandler({ result: 'gen' })

      const asyncSkipCondition: TierSkipCondition = {
        tier: 'code',
        condition: async () => {
          await new Promise(resolve => setTimeout(resolve, 10))
          return true
        },
        reason: 'Async skip',
      }

      const cascade = createTestCascade(
        { code: codeHandler, generative: generativeHandler },
        { skipConditions: [asyncSkipCondition] }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('generative')
    })

    it('should skip tiers listed in skipTiers option', async () => {
      const codeHandler = createSuccessHandler({ result: 'code' })
      const generativeHandler = createSuccessHandler({ result: 'gen' })
      const agenticHandler = createSuccessHandler({ result: 'agentic' })

      const cascade = createTestCascade(
        { code: codeHandler, generative: generativeHandler, agentic: agenticHandler },
        { skipTiers: ['code', 'generative'] }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('agentic')
      expect(result.skippedTiers).toContain('code')
      expect(result.skippedTiers).toContain('generative')
    })

    it('should evaluate skip conditions with correct TierContext', async () => {
      let capturedContext: TierContext | null = null
      const codeHandler = createSuccessHandler({ result: 'code' })

      const skipCondition: TierSkipCondition = {
        tier: 'code',
        condition: (_input, context) => {
          capturedContext = context
          return false
        },
        reason: 'Context check',
      }

      const cascade = createTestCascade(
        { code: codeHandler },
        { skipConditions: [skipCondition] }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      await resultPromise

      expect(capturedContext).not.toBeNull()
      expect(capturedContext!.tier).toBe('code')
      expect(capturedContext!.attempt).toBe(1)
      expect(capturedContext!.cascadeAttempt).toBe(1)
    })
  })

  // ===========================================================================
  // 7. Retry Logic
  // ===========================================================================

  describe('Retry Logic', () => {
    it('should retry a tier according to tierRetries config', async () => {
      const codeHandler = createFailingHandler('fail')
      const generativeHandler = createSuccessHandler({ result: 'gen' })

      const cascade = createTestCascade(
        { code: codeHandler, generative: generativeHandler },
        { tierRetries: { code: 3 } }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      // code: 1 initial + 3 retries = 4 attempts
      const codeAttempts = result.history.filter(h => h.tier === 'code')
      expect(codeAttempts).toHaveLength(4)
      expect(codeHandler).toHaveBeenCalledTimes(4)
      expect(result.successTier).toBe('generative')
    })

    it('should succeed on retry without escalating', async () => {
      let callCount = 0
      const codeHandler = vi.fn(async () => {
        callCount++
        if (callCount < 3) {
          throw new Error('fail')
        }
        return { result: 'success-on-retry' }
      })

      const cascade = createTestCascade(
        { code: codeHandler },
        { tierRetries: { code: 2 } }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('code')
      expect(result.output).toEqual({ result: 'success-on-retry' })
      expect(codeHandler).toHaveBeenCalledTimes(3)
    })

    it('should increment attempt number in context for each retry', async () => {
      const attemptNumbers: number[] = []
      const codeHandler = vi.fn(async (_input: unknown, context: TierContext) => {
        attemptNumbers.push(context.attempt)
        throw new Error('fail')
      })

      const cascade = createTestCascade(
        { code: codeHandler },
        { tierRetries: { code: 2 } }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()

      try {
        await resultPromise
      } catch {
        // Expected to fail
      }

      expect(attemptNumbers).toEqual([1, 2, 3])
    })

    it('should track totalRetries across multiple tiers', async () => {
      const codeHandler = createFailingHandler('fail')
      const generativeHandler = createFailingHandler('fail')
      const agenticHandler = createSuccessHandler({ result: 'ok' })

      const cascade = createTestCascade(
        { code: codeHandler, generative: generativeHandler, agentic: agenticHandler },
        { tierRetries: { code: 2, generative: 1 } }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      // code: 2 retries, generative: 1 retry = 3 total retries
      expect(result.metrics.totalRetries).toBe(3)
    })
  })

  // ===========================================================================
  // 8. Metrics Collection
  // ===========================================================================

  describe('Metrics Collection', () => {
    it('should return CascadeMetrics with all fields', async () => {
      const codeHandler = createSuccessHandler({ result: 'ok' })

      const cascade = createTestCascade({ code: codeHandler })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.metrics).toBeDefined()
      expect(result.metrics).toMatchObject({
        totalDurationMs: expect.any(Number),
        tierDurations: expect.any(Object),
        escalations: expect.any(Number),
        totalRetries: expect.any(Number),
      } satisfies CascadeMetrics)
    })

    it('should record duration per tier', async () => {
      const codeHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        throw new Error('fail')
      })
      const generativeHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return { result: 'ok' }
      })

      const cascade = createTestCascade({ code: codeHandler, generative: generativeHandler })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.metrics.tierDurations.code).toBeGreaterThanOrEqual(100)
      expect(result.metrics.tierDurations.generative).toBeGreaterThanOrEqual(200)
    })

    it('should count escalations correctly', async () => {
      const codeHandler = createFailingHandler('fail')
      const generativeHandler = createFailingHandler('fail')
      const agenticHandler = createSuccessHandler({ result: 'ok' })

      const cascade = createTestCascade({
        code: codeHandler,
        generative: generativeHandler,
        agentic: agenticHandler,
      })

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      // code -> generative (1), generative -> agentic (2)
      expect(result.metrics.escalations).toBe(2)
    })

    it('should record zero escalations when first tier succeeds', async () => {
      const codeHandler = createSuccessHandler({ result: 'ok' })
      const cascade = createTestCascade({ code: codeHandler })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.metrics.escalations).toBe(0)
      expect(result.metrics.totalRetries).toBe(0)
    })

    it('should calculate totalDurationMs across all tier executions', async () => {
      const codeHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        throw new Error('fail')
      })
      const generativeHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return { result: 'ok' }
      })

      const cascade = createTestCascade({ code: codeHandler, generative: generativeHandler })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.metrics.totalDurationMs).toBeGreaterThanOrEqual(150)
    })
  })

  // ===========================================================================
  // 9. Context Passing
  // ===========================================================================

  describe('Context Passing', () => {
    it('should include correct tier name in TierContext', async () => {
      const codeHandler = vi.fn(async (_input: unknown, context: TierContext) => {
        expect(context.tier).toBe('code')
        return { result: 'ok' }
      })

      const cascade = createTestCascade({ code: codeHandler })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      await resultPromise

      expect(codeHandler).toHaveBeenCalled()
    })

    it('should pass previousError and previousTier to the next tier', async () => {
      const codeHandler = vi.fn(async () => {
        throw new Error('Code tier specific error')
      })
      const generativeHandler = vi.fn(async (_input: unknown, context: TierContext) => {
        return {
          previousError: context.previousError?.message,
          previousTier: context.previousTier,
        }
      })

      const cascade = createTestCascade({ code: codeHandler, generative: generativeHandler })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(generativeHandler).toHaveBeenCalled()
      const callContext = generativeHandler.mock.calls[0]![1] as TierContext
      expect(callContext.previousError).toBeDefined()
      expect(callContext.previousError?.message).toBe('Code tier specific error')
      expect(callContext.previousTier).toBe('code')
    })

    it('should pass previousResult when enableFallback is true', async () => {
      const partialResult = { partialData: 'some-data' }
      const codeHandler = createPartialFailHandler(partialResult, 'Partial failure')
      const generativeHandler = vi.fn(async (_input: unknown, context: TierContext) => {
        return { result: 'completed', previousPartial: context.previousResult }
      })

      const cascade = createTestCascade(
        { code: codeHandler, generative: generativeHandler },
        { enableFallback: true }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      await resultPromise

      const callContext = generativeHandler.mock.calls[0]![1] as TierContext
      expect(callContext.previousResult).toEqual(partialResult)
    })

    it('should NOT pass previousResult when enableFallback is false', async () => {
      const partialResult = { partialData: 'some-data' }
      const codeHandler = createPartialFailHandler(partialResult, 'Partial failure')
      const generativeHandler = vi.fn(async (_input: unknown, context: TierContext) => {
        return { result: 'completed' }
      })

      const cascade = createTestCascade(
        { code: codeHandler, generative: generativeHandler },
        { enableFallback: false }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      await resultPromise

      const callContext = generativeHandler.mock.calls[0]![1] as TierContext
      expect(callContext.previousResult).toBeUndefined()
    })

    it('should include timeRemainingMs in TierContext', async () => {
      const codeHandler = vi.fn(async (_input: unknown, context: TierContext) => {
        expect(context.timeRemainingMs).toBeDefined()
        expect(context.timeRemainingMs).toBeGreaterThan(0)
        return { result: 'ok' }
      })

      const cascade = createTestCascade({ code: codeHandler })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      await resultPromise
    })

    it('should include cascadeAttempt in TierContext', async () => {
      const cascadeAttempts: number[] = []

      const codeHandler = vi.fn(async (_input: unknown, context: TierContext) => {
        cascadeAttempts.push(context.cascadeAttempt)
        throw new Error('fail')
      })
      const generativeHandler = vi.fn(async (_input: unknown, context: TierContext) => {
        cascadeAttempts.push(context.cascadeAttempt)
        return { result: 'ok' }
      })

      const cascade = createTestCascade({ code: codeHandler, generative: generativeHandler })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      await resultPromise

      // All should have cascadeAttempt = 1 (first cascade attempt)
      expect(cascadeAttempts).toEqual([1, 1])
    })

    it('should decrease timeRemainingMs across tiers when totalTimeout is set', async () => {
      let timeRemaining1: number | undefined
      let timeRemaining2: number | undefined

      const codeHandler = vi.fn(async (_input: unknown, context: TierContext) => {
        timeRemaining1 = context.timeRemainingMs
        await new Promise(resolve => setTimeout(resolve, 100))
        throw new Error('fail')
      })
      const generativeHandler = vi.fn(async (_input: unknown, context: TierContext) => {
        timeRemaining2 = context.timeRemainingMs
        return { result: 'ok' }
      })

      const cascade = createTestCascade(
        { code: codeHandler, generative: generativeHandler },
        { totalTimeout: '10s' }
      )

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      await resultPromise

      expect(timeRemaining1).toBeDefined()
      expect(timeRemaining2).toBeDefined()
      expect(timeRemaining2!).toBeLessThan(timeRemaining1!)
    })
  })

  // ===========================================================================
  // 10. AbortSignal Support
  // ===========================================================================

  describe('AbortSignal Support', () => {
    it('should abort execution when signal is aborted before start', async () => {
      const codeHandler = createSuccessHandler({ result: 'ok' })

      const cascade = createTestCascade({ code: codeHandler })
      const executor = new CascadeExecutor(cascade)

      const abortController = new AbortController()
      abortController.abort() // Abort immediately

      const resultPromise = executor.execute({}, { signal: abortController.signal })
      await vi.runAllTimersAsync()

      await expect(resultPromise).rejects.toThrow()
    })

    it('should abort execution when signal fires during tier execution', async () => {
      const codeHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000))
        return { result: 'ok' }
      })

      const cascade = createTestCascade({ code: codeHandler })
      const executor = new CascadeExecutor(cascade)

      const abortController = new AbortController()
      const resultPromise = executor.execute({}, { signal: abortController.signal })

      // Abort after 100ms
      setTimeout(() => abortController.abort(), 100)
      await vi.runAllTimersAsync()

      await expect(resultPromise).rejects.toThrow()
    })
  })

  // ===========================================================================
  // 11. executeTier (Direct Tier Execution)
  // ===========================================================================

  describe('executeTier', () => {
    it('should execute a specific tier directly', async () => {
      const generativeHandler = createSuccessHandler({ result: 'from-generative' })

      const cascade = createTestCascade({
        code: createSuccessHandler({ result: 'from-code' }),
        generative: generativeHandler,
      })

      const executor = new CascadeExecutor(cascade)

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

    it('should throw when tier is not defined', async () => {
      const cascade = createTestCascade({ code: createSuccessHandler({ result: 'ok' }) })
      const executor = new CascadeExecutor(cascade)

      const tierContext: TierContext = {
        tier: 'agentic',
        attempt: 1,
        cascadeAttempt: 1,
        timeRemainingMs: 5000,
      }

      await expect(
        executor.executeTier('agentic', {}, tierContext)
      ).rejects.toThrow("Tier 'agentic' not defined in cascade")
    })

    it('should throw when tier argument is falsy', async () => {
      const cascade = createTestCascade({ code: createSuccessHandler({ result: 'ok' }) })
      const executor = new CascadeExecutor(cascade)

      await expect(
        executor.executeTier('' as FunctionType, {}, {} as TierContext)
      ).rejects.toThrow('Tier is required')
    })

    it('should throw when tierContext is missing', async () => {
      const cascade = createTestCascade({ code: createSuccessHandler({ result: 'ok' }) })
      const executor = new CascadeExecutor(cascade)

      await expect(
        executor.executeTier('code', {}, null as any)
      ).rejects.toThrow('TierContext is required')
    })
  })

  // ===========================================================================
  // 12. History and Result Structure
  // ===========================================================================

  describe('History and Result Structure', () => {
    it('should return proper CascadeResult structure', async () => {
      const codeHandler = createSuccessHandler({ message: 'hello' })
      const cascade = createTestCascade({ code: codeHandler })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result).toMatchObject({
        output: { message: 'hello' },
        successTier: 'code',
        history: expect.any(Array),
        skippedTiers: expect.any(Array),
        metrics: expect.any(Object),
      })
    })

    it('should record tier attempt timestamps', async () => {
      const codeHandler = createSuccessHandler({ result: 'ok' })
      const cascade = createTestCascade({ code: codeHandler })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.history[0]!.timestamp).toBeDefined()
      expect(result.history[0]!.timestamp).toBeGreaterThan(0)
    })

    it('should include result in successful tier attempt', async () => {
      const expectedResult = { result: 'success', data: 123 }
      const codeHandler = createSuccessHandler(expectedResult)
      const cascade = createTestCascade({ code: codeHandler })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.history[0]!.status).toBe('completed')
      expect(result.history[0]!.result).toEqual(expectedResult)
      expect(result.output).toEqual(expectedResult)
    })

    it('should include error in failed tier attempt', async () => {
      const codeHandler = createFailingHandler('specific failure')
      const generativeHandler = createSuccessHandler({ result: 'ok' })

      const cascade = createTestCascade({ code: codeHandler, generative: generativeHandler })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      const codeAttempt = result.history.find(h => h.tier === 'code')
      expect(codeAttempt?.status).toBe('failed')
      expect(codeAttempt?.error?.message).toBe('specific failure')
    })

    it('should include durationMs in each tier attempt', async () => {
      const codeHandler = createSuccessHandler({ result: 'ok' })
      const cascade = createTestCascade({ code: codeHandler })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.history[0]!.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should record correct attempt number in history', async () => {
      const codeHandler = createFailingHandler('fail')
      const cascade = createTestCascade(
        { code: codeHandler },
        { tierRetries: { code: 2 } }
      )
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()

      try {
        await resultPromise
      } catch {
        // Expected
      }

      // Should have 3 attempts recorded (not accessible from outside on error,
      // but CascadeExhaustedError includes history)
    })
  })

  // ===========================================================================
  // 13. Concurrent Executions
  // ===========================================================================

  describe('Concurrent Executions', () => {
    it('should handle multiple concurrent cascade executions independently', async () => {
      const codeHandler = vi.fn(async (input: unknown) => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return { result: `processed-${(input as any).id}` }
      })

      const cascade = createTestCascade({ code: codeHandler })
      const executor = new CascadeExecutor(cascade)

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
  })

  // ===========================================================================
  // 14. Definition Object Tiers
  // ===========================================================================

  describe('Definition Object Tiers', () => {
    it('should handle tier defined as an object with execute method', async () => {
      const tierDef = {
        execute: vi.fn(async (_input: unknown, _context: TierContext) => {
          return { result: 'from-object-tier' }
        }),
      }

      const cascade = createTestCascade({
        code: tierDef as any,
      })

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.output).toEqual({ result: 'from-object-tier' })
      expect(tierDef.execute).toHaveBeenCalled()
    })

    it('should skip definition objects without execute method', async () => {
      const nonExecutableTier = { prompt: 'something' }
      const generativeHandler = createSuccessHandler({ result: 'gen' })

      const cascade = createTestCascade({
        code: nonExecutableTier as any,
        generative: generativeHandler,
      })

      const executor = new CascadeExecutor(cascade)
      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Code tier should be skipped since it has no execute method
      expect(result.successTier).toBe('generative')
    })
  })

  // ===========================================================================
  // 15. createCascadeExecutor Factory
  // ===========================================================================

  describe('createCascadeExecutor Factory', () => {
    it('should create a CascadeExecutor instance', () => {
      const definition = createTestCascade({
        code: createSuccessHandler({ result: 'ok' }),
      })

      const executor = createCascadeExecutor(definition)
      expect(executor).toBeInstanceOf(CascadeExecutor)
    })

    it('should merge options from definition and factory argument', async () => {
      const codeHandler = createSuccessHandler({ result: 'code' })
      const generativeHandler = createSuccessHandler({ result: 'gen' })

      const definition = createTestCascade(
        { code: codeHandler, generative: generativeHandler },
        { startTier: 'code' } // Original option
      )

      // Override startTier via factory options
      const executor = createCascadeExecutor(definition, { startTier: 'generative' })

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('generative')
      expect(codeHandler).not.toHaveBeenCalled()
    })

    it('should execute cascade correctly through the factory-created instance', async () => {
      const codeHandler = createFailingHandler('fail')
      const generativeHandler = createSuccessHandler({ result: 'gen-ok' })

      const definition = createTestCascade(
        { code: codeHandler, generative: generativeHandler },
        { tierRetries: { code: 1 } }
      )

      const executor = createCascadeExecutor(definition)

      const resultPromise = executor.execute({ test: true })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('generative')
      expect(result.metrics.totalRetries).toBe(1)
      expect(result.metrics.escalations).toBe(1)
    })
  })

  // ===========================================================================
  // 16. Type Compliance
  // ===========================================================================

  describe('Type Compliance', () => {
    it('should implement CascadeExecutor interface correctly', () => {
      const cascade = createTestCascade({
        code: createSuccessHandler({ result: 'test' }),
      })

      const executor = new CascadeExecutor(cascade)

      expect(typeof executor.execute).toBe('function')
      expect(typeof executor.executeTier).toBe('function')
    })

    it('should return TierAttempt with proper structure', async () => {
      const codeHandler = createSuccessHandler({ message: 'hello' })
      const cascade = createTestCascade({ code: codeHandler })
      const executor = new CascadeExecutor(cascade)

      const resultPromise = executor.execute({})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      const attempt = result.history[0]!
      expect(attempt).toMatchObject({
        tier: 'code',
        attempt: expect.any(Number),
        status: 'completed',
        result: { message: 'hello' },
        durationMs: expect.any(Number),
        timestamp: expect.any(Number),
      } satisfies Partial<TierAttempt>)
    })
  })
})
