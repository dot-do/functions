/**
 * E2E Tests: Human Function Deploy and Invoke
 *
 * Tests for deploying human functions and basic invocation/polling.
 */

import { describe, it, expect, afterAll } from 'vitest'
import {
  E2E_CONFIG,
  generateTestFunctionId,
  shouldRunE2E,
  deleteFunction,
} from './config'
import {
  deployHumanFunction,
  invokeHumanFunction,
  getTaskStatus,
  cancelTask,
  listTasks,
  submitTaskResponse,
  HumanFunctionUI,
  HumanInteractionType,
  HUMAN_DEPLOY_TIMEOUT,
  HUMAN_INVOKE_TIMEOUT,
  HUMAN_FULL_FLOW_TIMEOUT,
} from './helpers/human'

describe.skipIf(!shouldRunE2E())('E2E: Human Function Deploy', () => {
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
  // Human Function Deploy
  // ============================================================================

  describe('Human Function Deploy', () => {
    it('deploys a human function with UI definition', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const result = await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Approve Request',
          description: 'Please review and approve this request',
        },
      })

      expect(result.id).toBe(functionId)
      expect(result.version).toBe('1.0.0')
      expect(result.url).toContain(functionId)
      expect(result.type).toBe('human')
      expect(result.interactionType).toBe('approval')
    }, HUMAN_DEPLOY_TIMEOUT)

    it('deploys a human function with form fields', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const result = await deployHumanFunction({
        id: functionId,
        interactionType: 'input',
        ui: {
          title: 'User Feedback',
          description: 'Please provide your feedback',
          form: [
            { name: 'name', type: 'text', label: 'Your Name', required: true },
            { name: 'email', type: 'email', label: 'Email Address', required: true },
            { name: 'feedback', type: 'textarea', label: 'Feedback', required: true },
            { name: 'rating', type: 'select', label: 'Rating', options: [
              { label: '5 - Excellent', value: '5' },
              { label: '4 - Good', value: '4' },
              { label: '3 - Average', value: '3' },
              { label: '2 - Poor', value: '2' },
              { label: '1 - Very Poor', value: '1' },
            ]},
          ],
        },
      })

      expect(result.id).toBe(functionId)
      expect(result.type).toBe('human')
      expect(result.interactionType).toBe('input')
    }, HUMAN_DEPLOY_TIMEOUT)

    it('deploys a human function with quick actions', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const result = await deployHumanFunction({
        id: functionId,
        interactionType: 'selection',
        ui: {
          title: 'Select Option',
          description: 'Choose one of the following options',
          quickActions: [
            { id: 'option-a', label: 'Option A', value: 'a', style: 'primary' },
            { id: 'option-b', label: 'Option B', value: 'b', style: 'secondary' },
            { id: 'option-c', label: 'Option C', value: 'c', style: 'secondary' },
            { id: 'cancel', label: 'Cancel', value: null, style: 'danger' },
          ],
        },
      })

      expect(result.id).toBe(functionId)
      expect(result.type).toBe('human')
      expect(result.interactionType).toBe('selection')
    }, HUMAN_DEPLOY_TIMEOUT)

    it('deploys a human function with timeout', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const result = await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Time-sensitive Approval',
          description: 'This request expires in 1 hour',
        },
        timeout: '1h',
      })

      expect(result.id).toBe(functionId)
      expect(result.type).toBe('human')
    }, HUMAN_DEPLOY_TIMEOUT)

    it('deploys a human function with assigned user', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const result = await deployHumanFunction({
        id: functionId,
        interactionType: 'review',
        ui: {
          title: 'Code Review',
          description: 'Please review the following code changes',
        },
        assignee: 'reviewer@example.com',
      })

      expect(result.id).toBe(functionId)
      expect(result.type).toBe('human')
      expect(result.interactionType).toBe('review')
    }, HUMAN_DEPLOY_TIMEOUT)

    it('rejects human function with invalid interaction type', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await expect(
        deployHumanFunction({
          id: functionId,
          interactionType: 'invalid' as HumanInteractionType,
          ui: {
            title: 'Invalid',
          },
        })
      ).rejects.toThrow(/invalid.*interaction.*type/i)
    }, HUMAN_DEPLOY_TIMEOUT)

    it('rejects human function without UI definition', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await expect(
        deployHumanFunction({
          id: functionId,
          interactionType: 'approval',
          ui: undefined as unknown as HumanFunctionUI,
        })
      ).rejects.toThrow(/ui.*required/i)
    }, HUMAN_DEPLOY_TIMEOUT)
  })

  // ============================================================================
  // Invoke Returns Pending
  // ============================================================================

  describe('Invoke Returns Pending', () => {
    it('returns pending status when human function is invoked', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Test Approval',
          description: 'Test approval request',
        },
      })

      const result = await invokeHumanFunction(functionId, { requestId: '123' })
      createdTasks.push(result.taskId)

      expect(result.status).toBe('pending')
      expect(result.taskId).toBeDefined()
      expect(result.taskId).toMatch(/^[a-zA-Z0-9-_]+$/)
      expect(result.taskUrl).toBeDefined()
      expect(result.taskUrl).toContain(result.taskId)
      expect(result.callbackUrl).toBeDefined()
      expect(result.callbackUrl).toContain(result.taskId)
    }, HUMAN_INVOKE_TIMEOUT + HUMAN_DEPLOY_TIMEOUT)

    it('includes expiration time when timeout is set', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Expiring Approval',
        },
        timeout: '30m',
      })

      const result = await invokeHumanFunction(functionId)
      createdTasks.push(result.taskId)

      expect(result.status).toBe('pending')
      expect(result.expiresAt).toBeDefined()
      const expiresAt = new Date(result.expiresAt!)
      const now = new Date()
      expect(expiresAt.getTime() - now.getTime()).toBeGreaterThan(25 * 60 * 1000)
      expect(expiresAt.getTime() - now.getTime()).toBeLessThan(35 * 60 * 1000)
    }, HUMAN_INVOKE_TIMEOUT + HUMAN_DEPLOY_TIMEOUT)

    it('passes invocation data to task', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'review',
        ui: {
          title: 'Review Request',
        },
      })

      const invocationData = {
        documentId: 'doc-456',
        submitter: 'user@example.com',
        priority: 'high',
      }

      const result = await invokeHumanFunction(functionId, invocationData)
      createdTasks.push(result.taskId)

      expect(result.status).toBe('pending')

      const taskStatus = await getTaskStatus(result.taskId)
      expect(taskStatus.invocationData).toEqual(invocationData)
    }, HUMAN_INVOKE_TIMEOUT + HUMAN_DEPLOY_TIMEOUT)

    it('creates unique tasks for multiple invocations', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Multi-Invoke Test',
        },
      })

      const result1 = await invokeHumanFunction(functionId, { requestId: '1' })
      const result2 = await invokeHumanFunction(functionId, { requestId: '2' })
      const result3 = await invokeHumanFunction(functionId, { requestId: '3' })

      createdTasks.push(result1.taskId, result2.taskId, result3.taskId)

      const taskIds = [result1.taskId, result2.taskId, result3.taskId]
      const uniqueTaskIds = new Set(taskIds)
      expect(uniqueTaskIds.size).toBe(3)

      expect(result1.status).toBe('pending')
      expect(result2.status).toBe('pending')
      expect(result3.status).toBe('pending')
    }, HUMAN_INVOKE_TIMEOUT * 3 + HUMAN_DEPLOY_TIMEOUT)
  })

  // ============================================================================
  // Task Status Polling
  // ============================================================================

  describe('Task Status Polling', () => {
    it('returns pending status when polling a new task', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Poll Test',
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const taskStatus = await getTaskStatus(invokeResult.taskId)

      expect(taskStatus.taskId).toBe(invokeResult.taskId)
      expect(taskStatus.status).toBe('pending')
      expect(taskStatus.functionId).toBe(functionId)
      expect(taskStatus.interactionType).toBe('approval')
      expect(taskStatus.createdAt).toBeDefined()
      expect(taskStatus.ui.title).toBe('Poll Test')
    }, HUMAN_INVOKE_TIMEOUT + HUMAN_DEPLOY_TIMEOUT)

    it('returns task with UI definition', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const ui: HumanFunctionUI = {
        title: 'Detailed UI Test',
        description: 'A test with detailed UI',
        form: [
          { name: 'comment', type: 'textarea', label: 'Your Comment', required: true },
        ],
        quickActions: [
          { id: 'approve', label: 'Approve', value: true, style: 'primary' },
          { id: 'reject', label: 'Reject', value: false, style: 'danger' },
        ],
      }

      await deployHumanFunction({
        id: functionId,
        interactionType: 'review',
        ui,
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const taskStatus = await getTaskStatus(invokeResult.taskId)

      expect(taskStatus.ui.title).toBe(ui.title)
      expect(taskStatus.ui.description).toBe(ui.description)
      expect(taskStatus.ui.form).toHaveLength(1)
      expect(taskStatus.ui.form![0].name).toBe('comment')
      expect(taskStatus.ui.quickActions).toHaveLength(2)
    }, HUMAN_INVOKE_TIMEOUT + HUMAN_DEPLOY_TIMEOUT)

    it('returns 404 for non-existent task', async () => {
      await expect(getTaskStatus('non-existent-task-id-12345')).rejects.toThrow(/404|not found/i)
    }, HUMAN_INVOKE_TIMEOUT)

    it('lists tasks for a function', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'List Tasks Test',
        },
      })

      const result1 = await invokeHumanFunction(functionId, { seq: 1 })
      const result2 = await invokeHumanFunction(functionId, { seq: 2 })
      createdTasks.push(result1.taskId, result2.taskId)

      const listResult = await listTasks(functionId)

      expect(listResult.tasks).toBeDefined()
      expect(listResult.tasks.length).toBeGreaterThanOrEqual(2)
      expect(listResult.total).toBeGreaterThanOrEqual(2)

      const taskIds = listResult.tasks.map((t) => t.taskId)
      expect(taskIds).toContain(result1.taskId)
      expect(taskIds).toContain(result2.taskId)
    }, HUMAN_INVOKE_TIMEOUT * 2 + HUMAN_DEPLOY_TIMEOUT)

    it('filters tasks by status', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Filter Test',
        },
      })

      const result1 = await invokeHumanFunction(functionId)
      const result2 = await invokeHumanFunction(functionId)
      createdTasks.push(result1.taskId, result2.taskId)

      await submitTaskResponse(result1.taskId, { approved: true })

      const pendingTasks = await listTasks(functionId, { status: 'pending' })
      const pendingIds = pendingTasks.tasks.map((t) => t.taskId)
      expect(pendingIds).toContain(result2.taskId)
      expect(pendingIds).not.toContain(result1.taskId)

      const completedTasks = await listTasks(functionId, { status: 'completed' })
      const completedIds = completedTasks.tasks.map((t) => t.taskId)
      expect(completedIds).toContain(result1.taskId)
      expect(completedIds).not.toContain(result2.taskId)
    }, HUMAN_FULL_FLOW_TIMEOUT)
  })
})
