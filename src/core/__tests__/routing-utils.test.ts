/**
 * Routing Utilities Tests
 *
 * Comprehensive tests for the routing utility functions including:
 * - stripTypeScript() - TypeScript to JavaScript transformation
 * - parseFunctionId() - Function ID extraction from requests
 * - parseAction() - Action parsing from URL paths
 * - jsonResponse() - JSON response helper
 * - errorResponse() - Error response helper
 */

import { describe, it, expect } from 'vitest'
import {
  stripTypeScript,
  parseFunctionId,
  parseAction,
  jsonResponse,
  errorResponse,
} from '../routing-utils'

// ============================================================================
// stripTypeScript() Tests
// ============================================================================

describe('stripTypeScript()', () => {
  describe('Type Annotations', () => {
    it('should strip parameter type annotations', () => {
      const input = 'function greet(name: string) { return name; }'
      const result = stripTypeScript(input)
      expect(result).not.toContain(': string')
      expect(result).toContain('function greet(name)')
    })

    it('should strip multiple parameter type annotations', () => {
      const input = 'function add(a: number, b: number) { return a + b; }'
      const result = stripTypeScript(input)
      expect(result).not.toContain(': number')
      expect(result).toContain('function add(a, b)')
    })

    it('should strip return type annotations', () => {
      const input = 'function getName(): string { return "test"; }'
      const result = stripTypeScript(input)
      expect(result).not.toContain('): string')
      expect(result).toContain('function getName()')
    })

    it('should strip Promise return type annotations', () => {
      const input = 'async function fetch(): Promise<Response> { return new Response(); }'
      const result = stripTypeScript(input)
      expect(result).not.toContain('Promise<Response>')
    })

    it('should strip optional parameter annotations', () => {
      const input = 'function greet(name?: string) { return name; }'
      const result = stripTypeScript(input)
      expect(result).not.toContain('?: string')
      expect(result).toContain('function greet(name)')
    })

    it('should strip primitive type annotations in function parameters', () => {
      // Note: stripTypeScript only handles function parameters, not variable declarations
      // Variable type annotations are preserved (a limitation of the regex approach)
      const input = `function process(count: number, active: boolean, data: any) { return count; }`
      const result = stripTypeScript(input)
      expect(result).toContain('function process(count, active, data)')
      expect(result).not.toMatch(/count:\s*number/)
      expect(result).not.toMatch(/active:\s*boolean/)
      expect(result).not.toMatch(/data:\s*any/)
    })
  })

  describe('Interface Declarations', () => {
    it('should strip single-line interface declarations', () => {
      const input = `
        interface User { id: string; name: string; }
        const user = { id: '1', name: 'Test' };
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('interface User')
      expect(result).toContain('const user')
    })

    it('should strip multi-line interface declarations', () => {
      const input = `
interface Config {
  timeout: number;
  retries: number;
  enabled: boolean;
}
const config = { timeout: 1000 };
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('interface Config')
      expect(result).toContain('const config')
    })

    it('should strip exported interface declarations', () => {
      const input = `
export interface ApiResponse {
  data: unknown;
  status: number;
}
const response = { data: null };
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('export interface')
      expect(result).not.toContain('ApiResponse')
    })

    it('should strip interface with generic parameters', () => {
      const input = `
interface Container<T> {
  value: T;
  getValue(): T;
}
const container = { value: 42 };
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('interface Container')
    })
  })

  describe('Type Alias Declarations', () => {
    it('should strip simple type aliases', () => {
      const input = `
type ID = string;
const id = '123';
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('type ID')
      expect(result).toContain("const id = '123'")
    })

    it('should strip union type aliases', () => {
      const input = `
type Status = 'pending' | 'complete' | 'error';
const status = 'pending';
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('type Status')
    })

    it('should strip intersection type aliases', () => {
      const input = `
type Combined = TypeA & TypeB;
const obj = {};
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('type Combined')
    })

    it('should strip exported type aliases', () => {
      const input = `
export type Callback = (value: string) => void;
const cb = (v) => console.log(v);
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('export type Callback')
    })

    it('should strip generic type aliases', () => {
      const input = `
type Wrapper<T> = { value: T };
const wrapped = { value: 42 };
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('type Wrapper')
    })
  })

  describe('Import/Export Type Statements', () => {
    it('should strip import type statements', () => {
      const input = `
import type { User } from './types';
import { getData } from './api';
const data = getData();
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain("import type { User }")
      expect(result).toContain("import { getData }")
    })

    it('should strip type-only imports from mixed imports', () => {
      const input = `import { type User, getData, type Config } from './types';`
      const result = stripTypeScript(input)
      expect(result).not.toContain('type User')
      expect(result).not.toContain('type Config')
      expect(result).toContain('getData')
    })

    it('should strip export type statements', () => {
      const input = `
export type { UserType } from './types';
export { createUser } from './api';
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('export type { UserType }')
      expect(result).toContain("export { createUser }")
    })

    it('should clean up empty imports', () => {
      const input = `
import { type OnlyType } from './types';
const data = {};
      `
      const result = stripTypeScript(input)
      // After stripping type imports, should clean up empty import
      expect(result).not.toContain('import { }')
    })
  })

  describe('Generic Type Parameters', () => {
    it('should strip generic function type parameters', () => {
      const input = `
function identity<T>(value: T): T {
  return value;
}
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('<T>')
      expect(result).toContain('function identity(value)')
    })

    it('should strip generic function with constraints', () => {
      const input = `
function process<T extends object>(obj: T): T {
  return obj;
}
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('<T extends object>')
      expect(result).toContain('function process(obj)')
    })

    it('should strip multiple generic parameters', () => {
      const input = `
function map<T, U>(arr: T[], fn: (item: T) => U): U[] {
  return arr.map(fn);
}
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('<T, U>')
    })

    it('should strip generic class type parameters', () => {
      const input = `
class Container<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
}
      `
      const result = stripTypeScript(input)
      expect(result).toMatch(/class Container\s*\{/)
      expect(result).not.toContain('class Container<T>')
    })
  })

  describe('Type Assertions', () => {
    it('should strip as Type assertions', () => {
      const input = `const data = response as ApiData;`
      const result = stripTypeScript(input)
      expect(result).not.toContain('as ApiData')
      expect(result).toContain('const data = response')
    })

    it('should strip as Type with object types', () => {
      const input = `const obj = data as { key: string };`
      const result = stripTypeScript(input)
      expect(result).not.toContain('as { key: string }')
    })

    it('should preserve as const assertions', () => {
      const input = `const config = { mode: 'production' } as const;`
      const result = stripTypeScript(input)
      expect(result).toContain('as const')
    })

    it('should strip as primitive type assertions', () => {
      const input = `const value = input as string;`
      const result = stripTypeScript(input)
      expect(result).not.toContain('as string')
    })

    it('should strip as unknown assertions', () => {
      const input = `const value = data as unknown;`
      const result = stripTypeScript(input)
      expect(result).not.toContain('as unknown')
    })

    it('should strip angle bracket type assertions', () => {
      const input = `const data = <ApiData>response;`
      const result = stripTypeScript(input)
      expect(result).not.toContain('<ApiData>')
    })
  })

  describe('Access Modifiers', () => {
    it('should strip public modifier', () => {
      const input = `
class Example {
  public name = 'test';
  public getName() { return this.name; }
}
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('public name')
      expect(result).not.toContain('public getName')
      expect(result).toContain('name =')
      expect(result).toContain('getName()')
    })

    it('should strip private modifier', () => {
      const input = `
class Example {
  private secret = 'hidden';
}
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('private secret')
      expect(result).toContain('secret =')
    })

    it('should strip protected modifier', () => {
      const input = `
class Example {
  protected data = 'shared';
}
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('protected data')
      expect(result).toContain('data =')
    })

    it('should strip readonly modifier', () => {
      const input = `
class Config {
  readonly version = '1.0.0';
}
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('readonly version')
      expect(result).toContain('version =')
    })
  })

  describe('Non-null Assertions', () => {
    it('should strip non-null assertions after parentheses', () => {
      const input = `const value = getData()!;`
      const result = stripTypeScript(input)
      expect(result).toContain('getData()')
      expect(result).not.toContain('getData()!')
    })

    it('should strip non-null assertions after brackets', () => {
      const input = `const first = arr[0]!;`
      const result = stripTypeScript(input)
      expect(result).toContain('arr[0]')
      expect(result).not.toContain('arr[0]!')
    })

    it('should strip non-null assertions before property access', () => {
      const input = `const name = user!.name;`
      const result = stripTypeScript(input)
      expect(result).toContain('user.name')
      expect(result).not.toContain('user!.name')
    })

    it('should preserve exclamation marks in strings', () => {
      const input = `const greeting = 'Hello, World!';`
      const result = stripTypeScript(input)
      expect(result).toContain("'Hello, World!'")
    })
  })

  describe('Satisfies Expressions', () => {
    it('should strip satisfies expressions', () => {
      const input = `const config = { timeout: 1000 } satisfies Config;`
      const result = stripTypeScript(input)
      expect(result).not.toContain('satisfies Config')
      expect(result).toContain('const config = { timeout: 1000 }')
    })
  })

  describe('Declare Statements', () => {
    it('should strip declare const statements', () => {
      const input = `
declare const GLOBAL: string;
const local = 'value';
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('declare const')
      expect(result).toContain("const local = 'value'")
    })

    it('should strip declare function statements', () => {
      const input = `
declare function externalFunc(): void;
function localFunc() {}
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('declare function')
      expect(result).toContain('function localFunc()')
    })
  })

  describe('Complex TypeScript Code', () => {
    it('should handle worker fetch handler with types', () => {
      const input = `
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url: URL = new URL(request.url);
    const path: string = url.pathname;
    return new Response(JSON.stringify({ path }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
      `
      const result = stripTypeScript(input)
      expect(result).not.toMatch(/:\s*Request/)
      expect(result).not.toMatch(/:\s*Env/)
      expect(result).not.toMatch(/:\s*ExecutionContext/)
      expect(result).not.toContain('Promise<Response>')
      expect(result).toContain('export default')
      expect(result).toContain('async fetch(request, env, ctx)')
    })

    it('should handle mixed TypeScript patterns', () => {
      const input = `
import type { Config } from './types';

interface User {
  id: string;
  name: string;
}

type Status = 'active' | 'inactive';

export default class UserService<T extends User> {
  private users: Map<string, T> = new Map();

  public async getUser(id: string): Promise<T | undefined> {
    return this.users.get(id);
  }

  public setUser(user: T): void {
    this.users.set(user.id, user);
  }
}
      `
      const result = stripTypeScript(input)
      expect(result).not.toContain('import type')
      expect(result).not.toContain('interface User')
      expect(result).not.toContain('type Status')
      expect(result).not.toContain('<T extends User>')
      expect(result).not.toContain('private users')
      expect(result).not.toContain('public async')
      expect(result).toContain('class UserService')
      expect(result).toContain('async getUser(id)')
      expect(result).toContain('setUser(user)')
    })

    it('should preserve plain JavaScript code', () => {
      const input = `
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const data = { message: 'Hello, World!' };
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
      `
      const result = stripTypeScript(input)
      expect(result).toContain('async fetch(request)')
      expect(result).toContain("message: 'Hello, World!'")
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty input', () => {
      const result = stripTypeScript('')
      expect(result).toBe('')
    })

    it('should handle whitespace-only input', () => {
      const result = stripTypeScript('   \n\n   ')
      expect(result).toBe('')
    })

    it('should handle code with no TypeScript features', () => {
      const input = 'const x = 42;'
      const result = stripTypeScript(input)
      expect(result).toBe('const x = 42;')
    })

    it('should clean up multiple consecutive newlines', () => {
      const input = `
interface Removed {
  key: string;
}



const kept = 'value';
      `
      const result = stripTypeScript(input)
      expect(result).not.toMatch(/\n{3,}/)
    })

    it('should clean up multiple spaces', () => {
      const input = 'const   name   =   "test";'
      const result = stripTypeScript(input)
      expect(result).not.toMatch(/  +/)
    })
  })
})

// ============================================================================
// parseFunctionId() Tests
// ============================================================================

describe('parseFunctionId()', () => {
  describe('URL Path Parsing', () => {
    it('should parse function ID from /functions/:functionId', () => {
      const request = new Request('https://example.com/functions/my-func')
      const result = parseFunctionId(request)
      expect(result).toBe('my-func')
    })

    it('should parse function ID from /functions/:functionId/invoke', () => {
      const request = new Request('https://example.com/functions/my-func/invoke')
      const result = parseFunctionId(request)
      expect(result).toBe('my-func')
    })

    it('should parse function ID from /functions/:functionId/info', () => {
      const request = new Request('https://example.com/functions/my-func/info')
      const result = parseFunctionId(request)
      expect(result).toBe('my-func')
    })

    it('should handle function IDs with hyphens', () => {
      const request = new Request('https://example.com/functions/my-hyphenated-func')
      const result = parseFunctionId(request)
      expect(result).toBe('my-hyphenated-func')
    })

    it('should handle function IDs with underscores', () => {
      const request = new Request('https://example.com/functions/my_underscore_func')
      const result = parseFunctionId(request)
      expect(result).toBe('my_underscore_func')
    })

    it('should handle function IDs with numbers', () => {
      const request = new Request('https://example.com/functions/func123')
      const result = parseFunctionId(request)
      expect(result).toBe('func123')
    })

    it('should handle function IDs starting with number (parsing only)', () => {
      // parseFunctionId only extracts the ID, validation is done elsewhere
      const request = new Request('https://example.com/functions/123func')
      const result = parseFunctionId(request)
      expect(result).toBe('123func')
    })

    it('should return null for root path', () => {
      const request = new Request('https://example.com/')
      const result = parseFunctionId(request)
      expect(result).toBeNull()
    })

    it('should return null for /health path', () => {
      const request = new Request('https://example.com/health')
      const result = parseFunctionId(request)
      expect(result).toBeNull()
    })

    it('should return null for /functions without ID', () => {
      const request = new Request('https://example.com/functions')
      const result = parseFunctionId(request)
      expect(result).toBeNull()
    })

    it('should return null for /functions/ with trailing slash only', () => {
      const request = new Request('https://example.com/functions/')
      const result = parseFunctionId(request)
      expect(result).toBeNull()
    })
  })

  describe('X-Function-Id Header Parsing', () => {
    it('should parse function ID from X-Function-Id header', () => {
      const request = new Request('https://example.com/invoke', {
        headers: { 'X-Function-Id': 'header-func' },
      })
      const result = parseFunctionId(request)
      expect(result).toBe('header-func')
    })

    it('should return null when X-Function-Id header is missing', () => {
      const request = new Request('https://example.com/invoke')
      const result = parseFunctionId(request)
      expect(result).toBeNull()
    })

    it('should prefer URL path over header', () => {
      const request = new Request('https://example.com/functions/url-func', {
        headers: { 'X-Function-Id': 'header-func' },
      })
      const result = parseFunctionId(request)
      expect(result).toBe('url-func')
    })

    it('should use header when URL path has no function ID', () => {
      const request = new Request('https://example.com/api/invoke', {
        headers: { 'X-Function-Id': 'header-func' },
      })
      const result = parseFunctionId(request)
      expect(result).toBe('header-func')
    })
  })

  describe('Query Parameters', () => {
    it('should ignore query parameters when parsing function ID', () => {
      const request = new Request('https://example.com/functions/my-func?version=1.0.0')
      const result = parseFunctionId(request)
      expect(result).toBe('my-func')
    })
  })
})

// ============================================================================
// parseAction() Tests
// ============================================================================

describe('parseAction()', () => {
  describe('Invoke Action', () => {
    it('should return "invoke" for /functions/:id/invoke', () => {
      const request = new Request('https://example.com/functions/my-func/invoke')
      const result = parseAction(request)
      expect(result).toBe('invoke')
    })

    it('should return "invoke" for uppercase INVOKE', () => {
      const request = new Request('https://example.com/functions/my-func/INVOKE')
      const result = parseAction(request)
      expect(result).toBe('invoke')
    })

    it('should return "invoke" for mixed case Invoke', () => {
      const request = new Request('https://example.com/functions/my-func/Invoke')
      const result = parseAction(request)
      expect(result).toBe('invoke')
    })
  })

  describe('Info Action', () => {
    it('should return "info" for /functions/:id/info', () => {
      const request = new Request('https://example.com/functions/my-func/info')
      const result = parseAction(request)
      expect(result).toBe('info')
    })

    it('should return "info" for uppercase INFO', () => {
      const request = new Request('https://example.com/functions/my-func/INFO')
      const result = parseAction(request)
      expect(result).toBe('info')
    })

    it('should return "info" for mixed case Info', () => {
      const request = new Request('https://example.com/functions/my-func/Info')
      const result = parseAction(request)
      expect(result).toBe('info')
    })
  })

  describe('No Action (Default)', () => {
    it('should return null for /functions/:id', () => {
      const request = new Request('https://example.com/functions/my-func')
      const result = parseAction(request)
      expect(result).toBeNull()
    })

    it('should return null for root path', () => {
      const request = new Request('https://example.com/')
      const result = parseAction(request)
      expect(result).toBeNull()
    })

    it('should return null for /health', () => {
      const request = new Request('https://example.com/health')
      const result = parseAction(request)
      expect(result).toBeNull()
    })
  })

  describe('Unknown Actions', () => {
    it('should return null for unknown action', () => {
      const request = new Request('https://example.com/functions/my-func/unknown')
      const result = parseAction(request)
      expect(result).toBeNull()
    })

    it('should return null for /functions/:id/logs', () => {
      const request = new Request('https://example.com/functions/my-func/logs')
      const result = parseAction(request)
      expect(result).toBeNull()
    })

    it('should return null for /functions/:id/versions', () => {
      const request = new Request('https://example.com/functions/my-func/versions')
      const result = parseAction(request)
      expect(result).toBeNull()
    })
  })

  describe('Edge Cases', () => {
    it('should ignore query parameters', () => {
      const request = new Request('https://example.com/functions/my-func/invoke?debug=true')
      const result = parseAction(request)
      expect(result).toBe('invoke')
    })

    it('should handle trailing slashes', () => {
      // Trailing slash results in empty string segment which is filtered out
      const request = new Request('https://example.com/functions/my-func/invoke/')
      const result = parseAction(request)
      expect(result).toBe('invoke')
    })
  })
})

// ============================================================================
// jsonResponse() Tests
// ============================================================================

describe('jsonResponse()', () => {
  it('should return a Response with JSON content-type', async () => {
    const response = jsonResponse({ key: 'value' })
    expect(response.headers.get('Content-Type')).toBe('application/json')
  })

  it('should serialize data to JSON', async () => {
    const data = { message: 'Hello', count: 42 }
    const response = jsonResponse(data)
    const body = await response.json()
    expect(body).toEqual(data)
  })

  it('should use status 200 by default', () => {
    const response = jsonResponse({})
    expect(response.status).toBe(200)
  })

  it('should use custom status when provided', () => {
    const response = jsonResponse({}, 201)
    expect(response.status).toBe(201)
  })

  it('should handle null data', async () => {
    const response = jsonResponse(null)
    const body = await response.json()
    expect(body).toBeNull()
  })

  it('should handle array data', async () => {
    const data = [1, 2, 3]
    const response = jsonResponse(data)
    const body = await response.json()
    expect(body).toEqual(data)
  })

  it('should handle nested objects', async () => {
    const data = { outer: { inner: { deep: 'value' } } }
    const response = jsonResponse(data)
    const body = await response.json()
    expect(body).toEqual(data)
  })
})

// ============================================================================
// errorResponse() Tests
// ============================================================================

describe('errorResponse()', () => {
  it('should return a Response with JSON content-type', async () => {
    const response = errorResponse('Error message')
    expect(response.headers.get('Content-Type')).toBe('application/json')
  })

  it('should include error message in response body', async () => {
    const response = errorResponse('Something went wrong')
    const body = await response.json() as { error: string }
    expect(body.error).toBe('Something went wrong')
  })

  it('should use status 500 by default', () => {
    const response = errorResponse('Internal error')
    expect(response.status).toBe(500)
  })

  it('should use custom status when provided', () => {
    const response = errorResponse('Not found', 404)
    expect(response.status).toBe(404)
  })

  it('should return 400 for bad request', () => {
    const response = errorResponse('Invalid input', 400)
    expect(response.status).toBe(400)
  })

  it('should return 401 for unauthorized', () => {
    const response = errorResponse('Unauthorized', 401)
    expect(response.status).toBe(401)
  })

  it('should return 403 for forbidden', () => {
    const response = errorResponse('Forbidden', 403)
    expect(response.status).toBe(403)
  })

  it('should return 429 for rate limit', () => {
    const response = errorResponse('Too many requests', 429)
    expect(response.status).toBe(429)
  })

  it('should return 503 for service unavailable', () => {
    const response = errorResponse('Service unavailable', 503)
    expect(response.status).toBe(503)
  })
})
