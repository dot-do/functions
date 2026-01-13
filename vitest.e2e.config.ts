import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    testTimeout: 60000, // 60s per test (deployments can be slow)
    hookTimeout: 30000,
    reporters: ['verbose'],
    // Run sequentially to avoid rate limits
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
})
