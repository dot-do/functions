/**
 * Health Handler for Functions.do
 *
 * Returns service health status.
 */

import type { RouteContext, Env, Handler } from '../router'

/**
 * Health check handler
 */
export const healthHandler: Handler = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  context?: RouteContext
): Promise<Response> => {
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
