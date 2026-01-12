/**
 * Functions.do TypeScript Function Template
 *
 * This is a template for creating serverless functions on the Functions.do platform.
 * The function exports a default object with handler methods that are invoked
 * based on the trigger type (HTTP request, scheduled, queue, etc.).
 *
 * @module {{functionName}}
 */

import { RpcTarget, createFunction, type FunctionContext, type FunctionEnv } from '@functions.do/sdk'

// ============================================================================
// Types
// ============================================================================

/**
 * Environment bindings for this function.
 * Add your KV namespaces, Durable Objects, secrets, etc. here.
 */
export interface Env extends FunctionEnv {
  // Example: KV namespace binding
  // MY_KV: KVNamespace

  // Example: Durable Object binding
  // MY_DO: DurableObjectNamespace

  // Example: Secret
  // API_KEY: string

  // Example: Environment variable
  // ENVIRONMENT: string
}

/**
 * Request body type for the greet endpoint
 */
export interface GreetRequest {
  name: string
}

/**
 * Response type for the greet endpoint
 */
export interface GreetResponse {
  message: string
  timestamp: string
}

/**
 * Result of an arithmetic operation
 */
export interface MathResult {
  operation: string
  operands: number[]
  result: number
}

// ============================================================================
// RPC Target - capnweb Integration
// ============================================================================

/**
 * Interface defining the functions available on this RPC target.
 * This interface is used for type-safe RPC invocation.
 */
export interface MyFunctionTargetMethods {
  /**
   * Greet a user by name
   */
  greet(name: string): Promise<GreetResponse>

  /**
   * Echo the input back
   */
  echo<T>(input: T): Promise<T>

  /**
   * Get the current time
   */
  getTime(): Promise<string>

  /**
   * Add two numbers
   */
  add(a: number, b: number): Promise<MathResult>

  /**
   * Multiply two numbers
   */
  multiply(a: number, b: number): Promise<MathResult>
}

/**
 * MyFunctionTarget provides RPC-callable methods for this function.
 *
 * Use this pattern when you want to expose functions for direct RPC invocation
 * from other Workers or services using the capnweb protocol.
 *
 * The RpcTarget class provides:
 * - Type-safe method invocation
 * - Automatic serialization/deserialization
 * - Resource cleanup via Symbol.dispose
 *
 * @example
 * ```typescript
 * // In another worker - using service binding
 * const target = env.MY_FUNCTION as MyFunctionTarget
 * const result = await target.greet('World')
 * console.log(result.message) // "Hello, World!"
 *
 * // Using RPC client
 * const client = new RpcClient(stub)
 * const result = await client.call('greet', 'World')
 * ```
 */
export class MyFunctionTarget extends RpcTarget implements MyFunctionTargetMethods {
  private env: Env
  private _requestCount: number = 0
  private _errorCount: number = 0

  constructor(env: Env) {
    super()
    this.env = env
  }

  /**
   * Greet a user by name.
   *
   * @param name - The name to greet
   * @returns A greeting message with timestamp
   *
   * @example
   * ```typescript
   * const result = await target.greet('Alice')
   * // Returns: { message: "Hello, Alice!", timestamp: "2024-..." }
   * ```
   */
  async greet(name: string): Promise<GreetResponse> {
    this._requestCount++
    const startTime = performance.now()

    try {
      return {
        message: `Hello, ${name}!`,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      this._errorCount++
      throw error
    } finally {
      const duration = performance.now() - startTime
      // Tracing: method=greet, duration=${duration}ms
      console.log(`[RPC] greet completed in ${duration.toFixed(2)}ms`)
    }
  }

  /**
   * Echo the input back.
   *
   * @param input - Any input to echo
   * @returns The same input
   *
   * @example
   * ```typescript
   * const result = await target.echo({ foo: 'bar' })
   * // Returns: { foo: 'bar' }
   * ```
   */
  async echo<T>(input: T): Promise<T> {
    this._requestCount++
    return input
  }

  /**
   * Get the current time.
   *
   * @returns Current ISO timestamp
   *
   * @example
   * ```typescript
   * const time = await target.getTime()
   * // Returns: "2024-01-12T10:30:00.000Z"
   * ```
   */
  async getTime(): Promise<string> {
    this._requestCount++
    return new Date().toISOString()
  }

  /**
   * Add two numbers.
   *
   * @param a - First number
   * @param b - Second number
   * @returns Math result with operation details
   *
   * @example
   * ```typescript
   * const result = await target.add(2, 3)
   * // Returns: { operation: "add", operands: [2, 3], result: 5 }
   * ```
   */
  async add(a: number, b: number): Promise<MathResult> {
    this._requestCount++
    return {
      operation: 'add',
      operands: [a, b],
      result: a + b,
    }
  }

  /**
   * Multiply two numbers.
   *
   * @param a - First number
   * @param b - Second number
   * @returns Math result with operation details
   *
   * @example
   * ```typescript
   * const result = await target.multiply(6, 7)
   * // Returns: { operation: "multiply", operands: [6, 7], result: 42 }
   * ```
   */
  async multiply(a: number, b: number): Promise<MathResult> {
    this._requestCount++
    return {
      operation: 'multiply',
      operands: [a, b],
      result: a * b,
    }
  }

  /**
   * Get current metrics for this RPC target.
   *
   * @returns Request and error counts
   */
  getMetrics(): { requestCount: number; errorCount: number } {
    return {
      requestCount: this._requestCount,
      errorCount: this._errorCount,
    }
  }

  /**
   * Clean up resources when the target is disposed.
   * Called automatically when using `using` keyword (ES2022+).
   *
   * @example
   * ```typescript
   * {
   *   using target = new MyFunctionTarget(env)
   *   await target.greet('World')
   * } // target is automatically disposed here
   * ```
   */
  [Symbol.dispose](): void {
    // Clean up any resources
    // Log final metrics if needed
    console.log(`[RPC] Target disposed. Total requests: ${this._requestCount}, errors: ${this._errorCount}`)
  }
}

// ============================================================================
// HTTP Handler
// ============================================================================

/**
 * Handle incoming HTTP requests.
 *
 * This is the main entry point for HTTP-triggered invocations.
 * Routes requests based on URL path and HTTP method.
 *
 * @param request - The incoming HTTP request
 * @param env - Environment bindings
 * @param ctx - Execution context for waitUntil, etc.
 * @returns HTTP response
 */
async function handleFetch(request: Request, env: Env, ctx: FunctionContext): Promise<Response> {
  const url = new URL(request.url)

  // Health check endpoint
  if (url.pathname === '/health' || url.pathname === '/_health') {
    return Response.json({ status: 'ok', timestamp: new Date().toISOString() })
  }

  // RPC endpoint for capnweb integration
  if (url.pathname === '/rpc' && request.method === 'POST') {
    return handleRpc(request, env, ctx)
  }

  // Greet endpoint
  if (url.pathname === '/greet') {
    if (request.method === 'GET') {
      const name = url.searchParams.get('name') || 'World'
      return Response.json({
        message: `Hello, ${name}!`,
        timestamp: new Date().toISOString(),
      } satisfies GreetResponse)
    }

    if (request.method === 'POST') {
      try {
        const body = (await request.json()) as GreetRequest
        return Response.json({
          message: `Hello, ${body.name}!`,
          timestamp: new Date().toISOString(),
        } satisfies GreetResponse)
      } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
      }
    }
  }

  // Math endpoints
  if (url.pathname === '/add' && request.method === 'GET') {
    const a = Number(url.searchParams.get('a') || 0)
    const b = Number(url.searchParams.get('b') || 0)
    return Response.json({
      operation: 'add',
      operands: [a, b],
      result: a + b,
    } satisfies MathResult)
  }

  if (url.pathname === '/multiply' && request.method === 'GET') {
    const a = Number(url.searchParams.get('a') || 0)
    const b = Number(url.searchParams.get('b') || 0)
    return Response.json({
      operation: 'multiply',
      operands: [a, b],
      result: a * b,
    } satisfies MathResult)
  }

  // Echo endpoint
  if (url.pathname === '/echo' && request.method === 'POST') {
    const body = await request.json()
    return Response.json(body)
  }

  // Metrics endpoint
  if (url.pathname === '/metrics') {
    const target = new MyFunctionTarget(env)
    return Response.json({
      function: '{{functionName}}',
      version: '0.1.0',
      metrics: target.getMetrics(),
    })
  }

  // Default: return function info
  if (url.pathname === '/') {
    return Response.json({
      name: '{{functionName}}',
      version: '0.1.0',
      endpoints: ['/health', '/greet', '/echo', '/add', '/multiply', '/rpc', '/metrics'],
      rpcMethods: ['greet', 'echo', 'getTime', 'add', 'multiply'],
    })
  }

  // 404 for unknown routes
  return Response.json({ error: 'Not found', path: url.pathname }, { status: 404 })
}

/**
 * RPC request body format
 */
interface RpcRequest {
  /** Method name to invoke */
  method: string
  /** Method parameters */
  params: unknown[]
  /** Optional request ID for correlation */
  id?: string
}

/**
 * RPC success response format
 */
interface RpcSuccessResponse {
  id?: string
  result: unknown
}

/**
 * RPC error response format
 */
interface RpcErrorResponse {
  id?: string
  error: string
  code: string
}

/**
 * Handle RPC requests using capnweb protocol.
 *
 * The RPC protocol follows JSON-RPC-like semantics:
 * - Request: { method: string, params: unknown[], id?: string }
 * - Success Response: { id?: string, result: unknown }
 * - Error Response: { id?: string, error: string, code: string }
 *
 * @param request - The incoming RPC request
 * @param env - Environment bindings
 * @param _ctx - Execution context
 * @returns RPC response
 */
async function handleRpc(request: Request, env: Env, _ctx: FunctionContext): Promise<Response> {
  let body: RpcRequest

  try {
    body = (await request.json()) as RpcRequest
  } catch {
    return Response.json(
      {
        error: 'Invalid JSON body',
        code: 'PARSE_ERROR',
      } satisfies RpcErrorResponse,
      { status: 400 }
    )
  }

  // Validate request
  if (!body.method || typeof body.method !== 'string') {
    return Response.json(
      {
        id: body.id,
        error: 'Missing or invalid method field',
        code: 'INVALID_REQUEST',
      } satisfies RpcErrorResponse,
      { status: 400 }
    )
  }

  if (!Array.isArray(body.params)) {
    body.params = body.params ? [body.params] : []
  }

  const target = new MyFunctionTarget(env)

  try {
    // Get the method from the target
    const method = (target as Record<string, unknown>)[body.method]

    if (typeof method !== 'function') {
      return Response.json(
        {
          id: body.id,
          error: `Method not found: ${body.method}`,
          code: 'METHOD_NOT_FOUND',
        } satisfies RpcErrorResponse,
        { status: 404 }
      )
    }

    // Validate method is allowed (exclude internal methods)
    const allowedMethods = ['greet', 'echo', 'getTime', 'add', 'multiply', 'getMetrics']
    if (!allowedMethods.includes(body.method)) {
      return Response.json(
        {
          id: body.id,
          error: `Method not allowed: ${body.method}`,
          code: 'METHOD_NOT_ALLOWED',
        } satisfies RpcErrorResponse,
        { status: 403 }
      )
    }

    // Call the method
    const result = await (method as Function).apply(target, body.params)

    return Response.json({
      id: body.id,
      result,
    } satisfies RpcSuccessResponse)
  } catch (error) {
    return Response.json(
      {
        id: body.id,
        error: error instanceof Error ? error.message : 'Internal error',
        code: 'INTERNAL_ERROR',
      } satisfies RpcErrorResponse,
      { status: 500 }
    )
  } finally {
    // Dispose of the target to clean up resources
    target[Symbol.dispose]()
  }
}

// ============================================================================
// Scheduled Handler (Optional)
// ============================================================================

/**
 * Handle scheduled/cron triggers.
 *
 * Uncomment and customize this handler to run code on a schedule.
 *
 * @param controller - Scheduled event controller
 * @param env - Environment bindings
 * @param ctx - Execution context
 */
// async function handleScheduled(
//   controller: ScheduledController,
//   env: Env,
//   ctx: FunctionContext
// ): Promise<void> {
//   console.log(`Scheduled event triggered at ${controller.scheduledTime}`)
//   // Add your scheduled task logic here
// }

// ============================================================================
// Queue Handler (Optional)
// ============================================================================

/**
 * Handle queue messages.
 *
 * Uncomment and customize this handler to process queue messages.
 *
 * @param batch - Batch of queue messages
 * @param env - Environment bindings
 * @param ctx - Execution context
 */
// async function handleQueue(
//   batch: MessageBatch<unknown>,
//   env: Env,
//   ctx: FunctionContext
// ): Promise<void> {
//   for (const message of batch.messages) {
//     console.log(`Processing message: ${JSON.stringify(message.body)}`)
//     // Add your message processing logic here
//     message.ack()
//   }
// }

// ============================================================================
// Export
// ============================================================================

/**
 * Main export for the Functions.do function.
 *
 * This object is the entry point for all triggers:
 * - fetch: HTTP requests
 * - scheduled: Cron triggers
 * - queue: Queue message processing
 */
export default createFunction<Env>({
  fetch: handleFetch,
  // Uncomment to enable scheduled triggers:
  // scheduled: handleScheduled,
  // Uncomment to enable queue processing:
  // queue: handleQueue,
})

// Export the RPC target for direct imports and service bindings
export { MyFunctionTarget }

// Export types for consumers
export type { GreetRequest, GreetResponse, MathResult, MyFunctionTargetMethods }
