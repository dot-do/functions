/**
 * HTTP Utils for Functions.do
 *
 * Shared utility functions for HTTP response handling.
 */

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
