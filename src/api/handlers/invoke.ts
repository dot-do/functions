/**
 * Invoke Handler for Functions.do
 *
 * Handles function invocation requests and dispatches to appropriate executors.
 *
 * Routes to the 4-tier function cascade:
 * - Tier 1: Code (5s timeout) - Direct code execution
 * - Tier 2: Generative (30s timeout) - AI-powered generation
 * - Tier 3: Agentic (5m timeout) - Multi-step AI agent execution
 * - Tier 4: Human (24h timeout) - Human-in-the-loop tasks
 *
 * @module handlers/invoke
 */

import type { RouteContext, Env, Handler } from '../router'
import { KVFunctionRegistry } from '../../core/kv-function-registry'
import { KVCodeStorage } from '../../core/code-storage'
import { validateFunctionId } from '../../core/function-registry'
import type { FunctionMetadata } from '../../core/types'
import { jsonResponse } from '../http-utils'
import { stripTypeScript } from '../../core/ts-strip'

/**
 * Extended route context for invoke handler with required function ID.
 */
export interface InvokeHandlerContext extends RouteContext {
  /** The function identifier to invoke */
  functionId: string
}

/**
 * Determine function type from metadata.
 *
 * Defaults to 'code' for backward compatibility with functions
 * that don't have an explicit type set.
 *
 * @param metadata - Function metadata with optional type field
 * @returns The function type ('code', 'generative', 'agentic', 'human', or 'cascade')
 */
function getFunctionType(metadata: FunctionMetadata & { type?: string }): string {
  return metadata.type || 'code'
}

/**
 * Invoke handler - executes deployed functions.
 *
 * Supports multiple execution tiers:
 * - Tier 1: Code (5s timeout) - Direct code execution via worker_loaders or dispatch namespace
 * - Tier 2-4: Currently return 501 Not Implemented
 *
 * For code execution, the handler tries multiple backends in order:
 * 1. worker_loaders (ai-evaluate) - Isolated worker execution
 * 2. dispatch_namespace (Workers for Platforms) - Pre-deployed workers
 *
 * @param request - The incoming HTTP request with optional JSON body
 * @param env - Environment bindings (KV, Durable Objects, etc.)
 * @param ctx - Execution context for waitUntil operations
 * @param context - Route context with function ID and version
 * @returns JSON response with execution result and metadata
 *
 * @example
 * // POST /functions/my-function
 * // Body: { "name": "World" }
 * // Response: { "greeting": "Hello, World!", "_meta": { "duration": 5, "executorType": "code" } }
 */
export const invokeHandler: Handler = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  context?: RouteContext
): Promise<Response> => {
  const functionId = context?.functionId || context?.params?.['id']
  const version = context?.version

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

  // Get function metadata
  const registry = new KVFunctionRegistry(env.FUNCTIONS_REGISTRY)
  const metadata = version
    ? await registry.getVersion(functionId, version)
    : await registry.get(functionId)

  if (!metadata) {
    return jsonResponse({ error: `Function not found: ${functionId}` }, 404)
  }

  // Parse request body
  let requestData: unknown = {}
  const contentType = request.headers.get('Content-Type')

  if (contentType?.includes('application/json')) {
    const bodyText = await request.text()
    if (bodyText.trim()) {
      try {
        requestData = JSON.parse(bodyText)
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400)
      }
    }
  } else if (contentType?.includes('multipart/form-data')) {
    try {
      const formData = await request.formData()
      requestData = Object.fromEntries(formData.entries())
    } catch {
      // Continue with empty data
    }
  } else if (contentType?.includes('text/plain')) {
    requestData = { text: await request.text() }
  }

  // Determine function type and dispatch to executor
  const functionType = getFunctionType(metadata as FunctionMetadata & { type?: string })
  const start = Date.now()

  // For non-code types, check if executor is available
  if (['generative', 'agentic', 'human', 'cascade'].includes(functionType)) {
    // These executors are not implemented yet
    return jsonResponse(
      {
        error: `Executor not available for function type: ${functionType}`,
        _meta: { executorType: functionType, duration: Date.now() - start },
      },
      501
    )
  }

  // Code execution path
  const codeStorage = new KVCodeStorage(env.FUNCTIONS_CODE)
  const code = version
    ? await codeStorage.get(functionId, version)
    : await codeStorage.get(functionId)

  if (!code) {
    return jsonResponse({ error: `Function code not found: ${functionId}` }, 404)
  }

  // Try worker loader (ai-evaluate) first
  if (env.LOADER) {
    try {
      // Type assertion for worker loader interface
      const loader = env.LOADER as {
        get(id: string, factory: () => Promise<{
          mainModule: string
          modules: Record<string, string>
          compatibilityDate: string
        }>): {
          getEntrypoint(): { fetch(request: Request): Promise<Response> }
        }
      }

      // Strip TypeScript if needed
      let jsCode = code
      const isTypeScript = metadata.language === 'typescript' ||
        code.includes(': Request') ||
        code.includes(': Response') ||
        code.includes(': Promise')

      if (isTypeScript) {
        jsCode = stripTypeScript(code)
      }

      const workerId = `fn-${functionId}-${Date.now()}`
      const workerStub = loader.get(workerId, async () => ({
        mainModule: 'worker.js',
        modules: { 'worker.js': jsCode },
        compatibilityDate: '2024-01-01',
      }))

      const entrypoint = workerStub.getEntrypoint()
      const requestInit: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
      if (requestData) {
        requestInit.body = JSON.stringify(requestData)
      }
      const sandboxRequest = new Request('http://sandbox/invoke', requestInit)

      const response = await entrypoint.fetch(sandboxRequest)
      const duration = Date.now() - start

      const responseContentType = response.headers.get('Content-Type')
      if (responseContentType?.includes('application/json')) {
        const result = await response.json()
        return jsonResponse(
          {
            ...(result as object),
            _meta: { duration, executedWith: 'worker_loaders', executorType: 'code' },
          },
          200,
          { 'X-Execution-Time': String(duration) }
        )
      }

      const body = await response.text()
      return jsonResponse(
        {
          result: body,
          status: response.status,
          _meta: { duration, executedWith: 'worker_loaders', executorType: 'code' },
        },
        200,
        { 'X-Execution-Time': String(duration) }
      )
    } catch (loaderError) {
      console.error('Worker loader error:', loaderError)
      // Fall through to dispatch namespace
    }
  }

  // Try dispatch namespace (Workers for Platforms)
  if (env.USER_FUNCTIONS) {
    try {
      const userFunctions = env.USER_FUNCTIONS as {
        get(name: string): { fetch(request: Request): Promise<Response> } | undefined
      }

      const userWorker = userFunctions.get(functionId)
      if (!userWorker || typeof userWorker.fetch !== 'function') {
        return jsonResponse(
          { error: `Function ${functionId} not available in dispatch namespace` },
          404
        )
      }

      const dispatchRequestInit: RequestInit = {
        method: request.method,
        headers: request.headers,
      }
      if (requestData) {
        dispatchRequestInit.body = JSON.stringify(requestData)
      }
      const dispatchRequest = new Request(request.url, dispatchRequestInit)

      const response = await userWorker.fetch(dispatchRequest)
      const duration = Date.now() - start

      const responseContentType = response.headers.get('Content-Type')
      if (responseContentType?.includes('application/json')) {
        const result = await response.json()
        return jsonResponse(
          {
            ...(result as object),
            _meta: { duration, executedWith: 'dispatch_namespace', executorType: 'code' },
          },
          200,
          { 'X-Execution-Time': String(duration) }
        )
      }

      const body = await response.text()
      return jsonResponse(
        {
          result: body,
          status: response.status,
          _meta: { duration, executedWith: 'dispatch_namespace', executorType: 'code' },
        },
        200,
        { 'X-Execution-Time': String(duration) }
      )
    } catch (dispatchError) {
      const message = dispatchError instanceof Error ? dispatchError.message : 'Dispatch error'
      return jsonResponse({ error: `Dispatch namespace error: ${message}` }, 500)
    }
  }

  // No execution method available
  return jsonResponse(
    {
      error: 'Function execution not available. LOADER or dispatch namespace required.',
      _meta: { executorType: 'code', duration: Date.now() - start },
    },
    501
  )
}
