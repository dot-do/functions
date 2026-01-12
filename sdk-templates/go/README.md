# Functions.do Go SDK Template

Go WASM module template for the Functions.do serverless platform.

## Overview

This template provides a starting point for building Go functions that compile to WebAssembly and run on Cloudflare Workers via the Functions.do platform.

## Exported Functions

- `add(a: int32, b: int32) -> int32` - Add two integers
- `subtract(a: int32, b: int32) -> int32` - Subtract b from a
- `multiply(a: int32, b: int32) -> int32` - Multiply two integers
- `get_answer() -> int32` - Returns 42

## Prerequisites

- [TinyGo](https://tinygo.org/getting-started/install/) 0.30+
- (Optional) [wasm-opt](https://github.com/WebAssembly/binaryen) for further optimization
- (Optional) [Node.js](https://nodejs.org/) for testing

### Installing TinyGo

```bash
# macOS
brew install tinygo

# Linux (Ubuntu/Debian)
wget https://github.com/tinygo-org/tinygo/releases/download/v0.30.0/tinygo_0.30.0_amd64.deb
sudo dpkg -i tinygo_0.30.0_amd64.deb

# Windows (with scoop)
scoop install tinygo
```

## Build

```bash
# Build WASM module (optimized for size)
make build

# Build with debug symbols
make build-debug

# Build with additional wasm-opt optimization
make optimize

# Check binary size
make size

# Clean build artifacts
make clean

# Run tests
make test

# Watch for changes and rebuild
make watch
```

## Target Size

This template targets **100KB - 2MB** output size for optimal performance on Cloudflare Workers.

The Makefile uses the following TinyGo flags for size optimization:

| Flag | Description |
|------|-------------|
| `-opt=s` | Optimize for size |
| `-no-debug` | Strip debug symbols |
| `-gc=leaking` | Use simpler garbage collector |
| `-scheduler=none` | Disable scheduler |

### Size Guidelines

- **< 100KB**: Excellent - fastest cold start times
- **100KB - 500KB**: Good - optimal for most use cases
- **500KB - 2MB**: Acceptable - may have slightly slower cold starts
- **> 2MB**: Warning - consider splitting into multiple modules

## Project Structure

```
.
├── main.go         # Main source file with exported functions
├── go.mod          # Go module definition
├── Makefile        # Build configuration
├── README.md       # This file
├── types.d.ts      # TypeScript type definitions (generated)
├── bindings.ts     # Capnweb RPC bindings (generated)
└── dist/           # Build output directory
    └── example.wasm
```

## Usage in TypeScript

```typescript
import { createExampleTarget } from './bindings'

// Load WASM bytes (varies by bundler)
const wasmBytes = await fetch('/example.wasm').then(r => r.arrayBuffer())

// Create capnweb RPC target
const target = await createExampleTarget(new Uint8Array(wasmBytes))

// Call exported functions
const sum = target.add(2, 3)        // 5
const product = target.multiply(6, 7) // 42
const answer = target.get_answer()   // 42
```

## go:wasmexport Directive

Functions are exported using the `//go:wasmexport` directive:

```go
// Documentation comment
//
//go:wasmexport functionName
func functionName(params...) returnType {
    // implementation
}
```

### Supported Types

| Go Type | WASM Type | TypeScript Type |
|---------|-----------|-----------------|
| `int32` | `i32` | `number` |
| `int64` | `i64` | `bigint` |
| `float32` | `f32` | `number` |
| `float64` | `f64` | `number` |
| `bool` | `i32` | `boolean` |

### Best Practices

1. **Keep functions simple**: Complex control flow increases binary size
2. **Avoid string operations**: String handling adds significant overhead
3. **Minimize allocations**: Use stack allocation when possible
4. **No goroutines**: The scheduler is disabled for size optimization
5. **No reflection**: Reflection significantly increases binary size

## Capnweb Integration

The generated `bindings.ts` provides a capnweb RpcTarget wrapper that:

- Wraps WASM exports as methods
- Provides TypeScript type safety
- Integrates with Functions.do's RPC system
- Supports the Disposable pattern for cleanup

```typescript
import { RpcTarget } from 'capnweb'

export class ExampleTarget extends RpcTarget {
  add(a: number, b: number): number { ... }
  subtract(a: number, b: number): number { ... }
  multiply(a: number, b: number): number { ... }
  get_answer(): number { ... }
}
```

## Customization

### Changing Module Name

1. Update `MODULE_NAME` in `Makefile`
2. Update `module` line in `go.mod`
3. Regenerate TypeScript bindings

### Adding New Functions

1. Add function to `main.go` with `//go:wasmexport` directive
2. Run `make build` to verify compilation
3. Run `make test` to test the function
4. Regenerate TypeScript types using Functions.do CLI

## Troubleshooting

### "TinyGo not found"

Install TinyGo following the instructions above, or ensure it's in your PATH.

### Binary too large

1. Check for unnecessary imports
2. Avoid string operations
3. Use simpler data structures
4. Enable `-opt=z` for maximum size optimization (may be slower)

### Function not exported

Ensure the `//go:wasmexport` directive is:
- Directly above the function (no blank lines)
- Using the correct export name
- The function is in the `main` package

## License

MIT

## Resources

- [TinyGo Documentation](https://tinygo.org/docs/)
- [WebAssembly on Cloudflare Workers](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)
- [Functions.do Documentation](https://functions.do/docs)
- [go:wasmexport Proposal](https://github.com/golang/go/issues/65199)
