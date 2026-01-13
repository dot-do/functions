/**
 * Functions.do Languages Module
 *
 * Multi-language compilation and execution support.
 *
 * For tree-shaking, prefer individual language imports:
 *   import { compileRust } from 'functions.do/rust'
 *   import { compileGo } from 'functions.do/go'
 *   import { PyodideExecutor } from 'functions.do/python'
 *
 * This module re-exports all languages for convenience.
 */

// TypeScript
export * from './typescript'

// Rust
export * from './rust'

// Go
export * from './go'

// Python
export * from './python'

// C#
export * from './csharp'

// Zig
export * from './zig'

// AssemblyScript
export * from './assemblyscript'
