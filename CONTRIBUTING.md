# Contributing to Functions.do

Thank you for your interest in contributing to Functions.do! This guide will help you get started with development, understand our code standards, and navigate the contribution process.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Architecture](#project-architecture)
- [Code Style and Conventions](#code-style-and-conventions)
- [Testing Requirements](#testing-requirements)
- [Pull Request Process](#pull-request-process)
- [Issue Labeling and Triage](#issue-labeling-and-triage)
- [Adding New Language Support](#adding-new-language-support)
- [Adding New Tier Executors](#adding-new-tier-executors)

## Development Setup

### Prerequisites

- Node.js 20.x or higher
- pnpm (recommended) or npm
- Git
- For WASM development: Rust toolchain with `wasm32-unknown-unknown` target

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/dot-do/functions.git
   cd functions
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Run the type checker:
   ```bash
   pnpm typecheck
   ```

4. Run tests:
   ```bash
   pnpm test:run
   ```

### Development Workflow

```bash
# Start local development server (uses Wrangler/Miniflare)
pnpm dev

# Run unit tests in watch mode
pnpm test:watch

# Run all tests (Workers pool + Node.js pool)
pnpm test:all

# Type check without emitting
pnpm typecheck

# Build the project
pnpm build
```

### Environment Variables

For E2E tests, you may need:

```bash
export FUNCTIONS_E2E_URL="https://functions-do.dotdo.workers.dev"
export OPENAI_API_KEY="your-key"  # For AI function tests
```

## Project Architecture

Functions.do is a multi-language serverless platform built on Cloudflare Workers. The codebase is organized as follows:

```
functions/
├── src/                      # Main source code
│   ├── api/                  # HTTP API handlers and middleware
│   │   ├── executors/        # API-level executor wrappers
│   │   ├── middleware/       # Auth, rate limiting
│   │   └── validation/       # Input validation
│   ├── cli/                  # CLI tool (dotdo/functions commands)
│   ├── core/                 # Core utilities (auth, storage, routing)
│   ├── do/                   # Durable Objects (FunctionExecutor, etc.)
│   ├── languages/            # Language-specific compilers
│   │   ├── typescript/       # TypeScript/JavaScript compilation
│   │   ├── rust/             # Rust to WASM compilation
│   │   ├── go/               # Go (TinyGo) to WASM
│   │   ├── python/           # Python via Pyodide
│   │   ├── csharp/           # C# distributed runtime
│   │   ├── zig/              # Zig to WASM
│   │   └── assemblyscript/   # AssemblyScript to WASM
│   ├── sdk/                  # Client SDK
│   ├── tiers/                # Execution tier implementations
│   │   ├── code-executor.ts      # Code function executor
│   │   ├── generative-executor.ts # AI generative executor
│   │   ├── agentic-executor.ts    # Multi-step agent executor
│   │   └── human-executor.ts      # Human-in-the-loop executor
│   └── test-utils/           # Shared test utilities
├── core/                     # @dotdo/functions package (types & SDK)
│   └── src/
│       ├── types.ts          # Core type definitions
│       ├── code/             # Code function types
│       ├── generative/       # Generative function types
│       ├── agentic/          # Agentic function types
│       ├── human/            # Human function types
│       └── cascade.ts        # Cascade execution types
├── packages/                 # Additional packages
│   ├── create-function/      # Project scaffolding
│   ├── func-cli/             # CLI implementation
│   └── functions-sdk/        # SDK implementation
└── test/                     # E2E tests
```

### Key Concepts

1. **Execution Tiers**: Functions can run in 4 tiers with increasing capability and cost:
   - **Code** (5s timeout): Deterministic code in Worker Loader, WASM, or ai-evaluate
   - **Generative** (30s timeout): Single AI call with structured output
   - **Agentic** (5m timeout): Multi-step AI with tool use
   - **Human** (24h timeout): Human-in-the-loop approval/input

2. **Cascade Execution**: Functions can define handlers for multiple tiers and automatically escalate through them.

3. **Language Support**: Code is compiled to ESM (JavaScript) or WASM for execution in Cloudflare Workers V8 isolates.

4. **capnweb Integration**: Zero-latency RPC between workers for distributed runtime architecture.

## Code Style and Conventions

### TypeScript Configuration

We use strict TypeScript with the following key settings:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### Naming Conventions

- **Files**: Use kebab-case for file names (`code-executor.ts`, `rate-limiter.ts`)
- **Types/Interfaces**: Use PascalCase (`CodeFunctionDefinition`, `ExecutionContext`)
- **Functions/Variables**: Use camelCase (`compileRust`, `executeCode`)
- **Constants**: Use UPPER_SNAKE_CASE for true constants (`DEFAULT_TIMEOUT_MS`, `WASM_MAGIC`)

### Code Organization

```typescript
/**
 * Module description at the top
 */

// ============================================================================
// IMPORTS
// ============================================================================

import type { ... } from '...'  // Type imports first
import { ... } from '...'        // Value imports second

// ============================================================================
// TYPES
// ============================================================================

export interface MyInterface { ... }
export type MyType = ...

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_VALUE = 42

// ============================================================================
// IMPLEMENTATION
// ============================================================================

export function myFunction() { ... }

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

function helperFunction() { ... }
```

### Error Handling

- Use typed errors that extend `Error`
- Include relevant context in error messages
- Use the `FunctionError` type for function execution errors:

```typescript
const error: FunctionError = {
  name: 'ValidationError',
  message: 'Input validation failed: missing required field "name"',
  code: 'VALIDATION_FAILED',
  retryable: false,
}
```

### Documentation

- Document all exported functions, types, and classes with JSDoc
- Include `@example` blocks for complex APIs
- Use `@param` and `@returns` tags

```typescript
/**
 * Compile Rust source code to WebAssembly
 *
 * @param code - The Rust source code to compile
 * @param options - Compilation options
 * @returns The compiled WASM binary and metadata
 *
 * @example
 * ```typescript
 * const result = await compileRust(`
 *   #[no_mangle]
 *   pub extern "C" fn add(a: i32, b: i32) -> i32 {
 *     a + b
 *   }
 * `)
 * console.log(result.exports) // ['add']
 * ```
 */
export async function compileRust(
  code: string,
  options?: CompileRustOptions
): Promise<CompileRustResult> { ... }
```

## Testing Requirements

### Test Framework

We use [Vitest](https://vitest.dev/) with two configurations:

1. **Workers Pool** (`vitest.config.ts`): Tests that run in Cloudflare Workers environment via `@cloudflare/vitest-pool-workers`
2. **Node.js Pool** (`vitest.node.config.ts`): Tests that need Node.js APIs (child_process, file system, etc.)

### Running Tests

```bash
# Run Workers pool tests
pnpm test:run

# Run Node.js pool tests (CLI, language compilers)
pnpm test:cli

# Run all tests
pnpm test:all

# Run E2E tests
pnpm test:e2e

# Run with coverage
pnpm test:run -- --coverage
```

### Test File Naming

- Place tests in `__tests__/` directories adjacent to the code they test
- Name test files with `.test.ts` suffix
- Example: `src/languages/rust/__tests__/compile.test.ts`

### Writing Tests

```typescript
import { describe, it, expect, beforeEach } from 'vitest'

describe('compileRust', () => {
  describe('basic compilation', () => {
    it('should compile a simple function', async () => {
      const result = await compileRust(`
        #[no_mangle]
        pub extern "C" fn add(a: i32, b: i32) -> i32 {
          a + b
        }
      `)

      expect(result.exports).toContain('add')
      expect(result.wasm).toBeInstanceOf(Uint8Array)
    })

    it('should reject invalid syntax', async () => {
      await expect(compileRust('fn broken(')).rejects.toThrow(
        'Rust compilation failed'
      )
    })
  })
})
```

### Coverage Requirements

We maintain minimum coverage thresholds:

| Metric | Threshold |
|--------|-----------|
| Lines | 50% |
| Functions | 50% |
| Branches | 50% |
| Statements | 50% |

PRs that decrease coverage below these thresholds will require justification.

### Test Categories

1. **Unit Tests**: Test individual functions/classes in isolation
2. **Integration Tests**: Test interactions between components
3. **E2E Tests**: Test full deployment and execution cycle

## Pull Request Process

### Before Submitting

1. **Check existing issues**: Look for related issues or discussions
2. **Create an issue first**: For significant changes, discuss the approach first
3. **Branch from `main`**: Create a feature branch with a descriptive name
   ```bash
   git checkout -b feature/add-lua-support
   git checkout -b fix/rust-compilation-error
   ```

### PR Requirements

1. **Tests**: Add tests for new functionality; ensure existing tests pass
2. **Types**: No `any` types without justification; maintain type safety
3. **Documentation**: Update relevant documentation (README, JSDoc, etc.)
4. **Changelog**: For user-facing changes, note what changed
5. **Size**: Keep PRs focused; split large changes into multiple PRs

### PR Template

```markdown
## Summary
Brief description of changes

## Changes
- Added X
- Fixed Y
- Updated Z

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests pass
- [ ] E2E tests pass (if applicable)

## Related Issues
Fixes #123
```

### Review Process

1. **Automated checks**: CI must pass (tests, type checking, linting)
2. **Code review**: At least one maintainer approval required
3. **Address feedback**: Respond to all comments before merge
4. **Squash and merge**: We use squash merges to keep history clean

### Commit Messages

Use conventional commit format:

```
type(scope): description

feat(rust): add wasm-bindgen support
fix(python): handle unicode in pyodide execution
docs(readme): update architecture diagram
test(tiers): add generative executor tests
refactor(core): extract rate limiter to separate module
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`

## Issue Labeling and Triage

### Labels

| Label | Description |
|-------|-------------|
| `bug` | Something isn't working |
| `enhancement` | New feature or request |
| `documentation` | Documentation improvements |
| `good first issue` | Good for newcomers |
| `help wanted` | Extra attention needed |
| `language:rust` | Rust/WASM related |
| `language:python` | Python/Pyodide related |
| `language:go` | Go/TinyGo related |
| `tier:code` | Code executor related |
| `tier:generative` | AI generative related |
| `tier:agentic` | Agent executor related |
| `tier:human` | Human-in-the-loop related |
| `priority:high` | High priority issue |
| `breaking` | Breaking change |

### Issue Templates

When creating issues, please include:

**Bug Reports:**
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment (Node version, OS, etc.)
- Relevant code/logs

**Feature Requests:**
- Use case description
- Proposed solution
- Alternatives considered

## Adding New Language Support

To add support for a new language (e.g., Lua):

### 1. Create the Language Module

Create a new directory under `src/languages/`:

```
src/languages/lua/
├── index.ts           # Public exports
├── compile.ts         # Compilation logic
└── __tests__/
    └── compile.test.ts
```

### 2. Define Types

```typescript
// src/languages/lua/compile.ts

export interface LuaCompileOptions {
  /** Optimization level */
  optimizationLevel?: 0 | 1 | 2 | 3
  /** Generate source maps */
  sourceMap?: boolean
}

export interface LuaCompileResult {
  /** Compiled output (WASM or JS) */
  output: Uint8Array | string
  /** Exported function names */
  exports: string[]
  /** Compilation timestamp */
  compiledAt: string
  /** Output size in bytes */
  size: number
}
```

### 3. Implement Compilation

```typescript
export async function compileLua(
  code: string,
  options?: LuaCompileOptions
): Promise<LuaCompileResult> {
  // 1. Validate syntax
  validateLuaSyntax(code)

  // 2. Parse function definitions
  const functions = parseLuaFunctions(code)

  // 3. Compile to target (WASM or JS)
  const output = await compileToTarget(functions, options)

  // 4. Extract exports
  const exports = functions.map(f => f.name)

  return {
    output,
    exports,
    compiledAt: new Date().toISOString(),
    size: output.length,
  }
}
```

### 4. Update the Languages Index

```typescript
// src/languages/index.ts

export * from './lua'
```

### 5. Add to CodeExecutor

Update `src/tiers/code-executor.ts`:

```typescript
const SUPPORTED_LANGUAGES: CodeLanguage[] = [
  'typescript',
  'javascript',
  'rust',
  'go',
  'python',
  'zig',
  'assemblyscript',
  'csharp',
  'lua',  // Add new language
]
```

### 6. Add Package Export

Update `package.json`:

```json
{
  "exports": {
    "./lua": {
      "types": "./dist/languages/lua/index.d.ts",
      "import": "./dist/languages/lua/index.js"
    }
  }
}
```

### 7. Write Tests

```typescript
// src/languages/lua/__tests__/compile.test.ts

describe('compileLua', () => {
  it('should compile a simple function', async () => {
    const result = await compileLua(`
      function add(a, b)
        return a + b
      end
    `)

    expect(result.exports).toContain('add')
  })
})
```

### 8. Document the Language

Update README.md with:
- Language support table entry
- Quick start example
- Any language-specific considerations

## Adding New Tier Executors

To add a new execution tier or enhance existing ones:

### 1. Understand the Tier Interface

Each tier implements a common pattern:

```typescript
// src/tiers/my-executor.ts

export interface MyExecutorConfig {
  // Configuration options
}

export interface MyExecutorResult<T> {
  executionId: string
  functionId: string
  status: 'completed' | 'failed' | 'timeout'
  output?: T
  error?: FunctionError
  metrics: ExecutionMetrics
}

export class MyExecutor {
  constructor(env: ExecutorEnv, config?: MyExecutorConfig) {}

  async execute<TInput, TOutput>(
    definition: MyFunctionDefinition<TInput, TOutput>,
    input: TInput,
    context?: ExecutionContext
  ): Promise<MyExecutorResult<TOutput>> {
    // Implementation
  }
}
```

### 2. Define the Function Type

Add types to `core/src/`:

```typescript
// core/src/my-tier/index.ts

export interface MyFunctionDefinition<TInput = unknown, TOutput = unknown> {
  id: string
  version?: string
  type: 'my-tier'
  // Tier-specific configuration
}

export interface MyFunctionConfig {
  timeout?: string | number
  // Additional config
}

export function defineMyFunction<TInput, TOutput>(
  definition: MyFunctionDefinition<TInput, TOutput>
): MyFunctionDefinition<TInput, TOutput> {
  return { ...definition, type: 'my-tier' }
}
```

### 3. Implement the Executor

```typescript
// src/tiers/my-executor.ts

export class MyExecutor {
  private readonly env: ExecutorEnv

  constructor(env: ExecutorEnv) {
    this.env = env
  }

  async execute<TInput, TOutput>(
    definition: MyFunctionDefinition<TInput, TOutput>,
    input: TInput,
    context?: ExecutionContext
  ): Promise<MyExecutorResult<TOutput>> {
    const executionId = context?.executionId ?? generateExecutionId()
    const startedAt = Date.now()

    try {
      // 1. Validate input
      // 2. Execute the function
      // 3. Return result with metrics

      return {
        executionId,
        functionId: definition.id,
        status: 'completed',
        output: result,
        metrics: {
          durationMs: Date.now() - startedAt,
          // ...
        },
      }
    } catch (error) {
      return {
        executionId,
        functionId: definition.id,
        status: 'failed',
        error: wrapError(error),
        metrics: { ... },
      }
    }
  }
}
```

### 4. Integrate with Cascade

If the tier should participate in cascade execution, update `core/src/cascade.ts`:

```typescript
export interface CascadeTiers<TInput, TOutput> {
  code?: CodeTierHandler<TInput, TOutput>
  generative?: GenerativeTierHandler<TInput, TOutput>
  myTier?: MyTierHandler<TInput, TOutput>  // Add new tier
  agentic?: AgenticTierHandler<TInput, TOutput>
  human?: HumanTierHandler<TInput, TOutput>
}

export const TIER_ORDER = ['code', 'generative', 'myTier', 'agentic', 'human'] as const
```

### 5. Write Comprehensive Tests

```typescript
describe('MyExecutor', () => {
  describe('execute', () => {
    it('should execute successfully', async () => { ... })
    it('should handle timeouts', async () => { ... })
    it('should handle errors gracefully', async () => { ... })
    it('should track metrics correctly', async () => { ... })
  })
})
```

---

## Questions?

- Open a [GitHub Discussion](https://github.com/dot-do/functions/discussions)
- Join our [Discord](https://discord.gg/functions-do)
- Check existing [issues](https://github.com/dot-do/functions/issues)

Thank you for contributing to Functions.do!
