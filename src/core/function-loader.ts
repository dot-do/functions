import type { WorkerStub, CacheStats, FunctionMetadata } from './types'
import { validateFunctionId } from './function-registry'
import { NotFoundError } from './errors'
import { evaluate, type SandboxEnv, type EvaluateResult } from 'ai-evaluate'
import { createLogger, type Logger, type LoggerConfig } from './logger'
import { LOADER, RETRY, CIRCUIT_BREAKER, CACHE } from '../config'

// =============================================================================
// CACHE API HELPERS
// =============================================================================

/** Internal cache domain for creating cache keys */
const LOADER_CACHE_DOMAIN = 'https://loader-cache.internal'

/**
 * Serializable cache entry for Cache API storage
 */
interface SerializableCacheEntry {
  stubId: string
  loadedAt: number
  lastAccessedAt: number
  version: string
  metadata: FunctionMetadata
  code: string // Store the code so we can recreate the stub
}

/**
 * Create a cache key Request for function stubs.
 */
function createLoaderCacheKey(functionId: string, version?: string): Request {
  const path = version ? `/stubs/${functionId}/${version}` : `/stubs/${functionId}/latest`
  return new Request(`${LOADER_CACHE_DOMAIN}${path}`)
}

/**
 * Get cached function entry from Cloudflare Cache API.
 */
async function getCachedFunctionEntry(functionId: string, version?: string): Promise<SerializableCacheEntry | null> {
  try {
    const cache = caches.default
    const cacheKey = createLoaderCacheKey(functionId, version)
    const cached = await cache.match(cacheKey)
    if (cached) {
      return await cached.json() as SerializableCacheEntry
    }
  } catch (error) {
    console.debug(`[loader-cache] get error for ${functionId}:`, error instanceof Error ? error.message : String(error))
  }
  return null
}

/**
 * Cache function entry using Cloudflare Cache API.
 */
async function cacheFunctionEntry(
  functionId: string,
  entry: SerializableCacheEntry,
  ttlSeconds: number,
  version?: string
): Promise<void> {
  try {
    const cache = caches.default
    const cacheKey = createLoaderCacheKey(functionId, version)
    const response = new Response(JSON.stringify(entry), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `max-age=${ttlSeconds}`,
      },
    })
    await cache.put(cacheKey, response)
  } catch (error) {
    console.debug(`[loader-cache] put error for ${functionId}:`, error instanceof Error ? error.message : String(error))
  }
}

/**
 * Invalidate cached function entry.
 */
async function invalidateCachedFunction(functionId: string, version?: string): Promise<boolean> {
  try {
    const cache = caches.default
    const cacheKey = createLoaderCacheKey(functionId, version)
    return await cache.delete(cacheKey)
  } catch (error) {
    console.debug(`[loader-cache] delete error for ${functionId}:`, error instanceof Error ? error.message : String(error))
    return false
  }
}

/**
 * Interface for the function registry dependency
 */
export interface Registry {
  get(functionId: string): Promise<FunctionMetadata | null>
  getVersion?(functionId: string, version: string): Promise<FunctionMetadata | null>
  listVersions?(functionId: string): Promise<string[]>
}

/**
 * Interface for the code storage dependency
 */
export interface CodeStorage {
  get(functionId: string, version?: string): Promise<string | null>
}

/**
 * Retry configuration options
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number
  /** Initial delay in milliseconds before first retry (default: 100) */
  initialDelayMs: number
  /** Maximum delay in milliseconds between retries (default: 5000) */
  maxDelayMs: number
  /** Backoff multiplier for exponential backoff (default: 2) */
  backoffMultiplier: number
  /** Whether to add jitter to retry delays (default: true) */
  jitter: boolean
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold: number
  /** Time in milliseconds before attempting to close the circuit (default: 30000) */
  resetTimeoutMs: number
  /** Number of successes in half-open state to close circuit (default: 2) */
  successThreshold: number
  /** Maximum concurrent test requests allowed in half-open state (default: 1) */
  maxHalfOpenRequests: number
}

/**
 * Circuit breaker states
 */
export type CircuitState = 'closed' | 'open' | 'half-open'

/**
 * Circuit breaker state tracking for a function
 */
export interface CircuitBreakerState {
  state: CircuitState
  failures: number
  successes: number
  lastFailureTime: number | null
  lastStateChange: number
  /** Number of in-flight test requests in half-open state */
  halfOpenRequests: number
}

/**
 * Enhanced error class for function loading failures.
 * Provides detailed context about the failure for better error propagation,
 * especially important for coalesced requests where multiple waiters need
 * to understand the original error context.
 */
export class FunctionLoadError extends Error {
  public readonly functionId: string
  public readonly cause?: Error
  public readonly retryCount: number
  public readonly circuitBreakerState?: CircuitState
  public readonly timestamp: number
  public readonly isCoalescedRequest: boolean

  constructor(options: {
    message: string
    functionId: string
    cause?: Error
    retryCount?: number
    circuitBreakerState?: CircuitState
    isCoalescedRequest?: boolean
  }) {
    const fullMessage = options.cause
      ? `${options.message}: ${options.cause.message}`
      : options.message
    super(fullMessage)
    this.name = 'FunctionLoadError'
    this.functionId = options.functionId
    // Only assign optional properties if they are defined (for exactOptionalPropertyTypes)
    if (options.cause !== undefined) {
      this.cause = options.cause
    }
    this.retryCount = options.retryCount ?? 0
    if (options.circuitBreakerState !== undefined) {
      this.circuitBreakerState = options.circuitBreakerState
    }
    this.timestamp = Date.now()
    this.isCoalescedRequest = options.isCoalescedRequest ?? false

    // Maintain proper stack trace for debugging
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FunctionLoadError)
    }
  }

  /**
   * Get a detailed error report for logging/debugging
   */
  toDetailedString(): string {
    const details = [
      `FunctionLoadError: ${this.message}`,
      `  Function ID: ${this.functionId}`,
      `  Retry Count: ${this.retryCount}`,
      `  Circuit Breaker State: ${this.circuitBreakerState ?? 'N/A'}`,
      `  Coalesced Request: ${this.isCoalescedRequest}`,
      `  Timestamp: ${new Date(this.timestamp).toISOString()}`,
    ]
    if (this.cause) {
      details.push(`  Original Error: ${this.cause.message}`)
    }
    return details.join('\n')
  }
}

/**
 * Comprehensive metrics for function loading
 */
export interface FunctionLoaderMetrics {
  /** Cache statistics */
  cache: CacheStats
  /** Total number of load requests */
  totalLoads: number
  /** Number of successful loads */
  successfulLoads: number
  /** Number of failed loads */
  failedLoads: number
  /** Total number of retries performed */
  totalRetries: number
  /** Average load time in milliseconds */
  avgLoadTimeMs: number
  /** P95 load time in milliseconds */
  p95LoadTimeMs: number
  /** P99 load time in milliseconds */
  p99LoadTimeMs: number
  /** Circuit breaker statistics */
  circuitBreakers: {
    open: number
    halfOpen: number
    closed: number
  }
  /** Error rate (0-1) */
  errorRate: number
  /** Rollback count */
  rollbackCount: number
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  healthy: boolean
  status: 'healthy' | 'degraded' | 'unhealthy'
  details: {
    registry: { available: boolean; latencyMs?: number; error?: string }
    codeStorage: { available: boolean; latencyMs?: number; error?: string }
    cache: { size: number; hitRate: number }
    circuitBreakers: { openCount: number; totalCount: number }
  }
  timestamp: string
}

/**
 * Load result with partial failure information
 */
export interface LoadResult {
  stub: WorkerStub | null
  success: boolean
  error?: Error
  fromCache: boolean
  loadTimeMs: number
  retryCount: number
  degraded?: boolean
  degradationReason?: string
}

/**
 * Configuration options for FunctionLoader
 */
export interface FunctionLoaderConfig {
  registry: Registry
  codeStorage: CodeStorage
  maxCacheSize?: number
  timeout?: number
  retry?: Partial<RetryConfig>
  circuitBreaker?: Partial<CircuitBreakerConfig>
  /** Enable graceful degradation (default: true) */
  gracefulDegradation?: boolean
  /** Fallback version to use on failure (e.g., 'latest-stable') */
  fallbackVersion?: string
  /**
   * Sandbox environment for secure code evaluation via ai-evaluate.
   *
   * This should contain the LOADER (worker_loaders) binding for production use.
   * Required for evaluateModule to work - if not provided, evaluation will fail.
   */
  sandboxEnv?: SandboxEnv
  /** Logger configuration or instance */
  logger?: Logger | LoggerConfig
}

/**
 * Cached function entry
 */
interface CacheEntry {
  stub: WorkerStub
  loadedAt: number
  lastAccessedAt: number
  version: string
  metadata: FunctionMetadata
}

/**
 * IFunctionLoader interface - the public contract for function loaders
 */
export interface IFunctionLoader {
  /**
   * Load a function by ID and return a WorkerStub-like interface.
   * @param functionId - The unique function identifier
   * @returns A WorkerStub that can be used to invoke the function
   */
  load(functionId: string): Promise<WorkerStub>

  /**
   * Load a function with detailed result information including partial failure data.
   * @param functionId - The unique function identifier
   * @returns Detailed load result
   */
  loadWithResult(functionId: string): Promise<LoadResult>

  /**
   * Load a specific version of a function.
   * @param functionId - The unique function identifier
   * @param version - The version to load
   * @returns A WorkerStub that can be used to invoke the function
   */
  loadVersion(functionId: string, version: string): Promise<WorkerStub>

  /**
   * Rollback a function to a previous version.
   * @param functionId - The unique function identifier
   * @param version - The version to rollback to
   * @returns The loaded WorkerStub for the rolled-back version
   */
  rollback(functionId: string, version: string): Promise<WorkerStub>

  /**
   * Invalidate a specific function in the cache.
   * @param functionId - The function ID to invalidate
   */
  invalidate(functionId: string): void

  /**
   * Clear the entire cache.
   */
  clearCache(): void

  /**
   * Get cache statistics.
   * @returns Cache statistics including size, hits, and misses
   */
  getCacheStats(): CacheStats

  /**
   * Get comprehensive metrics.
   * @returns Detailed metrics about loader performance
   */
  getMetrics(): FunctionLoaderMetrics

  /**
   * Perform a health check on the loader and its dependencies.
   * @returns Health check result
   */
  healthCheck(): Promise<HealthCheckResult>

  /**
   * Get the circuit breaker state for a specific function.
   * @param functionId - The function ID
   * @returns The circuit breaker state or undefined if none exists
   */
  getCircuitBreakerState(functionId: string): CircuitBreakerState | undefined

  /**
   * Reset the circuit breaker for a specific function.
   * @param functionId - The function ID
   */
  resetCircuitBreaker(functionId: string): void
}

/**
 * FunctionLoader is responsible for loading functions by ID and returning
 * a WorkerStub-like interface that can be used to invoke the function.
 *
 * Features:
 * - Caching of loaded functions using Cloudflare Cache API (persists across isolates)
 * - Request coalescing to prevent duplicate loads within a single request
 * - Cache statistics tracking
 * - Retry logic with exponential backoff for transient failures
 * - Circuit breaker pattern for failing functions (per-isolate state)
 * - Graceful degradation for partial failures
 * - Comprehensive metrics
 * - Health check support
 * - Version rollback support
 *
 * NOTE: This loader uses Cloudflare's Cache API for caching function stubs.
 * In-memory Maps don't persist across Worker requests (each request may hit
 * a different isolate), so we use the edge cache for cross-request caching.
 *
 * IMPORTANT: Circuit breaker state is per-isolate and doesn't persist across
 * requests. For distributed circuit breaking, use Durable Objects.
 */
export class FunctionLoader implements IFunctionLoader {
  private registry: Registry
  private codeStorage: CodeStorage
  private cacheTtlSeconds: number
  private timeout: number

  // Retry configuration
  private retryConfig: RetryConfig

  // Circuit breaker configuration
  private circuitBreakerConfig: CircuitBreakerConfig

  // Graceful degradation flag
  private gracefulDegradation: boolean
  private fallbackVersion?: string

  // Sandbox environment for ai-evaluate
  private sandboxEnv?: SandboxEnv

  // Structured logger
  private logger: Logger

  // NOTE: Removed cache Map - using Cache API instead for cross-isolate persistence
  // Cache API entries store serializable data; stubs are recreated on cache hit

  // In-flight requests for request coalescing (within a single request)
  // This Map is legitimate - it tracks concurrent loads within the same isolate
  private inFlight: Map<string, Promise<WorkerStub>> = new Map()

  // Cache statistics (reset per isolate, but useful for debugging)
  private hits: number = 0
  private misses: number = 0

  // Circuit breaker states per function (per-isolate, doesn't persist)
  // NOTE: This Map is per-isolate. For distributed circuit breaking, use Durable Objects.
  // We keep this for defense-in-depth within a single isolate's request handling.
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map()

  // Metrics tracking
  private totalLoads: number = 0
  private successfulLoads: number = 0
  private failedLoads: number = 0
  private totalRetries: number = 0
  private rollbackCount: number = 0
  private loadTimes: number[] = []
  private readonly maxLoadTimeSamples = 1000

  constructor(config: FunctionLoaderConfig) {
    this.registry = config.registry
    this.codeStorage = config.codeStorage
    // Convert maxCacheSize config to TTL; Cache API manages its own eviction
    // Default to 1 hour cache TTL (convert from ms to seconds)
    this.cacheTtlSeconds = Math.floor((CACHE.DEFAULT_TTL_MS ?? 3600000) / 1000)
    this.timeout = config.timeout ?? LOADER.DEFAULT_TIMEOUT_MS
    this.gracefulDegradation = config.gracefulDegradation ?? true
    if (config.fallbackVersion !== undefined) {
      this.fallbackVersion = config.fallbackVersion
    }
    this.sandboxEnv = config.sandboxEnv

    // Initialize retry config with defaults (from centralized config)
    this.retryConfig = {
      maxRetries: config.retry?.maxRetries ?? RETRY.MAX_RETRIES,
      initialDelayMs: config.retry?.initialDelayMs ?? RETRY.INITIAL_DELAY_MS,
      maxDelayMs: config.retry?.maxDelayMs ?? RETRY.MAX_DELAY_MS,
      backoffMultiplier: config.retry?.backoffMultiplier ?? RETRY.BACKOFF_MULTIPLIER,
      jitter: config.retry?.jitter ?? RETRY.JITTER_ENABLED,
    }

    // Initialize circuit breaker config with defaults (from centralized config)
    this.circuitBreakerConfig = {
      failureThreshold: config.circuitBreaker?.failureThreshold ?? CIRCUIT_BREAKER.FAILURE_THRESHOLD,
      resetTimeoutMs: config.circuitBreaker?.resetTimeoutMs ?? CIRCUIT_BREAKER.RESET_TIMEOUT_MS,
      successThreshold: config.circuitBreaker?.successThreshold ?? CIRCUIT_BREAKER.SUCCESS_THRESHOLD,
      maxHalfOpenRequests: config.circuitBreaker?.maxHalfOpenRequests ?? CIRCUIT_BREAKER.MAX_HALF_OPEN_REQUESTS,
    }

    // Initialize logger
    if (config.logger && 'warn' in config.logger && typeof config.logger.warn === 'function') {
      // It's a Logger instance
      this.logger = config.logger as Logger
    } else {
      // It's a LoggerConfig or undefined
      this.logger = createLogger({
        ...(config.logger as LoggerConfig | undefined),
        context: { component: 'FunctionLoader' },
      })
    }
  }

  /**
   * Load a function by ID and return a WorkerStub-like interface.
   *
   * @param functionId - The unique function identifier
   * @returns A WorkerStub that can be used to invoke the function
   * @throws Error if the function is not found, code is missing, or ID is invalid
   */
  async load(functionId: string): Promise<WorkerStub> {
    // Validate function ID format before attempting to load
    validateFunctionId(functionId)

    const result = await this.loadWithResult(functionId)
    if (!result.success || !result.stub) {
      throw result.error || new Error(`Failed to load function: ${functionId}`)
    }
    return result.stub
  }

  /**
   * Load a function with detailed result information.
   */
  async loadWithResult(functionId: string): Promise<LoadResult> {
    const startTime = Date.now()

    // Validate function ID format before attempting to load
    try {
      validateFunctionId(functionId)
    } catch (error) {
      return {
        stub: null,
        success: false,
        error: error instanceof Error ? error : new Error('Invalid function ID'),
        fromCache: false,
        loadTimeMs: Date.now() - startTime,
        retryCount: 0,
      }
    }

    this.totalLoads++

    // Check circuit breaker state
    const circuitState = this.getOrCreateCircuitBreaker(functionId)

    // Handle circuit breaker in open state
    if (circuitState.state === 'open') {
      if (!this.shouldAttemptReset(functionId)) {
        const error = new FunctionLoadError({
          message: `Circuit breaker open for function: ${functionId}`,
          functionId,
          circuitBreakerState: 'open',
        })
        this.failedLoads++
        return {
          stub: null,
          success: false,
          error,
          fromCache: false,
          loadTimeMs: Date.now() - startTime,
          retryCount: 0,
        }
      }
      // Transition to half-open state
      this.transitionCircuitBreaker(functionId, 'half-open')
    }

    // Handle circuit breaker in half-open state - limit concurrent test requests
    if (circuitState.state === 'half-open') {
      if (circuitState.halfOpenRequests >= this.circuitBreakerConfig.maxHalfOpenRequests) {
        // Too many test requests in flight, reject this one to prevent thundering herd
        const error = new FunctionLoadError({
          message: `Circuit breaker half-open, max test requests (${this.circuitBreakerConfig.maxHalfOpenRequests}) exceeded for function: ${functionId}`,
          functionId,
          circuitBreakerState: 'half-open',
        })
        this.failedLoads++
        return {
          stub: null,
          success: false,
          error,
          fromCache: false,
          loadTimeMs: Date.now() - startTime,
          retryCount: 0,
        }
      }
    }

    // Check Cache API first
    const cachedEntry = await getCachedFunctionEntry(functionId)
    if (cachedEntry) {
      this.hits++
      // Recreate the stub from cached data
      const stub = this.createStub(functionId, cachedEntry.code, cachedEntry.metadata)
      this.successfulLoads++
      this.recordSuccess(functionId)
      return {
        stub,
        success: true,
        fromCache: true,
        loadTimeMs: Date.now() - startTime,
        retryCount: 0,
      }
    }

    // Check if there's an in-flight request for this function (request coalescing)
    const inFlightRequest = this.inFlight.get(functionId)
    if (inFlightRequest) {
      try {
        const stub = await inFlightRequest
        return {
          stub,
          success: true,
          fromCache: false,
          loadTimeMs: Date.now() - startTime,
          retryCount: 0,
        }
      } catch (error) {
        // Wrap the error with coalesced request context so all waiters get full details
        let coalescedError: FunctionLoadError
        if (error instanceof FunctionLoadError) {
          const errorOpts: { message: string; functionId: string; retryCount: number; isCoalescedRequest: boolean; cause?: Error; circuitBreakerState?: CircuitState } = {
            message: error.message,
            functionId,
            retryCount: error.retryCount,
            isCoalescedRequest: true, // Mark this as a coalesced request
          }
          if (error.cause !== undefined) {
            errorOpts.cause = error.cause
          }
          if (error.circuitBreakerState !== undefined) {
            errorOpts.circuitBreakerState = error.circuitBreakerState
          }
          coalescedError = new FunctionLoadError(errorOpts)
        } else {
          const cbState = this.getCircuitBreakerState(functionId)?.state
          const errorOpts: { message: string; functionId: string; cause: Error; isCoalescedRequest: boolean; circuitBreakerState?: CircuitState } = {
            message: 'Failed to load function (coalesced request)',
            functionId,
            cause: error instanceof Error ? error : new Error(String(error)),
            isCoalescedRequest: true,
          }
          if (cbState !== undefined) {
            errorOpts.circuitBreakerState = cbState
          }
          coalescedError = new FunctionLoadError(errorOpts)
        }

        return {
          stub: null,
          success: false,
          error: coalescedError,
          fromCache: false,
          loadTimeMs: Date.now() - startTime,
          retryCount: coalescedError.retryCount,
        }
      }
    }

    // Track half-open requests
    const isHalfOpen = circuitState.state === 'half-open'
    if (isHalfOpen) {
      circuitState.halfOpenRequests++
    }

    // Create the load promise with retry logic
    let retryCount = 0
    let lastError: Error | undefined

    const loadWithRetry = async (): Promise<WorkerStub> => {
      for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
        try {
          const stub = await this.loadFunction(functionId)
          return stub
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))

          // Don't retry on non-transient errors
          if (this.isNonTransientError(lastError)) {
            throw lastError
          }

          if (attempt < this.retryConfig.maxRetries) {
            retryCount++
            this.totalRetries++
            const delay = this.calculateRetryDelay(attempt)
            await this.sleep(delay)
          }
        }
      }

      // Wrap the final error with full context for all coalesced waiters
      const cbState = this.getCircuitBreakerState(functionId)?.state
      const finalErrorOpts: { message: string; functionId: string; retryCount: number; cause?: Error; circuitBreakerState?: CircuitState } = {
        message: `Failed to load function after ${this.retryConfig.maxRetries} retries`,
        functionId,
        retryCount,
      }
      if (lastError !== undefined) {
        finalErrorOpts.cause = lastError
      }
      if (cbState !== undefined) {
        finalErrorOpts.circuitBreakerState = cbState
      }
      throw new FunctionLoadError(finalErrorOpts)
    }

    const loadPromise = loadWithRetry()
    this.inFlight.set(functionId, loadPromise)

    try {
      const stub = await loadPromise
      const loadTime = Date.now() - startTime
      this.recordLoadTime(loadTime)
      this.successfulLoads++
      this.recordSuccess(functionId)

      return {
        stub,
        success: true,
        fromCache: false,
        loadTimeMs: loadTime,
        retryCount,
      }
    } catch (error) {
      const loadTime = Date.now() - startTime
      this.recordLoadTime(loadTime)
      this.failedLoads++
      this.recordFailure(functionId)

      // Attempt graceful degradation
      if (this.gracefulDegradation && this.fallbackVersion) {
        try {
          const fallbackStub = await this.loadVersion(functionId, this.fallbackVersion)
          return {
            stub: fallbackStub,
            success: true,
            fromCache: false,
            loadTimeMs: Date.now() - startTime,
            retryCount,
            degraded: true,
            degradationReason: `Fell back to version ${this.fallbackVersion} due to: ${lastError?.message}`,
          }
        } catch (fallbackError) {
          // Fallback also failed
          const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          this.logger.warn('Fallback load failed', {
            functionId,
            fallbackVersion: this.fallbackVersion,
            error: message,
          })
        }
      }

      // Use the FunctionLoadError if available, otherwise create one
      let finalError: FunctionLoadError
      if (error instanceof FunctionLoadError) {
        finalError = error
      } else {
        const newCbState = this.getCircuitBreakerState(functionId)?.state
        const newErrorOpts: { message: string; functionId: string; retryCount: number; cause?: Error; circuitBreakerState?: CircuitState } = {
          message: 'Failed to load function',
          functionId,
          retryCount,
        }
        if (lastError !== undefined) {
          newErrorOpts.cause = lastError
        }
        if (newCbState !== undefined) {
          newErrorOpts.circuitBreakerState = newCbState
        }
        finalError = new FunctionLoadError(newErrorOpts)
      }

      return {
        stub: null,
        success: false,
        error: finalError,
        fromCache: false,
        loadTimeMs: loadTime,
        retryCount,
      }
    } finally {
      // Clean up in-flight tracking
      this.inFlight.delete(functionId)

      // Decrement half-open request counter
      if (isHalfOpen && circuitState.halfOpenRequests > 0) {
        circuitState.halfOpenRequests--
      }
    }
  }

  /**
   * Load a specific version of a function.
   */
  async loadVersion(functionId: string, version: string): Promise<WorkerStub> {
    // Validate function ID format before attempting to load
    validateFunctionId(functionId)

    // Check Cache API first
    const cachedEntry = await getCachedFunctionEntry(functionId, version)
    if (cachedEntry) {
      this.hits++
      // Recreate the stub from cached data
      return this.createStub(functionId, cachedEntry.code, cachedEntry.metadata)
    }

    this.misses++

    // Fetch metadata from registry for specific version
    let metadata: FunctionMetadata | null = null
    if (this.registry.getVersion) {
      metadata = await this.registry.getVersion(functionId, version)
    } else {
      // Fallback: get current metadata and modify version
      metadata = await this.registry.get(functionId)
      if (metadata) {
        metadata = { ...metadata, version }
      }
    }

    if (!metadata) {
      throw new NotFoundError('Function version', `${functionId}@${version}`)
    }

    // Fetch code from storage for specific version
    const code = await this.codeStorage.get(functionId, version)
    if (!code) {
      throw new NotFoundError('Function version code', `${functionId}@${version}`)
    }

    // Create the worker stub
    const stub = this.createStub(functionId, code, metadata)

    // Cache to Cache API
    const now = Date.now()
    const cacheEntry: SerializableCacheEntry = {
      stubId: functionId,
      loadedAt: now,
      lastAccessedAt: now,
      version,
      metadata,
      code,
    }
    try {
      await cacheFunctionEntry(functionId, cacheEntry, this.cacheTtlSeconds, version)
    } catch {
      // Ignore cache errors - they're non-fatal
    }

    return stub
  }

  /**
   * Rollback a function to a previous version.
   */
  async rollback(functionId: string, version: string): Promise<WorkerStub> {
    // Invalidate the current cached version
    await this.invalidate(functionId)

    // Reset circuit breaker on rollback
    this.resetCircuitBreaker(functionId)

    // Load the specified version
    const stub = await this.loadVersion(functionId, version)

    // The version is already cached by loadVersion
    // Also cache it as the 'latest' version
    const cachedEntry = await getCachedFunctionEntry(functionId, version)
    if (cachedEntry) {
      try {
        await cacheFunctionEntry(functionId, cachedEntry, this.cacheTtlSeconds)
      } catch {
        // Ignore cache errors
      }
    }

    this.rollbackCount++

    return stub
  }

  /**
   * Internal method to actually load a function.
   */
  private async loadFunction(functionId: string): Promise<WorkerStub> {
    this.misses++

    // Fetch metadata from registry
    const metadata = await this.registry.get(functionId)
    if (!metadata) {
      throw new NotFoundError('Function', functionId)
    }

    // Fetch code from storage
    const code = await this.codeStorage.get(functionId)
    if (!code) {
      throw new NotFoundError('Function code', functionId)
    }

    // Create the worker stub
    const stub = this.createStub(functionId, code, metadata)

    // Cache to Cache API
    const now = Date.now()
    const cacheEntry: SerializableCacheEntry = {
      stubId: functionId,
      loadedAt: now,
      lastAccessedAt: now,
      version: metadata.version,
      metadata,
      code,
    }
    try {
      await cacheFunctionEntry(functionId, cacheEntry, this.cacheTtlSeconds)
    } catch {
      // Ignore cache errors - they're non-fatal
    }

    return stub
  }

  /**
   * Create a WorkerStub from the loaded code.
   */
  private createStub(functionId: string, code: string, _metadata: FunctionMetadata): WorkerStub {
    // Create a module from the code
    // In a real implementation, this would use Cloudflare's module system
    // For testing, we evaluate the code to extract the default export
    const module = this.evaluateModule(code)

    // Extract handlers with bracket notation (for noPropertyAccessFromIndexSignature)
    const fetchHandler = module['fetch']
    const connectHandler = module['connect']
    const scheduledHandler = module['scheduled']
    const queueHandler = module['queue']

    const stub: WorkerStub = {
      id: functionId,

      async fetch(request: Request): Promise<Response> {
        if (typeof fetchHandler === 'function') {
          return fetchHandler(request)
        }
        return new Response('Not Found', { status: 404 })
      },

      async connect(request: Request): Promise<Response> {
        if (typeof connectHandler === 'function') {
          return connectHandler(request)
        }
        return new Response('Not Implemented', { status: 501 })
      },

      async scheduled(controller: ScheduledController): Promise<void> {
        if (typeof scheduledHandler === 'function') {
          return scheduledHandler(controller)
        }
      },

      async queue(batch: MessageBatch<unknown>): Promise<void> {
        if (typeof queueHandler === 'function') {
          return queueHandler(batch)
        }
      },
    }

    return stub
  }

  /**
   * Evaluate module code and extract the default export using ai-evaluate.
   *
   * Uses the ai-evaluate package for secure sandboxed code execution via
   * Cloudflare worker_loaders. This is the correct architecture for dynamic
   * code evaluation in Cloudflare Workers.
   *
   * @param code - The module code to evaluate (must come from trusted CodeStorage)
   * @returns The evaluated module exports
   * @throws Error if sandboxEnv is not configured
   */
  private async evaluateModuleAsync(code: string): Promise<Record<string, Function | string>> {
    // Require sandboxEnv to be configured
    if (!this.sandboxEnv) {
      throw new Error(
        'Sandbox environment not configured. ' +
          'Set sandboxEnv in FunctionLoaderConfig with LOADER binding for ai-evaluate.'
      )
    }

    // Basic code validation
    if (!code || typeof code !== 'string') {
      throw new Error('Invalid code: must be a non-empty string')
    }

    try {
      // Use ai-evaluate for secure sandboxed execution
      const result: EvaluateResult = await evaluate(
        {
          module: code,
          // Return the module's default export
          script: `
            const mod = typeof exports !== 'undefined' ? exports : {};
            const defaultExport = mod.default || mod;
            return defaultExport;
          `,
          timeout: this.timeout,
          fetch: false, // Block network access during module evaluation
        },
        this.sandboxEnv
      )

      if (!result.success) {
        this.logger.warn('Module evaluation failed', { error: result.error })
        return { __loadError: result.error || 'Unknown evaluation error' }
      }

      // Return the evaluated module or empty object
      return (result.value as Record<string, Function | string>) || {}
    } catch (error) {
      // If evaluation fails, return module with error information
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn('Module evaluation failed', { error: message })
      return { __loadError: message }
    }
  }

  /**
   * Synchronous wrapper for evaluateModuleAsync for backwards compatibility.
   * This creates a stub that will evaluate the module on first use.
   *
   * @param code - The module code to evaluate
   * @returns A proxy object that evaluates the module on first property access
   */
  private evaluateModule(code: string): Record<string, Function | string> {
    // For synchronous compatibility, we return handlers that will evaluate async
    // This works because the handlers themselves are async (fetch, connect, etc.)
    const sandboxEnv = this.sandboxEnv
    const timeout = this.timeout

    // Cache for the evaluated module
    let modulePromise: Promise<Record<string, Function | string>> | null = null

    const getModule = async (): Promise<Record<string, Function | string>> => {
      if (!modulePromise) {
        modulePromise = this.evaluateModuleAsync(code)
      }
      return modulePromise
    }

    // Return an object with handlers that evaluate the module lazily
    return {
      async fetch(request: Request): Promise<Response> {
        if (!sandboxEnv) {
          return new Response(JSON.stringify({ error: 'Sandbox environment not configured' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        try {
          // Use ai-evaluate to run the fetch handler
          const result = await evaluate(
            {
              module: code,
              script: `
                const mod = typeof exports !== 'undefined' ? exports : {};
                const handler = mod.default || mod;
                if (handler && typeof handler.fetch === 'function') {
                  const request = new Request('${request.url}', {
                    method: '${request.method}',
                    headers: ${JSON.stringify(Object.fromEntries(request.headers.entries()))},
                  });
                  return handler.fetch(request);
                }
                throw new Error('No fetch handler found in module');
              `,
              timeout: timeout,
            },
            sandboxEnv
          )

          if (!result.success) {
            return new Response(JSON.stringify({ error: result.error }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            })
          }

          // If the result is already a Response-like object, return it
          const value = result.value as { body?: string; status?: number; headers?: Record<string, string> }
          if (value && typeof value === 'object') {
            return new Response(
              value.body || JSON.stringify(value),
              {
                status: value.status || 200,
                headers: value.headers || { 'Content-Type': 'application/json' },
              }
            )
          }

          return new Response(JSON.stringify(value), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      },
    } as Record<string, Function | string>
  }

  // NOTE: Removed evictOldest() and touchCacheEntry() methods
  // These were for the in-memory LRU cache which has been replaced by Cache API.
  // Cache API handles TTL expiration and eviction automatically.

  /**
   * Calculate retry delay with exponential backoff and optional jitter.
   */
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = this.retryConfig.initialDelayMs * Math.pow(this.retryConfig.backoffMultiplier, attempt)
    const cappedDelay = Math.min(baseDelay, this.retryConfig.maxDelayMs)

    if (this.retryConfig.jitter) {
      // Add +/- 25% jitter
      const jitterRange = cappedDelay * 0.25
      const jitter = (Math.random() - 0.5) * 2 * jitterRange
      return Math.max(0, cappedDelay + jitter)
    }

    return cappedDelay
  }

  /**
   * Determine if an error is non-transient (should not be retried).
   */
  private isNonTransientError(error: Error): boolean {
    const message = error.message.toLowerCase()
    return message.includes('not found') || message.includes('invalid') || message.includes('unauthorized')
  }

  /**
   * Sleep for a specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Get or create circuit breaker state for a function.
   */
  private getOrCreateCircuitBreaker(functionId: string): CircuitBreakerState {
    let state = this.circuitBreakers.get(functionId)
    if (!state) {
      state = {
        state: 'closed',
        failures: 0,
        successes: 0,
        lastFailureTime: null,
        lastStateChange: Date.now(),
        halfOpenRequests: 0,
      }
      this.circuitBreakers.set(functionId, state)
    }
    return state
  }

  /**
   * Record a successful load for circuit breaker.
   */
  private recordSuccess(functionId: string): void {
    const state = this.getOrCreateCircuitBreaker(functionId)

    if (state.state === 'half-open') {
      state.successes++
      if (state.successes >= this.circuitBreakerConfig.successThreshold) {
        this.transitionCircuitBreaker(functionId, 'closed')
      }
    } else if (state.state === 'closed') {
      // Reset failures on success in closed state
      state.failures = 0
    }
  }

  /**
   * Record a failed load for circuit breaker.
   */
  private recordFailure(functionId: string): void {
    const state = this.getOrCreateCircuitBreaker(functionId)
    state.failures++
    state.lastFailureTime = Date.now()

    if (state.state === 'half-open') {
      // Any failure in half-open state opens the circuit
      this.transitionCircuitBreaker(functionId, 'open')
    } else if (state.state === 'closed' && state.failures >= this.circuitBreakerConfig.failureThreshold) {
      this.transitionCircuitBreaker(functionId, 'open')
    }
  }

  /**
   * Transition circuit breaker to a new state.
   */
  private transitionCircuitBreaker(functionId: string, newState: CircuitState): void {
    const state = this.getOrCreateCircuitBreaker(functionId)
    state.state = newState
    state.lastStateChange = Date.now()

    if (newState === 'closed') {
      state.failures = 0
      state.successes = 0
    } else if (newState === 'half-open') {
      state.successes = 0
    }
  }

  /**
   * Check if we should attempt to reset an open circuit breaker.
   */
  private shouldAttemptReset(functionId: string): boolean {
    const state = this.circuitBreakers.get(functionId)
    if (!state || state.state !== 'open') {
      return false
    }

    const timeSinceLastChange = Date.now() - state.lastStateChange
    return timeSinceLastChange >= this.circuitBreakerConfig.resetTimeoutMs
  }

  /**
   * Record load time for metrics.
   */
  private recordLoadTime(loadTimeMs: number): void {
    this.loadTimes.push(loadTimeMs)
    if (this.loadTimes.length > this.maxLoadTimeSamples) {
      this.loadTimes.shift()
    }
  }

  /**
   * Calculate percentile from sorted array.
   */
  private calculatePercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1
    return sortedArray[Math.max(0, index)]!
  }

  /**
   * Invalidate a specific function in the cache.
   *
   * @param functionId - The function ID to invalidate
   */
  async invalidate(functionId: string): Promise<void> {
    // Invalidate the 'latest' version
    await invalidateCachedFunction(functionId)
    // Note: Cannot bulk-invalidate version-specific entries without tracking them
    // Version-specific entries will expire based on their TTL
  }

  /**
   * Clear the entire cache.
   *
   * NOTE: With Cache API, we cannot clear all entries.
   * Entries will expire based on their TTL (Cache-Control max-age).
   * @deprecated Use invalidate() for specific entries instead
   */
  clearCache(): void {
    // Cannot clear Cache API entries - they expire based on TTL
    console.debug('[loader-cache] clearCache() called but Cache API entries cannot be bulk-cleared')
  }

  /**
   * Get cache statistics.
   *
   * NOTE: With Cache API, we cannot get the cache size.
   * Only hit/miss counters are available (reset per isolate).
   *
   * @returns Cache statistics including hits and misses
   */
  getCacheStats(): CacheStats {
    return {
      size: 0, // Cannot determine Cache API size
      hits: this.hits,
      misses: this.misses,
    }
  }

  /**
   * Get comprehensive metrics.
   */
  getMetrics(): FunctionLoaderMetrics {
    const sortedLoadTimes = [...this.loadTimes].sort((a, b) => a - b)
    const avgLoadTime = this.loadTimes.length > 0 ? this.loadTimes.reduce((a, b) => a + b, 0) / this.loadTimes.length : 0

    let openCount = 0
    let halfOpenCount = 0
    let closedCount = 0

    for (const state of this.circuitBreakers.values()) {
      switch (state.state) {
        case 'open':
          openCount++
          break
        case 'half-open':
          halfOpenCount++
          break
        case 'closed':
          closedCount++
          break
      }
    }

    return {
      cache: this.getCacheStats(),
      totalLoads: this.totalLoads,
      successfulLoads: this.successfulLoads,
      failedLoads: this.failedLoads,
      totalRetries: this.totalRetries,
      avgLoadTimeMs: avgLoadTime,
      p95LoadTimeMs: this.calculatePercentile(sortedLoadTimes, 95),
      p99LoadTimeMs: this.calculatePercentile(sortedLoadTimes, 99),
      circuitBreakers: {
        open: openCount,
        halfOpen: halfOpenCount,
        closed: closedCount,
      },
      errorRate: this.totalLoads > 0 ? this.failedLoads / this.totalLoads : 0,
      rollbackCount: this.rollbackCount,
    }
  }

  /**
   * Perform a health check on the loader and its dependencies.
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const hitRate = this.hits + this.misses > 0 ? this.hits / (this.hits + this.misses) : 0
    const result: HealthCheckResult = {
      healthy: true,
      status: 'healthy',
      details: {
        registry: { available: false },
        codeStorage: { available: false },
        // Cache API size is not available; report hit rate instead
        cache: { size: 0, hitRate },
        circuitBreakers: { openCount: 0, totalCount: this.circuitBreakers.size },
      },
      timestamp: new Date().toISOString(),
    }

    // Check registry availability
    try {
      const start = Date.now()
      // Try to get a non-existent function to check connectivity
      await this.registry.get('__health_check__')
      result.details.registry = { available: true, latencyMs: Date.now() - start }
    } catch (error) {
      result.details.registry = {
        available: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    // Check code storage availability
    try {
      const start = Date.now()
      // Try to get a non-existent function to check connectivity
      await this.codeStorage.get('__health_check__')
      result.details.codeStorage = { available: true, latencyMs: Date.now() - start }
    } catch (error) {
      result.details.codeStorage = {
        available: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    // Count open circuit breakers
    for (const state of this.circuitBreakers.values()) {
      if (state.state === 'open') {
        result.details.circuitBreakers.openCount++
      }
    }

    // Determine overall health status
    const registryDown = !result.details.registry.available
    const storageDown = !result.details.codeStorage.available
    const tooManyOpenCircuits =
      result.details.circuitBreakers.openCount > result.details.circuitBreakers.totalCount * 0.5

    if (registryDown && storageDown) {
      result.healthy = false
      result.status = 'unhealthy'
    } else if (registryDown || storageDown || tooManyOpenCircuits) {
      result.healthy = true
      result.status = 'degraded'
    }

    return result
  }

  /**
   * Get the circuit breaker state for a specific function.
   */
  getCircuitBreakerState(functionId: string): CircuitBreakerState | undefined {
    return this.circuitBreakers.get(functionId)
  }

  /**
   * Reset the circuit breaker for a specific function.
   */
  resetCircuitBreaker(functionId: string): void {
    this.circuitBreakers.delete(functionId)
  }
}
