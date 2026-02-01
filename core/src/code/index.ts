/**
 * Code Functions - Deterministic code execution
 *
 * Code functions execute user-provided code in a sandboxed environment.
 * They are deterministic, fast, and cheap.
 *
 * Implementation options:
 * - Worker Loader: Dynamic Cloudflare Worker loading
 * - WASM: WebAssembly execution
 * - ai-evaluate: Sandboxed JavaScript evaluation
 * - V8 Isolates: Direct V8 execution
 *
 * Typical timeout: 5 seconds
 * Typical use: Deterministic transformations, validations, calculations
 */

import type {
  FunctionDefinition,
  FunctionResult,
  FunctionExecutor,
  ExecutionContext,
  Duration,
  JsonSchema,
} from '../types.js'

// =============================================================================
// CODE FUNCTION DEFINITION
// =============================================================================

export interface CodeFunctionDefinition<
  TInput = unknown,
  TOutput = unknown,
  TConfig = CodeFunctionConfig,
> extends FunctionDefinition<TInput, TOutput, TConfig> {
  type: 'code'

  /** Programming language */
  language: CodeLanguage

  /** Code source (inline or reference) */
  source: CodeSource

  /** Sandbox configuration */
  sandbox?: SandboxConfig
}

export type CodeLanguage =
  | 'typescript'
  | 'javascript'
  | 'rust'
  | 'go'
  | 'python'
  | 'zig'
  | 'assemblyscript'
  | 'csharp'

export type CodeSource =
  | { type: 'inline'; code: string }
  | { type: 'r2'; bucket: string; key: string }
  | { type: 'url'; url: string }
  | { type: 'registry'; functionId: string; version?: string }
  | { type: 'assets'; functionId: string; version?: string }

// =============================================================================
// CODE FUNCTION CONFIG
// =============================================================================

export interface CodeFunctionConfig {
  /** Memory limit in MB */
  memoryLimitMb?: number

  /** CPU time limit in milliseconds */
  cpuLimitMs?: number

  /** Environment variables */
  env?: Record<string, string>

  /** Enable network access */
  networkEnabled?: boolean

  /** Network allowlist (if enabled) */
  networkAllowlist?: string[]
}

export interface SandboxConfig {
  /** Isolate type */
  isolate?: 'v8' | 'wasm' | 'worker-loader'

  /** Enable deterministic mode (no Math.random, Date.now fixed) */
  deterministic?: boolean

  /** Maximum stack depth */
  maxStackDepth?: number

  /** Allowed globals */
  allowedGlobals?: string[]
}

// =============================================================================
// CODE FUNCTION RESULT
// =============================================================================

export interface CodeFunctionResult<TOutput = unknown>
  extends FunctionResult<TOutput> {
  /** Code-specific execution info */
  codeExecution: CodeExecutionInfo
}

export interface CodeExecutionInfo {
  /** Language that was executed */
  language: CodeLanguage

  /** Isolate type used */
  isolateType: 'v8' | 'wasm' | 'worker-loader'

  /** Memory used in bytes */
  memoryUsedBytes: number

  /** CPU time used in milliseconds */
  cpuTimeMs: number

  /** Whether execution was deterministic */
  deterministic: boolean

  /** Compilation time (if applicable) */
  compilationTimeMs?: number
}

// =============================================================================
// CODE FUNCTION EXECUTOR
// =============================================================================

export interface CodeFunctionExecutor<
  TInput = unknown,
  TOutput = unknown,
> extends FunctionExecutor<TInput, TOutput, CodeFunctionConfig> {
  /** Compile code (optional, for languages that need it) */
  compile?(source: CodeSource): Promise<CompiledCode>
}

export interface CompiledCode {
  /** Compiled artifact (WASM bytes, etc.) */
  artifact: Uint8Array

  /** Compilation info */
  compilation: {
    language: CodeLanguage
    targetFormat: 'wasm' | 'js' | 'native'
    sizeBytes: number
    durationMs: number
  }
}

// =============================================================================
// HELPER: Define a code function
// =============================================================================

export function defineCodeFunction<TInput, TOutput>(
  options: Omit<CodeFunctionDefinition<TInput, TOutput>, 'type'>
): CodeFunctionDefinition<TInput, TOutput> {
  return {
    ...options,
    type: 'code',
    timeout: options.timeout ?? '5s',
  }
}

// =============================================================================
// HELPER: Inline code function
// =============================================================================

export function inlineFunction<TInput, TOutput>(
  id: string,
  code: string,
  options?: {
    name?: string
    language?: CodeLanguage
    inputSchema?: JsonSchema
    outputSchema?: JsonSchema
  }
): CodeFunctionDefinition<TInput, TOutput> {
  const config: Omit<CodeFunctionDefinition<TInput, TOutput>, 'type'> = {
    id,
    name: options?.name ?? id,
    version: '1.0.0',
    language: options?.language ?? 'typescript',
    source: { type: 'inline', code },
  }
  if (options?.inputSchema !== undefined) {
    config.inputSchema = options.inputSchema
  }
  if (options?.outputSchema !== undefined) {
    config.outputSchema = options.outputSchema
  }
  return defineCodeFunction(config)
}
