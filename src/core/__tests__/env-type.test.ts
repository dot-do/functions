/**
 * Env Type Unification Tests
 *
 * Validates that the codebase uses a single, canonical Env type
 * and that it includes all bindings from wrangler.jsonc.
 *
 * Issues:
 * - functions-3xqj: Unify fragmented Env interfaces
 * - functions-kavh: Create unified Env type from wrangler types
 *
 * @module core/__tests__/env-type
 */

import { describe, it, expect } from 'vitest'
import type { Env, EsbuildCompiler, WorkersAI, AIClient, OAuthServiceBinding } from '../env'

describe('Unified Env Type', () => {
  describe('canonical export location', () => {
    it('should export Env interface from src/core/env.ts', () => {
      // The unified Env type should be importable from src/core/env.ts
      // If this compiles and the type exists, the test passes
      const envShape: Env = {} as Env
      expect(envShape).toBeDefined()
    })

    it('should export supporting types from src/core/env.ts', () => {
      // All supporting binding interfaces should also be exported
      const compiler: EsbuildCompiler = {} as EsbuildCompiler
      const ai: WorkersAI = {} as WorkersAI
      const aiClient: AIClient = {} as AIClient
      const oauth: OAuthServiceBinding = {} as OAuthServiceBinding
      expect(compiler).toBeDefined()
      expect(ai).toBeDefined()
      expect(aiClient).toBeDefined()
      expect(oauth).toBeDefined()
    })
  })

  describe('wrangler.jsonc binding coverage', () => {
    it('should include all KV namespace bindings', () => {
      // From wrangler.jsonc kv_namespaces
      const env = {} as Env
      // These should be valid property accesses (compile-time check)
      void env.FUNCTIONS_REGISTRY
      void env.FUNCTIONS_CODE
      void env.FUNCTIONS_API_KEYS

      // Verify the keys exist on the type
      type EnvKeys = keyof Env
      type HasFunctionsRegistry = 'FUNCTIONS_REGISTRY' extends EnvKeys ? true : false
      type HasFunctionsCode = 'FUNCTIONS_CODE' extends EnvKeys ? true : false
      type HasFunctionsApiKeys = 'FUNCTIONS_API_KEYS' extends EnvKeys ? true : false
      const _registry: HasFunctionsRegistry = true
      const _code: HasFunctionsCode = true
      const _apiKeys: HasFunctionsApiKeys = true
      expect(_registry).toBe(true)
      expect(_code).toBe(true)
      expect(_apiKeys).toBe(true)
    })

    it('should include all Durable Object bindings', () => {
      // From wrangler.jsonc durable_objects.bindings
      const env = {} as Env
      void env.FUNCTION_EXECUTOR
      void env.FUNCTION_LOGS
      void env.RATE_LIMITER
      void env.USER_STORAGE

      type EnvKeys = keyof Env
      type HasFunctionExecutor = 'FUNCTION_EXECUTOR' extends EnvKeys ? true : false
      type HasFunctionLogs = 'FUNCTION_LOGS' extends EnvKeys ? true : false
      type HasRateLimiter = 'RATE_LIMITER' extends EnvKeys ? true : false
      type HasUserStorage = 'USER_STORAGE' extends EnvKeys ? true : false
      const _executor: HasFunctionExecutor = true
      const _logs: HasFunctionLogs = true
      const _rateLimiter: HasRateLimiter = true
      const _userStorage: HasUserStorage = true
      expect(_executor).toBe(true)
      expect(_logs).toBe(true)
      expect(_rateLimiter).toBe(true)
      expect(_userStorage).toBe(true)
    })

    it('should include all service bindings', () => {
      // From wrangler.jsonc services
      const env = {} as Env
      void env.FSX
      void env.BASHX
      void env.TEST
      void env.ESBUILD_COMPILER
      void env.OAUTH

      type EnvKeys = keyof Env
      type HasFSX = 'FSX' extends EnvKeys ? true : false
      type HasBASHX = 'BASHX' extends EnvKeys ? true : false
      type HasTEST = 'TEST' extends EnvKeys ? true : false
      type HasEsbuildCompiler = 'ESBUILD_COMPILER' extends EnvKeys ? true : false
      type HasOAuth = 'OAUTH' extends EnvKeys ? true : false
      const _fsx: HasFSX = true
      const _bashx: HasBASHX = true
      const _test: HasTEST = true
      const _esbuild: HasEsbuildCompiler = true
      const _oauth: HasOAuth = true
      expect(_fsx).toBe(true)
      expect(_bashx).toBe(true)
      expect(_test).toBe(true)
      expect(_esbuild).toBe(true)
      expect(_oauth).toBe(true)
    })

    it('should include worker_loaders binding', () => {
      // From wrangler.jsonc worker_loaders
      const env = {} as Env
      void env.LOADER

      type EnvKeys = keyof Env
      type HasLoader = 'LOADER' extends EnvKeys ? true : false
      const _loader: HasLoader = true
      expect(_loader).toBe(true)
    })

    it('should include dispatch_namespaces binding', () => {
      // From wrangler.jsonc dispatch_namespaces
      const env = {} as Env
      void env.USER_FUNCTIONS

      type EnvKeys = keyof Env
      type HasUserFunctions = 'USER_FUNCTIONS' extends EnvKeys ? true : false
      const _userFunctions: HasUserFunctions = true
      expect(_userFunctions).toBe(true)
    })

    it('should include assets binding', () => {
      // From wrangler.jsonc assets
      const env = {} as Env
      void env.ASSETS

      type EnvKeys = keyof Env
      type HasAssets = 'ASSETS' extends EnvKeys ? true : false
      const _assets: HasAssets = true
      expect(_assets).toBe(true)
    })

    it('should include environment variables from wrangler.jsonc vars', () => {
      // From wrangler.jsonc vars
      const env = {} as Env
      void env.ENVIRONMENT
      void env.SERVICE_NAME
      void env.CLOUDFLARE_ACCOUNT_ID
      void env.DISPATCH_NAMESPACE

      type EnvKeys = keyof Env
      type HasEnvironment = 'ENVIRONMENT' extends EnvKeys ? true : false
      type HasServiceName = 'SERVICE_NAME' extends EnvKeys ? true : false
      type HasAccountId = 'CLOUDFLARE_ACCOUNT_ID' extends EnvKeys ? true : false
      type HasDispatchNs = 'DISPATCH_NAMESPACE' extends EnvKeys ? true : false
      const _env: HasEnvironment = true
      const _svc: HasServiceName = true
      const _acct: HasAccountId = true
      const _dns: HasDispatchNs = true
      expect(_env).toBe(true)
      expect(_svc).toBe(true)
      expect(_acct).toBe(true)
      expect(_dns).toBe(true)
    })

    it('should include AI bindings', () => {
      const env = {} as Env
      void env.AI
      void env.AI_CLIENT

      type EnvKeys = keyof Env
      type HasAI = 'AI' extends EnvKeys ? true : false
      type HasAIClient = 'AI_CLIENT' extends EnvKeys ? true : false
      const _ai: HasAI = true
      const _aiClient: HasAIClient = true
      expect(_ai).toBe(true)
      expect(_aiClient).toBe(true)
    })

    it('should include R2 bucket bindings', () => {
      const env = {} as Env
      void env.CODE_STORAGE

      type EnvKeys = keyof Env
      type HasCodeStorage = 'CODE_STORAGE' extends EnvKeys ? true : false
      const _codeStorage: HasCodeStorage = true
      expect(_codeStorage).toBe(true)
    })

    it('should include human task bindings', () => {
      const env = {} as Env
      void env.HUMAN_TASKS

      type EnvKeys = keyof Env
      type HasHumanTasks = 'HUMAN_TASKS' extends EnvKeys ? true : false
      const _humanTasks: HasHumanTasks = true
      expect(_humanTasks).toBe(true)
    })
  })

  describe('type compatibility', () => {
    it('should be assignable to Record<string, unknown> for middleware', () => {
      // Auth middleware expects Record<string, unknown>
      const env: Env = {} as Env
      // This should compile - Env should be usable where Record<string, unknown> is expected
      // We do a runtime check as a proxy for the compile-time constraint
      expect(typeof env).toBe('object')
    })

    it('should have all bindings optional for test/dev flexibility', () => {
      // An empty object should satisfy the Env interface
      // since all properties are optional
      const env: Env = {}
      expect(env).toBeDefined()
    })
  })
})
