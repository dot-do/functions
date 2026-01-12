/**
 * Caller Worker (Thin Stub)
 *
 * This worker simulates a thin function stub that delegates execution
 * to a runtime worker. It supports multiple delegation strategies:
 *
 * 1. Service Binding (zero network hop)
 * 2. Raw fetch (HTTP over network)
 * 3. Direct execution (baseline)
 *
 * Used to benchmark worker-to-worker RPC latency for the Functions.do
 * distributed runtime architecture.
 */

export interface Env {
  // Service binding to runtime worker
  RUNTIME: Fetcher;
  // Runtime URL for raw fetch comparison
  RUNTIME_URL?: string;
}

interface ExecuteRequest {
  functionId: string;
  payload: unknown;
  timestamp: number;
}

interface ExecuteResponse {
  result: unknown;
  runtimeTimestamp: number;
  executionTimeMs: number;
}

interface BenchmarkResult {
  method: 'service-binding' | 'raw-fetch' | 'direct';
  callerStartTime: number;
  callerEndTime: number;
  totalLatencyMs: number;
  runtimeExecutionMs?: number;
  payloadSize: number;
  functionId: string;
}

/**
 * Direct execution - baseline for comparison
 */
function executeDirectly(functionId: string, payload: unknown): unknown {
  switch (functionId) {
    case 'echo':
      return payload;
    case 'transform':
      if (typeof payload === 'object' && payload !== null) {
        return JSON.parse(JSON.stringify(payload));
      }
      return payload;
    case 'compute':
      let sum = 0;
      for (let i = 0; i < 1000; i++) {
        sum += Math.sqrt(i);
      }
      return { result: sum, input: payload };
    default:
      return { error: 'Unknown function', functionId };
  }
}

/**
 * Delegate via Service Binding (recommended for production)
 */
async function delegateViaServiceBinding(
  runtime: Fetcher,
  functionId: string,
  payload: unknown
): Promise<{ response: ExecuteResponse; latencyMs: number }> {
  const startTime = performance.now();

  const request: ExecuteRequest = {
    functionId,
    payload,
    timestamp: Date.now(),
  };

  const response = await runtime.fetch('http://runtime/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  const result: ExecuteResponse = await response.json();
  const latencyMs = performance.now() - startTime;

  return { response: result, latencyMs };
}

/**
 * Delegate via raw HTTP fetch (for comparison)
 */
async function delegateViaFetch(
  runtimeUrl: string,
  functionId: string,
  payload: unknown
): Promise<{ response: ExecuteResponse; latencyMs: number }> {
  const startTime = performance.now();

  const request: ExecuteRequest = {
    functionId,
    payload,
    timestamp: Date.now(),
  };

  const response = await fetch(`${runtimeUrl}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  const result: ExecuteResponse = await response.json();
  const latencyMs = performance.now() - startTime;

  return { response: result, latencyMs };
}

/**
 * Generate test payload of specified size
 */
function generatePayload(sizeBytes: number): object {
  // Generate a payload that serializes to approximately the target size
  const baseObj = { data: '', metadata: { timestamp: Date.now() } };
  const targetDataSize = Math.max(0, sizeBytes - JSON.stringify(baseObj).length);
  baseObj.data = 'x'.repeat(targetDataSize);
  return baseObj;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', worker: 'caller' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Single execution test
    if (url.pathname === '/execute') {
      const method = url.searchParams.get('method') || 'service-binding';
      const functionId = url.searchParams.get('function') || 'echo';
      const payloadSize = parseInt(url.searchParams.get('payloadSize') || '100', 10);

      const payload = generatePayload(payloadSize);
      const startTime = performance.now();

      let result: BenchmarkResult;

      if (method === 'direct') {
        const directResult = executeDirectly(functionId, payload);
        const endTime = performance.now();

        result = {
          method: 'direct',
          callerStartTime: startTime,
          callerEndTime: endTime,
          totalLatencyMs: endTime - startTime,
          payloadSize,
          functionId,
        };
      } else if (method === 'service-binding') {
        const { response, latencyMs } = await delegateViaServiceBinding(
          env.RUNTIME,
          functionId,
          payload
        );
        const endTime = performance.now();

        result = {
          method: 'service-binding',
          callerStartTime: startTime,
          callerEndTime: endTime,
          totalLatencyMs: latencyMs,
          runtimeExecutionMs: response.executionTimeMs,
          payloadSize,
          functionId,
        };
      } else if (method === 'raw-fetch') {
        const runtimeUrl = env.RUNTIME_URL || 'http://localhost:8788';
        const { response, latencyMs } = await delegateViaFetch(runtimeUrl, functionId, payload);
        const endTime = performance.now();

        result = {
          method: 'raw-fetch',
          callerStartTime: startTime,
          callerEndTime: endTime,
          totalLatencyMs: latencyMs,
          runtimeExecutionMs: response.executionTimeMs,
          payloadSize,
          functionId,
        };
      } else {
        return new Response(JSON.stringify({ error: 'Invalid method' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Benchmark endpoint - runs multiple iterations
    if (url.pathname === '/benchmark') {
      const method = (url.searchParams.get('method') || 'service-binding') as BenchmarkResult['method'];
      const functionId = url.searchParams.get('function') || 'echo';
      const payloadSize = parseInt(url.searchParams.get('payloadSize') || '100', 10);
      const iterations = parseInt(url.searchParams.get('iterations') || '100', 10);

      const payload = generatePayload(payloadSize);
      const results: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const startTime = performance.now();

        if (method === 'direct') {
          executeDirectly(functionId, payload);
        } else if (method === 'service-binding') {
          await delegateViaServiceBinding(env.RUNTIME, functionId, payload);
        } else if (method === 'raw-fetch') {
          const runtimeUrl = env.RUNTIME_URL || 'http://localhost:8788';
          await delegateViaFetch(runtimeUrl, functionId, payload);
        }

        const latencyMs = performance.now() - startTime;
        results.push(latencyMs);
      }

      // Calculate percentiles
      results.sort((a, b) => a - b);
      const p50Index = Math.floor(results.length * 0.5);
      const p95Index = Math.floor(results.length * 0.95);
      const p99Index = Math.floor(results.length * 0.99);

      const stats = {
        method,
        functionId,
        payloadSize,
        iterations,
        min: results[0],
        max: results[results.length - 1],
        mean: results.reduce((a, b) => a + b, 0) / results.length,
        p50: results[p50Index],
        p95: results[p95Index],
        p99: results[p99Index],
        rawResults: results,
      };

      return new Response(JSON.stringify(stats, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
