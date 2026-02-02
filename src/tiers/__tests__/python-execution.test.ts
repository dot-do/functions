/**
 * Python Execution Integration Tests
 *
 * These tests validate the Python execution path through the CodeExecutor,
 * ensuring Python functions are correctly routed to the PyodideExecutor.
 *
 * Cloudflare Workers now supports Python natively via Pyodide with WASM
 * snapshots, providing fast cold starts and access to the Python ecosystem.
 *
 * Test categories:
 * 1. Basic Python function execution
 * 2. Python error handling
 * 3. Python timeout handling
 * 4. Data type conversion between Python and JavaScript
 * 5. Python standard library usage
 *
 * ENVIRONMENT: Node.js (vitest.node.config.ts)
 *
 * These tests require the Pyodide runtime to be available. They are excluded
 * from the vitest-pool-workers config (Miniflare) and run via the Node.js
 * config instead:
 *
 *   npm run test:cli  # or: npx vitest run --config vitest.node.config.ts
 *
 * Pyodide is not available in Miniflare because it requires Node.js-specific
 * APIs (file system access, native module loading) or a browser environment.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { CodeFunctionDefinition, CodeLanguage } from '@dotdo/functions/code'
import { defineCodeFunction } from '@dotdo/functions/code'
import type { Duration } from '@dotdo/functions'
import { functionId } from '@dotdo/functions'
import { CodeExecutor, type CodeExecutorEnv } from '../code-executor'

/**
 * Create a test Python function definition
 */
function createPythonFunction<TInput = unknown, TOutput = unknown>(
  id: string,
  code: string,
  options: {
    timeout?: Duration
  } = {}
): CodeFunctionDefinition<TInput, TOutput> {
  return defineCodeFunction({
    id: functionId(id),
    name: id,
    version: '1.0.0',
    language: 'python',
    source: { type: 'inline', code },
    timeout: options.timeout ?? ('30s' as Duration),
  })
}

// These tests run in vitest.node.config.ts (Node.js environment)
// Pyodide is available as a devDependency
describe('Python Execution via CodeExecutor', () => {
  let executor: CodeExecutor
  let mockEnv: CodeExecutorEnv

  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv = {}
    executor = new CodeExecutor(mockEnv)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Basic Python Function Execution
  // ==========================================================================

  describe('Basic Python Function Execution', () => {
    it('should execute a simple Python function', async () => {
      const fn = createPythonFunction<void, number>(
        'python-simple',
        `
def handler(input):
    return 42
`
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('completed')
      expect(result.output).toBe(42)
      expect(result.codeExecution.language).toBe('python')
    })

    it('should execute Python function with string return', async () => {
      const fn = createPythonFunction<void, string>(
        'python-string',
        `
def handler(input):
    return "Hello from Python!"
`
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('completed')
      expect(result.output).toBe('Hello from Python!')
    })

    it('should pass input to Python function', async () => {
      const fn = createPythonFunction<{ name: string }, string>(
        'python-input',
        `
def handler(input):
    return f"Hello, {input['name']}!"
`
      )

      const result = await executor.execute(fn, { name: 'World' })

      expect(result.status).toBe('completed')
      expect(result.output).toBe('Hello, World!')
    })

    it('should handle numeric input', async () => {
      const fn = createPythonFunction<{ a: number; b: number }, { sum: number }>(
        'python-numbers',
        `
def handler(input):
    return {"sum": input["a"] + input["b"]}
`
      )

      const result = await executor.execute(fn, { a: 10, b: 20 })

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ sum: 30 })
    })

    it('should handle array input', async () => {
      const fn = createPythonFunction<{ items: number[] }, { total: number }>(
        'python-array',
        `
def handler(input):
    return {"total": sum(input["items"])}
`
      )

      const result = await executor.execute(fn, { items: [1, 2, 3, 4, 5] })

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ total: 15 })
    })

    it('should handle nested object input', async () => {
      const fn = createPythonFunction<{ user: { name: string; age: number } }, string>(
        'python-nested',
        `
def handler(input):
    user = input["user"]
    return f"{user['name']} is {user['age']} years old"
`
      )

      const result = await executor.execute(fn, { user: { name: 'Alice', age: 30 } })

      expect(result.status).toBe('completed')
      expect(result.output).toBe('Alice is 30 years old')
    })
  })

  // ==========================================================================
  // Python Return Types
  // ==========================================================================

  describe('Python Return Types', () => {
    it('should return dict as JavaScript object', async () => {
      const fn = createPythonFunction<void, { name: string; value: number }>(
        'python-dict',
        `
def handler(input):
    return {"name": "test", "value": 123}
`
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ name: 'test', value: 123 })
    })

    it('should return list as JavaScript array', async () => {
      const fn = createPythonFunction<void, number[]>(
        'python-list',
        `
def handler(input):
    return [1, 2, 3, 4, 5]
`
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('completed')
      expect(result.output).toEqual([1, 2, 3, 4, 5])
    })

    it('should return None as null', async () => {
      const fn = createPythonFunction<void, null>(
        'python-none',
        `
def handler(input):
    return None
`
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('completed')
      expect(result.output).toBeNull()
    })

    it('should handle boolean return values', async () => {
      const fn = createPythonFunction<{ flag: boolean }, boolean>(
        'python-bool',
        `
def handler(input):
    return not input["flag"]
`
      )

      const result = await executor.execute(fn, { flag: true })

      expect(result.status).toBe('completed')
      expect(result.output).toBe(false)
    })

    it('should handle float return values', async () => {
      const fn = createPythonFunction<{ x: number }, number>(
        'python-float',
        `
def handler(input):
    return input["x"] * 3.14159
`
      )

      const result = await executor.execute(fn, { x: 2.0 })

      expect(result.status).toBe('completed')
      expect(result.output).toBeCloseTo(6.28318, 4)
    })
  })

  // ==========================================================================
  // Python Error Handling
  // ==========================================================================

  describe('Python Error Handling', () => {
    it('should catch ValueError', async () => {
      const fn = createPythonFunction<void, void>(
        'python-value-error',
        `
def handler(input):
    raise ValueError("test error")
`
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('ValueError')
    })

    it('should catch TypeError', async () => {
      const fn = createPythonFunction<void, void>(
        'python-type-error',
        `
def handler(input):
    return "hello" + 42
`
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('TypeError')
    })

    it('should catch KeyError', async () => {
      const fn = createPythonFunction<void, void>(
        'python-key-error',
        `
def handler(input):
    d = {"a": 1}
    return d["nonexistent"]
`
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('KeyError')
    })

    it('should catch ZeroDivisionError', async () => {
      const fn = createPythonFunction<void, void>(
        'python-div-error',
        `
def handler(input):
    return 1 / 0
`
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('ZeroDivisionError')
    })

    it('should catch syntax errors', async () => {
      const fn = createPythonFunction<void, void>(
        'python-syntax-error',
        `
def handler(input)
    return 42
`
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('SyntaxError')
    })

    it('should report missing handler function', async () => {
      const fn = createPythonFunction<void, void>(
        'python-missing-handler',
        `
def other_function():
    return "not the handler"
`
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.message).toMatch(/handler.*not found|not defined/i)
    })
  })

  // ==========================================================================
  // Python Timeout Handling
  // ==========================================================================

  describe('Python Timeout Handling', () => {
    it('should timeout for long-running Python code', async () => {
      const fn = createPythonFunction<void, void>(
        'python-timeout',
        `
import time

def handler(input):
    time.sleep(10)
    return "done"
`,
        { timeout: '500ms' }
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('timeout')
      expect(result.error).toBeDefined()
      expect(result.error?.message).toMatch(/timeout/i)
    })

    it('should complete fast Python code within timeout', async () => {
      const fn = createPythonFunction<void, string>(
        'python-fast',
        `
def handler(input):
    return "fast"
`,
        { timeout: '5s' }
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('completed')
      expect(result.output).toBe('fast')
    })
  })

  // ==========================================================================
  // Python Standard Library
  // ==========================================================================

  describe('Python Standard Library', () => {
    it('should support json module', async () => {
      const fn = createPythonFunction<{ data: Record<string, unknown> }, string>(
        'python-json',
        `
import json

def handler(input):
    return json.dumps(input["data"], sort_keys=True)
`
      )

      const result = await executor.execute(fn, { data: { b: 2, a: 1 } })

      expect(result.status).toBe('completed')
      expect(result.output).toBe('{"a": 1, "b": 2}')
    })

    it('should support math module', async () => {
      const fn = createPythonFunction<{ value: number }, number>(
        'python-math',
        `
import math

def handler(input):
    return math.sqrt(input["value"])
`
      )

      const result = await executor.execute(fn, { value: 16 })

      expect(result.status).toBe('completed')
      expect(result.output).toBe(4)
    })

    it('should support re module', async () => {
      const fn = createPythonFunction<{ text: string }, string[]>(
        'python-regex',
        `
import re

def handler(input):
    return re.findall(r'\\d+', input["text"])
`
      )

      const result = await executor.execute(fn, { text: 'abc123def456' })

      expect(result.status).toBe('completed')
      expect(result.output).toEqual(['123', '456'])
    })

    it('should support datetime module', async () => {
      const fn = createPythonFunction<void, string>(
        'python-datetime',
        `
from datetime import datetime

def handler(input):
    dt = datetime(2024, 1, 1, 12, 0, 0)
    return dt.isoformat()
`
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('completed')
      expect(result.output).toBe('2024-01-01T12:00:00')
    })

    it('should support collections module', async () => {
      const fn = createPythonFunction<{ items: string[] }, Record<string, number>>(
        'python-collections',
        `
from collections import Counter

def handler(input):
    return dict(Counter(input["items"]))
`
      )

      const result = await executor.execute(fn, { items: ['a', 'b', 'a', 'c', 'a', 'b'] })

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ a: 3, b: 2, c: 1 })
    })
  })

  // ==========================================================================
  // Python Execution Metrics
  // ==========================================================================

  describe('Python Execution Metrics', () => {
    it('should return execution metrics', async () => {
      const fn = createPythonFunction<void, number>(
        'python-metrics',
        `
def handler(input):
    total = 0
    for i in range(1000):
        total += i
    return total
`
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('completed')
      expect(result.codeExecution).toBeDefined()
      expect(result.codeExecution.language).toBe('python')
      expect(result.codeExecution.cpuTimeMs).toBeGreaterThanOrEqual(0)
      expect(result.codeExecution.memoryUsedBytes).toBeGreaterThanOrEqual(0)
    })

    it('should track compilation time', async () => {
      const fn = createPythonFunction<void, string>(
        'python-compilation',
        `
def handler(input):
    return "compiled"
`
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('completed')
      expect(result.codeExecution.compilationTimeMs).toBeDefined()
      expect(result.codeExecution.compilationTimeMs).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // Python Async Support
  // ==========================================================================

  describe('Python Async Support', () => {
    it('should execute async Python function', async () => {
      const fn = createPythonFunction<void, string>(
        'python-async',
        `
import asyncio

async def handler(input):
    await asyncio.sleep(0.01)
    return "async result"
`
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('completed')
      expect(result.output).toBe('async result')
    })

    it('should handle async function without await', async () => {
      const fn = createPythonFunction<void, number>(
        'python-async-no-await',
        `
async def handler(input):
    return 42
`
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('completed')
      expect(result.output).toBe(42)
    })
  })
})
