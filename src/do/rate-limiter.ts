/**
 * Rate Limiter Durable Object
 *
 * Provides distributed rate limiting across Worker instances.
 * This is a stub implementation - actual rate limiting logic to be added.
 */

import { DurableObject } from 'cloudflare:workers'

interface Env {
  // Environment bindings
}

export class RateLimiterDO extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    // Stub implementation - returns success for all requests
    return Response.json({ allowed: true, remaining: 100 })
  }
}
