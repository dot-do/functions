# Spike: Worker-to-Worker RPC Latency for Runtime Delegation

**Date:** 2025-01-12
**Status:** In Progress
**Author:** Engineering Team

## Summary

This spike investigates the latency overhead of delegating function execution from thin stub workers to shared runtime workers via Cloudflare Service Bindings. This validates a core assumption of the Functions.do distributed runtime architecture.

## Background

### Problem Statement

Functions.do aims to support heavy runtimes (Python/Pyodide, .NET, JVM) with zero cold starts by:

1. Keeping user function code in thin stub workers (~KB)
2. Sharing runtime capabilities across warm "runtime workers"
3. Using RPC to delegate execution from stub to runtime

The key question: **Does this delegation add unacceptable latency?**

### Architecture Under Test

```
User Request
     │
     ▼
┌─────────────────────────────────────┐
│         Thin Stub Worker            │
│   (~KB, always cold start fast)     │
│                                     │
│   async fetch(request) {            │
│     return runtime.execute(fn)      │  ◀── Service Binding call
│   }                                 │
└──────────────────┬──────────────────┘
                   │
                   │ Service Binding (in-datacenter)
                   │
                   ▼
┌─────────────────────────────────────┐
│       Shared Runtime Worker         │
│   (~MB, kept warm via sharding)     │
│                                     │
│   - Pyodide runtime (~15MB)         │
│   - .NET interpreter                │
│   - ML model inference              │
└─────────────────────────────────────┘
```

## Hypothesis

Based on Cloudflare's documentation and architecture:

1. **Service Bindings** operate within the same datacenter, avoiding network round-trips
2. **capnweb protocol** (used internally) provides near-zero serialization overhead
3. Expected overhead should be **<1ms p50** and **<5ms p99**

If validated, this architecture enables:
- Heavy runtimes with sub-100ms cold starts (vs seconds on Lambda)
- Shared state/caching across function invocations
- Capability composition without network penalty

## Benchmark Design

### Test Scenarios

| Scenario | Description |
|----------|-------------|
| **Direct** | Function executes inline (baseline) |
| **Service Binding** | Function delegates via `env.RUNTIME.fetch()` |
| **Raw Fetch** | Function delegates via `fetch('http://...')` |

### Test Functions

| Function | Characteristics |
|----------|-----------------|
| `echo` | Minimal compute, tests pure RPC overhead |
| `transform` | JSON serialization/deserialization |
| `compute` | CPU-bound work (1000 sqrt operations) |

### Payload Sizes

- **100 bytes** - Minimal payload
- **1 KB** - Typical API response
- **10 KB** - Medium payload
- **100 KB** - Large payload (edge case)

### Metrics Collected

- p50, p95, p99 latency percentiles
- Min/max latency
- Mean latency
- Raw timing data for distribution analysis

## Implementation

### Components Created

```
benchmarks/worker-rpc-latency/
├── runtime-worker/         # Executes functions
│   └── src/index.ts
├── caller-worker/          # Delegates to runtime
│   └── src/index.ts
└── harness/               # Runs benchmarks
    └── run-benchmark.ts
```

### Key Code Patterns

**Service Binding Delegation:**
```typescript
// In caller-worker/src/index.ts
async function delegateViaServiceBinding(
  runtime: Fetcher,
  functionId: string,
  payload: unknown
): Promise<{ response: ExecuteResponse; latencyMs: number }> {
  const startTime = performance.now();

  const response = await runtime.fetch('http://runtime/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionId, payload, timestamp: Date.now() }),
  });

  const result: ExecuteResponse = await response.json();
  const latencyMs = performance.now() - startTime;

  return { response: result, latencyMs };
}
```

**Wrangler Service Binding Config:**
```toml
# In caller-worker/wrangler.toml
[[services]]
binding = "RUNTIME"
service = "runtime-worker-benchmark"
```

## Expected Results

### Theoretical Overhead Sources

| Source | Expected Impact |
|--------|-----------------|
| V8 isolate context switch | <0.1ms |
| JSON serialization | Proportional to payload |
| Service Binding dispatch | <0.5ms |
| Response deserialization | Proportional to payload |

### Target Thresholds

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| p50 overhead | <1ms | Imperceptible to users |
| p95 overhead | <3ms | Within SLA tolerance |
| p99 overhead | <5ms | Acceptable tail latency |

## Running the Benchmark

```bash
# Start runtime worker
cd benchmarks/worker-rpc-latency/runtime-worker
npm install && npm run dev

# Start caller worker (new terminal)
cd benchmarks/worker-rpc-latency/caller-worker
npm install && npm run dev

# Run benchmark (new terminal)
cd benchmarks/worker-rpc-latency/harness
npm install && npm run benchmark
```

## Results

### Local Development (miniflare)

> **Note:** Results from local development with miniflare. Production results on Cloudflare's network may differ.

| Method | Payload | p50 | p95 | p99 |
|--------|---------|-----|-----|-----|
| Direct | 100B | TBD | TBD | TBD |
| Service Binding | 100B | TBD | TBD | TBD |
| Raw Fetch | 100B | TBD | TBD | TBD |
| Direct | 1KB | TBD | TBD | TBD |
| Service Binding | 1KB | TBD | TBD | TBD |
| Raw Fetch | 1KB | TBD | TBD | TBD |
| Direct | 10KB | TBD | TBD | TBD |
| Service Binding | 10KB | TBD | TBD | TBD |
| Raw Fetch | 10KB | TBD | TBD | TBD |
| Direct | 100KB | TBD | TBD | TBD |
| Service Binding | 100KB | TBD | TBD | TBD |
| Raw Fetch | 100KB | TBD | TBD | TBD |

### Production (Cloudflare Workers)

> **Note:** Requires deployment to Cloudflare. Update after production testing.

TBD

## Analysis

### Observations

1. **Service Binding vs Direct**: TBD after running benchmarks
2. **Payload Size Impact**: TBD
3. **Function Complexity Impact**: TBD

### Implications for Functions.do

#### If Overhead < 1ms (Expected)

The distributed runtime architecture is viable:
- Thin stubs can safely delegate to shared runtimes
- Heavy runtimes (Pyodide, .NET) can stay warm perpetually
- User code stays small, keeping cold starts fast

#### If Overhead > 5ms (Unexpected)

Consider alternatives:
- Inline WASM runtimes (larger bundles, slower cold starts)
- Aggressive caching of runtime state
- Batch processing for high-throughput workloads

## Comparison: capnweb vs Raw Fetch

### capnweb Advantages

1. **Zero-copy serialization** - Avoids JSON overhead
2. **Streaming** - Partial results without buffering
3. **Type safety** - Schema-validated messages
4. **Multiplexing** - Multiple RPCs over single connection

### Current Limitation

This benchmark uses raw JSON fetch. capnweb integration would require:
1. capnweb schema definition
2. Code generation for TypeScript
3. Integration with Service Bindings

### Recommended Follow-up

Create a separate benchmark comparing:
- JSON over Service Bindings (this benchmark)
- capnweb over Service Bindings
- MessagePack over Service Bindings

## Conclusions

TBD after running benchmarks.

## Recommendations

Based on preliminary analysis:

1. **Proceed with Service Binding architecture** - Expected overhead is acceptable
2. **Invest in capnweb integration** - For production, replace JSON with capnweb
3. **Monitor payload sizes** - Keep function inputs/outputs under 10KB when possible
4. **Test in production** - Local results may not reflect true Cloudflare performance

## Next Steps

- [ ] Run benchmarks locally and record results
- [ ] Deploy to Cloudflare staging and run production benchmarks
- [ ] Implement capnweb protocol comparison
- [ ] Document production findings
- [ ] Create performance monitoring for production delegation

## References

- [Cloudflare Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [capnweb GitHub](https://github.com/cloudflare/capnweb)
- [Cloudflare Workers Architecture](https://developers.cloudflare.com/workers/reference/how-workers-works/)
- [Functions.do Architecture](../architecture.md)

## Appendix: Benchmark Code Location

All benchmark code is available at:
`/benchmarks/worker-rpc-latency/`

See the [benchmark README](/benchmarks/worker-rpc-latency/README.md) for detailed usage instructions.
