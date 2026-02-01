/**
 * Agentic Executor - Autonomous Agents Integration Tests
 *
 * Tests for the integration between AgenticExecutor and the autonomous-agents package.
 * This validates:
 * - Agent creation with roles and goals
 * - Tool execution through autonomous agent
 * - Multi-iteration loops
 * - Decision making and question answering
 * - Agent state management
 *
 * @module tiers/__tests__/agentic-executor-autonomous.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type {
  AgenticFunctionDefinition,
  AgenticFunctionConfig,
  ToolDefinition,
} from '../../../core/src/agentic/index.js'
import {
  defineAgenticFunction,
  defineTool,
  builtinTool,
} from '../../../core/src/agentic/index.js'
import type { ExecutionContext, TokenUsage } from '../../../core/src/types.js'

import { AgenticExecutor } from '../agentic-executor.js'

// =============================================================================
// MOCK AI CLIENT
// =============================================================================

interface MockAIResponse {
  content: string
  toolCalls?: Array<{ name: string; input: unknown }>
  reasoning?: string
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
  tokens: TokenUsage
}

interface MockAIClient {
  chat: ReturnType<typeof vi.fn>
  responses: MockAIResponse[]
  callIndex: number
}

function createMockAIClient(responses: MockAIResponse[]): MockAIClient {
  let callIndex = 0
  const chat = vi.fn().mockImplementation(async () => {
    const response = responses[callIndex] ?? responses[responses.length - 1]
    callIndex++
    return response
  })

  return { chat, responses, callIndex }
}

// =============================================================================
// MOCK TOOL HANDLERS
// =============================================================================

function createMockToolHandler(response: unknown, delay = 0) {
  return vi.fn().mockImplementation(async (_input: unknown) => {
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay))
    }
    return response
  })
}

// =============================================================================
// TEST FIXTURES
// =============================================================================

function createTestAgenticDefinition(
  overrides: Partial<AgenticFunctionDefinition> = {}
): AgenticFunctionDefinition {
  return defineAgenticFunction({
    id: 'test-agent',
    name: 'Test Agent',
    version: '1.0.0',
    description: 'A test agentic function',
    systemPrompt: 'You are a helpful assistant.',
    goal: 'Complete the user request',
    tools: [],
    ...overrides,
  })
}

function createSearchTool(): ToolDefinition {
  return defineTool(
    'search',
    'Search for information',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    { type: 'builtin', name: 'web_search' }
  )
}

function createCalculatorTool(): ToolDefinition {
  return defineTool(
    'calculator',
    'Perform mathematical calculations',
    {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Math expression' },
      },
      required: ['expression'],
    },
    { type: 'inline', handler: 'eval(input.expression)' }
  )
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('AgenticExecutor - Autonomous Agents Integration', () => {
  let executor: AgenticExecutor
  let mockAI: MockAIClient
  let mockEnv: Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockEnv = {
      AI_API_KEY: 'test-key',
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===========================================================================
  // 1. AUTONOMOUS AGENT CREATION
  // ===========================================================================

  describe('autonomous agent creation', () => {
    it('should create an autonomous agent from definition', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Task completed.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        },
      ])

      const definition = createTestAgenticDefinition({
        name: 'TestAgent',
        systemPrompt: 'You are a helpful test agent.',
        goal: 'Answer questions accurately',
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, mockAI, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const agent = executor.getAutonomousAgent()

      expect(agent).toBeDefined()
      expect(agent.config.name).toBe('TestAgent')
      expect(agent.config.role.description).toBe('You are a helpful test agent.')
      expect(agent.config.goals).toHaveLength(1)
      expect(agent.config.goals![0].description).toBe('Answer questions accurately')
    })

    it('should convert ToolDefinitions to AIFunctionDefinitions', async () => {
      const definition = createTestAgenticDefinition({
        tools: [createSearchTool(), createCalculatorTool()],
      })

      executor = new AgenticExecutor(definition, undefined, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))
      executor.registerToolHandler('calculator', createMockToolHandler({ result: 42 }))

      const agent = executor.getAutonomousAgent()

      expect(agent.config.tools).toHaveLength(2)
      expect(agent.config.tools![0].name).toBe('search')
      expect(agent.config.tools![1].name).toBe('calculator')
    })

    it('should create agent with correct role and skills', async () => {
      const definition = createTestAgenticDefinition({
        name: 'SkillfulAgent',
        systemPrompt: 'You are a skilled assistant with multiple capabilities.',
      })

      executor = new AgenticExecutor(definition, undefined, mockEnv)

      const agent = executor.getAutonomousAgent()

      expect(agent.config.role.name).toBe('SkillfulAgent')
      expect(agent.config.role.skills).toContain('reasoning')
      expect(agent.config.role.skills).toContain('tool-use')
      expect(agent.config.role.skills).toContain('planning')
    })

    it('should reuse the same agent instance', async () => {
      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, undefined, mockEnv)

      const agent1 = executor.getAutonomousAgent()
      const agent2 = executor.getAutonomousAgent()

      expect(agent1).toBe(agent2)
    })
  })

  // ===========================================================================
  // 2. TOOL EXECUTION WITH AUTONOMOUS AGENT
  // ===========================================================================

  describe('tool execution with autonomous agent', () => {
    it('should register tool handlers that work with autonomous agent', async () => {
      const searchHandler = createMockToolHandler({ results: ['result1', 'result2'] })

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, undefined, mockEnv)
      executor.registerToolHandler('search', searchHandler)

      const agent = executor.getAutonomousAgent()

      // Verify the tool is accessible through the agent
      expect(agent.config.tools).toBeDefined()
      expect(agent.config.tools!.length).toBeGreaterThan(0)

      const searchTool = agent.config.tools!.find((t) => t.name === 'search')
      expect(searchTool).toBeDefined()
    })

    it('should only include tools with registered handlers', async () => {
      const definition = createTestAgenticDefinition({
        tools: [createSearchTool(), createCalculatorTool()],
      })

      executor = new AgenticExecutor(definition, undefined, mockEnv)
      // Only register handler for search, not calculator
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const agent = executor.getAutonomousAgent()

      // Should only have the search tool since calculator has no handler
      expect(agent.config.tools).toHaveLength(1)
      expect(agent.config.tools![0].name).toBe('search')
    })
  })

  // ===========================================================================
  // 3. DECISION MAKING
  // ===========================================================================

  describe('decision making', () => {
    it('should make decisions using the autonomous agent', async () => {
      mockAI = createMockAIClient([
        {
          content: JSON.stringify({ decision: 'option A', reasoning: 'Best choice', confidence: 0.9 }),
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
      ])

      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      // Note: This will use the autonomous agent's decide method
      // which internally uses ai-functions
      const agent = executor.getAutonomousAgent()
      expect(agent.decide).toBeDefined()
    })

    it('should ask questions using the autonomous agent', async () => {
      mockAI = createMockAIClient([
        {
          content: JSON.stringify({ answer: 'The answer is 42', reasoning: 'Deep thought' }),
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        },
      ])

      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const agent = executor.getAutonomousAgent()
      expect(agent.ask).toBeDefined()
    })
  })

  // ===========================================================================
  // 4. AGENT STATE MANAGEMENT
  // ===========================================================================

  describe('agent state management', () => {
    it('should track agent status', async () => {
      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, undefined, mockEnv)

      const agent = executor.getAutonomousAgent()

      expect(agent.status).toBe('idle')
    })

    it('should manage agent state', async () => {
      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, undefined, mockEnv)

      const agent = executor.getAutonomousAgent()

      agent.setState('testKey', 'testValue')
      expect(agent.getState('testKey')).toBe('testValue')
    })

    it('should track agent history', async () => {
      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, undefined, mockEnv)

      const agent = executor.getAutonomousAgent()

      const history = agent.getHistory()
      expect(Array.isArray(history)).toBe(true)
    })

    it('should reset agent state', async () => {
      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, undefined, mockEnv)

      const agent = executor.getAutonomousAgent()

      agent.setState('key1', 'value1')
      agent.reset()

      expect(agent.getState('key1')).toBeUndefined()
      expect(agent.status).toBe('idle')
    })
  })

  // ===========================================================================
  // 5. GOALS AND ROLES
  // ===========================================================================

  describe('goals and roles', () => {
    it('should create agent with primary goal from definition', async () => {
      const definition = createTestAgenticDefinition({
        goal: 'Complete complex research tasks',
      })

      executor = new AgenticExecutor(definition, undefined, mockEnv)

      const agent = executor.getAutonomousAgent()

      expect(agent.config.goals).toHaveLength(1)
      expect(agent.config.goals![0].description).toBe('Complete complex research tasks')
      expect(agent.config.goals![0].status).toBe('active')
      expect(agent.config.goals![0].priority).toBe('high')
    })

    it('should create role with tools', async () => {
      const definition = createTestAgenticDefinition({
        name: 'ResearchAgent',
        systemPrompt: 'You are a research agent.',
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, undefined, mockEnv)
      executor.registerToolHandler('search', createMockToolHandler({ results: [] }))

      const agent = executor.getAutonomousAgent()

      expect(agent.config.role.name).toBe('ResearchAgent')
      expect(agent.config.role.tools).toHaveLength(1)
    })
  })

  // ===========================================================================
  // 6. EXECUTION MODE
  // ===========================================================================

  describe('execution mode', () => {
    it('should create agent in autonomous mode', async () => {
      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, undefined, mockEnv)

      const agent = executor.getAutonomousAgent()

      expect(agent.config.mode).toBe('autonomous')
    })

    it('should use max iterations from definition', async () => {
      const definition = createTestAgenticDefinition({
        maxIterations: 5,
      })

      executor = new AgenticExecutor(definition, undefined, mockEnv)

      const agent = executor.getAutonomousAgent()

      expect(agent.config.maxIterations).toBe(5)
    })

    it('should use model from definition', async () => {
      const definition = createTestAgenticDefinition({
        model: 'claude-4-opus',
      })

      executor = new AgenticExecutor(definition, undefined, mockEnv)

      const agent = executor.getAutonomousAgent()

      expect(agent.config.model).toBe('claude-4-opus')
    })
  })

  // ===========================================================================
  // 7. CONTEXT PROPAGATION
  // ===========================================================================

  describe('context propagation', () => {
    it('should pass environment to agent context', async () => {
      const customEnv = {
        API_KEY: 'secret-key',
        DATABASE_URL: 'postgres://localhost',
      }

      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, undefined, customEnv)

      const agent = executor.getAutonomousAgent()

      expect(agent.config.context).toEqual(customEnv)
    })

    it('should use system prompt from definition', async () => {
      const definition = createTestAgenticDefinition({
        systemPrompt: 'You are a specialized agent for data analysis.',
      })

      executor = new AgenticExecutor(definition, undefined, mockEnv)

      const agent = executor.getAutonomousAgent()

      expect(agent.config.system).toBe('You are a specialized agent for data analysis.')
    })
  })

  // ===========================================================================
  // 8. INTEGRATION WITH EXISTING EXECUTOR
  // ===========================================================================

  describe('integration with existing executor', () => {
    it('should maintain backward compatibility with existing execute method', async () => {
      mockAI = createMockAIClient([
        {
          content: 'Direct response from AI.',
          stopReason: 'end_turn',
          tokens: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        },
      ])

      const definition = createTestAgenticDefinition()
      executor = new AgenticExecutor(definition, mockAI, mockEnv)

      const resultPromise = executor.execute(
        { question: 'Test question' },
        {},
        { executionId: 'test-exec-1' }
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.status).toBe('completed')
      expect(result.agenticExecution).toBeDefined()
    })

    it('should share tool handlers between execution methods', async () => {
      const searchHandler = createMockToolHandler({ results: ['shared result'] })

      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, undefined, mockEnv)
      executor.registerToolHandler('search', searchHandler)

      // Tool should be available to both execution paths
      const agent = executor.getAutonomousAgent()
      expect(agent.config.tools!.length).toBe(1)

      // And through the standard executor
      expect(executor.getRegisteredTools()).toHaveLength(1)
    })
  })

  // ===========================================================================
  // 9. ERROR HANDLING
  // ===========================================================================

  describe('error handling', () => {
    it('should handle missing tool handlers gracefully', async () => {
      const definition = createTestAgenticDefinition({
        tools: [createSearchTool()],
      })

      executor = new AgenticExecutor(definition, undefined, mockEnv)
      // Not registering any handlers

      const agent = executor.getAutonomousAgent()

      // Agent should be created but with no tools (since no handlers registered)
      expect(agent.config.tools).toHaveLength(0)
    })

    it('should handle agent creation with empty tools', async () => {
      const definition = createTestAgenticDefinition({
        tools: [],
      })

      executor = new AgenticExecutor(definition, undefined, mockEnv)

      const agent = executor.getAutonomousAgent()

      expect(agent).toBeDefined()
      expect(agent.config.tools).toHaveLength(0)
    })
  })
})
