/**
 * .NET Runtime Worker Tests (RED)
 *
 * These tests validate the specialized .NET runtime workers for Functions.do.
 * The runtime system is responsible for:
 * 1. Spawning and managing .NET worker processes
 * 2. Loading and executing compiled C# assemblies
 * 3. Providing isolation between function invocations
 * 4. Managing memory and resource limits
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the implementation does not exist yet.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createDotNetRuntime,
  compileCSharpToAssembly,
  spawnDotNetWorker,
  terminateWorker,
  checkWorkerHealth,
  getDotNetRuntimeInfo,
  createDotNetWorkerPool,
  type DotNetRuntime,
  type DotNetRuntimeConfig,
  type DotNetWorker,
  type DotNetInvocationRequest,
  type DotNetWorkerPool,
  type AssemblyMetadata,
  type MemorySnapshot,
} from '../runtime'

describe('.NET Runtime', () => {
  let runtime: DotNetRuntime

  beforeEach(async () => {
    runtime = createDotNetRuntime({
      runtimeVersion: 'net8.0',
    })
    await runtime.start()
  })

  afterEach(async () => {
    await runtime.shutdown()
  })

  describe('createDotNetRuntime', () => {
    it('creates runtime with default config', () => {
      const r = createDotNetRuntime()
      expect(r).toBeDefined()
      expect(r.start).toBeDefined()
      expect(r.invoke).toBeDefined()
    })

    it('creates runtime with custom config', () => {
      const config: DotNetRuntimeConfig = {
        runtimeVersion: 'net8.0',
        maxMemoryMb: 512,
        cpuTimeoutMs: 30000,
        gcMode: 'server',
        tieredCompilation: true,
      }
      const r = createDotNetRuntime(config)
      expect(r).toBeDefined()
    })

    it('creates runtime with Native AOT enabled', () => {
      const config: DotNetRuntimeConfig = {
        runtimeVersion: 'net8.0',
        nativeAot: true,
      }
      const r = createDotNetRuntime(config)
      expect(r).toBeDefined()
    })

    it('creates runtime with custom assembly paths', () => {
      const config: DotNetRuntimeConfig = {
        runtimeVersion: 'net8.0',
        assemblyPaths: ['/custom/path/assemblies'],
      }
      const r = createDotNetRuntime(config)
      expect(r).toBeDefined()
    })
  })

  describe('start', () => {
    it('starts the runtime successfully', async () => {
      const r = createDotNetRuntime()
      await expect(r.start()).resolves.not.toThrow()
      await r.shutdown()
    })

    it('spawns initial workers', async () => {
      const r = createDotNetRuntime()
      await r.start()

      const workers = r.getWorkers()
      expect(workers.length).toBeGreaterThan(0)
      expect(workers[0].state).toBe('ready')

      await r.shutdown()
    })
  })

  describe('invoke', () => {
    beforeEach(async () => {
      const code = `
using System;

public class Calculator
{
    public static int Add(int a, int b) => a + b;
    public static int Multiply(int a, int b) => a * b;
    public static double Divide(double a, double b) => a / b;
}
`
      await compileCSharpToAssembly(code, {
        assemblyName: 'TestCalculator',
      })
      await runtime.loadAssembly('TestCalculator.dll')
    })

    it('invokes a method and returns result', async () => {
      const request: DotNetInvocationRequest = {
        assembly: 'TestCalculator',
        typeName: 'Calculator',
        methodName: 'Add',
        args: [5, 3],
      }

      const response = await runtime.invoke<number>(request)
      expect(response.result).toBe(8)
    })

    it('returns execution time', async () => {
      const request: DotNetInvocationRequest = {
        assembly: 'TestCalculator',
        typeName: 'Calculator',
        methodName: 'Add',
        args: [1, 2],
      }

      const response = await runtime.invoke<number>(request)
      expect(response.executionTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('returns worker ID', async () => {
      const request: DotNetInvocationRequest = {
        assembly: 'TestCalculator',
        typeName: 'Calculator',
        methodName: 'Add',
        args: [1, 2],
      }

      const response = await runtime.invoke<number>(request)
      expect(response.workerId).toBeDefined()
    })

    it('handles multiple concurrent invocations', async () => {
      const requests = Array(10)
        .fill(null)
        .map((_, i) => ({
          assembly: 'TestCalculator',
          typeName: 'Calculator',
          methodName: 'Multiply',
          args: [i, 2],
        }))

      const responses = await Promise.all(requests.map((r) => runtime.invoke<number>(r)))

      expect(responses).toHaveLength(10)
      responses.forEach((resp, i) => {
        expect(resp.result).toBe(i * 2)
      })
    })

    it('handles type not found error', async () => {
      const request: DotNetInvocationRequest = {
        assembly: 'TestCalculator',
        typeName: 'NonExistentClass',
        methodName: 'Method',
        args: [],
      }

      await expect(runtime.invoke(request)).rejects.toThrow()
    })

    it('handles method not found error', async () => {
      const request: DotNetInvocationRequest = {
        assembly: 'TestCalculator',
        typeName: 'Calculator',
        methodName: 'NonExistentMethod',
        args: [],
      }

      await expect(runtime.invoke(request)).rejects.toThrow()
    })

    it('handles runtime exceptions', async () => {
      const request: DotNetInvocationRequest = {
        assembly: 'TestCalculator',
        typeName: 'Calculator',
        methodName: 'Divide',
        args: [10, 0],
      }

      await expect(runtime.invoke(request)).rejects.toThrow()
    })

    it('respects timeout option', async () => {
      const code = `
public class SlowService
{
    public static void SlowMethod()
    {
        System.Threading.Thread.Sleep(10000);
    }
}
`
      await compileCSharpToAssembly(code, { assemblyName: 'SlowService' })
      await runtime.loadAssembly('SlowService.dll')

      const request: DotNetInvocationRequest = {
        assembly: 'SlowService',
        typeName: 'SlowService',
        methodName: 'SlowMethod',
        args: [],
        timeoutMs: 100,
      }

      await expect(runtime.invoke(request)).rejects.toThrow()
    })

    it('returns GC statistics', async () => {
      const request: DotNetInvocationRequest = {
        assembly: 'TestCalculator',
        typeName: 'Calculator',
        methodName: 'Add',
        args: [1, 2],
      }

      const response = await runtime.invoke<number>(request)

      expect(response.gcStats).toBeDefined()
      expect(response.gcStats?.gen0Collections).toBeGreaterThanOrEqual(0)
      expect(response.gcStats?.totalMemory).toBeGreaterThan(0)
    })

    it('captures console output', async () => {
      const code = `
using System;

public class ConsoleService
{
    public static void PrintMessage()
    {
        Console.WriteLine("Hello from .NET!");
    }
}
`
      await compileCSharpToAssembly(code, { assemblyName: 'ConsoleService' })
      await runtime.loadAssembly('ConsoleService.dll')

      const request: DotNetInvocationRequest = {
        assembly: 'ConsoleService',
        typeName: 'ConsoleService',
        methodName: 'PrintMessage',
        args: [],
      }

      const response = await runtime.invoke(request)
      expect(response.consoleOutput).toContain('Hello from .NET!')
    })
  })

  describe('loadAssembly', () => {
    it('loads assembly and returns metadata', async () => {
      const code = `
public class TestClass
{
    public static int Method() => 42;
}
`
      const compiled = await compileCSharpToAssembly(code, {
        assemblyName: 'LoadTest',
      })

      const metadata = await runtime.loadAssembly(compiled.assemblyPath)

      expect(metadata.name).toBe('LoadTest')
      expect(metadata.version).toBeDefined()
      expect(metadata.exportedTypes).toContain('TestClass')
    })

    it('handles assembly not found', async () => {
      await expect(runtime.loadAssembly('/nonexistent/path.dll')).rejects.toThrow()
    })

    it('caches loaded assemblies', async () => {
      const code = `public class CacheTest { }`
      const compiled = await compileCSharpToAssembly(code, { assemblyName: 'CacheTest' })

      // Load twice
      await runtime.loadAssembly(compiled.assemblyPath)
      await runtime.loadAssembly(compiled.assemblyPath)

      // Should only have one entry
      const assemblies = runtime.getLoadedAssemblies()
      const cacheTestAssemblies = assemblies.filter((a) => a.name === 'CacheTest')
      expect(cacheTestAssemblies).toHaveLength(1)
    })
  })

  describe('getLoadedAssemblies', () => {
    it('returns list of loaded assemblies', async () => {
      const assemblies = runtime.getLoadedAssemblies()

      expect(Array.isArray(assemblies)).toBe(true)
      // Should have at least system assemblies
      expect(assemblies.length).toBeGreaterThan(0)
    })

    it('includes assembly metadata', async () => {
      const code = `public class MetadataTest { }`
      const compiled = await compileCSharpToAssembly(code, { assemblyName: 'MetadataTest' })
      await runtime.loadAssembly(compiled.assemblyPath)

      const assemblies = runtime.getLoadedAssemblies()
      const testAssembly = assemblies.find((a) => a.name === 'MetadataTest')

      expect(testAssembly).toBeDefined()
      expect(testAssembly?.version).toBeDefined()
      expect(testAssembly?.targetFramework).toBeDefined()
    })
  })

  describe('getWorkers', () => {
    it('returns list of workers', () => {
      const workers = runtime.getWorkers()

      expect(Array.isArray(workers)).toBe(true)
      expect(workers.length).toBeGreaterThan(0)
    })

    it('returns worker information', () => {
      const workers = runtime.getWorkers()
      const worker = workers[0]

      expect(worker.id).toBeDefined()
      expect(worker.pid).toBeGreaterThan(0)
      expect(worker.state).toBeDefined()
      expect(worker.runtimeVersion).toBeDefined()
      expect(worker.memoryUsage).toBeGreaterThanOrEqual(0)
      expect(worker.createdAt).toBeInstanceOf(Date)
    })
  })

  describe('createSnapshot/restoreSnapshot', () => {
    beforeEach(async () => {
      const code = `
public class SnapshotTest
{
    private static int _counter = 0;
    public static int Increment() => ++_counter;
    public static int GetCounter() => _counter;
}
`
      await compileCSharpToAssembly(code, { assemblyName: 'SnapshotTest' })
      await runtime.loadAssembly('SnapshotTest.dll')
    })

    it('creates memory snapshot', async () => {
      // Initialize some state
      await runtime.invoke({
        assembly: 'SnapshotTest',
        typeName: 'SnapshotTest',
        methodName: 'Increment',
        args: [],
      })

      const snapshot = await runtime.createSnapshot('SnapshotTest')

      expect(snapshot.id).toBeDefined()
      expect(snapshot.assembly).toBe('SnapshotTest')
      expect(snapshot.data).toBeInstanceOf(Uint8Array)
      expect(snapshot.size).toBeGreaterThan(0)
      expect(snapshot.createdAt).toBeInstanceOf(Date)
    })

    it('restores from snapshot', async () => {
      // Set counter to 5
      for (let i = 0; i < 5; i++) {
        await runtime.invoke({
          assembly: 'SnapshotTest',
          typeName: 'SnapshotTest',
          methodName: 'Increment',
          args: [],
        })
      }

      const snapshot = await runtime.createSnapshot('SnapshotTest')

      // Increment more
      for (let i = 0; i < 3; i++) {
        await runtime.invoke({
          assembly: 'SnapshotTest',
          typeName: 'SnapshotTest',
          methodName: 'Increment',
          args: [],
        })
      }

      // Restore should return worker ID
      const workerId = await runtime.restoreSnapshot(snapshot)
      expect(workerId).toBeDefined()

      // Counter should be back to 5
      const response = await runtime.invoke<number>({
        assembly: 'SnapshotTest',
        typeName: 'SnapshotTest',
        methodName: 'GetCounter',
        args: [],
      })
      expect(response.result).toBe(5)
    })
  })

  describe('shutdown', () => {
    it('shuts down all workers', async () => {
      await runtime.shutdown()

      const workers = runtime.getWorkers()
      expect(workers.every((w) => w.state === 'stopped')).toBe(true)
    })

    it('completes without error', async () => {
      await expect(runtime.shutdown()).resolves.not.toThrow()
    })
  })
})

describe('C# Compilation', () => {
  describe('compileCSharpToAssembly', () => {
    it('compiles simple class', async () => {
      const code = `
public class SimpleClass
{
    public static int GetValue() => 42;
}
`
      const result = await compileCSharpToAssembly(code, {
        assemblyName: 'SimpleAssembly',
      })

      expect(result.assemblyPath).toBeDefined()
      expect(result.assemblyPath).toContain('.dll')
      expect(result.metadata.name).toBe('SimpleAssembly')
    })

    it('returns assembly metadata', async () => {
      const code = `
public class MetadataClass
{
    public void Method() { }
}
`
      const result = await compileCSharpToAssembly(code)

      expect(result.metadata.exportedTypes).toContain('MetadataClass')
      expect(result.metadata.version).toBeDefined()
      expect(result.metadata.targetFramework).toBeDefined()
    })

    it('returns compilation diagnostics', async () => {
      const code = `
public class WarningClass
{
    public void Method()
    {
        int unused = 42; // Should generate warning
    }
}
`
      const result = await compileCSharpToAssembly(code)

      const warnings = result.diagnostics.filter((d) => d.severity === 'warning')
      expect(warnings.length).toBeGreaterThan(0)
    })

    it('fails on compilation errors', async () => {
      const code = `
public class BrokenClass
{
    public void Method() => undefined_variable;
}
`
      await expect(compileCSharpToAssembly(code)).rejects.toThrow()
    })

    it('supports custom references', async () => {
      const code = `
using System.Text.Json;

public class JsonClass
{
    public static string Serialize(object obj) => JsonSerializer.Serialize(obj);
}
`
      const result = await compileCSharpToAssembly(code, {
        references: ['System.Text.Json'],
      })

      expect(result.assemblyPath).toBeDefined()
    })

    it('supports optimization flag', async () => {
      const code = `public class OptClass { }`
      const result = await compileCSharpToAssembly(code, {
        optimize: true,
      })

      expect(result.assemblyPath).toBeDefined()
    })

    it('supports custom output path', async () => {
      const code = `public class OutputClass { }`
      const result = await compileCSharpToAssembly(code, {
        outputPath: '/tmp/custom-output',
        assemblyName: 'CustomOutput',
      })

      expect(result.assemblyPath).toContain('/tmp/custom-output')
    })
  })
})

describe('.NET Worker Management', () => {
  describe('spawnDotNetWorker', () => {
    let worker: DotNetWorker

    afterEach(async () => {
      if (worker) {
        await terminateWorker(worker.id)
      }
    })

    it('spawns a new worker', async () => {
      worker = await spawnDotNetWorker()

      expect(worker.id).toBeDefined()
      expect(worker.pid).toBeGreaterThan(0)
      expect(worker.state).toBe('ready')
    })

    it('spawns worker with custom config', async () => {
      worker = await spawnDotNetWorker({
        runtimeVersion: 'net8.0',
        maxMemoryMb: 256,
        gcMode: 'workstation',
      })

      expect(worker.runtimeVersion).toContain('8.0')
    })

    it('initializes worker metadata', async () => {
      worker = await spawnDotNetWorker()

      expect(worker.loadedAssemblies).toBeDefined()
      expect(Array.isArray(worker.loadedAssemblies)).toBe(true)
      expect(worker.invocationCount).toBe(0)
      expect(worker.createdAt).toBeInstanceOf(Date)
    })
  })

  describe('terminateWorker', () => {
    it('terminates a running worker', async () => {
      const worker = await spawnDotNetWorker()
      await terminateWorker(worker.id)

      // Verify worker is terminated by trying to check health
      const health = await checkWorkerHealth(worker.id)
      expect(health.healthy).toBe(false)
    })

    it('handles non-existent worker gracefully', async () => {
      await expect(terminateWorker('non-existent-id')).resolves.not.toThrow()
    })
  })

  describe('checkWorkerHealth', () => {
    let worker: DotNetWorker

    beforeEach(async () => {
      worker = await spawnDotNetWorker()
    })

    afterEach(async () => {
      await terminateWorker(worker.id)
    })

    it('returns health status for healthy worker', async () => {
      const health = await checkWorkerHealth(worker.id)

      expect(health.healthy).toBe(true)
      expect(health.latencyMs).toBeGreaterThanOrEqual(0)
      expect(health.memoryUsage).toBeGreaterThan(0)
    })

    it('returns unhealthy for non-existent worker', async () => {
      const health = await checkWorkerHealth('non-existent-id')

      expect(health.healthy).toBe(false)
      expect(health.errorMessage).toBeDefined()
    })
  })
})

describe('.NET Runtime Info', () => {
  describe('getDotNetRuntimeInfo', () => {
    it('returns runtime information', async () => {
      const info = await getDotNetRuntimeInfo()

      expect(info.version).toBeDefined()
      expect(info.runtimeIdentifier).toBeDefined()
      expect(info.frameworkDescription).toBeDefined()
      expect(info.osDescription).toBeDefined()
      expect(info.processArchitecture).toBeDefined()
    })

    it('includes .NET version', async () => {
      const info = await getDotNetRuntimeInfo()

      expect(info.version).toMatch(/^\d+\.\d+/)
    })

    it('includes architecture', async () => {
      const info = await getDotNetRuntimeInfo()

      expect(['X64', 'X86', 'Arm', 'Arm64']).toContain(info.processArchitecture)
    })
  })
})

describe('.NET Worker Pool', () => {
  let pool: DotNetWorkerPool

  beforeEach(async () => {
    pool = createDotNetWorkerPool({
      runtimeVersion: 'net8.0',
      minWorkers: 2,
      maxWorkers: 5,
      idleTimeoutMs: 30000,
    })
    await pool.initialize()
  })

  afterEach(async () => {
    await pool.shutdown()
  })

  describe('createDotNetWorkerPool', () => {
    it('creates pool with config', () => {
      const p = createDotNetWorkerPool({
        runtimeVersion: 'net8.0',
        minWorkers: 1,
        maxWorkers: 10,
      })
      expect(p).toBeDefined()
    })
  })

  describe('initialize', () => {
    it('spawns minimum workers', async () => {
      const p = createDotNetWorkerPool({
        runtimeVersion: 'net8.0',
        minWorkers: 3,
      })
      await p.initialize()

      const stats = p.stats()
      expect(stats.total).toBeGreaterThanOrEqual(3)

      await p.shutdown()
    })
  })

  describe('acquire/release', () => {
    it('acquires a worker', async () => {
      const worker = await pool.acquire()

      expect(worker).toBeDefined()
      expect(worker.id).toBeDefined()
      expect(worker.state).toBe('busy')
    })

    it('releases a worker', async () => {
      const worker = await pool.acquire()
      const statsBefore = pool.stats()

      pool.release(worker.id)
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
      const ids = workers.map((w) => w.id)
      expect(new Set(ids).size).toBe(3) // All different IDs
    })
  })

  describe('stats', () => {
    it('returns pool statistics', () => {
      const stats = pool.stats()

      expect(typeof stats.total).toBe('number')
      expect(typeof stats.available).toBe('number')
      expect(typeof stats.busy).toBe('number')
      expect(typeof stats.pending).toBe('number')
    })

    it('tracks busy workers', async () => {
      const statsBefore = pool.stats()
      await pool.acquire()
      const statsAfter = pool.stats()

      expect(statsAfter.busy).toBe(statsBefore.busy + 1)
    })
  })

  describe('scale', () => {
    it('scales up the pool', async () => {
      const statsBefore = pool.stats()
      await pool.scale(statsBefore.total + 2)
      const statsAfter = pool.stats()

      expect(statsAfter.total).toBe(statsBefore.total + 2)
    })

    it('scales down the pool', async () => {
      await pool.scale(5)
      const statsBefore = pool.stats()
      await pool.scale(3)
      const statsAfter = pool.stats()

      expect(statsAfter.total).toBe(3)
      expect(statsAfter.total).toBeLessThan(statsBefore.total)
    })

    it('respects minimum workers', async () => {
      // Pool has minWorkers: 2
      await pool.scale(1)
      const stats = pool.stats()

      expect(stats.total).toBeGreaterThanOrEqual(2)
    })

    it('respects maximum workers', async () => {
      // Pool has maxWorkers: 5
      await pool.scale(10)
      const stats = pool.stats()

      expect(stats.total).toBeLessThanOrEqual(5)
    })
  })

  describe('shutdown', () => {
    it('terminates all workers', async () => {
      await pool.shutdown()
      const stats = pool.stats()

      expect(stats.total).toBe(0)
      expect(stats.available).toBe(0)
      expect(stats.busy).toBe(0)
    })
  })
})
