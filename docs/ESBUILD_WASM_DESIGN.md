# esbuild-wasm TypeScript Compilation Design

## Problem Statement

Functions.do needs to compile TypeScript at runtime for `worker_loaders` execution. Currently using a regex-based stripper that has limitations with complex TypeScript features (enums, decorators, complex generics).

## Performance Benchmarks

**esbuild-wasm in Cloudflare Workers** (benchmark worker: `esbuild-wasm-benchmark.dotdo.workers.dev`):

| Metric | Value |
|--------|-------|
| Bundle Size | 13.3 MB |
| Worker Startup | 17ms |
| Cold Start (client) | ~580ms |
| Warm Request | ~260ms |
| Transform Time | <1ms |
| Init Time | <1ms |

Key insight: **Transform is essentially instant (<1ms)**. The overhead is bundle loading and network latency.

## Architecture Options

### Option A: Pre-compile at Deploy Time (Recommended)

```
POST /api/functions → esbuild transform → Store JS in KV → Runtime uses JS directly
```

**Pros:**
- Zero runtime compilation overhead
- No extra bundle size in main worker
- Best cold start times
- Full TypeScript/TSX support

**Cons:**
- Deploy endpoint needs esbuild-wasm (~13MB increase)
- Or separate compile worker via RPC

### Option B: Inline esbuild-wasm in functions.do

```
Invoke → Check if TS → esbuild transform → Execute in worker_loaders
```

**Pros:**
- Simple, single worker
- Works for dynamic code

**Cons:**
- +13MB bundle size for functions.do
- Longer cold starts

### Option C: Separate esbuild RPC Worker

```
Invoke → RPC call to esbuild-worker → Get JS → Execute
```

**Pros:**
- Isolates esbuild cold start
- functions.do stays lean

**Cons:**
- Extra network hop (~20-50ms)
- More infrastructure to manage

### Option D: Hybrid (Pre-compile + Inline Fallback)

```
Deploy: Pre-compile with esbuild
Runtime: Use pre-compiled JS (fast path)
         OR inline esbuild for edge cases (fallback)
```

**Pros:**
- Best of both worlds
- Fast path is always fast
- Handles edge cases

**Cons:**
- Most complex implementation

## Recommended Implementation

### Phase 1: Pre-compile at Deploy Time

1. Create `esbuild-compiler` worker that exposes RPC endpoint
2. In deploy endpoint, call compiler worker to transform TS → JS
3. Store compiled JS in KV alongside original TS (or just JS)
4. Runtime invokes use compiled JS directly

### Phase 2: Optional Inline Fallback

1. Add esbuild-wasm as optional dependency
2. If pre-compiled JS not found, compile on-the-fly
3. Cache result in KV for subsequent requests

### Phase 3: TSX/JSX Support

1. Add JSX transformation options
2. Support React/Preact/custom pragma
3. Handle imports for virtual DOM libraries

## API Design

### Compiler Worker RPC

```typescript
interface EsbuildCompiler {
  transform(options: TransformOptions): Promise<TransformResult>
}

interface TransformOptions {
  code: string
  loader: 'ts' | 'tsx' | 'js' | 'jsx'
  target?: string
  format?: 'esm' | 'cjs' | 'iife'
  jsx?: {
    factory?: string
    fragment?: string
  }
}

interface TransformResult {
  code: string
  map?: string
  warnings: string[]
}
```

### Deploy Endpoint Changes

```typescript
// POST /api/functions
{
  "id": "my-function",
  "code": "export default { ... }",
  "language": "typescript",
  "precompile": true  // default: true
}
```

### KV Storage Schema

```
FUNCTIONS_CODE:
  {id}:source → Original TypeScript
  {id}:compiled → Compiled JavaScript
  {id}:sourcemap → Source map (optional)
```

## Migration Path

1. Deploy esbuild-compiler worker
2. Update deploy endpoint to use compiler
3. Update invoke to use pre-compiled code
4. Remove regex-based stripper (or keep as fast-path for simple cases)
5. Add monitoring/metrics for compilation times

## Risk Mitigation

- **Cold start**: Pre-compile eliminates runtime cold start impact
- **Bundle size**: Separate compiler worker keeps main worker lean
- **Compatibility**: Full esbuild TypeScript support
- **Fallback**: Regex stripper still works for simple cases
