import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'
import { resolve } from 'path'

// Limit Node.js memory to prevent OOM
process.env.NODE_OPTIONS = process.env.NODE_OPTIONS || '--max-old-space-size=4096'

export default defineWorkersProject({
  test: {
    globals: true,
    // CRITICAL: Aggressive RAM limits - multiple agents can spawn vitest concurrently
    maxConcurrency: 1,  // Only 1 test at a time
    maxWorkers: 1,      // Only 1 worker process
    isolate: false,     // Reduce memory by not isolating each test
    include: ['src/**/*.test.ts', 'core/src/**/*.test.ts'],
    exclude: [
      'node_modules/**',
      // CLI tests use node:child_process for spawning processes
      'src/cli/**/*.test.ts',
      // Language tests import modules that use node:child_process
      'src/languages/**/*.test.ts',
      // These tests are explicitly run in Node.js environment
      'src/__tests__/wrangler-config.test.ts',
      'src/__tests__/api-router.test.ts',
      'src/__tests__/deploy-compilation.test.ts',
      'src/__tests__/agentic-e2e.test.ts',
      'core/src/__tests__/schemas.test.ts',
      // Core tests run in Node.js environment to avoid conflicts
      'src/core/__tests__/worker-loader.test.ts',
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
      // AI tests run in Node.js environment
      'src/ai/__tests__/*.test.ts',
      // SDK template tests use node:child_process
      'sdk-templates/**/*.test.ts',
      // CLI tests outside src/
      'cli/**/*.test.ts',
      // Doc tests run in Node.js
      'docs/**/*.test.ts',
      // E2E tests
      'test/**/*.test.ts',
      // Template literals tests run in Node.js
      'src/__tests__/template-literals.test.ts',
    ],
    testTimeout: 30000,
    // CRITICAL: Limit parallelism to prevent RAM exhaustion (100GB+ without these limits)
    fileParallelism: false,
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.test.jsonc' },
        miniflare: {
          compatibilityFlags: ['nodejs_compat']
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
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50,
      },
    },
  },
  resolve: {
    alias: {
      'capnweb': resolve(__dirname, 'src/lib/capnweb.ts')
    }
  }
})
