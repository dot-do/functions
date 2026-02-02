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
import { getStorageClientCompat } from './storage-compat'
import { validateFunctionId } from '../../core/function-registry'
import { getErrorMessage, ValidationError } from '../../core/errors'
import type { FunctionMetadata } from '../../core/types'
import { validateInvokeBody, validateFunctionMetadata } from '../../core/validation'
import { jsonResponse } from '../http-utils'
import { stripTypeScriptSync } from '../../core/ts-compiler'
import { TierDispatcher, type ExtendedMetadata, type TierDispatcherEnv } from '../tier-dispatcher'
import {
  type FunctionClassifier,
  type ClassificationResult,
  type WorkersAIBinding,
  createClassifier,
} from '../../core/function-classifier'
import { INVOKE } from '../../config/defaults'
import {
  getCachedMetadata,
  cacheMetadata,
  getCachedCompiledCode,
  cacheCompiledCode,
  getCachedSourceCode,
  cacheSourceCode,
} from '../caching'

/**
 * Get a UserStorageClient for the current request.
 * Uses authenticated userId or falls back to 'anonymous'.
 */
function getStorageClient(env: Env, userId?: string) {
  return getStorageClientCompat(env, userId || 'anonymous')
}

// Re-export invalidateFunctionCache for callers that need cache invalidation
export { invalidateFunctionCache } from '../caching'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Extended route context for invoke handler with required function ID.
 */
export interface InvokeHandlerContext extends RouteContext {
  /** The function identifier to invoke */
  functionId: string
}

/**
 * Result of request validation
 */
interface ValidateInvokeRequestResult {
  /** Whether the validation passed */
  valid: boolean
  /** Error response if validation failed */
  errorResponse?: Response
  /** Parsed function ID */
  functionId?: string
  /** Optional version from query string */
  version?: string
  /** Parsed request body data */
  requestData?: unknown
  /** Function metadata from registry */
  metadata?: FunctionMetadata
}

/**
 * Result of function classification
 */
interface ClassifyFunctionResult {
  /** The determined function type */
  type: string
  /** Classification metadata if auto-classified */
  classification?: ClassificationResult
}

/**
 * Execution context for code functions
 */
interface CodeExecutionContext {
  /** The function ID */
  functionId: string
  /** Optional version */
  version?: string
  /** Function metadata */
  metadata: FunctionMetadata
  /** Parsed request data */
  requestData: unknown
  /** Original request for dispatch namespace */
  request: Request
}

/**
 * Execution context for non-code functions
 */
interface NonCodeExecutionContext {
  /** Extended function metadata */
  metadata: ExtendedMetadata
  /** Parsed request data */
  requestData: unknown
  /** The determined function type */
  functionType: string
  /** Classification result if auto-classified */
  classificationMeta?: ClassificationResult
}

/**
 * Result of worker loader execution attempt
 */
interface WorkerLoaderResult {
  success: boolean
  response?: Response
  error?: string
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create a FunctionClassifier instance for this request.
 *
 * Creates a fresh classifier per-request to avoid state corruption issues.
 * The FunctionClassifier has mutable internal state (LRU cache) that could
 * cause race conditions if shared across concurrent requests.
 *
 * @param aiBinding - The Workers AI binding (env.AI)
 * @param env - Optional environment variables for fallback providers
 * @returns A fresh FunctionClassifier instance
 */
function createClassifierForRequest(
  aiBinding: WorkersAIBinding,
  env?: Record<string, string | undefined>
): FunctionClassifier {
  return createClassifier(aiBinding, env)
}

/**
 * Validate the invoke request including body size, function ID, and parse the request body.
 *
 * @param request - The incoming HTTP request
 * @param env - Environment bindings
 * @param context - Route context with function ID and version
 * @returns Validation result with parsed data or error response
 */
export async function validateInvokeRequest(
  request: Request,
  env: Env,
  context?: RouteContext
): Promise<ValidateInvokeRequestResult> {
  // Validate request body size before parsing
  const contentLength = request.headers.get('Content-Length')
  if (contentLength !== null) {
    const size = parseInt(contentLength, 10)
    if (isNaN(size) || size > INVOKE.MAX_BODY_SIZE) {
      return {
        valid: false,
        errorResponse: jsonResponse(
          { error: `Request body too large. Maximum size is ${INVOKE.MAX_BODY_SIZE} bytes (10MB).` },
          413
        ),
      }
    }
  }

  const functionId = context?.functionId || context?.params?.['id']
  const version = context?.version

  if (!functionId) {
    return {
      valid: false,
      errorResponse: jsonResponse({ error: 'Function ID required' }, 400),
    }
  }

  // Validate function ID format
  try {
    validateFunctionId(functionId)
  } catch (error) {
    return {
      valid: false,
      errorResponse: jsonResponse({ error: getErrorMessage(error, 'Invalid function ID') }, 400),
    }
  }

  // Get function metadata - check cache first to reduce DO request amplification
  let metadata = await getCachedMetadata(functionId, version)

  if (!metadata) {
    const client = getStorageClient(env)
    metadata = version
      ? await client.registry.getVersion(functionId, version)
      : await client.registry.get(functionId)

    // Cache the metadata if found
    if (metadata) {
      await cacheMetadata(functionId, metadata, version)
    }
  }

  if (!metadata) {
    return {
      valid: false,
      errorResponse: jsonResponse({ error: `Function not found: ${functionId}` }, 404),
    }
  }

  // Parse request body
  let requestData: unknown = {}
  const contentType = request.headers.get('Content-Type')

  if (contentType?.includes('application/json')) {
    const bodyText = await request.text()
    if (bodyText.trim()) {
      try {
        const parsed = JSON.parse(bodyText)
        requestData = validateInvokeBody(parsed, `invoke request for ${functionId}`)
      } catch (parseError) {
        if (parseError instanceof ValidationError) {
          return {
            valid: false,
            errorResponse: jsonResponse({ error: parseError.message }, 400),
          }
        }
        return {
          valid: false,
          errorResponse: jsonResponse({ error: 'Invalid JSON body' }, 400),
        }
      }
    }
  } else if (contentType?.includes('multipart/form-data')) {
    try {
      const formData = await request.formData()
      requestData = Object.fromEntries(formData.entries())
    } catch (formError) {
      // Log error for debugging but continue with empty data to not break cascade flow
      console.warn(`[invoke] Failed to parse multipart/form-data for ${functionId}: ${getErrorMessage(formError)}`)
    }
  } else if (contentType?.includes('text/plain')) {
    requestData = { text: await request.text() }
  }

  return {
    valid: true,
    functionId,
    version,
    requestData,
    metadata,
  }
}

/**
 * Classify a function's type using explicit metadata or AI classification.
 *
 * @param metadata - Extended function metadata
 * @param aiBinding - The Workers AI binding (env.AI or env.AI_CLIENT)
 * @param env - Optional environment variables for fallback providers
 * @returns The classified function type and optional classification metadata
 */
export async function classifyFunction(
  metadata: ExtendedMetadata,
  aiBinding: WorkersAIBinding | undefined,
  env?: Record<string, string | undefined>
): Promise<ClassifyFunctionResult> {
  // If type is explicitly set, use it directly
  if (metadata.type) {
    return { type: metadata.type }
  }

  // No explicit type - try AI classification if available
  if (!aiBinding) {
    // No AI binding available - default to 'code' for backwards compatibility.
    // With the discriminated union, validateFunctionMetadata always sets type
    // to 'code' when absent, so this path is only reached if ExtendedMetadata
    // is constructed without going through validation.
    return { type: 'code' }
  }

  // Use the AI binding to classify (fresh instance per request for isolation)
  const classifier = createClassifierForRequest(aiBinding, env)
  const description = metadata.userPrompt || metadata.goal || metadata.systemPrompt
  const result = await classifier.classify(
    metadata.id,
    description,
    metadata.inputSchema,
  )

  return { type: result.type, classification: result }
}

/**
 * Execute code using the worker loader (ai-evaluate).
 *
 * @param env - Environment bindings
 * @param functionId - Function identifier
 * @param jsCode - JavaScript code to execute
 * @param requestData - Input data for the function
 * @param start - Start timestamp
 * @param usedPrecompiled - Whether pre-compiled code was used
 * @param fallbackReason - Reason for fallback if any
 * @returns Result with response if successful, error if failed
 */
async function executeWithWorkerLoader(
  env: Env,
  functionId: string,
  jsCode: string,
  requestData: unknown,
  start: number,
  usedPrecompiled: boolean,
  fallbackReason: string | undefined
): Promise<WorkerLoaderResult> {
  try {
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
      compatibilityDate: INVOKE.COMPATIBILITY_DATE,
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
      const result = await response.json() as Record<string, unknown>
      return {
        success: true,
        response: jsonResponse(
          {
            ...result,
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
        ),
      }
    }

    const body = await response.text()
    return {
      success: true,
      response: jsonResponse(
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
      ),
    }
  } catch (loaderError) {
    const message = getErrorMessage(loaderError)
    console.error(`[invoke] Worker loader error for ${functionId}: ${message}`)
    return { success: false, error: message }
  }
}

/**
 * Execute code using the dispatch namespace (Workers for Platforms).
 *
 * @param env - Environment bindings
 * @param functionId - Function identifier
 * @param requestData - Input data for the function
 * @param request - Original request for headers/URL
 * @param start - Start timestamp
 * @param usedPrecompiled - Whether pre-compiled code was used
 * @param fallbackReason - Reason for fallback if any
 * @param workerLoaderError - Error from worker loader if it failed
 * @returns Response with execution result
 */
async function executeWithDispatchNamespace(
  env: Env,
  functionId: string,
  requestData: unknown,
  request: Request,
  start: number,
  usedPrecompiled: boolean,
  fallbackReason: string | undefined,
  workerLoaderError: string | undefined
): Promise<Response> {
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
      const result = await response.json() as Record<string, unknown>
      return jsonResponse(
        {
          ...result,
          _meta: {
            duration,
            executedWith: 'dispatch_namespace',
            executorType: 'code',
            usedPrecompiled,
            fallbackReason,
            workerLoaderError,
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
          workerLoaderError,
        },
      },
      200,
      { 'X-Execution-Time': String(duration) }
    )
  } catch (dispatchError) {
    return jsonResponse({ error: `Dispatch namespace error: ${getErrorMessage(dispatchError, 'Dispatch error')}` }, 500)
  }
}

/**
 * Execute a code-tier function using worker loaders or dispatch namespace.
 *
 * Handles TypeScript compilation fallback and tries multiple execution backends:
 * 1. Worker loaders (ai-evaluate) - Isolated worker execution
 * 2. Dispatch namespace (Workers for Platforms) - Pre-deployed workers
 *
 * @param env - Environment bindings with LOADER, USER_FUNCTIONS, FUNCTIONS_CODE
 * @param ctx - Code execution context
 * @param start - Start timestamp for duration calculation
 * @returns Response with execution result and metadata
 */
export async function executeCodeFunction(
  env: Env,
  ctx: CodeExecutionContext,
  start: number
): Promise<Response> {
  const { functionId, version, metadata, requestData, request } = ctx
  const client = getStorageClient(env)

  // For TypeScript, try to use pre-compiled JavaScript first
  let jsCode: string | null = null
  let usedPrecompiled = false
  let fallbackReason: string | undefined

  if (metadata.language === 'typescript') {
    // Try to get pre-compiled JavaScript from cache first
    jsCode = await getCachedCompiledCode(functionId, version)
    if (jsCode) {
      usedPrecompiled = true
    } else {
      // Cache miss - fetch from UserStorage DO
      jsCode = version
        ? await client.code.getCompiled(functionId, version)
        : await client.code.getCompiled(functionId)

      if (jsCode) {
        usedPrecompiled = true
        // Cache the compiled code
        await cacheCompiledCode(functionId, jsCode, version)
      } else {
        // Fall back to original source and strip TypeScript at runtime
        fallbackReason = 'no_precompiled_code'

        // Try source code cache first
        let sourceCode = await getCachedSourceCode(functionId, version)
        if (!sourceCode) {
          sourceCode = version
            ? await client.code.get(functionId, version)
            : await client.code.get(functionId)

          // Cache source code if found
          if (sourceCode) {
            await cacheSourceCode(functionId, sourceCode, version)
          }
        }

        if (!sourceCode) {
          return jsonResponse({ error: `Function code not found: ${functionId}` }, 404)
        }

        // Use regex-based stripping as fallback (fast but limited)
        try {
          jsCode = stripTypeScriptSync(sourceCode)
        } catch (stripError) {
          return jsonResponse({
            error: `TypeScript compilation failed at runtime: ${getErrorMessage(stripError)}. ` +
                   `Please redeploy this function to compile with esbuild.`,
            _meta: {
              executorType: 'code',
              duration: Date.now() - start,
              fallbackReason: 'regex_strip_failed',
            },
          }, 500)
        }
      }
    }
  } else {
    // For JavaScript, try cache first
    jsCode = await getCachedSourceCode(functionId, version)
    if (!jsCode) {
      jsCode = version
        ? await client.code.get(functionId, version)
        : await client.code.get(functionId)

      // Cache if found
      if (jsCode) {
        await cacheSourceCode(functionId, jsCode, version)
      }
    }
  }

  if (!jsCode) {
    return jsonResponse({ error: `Function code not found: ${functionId}` }, 404)
  }

  // Track worker loader failure for response metadata
  let workerLoaderError: string | undefined

  // Try worker loader (ai-evaluate) first
  if (env.LOADER) {
    const result = await executeWithWorkerLoader(
      env, functionId, jsCode, requestData, start, usedPrecompiled, fallbackReason
    )
    if (result.success) {
      return result.response!
    }
    workerLoaderError = result.error
  }

  // Try dispatch namespace (Workers for Platforms)
  if (env.USER_FUNCTIONS) {
    return executeWithDispatchNamespace(
      env, functionId, requestData, request, start, usedPrecompiled, fallbackReason, workerLoaderError
    )
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
        workerLoaderError,
      },
    },
    501
  )
}

/**
 * Execute a non-code function (generative, agentic, human, or cascade).
 *
 * Dispatches to the TierDispatcher which handles the appropriate executor.
 *
 * @param env - Environment bindings
 * @param ctx - Non-code execution context
 * @param _start - Start timestamp (unused, dispatcher tracks its own timing)
 * @returns Response with execution result and metadata
 */
export async function executeNonCodeFunction(
  env: Env,
  ctx: NonCodeExecutionContext,
  _start: number
): Promise<Response> {
  const { metadata, requestData, functionType, classificationMeta } = ctx

  // Pass the unified Env directly to TierDispatcher
  const dispatcher = new TierDispatcher(env)
  // Always pass the determined functionType to the dispatcher so it routes correctly,
  // regardless of whether the type came from AI classification or a default.
  const dispatchMetadata = { ...metadata, type: functionType }
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

  return jsonResponse(result.body, result.status, headers)
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

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
 * @param _ctx - Execution context for waitUntil operations (unused)
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
  _ctx: ExecutionContext,
  context?: RouteContext
): Promise<Response> => {
  // Step 1: Validate request and parse input
  const validation = await validateInvokeRequest(request, env, context)
  if (!validation.valid) {
    return validation.errorResponse!
  }

  const { functionId, version, requestData, metadata } = validation

  // Step 2: Classify function type
  const extendedMetadata = metadata as ExtendedMetadata
  const aiBinding = (env.AI || env.AI_CLIENT) as WorkersAIBinding | undefined

  // Extract only the string properties needed for classifier fallback providers
  const classifierEnv: Record<string, string | undefined> = {
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
  }

  const { type: functionType, classification: classificationMeta } = await classifyFunction(
    extendedMetadata,
    aiBinding,
    classifierEnv
  )

  const start = Date.now()

  // Step 3: Execute based on function type
  if (['generative', 'agentic', 'human', 'cascade'].includes(functionType)) {
    // Non-code execution path
    return executeNonCodeFunction(env, {
      metadata: extendedMetadata,
      requestData: requestData!,
      functionType,
      classificationMeta,
    }, start)
  }

  // Code execution path
  return executeCodeFunction(env, {
    functionId: functionId!,
    version,
    metadata: metadata!,
    requestData: requestData!,
    request,
  }, start)
}
