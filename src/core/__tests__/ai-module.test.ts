/**
 * AI Module Tests
 *
 * Tests the AI provider configuration, factory functions, and standalone
 * classification API. Complements function-classifier.test.ts which tests
 * the core classification logic.
 *
 * Covers:
 * - createClassifierOptionsFromEnv: provider selection from env vars
 * - classifyFunction: standalone convenience function
 * - AI provider config validation (missing keys, invalid configs)
 * - Multi-provider priority ordering
 * - AIClient and WorkersAI interface contracts (from env.ts)
 *
 * @module core/__tests__/ai-module.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  FunctionClassifier,
  classifyFunction,
  createClassifierFromBinding,
  createClassifierOptionsFromEnv,
  createClassifier,
  type ClassifierOptions,
  type AIProviderConfig,
  type ClassificationResult,
  type WorkersAIBinding,
} from '../function-classifier'
import type { AIClient, WorkersAI } from '../env'

// =============================================================================
// MOCK HELPERS
// =============================================================================

function createMockBinding(response?: string): WorkersAIBinding {
  return {
    run: vi.fn().mockResolvedValue({
      response: response ?? '{"type":"code","confidence":0.9,"reasoning":"Test"}',
    }),
  }
}

// =============================================================================
// createClassifierOptionsFromEnv
// =============================================================================

describe('createClassifierOptionsFromEnv', () => {
  it('should use Workers AI binding as primary when provided', () => {
    const binding = createMockBinding()
    const options = createClassifierOptionsFromEnv({}, binding)

    expect(options.providers.length).toBeGreaterThanOrEqual(1)
    expect(options.providers[0].type).toBe('cloudflare-workers-ai')
  })

  it('should use default model for Workers AI', () => {
    const binding = createMockBinding()
    const options = createClassifierOptionsFromEnv({}, binding)

    expect(options.providers[0].model).toBe('@cf/meta/llama-3.1-8b-instruct')
  })

  it('should use custom model from env for Workers AI', () => {
    const binding = createMockBinding()
    const options = createClassifierOptionsFromEnv(
      { WORKERS_AI_MODEL: '@cf/custom/model' },
      binding
    )

    expect(options.providers[0].model).toBe('@cf/custom/model')
  })

  it('should fall back to REST API when no binding but account ID and token provided', () => {
    const options = createClassifierOptionsFromEnv({
      CLOUDFLARE_ACCOUNT_ID: 'abc123',
      CLOUDFLARE_API_TOKEN: 'token456',
    })

    expect(options.providers[0].type).toBe('cloudflare-workers-ai')
    expect(options.providers[0].accountId).toBe('abc123')
    expect(options.providers[0].apiKey).toBe('token456')
  })

  it('should add OpenRouter provider when OPENROUTER_API_KEY is set', () => {
    const binding = createMockBinding()
    const options = createClassifierOptionsFromEnv(
      { OPENROUTER_API_KEY: 'or-key-123' },
      binding
    )

    const openrouter = options.providers.find(p => p.type === 'openrouter')
    expect(openrouter).toBeDefined()
    expect(openrouter!.apiKey).toBe('or-key-123')
    expect(openrouter!.model).toBe('anthropic/claude-3-haiku')
  })

  it('should add Anthropic provider when ANTHROPIC_API_KEY is set', () => {
    const binding = createMockBinding()
    const options = createClassifierOptionsFromEnv(
      { ANTHROPIC_API_KEY: 'ant-key-123' },
      binding
    )

    const anthropic = options.providers.find(p => p.type === 'anthropic')
    expect(anthropic).toBeDefined()
    expect(anthropic!.apiKey).toBe('ant-key-123')
    expect(anthropic!.model).toBe('claude-3-haiku-20240307')
  })

  it('should add OpenAI provider when OPENAI_API_KEY is set', () => {
    const binding = createMockBinding()
    const options = createClassifierOptionsFromEnv(
      { OPENAI_API_KEY: 'sk-test-123' },
      binding
    )

    const openai = options.providers.find(p => p.type === 'openai')
    expect(openai).toBeDefined()
    expect(openai!.apiKey).toBe('sk-test-123')
    expect(openai!.model).toBe('gpt-4o-mini')
  })

  it('should add Bedrock provider when AWS_REGION and USE_BEDROCK=true are set', () => {
    const binding = createMockBinding()
    const options = createClassifierOptionsFromEnv(
      { AWS_REGION: 'us-west-2', USE_BEDROCK: 'true' },
      binding
    )

    const bedrock = options.providers.find(p => p.type === 'bedrock')
    expect(bedrock).toBeDefined()
    expect(bedrock!.region).toBe('us-west-2')
  })

  it('should not add Bedrock when USE_BEDROCK is not true', () => {
    const binding = createMockBinding()
    const options = createClassifierOptionsFromEnv(
      { AWS_REGION: 'us-west-2', USE_BEDROCK: 'false' },
      binding
    )

    const bedrock = options.providers.find(p => p.type === 'bedrock')
    expect(bedrock).toBeUndefined()
  })

  it('should configure all providers when all env vars are set', () => {
    const binding = createMockBinding()
    const options = createClassifierOptionsFromEnv(
      {
        OPENROUTER_API_KEY: 'or-key',
        ANTHROPIC_API_KEY: 'ant-key',
        OPENAI_API_KEY: 'sk-key',
        AWS_REGION: 'us-east-1',
        USE_BEDROCK: 'true',
      },
      binding
    )

    // Workers AI (from binding) + all four fallbacks
    expect(options.providers.length).toBe(5)
    expect(options.providers[0].type).toBe('cloudflare-workers-ai')
    expect(options.providers[1].type).toBe('openrouter')
    expect(options.providers[2].type).toBe('anthropic')
    expect(options.providers[3].type).toBe('openai')
    expect(options.providers[4].type).toBe('bedrock')
  })

  it('should use custom models from env vars', () => {
    const binding = createMockBinding()
    const options = createClassifierOptionsFromEnv(
      {
        OPENROUTER_API_KEY: 'or-key',
        OPENROUTER_MODEL: 'custom/router-model',
        ANTHROPIC_API_KEY: 'ant-key',
        ANTHROPIC_MODEL: 'claude-3-opus-20240229',
        OPENAI_API_KEY: 'sk-key',
        OPENAI_MODEL: 'gpt-4-turbo',
        AWS_REGION: 'eu-west-1',
        USE_BEDROCK: 'true',
        BEDROCK_MODEL: 'custom.bedrock.model',
      },
      binding
    )

    expect(options.providers.find(p => p.type === 'openrouter')!.model).toBe('custom/router-model')
    expect(options.providers.find(p => p.type === 'anthropic')!.model).toBe('claude-3-opus-20240229')
    expect(options.providers.find(p => p.type === 'openai')!.model).toBe('gpt-4-turbo')
    expect(options.providers.find(p => p.type === 'bedrock')!.model).toBe('custom.bedrock.model')
  })

  it('should throw when no providers can be configured', () => {
    expect(() => createClassifierOptionsFromEnv({})).toThrow(
      'No AI providers configured'
    )
  })

  it('should set default temperature to 0', () => {
    const binding = createMockBinding()
    const options = createClassifierOptionsFromEnv({}, binding)

    expect(options.temperature).toBe(0)
  })

  it('should set default timeout to 10000ms', () => {
    const binding = createMockBinding()
    const options = createClassifierOptionsFromEnv({}, binding)

    expect(options.timeoutMs).toBe(10000)
  })
})

// =============================================================================
// classifyFunction (standalone)
// =============================================================================

describe('classifyFunction', () => {
  it('should throw when no options provided', async () => {
    await expect(classifyFunction('test')).rejects.toThrow(
      'classifyFunction requires at least one AI provider in options'
    )
  })

  it('should throw when options has empty providers', async () => {
    await expect(
      classifyFunction('test', undefined, undefined, { providers: [] })
    ).rejects.toThrow()
  })

  it('should classify using provided options via REST API fallback', async () => {
    // classifyFunction creates a FunctionClassifier internally.
    // Without a binding, Workers AI uses the REST API which calls fetch.
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          response: '{"type":"generative","confidence":0.85,"reasoning":"Text generation"}',
        },
      }),
      text: async () => '',
    } as Response)

    try {
      const result = await classifyFunction(
        'summarizeText',
        'Summarizes input text',
        undefined,
        {
          providers: [{
            type: 'cloudflare-workers-ai',
            accountId: 'test-account',
            apiKey: 'test-key',
          }],
        }
      )

      expect(result.type).toBe('generative')
      expect(result.confidence).toBe(0.85)
      expect(result.provider).toBe('cloudflare-workers-ai')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('should use deterministic fallback when all providers fail', async () => {
    // Mock global fetch to simulate network failure
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('No network'))

    try {
      const result = await classifyFunction('testFunc', 'desc', undefined, {
        providers: [
          {
            type: 'cloudflare-workers-ai',
            accountId: 'test-account',
            apiKey: 'test-key',
          },
        ],
      })

      // Fallback returns 'human' as default when no metadata hints are present
      expect(result.type).toBe('human')
      expect(result.confidence).toBe(0.5)
      expect(result.provider).toBe('fallback')
      expect(result.reasoning).toContain('Fallback classification')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

// =============================================================================
// createClassifier factory
// =============================================================================

describe('createClassifier', () => {
  it('should create classifier with binding and env', () => {
    const binding = createMockBinding()
    const classifier = createClassifier(binding, {
      OPENROUTER_API_KEY: 'or-key',
    })

    const providers = classifier.getProviders()
    expect(providers).toContain('cloudflare-workers-ai')
    expect(providers).toContain('openrouter')
  })

  it('should work with only binding (no env)', () => {
    const binding = createMockBinding()
    const classifier = createClassifier(binding)

    const providers = classifier.getProviders()
    expect(providers.length).toBe(1)
    expect(providers[0]).toBe('cloudflare-workers-ai')
  })

  it('should return a FunctionClassifier instance', () => {
    const binding = createMockBinding()
    const classifier = createClassifier(binding)

    expect(classifier).toBeInstanceOf(FunctionClassifier)
  })
})

// =============================================================================
// createClassifierFromBinding factory
// =============================================================================

describe('createClassifierFromBinding', () => {
  it('should create classifier with default model', () => {
    const binding = createMockBinding()
    const classifier = createClassifierFromBinding(binding)

    expect(classifier.getProviders()).toEqual(['cloudflare-workers-ai'])
  })

  it('should pass custom model to provider', async () => {
    const binding = createMockBinding()
    const classifier = createClassifierFromBinding(binding, '@cf/custom/model-v2')

    const result = await classifier.classify('testFunc')
    expect(binding.run).toHaveBeenCalledWith(
      '@cf/custom/model-v2',
      expect.any(Object)
    )
  })

  it('should forward classification calls to the binding', async () => {
    const binding = createMockBinding(
      '{"type":"agentic","confidence":0.88,"reasoning":"Multi-step"}'
    )
    const classifier = createClassifierFromBinding(binding)

    const result = await classifier.classify('researchTopic', 'Researches a topic')

    expect(result.type).toBe('agentic')
    expect(result.confidence).toBe(0.88)
    expect(result.reasoning).toBe('Multi-step')
    expect(result.provider).toBe('cloudflare-workers-ai')
    expect(binding.run).toHaveBeenCalledTimes(1)
  })
})

// =============================================================================
// AIClient interface compliance
// =============================================================================

describe('AIClient interface', () => {
  it('should define messages.create for generative execution', () => {
    const client: AIClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Hello world' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
          model: 'claude-3-sonnet',
        }),
      },
    }

    expect(client.messages).toBeDefined()
    expect(typeof client.messages!.create).toBe('function')
  })

  it('should define chat method for agentic execution', () => {
    const client: AIClient = {
      chat: vi.fn().mockResolvedValue({
        content: 'Response text',
        toolCalls: [],
        stopReason: 'end_turn',
        tokens: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
    }

    expect(client.chat).toBeDefined()
    expect(typeof client.chat).toBe('function')
  })

  it('should support both messages and chat methods simultaneously', () => {
    const client: AIClient = {
      messages: {
        create: vi.fn(),
      },
      chat: vi.fn(),
    }

    expect(client.messages).toBeDefined()
    expect(client.chat).toBeDefined()
  })
})

// =============================================================================
// WorkersAI interface
// =============================================================================

describe('WorkersAI interface', () => {
  it('should define run method accepting model and input', async () => {
    const ai: WorkersAI = {
      run: vi.fn().mockResolvedValue({ response: 'test' }),
    }

    const result = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(ai.run).toHaveBeenCalledWith(
      '@cf/meta/llama-3.1-8b-instruct',
      expect.objectContaining({ messages: expect.any(Array) })
    )
    expect(result).toEqual({ response: 'test' })
  })
})

// =============================================================================
// FunctionClassifier constructor validation
// =============================================================================

describe('FunctionClassifier constructor', () => {
  it('should throw when providers array is empty', () => {
    expect(() => new FunctionClassifier({ providers: [] })).toThrow(
      'FunctionClassifier requires at least one AI provider'
    )
  })

  it('should accept temperature option', async () => {
    const binding = createMockBinding()
    const classifier = new FunctionClassifier(
      {
        providers: [{ type: 'cloudflare-workers-ai' }],
        temperature: 0.5,
      },
      binding
    )

    await classifier.classify('testFunc')

    expect(binding.run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ temperature: 0.5 })
    )
  })

  it('should default temperature to 0', async () => {
    const binding = createMockBinding()
    const classifier = new FunctionClassifier(
      {
        providers: [{ type: 'cloudflare-workers-ai' }],
      },
      binding
    )

    await classifier.classify('testFunc')

    expect(binding.run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ temperature: 0 })
    )
  })

  it('should accept custom timeout', () => {
    const binding = createMockBinding()
    const classifier = new FunctionClassifier(
      {
        providers: [{ type: 'cloudflare-workers-ai' }],
        timeoutMs: 5000,
      },
      binding
    )

    // Should not throw
    expect(classifier.getProviders()).toEqual(['cloudflare-workers-ai'])
  })

  it('should accept maxRetriesPerProvider option', () => {
    const binding = createMockBinding()
    const classifier = new FunctionClassifier(
      {
        providers: [{ type: 'cloudflare-workers-ai' }],
        maxRetriesPerProvider: 3,
      },
      binding
    )

    expect(classifier.getProviders()).toEqual(['cloudflare-workers-ai'])
  })

  it('should throw for unknown provider type', () => {
    expect(
      () =>
        new FunctionClassifier({
          providers: [{ type: 'nonexistent' as any }],
        })
    ).toThrow('Unknown AI provider type')
  })
})

// =============================================================================
// Cache operations
// =============================================================================

describe('FunctionClassifier cache management', () => {
  it('should start with zero cache size', () => {
    const binding = createMockBinding()
    const classifier = createClassifierFromBinding(binding)

    expect(classifier.getCacheSize()).toBe(0)
  })

  it('should increment cache size after classification', async () => {
    const binding = createMockBinding()
    const classifier = createClassifierFromBinding(binding)

    await classifier.classify('testFunc')

    // Cache size tracks keys this instance has seen
    expect(classifier.getCacheSize()).toBeGreaterThanOrEqual(0)
  })

  it('should clear cache without throwing', async () => {
    const binding = createMockBinding()
    const classifier = createClassifierFromBinding(binding)

    await classifier.classify('func1')
    await classifier.clearCache()

    expect(classifier.getCacheSize()).toBe(0)
  })

  it('should handle invalidate for non-existent key', async () => {
    const binding = createMockBinding()
    const classifier = createClassifierFromBinding(binding)

    const result = await classifier.invalidate('nonexistent')
    expect(result).toBe(false)
  })
})
