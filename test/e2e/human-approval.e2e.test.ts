/**
 * E2E Tests: Human Function Approval Flows
 *
 * Tests for approval, rejection, review, selection flows, timeouts, and webhooks.
 */

import { describe, it, expect, afterAll } from 'vitest'
import {
  E2E_CONFIG,
  generateTestFunctionId,
  shouldRunE2E,
  deleteFunction,
} from './config'
import { waitForCondition } from './utils'
import {
  deployHumanFunction,
  invokeHumanFunction,
  getTaskStatus,
  submitTaskResponse,
  cancelTask,
  ApprovalResponse,
  HumanInvokeResult,
  HUMAN_DEPLOY_TIMEOUT,
  HUMAN_INVOKE_TIMEOUT,
  HUMAN_FULL_FLOW_TIMEOUT,
} from './helpers/human'

describe.skipIf(!shouldRunE2E())('E2E: Human Function Approval Flows', () => {
  const deployedFunctions: string[] = []
  const createdTasks: string[] = []

  afterAll(async () => {
    if (!E2E_CONFIG.skipCleanup) {
      for (const taskId of createdTasks) {
        try {
          await cancelTask(taskId)
        } catch {
          // Ignore cleanup errors
        }
      }

      for (const functionId of deployedFunctions) {
        try {
          await deleteFunction(functionId)
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  })

  // ============================================================================
  // Approval Flow
  // ============================================================================

  describe('Approval Flow', () => {
    it('completes approval with approved: true', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Approve Purchase Order',
          description: 'Please approve PO #12345 for $10,000',
          quickActions: [
            { id: 'approve', label: 'Approve', value: { approved: true }, style: 'primary' },
            { id: 'reject', label: 'Reject', value: { approved: false }, style: 'danger' },
          ],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId, {
        poNumber: '12345',
        amount: 10000,
      })
      createdTasks.push(invokeResult.taskId)

      const approvalResponse: ApprovalResponse = {
        approved: true,
        approvedBy: 'manager@example.com',
      }
      await submitTaskResponse(invokeResult.taskId, approvalResponse)

      const finalStatus = await getTaskStatus(invokeResult.taskId)

      expect(finalStatus.status).toBe('completed')
      expect((finalStatus.response as ApprovalResponse).approved).toBe(true)
      expect((finalStatus.response as ApprovalResponse).approvedBy).toBe('manager@example.com')
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('handles approval with additional comments', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Approve with Comment',
          form: [
            { name: 'comment', type: 'textarea', label: 'Comment', required: false },
          ],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const response: ApprovalResponse = {
        approved: true,
        reason: 'Approved with conditions - please follow up next week',
      }
      await submitTaskResponse(invokeResult.taskId, response)

      const finalStatus = await getTaskStatus(invokeResult.taskId)
      expect((finalStatus.response as ApprovalResponse).approved).toBe(true)
      expect((finalStatus.response as ApprovalResponse).reason).toBe(
        'Approved with conditions - please follow up next week'
      )
    }, HUMAN_FULL_FLOW_TIMEOUT)
  })

  // ============================================================================
  // Rejection Flow
  // ============================================================================

  describe('Rejection Flow', () => {
    it('completes approval with approved: false', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Budget Approval',
          description: 'Approve budget request for $50,000',
        },
      })

      const invokeResult = await invokeHumanFunction(functionId, {
        budgetId: 'budget-789',
        amount: 50000,
      })
      createdTasks.push(invokeResult.taskId)

      const rejectionResponse: ApprovalResponse = {
        approved: false,
        reason: 'Budget exceeds departmental limit',
      }
      await submitTaskResponse(invokeResult.taskId, rejectionResponse)

      const finalStatus = await getTaskStatus(invokeResult.taskId)

      expect(finalStatus.status).toBe('completed')
      expect((finalStatus.response as ApprovalResponse).approved).toBe(false)
      expect((finalStatus.response as ApprovalResponse).reason).toBe(
        'Budget exceeds departmental limit'
      )
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('requires reason for rejection when configured', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Rejection Reason Required',
          form: [
            { name: 'reason', type: 'textarea', label: 'Rejection Reason', required: true },
          ],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const rejectionWithoutReason: ApprovalResponse = {
        approved: false,
      }

      await expect(
        submitTaskResponse(invokeResult.taskId, rejectionWithoutReason)
      ).rejects.toThrow(/reason.*required|validation.*failed/i)
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('stores detailed rejection information', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Detailed Rejection',
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const detailedRejection = {
        approved: false,
        reason: 'Multiple issues found',
        issues: [
          { code: 'BUDGET', description: 'Over budget' },
          { code: 'TIMELINE', description: 'Unrealistic timeline' },
        ],
        suggestedChanges: 'Reduce scope and extend timeline by 2 weeks',
      }

      await submitTaskResponse(invokeResult.taskId, detailedRejection)

      const finalStatus = await getTaskStatus(invokeResult.taskId)
      expect(finalStatus.response).toEqual(detailedRejection)
    }, HUMAN_FULL_FLOW_TIMEOUT)
  })

  // ============================================================================
  // Task Timeout
  // ============================================================================

  describe('Task Timeout', () => {
    it('expires task after timeout period', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Short Timeout Test',
        },
        timeout: '10s',
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      expect(invokeResult.expiresAt).toBeDefined()

      await waitForCondition(
        async () => {
          const status = await getTaskStatus(invokeResult.taskId)
          return status.status === 'expired'
        },
        { timeout: 20000, interval: 1000, description: 'task to expire' }
      )

      const taskStatus = await getTaskStatus(invokeResult.taskId)

      expect(taskStatus.status).toBe('expired')
      expect(taskStatus.expiredAt).toBeDefined()
    }, 30_000)

    it('rejects response submission to expired task', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Expired Task Test',
        },
        timeout: '10s',
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      await waitForCondition(
        async () => {
          const status = await getTaskStatus(invokeResult.taskId)
          return status.status === 'expired'
        },
        { timeout: 20000, interval: 1000, description: 'task to expire' }
      )

      await expect(
        submitTaskResponse(invokeResult.taskId, { approved: true })
      ).rejects.toThrow(/expired|cannot.*respond/i)
    }, 30_000)

    it('allows completion before timeout', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Complete Before Timeout',
        },
        timeout: '30s',
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      await submitTaskResponse(invokeResult.taskId, { approved: true })

      const taskStatus = await getTaskStatus(invokeResult.taskId)

      expect(taskStatus.status).toBe('completed')
      expect(taskStatus.expiredAt).toBeUndefined()
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('supports various timeout formats', async () => {
      const functionId1 = generateTestFunctionId()
      const functionId2 = generateTestFunctionId()
      const functionId3 = generateTestFunctionId()
      deployedFunctions.push(functionId1, functionId2, functionId3)

      await deployHumanFunction({
        id: functionId1,
        interactionType: 'approval',
        ui: { title: 'Seconds Timeout' },
        timeout: '60s',
      })

      await deployHumanFunction({
        id: functionId2,
        interactionType: 'approval',
        ui: { title: 'Minutes Timeout' },
        timeout: '30m',
      })

      await deployHumanFunction({
        id: functionId3,
        interactionType: 'approval',
        ui: { title: 'Hours Timeout' },
        timeout: '24h',
      })

      const result1 = await invokeHumanFunction(functionId1)
      const result2 = await invokeHumanFunction(functionId2)
      const result3 = await invokeHumanFunction(functionId3)

      createdTasks.push(result1.taskId, result2.taskId, result3.taskId)

      expect(result1.expiresAt).toBeDefined()
      expect(result2.expiresAt).toBeDefined()
      expect(result3.expiresAt).toBeDefined()

      const now = Date.now()
      const expires1 = new Date(result1.expiresAt!).getTime()
      const expires2 = new Date(result2.expiresAt!).getTime()
      const expires3 = new Date(result3.expiresAt!).getTime()

      expect(expires1 - now).toBeGreaterThan(50 * 1000)
      expect(expires1 - now).toBeLessThan(70 * 1000)

      expect(expires2 - now).toBeGreaterThan(25 * 60 * 1000)
      expect(expires2 - now).toBeLessThan(35 * 60 * 1000)

      expect(expires3 - now).toBeGreaterThan(23 * 60 * 60 * 1000)
      expect(expires3 - now).toBeLessThan(25 * 60 * 60 * 1000)
    }, HUMAN_DEPLOY_TIMEOUT * 3 + HUMAN_INVOKE_TIMEOUT * 3)
  })

  // ============================================================================
  // Webhook Callback
  // ============================================================================

  describe('Webhook Callback', () => {
    it('deploys human function with callback URL', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const callbackUrl = 'https://webhook.site/test-callback-id'

      const result = await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Webhook Test',
        },
        callbackUrl,
      })

      expect(result.id).toBe(functionId)
      expect(result.type).toBe('human')
    }, HUMAN_DEPLOY_TIMEOUT)

    it('task includes callback URL from function config', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const callbackUrl = 'https://webhook.site/test-callback-id'

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Webhook URL Test',
        },
        callbackUrl,
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      expect(invokeResult.callbackUrl).toBeDefined()
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('supports per-invocation callback URL override', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Override Callback Test',
        },
        callbackUrl: 'https://webhook.site/default-callback',
      })

      const response = await fetch(`${E2E_CONFIG.baseUrl}/functions/${functionId}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
        },
        body: JSON.stringify({
          data: { test: true },
          callbackUrl: 'https://webhook.site/override-callback',
        }),
      })

      expect(response.ok).toBe(true)
      const result = (await response.json()) as HumanInvokeResult
      createdTasks.push(result.taskId)

      const taskStatus = await getTaskStatus(result.taskId)
      expect(taskStatus).toBeDefined()
    }, HUMAN_FULL_FLOW_TIMEOUT)
  })

  // ============================================================================
  // Selection Flow
  // ============================================================================

  describe('Selection Flow', () => {
    it('completes with selected option', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'selection',
        ui: {
          title: 'Choose Your Plan',
          description: 'Select a subscription plan',
          quickActions: [
            { id: 'basic', label: 'Basic - $9/mo', value: { plan: 'basic', price: 9 }, style: 'secondary' },
            { id: 'pro', label: 'Pro - $29/mo', value: { plan: 'pro', price: 29 }, style: 'primary' },
            { id: 'enterprise', label: 'Enterprise - Contact Us', value: { plan: 'enterprise', price: null }, style: 'secondary' },
          ],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId, {
        userId: 'user-123',
      })
      createdTasks.push(invokeResult.taskId)

      await submitTaskResponse(invokeResult.taskId, {
        selectedOption: 'pro',
        value: { plan: 'pro', price: 29 },
      })

      const finalStatus = await getTaskStatus(invokeResult.taskId)

      expect(finalStatus.status).toBe('completed')
      expect(finalStatus.response).toEqual({
        selectedOption: 'pro',
        value: { plan: 'pro', price: 29 },
      })
    }, HUMAN_FULL_FLOW_TIMEOUT)
  })

  // ============================================================================
  // Review Flow
  // ============================================================================

  describe('Review Flow', () => {
    it('completes review with detailed feedback', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'review',
        ui: {
          title: 'Code Review Request',
          description: 'Please review the following pull request',
          form: [
            { name: 'status', type: 'select', label: 'Review Status', required: true, options: [
              { label: 'Approve', value: 'approved' },
              { label: 'Request Changes', value: 'changes_requested' },
              { label: 'Comment', value: 'commented' },
            ]},
            { name: 'comments', type: 'textarea', label: 'Comments', required: false },
            { name: 'score', type: 'number', label: 'Code Quality Score (1-10)', required: false },
          ],
          metadata: {
            prUrl: 'https://github.com/org/repo/pull/123',
            author: 'developer@example.com',
          },
        },
      })

      const invokeResult = await invokeHumanFunction(functionId, {
        prId: 'PR-123',
        changedFiles: ['src/index.ts', 'test/index.test.ts'],
        additions: 150,
        deletions: 45,
      })
      createdTasks.push(invokeResult.taskId)

      const reviewResponse = {
        status: 'approved',
        comments: 'LGTM! Great implementation with good test coverage.',
        score: 8,
        reviewedBy: 'senior-dev@example.com',
        reviewedAt: new Date().toISOString(),
      }

      await submitTaskResponse(invokeResult.taskId, reviewResponse)

      const finalStatus = await getTaskStatus(invokeResult.taskId)

      expect(finalStatus.status).toBe('completed')
      expect(finalStatus.response).toMatchObject({
        status: 'approved',
        score: 8,
      })
    }, HUMAN_FULL_FLOW_TIMEOUT)
  })
})
