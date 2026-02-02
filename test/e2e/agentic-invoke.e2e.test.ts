/**
 * E2E Tests: Agentic Function Invoke
 *
 * Tests for invoking agentic functions including simple execution,
 * multi-tool agents, iteration tracking, and cost tracking.
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
  AGENTIC_DEPLOY_TIMEOUT,
} from './helpers/agentic'

describe.skipIf(!shouldRunE2E())('E2E: Agentic Function Invoke', () => {
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
  // Simple Agent Execution
  // ===========================================================================

  describe('Simple Agent Execution', () => {
    it('executes agent with one tool and returns result', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'You are a calculator agent. Use the add tool to add numbers.',
        goal: 'Calculate the sum of two numbers provided by the user',
        tools: [
          {
            name: 'add',
            description: 'Add two numbers together',
            inputSchema: {
              type: 'object',
              properties: {
                a: { type: 'number', description: 'First number' },
                b: { type: 'number', description: 'Second number' },
              },
              required: ['a', 'b'],
            },
            implementation: {
              type: 'inline',
              code: 'return { sum: input.a + input.b }',
            },
          },
        ],
        outputSchema: {
          type: 'object',
          properties: {
            result: { type: 'number' },
          },
          required: ['result'],
        },
      })

      const result = await invokeAgenticFunction<{ result: number }>(functionId, {
        task: 'Add 5 and 3',
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')
      expect(result.output?.result).toBe(8)
      expect(result.agenticExecution.goalAchieved).toBe(true)
    }, AGENTIC_TIMEOUT)

    it('agent calls tool during execution', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'You must use the greet tool to greet people.',
        goal: 'Greet the user by name',
        tools: [
          {
            name: 'greet',
            description: 'Generate a greeting for a person',
            inputSchema: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Name to greet' },
              },
              required: ['name'],
            },
            implementation: {
              type: 'inline',
              code: 'return { greeting: `Hello, ${input.name}!` }',
            },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {
        name: 'Alice',
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')
      expect(result.agenticExecution.toolsUsed).toContain('greet')
      expect(result.agenticExecution.trace.length).toBeGreaterThan(0)

      const greetCall = result.agenticExecution.trace
        .flatMap((iter) => iter.toolCalls)
        .find((call) => call.tool === 'greet')

      expect(greetCall).toBeDefined()
      expect(greetCall?.input).toEqual({ name: 'Alice' })
      expect(greetCall?.success).toBe(true)
    }, AGENTIC_TIMEOUT)

    it('agent returns structured output matching schema', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'You analyze sentiment in text.',
        goal: 'Analyze the sentiment of the given text',
        tools: [
          {
            name: 'analyze_text',
            description: 'Analyze text sentiment',
            inputSchema: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'Text to analyze' },
              },
              required: ['text'],
            },
            implementation: {
              type: 'inline',
              code: `
                const text = input.text.toLowerCase();
                if (text.includes('happy') || text.includes('great')) {
                  return { sentiment: 'positive', score: 0.9 };
                } else if (text.includes('sad') || text.includes('bad')) {
                  return { sentiment: 'negative', score: 0.8 };
                }
                return { sentiment: 'neutral', score: 0.5 };
              `,
            },
          },
        ],
        outputSchema: {
          type: 'object',
          properties: {
            sentiment: { type: 'string' },
            score: { type: 'number' },
            explanation: { type: 'string' },
          },
          required: ['sentiment', 'score'],
        },
      })

      const result = await invokeAgenticFunction<{
        sentiment: string
        score: number
        explanation?: string
      }>(functionId, {
        text: 'I am so happy today!',
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')
      expect(result.output).toBeDefined()
      expect(['positive', 'negative', 'neutral']).toContain(result.output?.sentiment)
      expect(typeof result.output?.score).toBe('number')
      expect(result.output?.score).toBeGreaterThanOrEqual(0)
      expect(result.output?.score).toBeLessThanOrEqual(1)
    }, AGENTIC_TIMEOUT)
  })

  // ===========================================================================
  // Multi-Tool Agent
  // ===========================================================================

  describe('Multi-Tool Agent', () => {
    it('executes agent with multiple tools', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: `You are a research assistant. You have access to multiple tools:
          - search: to find information
          - summarize: to summarize content
          - format: to format the final output
          Use them in sequence to complete research tasks.`,
        goal: 'Research a topic and provide a formatted summary',
        tools: [
          {
            name: 'search',
            description: 'Search for information on a topic',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query' },
              },
              required: ['query'],
            },
            implementation: {
              type: 'inline',
              code: 'return { results: [`Result 1 for ${input.query}`, `Result 2 for ${input.query}`] }',
            },
          },
          {
            name: 'summarize',
            description: 'Summarize a list of results',
            inputSchema: {
              type: 'object',
              properties: {
                results: { type: 'array', description: 'Results to summarize' },
              },
              required: ['results'],
            },
            implementation: {
              type: 'inline',
              code: 'return { summary: `Summary of ${input.results.length} results` }',
            },
          },
          {
            name: 'format',
            description: 'Format the summary for output',
            inputSchema: {
              type: 'object',
              properties: {
                summary: { type: 'string', description: 'Summary to format' },
                style: { type: 'string', description: 'Output style' },
              },
              required: ['summary'],
            },
            implementation: {
              type: 'inline',
              code: 'return { formatted: `[${input.style || "default"}] ${input.summary}` }',
            },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {
        topic: 'artificial intelligence',
        outputStyle: 'academic',
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')
      expect(result.agenticExecution.toolsUsed).toContain('search')
      expect(result.agenticExecution.toolsUsed).toContain('summarize')
      expect(result.agenticExecution.toolsUsed).toContain('format')
    }, AGENTIC_TIMEOUT)

    it('verifies multiple tool calls in trace', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'You must call step1, then step2, then step3 in order.',
        goal: 'Complete all three steps',
        tools: [
          {
            name: 'step1',
            description: 'First step',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'return { done: "step1" }' },
          },
          {
            name: 'step2',
            description: 'Second step (requires step1)',
            inputSchema: { type: 'object', properties: { previous: { type: 'string' } } },
            implementation: { type: 'inline', code: 'return { done: "step2" }' },
          },
          {
            name: 'step3',
            description: 'Third step (requires step2)',
            inputSchema: { type: 'object', properties: { previous: { type: 'string' } } },
            implementation: { type: 'inline', code: 'return { done: "step3" }' },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {}, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')

      const allToolCalls = result.agenticExecution.trace.flatMap((iter) => iter.toolCalls)
      expect(allToolCalls.length).toBeGreaterThanOrEqual(3)

      const stepsCalled = allToolCalls.map((call) => call.tool)
      expect(stepsCalled).toContain('step1')
      expect(stepsCalled).toContain('step2')
      expect(stepsCalled).toContain('step3')

      const step1Index = stepsCalled.indexOf('step1')
      const step2Index = stepsCalled.indexOf('step2')
      const step3Index = stepsCalled.indexOf('step3')

      expect(step1Index).toBeLessThan(step2Index)
      expect(step2Index).toBeLessThan(step3Index)
    }, AGENTIC_TIMEOUT)

    it('handles parallel tool calls within same iteration', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: `You can call fetch_a and fetch_b in parallel since they are independent.
          Then combine their results.`,
        goal: 'Fetch data from both sources and combine',
        maxToolCallsPerIteration: 3,
        tools: [
          {
            name: 'fetch_a',
            description: 'Fetch data from source A',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'return { data: "from_a" }' },
          },
          {
            name: 'fetch_b',
            description: 'Fetch data from source B',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'return { data: "from_b" }' },
          },
          {
            name: 'combine',
            description: 'Combine data from multiple sources',
            inputSchema: {
              type: 'object',
              properties: {
                data_a: { type: 'string' },
                data_b: { type: 'string' },
              },
            },
            implementation: {
              type: 'inline',
              code: 'return { combined: `${input.data_a}+${input.data_b}` }',
            },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {}, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')
      expect(result.agenticExecution.toolsUsed).toContain('fetch_a')
      expect(result.agenticExecution.toolsUsed).toContain('fetch_b')
      expect(result.agenticExecution.toolsUsed).toContain('combine')

      const iterationWithFetches = result.agenticExecution.trace.find(
        (iter) =>
          iter.toolCalls.some((c) => c.tool === 'fetch_a') &&
          iter.toolCalls.some((c) => c.tool === 'fetch_b')
      )

      expect(iterationWithFetches).toBeDefined()
    }, AGENTIC_TIMEOUT)
  })

  // ===========================================================================
  // Iteration Tracking
  // ===========================================================================

  describe('Iteration Tracking', () => {
    it('tracks iteration count in response', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Complete the task step by step, using exactly 3 iterations.',
        goal: 'Complete a multi-step task',
        maxIterations: 5,
        tools: [
          {
            name: 'process_step',
            description: 'Process one step of the task',
            inputSchema: {
              type: 'object',
              properties: {
                step: { type: 'number', description: 'Step number' },
              },
              required: ['step'],
            },
            implementation: {
              type: 'inline',
              code: 'return { completed: true, step: input.step }',
            },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {
        steps: 3,
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')
      expect(result.agenticExecution.iterations).toBeGreaterThan(0)
      expect(result.agenticExecution.iterations).toBeLessThanOrEqual(5)
    }, AGENTIC_TIMEOUT)

    it('each iteration has trace with timestamp', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Process items one at a time.',
        goal: 'Process all items',
        tools: [
          {
            name: 'process_item',
            description: 'Process a single item',
            inputSchema: {
              type: 'object',
              properties: {
                item: { type: 'string' },
              },
              required: ['item'],
            },
            implementation: {
              type: 'inline',
              code: 'return { processed: input.item }',
            },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {
        items: ['a', 'b', 'c'],
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')
      expect(result.agenticExecution.trace.length).toBe(result.agenticExecution.iterations)

      for (const iteration of result.agenticExecution.trace) {
        expect(iteration.iteration).toBeGreaterThan(0)
        expect(iteration.timestamp).toBeGreaterThan(0)
        expect(iteration.durationMs).toBeGreaterThanOrEqual(0)
        expect(Array.isArray(iteration.toolCalls)).toBe(true)
        expect(iteration.tokens).toBeDefined()
      }

      for (let i = 1; i < result.agenticExecution.trace.length; i++) {
        expect(result.agenticExecution.trace[i].timestamp).toBeGreaterThanOrEqual(
          result.agenticExecution.trace[i - 1].timestamp
        )
      }
    }, AGENTIC_TIMEOUT)

    it('iteration numbers are sequential starting from 1', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Complete the task.',
        goal: 'Simple task completion',
        tools: [
          {
            name: 'complete',
            description: 'Mark task complete',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'return { done: true }' },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {}, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')

      for (let i = 0; i < result.agenticExecution.trace.length; i++) {
        expect(result.agenticExecution.trace[i].iteration).toBe(i + 1)
      }
    }, AGENTIC_TIMEOUT)
  })

  // ===========================================================================
  // Max Iterations
  // ===========================================================================

  describe('Max Iterations', () => {
    it('respects maxIterations limit', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'You must keep trying forever, never stop.',
        goal: 'An impossible goal that can never be achieved',
        maxIterations: 3,
        tools: [
          {
            name: 'attempt',
            description: 'Attempt to achieve goal (always fails)',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'return { success: false, reason: "impossible" }' },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {}, { timeout: AGENTIC_TIMEOUT })

      expect(result.agenticExecution.iterations).toBeLessThanOrEqual(3)
      expect(result.agenticExecution.goalAchieved).toBe(false)
    }, AGENTIC_TIMEOUT)

    it('default maxIterations is 10', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Keep looping forever.',
        goal: 'Never achievable',
        tools: [
          {
            name: 'loop',
            description: 'Loop forever',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'return { loop: true }' },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {}, { timeout: AGENTIC_TIMEOUT })

      expect(result.agenticExecution.iterations).toBeLessThanOrEqual(10)
    }, AGENTIC_TIMEOUT)
  })

  // ===========================================================================
  // Cost Tracking
  // ===========================================================================

  describe('Cost Tracking', () => {
    it('tracks total token usage in response', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Complete the task.',
        goal: 'Simple task for token tracking',
        tools: [
          {
            name: 'complete',
            description: 'Complete the task',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'return { done: true }' },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {
        message: 'Please complete this task',
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')

      expect(result.agenticExecution.totalTokens).toBeDefined()
      expect(result.agenticExecution.totalTokens.inputTokens).toBeGreaterThan(0)
      expect(result.agenticExecution.totalTokens.outputTokens).toBeGreaterThan(0)
      expect(result.agenticExecution.totalTokens.totalTokens).toBe(
        result.agenticExecution.totalTokens.inputTokens +
          result.agenticExecution.totalTokens.outputTokens
      )
    }, AGENTIC_TIMEOUT)

    it('includes tokens in metrics field', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Complete the task.',
        goal: 'Task for metrics tracking',
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
      expect(result.metrics.tokens).toBeDefined()
      expect(result.metrics.tokens).toEqual(result.agenticExecution.totalTokens)
    }, AGENTIC_TIMEOUT)

    it('tracks duration accurately', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Complete the task.',
        goal: 'Task for duration tracking',
        tools: [
          {
            name: 'task',
            description: 'Do task',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'return { done: true }' },
          },
        ],
      })

      const startTime = Date.now()
      const result = await invokeAgenticFunction(functionId, {}, { timeout: AGENTIC_TIMEOUT })
      const endTime = Date.now()

      expect(result.status).toBe('completed')

      expect(result.metrics.durationMs).toBeGreaterThan(0)
      expect(result.metrics.durationMs).toBeLessThanOrEqual(endTime - startTime)

      const sumIterationDurations = result.agenticExecution.trace.reduce(
        (sum, iter) => sum + iter.durationMs,
        0
      )
      expect(result.metrics.durationMs).toBeGreaterThanOrEqual(sumIterationDurations * 0.9)
    }, AGENTIC_TIMEOUT)
  })
})
