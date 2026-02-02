/**
 * Benchmark worker for esbuild-wasm TypeScript compilation in Cloudflare Workers
 *
 * Tests:
 * 1. Cold start (first request with WASM initialization)
 * 2. Warm request (subsequent requests)
 * 3. Simple vs complex TypeScript compilation
 */

import * as esbuild from 'esbuild-wasm'
// @ts-expect-error -- Cloudflare Workers supports direct .wasm imports; no TS declaration exists
import wasmModule from '../../node_modules/esbuild-wasm/esbuild.wasm'

// Required polyfill for esbuild-wasm (provides performance.now())
// In older Workers runtimes, globalThis.performance may not exist.
if (!globalThis.performance) {
  ;(globalThis as Record<string, unknown>).performance = {
    now: () => Date.now(),
  }
}

let initialized = false
let initTimeMs = 0

// High-resolution timing using performance.now() where available
const now = () => typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()

// Sample TypeScript code for benchmarking
const SIMPLE_TS = `
export default {
  async fetch(request: Request): Promise<Response> {
    const body = await request.json() as { name: string }
    return Response.json({ hello: body.name })
  }
}
`

const COMPLEX_TS = `
interface User {
  id: number
  name: string
  email: string
  roles: Role[]
}

interface Role {
  id: number
  name: string
  permissions: Permission[]
}

type Permission = 'read' | 'write' | 'delete' | 'admin'

type UserResponse = {
  user: User
  token: string
  expiresAt: Date
}

async function fetchUser<T extends User>(id: number): Promise<T | null> {
  const response = await fetch(\`/api/users/\${id}\`)
  if (!response.ok) return null
  return response.json() as Promise<T>
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const userId = parseInt(url.searchParams.get('id') ?? '0')

    const user = await fetchUser<User>(userId)
    if (!user) {
      return Response.json({ error: 'User not found' } satisfies { error: string }, { status: 404 })
    }

    const response: UserResponse = {
      user,
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 3600000)
    }

    return Response.json(response)
  }
}
`

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // Initialize esbuild if not already done
    const wasInitialized = initialized
    if (!initialized) {
      const start = now()
      await esbuild.initialize({
        wasmModule,
        worker: false,
      })
      initTimeMs = now() - start
      initialized = true
    }

    if (path === '/health') {
      return Response.json({ status: 'ok', initialized, initTimeMs: initTimeMs.toFixed(2) + 'ms' })
    }

    if (path === '/benchmark') {
      const results: Record<string, unknown> = {
        coldStart: !wasInitialized,
        initTimeMs: wasInitialized ? 'already initialized' : initTimeMs.toFixed(2) + 'ms',
      }

      // Benchmark simple TypeScript
      const simpleStart = now()
      const simpleResult = await esbuild.transform(SIMPLE_TS, {
        loader: 'ts',
        target: 'esnext',
        format: 'esm',
      })
      const simpleDuration = now() - simpleStart
      results.simpleTransform = {
        durationMs: simpleDuration.toFixed(2) + 'ms',
        inputLength: SIMPLE_TS.length,
        outputLength: simpleResult.code.length,
      }

      // Benchmark complex TypeScript
      const complexStart = now()
      const complexResult = await esbuild.transform(COMPLEX_TS, {
        loader: 'ts',
        target: 'esnext',
        format: 'esm',
      })
      const complexDuration = now() - complexStart
      results.complexTransform = {
        durationMs: complexDuration.toFixed(2) + 'ms',
        inputLength: COMPLEX_TS.length,
        outputLength: complexResult.code.length,
      }

      // Benchmark TSX
      const tsxCode = `
const Button = ({ label }: { label: string }) => <button>{label}</button>
export default Button
`
      const tsxStart = now()
      const tsxResult = await esbuild.transform(tsxCode, {
        loader: 'tsx',
        jsxFactory: 'h',
        jsxFragment: 'Fragment',
        target: 'esnext',
        format: 'esm',
      })
      const tsxDuration = now() - tsxStart
      results.tsxTransform = {
        durationMs: tsxDuration.toFixed(2) + 'ms',
        inputLength: tsxCode.length,
        outputLength: tsxResult.code.length,
      }

      // Total transform time
      results.totalTransformMs = (simpleDuration + complexDuration + tsxDuration).toFixed(2) + 'ms'

      return Response.json(results)
    }

    // Transform arbitrary code
    if (request.method === 'POST' && path === '/transform') {
      const body = await request.json() as { code: string; loader?: 'ts' | 'tsx' }
      const start = now()

      const result = await esbuild.transform(body.code, {
        loader: body.loader ?? 'ts',
        target: 'esnext',
        format: 'esm',
      })

      return Response.json({
        code: result.code,
        durationMs: (now() - start).toFixed(2) + 'ms',
        warnings: result.warnings,
      })
    }

    return Response.json({
      error: 'Unknown endpoint',
      endpoints: ['/health', '/benchmark', 'POST /transform']
    }, { status: 404 })
  }
}
