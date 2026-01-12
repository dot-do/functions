/**
 * Python Callback Tests (RED)
 *
 * These tests validate Python function invocation via Cloudflare Python Workers (Pyodide).
 * The Python invoker is responsible for:
 * 1. Executing Python function code within the Pyodide runtime
 * 2. Passing arguments correctly from JavaScript to Python
 * 3. Returning results correctly from Python to JavaScript
 * 4. Handling various data types across the language boundary
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the implementation (invokePython) does not exist yet.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { invokePython } from '../python-invoker'
import type { PythonInvocationResult } from '../types'

describe('Python Callback via Pyodide', () => {
  describe('Basic Function Invocation', () => {
    it('should invoke a simple Python function that returns a string', async () => {
      const code = `
def handler(args):
    return "Hello from Python!"
`
      const result = await invokePython(code, {})

      expect(result.success).toBe(true)
      expect(result.value).toBe('Hello from Python!')
    })

    it('should invoke a Python function that receives and returns arguments', async () => {
      const code = `
def handler(args):
    name = args.get("name", "World")
    return f"Hello, {name}!"
`
      const result = await invokePython(code, { name: 'Functions.do' })

      expect(result.success).toBe(true)
      expect(result.value).toBe('Hello, Functions.do!')
    })

    it('should invoke a Python function with multiple arguments', async () => {
      const code = `
def handler(args):
    a = args.get("a", 0)
    b = args.get("b", 0)
    return a + b
`
      const result = await invokePython(code, { a: 10, b: 20 })

      expect(result.success).toBe(true)
      expect(result.value).toBe(30)
    })
  })

  describe('Data Type Handling', () => {
    it('should correctly pass and return string values', async () => {
      const code = `
def handler(args):
    text = args.get("text")
    return text.upper()
`
      const result = await invokePython(code, { text: 'hello world' })

      expect(result.success).toBe(true)
      expect(result.value).toBe('HELLO WORLD')
    })

    it('should correctly pass and return integer values', async () => {
      const code = `
def handler(args):
    num = args.get("number")
    return num * 2
`
      const result = await invokePython(code, { number: 42 })

      expect(result.success).toBe(true)
      expect(result.value).toBe(84)
    })

    it('should correctly pass and return floating point values', async () => {
      const code = `
def handler(args):
    value = args.get("value")
    return round(value * 3.14159, 2)
`
      const result = await invokePython(code, { value: 2.0 })

      expect(result.success).toBe(true)
      expect(result.value).toBeCloseTo(6.28, 2)
    })

    it('should correctly pass and return boolean values', async () => {
      const code = `
def handler(args):
    flag = args.get("flag")
    return not flag
`
      const result = await invokePython(code, { flag: true })

      expect(result.success).toBe(true)
      expect(result.value).toBe(false)
    })

    it('should correctly pass and return null/None values', async () => {
      const code = `
def handler(args):
    value = args.get("maybeNull")
    if value is None:
        return "was null"
    return "was not null"
`
      const result = await invokePython(code, { maybeNull: null })

      expect(result.success).toBe(true)
      expect(result.value).toBe('was null')
    })

    it('should correctly pass and return array/list values', async () => {
      const code = `
def handler(args):
    items = args.get("items")
    return [x * 2 for x in items]
`
      const result = await invokePython(code, { items: [1, 2, 3, 4, 5] })

      expect(result.success).toBe(true)
      expect(result.value).toEqual([2, 4, 6, 8, 10])
    })

    it('should correctly pass and return object/dict values', async () => {
      const code = `
def handler(args):
    person = args.get("person")
    return {
        "greeting": f"Hello, {person['name']}!",
        "age_next_year": person['age'] + 1
    }
`
      const result = await invokePython(code, {
        person: { name: 'Alice', age: 30 },
      })

      expect(result.success).toBe(true)
      expect(result.value).toEqual({
        greeting: 'Hello, Alice!',
        age_next_year: 31,
      })
    })

    it('should handle nested objects and arrays', async () => {
      const code = `
def handler(args):
    data = args.get("data")
    users = data["users"]
    total_age = sum(user["age"] for user in users)
    return {
        "count": len(users),
        "total_age": total_age,
        "names": [user["name"] for user in users]
    }
`
      const result = await invokePython(code, {
        data: {
          users: [
            { name: 'Alice', age: 30 },
            { name: 'Bob', age: 25 },
            { name: 'Charlie', age: 35 },
          ],
        },
      })

      expect(result.success).toBe(true)
      expect(result.value).toEqual({
        count: 3,
        total_age: 90,
        names: ['Alice', 'Bob', 'Charlie'],
      })
    })
  })

  describe('Error Handling', () => {
    it('should capture Python syntax errors', async () => {
      const code = `
def handler(args):
    return "missing quote
`
      const result = await invokePython(code, {})

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.type).toBe('SyntaxError')
    })

    it('should capture Python runtime errors', async () => {
      const code = `
def handler(args):
    return 1 / 0
`
      const result = await invokePython(code, {})

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.type).toBe('ZeroDivisionError')
    })

    it('should capture Python NameError for undefined variables', async () => {
      const code = `
def handler(args):
    return undefined_variable
`
      const result = await invokePython(code, {})

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.type).toBe('NameError')
    })

    it('should capture Python TypeError for invalid operations', async () => {
      const code = `
def handler(args):
    return "string" + 42
`
      const result = await invokePython(code, {})

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.type).toBe('TypeError')
    })

    it('should handle missing handler function', async () => {
      const code = `
def some_other_function(args):
    return "This is not the handler"
`
      const result = await invokePython(code, {})

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('handler')
    })

    it('should include Python traceback in error details', async () => {
      const code = `
def inner_function():
    raise ValueError("Something went wrong")

def handler(args):
    return inner_function()
`
      const result = await invokePython(code, {})

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.traceback).toBeDefined()
      expect(result.error?.traceback).toContain('inner_function')
    })
  })

  describe('Python Standard Library Usage', () => {
    it('should support json module', async () => {
      const code = `
import json

def handler(args):
    data = args.get("data")
    return json.dumps(data, sort_keys=True)
`
      const result = await invokePython(code, {
        data: { b: 2, a: 1 },
      })

      expect(result.success).toBe(true)
      expect(result.value).toBe('{"a": 1, "b": 2}')
    })

    it('should support math module', async () => {
      const code = `
import math

def handler(args):
    value = args.get("value")
    return {
        "sqrt": math.sqrt(value),
        "log": math.log(value),
        "sin": math.sin(value)
    }
`
      const result = await invokePython(code, { value: 4 })

      expect(result.success).toBe(true)
      expect(result.value.sqrt).toBe(2)
      expect(result.value.log).toBeCloseTo(1.386, 2)
    })

    it('should support datetime module', async () => {
      const code = `
from datetime import datetime, timedelta

def handler(args):
    date_str = args.get("date")
    dt = datetime.fromisoformat(date_str)
    next_day = dt + timedelta(days=1)
    return next_day.isoformat()
`
      const result = await invokePython(code, { date: '2024-01-15T10:30:00' })

      expect(result.success).toBe(true)
      expect(result.value).toBe('2024-01-16T10:30:00')
    })

    it('should support re module for regex', async () => {
      const code = `
import re

def handler(args):
    text = args.get("text")
    pattern = args.get("pattern")
    matches = re.findall(pattern, text)
    return matches
`
      const result = await invokePython(code, {
        text: 'The quick brown fox jumps over the lazy dog',
        pattern: '\\b\\w{5}\\b',
      })

      expect(result.success).toBe(true)
      expect(result.value).toEqual(['quick', 'brown', 'jumps'])
    })

    it('should support collections module', async () => {
      const code = `
from collections import Counter

def handler(args):
    items = args.get("items")
    counter = Counter(items)
    return dict(counter.most_common(3))
`
      const result = await invokePython(code, {
        items: ['a', 'b', 'a', 'c', 'a', 'b', 'd', 'a'],
      })

      expect(result.success).toBe(true)
      expect(result.value).toEqual({ a: 4, b: 2, c: 1 })
    })
  })

  describe('Async Python Functions', () => {
    it('should support async handler functions', async () => {
      const code = `
import asyncio

async def handler(args):
    await asyncio.sleep(0.001)
    return "async result"
`
      const result = await invokePython(code, {})

      expect(result.success).toBe(true)
      expect(result.value).toBe('async result')
    })

    it('should handle async errors properly', async () => {
      const code = `
import asyncio

async def handler(args):
    await asyncio.sleep(0.001)
    raise RuntimeError("Async error occurred")
`
      const result = await invokePython(code, {})

      expect(result.success).toBe(false)
      expect(result.error?.type).toBe('RuntimeError')
      expect(result.error?.message).toContain('Async error occurred')
    })
  })

  describe('Execution Metadata', () => {
    it('should return execution time in result', async () => {
      const code = `
def handler(args):
    return "done"
`
      const result = await invokePython(code, {})

      expect(result.success).toBe(true)
      expect(result.executionTimeMs).toBeDefined()
      expect(typeof result.executionTimeMs).toBe('number')
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('should return memory usage information', async () => {
      const code = `
def handler(args):
    large_list = list(range(10000))
    return len(large_list)
`
      const result = await invokePython(code, {})

      expect(result.success).toBe(true)
      expect(result.memoryUsageBytes).toBeDefined()
      expect(typeof result.memoryUsageBytes).toBe('number')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty arguments', async () => {
      const code = `
def handler(args):
    return len(args)
`
      const result = await invokePython(code, {})

      expect(result.success).toBe(true)
      expect(result.value).toBe(0)
    })

    it('should handle very large arguments', async () => {
      const code = `
def handler(args):
    data = args.get("largeArray")
    return sum(data)
`
      const largeArray = Array.from({ length: 10000 }, (_, i) => i)
      const result = await invokePython(code, { largeArray })

      expect(result.success).toBe(true)
      expect(result.value).toBe(49995000) // Sum of 0 to 9999
    })

    it('should handle unicode strings', async () => {
      const code = `
def handler(args):
    text = args.get("text")
    return f"Received: {text}"
`
      const result = await invokePython(code, {
        text: 'Hello, 世界! 🎉',
      })

      expect(result.success).toBe(true)
      expect(result.value).toBe('Received: Hello, 世界! 🎉')
    })

    it('should handle special float values', async () => {
      const code = `
import math

def handler(args):
    return {
        "inf": float('inf'),
        "neg_inf": float('-inf'),
        "nan_check": math.isnan(float('nan'))
    }
`
      const result = await invokePython(code, {})

      expect(result.success).toBe(true)
      expect(result.value.inf).toBe(Infinity)
      expect(result.value.neg_inf).toBe(-Infinity)
      expect(result.value.nan_check).toBe(true)
    })

    it('should handle function that returns None', async () => {
      const code = `
def handler(args):
    x = 1 + 1
    # No explicit return
`
      const result = await invokePython(code, {})

      expect(result.success).toBe(true)
      expect(result.value).toBeNull()
    })
  })
})
