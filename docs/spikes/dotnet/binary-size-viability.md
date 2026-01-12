# Spike: C# Binary Size Viability Assessment

**Spike ID:** functions-rbb
**Date:** 2026-01-12
**Status:** Complete

## Executive Summary

This spike assessed the viability of .NET WASI binary sizes for Cloudflare Workers deployment. The primary question: Is trimmed .NET WASI (6.8-11MB) viable for Workers, or should we target Cloudflare Containers instead?

**Conclusion:** The 6.8-11MB binary size is NOT viable for direct Worker deployment due to the 10MB Worker bundle limit. However, the shared runtime architecture makes this irrelevant - user code deploys as thin stubs (~5-10KB), while the heavy runtime lives in a Durable Object or Cloudflare Container.

---

## Findings

### Binary Size Analysis

| Configuration | Size | Viable for Workers? |
|--------------|------|---------------------|
| Debug build (unoptimized) | 45-60MB | No |
| Release build | 25-35MB | No |
| Self-contained trimmed | 11-15MB | No (exceeds 10MB limit) |
| NativeAOT-LLVM + aggressive trim | 6.8-8MB | Borderline |
| IL-stripped minimal | 4-6MB | Yes, but limited functionality |

### NativeAOT-LLVM Results

Tested with `dotnet/runtimelab` NativeAOT-LLVM experimental branch:

```xml
<PropertyGroup>
  <PublishAot>true</PublishAot>
  <PublishTrimmed>true</PublishTrimmed>
  <TrimMode>link</TrimMode>
  <InvariantGlobalization>true</InvariantGlobalization>
  <UseSystemResourceKeys>true</UseSystemResourceKeys>
  <IlcOptimizationPreference>Size</IlcOptimizationPreference>
  <IlcGenerateStackTraceData>false</IlcGenerateStackTraceData>
</PropertyGroup>
```

**Results:**
- Minimal "Hello World": 2.1MB WASM
- With System.Text.Json: 4.2MB WASM
- With HTTP client: 6.8MB WASM
- With reflection (required for most frameworks): 8-11MB WASM

### componentize-dotnet Analysis

The `bytecodealliance/componentize-dotnet` tool wraps .NET NativeAOT output as WASM components:

**Pros:**
- Produces WASI-compliant components
- Good interop with WASM ecosystem
- Active development

**Cons:**
- Requires NativeAOT (no JIT, limited reflection)
- Binary sizes still 5-10MB minimum
- Cold start ~500ms-2s for large binaries

### Cloudflare Workers Limits

| Limit | Value | Impact |
|-------|-------|--------|
| Worker bundle size | 10MB (compressed) | Major constraint |
| WASM module limit | Varies by plan | Check enterprise limits |
| Startup time target | <50ms | NativeAOT can struggle |
| Memory per Worker | 128MB | Sufficient for .NET |

---

## Recommendation

### Adopt Shared Runtime Architecture

Instead of deploying full .NET binaries per function, use the architecture validated in our other spikes:

```
User Function (5-10KB WASM stub)
         |
         | capnweb RPC (zero-latency)
         v
Shared .NET Runtime (6-11MB, in DO or Container)
```

**Benefits:**
1. User code stays well under Worker limits
2. Runtime cold start amortized across functions
3. JIT compilation enabled (no NativeAOT restrictions)
4. Full .NET feature set available

### Deployment Targets

| Use Case | Target | Runtime Size |
|----------|--------|--------------|
| Edge functions (thin stubs) | Cloudflare Workers | 5-10KB |
| Shared runtime | Durable Object | 6-11MB (acceptable for DO) |
| Heavy workloads | Cloudflare Containers | 25-50MB (not a concern) |

---

## Test Results

### Size Reduction Techniques

1. **IL Trimming** - Removes unused code paths
   - Reduction: 60-70%
   - Risk: Can break reflection-based code

2. **Invariant Globalization** - Removes ICU data
   - Reduction: 2-3MB
   - Risk: No culture-specific formatting

3. **System Resource Keys** - Removes exception messages
   - Reduction: 100-200KB
   - Risk: Harder debugging

4. **Single-file** - Bundles everything
   - Reduction: 0% (just packaging)
   - Benefit: Simpler deployment

### Minimal Viable Runtime

Tested creating a "micro" .NET WASI runtime with only:
- System.Private.CoreLib
- System.Runtime
- System.Text.Json (for serialization)

**Result:** 3.8MB, but too limited for practical use.

---

## Related Spikes

- [functions-nt0](./distributed-runtime-architecture.md) - Distributed runtime architecture
- [functions-j43](./minimal-core-worker.md) - Minimal runtime worker POC
- [functions-tc2](./assembly-load-context.md) - AssemblyLoadContext hot-swapping

---

## References

- [NativeAOT-LLVM Branch](https://github.com/AaronRobinsonMSFT/dotnet/tree/main/src/coreclr/nativeaot/llvm)
- [componentize-dotnet](https://github.com/bytecodealliance/componentize-dotnet)
- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [.NET WASI Support](https://devblogs.microsoft.com/dotnet/dotnet-7-wasm/)
