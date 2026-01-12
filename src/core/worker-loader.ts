/**
 * Worker Loader - Loads and caches function workers
 *
 * This module is responsible for:
 * 1. Loading compiled function code from the loader service
 * 2. Creating WorkerStub instances for function invocation
 * 3. Caching loaded isolates to minimize cold starts
 *
 * Implements the ai-evaluate two-path architecture:
 * - Production: Uses Cloudflare worker_loaders binding (env.LOADER)
 * - Development: Falls back to Miniflare for local testing
 */

import type { WorkerStub, CacheStats, WorkerLoaderOptions } from './types'
import type { CircuitBreakerConfig, CircuitBreakerState, CircuitState } from './function-loader'

/**
 * Logger interface for WorkerLoader debugging
 */
export interface WorkerLoaderLogger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}

/**
 * Default no-op logger
 */
const noopLogger: WorkerLoaderLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

/**
 * Console-based logger for development
 */
export const consoleLogger: WorkerLoaderLogger = {
  debug: (msg, ctx) => console.debug(`[WorkerLoader] ${msg}`, ctx || ''),
  info: (msg, ctx) => console.info(`[WorkerLoader] ${msg}`, ctx || ''),
  warn: (msg, ctx) => console.warn(`[WorkerLoader] ${msg}`, ctx || ''),
  error: (msg, ctx) => console.error(`[WorkerLoader] ${msg}`, ctx || ''),
}

/**
 * Base error class for WorkerLoader errors
 */
export class WorkerLoaderError extends Error {
  readonly code: string
  readonly context?: Record<string, unknown>
  readonly cause?: Error

  constructor(message: string, code: string, context?: Record<string, unknown>, cause?: Error) {
    super(message)
    this.name = 'WorkerLoaderError'
    this.code = code
    if (context !== undefined) {
      this.context = context
    }
    if (cause !== undefined) {
      this.cause = cause
    }
    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

/**
 * Error thrown when a function is not found
 */
export class FunctionNotFoundError extends WorkerLoaderError {
  constructor(functionId: string, cause?: Error) {
    super(
      `Function not found: ${functionId}`,
      'FUNCTION_NOT_FOUND',
      { functionId },
      cause
    )
    this.name = 'FunctionNotFoundError'
  }
}

/**
 * Error thrown when loading times out
 */
export class LoadTimeoutError extends WorkerLoaderError {
  constructor(functionId: string, timeoutMs: number, cause?: Error) {
    super(
      `Timeout while loading function: ${functionId} (${timeoutMs}ms)`,
      'LOAD_TIMEOUT',
      { functionId, timeoutMs },
      cause
    )
    this.name = 'LoadTimeoutError'
  }
}

/**
 * Error thrown when code compilation fails
 */
export class CompilationError extends WorkerLoaderError {
  constructor(functionId: string, details: string, cause?: Error) {
    super(
      `Compilation failed for function: ${functionId}: ${details}`,
      'COMPILATION_ERROR',
      { functionId, details },
      cause
    )
    this.name = 'CompilationError'
  }
}

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitBreakerOpenError extends WorkerLoaderError {
  constructor(functionId: string, state: CircuitBreakerState) {
    super(
      `Circuit breaker open for function: ${functionId}`,
      'CIRCUIT_BREAKER_OPEN',
      { functionId, failures: state.failures, lastFailureTime: state.lastFailureTime }
    )
    this.name = 'CircuitBreakerOpenError'
  }
}

/**
 * Error thrown when the loader service returns an error
 */
export class LoaderServiceError extends WorkerLoaderError {
  readonly statusCode?: number

  constructor(functionId: string, message: string, statusCode?: number, cause?: Error) {
    super(
      `Loader service error for function: ${functionId}: ${message}`,
      'LOADER_SERVICE_ERROR',
      { functionId, statusCode },
      cause
    )
    this.name = 'LoaderServiceError'
    this.statusCode = statusCode
  }
}

/**
 * Error thrown when no loader is configured
 */
export class NoLoaderConfiguredError extends WorkerLoaderError {
  constructor() {
    super(
      'No loader fetcher configured',
      'NO_LOADER_CONFIGURED',
      {}
    )
    this.name = 'NoLoaderConfiguredError'
  }
}

/**
 * Options for loading a function via ai-evaluate pattern
 */
export interface LoadFunctionOptions {
  /** Unique function identifier */
  id: string
  /** Function source code */
  code: string
  /** Optional test code */
  tests?: string
  /** Optional script to run */
  script?: string
  /** Additional options */
  options?: {
    /** Timeout in milliseconds */
    timeout?: number
    /** Fetch configuration - set to null to block network */
    fetch?: null | undefined
    /** SDK configuration */
    sdk?: Record<string, unknown>
  }
}

/**
 * Result from loading a function
 */
export interface LoadFunctionResult {
  success: boolean
  value?: unknown
  error?: string
  logs?: Array<{ level: string; message: string }>
  testResults?: {
    total: number
    passed: number
    failed: number
    tests: Array<{ name: string; passed: boolean; error?: string }>
  }
  developmentMode?: boolean
}

/**
 * Worker code configuration for worker_loaders
 */
interface WorkerCode {
  mainModule: string
  modules: Record<string, string>
  compatibilityDate: string
  globalOutbound?: null | undefined
  bindings?: Record<string, unknown>
}

/**
 * Cloudflare worker_loaders binding interface
 */
interface WorkerLoaderBinding {
  get(id: string, loader: () => Promise<WorkerCode>): {
    fetch(request: Request): Promise<Response>
  }
}

/**
 * Internal cached stub that wraps the raw stub with metadata
 */
interface CachedStub {
  stub: WorkerStub
  loadedAt: number
  /** Hash of the code for deduplication */
  codeHash?: string
  /** Last access time for LRU */
  lastAccessedAt: number
  /** Timeout in milliseconds for execution */
  timeout?: number
  /** User code for in-process evaluation */
  userCode?: string
}

/**
 * Extended options for WorkerLoader with circuit breaker and logging
 */
export interface WorkerLoaderExtendedOptions extends WorkerLoaderOptions {
  /** Logger instance for debugging */
  logger?: WorkerLoaderLogger
  /** Circuit breaker configuration */
  circuitBreaker?: Partial<CircuitBreakerConfig>
  /** TTL for cached entries in milliseconds (0 = no expiry) */
  cacheTTL?: number
}

/**
 * Generate a cache key from function ID and optional code hash
 */
function generateCacheKey(functionId: string, codeHash?: string): string {
  return codeHash ? `${functionId}:${codeHash}` : functionId
}

/**
 * Simple hash function for code deduplication
 */
function hashCode(code: string): string {
  let hash = 0
  for (let i = 0; i < code.length; i++) {
    const char = code.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return hash.toString(36)
}

/**
 * WorkerLoader manages the loading and caching of function workers.
 *
 * It uses the loader service binding to fetch compiled function code
 * and returns WorkerStub instances that can be used to invoke functions.
 *
 * Features:
 * - Caching with LRU eviction and optional TTL
 * - Request coalescing for concurrent loads
 * - Code deduplication via content hashing
 * - Circuit breaker integration for failed loads
 * - Comprehensive logging for debugging
 */
export class WorkerLoader {
  private readonly fetcher: Fetcher | undefined
  private readonly loaderBinding: WorkerLoaderBinding | undefined
  private readonly options: Required<WorkerLoaderOptions>
  private readonly cache = new Map<string, CachedStub>()
  private readonly pendingLoads = new Map<string, Promise<WorkerStub>>()
  private readonly loadedFunctions = new Map<string, LoadFunctionResult>()
  /** Maps code hashes to function IDs for deduplication */
  private readonly codeHashIndex = new Map<string, string>()
  private hits = 0
  private misses = 0

  /** Logger for debugging */
  private readonly logger: WorkerLoaderLogger
  /** Cache TTL in milliseconds (0 = no expiry) */
  private readonly cacheTTL: number

  /** Circuit breaker configuration */
  private readonly circuitBreakerConfig: CircuitBreakerConfig
  /** Circuit breaker states per function */
  private readonly circuitBreakers = new Map<string, CircuitBreakerState>()

  constructor(loader?: Fetcher | WorkerLoaderBinding, options?: WorkerLoaderExtendedOptions) {
    this.options = {
      timeout: options?.timeout ?? 30000,
      maxCacheSize: options?.maxCacheSize ?? 1000,
    }

    this.logger = options?.logger ?? noopLogger
    this.cacheTTL = options?.cacheTTL ?? 0

    // Initialize circuit breaker config with defaults
    this.circuitBreakerConfig = {
      failureThreshold: options?.circuitBreaker?.failureThreshold ?? 5,
      resetTimeoutMs: options?.circuitBreaker?.resetTimeoutMs ?? 30000,
      successThreshold: options?.circuitBreaker?.successThreshold ?? 2,
      maxHalfOpenRequests: options?.circuitBreaker?.maxHalfOpenRequests ?? 1,
    }

    // Detect if this is a WorkerLoaderBinding (has .get method) or Fetcher (has .fetch method)
    if (loader && typeof (loader as WorkerLoaderBinding).get === 'function') {
      this.loaderBinding = loader as WorkerLoaderBinding
      this.fetcher = undefined
      this.logger.debug('Initialized with WorkerLoaderBinding (production mode)')
    } else {
      this.fetcher = loader as Fetcher | undefined
      this.loaderBinding = undefined
      this.logger.debug('Initialized with Fetcher or no loader (development mode)')
    }
  }

  /**
   * Get a WorkerStub for a given function ID.
   * Uses caching and request coalescing to minimize loads.
   *
   * @throws {CircuitBreakerOpenError} If the circuit breaker is open for this function
   * @throws {FunctionNotFoundError} If the function is not found
   * @throws {LoadTimeoutError} If loading times out
   */
  async get(functionId: string): Promise<WorkerStub> {
    this.logger.debug('Getting function', { functionId })

    // Check circuit breaker state
    const circuitState = this.getOrCreateCircuitBreaker(functionId)
    if (circuitState.state === 'open') {
      if (!this.shouldAttemptReset(functionId)) {
        this.logger.warn('Circuit breaker open, rejecting request', { functionId, failures: circuitState.failures })
        throw new CircuitBreakerOpenError(functionId, circuitState)
      }
      // Transition to half-open state
      this.transitionCircuitBreaker(functionId, 'half-open')
      this.logger.info('Circuit breaker transitioning to half-open', { functionId })
    }

    // Check cache first (with TTL validation)
    const cached = this.cache.get(functionId)
    if (cached && this.isCacheEntryValid(cached)) {
      this.hits++
      cached.lastAccessedAt = Date.now()
      this.logger.debug('Cache hit', { functionId, hitRate: this.getHitRate() })
      // Record success for circuit breaker recovery
      this.recordSuccess(functionId)
      return cached.stub
    }

    // Remove expired entry if present
    if (cached && !this.isCacheEntryValid(cached)) {
      this.logger.debug('Cache entry expired, removing', { functionId, age: Date.now() - cached.loadedAt })
      this.cache.delete(functionId)
    }

    // Check for pending load (request coalescing)
    const pending = this.pendingLoads.get(functionId)
    if (pending) {
      this.logger.debug('Coalescing with pending load', { functionId })
      return pending
    }

    // Start a new load
    this.misses++
    this.logger.debug('Cache miss, loading function', { functionId })
    const loadPromise = this.loadWorkerWithCircuitBreaker(functionId)
    this.pendingLoads.set(functionId, loadPromise)

    try {
      const stub = await loadPromise
      const now = Date.now()

      // Cache the result
      this.cache.set(functionId, {
        stub,
        loadedAt: now,
        lastAccessedAt: now,
      })

      // Enforce max cache size (LRU eviction)
      this.enforceMaxCacheSize()

      this.logger.info('Function loaded successfully', { functionId, cacheSize: this.cache.size })
      return stub
    } finally {
      this.pendingLoads.delete(functionId)
    }
  }

  /**
   * Check if a cache entry is still valid (not expired)
   */
  private isCacheEntryValid(entry: CachedStub): boolean {
    if (this.cacheTTL === 0) return true
    return Date.now() - entry.loadedAt < this.cacheTTL
  }

  /**
   * Get current cache hit rate
   */
  private getHitRate(): number {
    const total = this.hits + this.misses
    return total > 0 ? this.hits / total : 0
  }

  /**
   * Enforce max cache size using LRU eviction
   */
  private enforceMaxCacheSize(): void {
    while (this.cache.size > this.options.maxCacheSize) {
      let oldestKey: string | null = null
      let oldestTime = Infinity

      for (const [key, entry] of this.cache.entries()) {
        if (entry.lastAccessedAt < oldestTime) {
          oldestTime = entry.lastAccessedAt
          oldestKey = key
        }
      }

      if (oldestKey) {
        this.logger.debug('Evicting LRU cache entry', { key: oldestKey })
        this.cache.delete(oldestKey)
      } else {
        break
      }
    }
  }

  /**
   * Load a worker with circuit breaker tracking
   */
  private async loadWorkerWithCircuitBreaker(functionId: string): Promise<WorkerStub> {
    try {
      const stub = await this.loadWorker(functionId)
      this.recordSuccess(functionId)
      return stub
    } catch (error) {
      this.recordFailure(functionId)
      throw error
    }
  }

  /**
   * Get or create circuit breaker state for a function
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
   * Record a successful load for circuit breaker
   */
  private recordSuccess(functionId: string): void {
    const state = this.getOrCreateCircuitBreaker(functionId)

    if (state.state === 'half-open') {
      state.successes++
      this.logger.debug('Circuit breaker half-open success', { functionId, successes: state.successes })
      if (state.successes >= this.circuitBreakerConfig.successThreshold) {
        this.transitionCircuitBreaker(functionId, 'closed')
        this.logger.info('Circuit breaker closed after recovery', { functionId })
      }
    } else if (state.state === 'closed') {
      // Reset failures on success in closed state
      if (state.failures > 0) {
        this.logger.debug('Resetting failure count on success', { functionId, previousFailures: state.failures })
        state.failures = 0
      }
    }
  }

  /**
   * Record a failed load for circuit breaker
   */
  private recordFailure(functionId: string): void {
    const state = this.getOrCreateCircuitBreaker(functionId)
    state.failures++
    state.lastFailureTime = Date.now()

    this.logger.warn('Load failure recorded', { functionId, failures: state.failures, state: state.state })

    if (state.state === 'half-open') {
      // Any failure in half-open state opens the circuit
      this.transitionCircuitBreaker(functionId, 'open')
      this.logger.warn('Circuit breaker opened from half-open state', { functionId })
    } else if (state.state === 'closed' && state.failures >= this.circuitBreakerConfig.failureThreshold) {
      this.transitionCircuitBreaker(functionId, 'open')
      this.logger.warn('Circuit breaker opened after threshold exceeded', { functionId, failures: state.failures })
    }
  }

  /**
   * Transition circuit breaker to a new state
   */
  private transitionCircuitBreaker(functionId: string, newState: CircuitState): void {
    const state = this.getOrCreateCircuitBreaker(functionId)
    const oldState = state.state
    state.state = newState
    state.lastStateChange = Date.now()

    if (newState === 'closed') {
      state.failures = 0
      state.successes = 0
    } else if (newState === 'half-open') {
      state.successes = 0
    }

    this.logger.info('Circuit breaker state transition', { functionId, from: oldState, to: newState })
  }

  /**
   * Check if we should attempt to reset an open circuit breaker
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
   * Get the circuit breaker state for a specific function
   */
  getCircuitBreakerState(functionId: string): CircuitBreakerState | undefined {
    return this.circuitBreakers.get(functionId)
  }

  /**
   * Reset the circuit breaker for a specific function
   */
  resetCircuitBreaker(functionId: string): void {
    this.circuitBreakers.delete(functionId)
    this.logger.info('Circuit breaker reset', { functionId })
  }

  /**
   * Load a function using the ai-evaluate pattern.
   * Uses worker_loaders in production, Miniflare in development.
   *
   * Features:
   * - Code deduplication via content hashing
   * - Circuit breaker integration
   * - Comprehensive logging
   */
  async loadFunction(options: LoadFunctionOptions): Promise<LoadFunctionResult> {
    const { id, code, tests, script, options: funcOptions } = options
    const start = Date.now()

    this.logger.info('Loading function', { id, hasTests: !!tests, hasScript: !!script })

    // Check circuit breaker state
    const circuitState = this.getOrCreateCircuitBreaker(id)
    if (circuitState.state === 'open') {
      if (!this.shouldAttemptReset(id)) {
        this.logger.warn('Circuit breaker open for loadFunction', { id })
        const result: LoadFunctionResult = {
          success: false,
          error: `Circuit breaker open for function: ${id}`,
          developmentMode: !this.loaderBinding,
        }
        this.loadedFunctions.set(id, result)
        return result
      }
      this.transitionCircuitBreaker(id, 'half-open')
    }

    try {
      // Generate code hash for deduplication
      const codeHash = hashCode(code + (tests || '') + (script || ''))
      const cacheKey = generateCacheKey(id, codeHash)

      // Check if we have a cached entry with the same code hash
      const existingFunctionId = this.codeHashIndex.get(codeHash)
      if (existingFunctionId && existingFunctionId !== id) {
        const existingCached = this.cache.get(existingFunctionId)
        if (existingCached && this.isCacheEntryValid(existingCached)) {
          this.logger.info('Reusing cached stub with same code hash', { id, existingId: existingFunctionId, codeHash })
          // Create a new entry pointing to the same stub
          const now = Date.now()
          this.cache.set(id, {
            stub: { ...existingCached.stub, id }, // Clone with new ID
            loadedAt: now,
            lastAccessedAt: now,
            codeHash,
          })
          this.hits++
          this.recordSuccess(id)
          const result: LoadFunctionResult = {
            success: true,
            developmentMode: !this.loaderBinding,
          }
          this.loadedFunctions.set(id, result)
          return result
        }
      }

      // Generate worker code from function source
      const workerCode = this.generateWorkerCode({
        code,
        tests,
        script,
        sdk: funcOptions?.sdk,
        blockNetwork: funcOptions?.fetch === null,
      })

      this.logger.debug('Generated worker code', { id, codeLength: workerCode.length, codeHash })

      // Production path: Use worker_loaders binding
      if (this.loaderBinding) {
        const workerId = `function-${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`

        this.logger.debug('Using worker_loaders binding', { id, workerId })

        const worker = this.loaderBinding.get(workerId, async () => ({
          mainModule: 'worker.js',
          modules: {
            'worker.js': workerCode,
          },
          compatibilityDate: '2024-01-01',
          globalOutbound: funcOptions?.fetch === null ? null : undefined,
        }))

        // Execute to verify the code loads and works correctly
        const executeResponse = await worker.fetch(new Request('http://sandbox/execute'))
        const executeData = await executeResponse.json() as Record<string, unknown>

        // Create a stub wrapper for this loaded function
        const stub: WorkerStub = {
          id,
          fetch: async (request: Request) => {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => {
              controller.abort()
            }, funcOptions?.timeout ?? this.options.timeout)

            try {
              const response = await worker.fetch(request)
              return response
            } finally {
              clearTimeout(timeoutId)
            }
          },
          connect: async (request: Request) => worker.fetch(request),
          scheduled: async () => {
            await worker.fetch(new Request('http://internal/scheduled'))
          },
          queue: async () => {
            await worker.fetch(new Request('http://internal/queue'))
          },
        }

        // Cache the stub with code hash for deduplication
        const now = Date.now()
        this.cache.set(id, { stub, loadedAt: now, lastAccessedAt: now, codeHash })
        this.codeHashIndex.set(codeHash, id)
        this.enforceMaxCacheSize()

        this.recordSuccess(id)

        const loadTime = Date.now() - start
        this.logger.info('Function loaded via worker_loaders', { id, loadTimeMs: loadTime })

        const result: LoadFunctionResult = {
          success: executeData.success as boolean ?? true,
          value: executeData.value,
          logs: executeData.logs as LoadFunctionResult['logs'],
          testResults: executeData.testResults as LoadFunctionResult['testResults'],
          developmentMode: false,
        }
        this.loadedFunctions.set(id, result)
        return result
      }

      // Development path: Fall back to Miniflare or in-process evaluation
      this.logger.debug('Using Miniflare for development', { id })

      // Try Miniflare first, fall back to in-process evaluation if it fails
      let useMiniflare = false
      let Miniflare: typeof import('miniflare').Miniflare | undefined

      try {
        const miniflareModule = await import('miniflare')
        Miniflare = miniflareModule.Miniflare
        useMiniflare = true
      } catch {
        // Miniflare not available (e.g., in vitest-pool-workers), use in-process evaluation
        this.logger.debug('Miniflare not available, using in-process evaluation', { id })
      }

      if (useMiniflare && Miniflare) {
        try {
          const mf = new Miniflare({
            modules: true,
            script: workerCode,
            compatibilityDate: '2024-01-01',
          })

          try {
            // Execute to verify the code loads correctly
            const response = await mf.dispatchFetch('http://sandbox/execute')
            const data = await response.json() as Record<string, unknown>

            // Create a stub that uses Miniflare
            const stub: WorkerStub = {
              id,
              fetch: async (request: Request) => mf.dispatchFetch(request),
              connect: async (request: Request) => mf.dispatchFetch(request),
              scheduled: async () => {
                await mf.dispatchFetch(new Request('http://internal/scheduled'))
              },
              queue: async () => {
                await mf.dispatchFetch(new Request('http://internal/queue'))
              },
            }

            // Cache the stub with code hash for deduplication
            const now = Date.now()
            this.cache.set(id, { stub, loadedAt: now, lastAccessedAt: now, codeHash })
            this.codeHashIndex.set(codeHash, id)
            this.enforceMaxCacheSize()

            this.recordSuccess(id)

            const loadTime = Date.now() - start
            this.logger.info('Function loaded via Miniflare', { id, loadTimeMs: loadTime })

            const result: LoadFunctionResult = {
              success: data.success as boolean ?? true,
              value: data.value,
              logs: data.logs as LoadFunctionResult['logs'],
              testResults: data.testResults as LoadFunctionResult['testResults'],
              developmentMode: true,
            }
            this.loadedFunctions.set(id, result)
            return result
          } catch (error) {
            await mf.dispose()
            throw error
          }
        } catch (miniflareError) {
          // Miniflare instantiation or execution failed, fall back to in-process evaluation
          this.logger.debug('Miniflare failed, falling back to in-process evaluation', { id, error: (miniflareError as Error).message })
        }
      }

      // In-process evaluation fallback (for test environments)
      // Set up SDK globals if configured
      const sdkConfig = funcOptions?.sdk
      if (sdkConfig) {
        (globalThis as Record<string, unknown>).__SDK_CONFIG__ = sdkConfig;
        (globalThis as Record<string, unknown>).$ = {};
        (globalThis as Record<string, unknown>).db = {};
        (globalThis as Record<string, unknown>).ai = {};
        (globalThis as Record<string, unknown>).api = {}
      }

      // Check if network should be blocked
      const blockNetwork = funcOptions?.fetch === null

      // Transform user code to capture export default
      const transformedCode = code.replace(
        /export\s+default\s+/g,
        'module.exports = '
      )

      // Create exports container
      const exports: Record<string, unknown> = {}
      const moduleObj = { exports }

      // Parse and execute the user's code to get the default export
      let userDefault: { fetch?: (request: Request) => Promise<Response> } | null = null
      let compilationError: string | null = null

      try {
        // Execute the module code to populate exports and capture default
        // Note: The code runs in the current context. Dynamic imports like import('fs')
        // will fail in Workerd because Node.js modules are not available.
        const moduleFunction = new Function('exports', 'module', 'Request', 'Response', transformedCode)
        moduleFunction(exports, moduleObj, Request, Response)
        userDefault = moduleObj.exports as { fetch?: (request: Request) => Promise<Response> }
        Object.assign(exports, moduleObj.exports)
      } catch (error) {
        // Code compilation error - will be returned on fetch
        // Include the error name (e.g., "SyntaxError") in the message for better diagnostics
        const err = error as Error
        compilationError = err.name ? `${err.name}: ${err.message}` : (err.message || String(error))
        this.logger.error('Code compilation error', { id, error: compilationError })
      }

      // Create a sandboxed fetch wrapper that blocks network if configured
      const sandboxedFetch = blockNetwork
        ? async () => { throw new Error('Network access is disabled in this sandbox. fetch() calls are blocked.') }
        : globalThis.fetch

      // Create a stub that executes user code with sandbox protections
      // Logs array to capture console output - shared with result
      const capturedLogs: Array<{ level: string; message: string }> = []

      // Set up console capture for the stub
      const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        info: console.info,
        debug: console.debug,
      }

      const captureConsole = () => {
        console.log = (...args: unknown[]) => {
          capturedLogs.push({ level: 'log', message: args.map(String).join(' ') })
          originalConsole.log(...args)
        }
        console.warn = (...args: unknown[]) => {
          capturedLogs.push({ level: 'warn', message: args.map(String).join(' ') })
          originalConsole.warn(...args)
        }
        console.error = (...args: unknown[]) => {
          capturedLogs.push({ level: 'error', message: args.map(String).join(' ') })
          originalConsole.error(...args)
        }
        console.info = (...args: unknown[]) => {
          capturedLogs.push({ level: 'info', message: args.map(String).join(' ') })
          originalConsole.info(...args)
        }
        console.debug = (...args: unknown[]) => {
          capturedLogs.push({ level: 'debug', message: args.map(String).join(' ') })
          originalConsole.debug(...args)
        }
      }

      const restoreConsole = () => {
        console.log = originalConsole.log
        console.warn = originalConsole.warn
        console.error = originalConsole.error
        console.info = originalConsole.info
        console.debug = originalConsole.debug
      }

      // Reference to this loader for updating result
      const loaderRef = this
      const functionId = id

      // Capture the timeout for this function
      const executionTimeout = funcOptions?.timeout ?? this.options.timeout

      const stub: WorkerStub = {
        id,
        fetch: async (request: Request) => {
          // Record start time for execution duration
          const startTime = Date.now()

          // If there was a compilation error, return it
          if (compilationError) {
            const duration = Date.now() - startTime
            return new Response(JSON.stringify({
              success: false,
              error: compilationError,
            }), {
              status: 500,
              headers: {
                'Content-Type': 'application/json',
                'X-Execution-Duration': String(duration),
              },
            })
          }

          // Execute the user's fetch handler if available
          if (userDefault && typeof userDefault.fetch === 'function') {
            // Store original fetch and replace with sandboxed version
            const originalFetch = globalThis.fetch
            if (blockNetwork) {
              (globalThis as Record<string, unknown>).fetch = sandboxedFetch
            }

            // Start capturing console output
            captureConsole()

            // Create a timeout promise that rejects after the configured timeout
            const timeoutPromise = new Promise<Response>((_, reject) => {
              setTimeout(() => {
                reject(new Error('Execution timeout exceeded'))
              }, executionTimeout)
            })

            try {
              // Race the user's fetch handler against the timeout
              const response = await Promise.race([
                userDefault.fetch(request),
                timeoutPromise
              ])

              // Update the loadedFunctions result with captured logs
              const existingResult = loaderRef.loadedFunctions.get(functionId)
              if (existingResult) {
                existingResult.logs = [...capturedLogs]
              }

              // Calculate execution duration and add to response headers
              const duration = Date.now() - startTime
              const newHeaders = new Headers(response.headers)
              newHeaders.set('X-Execution-Duration', String(duration))

              return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: newHeaders,
              })
            } catch (userError) {
              // Return sandbox/user errors as JSON error response with stack trace
              const err = userError as Error
              const errorMessage = err.message || String(userError)
              const stack = err.stack

              // Update the loadedFunctions result with captured logs
              const existingResult = loaderRef.loadedFunctions.get(functionId)
              if (existingResult) {
                existingResult.logs = [...capturedLogs]
              }

              const duration = Date.now() - startTime
              return new Response(JSON.stringify({
                success: false,
                error: errorMessage,
                stack: stack,
              }), {
                status: 500,
                headers: {
                  'Content-Type': 'application/json',
                  'X-Execution-Duration': String(duration),
                },
              })
            } finally {
              // Restore original fetch and console
              if (blockNetwork) {
                (globalThis as Record<string, unknown>).fetch = originalFetch
              }
              restoreConsole()
            }
          }

          // No fetch handler - return default response
          const duration = Date.now() - startTime
          return new Response(JSON.stringify({
            exports: Object.keys(exports),
            moduleExports: Object.keys(moduleObj.exports),
          }), {
            headers: {
              'Content-Type': 'application/json',
              'X-Execution-Duration': String(duration),
            },
          })
        },
        connect: async () => new Response('Not supported in test mode'),
        scheduled: async () => {},
        queue: async () => {},
      }

      // Cache the stub
      const now = Date.now()
      this.cache.set(id, { stub, loadedAt: now, lastAccessedAt: now, codeHash })
      this.codeHashIndex.set(codeHash, id)
      this.enforceMaxCacheSize()

      this.recordSuccess(id)

      const loadTime = Date.now() - start
      this.logger.info('Function loaded via in-process evaluation', { id, loadTimeMs: loadTime })

      // Execute script and/or tests if provided
      let scriptValue: unknown
      let testResults: LoadFunctionResult['testResults'] | undefined
      let scriptTestSuccess = true

      if ((script || tests) && !compilationError) {
        const evalResult = await this.evaluateInProcess({
          code: transformedCode,
          tests,
          script,
          sdk: sdkConfig,
        })
        scriptValue = evalResult.value
        testResults = evalResult.testResults
        scriptTestSuccess = evalResult.success
      }

      const result: LoadFunctionResult = {
        success: !compilationError && scriptTestSuccess,
        error: compilationError ?? undefined,
        value: scriptValue,
        logs: [],
        testResults,
        developmentMode: true,
      }
      this.loadedFunctions.set(id, result)
      return result
    } catch (error) {
      const loadTime = Date.now() - start
      const errorMessage = error instanceof Error ? error.message : String(error)

      this.logger.error('Function load failed', { id, error: errorMessage, loadTimeMs: loadTime })
      this.recordFailure(id)

      // Determine specific error type for better error handling
      let wrappedError: WorkerLoaderError
      if (errorMessage.includes('Syntax') || errorMessage.includes('parse')) {
        wrappedError = new CompilationError(id, errorMessage, error instanceof Error ? error : undefined)
      } else if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
        wrappedError = new LoadTimeoutError(id, this.options.timeout, error instanceof Error ? error : undefined)
      } else {
        wrappedError = new WorkerLoaderError(
          `Failed to load function: ${id}: ${errorMessage}`,
          'LOAD_ERROR',
          { id },
          error instanceof Error ? error : undefined
        )
      }

      const result: LoadFunctionResult = {
        success: false,
        error: wrappedError.message,
        developmentMode: !this.loaderBinding,
      }
      this.loadedFunctions.set(id, result)
      return result
    }
  }

  /**
   * Generate worker code from function source.
   * This wraps the user code in a worker-compatible format.
   */
  private generateWorkerCode(options: {
    code: string
    tests?: string
    script?: string
    sdk?: Record<string, unknown>
    blockNetwork?: boolean
  }): string {
    const { code, tests, script, sdk, blockNetwork } = options

    // Build SDK globals if configured
    const sdkCode = sdk ? this.generateSDKCode(sdk) : ''

    // Transform user code to capture export default
    // Replace 'export default' with variable assignment so we can capture it
    const transformedCode = code.replace(
      /export\s+default\s+/g,
      '__userDefault__ = '
    )

    // Build the worker code
    return `
// Generated worker code for function execution
${sdkCode}

// ============================================
// SANDBOX ISOLATION - Block dangerous APIs
// ============================================

// Block Node.js globals for security
const process = undefined;
const require = (specifier) => {
  throw new Error(\`require() is not available in the sandbox. Module "\${specifier}" cannot be loaded.\`);
};
const __filename = undefined;
const __dirname = undefined;
const Buffer = undefined;

// Network access control
const __networkBlocked__ = ${blockNetwork === true};
const __originalFetch__ = globalThis.fetch;

if (__networkBlocked__) {
  globalThis.fetch = async (input, init) => {
    throw new Error('Network access is disabled in this sandbox. fetch() calls are blocked.');
  };
}

// ============================================
// Console capture
// ============================================
const __logs__ = [];
const __originalConsole__ = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info,
  debug: console.debug,
};

console.log = (...args) => { __logs__.push({ level: 'log', message: args.map(String).join(' '), timestamp: Date.now() }); };
console.warn = (...args) => { __logs__.push({ level: 'warn', message: args.map(String).join(' '), timestamp: Date.now() }); };
console.error = (...args) => { __logs__.push({ level: 'error', message: args.map(String).join(' '), timestamp: Date.now() }); };
console.info = (...args) => { __logs__.push({ level: 'info', message: args.map(String).join(' '), timestamp: Date.now() }); };
console.debug = (...args) => { __logs__.push({ level: 'debug', message: args.map(String).join(' '), timestamp: Date.now() }); };

// ============================================
// Module exports container
// ============================================
const exports = {};
const module = { exports };

// Placeholder for user's default export
let __userDefault__ = null;

// ============================================
// User module code (transformed)
// ============================================
${transformedCode}

// Make exports available globally for tests
Object.assign(globalThis, exports, module.exports);

${tests ? `
// Test framework (minimal vitest-compatible implementation)
const __tests__ = [];
const __describes__ = [];

function describe(name, fn) {
  __describes__.push(name);
  fn();
  __describes__.pop();
}

function it(name, fn) {
  const fullName = [...__describes__, name].join(' > ');
  __tests__.push({ name: fullName, fn });
}

const test = it;

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(\`Expected \${JSON.stringify(expected)} but got \${JSON.stringify(actual)}\`);
      }
    },
    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(\`Expected \${JSON.stringify(expected)} but got \${JSON.stringify(actual)}\`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(\`Expected truthy value but got \${JSON.stringify(actual)}\`);
      }
    },
    toBeFalsy() {
      if (actual) {
        throw new Error(\`Expected falsy value but got \${JSON.stringify(actual)}\`);
      }
    },
    toContain(expected) {
      if (!String(actual).includes(expected)) {
        throw new Error(\`Expected \${JSON.stringify(actual)} to contain \${JSON.stringify(expected)}\`);
      }
    },
    toMatch(pattern) {
      if (!pattern.test(String(actual))) {
        throw new Error(\`Expected \${JSON.stringify(actual)} to match \${pattern}\`);
      }
    },
    toThrow(expected) {
      let threw = false;
      let error = null;
      try {
        actual();
      } catch (e) {
        threw = true;
        error = e;
      }
      if (!threw) {
        throw new Error('Expected function to throw but it did not');
      }
      if (expected && !String(error?.message).includes(expected)) {
        throw new Error(\`Expected error message to contain \${expected} but got \${error?.message}\`);
      }
    },
  };
}

// User test code
${tests}
` : ''}

async function runTests() {
  ${tests ? `
  const results = { total: 0, passed: 0, failed: 0, tests: [], duration: 0 };
  const startTime = Date.now();

  for (const t of __tests__) {
    results.total++;
    const testStart = Date.now();
    try {
      await t.fn();
      results.passed++;
      results.tests.push({ name: t.name, passed: true, duration: Date.now() - testStart });
    } catch (e) {
      results.failed++;
      results.tests.push({ name: t.name, passed: false, error: e.message, duration: Date.now() - testStart });
    }
  }

  results.duration = Date.now() - startTime;
  return results;
  ` : 'return null;'}
}

async function runScript() {
  ${script ? `return (async () => { ${script} })();` : 'return undefined;'}
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const start = Date.now();

    try {
      if (url.pathname === '/execute') {
        const testResults = await runTests();
        const value = await runScript();
        const success = testResults ? testResults.failed === 0 : true;

        return new Response(JSON.stringify({
          success,
          value,
          logs: __logs__,
          testResults,
          duration: Date.now() - start,
        }), {
          headers: {
            'Content-Type': 'application/json',
            'X-Execution-Duration': String(Date.now() - start),
          },
        });
      }

      // If user's default export has a fetch handler, delegate to it
      if (__userDefault__ && typeof __userDefault__.fetch === 'function') {
        return await __userDefault__.fetch(request);
      }

      // Default handler - return function info
      return new Response(JSON.stringify({
        exports: Object.keys(exports),
        moduleExports: Object.keys(module.exports),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
        logs: __logs__,
        duration: Date.now() - start,
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'X-Execution-Duration': String(Date.now() - start),
        },
      });
    }
  }
};
`
  }

  /**
   * Generate SDK code for injection into sandbox
   */
  private generateSDKCode(config: Record<string, unknown>): string {
    return `
// SDK Configuration
globalThis.__SDK_CONFIG__ = ${JSON.stringify(config)};

// SDK Globals (stubs for sandbox)
globalThis.$ = {};
globalThis.db = {};
globalThis.ai = {};
globalThis.api = {};
`
  }

  /**
   * In-process evaluation for test environments where Miniflare is not available.
   * This provides a simpler execution model for unit testing.
   */
  private async evaluateInProcess(options: {
    code: string
    tests?: string
    script?: string
    sdk?: Record<string, unknown>
  }): Promise<{
    success: boolean
    value?: unknown
    logs: Array<{ level: string; message: string }>
    testResults?: LoadFunctionResult['testResults']
  }> {
    const { code, tests, script, sdk } = options
    const logs: Array<{ level: string; message: string }> = []

    // Create exports container
    const exports: Record<string, unknown> = {}
    const module = { exports }

    // Set up SDK globals if configured
    if (sdk) {
      (globalThis as Record<string, unknown>).__SDK_CONFIG__ = sdk;
      (globalThis as Record<string, unknown>).$ = {};
      (globalThis as Record<string, unknown>).db = {};
      (globalThis as Record<string, unknown>).ai = {};
      (globalThis as Record<string, unknown>).api = {}
    }

    try {
      // Execute the module code to populate exports
      const moduleFunction = new Function('exports', 'module', code)
      moduleFunction(exports, module)

      // Merge module.exports into exports
      Object.assign(exports, module.exports)

      // Run tests if provided
      let testResults: LoadFunctionResult['testResults'] | undefined

      if (tests) {
        testResults = await this.runInProcessTests(tests, exports)
      }

      // Run script if provided
      let value: unknown

      if (script) {
        // Create a context with exports available
        const scriptContext: Record<string, unknown> = { ...exports }
        const scriptFunction = new Function(
          ...Object.keys(scriptContext),
          script
        )
        value = await scriptFunction(...Object.values(scriptContext))
      }

      const success = testResults ? testResults.failed === 0 : true

      return { success, value, logs, testResults }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logs.push({ level: 'error', message: errorMessage })
      return { success: false, logs }
    }
  }

  /**
   * Run vitest-style tests in-process against module exports.
   */
  private async runInProcessTests(
    testCode: string,
    moduleExports: Record<string, unknown>
  ): Promise<NonNullable<LoadFunctionResult['testResults']>> {
    const tests: Array<{ name: string; fn: () => void | Promise<void> }> = []
    const describes: string[] = []

    // Test framework implementation
    const describe = (name: string, fn: () => void) => {
      describes.push(name)
      fn()
      describes.pop()
    }

    const it = (name: string, fn: () => void | Promise<void>) => {
      const fullName = [...describes, name].join(' > ')
      tests.push({ name: fullName, fn })
    }

    const test = it

    const expect = (actual: unknown) => ({
      toBe(expected: unknown) {
        if (actual !== expected) {
          throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`)
        }
      },
      toEqual(expected: unknown) {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`)
        }
      },
      toBeTruthy() {
        if (!actual) {
          throw new Error(`Expected truthy value but got ${JSON.stringify(actual)}`)
        }
      },
      toBeFalsy() {
        if (actual) {
          throw new Error(`Expected falsy value but got ${JSON.stringify(actual)}`)
        }
      },
      toContain(expected: string) {
        if (!String(actual).includes(expected)) {
          throw new Error(`Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`)
        }
      },
      toMatch(pattern: RegExp) {
        if (!pattern.test(String(actual))) {
          throw new Error(`Expected ${JSON.stringify(actual)} to match ${pattern}`)
        }
      },
      toThrow(expected?: string) {
        let threw = false
        let error: Error | null = null
        try {
          (actual as () => void)()
        } catch (e) {
          threw = true
          error = e as Error
        }
        if (!threw) {
          throw new Error('Expected function to throw but it did not')
        }
        if (expected && !String(error?.message).includes(expected)) {
          throw new Error(`Expected error message to contain ${expected} but got ${error?.message}`)
        }
      },
    })

    // Create execution context with exports available as globals
    const contextKeys = Object.keys(moduleExports)
    const contextValues = Object.values(moduleExports)

    // Execute test code to register tests
    const testFunction = new Function(
      'describe', 'it', 'test', 'expect',
      ...contextKeys,
      testCode
    )
    testFunction(describe, it, test, expect, ...contextValues)

    // Run all registered tests
    const results: NonNullable<LoadFunctionResult['testResults']> = {
      total: tests.length,
      passed: 0,
      failed: 0,
      tests: [],
    }

    for (const t of tests) {
      try {
        await t.fn()
        results.passed++
        results.tests.push({ name: t.name, passed: true })
      } catch (e) {
        results.failed++
        results.tests.push({
          name: t.name,
          passed: false,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    return results
  }

  /**
   * Execute user code with timeout handling.
   * Parses the user code to extract the default export's fetch handler and executes it.
   */
  private async executeUserCode(code: string, request: Request, signal: AbortSignal): Promise<Response> {
    // Create a promise that races the execution against the abort signal
    return new Promise<Response>((resolve, reject) => {
      // Set up abort handler
      if (signal.aborted) {
        reject(new Error('Execution timeout exceeded'))
        return
      }

      const abortHandler = () => {
        reject(new Error('Execution timeout exceeded'))
      }
      signal.addEventListener('abort', abortHandler, { once: true })

      // Execute the user code
      const executeAsync = async () => {
        try {
          // Create exports container
          const exports: Record<string, unknown> = {}
          const module = { exports }

          // Parse and execute the module code to get the default export
          // We need to handle ES module syntax: export default { async fetch() {} }
          // Transform it to CommonJS-style for evaluation
          let transformedCode = code

          // Handle 'export default' pattern
          if (code.includes('export default')) {
            transformedCode = code.replace(/export\s+default\s+/, 'module.exports = ')
          }

          // Execute the code to get exports
          const moduleFunction = new Function('exports', 'module', 'Request', 'Response', transformedCode)
          moduleFunction(exports, module, Request, Response)

          // Get the default export (fetch handler)
          const handler = module.exports as { fetch?: (request: Request) => Promise<Response> }

          if (!handler || typeof handler.fetch !== 'function') {
            signal.removeEventListener('abort', abortHandler)
            resolve(new Response(JSON.stringify({
              error: 'No fetch handler found in module',
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            }))
            return
          }

          // Execute the fetch handler
          const response = await handler.fetch(request)
          signal.removeEventListener('abort', abortHandler)
          resolve(response)
        } catch (error) {
          signal.removeEventListener('abort', abortHandler)
          if (signal.aborted) {
            reject(new Error('Execution timeout exceeded'))
          } else {
            reject(error)
          }
        }
      }

      executeAsync()
    })
  }

  /**
   * Load a worker using the legacy Fetcher interface
   *
   * @throws {NoLoaderConfiguredError} If no loader fetcher is configured
   * @throws {FunctionNotFoundError} If the function is not found
   * @throws {LoadTimeoutError} If loading times out
   * @throws {LoaderServiceError} If the loader service returns an error
   */
  private async loadWorker(functionId: string): Promise<WorkerStub> {
    if (!this.fetcher) {
      this.logger.error('No loader fetcher configured', { functionId })
      throw new NoLoaderConfiguredError()
    }

    this.logger.debug('Loading worker via Fetcher', { functionId })
    const startTime = Date.now()

    // Create timeout controller
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
    }, this.options.timeout)

    try {
      // Fetch function metadata from loader service
      const response = await this.fetcher.fetch(
        new Request(`https://loader.internal/functions/${functionId}`, {
          signal: controller.signal,
        })
      )

      if (!response.ok) {
        const data = await response.json() as { error?: string }
        if (response.status === 404) {
          this.logger.warn('Function not found', { functionId, statusCode: 404 })
          throw new FunctionNotFoundError(functionId)
        }
        const errorMessage = data.error || `Failed to load function: ${response.status}`
        this.logger.error('Loader service error', { functionId, statusCode: response.status, error: errorMessage })
        throw new LoaderServiceError(functionId, errorMessage, response.status)
      }

      // Parse the response to get function info
      const data = await response.json() as { id: string; status: string }

      this.logger.debug('Received function metadata', { functionId, status: data.status })

      // Create and return the WorkerStub
      const stub: WorkerStub = {
        id: functionId,
        fetch: async (request: Request) => {
          // Proxy the request to the loaded function
          const proxyResponse = await this.fetcher!.fetch(
            new Request(`https://loader.internal/execute/${functionId}`, {
              method: request.method,
              headers: request.headers,
              body: request.body,
            })
          )
          return proxyResponse
        },
        connect: async (request: Request) => {
          return this.fetcher!.fetch(
            new Request(`https://loader.internal/connect/${functionId}`, {
              method: 'GET',
              headers: {
                ...Object.fromEntries(request.headers),
                'Upgrade': 'websocket',
              },
            })
          )
        },
        scheduled: async (scheduledController: ScheduledController) => {
          await this.fetcher!.fetch(
            new Request(`https://loader.internal/scheduled/${functionId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                cron: scheduledController.cron,
                scheduledTime: scheduledController.scheduledTime,
              }),
            })
          )
        },
        queue: async (batch: MessageBatch<unknown>) => {
          await this.fetcher!.fetch(
            new Request(`https://loader.internal/queue/${functionId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                queue: batch.queue,
                messages: batch.messages.map(m => ({
                  id: m.id,
                  timestamp: m.timestamp.toISOString(),
                  body: m.body,
                })),
              }),
            })
          )
        },
      }

      const loadTime = Date.now() - startTime
      this.logger.info('Worker loaded successfully', { functionId, loadTimeMs: loadTime })

      return stub
    } catch (error) {
      // Re-throw our custom errors
      if (error instanceof WorkerLoaderError) {
        throw error
      }

      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.error('Load timeout', { functionId, timeoutMs: this.options.timeout })
        throw new LoadTimeoutError(functionId, this.options.timeout, error)
      }

      // Wrap unknown errors
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logger.error('Unexpected error during load', { functionId, error: errorMessage })
      throw new WorkerLoaderError(
        `Failed to load function: ${functionId}: ${errorMessage}`,
        'UNEXPECTED_ERROR',
        { functionId },
        error instanceof Error ? error : undefined
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Invalidate a cached function, forcing reload on next get()
   */
  invalidate(functionId: string): void {
    const cached = this.cache.get(functionId)
    if (cached?.codeHash) {
      // Remove from code hash index if this was the only entry
      const existingId = this.codeHashIndex.get(cached.codeHash)
      if (existingId === functionId) {
        this.codeHashIndex.delete(cached.codeHash)
      }
    }
    this.cache.delete(functionId)
    this.loadedFunctions.delete(functionId)
    this.logger.debug('Function invalidated', { functionId })
  }

  /**
   * Clear the entire cache
   */
  clearCache(): void {
    const size = this.cache.size
    this.cache.clear()
    this.loadedFunctions.clear()
    this.codeHashIndex.clear()
    this.hits = 0
    this.misses = 0
    this.logger.info('Cache cleared', { previousSize: size })
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
    }
  }

  /**
   * Get extended cache statistics including hit rate and deduplication info
   */
  getExtendedCacheStats(): CacheStats & { hitRate: number; deduplicatedEntries: number } {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.getHitRate(),
      deduplicatedEntries: this.codeHashIndex.size,
    }
  }
}
