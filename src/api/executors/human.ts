/**
 * Human Executor for Functions.do
 *
 * Executes human-in-the-loop functions that require manual approval or input.
 */

import type { FunctionMetadata } from '../../core/types'

/**
 * Human function metadata extension
 */
export interface HumanFunctionMetadata extends FunctionMetadata {
  type: 'human'
  assignees?: string[]
  timeout?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
}

/**
 * Execution result from human executor
 */
export interface HumanExecutionResult {
  taskId: string
  status: 'pending' | 'assigned' | 'completed' | 'timeout'
  result?: unknown
  duration?: number
  assignedTo?: string
  completedBy?: string
}

/**
 * Human executor class
 */
export class HumanExecutor {
  constructor(
    private env: Record<string, unknown>
  ) {}

  /**
   * Create a human task
   */
  async execute(
    metadata: HumanFunctionMetadata,
    input: unknown,
    request: Request
  ): Promise<HumanExecutionResult> {
    // Placeholder - human execution not yet implemented
    return {
      taskId: crypto.randomUUID(),
      status: 'pending',
    }
  }
}

export default HumanExecutor
