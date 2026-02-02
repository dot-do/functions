/**
 * TypeScript Compiler Service
 *
 * Provides TypeScript to JavaScript compilation using the esbuild-compiler
 * service binding with fallback to regex-based stripping for simple cases.
 *
 * Design reference: docs/ESBUILD_WASM_DESIGN.md
 *
 * ## Architecture
 *
 * This module implements a tiered compilation strategy:
 *
 * 1. **Primary**: esbuild-wasm via Service Binding (full TypeScript support)
 *    - Handles enums, decorators, namespaces, complex generics
 *    - Transform time <1ms (after initialization)
 *    - Requires ESBUILD_COMPILER service binding
 *
 * 2. **Fallback**: Regex-based stripping (fast path for simple TS)
 *    - Handles basic type annotations, interfaces, type aliases
 *    - No initialization overhead
 *    - Limited: cannot handle enums, decorators, namespaces
 *
 * ## Usage
 *
 * ```typescript
 * import { compileTypeScript, needsFullCompilation } from './ts-compiler'
 *
 * // At deploy time:
 * const result = await compileTypeScript(code, env.ESBUILD_COMPILER)
 * if (result.success) {
 *   await codeStorage.putCompiled(functionId, result.code)
 *   if (result.map) {
 *     await codeStorage.putSourceMap(functionId, result.map)
 *   }
 * }
 *
 * // At runtime:
 * const compiled = await codeStorage.getCompiled(functionId)
 * const code = compiled || stripTypeScriptRegex(source)
 * ```
 *
 * @module core/ts-compiler
 */

import { stripTypeScript } from './routing-utils'
import { createLogger, type Logger } from './logger'

// Module-level logger for TypeScript compiler
const logger: Logger = createLogger({
  level: 'warn',
  context: { component: 'ts-compiler' },
})

/**
 * Re-export EsbuildCompiler from the canonical env module.
 */
export type { EsbuildCompiler } from './env'
import type { EsbuildCompiler } from './env'

/**
 * Result from TypeScript compilation
 */
export interface CompileResult {
  /** Whether compilation was successful */
  success: boolean
  /** Compiled JavaScript code (empty string if failed) */
  code: string
  /** Source map JSON string (only if sourcemap option was true) */
  map?: string
  /** Compilation warnings */
  warnings: string[]
  /** Compilation errors (only if failed) */
  errors?: string[]
  /** Which compiler was used */
  compiler: 'esbuild' | 'regex'
}

/**
 * Options for TypeScript compilation
 */
export interface CompileOptions {
  /** Source file loader type (default: 'ts') */
  loader?: 'ts' | 'tsx' | 'js' | 'jsx'
  /** JavaScript target version (default: 'esnext') */
  target?: string
  /** Output module format (default: 'esm') */
  format?: 'esm' | 'cjs' | 'iife'
  /** JSX transform configuration */
  jsx?: { factory?: string; fragment?: string }
  /** Generate source map (default: true for deploy) */
  sourcemap?: boolean
  /** Force regex fallback even if esbuild is available */
  forceRegex?: boolean
}

/**
 * Check if code contains TypeScript features that require full compilation.
 *
 * The regex stripper cannot handle these features:
 * - Enums (require code generation, not just stripping)
 * - Decorators (require transformation)
 * - Namespaces (require code transformation)
 * - Constructor parameter properties (require `this.x = x` generation)
 *
 * The regex stripper CAN handle these features (no full compilation needed):
 * - Abstract classes and methods (stripped)
 * - Implements clauses (stripped)
 * - Generic type parameters (including nested)
 * - Function overloads (stripped)
 * - This parameter types (stripped)
 * - Tuple types in annotations (stripped)
 *
 * @param code - TypeScript source code
 * @returns true if code needs esbuild for proper compilation
 */
export function needsFullCompilation(code: string): boolean {
  // Check for enum declarations (including const enum)
  if (/\b(?:const\s+)?enum\s+\w+\s*\{/.test(code)) {
    return true
  }

  // Check for decorator usage (@decorator)
  if (/@\w+(?:\([^)]*\))?\s*(?:export\s+)?(?:class|function|async\s+function)/.test(code)) {
    return true
  }

  // Check for decorators on class members
  if (/@\w+(?:\([^)]*\))?\s*(?:public|private|protected|static|readonly|\w+\s*[:(])/.test(code)) {
    return true
  }

  // Check for namespace declarations
  if (/\bnamespace\s+\w+\s*\{/.test(code)) {
    return true
  }

  // Check for constructor parameter properties (shorthand that generates assignment code)
  // e.g., constructor(private name: string) or constructor(public readonly id: number)
  if (/constructor\s*\([^)]*\b(?:private|protected|public)\s+(?:readonly\s+)?\w+\s*:/m.test(code)) {
    return true
  }

  // Check for JSX/TSX syntax
  if (/<[A-Z][a-zA-Z0-9]*(?:\s|>|\/)/.test(code) || /<>/.test(code)) {
    return true
  }

  return false
}

/**
 * Compile TypeScript to JavaScript using esbuild-wasm service.
 *
 * Falls back to regex-based stripping if:
 * - esbuild compiler service is not available
 * - The code doesn't need full compilation (simple type stripping)
 * - forceRegex option is set
 *
 * @param code - TypeScript source code
 * @param compiler - Optional esbuild compiler service binding
 * @param options - Compilation options
 * @returns Compilation result with code, source map, and metadata
 */
export async function compileTypeScript(
  code: string,
  compiler?: EsbuildCompiler,
  options: CompileOptions = {}
): Promise<CompileResult> {
  const {
    loader = 'ts',
    target = 'esnext',
    format = 'esm',
    jsx,
    sourcemap = true,
    forceRegex = false,
  } = options

  // Fast path: empty code
  if (!code || !code.trim()) {
    return {
      success: true,
      code: '',
      warnings: [],
      compiler: 'regex',
    }
  }

  // Check if we should use regex fallback
  const useRegex = forceRegex || (!compiler && !needsFullCompilation(code))

  if (useRegex && !needsFullCompilation(code)) {
    // Use regex stripping for simple cases
    try {
      const strippedCode = stripTypeScript(code)
      return {
        success: true,
        code: strippedCode,
        warnings: [],
        compiler: 'regex',
      }
    } catch (error) {
      // If regex stripping fails, try esbuild if available
      if (!compiler) {
        return {
          success: false,
          code: '',
          warnings: [],
          errors: [error instanceof Error ? error.message : String(error)],
          compiler: 'regex',
        }
      }
    }
  }

  // Check if esbuild compiler is available
  if (!compiler) {
    // Code needs full compilation but esbuild not available
    // Try regex anyway as a last resort (may produce invalid JS)
    logger.warn('Code requires full compilation but esbuild-compiler not available, falling back to regex stripping', {
      features: 'enums/decorators/namespaces',
      fallback: 'regex',
    })
    try {
      const strippedCode = stripTypeScript(code)
      return {
        success: true,
        code: strippedCode,
        warnings: ['Code contains features that require full compilation (enums/decorators/namespaces). Regex fallback may produce invalid JavaScript.'],
        compiler: 'regex',
      }
    } catch (error) {
      return {
        success: false,
        code: '',
        warnings: [],
        errors: [
          'Code requires full compilation but esbuild-compiler service is not available.',
          error instanceof Error ? error.message : String(error),
        ],
        compiler: 'regex',
      }
    }
  }

  // Use esbuild-wasm via service binding
  try {
    // Build transform options, only including jsx if defined
    const transformOptions: {
      code: string
      loader: 'ts' | 'tsx' | 'js' | 'jsx'
      target: string
      format: 'esm' | 'cjs' | 'iife'
      jsx?: { factory?: string; fragment?: string }
      sourcemap: boolean
    } = {
      code,
      loader,
      target,
      format,
      sourcemap,
    }
    if (jsx) {
      transformOptions.jsx = jsx
    }

    const result = await compiler.transform(transformOptions)

    // Check for compilation errors
    if (result.errors && result.errors.length > 0) {
      return {
        success: false,
        code: '',
        warnings: result.warnings,
        errors: result.errors,
        compiler: 'esbuild',
      }
    }

    // Build result, only including map if defined
    const compileResult: CompileResult = {
      success: true,
      code: result.code,
      warnings: result.warnings,
      compiler: 'esbuild',
    }
    if (result.map) {
      compileResult.map = result.map
    }

    return compileResult
  } catch (error) {
    // esbuild service call failed, fall back to regex
    console.error('esbuild-compiler service error:', error)

    if (!needsFullCompilation(code)) {
      // Can fall back to regex for simple code
      try {
        const strippedCode = stripTypeScript(code)
        return {
          success: true,
          code: strippedCode,
          warnings: ['esbuild-compiler service failed, fell back to regex stripping.'],
          compiler: 'regex',
        }
      } catch (regexError) {
        return {
          success: false,
          code: '',
          warnings: [],
          errors: [
            `esbuild-compiler service error: ${error instanceof Error ? error.message : String(error)}`,
            `Regex fallback error: ${regexError instanceof Error ? regexError.message : String(regexError)}`,
          ],
          compiler: 'regex',
        }
      }
    }

    return {
      success: false,
      code: '',
      warnings: [],
      errors: [
        `esbuild-compiler service error: ${error instanceof Error ? error.message : String(error)}`,
        'Code requires full compilation (enums/decorators/namespaces) and cannot fall back to regex.',
      ],
      compiler: 'esbuild',
    }
  }
}

/**
 * Synchronous TypeScript stripping using regex.
 *
 * This is exported for use in the invoke handler where async compilation
 * at runtime is not desired. Use pre-compiled code when available instead.
 *
 * @param code - TypeScript source code
 * @returns JavaScript code with type annotations stripped
 */
export function stripTypeScriptSync(code: string): string {
  return stripTypeScript(code)
}
