/**
 * Configuration Module
 *
 * Centralized configuration for the Functions.do platform.
 * Import from this module to access all configuration constants.
 *
 * @module config
 */

export {
  // Tier timeouts
  TIER_TIMEOUTS,
  TIER_TIMEOUT_MAP,

  // Cache configuration
  CACHE,
  CODE_CACHE,
  GENERATIVE_CACHE,

  // Rate limiting
  RATE_LIMITS,

  // Loader & execution
  LOADER,
  RETRY,
  CIRCUIT_BREAKER,

  // Observability
  OBSERVABILITY,

  // Function target (RPC)
  FUNCTION_TARGET,
  FUNCTION_TARGET_LIMITS,

  // Size limits
  SIZE_LIMITS,

  // AI models
  AI_MODELS,

  // C# runtime
  CSHARP,

  // Public endpoints
  PUBLIC_ENDPOINTS,

  // Human executor
  HUMAN_EXECUTOR,

  // Request deduplication
  REQUEST_DEDUP,

  // Deterministic mode
  DETERMINISTIC,

  // Combined config object
  CONFIG,

  // Environment validation
  REQUIRED_ENV_BINDINGS,
  OPTIONAL_ENV_BINDINGS,
  validateEnvBindings,
  logMissingOptionalBindings,

  // Types
  type EnvValidationResult,
  type TierTimeouts,
  type CacheConfig,
  type RateLimitDefaults,
  type ConfigType,
} from './defaults'
