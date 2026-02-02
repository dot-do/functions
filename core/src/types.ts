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
 *
 * TYPE UNIFICATION:
 * Simple types (enums, basic interfaces) are defined in schemas.ts using Zod
 * and re-exported here. Types requiring branded types, generics, or runtime
 * features like AbortSignal are defined here with compatibility assertions.
 */

import { assertNever } from './utils.js'
import type { FunctionId, ExecutionId, WorkflowId } from './branded-types.js'

// =============================================================================
// TYPES FROM SCHEMAS (Single Source of Truth)
// =============================================================================

// Re-export types that are derived from Zod schemas
export {
  // Enum types - use the Zod-derived versions
  type FunctionType,
  type FunctionResultStatus,
  type CodeLanguage,
  // Simple interface types - use the Zod-derived versions
  type JsonSchema,
  type TokenUsage,
  type ExecutionMetrics,
  type ExecutionMetadata,
  type FunctionError,
  type FunctionFilter,
  type ValidationResult,
  type ValidationError,
  // Schema-based types (for runtime validation context)
  type FunctionDefinitionFromSchema,
  type FunctionResultFromSchema,
  type FunctionInvocationFromSchema,
  type WorkflowContextFromSchema,
  type ExecutionContextFromSchema,
  type DurationFromSchema,
  type RetryPolicy as RetryPolicyFromSchema,
} from './schemas.js'

// Import for internal use in type assertions
import type { DurationFromSchema, WorkflowContextFromSchema } from './schemas.js'

// Re-export branded types for convenience
export type { FunctionId, ExecutionId, WorkflowId } from './branded-types.js'

// =============================================================================
// BASE FUNCTION DEFINITION (with branded types and generics)
// =============================================================================

import type {
  FunctionType,
  JsonSchema,
  FunctionError,
  TokenUsage,
  FunctionDefinitionFromSchema,
  FunctionResultFromSchema,
  ValidationResult,
  ValidationError,
  FunctionFilter,
  ExecutionMetrics as ExecutionMetricsFromSchema,
  ExecutionMetadata as ExecutionMetadataFromSchema,
} from './schemas.js'

/**
 * Function definition with branded FunctionId and generic type parameters.
 * For runtime validation, use FunctionDefinitionFromSchema or the Zod schema.
 */
export interface FunctionDefinition<
  TInput = unknown,
  TOutput = unknown,
  TConfig = unknown,
> {
  /** Unique function identifier (branded type) */
  id: FunctionId

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

// Type assertion: FunctionDefinition (without generics/branded) is compatible with schema
type _AssertFunctionDefinitionCompatible = FunctionDefinition extends { id: string; name: string; version: string; type: FunctionType }
  ? true
  : never

// =============================================================================
// FUNCTION RESULT (with branded types and generics)
// =============================================================================

// FunctionResultStatus is re-exported from schemas.ts above

/**
 * Function result with branded IDs and generic output type.
 * For runtime validation, use FunctionResultFromSchema or the Zod schema.
 */
export interface FunctionResult<TOutput = unknown> {
  /** Unique execution ID (branded type) */
  executionId: ExecutionId

  /** Function ID that was executed (branded type) */
  functionId: FunctionId

  /** Function version */
  functionVersion: string

  /** Execution status */
  status: import('./schemas.js').FunctionResultStatus

  /** Output data (if completed) */
  output?: TOutput

  /** Error (if failed) */
  error?: FunctionError

  /** Execution metrics */
  metrics: ExecutionMetricsFromSchema

  /** Execution metadata */
  metadata: ExecutionMetadataFromSchema
}

// FunctionError, TokenUsage, ExecutionMetrics, ExecutionMetadata are re-exported from schemas.ts

/**
 * Workflow context with branded IDs.
 * For runtime validation, use WorkflowContextFromSchema or the Zod schema.
 */
export interface WorkflowContext {
  workflowId: WorkflowId
  runId: ExecutionId
  stepId: string
}

// =============================================================================
// RETRY POLICY (with Duration template literal type)
// =============================================================================

/**
 * Retry policy with Duration type (template literal).
 * For runtime validation, use RetryPolicyFromSchema or the Zod schema.
 */
export interface RetryPolicy {
  maxAttempts?: number           // Default: 3
  initialDelay?: Duration        // Default: 1s
  maxDelay?: Duration            // Default: 60s
  backoffCoefficient?: number    // Default: 2.0
  nonRetryableErrors?: string[]  // Error types to not retry
}

// =============================================================================
// DURATION (Template literal type - stricter than Zod schema)
// =============================================================================

/**
 * Duration type with template literal for compile-time checking.
 * This is stricter than DurationFromSchema which uses regex validation.
 * For runtime validation, use DurationSchema from schemas.ts.
 */
export type Duration =
  | number                       // milliseconds
  | `${number}ms`
  | `${number}s` | `${number} second` | `${number} seconds`
  | `${number}m` | `${number} minute` | `${number} minutes`
  | `${number}h` | `${number} hour` | `${number} hours`
  | `${number}d` | `${number} day` | `${number} days`

/**
 * Parses a Duration value to milliseconds.
 */
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

// Type assertion: Duration is assignable to DurationFromSchema (imported at top)
type _AssertDurationCompatible = Duration extends DurationFromSchema ? true : never

// JsonSchema is re-exported from schemas.ts (single source of truth)

// =============================================================================
// FUNCTION EXECUTOR INTERFACE
// =============================================================================

/**
 * Function executor interface with generic types.
 */
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

/**
 * Execution context with branded ExecutionId and AbortSignal.
 * For runtime validation (serializable parts), use ExecutionContextFromSchema.
 */
export interface ExecutionContext {
  /** Execution ID (generated if not provided, branded type) */
  executionId?: ExecutionId

  /** Trace ID for distributed tracing */
  traceId?: string

  /** Parent span ID */
  parentSpanId?: string

  /** Timeout override */
  timeout?: Duration

  /** Signal for cancellation (not serializable, not in schema) */
  signal?: AbortSignal

  /** Environment bindings */
  env?: Record<string, unknown>
}

// ValidationResult and ValidationError are re-exported from schemas.ts

// =============================================================================
// FUNCTION REGISTRY
// =============================================================================

/**
 * Function registry interface with branded FunctionId.
 */
export interface FunctionRegistry {
  /** Register a function */
  register<TInput, TOutput, TConfig>(
    definition: FunctionDefinition<TInput, TOutput, TConfig>,
    executor: FunctionExecutor<TInput, TOutput, TConfig>
  ): void

  /** Get a function by ID */
  get(functionId: FunctionId): RegisteredFunction | undefined

  /** Get a function by ID and version */
  getVersion(functionId: FunctionId, version: string): RegisteredFunction | undefined

  /** List all registered functions */
  list(filter?: FunctionFilter): RegisteredFunction[]

  /** Unregister a function */
  unregister(functionId: FunctionId): boolean
}

/**
 * Registered function with definition and executor.
 */
export interface RegisteredFunction<
  TInput = unknown,
  TOutput = unknown,
  TConfig = unknown,
> {
  definition: FunctionDefinition<TInput, TOutput, TConfig>
  executor: FunctionExecutor<TInput, TOutput, TConfig>
}

// FunctionFilter is re-exported from schemas.ts

// =============================================================================
// FUNCTION INVOCATION (with branded types and generics)
// =============================================================================

/**
 * Function invocation with branded FunctionId and generic types.
 * For runtime validation, use FunctionInvocationFromSchema or the Zod schema.
 */
export interface FunctionInvocation<TInput = unknown, TConfig = unknown> {
  /** Function ID to invoke (branded type) */
  functionId: FunctionId

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

// =============================================================================
// TYPE COMPATIBILITY ASSERTIONS
// =============================================================================

// These assertions ensure that our branded/generic types are compatible
// with the schema-derived types at compile time.

// FunctionResult (without generics) should be assignable to FunctionResultFromSchema fields
type _AssertFunctionResultCompatible =
  FunctionResult extends { executionId: string; functionId: string; status: string }
    ? true
    : never

// FunctionInvocation (without generics) should be assignable to FunctionInvocationFromSchema
type _AssertFunctionInvocationCompatible =
  FunctionInvocation extends { functionId: string; input: unknown }
    ? true
    : never

// WorkflowContext should be assignable to WorkflowContextFromSchema fields (imported at top)
type _AssertWorkflowContextCompatible =
  WorkflowContext extends { workflowId: string; runId: string; stepId: string }
    ? true
    : never

// =============================================================================
// WORKER LOADER TYPES (Consolidated from src/core/types.ts)
// =============================================================================

/**
 * WorkerStub represents a loaded function that can be invoked.
 *
 * It provides methods similar to Cloudflare Workers' Fetcher interface,
 * allowing the function to be called via various trigger mechanisms.
 */
export interface WorkerStub {
  /**
   * The unique identifier of the loaded function
   */
  id: string

  /**
   * Handle an HTTP request to the function
   *
   * @param request - The incoming HTTP request
   * @returns A Promise resolving to the function's response
   */
  fetch(request: Request): Promise<Response>

  /**
   * Establish a WebSocket or Durable Object-style connection
   *
   * @param request - The WebSocket upgrade request
   * @returns A Promise resolving to the upgrade response
   */
  connect(request: Request): Promise<Response>

  /**
   * Handle a scheduled/cron trigger
   *
   * @param controller - The scheduled event controller
   * @returns A Promise that resolves when the scheduled handler completes
   */
  scheduled(controller: ScheduledController): Promise<void>

  /**
   * Handle queue messages
   *
   * @param batch - The batch of queue messages to process
   * @returns A Promise that resolves when the queue handler completes
   */
  queue(batch: MessageBatch<unknown>): Promise<void>
}

/**
 * Cache statistics for the Worker Loader
 */
export interface CacheStats {
  /**
   * Number of unique functions currently cached
   */
  size: number

  /**
   * Number of cache hits (requests served from cache)
   */
  hits: number

  /**
   * Number of cache misses (requests that required loading)
   */
  misses: number
}

/**
 * Configuration options for the Worker Loader
 */
export interface WorkerLoaderOptions {
  /**
   * Timeout in milliseconds for loading a function
   * @default 30000
   */
  timeout?: number

  /**
   * Maximum number of functions to cache
   * @default 1000
   */
  maxCacheSize?: number
}

/**
 * Function metadata stored in the registry.
 *
 * Supports all four function tiers:
 * - code: Deterministic code execution (default)
 * - generative: Single AI call with structured output
 * - agentic: Multi-step AI with tools
 * - human: Human-in-the-loop execution
 */
export interface FunctionMetadata {
  /**
   * Unique function identifier
   */
  id: string

  /**
   * Semantic version of the function
   */
  version: string

  /**
   * Function type discriminator.
   * Defaults to 'code' for backward compatibility.
   */
  type?: 'code' | 'generative' | 'agentic' | 'human'

  /**
   * Human-readable name for the function
   */
  name?: string

  /**
   * Description of the function
   */
  description?: string

  /**
   * Tags for categorization
   */
  tags?: string[]

  /**
   * Programming language of the function source.
   * Required for code functions; absent for non-code functions.
   */
  language?: 'typescript' | 'javascript' | 'rust' | 'python' | 'go' | 'zig' | 'assemblyscript' | 'csharp'

  /**
   * Entry point file for the function.
   * Required for code functions; absent for non-code functions.
   */
  entryPoint?: string

  /**
   * Dependencies required by the function.
   * Used by code functions; absent for non-code functions.
   */
  dependencies?: Record<string, string>
}

/**
 * Parsed semantic version components
 */
export interface SemanticVersion {
  major: number
  minor: number
  patch: number
  prerelease?: string
  build?: string
}

/**
 * Deployment record for version history tracking
 */
export interface DeploymentRecord {
  /**
   * The version that was deployed
   */
  version: string

  /**
   * Timestamp when this deployment occurred
   */
  deployedAt: string

  /**
   * The full metadata snapshot at deployment time
   */
  metadata: FunctionMetadata
}

/**
 * Version history for a function
 */
export interface VersionHistory {
  /**
   * Function identifier
   */
  functionId: string

  /**
   * List of all versions ever deployed (sorted newest first)
   */
  versions: string[]

  /**
   * Full deployment records with timestamps and metadata
   */
  deployments: DeploymentRecord[]
}

// =============================================================================
// SEMANTIC VERSION UTILITIES
// =============================================================================

/**
 * Parse a semantic version string into components.
 * Strictly validates semantic versioning (no leading zeros, no 'v' prefix).
 *
 * @param version - The version string (e.g., "1.2.3", "1.0.0-beta.1+build.123")
 * @returns Parsed semantic version or null if invalid
 */
export function parseVersion(version: string): SemanticVersion | null {
  // Reject versions that start with 'v' prefix
  if (version.startsWith('v') || version.startsWith('V')) {
    return null
  }

  // Semantic version regex: major.minor.patch[-prerelease][+build]
  // Uses non-capturing groups for zero prevention: no leading zeros except for 0 itself
  const regex = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$/
  const match = version.match(regex)

  if (!match) {
    return null
  }

  // Validate prerelease - must not be empty (trailing dash like "1.0.0-" is invalid)
  if (match[4] !== undefined && match[4] === '') {
    return null
  }

  const result: SemanticVersion = {
    major: parseInt(match[1]!, 10),
    minor: parseInt(match[2]!, 10),
    patch: parseInt(match[3]!, 10),
  }
  if (match[4] !== undefined) {
    result.prerelease = match[4]
  }
  if (match[5] !== undefined) {
    result.build = match[5]
  }
  return result
}

/**
 * Compare two semantic versions.
 *
 * @param a - First version string
 * @param b - Second version string
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 * @throws Error if either version is invalid
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parsedA = parseVersion(a)
  const parsedB = parseVersion(b)

  if (!parsedA || !parsedB) {
    throw new Error(`Invalid semantic version: ${!parsedA ? a : b}`)
  }

  // Compare major.minor.patch
  if (parsedA.major !== parsedB.major) {
    return parsedA.major > parsedB.major ? 1 : -1
  }
  if (parsedA.minor !== parsedB.minor) {
    return parsedA.minor > parsedB.minor ? 1 : -1
  }
  if (parsedA.patch !== parsedB.patch) {
    return parsedA.patch > parsedB.patch ? 1 : -1
  }

  // Handle prerelease: version without prerelease > version with prerelease
  if (parsedA.prerelease && !parsedB.prerelease) return -1
  if (!parsedA.prerelease && parsedB.prerelease) return 1

  // Compare prerelease identifiers
  if (parsedA.prerelease && parsedB.prerelease) {
    const partsA = parsedA.prerelease.split('.')
    const partsB = parsedB.prerelease.split('.')
    const maxLen = Math.max(partsA.length, partsB.length)

    for (let i = 0; i < maxLen; i++) {
      const partA = partsA[i]
      const partB = partsB[i]

      // Missing parts come before existing parts
      if (partA === undefined) return -1
      if (partB === undefined) return 1

      // Numeric identifiers compared as integers
      const numA = parseInt(partA, 10)
      const numB = parseInt(partB, 10)
      const isNumA = !isNaN(numA) && String(numA) === partA
      const isNumB = !isNaN(numB) && String(numB) === partB

      if (isNumA && isNumB) {
        if (numA !== numB) return numA > numB ? 1 : -1
      } else if (isNumA) {
        // Numeric < alphanumeric
        return -1
      } else if (isNumB) {
        return 1
      } else {
        // Alphanumeric comparison
        const cmp = partA.localeCompare(partB)
        if (cmp !== 0) return cmp > 0 ? 1 : -1
      }
    }
  }

  return 0
}

/**
 * Check if a version string is a valid semantic version.
 *
 * @param version - The version string to validate
 * @returns True if valid semantic version, false otherwise
 */
export function isValidVersion(version: string): boolean {
  return parseVersion(version) !== null
}
