/**
 * Functions.do API Module
 *
 * Exports all API handlers, middleware, executors, and utilities.
 */

// Router
export { createRouter, type Router, type Route, type Handler, type Middleware, type RouteContext, type Env } from './router'

// Handlers
export { healthHandler } from './handlers/health'
export { infoHandler } from './handlers/info'
export { invokeHandler, type InvokeHandlerContext } from './handlers/invoke'
export { deployHandler, type DeployHandlerContext } from './handlers/deploy'
export { deleteHandler } from './handlers/delete'
export { logsHandler } from './handlers/logs'

// Middleware
export {
  authMiddleware,
  createAuthMiddleware,
  type AuthMiddlewareConfig,
  type AuthMiddlewareResult,
  type AuthContext,
  type ApiKeyRecord,
} from './middleware/auth'

export {
  rateLimitMiddleware,
  createRateLimitMiddleware,
  type RateLimitMiddlewareConfig,
  type RateLimitResult,
  type RateLimitContext,
  type RateLimitConfig,
} from './middleware/rate-limit'

// Executors (real implementations in src/tiers/)
export { CodeExecutor } from '../tiers/code-executor'
export { GenerativeExecutor } from '../tiers/generative-executor'
export { AgenticExecutor } from '../tiers/agentic-executor'
export { HumanExecutor } from '../tiers/human-executor'
export { CascadeExecutor } from './executors/cascade'

// Validation
export { FunctionValidator } from './validation/function-validator'

// HTTP Utilities
export { jsonResponse } from './http-utils'

// Cache Metrics
export {
  recordCacheHit,
  recordCacheMiss,
  recordCacheError,
  getCacheStats,
  resetCacheStats,
  type CacheMetrics,
} from './cache-metrics'

// Caching Layer
export {
  CACHE_TTL_SECONDS,
  type CacheType,
  getCachedMetadata,
  cacheMetadata,
  getCachedCompiledCode,
  cacheCompiledCode,
  getCachedSourceCode,
  cacheSourceCode,
  invalidateFunctionCache,
} from './caching'
