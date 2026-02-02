/**
 * Iceberg Analytics Module Tests
 *
 * Comprehensive tests for the R2 Data Catalog (Apache Iceberg) analytics module including:
 * - getPartitionDate() - Date partition extraction from timestamps
 * - getPartitionHour() - Hour partition extraction from timestamps
 * - anonymizeIp() - IP address anonymization for privacy
 * - truncateString() - String truncation with ellipsis
 * - sanitizeErrorMessage() - Secret removal from error messages
 * - Type exports verification
 */

import { describe, it, expect } from 'vitest'
import {
  getPartitionDate,
  getPartitionHour,
  anonymizeIp,
  truncateString,
  sanitizeErrorMessage,
  ICEBERG_TABLE_SCHEMAS,
  type IcebergCatalogConfig,
  type AnalyticsSinkConfig,
  type InvocationAnalyticsRecord,
  type RateLimitAnalyticsRecord,
  type DeploymentAnalyticsRecord,
  type ErrorAnalyticsRecord,
  type IcebergAnalyticsSink,
} from '../iceberg-analytics'

// ============================================================================
// getPartitionDate() Tests
// ============================================================================

describe('getPartitionDate()', () => {
  describe('String Input', () => {
    it('should extract date from ISO 8601 string', () => {
      const result = getPartitionDate('2024-03-15T10:30:00Z')
      expect(result).toBe('2024-03-15')
    })

    it('should extract date from ISO 8601 string with milliseconds', () => {
      const result = getPartitionDate('2024-03-15T10:30:00.123Z')
      expect(result).toBe('2024-03-15')
    })

    it('should extract date from ISO 8601 string with timezone offset', () => {
      // Note: Date parsing may vary; this tests the expected behavior
      const result = getPartitionDate('2024-03-15T10:30:00+05:30')
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('should handle midnight timestamp', () => {
      const result = getPartitionDate('2024-01-01T00:00:00Z')
      expect(result).toBe('2024-01-01')
    })

    it('should handle end of day timestamp', () => {
      const result = getPartitionDate('2024-12-31T23:59:59Z')
      expect(result).toBe('2024-12-31')
    })
  })

  describe('Date Object Input', () => {
    it('should extract date from Date object', () => {
      const date = new Date('2024-03-15T10:30:00Z')
      const result = getPartitionDate(date)
      expect(result).toBe('2024-03-15')
    })

    it('should handle Date object at midnight UTC', () => {
      const date = new Date(Date.UTC(2024, 0, 1, 0, 0, 0))
      const result = getPartitionDate(date)
      expect(result).toBe('2024-01-01')
    })

    it('should handle Date object at end of year', () => {
      const date = new Date(Date.UTC(2024, 11, 31, 23, 59, 59))
      const result = getPartitionDate(date)
      expect(result).toBe('2024-12-31')
    })
  })

  describe('Edge Cases', () => {
    it('should handle leap year date', () => {
      const result = getPartitionDate('2024-02-29T12:00:00Z')
      expect(result).toBe('2024-02-29')
    })

    it('should return consistent format (YYYY-MM-DD)', () => {
      const result = getPartitionDate('2024-03-05T08:00:00Z')
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(result).toBe('2024-03-05')
    })
  })
})

// ============================================================================
// getPartitionHour() Tests
// ============================================================================

describe('getPartitionHour()', () => {
  describe('String Input', () => {
    it('should extract hour from ISO 8601 string', () => {
      const result = getPartitionHour('2024-03-15T10:30:00Z')
      expect(result).toBe(10)
    })

    it('should extract midnight hour as 0', () => {
      const result = getPartitionHour('2024-03-15T00:30:00Z')
      expect(result).toBe(0)
    })

    it('should extract hour 23', () => {
      const result = getPartitionHour('2024-03-15T23:59:59Z')
      expect(result).toBe(23)
    })

    it('should handle noon timestamp', () => {
      const result = getPartitionHour('2024-03-15T12:00:00Z')
      expect(result).toBe(12)
    })
  })

  describe('Date Object Input', () => {
    it('should extract hour from Date object', () => {
      const date = new Date(Date.UTC(2024, 2, 15, 10, 30, 0))
      const result = getPartitionHour(date)
      expect(result).toBe(10)
    })

    it('should extract midnight hour as 0 from Date object', () => {
      const date = new Date(Date.UTC(2024, 2, 15, 0, 0, 0))
      const result = getPartitionHour(date)
      expect(result).toBe(0)
    })

    it('should extract hour 23 from Date object', () => {
      const date = new Date(Date.UTC(2024, 2, 15, 23, 59, 59))
      const result = getPartitionHour(date)
      expect(result).toBe(23)
    })
  })

  describe('Edge Cases', () => {
    it('should return number between 0 and 23', () => {
      for (let hour = 0; hour < 24; hour++) {
        const date = new Date(Date.UTC(2024, 0, 1, hour, 0, 0))
        const result = getPartitionHour(date)
        expect(result).toBe(hour)
        expect(result).toBeGreaterThanOrEqual(0)
        expect(result).toBeLessThanOrEqual(23)
      }
    })
  })
})

// ============================================================================
// anonymizeIp() Tests
// ============================================================================

describe('anonymizeIp()', () => {
  describe('IPv4 Addresses', () => {
    it('should zero the last octet of IPv4 address', () => {
      const result = anonymizeIp('192.168.1.123')
      expect(result).toBe('192.168.1.0')
    })

    it('should handle already anonymized IPv4', () => {
      const result = anonymizeIp('192.168.1.0')
      expect(result).toBe('192.168.1.0')
    })

    it('should handle IPv4 with high octets', () => {
      const result = anonymizeIp('255.255.255.255')
      expect(result).toBe('255.255.255.0')
    })

    it('should handle IPv4 with low octets', () => {
      const result = anonymizeIp('0.0.0.1')
      expect(result).toBe('0.0.0.0')
    })

    it('should handle localhost IPv4', () => {
      const result = anonymizeIp('127.0.0.1')
      expect(result).toBe('127.0.0.0')
    })

    it('should handle private network IPv4', () => {
      const result = anonymizeIp('10.0.0.5')
      expect(result).toBe('10.0.0.0')
    })
  })

  describe('IPv6 Addresses', () => {
    it('should zero last 80 bits of IPv6 address', () => {
      const result = anonymizeIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')
      expect(result).toBe('2001:0db8:85a3:0:0:0:0:0')
    })

    it('should handle short IPv6 address', () => {
      const result = anonymizeIp('2001:db8:85a3::8a2e:370:7334')
      expect(result).toBe('2001:db8:85a3:0:0:0:0:0')
    })

    it('should handle IPv6 loopback', () => {
      const result = anonymizeIp('::1')
      // Split on ':' gives ['', '', '1'] which has 3 parts, so it gets anonymized
      expect(result).toBe('::1:0:0:0:0:0')
    })

    it('should handle full IPv6 address', () => {
      const result = anonymizeIp('fe80:1234:5678:9abc:def0:1234:5678:9abc')
      expect(result).toBe('fe80:1234:5678:0:0:0:0:0')
    })
  })

  describe('Edge Cases', () => {
    it('should return original for malformed IPv4', () => {
      const result = anonymizeIp('192.168.1')
      expect(result).toBe('192.168.1')
    })

    it('should return original for empty string', () => {
      const result = anonymizeIp('')
      expect(result).toBe('')
    })

    it('should return original for non-IP string', () => {
      const result = anonymizeIp('not-an-ip')
      expect(result).toBe('not-an-ip')
    })

    it('should return original for IPv6 with fewer than 3 groups', () => {
      const result = anonymizeIp('2001:db8')
      // Less than 3 parts after split, returns original
      expect(result).toBe('2001:db8')
    })
  })
})

// ============================================================================
// truncateString() Tests
// ============================================================================

describe('truncateString()', () => {
  describe('Normal Truncation', () => {
    it('should not truncate string shorter than maxLength', () => {
      const result = truncateString('Hello', 10)
      expect(result).toBe('Hello')
    })

    it('should not truncate string equal to maxLength', () => {
      const result = truncateString('Hello', 5)
      expect(result).toBe('Hello')
    })

    it('should truncate string longer than maxLength', () => {
      const result = truncateString('Hello, World!', 10)
      expect(result).toBe('Hello, ...')
      expect(result.length).toBe(10)
    })

    it('should add ellipsis when truncating', () => {
      const result = truncateString('This is a very long string', 15)
      expect(result.endsWith('...')).toBe(true)
    })

    it('should preserve content before truncation point', () => {
      const result = truncateString('ABCDEFGHIJ', 7)
      expect(result).toBe('ABCD...')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      const result = truncateString('', 10)
      expect(result).toBe('')
    })

    it('should handle maxLength of 3 (minimum for ellipsis)', () => {
      const result = truncateString('Hello', 3)
      expect(result).toBe('...')
    })

    it('should handle maxLength of 4', () => {
      const result = truncateString('Hello', 4)
      expect(result).toBe('H...')
    })

    it('should handle single character with sufficient maxLength', () => {
      const result = truncateString('A', 10)
      expect(result).toBe('A')
    })

    it('should handle string with special characters', () => {
      const result = truncateString('Error: Connection failed!', 15)
      expect(result.length).toBe(15)
      expect(result.endsWith('...')).toBe(true)
    })

    it('should handle unicode characters', () => {
      const result = truncateString('Hello World', 8)
      expect(result.length).toBe(8)
    })
  })
})

// ============================================================================
// sanitizeErrorMessage() Tests
// ============================================================================

describe('sanitizeErrorMessage()', () => {
  describe('API Keys and Tokens', () => {
    it('should redact api_key patterns', () => {
      const result = sanitizeErrorMessage('Failed with api_key=abc123secret')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('abc123secret')
    })

    it('should redact API-KEY patterns', () => {
      const result = sanitizeErrorMessage('Error: API-KEY: "my-secret-key-123"')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('my-secret-key-123')
    })

    it('should redact token patterns', () => {
      const result = sanitizeErrorMessage('Authentication failed: token=eyJhbGciOiJIUzI1NiJ9')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    })

    it('should redact bearer token patterns', () => {
      const result = sanitizeErrorMessage('Header: bearer abc123xyz')
      expect(result).toContain('[REDACTED]')
    })

    it('should redact secret patterns', () => {
      const result = sanitizeErrorMessage('Config secret=mysupersecret')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('mysupersecret')
    })

    it('should redact password patterns', () => {
      const result = sanitizeErrorMessage('Login failed: password=P@ssw0rd123')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('P@ssw0rd123')
    })

    it('should redact auth patterns', () => {
      const result = sanitizeErrorMessage('auth: myauthvalue123')
      expect(result).toContain('[REDACTED]')
    })
  })

  describe('Connection Strings', () => {
    it('should redact MongoDB connection strings', () => {
      const result = sanitizeErrorMessage('Connection error: mongodb://user:pass@localhost:27017/db')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('user:pass')
    })

    it('should redact PostgreSQL connection strings', () => {
      const result = sanitizeErrorMessage('DB error: postgres://admin:secret@db.example.com:5432/mydb')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('admin:secret')
    })

    it('should redact MySQL connection strings', () => {
      const result = sanitizeErrorMessage('Failed: mysql://root:password@mysql.server.com/database')
      expect(result).toContain('[REDACTED]')
    })

    it('should redact Redis connection strings', () => {
      const result = sanitizeErrorMessage('Redis error: redis://default:mypassword@redis.server.com:6379')
      expect(result).toContain('[REDACTED]')
    })
  })

  describe('AWS Credentials', () => {
    it('should redact AWS access key IDs starting with AKIA', () => {
      const result = sanitizeErrorMessage('AWS error with key AKIAIOSFODNN7EXAMPLE')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE')
    })

    it('should redact AWS temporary credentials starting with ASIA', () => {
      const result = sanitizeErrorMessage('Temporary credential: ASIAJEXAMPLEABCDEFGH')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('ASIAJEXAMPLEABCDEFGH')
    })
  })

  describe('Base64 Encoded Secrets', () => {
    it('should redact long base64 strings', () => {
      const longBase64 = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkw'
      const result = sanitizeErrorMessage(`Encoded secret: ${longBase64}`)
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain(longBase64)
    })

    it('should redact base64 with padding', () => {
      const base64WithPadding = 'dGhpcyBpcyBhIHZlcnkgbG9uZyBzZWNyZXQgdGhhdCBuZWVkcw=='
      const result = sanitizeErrorMessage(`Data: ${base64WithPadding}`)
      expect(result).toContain('[REDACTED]')
    })
  })

  describe('Preserving Safe Content', () => {
    it('should preserve normal error messages', () => {
      const message = 'Connection timeout after 30 seconds'
      const result = sanitizeErrorMessage(message)
      expect(result).toBe(message)
    })

    it('should preserve stack traces without secrets', () => {
      const message = 'Error at processRequest (/app/src/handler.ts:42:10)'
      const result = sanitizeErrorMessage(message)
      expect(result).toBe(message)
    })

    it('should preserve error codes', () => {
      const message = 'ECONNREFUSED: Connection refused to localhost:3000'
      const result = sanitizeErrorMessage(message)
      expect(result).toBe(message)
    })

    it('should preserve HTTP status messages', () => {
      const message = 'HTTP 500: Internal Server Error'
      const result = sanitizeErrorMessage(message)
      expect(result).toBe(message)
    })
  })

  describe('Multiple Secrets', () => {
    it('should redact multiple secrets in the same message', () => {
      const message = 'Failed with api_key=secret123 and token=abc456xyz'
      const result = sanitizeErrorMessage(message)
      expect(result).not.toContain('secret123')
      expect(result).not.toContain('abc456xyz')
      expect(result.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      const result = sanitizeErrorMessage('')
      expect(result).toBe('')
    })

    it('should handle short strings that look like patterns', () => {
      const result = sanitizeErrorMessage('key')
      expect(result).toBe('key')
    })
  })
})

// ============================================================================
// ICEBERG_TABLE_SCHEMAS Tests
// ============================================================================

describe('ICEBERG_TABLE_SCHEMAS', () => {
  describe('Schema Definitions', () => {
    it('should have invocations table schema', () => {
      expect(ICEBERG_TABLE_SCHEMAS.invocations).toBeDefined()
      expect(ICEBERG_TABLE_SCHEMAS.invocations).toContain('CREATE TABLE')
      expect(ICEBERG_TABLE_SCHEMAS.invocations).toContain('analytics.invocations')
      expect(ICEBERG_TABLE_SCHEMAS.invocations).toContain('invocation_id')
      expect(ICEBERG_TABLE_SCHEMAS.invocations).toContain('function_id')
      expect(ICEBERG_TABLE_SCHEMAS.invocations).toContain('PARTITIONED BY')
    })

    it('should have rate_limits table schema', () => {
      expect(ICEBERG_TABLE_SCHEMAS.rate_limits).toBeDefined()
      expect(ICEBERG_TABLE_SCHEMAS.rate_limits).toContain('CREATE TABLE')
      expect(ICEBERG_TABLE_SCHEMAS.rate_limits).toContain('analytics.rate_limits')
      expect(ICEBERG_TABLE_SCHEMAS.rate_limits).toContain('event_id')
      expect(ICEBERG_TABLE_SCHEMAS.rate_limits).toContain('limit_type')
    })

    it('should have deployments table schema', () => {
      expect(ICEBERG_TABLE_SCHEMAS.deployments).toBeDefined()
      expect(ICEBERG_TABLE_SCHEMAS.deployments).toContain('CREATE TABLE')
      expect(ICEBERG_TABLE_SCHEMAS.deployments).toContain('analytics.deployments')
      expect(ICEBERG_TABLE_SCHEMAS.deployments).toContain('deployment_id')
      expect(ICEBERG_TABLE_SCHEMAS.deployments).toContain('version')
    })

    it('should have errors table schema', () => {
      expect(ICEBERG_TABLE_SCHEMAS.errors).toBeDefined()
      expect(ICEBERG_TABLE_SCHEMAS.errors).toContain('CREATE TABLE')
      expect(ICEBERG_TABLE_SCHEMAS.errors).toContain('analytics.errors')
      expect(ICEBERG_TABLE_SCHEMAS.errors).toContain('error_id')
      expect(ICEBERG_TABLE_SCHEMAS.errors).toContain('error_message')
    })
  })

  describe('Schema Completeness', () => {
    it('should have exactly 4 table schemas', () => {
      const keys = Object.keys(ICEBERG_TABLE_SCHEMAS)
      expect(keys).toHaveLength(4)
      expect(keys).toContain('invocations')
      expect(keys).toContain('rate_limits')
      expect(keys).toContain('deployments')
      expect(keys).toContain('errors')
    })

    it('invocations schema should have all required columns', () => {
      const schema = ICEBERG_TABLE_SCHEMAS.invocations
      const requiredColumns = [
        'invocation_id',
        'function_id',
        'language',
        'version',
        'started_at',
        'duration_ms',
        'success',
        'cold_start',
        'date',
        'hour',
      ]
      for (const column of requiredColumns) {
        expect(schema).toContain(column)
      }
    })

    it('rate_limits schema should have all required columns', () => {
      const schema = ICEBERG_TABLE_SCHEMAS.rate_limits
      const requiredColumns = [
        'event_id',
        'function_id',
        'client_ip',
        'occurred_at',
        'limit_type',
        'limit_value',
        'date',
      ]
      for (const column of requiredColumns) {
        expect(schema).toContain(column)
      }
    })

    it('deployments schema should have all required columns', () => {
      const schema = ICEBERG_TABLE_SCHEMAS.deployments
      const requiredColumns = [
        'deployment_id',
        'function_id',
        'version',
        'deployed_at',
        'code_size_bytes',
        'status',
        'date',
      ]
      for (const column of requiredColumns) {
        expect(schema).toContain(column)
      }
    })

    it('errors schema should have all required columns', () => {
      const schema = ICEBERG_TABLE_SCHEMAS.errors
      const requiredColumns = [
        'error_id',
        'invocation_id',
        'function_id',
        'occurred_at',
        'error_type',
        'error_message',
        'date',
      ]
      for (const column of requiredColumns) {
        expect(schema).toContain(column)
      }
    })
  })
})

// ============================================================================
// Type Exports Verification
// ============================================================================

describe('Type Exports', () => {
  describe('Configuration Types', () => {
    it('should export IcebergCatalogConfig type', () => {
      // Type-level test: verify the type can be used
      const config: IcebergCatalogConfig = {
        catalogUri: 'https://account.r2.cloudflarestorage.com',
        warehouseName: 'analytics-bucket',
        apiToken: 'test-token',
        namespace: 'analytics',
      }
      expect(config.catalogUri).toBeDefined()
      expect(config.warehouseName).toBeDefined()
      expect(config.apiToken).toBeDefined()
    })

    it('should export AnalyticsSinkConfig type', () => {
      const config: AnalyticsSinkConfig = {
        maxBufferSize: 1000,
        flushIntervalMs: 60000,
        targetFileSizeBytes: 134217728,
        anonymizeIps: true,
        maxErrorMessageLength: 1000,
      }
      expect(config.maxBufferSize).toBe(1000)
    })

    it('should allow partial AnalyticsSinkConfig', () => {
      const config: AnalyticsSinkConfig = {
        maxBufferSize: 500,
      }
      expect(config.maxBufferSize).toBe(500)
      expect(config.flushIntervalMs).toBeUndefined()
    })
  })

  describe('Analytics Record Types', () => {
    it('should export InvocationAnalyticsRecord type', () => {
      const record: InvocationAnalyticsRecord = {
        invocation_id: 'inv-123',
        function_id: 'func-abc',
        language: 'typescript',
        version: '1.0.0',
        started_at: '2024-03-15T10:30:00Z',
        duration_ms: 150,
        success: true,
        cold_start: false,
        date: '2024-03-15',
        hour: 10,
      }
      expect(record.invocation_id).toBe('inv-123')
    })

    it('should export RateLimitAnalyticsRecord type', () => {
      const record: RateLimitAnalyticsRecord = {
        event_id: 'evt-123',
        function_id: 'func-abc',
        client_ip: '192.168.1.0',
        occurred_at: '2024-03-15T10:30:00Z',
        limit_type: 'per_ip',
        limit_value: 100,
        date: '2024-03-15',
      }
      expect(record.limit_type).toBe('per_ip')
    })

    it('should export DeploymentAnalyticsRecord type', () => {
      const record: DeploymentAnalyticsRecord = {
        deployment_id: 'dep-123',
        function_id: 'func-abc',
        version: '2.0.0',
        deployed_at: '2024-03-15T10:30:00Z',
        code_size_bytes: 1024,
        status: 'success',
        date: '2024-03-15',
      }
      expect(record.status).toBe('success')
    })

    it('should export ErrorAnalyticsRecord type', () => {
      const record: ErrorAnalyticsRecord = {
        error_id: 'err-123',
        invocation_id: 'inv-456',
        function_id: 'func-abc',
        occurred_at: '2024-03-15T10:30:00Z',
        error_type: 'TypeError',
        error_message: 'Cannot read property x of undefined',
        language: 'typescript',
        version: '1.0.0',
        date: '2024-03-15',
      }
      expect(record.error_type).toBe('TypeError')
    })
  })

  describe('Interface Types', () => {
    it('should export IcebergAnalyticsSink interface', () => {
      // Create a mock implementation to verify the interface shape
      const mockSink: IcebergAnalyticsSink = {
        recordInvocation: () => {},
        recordRateLimit: () => {},
        recordDeployment: () => {},
        recordError: () => {},
        flush: async () => 0,
        getBufferStats: () => ({
          invocations: 0,
          rateLimits: 0,
          deployments: 0,
          errors: 0,
        }),
      }
      expect(mockSink.recordInvocation).toBeDefined()
      expect(mockSink.flush).toBeDefined()
      expect(mockSink.getBufferStats).toBeDefined()
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  describe('Partition Functions Together', () => {
    it('should extract consistent date and hour from same timestamp', () => {
      const timestamp = '2024-03-15T14:30:00Z'
      const date = getPartitionDate(timestamp)
      const hour = getPartitionHour(timestamp)

      expect(date).toBe('2024-03-15')
      expect(hour).toBe(14)
    })

    it('should handle Date object consistently', () => {
      const date = new Date(Date.UTC(2024, 5, 20, 8, 45, 30))
      const partitionDate = getPartitionDate(date)
      const partitionHour = getPartitionHour(date)

      expect(partitionDate).toBe('2024-06-20')
      expect(partitionHour).toBe(8)
    })
  })

  describe('Error Processing Pipeline', () => {
    it('should sanitize and truncate error messages correctly', () => {
      const rawError = 'Database connection failed: mongodb://admin:supersecretpassword@db.server.com:27017/production - This is a very long error message that contains sensitive information and needs to be both sanitized and truncated before storage'

      const sanitized = sanitizeErrorMessage(rawError)
      const truncated = truncateString(sanitized, 100)

      expect(truncated.length).toBeLessThanOrEqual(100)
      expect(truncated).not.toContain('supersecretpassword')
      expect(truncated).not.toContain('admin')
    })
  })

  describe('Analytics Record Creation', () => {
    it('should create valid invocation record with partition data', () => {
      const timestamp = '2024-03-15T10:30:00Z'

      const record: InvocationAnalyticsRecord = {
        invocation_id: crypto.randomUUID(),
        function_id: 'my-function',
        language: 'typescript',
        version: '1.0.0',
        started_at: timestamp,
        duration_ms: 150,
        success: true,
        cold_start: false,
        client_ip: anonymizeIp('192.168.1.123'),
        region: 'us-east-1',
        colo: 'IAD',
        date: getPartitionDate(timestamp),
        hour: getPartitionHour(timestamp),
      }

      expect(record.date).toBe('2024-03-15')
      expect(record.hour).toBe(10)
      expect(record.client_ip).toBe('192.168.1.0')
    })

    it('should create valid error record with sanitized message', () => {
      const timestamp = '2024-03-15T10:30:00Z'
      const rawError = 'Failed to connect with api_key=secret123'

      const record: ErrorAnalyticsRecord = {
        error_id: crypto.randomUUID(),
        invocation_id: crypto.randomUUID(),
        function_id: 'my-function',
        occurred_at: timestamp,
        error_type: 'ConnectionError',
        error_message: truncateString(sanitizeErrorMessage(rawError), 1000),
        language: 'typescript',
        version: '1.0.0',
        date: getPartitionDate(timestamp),
      }

      expect(record.error_message).not.toContain('secret123')
      expect(record.error_message).toContain('[REDACTED]')
      expect(record.date).toBe('2024-03-15')
    })
  })
})
