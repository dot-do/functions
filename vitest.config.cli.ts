import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/cli/**/*.test.ts'],
    testTimeout: 60000,
  },
})
