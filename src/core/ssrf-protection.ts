/**
 * SSRF (Server-Side Request Forgery) Protection
 *
 * Validates URLs before fetching to prevent access to:
 * - Private/internal networks (RFC 1918)
 * - Loopback addresses (127.0.0.0/8, ::1)
 * - Link-local addresses (169.254.0.0/16 - cloud metadata endpoints)
 * - IPv6 private ranges (fc00::/7, fe80::/10)
 * - Non-HTTPS URLs (except localhost for dev)
 */

export interface SsrfValidationResult {
  valid: boolean
  reason?: string
}

/**
 * Parse an IPv4 address string into a 32-bit number.
 * Returns null if the string is not a valid IPv4 address.
 */
function parseIPv4(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null

  let result = 0
  for (const part of parts) {
    const num = Number(part)
    if (!Number.isInteger(num) || num < 0 || num > 255 || part !== String(num)) {
      return null
    }
    result = (result << 8) | num
  }
  // Convert to unsigned 32-bit
  return result >>> 0
}

/**
 * Check if an IPv4 address (as a 32-bit number) falls within a CIDR range.
 */
function isInCIDR(ip: number, network: number, prefixLength: number): boolean {
  const mask = prefixLength === 0 ? 0 : (~0 << (32 - prefixLength)) >>> 0
  return (ip & mask) === (network & mask)
}

/** Blocked IPv4 CIDR ranges */
const BLOCKED_IPV4_RANGES: Array<{ network: number; prefix: number; label: string }> = [
  { network: parseIPv4('127.0.0.0')!, prefix: 8, label: 'loopback (127.0.0.0/8)' },
  { network: parseIPv4('10.0.0.0')!, prefix: 8, label: 'private (10.0.0.0/8)' },
  { network: parseIPv4('172.16.0.0')!, prefix: 12, label: 'private (172.16.0.0/12)' },
  { network: parseIPv4('192.168.0.0')!, prefix: 16, label: 'private (192.168.0.0/16)' },
  { network: parseIPv4('169.254.0.0')!, prefix: 16, label: 'link-local (169.254.0.0/16)' },
  { network: parseIPv4('0.0.0.0')!, prefix: 8, label: 'unspecified (0.0.0.0/8)' },
]

/**
 * Normalize an IPv6 address to its full expanded form for prefix matching.
 * Returns the lowercase hex string without colons (32 hex chars) or null if invalid.
 */
function normalizeIPv6(ip: string): string | null {
  // Handle IPv4-mapped IPv6 (::ffff:1.2.3.4)
  const v4MappedMatch = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i)
  if (v4MappedMatch) {
    const v4 = parseIPv4(v4MappedMatch[1])
    if (v4 === null) return null
    return '00000000000000000000ffff' + v4.toString(16).padStart(8, '0')
  }

  // Split on :: to handle abbreviation
  const parts = ip.split('::')
  if (parts.length > 2) return null

  let groups: string[] = []
  if (parts.length === 2) {
    const left = parts[0] ? parts[0].split(':') : []
    const right = parts[1] ? parts[1].split(':') : []
    const missing = 8 - left.length - right.length
    if (missing < 0) return null
    groups = [...left, ...Array(missing).fill('0'), ...right]
  } else {
    groups = ip.split(':')
  }

  if (groups.length !== 8) return null

  const hex = groups.map(g => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
    return g.padStart(4, '0').toLowerCase()
  })

  if (hex.some(h => h === null)) return null
  return hex.join('')
}

/** Check if an IPv6 address (in normalized hex form) matches a prefix */
function isIPv6InPrefix(normalized: string, prefix: string): boolean {
  return normalized.startsWith(prefix.toLowerCase())
}

/** Blocked IPv6 prefixes (in normalized hex form) */
const BLOCKED_IPV6_PREFIXES: Array<{ prefix: string; label: string }> = [
  { prefix: '00000000000000000000000000000001', label: 'loopback (::1)' },
  { prefix: '00000000000000000000000000000000', label: 'unspecified (::)' },
  { prefix: 'fc', label: 'unique local (fc00::/7)' },
  { prefix: 'fd', label: 'unique local (fc00::/7)' },
  { prefix: 'fe80', label: 'link-local (fe80::/10)' },
  { prefix: 'fe90', label: 'link-local (fe80::/10)' },
  { prefix: 'fea0', label: 'link-local (fe80::/10)' },
  { prefix: 'feb0', label: 'link-local (fe80::/10)' },
]

/**
 * Check if a hostname is an IPv6 address and if so, whether it's blocked.
 * Returns { blocked: true, reason } if blocked, { blocked: false } otherwise.
 */
function checkIPv6(hostname: string): { blocked: boolean; reason?: string } {
  // IPv6 in URLs is enclosed in brackets: [::1]
  let ipv6 = hostname
  if (ipv6.startsWith('[') && ipv6.endsWith(']')) {
    ipv6 = ipv6.slice(1, -1)
  }

  // Remove zone ID if present (%25eth0 or %eth0)
  const zoneIndex = ipv6.indexOf('%')
  if (zoneIndex !== -1) {
    ipv6 = ipv6.substring(0, zoneIndex)
  }

  const normalized = normalizeIPv6(ipv6)
  if (!normalized) return { blocked: false }

  // Check IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
  if (normalized.startsWith('00000000000000000000ffff')) {
    const ipv4Hex = normalized.slice(24)
    const ipv4Num = parseInt(ipv4Hex, 16) >>> 0
    for (const range of BLOCKED_IPV4_RANGES) {
      if (isInCIDR(ipv4Num, range.network, range.prefix)) {
        return { blocked: true, reason: `IPv4-mapped IPv6 resolves to blocked range: ${range.label}` }
      }
    }
    return { blocked: false }
  }

  for (const { prefix, label } of BLOCKED_IPV6_PREFIXES) {
    if (prefix.length === 32) {
      // Exact match (::1, ::)
      if (normalized === prefix) {
        return { blocked: true, reason: `Blocked IPv6 address: ${label}` }
      }
    } else {
      if (isIPv6InPrefix(normalized, prefix)) {
        return { blocked: true, reason: `Blocked IPv6 range: ${label}` }
      }
    }
  }

  return { blocked: false }
}

/**
 * Validate a URL for SSRF safety before making a fetch request.
 *
 * @param url - The URL string to validate
 * @returns An object with `valid: true` if safe, or `valid: false` with a `reason` if blocked
 */
export function validateFetchUrl(url: string): SsrfValidationResult {
  // Parse the URL
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { valid: false, reason: 'Invalid URL' }
  }

  const protocol = parsed.protocol
  const hostname = parsed.hostname

  // Block non-HTTP(S) protocols entirely (file://, ftp://, data:, etc.)
  if (protocol !== 'https:' && protocol !== 'http:') {
    return { valid: false, reason: `Blocked protocol: ${protocol} - only HTTPS is allowed` }
  }

  // Require HTTPS for non-localhost
  if (protocol === 'http:') {
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
    if (!isLocalhost) {
      return { valid: false, reason: 'HTTP is not allowed - use HTTPS' }
    }
    // Even localhost http is allowed only for dev, but we still check the IP
  }

  // Check for empty hostname
  if (!hostname) {
    return { valid: false, reason: 'Missing hostname' }
  }

  // Check if hostname is an IPv4 address
  const ipv4 = parseIPv4(hostname)
  if (ipv4 !== null) {
    for (const range of BLOCKED_IPV4_RANGES) {
      if (isInCIDR(ipv4, range.network, range.prefix)) {
        return { valid: false, reason: `Blocked IP range: ${range.label}` }
      }
    }
    return { valid: true }
  }

  // Check if hostname is an IPv6 address (with or without brackets)
  const ipv6Check = checkIPv6(hostname)
  if (ipv6Check.blocked) {
    return { valid: false, reason: ipv6Check.reason }
  }

  // For hostnames (not raw IPs), check for suspicious patterns
  // Block numeric-only hostnames that could be octal/hex IP encoding tricks
  if (/^0x[0-9a-fA-F]+$/.test(hostname) || /^0[0-7]+$/.test(hostname) || /^\d+$/.test(hostname)) {
    return { valid: false, reason: 'Blocked: numeric hostname may encode a private IP' }
  }

  // Valid public URL
  return { valid: true }
}
