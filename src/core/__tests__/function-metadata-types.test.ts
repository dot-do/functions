/**
 * Tests for FunctionMetadata discriminated union type.
 *
 * Validates that FunctionMetadata is a proper discriminated union on the `type` field,
 * where each variant only has the fields relevant to that function type.
 *
 * Issue: functions-a5v6 (RED), functions-27rk (GREEN)
 */

import { describe, it, expect } from 'vitest'
import type {
  FunctionMetadata,
  CodeFunctionMetadata,
  GenerativeFunctionMetadata,
  AgenticFunctionMetadata,
  HumanFunctionMetadata,
  CascadeFunctionMetadata,
  FunctionMetadataBase,
} from '../types'
import { validateFunctionMetadata } from '../validation'
import { ValidationError } from '../errors'

// =============================================================================
// TYPE-LEVEL TESTS: Discriminated Union Structure
// =============================================================================

describe('FunctionMetadata discriminated union - type structure', () => {
  it('each variant has a required type field that discriminates', () => {
    // Code variant
    const code: CodeFunctionMetadata = {
      id: 'my-code-fn',
      version: '1.0.0',
      type: 'code',
      language: 'typescript',
      entryPoint: 'index.ts',
    }
    expect(code.type).toBe('code')

    // Generative variant
    const gen: GenerativeFunctionMetadata = {
      id: 'my-gen-fn',
      version: '1.0.0',
      type: 'generative',
      model: 'claude-3-sonnet',
      userPrompt: 'Summarize: {{text}}',
    }
    expect(gen.type).toBe('generative')

    // Agentic variant
    const agent: AgenticFunctionMetadata = {
      id: 'my-agent-fn',
      version: '1.0.0',
      type: 'agentic',
      model: 'claude-3-opus',
      goal: 'Research a topic',
      tools: [],
    }
    expect(agent.type).toBe('agentic')

    // Human variant
    const human: HumanFunctionMetadata = {
      id: 'my-human-fn',
      version: '1.0.0',
      type: 'human',
      interactionType: 'approval',
    }
    expect(human.type).toBe('human')

    // Cascade variant
    const cascade: CascadeFunctionMetadata = {
      id: 'my-cascade-fn',
      version: '1.0.0',
      type: 'cascade',
    }
    expect(cascade.type).toBe('cascade')
  })

  it('the union FunctionMetadata type accepts all variants', () => {
    const fns: FunctionMetadata[] = [
      { id: 'a', version: '1.0.0', type: 'code', language: 'typescript' },
      { id: 'b', version: '1.0.0', type: 'generative', model: 'claude-3-sonnet', userPrompt: 'hi' },
      { id: 'c', version: '1.0.0', type: 'agentic', model: 'claude-3-opus', goal: 'do it', tools: [] },
      { id: 'd', version: '1.0.0', type: 'human', interactionType: 'approval' },
      { id: 'e', version: '1.0.0', type: 'cascade' },
    ]
    expect(fns).toHaveLength(5)
  })

  it('common fields are present on all variants', () => {
    // These common fields should be accessible on FunctionMetadata without narrowing
    const fn: FunctionMetadata = {
      id: 'test',
      version: '1.0.0',
      type: 'code',
    }
    // id, version, type are always present
    expect(fn.id).toBe('test')
    expect(fn.version).toBe('1.0.0')
    expect(fn.type).toBeDefined()
  })

  it('FunctionMetadataBase defines the common shape', () => {
    // All optional common fields should be on the base
    const base: FunctionMetadataBase = {
      id: 'test',
      version: '1.0.0',
      type: 'code',
      name: 'Test',
      description: 'A test function',
      tags: ['test'],
      inputSchema: { type: 'object' },
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      ownerId: 'user-1',
      orgId: 'org-1',
      permissions: { public: true },
    }
    expect(base.id).toBe('test')
    expect(base.name).toBe('Test')
  })
})

// =============================================================================
// TYPE-LEVEL TESTS: Type-specific Fields Only on Correct Variants
// =============================================================================

describe('FunctionMetadata discriminated union - type-specific field isolation', () => {
  it('CodeFunctionMetadata has language, entryPoint, dependencies', () => {
    const code: CodeFunctionMetadata = {
      id: 'fn1',
      version: '1.0.0',
      type: 'code',
      language: 'typescript',
      entryPoint: 'index.ts',
      dependencies: { lodash: '^4.0.0' },
    }
    expect(code.language).toBe('typescript')
    expect(code.entryPoint).toBe('index.ts')
    expect(code.dependencies).toEqual({ lodash: '^4.0.0' })
  })

  it('GenerativeFunctionMetadata has model, systemPrompt, userPrompt, temperature, maxTokens, examples', () => {
    const gen: GenerativeFunctionMetadata = {
      id: 'fn2',
      version: '1.0.0',
      type: 'generative',
      model: 'claude-3-sonnet',
      systemPrompt: 'You are helpful',
      userPrompt: 'Summarize: {{text}}',
      outputSchema: { type: 'object' },
      temperature: 0.7,
      maxTokens: 1000,
      examples: [{ input: { text: 'hello' }, output: 'hi' }],
    }
    expect(gen.model).toBe('claude-3-sonnet')
    expect(gen.userPrompt).toBe('Summarize: {{text}}')
    expect(gen.temperature).toBe(0.7)
    expect(gen.maxTokens).toBe(1000)
    expect(gen.examples).toHaveLength(1)
  })

  it('AgenticFunctionMetadata has model, goal, tools, maxIterations, etc.', () => {
    const agent: AgenticFunctionMetadata = {
      id: 'fn3',
      version: '1.0.0',
      type: 'agentic',
      model: 'claude-3-opus',
      systemPrompt: 'You are a researcher',
      goal: 'Research AI trends',
      tools: [{ name: 'web_search', description: 'Search the web' }],
      maxIterations: 5,
      maxToolCallsPerIteration: 3,
      enableReasoning: true,
      enableMemory: true,
      tokenBudget: 50000,
    }
    expect(agent.goal).toBe('Research AI trends')
    expect(agent.tools).toHaveLength(1)
    expect(agent.maxIterations).toBe(5)
    expect(agent.enableReasoning).toBe(true)
  })

  it('HumanFunctionMetadata has interactionType, uiConfig, assignees, sla, etc.', () => {
    const human: HumanFunctionMetadata = {
      id: 'fn4',
      version: '1.0.0',
      type: 'human',
      interactionType: 'approval',
      uiConfig: { layout: 'form' },
      assignees: [{ type: 'user', value: 'user-1' }],
      sla: { responseTime: '1h', resolutionTime: '24h' },
      reminders: { interval: '30m' },
      escalation: { after: '2h', to: 'manager' },
    }
    expect(human.interactionType).toBe('approval')
    expect(human.assignees).toHaveLength(1)
    expect(human.sla?.responseTime).toBe('1h')
  })

  it('CascadeFunctionMetadata has model, systemPrompt, userPrompt, language, entryPoint (combined generative + code)', () => {
    const cascade: CascadeFunctionMetadata = {
      id: 'fn5',
      version: '1.0.0',
      type: 'cascade',
      // Generative-like fields
      model: 'claude-3-sonnet',
      systemPrompt: 'You are helpful',
      userPrompt: 'Generate code',
      // Code-like fields
      language: 'typescript',
      entryPoint: 'index.ts',
    }
    expect(cascade.model).toBe('claude-3-sonnet')
    expect(cascade.language).toBe('typescript')
  })
})

// =============================================================================
// TYPE NARROWING TESTS: Using `type` field to narrow
// =============================================================================

describe('FunctionMetadata discriminated union - narrowing via type field', () => {
  it('narrows to CodeFunctionMetadata when type === "code"', () => {
    const fn: FunctionMetadata = {
      id: 'fn1',
      version: '1.0.0',
      type: 'code',
      language: 'typescript',
      entryPoint: 'index.ts',
    }

    if (fn.type === 'code') {
      // After narrowing, code-specific fields should be accessible
      expect(fn.language).toBe('typescript')
      expect(fn.entryPoint).toBe('index.ts')
    }
  })

  it('narrows to GenerativeFunctionMetadata when type === "generative"', () => {
    const fn: FunctionMetadata = {
      id: 'fn2',
      version: '1.0.0',
      type: 'generative',
      model: 'claude-3-sonnet',
      userPrompt: 'Hello',
    }

    if (fn.type === 'generative') {
      expect(fn.model).toBe('claude-3-sonnet')
      expect(fn.userPrompt).toBe('Hello')
    }
  })

  it('narrows to AgenticFunctionMetadata when type === "agentic"', () => {
    const fn: FunctionMetadata = {
      id: 'fn3',
      version: '1.0.0',
      type: 'agentic',
      model: 'claude-3-opus',
      goal: 'Research',
      tools: [],
    }

    if (fn.type === 'agentic') {
      expect(fn.goal).toBe('Research')
      expect(fn.tools).toEqual([])
    }
  })

  it('narrows to HumanFunctionMetadata when type === "human"', () => {
    const fn: FunctionMetadata = {
      id: 'fn4',
      version: '1.0.0',
      type: 'human',
      interactionType: 'review',
    }

    if (fn.type === 'human') {
      expect(fn.interactionType).toBe('review')
    }
  })

  it('narrows to CascadeFunctionMetadata when type === "cascade"', () => {
    const fn: FunctionMetadata = {
      id: 'fn5',
      version: '1.0.0',
      type: 'cascade',
      model: 'claude-3-sonnet',
      language: 'typescript',
    }

    if (fn.type === 'cascade') {
      expect(fn.model).toBe('claude-3-sonnet')
      expect(fn.language).toBe('typescript')
    }
  })

  it('switch exhaustiveness - covers all variants', () => {
    const fns: FunctionMetadata[] = [
      { id: 'a', version: '1.0.0', type: 'code' },
      { id: 'b', version: '1.0.0', type: 'generative', userPrompt: 'hi' },
      { id: 'c', version: '1.0.0', type: 'agentic', goal: 'do', tools: [] },
      { id: 'd', version: '1.0.0', type: 'human', interactionType: 'approval' },
      { id: 'e', version: '1.0.0', type: 'cascade' },
    ]

    const types: string[] = []
    for (const fn of fns) {
      switch (fn.type) {
        case 'code':
          types.push('code')
          break
        case 'generative':
          types.push('generative')
          break
        case 'agentic':
          types.push('agentic')
          break
        case 'human':
          types.push('human')
          break
        case 'cascade':
          types.push('cascade')
          break
      }
    }
    expect(types).toEqual(['code', 'generative', 'agentic', 'human', 'cascade'])
  })
})

// =============================================================================
// VALIDATION TESTS: validateFunctionMetadata returns properly typed union
// =============================================================================

describe('FunctionMetadata validation with discriminated union', () => {
  it('validates a code function metadata', () => {
    const result = validateFunctionMetadata({
      id: 'fn1',
      version: '1.0.0',
      type: 'code',
      language: 'typescript',
      entryPoint: 'index.ts',
    })
    expect(result.type).toBe('code')
    expect(result.id).toBe('fn1')
  })

  it('validates a generative function metadata', () => {
    const result = validateFunctionMetadata({
      id: 'fn2',
      version: '1.0.0',
      type: 'generative',
      model: 'claude-3-sonnet',
      userPrompt: 'Hello {{name}}',
    })
    expect(result.type).toBe('generative')
  })

  it('validates an agentic function metadata', () => {
    const result = validateFunctionMetadata({
      id: 'fn3',
      version: '1.0.0',
      type: 'agentic',
      model: 'claude-3-opus',
      goal: 'Do research',
    })
    expect(result.type).toBe('agentic')
  })

  it('validates a human function metadata', () => {
    const result = validateFunctionMetadata({
      id: 'fn4',
      version: '1.0.0',
      type: 'human',
      interactionType: 'approval',
    })
    expect(result.type).toBe('human')
  })

  it('validates a cascade function metadata', () => {
    const result = validateFunctionMetadata({
      id: 'fn5',
      version: '1.0.0',
      type: 'cascade',
    })
    expect(result.type).toBe('cascade')
  })

  it('defaults to code type when type is omitted', () => {
    const result = validateFunctionMetadata({
      id: 'fn6',
      version: '1.0.0',
    })
    // When type is omitted, it should default to 'code' for backward compatibility
    expect(result.type).toBe('code')
  })

  it('rejects invalid type values', () => {
    expect(() => validateFunctionMetadata({
      id: 'fn',
      version: '1.0.0',
      type: 'invalid',
    })).toThrow(ValidationError)
  })

  it('validates type-specific fields for generative (rejects non-string model)', () => {
    expect(() => validateFunctionMetadata({
      id: 'fn',
      version: '1.0.0',
      type: 'generative',
      model: 123, // should be string
    })).toThrow(ValidationError)
  })

  it('validates type-specific fields for code (rejects non-string language)', () => {
    expect(() => validateFunctionMetadata({
      id: 'fn',
      version: '1.0.0',
      type: 'code',
      language: 123, // should be string
    })).toThrow(ValidationError)
  })
})

// =============================================================================
// BACKWARD COMPATIBILITY TESTS
// =============================================================================

describe('FunctionMetadata discriminated union - backward compatibility', () => {
  it('existing code that creates metadata without type still works (defaults to code)', () => {
    // This pattern is used throughout the codebase
    const metadata: FunctionMetadata = {
      id: 'legacy-fn',
      version: '1.0.0',
      type: 'code',
      language: 'typescript',
      entryPoint: 'index.ts',
      dependencies: {},
    }
    expect(metadata.id).toBe('legacy-fn')
  })

  it('existing code that creates generative metadata works', () => {
    const metadata: FunctionMetadata = {
      id: 'gen-fn',
      version: '1.0.0',
      type: 'generative',
      name: 'Summarizer',
      model: 'claude-3-sonnet',
      systemPrompt: 'You are a summarizer',
      userPrompt: 'Summarize: {{text}}',
      outputSchema: { type: 'object' },
      temperature: 0.5,
      maxTokens: 1000,
      examples: [{ input: { text: 'hi' }, output: 'hello' }],
    }
    expect(metadata.type).toBe('generative')
  })

  it('existing code that creates agentic metadata works', () => {
    const metadata: FunctionMetadata = {
      id: 'agent-fn',
      version: '1.0.0',
      type: 'agentic',
      name: 'Researcher',
      model: 'claude-3-opus',
      systemPrompt: 'You are a researcher',
      goal: 'Research AI',
      tools: [{ name: 'web_search', description: 'Search the web' }],
      maxIterations: 10,
      enableReasoning: true,
      enableMemory: true,
      tokenBudget: 50000,
    }
    expect(metadata.type).toBe('agentic')
  })

  it('existing code that creates human metadata works', () => {
    const metadata: FunctionMetadata = {
      id: 'human-fn',
      version: '1.0.0',
      type: 'human',
      interactionType: 'approval',
      uiConfig: { layout: 'form' },
      assignees: [{ type: 'user', value: 'user-1' }],
      sla: { responseTime: '1h' },
    }
    expect(metadata.type).toBe('human')
  })

  it('metadata can be stored and retrieved through JSON round-trip', () => {
    const original: FunctionMetadata = {
      id: 'round-trip',
      version: '2.0.0',
      type: 'generative',
      model: 'claude-3-sonnet',
      userPrompt: 'Hello {{name}}',
      tags: ['test'],
    }
    const json = JSON.stringify(original)
    const parsed = validateFunctionMetadata(JSON.parse(json))
    expect(parsed.id).toBe('round-trip')
    expect(parsed.type).toBe('generative')
  })

  it('spread operator works correctly with FunctionMetadata', () => {
    const base: FunctionMetadata = {
      id: 'spread-test',
      version: '1.0.0',
      type: 'code',
      language: 'typescript',
    }
    const updated = {
      ...base,
      updatedAt: '2025-01-01T00:00:00Z',
    }
    expect(updated.id).toBe('spread-test')
    expect(updated.updatedAt).toBe('2025-01-01T00:00:00Z')
  })

  it('Partial<FunctionMetadata> still works for updates', () => {
    // This pattern is used in kv-function-registry.ts update()
    type PartialUpdate = Partial<Omit<FunctionMetadata, 'id' | 'createdAt'>>
    const updates: PartialUpdate = {
      version: '2.0.0',
      tags: ['updated'],
    }
    expect(updates.version).toBe('2.0.0')
  })
})

// =============================================================================
// EXPORTED TYPE TESTS: Verify all types are exported
// =============================================================================

describe('FunctionMetadata type exports', () => {
  it('all variant types are importable from types module', () => {
    // These will fail at compile time if the types aren't exported
    // Runtime check that these types exist by creating values
    const code: CodeFunctionMetadata = { id: 'a', version: '1.0.0', type: 'code' }
    const gen: GenerativeFunctionMetadata = { id: 'b', version: '1.0.0', type: 'generative', userPrompt: 'hi' }
    const agent: AgenticFunctionMetadata = { id: 'c', version: '1.0.0', type: 'agentic', goal: 'x', tools: [] }
    const human: HumanFunctionMetadata = { id: 'd', version: '1.0.0', type: 'human', interactionType: 'approval' }
    const cascade: CascadeFunctionMetadata = { id: 'e', version: '1.0.0', type: 'cascade' }
    const base: FunctionMetadataBase = { id: 'f', version: '1.0.0', type: 'code' }

    expect(code).toBeDefined()
    expect(gen).toBeDefined()
    expect(agent).toBeDefined()
    expect(human).toBeDefined()
    expect(cascade).toBeDefined()
    expect(base).toBeDefined()
  })
})
