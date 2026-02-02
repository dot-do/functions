/**
 * Runtime Validation for JSON.parse Results at System Boundaries
 *
 * Throughout the codebase, JSON.parse results are cast with `as` without
 * runtime validation. This module provides lightweight validators that
 * check parsed data matches expected shapes before the code proceeds.
 *
 * Usage at system boundaries:
 * - Incoming API request bodies (deploy, invoke)
 * - KV/DO storage reads (function metadata, API keys)
 * - External API responses
 *
 * Design principles:
 * - No external dependencies (no Zod, io-ts, etc.)
 * - Check required fields exist and have correct types
 * - Extra fields are allowed (forward compatibility)
 * - Return validated & typed data or throw ValidationError
 *
 * @module core/validation
 */

import { ValidationError } from './errors'
import type { FunctionMetadata } from './types'

// =============================================================================
// GENERIC HELPERS
// =============================================================================

/**
 * Assert that a value is a non-null, non-array object.
 *
 * @param data - The unknown value to check
 * @param context - Description of where this validation is occurring (for error messages)
 * @returns The value cast as Record<string, unknown>
 * @throws ValidationError if the value is not an object
 */
export function assertObject(data: unknown, context: string): Record<string, unknown> {
  if (data === null || data === undefined) {
    throw new ValidationError(`Expected object at ${context}, got ${data === null ? 'null' : 'undefined'}`, { context })
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new ValidationError(`Expected object at ${context}, got ${Array.isArray(data) ? 'array' : typeof data}`, { context })
  }
  return data as Record<string, unknown>
}

/**
 * Assert that a field on an object is a string.
 *
 * @param obj - The object containing the field
 * @param field - The field name to check
 * @param context - Description of where this validation is occurring
 * @returns The string value
 * @throws ValidationError if the field is missing or not a string
 */
export function assertString(obj: Record<string, unknown>, field: string, context: string): string {
  const value = obj[field]
  if (typeof value !== 'string') {
    throw new ValidationError(
      `Expected string for '${field}' at ${context}, got ${value === undefined ? 'undefined' : value === null ? 'null' : typeof value}`,
      { context, field }
    )
  }
  return value
}

/**
 * Assert that a field on an object is a string, if present.
 * Returns undefined if the field is absent or undefined.
 *
 * @param obj - The object containing the field
 * @param field - The field name to check
 * @param context - Description of where this validation is occurring
 * @returns The string value or undefined
 * @throws ValidationError if the field is present but not a string
 */
export function assertOptionalString(obj: Record<string, unknown>, field: string, context: string): string | undefined {
  const value = obj[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new ValidationError(
      `Expected string for '${field}' at ${context}, got ${value === null ? 'null' : typeof value}`,
      { context, field }
    )
  }
  return value
}

/**
 * Assert that a field on an object is an array of strings, if present.
 *
 * @param obj - The object containing the field
 * @param field - The field name to check
 * @param context - Description of where this validation is occurring
 * @returns The string array or undefined
 * @throws ValidationError if the field is present but not a string array
 */
export function assertOptionalStringArray(obj: Record<string, unknown>, field: string, context: string): string[] | undefined {
  const value = obj[field]
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new ValidationError(
      `Expected string array for '${field}' at ${context}, got ${typeof value}`,
      { context, field }
    )
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string') {
      throw new ValidationError(
        `Expected string at '${field}[${i}]' at ${context}, got ${typeof value[i]}`,
        { context, field }
      )
    }
  }
  return value as string[]
}

// =============================================================================
// FUNCTION METADATA VALIDATION
// =============================================================================

/**
 * Valid function type values for the `type` field on FunctionMetadata.
 */
const VALID_FUNCTION_TYPES = ['code', 'generative', 'agentic', 'human', 'cascade'] as const

/**
 * Validate that a parsed value matches the FunctionMetadata shape.
 *
 * Checks required fields (id, version) and validates optional fields
 * have correct types when present. Extra fields are allowed for
 * forward compatibility.
 *
 * @param data - The unknown value (typically from JSON.parse or KV.get)
 * @returns The validated FunctionMetadata
 * @throws ValidationError if the data doesn't match the expected shape
 */
export function validateFunctionMetadata(data: unknown): FunctionMetadata {
  const obj = assertObject(data, 'FunctionMetadata')

  // Required fields
  const id = assertString(obj, 'id', 'FunctionMetadata')
  const version = assertString(obj, 'version', 'FunctionMetadata')

  // Optional typed fields
  const type = assertOptionalString(obj, 'type', 'FunctionMetadata')
  if (type !== undefined && !VALID_FUNCTION_TYPES.includes(type as typeof VALID_FUNCTION_TYPES[number])) {
    throw new ValidationError(
      `Invalid function type '${type}' at FunctionMetadata, expected one of: ${VALID_FUNCTION_TYPES.join(', ')}`,
      { field: 'type', value: type }
    )
  }

  // Validate other optional string fields
  assertOptionalString(obj, 'name', 'FunctionMetadata')
  assertOptionalString(obj, 'description', 'FunctionMetadata')
  assertOptionalString(obj, 'language', 'FunctionMetadata')
  assertOptionalString(obj, 'entryPoint', 'FunctionMetadata')
  assertOptionalString(obj, 'model', 'FunctionMetadata')
  assertOptionalString(obj, 'systemPrompt', 'FunctionMetadata')
  assertOptionalString(obj, 'userPrompt', 'FunctionMetadata')
  assertOptionalString(obj, 'goal', 'FunctionMetadata')
  assertOptionalString(obj, 'createdAt', 'FunctionMetadata')
  assertOptionalString(obj, 'updatedAt', 'FunctionMetadata')
  assertOptionalString(obj, 'ownerId', 'FunctionMetadata')
  assertOptionalString(obj, 'orgId', 'FunctionMetadata')

  // Validate optional string array fields
  assertOptionalStringArray(obj, 'tags', 'FunctionMetadata')

  // Return the data cast to FunctionMetadata (extra fields preserved)
  return data as FunctionMetadata
}

// =============================================================================
// DEPLOY REQUEST BODY VALIDATION
// =============================================================================

/**
 * Validate a deploy request body.
 *
 * Checks that the parsed JSON body contains the required fields for
 * a deploy request. Delegates to type-specific validation based on
 * the `type` field.
 *
 * @param data - The unknown value from JSON.parse of the request body
 * @returns The validated deploy request body as Record<string, unknown>
 * @throws ValidationError if the data doesn't match the expected shape
 */
export function validateDeployBody(data: unknown): Record<string, unknown> {
  const obj = assertObject(data, 'deploy request body')

  // Required fields for all deploy requests
  assertString(obj, 'id', 'deploy request body')
  assertString(obj, 'version', 'deploy request body')

  // Type is optional (defaults to 'code')
  const type = assertOptionalString(obj, 'type', 'deploy request body')
  if (type !== undefined && !VALID_FUNCTION_TYPES.includes(type as typeof VALID_FUNCTION_TYPES[number])) {
    throw new ValidationError(
      `Invalid function type '${type}' in deploy request, expected one of: ${VALID_FUNCTION_TYPES.join(', ')}`,
      { field: 'type', value: type }
    )
  }

  return obj
}

// =============================================================================
// INVOKE REQUEST BODY VALIDATION
// =============================================================================

/**
 * Validate an invoke request body.
 *
 * The invoke body is flexible - it can be any JSON object or value.
 * This validates it is at least a valid parsed JSON value (not undefined).
 *
 * @param data - The unknown value from JSON.parse of the request body
 * @param context - Optional context string for error messages
 * @returns The validated data
 * @throws ValidationError if the data is undefined (JSON.parse failure not caught)
 */
export function validateInvokeBody(data: unknown, context = 'invoke request body'): unknown {
  // Invoke bodies can be any JSON type (object, array, string, number, boolean, null).
  // But undefined means parsing failed silently or wasn't attempted.
  if (data === undefined) {
    throw new ValidationError(`Expected parsed JSON at ${context}, got undefined`, { context })
  }
  return data
}

// =============================================================================
// SAFE PARSE WRAPPER
// =============================================================================

/**
 * Parse JSON and validate the result with a validator function.
 *
 * Wraps JSON.parse with a validator to ensure the parsed data matches
 * the expected shape. Catches both JSON syntax errors and validation
 * errors, providing clear error messages.
 *
 * @param json - The JSON string to parse
 * @param validator - Validation function to apply to the parsed result
 * @param context - Description of where this parsing is occurring
 * @returns The validated result
 * @throws ValidationError if parsing fails or validation fails
 *
 * @example
 * ```typescript
 * const metadata = safeJsonParse(kvValue, validateFunctionMetadata, 'KV read')
 * ```
 */
export function safeJsonParse<T>(
  json: string,
  validator: (data: unknown) => T,
  context: string
): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new ValidationError(
      `Invalid JSON at ${context}: ${error instanceof Error ? error.message : String(error)}`,
      { context }
    )
  }
  return validator(parsed)
}
