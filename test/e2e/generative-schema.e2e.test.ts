/**
 * E2E Tests: Generative Function Structured Output
 *
 * Tests for structured output generation with various JSON schema types.
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
  hasAIKey,
  DEPLOY_AND_INVOKE_TIMEOUT,
} from './helpers/generative'

const skipIfNoAIKey = !hasAIKey ? it.skip : it

describe.skipIf(!shouldRunE2E())('E2E: Generative Function Structured Output', () => {
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
  // Basic Schema Types
  // ===========================================================================

  describe('Basic Schema Types', () => {
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
  })

  // ===========================================================================
  // Nested Objects
  // ===========================================================================

  describe('Nested Objects', () => {
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
  })

  // ===========================================================================
  // Array Schemas
  // ===========================================================================

  describe('Array Schemas', () => {
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
  })

  // ===========================================================================
  // Enum Constraints
  // ===========================================================================

  describe('Enum Constraints', () => {
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
  })

  // ===========================================================================
  // Complex Mixed Schemas
  // ===========================================================================

  describe('Complex Mixed Schemas', () => {
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
})
