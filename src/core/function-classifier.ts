/**
 * Function Type Classifier
 *
 * Uses AI to classify functions into one of four execution tiers:
 * - Code: Deterministic, computable programmatically (math, formatting, data transformation)
 * - Generative: Needs AI to generate output (summarization, translation, content creation)
 * - Agentic: Needs multi-step reasoning, tool use, iteration (research, complex analysis)
 * - Human: Requires human judgment, creativity, approval (content review, expense approval)
 *
 * The classifier analyzes the function name, description, and input schema to determine
 * the appropriate tier. It supports multiple AI providers with automatic fallback:
 * - Cloudflare Workers AI (primary)
 * - OpenRouter
 * - AWS Bedrock
 * - Anthropic API
 * - OpenAI API
 *
 * @module core/function-classifier
 */

import { CLASSIFIER_CACHE } from '../config/defaults'

// =============================================================================
// TYPES
// =============================================================================

/**
 * The four function execution types in the cascade system
 */
export type FunctionType = 'code' | 'generative' | 'agentic' | 'human'

/**
 * Result of classifying a function into an execution tier
 */
export interface ClassificationResult {
  /** The classified function type */
  type: FunctionType
  /** Confidence score from 0 to 1 */
  confidence: number
  /** Reasoning behind the classification */
  reasoning: string
  /** Which AI provider was used */
  provider?: string
  /** Latency of the classification call in ms */
  latencyMs?: number
}

/**
 * Supported AI provider types
 */
export type AIProviderType =
  | 'cloudflare-workers-ai'
  | 'openrouter'
  | 'bedrock'
  | 'anthropic'
  | 'openai'

/**
 * Configuration for an AI provider
 */
export interface AIProviderConfig {
  /** Provider type */
  type: AIProviderType
  /** API key or credentials */
  apiKey?: string
  /** Model to use (provider-specific) */
  model?: string
  /** Base URL override */
  baseUrl?: string
  /** AWS region (for Bedrock) */
  region?: string
  /** Cloudflare account ID (for Workers AI) */
  accountId?: string
  /** Request timeout in ms */
  timeoutMs?: number
}

/**
 * Options for the classifier
 */
export interface ClassifierOptions {
  /** AI providers in priority order (first = primary, rest = fallbacks) */
  providers: AIProviderConfig[]
  /** Temperature for AI calls (default: 0 for deterministic) */
  temperature?: number
  /** Default timeout in milliseconds (default: 10000) */
  timeoutMs?: number
  /** Maximum retries per provider before fallback (default: 1) */
  maxRetriesPerProvider?: number
}

/**
 * Cache entry for classification results
 */
interface ClassificationCacheEntry {
  result: ClassificationResult
  timestamp: number
  ttl: number
}

/**
 * AI provider interface - abstraction over different AI APIs
 */
interface AIProvider {
  readonly type: AIProviderType
  classify(
    prompt: string,
    systemPrompt: string,
    options: { temperature: number; timeoutMs: number }
  ): Promise<{ type: FunctionType; confidence: number; reasoning: string }>
}

// =============================================================================
// SYSTEM PROMPT
// =============================================================================

const CLASSIFICATION_SYSTEM_PROMPT = `You are a function type classifier for the Functions.do platform. Your job is to analyze a function's name, description, and input to determine what execution tier it belongs to.

There are exactly four function types:

1. **code** - Deterministic functions that can be computed programmatically without AI.
   Examples:
   - calculateTax(income, rate) -> Arithmetic computation
   - formatCurrency(amount, locale) -> String formatting
   - validateEmail(email) -> Pattern matching / regex
   - sortArray(items, key) -> Data transformation
   - convertTemperature(value, from, to) -> Unit conversion
   - generateUUID() -> Random generation with fixed algorithm
   - hashPassword(password) -> Cryptographic operation
   - parseCSV(data) -> Data parsing

2. **generative** - Functions that need a single AI model call to generate output.
   Examples:
   - summarizeArticle(text) -> Text summarization
   - translateText(text, targetLanguage) -> Language translation
   - generateProductDescription(product) -> Content creation
   - classifySentiment(text) -> Sentiment analysis
   - extractKeywords(text) -> NLP extraction
   - rewriteEmail(draft, tone) -> Text rewriting
   - generateTagline(brand, product) -> Creative text generation
   - answerQuestion(question, context) -> Question answering

3. **agentic** - Functions that need multi-step reasoning, tool use, or iteration.
   Examples:
   - researchCompetitors(company) -> Requires web research, multiple steps
   - analyzeCodebase(repoUrl) -> Needs to read files, analyze patterns
   - planProjectTimeline(requirements) -> Complex planning with dependencies
   - debugApplication(errorLog, codeContext) -> Iterative debugging process
   - writeTestSuite(sourceCode) -> Needs to understand code, create multiple tests
   - compareProducts(products, criteria) -> Multi-step comparison analysis
   - buildReport(dataSources, template) -> Aggregation from multiple sources

4. **human** - Functions that require human judgment, creativity, or approval.
   Examples:
   - approveExpenseReport(report) -> Requires human authorization
   - reviewContentForPublishing(content) -> Editorial judgment needed
   - evaluateJobCandidate(application) -> Subjective human assessment
   - approveDeployment(changes) -> Safety-critical human approval
   - moderateUserContent(post) -> Policy enforcement requiring judgment
   - assignPriority(ticket) -> Contextual prioritization by humans
   - signContract(document) -> Legal authorization

Respond with ONLY a valid JSON object (no markdown, no code blocks) with these fields:
- "type": one of "code", "generative", "agentic", "human"
- "confidence": a number between 0 and 1 indicating your confidence
- "reasoning": a brief explanation (1-2 sentences) of why you chose this type

Guidelines for confidence scoring:
- 0.9-1.0: Very clear-cut case, name and description strongly indicate the type
- 0.7-0.89: Likely this type but could have elements of another
- 0.5-0.69: Ambiguous, could reasonably be classified differently
- Below 0.5: Very uncertain, defaulting to best guess`

// =============================================================================
// SHARED FETCH UTILITIES
// =============================================================================

/**
 * Performs a fetch request with timeout support.
 *
 * @param url - The URL to fetch
 * @param options - Fetch request options (headers, body, method, etc.)
 * @param timeoutMs - Timeout in milliseconds
 * @returns The fetch Response
 * @throws Error if the request times out or fails
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Response format for OpenAI-compatible APIs (OpenAI, OpenRouter)
 */
interface OpenAICompatibleResponse {
  choices?: Array<{ message?: { content?: string } }>
}

/**
 * Response format for Anthropic-compatible APIs (Anthropic, Bedrock)
 */
interface AnthropicCompatibleResponse {
  content?: Array<{ type?: string; text?: string }>
}

/**
 * Response format for Cloudflare Workers AI
 */
interface WorkersAIResponse {
  result?: { response?: string }
}

/**
 * Parses response from OpenAI-compatible APIs and returns classification.
 *
 * @param response - The fetch Response object
 * @param providerName - Name of the provider for error messages
 * @returns Parsed classification result
 * @throws Error if response is not OK or cannot be parsed
 */
async function parseOpenAICompatibleResponse(
  response: Response,
  providerName: string
): Promise<{ type: FunctionType; confidence: number; reasoning: string }> {
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    throw new Error(`${providerName} API error: ${response.status} ${response.statusText} - ${errorBody}`)
  }

  const data = (await response.json()) as OpenAICompatibleResponse
  const text = data.choices?.[0]?.message?.content || ''
  return parseClassificationResponse(text)
}

/**
 * Parses response from Anthropic-compatible APIs and returns classification.
 *
 * @param response - The fetch Response object
 * @param providerName - Name of the provider for error messages
 * @returns Parsed classification result
 * @throws Error if response is not OK or cannot be parsed
 */
async function parseAnthropicCompatibleResponse(
  response: Response,
  providerName: string
): Promise<{ type: FunctionType; confidence: number; reasoning: string }> {
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    throw new Error(`${providerName} API error: ${response.status} ${response.statusText} - ${errorBody}`)
  }

  const data = (await response.json()) as AnthropicCompatibleResponse
  const textContent = data.content?.find((c) => c.type === 'text')
  const text = textContent?.text || ''
  return parseClassificationResponse(text)
}

/**
 * Parses response from Bedrock API (similar to Anthropic but slightly different structure).
 *
 * @param response - The fetch Response object
 * @param providerName - Name of the provider for error messages
 * @returns Parsed classification result
 * @throws Error if response is not OK or cannot be parsed
 */
async function parseBedrockResponse(
  response: Response,
  providerName: string
): Promise<{ type: FunctionType; confidence: number; reasoning: string }> {
  if (!response.ok) {
    throw new Error(`${providerName} API error: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as { content?: Array<{ text?: string }> }
  const text = data.content?.[0]?.text || ''
  return parseClassificationResponse(text)
}

/**
 * Parses response from Cloudflare Workers AI REST API.
 *
 * @param response - The fetch Response object
 * @param providerName - Name of the provider for error messages
 * @returns The response text to be further parsed
 * @throws Error if response is not OK
 */
async function parseWorkersAIResponse(
  response: Response,
  providerName: string
): Promise<string> {
  if (!response.ok) {
    throw new Error(`${providerName} API error: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as WorkersAIResponse
  return data.result?.response || ''
}

// =============================================================================
// AI PROVIDER IMPLEMENTATIONS
// =============================================================================

/**
 * Workers AI binding interface (from @cloudflare/workers-types)
 */
export interface WorkersAIBinding {
  run(model: string, input: unknown): Promise<unknown>
}

/**
 * Cloudflare Workers AI provider - uses the AI binding directly
 */
class CloudflareWorkersAIProvider implements AIProvider {
  readonly type: AIProviderType = 'cloudflare-workers-ai'

  constructor(
    private config: AIProviderConfig,
    private binding?: WorkersAIBinding
  ) {}

  async classify(
    prompt: string,
    systemPrompt: string,
    options: { temperature: number; timeoutMs: number }
  ): Promise<{ type: FunctionType; confidence: number; reasoning: string }> {
    const model = this.config.model || '@cf/meta/llama-3.1-8b-instruct'
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ]

    let responseText: string

    if (this.binding) {
      // Use direct binding (preferred in Workers environment)
      const response = await this.binding.run(model, {
        messages,
        temperature: options.temperature,
        max_tokens: 256,
      })
      responseText = (response as { response?: string })?.response || ''
    } else if (this.config.accountId && this.config.apiKey) {
      // Fallback to REST API if no binding
      const url = `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/ai/run/${model}`
      const res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages,
            temperature: options.temperature,
            max_tokens: 256,
          }),
        },
        options.timeoutMs
      )
      responseText = await parseWorkersAIResponse(res, 'Workers AI')
    } else {
      throw new Error('Cloudflare Workers AI requires either a binding or accountId + apiKey')
    }

    return parseClassificationResponse(responseText)
  }
}

/**
 * OpenRouter provider (supports many models)
 */
class OpenRouterProvider implements AIProvider {
  readonly type: AIProviderType = 'openrouter'

  constructor(private config: AIProviderConfig) {}

  async classify(
    prompt: string,
    systemPrompt: string,
    options: { temperature: number; timeoutMs: number }
  ): Promise<{ type: FunctionType; confidence: number; reasoning: string }> {
    const model = this.config.model || 'anthropic/claude-3-haiku'
    const baseUrl = this.config.baseUrl || 'https://openrouter.ai/api/v1'

    const res = await fetchWithTimeout(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://functions.do',
          'X-Title': 'Functions.do Classifier',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          temperature: options.temperature,
          max_tokens: 256,
        }),
      },
      options.timeoutMs
    )

    return parseOpenAICompatibleResponse(res, 'OpenRouter')
  }
}

/**
 * AWS Bedrock provider
 */
class BedrockProvider implements AIProvider {
  readonly type: AIProviderType = 'bedrock'

  constructor(private config: AIProviderConfig) {}

  async classify(
    prompt: string,
    systemPrompt: string,
    options: { temperature: number; timeoutMs: number }
  ): Promise<{ type: FunctionType; confidence: number; reasoning: string }> {
    const model = this.config.model || 'anthropic.claude-3-haiku-20240307-v1:0'
    const region = this.config.region || 'us-east-1'

    // Bedrock uses AWS Signature V4 - in a real implementation you'd use @aws-sdk/client-bedrock-runtime
    // Note: In production, this would use proper AWS Signature V4 signing
    // For Workers, you'd typically use a service binding or pre-signed credentials
    const endpoint = `https://bedrock-runtime.${region}.amazonaws.com/model/${model}/invoke`

    const res = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // AWS credentials would be added here via signing
        },
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 256,
          temperature: options.temperature,
          system: systemPrompt,
          messages: [{ role: 'user', content: prompt }],
        }),
      },
      options.timeoutMs
    )

    return parseBedrockResponse(res, 'Bedrock')
  }
}

/**
 * Anthropic API provider
 */
class AnthropicProvider implements AIProvider {
  readonly type: AIProviderType = 'anthropic'

  constructor(private config: AIProviderConfig) {}

  async classify(
    prompt: string,
    systemPrompt: string,
    options: { temperature: number; timeoutMs: number }
  ): Promise<{ type: FunctionType; confidence: number; reasoning: string }> {
    const model = this.config.model || 'claude-3-haiku-20240307'
    const baseUrl = this.config.baseUrl || 'https://api.anthropic.com'

    const res = await fetchWithTimeout(
      `${baseUrl}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'x-api-key': this.config.apiKey || '',
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 256,
          temperature: options.temperature,
          system: systemPrompt,
          messages: [{ role: 'user', content: prompt }],
        }),
      },
      options.timeoutMs
    )

    return parseAnthropicCompatibleResponse(res, 'Anthropic')
  }
}

/**
 * OpenAI API provider
 */
class OpenAIProvider implements AIProvider {
  readonly type: AIProviderType = 'openai'

  constructor(private config: AIProviderConfig) {}

  async classify(
    prompt: string,
    systemPrompt: string,
    options: { temperature: number; timeoutMs: number }
  ): Promise<{ type: FunctionType; confidence: number; reasoning: string }> {
    const model = this.config.model || 'gpt-4o-mini'
    const baseUrl = this.config.baseUrl || 'https://api.openai.com/v1'

    const res = await fetchWithTimeout(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          temperature: options.temperature,
          max_tokens: 256,
        }),
      },
      options.timeoutMs
    )

    return parseOpenAICompatibleResponse(res, 'OpenAI')
  }
}

/**
 * Create an AI provider instance from config
 */
function createProvider(
  config: AIProviderConfig,
  workersAIBinding?: WorkersAIBinding
): AIProvider {
  switch (config.type) {
    case 'cloudflare-workers-ai':
      return new CloudflareWorkersAIProvider(config, workersAIBinding)
    case 'openrouter':
      return new OpenRouterProvider(config)
    case 'bedrock':
      return new BedrockProvider(config)
    case 'anthropic':
      return new AnthropicProvider(config)
    case 'openai':
      return new OpenAIProvider(config)
    default:
      throw new Error(`Unknown AI provider type: ${(config as AIProviderConfig).type}`)
  }
}

// =============================================================================
// FUNCTION CLASSIFIER CLASS
// =============================================================================

/**
 * Multi-provider function classifier with caching and automatic fallback.
 *
 * The classifier tries providers in order until one succeeds. Results are cached
 * to avoid repeated classification calls for the same function.
 *
 * @example
 * ```typescript
 * // With Workers AI binding (preferred in Cloudflare Workers)
 * const classifier = new FunctionClassifier({
 *   providers: [{ type: 'cloudflare-workers-ai' }],
 * }, env.AI)
 *
 * // With multiple providers for fallback
 * const classifier = new FunctionClassifier({
 *   providers: [
 *     { type: 'cloudflare-workers-ai' },
 *     { type: 'openrouter', apiKey: '...' },
 *     { type: 'anthropic', apiKey: '...' },
 *   ],
 * }, env.AI)
 *
 * const result = await classifier.classify('calculateTax', 'Computes sales tax')
 * // { type: 'code', confidence: 0.95, reasoning: '...', provider: 'cloudflare-workers-ai' }
 * ```
 */
export class FunctionClassifier {
  private providers: AIProvider[]
  private cache: Map<string, ClassificationCacheEntry> = new Map()
  private maxCacheSize: number
  private defaultCacheTtlMs: number
  private temperature: number
  private timeoutMs: number
  private maxRetriesPerProvider: number

  constructor(
    options: ClassifierOptions,
    workersAIBinding?: WorkersAIBinding
  ) {
    if (!options.providers || options.providers.length === 0) {
      throw new Error('FunctionClassifier requires at least one AI provider')
    }

    this.providers = options.providers.map((config) =>
      createProvider(
        config,
        config.type === 'cloudflare-workers-ai' ? workersAIBinding : undefined
      )
    )
    this.temperature = options.temperature ?? 0
    this.timeoutMs = options.timeoutMs ?? 10000
    this.maxRetriesPerProvider = options.maxRetriesPerProvider ?? 1
    this.maxCacheSize = CLASSIFIER_CACHE.MAX_SIZE
    this.defaultCacheTtlMs = CLASSIFIER_CACHE.TTL_MS
  }

  /**
   * Classify a function into one of the four execution tiers.
   *
   * @param name - The function name (e.g., "calculateTax", "summarizeArticle")
   * @param description - Optional description of what the function does
   * @param inputSchema - Optional JSON Schema describing the function's input
   * @returns Classification result with type, confidence, reasoning, and provider used
   * @throws Error if all providers fail
   */
  async classify(
    name: string,
    description?: string,
    inputSchema?: Record<string, unknown>
  ): Promise<ClassificationResult> {
    const cacheKey = this.computeCacheKey(name, description, inputSchema)

    // Check cache first
    const cached = this.getFromCache(cacheKey)
    if (cached) {
      return cached
    }

    // Build the classification prompt
    const prompt = buildUserMessage(name, description, inputSchema)
    const startTime = Date.now()

    // Try each provider in order
    const errors: Array<{ provider: string; error: string }> = []

    for (const provider of this.providers) {
      for (let attempt = 0; attempt < this.maxRetriesPerProvider; attempt++) {
        try {
          const classification = await provider.classify(prompt, CLASSIFICATION_SYSTEM_PROMPT, {
            temperature: this.temperature,
            timeoutMs: this.timeoutMs,
          })

          const result: ClassificationResult = {
            ...classification,
            provider: provider.type,
            latencyMs: Date.now() - startTime,
          }

          // Cache the result
          this.setInCache(cacheKey, result)

          return result
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          errors.push({ provider: provider.type, error: errorMessage })

          // If this was the last retry for this provider, move to next provider
          if (attempt === this.maxRetriesPerProvider - 1) {
            break
          }

          // Brief delay before retry
          await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
        }
      }
    }

    // All providers failed
    throw new Error(
      `All AI providers failed to classify function "${name}". Errors: ${JSON.stringify(errors)}`
    )
  }

  /**
   * Get the number of cached classifications
   */
  getCacheSize(): number {
    return this.cache.size
  }

  /**
   * Clear the classification cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(
    name: string,
    description?: string,
    inputSchema?: Record<string, unknown>
  ): boolean {
    const cacheKey = this.computeCacheKey(name, description, inputSchema)
    return this.cache.delete(cacheKey)
  }

  /**
   * Get the list of configured providers (for diagnostics)
   */
  getProviders(): AIProviderType[] {
    return this.providers.map((p) => p.type)
  }

  private computeCacheKey(
    name: string,
    description?: string,
    inputSchema?: Record<string, unknown>
  ): string {
    const parts = [name]
    if (description) parts.push(description)
    if (inputSchema) parts.push(JSON.stringify(inputSchema))
    return parts.join(':')
  }

  private getFromCache(key: string): ClassificationResult | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    const now = Date.now()
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      return null
    }

    // Touch for LRU ordering
    this.cache.delete(key)
    this.cache.set(key, entry)

    return entry.result
  }

  private setInCache(key: string, result: ClassificationResult): void {
    // Evict oldest if cache is full
    if (this.cache.size >= this.maxCacheSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      ttl: this.defaultCacheTtlMs,
    })
  }
}

// =============================================================================
// CONVENIENCE FUNCTION
// =============================================================================

/**
 * Standalone classification function for one-off use.
 *
 * For repeated classifications, prefer using the FunctionClassifier class
 * which provides caching and connection reuse.
 *
 * @param name - The function name
 * @param description - Optional description
 * @param inputSchema - Optional input schema
 * @param options - Classifier options with provider configuration
 * @returns Classification result
 * @throws Error if all providers fail
 */
export async function classifyFunction(
  name: string,
  description?: string,
  inputSchema?: Record<string, unknown>,
  options?: ClassifierOptions
): Promise<ClassificationResult> {
  if (!options || !options.providers || options.providers.length === 0) {
    throw new Error('classifyFunction requires at least one AI provider in options')
  }

  const classifier = new FunctionClassifier(options)
  return classifier.classify(name, description, inputSchema)
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Build the user message for the AI classification request
 */
function buildUserMessage(
  name: string,
  description?: string,
  inputSchema?: Record<string, unknown>
): string {
  const parts = [`Function name: ${name}`]

  if (description) {
    parts.push(`Description: ${description}`)
  }

  if (inputSchema) {
    parts.push(`Input schema: ${JSON.stringify(inputSchema, null, 2)}`)
  }

  parts.push('\nClassify this function into one of the four types: code, generative, agentic, or human.')

  return parts.join('\n')
}

/**
 * Parse the AI response into a classification result.
 * Throws if the response cannot be parsed into a valid classification.
 */
function parseClassificationResponse(rawResponse: string): {
  type: FunctionType
  confidence: number
  reasoning: string
} {
  let content = rawResponse.trim()

  // Strip markdown code blocks if present
  const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (codeBlockMatch && codeBlockMatch[1] !== undefined) {
    content = codeBlockMatch[1].trim()
  }

  try {
    const parsed = JSON.parse(content)

    // Validate the parsed result
    const validTypes: FunctionType[] = ['code', 'generative', 'agentic', 'human']
    if (!validTypes.includes(parsed.type)) {
      throw new Error(`Invalid function type in response: ${parsed.type}`)
    }

    const confidence =
      typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5

    const reasoning =
      typeof parsed.reasoning === 'string'
        ? parsed.reasoning
        : `Classified as ${parsed.type} by AI analysis.`

    return {
      type: parsed.type,
      confidence,
      reasoning,
    }
  } catch (parseError) {
    // Try to extract the type from the text as a last resort
    const typeMatch = content.match(/\b(code|generative|agentic|human)\b/i)
    if (typeMatch && typeMatch[1] !== undefined) {
      const type = typeMatch[1].toLowerCase() as FunctionType
      return {
        type,
        confidence: 0.5,
        reasoning: `Extracted type "${type}" from non-JSON AI response.`,
      }
    }

    // Cannot parse response at all
    throw new Error(
      `Failed to parse AI classification response: ${parseError instanceof Error ? parseError.message : String(parseError)}. Raw response: ${content.substring(0, 200)}`
    )
  }
}

// =============================================================================
// FACTORY HELPERS
// =============================================================================

/**
 * Create a classifier from a Workers AI binding.
 *
 * This is the primary way to create a classifier in Cloudflare Workers.
 * The Workers AI binding is always available and provides the most reliable
 * classification.
 *
 * @param aiBinding - The Workers AI binding (env.AI)
 * @param model - Optional model override (default: '@cf/meta/llama-3.1-8b-instruct')
 * @returns A configured FunctionClassifier instance
 *
 * @example
 * ```typescript
 * // In a Cloudflare Worker
 * const classifier = createClassifierFromBinding(env.AI)
 * const result = await classifier.classify('calculateTax')
 * ```
 */
export function createClassifierFromBinding(
  aiBinding: WorkersAIBinding,
  model?: string
): FunctionClassifier {
  return new FunctionClassifier(
    {
      providers: [
        {
          type: 'cloudflare-workers-ai',
          model: model || '@cf/meta/llama-3.1-8b-instruct',
        },
      ],
      temperature: 0,
      timeoutMs: 10000,
    },
    aiBinding
  )
}

/**
 * Create classifier options from environment variables with optional Workers AI binding.
 *
 * Priority order:
 * 1. Workers AI binding (if provided) - always available in Cloudflare Workers
 * 2. OpenRouter - good fallback with many models
 * 3. Anthropic direct
 * 4. OpenAI
 * 5. AWS Bedrock
 *
 * @param env - Environment variables
 * @param aiBinding - Optional Workers AI binding for primary provider
 * @returns ClassifierOptions with configured providers
 */
export function createClassifierOptionsFromEnv(
  env: Record<string, string | undefined>,
  aiBinding?: WorkersAIBinding
): ClassifierOptions {
  const providers: AIProviderConfig[] = []

  // Workers AI binding is always the primary provider when available
  if (aiBinding) {
    providers.push({
      type: 'cloudflare-workers-ai',
      model: env.WORKERS_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct',
    })
  } else if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) {
    // Fallback to REST API if no binding
    providers.push({
      type: 'cloudflare-workers-ai',
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      apiKey: env.CLOUDFLARE_API_TOKEN,
      model: env.WORKERS_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct',
    })
  }

  // OpenRouter (good fallback with many models)
  if (env.OPENROUTER_API_KEY) {
    providers.push({
      type: 'openrouter',
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku',
    })
  }

  // Anthropic direct
  if (env.ANTHROPIC_API_KEY) {
    providers.push({
      type: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL || 'claude-3-haiku-20240307',
    })
  }

  // OpenAI
  if (env.OPENAI_API_KEY) {
    providers.push({
      type: 'openai',
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL || 'gpt-4o-mini',
    })
  }

  // Bedrock (requires AWS credentials configured externally)
  if (env.AWS_REGION && env.USE_BEDROCK === 'true') {
    providers.push({
      type: 'bedrock',
      region: env.AWS_REGION,
      model: env.BEDROCK_MODEL || 'anthropic.claude-3-haiku-20240307-v1:0',
    })
  }

  if (providers.length === 0) {
    throw new Error(
      'No AI providers configured. Ensure the AI binding is available or set OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY'
    )
  }

  return {
    providers,
    temperature: 0,
    timeoutMs: 10000,
  }
}

/**
 * Create a classifier from environment with Workers AI binding.
 *
 * This is the recommended factory function for Cloudflare Workers.
 * It uses the AI binding as the primary provider with optional fallbacks.
 *
 * @param aiBinding - The Workers AI binding (env.AI)
 * @param env - Optional environment variables for fallback providers
 * @returns A configured FunctionClassifier instance
 *
 * @example
 * ```typescript
 * // In a Cloudflare Worker - just use the binding
 * const classifier = createClassifier(env.AI)
 *
 * // With fallback providers
 * const classifier = createClassifier(env.AI, {
 *   OPENROUTER_API_KEY: '...',
 *   ANTHROPIC_API_KEY: '...',
 * })
 * ```
 */
export function createClassifier(
  aiBinding: WorkersAIBinding,
  env?: Record<string, string | undefined>
): FunctionClassifier {
  const options = createClassifierOptionsFromEnv(env || {}, aiBinding)
  return new FunctionClassifier(options, aiBinding)
}
