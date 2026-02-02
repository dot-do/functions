/**
 * Cascade Input Validation Tests
 *
 * Tests for the P1 fix: input validation on cascade tier handlers.
 * Validates that cascade handler rejects invalid input with 400 status
 * before any tier execution begins (fail-fast).
 *
 * Tests cover:
 * - validateInput function (unit tests for the validation logic)
 * - cascadeHandler integration (validates input against metadata.inputSchema)
 * - Edge cases: no schema, empty schema, nested objects, arrays, enums
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock @dotdo/functions before any imports that depend on it
vi.mock('@dotdo/functions', () => ({
  DEFAULT_TIER_TIMEOUTS: { code: '5s', generative: '30s', agentic: '5m', human: '24h' },
  TIER_ORDER: ['code', 'generative', 'agentic', 'human'],
  CascadeExhaustedError: class CascadeExhaustedError extends Error {
    history: unknown[]
    totalDurationMs: number
    constructor(message: string, history: unknown[] = [], totalDurationMs = 0) {
      super(message)
      this.name = 'CascadeExhaustedError'
      this.history = history
      this.totalDurationMs = totalDurationMs
    }
  },
  TierTimeoutError: class TierTimeoutError extends Error {
    tier: string
    timeoutMs: number
    constructor(tier: string, timeoutMs: number) {
      super(`Tier ${tier} timed out after ${timeoutMs}ms`)
      this.name = 'TierTimeoutError'
      this.tier = tier
      this.timeoutMs = timeoutMs
    }
  },
  TierSkippedError: class TierSkippedError extends Error {
    tier: string
    reason: string
    constructor(tier: string, reason: string) {
      super(`Tier ${tier} skipped: ${reason}`)
      this.name = 'TierSkippedError'
      this.tier = tier
      this.reason = reason
    }
  },
  parseDuration: (d: string) => {
    if (d.endsWith('ms')) return parseInt(d)
    if (d.endsWith('s')) return parseInt(d) * 1000
    if (d.endsWith('m')) return parseInt(d) * 60 * 1000
    if (d.endsWith('h')) return parseInt(d) * 60 * 60 * 1000
    return parseInt(d)
  },
}))

import { validateInput, cascadeHandler } from '../cascade'
import type { InputJsonSchema } from '../cascade'
import { createMockKV } from '../../../test-utils/mock-kv'
import type { CascadeEnv } from '../cascade-types'

// Type alias for JSON response bodies
type JsonBody = Record<string, unknown>

// =============================================================================
// Unit Tests: validateInput
// =============================================================================

describe('validateInput', () => {
  describe('type validation', () => {
    it('accepts valid object type', () => {
      const schema: InputJsonSchema = { type: 'object' }
      const result = validateInput({ key: 'value' }, schema)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('rejects non-object when object expected', () => {
      const schema: InputJsonSchema = { type: 'object' }
      const result = validateInput('not-an-object', schema)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain("expected type 'object'")
      expect(result.errors[0]).toContain("got 'string'")
    })

    it('accepts valid string type', () => {
      const schema: InputJsonSchema = { type: 'string' }
      const result = validateInput('hello', schema)
      expect(result.valid).toBe(true)
    })

    it('rejects number when string expected', () => {
      const schema: InputJsonSchema = { type: 'string' }
      const result = validateInput(42, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain("expected type 'string'")
    })

    it('accepts valid number type', () => {
      const schema: InputJsonSchema = { type: 'number' }
      const result = validateInput(42, schema)
      expect(result.valid).toBe(true)
    })

    it('coerces string to number when number expected', () => {
      const schema: InputJsonSchema = { type: 'number' }
      const result = validateInput('42', schema)
      expect(result.valid).toBe(true)
    })

    it('rejects non-numeric string when number expected', () => {
      const schema: InputJsonSchema = { type: 'number' }
      const result = validateInput('not-a-number', schema)
      expect(result.valid).toBe(false)
    })

    it('accepts valid boolean type', () => {
      const schema: InputJsonSchema = { type: 'boolean' }
      const result = validateInput(true, schema)
      expect(result.valid).toBe(true)
    })

    it('accepts valid array type', () => {
      const schema: InputJsonSchema = { type: 'array' }
      const result = validateInput([1, 2, 3], schema)
      expect(result.valid).toBe(true)
    })

    it('rejects object when array expected', () => {
      const schema: InputJsonSchema = { type: 'array' }
      const result = validateInput({ key: 'value' }, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain("expected type 'array'")
      expect(result.errors[0]).toContain("got 'object'")
    })

    it('accepts null when null expected', () => {
      const schema: InputJsonSchema = { type: 'null' }
      const result = validateInput(null, schema)
      expect(result.valid).toBe(true)
    })

    it('rejects non-null when null expected', () => {
      const schema: InputJsonSchema = { type: 'null' }
      const result = validateInput('not null', schema)
      expect(result.valid).toBe(false)
    })
  })

  describe('required fields validation', () => {
    it('accepts object with all required fields', () => {
      const schema: InputJsonSchema = {
        type: 'object',
        required: ['name', 'age'],
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      }
      const result = validateInput({ name: 'Alice', age: 30 }, schema)
      expect(result.valid).toBe(true)
    })

    it('rejects object missing required field', () => {
      const schema: InputJsonSchema = {
        type: 'object',
        required: ['name', 'age'],
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      }
      const result = validateInput({ name: 'Alice' }, schema)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain("missing required field 'age'")
    })

    it('reports all missing required fields', () => {
      const schema: InputJsonSchema = {
        type: 'object',
        required: ['name', 'age', 'email'],
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          email: { type: 'string' },
        },
      }
      const result = validateInput({}, schema)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(3)
      expect(result.errors[0]).toContain("'name'")
      expect(result.errors[1]).toContain("'age'")
      expect(result.errors[2]).toContain("'email'")
    })

    it('allows extra fields not in schema', () => {
      const schema: InputJsonSchema = {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
        },
      }
      const result = validateInput({ name: 'Alice', extra: 'field' }, schema)
      expect(result.valid).toBe(true)
    })
  })

  describe('enum validation', () => {
    it('accepts value that matches enum', () => {
      const schema: InputJsonSchema = {
        type: 'object',
        properties: {
          status: { enum: ['active', 'inactive', 'pending'] },
        },
      }
      const result = validateInput({ status: 'active' }, schema)
      expect(result.valid).toBe(true)
    })

    it('rejects value not in enum', () => {
      const schema: InputJsonSchema = {
        type: 'object',
        properties: {
          status: { enum: ['active', 'inactive', 'pending'] },
        },
      }
      const result = validateInput({ status: 'unknown' }, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain("field 'status' must be one of")
      expect(result.errors[0]).toContain('active')
    })
  })

  describe('nested object validation', () => {
    it('validates nested objects recursively', () => {
      const schema: InputJsonSchema = {
        type: 'object',
        properties: {
          address: {
            type: 'object',
            required: ['city'],
            properties: {
              city: { type: 'string' },
              zip: { type: 'string' },
            },
          },
        },
      }
      const result = validateInput({ address: {} }, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain("missing required field 'city'")
      expect(result.errors[0]).toContain('address')
    })

    it('accepts valid nested objects', () => {
      const schema: InputJsonSchema = {
        type: 'object',
        properties: {
          address: {
            type: 'object',
            required: ['city'],
            properties: {
              city: { type: 'string' },
            },
          },
        },
      }
      const result = validateInput({ address: { city: 'NYC' } }, schema)
      expect(result.valid).toBe(true)
    })

    it('validates deeply nested objects', () => {
      const schema: InputJsonSchema = {
        type: 'object',
        properties: {
          level1: {
            type: 'object',
            properties: {
              level2: {
                type: 'object',
                required: ['value'],
                properties: {
                  value: { type: 'string' },
                },
              },
            },
          },
        },
      }
      const result = validateInput({ level1: { level2: {} } }, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain("missing required field 'value'")
    })
  })

  describe('array validation', () => {
    it('validates array items against schema', () => {
      const schema: InputJsonSchema = {
        type: 'array',
        items: { type: 'string' },
      }
      const result = validateInput(['hello', 'world'], schema)
      expect(result.valid).toBe(true)
    })

    it('rejects array with invalid items', () => {
      const schema: InputJsonSchema = {
        type: 'array',
        items: { type: 'string' },
      }
      const result = validateInput(['hello', 42, 'world'], schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('[1]')
      expect(result.errors[0]).toContain("expected type 'string'")
    })

    it('validates array of objects', () => {
      const schema: InputJsonSchema = {
        type: 'array',
        items: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'number' },
          },
        },
      }
      const result = validateInput([{ id: 1 }, {}], schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('[1]')
      expect(result.errors[0]).toContain("missing required field 'id'")
    })
  })

  describe('path reporting', () => {
    it('includes property path in nested errors', () => {
      const schema: InputJsonSchema = {
        type: 'object',
        properties: {
          config: {
            type: 'object',
            required: ['timeout'],
            properties: {
              timeout: { type: 'number' },
            },
          },
        },
      }
      const result = validateInput({ config: {} }, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain('config:')
    })
  })

  describe('edge cases', () => {
    it('accepts any data when schema has no type', () => {
      const schema: InputJsonSchema = {}
      const result = validateInput('anything', schema)
      expect(result.valid).toBe(true)
    })

    it('accepts empty object against schema with no required fields', () => {
      const schema: InputJsonSchema = {
        type: 'object',
        properties: {
          optional: { type: 'string' },
        },
      }
      const result = validateInput({}, schema)
      expect(result.valid).toBe(true)
    })

    it('accepts empty array against array schema', () => {
      const schema: InputJsonSchema = {
        type: 'array',
        items: { type: 'string' },
      }
      const result = validateInput([], schema)
      expect(result.valid).toBe(true)
    })

    it('skips property validation for undefined values', () => {
      const schema: InputJsonSchema = {
        type: 'object',
        properties: {
          optional: { type: 'string', enum: ['a', 'b'] },
        },
      }
      const result = validateInput({}, schema)
      expect(result.valid).toBe(true)
    })

    it('fails fast on type mismatch without checking nested properties', () => {
      const schema: InputJsonSchema = {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
        },
      }
      // Pass a string instead of object - should fail immediately
      const result = validateInput('not-an-object', schema)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      // Should only report the type error, not the missing required field
      expect(result.errors[0]).toContain("expected type 'object'")
    })
  })
})

// =============================================================================
// Integration Tests: cascadeHandler with inputSchema
// =============================================================================

describe('cascadeHandler input validation', () => {
  let mockEnv: CascadeEnv
  let mockCtx: ExecutionContext

  beforeEach(() => {
    const registryKV = createMockKV()
    const codeKV = createMockKV()

    mockEnv = {
      FUNCTIONS_REGISTRY: registryKV,
      FUNCTIONS_CODE: codeKV,
    } as CascadeEnv

    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext
  })

  /**
   * Helper to register a function in the mock KV with inputSchema
   */
  async function registerFunction(
    id: string,
    inputSchema?: Record<string, unknown>
  ) {
    const metadata = {
      id,
      version: '1.0.0',
      language: 'typescript',
      entryPoint: 'index.ts',
      dependencies: {},
      type: 'code',
      ...(inputSchema ? { inputSchema } : {}),
    }
    await mockEnv.FUNCTIONS_REGISTRY.put(
      `registry:${id}`,
      JSON.stringify(metadata)
    )
  }

  it('returns 400 when input fails validation against inputSchema', async () => {
    await registerFunction('my-function', {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
      },
    })

    const request = new Request('https://functions.do/cascade/my-function', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    })

    const response = await cascadeHandler(
      request,
      mockEnv,
      mockCtx,
      { functionId: 'my-function' }
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as JsonBody
    expect(body.error).toBe('Input validation failed')
    expect(body.validationErrors).toBeDefined()
    expect(Array.isArray(body.validationErrors)).toBe(true)
    const errors = body.validationErrors as string[]
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain("missing required field 'query'")
  })

  it('returns 400 with type mismatch error', async () => {
    await registerFunction('typed-function', {
      type: 'object',
      required: ['count'],
      properties: {
        count: { type: 'number' },
      },
    })

    const request = new Request('https://functions.do/cascade/typed-function', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'not-an-object' }),
    })

    const response = await cascadeHandler(
      request,
      mockEnv,
      mockCtx,
      { functionId: 'typed-function' }
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as JsonBody
    expect(body.error).toBe('Input validation failed')
    const errors = body.validationErrors as string[]
    expect(errors[0]).toContain("expected type 'object'")
    expect(errors[0]).toContain("got 'string'")
  })

  it('returns 400 with multiple validation errors', async () => {
    await registerFunction('multi-field-function', {
      type: 'object',
      required: ['name', 'email', 'age'],
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        age: { type: 'number' },
      },
    })

    const request = new Request('https://functions.do/cascade/multi-field-function', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { name: 'Alice' } }),
    })

    const response = await cascadeHandler(
      request,
      mockEnv,
      mockCtx,
      { functionId: 'multi-field-function' }
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as JsonBody
    const errors = body.validationErrors as string[]
    expect(errors.length).toBe(2)
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("'email'"),
        expect.stringContaining("'age'"),
      ])
    )
  })

  it('includes _meta with functionId and schemaType in validation error response', async () => {
    await registerFunction('meta-function', {
      type: 'object',
      required: ['data'],
      properties: {
        data: { type: 'string' },
      },
    })

    const request = new Request('https://functions.do/cascade/meta-function', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    })

    const response = await cascadeHandler(
      request,
      mockEnv,
      mockCtx,
      { functionId: 'meta-function' }
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as JsonBody
    const meta = body._meta as JsonBody
    expect(meta.functionId).toBe('meta-function')
    expect(meta.schemaType).toBe('inputSchema')
  })

  it('skips validation when function has no inputSchema', async () => {
    await registerFunction('no-schema-function')

    // Store some code so the cascade can attempt execution
    await mockEnv.FUNCTIONS_CODE.put(
      'code:no-schema-function',
      'export default { fetch() { return new Response("ok") } }'
    )

    const request = new Request('https://functions.do/cascade/no-schema-function', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { anything: 'goes' } }),
    })

    const response = await cascadeHandler(
      request,
      mockEnv,
      mockCtx,
      { functionId: 'no-schema-function' }
    )

    // Should NOT be 400 - validation is skipped when no inputSchema
    expect(response.status).not.toBe(400)
  })

  it('returns 400 for enum validation failure', async () => {
    await registerFunction('enum-function', {
      type: 'object',
      properties: {
        priority: { enum: ['low', 'medium', 'high'] },
      },
    })

    const request = new Request('https://functions.do/cascade/enum-function', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { priority: 'critical' } }),
    })

    const response = await cascadeHandler(
      request,
      mockEnv,
      mockCtx,
      { functionId: 'enum-function' }
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as JsonBody
    expect(body.error).toBe('Input validation failed')
    const errors = body.validationErrors as string[]
    expect(errors[0]).toContain("field 'priority' must be one of")
  })

  it('validates nested object schemas in input', async () => {
    await registerFunction('nested-function', {
      type: 'object',
      required: ['config'],
      properties: {
        config: {
          type: 'object',
          required: ['timeout'],
          properties: {
            timeout: { type: 'number' },
          },
        },
      },
    })

    const request = new Request('https://functions.do/cascade/nested-function', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { config: {} } }),
    })

    const response = await cascadeHandler(
      request,
      mockEnv,
      mockCtx,
      { functionId: 'nested-function' }
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as JsonBody
    const errors = body.validationErrors as string[]
    expect(errors[0]).toContain('config')
    expect(errors[0]).toContain("missing required field 'timeout'")
  })
})
