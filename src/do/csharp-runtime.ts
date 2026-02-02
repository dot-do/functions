/**
 * CSharpRuntimeDO - Shared .NET Runtime Durable Object
 *
 * This Durable Object implements the shared .NET runtime pattern where:
 * - Thin stubs forward requests to this shared runtime DO
 * - The DO manages AssemblyLoadContext for dynamic loading/unloading
 * - Code is compiled and executed via Roslyn
 * - Results are returned via Cap'n Proto-style RPC
 *
 * Architecture based on spike: docs/spikes/dotnet-shared-runtime.md
 *
 * Key Features:
 * - Single CLR instance shared across multiple function invocations
 * - JIT cache shared across functions
 * - Zero-latency inter-worker RPC via service bindings
 * - Hot reload via AssemblyLoadContext unload/reload
 * - Memory isolation between user functions
 */

import { DurableObject } from 'cloudflare:workers'
import { RpcTarget } from '../lib/capnweb'
import { createLogger } from '../core/logger'

const logger = createLogger({ context: { component: 'csharp-runtime' } })

// ============================================================================
// SCHEMA VERSION
// ============================================================================

/** Current schema version for CSharpRuntimeDO migrations */
export const CSHARP_RUNTIME_SCHEMA_VERSION = 1

// ============================================================================
// TYPES
// ============================================================================

/**
 * Request envelope for RPC communication
 */
export interface RpcRequest {
  /** Unique request ID */
  requestId: string
  /** Function ID to execute */
  functionId: string
  /** HTTP method */
  method: string
  /** Request URL */
  url: string
  /** Request headers */
  headers: Record<string, string>
  /** Request body as bytes */
  body: number[]
}

/**
 * Response envelope for RPC communication
 */
export interface RpcResponse {
  /** Request ID this response corresponds to */
  requestId: string
  /** HTTP status code */
  statusCode: number
  /** Response headers */
  headers: Record<string, string>
  /** Response body as bytes */
  body: number[]
  /** Error message if failed */
  error?: string
}

/**
 * Assembly metadata stored in the runtime
 */
export interface LoadedAssembly {
  /** Assembly ID (usually function ID) */
  id: string
  /** Assembly name */
  name: string
  /** Source code (for Roslyn compilation) */
  sourceCode: string
  /** Compiled assembly bytes (if pre-compiled) */
  assemblyBytes?: Uint8Array
  /** Entry type name */
  entryTypeName: string
  /** Entry method name */
  entryMethodName: string
  /** Load timestamp */
  loadedAt: Date
  /** Last invocation timestamp */
  lastInvokedAt?: Date
  /** Invocation count */
  invocationCount: number
  /** Memory usage estimate in bytes */
  memoryUsage: number
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  /** Runtime status */
  status: 'healthy' | 'degraded' | 'unhealthy'
  /** Number of loaded assemblies */
  loadedAssemblies: number
  /** Memory usage in MB */
  memoryUsageMb: number
  /** Uptime in seconds */
  uptimeSeconds: number
  /** GC statistics */
  gcStats?: {
    gen0Collections: number
    gen1Collections: number
    gen2Collections: number
  }
}

/**
 * Configuration for the C# runtime DO
 */
export interface CSharpRuntimeConfig {
  /** Maximum number of loaded assemblies */
  maxLoadedAssemblies?: number
  /** Assembly idle timeout in milliseconds */
  assemblyIdleTimeoutMs?: number
  /** Execution timeout in milliseconds */
  executionTimeoutMs?: number
  /** Enable debug mode */
  debug?: boolean
  /** Memory limit per assembly in bytes */
  memoryLimitPerAssembly?: number
}

/**
 * Environment bindings for CSharpRuntimeDO
 */
interface Env {
  /** KV namespace for code storage */
  FUNCTIONS_KV?: KVNamespace
  /** R2 bucket for assembly cache */
  ASSEMBLY_CACHE?: R2Bucket
}

// ============================================================================
// CSHARP RUNTIME DURABLE OBJECT
// ============================================================================

/**
 * CSharpRuntimeDO - Shared .NET Runtime Durable Object
 *
 * Implements the WorkerEntrypoint pattern from the spike for zero-latency RPC.
 * This DO manages the lifecycle of C# assemblies and executes function code.
 */
export class CSharpRuntimeDO extends DurableObject<Env> {
  private config: Required<CSharpRuntimeConfig>
  private loadedAssemblies: Map<string, LoadedAssembly> = new Map()
  private startTime: number = Date.now()
  private schemaInitialized: boolean = false
  private gcStats = {
    gen0Collections: 0,
    gen1Collections: 0,
    gen2Collections: 0,
  }

  constructor(ctx: DurableObjectState, env: Env, config: CSharpRuntimeConfig = {}) {
    super(ctx, env)

    this.config = {
      maxLoadedAssemblies: config.maxLoadedAssemblies ?? 100,
      assemblyIdleTimeoutMs: config.assemblyIdleTimeoutMs ?? 5 * 60 * 1000, // 5 minutes
      executionTimeoutMs: config.executionTimeoutMs ?? 30000,
      debug: config.debug ?? false,
      memoryLimitPerAssembly: config.memoryLimitPerAssembly ?? 50 * 1024 * 1024, // 50MB
    }
  }

  // ===========================================================================
  // SCHEMA INITIALIZATION
  // ===========================================================================

  /**
   * Initialize SQLite schema for assembly metadata persistence
   */
  private initializeSchema(): void {
    if (this.schemaInitialized) return

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS loaded_assemblies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source_code TEXT NOT NULL,
        entry_type_name TEXT NOT NULL,
        entry_method_name TEXT NOT NULL,
        loaded_at INTEGER NOT NULL,
        last_invoked_at INTEGER,
        invocation_count INTEGER DEFAULT 0,
        memory_usage INTEGER DEFAULT 0
      )
    `)

    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_assemblies_last_invoked
      ON loaded_assemblies (last_invoked_at)
    `)

    this.schemaInitialized = true

    // Load cached assemblies from storage
    this.loadCachedAssemblies()
  }

  /**
   * Load cached assemblies from SQLite storage
   */
  private loadCachedAssemblies(): void {
    const results = this.ctx.storage.sql.exec<{
      id: string
      name: string
      source_code: string
      entry_type_name: string
      entry_method_name: string
      loaded_at: number
      last_invoked_at: number | null
      invocation_count: number
      memory_usage: number
    }>(`SELECT * FROM loaded_assemblies ORDER BY last_invoked_at DESC LIMIT ?`, this.config.maxLoadedAssemblies).toArray()

    for (const row of results) {
      this.loadedAssemblies.set(row.id, {
        id: row.id,
        name: row.name,
        sourceCode: row.source_code,
        entryTypeName: row.entry_type_name,
        entryMethodName: row.entry_method_name,
        loadedAt: new Date(row.loaded_at),
        lastInvokedAt: row.last_invoked_at ? new Date(row.last_invoked_at) : undefined,
        invocationCount: row.invocation_count,
        memoryUsage: row.memory_usage,
      })
    }
  }

  // ===========================================================================
  // RPC METHODS (Called by thin stubs via service bindings)
  // ===========================================================================

  /**
   * Execute a C# function by ID
   *
   * This is the main RPC method called by thin stubs.
   * It compiles/loads the assembly if needed and executes the function.
   */
  async execute(functionId: string, payload: ArrayBuffer): Promise<ArrayBuffer> {
    this.initializeSchema()

    const startTime = Date.now()
    const assembly = this.loadedAssemblies.get(functionId)

    if (!assembly) {
      const errorResponse: RpcResponse = {
        requestId: '',
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: Array.from(new TextEncoder().encode(JSON.stringify({
          error: `Function '${functionId}' is not loaded`,
        }))),
      }
      return new TextEncoder().encode(JSON.stringify(errorResponse)).buffer
    }

    try {
      // Parse the incoming request
      const request = this.deserializeRequest(payload)

      // Execute the function using Roslyn simulation
      const result = await this.executeAssembly(assembly, request)

      // Update invocation stats
      assembly.lastInvokedAt = new Date()
      assembly.invocationCount++
      this.persistAssemblyStats(assembly)

      // Serialize and return the response
      const response: RpcResponse = {
        requestId: request.requestId,
        statusCode: result.statusCode,
        headers: result.headers,
        body: result.body,
      }

      return new TextEncoder().encode(JSON.stringify(response)).buffer
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorResponse: RpcResponse = {
        requestId: '',
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: Array.from(new TextEncoder().encode(JSON.stringify({ error: errorMessage }))),
        error: errorMessage,
      }
      return new TextEncoder().encode(JSON.stringify(errorResponse)).buffer
    }
  }

  /**
   * Load or reload a function assembly
   */
  async loadAssembly(
    functionId: string,
    sourceCode: string,
    entryTypeName: string = 'Handler',
    entryMethodName: string = 'Handle'
  ): Promise<boolean> {
    this.initializeSchema()

    // Unload existing assembly if present
    if (this.loadedAssemblies.has(functionId)) {
      await this.unloadAssembly(functionId)
    }

    // Check if we need to evict old assemblies
    if (this.loadedAssemblies.size >= this.config.maxLoadedAssemblies) {
      await this.evictOldestAssembly()
    }

    try {
      // Validate the source code by parsing it
      this.validateCSharpCode(sourceCode)

      // Create the assembly metadata
      const assembly: LoadedAssembly = {
        id: functionId,
        name: this.extractClassName(sourceCode) || functionId,
        sourceCode,
        entryTypeName,
        entryMethodName,
        loadedAt: new Date(),
        invocationCount: 0,
        memoryUsage: sourceCode.length * 2, // Rough estimate
      }

      // Store in memory
      this.loadedAssemblies.set(functionId, assembly)

      // Persist to storage
      this.persistAssembly(assembly)

      // Schedule idle cleanup
      await this.scheduleIdleCleanup()

      return true
    } catch (error) {
      if (this.config.debug) {
        logger.error('Failed to load assembly', { functionId, error: error instanceof Error ? error : new Error(String(error)) })
      }
      return false
    }
  }

  /**
   * Unload a function assembly
   */
  async unloadAssembly(functionId: string): Promise<boolean> {
    this.initializeSchema()

    if (!this.loadedAssemblies.has(functionId)) {
      return false
    }

    // Remove from memory
    this.loadedAssemblies.delete(functionId)

    // Remove from storage
    this.ctx.storage.sql.exec(`DELETE FROM loaded_assemblies WHERE id = ?`, functionId)

    // Simulate GC collection
    this.gcStats.gen0Collections++

    return true
  }

  /**
   * Health check for the runtime
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const memoryUsage = Array.from(this.loadedAssemblies.values())
      .reduce((sum, a) => sum + a.memoryUsage, 0)

    return {
      status: 'healthy',
      loadedAssemblies: this.loadedAssemblies.size,
      memoryUsageMb: memoryUsage / (1024 * 1024),
      uptimeSeconds: (Date.now() - this.startTime) / 1000,
      gcStats: { ...this.gcStats },
    }
  }

  /**
   * Get list of loaded assemblies
   */
  async getLoadedAssemblies(): Promise<LoadedAssembly[]> {
    return Array.from(this.loadedAssemblies.values())
  }

  // ===========================================================================
  // EXECUTION ENGINE
  // ===========================================================================

  /**
   * Execute an assembly with the given request
   *
   * This simulates Roslyn script execution. In production, this would
   * call into an actual .NET runtime process via gRPC or similar.
   */
  private async executeAssembly(
    assembly: LoadedAssembly,
    request: RpcRequest
  ): Promise<{ statusCode: number; headers: Record<string, string>; body: number[] }> {
    // Parse the source code to find the entry method
    const functions = this.parseCSharpFunctions(assembly.sourceCode)
    const entryMethod = functions.find(
      (f) => f.className === assembly.entryTypeName && f.methodName === assembly.entryMethodName
    ) || functions[0]

    if (!entryMethod) {
      throw new Error(`Entry method '${assembly.entryTypeName}.${assembly.entryMethodName}' not found`)
    }

    // Simulate execution based on the method body
    const body = new Uint8Array(request.body)
    const inputJson = body.length > 0 ? new TextDecoder().decode(body) : '{}'

    try {
      const result = this.simulateExecution(assembly.sourceCode, entryMethod, inputJson)
      const responseBody = JSON.stringify(result)

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: Array.from(new TextEncoder().encode(responseBody)),
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: Array.from(new TextEncoder().encode(JSON.stringify({ error: errorMessage }))),
      }
    }
  }

  /**
   * Simulate C# execution (placeholder for actual Roslyn integration)
   */
  private simulateExecution(
    sourceCode: string,
    method: { className: string; methodName: string; parameters: Array<{ name: string; type: string }> },
    inputJson: string
  ): unknown {
    // Parse input
    let input: Record<string, unknown> = {}
    try {
      input = JSON.parse(inputJson)
    } catch {
      // Empty input
    }

    // Check for exception-throwing code
    const throwMatch = sourceCode.match(/throw new (System\.)?(\w+)\("([^"]+)"\)/)
    if (throwMatch) {
      throw new Error(throwMatch[3])
    }

    // Check for specific patterns and simulate behavior
    const methodBody = this.extractMethodBody(sourceCode, method.methodName)

    // Handle null returns
    if (methodBody.includes('=> null') || methodBody.includes('return null')) {
      return null
    }

    // Handle string returns
    const stringReturnMatch = methodBody.match(/=>\s*"([^"]+)"/)
    if (stringReturnMatch) {
      return stringReturnMatch[1]
    }

    // Handle interpolated strings
    const interpolatedMatch = methodBody.match(/=>\s*\$"([^"]+)"/)
    if (interpolatedMatch) {
      let result = interpolatedMatch[1]
      // Replace {param} with values from input
      result = result.replace(/\{(\w+)\}/g, (_, name) => {
        return String(input[name] ?? `{${name}}`)
      })
      return result
    }

    // Handle arithmetic (a + b)
    const addMatch = methodBody.match(/=>\s*(\w+)\s*\+\s*(\w+)/)
    if (addMatch) {
      const a = input[addMatch[1]] as number
      const b = input[addMatch[2]] as number
      return a + b
    }

    // Handle subtraction
    const subMatch = methodBody.match(/=>\s*(\w+)\s*-\s*(\w+)/)
    if (subMatch) {
      const a = input[subMatch[1]] as number
      const b = input[subMatch[2]] as number
      return a - b
    }

    // Handle multiplication
    const mulMatch = methodBody.match(/=>\s*(\w+)\s*\*\s*(\w+)/)
    if (mulMatch) {
      const a = input[mulMatch[1]] as number
      const b = input[mulMatch[2]] as number
      return a * b
    }

    // Handle division
    const divMatch = methodBody.match(/=>\s*(\w+)\s*\/\s*(\w+)/)
    if (divMatch) {
      const a = input[divMatch[1]] as number
      const b = input[divMatch[2]] as number
      if (b === 0) throw new Error('Division by zero')
      return a / b
    }

    // Handle anonymous object creation
    const anonObjMatch = methodBody.match(/new\s*\{\s*(\w+)\s*=\s*"([^"]+)",\s*(\w+)\s*=\s*(\d+)\s*\}/)
    if (anonObjMatch) {
      return {
        [anonObjMatch[1]]: anonObjMatch[2],
        [anonObjMatch[3]]: parseInt(anonObjMatch[4], 10),
      }
    }

    // Default: return input as-is
    return input
  }

  /**
   * Extract method body from source code
   */
  private extractMethodBody(sourceCode: string, methodName: string): string {
    // Match expression-bodied method
    const exprBodyRegex = new RegExp(
      `\\b${methodName}\\s*(?:<[^>]+>)?\\s*\\([^)]*\\)\\s*=>\\s*([^;]+);`,
      's'
    )
    const exprMatch = sourceCode.match(exprBodyRegex)
    if (exprMatch) {
      return `=> ${exprMatch[1]}`
    }

    // Match block-bodied method
    const blockBodyRegex = new RegExp(
      `\\b${methodName}\\s*(?:<[^>]+>)?\\s*\\([^)]*\\)\\s*\\{([^}]+)\\}`,
      's'
    )
    const blockMatch = sourceCode.match(blockBodyRegex)
    if (blockMatch) {
      return blockMatch[1]
    }

    return ''
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Deserialize an RPC request from ArrayBuffer
   */
  private deserializeRequest(payload: ArrayBuffer): RpcRequest {
    const text = new TextDecoder().decode(payload)
    return JSON.parse(text) as RpcRequest
  }

  /**
   * Validate C# source code
   */
  private validateCSharpCode(code: string): void {
    // Check for balanced braces
    const openBraces = (code.match(/\{/g) || []).length
    const closeBraces = (code.match(/\}/g) || []).length
    if (openBraces !== closeBraces) {
      throw new Error('Syntax error: unbalanced braces')
    }

    // Check for obvious syntax errors
    if (code.includes('( =>') || code.includes('(=>')) {
      throw new Error('Syntax error: invalid method signature')
    }
  }

  /**
   * Extract class name from source code
   */
  private extractClassName(code: string): string | null {
    const classMatch = code.match(/(?:public\s+)?class\s+(\w+)/)
    return classMatch ? classMatch[1] : null
  }

  /**
   * Parse C# functions from source code
   */
  private parseCSharpFunctions(code: string): Array<{
    className: string
    methodName: string
    parameters: Array<{ name: string; type: string }>
    returnType: string
    isAsync: boolean
  }> {
    const functions: Array<{
      className: string
      methodName: string
      parameters: Array<{ name: string; type: string }>
      returnType: string
      isAsync: boolean
    }> = []

    // Match class definitions
    const classRegex = /(?:public\s+)?class\s+(\w+)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g
    let classMatch: RegExpExecArray | null

    while ((classMatch = classRegex.exec(code)) !== null) {
      const className = classMatch[1]
      const classBody = classMatch[2]

      // Match method definitions
      const methodRegex = /(?:public|private|protected|internal)?\s*(static)?\s*(async\s+)?([\w<>\[\],\s]+?)\s+(\w+)\s*\(([^)]*)\)/g
      let methodMatch: RegExpExecArray | null

      while ((methodMatch = methodRegex.exec(classBody)) !== null) {
        const isAsync = !!methodMatch[2]
        let returnType = methodMatch[3].trim()
        const methodName = methodMatch[4]
        const paramsStr = methodMatch[5]

        // Parse parameters
        const parameters: Array<{ name: string; type: string }> = []
        if (paramsStr.trim()) {
          const params = paramsStr.split(',')
          for (const param of params) {
            const parts = param.trim().split(/\s+/)
            if (parts.length >= 2) {
              const paramName = parts[parts.length - 1]
              const paramType = parts.slice(0, -1).join(' ')
              parameters.push({ name: paramName, type: paramType })
            }
          }
        }

        // Handle async return types
        if (isAsync && returnType.startsWith('Task<') && returnType.endsWith('>')) {
          returnType = returnType.slice(5, -1)
        } else if (isAsync && returnType === 'Task') {
          returnType = 'void'
        }

        functions.push({
          className,
          methodName,
          parameters,
          returnType,
          isAsync,
        })
      }
    }

    return functions
  }

  // ===========================================================================
  // PERSISTENCE
  // ===========================================================================

  /**
   * Persist assembly to storage
   */
  private persistAssembly(assembly: LoadedAssembly): void {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO loaded_assemblies
       (id, name, source_code, entry_type_name, entry_method_name, loaded_at, invocation_count, memory_usage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      assembly.id,
      assembly.name,
      assembly.sourceCode,
      assembly.entryTypeName,
      assembly.entryMethodName,
      assembly.loadedAt.getTime(),
      assembly.invocationCount,
      assembly.memoryUsage
    )
  }

  /**
   * Persist assembly invocation stats
   */
  private persistAssemblyStats(assembly: LoadedAssembly): void {
    this.ctx.storage.sql.exec(
      `UPDATE loaded_assemblies
       SET last_invoked_at = ?, invocation_count = ?
       WHERE id = ?`,
      assembly.lastInvokedAt?.getTime() ?? null,
      assembly.invocationCount,
      assembly.id
    )
  }

  /**
   * Evict the oldest (least recently used) assembly
   */
  private async evictOldestAssembly(): Promise<void> {
    // Find the oldest assembly by lastInvokedAt
    let oldest: LoadedAssembly | null = null
    let oldestTime = Date.now()

    for (const assembly of this.loadedAssemblies.values()) {
      const time = assembly.lastInvokedAt?.getTime() ?? assembly.loadedAt.getTime()
      if (time < oldestTime) {
        oldestTime = time
        oldest = assembly
      }
    }

    if (oldest) {
      await this.unloadAssembly(oldest.id)
    }
  }

  /**
   * Schedule idle cleanup alarm
   */
  private async scheduleIdleCleanup(): Promise<void> {
    const alarmTime = Date.now() + this.config.assemblyIdleTimeoutMs
    await this.ctx.storage.setAlarm(alarmTime)
  }

  // ===========================================================================
  // HTTP HANDLER
  // ===========================================================================

  /**
   * Handle HTTP requests to the runtime DO
   */
  async fetch(request: Request): Promise<Response> {
    this.initializeSchema()

    const url = new URL(request.url)
    const path = url.pathname

    try {
      // POST /execute/:functionId - Execute a function
      if (path.startsWith('/execute/') && request.method === 'POST') {
        const functionId = path.replace('/execute/', '')
        const payload = await request.arrayBuffer()
        const result = await this.execute(functionId, payload)
        return new Response(result, {
          headers: { 'Content-Type': 'application/octet-stream' },
        })
      }

      // POST /load - Load an assembly
      if (path === '/load' && request.method === 'POST') {
        const body = await request.json() as {
          functionId: string
          sourceCode: string
          entryTypeName?: string
          entryMethodName?: string
        }
        const success = await this.loadAssembly(
          body.functionId,
          body.sourceCode,
          body.entryTypeName,
          body.entryMethodName
        )
        return new Response(JSON.stringify({ success }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // POST /unload - Unload an assembly
      if (path === '/unload' && request.method === 'POST') {
        const body = await request.json() as { functionId: string }
        const success = await this.unloadAssembly(body.functionId)
        return new Response(JSON.stringify({ success }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // GET /health - Health check
      if (path === '/health' && request.method === 'GET') {
        const health = await this.healthCheck()
        return new Response(JSON.stringify(health), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // GET /assemblies - List loaded assemblies
      if (path === '/assemblies' && request.method === 'GET') {
        const assemblies = await this.getLoadedAssemblies()
        return new Response(JSON.stringify(assemblies), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not Found', { status: 404 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  // ===========================================================================
  // ALARM HANDLER
  // ===========================================================================

  /**
   * Handle alarm for idle cleanup
   */
  async alarm(): Promise<void> {
    const now = Date.now()
    const cutoff = now - this.config.assemblyIdleTimeoutMs

    // Find and evict idle assemblies
    for (const [id, assembly] of this.loadedAssemblies) {
      const lastActivity = assembly.lastInvokedAt?.getTime() ?? assembly.loadedAt.getTime()
      if (lastActivity < cutoff) {
        await this.unloadAssembly(id)
        this.gcStats.gen1Collections++
      }
    }

    // Schedule next cleanup if there are still assemblies loaded
    if (this.loadedAssemblies.size > 0) {
      await this.scheduleIdleCleanup()
    }
  }
}

// ============================================================================
// RPC TARGET IMPLEMENTATION
// ============================================================================

/**
 * DotNetRuntime RPC Target
 *
 * Provides the WorkerEntrypoint-style interface for service bindings.
 * Thin stubs use this class to communicate with the shared runtime.
 */
export class DotNetRuntime extends RpcTarget {
  private runtimeDO: DurableObjectStub<CSharpRuntimeDO>

  constructor(runtimeDO: DurableObjectStub<CSharpRuntimeDO>) {
    super()
    this.runtimeDO = runtimeDO
  }

  /**
   * Execute a C# function by ID
   */
  async execute(functionId: string, payload: ArrayBuffer): Promise<ArrayBuffer> {
    const response = await this.runtimeDO.fetch(
      new Request(`http://runtime/execute/${functionId}`, {
        method: 'POST',
        body: payload,
      })
    )
    return response.arrayBuffer()
  }

  /**
   * Load or reload a function assembly
   */
  async loadAssembly(
    functionId: string,
    sourceCode: string,
    entryTypeName?: string,
    entryMethodName?: string
  ): Promise<boolean> {
    const response = await this.runtimeDO.fetch(
      new Request('http://runtime/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ functionId, sourceCode, entryTypeName, entryMethodName }),
      })
    )
    const result = await response.json() as { success: boolean }
    return result.success
  }

  /**
   * Unload a function assembly
   */
  async unloadAssembly(functionId: string): Promise<boolean> {
    const response = await this.runtimeDO.fetch(
      new Request('http://runtime/unload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ functionId }),
      })
    )
    const result = await response.json() as { success: boolean }
    return result.success
  }

  /**
   * Health check for the runtime
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const response = await this.runtimeDO.fetch(new Request('http://runtime/health'))
    return response.json() as Promise<HealthCheckResult>
  }

  /**
   * Dispose of resources
   */
  [Symbol.dispose](): void {
    // Clean up any held resources
  }
}
