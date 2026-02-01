/**
 * Utility functions for exhaustive type checking and other helpers
 */

/**
 * Helper function for exhaustive switch statements
 *
 * This function ensures that all cases in a switch statement are handled.
 * TypeScript will raise a compile error if a case is missing because
 * the unhandled value cannot be assigned to the `never` type.
 *
 * @param x - A value that should never be reached
 * @param message - Optional custom error message
 * @returns Never - This function always throws
 * @throws Error with information about the unexpected value
 *
 * @example
 * ```typescript
 * type Status = 'active' | 'inactive'
 * const status: Status = 'active'
 *
 * switch (status) {
 *   case 'active':
 *     return 'Active'
 *   case 'inactive':
 *     return 'Inactive'
 *   default:
 *     return assertNever(status) // TypeScript error if a case is missing
 * }
 * ```
 */
export function assertNever(x: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${x}`)
}
