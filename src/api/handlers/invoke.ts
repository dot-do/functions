/**
 * Invoke Handler for Functions.do
 *
 * Handles function invocation requests and dispatches to appropriate executors.
 */

import type { RouteContext, Env, Handler } from '../router'
import { KVFunctionRegistry } from '../../core/kv-function-registry'
import { KVCodeStorage } from '../../core/code-storage'
import { validateFunctionId } from '../../core/function-registry'
import type { FunctionMetadata } from '../../core/types'

/**
 * Context for invoke handler
 */
export interface InvokeHandlerContext extends RouteContext {
  functionId: string
}

/**
 * JSON response helper
 */
function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/**
 * Strip TypeScript type annotations using regex-based parsing.
 */
function stripTypeScript(code: string): string {
  let result = code

  // Remove single-line interface declarations
  result = result.replace(/^\s*(export\s+)?interface\s+\w+[^{]*\{[^}]*\}\s*$/gm, '')

  // Remove multi-line interface declarations
  result = result.replace(/^\s*(export\s+)?interface\s+\w+[^{]*\{[\s\S]*?\n\}\s*$/gm, '')

  // Remove type alias declarations
  result = result.replace(/^\s*(export\s+)?type\s+\w+\s*(<[^>]+>)?\s*=\s*[^;]+;?\s*$/gm, '')

  // Remove import type statements
  result = result.replace(/^\s*import\s+type\s+.*$/gm, '')

  // Remove type-only imports
  result = result.replace(/,\s*type\s+\w+/g, '')
  result = result.replace(/{\s*type\s+\w+\s*,/g, '{')
  result = result.replace(/{\s*type\s+\w+\s*}/g, '{ }')

  // Remove export type statements
  result = result.replace(/^\s*export\s+type\s+\{[^}]*\}[^;]*;?\s*$/gm, '')

  // Remove declare statements
  result = result.replace(/^\s*declare\s+(const|let|var|function|class|module|namespace|global|type|interface)\s+[^;]+;?\s*$/gm, '')

  // Remove access modifiers
  result = result.replace(/\b(public|private|protected)\s+(?=\w)/g, '')
  result = result.replace(/\breadonly\s+(?=\w)/g, '')

  // Remove type assertions
  result = result.replace(/\s+as\s+\{[^}]+\}/g, '')
  result = result.replace(/\s+as\s+(?!const\b)[A-Z][\w<>[\],\s|&.?]*/g, '')
  result = result.replace(/\s+as\s+(?!const\b)(string|number|boolean|any|unknown|void|never|null|undefined)\b/g, '')

  // Remove angle bracket type assertions
  result = result.replace(/<([A-Z][\w<>[\],\s|&.?]*)>(?=\s*[\w({[])/g, '')

  // Remove type annotations from parameters
  result = result.replace(/([(,\s])(\w+)\s*\??\s*:\s*([A-Z][\w<>[\],\s|&.?]*|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint)(?=\s*[,)=])/gi, '$1$2')

  // Remove return type annotations
  result = result.replace(/\)\s*:\s*([A-Z][\w<>[\],\s|&.?]*|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint|Promise<[^>]+>)\s*(?=[{=])/gi, ') ')

  // Remove generic type parameters from functions
  result = result.replace(/(<[A-Z][\w,\s]*(?:\s+extends\s+[^>]+)?>)(?=\s*\()/gi, '')

  // Remove generic type parameters from classes
  result = result.replace(/(class\s+\w+)\s*<[A-Z][\w,\s]*(?:\s+extends\s+[^>]+)?>/gi, '$1')

  // Remove non-null assertions
  result = result.replace(/(\w+)!(?!=)/g, '$1')

  // Remove satisfies expressions
  result = result.replace(/\s+satisfies\s+[A-Z][\w<>[\],\s|&.?]*/gi, '')

  // Clean up empty imports
  result = result.replace(/^\s*import\s*\{\s*\}\s*from\s*['"][^'"]+['"];?\s*$/gm, '')

  // Clean up multiple consecutive newlines
  result = result.replace(/\n{3,}/g, '\n\n')

  // Clean up multiple spaces
  result = result.replace(/  +/g, ' ')

  return result.trim()
}

/**
 * Determine function type from metadata
 */
function getFunctionType(metadata: FunctionMetadata & { type?: string }): string {
  return metadata.type || 'code'
}

/**
 * Invoke handler - executes functions
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
      const sandboxRequest = new Request('http://sandbox/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestData ? JSON.stringify(requestData) : undefined,
      })

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

      const dispatchRequest = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: requestData ? JSON.stringify(requestData) : undefined,
      })

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

export { invokeHandler as default }
