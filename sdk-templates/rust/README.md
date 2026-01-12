# Functions.do Rust SDK Template

Build high-performance serverless functions with Rust compiled to WebAssembly for the Functions.do platform.

## Quick Start

1. **Install dependencies**
   ```bash
   # Install Rust (if not already installed)
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

   # Install wasm-pack
   cargo install wasm-pack

   # Add WASM target
   rustup target add wasm32-unknown-unknown
   ```

2. **Create your function**

   Edit `src/lib.rs` and add your function:
   ```rust
   use wasm_bindgen::prelude::*;

   #[wasm_bindgen]
   pub fn my_function(input: i32) -> i32 {
       input * 2
   }
   ```

3. **Build**
   ```bash
   ./build.sh release
   ```

4. **Deploy**
   ```bash
   func deploy pkg/
   ```

## Function Types

### Basic Numeric Functions

For simple numeric operations, use standard Rust types:

```rust
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[wasm_bindgen]
pub fn factorial(n: u32) -> u64 {
    (1..=n as u64).product()
}
```

### String Functions

Handle string input/output with automatic memory management:

```rust
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

#[wasm_bindgen]
pub fn reverse(s: &str) -> String {
    s.chars().rev().collect()
}
```

### JSON Functions (with serde)

Enable the `json` feature in `Cargo.toml` for JSON serialization:

```rust
use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct User {
    name: String,
    age: u32,
}

#[wasm_bindgen]
pub fn process_user(json: &str) -> String {
    let user: User = serde_json::from_str(json).unwrap();
    let response = format!("{} is {} years old", user.name, user.age);
    serde_json::to_string(&response).unwrap()
}
```

### Raw C FFI (No wasm-bindgen overhead)

For maximum performance with numeric types:

```rust
#[no_mangle]
pub extern "C" fn fast_add(a: i32, b: i32) -> i32 {
    a + b
}
```

## capnweb Integration

The SDK includes capnweb-style RPC support for efficient cross-worker communication:

```rust
use crate::{CapnwebBuffer, CapnwebReader};

// Serialize a response
let mut buf = CapnwebBuffer::new();
buf.write_i32(result);
buf.write_string("success");

// Deserialize a request
let mut reader = CapnwebReader::new(data);
let param1 = reader.read_i32().unwrap();
let param2 = reader.read_string().unwrap();
```

## Optimization Tips

### Target Size: 10-50KB

1. **Use `#[no_mangle]` for simple functions**
   - Avoids wasm-bindgen glue code overhead

2. **Minimize dependencies**
   - Each crate adds to binary size
   - Use `cargo tree` to audit dependencies

3. **Use feature flags**
   ```toml
   [features]
   default = []
   json = ["serde", "serde_json"]
   ```

4. **Release profile optimization**
   Already configured in `Cargo.toml`:
   ```toml
   [profile.release]
   opt-level = "z"     # Optimize for size
   lto = true          # Link-time optimization
   codegen-units = 1   # Single codegen unit
   panic = "abort"     # No unwinding
   strip = true        # Strip symbols
   ```

5. **Use wasm-opt**
   The build script automatically runs `wasm-opt -Oz` if available:
   ```bash
   cargo install wasm-opt
   ```

## Project Structure

```
my-function/
├── Cargo.toml        # Dependencies and build config
├── src/
│   └── lib.rs        # Your function code
├── build.sh          # Build script
├── pkg/              # Generated WASM output
│   ├── my_function.wasm
│   ├── my_function.js
│   └── my_function.d.ts
└── README.md
```

## Testing

Run Rust tests:
```bash
cargo test
```

Test WASM output:
```bash
# Using Node.js
node -e "
  const fs = require('fs');
  const wasm = fs.readFileSync('pkg/my_function_bg.wasm');
  WebAssembly.instantiate(wasm).then(({instance}) => {
    console.log(instance.exports.add(2, 3));
  });
"
```

## Memory Management

For functions that allocate memory (strings, vectors), the SDK provides:

- `alloc(size)` - Allocate bytes in WASM linear memory
- `dealloc(ptr, size)` - Free allocated memory

The TypeScript bindings handle this automatically when using `wasm-bindgen`.

## Troubleshooting

### "wasm-pack not found"
```bash
cargo install wasm-pack
```

### "wasm32-unknown-unknown target not found"
```bash
rustup target add wasm32-unknown-unknown
```

### Output too large
1. Check dependencies: `cargo tree`
2. Remove debug symbols: Ensure `strip = true` in release profile
3. Run wasm-opt: `cargo install wasm-opt`

### Runtime errors
1. Build with debug profile: `./build.sh dev`
2. Check browser console for WASM errors
3. Enable `console_error_panic_hook` for better error messages:
   ```rust
   #[wasm_bindgen(start)]
   pub fn init() {
       console_error_panic_hook::set_once();
   }
   ```

## Resources

- [Functions.do Documentation](https://functions.do/docs)
- [wasm-bindgen Book](https://rustwasm.github.io/wasm-bindgen/)
- [Rust and WebAssembly Book](https://rustwasm.github.io/docs/book/)
- [wasm-pack Documentation](https://rustwasm.github.io/wasm-pack/)
