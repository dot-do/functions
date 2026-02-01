/**
 * @dotdo/functions
 * Official SDK for Functions.do - Multi-language serverless platform
 */

// Re-export create-function utilities
export { createFunction, type FunctionEnv, type FunctionContext, type FunctionHandler, type FunctionExport } from './create-function'

// Re-export capnweb RpcTarget
export { RpcTarget } from './capnweb'

// Re-export FunctionTarget and related types
export {
  FunctionTarget,
  RpcError,
  type WorkerStub,
  type TracingHooks,
  type SpanContext,
  type RequestMetrics,
  type AggregatedMetrics,
  type FunctionTargetOptions,
} from './function-target'

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for function invocation errors
 */
export enum FunctionErrorCode {
  /** Network error - request could not be sent */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** Request timed out */
  TIMEOUT = 'TIMEOUT',
  /** Authentication failed - invalid API key */
  UNAUTHORIZED = 'UNAUTHORIZED',
  /** Access forbidden - insufficient permissions */
  FORBIDDEN = 'FORBIDDEN',
  /** Function not found */
  NOT_FOUND = 'NOT_FOUND',
  /** Invalid request parameters */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /** Rate limit exceeded */
  RATE_LIMITED = 'RATE_LIMITED',
  /** Function execution error */
  EXECUTION_ERROR = 'EXECUTION_ERROR',
  /** Server error */
  SERVER_ERROR = 'SERVER_ERROR',
  /** Unknown error */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Base error class for all function client errors
 */
export class FunctionClientError extends Error {
  public readonly code: FunctionErrorCode
  public readonly statusCode: number
  public readonly details: unknown
  public readonly requestId: string | undefined
  public readonly retryAfter: number | undefined
  public readonly retryable: boolean

  constructor(
    message: string,
    statusCode: number,
    options: {
      code?: FunctionErrorCode
      details?: unknown
      requestId?: string | undefined
      retryAfter?: number | undefined
    } = {}
  ) {
    super(message)
    this.name = 'FunctionClientError'
    this.statusCode = statusCode
    this.code = options.code ?? FunctionClientError.codeFromStatus(statusCode)
    this.details = options.details
    this.requestId = options.requestId
    this.retryAfter = options.retryAfter
    this.retryable = FunctionClientError.isRetryable(this.code, statusCode)
  }

  private static codeFromStatus(status: number): FunctionErrorCode {
    if (status === 0) return FunctionErrorCode.NETWORK_ERROR
    if (status === 401) return FunctionErrorCode.UNAUTHORIZED
    if (status === 403) return FunctionErrorCode.FORBIDDEN
    if (status === 404) return FunctionErrorCode.NOT_FOUND
    if (status === 400 || status === 422) return FunctionErrorCode.VALIDATION_ERROR
    if (status === 429) return FunctionErrorCode.RATE_LIMITED
    if (status === 408 || status === 504) return FunctionErrorCode.TIMEOUT
    if (status >= 500) return FunctionErrorCode.SERVER_ERROR
    return FunctionErrorCode.UNKNOWN
  }

  private static isRetryable(code: FunctionErrorCode, statusCode: number): boolean {
    // Retryable error codes
    const retryableCodes = [
      FunctionErrorCode.NETWORK_ERROR,
      FunctionErrorCode.TIMEOUT,
      FunctionErrorCode.RATE_LIMITED,
      FunctionErrorCode.SERVER_ERROR,
    ]
    if (retryableCodes.includes(code)) return true
    // Also retry on 502, 503
    if (statusCode === 502 || statusCode === 503) return true
    return false
  }
}

/**
 * Error thrown when a network request fails
 */
export class NetworkError extends FunctionClientError {
  constructor(message: string, cause?: Error) {
    super(message, 0, { code: FunctionErrorCode.NETWORK_ERROR })
    this.name = 'NetworkError'
    this.cause = cause
  }
}

/**
 * Error thrown when a request times out
 */
export class TimeoutError extends FunctionClientError {
  constructor(message: string, timeout: number) {
    super(message, 408, { code: FunctionErrorCode.TIMEOUT, details: { timeout } })
    this.name = 'TimeoutError'
  }
}

/**
 * Error thrown when rate limit is exceeded
 */
export class RateLimitError extends FunctionClientError {
  constructor(message: string, retryAfter: number | undefined) {
    super(message, 429, { code: FunctionErrorCode.RATE_LIMITED, retryAfter })
    this.name = 'RateLimitError'
  }
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends FunctionClientError {
  public readonly field: string | undefined

  constructor(message: string, field: string | undefined = undefined, details?: unknown) {
    super(message, 400, { code: FunctionErrorCode.VALIDATION_ERROR, details })
    this.name = 'ValidationError'
    this.field = field
  }
}

/**
 * Error thrown when function execution fails
 */
export class ExecutionError extends FunctionClientError {
  public readonly functionId: string
  public readonly logs: string[] | undefined

  constructor(message: string, functionId: string, logs: string[] | undefined = undefined, details?: unknown) {
    super(message, 500, { code: FunctionErrorCode.EXECUTION_ERROR, details })
    this.name = 'ExecutionError'
    this.functionId = functionId
    this.logs = logs
  }
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Retry configuration options
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 0 - no retries) */
  retries?: number
  /** Initial delay in milliseconds before first retry (default: 1000) */
  initialDelay?: number
  /** Maximum delay in milliseconds between retries (default: 30000) */
  maxDelay?: number
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number
  /** Whether to add jitter to retry delays (default: true) */
  jitter?: boolean
  /** Custom function to determine if an error is retryable */
  retryIf?: (error: FunctionClientError) => boolean
  /** Callback invoked before each retry attempt */
  onRetry?: (error: FunctionClientError, attempt: number, delay: number) => void
}

/**
 * Options for invoking a function
 */
export interface InvokeOptions extends RetryConfig {
  /** Request timeout in milliseconds */
  timeout?: number | undefined
  /** AbortSignal for cancellation */
  signal?: AbortSignal | null
  /** Custom headers to include in the request */
  headers?: Record<string, string>
}

/**
 * Options for streaming function invocation
 */
export interface StreamOptions extends InvokeOptions {
  /** Chunk processing mode: 'text' for string chunks, 'json' for parsed JSON */
  mode?: 'text' | 'json'
}

/**
 * A single batch invoke request item
 */
export interface BatchInvokeRequest<TInput = unknown> {
  /** Function ID to invoke */
  functionId: string
  /** Input data for the function */
  input?: TInput
  /** Per-request options (optional) */
  options?: InvokeOptions
}

/**
 * Result of a batch invoke operation for a single function
 */
export interface BatchInvokeResultItem<TOutput = unknown> {
  /** Function ID that was invoked */
  functionId: string
  /** Whether the invocation succeeded */
  success: boolean
  /** Result if successful */
  result?: InvokeResult<TOutput>
  /** Error if failed */
  error?: FunctionClientError
}

/**
 * Batch invoke options
 */
export interface BatchInvokeOptions extends RetryConfig {
  /** Maximum concurrent requests (default: 5) */
  concurrency?: number
  /** Whether to stop on first error (default: false) */
  stopOnError?: boolean
  /** Request timeout per function */
  timeout?: number
}

// Types
export interface FunctionClientConfig {
  apiKey: string
  baseUrl?: string
  timeout?: number
  /** Default retry configuration for all requests */
  defaultRetry?: RetryConfig
}

export interface FunctionMetadata {
  name: string
  description?: string
  language?: string
  environment?: Record<string, string>
  routes?: string[]
  tags?: string[]
}

export interface FunctionResponse {
  id: string
  name: string
  url: string
  createdAt: string
  updatedAt?: string
  status: 'active' | 'inactive' | 'error' | 'deploying'
  description?: string
  language?: string
  environment?: Record<string, string>
  routes?: string[]
  tags?: string[]
  code?: string
}

export interface InvokeResult<T = unknown> {
  result: T
  executionTime: number
  functionId: string
  logs?: string[]
  memoryUsed?: number
}

export interface DeployResult {
  id: string
  name: string
  url: string
  createdAt: string
}

export interface ListOptions {
  limit?: number
  offset?: number
  status?: 'active' | 'inactive' | 'error' | 'deploying'
}

export interface GetOptions {
  includeCode?: boolean
}

export interface DeleteResult {
  deleted: boolean
  id: string
  alreadyDeleted?: boolean
}

/**
 * A chunk received during streaming
 */
export interface StreamChunk<T = unknown> {
  /** The chunk data */
  data: T
  /** Index of the chunk (0-based) */
  index: number
  /** Whether this is the final chunk */
  done: boolean
}

/**
 * Async iterable stream of function output chunks
 */
export interface FunctionStream<T = unknown> extends AsyncIterable<StreamChunk<T>> {
  /** Cancel the stream */
  cancel(): void
  /** Whether the stream has been cancelled */
  cancelled: boolean
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate delay for exponential backoff with optional jitter
 */
function calculateBackoffDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  multiplier: number,
  jitter: boolean
): number {
  const exponentialDelay = initialDelay * Math.pow(multiplier, attempt - 1)
  const delay = Math.min(exponentialDelay, maxDelay)
  if (jitter) {
    // Add up to 25% jitter
    return delay * (0.75 + Math.random() * 0.5)
  }
  return delay
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timeout = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

// ============================================================================
// Client Implementation
// ============================================================================

// Client class
export class FunctionClient {
  private apiKey: string
  private baseUrl: string
  private timeout: number
  private defaultRetry: RetryConfig
  private lastAuthError: FunctionClientError | null = null

  constructor(config: FunctionClientConfig) {
    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new Error('API key is required')
    }
    this.apiKey = config.apiKey.trim()
    this.baseUrl = config.baseUrl ?? 'https://api.functions.do'
    this.timeout = config.timeout ?? 60000
    this.defaultRetry = config.defaultRetry ?? {}
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  getApiKey(): string {
    return this.apiKey
  }

  getTimeout(): number {
    return this.timeout
  }

  /**
   * Create an error from an HTTP response
   */
  private async createErrorFromResponse(
    response: Response,
    errorData: { error?: string; details?: unknown; field?: string }
  ): Promise<FunctionClientError> {
    const requestId = response.headers?.get?.('x-request-id') ?? undefined
    const retryAfterHeader = response.headers?.get?.('retry-after')
    const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined
    const status = response.status

    // Create appropriate error type based on status code
    if (status === 429) {
      return new RateLimitError(
        errorData.error ?? 'Rate limit exceeded',
        retryAfter
      )
    }

    if (status === 400 || status === 422) {
      return new ValidationError(
        errorData.error ?? 'Validation error',
        errorData.field,
        errorData.details
      )
    }

    // For auth errors, use statusText to include 'Unauthorized' or 'Forbidden'
    // For other errors, prefer the JSON error message
    const message = (status === 401 || status === 403)
      ? response.statusText
      : (errorData.error ?? response.statusText)

    return new FunctionClientError(message, status, {
      details: errorData.details,
      requestId,
      retryAfter,
    })
  }

  /**
   * Execute a request with retry logic
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: RetryConfig = {},
    signal?: AbortSignal
  ): Promise<T> {
    const retries = options.retries ?? this.defaultRetry.retries ?? 0
    const initialDelay = options.initialDelay ?? this.defaultRetry.initialDelay ?? 1000
    const maxDelay = options.maxDelay ?? this.defaultRetry.maxDelay ?? 30000
    const backoffMultiplier = options.backoffMultiplier ?? this.defaultRetry.backoffMultiplier ?? 2
    const jitter = options.jitter ?? this.defaultRetry.jitter ?? true
    const retryIf = options.retryIf ?? this.defaultRetry.retryIf
    const onRetry = options.onRetry ?? this.defaultRetry.onRetry

    let lastError: FunctionClientError | undefined

    for (let attempt = 0; attempt <= retries; attempt++) {
      // Check for abort before each attempt
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }

      try {
        return await operation()
      } catch (error) {
        // Wrap non-FunctionClientError errors
        if (!(error instanceof FunctionClientError)) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            throw error
          }
          lastError = new NetworkError(
            error instanceof Error ? error.message : 'Unknown error',
            error instanceof Error ? error : undefined
          )
        } else {
          lastError = error
        }

        // Check if we should retry
        const shouldRetry = attempt < retries && (
          retryIf ? retryIf(lastError) : lastError.retryable
        )

        if (!shouldRetry) {
          throw lastError
        }

        // Calculate delay with respect to retryAfter header if present
        let delay = calculateBackoffDelay(
          attempt + 1,
          initialDelay,
          maxDelay,
          backoffMultiplier,
          jitter
        )

        // Honor retryAfter if it's larger than calculated delay
        if (lastError.retryAfter && lastError.retryAfter * 1000 > delay) {
          delay = lastError.retryAfter * 1000
        }

        // Invoke onRetry callback
        if (onRetry) {
          onRetry(lastError, attempt + 1, delay)
        }

        // Wait before retrying
        await sleep(delay, signal)
      }
    }

    // This should not be reached, but TypeScript needs it
    throw lastError ?? new NetworkError('Unknown error during retry')
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: InvokeOptions = {}
  ): Promise<T> {
    const timeout = options.timeout ?? this.timeout
    const signal = options.signal ?? null

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      ...options.headers,
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal,
    }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      fetchOptions.body = JSON.stringify(body)
    }

    // Create a timeout controller if no external signal provided
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    if (!signal && timeout > 0) {
      controller = new AbortController()
      fetchOptions.signal = controller.signal
      timeoutId = setTimeout(() => controller?.abort(), timeout)
    }

    const operation = async (): Promise<T> => {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, fetchOptions)

        if (!response) {
          // If we have a cached auth error, re-throw it (for retries after auth failure)
          if (this.lastAuthError) {
            throw this.lastAuthError
          }
          throw new NetworkError('Network error: no response received')
        }

        if (!response.ok) {
          let errorData: { error?: string; details?: unknown; field?: string } = {}
          try {
            errorData = await response.json()
          } catch {
            // Ignore JSON parse errors for error responses
          }

          const error = await this.createErrorFromResponse(response, errorData)

          // Cache auth errors for subsequent requests
          if (response.status === 401 || response.status === 403) {
            this.lastAuthError = error
          }

          throw error
        }

        return response.json()
      } catch (error) {
        // Convert AbortError from timeout to TimeoutError
        if (error instanceof DOMException && error.name === 'AbortError' && controller?.signal.aborted) {
          throw new TimeoutError(`Request timed out after ${timeout}ms`, timeout)
        }
        throw error
      }
    }

    try {
      return await this.executeWithRetry(operation, options, signal ?? undefined)
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  /**
   * Invoke a function with type-safe input and output
   *
   * @param functionId - The function ID to invoke
   * @param data - Input data for the function
   * @param options - Invoke options including retry configuration
   * @returns Promise resolving to the invocation result
   *
   * @example
   * ```typescript
   * // Basic invoke
   * const result = await client.invoke('my-function', { name: 'test' })
   *
   * // Type-safe invoke
   * interface Input { name: string }
   * interface Output { greeting: string }
   * const result = await client.invoke<Input, Output>('my-function', { name: 'test' })
   *
   * // With retry
   * const result = await client.invoke('my-function', input, { retries: 3 })
   * ```
   */
  async invoke<TInput = unknown, TOutput = unknown>(
    functionId: string,
    data?: TInput,
    options: InvokeOptions = {}
  ): Promise<InvokeResult<TOutput>> {
    if (!functionId || functionId.trim() === '') {
      throw new ValidationError('Function ID is required', 'functionId')
    }

    return this.request<InvokeResult<TOutput>>(
      'POST',
      `/v1/functions/${functionId}/invoke`,
      data,
      options
    )
  }

  /**
   * Stream function output for long-running operations
   *
   * @param functionId - The function ID to invoke
   * @param data - Input data for the function
   * @param options - Stream options
   * @returns An async iterable stream of chunks
   *
   * @example
   * ```typescript
   * const stream = await client.stream('my-function', input)
   * for await (const chunk of stream) {
   *   console.log(chunk.data)
   *   if (chunk.done) break
   * }
   * ```
   */
  async stream<TInput = unknown, TOutput = unknown>(
    functionId: string,
    data?: TInput,
    options: StreamOptions = {}
  ): Promise<FunctionStream<TOutput>> {
    if (!functionId || functionId.trim() === '') {
      throw new ValidationError('Function ID is required', 'functionId')
    }

    const timeout = options.timeout ?? this.timeout
    const signal = options.signal ?? null
    const mode = options.mode ?? 'json'

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Accept': 'text/event-stream',
      ...options.headers,
    }

    if (data !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    // Create abort controller for cancellation
    const controller = new AbortController()
    let cancelled = false

    // If external signal provided, forward abort
    if (signal) {
      signal.addEventListener('abort', () => controller.abort())
    }

    // Setup timeout
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        controller.abort()
      }, timeout)
    }

    const url = `${this.baseUrl}/v1/functions/${functionId}/stream`

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: data !== undefined ? JSON.stringify(data) : null,
      signal: controller.signal,
    }).catch((error) => {
      if (timeoutId) clearTimeout(timeoutId)
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (cancelled) {
          throw new DOMException('Stream cancelled', 'AbortError')
        }
        throw new TimeoutError(`Stream request timed out after ${timeout}ms`, timeout)
      }
      throw new NetworkError(error.message, error)
    })

    if (!response.ok) {
      if (timeoutId) clearTimeout(timeoutId)
      let errorData: { error?: string; details?: unknown } = {}
      try {
        errorData = await response.json()
      } catch {
        // Ignore
      }
      throw await this.createErrorFromResponse(response, errorData)
    }

    if (!response.body) {
      if (timeoutId) clearTimeout(timeoutId)
      throw new NetworkError('No response body for stream')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let index = 0
    let buffer = ''

    const stream: FunctionStream<TOutput> = {
      cancelled: false,

      cancel() {
        cancelled = true
        this.cancelled = true
        controller.abort()
        if (timeoutId) clearTimeout(timeoutId)
      },

      async *[Symbol.asyncIterator]() {
        try {
          while (true) {
            const { done, value } = await reader.read()

            if (done) {
              // Process any remaining buffer
              if (buffer.trim()) {
                const lines = buffer.split('\n').filter(line => line.trim())
                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6)
                    if (dataStr === '[DONE]') {
                      return
                    }
                    try {
                      const parsed = mode === 'json' ? JSON.parse(dataStr) : dataStr
                      yield {
                        data: parsed as TOutput,
                        index: index++,
                        done: true,
                      }
                    } catch {
                      // If JSON parsing fails and mode is json, yield as string
                      yield {
                        data: dataStr as unknown as TOutput,
                        index: index++,
                        done: true,
                      }
                    }
                  }
                }
              }
              return
            }

            // Decode chunk and add to buffer
            buffer += decoder.decode(value, { stream: true })

            // Process complete lines (SSE format)
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? '' // Keep incomplete line in buffer

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const dataStr = line.slice(6)
                if (dataStr === '[DONE]') {
                  return
                }
                try {
                  const parsed = mode === 'json' ? JSON.parse(dataStr) : dataStr
                  yield {
                    data: parsed as TOutput,
                    index: index++,
                    done: false,
                  }
                } catch {
                  // If JSON parsing fails and mode is json, yield as string
                  yield {
                    data: dataStr as unknown as TOutput,
                    index: index++,
                    done: false,
                  }
                }
              }
            }
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            if (cancelled) return
            throw new TimeoutError(`Stream timed out after ${timeout}ms`, timeout)
          }
          throw error
        } finally {
          if (timeoutId) clearTimeout(timeoutId)
          reader.releaseLock()
        }
      },
    }

    return stream
  }

  /**
   * Invoke multiple functions in batch
   *
   * @param requests - Array of batch invoke requests
   * @param options - Batch invoke options
   * @returns Array of results in the same order as requests
   *
   * @example
   * ```typescript
   * const results = await client.batchInvoke([
   *   { functionId: 'func1', input: { name: 'test1' } },
   *   { functionId: 'func2', input: { name: 'test2' } },
   * ], { concurrency: 2 })
   *
   * for (const result of results) {
   *   if (result.success) {
   *     console.log(result.functionId, result.result)
   *   } else {
   *     console.error(result.functionId, result.error)
   *   }
   * }
   * ```
   */
  async batchInvoke<TInput = unknown, TOutput = unknown>(
    requests: BatchInvokeRequest<TInput>[],
    options: BatchInvokeOptions = {}
  ): Promise<BatchInvokeResultItem<TOutput>[]> {
    if (!Array.isArray(requests) || requests.length === 0) {
      throw new ValidationError('Requests array is required and must not be empty', 'requests')
    }

    const concurrency = options.concurrency ?? 5
    const stopOnError = options.stopOnError ?? false
    const timeout = options.timeout

    // Initialize results array with same length as requests
    const results: BatchInvokeResultItem<TOutput>[] = new Array(requests.length)
    let stopped = false
    let firstError: FunctionClientError | undefined

    // Process requests in batches based on concurrency
    const processBatch = async (startIndex: number): Promise<void> => {
      const batch = requests.slice(startIndex, startIndex + concurrency)
      const promises = batch.map(async (request, batchIndex) => {
        const index = startIndex + batchIndex

        if (stopped) {
          results[index] = {
            functionId: request.functionId,
            success: false,
            error: firstError ?? new FunctionClientError('Batch stopped due to earlier error', 0),
          }
          return
        }

        try {
          const invokeOptions: InvokeOptions = {
            ...options,
            ...request.options,
          }
          // Only set timeout if we have one
          if (request.options?.timeout !== undefined) {
            invokeOptions.timeout = request.options.timeout
          } else if (timeout !== undefined) {
            invokeOptions.timeout = timeout
          }

          const result = await this.invoke<TInput, TOutput>(
            request.functionId,
            request.input,
            invokeOptions
          )

          results[index] = {
            functionId: request.functionId,
            success: true,
            result,
          }
        } catch (error) {
          const clientError = error instanceof FunctionClientError
            ? error
            : new NetworkError(error instanceof Error ? error.message : 'Unknown error')

          results[index] = {
            functionId: request.functionId,
            success: false,
            error: clientError,
          }

          if (stopOnError && !stopped) {
            stopped = true
            firstError = clientError
          }
        }
      })

      await Promise.all(promises)
    }

    // Process all batches sequentially
    for (let i = 0; i < requests.length && !stopped; i += concurrency) {
      await processBatch(i)
    }

    // Fill in any remaining results if stopped early
    for (let i = 0; i < results.length; i++) {
      const request = requests[i]
      if (results[i] === undefined && request !== undefined) {
        results[i] = {
          functionId: request.functionId,
          success: false,
          error: firstError ?? new FunctionClientError('Batch stopped', 0),
        }
      }
    }

    return results
  }

  async deploy(code: string, metadata: FunctionMetadata): Promise<DeployResult> {
    if (!code || code.trim() === '') {
      throw new Error('Function code is required')
    }
    if (!metadata.name || metadata.name.trim() === '') {
      throw new ValidationError('Function name is required', 'name', { message: 'Name is required' })
    }

    return this.request<DeployResult>('POST', '/v1/api/functions', {
      code,
      ...metadata,
    })
  }

  async list(options?: ListOptions): Promise<FunctionResponse[]> {
    const params = new URLSearchParams()
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit))
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset))
    }
    if (options?.status !== undefined) {
      params.set('status', options.status)
    }

    const queryString = params.toString()
    const path = queryString ? `/v1/api/functions?${queryString}` : '/v1/api/functions'

    const response = await this.request<{ functions: FunctionResponse[] }>('GET', path)
    return response.functions
  }

  async get(functionId: string, options?: GetOptions): Promise<FunctionResponse> {
    if (!functionId || functionId.trim() === '') {
      throw new Error('Function ID is required')
    }

    const params = new URLSearchParams()
    if (options?.includeCode) {
      params.set('includeCode', 'true')
    }

    const queryString = params.toString()
    const path = queryString
      ? `/v1/api/functions/${functionId}?${queryString}`
      : `/v1/api/functions/${functionId}`

    return this.request<FunctionResponse>('GET', path)
  }

  async delete(functionId: string): Promise<DeleteResult> {
    if (!functionId || functionId.trim() === '') {
      throw new Error('Function ID is required')
    }

    return this.request<DeleteResult>('DELETE', `/v1/api/functions/${functionId}`)
  }
}
