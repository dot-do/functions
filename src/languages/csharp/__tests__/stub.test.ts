/**
 * C# Thin Stub Tests (RED)
 *
 * These tests validate the C# thin stub that calls shared runtime workers.
 * The stub is responsible for:
 * 1. Creating lightweight proxies between JavaScript and .NET workers
 * 2. Serializing/deserializing data via Cap'n Proto RPC
 * 3. Managing worker pool connections
 * 4. Dispatching function calls to appropriate workers
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the implementation does not exist yet.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createCSharpStub,
  serializeForRpc,
  deserializeFromRpc,
  createWorkerPool,
  type CSharpStub,
  type CSharpStubOptions,
  type WorkerPool,
} from '../stub'

describe('C# Stub', () => {
  let stub: CSharpStub

  beforeEach(() => {
    stub = createCSharpStub()
  })

  afterEach(async () => {
    await stub.shutdown()
  })

  describe('createCSharpStub', () => {
    it('creates a stub with default options', () => {
      const s = createCSharpStub()
      expect(s).toBeDefined()
      expect(s.invoke).toBeDefined()
      expect(s.registerCode).toBeDefined()
    })

    it('creates a stub with custom worker pool options', () => {
      const options: CSharpStubOptions = {
        workerPool: {
          minWorkers: 2,
          maxWorkers: 8,
          idleTimeout: 60000,
        },
      }
      const s = createCSharpStub(options)
      expect(s).toBeDefined()
    })

    it('creates a stub with custom worker endpoint', () => {
      const options: CSharpStubOptions = {
        workerEndpoint: 'unix:///var/run/functions-do/csharp.sock',
      }
      const s = createCSharpStub(options)
      expect(s).toBeDefined()
    })

    it('creates a stub with debug mode enabled', () => {
      const options: CSharpStubOptions = {
        debug: true,
      }
      const s = createCSharpStub(options)
      expect(s).toBeDefined()
    })
  })

  describe('registerCode', () => {
    it('registers C# source code and returns function names', async () => {
      const code = `
public class Calculator
{
    public static int Add(int a, int b) => a + b;
    public static int Multiply(int a, int b) => a * b;
}
`
      const functions = await stub.registerCode(code)
      expect(functions).toContain('Calculator.Add')
      expect(functions).toContain('Calculator.Multiply')
    })

    it('registers async methods', async () => {
      const code = `
using System.Threading.Tasks;

public class AsyncService
{
    public static async Task<string> FetchDataAsync(string url)
    {
        await Task.Delay(1);
        return "data";
    }
}
`
      const functions = await stub.registerCode(code)
      expect(functions).toContain('AsyncService.FetchDataAsync')
    })

    it('handles invalid C# syntax', async () => {
      const code = `
public class Broken {
    public static int Bad( => // syntax error
`
      await expect(stub.registerCode(code)).rejects.toThrow()
    })

    it('registers generic methods', async () => {
      const code = `
public class GenericService
{
    public static T Identity<T>(T value) => value;
}
`
      const functions = await stub.registerCode(code)
      expect(functions).toContain('GenericService.Identity')
    })
  })

  describe('invoke', () => {
    beforeEach(async () => {
      const code = `
public class Calculator
{
    public static int Add(int a, int b) => a + b;
    public static int Subtract(int a, int b) => a - b;
    public static double Divide(double a, double b) => a / b;
    public static string Greet(string name) => $"Hello, {name}!";
}
`
      await stub.registerCode(code)
    })

    it('invokes a simple C# function with arguments', async () => {
      const result = await stub.invoke<number>('Calculator.Add', [5, 3])
      expect(result.result).toBe(8)
    })

    it('returns execution time in result', async () => {
      const result = await stub.invoke<number>('Calculator.Add', [1, 2])
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0)
      expect(result.executionTimeMs).toBeLessThan(1000)
    })

    it('returns worker ID in result', async () => {
      const result = await stub.invoke<number>('Calculator.Add', [1, 2])
      expect(result.workerId).toBeDefined()
      expect(typeof result.workerId).toBe('string')
    })

    it('invokes function with different argument types', async () => {
      const intResult = await stub.invoke<number>('Calculator.Subtract', [10, 3])
      expect(intResult.result).toBe(7)

      const doubleResult = await stub.invoke<number>('Calculator.Divide', [10.0, 4.0])
      expect(doubleResult.result).toBeCloseTo(2.5)

      const stringResult = await stub.invoke<string>('Calculator.Greet', ['World'])
      expect(stringResult.result).toBe('Hello, World!')
    })

    it('handles function not found error', async () => {
      await expect(stub.invoke('Calculator.NonExistent', [])).rejects.toThrow()
    })

    it('handles runtime exceptions from C#', async () => {
      const code = `
public class ErrorService
{
    public static int ThrowError() => throw new System.Exception("Test error");
}
`
      await stub.registerCode(code)
      await expect(stub.invoke('ErrorService.ThrowError', [])).rejects.toThrow('Test error')
    })

    it('invokes async functions', async () => {
      const code = `
using System.Threading.Tasks;

public class AsyncCalculator
{
    public static async Task<int> AddAsync(int a, int b)
    {
        await Task.Delay(1);
        return a + b;
    }
}
`
      await stub.registerCode(code)
      const result = await stub.invoke<number>('AsyncCalculator.AddAsync', [2, 3])
      expect(result.result).toBe(5)
    })

    it('handles null return values', async () => {
      const code = `
public class NullService
{
    public static string GetNull() => null;
}
`
      await stub.registerCode(code)
      const result = await stub.invoke<string | null>('NullService.GetNull', [])
      expect(result.result).toBeNull()
    })

    it('handles complex object return values', async () => {
      const code = `
public class DataService
{
    public static object GetData() => new { Name = "test", Value = 42 };
}
`
      await stub.registerCode(code)
      const result = await stub.invoke<{ Name: string; Value: number }>('DataService.GetData', [])
      expect(result.result.Name).toBe('test')
      expect(result.result.Value).toBe(42)
    })

    it('handles array arguments and return values', async () => {
      const code = `
public class ArrayService
{
    public static int[] Double(int[] values)
    {
        for (int i = 0; i < values.Length; i++)
            values[i] *= 2;
        return values;
    }
}
`
      await stub.registerCode(code)
      const result = await stub.invoke<number[]>('ArrayService.Double', [[1, 2, 3]])
      expect(result.result).toEqual([2, 4, 6])
    })
  })

  describe('getFunctionMetadata', () => {
    beforeEach(async () => {
      const code = `
using System.Threading.Tasks;

public class Service
{
    public static int Sync(int x, int y) => x + y;
    public static async Task<string> Async(string s) => await Task.FromResult(s);
}
`
      await stub.registerCode(code)
    })

    it('returns metadata for registered function', async () => {
      const metadata = await stub.getFunctionMetadata('Service.Sync')
      expect(metadata).not.toBeNull()
      expect(metadata?.name).toBe('Service.Sync')
      expect(metadata?.parameterTypes).toEqual(['int', 'int'])
      expect(metadata?.returnType).toBe('int')
      expect(metadata?.isAsync).toBe(false)
    })

    it('returns async flag for async functions', async () => {
      const metadata = await stub.getFunctionMetadata('Service.Async')
      expect(metadata).not.toBeNull()
      expect(metadata?.isAsync).toBe(true)
      expect(metadata?.returnType).toBe('string')
    })

    it('returns null for unknown function', async () => {
      const metadata = await stub.getFunctionMetadata('Unknown.Function')
      expect(metadata).toBeNull()
    })
  })

  describe('getWorkerStatus', () => {
    it('returns status of all workers', async () => {
      await stub.warmup()
      const statuses = await stub.getWorkerStatus()

      expect(Array.isArray(statuses)).toBe(true)
      expect(statuses.length).toBeGreaterThan(0)

      for (const status of statuses) {
        expect(status.id).toBeDefined()
        expect(typeof status.healthy).toBe('boolean')
        expect(typeof status.activeInvocations).toBe('number')
        expect(status.lastHeartbeat).toBeInstanceOf(Date)
        expect(status.runtimeVersion).toBeDefined()
      }
    })

    it('shows healthy status for active workers', async () => {
      await stub.warmup()
      const statuses = await stub.getWorkerStatus()

      const healthyWorkers = statuses.filter((s) => s.healthy)
      expect(healthyWorkers.length).toBeGreaterThan(0)
    })
  })

  describe('warmup', () => {
    it('pre-spawns workers in the pool', async () => {
      const customStub = createCSharpStub({
        workerPool: {
          minWorkers: 3,
        },
      })

      await customStub.warmup()
      const statuses = await customStub.getWorkerStatus()

      expect(statuses.length).toBeGreaterThanOrEqual(3)
      await customStub.shutdown()
    })

    it('completes without error', async () => {
      await expect(stub.warmup()).resolves.not.toThrow()
    })
  })

  describe('shutdown', () => {
    it('terminates all workers', async () => {
      await stub.warmup()
      await stub.shutdown()

      const statuses = await stub.getWorkerStatus()
      expect(statuses.every((s) => !s.healthy || s.activeInvocations === 0)).toBe(true)
    })

    it('completes without error', async () => {
      await expect(stub.shutdown()).resolves.not.toThrow()
    })
  })
})

describe('RPC Serialization', () => {
  describe('serializeForRpc', () => {
    it('serializes primitive values', () => {
      const intBuffer = serializeForRpc(42)
      expect(intBuffer).toBeInstanceOf(Uint8Array)
      expect(intBuffer.length).toBeGreaterThan(0)

      const strBuffer = serializeForRpc('hello')
      expect(strBuffer).toBeInstanceOf(Uint8Array)

      const boolBuffer = serializeForRpc(true)
      expect(boolBuffer).toBeInstanceOf(Uint8Array)
    })

    it('serializes objects', () => {
      const buffer = serializeForRpc({ name: 'test', value: 123 })
      expect(buffer).toBeInstanceOf(Uint8Array)
      expect(buffer.length).toBeGreaterThan(0)
    })

    it('serializes arrays', () => {
      const buffer = serializeForRpc([1, 2, 3, 4, 5])
      expect(buffer).toBeInstanceOf(Uint8Array)
      expect(buffer.length).toBeGreaterThan(0)
    })

    it('serializes nested structures', () => {
      const buffer = serializeForRpc({
        users: [
          { name: 'Alice', scores: [100, 95, 88] },
          { name: 'Bob', scores: [90, 85, 92] },
        ],
      })
      expect(buffer).toBeInstanceOf(Uint8Array)
    })

    it('serializes null and undefined', () => {
      const nullBuffer = serializeForRpc(null)
      expect(nullBuffer).toBeInstanceOf(Uint8Array)

      const undefinedBuffer = serializeForRpc(undefined)
      expect(undefinedBuffer).toBeInstanceOf(Uint8Array)
    })
  })

  describe('deserializeFromRpc', () => {
    it('deserializes primitive values', () => {
      const intBuffer = serializeForRpc(42)
      expect(deserializeFromRpc<number>(intBuffer)).toBe(42)

      const strBuffer = serializeForRpc('hello')
      expect(deserializeFromRpc<string>(strBuffer)).toBe('hello')

      const boolBuffer = serializeForRpc(true)
      expect(deserializeFromRpc<boolean>(boolBuffer)).toBe(true)
    })

    it('deserializes objects', () => {
      const original = { name: 'test', value: 123 }
      const buffer = serializeForRpc(original)
      const result = deserializeFromRpc<typeof original>(buffer)

      expect(result).toEqual(original)
    })

    it('deserializes arrays', () => {
      const original = [1, 2, 3, 4, 5]
      const buffer = serializeForRpc(original)
      const result = deserializeFromRpc<number[]>(buffer)

      expect(result).toEqual(original)
    })

    it('round-trips complex structures', () => {
      const original = {
        id: 1,
        name: 'test',
        active: true,
        scores: [1.5, 2.5, 3.5],
        metadata: {
          created: '2024-01-01',
          tags: ['a', 'b', 'c'],
        },
      }

      const buffer = serializeForRpc(original)
      const result = deserializeFromRpc<typeof original>(buffer)

      expect(result).toEqual(original)
    })
  })
})

describe('Worker Pool', () => {
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

  describe('createWorkerPool', () => {
    it('creates a pool with specified options', () => {
      const p = createWorkerPool({
        minWorkers: 1,
        maxWorkers: 10,
        idleTimeout: 60000,
      })
      expect(p).toBeDefined()
      expect(p.acquire).toBeDefined()
      expect(p.release).toBeDefined()
    })

    it('creates a pool with default options', () => {
      const p = createWorkerPool()
      expect(p).toBeDefined()
    })
  })

  describe('acquire', () => {
    it('acquires a worker from the pool', async () => {
      const workerId = await pool.acquire()
      expect(workerId).toBeDefined()
      expect(typeof workerId).toBe('string')
    })

    it('returns different workers for concurrent requests', async () => {
      const [worker1, worker2] = await Promise.all([pool.acquire(), pool.acquire()])

      expect(worker1).not.toBe(worker2)
    })
  })

  describe('release', () => {
    it('releases a worker back to the pool', async () => {
      const workerId = await pool.acquire()
      const statsBefore = pool.stats()

      pool.release(workerId)
      const statsAfter = pool.stats()

      expect(statsAfter.available).toBeGreaterThan(statsBefore.available)
    })
  })

  describe('stats', () => {
    it('returns pool statistics', () => {
      const stats = pool.stats()

      expect(typeof stats.total).toBe('number')
      expect(typeof stats.available).toBe('number')
      expect(typeof stats.busy).toBe('number')
      expect(stats.total).toBeGreaterThanOrEqual(0)
    })

    it('updates stats when workers are acquired', async () => {
      const statsBefore = pool.stats()
      await pool.acquire()
      const statsAfter = pool.stats()

      expect(statsAfter.busy).toBe(statsBefore.busy + 1)
    })
  })

  describe('shutdown', () => {
    it('shuts down all workers', async () => {
      await pool.acquire()
      await pool.shutdown()

      const stats = pool.stats()
      expect(stats.total).toBe(0)
      expect(stats.busy).toBe(0)
    })
  })
})
