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
    typeof (globalThis as Record<string, unknown>)['WebSocketPair'] !== 'undefined'
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
 * Known limitations (require full compilation via esbuild):
 * - Enums (require code generation, not just stripping)
 * - Decorators (require transformation)
 * - Constructor parameter properties (require `this.x = x` generation)
 * - Const enums (require value inlining)
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
  // Handle multi-line type aliases with object types
  result = result.replace(/^\s*(export\s+)?type\s+\w+\s*(<[^>]*(?:<[^>]*>[^>]*)*>)?\s*=\s*\{[\s\S]*?\n\s*\}\s*;?\s*$/gm, '')
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

  // Remove function overload declarations (signature lines without bodies)
  // Pattern: function-like signature ending with ; (not { which starts a body)
  // Must match: function foo(x: string): void;
  //             function foo(x: number): void;
  // But not:    function foo(x: string | number): void { ... }
  result = result.replace(/^\s*(?:export\s+)?(?:async\s+)?function\s+\w+\s*(?:<[^>]*>)?\s*\([^)]*\)\s*:\s*[^;{]+;\s*$/gm, '')

  // Remove access modifiers
  result = result.replace(/\b(public|private|protected)\s+(?=\w)/g, '')
  result = result.replace(/\breadonly\s+(?=\w)/g, '')

  // Remove abstract keyword from classes and methods
  result = result.replace(/\babstract\s+(class\s)/g, '$1')
  result = result.replace(/^\s*abstract\s+\w+\s*\([^)]*\)\s*:\s*[^;]+;\s*$/gm, '')

  // Remove implements clause from classes (keep extends)
  result = result.replace(/(class\s+\w+(?:\s+extends\s+\w+(?:<[^>]*>)?)?)\s+implements\s+[\w<>,\s]+(?=\s*\{)/g, '$1')

  // Remove generic type parameters from function declarations and classes
  // Use balanced bracket scanning to handle arbitrary nesting depth
  result = stripBalancedAngleBrackets(result, /function\s+\w+\s*</g)
  result = stripBalancedAngleBrackets(result, /class\s+\w+\s*</g)

  // Remove `this` parameter type (first parameter named `this` with a type)
  result = result.replace(/\(\s*this\s*:\s*\w+\s*,\s*/g, '(')
  result = result.replace(/\(\s*this\s*:\s*\w+\s*\)/g, '()')

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
  // - Tuple types ([Type, Type])
  //
  // Key insight: In object literals like `{ a: x, b: y }`, the values (x, y) are typically
  // camelCase identifiers, not TypeScript types. Types are either keywords or PascalCase.
  // This regex only matches if the "type" portion looks like an actual type.
  result = result.replace(
    /([(,]\s*)(\w+)\s*\??\s*:\s*(\{[^}]*\}|\[[^\]]*\]|(?:string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint|[A-Z][\w<>[\], |&.?]*)(?:\s*\|\s*(?:\{[^}]*\}|\[[^\]]*\]|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint|[A-Z][\w<>[\], |&.?]*))*(?:\[\])?)(?=\s*[,)=])/g,
    '$1$2'
  )

  // Remove return type annotations (after closing paren, before opening brace or arrow)
  // Match pattern: `): ReturnType` where ReturnType is a type expression
  // This is safe because it requires `)` before the colon, which only occurs in function signatures
  // Use balanced matching helper for nested generics like Promise<Map<string, number>>
  result = replaceReturnTypes(result)

  // Remove type assertions (as Type) - but preserve "as const"
  // IMPORTANT: Don't use \s in the type pattern as it matches newlines and can consume too much
  result = result.replace(/\s+as\s+\{[^}]+\}/g, '')
  result = result.replace(/\s+as\s+(?!const\b)[A-Z][\w<>[\], |&.?]*/g, '')
  result = result.replace(/\s+as\s+(?!const\b)(string|number|boolean|any|unknown|void|never|null|undefined)\b/g, '')

  // Remove angle bracket type assertions (but not JSX/TSX elements or comparisons)
  result = result.replace(/<([A-Z][\w<>[\], |&.?]*)>(?=\s*[\w({[])/g, '')

  // Remove non-null assertions (!) but preserve !== and !=
  // Only match non-null assertions that are clearly TypeScript patterns:
  // - After closing parenthesis: foo()!
  // - After closing bracket: foo[0]!
  // - After an identifier followed by a dot, comma, semicolon, or closing paren/bracket
  // This avoids matching exclamation marks in string literals like 'Hello, World!'
  result = result.replace(/(\))\s*!/g, '$1')
  result = result.replace(/(\])\s*!/g, '$1')
  result = result.replace(/(\w+)!(?=\s*[.;,)\]])/g, '$1')

  // Remove satisfies expressions
  result = result.replace(/\s+satisfies\s+[A-Z][\w<>[\], |&.?]*/gi, '')

  // Remove variable declaration type annotations (const x: Type = value)
  // Pattern: (const|let|var) identifier: Type = value
  // Only strip if followed by = to ensure it's a type annotation, not object property
  // Supports tuple types, nested generics, and union/intersection types
  result = result.replace(
    /(const|let|var)\s+(\w+)\s*:\s*(?:\[[^\]]*\]|\{[^}]*\}|[A-Z][\w<>[\], |&.?]*|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint)(?:\s*\|\s*(?:\[[^\]]*\]|\{[^}]*\}|[A-Z][\w<>[\], |&.?]*|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint))*\s*=/g,
    '$1 $2 ='
  )

  // Remove variable declaration type annotations without initial value (let x: Type)
  // Pattern: (let|var) identifier: Type (end of statement)
  // NOTE: const without value is invalid JS, so we only match let/var
  result = result.replace(
    /\b(let|var)\s+(\w+)\s*:\s*(?:\[[^\]]*\]|\{[^}]*\}|[A-Z][\w<>[\], |&.?]*|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint)(?:\s*\|\s*(?:\[[^\]]*\]|\{[^}]*\}|[A-Z][\w<>[\], |&.?]*|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint))*(?=\s*[;\n]|$)/gm,
    '$1 $2'
  )

  // Clean up empty imports
  result = result.replace(/^\s*import\s*\{\s*\}\s*from\s*['"][^'"]+['"];?\s*$/gm, '')

  // Clean up multiple consecutive newlines (more than 2 becomes 2)
  result = result.replace(/\n{3,}/g, '\n\n')

  // Clean up multiple spaces
  result = result.replace(/  +/g, ' ')

  return result.trim()
}

/**
 * Strip balanced angle-bracket generic type parameters from code.
 *
 * Given a pattern that matches up to the opening `<`, this function
 * scans forward to find the matching `>` (handling arbitrary nesting depth)
 * and removes the entire generic parameter section.
 *
 * @param code - Source code to process
 * @param pattern - Regex that matches the prefix up to (and including) the `<`
 * @returns Code with generic type parameters removed
 *
 * @internal
 */
function stripBalancedAngleBrackets(code: string, pattern: RegExp): string {
  // We need to find each match and process them from right to left
  // to avoid offset shifts
  const matches: Array<{ prefixEnd: number; angleBracketStart: number }> = []
  let m
  while ((m = pattern.exec(code)) !== null) {
    // The match ends with `<`, so the angle bracket start is at the end of the match - 1
    const angleBracketStart = m.index + m[0].length - 1
    matches.push({
      prefixEnd: angleBracketStart,
      angleBracketStart,
    })
  }

  // Process from right to left so indices stay valid
  let result = code
  for (let i = matches.length - 1; i >= 0; i--) {
    const { angleBracketStart } = matches[i]
    let depth = 1
    let j = angleBracketStart + 1
    while (j < result.length && depth > 0) {
      if (result[j] === '<') depth++
      else if (result[j] === '>') depth--
      j++
    }
    if (depth === 0) {
      // Remove from angleBracketStart to j (exclusive)
      result = result.slice(0, angleBracketStart) + result.slice(j)
    }
  }
  return result
}

/**
 * Replace return type annotations using a scanning approach
 * to handle nested generics like Promise<Map<string, number>>.
 *
 * Scans for `): ` pattern and then balances angle brackets to find
 * the end of the type annotation.
 *
 * @internal
 */
function replaceReturnTypes(code: string): string {
  // Simple cases first - primitive return types
  const primitives = 'string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint'
  const simplePrimitive = new RegExp(
    `\\)\\s*:\\s*(?:${primitives})(?:\\s*\\|\\s*(?:${primitives}))*\\s*(?=[{=])`,
    'g'
  )
  code = code.replace(simplePrimitive, ') ')

  // Object type return annotations: ): { ... } {
  code = code.replace(/\)\s*:\s*\{[^}]*\}\s*(?=[{=])/g, ') ')

  // For generic return types, use a scanning approach to handle nesting
  // Match ): <identifier>< and then balance the angle brackets
  let output = ''
  let i = 0
  while (i < code.length) {
    // Look for `): ` pattern
    if (code[i] === ')') {
      const afterParen = code.slice(i + 1)
      const colonMatch = afterParen.match(/^(\s*:\s*)/)
      if (colonMatch) {
        const colonEnd = i + 1 + colonMatch[0].length
        const afterColon = code.slice(colonEnd)
        // Check if what follows looks like a type (PascalCase identifier or primitive)
        const typeStart = afterColon.match(/^([A-Z]\w*)/)
        if (typeStart) {
          const typeNameEnd = colonEnd + typeStart[0].length
          // Check if followed by < (generic)
          if (code[typeNameEnd] === '<') {
            // Balance angle brackets
            let depth = 1
            let j = typeNameEnd + 1
            while (j < code.length && depth > 0) {
              if (code[j] === '<') depth++
              else if (code[j] === '>') depth--
              j++
            }
            // After the generic, check for array suffix and union types
            while (j < code.length && (code[j] === '[' || code[j] === ']')) j++
            // Skip whitespace and check for union
            const afterType = code.slice(j)
            const unionMatch = afterType.match(/^(\s*\|\s*)/)
            if (unionMatch) {
              // There is a union - skip union members too (simplified: skip to { or =)
              const unionRest = code.slice(j + unionMatch[0].length)
              const endMatch = unionRest.match(/^[^{=]*/)
              if (endMatch) {
                j = j + unionMatch[0].length + endMatch[0].length
              }
            }
            // Check that what follows is { or = (confirms this is a return type annotation)
            const remainder = code.slice(j)
            const trailingWs = remainder.match(/^\s*/)
            const wsLen = trailingWs ? trailingWs[0].length : 0
            if (j + wsLen < code.length && (code[j + wsLen] === '{' || code[j + wsLen] === '=')) {
              output += ') '
              i = j + wsLen
              continue
            }
          }
          // Non-generic PascalCase type - handle with union types
          else {
            let j = typeNameEnd
            // Check for array suffix
            while (j < code.length && (code[j] === '[' || code[j] === ']')) j++
            // Check for union
            const afterType = code.slice(j)
            const unionMatch = afterType.match(/^(\s*\|\s*(?:[A-Z]\w*|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint)(?:\[[^\]]*\])?)/)
            if (unionMatch) {
              j += unionMatch[0].length
            }
            const remainder = code.slice(j)
            const trailingWs = remainder.match(/^\s*/)
            const wsLen = trailingWs ? trailingWs[0].length : 0
            if (j + wsLen < code.length && (code[j + wsLen] === '{' || code[j + wsLen] === '=')) {
              output += ') '
              i = j + wsLen
              continue
            }
          }
        }
      }
    }
    output += code[i]
    i++
  }
  return output
}

// Export the async version as the primary recommended API
export { stripTypeScriptAsync as stripTS }

// Default export for convenience
export default stripTypeScript
