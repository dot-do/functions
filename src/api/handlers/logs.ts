/**
 * Logs Handler for Functions.do
 *
 * Retrieves function execution logs.
 */

import type { RouteContext, Env, Handler } from '../router'
import { validateFunctionId } from '../../core/function-registry'

/**
 * JSON response helper
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Logs handler - retrieves function execution logs
 */
export const logsHandler: Handler = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  context?: RouteContext
): Promise<Response> => {
  const functionId = context?.functionId || context?.params?.['id']

  if (!functionId) {
    return jsonResponse({ error: 'Function ID required' }, 400)
  }

  // Validate function ID
  try {
    validateFunctionId(functionId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid function ID'
    return jsonResponse({ error: message }, 400)
  }

  // Check if logs DO is configured
  if (!env.FUNCTION_LOGS) {
    return jsonResponse({ error: 'Function logs not configured' }, 503)
  }

  // Parse query parameters
  const url = new URL(request.url)
  const limitParam = url.searchParams.get('limit')
  const sinceParam = url.searchParams.get('since')

  const limit = limitParam ? parseInt(limitParam, 10) : 100
  if (isNaN(limit) || limit < 1 || limit > 1000) {
    return jsonResponse({ error: 'Invalid limit parameter. Must be between 1 and 1000.' }, 400)
  }

  let startTime: number | undefined
  if (sinceParam) {
    const parsedDate = Date.parse(sinceParam)
    if (isNaN(parsedDate)) {
      return jsonResponse({ error: 'Invalid since parameter. Must be an ISO 8601 timestamp.' }, 400)
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
      return jsonResponse({ error: `Failed to retrieve logs: ${errorText}` }, doResponse.status)
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
    return jsonResponse({ error: message }, 500)
  }
}

export { logsHandler as default }
