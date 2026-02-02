/**
 * E2E Tests: Agentic Function Error Handling
 *
 * Tests for timeout behavior, error recovery, and edge cases
 * in agentic functions.
 */

import { describe, it, expect, afterAll } from 'vitest'
import {
  E2E_CONFIG,
  generateTestFunctionId,
  shouldRunE2E,
  deleteFunction,
} from './config'
import {
  deployAgenticFunction,
  invokeAgenticFunction,
  AGENTIC_TIMEOUT,
} from './helpers/agentic'

describe.skipIf(!shouldRunE2E())('E2E: Agentic Function Error Handling', () => {
  const deployedFunctions: string[] = []

  afterAll(async () => {
    if (!E2E_CONFIG.skipCleanup) {
      for (const functionId of deployedFunctions) {
        try {
          await deleteFunction(functionId)
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  })

  // ===========================================================================
  // Timeout Behavior
  // ===========================================================================

  describe('Timeout Behavior', () => {
    it('respects function timeout', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'You are a slow agent that takes time to think.',
        goal: 'Complete a slow task',
        timeout: '10s',
        maxIterations: 100,
        tools: [
          {
            name: 'slow_task',
            description: 'A task that takes time',
            inputSchema: { type: 'object', properties: {} },
            implementation: {
              type: 'inline',
              code: `
                const start = Date.now();
                while (Date.now() - start < 2000) {} // Busy wait 2 seconds
                return { done: true }
              `,
            },
          },
        ],
      })

      const result = await invokeAgenticFunction(
        functionId,
        {},
        { timeout: 30_000 }
      )

      expect(result.status).toBe('timeout')
    }, 60_000)

    it('returns partial result on timeout', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Collect as many items as possible.',
        goal: 'Collect items until timeout',
        timeout: '5s',
        maxIterations: 100,
        outputSchema: {
          type: 'object',
          properties: {
            itemsCollected: { type: 'number' },
            timedOut: { type: 'boolean' },
          },
        },
        tools: [
          {
            name: 'collect',
            description: 'Collect an item (takes 1 second)',
            inputSchema: { type: 'object', properties: {} },
            implementation: {
              type: 'inline',
              code: `
                const start = Date.now();
                while (Date.now() - start < 1000) {} // 1 second
                return { item: Date.now() }
              `,
            },
          },
        ],
      })

      const result = await invokeAgenticFunction<{
        itemsCollected: number
        timedOut: boolean
      }>(functionId, {}, { timeout: 30_000 })

      expect(result.status).toBe('timeout')
      expect(result.output).toBeDefined()
      expect(result.output?.itemsCollected).toBeGreaterThan(0)
      expect(result.output?.itemsCollected).toBeLessThan(100)
    }, 60_000)

    it('provides execution trace even on timeout', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Keep working.',
        goal: 'Work until stopped',
        timeout: '5s',
        maxIterations: 100,
        tools: [
          {
            name: 'work',
            description: 'Do some work',
            inputSchema: { type: 'object', properties: {} },
            implementation: {
              type: 'inline',
              code: 'const start = Date.now(); while (Date.now() - start < 500) {}; return { worked: true }',
            },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {}, { timeout: 30_000 })

      expect(result.status).toBe('timeout')

      expect(result.agenticExecution).toBeDefined()
      expect(result.agenticExecution.trace.length).toBeGreaterThan(0)
      expect(result.agenticExecution.iterations).toBeGreaterThan(0)
    }, 60_000)

    it('timeout within iteration still records iteration', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Call the slow tool.',
        goal: 'Complete slow operation',
        timeout: '3s',
        tools: [
          {
            name: 'very_slow',
            description: 'Very slow operation',
            inputSchema: { type: 'object', properties: {} },
            implementation: {
              type: 'inline',
              code: 'const start = Date.now(); while (Date.now() - start < 10000) {}; return { done: true }',
            },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {}, { timeout: 30_000 })

      expect(result.status).toBe('timeout')

      expect(result.agenticExecution.iterations).toBeGreaterThanOrEqual(1)

      const lastIteration = result.agenticExecution.trace[result.agenticExecution.trace.length - 1]
      expect(lastIteration).toBeDefined()
    }, 60_000)
  })

  // ===========================================================================
  // Error Recovery
  // ===========================================================================

  describe('Error Recovery', () => {
    it('handles tool failure gracefully', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Try to complete the task. If a tool fails, try another approach.',
        goal: 'Complete the task despite failures',
        tools: [
          {
            name: 'failing_tool',
            description: 'This tool always fails',
            inputSchema: { type: 'object', properties: {} },
            implementation: {
              type: 'inline',
              code: 'throw new Error("Intentional failure for testing")',
            },
          },
          {
            name: 'working_tool',
            description: 'This tool works fine',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'return { success: true }' },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {}, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')
      expect(result.agenticExecution.goalAchieved).toBe(true)

      const allToolCalls = result.agenticExecution.trace.flatMap((iter) => iter.toolCalls)
      const failedCall = allToolCalls.find((c) => c.tool === 'failing_tool')
      const successCall = allToolCalls.find((c) => c.tool === 'working_tool')

      expect(failedCall?.success).toBe(false)
      expect(failedCall?.error).toContain('Intentional failure')
      expect(successCall?.success).toBe(true)
    }, AGENTIC_TIMEOUT)

    it('agent retries on transient failure', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'If a tool fails, try calling it again.',
        goal: 'Successfully call the flaky tool',
        tools: [
          {
            name: 'flaky_tool',
            description: 'This tool sometimes fails, retry if it does',
            inputSchema: {
              type: 'object',
              properties: {
                attempt: { type: 'number' },
              },
            },
            implementation: {
              type: 'inline',
              code: `
                // Simulate: fail first 2 attempts, succeed on 3rd
                if (input.attempt < 3) {
                  throw new Error('Transient failure, please retry');
                }
                return { success: true };
              `,
            },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {}, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')

      const flakyCalls = result.agenticExecution.trace
        .flatMap((iter) => iter.toolCalls)
        .filter((c) => c.tool === 'flaky_tool')

      expect(flakyCalls.length).toBeGreaterThanOrEqual(2)
      expect(flakyCalls.some((c) => !c.success)).toBe(true)
      expect(flakyCalls.some((c) => c.success)).toBe(true)
    }, AGENTIC_TIMEOUT)

    it('agent adapts when tool unavailable', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: `You have two ways to get data:
          - primary_source: preferred but may fail
          - backup_source: always works
          If primary fails, use backup.`,
        goal: 'Get the data from any available source',
        tools: [
          {
            name: 'primary_source',
            description: 'Primary data source (may be unavailable)',
            inputSchema: { type: 'object', properties: {} },
            implementation: {
              type: 'inline',
              code: 'throw new Error("Primary source is down")',
            },
          },
          {
            name: 'backup_source',
            description: 'Backup data source (always available)',
            inputSchema: { type: 'object', properties: {} },
            implementation: {
              type: 'inline',
              code: 'return { data: "from_backup", source: "backup" }',
            },
          },
        ],
        outputSchema: {
          type: 'object',
          properties: {
            data: { type: 'string' },
            source: { type: 'string' },
          },
        },
      })

      const result = await invokeAgenticFunction<{
        data: string
        source: string
      }>(functionId, {}, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')
      expect(result.agenticExecution.goalAchieved).toBe(true)

      const primaryCall = result.agenticExecution.trace
        .flatMap((iter) => iter.toolCalls)
        .find((c) => c.tool === 'primary_source')
      expect(primaryCall?.success).toBe(false)

      const backupCall = result.agenticExecution.trace
        .flatMap((iter) => iter.toolCalls)
        .find((c) => c.tool === 'backup_source')
      expect(backupCall?.success).toBe(true)

      expect(result.output?.source).toBe('backup')
    }, AGENTIC_TIMEOUT)

    it('records error details in trace', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Call the error tool to see what happens.',
        goal: 'Test error handling',
        tools: [
          {
            name: 'error_tool',
            description: 'This tool throws a detailed error',
            inputSchema: { type: 'object', properties: {} },
            implementation: {
              type: 'inline',
              code: 'throw new Error("Detailed error message: code=E123, reason=test")',
            },
          },
          {
            name: 'success_tool',
            description: 'Fallback tool that works',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'return { ok: true }' },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {}, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')

      const errorCall = result.agenticExecution.trace
        .flatMap((iter) => iter.toolCalls)
        .find((c) => c.tool === 'error_tool')

      expect(errorCall).toBeDefined()
      expect(errorCall?.success).toBe(false)
      expect(errorCall?.error).toBeDefined()
      expect(errorCall?.error).toContain('E123')
      expect(errorCall?.error).toContain('reason=test')
    }, AGENTIC_TIMEOUT)

    it('fails gracefully when all tools fail', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Try all available tools.',
        goal: 'Complete task using tools',
        maxIterations: 5,
        tools: [
          {
            name: 'tool1',
            description: 'Tool 1 (broken)',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'throw new Error("Tool 1 broken")' },
          },
          {
            name: 'tool2',
            description: 'Tool 2 (broken)',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'throw new Error("Tool 2 broken")' },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {}, { timeout: AGENTIC_TIMEOUT })

      expect(['completed', 'failed']).toContain(result.status)

      if (result.status === 'failed') {
        expect(result.error).toBeDefined()
        expect(result.error?.message).toBeDefined()
      }

      const allToolCalls = result.agenticExecution.trace.flatMap((iter) => iter.toolCalls)
      expect(allToolCalls.every((c) => !c.success)).toBe(true)
    }, AGENTIC_TIMEOUT)
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Edge Cases', () => {
    it('handles empty tools array', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'You have no tools available.',
        goal: 'Answer the question directly',
        tools: [],
      })

      const result = await invokeAgenticFunction(functionId, {
        question: 'What is 2 + 2?',
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')
      expect(result.agenticExecution.toolsUsed).toHaveLength(0)
    }, AGENTIC_TIMEOUT)

    it('handles very long input', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Summarize the provided text.',
        goal: 'Create a summary',
        tools: [
          {
            name: 'summarize',
            description: 'Summarize text',
            inputSchema: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                maxLength: { type: 'number' },
              },
            },
            implementation: {
              type: 'inline',
              code: 'return { summary: input.text.substring(0, input.maxLength || 100) + "..." }',
            },
          },
        ],
      })

      const longText = 'Lorem ipsum '.repeat(1000)

      const result = await invokeAgenticFunction(functionId, {
        text: longText,
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')
      expect(result.metrics.inputSizeBytes).toBeGreaterThan(10000)
    }, AGENTIC_TIMEOUT)

    it('handles unicode in input and output', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Process text with unicode characters.',
        goal: 'Echo back unicode text',
        tools: [
          {
            name: 'echo',
            description: 'Echo text',
            inputSchema: {
              type: 'object',
              properties: {
                text: { type: 'string' },
              },
            },
            implementation: {
              type: 'inline',
              code: 'return { echoed: input.text }',
            },
          },
        ],
      })

      const unicodeText = 'Hello World Chinese characters'

      const result = await invokeAgenticFunction(functionId, {
        text: unicodeText,
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')
    }, AGENTIC_TIMEOUT)

    it('tracks model used in response', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        model: 'claude-3-haiku',
        systemPrompt: 'Complete task.',
        goal: 'Simple task',
        tools: [
          {
            name: 'task',
            description: 'Do task',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'return { done: true }' },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {}, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')
      expect(result.agenticExecution.model).toBe('claude-3-haiku')
    }, AGENTIC_TIMEOUT)
  })
})
