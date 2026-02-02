import { describe, it, expect } from 'vitest'
import {
  validateFunctionMetadata,
  validateDeployBody,
  validateInvokeBody,
  assertObject,
  assertString,
  assertOptionalString,
  assertOptionalStringArray,
  safeJsonParse,
} from '../validation'
import { ValidationError } from '../errors'
import type { FunctionMetadata } from '../types'

// =============================================================================
// assertObject
// =============================================================================

describe('assertObject', () => {
  it('returns the value when given a plain object', () => {
    const obj = { a: 1, b: 'two' }
    expect(assertObject(obj, 'test')).toBe(obj)
  })

  it('throws ValidationError for null', () => {
    expect(() => assertObject(null, 'test')).toThrow(ValidationError)
    expect(() => assertObject(null, 'test')).toThrow(/got null/)
  })

  it('throws ValidationError for undefined', () => {
    expect(() => assertObject(undefined, 'test')).toThrow(ValidationError)
    expect(() => assertObject(undefined, 'test')).toThrow(/got undefined/)
  })

  it('throws ValidationError for arrays', () => {
    expect(() => assertObject([], 'test')).toThrow(ValidationError)
    expect(() => assertObject([], 'test')).toThrow(/got array/)
  })

  it('throws ValidationError for strings', () => {
    expect(() => assertObject('hello', 'test')).toThrow(ValidationError)
    expect(() => assertObject('hello', 'test')).toThrow(/got string/)
  })

  it('throws ValidationError for numbers', () => {
    expect(() => assertObject(42, 'test')).toThrow(ValidationError)
    expect(() => assertObject(42, 'test')).toThrow(/got number/)
  })

  it('throws ValidationError for booleans', () => {
    expect(() => assertObject(true, 'test')).toThrow(ValidationError)
    expect(() => assertObject(true, 'test')).toThrow(/got boolean/)
  })

  it('includes context in error message', () => {
    expect(() => assertObject(null, 'KV read for my-func')).toThrow(/KV read for my-func/)
  })
})

// =============================================================================
// assertString
// =============================================================================

describe('assertString', () => {
  it('returns the string value when field is a string', () => {
    expect(assertString({ name: 'hello' }, 'name', 'test')).toBe('hello')
  })

  it('throws for missing field', () => {
    expect(() => assertString({}, 'name', 'test')).toThrow(ValidationError)
    expect(() => assertString({}, 'name', 'test')).toThrow(/got undefined/)
  })

  it('throws for null field', () => {
    expect(() => assertString({ name: null }, 'name', 'test')).toThrow(ValidationError)
    expect(() => assertString({ name: null }, 'name', 'test')).toThrow(/got null/)
  })

  it('throws for number field', () => {
    expect(() => assertString({ name: 123 }, 'name', 'test')).toThrow(ValidationError)
    expect(() => assertString({ name: 123 }, 'name', 'test')).toThrow(/got number/)
  })

  it('includes field name and context in error', () => {
    expect(() => assertString({ id: 42 }, 'id', 'deploy body')).toThrow(/id/)
    expect(() => assertString({ id: 42 }, 'id', 'deploy body')).toThrow(/deploy body/)
  })
})

// =============================================================================
// assertOptionalString
// =============================================================================

describe('assertOptionalString', () => {
  it('returns string when present', () => {
    expect(assertOptionalString({ name: 'hi' }, 'name', 'test')).toBe('hi')
  })

  it('returns undefined when field is absent', () => {
    expect(assertOptionalString({}, 'name', 'test')).toBeUndefined()
  })

  it('returns undefined when field is undefined', () => {
    expect(assertOptionalString({ name: undefined }, 'name', 'test')).toBeUndefined()
  })

  it('throws for null field', () => {
    expect(() => assertOptionalString({ name: null }, 'name', 'test')).toThrow(ValidationError)
  })

  it('throws for number field', () => {
    expect(() => assertOptionalString({ name: 42 }, 'name', 'test')).toThrow(ValidationError)
  })
})

// =============================================================================
// assertOptionalStringArray
// =============================================================================

describe('assertOptionalStringArray', () => {
  it('returns string array when present', () => {
    expect(assertOptionalStringArray({ tags: ['a', 'b'] }, 'tags', 'test')).toEqual(['a', 'b'])
  })

  it('returns undefined when field is absent', () => {
    expect(assertOptionalStringArray({}, 'tags', 'test')).toBeUndefined()
  })

  it('throws for non-array value', () => {
    expect(() => assertOptionalStringArray({ tags: 'not-array' }, 'tags', 'test')).toThrow(ValidationError)
  })

  it('throws when array contains non-string elements', () => {
    expect(() => assertOptionalStringArray({ tags: ['a', 42] }, 'tags', 'test')).toThrow(ValidationError)
    expect(() => assertOptionalStringArray({ tags: ['a', 42] }, 'tags', 'test')).toThrow(/tags\[1\]/)
  })

  it('allows empty array', () => {
    expect(assertOptionalStringArray({ tags: [] }, 'tags', 'test')).toEqual([])
  })
})

// =============================================================================
// validateFunctionMetadata
// =============================================================================

describe('validateFunctionMetadata', () => {
  const validMetadata: FunctionMetadata = {
    id: 'my-function',
    version: '1.0.0',
    type: 'code',
  }

  it('passes for minimal valid metadata (id + version)', () => {
    const result = validateFunctionMetadata({ id: 'my-fn', version: '1.0.0' })
    expect(result.id).toBe('my-fn')
    expect(result.version).toBe('1.0.0')
  })

  it('passes for full metadata with all optional fields', () => {
    // Use 'cascade' type which supports both generative and code fields
    const full: FunctionMetadata = {
      id: 'test-fn',
      version: '2.1.0',
      type: 'cascade',
      name: 'Test Function',
      description: 'A test function',
      tags: ['ai', 'test'],
      model: 'claude-3-sonnet',
      systemPrompt: 'You are a helpful assistant',
      userPrompt: 'Summarize: {{text}}',
      language: 'typescript',
      entryPoint: 'index.ts',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      ownerId: 'user-123',
      orgId: 'org-456',
    }
    const result = validateFunctionMetadata(full)
    expect(result).toEqual(full)
  })

  it('allows extra fields for forward compatibility', () => {
    const data = {
      id: 'my-fn',
      version: '1.0.0',
      futureField: 'some-value',
      anotherNewField: 42,
    }
    const result = validateFunctionMetadata(data)
    expect(result.id).toBe('my-fn')
    expect((result as Record<string, unknown>)['futureField']).toBe('some-value')
  })

  it('throws ValidationError when id is missing', () => {
    expect(() => validateFunctionMetadata({ version: '1.0.0' })).toThrow(ValidationError)
    expect(() => validateFunctionMetadata({ version: '1.0.0' })).toThrow(/id/)
  })

  it('throws ValidationError when version is missing', () => {
    expect(() => validateFunctionMetadata({ id: 'my-fn' })).toThrow(ValidationError)
    expect(() => validateFunctionMetadata({ id: 'my-fn' })).toThrow(/version/)
  })

  it('throws ValidationError when id is not a string', () => {
    expect(() => validateFunctionMetadata({ id: 123, version: '1.0.0' })).toThrow(ValidationError)
  })

  it('throws ValidationError when version is not a string', () => {
    expect(() => validateFunctionMetadata({ id: 'my-fn', version: 100 })).toThrow(ValidationError)
  })

  it('throws ValidationError for null input', () => {
    expect(() => validateFunctionMetadata(null)).toThrow(ValidationError)
    expect(() => validateFunctionMetadata(null)).toThrow(/got null/)
  })

  it('throws ValidationError for undefined input', () => {
    expect(() => validateFunctionMetadata(undefined)).toThrow(ValidationError)
    expect(() => validateFunctionMetadata(undefined)).toThrow(/got undefined/)
  })

  it('throws ValidationError for array input', () => {
    expect(() => validateFunctionMetadata([])).toThrow(ValidationError)
    expect(() => validateFunctionMetadata([])).toThrow(/got array/)
  })

  it('throws ValidationError for string input', () => {
    expect(() => validateFunctionMetadata('not an object')).toThrow(ValidationError)
  })

  it('throws ValidationError for number input', () => {
    expect(() => validateFunctionMetadata(42)).toThrow(ValidationError)
  })

  it('throws ValidationError for invalid function type', () => {
    expect(() => validateFunctionMetadata({ id: 'fn', version: '1.0.0', type: 'invalid' })).toThrow(ValidationError)
    expect(() => validateFunctionMetadata({ id: 'fn', version: '1.0.0', type: 'invalid' })).toThrow(/invalid/)
  })

  it('accepts all valid function types', () => {
    for (const type of ['code', 'generative', 'agentic', 'human', 'cascade']) {
      const result = validateFunctionMetadata({ id: 'fn', version: '1.0.0', type })
      expect(result.type).toBe(type)
    }
  })

  it('throws when optional string field has wrong type', () => {
    expect(() => validateFunctionMetadata({ id: 'fn', version: '1.0.0', name: 123 })).toThrow(ValidationError)
    expect(() => validateFunctionMetadata({ id: 'fn', version: '1.0.0', description: true })).toThrow(ValidationError)
    expect(() => validateFunctionMetadata({ id: 'fn', version: '1.0.0', language: [] })).toThrow(ValidationError)
  })

  it('throws when tags is not a string array', () => {
    expect(() => validateFunctionMetadata({ id: 'fn', version: '1.0.0', tags: 'not-array' })).toThrow(ValidationError)
    expect(() => validateFunctionMetadata({ id: 'fn', version: '1.0.0', tags: [1, 2] })).toThrow(ValidationError)
  })
})

// =============================================================================
// validateDeployBody
// =============================================================================

describe('validateDeployBody', () => {
  it('passes for minimal deploy body', () => {
    const body = { id: 'my-fn', version: '1.0.0' }
    const result = validateDeployBody(body)
    expect(result['id']).toBe('my-fn')
    expect(result['version']).toBe('1.0.0')
  })

  it('passes for deploy body with type', () => {
    const body = { id: 'my-fn', version: '1.0.0', type: 'generative', userPrompt: 'Hello' }
    const result = validateDeployBody(body)
    expect(result['type']).toBe('generative')
  })

  it('throws for missing id', () => {
    expect(() => validateDeployBody({ version: '1.0.0' })).toThrow(ValidationError)
  })

  it('throws for missing version', () => {
    expect(() => validateDeployBody({ id: 'my-fn' })).toThrow(ValidationError)
  })

  it('throws for invalid type', () => {
    expect(() => validateDeployBody({ id: 'fn', version: '1.0.0', type: 'bogus' })).toThrow(ValidationError)
  })

  it('throws for null input', () => {
    expect(() => validateDeployBody(null)).toThrow(ValidationError)
  })

  it('throws for array input', () => {
    expect(() => validateDeployBody([1, 2, 3])).toThrow(ValidationError)
  })

  it('throws for string input', () => {
    expect(() => validateDeployBody('not an object')).toThrow(ValidationError)
  })
})

// =============================================================================
// validateInvokeBody
// =============================================================================

describe('validateInvokeBody', () => {
  it('passes for object body', () => {
    const data = { name: 'World' }
    expect(validateInvokeBody(data)).toEqual(data)
  })

  it('passes for null body (valid JSON value)', () => {
    expect(validateInvokeBody(null)).toBeNull()
  })

  it('passes for array body', () => {
    expect(validateInvokeBody([1, 2, 3])).toEqual([1, 2, 3])
  })

  it('passes for string body', () => {
    expect(validateInvokeBody('hello')).toBe('hello')
  })

  it('passes for number body', () => {
    expect(validateInvokeBody(42)).toBe(42)
  })

  it('passes for boolean body', () => {
    expect(validateInvokeBody(false)).toBe(false)
  })

  it('throws for undefined (unparsed body)', () => {
    expect(() => validateInvokeBody(undefined)).toThrow(ValidationError)
    expect(() => validateInvokeBody(undefined)).toThrow(/undefined/)
  })
})

// =============================================================================
// safeJsonParse
// =============================================================================

describe('safeJsonParse', () => {
  it('parses valid JSON and validates with the provided validator', () => {
    const json = JSON.stringify({ id: 'fn-1', version: '1.0.0' })
    const result = safeJsonParse(json, validateFunctionMetadata, 'test')
    expect(result.id).toBe('fn-1')
    expect(result.version).toBe('1.0.0')
  })

  it('throws ValidationError for invalid JSON syntax', () => {
    expect(() => safeJsonParse('not json {', validateFunctionMetadata, 'KV read')).toThrow(ValidationError)
    expect(() => safeJsonParse('not json {', validateFunctionMetadata, 'KV read')).toThrow(/Invalid JSON/)
    expect(() => safeJsonParse('not json {', validateFunctionMetadata, 'KV read')).toThrow(/KV read/)
  })

  it('throws ValidationError when JSON parses but validation fails', () => {
    const json = JSON.stringify({ version: '1.0.0' }) // missing id
    expect(() => safeJsonParse(json, validateFunctionMetadata, 'registry')).toThrow(ValidationError)
  })

  it('works with a custom validator', () => {
    const validator = (data: unknown) => {
      const obj = assertObject(data, 'custom')
      assertString(obj, 'key', 'custom')
      return obj as { key: string }
    }
    const json = JSON.stringify({ key: 'value' })
    expect(safeJsonParse(json, validator, 'test')).toEqual({ key: 'value' })
  })

  it('throws for empty string', () => {
    expect(() => safeJsonParse('', validateFunctionMetadata, 'test')).toThrow(ValidationError)
  })
})

// =============================================================================
// Integration: simulating real-world JSON.parse scenarios
// =============================================================================

describe('real-world JSON.parse validation scenarios', () => {
  it('validates metadata read from KV storage', () => {
    // Simulate: const result = await kv.get(key, 'text'); JSON.parse(result)
    const kvValue = JSON.stringify({
      id: 'user-greeting',
      version: '1.2.0',
      type: 'code',
      language: 'typescript',
      entryPoint: 'index.ts',
      dependencies: {},
    })
    const metadata = safeJsonParse(kvValue, validateFunctionMetadata, 'KV registry read')
    expect(metadata.id).toBe('user-greeting')
    expect(metadata.type).toBe('code')
  })

  it('rejects corrupted KV data (missing required fields)', () => {
    // Simulate corrupted or partial write
    const corruptedJson = JSON.stringify({ id: 'fn', language: 'typescript' }) // missing version
    expect(() => safeJsonParse(corruptedJson, validateFunctionMetadata, 'KV read')).toThrow(ValidationError)
  })

  it('rejects non-object KV data', () => {
    // Simulate: someone accidentally stored a string instead of JSON object
    const badData = JSON.stringify('just a string')
    expect(() => safeJsonParse(badData, validateFunctionMetadata, 'KV read')).toThrow(ValidationError)
  })

  it('validates deploy request with all code fields', () => {
    const requestBody = {
      id: 'my-worker',
      version: '1.0.0',
      type: 'code',
      language: 'typescript',
      code: 'export default { fetch() { return new Response("hi") } }',
      entryPoint: 'index.ts',
    }
    const validated = validateDeployBody(requestBody)
    expect(validated['id']).toBe('my-worker')
    expect(validated['language']).toBe('typescript')
  })

  it('validates deploy request for generative function', () => {
    const requestBody = {
      id: 'summarize',
      version: '1.0.0',
      type: 'generative',
      model: 'claude-3-sonnet',
      userPrompt: 'Summarize: {{text}}',
    }
    const validated = validateDeployBody(requestBody)
    expect(validated['type']).toBe('generative')
  })

  it('handles metadata from SQLite (UserStorage DO)', () => {
    // Simulate: JSON.parse(result.metadata_json) from user-storage.ts
    const sqliteRow = {
      metadata_json: JSON.stringify({
        id: 'stored-fn',
        version: '3.0.0',
        type: 'agentic',
        goal: 'Research a topic',
        systemPrompt: 'You are a researcher',
      }),
    }
    const metadata = safeJsonParse(sqliteRow.metadata_json, validateFunctionMetadata, 'SQLite read')
    expect(metadata.id).toBe('stored-fn')
    expect(metadata.type).toBe('agentic')
  })
})

// =============================================================================
// Error class verification
// =============================================================================

describe('ValidationError integration', () => {
  it('thrown errors are instances of ValidationError', () => {
    try {
      validateFunctionMetadata(null)
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).code).toBe('VALIDATION_ERROR')
      expect((error as ValidationError).name).toBe('ValidationError')
    }
  })

  it('thrown errors have context information', () => {
    try {
      assertString({ x: 42 }, 'x', 'my-context')
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).context).toEqual({ context: 'my-context', field: 'x' })
    }
  })
})

// =============================================================================
// Importability check
// =============================================================================

describe('module exports', () => {
  it('all validation functions are importable', () => {
    expect(typeof validateFunctionMetadata).toBe('function')
    expect(typeof validateDeployBody).toBe('function')
    expect(typeof validateInvokeBody).toBe('function')
    expect(typeof assertObject).toBe('function')
    expect(typeof assertString).toBe('function')
    expect(typeof assertOptionalString).toBe('function')
    expect(typeof assertOptionalStringArray).toBe('function')
    expect(typeof safeJsonParse).toBe('function')
  })
})
