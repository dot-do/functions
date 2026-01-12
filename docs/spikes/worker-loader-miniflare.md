# Spike: Worker Loader API Validation with Miniflare

**Date:** 2026-01-12
**Status:** Complete
**Task ID:** functions-21u
**Author:** Functions.do Engineering Team

## Summary

This spike validates that miniflare provides full compatibility with the Cloudflare Worker Loader API for local development. The findings confirm that dynamic isolate loading, WorkerStub.fetch(), and custom bindings work correctly in the local development environment.

## Background

### Problem Statement

Functions.do relies heavily on the Worker Loader API to dynamically load user function code at runtime. For a productive developer experience, we need to verify that miniflare (the local Cloudflare Workers simulator) supports all the Worker Loader features we depend on.

### Key Questions

1. Does miniflare support the `env.LOADER.get()` API for dynamic worker loading?
2. Can dynamically loaded workers call back to service bindings?
3. What are the limitations compared to production Cloudflare Workers?
4. How does local caching behavior differ from production?

## Test Scenarios

### Scenario 1: Basic Dynamic Loading

**Test:** Load a simple ES module dynamically and invoke its fetch handler.

```typescript
// loader-test.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const functionCode = `
      export default {
        async fetch(request) {
          return new Response('Hello from dynamic worker!');
        }
      };
    `;

    const stub = env.LOADER.get('test-function', () => ({
      compatibilityDate: '2024-01-01',
      mainModule: 'index.js',
      modules: {
        'index.js': { esModule: functionCode }
      }
    }));

    return await stub.fetch(request);
  }
};
```

**Result:** PASS - Miniflare correctly instantiates the dynamic isolate and returns the expected response.

### Scenario 2: Service Binding Pass-Through

**Test:** Dynamic workers can access service bindings passed via the loader configuration.

```typescript
// Loader configuration
const stub = env.LOADER.get('user-function', () => ({
  compatibilityDate: '2024-01-01',
  mainModule: 'index.js',
  modules: {
    'index.js': { esModule: userCode }
  },
  env: {
    RUNTIME: env.RUNTIME, // Pass the runtime service binding
    KV_STORE: env.KV_STORE
  }
}));
```

**Result:** PASS - Service bindings are correctly propagated to the dynamic worker. The dynamic worker can invoke `env.RUNTIME.fetch()` and `env.KV_STORE.get()` as expected.

### Scenario 3: WASM Module Loading

**Test:** Load WASM binaries alongside JavaScript code.

```typescript
const stub = env.LOADER.get('wasm-function', () => ({
  compatibilityDate: '2024-01-01',
  mainModule: 'index.js',
  modules: {
    'index.js': { esModule: jsBindings },
    'module.wasm': { wasm: wasmBinary }
  }
}));
```

**Result:** PASS - WASM modules load correctly. The `WebAssembly.instantiate()` API works within the dynamic isolate.

### Scenario 4: Isolate Caching

**Test:** Verify that isolates are cached and reused across invocations.

```typescript
// First invocation - cold start
const stub1 = env.LOADER.get('cached-fn', () => config);
const start1 = performance.now();
await stub1.fetch(request);
const cold = performance.now() - start1;

// Second invocation - should be cached
const stub2 = env.LOADER.get('cached-fn', () => config);
const start2 = performance.now();
await stub2.fetch(request);
const warm = performance.now() - start2;
```

**Result:** PARTIAL PASS - Miniflare caches isolates within a single process session. However, unlike production Cloudflare:
- Isolates are not persisted across restarts
- No cross-datacenter caching simulation
- Cache key is based on function ID only (production may include content hash)

### Scenario 5: Network Isolation (globalOutbound)

**Test:** Verify that `globalOutbound: null` blocks external network access.

```typescript
const stub = env.LOADER.get('isolated-fn', () => ({
  compatibilityDate: '2024-01-01',
  mainModule: 'index.js',
  modules: { 'index.js': { esModule: code } },
  globalOutbound: null // Block external network
}));
```

**Result:** PASS - External `fetch()` calls throw `NetworkError` as expected. Only service binding calls succeed.

### Scenario 6: Memory Limits

**Test:** Verify memory limit enforcement.

```typescript
const stub = env.LOADER.get('memory-test', () => ({
  compatibilityDate: '2024-01-01',
  mainModule: 'index.js',
  modules: { 'index.js': { esModule: memoryHogCode } },
  limits: {
    memory: 128 * 1024 * 1024 // 128MB
  }
}));
```

**Result:** PARTIAL PASS - Miniflare enforces memory limits but with less precision than production. Large allocations may succeed slightly above the limit before termination.

## Findings

### Fully Supported Features

| Feature | Status | Notes |
|---------|--------|-------|
| `env.LOADER.get()` API | Supported | Full compatibility |
| ES Module loading | Supported | Both string and compiled modules |
| WASM module loading | Supported | Binary modules load correctly |
| Service binding pass-through | Supported | All binding types work |
| `stub.fetch()` invocation | Supported | Full Request/Response support |
| `globalOutbound` network isolation | Supported | External fetch blocked |
| Custom `compatibilityDate` | Supported | Feature flags respected |

### Partially Supported Features

| Feature | Status | Notes |
|---------|--------|-------|
| Isolate caching | Partial | No cross-restart persistence |
| Memory limits | Partial | Less precise enforcement |
| CPU limits | Partial | Time-based, not instruction-based |
| Durable Objects in dynamic workers | Partial | Requires explicit binding |

### Known Limitations

1. **No distributed caching**: Miniflare runs in a single process, so isolate caching doesn't simulate the production "Shard and Conquer" behavior.

2. **Timing differences**: Cold start times in miniflare don't reflect production performance due to different V8 instantiation paths.

3. **No multi-colo simulation**: Production Workers may route requests to different colos; miniflare doesn't simulate this.

4. **R2/KV latency**: Local storage bindings have near-zero latency, unlike production.

## Recommendations

### For Local Development

1. **Use miniflare for functional testing** - The API compatibility is excellent for verifying business logic.

2. **Don't rely on timing benchmarks** - Use production for performance validation.

3. **Explicitly test service binding scenarios** - These work correctly and should be part of the test suite.

4. **Add integration tests for WASM loading** - Confirm binaries load correctly before deployment.

### For CI/CD Pipeline

```yaml
# Example GitHub Actions workflow
jobs:
  test:
    steps:
      - name: Run local tests with miniflare
        run: npm run test:local
        env:
          NODE_OPTIONS: --experimental-vm-modules

      - name: Run integration tests on Cloudflare
        run: npm run test:integration
        env:
          CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
```

### For Production Deployment

1. **Always validate in staging first** - Miniflare compatibility doesn't guarantee production behavior.

2. **Monitor isolate cache hit rates** - Production caching behavior differs from local.

3. **Test with realistic payload sizes** - Memory limit behavior varies.

## Code Examples

### Minimal Worker Loader Setup

```typescript
// wrangler.toml
name = "function-loader"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[unsafe.bindings]]
name = "LOADER"
type = "worker_loader"
```

```typescript
// src/index.ts
interface Env {
  LOADER: WorkerLoader;
  RUNTIME: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const functionId = url.pathname.slice(1);

    // Fetch function code (from KV, R2, or API)
    const code = await fetchFunctionCode(functionId);

    // Create dynamic worker
    const stub = env.LOADER.get(functionId, () => ({
      compatibilityDate: '2024-01-01',
      mainModule: 'index.js',
      modules: {
        'index.js': { esModule: code }
      },
      env: {
        RUNTIME: env.RUNTIME
      },
      globalOutbound: null
    }));

    // Invoke the dynamic worker
    return await stub.fetch(request);
  }
};
```

### Testing with Miniflare

```typescript
// test/worker-loader.test.ts
import { Miniflare } from 'miniflare';

describe('Worker Loader', () => {
  let mf: Miniflare;

  beforeAll(async () => {
    mf = new Miniflare({
      script: `
        export default {
          async fetch(request, env) {
            const stub = env.LOADER.get('test', () => ({
              compatibilityDate: '2024-01-01',
              mainModule: 'index.js',
              modules: {
                'index.js': { esModule: 'export default { fetch: () => new Response("OK") }' }
              }
            }));
            return stub.fetch(request);
          }
        }
      `,
      modules: true,
      unsafeBindings: {
        LOADER: { type: 'worker_loader' }
      }
    });
  });

  afterAll(async () => {
    await mf.dispose();
  });

  it('should load dynamic workers', async () => {
    const response = await mf.dispatchFetch('http://localhost/');
    expect(await response.text()).toBe('OK');
  });
});
```

## Conclusion

Miniflare provides **excellent compatibility** with the Worker Loader API for local development and testing. The core functionality required by Functions.do - dynamic isolate loading, service binding pass-through, and WASM support - all work correctly.

The main caveats relate to performance characteristics (caching, timing) and resource limits (memory, CPU), which behave differently in the local environment. These differences don't impact functional correctness but should be validated in production or staging environments.

**Recommendation:** Proceed with miniflare as the primary local development tool for Functions.do, with production validation for performance-critical paths.

## References

- [Cloudflare Worker Loader API](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/)
- [Miniflare Documentation](https://miniflare.dev/)
- [Cloudflare Workers Compatibility Dates](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)
- [Functions.do Architecture](../architecture.md)

---

*Document Version: 1.0*
*Last Updated: 2026-01-12*
