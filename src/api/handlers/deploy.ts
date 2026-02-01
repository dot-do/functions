/**
 * Deploy Handler for Functions.do
 *
 * Handles function deployment including validation, compilation, and storage.
 */

import type { RouteContext, Env, Handler } from '../router'
import { KVFunctionRegistry } from '../../core/kv-function-registry'
import { KVCodeStorage } from '../../core/code-storage'
import {
  validateFunctionId,
  validateLanguage,
  validateEntryPoint,
  validateDependencies,
} from '../../core/function-registry'
import { isValidVersion, type FunctionMetadata } from '../../core/types'
import { jsonResponse } from '../http-utils'

// WASM compilers are dynamically imported to avoid issues with Node.js modules in Workers
type CompileResult = { wasm: Uint8Array; exports?: string[] }
type CompileFunction = (code: string) => Promise<CompileResult>

let compileRust: CompileFunction | null = null
let compileGo: CompileFunction | null = null
let compileZig: CompileFunction | null = null
let compileAssemblyScript: CompileFunction | null = null

// Try to load compilers (may fail in Worker environment)
async function loadCompilers() {
  try {
    const rustModule = await import('../../languages/rust/compile')
    compileRust = rustModule.compileRust
  } catch {
    // Rust compiler not available
  }
  try {
    const goModule = await import('../../languages/go/compile')
    compileGo = goModule.compileGo
  } catch {
    // Go compiler not available
  }
  try {
    const zigModule = await import('../../languages/zig/compile')
    compileZig = zigModule.compileZig
  } catch {
    // Zig compiler not available
  }
  try {
    const asModule = await import('../../languages/assemblyscript/compile')
    compileAssemblyScript = asModule.compileAssemblyScript
  } catch {
    // AssemblyScript compiler not available
  }
}

/**
 * Context for deploy handler
 */
export interface DeployHandlerContext extends RouteContext {}

/**
 * Upload to dispatch namespace via Cloudflare API
 */
async function uploadToDispatchNamespace(
  code: string,
  scriptName: string,
  env: Pick<Env, 'CLOUDFLARE_ACCOUNT_ID' | 'CLOUDFLARE_API_TOKEN' | 'DISPATCH_NAMESPACE'>
): Promise<{ success: boolean; error?: string }> {
  const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, DISPATCH_NAMESPACE } = env

  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN || !DISPATCH_NAMESPACE) {
    return { success: false, error: 'Dispatch upload not configured' }
  }

  const wrappedCode = code.includes('export default')
    ? code
    : `export default { fetch(request) { return new Response('Function not properly formatted'); } }`

  const formData = new FormData()
  const metadata = {
    main_module: 'index.js',
    compatibility_date: '2025-01-01',
  }
  formData.append('metadata', JSON.stringify(metadata))
  formData.append('index.js', new Blob([wrappedCode], { type: 'application/javascript+module' }), 'index.js')

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/dispatch/namespaces/${DISPATCH_NAMESPACE}/scripts/${scriptName}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
        body: formData,
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ errors: [{ message: 'Unknown error' }] }))
      const errorMessage =
        (errorData as { errors?: Array<{ message: string }> }).errors?.[0]?.message || `HTTP ${response.status}`
      return { success: false, error: `Failed to upload: ${errorMessage}` }
    }

    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: `Upload failed: ${message}` }
  }
}

/**
 * Deploy handler - stores function code and metadata
 */
export const deployHandler: Handler = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  context?: RouteContext
): Promise<Response> => {
  // Parse request body
  let body: {
    id?: string
    version?: string
    language?: string
    code?: string
    entryPoint?: string
    dependencies?: Record<string, string>
  }

  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { id, version, language, code, entryPoint, dependencies } = body

  // Validate required fields
  if (!id) {
    return jsonResponse({ error: 'Missing required field: id' }, 400)
  }
  if (!version) {
    return jsonResponse({ error: 'Missing required field: version' }, 400)
  }
  if (!language) {
    return jsonResponse({ error: 'Missing required field: language' }, 400)
  }
  if (!code) {
    return jsonResponse({ error: 'Missing required field: code' }, 400)
  }
  if (code === '') {
    return jsonResponse({ error: 'code cannot be empty' }, 400)
  }

  // Validate function ID
  try {
    validateFunctionId(id)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid function ID'
    return jsonResponse({ error: message }, 400)
  }

  // Validate version
  if (!isValidVersion(version)) {
    return jsonResponse({ error: `Invalid semantic version: ${version}` }, 400)
  }

  // Validate language
  try {
    validateLanguage(language)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid language'
    return jsonResponse({ error: message }, 400)
  }

  // Validate entry point if provided
  const resolvedEntryPoint = entryPoint || (language === 'typescript' || language === 'javascript' ? 'index.ts' : 'main')
  try {
    validateEntryPoint(resolvedEntryPoint)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid entry point'
    return jsonResponse({ error: message }, 400)
  }

  // Validate dependencies if provided
  try {
    validateDependencies(dependencies)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid dependencies'
    return jsonResponse({ error: message }, 400)
  }

  // Load compilers if not already loaded
  await loadCompilers()

  // Compile code based on language
  let compiledCode: string | Uint8Array
  try {
    switch (language) {
      case 'typescript':
      case 'javascript':
        // Store source directly
        compiledCode = code
        break
      case 'rust': {
        if (!compileRust) {
          return jsonResponse({ error: 'Rust compiler not available in this environment' }, 400)
        }
        const result = await compileRust(code)
        compiledCode = result.wasm
        break
      }
      case 'go': {
        if (!compileGo) {
          return jsonResponse({ error: 'Go compiler not available in this environment' }, 400)
        }
        const result = await compileGo(code)
        compiledCode = result.wasm
        break
      }
      case 'zig': {
        if (!compileZig) {
          return jsonResponse({ error: 'Zig compiler not available in this environment' }, 400)
        }
        const result = await compileZig(code)
        compiledCode = result.wasm
        break
      }
      case 'assemblyscript': {
        if (!compileAssemblyScript) {
          return jsonResponse({ error: 'AssemblyScript compiler not available in this environment' }, 400)
        }
        const result = await compileAssemblyScript(code)
        compiledCode = result.wasm
        break
      }
      default:
        return jsonResponse({ error: `Compilation not supported for language: ${language}` }, 400)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Compilation failed'
    return jsonResponse({ error: message }, 400)
  }

  // Create storage instances
  const registry = new KVFunctionRegistry(env.FUNCTIONS_REGISTRY)
  const codeStorage = new KVCodeStorage(env.FUNCTIONS_CODE)

  // Store code
  if (compiledCode instanceof Uint8Array) {
    // Store WASM as base64
    const base64Code = btoa(String.fromCharCode(...compiledCode))
    await codeStorage.put(id, base64Code, version)
    await codeStorage.put(id, base64Code)
  } else {
    await codeStorage.put(id, compiledCode, version)
    await codeStorage.put(id, compiledCode)
  }

  // Store metadata
  const metadata: FunctionMetadata = {
    id,
    version,
    language: language as FunctionMetadata['language'],
    entryPoint: resolvedEntryPoint,
    dependencies: dependencies || {},
  }
  await registry.put(metadata)
  await registry.putVersion(id, version, metadata)

  // Upload to dispatch namespace for TS/JS
  let dispatchUploadResult: { success: boolean; error?: string } = { success: true }
  if ((language === 'typescript' || language === 'javascript') && typeof compiledCode === 'string') {
    dispatchUploadResult = await uploadToDispatchNamespace(compiledCode, id, env)
  }

  // Return success response
  const baseUrl = new URL(request.url).origin
  return jsonResponse({
    id,
    version,
    url: `${baseUrl}/functions/${id}`,
    dispatchUpload: dispatchUploadResult.success
      ? 'success'
      : dispatchUploadResult.error || 'Dispatch upload not configured',
  })
}

export { deployHandler as default }
