/**
 * Audit Logger for Functions.do
 *
 * Provides structured audit logging for sensitive operations including:
 * - Function deployment and deletion
 * - API key creation and revocation
 * - Function invocations (optional)
 *
 * Logs are emitted in structured JSON format for easy parsing by log
 * aggregation systems (Datadog, Splunk, CloudWatch, etc.).
 *
 * @module core/audit-logger
 */

import { createLogger } from './logger'

const logger = createLogger({ context: { component: 'audit-logger' }, format: 'json' })

/**
 * Actions that can be logged for audit purposes.
 */
export type AuditAction = 'deploy' | 'delete' | 'invoke' | 'create_key' | 'revoke_key'

/**
 * Status of the audited operation.
 */
export type AuditStatus = 'success' | 'failure'

/**
 * Structured audit log entry.
 *
 * Contains all relevant information about a sensitive operation
 * for security compliance and forensic analysis.
 */
export interface AuditLogEntry {
  /** Unix timestamp in milliseconds when the action occurred */
  timestamp: number
  /** User ID performing the action (from auth context) */
  userId: string
  /** The type of action being performed */
  action: AuditAction
  /** Resource identifier (function ID, API key ID, etc.) */
  resource: string
  /** Whether the operation succeeded or failed */
  status: AuditStatus
  /** Additional context about the operation */
  details?: Record<string, unknown> | undefined
  /** Client IP address if available */
  ip?: string | undefined
}

/**
 * Log an audit event for sensitive operations.
 *
 * Emits a structured JSON log entry to console for capture by
 * log aggregation systems. The 'type: audit' field enables easy
 * filtering of audit logs from application logs.
 *
 * @param entry - The audit log entry to record
 *
 * @example
 * ```typescript
 * logAuditEvent({
 *   timestamp: Date.now(),
 *   userId: 'user_123',
 *   action: 'deploy',
 *   resource: 'my-function',
 *   status: 'success',
 *   details: { version: '1.0.0', type: 'code' },
 *   ip: '192.168.1.1'
 * })
 * ```
 */
export function logAuditEvent(entry: AuditLogEntry): void {
  // Log in structured format for capture by log aggregation
  logger.info('audit', { type: 'audit', ...entry })
}

/**
 * Helper to extract client IP from request headers.
 *
 * Checks common headers in order of preference:
 * 1. CF-Connecting-IP (Cloudflare)
 * 2. X-Forwarded-For (proxies)
 * 3. X-Real-IP (nginx)
 *
 * @param request - The incoming HTTP request
 * @returns The client IP address or undefined if not available
 */
export function getClientIp(request: Request): string | undefined {
  // Cloudflare Workers provides this header
  const cfIp = request.headers.get('CF-Connecting-IP')
  if (cfIp) return cfIp

  // Standard proxy header (may contain multiple IPs, take first)
  const forwardedFor = request.headers.get('X-Forwarded-For')
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim()
    if (firstIp) return firstIp
  }

  // nginx real IP header
  const realIp = request.headers.get('X-Real-IP')
  if (realIp) return realIp

  return undefined
}
