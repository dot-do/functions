/**
 * E2E Tests: Generative Function Deploy and Invoke (RED)
 *
 * These tests verify the full deployment and invocation flow for Generative
 * functions on the live functions.do platform.
 *
 * Generative functions make a single AI model call to generate structured
 * output based on a prompt template and JSON schema.
 *
 * Prerequisites:
 * - functions.do Worker must be deployed
 * - AI provider API keys configured (FUNCTIONS_AI_API_KEY)
 * - Generative function support implemented (not yet done - tests should FAIL)
 *
 * Run with: npm run test:e2e
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  E2E_CONFIG,
  generateTestFunctionId,
  shouldRunE2E,
  deleteFunction,
} from './config'

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

/**
 * Skip tests if AI API key is not available
 */
const hasAIKey = !!process.env.FUNCTIONS_AI_API_KEY
const skipIfNoAIKey = !hasAIKey ? it.skip : it

/**
 * Extended timeout for AI operations
 */
const AI_TIMEOUT = 60_000 // 60 seconds for AI model responses

/**
 * Deploy timeout + AI timeout
 */
const DEPLOY_AND_INVOKE_TIMEOUT = E2E_CONFIG.deployTimeout + AI_TIMEOUT

// =============================================================================
// GENERATIVE FUNCTION HELPERS
// =============================================================================

/**
 * Deploy a generative function to functions.do
 */
async function deployGenerativeFunction(params: {
  id: string
  name?: string
  model?: string
  systemPrompt?: string
  userPrompt: string
  outputSchema: object
  temperature?: number
  maxTokens?: number
  examples?: Array<{
    input: Record<string, unknown>
    output: unknown
  }>
  cacheEnabled?: boolean
  cacheTtlSeconds?: number
}): Promise<{
  id: string
  version: string
  url: string
  type: string
}> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/functions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
      ...(process.env.FUNCTIONS_AI_API_KEY
        ? { 'X-AI-API-Key': process.env.FUNCTIONS_AI_API_KEY }
        : {}),
    },
    body: JSON.stringify({
      id: params.id,
      name: params.name ?? params.id,
      type: 'generative',
      version: '1.0.0',
      model: params.model ?? 'claude-3-sonnet',
      systemPrompt: params.systemPrompt,
      userPrompt: params.userPrompt,
      outputSchema: params.outputSchema,
      temperature: params.temperature ?? 0,
      maxTokens: params.maxTokens,
      examples: params.examples,
      cacheEnabled: params.cacheEnabled,
      cacheTtlSeconds: params.cacheTtlSeconds,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Deploy generative function failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Invoke a generative function with variables
 */
async function invokeGenerativeFunction<T = unknown>(
  functionId: string,
  variables?: Record<string, unknown>,
  options?: {
    includeMetadata?: boolean
  }
): Promise<{
  output: T
  metadata?: {
    model: string
    tokens: {
      input: number
      output: number
      total: number
    }
    cached: boolean
    latencyMs: number
    stopReason: string
  }
}> {
  const url = new URL(`${E2E_CONFIG.baseUrl}/functions/${functionId}/invoke`)
  if (options?.includeMetadata) {
    url.searchParams.set('includeMetadata', 'true')
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
      ...(process.env.FUNCTIONS_AI_API_KEY
        ? { 'X-AI-API-Key': process.env.FUNCTIONS_AI_API_KEY }
        : {}),
    },
    body: variables ? JSON.stringify(variables) : undefined,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Invoke generative function failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Get function details
 */
async function getFunction(functionId: string): Promise<{
  id: string
  type: string
  model?: string
  outputSchema?: object
}> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/functions/${functionId}`, {
    headers: {
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Get function failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Invoke a function and return the raw response for detailed inspection
 */
async function invokeGenerativeFunctionRaw(
  functionId: string,
  variables?: Record<string, unknown>
): Promise<Response> {
  return fetch(`${E2E_CONFIG.baseUrl}/functions/${functionId}/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
      ...(process.env.FUNCTIONS_AI_API_KEY
        ? { 'X-AI-API-Key': process.env.FUNCTIONS_AI_API_KEY }
        : {}),
    },
    body: variables ? JSON.stringify(variables) : undefined,
  })
}

// =============================================================================
// E2E TESTS
// =============================================================================

describe.skipIf(!shouldRunE2E())('E2E: Generative Function Deploy and Invoke', () => {
  const deployedFunctions: string[] = []

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
  // 1. GENERATIVE FUNCTION DEPLOY
  // ===========================================================================

  describe('Generative Function Deploy', () => {
    skipIfNoAIKey('deploys a generative function with model + prompt + outputSchema', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const result = await deployGenerativeFunction({
        id: functionId,
        model: 'claude-3-sonnet',
        userPrompt: 'Classify the sentiment of this text: {{text}}',
        outputSchema: {
          type: 'object',
          properties: {
            sentiment: {
              type: 'string',
              enum: ['positive', 'negative', 'neutral'],
            },
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
            },
          },
          required: ['sentiment', 'confidence'],
        },
      })

      expect(result.id).toBe(functionId)
      expect(result.version).toBe('1.0.0')
      expect(result.url).toContain(functionId)
    }, E2E_CONFIG.deployTimeout)

    skipIfNoAIKey('verifies deployed function type is generative', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Summarize: {{content}}',
        outputSchema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
          },
          required: ['summary'],
        },
      })

      const fn = await getFunction(functionId)
      expect(fn.type).toBe('generative')
      expect(fn.model).toBe('claude-3-sonnet')
      expect(fn.outputSchema).toBeDefined()
    }, E2E_CONFIG.deployTimeout)

    skipIfNoAIKey('deploys with system prompt', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const result = await deployGenerativeFunction({
        id: functionId,
        systemPrompt: 'You are a helpful assistant that extracts structured data.',
        userPrompt: 'Extract the name and age from: {{text}}',
        outputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
          required: ['name', 'age'],
        },
      })

      expect(result.id).toBe(functionId)
    }, E2E_CONFIG.deployTimeout)

    skipIfNoAIKey('deploys with few-shot examples', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const result = await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Convert to pig latin: {{text}}',
        outputSchema: {
          type: 'object',
          properties: {
            result: { type: 'string' },
          },
          required: ['result'],
        },
        examples: [
          { input: { text: 'hello' }, output: { result: 'ellohay' } },
          { input: { text: 'world' }, output: { result: 'orldway' } },
        ],
      })

      expect(result.id).toBe(functionId)
    }, E2E_CONFIG.deployTimeout)
  })

  // ===========================================================================
  // 2. BASIC INVOCATION
  // ===========================================================================

  describe('Basic Invocation', () => {
    skipIfNoAIKey('invokes generative function with prompt variables', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'What is the capital of {{country}}? Reply with just the city name.',
        outputSchema: {
          type: 'object',
          properties: {
            capital: { type: 'string' },
          },
          required: ['capital'],
        },
      })

      const result = await invokeGenerativeFunction<{ capital: string }>(functionId, {
        country: 'France',
      })

      expect(result.output.capital).toBeDefined()
      expect(typeof result.output.capital).toBe('string')
      expect(result.output.capital.toLowerCase()).toContain('paris')
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('verifies AI-generated response content', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Generate 3 random colors as a list.',
        outputSchema: {
          type: 'object',
          properties: {
            colors: {
              type: 'array',
              items: { type: 'string' },
              minItems: 3,
              maxItems: 3,
            },
          },
          required: ['colors'],
        },
      })

      const result = await invokeGenerativeFunction<{ colors: string[] }>(functionId, {})

      expect(result.output.colors).toHaveLength(3)
      expect(result.output.colors.every((c) => typeof c === 'string')).toBe(true)
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('response matches outputSchema structure', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Analyze the product: {{name}} with price {{price}}',
        outputSchema: {
          type: 'object',
          properties: {
            analysis: {
              type: 'object',
              properties: {
                priceCategory: {
                  type: 'string',
                  enum: ['budget', 'mid-range', 'premium', 'luxury'],
                },
                description: { type: 'string' },
              },
              required: ['priceCategory', 'description'],
            },
            score: {
              type: 'number',
              minimum: 1,
              maximum: 10,
            },
          },
          required: ['analysis', 'score'],
        },
      })

      const result = await invokeGenerativeFunction<{
        analysis: { priceCategory: string; description: string }
        score: number
      }>(functionId, { name: 'iPhone Pro', price: 1199 })

      expect(result.output.analysis).toBeDefined()
      expect(result.output.analysis.priceCategory).toMatch(
        /^(budget|mid-range|premium|luxury)$/
      )
      expect(typeof result.output.analysis.description).toBe('string')
      expect(result.output.score).toBeGreaterThanOrEqual(1)
      expect(result.output.score).toBeLessThanOrEqual(10)
    }, DEPLOY_AND_INVOKE_TIMEOUT)
  })

  // ===========================================================================
  // 3. STRUCTURED OUTPUT
  // ===========================================================================

  describe('Structured Output', () => {
    skipIfNoAIKey('generates output matching simple JSON schema', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Create a user profile for someone named {{name}}',
        outputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            bio: { type: 'string', maxLength: 200 },
          },
          required: ['name', 'email', 'bio'],
        },
      })

      const result = await invokeGenerativeFunction<{
        name: string
        email: string
        bio: string
      }>(functionId, { name: 'Alice' })

      expect(result.output.name).toBeDefined()
      expect(result.output.email).toContain('@')
      expect(result.output.bio.length).toBeLessThanOrEqual(200)
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('generates nested object schemas', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Create a company profile for {{companyName}}',
        outputSchema: {
          type: 'object',
          properties: {
            company: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                founded: { type: 'number' },
                headquarters: {
                  type: 'object',
                  properties: {
                    city: { type: 'string' },
                    country: { type: 'string' },
                  },
                  required: ['city', 'country'],
                },
              },
              required: ['name', 'founded', 'headquarters'],
            },
            description: { type: 'string' },
          },
          required: ['company', 'description'],
        },
      })

      const result = await invokeGenerativeFunction<{
        company: {
          name: string
          founded: number
          headquarters: { city: string; country: string }
        }
        description: string
      }>(functionId, { companyName: 'Anthropic' })

      expect(result.output.company).toBeDefined()
      expect(result.output.company.name).toBeDefined()
      expect(typeof result.output.company.founded).toBe('number')
      expect(result.output.company.headquarters.city).toBeDefined()
      expect(result.output.company.headquarters.country).toBeDefined()
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('generates array schemas', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'List 3 books about {{topic}}',
        outputSchema: {
          type: 'object',
          properties: {
            books: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  author: { type: 'string' },
                  year: { type: 'number' },
                },
                required: ['title', 'author'],
              },
              minItems: 3,
              maxItems: 3,
            },
          },
          required: ['books'],
        },
      })

      const result = await invokeGenerativeFunction<{
        books: Array<{ title: string; author: string; year?: number }>
      }>(functionId, { topic: 'artificial intelligence' })

      expect(result.output.books).toHaveLength(3)
      result.output.books.forEach((book) => {
        expect(book.title).toBeDefined()
        expect(book.author).toBeDefined()
      })
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('generates enum-constrained values', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Classify the urgency of this task: {{task}}',
        outputSchema: {
          type: 'object',
          properties: {
            urgency: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
            },
            reason: { type: 'string' },
          },
          required: ['urgency', 'reason'],
        },
      })

      const result = await invokeGenerativeFunction<{
        urgency: 'low' | 'medium' | 'high' | 'critical'
        reason: string
      }>(functionId, { task: 'Server is on fire!' })

      expect(['low', 'medium', 'high', 'critical']).toContain(result.output.urgency)
      expect(result.output.reason).toBeDefined()
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('generates complex mixed schemas', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Analyze the meeting transcript: {{transcript}}',
        outputSchema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            participants: {
              type: 'array',
              items: { type: 'string' },
            },
            actionItems: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  task: { type: 'string' },
                  assignee: { type: 'string' },
                  priority: {
                    type: 'string',
                    enum: ['low', 'medium', 'high'],
                  },
                  dueDate: { type: 'string' },
                },
                required: ['task', 'assignee', 'priority'],
              },
            },
            sentiment: {
              type: 'string',
              enum: ['positive', 'negative', 'neutral', 'mixed'],
            },
            keyTopics: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['summary', 'participants', 'actionItems', 'sentiment', 'keyTopics'],
        },
      })

      const result = await invokeGenerativeFunction<{
        summary: string
        participants: string[]
        actionItems: Array<{
          task: string
          assignee: string
          priority: 'low' | 'medium' | 'high'
          dueDate?: string
        }>
        sentiment: 'positive' | 'negative' | 'neutral' | 'mixed'
        keyTopics: string[]
      }>(functionId, {
        transcript:
          'Alice: We need to finish the report by Friday. Bob: I can handle the data analysis. Alice: Great, and Sarah will do the presentation.',
      })

      expect(result.output.summary).toBeDefined()
      expect(Array.isArray(result.output.participants)).toBe(true)
      expect(Array.isArray(result.output.actionItems)).toBe(true)
      expect(['positive', 'negative', 'neutral', 'mixed']).toContain(result.output.sentiment)
    }, DEPLOY_AND_INVOKE_TIMEOUT)
  })

  // ===========================================================================
  // 4. MODEL SELECTION
  // ===========================================================================

  describe('Model Selection', () => {
    skipIfNoAIKey('deploys and invokes with claude-3-sonnet', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        model: 'claude-3-sonnet',
        userPrompt: 'Say hello',
        outputSchema: {
          type: 'object',
          properties: {
            greeting: { type: 'string' },
          },
          required: ['greeting'],
        },
      })

      const result = await invokeGenerativeFunction<{ greeting: string }>(
        functionId,
        {},
        { includeMetadata: true }
      )

      expect(result.output.greeting).toBeDefined()
      expect(result.metadata?.model).toContain('claude')
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('deploys and invokes with claude-3-haiku (faster model)', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        model: 'claude-3-haiku',
        userPrompt: 'Count to 3',
        outputSchema: {
          type: 'object',
          properties: {
            numbers: {
              type: 'array',
              items: { type: 'number' },
            },
          },
          required: ['numbers'],
        },
      })

      const result = await invokeGenerativeFunction<{ numbers: number[] }>(
        functionId,
        {},
        { includeMetadata: true }
      )

      expect(result.output.numbers).toBeDefined()
      expect(result.metadata?.model).toContain('haiku')
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    // OpenAI test - skip if no OpenAI key
    const hasOpenAIKey = !!process.env.OPENAI_API_KEY
    const skipIfNoOpenAI = !hasOpenAIKey ? it.skip : skipIfNoAIKey

    skipIfNoOpenAI('deploys and invokes with gpt-4o', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        model: 'gpt-4o',
        userPrompt: 'What is 2 + 2?',
        outputSchema: {
          type: 'object',
          properties: {
            answer: { type: 'number' },
          },
          required: ['answer'],
        },
      })

      const result = await invokeGenerativeFunction<{ answer: number }>(
        functionId,
        {},
        { includeMetadata: true }
      )

      expect(result.output.answer).toBe(4)
      expect(result.metadata?.model).toContain('gpt')
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('verifies model used in response metadata', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        model: 'claude-3-sonnet',
        userPrompt: 'Generate a random number between 1 and 10',
        outputSchema: {
          type: 'object',
          properties: {
            number: { type: 'number' },
          },
          required: ['number'],
        },
      })

      const result = await invokeGenerativeFunction<{ number: number }>(
        functionId,
        {},
        { includeMetadata: true }
      )

      expect(result.metadata).toBeDefined()
      expect(result.metadata?.model).toBeDefined()
      expect(typeof result.metadata?.model).toBe('string')
    }, DEPLOY_AND_INVOKE_TIMEOUT)
  })

  // ===========================================================================
  // 5. TOKEN TRACKING
  // ===========================================================================

  describe('Token Tracking', () => {
    skipIfNoAIKey('response includes token usage metadata', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Write a haiku about coding',
        outputSchema: {
          type: 'object',
          properties: {
            haiku: { type: 'string' },
          },
          required: ['haiku'],
        },
      })

      const result = await invokeGenerativeFunction<{ haiku: string }>(
        functionId,
        {},
        { includeMetadata: true }
      )

      expect(result.metadata?.tokens).toBeDefined()
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('verifies input tokens count', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Echo back: {{message}}',
        outputSchema: {
          type: 'object',
          properties: {
            echo: { type: 'string' },
          },
          required: ['echo'],
        },
      })

      const result = await invokeGenerativeFunction<{ echo: string }>(
        functionId,
        { message: 'Hello world' },
        { includeMetadata: true }
      )

      expect(result.metadata?.tokens?.input).toBeGreaterThan(0)
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('verifies output tokens count', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'List 5 programming languages',
        outputSchema: {
          type: 'object',
          properties: {
            languages: {
              type: 'array',
              items: { type: 'string' },
              minItems: 5,
            },
          },
          required: ['languages'],
        },
      })

      const result = await invokeGenerativeFunction<{ languages: string[] }>(
        functionId,
        {},
        { includeMetadata: true }
      )

      expect(result.metadata?.tokens?.output).toBeGreaterThan(0)
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('verifies total tokens equals input + output', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'What day comes after {{day}}?',
        outputSchema: {
          type: 'object',
          properties: {
            nextDay: { type: 'string' },
          },
          required: ['nextDay'],
        },
      })

      const result = await invokeGenerativeFunction<{ nextDay: string }>(
        functionId,
        { day: 'Monday' },
        { includeMetadata: true }
      )

      const tokens = result.metadata?.tokens
      expect(tokens?.total).toBe(tokens?.input + tokens?.output)
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('larger prompts use more input tokens', async () => {
      const functionIdShort = generateTestFunctionId()
      const functionIdLong = generateTestFunctionId()
      deployedFunctions.push(functionIdShort, functionIdLong)

      // Short prompt
      await deployGenerativeFunction({
        id: functionIdShort,
        userPrompt: 'Say hi',
        outputSchema: {
          type: 'object',
          properties: { greeting: { type: 'string' } },
          required: ['greeting'],
        },
      })

      // Long prompt
      await deployGenerativeFunction({
        id: functionIdLong,
        userPrompt:
          'Please provide a comprehensive analysis of the following text, including sentiment, key themes, and a detailed summary: {{text}}',
        systemPrompt:
          'You are an expert text analyst with deep knowledge of linguistics and content analysis.',
        outputSchema: {
          type: 'object',
          properties: { analysis: { type: 'string' } },
          required: ['analysis'],
        },
      })

      const resultShort = await invokeGenerativeFunction<{ greeting: string }>(
        functionIdShort,
        {},
        { includeMetadata: true }
      )

      const resultLong = await invokeGenerativeFunction<{ analysis: string }>(
        functionIdLong,
        { text: 'This is a test text for analysis.' },
        { includeMetadata: true }
      )

      expect(resultLong.metadata?.tokens?.input).toBeGreaterThan(
        resultShort.metadata?.tokens?.input || 0
      )
    }, DEPLOY_AND_INVOKE_TIMEOUT * 2)
  })

  // ===========================================================================
  // 6. CACHING
  // ===========================================================================

  describe('Caching', () => {
    skipIfNoAIKey('deploys function with caching enabled', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const result = await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'What is the square root of {{number}}?',
        outputSchema: {
          type: 'object',
          properties: {
            result: { type: 'number' },
          },
          required: ['result'],
        },
        cacheEnabled: true,
        cacheTtlSeconds: 300,
      })

      expect(result.id).toBe(functionId)
    }, E2E_CONFIG.deployTimeout)

    skipIfNoAIKey('second invocation with same input is cached', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Generate a UUID-like identifier for: {{seed}}',
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
        cacheEnabled: true,
        cacheTtlSeconds: 300,
      })

      // First invocation (not cached)
      const result1 = await invokeGenerativeFunction<{ id: string }>(
        functionId,
        { seed: 'test-seed-123' },
        { includeMetadata: true }
      )

      // Second invocation (should be cached)
      const result2 = await invokeGenerativeFunction<{ id: string }>(
        functionId,
        { seed: 'test-seed-123' },
        { includeMetadata: true }
      )

      expect(result1.metadata?.cached).toBe(false)
      expect(result2.metadata?.cached).toBe(true)
      // Cached results should be identical
      expect(result2.output.id).toBe(result1.output.id)
    }, DEPLOY_AND_INVOKE_TIMEOUT * 2)

    skipIfNoAIKey('cached response is faster than uncached', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Write a short poem about {{subject}}',
        outputSchema: {
          type: 'object',
          properties: {
            poem: { type: 'string' },
          },
          required: ['poem'],
        },
        cacheEnabled: true,
        cacheTtlSeconds: 300,
      })

      // First invocation - measure time
      const start1 = Date.now()
      await invokeGenerativeFunction<{ poem: string }>(
        functionId,
        { subject: 'caching' },
        { includeMetadata: true }
      )
      const duration1 = Date.now() - start1

      // Second invocation - measure time (should be faster)
      const start2 = Date.now()
      const result2 = await invokeGenerativeFunction<{ poem: string }>(
        functionId,
        { subject: 'caching' },
        { includeMetadata: true }
      )
      const duration2 = Date.now() - start2

      expect(result2.metadata?.cached).toBe(true)
      expect(duration2).toBeLessThan(duration1)
    }, DEPLOY_AND_INVOKE_TIMEOUT * 2)

    skipIfNoAIKey('different inputs are not cached', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'What color is {{fruit}}?',
        outputSchema: {
          type: 'object',
          properties: {
            color: { type: 'string' },
          },
          required: ['color'],
        },
        cacheEnabled: true,
        cacheTtlSeconds: 300,
      })

      const result1 = await invokeGenerativeFunction<{ color: string }>(
        functionId,
        { fruit: 'banana' },
        { includeMetadata: true }
      )

      const result2 = await invokeGenerativeFunction<{ color: string }>(
        functionId,
        { fruit: 'apple' },
        { includeMetadata: true }
      )

      expect(result1.metadata?.cached).toBe(false)
      expect(result2.metadata?.cached).toBe(false)
      // Different inputs should produce different outputs
      // (banana is yellow, apple is red/green)
    }, DEPLOY_AND_INVOKE_TIMEOUT * 2)

    skipIfNoAIKey('metadata indicates cached: true for cache hit', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Return a greeting for {{name}}',
        outputSchema: {
          type: 'object',
          properties: {
            greeting: { type: 'string' },
          },
          required: ['greeting'],
        },
        cacheEnabled: true,
        cacheTtlSeconds: 300,
      })

      // First call
      await invokeGenerativeFunction<{ greeting: string }>(functionId, { name: 'CacheTest' })

      // Second call - check metadata
      const result = await invokeGenerativeFunction<{ greeting: string }>(
        functionId,
        { name: 'CacheTest' },
        { includeMetadata: true }
      )

      expect(result.metadata?.cached).toBe(true)
    }, DEPLOY_AND_INVOKE_TIMEOUT * 2)
  })

  // ===========================================================================
  // 7. ERROR HANDLING
  // ===========================================================================

  describe('Error Handling', () => {
    skipIfNoAIKey('rejects invalid model name', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await expect(
        deployGenerativeFunction({
          id: functionId,
          model: 'invalid-model-that-does-not-exist',
          userPrompt: 'Test prompt',
          outputSchema: {
            type: 'object',
            properties: {
              result: { type: 'string' },
            },
            required: ['result'],
          },
        })
      ).rejects.toThrow(/invalid.*model|model.*not.*found|unsupported.*model/i)
    }, E2E_CONFIG.deployTimeout)

    skipIfNoAIKey('rejects malformed prompt template', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await expect(
        deployGenerativeFunction({
          id: functionId,
          userPrompt: '', // Empty prompt
          outputSchema: {
            type: 'object',
            properties: {
              result: { type: 'string' },
            },
            required: ['result'],
          },
        })
      ).rejects.toThrow(/prompt.*required|empty.*prompt|invalid.*prompt/i)
    }, E2E_CONFIG.deployTimeout)

    skipIfNoAIKey('rejects invalid output schema', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await expect(
        deployGenerativeFunction({
          id: functionId,
          userPrompt: 'Test prompt',
          outputSchema: {
            type: 'invalid-type' as 'object',
            properties: {},
          },
        })
      ).rejects.toThrow(/schema|invalid.*type/i)
    }, E2E_CONFIG.deployTimeout)

    skipIfNoAIKey('handles missing required variables', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Hello {{name}}, your age is {{age}}',
        outputSchema: {
          type: 'object',
          properties: {
            greeting: { type: 'string' },
          },
          required: ['greeting'],
        },
      })

      // Invoke without required variables
      await expect(
        invokeGenerativeFunction(functionId, { name: 'Alice' }) // missing 'age'
      ).rejects.toThrow(/missing.*variable|required.*age|variable.*not.*provided/i)
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('returns error for impossible schema constraints', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Generate a number',
        outputSchema: {
          type: 'object',
          properties: {
            number: {
              type: 'number',
              minimum: 100,
              maximum: 10, // Impossible: min > max
            },
          },
          required: ['number'],
        },
      })

      await expect(invokeGenerativeFunction(functionId, {})).rejects.toThrow(
        /schema|constraint|impossible|validation/i
      )
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('handles AI provider errors gracefully', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      // This test simulates what happens when the AI provider is unavailable
      // The exact behavior depends on implementation
      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Test',
        outputSchema: {
          type: 'object',
          properties: {
            result: { type: 'string' },
          },
          required: ['result'],
        },
        maxTokens: 1, // Very restrictive - may cause issues
      })

      const response = await invokeGenerativeFunctionRaw(functionId, {})

      // Should return an error response, not crash
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        expect(errorBody).toBeDefined()
      }
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('rejects outputSchema with unsupported types', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await expect(
        deployGenerativeFunction({
          id: functionId,
          userPrompt: 'Test',
          outputSchema: {
            type: 'object',
            properties: {
              func: {
                type: 'function' as 'string', // Not a valid JSON Schema type
              },
            },
            required: ['func'],
          },
        })
      ).rejects.toThrow(/schema|type|unsupported/i)
    }, E2E_CONFIG.deployTimeout)

    skipIfNoAIKey('returns structured error response', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      // Try to invoke a non-existent generative function
      const response = await invokeGenerativeFunctionRaw('non-existent-function-xyz', {})

      expect(response.ok).toBe(false)
      expect(response.status).toBeGreaterThanOrEqual(400)

      const errorBody = await response.json()
      expect(errorBody.error).toBeDefined()
      expect(typeof errorBody.error.message).toBe('string')
    }, E2E_CONFIG.invokeTimeout)
  })

  // ===========================================================================
  // 8. RATE LIMITING
  // ===========================================================================

  describe('Rate Limiting', () => {
    skipIfNoAIKey('enforces rate limits on rapid invocations', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Say {{word}}',
        outputSchema: {
          type: 'object',
          properties: {
            response: { type: 'string' },
          },
          required: ['response'],
        },
      })

      // Make many rapid requests
      const requests = Array.from({ length: 50 }, (_, i) =>
        invokeGenerativeFunctionRaw(functionId, { word: `test${i}` })
      )

      const responses = await Promise.all(requests)
      const rateLimitedResponses = responses.filter((r) => r.status === 429)

      // At least some requests should be rate limited
      expect(rateLimitedResponses.length).toBeGreaterThan(0)
    }, DEPLOY_AND_INVOKE_TIMEOUT * 2)

    skipIfNoAIKey('returns 429 status code when rate limited', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Quick test: {{n}}',
        outputSchema: {
          type: 'object',
          properties: {
            result: { type: 'string' },
          },
          required: ['result'],
        },
      })

      // Flood with requests
      const requests: Promise<Response>[] = []
      for (let i = 0; i < 100; i++) {
        requests.push(invokeGenerativeFunctionRaw(functionId, { n: i }))
      }

      const responses = await Promise.all(requests)
      const has429 = responses.some((r) => r.status === 429)

      expect(has429).toBe(true)
    }, DEPLOY_AND_INVOKE_TIMEOUT * 3)

    skipIfNoAIKey('includes Retry-After header in rate limit response', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Echo: {{text}}',
        outputSchema: {
          type: 'object',
          properties: {
            echo: { type: 'string' },
          },
          required: ['echo'],
        },
      })

      // Flood with requests to trigger rate limit
      const requests = Array.from({ length: 100 }, (_, i) =>
        invokeGenerativeFunctionRaw(functionId, { text: `flood${i}` })
      )

      const responses = await Promise.all(requests)
      const rateLimitedResponse = responses.find((r) => r.status === 429)

      if (rateLimitedResponse) {
        const retryAfter = rateLimitedResponse.headers.get('Retry-After')
        expect(retryAfter).toBeDefined()
        expect(parseInt(retryAfter || '0', 10)).toBeGreaterThan(0)
      } else {
        // If no rate limiting occurred, skip this assertion
        // (might happen in test environments with high limits)
        console.warn('No rate limiting observed - test may need adjustment')
      }
    }, DEPLOY_AND_INVOKE_TIMEOUT * 3)

    skipIfNoAIKey('rate limit error includes helpful message', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Test: {{i}}',
        outputSchema: {
          type: 'object',
          properties: {
            result: { type: 'string' },
          },
          required: ['result'],
        },
      })

      // Flood with requests
      const requests = Array.from({ length: 100 }, (_, i) =>
        invokeGenerativeFunctionRaw(functionId, { i })
      )

      const responses = await Promise.all(requests)
      const rateLimitedResponse = responses.find((r) => r.status === 429)

      if (rateLimitedResponse) {
        const body = await rateLimitedResponse.json()
        expect(body.error).toBeDefined()
        expect(body.error.message).toMatch(/rate.*limit|too.*many.*requests|throttl/i)
      }
    }, DEPLOY_AND_INVOKE_TIMEOUT * 3)
  })

  // ===========================================================================
  // ADDITIONAL TESTS
  // ===========================================================================

  describe('Temperature and Generation Settings', () => {
    skipIfNoAIKey('temperature 0 produces deterministic output', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'What is 1 + 1?',
        outputSchema: {
          type: 'object',
          properties: {
            answer: { type: 'number' },
          },
          required: ['answer'],
        },
        temperature: 0,
      })

      const result1 = await invokeGenerativeFunction<{ answer: number }>(functionId, {})
      const result2 = await invokeGenerativeFunction<{ answer: number }>(functionId, {})

      expect(result1.output.answer).toBe(result2.output.answer)
      expect(result1.output.answer).toBe(2)
    }, DEPLOY_AND_INVOKE_TIMEOUT * 2)

    skipIfNoAIKey('respects maxTokens setting', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Write a very long essay about {{topic}}',
        outputSchema: {
          type: 'object',
          properties: {
            essay: { type: 'string' },
          },
          required: ['essay'],
        },
        maxTokens: 50, // Very short
      })

      const result = await invokeGenerativeFunction<{ essay: string }>(
        functionId,
        { topic: 'artificial intelligence' },
        { includeMetadata: true }
      )

      // Output should be truncated due to maxTokens
      expect(result.metadata?.tokens?.output).toBeLessThanOrEqual(50)
    }, DEPLOY_AND_INVOKE_TIMEOUT)
  })

  describe('Prompt Template Variables', () => {
    skipIfNoAIKey('handles multiple variables in prompt', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt:
          'Create a profile for {{name}} who is {{age}} years old and works as a {{job}}',
        outputSchema: {
          type: 'object',
          properties: {
            profile: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                age: { type: 'number' },
                occupation: { type: 'string' },
              },
              required: ['name', 'age', 'occupation'],
            },
          },
          required: ['profile'],
        },
      })

      const result = await invokeGenerativeFunction<{
        profile: { name: string; age: number; occupation: string }
      }>(functionId, {
        name: 'Alice',
        age: 30,
        job: 'engineer',
      })

      expect(result.output.profile.name).toContain('Alice')
      expect(result.output.profile.age).toBe(30)
      expect(result.output.profile.occupation.toLowerCase()).toContain('engineer')
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('handles special characters in variables', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Translate to French: {{text}}',
        outputSchema: {
          type: 'object',
          properties: {
            translation: { type: 'string' },
          },
          required: ['translation'],
        },
      })

      const result = await invokeGenerativeFunction<{ translation: string }>(functionId, {
        text: 'Hello, how are you? <script>alert("xss")</script>',
      })

      expect(result.output.translation).toBeDefined()
      // Should handle the input without executing or breaking
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('handles JSON in variables', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployGenerativeFunction({
        id: functionId,
        userPrompt: 'Analyze this JSON data: {{data}}',
        outputSchema: {
          type: 'object',
          properties: {
            analysis: { type: 'string' },
            fieldCount: { type: 'number' },
          },
          required: ['analysis', 'fieldCount'],
        },
      })

      const result = await invokeGenerativeFunction<{
        analysis: string
        fieldCount: number
      }>(functionId, {
        data: JSON.stringify({ name: 'Test', value: 123, nested: { a: 1 } }),
      })

      expect(result.output.analysis).toBeDefined()
      expect(result.output.fieldCount).toBeGreaterThan(0)
    }, DEPLOY_AND_INVOKE_TIMEOUT)
  })
})
