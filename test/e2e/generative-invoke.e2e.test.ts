/**
 * E2E Tests: Generative Function Invoke
 *
 * Tests for invoking generative functions including basic invocation,
 * model selection, token tracking, caching, and rate limiting.
 */

import { describe, it, expect, afterAll } from 'vitest'
import {
  E2E_CONFIG,
  generateTestFunctionId,
  shouldRunE2E,
  deleteFunction,
} from './config'
import {
  deployGenerativeFunction,
  invokeGenerativeFunction,
  invokeGenerativeFunctionRaw,
  hasAIKey,
  hasOpenAIKey,
  AI_TIMEOUT,
  DEPLOY_AND_INVOKE_TIMEOUT,
} from './helpers/generative'

const skipIfNoAIKey = !hasAIKey ? it.skip : it
const skipIfNoOpenAI = !hasOpenAIKey ? it.skip : skipIfNoAIKey

describe.skipIf(!shouldRunE2E())('E2E: Generative Function Invoke', () => {
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
  // Basic Invocation
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
  })

  // ===========================================================================
  // Model Selection
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
  // Token Tracking
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
  })

  // ===========================================================================
  // Caching
  // ===========================================================================

  describe('Caching', () => {
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

      const result1 = await invokeGenerativeFunction<{ id: string }>(
        functionId,
        { seed: 'test-seed-123' },
        { includeMetadata: true }
      )

      const result2 = await invokeGenerativeFunction<{ id: string }>(
        functionId,
        { seed: 'test-seed-123' },
        { includeMetadata: true }
      )

      expect(result1.metadata?.cached).toBe(false)
      expect(result2.metadata?.cached).toBe(true)
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

      const start1 = Date.now()
      await invokeGenerativeFunction<{ poem: string }>(
        functionId,
        { subject: 'caching' },
        { includeMetadata: true }
      )
      const duration1 = Date.now() - start1

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
    }, DEPLOY_AND_INVOKE_TIMEOUT * 2)
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
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

      await expect(
        invokeGenerativeFunction(functionId, { name: 'Alice' })
      ).rejects.toThrow(/missing.*variable|required.*age|variable.*not.*provided/i)
    }, DEPLOY_AND_INVOKE_TIMEOUT)

    skipIfNoAIKey('returns structured error response', async () => {
      const response = await invokeGenerativeFunctionRaw('non-existent-function-xyz', {})

      expect(response.ok).toBe(false)
      expect(response.status).toBeGreaterThanOrEqual(400)

      const errorBody = await response.json()
      expect(errorBody.error).toBeDefined()
      expect(typeof errorBody.error.message).toBe('string')
    }, E2E_CONFIG.invokeTimeout)
  })

  // ===========================================================================
  // Rate Limiting
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

      const requests = Array.from({ length: 50 }, (_, i) =>
        invokeGenerativeFunctionRaw(functionId, { word: `test${i}` })
      )

      const responses = await Promise.all(requests)
      const rateLimitedResponses = responses.filter((r) => r.status === 429)

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

      const requests: Promise<Response>[] = []
      for (let i = 0; i < 100; i++) {
        requests.push(invokeGenerativeFunctionRaw(functionId, { n: i }))
      }

      const responses = await Promise.all(requests)
      const has429 = responses.some((r) => r.status === 429)

      expect(has429).toBe(true)
    }, DEPLOY_AND_INVOKE_TIMEOUT * 3)
  })

  // ===========================================================================
  // Temperature and Generation Settings
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
        maxTokens: 50,
      })

      const result = await invokeGenerativeFunction<{ essay: string }>(
        functionId,
        { topic: 'artificial intelligence' },
        { includeMetadata: true }
      )

      expect(result.metadata?.tokens?.output).toBeLessThanOrEqual(50)
    }, DEPLOY_AND_INVOKE_TIMEOUT)
  })

  // ===========================================================================
  // Prompt Template Variables
  // ===========================================================================

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
