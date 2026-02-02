/// <reference types="@cloudflare/workers-types" />
/**
 * Type declarations for the E2E Workers test environment
 *
 * These types are available in the test Workers context via vitest-pool-workers.
 */

import type { Env } from './worker-entry'

declare module 'cloudflare:test' {
  // ProvidedEnv comes from @cloudflare/vitest-pool-workers
  interface ProvidedEnv extends Env {}

  // SELF is the Worker itself (for testing the Worker's fetch handler)
  const SELF: Fetcher

  // env contains the environment bindings
  const env: Env
}
