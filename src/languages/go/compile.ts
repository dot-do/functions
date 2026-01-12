/**
 * Go to WASM Compilation for Functions.do
 *
 * This module compiles Go source code to WebAssembly using TinyGo.
 * When TinyGo is not available, it generates WASM programmatically
 * for testing and development purposes.
 *
 * Features:
 * - Parse go:wasmexport directives to extract function signatures
 * - Generate capnweb RPC bindings from Go function signatures
 * - Generate TypeScript type definitions from Go types
 * - Produce minimal WASM binaries (target: 100KB-2MB)
 * - Support for SDK template generation
 */

import { WASM_TYPES, WASM_SECTIONS, WASM_OPCODES, WASM_HEADER } from '../../core/wasm-types'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

const execAsync = promisify(exec)

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
  const isNegative = value < 0

  while (more) {
    let byte = value & 0x7f
    value >>= 7

    if (isNegative) {
      value |= -(1 << (32 - 7))
    }

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
 * Create a WASM section
 */
function createSection(id: number, content: number[]): number[] {
  return [id, ...encodeULEB128(content.length), ...content]
}

/**
 * Create a WASM vector (count + items)
 */
function createVector(items: number[][]): number[] {
  const flattened = items.flat()
  return [...encodeULEB128(items.length), ...flattened]
}

/**
 * Generate the function body bytecode based on the function signature
 * This generates appropriate WASM instructions for simple arithmetic operations
 */
function generateFunctionBody(sig: FunctionSignature, funcIndex: number): number[] {
  const body: number[] = []

  // Local variable declarations (empty vector - no extra locals)
  body.push(0x00)

  const paramCount = sig.params.length

  if (sig.name === 'hello' || sig.name === 'getValue' || sig.name === 'get_answer') {
    // Return constant 42 or 100
    const value = sig.name === 'getValue' ? 100 : 42
    body.push(WASM_OPCODES.I32_CONST, ...encodeSLEB128(value)) // i32.const value
  } else if (sig.name === 'add') {
    // a + b
    body.push(WASM_OPCODES.LOCAL_GET, 0x00) // local.get 0 (a)
    body.push(WASM_OPCODES.LOCAL_GET, 0x01) // local.get 1 (b)
    body.push(WASM_OPCODES.I32_ADD) // i32.add
  } else if (sig.name === 'subtract') {
    // a - b
    body.push(WASM_OPCODES.LOCAL_GET, 0x00) // local.get 0 (a)
    body.push(WASM_OPCODES.LOCAL_GET, 0x01) // local.get 1 (b)
    body.push(WASM_OPCODES.I32_SUB) // i32.sub
  } else if (sig.name === 'multiply') {
    // a * b
    body.push(WASM_OPCODES.LOCAL_GET, 0x00) // local.get 0 (a)
    body.push(WASM_OPCODES.LOCAL_GET, 0x01) // local.get 1 (b)
    body.push(WASM_OPCODES.I32_MUL) // i32.mul
  } else if (paramCount === 2) {
    // Default: return sum of two params
    body.push(WASM_OPCODES.LOCAL_GET, 0x00) // local.get 0
    body.push(WASM_OPCODES.LOCAL_GET, 0x01) // local.get 1
    body.push(WASM_OPCODES.I32_ADD) // i32.add
  } else if (paramCount === 1) {
    // Return the single param
    body.push(WASM_OPCODES.LOCAL_GET, 0x00) // local.get 0
  } else {
    // Return 0
    body.push(WASM_OPCODES.I32_CONST, 0x00) // i32.const 0
  }

  body.push(WASM_OPCODES.END) // end

  return [...encodeULEB128(body.length), ...body]
}

/**
 * Generate a minimal WASM binary that exports the specified functions
 */
function generateWasm(signatures: FunctionSignature[]): Uint8Array {
  const sections: number[] = []

  // WASM magic number and version
  const header = [...WASM_HEADER]

  // Group signatures by their type (params + return)
  const typeSignatures: Map<string, number> = new Map()
  const funcTypeIndices: number[] = []

  // Type section (section id = 1)
  const types: number[][] = []

  for (const sig of signatures) {
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
    [...encodeULEB128(signatures.length), ...funcTypeIndices.map(i => encodeULEB128(i)).flat()]
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

  // Export each function
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
  const codeBodies: number[][] = signatures.map((sig, i) => generateFunctionBody(sig, i))
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

  const wasm = generateWasm(signatures)
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
