/**
 * Code Executor for Functions.do
 *
 * Executes standard code functions (TypeScript/JavaScript/WASM).
 */

import type { FunctionMetadata } from '../../core/types'

/**
 * Execution result from code executor
 */
export interface CodeExecutionResult {
  result: unknown
  duration: number
  executedWith: string
}

/**
 * Code executor class
 */
export class CodeExecutor {
  constructor(
    private env: Record<string, unknown>
  ) {}

  /**
   * Execute a code function
   */
  async execute(
    metadata: FunctionMetadata,
    code: string,
    input: unknown,
    request: Request
  ): Promise<CodeExecutionResult> {
    const start = Date.now()

    // This is a placeholder - actual execution happens in invokeHandler
    // which uses LOADER or USER_FUNCTIONS bindings

    return {
      result: { executed: false, reason: 'Use invokeHandler for execution' },
      duration: Date.now() - start,
      executedWith: 'placeholder',
    }
  }
}

export default CodeExecutor
