/**
 * TypeScript Type Stripping
 *
 * Provides regex-based TypeScript type annotation removal, converting
 * TypeScript code to valid JavaScript. This is a lightweight alternative
 * to full TypeScript compilation when only type stripping is needed.
 *
 * Handles:
 * - Interface declarations
 * - Type aliases
 * - Type imports and exports
 * - Parameter and return type annotations
 * - Generic type parameters
 * - Type assertions (as Type, angle brackets)
 * - Declare statements
 * - Access modifiers (public, private, protected, readonly)
 * - Non-null assertions
 * - Satisfies expressions
 */

/**
 * Strip TypeScript type annotations from code
 *
 * @param code - TypeScript source code
 * @returns JavaScript code with types removed
 */
export function stripTypeScript(code: string): string {
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

  // Remove parameter type annotations
  // Handles: simple types, object types { ... }, array types [], union types |, generic types <...>
  // Match `: Type` where Type can be various forms, followed by comma, closing paren, equals, or space
  result = result.replace(
    /([(,\s])(\w+)\s*\??\s*:\s*(?:\{[^}]*\}|[A-Z][\w<>[\],\s|&.?]*|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint)(?=\s*[,)=])/gi,
    '$1$2'
  )

  // Remove return type annotations (after closing paren, before opening brace or arrow)
  result = result.replace(
    /\)\s*:\s*(?:\{[^}]*\}|Promise<[^>]+>|[A-Z][\w<>[\],\s|&.?]*|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint)(?:\s*\|\s*(?:\{[^}]*\}|[A-Z][\w<>[\],\s|&.?]*|string|number|boolean|any|unknown|void|never|null|undefined|object|symbol|bigint))*\s*(?=[{=])/gi,
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

  // Clean up empty imports
  result = result.replace(/^\s*import\s*\{\s*\}\s*from\s*['"][^'"]+['"];?\s*$/gm, '')

  // Clean up multiple consecutive newlines (more than 2 becomes 2)
  result = result.replace(/\n{3,}/g, '\n\n')

  // Clean up multiple spaces
  result = result.replace(/  +/g, ' ')

  return result.trim()
}
