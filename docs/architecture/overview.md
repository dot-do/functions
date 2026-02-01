# Functions.do Architecture Overview

This document provides a comprehensive overview of the Functions.do platform architecture, including request flows, the 4-tier cascade system, storage layers, and Worker/Durable Object architecture.

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Request Flow](#request-flow)
   - [Deploy Flow](#deploy-flow)
   - [Invoke Flow](#invoke-flow)
3. [4-Tier Cascade System](#4-tier-cascade-system)
4. [Storage Layers](#storage-layers)
5. [Worker/Durable Object Architecture](#workerdurable-object-architecture)
6. [Distributed Runtime Architecture](#distributed-runtime-architecture)

---

## High-Level Architecture

Functions.do is a serverless function platform built on Cloudflare Workers that supports multiple programming languages (TypeScript, Rust, Python, Go, C#, Zig, AssemblyScript) with zero cold starts through a distributed runtime architecture.

```mermaid
flowchart TB
    subgraph Client["Client Layer"]
        CLI["func CLI"]
        SDK["Functions SDK"]
        API["REST API"]
    end

    subgraph Edge["Cloudflare Edge (300+ locations)"]
        Router["API Router Worker"]
        Loader["Worker Loader"]

        subgraph DO["Durable Objects"]
            Executor["Function Executor DO"]
            Logs["Function Logs DO"]
            Runtime["Language Runtime DO"]
        end
    end

    subgraph Storage["Storage Layer"]
        KV["Cloudflare KV\n(Metadata + Code)"]
        R2["Cloudflare R2\n(Large Assets)"]
        Hybrid["Hybrid Storage\n(KV + R2)"]
    end

    subgraph Runtimes["Language Runtimes"]
        ESM["ESM (TypeScript/JS)"]
        WASM["WebAssembly\n(Rust/Go/Zig)"]
        Pyodide["Pyodide\n(Python)"]
        DotNet[".NET Runtime\n(C#)"]
    end

    CLI --> Router
    SDK --> Router
    API --> Router

    Router --> Loader
    Router --> DO

    Loader --> DO

    Executor --> Storage
    Executor --> Runtimes

    Logs --> KV
    Runtime --> Runtimes
```

---

## Request Flow

### Deploy Flow

The deploy flow handles function deployment including compilation, storage, and registration.

```mermaid
sequenceDiagram
    participant Client
    participant Router as API Router
    participant Compiler as Language Compiler
    participant Storage as Hybrid Storage
    participant Registry as Function Registry
    participant Cache as Function Cache

    Client->>Router: POST /deploy
    Note over Router: Validate auth & request

    Router->>Compiler: Compile source code

    alt TypeScript
        Compiler->>Compiler: esbuild -> ESM bundle
    else Rust/Go/Zig
        Compiler->>Compiler: Compile -> WASM binary
    else Python
        Compiler->>Compiler: Bundle with Pyodide bindings
    else C#
        Compiler->>Compiler: Roslyn compile + stub generation
    end

    Compiler-->>Router: Compiled code + source map

    par Store code and register
        Router->>Storage: Store compiled code
        Storage->>Storage: Write to R2 (primary)
        Storage->>Storage: Optionally write to KV (legacy)
    and
        Router->>Registry: Register function metadata
        Registry->>KV: Store metadata
    end

    Router->>Cache: Invalidate cached version

    Router-->>Client: 200 OK + function info
```

### Invoke Flow

The invoke flow handles function execution with the cascade system for intelligent escalation.

```mermaid
sequenceDiagram
    participant Client
    participant Router as API Router
    participant Loader as Function Loader
    participant Cache as LRU Cache
    participant Storage as Code Storage
    participant DO as Executor DO
    participant CB as Circuit Breaker

    Client->>Router: POST /invoke/{functionId}
    Note over Router: Validate auth & rate limit

    Router->>Loader: Load function

    alt Cache Hit
        Loader->>Cache: Get cached stub
        Cache-->>Loader: Return stub
    else Cache Miss
        Loader->>CB: Check circuit breaker

        alt Circuit Open
            CB-->>Loader: Reject (fast fail)
            Loader-->>Router: Error response
        else Circuit Closed/Half-Open
            Loader->>Storage: Fetch code
            Storage-->>Loader: Return code

            Loader->>Loader: Evaluate module
            Loader->>Cache: Cache stub (LRU)

            alt Success
                Loader->>CB: Record success
            else Failure
                Loader->>CB: Record failure
            end
        end
    end

    Loader-->>Router: Return stub

    Router->>DO: Execute function

    Note over DO: Isolated V8 context
    DO->>DO: Run with timeout
    DO->>DO: Capture console output
    DO->>DO: Collect metrics

    DO-->>Router: Execution result
    Router-->>Client: Response + metrics
```

---

## 4-Tier Cascade System

The cascade system provides automatic escalation through tiers of increasing capability, ensuring reliable execution even when simpler approaches fail.

```mermaid
flowchart TB
    subgraph Cascade["Cascade Execution"]
        direction TB

        Input["Input Request"]

        subgraph T1["Tier 1: Code"]
            Code["Deterministic Code\n(ESM/WASM)"]
            CodeTimeout["Timeout: 30s"]
        end

        subgraph T2["Tier 2: Generative"]
            Gen["AI-Generated Response\n(LLM inference)"]
            GenTimeout["Timeout: 60s"]
        end

        subgraph T3["Tier 3: Agentic"]
            Agent["AI Agent\n(Multi-step reasoning)"]
            AgentTimeout["Timeout: 300s"]
        end

        subgraph T4["Tier 4: Human"]
            Human["Human Review\n(Manual intervention)"]
            HumanTimeout["Timeout: 24h"]
        end

        Output["Result"]

        Input --> Code
        Code -->|Success| Output
        Code -->|Failure/Timeout| Gen
        Gen -->|Success| Output
        Gen -->|Failure/Timeout| Agent
        Agent -->|Success| Output
        Agent -->|Failure/Timeout| Human
        Human --> Output
    end

    style T1 fill:#90EE90
    style T2 fill:#87CEEB
    style T3 fill:#DDA0DD
    style T4 fill:#FFB6C1
```

### Cascade Execution Details

```mermaid
flowchart LR
    subgraph Options["Cascade Options"]
        StartTier["startTier: 'code'"]
        SkipTiers["skipTiers: []"]
        Retries["tierRetries: {code: 3}"]
        Timeouts["tierTimeouts: {...}"]
        Parallel["enableParallel: false"]
        Fallback["enableFallback: true"]
    end

    subgraph Execution["Execution Flow"]
        direction TB

        CheckSkip{Skip tier?}
        CheckTimeout{Timed out?}
        CheckRetry{Retries left?}
        Execute["Execute tier handler"]
        Success["Return result"]
        NextTier["Escalate to next tier"]
        Exhausted["CascadeExhaustedError"]

        CheckSkip -->|Yes| NextTier
        CheckSkip -->|No| Execute
        Execute -->|Success| Success
        Execute -->|Failure| CheckRetry
        CheckRetry -->|Yes| Execute
        CheckRetry -->|No| CheckTimeout
        CheckTimeout -->|Yes| NextTier
        CheckTimeout -->|No| NextTier
        NextTier -->|More tiers| CheckSkip
        NextTier -->|No more tiers| Exhausted
    end

    Options --> Execution
```

---

## Storage Layers

Functions.do uses a hybrid storage architecture that leverages both Cloudflare KV and R2 for optimal performance and cost efficiency.

```mermaid
flowchart TB
    subgraph HybridStorage["Hybrid Code Storage"]
        direction TB

        Read["Read Request"]
        Write["Write Request"]

        subgraph R2Layer["R2 Storage (Primary)"]
            R2["Cloudflare R2"]
            R2Code["function-id/code.js"]
            R2Map["function-id/code.js.map"]
            R2Compiled["function-id/compiled.js"]
            R2WASM["function-id/module.wasm"]
        end

        subgraph KVLayer["KV Storage (Legacy/Fallback)"]
            KV["Cloudflare KV"]
            KVCode["code:{functionId}"]
            KVMap["sourcemap:{functionId}"]
            KVMeta["meta:{functionId}"]
        end

        subgraph Config["Storage Options"]
            PreferR2["preferR2: true"]
            WriteR2["writeToR2: true"]
            AutoMigrate["autoMigrate: false"]
        end
    end

    Read -->|preferR2=true| R2
    R2 -->|Hit| Return["Return code"]
    R2 -->|Miss| KV
    KV -->|Hit + autoMigrate| MigrateToR2["Copy to R2"]
    KV -->|Hit| Return

    Write -->|writeToR2=true| R2
    Write -->|writeToR2=false| KV

    style R2Layer fill:#E8F5E9
    style KVLayer fill:#FFF3E0
```

### Storage Migration Flow

```mermaid
sequenceDiagram
    participant Admin
    participant Hybrid as Hybrid Storage
    participant KV as KV Storage
    participant R2 as R2 Storage

    Admin->>Hybrid: migrateFunction(id, version)

    Hybrid->>R2: Check if exists

    alt Already in R2
        R2-->>Hybrid: Exists
        Hybrid-->>Admin: Status: migrated
    else Not in R2
        Hybrid->>KV: Get code
        KV-->>Hybrid: Return code

        Hybrid->>R2: Put code

        Hybrid->>KV: Get source map
        alt Source map exists
            KV-->>Hybrid: Return source map
            Hybrid->>R2: Put source map
        end

        Hybrid-->>Admin: Status: migrated
    end

    Note over Admin,R2: After verification, cleanup KV
    Admin->>Hybrid: cleanupKV(id, version)
    Hybrid->>R2: Verify exists
    R2-->>Hybrid: Confirmed
    Hybrid->>KV: Delete old entries
```

---

## Worker/Durable Object Architecture

The platform uses Cloudflare Workers for edge routing and Durable Objects for stateful execution with strong consistency.

```mermaid
flowchart TB
    subgraph Workers["Stateless Workers"]
        Router["API Router\n(Entry point)"]
        Loader["Worker Loader\n(Dynamic loading)"]
        Compiler["Compiler Worker\n(Build pipeline)"]
    end

    subgraph DurableObjects["Durable Objects"]
        subgraph ExecutorDO["Function Executor DO"]
            Executor["Execution Engine"]
            Queue["Execution Queue"]
            Metrics["Metrics Cache"]
            SQLite["SQLite Storage\n(Execution logs)"]
        end

        subgraph LogsDO["Function Logs DO"]
            LogAgg["Log Aggregator"]
            LogStore["Log Storage"]
        end

        subgraph RuntimeDO["Language Runtime DO"]
            RuntimeHost["Runtime Host"]
            ALC["AssemblyLoadContext\n(C# dynamic loading)"]
        end
    end

    subgraph Bindings["Service Bindings"]
        SB1["EXECUTOR"]
        SB2["LOGS"]
        SB3["RUNTIME"]
    end

    Router -->|"Service Binding"| SB1
    Router -->|"Service Binding"| SB2

    SB1 --> ExecutorDO
    SB2 --> LogsDO
    SB3 --> RuntimeDO

    Loader -->|"Worker Loader API"| ExecutorDO

    ExecutorDO -->|"RPC (capnweb)"| RuntimeDO

    style ExecutorDO fill:#E3F2FD
    style LogsDO fill:#F3E5F5
    style RuntimeDO fill:#FFF8E1
```

### Function Executor Details

```mermaid
flowchart TB
    subgraph FunctionExecutor["Function Executor Durable Object"]
        direction TB

        subgraph State["State Management"]
            IsWarm["isWarm: boolean"]
            LastExec["lastExecutionTime"]
            LoadedFns["loadedFunctions: Set"]
            ActiveExecs["activeExecutions: Map"]
        end

        subgraph Execution["Execution Pipeline"]
            Receive["Receive Request"]
            CheckQueue{Queue full?}
            CheckConcurrency{At capacity?}
            AddQueue["Add to Queue"]
            Execute["Execute in Isolation"]
            Timeout["Timeout Handler"]
            Abort["Abort Handler"]
        end

        subgraph Persistence["SQLite Persistence"]
            LogStart["persistLogStart()"]
            LogEnd["persistLogEnd()"]
            QueryLogs["getExecutionLogs()"]
            Cleanup["cleanupOldLogs()"]
        end

        subgraph Console["Console Capture"]
            Log["console.log"]
            Warn["console.warn"]
            Error["console.error"]
        end

        Receive --> CheckQueue
        CheckQueue -->|Yes| Reject["Reject: Queue Full"]
        CheckQueue -->|No| CheckConcurrency
        CheckConcurrency -->|Yes| AddQueue
        CheckConcurrency -->|No| Execute
        AddQueue -->|Slot available| Execute

        Execute --> LogStart
        Execute --> Timeout
        Execute --> Console
        Execute --> LogEnd

        LogEnd --> Cleanup
    end
```

---

## Distributed Runtime Architecture

For heavy runtimes (Python/Pyodide, .NET, JVM), Functions.do uses a distributed architecture with thin stubs and shared runtime workers.

```mermaid
flowchart TB
    subgraph ThinStubs["Thin Stub Workers (~KB)"]
        Stub1["User Function A\n(stub only)"]
        Stub2["User Function B\n(stub only)"]
        Stub3["User Function C\n(stub only)"]
    end

    subgraph ServiceBindings["Service Bindings\n(Zero-latency RPC)"]
        SB["capnweb Protocol"]
    end

    subgraph SharedRuntimes["Shared Runtime Workers (~MB)"]
        subgraph DotNetRuntime[".NET Runtime"]
            CLR["CLR Host"]
            ALC1["ALC: Func A"]
            ALC2["ALC: Func B"]
            ALC3["ALC: Func C"]
            JIT["JIT Cache\n(shared)"]
        end

        subgraph PyodideRuntime["Python Runtime"]
            Pyodide["Pyodide Engine\n(~15MB)"]
            VEnv1["venv: Func A"]
            VEnv2["venv: Func B"]
        end

        subgraph MLRuntime["ML Runtime"]
            ONNX["ONNX Runtime"]
            Models["Cached Models"]
        end
    end

    Stub1 -->|RPC| SB
    Stub2 -->|RPC| SB
    Stub3 -->|RPC| SB

    SB --> DotNetRuntime
    SB --> PyodideRuntime
    SB --> MLRuntime

    Note1["Benefits:\n- Single CLR/Pyodide instance\n- JIT cache shared\n- Always warm (99.99%)\n- Zero-latency RPC"]

    style DotNetRuntime fill:#E8F5E9
    style PyodideRuntime fill:#E3F2FD
    style MLRuntime fill:#FFF8E1
```

### RPC Communication Pattern

```mermaid
sequenceDiagram
    participant Client
    participant Stub as Thin Stub Worker
    participant SB as Service Binding
    participant Runtime as Shared Runtime Worker
    participant ALC as AssemblyLoadContext

    Client->>Stub: HTTP Request

    Note over Stub: ~KB footprint

    Stub->>SB: RPC: execute(functionId, payload)

    Note over SB: Zero-copy serialization\n(capnweb/Cap'n Proto)

    SB->>Runtime: Forward RPC

    Note over Runtime: ~MB footprint (shared)

    Runtime->>ALC: Load/get assembly

    alt Cold Start
        ALC->>ALC: Load from storage
        ALC->>ALC: JIT compile
    else Warm
        ALC->>ALC: Return cached
    end

    ALC-->>Runtime: Execute function
    Runtime-->>SB: Return result
    SB-->>Stub: RPC Response
    Stub-->>Client: HTTP Response

    Note over Client,ALC: Total latency: <10ms\n(same-colo, zero network hop)
```

---

## Performance Characteristics

| Component | Latency | Cold Start | Memory |
|-----------|---------|------------|--------|
| ESM (TypeScript) | <5ms | Instant | <50KB |
| WASM (Rust) | <10ms | <10ms | 10-50KB |
| WASM (Go) | <50ms | <50ms | 100KB-2MB |
| Pyodide (Python) | ~100ms | ~1s* | ~15MB |
| .NET (C#) | <50ms | <100ms* | Shared |

*With distributed runtime architecture, cold starts are rare (99.99% warm)

---

## Related Documentation

- [Getting Started](../getting-started.md)
- [API Reference](../api-reference.md)
- [Language Guides](../guides/languages/index.md)
- [Worker RPC Latency Spike](../spikes/worker-rpc-latency.md)
- [WASM Binary Deployment](../spikes/wasm-binary-deployment.md)
- [Capnweb RPC Integration](../spikes/capnweb-rpctarget-worker-loader.md)
- [.NET Shared Runtime](../spikes/dotnet-shared-runtime.md)
