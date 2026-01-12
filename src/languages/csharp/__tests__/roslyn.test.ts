/**
 * Roslyn Scripting Tests (RED)
 *
 * These tests validate Roslyn scripting for dynamic C# code execution.
 * The Roslyn engine is responsible for:
 * 1. Compiling C# scripts at runtime
 * 2. Executing scripts with shared state
 * 3. Supporting #r directives and using statements
 * 4. Providing diagnostics for compilation errors
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the implementation does not exist yet.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  executeRoslynScript,
  invokeRoslynHandler,
  continueRoslynScript,
  compileRoslynScript,
  parseCSharpFunctions,
  generateTypeScriptFromCSharp,
  mapCSharpTypeToTypeScript,
  createRoslynContext,
  type RoslynScriptOptions,
  type RoslynScriptState,
  type RoslynContext,
  type CSharpFunctionSignature,
} from '../roslyn'

describe('Roslyn Script Execution', () => {
  describe('executeRoslynScript', () => {
    it('executes simple C# expression', async () => {
      const result = await executeRoslynScript<number>('1 + 2')
      expect(result.value).toBe(3)
    })

    it('executes C# statements', async () => {
      const result = await executeRoslynScript<string>(`
        var name = "World";
        return $"Hello, {name}!";
      `)
      expect(result.value).toBe('Hello, World!')
    })

    it('returns compilation time', async () => {
      const result = await executeRoslynScript<number>('42')
      expect(result.compilationTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('returns execution time', async () => {
      const result = await executeRoslynScript<number>('42')
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('supports async/await', async () => {
      const result = await executeRoslynScript<string>(`
        await Task.Delay(1);
        return "done";
      `, {
        imports: ['System.Threading.Tasks'],
      })
      expect(result.value).toBe('done')
    })

    it('supports LINQ queries', async () => {
      const result = await executeRoslynScript<number[]>(`
        var numbers = new[] { 1, 2, 3, 4, 5 };
        return numbers.Where(n => n % 2 == 0).ToArray();
      `, {
        imports: ['System.Linq'],
      })
      expect(result.value).toEqual([2, 4])
    })

    it('handles script errors with diagnostics', async () => {
      await expect(executeRoslynScript('undefined_variable')).rejects.toThrow()
    })

    it('supports custom imports', async () => {
      const result = await executeRoslynScript<number>(`
        return Math.Sqrt(16);
      `, {
        imports: ['System'],
      })
      expect(result.value).toBe(4)
    })

    it('returns diagnostics for warnings', async () => {
      const result = await executeRoslynScript<int>(`
        int unused = 42;
        return 1;
      `)
      expect(result.diagnostics.some((d) => d.severity === 'warning')).toBe(true)
    })

    it('supports timeout option', async () => {
      await expect(
        executeRoslynScript(
          `
          while (true) { }
          return 0;
        `,
          { timeout: 100 }
        )
      ).rejects.toThrow()
    })

    it('supports .NET 8 features', async () => {
      const result = await executeRoslynScript<string>(`
        // Using primary constructor syntax
        return "C# 12 features supported";
      `, {
        targetFramework: 'net8.0',
      })
      expect(result.value).toBe('C# 12 features supported')
    })
  })

  describe('invokeRoslynHandler', () => {
    it('invokes a handler function with arguments', async () => {
      const code = `
public static int Add(int a, int b) => a + b;
`
      const result = await invokeRoslynHandler<number>(code, 'Add', [5, 3])
      expect(result).toBe(8)
    })

    it('invokes handler with no arguments', async () => {
      const code = `
public static string GetGreeting() => "Hello!";
`
      const result = await invokeRoslynHandler<string>(code, 'GetGreeting', [])
      expect(result).toBe('Hello!')
    })

    it('invokes handler with object arguments', async () => {
      const code = `
public static string ProcessUser(dynamic user) => $"{user.name} is {user.age}";
`
      const result = await invokeRoslynHandler<string>(code, 'ProcessUser', [
        { name: 'Alice', age: 30 },
      ])
      expect(result).toBe('Alice is 30')
    })

    it('invokes handler with array arguments', async () => {
      const code = `
public static int Sum(int[] numbers) => numbers.Sum();
`
      const result = await invokeRoslynHandler<number>(
        code,
        'Sum',
        [[1, 2, 3, 4, 5]],
        { imports: ['System.Linq'] }
      )
      expect(result).toBe(15)
    })

    it('handles handler not found', async () => {
      const code = `
public static int Add(int a, int b) => a + b;
`
      await expect(invokeRoslynHandler(code, 'NonExistent', [])).rejects.toThrow()
    })

    it('handles runtime exceptions', async () => {
      const code = `
public static int Divide(int a, int b) => a / b;
`
      await expect(invokeRoslynHandler(code, 'Divide', [10, 0])).rejects.toThrow()
    })

    it('supports async handlers', async () => {
      const code = `
public static async Task<int> AddAsync(int a, int b)
{
    await Task.Delay(1);
    return a + b;
}
`
      const result = await invokeRoslynHandler<number>(
        code,
        'AddAsync',
        [2, 3],
        { imports: ['System.Threading.Tasks'] }
      )
      expect(result).toBe(5)
    })

    it('supports handlers in a class', async () => {
      const code = `
public class Calculator
{
    public static int Multiply(int a, int b) => a * b;
}
`
      const result = await invokeRoslynHandler<number>(code, 'Calculator.Multiply', [4, 5])
      expect(result).toBe(20)
    })

    it('handles multiple handlers in same code', async () => {
      const code = `
public static int Add(int a, int b) => a + b;
public static int Sub(int a, int b) => a - b;
`
      const addResult = await invokeRoslynHandler<number>(code, 'Add', [10, 3])
      const subResult = await invokeRoslynHandler<number>(code, 'Sub', [10, 3])

      expect(addResult).toBe(13)
      expect(subResult).toBe(7)
    })
  })

  describe('continueRoslynScript', () => {
    it('continues execution with previous state', async () => {
      const firstResult = await executeRoslynScript<number>('var x = 10; return x;')

      const secondResult = await continueRoslynScript<number>(
        'return x + 5;',
        firstResult.state!
      )
      expect(secondResult.value).toBe(15)
    })

    it('preserves variables across continuations', async () => {
      const first = await executeRoslynScript<void>('var name = "Alice";')
      const second = await continueRoslynScript<void>('var age = 30;', first.state!)
      const third = await continueRoslynScript<string>(
        'return $"{name} is {age}";',
        second.state!
      )

      expect(third.value).toBe('Alice is 30')
    })

    it('preserves function definitions', async () => {
      const first = await executeRoslynScript<void>(`
        int Square(int x) => x * x;
      `)
      const second = await continueRoslynScript<number>('return Square(5);', first.state!)

      expect(second.value).toBe(25)
    })

    it('returns updated state', async () => {
      const first = await executeRoslynScript<void>('var a = 1;')
      const second = await continueRoslynScript<void>('var b = 2;', first.state!)

      expect(second.state).toBeDefined()
      expect(second.state?.variables).toHaveProperty('a')
      expect(second.state?.variables).toHaveProperty('b')
    })
  })

  describe('compileRoslynScript', () => {
    it('returns empty diagnostics for valid code', async () => {
      const diagnostics = await compileRoslynScript('var x = 42;')
      const errors = diagnostics.filter((d) => d.severity === 'error')
      expect(errors).toHaveLength(0)
    })

    it('returns error diagnostics for invalid code', async () => {
      const diagnostics = await compileRoslynScript('var x = ;')
      const errors = diagnostics.filter((d) => d.severity === 'error')
      expect(errors.length).toBeGreaterThan(0)
    })

    it('includes diagnostic location', async () => {
      const diagnostics = await compileRoslynScript('undefined_variable')
      const error = diagnostics.find((d) => d.severity === 'error')

      expect(error?.location).toBeDefined()
      expect(error?.location?.line).toBeGreaterThanOrEqual(0)
      expect(error?.location?.column).toBeGreaterThanOrEqual(0)
    })

    it('includes diagnostic ID', async () => {
      const diagnostics = await compileRoslynScript('undefined_variable')
      const error = diagnostics.find((d) => d.severity === 'error')

      expect(error?.id).toBeDefined()
      expect(error?.id).toMatch(/^CS\d+$/)
    })

    it('returns warnings for unused variables', async () => {
      const diagnostics = await compileRoslynScript('int unused = 42;')
      const warnings = diagnostics.filter((d) => d.severity === 'warning')
      expect(warnings.length).toBeGreaterThan(0)
    })
  })
})

describe('Roslyn Context', () => {
  let context: RoslynContext

  beforeEach(() => {
    context = createRoslynContext()
  })

  afterEach(() => {
    context.dispose()
  })

  describe('createRoslynContext', () => {
    it('creates a context with default options', () => {
      const ctx = createRoslynContext()
      expect(ctx).toBeDefined()
      expect(ctx.execute).toBeDefined()
      ctx.dispose()
    })

    it('creates a context with custom imports', () => {
      const ctx = createRoslynContext({
        imports: ['System.Linq', 'System.Text'],
      })
      expect(ctx).toBeDefined()
      ctx.dispose()
    })

    it('creates a context with globals', () => {
      const ctx = createRoslynContext({
        globals: { PI: 3.14159 },
      })
      expect(ctx).toBeDefined()
      ctx.dispose()
    })
  })

  describe('execute', () => {
    it('executes code in context', async () => {
      const result = await context.execute<number>('1 + 1')
      expect(result.value).toBe(2)
    })

    it('preserves state between executions', async () => {
      await context.execute('var x = 10;')
      const result = await context.execute<number>('x + 5')
      expect(result.value).toBe(15)
    })
  })

  describe('setVariable/getVariable', () => {
    it('sets and gets variables', () => {
      context.setVariable('name', 'Alice')
      expect(context.getVariable<string>('name')).toBe('Alice')
    })

    it('allows variables to be used in scripts', async () => {
      context.setVariable('multiplier', 10)
      const result = await context.execute<number>('5 * (int)multiplier')
      expect(result.value).toBe(50)
    })

    it('returns undefined for unknown variables', () => {
      expect(context.getVariable('nonexistent')).toBeUndefined()
    })
  })

  describe('addReference', () => {
    it('adds assembly reference', async () => {
      context.addReference('System.Text.Json')
      const result = await context.execute<string>(`
        var json = System.Text.Json.JsonSerializer.Serialize(new { x = 1 });
        return json;
      `)
      expect(result.value).toContain('"x"')
    })
  })

  describe('addImport', () => {
    it('adds namespace import', async () => {
      context.addImport('System.Linq')
      const result = await context.execute<int>(`
        var numbers = new[] { 1, 2, 3 };
        return numbers.Sum();
      `)
      expect(result.value).toBe(6)
    })
  })

  describe('getState', () => {
    it('returns current state', async () => {
      await context.execute('var x = 42; var y = "test";')
      const state = context.getState()

      expect(state.id).toBeDefined()
      expect(state.variables).toBeDefined()
      expect(state.capturedAt).toBeInstanceOf(Date)
    })

    it('includes variable information', async () => {
      await context.execute('int x = 42;')
      const state = context.getState()

      expect(state.variables['x']).toBeDefined()
      expect(state.variables['x'].type).toBe('int')
      expect(state.variables['x'].value).toBe(42)
    })
  })

  describe('reset', () => {
    it('clears all state', async () => {
      await context.execute('var x = 10;')
      context.reset()

      await expect(context.execute('return x;')).rejects.toThrow()
    })
  })
})

describe('C# Function Parser', () => {
  describe('parseCSharpFunctions', () => {
    it('parses simple function', () => {
      const code = `
public static int Add(int a, int b) => a + b;
`
      const functions = parseCSharpFunctions(code)

      expect(functions).toHaveLength(1)
      expect(functions[0].name).toBe('Add')
      expect(functions[0].parameters).toHaveLength(2)
      expect(functions[0].returnType).toBe('int')
    })

    it('parses function parameters', () => {
      const code = `
public static string Format(string template, int value, bool flag) => "";
`
      const functions = parseCSharpFunctions(code)

      expect(functions[0].parameters).toEqual([
        { name: 'template', type: 'string', isOptional: false },
        { name: 'value', type: 'int', isOptional: false },
        { name: 'flag', type: 'bool', isOptional: false },
      ])
    })

    it('parses optional parameters', () => {
      const code = `
public static void Log(string message, int level = 0) { }
`
      const functions = parseCSharpFunctions(code)

      expect(functions[0].parameters[0].isOptional).toBe(false)
      expect(functions[0].parameters[1].isOptional).toBe(true)
      expect(functions[0].parameters[1].defaultValue).toBe('0')
    })

    it('parses async functions', () => {
      const code = `
public static async Task<int> FetchAsync(string url) => 0;
`
      const functions = parseCSharpFunctions(code)

      expect(functions[0].isAsync).toBe(true)
      expect(functions[0].returnType).toBe('int')
    })

    it('parses void functions', () => {
      const code = `
public static void DoSomething() { }
`
      const functions = parseCSharpFunctions(code)

      expect(functions[0].returnType).toBe('void')
    })

    it('parses multiple functions', () => {
      const code = `
public static int Add(int a, int b) => a + b;
public static int Subtract(int a, int b) => a - b;
private static int Multiply(int a, int b) => a * b;
`
      const functions = parseCSharpFunctions(code)

      expect(functions).toHaveLength(3)
      expect(functions[0].name).toBe('Add')
      expect(functions[1].name).toBe('Subtract')
      expect(functions[2].name).toBe('Multiply')
    })

    it('parses access modifiers', () => {
      const code = `
public static void Public() { }
private static void Private() { }
protected static void Protected() { }
internal static void Internal() { }
`
      const functions = parseCSharpFunctions(code)

      expect(functions[0].accessModifier).toBe('public')
      expect(functions[1].accessModifier).toBe('private')
      expect(functions[2].accessModifier).toBe('protected')
      expect(functions[3].accessModifier).toBe('internal')
    })

    it('parses instance vs static methods', () => {
      const code = `
public static void StaticMethod() { }
public void InstanceMethod() { }
`
      const functions = parseCSharpFunctions(code)

      expect(functions[0].isStatic).toBe(true)
      expect(functions[1].isStatic).toBe(false)
    })

    it('parses generic type parameters', () => {
      const code = `
public static List<string> GetNames() => new();
public static Dictionary<string, int> GetCounts() => new();
`
      const functions = parseCSharpFunctions(code)

      expect(functions[0].returnType).toBe('List<string>')
      expect(functions[1].returnType).toBe('Dictionary<string, int>')
    })
  })
})

describe('TypeScript Generation', () => {
  describe('generateTypeScriptFromCSharp', () => {
    it('generates interface from C# class', () => {
      const code = `
public class Calculator
{
    public static int Add(int a, int b) => a + b;
    public static int Multiply(int a, int b) => a * b;
}
`
      const ts = generateTypeScriptFromCSharp(code, 'Calculator')

      expect(ts).toContain('interface Calculator')
      expect(ts).toContain('add(a: number, b: number): number')
      expect(ts).toContain('multiply(a: number, b: number): number')
    })

    it('generates Promise return types for async methods', () => {
      const code = `
public class Service
{
    public static async Task<string> FetchAsync(string url) => "";
}
`
      const ts = generateTypeScriptFromCSharp(code)

      expect(ts).toContain('fetchAsync(url: string): Promise<string>')
    })

    it('generates proper types for common C# types', () => {
      const code = `
public class TypeDemo
{
    public static void AllTypes(
        int i, long l, float f, double d,
        bool b, string s, object o,
        int[] arr, List<string> list
    ) { }
}
`
      const ts = generateTypeScriptFromCSharp(code)

      expect(ts).toContain('i: number')
      expect(ts).toContain('l: number')
      expect(ts).toContain('f: number')
      expect(ts).toContain('d: number')
      expect(ts).toContain('b: boolean')
      expect(ts).toContain('s: string')
      expect(ts).toContain('o: unknown')
      expect(ts).toContain('arr: number[]')
      expect(ts).toContain('list: string[]')
    })

    it('generates export statements', () => {
      const code = `
public static int Add(int a, int b) => a + b;
`
      const ts = generateTypeScriptFromCSharp(code, 'math')

      expect(ts).toContain('export')
    })
  })

  describe('mapCSharpTypeToTypeScript', () => {
    it('maps numeric types', () => {
      expect(mapCSharpTypeToTypeScript('int')).toBe('number')
      expect(mapCSharpTypeToTypeScript('long')).toBe('number')
      expect(mapCSharpTypeToTypeScript('float')).toBe('number')
      expect(mapCSharpTypeToTypeScript('double')).toBe('number')
      expect(mapCSharpTypeToTypeScript('decimal')).toBe('number')
      expect(mapCSharpTypeToTypeScript('byte')).toBe('number')
      expect(mapCSharpTypeToTypeScript('short')).toBe('number')
    })

    it('maps boolean type', () => {
      expect(mapCSharpTypeToTypeScript('bool')).toBe('boolean')
    })

    it('maps string type', () => {
      expect(mapCSharpTypeToTypeScript('string')).toBe('string')
    })

    it('maps void type', () => {
      expect(mapCSharpTypeToTypeScript('void')).toBe('void')
    })

    it('maps object type', () => {
      expect(mapCSharpTypeToTypeScript('object')).toBe('unknown')
      expect(mapCSharpTypeToTypeScript('dynamic')).toBe('unknown')
    })

    it('maps nullable types', () => {
      expect(mapCSharpTypeToTypeScript('int?')).toBe('number | null')
      expect(mapCSharpTypeToTypeScript('string?')).toBe('string | null')
    })

    it('maps array types', () => {
      expect(mapCSharpTypeToTypeScript('int[]')).toBe('number[]')
      expect(mapCSharpTypeToTypeScript('string[]')).toBe('string[]')
    })

    it('maps generic collection types', () => {
      expect(mapCSharpTypeToTypeScript('List<int>')).toBe('number[]')
      expect(mapCSharpTypeToTypeScript('IEnumerable<string>')).toBe('string[]')
      expect(mapCSharpTypeToTypeScript('Dictionary<string, int>')).toBe('Record<string, number>')
    })

    it('maps Task types', () => {
      expect(mapCSharpTypeToTypeScript('Task')).toBe('Promise<void>')
      expect(mapCSharpTypeToTypeScript('Task<int>')).toBe('Promise<number>')
      expect(mapCSharpTypeToTypeScript('Task<string>')).toBe('Promise<string>')
    })

    it('maps DateTime to string', () => {
      expect(mapCSharpTypeToTypeScript('DateTime')).toBe('string')
      expect(mapCSharpTypeToTypeScript('DateTimeOffset')).toBe('string')
    })

    it('maps Guid to string', () => {
      expect(mapCSharpTypeToTypeScript('Guid')).toBe('string')
    })
  })
})
