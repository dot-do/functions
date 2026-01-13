/**
 * Functions.do Languages Module
 *
 * Multi-language compilation and execution support:
 * - TypeScript/JavaScript: ESM compilation via esbuild
 * - Rust: WASM compilation via wasm-pack
 * - Go: WASM compilation via TinyGo
 * - Python: Pyodide runtime with memory snapshots
 * - C#: Distributed runtime with thin stubs
 * - Zig: WASM compilation
 * - AssemblyScript: WASM compilation
 */

// TypeScript
export { compileTypeScript, type TypeScriptCompileOptions, type TypeScriptCompileResult } from './typescript/compile'

// Rust
export { compileRust, type RustCompileOptions, type RustCompileResult } from './rust/compile'

// Go
export { compileGo, type GoCompileOptions, type GoCompileResult } from './go/compile'

// Python
export { PyodideExecutor, type PyodideExecutorOptions } from './python/pyodide-executor'
export { parseSnapshotConfig, generatePreloadList, generateSnapshotInitCode, estimateSnapshotSize, validateSnapshotConfig } from './python/memory-snapshot'

// C#
export { generateCSharpStub, type CSharpStubOptions } from './csharp/stub'
export { compileCSharp, type CSharpCompileOptions } from './csharp/roslyn'

// Zig
export { compileZig, type ZigCompileOptions, type ZigCompileResult } from './zig/compile'
