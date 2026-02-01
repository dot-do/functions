/**
 * Health Handler for Functions.do
 *
 * Returns service health status for monitoring and load balancer health checks.
 *
 * @module handlers/health
 */

import type { Handler } from '../router'

/**
 * Health check handler.
 *
 * Returns a simple JSON response indicating the service is operational.
 * Used by load balancers and monitoring systems to verify service availability.
 *
 * @returns JSON response with status 'ok' and service name
 *
 * @example
 * // GET /health
 * // Response: { "status": "ok", "service": "Functions.do" }
 */
export const healthHandler: Handler = async (): Promise<Response> => {
  return new Response(
    JSON.stringify({
      status: 'ok',
      service: 'Functions.do',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}
