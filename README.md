# Functions.do

**Write functions in any language. Run globally in milliseconds.**

```typescript
// TypeScript
export default async (event) => {
  return { message: `Hello, ${event.name}!` }
}
```

```rust
// Rust
#[func]
pub fn hello(name: String) -> String {
    format!("Hello, {}!", name)
}
```

```python
# Python
def hello(name: str) -> str:
    return f"Hello, {name}!"
```

```go
// Go
func Hello(name string) string {
    return fmt.Sprintf("Hello, %s!", name)
}
```

```csharp
// C#
public string Hello(string name) => $"Hello, {name}!";
```

One platform. Every language. Zero cold starts.

---

## The Problem

You want to build serverless functions. But you're forced to choose:

- **Language lock-in** — Most platforms only support JavaScript or Python well
- **Cold start pain** — Heavy runtimes (Python, .NET, JVM) take seconds to start
- **Region limitations** — Your code runs in one region, far from your users
- **Complexity overhead** — Containers, Kubernetes, infrastructure as code...

What if you could just write a function and have it run everywhere, instantly?

---

## The Solution

**Functions.do** lets you write functions in your favorite language and runs them globally on Cloudflare's edge network — in secure V8 isolates with infinite scalability.

```
Your Code (Any Language)
        ↓
   Compile to ESM/WASM
        ↓
   Deploy Globally (300+ locations)
        ↓
   Execute in <10ms (zero cold starts)
```

### How It Works

1. **Write** functions in TypeScript, Rust, Python, Go, C#, Zig, or AssemblyScript
2. **Compile** to ESM (JavaScript) or WebAssembly automatically
3. **Deploy** to Cloudflare's global network with one command
4. **Scale** infinitely — from zero to millions of requests per second

---

## Architecture

Functions.do uses a **distributed runtime architecture** that eliminates cold starts for even the heaviest runtimes:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Your Function (~KB)                          │
│              Thin stub with your business logic                 │
└─────────────────────────┬───────────────────────────────────────┘
                          │ capnweb RPC (zero latency)
          ┌───────────────┼───────────────┬───────────────┐
          ▼               ▼               ▼               ▼
   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
   │   Core      │ │    Web      │ │    Data     │ │     ML      │
   │  Runtime    │ │  Runtime    │ │  Runtime    │ │  Runtime    │
   │  (shared)   │ │  (shared)   │ │  (shared)   │ │  (shared)   │
   └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
        │               │               │               │
        └───────────────┴───────────────┴───────────────┘
                    Always warm (99.99%)
                    via Cloudflare sharding
```

**Your function code stays tiny** — runtime capabilities are shared across all functions and kept warm by Cloudflare's intelligent request routing.

### Language Support

| Language | Target | Cold Start | Binary Size |
|----------|--------|------------|-------------|
| **TypeScript** | ESM | Instant | <50KB |
| **Rust** | WASM | <10ms | 10-50KB |
| **AssemblyScript** | WASM | <5ms | 5-20KB |
| **Go** | WASM | <50ms | 100KB-2MB |
| **Python** | Pyodide | ~1s* | Native |
| **Zig** | WASM | <10ms | 10-100KB |
| **C#** | WASM | <100ms* | Shared runtime |

*With memory snapshots and distributed runtime architecture

---

## Quick Start

### TypeScript (Fastest path)

```bash
npx create-function hello --lang typescript
cd hello
npm run dev    # Local development with miniflare
npm run deploy # Deploy globally
```

### Rust

```bash
npx create-function hello --lang rust
cd hello
cargo build --target wasm32-unknown-unknown
npx dotdo deploy
```

### Python

```bash
npx create-function hello --lang python
cd hello
npx dotdo dev    # Local development
npx dotdo deploy # Deploy globally
```

---

## SDK

Install the official SDK to invoke functions programmatically:

```bash
npm install @dotdo/functions
```

```typescript
import { FunctionClient } from '@dotdo/functions'

const client = new FunctionClient({
  baseUrl: 'https://functions.do',
  apiKey: process.env.FUNCTIONS_API_KEY
})

// Invoke a function
const result = await client.invoke('my-function', { name: 'World' })
console.log(result.data) // { message: 'Hello, World!' }

// Deploy a function
await client.deploy('export default () => ({ hello: "world" })', {
  id: 'my-function',
  language: 'typescript'
})

// List all functions
const functions = await client.list()
```

---

## Features

### Global by Default
Your function runs in 300+ Cloudflare locations worldwide. Requests are routed to the nearest edge, typically under 50ms from any user.

### Zero Cold Starts
Cloudflare's "Shard and Conquer" routing keeps your functions warm 99.99% of the time. Heavy runtimes use shared runtime workers that stay perpetually warm.

### Secure Isolation
Every function executes in its own V8 isolate — the same technology that powers Chrome. Complete memory isolation, no shared state between requests.

### Infinite Scale
Scale from zero to millions of requests per second automatically. No capacity planning, no provisioning, no limits.

### Built on capnweb
[capnweb](https://github.com/cloudflare/capnweb) provides zero-latency RPC between workers. Your functions can call other functions, access databases, and compose capabilities with no network overhead.

---

## Pricing

| Tier | Requests | Price |
|------|----------|-------|
| **Free** | 100K/day | $0 |
| **Pro** | 10M/month | $20/month |
| **Business** | Unlimited | Custom |

No cold start penalties. No duration charges for waiting on I/O. Pay only for compute time.

---

## Why Functions.do?

### vs AWS Lambda
- **No cold starts** — Lambda can take seconds to cold start heavy runtimes
- **Global by default** — Lambda runs in one region unless you configure multi-region
- **Any language** — Lambda has limited first-class language support

### vs Cloudflare Workers (raw)
- **Multi-language** — Workers are JavaScript-first; Functions.do compiles any language
- **Higher abstraction** — Write functions, not HTTP handlers
- **Shared runtimes** — Heavy languages get distributed runtime architecture

### vs Vercel/Netlify Functions
- **True edge** — Functions.do runs on Cloudflare's 300+ locations, not regional
- **WASM support** — First-class Rust, Go, Zig support via WebAssembly
- **Zero vendor lock-in** — Standard ESM/WASM outputs

---

## Roadmap

- [x] TypeScript → ESM compilation
- [x] Rust → WASM compilation
- [x] Python via Pyodide (with memory snapshots)
- [x] Go → WASM (TinyGo)
- [x] AssemblyScript → WASM
- [x] C# distributed runtime
- [x] Zig → WASM
- [ ] JVM distributed runtime

---

## Documentation

- [Getting Started](https://functions.do/docs/getting-started)
- [Language Guides](https://functions.do/docs/languages)
- [Architecture Deep Dive](https://functions.do/docs/architecture)
- [capnweb Integration](https://functions.do/docs/capnweb)
- [API Reference](https://functions.do/docs/api)

---

## Contributing

Functions.do is open source. We welcome contributions for:

- New language support
- Runtime optimizations
- Documentation improvements
- Bug fixes

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## License

MIT License. See [LICENSE](./LICENSE) for details.

---

<p align="center">
  <strong>Functions.do</strong> — Write anywhere. Run everywhere.
</p>

<p align="center">
  <a href="https://functions.do">Website</a> •
  <a href="https://functions.do/docs">Docs</a> •
  <a href="https://discord.gg/functions-do">Discord</a> •
  <a href="https://twitter.com/functions_do">Twitter</a>
</p>
