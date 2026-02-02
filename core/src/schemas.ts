/**
 * Zod schemas for runtime validation - SINGLE SOURCE OF TRUTH
 *
 * This file is the canonical source for type definitions that need runtime validation.
 * TypeScript types are derived from Zod schemas using z.infer<>.
 *
 * Benefits:
 * - Single source of truth prevents type drift
 * - Runtime validation matches compile-time types
 * - Type inference from schemas provides consistency
 *
 * For types that cannot be expressed in Zod (branded types, complex generics),
 * see types.ts which imports and re-exports types from this file.
 */

import { z } from 'zod'

// =============================================================================
// BASIC TYPE SCHEMAS - Source of truth for simple types
// =============================================================================

/**
 * Schema for function type discriminator
 * @canonical This is the source of truth for FunctionType
 */
export const FunctionTypeSchema = z.enum(['code', 'generative', 'agentic', 'human'])

/**
 * FunctionType derived from schema - use this type, not a manual definition
 */
export type FunctionType = z.infer<typeof FunctionTypeSchema>

/**
 * Schema for function result status
 * @canonical This is the source of truth for FunctionResultStatus
 */
export const FunctionResultStatusSchema = z.enum(['completed', 'failed', 'timeout', 'cancelled'])

/**
 * FunctionResultStatus derived from schema - use this type, not a manual definition
 */
export type FunctionResultStatus = z.infer<typeof FunctionResultStatusSchema>

/**
 * Schema for duration values (number in ms or duration string)
 * Note: The Duration type in types.ts has stricter template literal types,
 * but this schema handles runtime validation.
 * @canonical For runtime validation; types.ts has the full Duration type
 */
export const DurationSchema = z.union([
  z.number().int().min(0),
  z.string().regex(
    /^\d+\s*(ms|s|seconds?|m|minutes?|h|hours?|d|days?)$/,
    'Invalid duration format. Use formats like: 100ms, 5s, 1 minute, 2 hours, 1 day'
  ),
])

/**
 * Duration type from schema - runtime validation compatible
 * For the full template literal type, use Duration from types.ts
 */
export type DurationFromSchema = z.infer<typeof DurationSchema>

// =============================================================================
// JSON SCHEMA
// =============================================================================

/**
 * JsonSchema type - simplified JSON Schema interface
 *
 * All known JSON Schema keywords are explicitly typed instead of using
 * an open index signature (`[key: string]: unknown`), which would weaken
 * type safety on every property access.
 *
 * The Zod schema uses `.passthrough()` for runtime flexibility, but the
 * TypeScript interface restricts to known keywords for compile-time safety.
 *
 * @canonical This is the source of truth for JsonSchema
 */
export interface JsonSchema {
  // Core keywords
  type?: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  required?: string[]
  enum?: unknown[]
  description?: string
  default?: unknown

  // Schema composition
  allOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  not?: JsonSchema
  if?: JsonSchema
  then?: JsonSchema
  else?: JsonSchema

  // Object keywords
  additionalProperties?: boolean | JsonSchema
  patternProperties?: Record<string, JsonSchema>
  minProperties?: number
  maxProperties?: number
  propertyNames?: JsonSchema

  // Array keywords
  additionalItems?: boolean | JsonSchema
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
  contains?: JsonSchema
  prefixItems?: JsonSchema[]

  // String keywords
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: string

  // Number keywords
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number | boolean
  exclusiveMaximum?: number | boolean
  multipleOf?: number

  // Metadata & references
  title?: string
  $ref?: string
  $schema?: string
  $id?: string
  $defs?: Record<string, JsonSchema>
  definitions?: Record<string, JsonSchema>
  const?: unknown
  examples?: unknown[]
  readOnly?: boolean
  writeOnly?: boolean
  deprecated?: boolean
}

/**
 * Schema for JSON Schema objects (simplified, allows additional properties)
 * @canonical This is the source of truth for JsonSchema
 */
export const JsonSchemaSchema: z.ZodType<JsonSchema> = z.lazy(() =>
  z.object({
    type: z.enum(['object', 'array', 'string', 'number', 'boolean', 'null']).optional(),
    properties: z.record(z.lazy(() => JsonSchemaSchema)).optional(),
    items: z.lazy(() => JsonSchemaSchema).optional(),
    required: z.array(z.string()).optional(),
    enum: z.array(z.unknown()).optional(),
    description: z.string().optional(),
    default: z.unknown().optional(),
  }).passthrough()
) as z.ZodType<JsonSchema>

// =============================================================================
// TOKEN USAGE & METRICS
// =============================================================================

/**
 * Schema for token usage metrics
 * @canonical This is the source of truth for TokenUsage
 */
export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
})

/**
 * TokenUsage derived from schema
 */
export type TokenUsage = z.infer<typeof TokenUsageSchema>

/**
 * Schema for retry policy configuration
 * @canonical This is the source of truth for RetryPolicy
 */
export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).optional(),
  initialDelay: DurationSchema.optional(),
  maxDelay: DurationSchema.optional(),
  backoffCoefficient: z.number().min(1).optional(),
  nonRetryableErrors: z.array(z.string()).optional(),
}).partial()

/**
 * RetryPolicy derived from schema
 */
export type RetryPolicy = z.infer<typeof RetryPolicySchema>

/**
 * Schema for execution metrics
 * @canonical This is the source of truth for ExecutionMetrics
 */
export const ExecutionMetricsSchema = z.object({
  durationMs: z.number().int().min(0),
  inputSizeBytes: z.number().int().min(0),
  outputSizeBytes: z.number().int().min(0),
  retryCount: z.number().int().min(0),
  computeUnits: z.number().optional(),
  tokens: TokenUsageSchema.optional(),
})

/**
 * ExecutionMetrics derived from schema
 */
export type ExecutionMetrics = z.infer<typeof ExecutionMetricsSchema>

// =============================================================================
// WORKFLOW CONTEXT
// =============================================================================

/**
 * Schema for workflow context
 * Note: types.ts has WorkflowContext with branded types for workflowId/runId
 * This schema validates the raw string values
 * @canonical For runtime validation; types.ts has branded version
 */
export const WorkflowContextSchema = z.object({
  workflowId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1),
})

/**
 * WorkflowContext from schema (with plain strings)
 * For branded types version, use WorkflowContext from types.ts
 */
export type WorkflowContextFromSchema = z.infer<typeof WorkflowContextSchema>

// =============================================================================
// EXECUTION METADATA
// =============================================================================

/**
 * Schema for execution metadata
 * @canonical This is the source of truth for ExecutionMetadata
 */
export const ExecutionMetadataSchema = z.object({
  startedAt: z.number().int(),
  completedAt: z.number().int().optional(),
  region: z.string().optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  triggeredBy: z.string().optional(),
  workflowContext: WorkflowContextSchema.optional(),
})

/**
 * ExecutionMetadata derived from schema
 */
export type ExecutionMetadata = z.infer<typeof ExecutionMetadataSchema>

// =============================================================================
// FUNCTION ERROR
// =============================================================================

/**
 * Schema for function error
 * @canonical This is the source of truth for FunctionError
 */
export const FunctionErrorSchema = z.object({
  name: z.string().min(1),
  message: z.string(),
  code: z.string().optional(),
  stack: z.string().optional(),
  retryable: z.boolean().optional(),
})

/**
 * FunctionError derived from schema
 */
export type FunctionError = z.infer<typeof FunctionErrorSchema>

// =============================================================================
// FUNCTION DEFINITION
// =============================================================================

/**
 * Semantic version regex pattern
 */
const semverRegex = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/

/**
 * Schema for function definition
 * Note: types.ts has FunctionDefinition with branded FunctionId and generic params
 * This schema validates the raw structure for runtime validation
 * @canonical For runtime validation; types.ts has branded/generic version
 */
export const FunctionDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().regex(semverRegex, 'Invalid semantic version format'),
  description: z.string().optional(),
  type: FunctionTypeSchema,
  inputSchema: JsonSchemaSchema.optional(),
  outputSchema: JsonSchemaSchema.optional(),
  defaultConfig: z.unknown().optional(),
  timeout: DurationSchema.optional(),
  retryPolicy: RetryPolicySchema.optional(),
  tags: z.array(z.string()).optional(),
})

/**
 * FunctionDefinition from schema (with plain strings)
 * For branded types and generic version, use FunctionDefinition from types.ts
 */
export type FunctionDefinitionFromSchema = z.infer<typeof FunctionDefinitionSchema>

// =============================================================================
// FUNCTION RESULT
// =============================================================================

/**
 * Schema for function result
 * Note: types.ts has FunctionResult with branded types and generic params
 * This schema validates the raw structure for runtime validation
 * @canonical For runtime validation; types.ts has branded/generic version
 */
export const FunctionResultSchema = z.object({
  executionId: z.string().min(1),
  functionId: z.string().min(1),
  functionVersion: z.string(),
  status: FunctionResultStatusSchema,
  output: z.unknown().optional(),
  error: FunctionErrorSchema.optional(),
  metrics: ExecutionMetricsSchema,
  metadata: ExecutionMetadataSchema,
})

/**
 * FunctionResult from schema (with plain strings)
 * For branded types and generic version, use FunctionResult from types.ts
 */
export type FunctionResultFromSchema = z.infer<typeof FunctionResultSchema>

// =============================================================================
// VALIDATION TYPES
// =============================================================================

/**
 * Schema for validation error
 * @canonical This is the source of truth for ValidationError
 */
export const ValidationErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
})

/**
 * ValidationError derived from schema
 */
export type ValidationError = z.infer<typeof ValidationErrorSchema>

/**
 * Schema for validation result
 * @canonical This is the source of truth for ValidationResult
 */
export const ValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(ValidationErrorSchema).optional(),
})

/**
 * ValidationResult derived from schema
 */
export type ValidationResult = z.infer<typeof ValidationResultSchema>

// =============================================================================
// EXECUTION CONTEXT
// =============================================================================

/**
 * Schema for execution context
 * Note: types.ts has ExecutionContext with branded ExecutionId and AbortSignal
 * This schema validates the serializable parts for runtime validation
 * @canonical For runtime validation; types.ts has full version with AbortSignal
 */
export const ExecutionContextSchema = z.object({
  executionId: z.string().optional(),
  traceId: z.string().optional(),
  parentSpanId: z.string().optional(),
  timeout: DurationSchema.optional(),
  // Note: AbortSignal cannot be validated by Zod
  env: z.record(z.unknown()).optional(),
}).partial()

/**
 * ExecutionContext from schema (serializable version)
 * For full version with AbortSignal and branded types, use ExecutionContext from types.ts
 */
export type ExecutionContextFromSchema = z.infer<typeof ExecutionContextSchema>

// =============================================================================
// FUNCTION FILTER
// =============================================================================

/**
 * Schema for function filter
 * @canonical This is the source of truth for FunctionFilter
 */
export const FunctionFilterSchema = z.object({
  type: FunctionTypeSchema.optional(),
  tags: z.array(z.string()).optional(),
  namePattern: z.string().optional(),
}).partial()

/**
 * FunctionFilter derived from schema
 */
export type FunctionFilter = z.infer<typeof FunctionFilterSchema>

// =============================================================================
// FUNCTION INVOCATION
// =============================================================================

/**
 * Schema for function invocation
 * Note: types.ts has FunctionInvocation with branded FunctionId and generic params
 * This schema validates the raw structure for runtime validation
 * @canonical For runtime validation; types.ts has branded/generic version
 */
export const FunctionInvocationSchema = z.object({
  functionId: z.string().min(1),
  version: z.string().optional(),
  input: z.unknown(),
  config: z.unknown().optional(),
  context: ExecutionContextSchema.optional(),
  idempotencyKey: z.string().optional(),
})

/**
 * FunctionInvocation from schema (with plain strings)
 * For branded types and generic version, use FunctionInvocation from types.ts
 */
export type FunctionInvocationFromSchema = z.infer<typeof FunctionInvocationSchema>

// =============================================================================
// INFERRED TYPES (DEPRECATED ALIASES)
// =============================================================================
// These "*Inferred" aliases are kept for backwards compatibility.
// Prefer using the non-suffixed type names above (e.g., FunctionType instead of FunctionTypeInferred)

/** @deprecated Use FunctionType instead */
export type FunctionTypeInferred = FunctionType
/** @deprecated Use FunctionResultStatus instead */
export type FunctionResultStatusInferred = FunctionResultStatus
/** @deprecated Use DurationFromSchema instead */
export type DurationInferred = DurationFromSchema
/** @deprecated Use JsonSchema instead */
export type JsonSchemaInferred = JsonSchema
/** @deprecated Use TokenUsage instead */
export type TokenUsageInferred = TokenUsage
/** @deprecated Use RetryPolicy instead */
export type RetryPolicyInferred = RetryPolicy
/** @deprecated Use ExecutionMetrics instead */
export type ExecutionMetricsInferred = ExecutionMetrics
/** @deprecated Use WorkflowContextFromSchema instead */
export type WorkflowContextInferred = WorkflowContextFromSchema
/** @deprecated Use ExecutionMetadata instead */
export type ExecutionMetadataInferred = ExecutionMetadata
/** @deprecated Use FunctionError instead */
export type FunctionErrorInferred = FunctionError
/** @deprecated Use FunctionDefinitionFromSchema instead */
export type FunctionDefinitionInferred = FunctionDefinitionFromSchema
/** @deprecated Use FunctionResultFromSchema instead */
export type FunctionResultInferred = FunctionResultFromSchema
/** @deprecated Use ValidationError instead */
export type ValidationErrorInferred = ValidationError
/** @deprecated Use ValidationResult instead */
export type ValidationResultInferred = ValidationResult
/** @deprecated Use ExecutionContextFromSchema instead */
export type ExecutionContextInferred = ExecutionContextFromSchema
/** @deprecated Use FunctionFilter instead */
export type FunctionFilterInferred = FunctionFilter
/** @deprecated Use FunctionInvocationFromSchema instead */
export type FunctionInvocationInferred = FunctionInvocationFromSchema

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validates a function definition and returns a ValidationResult
 */
export function validateFunctionDefinition(data: unknown): ValidationResult {
  const result = FunctionDefinitionSchema.safeParse(data)
  if (result.success) {
    return { valid: true }
  }
  return {
    valid: false,
    errors: createValidationError(result.error),
  }
}

/**
 * Validates a function result and returns a ValidationResult
 */
export function validateFunctionResult(data: unknown): ValidationResult {
  const result = FunctionResultSchema.safeParse(data)
  if (result.success) {
    return { valid: true }
  }
  return {
    valid: false,
    errors: createValidationError(result.error),
  }
}

/**
 * Validates input data against a JSON schema
 * Uses a simple type-based validation for JSON schemas
 */
export function validateInput(
  input: unknown,
  schema: JsonSchema
): ValidationResult {
  // For now, perform basic validation based on JSON schema structure
  // Full JSON Schema validation would require a dedicated library
  const errors: ValidationError[] = []

  if (schema.type === 'object' && typeof input !== 'object') {
    errors.push({ path: 'input', message: 'Expected object' })
  }

  if (schema.type === 'string' && typeof input !== 'string') {
    errors.push({ path: 'input', message: 'Expected string' })
  }

  if (schema.type === 'number' && typeof input !== 'number') {
    errors.push({ path: 'input', message: 'Expected number' })
  }

  if (schema.type === 'boolean' && typeof input !== 'boolean') {
    errors.push({ path: 'input', message: 'Expected boolean' })
  }

  if (schema.type === 'array' && !Array.isArray(input)) {
    errors.push({ path: 'input', message: 'Expected array' })
  }

  // Check required properties for objects
  if (
    schema.type === 'object' &&
    typeof input === 'object' &&
    input !== null &&
    Array.isArray(schema.required)
  ) {
    for (const requiredProp of schema.required) {
      if (!(requiredProp in input)) {
        errors.push({
          path: `input.${requiredProp}`,
          message: `Required property '${requiredProp}' is missing`,
        })
      }
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true }
}

/**
 * Validates output data against a JSON schema
 */
export function validateOutput(
  output: unknown,
  schema: JsonSchema
): ValidationResult {
  const errors: ValidationError[] = []

  if (schema.type === 'object' && typeof output !== 'object') {
    errors.push({ path: 'output', message: 'Expected object' })
  }

  if (schema.type === 'string' && typeof output !== 'string') {
    errors.push({ path: 'output', message: 'Expected string' })
  }

  if (schema.type === 'number' && typeof output !== 'number') {
    errors.push({ path: 'output', message: 'Expected number' })
  }

  if (schema.type === 'boolean' && typeof output !== 'boolean') {
    errors.push({ path: 'output', message: 'Expected boolean' })
  }

  if (schema.type === 'array' && !Array.isArray(output)) {
    errors.push({ path: 'output', message: 'Expected array' })
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true }
}

/**
 * Safe parse for function definition with typed result
 */
export function safeParseFunctionDefinition(
  data: unknown
): z.SafeParseReturnType<unknown, FunctionDefinitionFromSchema> {
  return FunctionDefinitionSchema.safeParse(data)
}

/**
 * Safe parse for function result with typed result
 */
export function safeParseFunctionResult(
  data: unknown
): z.SafeParseReturnType<unknown, FunctionResultFromSchema> {
  return FunctionResultSchema.safeParse(data)
}

/**
 * Creates an array of ValidationError from a ZodError
 */
export function createValidationError(zodError: z.ZodError): ValidationError[] {
  return zodError.issues.map((issue) => ({
    path: issue.path.join('.') || 'root',
    message: issue.message,
    code: issue.code,
  }))
}

// =============================================================================
// CODE LANGUAGE SCHEMA
// =============================================================================

/**
 * Schema for supported code languages
 * @canonical This is the source of truth for CodeLanguage (runtime validation)
 * Note: code/index.ts has the same CodeLanguage type for compile-time use
 */
export const CodeLanguageSchema = z.enum([
  'typescript',
  'javascript',
  'rust',
  'go',
  'python',
  'zig',
  'assemblyscript',
  'csharp',
])

/**
 * CodeLanguage derived from schema
 */
export type CodeLanguage = z.infer<typeof CodeLanguageSchema>

// =============================================================================
// DEPLOY REQUEST SCHEMAS
// =============================================================================

/**
 * Common fields shared by all deploy request types
 */
const DeployRequestBaseSchema = z.object({
  id: z.string().min(1, 'Function ID is required').regex(
    /^[a-zA-Z][a-zA-Z0-9_-]*$/,
    'Function ID must start with a letter and contain only letters, numbers, underscores, and hyphens'
  ),
  version: z.string().regex(semverRegex, 'Invalid semantic version format'),
  name: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  inputSchema: JsonSchemaSchema.optional(),
})

/**
 * Schema for code function deploy request (type === 'code' or omitted)
 */
export const CodeDeployRequestSchema = DeployRequestBaseSchema.extend({
  type: z.literal('code').optional(),
  language: CodeLanguageSchema,
  code: z.string().min(1, 'Code cannot be empty'),
  entryPoint: z.string().optional(),
  dependencies: z.record(z.string()).optional(),
  /** Base64-encoded pre-compiled WASM binary (for Rust/Go/Zig/AssemblyScript) */
  wasmBinary: z.string().optional(),
})

/**
 * Schema for generative function deploy request (type === 'generative')
 */
export const GenerativeDeployRequestSchema = DeployRequestBaseSchema.extend({
  type: z.literal('generative'),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  userPrompt: z.string().min(1, 'User prompt is required for generative functions'),
  outputSchema: JsonSchemaSchema.optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).optional(),
  examples: z.array(z.object({
    input: z.record(z.unknown()),
    output: z.unknown(),
    explanation: z.string().optional(),
  })).optional(),
})

/**
 * Schema for agentic function deploy request (type === 'agentic')
 */
export const AgenticDeployRequestSchema = DeployRequestBaseSchema.extend({
  type: z.literal('agentic'),
  model: z.string().optional(),
  systemPrompt: z.string().min(1, 'System prompt is required for agentic functions'),
  goal: z.string().min(1, 'Goal is required for agentic functions'),
  tools: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    inputSchema: JsonSchemaSchema.optional(),
    outputSchema: JsonSchemaSchema.optional(),
  })).optional(),
  outputSchema: JsonSchemaSchema.optional(),
  maxIterations: z.number().int().min(1).optional(),
  maxToolCallsPerIteration: z.number().int().min(1).optional(),
  enableReasoning: z.boolean().optional(),
  enableMemory: z.boolean().optional(),
  tokenBudget: z.number().int().min(1).optional(),
})

/**
 * Schema for human function deploy request (type === 'human')
 */
export const HumanDeployRequestSchema = DeployRequestBaseSchema.extend({
  type: z.literal('human'),
  interactionType: z.enum([
    'approval', 'review', 'input', 'selection',
    'annotation', 'verification', 'custom',
  ]),
  uiConfig: z.record(z.unknown()).optional(),
  assignees: z.array(z.object({
    type: z.string().min(1),
    value: z.string().min(1),
  })).optional(),
  sla: z.object({
    responseTime: z.string().optional(),
    resolutionTime: z.string().optional(),
    onBreach: z.string().optional(),
  }).optional(),
  reminders: z.record(z.unknown()).optional(),
  escalation: z.record(z.unknown()).optional(),
  outputSchema: JsonSchemaSchema.optional(),
})

/**
 * Unified deploy request schema using discriminated union on `type` field.
 *
 * - type === 'code': code function
 * - type === 'generative': generative AI function
 * - type === 'agentic': agentic AI function
 * - type === 'human': human-in-the-loop function
 *
 * For backward compatibility, requests without a `type` field are validated
 * using CodeDeployRequestSchema (which allows type to be optional).
 */
export const TypedDeployRequestSchema = z.discriminatedUnion('type', [
  CodeDeployRequestSchema.extend({ type: z.literal('code') }),
  GenerativeDeployRequestSchema,
  AgenticDeployRequestSchema,
  HumanDeployRequestSchema,
])

/**
 * Unified deploy request schema that handles all function types.
 * Accepts requests with or without a `type` field for backward compatibility.
 *
 * - With type === 'code' | 'generative' | 'agentic' | 'human': validated via TypedDeployRequestSchema
 * - Without type field: validated as code function (backward compatible)
 */
export const DeployRequestSchema = z.union([
  CodeDeployRequestSchema,
  GenerativeDeployRequestSchema,
  AgenticDeployRequestSchema,
  HumanDeployRequestSchema,
])

/**
 * DeployRequest derived from schema (union of all types)
 */
export type DeployRequest = z.infer<typeof DeployRequestSchema>

/**
 * Type-specific deploy request types
 */
export type CodeDeployRequest = z.infer<typeof CodeDeployRequestSchema>
export type GenerativeDeployRequest = z.infer<typeof GenerativeDeployRequestSchema>
export type AgenticDeployRequest = z.infer<typeof AgenticDeployRequestSchema>
export type HumanDeployRequest = z.infer<typeof HumanDeployRequestSchema>

/** @deprecated Use DeployRequest instead */
export type DeployRequestInferred = DeployRequest

/**
 * Validates a deploy request body.
 * Supports all function types. Requests without a `type` field are
 * validated as code functions for backward compatibility.
 */
export function validateDeployRequest(data: unknown): ValidationResult {
  const result = DeployRequestSchema.safeParse(data)
  if (result.success) {
    return { valid: true }
  }
  return {
    valid: false,
    errors: createValidationError(result.error),
  }
}

/**
 * Parses and validates a deploy request, throwing on error.
 * Supports all function types. Requests without a `type` field are
 * parsed as code functions for backward compatibility.
 */
export function parseDeployRequest(data: unknown): DeployRequest {
  return DeployRequestSchema.parse(data)
}

// =============================================================================
// API HANDLER HELPERS
// =============================================================================

/**
 * Validates a function invocation request
 */
export function validateInvocation(data: unknown): ValidationResult {
  const result = FunctionInvocationSchema.safeParse(data)
  if (result.success) {
    return { valid: true }
  }
  return {
    valid: false,
    errors: createValidationError(result.error),
  }
}

/**
 * Parses and validates a function definition, throwing on error
 */
export function parseFunctionDefinition(data: unknown): FunctionDefinitionFromSchema {
  return FunctionDefinitionSchema.parse(data)
}

/**
 * Parses and validates a function result, throwing on error
 */
export function parseFunctionResult(data: unknown): FunctionResultFromSchema {
  return FunctionResultSchema.parse(data)
}

/**
 * Parses and validates a function invocation, throwing on error
 */
export function parseInvocation(data: unknown): FunctionInvocationFromSchema {
  return FunctionInvocationSchema.parse(data)
}

/**
 * Creates a validated function result from raw data
 */
export function createFunctionResult<T>(
  data: Omit<FunctionResultFromSchema, 'output'> & { output?: T }
): FunctionResultFromSchema & { output?: T } {
  return FunctionResultSchema.parse(data) as FunctionResultFromSchema & { output?: T }
}

/**
 * Type guard to check if a value is a valid function definition
 */
export function isFunctionDefinition(data: unknown): data is FunctionDefinitionFromSchema {
  return FunctionDefinitionSchema.safeParse(data).success
}

/**
 * Type guard to check if a value is a valid function result
 */
export function isFunctionResult(data: unknown): data is FunctionResultFromSchema {
  return FunctionResultSchema.safeParse(data).success
}
