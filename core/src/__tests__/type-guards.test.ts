/**
 * Tests for type guard functions for FunctionType discriminated unions
 */
import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  isCodeFunction,
  isGenerativeFunction,
  isAgenticFunction,
  isHumanFunction,
  type AnyFunctionDefinition,
  type CodeFunctionDefinition,
  type GenerativeFunctionDefinition,
  type AgenticFunctionDefinition,
  type HumanFunctionDefinition,
} from '../index.js'

// Test fixtures
const codeFunction: CodeFunctionDefinition = {
  id: 'test-code',
  name: 'Test Code Function',
  version: '1.0.0',
  type: 'code',
  language: 'typescript',
  source: { type: 'inline', code: 'export default (x) => x' },
}

const generativeFunction: GenerativeFunctionDefinition = {
  id: 'test-generative',
  name: 'Test Generative Function',
  version: '1.0.0',
  type: 'generative',
  userPrompt: 'Generate a response for {{input}}',
  outputSchema: { type: 'object' },
}

const agenticFunction: AgenticFunctionDefinition = {
  id: 'test-agentic',
  name: 'Test Agentic Function',
  version: '1.0.0',
  type: 'agentic',
  systemPrompt: 'You are a helpful assistant.',
  goal: 'Complete the task',
  tools: [],
}

const humanFunction: HumanFunctionDefinition = {
  id: 'test-human',
  name: 'Test Human Function',
  version: '1.0.0',
  type: 'human',
  interactionType: 'approval',
  ui: {
    title: 'Approve this request',
  },
}

describe('Type Guards', () => {
  describe('isCodeFunction', () => {
    it('should return true for CodeFunctionDefinition', () => {
      expect(isCodeFunction(codeFunction)).toBe(true)
    })

    it('should return false for GenerativeFunctionDefinition', () => {
      expect(isCodeFunction(generativeFunction)).toBe(false)
    })

    it('should return false for AgenticFunctionDefinition', () => {
      expect(isCodeFunction(agenticFunction)).toBe(false)
    })

    it('should return false for HumanFunctionDefinition', () => {
      expect(isCodeFunction(humanFunction)).toBe(false)
    })

    it('should narrow type to CodeFunctionDefinition', () => {
      const fn: AnyFunctionDefinition = codeFunction
      if (isCodeFunction(fn)) {
        // Type should be narrowed - these properties only exist on CodeFunctionDefinition
        expectTypeOf(fn).toEqualTypeOf<CodeFunctionDefinition>()
        expect(fn.language).toBe('typescript')
        expect(fn.source).toEqual({ type: 'inline', code: 'export default (x) => x' })
      }
    })
  })

  describe('isGenerativeFunction', () => {
    it('should return true for GenerativeFunctionDefinition', () => {
      expect(isGenerativeFunction(generativeFunction)).toBe(true)
    })

    it('should return false for CodeFunctionDefinition', () => {
      expect(isGenerativeFunction(codeFunction)).toBe(false)
    })

    it('should return false for AgenticFunctionDefinition', () => {
      expect(isGenerativeFunction(agenticFunction)).toBe(false)
    })

    it('should return false for HumanFunctionDefinition', () => {
      expect(isGenerativeFunction(humanFunction)).toBe(false)
    })

    it('should narrow type to GenerativeFunctionDefinition', () => {
      const fn: AnyFunctionDefinition = generativeFunction
      if (isGenerativeFunction(fn)) {
        // Type should be narrowed - these properties only exist on GenerativeFunctionDefinition
        expectTypeOf(fn).toEqualTypeOf<GenerativeFunctionDefinition>()
        expect(fn.userPrompt).toBe('Generate a response for {{input}}')
        expect(fn.outputSchema).toEqual({ type: 'object' })
      }
    })
  })

  describe('isAgenticFunction', () => {
    it('should return true for AgenticFunctionDefinition', () => {
      expect(isAgenticFunction(agenticFunction)).toBe(true)
    })

    it('should return false for CodeFunctionDefinition', () => {
      expect(isAgenticFunction(codeFunction)).toBe(false)
    })

    it('should return false for GenerativeFunctionDefinition', () => {
      expect(isAgenticFunction(generativeFunction)).toBe(false)
    })

    it('should return false for HumanFunctionDefinition', () => {
      expect(isAgenticFunction(humanFunction)).toBe(false)
    })

    it('should narrow type to AgenticFunctionDefinition', () => {
      const fn: AnyFunctionDefinition = agenticFunction
      if (isAgenticFunction(fn)) {
        // Type should be narrowed - these properties only exist on AgenticFunctionDefinition
        expectTypeOf(fn).toEqualTypeOf<AgenticFunctionDefinition>()
        expect(fn.systemPrompt).toBe('You are a helpful assistant.')
        expect(fn.goal).toBe('Complete the task')
        expect(fn.tools).toEqual([])
      }
    })
  })

  describe('isHumanFunction', () => {
    it('should return true for HumanFunctionDefinition', () => {
      expect(isHumanFunction(humanFunction)).toBe(true)
    })

    it('should return false for CodeFunctionDefinition', () => {
      expect(isHumanFunction(codeFunction)).toBe(false)
    })

    it('should return false for GenerativeFunctionDefinition', () => {
      expect(isHumanFunction(generativeFunction)).toBe(false)
    })

    it('should return false for AgenticFunctionDefinition', () => {
      expect(isHumanFunction(agenticFunction)).toBe(false)
    })

    it('should narrow type to HumanFunctionDefinition', () => {
      const fn: AnyFunctionDefinition = humanFunction
      if (isHumanFunction(fn)) {
        // Type should be narrowed - these properties only exist on HumanFunctionDefinition
        expectTypeOf(fn).toEqualTypeOf<HumanFunctionDefinition>()
        expect(fn.interactionType).toBe('approval')
        expect(fn.ui.title).toBe('Approve this request')
      }
    })
  })

  describe('exhaustive type handling', () => {
    it('should allow exhaustive switch over function types', () => {
      const functions: AnyFunctionDefinition[] = [
        codeFunction,
        generativeFunction,
        agenticFunction,
        humanFunction,
      ]

      const types = functions.map((fn) => {
        if (isCodeFunction(fn)) return 'code'
        if (isGenerativeFunction(fn)) return 'generative'
        if (isAgenticFunction(fn)) return 'agentic'
        if (isHumanFunction(fn)) return 'human'
        // TypeScript should know this is unreachable
        return 'unknown'
      })

      expect(types).toEqual(['code', 'generative', 'agentic', 'human'])
    })
  })
})
