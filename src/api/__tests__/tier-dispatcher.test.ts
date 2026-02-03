/**
 * TierDispatcher Tests - Real bindings, minimal mocks
 *
 * Tests the TierDispatcher class which routes function invocations to the
 * appropriate tier executor:
 * - Tier 1: Code (5s timeout) - uses real CodeExecutor with real ai-evaluate
 * - Tier 2: Generative (30s timeout) - mock AI_CLIENT (external API)
 * - Tier 3: Agentic (5m timeout) - mock AI_CLIENT (external API)
 * - Tier 4: Human (24h timeout) - mock HUMAN_TASKS DO (not in test bindings)
 *
 * What is real:
 * - CodeExecutor actually executes TypeScript/JavaScript code via ai-evaluate
 * - KV mock (createMockKV) is a functional in-memory KV implementation
 * - Cascade dispatch with real code execution piping outputs
 *
 * What is mocked (only external services):
 * - AI_CLIENT.messages for generative tier (Claude API)
 * - AI_CLIENT.chat for agentic tier (Claude API)
 * - HUMAN_TASKS Durable Object (not available in test bindings)
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
// FUNCTIONAL WORKER LOADER FOR REAL CODE EXECUTION
// =============================================================================

/**
 * Create an async function from a code string.
 *
 * @cloudflare/vitest-pool-workers patches globalThis.Function via the
 * __VITEST_POOL_WORKERS_UNSAFE_EVAL binding, so new Function(code) works
 * in the test environment.
 */
function createAsyncFunction(code: string): () => Promise<unknown> {
  const fn = new Function(`return (async () => { ${code} })()`) as () => Promise<unknown>
  return fn
}

/**
 * Transform ai-evaluate's generated worker code into executable async function code.
 */
function transformWorkerCode(
  workerCode: string,
  options: { networkBlocked?: boolean } = {}
): string {
  const exportDefaultIdx = workerCode.lastIndexOf('export default {')
  if (exportDefaultIdx === -1) {
    throw new Error('Generated worker code missing export default handler')
  }

  let setupCode = workerCode.slice(0, exportDefaultIdx)
  setupCode = setupCode.replace(/^import\s+.*$/gm, '')
  setupCode = setupCode.replace(
    /\/\/ Capture console output[\s\S]*?console\.info = captureConsole\('info'\);/,
    `const __savedLog = console.log.bind(console);
const __savedWarn = console.warn.bind(console);
const __savedError = console.error.bind(console);
const __savedInfo = console.info.bind(console);
const captureConsole = (level, origFn) => (...args) => {
  logs.push({ level, message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), timestamp: Date.now() });
  origFn(...args);
};
console.log = captureConsole('log', __savedLog);
console.warn = captureConsole('warn', __savedWarn);
console.error = captureConsole('error', __savedError);
console.info = captureConsole('info', __savedInfo);`
  )
  setupCode = setupCode.replace(
    /export\s+default\s+(async\s+)?function\s+(?=\w)/g,
    (_, asyncKw) => `${asyncKw || ''}function `
  )
  setupCode = setupCode.replace(
    /export\s+default\s+(?!(async\s+)?function\s+\w)/g,
    'const handler = '
  )
  setupCode = setupCode.replace(/export\s+/g, '')

  const handlerCode = workerCode.slice(exportDefaultIdx)
  const tryMatch = handlerCode.match(/try\s*\{([\s\S]*?)\n\s*return Response\.json/)
  let scriptCode = ''
  if (tryMatch) {
    scriptCode = tryMatch[1]!
  }

  const networkBlockCode = options.networkBlocked
    ? `const __origFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('Network access is disabled'); };`
    : ''
  const networkRestoreCode = options.networkBlocked ? 'globalThis.fetch = __origFetch;' : ''

  const globalSaveCode = `const __savedMathRandom = Math.random; const __savedDateNow = Date.now;`
  const globalRestoreCode = `
    if (typeof __savedLog !== 'undefined') { console.log = __savedLog; console.warn = __savedWarn; console.error = __savedError; console.info = __savedInfo; }
    Math.random = __savedMathRandom; Date.now = __savedDateNow;
  `

  return `
    ${networkBlockCode}
    ${globalSaveCode}
    ${setupCode}
    try {
      ${scriptCode}
      ${globalRestoreCode}
      ${networkRestoreCode}
      return { success: true, value: __result__, logs, duration: 0 };
    } catch (__err) {
      ${globalRestoreCode}
      ${networkRestoreCode}
      throw __err;
    }
  `
}

/**
 * Create a functional WorkerLoader that actually executes code via unsafeEval.
 * This provides real code execution for the CodeExecutor without mocking.
 */
function createFunctionalWorkerLoader() {
  return {
    get(
      _id: string,
      loaderFn: () => Promise<{
        mainModule: string
        modules: Record<string, string>
        compatibilityDate?: string
        globalOutbound?: null | unknown
      }>
    ) {
      return {
        getEntrypoint() {
          return {
            async fetch(_request: Request): Promise<Response> {
              const config = await loaderFn()
              const workerCode = config.modules[config.mainModule] || ''
              try {
                const networkBlocked = config.globalOutbound === null
                const execCode = transformWorkerCode(workerCode, { networkBlocked })
                const executeFn = createAsyncFunction(execCode)
                const result = await executeFn() as Record<string, unknown>
                return new Response(JSON.stringify(result), {
                  headers: { 'Content-Type': 'application/json' },
                })
              } catch (error) {
                let message: string
                if (error instanceof Error) {
                  const name = error.constructor?.name || error.name || 'Error'
                  message = name !== 'Error' && !error.message.startsWith(name)
                    ? `${name}: ${error.message}`
                    : error.message
                } else {
                  message = String(error)
                }
                return new Response(JSON.stringify({
                  success: false,
                  error: message,
                  logs: [],
                  duration: 0,
                }), {
                  headers: { 'Content-Type': 'application/json' },
                })
              }
            }
          }
        }
      }
    }
  }
}

// =============================================================================
// MINIMAL MOCK HELPERS (only for external AI APIs and unavailable DOs)
// =============================================================================

/**
 * Create a mock AI client - only needed because generative/agentic tiers
 * call external Claude/GPT APIs that are not available in test environment.
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
 * Create a mock HUMAN_TASKS Durable Object namespace.
 * Required because HUMAN_TASKS is not in wrangler.test.jsonc bindings.
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
  let env: TierDispatcherEnv

  beforeEach(() => {
    vi.clearAllMocks()
    // Use functional in-memory KV (not vi.fn() mocks)
    // and a real functional WorkerLoader for code execution via ai-evaluate
    env = {
      FUNCTIONS_REGISTRY: createMockKV(),
      FUNCTIONS_CODE: createMockKV(),
      LOADER: createFunctionalWorkerLoader() as unknown as Fetcher,
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
      const dispatcher = new TierDispatcher(env)
      expect(dispatcher).toBeDefined()
      expect(dispatcher).toBeInstanceOf(TierDispatcher)
    })

    it('should create a TierDispatcher via factory function', () => {
      const dispatcher = createTierDispatcher(env)
      expect(dispatcher).toBeDefined()
      expect(dispatcher).toBeInstanceOf(TierDispatcher)
    })

    it('should initialize generative executor when AI_CLIENT.messages is available', () => {
      env.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{"result": "ok"}' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        },
      })
      const dispatcher = new TierDispatcher(env)
      expect(dispatcher).toBeDefined()
    })

    it('should not fail when AI_CLIENT is missing', () => {
      const dispatcher = new TierDispatcher(env)
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

    it('should export TIER_TIMEOUTS with numeric values', () => {
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
  // 3. CODE TIER DISPATCH (Tier 1) - Real CodeExecutor + ai-evaluate
  // ===========================================================================

  describe('dispatchCode (Tier 1) - real code execution', () => {
    it('should execute a simple code function that returns a value', async () => {
      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'add-numbers',
        version: '1.0.0',
        type: 'code',
        language: 'javascript',
      }

      const code = `export default function handler(input) { return { sum: input.a + input.b } }`

      const result = await dispatcher.dispatch(metadata, { a: 3, b: 7 }, code)

      expect(result.status).toBe(200)
      expect(result.body.sum).toBe(10)
      expect(result.body._meta.executorType).toBe('code')
      expect(result.body._meta.tier).toBe(1)
      expect(result.body._meta.codeExecution).toBeDefined()
      expect(result.body._meta.codeExecution?.language).toBe('javascript')
    })

    it('should execute TypeScript code with type annotations stripped', async () => {
      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'ts-greeter',
        version: '1.0.0',
        type: 'code',
        language: 'typescript',
      }

      const code = `
        interface Input { name: string }
        export default function handler(input: Input): { greeting: string } {
          return { greeting: 'Hello, ' + input.name + '!' }
        }
      `

      const result = await dispatcher.dispatch(metadata, { name: 'World' }, code)

      expect(result.status).toBe(200)
      expect(result.body.greeting).toBe('Hello, World!')
      expect(result.body._meta.codeExecution?.language).toBe('typescript')
    })

    it('should return execution metadata including duration', async () => {
      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'meta-check',
        version: '1.0.0',
        type: 'code',
        language: 'javascript',
      }

      const code = `export default function handler(input) { return { ok: true } }`

      const result = await dispatcher.dispatch(metadata, {}, code)

      expect(result.status).toBe(200)
      expect(result.body._meta.duration).toBeGreaterThanOrEqual(0)
      expect(result.body._meta.executorType).toBe('code')
      expect(result.body._meta.tier).toBe(1)
      expect(result.body._meta.codeExecution).toBeDefined()
    })

    it('should return 404 when code is not provided', async () => {
      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'no-code',
        version: '1.0.0',
        type: 'code',
      }

      const result = await dispatcher.dispatch(metadata, {}, undefined)

      expect(result.status).toBe(404)
      expect(result.body.error).toContain('not found')
      expect(result.body._meta.executorType).toBe('code')
    })

    it('should return 500 when code throws an error', async () => {
      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'error-code',
        version: '1.0.0',
        type: 'code',
        language: 'javascript',
      }

      const code = `export default function handler(input) { throw new Error('Intentional test error') }`

      const result = await dispatcher.dispatch(metadata, {})
      // Without code, it should be 404
      expect(result.status).toBe(404)

      // With code that throws
      const resultWithCode = await dispatcher.dispatch(metadata, {}, code)
      expect(resultWithCode.status).toBe(500)
      expect(resultWithCode.body.error).toBeDefined()
    })

    it('should handle complex data transformations in code tier', async () => {
      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'transform',
        version: '1.0.0',
        type: 'code',
        language: 'javascript',
      }

      const code = `
        export default function handler(input) {
          const items = input.items || []
          const filtered = items.filter(item => item.active)
          const names = filtered.map(item => item.name)
          return { count: filtered.length, names }
        }
      `

      const input = {
        items: [
          { name: 'alpha', active: true },
          { name: 'beta', active: false },
          { name: 'gamma', active: true },
        ],
      }

      const result = await dispatcher.dispatch(metadata, input, code)

      expect(result.status).toBe(200)
      expect(result.body.count).toBe(2)
      expect(result.body.names).toEqual(['alpha', 'gamma'])
    })

    it('should return 503 when code executor is nullified', async () => {
      const dispatcher = new TierDispatcher(env)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(dispatcher as any).codeExecutor = null

      const metadata: ExtendedMetadata = {
        id: 'no-executor',
        version: '1.0.0',
        type: 'code',
      }

      const result = await dispatcher.dispatch(metadata, {}, 'code')

      expect(result.status).toBe(503)
      expect(result.body.error).toContain('not available')
    })
  })

  // ===========================================================================
  // 4. GENERATIVE TIER DISPATCH (Tier 2) - Mock AI client only
  // ===========================================================================

  describe('dispatchGenerative (Tier 2)', () => {
    it('should dispatch generative function and return parsed output', async () => {
      env.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{"sentiment": "positive", "confidence": 0.95}' }],
          usage: { input_tokens: 50, output_tokens: 20 },
          stop_reason: 'end_turn',
          model: 'claude-3-sonnet',
        },
      })

      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'sentiment-classifier',
        version: '1.0.0',
        type: 'generative',
        model: 'claude-3-sonnet',
        userPrompt: 'Classify the sentiment of: {{text}}',
        outputSchema: { type: 'object' },
      }

      const result = await dispatcher.dispatch(metadata, { text: 'I love this product!' })

      expect(result.status).toBe(200)
      expect(result.body._meta.executorType).toBe('generative')
      expect(result.body._meta.tier).toBe(2)
      expect(result.body._meta.generativeExecution).toBeDefined()
      expect(result.body._meta.generativeExecution?.model).toBeDefined()
      expect(result.body._meta.generativeExecution?.tokens).toBeDefined()
    })

    it('should return 503 when AI_CLIENT is not configured', async () => {
      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'gen-no-client',
        version: '1.0.0',
        type: 'generative',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(503)
      expect(result.body.error).toContain('not available')
      expect(result.body.error).toContain('AI_CLIENT')
    })

    it('should return 500 when AI API call fails', async () => {
      env.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{}' }],
        },
      })
      env.AI_CLIENT!.messages!.create = vi.fn().mockRejectedValue(
        new Error('AI service error')
      )

      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'gen-error',
        version: '1.0.0',
        type: 'generative',
        model: 'claude-3-sonnet',
        userPrompt: 'Test prompt',
        outputSchema: { type: 'object' },
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(500)
      expect(result.body.error).toBeDefined()
    })

    it('should include generativeExecution metadata with token counts', async () => {
      env.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{"result": "ok"}' }],
          usage: { input_tokens: 100, output_tokens: 50 },
          stop_reason: 'end_turn',
          model: 'claude-3-opus',
        },
      })

      const dispatcher = new TierDispatcher(env)

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
      expect(result.body._meta.generativeExecution?.tokens.inputTokens).toBeGreaterThanOrEqual(0)
      expect(result.body._meta.generativeExecution?.tokens.outputTokens).toBeGreaterThanOrEqual(0)
    })

    it('should use default model when not specified in metadata', async () => {
      env.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{}' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        },
      })

      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'gen-default-model',
        version: '1.0.0',
        type: 'generative',
        userPrompt: 'Test',
        outputSchema: { type: 'object' },
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(200)
      expect(result.body._meta.generativeExecution?.model).toContain('claude')
    })
  })

  // ===========================================================================
  // 5. AGENTIC TIER DISPATCH (Tier 3) - Mock AI client only
  // ===========================================================================

  describe('dispatchAgentic (Tier 3)', () => {
    it('should dispatch agentic function and return result', async () => {
      env.AI_CLIENT = createMockAIClient({
        chatResponse: {
          content: '{"searchResults": ["result1"]}',
          toolCalls: [],
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        },
      })

      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'agent-search',
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

    it('should return 503 when AI_CLIENT.chat is not configured', async () => {
      env.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{}' }],
        },
      })

      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'agent-no-chat',
        version: '1.0.0',
        type: 'agentic',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(503)
      expect(result.body.error).toContain('not available')
    })

    it('should include agenticExecution metadata', async () => {
      env.AI_CLIENT = createMockAIClient({
        chatResponse: {
          content: '{"result": "done"}',
          toolCalls: [],
          stopReason: 'end_turn',
          tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        },
      })

      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'agent-meta',
        version: '1.0.0',
        type: 'agentic',
        model: 'claude-3-opus',
        goal: 'Test goal',
        tools: [],
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.body._meta.agenticExecution).toBeDefined()
      expect(result.body._meta.agenticExecution?.model).toBeDefined()
      expect(result.body._meta.agenticExecution?.iterations).toBeDefined()
      expect(result.body._meta.agenticExecution?.toolsUsed).toBeDefined()
      expect(result.body._meta.agenticExecution?.totalTokens).toBeDefined()
    })

    it('should cache and reuse agentic executor per function ID', async () => {
      env.AI_CLIENT = createMockAIClient({
        chatResponse: {
          content: '{}',
          toolCalls: [],
          stopReason: 'end_turn',
          tokens: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      })

      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'agent-cached',
        version: '1.0.0',
        type: 'agentic',
        goal: 'Test',
        tools: [],
      }

      await dispatcher.dispatch(metadata, {})
      await dispatcher.dispatch(metadata, {})

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const executors = (dispatcher as any).agenticExecutors as Map<string, unknown>
      expect(executors.has('agent-cached')).toBe(true)
      expect(executors.size).toBe(1)
    })

    it('should register tool handlers for agentic functions', async () => {
      env.AI_CLIENT = createMockAIClient({
        chatResponse: {
          content: '{}',
          toolCalls: [],
          stopReason: 'end_turn',
          tokens: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      })

      const dispatcher = new TierDispatcher(env)

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
  // 6. HUMAN TIER DISPATCH (Tier 4) - Mock HUMAN_TASKS DO
  // ===========================================================================

  describe('dispatchHuman (Tier 4)', () => {
    it('should dispatch human function and return 202 Accepted', async () => {
      env.HUMAN_TASKS = createMockHumanTasks() as unknown as DurableObjectNamespace

      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'human-approval',
        version: '1.0.0',
        type: 'human',
        interactionType: 'approval',
        ui: {
          title: 'Approve Request',
          description: 'Please approve this request.',
        },
      }

      const result = await dispatcher.dispatch(metadata, { document: 'content' })

      expect(result.status).toBe(202)
      expect(result.body.taskId).toBeDefined()
      expect(result.body.taskUrl).toBeDefined()
      expect(result.body.taskStatus).toBe('pending')
      expect(result.body._meta.executorType).toBe('human')
      expect(result.body._meta.tier).toBe(4)
    })

    it('should return 503 when HUMAN_TASKS not configured', async () => {
      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'human-no-do',
        version: '1.0.0',
        type: 'human',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(503)
      expect(result.body.error).toContain('not available')
      expect(result.body.error).toContain('HUMAN_TASKS')
    })

    it('should handle HUMAN_TASKS DO error gracefully', async () => {
      env.HUMAN_TASKS = createMockHumanTasks({
        error: 'Failed to create task',
      }) as unknown as DurableObjectNamespace

      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'human-error',
        version: '1.0.0',
        type: 'human',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(500)
      expect(result.body.error).toBeDefined()
    })

    it('should include humanExecution metadata with task details', async () => {
      const expiresAt = Date.now() + 86400000
      env.HUMAN_TASKS = createMockHumanTasks({
        response: {
          id: 'task_abc',
          status: 'pending',
          taskUrl: 'https://human.do/tasks/task_abc',
          expiresAt,
        },
      }) as unknown as DurableObjectNamespace

      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'human-meta',
        version: '1.0.0',
        type: 'human',
        ui: { title: 'Test Task' },
        assignees: { users: ['user@example.com'] },
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.body._meta.humanExecution).toBeDefined()
      expect(result.body._meta.humanExecution?.taskId).toBe('task_abc')
      expect(result.body._meta.humanExecution?.expiresAt).toBeDefined()
      expect(result.body._meta.humanExecution?.assignees).toEqual(['user@example.com'])
    })

    it('should default interactionType to approval', async () => {
      env.HUMAN_TASKS = createMockHumanTasks() as unknown as DurableObjectNamespace

      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'human-default-type',
        version: '1.0.0',
        type: 'human',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(202)
    })
  })

  // ===========================================================================
  // 7. CASCADE DISPATCH - Real code execution + KV storage
  // ===========================================================================

  describe('dispatchCascade', () => {
    it('should cascade through code steps with real execution', async () => {
      const dispatcher = new TierDispatcher(env)

      // Register a code step function in KV
      await env.FUNCTIONS_REGISTRY!.put(
        'registry:double-it',
        JSON.stringify({
          id: 'double-it',
          version: '1.0.0',
          type: 'code',
          language: 'javascript',
        })
      )

      // Store the code for the step
      await env.FUNCTIONS_CODE!.put(
        'code:double-it',
        'export default function handler(input) { return { value: (input.value || 0) * 2 } }'
      )

      const metadata: ExtendedMetadata = {
        id: 'cascade-code',
        version: '1.0.0',
        type: 'cascade',
        steps: [{ functionId: 'double-it', tier: 'code' }],
        errorHandling: 'fail-fast',
      }

      const result = await dispatcher.dispatch(metadata, { value: 5 })

      expect(result.body._meta.tiersAttempted).toContain('code')
      expect(result.body._meta.stepsExecuted).toBe(1)
      expect(result.body._meta.executorType).toBe('cascade')
      expect(result.body.value).toBe(10)
    })

    it('should pipe output from one step as input to next step', async () => {
      env.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{"enriched": true, "label": "positive"}' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        },
      })

      const dispatcher = new TierDispatcher(env)

      // Step 1: code step that transforms data
      await env.FUNCTIONS_REGISTRY!.put(
        'registry:prepare-data',
        JSON.stringify({
          id: 'prepare-data',
          version: '1.0.0',
          type: 'code',
          language: 'javascript',
        })
      )
      await env.FUNCTIONS_CODE!.put(
        'code:prepare-data',
        'export default function handler(input) { return { text: input.text, prepared: true } }'
      )

      // Step 2: generative step
      await env.FUNCTIONS_REGISTRY!.put(
        'registry:classify',
        JSON.stringify({
          id: 'classify',
          version: '1.0.0',
          type: 'generative',
          model: 'claude-3-sonnet',
          userPrompt: 'Classify: {{text}}',
          outputSchema: { type: 'object' },
        })
      )

      const metadata: ExtendedMetadata = {
        id: 'cascade-pipeline',
        version: '1.0.0',
        type: 'cascade',
        steps: [
          { functionId: 'prepare-data', tier: 'code' },
          { functionId: 'classify', tier: 'generative' },
        ],
        errorHandling: 'fail-fast',
      }

      const result = await dispatcher.dispatch(metadata, { text: 'great product' })

      expect(result.body._meta.stepsExecuted).toBe(2)
      expect(result.body._meta.tiersAttempted).toEqual(['code', 'generative'])
    })

    it('should return 404 when step function not found with fail-fast', async () => {
      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'cascade-missing-step',
        version: '1.0.0',
        type: 'cascade',
        steps: [{ functionId: 'nonexistent-fn', tier: 'code' }],
        errorHandling: 'fail-fast',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(404)
      expect(result.body.error).toContain('not found')
      expect(result.body._meta.tiersAttempted).toContain('code')
    })

    it('should return 500 when cascade has no steps', async () => {
      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'cascade-empty',
        version: '1.0.0',
        type: 'cascade',
        steps: [],
        errorHandling: 'fail-fast',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(500)
      expect(result.body.error).toContain('no successful steps')
    })

    it('should handle fallback when primary step fails', async () => {
      env.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{"fallback_result": true}' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        },
      })

      const dispatcher = new TierDispatcher(env)

      // Register a code step that will fail (no code stored)
      await env.FUNCTIONS_REGISTRY!.put(
        'registry:failing-step',
        JSON.stringify({
          id: 'failing-step',
          version: '1.0.0',
          type: 'code',
          language: 'javascript',
        })
      )
      // No code stored for 'failing-step', so it will fail with 404

      // Register the fallback (generative)
      await env.FUNCTIONS_REGISTRY!.put(
        'registry:fallback-gen',
        JSON.stringify({
          id: 'fallback-gen',
          version: '1.0.0',
          type: 'generative',
          model: 'claude-3-sonnet',
          userPrompt: 'Fallback: {{input}}',
          outputSchema: { type: 'object' },
        })
      )

      const metadata: ExtendedMetadata = {
        id: 'cascade-fallback',
        version: '1.0.0',
        type: 'cascade',
        steps: [
          { functionId: 'failing-step', tier: 'code', fallbackTo: 'fallback-gen' },
        ],
        errorHandling: 'fallback',
      }

      const result = await dispatcher.dispatch(metadata, { input: 'test' })

      // The fallback should have been attempted
      expect(result.body._meta.tiersAttempted).toBeDefined()
      expect(result.body._meta.tiersAttempted!.length).toBeGreaterThanOrEqual(1)
    })

    it('should cascade two code steps with real execution, piping output', async () => {
      const dispatcher = new TierDispatcher(env)

      // Step 1: adds 10
      await env.FUNCTIONS_REGISTRY!.put(
        'registry:add-ten',
        JSON.stringify({
          id: 'add-ten',
          version: '1.0.0',
          type: 'code',
          language: 'javascript',
        })
      )
      await env.FUNCTIONS_CODE!.put(
        'code:add-ten',
        'export default function handler(input) { return { value: (input.value || 0) + 10 } }'
      )

      // Step 2: multiplies by 3
      await env.FUNCTIONS_REGISTRY!.put(
        'registry:multiply-three',
        JSON.stringify({
          id: 'multiply-three',
          version: '1.0.0',
          type: 'code',
          language: 'javascript',
        })
      )
      await env.FUNCTIONS_CODE!.put(
        'code:multiply-three',
        'export default function handler(input) { return { value: (input.value || 0) * 3 } }'
      )

      const metadata: ExtendedMetadata = {
        id: 'cascade-math',
        version: '1.0.0',
        type: 'cascade',
        steps: [
          { functionId: 'add-ten', tier: 'code' },
          { functionId: 'multiply-three', tier: 'code' },
        ],
        errorHandling: 'fail-fast',
      }

      const result = await dispatcher.dispatch(metadata, { value: 5 })

      // (5 + 10) * 3 = 45
      expect(result.status).toBe(200)
      expect(result.body._meta.stepsExecuted).toBe(2)
      expect(result.body.value).toBe(45)
    })
  })

  // ===========================================================================
  // 8. TOOL HANDLER CREATION
  // ===========================================================================

  describe('tool handler creation', () => {
    let dispatcher: TierDispatcher

    beforeEach(() => {
      env.AI_CLIENT = createMockAIClient({
        chatResponse: {
          content: '{}',
          toolCalls: [],
          stopReason: 'end_turn',
          tokens: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      })
      dispatcher = new TierDispatcher(env)
    })

    describe('createBuiltinToolHandler', () => {
      it('should return error for unavailable builtin tools', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createBuiltinToolHandler('file_read')
        const result = await handler({ path: '/test' }, {})

        expect(result.error).toContain('not available')
      })

      it('should handle unknown builtin tool names', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createBuiltinToolHandler('unknown_tool')
        const result = await handler({}, {})

        expect(result.error).toContain('Unknown builtin tool')
      })

      it('should create handlers for all known unavailable tools', async () => {
        const unavailableTools = ['file_write', 'shell_exec', 'database_query', 'email_send', 'slack_send']
        for (const toolName of unavailableTools) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const handler = (dispatcher as any).createBuiltinToolHandler(toolName)
          const result = await handler({}, {})
          expect(result.error).toContain('not available')
        }
      })
    })

    describe('createInlineToolHandler', () => {
      it('should return security error instead of executing code', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createInlineToolHandler(
          'return { result: input.x * 2 }'
        )

        const result = await handler({ x: 21 }, {})

        expect(result.error).toContain('Inline tool handlers are not supported')
        expect(result.error).toContain('Cloudflare Workers')
        expect(result.error).toContain('new Function()')
      })

      it('should provide guidance to use function implementation type', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createInlineToolHandler(
          'throw new Error("should not run")'
        )

        const result = await handler({}, {})

        expect(result.error).toContain('function')
        expect(result.error).toContain('functionId')
      })

      it('should return same error regardless of handler code content', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createInlineToolHandler(
          'return Promise.resolve({ async: true })'
        )

        const result = await handler({}, {})

        expect(result.error).toContain('Inline tool handlers are not supported')
      })
    })

    describe('createFunctionToolHandler', () => {
      it('should return error when target function not found in registry', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createFunctionToolHandler('nonexistent')

        const result = await handler({}, {})

        expect(result.error).toContain("'nonexistent' not found")
      })

      it('should dispatch to a registered function by ID', async () => {
        await env.FUNCTIONS_REGISTRY!.put(
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
        const result = await handler({ data: 'test' }, {})

        // Will return error because the mock AI_CLIENT has chat but not messages
        // The important thing is it attempts dispatch
        expect(result.error).toBeDefined()
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

      it('should create handler for builtin type', () => {
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

      it('should create handler for api type', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createToolHandler({
          name: 'api_tool',
          description: 'API',
          inputSchema: { type: 'object' },
          implementation: { type: 'api', endpoint: 'https://api.example.com' },
        })

        expect(handler).not.toBeNull()
      })

      it('should create handler for inline type (returns error handler)', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (dispatcher as any).createToolHandler({
          name: 'inline_tool',
          description: 'Inline',
          inputSchema: { type: 'object' },
          implementation: { type: 'inline', handler: 'return input' },
        })

        expect(handler).not.toBeNull()
      })

      it('should create handler for function type', () => {
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
      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'unknown-type',
        version: '1.0.0',
        type: 'unknown' as 'code',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.status).toBe(501)
      expect(result.body.error).toContain('Unknown function type')
    })

    it('should return 500 for unexpected execution errors', async () => {
      env.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{}' }],
        },
      })

      const dispatcher = new TierDispatcher(env)

      // Replace the generative executor with one that throws
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
      // Error message propagated from executor
      expect(result.body.error).toBe('Unexpected error')
    })

    it('should include duration in all error responses', async () => {
      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'error-duration',
        version: '1.0.0',
        type: 'unknown' as 'code',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.body._meta.duration).toBeDefined()
      expect(typeof result.body._meta.duration).toBe('number')
      expect(result.body._meta.duration).toBeGreaterThanOrEqual(0)
    })

    it('should default to code type when type is not specified', async () => {
      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'default-type',
        version: '1.0.0',
        // type not specified
      }

      const result = await dispatcher.dispatch(metadata, {}, undefined)

      // Should fail because no code provided, but proves it routes to code executor
      expect(result.body._meta.executorType).toBe('code')
    })
  })

  // ===========================================================================
  // 10. TIER ROUTING LOGIC
  // ===========================================================================

  describe('tier routing logic', () => {
    it('should route code type to tier 1', async () => {
      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'route-code',
        version: '1.0.0',
        type: 'code',
      }

      const result = await dispatcher.dispatch(metadata, {}, 'code')

      expect(result.body._meta.tier).toBe(1)
    })

    it('should route generative type to tier 2', async () => {
      env.AI_CLIENT = createMockAIClient({
        messagesResponse: {
          content: [{ type: 'text', text: '{}' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        },
      })

      const dispatcher = new TierDispatcher(env)

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
      env.AI_CLIENT = createMockAIClient({
        chatResponse: {
          content: '{}',
          toolCalls: [],
          stopReason: 'end_turn',
          tokens: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      })

      const dispatcher = new TierDispatcher(env)

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
      env.HUMAN_TASKS = createMockHumanTasks() as unknown as DurableObjectNamespace

      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'route-human',
        version: '1.0.0',
        type: 'human',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.body._meta.tier).toBe(4)
    })

    it('should default unknown type to tier 1 in 501 response', async () => {
      const dispatcher = new TierDispatcher(env)

      const metadata: ExtendedMetadata = {
        id: 'route-unknown',
        version: '1.0.0',
        type: 'unknown' as 'code',
      }

      const result = await dispatcher.dispatch(metadata, {})

      expect(result.body._meta.tier).toBe(1)
    })
  })

  // ===========================================================================
  // 11. STEP METADATA AND CODE RETRIEVAL (via KV)
  // ===========================================================================

  describe('step metadata and code retrieval', () => {
    it('should retrieve step metadata from FUNCTIONS_REGISTRY KV', async () => {
      const dispatcher = new TierDispatcher(env)

      await env.FUNCTIONS_REGISTRY!.put(
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
      const dispatcher = new TierDispatcher(env)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const metadata = await (dispatcher as any).getStepMetadata('nonexistent')

      expect(metadata).toBeNull()
    })

    it('should retrieve step code from FUNCTIONS_CODE KV', async () => {
      const dispatcher = new TierDispatcher(env)

      await env.FUNCTIONS_CODE!.put(
        'code:test-step',
        'export default () => ({ ok: true })'
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = await (dispatcher as any).getStepCode('test-step')

      expect(code).toBe('export default () => ({ ok: true })')
    })

    it('should return null for nonexistent step code', async () => {
      const dispatcher = new TierDispatcher(env)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = await (dispatcher as any).getStepCode('nonexistent')

      expect(code).toBeNull()
    })
  })
})
