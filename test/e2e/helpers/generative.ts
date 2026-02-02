/**
 * Generative Function E2E Test Helpers
 *
 * Shared types, utilities, and helpers for generative function E2E tests.
 */

import { E2E_CONFIG } from '../config'

// =============================================================================
// GENERATIVE FUNCTION TYPES
// =============================================================================

export interface GenerativeFunctionDeployParams {
  id: string
  name?: string
  model?: string
  systemPrompt?: string
  userPrompt: string
  outputSchema: object
  temperature?: number
  maxTokens?: number
  examples?: Array<{
    input: Record<string, unknown>
    output: unknown
  }>
  cacheEnabled?: boolean
  cacheTtlSeconds?: number
}

export interface GenerativeFunctionDeployResult {
  id: string
  version: string
  url: string
  type: string
}

export interface GenerativeInvokeMetadata {
  model: string
  tokens: {
    input: number
    output: number
    total: number
  }
  cached: boolean
  latencyMs: number
  stopReason: string
}

export interface GenerativeInvokeResult<T = unknown> {
  output: T
  metadata?: GenerativeInvokeMetadata
}

// =============================================================================
// GENERATIVE FUNCTION HELPERS
// =============================================================================

/**
 * Deploy a generative function to functions.do
 */
export async function deployGenerativeFunction(
  params: GenerativeFunctionDeployParams
): Promise<GenerativeFunctionDeployResult> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/functions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
      ...(process.env.FUNCTIONS_AI_API_KEY
        ? { 'X-AI-API-Key': process.env.FUNCTIONS_AI_API_KEY }
        : {}),
    },
    body: JSON.stringify({
      id: params.id,
      name: params.name ?? params.id,
      type: 'generative',
      version: '1.0.0',
      model: params.model ?? 'claude-3-sonnet',
      systemPrompt: params.systemPrompt,
      userPrompt: params.userPrompt,
      outputSchema: params.outputSchema,
      temperature: params.temperature ?? 0,
      maxTokens: params.maxTokens,
      examples: params.examples,
      cacheEnabled: params.cacheEnabled,
      cacheTtlSeconds: params.cacheTtlSeconds,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Deploy generative function failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Invoke a generative function with variables
 */
export async function invokeGenerativeFunction<T = unknown>(
  functionId: string,
  variables?: Record<string, unknown>,
  options?: {
    includeMetadata?: boolean
  }
): Promise<GenerativeInvokeResult<T>> {
  const url = new URL(`${E2E_CONFIG.baseUrl}/functions/${functionId}/invoke`)
  if (options?.includeMetadata) {
    url.searchParams.set('includeMetadata', 'true')
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
      ...(process.env.FUNCTIONS_AI_API_KEY
        ? { 'X-AI-API-Key': process.env.FUNCTIONS_AI_API_KEY }
        : {}),
    },
    body: variables ? JSON.stringify(variables) : undefined,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Invoke generative function failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Get function details
 */
export async function getGenerativeFunction(functionId: string): Promise<{
  id: string
  type: string
  model?: string
  outputSchema?: object
}> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/functions/${functionId}`, {
    headers: {
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Get function failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Invoke a function and return the raw response for detailed inspection
 */
export async function invokeGenerativeFunctionRaw(
  functionId: string,
  variables?: Record<string, unknown>
): Promise<Response> {
  return fetch(`${E2E_CONFIG.baseUrl}/functions/${functionId}/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
      ...(process.env.FUNCTIONS_AI_API_KEY
        ? { 'X-AI-API-Key': process.env.FUNCTIONS_AI_API_KEY }
        : {}),
    },
    body: variables ? JSON.stringify(variables) : undefined,
  })
}

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

/** Check if AI API key is available */
export const hasAIKey = !!process.env.FUNCTIONS_AI_API_KEY

/** Check if OpenAI API key is available */
export const hasOpenAIKey = !!process.env.OPENAI_API_KEY

/** Extended timeout for AI operations */
export const AI_TIMEOUT = 60_000 // 60 seconds for AI model responses

/** Deploy timeout + AI timeout */
export const DEPLOY_AND_INVOKE_TIMEOUT = E2E_CONFIG.deployTimeout + AI_TIMEOUT
