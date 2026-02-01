/**
 * TypeScript Type Stripping - AST-based Implementation
 *
 * Uses esbuild-wasm for proper TypeScript to JavaScript transformation.
 * This is a lightweight alternative to full TypeScript compilation that
 * correctly handles all TypeScript syntax through AST parsing.
 *
 * Handles (via esbuild):
 * - Interface declarations
 * - Type aliases (including conditional, mapped, and template literal types)
 * - Type imports and exports
 * - Parameter and return type annotations
 * - Generic type parameters
 * - Type assertions (as Type, angle brackets)
 * - Declare statements
 * - Access modifiers (public, private, protected, readonly)
 * - Non-null assertions
 * - Satisfies expressions
 * - Enums (both regular and const)
 * - Abstract classes and methods
 * - Implements/extends clauses
 * - Constructor parameter properties
 * - This parameter types
 * - Type guards and assertion functions
 * - Function overloads
 * - Namespace declarations
 *
 * @module core/ts-strip
 */

import * as esbuild from 'esbuild-wasm'

// Track initialization state
let initPromise: Promise<void> | null = null
let initialized = false

/**
 * Detect if we're running in a browser/Worker environment
 */
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.document !== 'undefined'
}

/**
 * Detect if we're running in a Cloudflare Worker environment
 */
function isCloudflareWorker(): boolean {
  return typeof globalThis !== 'undefined' &&
    'caches' in globalThis &&
    typeof (globalThis as Record<string, unknown>).WebSocketPair !== 'undefined'
}

/**
 * Initialize esbuild-wasm
 * Call this early to avoid delays on first transform
 *
 * @param wasmURL - URL to the esbuild.wasm file (required in browser/Worker, optional in Node.js)
 */
export async function initializeEsbuild(wasmURL?: string): Promise<void> {
  if (initialized) return
  if (initPromise) return initPromise

  const options: esbuild.InitializeOptions = {}

  // In browser/Worker environments, we need to provide the WASM URL
  if (isBrowser() || isCloudflareWorker()) {
    options.wasmURL = wasmURL || 'https://unpkg.com/esbuild-wasm@0.27.2/esbuild.wasm'
    // Use web workers if available (not in Cloudflare Workers)
    if (typeof Worker !== 'undefined' && !isCloudflareWorker()) {
      options.worker = true
    }
  }
  // In Node.js, esbuild-wasm can find the WASM file automatically

  initPromise = esbuild.initialize(options).then(() => {
    initialized = true
  })

  return initPromise
}

/**
 * Check if esbuild has been initialized
 */
export function isEsbuildInitialized(): boolean {
  return initialized
}

/**
 * Options for TypeScript stripping
 */
export interface StripTypeScriptOptions {
  /** Preserve JSX syntax (for TSX files) */
  preserveJsx?: boolean
  /** Target ECMAScript version (default: 'esnext') */
  target?: string
}

/**
 * Strip TypeScript type annotations from code using esbuild (async version)
 *
 * This is the recommended API for stripping TypeScript types. It uses esbuild-wasm
 * to properly parse and transform TypeScript code, handling all edge cases correctly.
 *
 * @param code - TypeScript source code
 * @param options - Optional configuration
 * @returns JavaScript code with types removed
 *
 * @example
 * ```typescript
 * const js = await stripTypeScriptAsync('const x: number = 1;')
 * // Returns: 'const x = 1;'
 * ```
 */
export async function stripTypeScriptAsync(
  code: string,
  options: StripTypeScriptOptions = {}
): Promise<string> {
  // Handle empty input
  if (!code.trim()) {
    return ''
  }

  // Ensure esbuild is initialized
  await initializeEsbuild()

  const { preserveJsx = false, target = 'esnext' } = options

  try {
    const result = await esbuild.transform(code, {
      loader: preserveJsx ? 'tsx' : 'ts',
      target,
      format: 'esm',
      // Keep `as const` by not minifying syntax
      minifySyntax: false,
      minifyWhitespace: false,
      minifyIdentifiers: false,
      // Don't generate source maps for stripping
      sourcemap: false,
      // Preserve legal comments
      legalComments: 'inline',
      // Keep original names
      keepNames: true,
    })

    // Clean up the output
    return result.code.trimEnd()
  } catch (error) {
    // If esbuild fails (syntax error), throw with context
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`TypeScript strip failed: ${message}`)
  }
}

/**
 * Strip TypeScript type annotations from code (synchronous version)
 *
 * This function maintains backward compatibility with existing code that
 * expects a synchronous API. It uses esbuild.transformSync when esbuild
 * is already initialized, otherwise falls back to a regex-based approach.
 *
 * Note: The regex fallback may not handle all TypeScript syntax correctly.
 * For best results, call initializeEsbuild() at application startup and
 * use stripTypeScriptAsync() instead.
 *
 * @param code - TypeScript source code
 * @param options - Optional configuration
 * @returns JavaScript code with types removed
 *
 * @example
 * ```typescript
 * const js = stripTypeScript('const x: number = 1;')
 * // Returns: 'const x = 1;'
 * ```
 */
export function stripTypeScript(
  code: string,
  options: StripTypeScriptOptions = {}
): string {
  // Handle empty input
  if (!code.trim()) {
    return ''
  }

  // If esbuild is initialized, use it for proper AST-based stripping
  if (initialized) {
    const { preserveJsx = false, target = 'esnext' } = options

    const result = esbuild.transformSync(code, {
      loader: preserveJsx ? 'tsx' : 'ts',
      target,
      format: 'esm',
      minifySyntax: false,
      minifyWhitespace: false,
      minifyIdentifiers: false,
      sourcemap: false,
      legalComments: 'inline',
      keepNames: true,
    })

    return result.code.trimEnd()
  }

  // Fallback to regex-based stripping for backward compatibility
  // Note: This may not handle all TypeScript syntax correctly
  return stripTypeScriptRegex(code)
}

/**
 * Regex-based TypeScript stripping (legacy fallback)
 *
 * This is the original regex-based implementation, kept as a fallback
 * when esbuild is not initialized. It handles common cases but may fail
 * on complex TypeScript syntax.
 *
 * Known limitations:
 * - Nested generic types may not be fully stripped
 * - Destructuring with type annotations may not work
 * - Abstract classes and implements clauses not handled
 * - This parameter types not removed
 *
 * @internal
 */
function stripTypeScriptRegex(code: string): string {
  let result = code

  // Remove single-line interface declarations (exported or not)
  result = result.replace(/^\s*(export\s+)?interface\s+\w+[^{]*\{[^}]*\}\s*$/gm, '')

  // Remove multi-line interface declarations (handles nested braces)
  result = result.replace(/^\s*(export\s+)?interface\s+\w+(?:\s+extends\s+[^{]+)?\s*\{[\s\S]*?\n\}\s*$/gm, '')

  // Remove type alias declarations (exported or not, with generics)
  // Handle types with intersection/union and object types (e.g., T & { id: string })
  result = result.replace(/^\s*(export\s+)?type\s+\w+\s*(<[^>]*(?:<[^>]*>[^>]*)*>)?\s*=\s*[^;]*\{[^}]*\}\s*;?\s*$/gm, '')
  // Handle types with object types containing semicolons (e.g., { data: T; error: string })
  result = result.replace(/^\s*(export\s+)?type\s+\w+\s*(<[^>]*(?:<[^>]*>[^>]*)*>)?\s*=\s*\{[^}]*\}\s*;?\s*$/gm, '')
  // Handle other type aliases (non-object types)
  result = result.replace(/^\s*(export\s+)?type\s+\w+\s*(<[^>]*(?:<[^>]*>[^>]*)*>)?\s*=\s*[^;{]+;?\s*$/gm, '')

  // Remove import type statements
  result = result.replace(/^\s*import\s+type\s+.*$/gm, '')

  // Remove inline type imports (keep non-type imports)
  result = result.replace(/,\s*type\s+\w+/g, '')
  result = result.replace(/{\s*type\s+\w+\s*,/g, '{')
  result = result.replace(/{\s*type\s+\w+\s*}/g, '{ }')

  // Remove export type statements
  result = result.replace(/^\s*export\s+type\s+\{[^}]*\}[^;]*;?\s*$/gm, '')

  // Remove declare statements (const, let, var, function, class, module, namespace, global, type, interface)
  // Handle single-line declare with nested braces (e.g., declare global { interface Window { ... } })
  result = result.replace(
    /^\s*declare\s+(const|let|var|function|class|module|namespace|global|type|interface)\s+[^;{]*\{[^}]*(?:\{[^}]*\}[^}]*)?\}\s*$/gm,
    ''
  )
  // Handle declare statements without braces (e.g., declare const VERSION: string;)
  result = result.replace(
    /^\s*declare\s+(const|let|var|function|class|module|namespace|global|type|interface)\s+[^;{]+;\s*$/gm,
    ''
  )
  // Handle multi-line declare with braces
  result = result.replace(
    /^\s*declare\s+(const|let|var|function|class|module|namespace|global|type|interface)\s+[^;{]*\{[\s\S]*?\n\}\s*$/gm,
    ''
  )

  // Remove access modifiers
  result = result.replace(/\b(public|private|protected)\s+(?=\w)/g, '')
  result = result.replace(/\breadonly\s+(?=\w)/g, '')

  // Remove generic type parameters from function declarations
  result = result.replace(/(function\s+\w*)\s*<[^>]+>/g, '$1')
  result = result.replace(/(<[A-Z][\w,\s]*(?:\s+extends\s+[^>]+)?>)(?=\s*\()/gi, '')

  // Remove generic type parameters from classes
  result = result.replace(/(class\s+\w+)\s*<[A-Z][\w,\s]*(?:\s+extends\s+[^>]+)?>/gi, '$1')

  // Remove parameter type annotations in function signatures
  // IMPORTANT: Only match inside function parameter lists, not object literals
  //
  // The type pattern must match actual TypeScript types:
  // - Primitive type keywords (string, number, boolean, etc.)
  // - PascalCase type names (start with uppercase, indicating a custom type)
  // - Object type literals { ... }
  // - Array types (Type[])
  // - Union types (Type | Type)
  // - Generic types (Type<T>)
  //
  // Key insight: In object literals like `{ a: x, b: y }`, the values (x, y) are typically
  // camelCase identifiers, not TypeScript types. Types are either keywords or PascalCase.
  // This regex only matches if the "type" portion looks like an actual type.
  result = result.replace(
    /([(,]\s*)(\w+)\s*\??\s*:\s*(\{[^}]*\}|(?:string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint|[A-Z][\w<>[\],\s|&.?]*)(?:\s*\|\s*(?:\{[^}]*\}|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint|[A-Z][\w<>[\],\s|&.?]*))*(?:\[\])?)(?=\s*[,)=])/g,
    '$1$2'
  )

  // Remove return type annotations (after closing paren, before opening brace or arrow)
  // Match pattern: `): ReturnType` where ReturnType is a type expression
  // This is safe because it requires `)` before the colon, which only occurs in function signatures
  result = result.replace(
    /\)\s*:\s*(?:\{[^}]*\}|Promise<[^>]+>|[A-Z][\w<>[\],\s|&.?]*|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint)(?:\s*\|\s*(?:\{[^}]*\}|[A-Z][\w<>[\],\s|&.?]*|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint))*\s*(?=[{=])/g,
    ') '
  )

  // Remove type assertions (as Type) - but preserve "as const"
  result = result.replace(/\s+as\s+\{[^}]+\}/g, '')
  result = result.replace(/\s+as\s+(?!const\b)[A-Z][\w<>[\],\s|&.?]*/g, '')
  result = result.replace(/\s+as\s+(?!const\b)(string|number|boolean|any|unknown|void|never|null|undefined)\b/g, '')

  // Remove angle bracket type assertions (but not JSX/TSX elements or comparisons)
  result = result.replace(/<([A-Z][\w<>[\],\s|&.?]*)>(?=\s*[\w({[])/g, '')

  // Remove non-null assertions (!) but preserve !== and !=
  result = result.replace(/(\w+)!(?!=)/g, '$1')

  // Remove satisfies expressions
  result = result.replace(/\s+satisfies\s+[A-Z][\w<>[\],\s|&.?]*/gi, '')

  // Remove variable declaration type annotations (const x: Type = value)
  // Pattern: (const|let|var) identifier: Type = value
  // Only strip if followed by = to ensure it's a type annotation, not object property
  result = result.replace(
    /(const|let|var)\s+(\w+)\s*:\s*(?:\{[^}]*\}|[A-Z][\w<>[\],\s|&.?]*|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint)(?:\s*\|\s*(?:\{[^}]*\}|[A-Z][\w<>[\],\s|&.?]*|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint))*\s*=/g,
    '$1 $2 ='
  )

  // Clean up empty imports
  result = result.replace(/^\s*import\s*\{\s*\}\s*from\s*['"][^'"]+['"];?\s*$/gm, '')

  // Clean up multiple consecutive newlines (more than 2 becomes 2)
  result = result.replace(/\n{3,}/g, '\n\n')

  // Clean up multiple spaces
  result = result.replace(/  +/g, ' ')

  return result.trim()
}

// Export the async version as the primary recommended API
export { stripTypeScriptAsync as stripTS }

// Default export for convenience
export default stripTypeScript
