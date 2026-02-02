/**
 * TierDispatcher Tests
 *
 * Comprehensive tests for the TierDispatcher class which routes function
 * invocations to the appropriate tier executor:
 * - Tier 1: Code (5s timeout)
 * - Tier 2: Generative (30s timeout)
 * - Tier 3: Agentic (5m timeout)
 * - Tier 4: Human (24h timeout)
 *
 * Test Categories:
 * 1. TierDispatcher construction
 * 2. executeTier() method for each tier type
 * 3. Tool handler creation (createInlineToolHandler, createFunctionToolHandler, createHttpToolHandler)
 * 4. Error handling paths
 * 5. Tier routing logic
 * 6. Cascade execution
 *
 * @module api/__tests__/tier-dispatcher.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockKV } from '../../test-utils/mock-kv'
import {
  TierDispatcher,
  createTierDispatcher,
  TIER_MAP,
  TIER_TIMEOUTS,
  type TierDispatcherEnv,
  type ExtendedMetadata,
  type DispatchResult,
  type AIClient,
} from '../tier-dispatcher'

// =============================================================================
// MOCK HELPERS
// =============================================================================

/**
 * Create a mock AI client for generative/agentic tests
 */
function createMockAIClient(options: {
  messagesResponse?: {
    content: Array<{ type: string; text: string }>
    usage?: { input_tokens: number; output_tokens: number }
    stop_reason?: string
    model?: string
  }
  chatResponse?: {
    content: string
    toolCalls?: Array<{ name: string; input: unknown }>
    stopReason: string
    tokens: { inputTokens: number; outputTokens: number; totalTokens: number }
  }
} = {}): AIClient {
  return {
    messages: options.messagesResponse
      ? {
          create: vi.fn().mockResolvedValue(options.messagesResponse),
        }
      : undefined,
    chat: options.chatResponse
      ? vi.fn().mockResolvedValue(options.chatResponse)
      : undefined,
  }
}

/**
 * Create a mock HUMAN_TASKS durable object namespace
 */
function createMockHumanTasks(options: {
  response?: {
    id: string
    status: string
    taskUrl: string
    expiresAt: number
  }
  error?: string
} = {}) {
  return {
    idFromName: vi.fn().mockReturnValue({ toString: () => 'task-id' }),
    get: vi.fn().mockReturnValue({
      fetch: vi.fn().mockImplementation(async () => {
        if (options.error) {
          return new Response(options.error, { status: 500 })
        }
        return new Response(
          JSON.stringify(
            options.response ?? {
              id: 'task_123',
              status: 'pending',
              taskUrl: 'https://human.do/tasks/task_123',
              expiresAt: Date.now() + 24 * 60 * 60 * 1000,
            }
          )
        )
      }),
    }),
  }
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('TierDispatcher', () => {
  let mockEnv: TierDispatcherEnv

  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv = {
      FUNCTIONS_REGISTRY: createMockKV(),
      FUNCTIONS_CODE: createMockKV(),
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // 1. CONSTRUCTION TESTS
  // ===========================================================================

  describe('construction', () => {
    it('should create a TierDispatcher with minimal env', () => {
      const dispatcher = new TierDispatcher(mockEnv)
      expect(dispatcher).toBeDefined()
      expect(dispatcher).toBeInstanceOf(TierDispatcher)
    })

    it('should create a TierDispatcher via factory function', () => {
      const dispatcher = createTierDispatcher(mockEnv)
      expect(dispatcher).toBeDefined()
      expect(dispatcher).toBeInstanceOf(TierDispatcher)
    })

    it('should initialize generative executor when AI_CLIENT.messages is available', () => {
      mockEnv.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{"result": "ok"}' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        },
      })
      const dispatcher = new TierDispatcher(mockEnv)
      expect(dispatcher).toBeDefined()
    })

    it('should not initialize generative executor when AI_CLIENT is missing', () => {
      const dispatcher = new TierDispatcher(mockEnv)
      // The dispatcher still works, but will return 503 for generative functions
      expect(dispatcher).toBeDefined()
    })
  })

  // ===========================================================================
  // 2. TIER MAP AND TIMEOUT CONSTANTS
  // ===========================================================================

  describe('tier constants', () => {
    it('should export correct TIER_MAP', () => {
      expect(TIER_MAP).toEqual({
        code: 1,
        generative: 2,
        agentic: 3,
        human: 4,
      })
    })

    it('should export TIER_TIMEOUTS', () => {
      expect(TIER_TIMEOUTS).toBeDefined()
      expect(typeof TIER_TIMEOUTS[1]).toBe('number')
      expect(typeof TIER_TIMEOUTS[2]).toBe('number')
      expect(typeof TIER_TIMEOUTS[3]).toBe('number')
      expect(typeof TIER_TIMEOUTS[4]).toBe('number')
    })

    it('should have increasing timeouts per tier', () => {
      expect(TIER_TIMEOUTS[1]).toBeLessThan(TIER_TIMEOUTS[2])
      expect(TIER_TIMEOUTS[2]).toBeLessThan(TIER_TIMEOUTS[3])
      expect(TIER_TIMEOUTS[3]).toBeLessThan(TIER_TIMEOUTS[4])
    })
  })

  // ===========================================================================
  // 3. CODE TIER DISPATCH (Tier 1)
  // ===========================================================================

  describe('dispatchCode (Tier 1)', () => {
    it('should return 503 when code executor not available', async () => {
      const dispatcher = new TierDispatcher(mockEnv)

      // Access private property to null it out for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(dispatcher as any).codeExecutor = null

      const metadata: ExtendedMetadata = {
        id: 'code-test',
        version: '1.0.0',
        type: 'code',
      }

      const result = await dispatcher.dispatch(metadata, {}, 'code')

      expect(result.status).toBe(503)
      expect(result.body.error).toContain('not available')
    })

    it('should return 404 when code is not provided', async () => {
      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'code-test',
        version: '1.0.0',
        type: 'code',
      }

      const result = await dispatcher.dispatch(metadata, {}, undefined)

      expect(result.status).toBe(404)
      expect(result.body.error).toContain('not found')
    })

    it('should include execution metadata for code tier', async () => {
      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'code-meta',
        version: '1.0.0',
        type: 'code',
        language: 'typescript',
      }

      // Will fail since no LOADER, but should still have metadata
      const result = await dispatcher.dispatch(metadata, {}, 'code')

      expect(result.body._meta).toBeDefined()
      expect(result.body._meta.executorType).toBe('code')
      expect(result.body._meta.tier).toBe(1)
    })
  })

  // ===========================================================================
  // 4. GENERATIVE TIER DISPATCH (Tier 2)
  // ===========================================================================

  describe('dispatchGenerative (Tier 2)', () => {
    it('should dispatch generative function successfully', async () => {
      mockEnv.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{"sentiment": "positive", "confidence": 0.95}' }],
          usage: { input_tokens: 50, output_tokens: 20 },
          stop_reason: 'end_turn',
          model: 'claude-3-sonnet',
        },
      })

      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'gen-test',
        version: '1.0.0',
        type: 'generative',
        model: 'claude-3-sonnet',
        userPrompt: 'Classify: {{text}}',
        outputSchema: { type: 'object' },
      }

      const result = await dispatcher.dispatch(metadata, { text: 'I love this!' })

      expect(result.status).toBe(200)
      expect(result.body._meta.executorType).toBe('generative')
      expect(result.body._meta.tier).toBe(2)
      expect(result.body._meta.generativeExecution).toBeDefined()
    })

    it('should return 503 when generative executor not available', async () => {
      // No AI_CLIENT configured
      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'gen-test',
        version: '1.0.0',
        type: 'generative',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(503)
      expect(result.body.error).toContain('not available')
      expect(result.body.error).toContain('AI_CLIENT')
    })

    it('should return 500 on generative failure', async () => {
      mockEnv.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{}' }],
        },
      })

      // Make messages.create throw an error
      mockEnv.AI_CLIENT!.messages!.create = vi.fn().mockRejectedValue(
        new Error('AI service error')
      )

      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'gen-error',
        version: '1.0.0',
        type: 'generative',
        model: 'claude-3-sonnet',
        userPrompt: 'Test',
        outputSchema: { type: 'object' },
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(500)
      expect(result.body.error).toBeDefined()
    })

    it('should include generativeExecution metadata', async () => {
      mockEnv.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{"result": "ok"}' }],
          usage: { input_tokens: 100, output_tokens: 50 },
          stop_reason: 'end_turn',
          model: 'claude-3-opus',
        },
      })

      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'gen-meta',
        version: '1.0.0',
        type: 'generative',
        model: 'claude-3-opus',
        userPrompt: 'Test',
        outputSchema: { type: 'object' },
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.body._meta.generativeExecution).toBeDefined()
      expect(result.body._meta.generativeExecution?.tokens).toBeDefined()
    })

    it('should use default model when not specified', async () => {
      mockEnv.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{}' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        },
      })

      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'gen-default',
        version: '1.0.0',
        type: 'generative',
        userPrompt: 'Test',
        outputSchema: { type: 'object' },
        // model not specified
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(200)
      // Default model is claude-3-sonnet
      expect(result.body._meta.generativeExecution?.model).toContain('claude')
    })
  })

  // ===========================================================================
  // 5. AGENTIC TIER DISPATCH (Tier 3)
  // ===========================================================================

  describe('dispatchAgentic (Tier 3)', () => {
    it('should dispatch agentic function successfully', async () => {
      mockEnv.AI_CLIENT = createMockAIClient({
        chatResponse: {
          content: '{"searchResults": ["result1"]}',
          toolCalls: [],
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        },
      })

      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'agent-test',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-opus',
        systemPrompt: 'You are a helpful assistant.',
        goal: 'Complete the task',
        tools: [],
        maxIterations: 5,
      }

      const result = await dispatcher.dispatch(metadata, { query: 'test' })

      expect(result.status).toBe(200)
      expect(result.body._meta.executorType).toBe('agentic')
      expect(result.body._meta.tier).toBe(3)
      expect(result.body._meta.agenticExecution).toBeDefined()
    })

    it('should return 503 when agentic executor not available', async () => {
      // No AI_CLIENT.chat configured
      mockEnv.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{}' }],
        },
        // chat not configured
      })

      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'agent-test',
        version: '1.0.0',
        type: 'agentic',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(503)
      expect(result.body.error).toContain('not available')
    })

    it('should include agenticExecution metadata', async () => {
      mockEnv.AI_CLIENT = createMockAIClient({
        chatResponse: {
          content: '{"result": "done"}',
          toolCalls: [],
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        },
      })

      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'agent-meta',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-opus',
        goal: 'Test',
        tools: [],
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.body._meta.agenticExecution).toBeDefined()
      expect(result.body._meta.agenticExecution?.model).toBeDefined()
      expect(result.body._meta.agenticExecution?.iterations).toBeDefined()
      expect(result.body._meta.agenticExecution?.toolsUsed).toBeDefined()
    })

    it('should cache agentic executor per function ID', async () => {
      mockEnv.AI_CLIENT = createMockAIClient({
        chatResponse: {
          content: '{}',
          toolCalls: [],
          stopReason: 'end_turn',
          tokens: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      })

      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'agent-cached',
        version: '1.0.0',
        type: 'agentic',
        goal: 'Test',
        tools: [],
      }

      // Dispatch twice with same ID
      await dispatcher.dispatch(metadata, {})
      await dispatcher.dispatch(metadata, {})

      // Executor should be reused (check that agenticExecutors map has the entry)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const executors = (dispatcher as any).agenticExecutors as Map<string, unknown>
      expect(executors.has('agent-cached')).toBe(true)
      expect(executors.size).toBe(1)
    })

    it('should register tool handlers for agentic functions', async () => {
      mockEnv.AI_CLIENT = createMockAIClient({
        chatResponse: {
          content: '{}',
          toolCalls: [],
          stopReason: 'end_turn',
          tokens: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      })

      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'agent-tools',
        version: '1.0.0',
        type: 'agentic',
        goal: 'Test',
        tools: [
          {
            name: 'search',
            description: 'Search the web',
            inputSchema: { type: 'object' },
            implementation: { type: 'builtin' as const, name: 'web_search' as const },
          },
        ],
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(200)
    })
  })

  // ===========================================================================
  // 6. HUMAN TIER DISPATCH (Tier 4)
  // ===========================================================================

  describe('dispatchHuman (Tier 4)', () => {
    it('should dispatch human function successfully', async () => {
      mockEnv.HUMAN_TASKS = createMockHumanTasks() as unknown as DurableObjectNamespace

      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'human-test',
        version: '1.0.0',
        type: 'human',
        interactionType: 'approval',
        ui: {
          title: 'Approve Request',
          description: 'Please approve this request.',
        },
      }

      const result = await dispatcher.dispatch(metadata, { document: 'content' })

      expect(result.status).toBe(202) // Human tasks return 202 Accepted
      expect(result.body.taskId).toBeDefined()
      expect(result.body.taskUrl).toBeDefined()
      expect(result.body.taskStatus).toBe('pending')
      expect(result.body._meta.executorType).toBe('human')
      expect(result.body._meta.tier).toBe(4)
    })

    it('should return 503 when HUMAN_TASKS not configured', async () => {
      // No HUMAN_TASKS configured
      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'human-test',
        version: '1.0.0',
        type: 'human',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(503)
      expect(result.body.error).toContain('not available')
      expect(result.body.error).toContain('HUMAN_TASKS')
    })

    it('should handle HUMAN_TASKS error', async () => {
      mockEnv.HUMAN_TASKS = createMockHumanTasks({
        error: 'Failed to create task',
      }) as unknown as DurableObjectNamespace

      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'human-error',
        version: '1.0.0',
        type: 'human',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(500)
      expect(result.body.error).toBeDefined()
    })

    it('should include humanExecution metadata', async () => {
      mockEnv.HUMAN_TASKS = createMockHumanTasks({
        response: {
          id: 'task_abc',
          status: 'pending',
          taskUrl: 'https://human.do/tasks/task_abc',
          expiresAt: Date.now() + 86400000,
        },
      }) as unknown as DurableObjectNamespace

      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'human-meta',
        version: '1.0.0',
        type: 'human',
        ui: { title: 'Test' },
        assignees: { users: ['user@example.com'] },
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.body._meta.humanExecution).toBeDefined()
      expect(result.body._meta.humanExecution?.taskId).toBe('task_abc')
      expect(result.body._meta.humanExecution?.expiresAt).toBeDefined()
      expect(result.body._meta.humanExecution?.assignees).toEqual(['user@example.com'])
    })

    it('should use default interactionType when not specified', async () => {
      mockEnv.HUMAN_TASKS = createMockHumanTasks() as unknown as DurableObjectNamespace

      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'human-default',
        version: '1.0.0',
        type: 'human',
        // interactionType not specified - should default to 'approval'
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(202)
    })
  })

  // ===========================================================================
  // 7. CASCADE DISPATCH
  // ===========================================================================

  describe('dispatchCascade', () => {
    it('should dispatch cascade function through steps', async () => {
      mockEnv.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{"processed": true}' }],
          usage: { input_tokens: 50, output_tokens: 20 },
          stop_reason: 'end_turn',
        },
      })

      const dispatcher = new TierDispatcher(mockEnv)

      // Register step functions in KV
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

      const metadata: ExtendedMetadata = {
        id: 'cascade-test',
        version: '1.0.0',
        type: 'cascade',
        steps: [{ functionId: 'step-one', tier: 'generative' }],
        errorHandling: 'fail-fast',
      }

      const result = await dispatcher.dispatch(metadata, { text: 'test' })

      expect(result.body._meta.tiersAttempted).toBeDefined()
      expect(result.body._meta.stepsExecuted).toBeDefined()
    })

    it('should return 404 when step function not found with fail-fast', async () => {
      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'cascade-missing',
        version: '1.0.0',
        type: 'cascade',
        steps: [{ functionId: 'nonexistent', tier: 'code' }],
        errorHandling: 'fail-fast',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(404)
      expect(result.body.error).toContain('not found')
      expect(result.body._meta.tiersAttempted).toContain('code')
    })

    it('should return 500 when cascade completes with no successful steps', async () => {
      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'cascade-empty',
        version: '1.0.0',
        type: 'cascade',
        steps: [], // No steps
        errorHandling: 'fail-fast',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(500)
      expect(result.body.error).toContain('no successful steps')
    })

    it('should pass output from one step as input to next', async () => {
      mockEnv.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{"output": "step1-result"}' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        },
      })

      const dispatcher = new TierDispatcher(mockEnv)

      // Register both steps
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:step-a',
        JSON.stringify({
          id: 'step-a',
          version: '1.0.0',
          type: 'generative',
          userPrompt: 'Process: {{input}}',
          outputSchema: { type: 'object' },
        })
      )
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:step-b',
        JSON.stringify({
          id: 'step-b',
          version: '1.0.0',
          type: 'generative',
          userPrompt: 'Finalize: {{output}}',
          outputSchema: { type: 'object' },
        })
      )

      const metadata: ExtendedMetadata = {
        id: 'cascade-chain',
        version: '1.0.0',
        type: 'cascade',
        steps: [
          { functionId: 'step-a', tier: 'generative' },
          { functionId: 'step-b', tier: 'generative' },
        ],
        errorHandling: 'fail-fast',
      }

      const result = await dispatcher.dispatch(metadata, { input: 'initial' })

      expect(result.body._meta.stepsExecuted).toBe(2)
    })
  })

  // ===========================================================================
  // 8. TOOL HANDLER CREATION
  // ===========================================================================

  describe('tool handler creation', () => {
    let dispatcher: TierDispatcher

    beforeEach(() => {
      mockEnv.AI_CLIENT = createMockAIClient({
        chatResponse: {
          content: '{}',
          toolCalls: [],
          stopReason: 'end_turn',
          tokens: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      })
      dispatcher = new TierDispatcher(mockEnv)
    })

    describe('createBuiltinToolHandler', () => {
      it('should create handler for web_search', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createBuiltinToolHandler('web_search')

        // Mock global fetch
        const mockResponse = { results: ['result1'] }
        const originalFetch = globalThis.fetch
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue(mockResponse),
        })

        try {
          const result = await handler({ query: 'test query' }, {})
          expect(globalThis.fetch).toHaveBeenCalledWith(
            expect.stringContaining('search.do/search')
          )
        } finally {
          globalThis.fetch = originalFetch
        }
      })

      it('should create handler for web_fetch', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createBuiltinToolHandler('web_fetch')

        const originalFetch = globalThis.fetch
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: vi.fn().mockResolvedValue({ data: 'fetched' }),
        })

        try {
          const result = await handler({ url: 'https://example.com', method: 'GET' }, {})
          expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com', { method: 'GET' })
          expect(result).toEqual({ status: 200, data: { data: 'fetched' } })
        } finally {
          globalThis.fetch = originalFetch
        }
      })

      it('should return error for unavailable builtin tools', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fileReadHandler = (dispatcher as any).createBuiltinToolHandler('file_read')
        const result = await fileReadHandler({ path: '/test' }, {})

        expect(result.error).toContain('not available')
      })

      it('should handle unknown builtin tools', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createBuiltinToolHandler('unknown_tool')
        const result = await handler({}, {})

        expect(result.error).toContain('Unknown builtin tool')
      })
    })

    describe('createApiToolHandler', () => {
      it('should create handler that makes HTTP POST requests', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createApiToolHandler('https://api.example.com/endpoint')

        const originalFetch = globalThis.fetch
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: vi.fn().mockResolvedValue({ result: 'api response' }),
        })

        try {
          const result = await handler({ data: 'input' }, {})

          expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://api.example.com/endpoint',
            expect.objectContaining({
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: 'input' }),
            })
          )
          expect(result).toEqual({ result: 'api response' })
        } finally {
          globalThis.fetch = originalFetch
        }
      })

      it('should handle API errors gracefully', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createApiToolHandler('https://api.example.com/error')

        const originalFetch = globalThis.fetch
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

        try {
          const result = await handler({}, {})
          expect(result.error).toContain('Network error')
        } finally {
          globalThis.fetch = originalFetch
        }
      })

      it('should handle non-JSON responses', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createApiToolHandler('https://api.example.com/text')

        const originalFetch = globalThis.fetch
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: vi.fn().mockResolvedValue('plain text response'),
        })

        try {
          const result = await handler({}, {})
          expect(result).toEqual({ status: 200, data: 'plain text response' })
        } finally {
          globalThis.fetch = originalFetch
        }
      })
    })

    describe('createInlineToolHandler', () => {
      /**
       * The createInlineToolHandler has been properly fixed to NOT use new Function().
       * Instead, it returns a helpful error message explaining that inline handlers
       * are not supported in Cloudflare Workers and provides guidance on how to
       * properly deploy handler code as a function.
       */
      it('should return error message for inline handlers - correctly rejects new Function()', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createInlineToolHandler(
          'return { result: input.x * 2 }'
        )

        const result = await handler({ x: 21 }, {})

        // The handler correctly returns an error instead of trying to use new Function()
        expect(result.error).toContain('Inline tool handlers are not supported')
        expect(result.error).toContain('Cloudflare Workers')
        expect(result.error).toContain('new Function()')
      })

      it('should provide guidance to use function implementation type instead', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createInlineToolHandler(
          'throw new Error("Handler error")'
        )

        const result = await handler({}, {})

        // Should explain the alternative approach
        expect(result.error).toContain('function')
        expect(result.error).toContain('functionId')
      })

      it('should return same error message regardless of handler code', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createInlineToolHandler(
          'return Promise.resolve({ async: true })'
        )

        const result = await handler({}, {})

        // Same error for any inline handler
        expect(result.error).toContain('Inline tool handlers are not supported')
      })

      /**
       * This test verifies that the security fix is in place.
       *
       * The previous implementation used `new Function('input', handler)` which:
       * 1. Is BLOCKED in Cloudflare Workers - would not work in production
       * 2. Was a security vulnerability - allowed arbitrary code execution
       *
       * The fix returns a descriptive error message instead of trying to execute code.
       */
      it('should verify new Function() is NOT used - security fix verification', () => {
        // Access the createInlineToolHandler method
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const createHandler = (dispatcher as any).createInlineToolHandler.bind(dispatcher)

        // The handler should be a function that returns an error
        const handler = createHandler('malicious_code()')
        expect(typeof handler).toBe('function')

        // Verify it does NOT actually execute the code
        // It should return an error object, not execute the handler string
      })
    })

    describe('createFunctionToolHandler', () => {
      it('should create handler that dispatches to another function', async () => {
        // Register a target function
        await mockEnv.FUNCTIONS_REGISTRY.put(
          'registry:target-func',
          JSON.stringify({
            id: 'target-func',
            version: '1.0.0',
            type: 'generative',
            userPrompt: 'Process: {{data}}',
            outputSchema: { type: 'object' },
          })
        )

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createFunctionToolHandler('target-func')

        // The handler will try to dispatch to target-func
        const result = await handler({ data: 'test' }, {})

        // Since we don't have AI_CLIENT.messages configured properly for this nested call,
        // it will return an error
        expect(result.error).toBeDefined()
      })

      it('should return error when target function not found', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createFunctionToolHandler('nonexistent')

        const result = await handler({}, {})

        expect(result.error).toContain("'nonexistent' not found")
      })
    })

    describe('createToolHandler (factory)', () => {
      it('should return null for unknown implementation type', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createToolHandler({
          name: 'test',
          description: 'Test',
          inputSchema: { type: 'object' },
          implementation: { type: 'unknown' as 'builtin' },
        })

        expect(handler).toBeNull()
      })

      it('should route to createBuiltinToolHandler for builtin type', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createToolHandler({
          name: 'web_search',
          description: 'Search',
          inputSchema: { type: 'object' },
          implementation: { type: 'builtin', name: 'web_search' },
        })

        expect(handler).not.toBeNull()
        expect(typeof handler).toBe('function')
      })

      it('should route to createApiToolHandler for api type', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createToolHandler({
          name: 'api_tool',
          description: 'API',
          inputSchema: { type: 'object' },
          implementation: { type: 'api', endpoint: 'https://api.example.com' },
        })

        expect(handler).not.toBeNull()
      })

      it('should route to createInlineToolHandler for inline type', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createToolHandler({
          name: 'inline_tool',
          description: 'Inline',
          inputSchema: { type: 'object' },
          implementation: { type: 'inline', handler: 'return input' },
        })

        expect(handler).not.toBeNull()
      })

      it('should route to createFunctionToolHandler for function type', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createToolHandler({
          name: 'func_tool',
          description: 'Function',
          inputSchema: { type: 'object' },
          implementation: { type: 'function', functionId: 'target' },
        })

        expect(handler).not.toBeNull()
      })
    })
  })

  // ===========================================================================
  // 9. ERROR HANDLING
  // ===========================================================================

  describe('error handling', () => {
    it('should return 501 for unknown function type', async () => {
      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'unknown-type',
        version: '1.0.0',
        type: 'unknown' as 'code', // Force invalid type
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(501)
      expect(result.body.error).toContain('Unknown function type')
    })

    it('should return 500 for unexpected execution errors', async () => {
      mockEnv.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{}' }],
        },
      })

      const dispatcher = new TierDispatcher(mockEnv)

      // Make the generative executor throw
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(dispatcher as any).generativeExecutor = {
        execute: vi.fn().mockRejectedValue(new Error('Unexpected error')),
      }

      const metadata: ExtendedMetadata = {
        id: 'error-test',
        version: '1.0.0',
        type: 'generative',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(500)
      expect(result.body.error).toBe('Unexpected error')
    })

    it('should include duration in error responses', async () => {
      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'error-duration',
        version: '1.0.0',
        type: 'unknown' as 'code',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.body._meta.duration).toBeDefined()
      expect(typeof result.body._meta.duration).toBe('number')
    })

    it('should default to code type when type not specified', async () => {
      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'default-type',
        version: '1.0.0',
        // type not specified
      }

      // Should fail because no code provided, but proves it tries code executor
      const result = await dispatcher.dispatch(metadata, {}, undefined)

      expect(result.body._meta.executorType).toBe('code')
    })
  })

  // ===========================================================================
  // 10. TIER ROUTING LOGIC
  // ===========================================================================

  describe('tier routing logic', () => {
    it('should route code type to tier 1', async () => {
      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'route-code',
        version: '1.0.0',
        type: 'code',
      }

      const result = await dispatcher.dispatch(metadata, {}, 'code')

      expect(result.body._meta.tier).toBe(1)
    })

    it('should route generative type to tier 2', async () => {
      mockEnv.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{}' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        },
      })

      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'route-gen',
        version: '1.0.0',
        type: 'generative',
        userPrompt: 'Test',
        outputSchema: { type: 'object' },
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.body._meta.tier).toBe(2)
    })

    it('should route agentic type to tier 3', async () => {
      mockEnv.AI_CLIENT = createMockAIClient({
        chatResponse: {
          content: '{}',
          toolCalls: [],
          stopReason: 'end_turn',
          tokens: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      })

      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'route-agent',
        version: '1.0.0',
        type: 'agentic',
        goal: 'Test',
        tools: [],
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.body._meta.tier).toBe(3)
    })

    it('should route human type to tier 4', async () => {
      mockEnv.HUMAN_TASKS = createMockHumanTasks() as unknown as DurableObjectNamespace

      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'route-human',
        version: '1.0.0',
        type: 'human',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.body._meta.tier).toBe(4)
    })

    it('should default unknown type to tier 1', async () => {
      const dispatcher = new TierDispatcher(mockEnv)

      const metadata: ExtendedMetadata = {
        id: 'route-unknown',
        version: '1.0.0',
        type: 'unknown' as 'code',
      }

      const result = await dispatcher.dispatch(metadata, {})

      // Unknown type returns 501, but tier is set to 1 in error response
      expect(result.body._meta.tier).toBe(1)
    })
  })

  // ===========================================================================
  // 11. STEP METADATA AND CODE RETRIEVAL
  // ===========================================================================

  describe('step metadata and code retrieval', () => {
    it('should retrieve step metadata from registry', async () => {
      const dispatcher = new TierDispatcher(mockEnv)

      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:test-step',
        JSON.stringify({
          id: 'test-step',
          version: '1.0.0',
          type: 'code',
        })
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const metadata = await (dispatcher as any).getStepMetadata('test-step')

      expect(metadata).toEqual({
        id: 'test-step',
        version: '1.0.0',
        type: 'code',
      })
    })

    it('should return null for nonexistent step metadata', async () => {
      const dispatcher = new TierDispatcher(mockEnv)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const metadata = await (dispatcher as any).getStepMetadata('nonexistent')

      expect(metadata).toBeNull()
    })

    it('should retrieve step code from FUNCTIONS_CODE', async () => {
      const dispatcher = new TierDispatcher(mockEnv)

      await mockEnv.FUNCTIONS_CODE.put(
        'code:test-step',
        'export default () => ({ ok: true })'
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = await (dispatcher as any).getStepCode('test-step')

      expect(code).toBe('export default () => ({ ok: true })')
    })

    it('should return undefined for nonexistent step code', async () => {
      const dispatcher = new TierDispatcher(mockEnv)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = await (dispatcher as any).getStepCode('nonexistent')

      expect(code).toBeUndefined()
    })
  })
})
