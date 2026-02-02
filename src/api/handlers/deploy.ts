/**
 * Deploy Handler for Functions.do
 *
 * Handles function deployment including validation, compilation, and storage.
 * Uses Cloudflare Workers KV for metadata and code storage.
 *
 * Supports all four function tiers:
 * - **Code** (default): TypeScript/JavaScript compiled with esbuild-wasm,
 *   or WASM languages (Rust/Go/Zig/AssemblyScript) with pre-compiled binaries
 * - **Generative**: Single AI call with structured output (model, prompts, schema)
 * - **Agentic**: Multi-step AI with tools (model, system prompt, goal, tools)
 * - **Human**: Human-in-the-loop tasks (interaction type, UI config, assignees, SLA)
 *
 * ## TypeScript Compilation
 *
 * TypeScript code is compiled to JavaScript at deploy time using the
 * esbuild-compiler service binding. This provides:
 * - Full TypeScript support (enums, decorators, namespaces)
 * - Source map generation for debugging
 * - Zero runtime compilation overhead
 *
 * Design reference: docs/ESBUILD_WASM_DESIGN.md
 *
 * For WASM languages, two deployment modes are supported:
 * 1. **Pre-compiled WASM (Recommended)**: Upload a compiled .wasm binary
 *    - Set `language: "rust"` (or other WASM language)
 *    - Set `wasmBinary: "<base64-encoded .wasm file>"`
 *    - The `code` field can optionally contain the source for reference
 *
 * 2. **Source compilation**: Provide source code for server-side compilation
 *    - Set `language: "rust"` and `code: "<rust source>"`
 *    - Requires compiler availability (limited in production)
 *
 * @module handlers/deploy
 */

import type { RouteContext, Env, Handler } from '../router'
import { compileTypeScript } from '../../core/ts-compiler'
import { logAuditEvent, getClientIp } from '../../core/audit-logger'
import { invalidateFunctionCache } from './invoke'
import { getErrorMessage, ValidationError } from '../../core/errors'

/**
 * Extended route context for deploy handler.
 * Currently empty as deploy uses request body for all data.
 */
export interface DeployHandlerContext extends RouteContext {}

import { getStorageClientCompat } from './storage-compat'
import {
  validateFunctionId,
  validateLanguage,
  validateEntryPoint,
  validateDependencies,
} from '../../core/function-registry'
import { isValidVersion, type FunctionMetadata, type CodeFunctionMetadata, type HumanFunctionMetadata } from '../../core/types'
import { validateDeployBody } from '../../core/validation'
import { jsonResponse, jsonErrorResponse } from '../http-utils'

/**
 * Get a UserStorageClient for the current request.
 * Uses authenticated userId or falls back to 'anonymous'.
 */
function getStorageClient(env: Env, userId: string) {
  return getStorageClientCompat(env, userId)
}

/**
 * Result from WASM compilation.
 */
type CompileResult = { wasm: Uint8Array; exports?: string[] }

/**
 * Function type for WASM compilers.
 */
type CompileFunction = (code: string) => Promise<CompileResult>

/**
 * Function type for pre-compiled WASM validation.
 */
type AcceptPrecompiledFn = (binary: Uint8Array) => Promise<CompileResult>

/**
 * Function type for WASM binary validation.
 */
type ValidateWasmFn = (binary: Uint8Array) => { valid: boolean; error?: string; exports?: string[] }

/**
 * WASM languages that support pre-compiled binary upload
 */
const WASM_LANGUAGES = ['rust', 'go', 'zig', 'assemblyscript'] as const
type WasmLanguage = (typeof WASM_LANGUAGES)[number]

/**
 * Check if a language is a WASM language
 */
function isWasmLanguage(language: string): language is WasmLanguage {
  return WASM_LANGUAGES.includes(language as WasmLanguage)
}

/**
 * Validate JSON schema for safety
 * - Max size 100KB
 * - No circular references
 */
function validateJsonSchema(schema: unknown): { valid: boolean; error?: string } {
  if (typeof schema !== 'object' || schema === null) {
    return { valid: false, error: 'Schema must be an object' }
  }

  // Check size
  let serialized: string
  try {
    serialized = JSON.stringify(schema)
  } catch {
    return { valid: false, error: 'Schema contains circular references' }
  }

  if (serialized.length > 100000) {
    return { valid: false, error: 'Schema exceeds 100KB limit' }
  }

  return { valid: true }
}

// WASM compilers are dynamically imported to avoid issues with Node.js modules in Workers
let compileRust: CompileFunction | null = null
let compileGo: CompileFunction | null = null
let compileZig: CompileFunction | null = null
let compileAssemblyScript: CompileFunction | null = null

// WASM validation functions (always available)
let acceptPrecompiledWasm: AcceptPrecompiledFn | null = null
let validateWasmBinary: ValidateWasmFn | null = null

/**
 * Dynamically load WASM compilers and validation utilities.
 *
 * Compilers are loaded on-demand to avoid bundling issues in Worker environments.
 * Failures are silently ignored; the deploy handler will return an error if a
 * required compiler is not available.
 *
 * WASM validation utilities (acceptPrecompiledWasm, validateWasmBinary) are
 * always loaded as they don't have external dependencies.
 */
async function loadCompilers(): Promise<void> {
  // Always load WASM validation utilities (no external deps)
  try {
    const rustModule = await import('../../languages/rust/compile')
    compileRust = rustModule.compileRust
    acceptPrecompiledWasm = rustModule.acceptPrecompiledWasm
    validateWasmBinary = rustModule.validateWasmBinary
  } catch {
    // Rust compiler not available, but try to get validation functions
    try {
      const { acceptPrecompiledWasm: accept, validateWasmBinary: validate } =
        await import('../../languages/rust/compile')
      acceptPrecompiledWasm = accept
      validateWasmBinary = validate
    } catch {
      // Validation also not available
    }
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
 * Upload code to Cloudflare dispatch namespace via API.
 *
 * This enables Workers for Platforms execution of deployed functions.
 *
 * @param code - The JavaScript/TypeScript code to upload
 * @param scriptName - The name for the worker script (usually the function ID)
 * @param env - Environment with Cloudflare credentials and namespace config
 * @returns Success status and optional error message
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
    return { success: false, error: `Upload failed: ${getErrorMessage(error)}` }
  }
}

// =============================================================================
// DEPLOY SUB-HANDLERS FOR EACH FUNCTION TYPE
// =============================================================================

/**
 * Deploy a generative function.
 * Validates generative-specific fields and stores metadata in registry.
 */
async function deployGenerativeFunction(
  body: Record<string, unknown>,
  env: Env,
  baseUrl: string,
  request: Request,
  userId: string,
): Promise<Response> {
  const id = body.id as string
  const version = body.version as string
  const name = (body.name as string) || id
  const description = body.description as string | undefined
  const tags = body.tags as string[] | undefined

  // Validate generative-specific required fields
  const userPrompt = body.userPrompt as string | undefined
  if (!userPrompt) {
    return jsonErrorResponse('MISSING_REQUIRED', 'Missing required field for generative function: userPrompt')
  }

  const model = (body.model as string) || 'claude-3-sonnet'
  const systemPrompt = body.systemPrompt as string | undefined
  const outputSchema = body.outputSchema as Record<string, unknown> | undefined
  const temperature = body.temperature as number | undefined
  const maxTokens = body.maxTokens as number | undefined
  const examples = body.examples as Array<{ input: Record<string, unknown>; output: unknown; explanation?: string }> | undefined
  const inputSchema = body.inputSchema as Record<string, unknown> | undefined

  // Validate inputSchema if provided
  if (inputSchema !== undefined) {
    const schemaValidation = validateJsonSchema(inputSchema)
    if (!schemaValidation.valid) {
      return jsonErrorResponse('VALIDATION_ERROR', `Invalid inputSchema: ${schemaValidation.error}`)
    }
  }

  // Validate temperature range if provided
  if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
    return jsonErrorResponse('VALIDATION_ERROR', 'Invalid temperature: must be between 0 and 2')
  }

  // Validate maxTokens if provided
  if (maxTokens !== undefined && (maxTokens < 1 || !Number.isInteger(maxTokens))) {
    return jsonErrorResponse('VALIDATION_ERROR', 'Invalid maxTokens: must be a positive integer')
  }

  // Create storage client (UserStorage DO)
  const client = getStorageClient(env, userId)

  // Build metadata with generative-specific fields
  const metadata: FunctionMetadata = {
    id,
    version,
    type: 'generative',
    name,
    description,
    tags,
    model,
    systemPrompt,
    userPrompt,
    outputSchema,
    temperature,
    maxTokens,
    examples,
    inputSchema,
  }

  await client.registry.put(metadata)
  await client.registry.putVersion(id, version, metadata)

  // Invalidate cache to ensure fresh data on next invoke
  // Issue: functions-1277
  await invalidateFunctionCache(id)

  // Log audit event for successful deploy
  logAuditEvent({
    timestamp: Date.now(),
    userId,
    action: 'deploy',
    resource: id,
    status: 'success',
    details: { version, type: 'generative', model },
    ip: getClientIp(request),
  })

  return jsonResponse({
    id,
    version,
    type: 'generative',
    url: `${baseUrl}/functions/${id}`,
    model,
  })
}

/**
 * Deploy an agentic function.
 * Validates agentic-specific fields and stores metadata in registry.
 */
async function deployAgenticFunction(
  body: Record<string, unknown>,
  env: Env,
  baseUrl: string,
  request: Request,
  userId: string,
): Promise<Response> {
  const id = body.id as string
  const version = body.version as string
  const name = (body.name as string) || id
  const description = body.description as string | undefined
  const tags = body.tags as string[] | undefined

  // Validate agentic-specific required fields
  const systemPrompt = body.systemPrompt as string | undefined
  if (!systemPrompt) {
    return jsonErrorResponse('MISSING_REQUIRED', 'Missing required field for agentic function: systemPrompt')
  }

  const goal = body.goal as string | undefined
  if (!goal) {
    return jsonErrorResponse('MISSING_REQUIRED', 'Missing required field for agentic function: goal')
  }

  const model = (body.model as string) || 'claude-3-opus'
  const tools = body.tools as Array<{
    name: string
    description: string
    inputSchema?: Record<string, unknown>
    outputSchema?: Record<string, unknown>
  }> | undefined
  const outputSchema = body.outputSchema as Record<string, unknown> | undefined
  const maxIterations = body.maxIterations as number | undefined
  const maxToolCallsPerIteration = body.maxToolCallsPerIteration as number | undefined
  const enableReasoning = body.enableReasoning as boolean | undefined
  const enableMemory = body.enableMemory as boolean | undefined
  const tokenBudget = body.tokenBudget as number | undefined
  const inputSchema = body.inputSchema as Record<string, unknown> | undefined

  // Validate maxIterations if provided
  if (maxIterations !== undefined && (maxIterations < 1 || !Number.isInteger(maxIterations))) {
    return jsonErrorResponse('VALIDATION_ERROR', 'Invalid maxIterations: must be a positive integer')
  }

  // Validate tokenBudget if provided
  if (tokenBudget !== undefined && (tokenBudget < 1 || !Number.isInteger(tokenBudget))) {
    return jsonErrorResponse('VALIDATION_ERROR', 'Invalid tokenBudget: must be a positive integer')
  }

  // Validate tools structure if provided
  if (tools) {
    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i]
      if (!tool || !tool.name) {
        return jsonErrorResponse('VALIDATION_ERROR', `Invalid tool at index ${i}: missing 'name'`)
      }
      if (!tool.description) {
        return jsonErrorResponse('VALIDATION_ERROR', `Invalid tool at index ${i}: missing 'description'`)
      }
    }
  }

  // Validate inputSchema if provided
  if (inputSchema !== undefined) {
    const schemaValidation = validateJsonSchema(inputSchema)
    if (!schemaValidation.valid) {
      return jsonErrorResponse('VALIDATION_ERROR', `Invalid inputSchema: ${schemaValidation.error}`)
    }
  }

  // Create storage client (UserStorage DO)
  const client = getStorageClient(env, userId)

  // Build metadata with agentic-specific fields
  const metadata: FunctionMetadata = {
    id,
    version,
    type: 'agentic',
    name,
    description,
    tags,
    model,
    systemPrompt,
    goal,
    tools,
    outputSchema,
    maxIterations,
    maxToolCallsPerIteration,
    enableReasoning,
    enableMemory,
    tokenBudget,
    inputSchema,
  }

  await client.registry.put(metadata)
  await client.registry.putVersion(id, version, metadata)

  // Invalidate cache to ensure fresh data on next invoke
  // Issue: functions-1277
  await invalidateFunctionCache(id)

  // Log audit event for successful deploy
  logAuditEvent({
    timestamp: Date.now(),
    userId,
    action: 'deploy',
    resource: id,
    status: 'success',
    details: { version, type: 'agentic', model, toolCount: tools?.length || 0 },
    ip: getClientIp(request),
  })

  return jsonResponse({
    id,
    version,
    type: 'agentic',
    url: `${baseUrl}/functions/${id}`,
    model,
    maxIterations: maxIterations || 10,
    toolCount: tools?.length || 0,
  })
}

/**
 * Deploy a human function.
 * Validates human-specific fields and stores metadata in registry.
 */
async function deployHumanFunction(
  body: Record<string, unknown>,
  env: Env,
  baseUrl: string,
  request: Request,
  userId: string,
): Promise<Response> {
  const id = body.id as string
  const version = body.version as string
  const name = (body.name as string) || id
  const description = body.description as string | undefined
  const tags = body.tags as string[] | undefined

  // Validate human-specific required fields
  const interactionType = body.interactionType as string | undefined
  if (!interactionType) {
    return jsonErrorResponse('MISSING_REQUIRED', 'Missing required field for human function: interactionType')
  }

  const validInteractionTypes = ['approval', 'review', 'input', 'selection', 'annotation', 'verification', 'custom']
  if (!validInteractionTypes.includes(interactionType)) {
    return jsonErrorResponse('VALIDATION_ERROR', `Invalid interactionType: must be one of ${validInteractionTypes.join(', ')}`)
  }

  const uiConfig = body.uiConfig as Record<string, unknown> | undefined
  const assignees = body.assignees as Array<{ type: string; value: string }> | undefined
  const sla = body.sla as { responseTime?: string; resolutionTime?: string; onBreach?: string } | undefined
  const reminders = body.reminders as Record<string, unknown> | undefined
  const escalation = body.escalation as Record<string, unknown> | undefined
  const outputSchema = body.outputSchema as Record<string, unknown> | undefined
  const inputSchema = body.inputSchema as Record<string, unknown> | undefined

  // Validate assignees structure if provided
  if (assignees) {
    for (let i = 0; i < assignees.length; i++) {
      const assignee = assignees[i]
      if (!assignee || !assignee.type) {
        return jsonErrorResponse('VALIDATION_ERROR', `Invalid assignee at index ${i}: missing 'type'`)
      }
      if (!assignee.value) {
        return jsonErrorResponse('VALIDATION_ERROR', `Invalid assignee at index ${i}: missing 'value'`)
      }
    }
  }

  // Validate inputSchema if provided
  if (inputSchema !== undefined) {
    const schemaValidation = validateJsonSchema(inputSchema)
    if (!schemaValidation.valid) {
      return jsonErrorResponse('VALIDATION_ERROR', `Invalid inputSchema: ${schemaValidation.error}`)
    }
  }

  // Create storage client (UserStorage DO)
  const client = getStorageClient(env, userId)

  // Build metadata with human-specific fields
  const metadata: FunctionMetadata = {
    id,
    version,
    type: 'human',
    name,
    description,
    tags,
    interactionType: interactionType as HumanFunctionMetadata['interactionType'],
    uiConfig,
    assignees,
    sla,
    reminders,
    escalation,
    outputSchema,
    inputSchema,
  }

  await client.registry.put(metadata)
  await client.registry.putVersion(id, version, metadata)

  // Invalidate cache to ensure fresh data on next invoke
  // Issue: functions-1277
  await invalidateFunctionCache(id)

  // Log audit event for successful deploy
  logAuditEvent({
    timestamp: Date.now(),
    userId,
    action: 'deploy',
    resource: id,
    status: 'success',
    details: { version, type: 'human', interactionType },
    ip: getClientIp(request),
  })

  return jsonResponse({
    id,
    version,
    type: 'human',
    url: `${baseUrl}/functions/${id}`,
    interactionType,
  })
}

/**
 * Deploy handler - validates, compiles, and stores function code and metadata.
 *
 * Supports all four function tiers:
 * - **Code** (type === 'code' or omitted): Compile and store code
 * - **Generative** (type === 'generative'): Store AI model config and prompts
 * - **Agentic** (type === 'agentic'): Store agent config, tools, and goal
 * - **Human** (type === 'human'): Store interaction config, UI, assignees, SLA
 *
 * Code function workflow:
 * 1. Parse and validate request body (id, version, language, code)
 * 2. Validate function ID format, semantic version, language support
 * 3. Compile code if needed (WASM for Rust/Go/Zig/AssemblyScript)
 * 4. Store code in KV (versioned and latest)
 * 5. Store metadata in registry (versioned and latest)
 * 6. Upload to dispatch namespace for TS/JS functions
 *
 * Non-code function workflow:
 * 1. Parse and validate request body (id, version, type-specific fields)
 * 2. Validate function ID format and semantic version
 * 3. Store metadata with all type-specific config in registry
 *
 * @param request - The incoming HTTP request with JSON deployment payload
 * @param env - Environment bindings (KV namespaces, Cloudflare credentials)
 * @param ctx - Execution context
 * @param context - Route context (unused for deploy)
 * @returns JSON response with deployment result including function URL
 *
 * @example
 * // POST /api/functions - Code function
 * // Body: { "id": "my-fn", "version": "1.0.0", "language": "typescript", "code": "..." }
 * // Response: { "id": "my-fn", "version": "1.0.0", "url": "https://.../functions/my-fn" }
 *
 * @example
 * // POST /api/functions - Generative function
 * // Body: { "type": "generative", "id": "summarize", "version": "1.0.0", "model": "claude-3-sonnet", "userPrompt": "Summarize: {{text}}" }
 * // Response: { "id": "summarize", "version": "1.0.0", "type": "generative", "url": "https://.../functions/summarize" }
 *
 * @example
 * // POST /api/functions - Agentic function
 * // Body: { "type": "agentic", "id": "research", "version": "1.0.0", "systemPrompt": "...", "goal": "..." }
 * // Response: { "id": "research", "version": "1.0.0", "type": "agentic", "url": "https://.../functions/research" }
 *
 * @example
 * // POST /api/functions - Human function
 * // Body: { "type": "human", "id": "approve", "version": "1.0.0", "interactionType": "approval" }
 * // Response: { "id": "approve", "version": "1.0.0", "type": "human", "url": "https://.../functions/approve" }
 */
/** Maximum allowed request body size for deploy requests (50MB) */
const DEPLOY_MAX_BODY_SIZE = 50 * 1024 * 1024

export const deployHandler: Handler = async (
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  _context?: RouteContext
): Promise<Response> => {
  // Validate request body size before parsing
  const contentLength = request.headers.get('Content-Length')
  if (contentLength !== null) {
    const size = parseInt(contentLength, 10)
    if (isNaN(size) || size > DEPLOY_MAX_BODY_SIZE) {
      return jsonErrorResponse('PAYLOAD_TOO_LARGE', `Request body too large. Maximum size is ${DEPLOY_MAX_BODY_SIZE} bytes (50MB).`)
    }
  }

  // Parse and validate request body
  let body: Record<string, unknown>

  try {
    const rawBody = await request.json()
    body = validateDeployBody(rawBody)
  } catch (parseError) {
    if (parseError instanceof ValidationError) {
      return jsonErrorResponse('VALIDATION_ERROR', parseError.message)
    }
    return jsonErrorResponse('INVALID_JSON', 'Invalid JSON body')
  }

  // Determine function type (default to 'code' for backward compatibility)
  const functionType = (body.type as string) || 'code'

  // Validate common required fields
  const id = body.id as string | undefined
  const version = body.version as string | undefined

  if (!id) {
    return jsonErrorResponse('MISSING_REQUIRED', 'Missing required field: id')
  }
  if (!version) {
    return jsonErrorResponse('MISSING_REQUIRED', 'Missing required field: version')
  }

  // Validate function ID
  try {
    validateFunctionId(id)
  } catch (error) {
    return jsonErrorResponse('INVALID_FUNCTION_ID', getErrorMessage(error, 'Invalid function ID'))
  }

  // Validate version
  if (!isValidVersion(version)) {
    return jsonErrorResponse('INVALID_VERSION', `Invalid semantic version: ${version}`)
  }

  const baseUrl = new URL(request.url).origin

  // Extract userId from auth context (default to 'anonymous' for unauthenticated requests)
  const userId = _context?.authContext?.userId || 'anonymous'

  // Route to type-specific deploy handler
  switch (functionType) {
    case 'generative':
      return deployGenerativeFunction(body, env, baseUrl, request, userId)
    case 'agentic':
      return deployAgenticFunction(body, env, baseUrl, request, userId)
    case 'human':
      return deployHumanFunction(body, env, baseUrl, request, userId)
    case 'code':
      // Fall through to existing code deploy logic below
      break
    default:
      return jsonErrorResponse('VALIDATION_ERROR', `Invalid function type: ${functionType}. Must be one of: code, generative, agentic, human`)
  }

  // =========================================================================
  // CODE FUNCTION DEPLOY (existing logic, preserved for backward compatibility)
  // =========================================================================

  const language = body.language as string | undefined
  const code = body.code as string | undefined
  const entryPoint = body.entryPoint as string | undefined
  const dependencies = body.dependencies as Record<string, string> | undefined
  const wasmBinary = body.wasmBinary as string | undefined

  if (!language) {
    return jsonErrorResponse('MISSING_REQUIRED', 'Missing required field: language')
  }

  // For WASM languages, either wasmBinary OR code is required
  // For other languages, code is always required
  const hasWasmBinary = wasmBinary && wasmBinary.length > 0
  const hasCode = code && code.length > 0

  if (isWasmLanguage(language)) {
    if (!hasWasmBinary && !hasCode) {
      return jsonErrorResponse('MISSING_REQUIRED', `Missing required field for ${language}: provide either 'wasmBinary' (base64-encoded .wasm) or 'code' (source)`)
    }
  } else {
    if (!hasCode) {
      return jsonErrorResponse('MISSING_REQUIRED', 'Missing required field: code')
    }
  }

  // Validate language
  try {
    validateLanguage(language)
  } catch (error) {
    return jsonErrorResponse('INVALID_LANGUAGE', getErrorMessage(error, 'Invalid language'))
  }

  // Validate entry point if provided
  const resolvedEntryPoint = entryPoint || (language === 'typescript' || language === 'javascript' ? 'index.ts' : 'main')
  try {
    validateEntryPoint(resolvedEntryPoint)
  } catch (error) {
    return jsonErrorResponse('VALIDATION_ERROR', getErrorMessage(error, 'Invalid entry point'))
  }

  // Validate dependencies if provided
  try {
    validateDependencies(dependencies)
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error, 'Invalid dependencies') }, 400)
  }

  // Load compilers if not already loaded
  await loadCompilers()

  // Track extracted exports from WASM (for metadata)
  let wasmExports: string[] | undefined

  // Track TypeScript compilation results
  let tsCompileResult: {
    success: boolean
    compiledJs?: string
    sourceMap?: string
    warnings?: string[]
    compiler?: string
  } | undefined

  // Compile code based on language
  let compiledCode: string | Uint8Array
  try {
    switch (language) {
      case 'typescript': {
        // Compile TypeScript to JavaScript using esbuild-wasm at deploy time
        // This enables full TypeScript support (enums, decorators, namespaces)
        const result = await compileTypeScript(code!, env.ESBUILD_COMPILER, {
          loader: resolvedEntryPoint.endsWith('.tsx') ? 'tsx' : 'ts',
          sourcemap: true,
        })

        if (!result.success) {
          return jsonErrorResponse('COMPILATION_ERROR', 'TypeScript compilation failed', 400, {
            details: {
              errors: result.errors,
              warnings: result.warnings,
            },
          })
        }

        // Store source as the main code
        compiledCode = code!
        // Track compilation results for storage
        tsCompileResult = {
          success: true,
          compiledJs: result.code,
          compiler: result.compiler,
        }
        if (result.map) {
          tsCompileResult.sourceMap = result.map
        }
        if (result.warnings.length > 0) {
          tsCompileResult.warnings = result.warnings
        }
        break
      }

      case 'javascript':
        // JavaScript is stored directly (no compilation needed)
        compiledCode = code!
        break

      case 'rust':
      case 'go':
      case 'zig':
      case 'assemblyscript': {
        // Check if pre-compiled WASM binary is provided
        if (hasWasmBinary) {
          // Decode base64 to binary
          let wasmBytes: Uint8Array
          try {
            const binaryString = atob(wasmBinary!)
            wasmBytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
              wasmBytes[i] = binaryString.charCodeAt(i)
            }
          } catch {
            return jsonErrorResponse('VALIDATION_ERROR', 'Invalid wasmBinary: must be valid base64-encoded data')
          }

          // Validate the WASM binary
          if (!validateWasmBinary) {
            return jsonErrorResponse('INTERNAL_ERROR', 'WASM validation not available')
          }

          const validation = validateWasmBinary(wasmBytes)
          if (!validation.valid) {
            return jsonErrorResponse('VALIDATION_ERROR', `Invalid WASM binary: ${validation.error}`)
          }

          // Store exports for metadata
          wasmExports = validation.exports

          // Use the validated binary directly
          compiledCode = wasmBytes
        } else {
          // Fall back to source compilation
          let compiler: CompileFunction | null = null
          let compilerName = ''

          switch (language) {
            case 'rust':
              compiler = compileRust
              compilerName = 'Rust'
              break
            case 'go':
              compiler = compileGo
              compilerName = 'Go'
              break
            case 'zig':
              compiler = compileZig
              compilerName = 'Zig'
              break
            case 'assemblyscript':
              compiler = compileAssemblyScript
              compilerName = 'AssemblyScript'
              break
          }

          if (!compiler) {
            return jsonErrorResponse('NOT_IMPLEMENTED', `${compilerName} compiler not available. Please provide a pre-compiled WASM binary via 'wasmBinary' field.`, 501, {
              details: {
                hint: `Compile your ${language} code locally and upload the .wasm file as base64-encoded 'wasmBinary'`,
              },
            })
          }

          const result = await compiler(code!)
          compiledCode = result.wasm
          wasmExports = result.exports
        }
        break
      }

      default:
        return jsonErrorResponse('INVALID_LANGUAGE', `Compilation not supported for language: ${language}`)
    }
  } catch (error) {
    return jsonErrorResponse('COMPILATION_ERROR', getErrorMessage(error, 'Compilation failed'))
  }

  // Create storage client (UserStorage DO)
  const client = getStorageClient(env, userId)

  // Store code
  if (compiledCode instanceof Uint8Array) {
    // For WASM binaries, store as base64 string in DO code storage
    // (UserStorage DO stores text, not binary - for large WASM use R2)
    const base64Wasm = btoa(String.fromCharCode(...compiledCode))
    await client.code.put(id, base64Wasm, version)
    await client.code.put(id, base64Wasm)

    // Also store source code if provided (for reference/debugging)
    if (hasCode) {
      // Store source separately with a version suffix convention
      // The main code slot holds the WASM binary for execution
    }
  } else {
    // Store source code
    await client.code.put(id, compiledCode, version)
    await client.code.put(id, compiledCode)

    // For TypeScript, also store the compiled JavaScript and source map
    if (tsCompileResult?.success && tsCompileResult.compiledJs) {
      // Store compiled JS for fast runtime execution (no compilation overhead)
      await client.code.putCompiled(id, tsCompileResult.compiledJs, version)
      await client.code.putCompiled(id, tsCompileResult.compiledJs)

      // Store source map for debugging
      if (tsCompileResult.sourceMap) {
        await client.code.putSourceMap(id, tsCompileResult.sourceMap, version)
        await client.code.putSourceMap(id, tsCompileResult.sourceMap)
      }
    }
  }

  // Store metadata
  const metadata: FunctionMetadata = {
    id,
    version,
    type: 'code',
    name: body['name'] as string | undefined,
    description: body['description'] as string | undefined,
    tags: body['tags'] as string[] | undefined,
    language: language as CodeFunctionMetadata['language'],
    entryPoint: resolvedEntryPoint,
    dependencies: dependencies || {},
  }
  await client.registry.put(metadata)
  await client.registry.putVersion(id, version, metadata)

  // Invalidate cache to ensure fresh data on next invoke
  // Issue: functions-1277
  await invalidateFunctionCache(id)

  // Upload to dispatch namespace for TS/JS (use compiled JS if available)
  let dispatchUploadResult: { success: boolean; error?: string; skipped?: boolean; reason?: string } = { success: true }

  // Before uploading to dispatch namespace, validate code type
  const codeToUpload: string | undefined =
    language === 'typescript' && tsCompileResult?.compiledJs
      ? tsCompileResult.compiledJs
      : typeof compiledCode === 'string' ? compiledCode : undefined

  if (!codeToUpload) {
    // Skip dispatch upload for WASM/binary code
    dispatchUploadResult = { success: true, skipped: true, reason: 'Binary code not uploaded to dispatch' }
  } else if (language === 'typescript' || language === 'javascript') {
    dispatchUploadResult = await uploadToDispatchNamespace(codeToUpload, id, env)
  }

  // Return success response
  const response: {
    id: string
    version: string
    type: string
    url: string
    dispatchUpload: string
    wasmExports?: string[]
    wasmSize?: number
    compilation?: {
      compiler: string
      warnings?: string[]
      hasSourceMap: boolean
    }
  } = {
    id,
    version,
    type: 'code',
    url: `${baseUrl}/functions/${id}`,
    dispatchUpload: dispatchUploadResult.success
      ? 'success'
      : dispatchUploadResult.error || 'Dispatch upload not configured',
  }

  // Include WASM-specific metadata in response
  if (isWasmLanguage(language) && compiledCode instanceof Uint8Array) {
    if (wasmExports) {
      response.wasmExports = wasmExports
    }
    response.wasmSize = compiledCode.length
  }

  // Include TypeScript compilation metadata in response
  if (tsCompileResult?.success) {
    const compilation: { compiler: string; warnings?: string[]; hasSourceMap: boolean } = {
      compiler: tsCompileResult.compiler || 'unknown',
      hasSourceMap: !!tsCompileResult.sourceMap,
    }
    if (tsCompileResult.warnings && tsCompileResult.warnings.length > 0) {
      compilation.warnings = tsCompileResult.warnings
    }
    response.compilation = compilation
  }

  // Log audit event for successful code deploy
  logAuditEvent({
    timestamp: Date.now(),
    userId,
    action: 'deploy',
    resource: id,
    status: 'success',
    details: { version, type: 'code', language },
    ip: getClientIp(request),
  })

  return jsonResponse(response)
}
