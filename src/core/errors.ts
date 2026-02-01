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

// ============================================================================
// ERROR CONVERSION UTILITIES
// ============================================================================
//
// Standard Error Handling Pattern for Functions.do
// -------------------------------------------------
// This codebase uses the Result<T, E> pattern for fallible operations:
//
// 1. PREFER Result<T, E> for functions that can fail expectedly
//    - Validation functions should return Result<T, ValidationError>
//    - Lookup operations should return Result<T, NotFoundError>
//    - Operations with recoverable failures should use Result
//
// 2. THROW only for unexpected/programming errors
//    - Invalid arguments that shouldn't occur in correct code
//    - Internal invariant violations
//
// 3. RESPONSE conversion is for HTTP boundary only
//    - Use resultToResponse() at API endpoints
//    - Internal code should pass Result objects
//
// Example usage:
//   const result = validateFunctionIdSafe(id)
//   if (isErr(result)) {
//     return resultToResponse(result)
//   }
//   // result.data is now guaranteed to be valid
// ============================================================================

/**
 * Convert a FunctionsDoError to an appropriate HTTP status code.
 *
 * @param error - The error to convert
 * @returns HTTP status code
 */
export function errorToStatusCode(error: FunctionsDoError): number {
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return 400
    case 'AUTHENTICATION_ERROR':
      return 401
    case 'NOT_FOUND':
      return 404
    case 'RATE_LIMIT_ERROR':
      return 429
    case 'INVOCATION_ERROR':
      return 500
    default:
      return 500
  }
}

/**
 * Convert a FunctionsDoError to a JSON-serializable error response body.
 *
 * @param error - The error to convert
 * @returns Error response body
 */
export function errorToBody(error: FunctionsDoError): {
  error: string
  code: string
  message: string
  context?: Record<string, unknown>
} {
  const body: {
    error: string
    code: string
    message: string
    context?: Record<string, unknown>
  } = {
    error: error.name,
    code: error.code,
    message: error.message,
  }
  if (error.context) {
    body.context = error.context
  }
  return body
}

/**
 * Convert a FunctionsDoError to an HTTP Response object.
 * Use this at API boundaries to return errors to clients.
 *
 * @param error - The error to convert
 * @returns HTTP Response with appropriate status and body
 *
 * @example
 * ```typescript
 * const result = validateFunctionIdSafe(id)
 * if (isErr(result)) {
 *   return errorToResponse(result.error)
 * }
 * ```
 */
export function errorToResponse(error: FunctionsDoError): Response {
  const status = errorToStatusCode(error)
  const body = errorToBody(error)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  // Add Retry-After header for rate limit errors
  if (error instanceof RateLimitError && error.retryAfterMs) {
    headers['Retry-After'] = String(Math.ceil(error.retryAfterMs / 1000))
  }

  return new Response(JSON.stringify(body), { status, headers })
}

/**
 * Convert a failed Result to an HTTP Response object.
 * Use this at API boundaries to return errors to clients.
 *
 * @param result - A failed Result (must have success: false)
 * @returns HTTP Response with appropriate status and body
 *
 * @example
 * ```typescript
 * const result = validateFunctionIdSafe(id)
 * if (isErr(result)) {
 *   return resultToResponse(result)
 * }
 * ```
 */
export function resultToResponse<E extends FunctionsDoError>(
  result: { success: false; error: E }
): Response {
  return errorToResponse(result.error)
}

/**
 * Wrap a throwing function to return a Result instead.
 * Useful for converting legacy throwing functions to Result-returning ones.
 *
 * @param fn - A function that may throw
 * @returns A function that returns Result<T, FunctionsDoError>
 *
 * @example
 * ```typescript
 * const safeParse = tryCatch((input: string) => JSON.parse(input))
 * const result = safeParse('invalid json')
 * if (isErr(result)) {
 *   console.log('Parse failed:', result.error.message)
 * }
 * ```
 */
export function tryCatch<T, Args extends unknown[]>(
  fn: (...args: Args) => T
): (...args: Args) => Result<T, FunctionsDoError> {
  return (...args: Args): Result<T, FunctionsDoError> => {
    try {
      return ok(fn(...args))
    } catch (error) {
      if (error instanceof FunctionsDoError) {
        return err(error)
      }
      return err(
        new FunctionsDoError(
          error instanceof Error ? error.message : String(error),
          'UNKNOWN_ERROR',
          { originalError: error instanceof Error ? error.name : typeof error }
        )
      )
    }
  }
}

/**
 * Wrap an async throwing function to return a Result instead.
 *
 * @param fn - An async function that may throw
 * @returns An async function that returns Promise<Result<T, FunctionsDoError>>
 *
 * @example
 * ```typescript
 * const safeFetch = tryCatchAsync(async (url: string) => {
 *   const res = await fetch(url)
 *   return res.json()
 * })
 * const result = await safeFetch('https://api.example.com/data')
 * ```
 */
export function tryCatchAsync<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>
): (...args: Args) => Promise<Result<T, FunctionsDoError>> {
  return async (...args: Args): Promise<Result<T, FunctionsDoError>> => {
    try {
      return ok(await fn(...args))
    } catch (error) {
      if (error instanceof FunctionsDoError) {
        return err(error)
      }
      return err(
        new FunctionsDoError(
          error instanceof Error ? error.message : String(error),
          'UNKNOWN_ERROR',
          { originalError: error instanceof Error ? error.name : typeof error }
        )
      )
    }
  }
}

/**
 * Chain Result-returning operations.
 * If the first Result is successful, apply the function to its data.
 * If the first Result is an error, propagate the error.
 *
 * @param result - The initial Result
 * @param fn - Function to apply if result is successful
 * @returns New Result from applying fn, or original error
 *
 * @example
 * ```typescript
 * const validated = validateFunctionIdSafe(id)
 * const fetched = andThen(validated, (id) => fetchFunctionSafe(id))
 * ```
 */
export function andThen<T, U, E extends FunctionsDoError>(
  result: Result<T, E>,
  fn: (data: T) => Result<U, E>
): Result<U, E> {
  if (isOk(result)) {
    return fn(result.data)
  }
  return result
}

/**
 * Async version of andThen for chaining async Result operations.
 *
 * @param result - The initial Result (or Promise of Result)
 * @param fn - Async function to apply if result is successful
 * @returns Promise of new Result
 *
 * @example
 * ```typescript
 * const result = await andThenAsync(
 *   validateFunctionIdSafe(id),
 *   async (id) => fetchFunctionSafe(id)
 * )
 * ```
 */
export async function andThenAsync<T, U, E extends FunctionsDoError>(
  result: Result<T, E> | Promise<Result<T, E>>,
  fn: (data: T) => Promise<Result<U, E>>
): Promise<Result<U, E>> {
  const awaited = await result
  if (isOk(awaited)) {
    return fn(awaited.data)
  }
  return awaited
}

/**
 * Map over a successful Result value.
 * Unlike andThen, the mapping function returns a plain value, not a Result.
 *
 * @param result - The Result to map over
 * @param fn - Function to apply to successful value
 * @returns New Result with mapped value, or original error
 *
 * @example
 * ```typescript
 * const result = validateFunctionIdSafe(id)
 * const upper = mapResult(result, (id) => id.toUpperCase())
 * ```
 */
export function mapResult<T, U, E>(
  result: Result<T, E>,
  fn: (data: T) => U
): Result<U, E> {
  if (isOk(result)) {
    return ok(fn(result.data))
  }
  return result
}

/**
 * Unwrap a Result, returning the data or throwing the error.
 * Use this when you want to convert Result-based code back to throwing.
 *
 * @param result - The Result to unwrap
 * @returns The successful data
 * @throws The error if Result is failed
 *
 * @example
 * ```typescript
 * // Convert back to throwing style when needed
 * const id = unwrap(validateFunctionIdSafe(rawId))
 * ```
 */
export function unwrap<T, E extends Error>(result: Result<T, E>): T {
  if (isOk(result)) {
    return result.data
  }
  throw result.error
}

/**
 * Unwrap a Result with a default value for the error case.
 *
 * @param result - The Result to unwrap
 * @param defaultValue - Value to return if Result is failed
 * @returns The successful data or default value
 *
 * @example
 * ```typescript
 * const name = unwrapOr(getNameResult, 'Anonymous')
 * ```
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (isOk(result)) {
    return result.data
  }
  return defaultValue
}
