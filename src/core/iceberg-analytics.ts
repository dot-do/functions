/**
 * R2 Data Catalog (Apache Iceberg) Analytics Module
 *
 * Provides types and interfaces for writing function analytics data
 * to Iceberg tables stored in R2 with Data Catalog integration.
 *
 * This module enables historical analysis of function invocations,
 * rate limiting events, deployments, and errors using SQL-based
 * query engines like R2 SQL, PyIceberg, Spark, and Snowflake.
 *
 * @see https://developers.cloudflare.com/r2/data-catalog/
 * @module core/iceberg-analytics
 */

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for connecting to R2 Data Catalog
 */
export interface IcebergCatalogConfig {
  /**
   * The R2 Data Catalog REST endpoint URI
   * Format: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   */
  catalogUri: string

  /**
   * The warehouse name (bucket name with catalog enabled)
   */
  warehouseName: string

  /**
   * API token with R2 Data Catalog Write permissions
   */
  apiToken: string

  /**
   * Optional namespace for tables (default: 'analytics')
   */
  namespace?: string
}

/**
 * Configuration for the analytics sink behavior
 */
export interface AnalyticsSinkConfig {
  /**
   * Maximum records to buffer before flushing
   * @default 1000
   */
  maxBufferSize?: number

  /**
   * Flush interval in milliseconds
   * @default 60000 (1 minute)
   */
  flushIntervalMs?: number

  /**
   * Target Parquet file size in bytes
   * @default 134217728 (128 MB)
   */
  targetFileSizeBytes?: number

  /**
   * Whether to anonymize client IPs
   * @default true
   */
  anonymizeIps?: boolean

  /**
   * Maximum error message length to store
   * @default 1000
   */
  maxErrorMessageLength?: number
}

// ============================================================================
// Analytics Record Types
// ============================================================================

/**
 * Invocation record for the analytics.invocations Iceberg table
 */
export interface InvocationAnalyticsRecord {
  /** Unique invocation ID (UUID) */
  invocation_id: string
  /** Function identifier */
  function_id: string
  /** Programming language (typescript, python, rust, etc.) */
  language: string
  /** Function version */
  version: string

  // Timing
  /** Invocation start timestamp (ISO 8601) */
  started_at: string
  /** Execution duration in milliseconds */
  duration_ms: number

  // Status
  /** Whether the invocation succeeded */
  success: boolean
  /** Error type/category if failed */
  error_type?: string
  /** Error message if failed (truncated) */
  error_message?: string

  // Performance
  /** Whether this was a cold start */
  cold_start: boolean
  /** Memory used in bytes */
  memory_used_bytes?: number

  // Request context
  /** Client IP (may be anonymized) */
  client_ip?: string
  /** Cloudflare region */
  region?: string
  /** Cloudflare colo (data center) */
  colo?: string

  // Partitioning columns
  /** Date partition (YYYY-MM-DD) */
  date: string
  /** Hour partition (0-23) */
  hour: number
}

/**
 * Rate limit event record for the analytics.rate_limits Iceberg table
 */
export interface RateLimitAnalyticsRecord {
  /** Unique event ID (UUID) */
  event_id: string
  /** Function identifier */
  function_id: string
  /** Client IP (may be anonymized) */
  client_ip: string

  // Event details
  /** When the rate limit was hit (ISO 8601) */
  occurred_at: string
  /** Type of rate limit (per_ip, per_function, global) */
  limit_type: 'per_ip' | 'per_function' | 'global'
  /** The limit value that was exceeded */
  limit_value: number

  // Context
  /** Cloudflare region */
  region?: string
  /** Cloudflare colo (data center) */
  colo?: string

  // Partitioning
  /** Date partition (YYYY-MM-DD) */
  date: string
}

/**
 * Deployment record for the analytics.deployments Iceberg table
 */
export interface DeploymentAnalyticsRecord {
  /** Unique deployment ID (UUID) */
  deployment_id: string
  /** Function identifier */
  function_id: string
  /** Deployed version */
  version: string
  /** Previous version (if upgrade/rollback) */
  previous_version?: string

  // Deployment details
  /** When the deployment occurred (ISO 8601) */
  deployed_at: string
  /** Who initiated the deployment (user ID or API key ID) */
  deployed_by?: string

  // Code metrics
  /** Size of the deployed code in bytes */
  code_size_bytes: number
  /** Size of the source map in bytes */
  source_map_size_bytes?: number

  // Status
  /** Deployment status */
  status: 'success' | 'failed' | 'rolled_back'
  /** Reason for rollback if applicable */
  rollback_reason?: string

  // Partitioning
  /** Date partition (YYYY-MM-DD) */
  date: string
}

/**
 * Error record for the analytics.errors Iceberg table
 */
export interface ErrorAnalyticsRecord {
  /** Unique error ID (UUID) */
  error_id: string
  /** Related invocation ID */
  invocation_id: string
  /** Function identifier */
  function_id: string

  // Error details
  /** When the error occurred (ISO 8601) */
  occurred_at: string
  /** Error type/category */
  error_type: string
  /** Error message (truncated) */
  error_message: string
  /** Stack trace (truncated) */
  stack_trace?: string

  // Context
  /** Programming language */
  language: string
  /** Function version */
  version: string

  // Partitioning
  /** Date partition (YYYY-MM-DD) */
  date: string
}

// ============================================================================
// Analytics Sink Interface
// ============================================================================

/**
 * Interface for writing analytics records to Iceberg tables
 */
export interface IcebergAnalyticsSink {
  /**
   * Record a function invocation for analytics
   */
  recordInvocation(record: Omit<InvocationAnalyticsRecord, 'invocation_id' | 'date' | 'hour'>): void

  /**
   * Record a rate limit event for analytics
   */
  recordRateLimit(record: Omit<RateLimitAnalyticsRecord, 'event_id' | 'date'>): void

  /**
   * Record a deployment for analytics
   */
  recordDeployment(record: Omit<DeploymentAnalyticsRecord, 'deployment_id' | 'date'>): void

  /**
   * Record an error for analytics
   */
  recordError(record: Omit<ErrorAnalyticsRecord, 'error_id' | 'date'>): void

  /**
   * Flush all buffered records to Iceberg
   * @returns Number of records flushed
   */
  flush(): Promise<number>

  /**
   * Get current buffer sizes
   */
  getBufferStats(): {
    invocations: number
    rateLimits: number
    deployments: number
    errors: number
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate partition date string from a timestamp
 */
export function getPartitionDate(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
  return date.toISOString().split('T')[0] ?? ''
}

/**
 * Generate partition hour from a timestamp
 */
export function getPartitionHour(timestamp: string | Date): number {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
  return date.getUTCHours()
}

/**
 * Anonymize an IP address by zeroing the last octet (IPv4) or last 80 bits (IPv6)
 */
export function anonymizeIp(ip: string): string {
  if (ip.includes(':')) {
    // IPv6: zero last 80 bits (keep first 48 bits / 3 groups)
    const parts = ip.split(':')
    if (parts.length >= 3) {
      return `${parts[0]}:${parts[1]}:${parts[2]}:0:0:0:0:0`
    }
    return ip
  } else {
    // IPv4: zero last octet
    const parts = ip.split('.')
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`
    }
    return ip
  }
}

/**
 * Truncate a string to a maximum length, adding ellipsis if truncated
 */
export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}

/**
 * Sanitize an error message by removing potential secrets
 */
export function sanitizeErrorMessage(message: string): string {
  // Remove common secret patterns
  const patterns = [
    // API keys / tokens
    /(?:api[_-]?key|token|secret|password|auth|bearer)[=:\s]+["']?[\w-]+["']?/gi,
    // Connection strings
    /(?:mongodb|postgres|mysql|redis):\/\/[^\s]+/gi,
    // AWS credentials
    /(?:AKIA|ASIA)[A-Z0-9]{16}/gi,
    // Base64 encoded secrets (long base64 strings)
    /[A-Za-z0-9+/]{40,}={0,2}/g,
  ]

  let sanitized = message
  for (const pattern of patterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED]')
  }

  return sanitized
}

// ============================================================================
// Iceberg Table Schema Definitions (for reference)
// ============================================================================

/**
 * SQL DDL for creating the Iceberg tables
 * This is for documentation/reference - actual table creation should be done
 * via PyIceberg, Spark, or the R2 Data Catalog API
 */
export const ICEBERG_TABLE_SCHEMAS = {
  invocations: `
    CREATE TABLE analytics.invocations (
      invocation_id STRING,
      function_id STRING,
      language STRING,
      version STRING,
      started_at TIMESTAMP,
      duration_ms DOUBLE,
      success BOOLEAN,
      error_type STRING,
      error_message STRING,
      cold_start BOOLEAN,
      memory_used_bytes BIGINT,
      client_ip STRING,
      region STRING,
      colo STRING,
      date DATE,
      hour INT
    )
    PARTITIONED BY (date, hour)
  `,

  rate_limits: `
    CREATE TABLE analytics.rate_limits (
      event_id STRING,
      function_id STRING,
      client_ip STRING,
      occurred_at TIMESTAMP,
      limit_type STRING,
      limit_value INT,
      region STRING,
      colo STRING,
      date DATE
    )
    PARTITIONED BY (date)
  `,

  deployments: `
    CREATE TABLE analytics.deployments (
      deployment_id STRING,
      function_id STRING,
      version STRING,
      previous_version STRING,
      deployed_at TIMESTAMP,
      deployed_by STRING,
      code_size_bytes BIGINT,
      source_map_size_bytes BIGINT,
      status STRING,
      rollback_reason STRING,
      date DATE
    )
    PARTITIONED BY (date)
  `,

  errors: `
    CREATE TABLE analytics.errors (
      error_id STRING,
      invocation_id STRING,
      function_id STRING,
      occurred_at TIMESTAMP,
      error_type STRING,
      error_message STRING,
      stack_trace STRING,
      language STRING,
      version STRING,
      date DATE
    )
    PARTITIONED BY (date)
  `,
} as const
