/**
 * SSRF Protection Tests
 *
 * Tests for URL validation to prevent Server-Side Request Forgery attacks.
 * Covers:
 * - Private IPv4 ranges (RFC 1918)
 * - Loopback addresses
 * - Link-local / cloud metadata endpoints
 * - IPv6 private ranges
 * - Protocol enforcement (HTTPS required)
 * - Edge cases (invalid URLs, encoding tricks)
 */

import { describe, it, expect } from 'vitest'
import { validateFetchUrl } from '../ssrf-protection'

describe('SSRF Protection - validateFetchUrl', () => {
  describe('Valid public HTTPS URLs', () => {
    it('should allow https://example.com', () => {
      const result = validateFetchUrl('https://example.com')
      expect(result.valid).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('should allow https://api.github.com/repos', () => {
      const result = validateFetchUrl('https://api.github.com/repos')
      expect(result.valid).toBe(true)
    })

    it('should allow https://1.1.1.1 (Cloudflare DNS)', () => {
      const result = validateFetchUrl('https://1.1.1.1')
      expect(result.valid).toBe(true)
    })

    it('should allow https://8.8.8.8 (Google DNS)', () => {
      const result = validateFetchUrl('https://8.8.8.8')
      expect(result.valid).toBe(true)
    })

    it('should allow HTTPS URL with path, query, and fragment', () => {
      const result = validateFetchUrl('https://example.com/path?key=value#section')
      expect(result.valid).toBe(true)
    })

    it('should allow HTTPS URL with port', () => {
      const result = validateFetchUrl('https://example.com:8443/api')
      expect(result.valid).toBe(true)
    })
  })

  describe('Block loopback addresses (127.0.0.0/8)', () => {
    it('should block 127.0.0.1', () => {
      const result = validateFetchUrl('https://127.0.0.1')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('loopback')
    })

    it('should block 127.0.0.1 with path', () => {
      const result = validateFetchUrl('https://127.0.0.1/admin')
      expect(result.valid).toBe(false)
    })

    it('should block 127.255.255.255', () => {
      const result = validateFetchUrl('https://127.255.255.255')
      expect(result.valid).toBe(false)
    })

    it('should block 127.0.0.2', () => {
      const result = validateFetchUrl('https://127.0.0.2')
      expect(result.valid).toBe(false)
    })
  })

  describe('Block private 10.0.0.0/8', () => {
    it('should block 10.0.0.1', () => {
      const result = validateFetchUrl('https://10.0.0.1')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('private')
    })

    it('should block 10.255.255.255', () => {
      const result = validateFetchUrl('https://10.255.255.255')
      expect(result.valid).toBe(false)
    })

    it('should block 10.0.0.0', () => {
      const result = validateFetchUrl('https://10.0.0.0')
      expect(result.valid).toBe(false)
    })

    it('should block 10.128.64.32', () => {
      const result = validateFetchUrl('https://10.128.64.32')
      expect(result.valid).toBe(false)
    })
  })

  describe('Block private 172.16.0.0/12', () => {
    it('should block 172.16.0.1', () => {
      const result = validateFetchUrl('https://172.16.0.1')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('private')
    })

    it('should block 172.31.255.255', () => {
      const result = validateFetchUrl('https://172.31.255.255')
      expect(result.valid).toBe(false)
    })

    it('should block 172.20.10.5', () => {
      const result = validateFetchUrl('https://172.20.10.5')
      expect(result.valid).toBe(false)
    })

    it('should allow 172.15.255.255 (just outside the range)', () => {
      const result = validateFetchUrl('https://172.15.255.255')
      expect(result.valid).toBe(true)
    })

    it('should allow 172.32.0.0 (just outside the range)', () => {
      const result = validateFetchUrl('https://172.32.0.0')
      expect(result.valid).toBe(true)
    })
  })

  describe('Block private 192.168.0.0/16', () => {
    it('should block 192.168.0.1', () => {
      const result = validateFetchUrl('https://192.168.0.1')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('private')
    })

    it('should block 192.168.1.1', () => {
      const result = validateFetchUrl('https://192.168.1.1')
      expect(result.valid).toBe(false)
    })

    it('should block 192.168.255.255', () => {
      const result = validateFetchUrl('https://192.168.255.255')
      expect(result.valid).toBe(false)
    })

    it('should allow 192.169.0.1 (just outside the range)', () => {
      const result = validateFetchUrl('https://192.169.0.1')
      expect(result.valid).toBe(true)
    })
  })

  describe('Block link-local 169.254.0.0/16 (cloud metadata)', () => {
    it('should block 169.254.169.254 (AWS/GCP metadata endpoint)', () => {
      const result = validateFetchUrl('https://169.254.169.254')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('link-local')
    })

    it('should block 169.254.169.254 with metadata path', () => {
      const result = validateFetchUrl('https://169.254.169.254/latest/meta-data/')
      expect(result.valid).toBe(false)
    })

    it('should block 169.254.0.1', () => {
      const result = validateFetchUrl('https://169.254.0.1')
      expect(result.valid).toBe(false)
    })

    it('should block 169.254.255.255', () => {
      const result = validateFetchUrl('https://169.254.255.255')
      expect(result.valid).toBe(false)
    })

    it('should block http://169.254.169.254 (metadata over HTTP)', () => {
      const result = validateFetchUrl('http://169.254.169.254')
      expect(result.valid).toBe(false)
    })
  })

  describe('Block IPv6 loopback (::1)', () => {
    it('should block https://[::1]', () => {
      const result = validateFetchUrl('https://[::1]')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('loopback')
    })

    it('should block https://[::1]:8080', () => {
      const result = validateFetchUrl('https://[::1]:8080')
      expect(result.valid).toBe(false)
    })
  })

  describe('Block IPv6 unique local (fc00::/7)', () => {
    it('should block https://[fc00::1]', () => {
      const result = validateFetchUrl('https://[fc00::1]')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('unique local')
    })

    it('should block https://[fd00::1]', () => {
      const result = validateFetchUrl('https://[fd00::1]')
      expect(result.valid).toBe(false)
    })

    it('should block https://[fdab:cdef:1234::1]', () => {
      const result = validateFetchUrl('https://[fdab:cdef:1234::1]')
      expect(result.valid).toBe(false)
    })
  })

  describe('Block IPv6 link-local (fe80::/10)', () => {
    it('should block https://[fe80::1]', () => {
      const result = validateFetchUrl('https://[fe80::1]')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('link-local')
    })

    it('should block https://[fe80::1%25eth0] (with zone ID)', () => {
      // URL-encoded zone ID: %25 = %
      const result = validateFetchUrl('https://[fe80::1%25eth0]')
      expect(result.valid).toBe(false)
    })
  })

  describe('Protocol enforcement', () => {
    it('should block http:// URLs to public hosts', () => {
      const result = validateFetchUrl('http://example.com')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('HTTPS')
    })

    it('should block http:// URLs to public IPs', () => {
      const result = validateFetchUrl('http://8.8.8.8')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('HTTPS')
    })

    it('should allow http://localhost for dev', () => {
      // localhost http is allowed for development, though IP check still applies
      const result = validateFetchUrl('http://localhost')
      expect(result.valid).toBe(true)
    })

    it('should block ftp:// protocol', () => {
      const result = validateFetchUrl('ftp://example.com/file')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('protocol')
    })

    it('should block file:// protocol', () => {
      const result = validateFetchUrl('file:///etc/passwd')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('protocol')
    })

    it('should block data: protocol', () => {
      const result = validateFetchUrl('data:text/html,<script>alert(1)</script>')
      expect(result.valid).toBe(false)
    })
  })

  describe('Edge cases and invalid URLs', () => {
    it('should reject empty string', () => {
      const result = validateFetchUrl('')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('Invalid URL')
    })

    it('should reject malformed URL', () => {
      const result = validateFetchUrl('not-a-url')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('Invalid URL')
    })

    it('should reject URL without protocol', () => {
      const result = validateFetchUrl('example.com')
      expect(result.valid).toBe(false)
    })

    it('should block 0.0.0.0', () => {
      const result = validateFetchUrl('https://0.0.0.0')
      expect(result.valid).toBe(false)
    })

    it('should block numeric hostname encoding tricks', () => {
      // Numeric-only hostnames could be decimal IP representations
      // The URL parser may resolve these to IPv4, which the IP check catches
      const result = validateFetchUrl('https://2130706433') // 127.0.0.1 in decimal
      expect(result.valid).toBe(false)
    })

    it('should block hex hostname encoding tricks', () => {
      // Hex-encoded IPs may be resolved by the URL parser
      const result = validateFetchUrl('https://0x7f000001') // 127.0.0.1 in hex
      expect(result.valid).toBe(false)
    })

    it('should block IPv4-mapped IPv6 for private ranges', () => {
      const result = validateFetchUrl('https://[::ffff:127.0.0.1]')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('IPv4-mapped')
    })

    it('should block IPv4-mapped IPv6 for metadata endpoint', () => {
      const result = validateFetchUrl('https://[::ffff:169.254.169.254]')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('IPv4-mapped')
    })

    it('should allow IPv4-mapped IPv6 for public IPs', () => {
      const result = validateFetchUrl('https://[::ffff:8.8.8.8]')
      expect(result.valid).toBe(true)
    })
  })
})
