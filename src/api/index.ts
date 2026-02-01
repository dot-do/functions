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

// Executors
export { CodeExecutor, type CodeExecutionResult } from './executors/code'
export { GenerativeExecutor, type GenerativeExecutionResult, type GenerativeFunctionMetadata } from './executors/generative'
export { AgenticExecutor, type AgenticExecutionResult, type AgenticFunctionMetadata } from './executors/agentic'
export { HumanExecutor, type HumanExecutionResult, type HumanFunctionMetadata } from './executors/human'
export { CascadeExecutor, type CascadeExecutionResult, type CascadeFunctionMetadata, type CascadeStep } from './executors/cascade'

// Validation
export { FunctionValidator } from './validation/function-validator'

// HTTP Utilities
export { jsonResponse } from './http-utils'
