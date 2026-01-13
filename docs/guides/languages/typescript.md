# TypeScript Guide

TypeScript is the recommended language for building functions on Functions.do. It offers native support in the Cloudflare Workers runtime, excellent developer experience, and the smallest bundle sizes.

## Quick Start

Get started with TypeScript in minutes:

```bash
npm create functions-do@latest my-function
cd my-function
npm install
```

## Installation

Install the Functions.do SDK and required dependencies:

```bash
npm install @dotdo/functions
npm install -D typescript @cloudflare/workers-types wrangler
```

Or with other package managers:

```bash
pnpm add @dotdo/functions
pnpm add -D typescript @cloudflare/workers-types wrangler
```

```bash
yarn add @dotdo/functions
yarn add -D typescript @cloudflare/workers-types wrangler
```

## Project Configuration

### tsconfig.json

Configure TypeScript for Cloudflare Workers:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

### wrangler.toml

Configure your worker deployment:

```toml
name = "my-function"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "production"

[[kv_namespaces]]
binding = "MY_KV"
id = "your-kv-namespace-id"
```

## Env Interface

Define your environment bindings using the Env interface:

```typescript
// Define the Env interface for your worker
export interface Env {
  // Environment variables
  ENVIRONMENT: string
  API_KEY: string

  // KV namespace bindings
  MY_KV: KVNamespace

  // Durable Object bindings
  MY_DO: DurableObjectNamespace

  // R2 bucket bindings
  MY_BUCKET: R2Bucket
}
```

## Code Examples

### Hello World Handler

A basic function that returns a greeting:

```typescript
// Basic hello world function
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return new Response('Hello, World!', {
      headers: { 'Content-Type': 'text/plain' },
    })
  },
}
```

### JSON API Handler

Handle JSON requests and responses:

```typescript
import { FunctionsSDK } from '@dotdo/functions'

interface Env {
  API_KEY: string
}

interface RequestBody {
  name: string
  age: number
}

// JSON API handler with request/response handling
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    try {
      // Parse the JSON body
      const body: RequestBody = await request.json()

      // Process the request
      const response = {
        message: `Hello, ${body.name}!`,
        isAdult: body.age >= 18,
        timestamp: new Date().toISOString(),
      }

      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      return new Response('Invalid JSON', { status: 400 })
    }
  },
}
```

### SDK Integration Example

Use the Functions.do SDK for advanced functionality:

```typescript
import { FunctionsSDK, createHandler } from '@dotdo/functions'

interface Env {
  FUNCTIONS_API_KEY: string
  MY_KV: KVNamespace
}

// SDK-integrated function with KV storage
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const sdk = new FunctionsSDK({
      apiKey: env.FUNCTIONS_API_KEY,
    })

    const url = new URL(request.url)
    const key = url.searchParams.get('key')

    if (!key) {
      return new Response('Missing key parameter', { status: 400 })
    }

    // Get value from KV
    const value = await env.MY_KV.get(key)

    // Log the access via SDK
    await sdk.log({
      action: 'kv_access',
      key,
      found: value !== null,
    })

    return new Response(JSON.stringify({ key, value }), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
```

### Request/Response with Middleware

Advanced handler with middleware pattern:

```typescript
import { FunctionsSDK } from '@dotdo/functions'

interface Env {
  API_KEY: string
}

type Handler = (request: Request, env: Env) => Promise<Response>

// Middleware function for authentication
function withAuth(handler: Handler): Handler {
  return async (request: Request, env: Env): Promise<Response> => {
    const authHeader = request.headers.get('Authorization')

    if (!authHeader || authHeader !== `Bearer ${env.API_KEY}`) {
      return new Response('Unauthorized', { status: 401 })
    }

    return handler(request, env)
  }
}

// Protected handler with middleware
const protectedHandler = withAuth(async (request: Request, env: Env): Promise<Response> => {
  return new Response('Hello, authenticated user!', {
    headers: { 'Content-Type': 'text/plain' },
  })
})

export default {
  fetch: protectedHandler,
}
```

## SDK Configuration

The @dotdo/functions provides configuration options for your Functions.do integration:

```typescript
import { FunctionsSDK } from '@dotdo/functions'

const sdk = new FunctionsSDK({
  // Required: Your Functions.do API key
  apiKey: 'your-api-key',

  // Optional: Custom endpoint
  endpoint: 'https://api.functions.do',

  // Optional: Request timeout in milliseconds
  timeout: 30000,

  // Optional: Enable debug logging
  debug: false,
})
```

### SDK API Methods

```typescript
import { FunctionsSDK } from '@dotdo/functions'

// Example SDK API usage
export async function useSdkMethods(sdk: FunctionsSDK) {
  // Invoke another function
  const result = await sdk.invoke('function-name', {
    data: { key: 'value' },
  })

  // Log events
  await sdk.log({
    level: 'info',
    message: 'Function executed',
    metadata: { duration: 100 },
  })

  // Get function metadata
  const metadata = await sdk.getMetadata()

  return { result, metadata }
}
```

## Testing

### Local Development

Run your function locally with Wrangler:

```bash
npx wrangler dev
```

### Unit Testing

Test your functions with Vitest:

```typescript
import { describe, it, expect } from 'vitest'
import worker from './index'

const TEST_URL = 'https://example.com/'

describe('Worker', () => {
  it('should return hello world', async () => {
    const request = new Request(TEST_URL)
    const env = { API_KEY: 'test' }

    const response = await worker.fetch(request, env)
    const text = await response.text()

    expect(text).toBe('Hello, World!')
  })
})
```

### Integration Testing

```bash
npm test
```

## Deployment

Deploy your function to Functions.do:

```bash
# Deploy to production
npx wrangler deploy

# Deploy to staging
npx wrangler deploy --env staging
```

### Deployment Configuration

Add multiple environments to wrangler.toml:

```toml
name = "my-function"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[env.staging]
name = "my-function-staging"
vars = { ENVIRONMENT = "staging" }

[env.production]
name = "my-function-production"
vars = { ENVIRONMENT = "production" }
```

## Troubleshooting

### Common Issues

#### Type Errors with Workers Types

If you see type errors related to Cloudflare Workers types, ensure you have:

1. Installed @cloudflare/workers-types
2. Added the types to tsconfig.json
3. Restarted your TypeScript server

```bash
npm install -D @cloudflare/workers-types@latest
```

#### Module Resolution Issues

If imports aren't resolving correctly:

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler"
  }
}
```

#### Environment Variables Not Available

Ensure variables are defined in wrangler.toml:

```toml
[vars]
MY_VAR = "value"
```

Or use secrets for sensitive values:

```bash
npx wrangler secret put MY_SECRET
```

#### Request Body Already Read

The request body can only be read once. Clone the request if you need to read it multiple times:

```typescript
// Clone request to read body multiple times
export async function readBodyTwice(request: Request) {
  const clonedRequest = request.clone()
  const body1 = await request.json()
  const body2 = await clonedRequest.json()
  return { body1, body2 }
}
```

### FAQ

**Q: What TypeScript version is supported?**
A: TypeScript 5.0+ is recommended. The Workers runtime supports ES2022 features.

**Q: Can I use npm packages?**
A: Yes, most npm packages work. However, packages that rely on Node.js-specific APIs may not be compatible.

**Q: How do I handle CORS?**
A: Add CORS headers to your response:

```typescript
// CORS headers configuration
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
```

**Q: What's the maximum execution time?**
A: Functions have a 30-second CPU time limit on the paid plan, 10ms on free.

## Next Steps

- [SDK Reference](/docs/sdk)
- [API Documentation](/docs/api)
- [Examples Repository](https://github.com/dotdo/functions-examples)
