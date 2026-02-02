/**
 * Generative Functions Executor Tests (RED Phase)
 *
 * These tests validate the GenerativeExecutor functionality for executing
 * generative AI functions that make single model calls with structured output.
 *
 * Test Categories:
 * 1. Basic Generation - user/system prompts, output validation
 * 2. Model Selection - model specification, defaults, validation
 * 3. Prompt Templating - variable replacement, missing variables
 * 4. Structured Output - JSON schema enforcement, validation errors
 * 5. Few-Shot Examples - example formatting
 * 6. Token Tracking - input/output/total tokens, maxTokens
 * 7. Timeout Enforcement - 30s default, custom timeout, abort
 * 8. Retry & Rate Limiting - 429/500 retries, exponential backoff
 * 9. Caching - prompt hash caching, cache TTL
 * 10. Execution Info - model, prompt, rawResponse, stopReason, latency
 *
 * @module tiers/generative-executor.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  GenerativeFunctionDefinition,
  GenerativeFunctionConfig,
  GenerativeFunctionResult,
  GenerativeExample,
  GenerativeExecutionInfo,
  AIModel,
} from '@dotdo/functions/generative'
import { defineGenerativeFunction, generativeFunction } from '@dotdo/functions/generative'
import type { JsonSchema, ExecutionContext } from '@dotdo/functions'

// The executor doesn't exist yet - this import will fail (RED phase)
import { GenerativeExecutor } from '../generative-executor.js'

// =============================================================================
// MOCK AI CLIENT
// =============================================================================

/**
 * Mock AI client for deterministic testing
 */
const createMockAIClient = () => ({
  messages: {
    create: vi.fn(),
  },
  // OpenAI-style completions
  chat: {
    completions: {
      create: vi.fn(),
    },
  },
})

/**
 * Create a mock Claude response
 */
function createMockClaudeResponse(options: {
  content?: string
  inputTokens?: number
  outputTokens?: number
  stopReason?: 'end_turn' | 'max_tokens' | 'stop_sequence'
} = {}) {
  return {
    content: [{ type: 'text', text: options.content ?? '{"result": "success"}' }],
    usage: {
      input_tokens: options.inputTokens ?? 100,
      output_tokens: options.outputTokens ?? 50,
    },
    stop_reason: options.stopReason ?? 'end_turn',
    model: 'claude-3-sonnet-20240229',
  }
}

/**
 * Create a mock GPT response
 */
function createMockGPTResponse(options: {
  content?: string
  promptTokens?: number
  completionTokens?: number
  finishReason?: 'stop' | 'length'
} = {}) {
  return {
    choices: [
      {
        message: { content: options.content ?? '{"result": "success"}' },
        finish_reason: options.finishReason ?? 'stop',
      },
    ],
    usage: {
      prompt_tokens: options.promptTokens ?? 100,
      completion_tokens: options.completionTokens ?? 50,
      total_tokens: (options.promptTokens ?? 100) + (options.completionTokens ?? 50),
    },
    model: 'gpt-4o-2024-05-13',
  }
}

// =============================================================================
// TEST FIXTURES
// =============================================================================

const simpleOutputSchema: JsonSchema = {
  type: 'object',
  properties: {
    result: { type: 'string' },
  },
  required: ['result'],
}

const classificationOutputSchema: JsonSchema = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
    confidence: { type: 'number' },
  },
  required: ['category', 'confidence'],
}

const createSimpleFunction = (): GenerativeFunctionDefinition => defineGenerativeFunction({
  id: 'test-simple',
  name: 'Simple Test Function',
  version: '1.0.0',
  userPrompt: 'Generate a simple response',
  outputSchema: simpleOutputSchema,
})

const createClassificationFunction = (): GenerativeFunctionDefinition => defineGenerativeFunction({
  id: 'sentiment-classifier',
  name: 'Sentiment Classifier',
  version: '1.0.0',
  systemPrompt: 'You are a sentiment classifier. Classify text as positive, negative, or neutral.',
  userPrompt: 'Classify the following text: {{text}}',
  outputSchema: classificationOutputSchema,
  model: 'claude-3-opus',
})

// =============================================================================
// TEST SUITES
// =============================================================================

describe('GenerativeExecutor', () => {
  let executor: GenerativeExecutor
  let mockAIClient: ReturnType<typeof createMockAIClient>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockAIClient = createMockAIClient()
    executor = new GenerativeExecutor({
      aiClient: mockAIClient,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // 1. Basic Generation
  // ==========================================================================

  describe('Basic Generation', () => {
    it('should call AI model with user prompt', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const result = await executor.execute(definition, {})

      expect(mockAIClient.messages.create).toHaveBeenCalled()
      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      expect(callArgs.messages).toContainEqual(
        expect.objectContaining({ role: 'user', content: 'Generate a simple response' })
      )
    })

    it('should call AI model with system prompt', async () => {
      const definition = createClassificationFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '{"category": "positive", "confidence": 0.95}',
      }))

      const result = await executor.execute(definition, { text: 'I love this!' })

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      expect(callArgs.system).toContain('sentiment classifier')
    })

    it('should return GenerativeFunctionResult with output', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '{"result": "test output"}',
      }))

      const result = await executor.execute(definition, {})

      expect(result).toBeDefined()
      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ result: 'test output' })
      expect(result.generativeExecution).toBeDefined()
    })

    it('should validate output against outputSchema', async () => {
      const definition = createSimpleFunction()
      // Return invalid output missing required 'result' field
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '{"invalid": "missing result field"}',
      }))

      const result = await executor.execute(definition, {})

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('schema')
    })

    it('should parse JSON output from model response', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '  \n{"result": "parsed correctly"}\n  ',
      }))

      const result = await executor.execute(definition, {})

      expect(result.output).toEqual({ result: 'parsed correctly' })
    })

    it('should handle markdown code blocks in response', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '```json\n{"result": "from code block"}\n```',
      }))

      const result = await executor.execute(definition, {})

      expect(result.output).toEqual({ result: 'from code block' })
    })
  })

  // ==========================================================================
  // 2. Model Selection
  // ==========================================================================

  describe('Model Selection', () => {
    it('should use specified model (claude-3-opus)', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-opus',
        name: 'Opus Test',
        version: '1.0.0',
        userPrompt: 'Test',
        outputSchema: simpleOutputSchema,
        model: 'claude-3-opus',
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, {})

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      expect(callArgs.model).toBe('claude-3-opus-20240229')
    })

    it('should use specified model (gpt-4o)', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-gpt4o',
        name: 'GPT-4o Test',
        version: '1.0.0',
        userPrompt: 'Test',
        outputSchema: simpleOutputSchema,
        model: 'gpt-4o',
      })
      mockAIClient.chat.completions.create.mockResolvedValue(createMockGPTResponse())

      await executor.execute(definition, {})

      const callArgs = mockAIClient.chat.completions.create.mock.calls[0][0]
      expect(callArgs.model).toBe('gpt-4o')
    })

    it('should fall back to default model if not specified', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-default',
        name: 'Default Model Test',
        version: '1.0.0',
        userPrompt: 'Test',
        outputSchema: simpleOutputSchema,
        // No model specified
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, {})

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      // Default is claude-3-sonnet per defineGenerativeFunction
      expect(callArgs.model).toContain('claude-3-sonnet')
    })

    it('should throw for invalid model', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-invalid',
        name: 'Invalid Model Test',
        version: '1.0.0',
        userPrompt: 'Test',
        outputSchema: simpleOutputSchema,
        model: 'invalid-model-xyz' as AIModel,
      })

      await expect(executor.execute(definition, {})).rejects.toThrow('Invalid model')
    })

    it('should allow config to override model', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-override',
        name: 'Model Override Test',
        version: '1.0.0',
        userPrompt: 'Test',
        outputSchema: simpleOutputSchema,
        model: 'claude-3-sonnet',
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const config: GenerativeFunctionConfig = { model: 'claude-3-opus' }
      await executor.execute(definition, {}, config)

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      expect(callArgs.model).toContain('claude-3-opus')
    })

    it('should use correct provider for gemini models', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-gemini',
        name: 'Gemini Test',
        version: '1.0.0',
        userPrompt: 'Test',
        outputSchema: simpleOutputSchema,
        model: 'gemini-pro',
      })

      // Gemini would use a different client method
      await expect(executor.execute(definition, {})).rejects.toThrow()
    })
  })

  // ==========================================================================
  // 3. Prompt Templating
  // ==========================================================================

  describe('Prompt Templating', () => {
    it('should replace {{variable}} placeholders in userPrompt', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-template',
        name: 'Template Test',
        version: '1.0.0',
        userPrompt: 'Summarize this: {{content}}',
        outputSchema: simpleOutputSchema,
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, { content: 'Hello World' })

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user')
      expect(userMessage.content).toBe('Summarize this: Hello World')
    })

    it('should replace {{variable}} placeholders in systemPrompt', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-system-template',
        name: 'System Template Test',
        version: '1.0.0',
        systemPrompt: 'You are an expert in {{domain}}',
        userPrompt: 'Help me with this',
        outputSchema: simpleOutputSchema,
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, { domain: 'machine learning' })

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      expect(callArgs.system).toBe('You are an expert in machine learning')
    })

    it('should throw if required variable missing', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-missing-var',
        name: 'Missing Variable Test',
        version: '1.0.0',
        userPrompt: 'Process: {{input}} with {{mode}}',
        outputSchema: simpleOutputSchema,
      })

      // Only providing 'input', missing 'mode'
      await expect(executor.execute(definition, { input: 'test' })).rejects.toThrow(
        /missing.*variable.*mode/i
      )
    })

    it('should handle multiple placeholders for same variable', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-multi-placeholder',
        name: 'Multi Placeholder Test',
        version: '1.0.0',
        userPrompt: 'The {{item}} is great. I love this {{item}}!',
        outputSchema: simpleOutputSchema,
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, { item: 'product' })

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user')
      expect(userMessage.content).toBe('The product is great. I love this product!')
    })

    it('should handle nested object values in templates', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-nested',
        name: 'Nested Value Test',
        version: '1.0.0',
        userPrompt: 'User: {{user.name}}, Age: {{user.age}}',
        outputSchema: simpleOutputSchema,
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, { user: { name: 'Alice', age: 30 } })

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user')
      expect(userMessage.content).toBe('User: Alice, Age: 30')
    })

    it('should escape special characters in variable values', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-escape',
        name: 'Escape Test',
        version: '1.0.0',
        userPrompt: 'Code: {{code}}',
        outputSchema: simpleOutputSchema,
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, { code: 'function() { return "hello"; }' })

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user')
      expect(userMessage.content).toContain('function() { return "hello"; }')
    })
  })

  // ==========================================================================
  // 4. Structured Output
  // ==========================================================================

  describe('Structured Output', () => {
    it('should enforce JSON schema on output', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-schema-enforce',
        name: 'Schema Enforce Test',
        version: '1.0.0',
        userPrompt: 'Generate',
        outputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            count: { type: 'number' },
          },
          required: ['name', 'count'],
        },
      })
      // Valid response
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '{"name": "test", "count": 42}',
      }))

      const result = await executor.execute(definition, {})

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ name: 'test', count: 42 })
    })

    it('should retry if output does not match schema', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-schema-retry',
        name: 'Schema Retry Test',
        version: '1.0.0',
        userPrompt: 'Generate',
        outputSchema: simpleOutputSchema,
      })
      // First call returns invalid, second returns valid
      mockAIClient.messages.create
        .mockResolvedValueOnce(createMockClaudeResponse({ content: '{"wrong": "field"}' }))
        .mockResolvedValueOnce(createMockClaudeResponse({ content: '{"result": "success"}' }))

      const result = await executor.execute(definition, {})

      expect(mockAIClient.messages.create).toHaveBeenCalledTimes(2)
      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ result: 'success' })
    })

    it('should return validation errors if schema mismatch after retries', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-schema-fail',
        name: 'Schema Fail Test',
        version: '1.0.0',
        userPrompt: 'Generate',
        outputSchema: {
          type: 'object',
          properties: {
            required_field: { type: 'string' },
          },
          required: ['required_field'],
        },
        retryPolicy: { maxAttempts: 2 },
      })
      // All attempts return invalid
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '{"different_field": "value"}',
      }))

      const result = await executor.execute(definition, {})

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('validation')
      expect(result.error?.message).toContain('required_field')
    })

    it('should handle type coercion for numbers', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-coerce',
        name: 'Coerce Test',
        version: '1.0.0',
        userPrompt: 'Generate',
        outputSchema: {
          type: 'object',
          properties: {
            value: { type: 'number' },
          },
        },
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '{"value": "42"}', // String instead of number
      }))

      const result = await executor.execute(definition, {})

      // Should coerce string to number
      expect(result.output).toEqual({ value: 42 })
    })

    it('should validate enum values', async () => {
      const definition = createClassificationFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '{"category": "invalid_category", "confidence": 0.9}',
      }))

      const result = await executor.execute(definition, { text: 'test' })

      expect(result.status).toBe('failed')
      expect(result.error?.message).toContain('enum')
    })

    it('should handle array output schemas', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-array',
        name: 'Array Test',
        version: '1.0.0',
        userPrompt: 'Generate list',
        outputSchema: {
          type: 'array',
          items: { type: 'string' },
        },
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '["item1", "item2", "item3"]',
      }))

      const result = await executor.execute(definition, {})

      expect(result.output).toEqual(['item1', 'item2', 'item3'])
    })
  })

  // ==========================================================================
  // 5. Few-Shot Examples
  // ==========================================================================

  describe('Few-Shot Examples', () => {
    it('should include examples in prompt', async () => {
      const examples: GenerativeExample[] = [
        { input: { text: 'Great product!' }, output: { category: 'positive', confidence: 0.95 } },
        { input: { text: 'Terrible service' }, output: { category: 'negative', confidence: 0.9 } },
      ]
      const definition = defineGenerativeFunction({
        id: 'test-fewshot',
        name: 'Few-Shot Test',
        version: '1.0.0',
        userPrompt: 'Classify: {{text}}',
        outputSchema: classificationOutputSchema,
        examples,
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '{"category": "positive", "confidence": 0.8}',
      }))

      await executor.execute(definition, { text: 'Nice work!' })

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      // Examples should be included as messages
      expect(callArgs.messages.length).toBeGreaterThan(1)
    })

    it('should format examples correctly for model', async () => {
      const examples: GenerativeExample[] = [
        {
          input: { query: 'What is 2+2?' },
          output: { answer: '4', explanation: 'Basic arithmetic' },
          explanation: 'Simple math question',
        },
      ]
      const definition = defineGenerativeFunction({
        id: 'test-format',
        name: 'Format Test',
        version: '1.0.0',
        userPrompt: '{{query}}',
        outputSchema: {
          type: 'object',
          properties: {
            answer: { type: 'string' },
            explanation: { type: 'string' },
          },
        },
        examples,
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '{"answer": "6", "explanation": "2*3"}',
      }))

      await executor.execute(definition, { query: 'What is 2*3?' })

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      // Check that example is formatted with input/output pair
      const messages = JSON.stringify(callArgs.messages)
      expect(messages).toContain('What is 2+2')
      // The content is JSON-stringified, so quotes are escaped
      expect(messages).toContain('\\"answer\\"')
      expect(messages).toContain('\\"4\\"')
    })

    it('should preserve example order', async () => {
      const examples: GenerativeExample[] = [
        { input: { n: 1 }, output: { result: 'first' } },
        { input: { n: 2 }, output: { result: 'second' } },
        { input: { n: 3 }, output: { result: 'third' } },
      ]
      const definition = defineGenerativeFunction({
        id: 'test-order',
        name: 'Order Test',
        version: '1.0.0',
        userPrompt: '{{n}}',
        outputSchema: simpleOutputSchema,
        examples,
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, { n: 4 })

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      const userMessages = callArgs.messages
        .filter((m: { role: string }) => m.role === 'user')
        .map((m: { content: string }) => m.content)

      // Examples should appear before the actual query
      const firstIndex = userMessages.findIndex((c: string) => c.includes('1'))
      const secondIndex = userMessages.findIndex((c: string) => c.includes('2'))
      const thirdIndex = userMessages.findIndex((c: string) => c.includes('3'))

      expect(firstIndex).toBeLessThan(secondIndex)
      expect(secondIndex).toBeLessThan(thirdIndex)
    })
  })

  // ==========================================================================
  // 6. Token Tracking
  // ==========================================================================

  describe('Token Tracking', () => {
    it('should return generativeExecution.tokens.input', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        inputTokens: 150,
        outputTokens: 75,
      }))

      const result = await executor.execute(definition, {})

      expect(result.generativeExecution.tokens.input).toBe(150)
    })

    it('should return generativeExecution.tokens.output', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        inputTokens: 100,
        outputTokens: 200,
      }))

      const result = await executor.execute(definition, {})

      expect(result.generativeExecution.tokens.output).toBe(200)
    })

    it('should return generativeExecution.tokens.total', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        inputTokens: 100,
        outputTokens: 50,
      }))

      const result = await executor.execute(definition, {})

      expect(result.generativeExecution.tokens.total).toBe(150)
    })

    it('should respect maxTokens limit', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-max-tokens',
        name: 'Max Tokens Test',
        version: '1.0.0',
        userPrompt: 'Generate',
        outputSchema: simpleOutputSchema,
        maxTokens: 500,
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, {})

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      expect(callArgs.max_tokens).toBe(500)
    })

    it('should allow config to override maxTokens', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-max-tokens-override',
        name: 'Max Tokens Override Test',
        version: '1.0.0',
        userPrompt: 'Generate',
        outputSchema: simpleOutputSchema,
        maxTokens: 500,
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const config: GenerativeFunctionConfig = { maxTokens: 1000 }
      await executor.execute(definition, {}, config)

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      expect(callArgs.max_tokens).toBe(1000)
    })

    it('should include tokens in execution metrics', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        inputTokens: 50,
        outputTokens: 25,
      }))

      const result = await executor.execute(definition, {})

      expect(result.metrics.tokens).toBeDefined()
      expect(result.metrics.tokens?.inputTokens).toBe(50)
      expect(result.metrics.tokens?.outputTokens).toBe(25)
      expect(result.metrics.tokens?.totalTokens).toBe(75)
    })

    it('should handle stop_reason=max_tokens', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '{"result": "truncat',
        stopReason: 'max_tokens',
      }))

      const result = await executor.execute(definition, {})

      expect(result.generativeExecution.stopReason).toBe('max_tokens')
      // Output may be incomplete/invalid due to truncation
    })
  })

  // ==========================================================================
  // 7. Timeout Enforcement
  // ==========================================================================

  describe('Timeout Enforcement', () => {
    it('should enforce 30s default timeout', async () => {
      const definition = createSimpleFunction()
      // Mock a slow response that exceeds timeout
      mockAIClient.messages.create.mockImplementation(() =>
        new Promise((resolve) => {
          setTimeout(() => resolve(createMockClaudeResponse()), 35000)
        })
      )

      const resultPromise = executor.execute(definition, {})
      await vi.advanceTimersByTimeAsync(31000)
      const result = await resultPromise

      expect(result.status).toBe('timeout')
      expect(result.error?.message).toContain('timeout')
    })

    it('should respect custom timeout', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-custom-timeout',
        name: 'Custom Timeout Test',
        version: '1.0.0',
        userPrompt: 'Generate',
        outputSchema: simpleOutputSchema,
        timeout: '10s',
      })
      mockAIClient.messages.create.mockImplementation(() =>
        new Promise((resolve) => {
          setTimeout(() => resolve(createMockClaudeResponse()), 15000)
        })
      )

      const resultPromise = executor.execute(definition, {})
      await vi.advanceTimersByTimeAsync(11000)
      const result = await resultPromise

      expect(result.status).toBe('timeout')
    })

    it('should abort model call on timeout', async () => {
      const definition = createSimpleFunction()
      let abortSignalReceived = false

      mockAIClient.messages.create.mockImplementation(({ signal }: { signal?: AbortSignal }) => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => resolve(createMockClaudeResponse()), 35000)
          if (signal) {
            signal.addEventListener('abort', () => {
              abortSignalReceived = true
              clearTimeout(timeout)
              reject(new Error('Aborted'))
            })
          }
        })
      })

      const resultPromise = executor.execute(definition, {})
      await vi.advanceTimersByTimeAsync(31000)
      await resultPromise

      expect(abortSignalReceived).toBe(true)
    })

    it('should complete within timeout for fast responses', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const resultPromise = executor.execute(definition, {})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('completed')
    })

    it('should support context timeout override', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockImplementation(() =>
        new Promise((resolve) => {
          setTimeout(() => resolve(createMockClaudeResponse()), 8000)
        })
      )

      const context: ExecutionContext = { timeout: 5000 }
      const resultPromise = executor.execute(definition, {}, undefined, context)
      await vi.advanceTimersByTimeAsync(6000)
      const result = await resultPromise

      expect(result.status).toBe('timeout')
    })
  })

  // ==========================================================================
  // 8. Retry & Rate Limiting
  // ==========================================================================

  describe('Retry & Rate Limiting', () => {
    it('should retry on 429 rate limit error', async () => {
      const definition = createSimpleFunction()
      const rateLimitError = Object.assign(new Error('Rate limit exceeded'), {
        status: 429,
        headers: { 'retry-after': '1' },
      })

      mockAIClient.messages.create
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(createMockClaudeResponse())

      const resultPromise = executor.execute(definition, {})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(mockAIClient.messages.create).toHaveBeenCalledTimes(2)
      expect(result.status).toBe('completed')
    })

    it('should retry on 500 server error', async () => {
      const definition = createSimpleFunction()
      const serverError = Object.assign(new Error('Internal server error'), { status: 500 })

      mockAIClient.messages.create
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce(createMockClaudeResponse())

      const resultPromise = executor.execute(definition, {})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(mockAIClient.messages.create).toHaveBeenCalledTimes(2)
      expect(result.status).toBe('completed')
    })

    it('should use exponential backoff', async () => {
      const definition = createSimpleFunction()
      const serverError = Object.assign(new Error('Server error'), { status: 500 })
      const timestamps: number[] = []

      mockAIClient.messages.create.mockImplementation(() => {
        timestamps.push(Date.now())
        if (timestamps.length < 3) {
          return Promise.reject(serverError)
        }
        return Promise.resolve(createMockClaudeResponse())
      })

      const resultPromise = executor.execute(definition, {})
      await vi.runAllTimersAsync()
      await resultPromise

      expect(mockAIClient.messages.create).toHaveBeenCalledTimes(3)
      // Verify exponential backoff (delays increase)
      const delay1 = timestamps[1] - timestamps[0]
      const delay2 = timestamps[2] - timestamps[1]
      expect(delay2).toBeGreaterThan(delay1)
    })

    it('should respect max retries', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-max-retries',
        name: 'Max Retries Test',
        version: '1.0.0',
        userPrompt: 'Generate',
        outputSchema: simpleOutputSchema,
        retryPolicy: { maxAttempts: 2 },
      })
      const serverError = Object.assign(new Error('Always fails'), { status: 500 })

      mockAIClient.messages.create.mockRejectedValue(serverError)

      const resultPromise = executor.execute(definition, {})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(mockAIClient.messages.create).toHaveBeenCalledTimes(2)
      expect(result.status).toBe('failed')
    })

    it('should not retry on 400 client errors', async () => {
      const definition = createSimpleFunction()
      const clientError = Object.assign(new Error('Bad request'), { status: 400 })

      mockAIClient.messages.create.mockRejectedValue(clientError)

      const resultPromise = executor.execute(definition, {})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(mockAIClient.messages.create).toHaveBeenCalledTimes(1)
      expect(result.status).toBe('failed')
    })

    it('should track retry count in metrics', async () => {
      const definition = createSimpleFunction()
      const serverError = Object.assign(new Error('Server error'), { status: 500 })

      mockAIClient.messages.create
        .mockRejectedValueOnce(serverError)
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce(createMockClaudeResponse())

      const resultPromise = executor.execute(definition, {})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.metrics.retryCount).toBe(2)
    })

    it('should respect retry-after header', async () => {
      const definition = createSimpleFunction()
      const rateLimitError = Object.assign(new Error('Rate limited'), {
        status: 429,
        headers: { 'retry-after': '5' },
      })
      let retryDelay = 0

      mockAIClient.messages.create
        .mockImplementationOnce(() => Promise.reject(rateLimitError))
        .mockImplementationOnce(() => {
          retryDelay = Date.now()
          return Promise.resolve(createMockClaudeResponse())
        })

      const startTime = Date.now()
      const resultPromise = executor.execute(definition, {})
      await vi.runAllTimersAsync()
      await resultPromise

      // Should wait at least 5 seconds as per retry-after header
      expect(retryDelay - startTime).toBeGreaterThanOrEqual(5000)
    })
  })

  // ==========================================================================
  // 9. Caching
  // ==========================================================================

  describe('Caching', () => {
    it('should cache responses by prompt hash (if cacheEnabled)', async () => {
      const definition = createSimpleFunction()
      const config: GenerativeFunctionConfig = { cacheEnabled: true }
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '{"result": "cached value"}',
      }))

      // First call - should hit API
      await executor.execute(definition, {}, config)

      // Second call with same input - should use cache
      const result = await executor.execute(definition, {}, config)

      expect(mockAIClient.messages.create).toHaveBeenCalledTimes(1)
      expect(result.output).toEqual({ result: 'cached value' })
    })

    it('should return cached: true in execution info', async () => {
      const definition = createSimpleFunction()
      const config: GenerativeFunctionConfig = { cacheEnabled: true }
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, {}, config)
      const result = await executor.execute(definition, {}, config)

      expect(result.generativeExecution.cached).toBe(true)
    })

    it('should respect cacheTtlSeconds', async () => {
      const definition = createSimpleFunction()
      const config: GenerativeFunctionConfig = { cacheEnabled: true, cacheTtlSeconds: 5 }
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      // First call
      await executor.execute(definition, {}, config)

      // Advance past TTL
      await vi.advanceTimersByTimeAsync(6000)

      // Second call - cache expired, should hit API again
      await executor.execute(definition, {}, config)

      expect(mockAIClient.messages.create).toHaveBeenCalledTimes(2)
    })

    it('should use different cache keys for different inputs', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-cache-key',
        name: 'Cache Key Test',
        version: '1.0.0',
        userPrompt: 'Process: {{input}}',
        outputSchema: simpleOutputSchema,
      })
      const config: GenerativeFunctionConfig = { cacheEnabled: true }
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, { input: 'value1' }, config)
      await executor.execute(definition, { input: 'value2' }, config)

      // Different inputs should result in different API calls
      expect(mockAIClient.messages.create).toHaveBeenCalledTimes(2)
    })

    it('should not cache if cacheEnabled is false', async () => {
      const definition = createSimpleFunction()
      const config: GenerativeFunctionConfig = { cacheEnabled: false }
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, {}, config)
      await executor.execute(definition, {}, config)

      expect(mockAIClient.messages.create).toHaveBeenCalledTimes(2)
    })

    it('should not cache failed responses', async () => {
      const definition = createSimpleFunction()
      const config: GenerativeFunctionConfig = { cacheEnabled: true }

      // First call fails
      mockAIClient.messages.create.mockResolvedValueOnce(createMockClaudeResponse({
        content: 'invalid json',
      }))
      // Second call succeeds
      mockAIClient.messages.create.mockResolvedValueOnce(createMockClaudeResponse({
        content: '{"result": "success"}',
      }))

      await executor.execute(definition, {}, config)
      const result = await executor.execute(definition, {}, config)

      expect(mockAIClient.messages.create).toHaveBeenCalledTimes(2)
      expect(result.output).toEqual({ result: 'success' })
    })
  })

  // ==========================================================================
  // 10. Execution Info
  // ==========================================================================

  describe('Execution Info', () => {
    it('should return generativeExecution.model', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-model-info',
        name: 'Model Info Test',
        version: '1.0.0',
        userPrompt: 'Test',
        outputSchema: simpleOutputSchema,
        model: 'claude-3-opus',
      })
      mockAIClient.messages.create.mockResolvedValue({
        ...createMockClaudeResponse(),
        model: 'claude-3-opus-20240229',
      })

      const result = await executor.execute(definition, {})

      expect(result.generativeExecution.model).toBe('claude-3-opus-20240229')
    })

    it('should return generativeExecution.prompt', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-prompt-info',
        name: 'Prompt Info Test',
        version: '1.0.0',
        systemPrompt: 'You are helpful',
        userPrompt: 'Hello {{name}}',
        outputSchema: simpleOutputSchema,
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const result = await executor.execute(definition, { name: 'World' })

      expect(result.generativeExecution.prompt).toBeDefined()
      expect(result.generativeExecution.prompt?.system).toBe('You are helpful')
      expect(result.generativeExecution.prompt?.user).toBe('Hello World')
    })

    it('should return generativeExecution.rawResponse', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '{"result": "raw"}',
      }))

      const result = await executor.execute(definition, {})

      expect(result.generativeExecution.rawResponse).toBe('{"result": "raw"}')
    })

    it('should return generativeExecution.stopReason', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        stopReason: 'end_turn',
      }))

      const result = await executor.execute(definition, {})

      expect(result.generativeExecution.stopReason).toBe('end_turn')
    })

    it('should return generativeExecution.modelLatencyMs', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockImplementation(() =>
        new Promise((resolve) => {
          setTimeout(() => resolve(createMockClaudeResponse()), 100)
        })
      )

      const resultPromise = executor.execute(definition, {})
      await vi.advanceTimersByTimeAsync(150)
      const result = await resultPromise

      expect(result.generativeExecution.modelLatencyMs).toBeGreaterThanOrEqual(100)
    })

    it('should return execution metadata', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const result = await executor.execute(definition, {})

      expect(result.executionId).toBeDefined()
      expect(result.functionId).toBe('test-simple')
      expect(result.functionVersion).toBe('1.0.0')
      expect(result.metadata.startedAt).toBeDefined()
      expect(result.metadata.completedAt).toBeDefined()
    })

    it('should include traceId from context', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const context: ExecutionContext = { traceId: 'trace-123', parentSpanId: 'span-456' }
      const result = await executor.execute(definition, {}, undefined, context)

      expect(result.metadata.traceId).toBe('trace-123')
      expect(result.metadata.spanId).toBeDefined()
    })

    it('should calculate duration correctly', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockImplementation(() =>
        new Promise((resolve) => {
          setTimeout(() => resolve(createMockClaudeResponse()), 50)
        })
      )

      const resultPromise = executor.execute(definition, {})
      await vi.advanceTimersByTimeAsync(100)
      const result = await resultPromise

      expect(result.metrics.durationMs).toBeGreaterThanOrEqual(50)
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty input', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const result = await executor.execute(definition, {})

      expect(result.status).toBe('completed')
    })

    it('should handle very large input', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-large',
        name: 'Large Input Test',
        version: '1.0.0',
        userPrompt: '{{content}}',
        outputSchema: simpleOutputSchema,
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const largeContent = 'x'.repeat(100000)
      const result = await executor.execute(definition, { content: largeContent })

      expect(result.status).toBe('completed')
    })

    it('should handle unicode characters in prompt', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-unicode',
        name: 'Unicode Test',
        version: '1.0.0',
        userPrompt: 'Translate: {{text}}',
        outputSchema: simpleOutputSchema,
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, { text: 'Hello' })

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user')
      expect(userMessage.content).toContain('Hello')
    })

    it('should handle concurrent executions', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const promises = [
        executor.execute(definition, {}),
        executor.execute(definition, {}),
        executor.execute(definition, {}),
      ]

      await vi.runAllTimersAsync()
      const results = await Promise.all(promises)

      expect(results).toHaveLength(3)
      results.forEach((result) => {
        expect(result.status).toBe('completed')
      })
    })

    it('should handle API response with missing fields', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: '{"result": "ok"}' }],
        // Missing usage and stop_reason
      })

      const result = await executor.execute(definition, {})

      expect(result.status).toBe('completed')
      // Should handle gracefully with defaults
      expect(result.generativeExecution.tokens.input).toBeDefined()
    })

    it('should handle network errors', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockRejectedValue(new Error('Network error'))

      const resultPromise = executor.execute(definition, {})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('failed')
      expect(result.error?.message).toContain('Network error')
    })
  })

  // ==========================================================================
  // renderPrompt helper
  // ==========================================================================

  describe('renderPrompt', () => {
    it('should render template with variables', () => {
      const rendered = executor.renderPrompt('Hello {{name}}!', { name: 'World' })
      expect(rendered).toBe('Hello World!')
    })

    it('should handle multiple variables', () => {
      const rendered = executor.renderPrompt('{{greeting}} {{name}}!', {
        greeting: 'Hello',
        name: 'World',
      })
      expect(rendered).toBe('Hello World!')
    })

    it('should throw for missing variables', () => {
      expect(() => executor.renderPrompt('Hello {{name}}!', {})).toThrow(
        /missing.*variable.*name/i
      )
    })

    it('should handle object stringification', () => {
      const rendered = executor.renderPrompt('Data: {{obj}}', {
        obj: { key: 'value' },
      })
      expect(rendered).toContain('key')
      expect(rendered).toContain('value')
    })
  })

  // ==========================================================================
  // 11. LRU Cache Eviction
  // ==========================================================================

  describe('LRU Cache Eviction', () => {
    it('should have configurable max cache size', async () => {
      const executorWithLimit = new GenerativeExecutor({
        aiClient: mockAIClient,
        maxCacheSize: 3,
      })

      const definition = defineGenerativeFunction({
        id: 'test-cache-limit',
        name: 'Cache Limit Test',
        version: '1.0.0',
        userPrompt: 'Process: {{input}}',
        outputSchema: simpleOutputSchema,
      })
      const config: GenerativeFunctionConfig = { cacheEnabled: true }
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      // Fill cache with 3 entries
      await executorWithLimit.execute(definition, { input: 'value1' }, config)
      await executorWithLimit.execute(definition, { input: 'value2' }, config)
      await executorWithLimit.execute(definition, { input: 'value3' }, config)

      const stats = executorWithLimit.getCacheStats()
      expect(stats.size).toBe(3)
    })

    it('should evict LRU entry when cache is full', async () => {
      const executorWithLimit = new GenerativeExecutor({
        aiClient: mockAIClient,
        maxCacheSize: 2,
      })

      const definition = defineGenerativeFunction({
        id: 'test-lru-eviction',
        name: 'LRU Eviction Test',
        version: '1.0.0',
        userPrompt: 'Process: {{input}}',
        outputSchema: simpleOutputSchema,
      })
      const config: GenerativeFunctionConfig = { cacheEnabled: true }
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      // Fill cache with 2 entries
      await executorWithLimit.execute(definition, { input: 'first' }, config)
      await executorWithLimit.execute(definition, { input: 'second' }, config)

      // Access 'first' to make it recently used
      await executorWithLimit.execute(definition, { input: 'first' }, config)

      // Add a third entry - should evict 'second' (LRU)
      await executorWithLimit.execute(definition, { input: 'third' }, config)

      const stats = executorWithLimit.getCacheStats()
      expect(stats.size).toBe(2)
      expect(stats.evictions).toBe(1)

      // 'first' should still be cached (was recently used)
      mockAIClient.messages.create.mockClear()
      await executorWithLimit.execute(definition, { input: 'first' }, config)
      expect(mockAIClient.messages.create).not.toHaveBeenCalled()

      // 'second' should be evicted (was LRU)
      await executorWithLimit.execute(definition, { input: 'second' }, config)
      expect(mockAIClient.messages.create).toHaveBeenCalledTimes(1)
    })

    it('should track evictions in cache stats', async () => {
      const executorWithLimit = new GenerativeExecutor({
        aiClient: mockAIClient,
        maxCacheSize: 2,
      })

      const definition = defineGenerativeFunction({
        id: 'test-eviction-stats',
        name: 'Eviction Stats Test',
        version: '1.0.0',
        userPrompt: 'Process: {{input}}',
        outputSchema: simpleOutputSchema,
      })
      const config: GenerativeFunctionConfig = { cacheEnabled: true }
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      // Fill cache
      await executorWithLimit.execute(definition, { input: 'a' }, config)
      await executorWithLimit.execute(definition, { input: 'b' }, config)

      // Trigger evictions
      await executorWithLimit.execute(definition, { input: 'c' }, config)
      await executorWithLimit.execute(definition, { input: 'd' }, config)
      await executorWithLimit.execute(definition, { input: 'e' }, config)

      const stats = executorWithLimit.getCacheStats()
      expect(stats.evictions).toBe(3)
    })

    it('should proactively clean stale entries', async () => {
      const executorWithCleanup = new GenerativeExecutor({
        aiClient: mockAIClient,
        maxCacheSize: 100,
        staleCleanupIntervalMs: 1000, // Cleanup every 1 second
      })

      const definition = defineGenerativeFunction({
        id: 'test-stale-cleanup',
        name: 'Stale Cleanup Test',
        version: '1.0.0',
        userPrompt: 'Process: {{input}}',
        outputSchema: simpleOutputSchema,
      })
      const config: GenerativeFunctionConfig = { cacheEnabled: true, cacheTtlSeconds: 2 }
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      // Add entries to cache
      await executorWithCleanup.execute(definition, { input: 'value1' }, config)
      await executorWithCleanup.execute(definition, { input: 'value2' }, config)

      let stats = executorWithCleanup.getCacheStats()
      expect(stats.size).toBe(2)

      // Advance time past TTL
      await vi.advanceTimersByTimeAsync(3000)

      // Trigger cleanup (either via interval or manual call)
      executorWithCleanup.cleanupStaleEntries()

      stats = executorWithCleanup.getCacheStats()
      expect(stats.size).toBe(0)
      expect(stats.staleEvictions).toBeGreaterThan(0)
    })

    it('should track stale evictions separately from LRU evictions', async () => {
      const executorWithCleanup = new GenerativeExecutor({
        aiClient: mockAIClient,
        maxCacheSize: 2,
        staleCleanupIntervalMs: 1000,
      })

      const definition = defineGenerativeFunction({
        id: 'test-eviction-tracking',
        name: 'Eviction Tracking Test',
        version: '1.0.0',
        userPrompt: 'Process: {{input}}',
        outputSchema: simpleOutputSchema,
      })
      const config: GenerativeFunctionConfig = { cacheEnabled: true, cacheTtlSeconds: 2 }
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      // Fill cache and trigger 1 LRU eviction
      await executorWithCleanup.execute(definition, { input: 'a' }, config)
      await executorWithCleanup.execute(definition, { input: 'b' }, config)
      await executorWithCleanup.execute(definition, { input: 'c' }, config)

      // Advance time past TTL
      await vi.advanceTimersByTimeAsync(3000)
      executorWithCleanup.cleanupStaleEntries()

      const stats = executorWithCleanup.getCacheStats()
      expect(stats.evictions).toBe(1) // LRU eviction
      expect(stats.staleEvictions).toBe(2) // TTL-based cleanup
    })

    it('should stop cleanup timer when stopCleanup is called', async () => {
      const executorWithCleanup = new GenerativeExecutor({
        aiClient: mockAIClient,
        maxCacheSize: 100,
        staleCleanupIntervalMs: 1000,
      })

      const definition = defineGenerativeFunction({
        id: 'test-stop-cleanup',
        name: 'Stop Cleanup Test',
        version: '1.0.0',
        userPrompt: 'Process: {{input}}',
        outputSchema: simpleOutputSchema,
      })
      const config: GenerativeFunctionConfig = { cacheEnabled: true, cacheTtlSeconds: 1 }
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executorWithCleanup.execute(definition, { input: 'value' }, config)

      // Stop the cleanup timer
      executorWithCleanup.stopCleanup()

      // Advance time past TTL and cleanup interval
      await vi.advanceTimersByTimeAsync(5000)

      // Entry should still be in cache (cleanup didn't run)
      const stats = executorWithCleanup.getCacheStats()
      expect(stats.size).toBe(1)
    })

    it('should use default maxCacheSize of 1000 when not specified', async () => {
      // Create executor without maxCacheSize option
      const defaultExecutor = new GenerativeExecutor({
        aiClient: mockAIClient,
      })

      const definition = defineGenerativeFunction({
        id: 'test-default-size',
        name: 'Default Size Test',
        version: '1.0.0',
        userPrompt: 'Process: {{input}}',
        outputSchema: simpleOutputSchema,
      })
      const config: GenerativeFunctionConfig = { cacheEnabled: true }
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      // Fill cache with 1000+ entries and verify no eviction until limit
      // This is a simplified test - just verify the executor accepts it
      await defaultExecutor.execute(definition, { input: 'value' }, config)

      const stats = defaultExecutor.getCacheStats()
      expect(stats.maxSize).toBe(1000)
    })

    it('should return cache stats with all tracking fields', async () => {
      const executorWithStats = new GenerativeExecutor({
        aiClient: mockAIClient,
        maxCacheSize: 5,
      })

      const definition = createSimpleFunction()
      const config: GenerativeFunctionConfig = { cacheEnabled: true }
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executorWithStats.execute(definition, {}, config)

      const stats = executorWithStats.getCacheStats()

      // Verify all expected fields are present
      expect(stats).toHaveProperty('size')
      expect(stats).toHaveProperty('maxSize')
      expect(stats).toHaveProperty('hits')
      expect(stats).toHaveProperty('misses')
      expect(stats).toHaveProperty('evictions')
      expect(stats).toHaveProperty('staleEvictions')
    })
  })
})
