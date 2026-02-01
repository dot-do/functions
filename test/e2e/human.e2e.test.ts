/**
 * E2E Tests: Human Function Deploy and Invoke (RED)
 *
 * These tests verify the full deployment and invocation flow for Human functions
 * on the live functions.do platform.
 *
 * Human functions are async functions that require human interaction to complete.
 * When invoked, they return a 'pending' status with a taskId and taskUrl.
 * The task is completed when a human submits a response via the callback endpoint.
 *
 * Prerequisites:
 * - functions.do Worker must be deployed
 * - Human function support must be implemented (these tests will FAIL until then)
 *
 * Run with: npm run test:e2e
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import {
  E2E_CONFIG,
  generateTestFunctionId,
  shouldRunE2E,
  deleteFunction,
} from './config'
import { waitForCondition } from './utils'

// ============================================================================
// Human Function Types
// ============================================================================

type HumanInteractionType = 'approval' | 'review' | 'input' | 'selection'

type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'expired'

interface FormField {
  name: string
  type: 'text' | 'textarea' | 'number' | 'email' | 'select' | 'checkbox' | 'date'
  label?: string
  required?: boolean
  placeholder?: string
  options?: Array<{ label: string; value: string }>
  defaultValue?: unknown
}

interface QuickAction {
  id: string
  label: string
  value: unknown
  style?: 'primary' | 'secondary' | 'danger'
}

interface HumanFunctionUI {
  title: string
  description?: string
  form?: FormField[]
  quickActions?: QuickAction[]
  metadata?: Record<string, unknown>
}

interface HumanFunctionDeployParams {
  id: string
  interactionType: HumanInteractionType
  ui: HumanFunctionUI
  timeout?: string
  assignee?: string
  callbackUrl?: string
}

interface HumanFunctionDeployResult {
  id: string
  version: string
  url: string
  type: 'human'
  interactionType: HumanInteractionType
}

interface HumanInvokeResult {
  status: 'pending'
  taskId: string
  taskUrl: string
  callbackUrl: string
  expiresAt?: string
}

interface TaskStatusResult {
  taskId: string
  status: TaskStatus
  functionId: string
  interactionType: HumanInteractionType
  assignee?: string
  assignedAt?: string
  response?: unknown
  completedAt?: string
  cancelledAt?: string
  expiredAt?: string
  createdAt: string
  ui: HumanFunctionUI
  invocationData?: unknown
}

interface ApprovalResponse {
  approved: boolean
  reason?: string
  approvedBy?: string
}

interface FormResponse {
  data: Record<string, unknown>
  submittedBy?: string
}

// ============================================================================
// Human Function Helpers
// ============================================================================

/**
 * Deploy a human function to functions.do
 */
async function deployHumanFunction(
  params: HumanFunctionDeployParams
): Promise<HumanFunctionDeployResult> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/functions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
    body: JSON.stringify({
      id: params.id,
      version: '1.0.0',
      type: 'human',
      interactionType: params.interactionType,
      ui: params.ui,
      timeout: params.timeout,
      assignee: params.assignee,
      callbackUrl: params.callbackUrl,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Deploy human function failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Invoke a human function - returns pending status with taskId
 */
async function invokeHumanFunction(
  functionId: string,
  data?: unknown
): Promise<HumanInvokeResult> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/functions/${functionId}/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Invoke human function failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Get the status of a human task
 */
async function getTaskStatus(taskId: string): Promise<TaskStatusResult> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/tasks/${taskId}`, {
    method: 'GET',
    headers: {
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Get task status failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Submit a response to a human task
 */
async function submitTaskResponse(taskId: string, taskResponse: unknown): Promise<void> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/tasks/${taskId}/respond`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
    body: JSON.stringify(taskResponse),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Submit task response failed (${response.status}): ${error}`)
  }
}

/**
 * Cancel a human task
 */
async function cancelTask(taskId: string): Promise<void> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/tasks/${taskId}`, {
    method: 'DELETE',
    headers: {
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Cancel task failed (${response.status}): ${error}`)
  }
}

/**
 * Wait for task to reach a specific status
 */
async function waitForTaskStatus(
  taskId: string,
  expectedStatus: TaskStatus,
  timeoutMs: number = 30000,
  pollIntervalMs: number = 1000
): Promise<TaskStatusResult> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const status = await getTaskStatus(taskId)
    if (status.status === expectedStatus) {
      return status
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  throw new Error(`Task ${taskId} did not reach status ${expectedStatus} within ${timeoutMs}ms`)
}

/**
 * List tasks for a function
 */
async function listTasks(
  functionId: string,
  options?: { status?: TaskStatus; limit?: number }
): Promise<{ tasks: TaskStatusResult[]; total: number }> {
  const params = new URLSearchParams()
  params.set('functionId', functionId)
  if (options?.status) params.set('status', options.status)
  if (options?.limit) params.set('limit', String(options.limit))

  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/tasks?${params}`, {
    method: 'GET',
    headers: {
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`List tasks failed (${response.status}): ${error}`)
  }

  return response.json()
}

// ============================================================================
// Test Configuration
// ============================================================================

/** Extended timeout for human function operations */
const HUMAN_DEPLOY_TIMEOUT = 60_000
const HUMAN_INVOKE_TIMEOUT = 30_000
const HUMAN_FULL_FLOW_TIMEOUT = 120_000

// ============================================================================
// E2E Tests
// ============================================================================

describe.skipIf(!shouldRunE2E())('E2E: Human Function Deploy and Invoke', () => {
  const deployedFunctions: string[] = []
  const createdTasks: string[] = []

  afterAll(async () => {
    // Cleanup tasks first
    if (!E2E_CONFIG.skipCleanup) {
      for (const taskId of createdTasks) {
        try {
          await cancelTask(taskId)
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    // Then cleanup functions
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

  // ============================================================================
  // 1. Human Function Deploy
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
  // 2. Invoke Returns Pending
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
      // Should expire in roughly 30 minutes (with some tolerance)
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

      // Verify invocation data is stored with task
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

      // All task IDs should be unique
      const taskIds = [result1.taskId, result2.taskId, result3.taskId]
      const uniqueTaskIds = new Set(taskIds)
      expect(uniqueTaskIds.size).toBe(3)

      // All should be pending
      expect(result1.status).toBe('pending')
      expect(result2.status).toBe('pending')
      expect(result3.status).toBe('pending')
    }, HUMAN_INVOKE_TIMEOUT * 3 + HUMAN_DEPLOY_TIMEOUT)
  })

  // ============================================================================
  // 3. Task Status Polling
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

      // Create multiple tasks
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

      // Complete one task
      await submitTaskResponse(result1.taskId, { approved: true })

      // Filter by pending - should only include result2
      const pendingTasks = await listTasks(functionId, { status: 'pending' })
      const pendingIds = pendingTasks.tasks.map((t) => t.taskId)
      expect(pendingIds).toContain(result2.taskId)
      expect(pendingIds).not.toContain(result1.taskId)

      // Filter by completed - should only include result1
      const completedTasks = await listTasks(functionId, { status: 'completed' })
      const completedIds = completedTasks.tasks.map((t) => t.taskId)
      expect(completedIds).toContain(result1.taskId)
      expect(completedIds).not.toContain(result2.taskId)
    }, HUMAN_FULL_FLOW_TIMEOUT)
  })

  // ============================================================================
  // 4. Callback Completion
  // ============================================================================

  describe('Callback Completion', () => {
    it('completes task when response is submitted', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Completion Test',
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      // Submit response
      await submitTaskResponse(invokeResult.taskId, {
        approved: true,
        comment: 'Looks good!',
      })

      // Poll for completed status
      const finalStatus = await getTaskStatus(invokeResult.taskId)

      expect(finalStatus.status).toBe('completed')
      expect(finalStatus.completedAt).toBeDefined()
      expect(finalStatus.response).toEqual({
        approved: true,
        comment: 'Looks good!',
      })
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('stores response data correctly', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'input',
        ui: {
          title: 'Response Data Test',
          form: [
            { name: 'field1', type: 'text', required: true },
            { name: 'field2', type: 'number', required: false },
          ],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const responseData = {
        field1: 'test value',
        field2: 42,
        nested: { a: 1, b: 2 },
        array: [1, 2, 3],
      }

      await submitTaskResponse(invokeResult.taskId, responseData)

      const finalStatus = await getTaskStatus(invokeResult.taskId)
      expect(finalStatus.response).toEqual(responseData)
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('rejects response submission for already completed task', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Double Submit Test',
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      // First submission should succeed
      await submitTaskResponse(invokeResult.taskId, { approved: true })

      // Second submission should fail
      await expect(
        submitTaskResponse(invokeResult.taskId, { approved: false })
      ).rejects.toThrow(/already.*completed|cannot.*respond/i)
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('rejects response submission for non-existent task', async () => {
      await expect(
        submitTaskResponse('non-existent-task-id', { data: 'test' })
      ).rejects.toThrow(/404|not found/i)
    }, HUMAN_INVOKE_TIMEOUT)
  })

  // ============================================================================
  // 5. Approval Flow
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

      // Submit approval
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
  // 6. Rejection Flow
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

      // Submit rejection
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

      // Rejection without reason should fail (if validation is enabled)
      // This depends on implementation - adjust expectation as needed
      const rejectionWithoutReason: ApprovalResponse = {
        approved: false,
      }

      // The API might either reject this or accept it depending on validation
      // For strict validation:
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
  // 7. Form Input
  // ============================================================================

  describe('Form Input', () => {
    it('accepts form data submission', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'input',
        ui: {
          title: 'Contact Form',
          description: 'Please fill out your contact information',
          form: [
            { name: 'firstName', type: 'text', label: 'First Name', required: true },
            { name: 'lastName', type: 'text', label: 'Last Name', required: true },
            { name: 'email', type: 'email', label: 'Email', required: true },
            { name: 'phone', type: 'text', label: 'Phone', required: false },
            { name: 'message', type: 'textarea', label: 'Message', required: true },
          ],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const formData: FormResponse = {
        data: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          phone: '+1-555-123-4567',
          message: 'I would like to learn more about your services.',
        },
        submittedBy: 'john.doe@example.com',
      }

      await submitTaskResponse(invokeResult.taskId, formData)

      const finalStatus = await getTaskStatus(invokeResult.taskId)

      expect(finalStatus.status).toBe('completed')
      expect((finalStatus.response as FormResponse).data.firstName).toBe('John')
      expect((finalStatus.response as FormResponse).data.email).toBe('john.doe@example.com')
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('validates required form fields', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'input',
        ui: {
          title: 'Required Fields Test',
          form: [
            { name: 'required1', type: 'text', label: 'Required Field 1', required: true },
            { name: 'required2', type: 'text', label: 'Required Field 2', required: true },
            { name: 'optional', type: 'text', label: 'Optional Field', required: false },
          ],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      // Submit with missing required field
      const incompleteData: FormResponse = {
        data: {
          required1: 'value1',
          // required2 is missing
          optional: 'optional value',
        },
      }

      await expect(
        submitTaskResponse(invokeResult.taskId, incompleteData)
      ).rejects.toThrow(/required|missing|validation/i)
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('handles select field with options', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'input',
        ui: {
          title: 'Survey Form',
          form: [
            {
              name: 'department',
              type: 'select',
              label: 'Department',
              required: true,
              options: [
                { label: 'Engineering', value: 'eng' },
                { label: 'Marketing', value: 'mkt' },
                { label: 'Sales', value: 'sales' },
                { label: 'Support', value: 'support' },
              ],
            },
            {
              name: 'experience',
              type: 'select',
              label: 'Years of Experience',
              options: [
                { label: '0-2 years', value: 'junior' },
                { label: '3-5 years', value: 'mid' },
                { label: '6+ years', value: 'senior' },
              ],
            },
          ],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const formData: FormResponse = {
        data: {
          department: 'eng',
          experience: 'senior',
        },
      }

      await submitTaskResponse(invokeResult.taskId, formData)

      const finalStatus = await getTaskStatus(invokeResult.taskId)
      expect((finalStatus.response as FormResponse).data.department).toBe('eng')
      expect((finalStatus.response as FormResponse).data.experience).toBe('senior')
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('handles checkbox fields', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'input',
        ui: {
          title: 'Preferences',
          form: [
            { name: 'newsletter', type: 'checkbox', label: 'Subscribe to newsletter' },
            { name: 'terms', type: 'checkbox', label: 'Accept terms and conditions', required: true },
            { name: 'marketing', type: 'checkbox', label: 'Receive marketing emails' },
          ],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const formData: FormResponse = {
        data: {
          newsletter: true,
          terms: true,
          marketing: false,
        },
      }

      await submitTaskResponse(invokeResult.taskId, formData)

      const finalStatus = await getTaskStatus(invokeResult.taskId)
      expect((finalStatus.response as FormResponse).data.newsletter).toBe(true)
      expect((finalStatus.response as FormResponse).data.terms).toBe(true)
      expect((finalStatus.response as FormResponse).data.marketing).toBe(false)
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('handles date fields', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'input',
        ui: {
          title: 'Schedule Meeting',
          form: [
            { name: 'date', type: 'date', label: 'Meeting Date', required: true },
            { name: 'notes', type: 'textarea', label: 'Meeting Notes' },
          ],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const formData: FormResponse = {
        data: {
          date: '2025-06-15',
          notes: 'Quarterly review meeting',
        },
      }

      await submitTaskResponse(invokeResult.taskId, formData)

      const finalStatus = await getTaskStatus(invokeResult.taskId)
      expect((finalStatus.response as FormResponse).data.date).toBe('2025-06-15')
    }, HUMAN_FULL_FLOW_TIMEOUT)
  })

  // ============================================================================
  // 8. Task Cancellation
  // ============================================================================

  describe('Task Cancellation', () => {
    it('cancels a pending task', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Cancellation Test',
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      // Don't add to createdTasks since we're explicitly cancelling

      // Cancel the task
      await cancelTask(invokeResult.taskId)

      // Verify status is cancelled
      const taskStatus = await getTaskStatus(invokeResult.taskId)

      expect(taskStatus.status).toBe('cancelled')
      expect(taskStatus.cancelledAt).toBeDefined()
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('rejects cancellation of completed task', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Already Completed',
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)

      // Complete the task first
      await submitTaskResponse(invokeResult.taskId, { approved: true })

      // Now try to cancel - should fail
      await expect(cancelTask(invokeResult.taskId)).rejects.toThrow(
        /already.*completed|cannot.*cancel/i
      )
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('rejects response submission to cancelled task', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Submit to Cancelled',
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)

      // Cancel the task
      await cancelTask(invokeResult.taskId)

      // Try to submit response - should fail
      await expect(
        submitTaskResponse(invokeResult.taskId, { approved: true })
      ).rejects.toThrow(/cancelled|cannot.*respond/i)
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('returns 404 when cancelling non-existent task', async () => {
      await expect(cancelTask('non-existent-task-id')).rejects.toThrow(/404|not found/i)
    }, HUMAN_INVOKE_TIMEOUT)
  })

  // ============================================================================
  // 9. Task Timeout
  // ============================================================================

  describe('Task Timeout', () => {
    it('expires task after timeout period', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      // Deploy with very short timeout for testing (10 seconds)
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

      // Verify task has expiration time
      expect(invokeResult.expiresAt).toBeDefined()

      // Poll for task to expire instead of fixed delay
      await waitForCondition(
        async () => {
          const status = await getTaskStatus(invokeResult.taskId)
          return status.status === 'expired'
        },
        { timeout: 20000, interval: 1000, description: 'task to expire' }
      )

      // Check status - should be expired
      const taskStatus = await getTaskStatus(invokeResult.taskId)

      expect(taskStatus.status).toBe('expired')
      expect(taskStatus.expiredAt).toBeDefined()
    }, 30_000) // 30 second timeout for this test

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

      // Poll for task to expire instead of fixed delay
      await waitForCondition(
        async () => {
          const status = await getTaskStatus(invokeResult.taskId)
          return status.status === 'expired'
        },
        { timeout: 20000, interval: 1000, description: 'task to expire' }
      )

      // Try to submit response - should fail
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

      // Immediately submit response (before timeout)
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

      // Test seconds format
      await deployHumanFunction({
        id: functionId1,
        interactionType: 'approval',
        ui: { title: 'Seconds Timeout' },
        timeout: '60s',
      })

      // Test minutes format
      await deployHumanFunction({
        id: functionId2,
        interactionType: 'approval',
        ui: { title: 'Minutes Timeout' },
        timeout: '30m',
      })

      // Test hours format
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

      // All should have expiration times set
      expect(result1.expiresAt).toBeDefined()
      expect(result2.expiresAt).toBeDefined()
      expect(result3.expiresAt).toBeDefined()

      // Verify relative times are correct
      const now = Date.now()
      const expires1 = new Date(result1.expiresAt!).getTime()
      const expires2 = new Date(result2.expiresAt!).getTime()
      const expires3 = new Date(result3.expiresAt!).getTime()

      // 60 seconds (with tolerance)
      expect(expires1 - now).toBeGreaterThan(50 * 1000)
      expect(expires1 - now).toBeLessThan(70 * 1000)

      // 30 minutes (with tolerance)
      expect(expires2 - now).toBeGreaterThan(25 * 60 * 1000)
      expect(expires2 - now).toBeLessThan(35 * 60 * 1000)

      // 24 hours (with tolerance)
      expect(expires3 - now).toBeGreaterThan(23 * 60 * 60 * 1000)
      expect(expires3 - now).toBeLessThan(25 * 60 * 60 * 1000)
    }, HUMAN_DEPLOY_TIMEOUT * 3 + HUMAN_INVOKE_TIMEOUT * 3)
  })

  // ============================================================================
  // 10. Webhook Callback
  // ============================================================================

  describe('Webhook Callback', () => {
    // Note: These tests would ideally use a mock webhook server
    // In practice, you might use a service like webhook.site or a local mock server

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

      // The invoke result should indicate webhook is configured
      // (exact structure depends on implementation)
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

      // Override callback URL in invocation
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

      // Verify the override took effect
      const taskStatus = await getTaskStatus(result.taskId)
      // Implementation-specific: how callback URL is stored/exposed
      expect(taskStatus).toBeDefined()
    }, HUMAN_FULL_FLOW_TIMEOUT)

    // Note: The following test would need a real webhook server to verify
    // the callback was actually made. In a real test environment, you might:
    // 1. Use webhook.site and poll for received webhooks
    // 2. Set up a local mock server
    // 3. Use a testing service like mockbin.io

    it.skip('triggers webhook when task is completed', async () => {
      // This test is skipped by default because it requires a real webhook endpoint
      // To run this test:
      // 1. Set up a webhook receiver (e.g., webhook.site)
      // 2. Update the callbackUrl below
      // 3. Unskip this test

      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      // You would need a real webhook URL here
      const webhookUrl = 'https://webhook.site/your-unique-id'

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Webhook Trigger Test',
        },
        callbackUrl: webhookUrl,
      })

      const invokeResult = await invokeHumanFunction(functionId, {
        requestId: 'webhook-test-123',
      })
      createdTasks.push(invokeResult.taskId)

      // Submit response
      await submitTaskResponse(invokeResult.taskId, {
        approved: true,
        comment: 'Webhook test approval',
      })

      // Wait for webhook to be sent
      await new Promise((resolve) => setTimeout(resolve, 2000))

      // Verify webhook was received (would need to poll webhook.site API or similar)
      // This is implementation-specific
    }, HUMAN_FULL_FLOW_TIMEOUT)
  })

  // ============================================================================
  // Additional Edge Cases and Error Handling
  // ============================================================================

  describe('Edge Cases', () => {
    it('handles special characters in UI text', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Special "Characters" & <Tags>',
          description: "It's a test with `code` and emoji test",
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const taskStatus = await getTaskStatus(invokeResult.taskId)
      expect(taskStatus.ui.title).toBe('Special "Characters" & <Tags>')
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('handles unicode in form data', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'input',
        ui: {
          title: 'Unicode Test',
          form: [{ name: 'message', type: 'textarea', required: true }],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const unicodeData: FormResponse = {
        data: {
          message: 'Hello in Japanese: Konnichiwa. Hello in Chinese: Ni hao. Hello in Arabic: Marhaba',
        },
      }

      await submitTaskResponse(invokeResult.taskId, unicodeData)

      const finalStatus = await getTaskStatus(invokeResult.taskId)
      expect((finalStatus.response as FormResponse).data.message).toContain('Konnichiwa')
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('handles large response data', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'input',
        ui: {
          title: 'Large Data Test',
          form: [{ name: 'content', type: 'textarea', required: true }],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      // Create a large response (100KB)
      const largeContent = 'x'.repeat(100 * 1024)
      const largeData: FormResponse = {
        data: {
          content: largeContent,
        },
      }

      await submitTaskResponse(invokeResult.taskId, largeData)

      const finalStatus = await getTaskStatus(invokeResult.taskId)
      expect((finalStatus.response as FormResponse).data.content).toHaveLength(100 * 1024)
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('handles concurrent task operations', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Concurrent Test',
        },
      })

      // Create multiple tasks concurrently
      const invokePromises = Array.from({ length: 5 }, (_, i) =>
        invokeHumanFunction(functionId, { index: i })
      )

      const results = await Promise.all(invokePromises)
      results.forEach((r) => createdTasks.push(r.taskId))

      // All should be unique pending tasks
      const taskIds = results.map((r) => r.taskId)
      expect(new Set(taskIds).size).toBe(5)

      // Complete all tasks concurrently
      const completePromises = results.map((r, i) =>
        submitTaskResponse(r.taskId, { approved: i % 2 === 0 })
      )

      await Promise.all(completePromises)

      // Verify all are completed
      const statusPromises = results.map((r) => getTaskStatus(r.taskId))
      const statuses = await Promise.all(statusPromises)

      statuses.forEach((status) => {
        expect(status.status).toBe('completed')
      })
    }, HUMAN_FULL_FLOW_TIMEOUT * 2)
  })

  // ============================================================================
  // Selection Interaction Type
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

      // User selects the Pro plan
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
  // Review Interaction Type
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
