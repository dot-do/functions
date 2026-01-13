/**
 * FunctionExecutor Durable Object Tests
 *
 * These tests validate the FunctionExecutor Durable Object functionality:
 * - Execute function code in isolated context
 * - Handle concurrent invocations
 * - Track execution metrics (duration, memory)
 * - Manage warm/cold state
 * - Handle timeouts
 * - Capture console output
 * - Support abort/cancellation
 * - Persist execution logs
 *
 * @module durable-object/function-executor.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  FunctionExecutor,
  type FunctionExecutorConfig,
  type ExecutionResult,
  type ExecutionMetrics,
  type ExecutionLog,
  type ExecutorState,
  type ConsoleOutput,
} from '../function-executor.js'

// ============================================================================
// Mock Types and Utilities
// ============================================================================

/**
 * Mock SQL result interface
 */
interface MockSqlResult<T> {
  one: () => T | null
  toArray: () => T[]
}

/**
 * Mock SQLite storage that simulates Cloudflare DO SQLite behavior
 */
class MockSqlStorage {
  private logs: Map<string, ExecutionLog> = new Map()
  public execCalls: { sql: string; params: unknown[] }[] = []
  public schemaCreated = false

  exec<T = unknown>(sql: string, ...params: unknown[]): MockSqlResult<T> {
    this.execCalls.push({ sql, params })
    const normalizedSql = sql.trim().toLowerCase()

    // Handle CREATE TABLE
    if (normalizedSql.includes('create table')) {
      this.schemaCreated = true
      return this.emptyResult<T>()
    }

    // Handle CREATE INDEX
    if (normalizedSql.includes('create index')) {
      return this.emptyResult<T>()
    }

    // Handle INSERT into execution_logs
    // INSERT INTO execution_logs (id, function_id, start_time, success, console_output) VALUES (?, ?, ?, ?, ?)
    if (normalizedSql.includes('insert') && normalizedSql.includes('execution_logs')) {
      const log: ExecutionLog = {
        id: params[0] as string,
        functionId: params[1] as string,
        startTime: params[2] as number,
        endTime: null,
        duration: null,
        success: params[3] === 1,
        error: null,
        consoleOutput: JSON.parse(params[4] as string || '[]'),
        metrics: null,
      }
      this.logs.set(log.id, log)
      return this.emptyResult<T>()
    }

    // Handle SELECT from execution_logs WHERE id = ?
    if (normalizedSql.includes('select') && normalizedSql.includes('execution_logs') && normalizedSql.includes('where id')) {
      const id = params[0] as string
      const log = this.logs.get(id)
      if (log) {
        const dbRow = {
          id: log.id,
          function_id: log.functionId,
          start_time: log.startTime,
          end_time: log.endTime,
          duration: log.duration,
          success: log.success ? 1 : 0,
          error: log.error,
          console_output: JSON.stringify(log.consoleOutput),
          metrics: log.metrics ? JSON.stringify(log.metrics) : null,
        }
        return {
          one: () => dbRow as T,
          toArray: () => [dbRow as T],
        }
      }
      return this.emptyResult<T>()
    }

    // Handle SELECT from execution_logs by function_id
    if (normalizedSql.includes('select') && normalizedSql.includes('execution_logs') && normalizedSql.includes('function_id')) {
      const functionId = params[0] as string
      const logs = Array.from(this.logs.values()).filter(l => l.functionId === functionId)
      const dbRows = logs.map(log => ({
        id: log.id,
        function_id: log.functionId,
        start_time: log.startTime,
        end_time: log.endTime,
        duration: log.duration,
        success: log.success ? 1 : 0,
        error: log.error,
        console_output: JSON.stringify(log.consoleOutput),
        metrics: log.metrics ? JSON.stringify(log.metrics) : null,
      }))
      return {
        one: () => (dbRows[0] as T) || null,
        toArray: () => dbRows as T[],
      }
    }

    // Handle DELETE from execution_logs (for retention cleanup)
    if (normalizedSql.includes('delete') && normalizedSql.includes('execution_logs')) {
      const cutoffTime = params[0] as number
      for (const [id, log] of this.logs.entries()) {
        if (log.startTime < cutoffTime) {
          this.logs.delete(id)
        }
      }
      return this.emptyResult<T>()
    }

    // Handle UPDATE execution_logs
    // UPDATE execution_logs SET end_time = ?, duration = ?, success = ?, error = ?, console_output = ?, metrics = ? WHERE id = ?
    if (normalizedSql.includes('update') && normalizedSql.includes('execution_logs')) {
      const id = params[6] as string  // Last param is the ID
      const log = this.logs.get(id)
      if (log) {
        log.endTime = params[0] as number
        log.duration = params[1] as number
        log.success = params[2] === 1
        log.error = params[3] as string | null
        log.consoleOutput = JSON.parse(params[4] as string || '[]')
        log.metrics = params[5] ? JSON.parse(params[5] as string) : null
      }
      return this.emptyResult<T>()
    }

    return this.emptyResult<T>()
  }

  private emptyResult<T>(): MockSqlResult<T> {
    return {
      one: () => null,
      toArray: () => [],
    }
  }

  // Test helpers
  getLog(id: string): ExecutionLog | undefined {
    return this.logs.get(id)
  }

  getAllLogs(): ExecutionLog[] {
    return Array.from(this.logs.values())
  }
}

/**
 * Mock Durable Object storage
 */
class MockDurableObjectStorage {
  public sql: MockSqlStorage
  private data: Map<string, unknown> = new Map()
  private alarms: number[] = []

  constructor() {
    this.sql = new MockSqlStorage()
  }

  async get(key: string): Promise<unknown> {
    return this.data.get(key)
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key)
  }

  async setAlarm(time: number | Date): Promise<void> {
    const timestamp = time instanceof Date ? time.getTime() : time
    this.alarms.push(timestamp)
  }

  async getAlarm(): Promise<number | null> {
    return this.alarms[0] ?? null
  }

  async deleteAlarm(): Promise<void> {
    this.alarms.shift()
  }

  // Test helpers
  getData(key: string): unknown {
    return this.data.get(key)
  }

  getAlarms(): number[] {
    return [...this.alarms]
  }
}

/**
 * Mock Durable Object state
 */
class MockDurableObjectState {
  public storage: MockDurableObjectStorage
  public id: DurableObjectId

  constructor() {
    this.storage = new MockDurableObjectStorage()
    this.id = { toString: () => 'test-executor-id' } as DurableObjectId
  }
}

/**
 * Mock environment bindings
 */
interface MockEnv {
  FUNCTIONS_KV?: KVNamespace
}

/**
 * Create a simple test function code
 */
function createTestFunctionCode(options: {
  returnValue?: unknown
  throwError?: string
  delay?: number
  consoleLog?: string[]
  infiniteLoop?: boolean
} = {}): string {
  const { returnValue = { success: true }, throwError, delay = 0, consoleLog = [], infiniteLoop = false } = options

  if (infiniteLoop) {
    return `
      export default async function handler(request) {
        while (true) {
          // Infinite loop for timeout testing
        }
      }
    `
  }

  const logs = consoleLog.map(msg => `console.log("${msg}");`).join('\n')
  const delayCode = delay > 0 ? `await new Promise(r => setTimeout(r, ${delay}));` : ''
  const errorCode = throwError ? `throw new Error("${throwError}");` : ''
  const returnCode = `return new Response(JSON.stringify(${JSON.stringify(returnValue)}));`

  return `
    export default async function handler(request) {
      ${logs}
      ${delayCode}
      ${errorCode}
      ${returnCode}
    }
  `
}

// ============================================================================
// Test Suites
// ============================================================================

describe('FunctionExecutor Durable Object', () => {
  let executor: FunctionExecutor
  let mockState: MockDurableObjectState
  let mockEnv: MockEnv

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockState = new MockDurableObjectState()
    mockEnv = {}
    executor = new FunctionExecutor(mockState as unknown as DurableObjectState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe('initialization', () => {
    it('should create executor with default configuration', () => {
      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(FunctionExecutor)
    })

    it('should initialize schema on first operation', async () => {
      const code = createTestFunctionCode()
      const executePromise = executor.execute({
        functionId: 'test-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      await executePromise

      expect(mockState.storage.sql.schemaCreated).toBe(true)
    })

    it('should return cold state initially', async () => {
      const state = await executor.getState()

      expect(state.isWarm).toBe(false)
      expect(state.lastExecutionTime).toBeNull()
    })
  })

  // ==========================================================================
  // Execute Function Code in Isolated Context Tests
  // ==========================================================================

  describe('execute function code in isolated context', () => {
    it('should execute simple function and return result', async () => {
      const code = createTestFunctionCode({ returnValue: { message: 'Hello' } })

      const executePromise = executor.execute({
        functionId: 'test-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await executePromise

      expect(result.success).toBe(true)
      expect(result.response).toBeInstanceOf(Response)
    })

    it('should isolate execution context between invocations', async () => {
      // First execution sets a global variable
      const code1 = `
        globalThis.testVar = 'value1';
        export default async function handler(request) {
          return new Response(JSON.stringify({ value: globalThis.testVar }));
        }
      `

      // Second execution should not see the global from first execution
      const code2 = `
        export default async function handler(request) {
          return new Response(JSON.stringify({ value: globalThis.testVar || 'undefined' }));
        }
      `

      const promise1 = executor.execute({
        functionId: 'func-1',
        code: code1,
        request: new Request('https://test.com'),
      })
      await vi.runAllTimersAsync()
      const result1 = await promise1

      const promise2 = executor.execute({
        functionId: 'func-2',
        code: code2,
        request: new Request('https://test.com'),
      })
      await vi.runAllTimersAsync()
      const result2 = await promise2

      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      // The second execution should have isolated context
    })

    it('should pass request to function handler', async () => {
      const code = `
        export default async function handler(request) {
          const body = await request.json();
          return new Response(JSON.stringify({ received: body }));
        }
      `

      const testBody = { data: 'test-payload' }
      const promise = executor.execute({
        functionId: 'test-func',
        code,
        request: new Request('https://test.com', {
          method: 'POST',
          body: JSON.stringify(testBody),
          headers: { 'Content-Type': 'application/json' },
        }),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.success).toBe(true)
    })

    it('should handle function that throws error', async () => {
      const code = createTestFunctionCode({ throwError: 'Test error message' })

      const promise = executor.execute({
        functionId: 'error-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('Test error message')
    })

    it('should handle syntax errors in function code', async () => {
      const invalidCode = `
        export default async function handler(request {
          // Missing closing parenthesis
          return new Response('OK');
        }
      `

      const promise = executor.execute({
        functionId: 'syntax-error-func',
        code: invalidCode,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should prevent access to dangerous APIs', async () => {
      const dangerousCode = `
        export default async function handler(request) {
          // Attempt to access filesystem - should be blocked
          const fs = await import('fs');
          return new Response('OK');
        }
      `

      const promise = executor.execute({
        functionId: 'dangerous-func',
        code: dangerousCode,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.success).toBe(false)
    })
  })

  // ==========================================================================
  // Handle Concurrent Invocations Tests
  // ==========================================================================

  describe('handle concurrent invocations', () => {
    it('should handle multiple concurrent executions', async () => {
      const code = createTestFunctionCode({ delay: 10 })

      const promises = [
        executor.execute({
          functionId: 'concurrent-func',
          code,
          request: new Request('https://test.com/1'),
        }),
        executor.execute({
          functionId: 'concurrent-func',
          code,
          request: new Request('https://test.com/2'),
        }),
        executor.execute({
          functionId: 'concurrent-func',
          code,
          request: new Request('https://test.com/3'),
        }),
      ]

      await vi.runAllTimersAsync()
      const results = await Promise.all(promises)

      expect(results).toHaveLength(3)
      results.forEach(result => {
        expect(result.success).toBe(true)
      })
    })

    it('should execute concurrent requests in isolation', async () => {
      let callCount = 0

      const code1 = `
        export default async function handler(request) {
          const id = ${++callCount};
          await new Promise(r => setTimeout(r, 10));
          return new Response(JSON.stringify({ id }));
        }
      `

      const code2 = `
        export default async function handler(request) {
          const id = ${++callCount};
          await new Promise(r => setTimeout(r, 10));
          return new Response(JSON.stringify({ id }));
        }
      `

      const promise1 = executor.execute({
        functionId: 'func-1',
        code: code1,
        request: new Request('https://test.com/1'),
      })

      const promise2 = executor.execute({
        functionId: 'func-2',
        code: code2,
        request: new Request('https://test.com/2'),
      })

      await vi.runAllTimersAsync()
      const [result1, result2] = await Promise.all([promise1, promise2])

      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      expect(result1.executionId).not.toBe(result2.executionId)
    })

    it('should enforce concurrency limits', async () => {
      const config: FunctionExecutorConfig = {
        maxConcurrentExecutions: 2,
      }

      const limitedExecutor = new FunctionExecutor(
        mockState as unknown as DurableObjectState,
        mockEnv,
        config
      )

      const code = createTestFunctionCode({ delay: 100 })

      const promises = [
        limitedExecutor.execute({
          functionId: 'limited-func',
          code,
          request: new Request('https://test.com/1'),
        }),
        limitedExecutor.execute({
          functionId: 'limited-func',
          code,
          request: new Request('https://test.com/2'),
        }),
        limitedExecutor.execute({
          functionId: 'limited-func',
          code,
          request: new Request('https://test.com/3'),
        }),
      ]

      await vi.runAllTimersAsync()
      const results = await Promise.all(promises)

      // Third request should be queued or rejected based on implementation
      const successCount = results.filter(r => r.success).length
      const queuedCount = results.filter(r => r.queued).length

      expect(successCount + queuedCount).toBe(3)
    })

    it('should queue requests when at capacity', async () => {
      const config: FunctionExecutorConfig = {
        maxConcurrentExecutions: 1,
        maxQueueSize: 5,
      }

      const queuedExecutor = new FunctionExecutor(
        mockState as unknown as DurableObjectState,
        mockEnv,
        config
      )

      const slowCode = createTestFunctionCode({ delay: 50 })
      const fastCode = createTestFunctionCode({ delay: 0 })

      // Start a slow execution
      const slowPromise = queuedExecutor.execute({
        functionId: 'slow-func',
        code: slowCode,
        request: new Request('https://test.com/slow'),
      })

      // Queue a fast execution while slow is running
      const fastPromise = queuedExecutor.execute({
        functionId: 'fast-func',
        code: fastCode,
        request: new Request('https://test.com/fast'),
      })

      await vi.runAllTimersAsync()
      const [slowResult, fastResult] = await Promise.all([slowPromise, fastPromise])

      expect(slowResult.success).toBe(true)
      expect(fastResult.success).toBe(true)
    })

    it('should reject requests when queue is full', async () => {
      const config: FunctionExecutorConfig = {
        maxConcurrentExecutions: 1,
        maxQueueSize: 1,
      }

      const tinyQueueExecutor = new FunctionExecutor(
        mockState as unknown as DurableObjectState,
        mockEnv,
        config
      )

      const slowCode = createTestFunctionCode({ delay: 100 })

      // Fill up concurrent + queue
      const promise1 = tinyQueueExecutor.execute({
        functionId: 'func-1',
        code: slowCode,
        request: new Request('https://test.com/1'),
      })

      const promise2 = tinyQueueExecutor.execute({
        functionId: 'func-2',
        code: slowCode,
        request: new Request('https://test.com/2'),
      })

      // This should be rejected
      const promise3 = tinyQueueExecutor.execute({
        functionId: 'func-3',
        code: slowCode,
        request: new Request('https://test.com/3'),
      })

      await vi.runAllTimersAsync()
      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3])

      expect(result3.success).toBe(false)
      expect(result3.error?.message).toContain('queue')
    })
  })

  // ==========================================================================
  // Track Execution Metrics Tests
  // ==========================================================================

  describe('track execution metrics (duration, memory)', () => {
    it('should track execution duration', async () => {
      const code = createTestFunctionCode({ delay: 50 })

      const promise = executor.execute({
        functionId: 'timed-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.metrics).toBeDefined()
      expect(result.metrics?.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should track memory usage', async () => {
      const code = createTestFunctionCode()

      const promise = executor.execute({
        functionId: 'memory-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.metrics).toBeDefined()
      expect(result.metrics?.memoryUsedBytes).toBeGreaterThanOrEqual(0)
    })

    it('should track CPU time', async () => {
      const code = createTestFunctionCode()

      const promise = executor.execute({
        functionId: 'cpu-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.metrics).toBeDefined()
      expect(result.metrics?.cpuTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('should aggregate metrics across multiple executions', async () => {
      const code = createTestFunctionCode()

      for (let i = 0; i < 5; i++) {
        const promise = executor.execute({
          functionId: 'multi-exec-func',
          code,
          request: new Request(`https://test.com/${i}`),
        })
        await vi.runAllTimersAsync()
        await promise
      }

      const aggregateMetrics = await executor.getAggregateMetrics('multi-exec-func')

      expect(aggregateMetrics).toBeDefined()
      expect(aggregateMetrics.totalExecutions).toBe(5)
      expect(aggregateMetrics.avgDurationMs).toBeGreaterThanOrEqual(0)
      expect(aggregateMetrics.maxDurationMs).toBeGreaterThanOrEqual(aggregateMetrics.avgDurationMs)
      expect(aggregateMetrics.p95DurationMs).toBeDefined()
    })

    it('should include metrics in execution result', async () => {
      const code = createTestFunctionCode()

      const promise = executor.execute({
        functionId: 'metrics-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.metrics).toMatchObject({
        durationMs: expect.any(Number),
        cpuTimeMs: expect.any(Number),
        memoryUsedBytes: expect.any(Number),
        startTime: expect.any(Number),
        endTime: expect.any(Number),
      })
    })
  })

  // ==========================================================================
  // Manage Warm/Cold State Tests
  // ==========================================================================

  describe('manage warm/cold state', () => {
    it('should report cold state on first execution', async () => {
      const code = createTestFunctionCode()

      const promise = executor.execute({
        functionId: 'cold-start-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.coldStart).toBe(true)
    })

    it('should report warm state on subsequent executions of same function', async () => {
      const code = createTestFunctionCode()

      // First execution (cold)
      const promise1 = executor.execute({
        functionId: 'warm-func',
        code,
        request: new Request('https://test.com/1'),
      })
      await vi.runAllTimersAsync()
      const result1 = await promise1

      // Second execution (warm)
      const promise2 = executor.execute({
        functionId: 'warm-func',
        code,
        request: new Request('https://test.com/2'),
      })
      await vi.runAllTimersAsync()
      const result2 = await promise2

      expect(result1.coldStart).toBe(true)
      expect(result2.coldStart).toBe(false)
    })

    it('should transition to cold state after idle timeout', async () => {
      const config: FunctionExecutorConfig = {
        warmIdleTimeoutMs: 1000, // 1 second idle timeout
      }

      const idleExecutor = new FunctionExecutor(
        mockState as unknown as DurableObjectState,
        mockEnv,
        config
      )

      const code = createTestFunctionCode()

      // First execution
      const promise1 = idleExecutor.execute({
        functionId: 'idle-func',
        code,
        request: new Request('https://test.com/1'),
      })
      await vi.runAllTimersAsync()
      await promise1

      // Advance time past idle timeout and trigger alarm
      vi.advanceTimersByTime(2000)
      await idleExecutor.alarm()

      // Second execution should be cold again
      const promise2 = idleExecutor.execute({
        functionId: 'idle-func',
        code,
        request: new Request('https://test.com/2'),
      })
      await vi.runAllTimersAsync()
      const result2 = await promise2

      expect(result2.coldStart).toBe(true)
    })

    it('should maintain warm state within idle timeout', async () => {
      const config: FunctionExecutorConfig = {
        warmIdleTimeoutMs: 5000,
      }

      const warmExecutor = new FunctionExecutor(
        mockState as unknown as DurableObjectState,
        mockEnv,
        config
      )

      const code = createTestFunctionCode()

      // First execution
      const promise1 = warmExecutor.execute({
        functionId: 'stay-warm-func',
        code,
        request: new Request('https://test.com/1'),
      })
      await vi.runAllTimersAsync()
      await promise1

      // Advance time but stay within idle timeout
      vi.advanceTimersByTime(1000)

      // Second execution should still be warm
      const promise2 = warmExecutor.execute({
        functionId: 'stay-warm-func',
        code,
        request: new Request('https://test.com/2'),
      })
      await vi.runAllTimersAsync()
      const result2 = await promise2

      expect(result2.coldStart).toBe(false)
    })

    it('should expose current warm/cold state', async () => {
      const code = createTestFunctionCode()

      // Initially cold
      const initialState = await executor.getState()
      expect(initialState.isWarm).toBe(false)

      // After execution, warm
      const promise = executor.execute({
        functionId: 'state-check-func',
        code,
        request: new Request('https://test.com'),
      })
      await vi.runAllTimersAsync()
      await promise

      const warmState = await executor.getState()
      expect(warmState.isWarm).toBe(true)
      expect(warmState.lastExecutionTime).toBeDefined()
      expect(warmState.loadedFunctions).toContain('state-check-func')
    })
  })

  // ==========================================================================
  // Handle Timeouts Tests
  // ==========================================================================

  describe('handle timeouts', () => {
    it('should timeout long-running executions', async () => {
      const config: FunctionExecutorConfig = {
        executionTimeoutMs: 100,
      }

      const timeoutExecutor = new FunctionExecutor(
        mockState as unknown as DurableObjectState,
        mockEnv,
        config
      )

      const infiniteCode = createTestFunctionCode({ infiniteLoop: true })

      const promise = timeoutExecutor.execute({
        functionId: 'timeout-func',
        code: infiniteCode,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('timeout')
      expect(result.timedOut).toBe(true)
    })

    it('should allow custom timeout per execution', async () => {
      const infiniteCode = createTestFunctionCode({ infiniteLoop: true })

      const promise = executor.execute({
        functionId: 'custom-timeout-func',
        code: infiniteCode,
        request: new Request('https://test.com'),
        timeoutMs: 50,
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.success).toBe(false)
      expect(result.timedOut).toBe(true)
    })

    it('should complete within timeout for fast functions', async () => {
      const config: FunctionExecutorConfig = {
        executionTimeoutMs: 5000,
      }

      const fastExecutor = new FunctionExecutor(
        mockState as unknown as DurableObjectState,
        mockEnv,
        config
      )

      const fastCode = createTestFunctionCode({ delay: 10 })

      const promise = fastExecutor.execute({
        functionId: 'fast-func',
        code: fastCode,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.success).toBe(true)
      expect(result.timedOut).toBe(false)
    })

    it('should cleanup resources after timeout', async () => {
      const config: FunctionExecutorConfig = {
        executionTimeoutMs: 50,
      }

      const cleanupExecutor = new FunctionExecutor(
        mockState as unknown as DurableObjectState,
        mockEnv,
        config
      )

      const infiniteCode = createTestFunctionCode({ infiniteLoop: true })

      const promise = cleanupExecutor.execute({
        functionId: 'cleanup-func',
        code: infiniteCode,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      await promise

      const state = await cleanupExecutor.getState()
      expect(state.activeExecutions).toBe(0)
    })

    it('should track timeout in metrics', async () => {
      const config: FunctionExecutorConfig = {
        executionTimeoutMs: 50,
      }

      const metricsExecutor = new FunctionExecutor(
        mockState as unknown as DurableObjectState,
        mockEnv,
        config
      )

      const infiniteCode = createTestFunctionCode({ infiniteLoop: true })

      const promise = metricsExecutor.execute({
        functionId: 'timeout-metrics-func',
        code: infiniteCode,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.metrics?.timedOut).toBe(true)
      expect(result.metrics?.durationMs).toBeGreaterThanOrEqual(50)
    })
  })

  // ==========================================================================
  // Capture Console Output Tests
  // ==========================================================================

  describe('capture console output', () => {
    it('should capture console.log output', async () => {
      const code = createTestFunctionCode({
        consoleLog: ['Hello', 'World'],
      })

      const promise = executor.execute({
        functionId: 'console-log-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.consoleOutput).toBeDefined()
      expect(result.consoleOutput).toHaveLength(2)
      expect(result.consoleOutput?.[0]).toMatchObject({
        level: 'log',
        message: 'Hello',
      })
      expect(result.consoleOutput?.[1]).toMatchObject({
        level: 'log',
        message: 'World',
      })
    })

    it('should capture console.error output', async () => {
      const code = `
        export default async function handler(request) {
          console.error('Error message');
          return new Response('OK');
        }
      `

      const promise = executor.execute({
        functionId: 'console-error-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.consoleOutput).toBeDefined()
      expect(result.consoleOutput?.[0]).toMatchObject({
        level: 'error',
        message: 'Error message',
      })
    })

    it('should capture console.warn output', async () => {
      const code = `
        export default async function handler(request) {
          console.warn('Warning message');
          return new Response('OK');
        }
      `

      const promise = executor.execute({
        functionId: 'console-warn-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.consoleOutput).toBeDefined()
      expect(result.consoleOutput?.[0]).toMatchObject({
        level: 'warn',
        message: 'Warning message',
      })
    })

    it('should include timestamp in console output', async () => {
      const code = createTestFunctionCode({ consoleLog: ['Timestamped'] })

      const promise = executor.execute({
        functionId: 'timestamp-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.consoleOutput?.[0]?.timestamp).toBeDefined()
      expect(typeof result.consoleOutput?.[0]?.timestamp).toBe('number')
    })

    it('should limit console output size', async () => {
      const config: FunctionExecutorConfig = {
        maxConsoleOutputSize: 10,
      }

      const limitedExecutor = new FunctionExecutor(
        mockState as unknown as DurableObjectState,
        mockEnv,
        config
      )

      const manyLogs: string[] = []
      for (let i = 0; i < 100; i++) {
        manyLogs.push(`Log ${i}`)
      }

      const code = createTestFunctionCode({ consoleLog: manyLogs })

      const promise = limitedExecutor.execute({
        functionId: 'limited-console-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.consoleOutput?.length).toBeLessThanOrEqual(10)
      expect(result.consoleOutputTruncated).toBe(true)
    })

    it('should handle console.log with multiple arguments', async () => {
      const code = `
        export default async function handler(request) {
          console.log('Multiple', 'arguments', 123, { key: 'value' });
          return new Response('OK');
        }
      `

      const promise = executor.execute({
        functionId: 'multi-arg-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.consoleOutput).toBeDefined()
      expect(result.consoleOutput?.[0]?.message).toContain('Multiple')
    })
  })

  // ==========================================================================
  // Support Abort/Cancellation Tests
  // ==========================================================================

  describe('support abort/cancellation', () => {
    it('should abort execution when signal is aborted', async () => {
      const abortController = new AbortController()

      const slowCode = createTestFunctionCode({ delay: 1000 })

      const promise = executor.execute({
        functionId: 'abortable-func',
        code: slowCode,
        request: new Request('https://test.com'),
        signal: abortController.signal,
      })

      // Abort after a short delay
      setTimeout(() => abortController.abort(), 50)

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.success).toBe(false)
      expect(result.aborted).toBe(true)
    })

    it('should cleanup resources on abort', async () => {
      const abortController = new AbortController()

      const slowCode = createTestFunctionCode({ delay: 1000 })

      const promise = executor.execute({
        functionId: 'cleanup-abort-func',
        code: slowCode,
        request: new Request('https://test.com'),
        signal: abortController.signal,
      })

      setTimeout(() => abortController.abort(), 50)

      await vi.runAllTimersAsync()
      await promise

      const state = await executor.getState()
      expect(state.activeExecutions).toBe(0)
    })

    it('should support abort via execution ID', async () => {
      const slowCode = createTestFunctionCode({ delay: 1000 })

      const promise = executor.execute({
        functionId: 'abort-by-id-func',
        code: slowCode,
        request: new Request('https://test.com'),
      })

      // Get the execution ID and abort it
      await vi.advanceTimersByTimeAsync(10)

      const state = await executor.getState()
      const executionId = state.activeExecutionIds?.[0]

      if (executionId) {
        await executor.abort(executionId)
      }

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.aborted).toBe(true)
    })

    it('should not affect other executions when one is aborted', async () => {
      const abortController = new AbortController()
      const code = createTestFunctionCode({ delay: 50 })

      // Start two executions
      const promise1 = executor.execute({
        functionId: 'keep-running-func',
        code,
        request: new Request('https://test.com/1'),
      })

      const promise2 = executor.execute({
        functionId: 'abort-this-func',
        code,
        request: new Request('https://test.com/2'),
        signal: abortController.signal,
      })

      // Abort only the second one
      setTimeout(() => abortController.abort(), 10)

      await vi.runAllTimersAsync()
      const [result1, result2] = await Promise.all([promise1, promise2])

      expect(result1.success).toBe(true)
      expect(result2.aborted).toBe(true)
    })

    it('should return partial results on abort', async () => {
      const abortController = new AbortController()

      const code = `
        export default async function handler(request) {
          console.log('Step 1');
          await new Promise(r => setTimeout(r, 100));
          console.log('Step 2');
          await new Promise(r => setTimeout(r, 100));
          console.log('Step 3');
          return new Response('Done');
        }
      `

      const promise = executor.execute({
        functionId: 'partial-result-func',
        code,
        request: new Request('https://test.com'),
        signal: abortController.signal,
      })

      // Abort after first step
      setTimeout(() => abortController.abort(), 50)

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.aborted).toBe(true)
      expect(result.consoleOutput?.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ==========================================================================
  // Persist Execution Logs Tests
  // ==========================================================================

  describe('persist execution logs', () => {
    it('should persist execution log after completion', async () => {
      const code = createTestFunctionCode()

      const promise = executor.execute({
        functionId: 'persist-log-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      const logs = mockState.storage.sql.getAllLogs()
      expect(logs.length).toBeGreaterThan(0)

      const log = logs.find(l => l.id === result.executionId)
      expect(log).toBeDefined()
      expect(log?.functionId).toBe('persist-log-func')
      expect(log?.success).toBe(true)
    })

    it('should persist error details in log', async () => {
      const code = createTestFunctionCode({ throwError: 'Persisted error' })

      const promise = executor.execute({
        functionId: 'persist-error-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      const log = mockState.storage.sql.getLog(result.executionId)
      expect(log).toBeDefined()
      expect(log?.success).toBe(false)
      expect(log?.error).toContain('Persisted error')
    })

    it('should persist console output in log', async () => {
      const code = createTestFunctionCode({ consoleLog: ['Persisted log'] })

      const promise = executor.execute({
        functionId: 'persist-console-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      const log = mockState.storage.sql.getLog(result.executionId)
      expect(log).toBeDefined()
      expect(log?.consoleOutput).toHaveLength(1)
      expect(log?.consoleOutput?.[0]?.message).toBe('Persisted log')
    })

    it('should persist metrics in log', async () => {
      const code = createTestFunctionCode()

      const promise = executor.execute({
        functionId: 'persist-metrics-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      const log = mockState.storage.sql.getLog(result.executionId)
      expect(log).toBeDefined()
      expect(log?.metrics).toBeDefined()
      expect(log?.metrics?.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should retrieve execution logs by function ID', async () => {
      const code = createTestFunctionCode()

      // Execute multiple times
      for (let i = 0; i < 3; i++) {
        const promise = executor.execute({
          functionId: 'multi-log-func',
          code,
          request: new Request(`https://test.com/${i}`),
        })
        await vi.runAllTimersAsync()
        await promise
      }

      const logs = await executor.getExecutionLogs('multi-log-func')

      expect(logs).toHaveLength(3)
      logs.forEach(log => {
        expect(log.functionId).toBe('multi-log-func')
      })
    })

    it('should retrieve execution log by ID', async () => {
      const code = createTestFunctionCode()

      const promise = executor.execute({
        functionId: 'single-log-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      const log = await executor.getExecutionLog(result.executionId)

      expect(log).toBeDefined()
      expect(log?.id).toBe(result.executionId)
    })

    it('should support log retention policy', async () => {
      const config: FunctionExecutorConfig = {
        logRetentionMs: 1000, // 1 second retention
      }

      const retentionExecutor = new FunctionExecutor(
        mockState as unknown as DurableObjectState,
        mockEnv,
        config
      )

      const code = createTestFunctionCode()

      const promise = retentionExecutor.execute({
        functionId: 'retention-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      await promise

      // Advance time past retention
      vi.advanceTimersByTime(2000)

      // Trigger cleanup
      await retentionExecutor.cleanupOldLogs()

      const logs = await retentionExecutor.getExecutionLogs('retention-func')
      expect(logs).toHaveLength(0)
    })

    it('should include start and end times in log', async () => {
      const code = createTestFunctionCode({ delay: 10 })

      const promise = executor.execute({
        functionId: 'time-log-func',
        code,
        request: new Request('https://test.com'),
      })

      await vi.runAllTimersAsync()
      const result = await promise

      const log = mockState.storage.sql.getLog(result.executionId)
      expect(log).toBeDefined()
      expect(log?.startTime).toBeDefined()
      expect(log?.endTime).toBeDefined()
      expect(log?.duration).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // HTTP Handler Tests
  // ==========================================================================

  describe('HTTP handler', () => {
    it('should handle POST /execute requests', async () => {
      const code = createTestFunctionCode()

      const request = new Request('https://executor.do/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          functionId: 'http-func',
          code,
        }),
      })

      const responsePromise = executor.fetch(request)
      await vi.runAllTimersAsync()
      const response = await responsePromise

      expect(response.ok).toBe(true)
      const result = await response.json() as ExecutionResult
      expect(result.success).toBe(true)
    })

    it('should handle GET /state requests', async () => {
      const request = new Request('https://executor.do/state', {
        method: 'GET',
      })

      const response = await executor.fetch(request)

      expect(response.ok).toBe(true)
      const state = await response.json() as ExecutorState
      expect(state).toHaveProperty('isWarm')
    })

    it('should handle GET /logs/:functionId requests', async () => {
      const code = createTestFunctionCode()

      // First, execute a function
      const execPromise = executor.execute({
        functionId: 'logs-http-func',
        code,
        request: new Request('https://test.com'),
      })
      await vi.runAllTimersAsync()
      await execPromise

      // Then, fetch logs via HTTP
      const request = new Request('https://executor.do/logs/logs-http-func', {
        method: 'GET',
      })

      const response = await executor.fetch(request)

      expect(response.ok).toBe(true)
      const logs = await response.json() as ExecutionLog[]
      expect(logs.length).toBeGreaterThan(0)
    })

    it('should handle POST /abort requests', async () => {
      const slowCode = createTestFunctionCode({ delay: 1000 })

      // Start a slow execution
      const execPromise = executor.execute({
        functionId: 'abort-http-func',
        code: slowCode,
        request: new Request('https://test.com'),
      })

      await vi.advanceTimersByTimeAsync(10)

      const state = await executor.getState()
      const executionId = state.activeExecutionIds?.[0]

      if (executionId) {
        const abortRequest = new Request('https://executor.do/abort', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ executionId }),
        })

        const abortResponse = await executor.fetch(abortRequest)
        expect(abortResponse.ok).toBe(true)
      }

      await vi.runAllTimersAsync()
      const result = await execPromise

      expect(result.aborted).toBe(true)
    })

    it('should return 404 for unknown routes', async () => {
      const request = new Request('https://executor.do/unknown', {
        method: 'GET',
      })

      const response = await executor.fetch(request)

      expect(response.status).toBe(404)
    })

    it('should return 405 for unsupported methods', async () => {
      const request = new Request('https://executor.do/execute', {
        method: 'DELETE',
      })

      const response = await executor.fetch(request)

      expect(response.status).toBe(405)
    })
  })

  // ==========================================================================
  // Alarm Handler Tests
  // ==========================================================================

  describe('alarm handler', () => {
    it('should handle idle cleanup alarm', async () => {
      const config: FunctionExecutorConfig = {
        warmIdleTimeoutMs: 1000,
      }

      const alarmExecutor = new FunctionExecutor(
        mockState as unknown as DurableObjectState,
        mockEnv,
        config
      )

      const code = createTestFunctionCode()

      // Execute to warm up
      const promise = alarmExecutor.execute({
        functionId: 'alarm-func',
        code,
        request: new Request('https://test.com'),
      })
      await vi.runAllTimersAsync()
      await promise

      // Verify warm
      let state = await alarmExecutor.getState()
      expect(state.isWarm).toBe(true)

      // Trigger alarm
      await alarmExecutor.alarm()

      // Should still be warm if within timeout
      state = await alarmExecutor.getState()
      expect(state.isWarm).toBe(true)

      // Advance past timeout and trigger alarm again
      vi.advanceTimersByTime(2000)
      await alarmExecutor.alarm()

      // Should be cold now
      state = await alarmExecutor.getState()
      expect(state.isWarm).toBe(false)
    })

    it('should schedule cleanup alarm after execution', async () => {
      const config: FunctionExecutorConfig = {
        warmIdleTimeoutMs: 5000,
      }

      const alarmExecutor = new FunctionExecutor(
        mockState as unknown as DurableObjectState,
        mockEnv,
        config
      )

      const code = createTestFunctionCode()

      const promise = alarmExecutor.execute({
        functionId: 'schedule-alarm-func',
        code,
        request: new Request('https://test.com'),
      })
      await vi.runAllTimersAsync()
      await promise

      // Verify alarm was scheduled
      const alarms = mockState.storage.getAlarms()
      expect(alarms.length).toBeGreaterThan(0)
    })
  })
})
