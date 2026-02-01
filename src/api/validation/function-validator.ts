/**
 * Function Validator for Functions.do
 *
 * Provides validation functions for function metadata using the Result pattern.
 * Re-exports validation functions from core for API use.
 *
 * ## Error Handling Pattern
 *
 * This module uses the Result<T, E> pattern for validation:
 *
 * ```typescript
 * // Using the Result-returning validator
 * const result = FunctionValidator.validateSafe(metadata)
 * if (isErr(result)) {
 *   return resultToResponse(result)
 * }
 * // result.data contains validated metadata
 *
 * // Or using the legacy throwing version
 * const { valid, errors } = FunctionValidator.validate(metadata)
 * if (!valid) {
 *   return new Response(JSON.stringify({ errors }), { status: 400 })
 * }
 * ```
 */

// Re-export throwing validators (legacy)
export {
  validateFunctionId,
  validateLanguage,
  validateEntryPoint,
  validateDependencies,
  validateMetadata,
} from '../../core/function-registry'

// Re-export Result-returning validators (preferred)
export {
  validateFunctionIdSafe,
  validateLanguageSafe,
  validateEntryPointSafe,
  validateDependenciesSafe,
  validateMetadataSafe,
  validateVersionSafe,
} from '../../core/function-registry'

// Re-export Result utilities
export {
  ok,
  err,
  isOk,
  isErr,
  errorToResponse,
  resultToResponse,
  type Result,
} from '../../core/errors'

export { isValidVersion, parseVersion } from '../../core/types'

/**
 * Validation result type using the Result pattern
 */
import type { Result } from '../../core/errors'
import type { ValidationError } from '../../core/errors'
import {
  validateFunctionIdSafe,
  validateLanguageSafe,
  validateEntryPointSafe,
  validateDependenciesSafe,
  validateVersionSafe,
} from '../../core/function-registry'
import { ok, err, isErr } from '../../core/errors'

/**
 * Input type for function validation
 */
export interface FunctionValidationInput {
  id: string
  version: string
  language: string
  code?: string
  entryPoint?: string
  dependencies?: Record<string, string>
}

/**
 * Function validator class for object-oriented usage
 *
 * Provides both throwing and Result-returning validation methods.
 * New code should prefer the Result-returning `validateSafe` method.
 */
export class FunctionValidator {
  /**
   * Validate all function metadata and return a Result.
   * This is the preferred validation method for new code.
   *
   * @param metadata - The function metadata to validate
   * @returns Result with validated metadata or ValidationError
   *
   * @example
   * ```typescript
   * const result = FunctionValidator.validateSafe(metadata)
   * if (isErr(result)) {
   *   return resultToResponse(result)
   * }
   * // Use result.data
   * ```
   */
  static validateSafe(metadata: FunctionValidationInput): Result<FunctionValidationInput, ValidationError> {
    // Validate ID
    const idResult = validateFunctionIdSafe(metadata.id)
    if (isErr(idResult)) {
      return idResult
    }

    // Validate version
    const versionResult = validateVersionSafe(metadata.version)
    if (isErr(versionResult)) {
      return versionResult
    }

    // Validate language
    const languageResult = validateLanguageSafe(metadata.language)
    if (isErr(languageResult)) {
      return languageResult
    }

    // Validate code if provided
    if (metadata.code !== undefined && metadata.code === '') {
      return err(new (require('../../core/errors').ValidationError)('Code cannot be empty', { field: 'code' }))
    }

    // Validate entry point if provided
    if (metadata.entryPoint) {
      const entryPointResult = validateEntryPointSafe(metadata.entryPoint)
      if (isErr(entryPointResult)) {
        return entryPointResult
      }
    }

    // Validate dependencies if provided
    if (metadata.dependencies) {
      const dependenciesResult = validateDependenciesSafe(metadata.dependencies)
      if (isErr(dependenciesResult)) {
        return dependenciesResult
      }
    }

    return ok(metadata)
  }

  /**
   * Validate all function metadata (legacy throwing version).
   *
   * @deprecated Use validateSafe() for new code
   */
  static validate(metadata: FunctionValidationInput): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    // Import validation functions
    const {
      validateFunctionId,
      validateLanguage,
      validateEntryPoint,
      validateDependencies,
    } = require('../../core/function-registry')
    const { isValidVersion } = require('../../core/types')

    // Validate ID
    try {
      validateFunctionId(metadata.id)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Invalid function ID')
    }

    // Validate version
    if (!isValidVersion(metadata.version)) {
      errors.push(`Invalid semantic version: ${metadata.version}`)
    }

    // Validate language
    try {
      validateLanguage(metadata.language)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Invalid language')
    }

    // Validate code if provided
    if (metadata.code !== undefined && metadata.code === '') {
      errors.push('Code cannot be empty')
    }

    // Validate entry point if provided
    if (metadata.entryPoint) {
      try {
        validateEntryPoint(metadata.entryPoint)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Invalid entry point')
      }
    }

    // Validate dependencies if provided
    if (metadata.dependencies) {
      try {
        validateDependencies(metadata.dependencies)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Invalid dependencies')
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }
}

export default FunctionValidator
