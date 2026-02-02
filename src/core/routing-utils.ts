/**
 * Routing Utilities
 *
 * Utility functions for request parsing and routing in the Functions.do Worker.
 * Extracted from src/index.ts for better testability and reusability.
 */

/**
 * Strip TypeScript type annotations using regex-based parsing.
 *
 * This is a lightweight runtime solution for Cloudflare Workers where
 * WASM-based transpilers (esbuild, swc) cannot be used due to
 * "Wasm code generation disallowed" restrictions.
 *
 * Supports common TypeScript patterns:
 * - Type annotations on parameters and return types
 * - Interface and type declarations
 * - Import/export type statements
 * - Type assertions (as Type)
 * - Generic type parameters (including nested generics)
 * - Access modifiers (public, private, protected, readonly)
 * - Abstract classes and methods
 * - Implements clauses
 * - Function overload declarations
 * - This parameter types
 * - Tuple type annotations
 * - Satisfies expressions
 *
 * Limitations (require full esbuild compilation):
 * - Enums (require code generation)
 * - Decorators (require transformation)
 * - Constructor parameter properties (require assignment generation)
 * - Namespace declarations (require transformation)
 *
 * For full TypeScript support, pre-compile code before deployment.
 */
export function stripTypeScript(code: string): string {
  let result = code

  // Remove single-line interface declarations: interface Foo { ... }
  result = result.replace(/^\s*(export\s+)?interface\s+\w+[^{]*\{[^}]*\}\s*$/gm, '')

  // Remove multi-line interface declarations
  result = result.replace(/^\s*(export\s+)?interface\s+\w+[^{]*\{[\s\S]*?\n\}\s*$/gm, '')

  // Remove type alias declarations: type Foo = ...
  // Multi-line type aliases with object types
  result = result.replace(/^\s*(export\s+)?type\s+\w+\s*(<[^>]+>)?\s*=\s*\{[\s\S]*?\n\s*\}\s*;?\s*$/gm, '')
  // Single-line type aliases (including object types)
  result = result.replace(/^\s*(export\s+)?type\s+\w+\s*(<[^>]+>)?\s*=\s*[^;]+;?\s*$/gm, '')

  // Remove import type statements: import type { ... } from '...'
  result = result.replace(/^\s*import\s+type\s+.*$/gm, '')

  // Remove type-only imports: import { type Foo, Bar } -> import { Bar }
  result = result.replace(/,\s*type\s+\w+/g, '')
  result = result.replace(/{\s*type\s+\w+\s*,/g, '{')
  result = result.replace(/{\s*type\s+\w+\s*}/g, '{ }')

  // Remove export type statements: export type { ... }
  result = result.replace(/^\s*export\s+type\s+\{[^}]*\}[^;]*;?\s*$/gm, '')

  // Remove declare statements
  result = result.replace(/^\s*declare\s+(const|let|var|function|class|module|namespace|global|type|interface)\s+[^;]+;?\s*$/gm, '')

  // Remove function overload declarations (signature lines ending with ; not {)
  result = result.replace(/^\s*(?:export\s+)?(?:async\s+)?function\s+\w+\s*(?:<[^>]*>)?\s*\([^)]*\)\s*:\s*[^;{]+;\s*$/gm, '')

  // Remove access modifiers: public, private, protected, readonly
  result = result.replace(/\b(public|private|protected)\s+(?=\w)/g, '')
  result = result.replace(/\breadonly\s+(?=\w)/g, '')

  // Remove abstract keyword from classes and methods
  result = result.replace(/\babstract\s+(class\s)/g, '$1')
  result = result.replace(/^\s*abstract\s+\w+\s*\([^)]*\)\s*:\s*[^;]+;\s*$/gm, '')

  // Remove implements clause from classes
  result = result.replace(/(class\s+\w+(?:\s+extends\s+\w+(?:<[^>]*>)?)?)\s+implements\s+[\w<>,\s]+(?=\s*\{)/g, '$1')

  // Remove type assertions with inline object types: as { key: Type }
  // Must come before simpler as Type removal
  result = result.replace(/\s+as\s+\{[^}]+\}/g, '')

  // Remove type assertions: as Type (handles primitives and named types)
  // Negative lookahead for 'as const' which is valid JS-like syntax
  result = result.replace(/\s+as\s+(?!const\b)[A-Z][\w<>[\],\s|&.?]*/g, '')
  result = result.replace(/\s+as\s+(?!const\b)(string|number|boolean|any|unknown|void|never|null|undefined)\b/g, '')

  // Remove angle bracket type assertions: <Type>expression
  result = result.replace(/<([A-Z][\w<>[\],\s|&.?]*)>(?=\s*[\w({[])/g, '')

  // Remove `this` parameter type (first parameter named `this` with a type)
  result = result.replace(/\(\s*this\s*:\s*\w+\s*,\s*/g, '(')
  result = result.replace(/\(\s*this\s*:\s*\w+\s*\)/g, '()')

  // Remove type annotations from parameters: (param: Type) -> (param)
  // Only match after ( or , to avoid matching object properties like { key: value }
  // Supports tuple types in brackets [Type, Type]
  result = result.replace(/([(,])(\s*)(\w+)\s*\??\s*:\s*(\[[^\]]*\]|\{[^}]*\}|[A-Z][\w<>[\],\s|&.?]*|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint)(?=\s*[,)=])/g, '$1$2$3')

  // Remove return type annotations: ): Type { or ): Type =>
  result = result.replace(/\)\s*:\s*(\[[^\]]*\]|\{[^}]*\}|[A-Z][\w<>[\],\s|&.?]*|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint|Promise<[^>]+>)\s*(?=[{=])/g, ') ')

  // Remove generic type parameters from functions and classes
  // Use balanced bracket scanning for arbitrary nesting depth
  result = stripBalancedAngleBrackets(result, /function\s+\w+\s*</g)
  result = stripBalancedAngleBrackets(result, /class\s+\w+\s*</g)

  // Remove non-null assertions: expression! -> expression
  // Only match non-null assertions that are clearly TypeScript patterns:
  // - After closing parenthesis: foo()!
  // - After closing bracket: foo[0]!
  // - After an identifier followed by a dot, comma, semicolon, or closing paren/bracket
  // This avoids matching exclamation marks in string literals like 'Hello, World!'
  result = result.replace(/(\))\s*!/g, '$1')
  result = result.replace(/(\])\s*!/g, '$1')
  result = result.replace(/(\w+)!(?=\s*[.;,)\]])/g, '$1')

  // Remove satisfies expressions: expression satisfies Type
  result = result.replace(/\s+satisfies\s+[A-Z][\w<>[\],\s|&.?]*/gi, '')

  // Clean up empty imports: import { } from '...'
  result = result.replace(/^\s*import\s*\{\s*\}\s*from\s*['"][^'"]+['"];?\s*$/gm, '')

  // Clean up multiple consecutive newlines
  result = result.replace(/\n{3,}/g, '\n\n')

  // Clean up multiple spaces (but preserve single spaces)
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
 * @internal
 */
function stripBalancedAngleBrackets(code: string, pattern: RegExp): string {
  const matches: Array<{ angleBracketStart: number }> = []
  let m
  while ((m = pattern.exec(code)) !== null) {
    const angleBracketStart = m.index + m[0].length - 1
    matches.push({ angleBracketStart })
  }
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
      result = result.slice(0, angleBracketStart) + result.slice(j)
    }
  }
  return result
}

/**
 * Parse function ID from request.
 * Supports:
 * - URL path: /functions/:functionId or /functions/:functionId/invoke
 * - X-Function-Id header
 *
 * @param request - The incoming Request object
 * @returns The function ID or null if not found
 */
export function parseFunctionId(request: Request): string | null {
  const url = new URL(request.url)
  const pathParts = url.pathname.split('/').filter(Boolean)

  // Check for /functions/:functionId pattern
  if (pathParts[0] === 'functions' && pathParts[1]) {
    return pathParts[1]
  }

  // Fallback to X-Function-Id header
  return request.headers.get('X-Function-Id')
}

/**
 * Parse action from request path.
 * Returns 'invoke', 'info', or null for default behavior.
 *
 * @param request - The incoming Request object
 * @returns The action type or null
 */
export function parseAction(request: Request): 'invoke' | 'info' | null {
  const url = new URL(request.url)
  const pathParts = url.pathname.split('/').filter(Boolean)

  // Check for /functions/:functionId/:action pattern
  if (pathParts[0] === 'functions' && pathParts[2]) {
    const action = pathParts[2].toLowerCase()
    if (action === 'invoke') return 'invoke'
    if (action === 'info') return 'info'
  }

  return null
}

/**
 * JSON response helper.
 *
 * @param data - The data to serialize
 * @param status - HTTP status code (default: 200)
 * @returns A Response with JSON content-type
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Error response helper.
 *
 * @param message - Error message
 * @param status - HTTP status code (default: 500)
 * @returns A JSON Response with error format
 */
export function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status)
}
