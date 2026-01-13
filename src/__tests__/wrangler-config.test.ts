/**
 * Wrangler Configuration Tests
 *
 * Validates the production wrangler.jsonc configuration for functions.do
 * Ensures proper structure following the fsx.do/gitx.do pattern
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Parse JSONC (JSON with comments)
function parseJsonc(content: string): unknown {
  // Remove single-line comments
  const withoutComments = content.replace(/\/\/.*$/gm, '')
  return JSON.parse(withoutComments)
}

describe('Wrangler Configuration', () => {
  let config: Record<string, unknown>

  beforeAll(() => {
    const configPath = resolve(__dirname, '../../wrangler.jsonc')
    const content = readFileSync(configPath, 'utf-8')
    config = parseJsonc(content) as Record<string, unknown>
  })

  describe('Basic Configuration', () => {
    it('should have the correct worker name', () => {
      expect(config.name).toBe('functions-do')
    })

    it('should have the correct main entry point', () => {
      expect(config.main).toBe('src/index.ts')
    })

    it('should have a valid compatibility date', () => {
      expect(config.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('should enable nodejs_compat flag', () => {
      expect(config.compatibility_flags).toContain('nodejs_compat')
    })

    it('should include JSON schema reference', () => {
      expect(config.$schema).toBe('node_modules/wrangler/config-schema.json')
    })
  })

  describe('Routes Configuration', () => {
    it('should have routes array', () => {
      expect(Array.isArray(config.routes)).toBe(true)
    })

    it('should configure functions.do custom domain', () => {
      const routes = config.routes as Array<{ pattern: string; custom_domain: boolean }>
      const functionsRoute = routes.find((r) => r.pattern === 'functions.do')
      expect(functionsRoute).toBeDefined()
      expect(functionsRoute?.custom_domain).toBe(true)
    })
  })

  describe('KV Namespaces', () => {
    let kvNamespaces: Array<{ binding: string; id: string }>

    beforeAll(() => {
      kvNamespaces = config.kv_namespaces as Array<{ binding: string; id: string }>
    })

    it('should have kv_namespaces array', () => {
      expect(Array.isArray(kvNamespaces)).toBe(true)
    })

    it('should have FUNCTIONS_REGISTRY KV binding', () => {
      const registry = kvNamespaces.find((kv) => kv.binding === 'FUNCTIONS_REGISTRY')
      expect(registry).toBeDefined()
      expect(registry?.id).toBeTruthy()
    })

    it('should have FUNCTIONS_CODE KV binding', () => {
      const code = kvNamespaces.find((kv) => kv.binding === 'FUNCTIONS_CODE')
      expect(code).toBeDefined()
      expect(code?.id).toBeTruthy()
    })

    it('should have FUNCTIONS_API_KEYS KV binding', () => {
      const apiKeys = kvNamespaces.find((kv) => kv.binding === 'FUNCTIONS_API_KEYS')
      expect(apiKeys).toBeDefined()
      expect(apiKeys?.id).toBeTruthy()
    })

    it('should have exactly 3 KV namespaces', () => {
      expect(kvNamespaces.length).toBe(3)
    })
  })

  describe('Durable Objects', () => {
    let durableObjects: { bindings: Array<{ name: string; class_name: string }> }

    beforeAll(() => {
      durableObjects = config.durable_objects as typeof durableObjects
    })

    it('should have durable_objects configuration', () => {
      expect(durableObjects).toBeDefined()
      expect(Array.isArray(durableObjects.bindings)).toBe(true)
    })

    it('should have FunctionExecutor Durable Object binding', () => {
      const executor = durableObjects.bindings.find((b) => b.class_name === 'FunctionExecutor')
      expect(executor).toBeDefined()
      expect(executor?.name).toBe('FUNCTION_EXECUTOR')
    })

    it('should have FunctionLogs Durable Object binding', () => {
      const logs = durableObjects.bindings.find((b) => b.class_name === 'FunctionLogs')
      expect(logs).toBeDefined()
      expect(logs?.name).toBe('FUNCTION_LOGS')
    })

    it('should have exactly 2 Durable Object bindings', () => {
      expect(durableObjects.bindings.length).toBe(2)
    })
  })

  describe('Migrations', () => {
    let migrations: Array<{ tag: string; new_classes?: string[] }>

    beforeAll(() => {
      migrations = config.migrations as typeof migrations
    })

    it('should have migrations array', () => {
      expect(Array.isArray(migrations)).toBe(true)
    })

    it('should have v1 migration with FunctionExecutor and FunctionLogs', () => {
      const v1 = migrations.find((m) => m.tag === 'v1')
      expect(v1).toBeDefined()
      expect(v1?.new_classes).toContain('FunctionExecutor')
      expect(v1?.new_classes).toContain('FunctionLogs')
    })
  })

  describe('Service Bindings', () => {
    let services: Array<{ binding: string; service: string; environment: string }>

    beforeAll(() => {
      services = config.services as typeof services
    })

    it('should have services array', () => {
      expect(Array.isArray(services)).toBe(true)
    })

    it('should have FSX service binding to fsx-do', () => {
      const fsx = services.find((s) => s.binding === 'FSX')
      expect(fsx).toBeDefined()
      expect(fsx?.service).toBe('fsx-do')
      expect(fsx?.environment).toBe('production')
    })

    it('should have BASHX service binding to bashx-do', () => {
      const bashx = services.find((s) => s.binding === 'BASHX')
      expect(bashx).toBeDefined()
      expect(bashx?.service).toBe('bashx-do')
      expect(bashx?.environment).toBe('production')
    })
  })

  describe('Environment Variables', () => {
    let vars: Record<string, string>

    beforeAll(() => {
      vars = config.vars as Record<string, string>
    })

    it('should have vars configuration', () => {
      expect(vars).toBeDefined()
    })

    it('should set ENVIRONMENT to production', () => {
      expect(vars.ENVIRONMENT).toBe('production')
    })

    it('should set SERVICE_NAME to functions.do', () => {
      expect(vars.SERVICE_NAME).toBe('functions.do')
    })
  })

  describe('Observability', () => {
    let observability: { enabled: boolean; head_sampling_rate?: number }

    beforeAll(() => {
      observability = config.observability as typeof observability
    })

    it('should have observability configuration', () => {
      expect(observability).toBeDefined()
    })

    it('should enable observability', () => {
      expect(observability.enabled).toBe(true)
    })

    it('should have head_sampling_rate set to 1 for full sampling', () => {
      expect(observability.head_sampling_rate).toBe(1)
    })
  })

  describe('Configuration Pattern Compliance', () => {
    it('should follow dotdo naming convention (functions-do)', () => {
      expect(config.name).toMatch(/-do$/)
    })

    it('should have all required production sections', () => {
      const requiredSections = [
        'name',
        'main',
        'compatibility_date',
        'compatibility_flags',
        'routes',
        'kv_namespaces',
        'durable_objects',
        'migrations',
        'services',
        'vars',
        'observability',
      ]

      for (const section of requiredSections) {
        expect(config).toHaveProperty(section)
      }
    })

    it('should use custom_domain pattern for routes', () => {
      const routes = config.routes as Array<{ custom_domain?: boolean }>
      const hasCustomDomain = routes.some((r) => r.custom_domain === true)
      expect(hasCustomDomain).toBe(true)
    })
  })
})
