/**
 * Python Pyodide E2E Tests (RED)
 *
 * These tests are comprehensive end-to-end tests for Python execution via Pyodide
 * (Python running in WebAssembly). They test the full workflow from Python source
 * code to actual execution in the Pyodide runtime.
 *
 * Test categories:
 * 1. Execute simple Python function - Basic function execution
 * 2. Handle Python syntax errors - Syntax error detection and reporting
 * 3. Support async/await - Async function execution
 * 4. Load dependencies from requirements.txt - Package installation
 * 5. Handle unsupported packages gracefully - Incompatible package handling
 * 6. Test memory limits - Memory constraint enforcement
 * 7. Test exception handling - Python exception propagation
 * 8. Support multiple handler functions - Multiple entry points
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * until the full Pyodide execution pipeline is implemented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  executePyodide,
  loadPyodideRuntime,
  type PyodideExecutionResult,
  type PyodideRuntimeOptions,
  type PyodideRuntime,
} from '../pyodide-executor'

/**
 * Global Pyodide runtime instance for tests
 * We reuse one instance to avoid slow initialization for each test
 */
let pyodide: PyodideRuntime

beforeAll(async () => {
  // Initialize Pyodide runtime - this may take several seconds
  // In Node.js, we let pyodide find its own files
  // In browser/Workers, we use the CDN URL
  const isNode = typeof process !== 'undefined' && process.versions?.node
  pyodide = await loadPyodideRuntime(
    isNode ? {} : { indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.0/full/' }
  )
}, 60000) // 60 second timeout for Pyodide initialization

afterAll(async () => {
  // Clean up Pyodide runtime
  if (pyodide) {
    await pyodide.dispose()
  }
})

// ============================================================================
// E2E Test: Execute Simple Python Function
// ============================================================================

describe('E2E: Execute Simple Python Function', () => {
  it('executes a Python function returning a constant', async () => {
    const code = `
def handler():
    return 42
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    expect(result.value).toBe(42)
  })

  it('executes a Python function with string return', async () => {
    const code = `
def handler():
    return "Hello, Pyodide!"
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    expect(result.value).toBe('Hello, Pyodide!')
  })

  it('executes a Python function with arguments', async () => {
    const code = `
def handler(name, greeting="Hello"):
    return f"{greeting}, {name}!"
`
    const result = await executePyodide(pyodide, code, 'handler', ['World'])

    expect(result.success).toBe(true)
    expect(result.value).toBe('Hello, World!')
  })

  it('executes a Python function with multiple arguments', async () => {
    const code = `
def handler(a, b, c):
    return a + b + c
`
    const result = await executePyodide(pyodide, code, 'handler', [1, 2, 3])

    expect(result.success).toBe(true)
    expect(result.value).toBe(6)
  })

  it('handles object arguments correctly', async () => {
    const code = `
def handler(data):
    return data['x'] + data['y']
`
    const result = await executePyodide(pyodide, code, 'handler', [{ x: 10, y: 20 }])

    expect(result.success).toBe(true)
    expect(result.value).toBe(30)
  })

  it('handles array arguments correctly', async () => {
    const code = `
def handler(items):
    return sum(items)
`
    const result = await executePyodide(pyodide, code, 'handler', [[1, 2, 3, 4, 5]])

    expect(result.success).toBe(true)
    expect(result.value).toBe(15)
  })

  it('returns Python dict as JavaScript object', async () => {
    const code = `
def handler():
    return {"name": "test", "value": 123, "nested": {"key": "value"}}
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    expect(result.value).toEqual({ name: 'test', value: 123, nested: { key: 'value' } })
  })

  it('returns Python list as JavaScript array', async () => {
    const code = `
def handler():
    return [1, "two", 3.0, True, None]
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    expect(result.value).toEqual([1, 'two', 3.0, true, null])
  })

  it('handles None/null correctly', async () => {
    const code = `
def handler():
    return None
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    expect(result.value).toBeNull()
  })

  it('handles boolean values correctly', async () => {
    const code = `
def handler(flag):
    return not flag
`
    const result = await executePyodide(pyodide, code, 'handler', [true])

    expect(result.success).toBe(true)
    expect(result.value).toBe(false)
  })

  it('handles float values correctly', async () => {
    const code = `
def handler(x):
    return x * 3.14159
`
    const result = await executePyodide(pyodide, code, 'handler', [2.0])

    expect(result.success).toBe(true)
    expect(result.value).toBeCloseTo(6.28318, 4)
  })

  it('handles large integers correctly', async () => {
    const code = `
def handler():
    return 9007199254740993  # Larger than JS MAX_SAFE_INTEGER
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    // Large integers may be returned as strings or BigInt
    expect(String(result.value)).toBe('9007199254740993')
  })

  it('uses Python standard library modules', async () => {
    const code = `
import json
import math
import re

def handler(data):
    parsed = json.loads(data)
    return {
        "sqrt": math.sqrt(parsed["number"]),
        "matches": re.findall(r"\\d+", parsed["text"])
    }
`
    const input = JSON.stringify({ number: 16, text: 'abc123def456' })
    const result = await executePyodide(pyodide, code, 'handler', [input])

    expect(result.success).toBe(true)
    expect(result.value).toEqual({ sqrt: 4, matches: ['123', '456'] })
  })
})

// ============================================================================
// E2E Test: Handle Python Syntax Errors
// ============================================================================

describe('E2E: Handle Python Syntax Errors', () => {
  it('reports missing colon in function definition', async () => {
    const code = `
def handler()
    return 42
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('SyntaxError')
  })

  it('reports unmatched parenthesis', async () => {
    const code = `
def handler():
    return (1 + 2
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toContain('SyntaxError')
  })

  it('reports invalid indentation', async () => {
    const code = `
def handler():
return 42
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toContain('IndentationError')
  })

  it('reports unclosed string literal', async () => {
    const code = `
def handler():
    return "unclosed string
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('reports invalid Python keyword usage', async () => {
    const code = `
def def():
    return 42
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toContain('SyntaxError')
  })

  it('reports missing handler function', async () => {
    const code = `
def other_function():
    return "not the handler"
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toContain('handler')
    expect(result.error).toMatch(/not found|not defined|does not exist/i)
  })

  it('reports error line number for syntax errors', async () => {
    const code = `
def handler():
    x = 1
    y = 2
    z =
    return x + y + z
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    // Should include line number in error
    expect(result.errorLine).toBeDefined()
    expect(result.errorLine).toBeGreaterThan(0)
  })

  it('handles empty code gracefully', async () => {
    const result = await executePyodide(pyodide, '', 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('handles whitespace-only code gracefully', async () => {
    const result = await executePyodide(pyodide, '   \n\t  ', 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })
})

// ============================================================================
// E2E Test: Support Async/Await
// ============================================================================

describe('E2E: Support Async/Await', () => {
  it('executes async function with await', async () => {
    const code = `
import asyncio

async def handler():
    await asyncio.sleep(0.01)
    return "async result"
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    expect(result.value).toBe('async result')
  })

  it('handles async function without await', async () => {
    const code = `
async def handler():
    return 42
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    expect(result.value).toBe(42)
  })

  it('executes multiple awaits in sequence', async () => {
    const code = `
import asyncio

async def handler():
    results = []
    for i in range(3):
        await asyncio.sleep(0.001)
        results.append(i)
    return results
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    expect(result.value).toEqual([0, 1, 2])
  })

  it('handles asyncio.gather', async () => {
    const code = `
import asyncio

async def fetch(n):
    await asyncio.sleep(0.001)
    return n * 2

async def handler():
    results = await asyncio.gather(
        fetch(1),
        fetch(2),
        fetch(3)
    )
    return list(results)
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    expect(result.value).toEqual([2, 4, 6])
  })

  it('handles async exception properly', async () => {
    const code = `
import asyncio

async def handler():
    await asyncio.sleep(0.001)
    raise ValueError("async error")
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toContain('ValueError')
    expect(result.error).toContain('async error')
  })

  it('supports async context managers', async () => {
    const code = `
import asyncio
from contextlib import asynccontextmanager

@asynccontextmanager
async def timer():
    yield "started"

async def handler():
    async with timer() as status:
        return status
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    expect(result.value).toBe('started')
  })

  it('handles async generators', async () => {
    const code = `
import asyncio

async def gen():
    for i in range(3):
        await asyncio.sleep(0.001)
        yield i

async def handler():
    results = []
    async for item in gen():
        results.append(item)
    return results
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    expect(result.value).toEqual([0, 1, 2])
  })

  it('auto-detects and runs sync functions', async () => {
    const code = `
def handler():
    return "sync function"
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    expect(result.value).toBe('sync function')
  })

  it('auto-detects and awaits async functions', async () => {
    const code = `
async def handler():
    return "async function"
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    expect(result.value).toBe('async function')
  })
})

// ============================================================================
// E2E Test: Load Dependencies from requirements.txt
// ============================================================================

describe('E2E: Load Dependencies from requirements.txt', () => {
  it('loads and uses numpy', async () => {
    const code = `
import numpy as np

def handler():
    arr = np.array([1, 2, 3, 4, 5])
    return float(np.mean(arr))
`
    const result = await executePyodide(pyodide, code, 'handler', [], {
      packages: ['numpy'],
    })

    expect(result.success).toBe(true)
    expect(result.value).toBe(3.0)
  }, 30000)

  it('loads and uses pandas', async () => {
    const code = `
import pandas as pd

def handler():
    df = pd.DataFrame({"a": [1, 2, 3], "b": [4, 5, 6]})
    return df.to_dict(orient="list")
`
    const result = await executePyodide(pyodide, code, 'handler', [], {
      packages: ['pandas'],
    })

    expect(result.success).toBe(true)
    expect(result.value).toEqual({ a: [1, 2, 3], b: [4, 5, 6] })
  }, 30000)

  it('loads and uses pydantic', async () => {
    const code = `
from pydantic import BaseModel

class User(BaseModel):
    name: str
    age: int

def handler(data):
    user = User(**data)
    return {"name": user.name, "age": user.age}
`
    const result = await executePyodide(pyodide, code, 'handler', [{ name: 'Alice', age: 30 }], {
      packages: ['pydantic'],
    })

    expect(result.success).toBe(true)
    expect(result.value).toEqual({ name: 'Alice', age: 30 })
  }, 30000)

  it('loads multiple packages', async () => {
    const code = `
import numpy as np
import json

def handler():
    arr = np.array([1, 2, 3])
    return {"sum": int(np.sum(arr)), "data": arr.tolist()}
`
    const result = await executePyodide(pyodide, code, 'handler', [], {
      packages: ['numpy'],
    })

    expect(result.success).toBe(true)
    expect(result.value).toEqual({ sum: 6, data: [1, 2, 3] })
  }, 30000)

  it('parses requirements.txt format', async () => {
    const requirementsTxt = `
# Python dependencies
numpy>=1.20.0
pandas
pydantic>=2.0.0
`
    const code = `
import numpy as np

def handler():
    return "packages loaded"
`
    const result = await executePyodide(pyodide, code, 'handler', [], {
      requirementsTxt,
    })

    expect(result.success).toBe(true)
    expect(result.value).toBe('packages loaded')
  }, 60000)

  it('handles package with extras', async () => {
    const code = `
import httpx

def handler():
    return "httpx loaded"
`
    const result = await executePyodide(pyodide, code, 'handler', [], {
      packages: ['httpx'],
    })

    expect(result.success).toBe(true)
    expect(result.value).toBe('httpx loaded')
  }, 30000)

  it('loads pure Python packages from PyPI', async () => {
    const code = `
import more_itertools

def handler():
    chunks = list(more_itertools.chunked([1, 2, 3, 4, 5], 2))
    return chunks
`
    const result = await executePyodide(pyodide, code, 'handler', [], {
      packages: ['more-itertools'],
    })

    expect(result.success).toBe(true)
    expect(result.value).toEqual([[1, 2], [3, 4], [5]])
  }, 30000)

  it('reports missing package error', async () => {
    const code = `
import nonexistent_package_12345

def handler():
    return "should not reach here"
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toContain('ModuleNotFoundError')
  })
})

// ============================================================================
// E2E Test: Handle Unsupported Packages Gracefully
// ============================================================================

describe('E2E: Handle Unsupported Packages Gracefully', () => {
  it('reports error for psycopg2 (native dependency)', async () => {
    const code = `
import psycopg2

def handler():
    return "should not reach here"
`
    const result = await executePyodide(pyodide, code, 'handler', [], {
      packages: ['psycopg2'],
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.incompatiblePackages).toContain('psycopg2')
  })

  it('reports error for boto3 (socket dependency)', async () => {
    const code = `
import boto3

def handler():
    return "should not reach here"
`
    const result = await executePyodide(pyodide, code, 'handler', [], {
      packages: ['boto3'],
    })

    expect(result.success).toBe(false)
    expect(result.incompatiblePackages).toContain('boto3')
  })

  it('reports error for tensorflow (too large)', async () => {
    const code = `
import tensorflow as tf

def handler():
    return "should not reach here"
`
    const result = await executePyodide(pyodide, code, 'handler', [], {
      packages: ['tensorflow'],
    })

    expect(result.success).toBe(false)
    expect(result.incompatiblePackages).toContain('tensorflow')
    expect(result.suggestion).toContain('Workers AI')
  })

  it('provides helpful suggestions for incompatible packages', async () => {
    const code = `
import redis

def handler():
    return "should not reach here"
`
    const result = await executePyodide(pyodide, code, 'handler', [], {
      packages: ['redis'],
    })

    expect(result.success).toBe(false)
    expect(result.suggestion).toBeDefined()
    expect(result.suggestion).toMatch(/KV|REST|Upstash/i)
  })

  it('filters incompatible packages and runs compatible ones', async () => {
    const code = `
import numpy as np

def handler():
    return float(np.sum([1, 2, 3]))
`
    // Mix of compatible and incompatible packages
    const result = await executePyodide(pyodide, code, 'handler', [], {
      packages: ['numpy', 'psycopg2'],
      skipIncompatible: true,
    })

    expect(result.success).toBe(true)
    expect(result.value).toBe(6.0)
    expect(result.skippedPackages).toContain('psycopg2')
    expect(result.warnings?.length).toBeGreaterThan(0)
  }, 30000)

  it('validates packages before execution', async () => {
    const result = await executePyodide(pyodide, '', 'handler', [], {
      packages: ['django', 'flask', 'fastapi'],
      validateOnly: true,
    })

    expect(result.success).toBe(false)
    expect(result.incompatiblePackages).toContain('django')
    expect(result.incompatiblePackages).toContain('flask')
    expect(result.incompatiblePackages).toContain('fastapi')
  })
})

// ============================================================================
// E2E Test: Memory Limits
// ============================================================================

describe('E2E: Memory Limits', () => {
  it('executes within default memory limits', async () => {
    const code = `
def handler():
    # Allocate moderate memory
    data = [i for i in range(10000)]
    return sum(data)
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    expect(result.value).toBe(49995000)
  })

  it('reports memory usage in result', async () => {
    const code = `
def handler():
    data = "x" * 1000000  # 1MB string
    return len(data)
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    expect(result.memoryUsedBytes).toBeDefined()
    expect(result.memoryUsedBytes).toBeGreaterThan(0)
  })

  it('enforces configurable memory limit', async () => {
    const code = `
def handler():
    # Try to allocate 100MB
    data = "x" * (100 * 1024 * 1024)
    return len(data)
`
    const result = await executePyodide(pyodide, code, 'handler', [], {
      memoryLimitMB: 50, // Only allow 50MB
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/memory|limit|exceeded/i)
  })

  it('handles memory exhaustion gracefully', async () => {
    const code = `
def handler():
    # Try to create infinite list
    data = []
    while True:
        data.extend([0] * 1000000)
    return len(data)
`
    const result = await executePyodide(pyodide, code, 'handler', [], {
      memoryLimitMB: 64,
      timeoutMs: 5000,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/memory|timeout|limit/i)
  })

  it('cleans up memory after execution', async () => {
    const code = `
def handler():
    # Create and return small result
    data = list(range(1000))
    return sum(data)
`
    // Execute multiple times
    for (let i = 0; i < 10; i++) {
      const result = await executePyodide(pyodide, code, 'handler', [])
      expect(result.success).toBe(true)
    }

    // Memory should not grow significantly
    const finalResult = await executePyodide(pyodide, code, 'handler', [])
    expect(finalResult.memoryUsedBytes).toBeLessThan(50 * 1024 * 1024) // Less than 50MB
  })

  it('reports peak memory usage', async () => {
    const code = `
def handler():
    # Allocate then release
    temp = [i for i in range(100000)]
    result = sum(temp)
    del temp
    return result
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    expect(result.peakMemoryBytes).toBeDefined()
    expect(result.peakMemoryBytes).toBeGreaterThanOrEqual(result.memoryUsedBytes || 0)
  })

  it('allows configuring initial memory', async () => {
    const code = `
def handler():
    return "memory test"
`
    const result = await executePyodide(pyodide, code, 'handler', [], {
      initialMemoryMB: 32,
    })

    expect(result.success).toBe(true)
    expect(result.value).toBe('memory test')
  })
})

// ============================================================================
// E2E Test: Exception Handling
// ============================================================================

describe('E2E: Exception Handling', () => {
  it('catches and reports ValueError', async () => {
    const code = `
def handler():
    raise ValueError("invalid value")
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toContain('ValueError')
    expect(result.error).toContain('invalid value')
    expect(result.errorType).toBe('ValueError')
  })

  it('catches and reports TypeError', async () => {
    const code = `
def handler():
    return "hello" + 42
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toContain('TypeError')
    expect(result.errorType).toBe('TypeError')
  })

  it('catches and reports KeyError', async () => {
    const code = `
def handler():
    d = {"a": 1}
    return d["nonexistent"]
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toContain('KeyError')
    expect(result.errorType).toBe('KeyError')
  })

  it('catches and reports IndexError', async () => {
    const code = `
def handler():
    lst = [1, 2, 3]
    return lst[10]
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toContain('IndexError')
    expect(result.errorType).toBe('IndexError')
  })

  it('catches and reports ZeroDivisionError', async () => {
    const code = `
def handler():
    return 1 / 0
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toContain('ZeroDivisionError')
    expect(result.errorType).toBe('ZeroDivisionError')
  })

  it('catches and reports AttributeError', async () => {
    const code = `
def handler():
    x = None
    return x.nonexistent_method()
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toContain('AttributeError')
    expect(result.errorType).toBe('AttributeError')
  })

  it('catches and reports ImportError', async () => {
    const code = `
from nonexistent_module import something

def handler():
    return "should not reach here"
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/ModuleNotFoundError|ImportError/)
  })

  it('catches custom exceptions', async () => {
    const code = `
class CustomError(Exception):
    pass

def handler():
    raise CustomError("custom error message")
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toContain('CustomError')
    expect(result.error).toContain('custom error message')
  })

  it('includes stack trace in error', async () => {
    const code = `
def inner():
    raise ValueError("inner error")

def middle():
    inner()

def handler():
    middle()
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.stackTrace).toBeDefined()
    expect(result.stackTrace).toContain('inner')
    expect(result.stackTrace).toContain('middle')
    expect(result.stackTrace).toContain('handler')
  })

  it('handles exception chaining', async () => {
    const code = `
def handler():
    try:
        raise ValueError("original")
    except ValueError as e:
        raise RuntimeError("wrapped") from e
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toContain('RuntimeError')
    expect(result.error).toContain('wrapped')
    // Should reference original cause
    expect(result.stackTrace).toMatch(/ValueError|original/i)
  })

  it('handles exception in exception handler', async () => {
    const code = `
def handler():
    try:
        raise ValueError("first")
    except:
        raise TypeError("second")
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toContain('TypeError')
    expect(result.error).toContain('second')
  })

  it('handles RecursionError', async () => {
    const code = `
def handler():
    return handler()  # Infinite recursion
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toContain('RecursionError')
  })
})

// ============================================================================
// E2E Test: Support Multiple Handler Functions
// ============================================================================

describe('E2E: Support Multiple Handler Functions', () => {
  it('calls specified handler by name', async () => {
    const code = `
def handler_a():
    return "handler A"

def handler_b():
    return "handler B"

def handler_c():
    return "handler C"
`
    const resultA = await executePyodide(pyodide, code, 'handler_a', [])
    expect(resultA.success).toBe(true)
    expect(resultA.value).toBe('handler A')

    const resultB = await executePyodide(pyodide, code, 'handler_b', [])
    expect(resultB.success).toBe(true)
    expect(resultB.value).toBe('handler B')

    const resultC = await executePyodide(pyodide, code, 'handler_c', [])
    expect(resultC.success).toBe(true)
    expect(resultC.value).toBe('handler C')
  })

  it('allows handlers to call each other', async () => {
    const code = `
def helper(x):
    return x * 2

def handler(x):
    return helper(x) + 1
`
    const result = await executePyodide(pyodide, code, 'handler', [5])

    expect(result.success).toBe(true)
    expect(result.value).toBe(11) // (5 * 2) + 1
  })

  it('supports class-based handlers', async () => {
    const code = `
class Calculator:
    def __init__(self, initial=0):
        self.value = initial

    def add(self, x):
        self.value += x
        return self.value

    def multiply(self, x):
        self.value *= x
        return self.value

calc = Calculator(10)

def add_handler(x):
    return calc.add(x)

def multiply_handler(x):
    return calc.multiply(x)
`
    const result1 = await executePyodide(pyodide, code, 'add_handler', [5])
    expect(result1.success).toBe(true)
    expect(result1.value).toBe(15) // 10 + 5

    // Note: State may or may not persist between calls depending on implementation
    const result2 = await executePyodide(pyodide, code, 'multiply_handler', [2])
    expect(result2.success).toBe(true)
  })

  it('supports decorated handlers', async () => {
    const code = `
def log_calls(func):
    def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        return {"result": result, "logged": True}
    return wrapper

@log_calls
def handler(x):
    return x * 2
`
    const result = await executePyodide(pyodide, code, 'handler', [21])

    expect(result.success).toBe(true)
    expect(result.value).toEqual({ result: 42, logged: true })
  })

  it('lists available handlers', async () => {
    const code = `
def handler_one():
    return 1

def handler_two():
    return 2

def _private_function():
    return "private"

class MyClass:
    pass
`
    const result = await executePyodide(pyodide, code, '__list_handlers__', [])

    expect(result.success).toBe(true)
    expect(result.handlers).toBeDefined()
    expect(result.handlers).toContain('handler_one')
    expect(result.handlers).toContain('handler_two')
    // Should not include private functions
    expect(result.handlers).not.toContain('_private_function')
    // Should not include classes
    expect(result.handlers).not.toContain('MyClass')
  })

  it('handles handler with keyword arguments', async () => {
    const code = `
def handler(*, name, greeting="Hello"):
    return f"{greeting}, {name}!"
`
    const result = await executePyodide(pyodide, code, 'handler', [], {
      kwargs: { name: 'World', greeting: 'Hi' },
    })

    expect(result.success).toBe(true)
    expect(result.value).toBe('Hi, World!')
  })

  it('handles handler with *args and **kwargs', async () => {
    const code = `
def handler(*args, **kwargs):
    return {
        "args": list(args),
        "kwargs": dict(kwargs)
    }
`
    const result = await executePyodide(pyodide, code, 'handler', [1, 2, 3], {
      kwargs: { x: 'a', y: 'b' },
    })

    expect(result.success).toBe(true)
    expect(result.value).toEqual({
      args: [1, 2, 3],
      kwargs: { x: 'a', y: 'b' },
    })
  })

  it('validates handler exists before execution', async () => {
    const code = `
def existing_handler():
    return "exists"
`
    const result = await executePyodide(pyodide, code, 'nonexistent_handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/handler.*not found|not defined/i)
  })

  it('validates handler is callable', async () => {
    const code = `
handler = "not a function"
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not callable|not a function/i)
  })
})

// ============================================================================
// Additional E2E Tests: Performance and Edge Cases
// ============================================================================

describe('E2E: Performance and Edge Cases', () => {
  it('completes within timeout', async () => {
    const code = `
def handler():
    total = 0
    for i in range(100000):
        total += i
    return total
`
    const startTime = Date.now()
    const result = await executePyodide(pyodide, code, 'handler', [], {
      timeoutMs: 10000,
    })
    const elapsed = Date.now() - startTime

    expect(result.success).toBe(true)
    expect(elapsed).toBeLessThan(10000)
    expect(result.executionTimeMs).toBeDefined()
    expect(result.executionTimeMs).toBeLessThan(10000)
  })

  it('times out for long-running code', async () => {
    const code = `
import time

def handler():
    time.sleep(10)  # Sleep for 10 seconds
    return "done"
`
    const result = await executePyodide(pyodide, code, 'handler', [], {
      timeoutMs: 100, // 100ms timeout
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/timeout|timed out/i)
    expect(result.timedOut).toBe(true)
  })

  it('times out for infinite loops', async () => {
    const code = `
def handler():
    while True:
        pass
`
    const result = await executePyodide(pyodide, code, 'handler', [], {
      timeoutMs: 500,
    })

    expect(result.success).toBe(false)
    expect(result.timedOut).toBe(true)
  })

  it('handles Unicode strings correctly', async () => {
    const code = `
def handler(text):
    return f"Received: {text}"
`
    const result = await executePyodide(pyodide, code, 'handler', ['Hello, World! Emoji: test'])

    expect(result.success).toBe(true)
    expect(result.value).toBe('Received: Hello, World! Emoji: test')
  })

  it('handles binary data', async () => {
    const code = `
import base64

def handler(b64_data):
    decoded = base64.b64decode(b64_data)
    return base64.b64encode(decoded).decode()
`
    const testData = 'SGVsbG8gV29ybGQ=' // "Hello World" in base64
    const result = await executePyodide(pyodide, code, 'handler', [testData])

    expect(result.success).toBe(true)
    expect(result.value).toBe(testData)
  })

  it('handles deeply nested data structures', async () => {
    const code = `
def handler(data):
    return data
`
    const deepData = {
      level1: {
        level2: {
          level3: {
            level4: {
              value: 'deep',
            },
          },
        },
      },
    }
    const result = await executePyodide(pyodide, code, 'handler', [deepData])

    expect(result.success).toBe(true)
    expect(result.value).toEqual(deepData)
  })

  it('handles large arrays efficiently', async () => {
    const code = `
def handler(arr):
    return sum(arr)
`
    const largeArray = Array.from({ length: 10000 }, (_, i) => i)
    const result = await executePyodide(pyodide, code, 'handler', [largeArray])

    expect(result.success).toBe(true)
    expect(result.value).toBe(49995000) // sum of 0 to 9999
  })

  it('isolates execution between calls', async () => {
    // First call sets a global
    const code1 = `
global_var = "set by first call"

def handler():
    return global_var
`
    await executePyodide(pyodide, code1, 'handler', [])

    // Second call should not see the global from first call (if isolated)
    const code2 = `
def handler():
    return global_var if 'global_var' in dir() else "not found"
`
    const result = await executePyodide(pyodide, code2, 'handler', [], {
      isolate: true,
    })

    expect(result.success).toBe(true)
    expect(result.value).toBe('not found')
  })

  it('provides execution metrics', async () => {
    const code = `
def handler():
    return sum(range(10000))
`
    const result = await executePyodide(pyodide, code, 'handler', [])

    expect(result.success).toBe(true)
    expect(result.metrics).toBeDefined()
    expect(result.metrics?.parseTimeMs).toBeDefined()
    expect(result.metrics?.executeTimeMs).toBeDefined()
    expect(result.metrics?.totalTimeMs).toBeDefined()
  })
})
