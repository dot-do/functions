/**
 * HTTP Utils for Functions.do
 *
 * Shared utility functions for HTTP response handling.
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Standard error codes used across the API.
 *
 * These codes help clients programmatically handle different error types.
 */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'      // Request validation failed (400)
  | 'INVALID_JSON'          // Invalid JSON in request body (400)
  | 'MISSING_REQUIRED'      // Missing required field (400)
  | 'INVALID_FUNCTION_ID'   // Invalid function ID format (400)
  | 'INVALID_VERSION'       // Invalid semantic version (400)
  | 'INVALID_LANGUAGE'      // Invalid/unsupported language (400)
  | 'INVALID_PARAMETER'     // Invalid query/path parameter (400)
  | 'UNAUTHORIZED'          // Missing or invalid authentication (401)
  | 'FORBIDDEN'             // Insufficient permissions (403)
  | 'NOT_FOUND'             // Resource not found (404)
  | 'FUNCTION_NOT_FOUND'    // Function not found (404)
  | 'METHOD_NOT_ALLOWED'    // HTTP method not allowed (405)
  | 'CONFLICT'              // Resource conflict (409)
  | 'PAYLOAD_TOO_LARGE'     // Request body too large (413)
  | 'COMPILATION_ERROR'     // Code compilation failed (400)
  | 'EXECUTION_ERROR'       // Function execution failed (500)
  | 'TIMEOUT'               // Operation timed out (408/504)
  | 'SERVICE_UNAVAILABLE'   // Service temporarily unavailable (503)
  | 'NOT_IMPLEMENTED'       // Feature not implemented (501)
  | 'INTERNAL_ERROR'        // Internal server error (500)
  | 'CASCADE_EXHAUSTED'     // All cascade tiers failed (422)

/**
 * Standard API error response format.
 *
 * This interface defines the consistent error response structure
 * used across all API endpoints.
 *
 * @example
 * // Simple error
 * {
 *   error: {
 *     code: 'NOT_FOUND',
 *     message: 'Function not found: my-function'
 *   }
 * }
 *
 * @example
 * // Error with details
 * {
 *   error: {
 *     code: 'VALIDATION_ERROR',
 *     message: 'Input validation failed',
 *     details: {
 *       validationErrors: ['field "name" is required', 'field "age" must be a number']
 *     }
 *   },
 *   requestId: 'req_abc123'
 * }
 */
export interface ApiErrorResponse {
  error: {
    /** Machine-readable error code for programmatic handling */
    code: ApiErrorCode
    /** Human-readable error message */
    message: string
    /** Optional additional error details */
    details?: Record<string, unknown>
  }
  /** Optional request ID for tracing/debugging */
  requestId?: string
}

// =============================================================================
// RESPONSE HELPERS
// =============================================================================

/**
 * Create a JSON Response with proper headers and status code.
 *
 * @param data - The data to serialize as JSON
 * @param status - HTTP status code (default: 200)
 * @param headers - Additional headers to include (Content-Type is always set to application/json)
 * @returns A Response object with JSON body and proper headers
 *
 * @example
 * // Basic success response
 * return jsonResponse({ success: true })
 *
 * @example
 * // Error response with custom status
 * return jsonResponse({ error: 'Not found' }, 404)
 *
 * @example
 * // Response with custom headers
 * return jsonResponse({ result: 'ok' }, 200, { 'X-Request-ID': 'abc123' })
 */
export function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

/**
 * Create a standardized JSON error response.
 *
 * This helper ensures all error responses follow the ApiErrorResponse format
 * for consistency across the API.
 *
 * @param code - Machine-readable error code
 * @param message - Human-readable error message
 * @param status - HTTP status code (default: inferred from error code)
 * @param options - Additional options (details, requestId, headers)
 * @returns A Response object with standardized error format
 *
 * @example
 * // Simple not found error
 * return jsonErrorResponse('NOT_FOUND', 'Function not found: my-function')
 *
 * @example
 * // Validation error with details
 * return jsonErrorResponse('VALIDATION_ERROR', 'Input validation failed', 400, {
 *   details: { validationErrors: ['field "name" is required'] }
 * })
 *
 * @example
 * // Error with request ID for tracing
 * return jsonErrorResponse('INTERNAL_ERROR', 'Something went wrong', 500, {
 *   requestId: 'req_abc123'
 * })
 */
export function jsonErrorResponse(
  code: ApiErrorCode,
  message: string,
  status?: number,
  options?: {
    details?: Record<string, unknown>
    requestId?: string
    headers?: Record<string, string>
  }
): Response {
  // Infer status code from error code if not provided
  const resolvedStatus = status ?? inferStatusFromCode(code)

  const errorBody: ApiErrorResponse = {
    error: {
      code,
      message,
    },
  }

  if (options?.details && Object.keys(options.details).length > 0) {
    errorBody.error.details = options.details
  }

  if (options?.requestId) {
    errorBody.requestId = options.requestId
  }

  return jsonResponse(errorBody, resolvedStatus, options?.headers ?? {})
}

/**
 * Infer HTTP status code from error code.
 *
 * @param code - The API error code
 * @returns The appropriate HTTP status code
 */
function inferStatusFromCode(code: ApiErrorCode): number {
  switch (code) {
    // 400 Bad Request
    case 'VALIDATION_ERROR':
    case 'INVALID_JSON':
    case 'MISSING_REQUIRED':
    case 'INVALID_FUNCTION_ID':
    case 'INVALID_VERSION':
    case 'INVALID_LANGUAGE':
    case 'INVALID_PARAMETER':
    case 'COMPILATION_ERROR':
      return 400

    // 401 Unauthorized
    case 'UNAUTHORIZED':
      return 401

    // 403 Forbidden
    case 'FORBIDDEN':
      return 403

    // 404 Not Found
    case 'NOT_FOUND':
    case 'FUNCTION_NOT_FOUND':
      return 404

    // 405 Method Not Allowed
    case 'METHOD_NOT_ALLOWED':
      return 405

    // 408 Request Timeout
    case 'TIMEOUT':
      return 408

    // 409 Conflict
    case 'CONFLICT':
      return 409

    // 413 Payload Too Large
    case 'PAYLOAD_TOO_LARGE':
      return 413

    // 422 Unprocessable Entity
    case 'CASCADE_EXHAUSTED':
      return 422

    // 500 Internal Server Error
    case 'EXECUTION_ERROR':
    case 'INTERNAL_ERROR':
      return 500

    // 501 Not Implemented
    case 'NOT_IMPLEMENTED':
      return 501

    // 503 Service Unavailable
    case 'SERVICE_UNAVAILABLE':
      return 503

    default:
      return 500
  }
}
