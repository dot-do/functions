# Functions.do Zig SDK Template

Build ultra-efficient serverless functions with Zig compiled to WebAssembly for the Functions.do platform.

## Why Zig?

- **Tiny binaries**: 10-50KB typical WASM output (vs 100KB+ for other languages)
- **Zero runtime overhead**: No garbage collector, no hidden allocations
- **Memory safety**: Compile-time guarantees without runtime cost
- **C interop**: Easy integration with existing C libraries
- **Predictable performance**: No hidden runtime behavior

## Quick Start

1. **Install Zig**
   ```bash
   # macOS
   brew install zig

   # Linux
   # Download from https://ziglang.org/download/

   # Verify installation
   zig version
   ```

2. **Create your function**

   Edit `src/main.zig` and add your function:
   ```zig
   export fn my_function(input: i32) i32 {
       return input * 2;
   }
   ```

3. **Build**
   ```bash
   zig build -Doptimize=ReleaseSmall
   ```

4. **Check binary size**
   ```bash
   zig build size
   # Output: 1234 bytes (1KB)
   ```

5. **Deploy**
   ```bash
   func deploy zig-out/bin/functions.wasm
   ```

## Function Types

### Basic Numeric Functions

For simple numeric operations, use standard Zig types:

```zig
// Integer operations
export fn add(a: i32, b: i32) i32 {
    return a + b;
}

// 64-bit integers
export fn add_i64(a: i64, b: i64) i64 {
    return a + b;
}

// Floating point
export fn multiply_f64(a: f64, b: f64) f64 {
    return a * b;
}

// Boolean
export fn is_positive(x: i32) bool {
    return x > 0;
}
```

### Void Functions

For side-effect only functions:

```zig
export fn log_event() void {
    // Perform side effect
}
```

### String/Buffer Functions

Handle string data using pointers and lengths:

```zig
export fn string_length(ptr: [*]const u8, len: usize) usize {
    const slice = ptr[0..len];
    // Process string...
    return slice.len;
}

export fn process_buffer(src: [*]const u8, src_len: usize, dst: [*]u8) usize {
    const input = src[0..src_len];
    // Transform input to output...
    @memcpy(dst[0..src_len], input);
    return src_len;
}
```

### Memory Allocation

For functions that need to return allocated data:

```zig
export fn alloc(size: usize) ?[*]u8 {
    const slice = std.heap.page_allocator.alloc(u8, size) catch return null;
    return slice.ptr;
}

export fn dealloc(ptr: [*]u8, size: usize) void {
    const slice = ptr[0..size];
    std.heap.page_allocator.free(slice);
}
```

## capnweb Integration

The SDK includes capnweb-style serialization for efficient RPC:

```zig
const CapnwebBuffer = @import("main.zig").CapnwebBuffer;
const CapnwebReader = @import("main.zig").CapnwebReader;

// Serialize a response
var buf = CapnwebBuffer.init(allocator);
defer buf.deinit();
try buf.writeI32(result);
try buf.writeString("success");

// Deserialize a request
var reader = CapnwebReader.init(data);
const param1 = reader.readI32() orelse return error.InvalidData;
const str = reader.readString() orelse return error.InvalidData;
```

## Generated Bindings

Functions.do automatically generates TypeScript types and capnweb bindings from your Zig exports:

### TypeScript Types (`types.d.ts`)

```typescript
export interface FunctionsExports {
  add(a: number, b: number): number
  multiply(a: number, b: number): number
  memory: WebAssembly.Memory
}

export interface AddParams {
  a: number
  b: number
}
```

### capnweb Bindings (`bindings.ts`)

```typescript
import { RpcTarget } from 'capnweb'

export class FunctionsTarget extends RpcTarget {
  add(a: number, b: number): number { ... }
  multiply(a: number, b: number): number { ... }
}

export async function createFunctionsTarget(wasmBytes: Uint8Array): Promise<FunctionsTarget>
```

## Optimization Tips

### Target Size: 10-50KB

1. **Use ReleaseSmall optimization**
   ```bash
   zig build -Doptimize=ReleaseSmall
   ```

2. **Minimize standard library usage**
   - Avoid `std.fmt` (adds ~30KB)
   - Avoid `std.json` (adds ~50KB)
   - Use minimal allocators

3. **Avoid comptime string formatting**
   ```zig
   // Avoid (adds code size)
   const msg = std.fmt.comptimePrint("value: {}", .{x});

   // Prefer (zero cost)
   const msg = "value: ";
   ```

4. **Use `@setRuntimeSafety(false)` for hot paths**
   ```zig
   fn hot_path(x: i32) i32 {
       @setRuntimeSafety(false);
       // Removes bounds checks, overflow checks
       return x * 2;
   }
   ```

5. **Strip symbols in release**
   Already configured in `build.zig`:
   ```zig
   lib.root_module.strip = true;
   ```

## Project Structure

```
my-function/
├── build.zig         # Build configuration
├── src/
│   └── main.zig      # Your function code
├── zig-out/
│   └── bin/
│       └── functions.wasm  # Output WASM
└── README.md
```

## Testing

Run Zig tests:
```bash
zig build test
```

Test WASM output:
```bash
# Using Node.js
node -e "
  const fs = require('fs');
  const wasm = fs.readFileSync('zig-out/bin/functions.wasm');
  WebAssembly.instantiate(wasm).then(({instance}) => {
    console.log('add(2, 3) =', instance.exports.add(2, 3));
  });
"
```

## Build Commands

| Command | Description |
|---------|-------------|
| `zig build` | Build debug WASM |
| `zig build -Doptimize=ReleaseSmall` | Build optimized (smallest) |
| `zig build -Doptimize=ReleaseFast` | Build optimized (fastest) |
| `zig build test` | Run unit tests |
| `zig build size` | Show binary size |
| `zig build clean` | Remove build artifacts |
| `zig build deploy` | Deploy to Functions.do |

## Type Mapping

| Zig Type | WASM Type | TypeScript Type |
|----------|-----------|-----------------|
| `i8`, `i16`, `i32` | `i32` | `number` |
| `u8`, `u16`, `u32` | `i32` | `number` |
| `i64`, `u64` | `i64` | `bigint` |
| `f32` | `f32` | `number` |
| `f64` | `f64` | `number` |
| `bool` | `i32` | `boolean` |
| `usize`, `isize` | `i32` | `number` |
| `[*]u8` | `i32` | `number` (pointer) |
| `void` | - | `void` |

## Troubleshooting

### "zig not found"
```bash
# macOS
brew install zig

# Or download from https://ziglang.org/download/
```

### "WASM validation failed"
- Ensure you're using `export fn` (not just `pub fn`)
- Check that all types are WASM-compatible

### Binary too large
1. Check optimization: `zig build -Doptimize=ReleaseSmall`
2. Audit imports: `wasm-objdump -x zig-out/bin/functions.wasm | grep Import`
3. Use `wasm-opt` for additional size reduction:
   ```bash
   wasm-opt -Oz zig-out/bin/functions.wasm -o optimized.wasm
   ```

### Memory issues
- Default stack size is 64KB
- Increase in build.zig if needed:
  ```zig
  lib.stack_size = 256 * 1024; // 256KB
  ```

## Resources

- [Functions.do Documentation](https://functions.do/docs)
- [Zig Language Reference](https://ziglang.org/documentation/master/)
- [Zig WebAssembly](https://ziglang.org/documentation/master/#WebAssembly)
- [WebAssembly Specification](https://webassembly.github.io/spec/)
