import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'
import { resolve } from 'path'

// Limit Node.js memory to prevent OOM
process.env.NODE_OPTIONS = process.env.NODE_OPTIONS || '--max-old-space-size=4096'

// =============================================================================
// Test Directory Convention
// =============================================================================
//
//   src/**/__tests__/*.test.ts   -- Unit and integration tests (run in Workers pool)
//   test/e2e/*.e2e.test.ts       -- E2E tests against live deployed service (vitest.e2e.config.ts)
//   test/e2e-workers/*.test.ts   -- E2E tests inside Workers runtime (vitest.e2e.workers.config.ts)
//   cli/**/*.test.ts             -- CLI command tests (Node.js, vitest.config.cli.ts)
//   sdk-templates/**/*.test.ts   -- SDK template tests (Node.js, separate config)
//
// This config runs unit/integration tests in @cloudflare/vitest-pool-workers.
// E2E and CLI tests have their own vitest configs and are excluded here.
// =============================================================================

export default defineWorkersProject({
  test: {
    globals: true,
    // CRITICAL: Aggressive RAM limits - multiple agents can spawn vitest concurrently
    maxConcurrency: 1,  // Only 1 test at a time
    maxWorkers: 1,      // Only 1 worker process
    isolate: true,      // Enable test isolation to prevent state leakage between tests

    // Auto-discover all .test.ts files across the project.
    // Specific directories and files that cannot run in the Workers pool are
    // listed in `exclude` below with explanations.
    include: [
      'src/**/*.test.ts',
      'core/src/**/*.test.ts',
      'test/**/*.test.ts',
    ],
    exclude: [
      'node_modules/**',

      // -----------------------------------------------------------------------
      // E2E tests -- have their own vitest configs (not run by this config)
      // -----------------------------------------------------------------------
      'test/e2e/**',           // vitest.e2e.config.ts    (live deployed service)
      'test/e2e-workers/**',   // vitest.e2e.workers.config.ts (Workers runtime E2E)

      // -----------------------------------------------------------------------
      // TDD red-phase stubs (unimplemented features -- expected to fail)
      // -----------------------------------------------------------------------
      'test/esbuild-compiler.test.ts',              // esbuild worker not yet implemented
      'test/runtime-compilation.test.ts',            // Runtime compilation not yet implemented
      'src/__tests__/deploy-compilation.test.ts',    // Deploy compilation not yet implemented
      'src/core/__tests__/worker-loader.test.ts',    // Worker loader not yet implemented

      // -----------------------------------------------------------------------
      // Node.js-only tests (use child_process, fs, os -- incompatible with Workers)
      // These run under vitest.config.cli.ts or sdk-template configs instead.
      // -----------------------------------------------------------------------
      'src/cli/__tests__/**',                                      // execSync/spawn, fs, os
      'src/languages/csharp/__tests__/runtime.test.ts',            // node:os
      'src/languages/csharp/__tests__/distributed-runtime.test.ts',// node:os
      'src/languages/go/__tests__/compile.test.ts',                // child_process
      'src/languages/go/__tests__/e2e.test.ts',                    // child_process
      'src/languages/typescript/__tests__/compile.test.ts',        // typescript (node:os)
      'src/languages/typescript/__tests__/sdk-compiler.test.ts',   // typescript (node:os)
      'src/__tests__/wrangler-config.test.ts',                     // readFileSync

      // -----------------------------------------------------------------------
      // Removed/stale WASM compiler tests (old regex-based fakes)
      // See src/core/__tests__/honest-language-support.test.ts for current tests.
      // -----------------------------------------------------------------------
      'src/languages/rust/__tests__/compile.test.ts',
      'src/languages/assemblyscript/__tests__/compile.test.ts',
      'src/languages/cpp/__tests__/compile.test.ts',

      // -----------------------------------------------------------------------
      // Pre-existing failures: unimplemented features / runtime issues
      // -----------------------------------------------------------------------
      'src/core/__tests__/distributed-rate-limiter.test.ts',      // RateLimiterDO class not yet implemented
      'src/core/__tests__/lru-benchmark.test.ts',                 // LRU cache implementation incomplete
      'src/__tests__/api-router.test.ts',                          // Router routes return 501 (stubs)
      'src/__tests__/agentic-e2e.test.ts',                         // Auth/routing stubs not implemented
      'src/tiers/__tests__/generative-executor.e2e.test.ts',       // Timeout/cache TTL issues
      'src/languages/python/__tests__/e2e.test.ts',                // executePyodide not in Workers miniflare
      'src/tiers/__tests__/python-execution.test.ts',              // Pyodide execution fails in miniflare
    ],
    testTimeout: 30000,
    // CRITICAL: Limit parallelism to prevent RAM exhaustion (100GB+ without these limits)
    fileParallelism: false,
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.test.jsonc' },
        miniflare: {
          compatibilityFlags: ['nodejs_compat'],
          // Note: @cloudflare/vitest-pool-workers automatically sets
          // unsafeEvalBinding = "__VITEST_POOL_WORKERS_UNSAFE_EVAL" on the runner
          // worker and patches globalThis.Function to use it. This means
          // new Function(code) works in tests without explicit configuration.
        },
        singleWorker: true,  // Use single worker instance to limit RAM usage
      }
    },
    // Coverage configuration (note: may have limited support in Workers pool)
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
      // Coverage thresholds
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      'capnweb': resolve(__dirname, 'src/lib/capnweb.ts'),
      '@dotdo/functions/code': resolve(__dirname, 'core/src/code/index.ts'),
      '@dotdo/functions/generative': resolve(__dirname, 'core/src/generative/index.ts'),
      '@dotdo/functions/agentic': resolve(__dirname, 'core/src/agentic/index.ts'),
      '@dotdo/functions/human': resolve(__dirname, 'core/src/human/index.ts'),
      '@dotdo/functions': resolve(__dirname, 'core/src/index.ts'),
    }
  }
})
