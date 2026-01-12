# Spike: Runtime Capability Composition via Capnweb

**Spike ID:** functions-0tp
**Date:** 2026-01-12
**Status:** Complete

## Executive Summary

This spike designed how thin function stubs discover and compose multiple runtime workers. The core question: How does a function that needs Core + EF Core acquire both capabilities via capnweb RPC?

**Conclusion:** A capability broker pattern provides clean composition. Stubs declare required capabilities, the broker resolves them to service bindings, and execution proceeds via zero-latency RPC. The protocol supports version constraints, optional capabilities, and graceful degradation.

---

## Design

### Capability Discovery Flow

```
                        CAPABILITY COMPOSITION FLOW
                        ===========================

+------------------+        +--------------------+        +------------------+
|   Thin Stub      |   1    |  Capability Broker |   2    |  Runtime Workers |
|   (User Code)    | -----> |  (Discovery DO)    | -----> |  (Core, EF, ML)  |
+------------------+        +--------------------+        +------------------+
        |                            |                            |
        |   CapabilityRequest:       |   Resolve capabilities     |
        |   - required: [core, ef]   |   to service bindings      |
        |   - optional: [logging]    |                            |
        |   - version: ">=8.0"       |                            |
        |                            |                            |
        |   3. CapabilityResponse:   |                            |
        | <------------------------- |                            |
        |   - handles: {core: h1,    |                            |
        |               ef: h2}      |                            |
        |   - missing: []            |                            |
        |                            |                            |
        |   4. Direct RPC via handles                             |
        | -----------------------------------------------------> |
        |                            |                            |
        |   5. Response                                           |
        | <----------------------------------------------------- |
```

### Capability Manifest Schema

```typescript
// Each runtime worker declares its capabilities
interface CapabilityManifest {
  name: string              // e.g., "dotnet.efcore"
  version: string           // e.g., "8.0.1"
  provides: string[]        // Capability names this worker provides
  requires: string[]        // Dependencies on other capabilities
  endpoints: EndpointSpec[] // RPC methods available
  limits: ResourceLimits    // Resource constraints
}

interface EndpointSpec {
  name: string
  inputSchema: JsonSchema
  outputSchema: JsonSchema
  timeout: number           // ms
  idempotent: boolean
}

interface ResourceLimits {
  maxConcurrentCalls: number
  maxPayloadBytes: number
  maxExecutionMs: number
}

// Example manifest for EF Core runtime
const efCoreManifest: CapabilityManifest = {
  name: "dotnet.efcore",
  version: "8.0.1",
  provides: ["dotnet.efcore", "dotnet.data", "dotnet.dbcontext"],
  requires: ["dotnet.core"],
  endpoints: [
    {
      name: "query",
      inputSchema: { type: "object", properties: { sql: { type: "string" } } },
      outputSchema: { type: "array" },
      timeout: 30000,
      idempotent: true
    },
    {
      name: "execute",
      inputSchema: { type: "object", properties: { sql: { type: "string" }, params: { type: "array" } } },
      outputSchema: { type: "object", properties: { rowsAffected: { type: "number" } } },
      timeout: 30000,
      idempotent: false
    }
  ],
  limits: {
    maxConcurrentCalls: 100,
    maxPayloadBytes: 10 * 1024 * 1024,
    maxExecutionMs: 60000
  }
}
```

---

## Capability Broker Implementation

### Broker Durable Object

```typescript
import { DurableObject } from 'cloudflare:workers'

interface CapabilityHandle {
  binding: Service<RuntimeWorker>
  manifest: CapabilityManifest
  shardId: string
}

export class CapabilityBrokerDO extends DurableObject<Env> {
  private manifests: Map<string, CapabilityManifest> = new Map()
  private shardRouting: Map<string, string[]> = new Map()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.loadManifests()
  }

  private loadManifests(): void {
    // Load from env bindings or config
    this.manifests.set('dotnet.core', coreManifest)
    this.manifests.set('dotnet.efcore', efCoreManifest)
    this.manifests.set('dotnet.ml', mlManifest)

    // Initialize shard routing
    this.shardRouting.set('dotnet.core', ['shard-0', 'shard-1', 'shard-2'])
    this.shardRouting.set('dotnet.efcore', ['shard-0', 'shard-1'])
    this.shardRouting.set('dotnet.ml', ['shard-0'])  // ML has fewer shards
  }

  // Main capability acquisition method
  async acquire(request: {
    required: string[]
    optional: string[]
    version: string
    accountId: string
  }): Promise<AcquireResponse> {
    const handles: Map<string, CapabilityHandle> = new Map()
    const missing: string[] = []
    const errors: Map<string, string> = new Map()

    // Resolve required capabilities
    for (const capName of request.required) {
      const result = await this.resolveCapability(capName, request.version, request.accountId)
      if (result.success) {
        handles.set(capName, result.handle!)
      } else {
        missing.push(capName)
        errors.set(capName, result.error!)
      }
    }

    // Fail if any required capability is missing
    if (missing.length > 0) {
      return {
        success: false,
        handles: new Map(),
        missing,
        errors
      }
    }

    // Resolve optional capabilities (best effort)
    for (const capName of request.optional) {
      const result = await this.resolveCapability(capName, request.version, request.accountId)
      if (result.success) {
        handles.set(capName, result.handle!)
      }
      // Don't fail on optional missing
    }

    return {
      success: true,
      handles,
      missing: [],
      errors: new Map()
    }
  }

  private async resolveCapability(
    capName: string,
    versionConstraint: string,
    accountId: string
  ): Promise<{ success: boolean; handle?: CapabilityHandle; error?: string }> {
    const manifest = this.manifests.get(capName)
    if (!manifest) {
      return { success: false, error: `Unknown capability: ${capName}` }
    }

    // Check version constraint
    if (!this.satisfiesVersion(manifest.version, versionConstraint)) {
      return {
        success: false,
        error: `Version ${manifest.version} does not satisfy ${versionConstraint}`
      }
    }

    // Check dependencies are available
    for (const dep of manifest.requires) {
      if (!this.manifests.has(dep)) {
        return { success: false, error: `Missing dependency: ${dep}` }
      }
    }

    // Select shard based on account (sticky routing)
    const shards = this.shardRouting.get(capName) || ['shard-0']
    const shardIndex = this.hashToShard(accountId, shards.length)
    const shardId = shards[shardIndex]

    // Get service binding for this capability
    const binding = this.getBinding(capName)
    if (!binding) {
      return { success: false, error: `No binding for ${capName}` }
    }

    return {
      success: true,
      handle: {
        binding,
        manifest,
        shardId
      }
    }
  }

  private satisfiesVersion(actual: string, constraint: string): boolean {
    // Simple semver check (use a real semver library in production)
    if (constraint.startsWith('>=')) {
      const minVersion = constraint.slice(2)
      return actual >= minVersion
    }
    if (constraint.startsWith('=')) {
      return actual === constraint.slice(1)
    }
    return true  // No constraint
  }

  private hashToShard(accountId: string, shardCount: number): number {
    let hash = 0
    for (let i = 0; i < accountId.length; i++) {
      hash = ((hash << 5) - hash) + accountId.charCodeAt(i)
      hash = hash & hash
    }
    return Math.abs(hash) % shardCount
  }

  private getBinding(capName: string): Service<RuntimeWorker> | null {
    // Map capability names to env bindings
    const bindings: Record<string, Service<RuntimeWorker>> = {
      'dotnet.core': this.env.DOTNET_CORE,
      'dotnet.efcore': this.env.DOTNET_EFCORE,
      'dotnet.ml': this.env.DOTNET_ML,
      'dotnet.web': this.env.DOTNET_WEB
    }
    return bindings[capName] || null
  }

  // List available capabilities
  async list(): Promise<CapabilityInfo[]> {
    return Array.from(this.manifests.entries()).map(([name, manifest]) => ({
      name,
      version: manifest.version,
      endpoints: manifest.endpoints.map(e => e.name),
      requires: manifest.requires
    }))
  }

  // Health check all capabilities
  async health(): Promise<HealthStatus[]> {
    const results: HealthStatus[] = []

    for (const [name, _] of this.manifests) {
      const binding = this.getBinding(name)
      if (!binding) {
        results.push({ name, healthy: false, error: 'No binding' })
        continue
      }

      try {
        const health = await binding.healthCheck()
        results.push({ name, healthy: health.status === 'ok', ...health })
      } catch (error) {
        results.push({
          name,
          healthy: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    return results
  }
}
```

---

## Thin Stub Integration

### Capability Client

```typescript
// Client library for thin stubs to use
export class CapabilityClient {
  private handles: Map<string, CapabilityHandle> = new Map()
  private broker: DurableObjectStub<CapabilityBrokerDO>

  constructor(env: Env) {
    this.broker = env.CAPABILITY_BROKER.get(
      env.CAPABILITY_BROKER.idFromName('global')
    )
  }

  async acquire(config: CapabilityConfig): Promise<void> {
    const response = await this.broker.acquire({
      required: config.required,
      optional: config.optional || [],
      version: config.version || '>=8.0',
      accountId: config.accountId
    })

    if (!response.success) {
      throw new CapabilityError(
        `Failed to acquire capabilities: ${Array.from(response.errors.entries())
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ')}`
      )
    }

    this.handles = response.handles
  }

  async invoke<T>(
    capability: string,
    method: string,
    payload: unknown
  ): Promise<T> {
    const handle = this.handles.get(capability)
    if (!handle) {
      throw new Error(`Capability ${capability} not acquired`)
    }

    // Validate against manifest
    const endpoint = handle.manifest.endpoints.find(e => e.name === method)
    if (!endpoint) {
      throw new Error(`Unknown method ${method} on ${capability}`)
    }

    // Call via service binding RPC
    const result = await handle.binding.invoke({
      method,
      payload,
      shardId: handle.shardId
    })

    return result as T
  }

  release(): void {
    this.handles.clear()
  }
}

// Usage in thin stub
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const client = new CapabilityClient(env)

    try {
      // Acquire needed capabilities
      await client.acquire({
        required: ['dotnet.core', 'dotnet.efcore'],
        optional: ['dotnet.logging'],
        version: '>=8.0',
        accountId: env.ACCOUNT_ID
      })

      // Execute function with capabilities
      const users = await client.invoke<User[]>(
        'dotnet.efcore',
        'query',
        { sql: 'SELECT * FROM Users WHERE Active = 1' }
      )

      const result = await client.invoke<ProcessResult>(
        'dotnet.core',
        'execute',
        {
          functionId: env.FUNCTION_ID,
          input: { users }
        }
      )

      return Response.json(result)
    } finally {
      client.release()
    }
  }
}
```

---

## Capability Negotiation Protocol

### Protocol Messages

```typescript
// Request to acquire capabilities
interface AcquireRequest {
  type: 'acquire'
  required: string[]          // Must have these
  optional: string[]          // Nice to have
  version: string             // Semver constraint
  accountId: string           // For routing
  timeout: number             // Max wait for warm-up
  preferences: {
    preferLocal: boolean      // Prefer same-colo workers
    allowColdStart: boolean   // OK to wait for cold start
  }
}

// Response with capability handles
interface AcquireResponse {
  type: 'acquire_response'
  success: boolean
  handles: Map<string, {
    capabilityId: string
    endpoint: ServiceBinding
    version: string
    shard: string
    limits: ResourceLimits
  }>
  missing: string[]
  errors: Map<string, string>
  warnings: string[]          // e.g., "Using fallback shard"
}

// Invoke a method on acquired capability
interface InvokeRequest {
  type: 'invoke'
  capabilityId: string
  method: string
  payload: ArrayBuffer
  timeout: number
  idempotencyKey?: string
}

// Response from invocation
interface InvokeResponse {
  type: 'invoke_response'
  success: boolean
  result?: ArrayBuffer
  error?: {
    code: string
    message: string
    retryable: boolean
  }
  metrics: {
    queueTimeMs: number
    executionTimeMs: number
    serializationTimeMs: number
  }
}
```

### Error Handling

```typescript
// Capability-specific errors
class CapabilityError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean,
    public capability?: string
  ) {
    super(message)
    this.name = 'CapabilityError'
  }
}

// Error codes
const ErrorCodes = {
  CAPABILITY_NOT_FOUND: 'CAPABILITY_NOT_FOUND',
  VERSION_MISMATCH: 'VERSION_MISMATCH',
  DEPENDENCY_MISSING: 'DEPENDENCY_MISSING',
  SHARD_UNAVAILABLE: 'SHARD_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  RESOURCE_EXHAUSTED: 'RESOURCE_EXHAUSTED',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD'
} as const

// Retry policy
interface RetryPolicy {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  retryableCodes: string[]
}

const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
  retryableCodes: [
    ErrorCodes.SHARD_UNAVAILABLE,
    ErrorCodes.TIMEOUT,
    ErrorCodes.RESOURCE_EXHAUSTED
  ]
}
```

---

## Version Compatibility

### Version Matrix

```typescript
// Define compatibility between capability versions
interface CompatibilityMatrix {
  [capability: string]: {
    [version: string]: {
      compatible: string[]      // Compatible with these versions
      breaking: string[]        // Breaking changes from these
      deprecated: boolean
      sunset?: string           // Date when removed
    }
  }
}

const compatibility: CompatibilityMatrix = {
  'dotnet.core': {
    '8.0': {
      compatible: ['8.0', '8.0.1', '8.0.2'],
      breaking: ['7.0'],
      deprecated: false
    },
    '7.0': {
      compatible: ['7.0', '7.0.1'],
      breaking: ['6.0'],
      deprecated: true,
      sunset: '2025-06-01'
    }
  },
  'dotnet.efcore': {
    '8.0': {
      compatible: ['8.0'],
      breaking: ['7.0'],
      deprecated: false
    }
  }
}
```

---

## Metrics and Observability

```typescript
// Capability metrics
interface CapabilityMetrics {
  capability: string
  shard: string
  metrics: {
    acquireCount: number
    acquireLatencyP50Ms: number
    acquireLatencyP99Ms: number
    invokeCount: number
    invokeLatencyP50Ms: number
    invokeLatencyP99Ms: number
    errorRate: number
    timeoutRate: number
  }
  timestamp: number
}

// Emit metrics from broker
class MetricsCollector {
  private buffer: CapabilityMetrics[] = []

  record(metric: CapabilityMetrics): void {
    this.buffer.push(metric)
    if (this.buffer.length >= 100) {
      this.flush()
    }
  }

  flush(): void {
    // Send to analytics
    if (this.buffer.length > 0) {
      // env.ANALYTICS.writeDataPoint(...)
      this.buffer = []
    }
  }
}
```

---

## Recommendations

1. **Keep broker lightweight** - It's on the critical path for every invocation
2. **Cache capability handles** - Reuse across requests when possible
3. **Use sticky routing** - Same account goes to same shard for cache benefits
4. **Implement circuit breakers** - Don't cascade failures across capabilities
5. **Version explicitly** - Always declare version constraints
6. **Monitor capability health** - Track availability and latency per capability

---

## Related Spikes

- [functions-nt0](./distributed-runtime-architecture.md) - Distributed runtime context
- [functions-tc2](./assembly-load-context.md) - How capabilities load code
- [functions-j43](./minimal-core-worker.md) - Core capability implementation

---

## References

- [Cloudflare Workers RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/)
- [Cap'n Proto RPC Protocol](https://capnproto.org/rpc.html)
- [Service Binding Patterns](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
