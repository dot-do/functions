/**
 * Human-in-the-Loop Integration
 *
 * Bridges the HumanExecutor Durable Object with the human-in-the-loop package
 * for multi-platform human interaction support (Slack, Teams, Email, React).
 *
 * This module provides:
 * - Standalone implementations for all platforms
 * - Adapters to bridge HumanExecutor definitions with platform APIs
 * - Response transformation utilities
 * - Context formatting for different platforms
 *
 * @module tiers/human-loop-integration
 */

import type {
  HumanFunctionDefinition,
  HumanFunctionConfig,
  QuickAction,
  FormField,
  UIContext,
  ReminderChannel,
} from '@dotdo/functions/human'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Supported platforms for human-in-the-loop interactions
 */
export type HumanPlatform = 'slack' | 'teams' | 'react' | 'email'

/**
 * Slack-specific configuration
 */
export interface SlackConfig {
  channel?: string
  mentions?: string[]
  modal?: boolean
  blocks?: unknown[]
  webhookUrl?: string
}

/**
 * Microsoft Teams specific configuration
 */
export interface TeamsConfig {
  webhookUrl?: string
  useAdaptiveCards?: boolean
}

/**
 * React-specific configuration
 */
export interface ReactConfig {
  styles?: Record<string, unknown>
  theme?: 'light' | 'dark' | 'system'
}

/**
 * Email-specific configuration
 */
export interface EmailConfig {
  to: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  from?: string
  replyTo?: string
  callbackUrl?: string
}

/**
 * Platform configuration for human-in-the-loop integration
 */
export interface PlatformConfig {
  /** Primary platform for task delivery */
  platform: HumanPlatform

  /** Slack-specific configuration */
  slack?: SlackConfig

  /** Teams-specific configuration */
  teams?: TeamsConfig

  /** Email-specific configuration */
  email?: EmailConfig

  /** React-specific configuration */
  react?: ReactConfig

  /** Callback URL for responses */
  callbackUrl?: string
}

/**
 * Task delivery result from platform
 */
export interface TaskDeliveryResult {
  /** Whether delivery was successful */
  success: boolean

  /** Platform-specific message IDs */
  messageIds: Partial<Record<HumanPlatform, string>>

  /** Error if delivery failed */
  error?: string
}

/**
 * Notification configuration
 */
export interface NotificationConfig {
  /** Channels to send notifications to */
  channels: ReminderChannel[]

  /** Platform-specific configs */
  platformConfig?: PlatformConfig
}

/**
 * Human function options for platform creation
 */
export interface CreateHumanFunctionOptions {
  platform: HumanPlatform
  title: string
  description: string
  timeout?: number
  options?: Array<{ value: string; label: string }>
  freeText?: boolean
  channel?: string
  mentions?: string[]
  webhookUrl?: string
  useAdaptiveCards?: boolean
  to?: string | string[]
  from?: string
  callbackUrl?: string
  theme?: 'light' | 'dark' | 'system'
  [key: string]: unknown
}

/**
 * Human task request result
 */
export interface HumanTaskRequest {
  taskId: string
  status: 'pending' | 'completed' | 'timeout'
  messageId?: Record<HumanPlatform, string>
}

/**
 * Human function interface
 */
export interface HumanFunction<TInput, TOutput> {
  request(input: TInput): Promise<HumanTaskRequest>
  getResponse(taskId: string): Promise<TOutput | null>
}

// =============================================================================
// PLATFORM ADAPTER
// =============================================================================

/**
 * Adapts HumanFunctionDefinition to CreateHumanFunctionOptions
 */
export function adaptDefinitionToOptions(
  definition: HumanFunctionDefinition,
  platformConfig: PlatformConfig,
  input?: unknown
): CreateHumanFunctionOptions {
  const { platform } = platformConfig

  // Build options array from quickActions
  const options = definition.ui.quickActions?.map((action) => ({
    value: action.id,
    label: action.label,
  }))

  // Check if form allows free text
  const hasFreeTextForm = definition.ui.form?.some(
    (field) => field.type === 'text' || field.type === 'textarea'
  )

  const baseOptions: CreateHumanFunctionOptions = {
    platform,
    title: definition.ui.title,
    description: definition.ui.description ?? '',
    timeout: parseDurationToMs(definition.timeout),
    options,
    freeText: hasFreeTextForm,
  }

  // Add platform-specific configuration
  switch (platform) {
    case 'slack':
      return {
        ...baseOptions,
        ...platformConfig.slack,
        channel: platformConfig.slack?.channel ?? 'general',
        mentions: getMentions(definition, platformConfig),
      }

    case 'teams':
      return {
        ...baseOptions,
        ...platformConfig.teams,
        webhookUrl: platformConfig.teams?.webhookUrl,
        useAdaptiveCards: platformConfig.teams?.useAdaptiveCards ?? true,
      }

    case 'email':
      if (!platformConfig.email?.to) {
        throw new Error('Email platform requires "to" field in platformConfig')
      }
      return {
        ...baseOptions,
        ...platformConfig.email,
        to: platformConfig.email.to,
        callbackUrl: platformConfig.callbackUrl,
      }

    case 'react':
      return {
        ...baseOptions,
        ...platformConfig.react,
        theme: platformConfig.react?.theme ?? 'system',
      }

    default:
      return baseOptions
  }
}

/**
 * Parse Duration (number or string) to milliseconds
 * Compatible with the Duration type from core/types.ts
 */
function parseDurationToMs(timeout?: number | string): number | undefined {
  if (timeout === undefined || timeout === null) return undefined

  // If already a number, return as-is (it's milliseconds)
  if (typeof timeout === 'number') return timeout

  // Parse string formats: 1h, 24h, 30m, 1d, etc.
  const match = timeout.match(/^(\d+)\s*(ms|s|seconds?|m|minutes?|h|hours?|d|days?)$/)
  if (!match) return undefined

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case 'ms':
      return value
    case 's':
    case 'second':
    case 'seconds':
      return value * 1000
    case 'm':
    case 'minute':
    case 'minutes':
      return value * 60 * 1000
    case 'h':
    case 'hour':
    case 'hours':
      return value * 60 * 60 * 1000
    case 'd':
    case 'day':
    case 'days':
      return value * 24 * 60 * 60 * 1000
    default:
      return undefined
  }
}

/**
 * Get mentions for Slack based on assignees
 */
function getMentions(
  definition: HumanFunctionDefinition,
  platformConfig: PlatformConfig
): string[] | undefined {
  const mentions: string[] = []

  // Add mentions from slack config
  if (platformConfig.slack?.mentions) {
    mentions.push(...platformConfig.slack.mentions)
  }

  // Add user IDs from assignees
  if (definition.assignees?.users) {
    mentions.push(...definition.assignees.users)
  }

  return mentions.length > 0 ? mentions : undefined
}

// =============================================================================
// STANDALONE PLATFORM IMPLEMENTATIONS
// =============================================================================

/**
 * Create a Slack message for a task
 */
export async function createSlackMessage(
  taskId: string,
  input: unknown,
  config: SlackConfig & {
    title: string
    description: string
    options?: Array<{ value: string; label: string }>
    freeText?: boolean
  }
): Promise<{ messageId: string }> {
  // In production, this would call the Slack API
  // For now, we log and return a mock message ID
  console.log(`[Slack] Creating message for task ${taskId}`)
  console.log(`[Slack] Title: ${config.title}`)
  console.log(`[Slack] Description: ${config.description}`)
  console.log(`[Slack] Channel: ${config.channel}`)
  console.log(`[Slack] Mentions: ${config.mentions?.join(', ')}`)

  return { messageId: `slack-${taskId}-${Date.now()}` }
}

/**
 * Create a Teams message for a task
 */
export async function createTeamsMessage(
  taskId: string,
  input: unknown,
  config: TeamsConfig & {
    title: string
    description: string
    options?: Array<{ value: string; label: string }>
    freeText?: boolean
  }
): Promise<{ messageId: string }> {
  // In production, this would call the Teams webhook
  console.log(`[Teams] Creating message for task ${taskId}`)
  console.log(`[Teams] Title: ${config.title}`)
  console.log(`[Teams] Description: ${config.description}`)
  console.log(`[Teams] Webhook: ${config.webhookUrl}`)

  return { messageId: `teams-${taskId}-${Date.now()}` }
}

/**
 * Send an email for a task
 */
export async function sendEmail(
  config: EmailConfig & {
    title: string
    description: string
    taskId: string
    options?: Array<{ value: string; label: string }>
  }
): Promise<{ messageId: string }> {
  // In production, this would send an actual email
  console.log(`[Email] Sending email for task ${config.taskId}`)
  console.log(`[Email] To: ${Array.isArray(config.to) ? config.to.join(', ') : config.to}`)
  console.log(`[Email] Title: ${config.title}`)
  console.log(`[Email] Description: ${config.description}`)

  return { messageId: `email-${config.taskId}-${Date.now()}` }
}

// =============================================================================
// TASK DELIVERY SERVICE
// =============================================================================

/**
 * Service for delivering tasks to platforms
 */
export class TaskDeliveryService {
  private platformConfig: PlatformConfig

  constructor(platformConfig: PlatformConfig) {
    this.platformConfig = platformConfig
  }

  /**
   * Deliver a task to the configured platform
   */
  async deliverTask(
    taskId: string,
    definition: HumanFunctionDefinition,
    input: unknown,
    config?: HumanFunctionConfig
  ): Promise<TaskDeliveryResult> {
    const { platform } = this.platformConfig

    try {
      const options = adaptDefinitionToOptions(
        definition,
        this.platformConfig,
        input
      )

      const messageIds: Partial<Record<HumanPlatform, string>> = {}

      switch (platform) {
        case 'slack': {
          const slackConfig = {
            ...this.platformConfig.slack,
            title: definition.ui.title,
            description: definition.ui.description ?? '',
            ...(options.options && { options: options.options }),
            ...(options.freeText !== undefined && { freeText: options.freeText }),
          }
          const result = await createSlackMessage(taskId, input, slackConfig)
          messageIds.slack = result.messageId
          break
        }

        case 'teams': {
          const teamsConfig = {
            ...this.platformConfig.teams,
            title: definition.ui.title,
            description: definition.ui.description ?? '',
            ...(options.options && { options: options.options }),
            ...(options.freeText !== undefined && { freeText: options.freeText }),
          }
          const result = await createTeamsMessage(taskId, input, teamsConfig)
          messageIds.teams = result.messageId
          break
        }

        case 'email': {
          const emailConfig = this.platformConfig.email
          if (!emailConfig?.to) {
            throw new Error('Email delivery requires "to" address')
          }

          const emailOptions = definition.ui.quickActions?.map((action) => ({
            value: action.id,
            label: action.label,
          }))
          const result = await sendEmail({
            ...emailConfig,
            title: definition.ui.title,
            description: definition.ui.description ?? '',
            taskId,
            ...(emailOptions && { options: emailOptions }),
          })
          messageIds.email = result.messageId
          break
        }

        case 'react': {
          // React doesn't need active delivery - UI is rendered on demand
          messageIds.react = `react-${taskId}`
          break
        }
      }

      return {
        success: true,
        messageIds,
      }
    } catch (error) {
      return {
        success: false,
        messageIds: {},
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Deliver task to multiple platforms
   */
  async deliverToMultiplePlatforms(
    taskId: string,
    definition: HumanFunctionDefinition,
    input: unknown,
    platforms: HumanPlatform[]
  ): Promise<TaskDeliveryResult> {
    const messageIds: Partial<Record<HumanPlatform, string>> = {}
    const errors: string[] = []

    for (const platform of platforms) {
      const service = new TaskDeliveryService({
        ...this.platformConfig,
        platform,
      })

      const result = await service.deliverTask(taskId, definition, input)

      if (result.success) {
        Object.assign(messageIds, result.messageIds)
      } else if (result.error) {
        errors.push(`${platform}: ${result.error}`)
      }
    }

    const result: TaskDeliveryResult = {
      success: Object.keys(messageIds).length > 0,
      messageIds,
    }
    if (errors.length > 0) {
      result.error = errors.join('; ')
    }
    return result
  }
}

// =============================================================================
// NOTIFICATION SERVICE ADAPTER
// =============================================================================

/**
 * Adapts platforms for sending notifications
 * (reminders, escalations, SLA warnings)
 */
export class NotificationServiceAdapter {
  private platformConfig: PlatformConfig

  constructor(platformConfig: PlatformConfig) {
    this.platformConfig = platformConfig
  }

  /**
   * Send a notification via the configured platform
   */
  async sendNotification(
    recipient: string,
    subject: string,
    body: string,
    channel: ReminderChannel
  ): Promise<boolean> {
    try {
      switch (channel) {
        case 'email':
          await this.sendEmailNotification(recipient, subject, body)
          return true

        case 'slack':
          await this.sendSlackNotification(recipient, body)
          return true

        case 'sms':
          // SMS would require additional integration
          console.log(`[SMS] Notification to ${recipient}: ${body}`)
          return true

        case 'push':
          // Push would require additional integration
          console.log(`[Push] Notification to ${recipient}: ${subject} - ${body}`)
          return true

        default:
          return false
      }
    } catch (error) {
      console.error(`Failed to send ${channel} notification:`, error)
      return false
    }
  }

  private async sendEmailNotification(
    recipient: string,
    subject: string,
    body: string
  ): Promise<void> {
    const emailConfig = this.platformConfig.email ?? {
      to: recipient,
    }

    await sendEmail({
      ...emailConfig,
      to: recipient,
      title: subject,
      description: body,
      taskId: `notification-${Date.now()}`,
    })
  }

  private async sendSlackNotification(
    recipient: string,
    message: string
  ): Promise<void> {
    const slackConfig = this.platformConfig.slack ?? {
      channel: recipient,
    }

    await createSlackMessage(
      `notification-${Date.now()}`,
      { message },
      {
        ...slackConfig,
        channel: recipient,
        title: 'Notification',
        description: message,
      }
    )
  }
}

// =============================================================================
// APPROVAL FLOW HELPERS
// =============================================================================

/**
 * Create options for quick actions (approval/rejection)
 */
export function createQuickActionOptions(
  quickActions?: QuickAction[]
): Array<{ value: string; label: string }> | undefined {
  if (!quickActions || quickActions.length === 0) return undefined

  return quickActions.map((action) => ({
    value: action.id,
    label: action.label,
  }))
}

/**
 * Transform form fields to platform-compatible format
 */
export function transformFormFields(
  fields?: FormField[]
): Array<{ value: string; label: string }> | undefined {
  if (!fields) return undefined

  // Extract select/radio options
  const selectFields = fields.filter(
    (f) => f.type === 'select' || f.type === 'radio'
  )

  if (selectFields.length === 0) return undefined

  return selectFields.flatMap(
    (field) =>
      field.options?.map((opt) => ({
        value: String(opt.value),
        label: opt.label,
      })) ?? []
  )
}

// =============================================================================
// UI CONTEXT FORMATTERS
// =============================================================================

/**
 * Format UI context for platform display
 */
export function formatContextForPlatform(
  context: UIContext[],
  platform: HumanPlatform
): string {
  switch (platform) {
    case 'slack':
      return formatContextForSlack(context)
    case 'teams':
      return formatContextForTeams(context)
    case 'email':
      return formatContextForEmail(context)
    case 'react':
      // React handles context natively
      return JSON.stringify(context)
    default:
      return context.map((c) => `${c.label}: ${formatContent(c)}`).join('\n')
  }
}

function formatContextForSlack(context: UIContext[]): string {
  return context
    .map((c) => {
      switch (c.type) {
        case 'code':
          return `*${c.label}:*\n\`\`\`\n${c.content}\n\`\`\``
        case 'json':
          return `*${c.label}:*\n\`\`\`json\n${JSON.stringify(c.content, null, 2)}\n\`\`\``
        case 'link':
          return `*${c.label}:* <${c.content}|View>`
        case 'image':
          return `*${c.label}:* ${c.content}`
        default:
          return `*${c.label}:* ${formatContent(c)}`
      }
    })
    .join('\n\n')
}

function formatContextForTeams(context: UIContext[]): string {
  return context
    .map((c) => {
      switch (c.type) {
        case 'code':
          return `**${c.label}:**\n\`\`\`\n${c.content}\n\`\`\``
        case 'json':
          return `**${c.label}:**\n\`\`\`json\n${JSON.stringify(c.content, null, 2)}\n\`\`\``
        case 'link':
          return `**${c.label}:** [View](${c.content})`
        case 'image':
          return `**${c.label}:** ![Image](${c.content})`
        default:
          return `**${c.label}:** ${formatContent(c)}`
      }
    })
    .join('\n\n')
}

function formatContextForEmail(context: UIContext[]): string {
  return context
    .map((c) => {
      switch (c.type) {
        case 'code':
          return `<h4>${c.label}</h4><pre>${c.content}</pre>`
        case 'json':
          return `<h4>${c.label}</h4><pre>${JSON.stringify(c.content, null, 2)}</pre>`
        case 'link':
          return `<h4>${c.label}</h4><a href="${c.content}">View</a>`
        case 'image':
          return `<h4>${c.label}</h4><img src="${c.content}" alt="${c.label}" />`
        case 'table':
          return `<h4>${c.label}</h4>${formatTableAsHtml(c.content)}`
        default:
          return `<h4>${c.label}</h4><p>${formatContent(c)}</p>`
      }
    })
    .join('')
}

function formatContent(context: UIContext): string {
  if (typeof context.content === 'string') {
    return context.content
  }
  return JSON.stringify(context.content)
}

function formatTableAsHtml(content: unknown): string {
  if (!Array.isArray(content) || content.length === 0) {
    return '<p>No data</p>'
  }

  const headers = Object.keys(content[0])
  const headerRow = `<tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>`
  const dataRows = content
    .map(
      (row: Record<string, unknown>) =>
        `<tr>${headers.map((h) => `<td>${row[h]}</td>`).join('')}</tr>`
    )
    .join('')

  return `<table>${headerRow}${dataRows}</table>`
}

// =============================================================================
// RESPONSE TRANSFORMERS
// =============================================================================

/**
 * Transform platform response to standard format
 */
export function transformPlatformResponse(
  response: unknown,
  quickActions?: QuickAction[]
): unknown {
  // If response is a string matching a quick action ID, return the action's value
  if (typeof response === 'string' && quickActions) {
    const action = quickActions.find((a) => a.id === response)
    if (action) {
      return action.value
    }
  }

  // If response has a 'selected' field, extract the value
  if (
    response &&
    typeof response === 'object' &&
    'selected' in response
  ) {
    const selected = (response as Record<string, unknown>)['selected']
    if (typeof selected === 'string' && quickActions) {
      const action = quickActions.find((a) => a.id === selected)
      if (action) {
        return action.value
      }
    }
  }

  return response
}
