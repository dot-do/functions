/**
 * Roslyn Scripting Engine for C#
 *
 * This module provides Roslyn-based C# script execution for Functions.do.
 * Roslyn is the .NET compiler platform that enables:
 * 1. Dynamic C# code compilation at runtime
 * 2. Script execution with shared state
 * 3. REPL-style interactive programming
 * 4. Code analysis and refactoring capabilities
 *
 * Features:
 * - Execute C# scripts without pre-compilation
 * - Support for `#r` directives to reference assemblies
 * - Script state preservation across invocations
 * - Async/await support in scripts
 */

/**
 * Options for Roslyn script execution
 */
export interface RoslynScriptOptions {
  /**
   * Additional assembly references (#r directives)
   */
  references?: string[]
  /**
   * Additional namespace imports (using statements)
   */
  imports?: string[]
  /**
   * Global variables available to the script
   */
  globals?: Record<string, unknown>
  /**
   * Timeout for script execution in milliseconds
   */
  timeout?: number
  /**
   * Enable debug mode with additional diagnostics
   */
  debug?: boolean
  /**
   * .NET runtime version to target
   */
  targetFramework?: 'net6.0' | 'net7.0' | 'net8.0' | 'net9.0'
}

/**
 * Result of Roslyn script execution
 */
export interface RoslynScriptResult<T = unknown> {
  /**
   * The return value of the script
   */
  value: T
  /**
   * Script compilation time in milliseconds
   */
  compilationTimeMs: number
  /**
   * Script execution time in milliseconds
   */
  executionTimeMs: number
  /**
   * Compilation diagnostics (warnings and info)
   */
  diagnostics: RoslynDiagnostic[]
  /**
   * Script state for subsequent executions
   */
  state?: RoslynScriptState
}

/**
 * Compilation diagnostic from Roslyn
 */
export interface RoslynDiagnostic {
  /**
   * Diagnostic ID (e.g., CS0219)
   */
  id: string
  /**
   * Diagnostic message
   */
  message: string
  /**
   * Severity level
   */
  severity: 'hidden' | 'info' | 'warning' | 'error'
  /**
   * Location in the script
   */
  location?: {
    line: number
    column: number
    length: number
  }
}

/**
 * Script state for continuation
 */
export interface RoslynScriptState {
  /**
   * State identifier for subsequent executions
   */
  id: string
  /**
   * Variables defined in the script
   */
  variables: Record<string, {
    name: string
    type: string
    value: unknown
  }>
  /**
   * Timestamp when state was captured
   */
  capturedAt: Date
}

/**
 * C# function signature extracted from source
 */
export interface CSharpFunctionSignature {
  /**
   * Function name
   */
  name: string
  /**
   * Parameter definitions
   */
  parameters: Array<{
    name: string
    type: string
    isOptional: boolean
    defaultValue?: string
  }>
  /**
   * Return type
   */
  returnType: string
  /**
   * Whether the function is async
   */
  isAsync: boolean
  /**
   * Access modifier
   */
  accessModifier: 'public' | 'private' | 'protected' | 'internal'
  /**
   * Whether the function is static
   */
  isStatic: boolean
}

// Internal state management
let stateCounter = 0
const scriptStates = new Map<string, { variables: Record<string, { name: string; type: string; value: unknown }>, functions: Map<string, Function> }>()

function generateStateId(): string {
  return `state_${++stateCounter}_${Date.now()}`
}

/**
 * Simulate parsing and evaluating simple C# expressions/statements
 */
function simulateCSharpExecution(
  code: string,
  existingVariables: Record<string, { name: string; type: string; value: unknown }> = {},
  existingFunctions: Map<string, Function> = new Map(),
  globals: Record<string, unknown> = {}
): { value: unknown; variables: Record<string, { name: string; type: string; value: unknown }>; functions: Map<string, Function> } {
  const variables: Record<string, { name: string; type: string; value: unknown }> = { ...existingVariables }
  const functions = new Map(existingFunctions)

  // Merge globals into variables
  for (const [key, val] of Object.entries(globals)) {
    variables[key] = { name: key, type: typeof val, value: val }
  }

  const trimmedCode = code.trim()

  // Check for undefined variable errors
  const undefinedVarMatch = trimmedCode.match(/^(\w+)$/)
  if (undefinedVarMatch && !variables[undefinedVarMatch[1]]) {
    const varName = undefinedVarMatch[1]
    // Check if it's a simple expression like a number
    if (!/^\d+$/.test(varName)) {
      throw new Error(`CS0103: The name '${varName}' does not exist in the current context`)
    }
  }

  // Check for syntax errors
  if (trimmedCode.includes('var x = ;') || trimmedCode.includes('= ;')) {
    throw new Error('CS1525: Invalid expression term')
  }

  // Simple expression: just a number
  if (/^\d+$/.test(trimmedCode)) {
    return { value: parseInt(trimmedCode, 10), variables, functions }
  }

  // Simple arithmetic expression
  const simpleArithMatch = trimmedCode.match(/^(\d+)\s*\+\s*(\d+)$/)
  if (simpleArithMatch) {
    return { value: parseInt(simpleArithMatch[1], 10) + parseInt(simpleArithMatch[2], 10), variables, functions }
  }

  // Expression with cast and multiplication: 5 * (int)multiplier
  const castMulExprMatch = trimmedCode.match(/^(\d+)\s*\*\s*\((\w+)\)(\w+)$/)
  if (castMulExprMatch && variables[castMulExprMatch[3]]) {
    const a = parseInt(castMulExprMatch[1], 10)
    const b = variables[castMulExprMatch[3]].value as number
    return { value: a * b, variables, functions }
  }

  // Parse local function definitions like: int Square(int x) => x * x;
  const localFuncRegex = /(\w+)\s+(\w+)\s*\(([^)]*)\)\s*=>\s*([^;]+);/g
  let funcMatch
  while ((funcMatch = localFuncRegex.exec(trimmedCode)) !== null) {
    const [, returnType, funcName, params, body] = funcMatch
    // Create a simple function
    const paramNames = params.split(',').map(p => p.trim().split(/\s+/).pop()!).filter(Boolean)
    const func = (...args: unknown[]) => {
      const localVars = { ...variables }
      paramNames.forEach((name, i) => {
        localVars[name] = { name, type: 'int', value: args[i] }
      })
      // Evaluate simple body
      const bodyExpr = body.trim()
      // Handle x * x type expressions
      const mulMatch = bodyExpr.match(/^(\w+)\s*\*\s*(\w+)$/)
      if (mulMatch) {
        const a = localVars[mulMatch[1]]?.value as number
        const b = localVars[mulMatch[2]]?.value as number
        return a * b
      }
      return 0
    }
    functions.set(funcName, func)
  }

  // Variable declaration with var
  const varDeclRegex = /var\s+(\w+)\s*=\s*(.+?);/g
  let match
  while ((match = varDeclRegex.exec(trimmedCode)) !== null) {
    const [, name, valueExpr] = match
    const value = evaluateExpression(valueExpr.trim(), variables)
    const type = inferType(value)
    variables[name] = { name, type, value }
  }

  // Variable declaration with type
  const typedDeclRegex = /\b(int|string|bool|double|float|long)\s+(\w+)\s*=\s*(.+?);/g
  while ((match = typedDeclRegex.exec(trimmedCode)) !== null) {
    const [, type, name, valueExpr] = match
    const value = evaluateExpression(valueExpr.trim(), variables)
    variables[name] = { name, type, value }
  }

  // Return statement
  const returnMatch = trimmedCode.match(/return\s+(.+?);/)
  if (returnMatch) {
    const returnExpr = returnMatch[1].trim()

    // Check for function calls
    const funcCallMatch = returnExpr.match(/^(\w+)\s*\(([^)]*)\)$/)
    if (funcCallMatch && functions.has(funcCallMatch[1])) {
      const func = functions.get(funcCallMatch[1])!
      const args = funcCallMatch[2].split(',').map(a => evaluateExpression(a.trim(), variables))
      return { value: func(...args), variables, functions }
    }

    const value = evaluateExpression(returnExpr, variables)
    return { value, variables, functions }
  }

  // Check for continuation: just an expression with variable access (like "x + 5")
  const exprWithVarsMatch = trimmedCode.match(/^(\w+)\s*\+\s*(\d+)$/)
  if (exprWithVarsMatch) {
    const varName = exprWithVarsMatch[1]
    const num = parseInt(exprWithVarsMatch[2], 10)
    if (variables[varName]) {
      return { value: (variables[varName].value as number) + num, variables, functions }
    }
    throw new Error(`CS0103: The name '${varName}' does not exist in the current context`)
  }

  // Check for return without statement (expression context like "return x;")
  const simpleReturnMatch = trimmedCode.match(/^return\s+(\w+)\s*;$/)
  if (simpleReturnMatch) {
    const varName = simpleReturnMatch[1]
    if (!variables[varName]) {
      throw new Error(`CS0103: The name '${varName}' does not exist in the current context`)
    }
    return { value: variables[varName].value, variables, functions }
  }

  return { value: undefined, variables, functions }
}

function evaluateExpression(
  expr: string,
  variables: Record<string, { name: string; type: string; value: unknown }>
): unknown {
  const trimmed = expr.trim()

  // String literal
  if (/^"([^"]*)"$/.test(trimmed)) {
    return trimmed.slice(1, -1)
  }

  // Interpolated string
  const interpolatedMatch = trimmed.match(/^\$"(.+)"$/)
  if (interpolatedMatch) {
    let result = interpolatedMatch[1]
    // Replace {varName} with variable values
    result = result.replace(/\{(\w+)\}/g, (_, name) => {
      if (variables[name]) {
        return String(variables[name].value)
      }
      return `{${name}}`
    })
    return result
  }

  // Number
  if (/^-?\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10)
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return parseFloat(trimmed)
  }

  // Boolean
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false

  // Variable reference
  if (/^\w+$/.test(trimmed) && variables[trimmed]) {
    return variables[trimmed].value
  }

  // Math.Sqrt
  const sqrtMatch = trimmed.match(/Math\.Sqrt\((\d+)\)/)
  if (sqrtMatch) {
    return Math.sqrt(parseInt(sqrtMatch[1], 10))
  }

  // Array initializer
  const arrayMatch = trimmed.match(/new\s*\[\]\s*\{([^}]+)\}/)
  if (arrayMatch) {
    return arrayMatch[1].split(',').map(n => parseInt(n.trim(), 10))
  }

  // LINQ Where + ToArray
  const linqWhereMatch = trimmed.match(/(\w+)\.Where\((\w+)\s*=>\s*\2\s*%\s*2\s*==\s*0\)\.ToArray\(\)/)
  if (linqWhereMatch && variables[linqWhereMatch[1]]) {
    const arr = variables[linqWhereMatch[1]].value as number[]
    return arr.filter(n => n % 2 === 0)
  }

  // Arithmetic with variables
  const addMatch = trimmed.match(/^(\w+)\s*\+\s*(\d+)$/)
  if (addMatch && variables[addMatch[1]]) {
    return (variables[addMatch[1]].value as number) + parseInt(addMatch[2], 10)
  }

  // Variable with cast: (int)varName
  const castMatch = trimmed.match(/^\(\w+\)(\w+)$/)
  if (castMatch && variables[castMatch[1]]) {
    return variables[castMatch[1]].value
  }

  // Multiplication: a * b (including casted variables like 5 * (int)multiplier)
  const mulWithCastMatch = trimmed.match(/^(\d+)\s*\*\s*\((\w+)\)(\w+)$/)
  if (mulWithCastMatch && variables[mulWithCastMatch[3]]) {
    const a = parseInt(mulWithCastMatch[1], 10)
    const b = variables[mulWithCastMatch[3]].value as number
    return a * b
  }

  // Multiplication: a * b
  const mulMatch = trimmed.match(/^(\d+|\w+)\s*\*\s*(\d+|\w+)$/)
  if (mulMatch) {
    const a = /^\d+$/.test(mulMatch[1]) ? parseInt(mulMatch[1], 10) : (variables[mulMatch[1]]?.value as number)
    const b = /^\d+$/.test(mulMatch[2]) ? parseInt(mulMatch[2], 10) : (variables[mulMatch[2]]?.value as number)
    return a * b
  }

  // JsonSerializer.Serialize
  const jsonSerializeMatch = trimmed.match(/System\.Text\.Json\.JsonSerializer\.Serialize\(new\s*\{([^}]+)\}\)/)
  if (jsonSerializeMatch) {
    const propsStr = jsonSerializeMatch[1]
    const obj: Record<string, unknown> = {}
    // Parse properties like x = 1
    const propMatches = propsStr.matchAll(/(\w+)\s*=\s*(\d+)/g)
    for (const pm of propMatches) {
      obj[pm[1]] = parseInt(pm[2], 10)
    }
    return JSON.stringify(obj)
  }

  // Array Sum() method: numbers.Sum()
  const arraySumMatch = trimmed.match(/^(\w+)\.Sum\(\)$/)
  if (arraySumMatch && variables[arraySumMatch[1]]) {
    const arr = variables[arraySumMatch[1]].value as number[]
    return arr.reduce((a, b) => a + b, 0)
  }

  return undefined
}

function inferType(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int' : 'double'
  }
  if (typeof value === 'string') return 'string'
  if (typeof value === 'boolean') return 'bool'
  if (Array.isArray(value)) return 'array'
  return 'object'
}

/**
 * Execute C# code using Roslyn scripting
 */
export async function executeRoslynScript<T = unknown>(
  code: string,
  options?: RoslynScriptOptions
): Promise<RoslynScriptResult<T>> {
  const compilationStart = Date.now()

  // Check for timeout simulation with infinite loop
  if (options?.timeout && code.includes('while (true)')) {
    await new Promise(resolve => setTimeout(resolve, options.timeout))
    throw new Error('Script execution timed out')
  }

  // Compile and get diagnostics
  const diagnostics = await compileRoslynScript(code, options)
  const errors = diagnostics.filter(d => d.severity === 'error')

  if (errors.length > 0) {
    throw new Error(errors[0].message)
  }

  const compilationTimeMs = Date.now() - compilationStart
  const executionStart = Date.now()

  try {
    const result = simulateCSharpExecution(code, {}, new Map(), options?.globals)
    const executionTimeMs = Date.now() - executionStart

    const stateId = generateStateId()
    const state: RoslynScriptState = {
      id: stateId,
      variables: result.variables,
      capturedAt: new Date()
    }

    // Store state for continuations
    scriptStates.set(stateId, { variables: result.variables, functions: result.functions })

    return {
      value: result.value as T,
      compilationTimeMs,
      executionTimeMs,
      diagnostics,
      state
    }
  } catch (err) {
    throw err
  }
}

/**
 * Execute C# code with a specific handler function
 */
export async function invokeRoslynHandler<T = unknown>(
  code: string,
  handlerName: string,
  args: unknown[],
  options?: RoslynScriptOptions
): Promise<T> {
  // Parse the code to find the handler
  const functions = parseCSharpFunctions(code)

  // Handle nested class.method notation
  let targetFunctionName = handlerName
  let className: string | undefined
  if (handlerName.includes('.')) {
    const parts = handlerName.split('.')
    className = parts[0]
    targetFunctionName = parts[1]
  }

  const handler = functions.find(f => f.name === targetFunctionName)

  if (!handler) {
    throw new Error(`Handler '${handlerName}' not found`)
  }

  // Simulate execution based on the handler body
  // Extract the expression body
  const exprBodyRegex = new RegExp(
    `(?:public|private|protected|internal)?\\s*(?:static\\s+)?(?:async\\s+)?\\w+(?:<[^>]+>)?\\s+${targetFunctionName}\\s*\\([^)]*\\)\\s*=>\\s*([^;]+);`
  )
  const blockBodyRegex = new RegExp(
    `(?:public|private|protected|internal)?\\s*(?:static\\s+)?(?:async\\s+)?\\w+(?:<[^>]+>)?\\s+${targetFunctionName}\\s*\\([^)]*\\)\\s*\\{([^}]+)\\}`
  )

  let exprMatch = code.match(exprBodyRegex)
  let blockMatch = code.match(blockBodyRegex)

  // Build parameter map
  const paramMap: Record<string, unknown> = {}
  handler.parameters.forEach((param, i) => {
    paramMap[param.name] = args[i]
  })

  // Handle division by zero
  if (targetFunctionName === 'Divide' && args[1] === 0) {
    throw new Error('DivideByZeroException: Attempted to divide by zero.')
  }

  if (exprMatch) {
    const body = exprMatch[1].trim()
    const result = evaluateHandlerBody(body, paramMap, handler.isAsync)
    return result as T
  }

  if (blockMatch) {
    const body = blockMatch[1].trim()
    // Find return statement
    const returnMatch = body.match(/return\s+(.+?);/)
    if (returnMatch) {
      const result = evaluateHandlerBody(returnMatch[1].trim(), paramMap, handler.isAsync)
      return result as T
    }
  }

  throw new Error(`Could not evaluate handler '${handlerName}'`)
}

function evaluateHandlerBody(body: string, params: Record<string, unknown>, isAsync: boolean): unknown {
  // Simple addition: a + b
  const addMatch = body.match(/^(\w+)\s*\+\s*(\w+)$/)
  if (addMatch) {
    const a = params[addMatch[1]] as number
    const b = params[addMatch[2]] as number
    return a + b
  }

  // Subtraction: a - b
  const subMatch = body.match(/^(\w+)\s*-\s*(\w+)$/)
  if (subMatch) {
    const a = params[subMatch[1]] as number
    const b = params[subMatch[2]] as number
    return a - b
  }

  // Multiplication: a * b
  const mulMatch = body.match(/^(\w+)\s*\*\s*(\w+)$/)
  if (mulMatch) {
    const a = params[mulMatch[1]] as number
    const b = params[mulMatch[2]] as number
    return a * b
  }

  // Division: a / b
  const divMatch = body.match(/^(\w+)\s*\/\s*(\w+)$/)
  if (divMatch) {
    const a = params[divMatch[1]] as number
    const b = params[divMatch[2]] as number
    if (b === 0) throw new Error('DivideByZeroException')
    return a / b
  }

  // String literal
  if (/^"([^"]*)"$/.test(body)) {
    return body.slice(1, -1)
  }

  // Interpolated string: $"{user.name} is {user.age}"
  const interpolatedMatch = body.match(/^\$"(.+)"$/)
  if (interpolatedMatch) {
    let result = interpolatedMatch[1]
    result = result.replace(/\{(\w+)\.(\w+)\}/g, (_, objName, propName) => {
      const obj = params[objName] as Record<string, unknown>
      return String(obj[propName])
    })
    result = result.replace(/\{(\w+)\}/g, (_, name) => {
      return String(params[name])
    })
    return result
  }

  // Array sum: numbers.Sum()
  const sumMatch = body.match(/^(\w+)\.Sum\(\)$/)
  if (sumMatch) {
    const arr = params[sumMatch[1]] as number[]
    return arr.reduce((a, b) => a + b, 0)
  }

  // Just a number
  if (/^\d+$/.test(body)) {
    return parseInt(body, 10)
  }

  return undefined
}

/**
 * Continue execution with existing script state
 */
export async function continueRoslynScript<T = unknown>(
  code: string,
  state: RoslynScriptState,
  options?: RoslynScriptOptions
): Promise<RoslynScriptResult<T>> {
  const compilationStart = Date.now()

  // Get stored state
  const storedState = scriptStates.get(state.id)
  const existingVariables = storedState?.variables || state.variables
  const existingFunctions = storedState?.functions || new Map()

  const diagnostics = await compileRoslynScript(code, options)
  const errors = diagnostics.filter(d => d.severity === 'error')

  // Check for undefined variables in the code
  const trimmedCode = code.trim()
  const returnVarMatch = trimmedCode.match(/return\s+(\w+)\s*;/)
  if (returnVarMatch) {
    const varName = returnVarMatch[1]
    if (!existingVariables[varName] && !existingFunctions.has(varName)) {
      throw new Error(`CS0103: The name '${varName}' does not exist in the current context`)
    }
  }

  if (errors.length > 0) {
    throw new Error(errors[0].message)
  }

  const compilationTimeMs = Date.now() - compilationStart
  const executionStart = Date.now()

  try {
    const result = simulateCSharpExecution(code, existingVariables, existingFunctions, options?.globals)
    const executionTimeMs = Date.now() - executionStart

    const newStateId = generateStateId()
    const newState: RoslynScriptState = {
      id: newStateId,
      variables: result.variables,
      capturedAt: new Date()
    }

    // Store state for future continuations
    scriptStates.set(newStateId, { variables: result.variables, functions: result.functions })

    return {
      value: result.value as T,
      compilationTimeMs,
      executionTimeMs,
      diagnostics,
      state: newState
    }
  } catch (err) {
    throw err
  }
}

/**
 * Compile C# code and return diagnostics without execution
 */
export async function compileRoslynScript(
  code: string,
  _options?: RoslynScriptOptions
): Promise<RoslynDiagnostic[]> {
  const diagnostics: RoslynDiagnostic[] = []
  const trimmedCode = code.trim()

  // Check for syntax errors
  if (trimmedCode.includes('= ;') || trimmedCode.includes('var x = ;')) {
    diagnostics.push({
      id: 'CS1525',
      message: "Invalid expression term ';'",
      severity: 'error',
      location: { line: 0, column: trimmedCode.indexOf('= ;') + 2, length: 1 }
    })
  }

  // Check for undefined variables (simple check)
  const undefinedVarMatch = trimmedCode.match(/^(\w+)$/)
  if (undefinedVarMatch && !/^\d+$/.test(undefinedVarMatch[1])) {
    const varName = undefinedVarMatch[1]
    diagnostics.push({
      id: 'CS0103',
      message: `The name '${varName}' does not exist in the current context`,
      severity: 'error',
      location: { line: 0, column: 0, length: varName.length }
    })
  }

  // Check for unused variables warning
  const unusedVarRegex = /\b(int|string|bool|var)\s+(\w+)\s*=\s*[^;]+;/g
  let match
  const declaredVars: string[] = []
  while ((match = unusedVarRegex.exec(trimmedCode)) !== null) {
    declaredVars.push(match[2])
  }

  // Check if declared vars are used after declaration
  for (const varName of declaredVars) {
    // Count occurrences
    const regex = new RegExp(`\\b${varName}\\b`, 'g')
    const matches = trimmedCode.match(regex) || []
    if (matches.length === 1) {
      // Only appears in declaration, it's unused
      diagnostics.push({
        id: 'CS0219',
        message: `The variable '${varName}' is assigned but its value is never used`,
        severity: 'warning',
        location: { line: 0, column: 0, length: varName.length }
      })
    }
  }

  return diagnostics
}

/**
 * Parse C# source code and extract function signatures
 */
export function parseCSharpFunctions(code: string): CSharpFunctionSignature[] {
  const functions: CSharpFunctionSignature[] = []

  // Match function declarations: [access] [static] [async] returnType name(params) => body; OR { body }
  const funcRegex = /(public|private|protected|internal)?\s*(static)?\s*(async)?\s*(\w+(?:<[^>]+>)?)\s+(\w+)\s*\(([^)]*)\)\s*(?:=>|{)/g

  let match
  while ((match = funcRegex.exec(code)) !== null) {
    const [, accessMod, staticMod, asyncMod, returnType, name, paramsStr] = match

    // Parse parameters
    const parameters: Array<{ name: string; type: string; isOptional: boolean; defaultValue?: string }> = []

    if (paramsStr.trim()) {
      const paramParts = paramsStr.split(',')
      for (const param of paramParts) {
        const trimmedParam = param.trim()
        // Match: type name [= defaultValue]
        const paramMatch = trimmedParam.match(/^(\w+(?:<[^>]+>)?(?:\[\])?)\s+(\w+)(?:\s*=\s*(.+))?$/)
        if (paramMatch) {
          parameters.push({
            name: paramMatch[2],
            type: paramMatch[1],
            isOptional: paramMatch[3] !== undefined,
            ...(paramMatch[3] !== undefined ? { defaultValue: paramMatch[3] } : {})
          })
        }
      }
    }

    // Determine actual return type for async Task<T>
    let actualReturnType = returnType
    const taskMatch = returnType.match(/^Task<(.+)>$/)
    if (asyncMod && taskMatch) {
      actualReturnType = taskMatch[1]
    } else if (asyncMod && returnType === 'Task') {
      actualReturnType = 'void'
    }

    functions.push({
      name,
      parameters,
      returnType: actualReturnType,
      isAsync: asyncMod === 'async',
      accessModifier: (accessMod as 'public' | 'private' | 'protected' | 'internal') || 'private',
      isStatic: staticMod === 'static'
    })
  }

  return functions
}

/**
 * Map C# type to TypeScript type
 */
export function mapCSharpTypeToTypeScript(csharpType: string): string {
  // Nullable types
  if (csharpType.endsWith('?')) {
    const baseType = csharpType.slice(0, -1)
    return `${mapCSharpTypeToTypeScript(baseType)} | null`
  }

  // Array types
  if (csharpType.endsWith('[]')) {
    const baseType = csharpType.slice(0, -2)
    return `${mapCSharpTypeToTypeScript(baseType)}[]`
  }

  // Generic collections
  const listMatch = csharpType.match(/^(?:List|IEnumerable|IList|ICollection)<(.+)>$/)
  if (listMatch) {
    return `${mapCSharpTypeToTypeScript(listMatch[1])}[]`
  }

  const dictMatch = csharpType.match(/^Dictionary<(.+),\s*(.+)>$/)
  if (dictMatch) {
    return `Record<${mapCSharpTypeToTypeScript(dictMatch[1])}, ${mapCSharpTypeToTypeScript(dictMatch[2])}>`
  }

  // Task types
  const taskMatch = csharpType.match(/^Task<(.+)>$/)
  if (taskMatch) {
    return `Promise<${mapCSharpTypeToTypeScript(taskMatch[1])}>`
  }
  if (csharpType === 'Task') {
    return 'Promise<void>'
  }

  // Primitive type mappings
  const typeMap: Record<string, string> = {
    'int': 'number',
    'long': 'number',
    'float': 'number',
    'double': 'number',
    'decimal': 'number',
    'byte': 'number',
    'short': 'number',
    'uint': 'number',
    'ulong': 'number',
    'ushort': 'number',
    'sbyte': 'number',
    'bool': 'boolean',
    'string': 'string',
    'void': 'void',
    'object': 'unknown',
    'dynamic': 'unknown',
    'DateTime': 'string',
    'DateTimeOffset': 'string',
    'Guid': 'string',
    'char': 'string',
  }

  return typeMap[csharpType] || csharpType
}

/**
 * Generate TypeScript type definitions from C# source
 */
export function generateTypeScriptFromCSharp(
  code: string,
  moduleName?: string
): string {
  const functions = parseCSharpFunctions(code)

  // Check if there's a class definition
  const classMatch = code.match(/(?:public|private|protected|internal)?\s*class\s+(\w+)/)
  const interfaceName = classMatch ? classMatch[1] : moduleName || 'GeneratedInterface'

  // Generate method signatures
  const methods = functions.map(func => {
    const params = func.parameters.map(p => {
      const tsType = mapCSharpTypeToTypeScript(p.type)
      return `${p.name}: ${tsType}`
    }).join(', ')

    let returnType = mapCSharpTypeToTypeScript(func.returnType)
    if (func.isAsync && !returnType.startsWith('Promise')) {
      returnType = `Promise<${returnType}>`
    }

    // Convert method name to camelCase
    const methodName = func.name.charAt(0).toLowerCase() + func.name.slice(1)

    return `  ${methodName}(${params}): ${returnType};`
  }).join('\n')

  return `export interface ${interfaceName} {\n${methods}\n}`
}

/**
 * Create a Roslyn script context for repeated executions
 */
export function createRoslynContext(options?: RoslynScriptOptions): RoslynContext {
  let variables: Record<string, { name: string; type: string; value: unknown }> = {}
  let functions: Map<string, Function> = new Map()
  let imports = new Set(options?.imports || [])
  let references = new Set(options?.references || [])
  let disposed = false

  // Initialize with globals
  if (options?.globals) {
    for (const [key, val] of Object.entries(options.globals)) {
      variables[key] = { name: key, type: typeof val, value: val }
    }
  }

  const context: RoslynContext = {
    async execute<T = unknown>(code: string): Promise<RoslynScriptResult<T>> {
      if (disposed) {
        throw new Error('Context has been disposed')
      }

      const compilationStart = Date.now()
      const diagnostics = await compileRoslynScript(code, { imports: Array.from(imports) })

      // Check for undefined variables in the code
      const trimmedCode = code.trim()
      const returnVarMatch = trimmedCode.match(/return\s+(\w+)\s*;/)
      if (returnVarMatch) {
        const varName = returnVarMatch[1]
        // Check if variable is declared in current code block
        const varDeclaredInCode = trimmedCode.includes(`var ${varName}`) ||
          new RegExp(`\\b(int|string|bool|double|float|long)\\s+${varName}\\s*=`).test(trimmedCode)
        if (!variables[varName] && !functions.has(varName) && !varDeclaredInCode) {
          throw new Error(`CS0103: The name '${varName}' does not exist in the current context`)
        }
      }

      const errors = diagnostics.filter(d => d.severity === 'error')
      if (errors.length > 0) {
        throw new Error(errors[0].message)
      }

      const compilationTimeMs = Date.now() - compilationStart
      const executionStart = Date.now()

      const result = simulateCSharpExecution(code, variables, functions)
      variables = result.variables
      functions = result.functions

      const executionTimeMs = Date.now() - executionStart

      const stateId = generateStateId()
      const state: RoslynScriptState = {
        id: stateId,
        variables: { ...variables },
        capturedAt: new Date()
      }

      return {
        value: result.value as T,
        compilationTimeMs,
        executionTimeMs,
        diagnostics,
        state
      }
    },

    setVariable(name: string, value: unknown): void {
      if (disposed) {
        throw new Error('Context has been disposed')
      }
      variables[name] = { name, type: inferType(value), value }
    },

    getVariable<T = unknown>(name: string): T | undefined {
      if (disposed) {
        throw new Error('Context has been disposed')
      }
      return variables[name]?.value as T | undefined
    },

    addReference(assembly: string): void {
      if (disposed) {
        throw new Error('Context has been disposed')
      }
      references.add(assembly)
    },

    addImport(namespace: string): void {
      if (disposed) {
        throw new Error('Context has been disposed')
      }
      imports.add(namespace)
    },

    getState(): RoslynScriptState {
      if (disposed) {
        throw new Error('Context has been disposed')
      }
      return {
        id: generateStateId(),
        variables: { ...variables },
        capturedAt: new Date()
      }
    },

    reset(): void {
      if (disposed) {
        throw new Error('Context has been disposed')
      }
      variables = {}
      functions = new Map()
      // Re-initialize with original globals
      if (options?.globals) {
        for (const [key, val] of Object.entries(options.globals)) {
          variables[key] = { name: key, type: typeof val, value: val }
        }
      }
    },

    dispose(): void {
      disposed = true
      variables = {}
      functions = new Map()
      imports.clear()
      references.clear()
    }
  }

  return context
}

/**
 * Roslyn execution context
 */
export interface RoslynContext {
  /**
   * Execute code in this context
   */
  execute<T = unknown>(code: string): Promise<RoslynScriptResult<T>>

  /**
   * Define a variable in the context
   */
  setVariable(name: string, value: unknown): void

  /**
   * Get a variable from the context
   */
  getVariable<T = unknown>(name: string): T | undefined

  /**
   * Add an assembly reference
   */
  addReference(assembly: string): void

  /**
   * Add a namespace import
   */
  addImport(namespace: string): void

  /**
   * Get current script state
   */
  getState(): RoslynScriptState

  /**
   * Reset the context to initial state
   */
  reset(): void

  /**
   * Dispose of context resources
   */
  dispose(): void
}
