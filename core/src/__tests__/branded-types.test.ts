/**
 * Tests for branded/nominal types for IDs
 *
 * These types prevent accidental mixing of different ID types
 * (FunctionId, ExecutionId, WorkflowId) at compile time.
 */
import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  type FunctionId,
  type ExecutionId,
  type WorkflowId,
  functionId,
  executionId,
  workflowId,
} from '../index.js'

describe('Branded Types', () => {
  describe('FunctionId', () => {
    it('should create a FunctionId from a string', () => {
      const id = functionId('func-123')
      expect(id).toBe('func-123')
    })

    it('should be a string at runtime', () => {
      const id = functionId('func-123')
      expect(typeof id).toBe('string')
    })

    it('should have the FunctionId type', () => {
      const id = functionId('func-123')
      expectTypeOf(id).toEqualTypeOf<FunctionId>()
    })

    it('should not be assignable to ExecutionId', () => {
      const funcId = functionId('func-123')
      // @ts-expect-error - FunctionId should not be assignable to ExecutionId
      const _execId: ExecutionId = funcId
      expect(_execId).toBe(funcId) // Runtime equality, but type error
    })

    it('should not be assignable to WorkflowId', () => {
      const funcId = functionId('func-123')
      // @ts-expect-error - FunctionId should not be assignable to WorkflowId
      const _workflowId: WorkflowId = funcId
      expect(_workflowId).toBe(funcId) // Runtime equality, but type error
    })
  })

  describe('ExecutionId', () => {
    it('should create an ExecutionId from a string', () => {
      const id = executionId('exec-456')
      expect(id).toBe('exec-456')
    })

    it('should be a string at runtime', () => {
      const id = executionId('exec-456')
      expect(typeof id).toBe('string')
    })

    it('should have the ExecutionId type', () => {
      const id = executionId('exec-456')
      expectTypeOf(id).toEqualTypeOf<ExecutionId>()
    })

    it('should not be assignable to FunctionId', () => {
      const execId = executionId('exec-456')
      // @ts-expect-error - ExecutionId should not be assignable to FunctionId
      const _funcId: FunctionId = execId
      expect(_funcId).toBe(execId) // Runtime equality, but type error
    })

    it('should not be assignable to WorkflowId', () => {
      const execId = executionId('exec-456')
      // @ts-expect-error - ExecutionId should not be assignable to WorkflowId
      const _workflowId: WorkflowId = execId
      expect(_workflowId).toBe(execId) // Runtime equality, but type error
    })
  })

  describe('WorkflowId', () => {
    it('should create a WorkflowId from a string', () => {
      const id = workflowId('wf-789')
      expect(id).toBe('wf-789')
    })

    it('should be a string at runtime', () => {
      const id = workflowId('wf-789')
      expect(typeof id).toBe('string')
    })

    it('should have the WorkflowId type', () => {
      const id = workflowId('wf-789')
      expectTypeOf(id).toEqualTypeOf<WorkflowId>()
    })

    it('should not be assignable to FunctionId', () => {
      const wfId = workflowId('wf-789')
      // @ts-expect-error - WorkflowId should not be assignable to FunctionId
      const _funcId: FunctionId = wfId
      expect(_funcId).toBe(wfId) // Runtime equality, but type error
    })

    it('should not be assignable to ExecutionId', () => {
      const wfId = workflowId('wf-789')
      // @ts-expect-error - WorkflowId should not be assignable to ExecutionId
      const _execId: ExecutionId = wfId
      expect(_execId).toBe(wfId) // Runtime equality, but type error
    })
  })

  describe('Type Safety', () => {
    it('should prevent plain strings from being assigned to branded types', () => {
      const plainString = 'some-id'
      // @ts-expect-error - plain string should not be assignable to FunctionId
      const _funcId: FunctionId = plainString
      // @ts-expect-error - plain string should not be assignable to ExecutionId
      const _execId: ExecutionId = plainString
      // @ts-expect-error - plain string should not be assignable to WorkflowId
      const _workflowId: WorkflowId = plainString

      // Runtime check to ensure the test runs
      expect(_funcId).toBe(plainString)
      expect(_execId).toBe(plainString)
      expect(_workflowId).toBe(plainString)
    })

    it('should allow branded types to be used as strings in operations', () => {
      const funcId = functionId('func-123')
      const execId = executionId('exec-456')
      const wfId = workflowId('wf-789')

      // String operations should work
      expect(funcId.startsWith('func-')).toBe(true)
      expect(execId.includes('456')).toBe(true)
      expect(wfId.length).toBe(6)
    })

    it('should work in type-safe function signatures', () => {
      // Example function that only accepts FunctionId
      function processFunctionId(id: FunctionId): string {
        return `Processing function: ${id}`
      }

      const funcId = functionId('func-123')
      expect(processFunctionId(funcId)).toBe('Processing function: func-123')

      // These should cause type errors
      const execId = executionId('exec-456')
      // @ts-expect-error - ExecutionId should not be assignable to FunctionId parameter
      processFunctionId(execId)

      const wfId = workflowId('wf-789')
      // @ts-expect-error - WorkflowId should not be assignable to FunctionId parameter
      processFunctionId(wfId)
    })

    it('should allow same branded type assignments', () => {
      const funcId1 = functionId('func-123')
      const funcId2: FunctionId = funcId1 // Should work
      expect(funcId2).toBe(funcId1)

      const execId1 = executionId('exec-456')
      const execId2: ExecutionId = execId1 // Should work
      expect(execId2).toBe(execId1)

      const wfId1 = workflowId('wf-789')
      const wfId2: WorkflowId = wfId1 // Should work
      expect(wfId2).toBe(wfId1)
    })
  })
})
