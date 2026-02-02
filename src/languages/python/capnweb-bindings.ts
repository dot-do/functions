/**
 * Capnweb Bindings Generator for Python Functions
 *
 * Generates TypeScript bindings for calling Python functions via capnweb RPC.
 * This enables type-safe communication between JavaScript/TypeScript and Python
 * in the Functions.do multi-language serverless platform.
 */

/**
 * Python type extracted from source code
 */
export interface PythonType {
  /**
   * Python type name (e.g., "str", "int", "dict", "list[str]")
   */
  pythonType: string

  /**
   * Corresponding TypeScript type
   */
  tsType: string

  /**
   * Whether the type is optional (default parameter)
   */
  optional: boolean

  /**
   * Default value if specified
   */
  defaultValue?: string
}

/**
 * Parsed Python function signature
 */
export interface PythonFunction {
  /**
   * Function name
   */
  name: string

  /**
   * Function parameters
   */
  params: Array<{
    name: string
    type: PythonType
  }>

  /**
   * Return type
   */
  returnType: PythonType

  /**
   * Whether this is an async function
   */
  isAsync: boolean

  /**
   * Docstring if available
   */
  docstring?: string

  /**
   * Whether this is a method (has self parameter)
   */
  isMethod: boolean
}

/**
 * Parsed Python class (RpcTarget)
 */
export interface PythonClass {
  /**
   * Class name
   */
  name: string

  /**
   * Parent class names
   */
  bases: string[]

  /**
   * Public methods
   */
  methods: PythonFunction[]

  /**
   * Class docstring
   */
  docstring?: string
}

/**
 * Result of parsing Python source
 */
export interface ParsedPythonModule {
  /**
   * Top-level functions
   */
  functions: PythonFunction[]

  /**
   * Classes (RpcTargets)
   */
  classes: PythonClass[]

  /**
   * Module docstring
   */
  docstring?: string

  /**
   * Imports (for dependency analysis)
   */
  imports: string[]
}

/**
 * Map Python types to TypeScript types
 */
function mapPythonTypeToTS(pythonType: string): string {
  // Normalize the type string
  const normalized = pythonType.trim()

  // Handle None/null
  if (normalized === 'None' || normalized === 'NoneType') {
    return 'null'
  }

  // Handle basic types
  const basicTypes: Record<string, string> = {
    str: 'string',
    int: 'number',
    float: 'number',
    bool: 'boolean',
    bytes: 'Uint8Array',
    object: 'unknown',
    Any: 'unknown',
  }

  if (normalized in basicTypes) {
    return basicTypes[normalized]
  }

  // Handle list[T] -> T[]
  const listMatch = normalized.match(/^list\[(.+)\]$/i)
  if (listMatch) {
    return `${mapPythonTypeToTS(listMatch[1])}[]`
  }

  // Handle List[T] -> T[]
  const listMatch2 = normalized.match(/^List\[(.+)\]$/i)
  if (listMatch2) {
    return `${mapPythonTypeToTS(listMatch2[1])}[]`
  }

  // Handle dict[K, V] -> Record<K, V>
  const dictMatch = normalized.match(/^dict\[(.+),\s*(.+)\]$/i)
  if (dictMatch) {
    return `Record<${mapPythonTypeToTS(dictMatch[1])}, ${mapPythonTypeToTS(dictMatch[2])}>`
  }

  // Handle Dict[K, V] -> Record<K, V>
  const dictMatch2 = normalized.match(/^Dict\[(.+),\s*(.+)\]$/i)
  if (dictMatch2) {
    return `Record<${mapPythonTypeToTS(dictMatch2[1])}, ${mapPythonTypeToTS(dictMatch2[2])}>`
  }

  // Handle Optional[T] -> T | null
  const optionalMatch = normalized.match(/^Optional\[(.+)\]$/i)
  if (optionalMatch) {
    return `${mapPythonTypeToTS(optionalMatch[1])} | null`
  }

  // Handle Union[A, B, ...] -> A | B | ...
  const unionMatch = normalized.match(/^Union\[(.+)\]$/i)
  if (unionMatch) {
    const types = splitTypeArgs(unionMatch[1])
    return types.map(mapPythonTypeToTS).join(' | ')
  }

  // Handle tuple[A, B, ...] -> [A, B, ...]
  const tupleMatch = normalized.match(/^tuple\[(.+)\]$/i)
  if (tupleMatch) {
    const types = splitTypeArgs(tupleMatch[1])
    return `[${types.map(mapPythonTypeToTS).join(', ')}]`
  }

  // Handle Callable[[Args], Return] -> (...args: Args) => Return
  const callableMatch = normalized.match(/^Callable\[\[([^\]]*)\],\s*(.+)\]$/i)
  if (callableMatch) {
    const argTypes = callableMatch[1] ? splitTypeArgs(callableMatch[1]) : []
    const returnType = mapPythonTypeToTS(callableMatch[2])
    const params = argTypes.map((t, i) => `arg${i}: ${mapPythonTypeToTS(t)}`).join(', ')
    return `(${params}) => ${returnType}`
  }

  // Handle Awaitable[T] -> Promise<T>
  const awaitableMatch = normalized.match(/^Awaitable\[(.+)\]$/i)
  if (awaitableMatch) {
    return `Promise<${mapPythonTypeToTS(awaitableMatch[1])}>`
  }

  // Default: use the type name as-is (might be a custom type)
  return normalized
}

/**
 * Split type arguments handling nested brackets
 */
function splitTypeArgs(args: string): string[] {
  const result: string[] = []
  let current = ''
  let depth = 0

  for (const char of args) {
    if (char === '[' || char === '(') {
      depth++
      current += char
    } else if (char === ']' || char === ')') {
      depth--
      current += char
    } else if (char === ',' && depth === 0) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  if (current.trim()) {
    result.push(current.trim())
  }

  return result
}

/**
 * Parse Python type annotation string
 */
function parseTypeAnnotation(annotation: string | undefined, hasDefault: boolean): PythonType {
  if (!annotation) {
    return {
      pythonType: 'Any',
      tsType: 'unknown',
      optional: hasDefault,
    }
  }

  return {
    pythonType: annotation,
    tsType: mapPythonTypeToTS(annotation),
    optional: hasDefault,
  }
}

/**
 * Parse a Python function definition from source code
 */
function parsePythonFunction(code: string, startIndex: number): PythonFunction | null {
  // Match function definition with optional async
  const funcPattern = /^(\s*)(async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?\s*:/m
  const match = code.slice(startIndex).match(funcPattern)

  if (!match) {
    return null
  }

  const [fullMatch, indent, asyncKeyword, name, paramsStr, returnTypeStr] = match
  const isAsync = !!asyncKeyword

  // Parse parameters (bracket-aware splitting to handle types like dict[str, int])
  const params: Array<{ name: string; type: PythonType }> = []
  const paramParts = splitTypeArgs(paramsStr)

  for (const part of paramParts) {
    const trimmed = part.trim()
    if (!trimmed || trimmed === 'self' || trimmed === 'cls') {
      continue
    }

    // Handle *args and **kwargs
    if (trimmed.startsWith('*')) {
      continue
    }

    // Parse parameter: name: type = default
    const paramMatch = trimmed.match(/^(\w+)(?:\s*:\s*([^=]+))?(?:\s*=\s*(.+))?$/)
    if (paramMatch) {
      const [, paramName, typeStr, defaultVal] = paramMatch
      params.push({
        name: paramName,
        type: parseTypeAnnotation(typeStr?.trim(), !!defaultVal),
      })
    }
  }

  // Check if it's a method (first param is self)
  const isMethod = paramsStr.trim().startsWith('self') || paramsStr.trim().startsWith('cls')

  // Get docstring
  const docstringMatch = code.slice(startIndex + fullMatch.length).match(/^\s*("""[\s\S]*?"""|'''[\s\S]*?''')/)
  const docstring = docstringMatch ? docstringMatch[1].slice(3, -3).trim() : undefined

  return {
    name,
    params,
    returnType: parseTypeAnnotation(returnTypeStr?.trim(), false),
    isAsync,
    docstring,
    isMethod,
  }
}

/**
 * Parse Python source code to extract functions and classes
 */
export function parsePythonSource(code: string): ParsedPythonModule {
  const functions: PythonFunction[] = []
  const classes: PythonClass[] = []
  const imports: string[] = []

  // Extract module docstring
  const moduleDocMatch = code.match(/^("""[\s\S]*?"""|'''[\s\S]*?''')/)
  const docstring = moduleDocMatch ? moduleDocMatch[1].slice(3, -3).trim() : undefined

  // Extract imports
  const importPattern = /^(?:from\s+(\S+)\s+)?import\s+(.+)$/gm
  let importMatch
  while ((importMatch = importPattern.exec(code)) !== null) {
    const [, fromModule, importNames] = importMatch
    if (fromModule) {
      imports.push(fromModule)
    }
    for (const name of importNames.split(',')) {
      const trimmed = name.trim().split(/\s+as\s+/)[0].trim()
      if (trimmed && !trimmed.startsWith('(')) {
        imports.push(trimmed)
      }
    }
  }

  // Parse top-level functions
  const funcPattern = /^(?:async\s+)?def\s+\w+\s*\(/gm
  let funcMatch
  while ((funcMatch = funcPattern.exec(code)) !== null) {
    // Check if this is inside a class (indented)
    const lineStart = code.lastIndexOf('\n', funcMatch.index) + 1
    const indent = funcMatch.index - lineStart
    if (indent > 0) continue // Skip class methods

    const func = parsePythonFunction(code, funcMatch.index)
    if (func && !func.name.startsWith('_')) {
      functions.push(func)
    }
  }

  // Parse classes
  const classPattern = /^class\s+(\w+)(?:\(([^)]*)\))?\s*:/gm
  let classMatch
  while ((classMatch = classPattern.exec(code)) !== null) {
    const [, className, basesStr] = classMatch
    const bases = basesStr
      ? basesStr.split(',').map((b) => b.trim()).filter(Boolean)
      : []

    // Find class body
    const classStart = classMatch.index + classMatch[0].length
    const classEnd = findBlockEnd(code, classStart)
    const classBody = code.slice(classStart, classEnd)

    // Get class docstring
    const classDocMatch = classBody.match(/^\s*("""[\s\S]*?"""|'''[\s\S]*?''')/)
    const classDocstring = classDocMatch ? classDocMatch[1].slice(3, -3).trim() : undefined

    // Parse methods
    const methods: PythonFunction[] = []
    const methodPattern = /^\s+(?:async\s+)?def\s+\w+\s*\(/gm
    let methodMatch
    while ((methodMatch = methodPattern.exec(classBody)) !== null) {
      const func = parsePythonFunction(classBody, methodMatch.index)
      if (func && !func.name.startsWith('_')) {
        methods.push(func)
      }
    }

    classes.push({
      name: className,
      bases,
      methods,
      docstring: classDocstring,
    })
  }

  return { functions, classes, docstring, imports }
}

/**
 * Find the end of an indented block
 */
function findBlockEnd(code: string, start: number): number {
  const lines = code.slice(start).split('\n')
  let blockIndent: number | null = null

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue // Skip empty lines

    const indent = line.match(/^(\s*)/)?.[1].length ?? 0

    if (blockIndent === null) {
      blockIndent = indent
    } else if (indent < blockIndent) {
      // End of block found
      return start + lines.slice(0, i).join('\n').length
    }
  }

  return code.length
}

/**
 * Generate TypeScript interface for a Python function
 */
function generateFunctionInterface(func: PythonFunction): string {
  const params = func.params
    .map((p) => {
      const optional = p.type.optional ? '?' : ''
      return `${p.name}${optional}: ${p.type.tsType}`
    })
    .join(', ')

  const returnType = func.isAsync
    ? `Promise<${func.returnType.tsType}>`
    : func.returnType.tsType

  const doc = func.docstring
    ? `  /**\n   * ${func.docstring.replace(/\n/g, '\n   * ')}\n   */\n`
    : ''

  return `${doc}  ${func.name}(${params}): ${returnType};`
}

/**
 * Generate TypeScript interface for a Python class (RpcTarget)
 */
function generateClassInterface(cls: PythonClass): string {
  const methods = cls.methods.map(generateFunctionInterface).join('\n\n')

  const doc = cls.docstring
    ? `/**\n * ${cls.docstring.replace(/\n/g, '\n * ')}\n */\n`
    : ''

  const extendsClause = cls.bases.includes('RpcTarget') ? ' extends RpcTarget' : ''

  return `${doc}export interface ${cls.name}${extendsClause} {\n${methods}\n}`
}

/**
 * Generate TypeScript bindings for a Python module
 */
export function generateTypeScriptBindings(module: ParsedPythonModule): string {
  const lines: string[] = []

  // Header
  lines.push('/**')
  lines.push(' * Auto-generated TypeScript bindings for Python capnweb RPC')
  lines.push(' *')
  lines.push(' * DO NOT EDIT - Generated by functions-do')
  lines.push(' */')
  lines.push('')

  // RpcTarget base type
  lines.push('import type { RpcTarget } from "functions-do/rpc";')
  lines.push('')

  // Generate interfaces for classes
  for (const cls of module.classes) {
    if (cls.methods.length > 0) {
      lines.push(generateClassInterface(cls))
      lines.push('')
    }
  }

  // Generate interface for top-level functions
  if (module.functions.length > 0) {
    const funcs = module.functions.map(generateFunctionInterface).join('\n\n')
    lines.push('export interface ModuleFunctions {')
    lines.push(funcs)
    lines.push('}')
    lines.push('')
  }

  // Generate RPC stub type
  const rpcTargets = module.classes.filter((c) => c.bases.includes('RpcTarget'))
  if (rpcTargets.length > 0) {
    lines.push('/**')
    lines.push(' * RPC stub for calling Python functions from JavaScript')
    lines.push(' */')
    lines.push(`export type PythonRpcStub = ${rpcTargets.map((c) => c.name).join(' & ')};`)
  }

  return lines.join('\n')
}

/**
 * Generate capnweb RPC call wrapper
 */
export function generateRpcWrapper(module: ParsedPythonModule): string {
  const lines: string[] = []

  lines.push('/**')
  lines.push(' * Auto-generated capnweb RPC wrapper for Python functions')
  lines.push(' */')
  lines.push('')
  lines.push('export interface RpcCallOptions {')
  lines.push('  timeout?: number;')
  lines.push('  headers?: Record<string, string>;')
  lines.push('}')
  lines.push('')
  lines.push('export function createPythonRpcStub(')
  lines.push('  endpoint: string,')
  lines.push('  options?: RpcCallOptions')
  lines.push(') {')
  lines.push('  async function call(method: string, args: unknown[]) {')
  lines.push('    const response = await fetch(endpoint, {')
  lines.push('      method: "POST",')
  lines.push('      headers: {')
  lines.push('        "Content-Type": "application/json",')
  lines.push('        "X-Capnweb-RPC": "1",')
  lines.push('        ...options?.headers,')
  lines.push('      },')
  lines.push('      body: JSON.stringify({')
  lines.push('        method,')
  lines.push('        args,')
  lines.push('        callId: crypto.randomUUID(),')
  lines.push('      }),')
  lines.push('    });')
  lines.push('')
  lines.push('    const result = await response.json();')
  lines.push('    if (result.error) {')
  lines.push('      throw new Error(result.error);')
  lines.push('    }')
  lines.push('    return result.value;')
  lines.push('  }')
  lines.push('')

  // Generate method wrappers for each RpcTarget class
  const rpcTargets = module.classes.filter((c) => c.bases.includes('RpcTarget'))

  if (rpcTargets.length > 0) {
    lines.push('  return {')

    for (const cls of rpcTargets) {
      for (const method of cls.methods) {
        const params = method.params.map((p) => p.name).join(', ')
        const paramTypes = method.params
          .map((p) => {
            const optional = p.type.optional ? '?' : ''
            return `${p.name}${optional}: ${p.type.tsType}`
          })
          .join(', ')
        const returnType = method.isAsync
          ? `Promise<${method.returnType.tsType}>`
          : `Promise<${method.returnType.tsType}>`

        lines.push(`    async ${method.name}(${paramTypes}): ${returnType} {`)
        lines.push(`      return call("${method.name}", [${params}]);`)
        lines.push('    },')
      }
    }

    lines.push('  };')
  } else {
    lines.push('  return {};')
  }

  lines.push('}')

  return lines.join('\n')
}

/**
 * Generate both TypeScript bindings and RPC wrapper
 */
export function generateCapnwebBindings(pythonCode: string): {
  types: string
  wrapper: string
  parsed: ParsedPythonModule
} {
  const parsed = parsePythonSource(pythonCode)
  const types = generateTypeScriptBindings(parsed)
  const wrapper = generateRpcWrapper(parsed)

  return { types, wrapper, parsed }
}
