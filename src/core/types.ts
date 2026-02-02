/**
 * Core types for Functions.do Worker Loader
 *
 * These types define the interface for dynamically loaded function workers.
 */

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
 * Function permission configuration for access control.
 * Used with oauth.do integration for fine-grained permissions.
 */
export interface FunctionPermissions {
  /** Whether the function is public (no auth required) */
  public?: boolean
  /** Required scopes to invoke the function */
  requiredScopes?: string[]
  /** Allowed user IDs (if not public) */
  allowedUsers?: string[]
  /** Allowed organization IDs (if not public) */
  allowedOrgs?: string[]
  /** Allowed roles within organizations */
  allowedRoles?: ('owner' | 'admin' | 'member' | 'viewer')[]
  /** Rate limit overrides per user/org */
  rateLimits?: {
    perUser?: number
    perOrg?: number
  }
}

// =============================================================================
// FUNCTION METADATA: Discriminated Union on `type`
//
// FunctionMetadata is a discriminated union where the `type` field determines
// which variant (and thus which fields) are available. Each variant extends
// FunctionMetadataBase with type-specific fields.
//
// Supports five function tiers:
// - code: Deterministic code execution (default)
// - generative: Single AI call with structured output
// - agentic: Multi-step AI with tools
// - human: Human-in-the-loop execution
// - cascade: Combined generative + code pipeline
// =============================================================================

/**
 * Common fields shared by all function metadata variants.
 *
 * Every FunctionMetadata variant has these fields. The `type` field is the
 * discriminant that determines which variant-specific fields are available.
 */
export interface FunctionMetadataBase {
  /** Unique function identifier */
  id: string

  /** Semantic version of the function */
  version: string

  /** Function type discriminator */
  type: 'code' | 'generative' | 'agentic' | 'human' | 'cascade'

  /** Human-readable name for the function */
  name?: string

  /** Description of the function */
  description?: string

  /** Tags for categorization */
  tags?: string[]

  /** Input schema for the function */
  inputSchema?: Record<string, unknown>

  /** Timestamp when the function was first deployed */
  createdAt?: string

  /** Timestamp when the function was last updated */
  updatedAt?: string

  /** Owner user ID (from OAuth) */
  ownerId?: string

  /** Owning organization ID (from OAuth) */
  orgId?: string

  /** Access control permissions for the function */
  permissions?: FunctionPermissions
}

// =============================================================================
// CODE VARIANT (type === 'code')
// =============================================================================

/**
 * Metadata for code (Tier 1) functions.
 *
 * Code functions execute deterministic compiled code (TypeScript, JavaScript,
 * Rust, Go, etc.) with language, entryPoint, and dependencies.
 */
export interface CodeFunctionMetadata extends FunctionMetadataBase {
  type: 'code'

  /** Programming language of the function source */
  language?: 'typescript' | 'javascript' | 'rust' | 'python' | 'go' | 'zig' | 'assemblyscript' | 'csharp'

  /** Entry point file for the function */
  entryPoint?: string

  /** Dependencies required by the function */
  dependencies?: Record<string, string>
}

// =============================================================================
// GENERATIVE VARIANT (type === 'generative')
// =============================================================================

/**
 * Metadata for generative (Tier 2) functions.
 *
 * Generative functions make a single AI call with structured output,
 * using model, prompts, schema, and generation parameters.
 */
export interface GenerativeFunctionMetadata extends FunctionMetadataBase {
  type: 'generative'

  /** AI model to use */
  model?: string

  /** System prompt template */
  systemPrompt?: string

  /** User prompt template with {{variable}} placeholders */
  userPrompt?: string

  /** Output schema for structured generation */
  outputSchema?: Record<string, unknown>

  /** Temperature 0-2 */
  temperature?: number

  /** Max output tokens */
  maxTokens?: number

  /** Few-shot examples */
  examples?: Array<{ input: Record<string, unknown>; output: unknown; explanation?: string }>
}

// =============================================================================
// AGENTIC VARIANT (type === 'agentic')
// =============================================================================

/**
 * Metadata for agentic (Tier 3) functions.
 *
 * Agentic functions use multi-step AI reasoning with tools, goals,
 * iteration limits, and token budgets.
 */
export interface AgenticFunctionMetadata extends FunctionMetadataBase {
  type: 'agentic'

  /** AI model to use */
  model?: string

  /** System prompt template */
  systemPrompt?: string

  /** Goal description - what the agent should achieve */
  goal?: string

  /** Output schema for structured output */
  outputSchema?: Record<string, unknown>

  /** Available tools */
  tools?: Array<{
    name: string
    description: string
    inputSchema?: Record<string, unknown>
    outputSchema?: Record<string, unknown>
  }>

  /** Maximum iterations/turns */
  maxIterations?: number

  /** Maximum tool calls per iteration */
  maxToolCallsPerIteration?: number

  /** Enable chain-of-thought reasoning */
  enableReasoning?: boolean

  /** Enable memory/context accumulation */
  enableMemory?: boolean

  /** Token budget for the entire agentic execution */
  tokenBudget?: number
}

// =============================================================================
// HUMAN VARIANT (type === 'human')
// =============================================================================

/**
 * Metadata for human (Tier 4) functions.
 *
 * Human functions require human-in-the-loop interaction, with
 * interaction type, UI config, assignees, SLAs, and escalation.
 */
export interface HumanFunctionMetadata extends FunctionMetadataBase {
  type: 'human'

  /** Type of human interaction */
  interactionType?: 'approval' | 'review' | 'input' | 'selection' | 'annotation' | 'verification' | 'custom'

  /** UI configuration for the human task */
  uiConfig?: Record<string, unknown>

  /** Who can respond to the task */
  assignees?: Array<{ type: string; value: string }>

  /** SLA configuration */
  sla?: {
    responseTime?: string
    resolutionTime?: string
    onBreach?: string
  }

  /** Reminder configuration */
  reminders?: Record<string, unknown>

  /** Escalation configuration */
  escalation?: Record<string, unknown>
}

// =============================================================================
// CASCADE VARIANT (type === 'cascade')
// =============================================================================

/**
 * Metadata for cascade functions.
 *
 * Cascade functions combine generative and code capabilities in a pipeline,
 * inheriting fields from both generative and code variants.
 */
export interface CascadeFunctionMetadata extends FunctionMetadataBase {
  type: 'cascade'

  // Generative-like fields
  /** AI model to use */
  model?: string

  /** System prompt template */
  systemPrompt?: string

  /** User prompt template with {{variable}} placeholders */
  userPrompt?: string

  /** Output schema for structured generation */
  outputSchema?: Record<string, unknown>

  /** Temperature 0-2 */
  temperature?: number

  /** Max output tokens */
  maxTokens?: number

  // Code-like fields
  /** Programming language of the function source */
  language?: 'typescript' | 'javascript' | 'rust' | 'python' | 'go' | 'zig' | 'assemblyscript' | 'csharp'

  /** Entry point file for the function */
  entryPoint?: string

  /** Dependencies required by the function */
  dependencies?: Record<string, string>
}

// =============================================================================
// DISCRIMINATED UNION
// =============================================================================

/**
 * Function metadata stored in the registry.
 *
 * This is a discriminated union on the `type` field. Use type narrowing
 * (switch/if on `type`) to access variant-specific fields:
 *
 * ```typescript
 * if (metadata.type === 'code') {
 *   // metadata.language, metadata.entryPoint available
 * } else if (metadata.type === 'generative') {
 *   // metadata.model, metadata.userPrompt available
 * }
 * ```
 */
export type FunctionMetadata =
  | CodeFunctionMetadata
  | GenerativeFunctionMetadata
  | AgenticFunctionMetadata
  | HumanFunctionMetadata
  | CascadeFunctionMetadata

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
    major: parseInt(match[1] ?? '0', 10),
    minor: parseInt(match[2] ?? '0', 10),
    patch: parseInt(match[3] ?? '0', 10),
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
