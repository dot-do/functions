/**
 * Tagged Template Literals for Functions.do
 *
 * Write functions inline in any supported language:
 *
 * @example
 * ```typescript
 * import { rust, go, python, typescript } from 'functions.do'
 *
 * const greet = rust`
 *   pub fn hello(name: &str) -> String {
 *     format!("Hello, {}!", name)
 *   }
 * `
 *
 * const calculate = go`
 *   func Add(a, b int32) int32 {
 *     return a + b
 *   }
 * `
 *
 * const process = python`
 *   def handler(data: dict) -> dict:
 *     return {"result": data.get("value", 0) * 2}
 * `
 * ```
 */

/**
 * Helper to safely access process.env in environments where process may exist.
 * Works in Node.js, Bun, and test environments without type assertions.
 */
function getProcessEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key]
  }
  return undefined
}

/**
 * Supported programming languages for inline functions
 */
export type SupportedLanguage =
  | 'typescript'
  | 'javascript'
  | 'rust'
  | 'go'
  | 'python'
  | 'csharp'
  | 'zig'
  | 'assemblyscript'

/**
 * Inline function definition created by a template literal
 */
export interface InlineFunction {
  /** The source code */
  code: string
  /** The programming language */
  language: SupportedLanguage
  /** Compile the function to deployable format */
  compile(): Promise<CompiledFunction>
  /** Deploy the function */
  deploy(options?: DeployOptions): Promise<DeployedFunction>
}

/**
 * Compiled function ready for deployment
 */
export interface CompiledFunction {
  /** Compiled code (ESM or WASM) */
  output: string | Uint8Array
  /** Source map if available */
  sourceMap?: string
  /** Compilation metadata */
  metadata: {
    language: SupportedLanguage
    originalSize: number
    compiledSize: number
    compilationTimeMs: number
  }
}

/**
 * Deployed function
 */
export interface DeployedFunction {
  /** Function ID */
  id: string
  /** Function version */
  version: string
  /** Invocation URL */
  url: string
  /** Invoke the function */
  invoke<T = unknown>(data?: unknown): Promise<T>
}

/**
 * Options for deploying an inline function
 */
export interface DeployOptions {
  /** Function ID (auto-generated if not provided) */
  id?: string
  /** Function version */
  version?: string
  /** Entry point */
  entryPoint?: string
  /** Dependencies */
  dependencies?: Record<string, string>
  /** API key for deployment */
  apiKey?: string
  /** Base URL for the Functions.do API */
  baseUrl?: string
}

/**
 * Create a tagged template literal function for a specific language
 */
function createLanguageTag(language: SupportedLanguage) {
  return function(strings: TemplateStringsArray, ...values: unknown[]): InlineFunction {
    // Interpolate the template literal
    const code = strings.reduce((result, str, i) => {
      return result + str + (values[i] !== undefined ? String(values[i]) : '')
    }, '')

    return {
      code: code.trim(),
      language,

      async compile(): Promise<CompiledFunction> {
        const startTime = Date.now()
        const originalSize = code.length

        // Dynamic import to avoid circular dependencies and enable tree shaking
        let output: string | Uint8Array
        let sourceMap: string | undefined

        switch (language) {
          case 'typescript':
          case 'javascript': {
            const { compileTypeScript } = await import('./languages/typescript/compile')
            const result = await compileTypeScript(code)
            output = result.code
            if (result.map) {
              sourceMap = typeof result.map === 'string' ? result.map : JSON.stringify(result.map)
            }
            break
          }
          case 'rust': {
            const { compileRust } = await import('./languages/rust/compile')
            const result = await compileRust(code)
            output = result.wasm
            break
          }
          case 'go': {
            const { compileGo } = await import('./languages/go/compile')
            const result = await compileGo(code)
            output = result.wasm
            break
          }
          case 'python': {
            // Python doesn't compile ahead of time, return the source
            output = code
            break
          }
          case 'csharp': {
            // C# uses a distributed runtime model, return the source for the runtime
            output = code
            break
          }
          case 'zig': {
            const { compileZig } = await import('./languages/zig/compile')
            const result = await compileZig(code)
            output = result.wasm
            break
          }
          case 'assemblyscript': {
            const { compileAssemblyScript } = await import('./languages/assemblyscript/compile')
            const result = await compileAssemblyScript(code)
            output = result.wasm
            break
          }
          default:
            throw new Error(`Unsupported language: ${language}`)
        }

        const compiledSize = typeof output === 'string' ? output.length : output.byteLength

        return {
          output,
          sourceMap,
          metadata: {
            language,
            originalSize,
            compiledSize,
            compilationTimeMs: Date.now() - startTime,
          },
        }
      },

      async deploy(options: DeployOptions = {}): Promise<DeployedFunction> {
        const compiled = await this.compile()
        const id = options.id || `fn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const version = options.version || '1.0.0'
        const baseUrl = options.baseUrl || 'https://functions.do'
        const apiKey = options.apiKey || getProcessEnv('FUNCTIONS_API_KEY')

        if (!apiKey) {
          throw new Error('API key required for deployment. Set FUNCTIONS_API_KEY or pass apiKey option.')
        }

        const response = await fetch(`${baseUrl}/api/functions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey,
          },
          body: JSON.stringify({
            id,
            version,
            language,
            code: typeof compiled.output === 'string'
              ? compiled.output
              : btoa(String.fromCharCode(...new Uint8Array(compiled.output as ArrayBuffer))),
            entryPoint: options.entryPoint || 'index.ts',
            dependencies: options.dependencies || {},
          }),
        })

        if (!response.ok) {
          const error = await response.text()
          throw new Error(`Deployment failed: ${error}`)
        }

        const result = await response.json() as { id: string; version: string; url: string }
        const functionUrl = result.url || `${baseUrl}/functions/${id}`

        return {
          id: result.id,
          version: result.version,
          url: functionUrl,

          async invoke<T = unknown>(data?: unknown): Promise<T> {
            const invokeResponse = await fetch(functionUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey!,
              },
              body: data ? JSON.stringify(data) : undefined,
            })

            if (!invokeResponse.ok) {
              const error = await invokeResponse.text()
              throw new Error(`Invocation failed: ${error}`)
            }

            return invokeResponse.json() as Promise<T>
          },
        }
      },
    }
  }
}

/**
 * TypeScript tagged template literal
 *
 * @example
 * ```typescript
 * const fn = typescript`
 *   export default async (request: Request) => {
 *     return new Response('Hello, World!')
 *   }
 * `
 * ```
 */
export const typescript = createLanguageTag('typescript')

/**
 * JavaScript tagged template literal
 *
 * @example
 * ```typescript
 * const fn = javascript`
 *   export default async (request) => {
 *     return new Response('Hello, World!')
 *   }
 * `
 * ```
 */
export const javascript = createLanguageTag('javascript')

/**
 * Rust tagged template literal
 *
 * @example
 * ```typescript
 * const fn = rust`
 *   use wasm_bindgen::prelude::*;
 *
 *   #[wasm_bindgen]
 *   pub fn greet(name: &str) -> String {
 *     format!("Hello, {}!", name)
 *   }
 * `
 * ```
 */
export const rust = createLanguageTag('rust')

/**
 * Go tagged template literal
 *
 * @example
 * ```typescript
 * const fn = go`
 *   package main
 *
 *   //go:wasmexport hello
 *   func hello(name string) string {
 *     return "Hello, " + name + "!"
 *   }
 * `
 * ```
 */
export const go = createLanguageTag('go')

/**
 * Python tagged template literal
 *
 * @example
 * ```typescript
 * const fn = python`
 *   def handler(request):
 *     return {"message": "Hello, World!"}
 * `
 * ```
 */
export const python = createLanguageTag('python')

/**
 * C# tagged template literal
 *
 * @example
 * ```typescript
 * const fn = csharp`
 *   public class Handler {
 *     public static string Hello(string name) => $"Hello, {name}!";
 *   }
 * `
 * ```
 */
export const csharp = createLanguageTag('csharp')

/**
 * Zig tagged template literal
 *
 * @example
 * ```typescript
 * const fn = zig`
 *   export fn add(a: i32, b: i32) i32 {
 *     return a + b;
 *   }
 * `
 * ```
 */
export const zig = createLanguageTag('zig')

/**
 * AssemblyScript tagged template literal
 *
 * @example
 * ```typescript
 * const fn = assemblyscript`
 *   export function add(a: i32, b: i32): i32 {
 *     return a + b;
 *   }
 * `
 * ```
 */
export const assemblyscript = createLanguageTag('assemblyscript')
