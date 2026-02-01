/**
 * Centralized Configuration Defaults
 *
 * This module provides a single source of truth for all configuration constants
 * used throughout the Functions.do platform. Centralizing these values:
 *
 * 1. Makes configuration discoverable and documented
 * 2. Enables consistent behavior across the codebase
 * 3. Simplifies updating values without hunting through 15+ files
 * 4. Provides type-safe access to configuration
 *
 * @module config/defaults
 */

import { createLogger, type Logger } from '../core/logger'

// Module-level logger for configuration
const logger: Logger = createLogger({
  level: 'warn',
  context: { component: 'config' },
})

// =============================================================================
// TIER TIMEOUTS
// =============================================================================

/**
 * Default timeout values for each execution tier.
 * These define the maximum execution time for functions at each tier level.
 */
export const TIER_TIMEOUTS = {
  /** Tier 1: Code execution - 5 seconds */
  CODE_MS: 5000,
  /** Tier 2: Generative AI calls - 30 seconds */
  GENERATIVE_MS: 30000,
  /** Tier 3: Agentic multi-step execution - 5 minutes */
  AGENTIC_MS: 300000,
  /** Tier 4: Human-in-the-loop - 24 hours */
  HUMAN_MS: 86400000,
} as const

/**
 * Tier timeout map by tier number (for tier-dispatcher compatibility)
 */
export const TIER_TIMEOUT_MAP: Record<1 | 2 | 3 | 4, number> = {
  1: TIER_TIMEOUTS.CODE_MS,
  2: TIER_TIMEOUTS.GENERATIVE_MS,
  3: TIER_TIMEOUTS.AGENTIC_MS,
  4: TIER_TIMEOUTS.HUMAN_MS,
}

// =============================================================================
// CACHE CONFIGURATION
// =============================================================================

/**
 * Cache configuration defaults for various caching layers.
 */
export const CACHE = {
  /** Default maximum number of entries in LRU caches */
  DEFAULT_MAX_SIZE: 1000,
  /** Default TTL for cache entries - 1 hour */
  DEFAULT_TTL_MS: 3600000,
  /** Maximum latency samples to keep for percentile calculations */
  MAX_METRICS_SAMPLES: 1000,
} as const

/**
 * Compiled code cache configuration for CodeExecutor
 */
export const CODE_CACHE = {
  /** Maximum number of compiled code entries */
  MAX_SIZE: 1000,
  /** TTL for compiled code entries - 1 hour */
  TTL_MS: 3600000,
} as const

/**
 * Generative executor cache configuration
 */
export const GENERATIVE_CACHE = {
  /** Maximum number of cached AI responses */
  MAX_SIZE: 1000,
  /** Default TTL for cached responses - 1 hour (in seconds for API compatibility) */
  DEFAULT_TTL_SECONDS: 3600,
  /** Interval for stale entry cleanup - disabled by default (0 = no cleanup) */
  STALE_CLEANUP_INTERVAL_MS: 0,
} as const

// =============================================================================
// RATE LIMITING
// =============================================================================

/**
 * Default rate limit configurations for different scopes.
 */
export const RATE_LIMITS = {
  /** Per-IP rate limit */
  IP: {
    /** Time window - 1 minute */
    WINDOW_MS: 60000,
    /** Maximum requests per window */
    MAX_REQUESTS: 100,
  },
  /** Per-function rate limit */
  FUNCTION: {
    /** Time window - 1 minute */
    WINDOW_MS: 60000,
    /** Maximum requests per window */
    MAX_REQUESTS: 1000,
  },
} as const

// =============================================================================
// LOADER & EXECUTION CONFIGURATION
// =============================================================================

/**
 * Function loader configuration defaults.
 */
export const LOADER = {
  /** Default execution timeout - 30 seconds */
  DEFAULT_TIMEOUT_MS: 30000,
  /** Maximum cache size for loaded functions */
  MAX_CACHE_SIZE: 1000,
  /** Default cache TTL (0 = no expiry) */
  DEFAULT_CACHE_TTL_MS: 0,
} as const

/**
 * Retry configuration defaults for function loading.
 */
export const RETRY = {
  /** Maximum number of retry attempts */
  MAX_RETRIES: 3,
  /** Initial delay before first retry */
  INITIAL_DELAY_MS: 100,
  /** Maximum delay between retries */
  MAX_DELAY_MS: 5000,
  /** Backoff multiplier for exponential backoff */
  BACKOFF_MULTIPLIER: 2,
  /** Whether to add jitter to retry delays */
  JITTER_ENABLED: true,
} as const

/**
 * Circuit breaker configuration defaults.
 */
export const CIRCUIT_BREAKER = {
  /** Number of failures before opening the circuit */
  FAILURE_THRESHOLD: 5,
  /** Time before attempting to close an open circuit - 30 seconds */
  RESET_TIMEOUT_MS: 30000,
  /** Number of successes in half-open state to close circuit */
  SUCCESS_THRESHOLD: 2,
  /** Maximum concurrent test requests in half-open state */
  MAX_HALF_OPEN_REQUESTS: 1,
} as const

// =============================================================================
// OBSERVABILITY CONFIGURATION
// =============================================================================

/**
 * Observability and tracing configuration defaults.
 */
export const OBSERVABILITY = {
  /** Default service name for spans */
  DEFAULT_SERVICE_NAME: 'functions-do',
  /** Default sample rate (1.0 = 100%) */
  DEFAULT_SAMPLE_RATE: 1.0,
  /** Maximum spans to buffer before auto-flush */
  BUFFER_SIZE: 100,
  /** Interval for auto-flushing buffered spans - 5 seconds */
  FLUSH_INTERVAL_MS: 5000,
  /** Timeout for export requests - 30 seconds */
  EXPORT_TIMEOUT_MS: 30000,
} as const

// =============================================================================
// FUNCTION TARGET CONFIGURATION
// =============================================================================

/**
 * FunctionTarget (RPC wrapper) configuration defaults.
 */
export const FUNCTION_TARGET = {
  /** Default RPC timeout - 30 seconds */
  TIMEOUT_MS: 30000,
  /** Default number of retries */
  RETRIES: 0,
  /** Default serialization format */
  SERIALIZER: 'json' as const,
  /** Default base URL for RPC requests */
  BASE_URL: 'https://rpc.local/',
  /** Enable request deduplication */
  ENABLE_DEDUPLICATION: true,
  /** TTL for deduplication cache */
  DEDUPLICATION_TTL_MS: 100,
  /** Enable automatic batching */
  ENABLE_BATCHING: true,
  /** Maximum time to wait for batching more requests */
  BATCH_WINDOW_MS: 5,
  /** Maximum requests to batch together */
  MAX_BATCH_SIZE: 50,
  /** Enable performance metrics collection */
  ENABLE_METRICS: true,
} as const

/**
 * Memory safety limits for FunctionTarget.
 */
export const FUNCTION_TARGET_LIMITS = {
  /** Maximum in-flight requests */
  MAX_IN_FLIGHT_REQUESTS: 10000,
  /** Maximum pending batch size */
  MAX_PENDING_BATCH: 10000,
  /** Threshold for stale request cleanup - 1 minute */
  STALE_REQUEST_THRESHOLD_MS: 60000,
  /** Interval for cleaning up stale requests - 30 seconds */
  CLEANUP_INTERVAL_MS: 30000,
  /** Warn at this percentage of capacity */
  WARN_THRESHOLD_PERCENT: 0.8,
} as const

// =============================================================================
// CODE SIZE & LIMITS
// =============================================================================

/**
 * Size limits for code and payloads.
 */
export const SIZE_LIMITS = {
  /** Maximum code size - 25 MB */
  MAX_CODE_SIZE_BYTES: 25 * 1024 * 1024,
  /** Maximum request body size - 10 MB */
  MAX_REQUEST_BODY_BYTES: 10 * 1024 * 1024,
  /** Maximum response body size - 10 MB */
  MAX_RESPONSE_BODY_BYTES: 10 * 1024 * 1024,
} as const

// =============================================================================
// AI MODEL DEFAULTS
// =============================================================================

/**
 * Default AI model configurations.
 */
export const AI_MODELS = {
  /** Default model for generative tier */
  DEFAULT_GENERATIVE_MODEL: 'claude-3-sonnet',
  /** Default model for agentic tier */
  DEFAULT_AGENTIC_MODEL: 'claude-3-opus',
  /** Default max tokens for AI responses */
  DEFAULT_MAX_TOKENS: 4096,
  /** Default temperature for AI calls */
  DEFAULT_TEMPERATURE: 0,
  /** Default max iterations for agentic loops */
  DEFAULT_MAX_ITERATIONS: 10,
} as const

// =============================================================================
// CSHARP RUNTIME CONFIGURATION
// =============================================================================

/**
 * C# runtime and security configuration defaults.
 */
export const CSHARP = {
  /** Default CPU timeout - 30 seconds */
  CPU_TIMEOUT_MS: 30000,
  /** Default idle timeout for runtime - 30 seconds */
  IDLE_TIMEOUT_MS: 30000,
  /** Default execution timeout - 30 seconds */
  EXECUTION_TIMEOUT_MS: 30000,
} as const

// =============================================================================
// HUMAN EXECUTOR CONFIGURATION
// =============================================================================

/**
 * Human executor (Tier 4) configuration defaults.
 */
export const HUMAN_EXECUTOR = {
  /** Default task expiration - 1 hour */
  DEFAULT_EXPIRATION_MS: 3600000,
  /** Maximum task expiration - 24 hours */
  MAX_EXPIRATION_MS: 86400000,
  /** Default reminder interval - 1 hour */
  REMINDER_INTERVAL_MS: 3600000,
} as const

// =============================================================================
// DETERMINISTIC MODE
// =============================================================================

/**
 * Fixed values for deterministic execution mode.
 */
export const DETERMINISTIC = {
  /** Fixed random seed value */
  RANDOM_SEED: 0.5,
  /** Fixed date value (2024-01-01T00:00:00.000Z) */
  FIXED_DATE_MS: 1704067200000,
} as const

// =============================================================================
// COMBINED CONFIG OBJECT
// =============================================================================

/**
 * Combined configuration object for convenient access.
 * Use this when you need multiple configuration categories.
 *
 * @example
 * ```typescript
 * import { CONFIG } from './config/defaults'
 *
 * const timeout = CONFIG.timeouts.code
 * const cacheSize = CONFIG.cache.maxSize
 * ```
 */
export const CONFIG = {
  timeouts: {
    code: TIER_TIMEOUTS.CODE_MS,
    generative: TIER_TIMEOUTS.GENERATIVE_MS,
    agentic: TIER_TIMEOUTS.AGENTIC_MS,
    human: TIER_TIMEOUTS.HUMAN_MS,
  },
  cache: {
    maxSize: CACHE.DEFAULT_MAX_SIZE,
    ttlMs: CACHE.DEFAULT_TTL_MS,
    maxMetricsSamples: CACHE.MAX_METRICS_SAMPLES,
  },
  limits: {
    maxCodeSize: SIZE_LIMITS.MAX_CODE_SIZE_BYTES,
    maxRequestBody: SIZE_LIMITS.MAX_REQUEST_BODY_BYTES,
    maxResponseBody: SIZE_LIMITS.MAX_RESPONSE_BODY_BYTES,
    maxInFlightRequests: FUNCTION_TARGET_LIMITS.MAX_IN_FLIGHT_REQUESTS,
  },
  rateLimits: {
    ip: {
      windowMs: RATE_LIMITS.IP.WINDOW_MS,
      maxRequests: RATE_LIMITS.IP.MAX_REQUESTS,
    },
    function: {
      windowMs: RATE_LIMITS.FUNCTION.WINDOW_MS,
      maxRequests: RATE_LIMITS.FUNCTION.MAX_REQUESTS,
    },
  },
  retry: {
    maxRetries: RETRY.MAX_RETRIES,
    initialDelayMs: RETRY.INITIAL_DELAY_MS,
    maxDelayMs: RETRY.MAX_DELAY_MS,
    backoffMultiplier: RETRY.BACKOFF_MULTIPLIER,
    jitter: RETRY.JITTER_ENABLED,
  },
  circuitBreaker: {
    failureThreshold: CIRCUIT_BREAKER.FAILURE_THRESHOLD,
    resetTimeoutMs: CIRCUIT_BREAKER.RESET_TIMEOUT_MS,
    successThreshold: CIRCUIT_BREAKER.SUCCESS_THRESHOLD,
    maxHalfOpenRequests: CIRCUIT_BREAKER.MAX_HALF_OPEN_REQUESTS,
  },
  observability: {
    flushIntervalMs: OBSERVABILITY.FLUSH_INTERVAL_MS,
    exportTimeoutMs: OBSERVABILITY.EXPORT_TIMEOUT_MS,
    bufferSize: OBSERVABILITY.BUFFER_SIZE,
    sampleRate: OBSERVABILITY.DEFAULT_SAMPLE_RATE,
  },
  ai: {
    defaultGenerativeModel: AI_MODELS.DEFAULT_GENERATIVE_MODEL,
    defaultAgenticModel: AI_MODELS.DEFAULT_AGENTIC_MODEL,
    defaultMaxTokens: AI_MODELS.DEFAULT_MAX_TOKENS,
    defaultTemperature: AI_MODELS.DEFAULT_TEMPERATURE,
    defaultMaxIterations: AI_MODELS.DEFAULT_MAX_ITERATIONS,
  },
} as const

// =============================================================================
// ENV BINDING VALIDATION
// =============================================================================

/**
 * Required environment bindings for the Functions.do platform.
 * Use validateEnvBindings() at startup to ensure all required bindings are present.
 */
export const REQUIRED_ENV_BINDINGS = {
  /** KV namespace for function registry */
  FUNCTIONS_REGISTRY: 'KVNamespace',
  /** KV namespace for code storage */
  FUNCTIONS_CODE: 'KVNamespace',
} as const

/**
 * Optional environment bindings that enable additional features.
 */
export const OPTIONAL_ENV_BINDINGS = {
  /** R2 bucket for code storage (alternative to KV) */
  CODE_STORAGE: 'R2Bucket',
  /** Durable Object for human tasks */
  HUMAN_TASKS: 'DurableObjectNamespace',
  /** Worker loader for code execution */
  LOADER: 'Fetcher',
  /** AI client for generative/agentic execution */
  AI_CLIENT: 'AIClient',
  /** Rate limiter Durable Object */
  RATE_LIMITER: 'DurableObjectNamespace',
  /** Static assets for WASM binaries */
  ASSETS: 'Fetcher',
  /** Observability endpoint */
  OBSERVABILITY_ENDPOINT: 'string',
  /** Observability API key */
  OBSERVABILITY_API_KEY: 'string',
} as const

/**
 * Result of environment binding validation.
 */
export interface EnvValidationResult {
  /** Whether all required bindings are present */
  valid: boolean
  /** List of missing required bindings */
  missingRequired: string[]
  /** List of missing optional bindings (informational) */
  missingOptional: string[]
  /** List of present bindings */
  presentBindings: string[]
}

/**
 * Validate that required environment bindings are present.
 * Call this at application startup to catch configuration errors early.
 *
 * @param env - The environment object to validate
 * @returns Validation result with details about missing bindings
 *
 * @example
 * ```typescript
 * import { validateEnvBindings } from './config/defaults'
 *
 * export default {
 *   async fetch(request: Request, env: Env): Promise<Response> {
 *     const validation = validateEnvBindings(env)
 *     if (!validation.valid) {
 *       console.error('Missing required bindings:', validation.missingRequired)
 *       return new Response('Service misconfigured', { status: 503 })
 *     }
 *     // ... rest of handler
 *   }
 * }
 * ```
 */
export function validateEnvBindings(env: Record<string, unknown>): EnvValidationResult {
  const missingRequired: string[] = []
  const missingOptional: string[] = []
  const presentBindings: string[] = []

  // Check required bindings
  for (const binding of Object.keys(REQUIRED_ENV_BINDINGS)) {
    if (env[binding] !== undefined && env[binding] !== null) {
      presentBindings.push(binding)
    } else {
      missingRequired.push(binding)
    }
  }

  // Check optional bindings
  for (const binding of Object.keys(OPTIONAL_ENV_BINDINGS)) {
    if (env[binding] !== undefined && env[binding] !== null) {
      presentBindings.push(binding)
    } else {
      missingOptional.push(binding)
    }
  }

  return {
    valid: missingRequired.length === 0,
    missingRequired,
    missingOptional,
    presentBindings,
  }
}

/**
 * Log a warning for missing optional bindings.
 * Useful for debugging feature availability.
 *
 * @param result - The validation result from validateEnvBindings
 */
export function logMissingOptionalBindings(result: EnvValidationResult): void {
  if (result.missingOptional.length > 0) {
    logger.warn('Optional bindings not configured, some features may be unavailable', {
      missingBindings: result.missingOptional,
    })
  }
}

// =============================================================================
// TYPE EXPORTS
// =============================================================================

/** Type for tier timeout configuration */
export type TierTimeouts = typeof TIER_TIMEOUTS

/** Type for cache configuration */
export type CacheConfig = typeof CACHE

/** Type for rate limit configuration */
export type RateLimitDefaults = typeof RATE_LIMITS

/** Type for the combined CONFIG object */
export type ConfigType = typeof CONFIG
