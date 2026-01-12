import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['src/cli/**/*.test.ts', 'src/languages/**/*.test.ts'],
    exclude: ['node_modules/**'],
    testTimeout: 30000,
    // Use Node.js environment for CLI tests
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
})
