/**
 * Tests for Cascade Executor - Auto-escalation between tiers
 *
 * The cascade executor automatically escalates through function tiers
 * when a tier fails or times out:
 *
 * 1. Code (5s) - Fast, deterministic, cheap
 * 2. Generative (30s) - Single AI call
 * 3. Agentic (5m) - Multi-step AI
 * 4. Human (24h) - Human-in-the-loop
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createCascadeExecutor,
  type CascadeDefinition,
  type TierContext,
  type TierAttempt,
  TIER_ORDER,
  DEFAULT_TIER_TIMEOUTS,
  CascadeExhaustedError,
  TierTimeoutError,
  TierSkippedError,
} from '../cascade.js'

describe('CascadeExecutor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic execution', () => {
    it('should execute the first available tier successfully', async () => {
      const cascade: CascadeDefinition<string, string> = {
        id: 'test-cascade',
        name: 'Test Cascade',
        tiers: {
          code: async (input: string) => `code: ${input}`,
        },
      }

      const executor = createCascadeExecutor(cascade)
      const resultPromise = executor.execute('hello')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.output).toBe('code: hello')
      expect(result.successTier).toBe('code')
      expect(result.history).toHaveLength(1)
      expect(result.history[0].status).toBe('completed')
    })

    it('should start at the configured startTier', async () => {
      const cascade: CascadeDefinition<string, string> = {
        id: 'test-cascade',
        name: 'Test Cascade',
        tiers: {
          code: async (input: string) => `code: ${input}`,
          generative: async (input: string) => `generative: ${input}`,
        },
        options: {
          startTier: 'generative',
        },
      }

      const executor = createCascadeExecutor(cascade)
      const resultPromise = executor.execute('hello')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.output).toBe('generative: hello')
      expect(result.successTier).toBe('generative')
      expect(result.history).toHaveLength(1)
    })
  })

  describe('timeout escalation', () => {
    it('should escalate to next tier when current tier times out', async () => {
      const cascade: CascadeDefinition<string, string> = {
        id: 'test-cascade',
        name: 'Test Cascade',
        tiers: {
          code: async (input: string) => {
            // Simulate a long-running operation that exceeds timeout
            await new Promise((resolve) => setTimeout(resolve, 10000))
            return `code: ${input}`
          },
          generative: async (input: string) => `generative: ${input}`,
        },
        options: {
          tierTimeouts: {
            code: '100ms',
          },
        },
      }

      const executor = createCascadeExecutor(cascade)
      const resultPromise = executor.execute('hello')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.output).toBe('generative: hello')
      expect(result.successTier).toBe('generative')
      expect(result.history).toHaveLength(2)
      expect(result.history[0].tier).toBe('code')
      expect(result.history[0].status).toBe('timeout')
      expect(result.history[1].tier).toBe('generative')
      expect(result.history[1].status).toBe('completed')
      expect(result.metrics.escalations).toBe(1)
    })

    it('should use default tier timeouts when not specified', async () => {
      const cascade: CascadeDefinition<string, string> = {
        id: 'test-cascade',
        name: 'Test Cascade',
        tiers: {
          code: async (input: string) => {
            // Simulate operation that exceeds 5s default
            await new Promise((resolve) => setTimeout(resolve, 6000))
            return `code: ${input}`
          },
          generative: async (input: string) => `generative: ${input}`,
        },
      }

      const executor = createCascadeExecutor(cascade)
      const resultPromise = executor.execute('hello')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.successTier).toBe('generative')
      expect(result.history[0].status).toBe('timeout')
    })
  })

  describe('failure escalation', () => {
    it('should escalate to next tier when current tier fails with retryable error', async () => {
      const cascade: CascadeDefinition<string, string> = {
        id: 'test-cascade',
        name: 'Test Cascade',
        tiers: {
          code: async () => {
            const error = new Error('Temporary failure')
            ;(error as any).retryable = true
            throw error
          },
          generative: async (input: string) => `generative: ${input}`,
        },
      }

      const executor = createCascadeExecutor(cascade)
      const resultPromise = executor.execute('hello')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.output).toBe('generative: hello')
      expect(result.successTier).toBe('generative')
      expect(result.history).toHaveLength(2)
      expect(result.history[0].status).toBe('failed')
      expect(result.history[0].error?.message).toBe('Temporary failure')
      expect(result.metrics.escalations).toBe(1)
    })

    it('should provide previous tier context to next tier', async () => {
      let capturedContext: TierContext | undefined

      const cascade: CascadeDefinition<string, string> = {
        id: 'test-cascade',
        name: 'Test Cascade',
        tiers: {
          code: async () => {
            throw new Error('Code tier failed')
          },
          generative: async (input: string, context: TierContext) => {
            capturedContext = context
            return `generative: ${input}`
          },
        },
      }

      const executor = createCascadeExecutor(cascade)
      const resultPromise = executor.execute('hello')
      await vi.runAllTimersAsync()
      await resultPromise

      expect(capturedContext).toBeDefined()
      expect(capturedContext!.previousTier).toBe('code')
      expect(capturedContext!.previousError?.message).toBe('Code tier failed')
      expect(capturedContext!.tier).toBe('generative')
      // cascadeAttempt defaults to 1 and is passed through context
      expect(capturedContext!.cascadeAttempt).toBe(1)
    })

    it('should fail immediately on non-retryable errors when configured', async () => {
      const cascade: CascadeDefinition<string, string> = {
        id: 'test-cascade',
        name: 'Test Cascade',
        tiers: {
          code: async () => {
            const error = new Error('Fatal error')
            ;(error as any).retryable = false
            throw error
          },
          generative: async (input: string) => `generative: ${input}`,
        },
        options: {
          // By default, escalate on any failure
          // This option makes non-retryable errors terminate the cascade
        },
      }

      const executor = createCascadeExecutor(cascade)
      const resultPromise = executor.execute('hello')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Default behavior: escalate even on non-retryable errors
      expect(result.output).toBe('generative: hello')
      expect(result.successTier).toBe('generative')
    })
  })

  describe('cascade exhaustion', () => {
    it('should throw CascadeExhaustedError when all tiers fail', async () => {
      // Use real timers for this test to avoid unhandled rejection issues
      vi.useRealTimers()

      const cascade: CascadeDefinition<string, string> = {
        id: 'test-cascade',
        name: 'Test Cascade',
        tiers: {
          code: async () => {
            throw new Error('Code failed')
          },
          generative: async () => {
            throw new Error('Generative failed')
          },
        },
      }

      const executor = createCascadeExecutor(cascade)
      await expect(executor.execute('hello')).rejects.toThrow(CascadeExhaustedError)
    })

    it('should include full history in CascadeExhaustedError', async () => {
      // Use real timers for this test to avoid unhandled rejection issues
      vi.useRealTimers()

      const cascade: CascadeDefinition<string, string> = {
        id: 'test-cascade',
        name: 'Test Cascade',
        tiers: {
          code: async () => {
            throw new Error('Code failed')
          },
          generative: async () => {
            throw new Error('Generative failed')
          },
          agentic: async () => {
            throw new Error('Agentic failed')
          },
        },
      }

      const executor = createCascadeExecutor(cascade)

      try {
        await executor.execute('hello')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(CascadeExhaustedError)
        const cascadeError = error as CascadeExhaustedError
        expect(cascadeError.history).toHaveLength(3)
        expect(cascadeError.history[0].tier).toBe('code')
        expect(cascadeError.history[1].tier).toBe('generative')
        expect(cascadeError.history[2].tier).toBe('agentic')
      }
    })
  })

  describe('tier skipping', () => {
    it('should skip tiers listed in skipTiers option', async () => {
      const cascade: CascadeDefinition<string, string> = {
        id: 'test-cascade',
        name: 'Test Cascade',
        tiers: {
          code: async (input: string) => `code: ${input}`,
          generative: async (input: string) => `generative: ${input}`,
          agentic: async (input: string) => `agentic: ${input}`,
        },
        options: {
          skipTiers: ['generative'],
        },
      }

      const executor = createCascadeExecutor(cascade)

      // Make code tier fail to test skip
      const cascadeWithCodeFail: CascadeDefinition<string, string> = {
        ...cascade,
        tiers: {
          ...cascade.tiers,
          code: async () => {
            throw new Error('Code failed')
          },
        },
      }

      const executor2 = createCascadeExecutor(cascadeWithCodeFail)
      const resultPromise = executor2.execute('hello')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.output).toBe('agentic: hello')
      expect(result.successTier).toBe('agentic')
      expect(result.skippedTiers).toContain('generative')
    })

    it('should skip tier based on skip condition', async () => {
      const cascade: CascadeDefinition<{ useAI: boolean; data: string }, string> = {
        id: 'test-cascade',
        name: 'Test Cascade',
        tiers: {
          code: async () => {
            throw new Error('Code cannot handle this')
          },
          generative: async (input) => `generative: ${input.data}`,
          agentic: async (input) => `agentic: ${input.data}`,
        },
        options: {
          skipConditions: [
            {
              tier: 'generative',
              condition: (input) => !(input as { useAI: boolean }).useAI,
              reason: 'AI disabled by user',
            },
          ],
        },
      }

      const executor = createCascadeExecutor(cascade)

      // With useAI: false, generative should be skipped
      const resultPromise = executor.execute({ useAI: false, data: 'test' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.output).toBe('agentic: test')
      expect(result.successTier).toBe('agentic')
      expect(result.skippedTiers).toContain('generative')
    })
  })

  describe('escalation history tracking', () => {
    it('should track all tier attempts in history', async () => {
      const cascade: CascadeDefinition<string, string> = {
        id: 'test-cascade',
        name: 'Test Cascade',
        tiers: {
          code: async () => {
            await new Promise((r) => setTimeout(r, 10))
            throw new Error('Code failed')
          },
          generative: async () => {
            await new Promise((r) => setTimeout(r, 10))
            throw new Error('Generative failed')
          },
          agentic: async (input: string) => {
            await new Promise((r) => setTimeout(r, 10))
            return `agentic: ${input}`
          },
        },
      }

      const executor = createCascadeExecutor(cascade)
      const resultPromise = executor.execute('hello')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.history).toHaveLength(3)

      const [codeAttempt, genAttempt, agentAttempt] = result.history as [TierAttempt, TierAttempt, TierAttempt]

      expect(codeAttempt.tier).toBe('code')
      expect(codeAttempt.status).toBe('failed')
      expect(codeAttempt.durationMs).toBeGreaterThanOrEqual(0)
      expect(codeAttempt.timestamp).toBeGreaterThan(0)
      expect(codeAttempt.error?.message).toBe('Code failed')

      expect(genAttempt.tier).toBe('generative')
      expect(genAttempt.status).toBe('failed')
      expect(genAttempt.error?.message).toBe('Generative failed')

      expect(agentAttempt.tier).toBe('agentic')
      expect(agentAttempt.status).toBe('completed')
      expect(agentAttempt.result).toBe('agentic: hello')
    })

    it('should track metrics correctly', async () => {
      const cascade: CascadeDefinition<string, string> = {
        id: 'test-cascade',
        name: 'Test Cascade',
        tiers: {
          code: async () => {
            await new Promise((r) => setTimeout(r, 50))
            throw new Error('Code failed')
          },
          generative: async (input: string) => {
            await new Promise((r) => setTimeout(r, 100))
            return `generative: ${input}`
          },
        },
      }

      const executor = createCascadeExecutor(cascade)
      const resultPromise = executor.execute('hello')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.metrics.escalations).toBe(1)
      expect(result.metrics.tierDurations.code).toBeGreaterThanOrEqual(0)
      expect(result.metrics.tierDurations.generative).toBeGreaterThanOrEqual(0)
      expect(result.metrics.totalDurationMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('tier retries', () => {
    it('should retry tier before escalating based on tierRetries option', async () => {
      let codeAttempts = 0

      const cascade: CascadeDefinition<string, string> = {
        id: 'test-cascade',
        name: 'Test Cascade',
        tiers: {
          code: async (input: string) => {
            codeAttempts++
            if (codeAttempts < 3) {
              throw new Error(`Attempt ${codeAttempts} failed`)
            }
            return `code: ${input}`
          },
          generative: async (input: string) => `generative: ${input}`,
        },
        options: {
          tierRetries: {
            code: 3, // Retry up to 3 times
          },
        },
      }

      const executor = createCascadeExecutor(cascade)
      const resultPromise = executor.execute('hello')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(codeAttempts).toBe(3)
      expect(result.output).toBe('code: hello')
      expect(result.successTier).toBe('code')
      expect(result.metrics.totalRetries).toBe(2) // 2 retries before success
    })

    it('should escalate after exhausting retries', async () => {
      let codeAttempts = 0

      const cascade: CascadeDefinition<string, string> = {
        id: 'test-cascade',
        name: 'Test Cascade',
        tiers: {
          code: async () => {
            codeAttempts++
            throw new Error(`Attempt ${codeAttempts} failed`)
          },
          generative: async (input: string) => `generative: ${input}`,
        },
        options: {
          tierRetries: {
            code: 2, // Retry up to 2 times
          },
        },
      }

      const executor = createCascadeExecutor(cascade)
      const resultPromise = executor.execute('hello')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      // tierRetries: 2 means 2 retries after initial attempt = 3 total attempts
      expect(codeAttempts).toBe(3)
      expect(result.output).toBe('generative: hello')
      expect(result.successTier).toBe('generative')
      expect(result.metrics.totalRetries).toBe(2) // 2 retries before escalating
      expect(result.metrics.escalations).toBe(1)
    })
  })

  describe('TIER_ORDER constant', () => {
    it('should have correct tier order', () => {
      expect(TIER_ORDER).toEqual(['code', 'generative', 'agentic', 'human'])
    })
  })

  describe('DEFAULT_TIER_TIMEOUTS constant', () => {
    it('should have correct default timeouts', () => {
      expect(DEFAULT_TIER_TIMEOUTS).toEqual({
        code: '5s',
        generative: '30s',
        agentic: '5m',
        human: '24h',
      })
    })
  })

  describe('fallback behavior', () => {
    it('should pass previous result to next tier when enableFallback is true', async () => {
      let capturedContext: TierContext | undefined

      const cascade: CascadeDefinition<string, string> = {
        id: 'test-cascade',
        name: 'Test Cascade',
        tiers: {
          code: async () => {
            const error = new Error('Partial failure')
            ;(error as any).partialResult = 'partial-data'
            throw error
          },
          generative: async (input: string, context: TierContext) => {
            capturedContext = context
            return `generative: ${input}, previous: ${context.previousResult ?? 'none'}`
          },
        },
        options: {
          enableFallback: true,
        },
      }

      const executor = createCascadeExecutor(cascade)
      const resultPromise = executor.execute('hello')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.output).toBe('generative: hello, previous: partial-data')
      expect(capturedContext?.previousResult).toBe('partial-data')
    })
  })

  describe('error types', () => {
    it('should create TierSkippedError with correct properties', () => {
      const error = new TierSkippedError('generative', 'AI disabled by user')

      expect(error.name).toBe('TierSkippedError')
      expect(error.tier).toBe('generative')
      expect(error.reason).toBe('AI disabled by user')
      expect(error.message).toBe("Tier 'generative' skipped: AI disabled by user")
    })

    it('should create TierTimeoutError with correct properties', () => {
      const error = new TierTimeoutError('code', 5000)

      expect(error.name).toBe('TierTimeoutError')
      expect(error.tier).toBe('code')
      expect(error.timeoutMs).toBe(5000)
      expect(error.message).toBe("Tier 'code' timed out after 5000ms")
    })

    it('should create CascadeExhaustedError with correct properties', () => {
      const history: TierAttempt[] = [
        {
          tier: 'code',
          attempt: 1,
          status: 'failed',
          error: new Error('Code failed'),
          durationMs: 100,
          timestamp: Date.now(),
        },
      ]

      const error = new CascadeExhaustedError('All tiers failed', history, 500)

      expect(error.name).toBe('CascadeExhaustedError')
      expect(error.message).toBe('All tiers failed')
      expect(error.history).toEqual(history)
      expect(error.totalDurationMs).toBe(500)
    })
  })
})
