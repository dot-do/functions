/**
 * OAuth.do Integration Tests
 *
 * Tests for the OAuth service client and permission checking utilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  OAuthClient,
  extractBearerToken,
  checkFunctionPermission,
  hasScope,
  FUNCTION_SCOPES,
  type OAuthService,
  type OAuthContext,
} from '../oauth'
import type { FunctionPermissions } from '../types'

describe('OAuth Utilities', () => {
  describe('extractBearerToken', () => {
    it('should extract token from valid Bearer header', () => {
      expect(extractBearerToken('Bearer abc123')).toBe('abc123')
    })

    it('should handle case-insensitive Bearer', () => {
      expect(extractBearerToken('bearer ABC')).toBe('ABC')
      expect(extractBearerToken('BEARER xyz')).toBe('xyz')
    })

    it('should return null for null header', () => {
      expect(extractBearerToken(null)).toBeNull()
    })

    it('should return null for non-Bearer auth', () => {
      expect(extractBearerToken('Basic abc123')).toBeNull()
    })

    it('should return null for malformed header', () => {
      expect(extractBearerToken('Bearer')).toBeNull()
      expect(extractBearerToken('Bearerabc')).toBeNull()
    })
  })

  describe('hasScope', () => {
    it('should return true for exact scope match', () => {
      expect(hasScope(['functions:read', 'functions:write'], 'functions:read')).toBe(true)
    })

    it('should return false for missing scope', () => {
      expect(hasScope(['functions:read'], 'functions:write')).toBe(false)
    })

    it('should return true for wildcard scope', () => {
      expect(hasScope(['functions:*'], 'functions:read')).toBe(true)
      expect(hasScope(['functions:*'], 'functions:write')).toBe(true)
      expect(hasScope(['functions:*'], 'functions:admin')).toBe(true)
    })

    it('should return false for unrelated wildcard', () => {
      expect(hasScope(['other:*'], 'functions:read')).toBe(false)
    })

    it('should handle empty scopes array', () => {
      expect(hasScope([], 'functions:read')).toBe(false)
    })
  })

  describe('FUNCTION_SCOPES', () => {
    it('should define standard function scopes', () => {
      expect(FUNCTION_SCOPES.READ).toBe('functions:read')
      expect(FUNCTION_SCOPES.WRITE).toBe('functions:write')
      expect(FUNCTION_SCOPES.INVOKE).toBe('functions:invoke')
      expect(FUNCTION_SCOPES.DELETE).toBe('functions:delete')
      expect(FUNCTION_SCOPES.ADMIN).toBe('functions:admin')
      expect(FUNCTION_SCOPES.ALL).toBe('functions:*')
    })
  })
})

describe('OAuthClient', () => {
  describe('without service', () => {
    it('should report not available', () => {
      const client = new OAuthClient()
      expect(client.isAvailable()).toBe(false)
    })

    it('should return null for token validation', async () => {
      const client = new OAuthClient()
      expect(await client.validateToken('test')).toBeNull()
    })

    it('should return null for user info', async () => {
      const client = new OAuthClient()
      expect(await client.getUserInfo('test')).toBeNull()
    })

    it('should return true for scope check (no service = allow)', async () => {
      const client = new OAuthClient()
      expect(await client.hasScopes('test', ['read'])).toBe(true)
    })

    it('should allow permission check (no service = allow)', async () => {
      const client = new OAuthClient()
      const result = await client.checkPermission('test', 'function:my-fn', 'invoke')
      expect(result.allowed).toBe(true)
    })
  })

  describe('with mock service', () => {
    let mockService: OAuthService

    beforeEach(() => {
      mockService = {
        validateToken: vi.fn(),
        getUserInfo: vi.fn(),
        checkScopes: vi.fn(),
        getOrganizations: vi.fn(),
        checkPermission: vi.fn(),
        introspect: vi.fn(),
      }
    })

    it('should report available with service', () => {
      const client = new OAuthClient(mockService)
      expect(client.isAvailable()).toBe(true)
    })

    it('should validate token via service', async () => {
      const tokenInfo = {
        active: true,
        sub: 'user-123',
        clientId: 'client-456',
        scopes: ['functions:read'],
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      }
      vi.mocked(mockService.validateToken).mockResolvedValue(tokenInfo)

      const client = new OAuthClient(mockService)
      const result = await client.validateToken('test-token')

      expect(mockService.validateToken).toHaveBeenCalledWith('test-token')
      expect(result).toEqual(tokenInfo)
    })

    it('should return null for invalid token', async () => {
      vi.mocked(mockService.validateToken).mockResolvedValue(null)

      const client = new OAuthClient(mockService)
      const result = await client.validateToken('invalid')

      expect(result).toBeNull()
    })

    it('should handle service errors gracefully', async () => {
      vi.mocked(mockService.validateToken).mockRejectedValue(new Error('Service error'))

      const client = new OAuthClient(mockService)
      const result = await client.validateToken('test')

      expect(result).toBeNull()
    })

    it('should check scopes via service', async () => {
      vi.mocked(mockService.checkScopes).mockResolvedValue({
        'functions:read': true,
        'functions:write': false,
      })

      const client = new OAuthClient(mockService)
      const hasRead = await client.hasScopes('token', ['functions:read'])
      const hasReadWrite = await client.hasScopes('token', ['functions:read', 'functions:write'])

      expect(hasRead).toBe(true)
      expect(hasReadWrite).toBe(false)
    })

    it('should build context from valid token', async () => {
      const tokenInfo = {
        active: true,
        sub: 'user-123',
        clientId: 'client-456',
        scopes: ['functions:read', 'functions:write'],
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      }
      const userInfo = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        organizations: [
          {
            organization: { id: 'org-1', name: 'Org One', slug: 'org-one' },
            role: 'admin' as const,
            joinedAt: '2025-01-01T00:00:00Z',
          },
        ],
      }

      vi.mocked(mockService.validateToken).mockResolvedValue(tokenInfo)
      vi.mocked(mockService.getUserInfo).mockResolvedValue(userInfo)

      const client = new OAuthClient(mockService)
      const context = await client.buildContext('test-token', null)

      expect(context).not.toBeNull()
      expect(context?.userId).toBe('user-123')
      expect(context?.email).toBe('test@example.com')
      expect(context?.scopes).toEqual(['functions:read', 'functions:write'])
      expect(context?.organizations).toHaveLength(1)
      expect(context?.currentOrg?.slug).toBe('org-one')
    })

    it('should select org from X-Organization header', async () => {
      const tokenInfo = {
        active: true,
        sub: 'user-123',
        clientId: 'client-456',
        scopes: ['functions:read'],
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      }
      const userInfo = {
        id: 'user-123',
        organizations: [
          {
            organization: { id: 'org-1', name: 'Org One', slug: 'org-one' },
            role: 'member' as const,
            joinedAt: '2025-01-01T00:00:00Z',
          },
          {
            organization: { id: 'org-2', name: 'Org Two', slug: 'org-two' },
            role: 'admin' as const,
            joinedAt: '2025-01-01T00:00:00Z',
          },
        ],
      }

      vi.mocked(mockService.validateToken).mockResolvedValue(tokenInfo)
      vi.mocked(mockService.getUserInfo).mockResolvedValue(userInfo)

      const client = new OAuthClient(mockService)
      const context = await client.buildContext('test-token', 'org-two')

      expect(context?.currentOrg?.id).toBe('org-2')
      expect(context?.currentOrg?.slug).toBe('org-two')
    })

    it('should return null context for inactive token', async () => {
      vi.mocked(mockService.validateToken).mockResolvedValue({
        active: false,
        sub: 'user-123',
        clientId: 'client-456',
        scopes: [],
        exp: Math.floor(Date.now() / 1000) - 100,
        iat: Math.floor(Date.now() / 1000) - 3600,
      })

      const client = new OAuthClient(mockService)
      const context = await client.buildContext('expired-token', null)

      expect(context).toBeNull()
    })
  })
})

describe('checkFunctionPermission', () => {
  describe('without permissions config', () => {
    it('should require authentication', () => {
      const result = checkFunctionPermission(null, undefined)
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('Authentication required')
    })

    it('should allow authenticated users', () => {
      const context: OAuthContext = {
        userId: 'user-123',
        scopes: [],
        expiresAt: Date.now() + 3600000,
        tokenHint: '****test',
      }
      const result = checkFunctionPermission(context, undefined)
      expect(result.allowed).toBe(true)
    })
  })

  describe('public functions', () => {
    const publicPermissions: FunctionPermissions = { public: true }

    it('should allow anonymous access', () => {
      const result = checkFunctionPermission(null, publicPermissions)
      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('Public function')
    })

    it('should allow authenticated access', () => {
      const context: OAuthContext = {
        userId: 'user-123',
        scopes: [],
        expiresAt: Date.now() + 3600000,
        tokenHint: '****test',
      }
      const result = checkFunctionPermission(context, publicPermissions)
      expect(result.allowed).toBe(true)
    })
  })

  describe('scope requirements', () => {
    const permissions: FunctionPermissions = {
      requiredScopes: ['functions:invoke', 'custom:scope'],
    }

    it('should deny without required scopes', () => {
      const context: OAuthContext = {
        userId: 'user-123',
        scopes: ['functions:read'],
        expiresAt: Date.now() + 3600000,
        tokenHint: '****test',
      }
      const result = checkFunctionPermission(context, permissions)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Missing required scopes')
    })

    it('should allow with all required scopes', () => {
      const context: OAuthContext = {
        userId: 'user-123',
        scopes: ['functions:invoke', 'custom:scope', 'other:scope'],
        expiresAt: Date.now() + 3600000,
        tokenHint: '****test',
      }
      const result = checkFunctionPermission(context, permissions)
      expect(result.allowed).toBe(true)
    })
  })

  describe('user allowlist', () => {
    const permissions: FunctionPermissions = {
      allowedUsers: ['user-123', 'user-456'],
    }

    it('should allow users in allowlist', () => {
      const context: OAuthContext = {
        userId: 'user-123',
        scopes: [],
        expiresAt: Date.now() + 3600000,
        tokenHint: '****test',
      }
      const result = checkFunctionPermission(context, permissions)
      expect(result.allowed).toBe(true)
      expect(result.grantedBy).toBe('user')
    })

    it('should deny users not in allowlist', () => {
      const context: OAuthContext = {
        userId: 'user-999',
        scopes: [],
        expiresAt: Date.now() + 3600000,
        tokenHint: '****test',
      }
      const result = checkFunctionPermission(context, permissions)
      expect(result.allowed).toBe(false)
    })
  })

  describe('organization allowlist', () => {
    const permissions: FunctionPermissions = {
      allowedOrgs: ['org-1', 'org-2'],
    }

    it('should allow users in allowed orgs', () => {
      const context: OAuthContext = {
        userId: 'user-123',
        scopes: [],
        expiresAt: Date.now() + 3600000,
        tokenHint: '****test',
        organizations: [
          {
            organization: { id: 'org-1', name: 'Org One', slug: 'org-one' },
            role: 'member',
            joinedAt: '2025-01-01T00:00:00Z',
          },
        ],
      }
      const result = checkFunctionPermission(context, permissions)
      expect(result.allowed).toBe(true)
      expect(result.grantedBy).toBe('org')
    })

    it('should deny users not in allowed orgs', () => {
      const context: OAuthContext = {
        userId: 'user-123',
        scopes: [],
        expiresAt: Date.now() + 3600000,
        tokenHint: '****test',
        organizations: [
          {
            organization: { id: 'org-999', name: 'Other Org', slug: 'other-org' },
            role: 'member',
            joinedAt: '2025-01-01T00:00:00Z',
          },
        ],
      }
      const result = checkFunctionPermission(context, permissions)
      expect(result.allowed).toBe(false)
    })
  })

  describe('role requirements', () => {
    const permissions: FunctionPermissions = {
      allowedOrgs: ['org-1'],
      allowedRoles: ['admin', 'owner'],
    }

    it('should allow users with required role', () => {
      const context: OAuthContext = {
        userId: 'user-123',
        scopes: [],
        expiresAt: Date.now() + 3600000,
        tokenHint: '****test',
        organizations: [
          {
            organization: { id: 'org-1', name: 'Org One', slug: 'org-one' },
            role: 'admin',
            joinedAt: '2025-01-01T00:00:00Z',
          },
        ],
      }
      const result = checkFunctionPermission(context, permissions)
      expect(result.allowed).toBe(true)
      expect(result.grantedBy).toBe('org-role')
    })

    it('should deny users without required role', () => {
      const context: OAuthContext = {
        userId: 'user-123',
        scopes: [],
        expiresAt: Date.now() + 3600000,
        tokenHint: '****test',
        organizations: [
          {
            organization: { id: 'org-1', name: 'Org One', slug: 'org-one' },
            role: 'member',
            joinedAt: '2025-01-01T00:00:00Z',
          },
        ],
      }
      const result = checkFunctionPermission(context, permissions)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Required role')
    })
  })
})
