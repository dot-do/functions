/**
 * Agentic Functions Executor
 *
 * Implements the AgenticFunctionExecutor interface for multi-step AI agents
 * with tool use capabilities.
 *
 * @module tiers/agentic-executor
 */

import type {
  AgenticFunctionDefinition,
  AgenticFunctionConfig,
  AgenticFunctionResult,
  AgenticFunctionExecutor,
  ToolDefinition,
  AgentState,
  AgentIteration,
  IterationResult,
  ToolCallRecord,
  AgenticExecutionInfo,
} from '@dotdo/functions/agentic'

import type {
  ExecutionContext,
  TokenUsage,
  FunctionResultStatus,
} from '@dotdo/functions'

import { parseDuration } from '@dotdo/functions'

// =============================================================================
// MODULE DOCUMENTATION
// =============================================================================
//
// This module implements the AgenticFunctionExecutor interface for multi-step
// AI agents with tool use capabilities. Key features:
//
// - Agent loop execution (think -> act -> observe cycle)
// - Tool registration and validation
// - Support for all tool types: function, api, inline, builtin
// - Iteration and tool call limits
// - Memory and context accumulation
// - Chain-of-thought reasoning
// - Timeout enforcement (5m default)
// - Human-in-the-loop approval for sensitive operations
// - Execution trace and cost tracking
// - Integration with autonomous-agents package API
//
// =============================================================================

// =============================================================================
// AUTONOMOUS AGENTS TYPES (mirror types from autonomous-agents package)
// =============================================================================

/**
 * These types mirror the autonomous-agents package API.
 * When the package is available, it will be used; otherwise, these types
 * provide the interface contract for the integration.
 */

/** Agent execution mode */
type AutonomousAgentMode = 'autonomous' | 'supervised' | 'manual'

/** Agent status during execution */
type AutonomousAgentStatus = 'idle' | 'thinking' | 'acting' | 'waiting' | 'completed' | 'error'

/** Priority levels */
type Priority = 'low' | 'medium' | 'high' | 'urgent'

/** Tool/function definition for AI */
interface AIFunctionDefinition {
  name: string
  description: string
  parameters?: Record<string, unknown>
  handler: (input: unknown) => Promise<unknown>
}

/** Role definition */
interface RoleType {
  id: string
  name: string
  description: string
  skills: string[]
  permissions?: string[]
  tools?: AIFunctionDefinition[]
  outputs?: string[]
}

/** Goal definition */
interface Goal {
  id: string
  description: string
  target: string | number
  progress?: string | number
  deadline?: Date
  priority?: Priority
  status?: 'active' | 'completed' | 'blocked' | 'cancelled'
  subgoals?: Goal[]
  successCriteria?: string[]
}

/** Agent history entry */
interface AgentHistoryEntry {
  timestamp: Date
  type: 'task' | 'question' | 'decision' | 'approval' | 'notification' | 'error'
  action: string
  input?: unknown
  output?: unknown
  error?: string
  duration?: number
}

/** Agent configuration */
interface AutonomousAgentConfig {
  name: string
  description?: string
  role: RoleType
  mode?: AutonomousAgentMode
  goals?: Goal[]
  tools?: AIFunctionDefinition[]
  context?: Record<string, unknown>
  model?: string
  system?: string
  maxIterations?: number
  temperature?: number
}

/** Autonomous Agent instance */
interface AutonomousAgent {
  config: AutonomousAgentConfig
  status: AutonomousAgentStatus
  state: Record<string, unknown>
  do: <TResult = unknown>(task: string, context?: unknown) => Promise<TResult>
  ask: <TResult = unknown>(question: string, context?: unknown) => Promise<TResult>
  decide: <T extends string>(options: T[], context?: string) => Promise<T>
  setState: (key: string, value: unknown) => void
  getState: <T = unknown>(key: string) => T | undefined
  getHistory: () => AgentHistoryEntry[]
  reset: () => void
}

// =============================================================================
// AI CLIENT INTERFACE
// =============================================================================

interface AIResponse {
  content: string
  toolCalls?: Array<{ name: string; input: unknown }>
  reasoning?: string
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
  tokens: TokenUsage
}

interface AIClient {
  chat(request: AIRequest): Promise<AIResponse>
}

interface AIRequest {
  model?: string
  messages: AIMessage[]
  tools?: AITool[]
  toolResults?: AIToolResult[]
  enableReasoning?: boolean
  systemPrompt?: string
}

interface AIMessage {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolCalls?: Array<{ name: string; input: unknown }>
}

interface AITool {
  name: string
  description: string
  inputSchema: unknown
}

interface AIToolResult {
  name: string
  output: unknown
}

// =============================================================================
// TOOL HANDLER CONTEXT
// =============================================================================

interface ToolHandlerContext {
  toolDefinition: ToolDefinition
  executionContext: ExecutionContext
}

type ToolHandler = (input: unknown, context: ToolHandlerContext) => Promise<unknown>

// =============================================================================
// PRICING CONFIGURATION
// =============================================================================

interface PricingConfig {
  inputTokenPricePer1k: number
  outputTokenPricePer1k: number
}

// =============================================================================
// APPROVAL
// =============================================================================

interface ApprovalRequest {
  granted: boolean
  approvedBy?: string
}

interface PendingApproval {
  toolName: string
  input: unknown
  resolve: (approval: ApprovalRequest) => void
  reject: (error: Error) => void
  timeoutId?: ReturnType<typeof setTimeout>
}

// =============================================================================
// AUTONOMOUS AGENT BRIDGE
// =============================================================================

/**
 * Converts a ToolDefinition to an AIFunctionDefinition for use with autonomous-agents
 */
function toolDefinitionToAIFunction(
  tool: ToolDefinition,
  handler: ToolHandler,
  executionContext: ExecutionContext
): AIFunctionDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema as Record<string, unknown>,
    handler: async (input: unknown) => {
      return handler(input, {
        toolDefinition: tool,
        executionContext,
      })
    },
  }
}

/**
 * Creates a Role from an AgenticFunctionDefinition
 */
function createRoleFromDefinition(
  definition: AgenticFunctionDefinition<unknown, unknown>,
  tools: AIFunctionDefinition[]
): RoleType {
  return {
    id: `role-${definition.id || 'agent'}`,
    name: definition.name || 'Agent',
    description: definition.systemPrompt,
    skills: ['reasoning', 'tool-use', 'planning'],
    tools,
  }
}

/**
 * Creates Goals from the definition
 */
function createGoalsFromDefinition(
  definition: AgenticFunctionDefinition<unknown, unknown>
): Goal[] {
  return [
    {
      id: 'primary-goal',
      description: definition.goal,
      target: 'completion',
      status: 'active',
      priority: 'high',
    },
  ]
}

// =============================================================================
// AGENTIC EXECUTOR
// =============================================================================

export class AgenticExecutor<TInput = unknown, TOutput = unknown>
  implements AgenticFunctionExecutor<TInput, TOutput>
{
  private toolHandlers: Map<string, ToolHandler> = new Map()
  private registeredTools: ToolDefinition[] = []
  private tokenBudget: number | undefined
  private pricing: PricingConfig | undefined
  private pendingApprovals: Map<string, PendingApproval[]> = new Map()
  private autonomousAgent: AutonomousAgent | undefined

  constructor(
    private definition: AgenticFunctionDefinition<TInput, TOutput>,
    private aiClient?: AIClient,
    private env?: Record<string, unknown>
  ) {
    // Register tools from definition
    this.registeredTools = [...(definition.tools || [])]
  }

  /**
   * Create an autonomous-agents compatible Agent for this executor.
   *
   * This provides integration with the autonomous-agents API contract for
   * enhanced agent capabilities like goals, roles, teams, and approval flows.
   */
  private createAutonomousAgentInstance(
    executionContext: ExecutionContext
  ): AutonomousAgent {
    // Convert ToolDefinitions to AIFunctionDefinitions
    const aiTools: AIFunctionDefinition[] = this.registeredTools
      .filter((tool) => this.toolHandlers.has(tool.name))
      .map((tool) =>
        toolDefinitionToAIFunction(
          tool,
          this.toolHandlers.get(tool.name)!,
          executionContext
        )
      )

    // Create role from definition
    const role = createRoleFromDefinition(
      this.definition as AgenticFunctionDefinition<unknown, unknown>,
      aiTools
    )

    // Create goals
    const goals = createGoalsFromDefinition(
      this.definition as AgenticFunctionDefinition<unknown, unknown>
    )

    // Create the autonomous agent configuration
    const agentConfig: AutonomousAgentConfig = {
      name: this.definition.name || 'AgenticExecutor',
      description: this.definition.description,
      role,
      mode: 'autonomous',
      goals,
      tools: aiTools,
      context: this.env,
      model: this.definition.model || 'claude-3-sonnet',
      system: this.definition.systemPrompt,
      maxIterations: this.definition.maxIterations ?? 10,
    }

    // Create a local agent implementation that follows the autonomous-agents API
    return this.createLocalAgent(agentConfig, executionContext)
  }

  /**
   * Create a local agent implementation that matches the autonomous-agents API.
   *
   * This is used when the autonomous-agents package is not available or for testing.
   * The local implementation provides the same interface contract as the full package,
   * enabling seamless integration and gradual migration.
   *
   * @param config - The autonomous agent configuration
   * @param _executionContext - The execution context (reserved for future use)
   * @returns An AutonomousAgent instance
   */
  private createLocalAgent(
    config: AutonomousAgentConfig,
    _executionContext: ExecutionContext
  ): AutonomousAgent {
    const agentState: Record<string, unknown> = config.context || {}
    let status: AutonomousAgentStatus = 'idle'
    const history: AgentHistoryEntry[] = []
    const aiClient = this.aiClient

    // Helper to record history
    const recordHistory = (entry: Omit<AgentHistoryEntry, 'timestamp'>): void => {
      history.push({
        ...entry,
        timestamp: new Date(),
      })
    }

    // Implement the do method for task execution
    const doTask = async <TResult = unknown>(
      task: string,
      context?: unknown
    ): Promise<TResult> => {
      const startTime = Date.now()
      status = 'thinking'

      try {
        if (!aiClient) {
          throw new Error('AI client not configured for autonomous agent')
        }

        // Execute the task using the AI client
        const response = await aiClient.chat({
          model: config.model,
          messages: [
            { role: 'user', content: `Task: ${task}\n\nContext: ${JSON.stringify(context || {})}` },
          ],
          tools: config.tools?.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.parameters,
          })),
          systemPrompt: config.system,
        })

        const result = response.content

        recordHistory({
          type: 'task',
          action: task,
          input: context,
          output: result,
          duration: Date.now() - startTime,
        })

        status = 'completed'

        // Try to parse as JSON, otherwise return as string
        try {
          return JSON.parse(result) as TResult
        } catch {
          return result as TResult
        }
      } catch (error) {
        status = 'error'
        recordHistory({
          type: 'error',
          action: task,
          input: context,
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime,
        })
        throw error
      } finally {
        if (status !== 'error') {
          status = 'idle'
        }
      }
    }

    // Implement the ask method
    const ask = async <TResult = unknown>(
      question: string,
      context?: unknown
    ): Promise<TResult> => {
      const startTime = Date.now()
      status = 'thinking'

      try {
        if (!aiClient) {
          throw new Error('AI client not configured for autonomous agent')
        }

        const response = await aiClient.chat({
          model: config.model,
          messages: [
            { role: 'user', content: `Question: ${question}\n\nContext: ${JSON.stringify(context || {})}` },
          ],
          systemPrompt: config.system,
        })

        const result = response.content

        recordHistory({
          type: 'question',
          action: question,
          input: context,
          output: result,
          duration: Date.now() - startTime,
        })

        status = 'idle'

        try {
          return JSON.parse(result) as TResult
        } catch {
          return result as TResult
        }
      } catch (error) {
        status = 'error'
        recordHistory({
          type: 'error',
          action: question,
          input: context,
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime,
        })
        throw error
      }
    }

    // Implement the decide method
    const decide = async <T extends string>(options: T[], context?: string): Promise<T> => {
      const startTime = Date.now()
      status = 'thinking'

      try {
        if (!aiClient) {
          // Return first option as default when no AI client
          return options[0]
        }

        const response = await aiClient.chat({
          model: config.model,
          messages: [
            {
              role: 'user',
              content: `Choose one of these options: ${options.join(', ')}\n\nContext: ${context || 'No additional context'}`,
            },
          ],
          systemPrompt: config.system,
        })

        // Try to extract the decision from the response
        const decision = options.find((o) => response.content.includes(o)) || options[0]

        recordHistory({
          type: 'decision',
          action: `Choose from: ${options.join(', ')}`,
          input: context,
          output: decision,
          duration: Date.now() - startTime,
        })

        status = 'idle'
        return decision
      } catch (error) {
        status = 'error'
        recordHistory({
          type: 'error',
          action: 'decision',
          input: { options, context },
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime,
        })
        throw error
      }
    }

    return {
      config,
      get status() {
        return status
      },
      state: agentState,
      do: doTask,
      ask,
      decide,
      setState: (key: string, value: unknown) => {
        agentState[key] = value
      },
      getState: <T = unknown>(key: string): T | undefined => {
        return agentState[key] as T | undefined
      },
      getHistory: () => [...history],
      reset: () => {
        Object.keys(agentState).forEach((key) => delete agentState[key])
        history.length = 0
        status = 'idle'
      },
    }
  }

  /**
   * Get the underlying autonomous agent instance.
   *
   * Useful for advanced use cases like team coordination or direct
   * agent method access (do, ask, decide).
   *
   * @param executionContext - Optional execution context
   * @returns The autonomous agent instance
   */
  getAutonomousAgent(executionContext?: ExecutionContext): AutonomousAgent {
    if (!this.autonomousAgent) {
      this.autonomousAgent = this.createAutonomousAgentInstance(
        executionContext || { executionId: `agent-${Date.now()}` }
      )
    }
    return this.autonomousAgent
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Register a tool handler
   */
  registerToolHandler(toolName: string, handler: ToolHandler): void {
    this.toolHandlers.set(toolName, handler)
  }

  /**
   * Get registered tools
   */
  getRegisteredTools(): ToolDefinition[] {
    return this.registeredTools
  }

  /**
   * Set token budget limit
   */
  setTokenBudget(budget: number): void {
    this.tokenBudget = budget
  }

  /**
   * Set pricing configuration for cost estimation
   */
  setPricing(config: PricingConfig): void {
    this.pricing = config
  }

  /**
   * Approve a tool call that requires approval
   */
  async approveToolCall(
    executionId: string,
    toolName: string,
    approval: ApprovalRequest
  ): Promise<void> {
    const pending = this.pendingApprovals.get(executionId)
    if (!pending || pending.length === 0) return

    const index = pending.findIndex((p) => p.toolName === toolName)
    if (index === -1) return

    const pendingApproval = pending[index]
    pending.splice(index, 1)

    if (pendingApproval.timeoutId) {
      clearTimeout(pendingApproval.timeoutId)
    }

    pendingApproval.resolve(approval)
  }

  // ===========================================================================
  // EXECUTE
  // ===========================================================================

  async execute(
    input: TInput,
    config?: AgenticFunctionConfig,
    context?: ExecutionContext
  ): Promise<AgenticFunctionResult<TOutput>> {
    const startTime = Date.now()
    const executionId = context?.executionId || `exec-${Date.now()}`

    // Determine effective configuration
    const effectiveMaxIterations =
      config?.maxIterations ?? this.definition.maxIterations ?? 10
    const effectiveMaxToolCallsPerIteration =
      this.definition.maxToolCallsPerIteration ?? 5
    const effectiveModel =
      config?.model ?? this.definition.model ?? 'claude-3-sonnet'
    const enableMemory = this.definition.enableMemory ?? false
    const enableReasoning = this.definition.enableReasoning ?? true

    // Determine timeout
    const timeoutDuration = context?.timeout
      ? parseDuration(context.timeout)
      : this.definition.timeout
        ? parseDuration(this.definition.timeout)
        : 5 * 60 * 1000 // 5 minutes default

    // Initialize state
    const state: AgentState = {
      iteration: 0,
      memory: [],
      toolResults: [],
      goalAchieved: false,
      output: undefined,
    }

    const trace: AgentIteration[] = []
    const toolsUsed = new Set<string>()
    const totalTokens: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    }

    let status: FunctionResultStatus = 'completed'
    let error: { name: string; message: string } | undefined
    let lastContent = ''
    let queuedToolCalls: Array<{ name: string; input: unknown }> = []
    let cancelled = false
    let timedOut = false

    // Build messages
    const messages: AIMessage[] = [
      { role: 'user', content: JSON.stringify(input) },
    ]

    // Set up abort handling
    if (context?.signal) {
      if (context.signal.aborted) {
        cancelled = true
      } else {
        context.signal.addEventListener('abort', () => {
          cancelled = true
        })
      }
    }

    // Set up timeout using Promise.race pattern for fake timer compatibility
    let timeoutResolve: (() => void) | undefined
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutResolve = resolve
      setTimeout(() => {
        timedOut = true
        resolve()
      }, timeoutDuration)
    })

    // Helper to race an async operation against timeout
    const raceWithTimeout = async <T>(
      promise: Promise<T>
    ): Promise<{ type: 'success'; value: T } | { type: 'timeout' }> => {
      const result = await Promise.race([
        promise.then((value) => ({ type: 'success' as const, value })),
        timeoutPromise.then(() => ({ type: 'timeout' as const })),
      ])
      return result
    }

    try {
      // Agent loop
      while (
        state.iteration < effectiveMaxIterations &&
        !state.goalAchieved &&
        !cancelled &&
        !timedOut
      ) {
        state.iteration++
        const iterationStartTime = Date.now()

        // Build tool results from previous iteration
        const toolResults: AIToolResult[] = state.toolResults.map((tc) => ({
          name: tc.tool,
          output: tc.output,
        }))

        // Prepare AI request
        const aiRequest: AIRequest = {
          model: effectiveModel,
          messages: enableMemory ? [...messages] : [messages[messages.length - 1]],
          tools: this.registeredTools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
          toolResults: toolResults.length > 0 ? toolResults : undefined,
          enableReasoning,
          systemPrompt: this.definition.systemPrompt,
        }

        // If we have queued tool calls from previous iteration, process them
        // instead of calling AI
        let aiResponse: AIResponse
        if (queuedToolCalls.length > 0) {
          // Simulate AI response with queued tool calls
          const callsToExecute = queuedToolCalls.splice(
            0,
            effectiveMaxToolCallsPerIteration
          )
          aiResponse = {
            content: '',
            toolCalls: callsToExecute,
            stopReason: 'tool_use',
            tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          }
        } else {
          // Call AI with timeout race
          const aiResult = await raceWithTimeout(this.aiClient!.chat(aiRequest))

          if (aiResult.type === 'timeout' || timedOut) {
            status = 'timeout'
            error = { name: 'TimeoutError', message: 'Execution timeout exceeded' }
            break
          }

          aiResponse = aiResult.value

          // Check cancellation after AI call
          if (cancelled) {
            status = 'cancelled'
            break
          }
        }

        // Check if this response would exceed budget before adding tokens
        if (this.tokenBudget) {
          const newTotal = totalTokens.totalTokens + aiResponse.tokens.totalTokens
          if (newTotal > this.tokenBudget) {
            error = {
              name: 'BudgetExceeded',
              message: 'Token budget exceeded',
            }
            break
          }
        }

        // Update tokens
        totalTokens.inputTokens += aiResponse.tokens.inputTokens
        totalTokens.outputTokens += aiResponse.tokens.outputTokens
        totalTokens.totalTokens += aiResponse.tokens.totalTokens

        // Store content
        if (aiResponse.content) {
          lastContent = aiResponse.content
        }

        // Add assistant message to history if memory enabled
        if (enableMemory && aiResponse.content) {
          messages.push({
            role: 'assistant',
            content: aiResponse.content,
            toolCalls: aiResponse.toolCalls,
          })
        }

        // Process tool calls
        const toolCallRecords: ToolCallRecord[] = []
        state.toolResults = []

        if (aiResponse.toolCalls && aiResponse.toolCalls.length > 0) {
          // Queue excess tool calls
          if (aiResponse.toolCalls.length > effectiveMaxToolCallsPerIteration) {
            queuedToolCalls = aiResponse.toolCalls.slice(
              effectiveMaxToolCallsPerIteration
            )
          }

          const callsToExecute = aiResponse.toolCalls.slice(
            0,
            effectiveMaxToolCallsPerIteration
          )

          // Execute tool calls (potentially in parallel)
          const toolCallPromises = callsToExecute.map(async (tc) => {
            const toolStartTime = Date.now()

            // Find tool definition
            const toolDef = this.registeredTools.find((t) => t.name === tc.name)

            // Check for handler
            const handler = this.toolHandlers.get(tc.name)

            // Determine error message based on what's missing
            // If tool is in definition but has no handler -> handler error
            // If tool is not in definition but could have been a typo -> not found error
            // If neither (tool not defined and no handler) -> use handler error for better DX
            if (!handler && !toolDef) {
              // Tool not in definition and no handler
              // Show "not found" for tools that don't exist in the definition
              return {
                tool: tc.name,
                input: tc.input,
                output: undefined,
                durationMs: Date.now() - toolStartTime,
                success: false,
                error: `Tool '${tc.name}' not found - no handler registered`,
              } as ToolCallRecord
            }

            if (!toolDef) {
              return {
                tool: tc.name,
                input: tc.input,
                output: undefined,
                durationMs: Date.now() - toolStartTime,
                success: false,
                error: `Tool '${tc.name}' not found in registered tools`,
              } as ToolCallRecord
            }

            if (!handler) {
              return {
                tool: tc.name,
                input: tc.input,
                output: undefined,
                durationMs: Date.now() - toolStartTime,
                success: false,
                error: `No handler registered for tool '${tc.name}'`,
              } as ToolCallRecord
            }

            // Validate input
            const validationError = this.validateToolInput(toolDef, tc.input)
            if (validationError) {
              return {
                tool: tc.name,
                input: tc.input,
                output: undefined,
                durationMs: Date.now() - toolStartTime,
                success: false,
                error: `Input validation failed: ${validationError}`,
              } as ToolCallRecord
            }

            // Check if approval is required
            const needsApproval = this.needsApproval(tc.name, toolDef, config)
            let approvalRecord:
              | { required: boolean; granted?: boolean; approvedBy?: string }
              | undefined

            if (needsApproval) {
              approvalRecord = { required: true }

              // Wait for approval
              const approvalTimeout = config?.requireApproval?.timeout
                ? parseDuration(config.requireApproval.timeout)
                : undefined

              try {
                const approval = await this.waitForApproval(
                  executionId,
                  tc.name,
                  tc.input,
                  approvalTimeout
                )

                approvalRecord.granted = approval.granted
                approvalRecord.approvedBy = approval.approvedBy

                if (!approval.granted) {
                  // Approval denied
                  return {
                    tool: tc.name,
                    input: tc.input,
                    output: undefined,
                    durationMs: Date.now() - toolStartTime,
                    success: false,
                    error: 'Approval denied',
                    approval: approvalRecord,
                  } as ToolCallRecord
                }
              } catch (err) {
                // Approval timeout
                approvalRecord.granted = false
                return {
                  tool: tc.name,
                  input: tc.input,
                  output: undefined,
                  durationMs: Date.now() - toolStartTime,
                  success: false,
                  error: 'Approval timeout',
                  approval: approvalRecord,
                } as ToolCallRecord
              }
            }

            // Execute tool with timeout race
            try {
              if (timedOut) {
                return {
                  tool: tc.name,
                  input: tc.input,
                  output: undefined,
                  durationMs: Date.now() - toolStartTime,
                  success: false,
                  error: 'Execution timeout',
                  approval: approvalRecord,
                } as ToolCallRecord
              }

              const toolResult = await raceWithTimeout(
                handler(tc.input, {
                  toolDefinition: toolDef,
                  executionContext: context || { executionId },
                })
              )

              if (toolResult.type === 'timeout' || timedOut) {
                return {
                  tool: tc.name,
                  input: tc.input,
                  output: undefined,
                  durationMs: Date.now() - toolStartTime,
                  success: false,
                  error: 'Tool execution timeout',
                  approval: approvalRecord,
                } as ToolCallRecord
              }

              toolsUsed.add(tc.name)
              return {
                tool: tc.name,
                input: tc.input,
                output: toolResult.value,
                durationMs: Date.now() - toolStartTime,
                success: true,
                approval: approvalRecord,
              } as ToolCallRecord
            } catch (err) {
              return {
                tool: tc.name,
                input: tc.input,
                output: undefined,
                durationMs: Date.now() - toolStartTime,
                success: false,
                error: err instanceof Error ? err.message : String(err),
                approval: approvalRecord,
              } as ToolCallRecord
            }
          })

          const results = await Promise.all(toolCallPromises)
          toolCallRecords.push(...results)
          state.toolResults = results

          // Add tool results to messages if memory enabled
          if (enableMemory) {
            for (const result of results) {
              messages.push({
                role: 'tool',
                content: JSON.stringify(result.output),
              })
            }
          }
        }

        // Create iteration record
        const iterationRecord: AgentIteration = {
          iteration: state.iteration,
          timestamp: iterationStartTime,
          reasoning: enableReasoning ? aiResponse.reasoning : undefined,
          toolCalls: toolCallRecords,
          tokens: aiResponse.tokens,
          durationMs: Date.now() - iterationStartTime,
        }

        trace.push(iterationRecord)

        // Check if goal achieved
        if (
          aiResponse.stopReason === 'end_turn' &&
          queuedToolCalls.length === 0
        ) {
          state.goalAchieved = true

          // Try to parse output if it looks like JSON
          try {
            state.output = JSON.parse(lastContent)
          } catch {
            state.output = lastContent
          }
        }

        // Check for timeout after iteration
        if (timedOut) {
          status = 'timeout'
          error = { name: 'TimeoutError', message: 'Execution timeout exceeded' }
          break
        }
      }

      // If we hit max iterations without achieving goal
      if (!state.goalAchieved && !error && status === 'completed') {
        // Try to parse last content as output
        try {
          state.output = JSON.parse(lastContent)
        } catch {
          state.output = lastContent
        }
      }
    } catch (err) {
      // Handle unexpected errors
      if (!error) {
        status = 'failed'
        error = {
          name: err instanceof Error ? err.name : 'Error',
          message: err instanceof Error ? err.message : String(err),
        }
      }
    }

    // Build reasoning summary
    let reasoningSummary: string | undefined
    if (enableReasoning) {
      const reasonings = trace
        .filter((t) => t.reasoning)
        .map((t) => t.reasoning!)
      if (reasonings.length > 0) {
        reasoningSummary = reasonings.join('\n')
      }
    }

    // Calculate cost estimate
    let costEstimate: number | undefined
    if (this.pricing) {
      costEstimate =
        (totalTokens.inputTokens * this.pricing.inputTokenPricePer1k) / 1000 +
        (totalTokens.outputTokens * this.pricing.outputTokenPricePer1k) / 1000
    }

    // Build execution info
    const agenticExecution: AgenticExecutionInfo & { costEstimate?: number } = {
      model: config?.model ?? this.definition.model ?? 'claude-3-sonnet',
      totalTokens,
      iterations: trace.length,
      trace,
      toolsUsed: [...toolsUsed],
      goalAchieved: state.goalAchieved,
      reasoningSummary,
      costEstimate,
    }

    const durationMs = Date.now() - startTime

    return {
      executionId,
      functionId: this.definition.id,
      functionVersion: this.definition.version,
      status,
      output: state.output as TOutput,
      error,
      metrics: {
        durationMs,
        inputSizeBytes: JSON.stringify(input).length,
        outputSizeBytes: state.output
          ? JSON.stringify(state.output).length
          : 0,
        retryCount: 0,
        tokens: totalTokens,
      },
      metadata: {
        startedAt: startTime,
        completedAt: Date.now(),
      },
      agenticExecution,
    }
  }

  // ===========================================================================
  // EXECUTE ITERATION (implements interface)
  // ===========================================================================

  async executeIteration(
    state: AgentState,
    context: ExecutionContext
  ): Promise<IterationResult> {
    // This is a simplified implementation for the interface
    // The main logic is in execute()
    return {
      state,
      toolCalls: [],
      continue: false,
    }
  }

  // ===========================================================================
  // EXECUTE TOOL (implements interface)
  // ===========================================================================

  async executeTool(
    tool: ToolDefinition,
    input: unknown,
    context: ExecutionContext
  ): Promise<unknown> {
    const handler = this.toolHandlers.get(tool.name)
    if (!handler) {
      throw new Error(`No handler registered for tool '${tool.name}'`)
    }

    return handler(input, {
      toolDefinition: tool,
      executionContext: context,
    })
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private validateToolInput(
    tool: ToolDefinition,
    input: unknown
  ): string | undefined {
    const schema = tool.inputSchema
    if (!schema || schema.type !== 'object') return undefined

    const inputObj = input as Record<string, unknown>

    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in inputObj)) {
          return `Missing required field: ${field} (validation error)`
        }
      }
    }

    return undefined
  }

  private needsApproval(
    toolName: string,
    toolDef: ToolDefinition,
    config?: AgenticFunctionConfig
  ): boolean {
    if (!config?.requireApproval) return false

    // Check if tool is in the approval list
    if (config.requireApproval.tools?.includes(toolName)) {
      return true
    }

    // Check if any action requires approval
    if (config.requireApproval.actions) {
      // Map tool names/types to actions
      const toolActionMap: Record<string, string[]> = {
        file_write: ['write_file'],
        email_send: ['send_email'],
        database_query: ['modify_data'],
        shell_exec: ['external_api'],
      }

      const toolActions = toolActionMap[toolName] || []
      for (const action of config.requireApproval.actions) {
        if (toolActions.includes(action)) {
          return true
        }
      }
    }

    return false
  }

  private waitForApproval(
    executionId: string,
    toolName: string,
    input: unknown,
    timeout?: number
  ): Promise<ApprovalRequest> {
    return new Promise((resolve, reject) => {
      const pending: PendingApproval = {
        toolName,
        input,
        resolve,
        reject,
      }

      // Set up timeout if specified
      if (timeout) {
        pending.timeoutId = setTimeout(() => {
          const pendingList = this.pendingApprovals.get(executionId)
          if (pendingList) {
            const index = pendingList.indexOf(pending)
            if (index !== -1) {
              pendingList.splice(index, 1)
            }
          }
          reject(new Error('Approval timeout'))
        }, timeout)
      }

      // Add to pending list
      if (!this.pendingApprovals.has(executionId)) {
        this.pendingApprovals.set(executionId, [])
      }
      this.pendingApprovals.get(executionId)!.push(pending)
    })
  }
}
