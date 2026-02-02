/**
 * Info Handler for Functions.do
 *
 * Returns function metadata and status for deployed functions.
 *
 * @module handlers/info
 */

import type { RouteContext, Env, Handler } from '../router'
import { getStorageClientCompat } from './storage-compat'
import { validateFunctionId } from '../../core/function-registry'
import { jsonResponse, jsonErrorResponse } from '../http-utils'

/**
 * Info handler - returns function metadata.
 *
 * Retrieves and returns metadata for a deployed function including:
 * - Function ID and version
 * - Programming language
 * - Entry point configuration
 * - Creation and update timestamps
 * - Current availability status
 *
 * @param request - The incoming HTTP request
 * @param env - Environment bindings with FUNCTIONS_REGISTRY KV namespace
 * @param ctx - Execution context
 * @param context - Route context containing function ID from URL params
 * @returns JSON response with function metadata or error
 *
 * @example
 * // GET /api/functions/my-function
 * // Response: { "id": "my-function", "version": "1.0.0", "language": "typescript", ... }
 */
export const infoHandler: Handler = async (
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

  const userId = context?.authContext?.userId || 'anonymous'
  const client = getStorageClientCompat(env, userId)
  const metadata = await client.registry.get(functionId)

  if (!metadata) {
    return jsonErrorResponse('FUNCTION_NOT_FOUND', `Function not found: ${functionId}`)
  }

  return jsonResponse({
    id: metadata.id,
    version: metadata.version,
    language: metadata.language,
    entryPoint: metadata.entryPoint,
    status: 'available',
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  })
}
