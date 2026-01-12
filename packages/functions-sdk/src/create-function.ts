/**
 * createFunction - Factory for creating Functions.do serverless functions
 *
 * Provides a type-safe way to create function handlers with proper
 * typing for environment bindings and execution context.
 *
 * @module create-function
 */

/**
 * Base environment interface that all function environments extend
 */
export interface FunctionEnv {
  [key: string]: unknown
}

/**
 * Function execution context (maps to Cloudflare's ExecutionContext)
 */
export interface FunctionContext {
  /**
   * Extends the lifetime of the function to allow asynchronous tasks
   * to complete after the response has been sent.
   */
  waitUntil(promise: Promise<unknown>): void

  /**
   * Aborts the function execution with the given reason.
   */
  passThroughOnException?(): void
}

/**
 * Handler types for different function triggers
 */
export interface FunctionHandler<Env extends FunctionEnv = FunctionEnv> {
  /**
   * Handle incoming HTTP requests
   */
  fetch?(request: Request, env: Env, ctx: FunctionContext): Promise<Response>

  /**
   * Handle scheduled/cron triggers
   */
  scheduled?(controller: ScheduledController, env: Env, ctx: FunctionContext): Promise<void>

  /**
   * Handle queue messages
   */
  queue?(batch: MessageBatch<unknown>, env: Env, ctx: FunctionContext): Promise<void>

  /**
   * Handle email triggers (if enabled)
   */
  email?(message: EmailMessage, env: Env, ctx: FunctionContext): Promise<void>
}

/**
 * Email message interface (simplified)
 */
interface EmailMessage {
  readonly from: string
  readonly to: string
  readonly headers: Headers
  readonly raw: ReadableStream<Uint8Array>
  readonly rawSize: number
  setReject(reason: string): void
  forward(rcptTo: string, headers?: Headers): Promise<void>
  reply(message: EmailMessage): Promise<void>
}

/**
 * Function export type that matches Cloudflare Workers exports
 */
export interface FunctionExport<Env extends FunctionEnv = FunctionEnv> {
  fetch?: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>
  scheduled?: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => Promise<void>
  queue?: (batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext) => Promise<void>
}

/**
 * Create a type-safe Functions.do function handler.
 *
 * This factory function provides proper typing for environment bindings
 * and execution context, and ensures the exported object matches the
 * Cloudflare Workers API.
 *
 * @param handlers - Object containing handler functions for different triggers
 * @returns A function export object compatible with Cloudflare Workers
 *
 * @example
 * ```typescript
 * interface Env {
 *   MY_KV: KVNamespace;
 *   API_KEY: string;
 * }
 *
 * export default createFunction<Env>({
 *   async fetch(request, env, ctx) {
 *     const value = await env.MY_KV.get('key');
 *     return new Response(value);
 *   },
 *
 *   async scheduled(controller, env, ctx) {
 *     console.log('Cron triggered at:', controller.scheduledTime);
 *   },
 * });
 * ```
 */
export function createFunction<Env extends FunctionEnv = FunctionEnv>(
  handlers: FunctionHandler<Env>
): FunctionExport<Env> {
  const result: FunctionExport<Env> = {}

  if (handlers.fetch) {
    const fetchHandler = handlers.fetch
    result.fetch = async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
      const functionCtx: FunctionContext = {
        waitUntil: ctx.waitUntil.bind(ctx),
        passThroughOnException: ctx.passThroughOnException?.bind(ctx),
      }
      return fetchHandler(request, env, functionCtx)
    }
  }

  if (handlers.scheduled) {
    const scheduledHandler = handlers.scheduled
    result.scheduled = async (
      controller: ScheduledController,
      env: Env,
      ctx: ExecutionContext
    ): Promise<void> => {
      const functionCtx: FunctionContext = {
        waitUntil: ctx.waitUntil.bind(ctx),
        passThroughOnException: ctx.passThroughOnException?.bind(ctx),
      }
      return scheduledHandler(controller, env, functionCtx)
    }
  }

  if (handlers.queue) {
    const queueHandler = handlers.queue
    result.queue = async (
      batch: MessageBatch<unknown>,
      env: Env,
      ctx: ExecutionContext
    ): Promise<void> => {
      const functionCtx: FunctionContext = {
        waitUntil: ctx.waitUntil.bind(ctx),
        passThroughOnException: ctx.passThroughOnException?.bind(ctx),
      }
      return queueHandler(batch, env, functionCtx)
    }
  }

  return result
}
