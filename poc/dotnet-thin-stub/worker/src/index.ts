/**
 * Cloudflare Worker for the Thin Stub + Shared Runtime POC
 *
 * This worker demonstrates the architecture where:
 * 1. Each function has a thin stub (~few KB WASM)
 * 2. The thin stub delegates to a shared runtime (Durable Object)
 * 3. The shared runtime executes the actual function logic
 *
 * This approach aims for faster cold starts compared to bundling
 * the full .NET runtime with every function.
 */

export interface Env {
  RUNTIME: DurableObjectNamespace;
  STUB_MODE: string;
}

/**
 * Metrics collected during function execution
 */
interface ExecutionMetrics {
  approach: 'thin-stub' | 'monolithic';
  stubLoadMs: number;
  stubExecMs: number;
  runtimeMs: number;
  totalMs: number;
  stubSizeKb: number;
  runtimeSizeKb: number;
}

/**
 * Result from function execution
 */
interface ExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  metrics: ExecutionMetrics;
}

/**
 * Main worker handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Route handling
    if (url.pathname === '/') {
      return new Response(JSON.stringify({
        name: 'Functions.do Thin Stub POC',
        version: '0.1.0',
        endpoints: {
          '/invoke/:functionId': 'Invoke a function using thin stub + shared runtime',
          '/invoke-monolithic/:functionId': 'Invoke using monolithic approach (for comparison)',
          '/benchmark': 'Run cold start benchmark comparing both approaches',
          '/info': 'Get system information',
        },
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/info') {
      return handleInfo(env);
    }

    if (url.pathname === '/benchmark') {
      return handleBenchmark(request, env);
    }

    // Thin stub invocation
    const thinStubMatch = url.pathname.match(/^\/invoke\/([^/]+)$/);
    if (thinStubMatch) {
      return handleThinStubInvoke(request, env, thinStubMatch[1]);
    }

    // Monolithic invocation (for comparison)
    const monolithicMatch = url.pathname.match(/^\/invoke-monolithic\/([^/]+)$/);
    if (monolithicMatch) {
      return handleMonolithicInvoke(request, env, monolithicMatch[1]);
    }

    return new Response('Not Found', { status: 404 });
  },
};

/**
 * Handle function invocation using the thin stub approach
 *
 * Flow:
 * 1. Load the thin stub (small, fast)
 * 2. Stub serializes arguments
 * 3. Stub delegates to shared runtime (Durable Object)
 * 4. Runtime executes and returns result
 */
async function handleThinStubInvoke(
  request: Request,
  env: Env,
  functionId: string
): Promise<Response> {
  const startTime = performance.now();
  let body: { method?: string; args?: unknown[] } = {};

  try {
    if (request.method === 'POST') {
      body = await request.json();
    }
  } catch {
    // Use defaults
  }

  const methodName = body.method ?? 'execute';
  const args = body.args ?? [];

  // Simulate loading the thin stub
  const stubLoadStart = performance.now();
  const stubInfo = await loadThinStub(functionId);
  const stubLoadMs = performance.now() - stubLoadStart;

  // Simulate stub execution (serialization and delegation)
  const stubExecStart = performance.now();
  const delegation = {
    functionId,
    methodName,
    serializedArguments: JSON.stringify(args),
    stubInstanceId: stubInfo.instanceId,
  };
  const stubExecMs = performance.now() - stubExecStart;

  // Delegate to shared runtime (Durable Object)
  const runtimeStart = performance.now();
  const runtimeId = env.RUNTIME.idFromName('shared-runtime-v1');
  const runtimeStub = env.RUNTIME.get(runtimeId);

  const runtimeResponse = await runtimeStub.fetch('http://runtime/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(delegation),
  });

  const runtimeResult = await runtimeResponse.json() as {
    success: boolean;
    result?: unknown;
    error?: string;
    metrics?: { executionMs: number };
  };
  const runtimeMs = performance.now() - runtimeStart;

  const totalMs = performance.now() - startTime;

  const result: ExecutionResult = {
    success: runtimeResult.success,
    result: runtimeResult.result,
    error: runtimeResult.error,
    metrics: {
      approach: 'thin-stub',
      stubLoadMs,
      stubExecMs,
      runtimeMs,
      totalMs,
      stubSizeKb: stubInfo.sizeKb,
      runtimeSizeKb: 0, // Runtime is shared, not counted per function
    },
  };

  return new Response(JSON.stringify(result, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle function invocation using monolithic approach
 *
 * This simulates loading the full .NET runtime for each function,
 * for cold start comparison purposes.
 */
async function handleMonolithicInvoke(
  request: Request,
  env: Env,
  functionId: string
): Promise<Response> {
  const startTime = performance.now();
  let body: { method?: string; args?: unknown[] } = {};

  try {
    if (request.method === 'POST') {
      body = await request.json();
    }
  } catch {
    // Use defaults
  }

  const methodName = body.method ?? 'execute';
  const args = body.args ?? [];

  // Simulate loading the full .NET runtime + function bundle
  const loadStart = performance.now();
  const bundleInfo = await loadMonolithicBundle(functionId);
  const loadMs = performance.now() - loadStart;

  // Simulate execution within the monolithic bundle
  const execStart = performance.now();
  const result = await simulateMonolithicExecution(functionId, methodName, args);
  const execMs = performance.now() - execStart;

  const totalMs = performance.now() - startTime;

  const execResult: ExecutionResult = {
    success: true,
    result,
    metrics: {
      approach: 'monolithic',
      stubLoadMs: loadMs, // In monolithic, this is the full bundle load
      stubExecMs: execMs,
      runtimeMs: 0, // Runtime is bundled, no separate call
      totalMs,
      stubSizeKb: bundleInfo.sizeKb,
      runtimeSizeKb: bundleInfo.runtimeSizeKb,
    },
  };

  return new Response(JSON.stringify(execResult, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Run a benchmark comparing cold starts
 */
async function handleBenchmark(
  request: Request,
  env: Env
): Promise<Response> {
  const functions = ['add', 'multiply', 'greet', 'fibonacci', 'echo'];
  const iterations = 5;
  const results: {
    functionId: string;
    thinStub: { avgMs: number; minMs: number; maxMs: number };
    monolithic: { avgMs: number; minMs: number; maxMs: number };
    improvement: string;
  }[] = [];

  for (const functionId of functions) {
    const thinStubTimes: number[] = [];
    const monolithicTimes: number[] = [];

    for (let i = 0; i < iterations; i++) {
      // Test thin stub
      const thinStart = performance.now();
      await handleThinStubInvoke(
        new Request('http://test/invoke/' + functionId, {
          method: 'POST',
          body: JSON.stringify({ args: [5, 3] }),
        }),
        env,
        functionId
      );
      thinStubTimes.push(performance.now() - thinStart);

      // Test monolithic
      const monoStart = performance.now();
      await handleMonolithicInvoke(
        new Request('http://test/invoke-monolithic/' + functionId, {
          method: 'POST',
          body: JSON.stringify({ args: [5, 3] }),
        }),
        env,
        functionId
      );
      monolithicTimes.push(performance.now() - monoStart);
    }

    const thinAvg = average(thinStubTimes);
    const monoAvg = average(monolithicTimes);
    const improvement = ((monoAvg - thinAvg) / monoAvg * 100).toFixed(1);

    results.push({
      functionId,
      thinStub: {
        avgMs: thinAvg,
        minMs: Math.min(...thinStubTimes),
        maxMs: Math.max(...thinStubTimes),
      },
      monolithic: {
        avgMs: monoAvg,
        minMs: Math.min(...monolithicTimes),
        maxMs: Math.max(...monolithicTimes),
      },
      improvement: `${improvement}%`,
    });
  }

  const summary = {
    benchmark: 'Cold Start Comparison',
    iterations,
    results,
    analysis: {
      thinStubAdvantages: [
        'Smaller WASM binary to load (~5KB vs ~15MB)',
        'Shared runtime amortizes initialization cost',
        'Faster cold starts for infrequently used functions',
      ],
      monolithicAdvantages: [
        'No network hop to runtime',
        'All code co-located',
        'Better for frequently used functions with warm caches',
      ],
      recommendation: 'Use thin stubs for functions with infrequent invocations or when cold start latency is critical',
    },
  };

  return new Response(JSON.stringify(summary, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Get system information
 */
async function handleInfo(env: Env): Promise<Response> {
  const runtimeId = env.RUNTIME.idFromName('shared-runtime-v1');
  const runtimeStub = env.RUNTIME.get(runtimeId);

  const runtimeResponse = await runtimeStub.fetch('http://runtime/info');
  const runtimeInfo = await runtimeResponse.json();

  return new Response(JSON.stringify({
    worker: {
      name: 'dotnet-thin-stub-poc',
      version: '0.1.0',
    },
    runtime: runtimeInfo,
    sizes: {
      thinStubKb: SIMULATED_STUB_SIZE_KB,
      monolithicBundleMb: SIMULATED_MONOLITHIC_SIZE_MB,
      sharedRuntimeMb: SIMULATED_RUNTIME_SIZE_MB,
    },
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// Simulated sizes (based on actual .NET WASI builds)
const SIMULATED_STUB_SIZE_KB = 5; // Aggressively trimmed stub
const SIMULATED_MONOLITHIC_SIZE_MB = 15; // Full .NET runtime per function
const SIMULATED_RUNTIME_SIZE_MB = 20; // Shared runtime (loaded once)

// Simulated load times (proportional to size)
const STUB_LOAD_TIME_MS = 2;
const MONOLITHIC_LOAD_TIME_MS = 150;

/**
 * Simulate loading a thin stub
 */
async function loadThinStub(functionId: string): Promise<{ instanceId: string; sizeKb: number }> {
  // Simulate the time to load a small WASM module
  await sleep(STUB_LOAD_TIME_MS);

  return {
    instanceId: Math.random().toString(36).slice(2, 10),
    sizeKb: SIMULATED_STUB_SIZE_KB,
  };
}

/**
 * Simulate loading a monolithic .NET bundle
 */
async function loadMonolithicBundle(functionId: string): Promise<{
  sizeKb: number;
  runtimeSizeKb: number;
}> {
  // Simulate the time to load the full .NET runtime
  await sleep(MONOLITHIC_LOAD_TIME_MS);

  return {
    sizeKb: SIMULATED_MONOLITHIC_SIZE_MB * 1024,
    runtimeSizeKb: SIMULATED_MONOLITHIC_SIZE_MB * 1024,
  };
}

/**
 * Simulate execution in the monolithic bundle
 */
async function simulateMonolithicExecution(
  functionId: string,
  methodName: string,
  args: unknown[]
): Promise<unknown> {
  // Use the same function implementations as the runtime
  return executeFunctionImpl(functionId, args);
}

/**
 * Shared function implementations (used by both approaches in simulation)
 */
function executeFunctionImpl(functionId: string, args: unknown[]): unknown {
  switch (functionId) {
    case 'add':
      return (args[0] as number) + (args[1] as number);
    case 'multiply':
      return (args[0] as number) * (args[1] as number);
    case 'greet':
      return `Hello, ${args[0]}!`;
    case 'fibonacci': {
      const n = args[0] as number;
      if (n <= 1) return n;
      let a = 0, b = 1;
      for (let i = 2; i <= n; i++) {
        const c = a + b;
        a = b;
        b = c;
      }
      return b;
    }
    case 'echo':
      return args[0];
    default:
      throw new Error(`Unknown function: ${functionId}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function average(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Shared Runtime Durable Object
 *
 * This simulates the shared .NET runtime that executes function logic.
 * In production, this would run actual WASI/WASM code.
 */
export class SharedRuntime implements DurableObject {
  private initTime: number;
  private invocationCount: number = 0;
  private functionCache: Map<string, unknown> = new Map();

  constructor(private state: DurableObjectState, private env: Env) {
    this.initTime = Date.now();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/info') {
      return new Response(JSON.stringify({
        type: 'shared-runtime',
        version: '0.1.0',
        uptimeMs: Date.now() - this.initTime,
        invocationCount: this.invocationCount,
        cachedFunctions: this.functionCache.size,
      }));
    }

    if (url.pathname === '/execute') {
      return this.handleExecute(request);
    }

    return new Response('Not Found', { status: 404 });
  }

  private async handleExecute(request: Request): Promise<Response> {
    this.invocationCount++;
    const startTime = performance.now();

    try {
      const body = await request.json() as {
        functionId: string;
        methodName: string;
        serializedArguments: string;
        stubInstanceId: string;
      };

      const args = JSON.parse(body.serializedArguments) as unknown[];

      // Execute the function
      const result = executeFunctionImpl(body.functionId, args);

      const executionMs = performance.now() - startTime;

      return new Response(JSON.stringify({
        success: true,
        result,
        metrics: {
          executionMs,
        },
      }));
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }), { status: 500 });
    }
  }
}
