/**
 * Tier Dispatcher - Connects API handlers to tier executors
 *
 * Routes function invocations to the appropriate tier executor:
 * - Tier 1: Code (5s timeout) - src/tiers/code-executor.ts
 * - Tier 2: Generative (30s timeout) - src/tiers/generative-executor.ts
 * - Tier 3: Agentic (5m timeout) - src/tiers/agentic-executor.ts
 * - Tier 4: Human (24h timeout) - src/tiers/human-executor.ts
 */

import type { FunctionMetadata } from '../core/types'
import { createUserStorageClient } from '../core/user-storage-client'
import { KVFunctionRegistry } from '../core/kv-function-registry'
import { KVCodeStorage } from '../core/code-storage'
import { CodeExecutor, type CodeExecutorEnv, type CodeFunctionResultWithCache } from '../tiers/code-executor'
import { GenerativeExecutor, type GenerativeExecutorOptions } from '../tiers/generative-executor'
import { AgenticExecutor } from '../tiers/agentic-executor'
import { validateFetchUrl } from '../core/ssrf-protection'
import { TIER_TIMEOUT_MAP } from '../config'
import type {
  CodeFunctionDefinition,
  CodeSource,
} from '@dotdo/functions/code'
import type {
  GenerativeFunctionDefinition,
  GenerativeFunctionConfig,
  GenerativeFunctionResult,
} from '@dotdo/functions/generative'
import type {
  AgenticFunctionDefinition,
  AgenticFunctionConfig,
  AgenticFunctionResult,
  BuiltinTool,
  ToolDefinition,
} from '@dotdo/functions/agentic'
import type {
  HumanFunctionDefinition,
  HumanFunctionConfig,
  HumanFunctionResult,
} from '@dotdo/functions/human'
import type { ExecutionContext as FunctionExecutionContext } from '@dotdo/functions'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Tier numbers for the function cascade
 */
export type TierNumber = 1 | 2 | 3 | 4

/**
 * Tier names mapped to tier numbers
 */
export const TIER_MAP: Record<string, TierNumber> = {
  code: 1,
  generative: 2,
  agentic: 3,
  human: 4,
}

/**
 * Default timeouts for each tier (imported from centralized config)
 */
export const TIER_TIMEOUTS: Record<TierNumber, number> = TIER_TIMEOUT_MAP

/**
 * Extended environment with all tier executor bindings
 */
export interface TierDispatcherEnv {
  /** Worker loader for code execution */
  LOADER?: unknown
  /** Dispatch namespace for code execution */
  USER_FUNCTIONS?: unknown
  /** AI client for generative/agentic execution */
  AI_CLIENT?: AIClient
  /** Durable Object for human task execution */
  HUMAN_TASKS?: DurableObjectNamespace
  /** R2 bucket for code storage */
  CODE_STORAGE?: R2Bucket
  /** Per-user storage Durable Object namespace */
  USER_STORAGE?: DurableObjectNamespace
  /** @deprecated KV function registry (fallback when USER_STORAGE is not available) */
  FUNCTIONS_REGISTRY?: KVNamespace
  /** @deprecated KV code storage (fallback when USER_STORAGE is not available) */
  FUNCTIONS_CODE?: KVNamespace
}

/**
 * AI client interface (simplified)
 */
export interface AIClient {
  messages?: {
    create(params: unknown): Promise<{
      content: Array<{ type: string; text: string }>
      usage?: { input_tokens: number; output_tokens: number }
      stop_reason?: string
      model?: string
    }>
  }
  chat?: (request: unknown) => Promise<{
    content: string
    toolCalls?: Array<{ name: string; input: unknown }>
    stopReason: string
    tokens: { inputTokens: number; outputTokens: number; totalTokens: number }
  }>
}

/**
 * Extract the AI client type that AgenticExecutor expects as its second constructor parameter.
 * AgenticExecutor defines its own internal AIClient interface that is not exported.
 * Using ConstructorParameters lets us reference the exact expected type without
 * duplicating the internal interface definition.
 */
type AgenticExecutorAIClient = ConstructorParameters<typeof AgenticExecutor>[1]

/**
 * Extract the AI client type that GenerativeExecutor expects.
 * This ensures type compatibility between the dispatcher's AIClient and the executor's expected type.
 */
type GenerativeExecutorAIClient = GenerativeExecutorOptions['aiClient']

/**
 * Dispatch result with execution info
 */
export interface DispatchResult<TOutput = unknown> {
  /** HTTP status code */
  status: number
  /** Response body */
  body: {
    /** Output data (if successful) */
    output?: TOutput
    /** Task ID (for human tier) */
    taskId?: string
    /** Task URL (for human tier) */
    taskUrl?: string
    /** Task status (for human tier) */
    taskStatus?: string
    /** Error message (if failed) */
    error?: string
    /** Execution metadata */
    _meta: {
      /** Execution duration in ms */
      duration: number
      /** Executor type that handled the request */
      executorType: string
      /** Tier number */
      tier: TierNumber
      /** Code execution info (tier 1) */
      codeExecution?: {
        language: string
        isolateType?: string
        cpuTimeMs?: number
        memoryUsedBytes?: number
        compilationTimeMs?: number
        deterministic?: boolean
      }
      /** Generative execution info (tier 2) */
      generativeExecution?: {
        model: string
        tokens: {
          inputTokens: number
          outputTokens: number
        }
        cached?: boolean
        stopReason?: string
        modelLatencyMs?: number
      }
      /** Agentic execution info (tier 3) */
      agenticExecution?: {
        model: string
        iterations: number
        toolsUsed: string[]
        totalTokens: {
          inputTokens: number
          outputTokens: number
          totalTokens: number
        }
        goalAchieved?: boolean
        reasoningSummary?: string
      }
      /** Human execution info (tier 4) */
      humanExecution?: {
        taskId: string
        expiresAt: number
        assignees?: string[]
      }
      /** Tiers attempted (for cascade) */
      tiersAttempted?: string[]
      /** Steps executed (for cascade) */
      stepsExecuted?: number
    }
  }
}

/**
 * Extended metadata with type information
 */
export interface ExtendedMetadata extends FunctionMetadata {
  type?: string
  // Schema fields
  inputSchema?: Record<string, unknown>
  // Generative fields
  model?: string
  userPrompt?: string
  systemPrompt?: string
  outputSchema?: Record<string, unknown>
  temperature?: number
  maxTokens?: number
  // Agentic fields
  goal?: string
  tools?: Array<{
    name: string
    description: string
    inputSchema: Record<string, unknown>
    implementation?: ToolDefinition['implementation']
  }>
  maxIterations?: number
  enableReasoning?: boolean
  enableMemory?: boolean
  // Human fields
  interactionType?: string
  ui?: {
    title: string
    description?: string
  }
  assignees?: {
    users?: string[]
    teams?: string[]
    roles?: string[]
    roundRobin?: boolean
  }
  sla?: {
    responseTime: string
    resolutionTime: string
  }
  // Cascade fields
  steps?: Array<{
    functionId: string
    tier: string
    fallbackTo?: string
  }>
  errorHandling?: string
}

// =============================================================================
// TIER DISPATCHER
// =============================================================================

/**
 * TierDispatcher routes function invocations to the appropriate tier executor
 *
 * NOTE: The agenticExecutors Map stores executor instances keyed by function ID.
 * This is LEGITIMATE because:
 * 1. AgenticExecutor instances are stateless (no persistent cache)
 * 2. They're created on-demand and store tool handler registrations
 * 3. The Map acts as a factory/pool, not a cache
 *
 * Each request in Cloudflare Workers may hit a different isolate, so the
 * agenticExecutors Map will be empty on cold starts. This is fine because
 * AgenticExecutor can be recreated - it doesn't cache execution results.
 */
export class TierDispatcher {
  private codeExecutor: CodeExecutor | null = null
  private generativeExecutor: GenerativeExecutor | null = null
  // NOTE: This Map stores executor instances, not cached data
  // Executors are recreated on cold starts, which is fine
  private agenticExecutors: Map<string, AgenticExecutor> = new Map()

  constructor(private env: TierDispatcherEnv) {
    // Initialize code executor
    const codeEnv: CodeExecutorEnv = {
      LOADER: env.LOADER as Fetcher | undefined,
      CODE_STORAGE: env.CODE_STORAGE,
    }
    this.codeExecutor = new CodeExecutor(codeEnv)

    // Initialize generative executor if AI client is available
    if (env.AI_CLIENT?.messages) {
      // TierDispatcherEnv.AIClient and GenerativeExecutor.AIClient are structurally compatible
      // at runtime (both have messages.create returning the same shape), but their type definitions
      // differ (messages is optional here, required there; param types differ).
      // We verify messages exists above, then use unknown bridge cast for the structural compatibility.
      const aiClient = env.AI_CLIENT as unknown as GenerativeExecutorAIClient
      this.generativeExecutor = new GenerativeExecutor({ aiClient })
    }
  }

  /**
   * Dispatch a function invocation to the appropriate tier executor
   */
  async dispatch(
    metadata: ExtendedMetadata,
    input: unknown,
    code?: string
  ): Promise<DispatchResult> {
    const functionType = metadata.type || 'code'
    const tier = TIER_MAP[functionType] || 1
    const start = Date.now()

    try {
      switch (functionType) {
        case 'code':
          return await this.dispatchCode(metadata, input, code, start)

        case 'generative':
          return await this.dispatchGenerative(metadata, input, start)

        case 'agentic':
          return await this.dispatchAgentic(metadata, input, start)

        case 'human':
          return await this.dispatchHuman(metadata, input, start)

        case 'cascade':
          return await this.dispatchCascade(metadata, input, start)

        default:
          return {
            status: 501,
            body: {
              error: `Unknown function type: ${functionType}`,
              _meta: { duration: Date.now() - start, executorType: functionType, tier: 1 },
            },
          }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Execution failed'
      return {
        status: 500,
        body: {
          error: message,
          _meta: { duration: Date.now() - start, executorType: functionType, tier },
        },
      }
    }
  }

  /**
   * Dispatch to Code Executor (Tier 1)
   */
  private async dispatchCode(
    metadata: ExtendedMetadata,
    input: unknown,
    code: string | undefined,
    start: number
  ): Promise<DispatchResult> {
    if (!this.codeExecutor) {
      return {
        status: 503,
        body: {
          error: 'Code executor not available',
          _meta: { duration: Date.now() - start, executorType: 'code', tier: 1 },
        },
      }
    }

    if (!code) {
      return {
        status: 404,
        body: {
          error: 'Function code not found',
          _meta: { duration: Date.now() - start, executorType: 'code', tier: 1 },
        },
      }
    }

    // Build CodeFunctionDefinition from metadata
    const definition: CodeFunctionDefinition = {
      id: metadata.id,
      name: metadata.id,
      version: metadata.version,
      type: 'code',
      language: metadata.language || 'typescript',
      source: { type: 'inline', code } as CodeSource,
      timeout: `${TIER_TIMEOUTS[1]}ms`,
    }

    const result = await this.codeExecutor.execute(definition, input)
    const duration = Date.now() - start

    if (result.status === 'timeout') {
      return {
        status: 408,
        body: {
          error: result.error?.message || 'Execution timeout',
          _meta: {
            duration,
            executorType: 'code',
            tier: 1,
            codeExecution: {
              language: result.codeExecution?.language || metadata.language || 'typescript',
              cpuTimeMs: result.codeExecution?.cpuTimeMs,
            },
          },
        },
      }
    }

    if (result.status === 'failed') {
      return {
        status: 500,
        body: {
          error: result.error?.message || 'Execution failed',
          _meta: {
            duration,
            executorType: 'code',
            tier: 1,
            codeExecution: {
              language: result.codeExecution?.language || metadata.language || 'typescript',
              cpuTimeMs: result.codeExecution?.cpuTimeMs,
            },
          },
        },
      }
    }

    return {
      status: 200,
      body: {
        ...((result.output || {}) as object),
        _meta: {
          duration,
          executorType: 'code',
          tier: 1,
          codeExecution: {
            language: result.codeExecution?.language || metadata.language || 'typescript',
            isolateType: result.codeExecution?.isolateType,
            cpuTimeMs: result.codeExecution?.cpuTimeMs,
            memoryUsedBytes: result.codeExecution?.memoryUsedBytes,
            compilationTimeMs: result.codeExecution?.compilationTimeMs,
            deterministic: result.codeExecution?.deterministic,
          },
        },
      },
    }
  }

  /**
   * Dispatch to Generative Executor (Tier 2)
   */
  private async dispatchGenerative(
    metadata: ExtendedMetadata,
    input: unknown,
    start: number
  ): Promise<DispatchResult> {
    if (!this.generativeExecutor || !this.env.AI_CLIENT) {
      return {
        status: 503,
        body: {
          error: 'Generative executor not available. AI_CLIENT not configured.',
          _meta: { duration: Date.now() - start, executorType: 'generative', tier: 2 },
        },
      }
    }

    // Build GenerativeFunctionDefinition from metadata
    const definition: GenerativeFunctionDefinition = {
      id: metadata.id,
      name: metadata.id,
      version: metadata.version,
      type: 'generative',
      model: metadata.model || 'claude-3-sonnet',
      userPrompt: metadata.userPrompt || '',
      systemPrompt: metadata.systemPrompt,
      outputSchema: metadata.outputSchema || { type: 'object' },
      temperature: metadata.temperature,
      maxTokens: metadata.maxTokens,
      timeout: `${TIER_TIMEOUTS[2]}ms`,
    }

    const context: FunctionExecutionContext = {
      timeout: TIER_TIMEOUTS[2],
    }

    try {
      const result = await this.generativeExecutor.execute(definition, input, undefined, context)
      const duration = Date.now() - start

      if (result.status === 'timeout') {
        return {
          status: 408,
          body: {
            error: result.error?.message || 'Request timeout',
            _meta: {
              duration,
              executorType: 'generative',
              tier: 2,
              generativeExecution: {
                model: result.generativeExecution?.model || definition.model || 'unknown',
                tokens: {
                  inputTokens: result.generativeExecution?.tokens?.inputTokens || 0,
                  outputTokens: result.generativeExecution?.tokens?.outputTokens || 0,
                },
              },
            },
          },
        }
      }

      if (result.status === 'failed') {
        return {
          status: 500,
          body: {
            error: result.error?.message || 'Generation failed',
            _meta: {
              duration,
              executorType: 'generative',
              tier: 2,
              generativeExecution: {
                model: result.generativeExecution?.model || definition.model || 'unknown',
                tokens: {
                  inputTokens: result.generativeExecution?.tokens?.inputTokens || 0,
                  outputTokens: result.generativeExecution?.tokens?.outputTokens || 0,
                },
              },
            },
          },
        }
      }

      return {
        status: 200,
        body: {
          ...((result.output || {}) as object),
          _meta: {
            duration,
            executorType: 'generative',
            tier: 2,
            generativeExecution: {
              model: result.generativeExecution?.model || definition.model || 'unknown',
              tokens: {
                inputTokens: result.generativeExecution?.tokens?.inputTokens || 0,
                outputTokens: result.generativeExecution?.tokens?.outputTokens || 0,
              },
              cached: result.generativeExecution?.cached,
              stopReason: result.generativeExecution?.stopReason,
              modelLatencyMs: result.generativeExecution?.modelLatencyMs,
            },
          },
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed'
      return {
        status: 500,
        body: {
          error: message,
          _meta: {
            duration: Date.now() - start,
            executorType: 'generative',
            tier: 2,
          },
        },
      }
    }
  }

  /**
   * Dispatch to Agentic Executor (Tier 3)
   */
  private async dispatchAgentic(
    metadata: ExtendedMetadata,
    input: unknown,
    start: number
  ): Promise<DispatchResult> {
    if (!this.env.AI_CLIENT?.chat) {
      return {
        status: 503,
        body: {
          error: 'Agentic executor not available. AI_CLIENT not configured.',
          _meta: { duration: Date.now() - start, executorType: 'agentic', tier: 3 },
        },
      }
    }

    // Build AgenticFunctionDefinition from metadata, preserving tool implementations
    const metadataTools = metadata.tools || []
    const definition: AgenticFunctionDefinition = {
      id: metadata.id,
      name: metadata.id,
      version: metadata.version,
      type: 'agentic',
      model: metadata.model || 'claude-3-opus',
      systemPrompt: metadata.systemPrompt || 'You are a helpful assistant.',
      goal: metadata.goal || 'Complete the requested task',
      tools: metadataTools.map(t => ({
        ...t,
        implementation: t.implementation || { type: 'builtin' as const, name: t.name as BuiltinTool },
      })),
      maxIterations: metadata.maxIterations || 10,
      enableReasoning: metadata.enableReasoning !== false,
      enableMemory: metadata.enableMemory !== false,
      timeout: `${TIER_TIMEOUTS[3]}ms`,
    }

    // Get or create agentic executor for this function
    let executor = this.agenticExecutors.get(metadata.id)
    if (!executor) {
      // TierDispatcherEnv.AIClient.chat and AgenticExecutor.AIClient are structurally compatible
      // at runtime (both have chat method returning similar AIResponse shapes), but their type
      // definitions differ. We've verified AI_CLIENT.chat exists above via the guard on line 549.
      // Use unknown bridge cast for the structural compatibility between separate type systems.
      const aiClient = this.env.AI_CLIENT as unknown as AgenticExecutorAIClient
      executor = new AgenticExecutor(definition, aiClient)

      // Register tool handlers based on each tool's implementation type
      for (const tool of definition.tools) {
        const handler = this.createToolHandler(tool)
        if (handler) {
          executor.registerToolHandler(tool.name, handler)
        }
      }

      this.agenticExecutors.set(metadata.id, executor)
    }

    const context: FunctionExecutionContext = {
      timeout: TIER_TIMEOUTS[3],
    }

    try {
      const result = await executor.execute(input, undefined, context)
      const duration = Date.now() - start

      if (result.status === 'timeout') {
        return {
          status: 408,
          body: {
            error: result.error?.message || 'Execution timeout exceeded',
            _meta: {
              duration,
              executorType: 'agentic',
              tier: 3,
              agenticExecution: {
                model: result.agenticExecution?.model || definition.model || 'unknown',
                iterations: result.agenticExecution?.iterations || 0,
                toolsUsed: result.agenticExecution?.toolsUsed || [],
                totalTokens: result.agenticExecution?.totalTokens || { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              },
            },
          },
        }
      }

      if (result.status === 'failed') {
        return {
          status: 500,
          body: {
            error: result.error?.message || 'Agent execution failed',
            _meta: {
              duration,
              executorType: 'agentic',
              tier: 3,
              agenticExecution: {
                model: result.agenticExecution?.model || definition.model || 'unknown',
                iterations: result.agenticExecution?.iterations || 0,
                toolsUsed: result.agenticExecution?.toolsUsed || [],
                totalTokens: result.agenticExecution?.totalTokens || { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              },
            },
          },
        }
      }

      return {
        status: 200,
        body: {
          ...((result.output || {}) as object),
          _meta: {
            duration,
            executorType: 'agentic',
            tier: 3,
            agenticExecution: {
              model: result.agenticExecution?.model || definition.model || 'unknown',
              iterations: result.agenticExecution?.iterations || 0,
              toolsUsed: result.agenticExecution?.toolsUsed || [],
              totalTokens: result.agenticExecution?.totalTokens || { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              goalAchieved: result.agenticExecution?.goalAchieved,
              reasoningSummary: result.agenticExecution?.reasoningSummary,
            },
          },
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent execution failed'
      return {
        status: 500,
        body: {
          error: message,
          _meta: {
            duration: Date.now() - start,
            executorType: 'agentic',
            tier: 3,
          },
        },
      }
    }
  }

  /**
   * Dispatch to Human Executor (Tier 4)
   */
  private async dispatchHuman(
    metadata: ExtendedMetadata,
    input: unknown,
    start: number
  ): Promise<DispatchResult> {
    if (!this.env.HUMAN_TASKS) {
      return {
        status: 503,
        body: {
          error: 'Human executor not available. HUMAN_TASKS not configured.',
          _meta: { duration: Date.now() - start, executorType: 'human', tier: 4 },
        },
      }
    }

    // Build HumanFunctionDefinition from metadata
    const definition: HumanFunctionDefinition = {
      id: metadata.id,
      name: metadata.id,
      version: metadata.version,
      type: 'human',
      interactionType: (metadata.interactionType as HumanFunctionDefinition['interactionType']) || 'approval',
      ui: metadata.ui || { title: metadata.id },
      assignees: metadata.assignees,
      sla: metadata.sla,
      timeout: `${TIER_TIMEOUTS[4]}ms`,
    }

    try {
      // Get a Durable Object stub for the human task
      const taskId = `${metadata.id}-${Date.now()}`
      const doId = this.env.HUMAN_TASKS.idFromName(taskId)
      const stub = this.env.HUMAN_TASKS.get(doId)

      // Create the task via the Durable Object
      const createResponse = await stub.fetch(new Request('https://internal/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          definition,
          input,
        }),
      }))

      if (!createResponse.ok) {
        const errorText = await createResponse.text()
        return {
          status: createResponse.status,
          body: {
            error: `Failed to create human task: ${errorText}`,
            _meta: { duration: Date.now() - start, executorType: 'human', tier: 4 },
          },
        }
      }

      const task = await createResponse.json() as {
        id: string
        status: string
        taskUrl: string
        expiresAt: number
      }

      const duration = Date.now() - start

      // Human tasks return 202 Accepted since they are async
      return {
        status: 202,
        body: {
          taskId: task.id,
          taskUrl: task.taskUrl,
          taskStatus: task.status,
          _meta: {
            duration,
            executorType: 'human',
            tier: 4,
            humanExecution: {
              taskId: task.id,
              expiresAt: task.expiresAt,
              assignees: metadata.assignees?.users,
            },
          },
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create human task'
      return {
        status: 500,
        body: {
          error: message,
          _meta: {
            duration: Date.now() - start,
            executorType: 'human',
            tier: 4,
          },
        },
      }
    }
  }

  /**
   * Dispatch to Cascade Executor
   */
  private async dispatchCascade(
    metadata: ExtendedMetadata,
    input: unknown,
    start: number
  ): Promise<DispatchResult> {
    const steps = metadata.steps || []
    const errorHandling = metadata.errorHandling || 'fail-fast'
    const tiersAttempted: string[] = []
    let stepsExecuted = 0
    let currentInput = input
    let lastResult: DispatchResult | null = null

    for (const step of steps) {
      tiersAttempted.push(step.tier)

      // Get step function metadata
      const stepMetadata = await this.getStepMetadata(step.functionId)
      if (!stepMetadata) {
        if (errorHandling === 'fail-fast') {
          return {
            status: 404,
            body: {
              error: `Step function not found: ${step.functionId}`,
              _meta: {
                duration: Date.now() - start,
                executorType: 'cascade',
                tier: 1,
                tiersAttempted,
                stepsExecuted,
              },
            },
          }
        }
        continue
      }

      // Get code if this is a code step
      let code: string | undefined
      if (step.tier === 'code') {
        code = await this.getStepCode(step.functionId)
      }

      // Execute the step
      const result = await this.dispatch(stepMetadata, currentInput, code)
      stepsExecuted++

      if (result.status >= 400) {
        // Step failed
        if (errorHandling === 'fail-fast') {
          return {
            ...result,
            body: {
              ...result.body,
              _meta: {
                ...result.body._meta,
                tiersAttempted,
                stepsExecuted,
              },
            },
          }
        } else if (errorHandling === 'fallback' && step.fallbackTo) {
          // Try fallback step
          tiersAttempted.push(`fallback:${step.fallbackTo}`)
          continue
        }
        // Continue to next step
        continue
      }

      // Step succeeded, use output as input for next step
      lastResult = result
      // Extract output without _meta for next step input
      const { _meta, ...output } = result.body
      currentInput = output
    }

    if (!lastResult) {
      return {
        status: 500,
        body: {
          error: 'Cascade completed with no successful steps',
          _meta: {
            duration: Date.now() - start,
            executorType: 'cascade',
            tier: 1,
            tiersAttempted,
            stepsExecuted,
          },
        },
      }
    }

    return {
      ...lastResult,
      body: {
        ...lastResult.body,
        _meta: {
          ...lastResult.body._meta,
          executorType: 'cascade',
          tiersAttempted,
          stepsExecuted,
        },
      },
    }
  }

  // ===========================================================================
  // TOOL HANDLER FACTORY
  // ===========================================================================

  /**
   * Create a tool handler function based on the tool's implementation type.
   *
   * Maps each implementation type to a concrete handler:
   * - builtin: Built-in implementations for web_search, web_fetch, etc.
   * - api: HTTP fetch-based handler using the tool's endpoint config
   * - inline: NOT SUPPORTED - returns error (use 'function' type instead)
   * - function: Dispatches to another registered function by ID
   */
  private createToolHandler(
    tool: ToolDefinition
  ): ((input: unknown, context: { toolDefinition: ToolDefinition; executionContext: FunctionExecutionContext }) => Promise<unknown>) | null {
    const impl = tool.implementation

    switch (impl.type) {
      case 'builtin':
        return this.createBuiltinToolHandler(impl.name)

      case 'api':
        return this.createApiToolHandler(impl.endpoint)

      case 'inline':
        return this.createInlineToolHandler(impl.handler)

      case 'function':
        return this.createFunctionToolHandler(impl.functionId)

      default:
        return null
    }
  }

  /**
   * Create a handler for builtin tools (web_search, web_fetch, file_read, etc.)
   */
  private createBuiltinToolHandler(
    name: BuiltinTool
  ): (input: unknown, context: { toolDefinition: ToolDefinition; executionContext: FunctionExecutionContext }) => Promise<unknown> {
    switch (name) {
      case 'web_search':
        return async (input: unknown) => {
          const { query } = input as { query: string }
          const searchUrl = `https://api.search.do/search?q=${encodeURIComponent(query)}`
          try {
            const response = await fetch(searchUrl)
            if (!response.ok) {
              return { error: `Search request failed with status ${response.status}`, results: [] }
            }
            return await response.json()
          } catch (err) {
            return { error: err instanceof Error ? err.message : 'Search failed', results: [] }
          }
        }

      case 'web_fetch':
        return async (input: unknown) => {
          const { url, method = 'GET' } = input as { url: string; method?: string }
          // SSRF protection: validate URL before fetching
          const validation = validateFetchUrl(url)
          if (!validation.valid) {
            return { error: `SSRF protection: ${validation.reason}`, blocked: true }
          }
          try {
            const response = await fetch(url, { method })
            const contentType = response.headers.get('content-type') || ''
            if (contentType.includes('application/json')) {
              return { status: response.status, data: await response.json() }
            }
            return { status: response.status, data: await response.text() }
          } catch (err) {
            return { error: err instanceof Error ? err.message : 'Fetch failed' }
          }
        }

      case 'file_read':
        return async (input: unknown) => {
          const { path } = input as { path: string }
          return { error: `file_read not available in this environment`, path }
        }

      case 'file_write':
        return async (input: unknown) => {
          const { path } = input as { path: string; content: string }
          return { error: `file_write not available in this environment`, path }
        }

      case 'shell_exec':
        return async (input: unknown) => {
          const { command } = input as { command: string }
          return { error: `shell_exec not available in this environment`, command }
        }

      case 'database_query':
        return async (input: unknown) => {
          const { query } = input as { query: string }
          return { error: `database_query not available in this environment`, query }
        }

      case 'email_send':
        return async (input: unknown) => {
          const { to, subject, body } = input as { to: string; subject?: string; body: string }
          return { error: `email_send not available in this environment`, to, subject, body }
        }

      case 'slack_send':
        return async (input: unknown) => {
          const { channel, message } = input as { channel: string; message: string }
          return { error: `slack_send not available in this environment`, channel, message }
        }

      default:
        return async () => {
          return { error: `Unknown builtin tool: ${name}` }
        }
    }
  }

  /**
   * Create a handler for API tools that calls an HTTP endpoint
   */
  private createApiToolHandler(
    endpoint: string
  ): (input: unknown, context: { toolDefinition: ToolDefinition; executionContext: FunctionExecutionContext }) => Promise<unknown> {
    return async (input: unknown) => {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          return await response.json()
        }
        return { status: response.status, data: await response.text() }
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'API call failed' }
      }
    }
  }

  /**
   * Create a handler for inline tools that executes handler code.
   *
   * IMPORTANT: Inline tool handlers are NOT supported in Cloudflare Workers runtime.
   *
   * The previous implementation used `new Function('input', handler)` which is:
   * 1. BLOCKED in Cloudflare Workers - code cannot work in production
   * 2. A security vulnerability - allows arbitrary code execution
   *
   * Inline handlers must be deployed as user functions and executed via:
   * - The LOADER binding (worker_loaders) for sandboxed execution
   * - The ai-evaluate service for sandboxed code evaluation
   *
   * To use inline code, deploy it as a function first using the deploy API,
   * then reference it using the 'function' implementation type instead:
   *
   * ```json
   * {
   *   "implementation": {
   *     "type": "function",
   *     "functionId": "my-deployed-handler"
   *   }
   * }
   * ```
   */
  private createInlineToolHandler(
    _handler: string
  ): (input: unknown, context: { toolDefinition: ToolDefinition; executionContext: FunctionExecutionContext }) => Promise<unknown> {
    // Return a handler that always returns an error explaining the limitation
    return async (_input: unknown) => {
      return {
        error: 'Inline tool handlers are not supported in Cloudflare Workers runtime. ' +
          'Dynamic code execution via new Function() is blocked for security reasons. ' +
          'Please deploy your handler code as a function using the deploy API, then reference it ' +
          'using the "function" implementation type with a functionId instead of "inline".'
      }
    }
  }

  /**
   * Create a handler for function tools that dispatches to another registered function
   */
  private createFunctionToolHandler(
    functionId: string
  ): (input: unknown, context: { toolDefinition: ToolDefinition; executionContext: FunctionExecutionContext }) => Promise<unknown> {
    return async (input: unknown) => {
      try {
        // Look up the target function metadata
        const targetMetadata = await this.getStepMetadata(functionId)
        if (!targetMetadata) {
          return { error: `Function '${functionId}' not found` }
        }

        // Get code if needed
        let code: string | undefined
        if ((targetMetadata.type || 'code') === 'code') {
          code = await this.getStepCode(functionId)
        }

        // Dispatch to the target function
        const result = await this.dispatch(targetMetadata, input, code)
        if (result.status >= 400) {
          return { error: result.body.error || `Function '${functionId}' failed` }
        }

        // Return output without _meta
        const { _meta, ...output } = result.body
        return output
      } catch (err) {
        return { error: err instanceof Error ? err.message : `Function '${functionId}' execution failed` }
      }
    }
  }

  /**
   * Get metadata for a step function via UserStorage DO
   */
  private async getStepMetadata(functionId: string): Promise<ExtendedMetadata | null> {
    try {
      if (this.env.USER_STORAGE) {
        const client = createUserStorageClient(this.env.USER_STORAGE, 'anonymous')
        const data = await client.registry.get(functionId)
        return data as ExtendedMetadata | null
      }
      // KV fallback
      if (this.env.FUNCTIONS_REGISTRY) {
        const registry = new KVFunctionRegistry(this.env.FUNCTIONS_REGISTRY)
        const data = await registry.get(functionId)
        return data as ExtendedMetadata | null
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Get code for a step function via UserStorage DO or KV fallback
   */
  private async getStepCode(functionId: string): Promise<string | undefined> {
    try {
      if (this.env.USER_STORAGE) {
        const client = createUserStorageClient(this.env.USER_STORAGE, 'anonymous')
        return await client.code.get(functionId) || undefined
      }
      // KV fallback
      if (this.env.FUNCTIONS_CODE) {
        const code = new KVCodeStorage(this.env.FUNCTIONS_CODE)
        return await code.get(functionId) || undefined
      }
      return undefined
    } catch {
      return undefined
    }
  }
}

/**
 * Create a tier dispatcher instance
 */
export function createTierDispatcher(env: TierDispatcherEnv): TierDispatcher {
  return new TierDispatcher(env)
}
