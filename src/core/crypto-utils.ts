/**
 * Shared cryptographic utilities for Functions.do
 *
 * Provides common hash functions used across the platform.
 * All implementations use the Web Crypto API for Cloudflare Workers compatibility.
 *
 * @module core/crypto-utils
 */

/**
 * Compute SHA-256 hash of a string using Web Crypto API
 *
 * @param input - The string to hash
 * @returns The hex-encoded SHA-256 hash
 */
export async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Hash an API key using SHA-256
 *
 * Convenience alias for sha256, used for API key hashing throughout the platform.
 *
 * @param apiKey - The raw API key to hash
 * @returns The hex-encoded SHA-256 hash
 */
export async function hashApiKey(apiKey: string): Promise<string> {
  return sha256(apiKey)
}
