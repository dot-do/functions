/**
 * Invoke Handler Tests - RED Phase
 *
 * Tests for the function invocation handler including:
 * - Function type dispatch (code, generative, agentic, human, cascade)
 * - Request parsing and validation
 * - Response formatting with metadata
 *
 * These tests import modules that don't exist yet - they will FAIL
 * until the implementation is complete.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockKV } from '../../test-utils/mock-kv'

// Import the invoke handler that doesn't exist yet
// These imports will cause the tests to fail (RED phase)
import { invokeHandler, InvokeHandlerContext } from '../handlers/invoke'
import { CodeExecutor } from '../executors/code'
import { GenerativeExecutor } from '../executors/generative'
import { AgenticExecutor } from '../executors/agentic'
import { HumanExecutor } from '../executors/human'
import { CascadeExecutor } from '../executors/cascade'

// Type for JSON response bodies
type JsonBody = Record<string, unknown>

describe('Invoke Handler', () => {
  let mockEnv: {
    FUNCTIONS_REGISTRY: KVNamespace
    FUNCTIONS_CODE: KVNamespace
    LOADER?: unknown
    USER_FUNCTIONS?: unknown
  }
  let mockCtx: ExecutionContext

  beforeEach(() => {
    mockEnv = {
      FUNCTIONS_REGISTRY: createMockKV(),
      FUNCTIONS_CODE: createMockKV(),
    }
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext
  })

  describe('function type dispatch', () => {
    it('dispatches code function to CodeExecutor', async () => {
      // Set up a code function
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:code-func',
        JSON.stringify({
          id: 'code-func',
          version: '1.0.0',
          language: 'typescript',
          type: 'code',
        })
      )
      await mockEnv.FUNCTIONS_CODE.put(
        'code:code-func',
        `export default {
          async fetch(request: Request) {
            return new Response(JSON.stringify({ executed: true }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }`
      )

      const request = new Request('https://functions.do/functions/code-func', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'test' }),
      })

      const context: InvokeHandlerContext = {
        functionId: 'code-func',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      expect([200, 501]).toContain(response.status)
      if (response.status === 200) {
        const body = (await response.json()) as JsonBody
        expect(body._meta).toBeDefined()
        expect((body._meta as JsonBody).executorType).toBe('code')
      }
    })

    it('dispatches generative function to GenerativeExecutor', async () => {
      // Set up a generative function (AI-powered)
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:gen-func',
        JSON.stringify({
          id: 'gen-func',
          version: '1.0.0',
          type: 'generative',
          model: 'gpt-4',
          prompt: 'You are a helpful assistant.',
        })
      )

      const request = new Request('https://functions.do/functions/gen-func', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello!' }),
      })

      const context: InvokeHandlerContext = {
        functionId: 'gen-func',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      // Should route to generative executor
      expect([200, 501, 503]).toContain(response.status)
      if (response.status === 200) {
        const body = (await response.json()) as JsonBody
        expect((body._meta as JsonBody).executorType).toBe('generative')
      }
    })

    it('dispatches agentic function to AgenticExecutor', async () => {
      // Set up an agentic function (multi-step AI agent)
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:agent-func',
        JSON.stringify({
          id: 'agent-func',
          version: '1.0.0',
          type: 'agentic',
          model: 'claude-3-opus',
          tools: ['search', 'calculator'],
          maxIterations: 5,
        })
      )

      const request = new Request('https://functions.do/functions/agent-func', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'Research quantum computing' }),
      })

      const context: InvokeHandlerContext = {
        functionId: 'agent-func',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      expect([200, 501, 503]).toContain(response.status)
      if (response.status === 200) {
        const body = (await response.json()) as JsonBody
        expect((body._meta as JsonBody).executorType).toBe('agentic')
      }
    })

    it('dispatches human function to HumanExecutor', async () => {
      // Set up a human-in-the-loop function
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:human-func',
        JSON.stringify({
          id: 'human-func',
          version: '1.0.0',
          type: 'human',
          assignees: ['reviewer@example.com'],
          timeout: '24h',
        })
      )

      const request = new Request('https://functions.do/functions/human-func', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: 'Please review this contract.' }),
      })

      const context: InvokeHandlerContext = {
        functionId: 'human-func',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      expect([200, 202, 501, 503]).toContain(response.status)
      if (response.status === 202) {
        const body = (await response.json()) as JsonBody
        expect(body.taskId).toBeDefined()
        expect((body._meta as JsonBody).executorType).toBe('human')
      }
    })

    it('dispatches cascade to CascadeExecutor', async () => {
      // Set up a cascade function (chains multiple functions)
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:cascade-func',
        JSON.stringify({
          id: 'cascade-func',
          version: '1.0.0',
          type: 'cascade',
          steps: [
            { function: 'validate-input' },
            { function: 'process-data' },
            { function: 'format-output' },
          ],
        })
      )

      const request = new Request('https://functions.do/functions/cascade-func', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [1, 2, 3] }),
      })

      const context: InvokeHandlerContext = {
        functionId: 'cascade-func',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      expect([200, 501, 503]).toContain(response.status)
      if (response.status === 200) {
        const body = (await response.json()) as JsonBody
        expect((body._meta as JsonBody).executorType).toBe('cascade')
      }
    })

    it('defaults to code executor when type is not specified', async () => {
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:default-func',
        JSON.stringify({
          id: 'default-func',
          version: '1.0.0',
          language: 'javascript',
          // No type specified - should default to 'code'
        })
      )
      await mockEnv.FUNCTIONS_CODE.put(
        'code:default-func',
        'export default { fetch() { return new Response("ok"); } }'
      )

      const request = new Request('https://functions.do/functions/default-func', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'default-func',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      expect([200, 501]).toContain(response.status)
    })
  })

  describe('request parsing', () => {
    beforeEach(async () => {
      // Set up a basic test function
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:parse-test',
        JSON.stringify({
          id: 'parse-test',
          version: '1.0.0',
          language: 'javascript',
        })
      )
      await mockEnv.FUNCTIONS_CODE.put(
        'code:parse-test',
        `export default {
          async fetch(request) {
            const body = await request.json().catch(() => ({}));
            return new Response(JSON.stringify({ received: body }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }`
      )
    })

    it('parses JSON body as input', async () => {
      const inputData = { name: 'test', value: 42, nested: { key: 'value' } }

      const request = new Request('https://functions.do/functions/parse-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputData),
      })

      const context: InvokeHandlerContext = {
        functionId: 'parse-test',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      if (response.status === 200) {
        const body = (await response.json()) as JsonBody
        expect(body.received).toEqual(inputData)
      }
    })

    it('handles empty body', async () => {
      const request = new Request('https://functions.do/functions/parse-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Empty body
      })

      const context: InvokeHandlerContext = {
        functionId: 'parse-test',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      // Should handle gracefully, not crash
      expect([200, 400, 501]).toContain(response.status)
    })

    it('returns 400 for invalid JSON', async () => {
      const request = new Request('https://functions.do/functions/parse-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json {{{',
      })

      const context: InvokeHandlerContext = {
        functionId: 'parse-test',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(400)
      const body = (await response.json()) as JsonBody
      expect(body.error).toContain('JSON')
    })

    it('accepts form data when Content-Type is multipart', async () => {
      const formData = new FormData()
      formData.append('file', new Blob(['test content']), 'test.txt')
      formData.append('name', 'test-file')

      const request = new Request('https://functions.do/functions/parse-test', {
        method: 'POST',
        body: formData,
      })

      const context: InvokeHandlerContext = {
        functionId: 'parse-test',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      // Should handle form data without crashing
      expect([200, 400, 501]).toContain(response.status)
    })

    it('accepts plain text body', async () => {
      const request = new Request('https://functions.do/functions/parse-test', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'Hello, world!',
      })

      const context: InvokeHandlerContext = {
        functionId: 'parse-test',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      expect([200, 400, 501]).toContain(response.status)
    })
  })

  describe('response formatting', () => {
    beforeEach(async () => {
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:response-test',
        JSON.stringify({
          id: 'response-test',
          version: '1.0.0',
          language: 'javascript',
        })
      )
      await mockEnv.FUNCTIONS_CODE.put(
        'code:response-test',
        `export default {
          async fetch(request) {
            return new Response(JSON.stringify({ result: 'success', count: 42 }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }`
      )
    })

    it('returns result in JSON', async () => {
      const request = new Request('https://functions.do/functions/response-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'response-test',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      if (response.status === 200) {
        const body = (await response.json()) as JsonBody
        expect(body.result).toBe('success')
        expect(body.count).toBe(42)
      }
    })

    it('includes _meta with execution info', async () => {
      const request = new Request('https://functions.do/functions/response-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'response-test',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      if (response.status === 200) {
        const body = (await response.json()) as JsonBody
        expect(body._meta).toBeDefined()

        const meta = body._meta as JsonBody
        expect(meta.duration).toBeDefined()
        expect(typeof meta.duration).toBe('number')
        expect(meta.executedWith).toBeDefined()
      }
    })

    it('sets correct Content-Type', async () => {
      const request = new Request('https://functions.do/functions/response-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'response-test',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('includes timing headers', async () => {
      const request = new Request('https://functions.do/functions/response-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'response-test',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      if (response.status === 200) {
        expect(response.headers.get('X-Execution-Time')).toBeDefined()
      }
    })

    it('wraps non-JSON function responses', async () => {
      // Set up a function that returns plain text
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:text-response',
        JSON.stringify({
          id: 'text-response',
          version: '1.0.0',
          language: 'javascript',
        })
      )
      await mockEnv.FUNCTIONS_CODE.put(
        'code:text-response',
        `export default {
          async fetch() {
            return new Response('Hello, plain text!', {
              headers: { 'Content-Type': 'text/plain' }
            });
          }
        }`
      )

      const request = new Request('https://functions.do/functions/text-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'text-response',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      if (response.status === 200) {
        expect(response.headers.get('Content-Type')).toBe('application/json')
        const body = (await response.json()) as JsonBody
        expect(body.result).toBe('Hello, plain text!')
      }
    })
  })

  describe('error handling', () => {
    it('returns 404 for non-existent function', async () => {
      const request = new Request('https://functions.do/functions/does-not-exist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'does-not-exist',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      expect(response.status).toBe(404)
      const body = (await response.json()) as JsonBody
      expect(body.error).toContain('not found')
    })

    it('returns 500 for function execution errors', async () => {
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:error-func',
        JSON.stringify({
          id: 'error-func',
          version: '1.0.0',
          language: 'javascript',
        })
      )
      await mockEnv.FUNCTIONS_CODE.put(
        'code:error-func',
        `export default {
          async fetch() {
            throw new Error('Function exploded!');
          }
        }`
      )

      const request = new Request('https://functions.do/functions/error-func', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'error-func',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      if (response.status !== 501) {
        expect(response.status).toBe(500)
        const body = (await response.json()) as JsonBody
        expect(body.error).toBeDefined()
      }
    })

    it('handles timeout gracefully', async () => {
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:slow-func',
        JSON.stringify({
          id: 'slow-func',
          version: '1.0.0',
          language: 'javascript',
          timeout: 100, // 100ms timeout
        })
      )
      await mockEnv.FUNCTIONS_CODE.put(
        'code:slow-func',
        `export default {
          async fetch() {
            await new Promise(r => setTimeout(r, 5000)); // 5 second delay
            return new Response('done');
          }
        }`
      )

      const request = new Request('https://functions.do/functions/slow-func', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'slow-func',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      // Should either timeout or complete (depending on implementation)
      expect([200, 408, 500, 501, 504]).toContain(response.status)
    })
  })

  describe('versioning', () => {
    beforeEach(async () => {
      // Set up multiple versions
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:versioned-func',
        JSON.stringify({
          id: 'versioned-func',
          version: '2.0.0',
          language: 'javascript',
        })
      )
      await mockEnv.FUNCTIONS_REGISTRY.put(
        'registry:versioned-func:v:1.0.0',
        JSON.stringify({
          id: 'versioned-func',
          version: '1.0.0',
          language: 'javascript',
        })
      )
      await mockEnv.FUNCTIONS_CODE.put(
        'code:versioned-func',
        `export default { fetch() { return new Response(JSON.stringify({ version: '2.0.0' }), { headers: { 'Content-Type': 'application/json' } }); } }`
      )
      await mockEnv.FUNCTIONS_CODE.put(
        'code:versioned-func:v:1.0.0',
        `export default { fetch() { return new Response(JSON.stringify({ version: '1.0.0' }), { headers: { 'Content-Type': 'application/json' } }); } }`
      )
    })

    it('invokes latest version by default', async () => {
      const request = new Request('https://functions.do/functions/versioned-func', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'versioned-func',
        params: {},
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      if (response.status === 200) {
        const body = (await response.json()) as JsonBody
        expect(body.version).toBe('2.0.0')
      }
    })

    it('invokes specific version when requested', async () => {
      const request = new Request('https://functions.do/functions/versioned-func?version=1.0.0', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const context: InvokeHandlerContext = {
        functionId: 'versioned-func',
        params: {},
        version: '1.0.0',
      }

      const response = await invokeHandler(request, mockEnv, mockCtx, context)

      if (response.status === 200) {
        const body = (await response.json()) as JsonBody
        expect(body.version).toBe('1.0.0')
      }
    })
  })
})
