# Worker-to-Worker RPC Latency Benchmark

This benchmark measures the latency overhead of delegating function execution from a thin "caller" worker to a shared "runtime" worker via Cloudflare Service Bindings.

## Purpose

Functions.do uses a distributed runtime architecture where:
- **Thin stub workers** contain only user function code (~KB)
- **Shared runtime workers** provide heavy capabilities (Python, .NET, ML, etc.)
- **capnweb RPC** connects them with minimal overhead

This benchmark validates whether Service Binding delegation has acceptable latency for production use.

## Architecture

```
┌─────────────────────┐     Service Binding     ┌─────────────────────┐
│   Caller Worker     │ ─────────────────────▶  │   Runtime Worker    │
│   (Thin Stub)       │                         │   (Shared Runtime)  │
│                     │                         │                     │
│   - Receives req    │                         │   - Executes func   │
│   - Delegates exec  │                         │   - Returns result  │
│   - Returns result  │                         │                     │
└─────────────────────┘                         └─────────────────────┘
        :8787                                           :8788
```

## Running the Benchmark

### Prerequisites

```bash
# Install dependencies for all components
cd runtime-worker && npm install
cd ../caller-worker && npm install
cd ../harness && npm install
```

### Start Workers

In separate terminals:

```bash
# Terminal 1: Start runtime worker
cd runtime-worker
npm run dev

# Terminal 2: Start caller worker
cd caller-worker
npm run dev
```

### Run Benchmark

```bash
cd harness

# Quick benchmark (20 iterations)
npm run benchmark:quick

# Standard benchmark (100 iterations)
npm run benchmark

# Full benchmark with saved results (1000 iterations)
npm run benchmark:full
```

## What's Measured

### Methods Compared

1. **Direct Execution** - Function runs inline (baseline)
2. **Service Binding** - Delegation via `env.RUNTIME.fetch()` (zero network hop)
3. **Raw Fetch** - Delegation via `fetch()` to localhost (network hop)

### Test Parameters

| Parameter | Values |
|-----------|--------|
| Functions | `echo`, `transform`, `compute` |
| Payload Sizes | 100B, 1KB, 10KB, 100KB |
| Iterations | 100 (default), 1000 (full) |

### Metrics

- **p50** - Median latency
- **p95** - 95th percentile latency
- **p99** - 99th percentile latency
- **Overhead** - Additional latency vs direct execution

## Expected Results

Based on Cloudflare's architecture, Service Bindings should add minimal overhead:

| Method | Expected p50 | Expected p99 |
|--------|--------------|--------------|
| Direct | <0.1ms | <0.5ms |
| Service Binding | <0.5ms | <2ms |
| Raw Fetch (local) | 1-5ms | 10-20ms |

## Interpreting Results

### Acceptable Overhead

For Functions.do's distributed runtime to be viable:
- Service Binding p50 overhead should be **<1ms**
- Service Binding p99 overhead should be **<5ms**

### Warning Signs

If overhead exceeds thresholds, consider:
1. Payload size optimization (smaller serialization)
2. Connection pooling for raw fetch
3. Caching for frequently-called functions
4. Batch processing for high-throughput scenarios

## Files

```
worker-rpc-latency/
├── caller-worker/          # Thin stub that delegates to runtime
│   ├── src/index.ts
│   ├── wrangler.toml
│   └── package.json
├── runtime-worker/         # Shared runtime that executes functions
│   ├── src/index.ts
│   ├── wrangler.toml
│   └── package.json
├── harness/               # Benchmark runner
│   ├── run-benchmark.ts
│   └── package.json
└── README.md
```

## Related

- [Worker RPC Latency Spike](/docs/spikes/worker-rpc-latency.md) - Analysis and findings
- [capnweb](https://github.com/cloudflare/capnweb) - Zero-latency RPC protocol
- [Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) - Cloudflare docs
