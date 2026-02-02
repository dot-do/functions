/**
 * Function Classifier Tests
 *
 * Tests the AI-based function type classifier that determines whether a function
 * should be executed as code, generative, agentic, or human.
 *
 * Test Categories:
 * 1. AI-based classification with mock AI client
 * 2. Heuristic fallback classification (no AI client)
 * 3. Classification of clear-cut cases
 * 4. Edge cases (unknown, ambiguous, malformed responses)
 * 5. Caching behavior (FunctionClassifier class)
 * 6. Error handling and timeout fallbacks
 *
 * @module core/__tests__/function-classifier.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  classifyFunction,
  classifyByHeuristic,
  FunctionClassifier,
  type ClassificationResult,
  type FunctionType,
} from '../function-classifier'

// =============================================================================
// MOCK AI CLIENT
// =============================================================================

/**
 * Create a mock AI client matching the generative executor's AIClient interface
 */
function createMockAIClient(responseContent?: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: responseContent ?? '{"type":"code","confidence":0.9,"reasoning":"Test response"}',
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
        stop_reason: 'end_turn',
        model: 'claude-3-haiku-20240307',
      }),
    },
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  }
}

/**
 * Create a mock AI client that returns a specific classification
 */
function createClassifyingClient(type: FunctionType, confidence: number, reasoning: string) {
  return createMockAIClient(
    JSON.stringify({ type, confidence, reasoning }),
  )
}

/**
 * Create a mock AI client that throws an error
 */
function createFailingClient(error: Error = new Error('AI service unavailable')) {
  return {
    messages: {
      create: vi.fn().mockRejectedValue(error),
    },
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  }
}

// =============================================================================
// AI-BASED CLASSIFICATION
// =============================================================================

describe('classifyFunction (AI-based)', () => {
  it('should classify using AI client when provided', async () => {
    const client = createClassifyingClient('code', 0.95, 'Tax calculation is arithmetic')

    const result = await classifyFunction(
      'calculateTax',
      'Calculates sales tax',
      { type: 'object', properties: { amount: { type: 'number' } } },
      client,
    )

    expect(result.type).toBe('code')
    expect(result.confidence).toBe(0.95)
    expect(result.reasoning).toBe('Tax calculation is arithmetic')
  })

  it('should pass correct parameters to AI client', async () => {
    const client = createClassifyingClient('generative', 0.9, 'Summarization needs AI')

    await classifyFunction(
      'summarizeArticle',
      'Summarizes a long article into key points',
      { type: 'object', properties: { text: { type: 'string' } } },
      client,
    )

    expect(client.messages.create).toHaveBeenCalledTimes(1)
    const callArgs = client.messages.create.mock.calls[0]?.[0] as Record<string, unknown> | undefined

    expect(callArgs).toBeDefined()
    expect(callArgs!.model).toBe('claude-3-haiku')
    expect(callArgs!.temperature).toBe(0)
    expect(callArgs!.max_tokens).toBe(256)
    expect(callArgs!.system).toContain('function type classifier')
    expect((callArgs!.messages as Array<{ content: string }>)[0].content).toContain('summarizeArticle')
    expect((callArgs!.messages as Array<{ content: string }>)[0].content).toContain('Summarizes a long article')
  })

  it('should use custom model from options', async () => {
    const client = createClassifyingClient('code', 0.9, 'test')

    await classifyFunction('test', undefined, undefined, client, {
      model: 'claude-3-sonnet',
    })

    const callArgs = client.messages.create.mock.calls[0]?.[0] as Record<string, unknown> | undefined
    expect(callArgs).toBeDefined()
    expect(callArgs!.model).toBe('claude-3-sonnet')
  })

  it('should use custom temperature from options', async () => {
    const client = createClassifyingClient('code', 0.9, 'test')

    await classifyFunction('test', undefined, undefined, client, {
      temperature: 0.5,
    })

    const callArgs = client.messages.create.mock.calls[0]?.[0] as Record<string, unknown> | undefined
    expect(callArgs).toBeDefined()
    expect(callArgs!.temperature).toBe(0.5)
  })

  it('should fall back to heuristic on AI error', async () => {
    const client = createFailingClient()

    const result = await classifyFunction(
      'calculateTax',
      'Calculates sales tax for a given amount',
      undefined,
      client,
    )

    // Should still return a result via heuristic
    expect(result.type).toBe('code')
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.reasoning).toContain('heuristic')
  })

  it('should fall back to heuristic when no AI client', async () => {
    const result = await classifyFunction(
      'summarizeArticle',
      'Summarizes text using AI',
    )

    expect(result.type).toBe('generative')
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.reasoning).toContain('heuristic')
  })

  it('should handle AI response with markdown code blocks', async () => {
    const client = createMockAIClient(
      '```json\n{"type":"generative","confidence":0.88,"reasoning":"Needs AI generation"}\n```',
    )

    const result = await classifyFunction('generateDescription', undefined, undefined, client)

    expect(result.type).toBe('generative')
    expect(result.confidence).toBe(0.88)
  })

  it('should handle malformed JSON response by trying text extraction', async () => {
    const client = createMockAIClient(
      'I think this is a generative function because it needs AI to create content.',
    )

    const result = await classifyFunction('generatePoem', undefined, undefined, client)

    expect(result.type).toBe('generative')
    expect(result.confidence).toBe(0.5)
  })

  it('should handle completely unparseable response with heuristic fallback', async () => {
    const client = createMockAIClient('---')

    const result = await classifyFunction('calculateTax', undefined, undefined, client)

    // Falls back to heuristic which should detect "calculate"
    expect(result.type).toBe('code')
  })

  it('should clamp confidence to 0-1 range', async () => {
    const client = createMockAIClient(
      '{"type":"code","confidence":1.5,"reasoning":"Over-confident"}',
    )

    const result = await classifyFunction('test', undefined, undefined, client)

    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(result.confidence).toBeGreaterThanOrEqual(0)
  })

  it('should handle missing confidence with default', async () => {
    const client = createMockAIClient(
      '{"type":"code","reasoning":"No confidence provided"}',
    )

    const result = await classifyFunction('test', undefined, undefined, client)

    expect(result.type).toBe('code')
    expect(result.confidence).toBe(0.5)
  })

  it('should include input schema in AI request when provided', async () => {
    const client = createClassifyingClient('code', 0.9, 'test')
    const schema = {
      type: 'object',
      properties: {
        amount: { type: 'number' },
        rate: { type: 'number' },
      },
      required: ['amount', 'rate'],
    }

    await classifyFunction('calculateTax', 'Computes tax', schema, client)

    const callArgs = client.messages.create.mock.calls[0]?.[0] as Record<string, unknown> | undefined
    expect(callArgs).toBeDefined()
    const messages = callArgs!.messages as Array<{ content: string }>
    expect(messages[0].content).toContain('Input schema')
    expect(messages[0].content).toContain('amount')
    expect(messages[0].content).toContain('rate')
  })

  it('should reject invalid type from AI response', async () => {
    const client = createMockAIClient(
      '{"type":"unknown","confidence":0.9,"reasoning":"Invalid type"}',
    )

    const result = await classifyFunction('test', undefined, undefined, client)

    // Should fall back to heuristic since "unknown" is not a valid type
    expect(['code', 'generative', 'agentic', 'human']).toContain(result.type)
  })
})

// =============================================================================
// HEURISTIC CLASSIFICATION
// =============================================================================

describe('classifyByHeuristic', () => {
  describe('Code tier classification', () => {
    const codeFunctions = [
      'calculateTax',
      'computeHash',
      'convertTemperature',
      'formatCurrency',
      'parseCSV',
      'validateEmail',
      'sortArray',
      'filterItems',
      'transformData',
      'encodeBase64',
      'decodeJSON',
      'hashPassword',
      'generateUUID',
      'compressData',
      'mergeObjects',
      'splitString',
      'trimWhitespace',
      'roundNumber',
      'normalizeUrl',
      'sanitizeInput',
      'countWords',
      'sumValues',
      'isValidUrl',
      'hasPermission',
      'getTimestamp',
      'toString',
      'fromJSON',
    ]

    for (const name of codeFunctions) {
      it(`should classify "${name}" as code`, () => {
        const result = classifyByHeuristic(name)
        expect(result.type).toBe('code')
        expect(result.confidence).toBeGreaterThan(0.3)
      })
    }
  })

  describe('Generative tier classification', () => {
    const generativeFunctions = [
      'summarizeArticle',
      'translateText',
      'generateProductDescription',
      'writeEmail',
      'rewriteParagraph',
      'composeTweet',
      'draftResponse',
      'describeImage',
      'explainConcept',
      'classifySentiment',
      'extractKeywords',
      'answerQuestion',
      'completeSentence',
      'suggestImprovements',
      'paraphraseText',
      'simplifyLanguage',
      'createContentSummary',
    ]

    for (const name of generativeFunctions) {
      it(`should classify "${name}" as generative`, () => {
        const result = classifyByHeuristic(name)
        expect(result.type).toBe('generative')
        expect(result.confidence).toBeGreaterThan(0.3)
      })
    }
  })

  describe('Agentic tier classification', () => {
    const agenticFunctions = [
      'researchCompetitors',
      'investigateBug',
      'analyzeCodebase',
      'auditSecurity',
      'planProject',
      'orchestrateWorkflow',
      'buildReport',
      'debugApplication',
      'diagnoseIssue',
      'troubleshootError',
      'scanVulnerabilities',
      'crawlWebsite',
      'compareProducts',
    ]

    for (const name of agenticFunctions) {
      it(`should classify "${name}" as agentic`, () => {
        const result = classifyByHeuristic(name)
        expect(result.type).toBe('agentic')
        expect(result.confidence).toBeGreaterThan(0.3)
      })
    }
  })

  describe('Human tier classification', () => {
    const humanFunctions = [
      'approveExpenseReport',
      'reviewContentForPublishing',
      'moderateUserContent',
      'verifyIdentity',
      'confirmOrder',
      'authorizePayment',
      'signContract',
      'escalateIssue',
      'evaluateCandidate',
    ]

    for (const name of humanFunctions) {
      it(`should classify "${name}" as human`, () => {
        const result = classifyByHeuristic(name)
        expect(result.type).toBe('human')
        expect(result.confidence).toBeGreaterThan(0.3)
      })
    }

    it('should classify human functions with description hints', () => {
      // These benefit from description for disambiguation
      const result = classifyByHeuristic(
        'moderateContent',
        'Requires human judgment to enforce community policy',
      )
      expect(result.type).toBe('human')
    })
  })

  describe('Description-enhanced classification', () => {
    it('should use description to disambiguate', () => {
      // "approve" in the name is a strong human signal, description reinforces it
      const result = classifyByHeuristic(
        'approveRequest',
        'Requires human approval for compliance review',
      )
      expect(result.type).toBe('human')
    })

    it('should boost confidence when name and description agree', () => {
      const withDesc = classifyByHeuristic(
        'summarizeArticle',
        'Uses AI to generate a concise summary of the article text',
      )
      const withoutDesc = classifyByHeuristic('summarizeArticle')

      // Both should be generative, but with description should have equal or higher confidence
      expect(withDesc.type).toBe('generative')
      expect(withoutDesc.type).toBe('generative')
      expect(withDesc.confidence).toBeGreaterThanOrEqual(withoutDesc.confidence)
    })
  })

  describe('Unknown/ambiguous functions', () => {
    it('should default to code with low confidence for unknown names', () => {
      const result = classifyByHeuristic('doSomething')
      expect(result.type).toBe('code')
      expect(result.confidence).toBeLessThanOrEqual(0.5)
    })

    it('should return valid result for empty-ish names', () => {
      const result = classifyByHeuristic('x')
      expect(result.type).toBe('code')
      expect(result.confidence).toBe(0.3)
    })
  })

  describe('Result structure', () => {
    it('should always return type, confidence, and reasoning', () => {
      const result = classifyByHeuristic('calculateTax')

      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('confidence')
      expect(result).toHaveProperty('reasoning')
      expect(typeof result.type).toBe('string')
      expect(typeof result.confidence).toBe('number')
      expect(typeof result.reasoning).toBe('string')
    })

    it('should have confidence between 0 and 1', () => {
      const functions = ['calculateTax', 'summarizeText', 'researchTopic', 'approveRequest', 'xyz']

      for (const name of functions) {
        const result = classifyByHeuristic(name)
        expect(result.confidence).toBeGreaterThanOrEqual(0)
        expect(result.confidence).toBeLessThanOrEqual(1)
      }
    })
  })
})

// =============================================================================
// CLEAR-CUT CLASSIFICATION CASES (integration-style)
// =============================================================================

describe('Clear-cut classification cases', () => {
  it('calculateTax -> Code', async () => {
    const client = createClassifyingClient(
      'code',
      0.95,
      'Tax calculation is a deterministic arithmetic operation.',
    )

    const result = await classifyFunction(
      'calculateTax',
      'Calculates sales tax for a given purchase amount and tax rate',
      {
        type: 'object',
        properties: {
          amount: { type: 'number' },
          taxRate: { type: 'number' },
        },
      },
      client,
    )

    expect(result.type).toBe('code')
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('summarizeArticle -> Generative', async () => {
    const client = createClassifyingClient(
      'generative',
      0.92,
      'Article summarization requires AI language understanding and generation.',
    )

    const result = await classifyFunction(
      'summarizeArticle',
      'Produces a concise summary of a long article',
      {
        type: 'object',
        properties: {
          text: { type: 'string' },
          maxLength: { type: 'number' },
        },
      },
      client,
    )

    expect(result.type).toBe('generative')
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('researchCompetitors -> Agentic', async () => {
    const client = createClassifyingClient(
      'agentic',
      0.88,
      'Competitor research requires multi-step data gathering and analysis.',
    )

    const result = await classifyFunction(
      'researchCompetitors',
      'Researches competitor companies and produces a comprehensive analysis',
      {
        type: 'object',
        properties: {
          company: { type: 'string' },
          industry: { type: 'string' },
        },
      },
      client,
    )

    expect(result.type).toBe('agentic')
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it('approveExpenseReport -> Human', async () => {
    const client = createClassifyingClient(
      'human',
      0.94,
      'Expense approval requires human judgment and authorization.',
    )

    const result = await classifyFunction(
      'approveExpenseReport',
      'Reviews and approves or rejects an employee expense report',
      {
        type: 'object',
        properties: {
          reportId: { type: 'string' },
          amount: { type: 'number' },
          items: { type: 'array' },
        },
      },
      client,
    )

    expect(result.type).toBe('human')
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })
})

// =============================================================================
// FUNCTION CLASSIFIER CLASS (with caching)
// =============================================================================

describe('FunctionClassifier class', () => {
  let classifier: FunctionClassifier

  beforeEach(() => {
    const client = createClassifyingClient('code', 0.9, 'Cached test')
    classifier = new FunctionClassifier(client, { maxCacheSize: 10 })
  })

  it('should classify functions', async () => {
    const result = await classifier.classify('calculateTax')

    expect(result.type).toBe('code')
    expect(result.confidence).toBe(0.9)
  })

  it('should cache classification results', async () => {
    // First call
    const result1 = await classifier.classify('calculateTax', 'Computes tax')
    expect(result1.type).toBe('code')
    expect(classifier.getCacheSize()).toBe(1)

    // Second call with same args should use cache
    const result2 = await classifier.classify('calculateTax', 'Computes tax')
    expect(result2.type).toBe('code')
    expect(classifier.getCacheSize()).toBe(1)

    // Results should be identical
    expect(result1).toEqual(result2)
  })

  it('should not cache different function names together', async () => {
    await classifier.classify('calculateTax')
    await classifier.classify('summarizeText')

    expect(classifier.getCacheSize()).toBe(2)
  })

  it('should evict oldest entry when cache is full', async () => {
    const client = createClassifyingClient('code', 0.9, 'test')
    const smallCacheClassifier = new FunctionClassifier(client, { maxCacheSize: 3 })

    await smallCacheClassifier.classify('func1')
    await smallCacheClassifier.classify('func2')
    await smallCacheClassifier.classify('func3')
    expect(smallCacheClassifier.getCacheSize()).toBe(3)

    // Adding a 4th should evict the first
    await smallCacheClassifier.classify('func4')
    expect(smallCacheClassifier.getCacheSize()).toBe(3)
  })

  it('should clear cache', async () => {
    await classifier.classify('calculateTax')
    await classifier.classify('summarizeText')
    expect(classifier.getCacheSize()).toBe(2)

    classifier.clearCache()
    expect(classifier.getCacheSize()).toBe(0)
  })

  it('should invalidate specific cache entry', async () => {
    await classifier.classify('calculateTax', 'desc')
    expect(classifier.getCacheSize()).toBe(1)

    const removed = classifier.invalidate('calculateTax', 'desc')
    expect(removed).toBe(true)
    expect(classifier.getCacheSize()).toBe(0)
  })

  it('should return false when invalidating non-existent entry', () => {
    const removed = classifier.invalidate('nonExistent')
    expect(removed).toBe(false)
  })

  it('should work without AI client (heuristic mode)', async () => {
    const heuristicClassifier = new FunctionClassifier()

    const result = await heuristicClassifier.classify('calculateTax')

    expect(result.type).toBe('code')
    expect(result.reasoning).toContain('heuristic')
  })

  it('should cache heuristic results too', async () => {
    const heuristicClassifier = new FunctionClassifier(undefined, { maxCacheSize: 10 })

    await heuristicClassifier.classify('calculateTax')
    expect(heuristicClassifier.getCacheSize()).toBe(1)

    // Second call should use cache
    await heuristicClassifier.classify('calculateTax')
    expect(heuristicClassifier.getCacheSize()).toBe(1)
  })

  it('should include inputSchema in cache key', async () => {
    const schema1 = { type: 'object', properties: { a: { type: 'number' } } }
    const schema2 = { type: 'object', properties: { b: { type: 'string' } } }

    await classifier.classify('process', 'desc', schema1)
    await classifier.classify('process', 'desc', schema2)

    // Different schemas = different cache entries
    expect(classifier.getCacheSize()).toBe(2)
  })
})

// =============================================================================
// ERROR HANDLING
// =============================================================================

describe('Error handling', () => {
  it('should handle AI timeout gracefully', async () => {
    const client = {
      messages: {
        create: vi.fn().mockImplementation(
          () => new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout')), 100)
          }),
        ),
      },
      chat: { completions: { create: vi.fn() } },
    }

    const result = await classifyFunction(
      'calculateTax',
      'Compute tax amount',
      undefined,
      client,
      { timeoutMs: 50 },
    )

    // Should fall back to heuristic
    expect(result.type).toBe('code')
    expect(result.reasoning).toContain('heuristic')
  })

  it('should handle AI returning empty content', async () => {
    const client = createMockAIClient('')

    const result = await classifyFunction('calculateTax', undefined, undefined, client)

    // Should fall back to heuristic for "calculate" pattern
    expect(result.type).toBe('code')
  })

  it('should handle AI returning null-like content', async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [],
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
      },
      chat: { completions: { create: vi.fn() } },
    }

    const result = await classifyFunction('calculateTax', undefined, undefined, client)

    // Should fall back to heuristic
    expect(result.type).toBe('code')
  })

  it('should handle network errors gracefully', async () => {
    const client = createFailingClient(new Error('Network error: ECONNREFUSED'))

    const result = await classifyFunction(
      'summarizeArticle',
      'Summarize text',
      undefined,
      client,
    )

    // Should fall back to heuristic
    expect(result.type).toBe('generative')
    expect(result.reasoning).toContain('heuristic')
  })
})
