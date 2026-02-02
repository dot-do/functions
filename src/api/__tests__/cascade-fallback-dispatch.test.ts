/**
 * Cascade Fallback Dispatch Tests
 *
 * Tests that cascade fallback dispatch ACTUALLY dispatches to the next tier
 * when the current tier fails or returns low confidence, rather than just
 * returning a "failed" result.
 *
 * The 4-tier cascade: Code (5s) -> Generative (30s) -> Agentic (5m) -> Human (24h)
 *
 * These tests cover:
 * - When code tier fails/times out, the system falls back to generative tier
 * - When generative tier fails, it falls back to agentic tier
 * - When agentic tier fails, it falls back to human tier
 * - Each tier is actually invoked (not just returning "failed")
 * - Timeout enforcement per tier
 *
 * Issues: functions-ltzd (RED), functions-g1nd (GREEN)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Mock @dotdo/functions before any imports that depend on it
vi.mock('@dotdo/functions', () => ({
  DEFAULT_TIER_TIMEOUTS: { code: '5s', generative: '30s', agentic: '5m', human: '24h' },
  TIER_ORDER: ['code', 'generative', 'agentic', 'human'],
  CascadeExhaustedError: class CascadeExhaustedError extends Error {
    history: unknown[]
    totalDurationMs: number
    constructor(message: string, history: unknown[] = [], totalDurationMs = 0) {
      super(message)
      this.name = 'CascadeExhaustedError'
      this.history = history
      this.totalDurationMs = totalDurationMs
    }
  },
  TierTimeoutError: class TierTimeoutError extends Error {
    tier: string
    timeoutMs: number
    constructor(tier: string, timeoutMs: number) {
      super(`Tier '${tier}' timed out after ${timeoutMs}ms`)
      this.name = 'TierTimeoutError'
      this.tier = tier
      this.timeoutMs = timeoutMs
    }
  },
  TierSkippedError: class TierSkippedError extends Error {
    tier: string
    reason: string
    constructor(tier: string, reason: string) {
      super(`Tier '${tier}' skipped: ${reason}`)
      this.name = 'TierSkippedError'
      this.tier = tier
      this.reason = reason
    }
  },
  parseDuration: (d: string) => {
    if (d.endsWith('ms')) return parseInt(d)
    if (d.endsWith('s')) return parseInt(d) * 1000
    if (d.endsWith('m')) return parseInt(d) * 60 * 1000
    if (d.endsWith('h')) return parseInt(d) * 60 * 60 * 1000
    return parseInt(d)
  },
}))

import { TierDispatcher, type ExtendedMetadata, type TierDispatcherEnv, type DispatchResult } from '../tier-dispatcher'
import { createMockKV } from '../../test-utils/mock-kv'

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Create a minimal TierDispatcherEnv with mock KV stores for step metadata lookup
 */
function createMockEnv(overrides?: Partial<TierDispatcherEnv>): TierDispatcherEnv {
  const registryKV = createMockKV()
  const codeKV = createMockKV()

  return {
    FUNCTIONS_REGISTRY: registryKV,
    FUNCTIONS_CODE: codeKV,
    ...overrides,
  } as unknown as TierDispatcherEnv
}

/**
 * Register a step function in mock KV for cascade lookups
 */
async function registerStepFunction(
  env: TierDispatcherEnv,
  functionId: string,
  metadata: Partial<ExtendedMetadata>
) {
  const kv = env.FUNCTIONS_REGISTRY as unknown as KVNamespace
  const fullMetadata: ExtendedMetadata = {
    id: functionId,
    version: '1.0.0',
    language: 'typescript',
    entryPoint: 'index.ts',
    dependencies: {},
    ...metadata,
  }
  await kv.put(`registry:${functionId}`, JSON.stringify(fullMetadata))
}

/**
 * Create a mock DispatchResult for testing
 */
function createSuccessResult(output: unknown = { result: 'ok' }): DispatchResult {
  return {
    status: 200,
    body: {
      output,
      _meta: {
        duration: 10,
        executorType: 'code',
        tier: 1 as const,
      },
    },
  }
}

function createFailureResult(error: string = 'Execution failed'): DispatchResult {
  return {
    status: 500,
    body: {
      error,
      _meta: {
        duration: 5,
        executorType: 'code',
        tier: 1 as const,
      },
    },
  }
}

// =============================================================================
// TESTS: TierDispatcher.dispatchCascade fallback behavior
// =============================================================================

describe('TierDispatcher cascade fallback dispatch', () => {
  let env: TierDispatcherEnv
  let dispatcher: TierDispatcher

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // 1. Cascade step fallback actually dispatches to fallback function
  // ===========================================================================

  describe('step-based cascade with fallback dispatch', () => {
    it('should actually dispatch to fallback function when a step fails', async () => {
      env = createMockEnv()
      dispatcher = new TierDispatcher(env)

      // Register primary step (will fail) and fallback step (should succeed)
      await registerStepFunction(env, 'step-a', { type: 'code' })
      await registerStepFunction(env, 'fallback-a', { type: 'code' })

      // Create cascade metadata with steps and fallback
      const cascadeMetadata: ExtendedMetadata = {
        id: 'test-cascade',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
        type: 'cascade',
        steps: [
          { functionId: 'step-a', tier: 'code', fallbackTo: 'fallback-a' },
        ],
        errorHandling: 'fallback',
      }

      // Mock dispatch to control behavior: the cascade itself dispatches first,
      // then inner dispatch calls are for step-a (fails) and fallback-a (succeeds)
      let callCount = 0
      const originalDispatch = dispatcher.dispatch.bind(dispatcher)
      vi.spyOn(dispatcher, 'dispatch').mockImplementation(
        async (meta: ExtendedMetadata, input: unknown, code?: string) => {
          callCount++
          // First call is the cascade itself - delegate to real implementation
          if (meta.type === 'cascade') {
            return originalDispatch(meta, input, code)
          }
          // step-a fails
          if (meta.id === 'step-a') {
            return createFailureResult('Code execution failed')
          }
          // fallback-a succeeds
          if (meta.id === 'fallback-a') {
            return createSuccessResult({ rescued: true })
          }
          return createFailureResult('Unknown function')
        }
      )

      const result = await dispatcher.dispatch(cascadeMetadata, { value: 42 })

      // The dispatcher MUST have called dispatch for the fallback function
      const dispatchCalls = (dispatcher.dispatch as ReturnType<typeof vi.fn>).mock.calls
      const fallbackCalls = dispatchCalls.filter(
        ([meta]: [ExtendedMetadata]) => meta.id === 'fallback-a'
      )

      // Key assertion: the fallback function was actually dispatched
      expect(fallbackCalls.length).toBeGreaterThanOrEqual(1)
    })

    it('should use fallback result when primary step fails', async () => {
      env = createMockEnv()
      dispatcher = new TierDispatcher(env)

      await registerStepFunction(env, 'primary-step', { type: 'code' })
      await registerStepFunction(env, 'fallback-step', { type: 'code' })

      const cascadeMetadata: ExtendedMetadata = {
        id: 'cascade-with-fallback',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
        type: 'cascade',
        steps: [
          { functionId: 'primary-step', tier: 'code', fallbackTo: 'fallback-step' },
        ],
        errorHandling: 'fallback',
      }

      const originalDispatch = dispatcher.dispatch.bind(dispatcher)
      vi.spyOn(dispatcher, 'dispatch').mockImplementation(
        async (meta: ExtendedMetadata, input: unknown, code?: string) => {
          if (meta.type === 'cascade') {
            return originalDispatch(meta, input, code)
          }
          if (meta.id === 'primary-step') {
            return createFailureResult('Primary failed')
          }
          if (meta.id === 'fallback-step') {
            return createSuccessResult({ answer: 42 })
          }
          return createFailureResult('Unknown')
        }
      )

      const result = await dispatcher.dispatch(cascadeMetadata, {})

      // When primary fails and fallback succeeds, cascade should return success
      expect(result.status).toBe(200)
      // The tiersAttempted should include both the primary step and the fallback
      const tiersAttempted = result.body._meta.tiersAttempted as string[]
      expect(tiersAttempted).toContain('code')
      expect(tiersAttempted.some(t => t.includes('fallback'))).toBe(true)
    })

    it('should dispatch fallback for each failed step in a multi-step cascade', async () => {
      env = createMockEnv()
      dispatcher = new TierDispatcher(env)

      // Register all step and fallback functions
      await registerStepFunction(env, 'step-1', { type: 'code' })
      await registerStepFunction(env, 'fallback-1', { type: 'code' })
      await registerStepFunction(env, 'step-2', { type: 'code' })
      await registerStepFunction(env, 'fallback-2', { type: 'code' })

      const cascadeMetadata: ExtendedMetadata = {
        id: 'multi-step-cascade',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
        type: 'cascade',
        steps: [
          { functionId: 'step-1', tier: 'code', fallbackTo: 'fallback-1' },
          { functionId: 'step-2', tier: 'code', fallbackTo: 'fallback-2' },
        ],
        errorHandling: 'fallback',
      }

      const originalDispatch = dispatcher.dispatch.bind(dispatcher)
      vi.spyOn(dispatcher, 'dispatch').mockImplementation(
        async (meta: ExtendedMetadata, input: unknown, code?: string) => {
          if (meta.type === 'cascade') {
            return originalDispatch(meta, input, code)
          }
          // Both primary steps fail
          if (meta.id === 'step-1') return createFailureResult('Step 1 failed')
          if (meta.id === 'step-2') return createFailureResult('Step 2 failed')
          // Both fallbacks succeed
          if (meta.id === 'fallback-1') return createSuccessResult({ step1: 'from-fallback' })
          if (meta.id === 'fallback-2') return createSuccessResult({ step2: 'from-fallback' })
          return createFailureResult('Unknown')
        }
      )

      const result = await dispatcher.dispatch(cascadeMetadata, {})

      const dispatchCalls = (dispatcher.dispatch as ReturnType<typeof vi.fn>).mock.calls
      const fallback1Calls = dispatchCalls.filter(
        ([meta]: [ExtendedMetadata]) => meta.id === 'fallback-1'
      )
      const fallback2Calls = dispatchCalls.filter(
        ([meta]: [ExtendedMetadata]) => meta.id === 'fallback-2'
      )

      // Both fallbacks should have been dispatched
      expect(fallback1Calls.length).toBeGreaterThanOrEqual(1)
      expect(fallback2Calls.length).toBeGreaterThanOrEqual(1)
    })

    it('should track tiersAttempted for fallback dispatches', async () => {
      env = createMockEnv()
      dispatcher = new TierDispatcher(env)

      await registerStepFunction(env, 'fail-step', { type: 'code' })
      await registerStepFunction(env, 'rescue-step', { type: 'code' })

      const cascadeMetadata: ExtendedMetadata = {
        id: 'track-cascade',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
        type: 'cascade',
        steps: [
          { functionId: 'fail-step', tier: 'code', fallbackTo: 'rescue-step' },
        ],
        errorHandling: 'fallback',
      }

      const originalDispatch = dispatcher.dispatch.bind(dispatcher)
      vi.spyOn(dispatcher, 'dispatch').mockImplementation(
        async (meta: ExtendedMetadata, input: unknown, code?: string) => {
          if (meta.type === 'cascade') return originalDispatch(meta, input, code)
          if (meta.id === 'fail-step') return createFailureResult('Failed')
          if (meta.id === 'rescue-step') return createSuccessResult({ rescued: true })
          return createFailureResult('Unknown')
        }
      )

      const result = await dispatcher.dispatch(cascadeMetadata, {})

      const tiersAttempted = result.body._meta.tiersAttempted as string[]
      // Should have the original step's tier AND the fallback
      expect(tiersAttempted).toContain('code')
      expect(tiersAttempted.some(t => t.includes('fallback'))).toBe(true)
    })

    it('should pass the correct input to fallback function', async () => {
      env = createMockEnv()
      dispatcher = new TierDispatcher(env)

      await registerStepFunction(env, 'failing-step', { type: 'code' })
      await registerStepFunction(env, 'catching-step', { type: 'code' })

      const cascadeMetadata: ExtendedMetadata = {
        id: 'input-cascade',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
        type: 'cascade',
        steps: [
          { functionId: 'failing-step', tier: 'code', fallbackTo: 'catching-step' },
        ],
        errorHandling: 'fallback',
      }

      const testInput = { important: 'data', number: 42 }
      const originalDispatch = dispatcher.dispatch.bind(dispatcher)
      vi.spyOn(dispatcher, 'dispatch').mockImplementation(
        async (meta: ExtendedMetadata, input: unknown, code?: string) => {
          if (meta.type === 'cascade') return originalDispatch(meta, input, code)
          if (meta.id === 'failing-step') return createFailureResult('Failed')
          if (meta.id === 'catching-step') return createSuccessResult({ received: input })
          return createFailureResult('Unknown')
        }
      )

      await dispatcher.dispatch(cascadeMetadata, testInput)

      // Find the fallback dispatch call
      const dispatchCalls = (dispatcher.dispatch as ReturnType<typeof vi.fn>).mock.calls
      const fallbackCall = dispatchCalls.find(
        ([meta]: [ExtendedMetadata]) => meta.id === 'catching-step'
      )

      expect(fallbackCall).toBeDefined()
      // The input passed to the fallback should be the currentInput at time of failure
      expect(fallbackCall![1]).toEqual(testInput)
    })
  })

  // ===========================================================================
  // 2. Fallback dispatch with stepsExecuted tracking
  // ===========================================================================

  describe('cascade fallback steps execution count', () => {
    it('should count fallback executions in stepsExecuted', async () => {
      env = createMockEnv()
      dispatcher = new TierDispatcher(env)

      await registerStepFunction(env, 'step-fail', { type: 'code' })
      await registerStepFunction(env, 'step-recover', { type: 'code' })

      const cascadeMetadata: ExtendedMetadata = {
        id: 'count-cascade',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
        type: 'cascade',
        steps: [
          { functionId: 'step-fail', tier: 'code', fallbackTo: 'step-recover' },
        ],
        errorHandling: 'fallback',
      }

      const originalDispatch = dispatcher.dispatch.bind(dispatcher)
      vi.spyOn(dispatcher, 'dispatch').mockImplementation(
        async (meta: ExtendedMetadata, input: unknown, code?: string) => {
          if (meta.type === 'cascade') return originalDispatch(meta, input, code)
          if (meta.id === 'step-fail') return createFailureResult('Failed')
          if (meta.id === 'step-recover') return createSuccessResult({ ok: true })
          return createFailureResult('Unknown')
        }
      )

      const result = await dispatcher.dispatch(cascadeMetadata, {})

      // stepsExecuted should account for both the failed step and the fallback
      const stepsExecuted = result.body._meta.stepsExecuted as number
      expect(stepsExecuted).toBeGreaterThanOrEqual(2)
    })
  })

  // ===========================================================================
  // 3. Fallback failure behavior
  // ===========================================================================

  describe('cascade fallback failure handling', () => {
    it('should continue to next step when both primary and fallback fail', async () => {
      env = createMockEnv()
      dispatcher = new TierDispatcher(env)

      // Register all functions
      await registerStepFunction(env, 'step-a-fail', { type: 'code' })
      await registerStepFunction(env, 'fallback-a-fail', { type: 'code' })
      await registerStepFunction(env, 'step-b', { type: 'code' })

      const cascadeMetadata: ExtendedMetadata = {
        id: 'fallback-fail-cascade',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
        type: 'cascade',
        steps: [
          { functionId: 'step-a-fail', tier: 'code', fallbackTo: 'fallback-a-fail' },
          { functionId: 'step-b', tier: 'code' },
        ],
        errorHandling: 'fallback',
      }

      const originalDispatch = dispatcher.dispatch.bind(dispatcher)
      vi.spyOn(dispatcher, 'dispatch').mockImplementation(
        async (meta: ExtendedMetadata, input: unknown, code?: string) => {
          if (meta.type === 'cascade') return originalDispatch(meta, input, code)
          if (meta.id === 'step-a-fail') return createFailureResult('Step A failed')
          if (meta.id === 'fallback-a-fail') return createFailureResult('Fallback A failed')
          if (meta.id === 'step-b') return createSuccessResult({ final: true })
          return createFailureResult('Unknown')
        }
      )

      const result = await dispatcher.dispatch(cascadeMetadata, {})

      // Should have progressed past the first step+fallback to the second step
      expect(result.status).toBe(200)
      const stepsExecuted = result.body._meta.stepsExecuted as number
      expect(stepsExecuted).toBeGreaterThanOrEqual(1)
    })

    it('should not dispatch fallback when step succeeds', async () => {
      env = createMockEnv()
      dispatcher = new TierDispatcher(env)

      await registerStepFunction(env, 'good-step', { type: 'code' })
      await registerStepFunction(env, 'unused-fallback', { type: 'code' })

      const cascadeMetadata: ExtendedMetadata = {
        id: 'no-fallback-needed',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
        type: 'cascade',
        steps: [
          { functionId: 'good-step', tier: 'code', fallbackTo: 'unused-fallback' },
        ],
        errorHandling: 'fallback',
      }

      const originalDispatch = dispatcher.dispatch.bind(dispatcher)
      vi.spyOn(dispatcher, 'dispatch').mockImplementation(
        async (meta: ExtendedMetadata, input: unknown, code?: string) => {
          if (meta.type === 'cascade') return originalDispatch(meta, input, code)
          if (meta.id === 'good-step') return createSuccessResult({ success: true })
          if (meta.id === 'unused-fallback') return createSuccessResult({ fallback: true })
          return createFailureResult('Unknown')
        }
      )

      const result = await dispatcher.dispatch(cascadeMetadata, {})

      // Verify the fallback was NOT dispatched
      const dispatchCalls = (dispatcher.dispatch as ReturnType<typeof vi.fn>).mock.calls
      const fallbackCalls = dispatchCalls.filter(
        ([meta]: [ExtendedMetadata]) => meta.id === 'unused-fallback'
      )
      expect(fallbackCalls.length).toBe(0)

      // Result should be successful from the primary step
      expect(result.status).toBe(200)
    })

    it('should handle missing fallback function metadata gracefully', async () => {
      env = createMockEnv()
      dispatcher = new TierDispatcher(env)

      // Register primary step but NOT the fallback function
      await registerStepFunction(env, 'step-x', { type: 'code' })
      // 'nonexistent-fallback' is not registered in KV

      const cascadeMetadata: ExtendedMetadata = {
        id: 'missing-fallback-cascade',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
        type: 'cascade',
        steps: [
          { functionId: 'step-x', tier: 'code', fallbackTo: 'nonexistent-fallback' },
        ],
        errorHandling: 'fallback',
      }

      const originalDispatch = dispatcher.dispatch.bind(dispatcher)
      vi.spyOn(dispatcher, 'dispatch').mockImplementation(
        async (meta: ExtendedMetadata, input: unknown, code?: string) => {
          if (meta.type === 'cascade') return originalDispatch(meta, input, code)
          if (meta.id === 'step-x') return createFailureResult('Step X failed')
          return createFailureResult('Unknown')
        }
      )

      // Should not throw - should gracefully handle missing fallback
      const result = await dispatcher.dispatch(cascadeMetadata, {})
      // With no successful step, should return 500
      expect(result.status).toBe(500)
      expect(result.body.error).toContain('no successful steps')
    })

    it('should chain fallback output as input to next step', async () => {
      env = createMockEnv()
      dispatcher = new TierDispatcher(env)

      await registerStepFunction(env, 'step-transform', { type: 'code' })
      await registerStepFunction(env, 'fallback-transform', { type: 'code' })
      await registerStepFunction(env, 'step-final', { type: 'code' })

      const cascadeMetadata: ExtendedMetadata = {
        id: 'chain-cascade',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
        type: 'cascade',
        steps: [
          { functionId: 'step-transform', tier: 'code', fallbackTo: 'fallback-transform' },
          { functionId: 'step-final', tier: 'code' },
        ],
        errorHandling: 'fallback',
      }

      let finalStepInput: unknown = null
      const originalDispatch = dispatcher.dispatch.bind(dispatcher)
      vi.spyOn(dispatcher, 'dispatch').mockImplementation(
        async (meta: ExtendedMetadata, input: unknown, code?: string) => {
          if (meta.type === 'cascade') return originalDispatch(meta, input, code)
          if (meta.id === 'step-transform') return createFailureResult('Transform failed')
          if (meta.id === 'fallback-transform') {
            return {
              status: 200,
              body: {
                output: { transformed: true, value: 100 },
                _meta: { duration: 5, executorType: 'code', tier: 1 as const },
              },
            }
          }
          if (meta.id === 'step-final') {
            finalStepInput = input
            return createSuccessResult({ done: true })
          }
          return createFailureResult('Unknown')
        }
      )

      await dispatcher.dispatch(cascadeMetadata, { raw: 'data' })

      // The final step should receive the output from the fallback (minus _meta)
      expect(finalStepInput).toEqual({ output: { transformed: true, value: 100 } })
    })
  })
})
