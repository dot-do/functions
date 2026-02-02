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
import { listHandler } from './handlers/list'
import { updateHandler } from './handlers/update'
import { authValidateHandler, authMeHandler, authOrgsHandler } from './handlers/auth'
import { createAuthMiddleware, authMiddleware, AuthMiddlewareResult } from './middleware/auth'
import { createRateLimitMiddleware, rateLimitMiddleware, RateLimitResult } from './middleware/rate-limit'
import { createCSRFMiddleware, csrfMiddleware, generateCSRFToken, createCSRFCookie } from './middleware/csrf'
import { RateLimitConfig, InMemoryRateLimiter } from '../core/rate-limiter'
import { jsonResponse } from './http-utils'

/**
 * Re-export the unified Env type and supporting interfaces from src/core/env.ts.
 * This is the single source of truth for all environment bindings.
 */
export type { Env, EsbuildCompiler, AIClient, WorkersAI, OAuthServiceBinding } from '../core/env'
import type { Env } from '../core/env'

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
 * Auth context for authenticated requests (re-exported from auth middleware)
 */
export type { AuthContext } from './middleware/auth'
import type { AuthContext } from './middleware/auth'

/**
 * Sources for API version resolution, in priority order.
 */
export type ApiVersionSource = 'path' | 'query' | 'accept-version' | 'x-api-version' | 'default'

/**
 * Default API version when none is specified.
 */
export const DEFAULT_API_VERSION = 'v1'

/**
 * Route context passed to handlers
 */
export interface RouteContext {
  params: Record<string, string>
  functionId?: string
  version?: string
  /** The resolved API version (e.g. "v1") */
  apiVersion?: string
  /** How the API version was determined */
  apiVersionSource?: ApiVersionSource
  /** Authentication context when request is authenticated */
  authContext?: AuthContext
}

/**
 * Resolve the API version from the request.
 *
 * Priority order (highest to lowest):
 * 1. URL path prefix (e.g. /v1/api/functions)
 * 2. Query parameter (?version=v1)
 * 3. Accept-Version header
 * 4. X-API-Version header
 * 5. Default: "v1"
 */
export function resolveApiVersion(request: Request, path: string): { apiVersion: string; apiVersionSource: ApiVersionSource } {
  // 1. URL path prefix: match /v followed by digits at the start of the path
  const pathMatch = path.match(/^\/(v\d+)\//)
  if (pathMatch) {
    const version = pathMatch[1]
    if (version) {
      return { apiVersion: version, apiVersionSource: 'path' }
    }
  }

  // 2. Query parameter
  const url = new URL(request.url)
  const queryVersion = url.searchParams.get('version')
  if (queryVersion) {
    // Normalize: ensure it starts with 'v' if it's just a number
    const normalized = /^\d+$/.test(queryVersion) ? `v${queryVersion}` : queryVersion
    return { apiVersion: normalized, apiVersionSource: 'query' }
  }

  // 3. Accept-Version header
  const acceptVersion = request.headers.get('Accept-Version')
  if (acceptVersion) {
    const normalized = /^\d+$/.test(acceptVersion) ? `v${acceptVersion}` : acceptVersion
    return { apiVersion: normalized, apiVersionSource: 'accept-version' }
  }

  // 4. X-API-Version header
  const xApiVersion = request.headers.get('X-API-Version')
  if (xApiVersion) {
    const normalized = /^\d+$/.test(xApiVersion) ? `v${xApiVersion}` : xApiVersion
    return { apiVersion: normalized, apiVersionSource: 'x-api-version' }
  }

  // 5. Default
  return { apiVersion: DEFAULT_API_VERSION, apiVersionSource: 'default' }
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
  patch(pattern: string, ...args: (Middleware | Handler)[]): Router
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
  patch(pattern: string, ...args: (Middleware | Handler)[]): void
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
  let rateLimitConfig: { ip?: RateLimitConfig; function?: RateLimitConfig } | null = null
  let fallbackIpLimiter: InMemoryRateLimiter | null = null
  let fallbackFuncLimiter: InMemoryRateLimiter | null = null

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

    patch(pattern: string, ...args: (Middleware | Handler)[]): Router {
      const { handler, middleware } = parseRouteArgs('PATCH', pattern, args)
      routes.push({ method: 'PATCH', pattern, handler, middleware })
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
        patch(pattern: string, ...args: (Middleware | Handler)[]): void {
          router.patch(prefix + pattern, ...args)
        },
        delete(pattern: string, ...args: (Middleware | Handler)[]): void {
          router.delete(prefix + pattern, ...args)
        },
      }
      callback(group)
      return router
    },

    configureRateLimit(config: { ip?: RateLimitConfig; function?: RateLimitConfig }): void {
      rateLimitConfig = config
    },

    resetRateLimit(): void {
      rateLimitConfig = null
      fallbackIpLimiter = null
      fallbackFuncLimiter = null
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

        // Resolve API version from path, query, headers, or default
        const { apiVersion, apiVersionSource } = resolveApiVersion(request, path)
        context.apiVersion = apiVersion
        context.apiVersionSource = apiVersionSource

        // Check if this is a protected endpoint and run auth
        const isPublicEndpoint = ['/health', '/', '/api/status'].includes(path)

        if (!isPublicEndpoint && env.FUNCTIONS_API_KEYS) {
          // Auth middleware expects a generic record type for flexibility with different env shapes.
          // Env extends Record<string, unknown> so we can safely cast the known properties.
          const authEnv: Record<string, unknown> = {
            FUNCTIONS_API_KEYS: env.FUNCTIONS_API_KEYS,
            OAUTH: env.OAUTH,
          }
          const authResult = await authMiddleware(request, authEnv, ctx)
          if (!authResult.shouldContinue) {
            return authResult.response!
          }
          // Pass auth context to handlers
          if (authResult.authContext) {
            context.authContext = authResult.authContext
          }
        }

        // Apply rate limiting via Durable Object (distributed, persistent)
        if (!isPublicEndpoint && (rateLimitConfig || env.RATE_LIMITER)) {
          const ip = request.headers.get('CF-Connecting-IP') ||
                     request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
                     'unknown'

          if (env.RATE_LIMITER) {
            // Use the RateLimiterDO for distributed rate limiting
            const rateLimiterStub = env.RATE_LIMITER.get(
              env.RATE_LIMITER.idFromName(ip)
            )

            // Check IP rate limit
            const ipConfig = rateLimitConfig?.ip ?? { windowMs: 60_000, maxRequests: 100 }
            const ipResult = await rateLimiterStub.checkAndIncrement(
              `ip:${ip}`,
              ipConfig.maxRequests,
              ipConfig.windowMs
            )

            if (!ipResult.allowed) {
              const retryAfter = Math.ceil((ipResult.resetAt - Date.now()) / 1000)
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

            // Check function rate limit if applicable
            if (context.functionId && rateLimitConfig?.function) {
              const funcResult = await rateLimiterStub.checkAndIncrement(
                `fn:${context.functionId}`,
                rateLimitConfig.function.maxRequests,
                rateLimitConfig.function.windowMs
              )

              if (!funcResult.allowed) {
                const retryAfter = Math.ceil((funcResult.resetAt - Date.now()) / 1000)
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
          } else if (rateLimitConfig) {
            // Fallback: in-memory rate limiter (for tests / when DO not configured)
            if (!fallbackIpLimiter && rateLimitConfig.ip) {
              fallbackIpLimiter = new InMemoryRateLimiter(rateLimitConfig.ip)
            }
            if (fallbackIpLimiter) {
              const ipResult = await fallbackIpLimiter.check(`ip:${ip}`)
              if (!ipResult.allowed) {
                const retryAfter = Math.ceil((ipResult.resetAt - Date.now()) / 1000)
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
              await fallbackIpLimiter.increment(`ip:${ip}`)
            }

            if (context.functionId && rateLimitConfig.function) {
              if (!fallbackFuncLimiter) {
                fallbackFuncLimiter = new InMemoryRateLimiter(rateLimitConfig.function)
              }
              const funcResult = await fallbackFuncLimiter.check(`fn:${context.functionId}`)
              if (!funcResult.allowed) {
                const retryAfter = Math.ceil((funcResult.resetAt - Date.now()) / 1000)
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
              await fallbackFuncLimiter.increment(`fn:${context.functionId}`)
            }
          }
        }

        // Build middleware chain
        const allMiddleware = [...globalMiddleware, ...(matchedRoute.middleware || [])]

        const runHandler = async () => matchedRoute!.handler(request, env, ctx, context)

        let response: Response
        if (allMiddleware.length === 0) {
          response = await runHandler()
        } else {
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

          response = await next()
        }

        // Attach X-API-Version response header so clients know which version served the request
        if (!response.headers.has('X-API-Version')) {
          // Clone the response to add header (Response headers may be immutable)
          const newHeaders = new Headers(response.headers)
          newHeaders.set('X-API-Version', apiVersion)
          response = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
          })
        }

        return response
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

  // List all functions: GET /v1/api/functions
  router.get('/v1/api/functions', listHandler)

  // Deploy function: POST /v1/api/functions
  router.post('/v1/api/functions', deployHandler)

  // Function info: GET /v1/api/functions/:id
  router.get('/v1/api/functions/:id', infoHandler)

  // Update function metadata: PATCH /v1/api/functions/:id
  router.patch('/v1/api/functions/:id', updateHandler)

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

  // List all functions (legacy)
  router.get('/api/functions', listHandler)

  // Deploy function (legacy)
  router.post('/api/functions', deployHandler)

  // Function info (legacy)
  router.get('/api/functions/:id', infoHandler)

  // Update function metadata (legacy)
  router.patch('/api/functions/:id', updateHandler)

  // Delete function (legacy)
  router.delete('/api/functions/:id', deleteHandler)

  // Function logs (legacy)
  router.get('/functions/:id/logs', logsHandler)
  // Also keep the old /api/ path for backwards compat
  router.get('/api/functions/:id/logs', logsHandler)

  // Function info (legacy - GET /functions/:id for backward compatibility)
  router.get('/functions/:id', infoHandler)
  router.get('/functions/:id/info', infoHandler)

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

// Re-export CSRF utilities for use by consumers
export { createCSRFMiddleware, csrfMiddleware, generateCSRFToken, createCSRFCookie }
export type { CSRFMiddlewareConfig, CSRFMiddlewareResult, CSRFMiddleware } from './middleware/csrf'
