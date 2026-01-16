import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['src/cli/**/*.test.ts', 'src/languages/**/*.test.ts', 'src/__tests__/wrangler-config.test.ts', 'src/__tests__/api-router.test.ts', 'src/__tests__/deploy-compilation.test.ts', 'cli/__tests__/**/*.test.ts', 'sdk-templates/**/__tests__/**/*.test.ts', 'docs/__tests__/**/*.test.ts', 'test/*.test.ts'],
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
  },
})
