/**
 * @dotdo/functions - Abstract function types for 4 execution paradigms
 *
 * Functions are the unit of compute in the .do platform. They have:
 * - Input: Typed input data
 * - Output: Typed output data
 * - Config: Function-specific configuration
 * - Result: Execution result with metadata
 *
 * Four function types, representing increasing capability tiers:
 * 1. CodeFunctions - Deterministic code execution (Worker Loader, WASM)
 * 2. GenerativeFunctions - Single AI call (structured output)
 * 3. AgenticFunctions - Multi-step AI with tools (autonomous agents)
 * 4. HumanFunctions - Human-in-the-loop (approval, review, input)
 */

import { assertNever } from './utils.js'

// =============================================================================
// FUNCTION TYPE DISCRIMINATOR
// =============================================================================

export type FunctionType = 'code' | 'generative' | 'agentic' | 'human'

// =============================================================================
// BASE FUNCTION DEFINITION
// =============================================================================

export interface FunctionDefinition<
  TInput = unknown,
  TOutput = unknown,
  TConfig = unknown,
> {
  /** Unique function identifier */
  id: string

  /** Human-readable name */
  name: string

  /** Semantic version */
  version: string

  /** Description of what this function does */
  description?: string

  /** Function type discriminator */
  type: FunctionType

  /** JSON Schema for input validation */
  inputSchema?: JsonSchema

  /** JSON Schema for output validation */
  outputSchema?: JsonSchema

  /** Default configuration */
  defaultConfig?: TConfig

  /** Execution timeout */
  timeout?: Duration

  /** Retry policy */
  retryPolicy?: RetryPolicy

  /** Tags for organization */
  tags?: string[]
}

// =============================================================================
// FUNCTION RESULT
// =============================================================================

export type FunctionResultStatus = 'completed' | 'failed' | 'timeout' | 'cancelled'

export interface FunctionResult<TOutput = unknown> {
  /** Unique execution ID */
  executionId: string

  /** Function ID that was executed */
  functionId: string

  /** Function version */
  functionVersion: string

  /** Execution status */
  status: FunctionResultStatus

  /** Output data (if completed) */
  output?: TOutput

  /** Error (if failed) */
  error?: FunctionError

  /** Execution metrics */
  metrics: ExecutionMetrics

  /** Execution metadata */
  metadata: ExecutionMetadata
}

export interface FunctionError {
  name: string
  message: string
  code?: string
  stack?: string
  retryable?: boolean
}

export interface ExecutionMetrics {
  /** Total execution time in milliseconds */
  durationMs: number

  /** Input size in bytes */
  inputSizeBytes: number

  /** Output size in bytes */
  outputSizeBytes: number

  /** Number of retry attempts */
  retryCount: number

  /** Billable compute units (function type specific) */
  computeUnits?: number

  /** Token usage (for AI functions) */
  tokens?: TokenUsage
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface ExecutionMetadata {
  /** When execution started */
  startedAt: number

  /** When execution completed */
  completedAt?: number

  /** Region where execution ran */
  region?: string

  /** Trace ID for distributed tracing */
  traceId?: string

  /** Span ID for this execution */
  spanId?: string

  /** User/service that triggered execution */
  triggeredBy?: string

  /** Workflow context (if executed from workflow) */
  workflowContext?: WorkflowContext
}

export interface WorkflowContext {
  workflowId: string
  runId: string
  stepId: string
}

// =============================================================================
// RETRY POLICY
// =============================================================================

export interface RetryPolicy {
  maxAttempts?: number           // Default: 3
  initialDelay?: Duration        // Default: 1s
  maxDelay?: Duration            // Default: 60s
  backoffCoefficient?: number    // Default: 2.0
  nonRetryableErrors?: string[]  // Error types to not retry
}

// =============================================================================
// DURATION
// =============================================================================

export type Duration =
  | number                       // milliseconds
  | `${number}ms`
  | `${number}s` | `${number} second` | `${number} seconds`
  | `${number}m` | `${number} minute` | `${number} minutes`
  | `${number}h` | `${number} hour` | `${number} hours`
  | `${number}d` | `${number} day` | `${number} days`

export function parseDuration(duration: Duration): number {
  if (typeof duration === 'number') return duration

  const match = duration.match(/^(\d+)\s*(ms|s|seconds?|m|minutes?|h|hours?|d|days?)$/)
  if (!match) throw new Error(`Invalid duration: ${duration}`)

  const value = parseInt(match[1] ?? '', 10)
  const unit = match[2] ?? ''

  switch (unit) {
    case 'ms': return value
    case 's': case 'second': case 'seconds': return value * 1000
    case 'm': case 'minute': case 'minutes': return value * 60 * 1000
    case 'h': case 'hour': case 'hours': return value * 60 * 60 * 1000
    case 'd': case 'day': case 'days': return value * 24 * 60 * 60 * 1000
    default: return assertNever(unit as never, `Unknown duration unit: ${unit}`)
  }
}

// =============================================================================
// JSON SCHEMA (simplified)
// =============================================================================

export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  required?: string[]
  enum?: unknown[]
  description?: string
  default?: unknown
  [key: string]: unknown
}

// =============================================================================
// FUNCTION EXECUTOR INTERFACE
// =============================================================================

export interface FunctionExecutor<
  TInput = unknown,
  TOutput = unknown,
  TConfig = unknown,
> {
  /** Execute the function */
  execute(
    input: TInput,
    config?: TConfig,
    context?: ExecutionContext
  ): Promise<FunctionResult<TOutput>>

  /** Validate input against schema */
  validateInput?(input: unknown): ValidationResult

  /** Validate output against schema */
  validateOutput?(output: unknown): ValidationResult
}

export interface ExecutionContext {
  /** Execution ID (generated if not provided) */
  executionId?: string

  /** Trace ID for distributed tracing */
  traceId?: string

  /** Parent span ID */
  parentSpanId?: string

  /** Timeout override */
  timeout?: Duration

  /** Signal for cancellation */
  signal?: AbortSignal

  /** Environment bindings */
  env?: Record<string, unknown>
}

export interface ValidationResult {
  valid: boolean
  errors?: ValidationError[]
}

export interface ValidationError {
  path: string
  message: string
  code?: string
}

// =============================================================================
// FUNCTION REGISTRY
// =============================================================================

export interface FunctionRegistry {
  /** Register a function */
  register<TInput, TOutput, TConfig>(
    definition: FunctionDefinition<TInput, TOutput, TConfig>,
    executor: FunctionExecutor<TInput, TOutput, TConfig>
  ): void

  /** Get a function by ID */
  get(functionId: string): RegisteredFunction | undefined

  /** Get a function by ID and version */
  getVersion(functionId: string, version: string): RegisteredFunction | undefined

  /** List all registered functions */
  list(filter?: FunctionFilter): RegisteredFunction[]

  /** Unregister a function */
  unregister(functionId: string): boolean
}

export interface RegisteredFunction<
  TInput = unknown,
  TOutput = unknown,
  TConfig = unknown,
> {
  definition: FunctionDefinition<TInput, TOutput, TConfig>
  executor: FunctionExecutor<TInput, TOutput, TConfig>
}

export interface FunctionFilter {
  type?: FunctionType
  tags?: string[]
  namePattern?: string
}

// =============================================================================
// FUNCTION INVOCATION
// =============================================================================

export interface FunctionInvocation<TInput = unknown, TConfig = unknown> {
  /** Function ID to invoke */
  functionId: string

  /** Function version (default: latest) */
  version?: string

  /** Input data */
  input: TInput

  /** Configuration override */
  config?: TConfig

  /** Execution context */
  context?: ExecutionContext

  /** Idempotency key for deduplication */
  idempotencyKey?: string
}
