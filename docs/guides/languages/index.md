# Language Guides

Functions.do supports TypeScript, JavaScript, and Python (beta) for writing serverless functions on the Cloudflare Workers runtime.

## Supported Languages

| Language | Runtime | Compilation | Cold Start | Status | Best For |
|----------|---------|-------------|------------|--------|----------|
| [TypeScript](./typescript.md) | V8 Isolate | esbuild ESM bundle | ~5ms | Stable | General purpose, recommended |
| JavaScript | V8 Isolate | Native ESM | ~5ms | Stable | General purpose |
| [Python](./python.md) | Pyodide | Interpreted (WASM) | ~50ms | Beta | Data processing, ML inference |

## Choosing a Language

### TypeScript (Recommended)

TypeScript is the recommended language for most use cases. It offers:
- Native support in the Cloudflare Workers runtime
- Fastest cold start times
- Smallest bundle sizes
- Best developer experience with full SDK support
- Compiled to ESM via esbuild at deploy time

[Get started with TypeScript](./typescript.md)

### JavaScript

JavaScript functions run natively on the Workers runtime with the same performance characteristics as TypeScript. Use JavaScript if you prefer to skip the TypeScript compilation step.

### Python (Beta)

Python via Pyodide enables:
- Data science and ML workloads
- Rapid prototyping
- NumPy/Pandas support
- Familiar Python ecosystem

[Get started with Python](./python.md)

## Language Feature Comparison

| Feature | TypeScript | JavaScript | Python |
|---------|------------|------------|--------|
| Async/Await | Yes | Yes | Yes |
| HTTP Client | Yes | Yes | Yes |
| JSON Parsing | Native | Native | json module |
| Durable Objects | Yes | Yes | Limited |
| Cache API | Yes | Yes | Limited |

## Next Steps

1. Choose your preferred language from the guides above
2. Follow the installation and setup instructions
3. Create your first function
4. Deploy to Functions.do

For SDK documentation, see the [SDK Reference](/docs/sdk).
