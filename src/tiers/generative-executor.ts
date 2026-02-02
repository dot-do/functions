/**
 * Generative Executor
 *
 * Executes generative AI functions that make single model calls
 * with structured output. Supports multiple AI providers (Claude, GPT, Gemini),
 * prompt templating, schema validation, caching, retries, and timeouts.
 *
 * @module tiers/generative-executor
 */

import type {
  GenerativeFunctionDefinition,
  GenerativeFunctionConfig,
  GenerativeFunctionResult,
  GenerativeFunctionExecutor,
} from '@dotdo/functions/generative'
import type {
  ExecutionContext,
  JsonSchema,
  FunctionResultStatus,
} from '@dotdo/functions'
import { parseDuration } from '@dotdo/functions'
import { TIER_TIMEOUTS, GENERATIVE_CACHE, AI_MODELS } from '../config'
import { validateOutput } from '../core/validation'

// =============================================================================
// CACHE API HELPERS
// =============================================================================

/** Internal cache domain for creating cache keys */
const GENERATIVE_CACHE_DOMAIN = 'https://generative-cache.internal'

/**
 * Create a cache key Request for generative results.
 * Uses a synthetic URL that uniquely identifies the cached resource.
 */
function createGenerativeCacheKey(hash: string): Request {
  return new Request(`${GENERATIVE_CACHE_DOMAIN}/results/${hash}`)
}

/**
 * Get cached generative result from Cloudflare Cache API.
 */
async function getCachedGenerativeResult(hash: string): Promise<GenerativeFunctionResult<unknown> | null> {
  try {
    const cache = caches.default
    const cacheKey = createGenerativeCacheKey(hash)
    const cached = await cache.match(cacheKey)
    if (cached) {
      return await cached.json() as GenerativeFunctionResult<unknown>
    }
  } catch (error) {
    // Cache miss or error - fall through
    console.debug(`[generative-cache] get error for ${hash}:`, error instanceof Error ? error.message : String(error))
  }
  return null
}

/**
 * Cache generative result using Cloudflare Cache API.
 */
async function cacheGenerativeResult(hash: string, result: GenerativeFunctionResult<unknown>, ttlSeconds: number): Promise<void> {
  try {
    const cache = caches.default
    const cacheKey = createGenerativeCacheKey(hash)
    const response = new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `max-age=${ttlSeconds}`,
      },
    })
    await cache.put(cacheKey, response)
  } catch (error) {
    // Cache put failed - non-fatal
    console.debug(`[generative-cache] put error for ${hash}:`, error instanceof Error ? error.message : String(error))
  }
}

// =============================================================================
// CLOUDFLARE-COMPATIBLE CRYPTO UTILITIES
// =============================================================================

/**
 * Generate a UUID using Web Crypto API (Cloudflare Workers compatible)
 */
function generateUUID(): string {
  // Use crypto.randomUUID if available (modern browsers and Cloudflare Workers)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for environments without randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Compute SHA-256 hash using Web Crypto API (Cloudflare Workers compatible)
 */
async function sha256(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// =============================================================================
// TYPES
// =============================================================================

/**
 * AI client interface for Claude-style API
 */
export interface AIClient {
  messages: {
    create(params: ClaudeRequestParams): Promise<ClaudeResponse>
  }
  chat?: {
    completions: {
      create(params: GPTRequestParams): Promise<GPTResponse>
    }
  }
}

interface ClaudeRequestParams {
  model: string
  messages: Array<{ role: string; content: string }>
  system?: string
  max_tokens?: number
  temperature?: number
  signal?: AbortSignal
}

interface ClaudeResponse {
  content: Array<{ type: string; text: string }>
  usage?: {
    input_tokens: number
    output_tokens: number
  }
  stop_reason?: 'end_turn' | 'max_tokens' | 'stop_sequence'
  model?: string
}

interface GPTRequestParams {
  model: string
  messages: Array<{ role: string; content: string }>
  max_tokens?: number
  temperature?: number
  signal?: AbortSignal
}

interface GPTResponse {
  choices: Array<{
    message: { content: string }
    finish_reason: 'stop' | 'length'
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  model?: string
}

/**
 * Options for creating a GenerativeExecutor
 */
export interface GenerativeExecutorOptions {
  aiClient: AIClient
  /** Maximum number of entries in the cache (default: 1000) */
  maxCacheSize?: number
  /** Interval in milliseconds for proactive stale entry cleanup (default: 60000ms = 1 minute) */
  staleCleanupIntervalMs?: number
}

/**
 * Cache statistics
 */
export interface GenerativeCacheStats {
  /** Current number of entries in the cache */
  size: number
  /** Maximum cache size */
  maxSize: number
  /** Number of cache hits */
  hits: number
  /** Number of cache misses */
  misses: number
  /** Number of LRU evictions (when cache is full) */
  evictions: number
  /** Number of stale entries cleaned up (TTL expired) */
  staleEvictions: number
}

/**
 * Cache entry structure
 */
interface CacheEntry {
  result: GenerativeFunctionResult<unknown>
  timestamp: number
  ttl: number
}

// =============================================================================
// MODEL MAPPING
// =============================================================================

const CLAUDE_MODELS: Record<string, string> = {
  'claude-3-opus': 'claude-3-opus-20240229',
  'claude-3-sonnet': 'claude-3-sonnet-20240229',
  'claude-3-haiku': 'claude-3-haiku-20240307',
  'claude-4-opus': 'claude-4-opus-20250115',
  'claude-4-sonnet': 'claude-4-sonnet-20250115',
}

const GPT_MODELS = new Set(['gpt-4o', 'gpt-4o-mini'])
const GEMINI_MODELS = new Set(['gemini-pro', 'gemini-flash'])

const VALID_MODELS = new Set([
  ...Object.keys(CLAUDE_MODELS),
  ...GPT_MODELS,
  ...GEMINI_MODELS,
])

// =============================================================================
// GENERATIVE EXECUTOR
// =============================================================================

/**
 * Executor for generative AI functions
 *
 * NOTE: This executor uses Cloudflare's Cache API for caching results.
 * In-memory Maps don't persist across Worker requests (each request may hit
 * a different isolate), so we use the edge cache for cross-request caching.
 */
export class GenerativeExecutor<TInput = unknown, TOutput = unknown>
  implements GenerativeFunctionExecutor<TInput, TOutput>
{
  private aiClient: AIClient
  // NOTE: Removed in-memory cache Map - using Cache API instead
  // The Cache API persists across Worker isolates at the edge

  // Cache statistics (reset per isolate, but useful for debugging)
  private cacheHits: number = 0
  private cacheMisses: number = 0

  constructor(options: GenerativeExecutorOptions) {
    this.aiClient = options.aiClient
    // NOTE: maxCacheSize and staleCleanupIntervalMs no longer apply
    // Cache API manages its own eviction and TTL is handled by Cache-Control headers
  }

  /**
   * Get cache statistics
   *
   * NOTE: With Cache API, we cannot get the cache size or track evictions.
   * Only hit/miss counters are available (reset per isolate).
   */
  getCacheStats(): GenerativeCacheStats {
    return {
      size: 0, // Cannot determine Cache API size
      maxSize: 0, // Cache API manages its own limits
      hits: this.cacheHits,
      misses: this.cacheMisses,
      evictions: 0, // Cache API manages its own eviction
      staleEvictions: 0, // Cache API handles TTL automatically
    }
  }

  /**
   * @deprecated No longer needed - Cache API handles TTL automatically via Cache-Control headers
   */
  cleanupStaleEntries(): void {
    // No-op: Cache API handles TTL expiration automatically
  }

  /**
   * @deprecated No longer needed - no cleanup timer with Cache API
   */
  stopCleanup(): void {
    // No-op: No cleanup timer to stop with Cache API
  }

  /**
   * Execute a generative function
   */
  async execute(
    definition: GenerativeFunctionDefinition<TInput, TOutput>,
    input: TInput,
    config?: GenerativeFunctionConfig,
    context?: ExecutionContext
  ): Promise<GenerativeFunctionResult<TOutput>> {
    const executionId = context?.executionId ?? generateUUID()
    const startedAt = Date.now()

    // Determine model to use (from centralized config)
    const model = config?.model ?? definition.model ?? AI_MODELS.DEFAULT_GENERATIVE_MODEL

    // Validate model
    if (!this.isValidModel(model)) {
      throw new Error(`Invalid model: ${model}`)
    }

    // Check for unsupported Gemini models
    if (GEMINI_MODELS.has(model)) {
      throw new Error(`Gemini models are not supported without a Gemini client`)
    }

    // Render prompts with variables
    const renderedUserPrompt = this.renderPrompt(
      definition.userPrompt,
      input as Record<string, unknown>
    )
    const renderedSystemPrompt = definition.systemPrompt
      ? this.renderPrompt(definition.systemPrompt, input as Record<string, unknown>)
      : undefined

    // Check cache (using centralized config for default TTL)
    const cacheEnabled = config?.cacheEnabled ?? false
    const cacheTtlSeconds = config?.cacheTtlSeconds ?? GENERATIVE_CACHE.DEFAULT_TTL_SECONDS
    const cacheKey = await this.computeCacheKey(
      definition.id,
      renderedUserPrompt,
      renderedSystemPrompt,
      model
    )

    if (cacheEnabled) {
      const cachedResult = await getCachedGenerativeResult(cacheKey)
      if (cachedResult) {
        this.cacheHits++
        // Mark as cached and return
        return {
          ...cachedResult,
          generativeExecution: {
            ...cachedResult.generativeExecution,
            cached: true,
          },
        } as GenerativeFunctionResult<TOutput>
      }
      this.cacheMisses++
    }

    // Determine timeout
    const timeoutMs = this.resolveTimeout(definition, config, context)

    // Build messages for few-shot examples
    const messages = this.buildMessages(
      definition,
      renderedUserPrompt,
      input as Record<string, unknown>
    )

    // Execute with retries
    const maxAttempts = definition.retryPolicy?.maxAttempts ?? 3
    let retryCount = 0
    let lastError: Error | undefined

    // Schema validation retry loop
    const schemaRetryMax = 2 // Additional retries for schema validation
    let schemaRetryCount = 0

    while (retryCount < maxAttempts) {
      try {
        const result = await this.executeModelCall(
          model,
          messages,
          renderedSystemPrompt,
          config?.maxTokens ?? definition.maxTokens,
          definition.temperature ?? config?.temperature,
          timeoutMs,
          context?.signal
        )

        // Parse and validate output
        const parseResult = this.parseOutput(result.rawResponse)

        if (!parseResult.success) {
          // Retry on parse failure
          schemaRetryCount++
          if (schemaRetryCount < schemaRetryMax) {
            retryCount++
            continue
          }

          // Return failed result
          const completedAt = Date.now()
          return this.createFailedResult(
            executionId,
            definition,
            startedAt,
            completedAt,
            result,
            retryCount,
            context,
            `Output validation failed: ${parseResult.error}`,
            model,
            renderedUserPrompt,
            renderedSystemPrompt
          )
        }

        // Validate against schema
        const validationResult = this.validateAgainstSchema(
          parseResult.data,
          definition.outputSchema
        )

        if (!validationResult.valid) {
          schemaRetryCount++
          if (schemaRetryCount < schemaRetryMax) {
            retryCount++
            continue
          }

          // Return failed result with validation errors
          const completedAt = Date.now()
          return this.createFailedResult(
            executionId,
            definition,
            startedAt,
            completedAt,
            result,
            retryCount,
            context,
            `Output validation failed: ${validationResult.errors.join(', ')}`,
            model,
            renderedUserPrompt,
            renderedSystemPrompt
          )
        }

        // Success!
        const completedAt = Date.now()
        const validatedOutput = validateOutput<TOutput>(
          parseResult.data,
          `generative output for ${definition.id}`,
          definition.outputSchema
        )

        const successResult = this.createSuccessResult(
          executionId,
          definition,
          startedAt,
          completedAt,
          result,
          validatedOutput,
          retryCount,
          context,
          model,
          renderedUserPrompt,
          renderedSystemPrompt,
          false
        )

        // Cache successful result using Cache API
        if (cacheEnabled) {
          try {
            await cacheGenerativeResult(cacheKey, successResult, cacheTtlSeconds)
          } catch {
            // Ignore cache errors - they're non-fatal
          }
        }

        return successResult
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Check if error is retryable
        if (this.isRetryableError(error)) {
          const retryAfter = this.getRetryAfter(error)
          retryCount++

          if (retryCount < maxAttempts) {
            const delay = retryAfter ?? this.calculateBackoff(retryCount)
            await this.sleep(delay)
            continue
          }
        } else if (this.isTimeoutError(error)) {
          // Timeout - don't retry
          const completedAt = Date.now()
          return {
            executionId,
            functionId: definition.id,
            functionVersion: definition.version,
            status: 'timeout' as FunctionResultStatus,
            error: {
              name: 'TimeoutError',
              message: lastError.message,
            },
            metrics: {
              durationMs: completedAt - startedAt,
              inputSizeBytes: JSON.stringify(input).length,
              outputSizeBytes: 0,
              retryCount,
            },
            metadata: {
              startedAt,
              completedAt,
              traceId: context?.traceId,
              spanId: executionId,
            },
            generativeExecution: {
              model: this.resolveModelId(model),
              tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              cached: false,
              stopReason: 'end_turn',
              modelLatencyMs: 0,
              prompt: {
                system: renderedSystemPrompt,
                user: renderedUserPrompt,
              },
            },
          }
        } else {
          // Non-retryable error (e.g., 400)
          break
        }
      }
    }

    // All retries exhausted
    const completedAt = Date.now()
    return {
      executionId,
      functionId: definition.id,
      functionVersion: definition.version,
      status: 'failed' as FunctionResultStatus,
      error: {
        name: lastError?.name ?? 'Error',
        message: lastError?.message ?? 'Unknown error',
      },
      metrics: {
        durationMs: completedAt - startedAt,
        inputSizeBytes: JSON.stringify(input).length,
        outputSizeBytes: 0,
        retryCount,
      },
      metadata: {
        startedAt,
        completedAt,
        traceId: context?.traceId,
        spanId: executionId,
      },
      generativeExecution: {
        model: this.resolveModelId(model),
        tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        cached: false,
        stopReason: 'end_turn',
        modelLatencyMs: 0,
        prompt: {
          system: renderedSystemPrompt,
          user: renderedUserPrompt,
        },
      },
    }
  }

  /**
   * Render a prompt template by replacing {{variable}} placeholders
   */
  renderPrompt(template: string, variables: Record<string, unknown>): string {
    // Find all placeholders
    const placeholderRegex = /\{\{([^}]+)\}\}/g
    const placeholders: string[] = []
    let match: RegExpExecArray | null

    while ((match = placeholderRegex.exec(template)) !== null) {
      placeholders.push(match[1])
    }

    // Replace placeholders
    let result = template
    for (const placeholder of placeholders) {
      const value = this.getNestedValue(variables, placeholder)

      if (value === undefined) {
        throw new Error(`Missing variable: ${placeholder}`)
      }

      const stringValue =
        typeof value === 'object' ? JSON.stringify(value) : String(value)

      result = result.replace(new RegExp(`\\{\\{${placeholder.replace(/\./g, '\\.')}\\}\\}`, 'g'), stringValue)
    }

    return result
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  private isValidModel(model: string): boolean {
    return VALID_MODELS.has(model) || model.startsWith('claude-') || model.startsWith('gpt-')
  }

  private resolveModelId(model: string): string {
    return CLAUDE_MODELS[model] ?? model
  }

  private getNestedValue(
    obj: Record<string, unknown>,
    path: string
  ): unknown {
    const parts = path.split('.')
    let current: unknown = obj

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined
      }
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part]
      } else {
        return undefined
      }
    }

    return current
  }

  private async computeCacheKey(
    functionId: string,
    userPrompt: string,
    systemPrompt: string | undefined,
    model: string
  ): Promise<string> {
    const content = `${functionId}:${model}:${systemPrompt ?? ''}:${userPrompt}`
    return sha256(content)
  }

  // NOTE: Removed getFromCache(), setInCache(), touchCacheEntry(), evictOldest() methods
  // These were for the in-memory LRU cache which has been replaced by Cache API.
  // Cache API handles TTL expiration and eviction automatically.

  private resolveTimeout(
    definition: GenerativeFunctionDefinition<TInput, TOutput>,
    config?: GenerativeFunctionConfig,
    context?: ExecutionContext
  ): number {
    // Context timeout takes precedence
    if (context?.timeout !== undefined) {
      return typeof context.timeout === 'number'
        ? context.timeout
        : parseDuration(context.timeout)
    }

    // Definition timeout
    if (definition.timeout) {
      return typeof definition.timeout === 'number'
        ? definition.timeout
        : parseDuration(definition.timeout)
    }

    // Default generative timeout from centralized config
    return TIER_TIMEOUTS.GENERATIVE_MS
  }

  private buildMessages(
    definition: GenerativeFunctionDefinition<TInput, TOutput>,
    renderedUserPrompt: string,
    input: Record<string, unknown>
  ): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = []

    // Add few-shot examples
    if (definition.examples && definition.examples.length > 0) {
      for (const example of definition.examples) {
        // Render example user prompt
        const exampleUserPrompt = this.renderPrompt(
          definition.userPrompt,
          example.input
        )
        messages.push({ role: 'user', content: exampleUserPrompt })

        // Add assistant response - stringify with formatting for test compatibility
        const outputString = typeof example.output === 'string'
          ? example.output
          : JSON.stringify(example.output, null, 2)
        messages.push({ role: 'assistant', content: outputString })
      }
    }

    // Add actual user prompt
    messages.push({ role: 'user', content: renderedUserPrompt })

    return messages
  }

  private async executeModelCall(
    model: string,
    messages: Array<{ role: string; content: string }>,
    systemPrompt: string | undefined,
    maxTokens: number | undefined,
    temperature: number | undefined,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<{
    rawResponse: string
    inputTokens: number
    outputTokens: number
    stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence'
    model: string
    latencyMs: number
  }> {
    const abortController = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let timedOut = false

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true
        abortController.abort()
        reject(new Error('Request timeout'))
      }, timeoutMs)
    })

    // Link external signal
    if (signal) {
      signal.addEventListener('abort', () => {
        abortController.abort()
      })
    }

    const startTime = Date.now()

    try {
      if (GPT_MODELS.has(model)) {
        // GPT model
        if (!this.aiClient.chat?.completions) {
          throw new Error('GPT client not available')
        }

        const gptMessages: Array<{ role: string; content: string }> = []
        if (systemPrompt) {
          gptMessages.push({ role: 'system', content: systemPrompt })
        }
        gptMessages.push(...messages)

        const responsePromise = this.aiClient.chat.completions.create({
          model,
          messages: gptMessages,
          max_tokens: maxTokens ?? 4096,
          temperature: temperature ?? 0,
          signal: abortController.signal,
        })

        const response = await Promise.race([responsePromise, timeoutPromise])
        const latencyMs = Date.now() - startTime

        return {
          rawResponse: response.choices[0]?.message.content ?? '',
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
          stopReason: response.choices[0]?.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
          model: response.model ?? model,
          latencyMs,
        }
      } else {
        // Claude model
        const resolvedModel = this.resolveModelId(model)

        const responsePromise = this.aiClient.messages.create({
          model: resolvedModel,
          messages,
          system: systemPrompt,
          max_tokens: maxTokens ?? 4096,
          temperature: temperature ?? 0,
          signal: abortController.signal,
        })

        const response = await Promise.race([responsePromise, timeoutPromise])
        const latencyMs = Date.now() - startTime

        const textContent = response.content.find((c) => c.type === 'text')
        const rawResponse = textContent?.text ?? ''

        return {
          rawResponse,
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          stopReason: response.stop_reason ?? 'end_turn',
          model: response.model ?? resolvedModel,
          latencyMs,
        }
      }
    } catch (error) {
      if (timedOut) {
        throw new Error('Request timeout')
      }
      throw error
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  private parseOutput(rawResponse: string): {
    success: boolean
    data?: unknown
    error?: string
  } {
    let content = rawResponse.trim()

    // Handle markdown code blocks
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (codeBlockMatch) {
      content = codeBlockMatch[1].trim()
    }

    try {
      const data = JSON.parse(content)
      return { success: true, data }
    } catch {
      return { success: false, error: 'Invalid JSON output' }
    }
  }

  private validateAgainstSchema(
    data: unknown,
    schema: JsonSchema
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    // Handle type coercion for numbers
    if (schema.type === 'object' && typeof data === 'object' && data !== null) {
      this.coerceTypes(data as Record<string, unknown>, schema)
    }

    // Basic type validation
    if (schema.type) {
      const actualType = Array.isArray(data) ? 'array' : typeof data
      if (schema.type !== actualType) {
        if (!(schema.type === 'number' && actualType === 'string' && !isNaN(Number(data)))) {
          errors.push(`schema type mismatch: expected ${schema.type}, got ${actualType}`)
        }
      }
    }

    // Required fields validation
    if (
      schema.type === 'object' &&
      schema.required &&
      typeof data === 'object' &&
      data !== null
    ) {
      for (const field of schema.required) {
        if (!(field in data)) {
          errors.push(`schema validation: missing required field '${field}'`)
        }
      }
    }

    // Enum validation
    if (schema.properties && typeof data === 'object' && data !== null) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        const value = (data as Record<string, unknown>)[key]
        if (value !== undefined && propSchema.enum) {
          if (!propSchema.enum.includes(value)) {
            errors.push(`schema enum validation failed: field ${key} must be one of: ${propSchema.enum.join(', ')}`)
          }
        }
      }
    }

    // Array items validation
    if (schema.type === 'array' && schema.items && Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        const itemResult = this.validateAgainstSchema(data[i], schema.items)
        if (!itemResult.valid) {
          errors.push(...itemResult.errors.map((e) => `[${i}]: ${e}`))
        }
      }
    }

    return { valid: errors.length === 0, errors }
  }

  private coerceTypes(
    data: Record<string, unknown>,
    schema: JsonSchema
  ): void {
    if (!schema.properties) return

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const value = data[key]
      if (value !== undefined && propSchema.type === 'number' && typeof value === 'string') {
        const num = Number(value)
        if (!isNaN(num)) {
          data[key] = num
        }
      }
    }
  }

  private isRetryableError(error: unknown): boolean {
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as { status: number }).status
      return status === 429 || status >= 500
    }
    return false
  }

  private isTimeoutError(error: unknown): boolean {
    if (error instanceof Error) {
      return error.message.toLowerCase().includes('timeout')
    }
    return false
  }

  private getRetryAfter(error: unknown): number | undefined {
    if (
      error &&
      typeof error === 'object' &&
      'headers' in error &&
      typeof (error as { headers: unknown }).headers === 'object'
    ) {
      const headers = (error as { headers: Record<string, string> }).headers
      const retryAfter = headers['retry-after']
      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10)
        if (!isNaN(seconds)) {
          return seconds * 1000
        }
      }
    }
    return undefined
  }

  private calculateBackoff(retryCount: number): number {
    // Exponential backoff: 1s, 2s, 4s, ...
    return Math.min(1000 * Math.pow(2, retryCount - 1), 60000)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private createSuccessResult(
    executionId: string,
    definition: GenerativeFunctionDefinition<TInput, TOutput>,
    startedAt: number,
    completedAt: number,
    modelResult: {
      rawResponse: string
      inputTokens: number
      outputTokens: number
      stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence'
      model: string
      latencyMs: number
    },
    output: TOutput,
    retryCount: number,
    context: ExecutionContext | undefined,
    model: string,
    userPrompt: string,
    systemPrompt: string | undefined,
    cached: boolean
  ): GenerativeFunctionResult<TOutput> {
    return {
      executionId,
      functionId: definition.id,
      functionVersion: definition.version,
      status: 'completed' as FunctionResultStatus,
      output,
      metrics: {
        durationMs: completedAt - startedAt,
        inputSizeBytes: JSON.stringify(userPrompt).length,
        outputSizeBytes: modelResult.rawResponse.length,
        retryCount,
        tokens: {
          inputTokens: modelResult.inputTokens,
          outputTokens: modelResult.outputTokens,
          totalTokens: modelResult.inputTokens + modelResult.outputTokens,
        },
      },
      metadata: {
        startedAt,
        completedAt,
        traceId: context?.traceId,
        spanId: executionId,
      },
      generativeExecution: {
        model: modelResult.model,
        tokens: {
          inputTokens: modelResult.inputTokens,
          outputTokens: modelResult.outputTokens,
          totalTokens: modelResult.inputTokens + modelResult.outputTokens,
        },
        prompt: {
          system: systemPrompt,
          user: userPrompt,
        },
        rawResponse: modelResult.rawResponse,
        cached,
        stopReason: modelResult.stopReason,
        modelLatencyMs: modelResult.latencyMs,
      },
    }
  }

  private createFailedResult(
    executionId: string,
    definition: GenerativeFunctionDefinition<TInput, TOutput>,
    startedAt: number,
    completedAt: number,
    modelResult: {
      rawResponse: string
      inputTokens: number
      outputTokens: number
      stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence'
      model: string
      latencyMs: number
    },
    retryCount: number,
    context: ExecutionContext | undefined,
    errorMessage: string,
    model: string,
    userPrompt: string,
    systemPrompt: string | undefined
  ): GenerativeFunctionResult<TOutput> {
    return {
      executionId,
      functionId: definition.id,
      functionVersion: definition.version,
      status: 'failed' as FunctionResultStatus,
      error: {
        name: 'ValidationError',
        message: errorMessage,
      },
      metrics: {
        durationMs: completedAt - startedAt,
        inputSizeBytes: JSON.stringify(userPrompt).length,
        outputSizeBytes: modelResult.rawResponse.length,
        retryCount,
        tokens: {
          inputTokens: modelResult.inputTokens,
          outputTokens: modelResult.outputTokens,
          totalTokens: modelResult.inputTokens + modelResult.outputTokens,
        },
      },
      metadata: {
        startedAt,
        completedAt,
        traceId: context?.traceId,
        spanId: executionId,
      },
      generativeExecution: {
        model: modelResult.model,
        tokens: {
          inputTokens: modelResult.inputTokens,
          outputTokens: modelResult.outputTokens,
          totalTokens: modelResult.inputTokens + modelResult.outputTokens,
        },
        prompt: {
          system: systemPrompt,
          user: userPrompt,
        },
        rawResponse: modelResult.rawResponse,
        cached: false,
        stopReason: modelResult.stopReason,
        modelLatencyMs: modelResult.latencyMs,
      },
    }
  }
}
