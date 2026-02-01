/**
 * Code Functions Executor Tests (RED Phase - TDD)
 *
 * These tests validate the CodeExecutor functionality for the Code Functions tier.
 * The CodeExecutor is responsible for:
 * - Executing user code in sandboxed environments (Worker Loader, WASM, ai-evaluate)
 * - Enforcing timeouts (default 5 seconds)
 * - Supporting multiple languages (TypeScript, JavaScript, Rust, Python, Go, etc.)
 * - Managing sandbox configuration (deterministic mode, memory limits, network allowlist)
 * - Tracking execution metrics (language, isolate type, memory, CPU, compilation time)
 * - Handling errors gracefully with stack traces
 * - Caching compiled code by content hash
 * - Loading code from various sources (inline, R2, URL, registry)
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the implementation does not exist yet.
 *
 * Test setup uses @cloudflare/vitest-pool-workers with miniflare
 * for realistic Cloudflare Workers environment testing.
 *
 * @module tiers/code-executor.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { env } from 'cloudflare:test'

// Import types from core
import type {
  CodeFunctionDefinition,
  CodeFunctionConfig,
  CodeFunctionResult,
  CodeLanguage,
  CodeSource,
  SandboxConfig,
  CodeExecutionInfo,
} from '../../../core/src/code/index.js'
import { defineCodeFunction, inlineFunction } from '../../../core/src/code/index.js'

// Import the executor that doesn't exist yet - this will cause the tests to fail
import { CodeExecutor } from '../code-executor.js'

// ============================================================================
// Mock Types and Utilities
// ============================================================================

/**
 * Mock environment bindings for testing
 */
interface TestEnv {
  LOADER?: Fetcher
  CODE_STORAGE?: R2Bucket
  FUNCTION_REGISTRY?: KVNamespace
  AI_EVALUATE?: Fetcher
}

/**
 * Mock ai-evaluate service
 */
function createMockAiEvaluate(): Fetcher {
  const fetchHandler = async (request: Request): Promise<Response> => {
    const body = await request.json() as { code: string; input?: unknown }

    // Simulate code execution
    try {
      // Return mock successful execution
      return new Response(
        JSON.stringify({
          success: true,
          output: { evaluated: true, input: body.input },
          metrics: {
            durationMs: 10,
            memoryUsedBytes: 1024,
            cpuTimeMs: 5,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    } catch (error) {
      return new Response(
        JSON.stringify({ success: false, error: String(error) }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }

  return { fetch: fetchHandler } as unknown as Fetcher
}

/**
 * Mock worker loader service
 */
function createMockWorkerLoader(): Fetcher {
  const fetchHandler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const action = url.pathname.split('/').pop()

    if (action === 'load') {
      return new Response(
        JSON.stringify({ loaded: true, isolateId: 'mock-isolate-123' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'execute') {
      return new Response(
        JSON.stringify({ output: { result: 'executed' }, metrics: {} }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response('Not found', { status: 404 })
  }

  return { fetch: fetchHandler } as unknown as Fetcher
}

/**
 * Mock R2 bucket for code storage
 */
function createMockR2Bucket(): R2Bucket {
  const storage = new Map<string, string>()

  return {
    get: async (key: string) => {
      const value = storage.get(key)
      if (!value) return null
      return {
        text: async () => value,
        json: async () => JSON.parse(value),
        arrayBuffer: async () => new TextEncoder().encode(value).buffer,
        body: new ReadableStream(),
      } as unknown as R2ObjectBody
    },
    put: async (key: string, value: string | ArrayBuffer | ReadableStream) => {
      if (typeof value === 'string') {
        storage.set(key, value)
      }
    },
    delete: async (key: string) => {
      storage.delete(key)
    },
    list: async () => ({ objects: [], truncated: false }),
    head: async () => null,
    createMultipartUpload: async () => { throw new Error('Not implemented') },
    resumeMultipartUpload: () => { throw new Error('Not implemented') },
  } as unknown as R2Bucket
}

/**
 * Create a test code function definition
 */
function createTestCodeFunction<TInput = unknown, TOutput = unknown>(
  id: string,
  code: string,
  options: {
    language?: CodeLanguage
    sandbox?: SandboxConfig
    config?: CodeFunctionConfig
    timeout?: string
  } = {}
): CodeFunctionDefinition<TInput, TOutput> {
  return defineCodeFunction({
    id,
    name: id,
    version: '1.0.0',
    language: options.language ?? 'typescript',
    source: { type: 'inline', code },
    sandbox: options.sandbox,
    defaultConfig: options.config,
    timeout: options.timeout ?? '5s',
  })
}

// ============================================================================
// Test Suites
// ============================================================================

describe('CodeExecutor', () => {
  let executor: CodeExecutor
  let mockEnv: TestEnv
  let mockAiEvaluate: Fetcher
  let mockWorkerLoader: Fetcher

  beforeEach(() => {
    vi.clearAllMocks()

    mockAiEvaluate = createMockAiEvaluate()
    mockWorkerLoader = createMockWorkerLoader()

    mockEnv = {
      AI_EVALUATE: mockAiEvaluate,
      LOADER: mockWorkerLoader,
      CODE_STORAGE: createMockR2Bucket(),
    }

    executor = new CodeExecutor(mockEnv)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. Execution Basics
  // ==========================================================================

  describe('Execution Basics', () => {
    it('should execute inline TypeScript code', async () => {
      const fn = createTestCodeFunction<{ x: number }, { doubled: number }>(
        'double-ts',
        `
          export default function handler(input: { x: number }) {
            return { doubled: input.x * 2 };
          }
        `,
        { language: 'typescript' }
      )

      const result = await executor.execute(fn, { x: 5 })

      expect(result).toBeDefined()
      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ doubled: 10 })
    })

    it('should execute inline JavaScript code', async () => {
      const fn = createTestCodeFunction<{ name: string }, { greeting: string }>(
        'greet-js',
        `
          export default function handler(input) {
            return { greeting: 'Hello, ' + input.name + '!' };
          }
        `,
        { language: 'javascript' }
      )

      const result = await executor.execute(fn, { name: 'World' })

      expect(result).toBeDefined()
      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ greeting: 'Hello, World!' })
    })

    it('should return CodeFunctionResult with output', async () => {
      const fn = createTestCodeFunction<void, { value: number }>(
        'return-value',
        `
          export default function handler() {
            return { value: 42 };
          }
        `
      )

      const result = await executor.execute(fn, undefined)

      expect(result).toBeDefined()
      expect(result.functionId).toBe('return-value')
      expect(result.functionVersion).toBe('1.0.0')
      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ value: 42 })
      expect(result.codeExecution).toBeDefined()
    })

    it('should pass input to function', async () => {
      const fn = createTestCodeFunction<{ a: number; b: number }, { sum: number }>(
        'add-numbers',
        `
          export default function handler(input) {
            return { sum: input.a + input.b };
          }
        `
      )

      const result = await executor.execute(fn, { a: 10, b: 20 })

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ sum: 30 })
    })

    it('should handle async functions', async () => {
      const fn = createTestCodeFunction<{ delay: number }, { completed: boolean }>(
        'async-fn',
        `
          export default async function handler(input) {
            await new Promise(r => setTimeout(r, input.delay));
            return { completed: true };
          }
        `
      )

      const result = await executor.execute(fn, { delay: 10 })

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ completed: true })
    })

    it('should support generator functions', async () => {
      const fn = createTestCodeFunction<{ count: number }, number[]>(
        'generator-fn',
        `
          function* generateNumbers(n) {
            for (let i = 1; i <= n; i++) yield i;
          }
          export default function handler(input) {
            return Array.from(generateNumbers(input.count));
          }
        `
      )

      const result = await executor.execute(fn, { count: 5 })

      expect(result.status).toBe('completed')
      expect(result.output).toEqual([1, 2, 3, 4, 5])
    })
  })

  // ==========================================================================
  // 2. Timeout Enforcement
  // ==========================================================================

  describe('Timeout Enforcement', () => {
    it('should enforce 5s default timeout', async () => {
      const fn = createTestCodeFunction(
        'infinite-loop',
        `
          export default function handler() {
            while (true) {} // Infinite loop
            return { never: 'reached' };
          }
        `
        // No explicit timeout - should use 5s default
      )

      const startTime = Date.now()
      const result = await executor.execute(fn, {})
      const elapsed = Date.now() - startTime

      expect(result.status).toBe('timeout')
      expect(result.error).toBeDefined()
      expect(result.error?.message).toMatch(/timeout/i)
      // Should timeout around 5 seconds (with some buffer for execution overhead)
      expect(elapsed).toBeLessThan(6000)
      expect(elapsed).toBeGreaterThanOrEqual(4500)
    })

    it('should respect custom timeout in config', async () => {
      const fn = createTestCodeFunction(
        'short-timeout',
        `
          export default async function handler() {
            await new Promise(r => setTimeout(r, 2000));
            return { completed: true };
          }
        `,
        { timeout: '500ms' }
      )

      const startTime = Date.now()
      const result = await executor.execute(fn, {})
      const elapsed = Date.now() - startTime

      expect(result.status).toBe('timeout')
      expect(elapsed).toBeLessThan(1000)
      expect(elapsed).toBeGreaterThanOrEqual(400)
    })

    it('should return timeout error with execution info', async () => {
      const fn = createTestCodeFunction(
        'timeout-info',
        `
          export default async function handler() {
            await new Promise(r => setTimeout(r, 10000));
            return {};
          }
        `,
        { timeout: '100ms' }
      )

      const result = await executor.execute(fn, {})

      expect(result.status).toBe('timeout')
      expect(result.error).toMatchObject({
        name: expect.stringMatching(/TimeoutError|ExecutionTimeout/),
        message: expect.stringContaining('timeout'),
      })
      expect(result.codeExecution).toBeDefined()
      expect(result.codeExecution.cpuTimeMs).toBeGreaterThanOrEqual(0)
      expect(result.metrics.durationMs).toBeGreaterThanOrEqual(100)
    })

    it('should complete execution within timeout', async () => {
      const fn = createTestCodeFunction(
        'fast-fn',
        `
          export default function handler() {
            return { fast: true };
          }
        `,
        { timeout: '5s' }
      )

      const result = await executor.execute(fn, {})

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ fast: true })
      expect(result.metrics.durationMs).toBeLessThan(5000)
    })

    it('should support millisecond timeout format', async () => {
      const fn = createTestCodeFunction(
        'ms-timeout',
        `
          export default async function handler() {
            await new Promise(r => setTimeout(r, 500));
            return {};
          }
        `,
        { timeout: '100ms' }
      )

      const result = await executor.execute(fn, {})

      expect(result.status).toBe('timeout')
    })

    it('should support second timeout format', async () => {
      const fn = createTestCodeFunction(
        'second-timeout',
        `
          export default async function handler() {
            await new Promise(r => setTimeout(r, 3000));
            return {};
          }
        `,
        { timeout: '1s' }
      )

      const result = await executor.execute(fn, {})

      expect(result.status).toBe('timeout')
    })
  })

  // ==========================================================================
  // 3. Language Support
  // ==========================================================================

  describe('Language Support', () => {
    it('should dispatch TypeScript to TS compiler', async () => {
      const fn = createTestCodeFunction<{ value: number }, { typed: string }>(
        'ts-typed',
        `
          interface Input { value: number }
          interface Output { typed: string }
          export default function handler(input: Input): Output {
            const result: string = String(input.value);
            return { typed: result };
          }
        `,
        { language: 'typescript' }
      )

      const result = await executor.execute(fn, { value: 123 })

      expect(result.status).toBe('completed')
      expect(result.codeExecution.language).toBe('typescript')
      expect(result.output).toEqual({ typed: '123' })
    })

    it('should dispatch Rust to WASM compiler', async () => {
      const fn = createTestCodeFunction<{ n: number }, { factorial: number }>(
        'rust-factorial',
        `
          #[no_mangle]
          pub extern "C" fn handler(n: i32) -> i32 {
              if n <= 1 { 1 } else { n * handler(n - 1) }
          }
        `,
        { language: 'rust' }
      )

      const result = await executor.execute(fn, { n: 5 })

      expect(result.status).toBe('completed')
      expect(result.codeExecution.language).toBe('rust')
      expect(result.codeExecution.isolateType).toBe('wasm')
      expect(result.output).toEqual({ factorial: 120 })
    })

    it('should dispatch Python to Pyodide', async () => {
      const fn = createTestCodeFunction<{ items: string[] }, { sorted: string[] }>(
        'python-sort',
        `
          def handler(input):
              return {"sorted": sorted(input["items"])}
        `,
        { language: 'python' }
      )

      const result = await executor.execute(fn, { items: ['c', 'a', 'b'] })

      expect(result.status).toBe('completed')
      expect(result.codeExecution.language).toBe('python')
      expect(result.output).toEqual({ sorted: ['a', 'b', 'c'] })
    })

    it('should dispatch Go to TinyGo WASM', async () => {
      const fn = createTestCodeFunction<{ text: string }, { upper: string }>(
        'go-upper',
        `
          package main

          import "strings"

          //export handler
          func handler(text string) string {
              return strings.ToUpper(text)
          }

          func main() {}
        `,
        { language: 'go' }
      )

      const result = await executor.execute(fn, { text: 'hello' })

      expect(result.status).toBe('completed')
      expect(result.codeExecution.language).toBe('go')
      expect(result.codeExecution.isolateType).toBe('wasm')
      expect(result.output).toEqual({ upper: 'HELLO' })
    })

    it('should throw for unsupported language', async () => {
      const fn = createTestCodeFunction(
        'unsupported-lang',
        'print("hello")',
        { language: 'cobol' as CodeLanguage }
      )

      await expect(executor.execute(fn, {})).rejects.toThrow(/unsupported language/i)
    })

    it('should support AssemblyScript', async () => {
      const fn = createTestCodeFunction<{ a: number; b: number }, { product: number }>(
        'asc-multiply',
        `
          export function handler(a: i32, b: i32): i32 {
            return a * b;
          }
        `,
        { language: 'assemblyscript' }
      )

      const result = await executor.execute(fn, { a: 7, b: 6 })

      expect(result.status).toBe('completed')
      expect(result.codeExecution.language).toBe('assemblyscript')
      expect(result.codeExecution.isolateType).toBe('wasm')
    })

    it('should support Zig', async () => {
      const fn = createTestCodeFunction<{ x: number }, { squared: number }>(
        'zig-square',
        `
          export fn handler(x: i32) i32 {
              return x * x;
          }
        `,
        { language: 'zig' }
      )

      const result = await executor.execute(fn, { x: 9 })

      expect(result.status).toBe('completed')
      expect(result.codeExecution.language).toBe('zig')
      expect(result.codeExecution.isolateType).toBe('wasm')
    })

    it('should support C#', async () => {
      const fn = createTestCodeFunction<{ name: string }, { greeting: string }>(
        'csharp-greet',
        `
          using System;
          public class Handler {
              public static string Execute(string name) {
                  return $"Hello, {name}!";
              }
          }
        `,
        { language: 'csharp' }
      )

      const result = await executor.execute(fn, { name: 'Developer' })

      expect(result.status).toBe('completed')
      expect(result.codeExecution.language).toBe('csharp')
    })
  })

  // ==========================================================================
  // 4. Sandbox Configuration
  // ==========================================================================

  describe('Sandbox Configuration', () => {
    it('should respect deterministic mode (no Math.random)', async () => {
      const fn = createTestCodeFunction<void, { random1: number; random2: number }>(
        'deterministic-random',
        `
          export default function handler() {
            return {
              random1: Math.random(),
              random2: Math.random()
            };
          }
        `,
        {
          sandbox: { deterministic: true },
        }
      )

      // Execute twice and expect same results in deterministic mode
      const result1 = await executor.execute(fn, undefined)
      const result2 = await executor.execute(fn, undefined)

      expect(result1.status).toBe('completed')
      expect(result2.status).toBe('completed')
      expect(result1.output).toEqual(result2.output)
      expect(result1.codeExecution.deterministic).toBe(true)
    })

    it('should respect deterministic mode (fixed Date)', async () => {
      const fn = createTestCodeFunction<void, { timestamp: number }>(
        'deterministic-date',
        `
          export default function handler() {
            return { timestamp: Date.now() };
          }
        `,
        {
          sandbox: { deterministic: true },
        }
      )

      const result1 = await executor.execute(fn, undefined)

      // Wait a bit
      await new Promise(r => setTimeout(r, 100))

      const result2 = await executor.execute(fn, undefined)

      expect(result1.status).toBe('completed')
      expect(result2.status).toBe('completed')
      // In deterministic mode, Date.now() should return fixed value
      expect(result1.output).toEqual(result2.output)
      expect(result1.codeExecution.deterministic).toBe(true)
    })

    it('should respect memory limits', async () => {
      const fn = createTestCodeFunction<void, void>(
        'memory-hog',
        `
          export default function handler() {
            // Try to allocate a large array
            const arr = new Array(100 * 1024 * 1024).fill(0);
            return arr.length;
          }
        `,
        {
          config: { memoryLimitMb: 10 },
        }
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('failed')
      expect(result.error?.message).toMatch(/memory|limit|exceeded/i)
    })

    it('should respect CPU limits', async () => {
      const fn = createTestCodeFunction<void, void>(
        'cpu-intensive',
        `
          export default function handler() {
            let sum = 0;
            for (let i = 0; i < 1e10; i++) {
              sum += i;
            }
            return sum;
          }
        `,
        {
          config: { cpuLimitMs: 100 },
        }
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('failed')
      expect(result.error?.message).toMatch(/cpu|limit|exceeded/i)
    })

    it('should respect network allowlist', async () => {
      const fn = createTestCodeFunction<void, unknown>(
        'network-restricted',
        `
          export default async function handler() {
            // Should be blocked - not in allowlist
            const res = await fetch('https://evil.com/data');
            return res.json();
          }
        `,
        {
          config: {
            networkEnabled: true,
            networkAllowlist: ['api.example.com', 'safe.com'],
          },
        }
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('failed')
      expect(result.error?.message).toMatch(/network|blocked|allowlist|forbidden/i)
    })

    it('should allow network access to allowlisted domains', async () => {
      const fn = createTestCodeFunction<void, { fetched: boolean }>(
        'network-allowed',
        `
          export default async function handler() {
            const res = await fetch('https://api.example.com/data');
            return { fetched: res.ok };
          }
        `,
        {
          config: {
            networkEnabled: true,
            networkAllowlist: ['api.example.com'],
          },
        }
      )

      const result = await executor.execute(fn, undefined)

      // Should succeed (or fail for other reasons, not network blocking)
      if (result.status === 'failed') {
        expect(result.error?.message).not.toMatch(/blocked|allowlist|forbidden/i)
      }
    })

    it('should block network when networkEnabled is false', async () => {
      const fn = createTestCodeFunction<void, unknown>(
        'network-disabled',
        `
          export default async function handler() {
            const res = await fetch('https://api.example.com/data');
            return res.json();
          }
        `,
        {
          config: { networkEnabled: false },
        }
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('failed')
      expect(result.error?.message).toMatch(/network|disabled|blocked/i)
    })

    it('should respect isolate type preference', async () => {
      const fn = createTestCodeFunction<void, { value: number }>(
        'wasm-isolate',
        `
          export default function handler() {
            return { value: 42 };
          }
        `,
        {
          sandbox: { isolate: 'wasm' },
        }
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('completed')
      expect(result.codeExecution.isolateType).toBe('wasm')
    })

    it('should respect worker-loader isolate type', async () => {
      const fn = createTestCodeFunction<void, { value: number }>(
        'worker-loader-isolate',
        `
          export default function handler() {
            return { value: 42 };
          }
        `,
        {
          sandbox: { isolate: 'worker-loader' },
        }
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('completed')
      expect(result.codeExecution.isolateType).toBe('worker-loader')
    })

    it('should limit allowed globals', async () => {
      const fn = createTestCodeFunction<void, void>(
        'limited-globals',
        `
          export default function handler() {
            // setTimeout should be blocked
            setTimeout(() => {}, 0);
            return {};
          }
        `,
        {
          sandbox: {
            allowedGlobals: ['console', 'JSON', 'Object', 'Array'],
          },
        }
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('failed')
      expect(result.error?.message).toMatch(/setTimeout|undefined|not.*defined/i)
    })
  })

  // ==========================================================================
  // 5. Execution Metrics
  // ==========================================================================

  describe('Execution Metrics', () => {
    it('should return codeExecution.language', async () => {
      const fn = createTestCodeFunction(
        'metrics-lang',
        'export default () => ({ ok: true })',
        { language: 'typescript' }
      )

      const result = await executor.execute(fn, {})

      expect(result.codeExecution).toBeDefined()
      expect(result.codeExecution.language).toBe('typescript')
    })

    it('should return codeExecution.isolateType', async () => {
      const fn = createTestCodeFunction(
        'metrics-isolate',
        'export default () => ({ ok: true })',
        { sandbox: { isolate: 'v8' } }
      )

      const result = await executor.execute(fn, {})

      expect(result.codeExecution).toBeDefined()
      expect(result.codeExecution.isolateType).toMatch(/^(v8|wasm|worker-loader)$/)
    })

    it('should return codeExecution.memoryUsedBytes', async () => {
      const fn = createTestCodeFunction(
        'metrics-memory',
        `
          export default function handler() {
            const arr = new Array(1000).fill('x');
            return { length: arr.length };
          }
        `
      )

      const result = await executor.execute(fn, {})

      expect(result.codeExecution).toBeDefined()
      expect(typeof result.codeExecution.memoryUsedBytes).toBe('number')
      expect(result.codeExecution.memoryUsedBytes).toBeGreaterThanOrEqual(0)
    })

    it('should return codeExecution.cpuTimeMs', async () => {
      const fn = createTestCodeFunction(
        'metrics-cpu',
        `
          export default function handler() {
            let sum = 0;
            for (let i = 0; i < 10000; i++) sum += i;
            return { sum };
          }
        `
      )

      const result = await executor.execute(fn, {})

      expect(result.codeExecution).toBeDefined()
      expect(typeof result.codeExecution.cpuTimeMs).toBe('number')
      expect(result.codeExecution.cpuTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('should return codeExecution.deterministic', async () => {
      const fn = createTestCodeFunction(
        'metrics-deterministic',
        'export default () => ({ ok: true })',
        { sandbox: { deterministic: true } }
      )

      const result = await executor.execute(fn, {})

      expect(result.codeExecution).toBeDefined()
      expect(result.codeExecution.deterministic).toBe(true)
    })

    it('should return codeExecution.compilationTimeMs for compiled languages', async () => {
      const fn = createTestCodeFunction(
        'metrics-compilation',
        `
          #[no_mangle]
          pub extern "C" fn handler() -> i32 { 42 }
        `,
        { language: 'rust' }
      )

      const result = await executor.execute(fn, {})

      expect(result.codeExecution).toBeDefined()
      expect(typeof result.codeExecution.compilationTimeMs).toBe('number')
      expect(result.codeExecution.compilationTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('should track metrics across multiple executions', async () => {
      const fn = createTestCodeFunction(
        'metrics-multi',
        'export default () => ({ ok: true })'
      )

      const results = await Promise.all([
        executor.execute(fn, {}),
        executor.execute(fn, {}),
        executor.execute(fn, {}),
      ])

      results.forEach(result => {
        expect(result.codeExecution).toBeDefined()
        expect(result.codeExecution.cpuTimeMs).toBeGreaterThanOrEqual(0)
        expect(result.codeExecution.memoryUsedBytes).toBeGreaterThanOrEqual(0)
      })
    })

    it('should include metrics in base FunctionResult', async () => {
      const fn = createTestCodeFunction(
        'metrics-base',
        'export default () => ({ ok: true })'
      )

      const result = await executor.execute(fn, {})

      expect(result.metrics).toBeDefined()
      expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0)
      expect(typeof result.metrics.inputSizeBytes).toBe('number')
      expect(typeof result.metrics.outputSizeBytes).toBe('number')
    })
  })

  // ==========================================================================
  // 6. Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('should catch and wrap execution errors', async () => {
      const fn = createTestCodeFunction(
        'error-throw',
        `
          export default function handler() {
            throw new Error('Intentional error');
          }
        `
      )

      const result = await executor.execute(fn, {})

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.name).toBe('Error')
      expect(result.error?.message).toContain('Intentional error')
    })

    it('should include stack trace in error', async () => {
      const fn = createTestCodeFunction(
        'error-stack',
        `
          function innerFunction() {
            throw new Error('Deep error');
          }
          function middleFunction() {
            innerFunction();
          }
          export default function handler() {
            middleFunction();
          }
        `
      )

      const result = await executor.execute(fn, {})

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.stack).toBeDefined()
      expect(result.error?.stack).toContain('innerFunction')
      expect(result.error?.stack).toContain('middleFunction')
    })

    it('should return partial result on soft failure', async () => {
      const fn = createTestCodeFunction<void, { partial: boolean; complete?: boolean }>(
        'partial-result',
        `
          export default function handler() {
            const result = { partial: true };
            // Simulating a soft failure after partial work
            throw Object.assign(
              new Error('Soft failure'),
              { partialResult: result, retryable: true }
            );
          }
        `
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.retryable).toBe(true)
      // Partial output should be preserved
      expect(result.output).toBeDefined()
      expect(result.output).toEqual({ partial: true })
    })

    it('should handle syntax errors gracefully', async () => {
      const fn = createTestCodeFunction(
        'syntax-error',
        `
          export default function handler() {
            return { value: 1 // Missing closing brace
          }
        `
      )

      const result = await executor.execute(fn, {})

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.message).toMatch(/syntax|parse|unexpected/i)
    })

    it('should handle TypeError', async () => {
      const fn = createTestCodeFunction(
        'type-error',
        `
          export default function handler() {
            const obj = null;
            return obj.property; // TypeError
          }
        `
      )

      const result = await executor.execute(fn, {})

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.name).toMatch(/TypeError/i)
    })

    it('should handle ReferenceError', async () => {
      const fn = createTestCodeFunction(
        'reference-error',
        `
          export default function handler() {
            return undefinedVariable; // ReferenceError
          }
        `
      )

      const result = await executor.execute(fn, {})

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.message).toMatch(/not defined|undefined/i)
    })

    it('should handle promise rejections', async () => {
      const fn = createTestCodeFunction(
        'promise-rejection',
        `
          export default async function handler() {
            return Promise.reject(new Error('Async rejection'));
          }
        `
      )

      const result = await executor.execute(fn, {})

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('Async rejection')
    })

    it('should handle thrown non-Error objects', async () => {
      const fn = createTestCodeFunction(
        'throw-string',
        `
          export default function handler() {
            throw 'String error message';
          }
        `
      )

      const result = await executor.execute(fn, {})

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('String error message')
    })

    it('should include error code when available', async () => {
      const fn = createTestCodeFunction(
        'error-code',
        `
          export default function handler() {
            const error = new Error('Network failure');
            error.code = 'ECONNREFUSED';
            throw error;
          }
        `
      )

      const result = await executor.execute(fn, {})

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('ECONNREFUSED')
    })
  })

  // ==========================================================================
  // 7. Caching
  // ==========================================================================

  describe('Caching', () => {
    it('should cache compiled code by content hash', async () => {
      const code = `
        export default function handler(input) {
          return { value: input.x * 2 };
        }
      `

      const fn = createTestCodeFunction('cached-fn', code)

      // First execution - should compile
      const result1 = await executor.execute(fn, { x: 5 })
      const compilationTime1 = result1.codeExecution.compilationTimeMs

      // Second execution - should use cache
      const result2 = await executor.execute(fn, { x: 10 })
      const compilationTime2 = result2.codeExecution.compilationTimeMs

      expect(result1.status).toBe('completed')
      expect(result2.status).toBe('completed')
      expect(result1.output).toEqual({ value: 10 })
      expect(result2.output).toEqual({ value: 20 })

      // Second execution should be faster (or have 0 compilation time if cached)
      if (compilationTime1 !== undefined && compilationTime2 !== undefined) {
        expect(compilationTime2).toBeLessThanOrEqual(compilationTime1)
      }
    })

    it('should invalidate cache on code change', async () => {
      const code1 = `
        export default function handler(input) {
          return { value: input.x * 2 };
        }
      `

      const code2 = `
        export default function handler(input) {
          return { value: input.x * 3 }; // Changed multiplication
        }
      `

      const fn1 = createTestCodeFunction('changing-fn', code1)
      const fn2 = createTestCodeFunction('changing-fn', code2)

      // Execute with first version
      const result1 = await executor.execute(fn1, { x: 5 })

      // Execute with changed code
      const result2 = await executor.execute(fn2, { x: 5 })

      expect(result1.status).toBe('completed')
      expect(result2.status).toBe('completed')
      expect(result1.output).toEqual({ value: 10 })
      expect(result2.output).toEqual({ value: 15 }) // Different result due to code change
    })

    it('should return cache hit info in metrics', async () => {
      const code = `
        export default function handler() {
          return { cached: true };
        }
      `

      const fn = createTestCodeFunction('cache-hit-fn', code)

      // First execution
      const result1 = await executor.execute(fn, {})

      // Second execution
      const result2 = await executor.execute(fn, {})

      expect(result1.status).toBe('completed')
      expect(result2.status).toBe('completed')

      // Check cache info in extended result
      const extendedResult1 = result1 as CodeFunctionResult & { cacheHit?: boolean }
      const extendedResult2 = result2 as CodeFunctionResult & { cacheHit?: boolean }

      expect(extendedResult1.cacheHit).toBe(false)
      expect(extendedResult2.cacheHit).toBe(true)
    })

    it('should support explicit cache invalidation', async () => {
      const code = `
        export default function handler() {
          return { value: 42 };
        }
      `

      const fn = createTestCodeFunction('invalidate-fn', code)

      // Execute to populate cache
      await executor.execute(fn, {})

      // Invalidate cache
      await executor.invalidateCache(fn.id)

      // Execute again - should recompile
      const result = await executor.execute(fn, {})

      const extendedResult = result as CodeFunctionResult & { cacheHit?: boolean }
      expect(extendedResult.cacheHit).toBe(false)
    })

    it('should return cache statistics', async () => {
      const fn1 = createTestCodeFunction('stats-fn-1', 'export default () => 1')
      const fn2 = createTestCodeFunction('stats-fn-2', 'export default () => 2')

      await executor.execute(fn1, {})
      await executor.execute(fn1, {})
      await executor.execute(fn2, {})

      const stats = executor.getCacheStats()

      expect(stats).toBeDefined()
      expect(stats.size).toBe(2)
      expect(stats.hits).toBeGreaterThanOrEqual(1)
      expect(stats.misses).toBeGreaterThanOrEqual(2)
    })

    it('should cache by content hash not function ID', async () => {
      const sameCode = 'export default () => ({ same: true })'

      const fn1 = createTestCodeFunction('id-1', sameCode)
      const fn2 = createTestCodeFunction('id-2', sameCode)

      // Execute first function
      await executor.execute(fn1, {})

      // Execute second function with same code but different ID
      const result2 = await executor.execute(fn2, {})

      // Should hit cache because code is the same
      const extendedResult = result2 as CodeFunctionResult & { cacheHit?: boolean }
      expect(extendedResult.cacheHit).toBe(true)
    })
  })

  // ==========================================================================
  // 7b. LRU Cache Eviction (TDD - RED Phase)
  // ==========================================================================

  describe('LRU Cache Eviction', () => {
    it('should respect max cache size limit', async () => {
      // Create executor with small cache size for testing
      const smallCacheExecutor = new CodeExecutor(mockEnv, { maxCacheSize: 3 })

      // Execute 5 different functions to exceed cache size
      for (let i = 0; i < 5; i++) {
        const fn = createTestCodeFunction(
          `lru-fn-${i}`,
          `export default () => ({ id: ${i} })`
        )
        await smallCacheExecutor.execute(fn, {})
      }

      const stats = smallCacheExecutor.getCacheStats()
      expect(stats.size).toBe(3) // Should not exceed max size
    })

    it('should evict least recently used entries when cache is full', async () => {
      // Create executor with small cache size
      const smallCacheExecutor = new CodeExecutor(mockEnv, { maxCacheSize: 3 })

      // Execute 3 functions to fill cache
      const fn0 = createTestCodeFunction('evict-fn-0', 'export default () => ({ id: 0 })')
      const fn1 = createTestCodeFunction('evict-fn-1', 'export default () => ({ id: 1 })')
      const fn2 = createTestCodeFunction('evict-fn-2', 'export default () => ({ id: 2 })')

      await smallCacheExecutor.execute(fn0, {})
      await smallCacheExecutor.execute(fn1, {})
      await smallCacheExecutor.execute(fn2, {})

      // Access fn0 to make it recently used
      await smallCacheExecutor.execute(fn0, {})

      // Add a 4th function - should evict fn1 (least recently used)
      const fn3 = createTestCodeFunction('evict-fn-3', 'export default () => ({ id: 3 })')
      await smallCacheExecutor.execute(fn3, {})

      // fn0 should still be cached (was recently accessed)
      const statsBeforeFn0 = smallCacheExecutor.getCacheStats()
      await smallCacheExecutor.execute(fn0, {})
      const statsAfterFn0 = smallCacheExecutor.getCacheStats()
      expect(statsAfterFn0.hits).toBe(statsBeforeFn0.hits + 1)

      // fn1 should have been evicted (was LRU)
      const statsBeforeFn1 = smallCacheExecutor.getCacheStats()
      await smallCacheExecutor.execute(fn1, {})
      const statsAfterFn1 = smallCacheExecutor.getCacheStats()
      expect(statsAfterFn1.misses).toBe(statsBeforeFn1.misses + 1)
    })

    it('should support TTL expiration', async () => {
      // Create executor with short TTL for testing
      const ttlExecutor = new CodeExecutor(mockEnv, { cacheTTLMs: 100 })

      const fn = createTestCodeFunction('ttl-fn', 'export default () => ({ ttl: true })')

      // First execution - cache miss
      await ttlExecutor.execute(fn, {})

      // Second execution - cache hit (within TTL)
      const result2 = await ttlExecutor.execute(fn, {})
      expect((result2 as { cacheHit: boolean }).cacheHit).toBe(true)

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150))

      // Third execution - cache miss (TTL expired)
      const statsBeforeExpiry = ttlExecutor.getCacheStats()
      await ttlExecutor.execute(fn, {})
      const statsAfterExpiry = ttlExecutor.getCacheStats()
      expect(statsAfterExpiry.misses).toBe(statsBeforeExpiry.misses + 1)
    })

    it('should report evictions in getCacheStats', async () => {
      const smallCacheExecutor = new CodeExecutor(mockEnv, { maxCacheSize: 2 })

      // Fill cache
      const fn0 = createTestCodeFunction('stats-fn-0', 'export default () => ({ id: 0 })')
      const fn1 = createTestCodeFunction('stats-fn-1', 'export default () => ({ id: 1 })')
      await smallCacheExecutor.execute(fn0, {})
      await smallCacheExecutor.execute(fn1, {})

      const statsBeforeEviction = smallCacheExecutor.getCacheStats()
      expect(statsBeforeEviction.evictions).toBe(0)

      // Trigger eviction
      const fn2 = createTestCodeFunction('stats-fn-2', 'export default () => ({ id: 2 })')
      await smallCacheExecutor.execute(fn2, {})

      const statsAfterEviction = smallCacheExecutor.getCacheStats()
      expect(statsAfterEviction.evictions).toBe(1)
    })

    it('should update LRU order on cache hit', async () => {
      const smallCacheExecutor = new CodeExecutor(mockEnv, { maxCacheSize: 3 })

      // Fill cache with A, B, C (order: A -> B -> C)
      const fnA = createTestCodeFunction('order-fn-A', 'export default () => "A"')
      const fnB = createTestCodeFunction('order-fn-B', 'export default () => "B"')
      const fnC = createTestCodeFunction('order-fn-C', 'export default () => "C"')

      await smallCacheExecutor.execute(fnA, {})
      await smallCacheExecutor.execute(fnB, {})
      await smallCacheExecutor.execute(fnC, {})

      // Access A (moves to end: B -> C -> A)
      await smallCacheExecutor.execute(fnA, {})

      // Add D (should evict B, which is now oldest: C -> A -> D)
      const fnD = createTestCodeFunction('order-fn-D', 'export default () => "D"')
      await smallCacheExecutor.execute(fnD, {})

      // A should still be cached (was accessed after B)
      const statsBeforeA = smallCacheExecutor.getCacheStats()
      await smallCacheExecutor.execute(fnA, {})
      const statsAfterA = smallCacheExecutor.getCacheStats()
      expect(statsAfterA.hits).toBe(statsBeforeA.hits + 1)

      // B should be evicted
      const statsBeforeB = smallCacheExecutor.getCacheStats()
      await smallCacheExecutor.execute(fnB, {})
      const statsAfterB = smallCacheExecutor.getCacheStats()
      expect(statsAfterB.misses).toBe(statsBeforeB.misses + 1)
    })

    it('should handle concurrent cache operations correctly', async () => {
      const smallCacheExecutor = new CodeExecutor(mockEnv, { maxCacheSize: 5 })

      // Create 10 different functions
      const functions = Array.from({ length: 10 }, (_, i) =>
        createTestCodeFunction(`concurrent-fn-${i}`, `export default () => ({ id: ${i} })`)
      )

      // Execute all concurrently
      await Promise.all(functions.map(fn => smallCacheExecutor.execute(fn, {})))

      const stats = smallCacheExecutor.getCacheStats()
      expect(stats.size).toBe(5) // Should maintain max size
      expect(stats.evictions).toBeGreaterThanOrEqual(5) // Should have evicted entries
    })

    it('should reset eviction count on invalidateCache', async () => {
      const smallCacheExecutor = new CodeExecutor(mockEnv, { maxCacheSize: 2 })

      // Fill and trigger evictions
      for (let i = 0; i < 5; i++) {
        const fn = createTestCodeFunction(`reset-fn-${i}`, `export default () => ({ id: ${i} })`)
        await smallCacheExecutor.execute(fn, {})
      }

      expect(smallCacheExecutor.getCacheStats().evictions).toBeGreaterThan(0)

      // Invalidate cache
      await smallCacheExecutor.invalidateCache('reset-fn-0')

      // Eviction count should be reset
      expect(smallCacheExecutor.getCacheStats().evictions).toBe(0)
    })
  })

  // ==========================================================================
  // 8. Source Types
  // ==========================================================================

  describe('Source Types', () => {
    it('should load inline source', async () => {
      const fn: CodeFunctionDefinition = {
        id: 'inline-source',
        name: 'Inline Source Test',
        version: '1.0.0',
        type: 'code',
        language: 'typescript',
        source: {
          type: 'inline',
          code: 'export default () => ({ inline: true })',
        },
      }

      const result = await executor.execute(fn, {})

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ inline: true })
    })

    it('should load from R2 bucket', async () => {
      // Pre-populate mock R2 bucket
      const mockBucket = mockEnv.CODE_STORAGE as R2Bucket
      await mockBucket.put(
        'functions/r2-test/code.ts',
        'export default () => ({ fromR2: true })'
      )

      const fn: CodeFunctionDefinition = {
        id: 'r2-source',
        name: 'R2 Source Test',
        version: '1.0.0',
        type: 'code',
        language: 'typescript',
        source: {
          type: 'r2',
          bucket: 'functions',
          key: 'functions/r2-test/code.ts',
        },
      }

      const result = await executor.execute(fn, {})

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ fromR2: true })
    })

    it('should load from URL', async () => {
      // Mock fetch for URL source
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url) => {
        if (url === 'https://cdn.example.com/functions/url-test.ts') {
          return new Response('export default () => ({ fromUrl: true })', {
            status: 200,
            headers: { 'Content-Type': 'text/typescript' },
          })
        }
        return new Response('Not found', { status: 404 })
      })

      const fn: CodeFunctionDefinition = {
        id: 'url-source',
        name: 'URL Source Test',
        version: '1.0.0',
        type: 'code',
        language: 'typescript',
        source: {
          type: 'url',
          url: 'https://cdn.example.com/functions/url-test.ts',
        },
      }

      const result = await executor.execute(fn, {})

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ fromUrl: true })
    })

    it('should load from registry', async () => {
      // Mock registry KV
      const mockRegistry = {
        get: vi.fn().mockResolvedValue(JSON.stringify({
          code: 'export default () => ({ fromRegistry: true })',
          language: 'typescript',
          version: '1.0.0',
        })),
      } as unknown as KVNamespace

      const executorWithRegistry = new CodeExecutor({
        ...mockEnv,
        FUNCTION_REGISTRY: mockRegistry,
      })

      const fn: CodeFunctionDefinition = {
        id: 'registry-source',
        name: 'Registry Source Test',
        version: '1.0.0',
        type: 'code',
        language: 'typescript',
        source: {
          type: 'registry',
          functionId: 'published-function',
          version: '1.0.0',
        },
      }

      const result = await executorWithRegistry.execute(fn, {})

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ fromRegistry: true })
    })

    it('should throw for missing R2 bucket', async () => {
      const fn: CodeFunctionDefinition = {
        id: 'missing-r2',
        name: 'Missing R2 Test',
        version: '1.0.0',
        type: 'code',
        language: 'typescript',
        source: {
          type: 'r2',
          bucket: 'non-existent-bucket',
          key: 'missing.ts',
        },
      }

      await expect(executor.execute(fn, {})).rejects.toThrow(/bucket|not found|missing/i)
    })

    it('should throw for failed URL fetch', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
        return new Response('Not found', { status: 404 })
      })

      const fn: CodeFunctionDefinition = {
        id: 'failed-url',
        name: 'Failed URL Test',
        version: '1.0.0',
        type: 'code',
        language: 'typescript',
        source: {
          type: 'url',
          url: 'https://cdn.example.com/not-found.ts',
        },
      }

      await expect(executor.execute(fn, {})).rejects.toThrow(/fetch|404|not found/i)
    })

    it('should throw for missing registry function', async () => {
      const mockRegistry = {
        get: vi.fn().mockResolvedValue(null),
      } as unknown as KVNamespace

      const executorWithRegistry = new CodeExecutor({
        ...mockEnv,
        FUNCTION_REGISTRY: mockRegistry,
      })

      const fn: CodeFunctionDefinition = {
        id: 'missing-registry',
        name: 'Missing Registry Test',
        version: '1.0.0',
        type: 'code',
        language: 'typescript',
        source: {
          type: 'registry',
          functionId: 'non-existent-function',
        },
      }

      await expect(executorWithRegistry.execute(fn, {})).rejects.toThrow(
        /registry|not found|missing/i
      )
    })

    it('should load specific version from registry', async () => {
      const mockRegistry = {
        get: vi.fn().mockImplementation(async (key: string) => {
          if (key.includes('2.0.0')) {
            return JSON.stringify({
              code: 'export default () => ({ version: "2.0.0" })',
              language: 'typescript',
            })
          }
          return JSON.stringify({
            code: 'export default () => ({ version: "latest" })',
            language: 'typescript',
          })
        }),
      } as unknown as KVNamespace

      const executorWithRegistry = new CodeExecutor({
        ...mockEnv,
        FUNCTION_REGISTRY: mockRegistry,
      })

      const fn: CodeFunctionDefinition = {
        id: 'versioned-registry',
        name: 'Versioned Registry Test',
        version: '1.0.0',
        type: 'code',
        language: 'typescript',
        source: {
          type: 'registry',
          functionId: 'versioned-function',
          version: '2.0.0',
        },
      }

      const result = await executorWithRegistry.execute(fn, {})

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ version: '2.0.0' })
    })
  })

  // ==========================================================================
  // Additional Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty input', async () => {
      const fn = createTestCodeFunction(
        'empty-input',
        `
          export default function handler(input) {
            return { received: input };
          }
        `
      )

      const result = await executor.execute(fn, {})

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ received: {} })
    })

    it('should handle null input', async () => {
      const fn = createTestCodeFunction<null, { isNull: boolean }>(
        'null-input',
        `
          export default function handler(input) {
            return { isNull: input === null };
          }
        `
      )

      const result = await executor.execute(fn, null)

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ isNull: true })
    })

    it('should handle undefined input', async () => {
      const fn = createTestCodeFunction<undefined, { isUndefined: boolean }>(
        'undefined-input',
        `
          export default function handler(input) {
            return { isUndefined: input === undefined };
          }
        `
      )

      const result = await executor.execute(fn, undefined)

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ isUndefined: true })
    })

    it('should handle large input', async () => {
      const fn = createTestCodeFunction<{ data: string[] }, { count: number }>(
        'large-input',
        `
          export default function handler(input) {
            return { count: input.data.length };
          }
        `
      )

      const largeArray = new Array(10000).fill('item')
      const result = await executor.execute(fn, { data: largeArray })

      expect(result.status).toBe('completed')
      expect(result.output).toEqual({ count: 10000 })
    })

    it('should handle large output', async () => {
      const fn = createTestCodeFunction<{ size: number }, { data: string[] }>(
        'large-output',
        `
          export default function handler(input) {
            return { data: new Array(input.size).fill('item') };
          }
        `
      )

      const result = await executor.execute(fn, { size: 10000 })

      expect(result.status).toBe('completed')
      expect(result.output?.data?.length).toBe(10000)
    })

    it('should handle circular references in error', async () => {
      const fn = createTestCodeFunction(
        'circular-error',
        `
          export default function handler() {
            const circular = {};
            circular.self = circular;
            throw circular;
          }
        `
      )

      const result = await executor.execute(fn, {})

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      // Should not crash due to circular reference
    })

    it('should handle concurrent executions of same function', async () => {
      const fn = createTestCodeFunction<{ id: number }, { id: number; timestamp: number }>(
        'concurrent-fn',
        `
          export default async function handler(input) {
            await new Promise(r => setTimeout(r, 10));
            return { id: input.id, timestamp: Date.now() };
          }
        `
      )

      const results = await Promise.all([
        executor.execute(fn, { id: 1 }),
        executor.execute(fn, { id: 2 }),
        executor.execute(fn, { id: 3 }),
      ])

      results.forEach((result, i) => {
        expect(result.status).toBe('completed')
        expect(result.output?.id).toBe(i + 1)
      })
    })

    it('should generate unique execution IDs', async () => {
      const fn = createTestCodeFunction('unique-id', 'export default () => ({})')

      const results = await Promise.all([
        executor.execute(fn, {}),
        executor.execute(fn, {}),
        executor.execute(fn, {}),
      ])

      const executionIds = results.map(r => r.executionId)
      const uniqueIds = new Set(executionIds)

      expect(uniqueIds.size).toBe(3)
    })

    it('should include function metadata in result', async () => {
      const fn = createTestCodeFunction('metadata-fn', 'export default () => ({})')

      const result = await executor.execute(fn, {})

      expect(result.functionId).toBe('metadata-fn')
      expect(result.functionVersion).toBe('1.0.0')
      expect(result.metadata).toBeDefined()
      expect(result.metadata.startedAt).toBeDefined()
      expect(result.metadata.completedAt).toBeDefined()
    })
  })
})
