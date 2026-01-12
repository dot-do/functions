/**
 * Python String Escaping Tests (RED PHASE)
 *
 * These tests verify that the escapeForPython function properly escapes
 * strings for safe use in Python triple-quoted strings, preventing code
 * injection attacks.
 *
 * CURRENT IMPLEMENTATION (invoke.ts lines 219-224):
 * ```typescript
 * function escapeForPython(str: string): string {
 *   return str
 *     .replace(/\\/g, '\\\\')
 *     .replace(/'''/g, "\\'\\'\\'")
 * }
 * ```
 *
 * KNOWN VULNERABILITIES in current implementation:
 * 1. Does NOT escape triple double quotes (""") which are also Python string delimiters
 * 2. Does NOT escape newlines that could break out of string context
 * 3. Does NOT escape carriage returns
 * 4. Does NOT escape null bytes
 * 5. Does NOT handle backslash followed by triple quotes correctly
 *    (e.g., \''' becomes \\\'\'\'  but the escaped form might still break parsing)
 * 6. Does NOT validate or escape handler names (separate concern)
 *
 * Ticket: functions-1uk
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the current escapeForPython implementation is incomplete.
 */

import { describe, it, expect } from 'vitest'
import { invokePython } from '../invoke'

describe('escapeForPython - Code Injection Prevention', () => {
  /**
   * Triple Quote Escaping Tests
   *
   * The wrapper code uses triple single quotes (''') for the exec() call:
   *   exec('''${escapeForPython(code)}''')
   *
   * If user code contains triple quotes, they must be escaped to prevent
   * breaking out of the string context.
   */
  describe('Triple Quote Escaping', () => {
    it('should escape triple single quotes in function return value', async () => {
      // User code returns a string containing '''
      // Current impl escapes ''' to \'\'\' which should work
      const code = `
def handler():
    # Return a string that contains triple single quotes
    return "Delimiter: '''"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe("Delimiter: '''")
    })

    it('should handle triple single quotes at the START of code', async () => {
      // Triple quotes at the very beginning could immediately close the exec string
      // This is a TRICKY edge case - the code starts with '''
      const code = `'''This is a docstring'''
def handler():
    return "after docstring"
`
      // If escaping fails, this will cause a Python syntax error or injection
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('after docstring')
    })

    it('should handle multiple triple quote sequences in code', async () => {
      // Multiple ''' sequences that could confuse the escaper
      const code = `
def handler():
    a = "first '''"
    b = "second '''"
    c = "third '''"
    return a + " | " + b + " | " + c
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe("first ''' | second ''' | third '''")
    })

    it('should handle code injection attempt via triple quotes', async () => {
      // INJECTION ATTEMPT: User tries to break out of the exec() string
      // The malicious code: ''' + evil_code + '''
      // If not escaped, the wrapper becomes:
      //   exec(''' [code] ''' + evil_code + ''' [more] ''')
      // Which would execute evil_code
      const maliciousCode = `
def handler():
    return "safe"
''' + str(__import__('os').getcwd()) + '''
`
      // This should NOT execute the os.getcwd() call
      // Either it should return "safe" or throw a syntax error
      // The key is that it should NOT leak directory information
      const result = await invokePython(maliciousCode, 'handler', [])
      expect(result).toBe('safe')
    })

    it('should handle adjacent triple quotes patterns', async () => {
      // Edge case: '''''' (6 single quotes) = two empty triple-quoted strings
      // But if partially escaped, could become invalid
      const code = `
def handler():
    # Six quotes in a row
    return "''''''"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe("''''''")
    })
  })

  /**
   * Backslash Escaping Tests
   *
   * Backslashes are escape characters in Python. If not properly escaped,
   * they can escape the closing quotes of the string.
   */
  describe('Backslash Escaping', () => {
    it('should handle trailing backslash in code', async () => {
      // CRITICAL: A trailing backslash could escape the closing '''
      // If code ends with \, and we wrap as '''code\''', the \ escapes one quote
      // Making it: '''code\'''' which is malformed
      const code = `
def handler():
    # Return a string ending with a backslash
    return "path\\\\"`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('path\\')
    })

    it('should handle backslash before triple quotes', async () => {
      // Pattern: \''' could be interpreted as \' '' (escaped quote + two quotes)
      // or as \''' (backslash + triple quote)
      // After escaping \\ and ''', we get: \\\'\'\'
      // In Python triple-quoted string, this should be: \'''
      const code = `
def handler():
    return "slash then quotes: \\\\'''"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe("slash then quotes: \\'''")
    })

    it('should handle multiple consecutive backslashes', async () => {
      // Even number of backslashes = each pair makes a literal backslash
      // Odd number = last one escapes next char
      const code = `
def handler():
    return "two: \\\\\\\\ three: \\\\\\\\\\\\ four: \\\\\\\\\\\\\\\\"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('two: \\\\ three: \\\\\\ four: \\\\\\\\')
    })

    it('should handle backslash-quote combinations for injection', async () => {
      // INJECTION ATTEMPT: Using \' to escape quote then using ''' to close
      // Pattern: \'''' = escaped quote + ''' (triple quote)
      // If escaping is wrong, this could break out
      const code = `
def handler():
    return "escaped quote: \\\\'then triple: '''"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe("escaped quote: \\'then triple: '''")
    })

    it('should handle only backslashes as content', async () => {
      const code = `
def handler():
    return "\\\\\\\\\\\\\\\\"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('\\\\\\\\')
    })
  })

  /**
   * Newline and Control Character Tests
   *
   * Raw newlines in the code are valid Python but could be used for injection.
   * Control characters might bypass escaping logic.
   */
  describe('Newline and Control Character Handling', () => {
    it('should handle literal newlines in code', async () => {
      // Literal newlines are fine in triple-quoted strings
      // But we need to ensure they don't enable injection
      const code = `
def handler():
    multiline = """Line 1
Line 2
Line 3"""
    return multiline
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('Line 1\nLine 2\nLine 3')
    })

    it('should handle carriage return injection', async () => {
      // \r could be used to overwrite parts of the line in some terminals
      // It shouldn't affect Python parsing, but let's verify
      const code = `
def handler():
    return "before\\rafter"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('before\rafter')
    })

    it('should handle tab characters', async () => {
      const code = `
def handler():
    return "col1\\tcol2\\tcol3"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('col1\tcol2\tcol3')
    })

    it('should handle null byte in code', async () => {
      // NULL bytes (\x00) could potentially truncate strings in some implementations
      // This tests that the escape function doesn't break on null bytes
      const code = `
def handler():
    return "before" + chr(0) + "after"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('before\x00after')
    })

    it('should handle form feed and vertical tab', async () => {
      const code = `
def handler():
    return "ff\\fvt\\v"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('ff\fvt\v')
    })

    it('should handle bell character', async () => {
      const code = `
def handler():
    return "bell\\a"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('bell\x07')
    })
  })

  /**
   * Unicode Character Tests
   *
   * Unicode characters should be passed through correctly.
   * Some unicode characters might be used in injection attempts.
   */
  describe('Unicode Character Handling', () => {
    it('should handle basic unicode characters', async () => {
      const code = `
def handler():
    return "Hello, World!"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('Hello, World!')
    })

    it('should handle unicode escape sequences', async () => {
      const code = `
def handler():
    return "\\u0048\\u0065\\u006c\\u006c\\u006f"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('Hello')
    })

    it('should handle unicode quotes (smart quotes)', async () => {
      // Smart quotes: \u2018 and \u2019 (single), \u201C and \u201D (double)
      const code = `
def handler():
    return "Smart quotes: \\u2018\\u2019 \\u201C\\u201D"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe("Smart quotes: \u2018\u2019 \u201C\u201D")
    })

    it('should handle unicode modifier letter prime characters', async () => {
      // U+02B9 MODIFIER LETTER PRIME - looks like a single quote
      // U+02BC MODIFIER LETTER APOSTROPHE - also looks like a quote
      // These could potentially confuse escaping if treated like quotes
      // Current implementation may not handle these unicode chars in code strings
      const code = `
def handler():
    # Using chr() to generate the characters safely
    prime = chr(0x02B9)  # MODIFIER LETTER PRIME
    apostrophe = chr(0x02BC)  # MODIFIER LETTER APOSTROPHE
    return prime + prime + apostrophe + apostrophe
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('\u02b9\u02b9\u02bc\u02bc')
    })

    it('should handle high unicode code points via chr()', async () => {
      // Test emoji handling using chr() to avoid escape sequence issues
      const code = `
def handler():
    return "Emoji: " + chr(0x1F600)
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('Emoji: \u{1F600}')
    })

    it('should handle literal unicode emoji in code', async () => {
      // FAILING TEST: Direct emoji characters in code string
      // This tests if escapeForPython properly handles 4-byte unicode
      const code = `
def handler():
    return "Emoji: \u{1F600}"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('Emoji: \u{1F600}')
    })

    it('should handle RTL and LTR override characters', async () => {
      // RTL/LTR overrides could visually hide injection attempts
      const code = `
def handler():
    return "LTR:\\u202A RTL:\\u202B POP:\\u202C"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('LTR:\u202A RTL:\u202B POP:\u202C')
    })

    it('should handle zero-width characters', async () => {
      // Zero-width joiner (U+200D), zero-width non-joiner (U+200C), zero-width space (U+200B)
      // Could potentially be used to hide injection attempts
      const code = `
def handler():
    return "ZWJ:\\u200D ZWNJ:\\u200C ZWS:\\u200B"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('ZWJ:\u200D ZWNJ:\u200C ZWS:\u200B')
    })
  })

  /**
   * Advanced Injection Attempt Tests
   *
   * These test sophisticated injection techniques that might bypass
   * simple escaping.
   */
  describe('Advanced Injection Prevention', () => {
    it('should prevent exec string breakout with comment', async () => {
      // INJECTION: ''' # comment \n real_code '''
      // This tries to use a comment to hide the closing quote
      const maliciousCode = `
def handler():
    return "safe"
'''  # This should be escaped
__import__('os').system('id')
'''
`
      const result = await invokePython(maliciousCode, 'handler', [])
      expect(result).toBe('safe')
    })

    it('should prevent exec breakout with raw string', async () => {
      // INJECTION: Try to use r prefix to change string handling
      // r''' means raw triple-quoted string where \ is literal
      const maliciousCode = `
def handler():
    return "safe"
r''' + __import__('subprocess').getoutput('whoami') + '''
`
      const result = await invokePython(maliciousCode, 'handler', [])
      expect(result).toBe('safe')
    })

    it('should prevent exec breakout with bytes literal', async () => {
      // INJECTION: b''' is a bytes literal
      const maliciousCode = `
def handler():
    return "safe"
b''' + str(__import__('os').environ) + '''
`
      const result = await invokePython(maliciousCode, 'handler', [])
      expect(result).toBe('safe')
    })

    it('should prevent exec breakout with f-string', async () => {
      // INJECTION: f''' is an f-string with triple quotes
      const maliciousCode = `
def handler():
    return "safe"
f'''{__import__('os').getcwd()}'''
`
      const result = await invokePython(maliciousCode, 'handler', [])
      expect(result).toBe('safe')
    })

    it('should prevent injection via Python 3.8+ walrus operator', async () => {
      // Using := in a way that might bypass escaping
      const maliciousCode = `
def handler():
    return "safe"
''' if (x := __import__('os')) else '''
`
      const result = await invokePython(maliciousCode, 'handler', [])
      expect(result).toBe('safe')
    })

    it('should prevent injection via continuation lines', async () => {
      // Python allows \ at end of line to continue statements
      const maliciousCode = `def handler():\\
    return "safe"
'''
evil = __import__('os')
'''
`
      const result = await invokePython(maliciousCode, 'handler', [])
      expect(result).toBe('safe')
    })

    it('should prevent triple double quote injection', async () => {
      // CRITICAL: The current implementation only escapes '''  not """
      // But Python also uses """ for triple-quoted strings
      // If the exec wrapper used """ instead, or if there's a way to switch...
      // This tests that """ doesn't cause issues in ''' context
      const code = `
def handler():
    docstring = """This is a
    multiline docstring"""
    return "has docstring"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('has docstring')
    })

    it('should handle mixed triple quote types', async () => {
      // Code with both ''' and """ - testing interaction
      const code = `
def handler():
    single = '''single triple'''
    double = """double triple"""
    return f"single: {single}, double: {double}"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('single: single triple, double: double triple')
    })
  })

  /**
   * Argument Escaping Tests
   *
   * Arguments are also wrapped in triple quotes when passed to Python.
   * They go through escapeForPython via JSON serialization.
   */
  describe('Argument Escaping', () => {
    it('should escape triple quotes in string arguments', async () => {
      const code = `
def handler(text):
    return text
`
      const maliciousArg = "break''' + str(__import__('sys').version) + '''out"
      const result = await invokePython(code, 'handler', [maliciousArg])
      expect(result).toBe("break''' + str(__import__('sys').version) + '''out")
    })

    it('should escape backslashes in string arguments', async () => {
      const code = `
def handler(path):
    return path
`
      const result = await invokePython(code, 'handler', ['C:\\Users\\Admin\\Documents'])
      expect(result).toBe('C:\\Users\\Admin\\Documents')
    })

    it('should handle arguments with trailing backslash', async () => {
      const code = `
def handler(path):
    return path
`
      const result = await invokePython(code, 'handler', ['C:\\Users\\'])
      expect(result).toBe('C:\\Users\\')
    })

    it('should handle JSON with special characters in keys', async () => {
      const code = `
def handler(obj):
    return list(obj.keys())[0]
`
      const obj = { "key with '''quotes'''": 'value' }
      const result = await invokePython(code, 'handler', [obj])
      expect(result).toBe("key with '''quotes'''")
    })

    it('should handle JSON with injection in values', async () => {
      const code = `
def handler(obj):
    return obj['payload']
`
      const obj = { payload: "''' + __import__('os').getcwd() + '''" }
      const result = await invokePython(code, 'handler', [obj])
      expect(result).toBe("''' + __import__('os').getcwd() + '''")
    })

    it('should handle array with injection attempts', async () => {
      const code = `
def handler(items):
    return items
`
      const maliciousArray = [
        "normal",
        "''' + 'injected' + '''",
        "\\'''\\'",
        "\n'''",
      ]
      const result = await invokePython(code, 'handler', [maliciousArray])
      expect(result).toEqual(maliciousArray)
    })
  })

  /**
   * Handler Name Validation Tests
   *
   * The handler name is interpolated directly into Python code without escaping.
   * This is a separate vulnerability from escapeForPython but equally critical.
   *
   * These tests document the need for handler name validation.
   */
  describe('Handler Name Injection (separate vulnerability)', () => {
    it('should reject handler names containing single quotes', async () => {
      const code = `
def handler():
    return "safe"
`
      // Handler name with quote: handler' or '1'=='1
      // In the wrapper: if 'handler' or '1'=='1'' not in dir():
      // This would bypass the handler existence check
      await expect(
        invokePython(code, "handler' or '1'=='1", [])
      ).rejects.toThrow()
    })

    it('should reject handler names containing newlines', async () => {
      const code = `
def handler():
    return "safe"
`
      // Handler name with newline could execute arbitrary code
      // if 'handler
      // __import__("os").system("id")
      // ' not in dir():
      await expect(
        invokePython(code, "handler\n__import__('os').system('id')\n#", [])
      ).rejects.toThrow()
    })

    it('should reject handler names containing backslashes', async () => {
      const code = `
def handler():
    return "safe"
`
      await expect(
        invokePython(code, "handler\\", [])
      ).rejects.toThrow()
    })

    it('should reject handler names with only valid Python identifier characters', async () => {
      // Handler names should match Python identifier rules: [a-zA-Z_][a-zA-Z0-9_]*
      const code = `
def valid_handler_123():
    return "safe"
`
      const result = await invokePython(code, 'valid_handler_123', [])
      expect(result).toBe('safe')
    })

    it('should reject handler names starting with numbers', async () => {
      const code = `
def handler():
    return "safe"
`
      // Python identifiers cannot start with a number
      await expect(
        invokePython(code, '123handler', [])
      ).rejects.toThrow()
    })

    it('should reject handler names with spaces', async () => {
      const code = `
def handler():
    return "safe"
`
      await expect(
        invokePython(code, 'handler name', [])
      ).rejects.toThrow()
    })

    it('should reject handler names with semicolons', async () => {
      const code = `
def handler():
    return "safe"
`
      // Semicolon could separate statements
      // eval('handler; __import__("os").system("id")')
      await expect(
        invokePython(code, 'handler; evil()', [])
      ).rejects.toThrow()
    })
  })

  /**
   * Edge Cases and Stress Tests
   */
  describe('Edge Cases', () => {
    it('should handle empty code', async () => {
      // Empty code string - handler won't be found
      await expect(
        invokePython('', 'handler', [])
      ).rejects.toThrow()
    })

    it('should handle code with only whitespace', async () => {
      await expect(
        invokePython('   \n\t\n   ', 'handler', [])
      ).rejects.toThrow()
    })

    it('should handle code with only comments', async () => {
      const code = `# Just a comment
# Another comment
`
      await expect(
        invokePython(code, 'handler', [])
      ).rejects.toThrow()
    })

    it('should handle very long code strings', async () => {
      // Test that escaping doesn't have O(n^2) behavior or memory issues
      const repeatedPattern = "x = '''test'''\n".repeat(1000)
      const code = `
${repeatedPattern}
def handler():
    return "survived ${repeatedPattern.length} chars"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toContain('survived')
    })

    it('should strip or handle BOM (Byte Order Mark) in code', async () => {
      // UTF-8 BOM at start of file - Python 3 doesn't accept this in exec()
      // The escapeForPython function should strip BOM characters
      // FAILING TEST: Current implementation does not strip BOM
      const code = `\uFEFF
def handler():
    return "has BOM"
`
      // This test documents that BOM handling is needed
      // The current implementation fails with:
      // "invalid non-printable character U+FEFF"
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('has BOM')
    })

    it('should handle Python 2 style print', async () => {
      // This should fail as print without parens is Python 2 syntax
      const code = `
def handler():
    print "hello"
    return "done"
`
      await expect(invokePython(code, 'handler', [])).rejects.toThrow()
    })
  })

  /**
   * CRITICAL FAILING TESTS - Known Vulnerabilities
   *
   * These tests are specifically designed to FAIL with the current
   * escapeForPython implementation to demonstrate the RED phase of TDD.
   *
   * The current implementation only does:
   *   .replace(/\\/g, '\\\\')
   *   .replace(/'''/g, "\\'\\'\\'")
   *
   * These tests expose cases where this is insufficient.
   */
  describe('CRITICAL: Known Escape Vulnerabilities (should fail)', () => {
    it('VULN: should properly escape single quote followed by double quotes in sequence', async () => {
      // Pattern: '""' inside a triple-single-quoted string
      // This tests interaction between quote types
      const code = `
def handler():
    # String with single quote then two double quotes
    return "'\\"\\"'"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe("'\"\"'")
    })

    it('VULN: escapeForPython should be exported for direct testing', async () => {
      // This is a design test - the function should be exported
      // Currently it's internal, making unit testing difficult
      // We have to test through invokePython which adds complexity

      // Try to import escapeForPython directly
      // This will fail at compile time if not exported
      const invokeModule = await import('../invoke')
      expect(typeof (invokeModule as unknown as { escapeForPython: unknown }).escapeForPython).toBe('function')
    })

    it('VULN: should escape code containing exec() with triple quotes', async () => {
      // User code that itself uses exec with triple quotes
      // This could interact badly with the wrapper's exec
      // FAILING TEST: exec() creates a new scope, so we need to use globals()
      const code = `
def handler():
    # Nested exec with triple quotes - tricky to escape
    # Using globals() dict to capture the result
    g = {}
    exec("x = 42", g)
    return g['x']
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe(42)
    })

    it('VULN: should handle code with docstrings containing triple quotes', async () => {
      // Docstrings use triple quotes - testing proper escaping
      const code = `
def handler():
    """This function has a docstring.

    It contains multiple lines and uses triple double quotes.
    Let's also add some: '''single triple quotes'''
    And more: """ + "inside" + """
    """
    return "has complex docstring"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('has complex docstring')
    })

    it('VULN: should handle alternating quote patterns', async () => {
      // Alternating between single and double, and triple variants
      const code = `
def handler():
    a = "'"
    b = '"'
    c = "'''"
    d = '"""'
    return a + b + c + d
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe("'\"'''\"\"\"")
    })

    it('VULN: should handle escape sequence followed by quotes', async () => {
      // \n''' - newline followed by triple quote
      // After escaping: \\n\'\'\' but is this correct?
      const code = `
def handler():
    return "before\\n'''"
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe("before\n'''")
    })

    it('VULN: should handle raw string with backslashes correctly', async () => {
      // r"..." strings treat backslashes literally in Python
      // When we write r"path\\to\\file" in JavaScript, the \\ becomes \
      // So Python sees r"path\to\file" which returns "path\to\file"
      // The escapeForPython is doubling the backslashes, but raw strings
      // treat them literally, so we get the wrong result
      //
      // FAILING TEST: The current escapeForPython doubles backslashes
      // which is wrong for raw strings - the result should be 'path\to\file'
      // (single backslashes) but we might get 'path\\to\\file' (doubled)
      const code = `
def handler():
    # Raw string - backslashes are literal
    x = r"path\\to\\file"
    return x
`
      const result = await invokePython(code, 'handler', [])
      // In a raw string, \\ is TWO literal backslashes
      // So the expected result is path\to\file (with literal backslashes)
      expect(result).toBe('path\\to\\file')
    })

    it('VULN: should handle f-string with nested quotes', async () => {
      // f-strings with nested expressions containing quotes
      const code = `
def handler():
    name = "test"
    result = f"Value: {name} with 'single' and \\"double\\""
    return result
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('Value: test with \'single\' and "double"')
    })

    it('VULN: should handle code ending with incomplete escape', async () => {
      // If code ends with a single backslash, it could escape the closing '''
      // Pattern: code\ + closing ''' = code\''' which is malformed
      // The current impl should double the backslash, but edge cases matter
      const codeEndingWithBackslash = `def handler():
    return "ends with slash\\\\"
# This comment has a trailing backslash \\`
      const result = await invokePython(codeEndingWithBackslash, 'handler', [])
      expect(result).toBe('ends with slash\\')
    })

    it('VULN: should handle triple quote at exact string boundary', async () => {
      // Carefully positioned ''' at string literal boundaries
      const code = `def handler():
    x = "'''"
    y = '''hello'''
    return x + y`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe("'''hello")
    })

    it('VULN: arguments containing JSON with nested quotes should be safe', async () => {
      // Complex JSON structure with quotes in string values
      const code = `
def handler(data):
    return data['query']
`
      const complexArg = {
        query: "SELECT * FROM users WHERE name = 'O''Brien' AND status = \"active\"",
        note: "Contains both ' and \" and even '''triple'''"
      }
      const result = await invokePython(code, 'handler', [complexArg])
      expect(result).toBe("SELECT * FROM users WHERE name = 'O''Brien' AND status = \"active\"")
    })

    it('VULN: should handle Python bytes with escape sequences', async () => {
      // b'' strings can have different escape handling
      const code = `
def handler():
    data = b'\\x00\\x01\\x02'
    return list(data)
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toEqual([0, 1, 2])
    })

    it('VULN: should handle class with docstrings and methods', async () => {
      // More complex code structure with multiple nested quote contexts
      const code = `
class Helper:
    """A helper class with a docstring containing '''quotes'''."""

    def method(self):
        """Method docstring with \\"escaped\\" quotes."""
        return "from method"

def handler():
    h = Helper()
    return h.method()
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('from method')
    })

    it('VULN: should handle lambda with quotes', async () => {
      const code = `
def handler():
    # Lambda that returns a quoted string
    f = lambda: "lambda'result"
    return f()
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe("lambda'result")
    })

    it('VULN: should handle dictionary comprehension with quote keys', async () => {
      const code = `
def handler():
    d = {f"key'{i}'": i for i in range(3)}
    return list(d.keys())
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toEqual(["key'0'", "key'1'", "key'2'"])
    })
  })
})
