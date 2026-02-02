/**
 * Update Handler for Functions.do
 *
 * Handles partial updates to function metadata.
 *
 * @module handlers/update
 */

import type { RouteContext, Env, Handler } from '../router'
import { KVFunctionRegistry } from '../../core/kv-function-registry'
import { validateFunctionId } from '../../core/function-registry'
import { jsonResponse } from '../http-utils'

/**
 * Fields that can be updated via the PATCH endpoint.
 * This excludes immutable fields like id, version, createdAt, and type-specific config.
 */
const UPDATABLE_FIELDS = [
  'name',
  'description',
  'tags',
  'permissions',
] as const

type UpdatableField = (typeof UPDATABLE_FIELDS)[number]

/**
 * Update handler - updates function metadata.
 *
 * Allows partial updates to function metadata including:
 * - name: Human-readable function name
 * - description: Function description
 * - tags: Array of tags for categorization
 * - permissions: Access control configuration
 *
 * Immutable fields that cannot be updated:
 * - id: Function identifier (use delete/create to rename)
 * - version: Semantic version (use deploy to create new version)
 * - type: Function type (code, generative, agentic, human)
 * - createdAt: Original creation timestamp
 * - Type-specific configuration (code, model, prompts, etc.)
 *
 * @param request - The incoming HTTP request with JSON update payload
 * @param env - Environment bindings with FUNCTIONS_REGISTRY KV namespace
 * @param ctx - Execution context
 * @param context - Route context containing function ID from URL params
 * @returns JSON response with updated function metadata or error
 *
 * @example
 * // PATCH /v1/api/functions/my-function
 * // Body: { "name": "My Updated Function", "description": "New description" }
 * // Response: { "id": "my-function", "name": "My Updated Function", ... }
 */
export const updateHandler: Handler = async (
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

  // Parse request body
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  // Validate that body is an object
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return jsonResponse({ error: 'Request body must be a JSON object' }, 400)
  }

  // Check for empty update
  const providedFields = Object.keys(body)
  if (providedFields.length === 0) {
    return jsonResponse({ error: 'No fields provided for update' }, 400)
  }

  // Check for attempt to update immutable fields
  const immutableFields = ['id', 'version', 'type', 'createdAt', 'updatedAt', 'language', 'entryPoint', 'code']
  const attemptedImmutable = providedFields.filter((f) => immutableFields.includes(f))
  if (attemptedImmutable.length > 0) {
    return jsonResponse({
      error: `Cannot update immutable fields: ${attemptedImmutable.join(', ')}`,
    }, 400)
  }

  // Check for unknown fields
  const unknownFields = providedFields.filter((f) => !UPDATABLE_FIELDS.includes(f as UpdatableField))
  if (unknownFields.length > 0) {
    return jsonResponse({
      error: `Unknown fields: ${unknownFields.join(', ')}. Updatable fields are: ${UPDATABLE_FIELDS.join(', ')}`,
    }, 400)
  }

  // Validate field types
  if (body.name !== undefined && typeof body.name !== 'string') {
    return jsonResponse({ error: 'Field "name" must be a string' }, 400)
  }

  if (body.description !== undefined && typeof body.description !== 'string') {
    return jsonResponse({ error: 'Field "description" must be a string' }, 400)
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) {
      return jsonResponse({ error: 'Field "tags" must be an array' }, 400)
    }
    for (let i = 0; i < body.tags.length; i++) {
      if (typeof body.tags[i] !== 'string') {
        return jsonResponse({ error: `Field "tags[${i}]" must be a string` }, 400)
      }
    }
  }

  if (body.permissions !== undefined) {
    if (typeof body.permissions !== 'object' || body.permissions === null || Array.isArray(body.permissions)) {
      return jsonResponse({ error: 'Field "permissions" must be an object' }, 400)
    }
  }

  const registry = new KVFunctionRegistry(env.FUNCTIONS_REGISTRY)

  // Check if function exists
  const existing = await registry.get(functionId)
  if (!existing) {
    return jsonResponse({ error: `Function not found: ${functionId}` }, 404)
  }

  // Build updates object with only the provided fields
  const updates: Partial<{
    name: string
    description: string
    tags: string[]
    permissions: Record<string, unknown>
  }> = {}

  if (body.name !== undefined) {
    updates.name = body.name as string
  }
  if (body.description !== undefined) {
    updates.description = body.description as string
  }
  if (body.tags !== undefined) {
    updates.tags = body.tags as string[]
  }
  if (body.permissions !== undefined) {
    updates.permissions = body.permissions as Record<string, unknown>
  }

  // Perform the update
  const updatedMetadata = await registry.update(functionId, updates)

  // Return the updated metadata
  return jsonResponse({
    id: updatedMetadata.id,
    version: updatedMetadata.version,
    type: updatedMetadata.type || 'code',
    name: updatedMetadata.name,
    description: updatedMetadata.description,
    tags: updatedMetadata.tags,
    language: updatedMetadata.language,
    entryPoint: updatedMetadata.entryPoint,
    permissions: updatedMetadata.permissions,
    createdAt: updatedMetadata.createdAt,
    updatedAt: updatedMetadata.updatedAt,
  })
}
