import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'
import { resolve } from 'path'

export default defineWorkersProject({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'src/cli/**/*.test.ts', 'src/languages/**/*.test.ts'],
    testTimeout: 30000,
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          compatibilityFlags: ['nodejs_compat']
        }
      }
    }
  },
  resolve: {
    alias: {
      'capnweb': resolve(__dirname, 'src/lib/capnweb.ts')
    }
  }
})
