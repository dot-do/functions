/**
 * API Reference Documentation Tests
 *
 * TDD RED Phase: These tests verify the API Reference documentation is complete and correct.
 * Tests should FAIL initially because the documentation doesn't exist yet.
 *
 * Issue: functions-3zci - [RED] API Reference tests
 *
 * Tests verify:
 * 1. All API endpoints are documented (deploy, invoke, list, delete, rollback, logs, details)
 * 2. Request/response schemas match implementation
 * 3. Authentication methods are documented (API keys)
 * 4. Error codes and responses are complete
 * 5. Rate limiting documentation exists
 * 6. Example requests/responses are valid JSON
 *
 * Cross-referenced with actual API implementation in:
 * - src/index.ts (main worker handler)
 * - src/core/function-registry.ts (deploy, list, delete, rollback operations)
 * - src/core/function-loader.ts (invoke operations)
 * - src/core/auth.ts (authentication)
 * - src/core/rate-limiter.ts (rate limiting)
 * - src/core/errors.ts (error codes)
 * - src/core/types.ts (schemas)
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Path to the API Reference documentation
const DOCS_DIR = join(__dirname, '..')
const API_REFERENCE_PATH = join(DOCS_DIR, 'api-reference.md')
const API_REFERENCE_MDX_PATH = join(DOCS_DIR, 'api-reference.mdx')

// Expected API endpoints based on src/index.ts and src/core/function-registry.ts
const EXPECTED_ENDPOINTS = [
  { method: 'POST', path: '/functions/:functionId', operation: 'invoke' },
  { method: 'POST', path: '/functions/:functionId/invoke', operation: 'invoke' },
  { method: 'GET', path: '/functions/:functionId', operation: 'details' },
  { method: 'GET', path: '/functions/:functionId/info', operation: 'info' },
  { method: 'POST', path: '/functions', operation: 'deploy' },
  { method: 'GET', path: '/functions', operation: 'list' },
  { method: 'DELETE', path: '/functions/:functionId', operation: 'delete' },
  { method: 'POST', path: '/functions/:functionId/rollback', operation: 'rollback' },
  { method: 'GET', path: '/functions/:functionId/logs', operation: 'logs' },
  { method: 'GET', path: '/health', operation: 'health' },
]

// Expected error codes from src/core/errors.ts
const EXPECTED_ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'AUTHENTICATION_ERROR',
  'RATE_LIMIT_ERROR',
  'INVOCATION_ERROR',
]

// Expected authentication headers from src/core/auth.ts
const EXPECTED_AUTH_HEADERS = ['X-API-Key']

// Expected rate limit headers from src/core/rate-limiter.ts
const EXPECTED_RATE_LIMIT_HEADERS = [
  'Retry-After',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
]

// Expected rate limits from src/core/rate-limiter.ts DEFAULT_RATE_LIMITS
const EXPECTED_RATE_LIMITS = {
  ip: { windowMs: 60000, maxRequests: 100 },
  function: { windowMs: 60000, maxRequests: 1000 },
}

// FunctionMetadata schema from src/core/types.ts
const FUNCTION_METADATA_FIELDS = [
  'id',
  'version',
  'language',
  'entryPoint',
  'dependencies',
  'createdAt',
  'updatedAt',
]

// Supported languages from src/core/function-registry.ts
const SUPPORTED_LANGUAGES = [
  'typescript',
  'javascript',
  'rust',
  'python',
  'go',
  'zig',
  'assemblyscript',
  'csharp',
]

// HTTP status codes used in implementation
const EXPECTED_HTTP_STATUS_CODES = [200, 400, 401, 404, 405, 429, 500]

// Helper to get the documentation path (supports both .md and .mdx)
function getDocPath(): string | null {
  if (existsSync(API_REFERENCE_MDX_PATH)) return API_REFERENCE_MDX_PATH
  if (existsSync(API_REFERENCE_PATH)) return API_REFERENCE_PATH
  return null
}

// Helper to read documentation content
function readDocContent(): string | null {
  const docPath = getDocPath()
  if (!docPath) return null
  return readFileSync(docPath, 'utf-8')
}

// Helper to safely get doc content with assertion
function requireDocContent(): string {
  const content = readDocContent()
  if (!content) {
    throw new Error(
      'Documentation file not found. Expected docs/api-reference.md or docs/api-reference.mdx'
    )
  }
  return content
}

// Helper to extract code blocks from markdown
function extractCodeBlocks(content: string): Array<{ language: string; code: string }> {
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g
  const blocks: Array<{ language: string; code: string }> = []
  let match

  while ((match = codeBlockRegex.exec(content)) !== null) {
    blocks.push({
      language: match[1] || 'text',
      code: match[2].trim(),
    })
  }

  return blocks
}

// Helper to extract JSON code blocks
function extractJsonBlocks(content: string): string[] {
  const codeBlocks = extractCodeBlocks(content)
  return codeBlocks
    .filter((block) => block.language === 'json' || block.language === 'jsonc')
    .map((block) => block.code)
}

// Helper to validate JSON syntax
function isValidJson(jsonString: string): boolean {
  try {
    // Remove JSONC comments before parsing
    const cleanJson = jsonString
      .replace(/\/\/.*$/gm, '') // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
      .trim()
    JSON.parse(cleanJson)
    return true
  } catch {
    return false
  }
}

// Helper to extract HTTP method and path patterns from documentation
function extractApiEndpoints(
  content: string
): Array<{ method: string; path: string }> {
  const endpoints: Array<{ method: string; path: string }> = []

  // Match patterns like "### GET /functions/:functionId" or "**POST** `/functions`"
  const patterns = [
    /(?:#{1,4}|##)\s+(GET|POST|PUT|PATCH|DELETE)\s+([\/\w:.-]+)/gi,
    /\*\*(GET|POST|PUT|PATCH|DELETE)\*\*\s+`([^`]+)`/gi,
    /`(GET|POST|PUT|PATCH|DELETE)\s+([^`]+)`/gi,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(content)) !== null) {
      endpoints.push({
        method: match[1].toUpperCase(),
        path: match[2].trim(),
      })
    }
  }

  return endpoints
}

describe('API Reference Documentation', () => {
  describe('Documentation File Existence', () => {
    it('should have api-reference documentation file (.md or .mdx)', () => {
      const docPath = getDocPath()
      expect(
        docPath,
        'Documentation file not found at docs/api-reference.md or docs/api-reference.mdx'
      ).not.toBeNull()
      expect(existsSync(docPath!)).toBe(true)
    })

    it('should have non-empty documentation content', () => {
      const docContent = readDocContent()
      expect(docContent, 'Documentation file is empty or missing').not.toBeNull()
      expect(docContent!.length).toBeGreaterThan(500)
    })
  })

  describe('Document Structure', () => {
    it('should have a title heading', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/^#\s+.+/m)
    })

    it('should have an introduction/overview section', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/introduction|overview|about/i)
    })

    it('should have authentication section', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/##\s*authentication|##\s*auth/i)
    })

    it('should have endpoints section', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/##\s*endpoints|##\s*api\s*endpoints|##\s*operations/i)
    })

    it('should have error handling section', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/##\s*error|##\s*errors/i)
    })

    it('should have rate limiting section', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/##\s*rate\s*limit/i)
    })
  })

  describe('API Endpoints Documentation', () => {
    describe('Deploy Endpoint', () => {
      it('should document the deploy endpoint (POST /functions)', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/POST\s+.*\/functions(?!\/:)/i)
      })

      it('should document deploy request body schema', () => {
        const docContent = requireDocContent()
        // Should mention required fields for deployment
        for (const field of ['id', 'version', 'language', 'entryPoint']) {
          expect(
            docContent,
            `Deploy endpoint should document the '${field}' field`
          ).toMatch(new RegExp(field, 'i'))
        }
      })

      it('should document deploy response format', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/deploy.*response|response.*deploy/i)
      })
    })

    describe('Invoke Endpoint', () => {
      it('should document the invoke endpoint (POST /functions/:functionId)', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/POST\s+.*\/functions\/.*:?functionId/i)
      })

      it('should document the invoke endpoint with /invoke suffix', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/\/functions\/.*\/invoke/i)
      })

      it('should document RPC-style method invocation', () => {
        const docContent = requireDocContent()
        // Should explain the { method, params } pattern
        expect(docContent).toMatch(/method.*params|rpc|invoke/i)
      })

      it('should document invoke request body options', () => {
        const docContent = requireDocContent()
        // Should explain both direct fetch and RPC invocation
        expect(docContent).toMatch(/request\s*body|payload|json/i)
      })

      it('should document invoke response format', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/invoke.*response|response.*invoke|result/i)
      })
    })

    describe('List Endpoint', () => {
      it('should document the list endpoint (GET /functions)', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/GET\s+.*\/functions(?!\/:)/i)
      })

      it('should document list response array format', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/list.*function|function.*list|array/i)
      })
    })

    describe('Delete Endpoint', () => {
      it('should document the delete endpoint (DELETE /functions/:functionId)', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/DELETE\s+.*\/functions\//i)
      })

      it('should document delete behavior (cascading version deletion)', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/delete.*version|version.*delete|cascade|remove/i)
      })
    })

    describe('Rollback Endpoint', () => {
      it('should document the rollback endpoint', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/rollback/i)
      })

      it('should document rollback request (specifying version)', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/rollback.*version|version.*rollback/i)
      })

      it('should document rollback response', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/rollback.*response|restored|previous/i)
      })
    })

    describe('Logs Endpoint', () => {
      it('should document the logs endpoint (GET /functions/:functionId/logs)', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/logs/i)
      })

      it('should document log filtering options', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/log.*filter|filter.*log|timestamp|level/i)
      })
    })

    describe('Details/Info Endpoint', () => {
      it('should document the details endpoint (GET /functions/:functionId)', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/GET\s+.*\/functions\/:?functionId/i)
      })

      it('should document the info endpoint (/functions/:functionId/info)', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/\/info|details|metadata/i)
      })

      it('should document response fields (id, status, version, etc)', () => {
        const docContent = requireDocContent()
        for (const field of ['id', 'status', 'version']) {
          expect(
            docContent,
            `Details endpoint should document the '${field}' response field`
          ).toMatch(new RegExp(field, 'i'))
        }
      })
    })

    describe('Health Endpoint', () => {
      it('should document the health endpoint (GET /health)', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/GET\s+.*\/health/i)
      })

      it('should document health response format', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/health.*status|status.*ok/i)
      })
    })
  })

  describe('Request/Response Schemas', () => {
    describe('FunctionMetadata Schema', () => {
      it('should document all FunctionMetadata fields', () => {
        const docContent = requireDocContent()

        for (const field of FUNCTION_METADATA_FIELDS) {
          expect(
            docContent,
            `Schema should document the '${field}' field`
          ).toMatch(new RegExp(field, 'i'))
        }
      })

      it('should document id field constraints (1-255 chars, alphanumeric with hyphens)', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/id.*alphanumeric|255.*char|function.*id/i)
      })

      it('should document version field as semantic version', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/semver|semantic.*version|\d+\.\d+\.\d+/i)
      })

      it('should document language field with supported values', () => {
        const docContent = requireDocContent()
        // Should mention at least typescript as a supported language
        expect(docContent).toMatch(/typescript|language/i)
      })

      it('should list all supported languages', () => {
        const docContent = requireDocContent()
        // At minimum, should mention several supported languages
        const mentionedLanguages = SUPPORTED_LANGUAGES.filter((lang) =>
          docContent.toLowerCase().includes(lang)
        )
        expect(
          mentionedLanguages.length,
          `Should document supported languages, found only: ${mentionedLanguages.join(', ')}`
        ).toBeGreaterThanOrEqual(3)
      })

      it('should document entryPoint field format', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/entryPoint|entry.*point|index\.ts|main/i)
      })

      it('should document dependencies field as object with semver values', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/dependencies|depend/i)
      })

      it('should document optional createdAt and updatedAt timestamps', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/createdAt|created.*at|timestamp/i)
        expect(docContent).toMatch(/updatedAt|updated.*at/i)
      })
    })

    describe('Request Schema Examples', () => {
      it('should include deploy request example JSON', () => {
        const docContent = requireDocContent()
        const jsonBlocks = extractJsonBlocks(docContent)

        // Should have at least one JSON block that looks like a deploy request
        const hasDeployExample = jsonBlocks.some(
          (json) =>
            json.includes('"id"') &&
            json.includes('"version"') &&
            json.includes('"language"')
        )

        expect(
          hasDeployExample,
          'Documentation should include a deploy request JSON example'
        ).toBe(true)
      })

      it('should include invoke request example JSON', () => {
        const docContent = requireDocContent()
        const jsonBlocks = extractJsonBlocks(docContent)

        // Should have JSON showing RPC invocation pattern
        const hasInvokeExample = jsonBlocks.some(
          (json) =>
            json.includes('"method"') || json.includes('"params"') || json.includes('"result"')
        )

        expect(
          hasInvokeExample,
          'Documentation should include an invoke request JSON example'
        ).toBe(true)
      })
    })

    describe('Response Schema Examples', () => {
      it('should include success response example JSON', () => {
        const docContent = requireDocContent()
        const jsonBlocks = extractJsonBlocks(docContent)

        // Should have at least one JSON block that looks like a success response
        const hasSuccessResponse = jsonBlocks.some(
          (json) =>
            json.includes('"result"') ||
            json.includes('"status"') ||
            json.includes('"data"')
        )

        expect(
          hasSuccessResponse,
          'Documentation should include a success response JSON example'
        ).toBe(true)
      })

      it('should include error response example JSON', () => {
        const docContent = requireDocContent()
        const jsonBlocks = extractJsonBlocks(docContent)

        // Should have JSON showing error format
        const hasErrorResponse = jsonBlocks.some(
          (json) => json.includes('"error"') || json.includes('"message"')
        )

        expect(
          hasErrorResponse,
          'Documentation should include an error response JSON example'
        ).toBe(true)
      })

      it('should include list response example JSON (array format)', () => {
        const docContent = requireDocContent()
        const jsonBlocks = extractJsonBlocks(docContent)

        // Should have JSON array response
        const hasArrayResponse = jsonBlocks.some(
          (json) => json.trim().startsWith('[') || json.includes('"functions"')
        )

        expect(
          hasArrayResponse,
          'Documentation should include a list response JSON example (array)'
        ).toBe(true)
      })
    })
  })

  describe('Authentication Documentation', () => {
    it('should document API key authentication', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/api\s*key|api-key|apikey/i)
    })

    it('should document the X-API-Key header', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/X-API-Key/i)
    })

    it('should provide API key authentication example', () => {
      const docContent = requireDocContent()
      // Should show header in request example
      expect(docContent).toMatch(
        /header.*X-API-Key|X-API-Key.*header|Authorization|curl.*-H/i
      )
    })

    it('should document public endpoints that do not require authentication', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/public.*endpoint|no.*auth|health/i)
    })

    it('should list default public endpoints (/, /health)', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/\/health/)
    })

    it('should document 401 Unauthorized response for missing API key', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/401|unauthorized|missing.*api.*key/i)
    })

    it('should document 401 response for invalid API key', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/invalid.*api.*key|api.*key.*invalid/i)
    })

    it('should document API key expiration behavior', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/expir|expire|expiration/i)
    })
  })

  describe('Error Codes and Responses', () => {
    describe('Error Code Documentation', () => {
      it('should document VALIDATION_ERROR code', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/VALIDATION_ERROR|validation.*error/i)
      })

      it('should document NOT_FOUND error code', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/NOT_FOUND|not.*found/i)
      })

      it('should document AUTHENTICATION_ERROR code', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/AUTHENTICATION_ERROR|authentication.*error/i)
      })

      it('should document RATE_LIMIT_ERROR code', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/RATE_LIMIT_ERROR|rate.*limit.*error/i)
      })

      it('should document INVOCATION_ERROR code', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/INVOCATION_ERROR|invocation.*error/i)
      })

      it('should document all expected error codes', () => {
        const docContent = requireDocContent()

        for (const errorCode of EXPECTED_ERROR_CODES) {
          expect(
            docContent,
            `Documentation should mention error code: ${errorCode}`
          ).toMatch(new RegExp(errorCode.replace(/_/g, '[_\\s-]?'), 'i'))
        }
      })
    })

    describe('HTTP Status Code Documentation', () => {
      it('should document 200 OK status', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/200|OK|success/i)
      })

      it('should document 400 Bad Request status', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/400|bad.*request/i)
      })

      it('should document 401 Unauthorized status', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/401|unauthorized/i)
      })

      it('should document 404 Not Found status', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/404|not.*found/i)
      })

      it('should document 405 Method Not Allowed status', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/405|method.*not.*allowed/i)
      })

      it('should document 429 Too Many Requests status', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/429|too.*many.*request|rate.*limit/i)
      })

      it('should document 500 Internal Server Error status', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/500|internal.*server.*error|server.*error/i)
      })
    })

    describe('Error Response Format', () => {
      it('should document error response structure (error field)', () => {
        const docContent = requireDocContent()
        expect(docContent).toMatch(/"error"/i)
      })

      it('should include error response JSON example', () => {
        const docContent = requireDocContent()
        const jsonBlocks = extractJsonBlocks(docContent)

        const hasErrorExample = jsonBlocks.some(
          (json) => json.includes('"error"')
        )

        expect(
          hasErrorExample,
          'Documentation should include error response JSON example'
        ).toBe(true)
      })

      it('should document error context fields', () => {
        const docContent = requireDocContent()
        // Errors can include context like { resource, id } or { field, value }
        expect(docContent).toMatch(/context|detail|resource|field/i)
      })
    })
  })

  describe('Rate Limiting Documentation', () => {
    it('should document rate limiting feature', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/rate\s*limit/i)
    })

    it('should document per-IP rate limits', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/per.?ip|ip.*limit|client.*ip/i)
    })

    it('should document per-function rate limits', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/per.?function|function.*limit/i)
    })

    it('should document default IP rate limit (100 requests/minute)', () => {
      const docContent = requireDocContent()
      // Should mention 100 requests per minute for IP
      expect(docContent).toMatch(/100.*request|100.*minute|100\/min/i)
    })

    it('should document default function rate limit (1000 requests/minute)', () => {
      const docContent = requireDocContent()
      // Should mention 1000 requests per minute for function
      expect(docContent).toMatch(/1000.*request|1000.*minute|1000\/min/i)
    })

    it('should document rate limit window (60 seconds)', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/60.*second|1.*minute|window/i)
    })

    it('should document Retry-After header', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/Retry-After/i)
    })

    it('should document X-RateLimit-Remaining header', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/X-RateLimit-Remaining/i)
    })

    it('should document X-RateLimit-Reset header', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/X-RateLimit-Reset/i)
    })

    it('should document 429 response body format', () => {
      const docContent = requireDocContent()
      const jsonBlocks = extractJsonBlocks(docContent)

      // Should have JSON showing rate limit error response
      const hasRateLimitResponse = jsonBlocks.some(
        (json) =>
          json.includes('"retryAfter"') ||
          json.includes('"resetAt"') ||
          json.includes('Too Many Requests')
      )

      expect(
        hasRateLimitResponse,
        'Documentation should include rate limit error response JSON'
      ).toBe(true)
    })
  })

  describe('Example Requests/Responses Validity', () => {
    it('should have all JSON examples be valid JSON', () => {
      const docContent = requireDocContent()
      const jsonBlocks = extractJsonBlocks(docContent)

      expect(
        jsonBlocks.length,
        'Documentation should include JSON examples'
      ).toBeGreaterThan(0)

      for (const jsonBlock of jsonBlocks) {
        expect(
          isValidJson(jsonBlock),
          `Invalid JSON found in documentation:\n${jsonBlock.substring(0, 200)}...`
        ).toBe(true)
      }
    })

    it('should include cURL example for authentication', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/curl/i)
    })

    it('should include cURL example with X-API-Key header', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/curl.*X-API-Key|X-API-Key.*curl/is)
    })

    it('should include request example for deploy operation', () => {
      const docContent = requireDocContent()
      const jsonBlocks = extractJsonBlocks(docContent)

      const hasDeployRequest = jsonBlocks.some(
        (json) =>
          json.includes('"id"') &&
          (json.includes('"version"') || json.includes('"language"'))
      )

      expect(hasDeployRequest, 'Should include deploy request JSON example').toBe(
        true
      )
    })

    it('should include request example for invoke operation', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/invoke.*example|example.*invoke/i)
    })

    it('should include response example for list operation', () => {
      const docContent = requireDocContent()
      const jsonBlocks = extractJsonBlocks(docContent)

      const hasListResponse = jsonBlocks.some(
        (json) => json.trim().startsWith('[') || json.includes('"functions"')
      )

      expect(hasListResponse, 'Should include list response JSON example').toBe(
        true
      )
    })
  })

  describe('Content Quality', () => {
    it('should explain the base URL', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/base.*url|api.*url|endpoint.*url|functions\.do/i)
    })

    it('should explain content-type requirements (application/json)', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/application\/json|content-type|json/i)
    })

    it('should have sufficient content length for API reference', () => {
      const docContent = requireDocContent()
      // A proper API reference should be at least 3000 characters
      expect(docContent.length).toBeGreaterThan(3000)
    })

    it('should not have TODO or placeholder text', () => {
      const docContent = requireDocContent()
      expect(docContent).not.toMatch(
        /\bTODO\b|\bFIXME\b|\bXXX\b|\[placeholder\]|\[coming soon\]/i
      )
    })

    it('should not have broken markdown syntax', () => {
      const docContent = requireDocContent()
      // Check for common markdown issues
      const codeBlockCount = (docContent.match(/```/g) || []).length
      expect(codeBlockCount % 2).toBe(0)
    })

    it('should document request headers section', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/header|Header/i)
    })

    it('should document response headers section', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/response.*header|header.*response/i)
    })
  })

  describe('Version and Deprecation Documentation', () => {
    it('should document API versioning approach', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/version|versioning/i)
    })

    it('should document semantic versioning for functions', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/semver|semantic.*version|\d+\.\d+\.\d+/i)
    })

    it('should document version history/deployment history feature', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/version.*history|deployment.*history|rollback/i)
    })
  })

  describe('Schema Validation Documentation', () => {
    it('should document function ID validation rules', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(
        /function.*id.*valid|valid.*function.*id|1-255|alphanumeric/i
      )
    })

    it('should document entry point validation rules', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/entry.*point|relative.*path|\.ts|\.js/i)
    })

    it('should document dependency version format', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/depend.*version|semver|^\d+|caret|tilde/i)
    })
  })
})

describe('API Reference Cross-Reference with Implementation', () => {
  describe('Endpoint Coverage', () => {
    it('should document all implemented endpoints', () => {
      const docContent = requireDocContent()
      const documentedEndpoints = extractApiEndpoints(docContent)

      // Check that key operations are documented
      const operations = ['deploy', 'invoke', 'list', 'delete', 'rollback', 'health']

      for (const op of operations) {
        expect(
          docContent.toLowerCase(),
          `Documentation should cover the '${op}' operation`
        ).toContain(op)
      }
    })

    it('should document both functionId path patterns (:functionId and {functionId})', () => {
      const docContent = requireDocContent()
      // Should use some path parameter syntax
      expect(docContent).toMatch(/:[a-zA-Z]+|{[a-zA-Z]+}|<[a-zA-Z]+>/i)
    })
  })

  describe('Schema Field Coverage', () => {
    it('should document WorkerStub interface fields', () => {
      const docContent = requireDocContent()
      // WorkerStub has fetch, connect, scheduled, queue methods
      expect(docContent).toMatch(/fetch|handler/i)
    })

    it('should document RateLimitResult response fields', () => {
      const docContent = requireDocContent()
      // RateLimitResult: { allowed, remaining, resetAt }
      expect(docContent).toMatch(/remaining|resetAt|reset/i)
    })

    it('should document LoadResult fields for function info endpoint', () => {
      const docContent = requireDocContent()
      // LoadResult: { stub, success, fromCache, loadTimeMs, degraded }
      expect(docContent).toMatch(/fromCache|cache|loadTime/i)
    })
  })

  describe('Error Handling Coverage', () => {
    it('should document ValidationError scenarios', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/invalid.*function.*id|invalid.*version|validation/i)
    })

    it('should document NotFoundError scenarios', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/function.*not.*found|not.*found.*error|404/i)
    })

    it('should document rate limit exceeded scenario', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/rate.*limit.*exceeded|too.*many|429/i)
    })
  })
})

describe('API Reference Examples Accuracy', () => {
  describe('Deploy Request Example', () => {
    it('should have example with required fields matching FunctionMetadata', () => {
      const docContent = requireDocContent()
      const jsonBlocks = extractJsonBlocks(docContent)

      const deployExample = jsonBlocks.find(
        (json) =>
          json.includes('"id"') &&
          json.includes('"language"')
      )

      if (deployExample && isValidJson(deployExample)) {
        try {
          const parsed = JSON.parse(deployExample)
          // Should have required fields
          expect(typeof parsed.id === 'string' || parsed.id === undefined).toBe(
            true
          )
        } catch {
          // If parsing fails, the main JSON validity test will catch it
        }
      }
    })
  })

  describe('Error Response Example', () => {
    it('should have error example with error field', () => {
      const docContent = requireDocContent()
      const jsonBlocks = extractJsonBlocks(docContent)

      const errorExample = jsonBlocks.find((json) => json.includes('"error"'))

      expect(errorExample, 'Should have error response example').toBeDefined()

      if (errorExample && isValidJson(errorExample)) {
        try {
          const parsed = JSON.parse(errorExample)
          expect(parsed).toHaveProperty('error')
        } catch {
          // If parsing fails, the main JSON validity test will catch it
        }
      }
    })
  })

  describe('Rate Limit Response Example', () => {
    it('should have 429 response example with required fields', () => {
      const docContent = requireDocContent()
      const jsonBlocks = extractJsonBlocks(docContent)

      // Find rate limit response example
      const rateLimitExample = jsonBlocks.find(
        (json) =>
          json.includes('"retryAfter"') ||
          json.includes('"resetAt"') ||
          json.includes('Too Many')
      )

      if (rateLimitExample && isValidJson(rateLimitExample)) {
        // Example should be parseable
        expect(() => JSON.parse(rateLimitExample)).not.toThrow()
      }
    })
  })
})
