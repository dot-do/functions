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
 * the appropriate tier. It uses the same AIClient pattern as the generative executor.
 *
 * @module core/function-classifier
 */

import type { AIClient } from '../tiers/generative-executor'

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
}

/**
 * Options for the classifier
 */
export interface ClassifierOptions {
  /** AI model to use for classification (default: 'claude-3-haiku') */
  model?: string
  /** Temperature for the AI call (default: 0 for deterministic) */
  temperature?: number
  /** Timeout in milliseconds (default: 10000) */
  timeoutMs?: number
}

/**
 * Cache entry for classification results
 */
interface ClassificationCacheEntry {
  result: ClassificationResult
  timestamp: number
  ttl: number
}

// =============================================================================
// SYSTEM PROMPT
// =============================================================================

const CLASSIFICATION_SYSTEM_PROMPT = `You are a function type classifier for the Functions.do platform. Your job is to analyze a function's name, description, and input schema to determine what execution tier it belongs to.

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
// CLASSIFIER
// =============================================================================

/**
 * Classify a function into one of the four execution tiers using AI analysis.
 *
 * The classifier sends the function's name, description, and input schema to an
 * AI model which returns a structured classification with confidence score and
 * reasoning.
 *
 * @param name - The function name (e.g., "calculateTax", "summarizeArticle")
 * @param description - Optional description of what the function does
 * @param inputSchema - Optional JSON Schema describing the function's input
 * @param aiClient - The AI client to use for classification (Claude or GPT-compatible)
 * @param options - Optional classifier configuration
 * @returns Classification result with type, confidence, and reasoning
 *
 * @example
 * ```typescript
 * const result = await classifyFunction(
 *   'calculateTax',
 *   'Calculates sales tax for a given amount and rate',
 *   { type: 'object', properties: { amount: { type: 'number' }, rate: { type: 'number' } } },
 *   aiClient
 * )
 * // { type: 'code', confidence: 0.95, reasoning: 'Tax calculation is a deterministic arithmetic operation.' }
 * ```
 */
export async function classifyFunction(
  name: string,
  description?: string,
  inputSchema?: Record<string, unknown>,
  aiClient?: AIClient,
  options?: ClassifierOptions,
): Promise<ClassificationResult> {
  // If no AI client provided, fall back to heuristic classification
  if (!aiClient) {
    return classifyByHeuristic(name, description)
  }

  const model = options?.model ?? 'claude-3-haiku'
  const temperature = options?.temperature ?? 0
  const timeoutMs = options?.timeoutMs ?? 10000

  // Build the user message describing the function
  const userMessage = buildUserMessage(name, description, inputSchema)

  // Set up timeout
  const abortController = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let timedOut = false

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true
      abortController.abort()
      reject(new Error('Classification timeout'))
    }, timeoutMs)
  })

  try {
    // Try Claude-style API first
    const responsePromise = aiClient.messages.create({
      model,
      messages: [{ role: 'user', content: userMessage }],
      system: CLASSIFICATION_SYSTEM_PROMPT,
      max_tokens: 256,
      temperature,
      signal: abortController.signal,
    })

    const response = await Promise.race([responsePromise, timeoutPromise])

    // Extract text content from response
    const textContent = response.content.find((c) => c.type === 'text')
    const rawResponse = textContent?.text ?? ''

    return parseClassificationResponse(rawResponse, name, description)
  } catch (error) {
    if (timedOut) {
      // On timeout, fall back to heuristic
      return classifyByHeuristic(name, description)
    }

    // On any AI error, fall back to heuristic
    return classifyByHeuristic(name, description)
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

// =============================================================================
// FUNCTION CLASSIFIER CLASS (stateful, with caching)
// =============================================================================

/**
 * Stateful function classifier with built-in caching.
 *
 * Use this class when you need to classify multiple functions and want to
 * benefit from cached results. The cache uses function name + description
 * as the key.
 */
export class FunctionClassifier {
  private cache: Map<string, ClassificationCacheEntry> = new Map()
  private maxCacheSize: number
  private defaultCacheTtlMs: number

  constructor(
    private aiClient?: AIClient,
    private options?: ClassifierOptions & {
      /** Maximum cache entries (default: 500) */
      maxCacheSize?: number
      /** Default cache TTL in milliseconds (default: 3600000 = 1 hour) */
      defaultCacheTtlMs?: number
    },
  ) {
    this.maxCacheSize = options?.maxCacheSize ?? 500
    this.defaultCacheTtlMs = options?.defaultCacheTtlMs ?? 3600000
  }

  /**
   * Classify a function, using cached result if available.
   */
  async classify(
    name: string,
    description?: string,
    inputSchema?: Record<string, unknown>,
  ): Promise<ClassificationResult> {
    const cacheKey = this.computeCacheKey(name, description, inputSchema)

    // Check cache
    const cached = this.getFromCache(cacheKey)
    if (cached) {
      return cached
    }

    // Classify
    const result = await classifyFunction(
      name,
      description,
      inputSchema,
      this.aiClient,
      this.options,
    )

    // Cache the result
    this.setInCache(cacheKey, result)

    return result
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
    inputSchema?: Record<string, unknown>,
  ): boolean {
    const cacheKey = this.computeCacheKey(name, description, inputSchema)
    return this.cache.delete(cacheKey)
  }

  private computeCacheKey(
    name: string,
    description?: string,
    inputSchema?: Record<string, unknown>,
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
// HEURISTIC CLASSIFICATION (fallback when no AI client)
// =============================================================================

/**
 * Keyword patterns that strongly indicate a function type.
 * Used as a fallback when AI classification is unavailable.
 */
const CODE_PATTERNS = [
  /^(calculate|compute|convert|format|parse|validate|sort|filter|transform|encode|decode|hash|generate(?:UUID|Id|Hash|Token)|compress|decompress|encrypt|decrypt|serialize|deserialize|merge|split|trim|pad|round|clamp|normalize|sanitize|escape|unescape|count|sum|average|min|max|diff|compare(?!Products|Options|Alternatives|Vendors|Competitors)|check|is[A-Z]|has[A-Z]|get[A-Z]|set[A-Z]|to[A-Z]|from[A-Z])/i,
  /^(math|string|array|object|date|time|number|json|csv|xml|url|base64|hex|binary|regex|uuid|slug|camelCase|snakeCase|capitalize)/i,
]

const GENERATIVE_PATTERNS = [
  /^(summarize|translate|generate(?!UUID|Id|Hash|Token)|write|rewrite|compose|draft|describe|explain|classify(?!Function)|categorize|extract|analyze(?!Code)|answer|complete|suggest|recommend|paraphrase|simplify|elaborate|rephrase)/i,
  /^(create(?:Content|Text|Copy|Email|Response|Summary|Description|Title|Tagline|Headline|Caption))/i,
  /(sentiment|tone|language|nlp|text|article|email|message|post|comment|feedback)/i,
]

const AGENTIC_PATTERNS = [
  /^(research|investigate|analyze(?:Code|System|Codebase)|audit|plan|orchestrate|coordinate|build(?:Report|Pipeline|Workflow)|debug|diagnose|troubleshoot|monitor|scan|crawl|scrape|index)/i,
  /^(compare(?:Products|Options|Alternatives|Vendors))/i,
  /^(evaluate(?!Candidate|Application|Submission|Job)(?:Options|System|Performance|Risk)|assess(?:Risk|Impact|Performance)|review(?:Code|PR|Architecture))/i,
  /(multi.?step|pipeline|workflow|complex|iterative|comprehensive|thorough|detailed.?analysis)/i,
]

const HUMAN_PATTERNS = [
  /^(approve|reject|moderate|verify|confirm|authorize|sign|certify|validate(?:Human|Manual)|escalate|assign(?:Priority|Task|To))/i,
  /^(review(?!Code|PR|Architecture)(?:Content|For|User|Submission|Application))/i,
  /^(evaluate(?:Candidate|Application|Submission|Job))/i,
  /(approval|human|manual|judgment|decision|opinion|subjective|creative.?direction|editorial|policy|compliance|legal)/i,
  /(?:moderate|review).?(?:content|user|post|submission)/i,
]

/**
 * Classify a function using name/description pattern matching.
 *
 * This is the fallback classifier used when no AI client is available.
 * It uses keyword patterns to determine the most likely function type.
 *
 * @param name - The function name
 * @param description - Optional description
 * @returns Classification result based on heuristics
 */
export function classifyByHeuristic(
  name: string,
  description?: string,
): ClassificationResult {
  const text = description ? `${name} ${description}` : name

  // Score each type
  const scores: Record<FunctionType, number> = {
    code: 0,
    generative: 0,
    agentic: 0,
    human: 0,
  }

  for (const pattern of CODE_PATTERNS) {
    if (pattern.test(name)) scores.code += 2
    if (description && pattern.test(description)) scores.code += 1
  }

  for (const pattern of GENERATIVE_PATTERNS) {
    if (pattern.test(name)) scores.generative += 2
    if (description && pattern.test(description)) scores.generative += 1
  }

  for (const pattern of AGENTIC_PATTERNS) {
    if (pattern.test(name)) scores.agentic += 2
    if (description && pattern.test(description)) scores.agentic += 1
  }

  for (const pattern of HUMAN_PATTERNS) {
    if (pattern.test(name)) scores.human += 2
    if (description && pattern.test(description)) scores.human += 1
  }

  // Find the winning type
  const entries = Object.entries(scores) as [FunctionType, number][]
  entries.sort((a, b) => b[1] - a[1])

  const bestEntry = entries[0]!
  const secondEntry = entries[1]!
  const bestType: FunctionType = bestEntry[0]
  const bestScore: number = bestEntry[1]
  const secondScore: number = secondEntry[1]

  // If no patterns matched, default to 'code' with low confidence
  if (bestScore === 0) {
    return {
      type: 'code',
      confidence: 0.3,
      reasoning: `No strong indicators found for function "${name}". Defaulting to code tier.`,
    }
  }

  // Calculate confidence based on score margin
  const margin = bestScore - secondScore
  const totalScore = entries.reduce((sum, entry) => sum + entry[1], 0)
  const confidence = Math.min(0.9, 0.5 + (margin / Math.max(totalScore, 1)) * 0.4)

  const typeLabels: Record<FunctionType, string> = {
    code: 'deterministic computation',
    generative: 'AI content generation',
    agentic: 'multi-step AI reasoning',
    human: 'human judgment or approval',
  }

  return {
    type: bestType,
    confidence: Math.round(confidence * 100) / 100,
    reasoning: `Function name "${name}" matches patterns for ${typeLabels[bestType]} (heuristic classification).`,
  }
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
  inputSchema?: Record<string, unknown>,
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
 * Parse the AI response into a ClassificationResult.
 * Handles malformed responses gracefully by falling back to heuristic.
 */
function parseClassificationResponse(
  rawResponse: string,
  name: string,
  description?: string,
): ClassificationResult {
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
      return classifyByHeuristic(name, description)
    }

    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5

    const reasoning = typeof parsed.reasoning === 'string'
      ? parsed.reasoning
      : `Classified as ${parsed.type} by AI analysis.`

    return {
      type: parsed.type,
      confidence,
      reasoning,
    }
  } catch {
    // If JSON parsing fails, try to extract the type from the text
    const typeMatch = content.match(/\b(code|generative|agentic|human)\b/i)
    if (typeMatch && typeMatch[1] !== undefined) {
      const type = typeMatch[1].toLowerCase() as FunctionType
      return {
        type,
        confidence: 0.5,
        reasoning: `Extracted type "${type}" from non-JSON AI response.`,
      }
    }

    // Complete fallback to heuristic
    return classifyByHeuristic(name, description)
  }
}
