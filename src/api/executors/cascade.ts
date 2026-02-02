/**
 * Cascade Executor for Functions.do
 *
 * Re-exports the CascadeExecutor from the core implementation.
 * This module provides backward compatibility for consumers importing from api/executors.
 *
 * The real implementation is in src/core/cascade-executor.ts which provides:
 * - Tiered execution with automatic escalation (code -> generative -> agentic -> human)
 * - Configurable timeouts per tier
 * - Parallel execution mode
 * - AbortSignal support
 * - Retry policies
 *
 * @module api/executors/cascade
 */

// Re-export the real CascadeExecutor class and factory function
export { CascadeExecutor, createCascadeExecutor } from '../../core/cascade-executor'

// Re-export types from the core cascade module for convenience
export type {
  CascadeDefinition,
  CascadeTiers,
  CascadeOptions,
  CascadeResult,
  CascadeMetrics,
  TierContext,
  TierAttempt,
  TierSkipCondition,
} from '@dotdo/functions'

// Legacy type aliases for backward compatibility
// Note: These map to the real cascade types, not the old stub types

import type { CascadeResult } from '@dotdo/functions'

/**
 * @deprecated Use CascadeResult from core/src/cascade instead
 * This is a backward-compatible alias
 */
export type CascadeExecutionResult = CascadeResult

// Legacy interface for step-based cascades (deprecated)
// The new cascade system uses tier-based execution, not step-based

/**
 * @deprecated The new cascade system uses tier-based execution.
 * Consider migrating to CascadeTiers instead.
 */
export interface CascadeStep {
  function: string
  transform?: string
  condition?: string
}

/**
 * @deprecated Use CascadeDefinition from core/src/cascade instead.
 * This interface is maintained for backward compatibility.
 */
export interface CascadeFunctionMetadata {
  type: 'cascade'
  steps: CascadeStep[]
  errorHandling?: 'fail-fast' | 'continue' | 'retry'
}
