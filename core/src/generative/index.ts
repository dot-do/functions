/**
 * Generative Functions - Single AI call with structured output
 *
 * Generative functions make a single AI model call to generate
 * structured output. They use schema-guided generation for
 * reliable, typed responses.
 *
 * Implementation: ai-functions (primitives.org.ai)
 *
 * Typical timeout: 30 seconds
 * Typical use: Text generation, classification, extraction, summarization
 */

import type {
  FunctionDefinition,
  FunctionResult,
  FunctionExecutor,
  ExecutionContext,
  TokenUsage,
  JsonSchema,
} from '../types.js'
import { functionId as toFunctionId, type FunctionId } from '../branded-types.js'

// =============================================================================
// GENERATIVE FUNCTION DEFINITION
// =============================================================================

export interface GenerativeFunctionDefinition<
  TInput = unknown,
  TOutput = unknown,
  TConfig = GenerativeFunctionConfig,
> extends FunctionDefinition<TInput, TOutput, TConfig> {
  type: 'generative'

  /** AI model to use */
  model?: AIModel

  /** System prompt template */
  systemPrompt?: string

  /** User prompt template (with {{variable}} placeholders) */
  userPrompt: string

  /** Output schema for structured generation */
  outputSchema: JsonSchema

  /** Few-shot examples */
  examples?: GenerativeExample[]

  /** Temperature (0-1) */
  temperature?: number

  /** Max output tokens */
  maxTokens?: number
}

/**
 * Known/supported AI model identifiers.
 * These are strongly typed for common models.
 */
export type KnownAIModel =
  | 'claude-3-opus'
  | 'claude-3-sonnet'
  | 'claude-3-haiku'
  | 'claude-4-opus'
  | 'claude-4-sonnet'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gemini-pro'
  | 'gemini-flash'

/**
 * Brand symbol for custom model IDs.
 * This prevents accidental string assignment while still allowing custom models.
 */
declare const __customModelBrand: unique symbol

/**
 * A branded type for custom AI model identifiers.
 * Use customModel() to create a CustomAIModel from a string.
 */
export type CustomAIModel = string & { readonly [__customModelBrand]: 'CustomAIModel' }

/**
 * Creates a CustomAIModel from a string.
 * Use this to specify AI models not in the KnownAIModel list.
 *
 * @param modelId - The model identifier string (e.g., 'anthropic/claude-3.5-sonnet')
 * @returns A branded CustomAIModel
 *
 * @example
 * ```typescript
 * import { customModel } from '@dotdo/functions/generative'
 *
 * const myModel = customModel('my-provider/custom-model-v1')
 * ```
 */
export function customModel(modelId: string): CustomAIModel {
  return modelId as CustomAIModel
}

/**
 * AI model type that supports both known models and custom branded models.
 * Use KnownAIModel values directly or wrap custom strings with customModel().
 */
export type AIModel = KnownAIModel | CustomAIModel

export interface GenerativeExample {
  input: Record<string, unknown>
  output: unknown
  explanation?: string
}

// =============================================================================
// GENERATIVE FUNCTION CONFIG
// =============================================================================

export interface GenerativeFunctionConfig {
  /** Override model */
  model?: AIModel

  /** Override temperature */
  temperature?: number

  /** Override max tokens */
  maxTokens?: number

  /** Additional context to inject */
  context?: string

  /** Enable caching */
  cacheEnabled?: boolean

  /** Cache TTL in seconds */
  cacheTtlSeconds?: number
}

// =============================================================================
// GENERATIVE FUNCTION RESULT
// =============================================================================

export interface GenerativeFunctionResult<TOutput = unknown>
  extends FunctionResult<TOutput> {
  /** Generative-specific execution info */
  generativeExecution: GenerativeExecutionInfo
}

export interface GenerativeExecutionInfo {
  /** Model used */
  model: string

  /** Token usage */
  tokens: TokenUsage

  /** Prompt that was sent */
  prompt?: {
    system?: string
    user: string
  }

  /** Raw model response (before parsing) */
  rawResponse?: string

  /** Whether result was cached */
  cached: boolean

  /** Stop reason */
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence'

  /** Model latency (time waiting for model) */
  modelLatencyMs: number
}

// =============================================================================
// GENERATIVE FUNCTION EXECUTOR
// =============================================================================

export interface GenerativeFunctionExecutor<
  TInput = unknown,
  TOutput = unknown,
> extends FunctionExecutor<TInput, TOutput, GenerativeFunctionConfig> {
  /** Render prompt with variables */
  renderPrompt(
    template: string,
    variables: Record<string, unknown>
  ): string
}

// =============================================================================
// HELPER: Define a generative function
// =============================================================================

export function defineGenerativeFunction<TInput, TOutput>(
  options: Omit<GenerativeFunctionDefinition<TInput, TOutput>, 'type'>
): GenerativeFunctionDefinition<TInput, TOutput> {
  return {
    ...options,
    type: 'generative',
    timeout: options.timeout ?? '30s',
    model: options.model ?? 'claude-3-sonnet',
    temperature: options.temperature ?? 0,
  }
}

// =============================================================================
// HELPER: Quick generative function
// =============================================================================

export function generativeFunction<TOutput>(
  id: string | FunctionId,
  prompt: string,
  outputSchema: JsonSchema,
  options?: {
    name?: string
    model?: AIModel
    systemPrompt?: string
    examples?: GenerativeExample[]
  }
): GenerativeFunctionDefinition<Record<string, unknown>, TOutput> {
  const funcId = typeof id === 'string' ? toFunctionId(id) : id
  const config: Omit<GenerativeFunctionDefinition<Record<string, unknown>, TOutput>, 'type'> = {
    id: funcId,
    name: options?.name ?? id,
    version: '1.0.0',
    userPrompt: prompt,
    outputSchema,
  }
  if (options?.systemPrompt !== undefined) {
    config.systemPrompt = options.systemPrompt
  }
  if (options?.model !== undefined) {
    config.model = options.model
  }
  if (options?.examples !== undefined) {
    config.examples = options.examples
  }
  return defineGenerativeFunction(config)
}

// =============================================================================
// PROMPT TEMPLATE HELPERS
// =============================================================================

/**
 * Tag template for prompt strings with variable interpolation
 */
export function prompt(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
  return strings.reduce((acc, str, i) => {
    const value = values[i]
    if (value === undefined) return acc + str
    // Convert value to placeholder: {{varName}} or literal
    if (typeof value === 'string' && value.startsWith('$')) {
      return acc + str + `{{${value.slice(1)}}}`
    }
    return acc + str + String(value)
  }, '')
}
