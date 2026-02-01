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
} from '../../core/src/generative/index.js'
import type {
  ExecutionContext,
  JsonSchema,
  FunctionResultStatus,
} from '../../core/src/types.js'
import { parseDuration } from '../../core/src/types.js'
import * as crypto from 'crypto'

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
 */
export class GenerativeExecutor<TInput = unknown, TOutput = unknown>
  implements GenerativeFunctionExecutor<TInput, TOutput>
{
  private aiClient: AIClient
  private cache: Map<string, CacheEntry> = new Map()
  private maxCacheSize: number
  private staleCleanupIntervalMs: number
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  // Cache statistics
  private cacheHits: number = 0
  private cacheMisses: number = 0
  private cacheEvictions: number = 0
  private cacheStaleEvictions: number = 0

  constructor(options: GenerativeExecutorOptions) {
    this.aiClient = options.aiClient
    this.maxCacheSize = options.maxCacheSize ?? 1000
    // Default to 0 (no automatic cleanup) - users can explicitly set interval if needed
    this.staleCleanupIntervalMs = options.staleCleanupIntervalMs ?? 0

    // Start proactive cleanup only if explicitly configured
    if (this.staleCleanupIntervalMs > 0) {
      this.startCleanupTimer()
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): GenerativeCacheStats {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      evictions: this.cacheEvictions,
      staleEvictions: this.cacheStaleEvictions,
    }
  }

  /**
   * Proactively clean up stale (TTL-expired) cache entries
   */
  cleanupStaleEntries(): void {
    const now = Date.now()
    const keysToDelete: string[] = []

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl * 1000) {
        keysToDelete.push(key)
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key)
      this.cacheStaleEvictions++
    }
  }

  /**
   * Stop the cleanup timer (useful for tests or shutdown)
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /**
   * Start the periodic cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleEntries()
    }, this.staleCleanupIntervalMs)
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
    const executionId = context?.executionId ?? crypto.randomUUID()
    const startedAt = Date.now()

    // Determine model to use
    const model = config?.model ?? definition.model ?? 'claude-3-sonnet'

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

    // Check cache
    const cacheEnabled = config?.cacheEnabled ?? false
    const cacheTtlSeconds = config?.cacheTtlSeconds ?? 3600
    const cacheKey = this.computeCacheKey(
      definition.id,
      renderedUserPrompt,
      renderedSystemPrompt,
      model
    )

    if (cacheEnabled) {
      const cachedResult = this.getFromCache(cacheKey)
      if (cachedResult) {
        return cachedResult as GenerativeFunctionResult<TOutput>
      }
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
        const successResult = this.createSuccessResult(
          executionId,
          definition,
          startedAt,
          completedAt,
          result,
          parseResult.data as TOutput,
          retryCount,
          context,
          model,
          renderedUserPrompt,
          renderedSystemPrompt,
          false
        )

        // Cache successful result
        if (cacheEnabled) {
          this.setInCache(cacheKey, successResult, cacheTtlSeconds)
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
              tokens: { input: 0, output: 0, total: 0 },
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
        tokens: { input: 0, output: 0, total: 0 },
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

  private computeCacheKey(
    functionId: string,
    userPrompt: string,
    systemPrompt: string | undefined,
    model: string
  ): string {
    const content = `${functionId}:${model}:${systemPrompt ?? ''}:${userPrompt}`
    return crypto.createHash('sha256').update(content).digest('hex')
  }

  private getFromCache(key: string): GenerativeFunctionResult<unknown> | null {
    const entry = this.cache.get(key)
    if (!entry) {
      this.cacheMisses++
      return null
    }

    const now = Date.now()
    if (now - entry.timestamp > entry.ttl * 1000) {
      this.cache.delete(key)
      this.cacheMisses++
      return null
    }

    // Touch the entry to mark it as recently used (LRU)
    this.touchCacheEntry(key, entry)
    this.cacheHits++

    // Mark as cached
    return {
      ...entry.result,
      generativeExecution: {
        ...entry.result.generativeExecution,
        cached: true,
      },
    }
  }

  private setInCache(
    key: string,
    result: GenerativeFunctionResult<unknown>,
    ttlSeconds: number
  ): void {
    // Evict oldest (LRU) entry if cache is full
    if (this.cache.size >= this.maxCacheSize && !this.cache.has(key)) {
      this.evictOldest()
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      ttl: ttlSeconds,
    })
  }

  /**
   * Move a cache entry to the end of the Map to mark it as recently used.
   * This is O(1) and maintains LRU ordering by deletion and re-insertion.
   */
  private touchCacheEntry(key: string, entry: CacheEntry): void {
    this.cache.delete(key)
    this.cache.set(key, entry)
  }

  /**
   * Evict the oldest (least recently used) entry from the cache.
   * Uses Map's insertion order for O(1) eviction - the first entry is always the oldest.
   */
  private evictOldest(): void {
    const firstKey = this.cache.keys().next().value
    if (firstKey !== undefined) {
      this.cache.delete(firstKey)
      this.cacheEvictions++
    }
  }

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

    // Default 30 seconds
    return 30000
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
    let timeoutId: NodeJS.Timeout | undefined
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
          input: modelResult.inputTokens,
          output: modelResult.outputTokens,
          total: modelResult.inputTokens + modelResult.outputTokens,
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
          input: modelResult.inputTokens,
          output: modelResult.outputTokens,
          total: modelResult.inputTokens + modelResult.outputTokens,
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
