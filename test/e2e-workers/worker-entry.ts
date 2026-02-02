/// <reference types="@cloudflare/workers-types" />

/**
 * Worker Entry Point for E2E Tests
 *
 * This is the entry point for the test Worker that runs E2E tests.
 * It provides the necessary Worker exports and environment bindings
 * that the tests will use.
 *
 * The actual tests run inside this Worker context, which means:
 * - fetch() behaves like a real Worker (Workers runtime, not Node.js)
 * - Service bindings can be tested (FUNCTIONS_DO binding)
 * - All Workers-specific APIs are available
 */

/**
 * Fetcher stub for when service binding is not available
 * Falls back to using global fetch with the configured base URL
 */
class FetcherFallback {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // Convert the URL to use the base URL
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const targetUrl = url.replace(/^https?:\/\/[^/]+/, this.baseUrl)
    return fetch(targetUrl, init)
  }
}

export interface Env {
  /** Base URL for functions.do API (for fetch-based testing) */
  E2E_BASE_URL: string
  /** Service binding to the functions.do Worker (for binding-based testing) */
  FUNCTIONS_DO?: Fetcher
  /** API key for authenticated requests (set via secrets) */
  FUNCTIONS_API_KEY?: string
  /** Environment identifier */
  ENVIRONMENT: string
}

/**
 * Get the FUNCTIONS_DO fetcher, falling back to direct HTTP if binding is not available
 */
export function getFunctionsFetcher(env: Env): Fetcher {
  if (env.FUNCTIONS_DO) {
    return env.FUNCTIONS_DO
  }
  // Fallback: use direct fetch to the configured base URL
  return new FetcherFallback(env.E2E_BASE_URL) as unknown as Fetcher
}

/**
 * Default export for the test Worker.
 * This Worker doesn't serve HTTP requests - it's just a container for running tests.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // This Worker is only used for running tests, not serving requests
    return new Response('E2E Test Worker - Use vitest to run tests', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  },
}

/**
 * Export env for tests to access
 * Tests can import this module to get the environment bindings
 */
export type { Env as WorkerEnv }
