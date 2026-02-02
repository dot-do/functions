/**
 * E2E Tests: Generative Function Deploy
 *
 * Tests for deploying generative functions to the functions.do platform.
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
  getGenerativeFunction,
  hasAIKey,
} from './helpers/generative'

const skipIfNoAIKey = !hasAIKey ? it.skip : it

describe.skipIf(!shouldRunE2E())('E2E: Generative Function Deploy', () => {
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

    const fn = await getGenerativeFunction(functionId)
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

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Deploy Error Handling', () => {
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
                type: 'function' as 'string',
              },
            },
            required: ['func'],
          },
        })
      ).rejects.toThrow(/schema|type|unsupported/i)
    }, E2E_CONFIG.deployTimeout)
  })
})
