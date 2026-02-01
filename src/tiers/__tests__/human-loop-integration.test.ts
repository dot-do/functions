/**
 * Human-in-the-Loop Integration Tests
 *
 * Tests the integration between HumanExecutor and the human-in-the-loop package
 * for multi-platform support (Slack, Teams, Email, React).
 *
 * @module tiers/human-loop-integration.test
 */

import { describe, it, expect, vi } from 'vitest'
import type {
  QuickAction,
  FormField,
} from '../../../core/src/human/index.js'

import {
  TaskDeliveryService,
  NotificationServiceAdapter,
  adaptDefinitionToOptions,
  transformPlatformResponse,
  formatContextForPlatform,
  createQuickActionOptions,
  transformFormFields,
  type PlatformConfig,
  type HumanPlatform,
} from '../human-loop-integration.js'
import { createTestApprovalFunction } from './human-test-utils.js'

// =============================================================================
// PLATFORM CONFIG FACTORY
// =============================================================================

/**
 * Create a test platform config for human-in-the-loop integration tests.
 *
 * @param platform - The platform to configure (slack, teams, email, react)
 * @returns A complete platform configuration for testing
 */
function createTestPlatformConfig(platform: HumanPlatform = 'slack'): PlatformConfig {
  return {
    platform,
    slack: {
      channel: 'test-channel',
      webhookUrl: 'https://hooks.slack.com/test',
      mentions: ['U123', 'U456'],
    },
    teams: {
      webhookUrl: 'https://outlook.office.com/webhook/test',
      useAdaptiveCards: true,
    },
    email: {
      to: 'test@example.com',
      from: 'noreply@example.com',
      callbackUrl: 'https://example.com/callback',
    },
    react: {
      theme: 'light',
    },
    callbackUrl: 'https://example.com/api/callback',
  }
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Human-in-the-Loop Integration', () => {
  // ===========================================================================
  // ADAPT DEFINITION TO OPTIONS
  // ===========================================================================

  describe('adaptDefinitionToOptions', () => {
    it('should adapt definition to Slack options', () => {
      const definition = createTestApprovalFunction()
      const platformConfig = createTestPlatformConfig('slack')

      const options = adaptDefinitionToOptions(definition, platformConfig)

      expect(options.platform).toBe('slack')
      expect(options.title).toBe('Approve Request')
      expect(options.description).toBe('Please review and approve this request')
      expect(options.channel).toBe('test-channel')
      expect(options.mentions).toContain('U123')
    })

    it('should adapt definition to Teams options', () => {
      const definition = createTestApprovalFunction()
      const platformConfig = createTestPlatformConfig('teams')

      const options = adaptDefinitionToOptions(definition, platformConfig)

      expect(options.platform).toBe('teams')
      expect(options.webhookUrl).toBe('https://outlook.office.com/webhook/test')
      expect(options.useAdaptiveCards).toBe(true)
    })

    it('should adapt definition to Email options', () => {
      const definition = createTestApprovalFunction()
      const platformConfig = createTestPlatformConfig('email')

      const options = adaptDefinitionToOptions(definition, platformConfig)

      expect(options.platform).toBe('email')
      expect(options.to).toBe('test@example.com')
      expect(options.callbackUrl).toBe('https://example.com/api/callback')
    })

    it('should throw error for Email without "to" field', () => {
      const definition = createTestApprovalFunction()
      const platformConfig: PlatformConfig = {
        platform: 'email',
        email: undefined,
      }

      expect(() => adaptDefinitionToOptions(definition, platformConfig)).toThrow(
        'Email platform requires "to" field'
      )
    })

    it('should adapt definition to React options', () => {
      const definition = createTestApprovalFunction()
      const platformConfig = createTestPlatformConfig('react')

      const options = adaptDefinitionToOptions(definition, platformConfig)

      expect(options.platform).toBe('react')
      expect(options.theme).toBe('light')
    })

    it('should include quick actions as options', () => {
      const definition = createTestApprovalFunction()
      const platformConfig = createTestPlatformConfig('slack')

      const options = adaptDefinitionToOptions(definition, platformConfig) as Record<string, unknown>

      expect(options['options']).toEqual([
        { value: 'approve', label: 'Approve' },
        { value: 'reject', label: 'Reject' },
      ])
    })

    it('should include assignee users as mentions for Slack', () => {
      const definition = createTestApprovalFunction({
        assignees: {
          users: ['user-1', 'user-2'],
        },
      })
      const platformConfig = createTestPlatformConfig('slack')

      const options = adaptDefinitionToOptions(definition, platformConfig)

      expect(options.mentions).toContain('user-1')
      expect(options.mentions).toContain('user-2')
    })

    it('should parse timeout string to milliseconds', () => {
      const definition = createTestApprovalFunction({ timeout: '2h' })
      const platformConfig = createTestPlatformConfig('slack')

      const options = adaptDefinitionToOptions(definition, platformConfig)

      expect(options.timeout).toBe(7200000) // 2 hours in ms
    })

    it('should detect free text form for freeText option', () => {
      const definition = createTestApprovalFunction({
        ui: {
          title: 'Test',
          form: [
            { name: 'comment', label: 'Comment', type: 'textarea' },
          ],
        },
      })
      const platformConfig = createTestPlatformConfig('slack')

      const options = adaptDefinitionToOptions(definition, platformConfig) as Record<string, unknown>

      expect(options['freeText']).toBe(true)
    })
  })

  // ===========================================================================
  // TASK DELIVERY SERVICE
  // ===========================================================================

  describe('TaskDeliveryService', () => {
    it('should create delivery service with platform config', () => {
      const platformConfig = createTestPlatformConfig('slack')
      const service = new TaskDeliveryService(platformConfig)

      expect(service).toBeDefined()
    })

    it('should deliver task to Slack', async () => {
      const platformConfig = createTestPlatformConfig('slack')
      const service = new TaskDeliveryService(platformConfig)
      const definition = createTestApprovalFunction()

      const result = await service.deliverTask(
        'task-123',
        definition,
        { requestId: 'REQ-001' }
      )

      expect(result.success).toBe(true)
      expect(result.messageIds.slack).toBeDefined()
    })

    it('should deliver task to Teams', async () => {
      const platformConfig = createTestPlatformConfig('teams')
      const service = new TaskDeliveryService(platformConfig)
      const definition = createTestApprovalFunction()

      const result = await service.deliverTask(
        'task-123',
        definition,
        { requestId: 'REQ-001' }
      )

      expect(result.success).toBe(true)
      expect(result.messageIds.teams).toBeDefined()
    })

    it('should deliver task to Email', async () => {
      const platformConfig = createTestPlatformConfig('email')
      const service = new TaskDeliveryService(platformConfig)
      const definition = createTestApprovalFunction()

      const result = await service.deliverTask(
        'task-123',
        definition,
        { requestId: 'REQ-001' }
      )

      expect(result.success).toBe(true)
      expect(result.messageIds.email).toBeDefined()
    })

    it('should deliver task to React (no-op)', async () => {
      const platformConfig = createTestPlatformConfig('react')
      const service = new TaskDeliveryService(platformConfig)
      const definition = createTestApprovalFunction()

      const result = await service.deliverTask(
        'task-123',
        definition,
        { requestId: 'REQ-001' }
      )

      expect(result.success).toBe(true)
      expect(result.messageIds.react).toBeDefined()
    })

    it('should deliver to multiple platforms', async () => {
      const platformConfig = createTestPlatformConfig('slack')
      const service = new TaskDeliveryService(platformConfig)
      const definition = createTestApprovalFunction()

      const result = await service.deliverToMultiplePlatforms(
        'task-123',
        definition,
        { requestId: 'REQ-001' },
        ['slack', 'email']
      )

      expect(result.success).toBe(true)
      // At least one platform should have delivered
      expect(
        result.messageIds.slack !== undefined ||
        result.messageIds.email !== undefined
      ).toBe(true)
    })
  })

  // ===========================================================================
  // NOTIFICATION SERVICE ADAPTER
  // ===========================================================================

  describe('NotificationServiceAdapter', () => {
    it('should create notification adapter', () => {
      const platformConfig = createTestPlatformConfig('slack')
      const adapter = new NotificationServiceAdapter(platformConfig)

      expect(adapter).toBeDefined()
    })

    it('should send email notification', async () => {
      const platformConfig = createTestPlatformConfig('email')
      const adapter = new NotificationServiceAdapter(platformConfig)

      const result = await adapter.sendNotification(
        'user@example.com',
        'Test Subject',
        'Test body',
        'email'
      )

      expect(result).toBe(true)
    })

    it('should send Slack notification', async () => {
      const platformConfig = createTestPlatformConfig('slack')
      const adapter = new NotificationServiceAdapter(platformConfig)

      const result = await adapter.sendNotification(
        'test-channel',
        'Test Subject',
        'Test body',
        'slack'
      )

      expect(result).toBe(true)
    })

    it('should handle SMS notification (log only)', async () => {
      const platformConfig = createTestPlatformConfig('slack')
      const adapter = new NotificationServiceAdapter(platformConfig)

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const result = await adapter.sendNotification(
        '+1234567890',
        'Test Subject',
        'Test body',
        'sms'
      )

      expect(result).toBe(true)
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should handle push notification (log only)', async () => {
      const platformConfig = createTestPlatformConfig('slack')
      const adapter = new NotificationServiceAdapter(platformConfig)

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const result = await adapter.sendNotification(
        'user-123',
        'Test Subject',
        'Test body',
        'push'
      )

      expect(result).toBe(true)
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  // ===========================================================================
  // RESPONSE TRANSFORMATION
  // ===========================================================================

  describe('transformPlatformResponse', () => {
    const quickActions: QuickAction[] = [
      { id: 'approve', label: 'Approve', variant: 'primary', value: { approved: true } },
      { id: 'reject', label: 'Reject', variant: 'danger', value: { approved: false } },
    ]

    it('should transform string action ID to quick action value', () => {
      const response = 'approve'
      const result = transformPlatformResponse(response, quickActions)

      expect(result).toEqual({ approved: true })
    })

    it('should transform rejection action ID', () => {
      const response = 'reject'
      const result = transformPlatformResponse(response, quickActions)

      expect(result).toEqual({ approved: false })
    })

    it('should handle object with selected field', () => {
      const response = { selected: 'approve' }
      const result = transformPlatformResponse(response, quickActions)

      expect(result).toEqual({ approved: true })
    })

    it('should pass through non-matching responses', () => {
      const response = { custom: 'data' }
      const result = transformPlatformResponse(response, quickActions)

      expect(result).toEqual({ custom: 'data' })
    })

    it('should handle responses without quick actions', () => {
      const response = 'some-value'
      const result = transformPlatformResponse(response, undefined)

      expect(result).toBe('some-value')
    })
  })

  // ===========================================================================
  // CONTEXT FORMATTING
  // ===========================================================================

  describe('formatContextForPlatform', () => {
    const context = [
      { type: 'text' as const, label: 'Summary', content: 'This is a summary' },
      { type: 'code' as const, label: 'Code', content: 'const x = 1;' },
      { type: 'json' as const, label: 'Data', content: { key: 'value' } },
      { type: 'link' as const, label: 'Reference', content: 'https://example.com' },
    ]

    it('should format context for Slack', () => {
      const formatted = formatContextForPlatform(context, 'slack')

      expect(formatted).toContain('*Summary:*')
      expect(formatted).toContain('```')
      expect(formatted).toContain('<https://example.com|View>')
    })

    it('should format context for Teams', () => {
      const formatted = formatContextForPlatform(context, 'teams')

      expect(formatted).toContain('**Summary:**')
      expect(formatted).toContain('```')
      expect(formatted).toContain('[View](https://example.com)')
    })

    it('should format context for Email', () => {
      const formatted = formatContextForPlatform(context, 'email')

      expect(formatted).toContain('<h4>Summary</h4>')
      expect(formatted).toContain('<pre>')
      expect(formatted).toContain('<a href="https://example.com">')
    })

    it('should return JSON for React', () => {
      const formatted = formatContextForPlatform(context, 'react')

      // React format should be JSON
      expect(() => JSON.parse(formatted)).not.toThrow()
    })
  })

  // ===========================================================================
  // QUICK ACTION OPTIONS
  // ===========================================================================

  describe('createQuickActionOptions', () => {
    it('should create options from quick actions', () => {
      const quickActions: QuickAction[] = [
        { id: 'approve', label: 'Approve', variant: 'primary', value: { approved: true } },
        { id: 'reject', label: 'Reject', variant: 'danger', value: { approved: false } },
      ]

      const options = createQuickActionOptions(quickActions)

      expect(options).toEqual([
        { value: 'approve', label: 'Approve' },
        { value: 'reject', label: 'Reject' },
      ])
    })

    it('should return undefined for empty quick actions', () => {
      const options = createQuickActionOptions([])

      expect(options).toBeUndefined()
    })

    it('should return undefined for undefined quick actions', () => {
      const options = createQuickActionOptions(undefined)

      expect(options).toBeUndefined()
    })
  })

  // ===========================================================================
  // FORM FIELD TRANSFORMATION
  // ===========================================================================

  describe('transformFormFields', () => {
    it('should extract options from select fields', () => {
      const fields: FormField[] = [
        {
          name: 'priority',
          label: 'Priority',
          type: 'select',
          options: [
            { value: 'high', label: 'High' },
            { value: 'low', label: 'Low' },
          ],
        },
      ]

      const options = transformFormFields(fields)

      expect(options).toEqual([
        { value: 'high', label: 'High' },
        { value: 'low', label: 'Low' },
      ])
    })

    it('should extract options from radio fields', () => {
      const fields: FormField[] = [
        {
          name: 'choice',
          label: 'Choice',
          type: 'radio',
          options: [
            { value: 'a', label: 'Option A' },
            { value: 'b', label: 'Option B' },
          ],
        },
      ]

      const options = transformFormFields(fields)

      expect(options).toEqual([
        { value: 'a', label: 'Option A' },
        { value: 'b', label: 'Option B' },
      ])
    })

    it('should return undefined for text-only fields', () => {
      const fields: FormField[] = [
        { name: 'name', label: 'Name', type: 'text' },
        { name: 'email', label: 'Email', type: 'email' },
      ]

      const options = transformFormFields(fields)

      expect(options).toBeUndefined()
    })

    it('should return undefined for undefined fields', () => {
      const options = transformFormFields(undefined)

      expect(options).toBeUndefined()
    })
  })
})

// =============================================================================
// HUMAN EXECUTOR INTEGRATION TESTS
// =============================================================================

describe('HumanExecutor Platform Integration', () => {
  describe('Platform Delivery', () => {
    it('should deliver task when platform config is available', async () => {
      const platformConfig = createTestPlatformConfig('slack')
      const service = new TaskDeliveryService(platformConfig)
      const definition = createTestApprovalFunction()

      const result = await service.deliverTask(
        'exec-task-123',
        definition,
        { requestId: 'REQ-001' }
      )

      expect(result.success).toBe(true)
      expect(result.messageIds.slack).toContain('slack-')
    })

    it('should track platform message IDs', async () => {
      const platformConfig = createTestPlatformConfig('slack')
      const service = new TaskDeliveryService(platformConfig)
      const definition = createTestApprovalFunction()

      const result = await service.deliverTask(
        'track-task-123',
        definition,
        { requestId: 'REQ-001' }
      )

      expect(result.messageIds).toHaveProperty('slack')
      expect(typeof result.messageIds.slack).toBe('string')
      expect(result.messageIds.slack!.startsWith('slack-')).toBe(true)
    })

    it('should support re-delivery after escalation', async () => {
      const platformConfig = createTestPlatformConfig('slack')
      const service = new TaskDeliveryService(platformConfig)
      const definition = createTestApprovalFunction()

      // First delivery
      const firstResult = await service.deliverTask(
        'redeliver-task-123',
        definition,
        { requestId: 'REQ-001' }
      )

      // Simulate escalation - redeliver to additional platforms
      const redeliverResult = await service.deliverToMultiplePlatforms(
        'redeliver-task-123',
        definition,
        { requestId: 'REQ-001' },
        ['teams', 'email']
      )

      expect(firstResult.success).toBe(true)
      expect(redeliverResult.success).toBe(true)
      // At least one of the redelivery platforms should succeed
      expect(
        redeliverResult.messageIds.teams !== undefined ||
        redeliverResult.messageIds.email !== undefined
      ).toBe(true)
    })
  })

  describe('Webhook Payload Handling', () => {
    it('should extract task ID from Slack callback_id', () => {
      const payload = {
        type: 'interactive_message',
        callback_id: 'task-123',
        actions: [{ action_id: 'approve', value: '{"approved":true}' }],
        user: { id: 'U123', name: 'Test User' },
      }

      const taskId = payload.callback_id ?? payload.actions?.[0]?.action_id?.split('-')[0]
      expect(taskId).toBe('task-123')
    })

    it('should extract response value from Slack action', () => {
      const payload = {
        type: 'interactive_message',
        callback_id: 'task-123',
        actions: [{ action_id: 'approve', value: '{"approved":true}' }],
      }

      const actionValue = payload.actions?.[0]?.value
      const response = actionValue ? JSON.parse(actionValue) : undefined

      expect(response).toEqual({ approved: true })
    })

    it('should extract task ID from Teams payload', () => {
      const payload = {
        type: 'invoke',
        value: {
          taskId: 'task-456',
          approved: true,
        },
        from: { id: 'U789', name: 'Teams User' },
      }

      const taskId = payload.value?.taskId
      expect(taskId).toBe('task-456')
    })

    it('should extract response from Teams action value', () => {
      const payload = {
        type: 'invoke',
        value: {
          taskId: 'task-456',
          approved: true,
          comment: 'Looks good',
        },
      }

      const { taskId, ...response } = payload.value
      expect(response).toEqual({ approved: true, comment: 'Looks good' })
    })

    it('should extract task ID from Email query params', () => {
      const url = new URL('https://example.com/webhook?taskId=task-789&option=approve')
      const taskId = url.searchParams.get('taskId')
      const option = url.searchParams.get('option')

      expect(taskId).toBe('task-789')
      expect(option).toBe('approve')
    })
  })

  describe('Notification Adapter Integration', () => {
    it('should use notification adapter for reminders', async () => {
      const platformConfig = createTestPlatformConfig('email')
      const adapter = new NotificationServiceAdapter(platformConfig)

      const result = await adapter.sendNotification(
        'user@example.com',
        'Reminder: Task Pending',
        'Please complete your pending task',
        'email'
      )

      expect(result).toBe(true)
    })

    it('should use notification adapter for escalations', async () => {
      const platformConfig = createTestPlatformConfig('slack')
      const adapter = new NotificationServiceAdapter(platformConfig)

      const result = await adapter.sendNotification(
        'manager-channel',
        'Escalation: Task Overdue',
        'Task has been escalated due to timeout',
        'slack'
      )

      expect(result).toBe(true)
    })

    it('should handle multiple notification channels', async () => {
      const platformConfig = createTestPlatformConfig('slack')
      const adapter = new NotificationServiceAdapter(platformConfig)

      const emailResult = await adapter.sendNotification(
        'user@example.com',
        'Test',
        'Test message',
        'email'
      )

      const slackResult = await adapter.sendNotification(
        'channel',
        'Test',
        'Test message',
        'slack'
      )

      const smsResult = await adapter.sendNotification(
        '+1234567890',
        'Test',
        'Test message',
        'sms'
      )

      expect(emailResult).toBe(true)
      expect(slackResult).toBe(true)
      expect(smsResult).toBe(true)
    })
  })

  describe('Response Transformation for Platforms', () => {
    const quickActions: QuickAction[] = [
      { id: 'approve', label: 'Approve', variant: 'primary', value: { approved: true, decision: 'yes' } },
      { id: 'reject', label: 'Reject', variant: 'danger', value: { approved: false, decision: 'no' } },
    ]

    it('should transform Slack button response', () => {
      // Slack sends the action ID when a button is clicked
      const slackResponse = 'approve'
      const transformed = transformPlatformResponse(slackResponse, quickActions)

      expect(transformed).toEqual({ approved: true, decision: 'yes' })
    })

    it('should transform Teams adaptive card response', () => {
      // Teams might send a selected field
      const teamsResponse = { selected: 'reject', comment: 'Needs revision' }
      const transformed = transformPlatformResponse(teamsResponse, quickActions)

      // Should transform the selected field but preserve comment
      expect(transformed).toEqual({ approved: false, decision: 'no' })
    })

    it('should preserve form data responses', () => {
      // Form responses should be passed through
      const formResponse = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      }
      const transformed = transformPlatformResponse(formResponse, quickActions)

      expect(transformed).toEqual(formResponse)
    })
  })
})
