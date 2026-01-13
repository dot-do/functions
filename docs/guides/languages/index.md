# Language Guides

Functions.do supports multiple programming languages, allowing you to write serverless functions in your preferred language. Each language compiles to WebAssembly (WASM) and runs on the Cloudflare Workers runtime.

## Supported Languages

| Language | Runtime | Compilation | Cold Start | Binary Size | Best For |
|----------|---------|-------------|------------|-------------|----------|
| [TypeScript](./typescript.md) | V8 Isolate | Native | ~5ms | Small | General purpose, rapid development |
| [Rust](./rust.md) | WASM | wasm-pack | ~2ms | Small | Performance-critical, systems programming |
| [Go](./go.md) | WASM | TinyGo | ~3ms | Medium | Backend services, concurrent workloads |
| [Python](./python.md) | Pyodide | Interpreted | ~50ms | Large | Data processing, ML inference |
| [C#](./csharp.md) | WASM | .NET AOT | ~10ms | Medium | Enterprise applications, .NET ecosystem |

## Choosing a Language

### TypeScript (Recommended)

TypeScript is the recommended language for most use cases. It offers:
- Native support in the Cloudflare Workers runtime
- Fastest cold start times
- Smallest bundle sizes
- Best developer experience with full SDK support

[Get started with TypeScript](./typescript.md)

### Rust

Rust compiles to highly optimized WebAssembly, making it ideal for:
- Performance-critical applications
- CPU-intensive workloads
- Memory-efficient processing
- Systems-level programming

[Get started with Rust](./rust.md)

### Go

Go with TinyGo provides:
- Familiar syntax for backend developers
- Good concurrency primitives
- Strong standard library support
- Medium-sized WASM binaries

[Get started with Go](./go.md)

### Python

Python via Pyodide enables:
- Data science and ML workloads
- Rapid prototyping
- NumPy/Pandas support
- Familiar Python ecosystem

[Get started with Python](./python.md)

### C#

C# with .NET Native AOT offers:
- Enterprise-grade applications
- Strong typing and tooling
- .NET ecosystem integration
- LINQ and async/await patterns

[Get started with C#](./csharp.md)

## Language Feature Comparison

| Feature | TypeScript | Rust | Go | Python | C# |
|---------|------------|------|-----|--------|-----|
| Async/Await | Yes | Yes | Yes | Yes | Yes |
| HTTP Client | Yes | Yes | Yes | Yes | Yes |
| JSON Parsing | Native | serde | encoding/json | json | System.Text.Json |
| Environment Variables | Yes | Yes | Yes | Yes | Yes |
| KV Storage | Yes | Yes | Yes | Yes | Yes |
| Durable Objects | Yes | Limited | Limited | Limited | Limited |

## WebAssembly (WASM) Support

All non-JavaScript languages compile to WebAssembly before deployment. WASM provides:
- Near-native performance
- Language-agnostic execution
- Sandboxed security
- Portable binaries

The Functions.do SDK handles WASM compilation and deployment automatically for supported languages.

## Next Steps

1. Choose your preferred language from the guides above
2. Follow the installation and setup instructions
3. Create your first function
4. Deploy to Functions.do

For SDK documentation, see the [SDK Reference](/docs/sdk).
