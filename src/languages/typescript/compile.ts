/**
 * TypeScript to ESM Compilation
 *
 * Uses esbuild to transform TypeScript code into valid ESM format.
 * - Removes TypeScript type annotations
 * - Generates source maps
 * - Preserves async/await (targets ES2022+)
 * - Outputs ESM format (not CommonJS)
 *
 * @module typescript/compile
 */

import * as esbuild from 'esbuild'
import { writeFile, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createLogger } from '../../core/logger'

const logger = createLogger({ context: { component: 'ts-compile' } })

// Re-export SDK compiler utilities for convenience
export {
  // Function signature extraction
  extractFunctionSignatures,
  extractTypes,
  // Type definition generation
  generateTypeDefinitions,
  generateTypesFromSource,
  generateComprehensiveTypes,
  // capnweb RPC bindings generation
  generateRpcBindings,
  generateRpcStub,
  generateEnhancedRpcTarget,
  // ESM bundle production
  buildEsmBundle,
  createFunctionsDoConfig,
  // Documentation generation
  generateApiDocumentation,
  generateMarkdownDocs,
  // Types
  type FunctionSignature,
  type FunctionParameter,
  type JsDocTag,
  type TypeDefinitionResult,
  type RpcBindingsResult,
  type BundleConfig,
  type BundleResult,
  type ApiDocEntry,
  type ApiDocumentation,
  type ExtractedType,
  type RpcStubConfig,
  type RpcStubResult,
} from './sdk-compiler'

export interface CompileResult {
  code: string
  map?: unknown
  errors?: Array<{ message: string; location?: unknown }>
}

/**
 * Post-process esbuild output to restore `export default` syntax.
 * esbuild converts `export default x` to `var stdin_default = x; export { stdin_default as default };`
 * This function converts it back for cleaner output.
 */
function restoreExportDefault(code: string): string {
  // Match pattern: var <name> = <value>;\nexport {\n  <name> as default\n};
  // and convert to: export default <value>;
  const pattern = /var\s+(\w+_default)\s+=\s+([\s\S]+?);\nexport\s+\{\s+\1\s+as\s+default\s+\};/g

  return code.replace(pattern, (match, varName, value) => {
    return `export default ${value.trim()};`
  })
}

/**
 * Compiles TypeScript code to ESM using esbuild
 */
export async function compileTypeScript(code: string): Promise<CompileResult> {
  // Create a temporary directory for esbuild to process
  const tempDir = join(tmpdir(), `functions-do-compile-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const tempFile = join(tempDir, 'input.ts')

  try {
    await mkdir(tempDir, { recursive: true })
    await writeFile(tempFile, code)

    const result = await esbuild.build({
      entryPoints: [tempFile],
      bundle: false,
      write: false,
      format: 'esm',
      target: 'es2022',
      sourcemap: 'external',
      minify: false,
      outdir: tempDir,
    })

    // Clean up temp directory
    await rm(tempDir, { recursive: true }).catch((err) => {
      logger.warn('Cleanup failed', { error: err })
    })

    const outputFile = result.outputFiles?.find((f) => f.path.endsWith('.js'))
    const mapFile = result.outputFiles?.find((f) => f.path.endsWith('.js.map'))

    // Remove the sourceMappingURL comment from the code since we return the map separately
    let outputCode = outputFile?.text || ''
    outputCode = outputCode.replace(/\/\/# sourceMappingURL=.*\n?$/, '')

    // Restore export default syntax for cleaner output
    outputCode = restoreExportDefault(outputCode)

    return {
      code: outputCode,
      map: mapFile?.text ? JSON.parse(mapFile.text) : undefined,
    }
  } catch (error) {
    // Clean up temp directory on error
    await rm(tempDir, { recursive: true }).catch((err) => {
      logger.warn('Cleanup failed', { error: err })
    })

    // esbuild throws errors with a messages array for syntax errors
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

    // For other errors, wrap them
    return {
      code: '',
      errors: [{ message: error instanceof Error ? error.message : String(error) }],
    }
  }
}
