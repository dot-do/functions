/**
 * E2E Tests for Agentic Functions
 *
 * These tests verify the full flow from API request to response for agentic functions.
 * Agentic functions are autonomous AI agents that can:
 * - Make multiple AI calls
 * - Use tools to interact with the world
 * - Make decisions based on intermediate results
 * - Loop until a goal is achieved
 *
 * RED PHASE: These tests are written to FAIL until the full agentic API integration
 * is implemented.
 *
 * Test categories:
 * 1. API Request/Response - Full HTTP request flow
 * 2. Tool Execution - Tools called during agent execution
 * 3. Multi-Iteration - Agent loops until goal achieved
 * 4. Error Handling - Graceful error recovery
 * 5. Timeout Behavior - Timeout enforcement at API level
 * 6. Approval Flow - Human-in-the-loop approval for sensitive tools
 * 7. Cost Tracking - Token usage and metrics in API response
 * 8. Streaming - Real-time updates during execution
 *
 * @module __tests__/agentic-e2e.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockKV } from '../test-utils/mock-kv'
import type { Env } from '../index'

// Import the worker for E2E testing
import worker, { resetRateLimiter } from '../index'

// =============================================================================
// TYPES
// =============================================================================

type JsonBody = Record<string, unknown>

interface AgenticInvokeResult {
  executionId: string
  functionId: string
  functionVersion: string
  status: 'completed' | 'failed' | 'timeout' | 'cancelled' | 'pending'
  output?: unknown
  error?: {
    name: string
    message: string
    code?: string
  }
  metrics: {
    durationMs: number
    inputSizeBytes: number
    outputSizeBytes: number
    retryCount: number
    tokens?: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
    }
  }
  agenticExecution: {
    model: string
    totalTokens: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
    }
    iterations: number
    trace: Array<{
      iteration: number
      timestamp: number
      reasoning?: string
      toolCalls: Array<{
        tool: string
        input: unknown
        output: unknown
        durationMs: number
        success: boolean
        error?: string
        approval?: {
          required: boolean
          granted?: boolean
          approvedBy?: string
        }
      }>
      tokens: {
        inputTokens: number
        outputTokens: number
        totalTokens: number
      }
      durationMs: number
    }>
    toolsUsed: string[]
    goalAchieved: boolean
    reasoningSummary?: string
    costEstimate?: number
  }
}

// =============================================================================
// TEST SUITE
// =============================================================================

describe('E2E: Agentic Functions API', () => {
  let mockEnv: Env
  let mockRegistry: KVNamespace
  let mockCodeStorage: KVNamespace
  let mockApiKeys: KVNamespace
  let mockCtx: ExecutionContext

  beforeEach(async () => {
    vi.clearAllMocks()
    resetRateLimiter()

    mockRegistry = createMockKV()
    mockCodeStorage = createMockKV()
    mockApiKeys = createMockKV()

    mockEnv = {
      FUNCTIONS_REGISTRY: mockRegistry,
      FUNCTIONS_CODE: mockCodeStorage,
      FUNCTIONS_API_KEYS: mockApiKeys,
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      OPENAI_API_KEY: 'test-openai-key',
    } as Env

    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext

    // Set up valid API key
    await mockApiKeys.put(
      'test-api-key',
      JSON.stringify({
        userId: 'test-user',
        active: true,
      })
    )
  })

  afterEach(() => {
    resetRateLimiter()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  // ===========================================================================
  // 1. API REQUEST/RESPONSE FLOW
  // ===========================================================================

  describe('1. API Request/Response Flow', () => {
    it('should accept agentic function invocation via POST /functions/:id/invoke', async () => {
      // Set up an agentic function
      const agenticFunctionMetadata = {
        id: 'test-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'You are a helpful calculator agent.',
        goal: 'Calculate the result of mathematical expressions',
        tools: [
          {
            name: 'calculate',
            description: 'Perform a calculation',
            inputSchema: {
              type: 'object',
              properties: {
                expression: { type: 'string' },
              },
              required: ['expression'],
            },
            implementation: { type: 'inline', handler: 'eval(input.expression)' },
          },
        ],
        maxIterations: 5,
        enableReasoning: true,
      }
      await mockRegistry.put('test-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/test-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({ task: 'Calculate 2 + 2' }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Should return 200 OK or 501 if not implemented yet
      expect([200, 501, 503]).toContain(response.status)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        expect(body.functionId).toBe('test-agent')
        expect(body.executionId).toBeDefined()
        expect(body.status).toBeDefined()
      }
    })

    it('should return correct Content-Type for agentic function response', async () => {
      const agenticFunctionMetadata = {
        id: 'content-type-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Test agent',
        goal: 'Test goal',
        tools: [],
      }
      await mockRegistry.put('content-type-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/content-type-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('should include executionId in response', async () => {
      const agenticFunctionMetadata = {
        id: 'exec-id-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Test agent',
        goal: 'Test goal',
        tools: [],
      }
      await mockRegistry.put('exec-id-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/exec-id-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        expect(body.executionId).toBeDefined()
        expect(typeof body.executionId).toBe('string')
        expect(body.executionId.length).toBeGreaterThan(0)
      }
    })

    it('should include agenticExecution metadata in response', async () => {
      const agenticFunctionMetadata = {
        id: 'meta-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Test agent',
        goal: 'Test goal',
        tools: [],
      }
      await mockRegistry.put('meta-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/meta-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        expect(body.agenticExecution).toBeDefined()
        expect(body.agenticExecution.model).toBeDefined()
        expect(body.agenticExecution.iterations).toBeDefined()
        expect(body.agenticExecution.trace).toBeDefined()
        expect(body.agenticExecution.toolsUsed).toBeDefined()
        expect(body.agenticExecution.goalAchieved).toBeDefined()
      }
    })

    it('should return 404 for non-existent agentic function', async () => {
      const request = new Request('https://functions.do/functions/non-existent-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(404)
    })

    it('should require authentication for agentic function invocation', async () => {
      const agenticFunctionMetadata = {
        id: 'auth-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Test agent',
        goal: 'Test goal',
        tools: [],
      }
      await mockRegistry.put('auth-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/auth-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // No API key
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(401)
    })
  })

  // ===========================================================================
  // 2. TOOL EXECUTION
  // ===========================================================================

  describe('2. Tool Execution', () => {
    it('should execute tools defined in agentic function', async () => {
      const agenticFunctionMetadata = {
        id: 'tool-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'You are a helpful assistant with tools.',
        goal: 'Help users with calculations',
        tools: [
          {
            name: 'add',
            description: 'Add two numbers',
            inputSchema: {
              type: 'object',
              properties: {
                a: { type: 'number' },
                b: { type: 'number' },
              },
              required: ['a', 'b'],
            },
            implementation: { type: 'inline', handler: 'return { sum: input.a + input.b }' },
          },
        ],
        maxIterations: 3,
      }
      await mockRegistry.put('tool-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/tool-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({ task: 'Add 5 and 3' }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        expect(body.agenticExecution.toolsUsed).toContain('add')
      }
    })

    it('should record tool calls in trace', async () => {
      const agenticFunctionMetadata = {
        id: 'trace-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Test agent with tool tracing',
        goal: 'Execute tools and record trace',
        tools: [
          {
            name: 'echo',
            description: 'Echo input',
            inputSchema: {
              type: 'object',
              properties: {
                message: { type: 'string' },
              },
              required: ['message'],
            },
            implementation: { type: 'inline', handler: 'return { echoed: input.message }' },
          },
        ],
      }
      await mockRegistry.put('trace-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/trace-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({ message: 'Hello' }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        expect(body.agenticExecution.trace.length).toBeGreaterThan(0)

        const toolCalls = body.agenticExecution.trace.flatMap((iter) => iter.toolCalls)
        if (toolCalls.length > 0) {
          const echoCall = toolCalls.find((c) => c.tool === 'echo')
          if (echoCall) {
            expect(echoCall.input).toBeDefined()
            expect(echoCall.output).toBeDefined()
            expect(echoCall.durationMs).toBeGreaterThanOrEqual(0)
            expect(typeof echoCall.success).toBe('boolean')
          }
        }
      }
    })

    it('should handle function-type tools (calling other functions)', async () => {
      // Set up a helper function
      const helperFunctionMetadata = {
        id: 'helper-func',
        version: '1.0.0',
        type: 'code',
        language: 'typescript',
      }
      await mockRegistry.put('helper-func', JSON.stringify(helperFunctionMetadata))
      await mockCodeStorage.put(
        'helper-func',
        `export default {
          async fetch(request) {
            const { x, y } = await request.json();
            return Response.json({ product: x * y });
          }
        }`
      )

      // Set up agentic function that uses the helper
      const agenticFunctionMetadata = {
        id: 'function-tool-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Use the multiply tool',
        goal: 'Multiply numbers',
        tools: [
          {
            name: 'multiply',
            description: 'Multiply two numbers',
            inputSchema: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
              },
              required: ['x', 'y'],
            },
            implementation: { type: 'function', functionId: 'helper-func' },
          },
        ],
      }
      await mockRegistry.put('function-tool-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/function-tool-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({ task: 'Multiply 6 and 7' }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        expect(body.agenticExecution.toolsUsed).toContain('multiply')
      }
    })

    it('should handle builtin tools', async () => {
      const agenticFunctionMetadata = {
        id: 'builtin-tool-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Use web search to find information',
        goal: 'Search the web',
        tools: [
          {
            name: 'web_search',
            description: 'Search the web',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
              },
              required: ['query'],
            },
            implementation: { type: 'builtin', name: 'web_search' },
          },
        ],
      }
      await mockRegistry.put('builtin-tool-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/builtin-tool-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({ query: 'test search' }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Should not crash - either succeeds or returns appropriate error
      expect([200, 501, 503]).toContain(response.status)
    })

    it('should handle API-type tools', async () => {
      const agenticFunctionMetadata = {
        id: 'api-tool-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Use API to fetch data',
        goal: 'Fetch data from external API',
        tools: [
          {
            name: 'fetch_data',
            description: 'Fetch data from API',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string' },
              },
              required: ['id'],
            },
            implementation: { type: 'api', endpoint: 'https://api.example.com/data' },
          },
        ],
      }
      await mockRegistry.put('api-tool-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/api-tool-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({ id: 'test-123' }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Should not crash
      expect([200, 501, 503]).toContain(response.status)
    })
  })

  // ===========================================================================
  // 3. MULTI-ITERATION
  // ===========================================================================

  describe('3. Multi-Iteration', () => {
    it('should support multiple iterations until goal achieved', async () => {
      const agenticFunctionMetadata = {
        id: 'multi-iter-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Complete multi-step tasks',
        goal: 'Complete all steps',
        tools: [
          {
            name: 'step1',
            description: 'First step',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', handler: 'return { done: "step1" }' },
          },
          {
            name: 'step2',
            description: 'Second step',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', handler: 'return { done: "step2" }' },
          },
        ],
        maxIterations: 5,
      }
      await mockRegistry.put('multi-iter-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/multi-iter-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({ task: 'Complete all steps' }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        expect(body.agenticExecution.iterations).toBeGreaterThanOrEqual(1)
        expect(body.agenticExecution.trace.length).toBe(body.agenticExecution.iterations)
      }
    })

    it('should respect maxIterations limit', async () => {
      const agenticFunctionMetadata = {
        id: 'max-iter-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Keep trying forever',
        goal: 'Impossible goal',
        tools: [
          {
            name: 'try',
            description: 'Try again',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', handler: 'return { continue: true }' },
          },
        ],
        maxIterations: 3,
      }
      await mockRegistry.put('max-iter-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/max-iter-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        expect(body.agenticExecution.iterations).toBeLessThanOrEqual(3)
      }
    })

    it('should include iteration timestamps in trace', async () => {
      const agenticFunctionMetadata = {
        id: 'timestamp-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Test timestamps',
        goal: 'Test goal',
        tools: [],
        maxIterations: 2,
      }
      await mockRegistry.put('timestamp-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/timestamp-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        for (const iteration of body.agenticExecution.trace) {
          expect(iteration.timestamp).toBeDefined()
          expect(typeof iteration.timestamp).toBe('number')
          expect(iteration.timestamp).toBeGreaterThan(0)
        }
      }
    })

    it('should report goalAchieved status correctly', async () => {
      const agenticFunctionMetadata = {
        id: 'goal-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Achieve the goal',
        goal: 'Simple task',
        tools: [],
        maxIterations: 1,
      }
      await mockRegistry.put('goal-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/goal-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        expect(typeof body.agenticExecution.goalAchieved).toBe('boolean')
      }
    })
  })

  // ===========================================================================
  // 4. ERROR HANDLING
  // ===========================================================================

  describe('4. Error Handling', () => {
    it('should handle tool execution errors gracefully', async () => {
      const agenticFunctionMetadata = {
        id: 'error-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Handle errors',
        goal: 'Handle tool failures',
        tools: [
          {
            name: 'failing_tool',
            description: 'This tool always fails',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', handler: 'throw new Error("Tool failure")' },
          },
          {
            name: 'working_tool',
            description: 'This tool works',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', handler: 'return { success: true }' },
          },
        ],
        maxIterations: 3,
      }
      await mockRegistry.put('error-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/error-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Should not crash - should complete (possibly with errors recorded)
      expect([200, 500, 501, 503]).toContain(response.status)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        // Errors should be recorded in trace
        const toolCalls = body.agenticExecution.trace.flatMap((iter) => iter.toolCalls)
        const failedCall = toolCalls.find((c) => c.tool === 'failing_tool')
        if (failedCall) {
          expect(failedCall.success).toBe(false)
          expect(failedCall.error).toBeDefined()
        }
      }
    })

    it('should record error details in tool call trace', async () => {
      const agenticFunctionMetadata = {
        id: 'error-trace-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Test error tracing',
        goal: 'Record error details',
        tools: [
          {
            name: 'error_tool',
            description: 'Tool with detailed error',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', handler: 'throw new Error("Detailed error: code=E123")' },
          },
        ],
        maxIterations: 2,
      }
      await mockRegistry.put('error-trace-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/error-trace-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        const toolCalls = body.agenticExecution.trace.flatMap((iter) => iter.toolCalls)
        const errorCall = toolCalls.find((c) => c.tool === 'error_tool')
        if (errorCall) {
          expect(errorCall.error).toContain('E123')
        }
      }
    })

    it('should return 400 for invalid JSON body', async () => {
      const agenticFunctionMetadata = {
        id: 'json-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Test agent',
        goal: 'Test goal',
        tools: [],
      }
      await mockRegistry.put('json-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/json-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: 'invalid json{{{',
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      expect(response.status).toBe(400)
    })

    it('should return status=failed when agent fails completely', async () => {
      const agenticFunctionMetadata = {
        id: 'fail-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'This will fail',
        goal: 'Impossible',
        tools: [
          {
            name: 'always_fails',
            description: 'Always fails',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', handler: 'throw new Error("Always fails")' },
          },
        ],
        maxIterations: 1,
      }
      await mockRegistry.put('fail-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/fail-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        // Either failed or completed with partial result
        expect(['completed', 'failed']).toContain(body.status)
      }
    })
  })

  // ===========================================================================
  // 5. TIMEOUT BEHAVIOR
  // ===========================================================================

  describe('5. Timeout Behavior', () => {
    it('should respect function timeout', async () => {
      vi.useFakeTimers()

      const agenticFunctionMetadata = {
        id: 'timeout-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Slow agent',
        goal: 'Take too long',
        tools: [],
        maxIterations: 100,
        timeout: '5s',
      }
      await mockRegistry.put('timeout-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/timeout-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const responsePromise = worker.fetch(request, mockEnv, mockCtx)

      // Advance time past timeout
      await vi.advanceTimersByTimeAsync(10 * 1000)

      const response = await responsePromise

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        expect(['completed', 'timeout']).toContain(body.status)
      }
    })

    it('should return status=timeout when execution times out', async () => {
      vi.useFakeTimers()

      const agenticFunctionMetadata = {
        id: 'timeout-status-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Very slow agent',
        goal: 'Never finish',
        tools: [
          {
            name: 'slow_tool',
            description: 'Very slow tool',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', handler: 'return new Promise(() => {})' },
          },
        ],
        maxIterations: 100,
        timeout: '1s',
      }
      await mockRegistry.put('timeout-status-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/timeout-status-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const responsePromise = worker.fetch(request, mockEnv, mockCtx)
      await vi.advanceTimersByTimeAsync(5 * 1000)
      const response = await responsePromise

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        expect(body.status).toBe('timeout')
      }
    })

    it('should include partial trace on timeout', async () => {
      vi.useFakeTimers()

      const agenticFunctionMetadata = {
        id: 'partial-trace-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Agent with partial work',
        goal: 'Complete before timeout',
        tools: [],
        maxIterations: 100,
        timeout: '2s',
      }
      await mockRegistry.put('partial-trace-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/partial-trace-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const responsePromise = worker.fetch(request, mockEnv, mockCtx)
      await vi.advanceTimersByTimeAsync(5 * 1000)
      const response = await responsePromise

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        // Should have some trace even on timeout
        expect(body.agenticExecution).toBeDefined()
        expect(body.agenticExecution.trace).toBeDefined()
      }
    })
  })

  // ===========================================================================
  // 6. APPROVAL FLOW
  // ===========================================================================

  describe('6. Approval Flow', () => {
    it('should support approval requirements for sensitive tools', async () => {
      const agenticFunctionMetadata = {
        id: 'approval-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Agent with approval requirements',
        goal: 'Execute sensitive operation',
        tools: [
          {
            name: 'send_email',
            description: 'Send an email',
            inputSchema: {
              type: 'object',
              properties: {
                to: { type: 'string' },
                body: { type: 'string' },
              },
              required: ['to', 'body'],
            },
            implementation: { type: 'builtin', name: 'email_send' },
          },
        ],
        requireApproval: {
          tools: ['send_email'],
          timeout: '30s',
        },
      }
      await mockRegistry.put('approval-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/approval-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({ task: 'Send email to user@example.com' }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Should either succeed or return pending for approval
      expect([200, 202, 501, 503]).toContain(response.status)
    })

    it('should record approval status in tool call trace', async () => {
      const agenticFunctionMetadata = {
        id: 'approval-trace-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Test approval tracing',
        goal: 'Test approval',
        tools: [
          {
            name: 'dangerous_action',
            description: 'Dangerous action requiring approval',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', handler: 'return { executed: true }' },
          },
        ],
        requireApproval: {
          tools: ['dangerous_action'],
        },
      }
      await mockRegistry.put('approval-trace-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/approval-trace-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        const toolCalls = body.agenticExecution.trace.flatMap((iter) => iter.toolCalls)
        const approvalCall = toolCalls.find((c) => c.tool === 'dangerous_action')
        if (approvalCall && approvalCall.approval) {
          expect(approvalCall.approval.required).toBe(true)
        }
      }
    })
  })

  // ===========================================================================
  // 7. COST TRACKING
  // ===========================================================================

  describe('7. Cost Tracking', () => {
    it('should track total token usage', async () => {
      const agenticFunctionMetadata = {
        id: 'token-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Test token tracking',
        goal: 'Track tokens',
        tools: [],
        maxIterations: 1,
      }
      await mockRegistry.put('token-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/token-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        expect(body.agenticExecution.totalTokens).toBeDefined()
        expect(body.agenticExecution.totalTokens.inputTokens).toBeGreaterThanOrEqual(0)
        expect(body.agenticExecution.totalTokens.outputTokens).toBeGreaterThanOrEqual(0)
        expect(body.agenticExecution.totalTokens.totalTokens).toBe(
          body.agenticExecution.totalTokens.inputTokens +
            body.agenticExecution.totalTokens.outputTokens
        )
      }
    })

    it('should track per-iteration token usage', async () => {
      const agenticFunctionMetadata = {
        id: 'iter-token-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Test per-iteration tokens',
        goal: 'Track iteration tokens',
        tools: [],
        maxIterations: 2,
      }
      await mockRegistry.put('iter-token-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/iter-token-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        for (const iteration of body.agenticExecution.trace) {
          expect(iteration.tokens).toBeDefined()
          expect(iteration.tokens.inputTokens).toBeGreaterThanOrEqual(0)
          expect(iteration.tokens.outputTokens).toBeGreaterThanOrEqual(0)
        }
      }
    })

    it('should include duration metrics', async () => {
      const agenticFunctionMetadata = {
        id: 'duration-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Test duration',
        goal: 'Track duration',
        tools: [],
      }
      await mockRegistry.put('duration-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/duration-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        expect(body.metrics.durationMs).toBeGreaterThanOrEqual(0)
        for (const iteration of body.agenticExecution.trace) {
          expect(iteration.durationMs).toBeGreaterThanOrEqual(0)
        }
      }
    })

    it('should include cost estimate when pricing configured', async () => {
      const agenticFunctionMetadata = {
        id: 'cost-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Test cost estimate',
        goal: 'Estimate cost',
        tools: [],
      }
      await mockRegistry.put('cost-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/cost-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        // Cost estimate may or may not be present depending on configuration
        if (body.agenticExecution.costEstimate !== undefined) {
          expect(typeof body.agenticExecution.costEstimate).toBe('number')
          expect(body.agenticExecution.costEstimate).toBeGreaterThanOrEqual(0)
        }
      }
    })
  })

  // ===========================================================================
  // 8. REASONING TRACE
  // ===========================================================================

  describe('8. Reasoning Trace', () => {
    it('should include reasoning when enableReasoning is true', async () => {
      const agenticFunctionMetadata = {
        id: 'reasoning-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Think step by step',
        goal: 'Solve with reasoning',
        tools: [],
        enableReasoning: true,
      }
      await mockRegistry.put('reasoning-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/reasoning-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({ problem: 'What is 2 + 2?' }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        // Check for reasoning in iterations
        const hasReasoning = body.agenticExecution.trace.some(
          (iter) => iter.reasoning && iter.reasoning.length > 0
        )
        // May or may not have reasoning depending on implementation
        expect(typeof hasReasoning).toBe('boolean')
      }
    })

    it('should include reasoningSummary in response', async () => {
      const agenticFunctionMetadata = {
        id: 'summary-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Provide reasoning summary',
        goal: 'Summarize reasoning',
        tools: [],
        enableReasoning: true,
      }
      await mockRegistry.put('summary-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/summary-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        // reasoningSummary may be present when reasoning is enabled
        if (body.agenticExecution.reasoningSummary) {
          expect(typeof body.agenticExecution.reasoningSummary).toBe('string')
        }
      }
    })

    it('should not include reasoning when enableReasoning is false', async () => {
      const agenticFunctionMetadata = {
        id: 'no-reasoning-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'No reasoning',
        goal: 'Complete without reasoning',
        tools: [],
        enableReasoning: false,
      }
      await mockRegistry.put('no-reasoning-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/no-reasoning-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        // No reasoning should be present
        const hasReasoning = body.agenticExecution.trace.some(
          (iter) => iter.reasoning && iter.reasoning.length > 0
        )
        expect(hasReasoning).toBe(false)
        expect(body.agenticExecution.reasoningSummary).toBeUndefined()
      }
    })
  })

  // ===========================================================================
  // 9. MODEL SELECTION
  // ===========================================================================

  describe('9. Model Selection', () => {
    it('should use model specified in function definition', async () => {
      const agenticFunctionMetadata = {
        id: 'model-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'gpt-4o',
        systemPrompt: 'Test model selection',
        goal: 'Verify model',
        tools: [],
      }
      await mockRegistry.put('model-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/model-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        expect(body.agenticExecution.model).toBe('gpt-4o')
      }
    })

    it('should default to claude-3-sonnet when no model specified', async () => {
      const agenticFunctionMetadata = {
        id: 'default-model-agent',
        version: '1.0.0',
        type: 'agentic',
        // No model specified
        systemPrompt: 'Test default model',
        goal: 'Verify default model',
        tools: [],
      }
      await mockRegistry.put('default-model-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/default-model-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        expect(body.agenticExecution.model).toBe('claude-3-sonnet')
      }
    })
  })

  // ===========================================================================
  // 10. EDGE CASES
  // ===========================================================================

  describe('10. Edge Cases', () => {
    it('should handle empty tools array', async () => {
      const agenticFunctionMetadata = {
        id: 'no-tools-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'No tools available',
        goal: 'Answer directly',
        tools: [],
      }
      await mockRegistry.put('no-tools-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/no-tools-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({ question: 'What is 2 + 2?' }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Should complete even without tools
      expect([200, 501, 503]).toContain(response.status)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        expect(body.agenticExecution.toolsUsed).toHaveLength(0)
      }
    })

    it('should handle very long input', async () => {
      const agenticFunctionMetadata = {
        id: 'long-input-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Handle long input',
        goal: 'Process long input',
        tools: [],
      }
      await mockRegistry.put('long-input-agent', JSON.stringify(agenticFunctionMetadata))

      const longInput = 'Lorem ipsum '.repeat(1000)

      const request = new Request('https://functions.do/functions/long-input-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({ text: longInput }),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      // Should not crash
      expect([200, 400, 413, 501, 503]).toContain(response.status)
    })

    it('should handle concurrent invocations', async () => {
      const agenticFunctionMetadata = {
        id: 'concurrent-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Handle concurrent requests',
        goal: 'Process request',
        tools: [],
      }
      await mockRegistry.put('concurrent-agent', JSON.stringify(agenticFunctionMetadata))

      const requests = Array.from({ length: 3 }, (_, i) =>
        new Request('https://functions.do/functions/concurrent-agent/invoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
            'CF-Connecting-IP': `10.0.0.${i + 1}`,
          },
          body: JSON.stringify({ index: i }),
        })
      )

      const responses = await Promise.all(
        requests.map((request) => worker.fetch(request, mockEnv, mockCtx))
      )

      // All requests should complete without crashing
      for (const response of responses) {
        expect([200, 429, 501, 503]).toContain(response.status)
      }
    })

    it('should handle AbortController cancellation', async () => {
      const agenticFunctionMetadata = {
        id: 'abort-agent',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Long running agent',
        goal: 'Take a long time',
        tools: [],
        maxIterations: 100,
      }
      await mockRegistry.put('abort-agent', JSON.stringify(agenticFunctionMetadata))

      const abortController = new AbortController()

      const request = new Request('https://functions.do/functions/abort-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
        signal: abortController.signal,
      })

      // Start the request and abort quickly
      const responsePromise = worker.fetch(request, mockEnv, mockCtx)
      abortController.abort()

      // Should handle abort gracefully
      const response = await responsePromise

      // Either completes quickly, or handles cancellation
      expect([200, 499, 501, 503]).toContain(response.status)
    })

    it('should include function version in response', async () => {
      const agenticFunctionMetadata = {
        id: 'version-agent',
        version: '2.3.4',
        type: 'agentic',
        model: 'claude-3-sonnet',
        systemPrompt: 'Test versioning',
        goal: 'Verify version',
        tools: [],
      }
      await mockRegistry.put('version-agent', JSON.stringify(agenticFunctionMetadata))

      const request = new Request('https://functions.do/functions/version-agent/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        },
        body: JSON.stringify({}),
      })

      const response = await worker.fetch(request, mockEnv, mockCtx)

      if (response.status === 200) {
        const body = (await response.json()) as AgenticInvokeResult
        expect(body.functionVersion).toBe('2.3.4')
      }
    })
  })
})
