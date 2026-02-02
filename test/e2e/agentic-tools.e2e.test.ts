/**
 * E2E Tests: Agentic Function Tool Types
 *
 * Tests for different tool types in agentic functions including
 * function tools, builtin tools, API tools, and inline tools.
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

describe.skipIf(!shouldRunE2E())('E2E: Agentic Function Tool Types', () => {
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

  // ===========================================================================
  // Reasoning Trace
  // ===========================================================================

  describe('Reasoning Trace', () => {
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

      const reasoning = result.agenticExecution.trace
        .map((iter) => iter.reasoning)
        .filter(Boolean)
        .join(' ')

      expect(reasoning.length).toBeGreaterThan(20)
    }, AGENTIC_TIMEOUT)
  })
})
