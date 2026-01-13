/**
 * Go to WASM Compilation for Functions.do
 *
 * This module compiles Go source code to WebAssembly using TinyGo.
 * When TinyGo is not available, it generates WASM programmatically
 * for testing and development purposes.
 *
 * Features:
 * - Parse go:wasmexport directives to extract function signatures
 * - Parse Go function bodies and generate WASM bytecode
 * - Generate capnweb RPC bindings from Go function signatures
 * - Generate TypeScript type definitions from Go types
 * - Produce minimal WASM binaries (target: 100KB-2MB)
 * - Support for SDK template generation
 */

import { WASM_TYPES, WASM_SECTIONS, WASM_OPCODES, WASM_HEADER } from '../../core/wasm-types'
import { encodeULEB128, encodeSLEB128, createSection, createVector } from '../../core/wasm-encoding'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

const execAsync = promisify(exec)

// ============================================================================
// Go AST Types
// ============================================================================

interface GoExpr {
  type: 'number' | 'variable' | 'binary' | 'unary' | 'call' | 'bool'
  value?: number | string | boolean
  op?: string
  left?: GoExpr
  right?: GoExpr
  operand?: GoExpr
  name?: string
  args?: GoExpr[]
}

interface GoStmt {
  type: 'return' | 'if' | 'for' | 'assign' | 'vardecl' | 'switch' | 'expr' | 'multiassign'
  expr?: GoExpr
  condition?: GoExpr
  body?: GoStmt[]
  elseBody?: GoStmt[]
  init?: GoStmt
  post?: GoStmt
  varName?: string
  varType?: string
  cases?: { values: GoExpr[] | null; body: GoStmt[] }[]
  // For multi-variable assignments (a, b = b, a+b)
  varNames?: string[]
  exprs?: GoExpr[]
}

interface GoFunction {
  name: string
  exportName: string
  params: Array<{ name: string; type: string }>
  returnType: string | null
  body: GoStmt[]
  locals: Map<string, { type: string; index: number }>
}

// ============================================================================
// Types
// ============================================================================

export interface CompileResult {
  wasm: Uint8Array
  exports: string[]
  /** Generated TypeScript types for the exported functions */
  typescriptTypes?: string
  /** Generated capnweb bindings */
  capnwebBindings?: string
  /** Compilation metadata */
  metadata?: CompileMetadata
}

export interface CompileMetadata {
  /** Size of the WASM binary in bytes */
  wasmSize: number
  /** Timestamp when compilation completed */
  compiledAt: string
  /** Whether TinyGo was used for compilation */
  usedTinyGo: boolean
  /** TinyGo version if available */
  tinyGoVersion?: string
  /** Optimization level used */
  optimizationLevel?: string
}

export interface CompileOptions {
  /** Generate TypeScript type definitions */
  generateTypes?: boolean
  /** Generate capnweb bindings */
  generateBindings?: boolean
  /** Optimization level for TinyGo (s, z, 0, 1, 2) */
  optimizationLevel?: 's' | 'z' | '0' | '1' | '2'
  /** Target output size in bytes (will warn if exceeded) */
  targetSize?: number
  /** Enable debug symbols */
  debug?: boolean
}

export interface FunctionSignature {
  name: string
  params: Array<{ name: string; type: string }>
  returnType: string | null
  /** Documentation comment if present */
  doc?: string
}

// ============================================================================
// Go Type to TypeScript/WASM Type Mappings
// ============================================================================

/**
 * Map Go types to TypeScript types
 */
const GO_TO_TS_TYPE: Record<string, string> = {
  'int': 'number',
  'int8': 'number',
  'int16': 'number',
  'int32': 'number',
  'int64': 'bigint',
  'uint': 'number',
  'uint8': 'number',
  'uint16': 'number',
  'uint32': 'number',
  'uint64': 'bigint',
  'float32': 'number',
  'float64': 'number',
  'bool': 'boolean',
  'string': 'string',
  'byte': 'number',
  'rune': 'number',
}

/**
 * Map Go types to WASM types
 */
const GO_TO_WASM_TYPE: Record<string, number> = {
  'int': WASM_TYPES.I32,      // i32
  'int8': WASM_TYPES.I32,     // i32
  'int16': WASM_TYPES.I32,    // i32
  'int32': WASM_TYPES.I32,    // i32
  'int64': WASM_TYPES.I64,    // i64
  'uint': WASM_TYPES.I32,     // i32
  'uint8': WASM_TYPES.I32,    // i32
  'uint16': WASM_TYPES.I32,   // i32
  'uint32': WASM_TYPES.I32,   // i32
  'uint64': WASM_TYPES.I64,   // i64
  'float32': WASM_TYPES.F32,  // f32
  'float64': WASM_TYPES.F64,  // f64
  'bool': WASM_TYPES.I32,     // i32
  'byte': WASM_TYPES.I32,     // i32
  'rune': WASM_TYPES.I32,     // i32
}

// ============================================================================
// Go Code Parsing
// ============================================================================

/**
 * Parse Go code to extract exported function signatures from go:wasmexport directives
 */
export function parseGoExports(code: string): FunctionSignature[] {
  const exports: FunctionSignature[] = []

  // Match optional doc comment, //go:wasmexport, followed by function declaration
  const exportRegex = /((?:\/\/[^\n]*\n)*)?\/\/go:wasmexport\s+(\w+)\s*\n\s*func\s+\w+\s*\(([^)]*)\)\s*(\w+)?\s*\{/g

  let match
  while ((match = exportRegex.exec(code)) !== null) {
    const docComment = match[1]?.trim() || undefined
    const exportName = match[2]
    const paramsStr = match[3].trim()
    const returnType = match[4] || null

    const params: Array<{ name: string; type: string }> = []
    if (paramsStr) {
      // Parse parameters like "a, b int32" or "a int32, b int32"
      const paramParts = paramsStr.split(',').map(p => p.trim())
      let lastType = ''

      // Process parameters in reverse to handle Go's type inference
      for (let i = paramParts.length - 1; i >= 0; i--) {
        const part = paramParts[i].trim()
        const tokens = part.split(/\s+/)

        if (tokens.length >= 2) {
          // Has explicit type: "a int32" or "a, b int32" case
          lastType = tokens[tokens.length - 1]
          for (let j = 0; j < tokens.length - 1; j++) {
            params.unshift({ name: tokens[j].replace(',', ''), type: lastType })
          }
        } else if (tokens.length === 1 && lastType) {
          // Just a name, use last known type
          params.unshift({ name: tokens[0], type: lastType })
        }
      }
    }

    exports.push({ name: exportName, params, returnType, doc: docComment })
  }

  return exports
}

/**
 * Parse Go struct definitions for complex type mapping
 */
export function parseGoStructs(code: string): Map<string, Array<{ name: string; type: string }>> {
  const structs = new Map<string, Array<{ name: string; type: string }>>()

  // Match struct definitions
  const structRegex = /type\s+(\w+)\s+struct\s*\{([^}]*)\}/g

  let match
  while ((match = structRegex.exec(code)) !== null) {
    const structName = match[1]
    const fieldsStr = match[2]
    const fields: Array<{ name: string; type: string }> = []

    // Parse fields
    const fieldLines = fieldsStr.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'))
    for (const line of fieldLines) {
      const parts = line.split(/\s+/)
      if (parts.length >= 2) {
        fields.push({ name: parts[0], type: parts[1] })
      }
    }

    structs.set(structName, fields)
  }

  return structs
}

// ============================================================================
// Type Conversion Helpers
// ============================================================================

/**
 * Map Go types to WASM types
 */
function goTypeToWasmType(goType: string): number {
  return GO_TO_WASM_TYPE[goType] ?? WASM_TYPES.I32 // default to i32
}

/**
 * Map Go types to TypeScript types
 */
function goTypeToTsType(goType: string): string {
  return GO_TO_TS_TYPE[goType] ?? 'unknown'
}

// ============================================================================
// TypeScript Type Generation
// ============================================================================

/**
 * Generate TypeScript type definitions from Go function signatures
 */
export function generateTypeScriptTypes(
  signatures: FunctionSignature[],
  moduleName: string = 'GoModule'
): string {
  const lines: string[] = [
    '/**',
    ` * TypeScript type definitions for ${moduleName}`,
    ' * Generated from Go source by Functions.do',
    ' */',
    '',
    '// WASM module exports interface',
    `export interface ${moduleName}Exports {`,
  ]

  for (const sig of signatures) {
    // Add JSDoc comment if available
    if (sig.doc) {
      const docLines = sig.doc.split('\n').map(l => l.replace(/^\/\/\s*/, ''))
      lines.push('  /**')
      for (const docLine of docLines) {
        lines.push(`   * ${docLine}`)
      }
      lines.push('   */')
    }

    // Generate function signature
    const params = sig.params.map(p => `${p.name}: ${goTypeToTsType(p.type)}`).join(', ')
    const returnType = sig.returnType ? goTypeToTsType(sig.returnType) : 'void'
    lines.push(`  ${sig.name}(${params}): ${returnType}`)
  }

  lines.push('}')
  lines.push('')

  // Generate parameter types for each function
  for (const sig of signatures) {
    if (sig.params.length > 0) {
      lines.push(`export interface ${capitalize(sig.name)}Params {`)
      for (const param of sig.params) {
        lines.push(`  ${param.name}: ${goTypeToTsType(param.type)}`)
      }
      lines.push('}')
      lines.push('')
    }
  }

  // Generate a wrapper class for capnweb integration
  lines.push('// Capnweb RPC wrapper')
  lines.push(`export interface ${moduleName}RpcTarget {`)
  for (const sig of signatures) {
    const params = sig.params.map(p => `${p.name}: ${goTypeToTsType(p.type)}`).join(', ')
    const returnType = sig.returnType ? goTypeToTsType(sig.returnType) : 'void'
    lines.push(`  ${sig.name}(${params}): Promise<${returnType}>`)
  }
  lines.push('}')

  return lines.join('\n')
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

// ============================================================================
// Capnweb Bindings Generation
// ============================================================================

/**
 * Generate capnweb RPC bindings from Go function signatures
 */
export function generateCapnwebBindings(
  signatures: FunctionSignature[],
  moduleName: string = 'GoModule'
): string {
  const lines: string[] = [
    '/**',
    ` * Capnweb RPC bindings for ${moduleName}`,
    ' * Generated from Go source by Functions.do',
    ' */',
    '',
    "import { RpcTarget } from 'capnweb'",
    '',
    '// WASM instance type',
    'interface WasmInstance {',
    '  exports: {',
  ]

  for (const sig of signatures) {
    const params = sig.params.map(p => `${p.name}: ${goTypeToTsType(p.type)}`).join(', ')
    const returnType = sig.returnType ? goTypeToTsType(sig.returnType) : 'void'
    lines.push(`    ${sig.name}(${params}): ${returnType}`)
  }

  lines.push('    memory: WebAssembly.Memory')
  lines.push('  }')
  lines.push('}')
  lines.push('')

  // Generate the RPC target class
  lines.push(`/**`)
  lines.push(` * ${moduleName}Target wraps a WASM instance as an RpcTarget`)
  lines.push(` */`)
  lines.push(`export class ${moduleName}Target extends RpcTarget {`)
  lines.push(`  private instance: WasmInstance`)
  lines.push('')
  lines.push(`  constructor(instance: WasmInstance) {`)
  lines.push(`    super()`)
  lines.push(`    this.instance = instance`)
  lines.push(`  }`)
  lines.push('')

  // Generate method wrappers
  for (const sig of signatures) {
    const params = sig.params.map(p => `${p.name}: ${goTypeToTsType(p.type)}`).join(', ')
    const args = sig.params.map(p => p.name).join(', ')
    const returnType = sig.returnType ? goTypeToTsType(sig.returnType) : 'void'

    if (sig.doc) {
      const docLines = sig.doc.split('\n').map(l => l.replace(/^\/\/\s*/, ''))
      lines.push('  /**')
      for (const docLine of docLines) {
        lines.push(`   * ${docLine}`)
      }
      lines.push('   */')
    }

    lines.push(`  ${sig.name}(${params}): ${returnType} {`)
    if (sig.returnType) {
      lines.push(`    return this.instance.exports.${sig.name}(${args})`)
    } else {
      lines.push(`    this.instance.exports.${sig.name}(${args})`)
    }
    lines.push(`  }`)
    lines.push('')
  }

  lines.push(`  [Symbol.dispose](): void {`)
  lines.push(`    // Clean up WASM resources if needed`)
  lines.push(`  }`)
  lines.push('}')
  lines.push('')

  // Generate factory function
  lines.push(`/**`)
  lines.push(` * Create a ${moduleName}Target from compiled WASM bytes`)
  lines.push(` */`)
  lines.push(`export async function create${moduleName}Target(wasmBytes: Uint8Array): Promise<${moduleName}Target> {`)
  lines.push(`  const module = await WebAssembly.compile(wasmBytes)`)
  lines.push(`  const instance = await WebAssembly.instantiate(module) as unknown as WasmInstance`)
  lines.push(`  return new ${moduleName}Target(instance)`)
  lines.push('}')

  return lines.join('\n')
}

// ============================================================================
// go:wasmexport Directive Helpers
// ============================================================================

/**
 * Generate go:wasmexport directive for a function signature
 */
export function generateWasmExportDirective(
  funcName: string,
  exportName?: string
): string {
  return `//go:wasmexport ${exportName ?? funcName}`
}

/**
 * Wrap existing Go function with go:wasmexport directive
 */
export function wrapWithWasmExport(
  goCode: string,
  funcName: string,
  exportName?: string
): string {
  // Find the function declaration and add the directive
  const funcRegex = new RegExp(`(func\\s+${funcName}\\s*\\()`)
  const directive = generateWasmExportDirective(funcName, exportName)

  if (funcRegex.test(goCode)) {
    return goCode.replace(funcRegex, `${directive}\n$1`)
  }

  return goCode
}

/**
 * Generate a complete Go function with go:wasmexport
 */
export function generateGoExportedFunction(sig: FunctionSignature): string {
  const params = sig.params.map(p => `${p.name} ${p.type}`).join(', ')
  const returnType = sig.returnType ? ` ${sig.returnType}` : ''

  const lines: string[] = []

  if (sig.doc) {
    lines.push(sig.doc)
  }

  lines.push(generateWasmExportDirective(sig.name))
  lines.push(`func ${sig.name}(${params})${returnType} {`)
  lines.push(`\t// TODO: Implement function logic`)
  if (sig.returnType) {
    const defaultReturn = getGoDefaultValue(sig.returnType)
    lines.push(`\treturn ${defaultReturn}`)
  }
  lines.push('}')

  return lines.join('\n')
}

/**
 * Get default zero value for Go type
 */
function getGoDefaultValue(goType: string): string {
  switch (goType) {
    case 'int':
    case 'int8':
    case 'int16':
    case 'int32':
    case 'int64':
    case 'uint':
    case 'uint8':
    case 'uint16':
    case 'uint32':
    case 'uint64':
    case 'byte':
    case 'rune':
      return '0'
    case 'float32':
    case 'float64':
      return '0.0'
    case 'bool':
      return 'false'
    case 'string':
      return '""'
    default:
      return '0'
  }
}


// ============================================================================
// Go Expression Parser
// ============================================================================

/**
 * Tokenize Go expression
 */
function tokenizeExpr(input: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) {
      i++
      continue
    }
    // Multi-char operators
    if (i < input.length - 1) {
      const two = input.slice(i, i + 2)
      if (['==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '++', '--', ':=', '+=', '-=', '*=', '/=', '%='].includes(two)) {
        tokens.push(two)
        i += 2
        continue
      }
    }
    // Single-char operators/punctuation
    if ('+-*/%&|^<>(){}[]!;,='.includes(input[i])) {
      tokens.push(input[i])
      i++
      continue
    }
    // Numbers
    if (/[0-9]/.test(input[i]) || (input[i] === '-' && i + 1 < input.length && /[0-9]/.test(input[i + 1]))) {
      let num = ''
      if (input[i] === '-') {
        num = '-'
        i++
      }
      // Handle hex, binary, octal
      if (input[i] === '0' && i + 1 < input.length) {
        if (input[i + 1] === 'x' || input[i + 1] === 'X') {
          num += input.slice(i, i + 2)
          i += 2
          while (i < input.length && /[0-9a-fA-F]/.test(input[i])) {
            num += input[i++]
          }
          tokens.push(num)
          continue
        } else if (input[i + 1] === 'b' || input[i + 1] === 'B') {
          num += input.slice(i, i + 2)
          i += 2
          while (i < input.length && /[01]/.test(input[i])) {
            num += input[i++]
          }
          tokens.push(num)
          continue
        }
      }
      while (i < input.length && /[0-9.]/.test(input[i])) {
        num += input[i++]
      }
      tokens.push(num)
      continue
    }
    // Identifiers
    if (/[a-zA-Z_]/.test(input[i])) {
      let id = ''
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
        id += input[i++]
      }
      tokens.push(id)
      continue
    }
    i++
  }
  return tokens
}

/**
 * Parse a Go expression from tokens
 */
function parseExpr(tokens: string[], pos: { i: number }): GoExpr {
  return parseOrExpr(tokens, pos)
}

function parseOrExpr(tokens: string[], pos: { i: number }): GoExpr {
  let left = parseAndExpr(tokens, pos)
  while (pos.i < tokens.length && tokens[pos.i] === '||') {
    pos.i++
    const right = parseAndExpr(tokens, pos)
    left = { type: 'binary', op: '||', left, right }
  }
  return left
}

function parseAndExpr(tokens: string[], pos: { i: number }): GoExpr {
  let left = parseCompareExpr(tokens, pos)
  while (pos.i < tokens.length && tokens[pos.i] === '&&') {
    pos.i++
    const right = parseCompareExpr(tokens, pos)
    left = { type: 'binary', op: '&&', left, right }
  }
  return left
}

function parseCompareExpr(tokens: string[], pos: { i: number }): GoExpr {
  let left = parseBitwiseOrExpr(tokens, pos)
  while (pos.i < tokens.length && ['==', '!=', '<', '>', '<=', '>='].includes(tokens[pos.i])) {
    const op = tokens[pos.i++]
    const right = parseBitwiseOrExpr(tokens, pos)
    left = { type: 'binary', op, left, right }
  }
  return left
}

function parseBitwiseOrExpr(tokens: string[], pos: { i: number }): GoExpr {
  let left = parseBitwiseXorExpr(tokens, pos)
  while (pos.i < tokens.length && tokens[pos.i] === '|' && tokens[pos.i + 1] !== '|') {
    pos.i++
    const right = parseBitwiseXorExpr(tokens, pos)
    left = { type: 'binary', op: '|', left, right }
  }
  return left
}

function parseBitwiseXorExpr(tokens: string[], pos: { i: number }): GoExpr {
  let left = parseBitwiseAndExpr(tokens, pos)
  while (pos.i < tokens.length && tokens[pos.i] === '^') {
    pos.i++
    const right = parseBitwiseAndExpr(tokens, pos)
    left = { type: 'binary', op: '^', left, right }
  }
  return left
}

function parseBitwiseAndExpr(tokens: string[], pos: { i: number }): GoExpr {
  let left = parseShiftExpr(tokens, pos)
  while (pos.i < tokens.length && tokens[pos.i] === '&' && tokens[pos.i + 1] !== '&') {
    pos.i++
    const right = parseShiftExpr(tokens, pos)
    left = { type: 'binary', op: '&', left, right }
  }
  return left
}

function parseShiftExpr(tokens: string[], pos: { i: number }): GoExpr {
  let left = parseAddExpr(tokens, pos)
  while (pos.i < tokens.length && ['<<', '>>'].includes(tokens[pos.i])) {
    const op = tokens[pos.i++]
    const right = parseAddExpr(tokens, pos)
    left = { type: 'binary', op, left, right }
  }
  return left
}

function parseAddExpr(tokens: string[], pos: { i: number }): GoExpr {
  let left = parseMulExpr(tokens, pos)
  while (pos.i < tokens.length && ['+', '-'].includes(tokens[pos.i])) {
    const op = tokens[pos.i++]
    const right = parseMulExpr(tokens, pos)
    left = { type: 'binary', op, left, right }
  }
  return left
}

function parseMulExpr(tokens: string[], pos: { i: number }): GoExpr {
  let left = parseUnaryExpr(tokens, pos)
  while (pos.i < tokens.length && ['*', '/', '%'].includes(tokens[pos.i])) {
    const op = tokens[pos.i++]
    const right = parseUnaryExpr(tokens, pos)
    left = { type: 'binary', op, left, right }
  }
  return left
}

function parseUnaryExpr(tokens: string[], pos: { i: number }): GoExpr {
  if (pos.i < tokens.length && tokens[pos.i] === '-') {
    pos.i++
    const operand = parseUnaryExpr(tokens, pos)
    return { type: 'unary', op: '-', operand }
  }
  if (pos.i < tokens.length && tokens[pos.i] === '!') {
    pos.i++
    const operand = parseUnaryExpr(tokens, pos)
    return { type: 'unary', op: '!', operand }
  }
  return parsePrimaryExpr(tokens, pos)
}

function parsePrimaryExpr(tokens: string[], pos: { i: number }): GoExpr {
  const token = tokens[pos.i]

  // Boolean literals
  if (token === 'true') {
    pos.i++
    return { type: 'bool', value: true }
  }
  if (token === 'false') {
    pos.i++
    return { type: 'bool', value: false }
  }

  // Numbers
  if (/^-?[0-9]/.test(token) || /^0[xXbB]/.test(token)) {
    pos.i++
    let val: number
    if (token.startsWith('0x') || token.startsWith('0X')) {
      val = parseInt(token, 16)
    } else if (token.startsWith('0b') || token.startsWith('0B')) {
      val = parseInt(token.slice(2), 2)
    } else {
      val = parseFloat(token)
    }
    return { type: 'number', value: val }
  }

  // Parenthesized expression
  if (token === '(') {
    pos.i++ // consume '('
    const expr = parseExpr(tokens, pos)
    if (tokens[pos.i] === ')') pos.i++ // consume ')'
    return expr
  }

  // Identifier (variable or function call)
  if (/^[a-zA-Z_]/.test(token)) {
    pos.i++
    // Check for function call
    if (pos.i < tokens.length && tokens[pos.i] === '(') {
      pos.i++ // consume '('
      const args: GoExpr[] = []
      while (pos.i < tokens.length && tokens[pos.i] !== ')') {
        args.push(parseExpr(tokens, pos))
        if (tokens[pos.i] === ',') pos.i++
      }
      if (tokens[pos.i] === ')') pos.i++ // consume ')'
      return { type: 'call', name: token, args }
    }
    return { type: 'variable', name: token }
  }

  // Default: return 0
  return { type: 'number', value: 0 }
}

/**
 * Parse multiple comma-separated expressions
 * This handles cases like "0, 1" or "b, a+b"
 */
function parseMultipleExprs(exprStr: string): GoExpr[] {
  const exprs: GoExpr[] = []

  // Split by comma, but need to handle nested expressions
  // Simple approach: split by comma at depth 0
  let depth = 0
  let current = ''

  for (let i = 0; i < exprStr.length; i++) {
    const char = exprStr[i]
    if (char === '(' || char === '[' || char === '{') {
      depth++
      current += char
    } else if (char === ')' || char === ']' || char === '}') {
      depth--
      current += char
    } else if (char === ',' && depth === 0) {
      if (current.trim()) {
        const tokens = tokenizeExpr(current.trim())
        exprs.push(parseExpr(tokens, { i: 0 }))
      }
      current = ''
    } else {
      current += char
    }
  }

  // Handle last expression
  if (current.trim()) {
    const tokens = tokenizeExpr(current.trim())
    exprs.push(parseExpr(tokens, { i: 0 }))
  }

  return exprs
}

// ============================================================================
// Go Statement Parser
// ============================================================================

/**
 * Strip inline comments from a line of Go code
 */
function stripInlineComment(line: string): string {
  // Find // that's not inside a string
  let inString = false
  let stringChar = ''
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inString) {
      if (char === '\\' && i + 1 < line.length) {
        i++ // Skip escaped char
      } else if (char === stringChar) {
        inString = false
      }
    } else {
      if (char === '"' || char === '\'' || char === '`') {
        inString = true
        stringChar = char
      } else if (char === '/' && line[i + 1] === '/') {
        return line.slice(0, i).trim()
      }
    }
  }
  return line
}

/**
 * Parse Go function body statements
 */
function parseGoBody(bodyStr: string): GoStmt[] {
  const stmts: GoStmt[] = []
  const lines = splitStatements(bodyStr)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//')) continue

    // Strip inline comments only for simple statements (not blocks)
    // Block statements (if, for, switch) handle their own comment stripping
    let processed = trimmed
    if (!trimmed.includes('{')) {
      processed = stripInlineComment(trimmed)
      if (!processed) continue
    }

    const stmt = parseStatement(processed, lines)
    if (stmt) stmts.push(stmt)
  }

  return stmts
}

/**
 * Split body into statements, handling nested blocks and else/else if chains
 */
function splitStatements(body: string): string[] {
  const stmts: string[] = []
  let current = ''
  let braceDepth = 0
  let i = 0

  while (i < body.length) {
    const char = body[i]

    if (char === '{') {
      braceDepth++
      current += char
      i++
    } else if (char === '}') {
      braceDepth--
      current += char
      if (braceDepth === 0) {
        // Check if next non-whitespace is "else" - if so, continue this statement
        const remaining = body.slice(i + 1)
        const nextNonWhitespace = remaining.match(/^\s*(else\b)?/)
        if (nextNonWhitespace && nextNonWhitespace[1]) {
          // Continue accumulating - this is part of an if-else chain
          i++
          continue
        }
        if (current.trim()) {
          stmts.push(current.trim())
          current = ''
        }
      }
      i++
    } else if (char === '\n' && braceDepth === 0) {
      if (current.trim()) {
        stmts.push(current.trim())
      }
      current = ''
      i++
    } else {
      current += char
      i++
    }
  }

  if (current.trim()) {
    stmts.push(current.trim())
  }

  return stmts
}

/**
 * Parse a single statement
 */
function parseStatement(line: string, _allLines: string[]): GoStmt | null {
  // Return statement
  if (line.startsWith('return ') || line === 'return') {
    const exprStr = line.slice(6).trim()
    if (!exprStr) return { type: 'return' }
    const tokens = tokenizeExpr(exprStr)
    const expr = parseExpr(tokens, { i: 0 })
    return { type: 'return', expr }
  }

  // If statement - need to handle chained else if
  if (line.startsWith('if ')) {
    // Find the end of the if condition and start of body
    const firstBrace = line.indexOf('{')
    if (firstBrace === -1) return null

    const condStr = line.slice(3, firstBrace).trim()

    // Find matching closing brace for if body
    let braceDepth = 1
    let ifBodyEnd = firstBrace + 1
    while (ifBodyEnd < line.length && braceDepth > 0) {
      if (line[ifBodyEnd] === '{') braceDepth++
      else if (line[ifBodyEnd] === '}') braceDepth--
      ifBodyEnd++
    }

    const bodyStr = line.slice(firstBrace + 1, ifBodyEnd - 1)

    // Check for else or else if
    const afterBody = line.slice(ifBodyEnd).trim()
    let elseBody: GoStmt[] | undefined

    if (afterBody.startsWith('else if ')) {
      // Parse the entire "else if ..." as a single nested if statement
      const elseIfStmt = parseStatement(afterBody.slice(5).trim(), _allLines)
      if (elseIfStmt) {
        elseBody = [elseIfStmt]
      }
    } else if (afterBody.startsWith('else {')) {
      // Parse else body
      const elseStart = afterBody.indexOf('{')
      let elseEnd = elseStart + 1
      braceDepth = 1
      while (elseEnd < afterBody.length && braceDepth > 0) {
        if (afterBody[elseEnd] === '{') braceDepth++
        else if (afterBody[elseEnd] === '}') braceDepth--
        elseEnd++
      }
      const elseBodyStr = afterBody.slice(elseStart + 1, elseEnd - 1)
      elseBody = parseGoBody(elseBodyStr)
    }

    const condTokens = tokenizeExpr(condStr)
    const condition = parseExpr(condTokens, { i: 0 })
    const body = parseGoBody(bodyStr)

    return { type: 'if', condition, body, elseBody }
  }

  // For loop
  const forMatch = line.match(/^for\s+(.*?)\s*\{([\s\S]*)\}$/)
  if (forMatch) {
    const forClause = forMatch[1]
    const bodyStr = forMatch[2]
    const body = parseGoBody(bodyStr)

    // Check for three-part for loop: init; cond; post
    const parts = forClause.split(';').map(p => p.trim())
    if (parts.length === 3) {
      const init = parseStatement(parts[0], []) ?? undefined
      const condTokens = tokenizeExpr(parts[1])
      const condition = parseExpr(condTokens, { i: 0 })
      const post = parseStatement(parts[2], []) ?? undefined
      return { type: 'for', init, condition, body, post }
    } else if (forClause) {
      // Simple condition loop: for condition { }
      const condTokens = tokenizeExpr(forClause)
      const condition = parseExpr(condTokens, { i: 0 })
      return { type: 'for', condition, body }
    }

    return { type: 'for', body }
  }

  // Switch statement
  const switchMatch = line.match(/^switch\s+(.*?)\s*\{([\s\S]*)\}$/)
  if (switchMatch) {
    const switchExprStr = switchMatch[1]
    const casesStr = switchMatch[2]

    const switchTokens = tokenizeExpr(switchExprStr)
    const expr = parseExpr(switchTokens, { i: 0 })

    // Parse cases
    const cases: { values: GoExpr[] | null; body: GoStmt[] }[] = []
    const caseMatches = casesStr.matchAll(/(?:case\s+([\d,\s]+)|default)\s*:([\s\S]*?)(?=case|default|$)/g)

    for (const caseMatch of caseMatches) {
      const valuesStr = caseMatch[1]
      const caseBody = caseMatch[2]

      if (valuesStr) {
        const values = valuesStr.split(',').map(v => {
          const tokens = tokenizeExpr(v.trim())
          return parseExpr(tokens, { i: 0 })
        })
        cases.push({ values, body: parseGoBody(caseBody) })
      } else {
        // default case
        cases.push({ values: null, body: parseGoBody(caseBody) })
      }
    }

    return { type: 'switch', expr, cases }
  }

  // Variable declaration with :=
  const declMatch = line.match(/^(\w+(?:\s*,\s*\w+)*)\s*:=\s*(.+)$/)
  if (declMatch) {
    const varNames = declMatch[1].split(',').map(v => v.trim())
    const exprStr = declMatch[2]

    // Handle multi-variable declaration
    if (varNames.length > 1) {
      const exprs = parseMultipleExprs(exprStr)
      return { type: 'multiassign', varNames, exprs, varType: 'int32' }
    }

    const tokens = tokenizeExpr(exprStr)
    const expr = parseExpr(tokens, { i: 0 })
    return { type: 'vardecl', varName: varNames[0], expr }
  }

  // Variable declaration with var
  const varMatch = line.match(/^var\s+(\w+(?:\s*,\s*\w+)*)\s+(\w+)\s*=\s*(.+)$/)
  if (varMatch) {
    const varNames = varMatch[1].split(',').map(v => v.trim())
    const varType = varMatch[2]
    const exprStr = varMatch[3]

    // Handle multi-variable declaration
    if (varNames.length > 1) {
      const exprs = parseMultipleExprs(exprStr)
      return { type: 'multiassign', varNames, exprs, varType }
    }

    const tokens = tokenizeExpr(exprStr)
    const expr = parseExpr(tokens, { i: 0 })
    return { type: 'vardecl', varName: varNames[0], varType, expr }
  }

  // Assignment with = or compound assignments
  const assignMatch = line.match(/^(\w+(?:\s*,\s*\w+)*)\s*(=|\+=|-=|\*=|\/=|%=)\s*(.+)$/)
  if (assignMatch) {
    const varNames = assignMatch[1].split(',').map(v => v.trim())
    const op = assignMatch[2]
    const exprStr = assignMatch[3]

    // Handle multi-variable assignment (e.g., a, b = b, a+b)
    if (varNames.length > 1 && op === '=') {
      const exprs = parseMultipleExprs(exprStr)
      return { type: 'multiassign', varNames, exprs }
    }

    const tokens = tokenizeExpr(exprStr)
    let expr = parseExpr(tokens, { i: 0 })

    // Handle compound assignments
    if (op !== '=') {
      const baseOp = op.slice(0, -1)
      expr = { type: 'binary', op: baseOp, left: { type: 'variable', name: varNames[0] }, right: expr }
    }

    return { type: 'assign', varName: varNames[0], expr }
  }

  // Increment/decrement
  const incMatch = line.match(/^(\w+)\s*(\+\+|--)$/)
  if (incMatch) {
    const varName = incMatch[1]
    const op = incMatch[2] === '++' ? '+' : '-'
    return {
      type: 'assign',
      varName,
      expr: { type: 'binary', op, left: { type: 'variable', name: varName }, right: { type: 'number', value: 1 } }
    }
  }

  return null
}

// ============================================================================
// WASM Bytecode Generation from Go AST
// ============================================================================

interface CodeGenContext {
  params: Array<{ name: string; type: string }>
  locals: Map<string, { index: number; type: string }>
  nextLocalIndex: number
  funcs: Map<string, number> // function name -> index
  returnType: string | null
}

/**
 * Generate WASM bytecode for an expression
 */
function genExpr(expr: GoExpr, ctx: CodeGenContext): number[] {
  const code: number[] = []

  switch (expr.type) {
    case 'number': {
      const val = expr.value as number
      if (Number.isInteger(val)) {
        code.push(WASM_OPCODES.I32_CONST, ...encodeSLEB128(val))
      } else {
        // Float constant
        const buf = new ArrayBuffer(4)
        new DataView(buf).setFloat32(0, val, true)
        code.push(WASM_OPCODES.F32_CONST, ...new Uint8Array(buf))
      }
      break
    }

    case 'bool': {
      code.push(WASM_OPCODES.I32_CONST, expr.value ? 1 : 0)
      break
    }

    case 'variable': {
      const name = expr.name!
      // Check params first
      const paramIdx = ctx.params.findIndex(p => p.name === name)
      if (paramIdx !== -1) {
        code.push(WASM_OPCODES.LOCAL_GET, ...encodeULEB128(paramIdx))
      } else if (ctx.locals.has(name)) {
        code.push(WASM_OPCODES.LOCAL_GET, ...encodeULEB128(ctx.locals.get(name)!.index))
      } else {
        // Unknown variable - return 0
        code.push(WASM_OPCODES.I32_CONST, 0)
      }
      break
    }

    case 'binary': {
      code.push(...genExpr(expr.left!, ctx))
      code.push(...genExpr(expr.right!, ctx))

      switch (expr.op) {
        case '+': code.push(WASM_OPCODES.I32_ADD); break
        case '-': code.push(WASM_OPCODES.I32_SUB); break
        case '*': code.push(WASM_OPCODES.I32_MUL); break
        case '/': code.push(WASM_OPCODES.I32_DIV_S); break
        case '%': code.push(WASM_OPCODES.I32_REM_S); break
        case '&': code.push(WASM_OPCODES.I32_AND); break
        case '|': code.push(WASM_OPCODES.I32_OR); break
        case '^': code.push(WASM_OPCODES.I32_XOR); break
        case '<<': code.push(WASM_OPCODES.I32_SHL); break
        case '>>': code.push(WASM_OPCODES.I32_SHR_S); break
        case '<': code.push(WASM_OPCODES.I32_LT_S); break
        case '>': code.push(WASM_OPCODES.I32_GT_S); break
        case '<=': code.push(WASM_OPCODES.I32_LE_S); break
        case '>=': code.push(WASM_OPCODES.I32_GE_S); break
        case '==': code.push(WASM_OPCODES.I32_EQ); break
        case '!=': code.push(WASM_OPCODES.I32_NE); break
        case '&&': {
          // Short-circuit AND: if left is 0, result is 0; else result is right
          // Already have both operands on stack, use i32.and for simplicity
          code.push(WASM_OPCODES.I32_AND)
          break
        }
        case '||': {
          // Short-circuit OR: use i32.or for simplicity
          code.push(WASM_OPCODES.I32_OR)
          break
        }
      }
      break
    }

    case 'unary': {
      if (expr.op === '-') {
        code.push(WASM_OPCODES.I32_CONST, 0)
        code.push(...genExpr(expr.operand!, ctx))
        code.push(WASM_OPCODES.I32_SUB)
      } else if (expr.op === '!') {
        code.push(...genExpr(expr.operand!, ctx))
        code.push(WASM_OPCODES.I32_EQZ)
      }
      break
    }

    case 'call': {
      // Generate args
      for (const arg of expr.args || []) {
        code.push(...genExpr(arg, ctx))
      }
      // Call function
      const funcIdx = ctx.funcs.get(expr.name!)
      if (funcIdx !== undefined) {
        code.push(WASM_OPCODES.CALL, ...encodeULEB128(funcIdx))
      }
      break
    }
  }

  return code
}

/**
 * Generate WASM bytecode for a statement
 */
function genStmt(stmt: GoStmt, ctx: CodeGenContext): number[] {
  const code: number[] = []

  switch (stmt.type) {
    case 'return': {
      if (stmt.expr) {
        code.push(...genExpr(stmt.expr, ctx))
      }
      code.push(WASM_OPCODES.RETURN)
      break
    }

    case 'if': {
      code.push(...genExpr(stmt.condition!, ctx))

      // Always use void block type (0x40) since we use RETURN opcode for returns
      // RETURN will exit the entire function, so block result type doesn't matter
      code.push(WASM_OPCODES.IF, 0x40)

      for (const s of stmt.body || []) {
        code.push(...genStmt(s, ctx))
      }

      if (stmt.elseBody && stmt.elseBody.length > 0) {
        code.push(WASM_OPCODES.ELSE)
        for (const s of stmt.elseBody) {
          code.push(...genStmt(s, ctx))
        }
      }

      code.push(WASM_OPCODES.END)
      break
    }

    case 'for': {
      // Initialize
      if (stmt.init) {
        code.push(...genStmt(stmt.init, ctx))
      }

      // block { loop { if !cond { br 1 } body; post; br 0 } }
      code.push(WASM_OPCODES.BLOCK, 0x40) // outer block for breaking out
      code.push(WASM_OPCODES.LOOP, 0x40)  // loop block

      // Check condition
      if (stmt.condition) {
        code.push(...genExpr(stmt.condition, ctx))
        code.push(WASM_OPCODES.I32_EQZ)   // if condition is false
        code.push(WASM_OPCODES.BR_IF, 1)  // break to outer block
      }

      // Body
      for (const s of stmt.body || []) {
        code.push(...genStmt(s, ctx))
      }

      // Post
      if (stmt.post) {
        code.push(...genStmt(stmt.post, ctx))
      }

      code.push(WASM_OPCODES.BR, 0)  // continue loop
      code.push(WASM_OPCODES.END)    // end loop
      code.push(WASM_OPCODES.END)    // end block
      break
    }

    case 'switch': {
      // Simple switch implementation using nested ifs
      const switchExpr = stmt.expr!
      const defaultCase = stmt.cases?.find(c => c.values === null)
      const regularCases = stmt.cases?.filter(c => c.values !== null) || []

      // For each case, generate: if (expr == val1 || expr == val2 ...) { body }
      for (const caseItem of regularCases) {
        // Build condition: expr == val1 || expr == val2 ...
        let firstCond = true
        for (const val of caseItem.values!) {
          code.push(...genExpr(switchExpr, ctx))
          code.push(...genExpr(val, ctx))
          code.push(WASM_OPCODES.I32_EQ)
          if (!firstCond) {
            code.push(WASM_OPCODES.I32_OR)
          }
          firstCond = false
        }

        code.push(WASM_OPCODES.IF, 0x40)
        for (const s of caseItem.body) {
          code.push(...genStmt(s, ctx))
        }
        code.push(WASM_OPCODES.END)
      }

      // Default case
      if (defaultCase) {
        for (const s of defaultCase.body) {
          code.push(...genStmt(s, ctx))
        }
      }
      break
    }

    case 'multiassign': {
      // Multi-variable assignment (e.g., a, b = b, a+b or var a, b int32 = 0, 1)
      const varNames = stmt.varNames || []
      const exprs = stmt.exprs || []

      // First, allocate locals for any new variables (if this is a declaration)
      if (stmt.varType) {
        for (const name of varNames) {
          if (!ctx.locals.has(name)) {
            ctx.locals.set(name, { index: ctx.nextLocalIndex++, type: stmt.varType })
          }
        }
      } else {
        // Ensure all variables exist as locals for non-declarations
        for (const name of varNames) {
          const paramIdx = ctx.params.findIndex(p => p.name === name)
          if (paramIdx === -1 && !ctx.locals.has(name)) {
            ctx.locals.set(name, { index: ctx.nextLocalIndex++, type: 'int32' })
          }
        }
      }

      // For parallel assignment, we need to:
      // 1. Evaluate all expressions first (to temp locals)
      // 2. Assign all values to the target variables
      // This is important for cases like a, b = b, a+b where we need old values

      // Allocate temp locals for storing evaluated expressions
      const tempIndices: number[] = []
      for (let i = 0; i < exprs.length; i++) {
        const tempIdx = ctx.nextLocalIndex++
        tempIndices.push(tempIdx)
        // Evaluate expression and store in temp
        code.push(...genExpr(exprs[i], ctx))
        code.push(WASM_OPCODES.LOCAL_SET, ...encodeULEB128(tempIdx))
      }

      // Now assign from temp locals to target variables
      for (let i = 0; i < varNames.length && i < tempIndices.length; i++) {
        const name = varNames[i]
        code.push(WASM_OPCODES.LOCAL_GET, ...encodeULEB128(tempIndices[i]))

        // Check params first
        const paramIdx = ctx.params.findIndex(p => p.name === name)
        if (paramIdx !== -1) {
          code.push(WASM_OPCODES.LOCAL_SET, ...encodeULEB128(paramIdx))
        } else if (ctx.locals.has(name)) {
          code.push(WASM_OPCODES.LOCAL_SET, ...encodeULEB128(ctx.locals.get(name)!.index))
        }
      }
      break
    }

    case 'vardecl': {
      // Allocate new local
      const name = stmt.varName!
      if (!ctx.locals.has(name)) {
        ctx.locals.set(name, { index: ctx.nextLocalIndex++, type: stmt.varType || 'int32' })
      }
      // Fall through to assign
    }
    // eslint-disable-next-line no-fallthrough
    case 'assign': {
      const name = stmt.varName!
      if (stmt.expr) {
        code.push(...genExpr(stmt.expr, ctx))
      }

      // Check params first
      const paramIdx = ctx.params.findIndex(p => p.name === name)
      if (paramIdx !== -1) {
        code.push(WASM_OPCODES.LOCAL_SET, ...encodeULEB128(paramIdx))
      } else if (ctx.locals.has(name)) {
        code.push(WASM_OPCODES.LOCAL_SET, ...encodeULEB128(ctx.locals.get(name)!.index))
      } else {
        // Create new local
        ctx.locals.set(name, { index: ctx.nextLocalIndex++, type: 'int32' })
        code.push(WASM_OPCODES.LOCAL_SET, ...encodeULEB128(ctx.locals.get(name)!.index))
      }
      break
    }
  }

  return code
}

/**
 * Parse Go function and generate WASM body
 */
function parseAndGenerateFunctionBody(
  sig: FunctionSignature,
  code: string,
  funcMap: Map<string, number>
): { body: number[]; localCount: number } {
  // Find the function body in the source code
  // First try to match exported function (with go:wasmexport directive)
  const exportedFuncRegex = new RegExp(
    `//go:wasmexport\\s+${sig.name}\\s*\\n\\s*func\\s+\\w+\\s*\\([^)]*\\)\\s*\\w*\\s*\\{`,
    'g'
  )

  let startMatch = exportedFuncRegex.exec(code)

  // If not found, try to match internal function (by function name)
  if (!startMatch) {
    const internalFuncRegex = new RegExp(
      `func\\s+${sig.name}\\s*\\([^)]*\\)\\s*\\w*\\s*\\{`,
      'g'
    )
    startMatch = internalFuncRegex.exec(code)
  }

  if (!startMatch) {
    // Fallback to simple implementation
    return { body: [WASM_OPCODES.I32_CONST, 0], localCount: 0 }
  }

  // Find the matching closing brace by counting braces
  const bodyStart = startMatch.index + startMatch[0].length
  let braceDepth = 1
  let bodyEnd = bodyStart
  while (bodyEnd < code.length && braceDepth > 0) {
    if (code[bodyEnd] === '{') braceDepth++
    else if (code[bodyEnd] === '}') braceDepth--
    bodyEnd++
  }

  const bodyStr = code.slice(bodyStart, bodyEnd - 1)
  const stmts = parseGoBody(bodyStr)

  // Create context
  const ctx: CodeGenContext = {
    params: sig.params,
    locals: new Map(),
    nextLocalIndex: sig.params.length,
    funcs: funcMap,
    returnType: sig.returnType
  }

  // Generate code for each statement
  const bodyCode: number[] = []
  for (const stmt of stmts) {
    bodyCode.push(...genStmt(stmt, ctx))
  }

  // If function has return type but no explicit return, add return 0
  if (sig.returnType && !stmts.some(s => s.type === 'return')) {
    bodyCode.push(WASM_OPCODES.I32_CONST, 0)
  }

  return {
    body: bodyCode,
    localCount: ctx.nextLocalIndex - sig.params.length
  }
}

/**
 * Generate the function body bytecode by parsing Go code
 */
function generateFunctionBody(
  sig: FunctionSignature,
  funcIndex: number,
  code: string,
  funcMap: Map<string, number>
): number[] {
  const { body: bodyCode, localCount } = parseAndGenerateFunctionBody(sig, code, funcMap)

  // Build complete function body
  const body: number[] = []

  // Local declarations: count of local groups, then (count, type) pairs
  if (localCount > 0) {
    body.push(0x01) // 1 local group
    body.push(...encodeULEB128(localCount), WASM_TYPES.I32) // all i32
  } else {
    body.push(0x00) // no locals
  }

  // Add body code
  body.push(...bodyCode)

  // Add end
  body.push(WASM_OPCODES.END)

  return [...encodeULEB128(body.length), ...body]
}

/**
 * Parse internal (non-exported) Go functions
 */
function parseInternalFunctions(code: string): FunctionSignature[] {
  const funcs: FunctionSignature[] = []

  // Match function declarations that are NOT preceded by go:wasmexport
  const funcRegex = /(?<!\/\/go:wasmexport\s+\w+\s*\n\s*)func\s+(\w+)\s*\(([^)]*)\)\s*(\w+)?\s*\{/g

  let match
  while ((match = funcRegex.exec(code)) !== null) {
    const name = match[1]
    const paramsStr = match[2].trim()
    const returnType = match[3] || null

    // Skip main function
    if (name === 'main') continue

    const params: Array<{ name: string; type: string }> = []
    if (paramsStr) {
      const paramParts = paramsStr.split(',').map(p => p.trim())
      let lastType = ''

      for (let i = paramParts.length - 1; i >= 0; i--) {
        const part = paramParts[i].trim()
        const tokens = part.split(/\s+/)

        if (tokens.length >= 2) {
          lastType = tokens[tokens.length - 1]
          for (let j = 0; j < tokens.length - 1; j++) {
            params.unshift({ name: tokens[j].replace(',', ''), type: lastType })
          }
        } else if (tokens.length === 1 && lastType) {
          params.unshift({ name: tokens[0], type: lastType })
        }
      }
    }

    funcs.push({ name, params, returnType })
  }

  return funcs
}

/**
 * Generate a minimal WASM binary that exports the specified functions
 */
function generateWasm(signatures: FunctionSignature[], code: string): Uint8Array {
  const sections: number[] = []

  // WASM magic number and version
  const header = [...WASM_HEADER]

  // Parse internal functions for call support
  const internalFuncs = parseInternalFunctions(code)

  // All functions: exported first, then internal
  const allFuncs = [...signatures, ...internalFuncs]

  // Create function map for call resolution
  const funcMap = new Map<string, number>()
  for (let i = 0; i < allFuncs.length; i++) {
    funcMap.set(allFuncs[i].name, i)
  }

  // Group signatures by their type (params + return)
  const typeSignatures: Map<string, number> = new Map()
  const funcTypeIndices: number[] = []

  // Type section (section id = 1)
  const types: number[][] = []

  for (const sig of allFuncs) {
    const paramTypes = sig.params.map(p => goTypeToWasmType(p.type))
    const resultTypes = sig.returnType ? [goTypeToWasmType(sig.returnType)] : []

    const typeKey = JSON.stringify({ params: paramTypes, results: resultTypes })

    if (!typeSignatures.has(typeKey)) {
      typeSignatures.set(typeKey, types.length)
      types.push([
        WASM_TYPES.FUNC, // func type
        ...encodeULEB128(paramTypes.length),
        ...paramTypes,
        ...encodeULEB128(resultTypes.length),
        ...resultTypes,
      ])
    }

    funcTypeIndices.push(typeSignatures.get(typeKey)!)
  }

  const typeSection = createSection(WASM_SECTIONS.TYPE, createVector(types))
  sections.push(...typeSection)

  // Function section (section id = 3) - declares function type indices
  const funcSection = createSection(
    WASM_SECTIONS.FUNCTION,
    [...encodeULEB128(allFuncs.length), ...funcTypeIndices.map(i => encodeULEB128(i)).flat()]
  )
  sections.push(...funcSection)

  // Memory section (section id = 5) - required by some WASM runtimes
  const memorySection = createSection(WASM_SECTIONS.MEMORY, [
    0x01, // 1 memory
    0x00,
    0x01, // limits: min 1 page, no max
  ])
  sections.push(...memorySection)

  // Export section (section id = 7)
  const exportEntries: number[][] = []

  // Export each exported function (not internal ones)
  for (let i = 0; i < signatures.length; i++) {
    const name = signatures[i].name
    const nameBytes = Array.from(Buffer.from(name, 'utf8'))
    exportEntries.push([
      ...encodeULEB128(nameBytes.length),
      ...nameBytes,
      0x00, // export kind: function
      ...encodeULEB128(i), // function index
    ])
  }

  // Also export memory
  const memoryName = 'memory'
  const memoryNameBytes = Array.from(Buffer.from(memoryName, 'utf8'))
  exportEntries.push([
    ...encodeULEB128(memoryNameBytes.length),
    ...memoryNameBytes,
    0x02, // export kind: memory
    0x00, // memory index 0
  ])

  const exportSection = createSection(WASM_SECTIONS.EXPORT, createVector(exportEntries))
  sections.push(...exportSection)

  // Code section (section id = 10)
  const codeBodies: number[][] = allFuncs.map((sig, i) => generateFunctionBody(sig, i, code, funcMap))
  const codeSection = createSection(WASM_SECTIONS.CODE, createVector(codeBodies))
  sections.push(...codeSection)

  return new Uint8Array([...header, ...sections])
}

// ============================================================================
// TinyGo Compilation
// ============================================================================

/**
 * Get TinyGo version if available
 */
async function getTinyGoVersion(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('tinygo version')
    const match = stdout.match(/tinygo version ([\d.]+)/)
    return match ? match[1] : stdout.trim()
  } catch (error) {
    // TinyGo version check failed - not installed or not in PATH
    console.warn('TinyGo version check failed:', error instanceof Error ? error.message : String(error))
    return null
  }
}

/**
 * Try to compile using TinyGo if available
 */
async function tryTinyGoCompile(
  code: string,
  options: CompileOptions = {}
): Promise<{ result: CompileResult; version: string } | null> {
  try {
    // Check if tinygo is available
    await execAsync('which tinygo')
    const version = await getTinyGoVersion()

    // Create temporary directory for compilation
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'go-wasm-'))
    const goFile = path.join(tmpDir, 'main.go')
    const wasmFile = path.join(tmpDir, 'output.wasm')

    try {
      // Write Go source to file
      await fs.writeFile(goFile, code)

      // Build compilation flags
      const optLevel = options.optimizationLevel ?? 's'
      const debugFlag = options.debug ? '' : '-no-debug'
      const flags = [
        '-o', wasmFile,
        '-target=wasi',
        debugFlag,
        `-opt=${optLevel}`,
        // Size optimizations for 100KB-2MB target
        '-gc=leaking',      // Simpler GC for smaller output
        '-scheduler=none',  // No scheduler for smaller output
      ].filter(Boolean).join(' ')

      // Compile with TinyGo
      await execAsync(
        `tinygo build ${flags} ${goFile}`,
        { timeout: 60000 }
      )

      // Read the compiled WASM
      const wasmBuffer = await fs.readFile(wasmFile)
      const wasm = new Uint8Array(wasmBuffer)

      // Parse exports from Go code
      const signatures = parseGoExports(code)
      const exports = signatures.map(s => s.name)

      // Generate TypeScript types if requested
      const typescriptTypes = options.generateTypes
        ? generateTypeScriptTypes(signatures)
        : undefined

      // Generate capnweb bindings if requested
      const capnwebBindings = options.generateBindings
        ? generateCapnwebBindings(signatures)
        : undefined

      // Check target size
      if (options.targetSize && wasm.length > options.targetSize) {
        console.warn(
          `Warning: WASM size (${wasm.length} bytes) exceeds target (${options.targetSize} bytes)`
        )
      }

      const result: CompileResult = {
        wasm,
        exports,
        typescriptTypes,
        capnwebBindings,
        metadata: {
          wasmSize: wasm.length,
          compiledAt: new Date().toISOString(),
          usedTinyGo: true,
          tinyGoVersion: version ?? undefined,
          optimizationLevel: optLevel,
        },
      }

      return { result, version: version ?? 'unknown' }
    } finally {
      // Cleanup temporary files
      await fs.rm(tmpDir, { recursive: true, force: true }).catch((err) => {
        console.warn('Cleanup failed:', err.message)
      })
    }
  } catch (error) {
    // TinyGo not available or compilation failed
    console.warn('TinyGo compilation failed:', error instanceof Error ? error.message : String(error))
    return null
  }
}

// ============================================================================
// Go Syntax Validation
// ============================================================================

/**
 * Validate Go code for syntax errors
 */
function validateGoCode(code: string): void {
  const trimmed = code.trim()

  // Empty input
  if (!trimmed) {
    throw new Error('Empty Go code provided')
  }

  // Check for package declaration
  if (!trimmed.includes('package ')) {
    throw new Error('Missing package declaration in Go code')
  }

  // Check for missing closing braces
  const openBraces = (trimmed.match(/\{/g) || []).length
  const closeBraces = (trimmed.match(/\}/g) || []).length
  if (openBraces !== closeBraces) {
    throw new Error('Mismatched braces in Go code')
  }

  // Check for mismatched parentheses
  const openParens = (trimmed.match(/\(/g) || []).length
  const closeParens = (trimmed.match(/\)/g) || []).length
  if (openParens !== closeParens) {
    throw new Error('Mismatched parentheses in Go code')
  }

  // Check for incomplete expressions (e.g., "return 42 +")
  const incompleteExpr = /return\s+[^}]+[\+\-\*\/\%]\s*$/m
  if (incompleteExpr.test(trimmed)) {
    throw new Error('Incomplete expression in return statement')
  }

  // Check for invalid Go keywords as function names
  const invalidFuncName = /\/\/go:wasmexport\s+(func|return|if|else|for|switch|case|default|break|continue|goto|fallthrough|defer|go|chan|map|struct|interface|type|const|var|package|import)\s*\n/
  if (invalidFuncName.test(trimmed)) {
    throw new Error('Invalid function name: Go keyword used as export name')
  }

  // Check for type mismatches (string where int expected)
  const stringInIntFunc = /func\s+\w+\s*\([^)]*\)\s*int32\s*\{\s*return\s+"[^"]*"\s*\}/
  if (stringInIntFunc.test(trimmed)) {
    throw new Error('Type mismatch: cannot return string for int32 function')
  }

  // Check for undefined variables (simple heuristic)
  const funcBodies = trimmed.matchAll(/func\s+\w+\s*\(([^)]*)\)\s*\w*\s*\{([\s\S]*?)\n\}/g)
  for (const match of funcBodies) {
    const paramsStr = match[1]
    const body = match[2]

    // Extract param names
    const params = new Set<string>()
    if (paramsStr) {
      const parts = paramsStr.split(',')
      for (const part of parts) {
        const tokens = part.trim().split(/\s+/)
        if (tokens.length >= 1) {
          params.add(tokens[0])
        }
      }
    }

    // Extract declared variables
    const declMatches = body.matchAll(/(\w+)\s*:=/g)
    for (const declMatch of declMatches) {
      params.add(declMatch[1])
    }

    // Handle var declarations including multi-variable: var a, b int32 = ...
    const varMatches = body.matchAll(/var\s+(\w+(?:\s*,\s*\w+)*)\s+\w+/g)
    for (const varMatch of varMatches) {
      const varNames = varMatch[1].split(',').map(v => v.trim())
      for (const varName of varNames) {
        params.add(varName)
      }
    }

    // Check for undefined variables in return statement
    const returnMatch = body.match(/return\s+(\w+)\s*$/)
    if (returnMatch) {
      const retVar = returnMatch[1]
      // Skip if it's a number
      if (!/^\d+$/.test(retVar) && !params.has(retVar) && retVar !== 'true' && retVar !== 'false') {
        throw new Error(`Undefined variable: ${retVar}`)
      }
    }
  }

  // Check for undefined import packages
  const importMatch = trimmed.match(/import\s+"([^"]+)"/)
  if (importMatch) {
    const pkg = importMatch[1]
    // List of allowed packages for WASM (very limited in TinyGo)
    const allowedPkgs = ['unsafe', 'runtime', 'math', 'math/bits']
    if (!allowedPkgs.some(allowed => pkg === allowed || pkg.startsWith(allowed + '/'))) {
      throw new Error(`Unsupported import package for WASM: ${pkg}`)
    }
  }
}

// ============================================================================
// Main Compile Function
// ============================================================================

/**
 * Compile Go code to WebAssembly
 *
 * @param code - Go source code with go:wasmexport directives
 * @param options - Compilation options
 * @returns Promise containing the compiled WASM binary, export names, and generated types
 */
export async function compileGo(
  code: string,
  options: CompileOptions = {}
): Promise<CompileResult> {
  // Validate Go code first
  validateGoCode(code)

  // First, try to use TinyGo if available
  const tinyGoResult = await tryTinyGoCompile(code, options)
  if (tinyGoResult) {
    return tinyGoResult.result
  }

  // Fall back to programmatic WASM generation
  const signatures = parseGoExports(code)

  if (signatures.length === 0) {
    throw new Error('No go:wasmexport directives found in Go code')
  }

  const wasm = generateWasm(signatures, code)
  const exports = signatures.map(s => s.name)

  // Generate TypeScript types if requested
  const typescriptTypes = options.generateTypes
    ? generateTypeScriptTypes(signatures)
    : undefined

  // Generate capnweb bindings if requested
  const capnwebBindings = options.generateBindings
    ? generateCapnwebBindings(signatures)
    : undefined

  return {
    wasm,
    exports,
    typescriptTypes,
    capnwebBindings,
    metadata: {
      wasmSize: wasm.length,
      compiledAt: new Date().toISOString(),
      usedTinyGo: false,
    },
  }
}

// ============================================================================
// SDK Template Generation
// ============================================================================

/**
 * SDK template file contents
 */
export interface SDKTemplateFiles {
  'go.mod': string
  'main.go': string
  'Makefile': string
  'README.md': string
  'types.d.ts'?: string
  'bindings.ts'?: string
}

/**
 * Generate SDK template files for a Go function
 */
export function generateSDKTemplate(
  moduleName: string,
  signatures: FunctionSignature[]
): SDKTemplateFiles {
  const goMod = generateGoMod(moduleName)
  const mainGo = generateMainGo(moduleName, signatures)
  const makefile = generateMakefile(moduleName)
  const readme = generateReadme(moduleName, signatures)
  const typesDts = generateTypeScriptTypes(signatures, capitalize(moduleName))
  const bindingsTs = generateCapnwebBindings(signatures, capitalize(moduleName))

  return {
    'go.mod': goMod,
    'main.go': mainGo,
    'Makefile': makefile,
    'README.md': readme,
    'types.d.ts': typesDts,
    'bindings.ts': bindingsTs,
  }
}

/**
 * Generate go.mod file content
 */
function generateGoMod(moduleName: string): string {
  return `module functions-do/${moduleName}

go 1.21

// No external dependencies for minimal WASM size
`
}

/**
 * Generate main.go file content with capnweb integration
 */
function generateMainGo(moduleName: string, signatures: FunctionSignature[]): string {
  const lines: string[] = [
    '// Package main provides WASM-exported functions for Functions.do',
    '//',
    `// Module: ${moduleName}`,
    '// Generated by Functions.do SDK',
    '//',
    '// Build with: make build',
    '// Target size: 100KB - 2MB',
    'package main',
    '',
    '// Import is required for WASM build even if unused',
    'import _ "unsafe"',
    '',
  ]

  // Generate exported functions
  for (const sig of signatures) {
    if (sig.doc) {
      lines.push(sig.doc)
    }
    lines.push(generateWasmExportDirective(sig.name))

    const params = sig.params.map(p => `${p.name} ${p.type}`).join(', ')
    const returnType = sig.returnType ? ` ${sig.returnType}` : ''

    lines.push(`func ${sig.name}Impl(${params})${returnType} {`)
    lines.push('\t// TODO: Implement function logic')
    if (sig.returnType) {
      lines.push(`\treturn ${getGoDefaultValue(sig.returnType)}`)
    }
    lines.push('}')
    lines.push('')
  }

  // Add main function (required for WASM)
  lines.push('// main is required but not used in WASM builds')
  lines.push('func main() {}')

  return lines.join('\n')
}

/**
 * Generate Makefile for TinyGo compilation
 */
function generateMakefile(moduleName: string): string {
  return `# Makefile for ${moduleName} WASM module
# Target output size: 100KB - 2MB

# TinyGo settings for minimal binary size
TINYGO = tinygo
TARGET = wasi
OPT_LEVEL = s
EXTRA_FLAGS = -no-debug -gc=leaking -scheduler=none

# Output files
OUT_DIR = dist
WASM_FILE = $(OUT_DIR)/${moduleName}.wasm
WASM_OPT_FILE = $(OUT_DIR)/${moduleName}.opt.wasm

# Source files
SRC = main.go

.PHONY: all build clean size check-tinygo optimize

all: build

check-tinygo:
\t@which $(TINYGO) > /dev/null || (echo "TinyGo not found. Install from https://tinygo.org" && exit 1)

build: check-tinygo
\t@mkdir -p $(OUT_DIR)
\t$(TINYGO) build \\
\t\t-o $(WASM_FILE) \\
\t\t-target=$(TARGET) \\
\t\t-opt=$(OPT_LEVEL) \\
\t\t$(EXTRA_FLAGS) \\
\t\t$(SRC)
\t@echo "Built: $(WASM_FILE)"
\t@make size

# Further optimize with wasm-opt if available
optimize: build
\t@which wasm-opt > /dev/null && \\
\t\twasm-opt -Os --strip-debug -o $(WASM_OPT_FILE) $(WASM_FILE) && \\
\t\techo "Optimized: $(WASM_OPT_FILE)" && \\
\t\tls -lh $(WASM_OPT_FILE) || \\
\t\techo "wasm-opt not found, skipping optimization"

size:
\t@echo "WASM binary size:"
\t@ls -lh $(WASM_FILE) | awk '{print $$5, $$9}'
\t@SIZE=$$(stat -f%z $(WASM_FILE) 2>/dev/null || stat -c%s $(WASM_FILE) 2>/dev/null); \\
\t\tif [ $$SIZE -lt 102400 ]; then \\
\t\t\techo "Size: $$SIZE bytes (under 100KB target - excellent!)"; \\
\t\telif [ $$SIZE -lt 2097152 ]; then \\
\t\t\techo "Size: $$SIZE bytes (within 100KB-2MB target)"; \\
\t\telse \\
\t\t\techo "WARNING: Size $$SIZE bytes exceeds 2MB target!"; \\
\t\tfi

clean:
\trm -rf $(OUT_DIR)

# Development helpers
.PHONY: watch test

watch:
\t@echo "Watching for changes..."
\t@while true; do \\
\t\tinotifywait -qq -e modify $(SRC) 2>/dev/null || fswatch -1 $(SRC) 2>/dev/null; \\
\t\tmake build; \\
\tdone

test: build
\t@echo "Testing WASM module..."
\t@node -e "const fs=require('fs');const wasm=fs.readFileSync('$(WASM_FILE)');WebAssembly.instantiate(wasm).then(m=>console.log('Exports:',Object.keys(m.instance.exports)))"
`
}

/**
 * Generate README.md with usage instructions
 */
function generateReadme(moduleName: string, signatures: FunctionSignature[]): string {
  const funcList = signatures.map(s => {
    const params = s.params.map(p => `${p.name}: ${p.type}`).join(', ')
    const ret = s.returnType ? ` -> ${s.returnType}` : ''
    return `- \`${s.name}(${params})${ret}\``
  }).join('\n')

  return `# ${moduleName}

Go WASM module for Functions.do platform.

## Exported Functions

${funcList}

## Prerequisites

- [TinyGo](https://tinygo.org/getting-started/install/) 0.30+
- (Optional) [wasm-opt](https://github.com/WebAssembly/binaryen) for further optimization

## Build

\`\`\`bash
# Build WASM module
make build

# Build with optimization (requires wasm-opt)
make optimize

# Check binary size
make size

# Clean build artifacts
make clean
\`\`\`

## Target Size

This module targets 100KB - 2MB output size for optimal performance on Cloudflare Workers.

The Makefile uses the following TinyGo flags for size optimization:
- \`-opt=s\` - Optimize for size
- \`-no-debug\` - Strip debug symbols
- \`-gc=leaking\` - Use simpler garbage collector
- \`-scheduler=none\` - Disable scheduler

## Usage in TypeScript

\`\`\`typescript
import { create${capitalize(moduleName)}Target } from './bindings'
import wasmBytes from './${moduleName}.wasm'

const target = await create${capitalize(moduleName)}Target(wasmBytes)

// Call exported functions
${signatures.length > 0 ? `const result = target.${signatures[0].name}(${signatures[0].params.map(() => '0').join(', ')})` : '// No functions exported'}
\`\`\`

## go:wasmexport Directive

Functions are exported using the \`//go:wasmexport\` directive:

\`\`\`go
//go:wasmexport functionName
func functionNameImpl(params...) returnType {
    // implementation
}
\`\`\`

## License

MIT
`
}
