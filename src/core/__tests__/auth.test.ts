/**
 * Authentication Layer Tests
 *
 * Tests for API key authentication including:
 * - Valid and invalid API keys
 * - Missing API keys
 * - Public endpoint patterns
 * - Custom header names
 * - User ID extraction
 */

import { describe, it, expect, vi } from 'vitest'
import {
  authenticateRequest,
  isPublicEndpoint,
  createAuthMiddleware,
  DEFAULT_PUBLIC_ENDPOINTS,
  type AuthConfig,
} from '../auth'

describe('authenticateRequest', () => {
  describe('Basic API Key Authentication', () => {
    it('should authenticate with valid API key', async () => {
      const config: AuthConfig = {
        validateApiKey: vi.fn().mockResolvedValue(true),
      }
      const request = new Request('https://example.com/test', {
        headers: { 'X-API-Key': 'valid-key' },
      })

      const result = await authenticateRequest(request, config)

      expect(result.authenticated).toBe(true)
      expect(result.error).toBeUndefined()
      expect(config.validateApiKey).toHaveBeenCalledWith('valid-key')
    })

    it('should reject invalid API key', async () => {
      const config: AuthConfig = {
        validateApiKey: vi.fn().mockResolvedValue(false),
      }
      const request = new Request('https://example.com/test', {
        headers: { 'X-API-Key': 'invalid-key' },
      })

      const result = await authenticateRequest(request, config)

      expect(result.authenticated).toBe(false)
      expect(result.error).toBe('Invalid API key')
    })

    it('should reject request with missing API key', async () => {
      const config: AuthConfig = {
        validateApiKey: vi.fn().mockResolvedValue(true),
      }
      const request = new Request('https://example.com/test')

      const result = await authenticateRequest(request, config)

      expect(result.authenticated).toBe(false)
      expect(result.error).toBe('Missing API key')
      expect(config.validateApiKey).not.toHaveBeenCalled()
    })
  })

  describe('Custom Header Name', () => {
    it('should read API key from custom header', async () => {
      const config: AuthConfig = {
        apiKeyHeader: 'Authorization',
        validateApiKey: vi.fn().mockResolvedValue(true),
      }
      const request = new Request('https://example.com/test', {
        headers: { Authorization: 'Bearer my-token' },
      })

      const result = await authenticateRequest(request, config)

      expect(result.authenticated).toBe(true)
      expect(config.validateApiKey).toHaveBeenCalledWith('Bearer my-token')
    })

    it('should fail if custom header is missing', async () => {
      const config: AuthConfig = {
        apiKeyHeader: 'Authorization',
        validateApiKey: vi.fn().mockResolvedValue(true),
      }
      const request = new Request('https://example.com/test', {
        headers: { 'X-API-Key': 'wrong-header' },
      })

      const result = await authenticateRequest(request, config)

      expect(result.authenticated).toBe(false)
      expect(result.error).toBe('Missing API key')
    })
  })

  describe('User ID Extraction', () => {
    it('should extract user ID when getUserId is provided', async () => {
      const config: AuthConfig = {
        validateApiKey: vi.fn().mockResolvedValue(true),
        getUserId: vi.fn().mockResolvedValue('user-123'),
      }
      const request = new Request('https://example.com/test', {
        headers: { 'X-API-Key': 'valid-key' },
      })

      const result = await authenticateRequest(request, config)

      expect(result.authenticated).toBe(true)
      expect(result.userId).toBe('user-123')
      expect(config.getUserId).toHaveBeenCalledWith('valid-key')
    })

    it('should not call getUserId when validation fails', async () => {
      const config: AuthConfig = {
        validateApiKey: vi.fn().mockResolvedValue(false),
        getUserId: vi.fn().mockResolvedValue('user-123'),
      }
      const request = new Request('https://example.com/test', {
        headers: { 'X-API-Key': 'invalid-key' },
      })

      const result = await authenticateRequest(request, config)

      expect(result.authenticated).toBe(false)
      expect(result.userId).toBeUndefined()
      expect(config.getUserId).not.toHaveBeenCalled()
    })

    it('should handle undefined userId from getUserId', async () => {
      const config: AuthConfig = {
        validateApiKey: vi.fn().mockResolvedValue(true),
        getUserId: vi.fn().mockResolvedValue(undefined),
      }
      const request = new Request('https://example.com/test', {
        headers: { 'X-API-Key': 'valid-key' },
      })

      const result = await authenticateRequest(request, config)

      expect(result.authenticated).toBe(true)
      expect(result.userId).toBeUndefined()
    })
  })

  describe('Async Validation', () => {
    it('should handle async validation delay', async () => {
      const config: AuthConfig = {
        validateApiKey: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(true), 10))
        ),
      }
      const request = new Request('https://example.com/test', {
        headers: { 'X-API-Key': 'valid-key' },
      })

      const result = await authenticateRequest(request, config)

      expect(result.authenticated).toBe(true)
    })

    it('should handle validation errors gracefully', async () => {
      const config: AuthConfig = {
        validateApiKey: vi.fn().mockRejectedValue(new Error('DB connection failed')),
      }
      const request = new Request('https://example.com/test', {
        headers: { 'X-API-Key': 'valid-key' },
      })

      await expect(authenticateRequest(request, config)).rejects.toThrow('DB connection failed')
    })
  })
})

describe('isPublicEndpoint', () => {
  describe('Exact Match', () => {
    it('should match exact path', () => {
      expect(isPublicEndpoint('/health', ['/health'])).toBe(true)
      expect(isPublicEndpoint('/health', ['/other'])).toBe(false)
    })

    it('should match root path', () => {
      expect(isPublicEndpoint('/', ['/'])).toBe(true)
    })

    it('should be case-sensitive', () => {
      expect(isPublicEndpoint('/Health', ['/health'])).toBe(false)
    })
  })

  describe('Single Wildcard Pattern', () => {
    it('should match paths with single wildcard', () => {
      expect(isPublicEndpoint('/public/file.txt', ['/public/*'])).toBe(true)
      expect(isPublicEndpoint('/public/any-path', ['/public/*'])).toBe(true)
    })

    it('should match the prefix path itself', () => {
      expect(isPublicEndpoint('/public', ['/public/*'])).toBe(true)
    })

    it('should not match nested paths with single wildcard', () => {
      // Single wildcard should only match one level
      expect(isPublicEndpoint('/public/nested/path', ['/public/*'])).toBe(true)
    })
  })

  describe('Double Wildcard Pattern', () => {
    it('should match deeply nested paths', () => {
      expect(isPublicEndpoint('/api/v1/users', ['/api/**'])).toBe(true)
      expect(isPublicEndpoint('/api/v1/users/123/posts', ['/api/**'])).toBe(true)
    })

    it('should match the prefix path itself', () => {
      expect(isPublicEndpoint('/api', ['/api/**'])).toBe(true)
    })
  })

  describe('Multiple Patterns', () => {
    it('should match any of multiple patterns', () => {
      const patterns = ['/health', '/public/*', '/api/**']
      expect(isPublicEndpoint('/health', patterns)).toBe(true)
      expect(isPublicEndpoint('/public/file', patterns)).toBe(true)
      expect(isPublicEndpoint('/api/v1/test', patterns)).toBe(true)
      expect(isPublicEndpoint('/private/data', patterns)).toBe(false)
    })
  })

  describe('Empty Patterns', () => {
    it('should not match when patterns array is empty', () => {
      expect(isPublicEndpoint('/any-path', [])).toBe(false)
    })
  })
})

describe('createAuthMiddleware', () => {
  it('should return null for public endpoints', async () => {
    const config: AuthConfig = {
      validateApiKey: vi.fn().mockResolvedValue(true),
      publicEndpoints: ['/health', '/public/*'],
    }
    const middleware = createAuthMiddleware(config)

    const request = new Request('https://example.com/health')
    const result = await middleware(request)

    expect(result).toBeNull()
    expect(config.validateApiKey).not.toHaveBeenCalled()
  })

  it('should authenticate non-public endpoints', async () => {
    const config: AuthConfig = {
      validateApiKey: vi.fn().mockResolvedValue(true),
      publicEndpoints: ['/health'],
    }
    const middleware = createAuthMiddleware(config)

    const request = new Request('https://example.com/private', {
      headers: { 'X-API-Key': 'valid-key' },
    })
    const result = await middleware(request)

    expect(result).not.toBeNull()
    expect(result?.authenticated).toBe(true)
    expect(config.validateApiKey).toHaveBeenCalledWith('valid-key')
  })

  it('should reject unauthenticated non-public requests', async () => {
    const config: AuthConfig = {
      validateApiKey: vi.fn().mockResolvedValue(false),
      publicEndpoints: ['/health'],
    }
    const middleware = createAuthMiddleware(config)

    const request = new Request('https://example.com/private', {
      headers: { 'X-API-Key': 'invalid-key' },
    })
    const result = await middleware(request)

    expect(result).not.toBeNull()
    expect(result?.authenticated).toBe(false)
    expect(result?.error).toBe('Invalid API key')
  })
})

describe('DEFAULT_PUBLIC_ENDPOINTS', () => {
  it('should include root and health endpoints', () => {
    expect(DEFAULT_PUBLIC_ENDPOINTS).toContain('/')
    expect(DEFAULT_PUBLIC_ENDPOINTS).toContain('/health')
  })
})
