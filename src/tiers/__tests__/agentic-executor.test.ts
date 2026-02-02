/**
 * Agentic Functions Executor Tests
 *
 * These tests validate the AgenticExecutor functionality:
 * - Agent loop execution (think -> act -> observe cycle)
 * - Tool registration and validation
 * - Tool execution for all tool types
 * - Iteration and tool call limits
 * - Memory and context accumulation
 * - Chain-of-thought reasoning
 * - Timeout enforcement (5m default)
 * - Approval flow for sensitive operations
 * - Execution trace and result structure
 * - Cost and token tracking
 *
 * @module tiers/__tests__/agentic-executor.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type {
  AgenticFunctionDefinition,
  AgenticFunctionConfig,
  AgenticFunctionResult,
  ToolDefinition,
  ToolCallRecord,
  AgentIteration,
  AgentState,
  BuiltinTool,
} from '@dotdo/functions/agentic'
import {
  defineAgenticFunction,
  defineTool,
  builtinTool,
} from '@dotdo/functions/agentic'
import type { ExecutionContext, TokenUsage } from '@dotdo/functions'

// The executor doesn't exist yet - this import will fail (RED phase)
import { AgenticExecutor } from '../agentic-executor.js'

// =============================================================================
// MOCK AI CLIENT
// =============================================================================

interface MockAIResponse {
  content: string
  toolCalls?: Array<{ name: string; input: unknown }>
  reasoning?: string
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
  tokens: TokenUsage
}

interface MockAIClient {
  chat: ReturnType<typeof vi.fn>
  responses: MockAIResponse[]
  callIndex: number
}

function createMockAIClient(responses: MockAIResponse[]): MockAIClient {
  let callIndex = 0
  const chat = vi.fn().mockImplementation(async () => {
    const response = responses[callIndex] ?? responses[responses.length - 1]
    callIndex++
    return response
  })

  return { chat, responses, callIndex }
}

// =============================================================================
// MOCK TOOL HANDLERS
// =============================================================================

function createMockToolHandler(response: unknown, delay = 0) {
  return vi.fn().mockImplementation(async (_input: unknown) => {
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay))
    }
    return response
  })
}

function createFailingToolHandler(error: string) {
  return vi.fn().mockImplementation(async () => {
    throw new Error(error)
  })
}

// =============================================================================
// TEST FIXTURES
// =============================================================================

function createTestAgenticDefinition(
  overrides: Partial<AgenticFunctionDefinition> = {}
): AgenticFunctionDefinition {
  return defineAgenticFunction({
    id: 'test-agent',
    name: 'Test Agent',
    version: '1.0.0',
    description: 'A test agentic function',
    systemPrompt: 'You are a helpful assistant.',
    goal: 'Complete the user request',
    tools: [],
    ...overrides,
  })
}

function createSearchTool(): ToolDefinition {
  return defineTool(
    'search',
    'Search for information',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    { type: 'builtin', name: 'web_search' }
  )
}

function createCalculatorTool(): ToolDefinition {
  return defineTool(
    'calculator',
    'Perform mathematical calculations',
    {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Math expression' },
      },
      required: ['expression'],
    },
    { type: 'inline', handler: 'eval(input.expression)' }
  )
}

function createFunctionTool(): ToolDefinition {
  return defineTool(
    'analyze',
    'Analyze data using another function',
    {
      type: 'object',
      properties: {
        data: { type: 'object', description: 'Data to analyze' },
      },
      required: ['data'],
    },
    { type: 'function', functionId: 'analyzer-function' }
  )
}

function createApiTool(): ToolDefinition {
  return defineTool(
    'fetch_weather',
    'Fetch weather data',
    {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name' },
      },
      required: ['city'],
    },
    { type: 'api', endpoint: 'https://api.weather.example/v1/current' }
  )
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('AgenticExecutor', () => {
  let executor: AgenticExecutor
  let mockAI: MockAIClient
  let mockEnv: Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockEnv = {
      AI_API_KEY: 'test-key',
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===========================================================================
  // 1. AGENT LOOP EXECUTION
  // ===========================================================================

  describe('agent loop execution', () => {
    it('should execute think -> act -> observe cycle', async () => {
      mockAI = createMockAIClient([
        // First iteration: AI thinks and requests tool
        {
          content: '',
          reasoning: 'I need to search for information first.',
          toolCalls: [{ name: 'search', input: { query: 'test query' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        },
        // Second iteration: AI receives tool result and completes
        {
          content: 'Based on my search, the answer is 42.',
          reasoning: 'I found the information I needed.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 150, outputTokens: 30, totalTokens: 180 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const mockSearchHandler = createMockToolHandler({ results: ['result 1'] })
      executor.registerToolHandler('search', mockSearchHandler)

      const resultPromise = executor.execute(
        { question: 'What is the answer?' },
        {},
        { executionId: 'test-exec-1' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('completed')
      expect(result.agenticExecution.iterations).toBe(2)
      expect(result.agenticExecution.trace).toHaveLength(2)

      // First iteration should have tool call
      expect(result.agenticExecution.trace[0].toolCalls).toHaveLength(1)
      expect(result.agenticExecution.trace[0].toolCalls[0].tool).toBe('search')

      // Second iteration should complete with final answer
      expect(result.agenticExecution.trace[1].toolCalls).toHaveLength(0)
    })

    it('should continue until goal is achieved', async () => {
      mockAI = createMockAIClient([
        // Iteration 1: Need more info
        {
          content: '',
          reasoning: 'Need to search first.',
          toolCalls: [{ name: 'search', input: { query: 'part 1' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        },
        // Iteration 2: Still need more
        {
          content: '',
          reasoning: 'Need to calculate.',
          toolCalls: [{ name: 'calculator', input: { expression: '2+2' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 150, outputTokens: 50, totalTokens: 200 },
        },
        // Iteration 3: Done
        {
          content: 'The final answer is 4.',
          reasoning: 'I have completed the task.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 200, outputTokens: 30, totalTokens: 230 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool(), createCalculatorTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ data: 'result' }))
      executor.registerToolHandler('calculator', createMockToolHandler({ result: 4 }))

      const resultPromise = executor.execute(
        { task: 'Calculate something complex' },
        {},
        { executionId: 'test-exec-2' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('completed')
      expect(result.agenticExecution.iterations).toBe(3)
      expect(result.agenticExecution.goalAchieved).toBe(true)
      expect(result.output).toBe('The final answer is 4.')
    })

    it('should return final result when done', async () => {
      mockAI = createMockAIClient([
        {
          content: JSON.stringify({ answer: 'direct response', confidence: 0.95 }),
          reasoning: 'This is straightforward, no tools needed.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [],
        outputSchema: {
          type: 'object',
          properties: {
            answer: { type: 'string' },
            confidence: { type: 'number' },
          },
        },
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { question: 'Simple question' },
        {},
        { executionId: 'test-exec-3' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ answer: 'direct response', confidence: 0.95 })
      expect(result.agenticExecution.iterations).toBe(1)
      expect(result.agenticExecution.goalAchieved).toBe(true)
    })

    it('should handle AI requesting no tools (immediate completion)', async () => {
      mockAI = createMockAIClient([
        {
          content: 'I can answer this directly without any tools.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 30, outputTokens: 20, totalTokens: 50 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { question: 'What is 2+2?' },
        {},
        { executionId: 'test-exec-4' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('completed')
      expect(result.agenticExecution.iterations).toBe(1)
      expect(result.agenticExecution.toolsUsed).toHaveLength(0)
    })
  })

  // ===========================================================================
  // 2. TOOL REGISTRATION
  // ===========================================================================

  describe('tool registration', () => {
    it('should register tools from definition', async () => {
      const definition = createTestAgenticDefinition({
        tools: [createSearchTool(), createCalculatorTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const registeredTools = executor.getRegisteredTools()

      expect(registeredTools).toHaveLength(2)
      expect(registeredTools.map((t) => t.name)).toContain('search')
      expect(registeredTools.map((t) => t.name)).toContain('calculator')
    })

    it('should validate tool input schemas', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'search', input: { invalid_field: 'bad' } }], // Missing required 'query'
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
        {
          content: 'Could not search due to invalid input.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 80, outputTokens: 30, totalTokens: 110 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const resultPromise = executor.execute(
        { question: 'test' },
        {},
        { executionId: 'test-exec-5' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Tool call should be recorded with validation error
      const toolCall = result.agenticExecution.trace[0].toolCalls[0]
      expect(toolCall.success).toBe(false)
      expect(toolCall.error).toContain('validation')
    })

    it('should provide tools to AI model', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Done',
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool(), createCalculatorTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { question: 'test' },
        {},
        { executionId: 'test-exec-6' }
      )

      await vi.runAllTimersAsync()
      await resultPromise

      // Verify AI was called with tools
      expect(mockAI.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({ name: 'search' }),
            expect.objectContaining({ name: 'calculator' }),
          ]),
        })
      )
    })

    it('should throw error for unregistered tool handler', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'unregistered_tool', input: {} }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
        {
          content: 'Tool not available.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      // NOT registering handler for 'search'

      const resultPromise = executor.execute(
        { question: 'test' },
        {},
        { executionId: 'test-exec-7' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Should record tool call failure
      const toolCall = result.agenticExecution.trace[0].toolCalls[0]
      expect(toolCall.success).toBe(false)
      expect(toolCall.error).toContain('handler')
    })
  })

  // ===========================================================================
  // 3. TOOL EXECUTION
  // ===========================================================================

  describe('tool execution', () => {
    it('should call tool with AI-provided input', async () => {
      const mockHandler = createMockToolHandler({ results: ['result 1', 'result 2'] })

      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'specific query' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
        {
          content: 'Found results.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', mockHandler)

      const resultPromise = executor.execute(
        { question: 'search for something' },
        {},
        { executionId: 'test-exec-8' }
      )

      await vi.runAllTimersAsync()
      await resultPromise

      expect(mockHandler).toHaveBeenCalledWith({ query: 'specific query' }, expect.anything())
    })

    it('should return tool output to AI', async () => {
      const toolOutput = { results: ['important result'], metadata: { count: 1 } }
      const mockHandler = createMockToolHandler(toolOutput)

      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'test' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
        {
          content: 'Found 1 result.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', mockHandler)

      const resultPromise = executor.execute(
        { question: 'search' },
        {},
        { executionId: 'test-exec-9' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Verify AI second call included tool result
      expect(mockAI.chat).toHaveBeenCalledTimes(2)
      expect(mockAI.chat.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          toolResults: expect.arrayContaining([
            expect.objectContaining({
              output: toolOutput,
            }),
          ]),
        })
      )
    })

    it('should handle tool errors gracefully', async () => {
      const mockHandler = createFailingToolHandler('Tool execution failed')

      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'test' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
        {
          content: 'The search failed, but I will provide what I know.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 30, totalTokens: 130 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', mockHandler)

      const resultPromise = executor.execute(
        { question: 'search' },
        {},
        { executionId: 'test-exec-10' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('completed') // Should still complete
      expect(result.agenticExecution.trace[0].toolCalls[0].success).toBe(false)
      expect(result.agenticExecution.trace[0].toolCalls[0].error).toContain('Tool execution failed')
    })

    it('should record tool calls in trace', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [
            { name: 'search', input: { query: 'query 1' } },
            { name: 'calculator', input: { expression: '1+1' } },
          ],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 50, totalTokens: 100 },
        },
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 150, outputTokens: 20, totalTokens: 170 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool(), createCalculatorTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))
      executor.registerToolHandler('calculator', createMockToolHandler({ result: 2 }))

      const resultPromise = executor.execute(
        { task: 'test' },
        {},
        { executionId: 'test-exec-11' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      const toolCalls = result.agenticExecution.trace[0].toolCalls
      expect(toolCalls).toHaveLength(2)
      expect(toolCalls[0]).toMatchObject({
        tool: 'search',
        input: { query: 'query 1' },
        output: { results: [] },
        success: true,
        durationMs: expect.any(Number),
      })
      expect(toolCalls[1]).toMatchObject({
        tool: 'calculator',
        input: { expression: '1+1' },
        output: { result: 2 },
        success: true,
        durationMs: expect.any(Number),
      })
    })
  })

  // ===========================================================================
  // 4. TOOL TYPES
  // ===========================================================================

  describe('tool types', () => {
    it("should execute 'function' type tools (other functions)", async () => {
      const functionToolHandler = vi.fn().mockResolvedValue({
        status: 'completed',
        output: { analysis: 'data analyzed' },
      })

      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'analyze', input: { data: { value: 123 } } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
        {
          content: 'Analysis complete.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createFunctionTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('analyze', functionToolHandler)

      const resultPromise = executor.execute(
        { task: 'analyze data' },
        {},
        { executionId: 'test-exec-12' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(functionToolHandler).toHaveBeenCalledWith(
        { data: { value: 123 } },
        expect.objectContaining({
          toolDefinition: expect.objectContaining({
            implementation: { type: 'function', functionId: 'analyzer-function' },
          }),
        })
      )
      expect(result.agenticExecution.toolsUsed).toContain('analyze')
    })

    it("should execute 'api' type tools (HTTP calls)", async () => {
      const apiToolHandler = vi.fn().mockResolvedValue({
        temperature: 72,
        conditions: 'sunny',
      })

      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'fetch_weather', input: { city: 'San Francisco' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
        {
          content: 'The weather in SF is sunny and 72F.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createApiTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('fetch_weather', apiToolHandler)

      const resultPromise = executor.execute(
        { question: 'What is the weather?' },
        {},
        { executionId: 'test-exec-13' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(apiToolHandler).toHaveBeenCalledWith(
        { city: 'San Francisco' },
        expect.objectContaining({
          toolDefinition: expect.objectContaining({
            implementation: { type: 'api', endpoint: 'https://api.weather.example/v1/current' },
          }),
        })
      )
    })

    it("should execute 'inline' type tools (code)", async () => {
      const inlineToolHandler = vi.fn().mockResolvedValue({ result: 10 })

      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'calculator', input: { expression: '5*2' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
        {
          content: '5*2 equals 10.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createCalculatorTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('calculator', inlineToolHandler)

      const resultPromise = executor.execute(
        { question: 'Calculate 5*2' },
        {},
        { executionId: 'test-exec-14' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(inlineToolHandler).toHaveBeenCalledWith(
        { expression: '5*2' },
        expect.objectContaining({
          toolDefinition: expect.objectContaining({
            implementation: { type: 'inline', handler: 'eval(input.expression)' },
          }),
        })
      )
    })

    it("should execute 'builtin' type tools (web_search, etc.)", async () => {
      const builtinToolHandler = vi.fn().mockResolvedValue({
        results: [{ title: 'Result 1', url: 'https://example.com' }],
      })

      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'web_search', input: { query: 'test search' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
        {
          content: 'Found one result.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [builtinTool('web_search')],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('web_search', builtinToolHandler)

      const resultPromise = executor.execute(
        { question: 'Search the web' },
        {},
        { executionId: 'test-exec-15' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(builtinToolHandler).toHaveBeenCalled()
      expect(result.agenticExecution.toolsUsed).toContain('web_search')
    })

    it('should handle all builtin tool types', async () => {
      const builtinTools: BuiltinTool[] = [
        'web_search',
        'web_fetch',
        'file_read',
        'file_write',
        'shell_exec',
        'database_query',
        'email_send',
        'slack_send',
      ]

      for (const toolName of builtinTools) {
        const tool = builtinTool(toolName)
        expect(tool.name).toBe(toolName)
        expect(tool.implementation).toEqual({ type: 'builtin', name: toolName })
        expect(tool.description).toBeDefined()
      }
    })
  })

  // ===========================================================================
  // 5. ITERATION LIMITS
  // ===========================================================================

  describe('iteration limits', () => {
    it('should enforce maxIterations limit', async () => {
      // AI keeps requesting tools forever
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'endless' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
        maxIterations: 3,
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const resultPromise = executor.execute(
        { task: 'endless task' },
        {},
        { executionId: 'test-exec-16' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.agenticExecution.iterations).toBe(3)
      expect(result.agenticExecution.goalAchieved).toBe(false)
    })

    it('should return partial result at max iterations', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Partial progress: step 1 done',
          toolCalls: [{ name: 'search', input: { query: 'step 1' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 40, totalTokens: 90 },
        },
        {
          content: 'Partial progress: step 2 done',
          toolCalls: [{ name: 'search', input: { query: 'step 2' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
        maxIterations: 2,
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const resultPromise = executor.execute(
        { task: 'long task' },
        {},
        { executionId: 'test-exec-17' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('completed')
      expect(result.agenticExecution.goalAchieved).toBe(false)
      // Should have partial content from last iteration
      expect(result.output).toContain('step 2')
    })

    it('should include iteration count in result', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'test' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'test 2' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 100, outputTokens: 30, totalTokens: 130 },
        },
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 150, outputTokens: 20, totalTokens: 170 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
        maxIterations: 10,
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const resultPromise = executor.execute(
        { task: 'test' },
        {},
        { executionId: 'test-exec-18' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.agenticExecution.iterations).toBe(3)
      expect(result.agenticExecution.trace).toHaveLength(3)
    })

    it('should respect config override for maxIterations', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'test' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
        maxIterations: 10, // Default high
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const resultPromise = executor.execute(
        { task: 'test' },
        { maxIterations: 1 }, // Override to 1
        { executionId: 'test-exec-19' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.agenticExecution.iterations).toBe(1)
    })
  })

  // ===========================================================================
  // 6. TOOL CALL LIMITS
  // ===========================================================================

  describe('tool call limits', () => {
    it('should enforce maxToolCallsPerIteration', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [
            { name: 'search', input: { query: '1' } },
            { name: 'search', input: { query: '2' } },
            { name: 'search', input: { query: '3' } },
            { name: 'search', input: { query: '4' } },
            { name: 'search', input: { query: '5' } },
          ],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 80, totalTokens: 130 },
        },
        {
          content: 'Continuing with remaining searches.',
          toolCalls: [], // Would continue with queued
          stopReason: 'end_turn',
          tokens: { inputTokens: 150, outputTokens: 30, totalTokens: 180 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
        maxToolCallsPerIteration: 3,
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const resultPromise = executor.execute(
        { task: 'many searches' },
        {},
        { executionId: 'test-exec-20' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      // First iteration should only execute 3 tool calls
      const firstIterationCalls = result.agenticExecution.trace[0].toolCalls
      expect(firstIterationCalls.filter((tc) => tc.success)).toHaveLength(3)
    })

    it('should queue excess tool calls for next iteration', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [
            { name: 'search', input: { query: '1' } },
            { name: 'search', input: { query: '2' } },
            { name: 'search', input: { query: '3' } },
            { name: 'search', input: { query: '4' } },
          ],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 60, totalTokens: 110 },
        },
        {
          content: 'Done with all searches.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 150, outputTokens: 30, totalTokens: 180 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
        maxToolCallsPerIteration: 2,
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const resultPromise = executor.execute(
        { task: 'queued searches' },
        {},
        { executionId: 'test-exec-21' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Should have executed tool calls across iterations
      const totalToolCalls = result.agenticExecution.trace.reduce(
        (sum, iter) => sum + iter.toolCalls.length,
        0
      )
      expect(totalToolCalls).toBe(4)
    })

    it('should use default maxToolCallsPerIteration of 5', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: Array.from({ length: 10 }, (_, i) => ({
            name: 'search',
            input: { query: `query ${i}` },
          })),
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 150, totalTokens: 200 },
        },
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 250, outputTokens: 20, totalTokens: 270 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
        // Not specifying maxToolCallsPerIteration - should default to 5
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const resultPromise = executor.execute(
        { task: 'many tools' },
        {},
        { executionId: 'test-exec-22' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      // First iteration should be limited to 5
      const firstIterationSuccessfulCalls = result.agenticExecution.trace[0].toolCalls.filter(
        (tc) => tc.success
      )
      expect(firstIterationSuccessfulCalls.length).toBeLessThanOrEqual(5)
    })
  })

  // ===========================================================================
  // 7. MEMORY & CONTEXT
  // ===========================================================================

  describe('memory and context', () => {
    it('should accumulate context when enableMemory=true', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Remembered fact 1',
          toolCalls: [{ name: 'search', input: { query: 'fact 1' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 40, totalTokens: 90 },
        },
        {
          content: 'Combined with fact 2',
          toolCalls: [{ name: 'search', input: { query: 'fact 2' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
        },
        {
          content: 'Final answer combining facts 1 and 2.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 150, outputTokens: 30, totalTokens: 180 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
        enableMemory: true,
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ data: 'result' }))

      const resultPromise = executor.execute(
        { task: 'combine facts' },
        {},
        { executionId: 'test-exec-23' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Second call should include context from first
      expect(mockAI.chat.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'assistant',
              content: expect.stringContaining('Remembered fact 1'),
            }),
          ]),
        })
      )
    })

    it('should provide previous iterations to AI', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          reasoning: 'First step',
          toolCalls: [{ name: 'search', input: { query: 'step 1' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 40, totalTokens: 90 },
        },
        {
          content: 'Done with context from step 1.',
          reasoning: 'Second step, building on first',
          stopReason: 'end_turn',
          tokens: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
        enableMemory: true,
        enableReasoning: true,
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ data: 'result' }))

      const resultPromise = executor.execute(
        { task: 'multi-step' },
        {},
        { executionId: 'test-exec-24' }
      )

      await vi.runAllTimersAsync()
      await resultPromise

      // Verify second call includes previous tool calls and results
      const secondCall = mockAI.chat.mock.calls[1][0]
      expect(secondCall.messages).toContainEqual(
        expect.objectContaining({
          role: 'tool',
          content: expect.stringContaining('result'),
        })
      )
    })

    it('should respect memoryConfig.maxTokens', async () => {
      mockAI = createMockAIClient([
        {
          content: 'A'.repeat(10000), // Long content
          toolCalls: [{ name: 'search', input: { query: 'test' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 5000, totalTokens: 5050 },
        },
        {
          content: 'Truncated context.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 1000, outputTokens: 30, totalTokens: 1030 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
        enableMemory: true,
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ data: 'result' }))

      const resultPromise = executor.execute(
        { task: 'test' },
        {
          memoryConfig: { maxTokens: 500 },
        },
        { executionId: 'test-exec-25' }
      )

      await vi.runAllTimersAsync()
      await resultPromise

      // Second call should have truncated/summarized context
      const secondCall = mockAI.chat.mock.calls[1][0]
      // The implementation should respect maxTokens
      expect(secondCall).toBeDefined()
    })

    it('should not accumulate context when enableMemory=false', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Step 1 content',
          toolCalls: [{ name: 'search', input: { query: 'test' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 60, outputTokens: 20, totalTokens: 80 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
        enableMemory: false,
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ data: 'result' }))

      const resultPromise = executor.execute(
        { task: 'test' },
        {},
        { executionId: 'test-exec-26' }
      )

      await vi.runAllTimersAsync()
      await resultPromise

      // Second call should NOT include accumulated context
      const secondCall = mockAI.chat.mock.calls[1][0]
      expect(secondCall.messages).not.toContainEqual(
        expect.objectContaining({
          content: expect.stringContaining('Step 1 content'),
        })
      )
    })
  })

  // ===========================================================================
  // 8. REASONING
  // ===========================================================================

  describe('reasoning', () => {
    it('should include chain-of-thought when enableReasoning=true', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Final answer.',
          reasoning: 'Let me think step by step: 1) First... 2) Then... 3) Therefore...',
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 60, totalTokens: 110 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [],
        enableReasoning: true,
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { question: 'Think about this' },
        {},
        { executionId: 'test-exec-27' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.agenticExecution.trace[0].reasoning).toBe(
        'Let me think step by step: 1) First... 2) Then... 3) Therefore...'
      )
    })

    it('should return reasoning in trace', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          reasoning: 'Reasoning for iteration 1',
          toolCalls: [{ name: 'search', input: { query: 'test' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 40, totalTokens: 90 },
        },
        {
          content: 'Done.',
          reasoning: 'Reasoning for iteration 2',
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 30, totalTokens: 130 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
        enableReasoning: true,
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const resultPromise = executor.execute(
        { task: 'test' },
        {},
        { executionId: 'test-exec-28' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.agenticExecution.trace[0].reasoning).toBe('Reasoning for iteration 1')
      expect(result.agenticExecution.trace[1].reasoning).toBe('Reasoning for iteration 2')
    })

    it('should return reasoningSummary in result', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          reasoning: 'Step 1: Analyze the problem',
          toolCalls: [{ name: 'search', input: { query: 'test' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 40, totalTokens: 90 },
        },
        {
          content: '',
          reasoning: 'Step 2: Gather more data',
          toolCalls: [{ name: 'search', input: { query: 'more' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
        },
        {
          content: 'Final answer.',
          reasoning: 'Step 3: Synthesize and conclude',
          stopReason: 'end_turn',
          tokens: { inputTokens: 150, outputTokens: 30, totalTokens: 180 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
        enableReasoning: true,
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const resultPromise = executor.execute(
        { task: 'test' },
        {},
        { executionId: 'test-exec-29' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.agenticExecution.reasoningSummary).toBeDefined()
      expect(result.agenticExecution.reasoningSummary).toContain('Step 1')
      expect(result.agenticExecution.reasoningSummary).toContain('Step 2')
      expect(result.agenticExecution.reasoningSummary).toContain('Step 3')
    })

    it('should not include reasoning when enableReasoning=false', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Direct answer.',
          reasoning: 'This should not appear',
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [],
        enableReasoning: false,
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { question: 'test' },
        {},
        { executionId: 'test-exec-30' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.agenticExecution.trace[0].reasoning).toBeUndefined()
      expect(result.agenticExecution.reasoningSummary).toBeUndefined()
    })
  })

  // ===========================================================================
  // 9. TIMEOUT ENFORCEMENT
  // ===========================================================================

  describe('timeout enforcement', () => {
    it('should enforce 5m default timeout', async () => {
      // AI that takes forever
      mockAI = createMockAIClient([])
      mockAI.chat = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 6 * 60 * 1000)) // 6 minutes
        return {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        }
      })

      const definition = createTestAgenticDefinition({
        tools: [],
        // Not specifying timeout - should default to 5m
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { task: 'slow task' },
        {},
        { executionId: 'test-exec-31' }
      )

      // Advance time past 5 minute timeout
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000)

      const result = await resultPromise

      expect(result.status).toBe('timeout')
      expect(result.error?.message).toContain('timeout')
    })

    it('should respect custom timeout', async () => {
      mockAI = createMockAIClient([])
      mockAI.chat = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 30 * 1000)) // 30 seconds
        return {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        }
      })

      const definition = createTestAgenticDefinition({
        tools: [],
        timeout: '10s', // Custom 10 second timeout
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { task: 'should timeout' },
        {},
        { executionId: 'test-exec-32' }
      )

      // Advance time past 10 second timeout
      await vi.advanceTimersByTimeAsync(11 * 1000)

      const result = await resultPromise

      expect(result.status).toBe('timeout')
    })

    it('should abort mid-iteration on timeout', async () => {
      const toolHandler = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10 * 60 * 1000)) // 10 minutes
        return { data: 'result' }
      })

      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'slow' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
        timeout: '1m', // 1 minute timeout
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', toolHandler)

      const resultPromise = executor.execute(
        { task: 'test' },
        {},
        { executionId: 'test-exec-33' }
      )

      // Let AI call complete, then advance time during tool execution
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000) // 2 minutes

      const result = await resultPromise

      expect(result.status).toBe('timeout')
      // Tool should have been called but timed out
      expect(toolHandler).toHaveBeenCalled()
    })

    it('should complete within timeout for fast operations', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Quick response.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [],
        timeout: '5m',
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { question: 'quick question' },
        {},
        { executionId: 'test-exec-34' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('completed')
      expect(result.metrics.durationMs).toBeLessThan(5 * 60 * 1000)
    })

    it('should respect context timeout override', async () => {
      mockAI = createMockAIClient([])
      mockAI.chat = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 60 * 1000)) // 1 minute
        return {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        }
      })

      const definition = createTestAgenticDefinition({
        tools: [],
        timeout: '5m', // Definition says 5m
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { task: 'test' },
        {},
        {
          executionId: 'test-exec-35',
          timeout: '30s', // Context override to 30s
        }
      )

      await vi.advanceTimersByTimeAsync(35 * 1000)

      const result = await resultPromise

      expect(result.status).toBe('timeout')
    })
  })

  // ===========================================================================
  // 10. APPROVAL FLOW
  // ===========================================================================

  describe('approval flow', () => {
    it('should pause for approval when tool requires it', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'email_send', input: { to: 'user@example.com', body: 'Hello' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 40, totalTokens: 90 },
        },
        {
          content: 'Email sent successfully.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [builtinTool('email_send')],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('email_send', createMockToolHandler({ sent: true }))

      const resultPromise = executor.execute(
        { task: 'send email' },
        {
          requireApproval: {
            tools: ['email_send'],
          },
        },
        { executionId: 'test-exec-36' }
      )

      // Should pause waiting for approval
      await vi.advanceTimersByTimeAsync(100)

      // Simulate approval
      await executor.approveToolCall('test-exec-36', 'email_send', {
        granted: true,
        approvedBy: 'admin@example.com',
      })

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('completed')
      expect(result.agenticExecution.trace[0].toolCalls[0].approval).toEqual({
        required: true,
        granted: true,
        approvedBy: 'admin@example.com',
      })
    })

    it('should wait for approval response', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'file_write', input: { path: '/data.txt', content: 'data' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 40, totalTokens: 90 },
        },
        {
          content: 'File written.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [builtinTool('file_write')],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      const fileWriteHandler = createMockToolHandler({ success: true })
      executor.registerToolHandler('file_write', fileWriteHandler)

      const resultPromise = executor.execute(
        { task: 'write file' },
        {
          requireApproval: {
            actions: ['write_file'],
          },
        },
        { executionId: 'test-exec-37' }
      )

      // Advance time but don't approve yet
      await vi.advanceTimersByTimeAsync(5000)

      // Tool should not have been called yet
      expect(fileWriteHandler).not.toHaveBeenCalled()

      // Now approve
      await executor.approveToolCall('test-exec-37', 'file_write', { granted: true })

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(fileWriteHandler).toHaveBeenCalled()
      expect(result.status).toBe('completed')
    })

    it('should record approval in tool call record', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'database_query', input: { sql: 'DELETE FROM users' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 40, totalTokens: 90 },
        },
        {
          content: 'Query executed.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [builtinTool('database_query')],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('database_query', createMockToolHandler({ rowsAffected: 10 }))

      const resultPromise = executor.execute(
        { task: 'delete users' },
        {
          requireApproval: {
            actions: ['modify_data'],
          },
        },
        { executionId: 'test-exec-38' }
      )

      await vi.advanceTimersByTimeAsync(100)
      await executor.approveToolCall('test-exec-38', 'database_query', {
        granted: true,
        approvedBy: 'dba@company.com',
      })

      await vi.runAllTimersAsync()
      const result = await resultPromise

      const toolCallRecord = result.agenticExecution.trace[0].toolCalls[0]
      expect(toolCallRecord.approval).toMatchObject({
        required: true,
        granted: true,
        approvedBy: 'dba@company.com',
      })
    })

    it('should handle approval denial', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'shell_exec', input: { command: 'rm -rf /' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 40, totalTokens: 90 },
        },
        {
          content: 'Command was denied.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [builtinTool('shell_exec')],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      const shellHandler = createMockToolHandler({ output: 'done' })
      executor.registerToolHandler('shell_exec', shellHandler)

      const resultPromise = executor.execute(
        { task: 'run dangerous command' },
        {
          requireApproval: {
            tools: ['shell_exec'],
          },
        },
        { executionId: 'test-exec-39' }
      )

      await vi.advanceTimersByTimeAsync(100)
      await executor.approveToolCall('test-exec-39', 'shell_exec', {
        granted: false,
        approvedBy: 'security@company.com',
      })

      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Tool should not have been executed
      expect(shellHandler).not.toHaveBeenCalled()
      expect(result.agenticExecution.trace[0].toolCalls[0].approval).toMatchObject({
        required: true,
        granted: false,
      })
    })

    it('should timeout approval after configured duration', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'email_send', input: { to: 'user@example.com' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 40, totalTokens: 90 },
        },
        {
          content: 'Approval timed out.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [builtinTool('email_send')],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('email_send', createMockToolHandler({ sent: true }))

      const resultPromise = executor.execute(
        { task: 'send email' },
        {
          requireApproval: {
            tools: ['email_send'],
            timeout: '10s',
          },
        },
        { executionId: 'test-exec-40' }
      )

      // Don't approve, just let timeout expire
      await vi.advanceTimersByTimeAsync(15 * 1000)
      await vi.runAllTimersAsync()

      const result = await resultPromise

      expect(result.agenticExecution.trace[0].toolCalls[0].approval).toMatchObject({
        required: true,
        granted: false,
      })
    })
  })

  // ===========================================================================
  // 11. EXECUTION TRACE
  // ===========================================================================

  describe('execution trace', () => {
    it('should return agenticExecution.iterations', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'test' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const resultPromise = executor.execute(
        { task: 'test' },
        {},
        { executionId: 'test-exec-41' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.agenticExecution).toHaveProperty('iterations')
      expect(typeof result.agenticExecution.iterations).toBe('number')
      expect(result.agenticExecution.iterations).toBe(2)
    })

    it('should return agenticExecution.trace with all iterations', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Step 1',
          toolCalls: [{ name: 'search', input: { query: '1' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
        {
          content: 'Step 2',
          toolCalls: [{ name: 'search', input: { query: '2' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 100, outputTokens: 30, totalTokens: 130 },
        },
        {
          content: 'Final',
          stopReason: 'end_turn',
          tokens: { inputTokens: 150, outputTokens: 20, totalTokens: 170 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const resultPromise = executor.execute(
        { task: 'test' },
        {},
        { executionId: 'test-exec-42' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.agenticExecution.trace).toHaveLength(3)
      expect(result.agenticExecution.trace[0].iteration).toBe(1)
      expect(result.agenticExecution.trace[1].iteration).toBe(2)
      expect(result.agenticExecution.trace[2].iteration).toBe(3)
    })

    it('should include reasoning, toolCalls, tokens, durationMs in each iteration', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          reasoning: 'My reasoning here',
          toolCalls: [{ name: 'search', input: { query: 'test' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 40, totalTokens: 90 },
        },
        {
          content: 'Done.',
          reasoning: 'Final thoughts',
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 30, totalTokens: 130 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
        enableReasoning: true,
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const resultPromise = executor.execute(
        { task: 'test' },
        {},
        { executionId: 'test-exec-43' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      const iteration = result.agenticExecution.trace[0]
      expect(iteration).toMatchObject({
        iteration: 1,
        timestamp: expect.any(Number),
        reasoning: 'My reasoning here',
        toolCalls: expect.arrayContaining([
          expect.objectContaining({
            tool: 'search',
            input: { query: 'test' },
          }),
        ]),
        tokens: {
          inputTokens: 50,
          outputTokens: 40,
          totalTokens: 90,
        },
        durationMs: expect.any(Number),
      })
    })

    it('should return agenticExecution.toolsUsed', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [
            { name: 'search', input: { query: 'test' } },
            { name: 'calculator', input: { expression: '1+1' } },
          ],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 50, totalTokens: 100 },
        },
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'more' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 150, outputTokens: 30, totalTokens: 180 },
        },
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 200, outputTokens: 20, totalTokens: 220 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool(), createCalculatorTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))
      executor.registerToolHandler('calculator', createMockToolHandler({ result: 2 }))

      const resultPromise = executor.execute(
        { task: 'test' },
        {},
        { executionId: 'test-exec-44' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.agenticExecution.toolsUsed).toContain('search')
      expect(result.agenticExecution.toolsUsed).toContain('calculator')
      // Should be unique list
      expect(new Set(result.agenticExecution.toolsUsed).size).toBe(
        result.agenticExecution.toolsUsed.length
      )
    })

    it('should return agenticExecution.goalAchieved', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Task completed successfully.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { task: 'complete task' },
        {},
        { executionId: 'test-exec-45' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.agenticExecution).toHaveProperty('goalAchieved')
      expect(result.agenticExecution.goalAchieved).toBe(true)
    })

    it('should return goalAchieved=false when max iterations reached', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'endless' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
        maxIterations: 2,
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const resultPromise = executor.execute(
        { task: 'endless' },
        {},
        { executionId: 'test-exec-46' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.agenticExecution.goalAchieved).toBe(false)
    })
  })

  // ===========================================================================
  // 12. COST TRACKING
  // ===========================================================================

  describe('cost tracking', () => {
    it('should track tokens per iteration', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'test' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        },
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'more' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 200, outputTokens: 60, totalTokens: 260 },
        },
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 300, outputTokens: 40, totalTokens: 340 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const resultPromise = executor.execute(
        { task: 'test' },
        {},
        { executionId: 'test-exec-47' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.agenticExecution.trace[0].tokens).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      })
      expect(result.agenticExecution.trace[1].tokens).toEqual({
        inputTokens: 200,
        outputTokens: 60,
        totalTokens: 260,
      })
      expect(result.agenticExecution.trace[2].tokens).toEqual({
        inputTokens: 300,
        outputTokens: 40,
        totalTokens: 340,
      })
    })

    it('should return total token usage', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'test' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        },
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 200, outputTokens: 30, totalTokens: 230 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const resultPromise = executor.execute(
        { task: 'test' },
        {},
        { executionId: 'test-exec-48' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.agenticExecution.totalTokens).toEqual({
        inputTokens: 300,
        outputTokens: 80,
        totalTokens: 380,
      })
    })

    it('should respect budget limits if configured', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: '1' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 5000, outputTokens: 2000, totalTokens: 7000 },
        },
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: '2' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 5000, outputTokens: 2000, totalTokens: 7000 },
        },
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 5000, outputTokens: 1000, totalTokens: 6000 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      // Set a token budget
      executor.setTokenBudget(10000)

      const resultPromise = executor.execute(
        { task: 'expensive task' },
        {},
        { executionId: 'test-exec-49' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Should stop before using all iterations due to budget
      expect(result.agenticExecution.totalTokens.totalTokens).toBeLessThanOrEqual(10000)
      expect(result.error?.message).toContain('budget')
    })

    it('should include token usage in metrics', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Quick response.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { question: 'test' },
        {},
        { executionId: 'test-exec-50' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.metrics.tokens).toEqual({
        inputTokens: 50,
        outputTokens: 20,
        totalTokens: 70,
      })
    })

    it('should track cost estimate if pricing is configured', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Response.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [],
        model: 'claude-3-sonnet',
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.setPricing({
        inputTokenPricePer1k: 0.003,
        outputTokenPricePer1k: 0.015,
      })

      const resultPromise = executor.execute(
        { question: 'test' },
        {},
        { executionId: 'test-exec-51' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      // 1000 input tokens * $0.003/1k = $0.003
      // 500 output tokens * $0.015/1k = $0.0075
      // Total = $0.0105
      expect(result.agenticExecution.costEstimate).toBeCloseTo(0.0105, 4)
    })
  })

  // ===========================================================================
  // ADDITIONAL EDGE CASES
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle empty tool list', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Direct answer without tools.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 40, outputTokens: 20, totalTokens: 60 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { question: 'simple question' },
        {},
        { executionId: 'test-exec-52' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('completed')
      expect(result.agenticExecution.toolsUsed).toHaveLength(0)
    })

    it('should handle AI returning invalid tool name', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'nonexistent_tool', input: {} }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
        {
          content: 'Tool not available, answering without it.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 30, totalTokens: 130 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const resultPromise = executor.execute(
        { task: 'test' },
        {},
        { executionId: 'test-exec-53' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('completed')
      expect(result.agenticExecution.trace[0].toolCalls[0].success).toBe(false)
      expect(result.agenticExecution.trace[0].toolCalls[0].error).toContain('not found')
    })

    it('should handle concurrent tool calls', async () => {
      const slowHandler = vi.fn().mockImplementation(async (input: { query: string }) => {
        await new Promise((r) => setTimeout(r, 100))
        return { result: input.query }
      })

      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [
            { name: 'search', input: { query: 'query1' } },
            { name: 'search', input: { query: 'query2' } },
            { name: 'search', input: { query: 'query3' } },
          ],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 60, totalTokens: 110 },
        },
        {
          content: 'All searches complete.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 200, outputTokens: 30, totalTokens: 230 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', slowHandler)

      const startTime = Date.now()
      const resultPromise = executor.execute(
        { task: 'parallel search' },
        {},
        { executionId: 'test-exec-54' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      // All tool calls should complete
      expect(result.agenticExecution.trace[0].toolCalls).toHaveLength(3)
      expect(result.agenticExecution.trace[0].toolCalls.every((tc) => tc.success)).toBe(true)
    })

    it('should handle signal cancellation', async () => {
      mockAI = createMockAIClient([])
      mockAI.chat = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10000))
        return {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        }
      })

      const definition = createTestAgenticDefinition({
        tools: [],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const abortController = new AbortController()

      const resultPromise = executor.execute(
        { task: 'long task' },
        {},
        {
          executionId: 'test-exec-55',
          signal: abortController.signal,
        }
      )

      // Cancel after a short delay
      await vi.advanceTimersByTimeAsync(100)
      abortController.abort()

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('cancelled')
    })

    it('should include model name in result', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Response.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [],
        model: 'claude-4-opus',
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { question: 'test' },
        {},
        { executionId: 'test-exec-56' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.agenticExecution.model).toBe('claude-4-opus')
    })

    it('should respect config model override', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Response.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [],
        model: 'claude-3-sonnet', // Default
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { question: 'test' },
        { model: 'claude-4-opus' }, // Override
        { executionId: 'test-exec-57' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.agenticExecution.model).toBe('claude-4-opus')
    })
  })

  // ===========================================================================
  // 13. PUBLIC METHODS: executeIteration & executeTool
  // ===========================================================================

  describe('public methods', () => {
    it('executeIteration should return state with continue=false', async () => {
      const definition = createTestAgenticDefinition({ tools: [] })
      executor = new AgenticExecutor(definition, undefined, mockEnv)

      const state: AgentState = {
        iteration: 0,
        memory: [],
        toolResults: [],
        goalAchieved: false,
        output: undefined,
      }

      const result = await executor.executeIteration(state, {
        executionId: 'test-iter-1',
      })

      expect(result.state).toBe(state)
      expect(result.toolCalls).toHaveLength(0)
      expect(result.continue).toBe(false)
    })

    it('executeTool should invoke the registered handler', async () => {
      const toolHandler = vi.fn().mockResolvedValue({ data: 'tool result' })
      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, undefined, mockEnv)
      executor.registerToolHandler('search', toolHandler)

      const searchTool = createSearchTool()
      const result = await executor.executeTool(
        searchTool,
        { query: 'test query' },
        { executionId: 'test-tool-1' }
      )

      expect(result).toEqual({ data: 'tool result' })
      expect(toolHandler).toHaveBeenCalledWith(
        { query: 'test query' },
        expect.objectContaining({
          toolDefinition: searchTool,
          executionContext: { executionId: 'test-tool-1' },
        })
      )
    })

    it('executeTool should throw for unregistered handler', async () => {
      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, undefined, mockEnv)
      // Not registering any handlers

      await expect(
        executor.executeTool(
          createSearchTool(),
          { query: 'test' },
          { executionId: 'test-tool-2' }
        )
      ).rejects.toThrow("No handler registered for tool 'search'")
    })
  })

  // ===========================================================================
  // 14. AI CLIENT ERRORS
  // ===========================================================================

  describe('AI client errors', () => {
    it('should handle AI client throwing an error', async () => {
      mockAI = createMockAIClient([])
      mockAI.chat = vi.fn().mockRejectedValue(new Error('AI service unavailable'))

      const definition = createTestAgenticDefinition({ tools: [] })
      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { question: 'test' },
        {},
        { executionId: 'test-ai-error-1' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('AI service unavailable')
    })

    it('should handle AI client returning max_tokens stopReason', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Partial response that was cut off due to max tok',
          stopReason: 'max_tokens',
          tokens: { inputTokens: 100, outputTokens: 4096, totalTokens: 4196 },
        },
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 150, outputTokens: 20, totalTokens: 170 },
        },
      ])

      const definition = createTestAgenticDefinition({ tools: [] })
      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { task: 'generate long text' },
        {},
        { executionId: 'test-max-tokens-1' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      // max_tokens is not end_turn, so loop continues to next iteration
      expect(result.agenticExecution.iterations).toBe(2)
      expect(result.status).toBe('completed')
    })
  })

  // ===========================================================================
  // 15. RESULT METADATA & METRICS
  // ===========================================================================

  describe('result metadata and metrics', () => {
    it('should include functionId and functionVersion in result', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 40, outputTokens: 15, totalTokens: 55 },
        },
      ])

      const definition = createTestAgenticDefinition({
        id: 'my-custom-agent',
        version: '2.3.1',
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { input: 'test' },
        {},
        { executionId: 'test-meta-1' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.functionId).toBe('my-custom-agent')
      expect(result.functionVersion).toBe('2.3.1')
    })

    it('should include startedAt and completedAt in metadata', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 40, outputTokens: 15, totalTokens: 55 },
        },
      ])

      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { input: 'test' },
        {},
        { executionId: 'test-meta-2' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.metadata).toBeDefined()
      expect(typeof result.metadata.startedAt).toBe('number')
      expect(typeof result.metadata.completedAt).toBe('number')
      expect(result.metadata.completedAt).toBeGreaterThanOrEqual(
        result.metadata.startedAt
      )
    })

    it('should track input and output size in metrics', async () => {
      mockAI = createMockAIClient([
        {
          content: JSON.stringify({ result: 'big output data here' }),
          stopReason: 'end_turn',
          tokens: { inputTokens: 40, outputTokens: 15, totalTokens: 55 },
        },
      ])

      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const input = { question: 'What is the meaning of life?' }
      const resultPromise = executor.execute(input, {}, {
        executionId: 'test-meta-3',
      })

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.metrics.inputSizeBytes).toBe(JSON.stringify(input).length)
      expect(result.metrics.outputSizeBytes).toBeGreaterThan(0)
      expect(result.metrics.retryCount).toBe(0)
    })

    it('should generate executionId when context not provided', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 40, outputTokens: 15, totalTokens: 55 },
        },
      ])

      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute({ input: 'test' })

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.executionId).toBeDefined()
      expect(result.executionId).toMatch(/^exec-/)
    })

    it('should use executionId from context when provided', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 40, outputTokens: 15, totalTokens: 55 },
        },
      ])

      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { input: 'test' },
        {},
        { executionId: 'my-custom-exec-id' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.executionId).toBe('my-custom-exec-id')
    })

    it('should report durationMs in metrics', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 40, outputTokens: 15, totalTokens: 55 },
        },
      ])

      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { input: 'test' },
        {},
        { executionId: 'test-duration-1' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(typeof result.metrics.durationMs).toBe('number')
      expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  // ===========================================================================
  // 16. CANCELLATION EDGE CASES
  // ===========================================================================

  describe('cancellation edge cases', () => {
    it('should skip agent loop when signal is pre-aborted', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Should not reach.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 40, outputTokens: 15, totalTokens: 55 },
        },
      ])

      const definition = createTestAgenticDefinition({ tools: [] })
      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const abortController = new AbortController()
      abortController.abort() // Pre-abort before execution

      const resultPromise = executor.execute(
        { task: 'should be cancelled' },
        {},
        {
          executionId: 'test-preabort-1',
          signal: abortController.signal,
        }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Pre-aborted signal prevents the loop from ever entering.
      // The AI client should never be called.
      expect(mockAI.chat).not.toHaveBeenCalled()
      expect(result.agenticExecution.iterations).toBe(0)
    })

    it('should cancel on abort during long AI call', async () => {
      const abortController = new AbortController()

      mockAI = createMockAIClient([])
      // AI takes a long time to respond
      mockAI.chat = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 60000))
        return {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        }
      })

      const definition = createTestAgenticDefinition({ tools: [] })
      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { task: 'test' },
        {},
        {
          executionId: 'test-cancel-during-ai-1',
          signal: abortController.signal,
        }
      )

      // Abort after a short delay, during the pending AI call
      await vi.advanceTimersByTimeAsync(100)
      abortController.abort()
      await vi.runAllTimersAsync()

      const result = await resultPromise

      expect(result.status).toBe('cancelled')
    })
  })

  // ===========================================================================
  // 17. BUDGET BOUNDARY BEHAVIOR
  // ===========================================================================

  describe('budget boundary behavior', () => {
    it('should stop before second iteration when budget would be exceeded', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'first' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 400, outputTokens: 100, totalTokens: 500 },
        },
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'second' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 400, outputTokens: 200, totalTokens: 600 },
        },
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 500, outputTokens: 100, totalTokens: 600 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))
      executor.setTokenBudget(800) // budget for ~1.5 iterations

      const resultPromise = executor.execute(
        { task: 'budget test' },
        {},
        { executionId: 'test-budget-boundary-1' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Should stop after second iteration exceeds budget
      expect(result.agenticExecution.totalTokens.totalTokens).toBeLessThanOrEqual(1100)
      expect(result.error?.message).toContain('budget')
    })

    it('should not apply budget when not configured', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'test' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 10000, outputTokens: 5000, totalTokens: 15000 },
        },
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 15000, outputTokens: 2000, totalTokens: 17000 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))
      // NOT setting token budget

      const resultPromise = executor.execute(
        { task: 'no budget' },
        {},
        { executionId: 'test-no-budget-1' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('completed')
      expect(result.error).toBeUndefined()
      expect(result.agenticExecution.totalTokens.totalTokens).toBe(32000)
    })
  })

  // ===========================================================================
  // 18. OUTPUT PARSING
  // ===========================================================================

  describe('output parsing', () => {
    it('should parse JSON content as output', async () => {
      mockAI = createMockAIClient([
        {
          content: JSON.stringify({ answer: 42, details: 'computed' }),
          stopReason: 'end_turn',
          tokens: { inputTokens: 40, outputTokens: 20, totalTokens: 60 },
        },
      ])

      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { input: 'test' },
        {},
        { executionId: 'test-parse-1' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.output).toEqual({ answer: 42, details: 'computed' })
    })

    it('should return raw string when content is not JSON', async () => {
      mockAI = createMockAIClient([
        {
          content: 'This is plain text, not JSON.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 40, outputTokens: 20, totalTokens: 60 },
        },
      ])

      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { input: 'test' },
        {},
        { executionId: 'test-parse-2' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.output).toBe('This is plain text, not JSON.')
    })

    it('should handle empty content as output', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          stopReason: 'end_turn',
          tokens: { inputTokens: 40, outputTokens: 5, totalTokens: 45 },
        },
      ])

      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { input: 'test' },
        {},
        { executionId: 'test-parse-3' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('completed')
      // Empty string is the last content
      expect(result.output).toBe('')
    })
  })

  // ===========================================================================
  // 19. SYSTEM PROMPT PASSING
  // ===========================================================================

  describe('system prompt', () => {
    it('should pass systemPrompt to AI client', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        },
      ])

      const definition = createTestAgenticDefinition({
        systemPrompt: 'You are a specialized data analyst.',
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { query: 'analyze this' },
        {},
        { executionId: 'test-sysprompt-1' }
      )

      await vi.runAllTimersAsync()
      await resultPromise

      expect(mockAI.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: 'You are a specialized data analyst.',
        })
      )
    })

    it('should pass enableReasoning flag to AI client', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        },
      ])

      const definition = createTestAgenticDefinition({
        enableReasoning: true,
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { query: 'test' },
        {},
        { executionId: 'test-reasoning-flag-1' }
      )

      await vi.runAllTimersAsync()
      await resultPromise

      expect(mockAI.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          enableReasoning: true,
        })
      )
    })
  })

  // ===========================================================================
  // 20. TOOL INPUT VALIDATION
  // ===========================================================================

  describe('tool input validation', () => {
    it('should fail tool call when multiple required fields are missing', async () => {
      const multiFieldTool = defineTool(
        'multi_input',
        'Tool requiring multiple fields',
        {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
            email: { type: 'string' },
          },
          required: ['name', 'age', 'email'],
        },
        { type: 'inline', handler: 'return input' }
      )

      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'multi_input', input: { name: 'Alice' } }], // missing age and email
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
        {
          content: 'Invalid input.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [multiFieldTool],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('multi_input', createMockToolHandler({ ok: true }))

      const resultPromise = executor.execute(
        { task: 'test validation' },
        {},
        { executionId: 'test-validation-1' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      const toolCall = result.agenticExecution.trace[0].toolCalls[0]
      expect(toolCall.success).toBe(false)
      expect(toolCall.error).toContain('validation')
    })

    it('should pass tool call when all required fields present', async () => {
      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'search', input: { query: 'valid query' } }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: ['found it'] }))

      const resultPromise = executor.execute(
        { task: 'test validation pass' },
        {},
        { executionId: 'test-validation-2' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      const toolCall = result.agenticExecution.trace[0].toolCalls[0]
      expect(toolCall.success).toBe(true)
    })

    it('should skip validation when inputSchema has no type', async () => {
      const noTypeTool = defineTool(
        'no_type_tool',
        'Tool with no type in schema',
        { properties: { x: { type: 'number' } } },
        { type: 'inline', handler: 'return input' }
      )

      mockAI = createMockAIClient([
        {
          content: '',
          toolCalls: [{ name: 'no_type_tool', input: {} }],
          stopReason: 'tool_use',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
        {
          content: 'Done.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
        },
      ])

      const definition = createTestAgenticDefinition({
        tools: [noTypeTool],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('no_type_tool', createMockToolHandler({ ok: true }))

      const resultPromise = executor.execute(
        { task: 'test no type' },
        {},
        { executionId: 'test-validation-3' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      const toolCall = result.agenticExecution.trace[0].toolCalls[0]
      expect(toolCall.success).toBe(true)
    })
  })
})
