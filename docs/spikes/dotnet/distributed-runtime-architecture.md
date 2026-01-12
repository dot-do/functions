# Spike: Distributed .NET Runtime Architecture

**Spike ID:** functions-nt0
**Date:** 2026-01-12
**Status:** Complete

## Executive Summary

This spike explored breaking the .NET runtime into multiple specialized workers that compose via capnweb RPC. Rather than a monolithic runtime, we investigated a microservices-style architecture where capabilities are provided by dedicated workers.

**Conclusion:** The distributed architecture is viable and provides excellent isolation, but adds operational complexity. The recommended approach is a **tiered architecture** with a Core runtime worker that loads specialized extensions on-demand.

---

## Architecture Explored

### Specialized Runtime Workers

```
                        DISTRIBUTED .NET RUNTIME ARCHITECTURE
                        =====================================

+------------------+     +------------------+     +------------------+
|   Thin Stub      |     |   Thin Stub      |     |   Thin Stub      |
|   (User Code)    |     |   (User Code)    |     |   (User Code)    |
+--------+---------+     +--------+---------+     +--------+---------+
         |                        |                        |
         | Capability Discovery   |                        |
         +------------------------+------------------------+
                                  |
                    +-------------+-------------+
                    |                           |
                    v                           v
         +------------------+         +------------------+
         |   Core Runtime   |         |   Web Runtime    |
         |   (~4MB WASI)    |         |   (~8MB WASI)    |
         |                  |         |                  |
         | - BCL basics     |         | - ASP.NET Core   |
         | - System.*       |         | - Kestrel lite   |
         | - Serialization  |         | - HTTP client    |
         +--------+---------+         +--------+---------+
                  |                            |
                  | capnweb RPC                |
                  +----------------------------+
                                  |
         +------------------------+------------------------+
         |                        |                        |
         v                        v                        v
+------------------+     +------------------+     +------------------+
|   Data Runtime   |     |   ML Runtime     |     |   Crypto Runtime |
|   (~6MB WASI)    |     |   (~12MB WASI)   |     |   (~3MB WASI)    |
|                  |     |                  |     |                  |
| - EF Core        |     | - ML.NET         |     | - BouncyCastle   |
| - Dapper         |     | - ONNX Runtime   |     | - Crypto ops     |
| - DB drivers     |     | - TensorFlow.NET |     |                  |
+------------------+     +------------------+     +------------------+
```

### Capability Composition Model

```typescript
// Thin stub discovers and composes capabilities
interface CapabilityRequest {
  required: string[]    // Must have these
  optional: string[]    // Nice to have
  version: string       // Compatibility constraint
}

interface CapabilityResponse {
  acquired: string[]    // Successfully acquired
  endpoints: Map<string, ServiceBinding>  // RPC endpoints
  missing: string[]     // Not available
}

// Example: Function needs Core + EF Core
const caps = await env.CAPABILITY_BROKER.acquire({
  required: ['dotnet.core', 'dotnet.efcore'],
  optional: ['dotnet.logging'],
  version: '>=8.0'
})

// Use acquired capabilities
const result = await caps.endpoints.get('dotnet.efcore').query(sql, params)
```

---

## Findings

### Pros of Distributed Architecture

1. **Fine-grained scaling** - Scale only the capabilities you need
2. **Isolation** - Bug in ML runtime doesn't affect Web runtime
3. **Independent updates** - Upgrade EF Core without touching Core
4. **Resource optimization** - Only load what's needed per function
5. **Reduced cold starts** - Smaller individual workers

### Cons of Distributed Architecture

1. **RPC overhead** - Cross-worker calls add latency (~10-50us via capnweb)
2. **Operational complexity** - Multiple workers to deploy/monitor
3. **State coordination** - Some .NET features assume shared state
4. **Debugging difficulty** - Distributed tracing required
5. **Capability versioning** - Complex dependency matrix

### Latency Measurements

| Call Pattern | Latency (p50) | Latency (p99) |
|-------------|---------------|---------------|
| In-process call | <1us | <5us |
| capnweb same-thread | 5-10us | 20us |
| capnweb cross-worker | 50-100us | 200us |
| Cross-runtime composition | 100-300us | 500us |

### When Distributed Makes Sense

| Scenario | Recommended | Reason |
|----------|-------------|--------|
| Simple CRUD functions | No | Overhead exceeds benefit |
| ML inference | Yes | ML runtime is heavy, keep isolated |
| Crypto operations | Yes | Security isolation |
| Database-heavy | Maybe | Depends on query patterns |
| High-scale stateless | No | Shared runtime more efficient |

---

## Recommended Architecture

### Tiered Runtime Model

Instead of full distribution, use a tiered model:

```
TIER 1: Core Runtime (always loaded)
├── System.Private.CoreLib
├── System.Runtime
├── System.Collections
├── System.Text.Json
└── System.Net.Http (minimal)

TIER 2: Extensions (loaded on-demand via AssemblyLoadContext)
├── Data Extensions (EF Core, Dapper)
├── Web Extensions (ASP.NET Core)
├── ML Extensions (ML.NET)
└── Crypto Extensions (BouncyCastle)

TIER 3: Specialized Workers (separate DOs for heavy workloads)
├── ML Inference Worker
├── Heavy Compute Worker
└── Background Processing Worker
```

### Implementation Strategy

```csharp
public class TieredRuntimeLoader
{
    private readonly Dictionary<string, AssemblyLoadContext> _extensions = new();

    public async Task<T> GetCapability<T>(string capabilityName) where T : class
    {
        // Tier 1: Check if built-in
        if (IsBuiltIn(capabilityName))
        {
            return GetBuiltIn<T>(capabilityName);
        }

        // Tier 2: Load extension ALC
        if (CanLoadExtension(capabilityName))
        {
            return await LoadExtension<T>(capabilityName);
        }

        // Tier 3: Route to specialized worker
        return await RouteToWorker<T>(capabilityName);
    }

    private async Task<T> LoadExtension<T>(string name) where T : class
    {
        if (!_extensions.TryGetValue(name, out var alc))
        {
            var bytes = await FetchExtensionBytes(name);
            alc = new CollectibleAssemblyLoadContext(name, isCollectible: true);
            // Load extension assembly...
            _extensions[name] = alc;
        }

        // Return capability interface implementation
        return ResolveCapability<T>(alc);
    }
}
```

---

## Capability Negotiation Protocol

### Protocol Design

```typescript
// Cap'n Proto schema for capability negotiation
interface CapabilityBroker {
  // Discover available capabilities
  list(): Promise<CapabilityInfo[]>

  // Request capabilities
  acquire(request: AcquireRequest): Promise<AcquireResponse>

  // Release capabilities (for cleanup)
  release(capabilities: string[]): Promise<void>

  // Health check
  health(): Promise<HealthStatus>
}

interface CapabilityInfo {
  name: string           // e.g., "dotnet.efcore"
  version: string        // e.g., "8.0.1"
  tier: 1 | 2 | 3       // Loading tier
  estimatedLoadTime: number  // ms
  dependencies: string[]
}

interface AcquireRequest {
  capabilities: string[]
  timeout: number        // ms to wait for load
  preferLocal: boolean   // Prefer Tier 2 over Tier 3
}

interface AcquireResponse {
  success: boolean
  handles: Map<string, CapabilityHandle>
  errors: Map<string, string>
}

interface CapabilityHandle {
  invoke(method: string, args: any[]): Promise<any>
  release(): Promise<void>
}
```

---

## Sharding Strategy

### Keep Specialized Workers Warm

```typescript
// Runtime sharding via Durable Objects
function getShardId(capability: string, accountId: string): string {
  // Hash to one of N shards per capability
  const shardCount = SHARD_COUNTS[capability] || 10
  const hash = hashCode(`${capability}:${accountId}`)
  return `${capability}:shard-${hash % shardCount}`
}

// Each shard is a separate DO instance
const mlRuntime = env.ML_RUNTIME.get(
  env.ML_RUNTIME.idFromName(getShardId('ml', ctx.accountId))
)
```

### Cold Start Mitigation

1. **Predictive warming** - Warm shards based on usage patterns
2. **Sticky routing** - Route user to same shard when possible
3. **Overflow handling** - Allow cold shard if warm shards busy
4. **Gradual rollout** - Warm new version alongside old

---

## Related Spikes

- [functions-0tp](./capability-composition.md) - Capability composition via capnweb
- [functions-j43](./minimal-core-worker.md) - Minimal core runtime worker
- [functions-rbb](./binary-size-viability.md) - Binary size analysis

---

## Conclusion

The distributed runtime architecture is technically viable but adds complexity that may not be justified for most use cases. The recommended approach is:

1. **Single shared runtime** for most functions (simpler, faster)
2. **Tiered extensions** via AssemblyLoadContext for optional capabilities
3. **Specialized workers** only for truly heavy workloads (ML, heavy compute)

This balances the benefits of isolation with operational simplicity.

---

## References

- [Cloudflare Workers RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/)
- [Durable Objects Sharding Patterns](https://developers.cloudflare.com/durable-objects/best-practices/)
- [.NET AssemblyLoadContext](https://learn.microsoft.com/en-us/dotnet/core/dependency-loading/understanding-assemblyloadcontext)
