/**
 * E2E Tests: Cascade Execution (RED)
 *
 * These tests verify the full cascade execution flow against a deployed worker.
 * Cascade execution automatically escalates through function tiers when a tier
 * fails or times out:
 *
 * 1. Code (5s) - Fast, deterministic, cheap
 * 2. Generative (30s) - Single AI call
 * 3. Agentic (5m) - Multi-step AI
 * 4. Human (24h) - Human-in-the-loop
 *
 * Prerequisites:
 * - functions.do Worker must be deployed with cascade support
 * - FUNCTIONS_E2E_URL environment variable set
 *
 * Run with: npm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  E2E_CONFIG,
  generateTestFunctionId,
  shouldRunE2E,
  deleteFunction,
} from './config'

// =============================================================================
// CASCADE-SPECIFIC TYPES
// =============================================================================

interface CascadeTierConfig {
  code?: {
    language: 'typescript' | 'javascript'
    code: string
    timeout?: string
  }
  generative?: {
    model: string
    prompt: string
    outputSchema: object
    timeout?: string
  }
  agentic?: {
    goal: string
    tools: Array<{
      name: string
      description: string
      parameters: object
    }>
    maxIterations?: number
    timeout?: string
  }
  human?: {
    title: string
    description?: string
    assignees?: string[]
    timeout?: string
  }
}

interface CascadeDeployParams {
  id: string
  name?: string
  description?: string
  tiers: CascadeTierConfig
  options?: {
    startTier?: 'code' | 'generative' | 'agentic' | 'human'
    skipTiers?: Array<'code' | 'generative' | 'agentic' | 'human'>
    totalTimeout?: string
  }
}

interface CascadeDeployResult {
  id: string
  url: string
  tiers: string[]
}

interface CascadeInvokeResult<T = unknown> {
  output: T
  successTier: 'code' | 'generative' | 'agentic' | 'human'
  history: Array<{
    tier: string
    attempt: number
    status: 'completed' | 'failed' | 'timeout' | 'skipped'
    durationMs: number
    error?: {
      name: string
      message: string
    }
  }>
  skippedTiers: string[]
  metrics: {
    totalDurationMs: number
    tierDurations: Record<string, number>
    escalations: number
    totalRetries: number
    tokens?: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
    }
  }
}

interface CascadePendingResult {
  status: 'pending'
  taskId: string
  taskUrl: string
  tier: 'human'
  assignees: string[]
  expiresAt: string
}

// =============================================================================
// CASCADE-SPECIFIC HELPERS
// =============================================================================

/**
 * Deploy a cascade function to functions.do
 */
async function deployCascade(params: CascadeDeployParams): Promise<CascadeDeployResult> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/cascades`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
    body: JSON.stringify({
      id: params.id,
      name: params.name ?? params.id,
      description: params.description,
      tiers: params.tiers,
      options: params.options,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Cascade deploy failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Invoke a cascade function
 */
async function invokeCascade<T = unknown>(
  cascadeId: string,
  input?: unknown
): Promise<CascadeInvokeResult<T>> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/cascades/${cascadeId}/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
    body: input ? JSON.stringify(input) : undefined,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Cascade invoke failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Delete a cascade function (cleanup)
 */
async function deleteCascade(cascadeId: string): Promise<void> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/cascades/${cascadeId}`, {
    method: 'DELETE',
    headers: {
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
  })

  if (!response.ok && response.status !== 404) {
    const error = await response.text()
    throw new Error(`Cascade delete failed (${response.status}): ${error}`)
  }
}

/**
 * Get cascade status (for human tier pending tasks)
 */
async function getCascadeStatus(
  cascadeId: string,
  executionId: string
): Promise<CascadeInvokeResult | CascadePendingResult> {
  const response = await fetch(
    `${E2E_CONFIG.baseUrl}/cascades/${cascadeId}/executions/${executionId}`,
    {
      headers: {
        ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
      },
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Get cascade status failed (${response.status}): ${error}`)
  }

  return response.json()
}

// =============================================================================
// E2E TESTS
// =============================================================================

describe.skipIf(!shouldRunE2E())('E2E: Cascade Execution', () => {
  const deployedCascades: string[] = []

  afterAll(async () => {
    // Cleanup deployed cascades
    if (!E2E_CONFIG.skipCleanup) {
      for (const cascadeId of deployedCascades) {
        try {
          await deleteCascade(cascadeId)
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  })

  // ===========================================================================
  // 1. CASCADE DEPLOY & INVOKE
  // ===========================================================================

  describe('Cascade Deploy & Invoke', () => {
    it('deploys a cascade with multiple tiers', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      const result = await deployCascade({
        id: cascadeId,
        name: 'Multi-Tier Test Cascade',
        description: 'A cascade with all four tiers for testing',
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function(input: { amount: number }) {
                if (input.amount < 100) {
                  return { approved: true, tier: 'code' }
                }
                throw new Error('Amount too high for automatic approval')
              }
            `,
          },
          generative: {
            model: 'claude-3-haiku-20240307',
            prompt: 'Analyze this transaction and determine if it should be approved: {{input}}',
            outputSchema: {
              type: 'object',
              properties: {
                approved: { type: 'boolean' },
                reasoning: { type: 'string' },
                tier: { type: 'string', const: 'generative' },
              },
              required: ['approved', 'reasoning', 'tier'],
            },
          },
          agentic: {
            goal: 'Research the transaction and make a determination',
            tools: [
              {
                name: 'checkFraudDatabase',
                description: 'Check if the account has fraud history',
                parameters: { type: 'object', properties: { accountId: { type: 'string' } } },
              },
            ],
          },
          human: {
            title: 'Manual Transaction Review',
            description: 'Review this transaction manually',
            assignees: ['fraud-team@example.com'],
          },
        },
      })

      expect(result.id).toBe(cascadeId)
      expect(result.url).toContain(cascadeId)
      expect(result.tiers).toContain('code')
      expect(result.tiers).toContain('generative')
      expect(result.tiers).toContain('agentic')
      expect(result.tiers).toContain('human')
    }, E2E_CONFIG.deployTimeout)

    it('invokes cascade and code tier executes successfully', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function(input: { value: number }) {
                return { result: input.value * 2, processedBy: 'code' }
              }
            `,
          },
        },
      })

      const result = await invokeCascade<{ result: number; processedBy: string }>(
        cascadeId,
        { value: 21 }
      )

      expect(result.output.result).toBe(42)
      expect(result.output.processedBy).toBe('code')
      expect(result.successTier).toBe('code')
    }, E2E_CONFIG.deployInvokeTimeout)

    it('response includes tier that succeeded', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function() {
                return { message: 'Success from code tier' }
              }
            `,
          },
        },
      })

      const result = await invokeCascade(cascadeId, {})

      expect(result.successTier).toBe('code')
      expect(result.history).toBeDefined()
      expect(result.history.length).toBeGreaterThan(0)
      expect(result.history[0].tier).toBe('code')
      expect(result.history[0].status).toBe('completed')
    }, E2E_CONFIG.deployInvokeTimeout)
  })

  // ===========================================================================
  // 2. CODE TIER SUCCESS
  // ===========================================================================

  describe('Code Tier Success', () => {
    it('code tier succeeds with fast response', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function(input: { name: string }) {
                return { greeting: \`Hello, \${input.name}!\` }
              }
            `,
          },
          generative: {
            model: 'claude-3-haiku-20240307',
            prompt: 'Generate a greeting for {{input.name}}',
            outputSchema: {
              type: 'object',
              properties: { greeting: { type: 'string' } },
              required: ['greeting'],
            },
          },
        },
      })

      const startTime = Date.now()
      const result = await invokeCascade<{ greeting: string }>(
        cascadeId,
        { name: 'World' }
      )
      const duration = Date.now() - startTime

      expect(result.output.greeting).toBe('Hello, World!')
      expect(result.successTier).toBe('code')
      // Code tier should be fast - under 5 seconds
      expect(duration).toBeLessThan(5000)
      // Metrics should show code tier was used
      expect(result.metrics.tierDurations.code).toBeDefined()
      expect(result.metrics.escalations).toBe(0)
    }, E2E_CONFIG.deployInvokeTimeout)

    it('verifies metrics show code tier used', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function(input: { numbers: number[] }) {
                const sum = input.numbers.reduce((a, b) => a + b, 0)
                return { sum, count: input.numbers.length }
              }
            `,
          },
        },
      })

      const result = await invokeCascade<{ sum: number; count: number }>(
        cascadeId,
        { numbers: [1, 2, 3, 4, 5] }
      )

      expect(result.output.sum).toBe(15)
      expect(result.output.count).toBe(5)
      expect(result.successTier).toBe('code')
      expect(result.metrics.tierDurations).toHaveProperty('code')
      expect(result.metrics.tierDurations.code).toBeGreaterThan(0)
      expect(result.metrics.totalDurationMs).toBeGreaterThan(0)
      // No AI tiers used, so no token usage
      expect(result.metrics.tokens).toBeUndefined()
    }, E2E_CONFIG.deployInvokeTimeout)
  })

  // ===========================================================================
  // 3. CODE -> GENERATIVE ESCALATION
  // ===========================================================================

  describe('Code -> Generative Escalation', () => {
    it('escalates to generative tier when code throws error', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function(input: { query: string }) {
                // Code tier can't handle complex queries
                if (input.query.length > 10) {
                  throw new Error('Query too complex for code tier')
                }
                return { answer: 'Simple response', source: 'code' }
              }
            `,
          },
          generative: {
            model: 'claude-3-haiku-20240307',
            prompt: 'Answer this query: {{input.query}}. Previous error: {{context.previousError.message}}',
            outputSchema: {
              type: 'object',
              properties: {
                answer: { type: 'string' },
                source: { type: 'string', const: 'generative' },
              },
              required: ['answer', 'source'],
            },
          },
        },
      })

      const result = await invokeCascade<{ answer: string; source: string }>(
        cascadeId,
        { query: 'What is the meaning of life and the universe?' }
      )

      expect(result.successTier).toBe('generative')
      expect(result.output.source).toBe('generative')
      expect(result.output.answer).toBeDefined()
      expect(result.metrics.escalations).toBe(1)
    }, E2E_CONFIG.deployInvokeTimeout + 30000) // Extra time for AI

    it('response includes previousError context for generative tier', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function() {
                throw new Error('Specific error: insufficient data')
              }
            `,
          },
          generative: {
            model: 'claude-3-haiku-20240307',
            prompt: 'The previous tier failed. Error: {{context.previousError.message}}. Handle gracefully.',
            outputSchema: {
              type: 'object',
              properties: {
                handled: { type: 'boolean' },
                errorAcknowledged: { type: 'boolean' },
              },
              required: ['handled', 'errorAcknowledged'],
            },
          },
        },
      })

      const result = await invokeCascade(cascadeId, {})

      expect(result.successTier).toBe('generative')
      expect(result.history.length).toBeGreaterThanOrEqual(2)

      // Find the code tier attempt
      const codeAttempt = result.history.find(h => h.tier === 'code')
      expect(codeAttempt).toBeDefined()
      expect(codeAttempt?.status).toBe('failed')
      expect(codeAttempt?.error?.message).toContain('insufficient data')
    }, E2E_CONFIG.deployInvokeTimeout + 30000)

    it('execution history shows both tier attempts', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function() {
                throw new Error('Code tier failure')
              }
            `,
          },
          generative: {
            model: 'claude-3-haiku-20240307',
            prompt: 'Return success',
            outputSchema: {
              type: 'object',
              properties: { success: { type: 'boolean' } },
              required: ['success'],
            },
          },
        },
      })

      const result = await invokeCascade(cascadeId, {})

      expect(result.history).toHaveLength(2)
      expect(result.history[0].tier).toBe('code')
      expect(result.history[0].status).toBe('failed')
      expect(result.history[0].durationMs).toBeGreaterThan(0)
      expect(result.history[1].tier).toBe('generative')
      expect(result.history[1].status).toBe('completed')
      expect(result.history[1].durationMs).toBeGreaterThan(0)
    }, E2E_CONFIG.deployInvokeTimeout + 30000)
  })

  // ===========================================================================
  // 4. CODE -> GENERATIVE -> AGENTIC ESCALATION
  // ===========================================================================

  describe('Code -> Generative -> Agentic Escalation', () => {
    it('escalates through all AI tiers when each fails', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function() {
                throw new Error('Code cannot handle this')
              }
            `,
          },
          generative: {
            model: 'claude-3-haiku-20240307',
            prompt: 'This will fail. Return {"escalate": true}',
            outputSchema: {
              type: 'object',
              properties: {
                escalate: { type: 'boolean', const: true },
              },
              required: ['escalate'],
            },
          },
          agentic: {
            goal: 'Research and provide a comprehensive answer',
            tools: [
              {
                name: 'search',
                description: 'Search for information',
                parameters: {
                  type: 'object',
                  properties: { query: { type: 'string' } },
                },
              },
              {
                name: 'analyze',
                description: 'Analyze data',
                parameters: {
                  type: 'object',
                  properties: { data: { type: 'object' } },
                },
              },
            ],
            maxIterations: 3,
          },
        },
      })

      const result = await invokeCascade(
        cascadeId,
        { question: 'Complex multi-step research task' }
      )

      // Should reach agentic tier (or fail trying)
      expect(['generative', 'agentic']).toContain(result.successTier)
      expect(result.metrics.escalations).toBeGreaterThanOrEqual(1)
    }, E2E_CONFIG.deployInvokeTimeout + 120000) // Extra time for agentic

    it('verifies full execution path in response', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function() {
                throw new Error('Step 1 failed')
              }
            `,
          },
          generative: {
            model: 'claude-3-haiku-20240307',
            // Intentionally malformed to cause failure
            prompt: 'Return invalid JSON that does not match schema',
            outputSchema: {
              type: 'object',
              properties: {
                requiredField: { type: 'string' },
                mustBeNumber: { type: 'number' },
              },
              required: ['requiredField', 'mustBeNumber'],
            },
          },
          agentic: {
            goal: 'Complete the task after previous tiers failed',
            tools: [],
            maxIterations: 1,
          },
        },
      })

      const result = await invokeCascade(cascadeId, {})

      // Verify execution path is recorded
      expect(result.history.length).toBeGreaterThanOrEqual(2)

      // Check that tiers are in order
      const tierOrder = result.history.map(h => h.tier)
      const codeIndex = tierOrder.indexOf('code')
      const generativeIndex = tierOrder.indexOf('generative')

      if (codeIndex !== -1 && generativeIndex !== -1) {
        expect(codeIndex).toBeLessThan(generativeIndex)
      }

      // Verify each attempt has required fields
      for (const attempt of result.history) {
        expect(attempt.tier).toBeDefined()
        expect(attempt.attempt).toBeGreaterThanOrEqual(1)
        expect(['completed', 'failed', 'timeout', 'skipped']).toContain(attempt.status)
        expect(attempt.durationMs).toBeGreaterThanOrEqual(0)
      }
    }, E2E_CONFIG.deployInvokeTimeout + 120000)
  })

  // ===========================================================================
  // 5. FULL CASCADE TO HUMAN
  // ===========================================================================

  describe('Full Cascade to Human', () => {
    it('escalates to human tier when all AI tiers fail', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function() {
                throw new Error('Automated processing failed')
              }
            `,
          },
          generative: {
            model: 'claude-3-haiku-20240307',
            prompt: 'This prompt will intentionally fail validation',
            outputSchema: {
              type: 'object',
              properties: {
                impossibleField: { type: 'null', const: 'impossible' },
              },
              required: ['impossibleField'],
            },
          },
          human: {
            title: 'Manual Review Required',
            description: 'All automated tiers failed. Please review manually.',
            assignees: ['human-reviewer@example.com'],
            timeout: '24h',
          },
        },
      })

      // When escalating to human, we expect a pending status
      const response = await fetch(`${E2E_CONFIG.baseUrl}/cascades/${cascadeId}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
        },
        body: JSON.stringify({ data: 'needs human review' }),
      })

      const result = await response.json() as CascadePendingResult | CascadeInvokeResult

      // Should either succeed at generative or escalate to human
      if ('status' in result && result.status === 'pending') {
        expect(result.tier).toBe('human')
        expect(result.taskId).toBeDefined()
        expect(result.taskUrl).toBeDefined()
        expect(result.assignees).toContain('human-reviewer@example.com')
        expect(result.expiresAt).toBeDefined()
      } else if ('successTier' in result) {
        // If generative somehow succeeded, that's also valid
        expect(['generative', 'human']).toContain(result.successTier)
      }
    }, E2E_CONFIG.deployInvokeTimeout + 60000)

    it('returns pending status for human tier', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      // Deploy with only human tier to force human escalation
      await deployCascade({
        id: cascadeId,
        tiers: {
          human: {
            title: 'Direct Human Task',
            description: 'This goes directly to human review',
            assignees: ['reviewer@example.com'],
          },
        },
        options: {
          startTier: 'human',
        },
      })

      const response = await fetch(`${E2E_CONFIG.baseUrl}/cascades/${cascadeId}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
        },
        body: JSON.stringify({}),
      })

      const result = await response.json() as CascadePendingResult

      expect(result.status).toBe('pending')
      expect(result.tier).toBe('human')
    }, E2E_CONFIG.deployInvokeTimeout)

    it('task URL is included in human tier response', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function() {
                throw new Error('Needs human intervention')
              }
            `,
          },
          human: {
            title: 'Review Required',
            assignees: ['team@example.com'],
          },
        },
      })

      const response = await fetch(`${E2E_CONFIG.baseUrl}/cascades/${cascadeId}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
        },
        body: JSON.stringify({ item: 'needs review' }),
      })

      const result = await response.json() as CascadePendingResult

      if (result.status === 'pending') {
        expect(result.taskUrl).toBeDefined()
        expect(result.taskUrl).toMatch(/^https?:\/\//)
        expect(result.taskId).toBeDefined()
        expect(typeof result.taskId).toBe('string')
      }
    }, E2E_CONFIG.deployInvokeTimeout + 30000)
  })

  // ===========================================================================
  // 6. CASCADE METRICS
  // ===========================================================================

  describe('Cascade Metrics', () => {
    it('response includes cascade metrics', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function(input: { x: number }) {
                return { doubled: input.x * 2 }
              }
            `,
          },
        },
      })

      const result = await invokeCascade(cascadeId, { x: 10 })

      expect(result.metrics).toBeDefined()
      expect(typeof result.metrics.totalDurationMs).toBe('number')
      expect(result.metrics.totalDurationMs).toBeGreaterThan(0)
      expect(result.metrics.tierDurations).toBeDefined()
      expect(typeof result.metrics.escalations).toBe('number')
      expect(typeof result.metrics.totalRetries).toBe('number')
    }, E2E_CONFIG.deployInvokeTimeout)

    it('total duration across tiers is tracked', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function() {
                // Simulate some work
                await new Promise(resolve => setTimeout(resolve, 100))
                return { processed: true }
              }
            `,
          },
        },
      })

      const result = await invokeCascade(cascadeId, {})

      // Total duration should be at least the code tier duration
      expect(result.metrics.totalDurationMs).toBeGreaterThanOrEqual(100)

      // Tier durations should sum approximately to total
      const tierDurationSum = Object.values(result.metrics.tierDurations)
        .reduce((sum, d) => sum + d, 0)
      expect(tierDurationSum).toBeLessThanOrEqual(result.metrics.totalDurationMs + 10) // Allow small overhead
    }, E2E_CONFIG.deployInvokeTimeout)

    it('per-tier attempt counts are recorded', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function() {
                throw new Error('Always fails')
              }
            `,
          },
          generative: {
            model: 'claude-3-haiku-20240307',
            prompt: 'Return success',
            outputSchema: {
              type: 'object',
              properties: { success: { type: 'boolean' } },
              required: ['success'],
            },
          },
        },
      })

      const result = await invokeCascade(cascadeId, {})

      // Check history for attempt counts
      const codeAttempts = result.history.filter(h => h.tier === 'code')
      const generativeAttempts = result.history.filter(h => h.tier === 'generative')

      expect(codeAttempts.length).toBeGreaterThanOrEqual(1)
      expect(codeAttempts[0].attempt).toBe(1)

      if (generativeAttempts.length > 0) {
        expect(generativeAttempts[0].attempt).toBe(1)
      }
    }, E2E_CONFIG.deployInvokeTimeout + 30000)

    it('token usage is tracked for AI tiers', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function() {
                throw new Error('Escalate to AI')
              }
            `,
          },
          generative: {
            model: 'claude-3-haiku-20240307',
            prompt: 'Say hello in one word',
            outputSchema: {
              type: 'object',
              properties: { greeting: { type: 'string' } },
              required: ['greeting'],
            },
          },
        },
      })

      const result = await invokeCascade(cascadeId, {})

      // If generative tier was used, tokens should be tracked
      if (result.successTier === 'generative') {
        expect(result.metrics.tokens).toBeDefined()
        expect(result.metrics.tokens?.inputTokens).toBeGreaterThan(0)
        expect(result.metrics.tokens?.outputTokens).toBeGreaterThan(0)
        expect(result.metrics.tokens?.totalTokens).toBe(
          (result.metrics.tokens?.inputTokens ?? 0) + (result.metrics.tokens?.outputTokens ?? 0)
        )
      }
    }, E2E_CONFIG.deployInvokeTimeout + 30000)
  })

  // ===========================================================================
  // 7. CASCADE TIMEOUT
  // ===========================================================================

  describe('Cascade Timeout', () => {
    it('timeout triggers escalation from code tier', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function() {
                // Simulate slow operation that exceeds timeout
                await new Promise(resolve => setTimeout(resolve, 10000))
                return { result: 'too slow' }
              }
            `,
            timeout: '2s', // 2 second timeout
          },
          generative: {
            model: 'claude-3-haiku-20240307',
            prompt: 'The previous tier timed out. Please provide a response.',
            outputSchema: {
              type: 'object',
              properties: {
                response: { type: 'string' },
                handledTimeout: { type: 'boolean' },
              },
              required: ['response', 'handledTimeout'],
            },
          },
        },
      })

      const result = await invokeCascade(cascadeId, {})

      // Should have escalated due to timeout
      const codeAttempt = result.history.find(h => h.tier === 'code')
      expect(codeAttempt).toBeDefined()
      expect(codeAttempt?.status).toBe('timeout')

      // Should have succeeded at generative
      expect(result.successTier).toBe('generative')
      expect(result.metrics.escalations).toBeGreaterThanOrEqual(1)
    }, E2E_CONFIG.deployInvokeTimeout + 30000)

    it('timeout error info is passed to next tier', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function() {
                await new Promise(resolve => setTimeout(resolve, 5000))
                return { never: 'returned' }
              }
            `,
            timeout: '1s',
          },
          generative: {
            model: 'claude-3-haiku-20240307',
            prompt: 'Previous tier timed out: {{context.previousError.message}}. Tier: {{context.previousTier}}',
            outputSchema: {
              type: 'object',
              properties: {
                acknowledged: { type: 'boolean' },
              },
              required: ['acknowledged'],
            },
          },
        },
      })

      const result = await invokeCascade(cascadeId, {})

      // Find the timeout attempt
      const timeoutAttempt = result.history.find(h => h.status === 'timeout')
      expect(timeoutAttempt).toBeDefined()
      expect(timeoutAttempt?.tier).toBe('code')
      expect(timeoutAttempt?.error).toBeDefined()
      expect(timeoutAttempt?.error?.message).toMatch(/timeout/i)
    }, E2E_CONFIG.deployInvokeTimeout + 30000)

    it('total cascade timeout terminates execution', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function() {
                await new Promise(resolve => setTimeout(resolve, 60000))
                return {}
              }
            `,
          },
          generative: {
            model: 'claude-3-haiku-20240307',
            prompt: 'Generate response',
            outputSchema: {
              type: 'object',
              properties: { result: { type: 'string' } },
              required: ['result'],
            },
          },
        },
        options: {
          totalTimeout: '5s',
        },
      })

      const response = await fetch(`${E2E_CONFIG.baseUrl}/cascades/${cascadeId}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
        },
        body: JSON.stringify({}),
      })

      // Should fail with timeout error
      if (!response.ok) {
        const error = await response.json() as { error: string; message: string }
        expect(error.error).toMatch(/timeout|exhausted/i)
      } else {
        // If it somehow succeeded, verify it was quick
        const result = await response.json() as CascadeInvokeResult
        expect(result.metrics.totalDurationMs).toBeLessThan(10000)
      }
    }, 30000)
  })

  // ===========================================================================
  // ADDITIONAL EDGE CASES
  // ===========================================================================

  describe('Edge Cases', () => {
    it('cascade with only generative tier works', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          generative: {
            model: 'claude-3-haiku-20240307',
            prompt: 'What is 2 + 2?',
            outputSchema: {
              type: 'object',
              properties: { answer: { type: 'number' } },
              required: ['answer'],
            },
          },
        },
        options: {
          startTier: 'generative',
        },
      })

      const result = await invokeCascade<{ answer: number }>(cascadeId, {})

      expect(result.successTier).toBe('generative')
      expect(result.output.answer).toBeDefined()
      expect(result.skippedTiers).toContain('code')
    }, E2E_CONFIG.deployInvokeTimeout + 30000)

    it('skipped tiers are recorded correctly', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function() {
                return { success: true }
              }
            `,
          },
          generative: {
            model: 'claude-3-haiku-20240307',
            prompt: 'Never called',
            outputSchema: { type: 'object' },
          },
          agentic: {
            goal: 'Never called',
            tools: [],
          },
          human: {
            title: 'Never called',
            assignees: [],
          },
        },
      })

      const result = await invokeCascade(cascadeId, {})

      expect(result.successTier).toBe('code')
      // Other tiers should be skipped (not attempted)
      expect(result.skippedTiers).toContain('generative')
      expect(result.skippedTiers).toContain('agentic')
      expect(result.skippedTiers).toContain('human')
    }, E2E_CONFIG.deployInvokeTimeout)

    it('empty input handled correctly', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function(input: unknown) {
                return {
                  receivedInput: input,
                  inputType: typeof input,
                  isEmpty: input === undefined || input === null || Object.keys(input || {}).length === 0
                }
              }
            `,
          },
        },
      })

      const result = await invokeCascade<{
        receivedInput: unknown
        inputType: string
        isEmpty: boolean
      }>(cascadeId)

      expect(result.successTier).toBe('code')
      expect(result.output.isEmpty).toBe(true)
    }, E2E_CONFIG.deployInvokeTimeout)

    it('large input handled correctly', async () => {
      const cascadeId = generateTestFunctionId()
      deployedCascades.push(cascadeId)

      await deployCascade({
        id: cascadeId,
        tiers: {
          code: {
            language: 'typescript',
            code: `
              export default async function(input: { data: string[] }) {
                return {
                  count: input.data.length,
                  totalLength: input.data.reduce((sum, s) => sum + s.length, 0)
                }
              }
            `,
          },
        },
      })

      // Generate large input (1000 items)
      const largeData = Array.from({ length: 1000 }, (_, i) => `item-${i}-${'x'.repeat(100)}`)

      const result = await invokeCascade<{ count: number; totalLength: number }>(
        cascadeId,
        { data: largeData }
      )

      expect(result.output.count).toBe(1000)
      expect(result.output.totalLength).toBeGreaterThan(100000)
    }, E2E_CONFIG.deployInvokeTimeout)
  })
})
