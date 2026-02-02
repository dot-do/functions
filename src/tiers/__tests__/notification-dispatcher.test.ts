/**
 * Notification Dispatcher Tests
 *
 * Tests for the real notification dispatch implementation.
 * Validates email, Slack, SMS, push, and webhook notification delivery
 * via fetch(), as well as notification state tracking in DO storage.
 *
 * @module tiers/__tests__/notification-dispatcher.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NotificationDispatcher } from '../notification-dispatcher.js'
import type {
  NotificationConfig,
  NotificationRecord,
  NotificationType,
  DispatchResult,
} from '../notification-dispatcher.js'
import { HumanExecutor } from '../human-executor.js'
import type {
  HumanFunctionDefinition,
  HumanFunctionConfig,
} from '@dotdo/functions/human'
import { defineHumanFunction } from '@dotdo/functions/human'

// =============================================================================
// MOCK STORAGE
// =============================================================================

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
  }
}

class MockDurableObjectState {
  public storage: MockDurableObjectStorage
  public id: DurableObjectId

  constructor(id = 'test-notification-id') {
    this.storage = new MockDurableObjectStorage()
    this.id = { toString: () => id } as DurableObjectId
  }
}

// =============================================================================
// MOCK FETCH
// =============================================================================

/**
 * Intercepted fetch calls for testing
 */
let fetchCalls: Array<{ url: string; init: RequestInit }> = []
let fetchResponses: Array<{ status: number; body?: string }> = []
let fetchResponseIndex = 0

function mockFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
  fetchCalls.push({ url: urlStr, init: init ?? {} })

  const responseConfig = fetchResponses[fetchResponseIndex] ?? { status: 200, body: '{}' }
  fetchResponseIndex++

  return Promise.resolve(
    new Response(responseConfig.body ?? '{}', { status: responseConfig.status })
  )
}

// =============================================================================
// HELPERS
// =============================================================================

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
        { id: 'approve', label: 'Approve', variant: 'primary', value: { approved: true } },
        { id: 'reject', label: 'Reject', variant: 'danger', value: { approved: false } },
      ],
    },
    ...overrides,
  })
}

// =============================================================================
// NOTIFICATION DISPATCHER TESTS
// =============================================================================

describe('NotificationDispatcher', () => {
  let storage: MockDurableObjectStorage
  let dispatcher: NotificationDispatcher
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    storage = new MockDurableObjectStorage()
    fetchCalls = []
    fetchResponses = []
    fetchResponseIndex = 0
    originalFetch = globalThis.fetch
    globalThis.fetch = mockFetch as typeof globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    storage.clear()
  })

  // ===========================================================================
  // Email Dispatch
  // ===========================================================================

  describe('Email Dispatch', () => {
    it('should send email via configured API endpoint', async () => {
      const config: NotificationConfig = {
        emailApiUrl: 'https://api.email-provider.com/v1/send',
        emailApiKey: 'test-api-key',
        emailFrom: 'noreply@human.do',
      }
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        config
      )

      fetchResponses.push({ status: 202 })

      const result = await dispatcher.dispatch(
        'email',
        'user@example.com',
        'Task Assignment',
        'You have been assigned a new task.',
        'task_123',
        'task_created'
      )

      expect(result.success).toBe(true)
      expect(result.notificationId).toBeDefined()
      expect(result.httpStatus).toBe(202)

      // Verify fetch was called with correct parameters
      expect(fetchCalls).toHaveLength(1)
      expect(fetchCalls[0].url).toBe('https://api.email-provider.com/v1/send')
      const headers = fetchCalls[0].init.headers as Record<string, string>
      expect(headers['Authorization']).toBe('Bearer test-api-key')
      expect(headers['Content-Type']).toBe('application/json')

      // Verify the email payload
      const body = JSON.parse(fetchCalls[0].init.body as string)
      expect(body.personalizations[0].to[0].email).toBe('user@example.com')
      expect(body.from.email).toBe('noreply@human.do')
      expect(body.subject).toBe('Task Assignment')
    })

    it('should return error when email API URL is not configured', async () => {
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        {}
      )

      const result = await dispatcher.dispatch(
        'email',
        'user@example.com',
        'Subject',
        'Body',
        'task_123',
        'reminder'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Email API URL not configured')
    })

    it('should handle email API failure', async () => {
      const config: NotificationConfig = {
        emailApiUrl: 'https://api.email-provider.com/v1/send',
      }
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        config
      )

      fetchResponses.push({ status: 500, body: 'Internal Server Error' })

      const result = await dispatcher.dispatch(
        'email',
        'user@example.com',
        'Subject',
        'Body',
        'task_123',
        'reminder'
      )

      expect(result.success).toBe(false)
      expect(result.httpStatus).toBe(500)
      expect(result.error).toContain('500')
    })

    it('should use default from address when not configured', async () => {
      const config: NotificationConfig = {
        emailApiUrl: 'https://api.email-provider.com/v1/send',
      }
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        config
      )

      fetchResponses.push({ status: 202 })

      await dispatcher.dispatch(
        'email',
        'user@example.com',
        'Subject',
        'Body',
        'task_123',
        'reminder'
      )

      const body = JSON.parse(fetchCalls[0].init.body as string)
      expect(body.from.email).toBe('notifications@human.do')
    })
  })

  // ===========================================================================
  // Slack Dispatch
  // ===========================================================================

  describe('Slack Dispatch', () => {
    it('should send Slack message via webhook', async () => {
      const config: NotificationConfig = {
        slackWebhookUrl: 'https://hooks.slack.com/services/T123/B456/xyz789',
      }
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        config
      )

      fetchResponses.push({ status: 200, body: 'ok' })

      const result = await dispatcher.dispatch(
        'slack',
        '#approvals',
        'Reminder',
        'Please respond to task: Approve Request.',
        'task_456',
        'reminder'
      )

      expect(result.success).toBe(true)
      expect(fetchCalls).toHaveLength(1)
      expect(fetchCalls[0].url).toBe('https://hooks.slack.com/services/T123/B456/xyz789')

      const body = JSON.parse(fetchCalls[0].init.body as string)
      expect(body.channel).toBe('#approvals')
      expect(body.text).toContain('Please respond to task')
    })

    it('should return error when Slack webhook is not configured', async () => {
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        {}
      )

      const result = await dispatcher.dispatch(
        'slack',
        '#channel',
        'Subject',
        'Body',
        'task_123',
        'reminder'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Slack webhook URL not configured')
    })
  })

  // ===========================================================================
  // SMS Dispatch
  // ===========================================================================

  describe('SMS Dispatch', () => {
    it('should send SMS via configured API endpoint', async () => {
      const config: NotificationConfig = {
        smsApiUrl: 'https://api.sms-provider.com/v1/send',
        smsApiKey: 'sms-api-key',
      }
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        config
      )

      fetchResponses.push({ status: 200 })

      const result = await dispatcher.dispatch(
        'sms',
        '+15555555555',
        'Reminder',
        'Please respond to your assigned task.',
        'task_789',
        'reminder'
      )

      expect(result.success).toBe(true)
      expect(fetchCalls).toHaveLength(1)
      expect(fetchCalls[0].url).toBe('https://api.sms-provider.com/v1/send')

      const body = JSON.parse(fetchCalls[0].init.body as string)
      expect(body.to).toBe('+15555555555')
    })

    it('should return error when SMS API is not configured', async () => {
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        {}
      )

      const result = await dispatcher.dispatch(
        'sms',
        '+15555555555',
        'Subject',
        'Body',
        'task_123',
        'reminder'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('SMS API URL not configured')
    })
  })

  // ===========================================================================
  // Push Dispatch
  // ===========================================================================

  describe('Push Dispatch', () => {
    it('should send push notification via configured API', async () => {
      const config: NotificationConfig = {
        pushApiUrl: 'https://api.push-provider.com/v1/send',
        pushApiKey: 'push-api-key',
      }
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        config
      )

      fetchResponses.push({ status: 200 })

      const result = await dispatcher.dispatch(
        'push',
        'user-123',
        'New Task',
        'You have a new task to review.',
        'task_abc',
        'task_created'
      )

      expect(result.success).toBe(true)
      expect(fetchCalls).toHaveLength(1)

      const body = JSON.parse(fetchCalls[0].init.body as string)
      expect(body.userId).toBe('user-123')
      expect(body.title).toBe('New Task')
    })

    it('should return error when push API is not configured', async () => {
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        {}
      )

      const result = await dispatcher.dispatch(
        'push',
        'user-123',
        'Subject',
        'Body',
        'task_123',
        'reminder'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Push notification API URL not configured')
    })
  })

  // ===========================================================================
  // Webhook Dispatch
  // ===========================================================================

  describe('Webhook Dispatch', () => {
    it('should send webhook notification to configured URL', async () => {
      const config: NotificationConfig = {
        webhooks: {
          'task-events': {
            url: 'https://example.com/webhooks/tasks',
            headers: { 'X-Custom-Header': 'custom-value' },
          },
        },
      }
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        config
      )

      fetchResponses.push({ status: 200 })

      const result = await dispatcher.dispatch(
        'webhook',
        'task-events',
        'New Task',
        'Task has been created.',
        'task_xyz',
        'task_created'
      )

      expect(result.success).toBe(true)
      expect(fetchCalls).toHaveLength(1)
      expect(fetchCalls[0].url).toBe('https://example.com/webhooks/tasks')

      const headers = fetchCalls[0].init.headers as Record<string, string>
      expect(headers['X-Custom-Header']).toBe('custom-value')
      expect(headers['Content-Type']).toBe('application/json')

      const body = JSON.parse(fetchCalls[0].init.body as string)
      expect(body.event).toBe('task_created')
      expect(body.taskId).toBe('task_xyz')
    })

    it('should include HMAC signature when secret is configured', async () => {
      const config: NotificationConfig = {
        webhooks: {
          'secure-hook': {
            url: 'https://example.com/webhooks/secure',
            secret: 'my-webhook-secret',
          },
        },
      }
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        config
      )

      fetchResponses.push({ status: 200 })

      const result = await dispatcher.dispatch(
        'webhook',
        'secure-hook',
        'Escalation',
        'Task escalated.',
        'task_sec',
        'escalation'
      )

      expect(result.success).toBe(true)
      const headers = fetchCalls[0].init.headers as Record<string, string>
      expect(headers['X-Signature-256']).toBeDefined()
      expect(headers['X-Signature-256']).toMatch(/^sha256=[a-f0-9]+$/)
    })

    it('should return error for unconfigured webhook name', async () => {
      const config: NotificationConfig = {
        webhooks: {},
      }
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        config
      )

      const result = await dispatcher.dispatch(
        'webhook',
        'non-existent-hook',
        'Subject',
        'Body',
        'task_123',
        'reminder'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('not configured')
    })

    it('should dispatch webhook directly to a URL', async () => {
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        {}
      )

      fetchResponses.push({ status: 200 })

      const result = await dispatcher.dispatchWebhookDirect(
        'https://example.com/webhook',
        { event: 'task_created', taskId: 'task_direct' },
        { 'X-Source': 'human.do' }
      )

      expect(result.success).toBe(true)
      expect(fetchCalls).toHaveLength(1)
      expect(fetchCalls[0].url).toBe('https://example.com/webhook')
    })
  })

  // ===========================================================================
  // Notification State Tracking
  // ===========================================================================

  describe('Notification State Tracking', () => {
    beforeEach(() => {
      const config: NotificationConfig = {
        emailApiUrl: 'https://api.email-provider.com/v1/send',
        emailApiKey: 'test-key',
      }
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        config
      )
    })

    it('should store notification records in DO storage', async () => {
      fetchResponses.push({ status: 202 })

      await dispatcher.dispatch(
        'email',
        'user@example.com',
        'Test Subject',
        'Test Body',
        'task_store_1',
        'task_created'
      )

      const records = await dispatcher.getNotificationsForTask('task_store_1')
      expect(records).toHaveLength(1)
      expect(records[0].channel).toBe('email')
      expect(records[0].recipient).toBe('user@example.com')
      expect(records[0].subject).toBe('Test Subject')
      expect(records[0].body).toBe('Test Body')
      expect(records[0].taskId).toBe('task_store_1')
      expect(records[0].type).toBe('task_created')
      expect(records[0].success).toBe(true)
      expect(records[0].httpStatus).toBe(202)
      expect(records[0].sentAt).toBeGreaterThan(0)
      expect(records[0].retryCount).toBe(0)
    })

    it('should store failed notification records', async () => {
      fetchResponses.push({ status: 500 })

      await dispatcher.dispatch(
        'email',
        'user@example.com',
        'Test Subject',
        'Test Body',
        'task_fail_1',
        'reminder'
      )

      const records = await dispatcher.getNotificationsForTask('task_fail_1')
      expect(records).toHaveLength(1)
      expect(records[0].success).toBe(false)
      expect(records[0].error).toBeDefined()
      expect(records[0].httpStatus).toBe(500)
    })

    it('should track multiple notifications for a task', async () => {
      fetchResponses.push({ status: 202 }) // first email
      fetchResponses.push({ status: 202 }) // second email
      fetchResponses.push({ status: 202 }) // third email

      await dispatcher.dispatch('email', 'user1@example.com', 'Subj1', 'Body1', 'task_multi', 'task_created')
      await dispatcher.dispatch('email', 'user2@example.com', 'Subj2', 'Body2', 'task_multi', 'reminder')
      await dispatcher.dispatch('email', 'user1@example.com', 'Subj3', 'Body3', 'task_multi', 'escalation')

      const records = await dispatcher.getNotificationsForTask('task_multi')
      expect(records).toHaveLength(3)

      // Should be sorted by sentAt
      for (let i = 1; i < records.length; i++) {
        expect(records[i].sentAt).toBeGreaterThanOrEqual(records[i - 1].sentAt)
      }
    })

    it('should compute notification statistics for a task', async () => {
      fetchResponses.push({ status: 202 }) // success
      fetchResponses.push({ status: 500 }) // failure
      fetchResponses.push({ status: 202 }) // success

      await dispatcher.dispatch('email', 'user@example.com', 'S1', 'B1', 'task_stats', 'task_created')
      await dispatcher.dispatch('email', 'user@example.com', 'S2', 'B2', 'task_stats', 'reminder')
      await dispatcher.dispatch('email', 'user@example.com', 'S3', 'B3', 'task_stats', 'escalation')

      const stats = await dispatcher.getNotificationStats('task_stats')
      expect(stats.total).toBe(3)
      expect(stats.successful).toBe(2)
      expect(stats.failed).toBe(1)
      expect(stats.byChannel['email']).toBe(3)
      expect(stats.byType['task_created']).toBe(1)
      expect(stats.byType['reminder']).toBe(1)
      expect(stats.byType['escalation']).toBe(1)
    })

    it('should store records for unconfigured channels', async () => {
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        {} // no config
      )

      await dispatcher.dispatch(
        'email',
        'user@example.com',
        'Subject',
        'Body',
        'task_unconfig',
        'reminder'
      )

      const records = await dispatcher.getNotificationsForTask('task_unconfig')
      expect(records).toHaveLength(1)
      expect(records[0].success).toBe(false)
      expect(records[0].error).toContain('not configured')
    })
  })

  // ===========================================================================
  // Retry Logic
  // ===========================================================================

  describe('Retry Logic', () => {
    it('should retry a failed notification', async () => {
      const config: NotificationConfig = {
        emailApiUrl: 'https://api.email-provider.com/v1/send',
      }
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        config
      )

      // First attempt fails
      fetchResponses.push({ status: 500 })
      const firstResult = await dispatcher.dispatch(
        'email',
        'user@example.com',
        'Subject',
        'Body',
        'task_retry',
        'reminder'
      )
      expect(firstResult.success).toBe(false)

      // Retry succeeds
      fetchResponses.push({ status: 202 })
      const retryResult = await dispatcher.retry(firstResult.notificationId)
      expect(retryResult.success).toBe(true)
    })

    it('should return error when retrying non-existent notification', async () => {
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        {}
      )

      const result = await dispatcher.retry('non-existent-id')
      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  // ===========================================================================
  // Unsupported Channel
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle unsupported channel gracefully', async () => {
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        {}
      )

      const result = await dispatcher.dispatch(
        'pigeons' as any,
        'recipient',
        'Subject',
        'Body',
        'task_123',
        'reminder'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Unsupported notification channel')
    })

    it('should handle fetch exceptions gracefully', async () => {
      const config: NotificationConfig = {
        emailApiUrl: 'https://api.email-provider.com/v1/send',
      }
      dispatcher = new NotificationDispatcher(
        storage as unknown as DurableObjectStorage,
        config
      )

      // Override fetch to throw
      globalThis.fetch = (() => {
        return Promise.reject(new Error('Network error'))
      }) as typeof globalThis.fetch

      const result = await dispatcher.dispatch(
        'email',
        'user@example.com',
        'Subject',
        'Body',
        'task_err',
        'reminder'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')

      // Should still store the failed record
      const records = await dispatcher.getNotificationsForTask('task_err')
      expect(records).toHaveLength(1)
      expect(records[0].success).toBe(false)
    })
  })
})

// =============================================================================
// HUMAN EXECUTOR + DISPATCHER INTEGRATION
// =============================================================================

describe('HumanExecutor Notification Integration', () => {
  let executor: HumanExecutor
  let mockState: MockDurableObjectState
  let fetchCallsIntegration: Array<{ url: string; init: RequestInit }>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = new MockDurableObjectState()
    fetchCallsIntegration = []
    originalFetch = globalThis.fetch

    // Mock fetch for the real dispatcher
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      fetchCallsIntegration.push({ url: urlStr, init: init ?? {} })
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof globalThis.fetch

    const env = {
      NOTIFICATION_CONFIG: {
        emailApiUrl: 'https://api.email.test/send',
        emailApiKey: 'test-key',
        emailFrom: 'test@human.do',
        slackWebhookUrl: 'https://hooks.slack.test/services/test',
        webhooks: {
          'task-events': {
            url: 'https://example.com/webhook/tasks',
          },
        },
      } as NotificationConfig,
    }

    executor = new HumanExecutor(
      mockState as unknown as DurableObjectState,
      env
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
    mockState.storage.clear()
  })

  it('should send task-created notifications via real dispatcher on task creation', async () => {
    const definition = createTestApprovalFunction({
      assignees: { users: ['user-1@example.com'] },
      reminders: { channels: ['email'] },
    })

    await executor.createTask(definition, { requestId: 'REQ-001' })

    // The dispatcher should have made a fetch call for the email
    const emailCalls = fetchCallsIntegration.filter(
      (c) => c.url === 'https://api.email.test/send'
    )
    expect(emailCalls.length).toBeGreaterThan(0)

    // Verify the email payload
    const emailPayload = JSON.parse(emailCalls[0].init.body as string)
    expect(emailPayload.personalizations[0].to[0].email).toBe('user-1@example.com')
    expect(emailPayload.subject).toContain('New Task')
  })

  it('should send webhook notifications on task creation when configured', async () => {
    const definition = createTestApprovalFunction({
      assignees: { users: ['user-1'] },
      reminders: { channels: ['email'] },
    })

    await executor.createTask(definition, { requestId: 'REQ-002' })

    // Should have sent webhook notification
    const webhookCalls = fetchCallsIntegration.filter(
      (c) => c.url === 'https://example.com/webhook/tasks'
    )
    expect(webhookCalls.length).toBeGreaterThan(0)

    const webhookPayload = JSON.parse(webhookCalls[0].init.body as string)
    expect(webhookPayload.event).toBe('task_created')
    expect(webhookPayload.taskId).toBeDefined()
  })

  it('should send reminder notifications via real dispatcher', async () => {
    const definition = createTestApprovalFunction({
      assignees: { users: ['user-1@example.com'] },
      reminders: {
        firstReminder: '1h',
        channels: ['email'],
      },
    })

    await executor.createTask(definition, {})

    // Reset fetch calls from task creation
    fetchCallsIntegration = []

    // Advance time to trigger reminder
    vi.advanceTimersByTime(3600000) // 1 hour
    await executor.alarm()

    const emailCalls = fetchCallsIntegration.filter(
      (c) => c.url === 'https://api.email.test/send'
    )
    expect(emailCalls.length).toBeGreaterThan(0)

    const payload = JSON.parse(emailCalls[0].init.body as string)
    expect(payload.subject).toContain('Reminder')
  })

  it('should send Slack notifications via real dispatcher', async () => {
    const definition = createTestApprovalFunction({
      assignees: { users: ['#general'] },
      reminders: {
        firstReminder: '1h',
        channels: ['slack'],
      },
    })

    await executor.createTask(definition, {})
    fetchCallsIntegration = []

    vi.advanceTimersByTime(3600000)
    await executor.alarm()

    const slackCalls = fetchCallsIntegration.filter(
      (c) => c.url === 'https://hooks.slack.test/services/test'
    )
    expect(slackCalls.length).toBeGreaterThan(0)
  })

  it('should store notification records accessible via getNotificationsForTask', async () => {
    const definition = createTestApprovalFunction({
      assignees: { users: ['user-1@example.com'] },
      reminders: { channels: ['email'] },
    })

    const task = await executor.createTask(definition, { requestId: 'REQ-003' })

    const notifications = await executor.getNotificationsForTask(task.id)
    // Should have at least the task-created notification
    expect(notifications.length).toBeGreaterThan(0)
    expect(notifications[0].type).toBe('task_created')
    expect(notifications[0].channel).toBe('email')
    expect(notifications[0].success).toBe(true)
  })

  it('should send escalation notifications via real dispatcher', async () => {
    const definition = createTestApprovalFunction({
      assignees: { users: ['user-1@example.com'] },
      escalation: {
        trigger: 'timeout',
        tiers: [
          {
            after: '2h',
            assignees: { users: ['manager@example.com'] },
            message: 'Escalated: needs attention',
          },
        ],
      },
      reminders: { channels: ['email'] },
    })

    await executor.createTask(definition, {})
    fetchCallsIntegration = []

    vi.advanceTimersByTime(7200000) // 2 hours
    await executor.alarm()

    const emailCalls = fetchCallsIntegration.filter(
      (c) => c.url === 'https://api.email.test/send'
    )
    expect(emailCalls.length).toBeGreaterThan(0)
  })

  it('should send SLA warning notifications via real dispatcher', async () => {
    const definition = createTestApprovalFunction({
      assignees: { users: ['user-1@example.com'] },
      sla: {
        responseTime: '1h',
        resolutionTime: '4h',
        warningThreshold: 80,
      },
      reminders: { channels: ['email'] },
    })

    await executor.createTask(definition, {})
    fetchCallsIntegration = []

    // 80% of 1h = 48 minutes
    vi.advanceTimersByTime(2880000)
    await executor.alarm()

    const emailCalls = fetchCallsIntegration.filter(
      (c) => c.url === 'https://api.email.test/send'
    )
    expect(emailCalls.length).toBeGreaterThan(0)
  })

  it('should expose notification history via GET /tasks/:id/notifications', async () => {
    const definition = createTestApprovalFunction({
      assignees: { users: ['user-1@example.com'] },
      reminders: { channels: ['email'] },
    })

    const task = await executor.createTask(definition, { requestId: 'REQ-API' })

    const request = new Request(`https://human.do/tasks/${task.id}/notifications`, {
      method: 'GET',
    })

    const response = await executor.fetch(request)
    expect(response.ok).toBe(true)

    const data = await response.json() as { notifications: NotificationRecord[] }
    expect(data.notifications).toBeDefined()
    expect(Array.isArray(data.notifications)).toBe(true)
    expect(data.notifications.length).toBeGreaterThan(0)
  })
})

// =============================================================================
// HUMAN EXECUTOR BACKWARD COMPATIBILITY
// =============================================================================

describe('HumanExecutor Backward Compatibility', () => {
  let executor: HumanExecutor
  let mockState: MockDurableObjectState
  let mockNotifications: {
    emailsSent: Array<{ to: string; subject: string; body: string }>
    slacksSent: Array<{ channel: string; message: string }>
    smsSent: Array<{ phone: string; message: string }>
    pushSent: Array<{ userId: string; title: string; body: string }>
    sendEmail: (to: string, subject: string, body: string) => Promise<void>
    sendSlack: (channel: string, message: string) => Promise<void>
    sendSms: (phone: string, message: string) => Promise<void>
    sendPush: (userId: string, title: string, body: string) => Promise<void>
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = new MockDurableObjectState()
    mockNotifications = {
      emailsSent: [],
      slacksSent: [],
      smsSent: [],
      pushSent: [],
      sendEmail: async (to, subject, body) => {
        mockNotifications.emailsSent.push({ to, subject, body })
      },
      sendSlack: async (channel, message) => {
        mockNotifications.slacksSent.push({ channel, message })
      },
      sendSms: async (phone, message) => {
        mockNotifications.smsSent.push({ phone, message })
      },
      sendPush: async (userId, title, body) => {
        mockNotifications.pushSent.push({ userId, title, body })
      },
    }

    // No NOTIFICATION_CONFIG = no real dispatcher, only interface-based
    executor = new HumanExecutor(
      mockState as unknown as DurableObjectState,
      { NOTIFICATIONS: mockNotifications }
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    mockState.storage.clear()
    mockNotifications.emailsSent = []
    mockNotifications.slacksSent = []
  })

  it('should still use the injected NotificationService when no dispatcher config', async () => {
    const definition = createTestApprovalFunction({
      assignees: { users: ['user-1'] },
      reminders: {
        firstReminder: '1h',
        channels: ['email'],
      },
    })

    await executor.createTask(definition, {})

    // Task creation also sends notifications now
    const initialEmails = mockNotifications.emailsSent.length

    vi.advanceTimersByTime(3600000)
    await executor.alarm()

    // Should have sent reminder via the interface
    expect(mockNotifications.emailsSent.length).toBeGreaterThan(initialEmails)
  })

  it('should return empty array from getNotificationsForTask when no dispatcher', async () => {
    const definition = createTestApprovalFunction()
    const task = await executor.createTask(definition, {})

    const notifications = await executor.getNotificationsForTask(task.id)
    expect(notifications).toEqual([])
  })
})
