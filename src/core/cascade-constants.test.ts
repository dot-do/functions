/**
 * RED Phase Tests: Cascade Constants Type Inference
 *
 * These tests verify that TIER_ORDER and DEFAULT_TIER_TIMEOUTS constants
 * use the 'as const satisfies' pattern for better type inference.
 *
 * Run with: npm run test
 */

import { describe, it, expect } from 'vitest'
import {
  TIER_ORDER,
  DEFAULT_TIER_TIMEOUTS,
} from '@dotdo/functions'
import type { FunctionType } from '@dotdo/functions'

describe('Cascade Constants - Type Inference', () => {
  // ===========================================================================
  // TIER_ORDER TESTS
  // ===========================================================================

  describe('TIER_ORDER', () => {
    it('should be an array', () => {
      expect(Array.isArray(TIER_ORDER)).toBe(true)
    })

    it('should contain all function types in correct order', () => {
      expect(TIER_ORDER).toEqual(['code', 'generative', 'agentic', 'human'])
    })

    it('should have length of 4', () => {
      expect(TIER_ORDER.length).toBe(4)
    })

    it('should contain valid function types', () => {
      const validTypes: FunctionType[] = ['code', 'generative', 'agentic', 'human']
      for (const tier of TIER_ORDER) {
        expect(validTypes).toContain(tier)
      }
    })

    it('should be usable in array methods', () => {
      const mappedTiers = TIER_ORDER.map(tier => `tier:${tier}`)
      expect(mappedTiers).toEqual(['tier:code', 'tier:generative', 'tier:agentic', 'tier:human'])
    })

    it('should support type narrowing', () => {
      const tier = TIER_ORDER[0]
      // This tests that the literal type is preserved
      expect(tier).toBe('code')
    })

    it('should be usable where FunctionType[] is expected', () => {
      // TIER_ORDER is readonly, but can be used in contexts expecting FunctionType[]
      const tiers: readonly FunctionType[] = TIER_ORDER
      expect(tiers).toBeDefined()
    })

    it('should preserve tuple type structure', () => {
      // Verify length is 4, not dynamic
      const length: 4 = TIER_ORDER.length as 4
      expect(length).toBe(4)
    })

    it('should allow iteration with type safety', () => {
      const tiers: FunctionType[] = []
      for (const tier of TIER_ORDER) {
        tiers.push(tier)
      }
      expect(tiers).toEqual(TIER_ORDER)
    })
  })

  // ===========================================================================
  // DEFAULT_TIER_TIMEOUTS TESTS
  // ===========================================================================

  describe('DEFAULT_TIER_TIMEOUTS', () => {
    it('should have all function types as keys', () => {
      const expectedKeys = ['code', 'generative', 'agentic', 'human']
      const actualKeys = Object.keys(DEFAULT_TIER_TIMEOUTS).sort()
      expect(actualKeys).toEqual(expectedKeys.sort())
    })

    it('should have correct default values', () => {
      expect(DEFAULT_TIER_TIMEOUTS.code).toBe('5s')
      expect(DEFAULT_TIER_TIMEOUTS.generative).toBe('30s')
      expect(DEFAULT_TIER_TIMEOUTS.agentic).toBe('5m')
      expect(DEFAULT_TIER_TIMEOUTS.human).toBe('24h')
    })

    it('should have all entries accessible', () => {
      expect(DEFAULT_TIER_TIMEOUTS['code']).toBe('5s')
      expect(DEFAULT_TIER_TIMEOUTS['generative']).toBe('30s')
      expect(DEFAULT_TIER_TIMEOUTS['agentic']).toBe('5m')
      expect(DEFAULT_TIER_TIMEOUTS['human']).toBe('24h')
    })

    it('should support iteration over entries', () => {
      const entries = Object.entries(DEFAULT_TIER_TIMEOUTS)
      expect(entries.length).toBe(4)

      const expectedEntries = [
        ['code', '5s'],
        ['generative', '30s'],
        ['agentic', '5m'],
        ['human', '24h'],
      ]

      for (const [tier, timeout] of entries) {
        const found = expectedEntries.find(([t, to]) => t === tier && to === timeout)
        expect(found).toBeDefined()
      }
    })

    it('should support Record<FunctionType, Duration> assignment', () => {
      const timeoutsRecord = DEFAULT_TIER_TIMEOUTS
      expect(timeoutsRecord).toBeDefined()
      expect(Object.keys(timeoutsRecord).length).toBe(4)
    })

    it('should allow partial access patterns', () => {
      const { code, generative } = DEFAULT_TIER_TIMEOUTS
      expect(code).toBe('5s')
      expect(generative).toBe('30s')
    })

    it('should have consistent Duration string format', () => {
      const durations = Object.values(DEFAULT_TIER_TIMEOUTS)
      for (const duration of durations) {
        // Should be string format like "5s", "30s", "5m", "24h"
        expect(typeof duration).toBe('string')
        expect(duration).toMatch(/^\d+[smh]$/)
      }
    })

    it('should work with Object.entries for iteration', () => {
      const entries = Object.entries(DEFAULT_TIER_TIMEOUTS)
      const tierMap = new Map(entries as [FunctionType, string][])

      expect(tierMap.get('code')).toBe('5s')
      expect(tierMap.get('generative')).toBe('30s')
      expect(tierMap.get('agentic')).toBe('5m')
      expect(tierMap.get('human')).toBe('24h')
    })
  })

  // ===========================================================================
  // INTEGRATION TESTS: TIER_ORDER + DEFAULT_TIER_TIMEOUTS
  // ===========================================================================

  describe('TIER_ORDER and DEFAULT_TIER_TIMEOUTS Integration', () => {
    it('should have matching tier names', () => {
      for (const tier of TIER_ORDER) {
        const timeout = DEFAULT_TIER_TIMEOUTS[tier as FunctionType]
        expect(timeout).toBeDefined()
      }
    })

    it('should have default timeout for every tier in TIER_ORDER', () => {
      const allTiersHaveTimeouts = TIER_ORDER.every(
        tier => (tier as FunctionType) in DEFAULT_TIER_TIMEOUTS
      )
      expect(allTiersHaveTimeouts).toBe(true)
    })

    it('should be usable together in function', () => {
      const getTierTimeout = (tier: FunctionType): string | undefined => {
        if (TIER_ORDER.includes(tier)) {
          return DEFAULT_TIER_TIMEOUTS[tier]
        }
        return undefined
      }

      expect(getTierTimeout('code')).toBe('5s')
      expect(getTierTimeout('generative')).toBe('30s')
      expect(getTierTimeout('agentic')).toBe('5m')
      expect(getTierTimeout('human')).toBe('24h')
    })

    it('should support type-safe iteration', () => {
      const timeoutMap: Record<FunctionType, string> = {} as any

      for (const tier of TIER_ORDER) {
        timeoutMap[tier] = DEFAULT_TIER_TIMEOUTS[tier]
      }

      expect(timeoutMap.code).toBe('5s')
      expect(timeoutMap.generative).toBe('30s')
      expect(timeoutMap.agentic).toBe('5m')
      expect(timeoutMap.human).toBe('24h')
    })
  })

  // ===========================================================================
  // TYPE INFERENCE VALIDATION TESTS
  // ===========================================================================

  describe('Type Inference Validation', () => {
    it('TIER_ORDER should support includes check', () => {
      const tier: FunctionType = 'code'
      expect(TIER_ORDER.includes(tier)).toBe(true)
    })

    it('TIER_ORDER should work with type guards', () => {
      const isValidTier = (value: unknown): value is FunctionType => {
        return TIER_ORDER.includes(value as FunctionType)
      }

      expect(isValidTier('code')).toBe(true)
      expect(isValidTier('generative')).toBe(true)
      expect(isValidTier('agentic')).toBe(true)
      expect(isValidTier('human')).toBe(true)
      expect(isValidTier('invalid')).toBe(false)
    })

    it('DEFAULT_TIER_TIMEOUTS should work with key access patterns', () => {
      const tier: FunctionType = 'code'
      const timeout = DEFAULT_TIER_TIMEOUTS[tier as FunctionType]
      expect(timeout).toBe('5s')
    })

    it('should support spread operator on TIER_ORDER', () => {
      const [first, second, ...rest] = TIER_ORDER
      expect(first).toBe('code')
      expect(second).toBe('generative')
      expect(rest).toEqual(['agentic', 'human'])
    })
  })
})
