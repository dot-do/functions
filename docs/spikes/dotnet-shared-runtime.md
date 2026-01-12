# Spike: Shared .NET Runtime Worker Architecture

**Date:** 2026-01-12
**Status:** Research Complete
**Author:** Functions.do Engineering Team

## Executive Summary

This spike explores implementing a shared .NET runtime architecture inspired by Cloudflare's Worker model. The goal is to enable thin function stubs that communicate with a long-running .NET runtime worker via zero-latency RPC, supporting dynamic loading and unloading of user code through `AssemblyLoadContext`.

## Architecture Overview

```
                                    SHARED RUNTIME WORKER
                                    =====================

+------------------+     Service    +----------------------------------------+
|  Thin Stub       |    Binding     |           .NET Runtime Host            |
|  (Worker A)      | ------------> |                                        |
|                  |   (Zero-Copy   |  +----------------------------------+  |
|  - Minimal code  |    RPC)        |  |     AssemblyLoadContext Pool     |  |
|  - Routes to     |                |  |                                  |  |
|    runtime       |                |  |  +--------+  +--------+          |  |
+------------------+                |  |  | ALC 1  |  | ALC 2  |  ...     |  |
                                    |  |  |User Fn1|  |User Fn2|          |  |
+------------------+                |  |  +--------+  +--------+          |  |
|  Thin Stub       |    Service     |  +----------------------------------+  |
|  (Worker B)      | ------------> |                                        |
|                  |    Binding     |  +----------------------------------+  |
+------------------+                |  |       Function Router            |  |
                                    |  +----------------------------------+  |
+------------------+                |                                        |
|  Thin Stub       |    Service     |  +----------------------------------+  |
|  (Worker C)      | ------------> |  |     gRPC / Unix Domain Socket    |  |
|                  |    Binding     |  +----------------------------------+  |
+------------------+                +----------------------------------------+

                                    Benefits:
                                    - Single CLR instance (reduced memory)
                                    - JIT cache shared across functions
                                    - Zero-latency inter-worker RPC
                                    - Hot reload via ALC unload/reload
```

## Table of Contents

1. [Service Bindings and Zero-Latency RPC](#1-service-bindings-and-zero-latency-rpc)
2. [Dynamic Worker Loaders](#2-dynamic-worker-loaders)
3. [Shared Runtime Worker Implementation](#3-shared-runtime-worker-implementation)
4. [Thin Function Stub Implementation](#4-thin-function-stub-implementation)
5. [AssemblyLoadContext Dynamic Loading](#5-assemblyloadcontext-dynamic-loading)
6. [Inter-Process Communication Options](#6-inter-process-communication-options)
7. [Performance Considerations](#7-performance-considerations)
8. [Risks and Mitigations](#8-risks-and-mitigations)
9. [References](#9-references)

---

## 1. Service Bindings and Zero-Latency RPC

### Cloudflare Model

Cloudflare Service Bindings enable Worker-to-Worker communication without public URLs. The key insight is that **RPC between workers usually does not cross a network** - workers run in the same thread, reducing latency to near zero.

From the Cloudflare documentation:

> "RPC to another Worker (over a Service Binding) usually does not even cross a network. In fact, the other Worker usually runs in the very same thread as the caller, reducing latency to zero."

### WorkerEntrypoint Pattern

```typescript
// Runtime Worker - exposes .NET execution as RPC methods
import { WorkerEntrypoint } from "cloudflare:workers";

export class DotNetRuntime extends WorkerEntrypoint {
  // Execute a .NET function by name
  async execute(functionName: string, payload: ArrayBuffer): Promise<ArrayBuffer> {
    // Forward to the .NET runtime process via Unix domain socket
    return await this.env.DOTNET_RUNTIME.invoke(functionName, payload);
  }

  // Load/reload a function assembly
  async loadAssembly(assemblyId: string, assemblyBytes: ArrayBuffer): Promise<boolean> {
    return await this.env.DOTNET_RUNTIME.loadAssembly(assemblyId, assemblyBytes);
  }

  // Unload a function assembly (for hot reload)
  async unloadAssembly(assemblyId: string): Promise<boolean> {
    return await this.env.DOTNET_RUNTIME.unloadAssembly(assemblyId);
  }

  // Health check for the runtime
  async healthCheck(): Promise<{ status: string; loadedAssemblies: number }> {
    return await this.env.DOTNET_RUNTIME.healthCheck();
  }
}
```

### Wrangler Configuration

```toml
# wrangler.toml for the thin stub
name = "my-dotnet-function"
main = "src/stub.ts"

[[services]]
binding = "DOTNET_RUNTIME"
service = "dotnet-shared-runtime"
entrypoint = "DotNetRuntime"
```

---

## 2. Dynamic Worker Loaders

Cloudflare's Dynamic Worker Loaders provide a model for loading arbitrary code at runtime. Key characteristics:

- **Isolate Efficiency**: "Isolates are much cheaper than containers. You can start an isolate in milliseconds."
- **Sandboxing**: Code can be strictly sandboxed with controlled network access
- **Caching**: Isolates may be kept warm for repeated invocations

### Worker Loader Pattern

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Load a dynamic worker based on the function ID
    const functionId = new URL(request.url).pathname.slice(1);

    const workerStub = env.LOADER.get(functionId, () => ({
      compatibilityDate: "2024-01-01",
      mainModule: "function.js",
      modules: {
        "function.js": {
          esModule: await fetchFunctionCode(functionId)
        }
      },
      env: {
        // Pass through bindings to the dynamic worker
        DOTNET_RUNTIME: env.DOTNET_RUNTIME
      },
      // Block direct network access - must go through runtime
      globalOutbound: null
    }));

    return await workerStub.fetch(request);
  }
};
```

---

## 3. Shared Runtime Worker Implementation

### 3.1 Native Host for .NET Runtime

The shared runtime worker hosts the CLR using the .NET native hosting APIs (`nethost` and `hostfxr`).

```cpp
// dotnet_host.cpp - Native CLR host
#include <nethost.h>
#include <coreclr_delegates.h>
#include <hostfxr.h>
#include <iostream>
#include <string>

// Function pointers for hostfxr
hostfxr_initialize_for_runtime_config_fn init_fptr;
hostfxr_get_runtime_delegate_fn get_delegate_fptr;
hostfxr_close_fn close_fptr;

// Managed function delegate
typedef void (CORECLR_DELEGATE_CALLTYPE *execute_function_fn)(
    const char* functionName,
    const uint8_t* payload,
    int32_t payloadSize,
    uint8_t** result,
    int32_t* resultSize
);

class DotNetRuntimeHost {
private:
    load_assembly_and_get_function_pointer_fn load_assembly_fn;
    execute_function_fn execute_fn;
    bool initialized = false;

public:
    bool Initialize(const char* runtimeConfigPath) {
        // Load hostfxr
        char_t hostfxr_path[MAX_PATH];
        size_t buffer_size = sizeof(hostfxr_path) / sizeof(char_t);

        if (get_hostfxr_path(hostfxr_path, &buffer_size, nullptr) != 0) {
            std::cerr << "Failed to locate hostfxr" << std::endl;
            return false;
        }

        // Load the library and get function pointers
        void* lib = LoadLibrary(hostfxr_path);
        init_fptr = (hostfxr_initialize_for_runtime_config_fn)
            GetExport(lib, "hostfxr_initialize_for_runtime_config");
        get_delegate_fptr = (hostfxr_get_runtime_delegate_fn)
            GetExport(lib, "hostfxr_get_runtime_delegate");
        close_fptr = (hostfxr_close_fn)
            GetExport(lib, "hostfxr_close");

        // Initialize the runtime
        hostfxr_handle cxt = nullptr;
        int rc = init_fptr(runtimeConfigPath, nullptr, &cxt);

        if (rc != 0 || cxt == nullptr) {
            std::cerr << "Failed to initialize runtime: " << std::hex << rc << std::endl;
            return false;
        }

        // Get the load assembly delegate
        rc = get_delegate_fptr(
            cxt,
            hdt_load_assembly_and_get_function_pointer,
            (void**)&load_assembly_fn
        );

        close_fptr(cxt);

        if (rc != 0 || load_assembly_fn == nullptr) {
            std::cerr << "Failed to get runtime delegate" << std::endl;
            return false;
        }

        initialized = true;
        return true;
    }

    bool LoadRuntimeEntry(const char* assemblyPath, const char* typeName, const char* methodName) {
        if (!initialized) return false;

        int rc = load_assembly_fn(
            assemblyPath,
            typeName,
            methodName,
            nullptr,  // Use default delegate type
            nullptr,
            (void**)&execute_fn
        );

        return rc == 0 && execute_fn != nullptr;
    }

    std::vector<uint8_t> Execute(const std::string& functionName,
                                  const std::vector<uint8_t>& payload) {
        uint8_t* result = nullptr;
        int32_t resultSize = 0;

        execute_fn(
            functionName.c_str(),
            payload.data(),
            static_cast<int32_t>(payload.size()),
            &result,
            &resultSize
        );

        std::vector<uint8_t> output(result, result + resultSize);
        // Free the managed memory
        FreeCoTaskMem(result);
        return output;
    }
};
```

### 3.2 Managed Runtime Router

```csharp
// FunctionRouter.cs - Managed entry point for the runtime worker
using System;
using System.Collections.Concurrent;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Text.Json;

namespace Functions.Runtime
{
    public static class FunctionRouter
    {
        private static readonly ConcurrentDictionary<string, FunctionContext> _loadedFunctions = new();
        private static readonly ConcurrentDictionary<string, CollectibleAssemblyLoadContext> _loadContexts = new();

        // Entry point called from native code
        [UnmanagedCallersOnly]
        public static unsafe void Execute(
            byte* functionNamePtr, int functionNameLength,
            byte* payloadPtr, int payloadLength,
            byte** resultPtr, int* resultLength)
        {
            try
            {
                var functionName = Marshal.PtrToStringUTF8((IntPtr)functionNamePtr, functionNameLength);
                var payload = new ReadOnlySpan<byte>(payloadPtr, payloadLength);

                var result = ExecuteFunction(functionName!, payload.ToArray());

                *resultLength = result.Length;
                *resultPtr = (byte*)Marshal.AllocCoTaskMem(result.Length);
                Marshal.Copy(result, 0, (IntPtr)(*resultPtr), result.Length);
            }
            catch (Exception ex)
            {
                var errorJson = JsonSerializer.SerializeToUtf8Bytes(new { error = ex.Message });
                *resultLength = errorJson.Length;
                *resultPtr = (byte*)Marshal.AllocCoTaskMem(errorJson.Length);
                Marshal.Copy(errorJson, 0, (IntPtr)(*resultPtr), errorJson.Length);
            }
        }

        public static byte[] ExecuteFunction(string functionName, byte[] payload)
        {
            if (!_loadedFunctions.TryGetValue(functionName, out var context))
            {
                throw new InvalidOperationException($"Function '{functionName}' is not loaded");
            }

            // Invoke the function
            var request = new FunctionRequest
            {
                Payload = payload,
                Headers = new Dictionary<string, string>()
            };

            var response = context.Handler.Invoke(request);
            return JsonSerializer.SerializeToUtf8Bytes(response);
        }

        public static bool LoadFunction(string functionId, byte[] assemblyBytes)
        {
            // Unload existing if present
            UnloadFunction(functionId);

            // Create a new collectible AssemblyLoadContext
            var alc = new CollectibleAssemblyLoadContext(functionId);

            using var stream = new MemoryStream(assemblyBytes);
            var assembly = alc.LoadFromStream(stream);

            // Find the function entry point
            var entryType = assembly.GetTypes()
                .FirstOrDefault(t => typeof(IFunctionHandler).IsAssignableFrom(t));

            if (entryType == null)
            {
                alc.Unload();
                return false;
            }

            var handler = (IFunctionHandler)Activator.CreateInstance(entryType)!;

            _loadContexts[functionId] = alc;
            _loadedFunctions[functionId] = new FunctionContext
            {
                FunctionId = functionId,
                Handler = handler,
                LoadedAt = DateTime.UtcNow
            };

            return true;
        }

        public static bool UnloadFunction(string functionId)
        {
            if (_loadedFunctions.TryRemove(functionId, out _))
            {
                if (_loadContexts.TryRemove(functionId, out var alc))
                {
                    alc.Unload();

                    // Force garbage collection to complete unload
                    for (int i = 0; i < 10; i++)
                    {
                        GC.Collect();
                        GC.WaitForPendingFinalizers();
                    }

                    return true;
                }
            }
            return false;
        }

        public static HealthCheckResult HealthCheck()
        {
            return new HealthCheckResult
            {
                Status = "healthy",
                LoadedFunctions = _loadedFunctions.Count,
                MemoryUsageMB = GC.GetTotalMemory(false) / (1024 * 1024)
            };
        }
    }

    public class FunctionContext
    {
        public required string FunctionId { get; init; }
        public required IFunctionHandler Handler { get; init; }
        public DateTime LoadedAt { get; init; }
    }

    public record FunctionRequest
    {
        public byte[] Payload { get; init; } = Array.Empty<byte>();
        public Dictionary<string, string> Headers { get; init; } = new();
    }

    public record FunctionResponse
    {
        public byte[] Body { get; init; } = Array.Empty<byte>();
        public int StatusCode { get; init; } = 200;
        public Dictionary<string, string> Headers { get; init; } = new();
    }

    public interface IFunctionHandler
    {
        FunctionResponse Invoke(FunctionRequest request);
    }

    public record HealthCheckResult
    {
        public required string Status { get; init; }
        public int LoadedFunctions { get; init; }
        public long MemoryUsageMB { get; init; }
    }
}
```

---

## 4. Thin Function Stub Implementation

### 4.1 TypeScript Stub Worker

```typescript
// stub.ts - Thin stub that routes to shared runtime
import { WorkerEntrypoint } from "cloudflare:workers";

interface Env {
  DOTNET_RUNTIME: Service<DotNetRuntime>;
  FUNCTION_ID: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // Serialize the request for the .NET runtime
      const payload = await serializeRequest(request);

      // Call the shared runtime via Service Binding (zero-latency RPC)
      const result = await env.DOTNET_RUNTIME.execute(
        env.FUNCTION_ID,
        payload
      );

      // Deserialize and return the response
      return deserializeResponse(result);
    } catch (error) {
      return new Response(JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error"
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};

async function serializeRequest(request: Request): Promise<ArrayBuffer> {
  const body = await request.arrayBuffer();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const envelope = {
    method: request.method,
    url: request.url,
    headers,
    body: Array.from(new Uint8Array(body))
  };

  return new TextEncoder().encode(JSON.stringify(envelope)).buffer;
}

function deserializeResponse(result: ArrayBuffer): Response {
  const text = new TextDecoder().decode(result);
  const envelope = JSON.parse(text);

  return new Response(
    envelope.body ? new Uint8Array(envelope.body) : null,
    {
      status: envelope.statusCode ?? 200,
      headers: envelope.headers ?? {}
    }
  );
}

// Service binding interface
interface DotNetRuntime {
  execute(functionName: string, payload: ArrayBuffer): Promise<ArrayBuffer>;
  loadAssembly(assemblyId: string, assemblyBytes: ArrayBuffer): Promise<boolean>;
  unloadAssembly(assemblyId: string): Promise<boolean>;
  healthCheck(): Promise<{ status: string; loadedAssemblies: number }>;
}
```

### 4.2 Wrangler Configuration for Stub

```toml
# wrangler.toml
name = "user-function-abc123"
main = "src/stub.ts"
compatibility_date = "2024-01-01"

[vars]
FUNCTION_ID = "my-dotnet-function"

[[services]]
binding = "DOTNET_RUNTIME"
service = "dotnet-shared-runtime"
entrypoint = "DotNetRuntime"
```

---

## 5. AssemblyLoadContext Dynamic Loading

### 5.1 Collectible AssemblyLoadContext

```csharp
// CollectibleAssemblyLoadContext.cs
using System.Reflection;
using System.Runtime.Loader;

namespace Functions.Runtime
{
    /// <summary>
    /// A collectible AssemblyLoadContext that supports unloading.
    /// Each user function gets its own isolated context.
    /// </summary>
    public class CollectibleAssemblyLoadContext : AssemblyLoadContext
    {
        private readonly AssemblyDependencyResolver? _resolver;

        public string ContextId { get; }
        public DateTime CreatedAt { get; }

        public CollectibleAssemblyLoadContext(string contextId, string? mainAssemblyPath = null)
            : base(name: contextId, isCollectible: true)
        {
            ContextId = contextId;
            CreatedAt = DateTime.UtcNow;

            if (mainAssemblyPath != null)
            {
                _resolver = new AssemblyDependencyResolver(mainAssemblyPath);
            }

            // Subscribe to unloading event for cleanup
            Unloading += OnUnloading;
        }

        protected override Assembly? Load(AssemblyName assemblyName)
        {
            // Try to resolve using the dependency resolver
            if (_resolver != null)
            {
                string? assemblyPath = _resolver.ResolveAssemblyToPath(assemblyName);
                if (assemblyPath != null)
                {
                    return LoadFromAssemblyPath(assemblyPath);
                }
            }

            // Fall back to default context for shared framework assemblies
            return null;
        }

        protected override IntPtr LoadUnmanagedDll(string unmanagedDllName)
        {
            if (_resolver != null)
            {
                string? libraryPath = _resolver.ResolveUnmanagedDllToPath(unmanagedDllName);
                if (libraryPath != null)
                {
                    return LoadUnmanagedDllFromPath(libraryPath);
                }
            }

            return IntPtr.Zero;
        }

        private void OnUnloading(AssemblyLoadContext context)
        {
            Console.WriteLine($"[ALC] Unloading context: {ContextId}");
            // Perform any necessary cleanup here
        }
    }
}
```

### 5.2 Assembly Manager with Hot Reload

```csharp
// AssemblyManager.cs
using System.Collections.Concurrent;
using System.Runtime.CompilerServices;

namespace Functions.Runtime
{
    public class AssemblyManager
    {
        private readonly ConcurrentDictionary<string, WeakReference<CollectibleAssemblyLoadContext>> _contexts = new();
        private readonly ConcurrentDictionary<string, FunctionMetadata> _metadata = new();

        /// <summary>
        /// Load a function assembly. Uses [MethodImpl] to prevent stack references
        /// that would block unloading.
        /// </summary>
        [MethodImpl(MethodImplOptions.NoInlining)]
        public LoadResult LoadAssembly(string functionId, byte[] assemblyBytes, byte[]? symbolBytes = null)
        {
            // Unload existing version first
            if (_contexts.ContainsKey(functionId))
            {
                var unloadResult = UnloadAssembly(functionId);
                if (!unloadResult.Success)
                {
                    return new LoadResult { Success = false, Error = "Failed to unload existing assembly" };
                }
            }

            var alc = new CollectibleAssemblyLoadContext(functionId);

            try
            {
                using var assemblyStream = new MemoryStream(assemblyBytes);
                using var symbolStream = symbolBytes != null ? new MemoryStream(symbolBytes) : null;

                var assembly = symbolStream != null
                    ? alc.LoadFromStream(assemblyStream, symbolStream)
                    : alc.LoadFromStream(assemblyStream);

                // Discover the function entry point
                var entryType = DiscoverEntryType(assembly);
                if (entryType == null)
                {
                    alc.Unload();
                    return new LoadResult { Success = false, Error = "No IFunctionHandler implementation found" };
                }

                _contexts[functionId] = new WeakReference<CollectibleAssemblyLoadContext>(alc);
                _metadata[functionId] = new FunctionMetadata
                {
                    FunctionId = functionId,
                    AssemblyName = assembly.GetName().Name ?? functionId,
                    EntryTypeName = entryType.FullName!,
                    LoadedAt = DateTime.UtcNow,
                    Version = assembly.GetName().Version?.ToString() ?? "1.0.0"
                };

                return new LoadResult
                {
                    Success = true,
                    Metadata = _metadata[functionId]
                };
            }
            catch (Exception ex)
            {
                alc.Unload();
                return new LoadResult { Success = false, Error = ex.Message };
            }
        }

        /// <summary>
        /// Unload a function assembly. Forces GC to ensure complete cleanup.
        /// </summary>
        [MethodImpl(MethodImplOptions.NoInlining)]
        public UnloadResult UnloadAssembly(string functionId)
        {
            if (!_contexts.TryRemove(functionId, out var weakRef))
            {
                return new UnloadResult { Success = false, Error = "Function not loaded" };
            }

            _metadata.TryRemove(functionId, out _);

            if (weakRef.TryGetTarget(out var alc))
            {
                alc.Unload();
            }

            // Force garbage collection
            var unloaded = WaitForUnload(weakRef, timeout: TimeSpan.FromSeconds(10));

            return new UnloadResult
            {
                Success = unloaded,
                Error = unloaded ? null : "Timeout waiting for unload - references may still exist"
            };
        }

        private bool WaitForUnload(WeakReference<CollectibleAssemblyLoadContext> weakRef, TimeSpan timeout)
        {
            var deadline = DateTime.UtcNow + timeout;

            while (DateTime.UtcNow < deadline)
            {
                GC.Collect();
                GC.WaitForPendingFinalizers();

                if (!weakRef.TryGetTarget(out _))
                {
                    return true;
                }

                Thread.Sleep(100);
            }

            return !weakRef.TryGetTarget(out _);
        }

        private Type? DiscoverEntryType(Assembly assembly)
        {
            return assembly.GetTypes()
                .FirstOrDefault(t =>
                    !t.IsAbstract &&
                    !t.IsInterface &&
                    typeof(IFunctionHandler).IsAssignableFrom(t));
        }

        public IEnumerable<FunctionMetadata> GetLoadedFunctions()
        {
            return _metadata.Values;
        }
    }

    public record LoadResult
    {
        public bool Success { get; init; }
        public string? Error { get; init; }
        public FunctionMetadata? Metadata { get; init; }
    }

    public record UnloadResult
    {
        public bool Success { get; init; }
        public string? Error { get; init; }
    }

    public record FunctionMetadata
    {
        public required string FunctionId { get; init; }
        public required string AssemblyName { get; init; }
        public required string EntryTypeName { get; init; }
        public DateTime LoadedAt { get; init; }
        public required string Version { get; init; }
    }
}
```

---

## 6. Inter-Process Communication Options

### 6.1 Unix Domain Sockets with gRPC

For scenarios where the .NET runtime runs as a separate process, gRPC over Unix domain sockets provides high-performance IPC.

```csharp
// GrpcRuntimeServer.cs
using Grpc.Core;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Server.Kestrel.Core;

namespace Functions.Runtime
{
    public class GrpcRuntimeServer
    {
        private const string SocketPath = "/tmp/functions-runtime.sock";

        public static WebApplication CreateServer()
        {
            // Clean up existing socket
            if (File.Exists(SocketPath))
            {
                File.Delete(SocketPath);
            }

            var builder = WebApplication.CreateBuilder();

            builder.WebHost.ConfigureKestrel(options =>
            {
                options.ListenUnixSocket(SocketPath, listenOptions =>
                {
                    listenOptions.Protocols = HttpProtocols.Http2;
                });
            });

            builder.Services.AddGrpc();
            builder.Services.AddSingleton<AssemblyManager>();

            var app = builder.Build();
            app.MapGrpcService<FunctionRuntimeService>();

            return app;
        }
    }

    public class FunctionRuntimeService : FunctionRuntime.FunctionRuntimeBase
    {
        private readonly AssemblyManager _assemblyManager;
        private readonly FunctionRouter _router;

        public FunctionRuntimeService(AssemblyManager assemblyManager)
        {
            _assemblyManager = assemblyManager;
            _router = new FunctionRouter(assemblyManager);
        }

        public override async Task<ExecuteResponse> Execute(
            ExecuteRequest request,
            ServerCallContext context)
        {
            try
            {
                var result = await _router.ExecuteAsync(
                    request.FunctionId,
                    request.Payload.ToByteArray()
                );

                return new ExecuteResponse
                {
                    Success = true,
                    Result = Google.Protobuf.ByteString.CopyFrom(result)
                };
            }
            catch (Exception ex)
            {
                return new ExecuteResponse
                {
                    Success = false,
                    Error = ex.Message
                };
            }
        }

        public override Task<LoadAssemblyResponse> LoadAssembly(
            LoadAssemblyRequest request,
            ServerCallContext context)
        {
            var result = _assemblyManager.LoadAssembly(
                request.FunctionId,
                request.AssemblyBytes.ToByteArray(),
                request.SymbolBytes?.ToByteArray()
            );

            return Task.FromResult(new LoadAssemblyResponse
            {
                Success = result.Success,
                Error = result.Error ?? ""
            });
        }

        public override Task<UnloadAssemblyResponse> UnloadAssembly(
            UnloadAssemblyRequest request,
            ServerCallContext context)
        {
            var result = _assemblyManager.UnloadAssembly(request.FunctionId);

            return Task.FromResult(new UnloadAssemblyResponse
            {
                Success = result.Success,
                Error = result.Error ?? ""
            });
        }

        public override Task<HealthCheckResponse> HealthCheck(
            HealthCheckRequest request,
            ServerCallContext context)
        {
            var functions = _assemblyManager.GetLoadedFunctions().ToList();

            return Task.FromResult(new HealthCheckResponse
            {
                Status = "healthy",
                LoadedFunctions = functions.Count,
                MemoryUsageMb = GC.GetTotalMemory(false) / (1024 * 1024)
            });
        }
    }
}
```

### 6.2 Protocol Buffer Definition

```protobuf
// function_runtime.proto
syntax = "proto3";

package functions.runtime;

service FunctionRuntime {
  rpc Execute(ExecuteRequest) returns (ExecuteResponse);
  rpc LoadAssembly(LoadAssemblyRequest) returns (LoadAssemblyResponse);
  rpc UnloadAssembly(UnloadAssemblyRequest) returns (UnloadAssemblyResponse);
  rpc HealthCheck(HealthCheckRequest) returns (HealthCheckResponse);
}

message ExecuteRequest {
  string function_id = 1;
  bytes payload = 2;
}

message ExecuteResponse {
  bool success = 1;
  bytes result = 2;
  string error = 3;
}

message LoadAssemblyRequest {
  string function_id = 1;
  bytes assembly_bytes = 2;
  bytes symbol_bytes = 3;  // Optional PDB for debugging
}

message LoadAssemblyResponse {
  bool success = 1;
  string error = 2;
}

message UnloadAssemblyRequest {
  string function_id = 1;
}

message UnloadAssemblyResponse {
  bool success = 1;
  string error = 2;
}

message HealthCheckRequest {}

message HealthCheckResponse {
  string status = 1;
  int32 loaded_functions = 2;
  int64 memory_usage_mb = 3;
}
```

### 6.3 Client Connection Factory

```csharp
// RuntimeClient.cs
using System.Net.Sockets;
using Grpc.Net.Client;

namespace Functions.Runtime.Client
{
    public class RuntimeClient : IDisposable
    {
        private const string SocketPath = "/tmp/functions-runtime.sock";
        private readonly GrpcChannel _channel;
        private readonly FunctionRuntime.FunctionRuntimeClient _client;

        public RuntimeClient()
        {
            var socketsHttpHandler = new SocketsHttpHandler
            {
                ConnectCallback = async (context, cancellationToken) =>
                {
                    var socket = new Socket(
                        AddressFamily.Unix,
                        SocketType.Stream,
                        ProtocolType.Unspecified);

                    var endpoint = new UnixDomainSocketEndPoint(SocketPath);
                    await socket.ConnectAsync(endpoint, cancellationToken);

                    return new NetworkStream(socket, ownsSocket: true);
                }
            };

            _channel = GrpcChannel.ForAddress("http://localhost", new GrpcChannelOptions
            {
                HttpHandler = socketsHttpHandler
            });

            _client = new FunctionRuntime.FunctionRuntimeClient(_channel);
        }

        public async Task<byte[]> ExecuteAsync(string functionId, byte[] payload)
        {
            var response = await _client.ExecuteAsync(new ExecuteRequest
            {
                FunctionId = functionId,
                Payload = Google.Protobuf.ByteString.CopyFrom(payload)
            });

            if (!response.Success)
            {
                throw new Exception(response.Error);
            }

            return response.Result.ToByteArray();
        }

        public async Task<bool> LoadAssemblyAsync(string functionId, byte[] assemblyBytes)
        {
            var response = await _client.LoadAssemblyAsync(new LoadAssemblyRequest
            {
                FunctionId = functionId,
                AssemblyBytes = Google.Protobuf.ByteString.CopyFrom(assemblyBytes)
            });

            return response.Success;
        }

        public void Dispose()
        {
            _channel.Dispose();
        }
    }
}
```

---

## 7. Performance Considerations

### 7.1 Latency Comparison

| Communication Method | Typical Latency | Use Case |
|---------------------|-----------------|----------|
| Service Binding (same thread) | ~0-10 us | Ideal for Workers |
| Unix Domain Socket (gRPC) | ~100 us | Cross-process on same machine |
| Named Pipes (Windows) | ~100 us | Windows-specific IPC |
| TCP loopback (gRPC) | ~500-1000 us | Development/debugging |

### 7.2 Memory Considerations

```csharp
// Memory monitoring for the runtime
public class RuntimeMetrics
{
    public static RuntimeStats GetStats()
    {
        var gcInfo = GC.GetGCMemoryInfo();

        return new RuntimeStats
        {
            // Total managed memory
            TotalManagedMemory = GC.GetTotalMemory(forceFullCollection: false),

            // Heap sizes by generation
            Gen0Size = gcInfo.GenerationInfo[0].SizeAfterBytes,
            Gen1Size = gcInfo.GenerationInfo[1].SizeAfterBytes,
            Gen2Size = gcInfo.GenerationInfo[2].SizeAfterBytes,
            LOHSize = gcInfo.GenerationInfo[3].SizeAfterBytes,

            // GC stats
            Gen0Collections = GC.CollectionCount(0),
            Gen1Collections = GC.CollectionCount(1),
            Gen2Collections = GC.CollectionCount(2),

            // Memory pressure
            MemoryLoadPercentage = (int)(gcInfo.MemoryLoadBytes * 100 / gcInfo.HighMemoryLoadThresholdBytes),

            // Loaded assemblies (excluding shared framework)
            LoadedAssemblyContexts = AssemblyLoadContext.All.Count()
        };
    }
}

public record RuntimeStats
{
    public long TotalManagedMemory { get; init; }
    public long Gen0Size { get; init; }
    public long Gen1Size { get; init; }
    public long Gen2Size { get; init; }
    public long LOHSize { get; init; }
    public int Gen0Collections { get; init; }
    public int Gen1Collections { get; init; }
    public int Gen2Collections { get; init; }
    public int MemoryLoadPercentage { get; init; }
    public int LoadedAssemblyContexts { get; init; }
}
```

### 7.3 Cold Start Optimization

```csharp
// Prewarming strategy for frequently-used functions
public class FunctionPrewarmer
{
    private readonly AssemblyManager _assemblyManager;
    private readonly ConcurrentDictionary<string, DateTime> _lastAccess = new();

    public async Task PrewarmTopFunctionsAsync(int count = 10)
    {
        var topFunctions = _lastAccess
            .OrderByDescending(kv => kv.Value)
            .Take(count)
            .Select(kv => kv.Key);

        foreach (var functionId in topFunctions)
        {
            // Touch the function to ensure it's in memory
            await EnsureLoadedAsync(functionId);
        }
    }

    public void RecordAccess(string functionId)
    {
        _lastAccess[functionId] = DateTime.UtcNow;
    }

    private async Task EnsureLoadedAsync(string functionId)
    {
        // Implementation depends on your storage backend
        // This would fetch assembly bytes and call LoadAssembly if needed
    }
}
```

### 7.4 JIT Optimization

```csharp
// ReadyToRun (R2R) compilation for faster startup
// In the function's .csproj:
/*
<PropertyGroup>
    <PublishReadyToRun>true</PublishReadyToRun>
    <PublishReadyToRunShowWarnings>true</PublishReadyToRunShowWarnings>
</PropertyGroup>
*/

// Tiered compilation configuration
public static class JitConfiguration
{
    public static void OptimizeForServerWorkload()
    {
        // These are typically set via environment variables:
        // DOTNET_TieredCompilation=1 (default)
        // DOTNET_TC_QuickJitForLoops=1
        // DOTNET_ReadyToRun=1

        // For long-running server, enable aggressive tiering
        Environment.SetEnvironmentVariable("DOTNET_TC_AggressiveTiering", "1");
    }
}
```

---

## 8. Risks and Mitigations

### 8.1 Risk Matrix

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Memory leaks from failed unloads | High | Medium | WeakReference tracking, forced GC, timeout monitoring |
| Single runtime failure affects all functions | Critical | Low | Health checks, automatic restart, blue-green deployment |
| Assembly version conflicts | Medium | Medium | Isolated ALCs per function, explicit dependency resolution |
| JIT warmup latency | Medium | High | ReadyToRun compilation, prewarm popular functions |
| Runaway function consuming resources | High | Medium | CPU/memory limits per ALC, execution timeouts |

### 8.2 Detailed Mitigations

#### Memory Leak Prevention

```csharp
// Periodic health check to detect stuck ALCs
public class AlcHealthMonitor
{
    private readonly Dictionary<string, WeakReference<CollectibleAssemblyLoadContext>> _references = new();

    public void Track(string id, CollectibleAssemblyLoadContext alc)
    {
        _references[id] = new WeakReference<CollectibleAssemblyLoadContext>(alc);
    }

    public List<string> GetLeakedContexts()
    {
        var leaked = new List<string>();
        var toRemove = new List<string>();

        foreach (var (id, weakRef) in _references)
        {
            if (weakRef.TryGetTarget(out var alc))
            {
                // Check if this ALC should have been unloaded
                // (e.g., unload was requested but it's still alive)
                if (alc.IsCollectible && ShouldHaveBeenUnloaded(id))
                {
                    leaked.Add(id);
                }
            }
            else
            {
                toRemove.Add(id);
            }
        }

        // Clean up collected references
        foreach (var id in toRemove)
        {
            _references.Remove(id);
        }

        return leaked;
    }

    private bool ShouldHaveBeenUnloaded(string id)
    {
        // Check against your unload request tracking
        return false; // Implementation depends on your tracking
    }
}
```

#### Execution Timeout

```csharp
// Timeout wrapper for function execution
public class TimeoutExecutor
{
    public async Task<T> ExecuteWithTimeoutAsync<T>(
        Func<CancellationToken, Task<T>> operation,
        TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);

        try
        {
            return await operation(cts.Token);
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested)
        {
            throw new TimeoutException($"Function execution exceeded {timeout.TotalSeconds}s timeout");
        }
    }
}
```

#### Resource Limits

```csharp
// Resource limiter per function context
public class ResourceLimiter
{
    private readonly ConcurrentDictionary<string, ResourceUsage> _usage = new();

    public bool CheckMemoryLimit(string functionId, long maxBytes)
    {
        // Note: This is approximate - .NET doesn't provide per-ALC memory tracking
        // Consider using memory pressure callbacks for more accurate limits
        var currentUsage = GC.GetTotalMemory(false);
        return currentUsage < maxBytes;
    }

    public void EnforceTimeLimit(string functionId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
    }
}

public record ResourceUsage
{
    public long AllocatedBytes { get; set; }
    public TimeSpan CpuTime { get; set; }
    public int InvocationCount { get; set; }
}
```

### 8.3 Failure Recovery

```csharp
// Automatic recovery for runtime failures
public class RuntimeSupervisor
{
    private readonly Process? _runtimeProcess;
    private readonly TimeSpan _healthCheckInterval = TimeSpan.FromSeconds(30);

    public async Task SuperviseAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(_healthCheckInterval, cancellationToken);

                var health = await PerformHealthCheckAsync();

                if (!health.IsHealthy)
                {
                    await HandleUnhealthyStateAsync(health);
                }
            }
            catch (Exception ex)
            {
                // Log and continue
                Console.Error.WriteLine($"Health check failed: {ex.Message}");
            }
        }
    }

    private async Task<HealthStatus> PerformHealthCheckAsync()
    {
        // Implementation: ping the runtime, check memory, verify loaded functions
        return new HealthStatus { IsHealthy = true };
    }

    private async Task HandleUnhealthyStateAsync(HealthStatus status)
    {
        // Options:
        // 1. Force GC if memory pressure
        // 2. Unload stale ALCs
        // 3. Restart the runtime process (last resort)

        if (status.MemoryPressureHigh)
        {
            GC.Collect(2, GCCollectionMode.Aggressive, blocking: true);
        }
    }
}

public record HealthStatus
{
    public bool IsHealthy { get; init; }
    public bool MemoryPressureHigh { get; init; }
    public List<string> FailedFunctions { get; init; } = new();
}
```

---

## 9. References

### Cloudflare Documentation

- [Service Bindings - RPC (WorkerEntrypoint)](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/) - Worker-to-Worker communication with zero-latency RPC
- [Dynamic Worker Loaders](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/) - Loading isolates dynamically at runtime
- [Remote-procedure call (RPC)](https://developers.cloudflare.com/workers/runtime-apis/rpc/) - JavaScript-native RPC built on Cap'n Proto
- [How Workers Works](https://developers.cloudflare.com/workers/reference/how-workers-works/) - V8 isolates and the Workers runtime architecture

### .NET Documentation

- [How to use and debug assembly unloadability in .NET](https://learn.microsoft.com/en-us/dotnet/standard/assembly/unloadability) - AssemblyLoadContext collectible assemblies
- [About AssemblyLoadContext](https://learn.microsoft.com/en-us/dotnet/core/dependency-loading/understanding-assemblyloadcontext) - Understanding the assembly loading model
- [Write a custom .NET runtime host](https://learn.microsoft.com/en-us/dotnet/core/tutorials/netcore-hosting) - Hosting CLR from native code
- [Inter-process communication with gRPC](https://learn.microsoft.com/en-us/aspnet/core/grpc/interprocess?view=aspnetcore-9.0) - High-performance IPC options

### Sample Code Repositories

- [.NET Hosting Sample](https://github.com/dotnet/samples/tree/main/core/hosting) - Native hosting examples
- [Assembly Unloading Sample](https://github.com/dotnet/samples/tree/main/core/tutorials/Unloading) - Collectible ALC examples
- [Cloudflare JS-RPC Demo](https://github.com/cloudflare/js-rpc-and-entrypoints-demo) - Service binding patterns

---

## Next Steps

1. **Prototype the native host** - Build a minimal CLR host that can load/unload assemblies
2. **Implement gRPC server** - Create the IPC layer for cross-process communication
3. **Build the thin stub** - Create a TypeScript Worker that routes to the runtime
4. **Load testing** - Measure latency, throughput, and memory characteristics
5. **Hot reload testing** - Verify assemblies unload cleanly under various conditions
6. **Security review** - Ensure proper isolation between user functions

---

*Document Version: 1.0*
*Last Updated: 2026-01-12*
