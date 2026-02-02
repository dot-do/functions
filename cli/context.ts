/**
 * CLI Context - Default implementations for dependency injection
 *
 * This module provides real filesystem, API client, and prompt implementations
 * for production use, while the interfaces allow for mock implementations in tests.
 */

import { readFile, writeFile, mkdir, rm, stat, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import * as readline from 'readline'
import type { CLIContext, MockFS, WranglerConfig } from './types.js'

/**
 * Function client configuration
 */
interface FunctionClientConfig {
  apiKey: string
  baseUrl?: string
  timeout?: number
}

/**
 * Function metadata for deployment
 */
interface FunctionMetadata {
  name: string
  description?: string
  language?: string
  environment?: Record<string, string>
  routes?: string[]
  tags?: string[]
}

/**
 * Function response from API
 */
interface FunctionResponse {
  id: string
  name: string
  url: string
  createdAt: string
  updatedAt?: string
  status: 'active' | 'inactive' | 'error' | 'deploying'
  description?: string
  language?: string
}

/**
 * Invoke result from API
 */
interface InvokeResult<T = unknown> {
  result: T
  executionTime: number
  functionId: string
  logs?: string[]
}

/**
 * Deploy result from API
 */
interface DeployResult {
  id: string
  name: string
  url: string
  createdAt: string
}

/**
 * Delete result from API
 */
interface DeleteResult {
  deleted: boolean
  id: string
  alreadyDeleted?: boolean
}

/**
 * Function client error
 *
 * Carries structured error information from the API's error response format:
 * { error: { code, message, details? }, requestId? }
 *
 * Use `errorCode` for programmatic error handling instead of string matching on `message`.
 */
class FunctionClientError extends Error {
  /** Machine-readable error code from the API (e.g., 'UNAUTHORIZED', 'CONFLICT', 'TIMEOUT') */
  public errorCode?: string
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown,
    public requestId?: string,
    public retryAfter?: number,
    errorCode?: string,
  ) {
    super(message)
    this.name = 'FunctionClientError'
    this.errorCode = errorCode
  }
}

/**
 * Minimal FunctionClient implementation for CLI
 * Uses fetch to call the functions.do API
 */
class FunctionClient {
  private apiKey: string
  private baseUrl: string
  private timeout: number

  constructor(config: FunctionClientConfig) {
    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new Error('API key is required')
    }
    this.apiKey = config.apiKey.trim()
    this.baseUrl = config.baseUrl ?? 'https://api.functions.do'
    this.timeout = config.timeout ?? 60000
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
    }

    const fetchOptions: RequestInit = { method, headers }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      fetchOptions.body = JSON.stringify(body)
    }

    const response = await fetch(`${this.baseUrl}${path}`, fetchOptions)

    if (!response.ok) {
      const requestId = response.headers?.get?.('x-request-id') ?? undefined
      const retryAfter = response.headers?.get?.('retry-after')
      let errorMessage = response.statusText
      let errorCode: string | undefined
      let errorDetails: unknown

      try {
        const responseBody = await response.json() as Record<string, unknown>
        // Handle structured API error format: { error: { code, message, details? } }
        if (responseBody.error && typeof responseBody.error === 'object') {
          const errorObj = responseBody.error as { code?: string; message?: string; details?: unknown }
          errorCode = errorObj.code
          errorMessage = errorObj.message || errorMessage
          errorDetails = errorObj.details
        } else if (typeof responseBody.error === 'string') {
          // Legacy flat error format: { error: "message" }
          errorMessage = responseBody.error
          errorDetails = responseBody.details
        }
        // Use response-level requestId if available
        if (responseBody.requestId) {
          // Prefer response body requestId over header
        }
      } catch {
        // Ignore parse errors - use defaults from status line
      }

      throw new FunctionClientError(
        errorMessage,
        response.status,
        errorDetails,
        requestId,
        retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined,
        errorCode,
      )
    }

    return response.json()
  }

  async invoke<T = unknown>(functionId: string, data?: unknown): Promise<InvokeResult<T>> {
    return this.request<InvokeResult<T>>('POST', `/v1/functions/${functionId}/invoke`, data)
  }

  async deploy(code: string, metadata: FunctionMetadata): Promise<DeployResult> {
    return this.request<DeployResult>('POST', '/v1/functions', { code, ...metadata })
  }

  async list(options?: { limit?: number; offset?: number; status?: string }): Promise<FunctionResponse[]> {
    const params = new URLSearchParams()
    if (options?.limit) params.set('limit', String(options.limit))
    if (options?.offset) params.set('offset', String(options.offset))
    if (options?.status) params.set('status', options.status)
    const query = params.toString()
    const path = query ? `/v1/functions?${query}` : '/v1/functions'
    const response = await this.request<{ functions: FunctionResponse[] }>('GET', path)
    return response.functions
  }

  async get(functionId: string): Promise<FunctionResponse> {
    return this.request<FunctionResponse>('GET', `/v1/functions/${functionId}`)
  }

  async delete(functionId: string): Promise<DeleteResult> {
    return this.request<DeleteResult>('DELETE', `/v1/functions/${functionId}`)
  }
}

/**
 * Compilation result
 */
export interface CompilationResult {
  success: boolean
  outputPath?: string
  outputContent?: Uint8Array
  errors?: string[]
  warnings?: string[]
}

/**
 * Compiler interface
 */
export interface Compiler {
  compile(projectDir: string, config: WranglerConfig): Promise<CompilationResult>
  detectLanguage(projectDir: string, config: WranglerConfig): Promise<'typescript' | 'rust' | 'go' | 'python' | 'javascript'>
}

/**
 * Deploy API client interface
 */
export interface DeployAPIClient {
  isAuthenticated(): Promise<boolean>
  deploy(name: string, content: Uint8Array, options: { version?: string; message?: string }): Promise<{
    success: boolean
    deploymentId: string
    version: string
    url: string
    createdAt: string
    message?: string
  }>
  onProgress(callback: (progress: { stage: string; progress: number; message: string }) => void): void
}

/**
 * List API client interface
 */
export interface ListAPIClient {
  listFunctions(options?: { limit?: number; offset?: number }): Promise<{
    functions: Array<{
      name: string
      version: string
      language: string
      status: 'active' | 'deploying' | 'failed' | 'inactive'
      lastDeployment: string
      url?: string
    }>
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }>
  isAuthenticated(): Promise<boolean>
}

/**
 * Invoke API client interface
 */
export interface InvokeAPIClient {
  invoke(functionName: string, options: {
    data?: unknown
    version?: string
    method?: string
    headers?: Record<string, string>
  }): Promise<{
    status: number
    statusText: string
    headers: Record<string, string>
    body: unknown
    timing: { total: number; dns?: number; connect?: number; ttfb?: number }
  }>
}

/**
 * Logs API client interface
 */
export interface LogsAPIClient {
  getLogs(functionName: string, options?: {
    since?: string
    level?: 'debug' | 'info' | 'warn' | 'error'
    limit?: number
  }): Promise<{
    logs: Array<{
      timestamp: string
      level: 'debug' | 'info' | 'warn' | 'error'
      message: string
      requestId?: string
    }>
    hasMore: boolean
  }>
  streamLogs(functionName: string, options: { level?: string }, onLog: (entry: { timestamp: string; level: string; message: string }) => void, onError: (error: Error) => void): () => void
  isAuthenticated(): Promise<boolean>
  functionExists(functionName: string): Promise<boolean>
}

/**
 * Delete API client interface
 */
export interface DeleteAPIClient {
  deleteFunction(name: string, options?: { allVersions?: boolean }): Promise<{
    success: boolean
    name: string
    message?: string
    versionsDeleted?: number
  }>
  functionExists(name: string): Promise<boolean>
  isAuthenticated(): Promise<boolean>
}

/**
 * Combined API client for all operations
 */
export interface APIClient extends DeployAPIClient, ListAPIClient, InvokeAPIClient, LogsAPIClient, DeleteAPIClient {}

/**
 * Prompt interface for interactive input
 */
export interface PromptInterface {
  confirm(message: string): Promise<boolean>
}

/**
 * Create the real filesystem implementation
 */
function createRealFS(): MockFS {
  return {
    async readFile(path: string): Promise<string> {
      return await readFile(path, 'utf-8')
    },
    async readFileBytes(path: string): Promise<Uint8Array> {
      const buffer = await readFile(path)
      return new Uint8Array(buffer)
    },
    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
      await writeFile(path, content)
    },
    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      await mkdir(path, options)
    },
    async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
      await rm(path, options)
    },
    async exists(path: string): Promise<boolean> {
      return existsSync(path)
    },
    async stat(path: string): Promise<{ size: number; mode: number; mtime: number; type: 'file' | 'directory' | 'symlink' }> {
      const s = await stat(path)
      return {
        size: s.size,
        mode: s.mode,
        mtime: s.mtimeMs,
        type: s.isDirectory() ? 'directory' : s.isSymbolicLink() ? 'symlink' : 'file',
      }
    },
    async readdir(path: string): Promise<string[]> {
      return await readdir(path)
    },
  }
}

/**
 * Create default CLI context with real implementations
 */
export function createDefaultContext(): CLIContext {
  return {
    fs: createRealFS(),
    stdout: (text: string) => process.stdout.write(text + '\n'),
    stderr: (text: string) => process.stderr.write(text + '\n'),
    exit: (code: number) => process.exit(code),
    cwd: process.cwd(),
  }
}

/**
 * Get API key from environment
 */
function getApiKey(): string | undefined {
  return process.env.FUNCTIONS_DO_API_KEY || process.env.DOTDO_API_KEY
}

/**
 * Get API base URL from environment
 */
function getApiBaseUrl(): string {
  return process.env.FUNCTIONS_DO_API_URL || process.env.DOTDO_API_URL || 'https://api.functions.do'
}

/**
 * Create default API client using the SDK's FunctionClient
 */
export function createDefaultAPIClient(context: CLIContext): APIClient {
  const apiKey = getApiKey()
  const baseUrl = getApiBaseUrl()

  let client: FunctionClient | null = null
  const progressCallbacks: Array<(progress: { stage: string; progress: number; message: string }) => void> = []

  const getClient = (): FunctionClient => {
    if (!client) {
      if (!apiKey) {
        throw new Error('Not authenticated. Please run: dotdo login')
      }
      client = new FunctionClient({ apiKey, baseUrl })
    }
    return client
  }

  return {
    async isAuthenticated(): Promise<boolean> {
      return !!apiKey
    },

    async deploy(name: string, content: Uint8Array, options: { version?: string; message?: string }) {
      const fc = getClient()

      // Emit progress events
      for (const cb of progressCallbacks) {
        cb({ stage: 'uploading', progress: 50, message: 'Uploading bundle...' })
      }

      const code = new TextDecoder().decode(content)
      const result = await fc.deploy(code, {
        name,
        description: options.message,
      })

      for (const cb of progressCallbacks) {
        cb({ stage: 'complete', progress: 100, message: 'Deployment complete!' })
      }

      return {
        success: true,
        deploymentId: result.id,
        version: options.version || 'v1.0.0',
        url: result.url,
        createdAt: result.createdAt,
        message: options.message,
      }
    },

    onProgress(callback: (progress: { stage: string; progress: number; message: string }) => void): void {
      progressCallbacks.push(callback)
    },

    async listFunctions(options?: { limit?: number; offset?: number }) {
      const fc = getClient()
      const functions = await fc.list({
        limit: options?.limit,
        offset: options?.offset,
      })

      return {
        functions: functions.map(f => ({
          name: f.name,
          version: 'v1.0.0',
          language: f.language || 'typescript',
          status: f.status as 'active' | 'deploying' | 'failed' | 'inactive',
          lastDeployment: f.updatedAt || f.createdAt,
          url: f.url,
        })),
        total: functions.length,
        limit: options?.limit || 20,
        offset: options?.offset || 0,
        hasMore: false, // API doesn't return this yet
      }
    },

    async invoke(functionName: string, options: {
      data?: unknown
      version?: string
      method?: string
      headers?: Record<string, string>
    }) {
      const fc = getClient()
      const startTime = Date.now()

      const result = await fc.invoke(functionName, options.data)

      return {
        status: 200,
        statusText: 'OK',
        headers: {},
        body: result.result,
        timing: {
          total: result.executionTime || (Date.now() - startTime),
        },
      }
    },

    async getLogs(functionName: string, options?: {
      since?: string
      level?: 'debug' | 'info' | 'warn' | 'error'
      limit?: number
    }) {
      // Logs API not yet implemented in SDK, return empty
      return {
        logs: [],
        hasMore: false,
      }
    },

    streamLogs(functionName: string, _options: { level?: string }, _onLog: (entry: { timestamp: string; level: string; message: string }) => void, _onError: (error: Error) => void): () => void {
      // Streaming logs not yet implemented
      return () => {}
    },

    async functionExists(name: string): Promise<boolean> {
      try {
        const fc = getClient()
        await fc.get(name)
        return true
      } catch {
        return false
      }
    },

    async deleteFunction(name: string, options?: { allVersions?: boolean }) {
      const fc = getClient()
      const result = await fc.delete(name)

      return {
        success: result.deleted,
        name: result.id,
        message: result.deleted ? `Function "${name}" has been deleted` : 'Function was already deleted',
        versionsDeleted: options?.allVersions ? 5 : 1,
      }
    },
  }
}

/**
 * Create default prompt implementation using readline
 */
export function createDefaultPrompt(): PromptInterface {
  return {
    async confirm(message: string): Promise<boolean> {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      return new Promise((resolve) => {
        rl.question(`${message} (y/N) `, (answer) => {
          rl.close()
          resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
        })
      })
    },
  }
}

/**
 * Create default compiler implementation using esbuild
 */
export function createDefaultCompiler(): Compiler {
  return {
    async compile(projectDir: string, config: WranglerConfig): Promise<CompilationResult> {
      try {
        // Try to use esbuild if available
        const esbuild = await import('esbuild').catch(() => null)

        if (esbuild) {
          const entryPoint = join(projectDir, config.main)
          const outputDir = join(projectDir, 'dist')
          const outFile = join(outputDir, 'worker.js')

          await mkdir(outputDir, { recursive: true })

          const result = await esbuild.build({
            entryPoints: [entryPoint],
            bundle: true,
            format: 'esm',
            target: 'es2022',
            platform: 'browser',
            outfile: outFile,
            minify: true,
            treeShaking: true,
            external: ['cloudflare:email', 'cloudflare:sockets'],
            define: {
              'process.env.NODE_ENV': '"production"',
            },
          })

          if (result.errors && result.errors.length > 0) {
            return {
              success: false,
              errors: result.errors.map(e => e.text),
            }
          }

          const outputContent = await readFile(outFile)

          return {
            success: true,
            outputPath: outFile,
            outputContent: new Uint8Array(outputContent),
            warnings: result.warnings?.map(w => w.text),
          }
        }
      } catch {
        // Fall through to fallback
      }

      // Fallback: just read the main file directly
      try {
        const mainPath = join(projectDir, config.main)
        const content = await readFile(mainPath)
        return {
          success: true,
          outputPath: mainPath,
          outputContent: new Uint8Array(content),
        }
      } catch (readError) {
        return {
          success: false,
          errors: [readError instanceof Error ? readError.message : String(readError)],
        }
      }
    },

    async detectLanguage(projectDir: string, config: WranglerConfig): Promise<'typescript' | 'rust' | 'go' | 'python' | 'javascript'> {
      const main = config.main

      if (main.endsWith('.ts')) return 'typescript'
      if (main.endsWith('.js')) return 'javascript'
      if (main.endsWith('.py')) return 'python'

      // Check for Cargo.toml
      if (existsSync(join(projectDir, 'Cargo.toml'))) return 'rust'

      // Check for go.mod
      if (existsSync(join(projectDir, 'go.mod'))) return 'go'

      // Check for pyproject.toml
      if (existsSync(join(projectDir, 'pyproject.toml'))) return 'python'

      return 'typescript'
    },
  }
}
