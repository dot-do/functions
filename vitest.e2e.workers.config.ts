/**
 * Vitest Configuration for Workers-based E2E Tests
 *
 * This configuration runs E2E tests with the SDK client executing INSIDE a Worker,
 * not in Node.js. This tests the actual production scenario where customers use
 * the SDK client from their own Workers to call functions.do.
 *
 * Key differences from vitest.e2e.config.ts:
 * - Uses @cloudflare/vitest-pool-workers to run tests inside workerd
 * - Tests the SDK client in the Workers runtime environment
 * - Validates Workers-to-Workers communication patterns
 * - Tests service bindings and fetch-based invocation from Workers
 */

import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'
import { resolve } from 'path'

export default defineWorkersProject({
  test: {
    name: 'e2e-workers',
    globals: true,
    include: ['test/e2e-workers/**/*.test.ts'],
    exclude: ['node_modules/**'],
    testTimeout: 120_000, // 2 minutes per test - Workers E2E can be slow
    hookTimeout: 60_000,
    reporters: ['verbose'],
    // Run sequentially to avoid rate limits and resource contention
    maxConcurrency: 1,
    maxWorkers: 1,
    fileParallelism: false,
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.e2e.jsonc' },
        miniflare: {
          compatibilityFlags: ['nodejs_compat'],
        },
        singleWorker: true,
      },
    },
  },
  resolve: {
    alias: {
      '@dotdo/functions': resolve(__dirname, 'packages/functions-sdk/src/index.ts'),
    },
  },
})
