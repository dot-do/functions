# Functions.do AssemblyScript SDK Template

Build high-performance serverless functions with AssemblyScript compiled to WebAssembly for the Functions.do platform.

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create your function**

   Edit `assembly/index.ts` and add your function:
   ```typescript
   export function myFunction(input: i32): i32 {
     return input * 2
   }
   ```

3. **Build**
   ```bash
   npm run build
   ```

4. **Deploy**
   ```bash
   func deploy build/
   ```

## Project Structure

```
my-function/
├── assembly/
│   └── index.ts        # Your AssemblyScript code
├── build/
│   ├── release.wasm    # Optimized WASM output
│   ├── release.wat     # Human-readable WAT format
│   ├── debug.wasm      # Debug WASM output
│   └── debug.wat       # Debug WAT format
├── types.d.ts          # Generated TypeScript types
├── bindings.ts         # Generated capnweb bindings
├── asconfig.json       # AssemblyScript compiler config
├── package.json        # NPM configuration
└── README.md
```

## AssemblyScript Types

AssemblyScript uses WebAssembly-native types:

| AS Type | Description | TS Equivalent |
|---------|-------------|---------------|
| `i8`    | Signed 8-bit integer | `number` |
| `i16`   | Signed 16-bit integer | `number` |
| `i32`   | Signed 32-bit integer | `number` |
| `i64`   | Signed 64-bit integer | `bigint` |
| `u8`    | Unsigned 8-bit integer | `number` |
| `u16`   | Unsigned 16-bit integer | `number` |
| `u32`   | Unsigned 32-bit integer | `number` |
| `u64`   | Unsigned 64-bit integer | `bigint` |
| `f32`   | 32-bit float | `number` |
| `f64`   | 64-bit float | `number` |
| `bool`  | Boolean | `boolean` |

## Function Examples

### Basic Numeric Functions

```typescript
// Simple addition
export function add(a: i32, b: i32): i32 {
  return a + b
}

// Factorial with 64-bit result
export function factorial(n: i32): i64 {
  if (n <= 1) return 1
  let result: i64 = 1
  for (let i: i32 = 2; i <= n; i++) {
    result *= i64(i)
  }
  return result
}
```

### Floating Point Functions

```typescript
// Distance calculation
export function distance(x1: f64, y1: f64, x2: f64, y2: f64): f64 {
  const dx = x2 - x1
  const dy = y2 - y1
  return Math.sqrt(dx * dx + dy * dy)
}

// Circle area
export function circleArea(radius: f64): f64 {
  return Math.PI * radius * radius
}
```

### Mathematical Algorithms

```typescript
// Fibonacci sequence
export function fibonacci(n: i32): i64 {
  if (n <= 1) return i64(n)
  let a: i64 = 0
  let b: i64 = 1
  for (let i: i32 = 2; i <= n; i++) {
    const temp = a + b
    a = b
    b = temp
  }
  return b
}

// Prime check
export function isPrime(n: i32): bool {
  if (n < 2) return false
  if (n === 2) return true
  if (n % 2 === 0) return false
  for (let i: i32 = 3; i * i <= n; i += 2) {
    if (n % i === 0) return false
  }
  return true
}
```

## capnweb Integration

The SDK generates capnweb RPC bindings automatically. Use them in other Workers:

```typescript
import { createModuleTarget } from './bindings'

// Load and instantiate WASM
const wasmBytes = await env.ASSETS.fetch('/function.wasm')
  .then(r => r.arrayBuffer())
  .then(b => new Uint8Array(b))

const target = await createModuleTarget(wasmBytes)

// Call functions directly
const sum = target.add(5, 3)      // 8
const fact = target.factorial(10) // 3628800n (bigint)
```

## Build Configuration

### Optimization Levels

The `asconfig.json` file configures two build targets:

**Debug** (`npm run build:debug`):
- Source maps enabled
- Debug info included
- No optimization
- Larger binary, easier debugging

**Release** (`npm run build`):
- Full optimization (level 3)
- Size optimization (shrink level 2)
- Assertions removed
- Smaller binary, maximum performance

### Target Binary Size: 5-20KB

For simple numeric functions, expect:
- ~5-10KB for basic operations
- ~10-20KB for mathematical algorithms
- Larger for string/memory operations

### Size Optimization Tips

1. **Use `runtime: "stub"`** (already configured)
   - Smallest runtime, no GC overhead
   - Perfect for pure functions

2. **Avoid managed types**
   - Strings and arrays need runtime support
   - Use raw memory operations when possible

3. **Enable WASM features**
   - SIMD for parallel operations
   - Bulk memory for efficient copies
   - Sign extension for smaller i32/i64 conversions

## Memory Management

For functions that need memory allocation:

```typescript
// Simple bump allocator
let heapOffset: usize = 1024

export function alloc(size: usize): usize {
  const ptr = heapOffset
  heapOffset += size
  heapOffset = (heapOffset + 7) & ~7  // 8-byte align
  return ptr
}

export function dealloc(ptr: usize): void {
  // Bump allocators don't free
}
```

For string handling, use the AssemblyScript loader:

```javascript
import loader from '@assemblyscript/loader'

const wasmModule = await loader.instantiate(wasmBytes)
const { __newString, __getString } = wasmModule.exports

// Pass string to WASM
const ptr = __newString("hello")
const result = wasmModule.exports.processString(ptr)
const output = __getString(result)
```

## Testing

Run tests:
```bash
npm test
```

Test WASM output directly:
```javascript
const fs = require('fs')
const wasm = fs.readFileSync('build/release.wasm')

WebAssembly.instantiate(wasm).then(({ instance }) => {
  console.log(instance.exports.add(2, 3))        // 5
  console.log(instance.exports.factorial(10))    // 3628800
  console.log(instance.exports.fibonacci(40))    // 102334155
})
```

## Troubleshooting

### "asc: command not found"
```bash
npm install assemblyscript
npx asc --version
```

### "Cannot find module"
Ensure `assembly/index.ts` is the entry point and all imports are relative.

### Output too large
1. Use `runtime: "stub"` for pure functions
2. Avoid managed types (String, Array)
3. Check `asconfig.json` optimization settings
4. Use `--shrinkLevel 2` for maximum size reduction

### Runtime errors
1. Build with debug target: `npm run build:debug`
2. Check the generated `.wat` file for issues
3. Use browser DevTools WASM debugger

## Advanced Features

### SIMD Operations

AssemblyScript supports SIMD for parallel computations:

```typescript
import { v128 } from "assemblyscript/std/assembly"

export function sumVec4(ptr: usize): f32 {
  const vec = v128.load(ptr)
  // ... SIMD operations
}
```

### Memory Views

Access WASM linear memory directly:

```typescript
// Store i32 at offset
store<i32>(offset, value)

// Load i32 from offset
const value = load<i32>(offset)

// Bulk memory copy
memory.copy(dest, src, size)
```

## Resources

- [Functions.do Documentation](https://functions.do/docs)
- [AssemblyScript Documentation](https://www.assemblyscript.org/)
- [AssemblyScript Standard Library](https://www.assemblyscript.org/stdlib/globals.html)
- [WebAssembly Reference](https://webassembly.github.io/spec/core/)
- [Cloudflare Workers WASM Guide](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)
