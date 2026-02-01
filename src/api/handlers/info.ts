/**
 * Info Handler for Functions.do
 *
 * Returns function metadata and status.
 */

import type { RouteContext, Env, Handler } from '../router'
import { KVFunctionRegistry } from '../../core/kv-function-registry'
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
 * Info handler - returns function metadata
 */
export const infoHandler: Handler = async (
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
  const metadata = await registry.get(functionId)

  if (!metadata) {
    return jsonResponse({ error: `Function not found: ${functionId}` }, 404)
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
