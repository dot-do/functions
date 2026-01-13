# Getting Started with Functions.do

Welcome to Functions.do! This guide will help you deploy your first serverless function to the global edge in minutes.

## Introduction

Functions.do is a multi-language serverless platform that runs your code at the edge on Cloudflare Workers. Deploy TypeScript, Rust, Python, Go, and more with zero cold starts and global performance.

### Key Benefits

- **Global Edge Deployment**: Your functions run in 300+ data centers worldwide
- **Fast Cold Starts**: Sub-millisecond startup times for TypeScript and Rust
- **Multi-Language Support**: Write functions in TypeScript, Rust, Python, Go, AssemblyScript, Zig, or C#
- **Quick Setup**: Deploy in under 5 minutes with our CLI

## Prerequisites

Before you begin, make sure you have the following installed:

- **Node.js 18+** - Download from [nodejs.org](https://nodejs.org/)
- **npm** (included with Node.js)
- A **Cloudflare account** - Sign up at [cloudflare.com](https://www.cloudflare.com/)

Verify your Node.js installation:

```bash
node --version
```

You should see `v18.0.0` or higher.

## Installation

The quickest way to get started is using npx to scaffold new projects:

```bash
npx create-function my-function --lang typescript
```

Alternatively, you can install the create-function CLI globally:

```bash
npm install -g create-function
```

The CLI also installs wrangler as a dependency, which handles local development and deployment to Cloudflare Workers.

## Your First Function

Let's create and deploy a simple "Hello World" function.

### Step 1: Create a New Project

Run the create-function command with the `--lang` flag to specify TypeScript:

```bash
npx create-function hello-world --lang typescript
```

This creates a new project with the following directory structure:

```
hello-world/
├── src/
│   └── index.ts
├── package.json
├── tsconfig.json
└── wrangler.toml
```

### Step 2: Navigate to Your Project

```bash
cd hello-world
```

### Step 3: Explore the Function Code

Your `src/index.ts` file contains a simple function handler:

```typescript
export interface Env {
  // Add your bindings here
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const name = url.searchParams.get("name") || "World"

    return new Response(`Hello, ${name}!`, {
      headers: { "Content-Type": "text/plain" },
    })
  },
}
```

This function:
- Exports a default handler following the Cloudflare Workers pattern
- Accepts an optional `name` query parameter
- Returns a text Response with a greeting

### Step 4: Run Locally

Start the local development server:

```bash
npm run dev
```

This runs `wrangler dev` under the hood. Visit `http://localhost:8787` in your browser to see your function in action.

**Expected output:**
```
Hello, World!
```

Try adding a name parameter: `http://localhost:8787?name=Developer`

**Expected output:**
```
Hello, Developer!
```

### Step 5: Deploy to Production

When you're ready to deploy, first authenticate with Cloudflare:

```bash
npx wrangler login
```

Then deploy your function:

```bash
npm run deploy
```

Your function is now live at a URL like `https://hello-world.<your-subdomain>.workers.dev`.

## Understanding the Code

Let's break down the key parts of a Functions.do function:

```typescript
// Define your environment bindings (KV, D1, R2, etc.)
export interface Env {
  MY_KV_NAMESPACE: KVNamespace
}

// Export default handler - this is the entry point
export default {
  // The fetch handler receives incoming HTTP requests
  async fetch(request: Request, env: Env): Promise<Response> {
    // Process the request
    const data = await processRequest(request)

    // Return a Response object
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  },
}

async function processRequest(request: Request): Promise<object> {
  return { message: "Success", timestamp: Date.now() }
}
```

## What's Next

Now that you've deployed your first function, explore these resources to learn more:

- [API Reference](/docs/api-reference) - Complete API documentation
- [TypeScript Guide](/docs/languages/typescript) - Deep dive into TypeScript functions
- [Rust Guide](/docs/languages/rust) - Build high-performance functions with Rust
- [Python Guide](/docs/languages/python) - Use Python with Pyodide runtime
- [Examples](/docs/examples) - Real-world function examples and tutorials
- [Tutorials](/docs/tutorials) - Step-by-step guides for common use cases

### Supported Languages

Functions.do supports multiple programming languages:

| Language | Status | Use Case |
|----------|--------|----------|
| TypeScript | Stable | General purpose, fastest cold starts |
| Rust | Stable | High performance, WebAssembly |
| Python | Beta | Data processing, ML inference |
| Go | Beta | System utilities, networking |
| AssemblyScript | Alpha | WebAssembly without Rust |
| Zig | Alpha | Low-level performance |
| C# | Alpha | .NET ecosystem |

## Need Help?

- Check our [Examples](/docs/examples) for common patterns
- Read the [Troubleshooting Guide](/docs/troubleshooting)
- Join our community on [Discord](https://discord.gg/functions-do)
- Visit [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/)
