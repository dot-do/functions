/**
 * SDK Compiler Module
 *
 * Provides build tools for Functions.do TypeScript functions:
 * - ESM bundle production with esbuild
 * - Type definition generation
 * - capnweb RpcTarget bindings generation
 * - API documentation generation
 *
 * @module compiler
 */

import * as esbuild from 'esbuild'
import { writeFile, mkdir, readFile, readdir, stat } from 'fs/promises'
import { join, dirname, basename, extname } from 'path'
import type {
  FunctionSignature,
  FunctionParameter,
  JsDocTag,
  TypeDefinitionResult,
  RpcBindingsResult,
  BundleConfig,
  BundleResult,
  ApiDocEntry,
  ApiDocumentation,
} from './types'

// ============================================================================
// TypeScript Compilation
// ============================================================================

/**
 * Compile TypeScript code to ESM using esbuild
 *
 * @param code - TypeScript source code
 * @returns Compiled ESM code with optional source map
 */
export async function compileTypeScript(code: string): Promise<{
  code: string
  map?: unknown
  errors?: Array<{ message: string; location?: unknown }>
}> {
  try {
    const result = await esbuild.transform(code, {
      loader: 'ts',
      format: 'esm',
      target: 'es2022',
      sourcemap: true,
    })

    return {
      code: result.code,
      map: result.map ? JSON.parse(result.map) : undefined,
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'errors' in error) {
      const esbuildError = error as { errors: Array<{ text: string; location?: unknown }> }
      return {
        code: '',
        errors: esbuildError.errors.map((e) => ({
          message: e.text,
          location: e.location,
        })),
      }
    }

    return {
      code: '',
      errors: [{ message: error instanceof Error ? error.message : String(error) }],
    }
  }
}

// ============================================================================
// Function Signature Extraction
// ============================================================================

/**
 * Extract function signatures from TypeScript source code
 *
 * @param code - TypeScript source code
 * @returns Array of function signatures
 */
export function extractFunctionSignatures(code: string): FunctionSignature[] {
  const signatures: FunctionSignature[] = []

  // Pattern for JSDoc comments
  const jsdocPattern = /\/\*\*\s*([\s\S]*?)\s*\*\//g

  // Pattern for function declarations
  const functionPattern =
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/g

  // Pattern for arrow functions with export
  const arrowPattern =
    /(?:export\s+)?(?:const|let)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*([^=>{]+))?\s*=>/g

  // Extract JSDoc comments
  const jsdocComments: Array<{ end: number; content: string }> = []
  let jsdocMatch
  while ((jsdocMatch = jsdocPattern.exec(code)) !== null) {
    jsdocComments.push({
      end: jsdocMatch.index + jsdocMatch[0].length,
      content: jsdocMatch[1],
    })
  }

  const findJsDoc = (pos: number): string | undefined => {
    for (const comment of jsdocComments) {
      if (pos > comment.end && pos - comment.end < 50) {
        return comment.content
      }
    }
    return undefined
  }

  // Extract function declarations
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

  return signatures
}

function parseParameters(paramsStr: string): FunctionParameter[] {
  if (!paramsStr.trim()) return []

  const params: FunctionParameter[] = []
  let depth = 0
  let current = ''

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

function parseParameter(param: string): FunctionParameter {
  const optionalMatch = param.match(/^(\w+)\?\s*:\s*(.+)$/)
  if (optionalMatch) {
    const [, name, type] = optionalMatch
    return { name, type: type.trim(), optional: true }
  }

  const requiredMatch = param.match(/^(\w+)\s*:\s*(.+)$/)
  if (requiredMatch) {
    const [, name, type] = requiredMatch
    return { name, type: type.trim(), optional: false }
  }

  return { name: param, type: 'any', optional: false }
}

function extractDescription(jsdoc: string | undefined): string | undefined {
  if (!jsdoc) return undefined

  const lines = jsdoc.split('\n').map((line) => line.replace(/^\s*\*\s?/, '').trim())

  const descLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('@')) break
    if (line) descLines.push(line)
  }

  return descLines.join(' ').trim() || undefined
}

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

// ============================================================================
// Type Definition Generation
// ============================================================================

/**
 * Generate TypeScript type definitions from function signatures
 *
 * @param signatures - Function signatures
 * @param moduleName - Module name for the declaration
 * @returns Generated .d.ts content
 */
export function generateTypeDefinitions(signatures: FunctionSignature[], moduleName: string): string {
  const lines: string[] = ['/**', ' * Auto-generated type definitions', ' * @module ' + moduleName, ' */', '']

  lines.push(`declare module '${moduleName}' {`)

  for (const sig of signatures) {
    if (sig.description) {
      lines.push('  /**')
      lines.push(`   * ${sig.description}`)
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

/**
 * Generate types from TypeScript source code
 *
 * @param code - TypeScript source code
 * @param moduleName - Module name
 * @returns Type definition result
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
 * Generate capnweb RpcTarget bindings from function signatures
 *
 * @param signatures - Function signatures
 * @param className - Name for the generated class
 * @param options - Generation options
 * @returns Generated code and type definitions
 */
export function generateRpcBindings(
  signatures: FunctionSignature[],
  className: string,
  options: {
    rpcTargetImport?: string
    includeTracing?: boolean
    includeMetrics?: boolean
  } = {}
): RpcBindingsResult {
  const { rpcTargetImport = '@functions.do/sdk', includeTracing = true, includeMetrics = true } = options

  const lines: string[] = [
    '/**',
    ` * Auto-generated capnweb RpcTarget bindings for ${className}`,
    ' */',
    '',
    `import { RpcTarget } from '${rpcTargetImport}';`,
    '',
    `export interface ${className}Functions {`,
  ]

  for (const sig of signatures) {
    const paramsStr = sig.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
    lines.push(`  ${sig.name}(${paramsStr}): ${sig.returnType};`)
  }

  lines.push('}')
  lines.push('')
  lines.push(`export class ${className} extends RpcTarget {`)
  lines.push(`  private _functions: ${className}Functions;`)

  if (includeMetrics) {
    lines.push('  private _requestCount: number = 0;')
    lines.push('  private _errorCount: number = 0;')
  }

  lines.push('')
  lines.push(`  constructor(functions: ${className}Functions) {`)
  lines.push('    super();')
  lines.push('    this._functions = functions;')
  lines.push('  }')
  lines.push('')

  for (const sig of signatures) {
    const paramsStr = sig.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
    const argsStr = sig.params.map((p) => p.name).join(', ')

    const asyncKeyword = sig.isAsync ? 'async ' : ''
    lines.push(`  ${asyncKeyword}${sig.name}(${paramsStr}): ${sig.returnType} {`)

    if (includeMetrics) {
      lines.push('    this._requestCount++;')
    }

    lines.push('    try {')
    lines.push(`      return ${sig.isAsync ? 'await ' : ''}this._functions.${sig.name}(${argsStr});`)
    lines.push('    } catch (error) {')
    if (includeMetrics) {
      lines.push('      this._errorCount++;')
    }
    lines.push('      throw error;')
    lines.push('    }')
    lines.push('  }')
    lines.push('')
  }

  if (includeMetrics) {
    lines.push('  getMetrics(): { requestCount: number; errorCount: number } {')
    lines.push('    return { requestCount: this._requestCount, errorCount: this._errorCount };')
    lines.push('  }')
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
 * Build an ESM bundle ready for deployment to Functions.do
 *
 * @param config - Bundle configuration
 * @returns Bundle result with output path and size
 */
export async function buildEsmBundle(config: BundleConfig): Promise<BundleResult> {
  try {
    await mkdir(dirname(config.outFile), { recursive: true })

    const result = await esbuild.build({
      entryPoints: [config.entryPoint],
      bundle: true,
      format: 'esm',
      target: 'es2022',
      platform: 'browser',
      outfile: config.outFile,
      minify: config.minify ?? false,
      sourcemap: config.sourcemap ? 'external' : false,
      external: config.external ?? [],
      treeShaking: true,
      metafile: true,
      ...(config.esbuildOptions as esbuild.BuildOptions),
    })

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
 * Create a Functions.do optimized bundle configuration
 *
 * @param entryPoint - Entry point file path
 * @param outputDir - Output directory
 * @param options - Additional options
 * @returns Bundle configuration
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
    external: ['cloudflare:email', 'cloudflare:sockets'],
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
 * Generate API documentation from function signatures
 *
 * @param signatures - Function signatures
 * @param options - Documentation options
 * @returns Structured API documentation
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

    const returnsTag = sig.jsdocTags?.find((t) => t.tag === 'returns' || t.tag === 'return')
    if (returnsTag) {
      entry.returns = {
        type: sig.returnType,
        description: returnsTag.description,
      }
    }

    const exampleTags = sig.jsdocTags?.filter((t) => t.tag === 'example')
    if (exampleTags && exampleTags.length > 0) {
      entry.examples = exampleTags.map((t) => t.description || '').filter(Boolean)
    }

    const deprecatedTag = sig.jsdocTags?.find((t) => t.tag === 'deprecated')
    if (deprecatedTag) {
      entry.deprecated = deprecatedTag.description || 'This function is deprecated'
    }

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
 * Generate Markdown documentation from API documentation
 *
 * @param docs - API documentation object
 * @returns Markdown string
 */
export function generateMarkdownDocs(docs: ApiDocumentation): string {
  const lines: string[] = []

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

  lines.push('### Contents')
  lines.push('')
  for (const entry of docs.entries) {
    lines.push(`- [\`${entry.name}\`](#${entry.name.toLowerCase()})`)
  }
  lines.push('')

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
// Build CLI
// ============================================================================

/**
 * Build a Functions.do project from a directory
 *
 * @param projectDir - Project directory path
 * @param options - Build options
 * @returns Build result
 */
export async function buildProject(
  projectDir: string,
  options: {
    minify?: boolean
    sourcemap?: boolean
    outputDir?: string
  } = {}
): Promise<BundleResult> {
  const outputDir = options.outputDir || join(projectDir, 'dist')
  const entryPoint = join(projectDir, 'src', 'index.ts')

  // Check if entry point exists
  try {
    await stat(entryPoint)
  } catch {
    return {
      outputPath: '',
      size: 0,
      errors: [{ message: `Entry point not found: ${entryPoint}` }],
    }
  }

  const config = createFunctionsDoConfig(entryPoint, outputDir, {
    minify: options.minify ?? true,
    sourcemap: options.sourcemap ?? true,
  })

  return buildEsmBundle(config)
}
