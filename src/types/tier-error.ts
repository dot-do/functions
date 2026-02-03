/**
 * TierError - Unified error class for consistent error handling across all tiers
 *
 * This provides a standardized error structure that all tier executors can use,
 * ensuring consistent error reporting, retryability information, and cause chaining.
 *
 * @module types/tier-error
 */

/**
 * Valid tier identifiers
 */
export type TierName = 'code' | 'generative' | 'agentic' | 'human' | 'cascade'

/**
 * Error codes used across tiers
 */
export type TierErrorCode =
  | 'TIMEOUT'
  | 'EXECUTION_FAILED'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'NOT_CONFIGURED'
  | 'RATE_LIMITED'
  | 'BUDGET_EXCEEDED'
  | 'CANCELLED'
  | 'NETWORK_ERROR'
  | 'INTERNAL_ERROR'

/**
 * TierError provides consistent error handling across all tier executors.
 *
 * Each tier (code, generative, agentic, human) can throw TierError instances
 * that carry structured information about:
 * - Which tier the error originated from
 * - A machine-readable error code
 * - Whether the operation can be retried
 * - The original cause (for error chaining)
 *
 * @example
 * ```typescript
 * // In code-executor.ts
 * throw new TierError('code', 'TIMEOUT', false, 'Execution exceeded 5s limit')
 *
 * // In generative-executor.ts
 * try {
 *   await aiClient.messages.create(...)
 * } catch (err) {
 *   throw new TierError('generative', 'RATE_LIMITED', true, 'API rate limit exceeded', err)
 * }
 *
 * // In agentic-executor.ts
 * throw new TierError('agentic', 'BUDGET_EXCEEDED', false, 'Token budget exhausted')
 *
 * // In human-executor.ts
 * throw new TierError('human', 'TIMEOUT', false, 'Task expired without response')
 * ```
 */
export class TierError extends Error {
  /**
   * The name of this error class, always 'TierError'
   */
  override readonly name = 'TierError'

  /**
   * Create a new TierError
   *
   * @param tier - The tier where this error originated (code, generative, agentic, human, cascade)
   * @param code - Machine-readable error code for programmatic handling
   * @param retryable - Whether this operation can be safely retried
   * @param message - Human-readable error message
   * @param cause - Optional underlying error that caused this error
   */
  constructor(
    public readonly tier: TierName,
    public readonly code: TierErrorCode,
    public readonly retryable: boolean,
    message: string,
    public readonly cause?: Error
  ) {
    super(message)

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, TierError.prototype)

    // Capture stack trace (V8 specific)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TierError)
    }
  }

  /**
   * Create a JSON-serializable representation of this error
   */
  toJSON(): {
    name: string
    tier: TierName
    code: TierErrorCode
    retryable: boolean
    message: string
    cause?: { name: string; message: string }
  } {
    return {
      name: this.name,
      tier: this.tier,
      code: this.code,
      retryable: this.retryable,
      message: this.message,
      cause: this.cause
        ? { name: this.cause.name, message: this.cause.message }
        : undefined,
    }
  }

  /**
   * Check if an unknown value is a TierError
   */
  static isTierError(error: unknown): error is TierError {
    return error instanceof TierError
  }

  /**
   * Create a TierError from an unknown error value
   *
   * @param tier - The tier where this error was caught
   * @param error - The unknown error value
   * @param defaultCode - Default error code if not determinable
   * @param defaultRetryable - Default retryable value if not determinable
   */
  static from(
    tier: TierName,
    error: unknown,
    defaultCode: TierErrorCode = 'INTERNAL_ERROR',
    defaultRetryable = false
  ): TierError {
    // Already a TierError - return as-is or wrap with new tier
    if (TierError.isTierError(error)) {
      return error
    }

    // Standard Error
    if (error instanceof Error) {
      return new TierError(tier, defaultCode, defaultRetryable, error.message, error)
    }

    // Unknown error type
    const message = typeof error === 'string' ? error : 'Unknown error'
    return new TierError(tier, defaultCode, defaultRetryable, message)
  }
}
