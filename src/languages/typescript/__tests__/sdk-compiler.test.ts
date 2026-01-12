/**
 * Tests for TypeScript SDK Compiler Utilities
 *
 * Tests the following functionality:
 * - Function signature extraction from TypeScript source
 * - Type definition generation (.d.ts)
 * - capnweb RpcTarget bindings generation
 * - API documentation generation
 */

import { describe, it, expect } from 'vitest'
import {
  extractFunctionSignatures,
  generateTypeDefinitions,
  generateTypesFromSource,
  generateRpcBindings,
  generateApiDocumentation,
  generateMarkdownDocs,
  type FunctionSignature,
} from '../sdk-compiler'

describe('Function Signature Extraction', () => {
  it('extracts basic function signatures', () => {
    const code = `
      export function greet(name: string): string {
        return \`Hello, \${name}!\`
      }
    `
    const signatures = extractFunctionSignatures(code)

    expect(signatures).toHaveLength(1)
    expect(signatures[0].name).toBe('greet')
    expect(signatures[0].params).toHaveLength(1)
    expect(signatures[0].params[0].name).toBe('name')
    expect(signatures[0].params[0].type).toBe('string')
    expect(signatures[0].returnType).toBe('string')
    expect(signatures[0].isAsync).toBe(false)
  })

  it('extracts async function signatures', () => {
    const code = `
      export async function fetchData(url: string): Promise<string> {
        const response = await fetch(url)
        return response.text()
      }
    `
    const signatures = extractFunctionSignatures(code)

    expect(signatures).toHaveLength(1)
    expect(signatures[0].name).toBe('fetchData')
    expect(signatures[0].isAsync).toBe(true)
    expect(signatures[0].returnType).toBe('Promise<string>')
  })

  it('extracts multiple parameters', () => {
    const code = `
      export function add(a: number, b: number): number {
        return a + b
      }
    `
    const signatures = extractFunctionSignatures(code)

    expect(signatures).toHaveLength(1)
    expect(signatures[0].params).toHaveLength(2)
    expect(signatures[0].params[0].name).toBe('a')
    expect(signatures[0].params[0].type).toBe('number')
    expect(signatures[0].params[1].name).toBe('b')
    expect(signatures[0].params[1].type).toBe('number')
  })

  it('handles optional parameters', () => {
    const code = `
      export function greet(name: string, greeting?: string): string {
        return \`\${greeting || 'Hello'}, \${name}!\`
      }
    `
    const signatures = extractFunctionSignatures(code)

    expect(signatures).toHaveLength(1)
    expect(signatures[0].params).toHaveLength(2)
    expect(signatures[0].params[0].optional).toBe(false)
    expect(signatures[0].params[1].optional).toBe(true)
  })

  it('handles complex types', () => {
    const code = `
      export function process(input: { name: string; age: number }): Promise<void> {
        console.log(input)
      }
    `
    const signatures = extractFunctionSignatures(code)

    expect(signatures).toHaveLength(1)
    expect(signatures[0].params[0].type).toContain('name: string')
    expect(signatures[0].params[0].type).toContain('age: number')
  })

  it('extracts JSDoc description', () => {
    const code = `
      /**
       * Greets a user by name
       */
      export function greet(name: string): string {
        return \`Hello, \${name}!\`
      }
    `
    const signatures = extractFunctionSignatures(code)

    expect(signatures).toHaveLength(1)
    expect(signatures[0].description).toBe('Greets a user by name')
  })

  it('extracts JSDoc tags', () => {
    const code = `
      /**
       * Adds two numbers together
       * @param a - The first number
       * @param b - The second number
       * @returns The sum of a and b
       */
      export function add(a: number, b: number): number {
        return a + b
      }
    `
    const signatures = extractFunctionSignatures(code)

    expect(signatures).toHaveLength(1)
    expect(signatures[0].jsdocTags).toBeDefined()
    expect(signatures[0].jsdocTags!.length).toBeGreaterThan(0)

    const paramTags = signatures[0].jsdocTags!.filter((t) => t.tag === 'param')
    expect(paramTags).toHaveLength(2)
  })

  it('extracts arrow functions', () => {
    const code = `
      export const multiply = (a: number, b: number): number => a * b
    `
    const signatures = extractFunctionSignatures(code)

    expect(signatures).toHaveLength(1)
    expect(signatures[0].name).toBe('multiply')
    expect(signatures[0].params).toHaveLength(2)
  })

  it('extracts async arrow functions', () => {
    const code = `
      export const fetchJson = async (url: string): Promise<unknown> => {
        const response = await fetch(url)
        return response.json()
      }
    `
    const signatures = extractFunctionSignatures(code)

    expect(signatures).toHaveLength(1)
    expect(signatures[0].name).toBe('fetchJson')
    expect(signatures[0].isAsync).toBe(true)
  })

  it('handles functions with no parameters', () => {
    const code = `
      export function getTime(): string {
        return new Date().toISOString()
      }
    `
    const signatures = extractFunctionSignatures(code)

    expect(signatures).toHaveLength(1)
    expect(signatures[0].params).toHaveLength(0)
    expect(signatures[0].returnType).toBe('string')
  })

  it('handles generic functions', () => {
    const code = `
      export function identity<T>(value: T): T {
        return value
      }
    `
    const signatures = extractFunctionSignatures(code)

    expect(signatures).toHaveLength(1)
    expect(signatures[0].name).toBe('identity')
  })
})

describe('Type Definition Generation', () => {
  it('generates type definitions from signatures', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'greet',
        params: [{ name: 'name', type: 'string', optional: false }],
        returnType: 'string',
        isAsync: false,
        description: 'Greets a user',
      },
    ]

    const dts = generateTypeDefinitions(signatures, 'my-functions')

    expect(dts).toContain("declare module 'my-functions'")
    expect(dts).toContain('export function greet(name: string): string')
    expect(dts).toContain('Greets a user')
  })

  it('generates async function declarations', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'fetchData',
        params: [{ name: 'url', type: 'string', optional: false }],
        returnType: 'Promise<string>',
        isAsync: true,
      },
    ]

    const dts = generateTypeDefinitions(signatures, 'data-fetcher')

    expect(dts).toContain('export async function fetchData(url: string): Promise<string>')
  })

  it('handles optional parameters', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'format',
        params: [
          { name: 'value', type: 'string', optional: false },
          { name: 'options', type: 'FormatOptions', optional: true },
        ],
        returnType: 'string',
        isAsync: false,
      },
    ]

    const dts = generateTypeDefinitions(signatures, 'formatter')

    expect(dts).toContain('value: string')
    expect(dts).toContain('options?: FormatOptions')
  })

  it('includes JSDoc comments in type definitions', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'add',
        params: [
          { name: 'a', type: 'number', optional: false },
          { name: 'b', type: 'number', optional: false },
        ],
        returnType: 'number',
        isAsync: false,
        description: 'Adds two numbers',
        jsdocTags: [
          { tag: 'param', name: 'a', description: 'First number' },
          { tag: 'param', name: 'b', description: 'Second number' },
          { tag: 'returns', description: 'The sum' },
        ],
      },
    ]

    const dts = generateTypeDefinitions(signatures, 'math')

    expect(dts).toContain('Adds two numbers')
    expect(dts).toContain('@param a')
    expect(dts).toContain('@param b')
    expect(dts).toContain('@returns')
  })
})

describe('Generate Types From Source', () => {
  it('generates .d.ts from source code', async () => {
    const code = `
      /**
       * Multiply two numbers
       * @param a - First number
       * @param b - Second number
       * @returns The product
       */
      export function multiply(a: number, b: number): number {
        return a * b
      }
    `

    const result = await generateTypesFromSource(code, 'calculator')

    expect(result.errors).toBeUndefined()
    expect(result.signatures).toHaveLength(1)
    expect(result.dts).toContain("declare module 'calculator'")
    expect(result.dts).toContain('multiply')
  })

  it('handles multiple functions', async () => {
    const code = `
      export function add(a: number, b: number): number {
        return a + b
      }

      export function subtract(a: number, b: number): number {
        return a - b
      }

      export async function fetchNumber(url: string): Promise<number> {
        const response = await fetch(url)
        return parseInt(await response.text())
      }
    `

    const result = await generateTypesFromSource(code, 'math-utils')

    expect(result.signatures).toHaveLength(3)
    expect(result.signatures.map((s) => s.name)).toEqual(['add', 'subtract', 'fetchNumber'])
  })
})

describe('capnweb RpcTarget Bindings Generation', () => {
  it('generates RpcTarget class from signatures', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'greet',
        params: [{ name: 'name', type: 'string', optional: false }],
        returnType: 'Promise<string>',
        isAsync: true,
        description: 'Greets a user',
      },
    ]

    const result = generateRpcBindings(signatures, 'GreeterTarget')

    expect(result.code).toContain("import { RpcTarget } from 'capnweb'")
    expect(result.code).toContain('class GreeterTarget extends RpcTarget')
    expect(result.code).toContain('interface GreeterTargetFunctions')
    expect(result.code).toContain('async greet(name: string): Promise<string>')
    expect(result.code).toContain('Greets a user')
  })

  it('includes metrics tracking by default', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'process',
        params: [],
        returnType: 'void',
        isAsync: false,
      },
    ]

    const result = generateRpcBindings(signatures, 'ProcessorTarget')

    expect(result.code).toContain('_requestCount')
    expect(result.code).toContain('_errorCount')
    expect(result.code).toContain('getMetrics()')
  })

  it('includes tracing by default', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'action',
        params: [],
        returnType: 'void',
        isAsync: false,
      },
    ]

    const result = generateRpcBindings(signatures, 'ActionTarget')

    expect(result.code).toContain('performance.now()')
    expect(result.code).toContain('_traceId')
  })

  it('can disable metrics and tracing', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'simple',
        params: [],
        returnType: 'void',
        isAsync: false,
      },
    ]

    const result = generateRpcBindings(signatures, 'SimpleTarget', {
      includeMetrics: false,
      includeTracing: false,
    })

    expect(result.code).not.toContain('_requestCount')
    expect(result.code).not.toContain('_traceId')
    expect(result.code).not.toContain('performance.now()')
  })

  it('generates type definitions for bindings', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'add',
        params: [
          { name: 'a', type: 'number', optional: false },
          { name: 'b', type: 'number', optional: false },
        ],
        returnType: 'number',
        isAsync: false,
      },
    ]

    const result = generateRpcBindings(signatures, 'MathTarget')

    expect(result.dts).toContain('interface MathTargetFunctions')
    expect(result.dts).toContain('declare class MathTarget extends RpcTarget')
    expect(result.dts).toContain('add(a: number, b: number): number')
  })

  it('allows custom RpcTarget import path', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'test',
        params: [],
        returnType: 'void',
        isAsync: false,
      },
    ]

    const result = generateRpcBindings(signatures, 'TestTarget', {
      rpcTargetImport: '@functions.do/sdk/capnweb',
    })

    expect(result.code).toContain("import { RpcTarget } from '@functions.do/sdk/capnweb'")
    expect(result.dts).toContain("import { RpcTarget } from '@functions.do/sdk/capnweb'")
  })

  it('handles multiple async methods', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'create',
        params: [{ name: 'data', type: 'CreateInput', optional: false }],
        returnType: 'Promise<Entity>',
        isAsync: true,
      },
      {
        name: 'read',
        params: [{ name: 'id', type: 'string', optional: false }],
        returnType: 'Promise<Entity>',
        isAsync: true,
      },
      {
        name: 'update',
        params: [
          { name: 'id', type: 'string', optional: false },
          { name: 'data', type: 'UpdateInput', optional: false },
        ],
        returnType: 'Promise<Entity>',
        isAsync: true,
      },
      {
        name: 'delete',
        params: [{ name: 'id', type: 'string', optional: false }],
        returnType: 'Promise<void>',
        isAsync: true,
      },
    ]

    const result = generateRpcBindings(signatures, 'CrudTarget')

    expect(result.code).toContain('async create(data: CreateInput): Promise<Entity>')
    expect(result.code).toContain('async read(id: string): Promise<Entity>')
    expect(result.code).toContain('async update(id: string, data: UpdateInput): Promise<Entity>')
    expect(result.code).toContain('async delete(id: string): Promise<void>')
  })
})

describe('API Documentation Generation', () => {
  it('generates structured API documentation', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'greet',
        params: [{ name: 'name', type: 'string', optional: false }],
        returnType: 'string',
        isAsync: false,
        description: 'Greets a user by name',
        jsdocTags: [
          { tag: 'param', name: 'name', description: 'The user name' },
          { tag: 'returns', description: 'A greeting message' },
        ],
      },
    ]

    const docs = generateApiDocumentation(signatures, {
      name: 'greeter-api',
      description: 'A simple greeting API',
      version: '1.0.0',
    })

    expect(docs.name).toBe('greeter-api')
    expect(docs.description).toBe('A simple greeting API')
    expect(docs.version).toBe('1.0.0')
    expect(docs.entries).toHaveLength(1)
    expect(docs.entries[0].name).toBe('greet')
    expect(docs.entries[0].description).toBe('Greets a user by name')
    expect(docs.entries[0].params).toHaveLength(1)
    expect(docs.entries[0].params[0].description).toBe('The user name')
  })

  it('extracts examples from JSDoc', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'add',
        params: [
          { name: 'a', type: 'number', optional: false },
          { name: 'b', type: 'number', optional: false },
        ],
        returnType: 'number',
        isAsync: false,
        jsdocTags: [{ tag: 'example', description: 'add(2, 3) // returns 5' }],
      },
    ]

    const docs = generateApiDocumentation(signatures, { name: 'math' })

    expect(docs.entries[0].examples).toBeDefined()
    expect(docs.entries[0].examples).toContain('add(2, 3) // returns 5')
  })

  it('extracts deprecated tag', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'oldMethod',
        params: [],
        returnType: 'void',
        isAsync: false,
        jsdocTags: [{ tag: 'deprecated', description: 'Use newMethod instead' }],
      },
    ]

    const docs = generateApiDocumentation(signatures, { name: 'api' })

    expect(docs.entries[0].deprecated).toBe('Use newMethod instead')
  })

  it('extracts since tag', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'newFeature',
        params: [],
        returnType: 'void',
        isAsync: false,
        jsdocTags: [{ tag: 'since', description: '2.0.0' }],
      },
    ]

    const docs = generateApiDocumentation(signatures, { name: 'api' })

    expect(docs.entries[0].since).toBe('2.0.0')
  })
})

describe('Markdown Documentation Generation', () => {
  it('generates markdown from API documentation', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'greet',
        params: [{ name: 'name', type: 'string', optional: false }],
        returnType: 'string',
        isAsync: false,
        description: 'Greets a user',
        jsdocTags: [
          { tag: 'param', name: 'name', description: 'The user name' },
          { tag: 'returns', description: 'A greeting' },
        ],
      },
    ]

    const docs = generateApiDocumentation(signatures, {
      name: 'Greeter API',
      description: 'A friendly greeter',
      version: '1.0.0',
    })

    const markdown = generateMarkdownDocs(docs)

    expect(markdown).toContain('# Greeter API')
    expect(markdown).toContain('A friendly greeter')
    expect(markdown).toContain('**Version:** 1.0.0')
    expect(markdown).toContain('## API Reference')
    expect(markdown).toContain('### greet')
    expect(markdown).toContain('```typescript')
    expect(markdown).toContain('function greet(name: string): string')
    expect(markdown).toContain('#### Parameters')
    expect(markdown).toContain('| Name | Type | Required | Description |')
    expect(markdown).toContain('`name`')
    expect(markdown).toContain('`string`')
    expect(markdown).toContain('#### Returns')
  })

  it('generates table of contents', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'add',
        params: [],
        returnType: 'number',
        isAsync: false,
      },
      {
        name: 'subtract',
        params: [],
        returnType: 'number',
        isAsync: false,
      },
    ]

    const docs = generateApiDocumentation(signatures, { name: 'Math' })
    const markdown = generateMarkdownDocs(docs)

    expect(markdown).toContain('### Contents')
    expect(markdown).toContain('[`add`](#add)')
    expect(markdown).toContain('[`subtract`](#subtract)')
  })

  it('includes deprecated warning', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'oldMethod',
        params: [],
        returnType: 'void',
        isAsync: false,
        jsdocTags: [{ tag: 'deprecated', description: 'Use newMethod instead' }],
      },
    ]

    const docs = generateApiDocumentation(signatures, { name: 'API' })
    const markdown = generateMarkdownDocs(docs)

    expect(markdown).toContain('> **Deprecated:** Use newMethod instead')
  })
})

// ============================================================================
// New Tests: Type Extraction
// ============================================================================

import {
  extractTypes,
  generateComprehensiveTypes,
  generateRpcStub,
  generateEnhancedRpcTarget,
  type ExtractedType,
} from '../sdk-compiler'

describe('Type Extraction', () => {
  it('extracts interface definitions', () => {
    const code = `
      export interface User {
        name: string;
        age: number;
      }
    `
    const types = extractTypes(code)

    expect(types).toHaveLength(1)
    expect(types[0].name).toBe('User')
    expect(types[0].kind).toBe('interface')
    expect(types[0].exported).toBe(true)
    expect(types[0].properties).toHaveLength(2)
    expect(types[0].properties?.[0].name).toBe('name')
    expect(types[0].properties?.[0].type).toBe('string')
  })

  it('extracts type aliases', () => {
    const code = `
      export type Status = 'pending' | 'active' | 'completed';
    `
    const types = extractTypes(code)

    expect(types).toHaveLength(1)
    expect(types[0].name).toBe('Status')
    expect(types[0].kind).toBe('type')
    expect(types[0].definition).toBe("'pending' | 'active' | 'completed'")
  })

  it('extracts generic interfaces', () => {
    const code = `
      export interface Result<T, E> {
        data?: T;
        error?: E;
      }
    `
    const types = extractTypes(code)

    expect(types).toHaveLength(1)
    expect(types[0].name).toBe('Result')
    expect(types[0].typeParameters).toEqual(['T', 'E'])
  })

  it('extracts optional properties', () => {
    const code = `
      interface Config {
        required: string;
        optional?: number;
      }
    `
    const types = extractTypes(code)

    expect(types).toHaveLength(1)
    expect(types[0].properties).toHaveLength(2)
    expect(types[0].properties?.[0].optional).toBe(false)
    expect(types[0].properties?.[1].optional).toBe(true)
  })

  it('extracts multiple types', () => {
    const code = `
      export interface User {
        name: string;
      }

      export type UserId = string;

      interface Internal {
        secret: string;
      }
    `
    const types = extractTypes(code)

    expect(types).toHaveLength(3)
    expect(types.map((t) => t.name)).toEqual(['User', 'Internal', 'UserId'])
  })
})

describe('Comprehensive Type Generation', () => {
  it('generates types with both interfaces and functions', () => {
    const code = `
      export interface GreetResponse {
        message: string;
        timestamp: string;
      }

      /**
       * Greet a user
       * @param name - The user name
       * @returns A greeting response
       */
      export function greet(name: string): GreetResponse {
        return { message: \`Hello, \${name}!\`, timestamp: new Date().toISOString() };
      }
    `

    const dts = generateComprehensiveTypes(code, 'greeter')

    expect(dts).toContain("declare module 'greeter'")
    expect(dts).toContain('export interface GreetResponse')
    expect(dts).toContain('message: string')
    expect(dts).toContain('export function greet(name: string): GreetResponse')
    expect(dts).toContain('Greet a user')
  })
})

describe('RPC Stub Generation', () => {
  it('generates stub client with retry support', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'greet',
        params: [{ name: 'name', type: 'string', optional: false }],
        returnType: 'Promise<GreetResponse>',
        isAsync: true,
        description: 'Greet a user',
      },
    ]

    const result = generateRpcStub(signatures, {
      className: 'Greeter',
      includeRetry: true,
    })

    expect(result.clientCode).toContain('class GreeterStub')
    expect(result.clientCode).toContain('_callWithRetry')
    expect(result.clientCode).toContain('RetryConfig')
    expect(result.clientCode).toContain('async greet(name: string)')
    expect(result.clientCode).toContain('GreeterError')
  })

  it('generates stub with parameter validation', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'add',
        params: [
          { name: 'a', type: 'number', optional: false },
          { name: 'b', type: 'number', optional: false },
        ],
        returnType: 'Promise<number>',
        isAsync: true,
      },
    ]

    const result = generateRpcStub(signatures, {
      className: 'Math',
      includeValidation: true,
    })

    expect(result.clientCode).toContain('if (a === undefined || a === null)')
    expect(result.clientCode).toContain('if (b === undefined || b === null)')
    expect(result.clientCode).toContain("'INVALID_PARAMS'")
  })

  it('generates static factory methods', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'test',
        params: [],
        returnType: 'Promise<void>',
        isAsync: true,
      },
    ]

    const result = generateRpcStub(signatures, { className: 'Test' })

    expect(result.clientCode).toContain('static fromUrl(url: string)')
    expect(result.clientCode).toContain('static fromBinding(binding: Fetcher)')
  })

  it('generates type definitions', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'process',
        params: [{ name: 'data', type: 'Input', optional: false }],
        returnType: 'Promise<Output>',
        isAsync: true,
      },
    ]

    const result = generateRpcStub(signatures, { className: 'Processor' })

    expect(result.dts).toContain('export interface ProcessorMethods')
    expect(result.dts).toContain('export declare class ProcessorStub')
    expect(result.dts).toContain('process(data: Input): Promise<Output>')
  })

  it('generates error class with helper methods', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'test',
        params: [],
        returnType: 'void',
        isAsync: false,
      },
    ]

    const result = generateRpcStub(signatures, { className: 'Service' })

    expect(result.clientCode).toContain('class ServiceError extends Error')
    expect(result.clientCode).toContain('get isMethodNotFound()')
    expect(result.clientCode).toContain('get isInvalidParams()')
    expect(result.clientCode).toContain('get isInternalError()')
    expect(result.clientCode).toContain('get isTimeout()')
  })
})

describe('Enhanced RpcTarget Generation', () => {
  it('generates RpcTarget with tracing', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'process',
        params: [{ name: 'data', type: 'Input', optional: false }],
        returnType: 'Promise<Output>',
        isAsync: true,
      },
    ]

    const result = generateEnhancedRpcTarget(signatures, 'ProcessorTarget', {
      includeTracing: true,
    })

    expect(result.code).toContain('setTraceId(traceId: string)')
    expect(result.code).toContain('getTraceSpans()')
    expect(result.code).toContain('interface TraceSpan')
    expect(result.code).toContain('_traceId')
    expect(result.code).toContain('_spans')
  })

  it('generates RpcTarget with metrics', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'action',
        params: [],
        returnType: 'void',
        isAsync: false,
      },
    ]

    const result = generateEnhancedRpcTarget(signatures, 'ActionTarget', {
      includeMetrics: true,
    })

    expect(result.code).toContain('_requestCount')
    expect(result.code).toContain('_errorCount')
    expect(result.code).toContain('_latencyMs')
    expect(result.code).toContain('getMetrics()')
  })

  it('generates RpcTarget with validation', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'update',
        params: [
          { name: 'id', type: 'string', optional: false },
          { name: 'data', type: 'UpdateData', optional: true },
        ],
        returnType: 'Promise<void>',
        isAsync: true,
      },
    ]

    const result = generateEnhancedRpcTarget(signatures, 'UpdateTarget', {
      includeValidation: true,
    })

    // Should validate required params
    expect(result.code).toContain('if (id === undefined || id === null)')
    // Should not validate optional params
    expect(result.code).not.toContain('if (data === undefined || data === null)')
  })

  it('generates RpcTarget with Symbol.dispose', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'test',
        params: [],
        returnType: 'void',
        isAsync: false,
      },
    ]

    const result = generateEnhancedRpcTarget(signatures, 'TestTarget')

    expect(result.code).toContain('[Symbol.dispose]()')
    expect(result.dts).toContain('[Symbol.dispose](): void')
  })

  it('generates type definitions for RpcTarget', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'greet',
        params: [{ name: 'name', type: 'string', optional: false }],
        returnType: 'Promise<string>',
        isAsync: true,
      },
    ]

    const result = generateEnhancedRpcTarget(signatures, 'GreeterTarget')

    expect(result.dts).toContain('export interface GreeterTargetFunctions')
    expect(result.dts).toContain('export interface GreeterTargetMethods')
    expect(result.dts).toContain('export declare class GreeterTarget extends RpcTarget')
    expect(result.dts).toContain('greet(name: string): Promise<string>')
  })

  it('can disable all features', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'simple',
        params: [],
        returnType: 'void',
        isAsync: false,
      },
    ]

    const result = generateEnhancedRpcTarget(signatures, 'SimpleTarget', {
      includeTracing: false,
      includeMetrics: false,
      includeValidation: false,
    })

    expect(result.code).not.toContain('_traceId')
    expect(result.code).not.toContain('_requestCount')
    expect(result.code).not.toContain('getMetrics()')
  })

  it('generates functions interface correctly', () => {
    const signatures: FunctionSignature[] = [
      {
        name: 'create',
        params: [{ name: 'data', type: 'CreateInput', optional: false }],
        returnType: 'Promise<Entity>',
        isAsync: true,
        description: 'Create a new entity',
      },
      {
        name: 'delete',
        params: [{ name: 'id', type: 'string', optional: false }],
        returnType: 'Promise<void>',
        isAsync: true,
      },
    ]

    const result = generateEnhancedRpcTarget(signatures, 'CrudTarget')

    expect(result.code).toContain('interface CrudTargetFunctions')
    expect(result.code).toContain('create(data: CreateInput): Promise<Entity>')
    expect(result.code).toContain('delete(id: string): Promise<void>')
    expect(result.code).toContain('/** Create a new entity */')
  })
})
