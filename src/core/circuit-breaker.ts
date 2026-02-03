/**
 * Circuit Breaker Pattern Implementation
 *
 * Provides resilience for AI calls by preventing cascading failures.
 * When too many failures occur, the circuit "opens" and fails fast
 * until a reset timeout allows a retry.
 *
 * States:
 * - closed: Normal operation, requests pass through
 * - open: Failures exceeded threshold, requests fail immediately
 * - half-open: After reset timeout, allows one request to test recovery
 *
 * @module core/circuit-breaker
 */

/**
 * Circuit breaker state
 */
export type CircuitState = 'closed' | 'open' | 'half-open'

/**
 * Options for configuring the circuit breaker
 */
export interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit (default: 5) */
  threshold?: number
  /** Time in ms before attempting to close the circuit (default: 30000) */
  resetTimeout?: number
  /** Optional name for logging/debugging */
  name?: string
}

/**
 * Statistics about circuit breaker operation
 */
export interface CircuitBreakerStats {
  /** Current circuit state */
  state: CircuitState
  /** Total number of failures since last reset */
  failures: number
  /** Total number of successful calls */
  successes: number
  /** Timestamp of last failure */
  lastFailure: number | null
  /** Timestamp of last success */
  lastSuccess: number | null
  /** Number of times the circuit has opened */
  timesOpened: number
}

/**
 * Circuit Breaker for protecting against cascading failures in AI calls.
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({ threshold: 5, resetTimeout: 30000 })
 *
 * try {
 *   const result = await breaker.call(() => aiClient.chat(request))
 * } catch (error) {
 *   if (error.message === 'Circuit breaker open') {
 *     // Service is temporarily unavailable
 *   }
 * }
 * ```
 */
export class CircuitBreaker {
  private failures = 0
  private successes = 0
  private lastFailure = 0
  private lastSuccess = 0
  private state: CircuitState = 'closed'
  private timesOpened = 0
  private readonly threshold: number
  private readonly resetTimeout: number
  private readonly name: string

  constructor(options: CircuitBreakerOptions = {}) {
    this.threshold = options.threshold ?? 5
    this.resetTimeout = options.resetTimeout ?? 30000
    this.name = options.name ?? 'default'
  }

  /**
   * Execute a function with circuit breaker protection.
   *
   * @param fn - The async function to execute
   * @returns The result of the function
   * @throws Error if the circuit is open or the function throws
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should transition from open to half-open
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.state = 'half-open'
      } else {
        throw new Error('Circuit breaker open')
      }
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (e) {
      this.onFailure()
      throw e
    }
  }

  /**
   * Record a successful call
   */
  private onSuccess(): void {
    this.failures = 0
    this.successes++
    this.lastSuccess = Date.now()
    this.state = 'closed'
  }

  /**
   * Record a failed call
   */
  private onFailure(): void {
    this.failures++
    this.lastFailure = Date.now()

    if (this.state === 'half-open') {
      // Failed during half-open test, reopen the circuit
      this.state = 'open'
      this.timesOpened++
    } else if (this.failures >= this.threshold) {
      // Threshold exceeded, open the circuit
      this.state = 'open'
      this.timesOpened++
    }
  }

  /**
   * Get the current state of the circuit breaker
   */
  getState(): CircuitState {
    return this.state
  }

  /**
   * Get statistics about the circuit breaker
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure || null,
      lastSuccess: this.lastSuccess || null,
      timesOpened: this.timesOpened,
    }
  }

  /**
   * Manually reset the circuit breaker to closed state
   */
  reset(): void {
    this.failures = 0
    this.state = 'closed'
  }

  /**
   * Check if the circuit is currently allowing requests
   */
  isAllowingRequests(): boolean {
    if (this.state === 'closed' || this.state === 'half-open') {
      return true
    }
    // Check if we should transition to half-open
    if (Date.now() - this.lastFailure > this.resetTimeout) {
      return true
    }
    return false
  }
}
