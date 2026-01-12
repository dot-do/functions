/**
 * Unified Error Types for Functions.do
 *
 * Provides consistent error handling across all modules.
 */

/**
 * Base error class for all Functions.do errors.
 * Provides a consistent interface with error codes and contextual information.
 */
export class FunctionsDoError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'FunctionsDoError'
  }
}

/**
 * Error thrown when input validation fails.
 * Use for invalid function IDs, malformed metadata, invalid parameters, etc.
 */
export class ValidationError extends FunctionsDoError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', context)
    this.name = 'ValidationError'
  }
}

/**
 * Error thrown when a requested resource cannot be found.
 * Use for missing functions, versions, or other resources.
 */
export class NotFoundError extends FunctionsDoError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', { resource, id })
    this.name = 'NotFoundError'
  }
}

/**
 * Error thrown when authentication fails.
 * Use for missing or invalid API keys.
 */
export class AuthenticationError extends FunctionsDoError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'AUTHENTICATION_ERROR', context)
    this.name = 'AuthenticationError'
  }
}

/**
 * Error thrown when rate limits are exceeded.
 */
export class RateLimitError extends FunctionsDoError {
  constructor(
    message: string,
    public retryAfterMs?: number,
    context?: Record<string, unknown>
  ) {
    super(message, 'RATE_LIMIT_ERROR', { ...context, retryAfterMs })
    this.name = 'RateLimitError'
  }
}

/**
 * Error thrown when function invocation fails.
 */
export class InvocationError extends FunctionsDoError {
  constructor(
    message: string,
    public functionId: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'INVOCATION_ERROR', { ...context, functionId })
    this.name = 'InvocationError'
  }
}

/**
 * Result type for operations that can fail.
 * Use this for functions that should not throw but instead return a result.
 *
 * @example
 * ```typescript
 * function parseConfig(input: string): Result<Config> {
 *   try {
 *     const config = JSON.parse(input)
 *     return { success: true, data: config }
 *   } catch (error) {
 *     return { success: false, error: new ValidationError('Invalid config JSON') }
 *   }
 * }
 * ```
 */
export type Result<T, E = FunctionsDoError> =
  | { success: true; data: T }
  | { success: false; error: E }

/**
 * Helper function to create a successful result.
 */
export function ok<T>(data: T): Result<T, never> {
  return { success: true, data }
}

/**
 * Helper function to create a failed result.
 */
export function err<E extends FunctionsDoError>(error: E): Result<never, E> {
  return { success: false, error }
}

/**
 * Type guard to check if a result is successful.
 */
export function isOk<T, E>(result: Result<T, E>): result is { success: true; data: T } {
  return result.success
}

/**
 * Type guard to check if a result is an error.
 */
export function isErr<T, E>(result: Result<T, E>): result is { success: false; error: E } {
  return !result.success
}
