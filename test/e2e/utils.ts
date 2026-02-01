/**
 * E2E Test Utilities
 *
 * Provides common utilities for E2E tests including polling helpers
 * to avoid flaky tests caused by fixed setTimeout delays.
 */

/**
 * Options for the waitForCondition utility
 */
export interface WaitForConditionOptions {
  /** Maximum time to wait in milliseconds (default: 30000) */
  timeout?: number
  /** Interval between condition checks in milliseconds (default: 500) */
  interval?: number
  /** Description of what we're waiting for (for error messages) */
  description?: string
}

/**
 * Polls a condition function until it returns true or timeout is reached.
 * Useful for waiting on eventually consistent systems like Cloudflare KV.
 *
 * @param condition - Async function that returns true when condition is met
 * @param options - Configuration options for timeout and interval
 * @throws Error if condition is not met within timeout
 *
 * @example
 * // Wait for KV propagation
 * await waitForCondition(async () => {
 *   const result = await invokeFunction(functionId)
 *   return result.version === '1.0.0'
 * }, { timeout: 10000, description: 'function version to be 1.0.0' })
 */
export async function waitForCondition(
  condition: () => Promise<boolean>,
  options: WaitForConditionOptions = {}
): Promise<void> {
  const { timeout = 30000, interval = 500, description = 'condition' } = options
  const start = Date.now()

  while (Date.now() - start < timeout) {
    try {
      if (await condition()) {
        return
      }
    } catch {
      // Condition threw an error - continue polling
    }
    await new Promise((r) => setTimeout(r, interval))
  }

  throw new Error(`Timed out waiting for ${description} (waited ${timeout}ms)`)
}

/**
 * Waits for logs to be available for a function by polling.
 * More reliable than fixed delays for log propagation.
 *
 * @param getLogsFn - Function to retrieve logs
 * @param options - Polling options
 * @returns The logs once available
 */
export async function waitForLogs<T>(
  getLogsFn: () => Promise<T[]>,
  options: WaitForConditionOptions & { minCount?: number } = {}
): Promise<T[]> {
  const { minCount = 1, timeout = 10000, interval = 500, description = 'logs' } = options
  const start = Date.now()

  while (Date.now() - start < timeout) {
    try {
      const logs = await getLogsFn()
      if (logs.length >= minCount) {
        return logs
      }
    } catch {
      // Continue polling on error
    }
    await new Promise((r) => setTimeout(r, interval))
  }

  // Return whatever we have, even if below minCount
  // This allows tests to check for edge cases like "no logs"
  try {
    return await getLogsFn()
  } catch {
    return []
  }
}

/**
 * Waits for a function invocation to return an expected value.
 * Useful for testing KV propagation after deploys or rollbacks.
 *
 * @param invokeFn - Function to invoke the deployed function
 * @param checkFn - Function to check if the result is as expected
 * @param options - Polling options
 * @returns The result once the check passes
 */
export async function waitForFunctionResult<T>(
  invokeFn: () => Promise<T>,
  checkFn: (result: T) => boolean,
  options: WaitForConditionOptions = {}
): Promise<T> {
  const { timeout = 10000, interval = 500, description = 'expected function result' } = options
  const start = Date.now()
  let lastResult: T | undefined
  let lastError: Error | undefined

  while (Date.now() - start < timeout) {
    try {
      lastResult = await invokeFn()
      if (checkFn(lastResult)) {
        return lastResult
      }
    } catch (error) {
      lastError = error as Error
      // Continue polling on error
    }
    await new Promise((r) => setTimeout(r, interval))
  }

  if (lastError) {
    throw new Error(
      `Timed out waiting for ${description} (waited ${timeout}ms). Last error: ${lastError.message}`
    )
  }

  throw new Error(
    `Timed out waiting for ${description} (waited ${timeout}ms). Last result: ${JSON.stringify(lastResult)}`
  )
}

/**
 * Retries an async operation with exponential backoff.
 * Useful for operations that may fail transiently.
 *
 * @param operation - Async function to retry
 * @param options - Retry options
 * @returns The result of the successful operation
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number
    initialDelay?: number
    maxDelay?: number
    backoffMultiplier?: number
    description?: string
  } = {}
): Promise<T> {
  const {
    maxRetries = 5,
    initialDelay = 500,
    maxDelay = 10000,
    backoffMultiplier = 2,
    description = 'operation',
  } = options

  let lastError: Error | undefined
  let delay = initialDelay

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error

      if (attempt === maxRetries) {
        break
      }

      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(delay * backoffMultiplier, maxDelay)
    }
  }

  throw new Error(
    `${description} failed after ${maxRetries + 1} attempts. Last error: ${lastError?.message}`
  )
}
