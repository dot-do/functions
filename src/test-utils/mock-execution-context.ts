/**
 * Mock ExecutionContext for testing Cloudflare Workers handlers.
 *
 * Matches the real ExecutionContext interface:
 *   - waitUntil(promise): void
 *   - passThroughOnException(): void
 *   - readonly props: Props
 *
 * This eliminates the need for `as unknown as ExecutionContext` casts
 * that previously hid the missing `props` field.
 */

import { vi } from 'vitest'

/**
 * Creates a properly-typed mock ExecutionContext.
 * All methods are vi.fn() spies so tests can assert on calls.
 */
export function createMockExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: undefined,
  } as unknown as ExecutionContext
}
