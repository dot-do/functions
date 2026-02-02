/**
 * Mock fetch utilities for testing network error scenarios
 */

export interface MockFetchResponse {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

/**
 * Create a mock fetch function that returns specified responses
 */
export function createMockFetch(responses: Map<string, MockFetchResponse>): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    const response = responses.get(url)

    if (!response) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
    }

    return new Response(
      JSON.stringify(response.body),
      { status: response.status, headers: response.headers }
    )
  }
}

/**
 * Create mock fetch that simulates network errors
 */
export function createFailingFetch(error: string = 'Network error'): typeof fetch {
  return async () => { throw new Error(error) }
}

/**
 * Create mock fetch that simulates timeout
 */
export function createTimeoutFetch(delayMs: number = 30000): typeof fetch {
  return async () => {
    await new Promise(resolve => setTimeout(resolve, delayMs))
    throw new Error('Request timeout')
  }
}

// Common error responses
export const ERROR_RESPONSES = {
  RATE_LIMITED: { status: 429, body: { error: 'Rate limited' } },
  SERVER_ERROR: { status: 500, body: { error: 'Internal server error' } },
  UNAUTHORIZED: { status: 401, body: { error: 'Unauthorized' } },
}
