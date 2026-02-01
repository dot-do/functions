# E2E Testing Guide

This directory contains end-to-end tests for the functions.do platform. These tests deploy real functions to the live environment and verify they work correctly.

## Test Structure

```
test/e2e/
├── config.ts              # Shared configuration and utilities
├── cascade.e2e.test.ts    # Cascade execution (code->generative->agentic->human)
├── code.e2e.test.ts       # Code function lifecycle tests
├── generative.e2e.test.ts # AI generative function tests
├── agentic.e2e.test.ts    # Autonomous AI agent tests
├── human.e2e.test.ts      # Human-in-the-loop function tests
├── typescript.e2e.test.ts # TypeScript function compilation tests
├── python.e2e.test.ts     # Python/Pyodide function tests
├── rust.e2e.test.ts       # Rust WASM function tests
├── go.e2e.test.ts         # Go WASM function tests
└── rollback.e2e.test.ts   # Function version rollback tests
```

## Running E2E Tests

### Prerequisites

1. **Environment Variables**:
   ```bash
   # Required for basic tests
   export FUNCTIONS_E2E_URL="https://functions-do.dotdo.workers.dev"

   # Optional: API key for authenticated requests
   export FUNCTIONS_API_KEY="your-api-key"

   # Optional: Required for dispatch namespace uploads
   export CLOUDFLARE_API_TOKEN="your-cloudflare-token"
   export CLOUDFLARE_ACCOUNT_ID="your-account-id"

   # Optional: Required for AI-powered function tests
   export OPENAI_API_KEY="your-openai-key"
   ```

2. **Dependencies**:
   ```bash
   npm install
   ```

### Running Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run specific test file
npx vitest run --config vitest.e2e.config.ts test/e2e/typescript.e2e.test.ts

# Run with verbose output
npx vitest run --config vitest.e2e.config.ts --reporter=verbose

# Run and keep watching
npx vitest --config vitest.e2e.config.ts
```

### Debugging Tests

```bash
# Skip cleanup for debugging deployed functions
export E2E_SKIP_CLEANUP=true
npm run test:e2e

# View test function in logs
# Functions are prefixed with "e2e-test-" for easy identification
```

## Test Categories

### Code Functions
Tests for pure code execution without AI:
- TypeScript/JavaScript compilation and execution
- Python via Pyodide
- Rust via WebAssembly
- Go via TinyGo/WebAssembly

### Generative Functions
Tests for AI-powered text generation:
- Schema-based responses
- Structured output validation
- AI model integration

### Agentic Functions
Tests for autonomous AI agents:
- Multi-step task execution
- Tool usage
- Goal completion

### Human Functions
Tests for human-in-the-loop workflows:
- Task creation and assignment
- Human approval flows
- Async task completion

### Cascade Functions
Tests for tiered execution:
- Code tier fallback to AI
- Escalation through tiers
- Confidence-based routing

## Configuration

The `config.ts` file provides shared utilities:

```typescript
import {
  E2E_CONFIG,
  generateTestFunctionId,
  deployFunction,
  invokeFunction,
  deleteFunction
} from './config'

// Deploy a function
const result = await deployFunction({
  id: generateTestFunctionId(),
  code: 'export default () => ({ hello: "world" })',
  language: 'typescript'
})

// Invoke the function
const response = await invokeFunction(result.id, { input: 'data' })

// Clean up
await deleteFunction(result.id)
```

### Timeouts

| Operation | Default Timeout |
|-----------|-----------------|
| Deploy | 60,000ms |
| Invoke | 10,000ms |
| Deploy + Invoke | 90,000ms |
| Test (per test) | 60,000ms |

## CI Integration

E2E tests run automatically in GitHub Actions:

- **On push to main**: Full E2E test suite runs after unit tests pass
- **On pull requests**: Unit tests only (E2E skipped to protect secrets)
- **Manual trigger**: E2E can be run manually via workflow dispatch

### Required Secrets

Configure these in your GitHub repository settings:

| Secret | Description |
|--------|-------------|
| `FUNCTIONS_E2E_URL` | Base URL for E2E tests |
| `FUNCTIONS_API_KEY` | API key for authenticated requests |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token for deployments |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `OPENAI_API_KEY` | OpenAI API key for AI function tests |

## Writing New Tests

1. Create a new file: `test/e2e/[feature].e2e.test.ts`
2. Import utilities from `config.ts`
3. Use `describe.skipIf()` for conditional execution
4. Always clean up deployed functions in `afterAll`

Example:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  E2E_CONFIG,
  generateTestFunctionId,
  deployFunction,
  invokeFunction,
  deleteFunction,
  shouldRunE2E
} from './config'

describe.skipIf(!shouldRunE2E())('My Feature E2E', () => {
  const functionIds: string[] = []

  afterAll(async () => {
    if (!E2E_CONFIG.skipCleanup) {
      await Promise.all(functionIds.map(deleteFunction))
    }
  })

  it('should do something', async () => {
    const id = generateTestFunctionId()
    functionIds.push(id)

    await deployFunction({
      id,
      code: 'export default () => ({ result: "success" })',
      language: 'typescript'
    })

    const result = await invokeFunction(id)
    expect(result).toEqual({ result: 'success' })
  }, E2E_CONFIG.deployInvokeTimeout)
})
```

## Troubleshooting

### Tests timing out
- Check if the functions.do service is healthy
- Increase timeouts in `vitest.e2e.config.ts`
- Check network connectivity

### Deployment failures
- Verify `CLOUDFLARE_API_TOKEN` has correct permissions
- Check Cloudflare account quota limits
- Review wrangler logs for details

### AI function tests failing
- Verify `OPENAI_API_KEY` is set and valid
- Check OpenAI API quota
- AI responses may vary; tests should be resilient

### Cleanup not working
- Check if `E2E_SKIP_CLEANUP=true` is accidentally set
- Manually delete test functions with `e2e-test-` prefix
- Check API key permissions for DELETE operations
