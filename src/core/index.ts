/**
 * Functions.do Core Module
 *
 * Core functionality for the Functions.do platform including:
 * - Function loading and caching
 * - Function registry and metadata storage
 * - Authentication and rate limiting
 * - Error handling
 * - Observability
 */

// Types
export * from './types'
export * from './errors'

// Function Loading
export { FunctionLoader, type IFunctionLoader, type LoadResult } from './function-loader'
export { WorkerLoader, type WorkerLoaderOptions, type WorkerStub } from './worker-loader'
export { FunctionTarget, type FunctionTargetOptions } from './function-target'

// Registry & Storage
// Throwing validators (legacy - use safe versions in new code)
export { FunctionRegistry, validateFunctionId, validateLanguage, validateEntryPoint, validateVersion, validateDependencies, validateMetadata } from './function-registry'
// Result-returning validators (preferred for new code)
export { validateFunctionIdSafe, validateLanguageSafe, validateEntryPointSafe, validateVersionSafe, validateDependenciesSafe, validateMetadataSafe } from './function-registry'
export { KVCodeStorage } from './code-storage'
export { KVFunctionRegistry } from './kv-function-registry'
export { KVApiKeyStore } from './kv-api-keys'
export { AssetStorage, AssetUploader, type AssetsBinding, type StoreWasmResult } from './asset-storage'

// Auth & Rate Limiting
export { authenticateRequest, isPublicEndpoint, DEFAULT_PUBLIC_ENDPOINTS, type AuthConfig, type AuthResult } from './auth'
export { CompositeRateLimiter, InMemoryRateLimiter, createDefaultRateLimiter, getClientIP, createRateLimitResponse, type RateLimitConfig, type RateLimiter, type RateLimitInfo } from './rate-limiter'

// Observability
export { MetricsCollector, MetricsExporter } from './metrics'
export { LogAggregator } from './log-aggregator'
export { DistributedTracer, TraceContext, W3CTraceContextPropagator, OpenTelemetryExporter, TraceExporter, SamplingConfig } from './distributed-tracing'

// Logging
export {
  createLogger,
  createLoggerFromEnv,
  getDefaultLogger,
  setDefaultLogger,
  getLogLevelFromEnv,
  getLogFormatFromEnv,
  noopLogger,
  NoopOutput,
  type Logger,
  type LoggerConfig,
  type LogContext,
  type LogEntry,
  type LogLevel,
  type LogOutput,
} from './logger'

// Analytics (Iceberg)
export * from './iceberg-analytics'

// Utilities
export { encodeULEB128, encodeSLEB128, encodeName, createSection } from './wasm-encoding'
export { stripTypeScript } from './ts-strip'
