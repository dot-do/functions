/**
 * Human Functions Executor Tests (RED Phase)
 *
 * These tests validate the HumanExecutor that handles human-in-the-loop functions.
 * Human functions require human input for:
 * - Approvals and decisions
 * - Reviews and feedback
 * - Data entry and annotation
 * - Verification and confirmation
 *
 * Default timeout: 24 hours
 * Implementation: Durable Object with task management
 *
 * @module tiers/human-executor.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  HumanFunctionDefinition,
  HumanFunctionConfig,
  HumanFunctionResult,
  HumanInteractionType,
  HumanUI,
  HumanTask,
  FormField,
  QuickAction,
  AssigneeConfig,
  EscalationConfig,
  SLAConfig,
  HumanExecutionInfo,
  ResponderInfo,
  ReminderConfig,
  UIContext,
} from '@dotdo/functions/human'

import {
  defineHumanFunction,
  approvalFunction,
  inputFunction,
} from '@dotdo/functions/human'

// The executor doesn't exist yet - this import will fail (RED phase)
import { HumanExecutor } from '../human-executor.js'

// =============================================================================
// MOCK TYPES AND UTILITIES
// =============================================================================

/**
 * Mock Durable Object storage for testing
 */
class MockDurableObjectStorage {
  private data: Map<string, unknown> = new Map()
  private alarms: number[] = []
  public putCalls: Array<{ key: string; value: unknown }> = []
  public getCalls: string[] = []

  async get<T = unknown>(key: string): Promise<T | undefined> {
    this.getCalls.push(key)
    return this.data.get(key) as T | undefined
  }

  async put(key: string, value: unknown): Promise<void> {
    this.putCalls.push({ key, value })
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

  // Test helpers
  getData(key: string): unknown {
    return this.data.get(key)
  }

  getAllData(): Map<string, unknown> {
    return new Map(this.data)
  }

  getAlarms(): number[] {
    return [...this.alarms]
  }

  clear(): void {
    this.data.clear()
    this.alarms = []
    this.putCalls = []
    this.getCalls = []
  }
}

/**
 * Mock Durable Object state
 */
class MockDurableObjectState {
  public storage: MockDurableObjectStorage
  public id: DurableObjectId

  constructor(id = 'test-human-executor-id') {
    this.storage = new MockDurableObjectStorage()
    this.id = { toString: () => id } as DurableObjectId
  }
}

/**
 * Mock environment bindings
 */
interface MockEnv {
  HUMAN_TASKS_DO?: DurableObjectNamespace
  NOTIFICATIONS?: {
    sendEmail: (to: string, subject: string, body: string) => Promise<void>
    sendSlack: (channel: string, message: string) => Promise<void>
    sendSms: (phone: string, message: string) => Promise<void>
    sendPush: (userId: string, title: string, body: string) => Promise<void>
  }
  USERS_KV?: KVNamespace
  TEAMS_KV?: KVNamespace
}

/**
 * Mock notification service for testing
 */
class MockNotificationService {
  public emailsSent: Array<{ to: string; subject: string; body: string }> = []
  public slacksSent: Array<{ channel: string; message: string }> = []
  public smsSent: Array<{ phone: string; message: string }> = []
  public pushSent: Array<{ userId: string; title: string; body: string }> = []

  async sendEmail(to: string, subject: string, body: string): Promise<void> {
    this.emailsSent.push({ to, subject, body })
  }

  async sendSlack(channel: string, message: string): Promise<void> {
    this.slacksSent.push({ channel, message })
  }

  async sendSms(phone: string, message: string): Promise<void> {
    this.smsSent.push({ phone, message })
  }

  async sendPush(userId: string, title: string, body: string): Promise<void> {
    this.pushSent.push({ userId, title, body })
  }

  clear(): void {
    this.emailsSent = []
    this.slacksSent = []
    this.smsSent = []
    this.pushSent = []
  }
}

/**
 * Create a test approval function definition
 */
function createTestApprovalFunction(
  overrides?: Partial<HumanFunctionDefinition>
): HumanFunctionDefinition {
  return defineHumanFunction({
    id: 'test-approval',
    name: 'Test Approval',
    version: '1.0.0',
    interactionType: 'approval',
    ui: {
      title: 'Approve Request',
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
 * Create a test input function definition
 */
function createTestInputFunction(
  fields: FormField[],
  overrides?: Partial<HumanFunctionDefinition>
): HumanFunctionDefinition {
  return defineHumanFunction({
    id: 'test-input',
    name: 'Test Input',
    version: '1.0.0',
    interactionType: 'input',
    ui: {
      title: 'Enter Data',
      description: 'Please fill out the form',
      form: fields,
    },
    ...overrides,
  })
}

/**
 * Simulate human response to a task
 */
async function simulateHumanResponse(
  executor: HumanExecutor,
  taskId: string,
  response: unknown,
  responder: ResponderInfo
): Promise<void> {
  await executor.submitResponse(taskId, response, responder)
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('HumanExecutor', () => {
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
  // 1. TASK CREATION
  // ===========================================================================

  describe('Task Creation', () => {
    it('should create HumanTask from definition', async () => {
      const definition = createTestApprovalFunction()
      const input = { requestId: 'REQ-001', amount: 1000 }

      const task = await executor.createTask(definition, input)

      expect(task).toBeDefined()
      expect(task.id).toBeDefined()
      expect(typeof task.id).toBe('string')
      expect(task.id.length).toBeGreaterThan(0)
    })

    it('should store task in Durable Object storage', async () => {
      const definition = createTestApprovalFunction()
      const input = { requestId: 'REQ-001' }

      const task = await executor.createTask(definition, input)

      const storedTask = mockState.storage.getData(`task:${task.id}`)
      expect(storedTask).toBeDefined()
      expect(storedTask).toMatchObject({
        id: task.id,
        status: 'pending',
      })
    })

    it('should return task ID and URL', async () => {
      const definition = createTestApprovalFunction()
      const input = { requestId: 'REQ-001' }

      const task = await executor.createTask(definition, input)

      expect(task.id).toBeDefined()
      expect(task.taskUrl).toBeDefined()
      expect(task.taskUrl).toMatch(/^https?:\/\//)
      expect(task.taskUrl).toContain(task.id)
    })

    it('should set initial status to pending', async () => {
      const definition = createTestApprovalFunction()
      const input = { requestId: 'REQ-001' }

      const task = await executor.createTask(definition, input)

      expect(task.status).toBe('pending')
    })

    it('should set createdAt timestamp', async () => {
      const definition = createTestApprovalFunction()
      const input = { requestId: 'REQ-001' }

      const now = Date.now()
      vi.setSystemTime(now)

      const task = await executor.createTask(definition, input)

      expect(task.createdAt).toBe(now)
    })

    it('should set expiresAt based on timeout', async () => {
      const definition = createTestApprovalFunction({ timeout: '1h' })
      const input = { requestId: 'REQ-001' }

      const now = Date.now()
      vi.setSystemTime(now)

      const task = await executor.createTask(definition, input)

      // 1 hour = 3600000ms
      expect(task.expiresAt).toBe(now + 3600000)
    })

    it('should use 24h default timeout when not specified', async () => {
      const definition = createTestApprovalFunction()
      delete definition.timeout
      const input = { requestId: 'REQ-001' }

      const now = Date.now()
      vi.setSystemTime(now)

      const task = await executor.createTask(definition, input)

      // 24 hours = 86400000ms
      expect(task.expiresAt).toBe(now + 86400000)
    })

    it('should store definition and input with task', async () => {
      const definition = createTestApprovalFunction()
      const input = { requestId: 'REQ-001', amount: 500 }

      const task = await executor.createTask(definition, input)

      const storedTask = mockState.storage.getData(`task:${task.id}`) as Record<string, unknown>
      expect(storedTask['definition']).toMatchObject({ id: definition.id })
      expect(storedTask['input']).toEqual(input)
    })
  })

  // ===========================================================================
  // 2. INTERACTION TYPES
  // ===========================================================================

  describe('Interaction Types', () => {
    it('should handle approval type (yes/no)', async () => {
      const definition = createTestApprovalFunction()
      const input = { requestId: 'REQ-001' }

      const task = await executor.createTask(definition, input)
      expect(task).toBeDefined()

      // Simulate approval
      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        channel: 'web',
      })

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('completed')
    })

    it('should handle review type (feedback)', async () => {
      const definition = defineHumanFunction({
        id: 'test-review',
        name: 'Test Review',
        version: '1.0.0',
        interactionType: 'review',
        ui: {
          title: 'Review Document',
          description: 'Please review and provide feedback',
          form: [
            { name: 'rating', label: 'Rating', type: 'number', required: true },
            { name: 'feedback', label: 'Feedback', type: 'textarea', required: true },
          ],
        },
      })
      const input = { documentId: 'DOC-001' }

      const task = await executor.createTask(definition, input)

      await simulateHumanResponse(executor, task.id, {
        rating: 4,
        feedback: 'Looks good, minor changes needed',
      }, {
        userId: 'reviewer-1',
        channel: 'web',
      })

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('completed')
    })

    it('should handle input type (form data)', async () => {
      const definition = createTestInputFunction([
        { name: 'firstName', label: 'First Name', type: 'text', required: true },
        { name: 'lastName', label: 'Last Name', type: 'text', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
      ])
      const input = {}

      const task = await executor.createTask(definition, input)

      await simulateHumanResponse(executor, task.id, {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      }, {
        userId: 'user-1',
        channel: 'web',
      })

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('completed')
    })

    it('should handle selection type (choose option)', async () => {
      const definition = defineHumanFunction({
        id: 'test-selection',
        name: 'Test Selection',
        version: '1.0.0',
        interactionType: 'selection',
        ui: {
          title: 'Select Option',
          description: 'Choose the best option',
          form: [
            {
              name: 'option',
              label: 'Options',
              type: 'radio',
              required: true,
              options: [
                { value: 'a', label: 'Option A' },
                { value: 'b', label: 'Option B' },
                { value: 'c', label: 'Option C' },
              ],
            },
          ],
        },
      })
      const input = { context: 'Select best deployment strategy' }

      const task = await executor.createTask(definition, input)

      await simulateHumanResponse(executor, task.id, { option: 'b' }, {
        userId: 'user-1',
        channel: 'web',
      })

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('completed')
    })

    it('should handle annotation type (label data)', async () => {
      const definition = defineHumanFunction({
        id: 'test-annotation',
        name: 'Test Annotation',
        version: '1.0.0',
        interactionType: 'annotation',
        ui: {
          title: 'Annotate Data',
          description: 'Label the following items',
          form: [
            {
              name: 'labels',
              label: 'Labels',
              type: 'multiselect',
              required: true,
              options: [
                { value: 'positive', label: 'Positive' },
                { value: 'negative', label: 'Negative' },
                { value: 'neutral', label: 'Neutral' },
              ],
            },
            { name: 'notes', label: 'Notes', type: 'textarea' },
          ],
        },
      })
      const input = { dataId: 'DATA-001', content: 'Sample text to annotate' }

      const task = await executor.createTask(definition, input)

      await simulateHumanResponse(executor, task.id, {
        labels: ['positive'],
        notes: 'Clear positive sentiment',
      }, {
        userId: 'annotator-1',
        channel: 'web',
      })

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('completed')
    })

    it('should handle verification type (confirm)', async () => {
      const definition = defineHumanFunction({
        id: 'test-verification',
        name: 'Test Verification',
        version: '1.0.0',
        interactionType: 'verification',
        ui: {
          title: 'Verify Information',
          description: 'Please verify the following information is correct',
          context: [
            { type: 'json', label: 'Data', content: { name: 'John Doe', age: 30 } },
          ],
          quickActions: [
            { id: 'verify', label: 'Verify', variant: 'primary', value: { verified: true } },
            { id: 'reject', label: 'Incorrect', variant: 'danger', value: { verified: false } },
          ],
        },
      })
      const input = { recordId: 'REC-001' }

      const task = await executor.createTask(definition, input)

      await simulateHumanResponse(executor, task.id, { verified: true }, {
        userId: 'verifier-1',
        channel: 'web',
      })

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('completed')
    })

    it('should handle custom type (form)', async () => {
      const definition = defineHumanFunction({
        id: 'test-custom',
        name: 'Test Custom Form',
        version: '1.0.0',
        interactionType: 'custom',
        ui: {
          title: 'Custom Workflow',
          description: 'Complete this custom form',
          form: [
            { name: 'field1', label: 'Field 1', type: 'text' },
            { name: 'field2', label: 'Field 2', type: 'number' },
            { name: 'field3', label: 'Field 3', type: 'date' },
            { name: 'field4', label: 'Field 4', type: 'json' },
          ],
        },
      })
      const input = { workflowId: 'WF-001' }

      const task = await executor.createTask(definition, input)

      await simulateHumanResponse(executor, task.id, {
        field1: 'value1',
        field2: 42,
        field3: '2024-01-15',
        field4: { custom: 'data' },
      }, {
        userId: 'user-1',
        channel: 'api',
      })

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('completed')
    })
  })

  // ===========================================================================
  // 3. UI CONFIGURATION
  // ===========================================================================

  describe('UI Configuration', () => {
    it('should render title and description', async () => {
      const definition = createTestApprovalFunction({
        ui: {
          title: 'Approve Purchase Order',
          description: 'Review and approve the following purchase order',
          quickActions: [],
        },
      })

      const task = await executor.createTask(definition, {})
      const taskData = mockState.storage.getData(`task:${task.id}`) as Record<string, unknown>
      const ui = (taskData['definition'] as HumanFunctionDefinition).ui

      expect(ui.title).toBe('Approve Purchase Order')
      expect(ui.description).toBe('Review and approve the following purchase order')
    })

    it('should render context items by type - text', async () => {
      const definition = createTestApprovalFunction({
        ui: {
          title: 'Review',
          context: [
            { type: 'text', label: 'Summary', content: 'This is a text summary' },
          ],
          quickActions: [],
        },
      })

      const task = await executor.createTask(definition, {})
      const ui = await executor.getTaskUI(task.id)

      expect(ui?.context).toHaveLength(1)
      expect(ui?.context?.[0].type).toBe('text')
      expect(ui?.context?.[0].content).toBe('This is a text summary')
    })

    it('should render context items by type - code', async () => {
      const definition = createTestApprovalFunction({
        ui: {
          title: 'Review Code Change',
          context: [
            { type: 'code', label: 'Code', content: 'const x = 1;\nconst y = 2;' },
          ],
          quickActions: [],
        },
      })

      const task = await executor.createTask(definition, {})
      const ui = await executor.getTaskUI(task.id)

      expect(ui?.context?.[0].type).toBe('code')
    })

    it('should render context items by type - json', async () => {
      const definition = createTestApprovalFunction({
        ui: {
          title: 'Review Data',
          context: [
            { type: 'json', label: 'Data', content: { key: 'value', nested: { a: 1 } } },
          ],
          quickActions: [],
        },
      })

      const task = await executor.createTask(definition, {})
      const ui = await executor.getTaskUI(task.id)

      expect(ui?.context?.[0].type).toBe('json')
      expect(ui?.context?.[0].content).toEqual({ key: 'value', nested: { a: 1 } })
    })

    it('should render context items by type - table', async () => {
      const definition = createTestApprovalFunction({
        ui: {
          title: 'Review Table',
          context: [
            {
              type: 'table',
              label: 'Items',
              content: [
                { id: 1, name: 'Item 1', price: 10 },
                { id: 2, name: 'Item 2', price: 20 },
              ],
            },
          ],
          quickActions: [],
        },
      })

      const task = await executor.createTask(definition, {})
      const ui = await executor.getTaskUI(task.id)

      expect(ui?.context?.[0].type).toBe('table')
    })

    it('should render context items by type - image', async () => {
      const definition = createTestApprovalFunction({
        ui: {
          title: 'Review Image',
          context: [
            { type: 'image', label: 'Screenshot', content: 'https://example.com/image.png' },
          ],
          quickActions: [],
        },
      })

      const task = await executor.createTask(definition, {})
      const ui = await executor.getTaskUI(task.id)

      expect(ui?.context?.[0].type).toBe('image')
    })

    it('should render context items by type - link', async () => {
      const definition = createTestApprovalFunction({
        ui: {
          title: 'Review Link',
          context: [
            { type: 'link', label: 'Reference', content: 'https://example.com/doc' },
          ],
          quickActions: [],
        },
      })

      const task = await executor.createTask(definition, {})
      const ui = await executor.getTaskUI(task.id)

      expect(ui?.context?.[0].type).toBe('link')
    })

    it('should render context items by type - diff', async () => {
      const definition = createTestApprovalFunction({
        ui: {
          title: 'Review Changes',
          context: [
            {
              type: 'diff',
              label: 'Changes',
              content: '--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2;',
            },
          ],
          quickActions: [],
        },
      })

      const task = await executor.createTask(definition, {})
      const ui = await executor.getTaskUI(task.id)

      expect(ui?.context?.[0].type).toBe('diff')
    })

    it('should render form fields by type', async () => {
      const formFields: FormField[] = [
        { name: 'textField', label: 'Text', type: 'text' },
        { name: 'textareaField', label: 'Textarea', type: 'textarea' },
        { name: 'numberField', label: 'Number', type: 'number' },
        { name: 'emailField', label: 'Email', type: 'email' },
        { name: 'selectField', label: 'Select', type: 'select', options: [{ value: 'a', label: 'A' }] },
        { name: 'checkboxField', label: 'Checkbox', type: 'checkbox' },
        { name: 'dateField', label: 'Date', type: 'date' },
      ]

      const definition = createTestInputFunction(formFields)
      const task = await executor.createTask(definition, {})
      const ui = await executor.getTaskUI(task.id)

      expect(ui?.form).toHaveLength(7)
      expect(ui?.form?.map(f => f.type)).toEqual([
        'text', 'textarea', 'number', 'email', 'select', 'checkbox', 'date',
      ])
    })

    it('should render quick actions for approval', async () => {
      const definition = createTestApprovalFunction()
      const task = await executor.createTask(definition, {})
      const ui = await executor.getTaskUI(task.id)

      expect(ui?.quickActions).toHaveLength(2)
      expect(ui?.quickActions?.[0]).toMatchObject({
        id: 'approve',
        label: 'Approve',
        variant: 'primary',
      })
      expect(ui?.quickActions?.[1]).toMatchObject({
        id: 'reject',
        label: 'Reject',
        variant: 'danger',
      })
    })

    it('should support collapsible context items', async () => {
      const definition = createTestApprovalFunction({
        ui: {
          title: 'Review',
          context: [
            { type: 'json', label: 'Large Data', content: { data: 'large' }, collapsible: true },
          ],
          quickActions: [],
        },
      })

      const task = await executor.createTask(definition, {})
      const ui = await executor.getTaskUI(task.id)

      expect(ui?.context?.[0].collapsible).toBe(true)
    })

    it('should support priority indicator', async () => {
      const definition = createTestApprovalFunction({
        ui: {
          title: 'Urgent Approval',
          priority: 'urgent',
          quickActions: [],
        },
      })

      const task = await executor.createTask(definition, {})
      const ui = await executor.getTaskUI(task.id)

      expect(ui?.priority).toBe('urgent')
    })
  })

  // ===========================================================================
  // 4. ASSIGNEE ROUTING
  // ===========================================================================

  describe('Assignee Routing', () => {
    it('should route to specific users', async () => {
      const definition = createTestApprovalFunction({
        assignees: {
          users: ['user-1', 'user-2'],
        },
      })

      const task = await executor.createTask(definition, {})
      const taskData = mockState.storage.getData(`task:${task.id}`) as Record<string, unknown>

      expect(taskData['assignees']).toEqual(['user-1', 'user-2'])
    })

    it('should route to teams', async () => {
      const definition = createTestApprovalFunction({
        assignees: {
          teams: ['engineering', 'product'],
        },
      })

      const task = await executor.createTask(definition, {})
      const routing = await executor.getTaskRouting(task.id)

      expect(routing.teams).toEqual(['engineering', 'product'])
    })

    it('should route by role', async () => {
      const definition = createTestApprovalFunction({
        assignees: {
          roles: ['manager', 'admin'],
        },
      })

      const task = await executor.createTask(definition, {})
      const routing = await executor.getTaskRouting(task.id)

      expect(routing.roles).toEqual(['manager', 'admin'])
    })

    it('should apply autoAssign rules', async () => {
      const definition = createTestApprovalFunction({
        assignees: {
          autoAssign: {
            field: 'department',
            mapping: {
              engineering: 'eng-lead',
              sales: 'sales-lead',
            },
            default: 'general-manager',
          },
        },
      })

      // Input with department = engineering
      const task = await executor.createTask(definition, { department: 'engineering' })
      const routing = await executor.getTaskRouting(task.id)

      expect(routing.autoAssignedTo).toBe('eng-lead')
    })

    it('should apply autoAssign default when no mapping match', async () => {
      const definition = createTestApprovalFunction({
        assignees: {
          autoAssign: {
            field: 'department',
            mapping: {
              engineering: 'eng-lead',
            },
            default: 'general-manager',
          },
        },
      })

      // Input with unknown department
      const task = await executor.createTask(definition, { department: 'marketing' })
      const routing = await executor.getTaskRouting(task.id)

      expect(routing.autoAssignedTo).toBe('general-manager')
    })

    it('should support roundRobin assignment', async () => {
      const definition = createTestApprovalFunction({
        assignees: {
          users: ['user-1', 'user-2', 'user-3'],
          roundRobin: true,
        },
      })

      // Create multiple tasks
      const task1 = await executor.createTask(definition, { id: 1 })
      const task2 = await executor.createTask(definition, { id: 2 })
      const task3 = await executor.createTask(definition, { id: 3 })

      const routing1 = await executor.getTaskRouting(task1.id)
      const routing2 = await executor.getTaskRouting(task2.id)
      const routing3 = await executor.getTaskRouting(task3.id)

      // Should distribute across users
      const assignees = [routing1.assignedTo, routing2.assignedTo, routing3.assignedTo]
      expect(assignees).toContain('user-1')
      expect(assignees).toContain('user-2')
      expect(assignees).toContain('user-3')
    })

    it('should override assignees via config', async () => {
      const definition = createTestApprovalFunction({
        assignees: {
          users: ['default-user'],
        },
      })

      const config: HumanFunctionConfig = {
        assignees: {
          users: ['override-user'],
        },
      }

      const task = await executor.createTask(definition, {}, config)
      const routing = await executor.getTaskRouting(task.id)

      expect(routing.assignedTo).toBe('override-user')
    })
  })

  // ===========================================================================
  // 5. REMINDERS
  // ===========================================================================

  describe('Reminders', () => {
    it('should send first reminder after configured time', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        reminders: {
          firstReminder: '1h',
          channels: ['email'],
        },
      })

      const task = await executor.createTask(definition, {})

      // Advance time by 1 hour
      vi.advanceTimersByTime(3600000)
      await executor.alarm()

      expect(mockNotifications.emailsSent).toHaveLength(1)
      expect(mockNotifications.emailsSent[0].to).toBe('user-1')
    })

    it('should send follow-up reminders at interval', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        reminders: {
          firstReminder: '1h',
          interval: '30m',
          maxReminders: 3,
          channels: ['email'],
        },
      })

      const task = await executor.createTask(definition, {})

      // First reminder at 1h
      vi.advanceTimersByTime(3600000)
      await executor.alarm()
      expect(mockNotifications.emailsSent).toHaveLength(1)

      // Second reminder at 1h + 30m
      vi.advanceTimersByTime(1800000)
      await executor.alarm()
      expect(mockNotifications.emailsSent).toHaveLength(2)

      // Third reminder at 1h + 60m
      vi.advanceTimersByTime(1800000)
      await executor.alarm()
      expect(mockNotifications.emailsSent).toHaveLength(3)
    })

    it('should respect maxReminders limit', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        reminders: {
          firstReminder: '1h',
          interval: '30m',
          maxReminders: 2,
          channels: ['email'],
        },
      })

      const task = await executor.createTask(definition, {})

      // First reminder
      vi.advanceTimersByTime(3600000)
      await executor.alarm()

      // Second reminder
      vi.advanceTimersByTime(1800000)
      await executor.alarm()

      // Should not send third reminder
      vi.advanceTimersByTime(1800000)
      await executor.alarm()

      expect(mockNotifications.emailsSent).toHaveLength(2)
    })

    it('should use configured channels - email', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        reminders: {
          firstReminder: '1h',
          channels: ['email'],
        },
      })

      await executor.createTask(definition, {})
      vi.advanceTimersByTime(3600000)
      await executor.alarm()

      expect(mockNotifications.emailsSent).toHaveLength(1)
      expect(mockNotifications.slacksSent).toHaveLength(0)
    })

    it('should use configured channels - slack', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        reminders: {
          firstReminder: '1h',
          channels: ['slack'],
        },
      })

      await executor.createTask(definition, {})
      vi.advanceTimersByTime(3600000)
      await executor.alarm()

      expect(mockNotifications.slacksSent).toHaveLength(1)
    })

    it('should use configured channels - sms', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        reminders: {
          firstReminder: '1h',
          channels: ['sms'],
        },
      })

      await executor.createTask(definition, {})
      vi.advanceTimersByTime(3600000)
      await executor.alarm()

      expect(mockNotifications.smsSent).toHaveLength(1)
    })

    it('should use configured channels - push', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        reminders: {
          firstReminder: '1h',
          channels: ['push'],
        },
      })

      await executor.createTask(definition, {})
      vi.advanceTimersByTime(3600000)
      await executor.alarm()

      expect(mockNotifications.pushSent).toHaveLength(1)
    })

    it('should use multiple channels', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        reminders: {
          firstReminder: '1h',
          channels: ['email', 'slack', 'push'],
        },
      })

      await executor.createTask(definition, {})
      vi.advanceTimersByTime(3600000)
      await executor.alarm()

      expect(mockNotifications.emailsSent).toHaveLength(1)
      expect(mockNotifications.slacksSent).toHaveLength(1)
      expect(mockNotifications.pushSent).toHaveLength(1)
    })

    it('should not send reminders for completed tasks', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        reminders: {
          firstReminder: '1h',
          channels: ['email'],
        },
      })

      const task = await executor.createTask(definition, {})

      // Complete the task before reminder time
      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        channel: 'web',
      })

      // Advance time past reminder
      vi.advanceTimersByTime(3600000)
      await executor.alarm()

      expect(mockNotifications.emailsSent).toHaveLength(0)
    })
  })

  // ===========================================================================
  // 6. ESCALATION
  // ===========================================================================

  describe('Escalation', () => {
    it('should escalate after timeout per tier', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        escalation: {
          trigger: 'timeout',
          tiers: [
            { after: '2h', assignees: { users: ['manager-1'] }, message: 'Escalated to manager' },
          ],
        },
      })

      const task = await executor.createTask(definition, {})

      // Advance time past escalation threshold
      vi.advanceTimersByTime(7200000) // 2 hours
      await executor.alarm()

      const routing = await executor.getTaskRouting(task.id)
      expect(routing.escalatedTo).toContain('manager-1')
    })

    it('should route to escalation assignees', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        escalation: {
          trigger: 'timeout',
          tiers: [
            {
              after: '1h',
              assignees: {
                users: ['escalation-user-1'],
                teams: ['escalation-team'],
                roles: ['escalation-role'],
              },
            },
          ],
        },
      })

      const task = await executor.createTask(definition, {})

      vi.advanceTimersByTime(3600000)
      await executor.alarm()

      const routing = await executor.getTaskRouting(task.id)
      expect(routing.escalatedTo).toContain('escalation-user-1')
      expect(routing.escalatedTeams).toContain('escalation-team')
      expect(routing.escalatedRoles).toContain('escalation-role')
    })

    it('should send escalation message', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        escalation: {
          trigger: 'timeout',
          tiers: [
            {
              after: '1h',
              assignees: { users: ['manager-1'] },
              message: 'Task escalated: needs immediate attention',
            },
          ],
        },
        reminders: {
          channels: ['email'],
        },
      })

      const task = await executor.createTask(definition, {})

      vi.advanceTimersByTime(3600000)
      await executor.alarm()

      // Should send notification with escalation message
      const escalationEmail = mockNotifications.emailsSent.find(
        e => e.body.includes('escalated')
      )
      expect(escalationEmail).toBeDefined()
    })

    it('should trigger on timeout', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        escalation: {
          trigger: 'timeout',
          tiers: [{ after: '1h', assignees: { users: ['manager-1'] } }],
        },
      })

      const task = await executor.createTask(definition, {})

      vi.advanceTimersByTime(3600000)
      await executor.alarm()

      const routing = await executor.getTaskRouting(task.id)
      expect(routing.escalatedTo).toBeDefined()
    })

    it('should trigger on rejection', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        escalation: {
          trigger: 'rejection',
          tiers: [{ after: '0s', assignees: { users: ['manager-1'] } }],
        },
      })

      const task = await executor.createTask(definition, {})

      await simulateHumanResponse(executor, task.id, { approved: false }, {
        userId: 'user-1',
        channel: 'web',
      })

      const routing = await executor.getTaskRouting(task.id)
      expect(routing.escalatedTo).toContain('manager-1')
    })

    it('should trigger on both timeout and rejection', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        escalation: {
          trigger: 'both',
          tiers: [{ after: '1h', assignees: { users: ['manager-1'] } }],
        },
      })

      const task1 = await executor.createTask(definition, { id: 1 })

      // Test timeout trigger
      vi.advanceTimersByTime(3600000)
      await executor.alarm()
      const routing1 = await executor.getTaskRouting(task1.id)
      expect(routing1.escalatedTo).toBeDefined()

      // Reset and test rejection trigger
      const task2 = await executor.createTask(definition, { id: 2 })
      await simulateHumanResponse(executor, task2.id, { approved: false }, {
        userId: 'user-1',
        channel: 'web',
      })
      const routing2 = await executor.getTaskRouting(task2.id)
      expect(routing2.escalatedTo).toBeDefined()
    })

    it('should support multiple escalation tiers', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        escalation: {
          trigger: 'timeout',
          tiers: [
            { after: '1h', assignees: { users: ['manager-1'] }, message: 'Tier 1' },
            { after: '2h', assignees: { users: ['director-1'] }, message: 'Tier 2' },
            { after: '4h', assignees: { users: ['vp-1'] }, message: 'Tier 3' },
          ],
        },
      })

      const task = await executor.createTask(definition, {})

      // Tier 1 escalation
      vi.advanceTimersByTime(3600000)
      await executor.alarm()
      let routing = await executor.getTaskRouting(task.id)
      expect(routing.escalatedTo).toContain('manager-1')

      // Tier 2 escalation
      vi.advanceTimersByTime(3600000)
      await executor.alarm()
      routing = await executor.getTaskRouting(task.id)
      expect(routing.escalatedTo).toContain('director-1')

      // Tier 3 escalation
      vi.advanceTimersByTime(7200000)
      await executor.alarm()
      routing = await executor.getTaskRouting(task.id)
      expect(routing.escalatedTo).toContain('vp-1')
    })
  })

  // ===========================================================================
  // 7. SLA ENFORCEMENT
  // ===========================================================================

  describe('SLA Enforcement', () => {
    it('should track responseTime SLA', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        sla: {
          responseTime: '1h',
          resolutionTime: '4h',
        },
      })

      const task = await executor.createTask(definition, {})

      // Respond within SLA
      vi.advanceTimersByTime(1800000) // 30 minutes
      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        channel: 'web',
      })

      const result = await executor.execute(definition, {})
      expect(result.humanExecution.slaMet).toBe(true)
    })

    it('should track resolutionTime SLA', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        sla: {
          responseTime: '1h',
          resolutionTime: '4h',
        },
      })

      const task = await executor.createTask(definition, {})

      // Complete within resolution SLA
      vi.advanceTimersByTime(10800000) // 3 hours
      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        channel: 'web',
      })

      const result = await executor.execute(definition, {})
      expect(result.humanExecution.slaMet).toBe(true)
    })

    it('should trigger onBreach action - notify', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        sla: {
          responseTime: '1h',
          resolutionTime: '4h',
          onBreach: 'notify',
        },
        reminders: {
          channels: ['email'],
        },
      })

      const task = await executor.createTask(definition, {})

      // Exceed response time SLA
      vi.advanceTimersByTime(3600001)
      await executor.alarm()

      // Should send breach notification
      const breachNotification = mockNotifications.emailsSent.find(
        e => e.subject.includes('SLA') || e.body.includes('SLA')
      )
      expect(breachNotification).toBeDefined()
    })

    it('should trigger onBreach action - escalate', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        sla: {
          responseTime: '1h',
          resolutionTime: '4h',
          onBreach: 'escalate',
        },
        escalation: {
          trigger: 'timeout',
          tiers: [{ after: '0s', assignees: { users: ['manager-1'] } }],
        },
      })

      const task = await executor.createTask(definition, {})

      vi.advanceTimersByTime(3600001)
      await executor.alarm()

      const routing = await executor.getTaskRouting(task.id)
      expect(routing.escalatedTo).toBeDefined()
    })

    it('should trigger onBreach action - auto-approve', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        sla: {
          responseTime: '1h',
          resolutionTime: '4h',
          onBreach: 'auto-approve',
        },
      })

      const task = await executor.createTask(definition, {})

      vi.advanceTimersByTime(14400001) // 4 hours + 1ms
      await executor.alarm()

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('completed')
    })

    it('should trigger onBreach action - auto-reject', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        sla: {
          responseTime: '1h',
          resolutionTime: '4h',
          onBreach: 'auto-reject',
        },
      })

      const task = await executor.createTask(definition, {})

      vi.advanceTimersByTime(14400001)
      await executor.alarm()

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('completed')
    })

    it('should send warning at warningThreshold', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        sla: {
          responseTime: '1h',
          resolutionTime: '4h',
          warningThreshold: 80, // 80% of time
        },
        reminders: {
          channels: ['email'],
        },
      })

      const task = await executor.createTask(definition, {})

      // 80% of 1h = 48 minutes
      vi.advanceTimersByTime(2880000)
      await executor.alarm()

      // Should send SLA warning
      const warningNotification = mockNotifications.emailsSent.find(
        e => e.body.includes('warning') || e.body.includes('approaching')
      )
      expect(warningNotification).toBeDefined()
    })

    it('should mark SLA as breached when exceeded', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        sla: {
          responseTime: '1h',
          resolutionTime: '4h',
        },
      })

      const task = await executor.createTask(definition, {})

      // Exceed resolution time
      vi.advanceTimersByTime(14400001)
      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        channel: 'web',
      })

      const result = await executor.execute(definition, {})
      expect(result.humanExecution.slaMet).toBe(false)
    })
  })

  // ===========================================================================
  // 8. TIMEOUT HANDLING
  // ===========================================================================

  describe('Timeout Handling', () => {
    it('should enforce 24h default timeout', async () => {
      const definition = createTestApprovalFunction()
      delete definition.timeout

      const task = await executor.createTask(definition, {})

      // Advance past 24 hours
      vi.advanceTimersByTime(86400001)
      await executor.alarm()

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('expired')
    })

    it('should respect custom timeout', async () => {
      const definition = createTestApprovalFunction({ timeout: '1h' })

      const task = await executor.createTask(definition, {})

      // Advance past 1 hour
      vi.advanceTimersByTime(3600001)
      await executor.alarm()

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('expired')
    })

    it('should return timeout error when exceeded', async () => {
      const definition = createTestApprovalFunction({ timeout: '1h' })

      const task = await executor.createTask(definition, {})

      vi.advanceTimersByTime(3600001)
      await executor.alarm()

      // Attempting to get result should indicate timeout
      const result = await executor.waitForResult(task.id)
      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('TIMEOUT')
    })

    it('should support skipConditions for auto-approval', async () => {
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

      // Input matches skip condition
      const result = await executor.execute(definition, { amount: 50 }, config)

      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({ approved: true })
      expect(result.humanExecution.skipped).toBe(true)
      expect(result.humanExecution.skipReason).toContain('small amount')
    })

    it('should not skip when condition does not match', async () => {
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

      // Input does not match skip condition
      const task = await executor.createTask(definition, { amount: 500 }, config)

      expect(task.status).toBe('pending')
    })

    it('should support various skip condition operators', async () => {
      const definition = createTestApprovalFunction()

      // Test 'eq' operator
      let config: HumanFunctionConfig = {
        skipConditions: [{ field: 'status', operator: 'eq', value: 'approved', output: { approved: true } }],
      }
      let result = await executor.execute(definition, { status: 'approved' }, config)
      expect(result.humanExecution.skipped).toBe(true)

      // Test 'ne' operator
      config = {
        skipConditions: [{ field: 'status', operator: 'ne', value: 'rejected', output: { approved: true } }],
      }
      result = await executor.execute(definition, { status: 'approved' }, config)
      expect(result.humanExecution.skipped).toBe(true)

      // Test 'gt' operator
      config = {
        skipConditions: [{ field: 'score', operator: 'gt', value: 90, output: { approved: true } }],
      }
      result = await executor.execute(definition, { score: 95 }, config)
      expect(result.humanExecution.skipped).toBe(true)

      // Test 'contains' operator
      config = {
        skipConditions: [{ field: 'tags', operator: 'contains', value: 'auto', output: { approved: true } }],
      }
      result = await executor.execute(definition, { tags: ['auto', 'fast'] }, config)
      expect(result.humanExecution.skipped).toBe(true)
    })
  })

  // ===========================================================================
  // 9. RESPONSE COLLECTION
  // ===========================================================================

  describe('Response Collection', () => {
    it('should wait for human response', async () => {
      const definition = createTestApprovalFunction()

      const task = await executor.createTask(definition, {})

      // Task should be pending
      expect(task.status).toBe('pending')

      // Simulate human response after delay
      setTimeout(async () => {
        await simulateHumanResponse(executor, task.id, { approved: true }, {
          userId: 'user-1',
          channel: 'web',
        })
      }, 1000)

      vi.advanceTimersByTime(1000)

      const result = await executor.waitForResult(task.id)
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({ approved: true })
    })

    it('should validate response against outputSchema', async () => {
      const definition = createTestInputFunction([
        { name: 'email', label: 'Email', type: 'email', required: true },
      ], {
        outputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
          },
          required: ['email'],
        },
      })

      const task = await executor.createTask(definition, {})

      // Invalid response
      await expect(
        simulateHumanResponse(executor, task.id, { email: 'not-an-email' }, {
          userId: 'user-1',
          channel: 'web',
        })
      ).rejects.toThrow(/validation/i)
    })

    it('should record respondedBy info', async () => {
      const definition = createTestApprovalFunction()
      const task = await executor.createTask(definition, {})

      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-123',
        email: 'user@example.com',
        name: 'John Doe',
        channel: 'web',
      })

      const result = await executor.waitForResult(task.id)

      expect(result.humanExecution.respondedBy).toMatchObject({
        userId: 'user-123',
        email: 'user@example.com',
        name: 'John Doe',
        channel: 'web',
      })
    })

    it('should record responseTimeMs', async () => {
      const definition = createTestApprovalFunction()

      const now = Date.now()
      vi.setSystemTime(now)

      const task = await executor.createTask(definition, {})

      // Advance time by 5 minutes
      vi.advanceTimersByTime(300000)

      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        channel: 'web',
      })

      const result = await executor.waitForResult(task.id)

      expect(result.humanExecution.responseTimeMs).toBe(300000)
    })

    it('should reject invalid responses', async () => {
      const definition = createTestInputFunction([
        { name: 'count', label: 'Count', type: 'number', required: true },
      ])

      const task = await executor.createTask(definition, {})

      // Missing required field
      await expect(
        simulateHumanResponse(executor, task.id, {}, {
          userId: 'user-1',
          channel: 'web',
        })
      ).rejects.toThrow(/required/i)
    })

    it('should accept response via different channels', async () => {
      const definition = createTestApprovalFunction()

      // Test web channel
      let task = await executor.createTask(definition, { id: 1 })
      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        channel: 'web',
      })
      let result = await executor.waitForResult(task.id)
      expect(result.humanExecution.respondedBy.channel).toBe('web')

      // Test email channel
      task = await executor.createTask(definition, { id: 2 })
      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        channel: 'email',
      })
      result = await executor.waitForResult(task.id)
      expect(result.humanExecution.respondedBy.channel).toBe('email')

      // Test slack channel
      task = await executor.createTask(definition, { id: 3 })
      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        channel: 'slack',
      })
      result = await executor.waitForResult(task.id)
      expect(result.humanExecution.respondedBy.channel).toBe('slack')

      // Test API channel
      task = await executor.createTask(definition, { id: 4 })
      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        channel: 'api',
      })
      result = await executor.waitForResult(task.id)
      expect(result.humanExecution.respondedBy.channel).toBe('api')
    })
  })

  // ===========================================================================
  // 10. EXECUTION INFO
  // ===========================================================================

  describe('Execution Info', () => {
    it('should return humanExecution.respondedBy', async () => {
      const definition = createTestApprovalFunction()
      const task = await executor.createTask(definition, {})

      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-123',
        email: 'user@example.com',
        name: 'John Doe',
        channel: 'web',
      })

      const result = await executor.waitForResult(task.id)

      expect(result.humanExecution.respondedBy).toBeDefined()
      expect(result.humanExecution.respondedBy.userId).toBe('user-123')
    })

    it('should return humanExecution.assignedAt', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
      })

      const now = Date.now()
      vi.setSystemTime(now)

      const task = await executor.createTask(definition, {})

      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        channel: 'web',
      })

      const result = await executor.waitForResult(task.id)

      expect(result.humanExecution.assignedAt).toBe(now)
    })

    it('should return humanExecution.respondedAt', async () => {
      const definition = createTestApprovalFunction()

      const createTime = Date.now()
      vi.setSystemTime(createTime)

      const task = await executor.createTask(definition, {})

      const responseTime = createTime + 300000
      vi.setSystemTime(responseTime)

      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        channel: 'web',
      })

      const result = await executor.waitForResult(task.id)

      expect(result.humanExecution.respondedAt).toBe(responseTime)
    })

    it('should return humanExecution.responseTimeMs', async () => {
      const definition = createTestApprovalFunction()

      const task = await executor.createTask(definition, {})

      vi.advanceTimersByTime(600000) // 10 minutes

      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        channel: 'web',
      })

      const result = await executor.waitForResult(task.id)

      expect(result.humanExecution.responseTimeMs).toBe(600000)
    })

    it('should return humanExecution.slaMet', async () => {
      const definition = createTestApprovalFunction({
        sla: {
          responseTime: '1h',
          resolutionTime: '4h',
        },
      })

      const task = await executor.createTask(definition, {})

      // Respond within SLA
      vi.advanceTimersByTime(1800000) // 30 minutes

      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        channel: 'web',
      })

      const result = await executor.waitForResult(task.id)

      expect(result.humanExecution.slaMet).toBe(true)
    })

    it('should return humanExecution.remindersSent', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        reminders: {
          firstReminder: '1h',
          interval: '30m',
          maxReminders: 3,
          channels: ['email'],
        },
      })

      const task = await executor.createTask(definition, {})

      // Trigger 2 reminders
      vi.advanceTimersByTime(3600000)
      await executor.alarm()
      vi.advanceTimersByTime(1800000)
      await executor.alarm()

      // Then respond
      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        channel: 'web',
      })

      const result = await executor.waitForResult(task.id)

      expect(result.humanExecution.remindersSent).toBe(2)
    })

    it('should return humanExecution.escalations', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        escalation: {
          trigger: 'timeout',
          tiers: [
            { after: '1h', assignees: { users: ['manager-1'] } },
            { after: '2h', assignees: { users: ['director-1'] } },
          ],
        },
      })

      const task = await executor.createTask(definition, {})

      // Trigger escalations
      vi.advanceTimersByTime(3600000)
      await executor.alarm()
      vi.advanceTimersByTime(3600000)
      await executor.alarm()

      // Then respond
      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'director-1',
        channel: 'web',
      })

      const result = await executor.waitForResult(task.id)

      expect(result.humanExecution.escalations).toHaveLength(2)
      expect(result.humanExecution.escalations[0].tier).toBe(1)
      expect(result.humanExecution.escalations[1].tier).toBe(2)
    })

    it('should return humanExecution.skipped', async () => {
      const definition = createTestApprovalFunction()

      const config: HumanFunctionConfig = {
        skipConditions: [
          { field: 'autoApprove', operator: 'eq', value: true, output: { approved: true } },
        ],
      }

      const result = await executor.execute(definition, { autoApprove: true }, config)

      expect(result.humanExecution.skipped).toBe(true)
    })

    it('should include all execution info in result', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        sla: {
          responseTime: '1h',
          resolutionTime: '4h',
        },
        reminders: {
          firstReminder: '30m',
          channels: ['email'],
        },
      })

      const task = await executor.createTask(definition, {})

      // Trigger a reminder
      vi.advanceTimersByTime(1800000)
      await executor.alarm()

      // Respond
      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        email: 'user@example.com',
        channel: 'web',
      })

      const result = await executor.waitForResult(task.id)

      expect(result.humanExecution).toMatchObject({
        respondedBy: expect.objectContaining({ userId: 'user-1' }),
        assignedAt: expect.any(Number),
        respondedAt: expect.any(Number),
        responseTimeMs: expect.any(Number),
        slaMet: true,
        remindersSent: 1,
        escalations: [],
        skipped: false,
      })
    })
  })

  // ===========================================================================
  // 11. TASK MANAGEMENT
  // ===========================================================================

  describe('Task Management', () => {
    it('should getTask returns current status', async () => {
      const definition = createTestApprovalFunction()
      const task = await executor.createTask(definition, {})

      const retrievedTask = await executor.getTask(task.id)

      expect(retrievedTask).toBeDefined()
      expect(retrievedTask?.id).toBe(task.id)
      expect(retrievedTask?.status).toBe('pending')
    })

    it('should getTask returns null for non-existent task', async () => {
      const task = await executor.getTask('non-existent-id')

      expect(task).toBeNull()
    })

    it('should cancelTask cancels pending task', async () => {
      const definition = createTestApprovalFunction()
      const task = await executor.createTask(definition, {})

      await executor.cancelTask(task.id, 'No longer needed')

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('cancelled')
    })

    it('should not cancel completed task', async () => {
      const definition = createTestApprovalFunction()
      const task = await executor.createTask(definition, {})

      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        channel: 'web',
      })

      await expect(
        executor.cancelTask(task.id, 'Too late')
      ).rejects.toThrow(/cannot cancel/i)
    })

    it('should transition: pending -> assigned', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
      })

      const task = await executor.createTask(definition, {})
      expect(task.status).toBe('pending')

      // Assignment happens automatically on creation with assignees
      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.assignee).toBeDefined()
    })

    it('should transition: assigned -> in_progress', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
      })

      const task = await executor.createTask(definition, {})

      // User starts working on task
      await executor.startTask(task.id, {
        userId: 'user-1',
        channel: 'web',
      })

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('in_progress')
    })

    it('should transition: in_progress -> completed', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
      })

      const task = await executor.createTask(definition, {})

      await executor.startTask(task.id, {
        userId: 'user-1',
        channel: 'web',
      })

      await simulateHumanResponse(executor, task.id, { approved: true }, {
        userId: 'user-1',
        channel: 'web',
      })

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('completed')
    })

    it('should list tasks by status', async () => {
      const definition = createTestApprovalFunction()

      await executor.createTask(definition, { id: 1 })
      await executor.createTask(definition, { id: 2 })
      const task3 = await executor.createTask(definition, { id: 3 })

      await simulateHumanResponse(executor, task3.id, { approved: true }, {
        userId: 'user-1',
        channel: 'web',
      })

      const pendingTasks = await executor.listTasks({ status: 'pending' })
      const completedTasks = await executor.listTasks({ status: 'completed' })

      expect(pendingTasks).toHaveLength(2)
      expect(completedTasks).toHaveLength(1)
    })

    it('should list tasks by assignee', async () => {
      const definition = createTestApprovalFunction()

      await executor.createTask(definition, { id: 1 }, { assignees: { users: ['user-1'] } })
      await executor.createTask(definition, { id: 2 }, { assignees: { users: ['user-2'] } })
      await executor.createTask(definition, { id: 3 }, { assignees: { users: ['user-1'] } })

      const user1Tasks = await executor.listTasks({ assignee: 'user-1' })

      expect(user1Tasks).toHaveLength(2)
    })

    it('should support task pagination', async () => {
      const definition = createTestApprovalFunction()

      // Create 25 tasks
      for (let i = 0; i < 25; i++) {
        await executor.createTask(definition, { id: i })
      }

      const page1 = await executor.listTasks({ limit: 10, offset: 0 })
      const page2 = await executor.listTasks({ limit: 10, offset: 10 })
      const page3 = await executor.listTasks({ limit: 10, offset: 20 })

      expect(page1).toHaveLength(10)
      expect(page2).toHaveLength(10)
      expect(page3).toHaveLength(5)
    })
  })

  // ===========================================================================
  // HTTP HANDLER TESTS
  // ===========================================================================

  describe('HTTP Handler', () => {
    it('should handle POST /tasks to create task', async () => {
      const definition = createTestApprovalFunction()

      const request = new Request('https://human.do/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          definition,
          input: { requestId: 'REQ-001' },
        }),
      })

      const response = await executor.fetch(request)

      expect(response.ok).toBe(true)
      const task = await response.json() as HumanTask
      expect(task.id).toBeDefined()
      expect(task.status).toBe('pending')
    })

    it('should handle GET /tasks/:id to get task', async () => {
      const definition = createTestApprovalFunction()
      const task = await executor.createTask(definition, {})

      const request = new Request(`https://human.do/tasks/${task.id}`, {
        method: 'GET',
      })

      const response = await executor.fetch(request)

      expect(response.ok).toBe(true)
      const retrievedTask = await response.json() as HumanTask
      expect(retrievedTask.id).toBe(task.id)
    })

    it('should handle POST /tasks/:id/respond to submit response', async () => {
      const definition = createTestApprovalFunction()
      const task = await executor.createTask(definition, {})

      const request = new Request(`https://human.do/tasks/${task.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: { approved: true },
          responder: { userId: 'user-1', channel: 'web' },
        }),
      })

      const response = await executor.fetch(request)

      expect(response.ok).toBe(true)

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('completed')
    })

    it('should handle POST /tasks/:id/cancel to cancel task', async () => {
      const definition = createTestApprovalFunction()
      const task = await executor.createTask(definition, {})

      const request = new Request(`https://human.do/tasks/${task.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'No longer needed' }),
      })

      const response = await executor.fetch(request)

      expect(response.ok).toBe(true)

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('cancelled')
    })

    it('should handle GET /tasks/:id/ui to get task UI', async () => {
      const definition = createTestApprovalFunction({
        ui: {
          title: 'Test Title',
          description: 'Test Description',
          quickActions: [
            { id: 'approve', label: 'Approve', variant: 'primary', value: { approved: true } },
          ],
        },
      })
      const task = await executor.createTask(definition, {})

      const request = new Request(`https://human.do/tasks/${task.id}/ui`, {
        method: 'GET',
      })

      const response = await executor.fetch(request)

      expect(response.ok).toBe(true)
      const ui = await response.json() as HumanUI
      expect(ui.title).toBe('Test Title')
    })

    it('should return 404 for unknown task', async () => {
      const request = new Request('https://human.do/tasks/unknown-id', {
        method: 'GET',
      })

      const response = await executor.fetch(request)

      expect(response.status).toBe(404)
    })

    it('should return 405 for unsupported methods', async () => {
      const request = new Request('https://human.do/tasks', {
        method: 'DELETE',
      })

      const response = await executor.fetch(request)

      expect(response.status).toBe(405)
    })
  })

  // ===========================================================================
  // ALARM HANDLER TESTS
  // ===========================================================================

  describe('Alarm Handler', () => {
    it('should process reminders on alarm', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        reminders: {
          firstReminder: '1h',
          channels: ['email'],
        },
      })

      await executor.createTask(definition, {})

      vi.advanceTimersByTime(3600000)
      await executor.alarm()

      expect(mockNotifications.emailsSent).toHaveLength(1)
    })

    it('should process escalations on alarm', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        escalation: {
          trigger: 'timeout',
          tiers: [{ after: '1h', assignees: { users: ['manager-1'] } }],
        },
      })

      const task = await executor.createTask(definition, {})

      vi.advanceTimersByTime(3600000)
      await executor.alarm()

      const routing = await executor.getTaskRouting(task.id)
      expect(routing.escalatedTo).toContain('manager-1')
    })

    it('should process SLA breaches on alarm', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        sla: {
          responseTime: '1h',
          resolutionTime: '4h',
          onBreach: 'auto-approve',
        },
      })

      const task = await executor.createTask(definition, {})

      vi.advanceTimersByTime(14400001)
      await executor.alarm()

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('completed')
    })

    it('should process task expirations on alarm', async () => {
      const definition = createTestApprovalFunction({ timeout: '1h' })

      const task = await executor.createTask(definition, {})

      vi.advanceTimersByTime(3600001)
      await executor.alarm()

      const updatedTask = await executor.getTask(task.id)
      expect(updatedTask?.status).toBe('expired')
    })

    it('should schedule next alarm', async () => {
      const definition = createTestApprovalFunction({
        assignees: { users: ['user-1'] },
        reminders: {
          firstReminder: '1h',
          interval: '30m',
          maxReminders: 3,
          channels: ['email'],
        },
      })

      await executor.createTask(definition, {})

      // After first reminder, next alarm should be scheduled
      vi.advanceTimersByTime(3600000)
      await executor.alarm()

      const nextAlarm = await mockState.storage.getAlarm()
      expect(nextAlarm).toBeDefined()
    })
  })

  // ===========================================================================
  // ADDITIONAL CONTEXT VIA CONFIG
  // ===========================================================================

  describe('Additional Context via Config', () => {
    it('should add additional context from config', async () => {
      const definition = createTestApprovalFunction()

      const config: HumanFunctionConfig = {
        additionalContext: [
          { type: 'text', label: 'Extra Info', content: 'This is extra context' },
          { type: 'json', label: 'Data', content: { key: 'value' } },
        ],
      }

      const task = await executor.createTask(definition, {}, config)
      const ui = await executor.getTaskUI(task.id)

      expect(ui?.context).toHaveLength(2)
    })

    it('should prefill form values from config', async () => {
      const definition = createTestInputFunction([
        { name: 'name', label: 'Name', type: 'text' },
        { name: 'email', label: 'Email', type: 'email' },
      ])

      const config: HumanFunctionConfig = {
        prefillValues: {
          name: 'John Doe',
          email: 'john@example.com',
        },
      }

      const task = await executor.createTask(definition, {}, config)
      const ui = await executor.getTaskUI(task.id)

      expect(ui?.form?.[0].defaultValue).toBe('John Doe')
      expect(ui?.form?.[1].defaultValue).toBe('john@example.com')
    })
  })
})
