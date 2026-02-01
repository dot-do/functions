/**
 * Branded/Nominal types for IDs
 *
 * These types provide compile-time safety to prevent accidentally
 * mixing different ID types (FunctionId, ExecutionId, WorkflowId).
 *
 * At runtime, branded types are just strings, but TypeScript's
 * structural typing is enhanced with a unique symbol brand to
 * make each type distinct.
 *
 * @example
 * ```typescript
 * import { functionId, executionId, type FunctionId, type ExecutionId } from '@dotdo/functions'
 *
 * const funcId = functionId('func-123')
 * const execId = executionId('exec-456')
 *
 * // Type error: ExecutionId is not assignable to FunctionId
 * const badAssignment: FunctionId = execId
 *
 * // Works correctly
 * const goodAssignment: FunctionId = funcId
 * ```
 */

// =============================================================================
// BRAND TYPE
// =============================================================================

/**
 * A unique symbol used as a brand key.
 * This symbol is never actually used at runtime - it only exists
 * in the type system to create distinct branded types.
 */
declare const __brand: unique symbol

/**
 * A branded type that adds a compile-time brand to a base type.
 * This creates nominal typing for otherwise structurally identical types.
 *
 * @template T - The underlying type (e.g., string)
 * @template B - The brand identifier (a unique string literal)
 */
type Brand<T, B> = T & { readonly [__brand]: B }

// =============================================================================
// BRANDED ID TYPES
// =============================================================================

/**
 * A branded string type representing a unique function identifier.
 * Cannot be confused with ExecutionId or WorkflowId at compile time.
 */
export type FunctionId = Brand<string, 'FunctionId'>

/**
 * A branded string type representing a unique execution identifier.
 * Cannot be confused with FunctionId or WorkflowId at compile time.
 */
export type ExecutionId = Brand<string, 'ExecutionId'>

/**
 * A branded string type representing a unique workflow identifier.
 * Cannot be confused with FunctionId or ExecutionId at compile time.
 */
export type WorkflowId = Brand<string, 'WorkflowId'>

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Creates a FunctionId from a plain string.
 *
 * @param id - The string identifier
 * @returns A branded FunctionId
 *
 * @example
 * ```typescript
 * const id = functionId('func-123')
 * ```
 */
export function functionId(id: string): FunctionId {
  return id as FunctionId
}

/**
 * Creates an ExecutionId from a plain string.
 *
 * @param id - The string identifier
 * @returns A branded ExecutionId
 *
 * @example
 * ```typescript
 * const id = executionId('exec-456')
 * ```
 */
export function executionId(id: string): ExecutionId {
  return id as ExecutionId
}

/**
 * Creates a WorkflowId from a plain string.
 *
 * @param id - The string identifier
 * @returns A branded WorkflowId
 *
 * @example
 * ```typescript
 * const id = workflowId('wf-789')
 * ```
 */
export function workflowId(id: string): WorkflowId {
  return id as WorkflowId
}
