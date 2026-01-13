# Rust Guide

Rust compiles to highly optimized WebAssembly (WASM), making it ideal for performance-critical functions on Functions.do. This guide covers setting up Rust for WASM development, using wasm-bindgen, and deploying to Functions.do.

## Quick Start

Get started with Rust and WASM:

```bash
# Install Rust if not already installed
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add the WASM target
rustup target add wasm32-unknown-unknown

# Install wasm-pack
cargo install wasm-pack
```

## Installation

### Prerequisites

1. **Rust toolchain**: Install via rustup
2. **wasm32-unknown-unknown target**: Required for WASM compilation
3. **wasm-pack**: Build tool for Rust-generated WASM
4. **wasm-bindgen**: Facilitates JS/WASM interop

```bash
# Install wasm-pack for building WASM packages
cargo install wasm-pack

# Install wasm-bindgen-cli for advanced usage
cargo install wasm-bindgen-cli
```

## Project Configuration

### Cargo.toml

Configure your Rust project for WASM:

```toml
[package]
name = "my-function"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
wasm-bindgen-futures = "0.4"
js-sys = "0.3"
web-sys = { version = "0.3", features = ["Request", "Response", "Headers"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
functions-do-sdk = "0.1"

[profile.release]
opt-level = "s"
lto = true
strip = true
codegen-units = 1
panic = "abort"
```

The `cdylib` crate type is required for generating a dynamic library that can be loaded as WASM.

### wrangler.toml

Configure wrangler for Rust WASM deployment:

```toml
name = "my-rust-function"
main = "build/worker/shim.mjs"
compatibility_date = "2024-01-01"

[build]
command = "wasm-pack build --target bundler --out-dir build"

[vars]
ENVIRONMENT = "production"
```

## Code Examples

### Hello World Function

A basic Rust function compiled to WASM:

```rust
use wasm_bindgen::prelude::*;

// Export the handler function to JavaScript
#[wasm_bindgen]
pub fn hello_world() -> String {
    // Return a simple greeting
    "Hello, World from Rust!".to_string()
}

// Main fetch handler for the worker
#[wasm_bindgen]
pub async fn fetch_handler(_request: web_sys::Request) -> Result<web_sys::Response, JsValue> {
    let response = web_sys::Response::new_with_opt_str(Some("Hello, World!"))?;
    Ok(response)
}
```

### JSON API Handler

Handle JSON requests with serde:

```rust
use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use web_sys::{Request, Response, Headers};

#[derive(Deserialize)]
struct RequestBody {
    name: String,
    age: u32,
}

#[derive(Serialize)]
struct ResponseBody {
    message: String,
    is_adult: bool,
    timestamp: String,
}

// JSON API handler with request/response processing
#[wasm_bindgen]
pub async fn handle_json(request: Request) -> Result<Response, JsValue> {
    // Parse request body
    let body_promise = request.text()?;
    let body_str = wasm_bindgen_futures::JsFuture::from(body_promise).await?;
    let body_text = body_str.as_string().unwrap_or_default();

    let input: RequestBody = serde_json::from_str(&body_text)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    // Create response
    let response = ResponseBody {
        message: format!("Hello, {}!", input.name),
        is_adult: input.age >= 18,
        timestamp: js_sys::Date::new_0().to_iso_string().into(),
    };

    let json = serde_json::to_string(&response)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    // Build response with headers
    let headers = Headers::new()?;
    headers.set("Content-Type", "application/json")?;

    let init = web_sys::ResponseInit::new();
    init.set_headers(&headers);

    Response::new_with_opt_str_and_init(Some(&json), &init)
}
```

### SDK Integration

Integrate with the Functions.do SDK:

```rust
use wasm_bindgen::prelude::*;
use functions_do_sdk::{FunctionsClient, Config};
use web_sys::{Request, Response};

// SDK integration with Functions.do
#[wasm_bindgen]
pub async fn handler_with_sdk(request: Request) -> Result<Response, JsValue> {
    // Initialize the Functions.do SDK client
    let config = Config::new("your-api-key");
    let client = FunctionsClient::new(config);

    // Log the request via SDK
    client.log("Request received").await?;

    // Get request URL
    let url = request.url();

    // Invoke another function if needed
    let result = client.invoke("helper-function", &serde_json::json!({
        "url": url
    })).await?;

    // Return response
    let response_body = format!("Processed: {:?}", result);
    Response::new_with_opt_str(Some(&response_body))
}
```

### Memory Management

Handle memory allocation and deallocation for complex data:

```rust
use wasm_bindgen::prelude::*;
use std::alloc::{alloc, dealloc, Layout};

// Custom allocator example for memory management
#[wasm_bindgen]
pub fn alloc_buffer(size: usize) -> *mut u8 {
    let layout = Layout::from_size_align(size, 1).unwrap();
    unsafe { alloc(layout) }
}

#[wasm_bindgen]
pub fn dealloc_buffer(ptr: *mut u8, size: usize) {
    let layout = Layout::from_size_align(size, 1).unwrap();
    unsafe { dealloc(ptr, layout) }
}

// Process data with explicit memory control
#[wasm_bindgen]
pub fn process_data(data: &[u8]) -> Vec<u8> {
    // Transform the data
    data.iter().map(|b| b.wrapping_add(1)).collect()
}
```

## Building

### Build Commands

Build your Rust project to WASM:

```bash
# Build with wasm-pack for bundler target
wasm-pack build --target bundler --out-dir pkg

# Or build directly with cargo
cargo build --target wasm32-unknown-unknown --release
```

### Binary Size Optimization

The `[profile.release]` settings in Cargo.toml optimize binary size:

- `opt-level = "s"`: Optimize for size
- `lto = true`: Enable Link-Time Optimization
- `strip = true`: Strip debug symbols
- `codegen-units = 1`: Single codegen unit for better optimization
- `panic = "abort"`: Remove panic unwinding code

Additional size reduction:

```bash
# Further optimize with wasm-opt
wasm-opt -Os -o output.wasm input.wasm

# Strip custom sections
wasm-strip output.wasm
```

## Testing

### Unit Tests

Test your Rust code:

```bash
# Run Rust tests
cargo test

# Run WASM-specific tests
wasm-pack test --headless --chrome
```

### Test Example

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hello_world() {
        let result = hello_world();
        assert_eq!(result, "Hello, World from Rust!");
    }

    #[test]
    fn test_process_data() {
        let input = vec![1, 2, 3];
        let output = process_data(&input);
        assert_eq!(output, vec![2, 3, 4]);
    }
}
```

## Deployment

Deploy your Rust WASM function to Functions.do:

```bash
# Build the WASM package
wasm-pack build --target bundler --release

# Deploy with wrangler
npx wrangler deploy
```

### Deployment Script

Create a build script for automated deployment:

```bash
#!/bin/bash
set -e

# Build WASM
wasm-pack build --target bundler --release --out-dir build

# Optimize binary size
wasm-opt -Os -o build/optimized.wasm build/my_function_bg.wasm

# Deploy to Functions.do
npx wrangler deploy
```

## SDK Usage

The Functions.do Rust SDK provides integration with the platform:

```rust
use functions_do_sdk::{FunctionsClient, Config, LogLevel};

// Configure SDK settings
let config = Config::builder()
    .api_key("your-api-key")
    .endpoint("https://api.functions.do")
    .timeout_ms(30000)
    .build();

let client = FunctionsClient::new(config);

// Log events
client.log_with_level(LogLevel::Info, "Function started").await?;

// Invoke other functions
let result = client.invoke("other-function", &payload).await?;

// Get function metadata
let metadata = client.get_metadata().await?;
```

## Troubleshooting

### Common Issues

#### wasm32-unknown-unknown Target Not Found

```bash
rustup target add wasm32-unknown-unknown
```

#### wasm-bindgen Version Mismatch

Ensure wasm-bindgen CLI version matches Cargo.toml:

```bash
cargo install wasm-bindgen-cli --version 0.2.x
```

#### Large Binary Size

1. Enable LTO in Cargo.toml
2. Use `opt-level = "s"` or `"z"`
3. Strip debug info with `strip = true`
4. Remove unused dependencies
5. Use `wasm-opt` for additional optimization

#### Memory Errors

Rust WASM has a linear memory model. Common issues:

- Stack overflow: Increase stack size or use heap allocation
- Out of memory: Monitor allocations, use `dealloc` properly
- Memory leaks: Ensure all allocated memory is freed

#### Import Errors

If you see "import not found" errors:

1. Check web-sys feature flags
2. Verify wasm-bindgen annotations
3. Ensure all JS imports are declared

### FAQ

**Q: Why use wasm-bindgen?**
A: wasm-bindgen generates JavaScript bindings for your Rust WASM module, handling type conversions and memory management automatically.

**Q: What's the typical binary size?**
A: Optimized Rust WASM binaries are typically 50KB-500KB depending on dependencies.

**Q: Can I use async/await?**
A: Yes, with wasm-bindgen-futures. Mark functions as `async` and use `.await`.

**Q: How do I debug WASM?**
A: Use `console_log!` macro or browser developer tools with source maps.

## Next Steps

- [SDK Reference](/docs/sdk/rust)
- [WASM Optimization Guide](/docs/advanced/wasm-optimization)
- [Examples Repository](https://github.com/dotdo/functions-examples-rust)
