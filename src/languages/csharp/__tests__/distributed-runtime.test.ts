/**
 * C# Distributed Runtime Tests (RED)
 *
 * These tests validate the distributed runtime architecture for C# execution.
 * The distributed runtime system is responsible for:
 * 1. Compiling C# code via Roslyn (thin stub)
 * 2. Executing via shared runtime Durable Object
 * 3. Handling compilation errors
 * 4. Supporting async/await patterns
 * 5. Handling exceptions gracefully
 *
 * Architecture:
 * - Thin stubs (~5KB WASM) handle serialization and dispatch
 * - Shared runtime Durable Objects execute the actual .NET code
 * - Cap'n Proto RPC enables efficient cross-worker communication
 * - Worker pools are managed for optimal resource utilization
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the full distributed runtime implementation does not exist yet.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createCSharpStub,
  serializeForRpc,
  deserializeFromRpc,
  createWorkerPool,
  type CSharpStub,
  type WorkerPool,
} from '../stub'
import {
  compileRoslynScript,
  executeRoslynScript,
  invokeRoslynHandler,
  createRoslynContext,
  type RoslynContext,
} from '../roslyn'
import {
  createDotNetRuntime,
  compileCSharpToAssembly,
  type DotNetRuntime,
} from '../runtime'

describe('C# Distributed Runtime - Roslyn Compilation (Thin Stub)', () => {
  describe('compileRoslynScript', () => {
    it('compiles simple C# expression', async () => {
      const diagnostics = await compileRoslynScript('var x = 42;')
      const errors = diagnostics.filter((d) => d.severity === 'error')
      expect(errors).toHaveLength(0)
    })

    it('compiles C# class definition', async () => {
      const code = `
public class Calculator
{
    public static int Add(int a, int b) => a + b;
}
`
      const diagnostics = await compileRoslynScript(code)
      const errors = diagnostics.filter((d) => d.severity === 'error')
      expect(errors).toHaveLength(0)
    })

    it('reports syntax errors with location', async () => {
      const diagnostics = await compileRoslynScript('var x = ;')
      const errors = diagnostics.filter((d) => d.severity === 'error')

      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].id).toMatch(/^CS\d+$/)
      expect(errors[0].location).toBeDefined()
      expect(errors[0].location?.line).toBeGreaterThanOrEqual(0)
    })

    it('reports undefined variable errors', async () => {
      const diagnostics = await compileRoslynScript('undefined_variable')
      const errors = diagnostics.filter((d) => d.severity === 'error')

      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].message).toContain('does not exist')
    })

    it('reports warnings for unused variables', async () => {
      const diagnostics = await compileRoslynScript('int unused = 42;')
      const warnings = diagnostics.filter((d) => d.severity === 'warning')

      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings[0].id).toBe('CS0219')
    })

    it('compiles async code with Task imports', async () => {
      const code = `
using System.Threading.Tasks;

public class AsyncService
{
    public static async Task<int> GetValueAsync()
    {
        await Task.Delay(1);
        return 42;
    }
}
`
      const diagnostics = await compileRoslynScript(code, {
        imports: ['System.Threading.Tasks'],
      })
      const errors = diagnostics.filter((d) => d.severity === 'error')
      expect(errors).toHaveLength(0)
    })

    it('supports .NET 8 target framework', async () => {
      const diagnostics = await compileRoslynScript('var x = 1;', {
        targetFramework: 'net8.0',
      })
      expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
    })

    it('supports .NET 9 target framework', async () => {
      const diagnostics = await compileRoslynScript('var x = 1;', {
        targetFramework: 'net9.0',
      })
      expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
    })
  })

  describe('compileCSharpToAssembly', () => {
    it('compiles C# to assembly with metadata', async () => {
      const code = `
public class MathService
{
    public static int Square(int x) => x * x;
}
`
      const result = await compileCSharpToAssembly(code, {
        assemblyName: 'MathService',
      })

      expect(result.assemblyPath).toContain('.dll')
      expect(result.metadata.name).toBe('MathService')
      expect(result.metadata.exportedTypes).toContain('MathService')
    })

    it('fails compilation with detailed errors', async () => {
      const code = `
public class BrokenClass
{
    public void Method() => undefined_variable;
}
`
      await expect(compileCSharpToAssembly(code)).rejects.toThrow()
    })

    it('returns compilation warnings in diagnostics', async () => {
      const code = `
public class WarningClass
{
    public void Method()
    {
        int unused = 42;
    }
}
`
      const result = await compileCSharpToAssembly(code)
      const warnings = result.diagnostics.filter((d) => d.severity === 'warning')
      expect(warnings.length).toBeGreaterThan(0)
    })

    it('supports custom assembly references', async () => {
      const code = `
using System.Text.Json;

public class JsonService
{
    public static string Serialize(object obj) => JsonSerializer.Serialize(obj);
}
`
      const result = await compileCSharpToAssembly(code, {
        references: ['System.Text.Json'],
        assemblyName: 'JsonService',
      })

      expect(result.assemblyPath).toBeDefined()
      expect(result.metadata.dependencies).toContainEqual(
        expect.objectContaining({ name: 'System.Text.Json' })
      )
    })

    it('supports optimization flag for release builds', async () => {
      const code = `public class OptimizedClass { }`
      const result = await compileCSharpToAssembly(code, {
        optimize: true,
      })
      expect(result.assemblyPath).toBeDefined()
    })
  })
})

describe('C# Distributed Runtime - Shared Runtime Durable Object Execution', () => {
  let runtime: DotNetRuntime

  beforeEach(async () => {
    runtime = createDotNetRuntime({
      runtimeVersion: 'net8.0',
      maxMemoryMb: 256,
    })
    await runtime.start()
  })

  afterEach(async () => {
    await runtime.shutdown()
  })

  describe('invoke', () => {
    beforeEach(async () => {
      const code = `
public class Calculator
{
    public static int Add(int a, int b) => a + b;
    public static int Subtract(int a, int b) => a - b;
    public static int Multiply(int a, int b) => a * b;
    public static double Divide(double a, double b) => a / b;
}
`
      await compileCSharpToAssembly(code, { assemblyName: 'DistributedCalc' })
      await runtime.loadAssembly('DistributedCalc.dll')
    })

    it('invokes method on shared runtime and returns result', async () => {
      const response = await runtime.invoke<number>({
        assembly: 'DistributedCalc',
        typeName: 'Calculator',
        methodName: 'Add',
        args: [10, 5],
      })

      expect(response.result).toBe(15)
      expect(response.executionTimeMs).toBeGreaterThanOrEqual(0)
      expect(response.workerId).toBeDefined()
    })

    it('invokes method with negative numbers', async () => {
      const response = await runtime.invoke<number>({
        assembly: 'DistributedCalc',
        typeName: 'Calculator',
        methodName: 'Add',
        args: [-5, 3],
      })

      expect(response.result).toBe(-2)
    })

    it('invokes division method with floating point', async () => {
      const response = await runtime.invoke<number>({
        assembly: 'DistributedCalc',
        typeName: 'Calculator',
        methodName: 'Divide',
        args: [10, 4],
      })

      expect(response.result).toBe(2.5)
    })

    it('returns GC statistics from execution', async () => {
      const response = await runtime.invoke<number>({
        assembly: 'DistributedCalc',
        typeName: 'Calculator',
        methodName: 'Add',
        args: [1, 2],
      })

      expect(response.gcStats).toBeDefined()
      expect(response.gcStats?.gen0Collections).toBeGreaterThanOrEqual(0)
      expect(response.gcStats?.totalMemory).toBeGreaterThan(0)
    })

    it('handles multiple concurrent invocations', async () => {
      const requests = Array(20)
        .fill(null)
        .map((_, i) => ({
          assembly: 'DistributedCalc',
          typeName: 'Calculator',
          methodName: 'Multiply',
          args: [i, 3],
        }))

      const responses = await Promise.all(requests.map((r) => runtime.invoke<number>(r)))

      expect(responses).toHaveLength(20)
      responses.forEach((resp, i) => {
        expect(resp.result).toBe(i * 3)
      })
    })

    it('distributes load across multiple workers', async () => {
      const requests = Array(10)
        .fill(null)
        .map(() => ({
          assembly: 'DistributedCalc',
          typeName: 'Calculator',
          methodName: 'Add',
          args: [1, 1],
        }))

      const responses = await Promise.all(requests.map((r) => runtime.invoke<number>(r)))
      const uniqueWorkers = new Set(responses.map((r) => r.workerId))

      // With enough concurrent requests, multiple workers should be used
      expect(uniqueWorkers.size).toBeGreaterThanOrEqual(1)
    })
  })

  describe('error handling', () => {
    beforeEach(async () => {
      const code = `
public class ErrorService
{
    public static int Divide(int a, int b)
    {
        if (b == 0) throw new System.DivideByZeroException("Cannot divide by zero");
        return a / b;
    }

    public static void ThrowCustom()
    {
        throw new System.InvalidOperationException("Custom error message");
    }
}
`
      await compileCSharpToAssembly(code, { assemblyName: 'ErrorService' })
      await runtime.loadAssembly('ErrorService.dll')
    })

    it('propagates DivideByZeroException from .NET', async () => {
      await expect(
        runtime.invoke({
          assembly: 'ErrorService',
          typeName: 'ErrorService',
          methodName: 'Divide',
          args: [10, 0],
        })
      ).rejects.toThrow()
    })

    it('propagates InvalidOperationException from .NET', async () => {
      await expect(
        runtime.invoke({
          assembly: 'ErrorService',
          typeName: 'ErrorService',
          methodName: 'ThrowCustom',
          args: [],
        })
      ).rejects.toThrow()
    })

    it('handles type not found error', async () => {
      await expect(
        runtime.invoke({
          assembly: 'ErrorService',
          typeName: 'NonExistentType',
          methodName: 'Method',
          args: [],
        })
      ).rejects.toThrow()
    })

    it('handles method not found error', async () => {
      await expect(
        runtime.invoke({
          assembly: 'ErrorService',
          typeName: 'ErrorService',
          methodName: 'NonExistentMethod',
          args: [],
        })
      ).rejects.toThrow()
    })
  })

  describe('timeout handling', () => {
    beforeEach(async () => {
      const code = `
using System.Threading;

public class SlowService
{
    public static void SlowMethod()
    {
        Thread.Sleep(10000);
    }

    public static int EventuallyReturns()
    {
        Thread.Sleep(5000);
        return 42;
    }
}
`
      await compileCSharpToAssembly(code, { assemblyName: 'SlowService' })
      await runtime.loadAssembly('SlowService.dll')
    })

    it('times out slow method execution', async () => {
      await expect(
        runtime.invoke({
          assembly: 'SlowService',
          typeName: 'SlowService',
          methodName: 'SlowMethod',
          args: [],
          timeoutMs: 100,
        })
      ).rejects.toThrow()
    })
  })
})

describe('C# Distributed Runtime - Async/Await Support', () => {
  let runtime: DotNetRuntime

  beforeEach(async () => {
    runtime = createDotNetRuntime({ runtimeVersion: 'net8.0' })
    await runtime.start()
  })

  afterEach(async () => {
    await runtime.shutdown()
  })

  describe('async method invocation', () => {
    beforeEach(async () => {
      const code = `
using System;
using System.Threading.Tasks;

public class AsyncCalculator
{
    public static async Task<int> AddAsync(int a, int b)
    {
        await Task.Delay(1);
        return a + b;
    }

    public static async Task<string> ConcatAsync(string a, string b)
    {
        await Task.Yield();
        return a + b;
    }

    public static async Task<int[]> DoubleAllAsync(int[] values)
    {
        await Task.Delay(1);
        var result = new int[values.Length];
        for (int i = 0; i < values.Length; i++)
        {
            result[i] = values[i] * 2;
        }
        return result;
    }
}
`
      await compileCSharpToAssembly(code, { assemblyName: 'AsyncCalculator' })
      await runtime.loadAssembly('AsyncCalculator.dll')
    })

    it('invokes async method returning Task<int>', async () => {
      const response = await runtime.invoke<number>({
        assembly: 'AsyncCalculator',
        typeName: 'AsyncCalculator',
        methodName: 'AddAsync',
        args: [7, 8],
      })

      expect(response.result).toBe(15)
    })

    it('invokes async method returning Task<string>', async () => {
      const response = await runtime.invoke<string>({
        assembly: 'AsyncCalculator',
        typeName: 'AsyncCalculator',
        methodName: 'ConcatAsync',
        args: ['Hello, ', 'World!'],
      })

      expect(response.result).toBe('Hello, World!')
    })

    it('invokes async method returning Task<int[]>', async () => {
      const response = await runtime.invoke<number[]>({
        assembly: 'AsyncCalculator',
        typeName: 'AsyncCalculator',
        methodName: 'DoubleAllAsync',
        args: [[1, 2, 3, 4, 5]],
      })

      expect(response.result).toEqual([2, 4, 6, 8, 10])
    })

    it('handles multiple concurrent async invocations', async () => {
      const requests = Array(10)
        .fill(null)
        .map((_, i) => ({
          assembly: 'AsyncCalculator',
          typeName: 'AsyncCalculator',
          methodName: 'AddAsync',
          args: [i, i],
        }))

      const responses = await Promise.all(requests.map((r) => runtime.invoke<number>(r)))

      responses.forEach((resp, i) => {
        expect(resp.result).toBe(i * 2)
      })
    })
  })

  describe('async exception handling', () => {
    beforeEach(async () => {
      const code = `
using System;
using System.Threading.Tasks;

public class AsyncErrorService
{
    public static async Task<int> ThrowAfterDelayAsync()
    {
        await Task.Delay(10);
        throw new InvalidOperationException("Async error");
    }

    public static async Task ThrowImmediatelyAsync()
    {
        throw new ArgumentException("Immediate async error");
    }
}
`
      await compileCSharpToAssembly(code, { assemblyName: 'AsyncErrorService' })
      await runtime.loadAssembly('AsyncErrorService.dll')
    })

    it('handles exception thrown after await', async () => {
      await expect(
        runtime.invoke({
          assembly: 'AsyncErrorService',
          typeName: 'AsyncErrorService',
          methodName: 'ThrowAfterDelayAsync',
          args: [],
        })
      ).rejects.toThrow()
    })

    it('handles exception thrown before await', async () => {
      await expect(
        runtime.invoke({
          assembly: 'AsyncErrorService',
          typeName: 'AsyncErrorService',
          methodName: 'ThrowImmediatelyAsync',
          args: [],
        })
      ).rejects.toThrow()
    })
  })
})

describe('C# Distributed Runtime - Exception Handling', () => {
  let runtime: DotNetRuntime

  beforeEach(async () => {
    runtime = createDotNetRuntime({ runtimeVersion: 'net8.0' })
    await runtime.start()
  })

  afterEach(async () => {
    await runtime.shutdown()
  })

  describe('standard .NET exceptions', () => {
    beforeEach(async () => {
      const code = `
using System;
using System.Collections.Generic;

public class ExceptionService
{
    public static void ThrowArgumentNull()
    {
        throw new ArgumentNullException("param", "Parameter cannot be null");
    }

    public static void ThrowArgumentOutOfRange()
    {
        throw new ArgumentOutOfRangeException("index", "Index out of range");
    }

    public static void ThrowInvalidOperation()
    {
        throw new InvalidOperationException("Invalid operation");
    }

    public static void ThrowNotSupported()
    {
        throw new NotSupportedException("Operation not supported");
    }

    public static int ThrowIndexOutOfRange()
    {
        var list = new List<int>();
        return list[100];
    }

    public static void ThrowNullReference()
    {
        string s = null;
        var length = s.Length;
    }
}
`
      await compileCSharpToAssembly(code, { assemblyName: 'ExceptionService' })
      await runtime.loadAssembly('ExceptionService.dll')
    })

    it('handles ArgumentNullException', async () => {
      await expect(
        runtime.invoke({
          assembly: 'ExceptionService',
          typeName: 'ExceptionService',
          methodName: 'ThrowArgumentNull',
          args: [],
        })
      ).rejects.toThrow()
    })

    it('handles ArgumentOutOfRangeException', async () => {
      await expect(
        runtime.invoke({
          assembly: 'ExceptionService',
          typeName: 'ExceptionService',
          methodName: 'ThrowArgumentOutOfRange',
          args: [],
        })
      ).rejects.toThrow()
    })

    it('handles InvalidOperationException', async () => {
      await expect(
        runtime.invoke({
          assembly: 'ExceptionService',
          typeName: 'ExceptionService',
          methodName: 'ThrowInvalidOperation',
          args: [],
        })
      ).rejects.toThrow()
    })

    it('handles NotSupportedException', async () => {
      await expect(
        runtime.invoke({
          assembly: 'ExceptionService',
          typeName: 'ExceptionService',
          methodName: 'ThrowNotSupported',
          args: [],
        })
      ).rejects.toThrow()
    })

    it('handles IndexOutOfRangeException from runtime', async () => {
      await expect(
        runtime.invoke({
          assembly: 'ExceptionService',
          typeName: 'ExceptionService',
          methodName: 'ThrowIndexOutOfRange',
          args: [],
        })
      ).rejects.toThrow()
    })

    it('handles NullReferenceException from runtime', async () => {
      await expect(
        runtime.invoke({
          assembly: 'ExceptionService',
          typeName: 'ExceptionService',
          methodName: 'ThrowNullReference',
          args: [],
        })
      ).rejects.toThrow()
    })
  })

  describe('custom exceptions', () => {
    beforeEach(async () => {
      const code = `
using System;

public class CustomException : Exception
{
    public int ErrorCode { get; }

    public CustomException(string message, int errorCode) : base(message)
    {
        ErrorCode = errorCode;
    }
}

public class CustomExceptionService
{
    public static void ThrowCustom()
    {
        throw new CustomException("Custom error occurred", 500);
    }

    public static void ThrowNested()
    {
        try
        {
            throw new InvalidOperationException("Inner exception");
        }
        catch (Exception ex)
        {
            throw new CustomException("Outer exception", 400);
        }
    }
}
`
      await compileCSharpToAssembly(code, { assemblyName: 'CustomExceptionService' })
      await runtime.loadAssembly('CustomExceptionService.dll')
    })

    it('handles custom exception types', async () => {
      await expect(
        runtime.invoke({
          assembly: 'CustomExceptionService',
          typeName: 'CustomExceptionService',
          methodName: 'ThrowCustom',
          args: [],
        })
      ).rejects.toThrow()
    })

    it('handles nested exceptions', async () => {
      await expect(
        runtime.invoke({
          assembly: 'CustomExceptionService',
          typeName: 'CustomExceptionService',
          methodName: 'ThrowNested',
          args: [],
        })
      ).rejects.toThrow()
    })
  })
})

describe('C# Distributed Runtime - Thin Stub Integration', () => {
  let stub: CSharpStub

  beforeEach(async () => {
    stub = createCSharpStub({
      workerPool: {
        minWorkers: 2,
        maxWorkers: 5,
      },
    })
    await stub.warmup()
  })

  afterEach(async () => {
    await stub.shutdown()
  })

  describe('registerCode', () => {
    it('registers C# code and returns function names', async () => {
      const code = `
public class Calculator
{
    public static int Add(int a, int b) => a + b;
    public static int Multiply(int a, int b) => a * b;
}
`
      const functionNames = await stub.registerCode(code)

      expect(functionNames).toContain('Calculator.Add')
      expect(functionNames).toContain('Calculator.Multiply')
    })

    it('handles syntax errors in registered code', async () => {
      const code = `
public class BrokenClass
{
    public static int Add( => a + b;
}
`
      await expect(stub.registerCode(code)).rejects.toThrow()
    })
  })

  describe('invoke', () => {
    beforeEach(async () => {
      const code = `
public class Calculator
{
    public static int Add(int a, int b) => a + b;
    public static int Subtract(int a, int b) => a - b;
}
`
      await stub.registerCode(code)
    })

    it('invokes registered function and returns result', async () => {
      const result = await stub.invoke<number>('Calculator.Add', [5, 3])

      expect(result.result).toBe(8)
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0)
      expect(result.workerId).toBeDefined()
    })

    it('throws for unregistered function', async () => {
      await expect(stub.invoke('Calculator.NonExistent', [])).rejects.toThrow(
        'Function not found'
      )
    })
  })

  describe('getFunctionMetadata', () => {
    beforeEach(async () => {
      const code = `
public class Service
{
    public static async Task<string> FetchAsync(string url) { return ""; }
}
`
      await stub.registerCode(code)
    })

    it('returns function metadata for registered function', async () => {
      const metadata = await stub.getFunctionMetadata('Service.FetchAsync')

      expect(metadata).toBeDefined()
      expect(metadata?.name).toBe('Service.FetchAsync')
      expect(metadata?.isAsync).toBe(true)
      expect(metadata?.returnType).toBe('string')
      expect(metadata?.parameterTypes).toContain('string')
    })

    it('returns null for unregistered function', async () => {
      const metadata = await stub.getFunctionMetadata('NonExistent.Function')
      expect(metadata).toBeNull()
    })
  })

  describe('getWorkerStatus', () => {
    it('returns status of all workers', async () => {
      const statuses = await stub.getWorkerStatus()

      expect(Array.isArray(statuses)).toBe(true)
      expect(statuses.length).toBeGreaterThanOrEqual(2) // minWorkers: 2
    })

    it('includes worker health information', async () => {
      const statuses = await stub.getWorkerStatus()

      for (const status of statuses) {
        expect(status.id).toBeDefined()
        expect(typeof status.healthy).toBe('boolean')
        expect(typeof status.activeInvocations).toBe('number')
        expect(status.lastHeartbeat).toBeInstanceOf(Date)
        expect(status.runtimeVersion).toBeDefined()
      }
    })
  })
})

describe('C# Distributed Runtime - Worker Pool', () => {
  let pool: WorkerPool

  beforeEach(() => {
    pool = createWorkerPool({
      minWorkers: 2,
      maxWorkers: 5,
      idleTimeout: 30000,
    })
  })

  afterEach(async () => {
    await pool.shutdown()
  })

  describe('acquire/release', () => {
    it('acquires a worker from the pool', async () => {
      const workerId = await pool.acquire()
      expect(workerId).toBeDefined()
      expect(typeof workerId).toBe('string')
    })

    it('releases worker back to pool', async () => {
      const workerId = await pool.acquire()
      const statsBefore = pool.stats()

      pool.release(workerId)
      const statsAfter = pool.stats()

      expect(statsAfter.available).toBe(statsBefore.available + 1)
      expect(statsAfter.busy).toBe(statsBefore.busy - 1)
    })

    it('handles concurrent acquisitions', async () => {
      const workers = await Promise.all([
        pool.acquire(),
        pool.acquire(),
        pool.acquire(),
      ])

      expect(workers).toHaveLength(3)
      const uniqueIds = new Set(workers)
      expect(uniqueIds.size).toBe(3)
    })
  })

  describe('stats', () => {
    it('returns pool statistics', () => {
      const stats = pool.stats()

      expect(typeof stats.total).toBe('number')
      expect(typeof stats.available).toBe('number')
      expect(typeof stats.busy).toBe('number')
    })

    it('tracks worker acquisitions', async () => {
      const statsBefore = pool.stats()
      await pool.acquire()
      const statsAfter = pool.stats()

      expect(statsAfter.busy).toBe(statsBefore.busy + 1)
    })
  })

  describe('shutdown', () => {
    it('shuts down pool and rejects new acquisitions', async () => {
      await pool.shutdown()

      await expect(pool.acquire()).rejects.toThrow()
    })
  })
})

describe('C# Distributed Runtime - RPC Serialization', () => {
  describe('serializeForRpc', () => {
    it('serializes primitive values', () => {
      expect(deserializeFromRpc(serializeForRpc(42))).toBe(42)
      expect(deserializeFromRpc(serializeForRpc('hello'))).toBe('hello')
      expect(deserializeFromRpc(serializeForRpc(true))).toBe(true)
      expect(deserializeFromRpc(serializeForRpc(null))).toBe(null)
    })

    it('serializes arrays', () => {
      const arr = [1, 2, 3, 4, 5]
      expect(deserializeFromRpc(serializeForRpc(arr))).toEqual(arr)
    })

    it('serializes objects', () => {
      const obj = { name: 'test', value: 42, nested: { a: 1 } }
      expect(deserializeFromRpc(serializeForRpc(obj))).toEqual(obj)
    })

    it('handles undefined by converting to marker', () => {
      const serialized = serializeForRpc(undefined)
      expect(deserializeFromRpc(serialized)).toBeUndefined()
    })

    it('preserves Date objects as ISO strings', () => {
      const date = new Date('2026-01-12T00:00:00.000Z')
      const result = deserializeFromRpc<string>(serializeForRpc(date))
      expect(result).toBe(date.toISOString())
    })
  })

  describe('deserializeFromRpc', () => {
    it('deserializes Cap\'n Proto format to JavaScript values', () => {
      const buffer = new TextEncoder().encode('{"a":1,"b":"test"}')
      const result = deserializeFromRpc<{ a: number; b: string }>(buffer)

      expect(result.a).toBe(1)
      expect(result.b).toBe('test')
    })

    it('handles empty buffer', () => {
      const buffer = new TextEncoder().encode('null')
      expect(deserializeFromRpc(buffer)).toBe(null)
    })
  })
})

describe('C# Distributed Runtime - Roslyn Context', () => {
  let context: RoslynContext

  beforeEach(() => {
    context = createRoslynContext()
  })

  afterEach(() => {
    context.dispose()
  })

  describe('execute', () => {
    it('executes C# code in context', async () => {
      const result = await context.execute<number>('1 + 2')
      expect(result.value).toBe(3)
    })

    it('preserves state between executions', async () => {
      await context.execute('var x = 10;')
      const result = await context.execute<number>('x + 5')
      expect(result.value).toBe(15)
    })

    it('preserves function definitions', async () => {
      await context.execute('int Square(int x) => x * x;')
      const result = await context.execute<number>('return Square(5);')
      expect(result.value).toBe(25)
    })
  })

  describe('setVariable/getVariable', () => {
    it('sets and gets variables from context', () => {
      context.setVariable('name', 'Alice')
      expect(context.getVariable<string>('name')).toBe('Alice')
    })

    it('allows variables to be used in script execution', async () => {
      context.setVariable('multiplier', 10)
      const result = await context.execute<number>('5 * (int)multiplier')
      expect(result.value).toBe(50)
    })
  })

  describe('reset', () => {
    it('clears all state from context', async () => {
      await context.execute('var x = 10;')
      context.reset()

      await expect(context.execute('return x;')).rejects.toThrow()
    })
  })

  describe('getState', () => {
    it('returns current context state', async () => {
      await context.execute('int x = 42;')
      const state = context.getState()

      expect(state.id).toBeDefined()
      expect(state.variables['x']).toBeDefined()
      expect(state.variables['x'].value).toBe(42)
      expect(state.capturedAt).toBeInstanceOf(Date)
    })
  })
})

describe('C# Distributed Runtime - Roslyn Handler Invocation', () => {
  describe('invokeRoslynHandler', () => {
    it('invokes handler function with arguments', async () => {
      const code = `
public static int Add(int a, int b) => a + b;
`
      const result = await invokeRoslynHandler<number>(code, 'Add', [5, 3])
      expect(result).toBe(8)
    })

    it('invokes handler in a class', async () => {
      const code = `
public class Calculator
{
    public static int Multiply(int a, int b) => a * b;
}
`
      const result = await invokeRoslynHandler<number>(code, 'Calculator.Multiply', [4, 5])
      expect(result).toBe(20)
    })

    it('handles handler not found', async () => {
      const code = `
public static int Add(int a, int b) => a + b;
`
      await expect(invokeRoslynHandler(code, 'NonExistent', [])).rejects.toThrow()
    })

    it('handles runtime exceptions in handler', async () => {
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
  })
})
