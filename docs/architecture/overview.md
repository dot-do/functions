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
6. [Classifier Architecture](#classifier-architecture)

---

## High-Level Architecture

Functions.do is a serverless function platform built on Cloudflare Workers that supports TypeScript, JavaScript, and Python (beta) with a 4-tier cascade execution system. The platform uses Durable Objects for storage (with KV fallback), Cache API-based classifier caching, and a unified Env type defined at `src/core/env.ts`.

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
            UserStore["User Storage DO"]
            RateLimit["Rate Limiter DO"]
        end
    end

    subgraph Storage["Storage Layer"]
        KV["Cloudflare KV\n(Legacy Fallback)"]
        DOStore["Durable Objects\n(Primary Storage)"]
    end

    subgraph Runtimes["Language Runtimes"]
        ESM["ESM (TypeScript/JS)"]
        Pyodide["Pyodide\n(Python - beta)"]
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

    alt TypeScript/JavaScript
        Compiler->>Compiler: esbuild -> ESM bundle
    else Python
        Compiler->>Compiler: Bundle with Pyodide bindings
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

Functions.do uses Durable Objects (USER_STORAGE) as the primary storage layer, with KV namespaces as a legacy fallback during migration. The unified Env type at `src/core/env.ts` defines all storage bindings.

```mermaid
flowchart TB
    subgraph Storage["Storage Architecture"]
        direction TB

        Read["Read Request"]
        Write["Write Request"]

        subgraph DOLayer["Durable Objects (Primary)"]
            UserStorage["USER_STORAGE DO"]
            DOCode["Per-user isolated storage"]
            DOFunctions["Functions + code + API keys"]
        end

        subgraph KVLayer["KV Storage (Legacy Fallback)"]
            KV["Cloudflare KV"]
            KVRegistry["FUNCTIONS_REGISTRY"]
            KVCode["FUNCTIONS_CODE"]
            KVKeys["FUNCTIONS_API_KEYS"]
        end
    end

    Read -->|Primary| UserStorage
    UserStorage -->|Hit| Return["Return code"]
    UserStorage -->|Miss| KV
    KV -->|Hit| Return

    Write -->|Primary| UserStorage
    Write -->|Legacy fallback| KV

    style DOLayer fill:#E8F5E9
    style KVLayer fill:#FFF3E0
```

### Storage Migration Flow (KV to Durable Objects)

```mermaid
sequenceDiagram
    participant Admin
    participant Storage as Storage Layer
    participant DO as USER_STORAGE DO
    participant KV as KV Storage (Legacy)

    Admin->>Storage: migrateFunction(id, version)

    Storage->>DO: Check if exists

    alt Already in DO
        DO-->>Storage: Exists
        Storage-->>Admin: Status: migrated
    else Not in DO
        Storage->>KV: Get code + metadata
        KV-->>Storage: Return data

        Storage->>DO: Store in user-isolated DO

        Storage-->>Admin: Status: migrated
    end

    Note over Admin,KV: After verification, KV entries can be removed
```

---

## Worker/Durable Object Architecture

The platform uses Cloudflare Workers for edge routing and Durable Objects for stateful execution with strong consistency.

```mermaid
flowchart TB
    subgraph Workers["Stateless Workers"]
        Router["API Router\n(Entry point)"]
        Loader["Worker Loader\n(Dynamic loading)"]
        EsbuildCompiler["esbuild-compiler\n(TypeScript compilation via Service Binding)"]
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

        subgraph UserStorageDO["User Storage DO"]
            StorageHost["Per-user Storage"]
            Functions["Functions + Code"]
            APIKeys["API Keys"]
        end
    end

    subgraph Bindings["Service Bindings"]
        SB1["EXECUTOR"]
        SB2["LOGS"]
        SB3["USER_STORAGE"]
    end

    Router -->|"Service Binding"| SB1
    Router -->|"Service Binding"| SB2

    SB1 --> ExecutorDO
    SB2 --> LogsDO
    SB3 --> UserStorageDO

    Loader -->|"Worker Loader API"| ExecutorDO

    style ExecutorDO fill:#E3F2FD
    style LogsDO fill:#F3E5F5
    style UserStorageDO fill:#FFF8E1
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

## Classifier Architecture

The function classifier uses AI to determine which cascade tier should handle a given function invocation. Classification results are cached using Cloudflare's Cache API for cross-request, cross-isolate caching.

```mermaid
flowchart TB
    subgraph Classifier["Function Classifier"]
        Input["Function name + description"]
        CacheCheck{"Cache API\nhit?"}
        AICall["AI Provider\n(Workers AI primary)"]
        CacheStore["Store in Cache API\n(TTL-based expiration)"]
        Result["Classification Result\n(code|generative|agentic|human)"]
    end

    Input --> CacheCheck
    CacheCheck -->|Hit| Result
    CacheCheck -->|Miss| AICall
    AICall --> CacheStore
    CacheStore --> Result

    style Classifier fill:#E3F2FD
```

### AI Provider Fallback Chain

The classifier supports multiple AI providers with automatic fallback:
1. Cloudflare Workers AI (primary, via binding)
2. OpenRouter
3. Anthropic
4. OpenAI
5. AWS Bedrock

---

## Performance Characteristics

| Component | Latency | Cold Start | Memory |
|-----------|---------|------------|--------|
| ESM (TypeScript/JS) | <5ms | Instant | <50KB |
| Pyodide (Python) | ~100ms | ~1s | ~15MB |

---

## Key Implementation Files

- **Unified Env type**: `src/core/env.ts` - Single source of truth for all Cloudflare Worker bindings
- **Function Classifier**: `src/core/function-classifier.ts` - Cache API-based AI classifier with multi-provider fallback
- **API Router**: `src/api/router.ts` - Request routing with cascade execution support
- **Default invoke path**: Cascade execution (`/v1/cascade/:id`)

## Related Documentation

- [Getting Started](../getting-started.md)
- [API Reference](../api-reference.md)
- [Language Guides](../guides/languages/index.md)
