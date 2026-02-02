/**
 * E2E Tests: Agentic Function Deploy
 *
 * Tests for deploying agentic functions to the functions.do platform.
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
  getAgenticFunction,
  AGENTIC_DEPLOY_TIMEOUT,
} from './helpers/agentic'

describe.skipIf(!shouldRunE2E())('E2E: Agentic Function Deploy', () => {
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

  it('deploys an agentic function with goal and tools', async () => {
    const functionId = generateTestFunctionId()
    deployedFunctions.push(functionId)

    const result = await deployAgenticFunction({
      id: functionId,
      systemPrompt: 'You are a helpful assistant that can perform calculations.',
      goal: 'Help users with mathematical calculations',
      tools: [
        {
          name: 'calculate',
          description: 'Perform a mathematical calculation',
          inputSchema: {
            type: 'object',
            properties: {
              expression: { type: 'string', description: 'Math expression to evaluate' },
            },
            required: ['expression'],
          },
          implementation: {
            type: 'inline',
            code: 'return { result: eval(input.expression) }',
          },
        },
      ],
    })

    expect(result.id).toBe(functionId)
    expect(result.version).toBe('1.0.0')
    expect(result.url).toContain(functionId)
    expect(result.type).toBe('agentic')
  }, AGENTIC_DEPLOY_TIMEOUT)

  it('verifies function type is agentic after deploy', async () => {
    const functionId = generateTestFunctionId()
    deployedFunctions.push(functionId)

    await deployAgenticFunction({
      id: functionId,
      systemPrompt: 'You are a test agent.',
      goal: 'Test goal',
      tools: [],
    })

    const fn = await getAgenticFunction(functionId)

    expect(fn.id).toBe(functionId)
    expect(fn.type).toBe('agentic')
  }, AGENTIC_DEPLOY_TIMEOUT)

  it('deploys agentic function with custom model', async () => {
    const functionId = generateTestFunctionId()
    deployedFunctions.push(functionId)

    const result = await deployAgenticFunction({
      id: functionId,
      model: 'gpt-4o',
      systemPrompt: 'You are a helpful assistant.',
      goal: 'Assist users',
      tools: [],
    })

    expect(result.id).toBe(functionId)

    const fn = await getAgenticFunction(functionId)
    expect(fn.model).toBe('gpt-4o')
  }, AGENTIC_DEPLOY_TIMEOUT)

  it('deploys agentic function with output schema', async () => {
    const functionId = generateTestFunctionId()
    deployedFunctions.push(functionId)

    const outputSchema = {
      type: 'object' as const,
      properties: {
        summary: { type: 'string' },
        confidence: { type: 'number' },
      },
      required: ['summary'],
    }

    const result = await deployAgenticFunction({
      id: functionId,
      systemPrompt: 'You are a summarization agent.',
      goal: 'Summarize the given content',
      tools: [],
      outputSchema,
    })

    expect(result.id).toBe(functionId)

    const fn = await getAgenticFunction(functionId)
    expect(fn.outputSchema).toEqual(outputSchema)
  }, AGENTIC_DEPLOY_TIMEOUT)
})
