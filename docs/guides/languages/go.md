# Go Guide

Go functions on Functions.do are compiled to WebAssembly using TinyGo, a Go compiler designed for small places. This guide covers TinyGo installation, WASI target configuration, and deploying Go functions.

## Why TinyGo?

Standard Go produces large WASM binaries (10MB+) unsuitable for serverless functions. TinyGo is specifically designed for WASM and embedded systems, producing small binaries (typically under 1MB) with fast cold starts.

Key benefits:
- Much smaller binary size compared to standard Go
- Better WASM/WASI support
- Optimized for resource-constrained environments
- Compatible with most Go code

## Quick Start

Install TinyGo and create your first function:

```bash
# Install TinyGo (macOS)
brew install tinygo

# Install TinyGo (Linux)
wget https://github.com/tinygo-org/tinygo/releases/download/v0.31.0/tinygo_0.31.0_amd64.deb
sudo dpkg -i tinygo_0.31.0_amd64.deb

# Verify installation
tinygo version
```

## Installation

### Prerequisites

1. **Go 1.21+**: Required for WASM support
2. **TinyGo**: Compiler for WASM targets
3. **WASI SDK**: WebAssembly System Interface support

```bash
# Check Go version (1.21 or higher required)
go version

# Install TinyGo
# macOS
brew install tinygo

# Linux (Ubuntu/Debian)
wget https://github.com/tinygo-org/tinygo/releases/download/v0.31.0/tinygo_0.31.0_amd64.deb
sudo dpkg -i tinygo_0.31.0_amd64.deb

# Windows
scoop install tinygo
```

## Project Configuration

### go.mod

Initialize your Go module:

```text
module my-function

go 1.21

require (
    github.com/dotdo/functions-go-sdk v0.1.0
)
```

### wrangler.toml

Configure wrangler for Go WASM deployment:

```toml
name = "my-go-function"
main = "build/worker.mjs"
compatibility_date = "2024-01-01"

[build]
command = "make build"

[vars]
ENVIRONMENT = "production"
```

### Makefile

Create a Makefile for build automation:

```makefile
.PHONY: build clean test

BINARY_NAME=main.wasm
BUILD_DIR=build

build:
	mkdir -p $(BUILD_DIR)
	tinygo build -o $(BUILD_DIR)/$(BINARY_NAME) -target=wasi -opt=2 -no-debug ./main.go
	@echo "Binary size: $$(ls -lh $(BUILD_DIR)/$(BINARY_NAME) | awk '{print $$5}')"

clean:
	rm -rf $(BUILD_DIR)

test:
	go test -v ./...

optimize: build
	wasm-opt -Os -o $(BUILD_DIR)/optimized.wasm $(BUILD_DIR)/$(BINARY_NAME)
```

## Code Examples

### Hello World Function

A basic Go function for WASI:

```go
package main

import (
	"fmt"
)

// Simple hello world function
func main() {
	fmt.Println("Hello, World from Go!")
}

//go:wasmexport hello
func hello() int32 {
	// Return a greeting identifier
	return 42
}
```

### HTTP Handler

Handle HTTP requests with WASI:

```go
package main

import (
	"encoding/json"
	"fmt"
)

// Request structure for JSON parsing
type Request struct {
	Name string `json:"name"`
	Age  int32  `json:"age"`
}

// Response structure for JSON output
type Response struct {
	Message  string `json:"message"`
	IsAdult  bool   `json:"is_adult"`
	Greeting string `json:"greeting"`
}

//go:wasmexport handler
func handler(inputPtr int32, inputLen int32) int64 {
	// Read input from linear memory
	input := readMemory(inputPtr, inputLen)

	// Parse JSON request
	var req Request
	if err := json.Unmarshal(input, &req); err != nil {
		return writeError("Invalid JSON")
	}

	// Build response
	resp := Response{
		Message:  fmt.Sprintf("Hello, %s!", req.Name),
		IsAdult:  req.Age >= 18,
		Greeting: "Welcome to Functions.do",
	}

	// Return JSON response
	return writeResponse(resp)
}

func main() {
	// Required for TinyGo WASM
}
```

### SDK Integration

Integrate with the Functions.do SDK:

```go
package main

import (
	"encoding/json"
	"fmt"

	sdk "github.com/dotdo/functions-go-sdk"
)

// Configuration settings for the SDK
type Config struct {
	APIKey   string
	Endpoint string
}

//go:wasmexport fetch_with_sdk
func fetchWithSDK(requestPtr int32, requestLen int32) int64 {
	// Initialize SDK client
	client := sdk.NewClient(sdk.Options{
		APIKey: getEnvVar("API_KEY"),
	})

	// Log the incoming request
	client.Log("Request received", sdk.LogInfo)

	// Parse request data
	data := readMemory(requestPtr, requestLen)
	var payload map[string]interface{}
	json.Unmarshal(data, &payload)

	// Invoke another function via SDK
	result, err := client.Invoke("helper-function", payload)
	if err != nil {
		return writeError(err.Error())
	}

	// Return the result
	return writeJSON(result)
}

func main() {}
```

### Memory Utilities

Helper functions for WASM memory management:

```go
package main

import (
	"encoding/json"
	"unsafe"
)

// Global memory buffer for WASM exports
var memoryBuffer []byte

//go:wasmexport alloc
func alloc(size int32) int32 {
	memoryBuffer = make([]byte, size)
	return int32(uintptr(unsafe.Pointer(&memoryBuffer[0])))
}

//go:wasmexport dealloc
func dealloc(ptr int32, size int32) {
	// Memory will be garbage collected
	memoryBuffer = nil
}

func readMemory(ptr int32, length int32) []byte {
	return unsafe.Slice((*byte)(unsafe.Pointer(uintptr(ptr))), length)
}

func writeResponse(data interface{}) int64 {
	bytes, _ := json.Marshal(data)
	ptr := alloc(int32(len(bytes)))
	copy(memoryBuffer, bytes)
	// Return ptr in high 32 bits, length in low 32 bits
	return int64(ptr)<<32 | int64(len(bytes))
}

func writeError(msg string) int64 {
	return writeResponse(map[string]string{"error": msg})
}

func writeJSON(data interface{}) int64 {
	return writeResponse(data)
}

func getEnvVar(name string) string {
	// Environment variable access implementation
	return ""
}

func main() {}
```

## Building

### Build Commands

Build your Go project to WASM with TinyGo:

```bash
# Basic build with WASI target
tinygo build -o main.wasm -target=wasi ./main.go

# Optimized build with size reduction
tinygo build -o main.wasm -target=wasi -opt=2 -no-debug ./main.go

# Build with scheduler disabled (smaller binary)
tinygo build -o main.wasm -target=wasi -opt=2 -no-debug -scheduler=none ./main.go
```

### Optimization Flags

TinyGo optimization options:

| Flag | Description |
|------|-------------|
| `-opt=0` | No optimization |
| `-opt=1` | Basic optimization |
| `-opt=2` | Full optimization (recommended) |
| `-opt=s` | Optimize for size |
| `-opt=z` | Aggressively optimize for size |
| `-no-debug` | Strip debug information |
| `-scheduler=none` | Disable goroutine scheduler |

### Binary Size Considerations

Tips for reducing binary size:

1. Use `-opt=2` or `-opt=s`
2. Add `-no-debug` to strip debug info
3. Disable scheduler if not using goroutines
4. Minimize standard library imports
5. Use `wasm-opt` for additional optimization

```bash
# Further optimize with wasm-opt
wasm-opt -Os -o optimized.wasm main.wasm
```

## WASM Types

TinyGo WASM exports support these WASM-compatible types:

| Go Type | WASM Type | Notes |
|---------|-----------|-------|
| `int32` | `i32` | 32-bit integer |
| `int64` | `i64` | 64-bit integer |
| `float32` | `f32` | 32-bit float |
| `float64` | `f64` | 64-bit float |
| `unsafe.Pointer` | `i32` | Memory pointer |

Complex types (strings, structs) must be passed via linear memory using pointers.

## Testing

### Unit Tests

Test your Go code locally:

```bash
# Run Go tests
go test -v ./...

# Run with race detector
go test -race ./...
```

### WASM Testing

```bash
# Build and test WASM output
tinygo build -o test.wasm -target=wasi ./main.go
wasmtime test.wasm
```

## Deployment

Deploy your Go WASM function to Functions.do:

```bash
# Build the WASM binary
make build

# Deploy with wrangler
npx wrangler deploy
```

### Deployment Workflow

```bash
#!/bin/bash
set -e

# Clean previous build
make clean

# Build optimized WASM
make build

# Run tests
make test

# Deploy to Functions.do
npx wrangler deploy

echo "Deployment complete!"
```

## SDK Configuration

The Functions.do Go SDK provides integration options:

```go
package main

import sdk "github.com/dotdo/functions-go-sdk"

// InitializeSDK creates and configures the SDK client
func InitializeSDK() *sdk.Client {
    // Create SDK client with configuration
    client := sdk.NewClient(sdk.Options{
        APIKey:   "your-api-key",
        Endpoint: "https://api.functions.do",
        Timeout:  30000,
        Debug:    false,
    })

    // Use SDK methods
    client.Log("Function started", sdk.LogInfo)

    result, err := client.Invoke("other-function", map[string]interface{}{
        "key": "value",
    })
    if err != nil {
        return nil
    }

    _ = result
    metadata := client.GetMetadata()
    _ = metadata

    return client
}
```

## Troubleshooting

### Common Issues

#### TinyGo Not Found

```bash
# Verify TinyGo installation
tinygo version

# Check PATH
which tinygo
```

#### Unsupported Package

Some standard library packages aren't supported by TinyGo. Check compatibility:

```bash
tinygo info -target=wasi
```

Common unsupported packages:
- `net/http` (use alternatives)
- `reflect` (limited support)
- `unsafe` (some functions)

#### Large Binary Size

If your binary exceeds 1MB:

1. Check imports for unnecessary packages
2. Use optimization flags
3. Disable scheduler if possible
4. Run wasm-opt post-build

```bash
# Check what's in your binary
tinygo build -o main.wasm -target=wasi -print-allocs=. ./main.go
```

#### Memory Issues

WASM has linear memory model:

- Default memory: 64KB-256KB
- Maximum: Configurable
- Stack size: Limited

```go
package main

// MemoryConfig holds memory configuration settings
// Increase memory if needed with: tinygo build -heap-size=1048576 ...
func configureMemory() {
    // Memory configuration is done at build time
}
```

### FAQ

**Q: Why TinyGo instead of standard Go?**
A: Standard Go produces 10MB+ WASM binaries. TinyGo produces binaries under 1MB, suitable for serverless.

**Q: What Go version is required?**
A: Go 1.21 or higher for full WASM support.

**Q: Can I use goroutines?**
A: Yes, but they increase binary size. Use `-scheduler=none` if not needed.

**Q: How do I pass strings to WASM exports?**
A: Use linear memory with pointer/length pairs. See memory utilities example.

**Q: What's the typical binary size?**
A: 100KB-500KB for most functions with TinyGo.

## Next Steps

- [SDK Reference](/docs/sdk/go)
- [TinyGo Documentation](https://tinygo.org/docs/)
- [Examples Repository](https://github.com/dotdo/functions-examples-go)
