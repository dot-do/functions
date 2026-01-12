/**
 * Runtime Worker
 *
 * This worker simulates a shared runtime that executes functions on behalf
 * of thin stub workers. It receives function execution requests and returns results.
 *
 * Used to benchmark worker-to-worker RPC latency for the Functions.do
 * distributed runtime architecture.
 */

export interface Env {
  // No bindings needed for the runtime worker
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

/**
 * Simulates function execution with configurable workload
 */
function executeFunction(functionId: string, payload: unknown): unknown {
  switch (functionId) {
    case 'echo':
      // Simple echo - minimal compute
      return payload;

    case 'transform':
      // Light transform - some computation
      if (typeof payload === 'object' && payload !== null) {
        return JSON.parse(JSON.stringify(payload));
      }
      return payload;

    case 'compute':
      // CPU-bound work simulation
      let sum = 0;
      for (let i = 0; i < 1000; i++) {
        sum += Math.sqrt(i);
      }
      return { result: sum, input: payload };

    default:
      return { error: 'Unknown function', functionId };
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', worker: 'runtime' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Execute endpoint
    if (url.pathname === '/execute' && request.method === 'POST') {
      const startTime = performance.now();

      try {
        const body: ExecuteRequest = await request.json();
        const result = executeFunction(body.functionId, body.payload);
        const executionTimeMs = performance.now() - startTime;

        const response: ExecuteResponse = {
          result,
          runtimeTimestamp: Date.now(),
          executionTimeMs,
        };

        return new Response(JSON.stringify(response), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: String(error) }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};
