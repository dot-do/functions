/**
 * Agentic Function E2E Test Helpers
 *
 * Shared types, utilities, and helpers for agentic function E2E tests.
 */

import { E2E_CONFIG } from '../config'

// =============================================================================
// AGENTIC FUNCTION TYPES
// =============================================================================

export interface AgenticToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description?: string }>
    required?: string[]
  }
  implementation:
    | { type: 'function'; functionId: string }
    | { type: 'api'; endpoint: string; method?: string; headers?: Record<string, string> }
    | { type: 'builtin'; name: BuiltinTool }
    | { type: 'inline'; code: string }
}

export type BuiltinTool =
  | 'web_search'
  | 'web_fetch'
  | 'file_read'
  | 'file_write'
  | 'shell_exec'
  | 'database_query'
  | 'email_send'
  | 'slack_send'

export interface AgenticFunctionDeployParams {
  id: string
  model?: string
  systemPrompt: string
  goal: string
  tools: AgenticToolDefinition[]
  maxIterations?: number
  maxToolCallsPerIteration?: number
  enableReasoning?: boolean
  enableMemory?: boolean
  outputSchema?: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  timeout?: string
}

export interface AgenticFunctionDeployResult {
  id: string
  version: string
  url: string
  type: 'agentic'
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface ToolCallRecord {
  tool: string
  input: unknown
  output: unknown
  durationMs: number
  success: boolean
  error?: string
}

export interface AgentIteration {
  iteration: number
  timestamp: number
  reasoning?: string
  toolCalls: ToolCallRecord[]
  tokens: TokenUsage
  durationMs: number
}

export interface AgenticExecutionInfo {
  model: string
  totalTokens: TokenUsage
  iterations: number
  trace: AgentIteration[]
  toolsUsed: string[]
  goalAchieved: boolean
  reasoningSummary?: string
}

export interface AgenticInvokeResult<T = unknown> {
  executionId: string
  functionId: string
  functionVersion: string
  status: 'completed' | 'failed' | 'timeout' | 'cancelled'
  output?: T
  error?: {
    name: string
    message: string
    code?: string
  }
  metrics: {
    durationMs: number
    inputSizeBytes: number
    outputSizeBytes: number
    retryCount: number
    tokens?: TokenUsage
  }
  agenticExecution: AgenticExecutionInfo
}

// =============================================================================
// AGENTIC FUNCTION HELPERS
// =============================================================================

/**
 * Deploy an agentic function to functions.do
 */
export async function deployAgenticFunction(
  params: AgenticFunctionDeployParams
): Promise<AgenticFunctionDeployResult> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/functions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
    body: JSON.stringify({
      id: params.id,
      type: 'agentic',
      version: '1.0.0',
      model: params.model || 'claude-3-sonnet',
      systemPrompt: params.systemPrompt,
      goal: params.goal,
      tools: params.tools,
      maxIterations: params.maxIterations ?? 10,
      maxToolCallsPerIteration: params.maxToolCallsPerIteration ?? 5,
      enableReasoning: params.enableReasoning ?? true,
      enableMemory: params.enableMemory ?? false,
      outputSchema: params.outputSchema,
      timeout: params.timeout ?? '5m',
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Deploy agentic function failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Invoke an agentic function
 */
export async function invokeAgenticFunction<T = unknown>(
  functionId: string,
  input?: unknown,
  options?: { timeout?: number }
): Promise<AgenticInvokeResult<T>> {
  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(),
    options?.timeout ?? E2E_CONFIG.invokeTimeout
  )

  try {
    const response = await fetch(
      `${E2E_CONFIG.baseUrl}/functions/${functionId}/invoke`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
        },
        body: input ? JSON.stringify(input) : undefined,
        signal: controller.signal,
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Invoke agentic function failed (${response.status}): ${error}`)
    }

    return response.json()
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Get function metadata to verify type
 */
export async function getAgenticFunction(functionId: string): Promise<{
  id: string
  type: string
  version: string
  model?: string
  outputSchema?: object
  [key: string]: unknown
}> {
  const response = await fetch(
    `${E2E_CONFIG.baseUrl}/api/functions/${functionId}`,
    {
      headers: {
        ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
      },
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Get function failed (${response.status}): ${error}`)
  }

  return response.json()
}

// =============================================================================
// TEST TIMEOUTS
// =============================================================================

/** Extended timeout for agentic functions (they can take minutes) */
export const AGENTIC_TIMEOUT = 5 * 60 * 1000 // 5 minutes

/** Deploy timeout for agentic functions */
export const AGENTIC_DEPLOY_TIMEOUT = E2E_CONFIG.deployTimeout
