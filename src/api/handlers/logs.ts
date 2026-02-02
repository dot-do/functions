/**
 * Logs Handler for Functions.do
 *
 * Retrieves function execution logs from Durable Object storage.
 *
 * @module handlers/logs
 */

import type { RouteContext, Env, Handler } from '../router'
import { validateFunctionId } from '../../core/function-registry'
import { jsonResponse, jsonErrorResponse } from '../http-utils'

/**
 * Logs handler - retrieves function execution logs.
 *
 * Fetches logs from the FUNCTION_LOGS Durable Object namespace.
 * Supports filtering by time range and limiting result count.
 *
 * Query parameters:
 * - limit: Maximum number of log entries to return (1-1000, default: 100)
 * - since: ISO 8601 timestamp to filter logs after this time
 *
 * @param request - The incoming HTTP request with optional query parameters
 * @param env - Environment bindings with FUNCTION_LOGS Durable Object namespace
 * @param ctx - Execution context
 * @param context - Route context containing function ID from URL params
 * @returns JSON array of log entries with timestamp, level, and message
 *
 * @example
 * // GET /api/functions/my-function/logs?limit=50&since=2024-01-01T00:00:00Z
 * // Response: [{ "timestamp": "...", "level": "info", "message": "..." }, ...]
 */
export const logsHandler: Handler = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  context?: RouteContext
): Promise<Response> => {
  const functionId = context?.functionId || context?.params?.['id']

  if (!functionId) {
    return jsonErrorResponse('MISSING_REQUIRED', 'Function ID required')
  }

  // Validate function ID
  try {
    validateFunctionId(functionId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid function ID'
    return jsonErrorResponse('INVALID_FUNCTION_ID', message)
  }

  // Check if logs DO is configured
  if (!env.FUNCTION_LOGS) {
    return jsonErrorResponse('SERVICE_UNAVAILABLE', 'Function logs not configured')
  }

  // Parse query parameters
  const url = new URL(request.url)
  const limitParam = url.searchParams.get('limit')
  const sinceParam = url.searchParams.get('since')

  const limit = limitParam ? parseInt(limitParam, 10) : 100
  if (isNaN(limit) || limit < 1 || limit > 1000) {
    return jsonErrorResponse('INVALID_PARAMETER', 'Invalid limit parameter. Must be between 1 and 1000.')
  }

  let startTime: number | undefined
  if (sinceParam) {
    const parsedDate = Date.parse(sinceParam)
    if (isNaN(parsedDate)) {
      return jsonErrorResponse('INVALID_PARAMETER', 'Invalid since parameter. Must be an ISO 8601 timestamp.')
    }
    startTime = parsedDate
  }

  try {
    // Get DO stub
    const doId = env.FUNCTION_LOGS.idFromName(functionId)
    const stub = env.FUNCTION_LOGS.get(doId)

    // Build query URL
    const doUrl = new URL('/logs', 'https://function-logs.internal')
    doUrl.searchParams.set('functionId', functionId)
    doUrl.searchParams.set('limit', String(limit))

    // Forward request to DO
    const doResponse = await stub.fetch(doUrl.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!doResponse.ok) {
      const errorText = await doResponse.text()
      return jsonErrorResponse('INTERNAL_ERROR', `Failed to retrieve logs: ${errorText}`, doResponse.status)
    }

    // Parse and transform response
    const doResult = await doResponse.json() as {
      entries: Array<{
        timestamp: number
        level: string
        message: string
      }>
    }

    let entries = doResult.entries || []

    // Filter by startTime if provided
    if (startTime !== undefined) {
      entries = entries.filter(entry => entry.timestamp >= startTime!)
    }

    // Transform to expected format
    const logs = entries.map(entry => ({
      timestamp: new Date(entry.timestamp).toISOString(),
      level: entry.level,
      message: entry.message,
    }))

    return jsonResponse(logs)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve logs'
    return jsonErrorResponse('INTERNAL_ERROR', message)
  }
}
