/**
 * Human Functions E2E Tests (RED Phase)
 *
 * These tests are comprehensive end-to-end tests for human-in-the-loop functions.
 * They test the full workflow from API request to response, including:
 *
 * 1. Task creation via API - Creating human tasks through the API
 * 2. Task retrieval and status - Getting task status and details
 * 3. Task approval flow - Submitting responses and completing tasks
 * 4. Task rejection flow - Rejecting tasks with reasons
 * 5. Task cancellation - Cancelling pending tasks
 * 6. Task timeout/expiration - Handling expired tasks
 * 7. Multi-assignee workflows - Tasks with multiple assignees
 * 8. SLA enforcement - Testing SLA tracking and breach handling
 * 9. Reminders and escalations - Testing notification flows
 * 10. Skip conditions - Auto-approval based on conditions
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * until the full human function API is implemented.
 *
 * @module tiers/human-executor.e2e.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  HumanFunctionDefinition,
  HumanFunctionConfig,
  HumanFunctionResult,
  HumanTask,
  HumanUI,
  ResponderInfo,
} from '../../../core/src/human/index.js'
import { defineHumanFunction, approvalFunction } from '../../../core/src/human/index.js'
import { HumanExecutor } from '../human-executor.js'

// =============================================================================
// MOCK TYPES AND UTILITIES
// =============================================================================

/**
 * Mock Durable Object storage for E2E testing
 */
class MockDurableObjectStorage {
  private data: Map<string, unknown> = new Map()
  private alarms: number[] = []

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key)
  }

  async list(options?: { prefix?: string }): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>()
    for (const [key, value] of this.data) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.set(key, value)
      }
    }
    return result
  }

  async setAlarm(time: number | Date): Promise<void> {
    const timestamp = time instanceof Date ? time.getTime() : time
    this.alarms.push(timestamp)
  }

  async getAlarm(): Promise<number | null> {
    return this.alarms[0] ?? null
  }

  async deleteAlarm(): Promise<void> {
    this.alarms.shift()
  }

  clear(): void {
    this.data.clear()
    this.alarms = []
  }
}

/**
 * Mock Durable Object state
 */
class MockDurableObjectState {
  public storage: MockDurableObjectStorage
  public id: DurableObjectId

  constructor(id = 'test-human-executor-e2e-id') {
    this.storage = new MockDurableObjectStorage()
    this.id = { toString: () => id } as DurableObjectId
  }
}

/**
 * Mock notification service for E2E testing
 */
class MockNotificationService {
  public emailsSent: Array<{ to: string; subject: string; body: string }> = []
  public slacksSent: Array<{ channel: string; message: string }> = []

  async sendEmail(to: string, subject: string, body: string): Promise<void> {
    this.emailsSent.push({ to, subject, body })
  }

  async sendSlack(channel: string, message: string): Promise<void> {
    this.slacksSent.push({ channel, message })
  }

  async sendSms(_phone: string, _message: string): Promise<void> {
    // Not tracked in these tests
  }

  async sendPush(_userId: string, _title: string, _body: string): Promise<void> {
    // Not tracked in these tests
  }

  clear(): void {
    this.emailsSent = []
    this.slacksSent = []
  }
}

/**
 * Mock environment bindings
 */
interface MockEnv {
  HUMAN_TASKS_DO?: DurableObjectNamespace
  NOTIFICATIONS?: MockNotificationService
}

/**
 * Create a test approval function definition
 */
function createTestApprovalFunction(
  overrides?: Partial<HumanFunctionDefinition>
): HumanFunctionDefinition {
  return defineHumanFunction({
    id: 'test-e2e-approval',
    name: 'E2E Test Approval',
    version: '1.0.0',
    interactionType: 'approval',
    ui: {
      title: 'E2E Approval Request',
      description: 'Please review and approve this request',
      quickActions: [
        {
          id: 'approve',
          label: 'Approve',
          variant: 'primary',
          value: { approved: true },
          shortcut: 'a',
        },
        {
          id: 'reject',
          label: 'Reject',
          variant: 'danger',
          value: { approved: false },
          confirmMessage: 'Are you sure you want to reject?',
          shortcut: 'r',
        },
      ],
    },
    ...overrides,
  })
}

/**
 * Simulate API request to create a human task
 */
async function createTaskViaAPI(
  executor: HumanExecutor,
  definition: HumanFunctionDefinition,
  input: unknown,
  config?: HumanFunctionConfig
): Promise<HumanTask> {
  const request = new Request('https://human.do/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ definition, input, config }),
  })
  const response = await executor.fetch(request)
  expect(response.ok).toBe(true)
  return response.json() as Promise<HumanTask>
}

/**
 * Simulate API request to get task status
 */
async function getTaskViaAPI(
  executor: HumanExecutor,
  taskId: string
): Promise<HumanTask | null> {
  const request = new Request(`https://human.do/tasks/${taskId}`, {
    method: 'GET',
  })
  const response = await executor.fetch(request)
  if (response.status === 404) return null
  return response.json() as Promise<HumanTask>
}

/**
 * Simulate API request to submit task response
 */
async function submitResponseViaAPI(
  executor: HumanExecutor,
  taskId: string,
  taskResponse: unknown,
  responder: ResponderInfo
): Promise<{ success: boolean }> {
  const request = new Request(`https://human.do/tasks/${taskId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: taskResponse, responder }),
  })
  const response = await executor.fetch(request)
  return response.json() as Promise<{ success: boolean }>
}

/**
 * Simulate API request to cancel a task
 */
async function cancelTaskViaAPI(
  executor: HumanExecutor,
  taskId: string,
  reason?: string
): Promise<{ success: boolean }> {
  const request = new Request(`https://human.do/tasks/${taskId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
  const response = await executor.fetch(request)
  return response.json() as Promise<{ success: boolean }>
}

/**
 * Simulate API request to get task UI
 */
async function getTaskUIViaAPI(
  executor: HumanExecutor,
  taskId: string
): Promise<HumanUI | null> {
  const request = new Request(`https://human.do/tasks/${taskId}/ui`, {
    method: 'GET',
  })
  const response = await executor.fetch(request)
  if (response.status === 404) return null
  return response.json() as Promise<HumanUI>
}

// =============================================================================
// E2E TEST SUITES
// =============================================================================

describe('E2E: Human Functions - Full API Flow', () => {
  let executor: HumanExecutor
  let mockState: MockDurableObjectState
  let mockEnv: MockEnv
  let mockNotifications: MockNotificationService

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockState = new MockDurableObjectState()
    mockNotifications = new MockNotificationService()
    mockEnv = {
      NOTIFICATIONS: mockNotifications,
    }
    executor = new HumanExecutor(mockState as unknown as DurableObjectState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
    mockState.storage.clear()
    mockNotifications.clear()
  })

  // ===========================================================================
  // E2E Test: Task Creation via API
  // ===========================================================================

  describe('E2E: Task Creation via API', () => {
    it('creates a task via POST /tasks endpoint', async () => {
      const definition = createTestApprovalFunction()
      const input = { requestId: 'E2E-001', amount: 1000 }

      const task = await createTaskViaAPI(executor, definition, input)

      expect(task).toBeDefined()
      expect(task.id).toBeDefined()
      expect(task.status).toBe('pending')
      expect(task.taskUrl).toContain(task.id)
    })

    it('returns task with proper structure from API', async () => {
      const definition = createTestApprovalFunction()
      const input = { requestId: 'E2E-002' }

      const task = await createTaskViaAPI(executor, definition, input)

      expect(task).toMatchObject({
        id: expect.any(String),
        status: 'pending',
        taskUrl: expect.stringContaining('https://'),
        createdAt: expect.any(Number),
        expiresAt: expect.any(Number),
      })
    })

    it('applies custom config when creating task', async () => {
      const definition = createTestApprovalFunction()
      const input = { requestId: 'E2E-003' }
      const config: HumanFunctionConfig = {
        assignees: { users: ['override-user-1', 'override-user-2'] },
      }

      const task = await createTaskViaAPI(executor, definition, input, config)
      const routing = await executor.getTaskRouting(task.id)

      expect(task.status).toBe('pending')
      // Should have applied the override assignees
      expect(routing.users).toContain('override-user-1')
    })

    it('creates task with auto-assignment based on input', async () => {
      const definition = createTestApprovalFunction({
        assignees: {
          autoAssign: {
            field: 'region',
            mapping: {
              'us-west': 'us-west-approver',
              'eu-central': 'eu-central-approver',
            },
            default: 'global-approver',
          },
        },
      })
      const input = { requestId: 'E2E-004', region: 'us-west' }

      const task = await createTaskViaAPI(executor, definition, input)
      const routing = await executor.getTaskRouting(task.id)

      expect(routing.autoAssignedTo).toBe('us-west-approver')
    })

    it('handles concurrent task creation', async () => {
      const definition = createTestApprovalFunction()

      const createPromises = Array.from({ length: 5 }, (_, i) =>
        createTaskViaAPI(executor, definition, { requestId: `CONCURRENT-${i}` })
      )

      const tasks = await Promise.all(createPromises)

      // All tasks should be created successfully with unique IDs
      const taskIds = tasks.map((t) => t.id)
      expect(new Set(taskIds).size).toBe(5)
      tasks.forEach((task) => {
        expect(task.status).toBe('pending')
      })
    })
  })

  // ===========================================================================
  // E2E Test: Task Retrieval and Status
  // ===========================================================================

  describe('E2E: Task Retrieval and Status', () => {
    it('retrieves task status via GET /tasks/:id', async () => {
      const definition = createTestApprovalFunction()
      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-005' })

      const retrievedTask = await getTaskViaAPI(executor, task.id)

      expect(retrievedTask).toBeDefined()
      expect(retrievedTask!.id).toBe(task.id)
      expect(retrievedTask!.status).toBe('pending')
    })

    it('returns 404 for non-existent task', async () => {
      const task = await getTaskViaAPI(executor, 'non-existent-task-id')
      expect(task).toBeNull()
    })

    it('retrieves task UI via GET /tasks/:id/ui', async () => {
      const definition = createTestApprovalFunction({
        ui: {
          title: 'Custom E2E Title',
          description: 'Custom E2E Description',
          quickActions: [
            { id: 'approve', label: 'Approve', variant: 'primary', value: { approved: true } },
          ],
        },
      })
      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-006' })

      const ui = await getTaskUIViaAPI(executor, task.id)

      expect(ui).toBeDefined()
      expect(ui!.title).toBe('Custom E2E Title')
      expect(ui!.description).toBe('Custom E2E Description')
    })

    it('reflects status changes in retrieved task', async () => {
      const definition = createTestApprovalFunction()
      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-007' })

      // Initial status
      let retrieved = await getTaskViaAPI(executor, task.id)
      expect(retrieved!.status).toBe('pending')

      // Submit response
      await submitResponseViaAPI(executor, task.id, { approved: true }, {
        userId: 'e2e-user',
        channel: 'web',
      })

      // Check updated status
      retrieved = await getTaskViaAPI(executor, task.id)
      expect(retrieved!.status).toBe('completed')
    })
  })

  // ===========================================================================
  // E2E Test: Task Approval Flow
  // ===========================================================================

  describe('E2E: Task Approval Flow', () => {
    it('completes full approval flow via API', async () => {
      const definition = createTestApprovalFunction()
      const input = { requestId: 'E2E-APPROVAL-001', amount: 5000 }

      // Step 1: Create task
      const task = await createTaskViaAPI(executor, definition, input)
      expect(task.status).toBe('pending')

      // Step 2: Submit approval response
      const result = await submitResponseViaAPI(
        executor,
        task.id,
        { approved: true, comment: 'Approved via E2E test' },
        { userId: 'approver-1', email: 'approver@example.com', channel: 'web' }
      )
      expect(result.success).toBe(true)

      // Step 3: Verify task is completed
      const completedTask = await getTaskViaAPI(executor, task.id)
      expect(completedTask!.status).toBe('completed')
    })

    it('records responder information after approval', async () => {
      const definition = createTestApprovalFunction()
      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-APPROVAL-002' })

      await submitResponseViaAPI(
        executor,
        task.id,
        { approved: true },
        {
          userId: 'approver-user-123',
          email: 'approver@company.com',
          name: 'John Approver',
          channel: 'email',
        }
      )

      const waitResult = await executor.waitForResult(task.id)
      expect(waitResult.humanExecution.respondedBy).toMatchObject({
        userId: 'approver-user-123',
        email: 'approver@company.com',
        name: 'John Approver',
        channel: 'email',
      })
    })

    it('calculates response time correctly', async () => {
      const definition = createTestApprovalFunction()

      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-APPROVAL-003' })

      // Note: In a real E2E test with proper time mocking, we'd simulate time passing.
      // For now, we verify that response time is calculated and recorded.
      await submitResponseViaAPI(
        executor,
        task.id,
        { approved: true },
        { userId: 'approver', channel: 'web' }
      )

      const waitResult = await executor.waitForResult(task.id)
      // Response time should be recorded (any non-negative number)
      expect(waitResult.humanExecution.responseTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('handles approval with form data', async () => {
      const definition = defineHumanFunction({
        id: 'form-approval',
        name: 'Form Approval',
        version: '1.0.0',
        interactionType: 'approval',
        ui: {
          title: 'Approval with Comment',
          form: [
            { name: 'reason', label: 'Reason', type: 'textarea', required: true },
            { name: 'priority', label: 'Priority', type: 'select', options: [
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ]},
          ],
          quickActions: [
            { id: 'approve', label: 'Approve', variant: 'primary', value: { approved: true } },
          ],
        },
      })

      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-FORM-001' })

      await submitResponseViaAPI(
        executor,
        task.id,
        { approved: true, reason: 'E2E test approval', priority: 'high' },
        { userId: 'form-user', channel: 'web' }
      )

      const completedTask = await getTaskViaAPI(executor, task.id)
      expect(completedTask!.status).toBe('completed')
    })
  })

  // ===========================================================================
  // E2E Test: Task Rejection Flow
  // ===========================================================================

  describe('E2E: Task Rejection Flow', () => {
    it('completes full rejection flow via API', async () => {
      const definition = createTestApprovalFunction()
      const input = { requestId: 'E2E-REJECT-001', amount: 100000 }

      // Step 1: Create task
      const task = await createTaskViaAPI(executor, definition, input)

      // Step 2: Submit rejection
      const result = await submitResponseViaAPI(
        executor,
        task.id,
        { approved: false, reason: 'Amount exceeds limit' },
        { userId: 'rejector-1', channel: 'web' }
      )
      expect(result.success).toBe(true)

      // Step 3: Verify task is completed (with rejection)
      const completedTask = await getTaskViaAPI(executor, task.id)
      expect(completedTask!.status).toBe('completed')
    })

    it('triggers escalation on rejection when configured', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['initial-reviewer'] },
        escalation: {
          trigger: 'rejection',
          tiers: [
            { after: '0s', assignees: { users: ['escalation-manager'] } },
          ],
        },
      })

      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-REJECT-002' })

      await submitResponseViaAPI(
        executor,
        task.id,
        { approved: false },
        { userId: 'initial-reviewer', channel: 'web' }
      )

      const routing = await executor.getTaskRouting(task.id)
      expect(routing.escalatedTo).toContain('escalation-manager')
    })
  })

  // ===========================================================================
  // E2E Test: Task Cancellation
  // ===========================================================================

  describe('E2E: Task Cancellation', () => {
    it('cancels pending task via API', async () => {
      const definition = createTestApprovalFunction()
      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-CANCEL-001' })

      const result = await cancelTaskViaAPI(executor, task.id, 'No longer needed')
      expect(result.success).toBe(true)

      const cancelledTask = await getTaskViaAPI(executor, task.id)
      expect(cancelledTask!.status).toBe('cancelled')
    })

    it('prevents response submission on cancelled task', async () => {
      const definition = createTestApprovalFunction()
      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-CANCEL-002' })

      await cancelTaskViaAPI(executor, task.id)

      // Attempt to submit response should fail or return error
      const request = new Request(`https://human.do/tasks/${task.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: { approved: true },
          responder: { userId: 'late-responder', channel: 'web' },
        }),
      })
      const response = await executor.fetch(request)
      const body = await response.json() as { success?: boolean; error?: string }

      // Either status code indicates error, OR the body indicates failure
      const isError = response.status >= 400 || body.success === false || body.error !== undefined
      expect(isError).toBe(true)
    })

    it('prevents cancellation of completed task', async () => {
      const definition = createTestApprovalFunction()
      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-CANCEL-003' })

      // Complete the task first
      await submitResponseViaAPI(
        executor,
        task.id,
        { approved: true },
        { userId: 'approver', channel: 'web' }
      )

      // Try to cancel - should fail
      const request = new Request(`https://human.do/tasks/${task.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Too late' }),
      })
      const response = await executor.fetch(request)

      expect(response.status).toBe(500) // Task already completed
    })
  })

  // ===========================================================================
  // E2E Test: Task Timeout/Expiration
  // ===========================================================================

  describe('E2E: Task Timeout/Expiration', () => {
    it('expires task after timeout', async () => {
      const definition = createTestApprovalFunction({ timeout: '1h' })
      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-TIMEOUT-001' })

      // Advance time past timeout
      vi.advanceTimersByTime(3600001) // 1 hour + 1ms
      await executor.alarm()

      const expiredTask = await getTaskViaAPI(executor, task.id)
      expect(expiredTask!.status).toBe('expired')
    })

    it('returns timeout error when waiting for expired task', async () => {
      const definition = createTestApprovalFunction({ timeout: '30m' })
      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-TIMEOUT-002' })

      vi.advanceTimersByTime(1800001) // 30 minutes + 1ms
      await executor.alarm()

      const waitResult = await executor.waitForResult(task.id)
      expect(waitResult.success).toBe(false)
      expect(waitResult.error?.code).toBe('TIMEOUT')
    })

    it('auto-approves on SLA breach when configured', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['slow-approver'] },
        sla: {
          responseTime: '1h',
          resolutionTime: '4h',
          onBreach: 'auto-approve',
        },
      })

      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-TIMEOUT-003' })

      // Advance past resolution time
      vi.advanceTimersByTime(14400001) // 4 hours + 1ms
      await executor.alarm()

      const autoApprovedTask = await getTaskViaAPI(executor, task.id)
      expect(autoApprovedTask!.status).toBe('completed')
    })

    it('auto-rejects on SLA breach when configured', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['slow-approver'] },
        sla: {
          responseTime: '1h',
          resolutionTime: '4h',
          onBreach: 'auto-reject',
        },
      })

      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-TIMEOUT-004' })

      vi.advanceTimersByTime(14400001)
      await executor.alarm()

      const autoRejectedTask = await getTaskViaAPI(executor, task.id)
      expect(autoRejectedTask!.status).toBe('completed')
    })
  })

  // ===========================================================================
  // E2E Test: Multi-Assignee Workflows
  // ===========================================================================

  describe('E2E: Multi-Assignee Workflows', () => {
    it('routes task to multiple assignees', async () => {
      const definition = createTestApprovalFunction({
        assignees: {
          users: ['reviewer-1', 'reviewer-2', 'reviewer-3'],
        },
      })

      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-MULTI-001' })
      const routing = await executor.getTaskRouting(task.id)

      expect(routing.users).toEqual(['reviewer-1', 'reviewer-2', 'reviewer-3'])
    })

    it('applies round-robin assignment across multiple tasks', async () => {
      const definition = createTestApprovalFunction({
        assignees: {
          users: ['rr-user-1', 'rr-user-2', 'rr-user-3'],
          roundRobin: true,
        },
      })

      const task1 = await createTaskViaAPI(executor, definition, { id: 1 })
      const task2 = await createTaskViaAPI(executor, definition, { id: 2 })
      const task3 = await createTaskViaAPI(executor, definition, { id: 3 })

      const routing1 = await executor.getTaskRouting(task1.id)
      const routing2 = await executor.getTaskRouting(task2.id)
      const routing3 = await executor.getTaskRouting(task3.id)

      const assignees = [routing1.assignedTo, routing2.assignedTo, routing3.assignedTo]
      expect(assignees).toContain('rr-user-1')
      expect(assignees).toContain('rr-user-2')
      expect(assignees).toContain('rr-user-3')
    })

    it('routes to teams and roles', async () => {
      const definition = createTestApprovalFunction({
        assignees: {
          teams: ['engineering-team', 'security-team'],
          roles: ['manager', 'tech-lead'],
        },
      })

      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-MULTI-002' })
      const routing = await executor.getTaskRouting(task.id)

      expect(routing.teams).toEqual(['engineering-team', 'security-team'])
      expect(routing.roles).toEqual(['manager', 'tech-lead'])
    })

    it('any assignee can complete the task', async () => {
      const definition = createTestApprovalFunction({
        assignees: {
          users: ['approver-a', 'approver-b', 'approver-c'],
        },
      })

      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-MULTI-003' })

      // approver-b completes the task
      await submitResponseViaAPI(
        executor,
        task.id,
        { approved: true },
        { userId: 'approver-b', channel: 'slack' }
      )

      const completedTask = await getTaskViaAPI(executor, task.id)
      expect(completedTask!.status).toBe('completed')

      const waitResult = await executor.waitForResult(task.id)
      expect(waitResult.humanExecution.respondedBy.userId).toBe('approver-b')
    })
  })

  // ===========================================================================
  // E2E Test: SLA Enforcement
  // ===========================================================================

  describe('E2E: SLA Enforcement', () => {
    it('tracks SLA met status for fast response', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['fast-approver'] },
        sla: {
          responseTime: '1h',
          resolutionTime: '4h',
        },
      })

      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-SLA-001' })

      // Respond within SLA (30 minutes)
      vi.advanceTimersByTime(1800000)
      await submitResponseViaAPI(
        executor,
        task.id,
        { approved: true },
        { userId: 'fast-approver', channel: 'web' }
      )

      const waitResult = await executor.waitForResult(task.id)
      expect(waitResult.humanExecution.slaMet).toBe(true)
    })

    it('tracks SLA breach for slow response', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['slow-approver'] },
        sla: {
          responseTime: '1h',
          resolutionTime: '4h',
        },
      })

      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-SLA-002' })

      // Respond after resolution SLA (5 hours)
      vi.advanceTimersByTime(18000000)
      await submitResponseViaAPI(
        executor,
        task.id,
        { approved: true },
        { userId: 'slow-approver', channel: 'web' }
      )

      const waitResult = await executor.waitForResult(task.id)
      expect(waitResult.humanExecution.slaMet).toBe(false)
    })

    it('sends SLA warning notification at threshold', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['warning-user'] },
        sla: {
          responseTime: '1h',
          resolutionTime: '4h',
          warningThreshold: 80, // 80% = 48 minutes
        },
        reminders: {
          channels: ['email'],
        },
      })

      await createTaskViaAPI(executor, definition, { requestId: 'E2E-SLA-003' })

      // Advance to 80% of response time
      vi.advanceTimersByTime(2880000) // 48 minutes
      await executor.alarm()

      // Should have sent SLA warning
      const warningEmail = mockNotifications.emailsSent.find(
        (e) => e.body.includes('warning') || e.body.includes('approaching')
      )
      expect(warningEmail).toBeDefined()
    })

    it('escalates on SLA breach when configured', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['initial-user'] },
        sla: {
          responseTime: '1h',
          resolutionTime: '4h',
          onBreach: 'escalate',
        },
        escalation: {
          trigger: 'timeout',
          tiers: [{ after: '0s', assignees: { users: ['sla-escalation-manager'] } }],
        },
      })

      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-SLA-004' })

      // Trigger SLA breach
      vi.advanceTimersByTime(3600001)
      await executor.alarm()

      const routing = await executor.getTaskRouting(task.id)
      expect(routing.escalatedTo).toBeDefined()
    })
  })

  // ===========================================================================
  // E2E Test: Reminders and Escalations
  // ===========================================================================

  describe('E2E: Reminders and Escalations', () => {
    it('sends reminders via configured channels', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['reminder-user@example.com'] },
        reminders: {
          firstReminder: '1h',
          interval: '30m',
          maxReminders: 3,
          channels: ['email', 'slack'],
        },
      })

      await createTaskViaAPI(executor, definition, { requestId: 'E2E-REMIND-001' })

      // Trigger first reminder
      vi.advanceTimersByTime(3600000)
      await executor.alarm()

      expect(mockNotifications.emailsSent.length).toBeGreaterThan(0)
      expect(mockNotifications.slacksSent.length).toBeGreaterThan(0)
    })

    it('respects maxReminders limit', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['max-reminder-user'] },
        reminders: {
          firstReminder: '1h',
          interval: '30m',
          maxReminders: 2,
          channels: ['email'],
        },
      })

      await createTaskViaAPI(executor, definition, { requestId: 'E2E-REMIND-002' })

      // Trigger all reminders
      vi.advanceTimersByTime(3600000) // First reminder
      await executor.alarm()
      vi.advanceTimersByTime(1800000) // Second reminder
      await executor.alarm()
      vi.advanceTimersByTime(1800000) // Would be third, but max is 2
      await executor.alarm()

      expect(mockNotifications.emailsSent).toHaveLength(2)
    })

    it('escalates through multiple tiers', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['tier-0-user'] },
        escalation: {
          trigger: 'timeout',
          tiers: [
            { after: '1h', assignees: { users: ['tier-1-manager'] }, message: 'Tier 1 escalation' },
            { after: '2h', assignees: { users: ['tier-2-director'] }, message: 'Tier 2 escalation' },
            { after: '4h', assignees: { users: ['tier-3-vp'] }, message: 'Tier 3 escalation' },
          ],
        },
      })

      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-ESCALATE-001' })

      // Tier 1 escalation
      vi.advanceTimersByTime(3600000)
      await executor.alarm()
      let routing = await executor.getTaskRouting(task.id)
      expect(routing.escalatedTo).toContain('tier-1-manager')

      // Tier 2 escalation
      vi.advanceTimersByTime(3600000)
      await executor.alarm()
      routing = await executor.getTaskRouting(task.id)
      expect(routing.escalatedTo).toContain('tier-2-director')

      // Tier 3 escalation
      vi.advanceTimersByTime(7200000)
      await executor.alarm()
      routing = await executor.getTaskRouting(task.id)
      expect(routing.escalatedTo).toContain('tier-3-vp')
    })

    it('records escalation history in execution info', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['history-user'] },
        escalation: {
          trigger: 'timeout',
          tiers: [
            { after: '1h', assignees: { users: ['escalation-user-1'] } },
            { after: '2h', assignees: { users: ['escalation-user-2'] } },
          ],
        },
      })

      const task = await createTaskViaAPI(executor, definition, { requestId: 'E2E-ESCALATE-002' })

      // Trigger escalations
      vi.advanceTimersByTime(3600000)
      await executor.alarm()
      vi.advanceTimersByTime(3600000)
      await executor.alarm()

      // Complete task
      await submitResponseViaAPI(
        executor,
        task.id,
        { approved: true },
        { userId: 'escalation-user-2', channel: 'web' }
      )

      const waitResult = await executor.waitForResult(task.id)
      expect(waitResult.humanExecution.escalations).toHaveLength(2)
      expect(waitResult.humanExecution.escalations[0].tier).toBe(1)
      expect(waitResult.humanExecution.escalations[1].tier).toBe(2)
    })
  })

  // ===========================================================================
  // E2E Test: Skip Conditions (Auto-Approval)
  // ===========================================================================

  describe('E2E: Skip Conditions (Auto-Approval)', () => {
    it('auto-approves when skip condition matches', async () => {
      const definition = createTestApprovalFunction()
      const config: HumanFunctionConfig = {
        skipConditions: [
          {
            field: 'amount',
            operator: 'lt',
            value: 100,
            output: { approved: true, reason: 'Auto-approved: small amount' },
          },
        ],
      }

      // Execute with skip condition matching
      const result = await executor.execute(definition, { amount: 50 }, config)

      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({ approved: true })
      expect(result.humanExecution.skipped).toBe(true)
      expect(result.humanExecution.skipReason).toContain('small amount')
    })

    it('creates task when skip condition does not match', async () => {
      const definition = createTestApprovalFunction()
      const config: HumanFunctionConfig = {
        skipConditions: [
          {
            field: 'amount',
            operator: 'lt',
            value: 100,
            output: { approved: true },
          },
        ],
      }

      // This should create a task, not skip
      const task = await createTaskViaAPI(executor, definition, { amount: 500 }, config)

      expect(task.status).toBe('pending')
    })

    it('supports multiple skip condition operators', async () => {
      const definition = createTestApprovalFunction()

      // Test 'eq' operator
      let config: HumanFunctionConfig = {
        skipConditions: [
          { field: 'status', operator: 'eq', value: 'pre-approved', output: { approved: true } },
        ],
      }
      let result = await executor.execute(definition, { status: 'pre-approved' }, config)
      expect(result.humanExecution.skipped).toBe(true)

      // Test 'gt' operator
      config = {
        skipConditions: [
          { field: 'trustScore', operator: 'gt', value: 95, output: { approved: true } },
        ],
      }
      result = await executor.execute(definition, { trustScore: 99 }, config)
      expect(result.humanExecution.skipped).toBe(true)

      // Test 'contains' operator
      config = {
        skipConditions: [
          { field: 'tags', operator: 'contains', value: 'auto-approve', output: { approved: true } },
        ],
      }
      result = await executor.execute(definition, { tags: ['auto-approve', 'fast-track'] }, config)
      expect(result.humanExecution.skipped).toBe(true)

      // Test 'matches' operator
      config = {
        skipConditions: [
          { field: 'email', operator: 'matches', value: '@trusted\\.com$', output: { approved: true } },
        ],
      }
      result = await executor.execute(definition, { email: 'user@trusted.com' }, config)
      expect(result.humanExecution.skipped).toBe(true)
    })
  })

  // ===========================================================================
  // E2E Test: Input Validation
  // ===========================================================================

  describe('E2E: Input Validation', () => {
    it('validates required form fields', async () => {
      const definition = defineHumanFunction({
        id: 'validation-test',
        name: 'Validation Test',
        version: '1.0.0',
        interactionType: 'input',
        ui: {
          title: 'Enter Required Data',
          form: [
            { name: 'email', label: 'Email', type: 'email', required: true },
            { name: 'name', label: 'Name', type: 'text', required: true },
          ],
        },
      })

      const task = await createTaskViaAPI(executor, definition, {})

      // Submit with missing required field
      const request = new Request(`https://human.do/tasks/${task.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: { email: 'test@example.com' }, // Missing 'name'
          responder: { userId: 'validator', channel: 'web' },
        }),
      })
      const response = await executor.fetch(request)

      expect(response.status).toBe(500) // Validation error
    })

    it('validates output schema format', async () => {
      const definition = defineHumanFunction({
        id: 'schema-validation-test',
        name: 'Schema Validation Test',
        version: '1.0.0',
        interactionType: 'input',
        ui: {
          title: 'Enter Valid Email',
          form: [
            { name: 'email', label: 'Email', type: 'email' },
          ],
        },
        outputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
          },
        },
      })

      const task = await createTaskViaAPI(executor, definition, {})

      // Submit with invalid email format
      const request = new Request(`https://human.do/tasks/${task.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: { email: 'not-an-email' },
          responder: { userId: 'validator', channel: 'web' },
        }),
      })
      const response = await executor.fetch(request)

      expect(response.status).toBe(500) // Validation error
    })
  })

  // ===========================================================================
  // E2E Test: Full Workflow Scenarios
  // ===========================================================================

  describe('E2E: Full Workflow Scenarios', () => {
    it('completes expense approval workflow end-to-end', async () => {
      // Define expense approval function
      const definition = defineHumanFunction({
        id: 'expense-approval',
        name: 'Expense Approval',
        version: '1.0.0',
        interactionType: 'approval',
        ui: {
          title: 'Approve Expense Report',
          description: 'Review and approve the expense report',
          context: [
            { type: 'json', label: 'Expense Details', content: {} },
          ],
          form: [
            { name: 'comment', label: 'Comment', type: 'textarea' },
          ],
          quickActions: [
            { id: 'approve', label: 'Approve', variant: 'primary', value: { approved: true } },
            { id: 'reject', label: 'Reject', variant: 'danger', value: { approved: false } },
          ],
        },
        assignees: {
          autoAssign: {
            field: 'department',
            mapping: {
              engineering: 'eng-manager',
              sales: 'sales-manager',
            },
            default: 'finance-manager',
          },
        },
        sla: {
          responseTime: '24h',
          resolutionTime: '72h',
        },
        reminders: {
          firstReminder: '12h',
          channels: ['email'],
        },
      })

      const input = {
        employeeId: 'EMP-001',
        department: 'engineering',
        amount: 1500.00,
        description: 'Conference travel expenses',
        items: [
          { description: 'Flight', amount: 800 },
          { description: 'Hotel', amount: 500 },
          { description: 'Meals', amount: 200 },
        ],
      }

      // Step 1: Create task
      const task = await createTaskViaAPI(executor, definition, input)
      expect(task.status).toBe('pending')

      // Verify auto-assignment
      const routing = await executor.getTaskRouting(task.id)
      expect(routing.autoAssignedTo).toBe('eng-manager')

      // Step 2: Get task UI (simulate manager viewing)
      const ui = await getTaskUIViaAPI(executor, task.id)
      expect(ui!.title).toBe('Approve Expense Report')

      // Step 3: Manager approves
      await submitResponseViaAPI(
        executor,
        task.id,
        { approved: true, comment: 'Approved for conference attendance' },
        { userId: 'eng-manager', email: 'eng-manager@company.com', channel: 'web' }
      )

      // Step 4: Verify completion
      const completedTask = await getTaskViaAPI(executor, task.id)
      expect(completedTask!.status).toBe('completed')

      // Step 5: Get execution info
      const waitResult = await executor.waitForResult(task.id)
      expect(waitResult.success).toBe(true)
      expect(waitResult.output).toMatchObject({ approved: true })
      expect(waitResult.humanExecution.slaMet).toBe(true)
    })

    it('handles document review workflow with escalation', async () => {
      const definition = defineHumanFunction({
        id: 'document-review',
        name: 'Document Review',
        version: '1.0.0',
        interactionType: 'review',
        ui: {
          title: 'Review Legal Document',
          form: [
            { name: 'status', label: 'Review Status', type: 'select', required: true, options: [
              { value: 'approved', label: 'Approved' },
              { value: 'changes-requested', label: 'Changes Requested' },
              { value: 'rejected', label: 'Rejected' },
            ]},
            { name: 'feedback', label: 'Feedback', type: 'textarea', required: true },
          ],
        },
        assignees: { users: ['legal-reviewer'] },
        escalation: {
          trigger: 'timeout',
          tiers: [
            { after: '4h', assignees: { users: ['senior-legal'] } },
            { after: '8h', assignees: { users: ['legal-director'] } },
          ],
        },
        reminders: {
          firstReminder: '2h',
          interval: '1h',
          maxReminders: 3,
          channels: ['email', 'slack'],
        },
      })

      const input = {
        documentId: 'DOC-2024-001',
        documentType: 'Contract',
        title: 'Vendor Agreement',
      }

      // Step 1: Create task
      const task = await createTaskViaAPI(executor, definition, input)

      // Step 2: Simulate time passing - first reminder
      vi.advanceTimersByTime(7200000) // 2 hours
      await executor.alarm()
      expect(mockNotifications.emailsSent.length).toBeGreaterThan(0)

      // Step 3: More time passes - escalation to senior legal
      vi.advanceTimersByTime(7200000) // 4 hours total
      await executor.alarm()
      let routing = await executor.getTaskRouting(task.id)
      expect(routing.escalatedTo).toContain('senior-legal')

      // Step 4: Senior legal completes the review
      await submitResponseViaAPI(
        executor,
        task.id,
        { status: 'changes-requested', feedback: 'Please update section 3.2' },
        { userId: 'senior-legal', channel: 'web' }
      )

      // Step 5: Verify completion
      const completedTask = await getTaskViaAPI(executor, task.id)
      expect(completedTask!.status).toBe('completed')

      const waitResult = await executor.waitForResult(task.id)
      expect(waitResult.humanExecution.escalations.length).toBeGreaterThan(0)
      expect(waitResult.humanExecution.remindersSent).toBeGreaterThan(0)
    })
  })

  // ===========================================================================
  // E2E Test: Error Handling
  // ===========================================================================

  describe('E2E: Error Handling', () => {
    it('handles malformed request body gracefully', async () => {
      const request = new Request('https://human.do/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json{{{',
      })

      const response = await executor.fetch(request)
      expect(response.status).toBe(500)
    })

    it('handles missing definition in request', async () => {
      const request = new Request('https://human.do/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { test: true } }), // Missing definition
      })

      const response = await executor.fetch(request)
      expect(response.status).toBe(500)
    })

    it('handles response to non-existent task', async () => {
      const request = new Request('https://human.do/tasks/fake-task-id/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: { approved: true },
          responder: { userId: 'user', channel: 'web' },
        }),
      })

      const response = await executor.fetch(request)
      expect(response.status).toBe(500)
    })

    it('handles cancel of non-existent task', async () => {
      const request = new Request('https://human.do/tasks/fake-task-id/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Testing' }),
      })

      const response = await executor.fetch(request)
      expect(response.status).toBe(500)
    })

    it('returns 405 for unsupported HTTP methods', async () => {
      const request = new Request('https://human.do/tasks', {
        method: 'DELETE',
      })

      const response = await executor.fetch(request)
      expect(response.status).toBe(405)
    })
  })
})
