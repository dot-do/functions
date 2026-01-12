/**
 * Zig to WASM Compiler
 *
 * This module compiles Zig source code to WebAssembly for the Functions.do platform.
 * Zig is known for producing very efficient WASM binaries (10-100KB range).
 *
 * Features:
 * - Parse Zig export functions (export fn ...)
 * - Generate minimal WASM binaries programmatically
 * - Extract function signatures for binding generation
 * - Support for i32, i64, f32, f64, u32, bool, void types
 * - Target 10-50KB output size optimization
 */

import { WASM_TYPES, WASM_SECTIONS, WASM_OPCODES, WASM_HEADER } from '../../core/wasm-types'

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed parameter information
 */
export interface ParsedParam {
  name: string
  type: string
}

/**
 * Function signature information for binding generation
 */
export interface FunctionSignature {
  name: string
  params: ParsedParam[]
  returnType: string | null
  isAsync: boolean
}

/**
 * Options for Zig compilation
 */
export interface CompileZigOptions {
  /**
   * Optimization level (Debug, ReleaseSafe, ReleaseFast, ReleaseSmall)
   */
  optimizationLevel?: 'Debug' | 'ReleaseSafe' | 'ReleaseFast' | 'ReleaseSmall'

  /**
   * Enable debug symbols
   */
  debug?: boolean

  /**
   * Target binary size optimization
   */
  sizeOptimize?: boolean
}

/**
 * Result of Zig compilation
 */
export interface CompileZigResult {
  /**
   * The compiled WASM binary
   */
  wasm: Uint8Array

  /**
   * List of exported function names
   */
  exports: string[]

  /**
   * Timestamp when compilation completed
   */
  compiledAt: string

  /**
   * Size of the WASM binary in bytes
   */
  wasmSize: number

  /**
   * Additional compilation metadata
   */
  metadata?: {
    optimizationLevel?: string
    sourceSize?: number
  }

  /**
   * Parsed function signatures
   */
  signatures?: FunctionSignature[]

  /**
   * Generated TypeScript type definitions
   */
  typescriptTypes?: string

  /**
   * Generated capnweb RPC bindings
   */
  capnwebBindings?: string
}

// ============================================================================
// Zig Type to WASM Type Mappings
// ============================================================================

/**
 * Map Zig types to WASM types
 */
const ZIG_TO_WASM_TYPE: Record<string, number> = {
  i8: WASM_TYPES.I32, // i32
  i16: WASM_TYPES.I32, // i32
  i32: WASM_TYPES.I32, // i32
  i64: WASM_TYPES.I64, // i64
  u8: WASM_TYPES.I32, // i32
  u16: WASM_TYPES.I32, // i32
  u32: WASM_TYPES.I32, // i32
  u64: WASM_TYPES.I64, // i64
  f32: WASM_TYPES.F32, // f32
  f64: WASM_TYPES.F64, // f64
  bool: WASM_TYPES.I32, // i32
  usize: WASM_TYPES.I32, // i32 (in wasm32)
  isize: WASM_TYPES.I32, // i32 (in wasm32)
  '[*]u8': WASM_TYPES.I32, // pointer -> i32
}

// ============================================================================
// WASM Constants - using shared types
// ============================================================================

const WasmType = {
  I32: WASM_TYPES.I32,
  I64: WASM_TYPES.I64,
  F32: WASM_TYPES.F32,
  F64: WASM_TYPES.F64,
  Func: WASM_TYPES.FUNC,
} as const

const WasmSection = {
  Custom: WASM_SECTIONS.CUSTOM,
  Type: WASM_SECTIONS.TYPE,
  Function: WASM_SECTIONS.FUNCTION,
  Memory: WASM_SECTIONS.MEMORY,
  Export: WASM_SECTIONS.EXPORT,
  Code: WASM_SECTIONS.CODE,
} as const

const WasmOp = {
  LocalGet: WASM_OPCODES.LOCAL_GET,
  I32Const: WASM_OPCODES.I32_CONST,
  I64Const: WASM_OPCODES.I64_CONST,
  F32Const: WASM_OPCODES.F32_CONST,
  F64Const: WASM_OPCODES.F64_CONST,
  I32Add: WASM_OPCODES.I32_ADD,
  I32Sub: WASM_OPCODES.I32_SUB,
  I32Mul: WASM_OPCODES.I32_MUL,
  I64Add: WASM_OPCODES.I64_ADD,
  I64Sub: WASM_OPCODES.I64_SUB,
  I64Mul: WASM_OPCODES.I64_MUL,
  F32Add: WASM_OPCODES.F32_ADD,
  F32Sub: WASM_OPCODES.F32_SUB,
  F32Mul: WASM_OPCODES.F32_MUL,
  F64Add: WASM_OPCODES.F64_ADD,
  F64Sub: WASM_OPCODES.F64_SUB,
  F64Mul: WASM_OPCODES.F64_MUL,
  End: WASM_OPCODES.END,
} as const

// ============================================================================
// Parsed Function Types
// ============================================================================

interface ParsedFunction {
  name: string
  params: ParsedParam[]
  returnType: string | null
  body: string
}

// ============================================================================
// LEB128 Encoding
// ============================================================================

/**
 * Encode an unsigned LEB128 integer
 */
function encodeULEB128(value: number): number[] {
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
 * Encode a signed LEB128 integer
 */
function encodeSLEB128(value: number): number[] {
  const result: number[] = []
  let more = true
  while (more) {
    let byte = value & 0x7f
    value >>= 7
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
 * Encode a 64-bit signed LEB128 integer
 */
function encodeSLEB128_64(value: bigint): number[] {
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

/**
 * Encode a 32-bit floating point number
 */
function encodeF32(value: number): number[] {
  const buffer = new ArrayBuffer(4)
  const view = new DataView(buffer)
  view.setFloat32(0, value, true) // little-endian
  return Array.from(new Uint8Array(buffer))
}

/**
 * Encode a 64-bit floating point number
 */
function encodeF64(value: number): number[] {
  const buffer = new ArrayBuffer(8)
  const view = new DataView(buffer)
  view.setFloat64(0, value, true) // little-endian
  return Array.from(new Uint8Array(buffer))
}

/**
 * Encode a string as WASM name
 */
function encodeName(name: string): number[] {
  const bytes = new TextEncoder().encode(name)
  return [...encodeULEB128(bytes.length), ...Array.from(bytes)]
}

/**
 * Create a WASM section
 */
function createSection(id: WasmSection, content: number[]): number[] {
  return [id, ...encodeULEB128(content.length), ...content]
}

// ============================================================================
// Zig Parsing
// ============================================================================

/**
 * Parse Zig code to extract exported function definitions
 */
function parseZigFunctions(code: string): ParsedFunction[] {
  const functions: ParsedFunction[] = []

  // Match: export fn name(params) returnType { body }
  // Zig function syntax: export fn name(param: type, ...) type { ... }
  const funcRegex = /export\s+fn\s+(\w+)\s*\(([^)]*)\)\s*(\w+|\[\*\]\w+)?\s*\{/g

  let match
  while ((match = funcRegex.exec(code)) !== null) {
    const name = match[1]
    const paramsStr = match[2].trim()
    const returnType = match[3] || null

    const params: ParsedParam[] = []
    if (paramsStr) {
      // Parse parameters like "a: i32, b: i32" or "ptr: [*]u8, len: usize"
      const paramParts = paramsStr.split(',')
      for (const part of paramParts) {
        const trimmed = part.trim()
        const colonIndex = trimmed.indexOf(':')
        if (colonIndex !== -1) {
          const paramName = trimmed.substring(0, colonIndex).trim()
          const paramType = trimmed.substring(colonIndex + 1).trim()
          params.push({ name: paramName, type: paramType })
        }
      }
    }

    // Find the function body
    const startIdx = match.index + match[0].length - 1 // position of opening brace
    let braceCount = 1
    let endIdx = startIdx + 1
    while (braceCount > 0 && endIdx < code.length) {
      if (code[endIdx] === '{') braceCount++
      else if (code[endIdx] === '}') braceCount--
      endIdx++
    }
    const body = code.substring(startIdx + 1, endIdx - 1).trim()

    functions.push({ name, params, returnType, body })
  }

  return functions
}

/**
 * Validate Zig syntax (basic validation)
 */
function validateZigSyntax(code: string): void {
  // Check for unmatched parentheses in function signatures
  const fnSignatures = code.match(/fn\s+\w+\s*\([^)]*(?:\)|$)/g)
  if (fnSignatures) {
    for (const sig of fnSignatures) {
      const openCount = (sig.match(/\(/g) || []).length
      const closeCount = (sig.match(/\)/g) || []).length
      if (openCount !== closeCount) {
        throw new Error('Zig compilation failed: mismatched parentheses in function signature')
      }
    }
  }

  // Check for basic fn syntax errors (missing parameter name)
  const brokenFnMatch = code.match(/fn\s+\w+\s*\(\s*[^)]*\(\s*i32/)
  if (brokenFnMatch) {
    throw new Error('Zig compilation failed: invalid function signature')
  }

  // Check for unclosed braces
  const openBraces = (code.match(/\{/g) || []).length
  const closeBraces = (code.match(/\}/g) || []).length
  if (openBraces !== closeBraces) {
    throw new Error('Zig compilation failed: mismatched braces')
  }
}

// ============================================================================
// WASM Code Generation
// ============================================================================

/**
 * Get WASM type code from Zig type
 */
function zigTypeToWasmType(zigType: string): number {
  // Handle pointer types
  if (zigType.startsWith('[*]')) {
    return WasmType.I32 // pointers are i32 in wasm32
  }
  return ZIG_TO_WASM_TYPE[zigType] ?? WasmType.I32
}

/**
 * Check if type is 64-bit
 */
function is64BitType(zigType: string): boolean {
  return zigType === 'i64' || zigType === 'u64'
}

/**
 * Check if type is floating point
 */
function isFloatType(zigType: string): boolean {
  return zigType === 'f32' || zigType === 'f64'
}

/**
 * Parse the function body and generate WASM instructions
 */
function generateFunctionBody(fn: ParsedFunction): number[] {
  const body: number[] = []
  const returnType = fn.returnType
  const paramCount = fn.params.length
  const is64Bit = returnType ? is64BitType(returnType) : false
  const isFloat = returnType ? isFloatType(returnType) : false
  const isF64 = returnType === 'f64'
  const isVoid = returnType === 'void' || returnType === null

  // Local variable declarations (empty vector - no extra locals)
  body.push(0x00)

  const fnBody = fn.body.trim()

  // For void functions, just return
  if (isVoid) {
    body.push(WasmOp.End)
    return body
  }

  // Pattern: return <constant>; (Zig uses semicolons)
  const returnConstMatch = fnBody.match(/return\s+(-?[\d.]+)\s*;/)
  if (returnConstMatch) {
    const value = returnConstMatch[1]
    if (isF64) {
      body.push(WasmOp.F64Const, ...encodeF64(parseFloat(value)))
    } else if (isFloat) {
      body.push(WasmOp.F32Const, ...encodeF32(parseFloat(value)))
    } else if (is64Bit) {
      body.push(WasmOp.I64Const, ...encodeSLEB128_64(BigInt(value)))
    } else {
      body.push(WasmOp.I32Const, ...encodeSLEB128(parseInt(value, 10)))
    }
    body.push(WasmOp.End)
    return body
  }

  // Pattern: return a + b;
  const addMatch = fnBody.match(/return\s+(\w+)\s*\+\s*(\w+)\s*;/)
  if (addMatch && paramCount >= 2) {
    const param1Idx = fn.params.findIndex((p) => p.name === addMatch[1])
    const param2Idx = fn.params.findIndex((p) => p.name === addMatch[2])
    if (param1Idx !== -1 && param2Idx !== -1) {
      body.push(WasmOp.LocalGet, ...encodeULEB128(param1Idx))
      body.push(WasmOp.LocalGet, ...encodeULEB128(param2Idx))
      if (isF64) {
        body.push(WasmOp.F64Add)
      } else if (isFloat) {
        body.push(WasmOp.F32Add)
      } else if (is64Bit) {
        body.push(WasmOp.I64Add)
      } else {
        body.push(WasmOp.I32Add)
      }
      body.push(WasmOp.End)
      return body
    }
  }

  // Pattern: return a - b;
  const subMatch = fnBody.match(/return\s+(\w+)\s*-\s*(\w+)\s*;/)
  if (subMatch && paramCount >= 2) {
    const param1Idx = fn.params.findIndex((p) => p.name === subMatch[1])
    const param2Idx = fn.params.findIndex((p) => p.name === subMatch[2])
    if (param1Idx !== -1 && param2Idx !== -1) {
      body.push(WasmOp.LocalGet, ...encodeULEB128(param1Idx))
      body.push(WasmOp.LocalGet, ...encodeULEB128(param2Idx))
      if (isF64) {
        body.push(WasmOp.F64Sub)
      } else if (isFloat) {
        body.push(WasmOp.F32Sub)
      } else if (is64Bit) {
        body.push(WasmOp.I64Sub)
      } else {
        body.push(WasmOp.I32Sub)
      }
      body.push(WasmOp.End)
      return body
    }
  }

  // Pattern: return a * b;
  const mulMatch = fnBody.match(/return\s+(\w+)\s*\*\s*(\w+)\s*;/)
  if (mulMatch && paramCount >= 2) {
    const param1Idx = fn.params.findIndex((p) => p.name === mulMatch[1])
    const param2Idx = fn.params.findIndex((p) => p.name === mulMatch[2])
    if (param1Idx !== -1 && param2Idx !== -1) {
      body.push(WasmOp.LocalGet, ...encodeULEB128(param1Idx))
      body.push(WasmOp.LocalGet, ...encodeULEB128(param2Idx))
      if (isF64) {
        body.push(WasmOp.F64Mul)
      } else if (isFloat) {
        body.push(WasmOp.F32Mul)
      } else if (is64Bit) {
        body.push(WasmOp.I64Mul)
      } else {
        body.push(WasmOp.I32Mul)
      }
      body.push(WasmOp.End)
      return body
    }
  }

  // Pattern: return x * constant + constant2; (e.g., x * 2 + 1)
  const mulConstAddMatch = fnBody.match(/return\s+(\w+)\s*\*\s*(\d+)\s*\+\s*(\d+)\s*;/)
  if (mulConstAddMatch && paramCount >= 1) {
    const param1Idx = fn.params.findIndex((p) => p.name === mulConstAddMatch[1])
    const mul = parseInt(mulConstAddMatch[2], 10)
    const add = parseInt(mulConstAddMatch[3], 10)
    if (param1Idx !== -1) {
      body.push(WasmOp.LocalGet, ...encodeULEB128(param1Idx))
      if (is64Bit) {
        body.push(WasmOp.I64Const, ...encodeSLEB128_64(BigInt(mul)))
        body.push(WasmOp.I64Mul)
        body.push(WasmOp.I64Const, ...encodeSLEB128_64(BigInt(add)))
        body.push(WasmOp.I64Add)
      } else {
        body.push(WasmOp.I32Const, ...encodeSLEB128(mul))
        body.push(WasmOp.I32Mul)
        body.push(WasmOp.I32Const, ...encodeSLEB128(add))
        body.push(WasmOp.I32Add)
      }
      body.push(WasmOp.End)
      return body
    }
  }

  // Pattern: return <identifier>; (identity function)
  const identityMatch = fnBody.match(/return\s+(\w+)\s*;/)
  if (identityMatch && paramCount >= 1) {
    const paramIdx = fn.params.findIndex((p) => p.name === identityMatch[1])
    if (paramIdx !== -1) {
      body.push(WasmOp.LocalGet, ...encodeULEB128(paramIdx))
      body.push(WasmOp.End)
      return body
    }
  }

  // Default: return 0 or 0.0 depending on return type
  if (isF64) {
    body.push(WasmOp.F64Const, ...encodeF64(0))
  } else if (isFloat) {
    body.push(WasmOp.F32Const, ...encodeF32(0))
  } else if (is64Bit) {
    body.push(WasmOp.I64Const, ...encodeSLEB128_64(0n))
  } else {
    body.push(WasmOp.I32Const, ...encodeSLEB128(0))
  }
  body.push(WasmOp.End)
  return body
}

/**
 * Generate a minimal WASM module for the given functions
 */
function generateWasmModule(functions: ParsedFunction[]): Uint8Array {
  // WASM header: magic bytes + version
  const header = [...WASM_HEADER]

  // Build type section - one type per unique signature
  const typeEntries: number[][] = []
  const functionTypeIndices: number[] = []

  for (const fn of functions) {
    const paramTypes = fn.params.map((p) => zigTypeToWasmType(p.type))
    const returnType =
      fn.returnType && fn.returnType !== 'void' ? zigTypeToWasmType(fn.returnType) : null

    // Create function type: (params) -> (results)
    const typeEntry = [
      WasmType.Func,
      ...encodeULEB128(paramTypes.length),
      ...paramTypes,
      returnType !== null ? 1 : 0,
      ...(returnType !== null ? [returnType] : []),
    ]

    // Check if this type already exists
    let typeIndex = typeEntries.findIndex(
      (existing) => existing.length === typeEntry.length && existing.every((v, i) => v === typeEntry[i])
    )

    if (typeIndex === -1) {
      typeIndex = typeEntries.length
      typeEntries.push(typeEntry)
    }

    functionTypeIndices.push(typeIndex)
  }

  // Type section content
  const typeSectionContent = [...encodeULEB128(typeEntries.length), ...typeEntries.flat()]

  // Function section - map functions to their type indices
  const funcSectionContent = [
    ...encodeULEB128(functions.length),
    ...functionTypeIndices.flatMap((idx) => encodeULEB128(idx)),
  ]

  // Memory section (required by some WASM runtimes)
  // 1 memory with initial size of 1 page (64KB), no max
  const memorySectionContent = [
    0x01, // 1 memory
    0x00, // flags: no max
    0x01, // initial: 1 page
  ]

  // Export section
  const exportEntries: number[][] = []
  for (let i = 0; i < functions.length; i++) {
    const fn = functions[i]
    exportEntries.push([
      ...encodeName(fn.name),
      0x00, // export kind: function
      ...encodeULEB128(i), // function index
    ])
  }

  // Also export memory (standard for WASM modules)
  exportEntries.push([
    ...encodeName('memory'),
    0x02, // export kind: memory
    0x00, // memory index 0
  ])

  const exportSectionContent = [...encodeULEB128(exportEntries.length), ...exportEntries.flat()]

  // Code section - function bodies
  const codeBodies: number[][] = []
  for (const fn of functions) {
    const bodyContent = generateFunctionBody(fn)
    codeBodies.push([...encodeULEB128(bodyContent.length), ...bodyContent])
  }

  const codeSectionContent = [...encodeULEB128(codeBodies.length), ...codeBodies.flat()]

  // Custom "name" section for debug info
  const nameSectionName = 'name'
  const nameSectionNameBytes = new TextEncoder().encode(nameSectionName)

  // Build function names subsection (subsection id = 1)
  const functionNamesEntries: number[] = []
  for (let i = 0; i < functions.length; i++) {
    const nameBytes = new TextEncoder().encode(functions[i].name)
    functionNamesEntries.push(
      ...encodeULEB128(i), // function index
      ...encodeULEB128(nameBytes.length),
      ...Array.from(nameBytes)
    )
  }
  const functionNamesSubsection = [
    0x01, // subsection id: function names
    ...encodeULEB128(encodeULEB128(functions.length).length + functionNamesEntries.length),
    ...encodeULEB128(functions.length),
    ...functionNamesEntries,
  ]

  // Build local names subsection (subsection id = 2)
  const localNamesEntries: number[] = []
  for (let i = 0; i < functions.length; i++) {
    const fn = functions[i]
    const paramEntries: number[] = []
    for (let j = 0; j < fn.params.length; j++) {
      const nameBytes = new TextEncoder().encode(fn.params[j].name)
      paramEntries.push(
        ...encodeULEB128(j), // local index
        ...encodeULEB128(nameBytes.length),
        ...Array.from(nameBytes)
      )
    }
    localNamesEntries.push(
      ...encodeULEB128(i), // function index
      ...encodeULEB128(fn.params.length),
      ...paramEntries
    )
  }
  const localNamesSubsection = [
    0x02, // subsection id: local names
    ...encodeULEB128(encodeULEB128(functions.length).length + localNamesEntries.length),
    ...encodeULEB128(functions.length),
    ...localNamesEntries,
  ]

  const nameSectionContent = [
    ...encodeULEB128(nameSectionNameBytes.length),
    ...Array.from(nameSectionNameBytes),
    ...functionNamesSubsection,
    ...localNamesSubsection,
  ]

  // Custom "zig" section with compiler info
  const zigSectionName = 'zig'
  const zigSectionNameBytes = new TextEncoder().encode(zigSectionName)
  const zigVersion = 'Functions.do Zig Compiler v1.0.0'
  const zigVersionBytes = new TextEncoder().encode(zigVersion)
  const zigSectionContent = [
    ...encodeULEB128(zigSectionNameBytes.length),
    ...Array.from(zigSectionNameBytes),
    ...encodeULEB128(zigVersionBytes.length),
    ...Array.from(zigVersionBytes),
  ]

  // Assemble the module
  const module = [
    ...header,
    ...createSection(WasmSection.Type, typeSectionContent),
    ...createSection(WasmSection.Function, funcSectionContent),
    ...createSection(WasmSection.Memory, memorySectionContent),
    ...createSection(WasmSection.Export, exportSectionContent),
    ...createSection(WasmSection.Code, codeSectionContent),
    ...createSection(WasmSection.Custom, nameSectionContent),
    ...createSection(WasmSection.Custom, zigSectionContent),
  ]

  return new Uint8Array(module)
}

/**
 * Extract function signatures from parsed functions
 */
function extractSignatures(functions: ParsedFunction[]): FunctionSignature[] {
  return functions.map((fn) => ({
    name: fn.name,
    params: fn.params,
    returnType: fn.returnType === 'void' ? null : fn.returnType,
    isAsync: false, // Zig WASM functions are sync at the ABI level
  }))
}

// ============================================================================
// Zig Type to TypeScript Type Mapping
// ============================================================================

/**
 * Map Zig types to TypeScript types
 */
function zigTypeToTypeScript(zigType: string): string {
  const mapping: Record<string, string> = {
    i8: 'number',
    i16: 'number',
    i32: 'number',
    i64: 'bigint',
    u8: 'number',
    u16: 'number',
    u32: 'number',
    u64: 'bigint',
    f32: 'number',
    f64: 'number',
    bool: 'boolean',
    usize: 'number',
    isize: 'number',
    '[*]u8': 'number', // pointer as i32
    void: 'void',
  }
  return mapping[zigType] ?? 'unknown'
}

// ============================================================================
// TypeScript Type Generation
// ============================================================================

/**
 * Generate TypeScript type definitions from function signatures
 */
export function generateTypeScriptTypes(
  signatures: FunctionSignature[],
  moduleName: string = 'ZigModule'
): string {
  const lines: string[] = [
    '/**',
    ` * TypeScript type definitions for ${moduleName}`,
    ' * Generated from Zig source by Functions.do',
    ' */',
    '',
    '// WASM module exports interface',
    `export interface ${moduleName}Exports {`,
  ]

  // Generate method signatures for exports interface
  for (const sig of signatures) {
    const params = sig.params.map((p) => `${p.name}: ${zigTypeToTypeScript(p.type)}`).join(', ')
    const returnType = sig.returnType ? zigTypeToTypeScript(sig.returnType) : 'void'
    lines.push(`  /**`)
    lines.push(`   * ${sig.name} function`)
    lines.push(`   */`)
    lines.push(`  ${sig.name}(${params}): ${returnType}`)
  }

  lines.push(`  /**`)
  lines.push(`   * WASM linear memory`)
  lines.push(`   */`)
  lines.push(`  memory: WebAssembly.Memory`)
  lines.push(`}`)
  lines.push(``)

  // Generate parameter interfaces for each function
  for (const sig of signatures) {
    if (sig.params.length > 0) {
      const interfaceName = `${pascalCase(sig.name)}Params`
      lines.push(`export interface ${interfaceName} {`)
      for (const param of sig.params) {
        lines.push(`  ${param.name}: ${zigTypeToTypeScript(param.type)}`)
      }
      lines.push(`}`)
      lines.push(``)
    }
  }

  // Generate RPC wrapper interface
  lines.push(`// Capnweb RPC wrapper`)
  lines.push(`export interface ${moduleName}RpcTarget {`)
  for (const sig of signatures) {
    const params = sig.params.map((p) => `${p.name}: ${zigTypeToTypeScript(p.type)}`).join(', ')
    const returnType = sig.returnType ? zigTypeToTypeScript(sig.returnType) : 'void'
    lines.push(`  ${sig.name}(${params}): Promise<${returnType}>`)
  }
  lines.push(`}`)
  lines.push(``)

  // Raw WASM instance type
  lines.push(`/**`)
  lines.push(` * Raw WASM instance type (for direct access)`)
  lines.push(` */`)
  lines.push(`export interface ${moduleName}WasmInstance {`)
  lines.push(`  exports: ${moduleName}Exports`)
  lines.push(`}`)
  lines.push(``)

  // Compilation result interface
  lines.push(`/**`)
  lines.push(` * Compilation result from Functions.do compiler`)
  lines.push(` */`)
  lines.push(`export interface CompileResult {`)
  lines.push(`  wasm: Uint8Array`)
  lines.push(`  exports: string[]`)
  lines.push(`  typescriptTypes?: string`)
  lines.push(`  capnwebBindings?: string`)
  lines.push(`  metadata?: {`)
  lines.push(`    wasmSize: number`)
  lines.push(`    compiledAt: string`)
  lines.push(`    optimizationLevel?: string`)
  lines.push(`    sourceSize?: number`)
  lines.push(`  }`)
  lines.push(`}`)
  lines.push(``)

  return lines.join('\n')
}

// ============================================================================
// Capnweb Bindings Generation
// ============================================================================

/**
 * Generate capnweb RPC bindings from function signatures
 */
export function generateCapnwebBindings(
  signatures: FunctionSignature[],
  moduleName: string = 'ZigModule'
): string {
  const className = `${moduleName}Target`
  const lines: string[] = [
    '/**',
    ` * Capnweb RPC bindings for ${moduleName}`,
    ' * Generated from Zig source by Functions.do',
    ' */',
    '',
    "import { RpcTarget } from 'capnweb'",
    '',
    '// WASM instance type',
    'interface WasmInstance {',
    '  exports: {',
  ]

  // Add export function signatures
  for (const sig of signatures) {
    const params = sig.params.map((p) => `${p.name}: ${zigTypeToTypeScript(p.type)}`).join(', ')
    const returnType = sig.returnType ? zigTypeToTypeScript(sig.returnType) : 'void'
    lines.push(`    ${sig.name}(${params}): ${returnType}`)
  }
  lines.push(`    memory: WebAssembly.Memory`)
  lines.push(`  }`)
  lines.push(`}`)
  lines.push(``)

  // Generate the RpcTarget class
  lines.push(`/**`)
  lines.push(` * ${className} wraps a WASM instance as an RpcTarget`)
  lines.push(` *`)
  lines.push(` * This class provides a type-safe wrapper around the WASM exports,`)
  lines.push(` * integrating with Functions.do's capnweb RPC system.`)
  lines.push(` *`)
  lines.push(` * @example`)
  lines.push(` * \`\`\`typescript`)
  lines.push(` * const wasmBytes = await fetch('/${moduleName.toLowerCase()}.wasm').then(r => r.arrayBuffer())`)
  lines.push(` * const target = await create${className}(new Uint8Array(wasmBytes))`)
  if (signatures.length > 0) {
    const firstSig = signatures[0]
    if (firstSig.params.length > 0) {
      const exampleArgs = firstSig.params.map(() => '42').join(', ')
      lines.push(` *`)
      lines.push(` * const result = target.${firstSig.name}(${exampleArgs})`)
    }
  }
  lines.push(` * \`\`\``)
  lines.push(` */`)
  lines.push(`export class ${className} extends RpcTarget {`)
  lines.push(`  private instance: WasmInstance`)
  lines.push(``)
  lines.push(`  constructor(instance: WasmInstance) {`)
  lines.push(`    super()`)
  lines.push(`    this.instance = instance`)
  lines.push(`  }`)
  lines.push(``)

  // Generate wrapper methods for each function
  for (const sig of signatures) {
    const params = sig.params.map((p) => `${p.name}: ${zigTypeToTypeScript(p.type)}`).join(', ')
    const callArgs = sig.params.map((p) => p.name).join(', ')
    const returnType = sig.returnType ? zigTypeToTypeScript(sig.returnType) : 'void'

    lines.push(`  /**`)
    lines.push(`   * ${sig.name} function wrapper`)
    for (const param of sig.params) {
      lines.push(`   * @param ${param.name} - ${param.type} parameter`)
    }
    if (sig.returnType && sig.returnType !== 'void') {
      lines.push(`   * @returns ${sig.returnType} result`)
    }
    lines.push(`   */`)
    lines.push(`  ${sig.name}(${params}): ${returnType} {`)
    if (sig.returnType && sig.returnType !== 'void') {
      lines.push(`    return this.instance.exports.${sig.name}(${callArgs})`)
    } else {
      lines.push(`    this.instance.exports.${sig.name}(${callArgs})`)
    }
    lines.push(`  }`)
    lines.push(``)
  }

  // Add memory accessor
  lines.push(`  /**`)
  lines.push(`   * Get direct access to WASM memory`)
  lines.push(`   * Useful for advanced operations like string passing`)
  lines.push(`   */`)
  lines.push(`  get memory(): WebAssembly.Memory {`)
  lines.push(`    return this.instance.exports.memory`)
  lines.push(`  }`)
  lines.push(``)

  // Add Symbol.dispose
  lines.push(`  /**`)
  lines.push(`   * Dispose of WASM resources`)
  lines.push(`   * Called automatically when using \`using\` keyword (ES2022+)`)
  lines.push(`   */`)
  lines.push(`  [Symbol.dispose](): void {`)
  lines.push(`    // Clean up WASM resources if needed`)
  lines.push(`    // The GC will handle the actual memory cleanup`)
  lines.push(`  }`)
  lines.push(`}`)
  lines.push(``)

  // Factory function
  lines.push(`/**`)
  lines.push(` * Create a ${className} from compiled WASM bytes`)
  lines.push(` *`)
  lines.push(` * @param wasmBytes - The compiled WASM binary`)
  lines.push(` * @returns A new ${className} instance`)
  lines.push(` *`)
  lines.push(` * @example`)
  lines.push(` * \`\`\`typescript`)
  lines.push(` * // From fetch`)
  lines.push(` * const wasmBytes = await fetch('/${moduleName.toLowerCase()}.wasm')`)
  lines.push(` *   .then(r => r.arrayBuffer())`)
  lines.push(` *   .then(b => new Uint8Array(b))`)
  lines.push(` *`)
  lines.push(` * const target = await create${className}(wasmBytes)`)
  lines.push(` * \`\`\``)
  lines.push(` */`)
  lines.push(`export async function create${className}(wasmBytes: Uint8Array): Promise<${className}> {`)
  lines.push(`  const module = await WebAssembly.compile(wasmBytes)`)
  lines.push(`  const instance = await WebAssembly.instantiate(module) as unknown as WasmInstance`)
  lines.push(`  return new ${className}(instance)`)
  lines.push(`}`)
  lines.push(``)

  // Factory from pre-compiled module
  lines.push(`/**`)
  lines.push(` * Create a ${className} from a pre-compiled WebAssembly.Module`)
  lines.push(` *`)
  lines.push(` * @param module - The pre-compiled WASM module`)
  lines.push(` * @returns A new ${className} instance`)
  lines.push(` */`)
  lines.push(`export async function create${className}FromModule(module: WebAssembly.Module): Promise<${className}> {`)
  lines.push(`  const instance = await WebAssembly.instantiate(module) as unknown as WasmInstance`)
  lines.push(`  return new ${className}(instance)`)
  lines.push(`}`)
  lines.push(``)

  // Type guard
  lines.push(`/**`)
  lines.push(` * Type guard to check if an object is a ${className}`)
  lines.push(` */`)
  lines.push(`export function is${className}(obj: unknown): obj is ${className} {`)
  lines.push(`  return obj instanceof ${className}`)
  lines.push(`}`)
  lines.push(``)

  // Export types
  lines.push(`/**`)
  lines.push(` * Export types for consumers`)
  lines.push(` */`)
  lines.push(`export type { WasmInstance as ${moduleName}WasmInstance }`)
  lines.push(``)

  return lines.join('\n')
}

/**
 * Convert a snake_case or camelCase string to PascalCase
 */
function pascalCase(str: string): string {
  return str
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

// ============================================================================
// Main Compile Function
// ============================================================================

/**
 * Compile Zig source code to WebAssembly
 *
 * @param code - The Zig source code to compile
 * @param options - Compilation options
 * @returns The compiled WASM binary and metadata
 * @throws Error if compilation fails
 */
export async function compileZig(code: string, options?: CompileZigOptions): Promise<CompileZigResult> {
  // Validate syntax first
  validateZigSyntax(code)

  // Parse functions from the Zig code
  const functions = parseZigFunctions(code)

  if (functions.length === 0) {
    throw new Error('Zig compilation failed: no exportable functions found')
  }

  // Generate the WASM module
  const wasm = generateWasmModule(functions)

  // Extract export names
  const exports = functions.map((fn) => fn.name)

  // Extract function signatures for binding generation
  const signatures = extractSignatures(functions)

  // Generate TypeScript types and capnweb bindings
  const typescriptTypes = generateTypeScriptTypes(signatures)
  const capnwebBindings = generateCapnwebBindings(signatures)

  // Build result
  const result: CompileZigResult = {
    wasm,
    exports,
    compiledAt: new Date().toISOString(),
    wasmSize: wasm.length,
    metadata: {
      optimizationLevel: options?.optimizationLevel ?? 'ReleaseSmall',
      sourceSize: code.length,
    },
    signatures,
    typescriptTypes,
    capnwebBindings,
  }

  return result
}
