/**
 * Python Invoke Tests (RED)
 *
 * These tests validate Python function invocation with arguments.
 * The invokePython function is responsible for:
 * 1. Executing Python code with a specified handler function
 * 2. Passing arguments correctly from JavaScript to Python
 * 3. Returning results correctly from Python to JavaScript
 * 4. Handling various data types across the language boundary
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the implementation (invokePython) does not exist yet.
 *
 * SKIPPED: Requires node:child_process which is unavailable in Workers runtime
 */

import { describe, it, expect } from 'vitest'

// Lazy import to avoid module resolution failure in Workers pool
let invokePython: any
let PythonTimeoutError: any
let DEFAULT_PYTHON_TIMEOUT_MS: any

// node:child_process is not available in the Cloudflare Workers runtime (miniflare)
describe.skip('Python Invoker', () => {
  describe('Basic Function Invocation', () => {
    it('invokes Python function with arguments', async () => {
      const code = `
def handler(name):
    return f"Hello, {name}!"
`
      const result = await invokePython(code, 'handler', ['World'])
      expect(result).toBe('Hello, World!')
    })

    it('invokes Python function with no arguments', async () => {
      const code = `
def handler():
    return "No args needed"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('No args needed')
    })

    it('invokes Python function with multiple arguments', async () => {
      const code = `
def handler(a, b, c):
    return a + b + c
`
      const result = await invokePython(code, 'handler', [1, 2, 3])
      expect(result).toBe(6)
    })
  })

  describe('Object Arguments', () => {
    it('handles object arguments', async () => {
      const code = `
def handler(data):
    return data['x'] + data['y']
`
      const result = await invokePython(code, 'handler', [{ x: 1, y: 2 }])
      expect(result).toBe(3)
    })

    it('handles nested object arguments', async () => {
      const code = `
def handler(data):
    return data['user']['name'] + " is " + str(data['user']['age'])
`
      const result = await invokePython(code, 'handler', [{ user: { name: 'Alice', age: 30 } }])
      expect(result).toBe('Alice is 30')
    })

    it('handles object with array values', async () => {
      const code = `
def handler(data):
    return sum(data['numbers'])
`
      const result = await invokePython(code, 'handler', [{ numbers: [1, 2, 3, 4, 5] }])
      expect(result).toBe(15)
    })
  })

  describe('Array Arguments', () => {
    it('handles array arguments', async () => {
      const code = `
def handler(items):
    return [x * 2 for x in items]
`
      const result = await invokePython(code, 'handler', [[1, 2, 3]])
      expect(result).toEqual([2, 4, 6])
    })

    it('handles array of objects', async () => {
      const code = `
def handler(users):
    return [user['name'] for user in users]
`
      const result = await invokePython(code, 'handler', [[{ name: 'Alice' }, { name: 'Bob' }]])
      expect(result).toEqual(['Alice', 'Bob'])
    })
  })

  describe('Data Type Handling', () => {
    it('handles string type', async () => {
      const code = `
def handler(text):
    return text.upper()
`
      const result = await invokePython(code, 'handler', ['hello'])
      expect(result).toBe('HELLO')
    })

    it('handles integer type', async () => {
      const code = `
def handler(num):
    return num * num
`
      const result = await invokePython(code, 'handler', [7])
      expect(result).toBe(49)
    })

    it('handles float type', async () => {
      const code = `
def handler(value):
    return round(value * 2, 2)
`
      const result = await invokePython(code, 'handler', [3.14])
      expect(result).toBeCloseTo(6.28, 2)
    })

    it('handles boolean type', async () => {
      const code = `
def handler(flag):
    return not flag
`
      const result = await invokePython(code, 'handler', [true])
      expect(result).toBe(false)
    })

    it('handles null/None type', async () => {
      const code = `
def handler(value):
    return value is None
`
      const result = await invokePython(code, 'handler', [null])
      expect(result).toBe(true)
    })

    it('handles unicode strings', async () => {
      const code = `
def handler(text):
    return f"Received: {text}"
`
      const result = await invokePython(code, 'handler', ['Hello, World!'])
      expect(result).toBe('Received: Hello, World!')
    })
  })

  describe('Return Types', () => {
    it('returns string from Python', async () => {
      const code = `
def handler():
    return "hello world"
`
      const result = await invokePython(code, 'handler', [])
      expect(typeof result).toBe('string')
      expect(result).toBe('hello world')
    })

    it('returns number from Python', async () => {
      const code = `
def handler():
    return 42
`
      const result = await invokePython(code, 'handler', [])
      expect(typeof result).toBe('number')
      expect(result).toBe(42)
    })

    it('returns object from Python', async () => {
      const code = `
def handler():
    return {"name": "test", "value": 123}
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toEqual({ name: 'test', value: 123 })
    })

    it('returns array from Python', async () => {
      const code = `
def handler():
    return [1, 2, 3]
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toEqual([1, 2, 3])
    })

    it('returns null for None', async () => {
      const code = `
def handler():
    return None
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBeNull()
    })
  })

  describe('Error Handling', () => {
    it('handles errors', async () => {
      const code = `
def handler():
    raise ValueError("test error")
`
      await expect(invokePython(code, 'handler', [])).rejects.toThrow('test error')
    })

    it('handles syntax errors', async () => {
      const code = `
def handler():
    return "missing quote
`
      await expect(invokePython(code, 'handler', [])).rejects.toThrow()
    })

    it('handles runtime errors', async () => {
      const code = `
def handler():
    return 1 / 0
`
      await expect(invokePython(code, 'handler', [])).rejects.toThrow()
    })

    it('handles undefined variable errors', async () => {
      const code = `
def handler():
    return undefined_variable
`
      await expect(invokePython(code, 'handler', [])).rejects.toThrow()
    })

    it('handles missing handler function', async () => {
      const code = `
def other_function():
    return "not the handler"
`
      await expect(invokePython(code, 'handler', [])).rejects.toThrow()
    })
  })

  describe('Python Standard Library', () => {
    it('supports json module', async () => {
      const code = `
import json

def handler(data):
    return json.dumps(data, sort_keys=True)
`
      const result = await invokePython(code, 'handler', [{ b: 2, a: 1 }])
      expect(result).toBe('{"a": 1, "b": 2}')
    })

    it('supports math module', async () => {
      const code = `
import math

def handler(value):
    return math.sqrt(value)
`
      const result = await invokePython(code, 'handler', [16])
      expect(result).toBe(4)
    })

    it('supports re module', async () => {
      const code = `
import re

def handler(text):
    return re.findall(r'\\d+', text)
`
      const result = await invokePython(code, 'handler', ['abc123def456'])
      expect(result).toEqual(['123', '456'])
    })
  })

  describe('Custom Handler Names', () => {
    it('invokes custom named handler', async () => {
      const code = `
def my_custom_handler(x):
    return x * 2
`
      const result = await invokePython(code, 'my_custom_handler', [21])
      expect(result).toBe(42)
    })

    it('invokes handler from multiple functions', async () => {
      const code = `
def helper(x):
    return x + 1

def process(x):
    return helper(x) * 2
`
      const result = await invokePython(code, 'process', [5])
      expect(result).toBe(12)
    })
  })

  describe('Timeout Handling', () => {
    it('has a default timeout of 30 seconds', () => {
      expect(DEFAULT_PYTHON_TIMEOUT_MS).toBe(30_000)
    })

    it('times out for long-running Python code', async () => {
      const code = `
import time

def handler():
    time.sleep(10)  # Sleep for 10 seconds
    return "done"
`
      // Use a short timeout (100ms) so the test runs quickly
      await expect(invokePython(code, 'handler', [], { timeoutMs: 100 })).rejects.toThrow(
        PythonTimeoutError
      )
    })

    it('throws PythonTimeoutError with descriptive message', async () => {
      const code = `
import time

def handler():
    time.sleep(10)
    return "done"
`
      try {
        await invokePython(code, 'handler', [], { timeoutMs: 50 })
        expect.fail('Expected timeout error')
      } catch (error) {
        expect(error).toBeInstanceOf(PythonTimeoutError)
        expect((error as PythonTimeoutError).message).toContain('timed out after 50ms')
        expect((error as PythonTimeoutError).name).toBe('PythonTimeoutError')
      }
    })

    it('completes quickly when Python finishes before timeout', async () => {
      const code = `
def handler():
    return "fast"
`
      // Even with a short timeout, fast code should complete
      const result = await invokePython(code, 'handler', [], { timeoutMs: 5000 })
      expect(result).toBe('fast')
    })

    it('allows configuring custom timeout', async () => {
      const code = `
import time

def handler():
    time.sleep(0.2)  # Sleep for 200ms
    return "completed"
`
      // With a 500ms timeout, this should complete
      const result = await invokePython(code, 'handler', [], { timeoutMs: 500 })
      expect(result).toBe('completed')
    })

    it('times out infinite loops', async () => {
      const code = `
def handler():
    while True:
        pass  # Infinite loop
`
      await expect(invokePython(code, 'handler', [], { timeoutMs: 100 })).rejects.toThrow(
        PythonTimeoutError
      )
    })
  })

  /**
   * Code Injection Prevention Tests (RED)
   *
   * These tests verify that the escapeForPython function properly prevents
   * code injection attacks. The current implementation has vulnerabilities
   * that these tests should expose.
   *
   * Ticket: functions-1uk
   */
  describe('Code Injection Prevention', () => {
    describe('Triple Quote Escaping', () => {
      it('handles code containing triple single quotes in strings', async () => {
        // Code that legitimately contains triple quotes as a string value
        const code = `
def handler():
    return "This is a docstring delimiter: '''"
`
        const result = await invokePython(code, 'handler', [])
        expect(result).toBe("This is a docstring delimiter: '''")
      })

      it('handles code containing triple double quotes in strings', async () => {
        // Code that legitimately contains triple double quotes
        const code = `
def handler():
    return 'Contains triple double quotes: """'
`
        const result = await invokePython(code, 'handler', [])
        expect(result).toBe('Contains triple double quotes: """')
      })

      it('prevents injection via triple quote escape in code', async () => {
        // Malicious code attempting to break out of the triple-quoted string
        // This attempts: ''' + __import__('os').system('echo INJECTED') + '''
        // If escaping is broken, this would execute system commands
        const maliciousCode = `
def handler():
    return "safe"
''' + __import__('os').system('echo INJECTED') + '''
def evil():
    pass
`
        // This should either throw an error or return "safe"
        // It should NOT execute the system command
        const result = await invokePython(maliciousCode, 'handler', [])
        expect(result).toBe('safe')
      })
    })

    describe('Backslash Escaping', () => {
      it('handles code with backslashes in strings', async () => {
        const code = `
def handler():
    return "path\\\\to\\\\file"
`
        const result = await invokePython(code, 'handler', [])
        expect(result).toBe('path\\to\\file')
      })

      it('handles code with escaped newlines', async () => {
        const code = `
def handler():
    return "line1\\nline2"
`
        const result = await invokePython(code, 'handler', [])
        expect(result).toBe('line1\nline2')
      })

      it('handles code with escaped quotes', async () => {
        const code = `
def handler():
    return "She said \\"hello\\""
`
        const result = await invokePython(code, 'handler', [])
        expect(result).toBe('She said "hello"')
      })

      it('handles code ending with a backslash', async () => {
        // A trailing backslash could escape the closing quotes
        // Code: def handler():\n    return "test\\"
        // If improperly escaped, the \\ at end becomes \ which escapes the closing '''
        const code = `def handler():
    return "ends with backslash: \\\\"`
        const result = await invokePython(code, 'handler', [])
        expect(result).toBe('ends with backslash: \\')
      })

      it('handles code with backslash before triple quotes', async () => {
        // This tests: \''' which when escaped becomes \\\'\'\'
        // In Python, \\ is a literal backslash, and \'\'\' is three escaped quotes
        // The concern is whether this breaks out of the string
        const code = `
def handler():
    return "backslash then quotes: \\\\'''"
`
        const result = await invokePython(code, 'handler', [])
        expect(result).toBe("backslash then quotes: \\'''")
      })
    })

    describe('Newline and Special Character Injection', () => {
      it('handles multiline strings correctly', async () => {
        const code = `
def handler():
    return """This is
a multiline
string"""
`
        const result = await invokePython(code, 'handler', [])
        expect(result).toBe('This is\na multiline\nstring')
      })

      it('handles carriage return and newline', async () => {
        const code = `
def handler():
    return "line1\\r\\nline2"
`
        const result = await invokePython(code, 'handler', [])
        expect(result).toBe('line1\r\nline2')
      })

      it('prevents injection via embedded newlines breaking out of context', async () => {
        // If newlines aren't handled properly, this could break out
        const maliciousCode = "def handler():\n    return 'safe'\n'''\n__import__('os').system('echo PWNED')\n'''"
        const result = await invokePython(maliciousCode, 'handler', [])
        expect(result).toBe('safe')
      })
    })

    describe('Handler Name Injection Prevention', () => {
      it('prevents injection through handler name with single quotes', async () => {
        // The handler name is inserted into: if '${handlerName}' not in dir()
        // A malicious handler name could break out of the string
        const code = `
def handler():
    return "safe"
`
        // This handler name attempts to inject: ' or True or '
        // Which would make: if '' or True or '' not in dir() -> always True
        await expect(
          invokePython(code, "' or True or '", [])
        ).rejects.toThrow()
      })

      it('prevents injection through handler name with code execution', async () => {
        // Handler name attempting to execute code
        const code = `
def handler():
    return "safe"
`
        // This attempts: handler'); __import__('os').system('echo PWNED'); ('
        await expect(
          invokePython(code, "handler'); __import__('os').system('echo PWNED'); ('", [])
        ).rejects.toThrow()
      })

      it('prevents injection through handler name with newlines', async () => {
        // Handler name with embedded newlines
        const code = `
def handler():
    return "safe"
`
        await expect(
          invokePython(code, "handler\n__import__('os').system('echo PWNED')\n#", [])
        ).rejects.toThrow()
      })

      it('rejects handler names with special characters', async () => {
        // Valid Python identifiers should only contain letters, digits, and underscores
        const code = `
def my_handler():
    return "safe"
`
        // These should be rejected as invalid handler names
        await expect(invokePython(code, "my_handler; print('evil')", [])).rejects.toThrow()
        await expect(invokePython(code, "my_handler'", [])).rejects.toThrow()
        await expect(invokePython(code, "my_handler\"", [])).rejects.toThrow()
      })
    })

    describe('Complex Injection Attempts', () => {
      it('prevents injection via string concatenation attack', async () => {
        // Attempt to use Python string concatenation to break out
        const maliciousCode = `
def handler():
    return "safe"
' + '' + "' + __import__('subprocess').check_output(['whoami']).decode() + '" + '' + '
`
        const result = await invokePython(maliciousCode, 'handler', [])
        expect(result).toBe('safe')
      })

      it('prevents injection via format string attack', async () => {
        // Format strings shouldn't be able to inject code
        const code = `
def handler(fmt):
    return f"Value: {fmt}"
`
        // Even if someone passes malicious format string, it should be safe
        const result = await invokePython(code, 'handler', ['{__import__("os").system("echo HACKED")}'])
        expect(result).toBe('Value: {__import__("os").system("echo HACKED")}')
      })

      it('prevents injection via unicode escape sequences', async () => {
        // Unicode escapes that might spell out injection code
        const code = `
def handler():
    return "\\u0027\\u0027\\u0027"
`
        const result = await invokePython(code, 'handler', [])
        // Should return the literal triple single quotes as a string
        expect(result).toBe("'''")
      })

      it('prevents injection via raw string prefix', async () => {
        // Attempt to use raw string to bypass escaping
        const maliciousCode = `
def handler():
    return r"test"
r''' + __import__('os').getcwd() + '''
`
        const result = await invokePython(maliciousCode, 'handler', [])
        expect(result).toBe('test')
      })
    })

    describe('Argument Injection Prevention', () => {
      it('prevents injection through string arguments', async () => {
        const code = `
def handler(name):
    return f"Hello, {name}!"
`
        // Malicious argument trying to inject code
        const maliciousArg = "''' + __import__('os').system('echo INJECTED') + '''"
        const result = await invokePython(code, 'handler', [maliciousArg])
        // Should treat the entire string as a literal value
        expect(result).toBe(`Hello, ''' + __import__('os').system('echo INJECTED') + '''!`)
      })

      it('prevents injection through object key arguments', async () => {
        const code = `
def handler(data):
    return list(data.keys())[0]
`
        // Object with malicious key
        const maliciousObj = { "''' + __import__('os').getcwd() + '''": 'value' }
        const result = await invokePython(code, 'handler', [maliciousObj])
        expect(result).toBe("''' + __import__('os').getcwd() + '''")
      })

      it('prevents injection through array element arguments', async () => {
        const code = `
def handler(items):
    return items[0]
`
        // Array with malicious element
        const maliciousArray = ["''' + __import__('os').system('rm -rf /') + '''"]
        const result = await invokePython(code, 'handler', [maliciousArray])
        expect(result).toBe("''' + __import__('os').system('rm -rf /') + '''")
      })

      it('prevents injection through deeply nested arguments', async () => {
        const code = `
def handler(data):
    return data['level1']['level2']['value']
`
        const maliciousData = {
          level1: {
            level2: {
              value: "'''; __import__('os').system('echo DEEP_INJECTION'); '''"
            }
          }
        }
        const result = await invokePython(code, 'handler', [maliciousData])
        expect(result).toBe("'''; __import__('os').system('echo DEEP_INJECTION'); '''")
      })
    })

    describe('Edge Cases', () => {
      it('handles empty string safely', async () => {
        const code = `
def handler():
    return ""
`
        const result = await invokePython(code, 'handler', [])
        expect(result).toBe('')
      })

      it('handles string with only quotes', async () => {
        const code = `
def handler():
    return "'\\"\\"\\"'\\"\\"\\"'"
`
        const result = await invokePython(code, 'handler', [])
        expect(result).toBe(`'"""'"""'`)
      })

      it('handles string with mixed escape sequences', async () => {
        const code = `
def handler():
    return "Tab:\\tNewline:\\nQuote:\\'Backslash:\\\\"
`
        const result = await invokePython(code, 'handler', [])
        expect(result).toBe("Tab:\tNewline:\nQuote:'Backslash:\\")
      })

      it('handles null byte injection attempt', async () => {
        // Null bytes could potentially break string handling
        const code = `
def handler(text):
    return text
`
        const maliciousArg = "before\x00after"
        const result = await invokePython(code, 'handler', [maliciousArg])
        expect(result).toBe("before\x00after")
      })

      it('handles very long strings without truncation issues', async () => {
        const code = `
def handler(text):
    return len(text)
`
        // Create a string with many potentially dangerous characters
        const longString = "'''".repeat(1000)
        const result = await invokePython(code, 'handler', [longString])
        expect(result).toBe(3000)
      })

      it('handles strings with all printable special characters', async () => {
        const code = `
def handler(text):
    return text
`
        const specialChars = "!@#$%^&*(){}[]|\\:\";<>?,./~`"
        const result = await invokePython(code, 'handler', [specialChars])
        expect(result).toBe(specialChars)
      })
    })
  })
})
