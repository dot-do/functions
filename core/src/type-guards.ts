/**
 * Type guard functions for FunctionType discriminated unions
 *
 * These guards enable type narrowing when working with AnyFunctionDefinition.
 * Use them in conditionals to access type-specific properties safely.
 *
 * @example
 * ```typescript
 * function processFunction(fn: AnyFunctionDefinition) {
 *   if (isCodeFunction(fn)) {
 *     // fn is narrowed to CodeFunctionDefinition
 *     console.log(fn.language, fn.source)
 *   } else if (isGenerativeFunction(fn)) {
 *     // fn is narrowed to GenerativeFunctionDefinition
 *     console.log(fn.userPrompt, fn.outputSchema)
 *   }
 * }
 * ```
 */

import type { CodeFunctionDefinition } from './code/index.js'
import type { GenerativeFunctionDefinition } from './generative/index.js'
import type { AgenticFunctionDefinition } from './agentic/index.js'
import type { HumanFunctionDefinition } from './human/index.js'
import type { AnyFunctionDefinition } from './index.js'

/**
 * Type guard for CodeFunctionDefinition
 *
 * @param def - Any function definition to check
 * @returns true if the definition is a CodeFunctionDefinition
 */
export function isCodeFunction(def: AnyFunctionDefinition): def is CodeFunctionDefinition {
  return def.type === 'code'
}

/**
 * Type guard for GenerativeFunctionDefinition
 *
 * @param def - Any function definition to check
 * @returns true if the definition is a GenerativeFunctionDefinition
 */
export function isGenerativeFunction(def: AnyFunctionDefinition): def is GenerativeFunctionDefinition {
  return def.type === 'generative'
}

/**
 * Type guard for AgenticFunctionDefinition
 *
 * @param def - Any function definition to check
 * @returns true if the definition is an AgenticFunctionDefinition
 */
export function isAgenticFunction(def: AnyFunctionDefinition): def is AgenticFunctionDefinition {
  return def.type === 'agentic'
}

/**
 * Type guard for HumanFunctionDefinition
 *
 * @param def - Any function definition to check
 * @returns true if the definition is a HumanFunctionDefinition
 */
export function isHumanFunction(def: AnyFunctionDefinition): def is HumanFunctionDefinition {
  return def.type === 'human'
}
