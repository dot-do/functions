import { defineConfig } from 'vitest/config'

// Limit Node.js memory to prevent OOM
process.env.NODE_OPTIONS = process.env.NODE_OPTIONS || '--max-old-space-size=4096'

export default defineConfig({
  test: {
    globals: true,
    // CRITICAL: Aggressive RAM limits - multiple agents can spawn vitest concurrently
    maxConcurrency: 1,  // Only 1 test at a time
    maxWorkers: 1,      // Only 1 worker process
    isolate: false,     // Reduce memory by not isolating each test
    fileParallelism: false,  // Run test files sequentially
    include: [
      // CLI tests use node:child_process for spawning processes
      'src/cli/**/*.test.ts',
      // Language tests import modules that use node:child_process
      'src/languages/**/*.test.ts',
      // Specific tests that need Node.js environment
      'src/__tests__/wrangler-config.test.ts',
      'src/__tests__/api-router.test.ts',
      'src/__tests__/deploy-compilation.test.ts',
      'src/__tests__/agentic-e2e.test.ts',
      // CLI tests outside src/
      'cli/__tests__/**/*.test.ts',
      // SDK template tests use node:child_process
      'sdk-templates/**/__tests__/**/*.test.ts',
      // Doc tests
      'docs/__tests__/**/*.test.ts',
      // E2E tests
      'test/*.test.ts',
      // Core tests run in Node.js environment
      // Exception: worker-loader.test.ts uses cloudflare:test and runs in Workers
      'src/core/__tests__/auth.test.ts',
      'src/core/__tests__/cascade-executor.test.ts',
      'src/core/__tests__/code-storage.test.ts',
      'src/core/__tests__/distributed-rate-limiter.test.ts',
      'src/core/__tests__/function-loader.test.ts',
      'src/core/__tests__/function-registry.test.ts',
      'src/core/__tests__/function-target.test.ts',
      'src/core/__tests__/kv-api-keys.test.ts',
      'src/core/__tests__/kv-code-storage.test.ts',
      'src/core/__tests__/kv-registry.test.ts',
      'src/core/__tests__/lru-benchmark.test.ts',
      'src/core/__tests__/rate-limiter.test.ts',
      'src/core/__tests__/routing-utils.test.ts',
      'src/core/__tests__/ts-strip.test.ts',
      'src/core/cascade-constants.test.ts',
      // Schema tests
      'core/src/__tests__/schemas.test.ts',
      // AI tests
      'src/ai/__tests__/*.test.ts',
      // Generative executor tests (require ai-functions package)
      'src/tiers/__tests__/generative-executor.test.ts',
    ],
    exclude: ['node_modules/**'],
    testTimeout: 30000,
    // Use Node.js environment for CLI tests
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    // Don't transform pyodide as it has its own path resolution
    server: {
      deps: {
        external: ['pyodide'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'src/**/*.ts',
        'core/src/**/*.ts',
      ],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/test-utils/**',
        '**/__tests__/**',
        '**/__mocks__/**',
        '**/types/**',
        '**/*.d.ts',
      ],
      // Coverage thresholds - start with reasonable defaults
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50,
      },
    },
  },
})
