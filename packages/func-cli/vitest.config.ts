import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['cli/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10000,
    hookTimeout: 10000,
  },
})
