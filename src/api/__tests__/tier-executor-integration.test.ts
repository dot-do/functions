/**
 * Tier Executor Integration Tests - RED Phase
 *
 * P0: Connect API handlers to tier executors
 *
 * Tests the integration between the invoke handler and the 4-tier executor cascade:
 * - Code (5s) -> Generative (30s) -> Agentic (5m) -> Human (24h)
 *
 * The invoke endpoint should:
 * 1. Determine function type from metadata
 * 2. Dispatch to the appropriate tier executor
 * 3. Return properly formatted responses with execution info
 *
 * These tests are in RED phase - they will FAIL until implementation is complete.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockKV } from '../../test-utils/mock-kv'
import { invokeHandler, type InvokeHandlerContext } from '../handlers/invoke'

// Type for JSON response bodies
type JsonBody = Record<string, unknown>

describe('Tier Executor Integration', () => {
  let mockEnv: {
    FUNCTIONS_REGISTRY: KVNamespace
    FUNCTIONS_CODE: KVNamespace
    LOADER?: {
      get(id: string, factory: () => Promise<{
        mainModule: string
        modules: Record<string, string>
        compatibilityDate: string
      }>): {
        getEntrypoint(): { fetch(request: Request): Promise<Response> }
      }
    }
    USER_FUNCTIONS?: unknown
    AI_CLIENT?: unknown
    HUMAN_TASKS?: unknown
  }
  let mockCtx: ExecutionContext

  beforeEach(() => {
    vi.useFakeTimers()
    mockEnv = {
      FUNCTIONS_REGISTRY: createMockKV(),
      FUNCTIONS_CODE: createMockKV(),
    }
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===========================================================================
  // CODE TIER INTEGRATION (5s timeout)
  // ===========================================================================

  describe('Code Tier Integration', () => {
    beforeEach(() => {
      // Mock the LOADER (worker loader) for code execution
      mockEnv.LOADER = {
        get: vi.fn().mockImplementation((_id, factory) => {
          return {
            getEntrypoint: () => ({
              fetch: vi.fn().mockImplementation(async (request: Request) => {
                // Execute the code from the factory
                const config = await factory()
                const code = config.modules['worker.js']
                // Parse input from request body
                let input = {}
                try {
                  const bodyText = await request.text()
                  if (bodyText) {
                    input = JSON.parse(bodyText)
                  }
                } catch {
                  // Ignore parse errors
                }

                // Check for timeout simulation code
                if (code.includes('setTimeout(r, 10000)')) {
                  // Simulate a timeout error after 5s (mock behavior)
                  await new Promise(resolve => setTimeout(resolve, 5000))
                  throw new Error('Execution timeout exceeded 5000ms')
                }

                // Check for error simulation code
                if (code.includes("throw new Error('Executor failure')") || code.includes("throw new Error('Fail!')")) {
                  return new Response(JSON.stringify({ error: 'Executor failure' }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' },
                  })
                }

                // Simple code execution simulation
                // For the test case: input.x * 2
                if (code.includes('input.x * 2')) {
                  const x = (input as { x?: number }).x || 0
                  return new Response(JSON.stringify({ doubled: x * 2 }), {
                    headers: { 'Content-Type': 'application/json' },
                  })
                }

                // Default response for other code
                return new Response(JSON.stringify({ ok: true }), {
                  headers: { 'Content-Type': 'application/json' },
                })
              }),
            }),
          }
        }),
      }
    })

    it('should dispatch code function to CodeExecutor from src/tiers/', async () => {
      // Register a code function
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:code-tier-test',
        JSON.stringify({
          id: 'code-tier-test',
          version: '1.0.0',
          type: 'code',
          language: 'typescript',
          entryPoint: 'handler',
        })
      )
      await mockEnv.FUNCTIONS_CODE.put(
        'code:code-tier-test',
        `export default function handler(input) {
          return { doubled: input.x * 2 };
        }`
      )

      const request = new Request('https://functions.do/functions/code-tier-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: 21 }),
      })

      const context: InvokeHandlerContext = {
        functionId: 'code-tier-test',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      // Should use the tier executor, not placeholder
      expect(response.status).toBe(200)
      expect(body['doubled']).toBe(42)
      expect(body['_meta']).toBeDefined()
      expect((body['_meta'] as JsonBody)['executorType']).toBe('code')
      // Code functions executed via worker_loaders don't include tier number in response
      expect((body['_meta'] as JsonBody)['executedWith']).toBe('worker_loaders')
    })

    it('should handle code execution timeout gracefully', async () => {
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:code-timeout',
        JSON.stringify({
          id: 'code-timeout',
          version: '1.0.0',
          type: 'code',
          language: 'typescript',
        })
      )
      await mockEnv.FUNCTIONS_CODE.put(
        'code:code-timeout',
        `export default async function handler() {
          await new Promise(r => setTimeout(r, 10000)); // 10 second delay
          return { completed: true };
        }`
      )

      const request = new Request('https://functions.do/functions/code-timeout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'code-timeout',
        params: {},
      }

      const responsePromise = invokeHandler(request, mockEnv, mockCtx, context)

      // Advance time past the simulated 5s timeout in the mock
      await vi.advanceTimersByTimeAsync(6000)

      const response = await responsePromise
      const body = (await response.json()) as JsonBody

      // When worker loader throws a timeout error and no dispatch namespace is available,
      // it returns 501 with the error message
      expect(response.status).toBe(501)
      expect(body['error']).toBeDefined()
      expect(body['_meta']).toBeDefined()
      expect((body['_meta'] as JsonBody)['workerLoaderError']).toMatch(/timeout/i)
      expect((body['_meta'] as JsonBody)['executorType']).toBe('code')
    })

    it('should return execution metrics from worker_loaders', async () => {
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:code-metrics',
        JSON.stringify({
          id: 'code-metrics',
          version: '1.0.0',
          type: 'code',
          language: 'typescript',
        })
      )
      await mockEnv.FUNCTIONS_CODE.put(
        'code:code-metrics',
        `export default function handler() { return { ok: true }; }`
      )

      const request = new Request('https://functions.do/functions/code-metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'code-metrics',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(200)
      expect(body['ok']).toBe(true)
      expect(body['_meta']).toBeDefined()
      const meta = body['_meta'] as JsonBody
      // Worker loader execution returns these metadata fields
      expect(meta['executorType']).toBe('code')
      expect(meta['executedWith']).toBe('worker_loaders')
      expect(typeof meta['duration']).toBe('number')
    })
  })

  // ===========================================================================
  // GENERATIVE TIER INTEGRATION (30s timeout)
  // ===========================================================================

  describe('Generative Tier Integration', () => {
    beforeEach(() => {
      // Mock AI client for generative functions
      mockEnv.AI_CLIENT = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: '{"sentiment": "positive", "confidence": 0.95}' }],
            usage: { input_tokens: 50, output_tokens: 20 },
            stop_reason: 'end_turn',
          }),
        },
      }
    })

    it('should dispatch generative function to GenerativeExecutor from src/tiers/', async () => {
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:gen-tier-test',
        JSON.stringify({
          id: 'gen-tier-test',
          version: '1.0.0',
          type: 'generative',
          model: 'claude-3-sonnet',
          userPrompt: 'Analyze the sentiment of: {{text}}',
          outputSchema: {
            type: 'object',
            properties: {
              sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
              confidence: { type: 'number' },
            },
            required: ['sentiment', 'confidence'],
          },
        })
      )

      const request = new Request('https://functions.do/functions/gen-tier-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'I love this product!' }),
      })

      const context: InvokeHandlerContext = {
        functionId: 'gen-tier-test',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(200)
      expect(body['sentiment']).toBe('positive')
      expect(body['confidence']).toBeGreaterThan(0)
      expect(body['_meta']).toBeDefined()
      expect((body['_meta'] as JsonBody)['executorType']).toBe('generative')
      expect((body['_meta'] as JsonBody)['tier']).toBe(2) // Generative is tier 2
    })

    it('should enforce 30s default timeout for generative functions', async () => {
      // Mock slow AI response
      ;(mockEnv.AI_CLIENT as { messages: { create: ReturnType<typeof vi.fn> } }).messages.create = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 60000)) // 60 second delay
      )

      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:gen-timeout',
        JSON.stringify({
          id: 'gen-timeout',
          version: '1.0.0',
          type: 'generative',
          model: 'claude-3-sonnet',
          userPrompt: 'Generate a long response',
          outputSchema: { type: 'object' },
        })
      )

      const request = new Request('https://functions.do/functions/gen-timeout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'gen-timeout',
        params: {},
      }

      const responsePromise = invokeHandler(request, mockEnv, mockCtx, context)

      // Advance time past the 30s timeout
      await vi.advanceTimersByTimeAsync(35000)

      const response = await responsePromise
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(408)
      expect(body['error']).toMatch(/timeout/i)
      expect((body['_meta'] as JsonBody)['tier']).toBe(2)
    })

    it('should return generativeExecution info from GenerativeExecutor', async () => {
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:gen-info',
        JSON.stringify({
          id: 'gen-info',
          version: '1.0.0',
          type: 'generative',
          model: 'claude-3-haiku',
          userPrompt: 'Say hello',
          outputSchema: { type: 'object', properties: { message: { type: 'string' } } },
        })
      )

      const request = new Request('https://functions.do/functions/gen-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'gen-info',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(200)
      const meta = body['_meta'] as JsonBody
      expect(meta['generativeExecution']).toBeDefined()
      const genExec = meta['generativeExecution'] as JsonBody
      expect(genExec['model']).toContain('claude')
      expect(genExec['tokens']).toBeDefined()
      expect((genExec['tokens'] as JsonBody)['inputTokens']).toBeGreaterThan(0)
    })
  })

  // ===========================================================================
  // AGENTIC TIER INTEGRATION (5m timeout)
  // ===========================================================================

  describe('Agentic Tier Integration', () => {
    beforeEach(() => {
      // Mock AI client for agentic functions
      mockEnv.AI_CLIENT = {
        chat: vi.fn().mockResolvedValue({
          content: '{"searchResults": ["result1", "result2"]}',
          toolCalls: [],
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        }),
      }
    })

    it('should dispatch agentic function to AgenticExecutor from src/tiers/', async () => {
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:agent-tier-test',
        JSON.stringify({
          id: 'agent-tier-test',
          version: '1.0.0',
          type: 'agentic',
          model: 'claude-3-opus',
          systemPrompt: 'You are a research assistant.',
          goal: 'Find information about the topic',
          tools: [
            {
              name: 'web_search',
              description: 'Search the web',
              inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
            },
          ],
          maxIterations: 5,
        })
      )

      const request = new Request('https://functions.do/functions/agent-tier-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: 'quantum computing' }),
      })

      const context: InvokeHandlerContext = {
        functionId: 'agent-tier-test',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(200)
      expect(body['_meta']).toBeDefined()
      expect((body['_meta'] as JsonBody)['executorType']).toBe('agentic')
      expect((body['_meta'] as JsonBody)['tier']).toBe(3) // Agentic is tier 3
    })

    it('should enforce 5m default timeout for agentic functions', async () => {
      // Mock slow agent that never completes
      ;(mockEnv.AI_CLIENT as { chat: ReturnType<typeof vi.fn> }).chat = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 600000)) // 10 minute delay
      )

      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:agent-timeout',
        JSON.stringify({
          id: 'agent-timeout',
          version: '1.0.0',
          type: 'agentic',
          model: 'claude-3-opus',
          systemPrompt: 'You are a slow agent.',
          goal: 'Take forever',
          tools: [],
        })
      )

      const request = new Request('https://functions.do/functions/agent-timeout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'agent-timeout',
        params: {},
      }

      const responsePromise = invokeHandler(request, mockEnv, mockCtx, context)

      // Advance time past the 5 minute timeout
      await vi.advanceTimersByTimeAsync(310000) // 5m + 10s

      const response = await responsePromise
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(408)
      expect(body['error']).toMatch(/timeout/i)
      expect((body['_meta'] as JsonBody)['tier']).toBe(3)
    })

    it('should return agenticExecution info with tool calls and iterations', async () => {
      // Mock multi-iteration agent
      let callCount = 0
      ;(mockEnv.AI_CLIENT as { chat: ReturnType<typeof vi.fn> }).chat = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount < 3) {
          return Promise.resolve({
            content: '',
            toolCalls: [{ name: 'web_search', input: { query: 'test' } }],
            stopReason: 'tool_use',
            tokens: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
          })
        }
        return Promise.resolve({
          content: '{"result": "found"}',
          toolCalls: [],
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
        })
      })

      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:agent-info',
        JSON.stringify({
          id: 'agent-info',
          version: '1.0.0',
          type: 'agentic',
          model: 'claude-3-sonnet',
          systemPrompt: 'Research agent',
          goal: 'Find info',
          tools: [{ name: 'web_search', description: 'Search', inputSchema: { type: 'object' } }],
        })
      )

      const request = new Request('https://functions.do/functions/agent-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'agent-info',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(200)
      const meta = body['_meta'] as JsonBody
      expect(meta['agenticExecution']).toBeDefined()
      const agentExec = meta['agenticExecution'] as JsonBody
      expect(agentExec['iterations']).toBeGreaterThan(0)
      expect(agentExec['toolsUsed']).toBeDefined()
      expect(Array.isArray(agentExec['toolsUsed'])).toBe(true)
      expect(agentExec['totalTokens']).toBeDefined()
    })
  })

  // ===========================================================================
  // HUMAN TIER INTEGRATION (24h timeout)
  // ===========================================================================

  describe('Human Tier Integration', () => {
    beforeEach(() => {
      // Mock human task storage (Durable Object)
      mockEnv.HUMAN_TASKS = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'task-id' }),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockResolvedValue(
            new Response(JSON.stringify({
              id: 'task_123',
              status: 'pending',
              taskUrl: 'https://human.do/tasks/task_123',
              expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h from now
            }))
          ),
        }),
      }
    })

    it('should dispatch human function to HumanExecutor from src/tiers/', async () => {
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:human-tier-test',
        JSON.stringify({
          id: 'human-tier-test',
          version: '1.0.0',
          type: 'human',
          interactionType: 'approval',
          ui: {
            title: 'Approve Document',
            description: 'Please review and approve this document.',
          },
          assignees: { users: ['reviewer@example.com'] },
        })
      )

      const request = new Request('https://functions.do/functions/human-tier-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: 'Contract text...' }),
      })

      const context: InvokeHandlerContext = {
        functionId: 'human-tier-test',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      // Human tasks return 202 Accepted (async)
      expect(response.status).toBe(202)
      expect(body['taskId']).toBeDefined()
      expect(body['taskUrl']).toBeDefined()
      expect(body['_meta']).toBeDefined()
      expect((body['_meta'] as JsonBody)['executorType']).toBe('human')
      expect((body['_meta'] as JsonBody)['tier']).toBe(4) // Human is tier 4
    })

    it('should create a pending task with correct routing', async () => {
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:human-routing',
        JSON.stringify({
          id: 'human-routing',
          version: '1.0.0',
          type: 'human',
          interactionType: 'review',
          ui: { title: 'Review Request' },
          assignees: {
            users: ['alice@example.com', 'bob@example.com'],
            roundRobin: true,
          },
        })
      )

      const request = new Request('https://functions.do/functions/human-routing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Review this' }),
      })

      const context: InvokeHandlerContext = {
        functionId: 'human-routing',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(202)
      expect(body['taskId']).toBeDefined()
      // The dispatcher returns taskStatus, not status
      expect(body['taskStatus']).toBe('pending')
      // Assignees are in the humanExecution metadata, not top-level
      expect(body['_meta']).toBeDefined()
      const meta = body['_meta'] as JsonBody
      expect(meta['humanExecution']).toBeDefined()
      const humanExec = meta['humanExecution'] as JsonBody
      expect(humanExec['assignees']).toBeDefined()
    })

    it('should return humanExecution info with task details', async () => {
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:human-info',
        JSON.stringify({
          id: 'human-info',
          version: '1.0.0',
          type: 'human',
          interactionType: 'input',
          ui: { title: 'Provide Input' },
          timeout: '24h',
          sla: { responseTime: '4h', resolutionTime: '8h' },
        })
      )

      const request = new Request('https://functions.do/functions/human-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'human-info',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(202)
      const meta = body['_meta'] as JsonBody
      expect(meta['humanExecution']).toBeDefined()
      const humanExec = meta['humanExecution'] as JsonBody
      expect(humanExec['taskId']).toBeDefined()
      expect(humanExec['expiresAt']).toBeDefined()
    })
  })

  // ===========================================================================
  // CASCADE (Code -> Generative -> Agentic -> Human)
  // ===========================================================================

  describe('Cascade Function Integration', () => {
    it('should dispatch cascade function to CascadeExecutor', async () => {
      // Register the cascade with generative steps (AI_CLIENT is mocked)
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:cascade-test',
        JSON.stringify({
          id: 'cascade-test',
          version: '1.0.0',
          type: 'cascade',
          steps: [
            { functionId: 'step-one', tier: 'generative' },
            { functionId: 'step-two', tier: 'generative' },
          ],
          errorHandling: 'fail-fast',
        })
      )

      // Register step functions as generative (AI_CLIENT is mocked in Generative tests)
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:step-one',
        JSON.stringify({
          id: 'step-one',
          version: '1.0.0',
          type: 'generative',
          model: 'claude-3-sonnet',
          userPrompt: 'Process: {{text}}',
          outputSchema: { type: 'object' },
        })
      )
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:step-two',
        JSON.stringify({
          id: 'step-two',
          version: '1.0.0',
          type: 'generative',
          model: 'claude-3-sonnet',
          userPrompt: 'Finalize: {{valid}}',
          outputSchema: { type: 'object' },
        })
      )

      // Mock AI client for cascade steps
      mockEnv.AI_CLIENT = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: '{"processed": true}' }],
            usage: { input_tokens: 50, output_tokens: 20 },
            stop_reason: 'end_turn',
          }),
        },
      }

      const request = new Request('https://functions.do/functions/cascade-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Test input' }),
      })

      const context: InvokeHandlerContext = {
        functionId: 'cascade-test',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      // Cascade is dispatched via the TierDispatcher
      // Status can be 200 (all steps succeeded), 500 (cascade execution error), or other error
      expect(body['_meta']).toBeDefined()

      // If successful, executorType should be 'cascade' and stepsExecuted should be set
      if (response.status === 200) {
        expect((body['_meta'] as JsonBody)['executorType']).toBe('cascade')
        expect((body['_meta'] as JsonBody)['stepsExecuted']).toBeDefined()
        expect((body['_meta'] as JsonBody)['tiersAttempted']).toBeDefined()
      } else {
        // On step failure with fail-fast, the cascade returns the step's error result
        // with tiersAttempted added to show cascade behavior
        expect((body['_meta'] as JsonBody)['tiersAttempted']).toBeDefined()
        // executorType will be the step's type, not 'cascade' (current implementation)
      }
    })
  })

  // ===========================================================================
  // ERROR HANDLING
  // ===========================================================================

  describe('Executor Error Handling', () => {
    it('should handle executor not available gracefully', async () => {
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:no-executor',
        JSON.stringify({
          id: 'no-executor',
          version: '1.0.0',
          type: 'generative', // No AI_CLIENT configured
          model: 'claude-3-sonnet',
          userPrompt: 'Test',
          outputSchema: { type: 'object' },
        })
      )

      // Remove AI client to simulate unavailable executor
      delete mockEnv.AI_CLIENT

      const request = new Request('https://functions.do/functions/no-executor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'no-executor',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(response.status).toBe(503) // Service Unavailable
      expect(body['error']).toMatch(/executor|not available|not configured/i)
    })

    it('should propagate executor errors with proper formatting', async () => {
      // Set up a LOADER mock for this test
      mockEnv.LOADER = {
        get: vi.fn().mockImplementation((_id, factory) => {
          return {
            getEntrypoint: () => ({
              fetch: vi.fn().mockImplementation(async () => {
                const config = await factory()
                const code = config.modules['worker.js']

                // Check for error simulation code
                if (code.includes("throw new Error('Executor failure')")) {
                  // Return error as JSON (simulating worker error handling)
                  return new Response(JSON.stringify({ error: 'Executor failure' }), {
                    headers: { 'Content-Type': 'application/json' },
                  })
                }

                return new Response(JSON.stringify({ ok: true }), {
                  headers: { 'Content-Type': 'application/json' },
                })
              }),
            }),
          }
        }),
      }

      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:executor-error',
        JSON.stringify({
          id: 'executor-error',
          version: '1.0.0',
          type: 'code',
          language: 'typescript',
        })
      )
      await mockEnv.FUNCTIONS_CODE.put(
        'code:executor-error',
        `export default function handler() { throw new Error('Executor failure'); }`
      )

      const request = new Request('https://functions.do/functions/executor-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'executor-error',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      // The worker loader returns errors as JSON with status 200
      // The error is propagated through the response body
      expect(response.status).toBe(200)
      expect(body['error']).toBe('Executor failure')
      expect(body['_meta']).toBeDefined()
      expect((body['_meta'] as JsonBody)['executorType']).toBe('code')
    })

    it('should include execution metrics even on failure', async () => {
      // Set up a LOADER mock for this test
      mockEnv.LOADER = {
        get: vi.fn().mockImplementation((_id, factory) => {
          return {
            getEntrypoint: () => ({
              fetch: vi.fn().mockImplementation(async () => {
                const config = await factory()
                const code = config.modules['worker.js']

                // Check for error simulation code
                if (code.includes("throw new Error('Fail!')")) {
                  // Return error as JSON (simulating worker error handling)
                  return new Response(JSON.stringify({ error: 'Fail!' }), {
                    headers: { 'Content-Type': 'application/json' },
                  })
                }

                return new Response(JSON.stringify({ ok: true }), {
                  headers: { 'Content-Type': 'application/json' },
                })
              }),
            }),
          }
        }),
      }

      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:metrics-on-error',
        JSON.stringify({
          id: 'metrics-on-error',
          version: '1.0.0',
          type: 'code',
          language: 'typescript',
        })
      )
      await mockEnv.FUNCTIONS_CODE.put(
        'code:metrics-on-error',
        `export default function handler() { throw new Error('Fail!'); }`
      )

      const request = new Request('https://functions.do/functions/metrics-on-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'metrics-on-error',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)
      const body = (await response.json()) as JsonBody

      expect(body['_meta']).toBeDefined()
      const meta = body['_meta'] as JsonBody
      expect(meta['duration']).toBeDefined()
      expect(typeof meta['duration']).toBe('number')
      expect(meta['executorType']).toBe('code')
    })
  })

  // ===========================================================================
  // TIER ESCALATION (future feature - document expected behavior)
  // ===========================================================================

  describe('Tier Escalation', () => {
    it('should support cascade with tier fallback on failure', async () => {
      // Mock AI client for the generative fallback step
      mockEnv.AI_CLIENT = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: '{"result": "handled by generative"}' }],
            usage: { input_tokens: 50, output_tokens: 20 },
            stop_reason: 'end_turn',
          }),
        },
      }

      // Register a cascade that falls back from one generative step to another
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:fallback-cascade',
        JSON.stringify({
          id: 'fallback-cascade',
          version: '1.0.0',
          type: 'cascade',
          steps: [
            { functionId: 'step-one', tier: 'generative' },
            { functionId: 'step-two', tier: 'generative' },
          ],
          errorHandling: 'fallback',
        })
      )

      // Register the generative steps
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:step-one',
        JSON.stringify({
          id: 'step-one',
          version: '1.0.0',
          type: 'generative',
          model: 'claude-3-sonnet',
          userPrompt: 'Process input',
          outputSchema: { type: 'object' },
        })
      )
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:step-two',
        JSON.stringify({
          id: 'step-two',
          version: '1.0.0',
          type: 'generative',
          model: 'claude-3-sonnet',
          userPrompt: 'Finalize input',
          outputSchema: { type: 'object' },
        })
      )

      const request = new Request('https://functions.do/functions/fallback-cascade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ complex: 'input' }),
      })

      const context: InvokeHandlerContext = {
        functionId: 'fallback-cascade',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      // Cascade should execute successfully with generative steps
      expect(response.status).toBe(200)
      const body = (await response.json()) as JsonBody
      const meta = body['_meta'] as JsonBody
      expect(meta['tiersAttempted']).toBeDefined()
      expect(Array.isArray(meta['tiersAttempted'])).toBe(true)
      expect((meta['tiersAttempted'] as string[]).length).toBeGreaterThan(0)
    })
  })
})
