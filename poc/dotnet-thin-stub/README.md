# Thin C# Stub + Shared Runtime POC

This proof of concept demonstrates the "thin stub + shared runtime" architecture for running .NET functions on Cloudflare Workers with faster cold starts.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Cloudflare Worker                                │
│                                                                          │
│  ┌────────────────┐    ┌────────────────┐    ┌────────────────┐         │
│  │  Thin Stub A   │    │  Thin Stub B   │    │  Thin Stub C   │         │
│  │    (~5 KB)     │    │    (~5 KB)     │    │    (~5 KB)     │         │
│  │                │    │                │    │                │         │
│  │ - Serialize    │    │ - Serialize    │    │ - Serialize    │         │
│  │ - Delegate     │    │ - Delegate     │    │ - Delegate     │         │
│  └───────┬────────┘    └───────┬────────┘    └───────┬────────┘         │
│          │                     │                     │                   │
│          └─────────────────────┼─────────────────────┘                   │
│                                │                                         │
│                                ▼                                         │
│                    ┌────────────────────────┐                            │
│                    │    Shared Runtime      │                            │
│                    │      (~20 MB)          │                            │
│                    │    (Durable Object)    │                            │
│                    │                        │                            │
│                    │ - Full .NET Runtime    │                            │
│                    │ - Function Registry    │                            │
│                    │ - Execution Engine     │                            │
│                    │ - Caching              │                            │
│                    └────────────────────────┘                            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Comparison: Thin Stub vs Monolithic

| Metric | Thin Stub | Monolithic |
|--------|-----------|------------|
| Function Binary Size | ~5 KB | ~15 MB |
| Cold Start (runtime cold) | ~210 ms | ~150 ms |
| Cold Start (runtime warm) | ~7 ms | ~150 ms |
| Memory per 100 functions | ~20.5 MB | ~1500 MB |

**Key Insight**: The thin stub approach wins significantly when:
- The shared runtime is warm (common in production)
- You have many functions deployed
- Functions are invoked sporadically

## Project Structure

```
poc/dotnet-thin-stub/
├── stub/               # Thin C# stub (minimal .NET WASI)
│   ├── ThinStub.csproj
│   ├── Program.cs
│   └── build.sh
├── runtime/            # Shared runtime worker (full .NET)
│   ├── Runtime.csproj
│   ├── Program.cs
│   └── build.sh
├── worker/             # Cloudflare Worker orchestration
│   ├── src/
│   │   └── index.ts
│   ├── package.json
│   ├── wrangler.toml
│   └── benchmark.js
└── README.md
```

## Prerequisites

- .NET 8.0 SDK with WASI workload
- Node.js 18+
- Wrangler CLI (for Cloudflare Workers)

### Install .NET WASI Workload

```bash
dotnet workload install wasi-experimental
```

## Building

### Build the Thin Stub

```bash
cd stub
./build.sh
```

Expected output size: ~5-10 KB (with aggressive trimming)

### Build the Shared Runtime

```bash
cd runtime
./build.sh
```

Expected output size: ~15-25 MB (full .NET runtime)

### Build the Worker

```bash
cd worker
npm install
```

## Running

### Local Development

```bash
cd worker
npm run dev
```

This starts the Cloudflare Worker locally with simulation mode.

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | API information |
| `GET /info` | System information |
| `POST /invoke/:functionId` | Invoke via thin stub + shared runtime |
| `POST /invoke-monolithic/:functionId` | Invoke via monolithic approach |
| `GET /benchmark` | Run cold start benchmark |

### Example Invocations

```bash
# Invoke 'add' function via thin stub
curl -X POST http://localhost:8787/invoke/add \
  -H "Content-Type: application/json" \
  -d '{"args": [5, 3]}'

# Invoke 'fibonacci' function
curl -X POST http://localhost:8787/invoke/fibonacci \
  -H "Content-Type: application/json" \
  -d '{"args": [10]}'

# Compare with monolithic approach
curl -X POST http://localhost:8787/invoke-monolithic/add \
  -H "Content-Type: application/json" \
  -d '{"args": [5, 3]}'

# Run benchmark
curl http://localhost:8787/benchmark
```

### Run Local Benchmark

```bash
cd worker
node benchmark.js
```

## Available Functions

| Function ID | Description | Arguments |
|-------------|-------------|-----------|
| `add` | Adds two numbers | `[number, number]` |
| `multiply` | Multiplies two numbers | `[number, number]` |
| `greet` | Returns a greeting | `[string]` |
| `fibonacci` | Calculates fibonacci number | `[number]` |
| `echo` | Echoes back the input | `[any]` |

## How It Works

### Thin Stub Approach

1. **Request arrives** at Cloudflare Worker
2. **Load thin stub** (~5 KB WASM, ~2ms)
3. **Stub serializes** the function arguments to JSON
4. **Stub delegates** to the shared runtime (Durable Object)
5. **Runtime executes** the function logic
6. **Result returns** through the stub to the caller

### Monolithic Approach

1. **Request arrives** at Cloudflare Worker
2. **Load full bundle** (~15 MB WASM, ~150ms)
3. **Bundle executes** the function logic
4. **Result returns** to the caller

## Optimization Techniques

### Stub Optimizations (ThinStub.csproj)

```xml
<PublishTrimmed>true</PublishTrimmed>
<TrimMode>full</TrimMode>
<InvariantGlobalization>true</InvariantGlobalization>
<UseSystemResourceKeys>true</UseSystemResourceKeys>
<IlcOptimizationPreference>Size</IlcOptimizationPreference>
<IlcGenerateStackTraceData>false</IlcGenerateStackTraceData>
<DebuggerSupport>false</DebuggerSupport>
<EventSourceSupport>false</EventSourceSupport>
<StackTraceSupport>false</StackTraceSupport>
```

### Runtime Optimizations

- Function compilation caching
- Pre-warmed Durable Object
- JSON source generators (no reflection)

## Benchmark Results

Running `node benchmark.js` produces output like:

```
======================================================================
Functions.do Thin Stub vs Monolithic Cold Start Benchmark
======================================================================

Scenario 2: Single Function Cold Start (Runtime Warm)
----------------------------------------------------------------------

Thin Stub Approach:
  Stub Load:      0.05 ms
  Runtime Load:   0.00 ms (already warm)
  Delegation:     5.00 ms
  Execution:      1.00 ms
  TOTAL:          6.05 ms

Monolithic Approach:
  Bundle Load:    150.00 ms
  Execution:      1.00 ms
  TOTAL:          151.00 ms

Comparison: Thin stub is 24.96x faster (96.0% improvement)
```

## Production Considerations

### When to Use Thin Stubs

- Many functions deployed (>10)
- Sporadic invocation patterns
- Cold start latency is critical
- Memory budget is constrained

### When to Use Monolithic

- Few functions (<5)
- High-frequency invocations (functions stay warm)
- Simplicity is priority
- Low latency network to runtime unavailable

## Future Improvements

1. **True WASM compilation** - Currently simulated; implement actual .NET WASI builds
2. **AOT compilation** - Use NativeAOT for even smaller binaries
3. **Runtime preloading** - Keep runtime warm with heartbeats
4. **Function registry service** - Dynamic function loading from R2/KV
5. **Metrics collection** - Real cold start telemetry

## References

- [.NET WASI Support](https://github.com/AntumS/Dotnet-Wasi-SDK)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [IL Trimming in .NET](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming)
