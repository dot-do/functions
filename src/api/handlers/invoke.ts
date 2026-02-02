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
 * ## TypeScript Execution
 *
 * For TypeScript functions, the invoke handler uses pre-compiled JavaScript
 * stored at deploy time. This provides:
 * - Zero runtime compilation overhead
 * - Full TypeScript support (enums, decorators, namespaces)
 * - Fast cold starts
 *
 * Fallback behavior:
 * 1. Use pre-compiled JS from KV (code:{id}:compiled)
 * 2. Fall back to regex stripping if no compiled code
 *
 * Design reference: docs/ESBUILD_WASM_DESIGN.md
 *
 * @module handlers/invoke
 */

import type { RouteContext, Env, Handler } from '../router'
import { KVFunctionRegistry } from '../../core/kv-function-registry'
import { KVCodeStorage } from '../../core/code-storage'
import { validateFunctionId } from '../../core/function-registry'
import type { FunctionMetadata } from '../../core/types'
import { jsonResponse } from '../http-utils'
import { stripTypeScriptSync } from '../../core/ts-compiler'
import { TierDispatcher, type ExtendedMetadata, type TierDispatcherEnv } from '../tier-dispatcher'
import { FunctionClassifier, type ClassificationResult } from '../../core/function-classifier'

/**
 * Extended route context for invoke handler with required function ID.
 */
export interface InvokeHandlerContext extends RouteContext {
  /** The function identifier to invoke */
  functionId: string
}

// Module-level classifier instance with caching for auto-classification
let _classifierInstance: FunctionClassifier | undefined

/**
 * Get or create the shared FunctionClassifier instance.
 * Uses a module-level singleton so classification results are cached across requests.
 */
function getClassifier(aiClient?: unknown): FunctionClassifier {
  if (!_classifierInstance) {
    _classifierInstance = new FunctionClassifier(
      aiClient as Parameters<typeof FunctionClassifier.prototype.classify>[0] extends never ? undefined : any,
      { maxCacheSize: 1000, defaultCacheTtlMs: 3600000 },
    )
  }
  return _classifierInstance
}

/**
 * Determine function type from metadata.
 *
 * If the metadata has an explicit type field, that is used directly.
 * Otherwise, defaults to 'code' for backward compatibility.
 *
 * For async auto-classification (when AI client is available), use
 * classifyFunctionType() instead.
 *
 * @param metadata - Function metadata with optional type field
 * @returns The function type ('code', 'generative', 'agentic', 'human', or 'cascade')
 */
function getFunctionType(metadata: FunctionMetadata & { type?: string }): string {
  return metadata.type || 'code'
}

/**
 * Auto-classify a function's type using AI when no explicit type is set.
 *
 * This function uses the FunctionClassifier to analyze the function name
 * and metadata to determine the appropriate execution tier. Results are
 * cached for subsequent invocations.
 *
 * @param metadata - Extended function metadata
 * @param aiClient - Optional AI client for AI-powered classification
 * @returns The classified function type and optional classification metadata
 */
async function classifyFunctionType(
  metadata: ExtendedMetadata,
  aiClient?: unknown,
): Promise<{ type: string; classification?: ClassificationResult }> {
  // If type is explicitly set, use it directly
  if (metadata.type) {
    return { type: metadata.type }
  }

  // Try AI-based auto-classification if AI client is available
  const classifier = getClassifier(aiClient)
  const description = metadata.userPrompt || metadata.goal || metadata.systemPrompt
  const result = await classifier.classify(
    metadata.id,
    description,
    metadata.inputSchema,
  )

  // Only use AI classification if confidence is sufficient
  if (result.confidence >= 0.6) {
    return { type: result.type, classification: result }
  }

  // Low confidence: default to 'code' for safety
  return { type: 'code', classification: result }
}

/**
 * Invoke handler - executes deployed functions.
 *
 * Supports all execution tiers via TierDispatcher:
 * - Tier 1: Code (5s timeout) - Direct code execution via worker_loaders or dispatch namespace
 * - Tier 2: Generative (30s timeout) - AI-powered generation via AI_CLIENT
 * - Tier 3: Agentic (5m timeout) - Multi-step AI agent execution via AI_CLIENT
 * - Tier 4: Human (24h timeout) - Human-in-the-loop tasks via HUMAN_TASKS DO
 *
 * For code execution, the handler tries multiple backends in order:
 * 1. worker_loaders (ai-evaluate) - Isolated worker execution
 * 2. dispatch_namespace (Workers for Platforms) - Pre-deployed workers
 *
 * For non-code tiers, invocations are dispatched to the TierDispatcher which
 * handles generative, agentic, human, and cascade function types.
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
/** Maximum allowed request body size for invoke requests (10MB) */
const INVOKE_MAX_BODY_SIZE = 10 * 1024 * 1024

export const invokeHandler: Handler = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  context?: RouteContext
): Promise<Response> => {
  // Validate request body size before parsing
  const contentLength = request.headers.get('Content-Length')
  if (contentLength !== null) {
    const size = parseInt(contentLength, 10)
    if (isNaN(size) || size > INVOKE_MAX_BODY_SIZE) {
      return jsonResponse(
        { error: `Request body too large. Maximum size is ${INVOKE_MAX_BODY_SIZE} bytes (10MB).` },
        413
      )
    }
  }

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

  // Determine function type - use auto-classification if no type is explicitly set
  const extendedMetadata = metadata as ExtendedMetadata
  let functionType: string
  let classificationMeta: ClassificationResult | undefined

  if (extendedMetadata.type) {
    // Explicit type set - use directly
    functionType = extendedMetadata.type
  } else if (env.AI_CLIENT) {
    // No type set and AI client available - try auto-classification
    const classified = await classifyFunctionType(extendedMetadata, env.AI_CLIENT)
    functionType = classified.type
    classificationMeta = classified.classification
  } else {
    // No type set and no AI client - default to code
    functionType = 'code'
  }

  const start = Date.now()

  // For non-code types, dispatch through TierDispatcher
  if (['generative', 'agentic', 'human', 'cascade'].includes(functionType)) {
    // Build TierDispatcher environment from the handler's env
    const dispatcherEnv: TierDispatcherEnv = {
      FUNCTIONS_REGISTRY: env.FUNCTIONS_REGISTRY,
      FUNCTIONS_CODE: env.FUNCTIONS_CODE,
      LOADER: env.LOADER,
      USER_FUNCTIONS: env.USER_FUNCTIONS,
      AI_CLIENT: env.AI_CLIENT,
      HUMAN_TASKS: env.HUMAN_TASKS,
      CODE_STORAGE: env.CODE_STORAGE,
    }

    const dispatcher = new TierDispatcher(dispatcherEnv)
    const dispatchMetadata = classificationMeta
      ? { ...extendedMetadata, type: functionType }
      : extendedMetadata
    const result = await dispatcher.dispatch(
      dispatchMetadata as ExtendedMetadata,
      requestData
    )

    // Add classification info to response meta if auto-classified
    if (classificationMeta) {
      result.body._meta = {
        ...result.body._meta,
        autoClassified: true,
        classification: {
          type: classificationMeta.type,
          confidence: classificationMeta.confidence,
          reasoning: classificationMeta.reasoning,
        },
      } as typeof result.body._meta
    }

    // Add execution time header
    const headers: Record<string, string> = {
      'X-Execution-Time': String(result.body._meta.duration),
    }

    // Return the dispatcher result directly
    return jsonResponse(result.body, result.status, headers)
  }

  // Code execution path
  const codeStorage = new KVCodeStorage(env.FUNCTIONS_CODE)

  // For TypeScript, try to use pre-compiled JavaScript first
  // This avoids runtime compilation overhead
  let jsCode: string | null = null
  let usedPrecompiled = false
  let fallbackReason: string | undefined

  if (metadata.language === 'typescript') {
    // Try to get pre-compiled JavaScript
    jsCode = version
      ? await codeStorage.getCompiled(functionId, version)
      : await codeStorage.getCompiled(functionId)

    if (jsCode) {
      usedPrecompiled = true
    } else {
      // Fall back to original source and strip TypeScript at runtime
      fallbackReason = 'no_precompiled_code'
      const sourceCode = version
        ? await codeStorage.get(functionId, version)
        : await codeStorage.get(functionId)

      if (!sourceCode) {
        return jsonResponse({ error: `Function code not found: ${functionId}` }, 404)
      }

      // Use regex-based stripping as fallback (fast but limited)
      try {
        jsCode = stripTypeScriptSync(sourceCode)
      } catch (stripError) {
        // If stripping fails, the code might have complex TS features
        // Return an error suggesting redeployment
        const message = stripError instanceof Error ? stripError.message : String(stripError)
        return jsonResponse({
          error: `TypeScript compilation failed at runtime: ${message}. ` +
                 `Please redeploy this function to compile with esbuild.`,
          _meta: {
            executorType: 'code',
            duration: Date.now() - start,
            fallbackReason: 'regex_strip_failed',
          },
        }, 500)
      }
    }
  } else {
    // For JavaScript, get the code directly
    jsCode = version
      ? await codeStorage.get(functionId, version)
      : await codeStorage.get(functionId)
  }

  if (!jsCode) {
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
            _meta: {
              duration,
              executedWith: 'worker_loaders',
              executorType: 'code',
              usedPrecompiled,
              fallbackReason,
            },
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
          _meta: {
            duration,
            executedWith: 'worker_loaders',
            executorType: 'code',
            usedPrecompiled,
            fallbackReason,
          },
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
            _meta: {
              duration,
              executedWith: 'dispatch_namespace',
              executorType: 'code',
              usedPrecompiled,
              fallbackReason,
            },
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
          _meta: {
            duration,
            executedWith: 'dispatch_namespace',
            executorType: 'code',
            usedPrecompiled,
            fallbackReason,
          },
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
      _meta: {
        executorType: 'code',
        duration: Date.now() - start,
        usedPrecompiled,
        fallbackReason,
      },
    },
    501
  )
}
