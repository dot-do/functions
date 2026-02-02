/**
 * API Router for Functions.do
 *
 * Provides routing, middleware chains, and request handling for the API.
 */

import { healthHandler } from './handlers/health'
import { deployHandler } from './handlers/deploy'
import { infoHandler } from './handlers/info'
import { invokeHandler } from './handlers/invoke'
import { deleteHandler } from './handlers/delete'
import { logsHandler } from './handlers/logs'
import { cascadeHandler } from './handlers/cascade'
import { authValidateHandler, authMeHandler, authOrgsHandler } from './handlers/auth'
import { createAuthMiddleware, authMiddleware, AuthMiddlewareResult } from './middleware/auth'
import { createRateLimitMiddleware, rateLimitMiddleware, RateLimitResult } from './middleware/rate-limit'
import { InMemoryRateLimiter, CompositeRateLimiter, RateLimitConfig } from '../core/rate-limiter'
import { jsonResponse } from './http-utils'

/**
 * esbuild-compiler RPC interface for TypeScript compilation via Service Binding.
 * See: workers/esbuild-compiler/src/types.ts
 */
export interface EsbuildCompiler {
  transform(options: {
    code: string
    loader: 'ts' | 'tsx' | 'js' | 'jsx'
    target?: string
    format?: 'esm' | 'cjs' | 'iife'
    jsx?: { factory?: string; fragment?: string }
    sourcemap?: boolean
  }): Promise<{
    code: string
    map?: string
    warnings: string[]
    errors?: string[]
  }>
}

/**
 * AI client interface for generative/agentic execution
 */
export interface AIClient {
  messages?: {
    create(params: unknown): Promise<{
      content: Array<{ type: string; text: string }>
      usage?: { input_tokens: number; output_tokens: number }
      stop_reason?: string
      model?: string
    }>
  }
  chat?: (request: unknown) => Promise<{
    content: string
    toolCalls?: Array<{ name: string; input: unknown }>
    stopReason: string
    tokens: { inputTokens: number; outputTokens: number; totalTokens: number }
  }>
}

/**
 * OAuth.do service binding interface for authentication.
 * See: src/core/oauth.ts for full type definitions.
 */
export interface OAuthServiceBinding {
  validateToken(token: string): Promise<{
    active: boolean
    sub: string
    clientId: string
    scopes: string[]
    exp: number
    iat: number
  } | null>
  getUserInfo(token: string): Promise<{
    id: string
    email?: string
    name?: string
    organizations?: Array<{
      organization: { id: string; name: string; slug: string }
      role: 'owner' | 'admin' | 'member' | 'viewer'
      joinedAt: string
    }>
  } | null>
  checkScopes(token: string, scopes: string[]): Promise<Record<string, boolean>>
  getOrganizations(token: string): Promise<Array<{ id: string; name: string; slug: string }> | null>
  checkPermission(token: string, resource: string, action: string): Promise<{
    allowed: boolean
    reason?: string
  }>
}

/**
 * Environment type for the API
 */
export interface Env {
  FUNCTIONS_REGISTRY: KVNamespace
  FUNCTIONS_CODE: KVNamespace
  FUNCTIONS_API_KEYS?: KVNamespace
  FUNCTION_LOGS?: DurableObjectNamespace
  LOADER?: unknown
  USER_FUNCTIONS?: unknown
  CLOUDFLARE_ACCOUNT_ID?: string
  CLOUDFLARE_API_TOKEN?: string
  DISPATCH_NAMESPACE?: string
  /** esbuild-wasm compiler service for TypeScript compilation */
  ESBUILD_COMPILER?: EsbuildCompiler
  /** AI client for generative/agentic cascade tiers */
  AI_CLIENT?: AIClient
  /** Durable Object for human task execution (cascade tier 4) */
  HUMAN_TASKS?: DurableObjectNamespace
  /** R2 bucket for code storage */
  CODE_STORAGE?: R2Bucket
  /** OAuth.do service binding for user authentication */
  OAUTH?: OAuthServiceBinding
}

/**
 * Handler function type
 */
export type Handler = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  context?: RouteContext
) => Promise<Response>

/**
 * Middleware function type
 */
export type Middleware = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  next: () => Promise<Response>
) => Promise<Response>

/**
 * Route context passed to handlers
 */
export interface RouteContext {
  params: Record<string, string>
  functionId?: string
  version?: string
}

/**
 * Route definition
 */
export interface Route {
  method: string
  pattern: string | RegExp
  handler: Handler
  middleware?: Middleware[]
}

/**
 * Router interface
 */
export interface Router {
  get(pattern: string, ...args: (Middleware | Handler)[]): Router
  post(pattern: string, ...args: (Middleware | Handler)[]): Router
  delete(pattern: string, ...args: (Middleware | Handler)[]): Router
  use(middleware: Middleware): Router
  handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
  group(prefix: string, callback: (group: RouterGroup) => void): Router
  configureRateLimit(config: { ip?: RateLimitConfig; function?: RateLimitConfig }): void
  resetRateLimit(): void
}

/**
 * Router group interface for prefix grouping
 */
export interface RouterGroup {
  get(pattern: string, ...args: (Middleware | Handler)[]): void
  post(pattern: string, ...args: (Middleware | Handler)[]): void
  delete(pattern: string, ...args: (Middleware | Handler)[]): void
}

/**
 * Parse route parameters from path and pattern
 */
function parseParams(pattern: string, path: string): Record<string, string> | null {
  const params: Record<string, string> = {}
  const patternParts = pattern.split('/').filter(Boolean)
  const pathParts = path.split('/').filter(Boolean)

  // Allow wildcard matching for patterns ending with *
  if (pattern.endsWith('*')) {
    const basePattern = pattern.slice(0, -2) // Remove /*
    if (path.startsWith(basePattern) || path === basePattern.slice(0, -1)) {
      return params
    }
  }

  if (patternParts.length !== pathParts.length) {
    return null
  }

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i]!
    const pathPart = pathParts[i]!

    if (patternPart.startsWith(':')) {
      const paramName = patternPart.slice(1)
      params[paramName] = pathPart
    } else if (patternPart !== pathPart) {
      return null
    }
  }

  return params
}

/**
 * Match a path against a pattern (string or RegExp)
 * @param pattern - The route pattern
 * @param routeMethod - The HTTP method for the route
 * @param requestMethod - The HTTP method from the request
 * @param path - The request path
 * @param ignoreMethod - If true, skip method check (for 405 detection)
 */
function matchPath(
  pattern: string | RegExp,
  routeMethod: string,
  requestMethod: string,
  path: string,
  ignoreMethod = false
): {
  match: boolean
  params: Record<string, string>
} {
  // Check method unless ignoreMethod is true
  if (!ignoreMethod && routeMethod !== requestMethod && routeMethod !== '*') {
    return { match: false, params: {} }
  }

  if (pattern instanceof RegExp) {
    const match = pattern.exec(path)
    if (match) {
      const params: Record<string, string> = {}
      match.slice(1).forEach((group, i) => {
        params[`$${i + 1}`] = group
      })
      return { match: true, params }
    }
    return { match: false, params: {} }
  }

  const params = parseParams(pattern, path)
  if (params !== null) {
    return { match: true, params }
  }

  return { match: false, params: {} }
}

/**
 * Parse route registration args into a validated handler and middleware list.
 * The last argument must be the handler; all preceding arguments are middleware.
 * Throws a descriptive error when the arguments are invalid.
 */
function parseRouteArgs(method: string, pattern: string, args: (Middleware | Handler)[]): { handler: Handler; middleware: Middleware[] } {
  if (args.length === 0) {
    throw new Error(`Route ${method} "${pattern}": a handler function is required as the last argument`)
  }
  const handler = args[args.length - 1]
  if (typeof handler !== 'function') {
    throw new Error(`Route ${method} "${pattern}": last argument must be a handler function, got ${typeof handler}`)
  }
  const middleware = args.slice(0, -1)
  for (let i = 0; i < middleware.length; i++) {
    if (typeof middleware[i] !== 'function') {
      throw new Error(`Route ${method} "${pattern}": middleware at index ${i} must be a function, got ${typeof middleware[i]}`)
    }
  }
  return { handler: handler as Handler, middleware: middleware as Middleware[] }
}

/**
 * Create a new router instance
 */
export function createRouter(): Router {
  const routes: Route[] = []
  const globalMiddleware: Middleware[] = []
  let rateLimiter: CompositeRateLimiter | null = null

  const router: Router = {
    get(pattern: string, ...args: (Middleware | Handler)[]): Router {
      const { handler, middleware } = parseRouteArgs('GET', pattern, args)
      routes.push({ method: 'GET', pattern, handler, middleware })
      return router
    },

    post(pattern: string, ...args: (Middleware | Handler)[]): Router {
      const { handler, middleware } = parseRouteArgs('POST', pattern, args)
      routes.push({ method: 'POST', pattern, handler, middleware })
      return router
    },

    delete(pattern: string, ...args: (Middleware | Handler)[]): Router {
      const { handler, middleware } = parseRouteArgs('DELETE', pattern, args)
      routes.push({ method: 'DELETE', pattern, handler, middleware })
      return router
    },

    use(middleware: Middleware): Router {
      globalMiddleware.push(middleware)
      return router
    },

    group(prefix: string, callback: (group: RouterGroup) => void): Router {
      const group: RouterGroup = {
        get(pattern: string, ...args: (Middleware | Handler)[]): void {
          router.get(prefix + pattern, ...args)
        },
        post(pattern: string, ...args: (Middleware | Handler)[]): void {
          router.post(prefix + pattern, ...args)
        },
        delete(pattern: string, ...args: (Middleware | Handler)[]): void {
          router.delete(prefix + pattern, ...args)
        },
      }
      callback(group)
      return router
    },

    configureRateLimit(config: { ip?: RateLimitConfig; function?: RateLimitConfig }): void {
      rateLimiter = new CompositeRateLimiter()
      if (config.ip) {
        rateLimiter.addLimiter('ip', new InMemoryRateLimiter(config.ip))
      }
      if (config.function) {
        rateLimiter.addLimiter('function', new InMemoryRateLimiter(config.function))
      }
    },

    resetRateLimit(): void {
      rateLimiter = null
    },

    async handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(request.url)
      const path = url.pathname
      const method = request.method.toUpperCase()

      // Get request ID for correlation
      const requestId = request.headers.get('X-Request-ID') || crypto.randomUUID()

      try {
        // Try to match a route
        let matchedRoute: Route | null = null
        let routeParams: Record<string, string> = {}

        for (const route of routes) {
          const { match, params } = matchPath(route.pattern, route.method, method, path)
          if (match) {
            matchedRoute = route
            routeParams = params
            break
          }
        }

        // Check for 405 - method not allowed (route exists but wrong method)
        if (!matchedRoute) {
          for (const route of routes) {
            const { match } = matchPath(route.pattern, route.method, method, path, true)
            if (match) {
              return jsonResponse(
                { error: `Method ${method} not allowed`, correlationId: requestId },
                405
              )
            }
          }

          // 404 - route not found
          return jsonResponse(
            { error: 'Not found', correlationId: requestId },
            404
          )
        }

        // Build context
        const context: RouteContext = {
          params: routeParams,
        }
        const functionId = routeParams['id'] || routeParams['functionId']
        if (functionId) {
          context.functionId = functionId
        }
        const version = url.searchParams.get('version')
        if (version) {
          context.version = version
        }

        // Check if this is a protected endpoint and run auth
        const isPublicEndpoint = ['/health', '/', '/api/status'].includes(path)

        if (!isPublicEndpoint && env.FUNCTIONS_API_KEYS) {
          const authResult = await authMiddleware(request, env as unknown as Record<string, unknown>, ctx)
          if (!authResult.shouldContinue) {
            return authResult.response!
          }
        }

        // Apply rate limiting if configured
        if (rateLimiter && !isPublicEndpoint) {
          const ip = request.headers.get('CF-Connecting-IP') ||
                     request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
                     'unknown'

          const keys: Record<string, string> = { ip }
          if (context.functionId) {
            keys['function'] = context.functionId
          }

          const rateLimitResult = await rateLimiter.checkAndIncrementAll(keys)
          if (!rateLimitResult.allowed) {
            const blockingResult = rateLimitResult.results[rateLimitResult.blockingCategory || 'ip']!
            const retryAfter = Math.ceil((blockingResult.resetAt - Date.now()) / 1000)
            return new Response(
              JSON.stringify({
                error: 'Too Many Requests',
                retryAfter,
                correlationId: requestId,
              }),
              {
                status: 429,
                headers: {
                  'Content-Type': 'application/json',
                  'Retry-After': String(retryAfter),
                },
              }
            )
          }
        }

        // Build middleware chain
        const allMiddleware = [...globalMiddleware, ...(matchedRoute.middleware || [])]

        const runHandler = async () => matchedRoute!.handler(request, env, ctx, context)

        if (allMiddleware.length === 0) {
          return await runHandler()
        }

        // Execute middleware chain
        let index = 0
        const next = async (): Promise<Response> => {
          if (index < allMiddleware.length) {
            const middleware = allMiddleware[index]!
            index++
            return middleware(request, env, ctx, next)
          }
          return runHandler()
        }

        return await next()
      } catch (error) {
        // Global error handler
        console.error('Router error:', error)
        const message = error instanceof Error ? error.message : 'Internal server error'
        return jsonResponse(
          {
            error: message,
            correlationId: requestId,
            requestId,
          },
          500
        )
      }
    },
  }

  // Register default routes
  // Health check endpoints (public, no versioning needed)
  router.get('/health', healthHandler)
  router.get('/', healthHandler)

  // ============================================================================
  // API v1 Routes (versioned endpoints)
  // ============================================================================

  // Deploy function: POST /v1/api/functions
  router.post('/v1/api/functions', deployHandler)

  // Function info: GET /v1/api/functions/:id
  router.get('/v1/api/functions/:id', infoHandler)

  // Delete function: DELETE /v1/api/functions/:id
  router.delete('/v1/api/functions/:id', deleteHandler)

  // Invoke function: POST /v1/functions/:id
  router.post('/v1/functions/:id', invokeHandler)

  // Invoke function (explicit): POST /v1/functions/:id/invoke
  router.post('/v1/functions/:id/invoke', invokeHandler)

  // Function logs: GET /v1/functions/:id/logs
  router.get('/v1/functions/:id/logs', logsHandler)

  // Cascade execution: POST /v1/cascade/:id
  router.post('/v1/cascade/:id', cascadeHandler)

  // ============================================================================
  // Legacy Routes (backwards compatibility)
  // These routes are maintained for backwards compatibility with existing clients.
  // New integrations should use the /v1/ prefixed endpoints.
  // ============================================================================

  // Deploy function (legacy)
  router.post('/api/functions', deployHandler)

  // Function info (legacy)
  router.get('/api/functions/:id', infoHandler)

  // Delete function (legacy)
  router.delete('/api/functions/:id', deleteHandler)

  // Function logs (legacy)
  router.get('/functions/:id/logs', logsHandler)
  // Also keep the old /api/ path for backwards compat
  router.get('/api/functions/:id/logs', logsHandler)

  // Invoke function (legacy)
  router.post('/functions/:id', invokeHandler)
  router.post('/functions/:id/invoke', invokeHandler)

  // Cascade execution (legacy)
  router.post('/cascade/:id', cascadeHandler)

  // ============================================================================
  // Auth Routes (OAuth.do integration)
  // ============================================================================

  // Validate current authentication: GET /v1/api/auth/validate
  router.get('/v1/api/auth/validate', authValidateHandler)

  // Get current user info: GET /v1/api/auth/me
  router.get('/v1/api/auth/me', authMeHandler)

  // Get user's organizations: GET /v1/api/auth/orgs
  router.get('/v1/api/auth/orgs', authOrgsHandler)

  // Legacy auth routes
  router.get('/api/auth/validate', authValidateHandler)
  router.get('/api/auth/me', authMeHandler)
  router.get('/api/auth/orgs', authOrgsHandler)

  return router
}
