/**
 * @dotdo/functions
 * Official SDK for Functions.do - Multi-language serverless platform
 */

// Re-export create-function utilities
export { createFunction, type FunctionEnv, type FunctionContext, type FunctionHandler, type FunctionExport } from './create-function'

// Re-export capnweb RpcTarget
export { RpcTarget } from './capnweb'

// Re-export FunctionTarget and related types
export {
  FunctionTarget,
  RpcError,
  type WorkerStub,
  type TracingHooks,
  type SpanContext,
  type RequestMetrics,
  type AggregatedMetrics,
  type FunctionTargetOptions,
} from './function-target'

// Types
export interface FunctionClientConfig {
  apiKey: string
  baseUrl?: string
  timeout?: number
}

export interface FunctionMetadata {
  name: string
  description?: string
  language?: string
  environment?: Record<string, string>
  routes?: string[]
  tags?: string[]
}

export interface FunctionResponse {
  id: string
  name: string
  url: string
  createdAt: string
  updatedAt?: string
  status: 'active' | 'inactive' | 'error' | 'deploying'
  description?: string
  language?: string
  environment?: Record<string, string>
  routes?: string[]
  tags?: string[]
  code?: string
}

export interface InvokeResult<T = unknown> {
  result: T
  executionTime: number
  functionId: string
  logs?: string[]
  memoryUsed?: number
}

export interface DeployResult {
  id: string
  name: string
  url: string
  createdAt: string
}

export interface ListOptions {
  limit?: number
  offset?: number
  status?: 'active' | 'inactive' | 'error' | 'deploying'
}

export interface GetOptions {
  includeCode?: boolean
}

export interface DeleteResult {
  deleted: boolean
  id: string
  alreadyDeleted?: boolean
}

// Error class
export class FunctionClientError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown,
    public requestId?: string,
    public retryAfter?: number
  ) {
    super(message)
    this.name = 'FunctionClientError'
  }
}

// Client class
export class FunctionClient {
  private apiKey: string
  private baseUrl: string
  private timeout: number
  private lastAuthError: FunctionClientError | null = null

  constructor(config: FunctionClientConfig) {
    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new Error('API key is required')
    }
    this.apiKey = config.apiKey.trim()
    this.baseUrl = config.baseUrl ?? 'https://api.functions.do'
    this.timeout = config.timeout ?? 60000
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  getApiKey(): string {
    return this.apiKey
  }

  getTimeout(): number {
    return this.timeout
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
    }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (!response) {
      // If we have a cached auth error, re-throw it (for retries after auth failure)
      if (this.lastAuthError) {
        throw this.lastAuthError
      }
      throw new FunctionClientError('Network error: no response received', 0)
    }

    if (!response.ok) {
      const requestId = response.headers?.get?.('x-request-id') ?? undefined
      const retryAfterHeader = response.headers?.get?.('retry-after')
      const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined

      let errorData: { error?: string; details?: unknown } = {}
      try {
        errorData = await response.json()
      } catch {
        // Ignore JSON parse errors for error responses
      }

      // For auth errors, use statusText to include 'Unauthorized' or 'Forbidden'
      // For other errors, prefer the JSON error message
      const message = (response.status === 401 || response.status === 403)
        ? response.statusText
        : (errorData.error ?? response.statusText)
      const error = new FunctionClientError(
        message,
        response.status,
        errorData.details,
        requestId,
        retryAfter
      )

      // Cache auth errors for subsequent requests
      if (response.status === 401 || response.status === 403) {
        this.lastAuthError = error
      }

      throw error
    }

    return response.json()
  }

  async invoke<T = unknown>(functionId: string, data?: unknown): Promise<InvokeResult<T>> {
    if (!functionId || functionId.trim() === '') {
      throw new Error('Function ID is required')
    }

    return this.request<InvokeResult<T>>(
      'POST',
      `/v1/functions/${functionId}/invoke`,
      data
    )
  }

  async deploy(code: string, metadata: FunctionMetadata): Promise<DeployResult> {
    if (!code || code.trim() === '') {
      throw new Error('Function code is required')
    }
    if (!metadata.name || metadata.name.trim() === '') {
      throw new FunctionClientError('Function name is required', 400, { field: 'name', message: 'Name is required' })
    }

    return this.request<DeployResult>('POST', '/v1/functions', {
      code,
      ...metadata,
    })
  }

  async list(options?: ListOptions): Promise<FunctionResponse[]> {
    const params = new URLSearchParams()
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit))
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset))
    }
    if (options?.status !== undefined) {
      params.set('status', options.status)
    }

    const queryString = params.toString()
    const path = queryString ? `/v1/functions?${queryString}` : '/v1/functions'

    const response = await this.request<{ functions: FunctionResponse[] }>('GET', path)
    return response.functions
  }

  async get(functionId: string, options?: GetOptions): Promise<FunctionResponse> {
    if (!functionId || functionId.trim() === '') {
      throw new Error('Function ID is required')
    }

    const params = new URLSearchParams()
    if (options?.includeCode) {
      params.set('includeCode', 'true')
    }

    const queryString = params.toString()
    const path = queryString
      ? `/v1/functions/${functionId}?${queryString}`
      : `/v1/functions/${functionId}`

    return this.request<FunctionResponse>('GET', path)
  }

  async delete(functionId: string): Promise<DeleteResult> {
    if (!functionId || functionId.trim() === '') {
      throw new Error('Function ID is required')
    }

    return this.request<DeleteResult>('DELETE', `/v1/functions/${functionId}`)
  }
}
