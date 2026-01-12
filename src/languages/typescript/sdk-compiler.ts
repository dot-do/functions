/**
 * TypeScript SDK Compiler Utilities
 *
 * Provides reusable patterns for the dot-do-capnweb SDK template:
 * - TypeScript type definition generation
 * - capnweb RpcTarget bindings generation
 * - ESM bundle production
 * - API documentation generation from JSDoc
 */

import * as esbuild from 'esbuild'
import { writeFile, mkdir, rm, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, dirname } from 'path'

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a function parameter with its type information
 */
export interface FunctionParameter {
  /** Parameter name */
  name: string
  /** TypeScript type annotation */
  type: string
  /** Whether the parameter is optional */
  optional: boolean
  /** JSDoc description for this parameter */
  description?: string
  /** Default value if any */
  defaultValue?: string
}

/**
 * Represents a function signature extracted from source code
 */
export interface FunctionSignature {
  /** Function name */
  name: string
  /** Function parameters */
  params: FunctionParameter[]
  /** Return type */
  returnType: string
  /** Whether the function is async */
  isAsync: boolean
  /** JSDoc description */
  description?: string
  /** JSDoc tags (param, returns, example, etc.) */
  jsdocTags?: JsDocTag[]
  /** Whether this is a method on a class */
  isMethod?: boolean
  /** Parent class name if this is a method */
  className?: string
}

/**
 * JSDoc tag parsed from comments
 */
export interface JsDocTag {
  /** Tag name (param, returns, example, etc.) */
  tag: string
  /** Tag name/identifier (for @param tags) */
  name?: string
  /** Tag type (for @param and @returns tags) */
  type?: string
  /** Tag description */
  description?: string
}

/**
 * Result of type definition generation
 */
export interface TypeDefinitionResult {
  /** Generated .d.ts content */
  dts: string
  /** Extracted function signatures */
  signatures: FunctionSignature[]
  /** Any errors encountered */
  errors?: Array<{ message: string }>
}

/**
 * Result of capnweb bindings generation
 */
export interface RpcBindingsResult {
  /** Generated RpcTarget class code */
  code: string
  /** Generated type definitions for the bindings */
  dts: string
  /** Errors encountered */
  errors?: Array<{ message: string }>
}

/**
 * Configuration for ESM bundle production
 */
export interface BundleConfig {
  /** Entry point file path */
  entryPoint: string
  /** Output file path */
  outFile: string
  /** Whether to minify the output */
  minify?: boolean
  /** External packages to exclude from bundling */
  external?: string[]
  /** Whether to generate source maps */
  sourcemap?: boolean
  /** Additional esbuild options */
  esbuildOptions?: Partial<esbuild.BuildOptions>
}

/**
 * Result of ESM bundle production
 */
export interface BundleResult {
  /** Path to the generated bundle */
  outputPath: string
  /** Bundle size in bytes */
  size: number
  /** Source map path if generated */
  sourceMapPath?: string
  /** Errors encountered */
  errors?: Array<{ message: string }>
}

/**
 * API documentation entry
 */
export interface ApiDocEntry {
  /** Function/method name */
  name: string
  /** Function signature string */
  signature: string
  /** Description from JSDoc */
  description?: string
  /** Parameters documentation */
  params: Array<{
    name: string
    type: string
    description?: string
    optional: boolean
  }>
  /** Return type and description */
  returns?: {
    type: string
    description?: string
  }
  /** Example code snippets */
  examples?: string[]
  /** Whether this is deprecated */
  deprecated?: string
  /** Since version */
  since?: string
}

/**
 * Generated API documentation
 */
export interface ApiDocumentation {
  /** Module/package name */
  name: string
  /** Module description */
  description?: string
  /** Version */
  version?: string
  /** API entries */
  entries: ApiDocEntry[]
}

/**
 * Represents a TypeScript interface or type extracted from source
 */
export interface ExtractedType {
  /** Type name */
  name: string
  /** Whether this is an interface or type alias */
  kind: 'interface' | 'type'
  /** Type parameters (generics) */
  typeParameters?: string[]
  /** Properties for interface types */
  properties?: Array<{
    name: string
    type: string
    optional: boolean
    description?: string
  }>
  /** Type definition for type aliases */
  definition?: string
  /** JSDoc description */
  description?: string
  /** Whether this is exported */
  exported: boolean
}

/**
 * Configuration for RpcStub generation
 */
export interface RpcStubConfig {
  /** Name for the generated stub class */
  className: string
  /** Import path for RpcTarget */
  rpcTargetImport?: string
  /** Service binding name */
  serviceBindingName?: string
  /** Include validation helpers */
  includeValidation?: boolean
  /** Include retry logic */
  includeRetry?: boolean
  /** Include caching helpers */
  includeCaching?: boolean
}

/**
 * Result of RpcStub generation
 */
export interface RpcStubResult {
  /** Generated stub client code */
  clientCode: string
  /** Generated type definitions */
  dts: string
  /** Errors encountered */
  errors?: Array<{ message: string }>
}

// ============================================================================
// Type Definition Generation
// ============================================================================

/**
 * Extract function signatures from TypeScript source code.
 *
 * Parses function declarations, arrow functions, and method definitions
 * to extract their signatures including JSDoc comments.
 *
 * @param code - TypeScript source code
 * @returns Extracted function signatures
 *
 * @example
 * ```typescript
 * const signatures = extractFunctionSignatures(`
 *   /**
 *    * Greets a user
 *    * @param name - The user's name
 *    * @returns A greeting message
 *    *\/
 *   export function greet(name: string): string {
 *     return \`Hello, \${name}!\`;
 *   }
 * `);
 * ```
 */
export function extractFunctionSignatures(code: string): FunctionSignature[] {
  const signatures: FunctionSignature[] = []

  // Pattern for JSDoc comments
  const jsdocPattern = /\/\*\*\s*([\s\S]*?)\s*\*\//g

  // Pattern for function declarations
  const functionPattern =
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/g

  // Pattern for arrow functions with export (handles both single-line and block body)
  const arrowPattern =
    /(?:export\s+)?(?:const|let)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?\(([^)]*)\)\s*(?::\s*([^=>{]+))?\s*=>/g

  // Pattern for class methods
  const methodPattern = /(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/g

  // Extract JSDoc comments and their positions
  const jsdocComments: Array<{ end: number; content: string }> = []
  let jsdocMatch
  while ((jsdocMatch = jsdocPattern.exec(code)) !== null) {
    jsdocComments.push({
      end: jsdocMatch.index + jsdocMatch[0].length,
      content: jsdocMatch[1],
    })
  }

  // Find the JSDoc comment immediately before a position
  const findJsDoc = (pos: number): string | undefined => {
    for (const comment of jsdocComments) {
      // JSDoc should be within 50 characters before the function
      if (pos > comment.end && pos - comment.end < 50) {
        return comment.content
      }
    }
    return undefined
  }

  // Extract regular function declarations
  let match
  while ((match = functionPattern.exec(code)) !== null) {
    const [fullMatch, name, paramsStr, returnType] = match
    const isAsync = fullMatch.includes('async')
    const jsdoc = findJsDoc(match.index)

    signatures.push({
      name,
      params: parseParameters(paramsStr),
      returnType: returnType?.trim() || (isAsync ? 'Promise<void>' : 'void'),
      isAsync,
      description: extractDescription(jsdoc),
      jsdocTags: extractJsDocTags(jsdoc),
    })
  }

  // Extract arrow functions
  while ((match = arrowPattern.exec(code)) !== null) {
    const [fullMatch, name, asyncKeyword, paramsStr, returnType] = match
    const isAsync = !!asyncKeyword
    const jsdoc = findJsDoc(match.index)

    signatures.push({
      name,
      params: parseParameters(paramsStr),
      returnType: returnType?.trim() || (isAsync ? 'Promise<void>' : 'void'),
      isAsync,
      description: extractDescription(jsdoc),
      jsdocTags: extractJsDocTags(jsdoc),
    })
  }

  return signatures
}

/**
 * Parse function parameters from a parameter string.
 *
 * @param paramsStr - The parameter string (e.g., "name: string, age?: number")
 * @returns Array of parsed parameters
 */
function parseParameters(paramsStr: string): FunctionParameter[] {
  if (!paramsStr.trim()) return []

  const params: FunctionParameter[] = []
  let depth = 0
  let current = ''

  // Split by comma, but respect nested types
  for (const char of paramsStr) {
    if (char === '<' || char === '(' || char === '{' || char === '[') depth++
    if (char === '>' || char === ')' || char === '}' || char === ']') depth--

    if (char === ',' && depth === 0) {
      if (current.trim()) {
        params.push(parseParameter(current.trim()))
      }
      current = ''
    } else {
      current += char
    }
  }

  if (current.trim()) {
    params.push(parseParameter(current.trim()))
  }

  return params
}

/**
 * Parse a single parameter string.
 *
 * @param param - A single parameter (e.g., "name: string" or "age?: number = 0")
 * @returns Parsed parameter info
 */
function parseParameter(param: string): FunctionParameter {
  // Handle destructuring patterns
  if (param.startsWith('{') || param.startsWith('[')) {
    const colonIndex = findTypeColon(param)
    if (colonIndex !== -1) {
      return {
        name: param.slice(0, colonIndex).trim(),
        type: param.slice(colonIndex + 1).trim(),
        optional: false,
      }
    }
    return { name: param, type: 'any', optional: false }
  }

  // Handle regular parameters: name?: Type = defaultValue
  const optionalMatch = param.match(/^(\w+)\?\s*:\s*(.+)$/)
  if (optionalMatch) {
    const [, name, typeAndDefault] = optionalMatch
    const [type, defaultValue] = splitTypeAndDefault(typeAndDefault)
    return { name, type, optional: true, defaultValue }
  }

  const requiredMatch = param.match(/^(\w+)\s*:\s*(.+)$/)
  if (requiredMatch) {
    const [, name, typeAndDefault] = requiredMatch
    const [type, defaultValue] = splitTypeAndDefault(typeAndDefault)
    return { name, type, optional: !!defaultValue, defaultValue }
  }

  // Just a name with no type
  return { name: param, type: 'any', optional: false }
}

/**
 * Find the colon that separates the name from the type (for destructured params).
 */
function findTypeColon(param: string): number {
  let depth = 0
  for (let i = 0; i < param.length; i++) {
    const char = param[i]
    if (char === '{' || char === '[') depth++
    if (char === '}' || char === ']') depth--
    if (char === ':' && depth === 0) return i
  }
  return -1
}

/**
 * Split a type annotation from a default value.
 */
function splitTypeAndDefault(typeAndDefault: string): [string, string | undefined] {
  // Look for = that's not inside a type
  let depth = 0
  for (let i = 0; i < typeAndDefault.length; i++) {
    const char = typeAndDefault[i]
    if (char === '<' || char === '(' || char === '{' || char === '[') depth++
    if (char === '>' || char === ')' || char === '}' || char === ']') depth--
    if (char === '=' && depth === 0) {
      return [typeAndDefault.slice(0, i).trim(), typeAndDefault.slice(i + 1).trim()]
    }
  }
  return [typeAndDefault.trim(), undefined]
}

/**
 * Extract the main description from a JSDoc comment.
 */
function extractDescription(jsdoc: string | undefined): string | undefined {
  if (!jsdoc) return undefined

  const lines = jsdoc.split('\n').map((line) => line.replace(/^\s*\*\s?/, '').trim())

  // Collect lines until we hit a tag
  const descLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('@')) break
    if (line) descLines.push(line)
  }

  return descLines.join(' ').trim() || undefined
}

/**
 * Extract JSDoc tags from a comment.
 */
function extractJsDocTags(jsdoc: string | undefined): JsDocTag[] | undefined {
  if (!jsdoc) return undefined

  const tags: JsDocTag[] = []
  const tagPattern = /@(\w+)(?:\s+\{([^}]+)\})?\s*(?:(\w+)\s*-?\s*)?([\s\S]*?)(?=@\w+|$)/g

  let match
  while ((match = tagPattern.exec(jsdoc)) !== null) {
    const [, tag, type, name, description] = match
    tags.push({
      tag,
      type: type?.trim(),
      name: name?.trim(),
      description: description?.trim().replace(/\s*\*\s*/g, ' ').trim() || undefined,
    })
  }

  return tags.length > 0 ? tags : undefined
}

/**
 * Generate TypeScript type definitions (.d.ts) from function signatures.
 *
 * @param signatures - Function signatures to generate types for
 * @param moduleName - Name of the module
 * @returns Generated .d.ts content
 *
 * @example
 * ```typescript
 * const dts = generateTypeDefinitions(signatures, 'my-functions');
 * // Output: declare module 'my-functions' { ... }
 * ```
 */
export function generateTypeDefinitions(signatures: FunctionSignature[], moduleName: string): string {
  const lines: string[] = ['/**', ' * Auto-generated type definitions', ' * @module ' + moduleName, ' */', '']

  lines.push(`declare module '${moduleName}' {`)

  for (const sig of signatures) {
    // Add JSDoc comment
    if (sig.description || sig.jsdocTags) {
      lines.push('  /**')
      if (sig.description) {
        lines.push(`   * ${sig.description}`)
      }
      if (sig.jsdocTags) {
        for (const tag of sig.jsdocTags) {
          if (tag.tag === 'param' && tag.name) {
            lines.push(`   * @param ${tag.name}${tag.type ? ` {${tag.type}}` : ''} ${tag.description || ''}`.trimEnd())
          } else if (tag.tag === 'returns' || tag.tag === 'return') {
            lines.push(`   * @returns${tag.type ? ` {${tag.type}}` : ''} ${tag.description || ''}`.trimEnd())
          } else if (tag.tag === 'example') {
            lines.push(`   * @example`)
            if (tag.description) {
              lines.push(`   * ${tag.description}`)
            }
          }
        }
      }
      lines.push('   */')
    }

    // Generate function signature
    const paramsStr = sig.params
      .map((p) => {
        const opt = p.optional ? '?' : ''
        return `${p.name}${opt}: ${p.type}`
      })
      .join(', ')

    const asyncPrefix = sig.isAsync ? 'async ' : ''
    lines.push(`  export ${asyncPrefix}function ${sig.name}(${paramsStr}): ${sig.returnType};`)
    lines.push('')
  }

  lines.push('}')

  return lines.join('\n')
}

/**
 * Generate type definitions from TypeScript source code.
 *
 * @param code - TypeScript source code
 * @param moduleName - Name of the module
 * @returns Type definition result with .d.ts content and extracted signatures
 */
export async function generateTypesFromSource(code: string, moduleName: string): Promise<TypeDefinitionResult> {
  try {
    const signatures = extractFunctionSignatures(code)
    const dts = generateTypeDefinitions(signatures, moduleName)

    return { dts, signatures }
  } catch (error) {
    return {
      dts: '',
      signatures: [],
      errors: [{ message: error instanceof Error ? error.message : String(error) }],
    }
  }
}

// ============================================================================
// capnweb RpcTarget Bindings Generation
// ============================================================================

/**
 * Generate capnweb RpcTarget bindings from function signatures.
 *
 * Creates a class that extends RpcTarget and exposes the functions
 * as RPC-callable methods.
 *
 * @param signatures - Function signatures to generate bindings for
 * @param className - Name of the generated class
 * @param options - Generation options
 * @returns Generated RpcTarget class code
 *
 * @example
 * ```typescript
 * const bindings = generateRpcBindings(signatures, 'MyFunctionTarget');
 * // Creates: class MyFunctionTarget extends RpcTarget { ... }
 * ```
 */
export function generateRpcBindings(
  signatures: FunctionSignature[],
  className: string,
  options: {
    /** Import path for RpcTarget */
    rpcTargetImport?: string
    /** Whether to include tracing */
    includeTracing?: boolean
    /** Whether to include metrics */
    includeMetrics?: boolean
  } = {}
): RpcBindingsResult {
  const { rpcTargetImport = 'capnweb', includeTracing = true, includeMetrics = true } = options

  const lines: string[] = [
    '/**',
    ` * Auto-generated capnweb RpcTarget bindings for ${className}`,
    ' *',
    ' * This class wraps function implementations as RPC-callable methods.',
    ' */',
    '',
    `import { RpcTarget } from '${rpcTargetImport}';`,
    '',
  ]

  // Generate interface for the function implementations
  lines.push(`/**`)
  lines.push(` * Interface for ${className} function implementations`)
  lines.push(` */`)
  lines.push(`export interface ${className}Functions {`)

  for (const sig of signatures) {
    const paramsStr = sig.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
    lines.push(`  ${sig.name}(${paramsStr}): ${sig.returnType};`)
  }

  lines.push('}')
  lines.push('')

  // Generate the RpcTarget class
  lines.push('/**')
  lines.push(` * RpcTarget implementation for ${className}`)
  lines.push(' *')
  lines.push(' * Wraps function implementations as RPC-callable methods with:')
  if (includeTracing) lines.push(' * - Distributed tracing support')
  if (includeMetrics) lines.push(' * - Performance metrics collection')
  lines.push(' * - Type-safe method invocation')
  lines.push(' */')
  lines.push(`export class ${className} extends RpcTarget {`)
  lines.push(`  private _functions: ${className}Functions;`)

  if (includeTracing) {
    lines.push(`  private _traceId?: string;`)
  }

  if (includeMetrics) {
    lines.push(`  private _requestCount: number = 0;`)
    lines.push(`  private _errorCount: number = 0;`)
  }

  lines.push('')
  lines.push(`  constructor(functions: ${className}Functions) {`)
  lines.push('    super();')
  lines.push('    this._functions = functions;')
  lines.push('  }')
  lines.push('')

  // Generate method wrappers
  for (const sig of signatures) {
    const paramsStr = sig.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
    const argsStr = sig.params.map((p) => p.name).join(', ')

    // Add JSDoc
    if (sig.description) {
      lines.push('  /**')
      lines.push(`   * ${sig.description}`)
      if (sig.jsdocTags) {
        for (const tag of sig.jsdocTags) {
          if (tag.tag === 'param' && tag.name) {
            lines.push(`   * @param ${tag.name} ${tag.description || ''}`.trimEnd())
          } else if (tag.tag === 'returns' || tag.tag === 'return') {
            lines.push(`   * @returns ${tag.description || ''}`.trimEnd())
          }
        }
      }
      lines.push('   */')
    }

    // Generate method
    const asyncKeyword = sig.isAsync ? 'async ' : ''
    lines.push(`  ${asyncKeyword}${sig.name}(${paramsStr}): ${sig.returnType} {`)

    if (includeMetrics) {
      lines.push('    this._requestCount++;')
    }

    if (includeTracing) {
      lines.push(`    const startTime = performance.now();`)
    }

    lines.push('    try {')

    if (sig.isAsync) {
      lines.push(`      return await this._functions.${sig.name}(${argsStr});`)
    } else {
      lines.push(`      return this._functions.${sig.name}(${argsStr});`)
    }

    lines.push('    } catch (error) {')
    if (includeMetrics) {
      lines.push('      this._errorCount++;')
    }
    lines.push('      throw error;')
    lines.push('    }')

    if (includeTracing) {
      lines.push('    finally {')
      lines.push(`      const duration = performance.now() - startTime;`)
      lines.push(`      // Tracing: method=${sig.name}, duration=\${duration}ms`)
      lines.push('    }')
    }

    lines.push('  }')
    lines.push('')
  }

  // Add metrics getter if enabled
  if (includeMetrics) {
    lines.push('  /**')
    lines.push('   * Get current metrics for this RpcTarget')
    lines.push('   */')
    lines.push('  getMetrics(): { requestCount: number; errorCount: number } {')
    lines.push('    return {')
    lines.push('      requestCount: this._requestCount,')
    lines.push('      errorCount: this._errorCount,')
    lines.push('    };')
    lines.push('  }')
    lines.push('')
  }

  lines.push('}')

  // Generate type definitions
  const dtsLines: string[] = [
    `import { RpcTarget } from '${rpcTargetImport}';`,
    '',
    `export interface ${className}Functions {`,
  ]

  for (const sig of signatures) {
    const paramsStr = sig.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
    dtsLines.push(`  ${sig.name}(${paramsStr}): ${sig.returnType};`)
  }

  dtsLines.push('}')
  dtsLines.push('')
  dtsLines.push(`export declare class ${className} extends RpcTarget {`)
  dtsLines.push(`  constructor(functions: ${className}Functions);`)

  for (const sig of signatures) {
    const paramsStr = sig.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
    dtsLines.push(`  ${sig.name}(${paramsStr}): ${sig.returnType};`)
  }

  if (includeMetrics) {
    dtsLines.push('  getMetrics(): { requestCount: number; errorCount: number };')
  }

  dtsLines.push('}')

  return {
    code: lines.join('\n'),
    dts: dtsLines.join('\n'),
  }
}

// ============================================================================
// ESM Bundle Production
// ============================================================================

/**
 * Build an ESM bundle ready for deployment to Functions.do.
 *
 * Uses esbuild to create optimized bundles with:
 * - ES2022 target for modern Workers runtime
 * - Tree-shaking for minimal bundle size
 * - Optional minification
 * - Source map generation
 *
 * @param config - Bundle configuration
 * @returns Bundle result with output path and size
 *
 * @example
 * ```typescript
 * const result = await buildEsmBundle({
 *   entryPoint: './src/index.ts',
 *   outFile: './dist/worker.js',
 *   minify: true,
 *   sourcemap: true,
 * });
 * console.log(`Bundle size: ${result.size} bytes`);
 * ```
 */
export async function buildEsmBundle(config: BundleConfig): Promise<BundleResult> {
  try {
    // Ensure output directory exists
    await mkdir(dirname(config.outFile), { recursive: true })

    const result = await esbuild.build({
      entryPoints: [config.entryPoint],
      bundle: true,
      format: 'esm',
      target: 'es2022',
      platform: 'browser', // Cloudflare Workers use browser-like environment
      outfile: config.outFile,
      minify: config.minify ?? false,
      sourcemap: config.sourcemap ? 'external' : false,
      external: config.external ?? [],
      treeShaking: true,
      metafile: true,
      ...config.esbuildOptions,
    })

    // Calculate bundle size
    const outputs = result.metafile?.outputs || {}
    const mainOutput = Object.entries(outputs).find(([path]) => !path.endsWith('.map'))
    const size = mainOutput ? mainOutput[1].bytes : 0

    const bundleResult: BundleResult = {
      outputPath: config.outFile,
      size,
    }

    if (config.sourcemap) {
      bundleResult.sourceMapPath = `${config.outFile}.map`
    }

    return bundleResult
  } catch (error) {
    if (error && typeof error === 'object' && 'errors' in error) {
      const esbuildError = error as { errors: Array<{ text: string }> }
      return {
        outputPath: '',
        size: 0,
        errors: esbuildError.errors.map((e) => ({ message: e.text })),
      }
    }

    return {
      outputPath: '',
      size: 0,
      errors: [{ message: error instanceof Error ? error.message : String(error) }],
    }
  }
}

/**
 * Build configuration for a Functions.do TypeScript function.
 *
 * @param entryPoint - Path to the entry point file
 * @param outputDir - Output directory for the bundle
 * @param options - Additional options
 * @returns Bundle configuration optimized for Functions.do
 */
export function createFunctionsDoConfig(
  entryPoint: string,
  outputDir: string,
  options: {
    minify?: boolean
    sourcemap?: boolean
    functionName?: string
  } = {}
): BundleConfig {
  const functionName = options.functionName || 'worker'

  return {
    entryPoint,
    outFile: join(outputDir, `${functionName}.js`),
    minify: options.minify ?? true,
    sourcemap: options.sourcemap ?? true,
    external: [
      // These are provided by the Workers runtime
      'cloudflare:email',
      'cloudflare:sockets',
    ],
    esbuildOptions: {
      define: {
        'process.env.NODE_ENV': '"production"',
      },
      conditions: ['worker', 'browser', 'module', 'import'],
    },
  }
}

// ============================================================================
// API Documentation Generation
// ============================================================================

/**
 * Generate API documentation from function signatures.
 *
 * Creates structured documentation suitable for rendering as
 * Markdown, HTML, or other formats.
 *
 * @param signatures - Function signatures with JSDoc
 * @param options - Documentation options
 * @returns Structured API documentation
 *
 * @example
 * ```typescript
 * const docs = generateApiDocumentation(signatures, {
 *   name: 'my-functions',
 *   version: '1.0.0',
 * });
 * ```
 */
export function generateApiDocumentation(
  signatures: FunctionSignature[],
  options: {
    name: string
    description?: string
    version?: string
  }
): ApiDocumentation {
  const entries: ApiDocEntry[] = signatures.map((sig) => {
    const paramsStr = sig.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')

    const entry: ApiDocEntry = {
      name: sig.name,
      signature: `${sig.isAsync ? 'async ' : ''}function ${sig.name}(${paramsStr}): ${sig.returnType}`,
      description: sig.description,
      params: sig.params.map((p) => ({
        name: p.name,
        type: p.type,
        description: sig.jsdocTags?.find((t) => t.tag === 'param' && t.name === p.name)?.description,
        optional: p.optional,
      })),
    }

    // Extract returns
    const returnsTag = sig.jsdocTags?.find((t) => t.tag === 'returns' || t.tag === 'return')
    if (returnsTag) {
      entry.returns = {
        type: sig.returnType,
        description: returnsTag.description,
      }
    }

    // Extract examples
    const exampleTags = sig.jsdocTags?.filter((t) => t.tag === 'example')
    if (exampleTags && exampleTags.length > 0) {
      entry.examples = exampleTags.map((t) => t.description || '').filter(Boolean)
    }

    // Extract deprecated
    const deprecatedTag = sig.jsdocTags?.find((t) => t.tag === 'deprecated')
    if (deprecatedTag) {
      entry.deprecated = deprecatedTag.description || 'This function is deprecated'
    }

    // Extract since
    const sinceTag = sig.jsdocTags?.find((t) => t.tag === 'since')
    if (sinceTag) {
      entry.since = sinceTag.description
    }

    return entry
  })

  return {
    name: options.name,
    description: options.description,
    version: options.version,
    entries,
  }
}

/**
 * Generate Markdown documentation from API documentation.
 *
 * @param docs - API documentation object
 * @returns Markdown string
 */
export function generateMarkdownDocs(docs: ApiDocumentation): string {
  const lines: string[] = []

  // Header
  lines.push(`# ${docs.name}`)
  lines.push('')

  if (docs.description) {
    lines.push(docs.description)
    lines.push('')
  }

  if (docs.version) {
    lines.push(`**Version:** ${docs.version}`)
    lines.push('')
  }

  lines.push('## API Reference')
  lines.push('')

  // Table of contents
  lines.push('### Contents')
  lines.push('')
  for (const entry of docs.entries) {
    lines.push(`- [\`${entry.name}\`](#${entry.name.toLowerCase()})`)
  }
  lines.push('')

  // Entries
  for (const entry of docs.entries) {
    lines.push(`### ${entry.name}`)
    lines.push('')

    if (entry.deprecated) {
      lines.push(`> **Deprecated:** ${entry.deprecated}`)
      lines.push('')
    }

    lines.push('```typescript')
    lines.push(entry.signature)
    lines.push('```')
    lines.push('')

    if (entry.description) {
      lines.push(entry.description)
      lines.push('')
    }

    // Parameters
    if (entry.params.length > 0) {
      lines.push('#### Parameters')
      lines.push('')
      lines.push('| Name | Type | Required | Description |')
      lines.push('|------|------|----------|-------------|')

      for (const param of entry.params) {
        const required = param.optional ? 'No' : 'Yes'
        const desc = param.description || '-'
        lines.push(`| \`${param.name}\` | \`${param.type}\` | ${required} | ${desc} |`)
      }
      lines.push('')
    }

    // Returns
    if (entry.returns) {
      lines.push('#### Returns')
      lines.push('')
      lines.push(`\`${entry.returns.type}\``)
      if (entry.returns.description) {
        lines.push('')
        lines.push(entry.returns.description)
      }
      lines.push('')
    }

    // Examples
    if (entry.examples && entry.examples.length > 0) {
      lines.push('#### Examples')
      lines.push('')
      for (const example of entry.examples) {
        lines.push('```typescript')
        lines.push(example)
        lines.push('```')
        lines.push('')
      }
    }

    if (entry.since) {
      lines.push(`*Since: ${entry.since}*`)
      lines.push('')
    }

    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

// ============================================================================
// Type Extraction
// ============================================================================

/**
 * Extract interface and type definitions from TypeScript source code.
 *
 * @param code - TypeScript source code
 * @returns Array of extracted types
 *
 * @example
 * ```typescript
 * const types = extractTypes(`
 *   export interface User {
 *     name: string;
 *     age: number;
 *   }
 * `);
 * ```
 */
export function extractTypes(code: string): ExtractedType[] {
  const types: ExtractedType[] = []

  // Pattern for interface declarations
  const interfacePattern =
    /(?:\/\*\*[\s\S]*?\*\/\s*)?(export\s+)?interface\s+(\w+)(?:<([^>]+)>)?\s*(?:extends\s+[^{]+)?\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g

  // Pattern for type aliases
  const typePattern = /(?:\/\*\*[\s\S]*?\*\/\s*)?(export\s+)?type\s+(\w+)(?:<([^>]+)>)?\s*=\s*([^;]+);/g

  // Extract interfaces
  let match
  while ((match = interfacePattern.exec(code)) !== null) {
    const [fullMatch, exportKeyword, name, typeParams, body] = match
    const jsdocMatch = fullMatch.match(/\/\*\*\s*([\s\S]*?)\s*\*\//)
    const description = jsdocMatch ? extractDescription(jsdocMatch[1]) : undefined

    types.push({
      name,
      kind: 'interface',
      typeParameters: typeParams?.split(',').map((p) => p.trim()),
      properties: parseInterfaceProperties(body),
      description,
      exported: !!exportKeyword,
    })
  }

  // Extract type aliases
  while ((match = typePattern.exec(code)) !== null) {
    const [fullMatch, exportKeyword, name, typeParams, definition] = match
    const jsdocMatch = fullMatch.match(/\/\*\*\s*([\s\S]*?)\s*\*\//)
    const description = jsdocMatch ? extractDescription(jsdocMatch[1]) : undefined

    types.push({
      name,
      kind: 'type',
      typeParameters: typeParams?.split(',').map((p) => p.trim()),
      definition: definition.trim(),
      description,
      exported: !!exportKeyword,
    })
  }

  return types
}

/**
 * Parse properties from an interface body.
 */
function parseInterfaceProperties(
  body: string
): Array<{ name: string; type: string; optional: boolean; description?: string }> {
  const properties: Array<{ name: string; type: string; optional: boolean; description?: string }> = []

  // Match property definitions with optional JSDoc
  const propPattern = /(?:\/\*\*\s*([\s\S]*?)\s*\*\/\s*)?(\w+)(\?)?:\s*([^;,\n]+)/g

  let match
  while ((match = propPattern.exec(body)) !== null) {
    const [, jsdoc, name, optional, type] = match
    properties.push({
      name,
      type: type.trim(),
      optional: !!optional,
      description: jsdoc ? extractDescription(jsdoc) : undefined,
    })
  }

  return properties
}

/**
 * Generate comprehensive type definitions including extracted types.
 *
 * @param code - TypeScript source code
 * @param moduleName - Module name for the declaration
 * @returns Complete .d.ts content
 */
export function generateComprehensiveTypes(code: string, moduleName: string): string {
  const signatures = extractFunctionSignatures(code)
  const extractedTypes = extractTypes(code)

  const lines: string[] = [
    '/**',
    ` * Auto-generated type definitions for ${moduleName}`,
    ' * ',
    ' * Generated by Functions.do SDK Compiler',
    ` * @module ${moduleName}`,
    ' */',
    '',
  ]

  // Add module declaration
  lines.push(`declare module '${moduleName}' {`)

  // Add extracted types
  for (const type of extractedTypes) {
    if (type.description) {
      lines.push('  /**')
      lines.push(`   * ${type.description}`)
      lines.push('   */')
    }

    if (type.kind === 'interface') {
      const typeParamsStr = type.typeParameters ? `<${type.typeParameters.join(', ')}>` : ''
      lines.push(`  export interface ${type.name}${typeParamsStr} {`)

      if (type.properties) {
        for (const prop of type.properties) {
          if (prop.description) {
            lines.push(`    /** ${prop.description} */`)
          }
          const opt = prop.optional ? '?' : ''
          lines.push(`    ${prop.name}${opt}: ${prop.type};`)
        }
      }

      lines.push('  }')
      lines.push('')
    } else {
      const typeParamsStr = type.typeParameters ? `<${type.typeParameters.join(', ')}>` : ''
      lines.push(`  export type ${type.name}${typeParamsStr} = ${type.definition};`)
      lines.push('')
    }
  }

  // Add function signatures
  for (const sig of signatures) {
    if (sig.description || sig.jsdocTags) {
      lines.push('  /**')
      if (sig.description) {
        lines.push(`   * ${sig.description}`)
      }
      if (sig.jsdocTags) {
        for (const tag of sig.jsdocTags) {
          if (tag.tag === 'param' && tag.name) {
            lines.push(`   * @param ${tag.name} ${tag.description || ''}`.trimEnd())
          } else if (tag.tag === 'returns' || tag.tag === 'return') {
            lines.push(`   * @returns ${tag.description || ''}`.trimEnd())
          }
        }
      }
      lines.push('   */')
    }

    const paramsStr = sig.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
    const asyncPrefix = sig.isAsync ? 'async ' : ''
    lines.push(`  export ${asyncPrefix}function ${sig.name}(${paramsStr}): ${sig.returnType};`)
    lines.push('')
  }

  lines.push('}')

  return lines.join('\n')
}

// ============================================================================
// capnweb RpcStub Generation (Enhanced)
// ============================================================================

/**
 * Generate a complete RPC stub client with validation, retry, and caching support.
 *
 * @param signatures - Function signatures for the RPC methods
 * @param config - Stub configuration
 * @returns Generated stub code and type definitions
 *
 * @example
 * ```typescript
 * const stub = generateRpcStub(signatures, {
 *   className: 'MyServiceStub',
 *   includeRetry: true,
 *   includeCaching: true,
 * });
 * ```
 */
export function generateRpcStub(signatures: FunctionSignature[], config: RpcStubConfig): RpcStubResult {
  const { className, rpcTargetImport = 'capnweb', includeValidation = true, includeRetry = true, includeCaching = false } = config

  const lines: string[] = [
    '/**',
    ` * Auto-generated RPC Stub for ${className}`,
    ' *',
    ' * This client provides type-safe RPC method invocation with:',
  ]

  if (includeValidation) lines.push(' * - Parameter validation')
  if (includeRetry) lines.push(' * - Automatic retry with exponential backoff')
  if (includeCaching) lines.push(' * - Response caching')
  lines.push(' * - Full TypeScript type safety')
  lines.push(' */')
  lines.push('')

  // Imports
  lines.push(`import type { RpcTarget } from '${rpcTargetImport}';`)
  lines.push('')

  // Generate method interface
  lines.push(`/**`)
  lines.push(` * Interface defining all RPC methods available on ${className}`)
  lines.push(` */`)
  lines.push(`export interface ${className}Methods {`)

  for (const sig of signatures) {
    if (sig.description) {
      lines.push(`  /** ${sig.description} */`)
    }
    const paramsStr = sig.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
    lines.push(`  ${sig.name}(${paramsStr}): ${sig.returnType};`)
  }

  lines.push('}')
  lines.push('')

  // Generate RPC request/response types
  lines.push(`/**`)
  lines.push(` * RPC request format for ${className}`)
  lines.push(` */`)
  lines.push(`export interface ${className}RpcRequest {`)
  lines.push(`  /** Method to invoke */`)
  lines.push(`  method: keyof ${className}Methods;`)
  lines.push(`  /** Method parameters */`)
  lines.push(`  params: unknown[];`)
  lines.push(`  /** Optional request ID for correlation */`)
  lines.push(`  id?: string;`)
  lines.push(`}`)
  lines.push('')

  lines.push(`/**`)
  lines.push(` * RPC response format`)
  lines.push(` */`)
  lines.push(`export type ${className}RpcResponse<T> = `)
  lines.push(`  | { id?: string; result: T }`)
  lines.push(`  | { id?: string; error: string; code: string };`)
  lines.push('')

  // Retry configuration if enabled
  if (includeRetry) {
    lines.push(`/**`)
    lines.push(` * Retry configuration`)
    lines.push(` */`)
    lines.push(`export interface RetryConfig {`)
    lines.push(`  /** Maximum number of retry attempts */`)
    lines.push(`  maxAttempts: number;`)
    lines.push(`  /** Initial delay in ms */`)
    lines.push(`  initialDelay: number;`)
    lines.push(`  /** Maximum delay in ms */`)
    lines.push(`  maxDelay: number;`)
    lines.push(`  /** Backoff multiplier */`)
    lines.push(`  backoffMultiplier: number;`)
    lines.push(`}`)
    lines.push('')
    lines.push(`const DEFAULT_RETRY_CONFIG: RetryConfig = {`)
    lines.push(`  maxAttempts: 3,`)
    lines.push(`  initialDelay: 100,`)
    lines.push(`  maxDelay: 5000,`)
    lines.push(`  backoffMultiplier: 2,`)
    lines.push(`};`)
    lines.push('')
  }

  // Cache configuration if enabled
  if (includeCaching) {
    lines.push(`/**`)
    lines.push(` * Cache configuration`)
    lines.push(` */`)
    lines.push(`export interface CacheConfig {`)
    lines.push(`  /** TTL in milliseconds */`)
    lines.push(`  ttl: number;`)
    lines.push(`  /** Maximum cache entries */`)
    lines.push(`  maxEntries: number;`)
    lines.push(`}`)
    lines.push('')
    lines.push(`const DEFAULT_CACHE_CONFIG: CacheConfig = {`)
    lines.push(`  ttl: 60000,`)
    lines.push(`  maxEntries: 100,`)
    lines.push(`};`)
    lines.push('')
  }

  // Generate error class
  lines.push(`/**`)
  lines.push(` * Error thrown when an RPC call fails`)
  lines.push(` */`)
  lines.push(`export class ${className}Error extends Error {`)
  lines.push(`  readonly code: string;`)
  lines.push(`  readonly requestId?: string;`)
  lines.push(``)
  lines.push(`  constructor(message: string, code: string, requestId?: string) {`)
  lines.push(`    super(message);`)
  lines.push(`    this.name = '${className}Error';`)
  lines.push(`    this.code = code;`)
  lines.push(`    this.requestId = requestId;`)
  lines.push(`  }`)
  lines.push(``)
  lines.push(`  get isMethodNotFound(): boolean { return this.code === 'METHOD_NOT_FOUND'; }`)
  lines.push(`  get isInvalidParams(): boolean { return this.code === 'INVALID_PARAMS'; }`)
  lines.push(`  get isInternalError(): boolean { return this.code === 'INTERNAL_ERROR'; }`)
  lines.push(`  get isTimeout(): boolean { return this.code === 'TIMEOUT'; }`)
  lines.push(`}`)
  lines.push('')

  // Generate stub class
  lines.push(`/**`)
  lines.push(` * RPC Stub client for ${className}`)
  lines.push(` *`)
  lines.push(` * @example`)
  lines.push(` * \`\`\`typescript`)
  lines.push(` * // Using service binding`)
  lines.push(` * const stub = new ${className}Stub(env.MY_SERVICE);`)
  lines.push(` * const result = await stub.methodName(arg1, arg2);`)
  lines.push(` *`)
  lines.push(` * // Using URL`)
  lines.push(` * const stub = ${className}Stub.fromUrl('https://my-service.workers.dev');`)
  lines.push(` * \`\`\``)
  lines.push(` */`)
  lines.push(`export class ${className}Stub implements ${className}Methods {`)
  lines.push(`  private _target: Fetcher | string;`)
  lines.push(`  private _requestCount = 0;`)
  lines.push(`  private _errorCount = 0;`)

  if (includeRetry) {
    lines.push(`  private _retryConfig: RetryConfig;`)
  }
  if (includeCaching) {
    lines.push(`  private _cache: Map<string, { value: unknown; expires: number }> = new Map();`)
    lines.push(`  private _cacheConfig: CacheConfig;`)
  }

  lines.push('')

  // Constructor
  const constructorParams: string[] = ['target: Fetcher | string']
  if (includeRetry) constructorParams.push('retryConfig?: Partial<RetryConfig>')
  if (includeCaching) constructorParams.push('cacheConfig?: Partial<CacheConfig>')

  lines.push(`  constructor(${constructorParams.join(', ')}) {`)
  lines.push(`    this._target = target;`)
  if (includeRetry) {
    lines.push(`    this._retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };`)
  }
  if (includeCaching) {
    lines.push(`    this._cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...cacheConfig };`)
  }
  lines.push(`  }`)
  lines.push('')

  // Static factory methods
  lines.push(`  /**`)
  lines.push(`   * Create a stub from a URL`)
  lines.push(`   */`)
  lines.push(`  static fromUrl(url: string): ${className}Stub {`)
  lines.push(`    return new ${className}Stub(url);`)
  lines.push(`  }`)
  lines.push('')
  lines.push(`  /**`)
  lines.push(`   * Create a stub from a service binding`)
  lines.push(`   */`)
  lines.push(`  static fromBinding(binding: Fetcher): ${className}Stub {`)
  lines.push(`    return new ${className}Stub(binding);`)
  lines.push(`  }`)
  lines.push('')

  // Internal call method
  lines.push(`  private async _call<T>(method: string, params: unknown[]): Promise<T> {`)
  lines.push(`    this._requestCount++;`)
  lines.push(`    const id = crypto.randomUUID();`)
  lines.push(`    const body: ${className}RpcRequest = { method: method as keyof ${className}Methods, params, id };`)
  lines.push('')
  lines.push(`    let response: Response;`)
  lines.push(`    if (typeof this._target === 'string') {`)
  lines.push(`      response = await fetch(\`\${this._target}/rpc\`, {`)
  lines.push(`        method: 'POST',`)
  lines.push(`        headers: { 'Content-Type': 'application/json' },`)
  lines.push(`        body: JSON.stringify(body),`)
  lines.push(`      });`)
  lines.push(`    } else {`)
  lines.push(`      response = await this._target.fetch('http://internal/rpc', {`)
  lines.push(`        method: 'POST',`)
  lines.push(`        headers: { 'Content-Type': 'application/json' },`)
  lines.push(`        body: JSON.stringify(body),`)
  lines.push(`      });`)
  lines.push(`    }`)
  lines.push('')
  lines.push(`    const result = await response.json() as ${className}RpcResponse<T>;`)
  lines.push('')
  lines.push(`    if ('error' in result) {`)
  lines.push(`      this._errorCount++;`)
  lines.push(`      throw new ${className}Error(result.error, result.code, result.id);`)
  lines.push(`    }`)
  lines.push('')
  lines.push(`    return result.result;`)
  lines.push(`  }`)
  lines.push('')

  // Retry helper if enabled
  if (includeRetry) {
    lines.push(`  private async _callWithRetry<T>(method: string, params: unknown[]): Promise<T> {`)
    lines.push(`    let lastError: Error | null = null;`)
    lines.push(`    let delay = this._retryConfig.initialDelay;`)
    lines.push('')
    lines.push(`    for (let attempt = 0; attempt < this._retryConfig.maxAttempts; attempt++) {`)
    lines.push(`      try {`)
    lines.push(`        return await this._call<T>(method, params);`)
    lines.push(`      } catch (error) {`)
    lines.push(`        lastError = error as Error;`)
    lines.push(`        // Don't retry on client errors`)
    lines.push(`        if (error instanceof ${className}Error && `)
    lines.push(`            (error.isInvalidParams || error.isMethodNotFound)) {`)
    lines.push(`          throw error;`)
    lines.push(`        }`)
    lines.push(`        if (attempt < this._retryConfig.maxAttempts - 1) {`)
    lines.push(`          await new Promise(r => setTimeout(r, delay));`)
    lines.push(`          delay = Math.min(delay * this._retryConfig.backoffMultiplier, this._retryConfig.maxDelay);`)
    lines.push(`        }`)
    lines.push(`      }`)
    lines.push(`    }`)
    lines.push('')
    lines.push(`    throw lastError;`)
    lines.push(`  }`)
    lines.push('')
  }

  // Generate method implementations
  for (const sig of signatures) {
    const paramsStr = sig.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
    const argsStr = sig.params.map((p) => p.name).join(', ')
    const argsArray = sig.params.length > 0 ? `[${argsStr}]` : '[]'

    if (sig.description || sig.jsdocTags) {
      lines.push(`  /**`)
      if (sig.description) {
        lines.push(`   * ${sig.description}`)
      }
      if (sig.jsdocTags) {
        for (const tag of sig.jsdocTags) {
          if (tag.tag === 'param' && tag.name) {
            lines.push(`   * @param ${tag.name} ${tag.description || ''}`.trimEnd())
          } else if (tag.tag === 'returns' || tag.tag === 'return') {
            lines.push(`   * @returns ${tag.description || ''}`.trimEnd())
          }
        }
      }
      lines.push(`   */`)
    }

    const returnType = sig.returnType
    const callMethod = includeRetry ? '_callWithRetry' : '_call'

    // For async functions, unwrap the Promise type
    const innerType = returnType.replace(/^Promise<(.+)>$/, '$1')

    lines.push(`  async ${sig.name}(${paramsStr}): ${returnType.startsWith('Promise') ? returnType : `Promise<${returnType}>`} {`)

    if (includeValidation && sig.params.length > 0) {
      // Add basic validation for required params
      for (const param of sig.params) {
        if (!param.optional) {
          lines.push(`    if (${param.name} === undefined || ${param.name} === null) {`)
          lines.push(`      throw new ${className}Error('Parameter "${param.name}" is required', 'INVALID_PARAMS');`)
          lines.push(`    }`)
        }
      }
    }

    lines.push(`    return this.${callMethod}<${innerType}>('${sig.name}', ${argsArray});`)
    lines.push(`  }`)
    lines.push('')
  }

  // Metrics getter
  lines.push(`  /**`)
  lines.push(`   * Get client metrics`)
  lines.push(`   */`)
  lines.push(`  getMetrics(): { requestCount: number; errorCount: number } {`)
  lines.push(`    return { requestCount: this._requestCount, errorCount: this._errorCount };`)
  lines.push(`  }`)

  lines.push(`}`)

  // Generate type definitions
  const dtsLines: string[] = [
    `import type { RpcTarget } from '${rpcTargetImport}';`,
    '',
    `export interface ${className}Methods {`,
  ]

  for (const sig of signatures) {
    const paramsStr = sig.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
    dtsLines.push(`  ${sig.name}(${paramsStr}): ${sig.returnType};`)
  }

  dtsLines.push('}')
  dtsLines.push('')

  dtsLines.push(`export interface ${className}RpcRequest {`)
  dtsLines.push(`  method: keyof ${className}Methods;`)
  dtsLines.push(`  params: unknown[];`)
  dtsLines.push(`  id?: string;`)
  dtsLines.push(`}`)
  dtsLines.push('')

  dtsLines.push(`export type ${className}RpcResponse<T> =`)
  dtsLines.push(`  | { id?: string; result: T }`)
  dtsLines.push(`  | { id?: string; error: string; code: string };`)
  dtsLines.push('')

  if (includeRetry) {
    dtsLines.push(`export interface RetryConfig {`)
    dtsLines.push(`  maxAttempts: number;`)
    dtsLines.push(`  initialDelay: number;`)
    dtsLines.push(`  maxDelay: number;`)
    dtsLines.push(`  backoffMultiplier: number;`)
    dtsLines.push(`}`)
    dtsLines.push('')
  }

  if (includeCaching) {
    dtsLines.push(`export interface CacheConfig {`)
    dtsLines.push(`  ttl: number;`)
    dtsLines.push(`  maxEntries: number;`)
    dtsLines.push(`}`)
    dtsLines.push('')
  }

  dtsLines.push(`export declare class ${className}Error extends Error {`)
  dtsLines.push(`  readonly code: string;`)
  dtsLines.push(`  readonly requestId?: string;`)
  dtsLines.push(`  constructor(message: string, code: string, requestId?: string);`)
  dtsLines.push(`  get isMethodNotFound(): boolean;`)
  dtsLines.push(`  get isInvalidParams(): boolean;`)
  dtsLines.push(`  get isInternalError(): boolean;`)
  dtsLines.push(`  get isTimeout(): boolean;`)
  dtsLines.push(`}`)
  dtsLines.push('')

  const stubConstructorParams: string[] = ['target: Fetcher | string']
  if (includeRetry) stubConstructorParams.push('retryConfig?: Partial<RetryConfig>')
  if (includeCaching) stubConstructorParams.push('cacheConfig?: Partial<CacheConfig>')

  dtsLines.push(`export declare class ${className}Stub implements ${className}Methods {`)
  dtsLines.push(`  constructor(${stubConstructorParams.join(', ')});`)
  dtsLines.push(`  static fromUrl(url: string): ${className}Stub;`)
  dtsLines.push(`  static fromBinding(binding: Fetcher): ${className}Stub;`)

  for (const sig of signatures) {
    const paramsStr = sig.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
    const returnType = sig.returnType.startsWith('Promise') ? sig.returnType : `Promise<${sig.returnType}>`
    dtsLines.push(`  ${sig.name}(${paramsStr}): ${returnType};`)
  }

  dtsLines.push(`  getMetrics(): { requestCount: number; errorCount: number };`)
  dtsLines.push(`}`)

  return {
    clientCode: lines.join('\n'),
    dts: dtsLines.join('\n'),
  }
}

/**
 * Generate RpcTarget class with enhanced features for capnweb.
 *
 * @param signatures - Function signatures to wrap
 * @param className - Name of the target class
 * @param options - Generation options
 * @returns Generated code and type definitions
 */
export function generateEnhancedRpcTarget(
  signatures: FunctionSignature[],
  className: string,
  options: {
    rpcTargetImport?: string
    includeTracing?: boolean
    includeMetrics?: boolean
    includeValidation?: boolean
    envType?: string
  } = {}
): RpcBindingsResult {
  const {
    rpcTargetImport = 'capnweb',
    includeTracing = true,
    includeMetrics = true,
    includeValidation = true,
    envType = 'Env',
  } = options

  const lines: string[] = [
    '/**',
    ` * Auto-generated capnweb RpcTarget: ${className}`,
    ' *',
    ' * This class provides an RPC-callable target with:',
  ]

  if (includeTracing) lines.push(' * - Distributed tracing support')
  if (includeMetrics) lines.push(' * - Performance metrics collection')
  if (includeValidation) lines.push(' * - Parameter validation')
  lines.push(' * - Type-safe method invocation')
  lines.push(' * - Automatic resource cleanup via Symbol.dispose')
  lines.push(' */')
  lines.push('')

  lines.push(`import { RpcTarget } from '${rpcTargetImport}';`)
  lines.push('')

  // Generate functions interface
  lines.push(`/**`)
  lines.push(` * Interface for ${className} function implementations`)
  lines.push(` */`)
  lines.push(`export interface ${className}Functions {`)

  for (const sig of signatures) {
    if (sig.description) {
      lines.push(`  /** ${sig.description} */`)
    }
    const paramsStr = sig.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
    lines.push(`  ${sig.name}(${paramsStr}): ${sig.returnType};`)
  }

  lines.push('}')
  lines.push('')

  // Generate methods interface
  lines.push(`/**`)
  lines.push(` * Public RPC methods interface for ${className}`)
  lines.push(` */`)
  lines.push(`export interface ${className}Methods extends ${className}Functions {`)
  if (includeMetrics) {
    lines.push(`  /** Get current metrics */`)
    lines.push(`  getMetrics(): { requestCount: number; errorCount: number; latencyMs: number[] };`)
  }
  lines.push(`}`)
  lines.push('')

  // Tracing interface
  if (includeTracing) {
    lines.push(`/**`)
    lines.push(` * Trace span information`)
    lines.push(` */`)
    lines.push(`interface TraceSpan {`)
    lines.push(`  traceId: string;`)
    lines.push(`  spanId: string;`)
    lines.push(`  method: string;`)
    lines.push(`  startTime: number;`)
    lines.push(`  endTime?: number;`)
    lines.push(`  error?: string;`)
    lines.push(`}`)
    lines.push('')
  }

  // Generate the class
  lines.push(`/**`)
  lines.push(` * RpcTarget implementation: ${className}`)
  lines.push(` *`)
  lines.push(` * @example`)
  lines.push(` * \`\`\`typescript`)
  lines.push(` * const target = new ${className}(env, {`)
  lines.push(` *   greet: async (name) => \`Hello, \${name}!\`,`)
  lines.push(` * });`)
  lines.push(` * `)
  lines.push(` * // Use as RPC target`)
  lines.push(` * export default { fetch: target.fetch.bind(target) };`)
  lines.push(` * \`\`\``)
  lines.push(` */`)
  lines.push(`export class ${className} extends RpcTarget implements ${className}Methods {`)
  lines.push(`  private _functions: ${className}Functions;`)
  lines.push(`  private _env: ${envType};`)

  if (includeMetrics) {
    lines.push(`  private _requestCount = 0;`)
    lines.push(`  private _errorCount = 0;`)
    lines.push(`  private _latencyMs: number[] = [];`)
  }

  if (includeTracing) {
    lines.push(`  private _traceId?: string;`)
    lines.push(`  private _spans: TraceSpan[] = [];`)
  }

  lines.push('')

  // Constructor
  lines.push(`  constructor(env: ${envType}, functions: ${className}Functions) {`)
  lines.push(`    super();`)
  lines.push(`    this._env = env;`)
  lines.push(`    this._functions = functions;`)
  lines.push(`  }`)
  lines.push('')

  // Set trace ID method if tracing enabled
  if (includeTracing) {
    lines.push(`  /**`)
    lines.push(`   * Set the trace ID for distributed tracing`)
    lines.push(`   */`)
    lines.push(`  setTraceId(traceId: string): this {`)
    lines.push(`    this._traceId = traceId;`)
    lines.push(`    return this;`)
    lines.push(`  }`)
    lines.push('')
    lines.push(`  /**`)
    lines.push(`   * Get collected trace spans`)
    lines.push(`   */`)
    lines.push(`  getTraceSpans(): TraceSpan[] {`)
    lines.push(`    return [...this._spans];`)
    lines.push(`  }`)
    lines.push('')
  }

  // Generate method wrappers
  for (const sig of signatures) {
    const paramsStr = sig.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
    const argsStr = sig.params.map((p) => p.name).join(', ')

    if (sig.description || sig.jsdocTags) {
      lines.push(`  /**`)
      if (sig.description) {
        lines.push(`   * ${sig.description}`)
      }
      if (sig.jsdocTags) {
        for (const tag of sig.jsdocTags) {
          if (tag.tag === 'param' && tag.name) {
            lines.push(`   * @param ${tag.name} ${tag.description || ''}`.trimEnd())
          } else if (tag.tag === 'returns' || tag.tag === 'return') {
            lines.push(`   * @returns ${tag.description || ''}`.trimEnd())
          }
        }
      }
      lines.push(`   */`)
    }

    const asyncKeyword = sig.isAsync ? 'async ' : ''
    lines.push(`  ${asyncKeyword}${sig.name}(${paramsStr}): ${sig.returnType} {`)

    if (includeMetrics) {
      lines.push(`    this._requestCount++;`)
    }

    if (includeTracing) {
      lines.push(`    const spanId = crypto.randomUUID().slice(0, 8);`)
      lines.push(`    const startTime = performance.now();`)
      lines.push(`    const span: TraceSpan = {`)
      lines.push(`      traceId: this._traceId || 'untraced',`)
      lines.push(`      spanId,`)
      lines.push(`      method: '${sig.name}',`)
      lines.push(`      startTime,`)
      lines.push(`    };`)
    }

    // Validation
    if (includeValidation) {
      for (const param of sig.params) {
        if (!param.optional) {
          lines.push(`    if (${param.name} === undefined || ${param.name} === null) {`)
          lines.push(`      throw new Error('Parameter "${param.name}" is required');`)
          lines.push(`    }`)
        }
      }
    }

    lines.push(`    try {`)

    if (sig.isAsync) {
      lines.push(`      const result = await this._functions.${sig.name}(${argsStr});`)
    } else {
      lines.push(`      const result = this._functions.${sig.name}(${argsStr});`)
    }

    if (includeTracing) {
      lines.push(`      span.endTime = performance.now();`)
      lines.push(`      this._spans.push(span);`)
    }

    if (includeMetrics) {
      lines.push(`      this._latencyMs.push(performance.now() - startTime);`)
    }

    lines.push(`      return result;`)
    lines.push(`    } catch (error) {`)

    if (includeMetrics) {
      lines.push(`      this._errorCount++;`)
    }

    if (includeTracing) {
      lines.push(`      span.endTime = performance.now();`)
      lines.push(`      span.error = error instanceof Error ? error.message : String(error);`)
      lines.push(`      this._spans.push(span);`)
    }

    lines.push(`      throw error;`)
    lines.push(`    }`)
    lines.push(`  }`)
    lines.push('')
  }

  // Metrics getter
  if (includeMetrics) {
    lines.push(`  /**`)
    lines.push(`   * Get current metrics`)
    lines.push(`   */`)
    lines.push(`  getMetrics(): { requestCount: number; errorCount: number; latencyMs: number[] } {`)
    lines.push(`    return {`)
    lines.push(`      requestCount: this._requestCount,`)
    lines.push(`      errorCount: this._errorCount,`)
    lines.push(`      latencyMs: [...this._latencyMs],`)
    lines.push(`    };`)
    lines.push(`  }`)
    lines.push('')
  }

  // Dispose method
  lines.push(`  /**`)
  lines.push(`   * Clean up resources`)
  lines.push(`   */`)
  lines.push(`  [Symbol.dispose](): void {`)
  if (includeMetrics) {
    lines.push(`    const metrics = this.getMetrics();`)
    lines.push(`    console.log(\`[${className}] Disposed. Requests: \${metrics.requestCount}, Errors: \${metrics.errorCount}\`);`)
  }
  if (includeTracing) {
    lines.push(`    // Spans can be exported here if needed`)
  }
  lines.push(`  }`)

  lines.push(`}`)

  // Generate type definitions
  const dtsLines: string[] = [
    `import { RpcTarget } from '${rpcTargetImport}';`,
    '',
    `export interface ${className}Functions {`,
  ]

  for (const sig of signatures) {
    const paramsStr = sig.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
    dtsLines.push(`  ${sig.name}(${paramsStr}): ${sig.returnType};`)
  }

  dtsLines.push('}')
  dtsLines.push('')

  dtsLines.push(`export interface ${className}Methods extends ${className}Functions {`)
  if (includeMetrics) {
    dtsLines.push(`  getMetrics(): { requestCount: number; errorCount: number; latencyMs: number[] };`)
  }
  dtsLines.push('}')
  dtsLines.push('')

  dtsLines.push(`export declare class ${className} extends RpcTarget implements ${className}Methods {`)
  dtsLines.push(`  constructor(env: ${envType}, functions: ${className}Functions);`)

  if (includeTracing) {
    dtsLines.push(`  setTraceId(traceId: string): this;`)
    dtsLines.push(`  getTraceSpans(): Array<{ traceId: string; spanId: string; method: string; startTime: number; endTime?: number; error?: string }>;`)
  }

  for (const sig of signatures) {
    const paramsStr = sig.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
    dtsLines.push(`  ${sig.name}(${paramsStr}): ${sig.returnType};`)
  }

  if (includeMetrics) {
    dtsLines.push(`  getMetrics(): { requestCount: number; errorCount: number; latencyMs: number[] };`)
  }

  dtsLines.push(`  [Symbol.dispose](): void;`)
  dtsLines.push('}')

  return {
    code: lines.join('\n'),
    dts: dtsLines.join('\n'),
  }
}
