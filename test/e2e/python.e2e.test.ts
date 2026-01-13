/**
 * E2E Tests: Python Function Deploy and Invoke (RED)
 *
 * These tests verify the full deployment and invocation flow for Python
 * functions on the live functions.do platform.
 *
 * Python functions can be executed via Pyodide (WASM) or server-side runtime.
 *
 * Prerequisites:
 * - functions.do Worker must be deployed
 * - Python runtime (Pyodide or server-side) must be available
 *
 * Run with: npm run test:e2e
 */

import { describe, it, expect, afterAll } from 'vitest'
import {
  E2E_CONFIG,
  generateTestFunctionId,
  shouldRunE2E,
  deployFunction,
  invokeFunction,
  deleteFunction,
} from './config'

describe.skipIf(!shouldRunE2E())('E2E: Python Function Deploy and Invoke', () => {
  const deployedFunctions: string[] = []

  afterAll(async () => {
    if (!E2E_CONFIG.skipCleanup) {
      for (const functionId of deployedFunctions) {
        try {
          await deleteFunction(functionId)
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  })

  describe('Basic Deployment', () => {
    it('deploys a simple Python function', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
def handler(request):
    return {
        "message": "Hello from Python!"
    }
      `

      const result = await deployFunction({
        id: functionId,
        code,
        language: 'python',
        version: '1.0.0',
      })

      expect(result.id).toBe(functionId)
      expect(result.version).toBe('1.0.0')
      expect(result.url).toContain(functionId)
    }, E2E_CONFIG.deployTimeout)

    it('deploys and invokes returning JSON', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
import json
from datetime import datetime

def handler(request):
    body = request.get("body", {})
    return {
        "message": "Hello, World!",
        "received": body,
        "timestamp": datetime.now().isoformat()
    }
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'python',
        version: '1.0.0',
      })

      const result = await invokeFunction<{
        message: string
        received: unknown
        timestamp: string
      }>(functionId, { test: true })

      expect(result.message).toBe('Hello, World!')
      expect(result.received).toEqual({ test: true })
      expect(result.timestamp).toBeDefined()
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)
  })

  describe('Mathematical Operations', () => {
    it('performs basic arithmetic', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
def handler(request):
    body = request.get("body", {})
    a = body.get("a", 0)
    b = body.get("b", 0)
    operation = body.get("operation", "add")

    if operation == "add":
        result = a + b
    elif operation == "subtract":
        result = a - b
    elif operation == "multiply":
        result = a * b
    elif operation == "divide":
        result = a / b if b != 0 else None
    else:
        result = None

    return {"result": result}
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'python',
        version: '1.0.0',
      })

      // Test add
      const addResult = await invokeFunction<{ result: number }>(functionId, {
        a: 10,
        b: 5,
        operation: 'add',
      })
      expect(addResult.result).toBe(15)

      // Test multiply
      const multiplyResult = await invokeFunction<{ result: number }>(functionId, {
        a: 10,
        b: 5,
        operation: 'multiply',
      })
      expect(multiplyResult.result).toBe(50)

      // Test divide
      const divideResult = await invokeFunction<{ result: number }>(functionId, {
        a: 22,
        b: 7,
        operation: 'divide',
      })
      expect(divideResult.result).toBeCloseTo(3.142857, 5)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout * 3)

    it('handles large numbers', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
def handler(request):
    body = request.get("body", {})
    a = int(body.get("a", 0))
    b = int(body.get("b", 0))
    return {"result": str(a + b)}
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'python',
        version: '1.0.0',
      })

      const result = await invokeFunction<{ result: string }>(functionId, {
        a: '9007199254740992',
        b: '1',
      })

      expect(result.result).toBe('9007199254740993')
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)
  })

  describe('Data Processing', () => {
    it('processes arrays of data', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
def handler(request):
    body = request.get("body", {})
    numbers = body.get("numbers", [])

    if not numbers:
        return {"error": "No numbers provided"}

    return {
        "sum": sum(numbers),
        "average": sum(numbers) / len(numbers),
        "min": min(numbers),
        "max": max(numbers),
        "count": len(numbers)
    }
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'python',
        version: '1.0.0',
      })

      const result = await invokeFunction<{
        sum: number
        average: number
        min: number
        max: number
        count: number
      }>(functionId, {
        numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      })

      expect(result.sum).toBe(55)
      expect(result.average).toBe(5.5)
      expect(result.min).toBe(1)
      expect(result.max).toBe(10)
      expect(result.count).toBe(10)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)

    it('processes nested objects', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
def handler(request):
    body = request.get("body", {})
    user = body.get("user", {})

    return {
        "greeting": f"Hello, {user.get('name', 'Guest')}!",
        "email_domain": user.get("email", "@unknown").split("@")[-1],
        "age_category": "adult" if user.get("age", 0) >= 18 else "minor"
    }
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'python',
        version: '1.0.0',
      })

      const result = await invokeFunction<{
        greeting: string
        email_domain: string
        age_category: string
      }>(functionId, {
        user: {
          name: 'Alice',
          email: 'alice@example.com',
          age: 25,
        },
      })

      expect(result.greeting).toBe('Hello, Alice!')
      expect(result.email_domain).toBe('example.com')
      expect(result.age_category).toBe('adult')
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)
  })

  describe('String Manipulation', () => {
    it('processes strings', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
def handler(request):
    body = request.get("body", {})
    text = body.get("text", "")

    return {
        "uppercase": text.upper(),
        "lowercase": text.lower(),
        "reversed": text[::-1],
        "length": len(text),
        "word_count": len(text.split())
    }
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'python',
        version: '1.0.0',
      })

      const result = await invokeFunction<{
        uppercase: string
        lowercase: string
        reversed: string
        length: number
        word_count: number
      }>(functionId, {
        text: 'Hello World from Python',
      })

      expect(result.uppercase).toBe('HELLO WORLD FROM PYTHON')
      expect(result.lowercase).toBe('hello world from python')
      expect(result.reversed).toBe('nohtyP morf dlroW olleH')
      expect(result.length).toBe(23)
      expect(result.word_count).toBe(4)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)
  })

  describe('Error Handling', () => {
    it('rejects invalid Python syntax', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
def handler(request)  # Missing colon
    return {"message": "broken"}
      `

      await expect(
        deployFunction({
          id: functionId,
          code,
          language: 'python',
          version: '1.0.0',
        })
      ).rejects.toThrow()
    })

    it('rejects code with no handler function', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
# No handler function defined
def some_other_function():
    return 42
      `

      await expect(
        deployFunction({
          id: functionId,
          code,
          language: 'python',
          version: '1.0.0',
        })
      ).rejects.toThrow(/handler|entry point/i)
    })

    it('handles runtime errors gracefully', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
def handler(request):
    raise ValueError("Intentional error for testing")
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'python',
        version: '1.0.0',
      })

      // Invoking should return an error response, not crash
      await expect(invokeFunction(functionId)).rejects.toThrow(/error|failed/i)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)

    it('handles division by zero', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
def handler(request):
    body = request.get("body", {})
    a = body.get("a", 1)
    b = body.get("b", 1)
    return {"result": a / b}
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'python',
        version: '1.0.0',
      })

      // Should handle division by zero gracefully
      await expect(
        invokeFunction(functionId, { a: 10, b: 0 })
      ).rejects.toThrow(/error|zero/i)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)
  })

  describe('Python Standard Library', () => {
    it('uses json module', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
import json

def handler(request):
    body = request.get("body", {})
    data = body.get("data", {})

    # Serialize and deserialize
    json_str = json.dumps(data, sort_keys=True)
    parsed = json.loads(json_str)

    return {
        "serialized": json_str,
        "parsed": parsed
    }
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'python',
        version: '1.0.0',
      })

      const testData = { b: 2, a: 1, c: 3 }
      const result = await invokeFunction<{
        serialized: string
        parsed: Record<string, number>
      }>(functionId, { data: testData })

      expect(result.serialized).toBe('{"a": 1, "b": 2, "c": 3}')
      expect(result.parsed).toEqual(testData)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)

    it('uses math module', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
import math

def handler(request):
    body = request.get("body", {})
    x = body.get("x", 1)

    return {
        "sqrt": math.sqrt(x),
        "sin": math.sin(x),
        "cos": math.cos(x),
        "log": math.log(x),
        "factorial": math.factorial(int(x)) if x >= 0 and x == int(x) else None
    }
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'python',
        version: '1.0.0',
      })

      const result = await invokeFunction<{
        sqrt: number
        sin: number
        cos: number
        log: number
        factorial: number
      }>(functionId, { x: 5 })

      expect(result.sqrt).toBeCloseTo(Math.sqrt(5))
      expect(result.sin).toBeCloseTo(Math.sin(5))
      expect(result.cos).toBeCloseTo(Math.cos(5))
      expect(result.log).toBeCloseTo(Math.log(5))
      expect(result.factorial).toBe(120)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)

    it('uses collections module', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
from collections import Counter

def handler(request):
    body = request.get("body", {})
    text = body.get("text", "")

    # Count character frequency
    char_count = Counter(text.lower())
    most_common = char_count.most_common(5)

    return {
        "most_common": [{"char": c, "count": n} for c, n in most_common]
    }
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'python',
        version: '1.0.0',
      })

      const result = await invokeFunction<{
        most_common: Array<{ char: string; count: number }>
      }>(functionId, { text: 'hello world' })

      expect(result.most_common.length).toBeLessThanOrEqual(5)
      // 'l' appears 3 times, should be most common
      expect(result.most_common[0].char).toBe('l')
      expect(result.most_common[0].count).toBe(3)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)
  })

  describe('Versioning', () => {
    it('deploys multiple versions of the same function', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      // Deploy v1
      const codeV1 = `
def handler(request):
    return {"version": 1}
      `
      await deployFunction({
        id: functionId,
        code: codeV1,
        language: 'python',
        version: '1.0.0',
      })

      // Deploy v2
      const codeV2 = `
def handler(request):
    return {"version": 2}
      `
      await deployFunction({
        id: functionId,
        code: codeV2,
        language: 'python',
        version: '2.0.0',
      })

      // Latest should return v2
      const result = await invokeFunction<{ version: number }>(functionId)
      expect(result.version).toBe(2)
    }, E2E_CONFIG.deployTimeout * 2 + E2E_CONFIG.invokeTimeout)
  })

  describe('Performance', () => {
    it('executes with acceptable latency', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
def handler(request):
    body = request.get("body", {})
    a = body.get("a", 0)
    b = body.get("b", 0)
    return {"result": a + b}
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'python',
        version: '1.0.0',
      })

      const start = Date.now()
      await invokeFunction(functionId, { a: 1, b: 2 })
      const elapsed = Date.now() - start

      // First invocation might be slower (cold start, Pyodide init)
      // Python/Pyodide may have higher overhead than compiled languages
      expect(elapsed).toBeLessThan(10000) // 10s max for cold start with Pyodide
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)

    it('handles compute-intensive operations', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      const code = `
def handler(request):
    body = request.get("body", {})
    n = body.get("n", 30)

    # Compute fibonacci using dynamic programming
    if n <= 1:
        return {"fibonacci": n}

    fib = [0, 1]
    for i in range(2, n + 1):
        fib.append(fib[i-1] + fib[i-2])

    return {"fibonacci": fib[n]}
      `

      await deployFunction({
        id: functionId,
        code,
        language: 'python',
        version: '1.0.0',
      })

      const result = await invokeFunction<{ fibonacci: number }>(functionId, { n: 40 })
      expect(result.fibonacci).toBe(102334155)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)
  })
})
