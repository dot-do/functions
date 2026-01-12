/**
 * Shared WASM Type Constants
 *
 * This module provides centralized definitions for WebAssembly type codes,
 * section IDs, and common opcodes used across all language compilers.
 *
 * Reference: https://webassembly.github.io/spec/core/binary/types.html
 */

// ============================================================================
// WASM Value Types
// ============================================================================

/**
 * WASM value type codes as defined in the WebAssembly specification.
 * These are used in function signatures, local declarations, and global types.
 */
export const WASM_TYPES = {
  /** 32-bit integer */
  I32: 0x7f,
  /** 64-bit integer */
  I64: 0x7e,
  /** 32-bit floating point */
  F32: 0x7d,
  /** 64-bit floating point */
  F64: 0x7c,
  /** 128-bit vector (SIMD) */
  V128: 0x7b,
  /** Function reference */
  FUNCREF: 0x70,
  /** External reference */
  EXTERNREF: 0x6f,
  /** Function type constructor */
  FUNC: 0x60,
} as const

/**
 * Type alias for WASM value types
 */
export type WasmType = (typeof WASM_TYPES)[keyof typeof WASM_TYPES]

// ============================================================================
// WASM Section IDs
// ============================================================================

/**
 * WASM binary section IDs as defined in the WebAssembly specification.
 * Sections must appear in order by their ID in a valid WASM module.
 */
export const WASM_SECTIONS = {
  /** Custom section (ID 0) - for metadata, debug info, etc. */
  CUSTOM: 0x00,
  /** Type section (ID 1) - function type definitions */
  TYPE: 0x01,
  /** Import section (ID 2) - imported functions, memories, tables, globals */
  IMPORT: 0x02,
  /** Function section (ID 3) - function declarations (type indices) */
  FUNCTION: 0x03,
  /** Table section (ID 4) - table definitions */
  TABLE: 0x04,
  /** Memory section (ID 5) - memory definitions */
  MEMORY: 0x05,
  /** Global section (ID 6) - global variable definitions */
  GLOBAL: 0x06,
  /** Export section (ID 7) - exported functions, memories, tables, globals */
  EXPORT: 0x07,
  /** Start section (ID 8) - start function index */
  START: 0x08,
  /** Element section (ID 9) - table element segments */
  ELEMENT: 0x09,
  /** Code section (ID 10) - function bodies */
  CODE: 0x0a,
  /** Data section (ID 11) - memory data segments */
  DATA: 0x0b,
  /** Data count section (ID 12) - number of data segments */
  DATA_COUNT: 0x0c,
} as const

/**
 * Type alias for WASM section IDs
 */
export type WasmSection = (typeof WASM_SECTIONS)[keyof typeof WASM_SECTIONS]

// ============================================================================
// WASM Export Kinds
// ============================================================================

/**
 * WASM export descriptor kinds.
 */
export const WASM_EXPORT_KIND = {
  /** Function export */
  FUNCTION: 0x00,
  /** Table export */
  TABLE: 0x01,
  /** Memory export */
  MEMORY: 0x02,
  /** Global export */
  GLOBAL: 0x03,
} as const

/**
 * Type alias for WASM export kinds
 */
export type WasmExportKind = (typeof WASM_EXPORT_KIND)[keyof typeof WASM_EXPORT_KIND]

// ============================================================================
// Common WASM Opcodes
// ============================================================================

/**
 * Common WASM opcodes used across compilers.
 * This is not exhaustive - only includes frequently used opcodes.
 */
export const WASM_OPCODES = {
  // Control flow
  UNREACHABLE: 0x00,
  NOP: 0x01,
  BLOCK: 0x02,
  LOOP: 0x03,
  IF: 0x04,
  ELSE: 0x05,
  END: 0x0b,
  BR: 0x0c,
  BR_IF: 0x0d,
  BR_TABLE: 0x0e,
  RETURN: 0x0f,
  CALL: 0x10,
  CALL_INDIRECT: 0x11,

  // Parametric
  DROP: 0x1a,
  SELECT: 0x1b,

  // Variable access
  LOCAL_GET: 0x20,
  LOCAL_SET: 0x21,
  LOCAL_TEE: 0x22,
  GLOBAL_GET: 0x23,
  GLOBAL_SET: 0x24,

  // Memory operations
  I32_LOAD: 0x28,
  I64_LOAD: 0x29,
  F32_LOAD: 0x2a,
  F64_LOAD: 0x2b,
  I32_STORE: 0x36,
  I64_STORE: 0x37,
  F32_STORE: 0x38,
  F64_STORE: 0x39,

  // Constants
  I32_CONST: 0x41,
  I64_CONST: 0x42,
  F32_CONST: 0x43,
  F64_CONST: 0x44,

  // i32 comparison
  I32_EQZ: 0x45,
  I32_EQ: 0x46,
  I32_NE: 0x47,
  I32_LT_S: 0x48,
  I32_LT_U: 0x49,
  I32_GT_S: 0x4a,
  I32_GT_U: 0x4b,
  I32_LE_S: 0x4c,
  I32_LE_U: 0x4d,
  I32_GE_S: 0x4e,
  I32_GE_U: 0x4f,

  // i32 arithmetic
  I32_ADD: 0x6a,
  I32_SUB: 0x6b,
  I32_MUL: 0x6c,
  I32_DIV_S: 0x6d,
  I32_DIV_U: 0x6e,
  I32_REM_S: 0x6f,
  I32_REM_U: 0x70,
  I32_AND: 0x71,
  I32_OR: 0x72,
  I32_XOR: 0x73,
  I32_SHL: 0x74,
  I32_SHR_S: 0x75,
  I32_SHR_U: 0x76,

  // i64 arithmetic
  I64_ADD: 0x7c,
  I64_SUB: 0x7d,
  I64_MUL: 0x7e,

  // f32 arithmetic
  F32_ADD: 0x92,
  F32_SUB: 0x93,
  F32_MUL: 0x94,
  F32_DIV: 0x95,

  // f64 arithmetic
  F64_ADD: 0xa0,
  F64_SUB: 0xa1,
  F64_MUL: 0xa2,
  F64_DIV: 0xa3,
} as const

/**
 * Type alias for WASM opcodes
 */
export type WasmOpcode = (typeof WASM_OPCODES)[keyof typeof WASM_OPCODES]

// ============================================================================
// WASM Module Header
// ============================================================================

/**
 * WASM binary module magic number: \0asm
 */
export const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d] as const

/**
 * WASM binary format version 1
 */
export const WASM_VERSION = [0x01, 0x00, 0x00, 0x00] as const

/**
 * Complete WASM module header (magic + version)
 */
export const WASM_HEADER = [...WASM_MAGIC, ...WASM_VERSION] as const
