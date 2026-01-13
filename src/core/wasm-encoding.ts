/**
 * Shared WASM Encoding Utilities
 *
 * This module provides common encoding utilities for WebAssembly binary format,
 * used by all language compilers (Rust, Go, Zig, etc.)
 *
 * LEB128 (Little Endian Base 128) is a variable-length encoding format used
 * extensively in the WASM binary format for integers.
 *
 * Reference: https://webassembly.github.io/spec/core/binary/values.html
 */

// ============================================================================
// LEB128 Encoding
// ============================================================================

/**
 * Encode an unsigned integer using LEB128 (Little Endian Base 128) encoding.
 *
 * LEB128 is a variable-length encoding where each byte uses 7 bits for data
 * and the high bit indicates if more bytes follow.
 *
 * @param value - The unsigned integer to encode (must be non-negative)
 * @returns Array of bytes representing the encoded value
 *
 * @example
 * ```typescript
 * encodeULEB128(0)    // [0x00]
 * encodeULEB128(127)  // [0x7f]
 * encodeULEB128(128)  // [0x80, 0x01]
 * encodeULEB128(624485) // [0xe5, 0x8e, 0x26]
 * ```
 */
export function encodeULEB128(value: number): number[] {
  const result: number[] = []
  do {
    let byte = value & 0x7f
    value >>>= 7
    if (value !== 0) {
      byte |= 0x80
    }
    result.push(byte)
  } while (value !== 0)
  return result
}

/**
 * Encode a signed integer using LEB128 (Little Endian Base 128) encoding.
 *
 * Signed LEB128 uses two's complement representation. The sign bit is
 * propagated in the final byte to indicate whether the value is negative.
 *
 * @param value - The signed 32-bit integer to encode
 * @returns Array of bytes representing the encoded value
 *
 * @example
 * ```typescript
 * encodeSLEB128(0)    // [0x00]
 * encodeSLEB128(-1)   // [0x7f]
 * encodeSLEB128(127)  // [0xff, 0x00]
 * encodeSLEB128(-128) // [0x80, 0x7f]
 * ```
 */
export function encodeSLEB128(value: number): number[] {
  const result: number[] = []
  let more = true
  while (more) {
    let byte = value & 0x7f
    value >>= 7
    // Check if we're done (all remaining bits are sign extension)
    if ((value === 0 && (byte & 0x40) === 0) || (value === -1 && (byte & 0x40) !== 0)) {
      more = false
    } else {
      byte |= 0x80
    }
    result.push(byte)
  }
  return result
}

/**
 * Encode a 64-bit signed integer using LEB128 encoding.
 *
 * This variant handles BigInt values for 64-bit integer support in WASM.
 *
 * @param value - The signed 64-bit integer to encode (as BigInt)
 * @returns Array of bytes representing the encoded value
 *
 * @example
 * ```typescript
 * encodeSLEB128_64(0n)    // [0x00]
 * encodeSLEB128_64(-1n)   // [0x7f]
 * encodeSLEB128_64(9223372036854775807n)  // max i64
 * ```
 */
export function encodeSLEB128_64(value: bigint): number[] {
  const result: number[] = []
  let more = true
  while (more) {
    let byte = Number(value & 0x7fn)
    value >>= 7n
    if ((value === 0n && (byte & 0x40) === 0) || (value === -1n && (byte & 0x40) !== 0)) {
      more = false
    } else {
      byte |= 0x80
    }
    result.push(byte)
  }
  return result
}

// ============================================================================
// String/Name Encoding
// ============================================================================

/**
 * Encode a string as a WASM name.
 *
 * WASM names are encoded as a length-prefixed UTF-8 byte sequence.
 * The length is encoded using ULEB128.
 *
 * @param name - The string to encode
 * @returns Array of bytes representing the encoded name
 *
 * @example
 * ```typescript
 * encodeName("add")  // [0x03, 0x61, 0x64, 0x64]
 * //                    ^len   a      d      d
 * ```
 */
export function encodeName(name: string): number[] {
  const bytes = new TextEncoder().encode(name)
  return [...encodeULEB128(bytes.length), ...Array.from(bytes)]
}

// ============================================================================
// Section Encoding
// ============================================================================

/**
 * Create a WASM section with the given ID and content.
 *
 * WASM sections are structured as:
 * - 1 byte: section ID
 * - ULEB128: content size in bytes
 * - N bytes: section content
 *
 * @param sectionId - The section type identifier (see WASM_SECTIONS)
 * @param content - The section content as an array of bytes
 * @returns Array of bytes representing the complete section
 *
 * @example
 * ```typescript
 * import { WASM_SECTIONS } from './wasm-types'
 *
 * // Create a simple type section
 * const typeContent = [0x01, 0x60, 0x00, 0x00]  // 1 function type: () -> ()
 * const section = createSection(WASM_SECTIONS.TYPE, typeContent)
 * ```
 */
export function createSection(sectionId: number, content: number[]): number[] {
  return [sectionId, ...encodeULEB128(content.length), ...content]
}

// ============================================================================
// Floating Point Encoding
// ============================================================================

/**
 * Encode a 32-bit floating point number in IEEE 754 format (little-endian).
 *
 * @param value - The float value to encode
 * @returns Array of 4 bytes representing the encoded value
 *
 * @example
 * ```typescript
 * encodeF32(0.0)   // [0x00, 0x00, 0x00, 0x00]
 * encodeF32(1.0)   // [0x00, 0x00, 0x80, 0x3f]
 * ```
 */
export function encodeF32(value: number): number[] {
  const buffer = new ArrayBuffer(4)
  const view = new DataView(buffer)
  view.setFloat32(0, value, true) // little-endian
  return Array.from(new Uint8Array(buffer))
}

/**
 * Encode a 64-bit floating point number in IEEE 754 format (little-endian).
 *
 * @param value - The double value to encode
 * @returns Array of 8 bytes representing the encoded value
 *
 * @example
 * ```typescript
 * encodeF64(0.0)   // [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
 * encodeF64(1.0)   // [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f]
 * ```
 */
export function encodeF64(value: number): number[] {
  const buffer = new ArrayBuffer(8)
  const view = new DataView(buffer)
  view.setFloat64(0, value, true) // little-endian
  return Array.from(new Uint8Array(buffer))
}

// ============================================================================
// Vector Encoding
// ============================================================================

/**
 * Create a WASM vector (length-prefixed array of items).
 *
 * Used for encoding lists of types, functions, exports, etc.
 *
 * @param items - Array of items to encode (each item is an array of bytes)
 * @returns Array of bytes: [count, ...flattened items]
 *
 * @example
 * ```typescript
 * // Encode a vector of 3 function type indices
 * const vector = createVector([[0x00], [0x01], [0x00]])
 * // Result: [0x03, 0x00, 0x01, 0x00]
 * //          ^count
 * ```
 */
export function createVector(items: number[][]): number[] {
  const flattened = items.flat()
  return [...encodeULEB128(items.length), ...flattened]
}
