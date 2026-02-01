/**
 * Function Validator for Functions.do
 *
 * Re-exports validation functions from core for API use.
 */

export {
  validateFunctionId,
  validateLanguage,
  validateEntryPoint,
  validateDependencies,
  validateMetadata,
} from '../../core/function-registry'

export { isValidVersion, parseVersion } from '../../core/types'

/**
 * Function validator class for object-oriented usage
 */
export class FunctionValidator {
  /**
   * Validate all function metadata
   */
  static validate(metadata: {
    id: string
    version: string
    language: string
    code?: string
    entryPoint?: string
    dependencies?: Record<string, string>
  }): { valid: boolean; errors: string[] } {
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
