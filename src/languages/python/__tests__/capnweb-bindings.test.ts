/**
 * Capnweb Bindings Generator Tests
 *
 * Tests for generating TypeScript bindings from Python source code
 * for capnweb-style RPC communication.
 */

import { describe, it, expect } from 'vitest'
import {
  parsePythonSource,
  generateTypeScriptBindings,
  generateRpcWrapper,
  generateCapnwebBindings,
  type PythonFunction,
  type PythonClass,
  type ParsedPythonModule,
} from '../capnweb-bindings'

describe('Capnweb Bindings Generator', () => {
  describe('parsePythonSource', () => {
    describe('Function Parsing', () => {
      it('parses simple function', () => {
        const code = `
def greet(name: str) -> str:
    return f"Hello, {name}!"
`
        const result = parsePythonSource(code)

        expect(result.functions).toHaveLength(1)
        expect(result.functions[0].name).toBe('greet')
        expect(result.functions[0].params).toHaveLength(1)
        expect(result.functions[0].params[0].name).toBe('name')
        expect(result.functions[0].params[0].type.pythonType).toBe('str')
        expect(result.functions[0].returnType.pythonType).toBe('str')
      })

      it('parses async function', () => {
        const code = `
async def fetch_data(url: str) -> dict:
    return {}
`
        const result = parsePythonSource(code)

        expect(result.functions).toHaveLength(1)
        expect(result.functions[0].isAsync).toBe(true)
      })

      it('parses function with multiple parameters', () => {
        const code = `
def calculate(a: int, b: int, operation: str = "add") -> int:
    pass
`
        const result = parsePythonSource(code)

        expect(result.functions[0].params).toHaveLength(3)
        expect(result.functions[0].params[2].type.optional).toBe(true)
      })

      it('parses function with complex types', () => {
        const code = `
def process(data: list[str], config: dict[str, int]) -> Optional[list[int]]:
    pass
`
        const result = parsePythonSource(code)

        expect(result.functions[0].params[0].type.pythonType).toBe('list[str]')
        expect(result.functions[0].params[1].type.pythonType).toBe('dict[str, int]')
        expect(result.functions[0].returnType.pythonType).toBe('Optional[list[int]]')
      })

      it('extracts function docstring', () => {
        const code = `
def example():
    """This is a docstring."""
    pass
`
        const result = parsePythonSource(code)

        expect(result.functions[0].docstring).toBe('This is a docstring.')
      })

      it('ignores private functions', () => {
        const code = `
def public_func():
    pass

def _private_func():
    pass

def __dunder_func__():
    pass
`
        const result = parsePythonSource(code)

        expect(result.functions).toHaveLength(1)
        expect(result.functions[0].name).toBe('public_func')
      })
    })

    describe('Class Parsing', () => {
      it('parses simple class', () => {
        const code = `
class MyService:
    def greet(self, name: str) -> str:
        return f"Hello, {name}!"
`
        const result = parsePythonSource(code)

        expect(result.classes).toHaveLength(1)
        expect(result.classes[0].name).toBe('MyService')
        expect(result.classes[0].methods).toHaveLength(1)
      })

      it('parses class with inheritance', () => {
        const code = `
class MyService(RpcTarget):
    def method(self) -> str:
        pass
`
        const result = parsePythonSource(code)

        expect(result.classes[0].bases).toContain('RpcTarget')
      })

      it('parses class with multiple bases', () => {
        const code = `
class MyService(RpcTarget, Serializable):
    pass
`
        const result = parsePythonSource(code)

        expect(result.classes[0].bases).toHaveLength(2)
        expect(result.classes[0].bases).toContain('RpcTarget')
        expect(result.classes[0].bases).toContain('Serializable')
      })

      it('extracts class docstring', () => {
        const code = `
class MyService:
    """Service for handling requests."""
    pass
`
        const result = parsePythonSource(code)

        expect(result.classes[0].docstring).toBe('Service for handling requests.')
      })

      it('ignores private methods', () => {
        const code = `
class MyService:
    def public_method(self):
        pass

    def _private_method(self):
        pass

    def __init__(self):
        pass
`
        const result = parsePythonSource(code)

        expect(result.classes[0].methods).toHaveLength(1)
        expect(result.classes[0].methods[0].name).toBe('public_method')
      })

      it('parses async methods', () => {
        const code = `
class MyService:
    async def fetch(self, url: str) -> dict:
        pass
`
        const result = parsePythonSource(code)

        expect(result.classes[0].methods[0].isAsync).toBe(true)
      })
    })

    describe('Import Parsing', () => {
      it('extracts imports', () => {
        const code = `
import json
from datetime import datetime
from typing import Optional, List
`
        const result = parsePythonSource(code)

        expect(result.imports).toContain('json')
        expect(result.imports).toContain('datetime')
      })
    })

    describe('Module Docstring', () => {
      it('extracts module docstring', () => {
        const code = `"""
This is the module docstring.
"""

def func():
    pass
`
        const result = parsePythonSource(code)

        expect(result.docstring).toContain('module docstring')
      })
    })
  })

  describe('Type Mapping', () => {
    it('maps basic Python types to TypeScript', () => {
      const code = `
def test_types(
    s: str,
    i: int,
    f: float,
    b: bool,
    data: bytes
) -> None:
    pass
`
      const result = parsePythonSource(code)
      const bindings = generateTypeScriptBindings(result)

      expect(bindings).toContain('s: string')
      expect(bindings).toContain('i: number')
      expect(bindings).toContain('f: number')
      expect(bindings).toContain('b: boolean')
      expect(bindings).toContain('data: Uint8Array')
      expect(bindings).toContain('null')
    })

    it('maps list to array', () => {
      const code = `
def process(items: list[str]) -> list[int]:
    pass
`
      const result = parsePythonSource(code)
      const bindings = generateTypeScriptBindings(result)

      expect(bindings).toContain('items: string[]')
      expect(bindings).toContain('number[]')
    })

    it('maps dict to Record', () => {
      const code = `
def process(data: dict[str, int]) -> dict[str, list[str]]:
    pass
`
      const result = parsePythonSource(code)
      const bindings = generateTypeScriptBindings(result)

      expect(bindings).toContain('Record<string, number>')
      expect(bindings).toContain('Record<string, string[]>')
    })

    it('maps Optional to union with null', () => {
      const code = `
def process(value: Optional[str]) -> Optional[int]:
    pass
`
      const result = parsePythonSource(code)
      const bindings = generateTypeScriptBindings(result)

      expect(bindings).toContain('string | null')
      expect(bindings).toContain('number | null')
    })

    it('maps Union types', () => {
      const code = `
def process(value: Union[str, int, None]) -> Union[bool, float]:
    pass
`
      const result = parsePythonSource(code)
      const bindings = generateTypeScriptBindings(result)

      expect(bindings).toContain('string | number | null')
      expect(bindings).toContain('boolean | number')
    })

    it('maps tuple types', () => {
      const code = `
def process(point: tuple[int, int]) -> tuple[str, int, bool]:
    pass
`
      const result = parsePythonSource(code)
      const bindings = generateTypeScriptBindings(result)

      expect(bindings).toContain('[number, number]')
      expect(bindings).toContain('[string, number, boolean]')
    })

    it('maps Awaitable to Promise', () => {
      const code = `
def process() -> Awaitable[str]:
    pass
`
      const result = parsePythonSource(code)
      const bindings = generateTypeScriptBindings(result)

      expect(bindings).toContain('Promise<string>')
    })
  })

  describe('generateTypeScriptBindings', () => {
    it('generates interface for top-level functions', () => {
      const code = `
def greet(name: str) -> str:
    pass

def calculate(a: int, b: int) -> int:
    pass
`
      const result = parsePythonSource(code)
      const bindings = generateTypeScriptBindings(result)

      expect(bindings).toContain('export interface ModuleFunctions')
      expect(bindings).toContain('greet(name: string): string')
      expect(bindings).toContain('calculate(a: number, b: number): number')
    })

    it('generates interface for RpcTarget classes', () => {
      const code = `
class MyService(RpcTarget):
    def method1(self, x: int) -> str:
        pass

    def method2(self) -> list[int]:
        pass
`
      const result = parsePythonSource(code)
      const bindings = generateTypeScriptBindings(result)

      expect(bindings).toContain('export interface MyService extends RpcTarget')
      expect(bindings).toContain('method1(x: number): string')
      expect(bindings).toContain('method2(): number[]')
    })

    it('generates RPC stub type', () => {
      const code = `
class Service1(RpcTarget):
    def method1(self) -> str:
        pass

class Service2(RpcTarget):
    def method2(self) -> int:
        pass
`
      const result = parsePythonSource(code)
      const bindings = generateTypeScriptBindings(result)

      expect(bindings).toContain('export type PythonRpcStub = Service1 & Service2')
    })

    it('includes header comments', () => {
      const code = `def test(): pass`
      const result = parsePythonSource(code)
      const bindings = generateTypeScriptBindings(result)

      expect(bindings).toContain('Auto-generated TypeScript bindings')
      expect(bindings).toContain('DO NOT EDIT')
    })

    it('imports RpcTarget type', () => {
      const code = `
class MyService(RpcTarget):
    pass
`
      const result = parsePythonSource(code)
      const bindings = generateTypeScriptBindings(result)

      expect(bindings).toContain('import type { RpcTarget }')
    })

    it('includes docstrings as JSDoc comments', () => {
      const code = `
def greet(name: str) -> str:
    """Greet a user by name."""
    pass
`
      const result = parsePythonSource(code)
      const bindings = generateTypeScriptBindings(result)

      expect(bindings).toContain('/**')
      expect(bindings).toContain('Greet a user by name')
      expect(bindings).toContain('*/')
    })

    it('handles optional parameters', () => {
      const code = `
def greet(name: str, greeting: str = "Hello") -> str:
    pass
`
      const result = parsePythonSource(code)
      const bindings = generateTypeScriptBindings(result)

      expect(bindings).toContain('name: string')
      expect(bindings).toContain('greeting?: string')
    })
  })

  describe('generateRpcWrapper', () => {
    it('generates RPC call function', () => {
      const code = `
class MyService(RpcTarget):
    def greet(self, name: str) -> str:
        pass
`
      const result = parsePythonSource(code)
      const wrapper = generateRpcWrapper(result)

      expect(wrapper).toContain('createPythonRpcStub')
      expect(wrapper).toContain('async function call(method: string, args: unknown[])')
      expect(wrapper).toContain('X-Capnweb-RPC')
    })

    it('generates method wrappers for RpcTarget methods', () => {
      const code = `
class MyService(RpcTarget):
    def greet(self, name: str) -> str:
        pass

    def calculate(self, a: int, b: int) -> int:
        pass
`
      const result = parsePythonSource(code)
      const wrapper = generateRpcWrapper(result)

      expect(wrapper).toContain('async greet(name: string): Promise<string>')
      expect(wrapper).toContain('call("greet", [name])')
      expect(wrapper).toContain('async calculate(a: number, b: number): Promise<number>')
      expect(wrapper).toContain('call("calculate", [a, b])')
    })

    it('includes error handling', () => {
      const code = `class MyService(RpcTarget): pass`
      const result = parsePythonSource(code)
      const wrapper = generateRpcWrapper(result)

      expect(wrapper).toContain('if (result.error)')
      expect(wrapper).toContain('throw new Error')
    })

    it('includes call ID generation', () => {
      const code = `class MyService(RpcTarget): pass`
      const result = parsePythonSource(code)
      const wrapper = generateRpcWrapper(result)

      expect(wrapper).toContain('crypto.randomUUID()')
    })
  })

  describe('generateCapnwebBindings', () => {
    it('returns both types and wrapper', () => {
      const code = `
class MyService(RpcTarget):
    def method(self) -> str:
        pass
`
      const result = generateCapnwebBindings(code)

      expect(result.types).toBeDefined()
      expect(result.wrapper).toBeDefined()
      expect(result.parsed).toBeDefined()
    })

    it('parses complete module with multiple components', () => {
      const code = `
"""Module docstring"""

from typing import Optional

def helper(x: int) -> int:
    """Helper function."""
    return x * 2

class MainService(RpcTarget):
    """Main RPC service."""

    def process(self, data: dict[str, str]) -> list[str]:
        """Process input data."""
        pass

    async def fetch(self, url: str) -> Optional[dict]:
        """Fetch data from URL."""
        pass
`
      const result = generateCapnwebBindings(code)

      // Check parsed module
      expect(result.parsed.functions).toHaveLength(1)
      expect(result.parsed.classes).toHaveLength(1)
      expect(result.parsed.classes[0].methods).toHaveLength(2)

      // Check types
      expect(result.types).toContain('interface ModuleFunctions')
      expect(result.types).toContain('interface MainService')

      // Check wrapper
      expect(result.wrapper).toContain('process')
      expect(result.wrapper).toContain('fetch')
    })
  })
})
