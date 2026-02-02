/**
 * Delete Handler for Functions.do
 *
 * Handles function deletion including cleanup of metadata and code storage.
 *
 * @module handlers/delete
 */

import type { RouteContext, Env, Handler } from '../router'
import { getStorageClientCompat } from './storage-compat'
import { validateFunctionId } from '../../core/function-registry'
import { jsonResponse, jsonErrorResponse } from '../http-utils'
import { logAuditEvent, getClientIp } from '../../core/audit-logger'
import { invalidateFunctionCache } from './invoke'

/**
 * Delete handler - removes function code and metadata.
 *
 * Performs a complete cleanup of all function data:
 * - Deletes all code versions from storage
 * - Deletes all metadata versions from registry
 * - Removes compiled code and source maps
 *
 * This operation is irreversible. The function ID can be reused after deletion.
 *
 * @param request - The incoming HTTP request
 * @param env - Environment bindings with FUNCTIONS_REGISTRY and FUNCTIONS_CODE KV namespaces
 * @param ctx - Execution context
 * @param context - Route context containing function ID from URL params
 * @returns JSON response with success status or error
 *
 * @example
 * // DELETE /api/functions/my-function
 * // Response: { "success": true, "id": "my-function", "message": "Function deleted" }
 */
export const deleteHandler: Handler = async (
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

  // Check if function exists
  const metadata = await client.registry.get(functionId)
  if (!metadata) {
    return jsonErrorResponse('FUNCTION_NOT_FOUND', 'Function not found')
  }

  // Delete code (including all versions)
  await client.code.deleteAll(functionId)

  // Delete metadata (including all version metadata)
  await client.registry.delete(functionId)

  // Invalidate cache to ensure stale data is not served
  // Issue: functions-1277
  await invalidateFunctionCache(functionId)

  // Log audit event for successful delete
  logAuditEvent({
    timestamp: Date.now(),
    userId,
    action: 'delete',
    resource: functionId,
    status: 'success',
    details: { type: metadata.type },
    ip: getClientIp(request),
  })

  return jsonResponse({ success: true, id: functionId, message: 'Function deleted' })
}
