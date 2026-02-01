/**
 * Tests for Zod schemas - TDD RED phase
 *
 * These tests define the expected behavior of the Zod schemas
 * for runtime validation of function types.
 */
import { describe, it, expect, expectTypeOf } from 'vitest'
import { z } from 'zod'
import {
  // Schemas
  FunctionTypeSchema,
  FunctionResultStatusSchema,
  DurationSchema,
  JsonSchemaSchema,
  RetryPolicySchema,
  TokenUsageSchema,
  ExecutionMetricsSchema,
  WorkflowContextSchema,
  ExecutionMetadataSchema,
  FunctionErrorSchema,
  FunctionDefinitionSchema,
  FunctionResultSchema,
  ValidationErrorSchema,
  ValidationResultSchema,
  ExecutionContextSchema,
  FunctionFilterSchema,
  FunctionInvocationSchema,
  CodeLanguageSchema,
  DeployRequestSchema,
  // Inferred types
  type FunctionTypeInferred,
  type FunctionResultStatusInferred,
  type DurationInferred,
  type FunctionDefinitionInferred,
  type FunctionResultInferred,
  type ValidationResultInferred,
  type DeployRequestInferred,
  // Validation helpers
  validateFunctionDefinition,
  validateFunctionResult,
  validateInput,
  validateOutput,
  safeParseFunctionDefinition,
  createValidationError,
  validateDeployRequest,
  parseDeployRequest,
} from '../schemas.js'

describe('Zod Schemas', () => {
  // ==========================================================================
  // BASIC TYPE SCHEMAS
  // ==========================================================================

  describe('FunctionTypeSchema', () => {
    it('should accept valid function types', () => {
      expect(FunctionTypeSchema.parse('code')).toBe('code')
      expect(FunctionTypeSchema.parse('generative')).toBe('generative')
      expect(FunctionTypeSchema.parse('agentic')).toBe('agentic')
      expect(FunctionTypeSchema.parse('human')).toBe('human')
    })

    it('should reject invalid function types', () => {
      expect(() => FunctionTypeSchema.parse('invalid')).toThrow()
      expect(() => FunctionTypeSchema.parse(123)).toThrow()
      expect(() => FunctionTypeSchema.parse(null)).toThrow()
    })
  })

  describe('FunctionResultStatusSchema', () => {
    it('should accept valid result statuses', () => {
      expect(FunctionResultStatusSchema.parse('completed')).toBe('completed')
      expect(FunctionResultStatusSchema.parse('failed')).toBe('failed')
      expect(FunctionResultStatusSchema.parse('timeout')).toBe('timeout')
      expect(FunctionResultStatusSchema.parse('cancelled')).toBe('cancelled')
    })

    it('should reject invalid statuses', () => {
      expect(() => FunctionResultStatusSchema.parse('pending')).toThrow()
      expect(() => FunctionResultStatusSchema.parse('')).toThrow()
    })
  })

  describe('DurationSchema', () => {
    it('should accept numeric milliseconds', () => {
      expect(DurationSchema.parse(1000)).toBe(1000)
      expect(DurationSchema.parse(0)).toBe(0)
    })

    it('should accept duration strings', () => {
      expect(DurationSchema.parse('100ms')).toBe('100ms')
      expect(DurationSchema.parse('5s')).toBe('5s')
      expect(DurationSchema.parse('1 second')).toBe('1 second')
      expect(DurationSchema.parse('30 seconds')).toBe('30 seconds')
      expect(DurationSchema.parse('5m')).toBe('5m')
      expect(DurationSchema.parse('1 minute')).toBe('1 minute')
      expect(DurationSchema.parse('5 minutes')).toBe('5 minutes')
      expect(DurationSchema.parse('1h')).toBe('1h')
      expect(DurationSchema.parse('24 hours')).toBe('24 hours')
      expect(DurationSchema.parse('1d')).toBe('1d')
      expect(DurationSchema.parse('7 days')).toBe('7 days')
    })

    it('should reject invalid duration strings', () => {
      expect(() => DurationSchema.parse('invalid')).toThrow()
      expect(() => DurationSchema.parse('5x')).toThrow()
    })
  })

  // ==========================================================================
  // COMPLEX TYPE SCHEMAS
  // ==========================================================================

  describe('JsonSchemaSchema', () => {
    it('should accept valid JSON schemas', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      }
      expect(JsonSchemaSchema.parse(schema)).toEqual(schema)
    })

    it('should accept minimal JSON schema', () => {
      expect(JsonSchemaSchema.parse({})).toEqual({})
      expect(JsonSchemaSchema.parse({ type: 'string' })).toEqual({ type: 'string' })
    })

    it('should accept JSON schema with additional properties', () => {
      const schema = {
        type: 'object',
        additionalProperties: true,
        minProperties: 1,
      }
      expect(JsonSchemaSchema.parse(schema)).toEqual(schema)
    })
  })

  describe('TokenUsageSchema', () => {
    it('should accept valid token usage', () => {
      const usage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      }
      expect(TokenUsageSchema.parse(usage)).toEqual(usage)
    })

    it('should reject missing fields', () => {
      expect(() => TokenUsageSchema.parse({ inputTokens: 100 })).toThrow()
    })

    it('should reject negative values', () => {
      expect(() => TokenUsageSchema.parse({
        inputTokens: -1,
        outputTokens: 50,
        totalTokens: 49,
      })).toThrow()
    })
  })

  describe('RetryPolicySchema', () => {
    it('should accept valid retry policy', () => {
      const policy = {
        maxAttempts: 3,
        initialDelay: '1s',
        maxDelay: '60s',
        backoffCoefficient: 2.0,
        nonRetryableErrors: ['ValidationError'],
      }
      expect(RetryPolicySchema.parse(policy)).toEqual(policy)
    })

    it('should accept empty retry policy', () => {
      expect(RetryPolicySchema.parse({})).toEqual({})
    })

    it('should accept partial retry policy', () => {
      const policy = { maxAttempts: 5 }
      expect(RetryPolicySchema.parse(policy)).toEqual(policy)
    })
  })

  describe('ExecutionMetricsSchema', () => {
    it('should accept valid metrics', () => {
      const metrics = {
        durationMs: 1500,
        inputSizeBytes: 256,
        outputSizeBytes: 512,
        retryCount: 0,
      }
      expect(ExecutionMetricsSchema.parse(metrics)).toEqual(metrics)
    })

    it('should accept metrics with optional fields', () => {
      const metrics = {
        durationMs: 1500,
        inputSizeBytes: 256,
        outputSizeBytes: 512,
        retryCount: 0,
        computeUnits: 10,
        tokens: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
      }
      expect(ExecutionMetricsSchema.parse(metrics)).toEqual(metrics)
    })

    it('should reject missing required fields', () => {
      expect(() => ExecutionMetricsSchema.parse({ durationMs: 100 })).toThrow()
    })
  })

  describe('WorkflowContextSchema', () => {
    it('should accept valid workflow context', () => {
      const context = {
        workflowId: 'wf-123',
        runId: 'run-456',
        stepId: 'step-789',
      }
      expect(WorkflowContextSchema.parse(context)).toEqual(context)
    })

    it('should reject missing fields', () => {
      expect(() => WorkflowContextSchema.parse({ workflowId: 'wf-123' })).toThrow()
    })
  })

  describe('ExecutionMetadataSchema', () => {
    it('should accept valid metadata', () => {
      const metadata = {
        startedAt: Date.now(),
      }
      expect(ExecutionMetadataSchema.parse(metadata)).toEqual(metadata)
    })

    it('should accept metadata with all optional fields', () => {
      const metadata = {
        startedAt: Date.now(),
        completedAt: Date.now() + 1000,
        region: 'us-east-1',
        traceId: 'trace-123',
        spanId: 'span-456',
        triggeredBy: 'user@example.com',
        workflowContext: {
          workflowId: 'wf-123',
          runId: 'run-456',
          stepId: 'step-789',
        },
      }
      expect(ExecutionMetadataSchema.parse(metadata)).toEqual(metadata)
    })
  })

  describe('FunctionErrorSchema', () => {
    it('should accept valid function error', () => {
      const error = {
        name: 'ValidationError',
        message: 'Invalid input',
      }
      expect(FunctionErrorSchema.parse(error)).toEqual(error)
    })

    it('should accept error with all fields', () => {
      const error = {
        name: 'ValidationError',
        message: 'Invalid input',
        code: 'ERR_INVALID_INPUT',
        stack: 'Error: Invalid input\n    at validate...',
        retryable: true,
      }
      expect(FunctionErrorSchema.parse(error)).toEqual(error)
    })
  })

  // ==========================================================================
  // FUNCTION DEFINITION SCHEMA
  // ==========================================================================

  describe('FunctionDefinitionSchema', () => {
    it('should accept valid function definition', () => {
      const definition = {
        id: 'test-func',
        name: 'Test Function',
        version: '1.0.0',
        type: 'code',
      }
      expect(FunctionDefinitionSchema.parse(definition)).toEqual(definition)
    })

    it('should accept function definition with all fields', () => {
      const definition = {
        id: 'test-func',
        name: 'Test Function',
        version: '1.0.0',
        type: 'generative',
        description: 'A test function',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'string' },
        defaultConfig: { timeout: 5000 },
        timeout: '30s',
        retryPolicy: { maxAttempts: 3 },
        tags: ['test', 'example'],
      }
      expect(FunctionDefinitionSchema.parse(definition)).toEqual(definition)
    })

    it('should reject missing required fields', () => {
      expect(() => FunctionDefinitionSchema.parse({ id: 'test' })).toThrow()
      expect(() => FunctionDefinitionSchema.parse({ id: 'test', name: 'Test' })).toThrow()
    })

    it('should reject invalid version format', () => {
      expect(() => FunctionDefinitionSchema.parse({
        id: 'test',
        name: 'Test',
        version: 'invalid',
        type: 'code',
      })).toThrow()
    })

    it('should accept valid semantic versions', () => {
      const validVersions = ['1.0.0', '0.1.0', '2.3.4', '1.0.0-alpha', '1.0.0-beta.1']
      validVersions.forEach((version) => {
        const def = FunctionDefinitionSchema.parse({
          id: 'test',
          name: 'Test',
          version,
          type: 'code',
        })
        expect(def.version).toBe(version)
      })
    })
  })

  // ==========================================================================
  // FUNCTION RESULT SCHEMA
  // ==========================================================================

  describe('FunctionResultSchema', () => {
    const validMetrics = {
      durationMs: 100,
      inputSizeBytes: 50,
      outputSizeBytes: 100,
      retryCount: 0,
    }

    const validMetadata = {
      startedAt: Date.now(),
    }

    it('should accept valid function result', () => {
      const result = {
        executionId: 'exec-123',
        functionId: 'func-456',
        functionVersion: '1.0.0',
        status: 'completed',
        output: { data: 'result' },
        metrics: validMetrics,
        metadata: validMetadata,
      }
      expect(FunctionResultSchema.parse(result)).toEqual(result)
    })

    it('should accept failed result with error', () => {
      const result = {
        executionId: 'exec-123',
        functionId: 'func-456',
        functionVersion: '1.0.0',
        status: 'failed',
        error: {
          name: 'ExecutionError',
          message: 'Something went wrong',
        },
        metrics: validMetrics,
        metadata: validMetadata,
      }
      expect(FunctionResultSchema.parse(result)).toEqual(result)
    })

    it('should reject missing required fields', () => {
      expect(() => FunctionResultSchema.parse({ executionId: 'exec-123' })).toThrow()
    })
  })

  // ==========================================================================
  // VALIDATION HELPERS
  // ==========================================================================

  describe('ValidationErrorSchema', () => {
    it('should accept valid validation error', () => {
      const error = {
        path: 'input.name',
        message: 'Required field',
      }
      expect(ValidationErrorSchema.parse(error)).toEqual(error)
    })

    it('should accept validation error with code', () => {
      const error = {
        path: 'input.age',
        message: 'Must be a positive number',
        code: 'invalid_type',
      }
      expect(ValidationErrorSchema.parse(error)).toEqual(error)
    })
  })

  describe('ValidationResultSchema', () => {
    it('should accept valid validation result', () => {
      expect(ValidationResultSchema.parse({ valid: true })).toEqual({ valid: true })
    })

    it('should accept invalid result with errors', () => {
      const result = {
        valid: false,
        errors: [
          { path: 'input.name', message: 'Required' },
          { path: 'input.email', message: 'Invalid email' },
        ],
      }
      expect(ValidationResultSchema.parse(result)).toEqual(result)
    })
  })

  describe('ExecutionContextSchema', () => {
    it('should accept minimal context', () => {
      expect(ExecutionContextSchema.parse({})).toEqual({})
    })

    it('should accept full context', () => {
      const context = {
        executionId: 'exec-123',
        traceId: 'trace-456',
        parentSpanId: 'span-789',
        timeout: '30s',
        env: { API_KEY: 'secret' },
      }
      // AbortSignal cannot be validated by Zod, so we exclude it
      expect(ExecutionContextSchema.parse(context)).toEqual(context)
    })
  })

  describe('FunctionFilterSchema', () => {
    it('should accept empty filter', () => {
      expect(FunctionFilterSchema.parse({})).toEqual({})
    })

    it('should accept filter with all fields', () => {
      const filter = {
        type: 'code',
        tags: ['api', 'v2'],
        namePattern: 'user-*',
      }
      expect(FunctionFilterSchema.parse(filter)).toEqual(filter)
    })
  })

  describe('FunctionInvocationSchema', () => {
    it('should accept minimal invocation', () => {
      const invocation = {
        functionId: 'func-123',
        input: { data: 'test' },
      }
      expect(FunctionInvocationSchema.parse(invocation)).toEqual(invocation)
    })

    it('should accept full invocation', () => {
      const invocation = {
        functionId: 'func-123',
        version: '1.0.0',
        input: { data: 'test' },
        config: { timeout: 5000 },
        context: { traceId: 'trace-123' },
        idempotencyKey: 'idem-456',
      }
      expect(FunctionInvocationSchema.parse(invocation)).toEqual(invocation)
    })
  })

  // ==========================================================================
  // VALIDATION HELPER FUNCTIONS
  // ==========================================================================

  describe('validateFunctionDefinition', () => {
    it('should return valid result for valid definition', () => {
      const definition = {
        id: 'test-func',
        name: 'Test Function',
        version: '1.0.0',
        type: 'code',
      }
      const result = validateFunctionDefinition(definition)
      expect(result.valid).toBe(true)
      expect(result.errors).toBeUndefined()
    })

    it('should return errors for invalid definition', () => {
      const result = validateFunctionDefinition({ id: 'test' })
      expect(result.valid).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors!.length).toBeGreaterThan(0)
    })
  })

  describe('validateFunctionResult', () => {
    const validMetrics = {
      durationMs: 100,
      inputSizeBytes: 50,
      outputSizeBytes: 100,
      retryCount: 0,
    }

    it('should return valid result for valid result', () => {
      const funcResult = {
        executionId: 'exec-123',
        functionId: 'func-456',
        functionVersion: '1.0.0',
        status: 'completed',
        metrics: validMetrics,
        metadata: { startedAt: Date.now() },
      }
      const result = validateFunctionResult(funcResult)
      expect(result.valid).toBe(true)
    })

    it('should return errors for invalid result', () => {
      const result = validateFunctionResult({ executionId: 'exec-123' })
      expect(result.valid).toBe(false)
      expect(result.errors).toBeDefined()
    })
  })

  describe('validateInput', () => {
    it('should validate input against JSON schema', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      }

      const validInput = { name: 'test' }
      const result = validateInput(validInput, schema)
      expect(result.valid).toBe(true)
    })

    it('should return errors for invalid input', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      }

      const invalidInput = { age: 25 }
      const result = validateInput(invalidInput, schema)
      expect(result.valid).toBe(false)
      expect(result.errors).toBeDefined()
    })
  })

  describe('validateOutput', () => {
    it('should validate output against JSON schema', () => {
      const schema = {
        type: 'string',
      }

      const validOutput = 'result'
      const result = validateOutput(validOutput, schema)
      expect(result.valid).toBe(true)
    })

    it('should return errors for invalid output', () => {
      const schema = {
        type: 'string',
      }

      const invalidOutput = 123
      const result = validateOutput(invalidOutput, schema)
      expect(result.valid).toBe(false)
    })
  })

  describe('safeParseFunctionDefinition', () => {
    it('should return data for valid definition', () => {
      const definition = {
        id: 'test-func',
        name: 'Test Function',
        version: '1.0.0',
        type: 'code',
      }
      const result = safeParseFunctionDefinition(definition)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(definition)
      }
    })

    it('should return error for invalid definition', () => {
      const result = safeParseFunctionDefinition({ id: 'test' })
      expect(result.success).toBe(false)
    })
  })

  describe('createValidationError', () => {
    it('should create validation error from Zod error', () => {
      const schema = z.object({ name: z.string() })
      const parseResult = schema.safeParse({ name: 123 })

      if (!parseResult.success) {
        const errors = createValidationError(parseResult.error)
        expect(errors).toBeDefined()
        expect(errors.length).toBeGreaterThan(0)
        expect(errors[0]).toHaveProperty('path')
        expect(errors[0]).toHaveProperty('message')
      }
    })
  })

  // ==========================================================================
  // CODE LANGUAGE SCHEMA
  // ==========================================================================

  describe('CodeLanguageSchema', () => {
    it('should accept valid code languages', () => {
      const validLanguages = [
        'typescript',
        'javascript',
        'rust',
        'go',
        'python',
        'zig',
        'assemblyscript',
        'csharp',
      ]
      validLanguages.forEach((lang) => {
        expect(CodeLanguageSchema.parse(lang)).toBe(lang)
      })
    })

    it('should reject invalid languages', () => {
      expect(() => CodeLanguageSchema.parse('ruby')).toThrow()
      expect(() => CodeLanguageSchema.parse('java')).toThrow()
      expect(() => CodeLanguageSchema.parse('')).toThrow()
    })
  })

  // ==========================================================================
  // DEPLOY REQUEST SCHEMA
  // ==========================================================================

  describe('DeployRequestSchema', () => {
    it('should accept valid deploy request', () => {
      const request = {
        id: 'myFunction',
        version: '1.0.0',
        language: 'typescript',
        code: 'export default { fetch() { return new Response("Hello"); } }',
      }
      expect(DeployRequestSchema.parse(request)).toEqual(request)
    })

    it('should accept deploy request with all optional fields', () => {
      const request = {
        id: 'myFunction',
        version: '1.0.0',
        language: 'typescript',
        code: 'export default { fetch() { return new Response("Hello"); } }',
        entryPoint: 'index.ts',
        dependencies: { lodash: '^4.17.21' },
        type: 'code',
        description: 'A test function',
        tags: ['test', 'example'],
      }
      expect(DeployRequestSchema.parse(request)).toEqual(request)
    })

    it('should reject missing required fields', () => {
      expect(() => DeployRequestSchema.parse({ id: 'test' })).toThrow()
      expect(() => DeployRequestSchema.parse({ id: 'test', version: '1.0.0' })).toThrow()
      expect(() => DeployRequestSchema.parse({
        id: 'test',
        version: '1.0.0',
        language: 'typescript',
      })).toThrow()
    })

    it('should reject invalid function ID format', () => {
      expect(() => DeployRequestSchema.parse({
        id: '123invalid', // starts with number
        version: '1.0.0',
        language: 'typescript',
        code: 'test',
      })).toThrow()

      expect(() => DeployRequestSchema.parse({
        id: 'invalid.id', // contains dot
        version: '1.0.0',
        language: 'typescript',
        code: 'test',
      })).toThrow()
    })

    it('should accept valid function ID formats', () => {
      const validIds = ['myFunc', 'my-func', 'my_func', 'MyFunc123', 'a']
      validIds.forEach((id) => {
        const request = {
          id,
          version: '1.0.0',
          language: 'typescript',
          code: 'test',
        }
        expect(DeployRequestSchema.parse(request).id).toBe(id)
      })
    })

    it('should reject empty code', () => {
      expect(() => DeployRequestSchema.parse({
        id: 'test',
        version: '1.0.0',
        language: 'typescript',
        code: '',
      })).toThrow()
    })

    it('should reject invalid version format', () => {
      expect(() => DeployRequestSchema.parse({
        id: 'test',
        version: 'invalid',
        language: 'typescript',
        code: 'test',
      })).toThrow()

      expect(() => DeployRequestSchema.parse({
        id: 'test',
        version: '1.0',
        language: 'typescript',
        code: 'test',
      })).toThrow()
    })
  })

  describe('validateDeployRequest', () => {
    it('should return valid result for valid request', () => {
      const request = {
        id: 'myFunction',
        version: '1.0.0',
        language: 'typescript',
        code: 'test code',
      }
      const result = validateDeployRequest(request)
      expect(result.valid).toBe(true)
      expect(result.errors).toBeUndefined()
    })

    it('should return errors for invalid request', () => {
      const result = validateDeployRequest({ id: 'test' })
      expect(result.valid).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors!.length).toBeGreaterThan(0)
    })
  })

  describe('parseDeployRequest', () => {
    it('should return parsed data for valid request', () => {
      const request = {
        id: 'myFunction',
        version: '1.0.0',
        language: 'typescript',
        code: 'test code',
      }
      const result = parseDeployRequest(request)
      expect(result).toEqual(request)
    })

    it('should throw for invalid request', () => {
      expect(() => parseDeployRequest({ id: 'test' })).toThrow()
    })
  })

  // ==========================================================================
  // TYPE INFERENCE TESTS
  // ==========================================================================

  describe('Type Inference', () => {
    it('should infer FunctionType correctly', () => {
      const functionType: FunctionTypeInferred = 'code'
      // Use toMatchTypeOf for alias compatibility
      expectTypeOf(functionType).toMatchTypeOf<'code' | 'generative' | 'agentic' | 'human'>()
    })

    it('should infer FunctionResultStatus correctly', () => {
      const status: FunctionResultStatusInferred = 'completed'
      // Use toMatchTypeOf for alias compatibility
      expectTypeOf(status).toMatchTypeOf<'completed' | 'failed' | 'timeout' | 'cancelled'>()
    })

    it('should infer Duration correctly', () => {
      const duration1: DurationInferred = 1000
      const duration2: DurationInferred = '5s'
      expectTypeOf(duration1).toMatchTypeOf<number | string>()
      expectTypeOf(duration2).toMatchTypeOf<number | string>()
    })

    it('should infer FunctionDefinition correctly', () => {
      const definition: FunctionDefinitionInferred = {
        id: 'test',
        name: 'Test',
        version: '1.0.0',
        type: 'code',
      }
      expectTypeOf(definition).toHaveProperty('id')
      expectTypeOf(definition).toHaveProperty('name')
      expectTypeOf(definition).toHaveProperty('version')
      expectTypeOf(definition).toHaveProperty('type')
    })

    it('should infer FunctionResult correctly', () => {
      const result: FunctionResultInferred = {
        executionId: 'exec-123',
        functionId: 'func-456',
        functionVersion: '1.0.0',
        status: 'completed',
        metrics: {
          durationMs: 100,
          inputSizeBytes: 50,
          outputSizeBytes: 100,
          retryCount: 0,
        },
        metadata: {
          startedAt: Date.now(),
        },
      }
      expectTypeOf(result).toHaveProperty('executionId')
      expectTypeOf(result).toHaveProperty('status')
    })

    it('should infer ValidationResult correctly', () => {
      const result: ValidationResultInferred = { valid: true }
      expectTypeOf(result).toHaveProperty('valid')
    })
  })
})
