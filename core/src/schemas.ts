/**
 * Zod schemas for runtime validation
 *
 * These schemas provide:
 * - Runtime validation for function definitions and results
 * - Type inference that matches the TypeScript interfaces
 * - Validation helpers for API handlers
 */

import { z } from 'zod'

// =============================================================================
// BASIC TYPE SCHEMAS
// =============================================================================

/**
 * Schema for function type discriminator
 */
export const FunctionTypeSchema = z.enum(['code', 'generative', 'agentic', 'human'])

/**
 * Schema for function result status
 */
export const FunctionResultStatusSchema = z.enum(['completed', 'failed', 'timeout', 'cancelled'])

/**
 * Schema for duration values (number in ms or duration string)
 */
export const DurationSchema = z.union([
  z.number().int().min(0),
  z.string().regex(
    /^\d+\s*(ms|s|seconds?|m|minutes?|h|hours?|d|days?)$/,
    'Invalid duration format. Use formats like: 100ms, 5s, 1 minute, 2 hours, 1 day'
  ),
])

// =============================================================================
// JSON SCHEMA
// =============================================================================

/**
 * Schema for JSON Schema objects (simplified, allows additional properties)
 */
export const JsonSchemaSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.object({
    type: z.enum(['object', 'array', 'string', 'number', 'boolean', 'null']).optional(),
    properties: z.record(z.lazy(() => JsonSchemaSchema)).optional(),
    items: z.lazy(() => JsonSchemaSchema).optional(),
    required: z.array(z.string()).optional(),
    enum: z.array(z.unknown()).optional(),
    description: z.string().optional(),
    default: z.unknown().optional(),
  }).passthrough()
)

// =============================================================================
// TOKEN USAGE & METRICS
// =============================================================================

/**
 * Schema for token usage metrics
 */
export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
})

/**
 * Schema for retry policy configuration
 */
export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).optional(),
  initialDelay: DurationSchema.optional(),
  maxDelay: DurationSchema.optional(),
  backoffCoefficient: z.number().min(1).optional(),
  nonRetryableErrors: z.array(z.string()).optional(),
}).partial()

/**
 * Schema for execution metrics
 */
export const ExecutionMetricsSchema = z.object({
  durationMs: z.number().int().min(0),
  inputSizeBytes: z.number().int().min(0),
  outputSizeBytes: z.number().int().min(0),
  retryCount: z.number().int().min(0),
  computeUnits: z.number().optional(),
  tokens: TokenUsageSchema.optional(),
})

// =============================================================================
// WORKFLOW CONTEXT
// =============================================================================

/**
 * Schema for workflow context
 */
export const WorkflowContextSchema = z.object({
  workflowId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1),
})

// =============================================================================
// EXECUTION METADATA
// =============================================================================

/**
 * Schema for execution metadata
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

// =============================================================================
// FUNCTION ERROR
// =============================================================================

/**
 * Schema for function error
 */
export const FunctionErrorSchema = z.object({
  name: z.string().min(1),
  message: z.string(),
  code: z.string().optional(),
  stack: z.string().optional(),
  retryable: z.boolean().optional(),
})

// =============================================================================
// FUNCTION DEFINITION
// =============================================================================

/**
 * Semantic version regex pattern
 */
const semverRegex = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/

/**
 * Schema for function definition
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

// =============================================================================
// FUNCTION RESULT
// =============================================================================

/**
 * Schema for function result
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

// =============================================================================
// VALIDATION TYPES
// =============================================================================

/**
 * Schema for validation error
 */
export const ValidationErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
})

/**
 * Schema for validation result
 */
export const ValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(ValidationErrorSchema).optional(),
})

// =============================================================================
// EXECUTION CONTEXT
// =============================================================================

/**
 * Schema for execution context
 */
export const ExecutionContextSchema = z.object({
  executionId: z.string().optional(),
  traceId: z.string().optional(),
  parentSpanId: z.string().optional(),
  timeout: DurationSchema.optional(),
  // Note: AbortSignal cannot be validated by Zod
  env: z.record(z.unknown()).optional(),
}).partial()

// =============================================================================
// FUNCTION FILTER
// =============================================================================

/**
 * Schema for function filter
 */
export const FunctionFilterSchema = z.object({
  type: FunctionTypeSchema.optional(),
  tags: z.array(z.string()).optional(),
  namePattern: z.string().optional(),
}).partial()

// =============================================================================
// FUNCTION INVOCATION
// =============================================================================

/**
 * Schema for function invocation
 */
export const FunctionInvocationSchema = z.object({
  functionId: z.string().min(1),
  version: z.string().optional(),
  input: z.unknown(),
  config: z.unknown().optional(),
  context: ExecutionContextSchema.optional(),
  idempotencyKey: z.string().optional(),
})

// =============================================================================
// INFERRED TYPES
// =============================================================================

export type FunctionTypeInferred = z.infer<typeof FunctionTypeSchema>
export type FunctionResultStatusInferred = z.infer<typeof FunctionResultStatusSchema>
export type DurationInferred = z.infer<typeof DurationSchema>
export type JsonSchemaInferred = z.infer<typeof JsonSchemaSchema>
export type TokenUsageInferred = z.infer<typeof TokenUsageSchema>
export type RetryPolicyInferred = z.infer<typeof RetryPolicySchema>
export type ExecutionMetricsInferred = z.infer<typeof ExecutionMetricsSchema>
export type WorkflowContextInferred = z.infer<typeof WorkflowContextSchema>
export type ExecutionMetadataInferred = z.infer<typeof ExecutionMetadataSchema>
export type FunctionErrorInferred = z.infer<typeof FunctionErrorSchema>
export type FunctionDefinitionInferred = z.infer<typeof FunctionDefinitionSchema>
export type FunctionResultInferred = z.infer<typeof FunctionResultSchema>
export type ValidationErrorInferred = z.infer<typeof ValidationErrorSchema>
export type ValidationResultInferred = z.infer<typeof ValidationResultSchema>
export type ExecutionContextInferred = z.infer<typeof ExecutionContextSchema>
export type FunctionFilterInferred = z.infer<typeof FunctionFilterSchema>
export type FunctionInvocationInferred = z.infer<typeof FunctionInvocationSchema>

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validates a function definition and returns a ValidationResult
 */
export function validateFunctionDefinition(data: unknown): ValidationResultInferred {
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
export function validateFunctionResult(data: unknown): ValidationResultInferred {
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
  schema: Record<string, unknown>
): ValidationResultInferred {
  // For now, perform basic validation based on JSON schema structure
  // Full JSON Schema validation would require a dedicated library
  const errors: ValidationErrorInferred[] = []

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
    for (const requiredProp of schema.required as string[]) {
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
  schema: Record<string, unknown>
): ValidationResultInferred {
  const errors: ValidationErrorInferred[] = []

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
): z.SafeParseReturnType<unknown, FunctionDefinitionInferred> {
  return FunctionDefinitionSchema.safeParse(data)
}

/**
 * Safe parse for function result with typed result
 */
export function safeParseFunctionResult(
  data: unknown
): z.SafeParseReturnType<unknown, FunctionResultInferred> {
  return FunctionResultSchema.safeParse(data)
}

/**
 * Creates an array of ValidationError from a ZodError
 */
export function createValidationError(zodError: z.ZodError): ValidationErrorInferred[] {
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

// =============================================================================
// DEPLOY REQUEST SCHEMA
// =============================================================================

/**
 * Schema for function deploy request body
 */
export const DeployRequestSchema = z.object({
  id: z.string().min(1, 'Function ID is required').regex(
    /^[a-zA-Z][a-zA-Z0-9_-]*$/,
    'Function ID must start with a letter and contain only letters, numbers, underscores, and hyphens'
  ),
  version: z.string().regex(semverRegex, 'Invalid semantic version format'),
  language: CodeLanguageSchema,
  code: z.string().min(1, 'Code cannot be empty'),
  entryPoint: z.string().optional(),
  dependencies: z.record(z.string()).optional(),
  type: FunctionTypeSchema.optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

export type DeployRequestInferred = z.infer<typeof DeployRequestSchema>

/**
 * Validates a deploy request body
 */
export function validateDeployRequest(data: unknown): ValidationResultInferred {
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
 * Parses and validates a deploy request, throwing on error
 */
export function parseDeployRequest(data: unknown): DeployRequestInferred {
  return DeployRequestSchema.parse(data)
}

// =============================================================================
// API HANDLER HELPERS
// =============================================================================

/**
 * Validates a function invocation request
 */
export function validateInvocation(data: unknown): ValidationResultInferred {
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
export function parseFunctionDefinition(data: unknown): FunctionDefinitionInferred {
  return FunctionDefinitionSchema.parse(data)
}

/**
 * Parses and validates a function result, throwing on error
 */
export function parseFunctionResult(data: unknown): FunctionResultInferred {
  return FunctionResultSchema.parse(data)
}

/**
 * Parses and validates a function invocation, throwing on error
 */
export function parseInvocation(data: unknown): FunctionInvocationInferred {
  return FunctionInvocationSchema.parse(data)
}

/**
 * Creates a validated function result from raw data
 */
export function createFunctionResult<T>(
  data: Omit<FunctionResultInferred, 'output'> & { output?: T }
): FunctionResultInferred & { output?: T } {
  return FunctionResultSchema.parse(data) as FunctionResultInferred & { output?: T }
}

/**
 * Type guard to check if a value is a valid function definition
 */
export function isFunctionDefinition(data: unknown): data is FunctionDefinitionInferred {
  return FunctionDefinitionSchema.safeParse(data).success
}

/**
 * Type guard to check if a value is a valid function result
 */
export function isFunctionResult(data: unknown): data is FunctionResultInferred {
  return FunctionResultSchema.safeParse(data).success
}
