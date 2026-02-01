/**
 * AI Module
 *
 * Re-exports AI primitives from ai-functions package.
 * Uses Vercel AI SDK v5 with all major providers through ai-providers.
 *
 * @module ai
 */

// Re-export types from ai-functions
export type {
  AIClient,
  AIFunctionDefinition,
  AIGenerateOptions,
  AIGenerateResult,
  AIFunctionCall,
  JSONSchema,
} from 'ai-functions'

// Re-export generation functions
export { generate, generateObject, generateText, streamObject, streamText } from 'ai-functions'

// Re-export primitives for direct usage
export { ai, write, code, list, lists, extract, summarize, is, diagram, slides } from 'ai-functions'

// Re-export context utilities
export { configure, getContext, withContext, getModel, getProvider } from 'ai-functions'
