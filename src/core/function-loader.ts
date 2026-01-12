import type { WorkerStub, CacheStats, FunctionMetadata } from './types'
import { validateFunctionId } from './function-registry'
import { NotFoundError } from './errors'

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
 * - Caching of loaded functions for performance
 * - Request coalescing to prevent duplicate loads
 * - LRU-style cache eviction when maxCacheSize is exceeded
 * - Cache statistics tracking
 * - Retry logic with exponential backoff for transient failures
 * - Circuit breaker pattern for failing functions
 * - Graceful degradation for partial failures
 * - Comprehensive metrics
 * - Health check support
 * - Version rollback support
 */
export class FunctionLoader implements IFunctionLoader {
  private registry: Registry
  private codeStorage: CodeStorage
  private maxCacheSize: number
  private timeout: number

  // Retry configuration
  private retryConfig: RetryConfig

  // Circuit breaker configuration
  private circuitBreakerConfig: CircuitBreakerConfig

  // Graceful degradation flag
  private gracefulDegradation: boolean
  private fallbackVersion?: string

  // Cache for loaded function stubs
  private cache: Map<string, CacheEntry> = new Map()

  // In-flight requests for request coalescing
  private inFlight: Map<string, Promise<WorkerStub>> = new Map()

  // Cache statistics
  private hits: number = 0
  private misses: number = 0

  // Circuit breaker states per function
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
    this.maxCacheSize = config.maxCacheSize ?? 1000
    this.timeout = config.timeout ?? 30000
    this.gracefulDegradation = config.gracefulDegradation ?? true
    if (config.fallbackVersion !== undefined) {
      this.fallbackVersion = config.fallbackVersion
    }

    // Initialize retry config with defaults
    this.retryConfig = {
      maxRetries: config.retry?.maxRetries ?? 3,
      initialDelayMs: config.retry?.initialDelayMs ?? 100,
      maxDelayMs: config.retry?.maxDelayMs ?? 5000,
      backoffMultiplier: config.retry?.backoffMultiplier ?? 2,
      jitter: config.retry?.jitter ?? true,
    }

    // Initialize circuit breaker config with defaults
    this.circuitBreakerConfig = {
      failureThreshold: config.circuitBreaker?.failureThreshold ?? 5,
      resetTimeoutMs: config.circuitBreaker?.resetTimeoutMs ?? 30000,
      successThreshold: config.circuitBreaker?.successThreshold ?? 2,
      maxHalfOpenRequests: config.circuitBreaker?.maxHalfOpenRequests ?? 1,
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

    // Check cache first
    const cached = this.cache.get(functionId)
    if (cached) {
      this.hits++
      // Move entry to end of Map to maintain LRU ordering (O(1) operation)
      this.touchCacheEntry(functionId, cached)
      this.successfulLoads++
      this.recordSuccess(functionId)
      return {
        stub: cached.stub,
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
          console.warn('Fallback load failed:', message)
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

    const cacheKey = `${functionId}@${version}`

    // Check cache first
    const cached = this.cache.get(cacheKey)
    if (cached) {
      this.hits++
      // Move entry to end of Map to maintain LRU ordering (O(1) operation)
      this.touchCacheEntry(cacheKey, cached)
      return cached.stub
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

    // Evict oldest entry if cache is full
    if (this.cache.size >= this.maxCacheSize) {
      this.evictOldest()
    }

    // Add to cache with version-specific key
    const now = Date.now()
    this.cache.set(cacheKey, {
      stub,
      loadedAt: now,
      lastAccessedAt: now,
      version,
      metadata,
    })

    return stub
  }

  /**
   * Rollback a function to a previous version.
   */
  async rollback(functionId: string, version: string): Promise<WorkerStub> {
    // Invalidate the current cached version
    this.invalidate(functionId)

    // Reset circuit breaker on rollback
    this.resetCircuitBreaker(functionId)

    // Load the specified version
    const stub = await this.loadVersion(functionId, version)

    // Cache it as the primary version too
    const cached = this.cache.get(`${functionId}@${version}`)
    if (cached) {
      this.cache.set(functionId, cached)
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

    // Evict oldest entry if cache is full
    if (this.cache.size >= this.maxCacheSize) {
      this.evictOldest()
    }

    // Add to cache
    const now = Date.now()
    this.cache.set(functionId, {
      stub,
      loadedAt: now,
      lastAccessedAt: now,
      version: metadata.version,
      metadata,
    })

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
   * Evaluate module code and extract the default export.
   * In a production environment, this would use Cloudflare's module system.
   */
  private evaluateModule(code: string): Record<string, Function | string> {
    // Create a safe evaluation context
    // This is a simplified implementation for testing
    // Real implementation would use Cloudflare's isolated execution
    try {
      // Transform ES module syntax to something we can evaluate
      // Handle "export default { ... }" pattern
      const transformed = code.replace(/export\s+default\s+/g, 'return ').trim()

      // Create and execute a function that returns the module
      const moduleFactory = new Function(transformed)
      const module = moduleFactory()

      return module || {}
    } catch (error) {
      // If evaluation fails, return module with error information
      const message = error instanceof Error ? error.message : String(error)
      console.warn('Module evaluation failed:', message)
      return { __loadError: message }
    }
  }

  /**
   * Evict the oldest (least recently used) entry from the cache.
   * Uses Map's insertion order for O(1) eviction - the first entry is always the oldest.
   */
  private evictOldest(): void {
    // Map maintains insertion order, so the first entry is the oldest (LRU)
    const firstKey = this.cache.keys().next().value
    if (firstKey !== undefined) {
      this.cache.delete(firstKey)
    }
  }

  /**
   * Move a cache entry to the end of the Map to mark it as recently used.
   * This is O(1) and maintains LRU ordering by deletion and re-insertion.
   */
  private touchCacheEntry(key: string, entry: CacheEntry): void {
    this.cache.delete(key)
    entry.lastAccessedAt = Date.now()
    this.cache.set(key, entry)
  }

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
  invalidate(functionId: string): void {
    this.cache.delete(functionId)
    // Also invalidate any version-specific entries
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${functionId}@`)) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Clear the entire cache.
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics.
   *
   * @returns Cache statistics including size, hits, and misses
   */
  getCacheStats(): CacheStats {
    return {
      size: this.cache.size,
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
    const result: HealthCheckResult = {
      healthy: true,
      status: 'healthy',
      details: {
        registry: { available: false },
        codeStorage: { available: false },
        cache: { size: this.cache.size, hitRate: this.hits + this.misses > 0 ? this.hits / (this.hits + this.misses) : 0 },
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
