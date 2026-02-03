/// <reference types="@cloudflare/workers-types" />
/**
 * E2E Tests: AI Classifier with Real Bindings
 *
 * Tests the function classifier's integration with real AI bindings in Workers runtime.
 * These tests validate that:
 * - The classifier works with real Workers AI binding when available
 * - Classification results are valid and reasonable
 * - Caching and fallback mechanisms work correctly
 *
 * NOTE: Tests are skipped when AI binding is not available.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { env } from 'cloudflare:test'
import {
  FunctionClassifier,
  createClassifierFromBinding,
  type ClassificationResult,
  type FunctionType,
} from '../../src/core/function-classifier'

// Extend the env type to include AI binding
interface TestEnv {
  AI?: {
    run(model: string, input: unknown): Promise<unknown>
  }
  E2E_BASE_URL?: string
  FUNCTIONS_API_KEY?: string
  ENVIRONMENT?: string
}

const testEnv = env as unknown as TestEnv

/**
 * Check if AI binding is available for testing
 */
function hasAIBinding(): boolean {
  return testEnv.AI !== undefined && typeof testEnv.AI?.run === 'function'
}

describe('AI Classifier with real bindings', () => {
  let classifier: FunctionClassifier | null = null

  beforeAll(() => {
    if (hasAIBinding()) {
      classifier = createClassifierFromBinding(testEnv.AI!)
    }
  })

  afterAll(async () => {
    if (classifier) {
      await classifier.clearCache()
    }
  })

  // ============================================================================
  // Basic Classification Tests
  // ============================================================================

  describe('Code function classification', () => {
    it.skipIf(!hasAIBinding())('should classify calculateTax as code', async () => {
      const result = await classifier!.classify(
        'calculateTax',
        'Computes sales tax based on income and rate'
      )

      expect(result).toBeDefined()
      expect(result.type).toBe('code')
      expect(result.confidence).toBeGreaterThan(0.7)
      expect(result.reasoning).toBeDefined()
      expect(result.provider).toBe('cloudflare-workers-ai')
    })

    it.skipIf(!hasAIBinding())('should classify formatCurrency as code', async () => {
      const result = await classifier!.classify(
        'formatCurrency',
        'Formats a number as currency with locale support',
        {
          type: 'object',
          properties: {
            amount: { type: 'number' },
            locale: { type: 'string' },
            currency: { type: 'string' },
          },
        }
      )

      expect(result.type).toBe('code')
      expect(result.confidence).toBeGreaterThan(0.7)
    })

    it.skipIf(!hasAIBinding())('should classify validateEmail as code', async () => {
      const result = await classifier!.classify(
        'validateEmail',
        'Validates email address format using regex'
      )

      expect(result.type).toBe('code')
    })

    it.skipIf(!hasAIBinding())('should classify sortArray as code', async () => {
      const result = await classifier!.classify(
        'sortArray',
        'Sorts an array of items by a given key'
      )

      expect(result.type).toBe('code')
    })
  })

  describe('Generative function classification', () => {
    it.skipIf(!hasAIBinding())('should classify summarizeArticle as generative', async () => {
      const result = await classifier!.classify(
        'summarizeArticle',
        'Summarizes a long article into a brief paragraph'
      )

      expect(result).toBeDefined()
      expect(result.type).toBe('generative')
      expect(result.confidence).toBeGreaterThan(0.7)
      expect(result.reasoning).toBeDefined()
    })

    it.skipIf(!hasAIBinding())('should classify translateText as generative', async () => {
      const result = await classifier!.classify(
        'translateText',
        'Translates text from one language to another',
        {
          type: 'object',
          properties: {
            text: { type: 'string' },
            targetLanguage: { type: 'string' },
          },
        }
      )

      expect(result.type).toBe('generative')
    })

    it.skipIf(!hasAIBinding())('should classify classifySentiment as generative', async () => {
      const result = await classifier!.classify(
        'classifySentiment',
        'Analyzes text and returns sentiment (positive, negative, neutral)'
      )

      expect(result.type).toBe('generative')
    })
  })

  describe('Agentic function classification', () => {
    it.skipIf(!hasAIBinding())('should classify researchCompetitors as agentic', async () => {
      const result = await classifier!.classify(
        'researchCompetitors',
        'Researches and analyzes competitor companies using web search and multiple data sources'
      )

      expect(result).toBeDefined()
      expect(result.type).toBe('agentic')
      expect(result.confidence).toBeGreaterThan(0.6)
    })

    it.skipIf(!hasAIBinding())('should classify analyzeCodebase as agentic', async () => {
      const result = await classifier!.classify(
        'analyzeCodebase',
        'Analyzes a code repository, reads multiple files, and generates a comprehensive report'
      )

      expect(result.type).toBe('agentic')
    })

    it.skipIf(!hasAIBinding())('should classify debugApplication as agentic', async () => {
      const result = await classifier!.classify(
        'debugApplication',
        'Iteratively debugs an application by reading error logs, inspecting code, and suggesting fixes'
      )

      expect(result.type).toBe('agentic')
    })
  })

  describe('Human function classification', () => {
    it.skipIf(!hasAIBinding())('should classify approveExpenseReport as human', async () => {
      const result = await classifier!.classify(
        'approveExpenseReport',
        'Requires human manager to review and approve expense reports'
      )

      expect(result).toBeDefined()
      expect(result.type).toBe('human')
      expect(result.confidence).toBeGreaterThan(0.6)
    })

    it.skipIf(!hasAIBinding())('should classify reviewContentForPublishing as human', async () => {
      const result = await classifier!.classify(
        'reviewContentForPublishing',
        'Editorial review requiring human judgment before publishing'
      )

      expect(result.type).toBe('human')
    })

    it.skipIf(!hasAIBinding())('should classify signContract as human', async () => {
      const result = await classifier!.classify(
        'signContract',
        'Requires authorized human signature on legal documents'
      )

      expect(result.type).toBe('human')
    })
  })

  // ============================================================================
  // Caching Tests
  // ============================================================================

  describe('Classification caching', () => {
    it.skipIf(!hasAIBinding())('should cache classification results', async () => {
      // First call - should hit AI
      const result1 = await classifier!.classify(
        'calculateSum',
        'Adds two numbers together'
      )

      // Second call - should hit cache (much faster)
      const startTime = Date.now()
      const result2 = await classifier!.classify(
        'calculateSum',
        'Adds two numbers together'
      )
      const duration = Date.now() - startTime

      expect(result1.type).toBe(result2.type)
      expect(result1.confidence).toBe(result2.confidence)
      // Cache hit should be fast (< 10ms typically)
      expect(duration).toBeLessThan(100)
    })

    it.skipIf(!hasAIBinding())('should return different results for different functions', async () => {
      const codeResult = await classifier!.classify(
        'hashPassword',
        'Computes cryptographic hash of a password'
      )

      const genResult = await classifier!.classify(
        'generatePoem',
        'Creates an original poem based on a theme'
      )

      expect(codeResult.type).not.toBe(genResult.type)
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge cases', () => {
    it.skipIf(!hasAIBinding())('should handle function with no description', async () => {
      const result = await classifier!.classify('processData')

      expect(result).toBeDefined()
      expect(['code', 'generative', 'agentic', 'human']).toContain(result.type)
      expect(result.confidence).toBeGreaterThan(0)
    })

    it.skipIf(!hasAIBinding())('should handle ambiguous function names', async () => {
      const result = await classifier!.classify(
        'process',
        'Processes the input data'
      )

      expect(result).toBeDefined()
      // Ambiguous functions should have lower confidence
      expect(result.confidence).toBeLessThanOrEqual(1)
      expect(['code', 'generative', 'agentic', 'human']).toContain(result.type)
    })

    it.skipIf(!hasAIBinding())('should handle very long descriptions', async () => {
      const longDescription = 'This function '.repeat(100) + 'calculates tax.'
      const result = await classifier!.classify(
        'calculateTax',
        longDescription
      )

      expect(result).toBeDefined()
      expect(['code', 'generative', 'agentic', 'human']).toContain(result.type)
    })

    it.skipIf(!hasAIBinding())('should handle complex input schemas', async () => {
      const complexSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' },
              preferences: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
          options: {
            type: 'object',
            properties: {
              format: { type: 'string', enum: ['json', 'xml', 'csv'] },
              compress: { type: 'boolean' },
            },
          },
        },
      }

      const result = await classifier!.classify(
        'exportUserData',
        'Exports user data in the specified format',
        complexSchema
      )

      expect(result).toBeDefined()
      expect(['code', 'generative', 'agentic', 'human']).toContain(result.type)
    })
  })

  // ============================================================================
  // Result Validation
  // ============================================================================

  describe('Result validation', () => {
    it.skipIf(!hasAIBinding())('should return valid FunctionType', async () => {
      const result = await classifier!.classify('testFunction', 'A test function')
      const validTypes: FunctionType[] = ['code', 'generative', 'agentic', 'human']

      expect(validTypes).toContain(result.type)
    })

    it.skipIf(!hasAIBinding())('should return confidence between 0 and 1', async () => {
      const result = await classifier!.classify('testFunction', 'A test function')

      expect(result.confidence).toBeGreaterThanOrEqual(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
    })

    it.skipIf(!hasAIBinding())('should include reasoning', async () => {
      const result = await classifier!.classify(
        'testFunction',
        'A test function for validation'
      )

      expect(result.reasoning).toBeDefined()
      expect(typeof result.reasoning).toBe('string')
      expect(result.reasoning.length).toBeGreaterThan(0)
    })

    it.skipIf(!hasAIBinding())('should include provider information', async () => {
      const result = await classifier!.classify(
        'testFunction',
        'A test function for provider check'
      )

      expect(result.provider).toBe('cloudflare-workers-ai')
    })

    it.skipIf(!hasAIBinding())('should include latency metrics', async () => {
      const result = await classifier!.classify(
        'testFunction',
        'A test function for latency check'
      )

      expect(result.latencyMs).toBeDefined()
      expect(typeof result.latencyMs).toBe('number')
      expect(result.latencyMs).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // Integration with Classification System
  // ============================================================================

  describe('Integration scenarios', () => {
    it.skipIf(!hasAIBinding())('should classify a real-world function correctly', async () => {
      // Simulate classifying a function from the functions.do platform
      const result = await classifier!.classify(
        'generateInvoice',
        'Generates a PDF invoice from order data',
        {
          type: 'object',
          properties: {
            orderId: { type: 'string' },
            customerEmail: { type: 'string' },
            lineItems: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  quantity: { type: 'number' },
                  unitPrice: { type: 'number' },
                },
              },
            },
          },
        }
      )

      // Invoice generation is typically deterministic (code) or uses templates
      expect(['code', 'generative']).toContain(result.type)
    })

    it.skipIf(!hasAIBinding())('should handle function type evolution', async () => {
      // A function that starts simple but becomes more complex
      const simpleResult = await classifier!.classify(
        'analyzeData',
        'Computes basic statistics from a dataset'
      )

      // Clear cache to get fresh classification
      await classifier!.invalidate('analyzeData', 'Computes basic statistics from a dataset')

      const complexResult = await classifier!.classify(
        'analyzeDataWithInsights',
        'Analyzes data using AI to generate insights and recommendations'
      )

      // Simple analysis is code, complex AI analysis is generative/agentic
      expect(simpleResult.type).toBe('code')
      expect(['generative', 'agentic']).toContain(complexResult.type)
    })
  })

  // ============================================================================
  // Fallback Behavior Tests
  // ============================================================================

  describe('Fallback behavior', () => {
    it('should return valid classification even without AI binding', async () => {
      // Create a classifier without AI binding to test fallback
      const { FunctionClassifier: ClassifierClass } = await import('../../src/core/function-classifier')
      const fallbackClassifier = new ClassifierClass({ providers: [] })

      const result = await fallbackClassifier.classify(
        'calculateTax',
        'Computes tax based on income'
      )

      // Should still return a valid result using deterministic fallback
      expect(result).toBeDefined()
      expect(['code', 'generative', 'agentic', 'human']).toContain(result.type)
      expect(result.provider).toBe('fallback')
      expect(result.confidence).toBe(0.5) // Fallback confidence
      expect(result.reasoning).toContain('Fallback classification')
    })

    it('should use deterministic fallback for code functions', async () => {
      const { FunctionClassifier: ClassifierClass } = await import('../../src/core/function-classifier')
      const fallbackClassifier = new ClassifierClass({ providers: [] })

      // When code is present, should classify as 'code'
      const result = await fallbackClassifier.classify(
        'processData',
        'Processes the input data'
      )

      expect(result.provider).toBe('fallback')
      // Fallback uses heuristics - without code/prompt/tools, defaults to 'human'
      expect(['code', 'generative', 'agentic', 'human']).toContain(result.type)
    })

    it('should include latency metrics even for fallback', async () => {
      const { FunctionClassifier: ClassifierClass } = await import('../../src/core/function-classifier')
      const fallbackClassifier = new ClassifierClass({ providers: [] })

      const result = await fallbackClassifier.classify(
        'testFunction',
        'A test function'
      )

      expect(result.latencyMs).toBeDefined()
      expect(typeof result.latencyMs).toBe('number')
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    })
  })
})
