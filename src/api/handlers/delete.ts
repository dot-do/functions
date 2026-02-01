/**
 * Delete Handler for Functions.do
 *
 * Handles function deletion including cleanup of metadata and code storage.
 *
 * @module handlers/delete
 */

import type { RouteContext, Env, Handler } from '../router'
import { KVFunctionRegistry } from '../../core/kv-function-registry'
import { KVCodeStorage } from '../../core/code-storage'
import { validateFunctionId } from '../../core/function-registry'
import { jsonResponse } from '../http-utils'

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
    return jsonResponse({ error: 'Function ID required' }, 400)
  }

  // Validate function ID
  try {
    validateFunctionId(functionId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid function ID'
    return jsonResponse({ error: message }, 400)
  }

  const registry = new KVFunctionRegistry(env.FUNCTIONS_REGISTRY)
  const codeStorage = new KVCodeStorage(env.FUNCTIONS_CODE)

  // Check if function exists
  const metadata = await registry.get(functionId)
  if (!metadata) {
    return jsonResponse({ error: 'Function not found' }, 404)
  }

  // Delete code (including all versions)
  await codeStorage.deleteAll(functionId)

  // Delete metadata (including all version metadata)
  await registry.delete(functionId)

  return jsonResponse({ success: true, id: functionId, message: 'Function deleted' })
}
