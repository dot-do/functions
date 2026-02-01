/**
 * @dotdo/functions - Abstract function types for 4 execution paradigms
 *
 * Functions are the unit of compute in the .do platform:
 *
 * 1. Code Functions - Deterministic code execution (5s)
 *    - Worker Loader, WASM, ai-evaluate
 *    - Fast, cheap, predictable
 *
 * 2. Generative Functions - Single AI call (30s)
 *    - Schema-guided structured output
 *    - Classification, extraction, generation
 *
 * 3. Agentic Functions - Multi-step AI with tools (5m)
 *    - Autonomous agents with tool use
 *    - Complex reasoning, research, multi-step tasks
 *
 * 4. Human Functions - Human-in-the-loop (24h)
 *    - Approvals, reviews, manual input
 *    - Escalation from AI, sensitive operations
 *
 * Functions integrate with @dotdo/workflows via cascade execution,
 * automatically escalating through tiers when needed.
 *
 * @example
 * ```typescript
 * import { cascade, defineCascade } from '@dotdo/functions'
 *
 * const fraudCheck = cascade('fraud-check', {
 *   code: async (input) => {
 *     // Fast rules check
 *     if (input.amount < 100) return { approved: true }
 *     throw new Error('Needs AI review')
 *   },
 *   generative: async (input, ctx) => {
 *     // AI analysis
 *     return await ai.analyze(input)
 *   },
 *   human: async (input, ctx) => {
 *     // Human review for edge cases
 *     return await requestApproval(input)
 *   }
 * })
 * ```
 */

// =============================================================================
// CORE TYPES
// =============================================================================

export * from './types.js'

// =============================================================================
// FUNCTION TYPES
// =============================================================================

// Code Functions
export {
  type CodeFunctionDefinition,
  type CodeFunctionConfig,
  type CodeFunctionResult,
  type CodeFunctionExecutor,
  type CodeLanguage,
  type CodeSource,
  type SandboxConfig,
  type CompiledCode,
  type CodeExecutionInfo,
  defineCodeFunction,
  inlineFunction,
} from './code/index.js'

// Generative Functions
export {
  type GenerativeFunctionDefinition,
  type GenerativeFunctionConfig,
  type GenerativeFunctionResult,
  type GenerativeFunctionExecutor,
  type GenerativeExecutionInfo,
  type GenerativeExample,
  type AIModel,
  defineGenerativeFunction,
  generativeFunction,
  prompt,
} from './generative/index.js'

// Agentic Functions
export {
  type AgenticFunctionDefinition,
  type AgenticFunctionConfig,
  type AgenticFunctionResult,
  type AgenticFunctionExecutor,
  type AgenticExecutionInfo,
  type ToolDefinition,
  type ToolCallRecord,
  type AgentIteration,
  type AgentState,
  type BuiltinTool,
  type ToolPermissions,
  type ApprovalConfig,
  type MemoryConfig,
  defineAgenticFunction,
  defineTool,
  builtinTool,
} from './agentic/index.js'

// Human Functions
export {
  type HumanFunctionDefinition,
  type HumanFunctionConfig,
  type HumanFunctionResult,
  type HumanFunctionExecutor,
  type HumanExecutionInfo,
  type HumanInteractionType,
  type HumanUI,
  type HumanTask,
  type FormField,
  type FormFieldType,
  type QuickAction,
  type UIContext,
  type AssigneeConfig,
  type ReminderConfig,
  type EscalationConfig,
  type SLAConfig,
  type ResponderInfo,
  defineHumanFunction,
  approvalFunction,
  inputFunction,
} from './human/index.js'

// =============================================================================
// CASCADE EXECUTION
// =============================================================================

export {
  type CascadeDefinition,
  type CascadeTiers,
  type CascadeOptions,
  type CascadeResult,
  type CascadeExecutor,
  type CascadeMetrics,
  type TierContext,
  type TierAttempt,
  type TierSkipCondition,
  type CodeTierHandler,
  type GenerativeTierHandler,
  type AgenticTierHandler,
  type HumanTierHandler,
  DEFAULT_TIER_TIMEOUTS,
  TIER_ORDER,
  defineCascade,
  cascade,
  CascadeExhaustedError,
  TierTimeoutError,
  TierSkippedError,
} from './cascade.js'

// =============================================================================
// CONVENIENCE: Re-export common types at top level
// =============================================================================

export type AnyFunctionDefinition =
  | import('./code/index.js').CodeFunctionDefinition
  | import('./generative/index.js').GenerativeFunctionDefinition
  | import('./agentic/index.js').AgenticFunctionDefinition
  | import('./human/index.js').HumanFunctionDefinition

export type AnyFunctionResult =
  | import('./code/index.js').CodeFunctionResult
  | import('./generative/index.js').GenerativeFunctionResult
  | import('./agentic/index.js').AgenticFunctionResult
  | import('./human/index.js').HumanFunctionResult
