/**
 * List Handler for Functions.do
 *
 * Returns a paginated list of all deployed functions.
 *
 * @module handlers/list
 */

import type { RouteContext, Env, Handler } from '../router'
import { getStorageClientCompat } from './storage-compat'
import { jsonResponse } from '../http-utils'

/**
 * Default number of functions to return per page.
 */
const DEFAULT_LIMIT = 20

/**
 * Maximum number of functions that can be requested per page.
 */
const MAX_LIMIT = 100

/**
 * List handler - returns a paginated list of all functions.
 *
 * Retrieves and returns metadata for all deployed functions with support for:
 * - Pagination via cursor-based navigation
 * - Configurable page size via limit parameter
 * - Optional filtering by type (code, generative, agentic, human)
 *
 * @param request - The incoming HTTP request
 * @param env - Environment bindings with FUNCTIONS_REGISTRY KV namespace
 * @param ctx - Execution context
 * @param context - Route context (unused for list)
 * @returns JSON response with array of function metadata and pagination info
 *
 * @example
 * // GET /v1/api/functions
 * // Response: { "functions": [...], "hasMore": true, "cursor": "20", "total": 45 }
 *
 * @example
 * // GET /v1/api/functions?limit=10&cursor=20
 * // Response: { "functions": [...], "hasMore": true, "cursor": "30" }
 *
 * @example
 * // GET /v1/api/functions?type=generative
 * // Response: { "functions": [...], "hasMore": false }
 */
export const listHandler: Handler = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  context?: RouteContext
): Promise<Response> => {
  const url = new URL(request.url)

  // Parse pagination parameters
  const limitParam = url.searchParams.get('limit')
  const cursorParam = url.searchParams.get('cursor')
  const typeFilter = url.searchParams.get('type')

  // Validate and parse limit
  let limit = DEFAULT_LIMIT
  if (limitParam !== null) {
    const parsedLimit = parseInt(limitParam, 10)
    if (isNaN(parsedLimit) || parsedLimit < 1) {
      return jsonResponse({ error: 'Invalid limit parameter: must be a positive integer' }, 400)
    }
    limit = Math.min(parsedLimit, MAX_LIMIT)
  }

  // Validate type filter if provided
  const validTypes = ['code', 'generative', 'agentic', 'human']
  if (typeFilter !== null && !validTypes.includes(typeFilter)) {
    return jsonResponse({
      error: `Invalid type parameter: must be one of ${validTypes.join(', ')}`,
    }, 400)
  }

  const userId = context?.authContext?.userId || 'anonymous'
  const client = getStorageClientCompat(env, userId)

  // Fetch functions from registry
  const result = await client.registry.list({
    cursor: cursorParam ?? undefined,
    limit,
  })

  // Apply type filter if specified
  let functions = result.functions
  if (typeFilter !== null) {
    functions = functions.filter((fn) => {
      // Default type is 'code' for backward compatibility
      const fnType = fn.type || 'code'
      return fnType === typeFilter
    })
  }

  // Map functions to response format (exclude sensitive/internal fields)
  const responseFunctions = functions.map((fn) => ({
    id: fn.id,
    version: fn.version,
    type: fn.type || 'code',
    name: fn.name,
    description: fn.description,
    tags: fn.tags,
    language: fn.language,
    createdAt: fn.createdAt,
    updatedAt: fn.updatedAt,
  }))

  return jsonResponse({
    functions: responseFunctions,
    hasMore: result.hasMore,
    ...(result.cursor ? { cursor: result.cursor } : {}),
  })
}
