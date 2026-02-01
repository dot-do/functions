/**
 * Delete Handler for Functions.do
 *
 * Handles function deletion including cleanup of metadata and code.
 */

import type { RouteContext, Env, Handler } from '../router'
import { KVFunctionRegistry } from '../../core/kv-function-registry'
import { KVCodeStorage } from '../../core/code-storage'
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
 * Delete handler - removes function code and metadata
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

export { deleteHandler as default }
