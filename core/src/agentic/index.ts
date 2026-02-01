/**
 * Agentic Functions - Multi-step AI with tools
 *
 * Agentic functions are autonomous AI agents that can:
 * - Make multiple AI calls
 * - Use tools to interact with the world
 * - Make decisions based on intermediate results
 * - Loop until a goal is achieved
 *
 * Implementation: autonomous-agents primitive
 *
 * Typical timeout: 5 minutes
 * Typical use: Complex reasoning, research, multi-step tasks
 */

import type {
  FunctionDefinition,
  FunctionResult,
  FunctionExecutor,
  ExecutionContext,
  TokenUsage,
  JsonSchema,
} from '../types.js'
import type { AIModel } from '../generative/index.js'
import type { FunctionId } from '../branded-types.js'

// =============================================================================
// AGENTIC FUNCTION DEFINITION
// =============================================================================

export interface AgenticFunctionDefinition<
  TInput = unknown,
  TOutput = unknown,
  TConfig = AgenticFunctionConfig,
> extends FunctionDefinition<TInput, TOutput, TConfig> {
  type: 'agentic'

  /** AI model for reasoning */
  model?: AIModel

  /** Agent system prompt */
  systemPrompt: string

  /** Goal description (what the agent should achieve) */
  goal: string

  /** Available tools */
  tools: ToolDefinition[]

  /** Output schema for final result */
  outputSchema?: JsonSchema

  /** Maximum iterations (turns) */
  maxIterations?: number

  /** Maximum tool calls per iteration */
  maxToolCallsPerIteration?: number

  /** Enable chain-of-thought reasoning */
  enableReasoning?: boolean

  /** Enable memory/context accumulation */
  enableMemory?: boolean
}

// =============================================================================
// TOOL DEFINITION
// =============================================================================

export interface ToolDefinition {
  /** Tool name (used in tool calls) */
  name: string

  /** Human-readable description */
  description: string

  /** Input schema for the tool */
  inputSchema: JsonSchema

  /** Output schema (optional) */
  outputSchema?: JsonSchema

  /** Tool implementation reference */
  implementation:
    | { type: 'function'; functionId: FunctionId }   // Another function
    | { type: 'api'; endpoint: string }              // HTTP API call
    | { type: 'inline'; handler: string }            // Inline code
    | { type: 'builtin'; name: BuiltinTool }         // Built-in tool
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

// =============================================================================
// AGENTIC FUNCTION CONFIG
// =============================================================================

export interface AgenticFunctionConfig {
  /** Override model */
  model?: AIModel

  /** Override max iterations */
  maxIterations?: number

  /** Tool permissions */
  toolPermissions?: ToolPermissions

  /** Enable human approval for certain actions */
  requireApproval?: ApprovalConfig

  /** Memory persistence */
  memoryConfig?: MemoryConfig
}

export interface ToolPermissions {
  /** Allowed tools (whitelist) */
  allowed?: string[]

  /** Blocked tools (blacklist) */
  blocked?: string[]

  /** Per-tool rate limits */
  rateLimits?: Record<string, RateLimit>
}

export interface RateLimit {
  maxCalls: number
  windowSeconds: number
}

export interface ApprovalConfig {
  /** Tools that require human approval */
  tools?: string[]

  /** Actions that require approval */
  actions?: ApprovalAction[]

  /** Approval timeout */
  timeout?: string
}

export type ApprovalAction =
  | 'write_file'
  | 'delete_file'
  | 'send_email'
  | 'make_purchase'
  | 'modify_data'
  | 'external_api'

export interface MemoryConfig {
  /** Enable conversation memory */
  conversationMemory?: boolean

  /** Enable vector memory (RAG) */
  vectorMemory?: boolean

  /** Memory namespace */
  namespace?: string

  /** Max memory tokens */
  maxTokens?: number
}

// =============================================================================
// AGENTIC FUNCTION RESULT
// =============================================================================

export interface AgenticFunctionResult<TOutput = unknown>
  extends FunctionResult<TOutput> {
  /** Agentic-specific execution info */
  agenticExecution: AgenticExecutionInfo
}

export interface AgenticExecutionInfo {
  /** Model used */
  model: string

  /** Total token usage across all calls */
  totalTokens: TokenUsage

  /** Number of iterations */
  iterations: number

  /** Execution trace */
  trace: AgentIteration[]

  /** Tools that were used */
  toolsUsed: string[]

  /** Whether goal was achieved */
  goalAchieved: boolean

  /** Reasoning summary (if enabled) */
  reasoningSummary?: string
}

export interface AgentIteration {
  /** Iteration number */
  iteration: number

  /** Timestamp */
  timestamp: number

  /** Agent's reasoning (if chain-of-thought enabled) */
  reasoning?: string

  /** Tool calls made */
  toolCalls: ToolCallRecord[]

  /** Token usage for this iteration */
  tokens: TokenUsage

  /** Duration in ms */
  durationMs: number
}

export interface ToolCallRecord {
  /** Tool name */
  tool: string

  /** Input provided */
  input: unknown

  /** Output received */
  output: unknown

  /** Duration in ms */
  durationMs: number

  /** Whether call succeeded */
  success: boolean

  /** Error if failed */
  error?: string

  /** Whether approval was required/granted */
  approval?: {
    required: boolean
    granted?: boolean
    approvedBy?: string
  }
}

// =============================================================================
// AGENTIC FUNCTION EXECUTOR
// =============================================================================

export interface AgenticFunctionExecutor<
  TInput = unknown,
  TOutput = unknown,
> extends FunctionExecutor<TInput, TOutput, AgenticFunctionConfig> {
  /** Execute a single iteration */
  executeIteration(
    state: AgentState,
    context: ExecutionContext
  ): Promise<IterationResult>

  /** Execute a tool */
  executeTool(
    tool: ToolDefinition,
    input: unknown,
    context: ExecutionContext
  ): Promise<unknown>
}

export interface AgentState {
  /** Current iteration */
  iteration: number

  /** Accumulated context/memory */
  memory: unknown[]

  /** Previous tool results */
  toolResults: ToolCallRecord[]

  /** Whether goal is achieved */
  goalAchieved: boolean

  /** Final output (if goal achieved) */
  output?: unknown
}

export interface IterationResult {
  /** Updated state */
  state: AgentState

  /** Tool calls to execute */
  toolCalls: Array<{ tool: string; input: unknown }>

  /** Whether to continue */
  continue: boolean

  /** Reasoning for this iteration */
  reasoning?: string
}

// =============================================================================
// HELPER: Define an agentic function
// =============================================================================

export function defineAgenticFunction<TInput, TOutput>(
  options: Omit<AgenticFunctionDefinition<TInput, TOutput>, 'type'>
): AgenticFunctionDefinition<TInput, TOutput> {
  return {
    ...options,
    type: 'agentic',
    timeout: options.timeout ?? '5m',
    model: options.model ?? 'claude-3-sonnet',
    maxIterations: options.maxIterations ?? 10,
    maxToolCallsPerIteration: options.maxToolCallsPerIteration ?? 5,
    enableReasoning: options.enableReasoning ?? true,
  }
}

// =============================================================================
// HELPER: Define a tool
// =============================================================================

export function defineTool(
  name: string,
  description: string,
  inputSchema: JsonSchema,
  implementation: ToolDefinition['implementation']
): ToolDefinition {
  return {
    name,
    description,
    inputSchema,
    implementation,
  }
}

export function builtinTool(
  tool: BuiltinTool,
  description?: string
): ToolDefinition {
  const descriptions: Record<BuiltinTool, string> = {
    web_search: 'Search the web for information',
    web_fetch: 'Fetch content from a URL',
    file_read: 'Read a file from the filesystem',
    file_write: 'Write content to a file',
    shell_exec: 'Execute a shell command',
    database_query: 'Query a database',
    email_send: 'Send an email',
    slack_send: 'Send a Slack message',
  }

  return {
    name: tool,
    description: description ?? descriptions[tool],
    inputSchema: { type: 'object' }, // Simplified - real impl has full schemas
    implementation: { type: 'builtin', name: tool },
  }
}
