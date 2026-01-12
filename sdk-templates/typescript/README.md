# {{functionName}}

A serverless function built with [Functions.do](https://functions.do) on Cloudflare Workers.

## Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Deploy to Functions.do
npm run deploy
```

## Project Structure

```
{{functionName}}/
├── src/
│   ├── index.ts       # Main function entry point with RPC target
│   ├── types.d.ts     # Generated type definitions
│   └── bindings.ts    # capnweb RPC client bindings
├── dist/              # Compiled output (generated)
├── package.json       # Dependencies and scripts
├── tsconfig.json      # TypeScript configuration
└── README.md          # This file
```

## Development

### Local Development

Start a local development server with hot reload:

```bash
npm run dev
```

The function will be available at `http://localhost:8787`.

### Type Checking

```bash
npm run typecheck
```

### Running Tests

```bash
npm test
```

## API Endpoints

### Health Check

```bash
GET /health
```

Returns the function health status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-12T10:30:00.000Z"
}
```

### Greet

```bash
# GET with query parameter
GET /greet?name=World

# POST with JSON body
POST /greet
Content-Type: application/json

{"name": "World"}
```

**Response:**
```json
{
  "message": "Hello, World!",
  "timestamp": "2024-01-12T10:30:00.000Z"
}
```

### Math Operations

```bash
# Addition
GET /add?a=2&b=3

# Multiplication
GET /multiply?a=6&b=7
```

**Response:**
```json
{
  "operation": "add",
  "operands": [2, 3],
  "result": 5
}
```

### Echo

```bash
POST /echo
Content-Type: application/json

{"any": "data"}
```

Echoes back the request body.

### Metrics

```bash
GET /metrics
```

Returns function metrics.

### RPC (capnweb)

```bash
POST /rpc
Content-Type: application/json

{
  "method": "greet",
  "params": ["World"],
  "id": "1"
}
```

**Response:**
```json
{
  "id": "1",
  "result": {
    "message": "Hello, World!",
    "timestamp": "2024-01-12T10:30:00.000Z"
  }
}
```

## capnweb RPC Integration

This function exports an RPC target for direct Worker-to-Worker communication using the capnweb protocol.

### RPC Target Class

The `MyFunctionTarget` class extends `RpcTarget` and provides type-safe methods:

```typescript
import { MyFunctionTarget } from './src/index'

// Create a target instance
const target = new MyFunctionTarget(env)

// Call methods
const greeting = await target.greet('Alice')
const sum = await target.add(2, 3)
const time = await target.getTime()
```

### Using from Another Worker

#### Via Service Binding

```typescript
// wrangler.toml
[[services]]
binding = "MY_FUNCTION"
service = "{{functionName}}"

// worker.ts
import { FunctionClient } from '{{functionName}}/bindings'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Create client from service binding
    const client = new FunctionClient(env.MY_FUNCTION)

    // Call RPC methods
    const greeting = await client.greet('World')
    const result = await client.add(2, 3)

    return Response.json({ greeting, result })
  }
}
```

#### Via Direct Fetch

```typescript
import { FunctionClient } from '{{functionName}}/bindings'

const client = new FunctionClient('https://{{functionName}}.workers.dev')

const greeting = await client.greet('World')
console.log(greeting.message) // "Hello, World!"
```

### Available RPC Methods

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `greet` | `name: string` | `Promise<GreetResponse>` | Returns a greeting |
| `echo` | `input: T` | `Promise<T>` | Echoes the input |
| `getTime` | - | `Promise<string>` | Returns current ISO timestamp |
| `add` | `a: number, b: number` | `Promise<MathResult>` | Adds two numbers |
| `multiply` | `a: number, b: number` | `Promise<MathResult>` | Multiplies two numbers |
| `getMetrics` | - | `{ requestCount, errorCount }` | Returns metrics |

### Batch Operations

Make multiple RPC calls efficiently:

```typescript
import { FunctionClient, batchCall } from '{{functionName}}/bindings'

const client = new FunctionClient(env.MY_FUNCTION)

const results = await batchCall(client, [
  { method: 'greet', params: ['Alice'] },
  { method: 'greet', params: ['Bob'] },
  { method: 'add', params: [1, 2] },
])

// results = [
//   { success: true, result: { message: "Hello, Alice!", ... } },
//   { success: true, result: { message: "Hello, Bob!", ... } },
//   { success: true, result: { operation: "add", result: 3, ... } },
// ]
```

### Error Handling

```typescript
import { FunctionClient, RpcError } from '{{functionName}}/bindings'

const client = new FunctionClient(env.MY_FUNCTION)

try {
  await client.greet('World')
} catch (error) {
  if (error instanceof RpcError) {
    console.log(`RPC Error: ${error.message} (${error.code})`)

    if (error.isMethodNotFound) {
      // Handle method not found
    } else if (error.isInternalError) {
      // Handle internal error
    }
  }
}
```

## Type Definitions

Import generated types for type-safe development:

```typescript
import type {
  GreetRequest,
  GreetResponse,
  MathResult,
  MyFunctionTargetMethods,
  Env,
} from '{{functionName}}/types'
```

## Environment Bindings

Add your environment bindings to the `Env` interface in `src/index.ts`:

```typescript
export interface Env extends FunctionEnv {
  // KV namespace
  MY_KV: KVNamespace

  // Durable Object
  MY_DO: DurableObjectNamespace

  // Service binding to another function
  OTHER_FUNCTION: Fetcher

  // Secret (set via wrangler secret)
  API_KEY: string
}
```

## Deployment

### Deploy to Functions.do

```bash
npm run deploy
```

### Manual Deployment with Wrangler

```bash
npx wrangler deploy
```

## Configuration

### Functions.do Configuration

The `functions.do` field in `package.json` configures deployment:

```json
{
  "functions.do": {
    "runtime": "cloudflare-workers",
    "language": "typescript",
    "entryPoint": "src/index.ts",
    "rpcTarget": "MyFunctionTarget",
    "exports": {
      "types": "src/types.d.ts",
      "bindings": "src/bindings.ts"
    }
  }
}
```

### TypeScript Configuration

The `tsconfig.json` is optimized for Cloudflare Workers:

- **Target:** ES2022 (matches Workers runtime)
- **Module:** ESNext with bundler resolution
- **Strict:** Enabled for better type safety
- **Types:** `@cloudflare/workers-types` for Workers API types

## Building

### Production Build

```bash
npm run build
```

Creates an optimized ESM bundle in `dist/`.

### Generate Type Definitions

```bash
npm run build:types
```

Generates `.d.ts` files for type consumers.

### Generate RPC Bindings

```bash
npm run generate:bindings
```

Regenerates capnweb RPC bindings from source.

### Generate Documentation

```bash
npm run docs
```

Generates API documentation from JSDoc comments.

## Metrics and Observability

The RPC target includes built-in metrics:

```typescript
const target = new MyFunctionTarget(env)

// After some calls...
const metrics = target.getMetrics()
console.log(`Requests: ${metrics.requestCount}, Errors: ${metrics.errorCount}`)
```

Metrics are also available via the `/metrics` endpoint:

```bash
GET /metrics
```

## Resource Cleanup

The RPC target implements `Symbol.dispose` for automatic cleanup:

```typescript
{
  using target = new MyFunctionTarget(env)
  await target.greet('World')
} // target is automatically disposed here
```

## License

MIT
