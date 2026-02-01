/**
 * Type Unification Tests
 *
 * These tests verify that the unified type system maintains compatibility
 * and correctness after consolidating duplicate types from:
 * - core/src/types.ts (abstract function types)
 * - src/core/types.ts (worker loader types)
 *
 * TDD RED Phase: Write tests that will pass after type unification.
 */

import { describe, it, expect } from 'vitest'

// Import from core/src/types.ts (canonical source)
import {
  type FunctionType,
  type FunctionDefinition,
  type FunctionResult,
  type FunctionResultStatus,
  type FunctionError,
  type ExecutionMetrics,
  type TokenUsage,
  type ExecutionMetadata,
  type WorkflowContext,
  type RetryPolicy,
  type Duration,
  type JsonSchema,
  type FunctionExecutor,
  type ExecutionContext,
  type ValidationResult,
  type ValidationError,
  type FunctionRegistry,
  type RegisteredFunction,
  type FunctionFilter,
  type FunctionInvocation,
  parseDuration,
} from '../types.js'

// After unification, these should also be exported from core/src/types.ts
// Import Worker Loader types that will be consolidated
import type {
  WorkerStub,
  CacheStats,
  WorkerLoaderOptions,
  FunctionMetadata,
  SemanticVersion,
  DeploymentRecord,
  VersionHistory,
} from '../types.js'

import {
  parseVersion,
  compareVersions,
  isValidVersion,
} from '../types.js'

describe('Type Unification', () => {
  describe('Core Function Types', () => {
    it('should export FunctionType discriminator', () => {
      const codeType: FunctionType = 'code'
      const generativeType: FunctionType = 'generative'
      const agenticType: FunctionType = 'agentic'
      const humanType: FunctionType = 'human'

      expect(['code', 'generative', 'agentic', 'human']).toContain(codeType)
      expect(['code', 'generative', 'agentic', 'human']).toContain(generativeType)
      expect(['code', 'generative', 'agentic', 'human']).toContain(agenticType)
      expect(['code', 'generative', 'agentic', 'human']).toContain(humanType)
    })

    it('should export FunctionDefinition interface with required fields', () => {
      const def: FunctionDefinition = {
        id: 'test-func',
        name: 'Test Function',
        version: '1.0.0',
        type: 'code',
      }

      expect(def.id).toBe('test-func')
      expect(def.name).toBe('Test Function')
      expect(def.version).toBe('1.0.0')
      expect(def.type).toBe('code')
    })

    it('should export FunctionResult with all status types', () => {
      const statuses: FunctionResultStatus[] = ['completed', 'failed', 'timeout', 'cancelled']

      statuses.forEach(status => {
        const result: FunctionResult = {
          executionId: 'exec-1',
          functionId: 'func-1',
          functionVersion: '1.0.0',
          status,
          metrics: {
            durationMs: 100,
            inputSizeBytes: 10,
            outputSizeBytes: 20,
            retryCount: 0,
          },
          metadata: {
            startedAt: Date.now(),
          },
        }
        expect(result.status).toBe(status)
      })
    })
  })

  describe('Duration Parsing', () => {
    it('should parse milliseconds', () => {
      expect(parseDuration(100)).toBe(100)
      expect(parseDuration('100ms')).toBe(100)
    })

    it('should parse seconds', () => {
      expect(parseDuration('5s')).toBe(5000)
      expect(parseDuration('1 second')).toBe(1000)
      expect(parseDuration('3 seconds')).toBe(3000)
    })

    it('should parse minutes', () => {
      expect(parseDuration('1m')).toBe(60000)
      expect(parseDuration('1 minute')).toBe(60000)
      expect(parseDuration('2 minutes')).toBe(120000)
    })

    it('should parse hours', () => {
      expect(parseDuration('1h')).toBe(3600000)
      expect(parseDuration('1 hour')).toBe(3600000)
      expect(parseDuration('2 hours')).toBe(7200000)
    })

    it('should parse days', () => {
      expect(parseDuration('1d')).toBe(86400000)
      expect(parseDuration('1 day')).toBe(86400000)
      expect(parseDuration('2 days')).toBe(172800000)
    })

    it('should throw for invalid duration', () => {
      expect(() => parseDuration('invalid' as Duration)).toThrow('Invalid duration')
    })
  })

  describe('Worker Loader Types (Consolidated)', () => {
    it('should export WorkerStub interface', () => {
      // WorkerStub should be available from the unified types
      // Note: ScheduledController and MessageBatch are Cloudflare-specific types
      const stub: WorkerStub = {
        id: 'test-worker',
        fetch: async (_req: Request) => new Response('ok'),
        connect: async (_req: Request) => new Response(),
        scheduled: async () => {},
        queue: async () => {},
      }

      expect(stub.id).toBe('test-worker')
      expect(typeof stub.fetch).toBe('function')
    })

    it('should export CacheStats interface', () => {
      const stats: CacheStats = {
        size: 10,
        hits: 100,
        misses: 20,
      }

      expect(stats.size).toBe(10)
      expect(stats.hits).toBe(100)
      expect(stats.misses).toBe(20)
    })

    it('should export WorkerLoaderOptions interface', () => {
      const options: WorkerLoaderOptions = {
        timeout: 30000,
        maxCacheSize: 1000,
      }

      expect(options.timeout).toBe(30000)
      expect(options.maxCacheSize).toBe(1000)
    })

    it('should export FunctionMetadata interface', () => {
      const metadata: FunctionMetadata = {
        id: 'test-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: { lodash: '^4.17.21' },
      }

      expect(metadata.id).toBe('test-func')
      expect(metadata.language).toBe('typescript')
    })
  })

  describe('Semantic Version Utilities (Consolidated)', () => {
    it('should export parseVersion function', () => {
      const result = parseVersion('1.2.3')
      expect(result).not.toBeNull()
      expect(result?.major).toBe(1)
      expect(result?.minor).toBe(2)
      expect(result?.patch).toBe(3)
    })

    it('should export parseVersion with prerelease', () => {
      const result = parseVersion('1.0.0-beta.1')
      expect(result).not.toBeNull()
      expect(result?.major).toBe(1)
      expect(result?.minor).toBe(0)
      expect(result?.patch).toBe(0)
      expect(result?.prerelease).toBe('beta.1')
    })

    it('should export parseVersion with build metadata', () => {
      const result = parseVersion('1.0.0+build.123')
      expect(result).not.toBeNull()
      expect(result?.major).toBe(1)
      expect(result?.minor).toBe(0)
      expect(result?.patch).toBe(0)
      expect(result?.build).toBe('build.123')
    })

    it('should export parseVersion returning null for invalid versions', () => {
      expect(parseVersion('invalid')).toBeNull()
      expect(parseVersion('1.0')).toBeNull()
      expect(parseVersion('v1.0.0')).toBeNull()
    })

    it('should export compareVersions function', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBe(1)
      expect(compareVersions('1.0.0', '2.0.0')).toBe(-1)
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    })

    it('should export compareVersions with prerelease handling', () => {
      // Release > prerelease
      expect(compareVersions('1.0.0', '1.0.0-alpha')).toBe(1)
      expect(compareVersions('1.0.0-alpha', '1.0.0')).toBe(-1)
    })

    it('should export isValidVersion function', () => {
      expect(isValidVersion('1.0.0')).toBe(true)
      expect(isValidVersion('0.0.1')).toBe(true)
      expect(isValidVersion('invalid')).toBe(false)
      expect(isValidVersion('v1.0.0')).toBe(false)
    })
  })

  describe('SemanticVersion Type (Consolidated)', () => {
    it('should export SemanticVersion interface', () => {
      const version: SemanticVersion = {
        major: 1,
        minor: 2,
        patch: 3,
      }

      expect(version.major).toBe(1)
      expect(version.minor).toBe(2)
      expect(version.patch).toBe(3)
    })

    it('should support prerelease and build fields', () => {
      const version: SemanticVersion = {
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: 'alpha.1',
        build: 'build.123',
      }

      expect(version.prerelease).toBe('alpha.1')
      expect(version.build).toBe('build.123')
    })
  })

  describe('Deployment Types (Consolidated)', () => {
    it('should export DeploymentRecord interface', () => {
      const record: DeploymentRecord = {
        version: '1.0.0',
        deployedAt: '2024-01-01T00:00:00.000Z',
        metadata: {
          id: 'test-func',
          version: '1.0.0',
          language: 'typescript',
          entryPoint: 'index.ts',
          dependencies: {},
        },
      }

      expect(record.version).toBe('1.0.0')
      expect(record.metadata.id).toBe('test-func')
    })

    it('should export VersionHistory interface', () => {
      const history: VersionHistory = {
        functionId: 'test-func',
        versions: ['2.0.0', '1.1.0', '1.0.0'],
        deployments: [
          {
            version: '2.0.0',
            deployedAt: '2024-01-03T00:00:00.000Z',
            metadata: {
              id: 'test-func',
              version: '2.0.0',
              language: 'typescript',
              entryPoint: 'index.ts',
              dependencies: {},
            },
          },
        ],
      }

      expect(history.functionId).toBe('test-func')
      expect(history.versions).toHaveLength(3)
      expect(history.deployments).toHaveLength(1)
    })
  })

  describe('Type Compatibility', () => {
    it('should allow FunctionMetadata to be used where id/version is needed', () => {
      const metadata: FunctionMetadata = {
        id: 'test-func',
        version: '1.0.0',
        language: 'typescript',
        entryPoint: 'index.ts',
        dependencies: {},
      }

      // FunctionMetadata can provide id and version like FunctionDefinition
      const idAndVersion: { id: string; version: string } = {
        id: metadata.id,
        version: metadata.version,
      }

      expect(idAndVersion.id).toBe('test-func')
      expect(idAndVersion.version).toBe('1.0.0')
    })

    it('should allow ExecutionContext to work with both abstract and runtime types', () => {
      const context: ExecutionContext = {
        executionId: 'exec-1',
        traceId: 'trace-1',
        timeout: '30s',
      }

      expect(context.executionId).toBe('exec-1')
      expect(context.timeout).toBe('30s')
    })
  })
})
