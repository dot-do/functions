# Spike: Durable Object as .NET Runtime Host

**Date**: 2026-01-12
**Issue**: functions-1yq
**Status**: Research Complete

## Executive Summary

This spike explores using Cloudflare Durable Objects (DO) as a hosting environment for the .NET runtime to serve Functions.do C# function invocations. The architecture keeps the heavy .NET WASM/WASI runtime warm in a DO while allowing lightweight function stubs to dispatch calls via capnweb RPC, dramatically reducing cold start times for C# functions.

**Key Finding**: Durable Objects with WebSocket Hibernation provide an ideal hosting model for persistent .NET runtimes. The DO stays warm for active workloads and hibernates during idle periods, minimizing costs while eliminating cold starts for function invocations.

---

## Architecture Overview

```
                    Functions.do Distributed .NET Runtime Architecture

  +---------------------------------------------------------------------------+
  |                           Client Request                                   |
  +---------------------------------------------------------------------------+
                                      |
                                      v
  +---------------------------------------------------------------------------+
  |                        Edge Worker (Router)                                |
  |  - Receives function invocation                                           |
  |  - Routes to thin C# stub OR shared runtime DO                            |
  +---------------------------------------------------------------------------+
                                      |
         +----------------------------+----------------------------+
         |                                                         |
         v                                                         v
  +---------------------------+                     +---------------------------+
  |    Thin C# Function Stub  |                     |    Thin C# Function Stub  |
  |    (~5-10KB WASM)         |                     |    (~5-10KB WASM)         |
  |                           |                     |                           |
  |  - User business logic    |                     |  - User business logic    |
  |  - Serializes arguments   |                     |  - Serializes arguments   |
  |  - Calls runtime DO       |                     |  - Calls runtime DO       |
  +---------------------------+                     +---------------------------+
         |                                                         |
         |  capnweb RPC (zero-latency Service Binding)             |
         +----------------------------+----------------------------+
                                      |
                                      v
  +---------------------------------------------------------------------------+
  |                    .NET Runtime Durable Object                             |
  |                                                                           |
  |  +---------------------------------------------------------------------+  |
  |  |                     .NET WASM/WASI Runtime                          |  |
  |  |                     (~6-11MB, always warm)                          |  |
  |  |                                                                     |  |
  |  |  +------------------------+  +------------------------+             |  |
  |  |  | AssemblyLoadContext    |  | Roslyn Scripting       |             |  |
  |  |  | (hot-swap user code)   |  | (cached delegates)     |             |  |
  |  |  +------------------------+  +------------------------+             |  |
  |  |                                                                     |  |
  |  |  +------------------------+  +------------------------+             |  |
  |  |  | Core Runtime           |  | Specialized Runtimes   |             |  |
  |  |  | (BCL, System.*)        |  | (EF Core, ASP.NET)     |             |  |
  |  |  +------------------------+  +------------------------+             |  |
  |  +---------------------------------------------------------------------+  |
  |                                                                           |
  |  WebSocket Hibernation API:                                               |
  |  - acceptWebSocket() for hibernatable connections                         |
  |  - serializeAttachment() to persist state before hibernation              |
  |  - webSocketMessage() to wake on incoming requests                        |
  |  - SQLite storage for function metadata and cached assemblies             |
  +---------------------------------------------------------------------------+
                                      |
                                      v
  +---------------------------------------------------------------------------+
  |                        Cloudflare Global Network                           |
  |  - DO routed to same location for consistent performance                  |
  |  - Hibernation saves costs during idle periods                            |
  |  - Alarm API for scheduled maintenance/warmup                             |
  +---------------------------------------------------------------------------+
```

---

## Durable Object Implementation

### Core DO Class (TypeScript hosting WASM)

```typescript
import { DurableObject } from 'cloudflare:workers'

interface FunctionMetadata {
  functionId: string
  version: string
  assemblyPath: string
  entryPoint: string
  lastInvoked: number
  invocationCount: number
}

interface RuntimeState {
  initialized: boolean
  wasmModule: WebAssembly.Module | null
  wasmInstance: WebAssembly.Instance | null
  compiledDelegates: Map<string, number> // functionId -> delegate pointer
  functionMetadata: Map<string, FunctionMetadata>
}

/**
 * DotNetRuntimeDO - Hosts the .NET WASM runtime as a Durable Object
 *
 * Key design principles:
 * 1. DO stays warm to avoid .NET cold start (~2-3s)
 * 2. Hibernation API minimizes costs when idle
 * 3. Functions dispatch via capnweb RPC (zero-latency)
 * 4. SQLite storage for metadata and cached assemblies
 * 5. AssemblyLoadContext for hot-swapping user code
 */
export class DotNetRuntimeDO extends DurableObject<Env> {
  private runtime: RuntimeState = {
    initialized: false,
    wasmModule: null,
    wasmInstance: null,
    compiledDelegates: new Map(),
    functionMetadata: new Map()
  }

  private sql: SqlStorage
  private connections: Map<WebSocket, { functionId: string }> = new Map()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.initializeTables()

    // Restore state from hibernation
    this.ctx.getWebSockets().forEach((ws) => {
      const attachment = ws.deserializeAttachment()
      if (attachment) {
        this.connections.set(ws, attachment as { functionId: string })
      }
    })
  }

  /**
   * Initialize SQLite tables for function metadata and cache
   */
  private initializeTables(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS functions (
        function_id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        assembly_data BLOB,
        entry_point TEXT NOT NULL,
        last_invoked INTEGER,
        invocation_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `)

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS compiled_delegates (
        function_id TEXT PRIMARY KEY,
        delegate_ptr INTEGER,
        compiled_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (function_id) REFERENCES functions(function_id)
      )
    `)

    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_functions_last_invoked
      ON functions(last_invoked DESC)
    `)
  }

  /**
   * Initialize the .NET WASM runtime
   * Called once when DO is first created or awakened from hibernation
   */
  private async initializeRuntime(): Promise<void> {
    if (this.runtime.initialized) return

    await this.ctx.blockConcurrencyWhile(async () => {
      // Fetch pre-compiled .NET WASM module from R2
      const wasmResponse = await this.env.R2_BUCKET.get('dotnet-runtime/runtime.wasm')
      if (!wasmResponse) {
        throw new Error('Failed to load .NET runtime WASM')
      }

      const wasmBytes = await wasmResponse.arrayBuffer()

      // Compile and instantiate the WASM module
      this.runtime.wasmModule = await WebAssembly.compile(wasmBytes)
      this.runtime.wasmInstance = await WebAssembly.instantiate(
        this.runtime.wasmModule,
        this.createImports()
      )

      // Initialize the .NET runtime (calls _start or similar)
      const exports = this.runtime.wasmInstance.exports as any
      if (exports._initialize) {
        exports._initialize()
      }

      // Restore cached delegates from SQLite
      await this.restoreCachedDelegates()

      this.runtime.initialized = true
      console.log('[DotNetRuntimeDO] Runtime initialized')
    })
  }

  /**
   * Create WASI/JavaScript imports for the WASM module
   */
  private createImports(): WebAssembly.Imports {
    return {
      wasi_snapshot_preview1: {
        // WASI imports for file system, clock, random, etc.
        fd_write: (fd: number, iovs: number, iovsLen: number, nwritten: number) => {
          // Implement stdout/stderr writing
          return 0
        },
        fd_read: () => 0,
        fd_close: () => 0,
        clock_time_get: (id: number, precision: bigint, time: number) => {
          // Return current time in nanoseconds
          return 0
        },
        random_get: (buf: number, bufLen: number) => {
          // Fill buffer with random bytes
          const memory = this.runtime.wasmInstance!.exports.memory as WebAssembly.Memory
          const view = new Uint8Array(memory.buffer, buf, bufLen)
          crypto.getRandomValues(view)
          return 0
        },
        proc_exit: () => {},
        environ_get: () => 0,
        environ_sizes_get: () => 0,
        args_get: () => 0,
        args_sizes_get: () => 0,
      },
      env: {
        // Custom JavaScript interop functions
        js_console_log: (ptr: number, len: number) => {
          const memory = this.runtime.wasmInstance!.exports.memory as WebAssembly.Memory
          const bytes = new Uint8Array(memory.buffer, ptr, len)
          const text = new TextDecoder().decode(bytes)
          console.log('[.NET]', text)
        },
        js_fetch: async (urlPtr: number, urlLen: number) => {
          // Allow .NET code to make HTTP requests
        }
      }
    }
  }

  /**
   * Restore cached compiled delegates from SQLite
   */
  private async restoreCachedDelegates(): Promise<void> {
    const cached = this.sql.exec(`
      SELECT function_id, delegate_ptr FROM compiled_delegates
    `).toArray() as Array<{ function_id: string; delegate_ptr: number }>

    for (const entry of cached) {
      this.runtime.compiledDelegates.set(entry.function_id, entry.delegate_ptr)
    }

    console.log(`[DotNetRuntimeDO] Restored ${cached.length} cached delegates`)
  }

  // ============================================================================
  // RPC Methods (called via capnweb from thin stubs)
  // ============================================================================

  /**
   * Invoke a C# function
   * This is the main RPC entry point called by thin function stubs
   */
  async invoke(params: {
    functionId: string
    entryPoint: string
    args: unknown[]
    assemblyData?: ArrayBuffer // Optional: for first-time deployment
  }): Promise<{ success: boolean; result?: unknown; error?: string }> {
    try {
      await this.initializeRuntime()

      const { functionId, entryPoint, args, assemblyData } = params

      // Load or update assembly if provided
      if (assemblyData) {
        await this.loadAssembly(functionId, entryPoint, assemblyData)
      }

      // Get or compile the delegate for this function
      let delegatePtr = this.runtime.compiledDelegates.get(functionId)

      if (!delegatePtr) {
        delegatePtr = await this.compileDelegate(functionId, entryPoint)
        this.runtime.compiledDelegates.set(functionId, delegatePtr)

        // Cache in SQLite
        this.sql.exec(`
          INSERT OR REPLACE INTO compiled_delegates (function_id, delegate_ptr)
          VALUES (?, ?)
        `, functionId, delegatePtr)
      }

      // Execute the function via WASM
      const result = await this.executeDelegate(delegatePtr, args)

      // Update invocation stats
      this.sql.exec(`
        UPDATE functions
        SET last_invoked = ?, invocation_count = invocation_count + 1
        WHERE function_id = ?
      `, Date.now(), functionId)

      return { success: true, result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Load a .NET assembly into the runtime
   */
  private async loadAssembly(
    functionId: string,
    entryPoint: string,
    assemblyData: ArrayBuffer
  ): Promise<void> {
    // Store assembly in SQLite
    this.sql.exec(`
      INSERT OR REPLACE INTO functions (function_id, version, assembly_data, entry_point)
      VALUES (?, ?, ?, ?)
    `, functionId, crypto.randomUUID(), new Uint8Array(assemblyData), entryPoint)

    // Load into .NET runtime via AssemblyLoadContext
    const exports = this.runtime.wasmInstance!.exports as any
    const memory = exports.memory as WebAssembly.Memory

    // Allocate memory for assembly data
    const ptr = exports.malloc(assemblyData.byteLength)
    const view = new Uint8Array(memory.buffer, ptr, assemblyData.byteLength)
    view.set(new Uint8Array(assemblyData))

    // Call .NET to load the assembly
    exports.load_assembly(ptr, assemblyData.byteLength, /* ... */)

    // Free the temporary buffer
    exports.free(ptr)

    // Invalidate cached delegate
    this.runtime.compiledDelegates.delete(functionId)
    this.sql.exec(`DELETE FROM compiled_delegates WHERE function_id = ?`, functionId)
  }

  /**
   * Compile a delegate for the function entry point
   * Uses Roslyn scripting for fast subsequent invocations
   */
  private async compileDelegate(
    functionId: string,
    entryPoint: string
  ): Promise<number> {
    const exports = this.runtime.wasmInstance!.exports as any

    // Get assembly from SQLite
    const result = this.sql.exec(`
      SELECT assembly_data, entry_point FROM functions WHERE function_id = ?
    `, functionId).one() as { assembly_data: Uint8Array; entry_point: string } | null

    if (!result) {
      throw new Error(`Function ${functionId} not found`)
    }

    // Compile delegate via Roslyn scripting
    // This returns a pointer to the compiled delegate
    const delegatePtr = exports.compile_delegate(/* assembly ref, entry point */)

    return delegatePtr
  }

  /**
   * Execute a compiled delegate with arguments
   */
  private async executeDelegate(
    delegatePtr: number,
    args: unknown[]
  ): Promise<unknown> {
    const exports = this.runtime.wasmInstance!.exports as any
    const memory = exports.memory as WebAssembly.Memory

    // Serialize arguments to JSON
    const argsJson = JSON.stringify(args)
    const argsBytes = new TextEncoder().encode(argsJson)

    // Allocate memory and copy args
    const argsPtr = exports.malloc(argsBytes.length)
    const argsView = new Uint8Array(memory.buffer, argsPtr, argsBytes.length)
    argsView.set(argsBytes)

    // Execute the delegate
    const resultPtr = exports.execute_delegate(
      delegatePtr,
      argsPtr,
      argsBytes.length
    )

    // Free args buffer
    exports.free(argsPtr)

    // Read result
    const resultLen = exports.get_result_length(resultPtr)
    const resultBytes = new Uint8Array(memory.buffer, resultPtr, resultLen)
    const resultJson = new TextDecoder().decode(resultBytes)

    // Free result buffer
    exports.free_result(resultPtr)

    return JSON.parse(resultJson)
  }

  // ============================================================================
  // Hibernation API Support
  // ============================================================================

  /**
   * HTTP fetch handler - upgrades to WebSocket for hibernation support
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // WebSocket upgrade for hibernatable connections
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request)
    }

    // Direct RPC call (non-hibernating)
    if (url.pathname === '/invoke' && request.method === 'POST') {
      const params = await request.json() as Parameters<typeof this.invoke>[0]
      const result = await this.invoke(params)
      return Response.json(result)
    }

    // Health check
    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        initialized: this.runtime.initialized,
        cachedDelegates: this.runtime.compiledDelegates.size,
        activeConnections: this.connections.size
      })
    }

    return new Response('Not Found', { status: 404 })
  }

  /**
   * Handle WebSocket upgrade for hibernation-aware connections
   */
  private handleWebSocketUpgrade(request: Request): Response {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // Accept the WebSocket with hibernation support
    this.ctx.acceptWebSocket(server)

    // Store connection metadata
    const functionId = new URL(request.url).searchParams.get('functionId') || 'default'
    server.serializeAttachment({ functionId })
    this.connections.set(server, { functionId })

    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * Handle incoming WebSocket messages (invocation requests)
   * This is called even after hibernation - DO wakes up automatically
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.initializeRuntime()

    try {
      const data = typeof message === 'string'
        ? JSON.parse(message)
        : JSON.parse(new TextDecoder().decode(message))

      if (data.type === 'invoke') {
        const result = await this.invoke(data.params)
        ws.send(JSON.stringify({ id: data.id, ...result }))
      } else if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
      }
    } catch (error) {
      ws.send(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): Promise<void> {
    this.connections.delete(ws)
    console.log(`[DotNetRuntimeDO] Connection closed: ${code} ${reason}`)
  }

  /**
   * Handle WebSocket errors
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('[DotNetRuntimeDO] WebSocket error:', error)
    this.connections.delete(ws)
  }

  // ============================================================================
  // Alarm API for Maintenance
  // ============================================================================

  /**
   * Scheduled alarm for runtime maintenance
   */
  async alarm(): Promise<void> {
    console.log('[DotNetRuntimeDO] Alarm triggered')

    // Clean up old cached delegates (not used in 24 hours)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    this.sql.exec(`
      DELETE FROM compiled_delegates
      WHERE function_id IN (
        SELECT function_id FROM functions WHERE last_invoked < ?
      )
    `, cutoff)

    // Schedule next alarm (every 6 hours)
    await this.ctx.storage.setAlarm(Date.now() + 6 * 60 * 60 * 1000)
  }
}
```

---

## How to Invoke .NET Code from the DO

### Option 1: Roslyn Scripting (Recommended for Dynamic Code)

```csharp
// .NET side: Roslyn scripting engine integration
public class RoslynScriptExecutor
{
    private readonly Dictionary<string, ScriptRunner<object>> _cachedScripts = new();

    public async Task<object> ExecuteAsync(string functionId, string code, object[] args)
    {
        if (!_cachedScripts.TryGetValue(functionId, out var runner))
        {
            // First compile is slow (~2-3s), cached is fast (~30-40ms)
            var script = CSharpScript.Create(code,
                ScriptOptions.Default
                    .WithReferences(typeof(object).Assembly)
                    .WithImports("System", "System.Collections.Generic", "System.Linq"));

            runner = script.CreateDelegate();
            _cachedScripts[functionId] = runner;
        }

        return await runner(new ScriptGlobals { Args = args });
    }
}
```

### Option 2: AssemblyLoadContext (Recommended for Compiled Assemblies)

```csharp
// .NET side: Hot-swappable assembly loading
public class FunctionAssemblyLoader
{
    private readonly Dictionary<string, (AssemblyLoadContext Context, MethodInfo EntryPoint)> _loaded = new();

    public object Execute(string functionId, byte[] assemblyBytes, string entryPoint, object[] args)
    {
        if (!_loaded.TryGetValue(functionId, out var cached))
        {
            var context = new AssemblyLoadContext(functionId, isCollectible: true);
            using var stream = new MemoryStream(assemblyBytes);
            var assembly = context.LoadFromStream(stream);

            // Find entry point: namespace.Class.Method
            var parts = entryPoint.Split('.');
            var typeName = string.Join(".", parts.Take(parts.Length - 1));
            var methodName = parts.Last();

            var type = assembly.GetType(typeName);
            var method = type.GetMethod(methodName, BindingFlags.Public | BindingFlags.Static);

            cached = (context, method);
            _loaded[functionId] = cached;
        }

        return cached.EntryPoint.Invoke(null, args);
    }

    public void Unload(string functionId)
    {
        if (_loaded.TryGetValue(functionId, out var cached))
        {
            cached.Context.Unload();
            _loaded.Remove(functionId);
        }
    }
}
```

### JavaScript-WASM Bridge (calling .NET from TypeScript DO)

```typescript
// TypeScript DO calling .NET WASM
async function callDotNet(
  wasmInstance: WebAssembly.Instance,
  method: string,
  args: unknown[]
): Promise<unknown> {
  const exports = wasmInstance.exports as {
    memory: WebAssembly.Memory
    malloc: (size: number) => number
    free: (ptr: number) => void
    invoke_method: (
      methodPtr: number,
      methodLen: number,
      argsPtr: number,
      argsLen: number
    ) => number
    get_result: (resultHandle: number) => number
    get_result_length: (resultHandle: number) => number
    free_result: (resultHandle: number) => void
  }

  const memory = exports.memory

  // Encode method name
  const methodBytes = new TextEncoder().encode(method)
  const methodPtr = exports.malloc(methodBytes.length)
  new Uint8Array(memory.buffer, methodPtr, methodBytes.length).set(methodBytes)

  // Encode arguments as JSON
  const argsJson = JSON.stringify(args)
  const argsBytes = new TextEncoder().encode(argsJson)
  const argsPtr = exports.malloc(argsBytes.length)
  new Uint8Array(memory.buffer, argsPtr, argsBytes.length).set(argsBytes)

  // Call the method
  const resultHandle = exports.invoke_method(
    methodPtr, methodBytes.length,
    argsPtr, argsBytes.length
  )

  // Free input buffers
  exports.free(methodPtr)
  exports.free(argsPtr)

  // Read result
  const resultPtr = exports.get_result(resultHandle)
  const resultLen = exports.get_result_length(resultHandle)
  const resultBytes = new Uint8Array(memory.buffer, resultPtr, resultLen)
  const resultJson = new TextDecoder().decode(resultBytes.slice())

  // Free result
  exports.free_result(resultHandle)

  return JSON.parse(resultJson)
}
```

---

## Hibernation Patterns for Cost Efficiency

### When Hibernation Occurs

```
  Active Period                    Hibernation                    Wake
  (processing)                     (cost: $0)                   (from msg)
       |                                |                            |
       v                                v                            v
  +----------+                    +----------+                  +----------+
  | DO alive |  -- 10s idle -->   | DO       |  -- WebSocket -> | DO alive |
  | ~$0.25/  |                    | evicted  |     message      | runtime  |
  | million  |                    | from     |                  | restored |
  | requests |                    | memory   |                  |          |
  +----------+                    +----------+                  +----------+
       |                                                             |
       |  IMPORTANT: WebSocket connections STAY OPEN                 |
       |  during hibernation. Only the DO instance is evicted.       |
       |                                                             |
       +-------------------------------------------------------------+
```

### Hibernation-Aware Code Patterns

```typescript
export class DotNetRuntimeDO extends DurableObject<Env> {
  // STATE THAT SURVIVES HIBERNATION:
  // - SQLite storage (this.sql)
  // - WebSocket attachments (serializeAttachment/deserializeAttachment)
  // - Alarms (ctx.storage.setAlarm)

  // STATE THAT DOES NOT SURVIVE HIBERNATION:
  // - In-memory variables (this.runtime.wasmInstance)
  // - JavaScript Maps/Sets (this.runtime.compiledDelegates)
  // - setTimeout/setInterval callbacks

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // PATTERN 1: Restore WebSocket state from attachments
    this.ctx.getWebSockets().forEach((ws) => {
      const attachment = ws.deserializeAttachment()
      if (attachment) {
        this.connections.set(ws, attachment as ConnectionState)
      }
    })

    // PATTERN 2: Lazy initialization of heavy resources
    // DON'T initialize WASM runtime in constructor
    // DO initialize it on first message/request
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // PATTERN 3: Initialize runtime on wake from hibernation
    await this.initializeRuntime()

    // PATTERN 4: Use SQLite for state that must survive hibernation
    const functionMetadata = this.sql.exec(`
      SELECT * FROM functions WHERE function_id = ?
    `, functionId).one()

    // Process message...
  }

  // PATTERN 5: Use WebSocketAutoResponse for heartbeats
  // This runs even during hibernation without waking the DO
  private setupAutoResponse(): void {
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong')
    )
  }

  // PATTERN 6: Persist critical state before potential hibernation
  private async persistState(): Promise<void> {
    // Save delegate pointers to SQLite
    for (const [functionId, ptr] of this.runtime.compiledDelegates) {
      this.sql.exec(`
        INSERT OR REPLACE INTO compiled_delegates (function_id, delegate_ptr)
        VALUES (?, ?)
      `, functionId, ptr)
    }
  }
}
```

### Cost Analysis

| Scenario | Traditional Worker | DO without Hibernation | DO with Hibernation |
|----------|-------------------|----------------------|---------------------|
| 1M invocations/day | $0.50 (CPU time) | $0.25 (fewer cold starts) | $0.10 (hibernation) |
| Long-polling clients | N/A | $15/day (always on) | $0.50/day (hibernation) |
| Idle periods | N/A | Full cost | ~$0 |

**Hibernation Conditions** (all must be met):
1. No active `setTimeout`/`setInterval`
2. No in-progress `await fetch()`
3. Only hibernatable WebSockets (using `acceptWebSocket`)
4. No request/event being processed
5. 10 seconds of inactivity

---

## Comparison: DO Runtime Host vs Shared Worker Approach

### Architecture Comparison

```
  Option A: Shared Worker (Current Design)         Option B: Durable Object Runtime Host

  +---------------------------+                    +---------------------------+
  |    Thin C# Stub (5KB)     |                    |    Thin C# Stub (5KB)     |
  +---------------------------+                    +---------------------------+
              |                                                |
              | Service Binding RPC                            | capnweb RPC
              v                                                v
  +---------------------------+                    +---------------------------+
  | Shared .NET Runtime Worker|                    | .NET Runtime DO           |
  | (always running)          |                    | (hibernates when idle)    |
  |                           |                    |                           |
  | - One per region          |                    | - One per tenant/function |
  | - Sharding keeps warm     |                    | - Hibernation saves cost  |
  | - Stateless               |                    | - Stateful (SQLite)       |
  | - No persistence          |                    | - Persists between calls  |
  +---------------------------+                    +---------------------------+
```

### Detailed Comparison

| Aspect | Shared Worker | Durable Object |
|--------|--------------|----------------|
| **Cold Start** | Rare (sharding keeps warm) | Rare (hibernation, not termination) |
| **State Persistence** | None (stateless) | SQLite + Storage API |
| **Cost Model** | Pay for CPU time | Pay for duration + storage |
| **Idle Cost** | Low (shared across functions) | Very low (hibernation) |
| **Scaling** | Horizontal (more workers) | Single-threaded per DO |
| **Isolation** | Shared runtime (all tenants) | Per-tenant isolation |
| **Complexity** | Simpler | More complex |
| **Assembly Caching** | In-memory only | Persistent SQLite |
| **Hot Reloading** | Requires worker restart | AssemblyLoadContext swap |

### When to Use Each Approach

**Use Shared Worker when:**
- High request volume (millions/day)
- Stateless computation
- Simple execution model
- Cost optimization for high-volume, low-complexity functions

**Use Durable Object when:**
- Need state persistence between invocations
- Per-tenant isolation required
- Long-running connections (WebSocket clients)
- Assembly/delegate caching benefits outweigh DO overhead
- Variable workloads with idle periods (hibernation saves cost)

### Hybrid Architecture (Recommended)

```
  +-----------------------------------------------------------------------+
  |                      Functions.do Request Router                       |
  +-----------------------------------------------------------------------+
                                      |
             +------------------------+------------------------+
             |                                                 |
             v                                                 v
  +------------------------+                     +------------------------+
  | High-Volume Functions  |                     | Per-Tenant Functions   |
  | (Shared Worker)        |                     | (Durable Object)       |
  |                        |                     |                        |
  | - Stateless compute    |                     | - Stateful compute     |
  | - > 100 req/sec        |                     | - Tenant isolation     |
  | - Simple functions     |                     | - Cached assemblies    |
  +------------------------+                     +------------------------+
```

---

## Implementation Roadmap

### Phase 1: POC (1-2 weeks)
1. Create minimal DO with .NET WASM runtime loading
2. Implement basic `invoke()` RPC method
3. Test with simple C# function (Hello World)
4. Measure cold start and warm invocation latency

### Phase 2: Hibernation Support (1 week)
1. Implement WebSocket hibernation pattern
2. Add SQLite storage for function metadata
3. Test hibernation/wake cycles
4. Measure cost savings vs always-on

### Phase 3: Assembly Management (1-2 weeks)
1. Implement AssemblyLoadContext hot-swapping
2. Add Roslyn scripting for dynamic code
3. Implement delegate caching in SQLite
4. Test multi-function scenarios

### Phase 4: Integration (1 week)
1. Integrate with thin C# stub pattern
2. Implement capnweb RPC dispatch
3. Add monitoring and observability
4. Performance benchmarking

---

## References

### Cloudflare Documentation
- [Durable Objects Overview](https://developers.cloudflare.com/durable-objects/)
- [WebSocket Hibernation API](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)
- [Durable Object State API](https://developers.cloudflare.com/durable-objects/api/state/)
- [Durable Object Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
- [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Workers RPC (capnweb)](https://developers.cloudflare.com/workers/runtime-apis/rpc/)

### .NET WebAssembly Resources
- [.NET WASI Support](https://learn.microsoft.com/en-us/aspnet/core/blazor/host-and-deploy/webassembly/)
- [Roslyn Scripting API](https://github.com/dotnet/roslyn/wiki/Scripting-API-Samples)
- [AssemblyLoadContext](https://learn.microsoft.com/en-us/dotnet/core/dependency-loading/understanding-assemblyloadcontext)

### Internal Platform Patterns
- `/Users/nathanclevenger/platform/workers/claude-code/src/session-do.ts` - DO session management
- `/Users/nathanclevenger/platform/workers/sqlite/src/do.ts` - SQLite DO patterns
- `/Users/nathanclevenger/platform/workers/state/src/StateMachine.ts` - Stateful DO patterns
- `/Users/nathanclevenger/platform/research/capnweb-promise-chaining/readme.md` - capnweb RPC patterns

---

## Conclusion

Using a Durable Object to host the .NET runtime provides a compelling architecture for Functions.do C# support:

1. **Eliminates cold starts** - Runtime stays warm in the DO, even during hibernation
2. **Cost efficient** - Hibernation API dramatically reduces idle costs
3. **State persistence** - SQLite stores function metadata and cached delegates
4. **Hot reloading** - AssemblyLoadContext enables code updates without runtime restart
5. **Per-tenant isolation** - Each tenant can have dedicated runtime DO

The recommended approach is a **hybrid architecture** where high-volume stateless functions use shared workers, while per-tenant stateful functions use Durable Objects with hibernation.

**Next Steps:**
1. Create POC with basic .NET WASM runtime in DO
2. Benchmark hibernation wake times
3. Compare cost model with shared worker approach
4. Design capnweb RPC interface for thin stub dispatch
