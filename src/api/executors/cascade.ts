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

// Legacy type aliases removed (CascadeExecutionResult, CascadeStep, CascadeFunctionMetadata).
// Use CascadeResult, CascadeDefinition, and CascadeTiers from @dotdo/functions instead.
