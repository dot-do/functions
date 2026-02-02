/**
 * Cascade Tier Authorization Tests
 *
 * Tests for per-tier authorization in the cascade executor.
 * Validates that escalation to higher tiers requires explicit scopes:
 * - Tier 2 (generative): requires 'functions:tier:generative'
 * - Tier 3 (agentic): requires 'functions:tier:agentic'
 * - Tier 4 (human): requires 'functions:tier:human'
 *
 * If auth context doesn't have required scope, returns 403 instead of escalating.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock @dotdo/functions before any imports that depend on it
vi.mock('@dotdo/functions', () => ({
  DEFAULT_TIER_TIMEOUTS: { code: '5s', generative: '30s', agentic: '5m', human: '24h' },
  TIER_ORDER: ['code', 'generative', 'agentic', 'human'],
  CascadeExhaustedError: class CascadeExhaustedError extends Error {
    history: unknown[]
    totalDurationMs: number
    constructor(message: string, history: unknown[] = [], totalDurationMs = 0) {
      super(message)
      this.name = 'CascadeExhaustedError'
      this.history = history
      this.totalDurationMs = totalDurationMs
    }
  },
  TierTimeoutError: class TierTimeoutError extends Error {
    tier: string
    timeoutMs: number
    constructor(tier: string, timeoutMs: number) {
      super(`Tier ${tier} timed out after ${timeoutMs}ms`)
      this.name = 'TierTimeoutError'
      this.tier = tier
      this.timeoutMs = timeoutMs
    }
  },
  TierSkippedError: class TierSkippedError extends Error {
    tier: string
    reason: string
    constructor(tier: string, reason: string) {
      super(`Tier ${tier} skipped: ${reason}`)
      this.name = 'TierSkippedError'
      this.tier = tier
      this.reason = reason
    }
  },
  parseDuration: (d: string) => {
    if (d.endsWith('ms')) return parseInt(d)
    if (d.endsWith('s')) return parseInt(d) * 1000
    if (d.endsWith('m')) return parseInt(d) * 60 * 1000
    if (d.endsWith('h')) return parseInt(d) * 60 * 60 * 1000
    return parseInt(d)
  },
}))

import {
  cascadeHandler,
  hasTierScope,
  TIER_SCOPES,
  TierAuthorizationError,
} from '../cascade'
import { createMockKV } from '../../../test-utils/mock-kv'
import type { CascadeEnv } from '../cascade-types'
import type { AuthContext } from '../../middleware/auth'

// Type alias for JSON response bodies
type JsonBody = Record<string, unknown>

// =============================================================================
// Unit Tests: hasTierScope
// =============================================================================

describe('hasTierScope', () => {
  const baseAuthContext: AuthContext = {
    userId: 'user-123',
    keyHash: 'abc123',
    keyHint: '****1234',
    scopes: [],
    authenticatedAt: Date.now(),
    authMethod: 'api-key',
  }

  describe('tier scope requirements', () => {
    it('code tier does not require a special scope', () => {
      expect(TIER_SCOPES.code).toBeNull()
      expect(hasTierScope({ ...baseAuthContext, scopes: [] }, 'code')).toBe(true)
    })

    it('generative tier requires functions:tier:generative scope', () => {
      expect(TIER_SCOPES.generative).toBe('functions:tier:generative')
    })

    it('agentic tier requires functions:tier:agentic scope', () => {
      expect(TIER_SCOPES.agentic).toBe('functions:tier:agentic')
    })

    it('human tier requires functions:tier:human scope', () => {
      expect(TIER_SCOPES.human).toBe('functions:tier:human')
    })
  })

  describe('scope authorization checks', () => {
    it('allows code tier with no scopes', () => {
      const authContext: AuthContext = { ...baseAuthContext, scopes: [] }
      expect(hasTierScope(authContext, 'code')).toBe(true)
    })

    it('denies generative tier without scope', () => {
      const authContext: AuthContext = { ...baseAuthContext, scopes: [] }
      expect(hasTierScope(authContext, 'generative')).toBe(false)
    })

    it('allows generative tier with correct scope', () => {
      const authContext: AuthContext = {
        ...baseAuthContext,
        scopes: ['functions:tier:generative'],
      }
      expect(hasTierScope(authContext, 'generative')).toBe(true)
    })

    it('denies agentic tier without scope', () => {
      const authContext: AuthContext = { ...baseAuthContext, scopes: [] }
      expect(hasTierScope(authContext, 'agentic')).toBe(false)
    })

    it('allows agentic tier with correct scope', () => {
      const authContext: AuthContext = {
        ...baseAuthContext,
        scopes: ['functions:tier:agentic'],
      }
      expect(hasTierScope(authContext, 'agentic')).toBe(true)
    })

    it('denies human tier without scope', () => {
      const authContext: AuthContext = { ...baseAuthContext, scopes: [] }
      expect(hasTierScope(authContext, 'human')).toBe(false)
    })

    it('allows human tier with correct scope', () => {
      const authContext: AuthContext = {
        ...baseAuthContext,
        scopes: ['functions:tier:human'],
      }
      expect(hasTierScope(authContext, 'human')).toBe(true)
    })

    it('allows all tiers with wildcard scope', () => {
      const authContext: AuthContext = { ...baseAuthContext, scopes: ['*'] }
      expect(hasTierScope(authContext, 'code')).toBe(true)
      expect(hasTierScope(authContext, 'generative')).toBe(true)
      expect(hasTierScope(authContext, 'agentic')).toBe(true)
      expect(hasTierScope(authContext, 'human')).toBe(true)
    })

    it('allows tier with multiple scopes including required one', () => {
      const authContext: AuthContext = {
        ...baseAuthContext,
        scopes: ['functions:read', 'functions:tier:generative', 'functions:write'],
      }
      expect(hasTierScope(authContext, 'generative')).toBe(true)
    })

    it('denies tier when scopes do not include required one', () => {
      const authContext: AuthContext = {
        ...baseAuthContext,
        scopes: ['functions:read', 'functions:write'],
      }
      expect(hasTierScope(authContext, 'generative')).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('allows all tiers when no auth context provided (auth disabled)', () => {
      expect(hasTierScope(undefined, 'code')).toBe(true)
      expect(hasTierScope(undefined, 'generative')).toBe(true)
      expect(hasTierScope(undefined, 'agentic')).toBe(true)
      expect(hasTierScope(undefined, 'human')).toBe(true)
    })

    it('denies when auth context exists but has empty scopes', () => {
      const authContext: AuthContext = { ...baseAuthContext, scopes: [] }
      expect(hasTierScope(authContext, 'generative')).toBe(false)
      expect(hasTierScope(authContext, 'agentic')).toBe(false)
      expect(hasTierScope(authContext, 'human')).toBe(false)
    })
  })
})

// =============================================================================
// Unit Tests: TierAuthorizationError
// =============================================================================

describe('TierAuthorizationError', () => {
  it('creates error with correct tier and scope', () => {
    const error = new TierAuthorizationError('generative', 'functions:tier:generative')
    expect(error.name).toBe('TierAuthorizationError')
    expect(error.tier).toBe('generative')
    expect(error.requiredScope).toBe('functions:tier:generative')
    expect(error.message).toContain('generative')
    expect(error.message).toContain('functions:tier:generative')
  })

  it('is an instance of Error', () => {
    const error = new TierAuthorizationError('human', 'functions:tier:human')
    expect(error).toBeInstanceOf(Error)
  })
})

// =============================================================================
// Integration Tests: cascadeHandler with tier authorization
// =============================================================================

describe('cascadeHandler tier authorization', () => {
  let mockEnv: CascadeEnv
  let mockCtx: ExecutionContext

  beforeEach(() => {
    const registryKV = createMockKV()
    const codeKV = createMockKV()

    // Mock AI client for generative/agentic tiers
    const mockAIClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'AI response' }],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      },
    }

    mockEnv = {
      FUNCTIONS_REGISTRY: registryKV,
      FUNCTIONS_CODE: codeKV,
      AI_CLIENT: mockAIClient,
    } as unknown as CascadeEnv

    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext
  })

  /**
   * Helper to register a function in the mock KV
   */
  async function registerFunction(id: string, type = 'code') {
    const metadata = {
      id,
      version: '1.0.0',
      language: 'typescript',
      entryPoint: 'index.ts',
      dependencies: {},
      type,
      systemPrompt: 'Test function',
    }
    await mockEnv.FUNCTIONS_REGISTRY.put(
      `registry:${id}`,
      JSON.stringify(metadata)
    )
  }

  /**
   * Helper to store code for a function
   */
  async function storeCode(id: string, code: string) {
    await mockEnv.FUNCTIONS_CODE.put(`code:${id}`, code)
  }

  describe('code tier (no special scope required)', () => {
    it('allows code tier execution with no scopes when startTier is code', async () => {
      await registerFunction('test-function', 'code')
      await storeCode('test-function', 'export default { fetch() { return new Response("ok") } }')

      const request = new Request('https://functions.do/cascade/test-function', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {},
          options: { startTier: 'code', skipTiers: ['generative', 'agentic', 'human'] },
        }),
      })

      const authContext: AuthContext = {
        userId: 'user-123',
        keyHash: 'abc123',
        keyHint: '****1234',
        scopes: [], // No special scopes
        authenticatedAt: Date.now(),
        authMethod: 'api-key',
      }

      const response = await cascadeHandler(
        request,
        mockEnv,
        mockCtx,
        { params: {}, functionId: 'test-function', authContext }
      )

      // Code tier should not return 403 (it may fail for other reasons like missing executor)
      // but it should not be denied due to authorization for code tier
      expect(response.status).not.toBe(403)
    })
  })

  describe('generative tier authorization', () => {
    it('returns 403 when escalating to generative without scope', async () => {
      await registerFunction('gen-function', 'generative')
      // No code stored, so it will try to escalate to generative

      const request = new Request('https://functions.do/cascade/gen-function', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {},
          options: { startTier: 'generative' },
        }),
      })

      const authContext: AuthContext = {
        userId: 'user-123',
        keyHash: 'abc123',
        keyHint: '****1234',
        scopes: [], // Missing generative scope
        authenticatedAt: Date.now(),
        authMethod: 'api-key',
      }

      const response = await cascadeHandler(
        request,
        mockEnv,
        mockCtx,
        { params: {}, functionId: 'gen-function', authContext }
      )

      expect(response.status).toBe(403)
      const body = (await response.json()) as JsonBody
      expect(body.error).toBe('Insufficient permissions for tier escalation')
      expect(body.tier).toBe('generative')
      expect(body.requiredScope).toBe('functions:tier:generative')
    })

    it('allows generative tier with correct scope', async () => {
      await registerFunction('gen-function', 'generative')

      const request = new Request('https://functions.do/cascade/gen-function', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {},
          options: { startTier: 'generative', skipTiers: ['agentic', 'human'] },
        }),
      })

      const authContext: AuthContext = {
        userId: 'user-123',
        keyHash: 'abc123',
        keyHint: '****1234',
        scopes: ['functions:tier:generative'],
        authenticatedAt: Date.now(),
        authMethod: 'api-key',
      }

      const response = await cascadeHandler(
        request,
        mockEnv,
        mockCtx,
        { params: {}, functionId: 'gen-function', authContext }
      )

      // Should not be 403 (may be other errors but not authorization)
      expect(response.status).not.toBe(403)
    })
  })

  describe('agentic tier authorization', () => {
    it('returns 403 when escalating to agentic without scope', async () => {
      await registerFunction('agent-function', 'agentic')

      const request = new Request('https://functions.do/cascade/agent-function', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {},
          options: { startTier: 'agentic' },
        }),
      })

      const authContext: AuthContext = {
        userId: 'user-123',
        keyHash: 'abc123',
        keyHint: '****1234',
        scopes: ['functions:tier:generative'], // Has generative but not agentic
        authenticatedAt: Date.now(),
        authMethod: 'api-key',
      }

      const response = await cascadeHandler(
        request,
        mockEnv,
        mockCtx,
        { params: {}, functionId: 'agent-function', authContext }
      )

      expect(response.status).toBe(403)
      const body = (await response.json()) as JsonBody
      expect(body.error).toBe('Insufficient permissions for tier escalation')
      expect(body.tier).toBe('agentic')
      expect(body.requiredScope).toBe('functions:tier:agentic')
    })

    it('allows agentic tier with correct scope', async () => {
      await registerFunction('agent-function', 'agentic')

      const request = new Request('https://functions.do/cascade/agent-function', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {},
          options: { startTier: 'agentic' },
        }),
      })

      const authContext: AuthContext = {
        userId: 'user-123',
        keyHash: 'abc123',
        keyHint: '****1234',
        scopes: ['functions:tier:agentic'],
        authenticatedAt: Date.now(),
        authMethod: 'api-key',
      }

      const response = await cascadeHandler(
        request,
        mockEnv,
        mockCtx,
        { params: {}, functionId: 'agent-function', authContext }
      )

      // Should not be 403
      expect(response.status).not.toBe(403)
    })
  })

  describe('human tier authorization', () => {
    it('returns 403 when escalating to human without scope', async () => {
      await registerFunction('human-function', 'human')

      // Add HUMAN_TASKS binding to enable human tier
      const envWithHuman = {
        ...mockEnv,
        HUMAN_TASKS: {} as unknown as DurableObjectNamespace,
      }

      const request = new Request('https://functions.do/cascade/human-function', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {},
          options: { startTier: 'human' },
        }),
      })

      const authContext: AuthContext = {
        userId: 'user-123',
        keyHash: 'abc123',
        keyHint: '****1234',
        scopes: ['functions:tier:generative', 'functions:tier:agentic'], // Has others but not human
        authenticatedAt: Date.now(),
        authMethod: 'api-key',
      }

      const response = await cascadeHandler(
        request,
        envWithHuman,
        mockCtx,
        { params: {}, functionId: 'human-function', authContext }
      )

      expect(response.status).toBe(403)
      const body = (await response.json()) as JsonBody
      expect(body.error).toBe('Insufficient permissions for tier escalation')
      expect(body.tier).toBe('human')
      expect(body.requiredScope).toBe('functions:tier:human')
    })
  })

  describe('wildcard scope', () => {
    it('allows all tiers with wildcard scope', async () => {
      await registerFunction('any-function', 'agentic')

      const request = new Request('https://functions.do/cascade/any-function', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {},
          options: { startTier: 'agentic' },
        }),
      })

      const authContext: AuthContext = {
        userId: 'admin-user',
        keyHash: 'abc123',
        keyHint: '****1234',
        scopes: ['*'], // Wildcard grants all permissions
        authenticatedAt: Date.now(),
        authMethod: 'api-key',
      }

      const response = await cascadeHandler(
        request,
        mockEnv,
        mockCtx,
        { params: {}, functionId: 'any-function', authContext }
      )

      // Should not be 403 with wildcard scope
      expect(response.status).not.toBe(403)
    })
  })

  describe('no auth context (auth disabled)', () => {
    it('allows all tiers when no auth context is provided', async () => {
      await registerFunction('noauth-function', 'generative')

      const request = new Request('https://functions.do/cascade/noauth-function', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {},
          options: { startTier: 'generative' },
        }),
      })

      // No authContext in route context
      const response = await cascadeHandler(
        request,
        mockEnv,
        mockCtx,
        { params: {}, functionId: 'noauth-function' }
      )

      // Should not be 403 when auth is disabled
      expect(response.status).not.toBe(403)
    })
  })
})
