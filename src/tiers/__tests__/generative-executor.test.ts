/**
 * Generative Functions Executor Tests
 *
 * These tests validate the GenerativeExecutor functionality for executing
 * generative AI functions that make single model calls with structured output.
 *
 * Test setup uses @cloudflare/vitest-pool-workers with miniflare.
 * Only external AI API clients are mocked; real Durable Objects / Cache API
 * are used when available in the miniflare environment.
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
 * 9. Caching - prompt hash caching, cache TTL, cache stats
 * 10. Execution Info - model, prompt, rawResponse, stopReason, latency
 * 11. GPT Provider - GPT-specific request/response handling
 * 12. Edge Cases - empty input, large input, unicode, concurrent, errors
 * 13. Deprecated / No-op Methods - cleanupStaleEntries, stopCleanup
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

import { GenerativeExecutor } from '../generative-executor.js'

// =============================================================================
// MOCK AI CLIENT
// =============================================================================

/**
 * Mock AI client for deterministic testing.
 * Only external AI API calls are mocked - no internal logic is bypassed.
 */
const createMockAIClient = () => ({
  messages: {
    create: vi.fn(),
  },
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
  model?: string
} = {}) {
  return {
    content: [{ type: 'text', text: options.content ?? '{"result": "success"}' }],
    usage: {
      input_tokens: options.inputTokens ?? 100,
      output_tokens: options.outputTokens ?? 50,
    },
    stop_reason: options.stopReason ?? 'end_turn',
    model: options.model ?? 'claude-3-sonnet-20240229',
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
  model?: string
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
    model: options.model ?? 'gpt-4o-2024-05-13',
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
    mockAIClient = createMockAIClient()
    executor = new GenerativeExecutor({
      aiClient: mockAIClient,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. Basic Generation
  // ==========================================================================

  describe('Basic Generation', () => {
    it('should call AI model with user prompt', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, {})

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

      await executor.execute(definition, { text: 'I love this!' })

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

    it('should set cached to false for non-cached results', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const result = await executor.execute(definition, {})

      expect(result.generativeExecution.cached).toBe(false)
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

    it('should use specified model (claude-3-haiku)', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-haiku',
        name: 'Haiku Test',
        version: '1.0.0',
        userPrompt: 'Test',
        outputSchema: simpleOutputSchema,
        model: 'claude-3-haiku',
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        model: 'claude-3-haiku-20240307',
      }))

      const result = await executor.execute(definition, {})

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      expect(callArgs.model).toBe('claude-3-haiku-20240307')
      expect(result.generativeExecution.model).toBe('claude-3-haiku-20240307')
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

    it('should throw for Gemini models (no Gemini client)', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-gemini',
        name: 'Gemini Test',
        version: '1.0.0',
        userPrompt: 'Test',
        outputSchema: simpleOutputSchema,
        model: 'gemini-pro',
      })

      await expect(executor.execute(definition, {})).rejects.toThrow(/Gemini/)
    })

    it('should throw for gemini-flash (no Gemini client)', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-gemini-flash',
        name: 'Gemini Flash Test',
        version: '1.0.0',
        userPrompt: 'Test',
        outputSchema: simpleOutputSchema,
        model: 'gemini-flash',
      })

      await expect(executor.execute(definition, {})).rejects.toThrow(/Gemini/)
    })

    it('should accept models starting with claude- prefix', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-claude-custom',
        name: 'Claude Custom Test',
        version: '1.0.0',
        userPrompt: 'Test',
        outputSchema: simpleOutputSchema,
        model: 'claude-custom-2025',
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const result = await executor.execute(definition, {})

      expect(result.status).toBe('completed')
    })

    it('should accept models starting with gpt- prefix', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-gpt-custom',
        name: 'GPT Custom Test',
        version: '1.0.0',
        userPrompt: 'Test',
        outputSchema: simpleOutputSchema,
        model: 'gpt-5-turbo',
      })
      // Non-standard GPT model goes through Claude path (not in GPT_MODELS set)
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const result = await executor.execute(definition, {})

      expect(result.status).toBe('completed')
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

    it('should preserve special characters in variable values', async () => {
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

    it('should stringify object values in templates', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-object-value',
        name: 'Object Value Test',
        version: '1.0.0',
        userPrompt: 'Data: {{data}}',
        outputSchema: simpleOutputSchema,
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, { data: { key: 'value', nested: { a: 1 } } })

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user')
      expect(userMessage.content).toContain('"key"')
      expect(userMessage.content).toContain('"value"')
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

    it('should reject invalid JSON output and fail after schema retries', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-invalid-json',
        name: 'Invalid JSON Test',
        version: '1.0.0',
        userPrompt: 'Generate',
        outputSchema: simpleOutputSchema,
        retryPolicy: { maxAttempts: 2 },
      })
      // All attempts return invalid JSON
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: 'this is not valid json at all',
      }))

      const result = await executor.execute(definition, {})

      expect(result.status).toBe('failed')
      expect(result.error?.message).toContain('validation')
    })

    it('should validate array item types', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-array-items',
        name: 'Array Items Test',
        version: '1.0.0',
        userPrompt: 'Generate',
        outputSchema: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
      })
      // Return array with missing required field on item
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '[{"name": "ok"}, {"wrongField": "bad"}]',
      }))

      const result = await executor.execute(definition, {})

      expect(result.status).toBe('failed')
      expect(result.error?.message).toContain('name')
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
      // Examples (2 user + 2 assistant) + actual query (1 user) = 5 messages
      expect(callArgs.messages.length).toBeGreaterThan(1)
    })

    it('should format examples as user/assistant message pairs', async () => {
      const examples: GenerativeExample[] = [
        {
          input: { query: 'What is 2+2?' },
          output: { answer: '4', explanation: 'Basic arithmetic' },
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
      const messages = JSON.stringify(callArgs.messages)
      // Example input should be rendered through the template
      expect(messages).toContain('What is 2+2')
      // Example output should be JSON-stringified
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

    it('should handle definition with empty examples array', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-no-examples',
        name: 'No Examples Test',
        version: '1.0.0',
        userPrompt: 'Generate',
        outputSchema: simpleOutputSchema,
        examples: [],
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const result = await executor.execute(definition, {})

      expect(result.status).toBe('completed')
      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      // Only the actual user message, no example messages
      expect(callArgs.messages.length).toBe(1)
    })
  })

  // ==========================================================================
  // 6. Token Tracking
  // ==========================================================================

  describe('Token Tracking', () => {
    it('should return generativeExecution.tokens.inputTokens', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        inputTokens: 150,
        outputTokens: 75,
      }))

      const result = await executor.execute(definition, {})

      expect(result.generativeExecution.tokens.inputTokens).toBe(150)
    })

    it('should return generativeExecution.tokens.outputTokens', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        inputTokens: 100,
        outputTokens: 200,
      }))

      const result = await executor.execute(definition, {})

      expect(result.generativeExecution.tokens.outputTokens).toBe(200)
    })

    it('should return generativeExecution.tokens.totalTokens', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        inputTokens: 100,
        outputTokens: 50,
      }))

      const result = await executor.execute(definition, {})

      expect(result.generativeExecution.tokens.totalTokens).toBe(150)
    })

    it('should respect maxTokens limit from definition', async () => {
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

    it('should default to 4096 maxTokens if not specified', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-default-tokens',
        name: 'Default Tokens Test',
        version: '1.0.0',
        userPrompt: 'Generate',
        outputSchema: simpleOutputSchema,
        // No maxTokens specified
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, {})

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      expect(callArgs.max_tokens).toBe(4096)
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
    })

    it('should default token counts to 0 when usage is missing', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: '{"result": "ok"}' }],
        // No usage field
      })

      const result = await executor.execute(definition, {})

      expect(result.generativeExecution.tokens.inputTokens).toBe(0)
      expect(result.generativeExecution.tokens.outputTokens).toBe(0)
      expect(result.generativeExecution.tokens.totalTokens).toBe(0)
    })
  })

  // ==========================================================================
  // 7. Timeout Enforcement
  // ==========================================================================

  describe('Timeout Enforcement', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should enforce 30s default timeout', async () => {
      const definition = createSimpleFunction()
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

    it('should respect custom timeout from definition', async () => {
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

    it('should return timeout error with generativeExecution info', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-timeout-info',
        name: 'Timeout Info Test',
        version: '1.0.0',
        userPrompt: 'Generate',
        outputSchema: simpleOutputSchema,
        timeout: '1s',
      })
      mockAIClient.messages.create.mockImplementation(() =>
        new Promise((resolve) => {
          setTimeout(() => resolve(createMockClaudeResponse()), 5000)
        })
      )

      const resultPromise = executor.execute(definition, {})
      await vi.advanceTimersByTimeAsync(2000)
      const result = await resultPromise

      expect(result.status).toBe('timeout')
      expect(result.generativeExecution).toBeDefined()
      expect(result.generativeExecution.cached).toBe(false)
      expect(result.generativeExecution.model).toBeDefined()
    })

    it('should support string duration timeout in context', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockImplementation(() =>
        new Promise((resolve) => {
          setTimeout(() => resolve(createMockClaudeResponse()), 8000)
        })
      )

      const context: ExecutionContext = { timeout: '3s' }
      const resultPromise = executor.execute(definition, {}, undefined, context)
      await vi.advanceTimersByTimeAsync(4000)
      const result = await resultPromise

      expect(result.status).toBe('timeout')
    })
  })

  // ==========================================================================
  // 8. Retry & Rate Limiting
  // ==========================================================================

  describe('Retry & Rate Limiting', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

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

    it('should respect max retries from retryPolicy', async () => {
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

    it('should default to 3 max retries', async () => {
      const definition = createSimpleFunction() // No retryPolicy
      const serverError = Object.assign(new Error('Always fails'), { status: 500 })

      mockAIClient.messages.create.mockRejectedValue(serverError)

      const resultPromise = executor.execute(definition, {})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(mockAIClient.messages.create).toHaveBeenCalledTimes(3)
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

    it('should preserve error name and message after all retries fail', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-error-preserve',
        name: 'Error Preserve Test',
        version: '1.0.0',
        userPrompt: 'Generate',
        outputSchema: simpleOutputSchema,
        retryPolicy: { maxAttempts: 1 },
      })
      const serverError = Object.assign(new Error('Server on fire'), { status: 500 })

      mockAIClient.messages.create.mockRejectedValue(serverError)

      const resultPromise = executor.execute(definition, {})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('failed')
      expect(result.error?.message).toContain('Server on fire')
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

    it('should return cached: true in execution info for cache hit', async () => {
      const definition = createSimpleFunction()
      const config: GenerativeFunctionConfig = { cacheEnabled: true }
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, {}, config)
      const result = await executor.execute(definition, {}, config)

      expect(result.generativeExecution.cached).toBe(true)
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

    it('should not cache by default (cacheEnabled defaults to false)', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, {})
      await executor.execute(definition, {})

      expect(mockAIClient.messages.create).toHaveBeenCalledTimes(2)
    })

    it('should not cache failed responses', async () => {
      const definition = createSimpleFunction()
      const config: GenerativeFunctionConfig = { cacheEnabled: true }

      // First call fails (invalid JSON)
      mockAIClient.messages.create.mockResolvedValueOnce(createMockClaudeResponse({
        content: 'invalid json',
      }))
      // Second call succeeds
      mockAIClient.messages.create.mockResolvedValueOnce(createMockClaudeResponse({
        content: '{"result": "success"}',
      }))

      await executor.execute(definition, {}, config)
      const result = await executor.execute(definition, {}, config)

      // Both calls went through because failed result was not cached
      expect(mockAIClient.messages.create).toHaveBeenCalledTimes(2)
      expect(result.output).toEqual({ result: 'success' })
    })

    it('should track cache hits and misses in getCacheStats', async () => {
      const definition = createSimpleFunction()
      const config: GenerativeFunctionConfig = { cacheEnabled: true }
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      // First call - miss
      await executor.execute(definition, {}, config)
      const statsAfterMiss = executor.getCacheStats()
      expect(statsAfterMiss.misses).toBe(1)
      expect(statsAfterMiss.hits).toBe(0)

      // Second call - hit
      await executor.execute(definition, {}, config)
      const statsAfterHit = executor.getCacheStats()
      expect(statsAfterHit.hits).toBe(1)
      expect(statsAfterHit.misses).toBe(1)
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

    it('should return generativeExecution.prompt with rendered templates', async () => {
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
      vi.useFakeTimers()
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
      vi.useRealTimers()
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
      expect(result.metadata.completedAt).toBeGreaterThanOrEqual(result.metadata.startedAt)
    })

    it('should include traceId from context', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const context: ExecutionContext = { traceId: 'trace-123', parentSpanId: 'span-456' }
      const result = await executor.execute(definition, {}, undefined, context)

      expect(result.metadata.traceId).toBe('trace-123')
      expect(result.metadata.spanId).toBeDefined()
    })

    it('should use executionId from context when provided', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const context: ExecutionContext = { executionId: 'custom-exec-id' }
      const result = await executor.execute(definition, {}, undefined, context)

      expect(result.executionId).toBe('custom-exec-id')
    })

    it('should calculate duration correctly', async () => {
      vi.useFakeTimers()
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
      vi.useRealTimers()
    })

    it('should include inputSizeBytes in metrics', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const result = await executor.execute(definition, {})

      expect(typeof result.metrics.inputSizeBytes).toBe('number')
      expect(result.metrics.inputSizeBytes).toBeGreaterThan(0)
    })

    it('should include outputSizeBytes in metrics', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '{"result": "some output"}',
      }))

      const result = await executor.execute(definition, {})

      expect(typeof result.metrics.outputSizeBytes).toBe('number')
      expect(result.metrics.outputSizeBytes).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // 11. GPT Provider
  // ==========================================================================

  describe('GPT Provider', () => {
    it('should route gpt-4o to chat.completions.create', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-gpt-route',
        name: 'GPT Route Test',
        version: '1.0.0',
        userPrompt: 'Test prompt',
        outputSchema: simpleOutputSchema,
        model: 'gpt-4o',
      })
      mockAIClient.chat.completions.create.mockResolvedValue(createMockGPTResponse())

      await executor.execute(definition, {})

      expect(mockAIClient.chat.completions.create).toHaveBeenCalled()
      expect(mockAIClient.messages.create).not.toHaveBeenCalled()
    })

    it('should route gpt-4o-mini to chat.completions.create', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-gpt-mini-route',
        name: 'GPT Mini Route Test',
        version: '1.0.0',
        userPrompt: 'Test prompt',
        outputSchema: simpleOutputSchema,
        model: 'gpt-4o-mini',
      })
      mockAIClient.chat.completions.create.mockResolvedValue(createMockGPTResponse())

      await executor.execute(definition, {})

      expect(mockAIClient.chat.completions.create).toHaveBeenCalled()
    })

    it('should include system prompt in GPT messages', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-gpt-system',
        name: 'GPT System Test',
        version: '1.0.0',
        systemPrompt: 'You are a helpful assistant',
        userPrompt: 'Hello',
        outputSchema: simpleOutputSchema,
        model: 'gpt-4o',
      })
      mockAIClient.chat.completions.create.mockResolvedValue(createMockGPTResponse())

      await executor.execute(definition, {})

      const callArgs = mockAIClient.chat.completions.create.mock.calls[0][0]
      expect(callArgs.messages).toContainEqual(
        expect.objectContaining({ role: 'system', content: 'You are a helpful assistant' })
      )
    })

    it('should track GPT token usage correctly', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-gpt-tokens',
        name: 'GPT Tokens Test',
        version: '1.0.0',
        userPrompt: 'Test',
        outputSchema: simpleOutputSchema,
        model: 'gpt-4o',
      })
      mockAIClient.chat.completions.create.mockResolvedValue(createMockGPTResponse({
        promptTokens: 200,
        completionTokens: 80,
      }))

      const result = await executor.execute(definition, {})

      expect(result.generativeExecution.tokens.inputTokens).toBe(200)
      expect(result.generativeExecution.tokens.outputTokens).toBe(80)
      expect(result.generativeExecution.tokens.totalTokens).toBe(280)
    })

    it('should map GPT finish_reason=length to max_tokens', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-gpt-length',
        name: 'GPT Length Test',
        version: '1.0.0',
        userPrompt: 'Test',
        outputSchema: simpleOutputSchema,
        model: 'gpt-4o',
      })
      mockAIClient.chat.completions.create.mockResolvedValue(createMockGPTResponse({
        content: '{"result": "truncated',
        finishReason: 'length',
      }))

      const result = await executor.execute(definition, {})

      expect(result.generativeExecution.stopReason).toBe('max_tokens')
    })

    it('should map GPT finish_reason=stop to end_turn', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-gpt-stop',
        name: 'GPT Stop Test',
        version: '1.0.0',
        userPrompt: 'Test',
        outputSchema: simpleOutputSchema,
        model: 'gpt-4o',
      })
      mockAIClient.chat.completions.create.mockResolvedValue(createMockGPTResponse({
        finishReason: 'stop',
      }))

      const result = await executor.execute(definition, {})

      expect(result.generativeExecution.stopReason).toBe('end_turn')
    })

    it('should return failed result if GPT client is not available', async () => {
      const executorNoGPT = new GenerativeExecutor({
        aiClient: {
          messages: { create: vi.fn() },
          // No chat.completions
        },
      })

      const definition = defineGenerativeFunction({
        id: 'test-no-gpt',
        name: 'No GPT Test',
        version: '1.0.0',
        userPrompt: 'Test',
        outputSchema: simpleOutputSchema,
        model: 'gpt-4o',
      })

      const result = await executorNoGPT.execute(definition, {})
      expect(result.status).toBe('failed')
      expect(result.error?.message).toContain('GPT client not available')
    })
  })

  // ==========================================================================
  // 12. Edge Cases
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

      await executor.execute(definition, { text: 'Hola amigos!' })

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user')
      expect(userMessage.content).toContain('Hola amigos!')
    })

    it('should handle concurrent executions', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const results = await Promise.all([
        executor.execute(definition, {}),
        executor.execute(definition, {}),
        executor.execute(definition, {}),
      ])

      expect(results).toHaveLength(3)
      results.forEach((result) => {
        expect(result.status).toBe('completed')
      })
    })

    it('should handle API response with missing usage fields', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: '{"result": "ok"}' }],
        // Missing usage and stop_reason
      })

      const result = await executor.execute(definition, {})

      expect(result.status).toBe('completed')
      expect(result.generativeExecution.tokens.inputTokens).toBe(0)
      expect(result.generativeExecution.tokens.outputTokens).toBe(0)
    })

    it('should handle network errors (non-retryable)', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockRejectedValue(new Error('Network error'))

      const result = await executor.execute(definition, {})

      expect(result.status).toBe('failed')
      expect(result.error?.message).toContain('Network error')
    })

    it('should generate unique execution IDs for each call', async () => {
      const definition = createSimpleFunction()
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const result1 = await executor.execute(definition, {})
      const result2 = await executor.execute(definition, {})

      expect(result1.executionId).toBeDefined()
      expect(result2.executionId).toBeDefined()
      expect(result1.executionId).not.toBe(result2.executionId)
    })

    it('should pass temperature from definition to API call', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-temperature',
        name: 'Temperature Test',
        version: '1.0.0',
        userPrompt: 'Generate creatively',
        outputSchema: simpleOutputSchema,
        temperature: 0.8,
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      await executor.execute(definition, {})

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      expect(callArgs.temperature).toBe(0.8)
    })

    it('should use definition temperature over config temperature (definition wins)', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-temp-override',
        name: 'Temp Override Test',
        version: '1.0.0',
        userPrompt: 'Generate',
        outputSchema: simpleOutputSchema,
        temperature: 0.5,
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const config: GenerativeFunctionConfig = { temperature: 0.9 }
      await executor.execute(definition, {}, config)

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      // definition.temperature ?? config?.temperature => definition wins
      expect(callArgs.temperature).toBe(0.5)
    })

    it('should fall back to config temperature when definition has none', async () => {
      // Create definition without explicit temperature
      const definition: GenerativeFunctionDefinition = {
        id: 'test-temp-fallback',
        name: 'Temp Fallback Test',
        version: '1.0.0',
        userPrompt: 'Generate',
        outputSchema: simpleOutputSchema,
        model: 'claude-3-sonnet',
      } as GenerativeFunctionDefinition
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const config: GenerativeFunctionConfig = { temperature: 0.9 }
      await executor.execute(definition, {}, config)

      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      // definition.temperature is undefined => config?.temperature (0.9) used
      expect(callArgs.temperature).toBe(0.9)
    })

    it('should handle no system prompt (undefined)', async () => {
      const definition = defineGenerativeFunction({
        id: 'test-no-system',
        name: 'No System Prompt Test',
        version: '1.0.0',
        userPrompt: 'Just a user prompt',
        outputSchema: simpleOutputSchema,
        // No systemPrompt
      })
      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const result = await executor.execute(definition, {})

      expect(result.status).toBe('completed')
      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      expect(callArgs.system).toBeUndefined()
    })
  })

  // ==========================================================================
  // 13. renderPrompt Helper
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

    it('should handle nested path access', () => {
      const rendered = executor.renderPrompt('Name: {{user.name}}', {
        user: { name: 'Alice' },
      })
      expect(rendered).toBe('Name: Alice')
    })

    it('should throw for missing nested variable', () => {
      expect(() => executor.renderPrompt('Name: {{user.name}}', {
        user: { age: 30 },
      })).toThrow(/missing.*variable/i)
    })

    it('should handle numeric values', () => {
      const rendered = executor.renderPrompt('Count: {{count}}', { count: 42 })
      expect(rendered).toBe('Count: 42')
    })

    it('should handle boolean values', () => {
      const rendered = executor.renderPrompt('Active: {{active}}', { active: true })
      expect(rendered).toBe('Active: true')
    })
  })

  // ==========================================================================
  // 14. Deprecated / No-op Methods
  // ==========================================================================

  describe('Deprecated Methods', () => {
    it('cleanupStaleEntries should be a no-op', () => {
      // Should not throw
      expect(() => executor.cleanupStaleEntries()).not.toThrow()
    })

    it('stopCleanup should be a no-op', () => {
      // Should not throw
      expect(() => executor.stopCleanup()).not.toThrow()
    })

    it('getCacheStats should return all expected fields', () => {
      const stats = executor.getCacheStats()

      expect(stats).toHaveProperty('size')
      expect(stats).toHaveProperty('maxSize')
      expect(stats).toHaveProperty('hits')
      expect(stats).toHaveProperty('misses')
      expect(stats).toHaveProperty('evictions')
      expect(stats).toHaveProperty('staleEvictions')
    })

    it('getCacheStats should return 0 for size and eviction fields (Cache API)', () => {
      const stats = executor.getCacheStats()

      // Cache API manages these internally - always 0 from our perspective
      expect(stats.size).toBe(0)
      expect(stats.maxSize).toBe(0)
      expect(stats.evictions).toBe(0)
      expect(stats.staleEvictions).toBe(0)
    })
  })

  // ==========================================================================
  // 15. generativeFunction() Shorthand Helper
  // ==========================================================================

  describe('generativeFunction() Shorthand', () => {
    it('should create a valid definition with generativeFunction()', async () => {
      const definition = generativeFunction(
        'quick-test',
        'Respond with a greeting',
        simpleOutputSchema
      )

      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse())

      const result = await executor.execute(definition, {})

      expect(result.status).toBe('completed')
      expect(result.functionId).toBe('quick-test')
    })

    it('should support optional parameters in generativeFunction()', async () => {
      const definition = generativeFunction(
        'shorthand-with-opts',
        'Classify: {{text}}',
        classificationOutputSchema,
        {
          name: 'Quick Classifier',
          model: 'claude-3-opus',
          systemPrompt: 'You classify text',
          examples: [
            { input: { text: 'Great!' }, output: { category: 'positive', confidence: 0.9 } },
          ],
        }
      )

      mockAIClient.messages.create.mockResolvedValue(createMockClaudeResponse({
        content: '{"category": "positive", "confidence": 0.85}',
      }))

      const result = await executor.execute(definition, { text: 'Nice work!' })

      expect(result.status).toBe('completed')
      // Should have used system prompt
      const callArgs = mockAIClient.messages.create.mock.calls[0][0]
      expect(callArgs.system).toBe('You classify text')
      // Should have included examples
      expect(callArgs.messages.length).toBeGreaterThan(1)
    })
  })
})
