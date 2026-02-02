# Workers-Based E2E Tests

This directory contains E2E tests that run the SDK client **inside a Cloudflare Worker**, not in Node.js. This tests the actual production scenario where customers use the SDK client from their own Workers to call functions.do.

## Why Workers E2E Tests?

The existing E2E tests in `test/e2e/` run in Node.js via `vitest run`. While useful, they don't test the actual runtime environment customers will use:

| Aspect | Node.js E2E | Workers E2E |
|--------|-------------|-------------|
| Runtime | Node.js | Cloudflare Workers (workerd) |
| fetch() | node-fetch / undici | Workers native fetch |
| Environment | Process, file system | Isolated sandbox |
| Service Bindings | N/A | Tested |
| Streaming | Node streams | Workers streams |

## Test Categories

### 1. SDK Client Tests (`sdk-client.test.ts`)
- Client initialization in Workers
- fetch-based invocation from Workers
- Error handling in Workers runtime
- AbortController/signal support
- Batch invocation

### 2. Workers-to-Workers Tests (`workers-to-workers.test.ts`)
- Direct fetch invocation
- Service binding invocation (RPC)
- Parallel invocations
- Chained function calls (A -> B)
- Request/response patterns
- Error scenarios

### 3. Streaming Tests (`streaming.test.ts`)
- SDK stream method in Workers
- Native ReadableStream/TransformStream
- SSE (Server-Sent Events)
- Incremental processing
- Stream transformation

## Configuration

### Vitest Config (`vitest.e2e.workers.config.ts`)
Uses `@cloudflare/vitest-pool-workers` to run tests inside workerd:

```typescript
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersProject({
  test: {
    include: ['test/e2e-workers/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.e2e.jsonc' },
      },
    },
  },
})
```

### Wrangler Config (`wrangler.e2e.jsonc`)
Configures the test Worker with necessary bindings:

```jsonc
{
  "name": "functions-e2e-workers-client",
  "services": [
    {
      "binding": "FUNCTIONS_DO",
      "service": "functions-do"
    }
  ]
}
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `E2E_BASE_URL` | functions.do API URL | No (default: production) |
| `FUNCTIONS_API_KEY` | API key for auth | No (for authenticated tests) |

## Running Tests

```bash
# Run Workers-based E2E tests only
npm run test:e2e:workers

# Run all E2E tests (Node.js + Workers)
npm run test:e2e:all

# Run with verbose output
npx vitest run --config vitest.e2e.workers.config.ts --reporter verbose
```

## Test Worker Entry Point

The `worker-entry.ts` file defines the test Worker's interface:

```typescript
export interface Env {
  E2E_BASE_URL: string
  FUNCTIONS_DO: Fetcher  // Service binding
  FUNCTIONS_API_KEY?: string
}
```

Tests access these bindings via `cloudflare:test`:

```typescript
import { env } from 'cloudflare:test'

// Use service binding
const response = await env.FUNCTIONS_DO.fetch(...)
```

## Key Differences from Node.js Tests

### 1. Service Bindings
Workers can use service bindings for direct RPC:

```typescript
// Node.js E2E - HTTP fetch
await fetch('https://functions.do/api/...')

// Workers E2E - Service binding
await env.FUNCTIONS_DO.fetch('https://functions.do/api/...')
```

### 2. Streaming
Workers use native Web Streams:

```typescript
// Workers streaming
const reader = response.body.getReader()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  // Process chunk
}
```

### 3. AbortController
Native in Workers (no polyfill needed):

```typescript
const controller = new AbortController()
await fetch(url, { signal: controller.signal })
controller.abort()
```

## Cleanup

Tests should clean up deployed functions in `afterAll`:

```typescript
afterAll(async () => {
  for (const functionId of deployedFunctions) {
    await deleteFunction(functionId)
  }
})
```

## Debugging

1. **View logs**: Check Cloudflare dashboard or use `wrangler tail`
2. **Local dev**: Run `wrangler dev --config wrangler.e2e.jsonc`
3. **Increase timeout**: Modify `testTimeout` in vitest config

## Contributing

When adding new tests:

1. Use the Workers runtime APIs (fetch, streams, crypto)
2. Test service bindings where applicable
3. Handle both success and error cases
4. Clean up deployed functions
5. Document any new environment requirements
