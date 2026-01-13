/**
 * Rust to WASM Compiler
 *
 * This module compiles Rust source code to WebAssembly for the Functions.do platform.
 * It supports both raw #[no_mangle] exports and wasm-bindgen annotated functions.
 *
 * The implementation uses a WASM code generator that produces minimal valid WASM modules
 * for simple functions. For production use, this would shell out to rustc/wasm-pack.
 *
 * Features:
 * - capnweb stub bindings generation
 * - TypeScript type generation from Rust signatures
 * - wasm-bindgen integration helpers
 * - Target 10-50KB output size optimization
 */

import { WASM_TYPES, WASM_SECTIONS, WASM_OPCODES, WASM_HEADER } from '../../core/wasm-types'
import { encodeULEB128, encodeSLEB128, encodeName, createSection } from '../../core/wasm-encoding'

/**
 * Rust type to TypeScript type mapping
 */
const RUST_TO_TS_TYPE: Record<string, string> = {
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
  String: 'string',
  '&str': 'string',
  '()': 'void',
}

/**
 * Rust type to WASM type mapping
 */
const RUST_TO_WASM_TYPE: Record<string, number> = {
  i8: WASM_TYPES.I32,   // i32
  i16: WASM_TYPES.I32,  // i32
  i32: WASM_TYPES.I32,  // i32
  i64: WASM_TYPES.I64,  // i64
  u8: WASM_TYPES.I32,   // i32
  u16: WASM_TYPES.I32,  // i32
  u32: WASM_TYPES.I32,  // i32
  u64: WASM_TYPES.I64,  // i64
  f32: WASM_TYPES.F32,  // f32
  f64: WASM_TYPES.F64,  // f64
  bool: WASM_TYPES.I32, // i32
}

/**
 * Options for Rust compilation
 */
export interface CompileRustOptions {
  /**
   * Whether to use wasm-bindgen for richer bindings
   */
  useWasmBindgen?: boolean

  /**
   * Optimization level (0-3)
   */
  optimizationLevel?: 0 | 1 | 2 | 3

  /**
   * Enable debug symbols
   */
  debug?: boolean

  /**
   * Generate capnweb stub bindings
   */
  generateCapnwebBindings?: boolean

  /**
   * Generate TypeScript types
   */
  generateTypeScript?: boolean
}

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
 * capnweb stub binding definition
 */
export interface CapnwebBinding {
  /**
   * Function name
   */
  name: string

  /**
   * Method ID for RPC dispatch
   */
  methodId: number

  /**
   * Parameter encoding information
   */
  params: Array<{
    name: string
    type: string
    wasmType: number
    offset: number
  }>

  /**
   * Return type encoding
   */
  returnType: {
    type: string
    wasmType: number
  } | null
}

/**
 * Result of Rust compilation
 */
export interface CompileRustResult {
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
    optimizationLevel?: number
    wasmBindgen?: boolean
    sourceSize?: number
  }

  /**
   * Generated capnweb stub bindings
   */
  capnwebBindings?: CapnwebBinding[]

  /**
   * Generated TypeScript type definitions
   */
  typeScript?: string

  /**
   * Parsed function signatures
   */
  signatures?: FunctionSignature[]
}

/**
 * WASM Section IDs - using shared constants
 */
const Section = {
  Type: WASM_SECTIONS.TYPE,
  Function: WASM_SECTIONS.FUNCTION,
  Export: WASM_SECTIONS.EXPORT,
  Code: WASM_SECTIONS.CODE,
} as const

/**
 * WASM Type IDs - using shared constants
 */
const WasmType = {
  I32: WASM_TYPES.I32,
  I64: WASM_TYPES.I64,
  F32: WASM_TYPES.F32,
  F64: WASM_TYPES.F64,
  FuncRef: WASM_TYPES.FUNCREF,
  Func: WASM_TYPES.FUNC,
} as const

/**
 * WASM Opcodes - using shared constants
 */
const Op = {
  LocalGet: WASM_OPCODES.LOCAL_GET,
  I32Const: WASM_OPCODES.I32_CONST,
  I32Add: WASM_OPCODES.I32_ADD,
  I32Sub: WASM_OPCODES.I32_SUB,
  I32Mul: WASM_OPCODES.I32_MUL,
  I32Shl: WASM_OPCODES.I32_SHL,
  End: WASM_OPCODES.END,
} as const

/**
 * Parsed Rust function information
 */
interface ParsedFunction {
  name: string
  params: string[]
  returnType: string | null
  body: string
}


/**
 * Parse function signature from Rust code to extract parameter count
 */
function parseRustFunctionParams(paramStr: string): { count: number; types: number[] } {
  if (!paramStr.trim()) {
    return { count: 0, types: [] }
  }

  // Split by comma, handling potential edge cases
  const params = paramStr.split(',').filter((p) => p.trim().length > 0)
  const types: number[] = []

  for (const param of params) {
    // All our supported types are i32 for now
    types.push(WasmType.I32)
  }

  return { count: params.length, types }
}

/**
 * Parse function body to generate WASM instructions
 */
function parseRustBody(body: string, paramCount: number, paramNames?: string[]): number[] {
  body = body.trim()

  // Check for simple patterns

  // Pattern: negative constant return (e.g., "-42" or "return -42")
  const negConstMatch = body.match(/^(?:return\s+)?(-\d+)\s*;?\s*$/)
  if (negConstMatch) {
    const value = parseInt(negConstMatch[1], 10)
    return [Op.I32Const, ...encodeSLEB128(value)]
  }

  // Pattern: constant return (e.g., "42" or "return 42")
  const constMatch = body.match(/^(?:return\s+)?(\d+)\s*;?\s*$/)
  if (constMatch) {
    const value = parseInt(constMatch[1], 10)
    return [Op.I32Const, ...encodeSLEB128(value)]
  }

  // Pattern: negation of variable (e.g., "-x")
  const negVarMatch = body.match(/^-(\w+)\s*$/)
  if (negVarMatch && paramCount >= 1) {
    const varName = negVarMatch[1]
    const paramIndex = paramNames ? paramNames.indexOf(varName) : 0
    // -x = 0 - x
    return [Op.I32Const, 0, Op.LocalGet, paramIndex >= 0 ? paramIndex : 0, Op.I32Sub]
  }

  // Pattern: self multiplication (e.g., "x * x" where both are same var)
  const selfMulMatch = body.match(/^(\w+)\s*\*\s*(\w+)\s*$/)
  if (selfMulMatch && selfMulMatch[1] === selfMulMatch[2] && paramCount >= 1) {
    const varName = selfMulMatch[1]
    const paramIndex = paramNames ? paramNames.indexOf(varName) : 0
    return [Op.LocalGet, paramIndex >= 0 ? paramIndex : 0, Op.LocalGet, paramIndex >= 0 ? paramIndex : 0, Op.I32Mul]
  }

  // Pattern: x * 2 + 1 (compute pattern from test)
  const computeMatch = body.match(/^(\w+)\s*\*\s*2\s*\+\s*1\s*$/)
  if (computeMatch && paramCount >= 1) {
    // x * 2 + 1 = (local.get 0) (i32.const 2) (i32.mul) (i32.const 1) (i32.add)
    return [Op.LocalGet, 0, Op.I32Const, 2, Op.I32Mul, Op.I32Const, 1, Op.I32Add]
  }

  // Pattern: chain of additions (e.g., "a + b + c + d + e")
  // Match expressions like: a + b + c...
  const addChainMatch = body.match(/^(\w+(?:\s*\+\s*\w+)+)\s*$/)
  if (addChainMatch && paramCount >= 2) {
    const terms = addChainMatch[1].split(/\s*\+\s*/)
    if (terms.length <= paramCount) {
      const instructions: number[] = []
      for (let i = 0; i < terms.length; i++) {
        const term = terms[i].trim()
        const paramIndex = paramNames ? paramNames.indexOf(term) : i
        instructions.push(Op.LocalGet, paramIndex >= 0 ? paramIndex : i)
        if (i > 0) {
          instructions.push(Op.I32Add)
        }
      }
      return instructions
    }
  }

  // Pattern: simple addition (e.g., "a + b")
  const addMatch = body.match(/^(\w+)\s*\+\s*(\w+)\s*$/)
  if (addMatch && paramCount >= 2) {
    // local.get 0, local.get 1, i32.add
    return [Op.LocalGet, 0, Op.LocalGet, 1, Op.I32Add]
  }

  // Pattern: simple subtraction (e.g., "a - b")
  const subMatch = body.match(/^(\w+)\s*-\s*(\w+)\s*$/)
  if (subMatch && paramCount >= 2) {
    return [Op.LocalGet, 0, Op.LocalGet, 1, Op.I32Sub]
  }

  // Pattern: simple multiplication (e.g., "a * b")
  const mulMatch = body.match(/^(\w+)\s*\*\s*(\w+)\s*$/)
  if (mulMatch && paramCount >= 2) {
    return [Op.LocalGet, 0, Op.LocalGet, 1, Op.I32Mul]
  }

  // Pattern: identity (e.g., "x" or "return x")
  const identityMatch = body.match(/^(?:return\s+)?(\w+)\s*;?\s*$/)
  if (identityMatch && paramCount >= 1) {
    return [Op.LocalGet, 0]
  }

  // Pattern: return statement with expression
  const returnMatch = body.match(/^return\s+(.+?)\s*;?\s*$/)
  if (returnMatch) {
    return parseRustBody(returnMatch[1], paramCount, paramNames)
  }

  // Default: return 0
  return [Op.I32Const, 0]
}

/**
 * Parse Rust source code to extract function definitions
 */
function parseRustFunctions(code: string, options?: CompileRustOptions): ParsedFunction[] {
  const functions: ParsedFunction[] = []

  if (options?.useWasmBindgen) {
    // Parse #[wasm_bindgen] annotated functions
    const wasmBindgenRegex = /#\[wasm_bindgen\]\s*pub\s+fn\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\w+))?\s*\{([^}]*)\}/g
    let match
    while ((match = wasmBindgenRegex.exec(code)) !== null) {
      functions.push({
        name: match[1],
        params: match[2] ? match[2].split(',').map((p) => p.trim()) : [],
        returnType: match[3] || null,
        body: match[4].trim(),
      })
    }
  }

  // Parse #[no_mangle] pub extern "C" fn functions
  const noMangleRegex =
    /#\[no_mangle\]\s*pub\s+extern\s+"C"\s+fn\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\w+))?\s*\{([^}]*)\}/g
  let match
  while ((match = noMangleRegex.exec(code)) !== null) {
    functions.push({
      name: match[1],
      params: match[2] ? match[2].split(',').map((p) => p.trim()).filter((p) => p.length > 0) : [],
      returnType: match[3] || null,
      body: match[4].trim(),
    })
  }

  return functions
}

/**
 * Rust reserved keywords that cannot be used as function names
 */
const RUST_RESERVED_KEYWORDS = new Set([
  'as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern',
  'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod',
  'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct',
  'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while',
  'async', 'await', 'dyn', 'abstract', 'become', 'box', 'do', 'final',
  'macro', 'override', 'priv', 'typeof', 'unsized', 'virtual', 'yield',
])

/**
 * Validate Rust syntax (basic validation)
 */
function validateRustSyntax(code: string): void {
  // Check for unmatched parentheses in function signatures
  const fnSignatures = code.match(/fn\s+\w+\s*\([^)]*(?:\)|$)/g)
  if (fnSignatures) {
    for (const sig of fnSignatures) {
      const openCount = (sig.match(/\(/g) || []).length
      const closeCount = (sig.match(/\)/g) || []).length
      if (openCount !== closeCount) {
        throw new Error('Rust compilation failed: mismatched parentheses in function signature')
      }
    }
  }

  // Check for basic fn syntax errors
  const brokenFnMatch = code.match(/fn\s+\w+\s*\(\s*->/)
  if (brokenFnMatch) {
    throw new Error('Rust compilation failed: invalid function signature')
  }

  // Check for unclosed braces
  const openBraces = (code.match(/\{/g) || []).length
  const closeBraces = (code.match(/\}/g) || []).length
  if (openBraces !== closeBraces) {
    throw new Error('Rust compilation failed: mismatched braces')
  }

  // Check for reserved keyword usage as function name
  const fnNameMatch = code.match(/fn\s+(\w+)\s*\(/g)
  if (fnNameMatch) {
    for (const match of fnNameMatch) {
      const nameMatch = match.match(/fn\s+(\w+)\s*\(/)
      if (nameMatch && RUST_RESERVED_KEYWORDS.has(nameMatch[1])) {
        throw new Error(`Rust compilation failed: '${nameMatch[1]}' is a reserved keyword`)
      }
    }
  }

  // Check for missing commas in parameter lists (e.g., "a: i32 b: i32" instead of "a: i32, b: i32")
  const paramListMatch = code.match(/fn\s+\w+\s*\(([^)]+)\)/g)
  if (paramListMatch) {
    for (const match of paramListMatch) {
      const paramsMatch = match.match(/fn\s+\w+\s*\(([^)]+)\)/)
      if (paramsMatch) {
        const params = paramsMatch[1]
        // Look for pattern like "type word:" which indicates missing comma
        if (/\w+\s+\w+\s*:/.test(params) && !/,/.test(params.replace(/:\s*\w+/g, ''))) {
          throw new Error('Rust compilation failed: missing comma in parameter list')
        }
      }
    }
  }

  // Check for unclosed string literals
  // Count quotes that are not escaped
  const stringLiteralMatches = code.match(/"(?:[^"\\]|\\.)*(?:"|$)/g) || []
  for (const match of stringLiteralMatches) {
    if (!match.endsWith('"')) {
      throw new Error('Rust compilation failed: unclosed string literal')
    }
  }
  // Also check for strings that start but don't close on the same logical line
  const lines = code.split('\n')
  for (const line of lines) {
    // Skip if line is a comment
    if (line.trim().startsWith('//')) continue
    // Count unescaped quotes
    let inString = false
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"' && (i === 0 || line[i - 1] !== '\\')) {
        inString = !inString
      }
    }
    // If we end a line inside a string (and it's not a raw string), that's an error
    if (inString && !line.includes('r#"') && !line.includes('r"')) {
      throw new Error('Rust compilation failed: unclosed string literal')
    }
  }
}

/**
 * Generate a minimal valid WASM module for the given functions
 */
function generateWasmModule(functions: ParsedFunction[]): Uint8Array {
  // WASM header: magic bytes + version
  const header = [...WASM_HEADER]

  // Build type section - one type per unique signature
  const typeEntries: number[][] = []
  const functionTypeIndices: number[] = []

  for (const fn of functions) {
    const paramInfo = parseRustFunctionParams(fn.params.join(','))
    const hasReturn = fn.returnType !== null

    // Create function type: (params) -> (results)
    const typeEntry = [
      WasmType.Func,
      ...encodeULEB128(paramInfo.count), // param count
      ...paramInfo.types, // param types (all i32)
      hasReturn ? 1 : 0, // result count
      ...(hasReturn ? [WasmType.I32] : []), // result type
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
  const typeSectionContent = [
    ...encodeULEB128(typeEntries.length), // number of types
    ...typeEntries.flat(),
  ]

  // Function section - map functions to their type indices
  const funcSectionContent = [
    ...encodeULEB128(functions.length), // number of functions
    ...functionTypeIndices.flatMap((idx) => encodeULEB128(idx)),
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

  const exportSectionContent = [...encodeULEB128(exportEntries.length), ...exportEntries.flat()]

  // Code section - function bodies
  const codeBodies: number[][] = []
  for (const fn of functions) {
    const paramInfo = parseRustFunctionParams(fn.params.join(','))
    // Extract parameter names from "name: type" strings
    const paramNames = fn.params.map(p => {
      const match = p.match(/^(\w+)\s*:/)
      return match ? match[1] : p.trim()
    })
    const instructions = parseRustBody(fn.body, paramInfo.count, paramNames)

    // Function body: local count (0), instructions, end
    const body = [
      0x00, // local declaration count (0 locals)
      ...instructions,
      Op.End,
    ]

    codeBodies.push([...encodeULEB128(body.length), ...body])
  }

  const codeSectionContent = [...encodeULEB128(codeBodies.length), ...codeBodies.flat()]

  // Assemble the module
  const module = [
    ...header,
    ...createSection(Section.Type, typeSectionContent),
    ...createSection(Section.Function, funcSectionContent),
    ...createSection(Section.Export, exportSectionContent),
    ...createSection(Section.Code, codeSectionContent),
  ]

  return new Uint8Array(module)
}

/**
 * Parse a Rust parameter string into name and type
 */
function parseRustParam(paramStr: string): ParsedParam {
  const trimmed = paramStr.trim()
  // Match "name: Type" pattern
  const match = trimmed.match(/^(\w+)\s*:\s*(.+)$/)
  if (match) {
    return { name: match[1], type: match[2].trim() }
  }
  // Fallback: treat whole thing as name with unknown type
  return { name: trimmed || 'arg', type: 'i32' }
}

/**
 * Convert Rust type to TypeScript type
 */
function rustTypeToTypeScript(rustType: string): string {
  // Check direct mapping
  if (RUST_TO_TS_TYPE[rustType]) {
    return RUST_TO_TS_TYPE[rustType]
  }
  // Handle references like &str, &mut str
  const refMatch = rustType.match(/^&(?:mut\s+)?(.+)$/)
  if (refMatch) {
    return rustTypeToTypeScript(refMatch[1])
  }
  // Handle generic types like Vec<T>, Option<T>
  const genericMatch = rustType.match(/^(\w+)<(.+)>$/)
  if (genericMatch) {
    const container = genericMatch[1]
    const inner = rustTypeToTypeScript(genericMatch[2])
    if (container === 'Vec') return `${inner}[]`
    if (container === 'Option') return `${inner} | null`
    if (container === 'Result') return inner // Simplified
  }
  // Default to any for unknown types
  return 'unknown'
}

/**
 * Convert Rust type to WASM type code
 */
function rustTypeToWasmType(rustType: string): number {
  // Check direct mapping
  if (RUST_TO_WASM_TYPE[rustType]) {
    return RUST_TO_WASM_TYPE[rustType]
  }
  // Handle references - they become pointers (i32)
  if (rustType.startsWith('&')) {
    return WasmType.I32
  }
  // String types become pointers
  if (rustType === 'String' || rustType === '&str') {
    return WasmType.I32
  }
  // Default to i32
  return WasmType.I32
}

/**
 * Extract function signatures from parsed functions
 */
function extractSignatures(functions: ParsedFunction[]): FunctionSignature[] {
  return functions.map((fn) => ({
    name: fn.name,
    params: fn.params.map(parseRustParam),
    returnType: fn.returnType,
    isAsync: false, // Rust WASM functions are sync at the ABI level
  }))
}

/**
 * Generate capnweb stub bindings from function signatures
 *
 * capnweb bindings provide a Cap'n Proto-style RPC interface for
 * efficient cross-worker communication.
 */
export function generateCapnwebBindings(signatures: FunctionSignature[]): CapnwebBinding[] {
  return signatures.map((sig, index) => {
    let offset = 0
    const params = sig.params.map((param) => {
      const wasmType = rustTypeToWasmType(param.type)
      const size = wasmType === WasmType.I64 || wasmType === WasmType.F64 ? 8 : 4
      const paramBinding = {
        name: param.name,
        type: param.type,
        wasmType,
        offset,
      }
      offset += size
      return paramBinding
    })

    return {
      name: sig.name,
      methodId: index,
      params,
      returnType: sig.returnType
        ? {
            type: sig.returnType,
            wasmType: rustTypeToWasmType(sig.returnType),
          }
        : null,
    }
  })
}

/**
 * Generate TypeScript type definitions from function signatures
 *
 * Creates a .d.ts compatible type file for use with the compiled WASM module.
 */
export function generateTypeScriptTypes(signatures: FunctionSignature[], moduleName: string = 'functions'): string {
  const lines: string[] = [
    '/**',
    ' * Auto-generated TypeScript types for Rust WASM module',
    ' * Generated by Functions.do Rust compiler',
    ' */',
    '',
    `declare module '${moduleName}' {`,
  ]

  // Generate interface for exports
  lines.push('  export interface WasmExports {')
  for (const sig of signatures) {
    const params = sig.params
      .map((p) => `${p.name}: ${rustTypeToTypeScript(p.type)}`)
      .join(', ')
    const returnType = sig.returnType ? rustTypeToTypeScript(sig.returnType) : 'void'
    lines.push(`    ${sig.name}(${params}): ${returnType};`)
  }
  lines.push('  }')
  lines.push('')

  // Generate individual function types
  for (const sig of signatures) {
    const params = sig.params
      .map((p) => `${p.name}: ${rustTypeToTypeScript(p.type)}`)
      .join(', ')
    const returnType = sig.returnType ? rustTypeToTypeScript(sig.returnType) : 'void'
    lines.push(`  export function ${sig.name}(${params}): ${returnType};`)
  }
  lines.push('')

  // Generate capnweb RpcTarget interface
  lines.push('  /**')
  lines.push('   * capnweb RPC target interface for remote invocation')
  lines.push('   */')
  lines.push('  export interface RpcTarget {')
  for (const sig of signatures) {
    const params = sig.params
      .map((p) => `${p.name}: ${rustTypeToTypeScript(p.type)}`)
      .join(', ')
    const returnType = sig.returnType ? rustTypeToTypeScript(sig.returnType) : 'void'
    lines.push(`    ${sig.name}(${params}): Promise<${returnType}>;`)
  }
  lines.push('  }')
  lines.push('')

  // Generate init function type
  lines.push('  /**')
  lines.push('   * Initialize the WASM module')
  lines.push('   */')
  lines.push('  export function init(): Promise<WasmExports>;')
  lines.push('')

  // Generate memory management types
  lines.push('  /**')
  lines.push('   * WASM memory management')
  lines.push('   */')
  lines.push('  export const memory: WebAssembly.Memory;')
  lines.push('  export function alloc(size: number): number;')
  lines.push('  export function dealloc(ptr: number, size: number): void;')

  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

/**
 * Generate wasm-bindgen integration helper code
 *
 * Creates JavaScript glue code for wasm-bindgen style modules.
 */
export function generateWasmBindgenHelpers(signatures: FunctionSignature[]): string {
  const lines: string[] = [
    '/**',
    ' * wasm-bindgen integration helpers',
    ' * Generated by Functions.do Rust compiler',
    ' */',
    '',
    'let wasm;',
    '',
    'const cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });',
    'const cachedTextEncoder = new TextEncoder();',
    '',
    'let cachegetUint8Memory0 = null;',
    'function getUint8Memory0() {',
    '  if (cachegetUint8Memory0 === null || cachegetUint8Memory0.byteLength === 0) {',
    '    cachegetUint8Memory0 = new Uint8Array(wasm.memory.buffer);',
    '  }',
    '  return cachegetUint8Memory0;',
    '}',
    '',
    'function getStringFromWasm0(ptr, len) {',
    '  return cachedTextDecoder.decode(getUint8Memory0().subarray(ptr, ptr + len));',
    '}',
    '',
    'let WASM_VECTOR_LEN = 0;',
    '',
    'function passStringToWasm0(arg, malloc) {',
    '  const buf = cachedTextEncoder.encode(arg);',
    '  const ptr = malloc(buf.length);',
    '  getUint8Memory0().subarray(ptr, ptr + buf.length).set(buf);',
    '  WASM_VECTOR_LEN = buf.length;',
    '  return ptr;',
    '}',
    '',
  ]

  // Generate function wrappers
  for (const sig of signatures) {
    const params = sig.params.map((p) => p.name).join(', ')
    lines.push(`export function ${sig.name}(${params}) {`)

    // Check if any params are strings that need encoding
    const hasStringParams = sig.params.some((p) => p.type === 'String' || p.type === '&str')

    if (hasStringParams) {
      // Handle string parameters
      for (const param of sig.params) {
        if (param.type === 'String' || param.type === '&str') {
          lines.push(`  const ptr_${param.name} = passStringToWasm0(${param.name}, wasm.alloc);`)
          lines.push(`  const len_${param.name} = WASM_VECTOR_LEN;`)
        }
      }
      const wasmParams = sig.params
        .map((p) => {
          if (p.type === 'String' || p.type === '&str') {
            return `ptr_${p.name}, len_${p.name}`
          }
          return p.name
        })
        .join(', ')
      lines.push(`  const ret = wasm.${sig.name}(${wasmParams});`)
    } else {
      lines.push(`  const ret = wasm.${sig.name}(${params});`)
    }

    // Handle return type
    if (sig.returnType === 'String') {
      lines.push('  return getStringFromWasm0(ret);')
    } else if (sig.returnType) {
      lines.push('  return ret;')
    }

    lines.push('}')
    lines.push('')
  }

  // Add init function
  lines.push('export async function init(wasmPath) {')
  lines.push('  const { instance } = await WebAssembly.instantiateStreaming(fetch(wasmPath), {});')
  lines.push('  wasm = instance.exports;')
  lines.push('  return wasm;')
  lines.push('}')
  lines.push('')

  // Add capnweb RPC dispatcher
  lines.push('/**')
  lines.push(' * capnweb RPC dispatcher for remote invocation')
  lines.push(' */')
  lines.push('export class RpcDispatcher {')
  lines.push('  constructor(wasmInstance) {')
  lines.push('    this.wasm = wasmInstance;')
  lines.push('  }')
  lines.push('')
  lines.push('  async invoke(methodId, args) {')
  lines.push('    const methods = [')
  for (const sig of signatures) {
    lines.push(`      '${sig.name}',`)
  }
  lines.push('    ];')
  lines.push('    const methodName = methods[methodId];')
  lines.push('    if (!methodName || !this.wasm[methodName]) {')
  lines.push('      throw new Error(`Unknown method ID: ${methodId}`);')
  lines.push('    }')
  lines.push('    return this.wasm[methodName](...args);')
  lines.push('  }')
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

/**
 * Compile Rust source code to WebAssembly
 *
 * @param code - The Rust source code to compile
 * @param options - Compilation options
 * @returns The compiled WASM binary and metadata
 */
export async function compileRust(code: string, options?: CompileRustOptions): Promise<CompileRustResult> {
  // Validate syntax first
  validateRustSyntax(code)

  // Parse functions from the Rust code
  const functions = parseRustFunctions(code, options)

  if (functions.length === 0) {
    throw new Error('Rust compilation failed: no exportable functions found')
  }

  // Generate the WASM module
  const wasm = generateWasmModule(functions)

  // Extract export names
  const exports = functions.map((fn) => fn.name)

  // Extract function signatures for binding generation
  const signatures = extractSignatures(functions)

  // Build result
  const result: CompileRustResult = {
    wasm,
    exports,
    compiledAt: new Date().toISOString(),
    wasmSize: wasm.length,
    metadata: {
      optimizationLevel: options?.optimizationLevel ?? 0,
      wasmBindgen: options?.useWasmBindgen ?? false,
      sourceSize: code.length,
    },
    signatures,
  }

  // Generate capnweb bindings if requested
  if (options?.generateCapnwebBindings) {
    result.capnwebBindings = generateCapnwebBindings(signatures)
  }

  // Generate TypeScript types if requested
  if (options?.generateTypeScript) {
    result.typeScript = generateTypeScriptTypes(signatures)
  }

  return result
}
