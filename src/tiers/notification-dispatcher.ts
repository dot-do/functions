/**
 * Notification Dispatcher
 *
 * Real notification dispatch implementation for human-in-the-loop tasks.
 * Uses Cloudflare Workers-compatible patterns:
 * - Email notifications via fetch to configurable email API endpoints
 * - Webhook notifications via fetch to configured URLs
 * - Notification state tracking in Durable Object storage
 *
 * @module tiers/notification-dispatcher
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Notification channel types supported by the dispatcher
 */
export type NotificationChannel = 'email' | 'slack' | 'sms' | 'push' | 'webhook'

/**
 * Configuration for the notification dispatcher
 */
export interface NotificationConfig {
  /** Base URL for the email API endpoint (e.g., https://api.sendgrid.com/v3/mail/send) */
  emailApiUrl?: string
  /** API key for the email service */
  emailApiKey?: string
  /** Default "from" address for emails */
  emailFrom?: string
  /** Slack webhook URL for sending Slack messages */
  slackWebhookUrl?: string
  /** SMS API endpoint URL */
  smsApiUrl?: string
  /** SMS API key */
  smsApiKey?: string
  /** Push notification API endpoint */
  pushApiUrl?: string
  /** Push notification API key */
  pushApiKey?: string
  /** Generic webhook URLs keyed by name */
  webhooks?: Record<string, WebhookConfig>
}

/**
 * Webhook configuration
 */
export interface WebhookConfig {
  /** The URL to POST to */
  url: string
  /** Optional secret for signing the payload (HMAC-SHA256) */
  secret?: string
  /** Optional custom headers */
  headers?: Record<string, string>
}

/**
 * A single notification record stored in DO state
 */
export interface NotificationRecord {
  /** Unique ID for this notification */
  id: string
  /** The task ID this notification is for */
  taskId: string
  /** The channel used (email, slack, sms, push, webhook) */
  channel: NotificationChannel
  /** The recipient identifier */
  recipient: string
  /** Notification type (task_created, reminder, escalation, sla_warning, sla_breach) */
  type: NotificationType
  /** Subject line (for email/push) */
  subject: string
  /** Body content */
  body: string
  /** Whether the dispatch was successful */
  success: boolean
  /** Error message if dispatch failed */
  error?: string
  /** HTTP status code from the API response */
  httpStatus?: number
  /** Timestamp when the notification was sent */
  sentAt: number
  /** Number of retry attempts */
  retryCount: number
}

/**
 * Types of notifications
 */
export type NotificationType =
  | 'task_created'
  | 'reminder'
  | 'escalation'
  | 'sla_warning'
  | 'sla_breach'

/**
 * Result of a notification dispatch attempt
 */
export interface DispatchResult {
  success: boolean
  notificationId: string
  error?: string
  httpStatus?: number
}

// =============================================================================
// NOTIFICATION DISPATCHER
// =============================================================================

/**
 * NotificationDispatcher handles real notification delivery via fetch().
 *
 * It sends notifications through various channels (email, Slack, SMS, push,
 * webhooks) and tracks all notification state in Durable Object storage.
 *
 * All external calls use the standard fetch() API, making it fully
 * compatible with Cloudflare Workers.
 */
export class NotificationDispatcher {
  private storage: DurableObjectStorage
  private config: NotificationConfig

  constructor(storage: DurableObjectStorage, config: NotificationConfig) {
    this.storage = storage
    this.config = config
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Dispatch a notification through the specified channel.
   *
   * Sends the notification via fetch() and records the result in DO storage.
   */
  async dispatch(
    channel: NotificationChannel,
    recipient: string,
    subject: string,
    body: string,
    taskId: string,
    type: NotificationType
  ): Promise<DispatchResult> {
    const notificationId = this.generateId()
    const now = Date.now()

    let result: DispatchResult

    try {
      switch (channel) {
        case 'email':
          result = await this.dispatchEmail(notificationId, recipient, subject, body)
          break
        case 'slack':
          result = await this.dispatchSlack(notificationId, recipient, body)
          break
        case 'sms':
          result = await this.dispatchSms(notificationId, recipient, body)
          break
        case 'push':
          result = await this.dispatchPush(notificationId, recipient, subject, body)
          break
        case 'webhook':
          result = await this.dispatchWebhook(notificationId, recipient, subject, body, taskId, type)
          break
        default:
          result = {
            success: false,
            notificationId,
            error: `Unsupported notification channel: ${channel}`,
          }
      }
    } catch (err) {
      result = {
        success: false,
        notificationId,
        error: err instanceof Error ? err.message : 'Unknown dispatch error',
      }
    }

    // Store notification record
    const record: NotificationRecord = {
      id: notificationId,
      taskId,
      channel,
      recipient,
      type,
      subject,
      body,
      success: result.success,
      error: result.error,
      httpStatus: result.httpStatus,
      sentAt: now,
      retryCount: 0,
    }

    await this.storeNotification(record)

    return result
  }

  /**
   * Dispatch a webhook notification to a named webhook or a direct URL.
   */
  async dispatchWebhookDirect(
    webhookUrl: string,
    payload: Record<string, unknown>,
    headers?: Record<string, string>,
    secret?: string
  ): Promise<DispatchResult> {
    const notificationId = this.generateId()

    try {
      const bodyStr = JSON.stringify(payload)
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...headers,
      }

      // Add HMAC signature if secret is provided
      if (secret) {
        const signature = await this.computeHmacSignature(bodyStr, secret)
        requestHeaders['X-Signature-256'] = `sha256=${signature}`
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: bodyStr,
      })

      return {
        success: response.ok,
        notificationId,
        httpStatus: response.status,
        error: response.ok ? undefined : `Webhook returned ${response.status}`,
      }
    } catch (err) {
      return {
        success: false,
        notificationId,
        error: err instanceof Error ? err.message : 'Webhook dispatch failed',
      }
    }
  }

  /**
   * Retry a failed notification.
   */
  async retry(notificationId: string): Promise<DispatchResult> {
    const record = await this.getNotification(notificationId)
    if (!record) {
      return {
        success: false,
        notificationId,
        error: 'Notification record not found',
      }
    }

    if (record.success) {
      return {
        success: true,
        notificationId,
        error: 'Notification already succeeded',
      }
    }

    // Re-dispatch
    const result = await this.dispatch(
      record.channel,
      record.recipient,
      record.subject,
      record.body,
      record.taskId,
      record.type
    )

    // Update the original record's retry count
    record.retryCount++
    record.success = result.success
    record.error = result.error
    record.httpStatus = result.httpStatus
    record.sentAt = Date.now()
    await this.storeNotification(record)

    return result
  }

  /**
   * Get all notification records for a task.
   */
  async getNotificationsForTask(taskId: string): Promise<NotificationRecord[]> {
    const allData = await this.storage.list({ prefix: `notification:${taskId}:` })
    const records: NotificationRecord[] = []
    for (const [_key, value] of allData) {
      records.push(value as NotificationRecord)
    }
    return records.sort((a, b) => a.sentAt - b.sentAt)
  }

  /**
   * Get a single notification record by ID.
   */
  async getNotification(notificationId: string): Promise<NotificationRecord | null> {
    // Search across all notifications (ID includes task prefix)
    const allData = await this.storage.list({ prefix: 'notification:' })
    for (const [_key, value] of allData) {
      const record = value as NotificationRecord
      if (record.id === notificationId) {
        return record
      }
    }
    return null
  }

  /**
   * Get notification statistics for a task.
   */
  async getNotificationStats(taskId: string): Promise<{
    total: number
    successful: number
    failed: number
    byChannel: Record<string, number>
    byType: Record<string, number>
  }> {
    const records = await this.getNotificationsForTask(taskId)
    const stats = {
      total: records.length,
      successful: 0,
      failed: 0,
      byChannel: {} as Record<string, number>,
      byType: {} as Record<string, number>,
    }

    for (const record of records) {
      if (record.success) {
        stats.successful++
      } else {
        stats.failed++
      }
      stats.byChannel[record.channel] = (stats.byChannel[record.channel] ?? 0) + 1
      stats.byType[record.type] = (stats.byType[record.type] ?? 0) + 1
    }

    return stats
  }

  // ===========================================================================
  // CHANNEL IMPLEMENTATIONS
  // ===========================================================================

  private async dispatchEmail(
    notificationId: string,
    to: string,
    subject: string,
    body: string
  ): Promise<DispatchResult> {
    const { emailApiUrl, emailApiKey, emailFrom } = this.config

    if (!emailApiUrl) {
      return {
        success: false,
        notificationId,
        error: 'Email API URL not configured',
      }
    }

    const payload = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: emailFrom ?? 'notifications@human.do' },
      subject,
      content: [
        { type: 'text/plain', value: body },
        { type: 'text/html', value: this.formatHtmlEmail(subject, body) },
      ],
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (emailApiKey) {
      headers['Authorization'] = `Bearer ${emailApiKey}`
    }

    const response = await fetch(emailApiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    return {
      success: response.ok,
      notificationId,
      httpStatus: response.status,
      error: response.ok ? undefined : `Email API returned ${response.status}`,
    }
  }

  private async dispatchSlack(
    notificationId: string,
    channel: string,
    message: string
  ): Promise<DispatchResult> {
    const { slackWebhookUrl } = this.config

    if (!slackWebhookUrl) {
      return {
        success: false,
        notificationId,
        error: 'Slack webhook URL not configured',
      }
    }

    const payload = {
      channel,
      text: message,
      unfurl_links: false,
    }

    const response = await fetch(slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    return {
      success: response.ok,
      notificationId,
      httpStatus: response.status,
      error: response.ok ? undefined : `Slack webhook returned ${response.status}`,
    }
  }

  private async dispatchSms(
    notificationId: string,
    phone: string,
    message: string
  ): Promise<DispatchResult> {
    const { smsApiUrl, smsApiKey } = this.config

    if (!smsApiUrl) {
      return {
        success: false,
        notificationId,
        error: 'SMS API URL not configured',
      }
    }

    const payload = {
      to: phone,
      body: message,
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (smsApiKey) {
      headers['Authorization'] = `Bearer ${smsApiKey}`
    }

    const response = await fetch(smsApiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    return {
      success: response.ok,
      notificationId,
      httpStatus: response.status,
      error: response.ok ? undefined : `SMS API returned ${response.status}`,
    }
  }

  private async dispatchPush(
    notificationId: string,
    userId: string,
    title: string,
    body: string
  ): Promise<DispatchResult> {
    const { pushApiUrl, pushApiKey } = this.config

    if (!pushApiUrl) {
      return {
        success: false,
        notificationId,
        error: 'Push notification API URL not configured',
      }
    }

    const payload = {
      userId,
      title,
      body,
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (pushApiKey) {
      headers['Authorization'] = `Bearer ${pushApiKey}`
    }

    const response = await fetch(pushApiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    return {
      success: response.ok,
      notificationId,
      httpStatus: response.status,
      error: response.ok ? undefined : `Push API returned ${response.status}`,
    }
  }

  private async dispatchWebhook(
    notificationId: string,
    webhookName: string,
    subject: string,
    body: string,
    taskId: string,
    type: NotificationType
  ): Promise<DispatchResult> {
    const webhookConfig = this.config.webhooks?.[webhookName]

    if (!webhookConfig) {
      return {
        success: false,
        notificationId,
        error: `Webhook "${webhookName}" not configured`,
      }
    }

    const payload = {
      event: type,
      taskId,
      subject,
      body,
      timestamp: Date.now(),
    }

    return this.dispatchWebhookDirect(
      webhookConfig.url,
      payload,
      webhookConfig.headers,
      webhookConfig.secret
    )
  }

  // ===========================================================================
  // STORAGE
  // ===========================================================================

  private async storeNotification(record: NotificationRecord): Promise<void> {
    const key = `notification:${record.taskId}:${record.id}`
    await this.storage.put(key, record)
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  private generateId(): string {
    return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }

  private formatHtmlEmail(subject: string, body: string): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #333;">${this.escapeHtml(subject)}</h2>
  <div style="color: #555; line-height: 1.6;">${this.escapeHtml(body).replace(/\n/g, '<br>')}</div>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
  <p style="color: #999; font-size: 12px;">Sent by human.do notification service</p>
</body>
</html>`
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /**
   * Compute HMAC-SHA256 signature using the Web Crypto API (Workers-compatible).
   */
  private async computeHmacSignature(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}
