/**
 * Human Functions Test Utilities
 *
 * Shared mock classes and utilities for testing human-in-the-loop functions.
 * Used by human-executor.test.ts, human-executor.e2e.test.ts, and
 * human-loop-integration.test.ts.
 *
 * @module tiers/__tests__/human-test-utils
 */

import type {
  HumanFunctionDefinition,
  HumanFunctionConfig,
  HumanTask,
  HumanUI,
  FormField,
  ResponderInfo,
} from '../../../core/src/human/index.js'
import { defineHumanFunction } from '../../../core/src/human/index.js'
import type { HumanExecutor } from '../human-executor.js'

// =============================================================================
// MOCK DURABLE OBJECT STORAGE
// =============================================================================

/**
 * Mock Durable Object storage for testing.
 * Provides an in-memory implementation of the Durable Object storage API.
 */
export class MockDurableObjectStorage {
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

// =============================================================================
// MOCK DURABLE OBJECT STATE
// =============================================================================

/**
 * Mock Durable Object state for testing.
 * Wraps MockDurableObjectStorage with a DurableObject-like interface.
 */
export class MockDurableObjectState {
  public storage: MockDurableObjectStorage
  public id: DurableObjectId

  constructor(id = 'test-human-executor-id') {
    this.storage = new MockDurableObjectStorage()
    this.id = { toString: () => id } as DurableObjectId
  }
}

// =============================================================================
// MOCK NOTIFICATION SERVICE
// =============================================================================

/**
 * Mock notification service for testing.
 * Tracks all notifications sent through different channels.
 */
export class MockNotificationService {
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

// =============================================================================
// MOCK ENVIRONMENT
// =============================================================================

/**
 * Mock environment bindings for testing.
 */
export interface MockEnv {
  HUMAN_TASKS_DO?: DurableObjectNamespace
  NOTIFICATIONS?: MockNotificationService
  USERS_KV?: KVNamespace
  TEAMS_KV?: KVNamespace
}

// =============================================================================
// TEST FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a test approval function definition.
 *
 * @param overrides - Optional overrides for the definition
 * @returns A human function definition for approval workflows
 */
export function createTestApprovalFunction(
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
 * Create a test input function definition.
 *
 * @param fields - Form fields for the input function
 * @param overrides - Optional overrides for the definition
 * @returns A human function definition for input workflows
 */
export function createTestInputFunction(
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

// =============================================================================
// SIMULATION HELPERS
// =============================================================================

/**
 * Simulate human response to a task.
 *
 * @param executor - The HumanExecutor instance
 * @param taskId - The task ID to respond to
 * @param response - The response data
 * @param responder - Information about who is responding
 */
export async function simulateHumanResponse(
  executor: HumanExecutor,
  taskId: string,
  response: unknown,
  responder: ResponderInfo
): Promise<void> {
  await executor.submitResponse(taskId, response, responder)
}

// =============================================================================
// API SIMULATION HELPERS
// =============================================================================

/**
 * Simulate API request to create a human task.
 *
 * @param executor - The HumanExecutor instance
 * @param definition - The human function definition
 * @param input - The input data
 * @param config - Optional configuration
 * @returns The created task
 */
export async function createTaskViaAPI(
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
  if (!response.ok) {
    throw new Error(`Failed to create task: ${response.status}`)
  }
  return response.json() as Promise<HumanTask>
}

/**
 * Simulate API request to get task status.
 *
 * @param executor - The HumanExecutor instance
 * @param taskId - The task ID to retrieve
 * @returns The task or null if not found
 */
export async function getTaskViaAPI(
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
 * Simulate API request to submit task response.
 *
 * @param executor - The HumanExecutor instance
 * @param taskId - The task ID to respond to
 * @param taskResponse - The response data
 * @param responder - Information about who is responding
 * @returns Success status
 */
export async function submitResponseViaAPI(
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
 * Simulate API request to cancel a task.
 *
 * @param executor - The HumanExecutor instance
 * @param taskId - The task ID to cancel
 * @param reason - Optional cancellation reason
 * @returns Success status
 */
export async function cancelTaskViaAPI(
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
 * Simulate API request to get task UI.
 *
 * @param executor - The HumanExecutor instance
 * @param taskId - The task ID to retrieve UI for
 * @returns The task UI or null if not found
 */
export async function getTaskUIViaAPI(
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
