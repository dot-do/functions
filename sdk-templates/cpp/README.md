# Functions.do C/C++ SDK Template

Build high-performance serverless functions with C/C++ compiled to WebAssembly for the Functions.do platform.

## Quick Start

1. **Install dependencies**
   ```bash
   # Install Emscripten SDK (if not already installed)
   git clone https://github.com/emscripten-core/emsdk.git
   cd emsdk
   ./emsdk install latest
   ./emsdk activate latest
   source ./emsdk_env.sh

   # Or on macOS with Homebrew
   brew install emscripten
   ```

2. **Create your function**

   Edit `src/main.c` and add your function:
   ```c
   int my_function(int input) {
       return input * 2;
   }
   ```

3. **Build**
   ```bash
   mkdir build && cd build
   cmake -DCMAKE_TOOLCHAIN_FILE=../cmake/emscripten.cmake -DCMAKE_BUILD_TYPE=Release ..
   make
   ```

4. **Deploy**
   ```bash
   func deploy build/
   ```

## Function Types

### Basic Numeric Functions

For simple numeric operations, use standard C types:

```c
int add(int a, int b) {
    return a + b;
}

int64_t factorial(int n) {
    if (n <= 1) return 1;
    int64_t result = 1;
    for (int i = 2; i <= n; i++) {
        result *= i;
    }
    return result;
}
```

### Floating Point Functions

Handle floating-point operations:

```c
float multiply_floats(float a, float b) {
    return a * b;
}

double compute_distance(double x1, double y1, double x2, double y2) {
    double dx = x2 - x1;
    double dy = y2 - y1;
    return sqrt(dx * dx + dy * dy);
}
```

### Array/Pointer Functions

Work with arrays passed via WASM linear memory:

```c
int sum_array(int* arr, int len) {
    int sum = 0;
    for (int i = 0; i < len; i++) {
        sum += arr[i];
    }
    return sum;
}

// Host passes pointer to memory and length
double dot_product(double* a, double* b, int len) {
    double result = 0.0;
    for (int i = 0; i < len; i++) {
        result += a[i] * b[i];
    }
    return result;
}
```

### Memory Management

For functions that allocate memory:

```c
// Export these for host to manage memory
void* alloc(size_t size);
void dealloc(void* ptr, size_t size);

// String example: returns pointer to allocated string
char* to_uppercase(const char* str, int len) {
    char* result = alloc(len + 1);
    for (int i = 0; i < len; i++) {
        result[i] = toupper(str[i]);
    }
    result[len] = '\0';
    return result;
}
```

## capnweb Integration

The SDK generates capnweb-style RPC bindings automatically. Use from TypeScript:

```typescript
import { createMyFunctionTarget } from './bindings'

// Load WASM bytes (varies by bundler)
const wasmBytes = await fetch('/my_function.wasm').then(r => r.arrayBuffer())

// Create capnweb RPC target
const target = await createMyFunctionTarget(new Uint8Array(wasmBytes))

// Call exported functions
const sum = target.add(2, 3)        // 5
const product = target.multiply(6, 7) // 42
const answer = target.get_answer()   // 42
```

## Optimization Tips

### Target Size: 10-100KB

1. **Keep it simple**
   - Avoid heavy standard library usage
   - Use simple data structures

2. **Disable unused features**
   ```cmake
   target_compile_options(${TARGET} PRIVATE
     -fno-exceptions
     -fno-rtti
   )
   ```

3. **Link-time optimization**
   Already enabled in release builds via `-flto`

4. **Use wasm-opt**
   ```bash
   make optimize
   # Or manually:
   wasm-opt -Oz -o output.opt.wasm output.wasm
   ```

5. **Strip debug symbols**
   Already done in release builds

### Performance Tips

1. **Use stack allocation when possible**
   ```c
   // Good - stack allocation
   int local_array[100];

   // Avoid - heap allocation
   int* heap_array = malloc(100 * sizeof(int));
   ```

2. **Minimize function calls**
   Inline small functions when possible

3. **Use appropriate types**
   - `int32_t` and `float` are fastest on WASM
   - `int64_t` and `double` have native support too
   - Smaller types (`int8_t`, `int16_t`) may need conversion

## Project Structure

```
my-function/
├── CMakeLists.txt        # Build configuration
├── cmake/
│   └── emscripten.cmake  # Emscripten toolchain
├── src/
│   └── main.c            # Your function code
├── build/                # Build output
│   └── my_function.wasm
├── types.d.ts            # Generated TypeScript types
├── bindings.ts           # Generated capnweb bindings
└── README.md
```

## Building

### Release Build (Optimized)

```bash
mkdir -p build && cd build
cmake -DCMAKE_TOOLCHAIN_FILE=../cmake/emscripten.cmake -DCMAKE_BUILD_TYPE=Release ..
make

# Check size
make size

# Further optimize
make optimize
```

### Debug Build

```bash
mkdir -p build-debug && cd build-debug
cmake -DCMAKE_TOOLCHAIN_FILE=../cmake/emscripten.cmake -DCMAKE_BUILD_TYPE=Debug ..
make
```

### Native Build (for testing)

```bash
mkdir -p build-native && cd build-native
cmake ..
make
ctest  # Run tests
```

## Testing

### Native Testing

The template includes a native test mode that runs without Emscripten:

```bash
mkdir build-native && cd build-native
cmake ..
make
./{{function_name}}_native
```

### WASM Testing

Test the WASM output with Node.js:

```bash
node -e "
  const fs = require('fs');
  const wasm = fs.readFileSync('build/my_function.wasm');
  WebAssembly.instantiate(wasm).then(({instance}) => {
    console.log('add(2, 3) =', instance.exports.add(2, 3));
    console.log('multiply(6, 7) =', instance.exports.multiply(6, 7));
  });
"
```

## Type Mappings

| C Type | WASM Type | TypeScript Type |
|--------|-----------|-----------------|
| `int`, `int32_t` | `i32` | `number` |
| `unsigned int`, `uint32_t` | `i32` | `number` |
| `int64_t`, `long long` | `i64` | `bigint` |
| `uint64_t`, `unsigned long long` | `i64` | `bigint` |
| `float` | `f32` | `number` |
| `double` | `f64` | `number` |
| `int*`, `void*` | `i32` | `number` (pointer) |

## Troubleshooting

### "emcc not found"

Install Emscripten and activate it:
```bash
source /path/to/emsdk/emsdk_env.sh
```

### Binary too large

1. Check for unused code
2. Disable exceptions: `-fno-exceptions`
3. Use `-Os` or `-Oz` optimization level
4. Run `wasm-opt -Oz`

### Function not exported

Ensure functions are:
1. Not declared `static`
2. Listed in `EXPORTS` in CMakeLists.txt
3. Have C linkage (use `extern "C"` in C++)

### Memory issues

1. Increase initial memory in toolchain file
2. Enable memory growth: `-s ALLOW_MEMORY_GROWTH=1`
3. Check for memory leaks in native testing

## C++ Support

For C++ code, use `extern "C"` for exported functions:

```cpp
extern "C" {
    int add(int a, int b) {
        return a + b;
    }
}
```

Or rename `main.c` to `main.cpp` and update CMakeLists.txt.

## Resources

- [Functions.do Documentation](https://functions.do/docs)
- [Emscripten Documentation](https://emscripten.org/docs/)
- [WebAssembly Specification](https://webassembly.github.io/spec/)
- [wasm-opt Documentation](https://github.com/WebAssembly/binaryen)
