/**
 * Configuration Defaults Tests
 *
 * Tests for the centralized configuration defaults module.
 * Verifies that all exported constants have correct values, proper structure,
 * and that the validateEnvBindings and logMissingOptionalBindings functions
 * work correctly.
 *
 * @module config/__tests__/defaults.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  TIER_TIMEOUTS,
  TIER_TIMEOUT_MAP,
  CACHE,
  CLASSIFIER_CACHE,
  CODE_CACHE,
  GENERATIVE_CACHE,
  RATE_LIMITS,
  LOADER,
  RETRY,
  CIRCUIT_BREAKER,
  OBSERVABILITY,
  FUNCTION_TARGET,
  FUNCTION_TARGET_LIMITS,
  SIZE_LIMITS,
  AI_MODELS,
  CSHARP,
  HUMAN_EXECUTOR,
  DETERMINISTIC,
  PUBLIC_ENDPOINTS,
  INVOKE,
  CONFIG,
  REQUIRED_ENV_BINDINGS,
  OPTIONAL_ENV_BINDINGS,
  validateEnvBindings,
  logMissingOptionalBindings,
  type EnvValidationResult,
} from '../defaults'

// =============================================================================
// TIER TIMEOUTS
// =============================================================================

describe('config/defaults', () => {
  describe('TIER_TIMEOUTS', () => {
    it('should define code tier timeout as 5 seconds', () => {
      expect(TIER_TIMEOUTS.CODE_MS).toBe(5000)
    })

    it('should define generative tier timeout as 30 seconds', () => {
      expect(TIER_TIMEOUTS.GENERATIVE_MS).toBe(30000)
    })

    it('should define agentic tier timeout as 5 minutes', () => {
      expect(TIER_TIMEOUTS.AGENTIC_MS).toBe(300000)
    })

    it('should define human tier timeout as 24 hours', () => {
      expect(TIER_TIMEOUTS.HUMAN_MS).toBe(86400000)
    })

    it('should have increasing timeouts from code to human', () => {
      expect(TIER_TIMEOUTS.CODE_MS).toBeLessThan(TIER_TIMEOUTS.GENERATIVE_MS)
      expect(TIER_TIMEOUTS.GENERATIVE_MS).toBeLessThan(TIER_TIMEOUTS.AGENTIC_MS)
      expect(TIER_TIMEOUTS.AGENTIC_MS).toBeLessThan(TIER_TIMEOUTS.HUMAN_MS)
    })
  })

  describe('TIER_TIMEOUT_MAP', () => {
    it('should map tier 1 to CODE_MS', () => {
      expect(TIER_TIMEOUT_MAP[1]).toBe(TIER_TIMEOUTS.CODE_MS)
    })

    it('should map tier 2 to GENERATIVE_MS', () => {
      expect(TIER_TIMEOUT_MAP[2]).toBe(TIER_TIMEOUTS.GENERATIVE_MS)
    })

    it('should map tier 3 to AGENTIC_MS', () => {
      expect(TIER_TIMEOUT_MAP[3]).toBe(TIER_TIMEOUTS.AGENTIC_MS)
    })

    it('should map tier 4 to HUMAN_MS', () => {
      expect(TIER_TIMEOUT_MAP[4]).toBe(TIER_TIMEOUTS.HUMAN_MS)
    })
  })

  // =============================================================================
  // CACHE CONFIGURATION
  // =============================================================================

  describe('CACHE', () => {
    it('should define DEFAULT_MAX_SIZE as 1000', () => {
      expect(CACHE.DEFAULT_MAX_SIZE).toBe(1000)
    })

    it('should define DEFAULT_TTL_MS as 1 hour', () => {
      expect(CACHE.DEFAULT_TTL_MS).toBe(3600000)
    })

    it('should define MAX_METRICS_SAMPLES as 1000', () => {
      expect(CACHE.MAX_METRICS_SAMPLES).toBe(1000)
    })
  })

  describe('CLASSIFIER_CACHE', () => {
    it('should define MAX_SIZE as 1000', () => {
      expect(CLASSIFIER_CACHE.MAX_SIZE).toBe(1000)
    })

    it('should define TTL_MS as 1 hour', () => {
      expect(CLASSIFIER_CACHE.TTL_MS).toBe(3600000)
    })
  })

  describe('CODE_CACHE', () => {
    it('should define MAX_SIZE as 1000', () => {
      expect(CODE_CACHE.MAX_SIZE).toBe(1000)
    })

    it('should define TTL_MS as 1 hour', () => {
      expect(CODE_CACHE.TTL_MS).toBe(3600000)
    })
  })

  describe('GENERATIVE_CACHE', () => {
    it('should define MAX_SIZE as 1000', () => {
      expect(GENERATIVE_CACHE.MAX_SIZE).toBe(1000)
    })

    it('should define DEFAULT_TTL_SECONDS as 3600', () => {
      expect(GENERATIVE_CACHE.DEFAULT_TTL_SECONDS).toBe(3600)
    })

    it('should define STALE_CLEANUP_INTERVAL_MS as 0 (disabled)', () => {
      expect(GENERATIVE_CACHE.STALE_CLEANUP_INTERVAL_MS).toBe(0)
    })
  })

  // =============================================================================
  // RATE LIMITS
  // =============================================================================

  describe('RATE_LIMITS', () => {
    it('should define IP rate limit window as 1 minute', () => {
      expect(RATE_LIMITS.IP.WINDOW_MS).toBe(60000)
    })

    it('should define IP max requests as 100', () => {
      expect(RATE_LIMITS.IP.MAX_REQUESTS).toBe(100)
    })

    it('should define function rate limit window as 1 minute', () => {
      expect(RATE_LIMITS.FUNCTION.WINDOW_MS).toBe(60000)
    })

    it('should define function max requests as 1000', () => {
      expect(RATE_LIMITS.FUNCTION.MAX_REQUESTS).toBe(1000)
    })

    it('should allow more function requests than IP requests', () => {
      expect(RATE_LIMITS.FUNCTION.MAX_REQUESTS).toBeGreaterThan(RATE_LIMITS.IP.MAX_REQUESTS)
    })
  })

  // =============================================================================
  // LOADER & EXECUTION
  // =============================================================================

  describe('LOADER', () => {
    it('should define DEFAULT_TIMEOUT_MS as 30 seconds', () => {
      expect(LOADER.DEFAULT_TIMEOUT_MS).toBe(30000)
    })

    it('should define MAX_CACHE_SIZE as 1000', () => {
      expect(LOADER.MAX_CACHE_SIZE).toBe(1000)
    })

    it('should define DEFAULT_CACHE_TTL_MS as 0 (no expiry)', () => {
      expect(LOADER.DEFAULT_CACHE_TTL_MS).toBe(0)
    })
  })

  describe('RETRY', () => {
    it('should define MAX_RETRIES as 3', () => {
      expect(RETRY.MAX_RETRIES).toBe(3)
    })

    it('should define INITIAL_DELAY_MS as 100', () => {
      expect(RETRY.INITIAL_DELAY_MS).toBe(100)
    })

    it('should define MAX_DELAY_MS as 5000', () => {
      expect(RETRY.MAX_DELAY_MS).toBe(5000)
    })

    it('should define BACKOFF_MULTIPLIER as 2', () => {
      expect(RETRY.BACKOFF_MULTIPLIER).toBe(2)
    })

    it('should enable jitter by default', () => {
      expect(RETRY.JITTER_ENABLED).toBe(true)
    })
  })

  describe('CIRCUIT_BREAKER', () => {
    it('should define FAILURE_THRESHOLD as 5', () => {
      expect(CIRCUIT_BREAKER.FAILURE_THRESHOLD).toBe(5)
    })

    it('should define RESET_TIMEOUT_MS as 30 seconds', () => {
      expect(CIRCUIT_BREAKER.RESET_TIMEOUT_MS).toBe(30000)
    })

    it('should define SUCCESS_THRESHOLD as 2', () => {
      expect(CIRCUIT_BREAKER.SUCCESS_THRESHOLD).toBe(2)
    })

    it('should define MAX_HALF_OPEN_REQUESTS as 1', () => {
      expect(CIRCUIT_BREAKER.MAX_HALF_OPEN_REQUESTS).toBe(1)
    })
  })

  // =============================================================================
  // OBSERVABILITY
  // =============================================================================

  describe('OBSERVABILITY', () => {
    it('should define DEFAULT_SERVICE_NAME as functions-do', () => {
      expect(OBSERVABILITY.DEFAULT_SERVICE_NAME).toBe('functions-do')
    })

    it('should define DEFAULT_SAMPLE_RATE as 1.0 (100%)', () => {
      expect(OBSERVABILITY.DEFAULT_SAMPLE_RATE).toBe(1.0)
    })

    it('should define BUFFER_SIZE as 100', () => {
      expect(OBSERVABILITY.BUFFER_SIZE).toBe(100)
    })

    it('should define FLUSH_INTERVAL_MS as 5 seconds', () => {
      expect(OBSERVABILITY.FLUSH_INTERVAL_MS).toBe(5000)
    })

    it('should define EXPORT_TIMEOUT_MS as 30 seconds', () => {
      expect(OBSERVABILITY.EXPORT_TIMEOUT_MS).toBe(30000)
    })
  })

  // =============================================================================
  // FUNCTION TARGET
  // =============================================================================

  describe('FUNCTION_TARGET', () => {
    it('should define TIMEOUT_MS as 30 seconds', () => {
      expect(FUNCTION_TARGET.TIMEOUT_MS).toBe(30000)
    })

    it('should define RETRIES as 0', () => {
      expect(FUNCTION_TARGET.RETRIES).toBe(0)
    })

    it('should define SERIALIZER as json', () => {
      expect(FUNCTION_TARGET.SERIALIZER).toBe('json')
    })

    it('should define BASE_URL as https://rpc.local/', () => {
      expect(FUNCTION_TARGET.BASE_URL).toBe('https://rpc.local/')
    })

    it('should enable deduplication by default', () => {
      expect(FUNCTION_TARGET.ENABLE_DEDUPLICATION).toBe(true)
    })

    it('should enable batching by default', () => {
      expect(FUNCTION_TARGET.ENABLE_BATCHING).toBe(true)
    })

    it('should enable metrics by default', () => {
      expect(FUNCTION_TARGET.ENABLE_METRICS).toBe(true)
    })

    it('should define MAX_BATCH_SIZE as 50', () => {
      expect(FUNCTION_TARGET.MAX_BATCH_SIZE).toBe(50)
    })
  })

  describe('FUNCTION_TARGET_LIMITS', () => {
    it('should define MAX_IN_FLIGHT_REQUESTS as 10000', () => {
      expect(FUNCTION_TARGET_LIMITS.MAX_IN_FLIGHT_REQUESTS).toBe(10000)
    })

    it('should define WARN_THRESHOLD_PERCENT as 0.8', () => {
      expect(FUNCTION_TARGET_LIMITS.WARN_THRESHOLD_PERCENT).toBe(0.8)
    })
  })

  // =============================================================================
  // SIZE LIMITS
  // =============================================================================

  describe('SIZE_LIMITS', () => {
    it('should define MAX_CODE_SIZE_BYTES as 25 MB', () => {
      expect(SIZE_LIMITS.MAX_CODE_SIZE_BYTES).toBe(25 * 1024 * 1024)
    })

    it('should define MAX_REQUEST_BODY_BYTES as 10 MB', () => {
      expect(SIZE_LIMITS.MAX_REQUEST_BODY_BYTES).toBe(10 * 1024 * 1024)
    })

    it('should define MAX_RESPONSE_BODY_BYTES as 10 MB', () => {
      expect(SIZE_LIMITS.MAX_RESPONSE_BODY_BYTES).toBe(10 * 1024 * 1024)
    })

    it('should allow larger code than request/response body', () => {
      expect(SIZE_LIMITS.MAX_CODE_SIZE_BYTES).toBeGreaterThan(SIZE_LIMITS.MAX_REQUEST_BODY_BYTES)
    })
  })

  // =============================================================================
  // AI MODELS
  // =============================================================================

  describe('AI_MODELS', () => {
    it('should define DEFAULT_GENERATIVE_MODEL', () => {
      expect(AI_MODELS.DEFAULT_GENERATIVE_MODEL).toBe('claude-3-sonnet')
    })

    it('should define DEFAULT_AGENTIC_MODEL', () => {
      expect(AI_MODELS.DEFAULT_AGENTIC_MODEL).toBe('claude-3-opus')
    })

    it('should define DEFAULT_MAX_TOKENS as 4096', () => {
      expect(AI_MODELS.DEFAULT_MAX_TOKENS).toBe(4096)
    })

    it('should define DEFAULT_TEMPERATURE as 0 (deterministic)', () => {
      expect(AI_MODELS.DEFAULT_TEMPERATURE).toBe(0)
    })

    it('should define DEFAULT_MAX_ITERATIONS as 10', () => {
      expect(AI_MODELS.DEFAULT_MAX_ITERATIONS).toBe(10)
    })
  })

  // =============================================================================
  // CSHARP & HUMAN EXECUTOR
  // =============================================================================

  describe('CSHARP', () => {
    it('should define CPU_TIMEOUT_MS as 30 seconds', () => {
      expect(CSHARP.CPU_TIMEOUT_MS).toBe(30000)
    })

    it('should define IDLE_TIMEOUT_MS as 30 seconds', () => {
      expect(CSHARP.IDLE_TIMEOUT_MS).toBe(30000)
    })

    it('should define EXECUTION_TIMEOUT_MS as 30 seconds', () => {
      expect(CSHARP.EXECUTION_TIMEOUT_MS).toBe(30000)
    })
  })

  describe('HUMAN_EXECUTOR', () => {
    it('should define DEFAULT_EXPIRATION_MS as 1 hour', () => {
      expect(HUMAN_EXECUTOR.DEFAULT_EXPIRATION_MS).toBe(3600000)
    })

    it('should define MAX_EXPIRATION_MS as 24 hours', () => {
      expect(HUMAN_EXECUTOR.MAX_EXPIRATION_MS).toBe(86400000)
    })

    it('should define REMINDER_INTERVAL_MS as 1 hour', () => {
      expect(HUMAN_EXECUTOR.REMINDER_INTERVAL_MS).toBe(3600000)
    })

    it('should have MAX_EXPIRATION >= DEFAULT_EXPIRATION', () => {
      expect(HUMAN_EXECUTOR.MAX_EXPIRATION_MS).toBeGreaterThanOrEqual(HUMAN_EXECUTOR.DEFAULT_EXPIRATION_MS)
    })
  })

  // =============================================================================
  // DETERMINISTIC MODE
  // =============================================================================

  describe('DETERMINISTIC', () => {
    it('should define RANDOM_SEED as 0.5', () => {
      expect(DETERMINISTIC.RANDOM_SEED).toBe(0.5)
    })

    it('should define FIXED_DATE_MS as 2024-01-01T00:00:00.000Z', () => {
      expect(DETERMINISTIC.FIXED_DATE_MS).toBe(1704067200000)
      const date = new Date(DETERMINISTIC.FIXED_DATE_MS)
      expect(date.toISOString()).toBe('2024-01-01T00:00:00.000Z')
    })
  })

  // =============================================================================
  // PUBLIC ENDPOINTS
  // =============================================================================

  describe('PUBLIC_ENDPOINTS', () => {
    it('should include / in CORE', () => {
      expect(PUBLIC_ENDPOINTS.CORE).toContain('/')
    })

    it('should include /health in CORE', () => {
      expect(PUBLIC_ENDPOINTS.CORE).toContain('/health')
    })

    it('should include /api/status in CORE', () => {
      expect(PUBLIC_ENDPOINTS.CORE).toContain('/api/status')
    })

    it('should include auth validation endpoints', () => {
      expect(PUBLIC_ENDPOINTS.AUTH_VALIDATION).toContain('/v1/api/auth/validate')
      expect(PUBLIC_ENDPOINTS.AUTH_VALIDATION).toContain('/api/auth/validate')
    })

    it('should have ALL as the union of CORE and AUTH_VALIDATION', () => {
      for (const path of PUBLIC_ENDPOINTS.CORE) {
        expect(PUBLIC_ENDPOINTS.ALL).toContain(path)
      }
      for (const path of PUBLIC_ENDPOINTS.AUTH_VALIDATION) {
        expect(PUBLIC_ENDPOINTS.ALL).toContain(path)
      }
      expect(PUBLIC_ENDPOINTS.ALL.length).toBe(
        PUBLIC_ENDPOINTS.CORE.length + PUBLIC_ENDPOINTS.AUTH_VALIDATION.length
      )
    })

    it('should have all endpoints as strings starting with /', () => {
      for (const path of PUBLIC_ENDPOINTS.ALL) {
        expect(typeof path).toBe('string')
        expect(path.startsWith('/')).toBe(true)
      }
    })
  })

  // =============================================================================
  // INVOKE HANDLER
  // =============================================================================

  describe('INVOKE', () => {
    it('should define MAX_BODY_SIZE as 10 MB', () => {
      expect(INVOKE.MAX_BODY_SIZE).toBe(10 * 1024 * 1024)
    })

    it('should define COMPATIBILITY_DATE as 2024-01-01', () => {
      expect(INVOKE.COMPATIBILITY_DATE).toBe('2024-01-01')
    })
  })

  // =============================================================================
  // COMBINED CONFIG OBJECT
  // =============================================================================

  describe('CONFIG', () => {
    it('should map timeouts correctly from TIER_TIMEOUTS', () => {
      expect(CONFIG.timeouts.code).toBe(TIER_TIMEOUTS.CODE_MS)
      expect(CONFIG.timeouts.generative).toBe(TIER_TIMEOUTS.GENERATIVE_MS)
      expect(CONFIG.timeouts.agentic).toBe(TIER_TIMEOUTS.AGENTIC_MS)
      expect(CONFIG.timeouts.human).toBe(TIER_TIMEOUTS.HUMAN_MS)
    })

    it('should map cache correctly from CACHE', () => {
      expect(CONFIG.cache.maxSize).toBe(CACHE.DEFAULT_MAX_SIZE)
      expect(CONFIG.cache.ttlMs).toBe(CACHE.DEFAULT_TTL_MS)
      expect(CONFIG.cache.maxMetricsSamples).toBe(CACHE.MAX_METRICS_SAMPLES)
    })

    it('should map limits correctly from SIZE_LIMITS', () => {
      expect(CONFIG.limits.maxCodeSize).toBe(SIZE_LIMITS.MAX_CODE_SIZE_BYTES)
      expect(CONFIG.limits.maxRequestBody).toBe(SIZE_LIMITS.MAX_REQUEST_BODY_BYTES)
      expect(CONFIG.limits.maxResponseBody).toBe(SIZE_LIMITS.MAX_RESPONSE_BODY_BYTES)
    })

    it('should map rate limits correctly from RATE_LIMITS', () => {
      expect(CONFIG.rateLimits.ip.windowMs).toBe(RATE_LIMITS.IP.WINDOW_MS)
      expect(CONFIG.rateLimits.ip.maxRequests).toBe(RATE_LIMITS.IP.MAX_REQUESTS)
      expect(CONFIG.rateLimits.function.windowMs).toBe(RATE_LIMITS.FUNCTION.WINDOW_MS)
      expect(CONFIG.rateLimits.function.maxRequests).toBe(RATE_LIMITS.FUNCTION.MAX_REQUESTS)
    })

    it('should map retry correctly from RETRY', () => {
      expect(CONFIG.retry.maxRetries).toBe(RETRY.MAX_RETRIES)
      expect(CONFIG.retry.initialDelayMs).toBe(RETRY.INITIAL_DELAY_MS)
      expect(CONFIG.retry.maxDelayMs).toBe(RETRY.MAX_DELAY_MS)
      expect(CONFIG.retry.backoffMultiplier).toBe(RETRY.BACKOFF_MULTIPLIER)
      expect(CONFIG.retry.jitter).toBe(RETRY.JITTER_ENABLED)
    })

    it('should map circuit breaker correctly from CIRCUIT_BREAKER', () => {
      expect(CONFIG.circuitBreaker.failureThreshold).toBe(CIRCUIT_BREAKER.FAILURE_THRESHOLD)
      expect(CONFIG.circuitBreaker.resetTimeoutMs).toBe(CIRCUIT_BREAKER.RESET_TIMEOUT_MS)
      expect(CONFIG.circuitBreaker.successThreshold).toBe(CIRCUIT_BREAKER.SUCCESS_THRESHOLD)
      expect(CONFIG.circuitBreaker.maxHalfOpenRequests).toBe(CIRCUIT_BREAKER.MAX_HALF_OPEN_REQUESTS)
    })

    it('should map observability correctly from OBSERVABILITY', () => {
      expect(CONFIG.observability.flushIntervalMs).toBe(OBSERVABILITY.FLUSH_INTERVAL_MS)
      expect(CONFIG.observability.exportTimeoutMs).toBe(OBSERVABILITY.EXPORT_TIMEOUT_MS)
      expect(CONFIG.observability.bufferSize).toBe(OBSERVABILITY.BUFFER_SIZE)
      expect(CONFIG.observability.sampleRate).toBe(OBSERVABILITY.DEFAULT_SAMPLE_RATE)
    })

    it('should map AI models correctly from AI_MODELS', () => {
      expect(CONFIG.ai.defaultGenerativeModel).toBe(AI_MODELS.DEFAULT_GENERATIVE_MODEL)
      expect(CONFIG.ai.defaultAgenticModel).toBe(AI_MODELS.DEFAULT_AGENTIC_MODEL)
      expect(CONFIG.ai.defaultMaxTokens).toBe(AI_MODELS.DEFAULT_MAX_TOKENS)
      expect(CONFIG.ai.defaultTemperature).toBe(AI_MODELS.DEFAULT_TEMPERATURE)
      expect(CONFIG.ai.defaultMaxIterations).toBe(AI_MODELS.DEFAULT_MAX_ITERATIONS)
    })
  })

  // =============================================================================
  // ENV BINDING VALIDATION
  // =============================================================================

  describe('REQUIRED_ENV_BINDINGS', () => {
    it('should require FUNCTIONS_REGISTRY as KVNamespace', () => {
      expect(REQUIRED_ENV_BINDINGS.FUNCTIONS_REGISTRY).toBe('KVNamespace')
    })

    it('should require FUNCTIONS_CODE as KVNamespace', () => {
      expect(REQUIRED_ENV_BINDINGS.FUNCTIONS_CODE).toBe('KVNamespace')
    })
  })

  describe('OPTIONAL_ENV_BINDINGS', () => {
    it('should include CODE_STORAGE as R2Bucket', () => {
      expect(OPTIONAL_ENV_BINDINGS.CODE_STORAGE).toBe('R2Bucket')
    })

    it('should include HUMAN_TASKS as DurableObjectNamespace', () => {
      expect(OPTIONAL_ENV_BINDINGS.HUMAN_TASKS).toBe('DurableObjectNamespace')
    })

    it('should include AI_CLIENT as AIClient', () => {
      expect(OPTIONAL_ENV_BINDINGS.AI_CLIENT).toBe('AIClient')
    })
  })

  describe('validateEnvBindings', () => {
    it('should return valid when all required bindings are present', () => {
      const env: Record<string, unknown> = {
        FUNCTIONS_REGISTRY: {},
        FUNCTIONS_CODE: {},
      }

      const result = validateEnvBindings(env)

      expect(result.valid).toBe(true)
      expect(result.missingRequired).toEqual([])
      expect(result.presentBindings).toContain('FUNCTIONS_REGISTRY')
      expect(result.presentBindings).toContain('FUNCTIONS_CODE')
    })

    it('should return invalid when required bindings are missing', () => {
      const env: Record<string, unknown> = {}

      const result = validateEnvBindings(env)

      expect(result.valid).toBe(false)
      expect(result.missingRequired).toContain('FUNCTIONS_REGISTRY')
      expect(result.missingRequired).toContain('FUNCTIONS_CODE')
    })

    it('should detect partially missing required bindings', () => {
      const env: Record<string, unknown> = {
        FUNCTIONS_REGISTRY: {},
      }

      const result = validateEnvBindings(env)

      expect(result.valid).toBe(false)
      expect(result.missingRequired).toEqual(['FUNCTIONS_CODE'])
      expect(result.presentBindings).toContain('FUNCTIONS_REGISTRY')
    })

    it('should report missing optional bindings', () => {
      const env: Record<string, unknown> = {
        FUNCTIONS_REGISTRY: {},
        FUNCTIONS_CODE: {},
      }

      const result = validateEnvBindings(env)

      expect(result.valid).toBe(true)
      expect(result.missingOptional.length).toBeGreaterThan(0)
      expect(result.missingOptional).toContain('CODE_STORAGE')
      expect(result.missingOptional).toContain('HUMAN_TASKS')
    })

    it('should include optional bindings in presentBindings when available', () => {
      const env: Record<string, unknown> = {
        FUNCTIONS_REGISTRY: {},
        FUNCTIONS_CODE: {},
        CODE_STORAGE: {},
        AI_CLIENT: {},
      }

      const result = validateEnvBindings(env)

      expect(result.valid).toBe(true)
      expect(result.presentBindings).toContain('CODE_STORAGE')
      expect(result.presentBindings).toContain('AI_CLIENT')
    })

    it('should treat null values as missing', () => {
      const env: Record<string, unknown> = {
        FUNCTIONS_REGISTRY: null,
        FUNCTIONS_CODE: null,
      }

      const result = validateEnvBindings(env)

      expect(result.valid).toBe(false)
      expect(result.missingRequired).toContain('FUNCTIONS_REGISTRY')
      expect(result.missingRequired).toContain('FUNCTIONS_CODE')
    })

    it('should treat undefined values as missing', () => {
      const env: Record<string, unknown> = {
        FUNCTIONS_REGISTRY: undefined,
        FUNCTIONS_CODE: undefined,
      }

      const result = validateEnvBindings(env)

      expect(result.valid).toBe(false)
    })

    it('should accept falsy but non-null/undefined values as present', () => {
      const env: Record<string, unknown> = {
        FUNCTIONS_REGISTRY: '',
        FUNCTIONS_CODE: 0,
      }

      const result = validateEnvBindings(env)

      expect(result.valid).toBe(true)
      expect(result.presentBindings).toContain('FUNCTIONS_REGISTRY')
      expect(result.presentBindings).toContain('FUNCTIONS_CODE')
    })
  })

  describe('logMissingOptionalBindings', () => {
    it('should not log when no optional bindings are missing', () => {
      const result: EnvValidationResult = {
        valid: true,
        missingRequired: [],
        missingOptional: [],
        presentBindings: ['FUNCTIONS_REGISTRY', 'FUNCTIONS_CODE'],
      }

      // Should not throw
      expect(() => logMissingOptionalBindings(result)).not.toThrow()
    })

    it('should not throw when optional bindings are missing', () => {
      const result: EnvValidationResult = {
        valid: true,
        missingRequired: [],
        missingOptional: ['CODE_STORAGE', 'HUMAN_TASKS'],
        presentBindings: ['FUNCTIONS_REGISTRY', 'FUNCTIONS_CODE'],
      }

      expect(() => logMissingOptionalBindings(result)).not.toThrow()
    })
  })
})
