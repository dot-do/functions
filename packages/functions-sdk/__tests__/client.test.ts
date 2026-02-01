import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { FunctionClient, FunctionClientConfig, FunctionMetadata, FunctionResponse, InvokeResult, DeployResult, FunctionClientError } from '../src/index'

describe('FunctionClient', () => {
  let client: FunctionClient
  const mockApiKey = 'test-api-key-12345'
  const mockBaseUrl = 'https://api.functions.do'

  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initialization', () => {
    it('should initialize with API key', () => {
      client = new FunctionClient({ apiKey: mockApiKey })
      expect(client).toBeInstanceOf(FunctionClient)
    })

    it('should initialize with custom base URL', () => {
      client = new FunctionClient({
        apiKey: mockApiKey,
        baseUrl: 'https://custom.api.com'
      })
      expect(client).toBeInstanceOf(FunctionClient)
    })

    it('should throw error when API key is missing', () => {
      expect(() => new FunctionClient({} as FunctionClientConfig)).toThrow('API key is required')
    })

    it('should throw error when API key is empty string', () => {
      expect(() => new FunctionClient({ apiKey: '' })).toThrow('API key is required')
    })

    it('should use default base URL when not provided', () => {
      client = new FunctionClient({ apiKey: mockApiKey })
      expect(client.getBaseUrl()).toBe('https://api.functions.do')
    })

    it('should trim whitespace from API key', () => {
      client = new FunctionClient({ apiKey: '  trimmed-key  ' })
      expect(client.getApiKey()).toBe('trimmed-key')
    })

    it('should accept optional timeout configuration', () => {
      client = new FunctionClient({ apiKey: mockApiKey, timeout: 30000 })
      expect(client.getTimeout()).toBe(30000)
    })

    it('should use default timeout when not provided', () => {
      client = new FunctionClient({ apiKey: mockApiKey })
      expect(client.getTimeout()).toBe(60000)
    })
  })

  describe('authentication', () => {
    beforeEach(() => {
      client = new FunctionClient({ apiKey: mockApiKey })
    })

    it('should include Authorization header in requests', async () => {
      const mockResponse = { functions: [] }
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      await client.list()

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': `Bearer ${mockApiKey}`,
          }),
        })
      )
    })

    it('should include Content-Type header for JSON requests', async () => {
      const mockResponse = { id: 'func-123' }
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      await client.deploy('export default () => "hello"', { name: 'test-fn' })

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )
    })

    it('should throw FunctionClientError on 401 Unauthorized', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Invalid API key' }),
      } as Response)

      await expect(client.list()).rejects.toThrow(FunctionClientError)
      await expect(client.list()).rejects.toThrow('Unauthorized')
    })

    it('should throw FunctionClientError on 403 Forbidden', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ error: 'Access denied' }),
      } as Response)

      await expect(client.list()).rejects.toThrow(FunctionClientError)
    })
  })

  describe('invoke()', () => {
    beforeEach(() => {
      client = new FunctionClient({ apiKey: mockApiKey })
    })

    it('should invoke a function by ID with data', async () => {
      const mockResult: InvokeResult = {
        result: { message: 'Hello, World!' },
        executionTime: 42,
        functionId: 'func-123',
      }
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as Response)

      const result = await client.invoke('func-123', { name: 'World' })

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/functions/func-123/invoke`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'World' }),
        })
      )
      expect(result).toEqual(mockResult)
    })

    it('should invoke a function without data', async () => {
      const mockResult: InvokeResult = {
        result: 'Hello!',
        executionTime: 10,
        functionId: 'func-456',
      }
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as Response)

      const result = await client.invoke('func-456')

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/functions/func-456/invoke`,
        expect.objectContaining({
          method: 'POST',
        })
      )
      expect(result).toEqual(mockResult)
    })

    it('should throw error for invalid function ID', async () => {
      await expect(client.invoke('')).rejects.toThrow('Function ID is required')
    })

    it('should handle function execution errors', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Function execution failed', details: 'TypeError: undefined' }),
      } as Response)

      await expect(client.invoke('func-123', {})).rejects.toThrow(FunctionClientError)
    })

    it('should handle function not found', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Function not found' }),
      } as Response)

      await expect(client.invoke('non-existent')).rejects.toThrow('Function not found')
    })

    it('should support typed invocation results', async () => {
      interface UserResponse {
        id: string
        name: string
      }
      const mockResult: InvokeResult<UserResponse> = {
        result: { id: '1', name: 'Alice' },
        executionTime: 15,
        functionId: 'func-users',
      }
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as Response)

      const result = await client.invoke<UserResponse>('func-users', { userId: '1' })

      expect(result.result.id).toBe('1')
      expect(result.result.name).toBe('Alice')
    })

    it('should include execution metadata in response', async () => {
      const mockResult: InvokeResult = {
        result: 'done',
        executionTime: 100,
        functionId: 'func-123',
        logs: ['log1', 'log2'],
        memoryUsed: 128,
      }
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as Response)

      const result = await client.invoke('func-123')

      expect(result.executionTime).toBe(100)
      expect(result.logs).toEqual(['log1', 'log2'])
      expect(result.memoryUsed).toBe(128)
    })
  })

  describe('deploy()', () => {
    beforeEach(() => {
      client = new FunctionClient({ apiKey: mockApiKey })
    })

    it('should deploy a function with code and metadata', async () => {
      const code = 'export default (request) => new Response("Hello")'
      const metadata: FunctionMetadata = {
        name: 'my-function',
        description: 'A test function',
        language: 'typescript',
      }
      const mockResult: DeployResult = {
        id: 'func-new-123',
        name: 'my-function',
        url: 'https://my-function.functions.do',
        createdAt: '2024-01-15T10:00:00Z',
      }
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as Response)

      const result = await client.deploy(code, metadata)

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/api/functions`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ code, ...metadata }),
        })
      )
      expect(result).toEqual(mockResult)
    })

    it('should deploy with minimal metadata', async () => {
      const code = 'export default () => "minimal"'
      const metadata: FunctionMetadata = { name: 'minimal-fn' }
      const mockResult: DeployResult = {
        id: 'func-min-456',
        name: 'minimal-fn',
        url: 'https://minimal-fn.functions.do',
        createdAt: '2024-01-15T10:00:00Z',
      }
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as Response)

      const result = await client.deploy(code, metadata)

      expect(result.id).toBe('func-min-456')
    })

    it('should throw error when code is empty', async () => {
      await expect(client.deploy('', { name: 'test' })).rejects.toThrow('Function code is required')
    })

    it('should throw error when name is missing', async () => {
      await expect(client.deploy('code', {} as FunctionMetadata)).rejects.toThrow('Function name is required')
    })

    it('should handle deployment validation errors', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: 'Invalid function code', details: 'Syntax error at line 5' }),
      } as Response)

      await expect(client.deploy('invalid{code', { name: 'bad-fn' })).rejects.toThrow('Invalid function code')
    })

    it('should support environment variables in metadata', async () => {
      const code = 'export default () => process.env.SECRET'
      const metadata: FunctionMetadata = {
        name: 'env-fn',
        environment: {
          SECRET: 'my-secret-value',
          API_URL: 'https://api.example.com',
        },
      }
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'func-env', name: 'env-fn', url: 'https://env-fn.functions.do', createdAt: '2024-01-15T10:00:00Z' }),
      } as Response)

      await client.deploy(code, metadata)

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"environment"'),
        })
      )
    })

    it('should support custom routes in metadata', async () => {
      const code = 'export default () => "routed"'
      const metadata: FunctionMetadata = {
        name: 'routed-fn',
        routes: ['/api/users', '/api/users/:id'],
      }
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'func-route', name: 'routed-fn', url: 'https://routed-fn.functions.do', createdAt: '2024-01-15T10:00:00Z' }),
      } as Response)

      await client.deploy(code, metadata)

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"routes"'),
        })
      )
    })
  })

  describe('list()', () => {
    beforeEach(() => {
      client = new FunctionClient({ apiKey: mockApiKey })
    })

    it('should list all functions', async () => {
      const mockFunctions: FunctionResponse[] = [
        { id: 'func-1', name: 'function-1', url: 'https://function-1.functions.do', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-02T00:00:00Z', status: 'active' },
        { id: 'func-2', name: 'function-2', url: 'https://function-2.functions.do', createdAt: '2024-01-03T00:00:00Z', updatedAt: '2024-01-04T00:00:00Z', status: 'active' },
      ]
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ functions: mockFunctions }),
      } as Response)

      const result = await client.list()

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/api/functions`,
        expect.objectContaining({
          method: 'GET',
        })
      )
      expect(result).toEqual(mockFunctions)
    })

    it('should return empty array when no functions exist', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ functions: [] }),
      } as Response)

      const result = await client.list()

      expect(result).toEqual([])
    })

    it('should support pagination options', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ functions: [], hasMore: false, total: 0 }),
      } as Response)

      await client.list({ limit: 10, offset: 20 })

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/api/functions?limit=10&offset=20`,
        expect.any(Object)
      )
    })

    it('should support filtering by status', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ functions: [] }),
      } as Response)

      await client.list({ status: 'active' })

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/api/functions?status=active`,
        expect.any(Object)
      )
    })
  })

  describe('get()', () => {
    beforeEach(() => {
      client = new FunctionClient({ apiKey: mockApiKey })
    })

    it('should get a function by ID', async () => {
      const mockFunction: FunctionResponse = {
        id: 'func-123',
        name: 'my-function',
        url: 'https://my-function.functions.do',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        status: 'active',
        description: 'A test function',
        language: 'typescript',
      }
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockFunction,
      } as Response)

      const result = await client.get('func-123')

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/api/functions/func-123`,
        expect.objectContaining({
          method: 'GET',
        })
      )
      expect(result).toEqual(mockFunction)
    })

    it('should throw error for empty function ID', async () => {
      await expect(client.get('')).rejects.toThrow('Function ID is required')
    })

    it('should throw error when function not found', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Function not found' }),
      } as Response)

      await expect(client.get('non-existent')).rejects.toThrow('Function not found')
    })

    it('should include function code when requested', async () => {
      const mockFunction: FunctionResponse = {
        id: 'func-123',
        name: 'my-function',
        url: 'https://my-function.functions.do',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        status: 'active',
        code: 'export default () => "hello"',
      }
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockFunction,
      } as Response)

      const result = await client.get('func-123', { includeCode: true })

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/api/functions/func-123?includeCode=true`,
        expect.any(Object)
      )
      expect(result.code).toBe('export default () => "hello"')
    })
  })

  describe('delete()', () => {
    beforeEach(() => {
      client = new FunctionClient({ apiKey: mockApiKey })
    })

    it('should delete a function by ID', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deleted: true, id: 'func-123' }),
      } as Response)

      const result = await client.delete('func-123')

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/api/functions/func-123`,
        expect.objectContaining({
          method: 'DELETE',
        })
      )
      expect(result).toEqual({ deleted: true, id: 'func-123' })
    })

    it('should throw error for empty function ID', async () => {
      await expect(client.delete('')).rejects.toThrow('Function ID is required')
    })

    it('should throw error when function not found', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Function not found' }),
      } as Response)

      await expect(client.delete('non-existent')).rejects.toThrow('Function not found')
    })

    it('should handle already deleted functions gracefully', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deleted: true, id: 'func-123', alreadyDeleted: true }),
      } as Response)

      const result = await client.delete('func-123')

      expect(result.deleted).toBe(true)
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      client = new FunctionClient({ apiKey: mockApiKey })
    })

    it('should handle network errors', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'))

      await expect(client.list()).rejects.toThrow('Network error')
    })

    it('should handle timeout errors', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Request timeout'))

      await expect(client.list()).rejects.toThrow('Request timeout')
    })

    it('should handle JSON parse errors', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new SyntaxError('Invalid JSON') },
      } as Response)

      await expect(client.list()).rejects.toThrow()
    })

    it('should include request ID in errors when available', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({ 'x-request-id': 'req-abc123' }),
        json: async () => ({ error: 'Internal error' }),
      } as Response)

      try {
        await client.list()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).requestId).toBe('req-abc123')
      }
    })

    it('should provide error details in FunctionClientError', async () => {
      // SDK validates name locally and throws ValidationError
      try {
        await client.deploy('code', {} as FunctionMetadata)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).statusCode).toBe(400)
        expect((error as FunctionClientError).details).toEqual({ message: 'Name is required' })
      }
    })

    it('should handle rate limiting errors', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'retry-after': '60' }),
        json: async () => ({ error: 'Rate limit exceeded' }),
      } as Response)

      try {
        await client.list()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(FunctionClientError)
        expect((error as FunctionClientError).statusCode).toBe(429)
        expect((error as FunctionClientError).retryAfter).toBe(60)
      }
    })
  })

  describe('TypeScript types', () => {
    beforeEach(() => {
      client = new FunctionClient({ apiKey: mockApiKey })
    })

    it('should enforce FunctionClientConfig type', () => {
      const config: FunctionClientConfig = {
        apiKey: 'key',
        baseUrl: 'https://custom.com',
        timeout: 5000,
      }
      expect(new FunctionClient(config)).toBeInstanceOf(FunctionClient)
    })

    it('should enforce FunctionMetadata type', async () => {
      const metadata: FunctionMetadata = {
        name: 'typed-function',
        description: 'A strongly typed function',
        language: 'typescript',
        environment: { KEY: 'value' },
        routes: ['/api/test'],
        tags: ['test', 'example'],
      }
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'func-typed', name: 'typed-function', url: 'https://typed.functions.do', createdAt: '2024-01-15T10:00:00Z' }),
      } as Response)

      await client.deploy('code', metadata)

      expect(global.fetch).toHaveBeenCalled()
    })

    it('should enforce FunctionResponse type', async () => {
      const mockResponse: FunctionResponse = {
        id: 'func-123',
        name: 'response-test',
        url: 'https://response-test.functions.do',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        status: 'active',
        description: 'Test description',
        language: 'javascript',
        environment: { NODE_ENV: 'production' },
        routes: ['/api'],
        tags: ['production'],
        code: 'export default () => {}',
      }
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const result = await client.get('func-123', { includeCode: true })

      expect(result.id).toBe('func-123')
      expect(result.status).toBe('active')
    })

    it('should support generic type parameter for invoke', async () => {
      interface CustomResult {
        userId: number
        userName: string
        isActive: boolean
      }
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { userId: 1, userName: 'test', isActive: true },
          executionTime: 10,
          functionId: 'func-typed',
        }),
      } as Response)

      const result = await client.invoke<CustomResult>('func-typed', { id: 1 })

      // TypeScript should properly infer result.result as CustomResult
      expect(result.result.userId).toBe(1)
      expect(result.result.userName).toBe('test')
      expect(result.result.isActive).toBe(true)
    })
  })
})

describe('FunctionClientError', () => {
  it('should be an instance of Error', () => {
    const error = new FunctionClientError('Test error', 500)
    expect(error).toBeInstanceOf(Error)
  })

  it('should have correct name', () => {
    const error = new FunctionClientError('Test error', 500)
    expect(error.name).toBe('FunctionClientError')
  })

  it('should store status code', () => {
    const error = new FunctionClientError('Test error', 404)
    expect(error.statusCode).toBe(404)
  })

  it('should store details', () => {
    const error = new FunctionClientError('Test error', 400, { details: { field: 'name' } })
    expect(error.details).toEqual({ field: 'name' })
  })

  it('should store request ID', () => {
    const error = new FunctionClientError('Test error', 500, { requestId: 'req-123' })
    expect(error.requestId).toBe('req-123')
  })

  it('should store retry-after for rate limiting', () => {
    const error = new FunctionClientError('Rate limited', 429, { retryAfter: 60 })
    expect(error.retryAfter).toBe(60)
  })
})
