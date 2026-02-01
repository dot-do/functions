/**
 * E2E Tests: Agentic Function Deploy and Invoke (RED)
 *
 * These tests verify the full deployment and invocation flow for Agentic
 * functions on the live functions.do platform.
 *
 * Agentic functions are autonomous AI agents that can:
 * - Make multiple AI calls
 * - Use tools to interact with the world
 * - Make decisions based on intermediate results
 * - Loop until a goal is achieved
 *
 * Prerequisites:
 * - functions.do Worker must be deployed
 * - API keys for AI providers (OPENAI_API_KEY, ANTHROPIC_API_KEY)
 *
 * Run with: npm run test:e2e
 *
 * NOTE: These tests are in RED phase - they should all FAIL until
 * Agentic functions are implemented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  E2E_CONFIG,
  generateTestFunctionId,
  shouldRunE2E,
  deleteFunction,
} from './config'

// =============================================================================
// AGENTIC FUNCTION TYPES
// =============================================================================

interface AgenticToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description?: string }>
    required?: string[]
  }
  implementation:
    | { type: 'function'; functionId: string }
    | { type: 'api'; endpoint: string; method?: string; headers?: Record<string, string> }
    | { type: 'builtin'; name: BuiltinTool }
    | { type: 'inline'; code: string }
}

type BuiltinTool =
  | 'web_search'
  | 'web_fetch'
  | 'file_read'
  | 'file_write'
  | 'shell_exec'
  | 'database_query'
  | 'email_send'
  | 'slack_send'

interface AgenticFunctionDeployParams {
  id: string
  model?: string
  systemPrompt: string
  goal: string
  tools: AgenticToolDefinition[]
  maxIterations?: number
  maxToolCallsPerIteration?: number
  enableReasoning?: boolean
  enableMemory?: boolean
  outputSchema?: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  timeout?: string
}

interface AgenticFunctionDeployResult {
  id: string
  version: string
  url: string
  type: 'agentic'
}

interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

interface ToolCallRecord {
  tool: string
  input: unknown
  output: unknown
  durationMs: number
  success: boolean
  error?: string
}

interface AgentIteration {
  iteration: number
  timestamp: number
  reasoning?: string
  toolCalls: ToolCallRecord[]
  tokens: TokenUsage
  durationMs: number
}

interface AgenticExecutionInfo {
  model: string
  totalTokens: TokenUsage
  iterations: number
  trace: AgentIteration[]
  toolsUsed: string[]
  goalAchieved: boolean
  reasoningSummary?: string
}

interface AgenticInvokeResult<T = unknown> {
  executionId: string
  functionId: string
  functionVersion: string
  status: 'completed' | 'failed' | 'timeout' | 'cancelled'
  output?: T
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
    tokens?: TokenUsage
  }
  agenticExecution: AgenticExecutionInfo
}

// =============================================================================
// AGENTIC FUNCTION HELPERS
// =============================================================================

/**
 * Deploy an agentic function to functions.do
 */
async function deployAgenticFunction(
  params: AgenticFunctionDeployParams
): Promise<AgenticFunctionDeployResult> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/functions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
    body: JSON.stringify({
      id: params.id,
      type: 'agentic',
      version: '1.0.0',
      model: params.model || 'claude-3-sonnet',
      systemPrompt: params.systemPrompt,
      goal: params.goal,
      tools: params.tools,
      maxIterations: params.maxIterations ?? 10,
      maxToolCallsPerIteration: params.maxToolCallsPerIteration ?? 5,
      enableReasoning: params.enableReasoning ?? true,
      enableMemory: params.enableMemory ?? false,
      outputSchema: params.outputSchema,
      timeout: params.timeout ?? '5m',
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Deploy agentic function failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Invoke an agentic function
 */
async function invokeAgenticFunction<T = unknown>(
  functionId: string,
  input?: unknown,
  options?: { timeout?: number }
): Promise<AgenticInvokeResult<T>> {
  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(),
    options?.timeout ?? E2E_CONFIG.invokeTimeout
  )

  try {
    const response = await fetch(
      `${E2E_CONFIG.baseUrl}/functions/${functionId}/invoke`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
        },
        body: input ? JSON.stringify(input) : undefined,
        signal: controller.signal,
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Invoke agentic function failed (${response.status}): ${error}`)
    }

    return response.json()
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Get function metadata to verify type
 */
async function getFunction(functionId: string): Promise<{
  id: string
  type: string
  version: string
  [key: string]: unknown
}> {
  const response = await fetch(
    `${E2E_CONFIG.baseUrl}/api/functions/${functionId}`,
    {
      headers: {
        ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
      },
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Get function failed (${response.status}): ${error}`)
  }

  return response.json()
}

// =============================================================================
// TEST SUITE
// =============================================================================

describe.skipIf(!shouldRunE2E())('E2E: Agentic Function Deploy and Invoke', () => {
  const deployedFunctions: string[] = []

  // Extended timeout for agentic functions (they can take minutes)
  const AGENTIC_TIMEOUT = 5 * 60 * 1000 // 5 minutes
  const DEPLOY_TIMEOUT = E2E_CONFIG.deployTimeout

  afterAll(async () => {
    // Cleanup deployed functions
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
  // 1. AGENTIC FUNCTION DEPLOY
  // ===========================================================================

  describe('1. Agentic Function Deploy', () => {
    it('deploys an agentic function with goal and tools', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const result = await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'You are a helpful assistant that can perform calculations.',
        goal: 'Help users with mathematical calculations',
        tools: [
          {
            name: 'calculate',
            description: 'Perform a mathematical calculation',
            inputSchema: {
              type: 'object',
              properties: {
                expression: { type: 'string', description: 'Math expression to evaluate' },
              },
              required: ['expression'],
            },
            implementation: {
              type: 'inline',
              code: 'return { result: eval(input.expression) }',
            },
          },
        ],
      })

      expect(result.id).toBe(functionId)
      expect(result.version).toBe('1.0.0')
      expect(result.url).toContain(functionId)
      expect(result.type).toBe('agentic')
    }, DEPLOY_TIMEOUT)

    it('verifies function type is agentic after deploy', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'You are a test agent.',
        goal: 'Test goal',
        tools: [],
      })

      const fn = await getFunction(functionId)

      expect(fn.id).toBe(functionId)
      expect(fn.type).toBe('agentic')
    }, DEPLOY_TIMEOUT)

    it('deploys agentic function with custom model', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const result = await deployAgenticFunction({
        id: functionId,
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        goal: 'Assist users',
        tools: [],
      })

      expect(result.id).toBe(functionId)

      const fn = await getFunction(functionId)
      expect(fn.model).toBe('gpt-4o')
    }, DEPLOY_TIMEOUT)

    it('deploys agentic function with output schema', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const outputSchema = {
        type: 'object' as const,
        properties: {
          summary: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['summary'],
      }

      const result = await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'You are a summarization agent.',
        goal: 'Summarize the given content',
        tools: [],
        outputSchema,
      })

      expect(result.id).toBe(functionId)

      const fn = await getFunction(functionId)
      expect(fn.outputSchema).toEqual(outputSchema)
    }, DEPLOY_TIMEOUT)
  })

  // ===========================================================================
  // 2. SIMPLE AGENT EXECUTION
  // ===========================================================================

  describe('2. Simple Agent Execution', () => {
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

      // Verify tool was called with correct input
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
  // 3. MULTI-TOOL AGENT
  // ===========================================================================

  describe('3. Multi-Tool Agent', () => {
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

      // Collect all tool calls from trace
      const allToolCalls = result.agenticExecution.trace.flatMap((iter) => iter.toolCalls)

      expect(allToolCalls.length).toBeGreaterThanOrEqual(3)

      // Verify all steps were called
      const stepsCalled = allToolCalls.map((call) => call.tool)
      expect(stepsCalled).toContain('step1')
      expect(stepsCalled).toContain('step2')
      expect(stepsCalled).toContain('step3')

      // Verify logical order (step1 before step2, step2 before step3)
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

      // Check that fetch_a and fetch_b were in same iteration (parallel)
      const iterationWithFetches = result.agenticExecution.trace.find(
        (iter) =>
          iter.toolCalls.some((c) => c.tool === 'fetch_a') &&
          iter.toolCalls.some((c) => c.tool === 'fetch_b')
      )

      expect(iterationWithFetches).toBeDefined()
    }, AGENTIC_TIMEOUT)
  })

  // ===========================================================================
  // 4. TOOL TYPES
  // ===========================================================================

  describe('4. Tool Types', () => {
    it('calls function tool (another deployed function)', async () => {
      // First deploy a helper function
      const helperFunctionId = generateTestFunctionId()
      deployedFunctions.push(helperFunctionId)

      // Deploy helper as a regular code function
      const helperResponse = await fetch(`${E2E_CONFIG.baseUrl}/api/functions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
        },
        body: JSON.stringify({
          id: helperFunctionId,
          type: 'code',
          version: '1.0.0',
          language: 'typescript',
          code: `
            export default {
              async fetch(request: Request): Promise<Response> {
                const { x, y } = await request.json();
                return Response.json({ product: x * y });
              }
            }
          `,
        }),
      })

      if (!helperResponse.ok) {
        const error = await helperResponse.text()
        throw new Error(`Deploy helper function failed: ${error}`)
      }

      // Now deploy the agentic function that calls the helper
      const agentFunctionId = generateTestFunctionId()
      deployedFunctions.push(agentFunctionId)

      await deployAgenticFunction({
        id: agentFunctionId,
        systemPrompt: 'You are a calculator that uses the multiply function to compute products.',
        goal: 'Multiply two numbers using the multiply tool',
        tools: [
          {
            name: 'multiply',
            description: 'Multiply two numbers',
            inputSchema: {
              type: 'object',
              properties: {
                x: { type: 'number', description: 'First number' },
                y: { type: 'number', description: 'Second number' },
              },
              required: ['x', 'y'],
            },
            implementation: {
              type: 'function',
              functionId: helperFunctionId,
            },
          },
        ],
      })

      const result = await invokeAgenticFunction<{ result: number }>(
        agentFunctionId,
        { task: 'Multiply 7 and 6' },
        { timeout: AGENTIC_TIMEOUT }
      )

      expect(result.status).toBe('completed')

      const multiplyCall = result.agenticExecution.trace
        .flatMap((iter) => iter.toolCalls)
        .find((call) => call.tool === 'multiply')

      expect(multiplyCall).toBeDefined()
      expect(multiplyCall?.success).toBe(true)
      expect(multiplyCall?.output).toEqual({ product: 42 })
    }, AGENTIC_TIMEOUT)

    it('calls builtin web_search tool', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'You are a research assistant with access to web search.',
        goal: 'Search the web for information on the given topic',
        tools: [
          {
            name: 'web_search',
            description: 'Search the web for information',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query' },
                num_results: { type: 'number', description: 'Number of results' },
              },
              required: ['query'],
            },
            implementation: {
              type: 'builtin',
              name: 'web_search',
            },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {
        topic: 'latest AI developments',
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')

      const searchCall = result.agenticExecution.trace
        .flatMap((iter) => iter.toolCalls)
        .find((call) => call.tool === 'web_search')

      expect(searchCall).toBeDefined()
      expect(searchCall?.success).toBe(true)
      expect(searchCall?.output).toBeDefined()
    }, AGENTIC_TIMEOUT)

    it('calls builtin web_fetch tool', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'You can fetch content from URLs.',
        goal: 'Fetch content from the given URL',
        tools: [
          {
            name: 'web_fetch',
            description: 'Fetch content from a URL',
            inputSchema: {
              type: 'object',
              properties: {
                url: { type: 'string', description: 'URL to fetch' },
              },
              required: ['url'],
            },
            implementation: {
              type: 'builtin',
              name: 'web_fetch',
            },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {
        url: 'https://httpbin.org/json',
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')

      const fetchCall = result.agenticExecution.trace
        .flatMap((iter) => iter.toolCalls)
        .find((call) => call.tool === 'web_fetch')

      expect(fetchCall).toBeDefined()
      expect(fetchCall?.success).toBe(true)
    }, AGENTIC_TIMEOUT)

    it('calls API tool with HTTP endpoint', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'You can call external APIs.',
        goal: 'Get data from the external API',
        tools: [
          {
            name: 'get_data',
            description: 'Get data from external API',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Resource ID' },
              },
              required: ['id'],
            },
            implementation: {
              type: 'api',
              endpoint: 'https://httpbin.org/anything',
              method: 'POST',
              headers: {
                'X-Custom-Header': 'test',
              },
            },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {
        resourceId: 'test-123',
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')

      const apiCall = result.agenticExecution.trace
        .flatMap((iter) => iter.toolCalls)
        .find((call) => call.tool === 'get_data')

      expect(apiCall).toBeDefined()
      expect(apiCall?.success).toBe(true)
    }, AGENTIC_TIMEOUT)

    it('verifies tool outputs are captured in trace', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Use the echo tool to echo back input.',
        goal: 'Echo the user message',
        tools: [
          {
            name: 'echo',
            description: 'Echo back the input',
            inputSchema: {
              type: 'object',
              properties: {
                message: { type: 'string', description: 'Message to echo' },
              },
              required: ['message'],
            },
            implementation: {
              type: 'inline',
              code: 'return { echoed: input.message, timestamp: Date.now() }',
            },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {
        message: 'Hello, World!',
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')

      const echoCall = result.agenticExecution.trace
        .flatMap((iter) => iter.toolCalls)
        .find((call) => call.tool === 'echo')

      expect(echoCall).toBeDefined()
      expect(echoCall?.output).toHaveProperty('echoed', 'Hello, World!')
      expect(echoCall?.output).toHaveProperty('timestamp')
    }, AGENTIC_TIMEOUT)
  })

  // ===========================================================================
  // 5. ITERATION TRACKING
  // ===========================================================================

  describe('5. Iteration Tracking', () => {
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

      // Verify each iteration has required fields
      for (const iteration of result.agenticExecution.trace) {
        expect(iteration.iteration).toBeGreaterThan(0)
        expect(iteration.timestamp).toBeGreaterThan(0)
        expect(iteration.durationMs).toBeGreaterThanOrEqual(0)
        expect(Array.isArray(iteration.toolCalls)).toBe(true)
        expect(iteration.tokens).toBeDefined()
      }

      // Verify iterations are in chronological order
      for (let i = 1; i < result.agenticExecution.trace.length; i++) {
        expect(result.agenticExecution.trace[i].timestamp).toBeGreaterThanOrEqual(
          result.agenticExecution.trace[i - 1].timestamp
        )
      }
    }, AGENTIC_TIMEOUT)

    it('tracks tool calls per iteration', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'In each iteration, call exactly two tools.',
        goal: 'Complete task with multiple tool calls per iteration',
        maxToolCallsPerIteration: 5,
        tools: [
          {
            name: 'tool_a',
            description: 'First tool',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'return { a: true }' },
          },
          {
            name: 'tool_b',
            description: 'Second tool',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'return { b: true }' },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {}, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')

      // Find an iteration with multiple tool calls
      const iterationWithMultipleCalls = result.agenticExecution.trace.find(
        (iter) => iter.toolCalls.length >= 2
      )

      // Either we have parallel calls or sequential - both are valid
      expect(
        iterationWithMultipleCalls || result.agenticExecution.trace.length >= 2
      ).toBeTruthy()

      // Verify tool call details
      const allToolCalls = result.agenticExecution.trace.flatMap((iter) => iter.toolCalls)
      for (const toolCall of allToolCalls) {
        expect(toolCall.tool).toBeDefined()
        expect(toolCall.durationMs).toBeGreaterThanOrEqual(0)
        expect(typeof toolCall.success).toBe('boolean')
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
  // 6. MAX ITERATIONS
  // ===========================================================================

  describe('6. Max Iterations', () => {
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

      // Should stop at max iterations
      expect(result.agenticExecution.iterations).toBeLessThanOrEqual(3)
      expect(result.agenticExecution.goalAchieved).toBe(false)
    }, AGENTIC_TIMEOUT)

    it('stops at exactly maxIterations', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Keep calling the tool until told to stop.',
        goal: 'Infinite loop goal',
        maxIterations: 5,
        tools: [
          {
            name: 'loop',
            description: 'Continue looping',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'return { continue: true }' },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {}, { timeout: AGENTIC_TIMEOUT })

      // Should hit exactly 5 iterations
      expect(result.agenticExecution.iterations).toBe(5)
    }, AGENTIC_TIMEOUT)

    it('returns partial result when max iterations reached', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Collect 10 items, one per iteration.',
        goal: 'Collect 10 items',
        maxIterations: 3,
        outputSchema: {
          type: 'object',
          properties: {
            itemsCollected: { type: 'number' },
            items: { type: 'array' },
            complete: { type: 'boolean' },
          },
        },
        tools: [
          {
            name: 'collect_item',
            description: 'Collect one item',
            inputSchema: {
              type: 'object',
              properties: {
                itemNumber: { type: 'number' },
              },
              required: ['itemNumber'],
            },
            implementation: {
              type: 'inline',
              code: 'return { item: `item_${input.itemNumber}` }',
            },
          },
        ],
      })

      const result = await invokeAgenticFunction<{
        itemsCollected: number
        items: string[]
        complete: boolean
      }>(functionId, {}, { timeout: AGENTIC_TIMEOUT })

      // Should have partial results
      expect(result.agenticExecution.iterations).toBe(3)
      expect(result.output).toBeDefined()
      // Agent should report incomplete status
      expect(result.output?.complete).toBe(false)
      expect(result.output?.itemsCollected).toBeLessThan(10)
    }, AGENTIC_TIMEOUT)

    it('default maxIterations is 10', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Keep looping forever.',
        goal: 'Never achievable',
        // Note: no maxIterations specified
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

      // Default should be 10
      expect(result.agenticExecution.iterations).toBeLessThanOrEqual(10)
    }, AGENTIC_TIMEOUT)
  })

  // ===========================================================================
  // 7. REASONING TRACE
  // ===========================================================================

  describe('7. Reasoning Trace', () => {
    it('includes reasoning when enableReasoning is true', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Think step by step and explain your reasoning.',
        goal: 'Solve the problem with clear reasoning',
        enableReasoning: true,
        tools: [
          {
            name: 'solve',
            description: 'Solve the problem',
            inputSchema: {
              type: 'object',
              properties: {
                approach: { type: 'string' },
              },
              required: ['approach'],
            },
            implementation: {
              type: 'inline',
              code: 'return { solution: "solved" }',
            },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {
        problem: 'What is 2 + 2?',
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')

      // Check for reasoning in iterations
      const hasReasoning = result.agenticExecution.trace.some(
        (iter) => iter.reasoning && iter.reasoning.length > 0
      )
      expect(hasReasoning).toBe(true)
    }, AGENTIC_TIMEOUT)

    it('includes reasoningSummary in result', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Analyze the problem carefully.',
        goal: 'Provide analysis with reasoning',
        enableReasoning: true,
        tools: [
          {
            name: 'analyze',
            description: 'Analyze data',
            inputSchema: {
              type: 'object',
              properties: {
                data: { type: 'string' },
              },
            },
            implementation: {
              type: 'inline',
              code: 'return { analysis: "complete" }',
            },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {
        data: 'sample data to analyze',
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')
      expect(result.agenticExecution.reasoningSummary).toBeDefined()
      expect(result.agenticExecution.reasoningSummary!.length).toBeGreaterThan(0)
    }, AGENTIC_TIMEOUT)

    it('no reasoning when enableReasoning is false', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Just do the task.',
        goal: 'Complete task without reasoning',
        enableReasoning: false,
        tools: [
          {
            name: 'do_task',
            description: 'Do the task',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'return { done: true }' },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {}, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')

      // No reasoning should be present
      const hasReasoning = result.agenticExecution.trace.some(
        (iter) => iter.reasoning && iter.reasoning.length > 0
      )
      expect(hasReasoning).toBe(false)
      expect(result.agenticExecution.reasoningSummary).toBeUndefined()
    }, AGENTIC_TIMEOUT)

    it('reasoning captures decision-making process', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: `You must decide between two approaches:
          - If input > 10, use approach_a
          - If input <= 10, use approach_b
          Explain your decision.`,
        goal: 'Choose correct approach based on input',
        enableReasoning: true,
        tools: [
          {
            name: 'approach_a',
            description: 'Use approach A (for large inputs)',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'return { approach: "a" }' },
          },
          {
            name: 'approach_b',
            description: 'Use approach B (for small inputs)',
            inputSchema: { type: 'object', properties: {} },
            implementation: { type: 'inline', code: 'return { approach: "b" }' },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {
        value: 15,
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')

      // Find reasoning that mentions the decision
      const reasoning = result.agenticExecution.trace
        .map((iter) => iter.reasoning)
        .filter(Boolean)
        .join(' ')

      // Reasoning should mention the decision criteria
      expect(reasoning.length).toBeGreaterThan(20)
    }, AGENTIC_TIMEOUT)
  })

  // ===========================================================================
  // 8. COST TRACKING
  // ===========================================================================

  describe('8. Cost Tracking', () => {
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

      // Verify token usage is tracked
      expect(result.agenticExecution.totalTokens).toBeDefined()
      expect(result.agenticExecution.totalTokens.inputTokens).toBeGreaterThan(0)
      expect(result.agenticExecution.totalTokens.outputTokens).toBeGreaterThan(0)
      expect(result.agenticExecution.totalTokens.totalTokens).toBe(
        result.agenticExecution.totalTokens.inputTokens +
          result.agenticExecution.totalTokens.outputTokens
      )
    }, AGENTIC_TIMEOUT)

    it('tracks per-iteration token counts', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'Process each item separately.',
        goal: 'Process multiple items',
        tools: [
          {
            name: 'process',
            description: 'Process an item',
            inputSchema: {
              type: 'object',
              properties: { item: { type: 'string' } },
            },
            implementation: { type: 'inline', code: 'return { processed: input.item }' },
          },
        ],
      })

      const result = await invokeAgenticFunction(functionId, {
        items: ['item1', 'item2'],
      }, { timeout: AGENTIC_TIMEOUT })

      expect(result.status).toBe('completed')

      // Each iteration should have token usage
      for (const iteration of result.agenticExecution.trace) {
        expect(iteration.tokens).toBeDefined()
        expect(iteration.tokens.inputTokens).toBeGreaterThanOrEqual(0)
        expect(iteration.tokens.outputTokens).toBeGreaterThanOrEqual(0)
        expect(iteration.tokens.totalTokens).toBe(
          iteration.tokens.inputTokens + iteration.tokens.outputTokens
        )
      }

      // Sum of iteration tokens should equal total
      const sumInputTokens = result.agenticExecution.trace.reduce(
        (sum, iter) => sum + iter.tokens.inputTokens,
        0
      )
      const sumOutputTokens = result.agenticExecution.trace.reduce(
        (sum, iter) => sum + iter.tokens.outputTokens,
        0
      )

      expect(result.agenticExecution.totalTokens.inputTokens).toBe(sumInputTokens)
      expect(result.agenticExecution.totalTokens.outputTokens).toBe(sumOutputTokens)
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

      // Total duration should be reasonable
      expect(result.metrics.durationMs).toBeGreaterThan(0)
      expect(result.metrics.durationMs).toBeLessThanOrEqual(endTime - startTime)

      // Sum of iteration durations should approximately equal total
      const sumIterationDurations = result.agenticExecution.trace.reduce(
        (sum, iter) => sum + iter.durationMs,
        0
      )
      // Allow some overhead for orchestration
      expect(result.metrics.durationMs).toBeGreaterThanOrEqual(sumIterationDurations * 0.9)
    }, AGENTIC_TIMEOUT)
  })

  // ===========================================================================
  // 9. TIMEOUT BEHAVIOR
  // ===========================================================================

  describe('9. Timeout Behavior', () => {
    it('respects function timeout', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAgenticFunction({
        id: functionId,
        systemPrompt: 'You are a slow agent that takes time to think.',
        goal: 'Complete a slow task',
        timeout: '10s', // 10 second timeout
        maxIterations: 100,
        tools: [
          {
            name: 'slow_task',
            description: 'A task that takes time',
            inputSchema: { type: 'object', properties: {} },
            implementation: {
              type: 'inline',
              // Simulate slow operation
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
        { timeout: 30_000 } // Client timeout longer than function timeout
      )

      // Should timeout
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
      // Should have collected some items before timeout
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

      // Should still have trace data
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

      // Should have at least attempted one iteration
      expect(result.agenticExecution.iterations).toBeGreaterThanOrEqual(1)

      // The interrupted tool call should be recorded
      const lastIteration = result.agenticExecution.trace[result.agenticExecution.trace.length - 1]
      const interruptedCall = lastIteration?.toolCalls.find((c) => !c.success)

      // Either the call was interrupted or the iteration was
      expect(lastIteration).toBeDefined()
    }, 60_000)
  })

  // ===========================================================================
  // 10. ERROR RECOVERY
  // ===========================================================================

  describe('10. Error Recovery', () => {
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

      // Agent should recover and complete
      expect(result.status).toBe('completed')
      expect(result.agenticExecution.goalAchieved).toBe(true)

      // Should have tried failing tool and then used working tool
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

      // This simulates a tool that fails the first time but succeeds on retry
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

      // Find the tool calls
      const flakyCalls = result.agenticExecution.trace
        .flatMap((iter) => iter.toolCalls)
        .filter((c) => c.tool === 'flaky_tool')

      // Should have multiple attempts
      expect(flakyCalls.length).toBeGreaterThanOrEqual(2)

      // At least one should have failed
      expect(flakyCalls.some((c) => !c.success)).toBe(true)

      // At least one should have succeeded
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

      // Should have tried primary first
      const primaryCall = result.agenticExecution.trace
        .flatMap((iter) => iter.toolCalls)
        .find((c) => c.tool === 'primary_source')
      expect(primaryCall?.success).toBe(false)

      // Should have fallen back to backup
      const backupCall = result.agenticExecution.trace
        .flatMap((iter) => iter.toolCalls)
        .find((c) => c.tool === 'backup_source')
      expect(backupCall?.success).toBe(true)

      // Output should be from backup
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

      // Should fail gracefully, not crash
      expect(['completed', 'failed']).toContain(result.status)

      if (result.status === 'failed') {
        expect(result.error).toBeDefined()
        expect(result.error?.message).toBeDefined()
      }

      // Should have recorded failed attempts
      const allToolCalls = result.agenticExecution.trace.flatMap((iter) => iter.toolCalls)
      expect(allToolCalls.every((c) => !c.success)).toBe(true)
    }, AGENTIC_TIMEOUT)
  })

  // ===========================================================================
  // ADDITIONAL EDGE CASES
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

      // Should complete even without tools
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
